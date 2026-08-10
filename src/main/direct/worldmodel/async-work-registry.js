"use strict";

const { canonicalJson, sha256 } = require("../meta-session/digest");
const {
  isPlainObject,
  normalizeId,
  normalizeString,
  nowIso,
} = require("../meta-session/ids");

const DIRECT_ASYNC_CONDITION_SCHEMA = "direct_async_condition@1";
const DIRECT_ASYNC_PROGRESS_SIGNAL_SCHEMA = "direct_async_progress_signal@1";
const DIRECT_AWAITABLE_WORK_CONTRACT_SCHEMA = "direct_awaitable_work_contract@1";
const DIRECT_ASYNC_WAKE_POLICY_SCHEMA = "direct_async_wake_policy@1";
const DIRECT_ASYNC_WORK_REGISTRATION_SCHEMA = "direct_async_work_registration@1";
const DIRECT_ASYNC_WORK_STATUS_SNAPSHOT_SCHEMA = "direct_async_work_status_snapshot@1";
const DIRECT_ASYNC_WORK_STATE_TRANSITION_SCHEMA = "direct_async_work_state_transition@1";
const DIRECT_ASYNC_WORK_OUTCOME_SCHEMA = "direct_async_work_outcome@1";
const DIRECT_ASYNC_WORK_REGISTRY_STORE_SCHEMA = "direct_async_work_registry_store@1";
const DIRECT_ASYNC_WORK_META_TOOL_CATALOG_SCHEMA = "direct_async_work_meta_tool_catalog@1";

const ASYNC_WORK_KINDS = Object.freeze([
  "sub_agent",
  "process",
  "browser_worker",
  "download",
  "test_run",
  "external_job",
]);

const ASYNC_WORK_STATUSES = Object.freeze([
  "registered",
  "running",
  "waiting",
  "completed",
  "failed",
  "timed_out",
  "cancelled",
  "stale",
  "unknown",
]);

const ASYNC_WORK_TERMINAL_STATUSES = Object.freeze([
  "completed",
  "failed",
  "timed_out",
  "cancelled",
]);

const ASYNC_CONDITION_KINDS = Object.freeze([
  "process_exit_code",
  "file_exists",
  "file_count_at_least",
  "stdout_pattern",
  "stderr_pattern",
  "artifact_digest_exists",
  "status_snapshot_field",
  "timeout_elapsed",
  "manual_mark",
]);

const ASYNC_PROGRESS_SIGNAL_KINDS = Object.freeze([
  "stdout_pattern",
  "stderr_pattern",
  "file_count",
  "artifact_digest",
  "status_snapshot_field",
  "heartbeat",
  "manual_note",
]);

const ASYNC_CONDITION_OPERATORS = Object.freeze([
  "equals",
  "not_equals",
  "contains",
  "gte",
  "lte",
  "exists",
]);

const ASYNC_REGISTRATION_MODES = Object.freeze([
  "pre_registered",
  "start_registered_atomically",
  "adopted_existing_work",
  "manual_import",
]);

const ASYNC_POLL_STRATEGIES = Object.freeze([
  "harness_default",
  "fixed_interval",
  "event_driven",
  "manual_only",
]);

const ASYNC_RAW_OUTPUT_POLICIES = Object.freeze([
  "summary_only",
  "bounded_excerpt",
  "artifact_ref_only",
  "allowed_by_contract",
]);

const ASYNC_WAKE_ON_VALUES = Object.freeze([
  "completed",
  "failed",
  "completed_or_failed",
  "progress_threshold",
  "manual",
]);

const ASYNC_WAKE_MESSAGE_SHAPES = Object.freeze([
  "status_summary",
  "evidence_packet",
  "manager_remand",
  "custom_contract",
]);

const ASYNC_TRANSITION_REASONS = Object.freeze([
  "registered",
  "started",
  "progress_snapshot",
  "done_condition_met",
  "fail_condition_met",
  "timeout",
  "cancel_requested",
  "cancel_completed",
  "stale_detected",
  "manual_mark",
]);

const ASYNC_PROCESS_OUTCOME_STATUSES = Object.freeze([
  "completed",
  "failed",
  "timed_out",
  "cancelled",
]);

const ASYNC_CONTRACT_OUTCOME_STATUSES = Object.freeze([
  "satisfied",
  "violated",
  "inconclusive",
]);

const ASYNC_META_TOOL_NAMES = Object.freeze([
  "register_async_work",
  "get_async_work_status",
  "list_async_work",
  "cancel_async_work",
  "await_async_work",
]);

const DIGEST_FIELDS = new Set([
  "conditionDigest",
  "signalDigest",
  "contractDigest",
  "wakePolicyDigest",
  "registrationDigest",
  "snapshotDigest",
  "transitionDigest",
  "outcomeDigest",
  "storeDigest",
  "catalogDigest",
]);

function validationError(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  if (detail) error.detail = detail;
  return error;
}

function requirePlainObject(value, label) {
  if (isPlainObject(value)) return value;
  throw validationError("direct_async_work_invalid_object", label);
}

function requireString(value, label) {
  const text = normalizeString(value, "");
  if (text) return text;
  throw validationError("direct_async_work_missing_string", label);
}

function requireArray(value, label) {
  if (Array.isArray(value)) return value;
  throw validationError("direct_async_work_missing_array", label);
}

function pickEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map((entry) => stableValue(entry));
  if (!isPlainObject(value)) return value;
  const output = {};
  for (const key of Object.keys(value).sort()) {
    if (DIGEST_FIELDS.has(key)) continue;
    if (typeof value[key] !== "undefined") output[key] = stableValue(value[key]);
  }
  return output;
}

function digestFor(domain, value) {
  return sha256(`${domain}\0${canonicalJson(stableValue(value), { omitDigestFields: false })}`);
}

function validateDigest(value, fieldName, domain, label) {
  const digest = requireString(value[fieldName], `${label}.${fieldName}`);
  if (digest !== digestFor(domain, value)) {
    throw validationError("direct_async_work_digest_mismatch", `${label}.${fieldName}`);
  }
  return true;
}

function normalizeList(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => normalizeString(value, ""))
    .filter(Boolean))]
    .sort();
}

