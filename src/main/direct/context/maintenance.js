"use strict";

const crypto = require("node:crypto");

const DIRECT_CONTEXT_PRESSURE_ESTIMATE_SCHEMA = "direct_context_pressure_estimate@1";
const DIRECT_CONTEXT_MAINTENANCE_ROUTE_INPUT_SCHEMA = "context_maintenance_route_input@1";
const DIRECT_CONTEXT_MAINTENANCE_ROUTE_SCHEMA = "context_maintenance_route@1";
const DIRECT_CONTEXT_MAINTENANCE_MANIFEST_SCHEMA = "context_maintenance_manifest@1";
const DIRECT_RAW_WINDOW_TRIM_POLICY_SCHEMA = "raw_window_trim_policy@1";
const DIRECT_RAW_WINDOW_TRIM_PLAN_SCHEMA = "raw_window_trim_plan@1";
const DIRECT_CONTEXT_OMISSION_LEDGER_SCHEMA = "context_omission_ledger@1";
const DIRECT_DURABLE_THREAD_MEMORY_SCHEMA = "durable_thread_memory@1";
const DIRECT_THREAD_MEMORY_REFRESH_SCHEMA = "thread_memory_refresh@1";
const DIRECT_THREAD_MEMORY_REVIEW_PACKET_SCHEMA = "thread_memory_review_packet@1";
const DIRECT_THREAD_MEMORY_REFRESH_PROPOSAL_SCHEMA = "thread_memory_refresh_proposal@1";
const DIRECT_THREAD_MEMORY_RESET_POLICY_SCHEMA = "thread_memory_reset_policy@1";
const DIRECT_THREAD_MEMORY_RESET_CONFIRMATION_SCHEMA = "thread_memory_reset_confirmation@1";
const DIRECT_FRONTIER_BATON_SCHEMA = "frontier_baton@1";
const DIRECT_CONTEXT_COMPACTION_PLAN_SCHEMA = "direct_context_compaction_plan@1";
const DIRECT_CONTEXT_COMPACTION_GATE_SCHEMA = "direct_context_compaction_gate@1";
const DIRECT_CONTEXT_LOSS_WITNESS_SCHEMA = "direct_context_loss_witness@1";
const DIRECT_CONTEXT_CONTINUITY_TRANSITION_SCHEMA = "direct_context_continuity_transition@1";
const DIRECT_CONTEXT_CONTINUITY_STATUS_PROJECTION_SCHEMA = "direct_context_continuity_status_projection@1";
const DIRECT_CONTEXT_MAINTENANCE_EXECUTION_PACKET_SCHEMA = "direct_context_maintenance_execution_packet@1";
const DIRECT_CONTEXT_MAINTENANCE_EXECUTION_RESULT_SCHEMA = "direct_context_maintenance_execution_result@1";
const DIRECT_VANILLA_SIBLING_CONTEXT_EVIDENCE_SCHEMA = "direct_vanilla_sibling_context_evidence@1";
const DIRECT_CONTEXT_MAINTENANCE_STATUS_PROJECTION_SCHEMA = "direct_context_maintenance_status_projection@1";
const DIRECT_CONTEXT_MAINTENANCE_REGRESSION_REPORT_SCHEMA = "direct_context_maintenance_regression_report@1";
const DIRECT_CONTEXT_MAINTENANCE_POLICY_VERSION = "direct-context-maintenance-policy@1";
const DIRECT_CONTEXT_ROUTE_SELECTOR_VERSION = "direct-context-route-selector@1";

const DIRECT_REQUIRED_CONTEXT_ARTIFACT_CLASSES = Object.freeze([
  "current_user_intent",
  "harness_policy",
  "runtime_tier",
  "open_tool_obligation",
  "unresolved_patch_journal",
  "command_result_pending_provider_visibility",
  "workspace_effect_summary",
  "recovery_required_state",
  "frontier_baton_required",
  "durable_memory_required",
  "source_omission_marker",
  "fresh_fork_seed",
  "provider_parent_response_proof",
]);

const ROUTE_CLASSES = new Set(["no_change", "diagnostic", "trim", "compaction", "memory", "baton", "blocked"]);
const ROUTE_KINDS = new Set([
  "no_op",
  "estimate_only",
  "local_trim",
  "local_compaction",
  "remote_compaction",
  "hybrid_compaction",
  "memory_refresh",
  "frontier_baton_build",
  "blocked",
]);
const MAINTENANCE_ENGINES = new Set([
  "local_deterministic",
  "local_model_text",
  "provider_compact_primitive",
  "provider_text_summary",
  "none",
]);
const MEMORY_REVIEW_STATES = new Set(["current", "review_required", "stale", "conflicted", "missing", "blocked"]);
const MEMORY_REFRESH_PROPOSAL_STATES = new Set(["proposed", "accepted", "rejected", "blocked"]);
const MEMORY_RESET_POLICY_STATES = new Set(["disabled", "available_with_confirmation", "blocked"]);
const MEMORY_RESET_CONFIRMATION_STATES = new Set(["not_requested", "confirmed_noop", "rejected", "blocked"]);
const COMPACTION_PLAN_STATES = new Set([
  "preview_ready",
  "blocked_missing_context_loss_witness",
  "blocked_unrepresented_omission",
  "blocked_required_context",
  "blocked_no_source_spans",
]);
const COMPACTION_GATE_STATES = new Set([
  "not_requested",
  "manual_ready",
  "blocked_missing_context_loss_witness",
  "blocked_unrepresented_omission",
  "blocked_required_context",
  "blocked_no_source_spans",
  "blocked_provider_evidence",
  "blocked_plan",
]);
const CONTEXT_MAINTENANCE_EXECUTION_ACTIONS = new Set([
  "memory_refresh_materialize",
  "frontier_baton_update",
  "omission_witness_acknowledge",
  "context_loss_remediation_preview",
]);
const CONTEXT_MAINTENANCE_OPERATOR_DECISIONS = new Set(["accepted", "rejected", "deferred"]);

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function nowIso(nowMs = Date.now()) {
  return new Date(nowMs).toISOString();
}

function artifactDigest(input) {
  return sha256(stableStringify(input));
}

function makeIntegrity(sourceDigest, previousArtifactDigest = "") {
  return {
    algorithm: "sha256",
    artifactDigest: "",
    sourceDigest: normalizeString(sourceDigest, ""),
    previousArtifactDigest: normalizeString(previousArtifactDigest, ""),
  };
}

function routeClassForKind(routeKind) {
  switch (routeKind) {
    case "no_op":
      return "no_change";
    case "estimate_only":
      return "diagnostic";
    case "local_trim":
      return "trim";
    case "local_compaction":
    case "remote_compaction":
    case "hybrid_compaction":
      return "compaction";
    case "memory_refresh":
      return "memory";
    case "frontier_baton_build":
      return "baton";
    default:
      return "blocked";
  }
}

function buildPressureEstimate(input = {}) {
  const estimatedVisibleTokens = Number(input.estimatedVisibleTokens || Math.ceil(Number(input.visibleCharCount || 0) / 4));
  const hiddenRequiredTokens = Number(input.hiddenRequiredTokens || 0);
  const reservedOutputTokens = Number(input.reservedOutputTokens || 4096);
  const modelContextWindowEstimate = input.modelContextWindowEstimate === null || input.modelContextWindowEstimate === undefined
    ? null
    : Number(input.modelContextWindowEstimate);
  const totalEstimatedTokens = estimatedVisibleTokens + hiddenRequiredTokens + reservedOutputTokens;
  let pressureState = normalizeString(input.pressureState, "");
  if (!pressureState) {
    if (!modelContextWindowEstimate) pressureState = "unknown";
    else if (hiddenRequiredTokens + reservedOutputTokens > modelContextWindowEstimate) pressureState = "required_artifact_at_risk";
    else if (totalEstimatedTokens > modelContextWindowEstimate) pressureState = "over_budget";
    else if (totalEstimatedTokens > modelContextWindowEstimate * 0.75) pressureState = "approaching_budget";
    else pressureState = "within_budget";
  }
  const pressureEstimate = {
    schema: DIRECT_CONTEXT_PRESSURE_ESTIMATE_SCHEMA,
    pressureEstimateId: normalizeString(input.pressureEstimateId, `context_pressure_${sha256(`${input.projectId}:${input.threadId}:${totalEstimatedTokens}:${pressureState}`).slice(0, 24)}`),
    projectId: normalizeString(input.projectId, ""),
    threadId: normalizeString(input.threadId, ""),
    modelId: normalizeString(input.modelId, ""),
    pressureState,
    estimatedVisibleTokens,
    hiddenRequiredTokens,
    reservedOutputTokens,
    totalEstimatedTokens,
    modelContextWindowEstimate,
    requiredRefsAccountedFor: input.requiredRefsAccountedFor !== false,
    estimateConfidence: normalizeString(input.estimateConfidence, modelContextWindowEstimate ? "derived" : "unknown"),
    sourceDigest: normalizeString(input.sourceDigest, sha256(stableStringify({
      projectId: input.projectId,
      threadId: input.threadId,
      estimatedVisibleTokens,
      hiddenRequiredTokens,
      reservedOutputTokens,
      modelContextWindowEstimate,
    }))),
    policyDigest: normalizeString(input.policyDigest, sha256(DIRECT_CONTEXT_MAINTENANCE_POLICY_VERSION)),
    createdAt: normalizeString(input.createdAt, nowIso(input.nowMs)),
  };
  pressureEstimate.integrity = makeIntegrity(pressureEstimate.sourceDigest);
  pressureEstimate.integrity.artifactDigest = artifactDigest({ ...pressureEstimate, integrity: { ...pressureEstimate.integrity, artifactDigest: "" } });
  return pressureEstimate;
}

function buildRouteInput(input = {}) {
  const pressureEstimate = isPlainObject(input.pressureEstimate) ? input.pressureEstimate : null;
  const routeInput = {
    schema: DIRECT_CONTEXT_MAINTENANCE_ROUTE_INPUT_SCHEMA,
    projectId: normalizeString(input.projectId, pressureEstimate?.projectId || ""),
    threadId: normalizeString(input.threadId, pressureEstimate?.threadId || ""),
    trigger: normalizeString(input.trigger, "pre_request"),
    modelId: normalizeString(input.modelId, pressureEstimate?.modelId || ""),
    pressureEstimateId: normalizeString(input.pressureEstimateId, pressureEstimate?.pressureEstimateId || ""),
    pressureEstimateDigest: normalizeString(input.pressureEstimateDigest, pressureEstimate?.integrity?.artifactDigest || ""),
    currentContextProjectionId: normalizeString(input.currentContextProjectionId, ""),
    currentContextProjectionDigest: normalizeString(input.currentContextProjectionDigest, ""),
    activeObligationStateDigest: normalizeString(input.activeObligationStateDigest, ""),
    recoveryStateDigest: normalizeString(input.recoveryStateDigest, ""),
    policyDigest: normalizeString(input.policyDigest, pressureEstimate?.policyDigest || sha256(DIRECT_CONTEXT_MAINTENANCE_POLICY_VERSION)),
    routeSelectorVersion: normalizeString(input.routeSelectorVersion, DIRECT_CONTEXT_ROUTE_SELECTOR_VERSION),
    flags: {
      activeObligation: input.activeObligation === true,
      handoffUnknown: input.handoffUnknown === true,
      corruptLedger: input.corruptLedger === true,
      batonRequired: input.batonRequired === true,
      memoryRefreshRequested: input.memoryRefreshRequested === true,
      providerCompactionRequested: input.providerCompactionRequested === true,
      providerCompactionEvidenceAvailable: input.providerCompactionEvidenceAvailable === true,
      trimRequested: input.trimRequested === true,
    },
  };
  routeInput.inputDigest = sha256(stableStringify(routeInput));
  return routeInput;
}

function selectMaintenanceRoute(input = {}) {
  const pressureEstimate = isPlainObject(input.pressureEstimate) ? input.pressureEstimate : buildPressureEstimate(input);
  const routeInput = buildRouteInput({ ...input, pressureEstimate });
  let routeKind = "no_op";
  let engine = "none";
  let reasonCode = "within_budget";
  let blocked = false;

  if (routeInput.flags.activeObligation) {
    blocked = true;
    reasonCode = "active_obligation_blocks_maintenance";
  } else if (routeInput.flags.handoffUnknown) {
    blocked = true;
    reasonCode = "handoff_unknown_blocks_maintenance";
  } else if (routeInput.flags.corruptLedger) {
    blocked = true;
    reasonCode = "corrupt_ledger_blocks_maintenance";
  } else if (routeInput.flags.providerCompactionRequested && !routeInput.flags.providerCompactionEvidenceAvailable) {
    blocked = true;
    reasonCode = "provider_compaction_missing_evidence";
  } else if (pressureEstimate.pressureState === "required_artifact_at_risk") {
    blocked = true;
    reasonCode = "context_budget_required_artifact_at_risk";
  } else if (pressureEstimate.pressureState === "unknown" && (routeInput.flags.trimRequested || routeInput.flags.providerCompactionRequested)) {
    blocked = true;
    reasonCode = "pressure_unknown_over_budget_risk";
  } else if (routeInput.flags.batonRequired) {
    routeKind = "frontier_baton_build";
    engine = "local_deterministic";
    reasonCode = "baton_required";
  } else if (routeInput.flags.memoryRefreshRequested) {
    routeKind = "memory_refresh";
    engine = "local_deterministic";
    reasonCode = "memory_refresh_requested";
  } else if (pressureEstimate.pressureState === "over_budget") {
    routeKind = "local_trim";
    engine = "local_deterministic";
    reasonCode = "over_budget_local_trim";
  } else if (pressureEstimate.pressureState === "approaching_budget") {
    routeKind = "estimate_only";
    engine = "none";
    reasonCode = "approaching_budget_estimate_only";
  }

  if (blocked) {
    routeKind = "blocked";
    engine = "none";
  }
  const routeClass = routeClassForKind(routeKind);
  const route = {
    schema: DIRECT_CONTEXT_MAINTENANCE_ROUTE_SCHEMA,
    routeId: normalizeString(input.routeId, `context_route_${sha256(`${routeInput.inputDigest}:${routeKind}:${reasonCode}`).slice(0, 24)}`),
    projectId: routeInput.projectId,
    threadId: routeInput.threadId,
    routeClass,
    routeKind,
    engine,
    timing: normalizeString(input.timing, "pre_request"),
    trigger: routeInput.trigger,
    reasonCode,
    blocked,
    inputDigest: routeInput.inputDigest,
    policyDigest: routeInput.policyDigest,
    routeSelectorVersion: routeInput.routeSelectorVersion,
    pressureEstimateId: pressureEstimate.pressureEstimateId,
    pressureEstimateDigest: pressureEstimate.integrity?.artifactDigest || "",
    rendererSafeSummary: blocked
      ? "Context maintenance blocked before any provider or workspace action."
      : `Context maintenance selected ${routeKind}.`,
    routeInput,
    createdAt: normalizeString(input.createdAt, nowIso(input.nowMs)),
  };
  route.routeDigest = sha256(stableStringify({
    schema: route.schema,
    routeClass,
    routeKind,
    engine,
    reasonCode,
    inputDigest: route.inputDigest,
    policyDigest: route.policyDigest,
    routeSelectorVersion: route.routeSelectorVersion,
  }));
  route.integrity = makeIntegrity(route.inputDigest);
  route.integrity.artifactDigest = artifactDigest({ ...route, integrity: { ...route.integrity, artifactDigest: "" } });
  return { route, pressureEstimate };
}

