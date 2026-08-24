"use strict";

/*
 * Direct Semantic Service authorization.
 *
 * This is the narrow decision kernel for DSS-0.1.  It does not mint a
 * principal or capability, and it does not infer authority from requesterRef,
 * SO_PEERCRED, a project name, or a mutable alias.  Every successful decision
 * is the intersection of an opaque capability, an authenticated transport and
 * semantic principal, immutable service records, a canonical request, and a
 * bounded resource estimate.
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

const AUTHORIZATION_SCHEMA = "direct_semantic_authorization_receipt@1";
const TRANSPORT_SCHEMA = "direct_semantic_transport_principal@1";
const PRINCIPAL_SCHEMA = "direct_semantic_principal@1";
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

const REQUEST_SCHEMAS = Object.freeze({
  prepare_snapshot: "direct_semantic_snapshot_prepare_request@1",
  submit_job: "direct_semantic_job_request@1",
  inspect_job: "direct_semantic_job_inspect_request@1",
  read_results: "direct_semantic_results_request@1",
  subscribe_results: "direct_semantic_subscribe_request@1",
  request_cancel: "direct_semantic_job_cancellation_request@1",
  administer_service: "direct_semantic_service_admin_request@1",
});

const REQUEST_FIELDS = Object.freeze({
  prepare_snapshot: Object.freeze({
    required: Object.freeze(["schema", "requestId", "projectRef", "projectRegistryRevisionRef", "targetORevision", "idempotencyKey"]),
    optional: Object.freeze(["requesterRef"]),
  }),
  submit_job: Object.freeze({
    required: Object.freeze([
      "schema", "requestId", "projectRef", "projectRegistryRevisionRef", "targetORevision",
      "targetSnapshotReceiptRef", "compilerPinRef", "requestedCompilationRef", "selectionMode",
      "edgeOccurrenceRefs", "attemptPolicyRef", "executionProfileRevisionRef", "deliveryProjectionRef",
      "idempotencyKey",
    ]),
    optional: Object.freeze(["requesterRef"]),
  }),
  inspect_job: Object.freeze({
    required: Object.freeze(["schema", "requestId", "jobRef", "idempotencyKey"]),
    optional: Object.freeze(["requesterRef"]),
  }),
  read_results: Object.freeze({
    required: Object.freeze(["schema", "requestId", "jobRef", "returnProjectionRef", "idempotencyKey"]),
    optional: Object.freeze(["requesterRef"]),
  }),
  subscribe_results: Object.freeze({
    required: Object.freeze(["schema", "requestId", "jobRef", "returnProjectionRef", "idempotencyKey"]),
    optional: Object.freeze(["requesterRef", "eventTypeFilter", "startingCursor"]),
  }),
  request_cancel: Object.freeze({
    required: Object.freeze(["schema", "cancellationRequestRef", "jobRef", "requestedCellRefs", "boundedReason", "idempotencyKey"]),
    optional: Object.freeze(["requesterRef"]),
  }),
  administer_service: Object.freeze({
    required: Object.freeze(["schema", "requestId", "idempotencyKey"]),
    optional: Object.freeze(["requesterRef"]),
  }),
});

const RECORD_KINDS = Object.freeze([
  "projectRegistryRevision",
  "targetSnapshotReceipt",
  "compilerPin",
  "kernelRevision",
  "executionProfileRevision",
  "providerProfileRevision",
  "attemptPolicy",
  "projectionRevision",
  "job",
]);

const RECORD_REF_FIELDS = Object.freeze({
  projectRegistryRevision: Object.freeze(["registryRevisionRef", "recordRef"]),
  targetSnapshotReceipt: Object.freeze(["targetSnapshotReceiptRef", "recordRef"]),
  compilerPin: Object.freeze(["compilerPinRef", "recordRef"]),
  kernelRevision: Object.freeze(["kernelRef", "kernelRevisionRef", "recordRef"]),
  executionProfileRevision: Object.freeze(["executionProfileRevisionRef", "recordRef"]),
  providerProfileRevision: Object.freeze(["providerProfileRevisionRef", "recordRef"]),
  attemptPolicy: Object.freeze(["attemptPolicyRef", "recordRef"]),
  projectionRevision: Object.freeze(["returnProjectionRef", "deliveryProjectionRef", "projectionRef", "recordRef"]),
  job: Object.freeze(["jobRef", "recordRef"]),
});

const RECORD_CONTRACT_SCHEMAS = Object.freeze({
  kernelRevision: "semantic_kernel_revision@1",
});

const authorizationReceipts = new WeakMap();

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
  const verdict = validateContract(schema, value);
  if (verdict === false) fail(code);
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

function list(value, label, allowEmpty = true) {
  let result;
  try {
    result = sortedUniqueStrings(value, label, { allowEmpty });
  } catch (error) {
    throw error;
  }
  if (!Array.isArray(result)) fail("direct_semantic_scope_invalid", label);
  const normalized = result.map((entry) => requiredRef(entry, label));
  if (!allowEmpty && normalized.length === 0) fail("direct_semantic_scope_empty", label);
  return normalized;
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

function has(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function valueFrom(record, names) {
  for (const name of names) if (has(record, name)) return record[name];
  return undefined;
}

function refFor(kind, value) {
  const ref = valueFrom(value, RECORD_REF_FIELDS[kind] || ["recordRef"]);
  return requiredRef(ref, `${kind}.ref`);
}

function safeRecordCopy(value) {
  ensurePlain(value, "direct_semantic_record_invalid");
  const output = clone(value);
  deepFreeze(output);
  return output;
}

function statusInvalid(record) {
  if (record.valid === false || record.verified === false || record.admitted === false) return true;
  if (["rejected", "invalid", "stale", "revoked", "unverified", "drifted"].includes(record.status)) return true;
  return false;
}

function createRecordAuthority(externalRegistry) {
  const recordTokens = Object.create(null);
  const recordByRef = Object.create(null);
  const externalDigests = Object.create(null);
  for (const kind of RECORD_KINDS) {
    recordTokens[kind] = new WeakMap();
    recordByRef[kind] = new Map();
    externalDigests[kind] = new Map();
  }

  function admit(kind, value) {
    if (!RECORD_KINDS.includes(kind)) fail("direct_semantic_record_kind_invalid", kind);
    const record = safeRecordCopy(value);
    if (RECORD_CONTRACT_SCHEMAS[kind]) {
      validate(RECORD_CONTRACT_SCHEMAS[kind], record, "direct_semantic_record_contract_invalid");
    }
    const ref = refFor(kind, record);
    if (recordTokens[kind].has(record)) return record;
    if (recordByRef[kind].has(ref)) fail("direct_semantic_record_duplicate", `${kind}:${ref}`);
    recordTokens[kind].set(record, { kind, ref, record });
    recordByRef[kind].set(ref, record);
    return record;
  }

  function localResolve(kind, ref, candidate) {
    if (candidate !== undefined) {
      const token = recordTokens[kind].get(candidate);
      if (!token || token.ref !== ref) fail("direct_semantic_record_untrusted", `${kind}:${ref}`);
      return token.record;
    }
    return recordByRef[kind].get(ref) || null;
  }

  function externalResolve(kind, ref) {
    if (!externalRegistry) return null;
    const resolver = externalRegistry.resolveRecord
      || externalRegistry.getRecord
      || externalRegistry.resolve
      || externalRegistry.get;
    if (typeof resolver !== "function") return null;
    let candidate;
    try {
      candidate = resolver.call(externalRegistry, kind, ref);
    } catch (error) {
      throw error;
    }
    if (!candidate) return null;
    if (typeof externalRegistry.assertRecord === "function") {
      externalRegistry.assertRecord(kind, candidate);
    } else if (typeof externalRegistry.isTrustedRecord === "function" && !externalRegistry.isTrustedRecord(kind, candidate)) {
      fail("direct_semantic_record_untrusted", `${kind}:${ref}`);
    } else if (typeof externalRegistry.isRecord === "function" && !externalRegistry.isRecord(kind, candidate)) {
      fail("direct_semantic_record_untrusted", `${kind}:${ref}`);
    } else if (typeof externalRegistry.resolveRecord !== "function" && typeof externalRegistry.getRecord !== "function" && typeof externalRegistry.resolve !== "function" && typeof externalRegistry.get !== "function") {
      fail("direct_semantic_record_authority_missing", kind);
    }
    const copyValue = safeRecordCopy(candidate);
    if (refFor(kind, copyValue) !== ref) fail("direct_semantic_record_binding_mismatch", `${kind}:${ref}`);
    const digest = digestFor("direct-semantic-immutable-record", copyValue);
    const priorDigest = externalDigests[kind].get(ref);
    if (priorDigest && priorDigest !== digest) fail("direct_semantic_record_mutated", `${kind}:${ref}`);
    if (!priorDigest) {
      externalDigests[kind].set(ref, digest);
      recordTokens[kind].set(copyValue, { kind, ref, record: copyValue });
      recordByRef[kind].set(ref, copyValue);
    }
    return copyValue;
  }

  function resolve(kind, refValue, candidate) {
    if (!RECORD_KINDS.includes(kind)) fail("direct_semantic_record_kind_invalid", kind);
    const ref = requiredRef(refValue, `${kind}.ref`);
    const local = localResolve(kind, ref, candidate);
    if (local) return local;
    const external = externalResolve(kind, ref);
    if (external) return external;
    fail("direct_semantic_record_missing", `${kind}:${ref}`);
  }

  function assertToken(kind, value) {
    if (!RECORD_KINDS.includes(kind)) fail("direct_semantic_record_kind_invalid", kind);
    const token = recordTokens[kind].get(value);
    if (!token) fail("direct_semantic_record_untrusted", kind);
    return token.record;
  }

  function describe(kind, value) {
    const record = assertToken(kind, value);
    return safeRecordCopy(record);
  }

  return {
    admit,
    resolve,
    assertToken,
    describe,
    registerProjectRegistryRevision: (value) => admit("projectRegistryRevision", value),
    registerTargetSnapshotReceipt: (value) => admit("targetSnapshotReceipt", value),
    registerCompilerPin: (value) => admit("compilerPin", value),
    registerKernelRevision: (value) => admit("kernelRevision", value),
    registerExecutionProfileRevision: (value) => admit("executionProfileRevision", value),
    registerProviderProfileRevision: (value) => admit("providerProfileRevision", value),
    registerAttemptPolicy: (value) => admit("attemptPolicy", value),
    registerProjectionRevision: (value) => admit("projectionRevision", value),
    registerJob: (value) => admit("job", value),
  };
}

function createAuthorizationAuthority(options = {}) {
  ensurePlain(options, "direct_semantic_authorization_options_invalid");
  const principalAuthority = options.principalAuthority;
  const capabilityAuthority = options.capabilityAuthority;
  if (!principalAuthority || typeof principalAuthority.assertTransportPrincipal !== "function" || typeof principalAuthority.assertSemanticPrincipal !== "function") {
    fail("direct_semantic_principal_authority_required");
  }
  if (!capabilityAuthority || typeof capabilityAuthority.assertBoundToPrincipal !== "function" || typeof capabilityAuthority.assertCapability !== "function") {
    fail("direct_semantic_capability_authority_required");
  }
  const records = createRecordAuthority(options.registry || options.recordAuthority);
  const idempotency = new Map();
  const clock = options.now || options.clock;
  const authorityMarker = Object.freeze({});
  const authorityId = options.authorityId === undefined
    ? digestFor("direct-semantic-authorization-authority", { nonce: `${Date.now()}:${Math.random()}` })
    : requiredId(options.authorityId, "authorityId");

  function currentTimestamp() {
    const raw = typeof clock === "function" ? clock() : Date.now();
    const ms = raw instanceof Date ? raw.getTime() : typeof raw === "string" ? Date.parse(raw) : raw;
    if (!Number.isFinite(ms)) fail("direct_semantic_clock_invalid");
    return new Date(ms).toISOString();
  }

  function normalizeRequest(operation, request) {
    if (!OPERATIONS.includes(operation)) fail("direct_semantic_operation_invalid", operation);
    ensurePlain(request, "direct_semantic_request_invalid");
    const candidate = clone(request);
    const definition = REQUEST_FIELDS[operation];
    const allowed = [...definition.required, ...definition.optional];
    rejectUnknownKeys(candidate, allowed, "direct_semantic_request_invalid");
    for (const field of definition.required) if (!has(candidate, field)) fail("direct_semantic_request_missing", field);
    if (candidate.schema !== REQUEST_SCHEMAS[operation]) fail("direct_semantic_request_schema_mismatch");
    for (const field of definition.required) {
      if (["schema", "selectionMode"].includes(field)) continue;
      if (field === "edgeOccurrenceRefs" || field === "requestedCellRefs" || field === "eventTypeFilter") continue;
      if (field === "startingCursor") continue;
      requiredNonEmptyString(candidate[field], field);
    }
    if (candidate.requesterRef !== undefined) requiredNonEmptyString(candidate.requesterRef, "requesterRef");
    if (operation === "submit_job") {
      if (!["partial_selection", "exhaustive_compilation"].includes(candidate.selectionMode)) fail("direct_semantic_selection_mode_invalid");
      const allowEmpty = candidate.selectionMode === "exhaustive_compilation";
      candidate.edgeOccurrenceRefs = list(candidate.edgeOccurrenceRefs, "edgeOccurrenceRefs", allowEmpty);
      if (!allowEmpty && candidate.edgeOccurrenceRefs.length === 0) fail("direct_semantic_selection_empty");
    }
    if (operation === "request_cancel") {
      candidate.requestedCellRefs = list(candidate.requestedCellRefs, "requestedCellRefs", false);
      if (candidate.boundedReason.length > 512) fail("direct_semantic_cancellation_reason_unbounded");
    }
    if (operation === "subscribe_results" && candidate.eventTypeFilter !== undefined) {
      candidate.eventTypeFilter = list(candidate.eventTypeFilter, "eventTypeFilter", true);
      if (candidate.startingCursor !== undefined) candidate.startingCursor = requiredBoundedInteger(candidate.startingCursor, "startingCursor", { minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
    }
    validate(REQUEST_SCHEMAS[operation], candidate, "direct_semantic_request_invalid");
    const normalized = clone(candidate);
    deepFreeze(normalized);
    return normalized;
  }

  function normalizeEstimate(request, supplied) {
    const estimateInput = supplied === undefined ? {
      cells: Array.isArray(request.edgeOccurrenceRefs) ? request.edgeOccurrenceRefs.length : 0,
      replicatesPerCell: 1,
      inputTokens: 0,
      outputTokens: 0,
      costMicrounits: 0,
    } : supplied;
    ensurePlain(estimateInput, "direct_semantic_resource_estimate_invalid");
    const allowed = ["cells", "replicatesPerCell", "inputTokens", "outputTokens", "costMicrounits", "model", "reasoningEffort"];
    for (const key of Object.keys(estimateInput)) if (!allowed.includes(key)) fail("direct_semantic_resource_estimate_invalid", key);
    const number = (key) => requiredBoundedInteger(estimateInput[key] ?? 0, key, { minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
    const normalized = {
      cells: number("cells"),
      replicatesPerCell: number("replicatesPerCell"),
      inputTokens: number("inputTokens"),
      outputTokens: number("outputTokens"),
      costMicrounits: number("costMicrounits"),
    };
    if (estimateInput.model !== undefined) normalized.model = requiredNonEmptyString(estimateInput.model, "model");
    if (estimateInput.reasoningEffort !== undefined) normalized.reasoningEffort = requiredNonEmptyString(estimateInput.reasoningEffort, "reasoningEffort");
    return deepFreeze(normalized);
  }

  function contains(scope, value, label) {
    if (!Array.isArray(scope) || scope.length === 0) fail("direct_semantic_scope_empty", label);
    if (!scope.includes(value)) fail("direct_semantic_scope_denied", label);
  }

  function nonEmptyIntersection(left, right, label) {
    if (!Array.isArray(left) || !Array.isArray(right)) fail("direct_semantic_scope_invalid", label);
    const intersection = left.filter((value) => right.includes(value));
    if (intersection.length === 0) fail("direct_semantic_scope_intersection_empty", label);
    return intersection;
  }

  function assertTrustedCapabilityAndPrincipals(input) {
    const transportPrincipal = input.transportPrincipal;
    const semanticPrincipal = input.semanticPrincipal;
    const transportRecord = principalAuthority.assertTransportPrincipal(transportPrincipal);
    const semanticRecord = principalAuthority.assertSemanticPrincipal(semanticPrincipal);
    const capabilityRecord = capabilityAuthority.assertBoundToPrincipal(input.capability, semanticPrincipal);
    if (semanticRecord.principal.schema !== PRINCIPAL_SCHEMA || transportRecord.principal.schema !== TRANSPORT_SCHEMA) {
      fail("direct_semantic_principal_schema_invalid");
    }
    if (capabilityRecord.capability.schema !== CAPABILITY_SCHEMA) fail("direct_semantic_capability_schema_invalid");
    if (semanticRecord.transportPrincipal && semanticRecord.transportPrincipal !== transportPrincipal) {
      fail("direct_semantic_transport_binding_mismatch");
    }
    const operation = input.operation;
    if (capabilityRecord.operation !== operation) fail("direct_semantic_capability_operation_mismatch");
    const purpose = nonEmptyIntersection(semanticRecord.principal.purposeScopes, capabilityRecord.capability.purposeScopes, "purposeScopes");
    return { transportRecord, semanticRecord, capabilityRecord, purpose };
  }

  function assertProjectAndSnapshot(request, cap) {
    contains(cap.projectRegistryRevisionRefs, request.projectRegistryRevisionRef, "projectRegistryRevisionRef");
    contains(cap.allowedTargetORevisions, request.targetORevision, "targetORevision");
    const project = records.resolve("projectRegistryRevision", request.projectRegistryRevisionRef);
    if (statusInvalid(project)) fail("direct_semantic_project_registry_revision_invalid");
    if (project.projectRef !== request.projectRef) fail("direct_semantic_project_scope_mismatch");
    const snapshot = records.resolve("targetSnapshotReceipt", request.targetSnapshotReceiptRef);
    if (statusInvalid(snapshot)) fail("direct_semantic_snapshot_invalid");
    if (snapshot.projectRegistryRevisionRef !== request.projectRegistryRevisionRef || snapshot.targetORevision !== request.targetORevision) {
      fail("direct_semantic_snapshot_binding_mismatch");
    }
    if (Array.isArray(project.targetRevisionPolicy?.allowedCommits) && project.targetRevisionPolicy.allowedCommits.length > 0 && !project.targetRevisionPolicy.allowedCommits.includes(snapshot.gitCommit)) {
      fail("direct_semantic_target_revision_not_allowed");
    }
    contains(cap.targetSnapshotReceiptRefs, request.targetSnapshotReceiptRef, "targetSnapshotReceiptRef");
    return { project, snapshot };
  }

  function assertCompilerExecutionAndAttempt(request, cap, estimate) {
    contains(cap.compilerPinRefs, request.compilerPinRef, "compilerPinRef");
    contains(cap.executionProfileRevisionRefs, request.executionProfileRevisionRef, "executionProfileRevisionRef");
    contains(cap.attemptPolicyRevisionRefs, request.attemptPolicyRef, "attemptPolicyRef");
    const compiler = records.resolve("compilerPin", request.compilerPinRef);
    if (statusInvalid(compiler)) fail("direct_semantic_compiler_pin_invalid");
    if (compiler.compilerPinRef && compiler.compilerPinRef !== request.compilerPinRef) fail("direct_semantic_compiler_binding_mismatch");

    const execution = records.resolve("executionProfileRevision", request.executionProfileRevisionRef);
    if (statusInvalid(execution)) fail("direct_semantic_execution_profile_invalid");
    const providerRef = execution.providerProfileRevisionRef || execution.providerProfileRef;
    if (!providerRef) fail("direct_semantic_provider_profile_missing");
    contains(cap.providerProfileRevisionRefs, providerRef, "providerProfileRevisionRef");
    const provider = records.resolve("providerProfileRevision", providerRef);
    if (statusInvalid(provider)) fail("direct_semantic_provider_profile_invalid");
    const profileModels = Array.isArray(execution.allowedModels) ? execution.allowedModels : [];
    const profileEfforts = Array.isArray(execution.allowedReasoningEfforts) ? execution.allowedReasoningEfforts : [];
    const modelIntersection = nonEmptyIntersection(cap.allowedModels, profileModels, "allowedModels");
    const effortIntersection = nonEmptyIntersection(cap.allowedReasoningEfforts, profileEfforts, "allowedReasoningEfforts");
    if (estimate.model !== undefined) contains(modelIntersection, estimate.model, "model");
    if (estimate.reasoningEffort !== undefined) contains(effortIntersection, estimate.reasoningEffort, "reasoningEffort");
    if (Array.isArray(execution.attemptPolicyRevisionRefs) && execution.attemptPolicyRevisionRefs.length > 0) contains(execution.attemptPolicyRevisionRefs, request.attemptPolicyRef, "attemptPolicyRef");

    const attemptPolicy = records.resolve("attemptPolicy", request.attemptPolicyRef);
    if (statusInvalid(attemptPolicy)) fail("direct_semantic_attempt_policy_invalid");
    if (attemptPolicy.attemptPolicyRef && attemptPolicy.attemptPolicyRef !== request.attemptPolicyRef) fail("direct_semantic_attempt_policy_binding_mismatch");
    const replicateCount = attemptPolicy.replicateCountPerCell ?? 1;
    if (typeof replicateCount !== "number" || !Number.isSafeInteger(replicateCount) || replicateCount < 1) fail("direct_semantic_attempt_policy_invalid");
    if (replicateCount > cap.maximumReplicatesPerCell) fail("direct_semantic_replicates_quota_exceeded");
    if (estimate.replicatesPerCell < replicateCount) fail("direct_semantic_replicates_underdeclared");
    // Kernels are compiler-owned semantic law, not provider/runtime policy.
    // Submission freezes the capability's exact admissible kernel set; the
    // later ExecutionPlan must intersect every selected cell with that set.
    const kernelRefs = cap.kernelRevisionRefs.slice();
    if (kernelRefs.length === 0) fail("direct_semantic_kernel_binding_missing");
    for (const kernelRef of kernelRefs) {
      contains(cap.kernelRevisionRefs, kernelRef, "kernelRevisionRef");
      const kernel = records.resolve("kernelRevision", kernelRef);
      if (statusInvalid(kernel)) fail("direct_semantic_kernel_revision_invalid");
    }
    return { compiler, execution, provider, attemptPolicy, kernelRefs, modelIntersection, effortIntersection };
  }

  function assertProjection(request, cap) {
    const projectionRef = request.deliveryProjectionRef || request.returnProjectionRef;
    if (!projectionRef) return null;
    contains(cap.returnProjectionRefs, projectionRef, "returnProjectionRef");
    const projection = records.resolve("projectionRevision", projectionRef);
    if (statusInvalid(projection)) fail("direct_semantic_projection_invalid");
    const registered = projection.returnProjectionRef || projection.deliveryProjectionRef || projection.projectionRef;
    if (registered && registered !== projectionRef) fail("direct_semantic_projection_binding_mismatch");
    return projection;
  }

  function assertProjectScope(principalRecord, projectRef, operation) {
    if (operation === "administer_service") return;
    contains(principalRecord.principal.projectScopes, projectRef, "projectScopes");
  }

  function assertJob(request, cap, semanticRecord, operation) {
    contains(cap.jobRefs, request.jobRef, "jobRef");
    const job = records.resolve("job", request.jobRef);
    if (statusInvalid(job)) fail("direct_semantic_job_invalid");
    const projectRef = job.projectRef;
    assertProjectScope(semanticRecord, projectRef, operation);
    const owners = [
      job.admittedPrincipalRef,
      job.ownerPrincipalRef,
      job.principalId,
      ...(Array.isArray(job.authorizedPrincipalRefs) ? job.authorizedPrincipalRefs : []),
    ].filter((value) => typeof value === "string");
    if (!owners.includes(semanticRecord.principal.principalId)) fail("direct_semantic_job_principal_denied");
    if (operation === "read_results" && job.resultsReadable === false) fail("direct_semantic_results_not_readable");
    if (operation === "request_cancel" && (job.cancelable === false || job.completed === true)) fail("direct_semantic_job_not_cancelable");
    return job;
  }

  function assertAdmin(semanticRecord) {
    if (!["operator", "direct_service"].includes(semanticRecord.principal.principalClass)) fail("direct_semantic_admin_principal_required");
  }

  function authorize(input = {}) {
    ensurePlain(input, "direct_semantic_authorization_request_invalid");
    const allowed = [
      "operation", "transportPrincipal", "semanticPrincipal", "capability", "request", "resourceEstimate",
      "model", "reasoningEffort",
    ];
    rejectUnknownKeys(input, allowed, "direct_semantic_authorization_request_invalid");
    const operation = requiredNonEmptyString(input.operation, "operation");
    if (!OPERATIONS.includes(operation)) fail("direct_semantic_operation_invalid", operation);
    const request = normalizeRequest(operation, input.request);
    let estimateInput = input.resourceEstimate;
    if (input.model !== undefined || input.reasoningEffort !== undefined) {
      estimateInput = estimateInput ? { ...estimateInput } : {};
      if (input.model !== undefined) estimateInput.model = input.model;
      if (input.reasoningEffort !== undefined) estimateInput.reasoningEffort = input.reasoningEffort;
    }
    const estimate = normalizeEstimate(request, estimateInput);
    const { transportRecord, semanticRecord, capabilityRecord, purpose } = assertTrustedCapabilityAndPrincipals(input);
    const cap = capabilityRecord.capability;
    if (request.projectRef !== undefined) assertProjectScope(semanticRecord, request.projectRef, operation);
    if (operation === "administer_service") assertAdmin(semanticRecord);

    let project = null;
    let snapshot = null;
    let computation = null;
    let projection = null;
    let job = null;
    if (operation === "prepare_snapshot") {
      contains(cap.projectRegistryRevisionRefs, request.projectRegistryRevisionRef, "projectRegistryRevisionRef");
      contains(cap.allowedTargetORevisions, request.targetORevision, "targetORevision");
      project = records.resolve("projectRegistryRevision", request.projectRegistryRevisionRef);
      if (statusInvalid(project) || project.projectRef !== request.projectRef) fail("direct_semantic_project_registry_revision_invalid");
      if (Array.isArray(project.targetRevisionPolicy?.allowedCommits) && project.targetRevisionPolicy.allowedCommits.length > 0 && !project.targetRevisionPolicy.allowedCommits.includes(request.targetORevision)) fail("direct_semantic_target_revision_not_allowed");
    } else if (operation === "submit_job") {
      ({ project, snapshot } = assertProjectAndSnapshot(request, cap));
      computation = assertCompilerExecutionAndAttempt(request, cap, estimate);
      projection = assertProjection(request, cap);
      if (estimate.cells !== request.edgeOccurrenceRefs.length && request.selectionMode === "partial_selection") fail("direct_semantic_resource_estimate_mismatch");
      if (estimate.cells === 0 && request.selectionMode === "partial_selection") fail("direct_semantic_selection_empty");
    } else if (["inspect_job", "read_results", "subscribe_results", "request_cancel"].includes(operation)) {
      job = assertJob(request, cap, semanticRecord, operation);
      projection = assertProjection(request, cap);
    }

    const requestDigest = digestFor("direct-semantic-canonical-request", request);
    const estimateDigest = digestFor("direct-semantic-resource-estimate", estimate);
    const idempotencyKey = requiredNonEmptyString(request.idempotencyKey, "idempotencyKey");
    const idempotencyId = `${semanticRecord.principal.principalId}\u0000${operation}\u0000${idempotencyKey}`;
    const prior = idempotency.get(idempotencyId);
    if (prior) {
      if (prior.requestDigest !== requestDigest || prior.estimateDigest !== estimateDigest || prior.capabilityId !== cap.capabilityId) fail("direct_semantic_idempotency_conflict");
      return prior.receipt;
    }

    let reservation = null;
    if (operation === "submit_job") {
      // Check only after immutable identity validation and idempotency replay.
      // An exact replay returns its prior reservation instead of being rejected
      // by counters that the original request itself consumed.
      capabilityAuthority.checkQuota(input.capability, estimate);
      reservation = capabilityAuthority.consumeBudget(input.capability, estimate, {
        reservationId: digestFor("direct-semantic-budget-reservation", {
          capabilityId: cap.capabilityId,
          idempotencyKey: request.idempotencyKey,
        }),
      });
    }
    const exactRevisionRefs = {
      ...(request.projectRegistryRevisionRef ? { projectRegistryRevisionRef: request.projectRegistryRevisionRef } : {}),
      ...(request.targetSnapshotReceiptRef ? { targetSnapshotReceiptRef: request.targetSnapshotReceiptRef } : {}),
      ...(request.targetORevision ? { targetORevision: request.targetORevision } : {}),
      ...(request.compilerPinRef ? { compilerPinRef: request.compilerPinRef } : {}),
      ...(request.executionProfileRevisionRef ? { executionProfileRevisionRef: request.executionProfileRevisionRef } : {}),
      ...(request.attemptPolicyRef ? { attemptPolicyRef: request.attemptPolicyRef } : {}),
      ...(request.deliveryProjectionRef ? { deliveryProjectionRef: request.deliveryProjectionRef } : {}),
      ...(request.returnProjectionRef ? { returnProjectionRef: request.returnProjectionRef } : {}),
      ...(computation?.provider?.providerProfileRevisionRef ? { providerProfileRevisionRef: computation.provider.providerProfileRevisionRef } : {}),
      ...(computation?.kernelRefs ? { kernelRevisionRefs: computation.kernelRefs.slice() } : {}),
    };
    const numericBounds = {
      maximumJobs: cap.maximumJobs,
      maximumCellsPerJob: cap.maximumCellsPerJob,
      maximumReplicatesPerCell: cap.maximumReplicatesPerCell,
      maximumInputTokensPerJob: cap.maximumInputTokensPerJob,
      maximumOutputTokensPerJob: cap.maximumOutputTokensPerJob,
      maximumCostMicrounitsPerJob: cap.maximumCostMicrounitsPerJob,
    };
    const body = {
      schema: AUTHORIZATION_SCHEMA,
      operation,
      admittedPrincipalRef: semanticRecord.principal.principalId,
      capabilityRef: cap.capabilityId,
      transportPrincipalDigest: transportRecord.digest,
      requestDigest,
      resourceEstimateDigest: estimateDigest,
      exactRevisionRefs,
      purposeScopes: purpose.slice(),
      numericBounds,
      ...(reservation ? { reservationId: reservation.reservationId, budgetOrdinal: reservation.ordinal } : {}),
      authorizedAt: currentTimestamp(),
      decision: "authorized",
    };
    body.authorizationRef = digestFor(AUTHORIZATION_SCHEMA, body);
    assertExactObject(body, Object.keys(body), "direct_semantic_authorization_receipt_invalid");
    validate(AUTHORIZATION_SCHEMA, body, "direct_semantic_authorization_receipt_invalid");
    deepFreeze(body);
    authorizationReceipts.set(body, {
      authorityId,
      authorityMarker,
      body,
      principal: semanticRecord.principal,
      transportPrincipal: transportRecord.principal,
      capability: cap,
      requestDigest,
      estimateDigest,
    });
    idempotency.set(idempotencyId, { requestDigest, estimateDigest, capabilityId: cap.capabilityId, receipt: body });
    return body;
  }

  function assertAuthorizationReceipt(value) {
    const record = authorizationReceipts.get(value);
    if (!record || record.authorityMarker !== authorityMarker) fail("direct_semantic_authorization_receipt_untrusted");
    return record;
  }

  function isAuthorizationReceipt(value) {
    const record = authorizationReceipts.get(value);
    return Boolean(record && record.authorityMarker === authorityMarker);
  }

  function describeReceipt(value) {
    const record = assertAuthorizationReceipt(value);
    return deepFreeze(clone(record.body));
  }

  function estimateResources(input = {}) {
    ensurePlain(input, "direct_semantic_resource_estimate_invalid");
    if (has(input, "cells") || has(input, "replicatesPerCell") || has(input, "inputTokens") || has(input, "outputTokens") || has(input, "costMicrounits") || has(input, "model") || has(input, "reasoningEffort")) {
      return normalizeEstimate({}, input);
    }
    return normalizeEstimate(input, undefined);
  }

  return deepFreeze({
    authorityId,
    schemas: deepFreeze({ authorization: AUTHORIZATION_SCHEMA }),
    operations: OPERATIONS,
    requestSchemas: REQUEST_SCHEMAS,
    authorize,
    authorizeRequest: authorize,
    authorizeSemanticRequest: authorize,
    checkAuthorization: authorize,
    estimateResources,
    assertAuthorizationReceipt,
    isAuthorizationReceipt,
    describeReceipt,
    registerRecord: records.admit,
    resolveRecord: records.resolve,
    assertRecord: records.assertToken,
    registerProjectRegistryRevision: records.registerProjectRegistryRevision,
    registerTargetSnapshotReceipt: records.registerTargetSnapshotReceipt,
    registerCompilerPin: records.registerCompilerPin,
    registerKernelRevision: records.registerKernelRevision,
    registerExecutionProfileRevision: records.registerExecutionProfileRevision,
    registerProviderProfileRevision: records.registerProviderProfileRevision,
    registerAttemptPolicy: records.registerAttemptPolicy,
    registerProjectionRevision: records.registerProjectionRevision,
    registerJob: records.registerJob,
  });
}

module.exports = {
  AUTHORIZATION_SCHEMA,
  REQUEST_SCHEMAS,
  OPERATIONS,
  RECORD_KINDS,
  createAuthorizationAuthority,
  createDirectSemanticAuthorization: createAuthorizationAuthority,
};
