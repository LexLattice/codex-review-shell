#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DirectWorldManagerControlPlaneStore,
} = require("../src/main/direct/worldmanager/control-plane-store");
const {
  DirectWorldManagerEpistemicFabricRuntime,
} = require("../src/main/direct/worldmanager/epistemic-fabric-runtime");
const {
  DirectWorldManagerService,
} = require("../src/main/direct/worldmanager/service");
const {
  digestFor,
} = require("../src/main/direct/worldmanager/artifact-lifecycle-kernel");

const rootDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "direct-world-manager-canonical-admission-"),
);
const projectId = "project_sc11_canonical_admission";
const userWorldId = "user_world_sc11_canonical_admission";
const projects = [{
  id: projectId,
  name: "SC11 Canonical Admission",
  summary: "Production trust-store admission fixture.",
  runtimePath: "direct",
}];
let tick = Date.parse("2026-08-01T18:00:00.000Z");
const now = () => (tick += 1_000);

function ref(kind, id, project = projectId) {
  return {
    kind,
    id,
    digest: digestFor(kind, { id, project }),
    ...(project ? { projectId: project } : {}),
  };
}

function createStack(options = {}) {
  const store = new DirectWorldManagerControlPlaneStore({ rootDir, now });
  let service = null;
  const fabric = new DirectWorldManagerEpistemicFabricRuntime({
    dbPath: store.dbPath,
    userWorldId,
    now,
    canonicalRevisionResolver: ({ targetAdmissionScope }) =>
      service.worldmodel.canonicalArtifactRevisionRefs(
        targetAdmissionScope,
      ),
    authorityAdapter: async (input) => {
      const result = service.worldmodel.admitArtifactRevision(input);
      if (
        options.crashAfterCanonicalCommit?.lifecycleId ===
          input.lifecycle.lifecycleId &&
        options.crashAfterCanonicalCommit.remaining > 0
      ) {
        options.crashAfterCanonicalCommit.remaining -= 1;
        const error = new Error(
          "simulated_crash_after_canonical_graph_commit",
        );
        error.code = "simulated_crash_after_canonical_graph_commit";
        throw error;
      }
      return result;
    },
  });
  service = new DirectWorldManagerService({
    store,
    epistemicFabric: fabric,
    userWorldId,
    projects,
    activeProjectId: projectId,
    now,
  });
  service.bootstrap();
  return { service, fabric };
}

function makeGateReady(fabric, suffix, workThreadId) {
  const activated = fabric.activateImplementationPatch({
    projectId,
    workThreadId,
    requestRef: ref("artifact_request", `request_${suffix}`),
    producerCandidates: [{
      agentRef: ref("agent", `implementation_worker_${suffix}`),
      agentRunRef: ref("agent_run", `implementation_run_${suffix}`),
      role: "implementation_worker",
      active: true,
      substrateAvailable: true,
      budgetAvailable: true,
      visibleProjectIds: [projectId],
      eligibleArtifactTypeIds: [`ImplementationPatch:${projectId}`],
      eligibilityReceiptRef: ref(
        "eligibility_receipt",
        `producer_eligible_${suffix}`,
      ),
    }],
  });
  fabric.publishArtifactRevision({
    lifecycleId: activated.lifecycle.lifecycleId,
    artifactId: `implementation_patch_${suffix}`,
    artifactContentRef: ref(
      "implementation_patch_body",
      `patch_body_${suffix}`,
    ),
    evidenceRefs: [
      ref("repository_after_digest", `repository_after_${suffix}`),
    ],
    settledProperties: {
      governedActionClasses: ["source_mutation"],
    },
  });
  const auditor = {
    agentRef: ref("agent", `review_auditor_${suffix}`),
    agentRunRef: ref("agent_run", `review_auditor_run_${suffix}`),
    role: "review_auditor",
    active: true,
    substrateAvailable: true,
    budgetAvailable: true,
    visibleProjectIds: [projectId],
    auditTypes: [
      "semantic_contract_conformance",
      "regression_preservation",
    ],
    independenceReceiptRef: ref(
      "independence_receipt",
      `auditor_independent_${suffix}`,
    ),
    boundedCapabilityNames: [
      "ledger.submit_audit_verdict",
      "ledger.request_evidence",
    ],
  };
  const routed = fabric.routeArtifactAudits({
    lifecycleId: activated.lifecycle.lifecycleId,
    auditorCandidates: [auditor],
  });
  for (const requirementId of [
    "source_digest_current",
    "focused_test_exit",
  ]) {
    fabric.joinMechanicalWitness({
      lifecycleId: activated.lifecycle.lifecycleId,
      requirementId,
      state: "supported",
      evidenceRefs: [
        ref("mechanical_witness", `${suffix}_${requirementId}_green`),
      ],
      freshnessWitnessRef: ref(
        "freshness_witness",
        `${suffix}_${requirementId}_fresh`,
      ),
    });
  }
  for (const assignment of routed.assignments) {
    fabric.submitAuditVerdict({
      lifecycleId: activated.lifecycle.lifecycleId,
      auditAssignmentId: assignment.auditAssignmentId,
      verdict: "supported",
      evidenceRefs: [
        ref("audit_evidence", `${suffix}_${assignment.requirementId}_green`),
      ],
      rendererSafeSummary: `${assignment.auditType} supported`,
    });
  }
  const evaluated = fabric.evaluateArtifactAssurance({
    lifecycleId: activated.lifecycle.lifecycleId,
    targetAdmissionScope: {
      kind: "workthread",
      projectId,
      workThreadId,
      taskType: "implementation",
    },
  });
  assert.equal(evaluated.lifecycle.state, "gate_ready");
  assert.equal(
    evaluated.admissionReceiptCandidate.expectedCanonicalRevisionRefs.length,
    1,
  );
  assert.equal(
    evaluated.admissionReceiptCandidate.expectedCanonicalRevisionRefs[0].kind,
    "worldmodel_scoped_revision",
  );
  return evaluated;
}

