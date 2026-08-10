"use strict";

const crypto = require("node:crypto");

const DEFAULT_AUTHORIZATION_ENDPOINT = "https://auth.openai.com/oauth/authorize";
const DEFAULT_TOKEN_ENDPOINT = "https://auth.openai.com/oauth/token";
const DEFAULT_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const DEFAULT_REDIRECT_URI = "http://localhost:1455/auth/callback";
const DEFAULT_SCOPE = "openid profile email offline_access";
const DEFAULT_CODE_CHALLENGE_METHOD = "S256";
const DEFAULT_AUTHORIZATION_EXTRA_PARAMS = Object.freeze({
  id_token_add_organizations: "true",
  codex_cli_simplified_flow: "true",
  originator: "codex-review-shell",
});
const CHATGPT_ACCOUNT_CLAIM_PATH = "https://api.openai.com/auth";
const REDACTED_ACCOUNT_ID = "[REDACTED:account-id]";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
}

function base64UrlEncode(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/[+]/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecodeText(value) {
  const text = requireString(value, "base64url value");
  if (!/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1) {
    throw new Error("base64url value is malformed");
  }
  const normalized = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function generatePkceVerifier(bytes = 32) {
  return base64UrlEncode(crypto.randomBytes(bytes));
}

function pkceChallengeFromVerifier(verifier) {
  const text = requireString(verifier, "PKCE verifier");
  return base64UrlEncode(crypto.createHash("sha256").update(text).digest());
}

function buildAuthorizationUrl(options = {}) {
  const endpoint = options.authorizationEndpoint || DEFAULT_AUTHORIZATION_ENDPOINT;
  const clientId = requireString(options.clientId, "clientId");
  const state = requireString(options.state, "state");
  const codeChallenge = requireString(options.codeChallenge, "codeChallenge");
  const redirectUri = options.redirectUri || DEFAULT_REDIRECT_URI;
  const scope = options.scope || DEFAULT_SCOPE;
  const url = new URL(endpoint);
  const params = [
    ["response_type", "code"],
    ["client_id", clientId],
    ["redirect_uri", redirectUri],
    ["scope", scope],
    ["state", state],
    ["code_challenge", codeChallenge],
    ["code_challenge_method", options.codeChallengeMethod || DEFAULT_CODE_CHALLENGE_METHOD],
  ];
  for (const [key, value] of params) {
    url.searchParams.set(key, String(value));
  }
  for (const [key, value] of Object.entries(isPlainObject(options.extraParams) ? options.extraParams : {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function parseCallbackUrl(callbackUrl, options = {}) {
  const parsed = new URL(requireString(callbackUrl, "callbackUrl"));
  const state = parsed.searchParams.get("state") || "";
  const expectedState = options.expectedState || "";
  if (expectedState && state !== expectedState) {
    return {
      status: "state_mismatch",
      state,
      expectedState,
      hasCode: Boolean(parsed.searchParams.get("code")),
      error: parsed.searchParams.get("error") || "",
      errorDescription: parsed.searchParams.get("error_description") || "",
    };
  }
  const error = parsed.searchParams.get("error") || "";
  if (error) {
    return {
      status: "error",
      state,
      error,
      errorDescription: parsed.searchParams.get("error_description") || "",
    };
  }
  const code = parsed.searchParams.get("code") || "";
  if (!code) {
    return {
      status: "missing_code",
      state,
    };
  }
  return {
    status: "code",
    code,
    state,
  };
}

function looksLikeOAuthQueryText(text) {
  const queryText = text.replace(/^[?#]/, "");
  const params = new URLSearchParams(queryText);
  return params.has("code") || params.has("error") || params.has("state");
}

function parseManualCodePaste(input, options = {}) {
  const text = requireString(input, "manual code paste");
  if (/^https?:\/\//i.test(text)) return parseCallbackUrl(text, options);
  const queryText = text.startsWith("?") || looksLikeOAuthQueryText(text) ? text.replace(/^[?#]/, "") : "";
  if (queryText) {
    return parseCallbackUrl(`${DEFAULT_REDIRECT_URI}?${queryText}`, options);
  }
  return {
    status: "code",
    code: text,
    state: "",
  };
}

function buildTokenExchangeRequestShape(options = {}) {
  const clientId = requireString(options.clientId, "clientId");
  const authorizationCode = requireString(options.authorizationCode || options.code, "authorizationCode");
  const pkceVerifier = requireString(options.pkceVerifier || options.codeVerifier, "pkceVerifier");
  const redirectUri = options.redirectUri || DEFAULT_REDIRECT_URI;
  const url = new URL(options.tokenEndpoint || DEFAULT_TOKEN_ENDPOINT).toString();
  return {
    url,
    method: "POST",
    contentType: "application/x-www-form-urlencoded",
    grantType: "authorization_code",
    clientId,
    redirectUri,
    hasAuthorizationCode: Boolean(authorizationCode),
    hasPkceVerifier: Boolean(pkceVerifier),
    bodyFieldOrder: ["grant_type", "client_id", "code", "code_verifier", "redirect_uri"],
  };
}

function buildTokenRefreshRequestShape(options = {}) {
  const clientId = requireString(options.clientId, "clientId");
  const refreshToken = requireString(options.refreshToken || options.refresh, "refreshToken");
  const url = new URL(options.tokenEndpoint || DEFAULT_TOKEN_ENDPOINT).toString();
  return {
    url,
    method: "POST",
    contentType: "application/x-www-form-urlencoded",
    grantType: "refresh_token",
    clientId,
    hasRefreshToken: Boolean(refreshToken),
    bodyFieldOrder: ["grant_type", "refresh_token", "client_id"],
  };
}

function decodeJwtPayload(jwt) {
  const text = requireString(jwt, "JWT");
  const parts = text.split(".");
  if (parts.length !== 3) {
    return {
      status: "invalid_jwt",
      payload: null,
      reason: "JWT must have three segments.",
    };
  }
  try {
    const payload = JSON.parse(base64UrlDecodeText(parts[1]));
    if (!isPlainObject(payload)) throw new Error("payload is not an object");
    return {
      status: "ok",
      payload,
      reason: "",
    };
  } catch {
    return {
      status: "invalid_jwt",
      payload: null,
      reason: "JWT payload is not valid base64url JSON.",
    };
  }
}

function redactAccountId(accountId) {
  const text = String(accountId || "").trim();
  if (!text) return "";
  if (text === REDACTED_ACCOUNT_ID) return text;
  return REDACTED_ACCOUNT_ID;
}

function extractChatgptAccountIdFromJwt(jwt, options = {}) {
  const claimPath = options.claimPath || CHATGPT_ACCOUNT_CLAIM_PATH;
  const redact = options.redact !== false;
  const decoded = decodeJwtPayload(jwt);
  if (decoded.status !== "ok") {
    return {
      status: decoded.status,
      accountId: "",
      claimPath,
      reason: decoded.reason,
    };
  }
  const authClaim = decoded.payload[claimPath];
  const accountId = isPlainObject(authClaim) ? authClaim.chatgpt_account_id : "";
  const projectedAccountId = redact ? redactAccountId(accountId) : String(accountId || "");
  if (!projectedAccountId) {
    return {
      status: "missing_account_id",
      accountId: "",
      claimPath,
    };
  }
  return {
    status: "ok",
    accountId: projectedAccountId,
    claimPath,
  };
}

function normalizeTokenResponse(response = {}) {
  if (!isPlainObject(response)) throw new Error("Token response must be a JSON object.");
  if (response.error) {
    return {
      status: "error",
      error: String(response.error || ""),
      errorDescription: String(response.error_description || response.errorDescription || ""),
      retryable: Boolean(response.retryable),
    };
  }
  return {
    status: "ok",
    tokenType: String(response.token_type || response.tokenType || "Bearer"),
    expiresIn: Number(response.expires_in ?? response.expiresIn ?? 0) || 0,
    scope: String(response.scope || ""),
    hasAccessToken: Boolean(response.access_token || response.accessToken),
    hasRefreshToken: Boolean(response.refresh_token || response.refreshToken),
    hasIdToken: Boolean(response.id_token || response.idToken),
  };
}

function projectCredentialStatus(credentials = {}, options = {}) {
  if (!isPlainObject(credentials)) throw new Error("Credentials must be a JSON object.");
  const nowMs = Number(options.nowMs ?? credentials.nowMs ?? Date.now()) || 0;
  const expiresAt = Number(credentials.expiresAt ?? credentials.expires ?? 0) || 0;
  const hasAccessToken = Boolean(credentials.accessToken || credentials.access || credentials.hasAccessToken);
  const hasRefreshToken = Boolean(credentials.refreshToken || credentials.refresh || credentials.hasRefreshToken);
  const accountId = redactAccountId(credentials.accountId || credentials.chatgptAccountId || "");
  const expiresInMs = expiresAt > 0 && nowMs > 0 ? Math.max(0, expiresAt - nowMs) : 0;
  let status = "unauthenticated";
  if (hasAccessToken || hasRefreshToken) {
    status = expiresAt > 0 && nowMs > 0 && expiresAt <= nowMs ? "expired" : "authenticated";
  }
  return {
    status,
    accountId,
    expiresAt,
    expiresInMs,
    hasAccessToken,
    hasRefreshToken,
    rawTokensExposed: false,
  };
}

function projectRefreshFailureState(input = {}) {
  if (!isPlainObject(input)) throw new Error("Refresh failure input must be a JSON object.");
  const previousStatus = projectCredentialStatus(input.previous || {}, { nowMs: input.nowMs });
  const error = isPlainObject(input.error) ? input.error : {};
  return {
    ...previousStatus,
    status: "refresh_failed",
    error: String(error.error || error.code || "refresh_failed"),
    errorDescription: String(error.errorDescription || error.error_description || ""),
    retryable: Boolean(error.retryable),
    preservesRefreshToken: previousStatus.hasRefreshToken,
    rawTokensExposed: false,
  };
}

module.exports = {
  CHATGPT_ACCOUNT_CLAIM_PATH,
  DEFAULT_AUTHORIZATION_ENDPOINT,
  DEFAULT_AUTHORIZATION_EXTRA_PARAMS,
  DEFAULT_CLIENT_ID,
  DEFAULT_CODE_CHALLENGE_METHOD,
  DEFAULT_REDIRECT_URI,
  DEFAULT_SCOPE,
  DEFAULT_TOKEN_ENDPOINT,
  REDACTED_ACCOUNT_ID,
  base64UrlEncode,
  base64UrlDecodeText,
  buildTokenExchangeRequestShape,
  buildTokenRefreshRequestShape,
  buildAuthorizationUrl,
  decodeJwtPayload,
  extractChatgptAccountIdFromJwt,
  generatePkceVerifier,
  normalizeTokenResponse,
  parseCallbackUrl,
  parseManualCodePaste,
  pkceChallengeFromVerifier,
  projectCredentialStatus,
  projectRefreshFailureState,
};
