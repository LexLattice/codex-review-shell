"use strict";

const {
  buildDirectRoleHandoffPacket,
  validateDirectRoleHandoffPacket,
} = require("../bridge/role-handoff-packet");
const {
  buildPolicyObject,
  buildResolvedTaskConstitution,
  validateResolvedTaskConstitution,
} = require("./policy-compiler");
const {
  buildWorldManagerTaskSettlement,
} = require("./settlement");
const {
  IMPLEMENTATION_CONTRACT_SCHEMA,
} = require("./plan-proposal-lifecycle");
const {
  digestFor,
  stableId,
} = require("./control-plane");

const PLAN_EXECUTION_CONSTITUTION_SCHEMA =
  "direct_plan_execution_constitution@1";
const PLAN_EXECUTION_AUTHORIZATION_SCHEMA =
  "direct_plan_execution_authorization@1";
const PLAN_EXECUTION_CLOSURE_EVALUATION_SCHEMA =
  "direct_plan_execution_closure_evaluation@1";
const PLAN_EXECUTION_RECORD_SCHEMA =
  "direct_plan_execution_record@1";

const EXECUTION_STATES = new Set([
  "prepared",
  "starting",
  "active",
  "completed",
  "admitted",
  "failed",
]);

const LEGAL_TRANSITIONS = Object.freeze({
  prepared: new Set(["starting", "failed"]),
  starting: new Set(["active", "failed"]),
  active: new Set(["active", "completed", "failed"]),
  completed: new Set(["admitted", "failed"]),
  admitted: new Set(),
  failed: new Set(),
});

function fail(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  if (detail) error.detail = detail;
  throw error;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function bounded(value, fallback = "", max = 1_200) {
  const source = text(value, fallback);
  return source.length > max
    ? `${source.slice(0, Math.max(0, max - 1)).trimEnd()}…`
    : source;
}

function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => text(value, ""))
    .filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function nowIso(now = Date.now) {
  const value = typeof now === "function" ? now() : now;
  return new Date(Number(value) || Date.now()).toISOString();
}

function exactRef(value = {}, label = "ref") {
  const ref = {
    kind: text(value.kind, ""),
    id: text(value.id || value.artifactId, ""),
    digest: text(value.digest || value.artifactDigest, ""),
  };
  if (!ref.kind || !ref.id || !/^sha256:[a-f0-9]{64}$/i.test(ref.digest)) {
    fail("world_manager_plan_execution_ref_invalid", label);
  }
  const projectId = text(value.projectId, "");
  if (projectId) ref.projectId = projectId;
  return ref;
}

function exactRefMatches(left, right) {
  try {
    const a = exactRef(left);
    const b = exactRef(right);
    return a.kind === b.kind && a.id === b.id && a.digest === b.digest;
  } catch {
    return false;
  }
}

function refFor(kind, value, idField, projectId = "") {
  return exactRef({
    kind,
    id: value[idField],
    digest: value.digest,
    ...(projectId ? { projectId } : {}),
  });
}

function artifact(schema, idField, id, body = {}) {
  const value = {
    schema,
    [idField]: id,
    ...body,
    grantsAuthority: false,
  };
  value.digest = digestFor(schema, value, ["digest"]);
  return value;
}

function codeRef(kind, id, seed = {}) {
  return {
    kind,
    id,
    digest: digestFor(`direct-plan-execution-${kind}@1`, { id, ...seed }),
  };
}

function validateImplementationContract(contract) {
  if (
    !isPlainObject(contract) ||
    contract.schema !== IMPLEMENTATION_CONTRACT_SCHEMA ||
    !text(contract.implementationContractId, "") ||
    !text(contract.projectId, "") ||
    !text(contract.workThreadId, "") ||
    contract.state !== "contract_received" ||
    contract.authority?.workerStartAuthorized !== false ||
    contract.authority?.remoteMutationAllowed !== false ||
    contract.digest !== digestFor(contract.schema, contract, ["digest"])
  ) {
    fail("world_manager_plan_execution_contract_invalid");
  }
  for (const [label, ref] of [
    ["proposalRevisionRef", contract.proposalRevisionRef],
    ["admissionDecisionRef", contract.admissionDecisionRef],
    ["canonicalGraphRef", contract.canonicalGraphRef],
    ["graphTransitionRef", contract.graphTransitionRef],
  ]) exactRef(ref, label);
  return true;
}

function contractRef(contract) {
  validateImplementationContract(contract);
  return exactRef({
    kind: "implementation_contract",
    id: contract.implementationContractId,
    digest: contract.digest,
    projectId: contract.projectId,
  });
}

function workThreadRef(workThread) {
  if (
    !isPlainObject(workThread) ||
    !text(workThread.workThreadId, "") ||
    !text(workThread.projectId, "") ||
    !/^sha256:[a-f0-9]{64}$/i.test(text(workThread.digest, ""))
  ) fail("world_manager_plan_execution_work_thread_invalid");
  return exactRef({
    kind: "work_thread",
    id: workThread.workThreadId,
    digest: workThread.digest,
    projectId: workThread.projectId,
  });
}

