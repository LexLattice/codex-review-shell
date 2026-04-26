"use strict";

const crypto = require("node:crypto");
const http = require("node:http");
const {
  DEFAULT_AUTHORIZATION_ENDPOINT,
  DEFAULT_AUTHORIZATION_EXTRA_PARAMS,
  DEFAULT_CLIENT_ID,
  DEFAULT_REDIRECT_URI,
  DEFAULT_SCOPE,
  DEFAULT_TOKEN_ENDPOINT,
  buildAuthorizationUrl,
  extractChatgptAccountIdFromJwt,
  generatePkceVerifier,
  normalizeTokenResponse,
  parseCallbackUrl,
  pkceChallengeFromVerifier,
} = require("./oauth-shapes");

const DIRECT_AUTH_LOGIN_FLOW_SCHEMA = "direct_codex_auth_login_flow@1";
const DEFAULT_CALLBACK_TIMEOUT_MS = 180_000;
const DEFAULT_CALLBACK_URL = new URL(DEFAULT_REDIRECT_URI);
const DEFAULT_CALLBACK_HOST = DEFAULT_CALLBACK_URL.hostname;
const DEFAULT_CALLBACK_PORT = Number(DEFAULT_CALLBACK_URL.port) || 1455;
const DEFAULT_CALLBACK_PATH = DEFAULT_CALLBACK_URL.pathname || "/auth/callback";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(Object(value), key);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function randomUrlToken(prefix) {
  return `${prefix}_${crypto.randomBytes(18).toString("base64url")}`;
}

function safeLoginFailure(reason, status = "failed") {
  return {
    schema: DIRECT_AUTH_LOGIN_FLOW_SCHEMA,
    ok: false,
    status,
    reason,
    rawTokensExposed: false,
  };
}

function callbackResponseHtml(status) {
  const title = status === "ok" ? "Codex auth complete" : "Codex auth failed";
  const body = status === "ok"
    ? "You can return to Codex Review Shell."
    : "The auth callback could not be accepted. Return to Codex Review Shell and try again.";
  return `<!doctype html><meta charset="utf-8"><title>${title}</title><body><h1>${title}</h1><p>${body}</p></body>`;
}

function redirectUriFromServer(server, options = {}) {
  const address = server.address();
  const port = isPlainObject(address) ? Number(address.port) : Number(options.callbackPort || 0);
  const host = normalizeString(options.callbackHost, DEFAULT_CALLBACK_HOST);
  const callbackPath = normalizeString(options.callbackPath, DEFAULT_CALLBACK_PATH);
  return `http://${host}:${port}${callbackPath.startsWith("/") ? callbackPath : `/${callbackPath}`}`;
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

function waitForCallback(server, flow, options = {}) {
  const timeoutMs = Math.max(1_000, Number(options.callbackTimeoutMs || DEFAULT_CALLBACK_TIMEOUT_MS));
  const callbackPath = new URL(flow.redirectUri).pathname;
  return new Promise((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ status: "timeout", reason: "callback_timeout" });
    }, timeoutMs);

    server.on("request", (request, response) => {
      if (settled) {
        response.writeHead(409, { "content-type": "text/html; charset=utf-8" });
        response.end(callbackResponseHtml("error"));
        return;
      }

      const requestUrl = new URL(request.url || "/", flow.redirectUri);
      if (requestUrl.pathname !== callbackPath) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("not found");
        return;
      }

      const parsed = parseCallbackUrl(requestUrl.toString(), { expectedState: flow.state });
      settled = true;
      clearTimeout(timeout);
      response.writeHead(parsed.status === "code" ? 200 : 400, { "content-type": "text/html; charset=utf-8" });
      response.end(callbackResponseHtml(parsed.status === "code" ? "ok" : "error"));
      resolve(parsed);
    });
  });
}

async function defaultTokenClient(request) {
  const response = await fetch(request.url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(request.body),
  });
  let payload = {};
  try {
    const parsedPayload = await response.json();
    payload = isPlainObject(parsedPayload) ? parsedPayload : {};
  } catch {}
  if (!response.ok && !payload.error) {
    payload = {
      ...payload,
      error: `http_${response.status}`,
    };
  }
  return {
    httpStatus: response.status,
    ...payload,
  };
}

function tokenExchangeRequest(flow, options = {}) {
  return {
    url: normalizeString(options.tokenEndpoint, DEFAULT_TOKEN_ENDPOINT),
    body: {
      grant_type: "authorization_code",
      client_id: flow.clientId,
      code: flow.authorizationCode,
      code_verifier: flow.pkceVerifier,
      redirect_uri: flow.redirectUri,
    },
  };
}

function credentialsFromTokenResponse(response, options = {}) {
  const nowMs = Number(options.nowMs ?? Date.now()) || Date.now();
  const accessToken = normalizeString(response.access_token || response.accessToken, "");
  const idToken = normalizeString(response.id_token || response.idToken, "");
  const accountFromAccess = accessToken ? extractChatgptAccountIdFromJwt(accessToken) : null;
  const accountFromId = !accountFromAccess?.accountId && idToken ? extractChatgptAccountIdFromJwt(idToken) : null;
  const credentials = {
    accessToken,
    refreshToken: normalizeString(response.refresh_token || response.refreshToken, ""),
    idToken,
    accountId: accountFromAccess?.accountId || accountFromId?.accountId || "",
    expiresIn: Number(response.expires_in ?? response.expiresIn ?? 0) || 0,
    tokenType: normalizeString(response.token_type || response.tokenType, "Bearer"),
    scope: normalizeString(response.scope, ""),
    updatedAtMs: nowMs,
  };
  if (response.expires_at !== undefined || response.expiresAt !== undefined) {
    credentials.expiresAt = Number(response.expires_at ?? response.expiresAt ?? 0) || 0;
  }
  return credentials;
}

