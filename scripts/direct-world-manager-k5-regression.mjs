#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DirectWorkThreadRegistryStore,
} = require("../src/main/direct/bridge/work-thread-registry");
const {
  DirectWorldManagerControlPlaneStore,
} = require("../src/main/direct/worldmanager/control-plane-store");
const {
  buildPlanProposalRevision,
  planProposalRef,
} = require("../src/main/direct/worldmanager/plan-proposal-lifecycle");
const {
  DirectWorldManagerService,
} = require("../src/main/direct/worldmanager/service");
const {
  digestFor,
  stableId,
} = require("../src/main/direct/worldmanager/control-plane");

const rootDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "direct-world-manager-k5-"),
);
const projectId = "project_k5_planning";
const userWorldId = "user_world_k5_planning";
const projects = [{
  id: projectId,
  name: "K5 Planning",
  summary: "Proposal admission regression fixture.",
  runtimePath: "direct",
}];
let tick = Date.parse("2026-08-01T20:00:00.000Z");
const now = () => (tick += 1_000);

const integratedProjectionPath = path.join(
  rootDir,
  "integrated-provider-plan-projection.json",
);
const integratedProviderRun = spawnSync(process.execPath, [
  path.resolve("scripts/direct-world-manager-k4-regression.mjs"),
], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    CODEX_WORLD_MANAGER_K5_INTEGRATION: "1",
    CODEX_WORLD_MANAGER_K5_INTEGRATION_PROJECTION_PATH:
      integratedProjectionPath,
  },
  encoding: "utf8",
});
assert.equal(
  integratedProviderRun.status,
  0,
  integratedProviderRun.stderr || integratedProviderRun.stdout,
);
const integratedProjection = JSON.parse(
  fs.readFileSync(integratedProjectionPath, "utf8"),
);
assert.equal(integratedProjection.pipelineStage, "wm_k5_planning");
assert.equal(integratedProjection.latestProposal.state, "candidate");
assert.equal(integratedProjection.latestProposal.features.length, 5);

function createStack() {
  const store = new DirectWorldManagerControlPlaneStore({ rootDir, now });
  const workThreadStore = new DirectWorkThreadRegistryStore({
    rootDir: path.join(rootDir, "workthreads"),
    now,
  });
  const service = new DirectWorldManagerService({
    store,
    workThreadStore,
    planProposalLifecycleEnabled: true,
    roleRuntime: {},
    userWorldId,
    projects,
    activeProjectId: projectId,
    now,
  });
  service.bootstrap();
  return { store, workThreadStore, service };
}

function exactRef(kind, id, body = {}) {
  return { kind, id, digest: digestFor(kind, { id, ...body }), projectId };
}

function sourceEvent(store, suffix) {
  return store.appendUserIngress({
    schema: "direct_world_manager_submit_request@1",
    clientRequestId: `client_k5_${suffix}`,
    text: `Plan refinement ${suffix}`,
    scopeHint: {
      projectId,
      proposalId: "",
      workThreadId: "",
      bindingPosture: "explicit_constraint",
    },
    expectedProjectionRevision: null,
    attachmentDraftRefs: [],
  }).event;
}

function proposalFor(stack, suffix, revision, parent = null) {
  const event = sourceEvent(stack.store, suffix);
  return buildPlanProposalRevision({
    projectId,
    proposalLineageId: parent?.proposalLineageId,
    revision,
    parentProposalRevisionRef: parent ? planProposalRef(parent) : null,
    title: "Admit the keyboard planning pipeline",
    summary: `Reconciled plan revision ${revision}`,
    proposalText: `Revision ${revision} preserves lineage and adds a bounded delivery step.`,
    features: [{
      featureId: `feature_${revision}`,
      title: `Bounded delivery ${revision}`,
      outcome: "A contract exists before any worker starts.",
    }],
    semanticSummary: `Plan revision ${revision} is coherent and bounded.`,
    blindspots: [],
    continuationPaths: ["Review evidence", "Admit exact revision"],
    recommendation: "Admit only after exact evidence review.",
    sourceAgentResultRef: exactRef("agent_result", `agent_result_${suffix}`),
    sourceFinalMessageRef: exactRef("final_assistant_message", `message_${suffix}`),
    sourceSemanticEventRef: {
      kind: "world_manager_semantic_event",
      id: event.semanticEventId,
      digest: event.eventDigest,
      projectId,
    },
    reconciliationRef: exactRef("world_manager_reconciliation", `reconciliation_${suffix}`),
    expectedCanonicalRevisionRefs:
      stack.service.worldmodel.canonicalArtifactRevisionRefs({
        kind: "project",
        projectId,
      }),
    createdAt: new Date(now()).toISOString(),
  });
}