function refFrom(kind, id, digest, label, extra = {}) {
  return {
    kind: normalizeString(kind, "unknown"),
    id: normalizeString(id, ""),
    digest: normalizeString(digest, ""),
    label: normalizeString(label, kind),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    ...extra,
  };
}

function validateRef(ref, label, options = {}) {
  requirePlainObject(ref, label);
  requireString(ref.kind, `${label}.kind`);
  if (options.requireId !== false) requireString(ref.id, `${label}.id`);
  if (options.requireDigest !== false) requireString(ref.digest, `${label}.digest`);
  if (ref.rawTextIncluded || ref.rawPathIncluded || ref.rawSecretIncluded) {
    throw validationError("direct_async_work_raw_ref_exposure", label);
  }
  return true;
}

function normalizeRefs(values, fallbackKind = "async_work_evidence") {
  return (Array.isArray(values) ? values : [])
    .map((value) => {
      if (!isPlainObject(value)) return null;
      return refFrom(
        value.kind || fallbackKind,
        value.id ||
          value.refId ||
          value.artifactId ||
          value.workId ||
          value.conditionId ||
          value.signalId ||
          value.contractId ||
          value.wakePolicyId ||
          value.snapshotId ||
          value.transitionId ||
          value.outcomeId ||
          value.storeId ||
          value.catalogId,
        value.digest ||
          value.artifactDigest ||
          value.conditionDigest ||
          value.signalDigest ||
          value.contractDigest ||
          value.wakePolicyDigest ||
          value.registrationDigest ||
          value.snapshotDigest ||
          value.transitionDigest ||
          value.outcomeDigest ||
          value.storeDigest ||
          value.catalogDigest ||
          "",
        value.label || value.rendererSafeLabel || fallbackKind,
      );
    })
    .filter((ref) => ref && (ref.id || ref.digest));
}

function targetRefFrom(input = {}, fallbackId = "") {
  const source = isPlainObject(input) ? input : {};
  return refFrom(
    source.kind || "async_work_target",
    source.id || source.refId || source.artifactId || fallbackId,
    source.digest || source.artifactDigest || "",
    source.label || source.rendererSafeLabel || "Async work target",
  );
}

function conditionRef(condition = {}) {
  return refFrom("async_condition", condition.conditionId, condition.conditionDigest, condition.kind);
}

function signalRef(signal = {}) {
  return refFrom("async_progress_signal", signal.signalId, signal.signalDigest, signal.kind);
}

function contractRef(contract = {}) {
  return refFrom("awaitable_work_contract", contract.contractId, contract.contractDigest, contract.purpose, {
    pollStrategy: normalizeString(contract.pollStrategy, ""),
  });
}

function wakePolicyRef(policy = {}) {
  return refFrom("async_wake_policy", policy.wakePolicyId, policy.wakePolicyDigest, policy.wakeOn, {
    messageShape: normalizeString(policy.messageShape, ""),
  });
}

function snapshotRef(snapshot = {}) {
  return refFrom("async_work_status_snapshot", snapshot.snapshotId, snapshot.snapshotDigest, snapshot.status, {
    workId: normalizeString(snapshot.workId, ""),
  });
}

function transitionRef(transition = {}) {
  return refFrom("async_work_state_transition", transition.transitionId, transition.transitionDigest, transition.toStatus, {
    workId: normalizeString(transition.workId, ""),
    sequence: Number(transition.sequence || 0),
  });
}

function registrationRef(registration = {}) {
  return refFrom("async_work_registration", registration.workId, registration.registrationDigest, registration.kind, {
    status: normalizeString(registration.status, ""),
  });
}

function validateRefMatches(ref, expectedRef, label) {
  validateRef(ref, label);
  for (const field of ["kind", "id", "digest"]) {
    if (ref[field] !== expectedRef[field]) {
      throw validationError("direct_async_work_ref_mismatch", `${label}.${field}`);
    }
  }
  return true;
}

function buildAsyncCondition(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const kind = pickEnum(source.kind, ASYNC_CONDITION_KINDS, "manual_mark");
  const condition = {
    schema: DIRECT_ASYNC_CONDITION_SCHEMA,
    conditionId: normalizeId(source.conditionId, "async_condition"),
    kind,
    targetRef: targetRefFrom(source.targetRef, source.conditionId || kind),
    operator: pickEnum(source.operator, ASYNC_CONDITION_OPERATORS, kind.endsWith("_exists") || kind === "file_exists" ? "exists" : "equals"),
    expected: ["string", "number", "boolean"].includes(typeof source.expected) ? source.expected : "",
    evidenceRequired: source.evidenceRequired !== false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    createdAt: normalizeString(source.createdAt, nowIso(options.now || Date.now)),
  };
  condition.conditionDigest = digestFor("direct-async-condition@1", condition);
  return condition;
}

function validateAsyncCondition(condition) {
  requirePlainObject(condition, "asyncCondition");
  if (condition.schema !== DIRECT_ASYNC_CONDITION_SCHEMA) throw validationError("direct_async_work_schema_mismatch", "asyncCondition");
  requireString(condition.conditionId, "asyncCondition.conditionId");
  if (!ASYNC_CONDITION_KINDS.includes(condition.kind)) throw validationError("direct_async_work_invalid_condition_kind", "asyncCondition.kind");
  validateRef(condition.targetRef, "asyncCondition.targetRef", { requireDigest: false });
  if (!ASYNC_CONDITION_OPERATORS.includes(condition.operator)) throw validationError("direct_async_work_invalid_operator", "asyncCondition.operator");
  if (condition.evidenceRequired !== true && condition.evidenceRequired !== false) throw validationError("direct_async_work_invalid_boolean", "asyncCondition.evidenceRequired");
  if (condition.rawTextIncluded || condition.rawPathIncluded || condition.rawSecretIncluded) {
    throw validationError("direct_async_work_raw_exposure", "asyncCondition");
  }
  validateDigest(condition, "conditionDigest", "direct-async-condition@1", "asyncCondition");
  return true;
}

function buildAsyncProgressSignal(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const kind = pickEnum(source.kind, ASYNC_PROGRESS_SIGNAL_KINDS, "manual_note");
  const signal = {
    schema: DIRECT_ASYNC_PROGRESS_SIGNAL_SCHEMA,
    signalId: normalizeId(source.signalId, "async_progress_signal"),
    kind,
    targetRef: targetRefFrom(source.targetRef, source.signalId || kind),
    summary: normalizeString(source.summary, kind),
    evidenceRefs: normalizeRefs(source.evidenceRefs, "async_progress_evidence"),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    createdAt: normalizeString(source.createdAt, nowIso(options.now || Date.now)),
  };
  signal.signalDigest = digestFor("direct-async-progress-signal@1", signal);
  return signal;
}

