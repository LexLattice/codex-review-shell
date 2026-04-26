"use strict";

const crypto = require("node:crypto");

const DEFAULT_AUTHORIZATION_ENDPOINT = "https://auth.openai.com/oauth/authorize";
const DEFAULT_TOKEN_ENDPOINT = "https://auth.openai.com/oauth/token";
const DEFAULT_REDIRECT_URI = "http://localhost:1455/auth/callback";
const DEFAULT_SCOPE = "openid profile email offline_access";
const DEFAULT_CODE_CHALLENGE_METHOD = "S256";

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
  for (const [key, value] of Object.entries(options.extraParams || {})) {
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
  return {
    status: "code",
    code: parsed.searchParams.get("code") || "",
    state,
  };
}

function parseManualCodePaste(input, options = {}) {
  const text = requireString(input, "manual code paste");
  if (/^https?:\/\//i.test(text)) return parseCallbackUrl(text, options);
  const queryText = text.startsWith("?") || text.includes("=") ? text.replace(/^[?#]/, "") : "";
  if (queryText) {
    return parseCallbackUrl(`${DEFAULT_REDIRECT_URI}?${queryText}`, options);
  }
  return {
    status: "code",
    code: text,
    state: "",
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

module.exports = {
  DEFAULT_AUTHORIZATION_ENDPOINT,
  DEFAULT_CODE_CHALLENGE_METHOD,
  DEFAULT_REDIRECT_URI,
  DEFAULT_SCOPE,
  DEFAULT_TOKEN_ENDPOINT,
  base64UrlEncode,
  buildAuthorizationUrl,
  generatePkceVerifier,
  normalizeTokenResponse,
  parseCallbackUrl,
  parseManualCodePaste,
  pkceChallengeFromVerifier,
};