function policyObject(input = {}) {
  return buildPolicyObject({
    ...input,
    ownerRef: input.ownerRef,
    inheritanceRuleRef: codeRef(
      "policy_inheritance_rule",
      "admitted_contract_implementation_closure@1",
    ),
    provenanceRefs: input.provenanceRefs,
    authorityDecisionRef: input.authorityDecisionRef,
    policyRevision: 1,
    status: "active",
    sourcePosture: "trusted_wm_k6_contract_compilation",
  });
}

function buildImplementationSettlement(contract, input = {}) {
  const taskSettlementId = stableId("wm_plan_execution_settlement", {
    implementationContractRef: contractRef(contract),
  });
  return buildWorldManagerTaskSettlement({
    taskSettlementId,
    semanticEventId: contract.admissionDecisionRef.id,
    ingressEnvelope: {
      ingressId: contract.implementationContractId,
      digest: contract.digest,
    },
    targetResolution: {
      resolutionId: contract.graphTransitionRef.id,
      digest: contract.graphTransitionRef.digest,
    },
    settlementTier: "exact",
    state: "settled",
    targetScope: {
      scopeKind: "project",
      projectId: contract.projectId,
      semanticPath: ["projects", contract.projectId, "implementation"],
    },
    projectId: contract.projectId,
    taskType: "implementation_request",
    phase: "implementation",
    responsibleRole: "project_manager",
    selectedManagerAgentId: text(
      input.projectManagerAgentId,
      stableId("project_manager_agent", {
        userWorldId: text(input.userWorldId, "user_world_local"),
        projectId: contract.projectId,
      }),
    ),
    actionClasses: [
      "implement_admitted_contract",
      "request_workspace_effects",
      "return_closure_evidence",
    ],
    effectClasses: ["workspace_candidate_effect", "project_memory_candidate"],
    ambiguityReasons: [],
    rationale:
      "The exact admitted implementation contract fixes project, WorkThread, objective, deliverables, and completion criteria.",
    createdAt: text(input.createdAt, nowIso(input.now)),
  });
}