function buildRawWindowTrimPolicy(input = {}) {
  const requiredArtifactClasses = Array.isArray(input.requiredArtifactClasses) && input.requiredArtifactClasses.length
    ? [...new Set(input.requiredArtifactClasses.map((entry) => normalizeString(entry, "")).filter(Boolean))]
    : [...DIRECT_REQUIRED_CONTEXT_ARTIFACT_CLASSES];
  const policy = {
    schema: DIRECT_RAW_WINDOW_TRIM_POLICY_SCHEMA,
    trimPolicyId: normalizeString(input.trimPolicyId, "raw_window_trim_policy_default"),
    policyVersion: normalizeString(input.policyVersion, DIRECT_CONTEXT_MAINTENANCE_POLICY_VERSION),
    requiredArtifactClasses,
    optionalArtifactClasses: Array.isArray(input.optionalArtifactClasses) ? input.optionalArtifactClasses.map((entry) => normalizeString(entry, "")).filter(Boolean) : [],
    failClosedBlocker: "context_budget_required_artifact_at_risk",
    rawTextIncluded: false,
  };
  policy.trimPolicyDigest = sha256(stableStringify(policy));
  return policy;
}

function buildTrimPlan(input = {}) {
  const trimPolicy = isPlainObject(input.trimPolicy) ? input.trimPolicy : buildRawWindowTrimPolicy(input);
  const candidates = Array.isArray(input.candidateOmissions) ? input.candidateOmissions : [];
  const requiredSet = new Set(trimPolicy.requiredArtifactClasses || DIRECT_REQUIRED_CONTEXT_ARTIFACT_CLASSES);
  const blockedRequiredArtifacts = [...new Set(candidates
    .filter((candidate) => candidate.requiredArtifact === true || requiredSet.has(candidate.requiredArtifactClass))
    .map((candidate) => normalizeString(candidate.requiredArtifactClass, "unknown_required_artifact")))];
  const status = blockedRequiredArtifacts.length ? "blocked" : normalizeString(input.status, "planned");
  const sourceDigest = normalizeString(input.sourceContextProjectionDigest || input.sourceDigest, sha256(stableStringify(candidates)));
  const plan = {
    schema: DIRECT_RAW_WINDOW_TRIM_PLAN_SCHEMA,
    trimPlanId: normalizeString(input.trimPlanId, `trim_plan_${sha256(`${input.routeId}:${sourceDigest}:${status}`).slice(0, 24)}`),
    routeId: normalizeString(input.routeId, input.route?.routeId || ""),
    projectId: normalizeString(input.projectId, input.route?.projectId || ""),
    threadId: normalizeString(input.threadId, input.route?.threadId || ""),
    sourceContextProjectionId: normalizeString(input.sourceContextProjectionId, ""),
    sourceContextProjectionDigest: sourceDigest,
    requiredArtifactClasses: trimPolicy.requiredArtifactClasses || [],
    candidateOmissions: candidates.map((candidate, index) => ({
      omissionCandidateId: normalizeString(candidate.omissionCandidateId, `omission_candidate_${index + 1}`),
      sourceArtifactKind: normalizeString(candidate.sourceArtifactKind, "context_recent_dialogue"),
      sourceArtifactId: normalizeString(candidate.sourceArtifactId, ""),
      sourceDigest: normalizeString(candidate.sourceDigest, sourceDigest),
      sourceStableKeys: Array.isArray(candidate.sourceStableKeys) ? candidate.sourceStableKeys.map((key) => normalizeString(key, "")).filter(Boolean) : [],
      omittedItemCount: Number(candidate.omittedItemCount || 0),
      omittedTurnCount: Number(candidate.omittedTurnCount || 0),
      omittedCharCount: Number(candidate.omittedCharCount || 0),
      omittedTokenEstimate: Number(candidate.omittedTokenEstimate || 0),
      reason: normalizeString(candidate.reason, "over_budget"),
      requiredArtifact: candidate.requiredArtifact === true,
      requiredArtifactClass: normalizeString(candidate.requiredArtifactClass, ""),
      rendererSafeSummary: normalizeString(candidate.rendererSafeSummary, "Optional context omitted under pressure."),
      rawTextIncluded: false,
    })),
    blockedRequiredArtifacts,
    trimPolicyDigest: trimPolicy.trimPolicyDigest,
    status,
    createdAt: normalizeString(input.createdAt, nowIso(input.nowMs)),
  };
  plan.planDigest = sha256(stableStringify(plan));
  plan.integrity = makeIntegrity(sourceDigest);
  plan.integrity.artifactDigest = artifactDigest({ ...plan, integrity: { ...plan.integrity, artifactDigest: "" } });
  return plan;
}

function buildOmissionLedger(input = {}) {
  const trimPlan = isPlainObject(input.trimPlan) ? input.trimPlan : null;
  if (trimPlan?.status === "blocked" || (Array.isArray(trimPlan?.blockedRequiredArtifacts) && trimPlan.blockedRequiredArtifacts.length)) {
    const error = new Error("context_omission_ledger_blocked_trim_plan");
    error.code = "context_omission_ledger_blocked_trim_plan";
    throw error;
  }
  const requiredClasses = new Set(Array.isArray(trimPlan?.requiredArtifactClasses) ? trimPlan.requiredArtifactClasses : DIRECT_REQUIRED_CONTEXT_ARTIFACT_CLASSES);
  const sourceCandidates = Array.isArray(input.entries)
    ? input.entries
    : (Array.isArray(trimPlan?.candidateOmissions) ? trimPlan.candidateOmissions : []);
  if (sourceCandidates.some((candidate) => candidate.requiredArtifact === true || requiredClasses.has(candidate.requiredArtifactClass))) {
    const error = new Error("context_omission_ledger_required_artifact_candidate");
    error.code = "context_omission_ledger_required_artifact_candidate";
    throw error;
  }
  const entries = sourceCandidates
    .filter((candidate) => candidate.requiredArtifact !== true && !requiredClasses.has(candidate.requiredArtifactClass))
    .map((candidate, index) => ({
      omissionId: normalizeString(candidate.omissionId, `omission_${index + 1}`),
      sourceArtifactKind: normalizeString(candidate.sourceArtifactKind, "context_recent_dialogue"),
      sourceArtifactId: normalizeString(candidate.sourceArtifactId, ""),
      sourceDigest: normalizeString(candidate.sourceDigest, trimPlan?.sourceContextProjectionDigest || ""),
      sourceStableKeys: Array.isArray(candidate.sourceStableKeys) ? candidate.sourceStableKeys : [],
      omittedItemCount: Number(candidate.omittedItemCount || 0),
      omittedTurnCount: Number(candidate.omittedTurnCount || 0),
      omittedCharCount: Number(candidate.omittedCharCount || 0),
      omittedTokenEstimate: Number(candidate.omittedTokenEstimate || 0),
      reason: normalizeString(candidate.reason, "over_budget"),
      requiredArtifact: false,
      rendererSafeSummary: normalizeString(candidate.rendererSafeSummary, "Optional context omitted under pressure."),
      rawTextIncluded: false,
    }));
  const totals = entries.reduce((acc, entry) => ({
    omittedItemCount: acc.omittedItemCount + entry.omittedItemCount,
    omittedTurnCount: acc.omittedTurnCount + entry.omittedTurnCount,
    omittedCharCount: acc.omittedCharCount + entry.omittedCharCount,
    omittedTokenEstimate: acc.omittedTokenEstimate + entry.omittedTokenEstimate,
  }), { omittedItemCount: 0, omittedTurnCount: 0, omittedCharCount: 0, omittedTokenEstimate: 0 });
  const sourceDigest = normalizeString(input.sourceDigest, trimPlan?.integrity?.artifactDigest || trimPlan?.planDigest || sha256(stableStringify(entries)));
  const ledger = {
    schema: DIRECT_CONTEXT_OMISSION_LEDGER_SCHEMA,
    omissionLedgerId: normalizeString(input.omissionLedgerId, `omission_ledger_${sha256(`${input.projectId}:${input.threadId}:${sourceDigest}`).slice(0, 24)}`),
    projectId: normalizeString(input.projectId, trimPlan?.projectId || ""),
    threadId: normalizeString(input.threadId, trimPlan?.threadId || ""),
    routeId: normalizeString(input.routeId, trimPlan?.routeId || ""),
    trimPlanId: normalizeString(input.trimPlanId, trimPlan?.trimPlanId || ""),
    entries,
    totals,
    rawTextIncluded: false,
    createdAt: normalizeString(input.createdAt, nowIso(input.nowMs)),
  };
  ledger.integrity = makeIntegrity(sourceDigest);
  ledger.integrity.artifactDigest = artifactDigest({ ...ledger, integrity: { ...ledger.integrity, artifactDigest: "" } });
  return ledger;
}

function assertOmissionParity({ omissionLedger, contextPack } = {}) {
  const totals = omissionLedger?.totals || {};
  const omittedCounts = contextPack?.caps?.omittedCounts || {};
  const packItems = Number(omittedCounts.context_omission_ledger_items || 0);
  const ledgerItems = Number(totals.omittedItemCount || 0);
  if (packItems !== ledgerItems) {
    const error = new Error("omission_parity_mismatch");
    error.code = "omission_parity_mismatch";
    throw error;
  }
  return true;
}

function buildMaintenanceManifest(input = {}) {
  const route = isPlainObject(input.route) ? input.route : null;
  const pressureEstimate = isPlainObject(input.pressureEstimate) ? input.pressureEstimate : null;
  const producedArtifacts = Array.isArray(input.producedArtifacts) ? input.producedArtifacts : [];
  const sourceDigest = sha256(stableStringify({
    routeDigest: route?.routeDigest || "",
    pressureEstimateDigest: pressureEstimate?.integrity?.artifactDigest || "",
    producedArtifacts,
  }));
  const manifest = {
    schema: DIRECT_CONTEXT_MAINTENANCE_MANIFEST_SCHEMA,
    maintenanceManifestId: normalizeString(input.maintenanceManifestId, `context_maintenance_${sha256(`${route?.routeId || ""}:${sourceDigest}`).slice(0, 24)}`),
    projectId: normalizeString(input.projectId, route?.projectId || pressureEstimate?.projectId || ""),
    threadId: normalizeString(input.threadId, route?.threadId || pressureEstimate?.threadId || ""),
    routeId: normalizeString(input.routeId, route?.routeId || ""),
    routeKind: normalizeString(route?.routeKind, "blocked"),
    routeClass: normalizeString(route?.routeClass, "blocked"),
    pressureEstimateId: normalizeString(pressureEstimate?.pressureEstimateId, ""),
    outputKind: normalizeString(input.outputKind, route?.routeKind === "local_trim" ? "trim_only" : "none"),
    providerTransportUsed: false,
    appServerFallbackUsed: false,
    producedArtifacts,
    blockedReasonCode: route?.blocked ? route.reasonCode : "",
    createdAt: normalizeString(input.createdAt, nowIso(input.nowMs)),
  };
  manifest.integrity = makeIntegrity(sourceDigest);
  manifest.integrity.artifactDigest = artifactDigest({ ...manifest, integrity: { ...manifest.integrity, artifactDigest: "" } });
  return manifest;
}

function buildDurableThreadMemory(input = {}) {
  const entries = Array.isArray(input.entries) ? input.entries : [];
  const memory = {
    schema: DIRECT_DURABLE_THREAD_MEMORY_SCHEMA,
    memoryId: normalizeString(input.memoryId, `thread_memory_${sha256(`${input.projectId}:${input.threadId}:${stableStringify(entries)}`).slice(0, 24)}`),
    projectId: normalizeString(input.projectId, ""),
    threadId: normalizeString(input.threadId, ""),
    lifecycle: normalizeString(input.lifecycle, "active"),
    memoryPointerState: normalizeString(input.memoryPointerState, "current_valid"),
    entries: entries.map((entry, index) => ({
      memoryEntryId: normalizeString(entry.memoryEntryId, `memory_entry_${index + 1}`),
      kind: normalizeString(entry.kind, "fact"),
      authority: normalizeString(entry.authority, "historical_context"),
      contextUse: normalizeString(entry.contextUse, "quoted_context_only"),
      rendererSafeSummary: normalizeString(entry.rendererSafeSummary, ""),
      sourceRefs: Array.isArray(entry.sourceRefs) ? entry.sourceRefs : [],
      confidence: normalizeString(entry.confidence, "derived"),
      staleness: normalizeString(entry.staleness, "current"),
      conflictState: normalizeString(entry.conflictState, "none"),
      conflictResolution: normalizeString(entry.conflictResolution, "current_evidence_wins"),
      rawTextIncluded: false,
    })),
    editableInThisPr: false,
    rawTextIncluded: false,
    createdAt: normalizeString(input.createdAt, nowIso(input.nowMs)),
  };
  memory.memoryDigest = sha256(stableStringify(memory));
  memory.integrity = makeIntegrity(normalizeString(input.sourceDigest, memory.memoryDigest), input.previousMemoryDigest);
  memory.integrity.artifactDigest = artifactDigest({ ...memory, integrity: { ...memory.integrity, artifactDigest: "" } });
  return memory;
}

