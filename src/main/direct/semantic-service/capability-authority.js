"use strict";

/*
 * Owner-issued semantic capabilities.
 *
 * Capability JSON is intentionally a projection, not a bearer credential.
 * The authority lives in capabilityRecords, a factory-local WeakMap.  A
 * structured clone therefore carries useful diagnostics but no authority.
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
  requiredBoundedInteger,
  sortedUniqueStrings,
} = require("./canonical");

const { validateContract } = require("./contract-schemas");

const CAPABILITY_SCHEMA = "direct_semantic_capability@1";

const OPERATIONS = Object.freeze([
  "prepare_snapshot",
  "submit_job",
  "inspect_job",
  "read_results",
  "subscribe_results",
  "request_cancel",
  "administer_service",
]);

const ARRAY_FIELDS = Object.freeze([
  "jobRefs",
  "projectRegistryRevisionRefs",
  "allowedTargetORevisions",
  "targetSnapshotReceiptRefs",
  "compilerPinRefs",
  "kernelRevisionRefs",
  "executionProfileRevisionRefs",
  "providerProfileRevisionRefs",
  "allowedModels",
  "allowedReasoningEfforts",
  "attemptPolicyRevisionRefs",
  "purposeScopes",
  "returnProjectionRefs",
]);

const CAPABILITY_FIELDS = Object.freeze([
  "schema",
  "capabilityId",
  "principalId",
  "operation",
  ...ARRAY_FIELDS,
  "maximumJobs",
  "maximumCellsPerJob",
  "maximumReplicatesPerCell",
  "maximumInputTokensPerJob",
  "maximumOutputTokensPerJob",
  "maximumCostMicrounitsPerJob",
  "issuedAt",
  "expiresAt",
  "nonce",
]);

const OPERATION_SCOPE_RULES = Object.freeze({
  prepare_snapshot: Object.freeze({
    required: Object.freeze(["projectRegistryRevisionRefs", "allowedTargetORevisions", "purposeScopes"]),
    forbidden: Object.freeze([
      "jobRefs", "targetSnapshotReceiptRefs", "compilerPinRefs", "kernelRevisionRefs",
      "executionProfileRevisionRefs", "providerProfileRevisionRefs", "allowedModels",
      "allowedReasoningEfforts", "attemptPolicyRevisionRefs", "returnProjectionRefs",
    ]),
    budgeted: false,
  }),
  submit_job: Object.freeze({
    required: Object.freeze([
      "projectRegistryRevisionRefs", "allowedTargetORevisions", "targetSnapshotReceiptRefs",
      "compilerPinRefs", "kernelRevisionRefs", "executionProfileRevisionRefs",
      "providerProfileRevisionRefs", "allowedModels", "allowedReasoningEfforts",
      "attemptPolicyRevisionRefs", "purposeScopes", "returnProjectionRefs",
    ]),
    forbidden: Object.freeze(["jobRefs"]),
    budgeted: true,
  }),
  inspect_job: Object.freeze({
    required: Object.freeze(["jobRefs", "purposeScopes"]),
    forbidden: Object.freeze([
      "projectRegistryRevisionRefs", "allowedTargetORevisions", "targetSnapshotReceiptRefs",
      "compilerPinRefs", "kernelRevisionRefs", "executionProfileRevisionRefs",
      "providerProfileRevisionRefs", "allowedModels", "allowedReasoningEfforts",
      "attemptPolicyRevisionRefs", "returnProjectionRefs",
    ]),
    budgeted: false,
  }),
  read_results: Object.freeze({
    required: Object.freeze(["jobRefs", "returnProjectionRefs", "purposeScopes"]),
    forbidden: Object.freeze([
      "projectRegistryRevisionRefs", "allowedTargetORevisions", "targetSnapshotReceiptRefs",
      "compilerPinRefs", "kernelRevisionRefs", "executionProfileRevisionRefs",
      "providerProfileRevisionRefs", "allowedModels", "allowedReasoningEfforts",
      "attemptPolicyRevisionRefs",
    ]),
    budgeted: false,
  }),
  subscribe_results: Object.freeze({
    required: Object.freeze(["jobRefs", "returnProjectionRefs", "purposeScopes"]),
    forbidden: Object.freeze([
      "projectRegistryRevisionRefs", "allowedTargetORevisions", "targetSnapshotReceiptRefs",
      "compilerPinRefs", "kernelRevisionRefs", "executionProfileRevisionRefs",
      "providerProfileRevisionRefs", "allowedModels", "allowedReasoningEfforts",
      "attemptPolicyRevisionRefs",
    ]),
    budgeted: false,
  }),
  request_cancel: Object.freeze({
    required: Object.freeze(["jobRefs", "purposeScopes"]),
    forbidden: Object.freeze([
      "projectRegistryRevisionRefs", "allowedTargetORevisions", "targetSnapshotReceiptRefs",
      "compilerPinRefs", "kernelRevisionRefs", "executionProfileRevisionRefs",
      "providerProfileRevisionRefs", "allowedModels", "allowedReasoningEfforts",
      "attemptPolicyRevisionRefs", "returnProjectionRefs",
    ]),
    budgeted: false,
  }),
  administer_service: Object.freeze({
    required: Object.freeze(["purposeScopes"]),
    forbidden: Object.freeze(ARRAY_FIELDS.filter((field) => field !== "purposeScopes")),
    budgeted: false,
  }),
});

const capabilityRecords = new WeakMap();

function ensurePlain(value, code) {
  if (!isPlainObject(value)) fail(code);
  return value;
}

function rejectUnknownKeys(value, allowed, code) {
  ensurePlain(value, code);
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) if (!allowedSet.has(key)) fail(code, key);
}

function validate(schema, value, code) {
  try {
    const verdict = validateContract(schema, value);
    if (verdict === false) fail(code);
  } catch (error) {
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
  if (result === "*" || /(?:^|[:/#@])(?:latest|current|head|tip|default|main|master|develop|development|working|workspace|mutable|branch)(?:$|[:/#@])/i.test(result)) {
    fail("direct_semantic_mutable_revision_alias", label);
  }
  return result;
}

function list(value, label, options = {}) {
  const allowEmpty = options.allowEmpty !== false;
  let result;
  try {
    result = sortedUniqueStrings(value, label, { allowEmpty });
  } catch (error) {
    throw error;
  }
  if (!Array.isArray(result)) fail("direct_semantic_scope_invalid", label);
  const normalized = result.map((entry) => requiredRef(entry, label));
  if (!allowEmpty && normalized.length === 0) fail("direct_semantic_scope_empty", label);
  return Object.freeze(normalized.slice());
}

function timestamp(value, label, fallback) {
  const result = value === undefined ? fallback : requiredNonEmptyString(value, label);
  if (!Number.isFinite(Date.parse(result))) fail("direct_semantic_timestamp_invalid", label);
  return result;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (isPlainObject(value)) {
    const output = {};
    for (const key of Object.keys(value)) output[key] = clone(value[key]);
    return output;
  }
  return value;
}

function nowMs(clock) {
  const value = typeof clock === "function" ? clock() : clock === undefined ? Date.now() : clock;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") return Date.parse(value);
  return value;
}

function randomNonce() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function normalizeEstimate(estimate = {}) {
  ensurePlain(estimate, "direct_semantic_resource_estimate_invalid");
  const allowed = [
    "cells",
    "replicatesPerCell",
    "inputTokens",
    "outputTokens",
    "costMicrounits",
    "model",
    "reasoningEffort",
  ];
  for (const key of Object.keys(estimate)) if (!allowed.includes(key)) fail("direct_semantic_resource_estimate_invalid", key);
  const read = (key) => requiredBoundedInteger(estimate[key] ?? 0, key, { minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
  const result = {
    cells: read("cells"),
    replicatesPerCell: read("replicatesPerCell"),
    inputTokens: read("inputTokens"),
    outputTokens: read("outputTokens"),
    costMicrounits: read("costMicrounits"),
  };
  if (estimate.model !== undefined) result.model = requiredNonEmptyString(estimate.model, "model");
  if (estimate.reasoningEffort !== undefined) result.reasoningEffort = requiredNonEmptyString(estimate.reasoningEffort, "reasoningEffort");
  return deepFreeze(result);
}

function createCapabilityAuthority(options = {}) {
  ensurePlain(options, "direct_semantic_capability_authority_options_invalid");
  const principalAuthority = options.principalAuthority;
  if (!principalAuthority || typeof principalAuthority.assertSemanticPrincipal !== "function") {
    fail("direct_semantic_principal_authority_required");
  }
  const capabilitiesById = new Map();
  const clock = options.now || options.clock;
  const authorityMarker = Object.freeze({});
  const authorityId = options.authorityId === undefined
    ? digestFor("direct-semantic-capability-authority", { nonce: randomNonce() })
    : requiredId(options.authorityId, "authorityId");

  function currentMs() {
    const value = nowMs(clock);
    if (!Number.isFinite(value)) fail("direct_semantic_clock_invalid");
    return value;
  }

  function assertCapability(value) {
    const record = capabilityRecords.get(value);
    if (!record || record.authorityMarker !== authorityMarker) fail("direct_semantic_capability_untrusted");
    if (record.revoked) fail("direct_semantic_capability_revoked");
    if (record.expiresAt && Date.parse(record.expiresAt) <= currentMs()) fail("direct_semantic_capability_expired");
    return record;
  }

  function isCapability(value) {
    const record = capabilityRecords.get(value);
    return Boolean(record && record.authorityMarker === authorityMarker);
  }

  function issue(input = {}) {
    ensurePlain(input, "direct_semantic_capability_invalid");
    rejectUnknownKeys(input, [...CAPABILITY_FIELDS.filter((field) => field !== "schema"), "principal"], "direct_semantic_capability_invalid");
    if (input.schema !== undefined) fail("direct_semantic_capability_supplied");

    const principal = input.principal;
    const principalRecord = principalAuthority.assertSemanticPrincipal(principal);
    const capabilityId = requiredId(input.capabilityId, "capabilityId");
    if (capabilitiesById.has(capabilityId)) fail("direct_semantic_capability_duplicate", capabilityId);
    const principalId = requiredId(input.principalId ?? principalRecord.principal.principalId, "principalId");
    if (principalId !== principalRecord.principal.principalId) fail("direct_semantic_capability_principal_mismatch");
    const operation = requiredNonEmptyString(input.operation, "operation");
    if (!OPERATIONS.includes(operation)) fail("direct_semantic_capability_operation_invalid");

    const normalizedLists = {};
    for (const field of ARRAY_FIELDS) {
      const allowEmpty = !OPERATION_SCOPE_RULES[operation].required.includes(field);
      normalizedLists[field] = list(input[field], field, { allowEmpty });
    }
    const scopeRule = OPERATION_SCOPE_RULES[operation];
    for (const field of scopeRule.required) {
      if (normalizedLists[field].length === 0) fail("direct_semantic_capability_scope_missing", field);
    }
    for (const field of scopeRule.forbidden) {
      if (normalizedLists[field].length > 0) fail("direct_semantic_capability_irrelevant_scope", `${operation}:${field}`);
    }

    const maximumJobs = requiredBoundedInteger(input.maximumJobs, "maximumJobs", { minimum: operation === "submit_job" ? 1 : 0, maximum: Number.MAX_SAFE_INTEGER });
    const maximumCellsPerJob = requiredBoundedInteger(input.maximumCellsPerJob, "maximumCellsPerJob", { minimum: operation === "submit_job" ? 1 : 0, maximum: Number.MAX_SAFE_INTEGER });
    const maximumReplicatesPerCell = requiredBoundedInteger(input.maximumReplicatesPerCell, "maximumReplicatesPerCell", { minimum: operation === "submit_job" ? 1 : 0, maximum: Number.MAX_SAFE_INTEGER });
    const maximumInputTokensPerJob = requiredBoundedInteger(input.maximumInputTokensPerJob, "maximumInputTokensPerJob", { minimum: operation === "submit_job" ? 1 : 0, maximum: Number.MAX_SAFE_INTEGER });
    const maximumOutputTokensPerJob = requiredBoundedInteger(input.maximumOutputTokensPerJob, "maximumOutputTokensPerJob", { minimum: operation === "submit_job" ? 1 : 0, maximum: Number.MAX_SAFE_INTEGER });
    const maximumCostMicrounitsPerJob = input.maximumCostMicrounitsPerJob === null
      ? null
      : requiredBoundedInteger(input.maximumCostMicrounitsPerJob, "maximumCostMicrounitsPerJob", { minimum: operation === "submit_job" ? 0 : 0, maximum: Number.MAX_SAFE_INTEGER });
    const issuedAt = timestamp(input.issuedAt, "issuedAt", new Date(currentMs()).toISOString());
    const expiresAt = input.expiresAt === undefined ? undefined : timestamp(input.expiresAt, "expiresAt", undefined);
    if (expiresAt !== undefined && Date.parse(expiresAt) <= Date.parse(issuedAt)) fail("direct_semantic_capability_expiry_invalid");
    const nonce = requiredNonEmptyString(input.nonce ?? randomNonce(), "nonce");

    const capability = {
      schema: CAPABILITY_SCHEMA,
      capabilityId,
      principalId,
      operation,
      ...normalizedLists,
      maximumJobs,
      maximumCellsPerJob,
      maximumReplicatesPerCell,
      maximumInputTokensPerJob,
      maximumOutputTokensPerJob,
      maximumCostMicrounitsPerJob,
      issuedAt,
      ...(expiresAt === undefined ? {} : { expiresAt }),
      nonce,
    };
    // Optional expiresAt is the one optional schema field.  Building the
    // object ourselves means no caller-controlled extra field can survive.
    assertExactObject(capability, Object.keys(capability), "direct_semantic_capability_invalid");
    validate(CAPABILITY_SCHEMA, capability, "direct_semantic_capability_invalid");
    deepFreeze(capability);

    const record = {
      authorityId,
      authorityMarker,
      capability,
      principal,
      principalId,
      operation,
      issuedAt,
      expiresAt: expiresAt || null,
      revoked: false,
      revokedAt: null,
      revokedReason: null,
      usedJobs: 0,
      usedCells: 0,
      usedReplicates: 0,
      usedInputTokens: 0,
      usedOutputTokens: 0,
      usedCostMicrounits: 0,
      reservationSequence: 0,
    };
    Object.seal(record);
    capabilityRecords.set(capability, record);
    capabilitiesById.set(capabilityId, capability);
    return capability;
  }

  function revoke(capability, options = {}) {
    const record = capabilityRecords.get(capability);
    if (!record || record.authorityMarker !== authorityMarker) fail("direct_semantic_capability_untrusted");
    if (record.revoked) return deepFreeze({ capabilityId: record.capability.capabilityId, revoked: true, alreadyRevoked: true });
    const reason = options.reason === undefined ? "revoked_by_issuer" : requiredNonEmptyString(options.reason, "reason");
    const revokedAt = timestamp(options.revokedAt, "revokedAt", new Date(currentMs()).toISOString());
    record.revoked = true;
    record.revokedAt = revokedAt;
    record.revokedReason = reason;
    return deepFreeze({
      schema: "direct_semantic_capability_revocation@1",
      capabilityId: record.capability.capabilityId,
      revoked: true,
      revokedAt,
      reason,
    });
  }

  function checkQuota(capability, estimateInput = {}) {
    const record = assertCapability(capability);
    const estimate = normalizeEstimate(estimateInput);
    const c = record.capability;
    if (c.operation !== "submit_job") fail("direct_semantic_capability_budget_not_applicable");
    if (estimate.cells > c.maximumCellsPerJob) fail("direct_semantic_cells_quota_exceeded");
    if (estimate.replicatesPerCell > c.maximumReplicatesPerCell) fail("direct_semantic_replicates_quota_exceeded");
    if (estimate.inputTokens > c.maximumInputTokensPerJob) fail("direct_semantic_input_tokens_quota_exceeded");
    if (estimate.outputTokens > c.maximumOutputTokensPerJob) fail("direct_semantic_output_tokens_quota_exceeded");
    if (c.maximumCostMicrounitsPerJob !== null && estimate.costMicrounits > c.maximumCostMicrounitsPerJob) {
      fail("direct_semantic_cost_quota_exceeded");
    }
    if (record.usedJobs >= c.maximumJobs) fail("direct_semantic_maximum_jobs_exhausted");
    // Aggregate usage is checked with safe integer arithmetic.  This is the
    // compare-and-swap boundary: no await or callback occurs between checks
    // and the subsequent reservation in consumeBudget.
    if (record.usedCells + estimate.cells > c.maximumJobs * c.maximumCellsPerJob) fail("direct_semantic_cells_budget_exhausted");
    if (record.usedReplicates + estimate.replicatesPerCell > c.maximumJobs * c.maximumReplicatesPerCell) fail("direct_semantic_replicates_budget_exhausted");
    if (record.usedInputTokens + estimate.inputTokens > c.maximumJobs * c.maximumInputTokensPerJob) fail("direct_semantic_input_budget_exhausted");
    if (record.usedOutputTokens + estimate.outputTokens > c.maximumJobs * c.maximumOutputTokensPerJob) fail("direct_semantic_output_budget_exhausted");
    if (c.maximumCostMicrounitsPerJob !== null && record.usedCostMicrounits + estimate.costMicrounits > c.maximumJobs * c.maximumCostMicrounitsPerJob) {
      fail("direct_semantic_cost_budget_exhausted");
    }
    return estimate;
  }

  function consumeBudget(capability, estimateInput = {}, metadata = {}) {
    const record = assertCapability(capability);
    const estimate = checkQuota(capability, estimateInput);
    ensurePlain(metadata, "direct_semantic_budget_metadata_invalid");
    const reservationId = requiredId(metadata.reservationId ?? `${record.capability.capabilityId}:reservation:${record.reservationSequence + 1}`, "reservationId");
    record.reservationSequence += 1;
    record.usedJobs += 1;
    record.usedCells += estimate.cells;
    record.usedReplicates += estimate.replicatesPerCell;
    record.usedInputTokens += estimate.inputTokens;
    record.usedOutputTokens += estimate.outputTokens;
    record.usedCostMicrounits += estimate.costMicrounits;
    return deepFreeze({
      schema: "direct_semantic_capability_budget_reservation@1",
      reservationId,
      capabilityId: record.capability.capabilityId,
      operation: record.capability.operation,
      ordinal: record.reservationSequence,
      estimate: clone(estimate),
      totals: {
        jobs: record.usedJobs,
        cells: record.usedCells,
        replicates: record.usedReplicates,
        inputTokens: record.usedInputTokens,
        outputTokens: record.usedOutputTokens,
        costMicrounits: record.usedCostMicrounits,
      },
    });
  }

  function quotaSnapshot(capability) {
    const record = assertCapability(capability);
    return deepFreeze({
      capabilityId: record.capability.capabilityId,
      maximumJobs: record.capability.maximumJobs,
      usedJobs: record.usedJobs,
      remainingJobs: record.capability.maximumJobs - record.usedJobs,
      maximumCellsPerJob: record.capability.maximumCellsPerJob,
      maximumReplicatesPerCell: record.capability.maximumReplicatesPerCell,
      maximumInputTokensPerJob: record.capability.maximumInputTokensPerJob,
      maximumOutputTokensPerJob: record.capability.maximumOutputTokensPerJob,
      maximumCostMicrounitsPerJob: record.capability.maximumCostMicrounitsPerJob,
      usedCells: record.usedCells,
      usedReplicates: record.usedReplicates,
      usedInputTokens: record.usedInputTokens,
      usedOutputTokens: record.usedOutputTokens,
      usedCostMicrounits: record.usedCostMicrounits,
    });
  }

  function describe(capability) {
    const record = assertCapability(capability);
    return deepFreeze({
      capability: clone(record.capability),
      revoked: record.revoked,
      revokedAt: record.revokedAt,
      revokedReason: record.revokedReason,
      quota: quotaSnapshot(capability),
    });
  }

  function capabilityForId(capabilityId) {
    const id = requiredId(capabilityId, "capabilityId");
    const capability = capabilitiesById.get(id);
    if (!capability) fail("direct_semantic_capability_unknown", id);
    return capability;
  }

  function assertBoundToPrincipal(capability, principal) {
    const record = assertCapability(capability);
    const principalRecord = principalAuthority.assertSemanticPrincipal(principal);
    if (record.principal !== principal || record.principalId !== principalRecord.principal.principalId) {
      fail("direct_semantic_capability_principal_mismatch");
    }
    return record;
  }

  return deepFreeze({
    authorityId,
    schemas: deepFreeze({ capability: CAPABILITY_SCHEMA }),
    operations: OPERATIONS,
    issue,
    issueCapability: issue,
    issueDirectSemanticCapability: issue,
    assertCapability,
    assertBoundToPrincipal,
    isCapability,
    revoke,
    checkQuota,
    consumeBudget,
    consume: consumeBudget,
    quotaSnapshot,
    describe,
    capabilityForId,
  });
}

module.exports = {
  CAPABILITY_SCHEMA,
  OPERATIONS,
  ARRAY_FIELDS,
  OPERATION_SCOPE_RULES,
  createCapabilityAuthority,
  createDirectSemanticCapabilityAuthority: createCapabilityAuthority,
};
