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
  buildDirectWorkerStartTransition,
  validateDirectWorkerStartTransition,
} = require("../src/main/direct/bridge/worker-start");
const {
  DirectWorldManagerControlPlaneStore,
} = require("../src/main/direct/worldmanager/control-plane-store");
const {
  buildPlanProposalRevision,
} = require("../src/main/direct/worldmanager/plan-proposal-lifecycle");
const {
  DirectWorldManagerService,
} = require("../src/main/direct/worldmanager/service");
const {
  buildPlanExecutionAuthorization,
  revisePlanExecutionRecord,
} = require("../src/main/direct/worldmanager/plan-execution-continuation");
const {
  PLAN_EXECUTION_CLOSURE_ACTION,
  DirectPlanExecutionClosureRuntime,
  buildPlanExecutionClosureAssessment,
} = require("../src/main/direct/worldmanager/plan-execution-closure-runtime");
const {
  digestFor,
} = require("../src/main/direct/worldmanager/control-plane");

const rootDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "direct-world-manager-k6-execution-"),
);
const projectId = "project_k6_execution";
const userWorldId = "user_world_k6_execution";
const projects = [{
  id: projectId,
  name: "K6 Execution",
  summary: "Planning-to-execution continuation regression fixture.",
  runtimePath: "direct",
}];
let tick = Date.parse("2026-08-11T08:00:00.000Z");
const now = () => (tick += 1_000);

function exactRef(kind, id, body = {}) {
  return {
    kind,
    id,
    digest: digestFor(`k6-regression-${kind}@1`, { id, ...body }),
    projectId,
  };
}

const runtimeEvidenceRefs = [
  exactRef("direct_worker_turn", "worker_turn_fixture"),
  exactRef("direct_tool_result", "focused_tests_fixture"),
  exactRef("direct_tool_result", "workspace_patch_fixture"),
];

let closureRunnerRequest = null;
const closureRuntime = new DirectPlanExecutionClosureRuntime({
  runner: async (request) => {
    closureRunnerRequest = request;
    return {
      actionCalls: [{
        name: PLAN_EXECUTION_CLOSURE_ACTION,
        argumentsJson: JSON.stringify({
          assessments: [{
            criterion: "Focused tests pass",
            standing: "satisfied",
            evidenceRefIds: [
              runtimeEvidenceRefs[1].id,
              "invented_evidence_ref",
            ],
            semanticSummary: "The focused-test result supports this criterion.",
          }, {
            criterion: "Patch matches the contract",
            standing: "satisfied",
            evidenceRefIds: ["invented_evidence_ref"],
            semanticSummary: "The claimed patch evidence is not in the catalog.",
          }],
          overallSummary: "One criterion is witnessed and one remains unproved.",
          continuationPaths: ["Acquire exact patch evidence"],
        }),
      }],
      telemetry: {
        model: "fixture-project-manager",
        reasoningEffort: "medium",
      },
    };
  },
});
const directClosureAssessment = await closureRuntime.evaluate({
  projectId,
  implementationContractRef: exactRef(
    "implementation_contract",
    "implementation_contract_closure_fixture",
  ),
  workThreadRef: exactRef("work_thread", "work_thread_closure_fixture"),
  objective: "Prove the governed implementation closure path.",
  deliverables: ["A tested patch"],
  completionCriteria: [
    "Focused tests pass",
    "Patch matches the contract",
  ],
  finalAssistantText: "Implementation and focused tests completed.",
  runtimeEvidenceRefs,
});
assert.equal(closureRunnerRequest.toolChoicePolicy, "required");
assert.equal(closureRunnerRequest.workspaceMutationEffect, false);
assert.equal(closureRunnerRequest.canonicalAdmissionEffect, false);
assert.equal(directClosureAssessment.semanticAssessmentOnly, true);
assert.equal(directClosureAssessment.closureCertified, false);
assert.equal(directClosureAssessment.grantsAuthority, false);
assert.deepEqual(
  directClosureAssessment.criterionWitnesses[0].evidenceRefs,
  [runtimeEvidenceRefs[1]],
  "the assessor may bind only evidence present in the exact runtime catalog",
);
assert.deepEqual(
  directClosureAssessment.criterionWitnesses[1].evidenceRefs,
  [],
  "an invented evidence id must fail closed instead of witnessing closure",
);