function validateAsyncProgressSignal(signal) {
  requirePlainObject(signal, "asyncProgressSignal");
  if (signal.schema !== DIRECT_ASYNC_PROGRESS_SIGNAL_SCHEMA) throw validationError("direct_async_work_schema_mismatch", "asyncProgressSignal");
  requireString(signal.signalId, "asyncProgressSignal.signalId");
  if (!ASYNC_PROGRESS_SIGNAL_KINDS.includes(signal.kind)) throw validationError("direct_async_work_invalid_signal_kind", "asyncProgressSignal.kind");
  validateRef(signal.targetRef, "asyncProgressSignal.targetRef", { requireDigest: false });
  requireString(signal.summary, "asyncProgressSignal.summary");
  requireArray(signal.evidenceRefs, "asyncProgressSignal.evidenceRefs");
  signal.evidenceRefs.forEach((ref, index) => validateRef(ref, `asyncProgressSignal.evidenceRefs.${index}`, { requireDigest: false }));
  if (signal.rawTextIncluded || signal.rawPathIncluded || signal.rawSecretIncluded) {
    throw validationError("direct_async_work_raw_exposure", "asyncProgressSignal");
  }
  validateDigest(signal, "signalDigest", "direct-async-progress-signal@1", "asyncProgressSignal");
  return true;
}

function buildAwaitableWorkContract(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const doneConditions = (Array.isArray(source.doneConditions) && source.doneConditions.length
    ? source.doneConditions
    : [{ kind: "manual_mark", conditionId: "async_done_manual", targetRef: source.targetRef }])
    .map((condition) => condition?.schema === DIRECT_ASYNC_CONDITION_SCHEMA ? condition : buildAsyncCondition(condition, options));
  const failConditions = (Array.isArray(source.failConditions) ? source.failConditions : [])
    .map((condition) => condition?.schema === DIRECT_ASYNC_CONDITION_SCHEMA ? condition : buildAsyncCondition(condition, options));
  const progressSignals = (Array.isArray(source.progressSignals) ? source.progressSignals : [])
    .map((signal) => signal?.schema === DIRECT_ASYNC_PROGRESS_SIGNAL_SCHEMA ? signal : buildAsyncProgressSignal(signal, options));
  const contract = {
    schema: DIRECT_AWAITABLE_WORK_CONTRACT_SCHEMA,
    contractId: normalizeId(source.contractId, "awaitable_work_contract"),
    purpose: normalizeString(source.purpose, "Track registered async work until a typed condition is observed."),
    expectedOutputs: normalizeList(source.expectedOutputs),
    doneConditions,
    failConditions,
    progressSignals,
    timeoutMs: Number.isFinite(Number(source.timeoutMs)) && Number(source.timeoutMs) > 0 ? Number(source.timeoutMs) : 0,
    pollStrategy: pickEnum(source.pollStrategy, ASYNC_POLL_STRATEGIES, "harness_default"),
    rawOutputPolicy: pickEnum(source.rawOutputPolicy, ASYNC_RAW_OUTPUT_POLICIES, "summary_only"),
    harnessOwnsPolling: true,
    modelShouldPollLowLevelTools: false,
    providerWakeEnabledInThisPr: false,
    rawOutputIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    createdAt: normalizeString(source.createdAt, nowIso(options.now || Date.now)),
  };
  contract.contractDigest = digestFor("direct-awaitable-work-contract@1", contract);
  return contract;
}

function validateAwaitableWorkContract(contract) {
  requirePlainObject(contract, "awaitableWorkContract");
  if (contract.schema !== DIRECT_AWAITABLE_WORK_CONTRACT_SCHEMA) throw validationError("direct_async_work_schema_mismatch", "awaitableWorkContract");
  requireString(contract.contractId, "awaitableWorkContract.contractId");
  requireString(contract.purpose, "awaitableWorkContract.purpose");
  requireArray(contract.expectedOutputs, "awaitableWorkContract.expectedOutputs");
  requireArray(contract.doneConditions, "awaitableWorkContract.doneConditions");
  if (!contract.doneConditions.length) throw validationError("direct_async_work_missing_done_condition", "awaitableWorkContract.doneConditions");
  contract.doneConditions.forEach(validateAsyncCondition);
  requireArray(contract.failConditions, "awaitableWorkContract.failConditions");
  contract.failConditions.forEach(validateAsyncCondition);
  requireArray(contract.progressSignals, "awaitableWorkContract.progressSignals");
  contract.progressSignals.forEach(validateAsyncProgressSignal);
  if (!ASYNC_POLL_STRATEGIES.includes(contract.pollStrategy)) throw validationError("direct_async_work_invalid_poll_strategy", "awaitableWorkContract.pollStrategy");
  if (!ASYNC_RAW_OUTPUT_POLICIES.includes(contract.rawOutputPolicy)) throw validationError("direct_async_work_invalid_raw_output_policy", "awaitableWorkContract.rawOutputPolicy");
  if (contract.harnessOwnsPolling !== true || contract.modelShouldPollLowLevelTools !== false || contract.providerWakeEnabledInThisPr !== false) {
    throw validationError("direct_async_work_authority_leak", "awaitableWorkContract.polling");
  }
  if (contract.rawOutputIncluded || contract.rawTextIncluded || contract.rawPathIncluded || contract.rawSecretIncluded) {
    throw validationError("direct_async_work_raw_exposure", "awaitableWorkContract");
  }
  validateDigest(contract, "contractDigest", "direct-awaitable-work-contract@1", "awaitableWorkContract");
  return true;
}

