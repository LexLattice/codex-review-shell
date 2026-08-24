"use strict";

/**
 * Canonical primitives for the Direct Semantic Service contract ABI.
 *
 * The service deliberately does not use JSON.stringify directly for identity
 * or digest material.  Canonical JSON here is a small, closed JSON dialect:
 * plain objects, arrays, strings, finite numbers, booleans and null only.
 * Object keys are emitted in UTF-16 lexicographic order, array order is
 * significant, and undefined/non-finite/cyclic values are rejected.
 */

const crypto = require("node:crypto");

const CANONICAL_DOMAIN = "direct-semantic-service-canonical-json@1";
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
// Contract identifiers are opaque, but must be portable and unambiguous.
// Colons support values such as local_user:1000 and revision namespaces.
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,200}$/;
const MUTABLE_SELECTOR_PATTERN = /(?:^|[/:#@])(latest|current|head|tip|default|main|master|develop|development|working|workspace|mutable|branch)(?:$|[/:#@])/i;
const WILDCARD_SELECTOR_PATTERN = /[*?]/;

class CanonicalError extends TypeError {
  constructor(code, message, path = "$") {
    super(`${code}${path ? ` at ${path}` : ""}: ${message}`);
    this.name = "CanonicalError";
    this.code = code;
    this.path = path;
  }
}

function fail(code, message, path) {
  throw new CanonicalError(code, message, path);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownEnumerableSymbols(value) {
  return Object.getOwnPropertySymbols(value).filter((symbol) =>
    Object.prototype.propertyIsEnumerable.call(value, symbol));
}

function assertDataProperty(value, key, path) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
    fail("DSS_CANONICAL_ACCESSOR", "accessor properties are not canonical JSON data", path);
  }
}

function canonicalNumber(value, path) {
  if (!Number.isFinite(value)) {
    fail("DSS_CANONICAL_NONFINITE_NUMBER", "number must be finite", path);
  }
  if (Object.is(value, -0)) {
    fail("DSS_CANONICAL_NEGATIVE_ZERO", "negative zero is not canonical", path);
  }
  const encoded = JSON.stringify(value);
  // JSON.stringify can only return undefined for unsupported values, which is
  // guarded above.  Keep the check explicit in case the runtime changes.
  if (typeof encoded !== "string") {
    fail("DSS_CANONICAL_NUMBER", "number could not be encoded", path);
  }
  return encoded;
}

function canonicalizeValue(value, path, stack) {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return canonicalNumber(value, path);
    case "undefined":
      fail("DSS_CANONICAL_UNDEFINED", "undefined is not part of canonical JSON", path);
      break;
    case "bigint":
      fail("DSS_CANONICAL_BIGINT", "bigint is not part of canonical JSON", path);
      break;
    case "function":
    case "symbol":
      fail("DSS_CANONICAL_UNSUPPORTED_TYPE", "value is not JSON data", path);
      break;
    case "object":
      break;
    default:
      fail("DSS_CANONICAL_UNSUPPORTED_TYPE", "value is not JSON data", path);
  }

  if (stack.has(value)) {
    fail("DSS_CANONICAL_CYCLE", "cyclic values are not canonical JSON", path);
  }
  stack.add(value);
  let encoded;
  try {
    if (Array.isArray(value)) {
      const symbols = Object.getOwnPropertySymbols(value);
      if (symbols.length > 0) {
        fail("DSS_CANONICAL_SYMBOL_KEY", "symbol keys are not canonical JSON", path);
      }
      // JSON arrays have only contiguous numeric members.  Reject sparse
      // arrays and custom enumerable properties instead of silently dropping
      // them as JSON.stringify would.
      const keys = Object.keys(value);
      for (const key of Object.getOwnPropertyNames(value)) {
        if (key !== "length" && !Object.prototype.propertyIsEnumerable.call(value, key)) {
          fail("DSS_CANONICAL_NONENUMERABLE", "non-enumerable array properties are not canonical JSON", `${path}.${key}`);
        }
      }
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          fail("DSS_CANONICAL_SPARSE_ARRAY", "sparse arrays are not canonical JSON", `${path}[${index}]`);
        }
        assertDataProperty(value, String(index), `${path}[${index}]`);
      }
      for (const key of keys) {
        if (!/^0$|^[1-9][0-9]*$/.test(key) || Number(key) >= value.length) {
          fail("DSS_CANONICAL_ARRAY_PROPERTY", "array has a non-index enumerable property", `${path}.${key}`);
        }
      }
      const entries = [];
      for (let index = 0; index < value.length; index += 1) {
        entries.push(canonicalizeValue(value[index], `${path}[${index}]`, stack));
      }
      encoded = `[${entries.join(",")}]`;
    } else {
      if (!isPlainObject(value)) {
        fail("DSS_CANONICAL_NON_PLAIN_OBJECT", "only plain objects are canonical JSON", path);
      }
      const symbols = Object.getOwnPropertySymbols(value);
      if (symbols.length > 0) {
        fail("DSS_CANONICAL_SYMBOL_KEY", "symbol keys are not canonical JSON", path);
      }
      for (const key of Object.getOwnPropertyNames(value)) {
        if (!Object.prototype.propertyIsEnumerable.call(value, key)) {
          fail("DSS_CANONICAL_NONENUMERABLE", "non-enumerable object properties are not canonical JSON", `${path}.${key}`);
        }
      }
      const keys = Object.keys(value).sort();
      const entries = [];
      for (const key of keys) {
        assertDataProperty(value, key, `${path}.${key}`);
        entries.push(`${JSON.stringify(key)}:${canonicalizeValue(value[key], `${path}.${key}`, stack)}`);
      }
      encoded = `{${entries.join(",")}}`;
    }
  } finally {
    stack.delete(value);
  }
  return encoded;
}

