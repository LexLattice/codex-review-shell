import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DirectWorldManagerSemanticCoordinator,
  DirectWorldManagerSemanticStore,
  assertSemanticMockupProjectionSafe,
  deterministicSemanticRoleRunner,
} = require("../src/main/direct/worldmanager/semantic-mockup");

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "world-manager-semantic-mockup-"));
const transitions = [];
const coordinator = new DirectWorldManagerSemanticCoordinator({
  store: new DirectWorldManagerSemanticStore({ rootDir }),
  projects: [
    { id: "direct_runtime", name: "Direct Runtime", summary: "Build the controlled Direct path." },
    { id: "voice_bridge", name: "Voice Bridge", summary: "Background capability research." },
    { id: "archive", name: "Archive", summary: "Inactive historical project." },
  ],
  activeProjectId: "direct_runtime",
  roleRunner: async (input) => deterministicSemanticRoleRunner(input),
  onTransition: async ({ reason, projection }) => {
    assertSemanticMockupProjectionSafe(projection);
    transitions.push({
      reason,
      lifecycleState: projection.lifecycleState,
      messageCount: projection.messages.length,
      reconciliationState: projection.reconciliation.state,
    });
  },
});

const initial = coordinator.snapshot();
assert.equal(initial.lifecycleState, "idle");
assert.equal(initial.projects[0].activityState, "active");
assert.equal(initial.projects[1].activityState, "semi_active");
assert.equal(initial.projects[2].activityState, "inactive");
assert.equal(initial.truthPosture.uiMayMintAuthority, false);

const candidate = await coordinator.submitPlanningMessage({
  text: "Plan the next five features for the WorldManager semantic slice.",
  projectId: "direct_runtime",
  mode: "fixture",
});
assert.equal(candidate.lifecycleState, "candidate_ready");
assert.equal(candidate.latestProposal.state, "candidate");
assert.equal(candidate.latestProposal.reconciliationState, "reconciled");
assert.equal(candidate.latestProposal.evidenceReviewState, "unreviewed");
assert.equal(candidate.truthPosture.candidateIsCanonical, false);
assert.equal(candidate.messages.length, 2);
assert.equal(candidate.messages[1].authorRole, "project_manager");
assert.match(candidate.messages[1].text, /semantic slice/i);
assert.equal(candidate.evidence.projectManagerResult.renderedToUser, true);
assert.equal(candidate.evidence.projectManagerResult.relayedToWorldManager, true);
assert.equal(candidate.evidence.projectManagerInstantiation.authorityEnvelope.mayAdmitCanonicalState, false);
assert.equal(candidate.evidence.projectManagerInstantiation.capabilityEnvelope.workspaceMutation, false);
assert.ok(candidate.semanticLineage.some((event) => event.eventKind === "task_settled"));
assert.ok(candidate.semanticLineage.some((event) => event.eventKind === "agent_instantiated"));
assert.ok(candidate.semanticLineage.some((event) => event.eventKind === "proposal_reconciled"));
assert.ok(
  transitions.findIndex((transition) => transition.reason === "project_manager_result_visible") <
    transitions.findIndex((transition) => transition.reason === "reconciliation_completed"),
  "Project Manager result must become visible before WorldManager reconciliation completes.",
);

await assert.rejects(
  () => coordinator.admitProposal({ proposalId: candidate.latestProposal.proposalId }),
  (error) => error?.code === "proposal_evidence_not_reviewed",
);

const reviewed = await coordinator.inspectProposal({ proposalId: candidate.latestProposal.proposalId });
assert.equal(reviewed.latestProposal.state, "candidate");
assert.equal(reviewed.latestProposal.evidenceReviewState, "reviewed");
assert.equal(reviewed.latestContract, null);

const admitted = await coordinator.admitProposal({
  proposalId: candidate.latestProposal.proposalId,
  actorId: "operator_fixture",
});
assert.equal(admitted.projection.lifecycleState, "implementation_active");
assert.equal(admitted.projection.latestProposal.state, "canonical");
assert.equal(admitted.projection.latestContract.state, "active");
assert.equal(admitted.projection.latestWorkThread.state, "active");
assert.equal(admitted.projection.latestWorkThread.phase, "contract_received");
assert.equal(admitted.projection.truthPosture.activityIsCompletion, false);
assert.match(admitted.projection.latestWorkThread.statusLabel, /no completion claimed/i);
assert.equal(admitted.implementationContract.authority.admissionKind, "explicit_greenlight");
assert.equal(admitted.implementationContract.authority.remoteMutationAllowed, false);
assertSemanticMockupProjectionSafe(admitted.projection);

const reloaded = new DirectWorldManagerSemanticCoordinator({
  store: new DirectWorldManagerSemanticStore({ rootDir }),
});
const persisted = reloaded.snapshot();
assert.equal(persisted.latestProposal.state, "canonical");
assert.equal(persisted.latestContract.implementationContractId, admitted.implementationContract.implementationContractId);
assert.equal(persisted.latestWorkThread.workThreadId, admitted.workThread.workThreadId);

const failing = new DirectWorldManagerSemanticCoordinator({
  roleRunner: async () => ({ outputText: "not structured" }),
});
await assert.rejects(
  () => failing.submitPlanningMessage({ text: "Plan this project." }),
  (error) => error?.code === "semantic_role_result_invalid",
);
const failedProjection = failing.snapshot();
assert.equal(failedProjection.lifecycleState, "failed");
assert.equal(failedProjection.truthPosture.candidateIsCanonical, false);
assert.ok(failedProjection.semanticLineage.some((event) => event.eventKind === "semantic_operation_failed"));

fs.rmSync(rootDir, { recursive: true, force: true });
console.log(JSON.stringify({
  ok: true,
  regression: "direct-world-manager-semantic-mockup",
  transitionOrder: transitions.map((transition) => transition.reason),
  finalState: admitted.projection.lifecycleState,
  semanticEventCount: admitted.projection.semanticLineage.length,
}, null, 2));
