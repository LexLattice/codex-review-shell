#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DirectWorkThreadRegistryStore,
} = require("../src/main/direct/bridge/work-thread-registry");
const {
  DirectWorldManagerControlPlaneStore,
} = require("../src/main/direct/worldmanager/control-plane-store");
const {
  buildOpenDecision,
} = require("../src/main/direct/worldmanager/semantic-artifact-kernel");
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

const projectId = "project_k5b_semantic_admission";
const userWorldId = "user_world_k5b_semantic_admission";
const projects = [{
  id: projectId,
  name: "K5B Semantic Admission",
  summary: "Natural-language and control admission parity fixture.",
  runtimePath: "direct",
}];
let tick = Date.parse("2026-08-01T22:00:00.000Z");
const now = () => (tick += 1_000);

function typeExpression(label, mode = "freeform") {
  return {
    mode,
    existingTypeRef:
      mode === "existing_ref" ? label : "",
    proposedLabel: "",
    parentTypeRef: "",
    differentia: "",
    components: [],
    freeformCharacterization:
      mode === "freeform" ? label : "",
  };
}

function action(name, argumentsValue) {
  return {
    actionCalls: [{
      callId: `fixture_${name}`,
      name,
      argumentsJson: JSON.stringify(argumentsValue),
    }],
    telemetry: {
      runtimeMode: "deterministic_test_fixture",
      model: "semantic-fixture",
      reasoningEffort: "none",
      inputTokens: 0,
      outputTokens: 0,
      toolCallCount: 1,
      toolNames: [name],
      telemetrySource: "deterministic_fixture",
    },
  };
}

function planDecision(input) {
  return input.pendingDecisions.find((decision) =>
    decision.decisionKind === "plan_proposal_admission");
}

function authorizeAction(input, targetTransform = (value) => value) {
  const decision = planDecision(input);
  assert.ok(decision, "the semantic runner must receive the pending plan decision");
  return action("wm_discharge_decision_concern", {
    decisionId: decision.decisionRequestId,
    targetArtifactRef: targetTransform({
      ...decision.targetArtifactRef,
    }),
    resolutionMode: decision.resolutionMode,
    disposition: "authorize_exact_target",
    concernType: typeExpression(
      "exact plan-revision admission authorization",
    ),
    objective:
      "Authorize admission of the exact reviewed plan revision named by the pending decision.",
    requestedActions: [],
    anticipatedEffects: [],
    ambiguities: [],
    rationaleSummary:
      "The authenticated operator explicitly authorized the exact supplied plan target.",
  });
}

function clarificationAction() {
  return action("wm_discharge_clarification", {
    provisionalContract: typeExpression(
      "decision authorization",
      "existing_ref",
    ),
    unresolvedDimensions: [
      typeExpression("exact authorization target", "freeform"),
    ],
    clarificationObjective:
      "Establish which exact pending decision the affirmation concerns.",
    clarificationPrompt:
      "Which exact pending decision are you authorizing?",
    rationaleSummary:
      "Multiple pending decisions make an unqualified affirmation insufficient for exact authorization.",
  });
}

function semanticIngressRunner(input = {}) {
  if (input.clientRequestId === "ambiguous_yes") {
    return clarificationAction();
  }
  if (input.clientRequestId === "mismatched_target") {
    return authorizeAction(input, (target) => ({
      ...target,
      digest: digestFor("tampered-plan-target@1", target),
    }));
  }
  return authorizeAction(input);
}

function exactRef(kind, id) {
  return {
    kind,
    id,
    digest: digestFor(kind, { id }),
    projectId,
  };
}

function createStack(rootDir) {
  const store = new DirectWorldManagerControlPlaneStore({
    rootDir,
    now,
  });
  const workThreadStore = new DirectWorkThreadRegistryStore({
    rootDir: path.join(rootDir, "workthreads"),
    now,
  });
  const roleRuntime = {
    async run() {
      throw new Error(
        "k5b_authorization_must_not_invoke_a_manager_role_turn",
      );
    },
  };
  const service = new DirectWorldManagerService({
    store,
    workThreadStore,
    semanticIngressRunner,
    planProposalLifecycleEnabled: true,
    roleRuntime,
    userWorldId,
    projects,
    activeProjectId: projectId,
    now,
  });
  try {
    service.bootstrap();
  } catch (error) {
    error.restartContextVerification =
      service.restartContextVerification;
    error.restartAgentWorldVerification =
      service.restartAgentWorldVerification;
    throw error;
  }
  return { store, workThreadStore, service };
}