function buildPlanExecutionConstitution(input = {}) {
  const contract = input.contract;
  const workThread = input.workThread;
  validateImplementationContract(contract);
  const threadRef = workThreadRef(workThread);
  if (
    threadRef.id !== contract.workThreadId ||
    threadRef.projectId !== contract.projectId ||
    workThread.lifecycleState !== "contract_received"
  ) fail("world_manager_plan_execution_contract_thread_mismatch");
  const userWorldId = text(input.userWorldId, "user_world_local");
  const settlement = buildImplementationSettlement(contract, input);
  const authorityDecisionRef = contract.admissionDecisionRef;
  const ownerRef = codeRef("constitutional_role", "world_manager@1");
  const provenanceRefs = [
    contractRef(contract),
    contract.canonicalGraphRef,
    contract.graphTransitionRef,
  ];
  const scopeSelector = {
    userWorldId,
    projectIds: [contract.projectId],
    workThreadIds: [contract.workThreadId],
    taskTypes: ["implementation_request"],
    phases: ["implementation"],
    roleKinds: ["project_manager"],
  };
  const common = {
    ownerRef,
    scopeSelector,
    provenanceRefs,
    authorityDecisionRef,
  };
  const policies = [
    policyObject({
      ...common,
      policyId: stableId("wm_k6_policy", { contractDigest: contract.digest, force: "required" }),
      identity: "K6 admitted-contract execution obligations",
      governedActionClasses: [
        "implement_admitted_deliverables",
        "preserve_contract_lineage",
        "return_completion_evidence",
      ],
      deonticForce: "required",
      policyStrength: "hard_constraint",
      precedence: 1_000,
      enforcementModes: ["prompt_instruction", "postcondition_validation"],
    }),
    policyObject({
      ...common,
      policyId: stableId("wm_k6_policy", { contractDigest: contract.digest, force: "permitted" }),
      identity: "K6 local implementation permissions",
      governedActionClasses: [
        "inspect_local_workspace",
        "propose_local_workspace_patch",
        "propose_local_verification_command",
        "create_local_commit",
      ],
      deonticForce: "permitted",
      policyStrength: "hard_constraint",
      precedence: 900,
      enforcementModes: ["prompt_instruction"],
    }),
    policyObject({
      ...common,
      policyId: stableId("wm_k6_policy", { contractDigest: contract.digest, force: "approval" }),
      identity: "K6 per-call local effect gates",
      governedActionClasses: [
        "read_workspace_file",
        "apply_workspace_patch",
        "run_workspace_command",
      ],
      deonticForce: "permitted",
      policyStrength: "hard_constraint",
      precedence: 1_100,
      enforcementModes: ["approval_gate", "runtime_precondition"],
    }),
    policyObject({
      ...common,
      policyId: stableId("wm_k6_policy", { contractDigest: contract.digest, force: "prohibited" }),
      identity: "K6 local-only and semantic-authority boundary",
      governedActionClasses: [
        "mutate_remote_systems",
        "push_or_publish",
        "create_remote_artifact",
        "admit_canonical_worldstate",
        "self_certify_completion",
        "spawn_recursive_worker",
      ],
      deonticForce: "prohibited",
      policyStrength: "hard_constraint",
      precedence: 1_200,
      enforcementModes: [
        "capability_denial",
        "prompt_instruction",
        "postcondition_validation",
      ],
    }),
  ];
  const graphProjectionRef = exactRef(
    input.graphProjectionRef || contract.canonicalGraphRef,
    "graphProjectionRef",
  );
  const bootPacketRef = exactRef(
    input.bootPacketRef || contract.graphTransitionRef,
    "bootPacketRef",
  );
  const policyCompilation = buildResolvedTaskConstitution({
    taskSettlement: settlement,
    policies,
    exceptions: [],
    userWorldId,
    workThreadId: contract.workThreadId,
    environment: text(input.environment, "local_repository"),
    projectIdentityRef: exactRef(
      input.projectIdentityRef || {
        kind: "project_identity",
        id: contract.projectId,
        digest: digestFor("direct-plan-execution-project-identity@1", {
          projectId: contract.projectId,
          canonicalGraphRef: contract.canonicalGraphRef,
        }),
      },
      "projectIdentityRef",
    ),
    graphProjectionRef,
    bootPacketRef,
    roleRef: settlement.selectedManagerAgentRef,
    sourceScopeRevisions: Array.isArray(input.sourceScopeRevisions)
      ? input.sourceScopeRevisions
      : [],
  });
  const resolvedTaskConstitution = policyCompilation.constitution;
  validateResolvedTaskConstitution(resolvedTaskConstitution);
  if (resolvedTaskConstitution.policyClosureState !== "resolved") {
    fail("world_manager_plan_execution_policy_closure_blocked");
  }

  const availableToolNames = uniqueStrings(
    Array.isArray(input.availableToolNames)
      ? input.availableToolNames
      : ["read_file", "apply_patch", "run_command"],
  ).filter((name) => ["read_file", "apply_patch", "run_command"].includes(name));
  const taskConstitutionRef = refFor(
    "resolved_task_constitution",
    resolvedTaskConstitution,
    "taskConstitutionId",
    contract.projectId,
  );
  const roleTemplate = artifact(
    "direct_trusted_role_template@1",
    "roleTemplateId",
    "worker.plan_implementation@1",
    {
      roleKind: "implementation_worker",
      roleTemplateRevision: 1,
      purpose:
        "Implement one admitted plan contract under local-only, per-call effect authority.",
      templateStatus: "active_wm_k6",
      requiredOutputSchema: "direct_worker_implementation_result@1",
      authorityCeiling: {
        mayReadLocalWorkspace: true,
        mayProposeLocalWorkspaceEffects: true,
        mayExecuteWorkspaceEffectsWithoutApproval: false,
        mayMutateRemoteSystems: false,
        mayAdmitCanonicalWorldstate: false,
        mayCertifyCompletion: false,
      },
    },
  );
  const capabilityEnvelope = artifact(
    "direct_agent_capability_envelope@1",
    "capabilityEnvelopeId",
    stableId("wm_k6_worker_capability", { taskConstitutionRef, availableToolNames }),
    {
      projectId: contract.projectId,
      toolNames: availableToolNames,
      toolCount: availableToolNames.length,
      workspaceEffectRequestAvailable:
        availableToolNames.includes("apply_patch") || availableToolNames.includes("run_command"),
      perCallApprovalRequired: true,
      remoteMutationAvailable: false,
      canonicalWriteAvailable: false,
      recursiveWorkerSpawnAvailable: false,
    },
  );
  const authorityEnvelope = artifact(
    "direct_agent_authority_envelope@1",
    "authorityEnvelopeId",
    stableId("wm_k6_worker_authority", { taskConstitutionRef, contractRef: contractRef(contract) }),
    {
      projectId: contract.projectId,
      providerStartRequiresOperatorAuthorization: true,
      mayStartProviderTurnAfterAuthorization: true,
      mayProposePerCallEffects: true,
      mayExecuteWorkspaceMutationWithoutApproval: false,
      mayMutateRemoteSystems: false,
      mayAdmitCanonicalWorldstate: false,
      mayCertifyCompletion: false,
      perCallApprovalRequired: true,
    },
  );
  const completionEvaluator = artifact(
    "direct_agent_completion_evaluator@1",
    "completionEvaluatorId",
    stableId("wm_k6_completion_evaluator", {
      contractRef: contractRef(contract),
      completionCriteria: contract.completionCriteria,
    }),
    {
      requiredCriteria: [...contract.completionCriteria],
      requiredEvidenceKinds: [
        "direct_worker_start_result",
        "direct_worker_turn",
        "completion_criterion_witness",
      ],
      activityCountsAsCompletion: false,
      workerMaySelfCertifyClosure: false,
      admissionAuthority: "project_manager",
    },
  );
  const instructions = [
    "You are the implementation worker for one admitted WorldManager plan contract.",
    `Project: ${contract.projectId}. WorkThread: ${contract.workThreadId}.`,
    `Objective: ${bounded(contract.objective, "Implement the admitted project plan.")}`,
    `Deliverables: ${contract.deliverables.join("; ") || "the admitted contract deliverables"}.`,
    ...policyCompilation.promptProjection.instructionLines,
    "All workspace reads, patches, and commands are effect requests. The harness separately authorizes and witnesses every such call.",
    "Work locally. Do not push, publish, create remote artifacts, mutate policy, or write project/world state.",
    "Return implementation evidence. Your terminal message is evidence, not authority to mark the WorkThread complete.",
  ].join("\n");
  const trustedInstructionPackage = artifact(
    "direct_trusted_provider_instruction_package@1",
    "trustedInstructionPackageId",
    stableId("wm_k6_worker_instructions", { taskConstitutionRef, contractRef: contractRef(contract) }),
    {
      instructions,
      sourcePosture: "trusted_harness_code",
      rendererSuppliedInstructionsAccepted: false,
    },
  );
  const agentInstantiationId = stableId("wm_k6_worker_instantiation", {
    taskConstitutionRef,
    roleTemplateDigest: roleTemplate.digest,
    capabilityDigest: capabilityEnvelope.digest,
  });
  const agentInstantiation = artifact(
    "direct_agent_instantiation@1",
    "agentInstantiationId",
    agentInstantiationId,
    {
      projectId: contract.projectId,
      roleTemplateRef: refFor("trusted_role_template", roleTemplate, "roleTemplateId"),
      taskConstitutionRef,
      authorityEnvelopeRef: refFor("agent_authority_envelope", authorityEnvelope, "authorityEnvelopeId", contract.projectId),
      capabilityEnvelopeRef: refFor("agent_capability_envelope", capabilityEnvelope, "capabilityEnvelopeId", contract.projectId),
      completionEvaluatorRef: refFor("agent_completion_evaluator", completionEvaluator, "completionEvaluatorId", contract.projectId),
      status: "compiled",
      runtimeAdmissionState: "operator_authorization_required",
      rendererInstructionInputAccepted: false,
    },
  );
  const manifest = artifact(
    "direct_agent_instantiation_manifest@1",
    "instanceId",
    agentInstantiationId,
    {
      projectId: contract.projectId,
      implementationContractRef: contractRef(contract),
      workThreadRef: threadRef,
      roleTemplateRef: agentInstantiation.roleTemplateRef,
      taskConstitutionRef,
      authorityDigest: authorityEnvelope.digest,
      capabilityDigest: capabilityEnvelope.digest,
      evaluatorDigest: completionEvaluator.digest,
      promptDigest: trustedInstructionPackage.digest,
      rendererInstructionInputAccepted: false,
    },
  );
  const projectionAgreement = artifact(
    "direct_agent_world_projection_agreement@1",
    "projectionAgreementId",
    stableId("wm_k6_projection_agreement", {
      manifestDigest: manifest.digest,
      taskConstitutionRef,
    }),
    {
      state: "validated",
      launchEligible: true,
      disagreements: [],
      policyPromptAgreement: true,
      capabilityPolicyAgreement: true,
      approvalPolicyAgreement: true,
      completionPolicyAgreement: true,
      localOnlyAgreement: true,
      canonicalWriteAvailable: false,
    },
  );
  const compiledAgentContext = {
    schema: "direct_compiled_agent_context@1",
    compiledAgentContextId: stableId("wm_k6_compiled_agent_context", {
      agentInstantiationId,
      projectionAgreementDigest: projectionAgreement.digest,
    }),
    agentInstantiationRef: refFor("agent_instantiation", agentInstantiation, "agentInstantiationId", contract.projectId),
    manifestRef: refFor("agent_instantiation_manifest", manifest, "instanceId", contract.projectId),
    taskConstitutionRef,
    projectionAgreementRef: refFor("agent_world_projection_agreement", projectionAgreement, "projectionAgreementId", contract.projectId),
    trustedInstructionPackage,
    projectionAgreementState: "validated",
    rendererSuppliedInstructionsAccepted: false,
    rendererSuppliedInstructionFieldsAccepted: false,
    rendererInstructionInputAccepted: false,
    rendererInstructionFieldsPresent: false,
    grantsAuthority: false,
  };
  compiledAgentContext.digest = digestFor(
    "direct_compiled_agent_context@1",
    compiledAgentContext,
    ["digest"],
  );
  const constitution = {
    schema: PLAN_EXECUTION_CONSTITUTION_SCHEMA,
    planExecutionConstitutionId: stableId("wm_plan_execution_constitution", {
      contractRef: contractRef(contract),
      taskConstitutionRef,
      workThreadRef: threadRef,
    }),
    projectId: contract.projectId,
    implementationContractRef: contractRef(contract),
    workThreadRef: threadRef,
    taskSettlement: settlement,
    policyObjects: policies,
    resolvedTaskConstitution,
    policyPromptProjection: policyCompilation.promptProjection,
    policyEnforcementProjection: policyCompilation.enforcementProjection,
    roleTemplate,
    capabilityEnvelope,
    authorityEnvelope,
    completionEvaluator,
    agentInstantiation,
    manifest,
    projectionAgreement,
    compiledAgentContext,
    constitutionState: "ready_for_authorization",
    localOnly: true,
    perCallEffectApprovalRequired: true,
    workerMayWriteProjectState: false,
    workerMayWriteWorldState: false,
    providerStartAuthorized: false,
    rendererAuthored: false,
    grantsAuthority: false,
    compiledAt: text(input.compiledAt, nowIso(input.now)),
  };
  constitution.digest = digestFor(
    PLAN_EXECUTION_CONSTITUTION_SCHEMA,
    constitution,
    ["digest"],
  );
  validatePlanExecutionConstitution(constitution);
  return constitution;
}

