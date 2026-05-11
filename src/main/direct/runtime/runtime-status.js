"use strict";

const { MAX_READONLY_TOOL_LOOP_STEPS } = require("../tools/read-only-authority");

const DIRECT_RUNTIME_STATUS_SCHEMA = "direct_codex_runtime_status@1";
const CODEX_RUNTIME_MODES = new Set(["legacy-app-server", "direct-experimental", "direct"]);
const CODEX_BINDING_PROVIDERS = new Set(["codex-compatible", "custom-codex-fork", "direct-chatgpt-codex"]);
const DIRECT_EXPERIMENTAL_RUNTIME_TIERS = new Set(["none", "text-only", "implementation-lane"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeCodexRuntimeMode(value, fallback = "legacy-app-server") {
  const candidate = normalizeString(value, fallback).toLowerCase();
  if (candidate === "app-server" || candidate === "managed" || candidate === "legacy") return "legacy-app-server";
  if (candidate === "appserver") return "legacy-app-server";
  if (candidate === "experimental-direct") return "direct-experimental";
  return CODEX_RUNTIME_MODES.has(candidate) ? candidate : fallback;
}

function normalizeDirectExperimentalRuntimeTier(value, fallback = "none") {
  const candidate = normalizeString(value, fallback).toLowerCase();
  if (candidate === "text-only-real-turn" || candidate === "text_only" || candidate === "text-only-preview") return "text-only";
  if (candidate === "implementation" || candidate === "implementation_lane") return "implementation-lane";
  return DIRECT_EXPERIMENTAL_RUNTIME_TIERS.has(candidate) ? candidate : fallback;
}

function normalizeCodexBindingProvider(value, fallback = "codex-compatible") {
  const candidate = normalizeString(value, fallback).toLowerCase();
  return CODEX_BINDING_PROVIDERS.has(candidate) ? candidate : fallback;
}

function normalizeCodexBinding(raw = {}) {
  const binding = isPlainObject(raw) ? raw : {};
  const runtimeMode = normalizeCodexRuntimeMode(binding.runtimeMode);
  const defaultProvider = runtimeMode === "legacy-app-server" ? "codex-compatible" : "direct-chatgpt-codex";
  const rawProvider = binding.bindingProvider || (typeof binding.provider === "string" ? binding.provider : "");
  const directTransport = normalizeString(binding.directTransport, "fixture").toLowerCase() === "live-text" ? "live-text" : "fixture";
  const tierFallback = runtimeMode === "direct-experimental" && directTransport === "live-text" ? "text-only" : "none";
  const directTier = runtimeMode === "direct-experimental"
    ? normalizeDirectExperimentalRuntimeTier(binding.directTier || binding.activationTier || binding.runtimeTier, tierFallback)
    : "none";
  return {
    provider: normalizeCodexBindingProvider(rawProvider, defaultProvider),
    runtimeMode,
    directTier,
    directTransport,
    target: normalizeString(binding.target, ""),
    profileId: normalizeString(binding.profileId, ""),
    model: normalizeString(binding.model, ""),
  };
}

function directRuntimeModeLabel(runtimeMode) {
  if (runtimeMode === "direct") return "direct";
  if (runtimeMode === "direct-experimental") return "direct experimental";
  return "legacy app-server";
}

function directRuntimeLaneLabel(codex = {}) {
  const binding = normalizeCodexBinding(codex);
  if (binding.runtimeMode === "direct") return "direct runtime";
  if (binding.runtimeMode === "direct-experimental" && binding.directTransport === "live-text" && binding.directTier === "text-only") return "direct text-only";
  if (binding.runtimeMode === "direct-experimental" && binding.directTransport === "live-text") return "direct implementation lane";
  if (binding.runtimeMode === "direct-experimental") return "direct experimental scaffold";
  return codex.mode === "managed" ? "legacy app-server bridge" : codex.mode || "legacy app-server";
}

function authAcceptanceStatus(authStatus = {}) {
  if (authStatus.status === "authenticated") return "accepted";
  if (authStatus.status === "expired" && authStatus.hasRefreshToken) return "unstable";
  if (authStatus.status === "refresh_failed") return "unstable";
  return "observed";
}

function authRefreshStatus(authStatus = {}) {
  if (authStatus.status === "authenticated") return "accepted";
  if (authStatus.hasRefreshToken) return "unstable";
  return "unavailable";
}

function authStorageKind(authStatus = {}, authSettings = {}) {
  const mode = normalizeString(authSettings.storageMode || authStatus.storageMode, "file");
  if (mode === "memory") return "ephemeral-memory";
  return "plain-file-dev-only";
}

function modelEntriesFromProfile(profileDoc = {}) {
  const models = profileDoc.profile?.ontology?.models;
  if (!Array.isArray(models)) return [];
  return models
    .filter((model) => isPlainObject(model) && model.id && model.status !== "rejected")
    .map((model) => ({
      id: String(model.id),
      displayName: normalizeString(model.displayName || model.name, String(model.id)),
      status: normalizeString(model.status, "unknown"),
      supportsReasoning: model.supportsReasoning === null ? null : Boolean(model.supportsReasoning),
      supportsTools: model.supportsTools === null ? null : Boolean(model.supportsTools),
    }));
}

function terminalTurnState(value) {
  const state = normalizeString(value, "");
  return ["completed", "failed", "aborted"].includes(state) ? state : "";
}

function directTextOnlyReadiness({ binding = {}, authStatus = {}, liveTextStatus = {}, sessionStore = {} } = {}) {
  const selected = binding.runtimeMode === "direct-experimental" &&
    binding.directTransport === "live-text" &&
    binding.directTier === "text-only";
  const blockers = [];
  const authOk = authStatus.status === "authenticated";
  const liveOk = liveTextStatus.status === "ready" && liveTextStatus.turnRunnable === true;
  const recovery = isPlainObject(sessionStore.recovery) ? sessionStore.recovery : {};
  const storeOk = sessionStore.available !== false && Number(recovery.missingSessionFileCount || 0) === 0;
  const evidence = isPlainObject(liveTextStatus.liveProbeEvidence) ? liveTextStatus.liveProbeEvidence : {};
  if (!authOk) {
    blockers.push(authStatus.status === "expired"
      ? "direct_auth_expired"
      : authStatus.status === "refresh_failed"
        ? "direct_auth_refresh_failed"
        : "direct_auth_missing");
  }
  if (!liveOk) {
    if (evidence.status === "candidate") blockers.push("live_text_evidence_candidate_only");
    else if (liveTextStatus.modelEvidenceState === "expired") blockers.push("live_text_evidence_expired");
    else blockers.push("live_text_evidence_missing");
  }
  if (!storeOk) blockers.push("direct_thread_store_unhealthy");
  const eligible = blockers.length === 0;
  return {
    tier: "text-only",
    status: selected ? (eligible ? "enabled" : "degraded") : (eligible ? "eligible" : "blocked"),
    selected,
    canEnable: eligible,
    canStartTextTurn: selected && eligible,
    canStartEmptyContextTurn: selected && eligible,
    canStartRecentDialogueTurn: selected && eligible,
    selectedThreadComposerState: selected && eligible ? "enabled_empty_context" : "disabled_auth_or_evidence",
    recentDialogue: {
      requestShapeEvidenceState: liveOk ? "runtime_probed" : (evidence.status === "candidate" ? "candidate" : "missing"),
      blockerCodes: blockers,
    },
    blockers,
    warnings: [],
    requestShapeClass: "direct_text_turn_empty_context@1",
    toolContinuationRequired: false,
    toolsAvailable: false,
    appServerFallbackAllowed: false,
  };
}

function directImplementationLaneReadiness({ activation = {}, sessionStore = {}, liveTextStatus = {} } = {}) {
  const blockers = activation.gateSummary?.blockers;
  const safeBlockers = Array.isArray(blockers)
    ? blockers.map((item) => normalizeString(item.blockerCode || item.reason || item.id, "")).filter(Boolean)
    : [];
  const selected = activation.enabled === true && normalizeString(activation.activationTier, "implementation-lane") === "implementation-lane";
  const eligible = activation.eligible === true || selected;
  const degraded = activation.degraded === true;
  const degradedCapabilities = isPlainObject(activation.degradedCapabilities) ? activation.degradedCapabilities : {};
  const hasToolBlocker = safeBlockers.some((code) =>
    code.includes("tool") ||
    code.includes("workspace") ||
    code.includes("continuation"));
  const hasLiveBlocker = safeBlockers.some((code) =>
    code.includes("auth") ||
    code.includes("live_text") ||
    code.includes("session_store"));
  const canStartText = selected && !hasLiveBlocker && !degraded ||
    degradedCapabilities.canStartNewTextTurn === true;
  const canApproveReadFile = selected && !hasLiveBlocker && !hasToolBlocker && !degraded ||
    degradedCapabilities.canApproveReadOnlyTool === true;
  const canApproveCommand = selected &&
    normalizeString(liveTextStatus.commandExecutionContinuation?.status, "") === "ready" &&
    !hasLiveBlocker &&
    !degraded;
  return {
    tier: "implementation-lane",
    status: selected ? (degraded ? "degraded" : "enabled") : (activation.eligible ? "eligible" : "blocked"),
    selected,
    canEnable: activation.eligible === true,
    canSelect: activation.eligible === true,
    canStartFirstTurn: canStartText,
    canStartFollowupTurn: canStartText,
    canStartTextTurn: canStartText,
    canShowObligations: selected || eligible,
    canApproveReadFile,
    canApproveCommand,
    canBuildContinuationContext: canApproveReadFile,
    canSendContinuation: canApproveReadFile,
    blockers: safeBlockers,
    warnings: [],
    missingImplementationOnlyGates: safeBlockers,
    readOnlyToolLoop: {
      obligationProjectionHealthy: !safeBlockers.includes("direct_obligations_projection_unhealthy"),
      toolContextProjectionHealthy: !safeBlockers.includes("tool_continuation_context_projection_unhealthy"),
      workspaceReadHealthy: !safeBlockers.includes("workspace_backend_unattached"),
      continuationEvidenceState: normalizeString(liveTextStatus.readOnlyToolContinuation?.evidenceState, safeBlockers.some((code) => code.includes("tool")) ? "missing" : "accepted"),
      loopEvidenceState: normalizeString(liveTextStatus.readOnlyToolContinuation?.evidenceState, safeBlockers.some((code) => code.includes("tool")) ? "missing" : "accepted"),
      activeLoopCount: Number(sessionStore.unresolvedObligationCount || 0) > 0 ? 1 : 0,
      activeStepOrdinal: Number(sessionStore.activeToolStepOrdinal || 0) || undefined,
      maxStepCount: MAX_READONLY_TOOL_LOOP_STEPS,
      activeObligationCount: Number(sessionStore.unresolvedObligationCount || 0),
      pendingDecisionCount: Number(sessionStore.unresolvedObligationCount || 0),
      streamingContinuationCount: normalizeString(sessionStore.lastTurnState, "") === "streaming_continuation" ? 1 : 0,
      canContinueSequentialReadOnlyLoop: canApproveReadFile,
      blockerCodes: safeBlockers,
    },
    commandExecution: {
      canApprove: canApproveCommand,
      canExecute: canApproveCommand,
      continuationEvidenceState: normalizeString(liveTextStatus.commandExecutionContinuation?.evidenceState, "missing"),
      workspaceEffectScanRequired: true,
      shellFalseRequired: true,
      networkIsolationProven: false,
      blockerCodes: canApproveCommand ? [] : safeBlockers,
    },
  };
}

function buildDirectRuntimeStatus(options = {}) {
  const generatedAt = normalizeString(options.generatedAt, "") || new Date().toISOString();
  const project = isPlainObject(options.project) ? options.project : {};
  const codex = isPlainObject(project.surfaceBinding?.codex) ? project.surfaceBinding.codex : {};
  const binding = normalizeCodexBinding(codex);
  const authStatus = isPlainObject(options.authStatus) ? options.authStatus : {};
  const authSettings = isPlainObject(options.authSettings) ? options.authSettings : {};
  const profileDoc = isPlainObject(options.profileDoc) ? options.profileDoc : {};
  const legacySession = isPlainObject(options.legacySession) ? options.legacySession : null;
  const sessionStore = isPlainObject(options.sessionStore) ? options.sessionStore : null;
  const directThreadStore = isPlainObject(options.directThreadStore) ? options.directThreadStore : null;
  const imports = isPlainObject(options.imports) ? options.imports : {};
  const activation = isPlainObject(options.activation) ? options.activation : {};
  const fixtureRuntime = isPlainObject(options.fixtureRuntime) ? options.fixtureRuntime : null;
  const liveTextRuntime = isPlainObject(options.liveTextRuntime) ? options.liveTextRuntime : null;
  const modelEntries = modelEntriesFromProfile(profileDoc);
  const directModeSelected = binding.runtimeMode !== "legacy-app-server";
  const liveTextSelected = directModeSelected && binding.directTransport === "live-text";
  const fixtureRuntimeAvailable = directModeSelected && !liveTextSelected && Boolean(fixtureRuntime?.available);
  const liveTextRuntimeAvailable = liveTextSelected && Boolean(liveTextRuntime?.available);
  const liveTextStatus = isPlainObject(liveTextRuntime?.status) ? liveTextRuntime.status : {};
  const liveProbeEvidence = isPlainObject(liveTextStatus.liveProbeEvidence) ? liveTextStatus.liveProbeEvidence : null;
  const directTurnBlockedReason =
    binding.runtimeMode === "direct"
      ? "direct_runtime_validation_gates_not_passed"
      : liveTextSelected
        ? (liveTextStatus.status === "ready" ? "" : normalizeString(liveTextStatus.reason, "direct_live_text_not_ready"))
        : "direct_session_engine_not_implemented";

  return {
    schema: DIRECT_RUNTIME_STATUS_SCHEMA,
    version: 1,
    runtime: "direct-chatgpt-codex",
    runtimeMode: binding.runtimeMode,
    directTier: binding.directTier,
    runtimeModeLabel: directRuntimeModeLabel(binding.runtimeMode),
    provider: binding.provider,
    directTransport: binding.directTransport,
    currentCodexLane: directRuntimeLaneLabel(codex),
    status: liveTextRuntimeAvailable && liveTextStatus.status === "ready" ? "ready" : directModeSelected ? "degraded" : "legacy-app-server",
    generatedAt,
    auth: {
      source: normalizeString(authStatus.source, "direct-auth-store"),
      operationalStatus: normalizeString(authStatus.status, "unauthenticated"),
      rawTokensExposed: false,
      capability: {
        status: authAcceptanceStatus(authStatus),
        acquisition: "browser-callback",
        refresh: authRefreshStatus(authStatus),
        accountIdSource: authStatus.accountId ? "token-claim" : "unknown",
        storage: authStorageKind(authStatus, authSettings),
      },
    },
    directRuntime: {
      selected: directModeSelected,
      status: liveTextRuntimeAvailable ? normalizeString(liveTextStatus.status, "unavailable") : directModeSelected ? "not_runnable" : "not_selected",
      ready: liveTextRuntimeAvailable && liveTextStatus.status === "ready",
      panelAttachStatus: liveTextRuntimeAvailable ? "live_text_controller" : fixtureRuntimeAvailable ? "fixture_controller" : directModeSelected ? "fixture_status_only" : "legacy_app_server_bridge",
      turnRunnable: liveTextRuntimeAvailable && liveTextStatus.turnRunnable === true,
      reason: directModeSelected
        ? directTurnBlockedReason || "direct_runtime_ready"
        : "legacy_app_server_mode_active",
    },
    fixtureRuntime: {
      available: fixtureRuntimeAvailable,
      turnRunnable: fixtureRuntimeAvailable,
      source: "normalized-fixture",
      liveBackend: false,
      rawBackendFramesExposed: false,
    },
    liveTextRuntime: {
      available: liveTextRuntimeAvailable,
      status: normalizeString(liveTextStatus.status, "unavailable"),
      turnRunnable: liveTextRuntimeAvailable && liveTextStatus.turnRunnable === true,
      modelSource: normalizeString(liveTextStatus.modelSource, "static-baseline"),
      modelEvidenceState: normalizeString(liveTextStatus.modelEvidenceState, "unknown"),
      modelEvidenceId: normalizeString(liveTextStatus.evidenceId, ""),
      liveProbeEvidence: {
        available: Boolean(liveProbeEvidence?.available),
        usable: Boolean(liveProbeEvidence?.usable),
        status: normalizeString(liveProbeEvidence?.status, "missing"),
        storedStatus: normalizeString(liveProbeEvidence?.storedStatus, ""),
        model: normalizeString(liveProbeEvidence?.model, ""),
        modelSource: normalizeString(liveProbeEvidence?.modelSource, "live-probe"),
        modelEvidenceState: normalizeString(liveProbeEvidence?.modelEvidenceState, "unknown"),
        evidenceId: normalizeString(liveProbeEvidence?.evidenceId, ""),
        observedAt: normalizeString(liveProbeEvidence?.observedAt, ""),
        expiresAt: normalizeString(liveProbeEvidence?.expiresAt, ""),
        source: normalizeString(liveProbeEvidence?.source, ""),
        failureKind: normalizeString(liveProbeEvidence?.failureKind, ""),
        reason: normalizeString(liveProbeEvidence?.reason, ""),
        scope: isPlainObject(liveProbeEvidence?.scope)
          ? {
              profileMatches: liveProbeEvidence.scope.profileMatches === true,
              accountMatches: liveProbeEvidence.scope.accountMatches === true,
              endpointMatches: liveProbeEvidence.scope.endpointMatches === true,
              requestShapeMatches: liveProbeEvidence.scope.requestShapeMatches === true,
              modelMatches: liveProbeEvidence.scope.modelMatches === true,
              workspaceMatches: liveProbeEvidence.scope.workspaceMatches === true,
              versionMatches: liveProbeEvidence.scope.versionMatches === true,
            }
          : {
              profileMatches: false,
              accountMatches: false,
              endpointMatches: false,
              requestShapeMatches: false,
              modelMatches: false,
              workspaceMatches: false,
              versionMatches: false,
            },
        rawTokensExposed: false,
        rawBackendFramesExposed: false,
      },
      transport: "direct-live-text",
      appServerRequired: false,
      toolsEnabled: Boolean(liveTextStatus.toolsEnabled),
      readOnlyToolContinuation: isPlainObject(liveTextStatus.readOnlyToolContinuation)
        ? liveTextStatus.readOnlyToolContinuation
        : null,
      patchApplyContinuation: isPlainObject(liveTextStatus.patchApplyContinuation)
        ? liveTextStatus.patchApplyContinuation
        : null,
      commandExecutionContinuation: isPlainObject(liveTextStatus.commandExecutionContinuation)
        ? liveTextStatus.commandExecutionContinuation
        : null,
      reason: normalizeString(liveTextStatus.reason, ""),
      rawBackendFramesExposed: false,
    },
    directTextOnly: directTextOnlyReadiness({
      binding,
      authStatus,
      liveTextStatus,
      sessionStore: sessionStore || {},
    }),
    directImplementationLane: directImplementationLaneReadiness({
      activation,
      sessionStore: sessionStore || {},
      liveTextStatus,
    }),
    transport: {
      kind: "sse",
      endpoint: "chatgpt-codex-responses",
      liveProbed: Boolean(liveProbeEvidence?.usable),
      runnable: liveTextRuntimeAvailable && liveTextStatus.turnRunnable === true,
    },
    activation: {
      state: normalizeString(activation.state, "blocked"),
      eligible: activation.eligible === true,
      enabled: activation.enabled === true,
      degraded: activation.degraded === true,
      activationTier: normalizeString(activation.activationTier, "implementation-lane"),
      rollbackAvailable: activation.rollbackAvailable === true,
      activationId: normalizeString(activation.activationId, ""),
      gateId: normalizeString(activation.gateId, ""),
      gateDigest: normalizeString(activation.gateDigest, ""),
      target: isPlainObject(activation.target)
        ? activation.target
        : { runtimeMode: "direct-experimental", directTier: "implementation-lane", directTransport: "live-text" },
      gateSummary: isPlainObject(activation.gateSummary)
        ? activation.gateSummary
        : { requiredCount: 0, passedRequiredCount: 0, blockedReasons: {}, warningsCount: 0 },
      currentBinding: isPlainObject(activation.currentBinding)
        ? activation.currentBinding
        : { runtimeMode: binding.runtimeMode, directTier: binding.directTier, directTransport: binding.directTransport },
      labels: isPlainObject(activation.labels)
        ? activation.labels
        : { headline: "Direct experimental blocked", detail: "Activation status unavailable." },
      degradedCapabilities: isPlainObject(activation.degradedCapabilities) ? activation.degradedCapabilities : null,
      rawAuthExposed: false,
      rawRequestExposed: false,
      rawStreamExposed: false,
      rawImportPathExposed: false,
      rawWorkspacePathExposed: false,
    },
    textProbe: {
      available: directModeSelected,
      liveBackend: true,
      runnable: liveTextRuntimeAvailable && liveTextStatus.turnRunnable === true,
      manualOnly: true,
      lastTerminalState: terminalTurnState(sessionStore?.lastTurnState),
      activeTurnCount: Number(sessionStore?.activeTurnCount || 0),
      toolsEnabled: Boolean(liveTextStatus.toolsEnabled),
      continuationEnabled: binding.directTier === "implementation-lane" && Boolean(liveTextStatus.toolsEnabled),
      rawBackendFramesExposed: false,
    },
    toolDetection: {
      available: directModeSelected,
      status: liveTextStatus.toolsEnabled ? "read_only_approval" : "detect_only",
      detectedObligationCount: Number(sessionStore?.unresolvedObligationCount || 0),
      executionEnabled: Boolean(liveTextStatus.toolsEnabled),
      continuationEnabled: Boolean(liveTextStatus.toolsEnabled),
      workspaceSideEffectsAllowed: false,
    },
    threads: {
      canStart: false,
      canRead: false,
      canResume: false,
      canPersist: Boolean(sessionStore?.available),
      canImportCodexAppServer: true,
    },
    imports: {
      available: imports.available !== false,
      sourceSelectionAvailable: imports.sourceSelectionAvailable !== false,
      importedSessionCount: Number(imports.importedSessionCount || 0),
      checkpointCandidateCount: Number(imports.checkpointCandidateCount || 0),
      checkpointValidatedCount: Number(imports.checkpointValidatedCount || 0),
      validationFailedCount: Number(imports.validationFailedCount || 0),
      canceledCount: Number(imports.canceledCount || 0),
      corruptedCount: Number(imports.corruptedCount || 0),
      hiddenCount: Number(imports.hiddenCount || 0),
      continuationEligibleCount: Number(imports.continuationEligibleCount || 0),
      continuationRunnableNowCount: 0,
      checkpointContinuationActionAvailableCount: Number(imports.checkpointContinuationActionAvailableCount || 0),
      checkpointContinuationActionRunnableNowCount: Number(imports.checkpointContinuationActionRunnableNowCount || 0),
      checkpointContinuationRunningCount: Number(imports.checkpointContinuationRunningCount || 0),
      checkpointContinuationCompletedCount: Number(imports.checkpointContinuationCompletedCount || 0),
      checkpointContinuationFailedCount: Number(imports.checkpointContinuationFailedCount || 0),
      continuationBlockedReasons: isPlainObject(imports.continuationBlockedReasons) ? imports.continuationBlockedReasons : {},
      lastImportUpdatedAt: normalizeString(imports.lastImportUpdatedAt, ""),
      rawPathsExposed: false,
      rawRecordsExposed: false,
      rawSourceSha256Exposed: false,
      recovery: isPlainObject(imports.recovery) ? imports.recovery : {},
    },
    turns: {
      canStart: false,
      canInterrupt: false,
      canUseTools: Boolean(liveTextStatus.toolsEnabled),
      canContinueAfterTools: Boolean(liveTextStatus.toolsEnabled),
      canCompact: false,
    },
    models: {
      source: liveTextRuntimeAvailable ? normalizeString(liveTextStatus.modelSource, "static-baseline") : "static-baseline",
      selectorEnabled: false,
      sourceVisible: true,
      ids: modelEntries.map((model) => model.id),
      entries: modelEntries,
    },
    authority: {
      workspaceTools: Boolean(liveTextStatus.toolsEnabled),
      commandApproval: false,
      fileChangeApproval: false,
      networkApproval: false,
    },
    sessionStore: {
      available: Boolean(sessionStore?.available),
      rootExposed: false,
      schema: normalizeString(sessionStore?.schema, ""),
      sessionCount: Number(sessionStore?.sessionCount || 0),
      turnCount: Number(sessionStore?.turnCount || 0),
      eventCount: Number(sessionStore?.eventCount || 0),
      activeTurnCount: Number(sessionStore?.activeTurnCount || 0),
      unresolvedObligationCount: Number(sessionStore?.unresolvedObligationCount || 0),
      lastTurnState: normalizeString(sessionStore?.lastTurnState, ""),
      lastSessionUpdatedAt: normalizeString(sessionStore?.lastSessionUpdatedAt, ""),
      recovery: isPlainObject(sessionStore?.recovery) ? sessionStore.recovery : {},
    },
    directThreadStore: {
      available: Boolean(directThreadStore?.available),
      status: normalizeString(directThreadStore?.status, directThreadStore?.available ? "healthy" : "disabled"),
      mode: normalizeString(directThreadStore?.mode, "disabled"),
      schemaVersion: normalizeString(directThreadStore?.schemaVersion, ""),
      rootExposed: false,
      dbPathExposed: false,
      projectionsHealthy: directThreadStore?.projectionsHealthy === true,
      contextBuildsAllowed: directThreadStore?.contextBuildsAllowed === true,
      threadCount: Number(directThreadStore?.threadCount || 0),
      rolloutCount: Number(directThreadStore?.rolloutCount || 0),
      turnCount: Number(directThreadStore?.turnCount || 0),
      operationCount: Number(directThreadStore?.operationCount || 0),
      projectionCount: Number(directThreadStore?.projectionCount || 0),
      contextBuildCount: Number(directThreadStore?.contextBuildCount || 0),
      requestManifestCount: Number(directThreadStore?.requestManifestCount || 0),
      contextPolicyCount: Number(directThreadStore?.contextPolicyCount || 0),
      context: isPlainObject(directThreadStore?.context) ? directThreadStore.context : {
        contextBuildsAllowed: directThreadStore?.contextBuildsAllowed === true,
        contextBuildRequiredForNewTurns: false,
        reasonIfBlocked: "",
      },
      recovery: isPlainObject(directThreadStore?.recovery) ? directThreadStore.recovery : {},
    },
    diagnostics: {
      profileId: normalizeString(binding.profileId || profileDoc.profile?.profileId || profileDoc.summary?.profileId, ""),
      profileSource: normalizeString(profileDoc.profile?.source || profileDoc.summary?.source, ""),
      profileStatus: "observed",
      legacyAppServerAvailable: Boolean(legacySession),
      legacyAppServerStatus: normalizeString(legacySession?.status, ""),
      rawAuthHeadersExposed: false,
      rawBackendRequestsExposed: false,
      rawBackendFramesExposed: false,
    },
  };
}

module.exports = {
  CODEX_BINDING_PROVIDERS,
  DIRECT_EXPERIMENTAL_RUNTIME_TIERS,
  CODEX_RUNTIME_MODES,
  DIRECT_RUNTIME_STATUS_SCHEMA,
  buildDirectRuntimeStatus,
  directRuntimeLaneLabel,
  directRuntimeModeLabel,
  normalizeCodexBinding,
  normalizeCodexBindingProvider,
  normalizeCodexRuntimeMode,
  normalizeDirectExperimentalRuntimeTier,
};
