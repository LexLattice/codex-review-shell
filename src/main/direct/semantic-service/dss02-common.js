"use strict";

/* Shared, deliberately boring primitives for the DSS-0.2 durable kernel. */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  canonicalJson,
  digestFor,
  sha256,
  fail,
  isPlainObject,
  requiredId,
  requiredString,
  requiredDigest,
  assertExactObject,
  deepFreeze,
} = require("./canonical");

const DSS02_SCHEMA = "direct_semantic_service_dss02@1";
const DSS02_PROTOCOL = "direct-semantic-protocol@1";
const DSS02_EVENT_DOMAIN = "DirectSemanticService.Event.v1";
const DSS02_GLOBAL_CUSTODY_DOMAIN = "DirectSemanticService.GlobalCustody.v1";
const DSS02_PROOF_DOMAIN = "DirectSemanticService.AuthorizationProof.v1";
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_JSON_DEPTH = 32;
const EXECUTION_WORDS = /(?:microresult|micro_result|evaluation(?:[_-]?(?:admitted|completed|started|result))?|execution[_-]?(?:started|completed|admitted|result)|worker[_-]?(?:started|completed|run)|semantic[_-]?completion|job[_-]?completion|sealed[_-]?(?:result|output)|model[_-]?output)/i;

class Dss02Error extends Error {
  constructor(code, message = code, details = undefined) {
    super(`${code}: ${message}`);
    this.name = "Dss02Error";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function dss02Fail(code, message, details) {
  throw new Dss02Error(code, message, details);
}

function ensureObject(value, code = "DSS02_OBJECT_INVALID") {
  if (!isPlainObject(value)) dss02Fail(code, "expected a plain object");
  return value;
}

function ensureArray(value, code = "DSS02_ARRAY_INVALID") {
  if (!Array.isArray(value)) dss02Fail(code, "expected an array");
  return value;
}

function exactObject(value, fields, code = "DSS02_CLOSED_OBJECT") {
  ensureObject(value, code);
  try {
    assertExactObject(value, fields, code);
  } catch (error) {
    dss02Fail(code, error.message);
  }
  return value;
}

function boundedString(value, label, maximum = 4096) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0 || value.length > maximum) {
    dss02Fail("DSS02_STRING_BOUNDS", `${label} is not a bounded string`);
  }
  return value;
}

function immutableId(value, label = "id") {
  try {
    return requiredId(value, label);
  } catch (error) {
    dss02Fail("DSS02_ID_INVALID", `${label} is not a canonical immutable id`);
  }
}

function immutableDigest(value, label = "digest") {
  try {
    return requiredDigest(value, label);
  } catch (error) {
    dss02Fail("DSS02_DIGEST_INVALID", `${label} is not a sha256 digest`);
  }
}

function isoNow(value = undefined) {
  const candidate = value === undefined ? new Date() : (value instanceof Date ? value : new Date(value));
  if (!Number.isFinite(candidate.getTime())) dss02Fail("DSS02_TIME_INVALID");
  return candidate.toISOString();
}

function epochMs(value) {
  const result = new Date(value).getTime();
  if (!Number.isFinite(result)) dss02Fail("DSS02_TIME_INVALID");
  return result;
}

function isExpired(expiresAt, now = new Date()) {
  return epochMs(expiresAt) <= (now instanceof Date ? now.getTime() : epochMs(now));
}

function randomRef(prefix = "ref") {
  if (!/^[A-Za-z0-9._-]+$/.test(prefix)) dss02Fail("DSS02_REF_PREFIX_INVALID");
  return `${prefix}-${crypto.randomBytes(16).toString("hex")}`;
}

function randomNonce(bytes = 32) {
  if (!Number.isSafeInteger(bytes) || bytes < 32 || bytes > 4096) dss02Fail("DSS02_NONCE_BOUNDS");
  return crypto.randomBytes(bytes).toString("base64url");
}