function validatePlanExecutionConstitution(value) {
  if (
    !isPlainObject(value) ||
    value.schema !== PLAN_EXECUTION_CONSTITUTION_SCHEMA ||
    !text(value.planExecutionConstitutionId, "") ||
    !text(value.projectId, "") ||
    value.constitutionState !== "ready_for_authorization" ||
    value.localOnly !== true ||
    value.perCallEffectApprovalRequired !== true ||
    value.workerMayWriteProjectState !== false ||
    value.workerMayWriteWorldState !== false ||
    value.providerStartAuthorized !== false ||
    value.rendererAuthored !== false ||
    value.grantsAuthority !== false
  ) fail("world_manager_plan_execution_constitution_invalid");
  exactRef(value.implementationContractRef, "implementationContractRef");
  exactRef(value.workThreadRef, "workThreadRef");
  validateResolvedTaskConstitution(value.resolvedTaskConstitution);
  if (
    value.resolvedTaskConstitution.policyClosureState !== "resolved" ||
    !value.resolvedTaskConstitution.prohibitedActionClasses.includes("mutate_remote_systems") ||
    !value.resolvedTaskConstitution.approvalGatedActionClasses.includes("apply_workspace_patch") ||
    value.capabilityEnvelope.remoteMutationAvailable !== false ||
    value.authorityEnvelope.mayAdmitCanonicalWorldstate !== false ||
    value.completionEvaluator.activityCountsAsCompletion !== false ||
    value.completionEvaluator.workerMaySelfCertifyClosure !== false ||
    value.projectionAgreement.localOnlyAgreement !== true ||
    value.compiledAgentContext?.projectionAgreementState !== "validated"
  ) fail("world_manager_plan_execution_constitution_policy_mismatch");
  if (value.digest !== digestFor(value.schema, value, ["digest"])) {
    fail("world_manager_plan_execution_constitution_digest_mismatch");
  }
  return true;
}

