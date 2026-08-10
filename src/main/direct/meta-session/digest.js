"use strict";

const crypto = require("node:crypto");
const { isPlainObject } = require("./ids");

const DIGEST_FIELDS = new Set([
  "digest",
  "artifactDigest",
  "eventBodyDigest",
  "eventDigest",
  "ledgerHeadDigest",
  "pointerSetDigest",
]);

function stableClone(value, options = {}) {
  const omitDigestFields = options.omitDigestFields !== false;
  if (Array.isArray(value)) return value.map((entry) => stableClone(entry, options));
  if (isPlainObject(value)) {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (omitDigestFields && DIGEST_FIELDS.has(key)) continue;
      if (typeof value[key] === "undefined") continue;
      output[key] = stableClone(value[key], options);
    }
    return output;
  }
  return value;
}

function canonicalJson(value, options = {}) {
  return JSON.stringify(stableClone(value, options));
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value || "")).digest("hex")}`;
}

function genericDigest(value) {
  return sha256(`direct-meta-session-generic@1\0${canonicalJson(value)}`);
}

function artifactDigest({ schemaVersion, artifactKind, value }) {
  return sha256([
    "direct-meta-session-artifact@1",
    schemaVersion || "",
    artifactKind || "",
    canonicalJson(value),
  ].join("\0"));
}

function eventBodyDigest(value) {
  return sha256(`direct-meta-session-event-body@1\0${canonicalJson(value)}`);
}

function eventDigest({ previousEventDigest = "", eventBodyDigest: bodyDigest = "" }) {
  return sha256(["direct-meta-session-event@1", previousEventDigest || "", bodyDigest || ""].join("\0"));
}

function pointerSetDigest(value) {
  return sha256(`direct-meta-session-pointer-set@1\0${canonicalJson(value)}`);
}

module.exports = {
  artifactDigest,
  canonicalJson,
  eventBodyDigest,
  eventDigest,
  genericDigest,
  pointerSetDigest,
  sha256,
  stableClone,
};