function competingProjectAdmission(service) {
  const expected = service.worldmodel.canonicalArtifactRevisionRefs({
    kind: "project",
    projectId,
  });
  const suffix = "competing";
  const artifactRef = exactRef("artifact_revision", `artifact_${suffix}`);
  const gateRef = exactRef("artifact_gate_decision", `gate_${suffix}`);
  return service.worldmodel.admitArtifactRevision({
    lifecycle: {
      lifecycleId: `lifecycle_${suffix}`,
      state: "admission_pending",
      digest: digestFor("lifecycle", { suffix }),
      createdAt: new Date(now()).toISOString(),
      updatedAt: new Date(now()).toISOString(),
    },
    artifactRevision: {
      artifactRevisionId: artifactRef.id,
      artifactDigest: artifactRef.digest,
      artifactTypeId: "CompetingProjectDecision",
      revision: 1,
      artifactContentRef: artifactRef,
    },
    gateDecision: {
      gateDecisionId: gateRef.id,
      decisionState: "gate_ready",
      digest: gateRef.digest,
      targetAdmissionScope: { kind: "project", projectId },
      assuranceGraphRef: exactRef("assurance_graph", `assurance_${suffix}`),
    },
    expectedCanonicalRevisionRefs: expected,
    actorRef: service.worldmodel.projectManagerAdmissionActorRef(projectId),
    issuedAt: new Date(now()).toISOString(),
  });
}

let stack = createStack();
const v1 = proposalFor(stack, "v1", 1);
stack.store.registerPlanProposalRevision({ proposal: v1 });
const frozenV1Digest = v1.digest;
const frozenV1Text = v1.proposalText;

const v2 = proposalFor(stack, "v2", 2, v1);
stack.store.registerPlanProposalRevision({ proposal: v2 });
assert.equal(
  stack.store.planProposalRevisionById(v1.proposalRevisionId).supersededById,
  v2.proposalRevisionId,
);
const rereadV1 = stack.store.planProposalRevisionById(v1.proposalRevisionId);
assert.equal(rereadV1.digest, frozenV1Digest);
assert.equal(rereadV1.proposalText, frozenV1Text);

stack.service.inspectPlanProposal({
  proposalRevisionId: v2.proposalRevisionId,
  proposalDigest: v2.digest,
});
if (process.env.CODEX_WORLD_MANAGER_K5_CANDIDATE_PROJECTION_PATH) {
  fs.writeFileSync(
    process.env.CODEX_WORLD_MANAGER_K5_CANDIDATE_PROJECTION_PATH,
    `${JSON.stringify(stack.service.snapshot(), null, 2)}\n`,
  );
}
competingProjectAdmission(stack.service);
const workThreadCountBeforeStale = stack.workThreadStore.listWorkThreads().length;
assert.throws(() => stack.service.admitPlanProposal({
  proposalRevisionId: v2.proposalRevisionId,
  proposalDigest: v2.digest,
}), /stale/i);
assert.equal(
  stack.workThreadStore.listWorkThreads().length,
  workThreadCountBeforeStale,
  "a failed graph CAS must not create a WorkThread",
);
assert.equal(
  stack.store.listPlanAdmissions().at(-1).state,
  "stale_conflict",
);

// The stale v2 remains current and must be explicitly superseded by v3.
const eventV3 = sourceEvent(stack.store, "v3");
const currentRevisionRefs =
  stack.service.worldmodel.canonicalArtifactRevisionRefs({ kind: "project", projectId });