function canonicalJson(value) {
  return canonicalizeValue(value, "$", new Set());
}

function canonicalize(value) {
  return JSON.parse(canonicalJson(value));
}

function canonicalBytes(value) {
  return Buffer.from(canonicalJson(value), "utf8");
}

function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalDigest(value, domain = CANONICAL_DOMAIN) {
  if (typeof domain !== "string" || domain.length === 0 || domain.includes("\n")) {
    fail("DSS_CANONICAL_DOMAIN", "digest domain must be a non-empty string without newline", "domain");
  }
  return sha256(Buffer.from(`${domain}\n${canonicalJson(value)}`, "utf8"));
}

function digestText(text, domain = CANONICAL_DOMAIN) {
  if (typeof text !== "string") {
    fail("DSS_CANONICAL_TEXT", "digest text must be a string", "text");
  }
  return sha256(Buffer.from(`${domain}\0${text}`, "utf8"));
}

// Integration-facing name used by the registry/authentication slices.  The
// NUL-separated domain prefix prevents a digest from one contract family from
// being replayed as a digest in another family.
function digestFor(domain, value) {
  return canonicalDigest(value, domain);
}

function isDigest(value) {
  return typeof value === "string" && DIGEST_PATTERN.test(value);
}

function assertDigest(value, path = "digest") {
  if (!isDigest(value)) {
    fail("DSS_CANONICAL_DIGEST", "expected lowercase sha256:<64 hex> digest", path);
  }
  return value;
}

function isCanonicalId(value) {
  return typeof value === "string" && value === value.trim() && ID_PATTERN.test(value)
    && value !== "." && value !== "..";
}

function assertCanonicalId(value, path = "id") {
  if (!isCanonicalId(value)) {
    fail("DSS_CANONICAL_ID", "expected a trimmed portable opaque identifier", path);
  }
  return value;
}

function isMutableSelector(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed !== value || WILDCARD_SELECTOR_PATTERN.test(value)) return true;
  return MUTABLE_SELECTOR_PATTERN.test(value)
    || /^(latest|current|head|tip|default|main|master|develop|development|working|workspace|mutable)$/i.test(value);
}

function isImmutableSelector(value) {
  return isCanonicalId(value) && !isMutableSelector(value);
}

function assertImmutableSelector(value, path = "revision") {
  if (!isCanonicalId(value)) {
    fail("DSS_CANONICAL_ID", "expected a trimmed portable immutable selector", path);
  }
  if (isMutableSelector(value)) {
    fail("DSS_CANONICAL_MUTABLE_SELECTOR", "mutable/latest-style selectors are forbidden", path);
  }
  return value;
}

function requiredString(value, label = "value", options = {}) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    fail(options.code || "DSS_REQUIRED_STRING", "expected a non-empty trimmed string", label);
  }
  if (options.maximum !== undefined && value.length > options.maximum) {
    fail(options.code || "DSS_STRING_BOUNDS", "string exceeds maximum length", label);
  }
  return value;
}

