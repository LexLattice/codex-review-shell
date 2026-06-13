#!/usr/bin/env node

import { strict as assert } from "node:assert";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  assertDirectSettingsSurfaceRendererSafe,
  buildDirectSettingsSurfaceProjection,
} = require("../src/main/direct/ui/settings-surface");
const {
  buildWorkThread,
} = require("../src/main/direct/bridge/work-thread-registry");
const {
  assertCurrentWorkThreadPointerSafe,
  assertWorkThreadControlDeckSafe,
  assertWorkThreadSelectionTransitionSafe,
  buildCurrentWorkThreadPointer,
  buildWorkThreadControlDeck,
  buildWorkThreadSelectionTransition,
} = require("../src/main/direct/bridge/work-thread-control-deck");

const nowMs = Date.parse("2026-06-14T08:00:00.000Z");
const projectId = "codex-review-shell-direct";

function workThreadsFixture() {
  const selected = buildWorkThread({
    workThreadId: "work_thread_direct_bridge",
    projectId,
    title: "Direct information bridge",
    objective: "Make direct path operator-controllable through WorkThread identity.",
    branchIdentity: {
      branchName: "codex/direct-chatgpt-harness",
      branchEvidenceKey: "branch_direct_harness",
    },
    workspaceIdentity: {
      workspaceKind: "wsl",
      workspaceEvidenceKey: "workspace_direct",
      workspaceRoot: "/home/rose/private/not-exported",
    },
    activeRuntimePath: "direct-implementation",
    linkedCodexThreads: [{ threadId: "direct_codex_thread", title: "Direct work" }],
    linkedChatGptThreads: [{ threadId: "direct_gpt_thread", title: "Direct review" }],
    openObligations: [{ obligationId: "obl_pointer", kind: "control", status: "open", summary: "Expose current pointer." }],
  }, { nowMs });
  const stale = buildWorkThread({
    workThreadId: "work_thread_stale",
    projectId,
    title: "Stale direct side track",
    lifecycleState: "stale",
    branchIdentity: { branchName: "codex/old-branch", branchEvidenceKey: "branch_old" },
    workspaceIdentity: { workspaceKind: "wsl", workspaceEvidenceKey: "workspace_old" },
    activeRuntimePath: "direct-text",
  }, { nowMs: nowMs - 10_000 });
  const archived = buildWorkThread({
    workThreadId: "work_thread_archived",
    projectId,
    title: "Archived work",
    lifecycleState: "archived",
    branchIdentity: { branchName: "codex/direct-chatgpt-harness", branchEvidenceKey: "branch_direct_harness" },
    workspaceIdentity: { workspaceKind: "wsl", workspaceEvidenceKey: "workspace_direct" },
    activeRuntimePath: "direct-implementation",
  }, { nowMs: nowMs - 20_000 });
  return { selected, stale, archived, all: [selected, stale, archived] };
}

const fixture = workThreadsFixture();
const pointer = buildCurrentWorkThreadPointer({
  projectId,
  selectedWorkThreadId: fixture.selected.workThreadId,
  selectedWorkThreadDigest: fixture.selected.digest,
  sourceKind: "operator_selection",
  selectedBy: "operator",
  activeDirectSessionId: "direct_session_001",
  activeProviderThreadId: "provider_thread_001",
  selectedProviderLane: "direct-implementation",
  lastContextPackRef: { kind: "context_pack", id: "context_pack_001", digest: "sha256:context" },
  lastAuthorityTransitionRef: { kind: "authority_transition", id: "authority_transition_001", digest: "sha256:authority" },
  lastControlledRouteRef: { kind: "controlled_route", id: "controlled_route_001", digest: "sha256:route" },
  nonTargetPreservationConstraints: ["preserve_non_target_workthreads"],
}, { nowMs });
assertCurrentWorkThreadPointerSafe(pointer);
assert.equal(pointer.providerCallAuthorityGranted, false);
assert.equal(pointer.workspaceMutationAuthorityGranted, false);
assert.equal(pointer.rawPathIncluded, false);

