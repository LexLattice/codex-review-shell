"use strict";

const crypto = require("node:crypto");

const DIRECT_CONTROL_TOOL_SUBSTRATE_STATUS_SCHEMA = "direct_control_tool_substrate_status@1";
const DIRECT_CONTEXT_REMAINING_WITNESS_SCHEMA = "direct_context_remaining_witness@1";
const DIRECT_PLAN_ARTIFACT_SCHEMA = "direct_plan_artifact@1";
const PLAN_PROJECTION_MUTATION_ENVELOPE_SCHEMA = "plan_projection_mutation_envelope@1";
const PLAN_PROJECTION_STORE_SCHEMA = "plan_projection_store@1";
const DIRECT_VIEW_IMAGE_PROJECTION_SCHEMA = "direct_view_image_projection@1";
const DIRECT_HUMAN_DECISION_TOOL_PACKET_SCHEMA = "direct_human_decision_tool_packet@1";
const DIRECT_NEW_CONTEXT_BLOCKED_PROJECTION_SCHEMA = "direct_new_context_blocked_projection@1";

const ESTIMATE_KINDS = new Set(["provider_reported", "local_tokenizer_estimate", "budget_policy_estimate", "unknown"]);
const CONTEXT_CONFIDENCE = new Set(["exact", "derived", "estimated", "unknown"]);
const CONTEXT_FRESHNESS = new Set(["fresh", "stale", "unknown"]);
const USABLE_FOR = new Set(["display_only", "context_maintenance_diagnostic"]);
const PLAN_SOURCES = new Set(["model_tool_call", "human_edit", "harness_import"]);
const PLAN_STATUSES = new Set(["active", "superseded", "stale", "blocked"]);
const PLAN_ACTOR_KINDS = new Set(["resident_model", "operator", "harness_controller"]);
const PLAN_OWNERS = new Set(["resident_model", "operator", "harness", "imported"]);
const PLAN_AUTHORITIES = new Set(["assistant_working_plan", "operator_plan", "project_plan", "diagnostic_projection"]);
const PLAN_STEP_STATUSES = new Set(["pending", "in_progress", "completed_in_plan", "blocked", "deferred"]);
const PLAN_MUTATION_KINDS = new Set(["replace_plan", "append_steps", "update_step_status", "clear_plan", "blocked"]);
const PROVIDER_VISIBILITY_STATES = new Set(["not_seen", "metadata_only", "image_payload_sent", "unsupported"]);
const PROVIDER_VISIBILITY_EVIDENCE = new Set([
  "not_sent",
  "metadata_envelope_sent",
  "image_payload_sent_request_manifest_proved",
  "image_payload_accepted_provider_event",
  "unsupported",
]);
const HUMAN_DECISION_TOOL_KINDS = new Set(["request_user_input", "request_permissions"]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedString(value, maxLength = 320) {
  const text = normalizeString(value, "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function stableStringify(value) {
  if (value && typeof value.toJSON === "function") return stableStringify(value.toJSON());
  if (value === null) return "null";
  const type = typeof value;
  if (type === "boolean" || type === "number" || type === "string") return JSON.stringify(value);
  if (type === "bigint" || type === "function" || type === "symbol" || type === "undefined") return undefined;
  if (Array.isArray(value)) {
    return `[${value.map((entry) => {
      const serialized = stableStringify(entry);
      return serialized === undefined ? "null" : serialized;
    }).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => {
      const serialized = stableStringify(value[key]);
      return serialized === undefined ? "" : `${JSON.stringify(key)}:${serialized}`;
    })
    .filter(Boolean)
    .join(",")}}`;
}

function digestFor(domain, value) {
  return crypto.createHash("sha256").update(`${domain}:${stableStringify(value)}`).digest("hex");
}

function nowIso(nowMs) {
  const ms = typeof nowMs === "number" && !Number.isNaN(nowMs) ? nowMs : Date.now();
  return new Date(ms).toISOString();
}

function normalizeEnum(value, allowed, fallback) {
  const text = normalizeString(value, fallback);
  return allowed.has(text) ? text : fallback;
}

function normalizeSourceRefs(value) {
  return (Array.isArray(value) ? value : [])
    .filter(isPlainObject)
    .map((ref) => ({
      kind: boundedString(ref.kind, 80),
      ref: boundedString(ref.ref || ref.id || ref.digest, 180),
      digest: boundedString(ref.digest, 160),
    }))
    .filter((ref) => ref.kind || ref.ref || ref.digest);
}

function normalizeEvidenceRefs(value) {
  return (Array.isArray(value) ? value : [])
    .filter(isPlainObject)
    .map((ref) => ({
      kind: boundedString(ref.kind || ref.type, 80),
      refId: boundedString(ref.refId || ref.ref || ref.id || ref.digest, 180),
      digest: boundedString(ref.digest, 160),
      rendererSafe: ref.rendererSafe !== false,
    }))
    .filter((ref) => ref.kind || ref.refId || ref.digest);
}

function normalizeChoices(value) {
  return (Array.isArray(value) ? value : [])
    .map((choice, index) => {
      if (typeof choice === "string") {
        return { choiceId: `choice_${index + 1}`, label: boundedString(choice, 120), carriesAuthority: false };
      }
      if (!isPlainObject(choice)) return null;
      return {
        choiceId: boundedString(choice.choiceId || choice.id || `choice_${index + 1}`, 80),
        label: boundedString(choice.label || choice.text || choice.value, 160),
        carriesAuthority: choice.carriesAuthority === true,
        authorityScope: choice.carriesAuthority === true ? boundedString(choice.authorityScope || "single_action", 80) : "",
      };
    })
    .filter(Boolean);
}

function buildContextRemainingWitness(input = {}) {
  input = isPlainObject(input) ? input : {};
  const remainingInput = input.remainingTokens ?? input.tokensLeft;
  const contextWindow = input.contextWindow === null || input.contextWindow === undefined ? null : Number(input.contextWindow);
  const usedTokens = input.usedTokens === null || input.usedTokens === undefined ? null : Number(input.usedTokens);
  const remainingTokens = remainingInput === null || remainingInput === undefined ? null : Number(remainingInput);
  const pressureInput = input.pressurePercent === null || input.pressurePercent === undefined ? null : Number(input.pressurePercent);
  const computedPressure = Number.isFinite(pressureInput)
    ? pressureInput
    : Number.isFinite(contextWindow) && contextWindow > 0 && Number.isFinite(usedTokens)
      ? Math.max(0, Math.min(100, Math.round((usedTokens / contextWindow) * 10000) / 100))
      : null;
  const observedAt = normalizeString(input.observedAt, nowIso(input.nowMs));
  const staleAfterMs = input.staleAfterMs === null || input.staleAfterMs === undefined ? null : Number(input.staleAfterMs);
  const freshness = normalizeEnum(
    input.freshness,
    CONTEXT_FRESHNESS,
    Number.isFinite(staleAfterMs) && Number.isFinite(input.nowMs) && Date.parse(observedAt) + staleAfterMs < input.nowMs
      ? "stale"
      : Number.isFinite(remainingTokens) || Number.isFinite(usedTokens)
        ? "fresh"
        : "unknown",
  );
  const witness = {
    schema: DIRECT_CONTEXT_REMAINING_WITNESS_SCHEMA,
    witnessId: normalizeString(input.witnessId, ""),
    projectId: normalizeString(input.projectId, ""),
    workThreadId: normalizeString(input.workThreadId, ""),
    threadId: normalizeString(input.threadId, ""),
    turnId: normalizeString(input.turnId, ""),
    model: normalizeString(input.model || input.modelId, ""),
    contextWindow: Number.isFinite(contextWindow) ? contextWindow : null,
    usedTokens: Number.isFinite(usedTokens) ? usedTokens : null,
    remainingTokens: Number.isFinite(remainingTokens) ? remainingTokens : null,
    tokensLeft: Number.isFinite(remainingTokens) ? remainingTokens : null,
    pressurePercent: Number.isFinite(computedPressure) ? computedPressure : null,
    confidence: normalizeEnum(input.confidence, CONTEXT_CONFIDENCE, Number.isFinite(remainingTokens) || Number.isFinite(usedTokens) ? "derived" : "unknown"),
    source: normalizeString(input.source, Number.isFinite(remainingTokens) || Number.isFinite(usedTokens) ? "direct_context_pressure_estimate" : "unavailable"),
    observedAt,
    estimateKind: normalizeEnum(input.estimateKind, ESTIMATE_KINDS, Number.isFinite(remainingTokens) || Number.isFinite(usedTokens) ? "budget_policy_estimate" : "unknown"),
    usableFor: normalizeEnum(input.usableFor, USABLE_FOR, "display_only"),
    estimateSourceDigest: normalizeString(input.estimateSourceDigest, ""),
    staleAfterMs: Number.isFinite(staleAfterMs) ? staleAfterMs : null,
    freshness,
    providerTruth: input.providerTruth === true,
    permissionToContinue: false,
    compactionAuthority: false,
    providerCompactionAuthority: false,
    evidenceRefs: normalizeEvidenceRefs(input.evidenceRefs),
    rawTextIncluded: false,
    rawSecretIncluded: false,
  };
  witness.witnessId = witness.witnessId || `context_remaining_${digestFor("context-remaining-source@1", witness).slice(0, 24)}`;
  witness.witnessDigest = digestFor("direct-context-remaining-witness@1", witness);
  return witness;
}

function normalizePlanStep(step, index = 0) {
  const basis = isPlainObject(step) ? step : { text: step };
  const status = normalizePlanStepStatus(basis.status || basis.stepStatus, "pending");
  return {
    stepId: boundedString(basis.stepId || basis.id || `step_${index + 1}`, 80),
    text: boundedString(basis.text || basis.step || basis.label || "", 420),
    status,
    owner: normalizeEnum(basis.owner || basis.planOwner, PLAN_OWNERS, "resident_model"),
  };
}

function normalizePlanStepStatus(value, fallback = "pending") {
  const requestedStatus = normalizeString(value, fallback);
  return normalizeEnum(requestedStatus === "completed" ? "completed_in_plan" : requestedStatus, PLAN_STEP_STATUSES, fallback);
}

function normalizePlanSteps(value) {
  return (Array.isArray(value) ? value : [])
    .map((step, index) => normalizePlanStep(step, index))
    .filter((step) => step.text || step.stepId);
}

function digestPlanState(planState) {
  return digestFor("direct-plan-projection-state@1", planState || {});
}

function defaultPlanState(input = {}) {
  const plan = isPlainObject(input.currentPlan) ? input.currentPlan : {};
  return {
    planId: normalizeString(plan.planId || input.planId, ""),
    planOwner: normalizeEnum(plan.planOwner || input.planOwner, PLAN_OWNERS, "resident_model"),
    planAuthority: normalizeEnum(plan.planAuthority || input.planAuthority, PLAN_AUTHORITIES, "assistant_working_plan"),
    steps: normalizePlanSteps(plan.steps || input.currentSteps),
  };
}

function applyPlanMutation(beforePlan, input = {}, blocked = false) {
  if (blocked) return { ...beforePlan, steps: [...beforePlan.steps] };
  const mutationKind = normalizeEnum(input.mutationKind, PLAN_MUTATION_KINDS, "replace_plan");
  const nextSteps = normalizePlanSteps(input.steps);
  if (mutationKind === "clear_plan") return { ...beforePlan, steps: [] };
  if (mutationKind === "append_steps") return { ...beforePlan, steps: [...beforePlan.steps, ...nextSteps] };
  if (mutationKind === "update_step_status") {
    const stepId = boundedString(input.stepId || nextSteps[0]?.stepId, 80);
    const stepStatus = normalizePlanStepStatus(input.stepStatus || nextSteps[0]?.status, "pending");
    return {
      ...beforePlan,
      steps: beforePlan.steps.map((step) => (step.stepId === stepId ? { ...step, status: stepStatus } : step)),
    };
  }
  return { ...beforePlan, steps: nextSteps };
}

function buildAuthorityDecisionRef(input = {}, blocked = false, blockers = []) {
  if (isPlainObject(input.authorityDecisionRef)) return input.authorityDecisionRef;
  return {
    kind: "plan_projection_authority_decision",
    refId: `plan_authority_${digestFor("plan-projection-authority@1", { input, blocked, blockers }).slice(0, 24)}`,
    digest: digestFor("plan-projection-authority-decision@1", {
      blocked,
      blockers,
      planOwner: input.planOwner,
      planAuthority: input.planAuthority,
      actorKind: input.actorKind,
    }),
    rendererSafe: true,
  };
}

function buildPlanProjectionMutationEnvelope(input = {}) {
  input = isPlainObject(input) ? input : {};
  const actorKind = normalizeEnum(input.actorKind, PLAN_ACTOR_KINDS, "resident_model");
  const planOwner = normalizeEnum(input.planOwner, PLAN_OWNERS, "resident_model");
  const planAuthority = normalizeEnum(input.planAuthority, PLAN_AUTHORITIES, "assistant_working_plan");
  const requestedMutationKind = normalizeEnum(input.mutationKind, PLAN_MUTATION_KINDS, "replace_plan");
  const beforePlan = defaultPlanState(input);
  beforePlan.planId = normalizeString(input.planId, beforePlan.planId);
  beforePlan.planOwner = planOwner;
  beforePlan.planAuthority = planAuthority;
  const beforePlanDigest = normalizeString(input.beforePlanDigest || input.currentPlanDigest, digestPlanState(beforePlan));
  const expectedBeforePlanDigest = normalizeString(input.expectedBeforePlanDigest, beforePlanDigest);
  const blockers = [];
  if (expectedBeforePlanDigest && expectedBeforePlanDigest !== beforePlanDigest) blockers.push("stale_plan_digest");
  if (actorKind === "resident_model" && planOwner !== "resident_model") blockers.push("resident_cannot_mutate_non_resident_plan");
  if (actorKind === "resident_model" && planAuthority !== "assistant_working_plan") blockers.push("resident_cannot_mutate_non_assistant_working_plan");
  for (const [flag, blocker] of [
    ["mutatesWorkThreadTruth", "workthread_truth_mutation_forbidden"],
    ["mutatesProjectTruth", "project_truth_mutation_forbidden"],
    ["mutatesOperatorPlan", "operator_plan_mutation_forbidden"],
    ["closesObligations", "obligation_closure_forbidden"],
    ["marksWorkThreadComplete", "workthread_completion_forbidden"],
    ["approvesTools", "tool_approval_forbidden"],
    ["provesCompletion", "completion_proof_forbidden"],
  ]) {
    if (input[flag] === true) blockers.push(blocker);
  }
  const blocked = blockers.length > 0 || requestedMutationKind === "blocked";
  const afterPlan = applyPlanMutation(beforePlan, input, blocked);
  const envelope = {
    schema: PLAN_PROJECTION_MUTATION_ENVELOPE_SCHEMA,
    envelopeId: normalizeString(input.envelopeId, ""),
    projectId: normalizeString(input.projectId, ""),
    planId: normalizeString(input.planId, beforePlan.planId || ""),
    updateId: normalizeString(input.updateId, ""),
    workThreadId: normalizeString(input.workThreadId, ""),
    threadId: normalizeString(input.threadId, ""),
    actorKind,
    planOwner,
    planAuthority,
    sourceTurnId: normalizeString(input.sourceTurnId || input.turnId, ""),
    beforePlanDigest,
    afterPlanDigest: digestPlanState(afterPlan),
    stepStatus: normalizePlanStepStatus(input.stepStatus || input.steps?.[0]?.status, "pending"),
    mutationKind: blocked ? "blocked" : requestedMutationKind,
    blocked,
    blockerCodes: blockers.sort((a, b) => a.localeCompare(b)),
    beforePlan,
    afterPlan,
    authorityDecisionRef: buildAuthorityDecisionRef(input, blocked, blockers),
    mutatesWorkThreadTruth: false,
    mutatesProjectTruth: false,
    mutatesOperatorPlan: false,
    closesObligations: false,
    marksWorkThreadComplete: false,
    approvesTools: false,
    provesCompletion: false,
    humanInstructionWins: true,
    mayEnterContextAs: "plan_evidence",
    mayAuthorizeAction: false,
    mayApproveTools: false,
    mayProveCompletion: false,
    evidenceRefs: normalizeEvidenceRefs(input.evidenceRefs),
    rawTextIncluded: false,
    rawSecretIncluded: false,
    createdAt: normalizeString(input.createdAt, nowIso(input.nowMs)),
  };
  envelope.envelopeId = envelope.envelopeId || `plan_projection_${digestFor("plan-projection-envelope-source@1", envelope).slice(0, 24)}`;
  envelope.updateId = envelope.updateId || `plan_update_${digestFor("plan-projection-update-source@1", {
    planId: envelope.planId,
    sourceTurnId: envelope.sourceTurnId,
    mutationKind: requestedMutationKind,
    afterPlanDigest: envelope.afterPlanDigest,
  }).slice(0, 24)}`;
  envelope.envelopeDigest = digestFor("plan_projection_mutation_envelope@1", envelope);
  return envelope;
}

function buildPlanProjectionStore(input = {}) {
  input = isPlainObject(input) ? input : {};
  const sourceEnvelopes = Array.isArray(input.envelopes)
    ? (input.envelope ? [...input.envelopes, input.envelope] : input.envelopes)
    : [input.envelope || buildPlanProjectionMutationEnvelope(input)];
  const envelopes = [];
  const seenUpdates = new Set();
  for (const envelope of sourceEnvelopes) {
    if (!isPlainObject(envelope)) continue;
    const updateId = normalizeString(envelope.updateId, "");
    if (updateId && seenUpdates.has(updateId)) continue;
    if (updateId) seenUpdates.add(updateId);
    envelopes.push(envelope);
  }
  const acceptedEnvelopes = envelopes.filter((envelope) => envelope.schema === PLAN_PROJECTION_MUTATION_ENVELOPE_SCHEMA && envelope.blocked !== true);
  const currentEnvelope = acceptedEnvelopes[acceptedEnvelopes.length - 1] || null;
  const store = {
    schema: PLAN_PROJECTION_STORE_SCHEMA,
    storeId: normalizeString(input.storeId, ""),
    projectId: normalizeString(input.projectId, currentEnvelope?.projectId || ""),
    workThreadId: normalizeString(input.workThreadId, currentEnvelope?.workThreadId || ""),
    threadId: normalizeString(input.threadId, currentEnvelope?.threadId || ""),
    planId: normalizeString(input.planId, currentEnvelope?.planId || ""),
    planOwner: normalizeEnum(input.planOwner || currentEnvelope?.planOwner, PLAN_OWNERS, "resident_model"),
    planAuthority: normalizeEnum(input.planAuthority || currentEnvelope?.planAuthority, PLAN_AUTHORITIES, "assistant_working_plan"),
    generation: Number.isFinite(Number(input.generation)) ? Number(input.generation) : envelopes.length,
    envelopes,
    envelopeCount: envelopes.length,
    acceptedEnvelopeCount: acceptedEnvelopes.length,
    blockedEnvelopeCount: envelopes.length - acceptedEnvelopes.length,
    currentPlan: currentEnvelope?.afterPlan || defaultPlanState(input),
    mutatesWorkThreadTruth: false,
    mutatesProjectTruth: false,
    mutatesOperatorPlan: false,
    closesObligations: false,
    marksWorkThreadComplete: false,
    approvesTools: false,
    provesCompletion: false,
    rawTextIncluded: false,
    rawSecretIncluded: false,
    updatedAt: normalizeString(input.updatedAt, nowIso(input.nowMs)),
  };
  store.currentPlanDigest = digestPlanState(store.currentPlan);
  store.storeId = store.storeId || `plan_projection_store_${digestFor("plan-projection-store-source@1", {
    planId: store.planId,
    workThreadId: store.workThreadId,
    currentPlanDigest: store.currentPlanDigest,
  }).slice(0, 24)}`;
  store.storeDigest = digestFor("plan_projection_store@1", store);
  return store;
}

function buildPlanArtifact(input = {}) {
  return buildPlanProjectionMutationEnvelope(input);
}

function buildLegacyPlanArtifact(input = {}) {
  const conflictsWithCurrentUserIntent = input.conflictsWithCurrentUserIntent === true;
  const plan = {
    schema: DIRECT_PLAN_ARTIFACT_SCHEMA,
    planId: normalizeString(input.planId, ""),
    projectId: normalizeString(input.projectId, ""),
    threadId: normalizeString(input.threadId, ""),
    sourceTurnId: normalizeString(input.sourceTurnId || input.turnId, ""),
    source: normalizeEnum(input.source, PLAN_SOURCES, "model_tool_call"),
    status: normalizeEnum(input.status, PLAN_STATUSES, conflictsWithCurrentUserIntent ? "blocked" : "active"),
    sourceRefs: normalizeSourceRefs(input.sourceRefs),
    steps: (Array.isArray(input.steps) ? input.steps : []).map((step, index) => ({
      stepId: boundedString(step?.stepId || step?.id || `step_${index + 1}`, 80),
      text: boundedString(step?.text || step?.step || step, 280),
      status: boundedString(step?.status || "pending", 60),
    })),
    conflictsWithCurrentUserIntent,
    humanInstructionWins: true,
    mayEnterContextAs: "plan_evidence",
    mayAuthorizeAction: false,
    mayApproveTools: false,
    mayProveCompletion: false,
    mayMutateHumanObjective: false,
    rawTextIncluded: false,
    rawSecretIncluded: false,
    createdAt: normalizeString(input.createdAt, nowIso(input.nowMs)),
  };
  plan.planId = plan.planId || `plan_${digestFor("plan-source@1", plan).slice(0, 24)}`;
  plan.planDigest = digestFor("direct-plan-artifact@1", plan);
  return plan;
}

function buildViewImageProjection(input = {}) {
  const providerVisibilityState = normalizeEnum(input.providerVisibilityState, PROVIDER_VISIBILITY_STATES, "metadata_only");
  const providerVisibilityEvidence = normalizeEnum(
    input.providerVisibilityEvidence,
    PROVIDER_VISIBILITY_EVIDENCE,
    providerVisibilityState === "unsupported" ? "unsupported" : "not_sent",
  );
  const projection = {
    schema: DIRECT_VIEW_IMAGE_PROJECTION_SCHEMA,
    projectionId: normalizeString(input.projectionId, ""),
    projectId: normalizeString(input.projectId, ""),
    threadId: normalizeString(input.threadId, ""),
    turnId: normalizeString(input.turnId, ""),
    pathEvidenceKey: boundedString(input.pathEvidenceKey, 180),
    displayName: boundedString(input.displayName || input.fileName, 160),
    displayPath: boundedString(input.displayPath, 240),
    mimeType: boundedString(input.mimeType || input.sniffedMime || "unknown", 120),
    sizeBytes: Number(input.sizeBytes || 0),
    width: Number(input.width || 0),
    height: Number(input.height || 0),
    rendererPreviewAvailable: input.rendererPreviewAvailable === true,
    providerVisibilityState,
    providerVisibilityEvidence,
    metadataStrippingPolicy: normalizeString(input.metadataStrippingPolicy, "not_payload_sent"),
    decodeCapsApplied: input.decodeCapsApplied !== false,
    pathContained: input.pathContained !== false,
    modelSawPixels: providerVisibilityState === "image_payload_sent" && providerVisibilityEvidence === "image_payload_accepted_provider_event",
    imagePayloadSent: providerVisibilityState === "image_payload_sent",
    providerUseProven: false,
    rawPathIncluded: false,
    rawImageBytesIncluded: false,
    rawSecretIncluded: false,
    observedAt: normalizeString(input.observedAt, nowIso(input.nowMs)),
  };
  projection.projectionId = projection.projectionId || `view_image_${digestFor("view-image-source@1", projection).slice(0, 24)}`;
  projection.projectionDigest = digestFor("direct-view-image-projection@1", projection);
  return projection;
}

function buildHumanDecisionToolPacket(input = {}) {
  const toolKind = normalizeEnum(input.toolKind, HUMAN_DECISION_TOOL_KINDS, "request_user_input");
  const choices = normalizeChoices(input.choices);
  const packet = {
    schema: DIRECT_HUMAN_DECISION_TOOL_PACKET_SCHEMA,
    decisionPacketId: normalizeString(input.decisionPacketId, ""),
    projectId: normalizeString(input.projectId, ""),
    threadId: normalizeString(input.threadId, ""),
    turnId: normalizeString(input.turnId, ""),
    toolKind,
    promptPreview: boundedString(input.promptPreview || input.prompt, 240),
    choices,
    boundedChoiceCount: choices.length,
    freeTextAllowed: input.freeTextAllowed === true,
    freeTextPolicy: "context_only",
    boundedChoiceMayCarryAuthority: choices.some((choice) => choice.carriesAuthority === true),
    freeTextCanWidenAuthority: false,
    permissionWideningRequested: toolKind === "request_permissions" || input.permissionWideningRequested === true,
    defaultWideningScope: toolKind === "request_permissions" ? normalizeString(input.defaultWideningScope, "single_action") : "",
    mayApproveToolAction: false,
    mayMutateWorkspace: false,
    mayMutateProjectConfig: false,
    mayStartProviderTurn: false,
    providerDeclarationEnabled: false,
    rawTextIncluded: false,
    rawSecretIncluded: false,
    createdAt: normalizeString(input.createdAt, nowIso(input.nowMs)),
  };
  packet.decisionPacketId = packet.decisionPacketId || `human_decision_${digestFor("human-decision-source@1", packet).slice(0, 24)}`;
  packet.packetDigest = digestFor("direct-human-decision-tool-packet@1", packet);
  return packet;
}

function buildNewContextBlockedProjection(input = {}) {
  const projection = {
    schema: DIRECT_NEW_CONTEXT_BLOCKED_PROJECTION_SCHEMA,
    projectionId: normalizeString(input.projectionId, ""),
    projectId: normalizeString(input.projectId, ""),
    threadId: normalizeString(input.threadId, ""),
    turnId: normalizeString(input.turnId, ""),
    toolId: "vanilla.new_context",
    state: "blocked",
    reason: normalizeString(input.reason, "blocked_until_context_maintenance_law"),
    requiredArtifacts: [
      "context_maintenance_manifest",
      "context_omission_ledger",
      "frontier_baton",
      "request_manifest",
      "source_refs",
    ],
    providerDeclarationEnabled: false,
    localExecutorEnabled: false,
    requestShapeExposureEnabled: false,
    contextWorldMutationAllowed: false,
    rawTextIncluded: false,
    rawSecretIncluded: false,
    observedAt: normalizeString(input.observedAt, nowIso(input.nowMs)),
  };
  projection.projectionId = projection.projectionId || `new_context_blocked_${digestFor("new-context-blocked-source@1", projection).slice(0, 24)}`;
  projection.projectionDigest = digestFor("direct-new-context-blocked-projection@1", projection);
  return projection;
}

function buildControlToolSubstrateStatus(input = {}) {
  const contextRemaining = isPlainObject(input.contextRemaining)
    ? input.contextRemaining
    : buildContextRemainingWitness(input.contextRemainingInput || input);
  const planArtifact = isPlainObject(input.planArtifact)
    ? input.planArtifact
    : buildPlanProjectionMutationEnvelope(input.planInput || input);
  const planStore = isPlainObject(input.planStore)
    ? input.planStore
    : buildPlanProjectionStore({
      ...(input.planStoreInput || {}),
      projectId: input.projectId,
      workThreadId: input.workThreadId,
      threadId: input.threadId,
      planId: planArtifact.planId,
      envelope: planArtifact,
      nowMs: input.nowMs,
    });
  const viewImage = isPlainObject(input.viewImage)
    ? input.viewImage
    : buildViewImageProjection(input.viewImageInput || input);
  const humanDecision = isPlainObject(input.humanDecision)
    ? input.humanDecision
    : buildHumanDecisionToolPacket(input.humanDecisionInput || input);
  const newContext = isPlainObject(input.newContext)
    ? input.newContext
    : buildNewContextBlockedProjection(input.newContextInput || input);
  const status = {
    schema: DIRECT_CONTROL_TOOL_SUBSTRATE_STATUS_SCHEMA,
    projectId: normalizeString(input.projectId, contextRemaining.projectId || ""),
    threadId: normalizeString(input.threadId, contextRemaining.threadId || ""),
    status: normalizeString(input.status, "substrate_only"),
    tools: {
      getContextRemaining: contextRemaining,
      updatePlan: planArtifact,
      planStore,
      viewImage,
      requestUserInput: humanDecision,
      newContext,
    },
    rowCount: 5,
    executableToolCount: 0,
    providerDeclaredToolCount: 0,
    localExecutorEnabledInThisPr: false,
    providerDeclarationEnabledInThisPr: false,
    authorityGateEnabledInThisPr: false,
    workspaceMutationAllowed: false,
    agentSpawnAllowed: false,
    externalToolExecutionAllowed: false,
    newContextBlocked: newContext.state === "blocked",
    freeTextCanWidenAuthority: false,
    planMayAuthorizeAction: false,
    imageProviderVisibilityState: viewImage.providerVisibilityState,
    contextEstimateUsableFor: contextRemaining.usableFor,
    rendererSafeSummary: boundedString(input.rendererSafeSummary || "Control, perception, and human-decision tool substrate is renderer-safe and non-executable in this PR.", 420),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    generatedAt: normalizeString(input.generatedAt, nowIso(input.nowMs)),
  };
  status.statusDigest = digestFor("direct-control-tool-substrate-status@1", status);
  return status;
}

function assertControlToolSubstrateSafe(status = {}) {
  if (!isPlainObject(status) || status.schema !== DIRECT_CONTROL_TOOL_SUBSTRATE_STATUS_SCHEMA) {
    throw new Error("direct_control_tool_substrate_status_schema_mismatch");
  }
  if (status.executableToolCount !== 0 || status.providerDeclaredToolCount !== 0) {
    throw new Error("direct_control_tool_substrate_unexpected_tool_enablement");
  }
  for (const flag of [
    "localExecutorEnabledInThisPr",
    "providerDeclarationEnabledInThisPr",
    "authorityGateEnabledInThisPr",
    "workspaceMutationAllowed",
    "agentSpawnAllowed",
    "externalToolExecutionAllowed",
    "freeTextCanWidenAuthority",
    "planMayAuthorizeAction",
    "rawTextIncluded",
    "rawPathIncluded",
    "rawSecretIncluded",
  ]) {
    if (status[flag] !== false) throw new Error(`direct_control_tool_substrate_authority_leak:${flag}`);
  }
  const tools = isPlainObject(status.tools) ? status.tools : {};
  if (tools.newContext?.state !== "blocked") throw new Error("direct_control_tool_substrate_new_context_not_blocked");
  if (
    tools.updatePlan?.mayAuthorizeAction !== false
    || tools.updatePlan?.mayProveCompletion !== false
    || tools.updatePlan?.mutatesWorkThreadTruth !== false
    || tools.updatePlan?.mutatesProjectTruth !== false
    || tools.updatePlan?.mutatesOperatorPlan !== false
    || tools.updatePlan?.marksWorkThreadComplete !== false
  ) {
    throw new Error("direct_control_tool_substrate_plan_authority_leak");
  }
  if (tools.getContextRemaining?.usableFor === "request_blocking") {
    throw new Error("direct_control_tool_substrate_context_request_blocking_leak");
  }
  if (tools.requestUserInput?.freeTextCanWidenAuthority !== false) {
    throw new Error("direct_control_tool_substrate_free_text_authority_leak");
  }
  if (tools.viewImage?.rawImageBytesIncluded !== false || tools.viewImage?.rawPathIncluded !== false) {
    throw new Error("direct_control_tool_substrate_image_raw_exposure");
  }
  return true;
}

module.exports = {
  DIRECT_CONTEXT_REMAINING_WITNESS_SCHEMA,
  DIRECT_CONTROL_TOOL_SUBSTRATE_STATUS_SCHEMA,
  DIRECT_HUMAN_DECISION_TOOL_PACKET_SCHEMA,
  DIRECT_NEW_CONTEXT_BLOCKED_PROJECTION_SCHEMA,
  DIRECT_PLAN_ARTIFACT_SCHEMA,
  DIRECT_VIEW_IMAGE_PROJECTION_SCHEMA,
  PLAN_PROJECTION_MUTATION_ENVELOPE_SCHEMA,
  PLAN_PROJECTION_STORE_SCHEMA,
  assertControlToolSubstrateSafe,
  buildContextRemainingWitness,
  buildControlToolSubstrateStatus,
  buildHumanDecisionToolPacket,
  buildNewContextBlockedProjection,
  buildPlanArtifact,
  buildLegacyPlanArtifact,
  buildPlanProjectionMutationEnvelope,
  buildPlanProjectionStore,
  buildViewImageProjection,
  stableStringify,
};
