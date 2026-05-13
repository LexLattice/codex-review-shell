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
const DIRECT_FRONTIER_BATON_SCHEMA = "frontier_baton@1";
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

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function preserveString(value) {
  return typeof value === "string" ? value : "";
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
  const sourceCandidates = Array.isArray(input.entries)
    ? input.entries
    : (Array.isArray(trimPlan?.candidateOmissions) ? trimPlan.candidateOmissions : []);
  const entries = sourceCandidates
    .filter((candidate) => candidate.requiredArtifact !== true)
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

function buildMemoryRefreshManifest(input = {}) {
  const currentMemory = isPlainObject(input.currentMemory) ? input.currentMemory : null;
  const nextMemory = isPlainObject(input.nextMemory) ? input.nextMemory : null;
  const status = normalizeString(input.status, nextMemory ? "completed" : "failed_current_retained");
  const manifest = {
    schema: DIRECT_THREAD_MEMORY_REFRESH_SCHEMA,
    memoryRefreshId: normalizeString(input.memoryRefreshId, `memory_refresh_${sha256(`${input.projectId}:${input.threadId}:${status}`).slice(0, 24)}`),
    projectId: normalizeString(input.projectId, nextMemory?.projectId || currentMemory?.projectId || ""),
    threadId: normalizeString(input.threadId, nextMemory?.threadId || currentMemory?.threadId || ""),
    status,
    sourceRefs: Array.isArray(input.sourceRefs) ? input.sourceRefs : [],
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
  DIRECT_CONTEXT_OMISSION_LEDGER_SCHEMA,
  DIRECT_CONTEXT_PRESSURE_ESTIMATE_SCHEMA,
  DIRECT_CONTEXT_ROUTE_SELECTOR_VERSION,
  DIRECT_DURABLE_THREAD_MEMORY_SCHEMA,
  DIRECT_FRONTIER_BATON_SCHEMA,
  DIRECT_RAW_WINDOW_TRIM_PLAN_SCHEMA,
  DIRECT_RAW_WINDOW_TRIM_POLICY_SCHEMA,
  DIRECT_REQUIRED_CONTEXT_ARTIFACT_CLASSES,
  DIRECT_THREAD_MEMORY_REFRESH_SCHEMA,
  MAINTENANCE_ENGINES,
  ROUTE_CLASSES,
  ROUTE_KINDS,
  assertOmissionParity,
  buildDurableThreadMemory,
  buildFrontierBaton,
  buildMaintenanceManifest,
  buildMemoryRefreshManifest,
  buildOmissionLedger,
  buildPressureEstimate,
  buildRawWindowTrimPolicy,
  buildRouteInput,
  buildStatusProjection,
  buildTrimPlan,
  maintenanceRecoveryState,
  maintenanceRefsFromArtifacts,
  selectMaintenanceRoute,
  sha256,
  stableStringify,
  validateContextMaintenanceReport,
  validateMaintenanceRefs,
};