function scopeRevision(graph, scopeKind, workThreadId = "") {
  return graph.scopedRevisionRefs.find((entry) =>
    entry.scopeKind === scopeKind &&
    entry.projectId === projectId &&
    (entry.workThreadId || "") === workThreadId);
}

let stack = createStack();
const { service, fabric } = stack;
const sharedWorkThreadId = "workthread_shared_cas";
const gateA = makeGateReady(fabric, "cas_a", sharedWorkThreadId);
const gateB = makeGateReady(fabric, "cas_b", sharedWorkThreadId);
const projectRevisionBefore = scopeRevision(
  service.worldmodel.graph,
  "project",
).revision;
assert.equal(
  gateA.admissionReceiptCandidate.expectedCanonicalRevisionRefs[0].digest,
  gateB.admissionReceiptCandidate.expectedCanonicalRevisionRefs[0].digest,
  "both gate decisions must pin the same canonical scope revision",
);

const admittedA = await service.requestImplementationPatchAdmission({
  lifecycleId: gateA.lifecycle.lifecycleId,
});
assert.equal(admittedA.result.lifecycle.state, "admitted");
assert.equal(admittedA.result.receipt.receiptPosture, "admitted");
assert.equal(admittedA.result.receipt.canonicalEffect, true);
assert.equal(
  admittedA.result.receipt.trustStoreReceiptRef.kind,
  "worldmodel_graph_transition",
);
assert.equal(
  admittedA.result.receipt.canonicalGraphRef.kind,
  "hierarchical_worldmodel_graph",
);
assert.equal(
  scopeRevision(
    service.worldmodel.graph,
    "work_thread",
    sharedWorkThreadId,
  ).revision,
  1,
);
assert.equal(
  scopeRevision(service.worldmodel.graph, "project").revision,
  projectRevisionBefore,
  "work-thread admission must not imply project admission",
);
assert.ok(service.worldmodel.graph.nodes.some((node) =>
  node.structuredValue?.artifactRevisionRef?.id ===
    admittedA.result.receipt.artifactRevisionRef.id &&
  node.structuredValue?.canonicalAdmission === true &&
  node.structuredValue?.downstreamEffectsExecuted === false));

const staleB = await service.requestImplementationPatchAdmission({
  lifecycleId: gateB.lifecycle.lifecycleId,
});
assert.equal(staleB.result.lifecycle.state, "admission_pending");
assert.equal(staleB.result.receipt.receiptPosture, "stale_cas");
assert.equal(
  staleB.result.receipt.failureCode,
  "direct_sc11_artifact_admission_stale_cas",
);
assert.equal(staleB.result.receipt.canonicalEffect, false);
assert.equal(
  service.snapshot().epistemicFabric.lifecycleCards.find((card) =>
    card.lifecycleRef.id === gateB.lifecycle.lifecycleId)?.authorityState,
  "failed",
);
assert.equal(
  scopeRevision(
    service.worldmodel.graph,
    "work_thread",
    sharedWorkThreadId,
  ).revision,
  1,
);

