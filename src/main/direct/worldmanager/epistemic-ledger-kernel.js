"use strict";

const {
  digestFor,
  stableId,
} = require("./control-plane");

const LEDGER_ACT_TYPE_CONSTITUTION_SCHEMA =
  "direct_ledger_act_type_constitution@1";
const LEDGER_STREAM_REF_SCHEMA = "direct_ledger_stream_ref@1";
const EPISTEMIC_LEDGER_EVENT_SCHEMA =
  "direct_epistemic_ledger_event@1";
const LEDGER_WRITE_RECEIPT_SCHEMA =
  "direct_ledger_write_receipt@1";
const MATERIALIZED_EPISTEMIC_PROJECTION_SCHEMA =
  "direct_materialized_epistemic_projection@1";
const LEDGER_DELIVERY_OUTBOX_SEED_SCHEMA =
  "direct_ledger_delivery_outbox_seed@1";
const LEDGER_GENESIS_DIGEST = digestFor(
  "direct_epistemic_ledger_genesis@1",
  { semanticIdentity: "direct_world_manager_epistemic_ledger" },
);

const ACT_CLASSES = new Set([
  "observation",
  "proposal",
  "challenge",
  "assessment",
  "request",
  "authorization",
  "admission",
  "retraction",
  "mechanical_witness",
]);
const AUTHORSHIP_KINDS = new Set([
  "semantic_role",
  "harness_mechanical",
  "operator",
]);
const EPISTEMIC_POSTURES = new Set([
  "observed",
  "candidate",
  "challenged",
  "supported",
  "contradicted",
  "remanded",
  "admitted",
  "superseded",
  "stale",
]);
const AUTHORITY_POSTURES = new Set([
  "descriptive",
  "proposal_only",
  "scoped_authority_act",
  "canonical_admission_receipt",
]);
const STREAM_TYPES = new Set([
  "world",
  "project",
  "workthread",
  "artifact",
  "agent_run",
]);
const SCOPE_KINDS = new Set([
  "user_world",
  "project",
  "task",
  "workthread",
  "artifact",
]);
const LEDGER_RIGHTS = new Set([
  "observe",
  "propose",
  "challenge",
  "assess",
  "admit",
  "authorize",
  "execute",
  "subscribe",
  "acknowledge",
]);
const DELIVERY_POLICIES = new Set([
  "immediate_delta",
  "safe_boundary",
  "coalesced_digest",
]);

function fail(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  if (detail) error.detail = detail;
  throw error;
}

function isPlainObject(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value),
  );
}

function text(value, fallback = "") {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : fallback;
}

function bounded(value, fallback = "", max = 1200) {
  return text(value, fallback).slice(0, max);
}