let stack = null;
let providerStartCount = 0;
let providerObserveCount = 0;
let semanticClosureAssessmentCount = 0;
let registeredCompiledContext = null;
const planExecutionRuntime = {
  available: () => true,
  capabilitySnapshot: () => ({
    availableToolNames: ["read_file", "apply_patch", "run_command"],
    environment: "local_repository",
  }),
  start: async (input) => {
    providerStartCount += 1;
    assert.equal(
      stack.workThreadStore.readWorkThread(input.workThread.workThreadId)
        .lifecycleState,
      "contract_received",
      "the WorkThread must not become active before worker start succeeds",
    );
    assert.equal(input.authorization.singleUse, true);
    assert.equal(input.authorization.remoteMutationAllowed, false);
    assert.equal(
      input.compiledAgentContext.projectionAgreementState,
      "validated",
    );
    const transition = buildDirectWorkerStartTransition({
      projectId,
      parentThreadId: input.handoffPacket.threadId,
      primaryThreadId: input.handoffPacket.threadId,
      handoffPacket: input.handoffPacket,
      operatorAcceptance: {
        decision: "accepted",
        accepted: true,
        operatorActionId: input.operatorActionId,
      },
      workerPrompt: input.workerPrompt,
      compiledAgentContextRef: input.compiledAgentContextRef,
    });
    validateDirectWorkerStartTransition(transition);
    assert.equal(transition.startState, "ready_to_start");
    return {
      schema: "direct_worker_start_response@1",
      transition,
      result: {
        schema: "direct_worker_start_result@1",
        resultId: "worker_start_result_fixture",
        resultDigest: digestFor("worker-start-result@1", { projectId }),
        status: "started",
        workerSessionId: "worker_session_fixture",
        workerTurnId: "worker_turn_fixture",
      },
    };
  },
  observe: async (input) => {
    providerObserveCount += 1;
    assert.equal(input.workerSessionId, "worker_session_fixture");
    assert.equal(input.workerTurnId, "worker_turn_fixture");
    return {
      workerTerminalState: "completed",
      workerStartResultRef: input.record.workerStart.resultRef,
      runtimeEvidenceRefs,
    };
  },
  evaluateClosure: async (input) => {
    semanticClosureAssessmentCount += 1;
    assert.equal(
      input.implementationContractRef.id,
      stack.store.listImplementationContracts().at(-1)
        .implementationContractId,
    );
    assert.deepEqual(input.runtimeEvidenceRefs, runtimeEvidenceRefs);
    return buildPlanExecutionClosureAssessment({
      ...input,
      discharge: {
        assessments: input.completionCriteria.map(
          (criterion, index) => ({
            criterion,
            standing: semanticClosureAssessmentCount === 1
              ? "uncertain"
              : "satisfied",
            evidenceRefIds: semanticClosureAssessmentCount === 1
              ? []
              : [runtimeEvidenceRefs[index % runtimeEvidenceRefs.length].id],
            semanticSummary:
              semanticClosureAssessmentCount === 1
                ? `Project Manager still requires evidence for: ${criterion}`
                : `Project Manager assessment supports: ${criterion}`,
          }),
        ),
        overallSummary: semanticClosureAssessmentCount === 1
          ? "The first closure assessment remains unproved."
          : "All exact criteria have runtime evidence.",
        continuationPaths: semanticClosureAssessmentCount === 1
          ? ["Acquire exact closure witnesses"]
          : [],
      },
      telemetry: {
        model: "fixture-project-manager",
        reasoningEffort: "medium",
      },
    });
  },
};

function createStack() {
  const store = new DirectWorldManagerControlPlaneStore({ rootDir, now });
  const workThreadStore = new DirectWorkThreadRegistryStore({
    rootDir: path.join(rootDir, "workthreads"),
    now,
  });
  const roleRuntime = {
    registerCompilation(compilation) {
      registeredCompiledContext = compilation.compiledAgentContext;
      return registeredCompiledContext;
    },
  };
  const service = new DirectWorldManagerService({
    store,
    workThreadStore,
    planProposalLifecycleEnabled: true,
    planExecutionRuntime,
    roleRuntime,
    userWorldId,
    projects,
    activeProjectId: projectId,
    now,
  });
  service.bootstrap();
  return { store, workThreadStore, service };
}