function requiredId(value, label = "id") {
  if (!isCanonicalId(value)) {
    fail("DSS_REQUIRED_ID", "expected a canonical opaque identifier", label);
  }
  return value;
}

function requiredDigest(value, label = "digest") {
  if (!isDigest(value)) {
    fail("DSS_REQUIRED_DIGEST", "expected lowercase sha256:<64 hex> digest", label);
  }
  return value;
}

function sortedUniqueStrings(value, label = "values", options = {}) {
  if (!Array.isArray(value)) {
    fail(options.code || "DSS_SET_TYPE", "expected an array of strings", label);
  }
  if (!options.allowEmpty && value.length === 0) {
    fail(options.code || "DSS_SET_EMPTY", "set must not be empty", label);
  }
  const normalized = value.map((entry, index) => requiredString(entry, `${label}[${index}]`));
  const sorted = [...normalized].sort();
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index] === sorted[index - 1]) {
      fail(options.code || "DSS_SET_DUPLICATE", "set contains a duplicate entry", `${label}[${index}]`);
    }
  }
  return Object.freeze(sorted);
}

function assertExactObject(value, expectedKeys, label = "value") {
  const code = arguments.length >= 3 && typeof label === "string" && /^DSS_|^direct_|^[a-z]+_[a-z_]+$/.test(label)
    ? label : "DSS_EXACT_OBJECT";
  if (!isPlainObject(value)) {
    fail(code, "expected a plain object", label);
  }
  if (!Array.isArray(expectedKeys)) {
    fail(code, "expectedKeys must be an array", label);
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail(code, "object fields do not exactly match the closed contract", label);
  }
  return value;
}

function requiredBoundedInteger(value, label = "value", options = {}, positionalMaximum = undefined) {
  const positional = typeof options === "number";
  const minimum = positional
    ? options
    : (options.minimum === undefined ? Number.MIN_SAFE_INTEGER : options.minimum);
  const maximum = positional
    ? (positionalMaximum === undefined ? Number.MAX_SAFE_INTEGER : positionalMaximum)
    : (options.maximum === undefined ? Number.MAX_SAFE_INTEGER : options.maximum);
  const errorCode = positional ? "DSS_INTEGER_BOUNDS" : (options.code || "DSS_INTEGER_BOUNDS");
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(errorCode, `expected integer in [${minimum}, ${maximum}]`, label);
  }
  return value;
}

function deepFreeze(value, seen = new Set()) {
  if ((value === null || typeof value !== "object") && typeof value !== "function") return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value")) {
      deepFreeze(descriptor.value, seen);
    }
  }
  return Object.freeze(value);
}

function cloneCanonical(value) {
  // Parsing canonical JSON yields fresh, plain data and also provides a useful
  // boundary against prototypes/accessors supplied by an untrusted caller.
  return JSON.parse(canonicalJson(value));
}

function parseCanonicalJson(text, path = "$") {
  if (typeof text !== "string") {
    fail("DSS_CANONICAL_TEXT", "canonical JSON input must be a string", path);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail("DSS_CANONICAL_PARSE", "invalid JSON", path);
  }
  const canonical = canonicalJson(parsed);
  if (canonical !== text) {
    fail("DSS_CANONICAL_NONCANONICAL_TEXT", "JSON text is not canonical", path);
  }
  return parsed;
}

module.exports = {
  CANONICAL_DOMAIN,
  DIGEST_PATTERN,
  ID_PATTERN,
  MUTABLE_SELECTOR_PATTERN,
  CanonicalError,
  assertCanonicalId,
  assertDigest,
  assertImmutableSelector,
  canonicalBytes,
  canonicalize,
  canonicalDigest,
  canonicalJson,
  cloneCanonical,
  digestFor,
  deepFreeze,
  digestCanonical: canonicalDigest,
  digestText,
  isCanonicalId,
  isDigest,
  isImmutableSelector,
  isMutableSelector,
  isPlainObject,
  parseCanonicalJson,
  requiredBoundedInteger,
  requiredDigest,
  requiredId,
  requiredString,
  sortedUniqueStrings,
  assertExactObject,
  fail,
  sha256,
};
