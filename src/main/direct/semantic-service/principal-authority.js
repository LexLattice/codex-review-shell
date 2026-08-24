"use strict";

/*
 * Principal custody for Direct Semantic Service.
 *
 * A principal is deliberately an ordinary-looking frozen value at the
 * transport boundary.  The authority is the object identity held in the
 * factory's WeakMaps, however; serialising and reconstructing that value does
 * not reconstruct the authority.  Keep this module small and boring: all
 * policy decisions belong in capability-authority/authorization.
 */

const {
  fail,
  canonicalJson,
  digestFor,
  deepFreeze,
  isPlainObject,
  assertExactObject,
  requiredId,
  requiredString,
  sortedUniqueStrings,
  requiredBoundedInteger,
} = require("./canonical");

const { validateContract } = require("./contract-schemas");

const TRANSPORT_SCHEMA = "direct_semantic_transport_principal@1";
const SEMANTIC_SCHEMA = "direct_semantic_principal@1";

const TRANSPORTS = Object.freeze([
  "unix_socket",
  "windows_wsl_stdio",
  "internal",
]);

const PRINCIPAL_CLASSES = Object.freeze([
  "local_user_experimental",
  "direct_workthread",
  "direct_service",
  "operator",
]);

const TRANSPORT_INPUT_FIELDS = Object.freeze([
  "transport",
  "hostUserId",
  "hostGroupId",
  "processId",
  "observedAt",
  "peerCredentials",
]);

const SEMANTIC_INPUT_FIELDS = Object.freeze([
  "principalId",
  "issuerRevision",
  "principalClass",
  "subjectRef",
  "projectScopes",
  "purposeScopes",
  "transportPrincipal",
  "authenticatedSessionRef",
]);

function ownKeys(value) {
  return Object.keys(value).sort();
}

function ensurePlain(value, code) {
  if (!isPlainObject(value)) fail(code);
  return value;
}

function rejectUnknownKeys(value, allowed, code) {
  ensurePlain(value, code);
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) fail(code, key);
  }
}

function validate(schema, value, code) {
  // The shared contract validator is authoritative once all DSS contracts
  // are integrated.  Local field checks below keep this module fail-closed in
  // isolation as well, and also make the authority useful to early callers.
  try {
    const verdict = validateContract(schema, value);
    if (verdict === false) fail(code);
  } catch (error) {
    // A staged checkout can briefly lack a schema while the contract worker is
    // being integrated.  Do not turn an unknown-schema lookup into authority;
    // local checks still run.  Any actual validation failure propagates.
    const marker = `${error?.code || ""}:${error?.message || ""}`.toLowerCase();
    if (!/(?:schema|contract)[^:]*?(?:unknown|missing|unsupported|not[_ -]?found)|(?:unknown|missing|unsupported|not[_ -]?found)[^:]*?(?:schema|contract)/.test(marker)) throw error;
  }
}

function requiredNonEmptyString(value, label) {
  const result = requiredString(value, label);
  if (typeof result !== "string" || result.length === 0) fail("direct_semantic_string_invalid", label);
  return result;
}