function randomSecret(bytes = 32) {
  if (!Number.isSafeInteger(bytes) || bytes < 32) dss02Fail("DSS02_SECRET_BOUNDS");
  return crypto.randomBytes(bytes);
}

function digestObject(domain, value) {
  return digestFor(domain, value);
}

function digestBytes(domain, bytes) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  return sha256(Buffer.concat([Buffer.from(`${domain}\0`, "utf8"), bytes]));
}

function canonicalBytes(value) {
  return Buffer.from(canonicalJson(value), "utf8");
}

function parseJsonStrict(text, { maximumBytes = MAX_JSON_BYTES, maximumDepth = MAX_JSON_DEPTH } = {}) {
  if (typeof text !== "string" && !Buffer.isBuffer(text)) dss02Fail("DSS02_JSON_TYPE");
  const source = Buffer.isBuffer(text) ? text.toString("utf8") : text;
  if (Buffer.byteLength(source, "utf8") > maximumBytes) dss02Fail("DSS02_JSON_TOO_LARGE");
  let index = 0;
  const length = source.length;
  function whitespace() {
    while (index < length && /[\u0009\u000a\u000d\u0020]/.test(source[index])) index += 1;
  }
  function error(message) {
    dss02Fail("DSS02_JSON_INVALID", message, { offset: index });
  }
  function stringValue() {
    if (source[index] !== '"') error("expected string");
    const start = index;
    index += 1;
    let escaped = false;
    while (index < length) {
      const character = source[index];
      if (escaped) {
        escaped = false;
        index += 1;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        index += 1;
        continue;
      }
      if (character === '"') {
        index += 1;
        try {
          return JSON.parse(source.slice(start, index));
        } catch (parseError) {
          error("invalid string escape");
        }
      }
      if (character < " ") error("control character in string");
      index += 1;
    }
    error("unterminated string");
  }
  function value(depth) {
    if (depth > maximumDepth) dss02Fail("DSS02_JSON_DEPTH");
    whitespace();
    const character = source[index];
    if (character === '"') return stringValue();
    if (character === "{") {
      index += 1;
      const output = Object.create(null);
      const keys = new Set();
      whitespace();
      if (source[index] === "}") {
        index += 1;
        return output;
      }
      while (index < length) {
        whitespace();
        const key = stringValue();
        if (keys.has(key)) dss02Fail("DSS02_JSON_DUPLICATE_KEY", `duplicate key ${key}`);
        keys.add(key);
        whitespace();
        if (source[index] !== ":") error("expected colon");
        index += 1;
        output[key] = value(depth + 1);
        whitespace();
        if (source[index] === "}") {
          index += 1;
          return output;
        }
        if (source[index] !== ",") error("expected comma");
        index += 1;
      }
      error("unterminated object");
    }
    if (character === "[") {
      index += 1;
      const output = [];
      whitespace();
      if (source[index] === "]") {
        index += 1;
        return output;
      }
      while (index < length) {
        output.push(value(depth + 1));
        whitespace();
        if (source[index] === "]") {
          index += 1;
          return output;
        }
        if (source[index] !== ",") error("expected comma");
        index += 1;
      }
      error("unterminated array");
    }
    const literal = source.slice(index);
    for (const [token, result] of [["true", true], ["false", false], ["null", null]]) {
      if (literal.startsWith(token)) {
        index += token.length;
        return result;
      }
    }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(literal);
    if (number) {
      index += number[0].length;
      const parsed = Number(number[0]);
      if (!Number.isFinite(parsed)) dss02Fail("DSS02_JSON_NUMBER");
      return parsed;
    }
    error("unexpected token");
  }
  const result = value(0);
  whitespace();
  if (index !== length) error("trailing data");
  return result;
}

function parseStoredJson(text, label = "stored JSON") {
  try {
    return parseJsonStrict(text);
  } catch (error) {
    if (error instanceof Dss02Error) throw error;
    dss02Fail("DSS02_STORE_JSON_INVALID", label);
  }
}

function cloneJson(value) {
  return parseJsonStrict(canonicalJson(value));
}