function registerProposal(stack, suffix, expectedCanonicalRevisionRefs = null) {
  const source = stack.store.appendUserIngress({
    schema: "direct_world_manager_submit_request@1",
    clientRequestId: `source_${suffix}`,
    text: `Provider-backed plan source ${suffix}`,
    scopeHint: {
      projectId,
      proposalId: "",
      workThreadId: "",
      bindingPosture: "explicit_constraint",
    },
    expectedProjectionRevision: null,
    attachmentDraftRefs: [],
  }).event;
  const proposal = buildPlanProposalRevision({
    projectId,
    revision: 1,
    title: `K5B proposal ${suffix}`,
    summary:
      "Create a canonical implementation contract without starting a worker.",
    proposalText:
      "The exact reviewed plan revision is the only admissible target.",
    features: [{
      featureId: `feature_${suffix}`,
      title: "Semantic admission parity",
      outcome:
        "Typed authorization and the Greenlight control share one service protocol.",
    }],
    semanticSummary:
      "The proposal is reconciled and ready for evidence review.",
    blindspots: [],
    continuationPaths: ["Review", "Admit exact revision"],
    recommendation: "Admit only the exact reviewed revision.",
    sourceAgentResultRef: exactRef(
      "agent_result",
      `agent_result_${suffix}`,
    ),
    sourceFinalMessageRef: exactRef(
      "final_assistant_message",
      `final_message_${suffix}`,
    ),
    sourceSemanticEventRef: {
      kind: "world_manager_semantic_event",
      id: source.semanticEventId,
      digest: source.eventDigest,
      projectId,
    },
    reconciliationRef: exactRef(
      "world_manager_reconciliation",
      `reconciliation_${suffix}`,
    ),
    expectedCanonicalRevisionRefs:
      expectedCanonicalRevisionRefs ||
      stack.service.worldmodel.canonicalArtifactRevisionRefs({
        kind: "project",
        projectId,
      }),
    createdAt: new Date(now()).toISOString(),
  });
  stack.store.registerPlanProposalRevision({ proposal });
  return proposal;
}

function submit(stack, clientRequestId, text) {
  return stack.service.submit({
    schema: "direct_world_manager_submit_request@1",
    clientRequestId,
    text,
    scopeHint: {
      projectId,
      proposalId: "",
      workThreadId: "",
      bindingPosture: "ambient_focus",
    },
    expectedProjectionRevision: null,
    attachmentDraftRefs: [],
  });
}

function addSecondPendingDecision(stack) {
  const decision = buildOpenDecision({
    sourceKind: "k5b_fixture",
    sourceKey: "second_pending_decision",
    semanticIdentity: "Choose a later verification posture",
    question: "Which verification posture should a later worker use?",
    scope: {
      kind: "project",
      userWorldId,
      projectId,
      taskType: "project_planning",
    },
    resolutionMode: "semantic_relay",
    now,
  });
  stack.store.transaction(() => {
    stack.store
      ._appendSemanticArtifactRevisionWithinTransaction(
        decision,
      );
    stack.store._rebuildSemanticShelvesWithinTransaction();
    stack.store.incrementRevision();
  });
  return decision;
}

function advanceProjectGraphOutsidePlan(stack, suffix) {
  const expected =
    stack.service.worldmodel.canonicalArtifactRevisionRefs({
      kind: "project",
      projectId,
    });
  const artifactRef = exactRef(
    "artifact_revision",
    `competing_artifact_${suffix}`,
  );
  const gateRef = exactRef(
    "artifact_gate_decision",
    `competing_gate_${suffix}`,
  );
  return stack.service.worldmodel.admitArtifactRevision({
    lifecycle: {
      lifecycleId: stableId("k5b_competing_lifecycle", {
        suffix,
      }),
      state: "admission_pending",
      digest: digestFor("k5b_competing_lifecycle@1", {
        suffix,
      }),
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
      targetAdmissionScope: {
        kind: "project",
        projectId,
      },
      assuranceGraphRef: gateRef,
    },
    expectedCanonicalRevisionRefs: expected,
    actorRef:
      stack.service.worldmodel
        .projectManagerAdmissionActorRef(projectId),
    issuedAt: new Date(now()).toISOString(),
  });
}

const rootDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "direct-world-manager-k5b-"),
);
let stack = createStack(rootDir);
const sharedAdmissionProtocol =
  stack.service.admitPlanProposal.bind(stack.service);
let sharedAdmissionProtocolCalls = 0;
stack.service.admitPlanProposal = (input) => {
  sharedAdmissionProtocolCalls += 1;
  return sharedAdmissionProtocol(input);
};
const proposal = registerProposal(stack, "primary");
addSecondPendingDecision(stack);

const ambiguous = submit(stack, "ambiguous_yes", "Yes.");
assert.equal(ambiguous.receipt.remanded, false);
assert.equal(
  ambiguous.receipt.settlementState,
  "clarification_required",
);
assert.equal(stack.store.listPlanAdmissions().length, 0);
assert.equal(stack.workThreadStore.listWorkThreads().length, 0);