stack = createStack();
const event = stack.store.appendUserIngress({
  schema: "direct_world_manager_submit_request@1",
  clientRequestId: "client_k6_execution_plan",
  text: "Implement the admitted K6 continuation.",
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
  title: "Implement governed K6 continuation",
  summary: "Connect an admitted plan to a governed Direct worker.",
  proposalText:
    "Compile authority, start exactly one worker, validate closure, and admit project memory.",
  features: [{
    featureId: "feature_k6_execution",
    title: "Governed planning-to-execution continuation",
    outcome: "The WorkThread closes only from runtime-observed evidence.",
  }],
  semanticSummary: "The K6 execution frontier is bounded and testable.",
  blindspots: [],
  continuationPaths: ["Inspect", "Authorize", "Witness closure"],
  recommendation: "Admit and execute under local-only authority.",
  sourceAgentResultRef: exactRef("agent_result", "agent_result_k6"),
  sourceFinalMessageRef: exactRef(
    "final_assistant_message",
    "final_message_k6",
  ),
  sourceSemanticEventRef: {
    kind: "world_manager_semantic_event",
    id: event.semanticEventId,
    digest: event.eventDigest,
    projectId,
  },
  reconciliationRef: exactRef(
    "world_manager_reconciliation",
    "reconciliation_k6",
  ),
  expectedCanonicalRevisionRefs:
    stack.service.worldmodel.canonicalArtifactRevisionRefs({
      kind: "project",
      projectId,
    }),
  createdAt: new Date(now()).toISOString(),
});
stack.store.registerPlanProposalRevision({ proposal });
stack.service.inspectPlanProposal({
  proposalRevisionId: proposal.proposalRevisionId,
  proposalDigest: proposal.digest,
});
const admittedPlan = stack.service.admitPlanProposal({
  proposalRevisionId: proposal.proposalRevisionId,
  proposalDigest: proposal.digest,
});
assert.equal(admittedPlan.contract.state, "contract_received");
assert.equal(admittedPlan.workThread.lifecycleState, "contract_received");
if (process.env.CODEX_WORLD_MANAGER_K6_CONTRACT_PROJECTION_PATH) {
  fs.writeFileSync(
    process.env.CODEX_WORLD_MANAGER_K6_CONTRACT_PROJECTION_PATH,
    `${JSON.stringify(stack.service.snapshot(), null, 2)}\n`,
  );
}

const prepared = await stack.service.preparePlanExecution({
  implementationContractId:
    admittedPlan.contract.implementationContractId,
  implementationContractDigest: admittedPlan.contract.digest,
});
assert.equal(prepared.record.state, "prepared");
assert.equal(providerStartCount, 0, "preparation must not start a provider call");
assert.equal(
  stack.workThreadStore.readWorkThread(admittedPlan.workThread.workThreadId)
    .lifecycleState,
  "contract_received",
);
assert.equal(prepared.record.constitution.localOnly, true);
assert.equal(
  prepared.record.constitution.capabilityEnvelope.remoteMutationAvailable,
  false,
);
assert.equal(
  prepared.record.constitution.authorityEnvelope.mayAdmitCanonicalWorldstate,
  false,
);
assert.match(
  prepared.record.constitution.compiledAgentContext
    .trustedInstructionPackage.instructions,
  /Do not push, publish/i,
);
const duplicatePrepared = stack.store.registerPlanExecutionRecord(
  prepared.record,
);
assert.equal(duplicatePrepared.reused, true);
assert.equal(duplicatePrepared.record.digest, prepared.record.digest);
if (process.env.CODEX_WORLD_MANAGER_K6_PREPARED_PROJECTION_PATH) {
  fs.writeFileSync(
    process.env.CODEX_WORLD_MANAGER_K6_PREPARED_PROJECTION_PATH,
    `${JSON.stringify(prepared.projection, null, 2)}\n`,
  );
}

