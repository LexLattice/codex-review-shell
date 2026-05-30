"use strict";

const crypto = require("node:crypto");

function cleanString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function safeHostname(parsed) {
  return String(parsed?.hostname || "").replace(/^\[|\]$/g, "").toLowerCase();
}

function isLoopbackHost(hostname) {
  const host = String(hostname || "").replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;
  const octets = host.split(".");
  if (octets.length !== 4 || octets[0] !== "127") return false;
  return octets.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function securityPostureFor(parsed) {
  if (parsed.protocol === "https:") return "https";
  if (parsed.protocol === "http:" && isLoopbackHost(safeHostname(parsed))) return "loopback_http";
  return "unknown";
}

function displayUrlFor(parsed) {
  const pathname = parsed.pathname || "/";
  const search = parsed.search ? "?..." : "";
  const hash = parsed.hash ? "#..." : "";
  return `${parsed.origin}${pathname}${search}${hash}`;
}

function historyEntryId(value) {
  return `web_${crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16)}`;
}

function navigationDecision(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || ""));
  } catch {
    return { action: "block", reason: "invalid_url" };
  }

  if (parsed.username || parsed.password) {
    return { action: "block", reason: "embedded_credentials" };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { action: "block", reason: "unsupported_protocol" };
  }

  if (parsed.protocol === "http:" && !isLoopbackHost(safeHostname(parsed))) {
    return { action: "block", reason: "insecure_http" };
  }

  const displayUrl = displayUrlFor(parsed);
  return {
    action: "allow",
    normalizedUrl: parsed.toString(),
    displayUrl,
    historyDisplayUrl: displayUrl,
    historyId: historyEntryId(parsed.toString()),
    origin: parsed.origin,
    securityPosture: securityPostureFor(parsed),
  };
}

function blockedMessage(reason) {
  const labels = {
    unsupported_protocol: "Blocked: unsupported protocol",
    insecure_http: "Blocked: non-loopback HTTP is disabled",
    embedded_credentials: "Blocked: URL contains embedded credentials",
    invalid_url: "Blocked: invalid URL",
    opaque_origin: "Blocked: opaque origin",
    policy_denied: "Blocked by middle Web policy",
    download_blocked: "Blocked: downloads are disabled in v0",
    popup_blocked: "Blocked: navigation attempted to open a popup",
  };
  return labels[reason] || labels.policy_denied;
}

module.exports = {
  blockedMessage,
  cleanString,
  historyEntryId,
  isLoopbackHost,
  navigationDecision,
};