function buildPlanExecutionHandoff(input = {}) {
  const constitution = input.constitution;
  validatePlanExecutionConstitution(constitution);
  const agent = constitution.agentInstantiation;
  const workThread = input.workThread;
  const threadRef = workThreadRef(workThread);
  if (!exactRefMatches(threadRef, constitution.workThreadRef)) {
    fail("world_manager_plan_execution_handoff_thread_stale");
  }
  const preflightId = stableId("wm_k6_worker_preflight", {
    constitutionDigest: constitution.digest,
    workThreadRef: threadRef,
  });
  const preflightDigest = digestFor("direct-plan-execution-preflight@1", {
    preflightId,
    recommendationClass: "route_to_role",
    selectedWorkThreadId: threadRef.id,
    constitutionDigest: constitution.digest,
  });
  const handoff = buildDirectRoleHandoffPacket({
    projectId: constitution.projectId,
    threadId: `implementation_contract:${constitution.implementationContractRef.id}`,
    turnId: constitution.planExecutionConstitutionId,
    semanticPreflight: {
      preflightId,
      projectId: constitution.projectId,
      recommendationClass: "route_to_role",
      selectedWorkThreadId: threadRef.id,
      selectedRouteKind: "admitted_plan_execution",
      preflightDigest,
    },
    workThreadRef: {
      workThreadId: threadRef.id,
      projectId: constitution.projectId,
      title: text(workThread.title, "Admitted plan implementation"),
      sourceDigest: threadRef.digest,
    },
    agentClassRef: {
      agentClassId: agent.agentInstantiationId,
      agentClassKind: "implementation_worker",
      displayName: "Implementation worker",
      specDigest: agent.digest,
      producedArtifactFamilies: ["implementation_evidence"],
      consumedContextFamilies: [
        "implementation_contract",
        "resolved_task_constitution",
      ],
    },
    expectedOutputArtifactFamily: "implementation_evidence",
    contextRefs: [
      constitution.implementationContractRef,
      refFor(
        "resolved_task_constitution",
        constitution.resolvedTaskConstitution,
        "taskConstitutionId",
        constitution.projectId,
      ),
      refFor(
        "agent_completion_evaluator",
        constitution.completionEvaluator,
        "completionEvaluatorId",
        constitution.projectId,
      ),
    ],
    authorityTransitionRefs: [],
    authorityBoundary: {
      summary:
        "Worker start authorizes one Direct provider turn; local effects remain per-call gated and semantic admission remains Project Manager-owned.",
      forbiddenActions: [
        "remote_mutation",
        "workspace_mutation_without_per_call_approval",
        "canonical_worldstate_admission",
        "self_certify_completion",
        "recursive_worker_spawn",
      ],
    },
  }, { nowMs: typeof input.now === "function" ? input.now() : input.now });
  validateDirectRoleHandoffPacket(handoff);
  return handoff;
}