function safeJson(value, { maximumBytes = 64 * 1024, maximumDepth = 12 } = {}) {
  const scrub = (input, depth) => {
    if (depth > maximumDepth) dss02Fail("DSS02_SAFE_PROJECTION_DEPTH");
    if (input === null || typeof input === "string" || typeof input === "boolean" || typeof input === "number") return input;
    if (Array.isArray(input)) return input.map((entry) => scrub(entry, depth + 1));
    if (!isPlainObject(input)) dss02Fail("DSS02_SAFE_PROJECTION_VALUE");
    const result = {};
    for (const [key, entry] of Object.entries(input)) {
      if (/(?:secret|private|credential|signature|key|path|socket|quarantine|raw|payloadBytes)/i.test(key)) continue;
      result[key] = scrub(entry, depth + 1);
    }
    return result;
  };
  const output = scrub(value, 0);
  if (Buffer.byteLength(canonicalJson(output), "utf8") > maximumBytes) dss02Fail("DSS02_SAFE_PROJECTION_TOO_LARGE");
  return output;
}

function assertNoExecutionClaim(value, label = "value") {
  const text = canonicalJson(value);
  if (EXECUTION_WORDS.test(text)) dss02Fail("DSS02_EXECUTION_BOUNDARY", `${label} claims a later-tranche operation`);
}

function checkedInteger(value, label = "counter", minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) dss02Fail("DSS02_SAFE_INTEGER", label);
  return value;
}

function checkedAdd(left, right, label = "counter") {
  checkedInteger(left, label);
  checkedInteger(right, label);
  if (left > Number.MAX_SAFE_INTEGER - right) dss02Fail("DSS02_COUNTER_OVERFLOW", label);
  return left + right;
}

function checkedSubtract(left, right, label = "counter") {
  checkedInteger(left, label);
  checkedInteger(right, label);
  if (right > left) dss02Fail("DSS02_COUNTER_UNDERFLOW", label);
  return left - right;
}

function ensureDirectory(directory, mode = 0o700) {
  fs.mkdirSync(directory, { recursive: true, mode });
  try { fs.chmodSync(directory, mode); } catch (_) { /* best effort on Windows */ }
}

function fsyncDirectory(directory) {
  try {
    const fd = fs.openSync(directory, "r");
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  } catch (_) { /* directory fsync is unavailable on some filesystems */ }
}