function nowIso(now = Date.now) {
  const value = typeof now === "function" ? now() : now;
  const numeric = Number(value);
  const date = new Date(Number.isFinite(numeric) ? numeric : value);
  if (!Number.isFinite(date.getTime())) {
    fail("epistemic_ledger_timestamp_invalid");
  }
  return date.toISOString();
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function requirePlainObject(value, label) {
  if (!isPlainObject(value)) {
    fail("epistemic_ledger_plain_object_required", label);
  }
  return value;
}

function exactRef(value = {}, label = "ref") {
  if (!isPlainObject(value)) {
    fail("epistemic_ledger_exact_ref_invalid", label);
  }
  const ref = {
    kind: text(value.kind, ""),
    id: text(value.id, ""),
    digest: text(value.digest, ""),
  };
  if (!ref.kind || !ref.id || !ref.digest) {
    fail("epistemic_ledger_exact_ref_invalid", label);
  }
  const refLabel = bounded(value.label, "", 240);
  const projectId = text(value.projectId, "");
  const revision = Number(value.revision);
  if (refLabel) ref.label = refLabel;
  if (projectId) ref.projectId = projectId;
  if (Number.isInteger(revision) && revision > 0) {
    ref.revision = revision;
  }
  return ref;
}

function validateExactRef(value, label = "ref") {
  exactRef(value, label);
  return true;
}

function exactRefKey(value, options = {}) {
  const ref = exactRef(value);
  return options.includeDigest === false
    ? `${ref.kind}:${ref.id}`
    : `${ref.kind}:${ref.id}:${ref.digest}`;
}

function uniqueRefs(values = [], label = "refs", max = 128) {
  if (!Array.isArray(values)) {
    fail("epistemic_ledger_ref_list_invalid", label);
  }
  const seen = new Set();
  return values.slice(0, max).map((value, index) =>
    exactRef(value, `${label}.${index}`)).filter((ref) => {
      const key = exactRefKey(ref);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function buildLedgerStreamRef(value = {}, label = "streamRef") {
  if (typeof value === "string") {
    const separator = value.indexOf(":");
    value = separator > 0
      ? {
          streamType: value.slice(0, separator),
          streamId: value.slice(separator + 1),
        }
      : {};
  }
  const streamType = text(value.streamType || value.kind, "");
  const streamId = text(value.streamId || value.id, "");
  if (!STREAM_TYPES.has(streamType) || !streamId) {
    fail("epistemic_ledger_stream_ref_invalid", label);
  }
  return {
    schema: LEDGER_STREAM_REF_SCHEMA,
    streamType,
    streamId,
    streamKey: `${streamType}:${streamId}`,
  };
}

function validateLedgerStreamRef(value, label = "streamRef") {
  const expected = buildLedgerStreamRef(value, label);
  if (
    value.schema !== LEDGER_STREAM_REF_SCHEMA ||
    value.streamKey !== expected.streamKey
  ) {
    fail("epistemic_ledger_stream_ref_invalid", label);
  }
  return true;
}

function uniqueStreamRefs(values = []) {
  if (!Array.isArray(values) || values.length < 1) {
    fail("epistemic_ledger_stream_refs_required");
  }
  const seen = new Set();
  return values.slice(0, 64).map((value, index) =>
    buildLedgerStreamRef(value, `streamRefs.${index}`)).filter((ref) => {
      if (seen.has(ref.streamKey)) return false;
      seen.add(ref.streamKey);
      return true;
    });
}

function normalizeSemanticScope(value = {}) {
  requirePlainObject(value, "subjectScope");
  const scope = {
    kind: text(
      value.kind,
      text(value.projectId, "") ? "project" : "user_world",
    ),
    userWorldId: text(value.userWorldId, "user_world_local"),
    projectId: text(value.projectId, ""),
    taskType: text(value.taskType, ""),
    taskId: text(value.taskId, ""),
    workThreadId: text(value.workThreadId, ""),
    artifactLifecycleId: text(value.artifactLifecycleId, ""),
  };
  if (!SCOPE_KINDS.has(scope.kind)) {
    fail("epistemic_ledger_scope_invalid", scope.kind);
  }
  if (scope.kind === "project" && !scope.projectId) {
    fail("epistemic_ledger_scope_invalid", "projectId");
  }
  if (scope.kind === "task" && !scope.taskId && !scope.taskType) {
    fail("epistemic_ledger_scope_invalid", "task identity");
  }
  if (scope.kind === "workthread" && !scope.workThreadId) {
    fail("epistemic_ledger_scope_invalid", "workThreadId");
  }
  if (scope.kind === "artifact" && !scope.artifactLifecycleId) {
    fail("epistemic_ledger_scope_invalid", "artifactLifecycleId");
  }
  return scope;
}

function normalizeRevisionVector(values = []) {
  if (!Array.isArray(values)) {
    fail("epistemic_ledger_revision_vector_invalid");
  }
  const seen = new Set();
  return values.slice(0, 128).map((entry, index) => {
    if (!isPlainObject(entry)) {
      fail("epistemic_ledger_revision_ref_invalid", String(index));
    }
    const scopeRef = exactRef(
      entry.scopeRef || entry.objectRef || entry.ref,
      `expectedRevisionVector.${index}.scopeRef`,
    );
    const revision = Number(entry.revision);
    if (!Number.isInteger(revision) || revision < 0) {
      fail(
        "epistemic_ledger_revision_ref_invalid",
        `expectedRevisionVector.${index}.revision`,
      );
    }
    const key = exactRefKey(scopeRef, { includeDigest: false });
    if (seen.has(key)) {
      fail("epistemic_ledger_revision_ref_duplicate", key);
    }
    seen.add(key);
    return { scopeRef, revision };
  });
}

function buildLedgerActTypeConstitution(input = {}, options = {}) {
  const actTypeId = text(input.actTypeId, "");
  const revision = Number(input.revision || 1);
  const operationName = text(input.operationName, "");
  const actClass = text(input.actClass, "");
  if (
    !actTypeId ||
    !Number.isInteger(revision) ||
    revision < 1 ||
    !operationName ||
    !ACT_CLASSES.has(actClass)
  ) {
    fail("ledger_act_type_constitution_invalid");
  }
  const authorshipKinds = Array.from(new Set(
    (Array.isArray(input.authorshipKinds)
      ? input.authorshipKinds
      : ["semantic_role"])
      .map((entry) => text(entry, ""))
      .filter((entry) => AUTHORSHIP_KINDS.has(entry)),
  ));
  const allowedRights = Array.from(new Set(
    (Array.isArray(input.allowedRights) ? input.allowedRights : [])
      .map((entry) => text(entry, ""))
      .filter((entry) => LEDGER_RIGHTS.has(entry)),
  ));
  if (authorshipKinds.length < 1) {
    fail("ledger_act_type_constitution_invalid", "authorshipKinds");
  }
  const constitution = {
    schema: LEDGER_ACT_TYPE_CONSTITUTION_SCHEMA,
    actTypeId,
    revision,
    operationName,
    actClass,
    authorshipKinds,
    allowedRights,
    allowedRoleLanes: Array.from(new Set(
      (Array.isArray(input.allowedRoleLanes)
        ? input.allowedRoleLanes
        : [])
        .map((entry) => text(entry, ""))
        .filter(Boolean),
    )).slice(0, 64),
    typedPayloadSchema: text(input.typedPayloadSchema, ""),
    defaultEpistemicPosture: text(
      input.defaultEpistemicPosture,
      actClass === "proposal" ? "candidate" : "observed",
    ),
    defaultAuthorityPosture: text(
      input.defaultAuthorityPosture,
      actClass === "proposal" ? "proposal_only" : "descriptive",
    ),
    rendererSafeLabel: bounded(
      input.rendererSafeLabel,
      operationName,
      240,
    ),
    canonicalAdmissionCapable:
      input.canonicalAdmissionCapable === true,
    admittedByRef: input.admittedByRef
      ? exactRef(input.admittedByRef, "admittedByRef")
      : null,
    createdAt: text(input.createdAt, nowIso(options.now)),
    rawChainOfThoughtIncluded: false,
    rawSecretIncluded: false,
  };
  if (!EPISTEMIC_POSTURES.has(constitution.defaultEpistemicPosture)) {
    fail("ledger_act_type_constitution_invalid", "epistemic posture");
  }
  if (!AUTHORITY_POSTURES.has(constitution.defaultAuthorityPosture)) {
    fail("ledger_act_type_constitution_invalid", "authority posture");
  }
  constitution.digest = digestFor(
    LEDGER_ACT_TYPE_CONSTITUTION_SCHEMA,
    constitution,
    ["digest"],
  );
  validateLedgerActTypeConstitution(constitution);
  return constitution;
}

function validateLedgerActTypeConstitution(value) {
  if (
    !isPlainObject(value) ||
    value.schema !== LEDGER_ACT_TYPE_CONSTITUTION_SCHEMA ||
    !text(value.actTypeId, "") ||
    !Number.isInteger(Number(value.revision)) ||
    Number(value.revision) < 1 ||
    !text(value.operationName, "") ||
    !ACT_CLASSES.has(value.actClass) ||
    !Array.isArray(value.authorshipKinds) ||
    value.authorshipKinds.length < 1 ||
    value.authorshipKinds.some((entry) => !AUTHORSHIP_KINDS.has(entry)) ||
    !Array.isArray(value.allowedRights) ||
    value.allowedRights.some((entry) => !LEDGER_RIGHTS.has(entry)) ||
    !Array.isArray(value.allowedRoleLanes) ||
    !EPISTEMIC_POSTURES.has(value.defaultEpistemicPosture) ||
    !AUTHORITY_POSTURES.has(value.defaultAuthorityPosture) ||
    typeof value.canonicalAdmissionCapable !== "boolean" ||
    value.rawChainOfThoughtIncluded !== false ||
    value.rawSecretIncluded !== false ||
    !text(value.createdAt, "") ||
    value.digest !== digestFor(
      LEDGER_ACT_TYPE_CONSTITUTION_SCHEMA,
      value,
      ["digest"],
    )
  ) {
    fail("ledger_act_type_constitution_invalid");
  }
  if (value.admittedByRef) validateExactRef(value.admittedByRef);
  return true;
}

function ledgerActTypeConstitutionRef(value) {
  validateLedgerActTypeConstitution(value);
  return exactRef({
    kind: "ledger_act_type_constitution",
    id: `${value.actTypeId}@${value.revision}`,
    digest: value.digest,
    label: value.rendererSafeLabel,
    revision: value.revision,
  });
}

function normalizeLedgerAppendIntent(input = {}) {
  const normalized = {
    streamRefs: uniqueStreamRefs(input.streamRefs),
    actTypeRef: exactRef(input.actTypeRef, "actTypeRef"),
    actClass: text(input.actClass, ""),
    authorshipKind: text(input.authorshipKind, ""),
    actorRef: exactRef(input.actorRef, "actorRef"),
    roleLaneRef: exactRef(input.roleLaneRef, "roleLaneRef"),
    agentRunRef: input.agentRunRef
      ? exactRef(input.agentRunRef, "agentRunRef")
      : null,
    subjectScope: normalizeSemanticScope(input.subjectScope),
    objectRefs: uniqueRefs(input.objectRefs || [], "objectRefs"),
    artifactLifecycleRef: input.artifactLifecycleRef
      ? exactRef(input.artifactLifecycleRef, "artifactLifecycleRef")
      : null,
    evidenceRefs: uniqueRefs(input.evidenceRefs || [], "evidenceRefs"),
    affectsRefs: uniqueRefs(input.affectsRefs || [], "affectsRefs"),
    sourceEventRefs: uniqueRefs(
      input.sourceEventRefs || [],
      "sourceEventRefs",
    ),
    expectedRevisionVector: normalizeRevisionVector(
      input.expectedRevisionVector || [],
    ),
    epistemicPosture: text(input.epistemicPosture, ""),
    authorityPosture: text(input.authorityPosture, ""),
    typedPayloadSchema: text(input.typedPayloadSchema, ""),
    typedPayload: cloneJson(
      requirePlainObject(input.typedPayload, "typedPayload"),
    ),
    rendererSafeSummary: bounded(
      input.rendererSafeSummary,
      "Ledger event",
      1200,
    ),
    idempotencyKey: text(input.idempotencyKey, ""),
    operationScope: text(
      input.operationScope,
      text(input.actTypeRef?.id, ""),
    ),
    affectedContextRefs: uniqueRefs(
      input.affectedContextRefs || [],
      "affectedContextRefs",
    ),
    lifecycleTransitionRefs: uniqueRefs(
      input.lifecycleTransitionRefs || [],
      "lifecycleTransitionRefs",
    ),
  };
  if (
    !ACT_CLASSES.has(normalized.actClass) ||
    !AUTHORSHIP_KINDS.has(normalized.authorshipKind) ||
    !EPISTEMIC_POSTURES.has(normalized.epistemicPosture) ||
    !AUTHORITY_POSTURES.has(normalized.authorityPosture) ||
    !normalized.typedPayloadSchema ||
    !normalized.idempotencyKey ||
    !normalized.operationScope
  ) {
    fail("epistemic_ledger_append_intent_invalid");
  }
  return normalized;
}

function ledgerAppendIntentDigest(input = {}) {
  const intent = normalizeLedgerAppendIntent(input);
  return digestFor(
    "direct_epistemic_ledger_append_intent@1",
    intent,
  );
}

function buildEpistemicLedgerEvent(input = {}, system = {}) {
  const intent = normalizeLedgerAppendIntent(input);
  const globalSequence = Number(system.globalSequence);
  const previousLedgerDigest = text(
    system.previousLedgerDigest,
    "",
  );
  if (
    !Number.isInteger(globalSequence) ||
    globalSequence < 1 ||
    !previousLedgerDigest
  ) {
    fail("epistemic_ledger_sequence_assignment_invalid");
  }
  const createdAt = text(system.createdAt, nowIso(system.now));
  const ledgerEventId = text(
    system.ledgerEventId,
    stableId("ledger_event", {
      globalSequence,
      previousLedgerDigest,
      intentDigest: digestFor(
        "direct_epistemic_ledger_event_intent@1",
        intent,
      ),
    }, 32),
  );
  const event = {
    schema: EPISTEMIC_LEDGER_EVENT_SCHEMA,
    ledgerEventId,
    globalSequence,
    streamRefs: intent.streamRefs,
    actTypeRef: intent.actTypeRef,
    actClass: intent.actClass,
    authorshipKind: intent.authorshipKind,
    actorRef: intent.actorRef,
    roleLaneRef: intent.roleLaneRef,
    agentRunRef: intent.agentRunRef,
    subjectScope: intent.subjectScope,
    objectRefs: intent.objectRefs,
    artifactLifecycleRef: intent.artifactLifecycleRef,
    evidenceRefs: intent.evidenceRefs,
    affectsRefs: intent.affectsRefs,
    sourceEventRefs: intent.sourceEventRefs,
    expectedRevisionVector: intent.expectedRevisionVector,
    epistemicPosture: intent.epistemicPosture,
    authorityPosture: intent.authorityPosture,
    typedPayloadSchema: intent.typedPayloadSchema,
    typedPayload: intent.typedPayload,
    rendererSafeSummary: intent.rendererSafeSummary,
    idempotencyKey: intent.idempotencyKey,
    previousLedgerDigest,
    eventDigest: "",
    createdAt,
    rawChainOfThoughtIncluded: false,
    rawSecretIncluded: false,
  };
  event.eventDigest = digestFor(
    EPISTEMIC_LEDGER_EVENT_SCHEMA,
    event,
    ["eventDigest"],
  );
  validateEpistemicLedgerEvent(event);
  return event;
}

function validateEpistemicLedgerEvent(value) {
  if (
    !isPlainObject(value) ||
    value.schema !== EPISTEMIC_LEDGER_EVENT_SCHEMA ||
    !text(value.ledgerEventId, "") ||
    !Number.isInteger(Number(value.globalSequence)) ||
    Number(value.globalSequence) < 1 ||
    !Array.isArray(value.streamRefs) ||
    value.streamRefs.length < 1 ||
    !ACT_CLASSES.has(value.actClass) ||
    !AUTHORSHIP_KINDS.has(value.authorshipKind) ||
    !Array.isArray(value.objectRefs) ||
    !Array.isArray(value.evidenceRefs) ||
    !Array.isArray(value.affectsRefs) ||
    !Array.isArray(value.sourceEventRefs) ||
    !Array.isArray(value.expectedRevisionVector) ||
    !EPISTEMIC_POSTURES.has(value.epistemicPosture) ||
    !AUTHORITY_POSTURES.has(value.authorityPosture) ||
    !text(value.typedPayloadSchema, "") ||
    !isPlainObject(value.typedPayload) ||
    !text(value.rendererSafeSummary, "") ||
    !text(value.idempotencyKey, "") ||
    !text(value.previousLedgerDigest, "") ||
    !text(value.createdAt, "") ||
    value.rawChainOfThoughtIncluded !== false ||
    value.rawSecretIncluded !== false
  ) {
    fail("epistemic_ledger_event_invalid");
  }
  value.streamRefs.forEach((ref, index) =>
    validateLedgerStreamRef(ref, `streamRefs.${index}`));
  validateExactRef(value.actTypeRef, "actTypeRef");
  validateExactRef(value.actorRef, "actorRef");
  validateExactRef(value.roleLaneRef, "roleLaneRef");
  if (value.agentRunRef) validateExactRef(value.agentRunRef, "agentRunRef");
  normalizeSemanticScope(value.subjectScope);
  uniqueRefs(value.objectRefs, "objectRefs");
  if (value.artifactLifecycleRef) {
    validateExactRef(value.artifactLifecycleRef, "artifactLifecycleRef");
  }
  uniqueRefs(value.evidenceRefs, "evidenceRefs");
  uniqueRefs(value.affectsRefs, "affectsRefs");
  uniqueRefs(value.sourceEventRefs, "sourceEventRefs");
  normalizeRevisionVector(value.expectedRevisionVector);
  if (
    value.eventDigest !== digestFor(
      EPISTEMIC_LEDGER_EVENT_SCHEMA,
      value,
      ["eventDigest"],
    )
  ) {
    fail("epistemic_ledger_event_digest_invalid", value.ledgerEventId);
  }
  return true;
}

function epistemicLedgerEventRef(value) {
  validateEpistemicLedgerEvent(value);
  return exactRef({
    kind: "epistemic_ledger_event",
    id: value.ledgerEventId,
    digest: value.eventDigest,
    label: value.rendererSafeSummary,
  });
}

function buildLedgerWriteReceipt(input = {}, options = {}) {
  const event = input.event;
  validateEpistemicLedgerEvent(event);
  const appendState = text(input.appendState, "appended");
  const deliveryDispatchState = text(
    input.deliveryDispatchState,
    "none",
  );
  if (
    !["appended", "idempotent_replay"].includes(appendState) ||
    !["none", "outbox_committed"].includes(deliveryDispatchState)
  ) {
    fail("ledger_write_receipt_invalid");
  }
  const actorIdentity = text(input.actorIdentity, "");
  const operationScope = text(input.operationScope, "");
  const appendRequestDigest = text(input.appendRequestDigest, "");
  if (!actorIdentity || !operationScope || !appendRequestDigest) {
    fail("ledger_write_receipt_idempotency_scope_invalid");
  }
  const receipt = {
    schema: LEDGER_WRITE_RECEIPT_SCHEMA,
    receiptId: text(
      input.receiptId,
      stableId("ledger_receipt", {
        ledgerEventId: event.ledgerEventId,
        appendState,
      }, 32),
    ),
    ledgerEventRef: epistemicLedgerEventRef(event),
    actorIdentity,
    operationScope,
    idempotencyKey: event.idempotencyKey,
    appendRequestDigest,
    appendState,
    epistemicPosture: event.epistemicPosture,
    canonicalEffect: false,
    affectedContextRefs: uniqueRefs(
      input.affectedContextRefs || [],
      "affectedContextRefs",
    ),
    lifecycleTransitionRefs: uniqueRefs(
      input.lifecycleTransitionRefs || [],
      "lifecycleTransitionRefs",
    ),
    deliveryDispatchState,
    rendererSafeSummary: bounded(
      input.rendererSafeSummary,
      event.rendererSafeSummary,
      1200,
    ),
    createdAt: text(input.createdAt, nowIso(options.now)),
  };
  receipt.receiptDigest = digestFor(
    LEDGER_WRITE_RECEIPT_SCHEMA,
    receipt,
    ["receiptDigest"],
  );
  validateLedgerWriteReceipt(receipt);
  return receipt;
}

function validateLedgerWriteReceipt(value) {
  if (
    !isPlainObject(value) ||
    value.schema !== LEDGER_WRITE_RECEIPT_SCHEMA ||
    !text(value.receiptId, "") ||
    !text(value.actorIdentity, "") ||
    !text(value.operationScope, "") ||
    !text(value.idempotencyKey, "") ||
    !text(value.appendRequestDigest, "") ||
    !["appended", "idempotent_replay"].includes(value.appendState) ||
    !EPISTEMIC_POSTURES.has(value.epistemicPosture) ||
    value.canonicalEffect !== false ||
    !Array.isArray(value.affectedContextRefs) ||
    !Array.isArray(value.lifecycleTransitionRefs) ||
    !["none", "outbox_committed"].includes(
      value.deliveryDispatchState,
    ) ||
    !text(value.rendererSafeSummary, "") ||
    !text(value.createdAt, "")
  ) {
    fail("ledger_write_receipt_invalid");
  }
  validateExactRef(value.ledgerEventRef, "ledgerEventRef");
  uniqueRefs(value.affectedContextRefs, "affectedContextRefs");
  uniqueRefs(
    value.lifecycleTransitionRefs,
    "lifecycleTransitionRefs",
  );
  if (
    value.receiptDigest !== digestFor(
      LEDGER_WRITE_RECEIPT_SCHEMA,
      value,
      ["receiptDigest"],
    )
  ) {
    fail("ledger_write_receipt_digest_invalid", value.receiptId);
  }
  return true;
}

function replayLedgerWriteReceipt(value, options = {}) {
  validateLedgerWriteReceipt(value);
  if (value.appendState === "idempotent_replay") return value;
  const replay = {
    ...cloneJson(value),
    receiptId: stableId("ledger_receipt_replay", {
      originalReceiptId: value.receiptId,
      ledgerEventRef: value.ledgerEventRef,
    }, 32),
    appendState: "idempotent_replay",
    createdAt: text(options.createdAt, value.createdAt),
  };
  replay.receiptDigest = digestFor(
    LEDGER_WRITE_RECEIPT_SCHEMA,
    replay,
    ["receiptDigest"],
  );
  validateLedgerWriteReceipt(replay);
  return replay;
}

function projectionKeysForEvent(event) {
  validateEpistemicLedgerEvent(event);
  const keys = ["ledger:global"];
  event.streamRefs.forEach((ref) => {
    keys.push(`stream:${ref.streamKey}`);
  });
  event.objectRefs.forEach((ref) => {
    keys.push(`object:${exactRefKey(ref, { includeDigest: false })}`);
  });
  if (event.artifactLifecycleRef) {
    keys.push(
      `artifact:${exactRefKey(event.artifactLifecycleRef, {
        includeDigest: false,
      })}`,
    );
  }
  return Array.from(new Set(keys));
}

function buildMaterializedEpistemicProjection(event, projectionKey) {
  validateEpistemicLedgerEvent(event);
  const key = text(projectionKey, "");
  if (!key || !projectionKeysForEvent(event).includes(key)) {
    fail("epistemic_ledger_projection_key_invalid", key);
  }
  const projection = {
    schema: MATERIALIZED_EPISTEMIC_PROJECTION_SCHEMA,
    projectionKey: key,
    headSequence: event.globalSequence,
    headEventRef: epistemicLedgerEventRef(event),
    epistemicPosture: event.epistemicPosture,
    authorityPosture: event.authorityPosture,
    subjectScope: event.subjectScope,
    objectRefs: event.objectRefs,
    artifactLifecycleRef: event.artifactLifecycleRef,
    rendererSafeSummary: event.rendererSafeSummary,
    updatedAt: event.createdAt,
  };
  projection.projectionDigest = digestFor(
    MATERIALIZED_EPISTEMIC_PROJECTION_SCHEMA,
    projection,
    ["projectionDigest"],
  );
  validateMaterializedEpistemicProjection(projection);
  return projection;
}

function validateMaterializedEpistemicProjection(value) {
  if (
    !isPlainObject(value) ||
    value.schema !== MATERIALIZED_EPISTEMIC_PROJECTION_SCHEMA ||
    !text(value.projectionKey, "") ||
    !Number.isInteger(Number(value.headSequence)) ||
    Number(value.headSequence) < 1 ||
    !EPISTEMIC_POSTURES.has(value.epistemicPosture) ||
    !AUTHORITY_POSTURES.has(value.authorityPosture) ||
    !Array.isArray(value.objectRefs) ||
    !text(value.rendererSafeSummary, "") ||
    !text(value.updatedAt, "")
  ) {
    fail("epistemic_ledger_projection_invalid");
  }
  validateExactRef(value.headEventRef, "headEventRef");
  normalizeSemanticScope(value.subjectScope);
  uniqueRefs(value.objectRefs, "objectRefs");
  if (value.artifactLifecycleRef) {
    validateExactRef(value.artifactLifecycleRef, "artifactLifecycleRef");
  }
  if (
    value.projectionDigest !== digestFor(
      MATERIALIZED_EPISTEMIC_PROJECTION_SCHEMA,
      value,
      ["projectionDigest"],
    )
  ) {
    fail(
      "epistemic_ledger_projection_digest_invalid",
      value.projectionKey,
    );
  }
  return true;
}

function normalizeOutboxSeedIntents(values = []) {
  if (!Array.isArray(values)) {
    fail("ledger_outbox_seed_intents_invalid");
  }
  return values.slice(0, 128).map((entry, index) => {
    if (!isPlainObject(entry)) {
      fail("ledger_outbox_seed_intent_invalid", String(index));
    }
    const subscriptionRef = exactRef(
      entry.subscriptionRef,
      `outboxSeedIntents.${index}.subscriptionRef`,
    );
    const recipientRef = exactRef(
      entry.recipientRef,
      `outboxSeedIntents.${index}.recipientRef`,
    );
    const deliveryPolicy = text(entry.deliveryPolicy, "safe_boundary");
    if (!DELIVERY_POLICIES.has(deliveryPolicy)) {
      fail("ledger_outbox_seed_intent_invalid", "deliveryPolicy");
    }
    return {
      subscriptionRef,
      recipientRef,
      deliveryPolicy,
      matchReason: bounded(entry.matchReason, "subscription_match", 480),
      materiality: text(entry.materiality, "ordinary"),
    };
  });
}

function buildLedgerDeliveryOutboxSeed(input = {}, event, options = {}) {
  validateEpistemicLedgerEvent(event);
  const normalized = normalizeOutboxSeedIntents([input])[0];
  const seed = {
    schema: LEDGER_DELIVERY_OUTBOX_SEED_SCHEMA,
    outboxSeedId: text(
      input.outboxSeedId,
      stableId("ledger_outbox", {
        ledgerEventId: event.ledgerEventId,
        subscriptionRef: normalized.subscriptionRef,
        recipientRef: normalized.recipientRef,
      }, 32),
    ),
    ledgerEventRef: epistemicLedgerEventRef(event),
    subscriptionRef: normalized.subscriptionRef,
    recipientRef: normalized.recipientRef,
    deliveryPolicy: normalized.deliveryPolicy,
    matchReason: normalized.matchReason,
    materiality: normalized.materiality,
    dispatchState: "pending",
    createdAt: text(input.createdAt, nowIso(options.now)),
  };
  seed.seedDigest = digestFor(
    LEDGER_DELIVERY_OUTBOX_SEED_SCHEMA,
    seed,
    ["seedDigest"],
  );
  validateLedgerDeliveryOutboxSeed(seed);
  return seed;
}

function validateLedgerDeliveryOutboxSeed(value) {
  if (
    !isPlainObject(value) ||
    value.schema !== LEDGER_DELIVERY_OUTBOX_SEED_SCHEMA ||
    !text(value.outboxSeedId, "") ||
    !DELIVERY_POLICIES.has(value.deliveryPolicy) ||
    !text(value.matchReason, "") ||
    !text(value.materiality, "") ||
    value.dispatchState !== "pending" ||
    !text(value.createdAt, "")
  ) {
    fail("ledger_delivery_outbox_seed_invalid");
  }
  validateExactRef(value.ledgerEventRef, "ledgerEventRef");
  validateExactRef(value.subscriptionRef, "subscriptionRef");
  validateExactRef(value.recipientRef, "recipientRef");
  if (
    value.seedDigest !== digestFor(
      LEDGER_DELIVERY_OUTBOX_SEED_SCHEMA,
      value,
      ["seedDigest"],
    )
  ) {
    fail(
      "ledger_delivery_outbox_seed_digest_invalid",
      value.outboxSeedId,
    );
  }
  return true;
}

function worldManagerEventLedgerIntent(
  sourceEvent = {},
  options = {},
) {
  const semanticEventId = text(sourceEvent.semanticEventId, "");
  const eventDigest = text(sourceEvent.eventDigest, "");
  const eventKind = text(sourceEvent.eventKind, "");
  if (!semanticEventId || !eventDigest || !eventKind) {
    fail("world_manager_event_ledger_adapter_invalid");
  }
  const projectId = text(sourceEvent.projectId, "");
  const sourceEventRef = exactRef({
    kind: "world_manager_semantic_event",
    id: semanticEventId,
    digest: eventDigest,
    label: eventKind,
    projectId,
  });
  return normalizeLedgerAppendIntent({
    streamRefs: options.streamRefs || [
      {
        streamType: projectId ? "project" : "world",
        streamId: projectId || text(options.userWorldId, "user_world_local"),
      },
    ],
    actTypeRef: options.actTypeRef,
    actClass: "mechanical_witness",
    authorshipKind: "harness_mechanical",
    actorRef: options.actorRef,
    roleLaneRef: options.roleLaneRef,
    agentRunRef: options.agentRunRef,
    subjectScope: projectId
      ? {
          kind: "project",
          userWorldId: text(options.userWorldId, "user_world_local"),
          projectId,
        }
      : {
          kind: "user_world",
          userWorldId: text(options.userWorldId, "user_world_local"),
        },
    objectRefs: [sourceEventRef],
    sourceEventRefs: [sourceEventRef],
    evidenceRefs: [],
    affectsRefs: [],
    expectedRevisionVector: [],
    epistemicPosture: "observed",
    authorityPosture: "descriptive",
    typedPayloadSchema:
      "direct_world_manager_event_ledger_adapter_payload@1",
    typedPayload: {
      sourceEventRef,
      eventKind,
      presentationState: text(sourceEvent.presentationState, "unknown"),
      projectId,
      lineageRootId: text(sourceEvent.lineageRootId, ""),
      rawEventBodyIncluded: false,
    },
    rendererSafeSummary: bounded(
      options.rendererSafeSummary,
      `WorldManager event observed: ${eventKind}`,
      1200,
    ),
    idempotencyKey: text(
      options.idempotencyKey,
      `wm-event:${semanticEventId}:${eventDigest}`,
    ),
    operationScope: text(
      options.operationScope,
      "world_manager_event_adapter",
    ),
  });
}

module.exports = {
  ACT_CLASSES,
  AUTHORSHIP_KINDS,
  AUTHORITY_POSTURES,
  DELIVERY_POLICIES,
  EPISTEMIC_LEDGER_EVENT_SCHEMA,
  EPISTEMIC_POSTURES,
  LEDGER_ACT_TYPE_CONSTITUTION_SCHEMA,
  LEDGER_DELIVERY_OUTBOX_SEED_SCHEMA,
  LEDGER_GENESIS_DIGEST,
  LEDGER_RIGHTS,
  LEDGER_STREAM_REF_SCHEMA,
  LEDGER_WRITE_RECEIPT_SCHEMA,
  MATERIALIZED_EPISTEMIC_PROJECTION_SCHEMA,
  SCOPE_KINDS,
  STREAM_TYPES,
  buildEpistemicLedgerEvent,
  buildLedgerActTypeConstitution,
  buildLedgerDeliveryOutboxSeed,
  buildLedgerStreamRef,
  buildLedgerWriteReceipt,
  buildMaterializedEpistemicProjection,
  epistemicLedgerEventRef,
  exactRef,
  exactRefKey,
  ledgerActTypeConstitutionRef,
  ledgerAppendIntentDigest,
  normalizeLedgerAppendIntent,
  normalizeOutboxSeedIntents,
  normalizeRevisionVector,
  normalizeSemanticScope,
  projectionKeysForEvent,
  replayLedgerWriteReceipt,
  validateEpistemicLedgerEvent,
  validateExactRef,
  validateLedgerActTypeConstitution,
  validateLedgerDeliveryOutboxSeed,
  validateLedgerStreamRef,
  validateLedgerWriteReceipt,
  validateMaterializedEpistemicProjection,
  worldManagerEventLedgerIntent,
};