const v3Refinement = buildPlanProposalRevision({
  projectId,
  proposalLineageId: v2.proposalLineageId,
  revision: 3,
  parentProposalRevisionRef: planProposalRef(v2),
  title: v2.title,
  summary: "Reconciled plan revision 3 after reprojection",
  proposalText: "Revision 3 is rebound to the current canonical project scope.",
  features: v2.features,
  semanticSummary: "The stale proposal was reprojected and reconciled.",
  blindspots: [],
  continuationPaths: ["Admit exact revision 3"],
  recommendation: "Review and admit revision 3.",
  sourceAgentResultRef: exactRef("agent_result", "agent_result_v3"),
  sourceFinalMessageRef: exactRef("final_assistant_message", "message_v3"),
  sourceSemanticEventRef: {
    kind: "world_manager_semantic_event",
    id: eventV3.semanticEventId,
    digest: eventV3.eventDigest,
    projectId,
  },
  reconciliationRef: exactRef("world_manager_reconciliation", "reconciliation_v3"),
  expectedCanonicalRevisionRefs: currentRevisionRefs,
  createdAt: new Date(now()).toISOString(),
});
stack.store.registerPlanProposalRevision({ proposal: v3Refinement });
stack.service.inspectPlanProposal({
  proposalRevisionId: v3Refinement.proposalRevisionId,
  proposalDigest: v3Refinement.digest,
});
const admitted = stack.service.admitPlanProposal({
  proposalRevisionId: v3Refinement.proposalRevisionId,
  proposalDigest: v3Refinement.digest,
});
assert.equal(admitted.contract.state, "contract_received");
assert.equal(admitted.workThread.lifecycleState, "contract_received");
assert.equal(admitted.contract.authority.workerStartAuthorized, false);
assert.equal(stack.service.snapshot().pipelineStage, "wm_k5_planning");
assert.equal(stack.service.snapshot().latestProposal.state, "canonical");
assert.equal(stack.service.snapshot().latestContract.state, "contract_received");
const repeated = stack.service.admitPlanProposal({
  proposalRevisionId: v3Refinement.proposalRevisionId,
  proposalDigest: v3Refinement.digest,
});
assert.equal(repeated.projection.latestContract.implementationContractId,
  admitted.contract.implementationContractId);
assert.equal(stack.workThreadStore.listWorkThreads().length, 1);

const repairProposal = proposalFor(stack, "repair", 1);
stack.store.registerPlanProposalRevision({ proposal: repairProposal });
stack.service.inspectPlanProposal({
  proposalRevisionId: repairProposal.proposalRevisionId,
  proposalDigest: repairProposal.digest,
});
const durableWorkThreadStore = stack.workThreadStore;
stack.service.workThreadStore = {
  upsertWorkThread() {
    const error = new Error("simulated_work_thread_store_failure");
    error.code = "simulated_work_thread_store_failure";
    throw error;
  },
};
assert.throws(() => stack.service.admitPlanProposal({
  proposalRevisionId: repairProposal.proposalRevisionId,
  proposalDigest: repairProposal.digest,
}), /simulated_work_thread_store_failure/);
assert.equal(stack.store.listPlanAdmissions().at(-1).state, "pending_repair");
stack.service.workThreadStore = durableWorkThreadStore;
stack.service.recoverPlanProposalAdmissions();
const repairedAdmission = stack.store.listPlanAdmissions().at(-1);
const repairedContract = stack.store.listImplementationContracts().at(-1);
assert.equal(repairedAdmission.state, "contract_received");
assert.equal(
  durableWorkThreadStore.readWorkThread(repairedAdmission.workThreadId).lifecycleState,
  "contract_received",
);

stack.store.close();
stack = createStack();
const restartedProjection = stack.service.snapshot();
assert.equal(restartedProjection.latestProposal.proposalRevisionId, repairProposal.proposalRevisionId);
assert.equal(restartedProjection.latestContract.implementationContractId, repairedContract.implementationContractId);
assert.equal(restartedProjection.latestWorkThread.lifecycleState, "contract_received");
if (process.env.CODEX_WORLD_MANAGER_K5_ADMITTED_PROJECTION_PATH) {
  fs.writeFileSync(
    process.env.CODEX_WORLD_MANAGER_K5_ADMITTED_PROJECTION_PATH,
    `${JSON.stringify(restartedProjection, null, 2)}\n`,
  );
}

console.log(JSON.stringify({
  ok: true,
  regression: "direct-world-manager-k5",
  proofs: {
    revisionLineagePreserved: true,
    reconciledProviderPlanRegistersSemanticAction: true,
    reconciliationWithoutRegistrationActionCreatesNoRevision: true,
    candidateNotCanonicalBeforeAdmission: true,
    exactScopeCasBlocksStaleProposal: true,
    staleCasCreatesNoWorkThread: true,
    canonicalGraphTransitionPersisted: true,
    implementationContractPersisted: true,
    workThreadStopsAtContractReceived: true,
    postGraphWorkThreadFailureRecoversIdempotently: true,
    restartPreservesAdmissionLineage: true,
  },
}, null, 2));
