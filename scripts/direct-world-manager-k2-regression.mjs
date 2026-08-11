#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import {
  createSemanticIngressFixture,
} from "./fixtures/world-manager-semantic-ingress-fixture.mjs";

const require = createRequire(import.meta.url);
const {
  DirectWorldManagerControlPlaneStore,
} = require("../src/main/direct/worldmanager/control-plane-store");
const {
  DirectWorldManagerService,
} = require("../src/main/direct/worldmanager/service");

const rootDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "direct-world-manager-k2-"),
);
const projects = [
  {
    id: "project_alpha",
    name: "Project Alpha",
    summary: "Primary Direct runtime project.",
    runtimePath: "direct",
  },
  {
    id: "project_beta",
    name: "Project Beta",
    summary: "Voice bridge project with private project-scoped state.",
    runtimePath: "app_server",
  },
];
let tick = Date.parse("2026-07-26T12:00:00.000Z");
const now = () => {
  tick += 1_000;
  return tick;
};

function createService(activeProjectId = "project_beta") {
  return new DirectWorldManagerService({
    store: new DirectWorldManagerControlPlaneStore({ rootDir, now }),
    userWorldId: "user_world_k2_regression",
    projects,
    activeProjectId,
    semanticIngressRunner: createSemanticIngressFixture(),
    now,
  });
}

function request(service, clientRequestId, text, scopeHint = {}) {
  const projection = service.snapshot();
  return service.submit({
    schema: "direct_world_manager_submit_request@1",
    clientRequestId,
    text,
    scopeHint,
    expectedProjectionRevision: projection.projectionRevision,
    attachmentDraftRefs: [],
  });
}

let service = createService();
const initial = service.bootstrap().projection;
assert.equal(initial.pipelineStage, "wm_k3");
assert.equal(initial.lifecycleState, "idle");
assert.equal(initial.worldPosture.semanticSettlement, "available");
assert.equal(initial.worldPosture.worldmodelBindingState, "bound");
assert.equal(initial.worldPosture.providerRoleRuntime, "not_started");
assert.equal(initial.store.counts.graphBindingCount, 1);
assert.equal(initial.candidateArtifacts.length, 0);
assert.equal(initial.latestProposal, null);
assert.equal(initial.truthPosture.uiMintsAuthority, false);

// An explicit project binding is a constraint, not a suggestion: Alpha wins
// while ambient renderer focus remains Beta.
const exact = request(
  service,
  "k2_exact_alpha",
  "Plan the next five features.",
  {
    projectId: "project_alpha",
    bindingPosture: "explicit_constraint",
  },
);
assert.equal(exact.receipt.settlementState, "agent_world_ready");
assert.equal(exact.projection.activeProjectId, "project_beta");
assert.equal(
  exact.projection.evidence.latestSettlement.projectId,
  "project_alpha",
);
assert.equal(
  exact.projection.evidence.latestSettlement.settlementTier,
  "semantic",
);
assert.equal(
  exact.projection.evidence.latestSemanticIngress.primaryLane,
  "project_deliberation",
);
assert.equal(
  exact.projection.evidence.latestSemanticIngress.runState,
  "completed",
);
assert.equal(
  exact.projection.store.counts.semanticIngressRunCount,
  1,
);
assert.equal(
  exact.projection.evidence.latestSettlement.responsibleRole,
  "project_manager",
);
assert.equal(
  exact.projection.evidence.latestRoutingDecision.decision,
  "route",
);
assert.equal(
  exact.projection.evidence.latestManagerContext.providerRoleTurnState,
  "not_started",
);
assert.equal(
  exact.projection.evidence.latestManagerContext.contextAdmissionState,
  "deferred_to_k3",
);
assert.equal(exact.projection.messages[0].lineageState, "agent_world_ready");
assert.equal(exact.projection.latestProposal, null);
assert.equal(exact.projection.latestContract, null);