function buildAsyncWakePolicy(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const policy = {
    schema: DIRECT_ASYNC_WAKE_POLICY_SCHEMA,
    wakePolicyId: normalizeId(source.wakePolicyId, "async_wake_policy"),
    wakeOwnerAgent: source.wakeOwnerAgent !== false,
    wakeThreadManager: source.wakeThreadManager === true,
    wakeWorldmodelManager: source.wakeWorldmodelManager === true,
    wakeOn: pickEnum(source.wakeOn, ASYNC_WAKE_ON_VALUES, "completed_or_failed"),
    messageShape: pickEnum(source.messageShape, ASYNC_WAKE_MESSAGE_SHAPES, "status_summary"),
    automaticProviderWakeEnabledInThisPr: false,
    wakeQueueEnabledInThisPr: false,
    rawWakePayloadIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    createdAt: normalizeString(source.createdAt, nowIso(options.now || Date.now)),
  };
  policy.wakePolicyDigest = digestFor("direct-async-wake-policy@1", policy);
  return policy;
}

function validateAsyncWakePolicy(policy) {
  requirePlainObject(policy, "asyncWakePolicy");
  if (policy.schema !== DIRECT_ASYNC_WAKE_POLICY_SCHEMA) throw validationError("direct_async_work_schema_mismatch", "asyncWakePolicy");
  requireString(policy.wakePolicyId, "asyncWakePolicy.wakePolicyId");
  if (!ASYNC_WAKE_ON_VALUES.includes(policy.wakeOn)) throw validationError("direct_async_work_invalid_wake_on", "asyncWakePolicy.wakeOn");
  if (!ASYNC_WAKE_MESSAGE_SHAPES.includes(policy.messageShape)) throw validationError("direct_async_work_invalid_message_shape", "asyncWakePolicy.messageShape");
  for (const flag of ["wakeOwnerAgent", "wakeThreadManager", "wakeWorldmodelManager"]) {
    if (policy[flag] !== true && policy[flag] !== false) throw validationError("direct_async_work_invalid_boolean", `asyncWakePolicy.${flag}`);
  }
  if (policy.automaticProviderWakeEnabledInThisPr !== false || policy.wakeQueueEnabledInThisPr !== false) {
    throw validationError("direct_async_work_authority_leak", "asyncWakePolicy");
  }
  if (policy.rawWakePayloadIncluded || policy.rawTextIncluded || policy.rawPathIncluded || policy.rawSecretIncluded) {
    throw validationError("direct_async_work_raw_exposure", "asyncWakePolicy");
  }
  validateDigest(policy, "wakePolicyDigest", "direct-async-wake-policy@1", "asyncWakePolicy");
  return true;
}