function memoryRefreshSourceRefInvalidReason(ref = {}) {
  if (!isPlainObject(ref)) return "source_ref_invalid";
  const artifactKind = normalizeString(ref.artifactKind, "");
  if (artifactKind === "renderer_dom" || ref.rendererDomOnly === true) return "source_ref_renderer_dom_only";
  if (!normalizeString(ref.artifactDigest, "")) return "source_ref_digest_missing";
  const sourceState = normalizeString(ref.sourceState || ref.projectionState || ref.status, "");
  if (sourceState === "stale") return "source_ref_stale";
  if (sourceState === "blocked") return "source_ref_blocked";
  if (sourceState === "corrupt") return "source_ref_corrupt";
  if (ref.blockedProjection === true) return "source_ref_blocked_projection";
  if (ref.rawTextIncluded === true) return "source_ref_raw_text_included";
  return "";
}

function buildMemoryRefreshManifest(input = {}) {
  const currentMemory = isPlainObject(input.currentMemory) ? input.currentMemory : null;
  const nextMemory = isPlainObject(input.nextMemory) ? input.nextMemory : null;
  const sourceRefs = Array.isArray(input.sourceRefs) ? input.sourceRefs : [];
  for (const sourceRef of sourceRefs) {
    const invalidReason = memoryRefreshSourceRefInvalidReason(sourceRef);
    if (invalidReason) {
      const error = new Error("memory_refresh_source_ref_invalid");
      error.code = "memory_refresh_source_ref_invalid";
      error.reasonCode = invalidReason;
      throw error;
    }
  }
  const status = normalizeString(input.status, nextMemory ? "completed" : "failed_current_retained");
  const manifest = {
    schema: DIRECT_THREAD_MEMORY_REFRESH_SCHEMA,
    memoryRefreshId: normalizeString(input.memoryRefreshId, `memory_refresh_${sha256(`${input.projectId}:${input.threadId}:${status}`).slice(0, 24)}`),
    projectId: normalizeString(input.projectId, nextMemory?.projectId || currentMemory?.projectId || ""),
    threadId: normalizeString(input.threadId, nextMemory?.threadId || currentMemory?.threadId || ""),
    status,
    sourceRefs,
    currentMemoryId: normalizeString(currentMemory?.memoryId, ""),
    nextMemoryId: normalizeString(nextMemory?.memoryId, ""),
    currentRetained: status !== "completed",
    providerTransportUsed: false,
    rawTextIncluded: false,
    createdAt: normalizeString(input.createdAt, nowIso(input.nowMs)),
  };
  manifest.integrity = makeIntegrity(sha256(stableStringify({ sourceRefs: manifest.sourceRefs, currentMemoryId: manifest.currentMemoryId, nextMemoryId: manifest.nextMemoryId })));
  manifest.integrity.artifactDigest = artifactDigest({ ...manifest, integrity: { ...manifest.integrity, artifactDigest: "" } });
  return manifest;
}

function normalizeMemoryWorkflowRef(input = {}, fallbackKind = "memory_source") {
  if (!isPlainObject(input)) return null;
  const artifactKind = normalizeString(input.artifactKind || input.kind, fallbackKind);
  const artifactId = normalizeString(input.artifactId || input.id, "");
  const artifactDigest = normalizeString(input.artifactDigest || input.digest, "");
  if (!artifactId && !artifactDigest) return null;
  return {
    artifactKind,
    artifactId,
    artifactDigest,
    sourceState: normalizeString(input.sourceState || input.status, "accepted"),
    rendererSafeLabel: normalizeString(input.rendererSafeLabel || input.label, artifactKind),
    rawTextIncluded: false,
  };
}

function normalizeMemoryWorkflowRefs(values, fallbackKind = "memory_source") {
  return (Array.isArray(values) ? values : []).map((value) => normalizeMemoryWorkflowRef(value, fallbackKind)).filter(Boolean);
}

function memoryDigestFor(memory = {}) {
  return normalizeString(memory.integrity?.artifactDigest || memory.memoryDigest, "");
}

function memoryWorkflowStateFor(memory = {}) {
  if (!isPlainObject(memory)) return "missing";
  const entries = Array.isArray(memory.entries) ? memory.entries : [];
  const staleCount = entries.filter((entry) => normalizeString(entry.staleness, "current") !== "current").length;
  const conflictCount = entries.filter((entry) => normalizeString(entry.conflictState, "none") !== "none").length;
  if (conflictCount) return "conflicted";
  if (staleCount) return "stale";
  return "current";
}

function buildThreadMemoryReviewPacket(input = {}) {
  const memory = isPlainObject(input.memory) ? input.memory : null;
  const omissionLedger = isPlainObject(input.omissionLedger) ? input.omissionLedger : null;
  const entries = Array.isArray(memory?.entries) ? memory.entries : [];
  const staleEntryCount = entries.filter((entry) => normalizeString(entry.staleness, "current") !== "current").length;
  const conflictEntryCount = entries.filter((entry) => normalizeString(entry.conflictState, "none") !== "none").length;
  const sourceRefs = normalizeMemoryWorkflowRefs(input.sourceRefs, "memory_review_source");
  const omissionRefs = [
    omissionLedger
      ? normalizeMemoryWorkflowRef({
          artifactKind: "context_omission_ledger",
          artifactId: omissionLedger.omissionLedgerId,
          artifactDigest: omissionLedger.integrity?.artifactDigest,
          rendererSafeLabel: "Omission ledger",
        }, "context_omission_ledger")
      : null,
    ...normalizeMemoryWorkflowRefs(input.omissionRefs, "context_omission_ledger"),
  ].filter(Boolean);
  const computedReviewState = memoryWorkflowStateFor(memory);
  const reviewState = MEMORY_REVIEW_STATES.has(input.reviewState) ? input.reviewState : computedReviewState;
  const sourceDigest = sha256(stableStringify({
    memoryDigest: memoryDigestFor(memory || {}),
    sourceRefs,
    omissionRefs,
    reviewState,
    staleEntryCount,
    conflictEntryCount,
  }));
  const packet = {
    schema: DIRECT_THREAD_MEMORY_REVIEW_PACKET_SCHEMA,
    memoryReviewPacketId: normalizeString(input.memoryReviewPacketId, `memory_review_${sourceDigest.slice(0, 24)}`),
    projectId: normalizeString(input.projectId, memory?.projectId || omissionLedger?.projectId || ""),
    threadId: normalizeString(input.threadId, memory?.threadId || omissionLedger?.threadId || ""),
    workThreadId: normalizeString(input.workThreadId, ""),
    currentMemoryId: normalizeString(memory?.memoryId, ""),
    currentMemoryDigest: memoryDigestFor(memory || {}),
    memoryPointerState: normalizeString(memory?.memoryPointerState, "missing"),
    entryCount: entries.length,
    staleEntryCount,
    conflictEntryCount,
    reviewState,
    sourceRefs,
    omissionRefs,
    omissionLedgerId: normalizeString(omissionLedger?.omissionLedgerId, ""),
    omissionLedgerDigest: normalizeString(omissionLedger?.integrity?.artifactDigest, ""),
    omissionItemCount: Number(omissionLedger?.totals?.omittedItemCount || 0),
    refreshProposalAllowed: reviewState !== "blocked" && Boolean(memory),
    memoryAsPolicyAuthority: false,
    providerMemoryClaimAccepted: false,
    rendererSafeSummary: normalizeString(
      input.rendererSafeSummary,
      reviewState === "current"
        ? "Thread memory is current as quoted evidence."
        : "Thread memory needs review before refresh or reset.",
    ),
    rawTextIncluded: false,
    createdAt: normalizeString(input.createdAt, nowIso(input.nowMs)),
  };
  packet.integrity = makeIntegrity(sourceDigest);
  packet.integrity.artifactDigest = artifactDigest({ ...packet, integrity: { ...packet.integrity, artifactDigest: "" } });
  return packet;
}

function buildThreadMemoryRefreshProposal(input = {}) {
  const reviewPacket = isPlainObject(input.reviewPacket) ? input.reviewPacket : null;
  const currentMemory = isPlainObject(input.currentMemory) ? input.currentMemory : null;
  const proposedMemory = isPlainObject(input.proposedMemory || input.nextMemory) ? (input.proposedMemory || input.nextMemory) : null;
  const sourceRefs = normalizeMemoryWorkflowRefs(input.sourceRefs, "memory_refresh_source");
  const requestedState = normalizeString(input.proposalState || input.status, "proposed");
  const reviewState = normalizeString(reviewPacket?.reviewState, reviewPacket ? "unknown" : "missing");
  const hasProposedMemory = Boolean(normalizeString(proposedMemory?.memoryId, ""));
  const proposalCanBeReviewed = hasProposedMemory && reviewPacket && reviewState !== "blocked" && reviewState !== "missing";
  let proposalState = "blocked";
  if (proposalCanBeReviewed) {
    proposalState = MEMORY_REFRESH_PROPOSAL_STATES.has(requestedState) ? requestedState : "proposed";
  }
  const sourceDigest = sha256(stableStringify({
    reviewPacketDigest: reviewPacket?.integrity?.artifactDigest || "",
    currentMemoryDigest: memoryDigestFor(currentMemory || {}),
    proposedMemoryDigest: memoryDigestFor(proposedMemory || {}),
    sourceRefs,
    proposalState,
  }));
  const proposal = {
    schema: DIRECT_THREAD_MEMORY_REFRESH_PROPOSAL_SCHEMA,
    memoryRefreshProposalId: normalizeString(input.memoryRefreshProposalId, `memory_refresh_proposal_${sourceDigest.slice(0, 24)}`),
    projectId: normalizeString(input.projectId, reviewPacket?.projectId || proposedMemory?.projectId || currentMemory?.projectId || ""),
    threadId: normalizeString(input.threadId, reviewPacket?.threadId || proposedMemory?.threadId || currentMemory?.threadId || ""),
    workThreadId: normalizeString(input.workThreadId, reviewPacket?.workThreadId || ""),
    memoryReviewPacketId: normalizeString(reviewPacket?.memoryReviewPacketId, ""),
    currentMemoryId: normalizeString(currentMemory?.memoryId || reviewPacket?.currentMemoryId, ""),
    proposedMemoryId: normalizeString(proposedMemory?.memoryId, ""),
    proposalState,
    sourceRefs,
    acceptedByOperator: proposalState === "accepted",
    rejectedByOperator: proposalState === "rejected",
    currentMemoryRetained: true,
    materializedInThisPr: false,
    memoryMutationAllowedInThisPr: false,
    providerTransportUsed: false,
    providerMemoryClaimAccepted: false,
    rendererSafeSummary: normalizeString(
      input.rendererSafeSummary,
      proposalState === "accepted"
        ? "Memory refresh was accepted as a proposal, but no memory mutation is enabled in this PR."
        : proposalState === "rejected" ? "Memory refresh proposal was rejected."
          : proposalState === "blocked" ? "Memory refresh is blocked until a concrete proposal and review evidence exist."
            : "Memory refresh proposal is available for review.",
    ),
    rawTextIncluded: false,
    createdAt: normalizeString(input.createdAt, nowIso(input.nowMs)),
  };
  proposal.integrity = makeIntegrity(sourceDigest);
  proposal.integrity.artifactDigest = artifactDigest({ ...proposal, integrity: { ...proposal.integrity, artifactDigest: "" } });
  return proposal;
}

function buildThreadMemoryResetPolicy(input = {}) {
  const enabled = input.enabled === true;
  const sourceRefs = normalizeMemoryWorkflowRefs(input.sourceRefs, "memory_reset_policy_source");
  const policyState = MEMORY_RESET_POLICY_STATES.has(input.policyState)
    ? input.policyState
    : enabled ? "available_with_confirmation" : "disabled";
  const sourceDigest = sha256(stableStringify({
    projectId: input.projectId,
    threadId: input.threadId,
    policyState,
    sourceRefs,
  }));
  const policy = {
    schema: DIRECT_THREAD_MEMORY_RESET_POLICY_SCHEMA,
    memoryResetPolicyId: normalizeString(input.memoryResetPolicyId, `memory_reset_policy_${sourceDigest.slice(0, 24)}`),
    projectId: normalizeString(input.projectId, ""),
    threadId: normalizeString(input.threadId, ""),
    workThreadId: normalizeString(input.workThreadId, ""),
    policyState,
    confirmationRequired: policyState === "available_with_confirmation",
    resetWorkflowVisible: policyState !== "disabled",
    resetAllowedInThisPr: false,
    memoryMutationAllowedInThisPr: false,
    sourceRefs,
    rendererSafeSummary: normalizeString(
      input.rendererSafeSummary,
      policyState !== "disabled" ? "Memory reset is visible as a confirmable workflow, but reset execution is disabled in this PR." : "Memory reset is disabled.",
    ),
    rawTextIncluded: false,
    createdAt: normalizeString(input.createdAt, nowIso(input.nowMs)),
  };
  policy.integrity = makeIntegrity(sourceDigest);
  policy.integrity.artifactDigest = artifactDigest({ ...policy, integrity: { ...policy.integrity, artifactDigest: "" } });
  return policy;
}