// Inspect the actual typed graph projection rather than the renderer summary.
const persistedExact = service.store.settlementForSemanticEvent(
  exact.receipt.semanticEventRef.id,
);
const rebuiltExact = service.worldmodel.buildManagerContext({
  taskSettlement: persistedExact.taskSettlement,
  ingressEnvelope: persistedExact.ingressEnvelope,
  targetResolution: persistedExact.targetResolution,
});
const foreignBetaNodeIds = new Set(
  service.worldmodel.graph.nodes
    .filter((node) => node.scope.projectId === "project_beta")
    .map((node) => node.nodeId),
);
assert.ok(foreignBetaNodeIds.size >= 2);
assert.equal(
  rebuiltExact.graphProjection.selectedNodeRefs.some((nodeRef) =>
    foreignBetaNodeIds.has(nodeRef.id)),
  false,
);
assert.equal(rebuiltExact.bootPacket.historicalTranscriptIncluded, false);
assert.equal(rebuiltExact.bootPacket.rawUnrelatedProjectStateIncluded, false);
assert.equal(rebuiltExact.bootPacket.grantsAuthority, false);

// The semantic ingress can settle an explicitly named configured project even
// without a renderer scope binding.
const smart = request(
  service,
  "k2_smart_alpha",
  "Review the current status of Project Alpha.",
  {},
);
assert.equal(smart.receipt.settlementState, "agent_world_ready");
assert.equal(smart.projection.evidence.latestSettlement.projectId, "project_alpha");
assert.equal(
  smart.projection.evidence.latestSettlement.settlementTier,
  "semantic",
);
assert.equal(smart.projection.evidence.latestSettlement.taskType, "project_review");

const reflective = request(
  service,
  "k2_reflective_focus",
  "Review the risks in this project.",
  {},
);
assert.equal(reflective.receipt.settlementState, "agent_world_ready");
assert.equal(
  reflective.projection.evidence.latestSettlement.projectId,
  "project_beta",
);
assert.equal(
  reflective.projection.evidence.latestSettlement.settlementTier,
  "semantic",
);

// A targeted clarification is a real round trip. The current user message can
// name Beta even while the renderer still carries Alpha as ambient focus.
const missingProject = request(
  service,
  "k2_missing_project",
  "Please review the next step.",
  {},
);
assert.equal(
  missingProject.receipt.settlementState,
  "clarification_required",
);
assert.deepEqual(
  missingProject.projection.evidence.latestSettlement.ambiguityReasons,
  ["project_scope_ambiguous"],
);
assert.equal(missingProject.projection.pendingDecisions.length, 1);
const clarificationReply = request(
  service,
  "k2_project_clarification_reply",
  "This is for Project Beta.",
  { projectId: "project_alpha" },
);
assert.equal(clarificationReply.receipt.settlementState, "agent_world_ready");
assert.equal(
  clarificationReply.projection.evidence.latestSettlement.projectId,
  "project_beta",
);
assert.equal(
  clarificationReply.projection.evidence.latestSemanticIngress
    .primaryLane,
  "project_deliberation",
);
assert.equal(clarificationReply.projection.pendingDecisions.length, 0);

// An affirmative word is not canonical admission and is not silently attached
// to the focused project or most recent manager context.
const ambiguousYes = request(
  service,
  "k2_ambiguous_yes",
  "yes",
  { projectId: "project_alpha" },
);
assert.equal(
  ambiguousYes.receipt.settlementState,
  "clarification_required",
);
assert.deepEqual(
  ambiguousYes.projection.evidence.latestSettlement.ambiguityReasons,
  ["admission_target_missing"],
);
assert.match(
  ambiguousYes.projection.evidence.latestSettlement.clarificationPrompt,
  /exact proposal or action/i,
);
assert.equal(
  ambiguousYes.projection.evidence.latestRoutingDecision.decision,
  "clarify",
);
assert.equal(ambiguousYes.projection.pendingDecisions.length, 1);
assert.equal(ambiguousYes.projection.candidateArtifacts.length, 0);
assert.equal(ambiguousYes.projection.latestProposal, null);
assert.equal(ambiguousYes.projection.latestContract, null);

const ledgerBeforeRestart = service.status().ledgerVerification;
assert.equal(ledgerBeforeRestart.ok, true);
assert.equal(service.status().roleRuntimeAvailable, false);
service.close();