const active = await stack.service.authorizePlanExecution({
  executionId: prepared.record.executionId,
  executionDigest: prepared.record.digest,
  handoffPacketDigest: prepared.record.handoffPacket.packetDigest,
  operatorActionId: "operator_authorizes_k6_worker",
  actorId: "operator",
});
assert.equal(providerStartCount, 1);
assert.equal(active.record.state, "active");
assert.equal(active.record.authorization.consumed, true);
assert.equal(registeredCompiledContext.projectionAgreementState, "validated");
assert.equal(
  stack.workThreadStore.readWorkThread(active.record.workThreadRef.id)
    .lifecycleState,
  "active",
);
if (process.env.CODEX_WORLD_MANAGER_K6_ACTIVE_PROJECTION_PATH) {
  fs.writeFileSync(
    process.env.CODEX_WORLD_MANAGER_K6_ACTIVE_PROJECTION_PATH,
    `${JSON.stringify(active.projection, null, 2)}\n`,
  );
}
await assert.rejects(
  stack.service.authorizePlanExecution({
    executionId: active.record.executionId,
    executionDigest: active.record.digest,
    operatorActionId: "attempt_reuse",
  }),
  /state_invalid/,
);
assert.equal(providerStartCount, 1, "authorization is single-use");

const remanded = await stack.service.completePlanExecution({
  executionId: active.record.executionId,
  executionDigest: active.record.digest,
  criterionWitnesses: active.record.constitution.completionEvaluator
    .requiredCriteria.map((criterion, index) => ({
      criterion,
      evidenceRefs: [
        runtimeEvidenceRefs[index % runtimeEvidenceRefs.length],
      ],
      semanticSummary:
        "A renderer-supplied witness must not acquire closure authority.",
    })),
});
assert.equal(remanded.closureEvaluation.decision, "remand");
assert.equal(remanded.record.state, "active");
assert.equal(
  stack.workThreadStore.readWorkThread(remanded.record.workThreadRef.id)
    .lifecycleState,
  "active",
  "activity without criterion witnesses cannot close the WorkThread",
);

const completed = await stack.service.completePlanExecution({
  executionId: remanded.record.executionId,
  executionDigest: remanded.record.digest,
});
assert.equal(completed.record.state, "admitted");
assert.equal(completed.record.projectMemory.admission.admitted, true);
assert.equal(completed.record.canonicalEffect, true);
assert.equal(completed.record.workerMayWriteProjectState, false);
assert.equal(completed.record.workerMayWriteWorldState, false);
assert.equal(
  stack.workThreadStore.readWorkThread(completed.record.workThreadRef.id)
    .lifecycleState,
  "completed",
);
assert.equal(providerObserveCount, 2);
assert.equal(semanticClosureAssessmentCount, 2);
assert.ok(completed.upwardStatus.projectionDigest);
assert.equal(stack.store.descriptor().counts.planExecutionCount, 1);
if (process.env.CODEX_WORLD_MANAGER_K6_ADMITTED_PROJECTION_PATH) {
  fs.writeFileSync(
    process.env.CODEX_WORLD_MANAGER_K6_ADMITTED_PROJECTION_PATH,
    `${JSON.stringify(completed.projection, null, 2)}\n`,
  );
}