function atomicWrite(filePath, bytes, mode = 0o600) {
  const directory = path.dirname(filePath);
  ensureDirectory(directory);
  const temporary = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`);
  const fd = fs.openSync(temporary, "wx", mode);
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(temporary, mode);
  fs.renameSync(temporary, filePath);
  fsyncDirectory(directory);
}

function deriveProfilePaths(profileRoot) {
  if (typeof profileRoot !== "string" || !path.isAbsolute(profileRoot)) dss02Fail("DSS02_PROFILE_ROOT_INVALID");
  const root = path.resolve(profileRoot);
  return Object.freeze({
    profileRoot: root,
    socket: path.join(root, "direct-semanticd.sock"),
    database: path.join(root, "direct-semanticd.sqlite"),
    lock: path.join(root, "direct-semanticd.generation.lock"),
    cas: path.join(root, "cas"),
    quarantine: path.join(root, "quarantine"),
    keyring: path.join(root, "keyring"),
    bootstrap: path.join(root, "bootstrap"),
    recovery: path.join(root, "recovery"),
  });
}

function protectPrivateKey(keyObject) {
  if (!keyObject) dss02Fail("DSS02_PRIVATE_KEY_MISSING");
  return keyObject;
}

function exportPublicKey(publicKey) {
  const key = publicKey && publicKey.type === "public" ? publicKey : crypto.createPublicKey(publicKey);
  return key.export({ type: "spki", format: "der" }).toString("base64url");
}

function importPublicKey(encoded) {
  if (typeof encoded !== "string" || encoded.length === 0) dss02Fail("DSS02_PUBLIC_KEY_INVALID");
  try { return crypto.createPublicKey({ key: Buffer.from(encoded, "base64url"), type: "spki", format: "der" }); }
  catch (error) { dss02Fail("DSS02_PUBLIC_KEY_INVALID"); }
}

function publicKeyFingerprint(publicKey) {
  const encoded = typeof publicKey === "string" ? Buffer.from(publicKey, "base64url") : (publicKey && publicKey.type === "public" ? publicKey.export({ type: "spki", format: "der" }) : crypto.createPublicKey(publicKey).export({ type: "spki", format: "der" }));
  return sha256(encoded);
}

function signEd25519(privateKey, bytes) {
  try { return crypto.sign(null, bytes, protectPrivateKey(privateKey)).toString("base64url"); }
  catch (error) { dss02Fail("DSS02_SIGNATURE_FAILED"); }
}

function verifyEd25519(publicKey, bytes, signature) {
  try { return crypto.verify(null, bytes, publicKey, Buffer.from(signature, "base64url")); }
  catch (error) { return false; }
}

function hmacSha256(key, value) {
  return `sha256:${crypto.createHmac("sha256", key).update(value).digest("hex")}`;
}

function validateTranscriptLength(challengeLength, authorityLength) {
  const challenge = Number(challengeLength);
  const authority = Number(authorityLength);
  if (!Number.isSafeInteger(challenge) || !Number.isSafeInteger(authority) || challenge < 0 || authority < 0 || challenge > 0xffffffff || authority > 0xffffffff) {
    dss02Fail("DSS02_TRANSCRIPT_LENGTH_OVERFLOW");
  }
  return Object.freeze({ challengeLength: challenge, authorityLength: authority });
}

function transcriptBytes(challengeCanonical, authorityCanonical) {
  const domain = Buffer.from(DSS02_PROOF_DOMAIN, "ascii");
  const challengeLength = typeof challengeCanonical === "string" ? Buffer.byteLength(challengeCanonical, "utf8") : Number(challengeCanonical?.byteLength ?? challengeCanonical?.length);
  const authorityLength = typeof authorityCanonical === "string" ? Buffer.byteLength(authorityCanonical, "utf8") : Number(authorityCanonical?.byteLength ?? authorityCanonical?.length);
  validateTranscriptLength(challengeLength, authorityLength);
  const challenge = Buffer.from(challengeCanonical, "utf8");
  const authority = Buffer.from(authorityCanonical, "utf8");
  validateTranscriptLength(challenge.length, authority.length);
  const length = (value) => { const output = Buffer.alloc(4); output.writeUInt32BE(value, 0); return output; };
  return Buffer.concat([domain, length(challenge.length), challenge, length(authority.length), authority]);
}

function createKeyPair() {
  return crypto.generateKeyPairSync("ed25519");
}

module.exports = {
  DSS02_SCHEMA,
  DSS02_PROTOCOL,
  DSS02_EVENT_DOMAIN,
  DSS02_GLOBAL_CUSTODY_DOMAIN,
  DSS02_PROOF_DOMAIN,
  MAX_JSON_BYTES,
  MAX_JSON_DEPTH,
  Dss02Error,
  dss02Fail,
  ensureObject,
  ensureArray,
  exactObject,
  boundedString,
  immutableId,
  immutableDigest,
  isoNow,
  epochMs,
  isExpired,
  randomRef,
  randomNonce,
  randomSecret,
  digestObject,
  digestBytes,
  canonicalBytes,
  parseJsonStrict,
  parseStoredJson,
  cloneJson,
  safeJson,
  assertNoExecutionClaim,
  checkedInteger,
  checkedAdd,
  checkedSubtract,
  ensureDirectory,
  fsyncDirectory,
  atomicWrite,
  deriveProfilePaths,
  exportPublicKey,
  importPublicKey,
  publicKeyFingerprint,
  signEd25519,
  verifyEd25519,
  hmacSha256,
  validateTranscriptLength,
  transcriptBytes,
  createKeyPair,
  canonicalJson,
  sha256,
  deepFreeze,
};