function buildThreadMemoryResetConfirmation(input = {}) {
  const resetPolicy = isPlainObject(input.resetPolicy) ? input.resetPolicy : null;
  const requestedState = normalizeString(input.confirmationState, input.confirmedByOperator === true ? "confirmed_noop" : "not_requested");
  const normalizedRequestedState = MEMORY_RESET_CONFIRMATION_STATES.has(requestedState) ? requestedState : "not_requested";
  const resetPolicyConfirmable = resetPolicy?.policyState === "available_with_confirmation";
  const confirmationRequested = normalizedRequestedState === "confirmed_noop" || input.confirmedByOperator === true;
  let confirmationState = normalizedRequestedState;
  if (confirmationRequested && !resetPolicyConfirmable) {
    confirmationState = "blocked";
  }
  const sourceDigest = sha256(stableStringify({
    resetPolicyDigest: resetPolicy?.integrity?.artifactDigest || "",
    confirmationState,
    confirmedByOperator: confirmationState === "confirmed_noop",
  }));
  const confirmation = {
    schema: DIRECT_THREAD_MEMORY_RESET_CONFIRMATION_SCHEMA,
    memoryResetConfirmationId: normalizeString(input.memoryResetConfirmationId, `memory_reset_confirmation_${sourceDigest.slice(0, 24)}`),
    projectId: normalizeString(input.projectId, resetPolicy?.projectId || ""),
    threadId: normalizeString(input.threadId, resetPolicy?.threadId || ""),
    workThreadId: normalizeString(input.workThreadId, resetPolicy?.workThreadId || ""),
    memoryResetPolicyId: normalizeString(resetPolicy?.memoryResetPolicyId, ""),
    confirmationState,
    confirmedByOperator: confirmationState === "confirmed_noop",
    resetExecuted: false,
    resetAllowedInThisPr: false,
    memoryMutationAllowedInThisPr: false,
    currentMemoryRetained: true,
    rendererSafeSummary: normalizeString(
      input.rendererSafeSummary,
      confirmationState === "confirmed_noop"
        ? "Memory reset confirmation was recorded as a no-op; memory reset execution is disabled in this PR."
        : "No memory reset confirmation has been executed.",
    ),
    rawTextIncluded: false,
    createdAt: normalizeString(input.createdAt, nowIso(input.nowMs)),
  };
  confirmation.integrity = makeIntegrity(sourceDigest);
  confirmation.integrity.artifactDigest = artifactDigest({ ...confirmation, integrity: { ...confirmation.integrity, artifactDigest: "" } });
  return confirmation;
}

function buildFrontierBaton(input = {}) {
  const frontier = isPlainObject(input.frontier) ? input.frontier : {};
  const baton = {
    schema: DIRECT_FRONTIER_BATON_SCHEMA,
    batonId: normalizeString(input.batonId, `frontier_baton_${sha256(`${input.projectId}:${input.threadId}:${stableStringify(frontier)}`).slice(0, 24)}`),
    projectId: normalizeString(input.projectId, ""),
    threadId: normalizeString(input.threadId, ""),
    batonRequirement: normalizeString(input.batonRequirement, "optional"),
    batonState: normalizeString(input.batonState, "present"),
    sourceDigest: normalizeString(input.sourceDigest, sha256(stableStringify(frontier))),
    supersedesBatonId: normalizeString(input.supersedesBatonId, ""),
    supersededByBatonId: normalizeString(input.supersededByBatonId, ""),
    validUntil: normalizeString(input.validUntil, "next_user_turn"),
    frontier: {
      currentUserGoalDigest: normalizeString(frontier.currentUserGoalDigest, ""),
      rendererSafeGoalSummary: normalizeString(frontier.rendererSafeGoalSummary, ""),
      lastKnownAssistantState: normalizeString(frontier.lastKnownAssistantState, ""),
      nextExpectedAction: normalizeString(frontier.nextExpectedAction, "unknown"),
      openObligationRefs: Array.isArray(frontier.openObligationRefs) ? frontier.openObligationRefs : [],
      unresolvedRiskRefs: Array.isArray(frontier.unresolvedRiskRefs) ? frontier.unresolvedRiskRefs : [],
      workspaceEffectRefs: Array.isArray(frontier.workspaceEffectRefs) ? frontier.workspaceEffectRefs : [],
      recoveryStateRef: isPlainObject(frontier.recoveryStateRef) ? frontier.recoveryStateRef : null,
    },
    replayAuthority: false,
    approvalAuthority: false,
    continuationAuthority: false,
    rawTextIncluded: false,
    createdAt: normalizeString(input.createdAt, nowIso(input.nowMs)),
  };
  baton.integrity = makeIntegrity(baton.sourceDigest, input.previousBatonDigest);
  baton.integrity.artifactDigest = artifactDigest({ ...baton, integrity: { ...baton.integrity, artifactDigest: "" } });
  return baton;
}

function maintenanceRefsFromArtifacts(input = {}) {
  const refs = {
    schema: "direct_context_maintenance_refs@1",
    pressureEstimateId: normalizeString(input.pressureEstimate?.pressureEstimateId, ""),
    pressureEstimateDigest: normalizeString(input.pressureEstimate?.integrity?.artifactDigest, ""),
    routeId: normalizeString(input.route?.routeId, ""),
    routeDigest: normalizeString(input.route?.integrity?.artifactDigest || input.route?.routeDigest, ""),
    maintenanceManifestId: normalizeString(input.maintenanceManifest?.maintenanceManifestId, ""),
    maintenanceManifestDigest: normalizeString(input.maintenanceManifest?.integrity?.artifactDigest, ""),
    trimPlanId: normalizeString(input.trimPlan?.trimPlanId, ""),
    trimPlanDigest: normalizeString(input.trimPlan?.integrity?.artifactDigest || input.trimPlan?.planDigest, ""),
    omissionLedgerId: normalizeString(input.omissionLedger?.omissionLedgerId, ""),
    omissionLedgerDigest: normalizeString(input.omissionLedger?.integrity?.artifactDigest, ""),
    compactionPlanId: normalizeString(input.localCompactionPlan?.compactionPlanId || input.compactionPlan?.compactionPlanId, ""),
    compactionPlanDigest: normalizeString(input.localCompactionPlan?.integrity?.artifactDigest || input.compactionPlan?.integrity?.artifactDigest, ""),
    compactionGateId: normalizeString(input.compactionWorkflowGate?.compactionGateId || input.compactionGate?.compactionGateId, ""),
    compactionGateDigest: normalizeString(input.compactionWorkflowGate?.integrity?.artifactDigest || input.compactionGate?.integrity?.artifactDigest, ""),
    memoryId: normalizeString(input.memory?.memoryId, ""),
    memoryDigest: normalizeString(input.memory?.integrity?.artifactDigest || input.memory?.memoryDigest, ""),
    memoryRefreshId: normalizeString(input.memoryRefresh?.memoryRefreshId, ""),
    memoryRefreshDigest: normalizeString(input.memoryRefresh?.integrity?.artifactDigest, ""),
    batonId: normalizeString(input.baton?.batonId, ""),
    batonDigest: normalizeString(input.baton?.integrity?.artifactDigest, ""),
    requiredOmissionLedger: input.requiredOmissionLedger === true,
    requiredMemory: input.requiredMemory === true,
    requiredBaton: input.requiredBaton === true,
    providerCompactionUsed: false,
  };
  refs.refsDigest = sha256(stableStringify(refs));
  return refs;
}

function validateMaintenanceRefs(refs = {}, requirements = {}) {
  if (requirements.requireOmissionLedger === true || refs.requiredOmissionLedger === true) {
    if (!refs.omissionLedgerId || !refs.omissionLedgerDigest) {
      const error = new Error("required_omission_ledger_missing");
      error.code = "required_omission_ledger_missing";
      throw error;
    }
  }
  if (requirements.requireMemory === true || refs.requiredMemory === true) {
    if (!refs.memoryId || !refs.memoryDigest) {
      const error = new Error("required_memory_ref_missing");
      error.code = "required_memory_ref_missing";
      throw error;
    }
  }
  if (requirements.requireBaton === true || refs.requiredBaton === true) {
    if (!refs.batonId || !refs.batonDigest) {
      const error = new Error("required_baton_ref_missing");
      error.code = "required_baton_ref_missing";
      throw error;
    }
  }
  return true;
}

function buildStatusProjection(input = {}) {
  const projection = {
    schema: DIRECT_CONTEXT_MAINTENANCE_STATUS_PROJECTION_SCHEMA,
    projectId: normalizeString(input.projectId, ""),
    threadId: normalizeString(input.threadId, ""),
    uiProjectionGeneration: Number(input.uiProjectionGeneration || 1),
    sourceDigest: normalizeString(input.sourceDigest, sha256(stableStringify({
      routeId: input.currentRouteId,
      manifestId: input.currentManifestId,
      memoryId: input.currentMemoryId,
      batonId: input.currentBatonId,
      omissionLedgerId: input.currentOmissionLedgerId,
    }))),
    operationLedgerHeadDigest: normalizeString(input.operationLedgerHeadDigest, ""),
    currentRouteId: normalizeString(input.currentRouteId, ""),
    currentManifestId: normalizeString(input.currentManifestId, ""),
    currentMemoryId: normalizeString(input.currentMemoryId, ""),
    currentBatonId: normalizeString(input.currentBatonId, ""),
    currentOmissionLedgerId: normalizeString(input.currentOmissionLedgerId, ""),
    pressureState: normalizeString(input.pressureState, "unknown"),
    memoryState: normalizeString(input.memoryState, "none"),
    batonState: normalizeString(input.batonState, "not_required"),
    omissionState: normalizeString(input.omissionState, "none"),
    composerAllowed: input.composerAllowed === true,
    composerAllowedReason: normalizeString(input.composerAllowedReason, input.composerAllowed === true ? "safe_terminal" : "disabled_context_maintenance_required"),
    displayOnly: true,
    rawTextIncluded: false,
  };
  projection.projectionDigest = sha256(stableStringify(projection));
  return projection;
}

function contextLossTotalsFrom(input = {}) {
  const entries = Array.isArray(input.omissionLedger?.entries)
    ? input.omissionLedger.entries
    : (Array.isArray(input.trimPlan?.candidateOmissions) ? input.trimPlan.candidateOmissions : []);
  const ledgerTotals = input.omissionLedger?.totals;
  if (isPlainObject(ledgerTotals)) {
    return {
      omittedItemCount: Number(ledgerTotals.omittedItemCount || 0),
      omittedTurnCount: Number(ledgerTotals.omittedTurnCount || 0),
      omittedCharCount: Number(ledgerTotals.omittedCharCount || 0),
      omittedTokenEstimate: Number(ledgerTotals.omittedTokenEstimate || 0),
    };
  }
  return entries.reduce((acc, entry) => ({
    omittedItemCount: acc.omittedItemCount + Number(entry.omittedItemCount || 0),
    omittedTurnCount: acc.omittedTurnCount + Number(entry.omittedTurnCount || 0),
    omittedCharCount: acc.omittedCharCount + Number(entry.omittedCharCount || 0),
    omittedTokenEstimate: acc.omittedTokenEstimate + Number(entry.omittedTokenEstimate || 0),
  }), { omittedItemCount: 0, omittedTurnCount: 0, omittedCharCount: 0, omittedTokenEstimate: 0 });
}

function buildContextLossWitness(input = {}) {
  const route = isPlainObject(input.route) ? input.route : null;
  const trimPlan = isPlainObject(input.trimPlan) ? input.trimPlan : null;
  const omissionLedger = isPlainObject(input.omissionLedger) ? input.omissionLedger : null;
  const pressureEstimate = isPlainObject(input.pressureEstimate) ? input.pressureEstimate : null;
  const totals = contextLossTotalsFrom({ omissionLedger, trimPlan });
  let lossState = normalizeString(input.lossState, "");
  if (!lossState) {
    if (route?.blocked === true && route.reasonCode === "context_budget_required_artifact_at_risk") {
      lossState = "blocked_required_context";
    } else if (totals.omittedItemCount > 0 && omissionLedger) {
      lossState = "represented";
    } else if (totals.omittedItemCount > 0 && !omissionLedger) {
      lossState = "unrepresented_blocked";
    } else {
      lossState = "none";
    }
  }
  const entries = Array.isArray(omissionLedger?.entries)
    ? omissionLedger.entries
    : (Array.isArray(trimPlan?.candidateOmissions) ? trimPlan.candidateOmissions : []);
  const sourceDigest = sha256(stableStringify({
    routeDigest: route?.integrity?.artifactDigest || route?.routeDigest || "",
    trimPlanDigest: trimPlan?.integrity?.artifactDigest || trimPlan?.planDigest || "",
    omissionLedgerDigest: omissionLedger?.integrity?.artifactDigest || "",
    totals,
    lossState,
  }));
  const projectId = normalizeString(input.projectId, route?.projectId || trimPlan?.projectId || omissionLedger?.projectId || pressureEstimate?.projectId || "");
  const threadId = normalizeString(input.threadId, route?.threadId || trimPlan?.threadId || omissionLedger?.threadId || pressureEstimate?.threadId || "");
  const witness = {
    schema: DIRECT_CONTEXT_LOSS_WITNESS_SCHEMA,
    contextLossWitnessId: normalizeString(input.contextLossWitnessId, `context_loss_${sha256(`${projectId}:${threadId}:${sourceDigest}`).slice(0, 24)}`),
    projectId,
    threadId,
    routeId: normalizeString(route?.routeId, trimPlan?.routeId || omissionLedger?.routeId || ""),
    trimPlanId: normalizeString(trimPlan?.trimPlanId, omissionLedger?.trimPlanId || ""),
    omissionLedgerId: normalizeString(omissionLedger?.omissionLedgerId, ""),
    pressureEstimateId: normalizeString(pressureEstimate?.pressureEstimateId, ""),
    lossState,
    totals,
    omittedSources: entries.map((entry, index) => ({
      witnessEntryId: normalizeString(entry.omissionId || entry.omissionCandidateId, `context_loss_entry_${index + 1}`),
      sourceArtifactKind: normalizeString(entry.sourceArtifactKind, "context_recent_dialogue"),
      sourceArtifactId: normalizeString(entry.sourceArtifactId, ""),
      sourceDigest: normalizeString(entry.sourceDigest, trimPlan?.sourceContextProjectionDigest || ""),
      sourceStableKeys: Array.isArray(entry.sourceStableKeys) ? entry.sourceStableKeys.map((key) => normalizeString(key, "")).filter(Boolean) : [],
      omittedItemCount: Number(entry.omittedItemCount || 0),
      omittedTurnCount: Number(entry.omittedTurnCount || 0),
      omittedTokenEstimate: Number(entry.omittedTokenEstimate || 0),
      reason: normalizeString(entry.reason, "context_maintenance"),
      rendererSafeSummary: normalizeString(entry.rendererSafeSummary, "Context was omitted with a visible witness."),
      rawTextIncluded: false,
    })),
    contextLossVisible: lossState !== "none",
    hiddenContextLossAllowed: false,
    providerCompactionOutputOpaque: input.providerCompactionOutputOpaque !== false,
    rawTextIncluded: false,
    createdAt: normalizeString(input.createdAt, nowIso(input.nowMs)),
  };
  witness.integrity = makeIntegrity(sourceDigest);
  witness.integrity.artifactDigest = artifactDigest({ ...witness, integrity: { ...witness.integrity, artifactDigest: "" } });
  return witness;
}