function targetRefObject(input = {}) {
  const source = isPlainObject(input) ? input : {};
  return {
    pid: Number.isInteger(source.pid) && source.pid > 0 ? source.pid : 0,
    subAgentId: normalizeString(source.subAgentId, ""),
    threadId: normalizeString(source.threadId, ""),
    browserSessionId: normalizeString(source.browserSessionId, ""),
    artifactRef: source.artifactRef ? targetRefFrom(source.artifactRef) : null,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function validateTargetRefObject(targetRef, label = "asyncWorkRegistration.targetRef") {
  requirePlainObject(targetRef, label);
  if (targetRef.artifactRef) validateRef(targetRef.artifactRef, `${label}.artifactRef`, { requireDigest: false });
  if (targetRef.rawTextIncluded || targetRef.rawPathIncluded || targetRef.rawSecretIncluded) {
    throw validationError("direct_async_work_raw_exposure", label);
  }
  return true;
}

function buildAsyncWorkRegistration(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const contract = source.contract?.schema === DIRECT_AWAITABLE_WORK_CONTRACT_SCHEMA
    ? source.contract
    : buildAwaitableWorkContract(source.contract || source.awaitableWorkContract || {}, options);
  const wakePolicy = source.wakePolicy?.schema === DIRECT_ASYNC_WAKE_POLICY_SCHEMA
    ? source.wakePolicy
    : buildAsyncWakePolicy(source.wakePolicy || {}, options);
  validateAwaitableWorkContract(contract);
  validateAsyncWakePolicy(wakePolicy);
  const registration = {
    schema: DIRECT_ASYNC_WORK_REGISTRATION_SCHEMA,
    workId: normalizeId(source.workId, "async_work"),
    ownerAgentId: normalizeId(source.ownerAgentId, "agent_worker"),
    parentTurnId: normalizeString(source.parentTurnId || source.turnId, ""),
    workThreadId: normalizeString(source.workThreadId, ""),
    kind: pickEnum(source.kind, ASYNC_WORK_KINDS, "external_job"),
    targetRef: targetRefObject(source.targetRef),
    contract,
    contractRef: contractRef(contract),
    registrationMode: pickEnum(source.registrationMode, ASYNC_REGISTRATION_MODES, "pre_registered"),
    startedByHarness: source.startedByHarness === true,
    adoptionEvidenceRefs: normalizeRefs(source.adoptionEvidenceRefs, "async_work_adoption_evidence"),
    status: pickEnum(source.status, ASYNC_WORK_STATUSES, "registered"),
    latestSnapshotRef: source.latestSnapshotRef || null,
    wakePolicy,
    wakePolicyRef: wakePolicyRef(wakePolicy),
    sourceRefs: normalizeRefs(source.sourceRefs, "async_work_source"),
    liveProcessStartedInThisPr: false,
    providerWakeStartedInThisPr: false,
    cancellationTransportEnabledInThisPr: false,
    rawTargetPayloadIncluded: false,
    rawOutputIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    registeredAt: normalizeString(source.registeredAt, nowIso(options.now || Date.now)),
  };
  registration.registrationDigest = digestFor("direct-async-work-registration@1", registration);
  return registration;
}

function validateAsyncWorkRegistration(registration) {
  requirePlainObject(registration, "asyncWorkRegistration");
  if (registration.schema !== DIRECT_ASYNC_WORK_REGISTRATION_SCHEMA) throw validationError("direct_async_work_schema_mismatch", "asyncWorkRegistration");
  requireString(registration.workId, "asyncWorkRegistration.workId");
  requireString(registration.ownerAgentId, "asyncWorkRegistration.ownerAgentId");
  if (!ASYNC_WORK_KINDS.includes(registration.kind)) throw validationError("direct_async_work_invalid_kind", "asyncWorkRegistration.kind");
  validateTargetRefObject(registration.targetRef);
  validateAwaitableWorkContract(registration.contract);
  validateRefMatches(registration.contractRef, contractRef(registration.contract), "asyncWorkRegistration.contractRef");
  if (!ASYNC_REGISTRATION_MODES.includes(registration.registrationMode)) throw validationError("direct_async_work_invalid_registration_mode", "asyncWorkRegistration.registrationMode");
  if (registration.startedByHarness !== true && registration.startedByHarness !== false) throw validationError("direct_async_work_invalid_boolean", "asyncWorkRegistration.startedByHarness");
  if (!ASYNC_WORK_STATUSES.includes(registration.status)) throw validationError("direct_async_work_invalid_status", "asyncWorkRegistration.status");
  if (registration.latestSnapshotRef) validateRef(registration.latestSnapshotRef, "asyncWorkRegistration.latestSnapshotRef");
  validateAsyncWakePolicy(registration.wakePolicy);
  validateRefMatches(registration.wakePolicyRef, wakePolicyRef(registration.wakePolicy), "asyncWorkRegistration.wakePolicyRef");
  requireArray(registration.adoptionEvidenceRefs, "asyncWorkRegistration.adoptionEvidenceRefs");
  registration.adoptionEvidenceRefs.forEach((ref, index) => validateRef(ref, `asyncWorkRegistration.adoptionEvidenceRefs.${index}`, { requireDigest: false }));
  requireArray(registration.sourceRefs, "asyncWorkRegistration.sourceRefs");
  registration.sourceRefs.forEach((ref, index) => validateRef(ref, `asyncWorkRegistration.sourceRefs.${index}`, { requireDigest: false }));
  for (const flag of ["liveProcessStartedInThisPr", "providerWakeStartedInThisPr", "cancellationTransportEnabledInThisPr"]) {
    if (registration[flag] !== false) throw validationError("direct_async_work_authority_leak", `asyncWorkRegistration.${flag}`);
  }
  if (registration.rawTargetPayloadIncluded || registration.rawOutputIncluded || registration.rawTextIncluded || registration.rawPathIncluded || registration.rawSecretIncluded) {
    throw validationError("direct_async_work_raw_exposure", "asyncWorkRegistration");
  }
  validateDigest(registration, "registrationDigest", "direct-async-work-registration@1", "asyncWorkRegistration");
  return true;
}

function buildAsyncWorkStatusSnapshot(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const snapshot = {
    schema: DIRECT_ASYNC_WORK_STATUS_SNAPSHOT_SCHEMA,
    snapshotId: normalizeId(source.snapshotId, "async_work_status_snapshot"),
    workId: requireString(source.workId, "asyncWorkStatusSnapshot.workId"),
    status: pickEnum(source.status, ASYNC_WORK_STATUSES, "unknown"),
    progressSummary: normalizeString(source.progressSummary, ""),
    matchedConditionRefs: normalizeRefs(source.matchedConditionRefs, "async_condition"),
    evidenceRefs: normalizeRefs(source.evidenceRefs, "async_work_status_evidence"),
    rawOutputIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    observedAt: normalizeString(source.observedAt, nowIso(options.now || Date.now)),
  };
  snapshot.snapshotDigest = digestFor("direct-async-work-status-snapshot@1", snapshot);
  return snapshot;
}

function validateAsyncWorkStatusSnapshot(snapshot) {
  requirePlainObject(snapshot, "asyncWorkStatusSnapshot");
  if (snapshot.schema !== DIRECT_ASYNC_WORK_STATUS_SNAPSHOT_SCHEMA) throw validationError("direct_async_work_schema_mismatch", "asyncWorkStatusSnapshot");
  requireString(snapshot.snapshotId, "asyncWorkStatusSnapshot.snapshotId");
  requireString(snapshot.workId, "asyncWorkStatusSnapshot.workId");
  if (!ASYNC_WORK_STATUSES.includes(snapshot.status)) throw validationError("direct_async_work_invalid_status", "asyncWorkStatusSnapshot.status");
  requireArray(snapshot.matchedConditionRefs, "asyncWorkStatusSnapshot.matchedConditionRefs");
  snapshot.matchedConditionRefs.forEach((ref, index) => validateRef(ref, `asyncWorkStatusSnapshot.matchedConditionRefs.${index}`, { requireDigest: false }));
  requireArray(snapshot.evidenceRefs, "asyncWorkStatusSnapshot.evidenceRefs");
  snapshot.evidenceRefs.forEach((ref, index) => validateRef(ref, `asyncWorkStatusSnapshot.evidenceRefs.${index}`, { requireDigest: false }));
  if (snapshot.rawOutputIncluded || snapshot.rawTextIncluded || snapshot.rawPathIncluded || snapshot.rawSecretIncluded) {
    throw validationError("direct_async_work_raw_exposure", "asyncWorkStatusSnapshot");
  }
  validateDigest(snapshot, "snapshotDigest", "direct-async-work-status-snapshot@1", "asyncWorkStatusSnapshot");
  return true;
}

function buildAsyncWorkStateTransition(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const fromStatus = pickEnum(source.fromStatus, ASYNC_WORK_STATUSES, "unknown");
  const toStatus = pickEnum(source.toStatus, ASYNC_WORK_STATUSES, "registered");
  const transition = {
    schema: DIRECT_ASYNC_WORK_STATE_TRANSITION_SCHEMA,
    transitionId: normalizeId(source.transitionId, "async_work_state_transition"),
    workId: requireString(source.workId, "asyncWorkStateTransition.workId"),
    sequence: Number.isInteger(source.sequence) && source.sequence > 0 ? source.sequence : 1,
    previousTransitionDigest: normalizeString(source.previousTransitionDigest, ""),
    fromStatus,
    toStatus,
    reason: pickEnum(source.reason, ASYNC_TRANSITION_REASONS, toStatus === "registered" ? "registered" : "progress_snapshot"),
    snapshotRef: source.snapshotRef || null,
    evidenceRefs: normalizeRefs(source.evidenceRefs, "async_work_transition_evidence"),
    rawOutputIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    observedAt: normalizeString(source.observedAt, nowIso(options.now || Date.now)),
  };
  transition.transitionDigest = digestFor("direct-async-work-state-transition@1", transition);
  return transition;
}

function validateAsyncWorkStateTransition(transition) {
  requirePlainObject(transition, "asyncWorkStateTransition");
  if (transition.schema !== DIRECT_ASYNC_WORK_STATE_TRANSITION_SCHEMA) throw validationError("direct_async_work_schema_mismatch", "asyncWorkStateTransition");
  requireString(transition.transitionId, "asyncWorkStateTransition.transitionId");
  requireString(transition.workId, "asyncWorkStateTransition.workId");
  if (!Number.isInteger(transition.sequence) || transition.sequence < 1) throw validationError("direct_async_work_invalid_sequence", "asyncWorkStateTransition.sequence");
  if (!ASYNC_WORK_STATUSES.includes(transition.fromStatus) || !ASYNC_WORK_STATUSES.includes(transition.toStatus)) {
    throw validationError("direct_async_work_invalid_status", "asyncWorkStateTransition.status");
  }
  if (!ASYNC_TRANSITION_REASONS.includes(transition.reason)) throw validationError("direct_async_work_invalid_transition_reason", "asyncWorkStateTransition.reason");
  if (transition.snapshotRef) validateRef(transition.snapshotRef, "asyncWorkStateTransition.snapshotRef");
  requireArray(transition.evidenceRefs, "asyncWorkStateTransition.evidenceRefs");
  transition.evidenceRefs.forEach((ref, index) => validateRef(ref, `asyncWorkStateTransition.evidenceRefs.${index}`, { requireDigest: false }));
  if (transition.rawOutputIncluded || transition.rawTextIncluded || transition.rawPathIncluded || transition.rawSecretIncluded) {
    throw validationError("direct_async_work_raw_exposure", "asyncWorkStateTransition");
  }
  validateDigest(transition, "transitionDigest", "direct-async-work-state-transition@1", "asyncWorkStateTransition");
  return true;
}

function buildAsyncWorkOutcome(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const outcome = {
    schema: DIRECT_ASYNC_WORK_OUTCOME_SCHEMA,
    outcomeId: normalizeId(source.outcomeId, "async_work_outcome"),
    workId: requireString(source.workId, "asyncWorkOutcome.workId"),
    processStatus: pickEnum(source.processStatus, ASYNC_PROCESS_OUTCOME_STATUSES, "completed"),
    contractStatus: pickEnum(source.contractStatus, ASYNC_CONTRACT_OUTCOME_STATUSES, "inconclusive"),
    closureReportRef: source.closureReportRef ? targetRefFrom(source.closureReportRef) : null,
    evidenceRefs: normalizeRefs(source.evidenceRefs, "async_work_outcome_evidence"),
    processCompletionDoesNotImplyContractSuccess: true,
    rawOutputIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    observedAt: normalizeString(source.observedAt, nowIso(options.now || Date.now)),
  };
  outcome.outcomeDigest = digestFor("direct-async-work-outcome@1", outcome);
  return outcome;
}

function validateAsyncWorkOutcome(outcome) {
  requirePlainObject(outcome, "asyncWorkOutcome");
  if (outcome.schema !== DIRECT_ASYNC_WORK_OUTCOME_SCHEMA) throw validationError("direct_async_work_schema_mismatch", "asyncWorkOutcome");
  requireString(outcome.outcomeId, "asyncWorkOutcome.outcomeId");
  requireString(outcome.workId, "asyncWorkOutcome.workId");
  if (!ASYNC_PROCESS_OUTCOME_STATUSES.includes(outcome.processStatus)) throw validationError("direct_async_work_invalid_process_status", "asyncWorkOutcome.processStatus");
  if (!ASYNC_CONTRACT_OUTCOME_STATUSES.includes(outcome.contractStatus)) throw validationError("direct_async_work_invalid_contract_status", "asyncWorkOutcome.contractStatus");
  if (outcome.closureReportRef) validateRef(outcome.closureReportRef, "asyncWorkOutcome.closureReportRef", { requireDigest: false });
  requireArray(outcome.evidenceRefs, "asyncWorkOutcome.evidenceRefs");
  outcome.evidenceRefs.forEach((ref, index) => validateRef(ref, `asyncWorkOutcome.evidenceRefs.${index}`, { requireDigest: false }));
  if (outcome.processCompletionDoesNotImplyContractSuccess !== true) throw validationError("direct_async_work_contract_violation", "asyncWorkOutcome.processCompletionDoesNotImplyContractSuccess");
  if (outcome.rawOutputIncluded || outcome.rawTextIncluded || outcome.rawPathIncluded || outcome.rawSecretIncluded) {
    throw validationError("direct_async_work_raw_exposure", "asyncWorkOutcome");
  }
  validateDigest(outcome, "outcomeDigest", "direct-async-work-outcome@1", "asyncWorkOutcome");
  return true;
}

function deriveCurrentStatuses(registrations = [], transitions = [], snapshots = [], outcomes = []) {
  const byWork = new Map();
  for (const registration of registrations) {
    byWork.set(registration.workId, {
      workId: registration.workId,
      kind: registration.kind,
      registeredStatus: registration.status,
      currentStatus: registration.status,
      latestTransitionRef: null,
      latestSnapshotRef: registration.latestSnapshotRef || null,
      outcomeRef: null,
      terminal: ASYNC_WORK_TERMINAL_STATUSES.includes(registration.status),
    });
  }
  const sortedTransitions = [...transitions].sort((a, b) => a.sequence - b.sequence || a.transitionId.localeCompare(b.transitionId));
  for (const transition of sortedTransitions) {
    const current = byWork.get(transition.workId) || {
      workId: transition.workId,
      kind: "unknown",
      registeredStatus: "unknown",
      currentStatus: "unknown",
      latestTransitionRef: null,
      latestSnapshotRef: null,
      outcomeRef: null,
      terminal: false,
    };
    current.currentStatus = transition.toStatus;
    current.latestTransitionRef = transitionRef(transition);
    if (transition.snapshotRef) current.latestSnapshotRef = transition.snapshotRef;
    current.terminal = ASYNC_WORK_TERMINAL_STATUSES.includes(transition.toStatus);
    byWork.set(transition.workId, current);
  }
  const sortedSnapshots = [...snapshots].sort((a, b) =>
    a.observedAt.localeCompare(b.observedAt) || a.snapshotId.localeCompare(b.snapshotId));
  for (const snapshot of sortedSnapshots) {
    const current = byWork.get(snapshot.workId);
    if (current) current.latestSnapshotRef = snapshotRef(snapshot);
  }
  for (const outcome of outcomes) {
    const current = byWork.get(outcome.workId);
    if (current) {
      current.outcomeRef = refFrom("async_work_outcome", outcome.outcomeId, outcome.outcomeDigest, outcome.contractStatus, {
        processStatus: outcome.processStatus,
      });
      current.terminal = true;
    }
  }
  return Object.fromEntries([...byWork.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function validateTransitionSequenceIntegrity(registrations = [], transitions = []) {
  const registrationStatusByWorkId = new Map(registrations.map((registration) => [
    registration.workId,
    registration.status,
  ]));
  const transitionsByWorkId = new Map();
  for (const transition of transitions) {
    if (!transitionsByWorkId.has(transition.workId)) transitionsByWorkId.set(transition.workId, []);
    transitionsByWorkId.get(transition.workId).push(transition);
  }

  for (const [workId, workTransitions] of transitionsByWorkId.entries()) {
    if (!registrationStatusByWorkId.has(workId)) {
      throw validationError("direct_async_work_unregistered_transition", workId);
    }
    const sorted = [...workTransitions].sort((a, b) => a.sequence - b.sequence || a.transitionId.localeCompare(b.transitionId));
    const seenSequences = new Set();
    let previousTransition = null;
    for (const transition of sorted) {
      if (seenSequences.has(transition.sequence)) {
        throw validationError("direct_async_work_transition_sequence_duplicate", `${workId}.${transition.sequence}`);
      }
      seenSequences.add(transition.sequence);

      if (!previousTransition) {
        const registeredStatus = registrationStatusByWorkId.get(workId);
        const firstFromStatuses = new Set(["unknown"]);
        if (registeredStatus) firstFromStatuses.add(registeredStatus);
        if (!firstFromStatuses.has(transition.fromStatus)) {
          throw validationError("direct_async_work_transition_chain_violation", `${workId}.${transition.transitionId}.fromStatus`);
        }
      } else {
        if (transition.fromStatus !== previousTransition.toStatus) {
          throw validationError("direct_async_work_transition_chain_violation", `${workId}.${transition.transitionId}.fromStatus`);
        }
        if (transition.previousTransitionDigest && transition.previousTransitionDigest !== previousTransition.transitionDigest) {
          throw validationError("direct_async_work_transition_digest_chain_violation", `${workId}.${transition.transitionId}.previousTransitionDigest`);
        }
      }
      previousTransition = transition;
    }
  }
  return true;
}

function buildAsyncWorkRegistryStore(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const registrations = (Array.isArray(source.registrations) ? source.registrations : [])
    .map((registration) => registration?.schema === DIRECT_ASYNC_WORK_REGISTRATION_SCHEMA ? registration : buildAsyncWorkRegistration(registration, options));
  const snapshots = (Array.isArray(source.snapshots) ? source.snapshots : [])
    .map((snapshot) => snapshot?.schema === DIRECT_ASYNC_WORK_STATUS_SNAPSHOT_SCHEMA ? snapshot : buildAsyncWorkStatusSnapshot(snapshot, options));
  const transitions = (Array.isArray(source.transitions) ? source.transitions : [])
    .map((transition) => transition?.schema === DIRECT_ASYNC_WORK_STATE_TRANSITION_SCHEMA ? transition : buildAsyncWorkStateTransition(transition, options));
  const outcomes = (Array.isArray(source.outcomes) ? source.outcomes : [])
    .map((outcome) => outcome?.schema === DIRECT_ASYNC_WORK_OUTCOME_SCHEMA ? outcome : buildAsyncWorkOutcome(outcome, options));
  registrations.forEach(validateAsyncWorkRegistration);
  snapshots.forEach(validateAsyncWorkStatusSnapshot);
  transitions.forEach(validateAsyncWorkStateTransition);
  outcomes.forEach(validateAsyncWorkOutcome);
  validateTransitionSequenceIntegrity(registrations, transitions);
  const store = {
    schema: DIRECT_ASYNC_WORK_REGISTRY_STORE_SCHEMA,
    storeId: normalizeId(source.storeId, "async_work_registry_store"),
    projectId: normalizeString(source.projectId, ""),
    workThreadId: normalizeString(source.workThreadId, ""),
    appendOnlyTransitions: true,
    registrationCount: registrations.length,
    snapshotCount: snapshots.length,
    transitionCount: transitions.length,
    outcomeCount: outcomes.length,
    registrations,
    snapshots,
    transitions,
    outcomes,
    currentStatusByWorkId: deriveCurrentStatuses(registrations, transitions, snapshots, outcomes),
    liveProcessManagerEnabledInThisPr: false,
    automaticWakeEnabledInThisPr: false,
    providerTransportEnabledInThisPr: false,
    cancellationTransportEnabledInThisPr: false,
    rawOutputIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    createdAt: normalizeString(source.createdAt, nowIso(options.now || Date.now)),
  };
  store.storeDigest = digestFor("direct-async-work-registry-store@1", store);
  return store;
}

function validateAsyncWorkRegistryStore(store) {
  requirePlainObject(store, "asyncWorkRegistryStore");
  if (store.schema !== DIRECT_ASYNC_WORK_REGISTRY_STORE_SCHEMA) throw validationError("direct_async_work_schema_mismatch", "asyncWorkRegistryStore");
  requireString(store.storeId, "asyncWorkRegistryStore.storeId");
  if (store.appendOnlyTransitions !== true) throw validationError("direct_async_work_contract_violation", "asyncWorkRegistryStore.appendOnlyTransitions");
  requireArray(store.registrations, "asyncWorkRegistryStore.registrations");
  requireArray(store.snapshots, "asyncWorkRegistryStore.snapshots");
  requireArray(store.transitions, "asyncWorkRegistryStore.transitions");
  requireArray(store.outcomes, "asyncWorkRegistryStore.outcomes");
  store.registrations.forEach(validateAsyncWorkRegistration);
  store.snapshots.forEach(validateAsyncWorkStatusSnapshot);
  store.transitions.forEach(validateAsyncWorkStateTransition);
  store.outcomes.forEach(validateAsyncWorkOutcome);
  validateTransitionSequenceIntegrity(store.registrations, store.transitions);
  for (const flag of ["liveProcessManagerEnabledInThisPr", "automaticWakeEnabledInThisPr", "providerTransportEnabledInThisPr", "cancellationTransportEnabledInThisPr"]) {
    if (store[flag] !== false) throw validationError("direct_async_work_authority_leak", `asyncWorkRegistryStore.${flag}`);
  }
  if (store.rawOutputIncluded || store.rawTextIncluded || store.rawPathIncluded || store.rawSecretIncluded) {
    throw validationError("direct_async_work_raw_exposure", "asyncWorkRegistryStore");
  }
  validateDigest(store, "storeDigest", "direct-async-work-registry-store@1", "asyncWorkRegistryStore");
  return true;
}

function buildAsyncWorkMetaToolCatalog(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const catalog = {
    schema: DIRECT_ASYNC_WORK_META_TOOL_CATALOG_SCHEMA,
    catalogId: normalizeId(source.catalogId, "async_work_meta_tool_catalog"),
    projectId: normalizeString(source.projectId, ""),
    workThreadId: normalizeString(source.workThreadId, ""),
    tools: ASYNC_META_TOOL_NAMES.map((toolName) => ({
      toolName,
      operatesOnRegisteredWorkIdsOnly: true,
      returnsStandardStatusPackets: true,
      rawProcessAccess: false,
      rawOutputAccess: false,
      startsProviderWake: false,
      startsProcessTransport: false,
      liveToolExecutionEnabledInThisPr: false,
    })),
    liveToolExecutionEnabledInThisPr: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    createdAt: normalizeString(source.createdAt, nowIso(options.now || Date.now)),
  };
  catalog.catalogDigest = digestFor("direct-async-work-meta-tool-catalog@1", catalog);
  return catalog;
}

function validateAsyncWorkMetaToolCatalog(catalog) {
  requirePlainObject(catalog, "asyncWorkMetaToolCatalog");
  if (catalog.schema !== DIRECT_ASYNC_WORK_META_TOOL_CATALOG_SCHEMA) throw validationError("direct_async_work_schema_mismatch", "asyncWorkMetaToolCatalog");
  requireString(catalog.catalogId, "asyncWorkMetaToolCatalog.catalogId");
  requireArray(catalog.tools, "asyncWorkMetaToolCatalog.tools");
  const names = catalog.tools.map((tool) => tool.toolName).sort();
  if (canonicalJson(names) !== canonicalJson([...ASYNC_META_TOOL_NAMES].sort())) {
    throw validationError("direct_async_work_meta_tools_mismatch", "asyncWorkMetaToolCatalog.tools");
  }
  for (const tool of catalog.tools) {
    requirePlainObject(tool, `asyncWorkMetaToolCatalog.${tool.toolName || "tool"}`);
    if (tool.operatesOnRegisteredWorkIdsOnly !== true || tool.returnsStandardStatusPackets !== true) {
      throw validationError("direct_async_work_contract_violation", `asyncWorkMetaToolCatalog.${tool.toolName}`);
    }
    for (const flag of ["rawProcessAccess", "rawOutputAccess", "startsProviderWake", "startsProcessTransport", "liveToolExecutionEnabledInThisPr"]) {
      if (tool[flag] !== false) throw validationError("direct_async_work_authority_leak", `asyncWorkMetaToolCatalog.${tool.toolName}.${flag}`);
    }
  }
  if (catalog.liveToolExecutionEnabledInThisPr !== false) throw validationError("direct_async_work_authority_leak", "asyncWorkMetaToolCatalog.liveToolExecutionEnabledInThisPr");
  if (catalog.rawTextIncluded || catalog.rawPathIncluded || catalog.rawSecretIncluded) {
    throw validationError("direct_async_work_raw_exposure", "asyncWorkMetaToolCatalog");
  }
  validateDigest(catalog, "catalogDigest", "direct-async-work-meta-tool-catalog@1", "asyncWorkMetaToolCatalog");
  return true;
}

module.exports = {
  ASYNC_CONDITION_KINDS,
  ASYNC_CONDITION_OPERATORS,
  ASYNC_CONTRACT_OUTCOME_STATUSES,
  ASYNC_META_TOOL_NAMES,
  ASYNC_POLL_STRATEGIES,
  ASYNC_PROCESS_OUTCOME_STATUSES,
  ASYNC_PROGRESS_SIGNAL_KINDS,
  ASYNC_RAW_OUTPUT_POLICIES,
  ASYNC_REGISTRATION_MODES,
  ASYNC_TRANSITION_REASONS,
  ASYNC_WAKE_MESSAGE_SHAPES,
  ASYNC_WAKE_ON_VALUES,
  ASYNC_WORK_KINDS,
  ASYNC_WORK_STATUSES,
  ASYNC_WORK_TERMINAL_STATUSES,
  DIRECT_ASYNC_CONDITION_SCHEMA,
  DIRECT_ASYNC_PROGRESS_SIGNAL_SCHEMA,
  DIRECT_ASYNC_WAKE_POLICY_SCHEMA,
  DIRECT_ASYNC_WORK_META_TOOL_CATALOG_SCHEMA,
  DIRECT_ASYNC_WORK_OUTCOME_SCHEMA,
  DIRECT_ASYNC_WORK_REGISTRATION_SCHEMA,
  DIRECT_ASYNC_WORK_REGISTRY_STORE_SCHEMA,
  DIRECT_ASYNC_WORK_STATE_TRANSITION_SCHEMA,
  DIRECT_ASYNC_WORK_STATUS_SNAPSHOT_SCHEMA,
  DIRECT_AWAITABLE_WORK_CONTRACT_SCHEMA,
  buildAsyncCondition,
  buildAsyncProgressSignal,
  buildAsyncWakePolicy,
  buildAsyncWorkMetaToolCatalog,
  buildAsyncWorkOutcome,
  buildAsyncWorkRegistration,
  buildAsyncWorkRegistryStore,
  buildAsyncWorkStateTransition,
  buildAsyncWorkStatusSnapshot,
  buildAwaitableWorkContract,
  validateAsyncCondition,
  validateAsyncProgressSignal,
  validateAsyncWakePolicy,
  validateAsyncWorkMetaToolCatalog,
  validateAsyncWorkOutcome,
  validateAsyncWorkRegistration,
  validateAsyncWorkRegistryStore,
  validateAsyncWorkStateTransition,
  validateAsyncWorkStatusSnapshot,
  validateAwaitableWorkContract,
};