const unauthorizedGate = makeGateReady(
  fabric,
  "unauthorized_actor",
  "workthread_unauthorized_actor",
);
const transitionCountBeforeUnauthorized =
  service.worldmodel.graph.transitions.length;
const unauthorized = await fabric.requestArtifactAdmission({
  lifecycleId: unauthorizedGate.lifecycle.lifecycleId,
  actorRef: ref("manager_agent", "forged_project_manager"),
});
assert.equal(unauthorized.lifecycle.state, "admission_pending");
assert.equal(unauthorized.receipt.receiptPosture, "failed");
assert.equal(
  unauthorized.receipt.failureCode,
  "direct_sc11_artifact_admission_actor_unauthorized",
);
assert.equal(unauthorized.receipt.canonicalEffect, false);
assert.equal(
  service.worldmodel.graph.transitions.length,
  transitionCountBeforeUnauthorized,
);

const crashWorkThreadId = "workthread_crash_reconciliation";
const crashGate = makeGateReady(
  fabric,
  "crash_reconciliation",
  crashWorkThreadId,
);
const crashControl = {
  lifecycleId: crashGate.lifecycle.lifecycleId,
  remaining: 1,
};
service.close();

stack = createStack({ crashAfterCanonicalCommit: crashControl });
const firstCrashAttempt =
  await stack.service.requestImplementationPatchAdmission({
    lifecycleId: crashGate.lifecycle.lifecycleId,
  });
assert.equal(firstCrashAttempt.result.lifecycle.state, "admission_pending");
assert.equal(firstCrashAttempt.result.receipt.receiptPosture, "failed");
assert.equal(
  firstCrashAttempt.result.receipt.failureCode,
  "simulated_crash_after_canonical_graph_commit",
);
assert.equal(firstCrashAttempt.result.receipt.trustStoreReceiptRef, undefined);
assert.ok(stack.service.worldmodel.graph.nodes.some((node) =>
  node.structuredValue?.artifactRevisionRef?.id ===
    firstCrashAttempt.result.receipt.artifactRevisionRef.id));
const graphTransitionCountAfterCrash =
  stack.service.worldmodel.graph.transitions.length;

const reconciled = await stack.service.requestImplementationPatchAdmission({
  lifecycleId: crashGate.lifecycle.lifecycleId,
});
assert.equal(reconciled.result.lifecycle.state, "admitted");
assert.equal(reconciled.result.receipt.receiptPosture, "admitted");
assert.equal(
  stack.service.worldmodel.graph.transitions.length,
  graphTransitionCountAfterCrash,
  "retry must reuse the exact committed graph transition",
);
assert.equal(
  scopeRevision(
    stack.service.worldmodel.graph,
    "work_thread",
    crashWorkThreadId,
  ).revision,
  1,
);
const reconciledAgain =
  await stack.service.requestImplementationPatchAdmission({
    lifecycleId: crashGate.lifecycle.lifecycleId,
  });
assert.equal(reconciledAgain.result.reused, true);
assert.equal(
  reconciledAgain.result.receipt.digest,
  reconciled.result.receipt.digest,
);

const admittedLifecycleId = gateA.lifecycle.lifecycleId;
const admittedReceiptDigest = admittedA.result.receipt.digest;
stack.service.close();
stack = createStack();
const restartedCard = stack.service.snapshot()
  .epistemicFabric.lifecycleCards.find((card) =>
    card.lifecycleRef.id === admittedLifecycleId);
assert.equal(restartedCard.state, "admitted");
assert.equal(restartedCard.receiptBackedCanonical, true);
assert.equal(restartedCard.admissionReceiptRef.digest, admittedReceiptDigest);
assert.ok(stack.service.worldmodel.graph.nodes.some((node) =>
  node.structuredValue?.artifactRevisionRef?.id ===
    restartedCard.currentArtifactRevisionRef.id));
stack.service.close();

console.log("direct-world-manager-canonical-admission-regression: ok");