function normalizeCompactionSourceSpans(values, contextLossWitness = null) {
  const sourceValues = Array.isArray(values) && values.length
    ? values
    : (Array.isArray(contextLossWitness?.omittedSources) ? contextLossWitness.omittedSources : []);
  return sourceValues.map((span, index) => {
    const item = isPlainObject(span) ? span : {};
    const sourceStableKeys = Array.isArray(item.sourceStableKeys) ? item.sourceStableKeys.map((key) => normalizeString(key, "")).filter(Boolean) : [];
    return {
      sourceSpanId: normalizeString(item.sourceSpanId || item.witnessEntryId, `compaction_source_span_${index + 1}`),
      sourceArtifactKind: normalizeString(item.sourceArtifactKind, "context_recent_dialogue"),
      sourceArtifactId: normalizeString(item.sourceArtifactId, ""),
      sourceDigest: normalizeString(item.sourceDigest, ""),
      sourceStableKeys,
      startKey: normalizeString(item.startKey || sourceStableKeys[0], ""),
      endKey: normalizeString(item.endKey || sourceStableKeys[sourceStableKeys.length - 1], ""),
      itemCount: Number(item.itemCount || item.omittedItemCount || 0),
      turnCount: Number(item.turnCount || item.omittedTurnCount || 0),
      tokenEstimate: Number(item.tokenEstimate || item.omittedTokenEstimate || 0),
      rendererSafeSummary: normalizeString(item.rendererSafeSummary, "Source span is represented for local compaction planning."),
      rawTextIncluded: false,
    };
  });
}

function normalizeCompactionResidualRisks(values) {
  return (Array.isArray(values) ? values : []).map((risk, index) => {
    const item = isPlainObject(risk) ? risk : {};
    return {
      residualRiskId: normalizeString(item.residualRiskId, `compaction_residual_risk_${index + 1}`),
      riskKind: normalizeString(item.riskKind, "summary_loss"),
      severity: normalizeString(item.severity, "medium"),
      sourceSpanId: normalizeString(item.sourceSpanId, ""),
      mitigationState: normalizeString(item.mitigationState, "visible_for_operator_review"),
      rendererSafeSummary: normalizeString(item.rendererSafeSummary, "Compaction may omit nuance; source span witness remains available."),
      rawTextIncluded: false,
    };
  });
}

function compactionPlanStateFor({ contextLossWitness, sourceSpans } = {}) {
  if (!contextLossWitness || contextLossWitness.schema !== DIRECT_CONTEXT_LOSS_WITNESS_SCHEMA) {
    return "blocked_missing_context_loss_witness";
  }
  if (contextLossWitness.lossState === "unrepresented_blocked") return "blocked_unrepresented_omission";
  if (contextLossWitness.lossState === "blocked_required_context") return "blocked_required_context";
  const spans = Array.isArray(sourceSpans) ? sourceSpans : [];
  if (contextLossWitness.lossState !== "none" && spans.length === 0) return "blocked_no_source_spans";
  return "preview_ready";
}

function buildLocalCompactionPlan(input = {}) {
  const contextLossWitness = isPlainObject(input.contextLossWitness) ? input.contextLossWitness : null;
  const sourceSpans = normalizeCompactionSourceSpans(input.sourceSpanWitnesses || input.sourceSpans, contextLossWitness);
  const residualRiskWitnesses = normalizeCompactionResidualRisks(input.residualRiskWitnesses || input.residualRisks);
  const requestedState = normalizeString(input.planState || input.status, "");
  const derivedState = compactionPlanStateFor({ contextLossWitness, sourceSpans });
  const planState = COMPACTION_PLAN_STATES.has(requestedState) && requestedState.startsWith("blocked")
    ? requestedState
    : derivedState;
  const sourceDigest = sha256(stableStringify({
    contextLossWitnessDigest: contextLossWitness?.integrity?.artifactDigest || "",
    sourceSpans,
    residualRiskWitnesses,
    planState,
  }));
  const plan = {
    schema: DIRECT_CONTEXT_COMPACTION_PLAN_SCHEMA,
    compactionPlanId: normalizeString(input.compactionPlanId, `context_compaction_plan_${sourceDigest.slice(0, 24)}`),
    projectId: normalizeString(input.projectId, contextLossWitness?.projectId || ""),
    threadId: normalizeString(input.threadId, contextLossWitness?.threadId || ""),
    workThreadId: normalizeString(input.workThreadId, ""),
    contextLossWitnessId: normalizeString(contextLossWitness?.contextLossWitnessId, ""),
    contextLossWitnessDigest: normalizeString(contextLossWitness?.integrity?.artifactDigest, ""),
    omissionLedgerId: normalizeString(contextLossWitness?.omissionLedgerId, ""),
    routeId: normalizeString(contextLossWitness?.routeId, ""),
    planState,
    sourceSpanWitnesses: sourceSpans,
    residualRiskWitnesses,
    sourceSpanCount: sourceSpans.length,
    residualRiskCount: residualRiskWitnesses.length,
    compactedContextEligible: planState === "preview_ready" && contextLossWitness?.hiddenContextLossAllowed === false,
    previewOnly: true,
    localCompactionOnly: true,
    materializedInThisPr: false,
    contextMutationAllowedInThisPr: false,
    providerCompactionUsed: false,
    providerCompactionOutputAcceptedAsTruth: false,
    hiddenOmissionAllowed: false,
    rendererSafeSummary: normalizeString(
      input.rendererSafeSummary,
      planState === "preview_ready"
        ? "Local compaction preview is eligible because source spans and omission witnesses are visible."
        : "Local compaction preview is blocked until omission evidence is complete.",
    ),
    rawTextIncluded: false,
    createdAt: normalizeString(input.createdAt, nowIso(input.nowMs)),
  };
  plan.integrity = makeIntegrity(sourceDigest);
  plan.integrity.artifactDigest = artifactDigest({ ...plan, integrity: { ...plan.integrity, artifactDigest: "" } });
  return plan;
}

function providerCompactionGateFor(input = {}) {
  const route = isPlainObject(input.route) ? input.route : null;
  const routeFlags = isPlainObject(route?.routeInput?.flags) ? route.routeInput.flags : {};
  const requested = input.providerCompactionRequested === true ||
    routeFlags.providerCompactionRequested === true ||
    ["remote_compaction", "hybrid_compaction"].includes(normalizeString(route?.routeKind, ""));
  const evidenceAvailable = input.providerCompactionEvidenceAvailable === true ||
    routeFlags.providerCompactionEvidenceAvailable === true;
  const siblingEvidenceObserved = input.vanillaSiblingEvidenceObserved === true || isPlainObject(input.vanillaSiblingEvidence);
  if (!requested && !siblingEvidenceObserved) {
    return {
      state: "not_requested",
      providerCompactionAllowed: false,
      providerTransportAllowed: false,
      evidenceRefs: [],
    };
  }
  if (requested && evidenceAvailable !== true) {
    return {
      state: "blocked_missing_evidence",
      providerCompactionAllowed: false,
      providerTransportAllowed: false,
      evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs : [],
    };
  }
  if (siblingEvidenceObserved && evidenceAvailable !== true) {
    return {
      state: "sibling_evidence_display_only",
      providerCompactionAllowed: false,
      providerTransportAllowed: false,
      evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs : [],
    };
  }
  return {
    state: "evidence_available_not_enabled",
    providerCompactionAllowed: false,
    providerTransportAllowed: false,
    evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs : [],
  };
}

function buildCompactionWorkflowGate(input = {}) {
  const localCompactionPlan = isPlainObject(input.localCompactionPlan || input.compactionPlan) ? (input.localCompactionPlan || input.compactionPlan) : null;
  const contextLossWitness = isPlainObject(input.contextLossWitness) ? input.contextLossWitness : null;
  const providerCompactionGate = isPlainObject(input.providerCompactionGate)
    ? input.providerCompactionGate
    : providerCompactionGateFor(input);
  const manualCompactRequested = input.manualCompactRequested === true || input.compactRequested === true || Boolean(localCompactionPlan);
  const planState = normalizeString(localCompactionPlan?.planState, "blocked_missing_context_loss_witness");
  let manualCompactGateState = "not_requested";
  if (manualCompactRequested) {
    if (!localCompactionPlan) manualCompactGateState = "blocked_missing_context_loss_witness";
    else if (planState === "preview_ready") manualCompactGateState = "manual_ready";
    else if (COMPACTION_GATE_STATES.has(planState)) manualCompactGateState = planState;
    else manualCompactGateState = "blocked_plan";
  }
  const sourceDigest = sha256(stableStringify({
    planDigest: localCompactionPlan?.integrity?.artifactDigest || "",
    contextLossDigest: contextLossWitness?.integrity?.artifactDigest || localCompactionPlan?.contextLossWitnessDigest || "",
    providerCompactionGate,
    manualCompactGateState,
  }));
  const gate = {
    schema: DIRECT_CONTEXT_COMPACTION_GATE_SCHEMA,
    compactionGateId: normalizeString(input.compactionGateId, `context_compaction_gate_${sourceDigest.slice(0, 24)}`),
    projectId: normalizeString(input.projectId, localCompactionPlan?.projectId || contextLossWitness?.projectId || ""),
    threadId: normalizeString(input.threadId, localCompactionPlan?.threadId || contextLossWitness?.threadId || ""),
    workThreadId: normalizeString(input.workThreadId, localCompactionPlan?.workThreadId || ""),
    compactionPlanId: normalizeString(localCompactionPlan?.compactionPlanId, ""),
    compactionPlanDigest: normalizeString(localCompactionPlan?.integrity?.artifactDigest, ""),
    contextLossWitnessId: normalizeString(contextLossWitness?.contextLossWitnessId || localCompactionPlan?.contextLossWitnessId, ""),
    contextLossWitnessDigest: normalizeString(contextLossWitness?.integrity?.artifactDigest || localCompactionPlan?.contextLossWitnessDigest, ""),
    manualCompactGateState,
    localCompactionPlanState: planState,
    sourceSpanCount: Number(localCompactionPlan?.sourceSpanCount || 0),
    residualRiskCount: Number(localCompactionPlan?.residualRiskCount || 0),
    compactedContextEligible: localCompactionPlan?.compactedContextEligible === true,
    providerCompactionGate,
    manualCompactActionAllowed: false,
    automaticSchedulerAllowed: false,
    providerCompactionAllowed: false,
    providerTransportAllowed: false,
    hiddenOmissionAllowed: false,
    rawTextIncluded: false,
    rendererSafeSummary: normalizeString(
      input.rendererSafeSummary,
      manualCompactGateState === "manual_ready"
        ? "Manual compact gate is evidence-complete, but execution remains disabled in this PR."
        : "Manual compact gate is blocked or not requested.",
    ),
    createdAt: normalizeString(input.createdAt, nowIso(input.nowMs)),
  };
  gate.integrity = makeIntegrity(sourceDigest);
  gate.integrity.artifactDigest = artifactDigest({ ...gate, integrity: { ...gate.integrity, artifactDigest: "" } });
  return gate;
}

function buildContextContinuityTransition(input = {}) {
  const route = isPlainObject(input.route) ? input.route : null;
  const maintenanceManifest = isPlainObject(input.maintenanceManifest) ? input.maintenanceManifest : null;
  const memory = isPlainObject(input.memory) ? input.memory : null;
  const memoryRefresh = isPlainObject(input.memoryRefresh) ? input.memoryRefresh : null;
  const baton = isPlainObject(input.baton) ? input.baton : null;
  const omissionLedger = isPlainObject(input.omissionLedger) ? input.omissionLedger : null;
  const contextLossWitness = isPlainObject(input.contextLossWitness)
    ? input.contextLossWitness
    : buildContextLossWitness(input);
  const providerCompactionGate = providerCompactionGateFor(input);
  const transitionKind = normalizeString(
    input.transitionKind,
    memoryRefresh ? "memory_refresh"
      : baton ? "frontier_baton"
        : omissionLedger ? "context_omission"
          : providerCompactionGate.state === "not_requested" ? "status_only" : "provider_compaction_gate",
  );
  const status = normalizeString(input.status, route?.blocked ? "blocked" : "completed");
  const sourceDigest = sha256(stableStringify({
    routeDigest: route?.integrity?.artifactDigest || route?.routeDigest || "",
    manifestDigest: maintenanceManifest?.integrity?.artifactDigest || "",
    memoryDigest: memory?.integrity?.artifactDigest || memory?.memoryDigest || "",
    memoryRefreshDigest: memoryRefresh?.integrity?.artifactDigest || "",
    batonDigest: baton?.integrity?.artifactDigest || "",
    omissionLedgerDigest: omissionLedger?.integrity?.artifactDigest || "",
    contextLossDigest: contextLossWitness?.integrity?.artifactDigest || "",
    providerCompactionGate,
    transitionKind,
    status,
  }));
  const projectId = normalizeString(input.projectId, route?.projectId || maintenanceManifest?.projectId || memory?.projectId || baton?.projectId || "");
  const threadId = normalizeString(input.threadId, route?.threadId || maintenanceManifest?.threadId || memory?.threadId || baton?.threadId || "");
  const transition = {
    schema: DIRECT_CONTEXT_CONTINUITY_TRANSITION_SCHEMA,
    transitionId: normalizeString(input.transitionId, `context_continuity_${sha256(`${projectId}:${threadId}:${sourceDigest}`).slice(0, 24)}`),
    projectId,
    threadId,
    workThreadId: normalizeString(input.workThreadId, ""),
    transitionKind,
    status,
    routeId: normalizeString(route?.routeId, ""),
    maintenanceManifestId: normalizeString(maintenanceManifest?.maintenanceManifestId, ""),
    contextLossWitnessId: normalizeString(contextLossWitness?.contextLossWitnessId, ""),
    contextLossWitnessDigest: normalizeString(contextLossWitness?.integrity?.artifactDigest, ""),
    memoryId: normalizeString(memory?.memoryId, ""),
    memoryRefreshId: normalizeString(memoryRefresh?.memoryRefreshId, ""),
    batonId: normalizeString(baton?.batonId, ""),
    omissionLedgerId: normalizeString(omissionLedger?.omissionLedgerId, ""),
    productizedForOperator: true,
    userVisibleTransition: true,
    memoryEditableInThisPr: false,
    memoryResetAllowedInThisPr: false,
    providerCompactionGate,
    providerTransportUsed: false,
    providerCompactionAllowedInThisPr: false,
    replayAuthority: false,
    approvalAuthority: false,
    continuationAuthority: false,
    hiddenContextLossAllowed: false,
    rawTextIncluded: false,
    createdAt: normalizeString(input.createdAt, nowIso(input.nowMs)),
  };
  transition.integrity = makeIntegrity(sourceDigest);
  transition.integrity.artifactDigest = artifactDigest({ ...transition, integrity: { ...transition.integrity, artifactDigest: "" } });
  return transition;
}