const deck = buildWorkThreadControlDeck({
  projectId,
  workThreads: fixture.all,
  currentPointer: pointer,
  currentProjectId: projectId,
  currentBranchName: "codex/direct-chatgpt-harness",
  currentWorkspaceEvidenceKey: "workspace_direct",
  selectedProviderLane: "direct-implementation",
}, { nowMs });
assertWorkThreadControlDeckSafe(deck);
assert.equal(deck.schema, "direct_work_thread_control_deck@1");
assert.equal(deck.pointerState, "selected");
assert.equal(deck.selectedWorkThreadId, fixture.selected.workThreadId);
assert.equal(deck.rowCount, 3);
assert.equal(deck.activeCount, 1);
assert.equal(deck.staleCount, 1);
assert(deck.rows.find((row) => row.workThreadId === "work_thread_stale").blockerCodes.includes("work_thread_stale"));
assert(deck.rows.find((row) => row.workThreadId === "work_thread_stale").blockerCodes.includes("branch_mismatch"));
assert(deck.rows.find((row) => row.workThreadId === "work_thread_stale").blockerCodes.includes("workspace_mismatch"));
assert.equal(deck.providerCallAuthorityGranted, false);
assert.equal(deck.workspaceMutationAuthorityGranted, false);
assert.equal(deck.workerSpawnAuthorityGranted, false);
assert.equal(deck.appServerReplacementAuthorityGranted, false);

const stalePointerDeck = buildWorkThreadControlDeck({
  projectId,
  workThreads: fixture.all,
  selectedWorkThreadId: fixture.selected.workThreadId,
  selectedWorkThreadDigest: "sha256:stale",
  pointerSourceKind: "operator_selection",
  selectedProviderLane: "direct-implementation",
}, { nowMs });
assertWorkThreadControlDeckSafe(stalePointerDeck);
assert.equal(stalePointerDeck.pointerState, "stale");
assert.equal(stalePointerDeck.selectedWorkThreadId, "");
assert(stalePointerDeck.blockerCodes.includes("selected_work_thread_digest_mismatch"));

const projectionBackedDeck = buildWorkThreadControlDeck({
  projectId,
  workThreadProjection: {
    rows: [
      {
        workThreadId: fixture.selected.workThreadId,
        projectId,
        title: fixture.selected.title,
        lifecycleState: fixture.selected.lifecycleState,
        objectiveSummary: fixture.selected.objective.summary,
        currentArcLabel: fixture.selected.currentArc.label,
        phaseKind: fixture.selected.phaseState.phaseKind,
        phaseStatus: fixture.selected.phaseState.status,
        activeRuntimePath: fixture.selected.activeRuntimePath,
        openObligationCount: fixture.selected.openObligations.length,
        linkedCodexThreadCount: fixture.selected.linkedCodexThreads.length,
        linkedChatGptThreadCount: fixture.selected.linkedChatGptThreads.length,
        updatedAt: fixture.selected.updatedAt,
        digest: fixture.selected.digest,
      },
    ],
  },
  currentPointer: pointer,
  selectedProviderLane: "direct-implementation",
}, { nowMs });
assertWorkThreadControlDeckSafe(projectionBackedDeck);
assert.equal(projectionBackedDeck.pointerState, "selected");
assert.equal(projectionBackedDeck.selectedWorkThreadDigest, fixture.selected.digest);

const missingPointerDeck = buildWorkThreadControlDeck({
  projectId,
  workThreads: fixture.all,
}, { nowMs });
assertWorkThreadControlDeckSafe(missingPointerDeck);
assert.equal(missingPointerDeck.pointerState, "missing");
assert(missingPointerDeck.blockerCodes.includes("current_work_thread_pointer_missing"));