function buildPlanExecutionAuthorization(input = {}) {
  const constitution = input.constitution;
  const handoffPacket = input.handoffPacket;
  validatePlanExecutionConstitution(constitution);
  validateDirectRoleHandoffPacket(handoffPacket);
  if (
    handoffPacket.projectId !== constitution.projectId ||
    handoffPacket.workThreadRef?.workThreadId !== constitution.workThreadRef.id ||
    handoffPacket.packetDigest !== text(input.handoffPacketDigest, handoffPacket.packetDigest)
  ) fail("world_manager_plan_execution_authorization_handoff_mismatch");
  const operatorActionId = text(input.operatorActionId, "");
  if (!operatorActionId) fail("world_manager_plan_execution_operator_action_required");
  const authorization = {
    schema: PLAN_EXECUTION_AUTHORIZATION_SCHEMA,
    authorizationId: stableId("wm_plan_execution_authorization", {
      constitutionDigest: constitution.digest,
      handoffPacketDigest: handoffPacket.packetDigest,
      operatorActionId,
    }),
    projectId: constitution.projectId,
    constitutionRef: refFor(
      "plan_execution_constitution",
      constitution,
      "planExecutionConstitutionId",
      constitution.projectId,
    ),
    handoffPacketRef: exactRef({
      kind: "direct_role_handoff_packet",
      id: handoffPacket.handoffPacketId,
      digest: handoffPacket.packetDigest,
      projectId: constitution.projectId,
    }),
    actorRef: exactRef(
      input.actorRef || codeRef("operator", text(input.actorId, "operator")),
      "actorRef",
    ),
    operatorActionId,
    decision: "authorized",
    providerStartAllowed: true,
    workspaceMutationAllowed: false,
    remoteMutationAllowed: false,
    canonicalAdmissionAllowed: false,
    perCallEffectApprovalRequired: true,
    singleUse: true,
    consumed: false,
    authorizedAt: text(input.authorizedAt, nowIso(input.now)),
    grantsAuthority: false,
  };
  authorization.digest = digestFor(
    PLAN_EXECUTION_AUTHORIZATION_SCHEMA,
    authorization,
    ["digest"],
  );
  validatePlanExecutionAuthorization(authorization);
  return authorization;
}

function validatePlanExecutionAuthorization(value) {
  if (
    !isPlainObject(value) ||
    value.schema !== PLAN_EXECUTION_AUTHORIZATION_SCHEMA ||
    !text(value.authorizationId, "") ||
    !text(value.operatorActionId, "") ||
    value.decision !== "authorized" ||
    value.providerStartAllowed !== true ||
    value.workspaceMutationAllowed !== false ||
    value.remoteMutationAllowed !== false ||
    value.canonicalAdmissionAllowed !== false ||
    value.perCallEffectApprovalRequired !== true ||
    value.singleUse !== true ||
    value.grantsAuthority !== false
  ) fail("world_manager_plan_execution_authorization_invalid");
  exactRef(value.constitutionRef, "constitutionRef");
  exactRef(value.handoffPacketRef, "handoffPacketRef");
  exactRef(value.actorRef, "actorRef");
  if (value.digest !== digestFor(value.schema, value, ["digest"])) {
    fail("world_manager_plan_execution_authorization_digest_mismatch");
  }
  return true;
}

function buildPlanExecutionRecord(input = {}) {
  const constitution = input.constitution;
  const handoffPacket = input.handoffPacket;
  validatePlanExecutionConstitution(constitution);
  validateDirectRoleHandoffPacket(handoffPacket);
  const createdAt = text(input.createdAt, nowIso(input.now));
  const record = {
    schema: PLAN_EXECUTION_RECORD_SCHEMA,
    executionId: stableId("wm_plan_execution", {
      implementationContractRef: constitution.implementationContractRef,
    }),
    revision: 1,
    priorRecordRef: null,
    projectId: constitution.projectId,
    implementationContractRef: constitution.implementationContractRef,
    workThreadRef: constitution.workThreadRef,
    constitution,
    handoffPacket,
    state: "prepared",
    authorization: null,
    workerStart: null,
    closureEvaluation: null,
    projectMemory: null,
    upwardStatus: null,
    error: null,
    workerMayWriteProjectState: false,
    workerMayWriteWorldState: false,
    canonicalEffect: false,
    createdAt,
    updatedAt: createdAt,
    grantsAuthority: false,
  };
  record.digest = digestFor(PLAN_EXECUTION_RECORD_SCHEMA, record, ["digest"]);
  validatePlanExecutionRecord(record);
  return record;
}

function planExecutionRecordRef(record) {
  validatePlanExecutionRecord(record);
  return exactRef({
    kind: "plan_execution_record",
    id: record.executionId,
    digest: record.digest,
    projectId: record.projectId,
  });
}