function buildContextContinuityStatusProjection(input = {}) {
  const transition = isPlainObject(input.transition) ? input.transition : null;
  const contextLossWitness = isPlainObject(input.contextLossWitness) ? input.contextLossWitness : null;
  const localCompactionPlan = isPlainObject(input.localCompactionPlan || input.compactionPlan) ? (input.localCompactionPlan || input.compactionPlan) : null;
  const compactionWorkflowGate = isPlainObject(input.compactionWorkflowGate || input.compactionGate) ? (input.compactionWorkflowGate || input.compactionGate) : null;
  const memoryReviewPacket = isPlainObject(input.memoryReviewPacket) ? input.memoryReviewPacket : null;
  const memoryRefreshProposal = isPlainObject(input.memoryRefreshProposal) ? input.memoryRefreshProposal : null;
  const memoryResetPolicy = isPlainObject(input.memoryResetPolicy) ? input.memoryResetPolicy : null;
  const memoryResetConfirmation = isPlainObject(input.memoryResetConfirmation) ? input.memoryResetConfirmation : null;
  const sourceDigest = sha256(stableStringify({
    transitionDigest: transition?.integrity?.artifactDigest || "",
    contextLossDigest: contextLossWitness?.integrity?.artifactDigest || transition?.contextLossWitnessDigest || "",
    localCompactionPlanDigest: localCompactionPlan?.integrity?.artifactDigest || "",
    compactionGateDigest: compactionWorkflowGate?.integrity?.artifactDigest || "",
    memoryReviewDigest: memoryReviewPacket?.integrity?.artifactDigest || "",
    memoryRefreshProposalDigest: memoryRefreshProposal?.integrity?.artifactDigest || "",
    memoryResetPolicyDigest: memoryResetPolicy?.integrity?.artifactDigest || "",
    memoryResetConfirmationDigest: memoryResetConfirmation?.integrity?.artifactDigest || "",
  }));
  const projection = {
    schema: DIRECT_CONTEXT_CONTINUITY_STATUS_PROJECTION_SCHEMA,
    projectId: normalizeString(input.projectId, transition?.projectId || contextLossWitness?.projectId || ""),
    threadId: normalizeString(input.threadId, transition?.threadId || contextLossWitness?.threadId || ""),
    workThreadId: normalizeString(input.workThreadId, transition?.workThreadId || ""),
    uiProjectionGeneration: Number(input.uiProjectionGeneration || 1),
    sourceDigest,
    transitionId: normalizeString(transition?.transitionId, ""),
    transitionKind: normalizeString(transition?.transitionKind, "unknown"),
    transitionStatus: normalizeString(transition?.status, "unknown"),
    contextLossState: normalizeString(contextLossWitness?.lossState, "unknown"),
    omittedItemCount: Number(contextLossWitness?.totals?.omittedItemCount || 0),
    omittedTokenEstimate: Number(contextLossWitness?.totals?.omittedTokenEstimate || 0),
    localCompactionPlanState: normalizeString(localCompactionPlan?.planState, "not_built"),
    manualCompactGateState: normalizeString(compactionWorkflowGate?.manualCompactGateState, "not_requested"),
    compactionSourceSpanCount: Number(localCompactionPlan?.sourceSpanCount || compactionWorkflowGate?.sourceSpanCount || 0),
    compactionResidualRiskCount: Number(localCompactionPlan?.residualRiskCount || compactionWorkflowGate?.residualRiskCount || 0),
    compactedContextEligible: localCompactionPlan?.compactedContextEligible === true || compactionWorkflowGate?.compactedContextEligible === true,
    memoryState: transition?.memoryId ? "present" : "none",
    memoryReviewState: normalizeString(memoryReviewPacket?.reviewState, "not_built"),
    memoryRefreshProposalState: normalizeString(memoryRefreshProposal?.proposalState, "not_built"),
    memoryResetPolicyState: normalizeString(memoryResetPolicy?.policyState, "disabled"),
    memoryResetConfirmationState: normalizeString(memoryResetConfirmation?.confirmationState, "not_requested"),
    staleMemoryEntryCount: Number(memoryReviewPacket?.staleEntryCount || 0),
    conflictedMemoryEntryCount: Number(memoryReviewPacket?.conflictEntryCount || 0),
    batonState: transition?.batonId ? "present" : "none",
    omissionState: transition?.omissionLedgerId ? "represented" : "none",
    providerCompactionState: normalizeString(transition?.providerCompactionGate?.state, "not_requested"),
    displayOnly: true,
    inspectAllowed: true,
    compactActionAllowed: false,
    manualCompactActionAllowed: false,
    memoryEditorAllowed: false,
    memoryResetAllowed: false,
    memoryRefreshMaterializationAllowed: false,
    providerTransportAllowed: false,
    hiddenContextLossAllowed: false,
    rendererSafeSummary: normalizeString(
      input.rendererSafeSummary,
      "Memory, baton, omission, and compaction state are visible as governed continuity evidence.",
    ),
    rawTextIncluded: false,
  };
  projection.projectionDigest = sha256(stableStringify(projection));
  return projection;
}

function validateContextContinuityProductization(input = {}) {
  const transition = isPlainObject(input.transition) ? input.transition : null;
  const projection = isPlainObject(input.projection) ? input.projection : null;
  const localCompactionPlan = isPlainObject(input.localCompactionPlan || input.compactionPlan) ? (input.localCompactionPlan || input.compactionPlan) : null;
  const compactionWorkflowGate = isPlainObject(input.compactionWorkflowGate || input.compactionGate) ? (input.compactionWorkflowGate || input.compactionGate) : null;
  if (!transition || transition.schema !== DIRECT_CONTEXT_CONTINUITY_TRANSITION_SCHEMA) {
    throw new Error("context_continuity_transition_schema_mismatch");
  }
  if (transition.providerTransportUsed !== false || transition.providerCompactionAllowedInThisPr !== false) {
    throw new Error("context_continuity_provider_authority_leak");
  }
  if (transition.memoryEditableInThisPr !== false || transition.memoryResetAllowedInThisPr !== false) {
    throw new Error("context_continuity_memory_authority_leak");
  }
  if (transition.hiddenContextLossAllowed !== false || transition.rawTextIncluded !== false) {
    throw new Error("context_continuity_visibility_or_raw_text_violation");
  }
  if (projection) {
    if (projection.schema !== DIRECT_CONTEXT_CONTINUITY_STATUS_PROJECTION_SCHEMA) {
      throw new Error("context_continuity_projection_schema_mismatch");
    }
    if (projection.displayOnly !== true || projection.providerTransportAllowed !== false || projection.compactActionAllowed !== false || projection.manualCompactActionAllowed !== false) {
      throw new Error("context_continuity_projection_authority_leak");
    }
    if (projection.memoryEditorAllowed !== false || projection.memoryResetAllowed !== false || projection.memoryRefreshMaterializationAllowed !== false) {
      throw new Error("context_continuity_projection_memory_authority_leak");
    }
  }
  if (localCompactionPlan) validateCompactionWorkflow({ localCompactionPlan });
  if (compactionWorkflowGate) validateCompactionWorkflow({ localCompactionPlan, compactionWorkflowGate });
  return true;
}

function validateCompactionWorkflow(input = {}) {
  const localCompactionPlan = isPlainObject(input.localCompactionPlan || input.compactionPlan) ? (input.localCompactionPlan || input.compactionPlan) : null;
  const compactionWorkflowGate = isPlainObject(input.compactionWorkflowGate || input.compactionGate) ? (input.compactionWorkflowGate || input.compactionGate) : null;
  if (localCompactionPlan) {
    if (localCompactionPlan.schema !== DIRECT_CONTEXT_COMPACTION_PLAN_SCHEMA) {
      throw new Error("context_compaction_plan_schema_mismatch");
    }
    if (localCompactionPlan.rawTextIncluded !== false || localCompactionPlan.hiddenOmissionAllowed !== false) {
      throw new Error("context_compaction_plan_visibility_leak");
    }
    if (localCompactionPlan.materializedInThisPr !== false || localCompactionPlan.contextMutationAllowedInThisPr !== false) {
      throw new Error("context_compaction_plan_mutation_authority_leak");
    }
    if (localCompactionPlan.providerCompactionUsed !== false || localCompactionPlan.providerCompactionOutputAcceptedAsTruth !== false) {
      throw new Error("context_compaction_plan_provider_authority_leak");
    }
    if (localCompactionPlan.compactedContextEligible === true && !normalizeString(localCompactionPlan.contextLossWitnessId, "")) {
      throw new Error("context_compaction_plan_eligible_without_context_loss_witness");
    }
    if (
      localCompactionPlan.planState === "preview_ready" &&
      (!Array.isArray(localCompactionPlan.sourceSpanWitnesses) ||
        localCompactionPlan.sourceSpanCount !== localCompactionPlan.sourceSpanWitnesses.length)
    ) {
      throw new Error("context_compaction_plan_source_span_count_mismatch");
    }
  }
  if (compactionWorkflowGate) {
    if (compactionWorkflowGate.schema !== DIRECT_CONTEXT_COMPACTION_GATE_SCHEMA) {
      throw new Error("context_compaction_gate_schema_mismatch");
    }
    if (compactionWorkflowGate.rawTextIncluded !== false || compactionWorkflowGate.hiddenOmissionAllowed !== false) {
      throw new Error("context_compaction_gate_visibility_leak");
    }
    if (compactionWorkflowGate.manualCompactActionAllowed !== false || compactionWorkflowGate.automaticSchedulerAllowed !== false) {
      throw new Error("context_compaction_gate_action_authority_leak");
    }
    if (compactionWorkflowGate.providerCompactionAllowed !== false || compactionWorkflowGate.providerTransportAllowed !== false) {
      throw new Error("context_compaction_gate_provider_authority_leak");
    }
    if (compactionWorkflowGate.manualCompactGateState === "manual_ready" && !normalizeString(compactionWorkflowGate.compactionPlanId, "")) {
      throw new Error("context_compaction_gate_ready_without_plan");
    }
    if (compactionWorkflowGate.manualCompactGateState === "manual_ready" && (!localCompactionPlan || localCompactionPlan.compactedContextEligible !== true)) {
      throw new Error("context_compaction_gate_ready_with_ineligible_plan");
    }
  }
  return true;
}

function validateThreadMemoryWorkflow(input = {}) {
  const reviewPacket = isPlainObject(input.reviewPacket) ? input.reviewPacket : null;
  const refreshProposal = isPlainObject(input.refreshProposal) ? input.refreshProposal : null;
  const resetPolicy = isPlainObject(input.resetPolicy) ? input.resetPolicy : null;
  const resetConfirmation = isPlainObject(input.resetConfirmation) ? input.resetConfirmation : null;
  if (reviewPacket && reviewPacket.schema !== DIRECT_THREAD_MEMORY_REVIEW_PACKET_SCHEMA) {
    throw new Error("thread_memory_review_packet_schema_mismatch");
  }
  if (refreshProposal && refreshProposal.schema !== DIRECT_THREAD_MEMORY_REFRESH_PROPOSAL_SCHEMA) {
    throw new Error("thread_memory_refresh_proposal_schema_mismatch");
  }
  if (resetPolicy && resetPolicy.schema !== DIRECT_THREAD_MEMORY_RESET_POLICY_SCHEMA) {
    throw new Error("thread_memory_reset_policy_schema_mismatch");
  }
  if (resetConfirmation && resetConfirmation.schema !== DIRECT_THREAD_MEMORY_RESET_CONFIRMATION_SCHEMA) {
    throw new Error("thread_memory_reset_confirmation_schema_mismatch");
  }
  for (const artifact of [reviewPacket, refreshProposal, resetPolicy, resetConfirmation].filter(Boolean)) {
    if (artifact.rawTextIncluded !== false) throw new Error("thread_memory_workflow_raw_text_leak");
  }
  if (reviewPacket && (reviewPacket.memoryAsPolicyAuthority !== false || reviewPacket.providerMemoryClaimAccepted !== false)) {
    throw new Error("thread_memory_review_authority_leak");
  }
  if (refreshProposal) {
    if (refreshProposal.materializedInThisPr !== false || refreshProposal.memoryMutationAllowedInThisPr !== false || refreshProposal.providerTransportUsed !== false) {
      throw new Error("thread_memory_refresh_authority_leak");
    }
    if (refreshProposal.proposalState === "accepted" && !normalizeString(refreshProposal.proposedMemoryId, "")) {
      throw new Error("thread_memory_refresh_accepted_without_proposal");
    }
    if (refreshProposal.proposalState === "accepted" && reviewPacket && (reviewPacket.reviewState === "blocked" || reviewPacket.reviewState === "missing")) {
      throw new Error("thread_memory_refresh_accepted_with_blocked_review");
    }
    if (refreshProposal.acceptedByOperator !== (refreshProposal.proposalState === "accepted")) {
      throw new Error("thread_memory_refresh_acceptance_state_mismatch");
    }
    if (refreshProposal.rejectedByOperator !== (refreshProposal.proposalState === "rejected")) {
      throw new Error("thread_memory_refresh_rejection_state_mismatch");
    }
  }
  if (resetPolicy) {
    if (resetPolicy.resetAllowedInThisPr !== false || resetPolicy.memoryMutationAllowedInThisPr !== false) {
      throw new Error("thread_memory_reset_policy_authority_leak");
    }
    if (resetPolicy.resetWorkflowVisible !== (resetPolicy.policyState !== "disabled")) {
      throw new Error("thread_memory_reset_policy_visibility_mismatch");
    }
  }
  if (resetConfirmation) {
    if (resetConfirmation.resetExecuted !== false || resetConfirmation.resetAllowedInThisPr !== false || resetConfirmation.currentMemoryRetained !== true) {
      throw new Error("thread_memory_reset_confirmation_authority_leak");
    }
    if (resetConfirmation.confirmedByOperator !== (resetConfirmation.confirmationState === "confirmed_noop")) {
      throw new Error("thread_memory_reset_confirmation_state_mismatch");
    }
    if (resetConfirmation.confirmationState === "confirmed_noop" && resetPolicy?.policyState !== "available_with_confirmation") {
      throw new Error("thread_memory_reset_confirmation_without_available_policy");
    }
  }
  return true;
}

