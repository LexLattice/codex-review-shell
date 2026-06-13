"use strict";

const crypto = require("node:crypto");

const {
  buildWorkThread,
} = require("./work-thread-registry");

const DIRECT_WORK_THREAD_CONTROL_DECK_SCHEMA = "direct_work_thread_control_deck@1";
const DIRECT_WORK_THREAD_CURRENT_POINTER_SCHEMA = "direct_work_thread_current_pointer@1";
const DIRECT_WORK_THREAD_SELECTION_TRANSITION_SCHEMA = "direct_work_thread_selection_transition@1";

const POINTER_SOURCE_KINDS = new Set(["operator_selection", "session_restore", "resolver_selection", "runtime_observation", "unknown"]);
const POINTER_STATES = new Set(["selected", "missing", "stale", "mismatch", "unknown"]);
const TRANSITION_STATES = new Set(["accepted", "blocked", "noop"]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedString(value, maxLength = 280) {
  const text = normalizeString(value, "");
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…` : text;
}

function boundedCount(value, max = 100) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(max, Math.floor(parsed));
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isPlainObject(value)) {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if ([
        "controlDeckDigest",
        "pointerDigest",
        "selectionTransitionDigest",
        "rowDigest",
        "artifactDigest",
      ].includes(key)) continue;
      if (value[key] !== undefined) output[key] = stableValue(value[key]);
    }
    return output;
  }
  return value;
}

function digestFor(domain, value) {
  return `sha256:${crypto.createHash("sha256").update(`${domain}\0${JSON.stringify(stableValue(value))}`).digest("hex")}`;
}

function normalizeRef(input = {}, fallbackKind = "work_thread_control") {
  const source = isPlainObject(input) ? input : {};
  const ref = {
    kind: normalizeString(source.kind || source.refKind, fallbackKind),
    id: normalizeString(source.id || source.refId || source.artifactId, ""),
    digest: normalizeString(source.digest || source.artifactDigest || source.sourceDigest, ""),
    label: boundedString(source.label || source.rendererSafeLabel || source.kind || fallbackKind, 180),
    confidence: normalizeString(source.confidence || source.sourceConfidence, "diagnostic"),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  ref.refDigest = digestFor("direct-work-thread-control-ref@1", ref);
  return ref;
}

function normalizeRefs(values, fallbackKind = "work_thread_control") {
  return arrayOrEmpty(values)
    .map((value) => normalizeRef(value, fallbackKind))
    .filter((ref) => ref.id || ref.digest);
}

function normalizePointerRef(input = {}, fallbackKind = "unknown") {
  const source = isPlainObject(input) ? input : {};
  return {
    kind: normalizeString(source.kind || fallbackKind, fallbackKind),
    id: normalizeString(source.id || source.artifactId || source.refId, ""),
    digest: normalizeString(source.digest || source.artifactDigest || source.sourceDigest, ""),
    label: boundedString(source.label || source.rendererSafeLabel || source.kind || fallbackKind, 180),
    rawTextIncluded: false,
    rawPathIncluded: false,
  };
}

function buildCurrentWorkThreadPointer(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const sourceKind = POINTER_SOURCE_KINDS.has(source.sourceKind) ? source.sourceKind : "unknown";
  const pointer = {
    schema: DIRECT_WORK_THREAD_CURRENT_POINTER_SCHEMA,
    pointerId: normalizeString(source.pointerId, `work_thread_pointer_${digestFor("direct-work-thread-pointer-id@1", {
      projectId: source.projectId,
      workThreadId: source.selectedWorkThreadId || source.workThreadId,
      activeDirectSessionId: source.activeDirectSessionId,
      selectedProviderLane: source.selectedProviderLane,
    }).slice(7, 31)}`),
    projectId: normalizeString(source.projectId, ""),
    selectedWorkThreadId: normalizeString(source.selectedWorkThreadId || source.workThreadId, ""),
    selectedWorkThreadDigest: normalizeString(source.selectedWorkThreadDigest || source.workThreadDigest, ""),
    sourceKind,
    selectedAt: normalizeString(source.selectedAt, nowIso(options.nowMs)),
    selectedBy: normalizeString(source.selectedBy, sourceKind === "operator_selection" ? "operator" : ""),
    activeDirectSessionId: normalizeString(source.activeDirectSessionId || source.sessionId, ""),
    activeProviderThreadId: normalizeString(source.activeProviderThreadId || source.providerThreadId, ""),
    selectedProviderLane: normalizeString(source.selectedProviderLane || source.providerLane || source.runtimePath, "unknown"),
    lastContextPackRef: normalizePointerRef(source.lastContextPackRef || source.contextPackRef, "context_pack"),
    lastAuthorityTransitionRef: normalizePointerRef(source.lastAuthorityTransitionRef || source.authorityTransitionRef, "authority_transition"),
    lastControlledRouteRef: normalizePointerRef(source.lastControlledRouteRef || source.controlledRouteRef, "controlled_route"),
    nonTargetPreservationConstraints: arrayOrEmpty(source.nonTargetPreservationConstraints)
      .map((item) => normalizeString(item, ""))
      .filter(Boolean),
    evidenceRefs: normalizeRefs(source.evidenceRefs, "work_thread_pointer_evidence"),
    providerCallAuthorityGranted: false,
    workspaceMutationAuthorityGranted: false,
    workerSpawnAuthorityGranted: false,
    appServerReplacementAuthorityGranted: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  pointer.pointerDigest = digestFor("direct-work-thread-current-pointer@1", pointer);
  return pointer;
}

function mismatchBlockersFor(thread = {}, pointer = {}, context = {}) {
  const blockers = [];
  const currentProjectId = normalizeString(context.currentProjectId || context.projectId, "");
  const currentBranchName = normalizeString(context.currentBranchName || context.branchName, "");
  const currentWorkspaceEvidenceKey = normalizeString(context.currentWorkspaceEvidenceKey || context.workspaceEvidenceKey, "");
  const selectedProviderLane = normalizeString(context.selectedProviderLane || context.providerLane, "");
  if (currentProjectId && thread.projectId && thread.projectId !== currentProjectId) blockers.push("project_mismatch");
  const threadBranch = normalizeString(thread.branchIdentity?.branchName, "");
  if (currentBranchName && threadBranch && threadBranch !== currentBranchName) blockers.push("branch_mismatch");
  const threadWorkspace = normalizeString(thread.workspaceIdentity?.workspaceEvidenceKey, "");
  if (currentWorkspaceEvidenceKey && threadWorkspace && threadWorkspace !== currentWorkspaceEvidenceKey) blockers.push("workspace_mismatch");
  if (selectedProviderLane && thread.activeRuntimePath && thread.activeRuntimePath !== "unknown" && thread.activeRuntimePath !== selectedProviderLane) blockers.push("provider_lane_mismatch");
  if (pointer.selectedWorkThreadId === thread.workThreadId && pointer.selectedWorkThreadDigest && pointer.selectedWorkThreadDigest !== thread.digest) blockers.push("selected_work_thread_digest_mismatch");
  if (thread.lifecycleState === "stale") blockers.push("work_thread_stale");
  if (thread.lifecycleState === "archived") blockers.push("work_thread_archived");
  return [...new Set(blockers)];
}

function pointerStateFor(selectedThread, selectedBlockers, pointer = {}) {
  if (!pointer.selectedWorkThreadId) return "missing";
  if (!selectedThread) return "stale";
  if (selectedBlockers.includes("selected_work_thread_digest_mismatch") || selectedBlockers.includes("work_thread_stale")) return "stale";
  if (selectedBlockers.length) return "mismatch";
  return "selected";
}

function rowForThread(thread = {}, pointer = {}, context = {}) {
  const selected = pointer.selectedWorkThreadId === thread.workThreadId;
  const blockerCodes = mismatchBlockersFor(thread, pointer, context);
  const row = {
    workThreadId: thread.workThreadId,
    projectId: thread.projectId,
    title: thread.title,
    lifecycleState: thread.lifecycleState,
    selected,
    stale: blockerCodes.includes("work_thread_stale") || blockerCodes.includes("selected_work_thread_digest_mismatch"),
    mismatch: blockerCodes.some((code) => code.endsWith("_mismatch")),
    blockerCodes,
    objectiveSummary: boundedString(thread.objective?.summary, 240),
    currentArcLabel: boundedString(thread.currentArc?.label, 180),
    phaseKind: normalizeString(thread.phaseState?.phaseKind, "unknown"),
    phaseStatus: normalizeString(thread.phaseState?.status, "unknown"),
    activeRuntimePath: normalizeString(thread.activeRuntimePath, "unknown"),
    openObligationCount: arrayOrEmpty(thread.openObligations).length,
    linkedCodexThreadCount: arrayOrEmpty(thread.linkedCodexThreads).length,
    linkedChatGptThreadCount: arrayOrEmpty(thread.linkedChatGptThreads).length,
    updatedAt: normalizeString(thread.updatedAt, ""),
    digest: normalizeString(thread.digest, ""),
    rawTextIncluded: false,
    rawPathIncluded: false,
  };
  row.rowDigest = digestFor("direct-work-thread-control-row@1", row);
  return row;
}

function projectionRowToControlThread(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const updatedAt = normalizeString(source.updatedAt, nowIso(options.nowMs));
  const thread = {
    schema: "direct_work_thread_control_projection_row@1",
    workThreadId: normalizeString(source.workThreadId || source.id, ""),
    projectId: normalizeString(source.projectId, ""),
    title: boundedString(source.title || source.workThreadId || source.id, 180),
    lifecycleState: normalizeString(source.lifecycleState, "unknown"),
    objective: {
      summary: boundedString(source.objectiveSummary || source.objective?.summary || source.objective, 240),
    },
    currentArc: {
      label: boundedString(source.currentArcLabel || source.currentArc?.label, 180),
    },
    phaseState: {
      phaseKind: normalizeString(source.phaseKind || source.phaseState?.phaseKind, "unknown"),
      status: normalizeString(source.phaseStatus || source.phaseState?.status, "unknown"),
    },
    branchIdentity: {
      branchName: normalizeString(source.branchName || source.branchIdentity?.branchName, ""),
    },
    workspaceIdentity: {
      workspaceEvidenceKey: normalizeString(source.workspaceEvidenceKey || source.workspaceIdentity?.workspaceEvidenceKey, ""),
    },
    activeRuntimePath: normalizeString(source.activeRuntimePath, "unknown"),
    openObligations: Array.from({ length: boundedCount(source.openObligationCount) }, (_, index) => ({ obligationId: `projection_obligation_${index + 1}` })),
    linkedCodexThreads: Array.from({ length: boundedCount(source.linkedCodexThreadCount) }, (_, index) => ({ threadId: `projection_codex_thread_${index + 1}` })),
    linkedChatGptThreads: Array.from({ length: boundedCount(source.linkedChatGptThreadCount) }, (_, index) => ({ threadId: `projection_chatgpt_thread_${index + 1}` })),
    updatedAt,
    digest: normalizeString(source.digest, ""),
    rawTextIncluded: false,
    rawPathIncluded: false,
  };
  if (!thread.digest) thread.digest = digestFor("direct-work-thread-control-projection-row@1", thread);
  return thread;
}

function normalizeFullWorkThread(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const thread = buildWorkThread(source, options);
  const providedDigest = normalizeString(source.digest, "");
  return providedDigest ? { ...thread, digest: providedDigest } : thread;
}

function normalizeWorkThreads(input = {}, options = {}) {
  if (Array.isArray(input.workThreads)) return input.workThreads.map((thread) => normalizeFullWorkThread(thread, options));
  if (Array.isArray(input.rows)) return input.rows.map((thread) => projectionRowToControlThread(thread, options));
  if (Array.isArray(input.workThreadProjection?.rows)) return input.workThreadProjection.rows.map((thread) => projectionRowToControlThread(thread, options));
  if (Array.isArray(input.projection?.rows)) return input.projection.rows.map((thread) => projectionRowToControlThread(thread, options));
  return [];
}

function buildWorkThreadControlDeck(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const projectId = normalizeString(source.projectId, "");
  const workThreads = normalizeWorkThreads(source, options);
  const currentPointer = isPlainObject(source.currentPointer)
    ? buildCurrentWorkThreadPointer(source.currentPointer, options)
    : buildCurrentWorkThreadPointer({
        projectId,
        selectedWorkThreadId: source.selectedWorkThreadId,
        selectedWorkThreadDigest: source.selectedWorkThreadDigest,
        sourceKind: source.pointerSourceKind || "unknown",
        activeDirectSessionId: source.activeDirectSessionId,
        activeProviderThreadId: source.activeProviderThreadId,
        selectedProviderLane: source.selectedProviderLane,
        lastContextPackRef: source.lastContextPackRef,
        lastAuthorityTransitionRef: source.lastAuthorityTransitionRef,
        lastControlledRouteRef: source.lastControlledRouteRef,
        nonTargetPreservationConstraints: source.nonTargetPreservationConstraints,
        evidenceRefs: source.evidenceRefs,
      }, options);
  const context = {
    projectId,
    currentProjectId: normalizeString(source.currentProjectId, projectId),
    currentBranchName: normalizeString(source.currentBranchName || source.branchName, ""),
    currentWorkspaceEvidenceKey: normalizeString(source.currentWorkspaceEvidenceKey || source.workspaceEvidenceKey, ""),
    selectedProviderLane: normalizeString(
      source.selectedProviderLane
        || (currentPointer.selectedProviderLane === "unknown" ? "" : currentPointer.selectedProviderLane),
      "",
    ),
  };
  const rows = workThreads
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.workThreadId.localeCompare(b.workThreadId))
    .map((thread) => rowForThread(thread, currentPointer, context));
  const selectedRow = rows.find((row) => row.selected) || null;
  const selectedBlockers = selectedRow?.blockerCodes || [];
  const pointerState = pointerStateFor(selectedRow, selectedBlockers, currentPointer);
  const pointerIsSelected = pointerState === "selected";
  const blockerCodes = [
    ...selectedBlockers,
    ...(!currentPointer.selectedWorkThreadId ? ["current_work_thread_pointer_missing"] : []),
    ...(currentPointer.selectedWorkThreadId && !selectedRow ? ["selected_work_thread_not_found"] : []),
  ];
  const controlDeck = {
    schema: DIRECT_WORK_THREAD_CONTROL_DECK_SCHEMA,
    controlDeckId: normalizeString(source.controlDeckId, `work_thread_control_deck_${digestFor("direct-work-thread-control-deck-id@1", {
      projectId,
      pointerDigest: currentPointer.pointerDigest,
      rowDigests: rows.map((row) => row.rowDigest),
    }).slice(7, 31)}`),
    projectId,
    generatedAt: normalizeString(source.generatedAt, nowIso(options.nowMs)),
    currentPointer,
    pointerState: POINTER_STATES.has(pointerState) ? pointerState : "unknown",
    selectedWorkThreadId: pointerIsSelected ? selectedRow?.workThreadId || "" : "",
    selectedWorkThreadDigest: pointerIsSelected ? selectedRow?.digest || "" : "",
    rowCount: rows.length,
    activeCount: rows.filter((row) => row.lifecycleState === "active").length,
    staleCount: rows.filter((row) => row.stale).length,
    mismatchCount: rows.filter((row) => row.mismatch).length,
    blockedCount: rows.filter((row) => row.blockerCodes.length).length,
    rows,
    blockerCodes: [...new Set(blockerCodes)],
    nonTargetPreservationConstraints: currentPointer.nonTargetPreservationConstraints,
    selectionTransitionAvailable: true,
    providerCallAuthorityGranted: false,
    workspaceMutationAuthorityGranted: false,
    workerSpawnAuthorityGranted: false,
    appServerReplacementAuthorityGranted: false,
    rendererSafeSummary: pointerIsSelected && selectedRow
      ? `Selected WorkThread: ${selectedRow.title}`
      : "No current WorkThread is selected.",
    evidenceRefs: normalizeRefs([
      { kind: "work_thread_pointer", id: currentPointer.pointerId, digest: currentPointer.pointerDigest, label: "Current WorkThread pointer" },
      ...arrayOrEmpty(source.evidenceRefs),
    ], "work_thread_control_deck"),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  controlDeck.controlDeckDigest = digestFor("direct-work-thread-control-deck@1", controlDeck);
  return controlDeck;
}

function buildWorkThreadSelectionTransition(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const requestedWorkThreadId = normalizeString(source.requestedWorkThreadId || source.selectedWorkThreadId || source.workThreadId, "");
  const projectId = normalizeString(source.projectId, "");
  const workThreads = normalizeWorkThreads(source, options);
  const selectedThread = workThreads.find((thread) => thread.workThreadId === requestedWorkThreadId && (!projectId || thread.projectId === projectId)) || null;
  const blockerCodes = [];
  if (!requestedWorkThreadId) blockerCodes.push("requested_work_thread_missing");
  if (requestedWorkThreadId && !selectedThread) blockerCodes.push("requested_work_thread_not_found");
  if (selectedThread?.lifecycleState === "stale") blockerCodes.push("requested_work_thread_stale");
  if (selectedThread?.lifecycleState === "archived") blockerCodes.push("requested_work_thread_archived");
  const transitionState = blockerCodes.length ? "blocked" : "accepted";
  const selectedPointer = transitionState === "accepted"
    ? buildCurrentWorkThreadPointer({
        projectId: selectedThread.projectId || projectId,
        selectedWorkThreadId: selectedThread.workThreadId,
        selectedWorkThreadDigest: selectedThread.digest,
        sourceKind: "operator_selection",
        selectedBy: normalizeString(source.selectedBy, "operator"),
        activeDirectSessionId: source.activeDirectSessionId,
        activeProviderThreadId: source.activeProviderThreadId,
        selectedProviderLane: source.selectedProviderLane || selectedThread.activeRuntimePath,
        lastContextPackRef: source.lastContextPackRef || selectedThread.contextPacketRef,
        lastAuthorityTransitionRef: source.lastAuthorityTransitionRef,
        lastControlledRouteRef: source.lastControlledRouteRef,
        nonTargetPreservationConstraints: source.nonTargetPreservationConstraints || ["preserve_non_target_workthreads"],
        evidenceRefs: source.evidenceRefs,
      }, options)
    : null;
  const transition = {
    schema: DIRECT_WORK_THREAD_SELECTION_TRANSITION_SCHEMA,
    selectionTransitionId: normalizeString(source.selectionTransitionId, `work_thread_selection_${digestFor("direct-work-thread-selection-id@1", {
      projectId,
      requestedWorkThreadId,
      transitionState,
    }).slice(7, 31)}`),
    projectId,
    requestedWorkThreadId,
    selectedWorkThreadId: selectedPointer?.selectedWorkThreadId || "",
    transitionState: TRANSITION_STATES.has(transitionState) ? transitionState : "blocked",
    blockerCodes,
    previousPointerDigest: normalizeString(source.previousPointer?.pointerDigest || source.previousPointerDigest, ""),
    selectedPointer,
    providerCallAuthorityGranted: false,
    workspaceMutationAuthorityGranted: false,
    workerSpawnAuthorityGranted: false,
    appServerReplacementAuthorityGranted: false,
    createdAt: normalizeString(source.createdAt, nowIso(options.nowMs)),
    evidenceRefs: normalizeRefs(source.evidenceRefs, "work_thread_selection"),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  transition.selectionTransitionDigest = digestFor("direct-work-thread-selection-transition@1", transition);
  return transition;
}

function assertNoAuthorityLeak(value = {}, label = "work_thread_control") {
  for (const key of [
    "providerCallAuthorityGranted",
    "workspaceMutationAuthorityGranted",
    "workerSpawnAuthorityGranted",
    "appServerReplacementAuthorityGranted",
    "rawTextIncluded",
    "rawPathIncluded",
    "rawSecretIncluded",
  ]) {
    if (value[key] !== false) throw new Error(`${label}_authority_or_raw_leak:${key}`);
  }
}

function assertCurrentWorkThreadPointerSafe(pointer = {}) {
  if (!isPlainObject(pointer) || pointer.schema !== DIRECT_WORK_THREAD_CURRENT_POINTER_SCHEMA) throw new Error("direct_work_thread_current_pointer_schema_mismatch");
  assertNoAuthorityLeak(pointer, "direct_work_thread_current_pointer");
  if (!POINTER_SOURCE_KINDS.has(pointer.sourceKind)) throw new Error(`direct_work_thread_current_pointer_source_invalid:${pointer.sourceKind || ""}`);
  return true;
}

function assertWorkThreadControlDeckSafe(deck = {}) {
  if (!isPlainObject(deck) || deck.schema !== DIRECT_WORK_THREAD_CONTROL_DECK_SCHEMA) throw new Error("direct_work_thread_control_deck_schema_mismatch");
  assertCurrentWorkThreadPointerSafe(deck.currentPointer);
  assertNoAuthorityLeak(deck, "direct_work_thread_control_deck");
  if (!POINTER_STATES.has(deck.pointerState)) throw new Error(`direct_work_thread_control_deck_pointer_state_invalid:${deck.pointerState || ""}`);
  if (deck.pointerState !== "selected" && deck.selectedWorkThreadId) throw new Error("direct_work_thread_control_deck_selected_when_not_selected");
  for (const row of arrayOrEmpty(deck.rows)) {
    if (row.rawTextIncluded !== false || row.rawPathIncluded !== false) throw new Error("direct_work_thread_control_row_raw_exposure");
  }
  return true;
}

function assertWorkThreadSelectionTransitionSafe(transition = {}) {
  if (!isPlainObject(transition) || transition.schema !== DIRECT_WORK_THREAD_SELECTION_TRANSITION_SCHEMA) throw new Error("direct_work_thread_selection_transition_schema_mismatch");
  assertNoAuthorityLeak(transition, "direct_work_thread_selection_transition");
  if (!TRANSITION_STATES.has(transition.transitionState)) throw new Error(`direct_work_thread_selection_transition_state_invalid:${transition.transitionState || ""}`);
  if (transition.selectedPointer) assertCurrentWorkThreadPointerSafe(transition.selectedPointer);
  if (transition.transitionState !== "accepted" && transition.selectedWorkThreadId) throw new Error("direct_work_thread_selection_transition_selected_when_blocked");
  return true;
}

module.exports = {
  DIRECT_WORK_THREAD_CONTROL_DECK_SCHEMA,
  DIRECT_WORK_THREAD_CURRENT_POINTER_SCHEMA,
  DIRECT_WORK_THREAD_SELECTION_TRANSITION_SCHEMA,
  assertCurrentWorkThreadPointerSafe,
  assertWorkThreadControlDeckSafe,
  assertWorkThreadSelectionTransitionSafe,
  buildCurrentWorkThreadPointer,
  buildWorkThreadControlDeck,
  buildWorkThreadSelectionTransition,
};