const selectionTransition = buildWorkThreadSelectionTransition({
  projectId,
  requestedWorkThreadId: fixture.selected.workThreadId,
  workThreads: fixture.all,
  previousPointer: pointer,
  selectedProviderLane: "direct-implementation",
  activeDirectSessionId: "direct_session_002",
}, { nowMs });
assertWorkThreadSelectionTransitionSafe(selectionTransition);
assert.equal(selectionTransition.transitionState, "accepted");
assert.equal(selectionTransition.selectedWorkThreadId, fixture.selected.workThreadId);
assert.equal(selectionTransition.selectedPointer.selectedWorkThreadDigest, fixture.selected.digest);
assert.equal(selectionTransition.providerCallAuthorityGranted, false);

const archivedTransition = buildWorkThreadSelectionTransition({
  projectId,
  requestedWorkThreadId: fixture.archived.workThreadId,
  workThreads: fixture.all,
}, { nowMs });
assertWorkThreadSelectionTransitionSafe(archivedTransition);
assert.equal(archivedTransition.transitionState, "blocked");
assert.equal(archivedTransition.selectedWorkThreadId, "");
assert(archivedTransition.blockerCodes.includes("requested_work_thread_archived"));

const staleTransition = buildWorkThreadSelectionTransition({
  projectId,
  requestedWorkThreadId: fixture.stale.workThreadId,
  workThreads: fixture.all,
}, { nowMs });
assertWorkThreadSelectionTransitionSafe(staleTransition);
assert.equal(staleTransition.transitionState, "blocked");
assert.equal(staleTransition.selectedWorkThreadId, "");
assert(staleTransition.blockerCodes.includes("requested_work_thread_stale"));

const crossProjectTransition = buildWorkThreadSelectionTransition({
  projectId,
  requestedWorkThreadId: fixture.selected.workThreadId,
  workThreads: [
    {
      ...fixture.selected,
      projectId: "other-project",
    },
  ],
}, { nowMs });
assertWorkThreadSelectionTransitionSafe(crossProjectTransition);
assert.equal(crossProjectTransition.transitionState, "blocked");
assert.equal(crossProjectTransition.selectedWorkThreadId, "");
assert(crossProjectTransition.blockerCodes.includes("requested_work_thread_not_found"));

const notFoundTransition = buildWorkThreadSelectionTransition({
  projectId,
  requestedWorkThreadId: "work_thread_missing",
  workThreads: fixture.all,
}, { nowMs });
assertWorkThreadSelectionTransitionSafe(notFoundTransition);
assert.equal(notFoundTransition.transitionState, "blocked");
assert(notFoundTransition.blockerCodes.includes("requested_work_thread_not_found"));

const settingsProjection = buildDirectSettingsSurfaceProjection({
  projectId,
  workThreadControlDeck: deck,
  workThreads: {
    projection: {
      schema: "direct_work_thread_projection@1",
      rowCount: 3,
      activeCount: 1,
      projectionDigest: "sha256:work_thread_projection",
    },
  },
}, { nowMs });
assertDirectSettingsSurfaceRendererSafe(settingsProjection);
assert(settingsProjection.bridgeOrgans.includes("work_thread_control"));
assert.equal(settingsProjection.sections.workThreadControl.available, true);
assert.equal(settingsProjection.sections.workThreadControl.pointerState, "selected");
assert.equal(settingsProjection.sections.workThreadControl.selectedWorkThreadId, fixture.selected.workThreadId);
assert.equal(settingsProjection.sections.workThreadControl.providerCallAuthorityGranted, false);
assert(settingsProjection.rows.workThreadControl.some((row) => row.label === "Pointer" && row.value === "selected"));
assert(settingsProjection.rows.workThreadControl.some((row) => row.label === "Authority" && row.value === "no grant"));

console.log(JSON.stringify({
  ok: true,
  deck: deck.controlDeckId,
  pointerState: deck.pointerState,
  selected: deck.selectedWorkThreadId,
  rows: deck.rowCount,
  stale: deck.staleCount,
  mismatch: deck.mismatchCount,
  selectionTransition: selectionTransition.transitionState,
  archivedTransition: archivedTransition.transitionState,
}, null, 2));