function normalizeCallbackPort(value, fallback = DEFAULT_CALLBACK_PORT) {
  if (value === undefined || value === null || value === "") return fallback;
  const port = Number(value);
  return Number.isFinite(port) && port >= 0 ? port : fallback;
}

class DirectAuthLoginCoordinator {
  constructor(options = {}) {
    const configuredClientId = hasOwn(options, "clientId")
      ? options.clientId
      : normalizeString(process.env.CODEX_REVIEW_SHELL_DIRECT_AUTH_CLIENT_ID, DEFAULT_CLIENT_ID);
    this.authorizationEndpoint = normalizeString(options.authorizationEndpoint, DEFAULT_AUTHORIZATION_ENDPOINT);
    this.tokenEndpoint = normalizeString(options.tokenEndpoint, DEFAULT_TOKEN_ENDPOINT);
    this.clientId = normalizeString(configuredClientId, "");
    this.scope = normalizeString(options.scope, DEFAULT_SCOPE);
    this.callbackHost = normalizeString(options.callbackHost, DEFAULT_CALLBACK_HOST);
    this.callbackPort = normalizeCallbackPort(options.callbackPort, DEFAULT_CALLBACK_PORT);
    this.callbackPath = normalizeString(options.callbackPath, DEFAULT_CALLBACK_PATH);
    this.callbackTimeoutMs = Number(options.callbackTimeoutMs || DEFAULT_CALLBACK_TIMEOUT_MS) || DEFAULT_CALLBACK_TIMEOUT_MS;
    this.extraParams = {
      ...DEFAULT_AUTHORIZATION_EXTRA_PARAMS,
      ...(isPlainObject(options.extraParams) ? options.extraParams : {}),
    };
    this.openExternal = typeof options.openExternal === "function" ? options.openExternal : null;
    this.tokenClient = typeof options.tokenClient === "function" ? options.tokenClient : defaultTokenClient;
    this.currentFlow = null;
  }

  buildFlow(options = {}) {
    const pkceVerifier = normalizeString(options.pkceVerifier, "") || generatePkceVerifier();
    const state = normalizeString(options.state, "") || randomUrlToken("state");
    return {
      schema: DIRECT_AUTH_LOGIN_FLOW_SCHEMA,
      clientId: this.clientId,
      pkceVerifier,
      state,
      redirectUri: normalizeString(options.redirectUri, ""),
      authorizationCode: "",
      startedAt: nowIso(),
      rawTokensExposed: false,
    };
  }

  async exchangeAndStore(flow, controller, options = {}) {
    const tokenResponse = await this.tokenClient(tokenExchangeRequest(flow, { tokenEndpoint: this.tokenEndpoint }));
    const normalized = normalizeTokenResponse(tokenResponse);
    if (normalized.status !== "ok") {
      return safeLoginFailure(normalized.error || "token_exchange_failed", "token_exchange_failed");
    }
    const credentials = credentialsFromTokenResponse(tokenResponse, options);
    const authStatus = controller.writeCredentials(credentials, options);
    const ok = authStatus.status === "authenticated";
    return {
      schema: DIRECT_AUTH_LOGIN_FLOW_SCHEMA,
      ok,
      status: authStatus.status,
      reason: ok ? "" : "token_exchange_incomplete",
      rawTokensExposed: false,
    };
  }

  async beginLogin(options = {}, controller) {
    if (!controller || typeof controller.writeCredentials !== "function") {
      return safeLoginFailure("auth_controller_unavailable");
    }
    if (!this.clientId) {
      return safeLoginFailure("missing_client_id", "not_configured");
    }
    if (this.currentFlow) {
      return safeLoginFailure("login_already_in_progress", "already_in_progress");
    }

    const server = http.createServer();
    const flow = this.buildFlow(options);
    this.currentFlow = flow;

    try {
      await listen(server, this.callbackHost, normalizeCallbackPort(options.callbackPort, this.callbackPort));
      flow.redirectUri = redirectUriFromServer(server, {
        callbackHost: this.callbackHost,
        callbackPath: this.callbackPath,
        callbackPort: this.callbackPort,
      });
      const codeChallenge = pkceChallengeFromVerifier(flow.pkceVerifier);
      const authorizationUrl = buildAuthorizationUrl({
        authorizationEndpoint: this.authorizationEndpoint,
        clientId: this.clientId,
        redirectUri: flow.redirectUri,
        scope: this.scope,
        state: flow.state,
        codeChallenge,
        extraParams: this.extraParams,
      });
      if (this.openExternal) await this.openExternal(authorizationUrl);

      const callbackResult = await waitForCallback(server, flow, {
        callbackTimeoutMs: options.callbackTimeoutMs || this.callbackTimeoutMs,
      });
      if (callbackResult.status !== "code") {
        return safeLoginFailure(callbackResult.reason || callbackResult.status, callbackResult.status);
      }
      flow.authorizationCode = callbackResult.code;
      return await this.exchangeAndStore(flow, controller, options);
    } catch (error) {
      if (error?.code === "EADDRINUSE") {
        return safeLoginFailure("callback_port_unavailable", "port_unavailable");
      }
      return safeLoginFailure(error?.code ? `login_${error.code}` : "login_failed");
    } finally {
      this.currentFlow = null;
      await closeServer(server);
    }
  }
}

function createDirectAuthLoginCoordinator(options = {}) {
  return new DirectAuthLoginCoordinator(options);
}

module.exports = {
  DIRECT_AUTH_LOGIN_FLOW_SCHEMA,
  DirectAuthLoginCoordinator,
  createDirectAuthLoginCoordinator,
  credentialsFromTokenResponse,
  tokenExchangeRequest,
};
