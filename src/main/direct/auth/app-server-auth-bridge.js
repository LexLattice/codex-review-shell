"use strict";

const {
  CHATGPT_ACCOUNT_CLAIM_PATH,
  decodeJwtPayload,
  extractChatgptAccountIdFromJwt,
} = require("./oauth-shapes");

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function claimObjectFromAccessToken(accessToken) {
  const decoded = decodeJwtPayload(accessToken);
  const claim = decoded.status === "ok" ? decoded.payload?.[CHATGPT_ACCOUNT_CLAIM_PATH] : null;
  return claim && typeof claim === "object" && !Array.isArray(claim) ? claim : {};
}

function rawAccountIdFromCredentials(credentials = {}) {
  const stored = normalizeString(credentials.accountId || credentials.chatgptAccountId, "");
  if (stored && !stored.startsWith("[REDACTED:")) return stored;
  const accessToken = normalizeString(credentials.accessToken || credentials.access || credentials.access_token, "");
  if (!accessToken) return "";
  const extracted = extractChatgptAccountIdFromJwt(accessToken, { redact: false });
  return extracted.status === "ok" ? extracted.accountId : "";
}

function planTypeFromCredentials(credentials = {}) {
  const stored = normalizeString(credentials.chatgptPlanType || credentials.planType, "");
  if (stored) return stored;
  const accessToken = normalizeString(credentials.accessToken || credentials.access || credentials.access_token, "");
  if (!accessToken) return null;
  const claim = claimObjectFromAccessToken(accessToken);
  return normalizeString(claim.chatgpt_plan_type || claim.plan_type || claim.planType, "") || null;
}

function codexAuthTokensFromCredentials(credentials = {}, options = {}) {
  const accessToken = normalizeString(credentials.accessToken || credentials.access || credentials.access_token, "");
  if (!accessToken) {
    return { ok: false, reason: "missing_access_token" };
  }
  const chatgptAccountId = rawAccountIdFromCredentials(credentials);
  if (!chatgptAccountId) {
    return { ok: false, reason: "missing_chatgpt_account_id" };
  }
  return {
    ok: true,
    tokens: {
      ...(options.includeType === false ? {} : { type: "chatgptAuthTokens" }),
      accessToken,
      chatgptAccountId,
      chatgptPlanType: planTypeFromCredentials(credentials),
    },
  };
}

module.exports = {
  codexAuthTokensFromCredentials,
  planTypeFromCredentials,
  rawAccountIdFromCredentials,
};