function normalizeExecutionSourceRef(input = {}, fallbackKind = "context_maintenance_source") {
  const ref = normalizeMemoryWorkflowRef(input, fallbackKind);
  if (!ref) return null;
  return {
    ...ref,
    sourceState: normalizeString(ref.sourceState, "accepted"),
    retentionLaw: normalizeString(input.retentionLaw, "retain_source_ref_digest"),
    rollbackEligible: input.rollbackEligible !== false,
  };
}

function normalizeExecutionSourceRefs(values, fallbackKind = "context_maintenance_source") {
  return (Array.isArray(values) ? values : []).map((value) => normalizeExecutionSourceRef(value, fallbackKind)).filter(Boolean);
}

function buildContextMaintenanceExecutionPacket(input = {}) {
  const actionKind = CONTEXT_MAINTENANCE_EXECUTION_ACTIONS.has(input.actionKind)
    ? input.actionKind
    : "context_loss_remediation_preview";
  const operatorDecision = CONTEXT_MAINTENANCE_OPERATOR_DECISIONS.has(input.operatorDecision)
    ? input.operatorDecision
    : "deferred";
  const sourceArtifactRefs = normalizeExecutionSourceRefs(input.sourceArtifactRefs || input.sourceRefs, actionKind);
  const sourceDigest = sha256(stableStringify({
    projectId: input.projectId,
    threadId: input.threadId,
    workThreadId: input.workThreadId,
    actionKind,
    operatorDecision,
    sourceArtifactRefs,
    expectedSourceDigest: input.expectedSourceDigest,
    expectedUiProjectionGeneration: input.expectedUiProjectionGeneration,
  }));
  const packet = {
    schema: DIRECT_CONTEXT_MAINTENANCE_EXECUTION_PACKET_SCHEMA,
    executionPacketId: normalizeString(input.executionPacketId, `context_maintenance_exec_${sourceDigest.slice(0, 24)}`),
    projectId: normalizeString(input.projectId, ""),
    threadId: normalizeString(input.threadId, ""),
    workThreadId: normalizeString(input.workThreadId, ""),
    actionKind,
    operatorDecision,
    sourceArtifactRefs,
    expectedSourceDigest: normalizeString(input.expectedSourceDigest, ""),
    expectedUiProjectionGeneration: input.expectedUiProjectionGeneration === undefined || input.expectedUiProjectionGeneration === null
      ? null
      : Number(input.expectedUiProjectionGeneration),
    currentMemoryId: normalizeString(input.currentMemoryId, ""),
    proposedMemoryId: normalizeString(input.proposedMemoryId, ""),
    currentBatonId: normalizeString(input.currentBatonId, ""),
    proposedBatonId: normalizeString(input.proposedBatonId, ""),
    omissionLedgerId: normalizeString(input.omissionLedgerId, ""),
    contextLossWitnessId: normalizeString(input.contextLossWitnessId, ""),
    retentionLaw: normalizeString(input.retentionLaw, "source_refs_and_previous_pointer_retained"),
    omissionRisk: normalizeString(input.omissionRisk, "visible_operator_acknowledged"),
    rollbackPosture: normalizeString(input.rollbackPosture, "previous_pointer_retained"),
    providerCompactionRequested: input.providerCompactionRequested === true,
    providerCompactionAllowed: false,
    providerTransportAllowed: false,
    automaticSchedulerAllowed: false,
    workspaceMutationAllowed: false,
    rawTextIncluded: input.rawTextIncluded === true,
    createdAt: normalizeString(input.createdAt, nowIso(input.nowMs)),
  };
  packet.integrity = makeIntegrity(sourceDigest);
  packet.integrity.artifactDigest = artifactDigest({ ...packet, integrity: { ...packet.integrity, artifactDigest: "" } });
  return packet;
}

function executionRefForArtifact(kind, artifact = {}, fallbackId = "") {
  if (!isPlainObject(artifact)) return null;
  const artifactId = normalizeString(
    artifact.memoryId ||
      artifact.batonId ||
      artifact.omissionLedgerId ||
      artifact.contextLossWitnessId ||
      artifact.compactionPlanId ||
      artifact.memoryRefreshProposalId ||
      artifact.memoryRefreshId ||
      artifact.transitionId ||
      fallbackId,
    "",
  );
  const artifactDigest = normalizeString(artifact.integrity?.artifactDigest || artifact.projectionDigest || artifact.planDigest || artifact.memoryDigest, "");
  if (!artifactId && !artifactDigest) return null;
  return {
    artifactKind: kind,
    artifactId,
    artifactDigest,
    rendererSafeLabel: normalizeString(artifact.rendererSafeSummary, kind),
    rawTextIncluded: false,
  };
}

function contextMaintenanceExecutionBlocker(input = {}) {
  const packet = isPlainObject(input.packet) ? input.packet : null;
  if (!packet || packet.schema !== DIRECT_CONTEXT_MAINTENANCE_EXECUTION_PACKET_SCHEMA) return "execution_packet_missing";
  if (packet.rawTextIncluded === true) return "raw_exposure_blocked";
  if (packet.providerCompactionRequested === true || packet.providerCompactionAllowed !== false || packet.providerTransportAllowed !== false) {
    return "provider_compaction_disabled";
  }
  if (packet.operatorDecision === "rejected") return "operator_rejected";
  if (packet.operatorDecision !== "accepted") return "operator_acceptance_required";
  const currentSourceDigest = normalizeString(input.currentSourceDigest, "");
  if (packet.expectedSourceDigest && currentSourceDigest && packet.expectedSourceDigest !== currentSourceDigest) return "stale_source_digest";
  const currentUiProjectionGeneration = input.currentUiProjectionGeneration === undefined || input.currentUiProjectionGeneration === null
    ? null
    : Number(input.currentUiProjectionGeneration);
  if (packet.expectedUiProjectionGeneration !== null && currentUiProjectionGeneration !== null && packet.expectedUiProjectionGeneration !== currentUiProjectionGeneration) {
    return "stale_ui_projection_generation";
  }
  return "";
}

function buildContextMaintenanceExecutionResult(input = {}) {
  const packet = isPlainObject(input.packet) ? input.packet : buildContextMaintenanceExecutionPacket(input);
  const memoryRefreshProposal = isPlainObject(input.memoryRefreshProposal || input.refreshProposal) ? (input.memoryRefreshProposal || input.refreshProposal) : null;
  const proposedMemory = isPlainObject(input.proposedMemory || input.nextMemory) ? (input.proposedMemory || input.nextMemory) : null;
  const baton = isPlainObject(input.baton || input.proposedBaton) ? (input.baton || input.proposedBaton) : null;
  const omissionLedger = isPlainObject(input.omissionLedger) ? input.omissionLedger : null;
  const contextLossWitness = isPlainObject(input.contextLossWitness) ? input.contextLossWitness : null;
  const localCompactionPlan = isPlainObject(input.localCompactionPlan || input.compactionPlan) ? (input.localCompactionPlan || input.compactionPlan) : null;
  let blockerCode = contextMaintenanceExecutionBlocker({
    packet,
    currentSourceDigest: input.currentSourceDigest,
    currentUiProjectionGeneration: input.currentUiProjectionGeneration,
  });
  const materializedArtifacts = [];
  const previewArtifacts = [];
  const retainedArtifacts = [];

  if (!blockerCode) {
    if (packet.actionKind === "memory_refresh_materialize") {
      if (!memoryRefreshProposal || memoryRefreshProposal.proposalState !== "accepted") blockerCode = "memory_refresh_proposal_not_accepted";
      else if (!proposedMemory) blockerCode = "proposed_memory_missing";
      else materializedArtifacts.push(executionRefForArtifact("durable_thread_memory", proposedMemory));
      retainedArtifacts.push(executionRefForArtifact("previous_durable_thread_memory", input.currentMemory || { memoryId: packet.currentMemoryId }));
    } else if (packet.actionKind === "frontier_baton_update") {
      if (!baton) blockerCode = "frontier_baton_missing";
      else materializedArtifacts.push(executionRefForArtifact("frontier_baton", baton));
      retainedArtifacts.push(executionRefForArtifact("previous_frontier_baton", input.currentBaton || { batonId: packet.currentBatonId }));
    } else if (packet.actionKind === "omission_witness_acknowledge") {
      if (!omissionLedger && !contextLossWitness) blockerCode = "omission_witness_missing";
      else materializedArtifacts.push(
        executionRefForArtifact("context_omission_ledger", omissionLedger) ||
          executionRefForArtifact("context_loss_witness", contextLossWitness),
      );
    } else if (packet.actionKind === "context_loss_remediation_preview") {
      if (!contextLossWitness && !localCompactionPlan && !baton) blockerCode = "context_loss_remediation_source_missing";
      else {
        previewArtifacts.push(
          executionRefForArtifact("context_loss_witness", contextLossWitness) ||
            executionRefForArtifact("local_compaction_plan", localCompactionPlan) ||
            executionRefForArtifact("frontier_baton_reinjection_preview", baton),
        );
      }
    }
  }

  const cleanMaterializedArtifacts = materializedArtifacts.filter(Boolean);
  const cleanPreviewArtifacts = previewArtifacts.filter(Boolean);
  const cleanRetainedArtifacts = retainedArtifacts.filter(Boolean);
  const resultState = blockerCode
    ? (blockerCode === "operator_rejected" ? "rejected" : "blocked")
    : cleanPreviewArtifacts.length ? "preview_ready" : "executed";
  const sourceDigest = sha256(stableStringify({
    packetDigest: packet.integrity?.artifactDigest || "",
    blockerCode,
    resultState,
    cleanMaterializedArtifacts,
    cleanPreviewArtifacts,
    cleanRetainedArtifacts,
  }));
  const result = {
    schema: DIRECT_CONTEXT_MAINTENANCE_EXECUTION_RESULT_SCHEMA,
    executionResultId: normalizeString(input.executionResultId, `context_maintenance_result_${sourceDigest.slice(0, 24)}`),
    executionPacketId: normalizeString(packet.executionPacketId, ""),
    projectId: normalizeString(input.projectId, packet.projectId || proposedMemory?.projectId || baton?.projectId || ""),
    threadId: normalizeString(input.threadId, packet.threadId || proposedMemory?.threadId || baton?.threadId || ""),
    workThreadId: normalizeString(input.workThreadId, packet.workThreadId || ""),
    actionKind: normalizeString(packet.actionKind, ""),
    resultState,
    blockerCode,
    materializedArtifacts: cleanMaterializedArtifacts,
    previewArtifacts: cleanPreviewArtifacts,
    retainedArtifacts: cleanRetainedArtifacts,
    mutationScope: cleanMaterializedArtifacts.length ? "local_context_artifacts" : "none",
    memoryPointerUpdated: !blockerCode && packet.actionKind === "memory_refresh_materialize" && cleanMaterializedArtifacts.length > 0,
    batonPointerUpdated: !blockerCode && packet.actionKind === "frontier_baton_update" && cleanMaterializedArtifacts.length > 0,
    omissionAcknowledged: !blockerCode && packet.actionKind === "omission_witness_acknowledge" && cleanMaterializedArtifacts.length > 0,
    batonReinjectionPreviewReady: !blockerCode && packet.actionKind === "context_loss_remediation_preview" && cleanPreviewArtifacts.length > 0,
    rollbackPosture: normalizeString(packet.rollbackPosture, "previous_pointer_retained"),
    retentionLaw: normalizeString(packet.retentionLaw, "source_refs_and_previous_pointer_retained"),
    omissionRisk: normalizeString(packet.omissionRisk, "visible_operator_acknowledged"),
    providerCompactionAllowed: false,
    providerTransportUsed: false,
    appServerFallbackUsed: false,
    automaticSchedulerUsed: false,
    workspaceMutationUsed: false,
    rawTextIncluded: false,
    createdAt: normalizeString(input.createdAt, nowIso(input.nowMs)),
  };
  result.integrity = makeIntegrity(sourceDigest);
  result.integrity.artifactDigest = artifactDigest({ ...result, integrity: { ...result.integrity, artifactDigest: "" } });
  return result;
}

function validateContextMaintenanceExecutionGate(input = {}) {
  const packet = isPlainObject(input.packet) ? input.packet : null;
  const result = isPlainObject(input.result) ? input.result : null;
  if (!packet || packet.schema !== DIRECT_CONTEXT_MAINTENANCE_EXECUTION_PACKET_SCHEMA) {
    throw new Error("context_maintenance_execution_packet_schema_mismatch");
  }
  if (!CONTEXT_MAINTENANCE_EXECUTION_ACTIONS.has(packet.actionKind)) {
    throw new Error("context_maintenance_execution_action_invalid");
  }
  if (packet.rawTextIncluded === true && (!result || result.resultState !== "blocked" || result.blockerCode !== "raw_exposure_blocked")) {
    throw new Error("context_maintenance_execution_packet_raw_exposure_not_blocked");
  }
  if (packet.providerCompactionAllowed !== false || packet.providerTransportAllowed !== false) {
    throw new Error("context_maintenance_execution_packet_authority_leak");
  }
  if (packet.workspaceMutationAllowed !== false || packet.automaticSchedulerAllowed !== false) {
    throw new Error("context_maintenance_execution_packet_mutation_leak");
  }
  if (!normalizeString(packet.workThreadId, "")) throw new Error("context_maintenance_execution_work_thread_missing");
  if (!Array.isArray(packet.sourceArtifactRefs) || packet.sourceArtifactRefs.length === 0) {
    throw new Error("context_maintenance_execution_source_refs_missing");
  }
  if (result) {
    if (result.schema !== DIRECT_CONTEXT_MAINTENANCE_EXECUTION_RESULT_SCHEMA) {
      throw new Error("context_maintenance_execution_result_schema_mismatch");
    }
    if (result.rawTextIncluded !== false || result.providerCompactionAllowed !== false || result.providerTransportUsed !== false) {
      throw new Error("context_maintenance_execution_result_provider_or_raw_leak");
    }
    if (result.appServerFallbackUsed !== false || result.automaticSchedulerUsed !== false || result.workspaceMutationUsed !== false) {
      throw new Error("context_maintenance_execution_result_side_effect_leak");
    }
    if (result.resultState === "executed" && result.mutationScope !== "local_context_artifacts") {
      throw new Error("context_maintenance_execution_missing_local_scope");
    }
    if (result.resultState === "blocked" && !normalizeString(result.blockerCode, "")) {
      throw new Error("context_maintenance_execution_blocked_without_reason");
    }
    if (result.memoryPointerUpdated === true && result.actionKind !== "memory_refresh_materialize") {
      throw new Error("context_maintenance_execution_memory_pointer_action_mismatch");
    }
    if (result.batonPointerUpdated === true && result.actionKind !== "frontier_baton_update") {
      throw new Error("context_maintenance_execution_baton_pointer_action_mismatch");
    }
  }
  return true;
}