function revisePlanExecutionRecord(record, patch = {}, input = {}) {
  validatePlanExecutionRecord(record);
  const state = text(patch.state, record.state);
  if (!EXECUTION_STATES.has(state)) {
    fail("world_manager_plan_execution_state_invalid", state);
  }
  if (state !== record.state && !LEGAL_TRANSITIONS[record.state]?.has(state)) {
    fail("world_manager_plan_execution_transition_invalid", `${record.state}->${state}`);
  }
  if (state === record.state && state !== "active") {
    fail("world_manager_plan_execution_same_state_revision_forbidden", state);
  }
  const revised = {
    ...record,
    ...patch,
    schema: PLAN_EXECUTION_RECORD_SCHEMA,
    executionId: record.executionId,
    revision: record.revision + 1,
    priorRecordRef: planExecutionRecordRef(record),
    projectId: record.projectId,
    implementationContractRef: record.implementationContractRef,
    workThreadRef: patch.workThreadRef
      ? exactRef(patch.workThreadRef, "workThreadRef")
      : record.workThreadRef,
    constitution: record.constitution,
    handoffPacket: record.handoffPacket,
    state,
    workerMayWriteProjectState: false,
    workerMayWriteWorldState: false,
    grantsAuthority: false,
    updatedAt: text(input.updatedAt || patch.updatedAt, nowIso(input.now)),
  };
  delete revised.digest;
  revised.digest = digestFor(PLAN_EXECUTION_RECORD_SCHEMA, revised, ["digest"]);
  validatePlanExecutionRecord(revised);
  return revised;
}

function validatePlanExecutionRecord(value) {
  if (
    !isPlainObject(value) ||
    value.schema !== PLAN_EXECUTION_RECORD_SCHEMA ||
    !text(value.executionId, "") ||
    !Number.isInteger(value.revision) ||
    value.revision < 1 ||
    !EXECUTION_STATES.has(value.state) ||
    value.workerMayWriteProjectState !== false ||
    value.workerMayWriteWorldState !== false ||
    value.grantsAuthority !== false
  ) fail("world_manager_plan_execution_record_invalid");
  exactRef(value.implementationContractRef, "implementationContractRef");
  exactRef(value.workThreadRef, "workThreadRef");
  validatePlanExecutionConstitution(value.constitution);
  validateDirectRoleHandoffPacket(value.handoffPacket);
  if (value.authorization) validatePlanExecutionAuthorization(value.authorization);
  if (value.revision === 1 && value.priorRecordRef !== null) {
    fail("world_manager_plan_execution_initial_prior_ref_invalid");
  }
  if (value.revision > 1) exactRef(value.priorRecordRef, "priorRecordRef");
  if (value.state === "prepared" && value.workerStart) {
    fail("world_manager_plan_execution_prepared_has_worker_start");
  }
  if (["active", "completed", "admitted"].includes(value.state)) {
    if (
      value.workerStart?.result?.status !== "started" ||
      !text(value.workerStart?.result?.workerSessionId, "") ||
      !text(value.workerStart?.result?.workerTurnId, "")
    ) fail("world_manager_plan_execution_active_without_worker_start");
  }
  if (["completed", "admitted"].includes(value.state)) {
    if (value.closureEvaluation?.decision !== "complete") {
      fail("world_manager_plan_execution_completed_without_closure");
    }
  }
  if (value.state === "admitted") {
    if (!value.projectMemory?.admission?.admitted || !value.upwardStatus) {
      fail("world_manager_plan_execution_admitted_without_project_memory");
    }
  }
  if (value.digest !== digestFor(value.schema, value, ["digest"])) {
    fail("world_manager_plan_execution_record_digest_mismatch");
  }
  return true;
}

