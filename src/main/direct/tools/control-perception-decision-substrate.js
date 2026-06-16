"use strict";

const crypto = require("node:crypto");

const DIRECT_CONTROL_TOOL_SUBSTRATE_STATUS_SCHEMA = "direct_control_tool_substrate_status@1";
const DIRECT_CONTEXT_REMAINING_WITNESS_SCHEMA = "direct_context_remaining_witness@1";
const DIRECT_PLAN_ARTIFACT_SCHEMA = "direct_plan_artifact@1";
const DIRECT_VIEW_IMAGE_PROJECTION_SCHEMA = "direct_view_image_projection@1";
const DIRECT_HUMAN_DECISION_TOOL_PACKET_SCHEMA = "direct_human_decision_tool_packet@1";
const DIRECT_NEW_CONTEXT_BLOCKED_PROJECTION_SCHEMA = "direct_new_context_blocked_projection@1";

const ESTIMATE_KINDS = new Set(["provider_reported", "local_tokenizer_estimate", "budget_policy_estimate", "unknown"]);
const USABLE_FOR = new Set(["display_only", "context_maintenance_diagnostic", "request_blocking"]);
const PLAN_SOURCES = new Set(["model_tool_call", "human_edit", "harness_import"]);
const PLAN_STATUSES = new Set(["active", "superseded", "stale", "blocked"]);
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
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => (entry === undefined ? "null" : stableStringify(entry))).join(",")}]`;
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
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
  const tokensLeft = input.tokensLeft === null || input.tokensLeft === undefined ? null : Number(input.tokensLeft);
  const witness = {
    schema: DIRECT_CONTEXT_REMAINING_WITNESS_SCHEMA,
    witnessId: normalizeString(input.witnessId, ""),
    projectId: normalizeString(input.projectId, ""),
    threadId: normalizeString(input.threadId, ""),
    turnId: normalizeString(input.turnId, ""),
    tokensLeft: Number.isFinite(tokensLeft) ? tokensLeft : null,
    confidence: normalizeString(input.confidence, Number.isFinite(tokensLeft) ? "derived" : "unknown"),
    source: normalizeString(input.source, Number.isFinite(tokensLeft) ? "direct_context_pressure_estimate" : "unavailable"),
    observedAt: normalizeString(input.observedAt, nowIso(input.nowMs)),
    estimateKind: normalizeEnum(input.estimateKind, ESTIMATE_KINDS, Number.isFinite(tokensLeft) ? "budget_policy_estimate" : "unknown"),
    usableFor: normalizeEnum(input.usableFor, USABLE_FOR, "display_only"),
    providerTruth: input.providerTruth === true,
    permissionToContinue: false,
    compactionAuthority: false,
    providerCompactionAuthority: false,
    rawTextIncluded: false,
    rawSecretIncluded: false,
  };
  witness.witnessId = witness.witnessId || `context_remaining_${digestFor("context-remaining-source@1", witness).slice(0, 24)}`;
  witness.witnessDigest = digestFor("direct-context-remaining-witness@1", witness);
  return witness;
}

function buildPlanArtifact(input = {}) {
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
    : buildPlanArtifact(input.planInput || input);
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
  if (tools.updatePlan?.mayAuthorizeAction !== false || tools.updatePlan?.mayProveCompletion !== false) {
    throw new Error("direct_control_tool_substrate_plan_authority_leak");
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
  assertControlToolSubstrateSafe,
  buildContextRemainingWitness,
  buildControlToolSubstrateStatus,
  buildHumanDecisionToolPacket,
  buildNewContextBlockedProjection,
  buildPlanArtifact,
  buildViewImageProjection,
  stableStringify,
};