function makeStatusActionError(code, extra = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function validateStatusProjectionAction(input = {}) {
  const projection = isPlainObject(input.projection) ? input.projection : null;
  if (!projection || projection.schema !== DIRECT_CONTEXT_MAINTENANCE_STATUS_PROJECTION_SCHEMA) {
    throw makeStatusActionError("context_status_projection_missing");
  }
  if (projection.displayOnly !== true || projection.rawTextIncluded !== false) {
    throw makeStatusActionError("context_status_projection_unsafe");
  }
  const expectedGeneration = input.expectedUiProjectionGeneration === undefined || input.expectedUiProjectionGeneration === null
    ? ""
    : String(input.expectedUiProjectionGeneration);
  if (expectedGeneration && expectedGeneration !== String(projection.uiProjectionGeneration)) {
    throw makeStatusActionError("context_status_projection_stale", {
      currentGeneration: projection.uiProjectionGeneration,
      submittedGeneration: input.expectedUiProjectionGeneration,
    });
  }
  const expectedSourceDigest = normalizeString(input.expectedSourceDigest, "");
  if (expectedSourceDigest && expectedSourceDigest !== normalizeString(projection.sourceDigest, "")) {
    throw makeStatusActionError("context_status_source_digest_changed");
  }
  const expectedLedgerDigest = normalizeString(input.expectedOperationLedgerHeadDigest, "");
  if (expectedLedgerDigest && expectedLedgerDigest !== normalizeString(projection.operationLedgerHeadDigest, "")) {
    throw makeStatusActionError("operation_ledger_changed");
  }
  const actionKind = normalizeString(input.actionKind, "read_status");
  if (["read_status", "inspect_status", "refresh_status_projection"].includes(actionKind)) {
    return {
      allowed: true,
      actionKind,
      displayOnly: true,
      runtimeAuthorityGranted: false,
      providerTransportAllowed: false,
      retryAutomatically: false,
    };
  }
  if ([
    "send_provider_request",
    "start_turn",
    "composer_send",
    "build_context_pack",
    "build_request_manifest",
    "run_context_maintenance",
  ].includes(actionKind)) {
    throw makeStatusActionError("context_status_not_runtime_authority", {
      composerAllowed: projection.composerAllowed === true,
      composerAllowedReason: normalizeString(projection.composerAllowedReason, ""),
    });
  }
  throw makeStatusActionError("context_status_action_unsupported");
}

function buildVanillaSiblingContextEvidence(input = {}) {
  const threadItems = Array.isArray(input.threadItems) ? input.threadItems : [];
  const controlsObserved = Array.isArray(input.controlsObserved) ? input.controlsObserved : [];
  const sourceRefs = Array.isArray(input.sourceRefs) ? input.sourceRefs : [];
  const contextCompaction = threadItems
    .filter((item) => normalizeString(item.type, "") === "contextCompaction")
    .map((item, index) => ({
      itemId: normalizeString(item.id, `context_compaction_${index + 1}`),
      lifecycle: normalizeString(item.lifecycle || item.status, "observed"),
      appServerOwned: true,
      rendererSafeSummary: "App-server thread contains a context compaction item.",
      directProviderCompactPrimitiveProven: false,
      directOmissionLedgerCreated: false,
      rawTextIncluded: false,
    }));
  const memoryCitations = threadItems
    .filter((item) => isPlainObject(item.memoryCitation))
    .map((item, index) => ({
      itemId: normalizeString(item.id, `memory_citation_${index + 1}`),
      citationEvidenceKey: normalizeString(item.memoryCitation.evidenceKey || item.memoryCitation.memoryId, ""),
      appServerOwned: true,
      directDurableMemoryEntryCreated: false,
      rawTextIncluded: false,
    }));
  const memoryControls = controlsObserved
    .filter((control) => ["thread/memoryMode/set", "memory/reset"].includes(normalizeString(control.method, "")))
    .map((control) => ({
      method: normalizeString(control.method, ""),
      evidenceKey: normalizeString(control.evidenceKey, ""),
      appServerOnly: true,
      directMemoryEditorProven: false,
      directMemoryArtifactsMutated: false,
      rawPayloadIncluded: false,
    }));
  const compactControls = controlsObserved
    .filter((control) => normalizeString(control.method, "") === "thread/compact/start")
    .map((control) => ({
      method: "thread/compact/start",
      evidenceKey: normalizeString(control.evidenceKey, ""),
      appServerOnly: true,
      directProviderCompactPrimitiveProven: false,
      directMaintenanceRouteSelected: false,
      rawPayloadIncluded: false,
    }));
  const sourceDigest = normalizeString(input.sourceDigest, sha256(stableStringify({
    sourceRefs,
    threadItems: threadItems.map((item) => ({
      id: normalizeString(item.id, ""),
      type: normalizeString(item.type, ""),
      hasMemoryCitation: isPlainObject(item.memoryCitation),
      lifecycle: normalizeString(item.lifecycle || item.status, ""),
    })),
    controlsObserved: controlsObserved.map((control) => ({
      method: normalizeString(control.method, ""),
      evidenceKey: normalizeString(control.evidenceKey, ""),
    })),
  })));
  const evidence = {
    schema: DIRECT_VANILLA_SIBLING_CONTEXT_EVIDENCE_SCHEMA,
    evidenceId: normalizeString(input.evidenceId, `vanilla_context_sibling_${sha256(`${input.projectId}:${input.threadId}:${sourceDigest}`).slice(0, 24)}`),
    projectId: normalizeString(input.projectId, ""),
    threadId: normalizeString(input.threadId, ""),
    sourceClass: "vanilla_app_server_sibling",
    sourceConfidence: normalizeString(input.sourceConfidence, "diagnostic"),
    sourceRefs,
    threadContinuity: {
      scope: "app_server_only",
      threadItemCount: threadItems.length,
      appServerOwned: true,
      directProviderContinuityGranted: false,
    },
    contextCompaction,
    compactControls,
    memoryCitations,
    memoryControls,
    statusProjection: {
      statusItemKind: "vanilla_sibling_context_management",
      displayOnly: true,
      rendererSafeSummary: contextCompaction.length
        ? "App-server context compaction observed as sibling evidence."
        : "No app-server context compaction item observed.",
      actionability: {
        actionable: false,
        allowedActions: [],
        reason: "vanilla_sibling_evidence_is_read_only",
      },
      directArtifactPromotionAllowed: false,
      rawTextIncluded: false,
    },
    directContinuityGranted: false,
    directContextPackUsable: false,
    providerCompactPrimitiveProven: false,
    directOmissionLedgerCreated: false,
    directMemoryEditorProven: false,
    directMemoryArtifactsMutated: false,
    appServerMutationUsed: input.appServerMutationUsed === true,
    providerTransportUsed: false,
    rawTextIncluded: false,
    rawPayloadIncluded: false,
    createdAt: normalizeString(input.createdAt, nowIso(input.nowMs)),
  };
  evidence.integrity = makeIntegrity(sourceDigest);
  evidence.integrity.artifactDigest = artifactDigest({ ...evidence, integrity: { ...evidence.integrity, artifactDigest: "" } });
  return evidence;
}

function maintenanceRecoveryState(input = {}) {
  if (input.rawExposureBlocked === true) return "raw_exposure_blocked";
  if (input.corrupt === true) return "corrupt";
  if (input.providerHandoffUnknown === true) return "provider_compaction_handoff_unknown";
  if (input.omissionLedgerMissing === true) return "omission_ledger_missing";
  if (input.memoryCorrupt === true) return "memory_corrupt";
  if (input.batonRequiredMissing === true) return "baton_required_missing";
  if (input.batonStale === true) return "baton_stale";
  if (input.memoryRefreshFailedCurrentRetained === true) return "memory_refresh_failed_current_retained";
  if (input.trimPlanNoLedger === true) return "trim_plan_no_ledger";
  if (input.manifestRunningInterrupted === true) return "manifest_running_interrupted";
  if (input.routePlannedNoManifest === true) return "route_planned_no_manifest";
  return "healthy";
}

function validateContextMaintenanceReport(report = {}) {
  if (report.schema !== DIRECT_CONTEXT_MAINTENANCE_REGRESSION_REPORT_SCHEMA) {
    throw new Error("direct_context_maintenance_report_schema_mismatch");
  }
  if (!Array.isArray(report.cases) || report.cases.length === 0) throw new Error("direct_context_maintenance_report_cases_missing");
  const counters = report.sentinelCounters || {};
  for (const key of [
    "providerTransportCalls",
    "appServerSpawnCalls",
    "workspaceReadCalls",
    "patchApplyCalls",
    "commandRunCalls",
    "rightPaneMutationCalls",
    "handoffMutationCalls",
  ]) {
    if (Number(counters[key] || 0) !== 0) throw new Error(`direct_context_maintenance_sentinel_nonzero:${key}`);
  }
  for (const entry of report.cases) {
    if (entry.coverageSource === "fixture_context_maintenance" && entry.matrixPromotionCandidate === true) {
      throw new Error(`fixture_context_maintenance_promoted:${entry.caseId}`);
    }
  }
  if (report.promotionCandidates?.A12_providerCompaction === true && report.coverageSource !== "real_provider") {
    throw new Error("provider_compaction_promoted_without_live_evidence");
  }
  return true;
}

module.exports = {
  DIRECT_CONTEXT_MAINTENANCE_MANIFEST_SCHEMA,
  DIRECT_CONTEXT_MAINTENANCE_REGRESSION_REPORT_SCHEMA,
  DIRECT_CONTEXT_MAINTENANCE_ROUTE_INPUT_SCHEMA,
  DIRECT_CONTEXT_MAINTENANCE_ROUTE_SCHEMA,
  DIRECT_CONTEXT_MAINTENANCE_STATUS_PROJECTION_SCHEMA,
  DIRECT_CONTEXT_COMPACTION_GATE_SCHEMA,
  DIRECT_CONTEXT_COMPACTION_PLAN_SCHEMA,
  DIRECT_CONTEXT_CONTINUITY_STATUS_PROJECTION_SCHEMA,
  DIRECT_CONTEXT_CONTINUITY_TRANSITION_SCHEMA,
  DIRECT_CONTEXT_MAINTENANCE_EXECUTION_PACKET_SCHEMA,
  DIRECT_CONTEXT_MAINTENANCE_EXECUTION_RESULT_SCHEMA,
  DIRECT_CONTEXT_LOSS_WITNESS_SCHEMA,
  DIRECT_CONTEXT_OMISSION_LEDGER_SCHEMA,
  DIRECT_CONTEXT_PRESSURE_ESTIMATE_SCHEMA,
  DIRECT_CONTEXT_ROUTE_SELECTOR_VERSION,
  DIRECT_DURABLE_THREAD_MEMORY_SCHEMA,
  DIRECT_FRONTIER_BATON_SCHEMA,
  DIRECT_RAW_WINDOW_TRIM_PLAN_SCHEMA,
  DIRECT_RAW_WINDOW_TRIM_POLICY_SCHEMA,
  DIRECT_REQUIRED_CONTEXT_ARTIFACT_CLASSES,
  DIRECT_THREAD_MEMORY_REFRESH_SCHEMA,
  DIRECT_THREAD_MEMORY_REFRESH_PROPOSAL_SCHEMA,
  DIRECT_THREAD_MEMORY_RESET_CONFIRMATION_SCHEMA,
  DIRECT_THREAD_MEMORY_RESET_POLICY_SCHEMA,
  DIRECT_THREAD_MEMORY_REVIEW_PACKET_SCHEMA,
  DIRECT_VANILLA_SIBLING_CONTEXT_EVIDENCE_SCHEMA,
  MAINTENANCE_ENGINES,
  CONTEXT_MAINTENANCE_EXECUTION_ACTIONS,
  ROUTE_CLASSES,
  ROUTE_KINDS,
  assertOmissionParity,
  buildDurableThreadMemory,
  buildFrontierBaton,
  buildContextContinuityStatusProjection,
  buildContextContinuityTransition,
  buildContextMaintenanceExecutionPacket,
  buildContextMaintenanceExecutionResult,
  buildContextLossWitness,
  buildCompactionWorkflowGate,
  buildLocalCompactionPlan,
  buildMaintenanceManifest,
  buildMemoryRefreshManifest,
  buildOmissionLedger,
  buildPressureEstimate,
  buildRawWindowTrimPolicy,
  buildRouteInput,
  buildStatusProjection,
  buildThreadMemoryRefreshProposal,
  buildThreadMemoryResetConfirmation,
  buildThreadMemoryResetPolicy,
  buildThreadMemoryReviewPacket,
  buildTrimPlan,
  buildVanillaSiblingContextEvidence,
  maintenanceRecoveryState,
  maintenanceRefsFromArtifacts,
  selectMaintenanceRoute,
  sha256,
  stableStringify,
  validateStatusProjectionAction,
  validateCompactionWorkflow,
  validateContextContinuityProductization,
  validateContextMaintenanceExecutionGate,
  validateContextMaintenanceReport,
  validateThreadMemoryWorkflow,
  validateMaintenanceRefs,
};