function buildPlanExecutionClosureEvaluation(input = {}) {
  const record = input.record;
  validatePlanExecutionRecord(record);
  if (record.state !== "active") {
    fail("world_manager_plan_execution_closure_requires_active");
  }
  const completionCriteria = uniqueStrings(
    record.constitution.completionEvaluator.requiredCriteria,
  );
  const runtimeEvidenceRefs = (Array.isArray(input.runtimeEvidenceRefs)
    ? input.runtimeEvidenceRefs
    : []).map((ref, index) => exactRef(ref, `runtimeEvidenceRefs[${index}]`));
  const allowedEvidence = new Set(runtimeEvidenceRefs.map((ref) =>
    `${ref.kind}:${ref.id}:${ref.digest}`));
  const criterionWitnesses = (Array.isArray(input.criterionWitnesses)
    ? input.criterionWitnesses
    : []).map((witness, index) => ({
      criterion: text(witness?.criterion, ""),
      evidenceRefs: (Array.isArray(witness?.evidenceRefs)
        ? witness.evidenceRefs
        : []).map((ref, refIndex) =>
        exactRef(ref, `criterionWitnesses[${index}].evidenceRefs[${refIndex}]`)),
      semanticSummary: bounded(
        witness?.semanticSummary,
        "The completion criterion has an evidence-bearing witness.",
        600,
      ),
    }));
  const missingCriteria = completionCriteria.filter((criterion) =>
    !criterionWitnesses.some((witness) =>
      witness.criterion === criterion &&
      witness.evidenceRefs.length > 0 &&
      witness.evidenceRefs.every((ref) =>
        allowedEvidence.has(`${ref.kind}:${ref.id}:${ref.digest}`))));
  const foreignEvidenceRefs = criterionWitnesses.flatMap((witness) =>
    witness.evidenceRefs.filter((ref) =>
      !allowedEvidence.has(`${ref.kind}:${ref.id}:${ref.digest}`)));
  const workerTerminalState = text(input.workerTerminalState, "");
  const blockerCodes = uniqueStrings([
    ...(workerTerminalState === "completed" ? [] : ["worker_turn_not_completed"]),
    ...(runtimeEvidenceRefs.length ? [] : ["runtime_evidence_missing"]),
    ...missingCriteria.map((criterion) =>
      `completion_criterion_unwitnessed:${criterion}`),
    ...(foreignEvidenceRefs.length ? ["criterion_witness_uses_unadmitted_evidence"] : []),
  ]);
  const evaluation = {
    schema: PLAN_EXECUTION_CLOSURE_EVALUATION_SCHEMA,
    closureEvaluationId: stableId("wm_plan_execution_closure", {
      executionRef: planExecutionRecordRef(record),
      runtimeEvidenceRefs,
      criterionWitnesses,
    }),
    projectId: record.projectId,
    executionRef: planExecutionRecordRef(record),
    completionEvaluatorRef: refFor(
      "agent_completion_evaluator",
      record.constitution.completionEvaluator,
      "completionEvaluatorId",
      record.projectId,
    ),
    workerStartResultRef: exactRef(input.workerStartResultRef, "workerStartResultRef"),
    workerTerminalState,
    runtimeEvidenceRefs,
    criterionWitnesses,
    missingCriteria,
    blockerCodes,
    decision: blockerCodes.length ? "remand" : "complete",
    activityAloneCountedAsCompletion: false,
    workerSelfCertificationAccepted: false,
    projectManagerAdmissionRequired: true,
    canonicalEffect: false,
    grantsAuthority: false,
    evaluatedAt: text(input.evaluatedAt, nowIso(input.now)),
  };
  evaluation.digest = digestFor(
    PLAN_EXECUTION_CLOSURE_EVALUATION_SCHEMA,
    evaluation,
    ["digest"],
  );
  validatePlanExecutionClosureEvaluation(evaluation);
  return evaluation;
}

function validatePlanExecutionClosureEvaluation(value) {
  if (
    !isPlainObject(value) ||
    value.schema !== PLAN_EXECUTION_CLOSURE_EVALUATION_SCHEMA ||
    !["complete", "remand"].includes(value.decision) ||
    value.activityAloneCountedAsCompletion !== false ||
    value.workerSelfCertificationAccepted !== false ||
    value.projectManagerAdmissionRequired !== true ||
    value.canonicalEffect !== false ||
    value.grantsAuthority !== false ||
    !Array.isArray(value.runtimeEvidenceRefs) ||
    !Array.isArray(value.criterionWitnesses) ||
    !Array.isArray(value.missingCriteria) ||
    !Array.isArray(value.blockerCodes)
  ) fail("world_manager_plan_execution_closure_evaluation_invalid");
  exactRef(value.executionRef, "executionRef");
  exactRef(value.completionEvaluatorRef, "completionEvaluatorRef");
  exactRef(value.workerStartResultRef, "workerStartResultRef");
  value.runtimeEvidenceRefs.forEach((ref, index) => exactRef(ref, `runtimeEvidenceRefs[${index}]`));
  if (
    (value.decision === "complete" && (value.blockerCodes.length || value.missingCriteria.length)) ||
    value.digest !== digestFor(value.schema, value, ["digest"])
  ) fail("world_manager_plan_execution_closure_evaluation_mismatch");
  return true;
}

function planExecutionWorkerPrompt(constitution) {
  validatePlanExecutionConstitution(constitution);
  const contract = constitution.implementationContractRef;
  return [
    "Execute the exact admitted implementation contract bound in your compiled context.",
    `Project: ${constitution.projectId}`,
    `Implementation contract: ${contract.id}@${contract.digest}`,
    `WorkThread: ${constitution.workThreadRef.id}`,
    "Use only the local tools exposed by the harness. Every tool effect remains separately gated.",
    "Return evidence for the completion evaluator. Do not mark project/world state complete and do not perform remote effects.",
  ].join("\n");
}

module.exports = {
  PLAN_EXECUTION_AUTHORIZATION_SCHEMA,
  PLAN_EXECUTION_CLOSURE_EVALUATION_SCHEMA,
  PLAN_EXECUTION_CONSTITUTION_SCHEMA,
  PLAN_EXECUTION_RECORD_SCHEMA,
  buildPlanExecutionAuthorization,
  buildPlanExecutionClosureEvaluation,
  buildPlanExecutionConstitution,
  buildPlanExecutionHandoff,
  buildPlanExecutionRecord,
  contractRef,
  planExecutionRecordRef,
  planExecutionWorkerPrompt,
  revisePlanExecutionRecord,
  validateImplementationContract,
  validatePlanExecutionAuthorization,
  validatePlanExecutionClosureEvaluation,
  validatePlanExecutionConstitution,
  validatePlanExecutionRecord,
};