// Restart reads the authoritative graph head, reconstructs profiles, policy,
// projection, and ManagerTurnBootPacket from typed K2 artifacts, and compares
// their receipt digests without replaying transcript text into manager context.
service = createService();
const restarted = service.bootstrap().projection;
const status = service.status();
assert.equal(status.restartContextVerification.valid, true);
assert.equal(status.restartContextVerification.checked, 4);
assert.equal(status.ledgerVerification.ok, true);
assert.equal(restarted.store.counts.managerContextCount, 4);
assert.equal(restarted.store.counts.agentWorldCompilationCount, 4);
assert.equal(restarted.store.counts.settlementCount, 6);
assert.equal(restarted.store.counts.semanticIngressRunCount, 6);
assert.equal(restarted.store.counts.routingDecisionCount, 6);
assert.equal(restarted.store.counts.candidateCount, 0);
assert.equal(restarted.connectionPosture.directRoleRuntime, "not_started");
assert.equal(restarted.omissionWitness.reason, "wm_k3_stops_before_role_runtime");

const exactAfterRestart = service.store.settlementForSemanticEvent(
  exact.receipt.semanticEventRef.id,
);
const rebuiltAfterRestart = service.worldmodel.buildManagerContext({
  taskSettlement: exactAfterRestart.taskSettlement,
  ingressEnvelope: exactAfterRestart.ingressEnvelope,
  targetResolution: exactAfterRestart.targetResolution,
}).contextBundle;
assert.equal(rebuiltAfterRestart.digest, rebuiltExact.contextBundle.digest);

// Duplicate renderer delivery returns the same lineage and settlement rather
// than rerunning any classifier or producing another context.
const reused = service.submit({
  schema: "direct_world_manager_submit_request@1",
  clientRequestId: "k2_exact_alpha",
  text: "Plan the next five features.",
  scopeHint: {
    projectId: "project_alpha",
    bindingPosture: "explicit_constraint",
  },
  expectedProjectionRevision: restarted.projectionRevision,
  attachmentDraftRefs: [],
});
assert.equal(reused.receipt.reused, true);
assert.equal(reused.receipt.semanticEventRef.id, exact.receipt.semanticEventRef.id);
assert.equal(reused.projection.store.counts.settlementCount, 6);
assert.equal(reused.projection.store.counts.managerContextCount, 4);

assert.throws(
  () =>
    service.submit({
      schema: "direct_world_manager_submit_request@1",
      clientRequestId: "k2_exact_alpha",
      text: "Different content under the same id.",
      scopeHint: { projectId: "project_alpha" },
      attachmentDraftRefs: [],
    }),
  (error) => error?.code === "world_manager_submit_idempotency_conflict",
);

const greeting = request(
  service,
  "k2_world_greeting",
  "hey",
  { projectId: "project_alpha" },
);
assert.equal(greeting.receipt.settlementState, "agent_world_ready");
assert.equal(
  greeting.projection.evidence.latestSettlement.taskType,
  "world_conversation",
);
assert.equal(
  greeting.projection.evidence.latestSettlement.projectId,
  "",
);
assert.equal(
  greeting.projection.evidence.latestSettlement.responsibleRole,
  "world_manager",
);
assert.equal(
  greeting.projection.evidence.latestSettlement.settlementTier,
  "semantic",
);
assert.equal(
  greeting.projection.evidence.latestAgentWorld.roleTemplateId,
  "world_manager.constitutional@1",
);
assert.equal(greeting.projection.activeProjectId, "project_beta");

service.close();
fs.rmSync(rootDir, { recursive: true, force: true });

console.log(
  JSON.stringify(
    {
      ok: true,
      regression: "direct-world-manager-k2",
      proofs: {
        foreignProjectNodesExcluded: true,
        explicitScopeWinsAmbientFocus: true,
        clarificationRoundTripResolves: true,
        ambiguousYesDoesNotAdmit: true,
        casualGreetingRemainsWithWorldManager: true,
        restartRebuildsContextWithoutTranscriptReplay: true,
      },
      roleRuntimeStarted: false,
      canonicalWriteGranted: false,
    },
    null,
    2,
  ),
);