function requiredRef(value, label) {
  const result = requiredNonEmptyString(value, label);
  // A mutable selector must never be silently interpreted as a revision.
  if (result === "*" || /(?:^|[:/#@])(?:latest|current|head|tip|default|main|master|develop|development|working|workspace|mutable|branch)(?:$|[:/#@])/i.test(result)) {
    fail("direct_semantic_mutable_revision_alias", label);
  }
  return result;
}

function requiredList(value, label) {
  let result;
  try {
    result = sortedUniqueStrings(value, label, { allowEmpty: true });
  } catch (error) {
    throw error;
  }
  if (!Array.isArray(result)) fail("direct_semantic_scope_invalid", label);
  if (result.some((entry) => entry === "*" || entry === "latest" || entry === "current")) {
    fail("direct_semantic_scope_wildcard", label);
  }
  return Object.freeze(result.slice());
}

function optionalString(value, label) {
  if (value === undefined) return undefined;
  return requiredNonEmptyString(value, label);
}

function optionalBoundedInteger(value, label, options) {
  if (value === undefined) return undefined;
  return requiredBoundedInteger(value, label, options);
}

function nowFrom(clock) {
  const raw = typeof clock === "function" ? clock() : Date.now();
  if (raw instanceof Date) return raw.getTime();
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    if (!Number.isFinite(parsed)) fail("direct_semantic_clock_invalid");
    return parsed;
  }
  if (typeof raw !== "number" || !Number.isFinite(raw)) fail("direct_semantic_clock_invalid");
  return raw;
}

function timestamp(value, label, fallback) {
  const result = value === undefined ? fallback : requiredNonEmptyString(value, label);
  if (!Number.isFinite(Date.parse(result))) fail("direct_semantic_timestamp_invalid", label);
  return result;
}

function copy(value) {
  if (Array.isArray(value)) return value.map(copy);
  if (isPlainObject(value)) {
    const output = {};
    for (const key of Object.keys(value)) output[key] = copy(value[key]);
    return output;
  }
  return value;
}

function principalDigest(domain, value) {
  try {
    return digestFor(domain, value);
  } catch {
    return digestFor(domain, JSON.parse(canonicalJson(value)));
  }
}

function createPrincipalAuthority(options = {}) {
  ensurePlain(options, "direct_semantic_principal_authority_options_invalid");

  const transportRecords = new WeakMap();
  const semanticRecordsLocal = new WeakMap();
  const principalsById = new Map();
  const transportByDigest = new Map();
  const authorityId = options.authorityId === undefined
    ? principalDigest("direct-semantic-principal-authority", { nonce: `${Date.now()}:${Math.random()}` })
    : requiredId(options.authorityId, "authorityId");
  const clock = options.now || options.clock;

  function assertTransportPrincipal(value) {
    const record = transportRecords.get(value);
    if (!record) fail("direct_semantic_transport_principal_untrusted");
    return record;
  }

  function assertSemanticPrincipal(value) {
    const record = semanticRecordsLocal.get(value);
    if (!record) fail("direct_semantic_principal_untrusted");
    return record;
  }

  function isTransportPrincipal(value) {
    return transportRecords.has(value);
  }

  function isSemanticPrincipal(value) {
    return semanticRecordsLocal.has(value);
  }

  function deriveTransportPrincipal(input = {}) {
    ensurePlain(input, "direct_semantic_transport_observation_invalid");
    rejectUnknownKeys(input, TRANSPORT_INPUT_FIELDS, "direct_semantic_transport_observation_invalid");
    if (Object.prototype.hasOwnProperty.call(input, "schema")) fail("direct_semantic_transport_observation_supplied");

    const peer = input.peerCredentials === undefined
      ? null
      : ensurePlain(input.peerCredentials, "direct_semantic_peer_credentials_invalid");
    if (peer) {
      for (const key of Object.keys(peer)) {
        if (!["uid", "gid", "pid", "hostUserId", "hostGroupId", "processId"].includes(key)) {
          fail("direct_semantic_peer_credentials_invalid", key);
        }
      }
    }

    const transport = requiredNonEmptyString(input.transport ?? "unix_socket", "transport");
    if (!TRANSPORTS.includes(transport)) fail("direct_semantic_transport_invalid");
    const hostUserId = requiredNonEmptyString(
      input.hostUserId
        ?? peer?.hostUserId
        ?? (peer?.uid === undefined ? undefined : String(peer.uid)),
      "hostUserId",
    );
    const hostGroupRaw = input.hostGroupId ?? peer?.hostGroupId ?? (peer?.gid === undefined ? undefined : String(peer.gid));
    const processRaw = input.processId ?? peer?.processId ?? (peer?.pid === undefined ? undefined : peer.pid);
    const hostGroupId = optionalString(hostGroupRaw, "hostGroupId");
    const processId = optionalBoundedInteger(processRaw, "processId", { minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
    const observedAt = timestamp(input.observedAt, "observedAt", new Date(nowFrom(clock)).toISOString());

    const principal = {
      schema: TRANSPORT_SCHEMA,
      transport,
      hostUserId,
      ...(hostGroupId === undefined ? {} : { hostGroupId }),
      ...(processId === undefined ? {} : { processId }),
      observedAt,
    };
    // assertExactObject is intentionally called after construction as a
    // second line of defence if a shared helper tightens its semantics.
    assertExactObject(principal, ownKeys(principal), "direct_semantic_transport_principal_invalid");
    validate(TRANSPORT_SCHEMA, principal, "direct_semantic_transport_principal_invalid");
    deepFreeze(principal);

    const record = Object.freeze({
      authorityId,
      kind: "transport",
      principal,
      observedAt,
      digest: principalDigest(TRANSPORT_SCHEMA, principal),
    });
    transportRecords.set(principal, record);
    transportByDigest.set(record.digest, principal);
    return principal;
  }

  function issueSemanticPrincipal(input = {}) {
    ensurePlain(input, "direct_semantic_principal_invalid");
    rejectUnknownKeys(input, SEMANTIC_INPUT_FIELDS, "direct_semantic_principal_invalid");
    if (Object.prototype.hasOwnProperty.call(input, "schema")) fail("direct_semantic_principal_supplied");

    const principalId = requiredId(input.principalId, "principalId");
    if (principalsById.has(principalId)) fail("direct_semantic_principal_duplicate", principalId);
    const issuerRevision = requiredRef(input.issuerRevision, "issuerRevision");
    const principalClass = requiredNonEmptyString(input.principalClass, "principalClass");
    if (!PRINCIPAL_CLASSES.includes(principalClass)) fail("direct_semantic_principal_class_invalid");
    const subjectRef = requiredNonEmptyString(input.subjectRef, "subjectRef");
    const projectScopes = requiredList(input.projectScopes, "projectScopes");
    const purposeScopes = requiredList(input.purposeScopes, "purposeScopes");
    let transportPrincipal = null;
    if (input.transportPrincipal !== undefined) transportPrincipal = assertTransportPrincipal(input.transportPrincipal).principal;
    const authenticatedSessionRef = optionalString(input.authenticatedSessionRef, "authenticatedSessionRef");

    const principal = {
      schema: SEMANTIC_SCHEMA,
      principalId,
      issuerRevision,
      principalClass,
      subjectRef,
      projectScopes,
      purposeScopes,
    };
    assertExactObject(principal, ownKeys(principal), "direct_semantic_principal_invalid");
    validate(SEMANTIC_SCHEMA, principal, "direct_semantic_principal_invalid");
    deepFreeze(principal);

    const record = Object.freeze({
      authorityId,
      kind: "semantic",
      principal,
      transportPrincipal,
      authenticatedSessionRef: authenticatedSessionRef || null,
      digest: principalDigest(SEMANTIC_SCHEMA, principal),
    });
    semanticRecordsLocal.set(principal, record);
    principalsById.set(principalId, principal);
    return principal;
  }

  function resolveSemanticPrincipal(input = {}) {
    ensurePlain(input, "direct_semantic_principal_resolution_invalid");
    const candidate = input.semanticPrincipal ?? input.principal;
    const record = assertSemanticPrincipal(candidate);
    if (input.transportPrincipal !== undefined) {
      const transport = assertTransportPrincipal(input.transportPrincipal);
      if (record.transportPrincipal && record.transportPrincipal !== transport.principal) {
        fail("direct_semantic_transport_binding_mismatch");
      }
    }
    return candidate;
  }

  function describe(value) {
    if (isTransportPrincipal(value)) {
      const record = assertTransportPrincipal(value);
      return deepFreeze({
        schema: TRANSPORT_SCHEMA,
        digest: record.digest,
        principal: copy(record.principal),
      });
    }
    if (isSemanticPrincipal(value)) {
      const record = assertSemanticPrincipal(value);
      return deepFreeze({
        schema: SEMANTIC_SCHEMA,
        digest: record.digest,
        principal: copy(record.principal),
        transportBound: Boolean(record.transportPrincipal),
        authenticatedSessionRef: record.authenticatedSessionRef,
      });
    }
    fail("direct_semantic_principal_untrusted");
  }

  function principalForId(principalId) {
    const id = requiredId(principalId, "principalId");
    const principal = principalsById.get(id);
    if (!principal) fail("direct_semantic_principal_unknown", id);
    return principal;
  }

  function transportForDigest(digest) {
    const value = requiredString(digest, "transportPrincipalDigest");
    const principal = transportByDigest.get(value);
    if (!principal) fail("direct_semantic_transport_principal_unknown", value);
    return principal;
  }

  return deepFreeze({
    authorityId,
    deriveTransportPrincipal,
    observeTransportPrincipal: deriveTransportPrincipal,
    issueSemanticPrincipal,
    issue: issueSemanticPrincipal,
    resolveSemanticPrincipal,
    assertTransportPrincipal,
    assertSemanticPrincipal,
    isTransportPrincipal,
    isSemanticPrincipal,
    describe,
    principalForId,
    transportForDigest,
    schemas: deepFreeze({ transport: TRANSPORT_SCHEMA, semantic: SEMANTIC_SCHEMA }),
  });
}

module.exports = {
  TRANSPORT_SCHEMA,
  SEMANTIC_SCHEMA,
  TRANSPORTS,
  PRINCIPAL_CLASSES,
  createPrincipalAuthority,
  createDirectSemanticPrincipalAuthority: createPrincipalAuthority,
};