const mismatched = submit(
  stack,
  "mismatched_target",
  "Greenlight the reviewed K5B proposal.",
);
assert.equal(mismatched.receipt.remanded, true);
assert.equal(
  mismatched.projection.evidence.latestSemanticIngress
    .outputValidationState,
  "remanded",
);
assert.equal(stack.store.listPlanAdmissions().length, 0);

assert.throws(
  () => submit(
    stack,
    "typed_authorize",
    "Greenlight the exact K5B plan revision now.",
  ),
  (error) =>
    error.code ===
      "world_manager_plan_proposal_evidence_not_reviewed",
);
assert.equal(stack.store.listPlanAdmissions().length, 0);
assert.equal(stack.workThreadStore.listWorkThreads().length, 0);

stack.service.inspectPlanProposal({
  proposalRevisionId: proposal.proposalRevisionId,
  proposalDigest: proposal.digest,
});
const admitted = submit(
  stack,
  "typed_authorize",
  "Greenlight the exact K5B plan revision now.",
);
assert.equal(admitted.receipt.settlementState, "contract_received");
assert.equal(
  admitted.receipt.semanticDisposition,
  "authorize_exact_target",
);
assert.equal(
  admitted.receipt.targetArtifactRef.id,
  proposal.proposalRevisionId,
);
assert.ok(admitted.receipt.planAdmissionDecisionRef?.id);
assert.ok(admitted.receipt.implementationContractRef?.id);
assert.ok(admitted.receipt.workThreadRef?.id);
assert.equal(admitted.receipt.implementationStarted, false);
assert.equal(admitted.receipt.grantsWorkerStartAuthority, false);
assert.equal(admitted.projection.latestProposal.state, "canonical");
assert.equal(admitted.projection.latestContract.state, "contract_received");
assert.equal(admitted.projection.latestWorkThread.lifecycleState,
  "contract_received");
assert.equal(stack.store.listAgentResults().length, 0);

const retried = submit(
  stack,
  "typed_authorize",
  "Greenlight the exact K5B plan revision now.",
);
assert.equal(retried.receipt.state, "reused");
assert.equal(
  retried.receipt.implementationContractRef.id,
  admitted.receipt.implementationContractRef.id,
);
assert.equal(
  retried.receipt.workThreadRef.id,
  admitted.receipt.workThreadRef.id,
);
assert.equal(stack.store.listPlanAdmissions().length, 1);
assert.equal(stack.workThreadStore.listWorkThreads().length, 1);
assert.equal(sharedAdmissionProtocolCalls, 3);

stack.store.close();
stack = createStack(rootDir);
const restarted = stack.service.snapshot();
assert.equal(restarted.latestProposal.state, "canonical");
assert.equal(restarted.latestContract.state, "contract_received");
assert.equal(restarted.latestWorkThread.lifecycleState, "contract_received");
assert.equal(stack.store.listPlanAdmissions().length, 1);
assert.equal(stack.workThreadStore.listWorkThreads().length, 1);

stack.store.close();
fs.rmSync(rootDir, { recursive: true, force: true });

const staleRootDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "direct-world-manager-k5b-stale-"),
);
const staleStack = createStack(staleRootDir);
const staleProposal = registerProposal(staleStack, "stale");
staleStack.service.inspectPlanProposal({
  proposalRevisionId:
    staleProposal.proposalRevisionId,
  proposalDigest: staleProposal.digest,
});
advanceProjectGraphOutsidePlan(staleStack, "stale");
assert.throws(
  () => submit(
    staleStack,
    "typed_stale_authorize",
    "Admit the exact reviewed stale-bound plan revision.",
  ),
  (error) => /stale/i.test(
    `${error.code || ""}:${error.message || ""}`,
  ),
);
assert.equal(
  staleStack.store.listPlanAdmissions().at(-1).state,
  "stale_conflict",
);
assert.equal(
  staleStack.workThreadStore.listWorkThreads().length,
  0,
);
staleStack.store.close();
fs.rmSync(staleRootDir, {
  recursive: true,
  force: true,
});

console.log(JSON.stringify({
  ok: true,
  regression: "direct-world-manager-k5b",
  proofs: {
    semanticDispositionBindsExactPendingDecision: true,
    ambiguousAffirmationCreatesNoAdmission: true,
    mismatchedTargetRemandsBeforeEffect: true,
    evidenceGateMatchesControlPath: true,
    staleCasCreatesNoWorkThread: true,
    semanticAndControlUseAdmitPlanProposal: true,
    noManagerRoleTurnForHarnessDisposition: true,
    contractReceivedDoesNotStartWorker: true,
    retryIsIdempotent: true,
    restartPreservesAdmissionLineage: true,
  },
}, null, 2));