const interruptedEvent = stack.store.appendUserIngress({
  schema: "direct_world_manager_submit_request@1",
  clientRequestId: "client_k6_interrupted_start",
  text: "Prepare a second plan to prove worker-start restart containment.",
  scopeHint: {
    projectId,
    proposalId: "",
    workThreadId: "",
    bindingPosture: "explicit_constraint",
  },
  expectedProjectionRevision: null,
  attachmentDraftRefs: [],
}).event;
const interruptedProposal = buildPlanProposalRevision({
  projectId,
  revision: 1,
  title: "Contain an interrupted worker start",
  summary: "Never replay an uncertain provider start after restart.",
  proposalText: "Persist the uncertain boundary and pause the WorkThread.",
  features: [{
    featureId: "feature_k6_interrupted_start",
    title: "Restart-safe worker start",
    outcome: "No provider call is replayed automatically.",
  }],
  semanticSummary: "A second contract exercises restart containment.",
  blindspots: [],
  continuationPaths: ["Inspect the persisted lineage"],
  recommendation: "Fail closed after restart.",
  sourceAgentResultRef: exactRef(
    "agent_result",
    "agent_result_k6_interrupted",
  ),
  sourceFinalMessageRef: exactRef(
    "final_assistant_message",
    "final_message_k6_interrupted",
  ),
  sourceSemanticEventRef: {
    kind: "world_manager_semantic_event",
    id: interruptedEvent.semanticEventId,
    digest: interruptedEvent.eventDigest,
    projectId,
  },
  reconciliationRef: exactRef(
    "world_manager_reconciliation",
    "reconciliation_k6_interrupted",
  ),
  expectedCanonicalRevisionRefs:
    stack.service.worldmodel.canonicalArtifactRevisionRefs({
      kind: "project",
      projectId,
    }),
  createdAt: new Date(now()).toISOString(),
});
stack.store.registerPlanProposalRevision({ proposal: interruptedProposal });
stack.service.inspectPlanProposal({
  proposalRevisionId: interruptedProposal.proposalRevisionId,
  proposalDigest: interruptedProposal.digest,
});
const interruptedAdmission = stack.service.admitPlanProposal({
  proposalRevisionId: interruptedProposal.proposalRevisionId,
  proposalDigest: interruptedProposal.digest,
});
const interruptedPrepared = await stack.service.preparePlanExecution({
  implementationContractId:
    interruptedAdmission.contract.implementationContractId,
  implementationContractDigest: interruptedAdmission.contract.digest,
});
const interruptedAuthorization = buildPlanExecutionAuthorization({
  constitution: interruptedPrepared.record.constitution,
  handoffPacket: interruptedPrepared.record.handoffPacket,
  operatorActionId: "operator_start_interrupted_by_restart",
  actorId: "operator",
  now,
});
const durableStarting = revisePlanExecutionRecord(
  interruptedPrepared.record,
  {
    state: "starting",
    authorization: interruptedAuthorization,
  },
  { now },
);
stack.store.registerPlanExecutionRecord(durableStarting);
const providerStartsBeforeRestart = providerStartCount;

stack.store.close();
stack = createStack();
const recovered = stack.store.planExecutionById(
  completed.record.executionId,
);
assert.equal(recovered.state, "admitted");
assert.equal(recovered.digest, completed.record.digest);
assert.equal(
  stack.workThreadStore.readWorkThread(recovered.workThreadRef.id)
    .lifecycleState,
  "completed",
);
assert.equal(stack.service.snapshot().planExecutions.length, 2);
const interruptedRecovered = stack.store.planExecutionById(
  durableStarting.executionId,
);
assert.equal(interruptedRecovered.state, "failed");
assert.equal(
  interruptedRecovered.error.code,
  "world_manager_plan_execution_worker_start_outcome_uncertain",
);
assert.equal(
  stack.workThreadStore.readWorkThread(interruptedRecovered.workThreadRef.id)
    .lifecycleState,
  "paused",
);
assert.equal(
  providerStartCount,
  providerStartsBeforeRestart,
  "an uncertain persisted worker start must never replay",
);

console.log(JSON.stringify({
  ok: true,
  regression: "direct-world-manager-k6-execution",
  proofs: {
    preparationStartsNoProviderCall: true,
    exactSingleUseOperatorAuthorityRequired: true,
    workThreadActivatesOnlyAfterWorkerStart: true,
    localEffectsRemainSeparatelyGated: true,
    remoteAndCanonicalWorkerEffectsDenied: true,
    activityAloneCannotCloseWorkThread: true,
    closureRequiresRuntimeObservedCriterionWitnesses: true,
    rendererCannotAuthorClosureWitnesses: true,
    projectManagerSemanticClosureAssessmentRunsBeforeGate: true,
    projectManagerAdmitsProjectMemory: true,
    upwardStatusProducedAfterAdmission: true,
    restartPreservesExecutionLineage: true,
    restartNeverReplaysUncertainWorkerStart: true,
  },
}, null, 2));
