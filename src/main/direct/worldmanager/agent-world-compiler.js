"use strict";

const {
  DIRECT_COMPILED_AGENT_TURN_POLICY_ID,
  policySnapshot,
} = require("../thread/context-pack");
const { digestFor, stableId } = require("./control-plane");
const {
  compileWorldManagerTaskConstitution,
  validateResolvedTaskConstitution,
} = require("./policy-compiler");
const {
  AGENT_WORLD_COMPILER_REVISION,
  selectTrustedRoleTemplate,
  trustedRoleTemplateRegistry,
} = require("./role-template-registry");
const {
  validateWorldManagerTaskSettlement,
} = require("./settlement");
const {
  TRUSTED_DISCOURSE_EVIDENCE_SCHEMA,
  TRUSTED_SEMANTIC_HISTORY_EVIDENCE_SCHEMA,
} = require("./discourse-evidence");

const AGENT_AUTHORITY_ENVELOPE_SCHEMA =
  "direct_agent_authority_envelope@1";
const AGENT_CAPABILITY_ENVELOPE_SCHEMA =
  "direct_agent_capability_envelope@1";
const AGENT_BUDGET_SCHEMA = "direct_agent_budget@1";
const AGENT_EVIDENCE_ACCESS_CONTRACT_SCHEMA =
  "direct_agent_evidence_access_contract@1";
const AGENT_COMPLETION_EVALUATOR_SCHEMA =
  "direct_agent_completion_evaluator@1";
const AGENT_OUTPUT_CONTRACT_SCHEMA = "direct_agent_output_contract@1";
const AGENT_PROMPT_PROJECTION_SCHEMA =
  "direct_agent_prompt_projection@1";
const AGENT_RUNTIME_PROFILE_SCHEMA = "direct_agent_runtime_profile@1";
const TRUSTED_PROVIDER_INSTRUCTION_PACKAGE_SCHEMA =
  "direct_trusted_provider_instruction_package@1";
const AGENT_INSTANTIATION_SCHEMA = "direct_agent_instantiation@1";
const AGENT_INSTANTIATION_MANIFEST_SCHEMA =
  "direct_agent_instantiation_manifest@1";
const AGENT_WORLD_PROJECTION_AGREEMENT_SCHEMA =
  "direct_agent_world_projection_agreement@1";
const COMPILED_AGENT_CONTEXT_SCHEMA = "direct_compiled_agent_context@1";
const AGENT_WORLD_COMPILATION_SCHEMA =
  "direct_world_manager_agent_world_compilation@1";
const COMPILER_REVISION = AGENT_WORLD_COMPILER_REVISION;
const REF_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/i;
const TRUSTED_REALIZATION_EVIDENCE_SCHEMA =
  "direct_trusted_realization_evidence@1";

const AUTHORITY_BOOLEAN_FIELDS = Object.freeze([
  "mayReadAdmittedGraphProjection",
  "mayFormulateCandidate",
  "mayInvokeTools",
  "mayMutateWorkspace",
  "mayMutateRemoteSystems",
  "mayAdmitCanonicalWorldstate",
  "mayStartImplementation",
]);

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

function requireString(value, label) {
  const result = text(value, "");
  if (!result) fail("world_manager_agent_world_missing_string", label);
  return result;
}

function sortedUnique(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => text(value, ""))
    .filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function intersection(left, right) {
  const rightSet = new Set(right);
  return sortedUnique(left).filter((entry) => rightSet.has(entry));
}

function exactRef(input = {}, fallbackKind = "agent_world_artifact") {
  const source = isPlainObject(input) ? input : {};
  const ref = {
    kind: requireString(source.kind, `${fallbackKind}.kind`),
    id: requireString(source.id, `${fallbackKind}.id`),
    digest: requireString(source.digest, `${fallbackKind}.digest`),
  };
  if (!REF_DIGEST_PATTERN.test(ref.digest)) {
    fail("world_manager_agent_world_invalid_ref_digest", fallbackKind);
  }
  return ref;
}

function refFor(kind, object, idField, digestField = "digest") {
  return exactRef({
    kind,
    id: object[idField],
    digest: object[digestField],
  }, kind);
}

function artifact(schema, idField, id, body) {
  const result = {
    schema,
    [idField]: id,
    ...body,
    grantsAuthority: false,
  };
  result.digest = digestFor(schema, result, ["digest"]);
  return result;
}

function projectIdentityRef(input = {}) {
  const taskSettlement = input.taskSettlement;
  const graphBinding = input.graphBinding || {};
  const graphProjection = input.managerContext.graphProjection;
  const identityNodeId = taskSettlement.projectId
    ? graphBinding.projectRootNodeIds?.[taskSettlement.projectId]
    : graphBinding.worldRootNodeId;
  const nodeRef = graphProjection.selectedNodeRefs.find((entry) =>
    entry.id === identityNodeId);
  if (!nodeRef) {
    fail(
      "world_manager_agent_world_identity_outside_projection",
      taskSettlement.projectId || "user_world",
    );
  }
  return {
    kind: taskSettlement.projectId
      ? "project_identity"
      : "user_world_identity",
    id: nodeRef.id,
    digest: nodeRef.digest,
  };
}

function contextPolicyArtifact() {
  const snapshot = policySnapshot(DIRECT_COMPILED_AGENT_TURN_POLICY_ID);
  const result = {
    schema: "direct_compiled_agent_turn_context_policy@1",
    policyId: snapshot.policyId,
    policyVersion: snapshot.policyVersion,
    contextPackPolicyDigest: `sha256:${snapshot.policyDigest}`,
    orderedLayers: [
      "harness_policy",
      "trusted_role_template_projection",
      "resolved_task_constitution_projection",
      "current_user_directive",
      "admitted_graph_and_evidence_context",
      "role_response_contract",
    ],
    compiledAgentContextRequired: true,
    trustedRoleTemplateRequired: true,
    rendererSystemInstructionAllowed: false,
    currentUserDirectiveRemainsUserAuthored: true,
    projectionAgreementRequired: true,
    providerRequestState: "not_started",
    grantsAuthority: false,
  };
  result.digest = digestFor(
    "direct_compiled_agent_turn_context_policy@1",
    result,
    ["digest"],
  );
  return result;
}

function buildAuthorityEnvelope(input = {}) {
  const constitution = input.constitution;
  const template = input.template;
  const authority = {
    schema: AGENT_AUTHORITY_ENVELOPE_SCHEMA,
    authorityEnvelopeId: stableId("wm_agent_authority", {
      semanticEventId: input.taskSettlement.semanticEventId,
      roleTemplateDigest: template.digest,
      constitutionDigest: constitution.digest,
    }),
    parentAuthorityBoundaryRef: exactRef(
      input.managerContext.authoritySourceRef,
      "authority.parentAuthorityBoundaryRef",
    ),
    taskConstitutionRef: refFor(
      "resolved_task_constitution",
      constitution,
      "taskConstitutionId",
    ),
    authorizedActionClasses: sortedUnique([
      ...constitution.requiredActionClasses,
      ...constitution.permittedActionClasses,
    ]),
    prohibitedActionClasses: constitution.prohibitedActionClasses,
    approvalGatedActionClasses: constitution.approvalGatedActionClasses,
    mayReadAdmittedGraphProjection:
      template.authorityCeiling.mayReadAdmittedGraphProjection,
    mayFormulateCandidate:
      template.authorityCeiling.mayFormulateCandidate,
    mayInvokeTools: false,
    mayMutateWorkspace: false,
    mayMutateRemoteSystems: false,
    mayAdmitCanonicalWorldstate: false,
    mayStartImplementation: false,
    authorityAttenuationState: "within_parent_boundary",
    grantsAuthority: false,
  };
  authority.digest = digestFor(
    AGENT_AUTHORITY_ENVELOPE_SCHEMA,
    authority,
    ["digest"],
  );
  return authority;
}

function buildCapabilityEnvelope(input = {}) {
  const constitution = input.constitution;
  return artifact(
    AGENT_CAPABILITY_ENVELOPE_SCHEMA,
    "capabilityEnvelopeId",
    stableId("wm_agent_capability", {
      semanticEventId: input.taskSettlement.semanticEventId,
      constitutionDigest: constitution.digest,
    }),
    {
      taskConstitutionRef: refFor(
        "resolved_task_constitution",
        constitution,
        "taskConstitutionId",
      ),
      toolNames: [],
      toolCount: 0,
      grantedActionClasses: constitution.permittedActionClasses.filter(
        (entry) =>
          [
            "read_admitted_graph_projection",
            "reason_over_supplied_evidence",
          ].includes(entry),
      ),
      deniedActionClasses: constitution.prohibitedActionClasses,
      workspaceMutationAvailable: false,
      remoteMutationAvailable: false,
      canonicalWriteAvailable: false,
      providerToolDeclarationsAvailable: false,
      sourcePosture: "K3 compile-only capability envelope",
    },
  );
}

function buildBudget(input = {}) {
  return artifact(
    AGENT_BUDGET_SCHEMA,
    "budgetId",
    stableId("wm_agent_budget", {
      semanticEventId: input.taskSettlement.semanticEventId,
      roleTemplateId: input.template.roleTemplateId,
    }),
    {
      turnLimit: 1,
      toolCallLimit: 0,
      workspaceMutationLimit: 0,
      remoteMutationLimit: 0,
      canonicalWriteLimit: 0,
      budgetPosture: "compile_only_k3",
    },
  );
}

function buildOutputContract(input = {}) {
  const naturalLanguage =
    input.template.responseMode === "natural_language";
  return artifact(
    AGENT_OUTPUT_CONTRACT_SCHEMA,
    "outputContractId",
    stableId("wm_agent_output_contract", {
      semanticEventId: input.taskSettlement.semanticEventId,
      roleTemplateDigest: input.template.digest,
    }),
    {
      roleTemplateRef: refFor(
        "trusted_role_template",
        input.template,
        "roleTemplateId",
      ),
      responseMode: input.template.responseMode,
      requiredResultSchema: input.template.requiredOutputSchema,
      requiredFields: input.template.requiredOutputFields,
      additionalTextAllowed: naturalLanguage,
      candidateResultOnly: true,
      canonicalAdmissionEffect: false,
      strictStructuredOutputRequired: !naturalLanguage,
    },
  );
}

function buildEvidenceAccessContract(input = {}) {
  const graphProjection = input.managerContext.graphProjection;
  const bootPacket = input.managerContext.bootPacket;
  return artifact(
    AGENT_EVIDENCE_ACCESS_CONTRACT_SCHEMA,
    "evidenceAccessContractId",
    stableId("wm_agent_evidence_access", {
      semanticEventId: input.taskSettlement.semanticEventId,
      projectionDigest: graphProjection.projectionDigest,
    }),
    {
      graphProjectionRef: refFor(
        "worldmodel_graph_projection",
        graphProjection,
        "projectionId",
        "projectionDigest",
      ),
      bootPacketRef: refFor(
        "manager_turn_boot_packet",
        bootPacket,
        "bootPacketId",
      ),
      selectedNodeRefs: graphProjection.selectedNodeRefs,
      selectedEdgeRefs: graphProjection.selectedEdgeRefs,
      sourceScopeRevisions: graphProjection.sourceScopeRevisions,
      historicalTranscriptIncluded: false,
      unrelatedProjectStateIncluded: false,
      rendererEvidenceInjectionAccepted: false,
      accessPosture: "bounded_read_only_projection",
    },
  );
}

function buildCompletionEvaluator(input = {}) {
  return artifact(
    AGENT_COMPLETION_EVALUATOR_SCHEMA,
    "completionEvaluatorId",
    stableId("wm_agent_evaluator", {
      semanticEventId: input.taskSettlement.semanticEventId,
      outputContractDigest: input.outputContract.digest,
    }),
    {
      outputContractRef: refFor(
        "agent_output_contract",
        input.outputContract,
        "outputContractId",
      ),
      requiredResultSchema: input.outputContract.requiredResultSchema,
      observableRequiredFields: input.outputContract.requiredFields,
      requiredEvidenceRefs:
        input.constitution.requiredEvidenceRefs,
      canObserveRequiredOutput: true,
      canObserveRequiredEvidence: true,
      activityCountsAsCompletion: false,
      canonicalAdmissionCountsAsCompletion: false,
      evaluatorPosture: "postcondition_validation_only",
    },
  );
}

function buildPromptProjection(input = {}) {
  const constitutionProjection =
    input.policyCompilation.policyPromptProjection;
  const currentIngressRef = exactRef(
    input.managerContext.bootPacket.currentIngressRef,
    "prompt.currentIngressRef",
  );
  const outputContractRef = refFor(
    "agent_output_contract",
    input.outputContract,
    "outputContractId",
  );
  const trustedEvidenceArtifacts = Array.isArray(
    input.trustedEvidenceArtifacts,
  )
    ? input.trustedEvidenceArtifacts
    : [];
  const layers = [
    {
      layerKind: "trusted_role_template_projection",
      authority: "trusted_harness_code",
      instructionLines: input.template.systemInstructionLayers,
      sourceRef: refFor(
        "trusted_role_template",
        input.template,
        "roleTemplateId",
      ),
    },
    {
      layerKind: "resolved_task_constitution_projection",
      authority: "compiled_policy_closure",
      instructionLines: constitutionProjection.instructionLines,
      sourceRef: refFor(
        "policy_prompt_projection",
        constitutionProjection,
        "policyPromptProjectionId",
      ),
    },
    {
      layerKind: "current_user_directive",
      authority: "current_user",
      instructionLines: [],
      sourceRef: currentIngressRef,
    },
    {
      layerKind: "admitted_graph_and_evidence_context",
      authority: "quoted_governed_evidence",
      instructionLines: [],
      sourceRef: refFor(
        "agent_evidence_access_contract",
        input.evidenceAccessContract,
        "evidenceAccessContractId",
      ),
    },
    ...trustedEvidenceArtifacts.map((evidence) =>
      [
        TRUSTED_DISCOURSE_EVIDENCE_SCHEMA,
        TRUSTED_SEMANTIC_HISTORY_EVIDENCE_SCHEMA,
      ].includes(evidence.schema)
        ? {
            layerKind:
              evidence.schema ===
                TRUSTED_SEMANTIC_HISTORY_EVIDENCE_SCHEMA
                ? "trusted_semantic_history_evidence"
                : "trusted_discourse_evidence",
            authority:
              evidence.schema ===
                TRUSTED_SEMANTIC_HISTORY_EVIDENCE_SCHEMA
                ? "semantically_indexed_historical_evidence"
                : "targeted_historical_evidence",
            instructionLines: [
              evidence.instruction,
              `${
                evidence.schema ===
                  TRUSTED_SEMANTIC_HISTORY_EVIDENCE_SCHEMA
                  ? "[BOUNDED SEMANTIC-HISTORY EVIDENCE - QUOTED DATA]"
                  : "[TARGETED PRIOR-TURN EVIDENCE - QUOTED DATA]"
              }\n${JSON.stringify(
                evidence.payload,
              )}`,
            ],
            sourceRef: {
              kind:
                evidence.schema ===
                  TRUSTED_SEMANTIC_HISTORY_EVIDENCE_SCHEMA
                  ? "trusted_semantic_history_evidence"
                  : "trusted_discourse_evidence",
              id: evidence.evidenceId,
              digest: evidence.digest,
            },
          }
        : {
            layerKind: "trusted_realization_evidence",
            authority: "harness_observed_evidence",
            instructionLines: [
              evidence.instruction,
              `[HARNESS-OBSERVED REALIZATION OPTIONS]\n${JSON.stringify(
                evidence.options,
              )}`,
            ],
            sourceRef: {
              kind: "trusted_realization_evidence",
              id: evidence.evidenceId,
              digest: evidence.digest,
            },
          }),
    {
      layerKind: "role_response_contract",
      authority: "trusted_harness_code",
      instructionLines:
        input.outputContract.responseMode === "natural_language"
          ? [
              "Return one direct natural-language response to the user.",
              "Do not wrap the response in JSON, a schema-shaped object, or a typed result envelope.",
              "The terminal assistant message is the response anchor. Semantic actions, proposal registration, and canonical effects are separate harness-governed operations.",
              ...(input.taskSettlement.taskType ===
              "world_conversation"
                ? [
                    "Match the scale and tone of the conversational act. Do not append project status, open-decision boilerplate, routing details, or procedural next steps unless the user asked for them or they are materially necessary.",
                  ]
                : []),
            ]
          : [
              `Discharge exactly ${input.outputContract.requiredResultSchema}.`,
              `Required fields: ${input.outputContract.requiredFields.join(", ")}.`,
              "This structured object is a semantic discharge for harness persistence, not a conversational formatting requirement.",
            ],
      sourceRef: outputContractRef,
    },
  ];
  const projection = {
    schema: AGENT_PROMPT_PROJECTION_SCHEMA,
    promptProjectionId: stableId("wm_agent_prompt", {
      semanticEventId: input.taskSettlement.semanticEventId,
      roleTemplateDigest: input.template.digest,
      constitutionDigest:
        input.policyCompilation.resolvedTaskConstitution.digest,
      trustedEvidenceDigests: trustedEvidenceArtifacts.map(
        (entry) => entry.digest,
      ),
    }),
    roleTemplateRef: refFor(
      "trusted_role_template",
      input.template,
      "roleTemplateId",
    ),
    taskConstitutionRef: refFor(
      "resolved_task_constitution",
      input.policyCompilation.resolvedTaskConstitution,
      "taskConstitutionId",
    ),
    contextPolicyRef: refFor(
      "compiled_agent_turn_context_policy",
      input.contextPolicy,
      "policyId",
    ),
    currentUserDirectiveRef: currentIngressRef,
    evidenceAccessContractRef: refFor(
      "agent_evidence_access_contract",
      input.evidenceAccessContract,
      "evidenceAccessContractId",
    ),
    outputContractRef,
    orderedLayers: layers,
    requiredActionClasses:
      input.policyCompilation.resolvedTaskConstitution
        .requiredActionClasses,
    permittedActionClasses:
      input.policyCompilation.resolvedTaskConstitution
        .permittedActionClasses,
    prohibitedActionClasses:
      input.policyCompilation.resolvedTaskConstitution
        .prohibitedActionClasses,
    approvalGatedActionClasses:
      input.policyCompilation.resolvedTaskConstitution
        .approvalGatedActionClasses,
    rendererSuppliedInstructionFieldsAccepted: false,
    modelSuppliedRoleTemplateAccepted: false,
    currentUserTextIncluded: false,
    historicalTranscriptIncluded: false,
    rawChainOfThoughtRequested: false,
    grantsAuthority: false,
  };
  projection.digest = digestFor(
    AGENT_PROMPT_PROJECTION_SCHEMA,
    projection,
    ["digest"],
  );
  return projection;
}

function buildRuntimeProfile(input = {}) {
  return artifact(
    AGENT_RUNTIME_PROFILE_SCHEMA,
    "runtimeProfileId",
    stableId("wm_agent_runtime_profile", {
      semanticEventId: input.taskSettlement.semanticEventId,
      contextPolicyDigest: input.contextPolicy.digest,
    }),
    {
      runtimeFamily: "direct_live_text_controller",
      contextPolicyRef: refFor(
        "compiled_agent_turn_context_policy",
        input.contextPolicy,
        "policyId",
      ),
      transport: "live_text",
      sessionState: "not_created",
      providerTurnState: "not_started",
      runtimeAvailability: "deferred_to_wm_k4",
      previousResponseIdRequired: false,
      rendererMayStartRuntime: false,
    },
  );
}

function buildTrustedInstructionPackage(input = {}) {
  const instructionLines = input.promptProjection.orderedLayers
    .filter((layer) =>
      layer.layerKind !== "current_user_directive" &&
      layer.layerKind !== "admitted_graph_and_evidence_context")
    .flatMap((layer) => layer.instructionLines);
  return artifact(
    TRUSTED_PROVIDER_INSTRUCTION_PACKAGE_SCHEMA,
    "instructionPackageId",
    stableId("wm_instruction_package", {
      promptProjectionDigest: input.promptProjection.digest,
    }),
    {
      promptProjectionRef: refFor(
        "agent_prompt_projection",
        input.promptProjection,
        "promptProjectionId",
      ),
      instructions: instructionLines.join("\n"),
      instructionLineCount: instructionLines.length,
      currentUserDirectiveRef:
        input.promptProjection.currentUserDirectiveRef,
      currentUserTextIncluded: false,
      rendererSuppliedInstructionsAccepted: false,
      sourcePosture: "compiled_from_trusted_template_and_policy_closure",
      providerRequestState: "not_started",
    },
  );
}

function buildManifest(input = {}) {
  const manifest = {
    schema: AGENT_INSTANTIATION_MANIFEST_SCHEMA,
    instanceId: input.agentInstantiationId,
    roleTemplateId: input.template.roleTemplateId,
    roleTemplateRevision: input.template.roleTemplateRevision,
    actorBindingRef: input.actorBindingRef,
    projectBindingRef: input.projectBindingRef,
    taskBindingRef: input.taskBindingRef,
    worldstateRevisionRefs:
      input.managerContext.graphProjection.sourceScopeRevisions,
    policyClosureRef: refFor(
      "resolved_task_constitution",
      input.policyCompilation.resolvedTaskConstitution,
      "taskConstitutionId",
    ),
    sourcePolicyRefs:
      input.policyCompilation.resolvedTaskConstitution.sourcePolicyRefs,
    exceptionRefs:
      input.policyCompilation.resolvedTaskConstitution.activeExceptionRefs,
    projectedObjectRefs: [
      ...input.managerContext.graphProjection.selectedNodeRefs,
      ...input.managerContext.graphProjection.selectedEdgeRefs,
      ...(Array.isArray(input.trustedEvidenceArtifacts)
        ? input.trustedEvidenceArtifacts.map((entry) => ({
            kind:
              entry.schema ===
                TRUSTED_SEMANTIC_HISTORY_EVIDENCE_SCHEMA
                ? "trusted_semantic_history_evidence"
              : entry.schema ===
                  TRUSTED_DISCOURSE_EVIDENCE_SCHEMA
                ? "trusted_discourse_evidence"
                : "trusted_realization_evidence",
            id: entry.evidenceId,
            digest: entry.digest,
          }))
        : []),
    ],
    graphRef: exactRef(
      input.managerContext.contextBundle.graphRef,
      "manifest.graphRef",
    ),
    graphProjectionRef: refFor(
      "worldmodel_graph_projection",
      input.managerContext.graphProjection,
      "projectionId",
      "projectionDigest",
    ),
    bootPacketRef: refFor(
      "manager_turn_boot_packet",
      input.managerContext.bootPacket,
      "bootPacketId",
    ),
    promptDigest: input.promptProjection.digest,
    capabilityDigest: input.capabilityEnvelope.digest,
    authorityDigest: input.authorityEnvelope.digest,
    evaluatorDigest: input.completionEvaluator.digest,
    outputContractDigest: input.outputContract.digest,
    policyClosureDigest:
      input.policyCompilation.resolvedTaskConstitution.policyClosureDigest,
    compilerRevision: COMPILER_REVISION,
    rendererInstructionInputAccepted: false,
    grantsAuthority: false,
  };
  manifest.digest = digestFor(
    AGENT_INSTANTIATION_MANIFEST_SCHEMA,
    manifest,
    ["digest"],
  );
  return manifest;
}

function buildAgentInstantiation(input = {}) {
  const instance = {
    schema: AGENT_INSTANTIATION_SCHEMA,
    agentInstantiationId: input.agentInstantiationId,
    semanticEventId: input.taskSettlement.semanticEventId,
    roleTemplateRef: refFor(
      "trusted_role_template",
      input.template,
      "roleTemplateId",
    ),
    actorBindingRef: input.actorBindingRef,
    projectBindingRef: input.projectBindingRef,
    taskBindingRef: input.taskBindingRef,
    taskConstitutionRef: refFor(
      "resolved_task_constitution",
      input.policyCompilation.resolvedTaskConstitution,
      "taskConstitutionId",
    ),
    graphProjectionRef: refFor(
      "worldmodel_graph_projection",
      input.managerContext.graphProjection,
      "projectionId",
      "projectionDigest",
    ),
    authorityEnvelopeRef: refFor(
      "agent_authority_envelope",
      input.authorityEnvelope,
      "authorityEnvelopeId",
    ),
    capabilityEnvelopeRef: refFor(
      "agent_capability_envelope",
      input.capabilityEnvelope,
      "capabilityEnvelopeId",
    ),
    budgetRef: refFor("agent_budget", input.budget, "budgetId"),
    evidenceAccessContractRef: refFor(
      "agent_evidence_access_contract",
      input.evidenceAccessContract,
      "evidenceAccessContractId",
    ),
    completionEvaluatorRef: refFor(
      "agent_completion_evaluator",
      input.completionEvaluator,
      "completionEvaluatorId",
    ),
    outputContractRef: refFor(
      "agent_output_contract",
      input.outputContract,
      "outputContractId",
    ),
    promptProjectionRef: refFor(
      "agent_prompt_projection",
      input.promptProjection,
      "promptProjectionId",
    ),
    runtimeProfileRef: refFor(
      "agent_runtime_profile",
      input.runtimeProfile,
      "runtimeProfileId",
    ),
    sourceScopeRevisions:
      input.managerContext.graphProjection.sourceScopeRevisions,
    manifestRef: refFor(
      "agent_instantiation_manifest",
      input.manifest,
      "instanceId",
    ),
    status: "compiled",
    runtimeAdmissionState: "ready_for_k4",
    providerRoleTurnState: "not_started",
    rendererInstructionInputAccepted: false,
    grantsAuthority: false,
  };
  instance.digest = digestFor(
    AGENT_INSTANTIATION_SCHEMA,
    instance,
    ["digest"],
  );
  return instance;
}

function digestValid(value, schema) {
  return isPlainObject(value) &&
    value.schema === schema &&
    value.digest === digestFor(schema, value, ["digest"]);
}

function buildProjectionAgreement(input = {}) {
  const disagreements = [];
  const {
    taskSettlement,
    template,
    constitution,
    authorityEnvelope,
    capabilityEnvelope,
    evidenceAccessContract,
    completionEvaluator,
    outputContract,
    promptProjection,
    runtimeProfile,
    manifest,
    managerContext,
    contextPolicy,
  } = input;

  const digestChecks = [
    [constitution, constitution?.schema],
    [authorityEnvelope, AGENT_AUTHORITY_ENVELOPE_SCHEMA],
    [capabilityEnvelope, AGENT_CAPABILITY_ENVELOPE_SCHEMA],
    [
      evidenceAccessContract,
      AGENT_EVIDENCE_ACCESS_CONTRACT_SCHEMA,
    ],
    [completionEvaluator, AGENT_COMPLETION_EVALUATOR_SCHEMA],
    [outputContract, AGENT_OUTPUT_CONTRACT_SCHEMA],
    [promptProjection, AGENT_PROMPT_PROJECTION_SCHEMA],
    [runtimeProfile, AGENT_RUNTIME_PROFILE_SCHEMA],
    [manifest, AGENT_INSTANTIATION_MANIFEST_SCHEMA],
    [
      contextPolicy,
      "direct_compiled_agent_turn_context_policy@1",
    ],
  ];
  for (const [value, schema] of digestChecks) {
    if (!schema || !digestValid(value, schema)) {
      disagreements.push("artifact_digest_or_schema_mismatch");
      break;
    }
  }

  if (
    promptProjection.rendererSuppliedInstructionFieldsAccepted !== false ||
    promptProjection.modelSuppliedRoleTemplateAccepted !== false ||
    promptProjection.currentUserTextIncluded !== false ||
    manifest.rendererInstructionInputAccepted !== false
  ) {
    disagreements.push("untrusted_instruction_input_accepted");
  }
  if (
    template.templateStatus !== "active_k3" ||
    !template.compilerCompatibility.includes(COMPILER_REVISION)
  ) {
    disagreements.push("role_template_or_compiler_unavailable");
  }
  if (
    JSON.stringify(promptProjection.requiredActionClasses) !==
      JSON.stringify(constitution.requiredActionClasses) ||
    JSON.stringify(promptProjection.permittedActionClasses) !==
      JSON.stringify(constitution.permittedActionClasses) ||
    JSON.stringify(promptProjection.prohibitedActionClasses) !==
      JSON.stringify(constitution.prohibitedActionClasses)
  ) {
    disagreements.push("prompt_constitution_disagreement");
  }
  const capabilityConflicts = intersection(
    capabilityEnvelope.grantedActionClasses,
    constitution.prohibitedActionClasses,
  );
  if (
    capabilityConflicts.length ||
    capabilityEnvelope.toolNames.length ||
    capabilityEnvelope.toolCount !== 0 ||
    capabilityEnvelope.workspaceMutationAvailable !== false ||
    capabilityEnvelope.remoteMutationAvailable !== false ||
    capabilityEnvelope.canonicalWriteAvailable !== false
  ) {
    disagreements.push("capability_constitution_disagreement");
  }
  if (
    intersection(
      authorityEnvelope.authorizedActionClasses,
      constitution.prohibitedActionClasses,
    ).length
  ) {
    disagreements.push("authority_constitution_disagreement");
  }
  for (const field of AUTHORITY_BOOLEAN_FIELDS) {
    if (
      authorityEnvelope[field] === true &&
      template.authorityCeiling[field] !== true
    ) {
      disagreements.push("authority_exceeds_role_template");
      break;
    }
  }
  if (
    authorityEnvelope.mayInvokeTools !== false ||
    authorityEnvelope.mayMutateWorkspace !== false ||
    authorityEnvelope.mayMutateRemoteSystems !== false ||
    authorityEnvelope.mayAdmitCanonicalWorldstate !== false ||
    authorityEnvelope.mayStartImplementation !== false
  ) {
    disagreements.push("k3_authority_boundary_exceeded");
  }
  if (
    outputContract.responseMode !== template.responseMode ||
    outputContract.requiredResultSchema !==
      template.requiredOutputSchema ||
    completionEvaluator.requiredResultSchema !==
      outputContract.requiredResultSchema ||
    outputContract.requiredFields.some((field) =>
      !completionEvaluator.observableRequiredFields.includes(field)) ||
    completionEvaluator.canObserveRequiredOutput !== true ||
    completionEvaluator.canObserveRequiredEvidence !== true
  ) {
    disagreements.push("output_evaluator_disagreement");
  }
  if (
    constitution.policyClosureState !== "resolved" ||
    constitution.policyConflictWitnessRefs.length
  ) {
    disagreements.push("policy_closure_unresolved");
  }
  const graphProjection = managerContext?.graphProjection;
  if (
    !graphProjection ||
    graphProjection.projectionDigest !==
      evidenceAccessContract.graphProjectionRef.digest ||
    graphProjection.projectionDigest !==
      manifest.graphProjectionRef.digest ||
    graphProjection.graphRef.digest !== manifest.graphRef.digest ||
    (taskSettlement.projectId &&
      (graphProjection.focalScope?.scopeKind !== "project" ||
        graphProjection.focalScope?.projectId !==
          taskSettlement.projectId))
  ) {
    disagreements.push("graph_projection_stale_or_foreign");
  }
  if (
    manifest.promptDigest !== promptProjection.digest ||
    manifest.capabilityDigest !== capabilityEnvelope.digest ||
    manifest.authorityDigest !== authorityEnvelope.digest ||
    manifest.evaluatorDigest !== completionEvaluator.digest ||
    manifest.outputContractDigest !== outputContract.digest ||
    manifest.policyClosureDigest !== constitution.policyClosureDigest ||
    manifest.compilerRevision !== COMPILER_REVISION
  ) {
    disagreements.push("manifest_projection_disagreement");
  }
  if (
    contextPolicy.policyId !== DIRECT_COMPILED_AGENT_TURN_POLICY_ID ||
    contextPolicy.rendererSystemInstructionAllowed !== false ||
    runtimeProfile.contextPolicyRef.digest !== contextPolicy.digest
  ) {
    disagreements.push("compiled_context_policy_disagreement");
  }

  const uniqueDisagreements = sortedUnique(disagreements);
  const witness = {
    schema: AGENT_WORLD_PROJECTION_AGREEMENT_SCHEMA,
    projectionAgreementId: stableId("wm_projection_agreement", {
      semanticEventId: taskSettlement.semanticEventId,
      manifestDigest: manifest.digest,
      disagreements: uniqueDisagreements,
    }),
    semanticEventId: taskSettlement.semanticEventId,
    agentInstantiationId: manifest.instanceId,
    taskConstitutionRef: refFor(
      "resolved_task_constitution",
      constitution,
      "taskConstitutionId",
    ),
    manifestRef: refFor(
      "agent_instantiation_manifest",
      manifest,
      "instanceId",
    ),
    state: uniqueDisagreements.length ? "blocked" : "validated",
    disagreements: uniqueDisagreements,
    promptCapabilityAuthorityAgreement:
      !uniqueDisagreements.some((entry) =>
        entry.includes("constitution_disagreement") ||
        entry === "authority_exceeds_role_template" ||
        entry === "k3_authority_boundary_exceeded"),
    graphRevisionAgreement:
      !uniqueDisagreements.includes("graph_projection_stale_or_foreign"),
    outputEvaluatorAgreement:
      !uniqueDisagreements.includes("output_evaluator_disagreement"),
    trustedTemplateAgreement:
      !uniqueDisagreements.includes(
        "role_template_or_compiler_unavailable",
      ) &&
      !uniqueDisagreements.includes(
        "untrusted_instruction_input_accepted",
      ),
    launchEligible: uniqueDisagreements.length === 0,
    launchBoundary: uniqueDisagreements.length
      ? "blocked_fail_closed"
      : "ready_for_k4_runtime_only",
    providerRoleTurnState: "not_started",
    canonicalWorldstateMutation: false,
    grantsAuthority: false,
  };
  witness.digest = digestFor(
    AGENT_WORLD_PROJECTION_AGREEMENT_SCHEMA,
    witness,
    ["digest"],
  );
  return witness;
}

function buildCompiledAgentContext(input = {}) {
  const context = {
    schema: COMPILED_AGENT_CONTEXT_SCHEMA,
    compiledAgentContextId: stableId("wm_compiled_agent_context", {
      agentInstantiationDigest: input.agentInstantiation.digest,
      projectionAgreementDigest: input.projectionAgreement.digest,
    }),
    agentInstantiationRef: refFor(
      "agent_instantiation",
      input.agentInstantiation,
      "agentInstantiationId",
    ),
    manifestRef: refFor(
      "agent_instantiation_manifest",
      input.manifest,
      "instanceId",
    ),
    taskConstitutionRef: refFor(
      "resolved_task_constitution",
      input.constitution,
      "taskConstitutionId",
    ),
    projectionAgreementRef: refFor(
      "agent_world_projection_agreement",
      input.projectionAgreement,
      "projectionAgreementId",
    ),
    contextPolicyRef: refFor(
      "compiled_agent_turn_context_policy",
      input.contextPolicy,
      "policyId",
    ),
    trustedInstructionPackage: input.trustedInstructionPackage,
    projectionAgreementState: input.projectionAgreement.state,
    rendererSuppliedInstructionsAccepted: false,
    providerRoleTurnState: "not_started",
    grantsAuthority: false,
  };
  context.digest = digestFor(
    COMPILED_AGENT_CONTEXT_SCHEMA,
    context,
    ["digest"],
  );
  return context;
}

function compileWorldManagerAgentWorld(input = {}) {
  const taskSettlement = input.taskSettlement;
  validateWorldManagerTaskSettlement(taskSettlement);
  if (taskSettlement.state !== "settled") {
    fail("world_manager_agent_world_requires_settled_task");
  }
  const managerContext = input.managerContext;
  if (
    !isPlainObject(managerContext) ||
    managerContext.contextBundle?.semanticEventId !==
      taskSettlement.semanticEventId ||
    managerContext.contextBundle?.providerRoleTurnState !== "not_started"
  ) {
    fail("world_manager_agent_world_context_invalid");
  }
  const template = selectTrustedRoleTemplate(taskSettlement);
  const trustedEvidenceArtifacts = Array.isArray(
    input.trustedEvidenceArtifacts,
  )
    ? input.trustedEvidenceArtifacts
    : [];
  for (const evidence of trustedEvidenceArtifacts) {
    const supportedSchema = [
      TRUSTED_REALIZATION_EVIDENCE_SCHEMA,
      TRUSTED_DISCOURSE_EVIDENCE_SCHEMA,
      TRUSTED_SEMANTIC_HISTORY_EVIDENCE_SCHEMA,
    ].includes(evidence?.schema);
    if (
      !isPlainObject(evidence) ||
      !supportedSchema ||
      evidence.grantsAuthority !== false ||
      evidence.digest !==
        digestFor(
          evidence.schema,
          evidence,
          ["digest"],
        )
    ) {
      fail("world_manager_agent_world_trusted_evidence_invalid");
    }
  }
  const identityRef = projectIdentityRef({
    taskSettlement,
    graphBinding: input.graphBinding,
    managerContext,
  });
  const roleRef = exactRef(
    taskSettlement.selectedManagerAgentRef,
    "agentWorld.roleRef",
  );
  const policyCompilation = compileWorldManagerTaskConstitution({
    taskSettlement,
    userWorldId: input.userWorldId,
    graphRef: managerContext.contextBundle.graphRef,
    graphProjectionRef: {
      kind: "worldmodel_graph_projection",
      id: managerContext.graphProjection.projectionId,
      digest: managerContext.graphProjection.projectionDigest,
    },
    bootPacketRef: {
      kind: "manager_turn_boot_packet",
      id: managerContext.bootPacket.bootPacketId,
      digest: managerContext.bootPacket.digest,
    },
    roleRef,
    projectIdentityRef: identityRef,
    worldIdentityRef: identityRef,
    sourceScopeRevisions:
      managerContext.graphProjection.sourceScopeRevisions,
    authorityDecisionRef: managerContext.authoritySourceRef,
    activePolicies: input.activePolicies,
    activeExceptions: input.activeExceptions,
    environment: input.environment,
  });
  const constitution = policyCompilation.resolvedTaskConstitution;
  validateResolvedTaskConstitution(constitution);
  const contextPolicy = contextPolicyArtifact();
  const actorBindingRef = roleRef;
  const projectBindingRef = identityRef;
  const taskBindingRef = {
    kind: "world_manager_task_settlement",
    id: taskSettlement.taskSettlementId,
    digest: taskSettlement.digest,
  };
  const authorityEnvelope = buildAuthorityEnvelope({
    taskSettlement,
    template,
    constitution,
    managerContext,
  });
  const capabilityEnvelope = buildCapabilityEnvelope({
    taskSettlement,
    template,
    constitution,
  });
  const budget = buildBudget({ taskSettlement, template });
  const outputContract = buildOutputContract({
    taskSettlement,
    template,
  });
  const evidenceAccessContract = buildEvidenceAccessContract({
    taskSettlement,
    managerContext,
  });
  const completionEvaluator = buildCompletionEvaluator({
    taskSettlement,
    constitution,
    outputContract,
  });
  const promptProjection = buildPromptProjection({
    taskSettlement,
    template,
    managerContext,
    policyCompilation,
    contextPolicy,
    outputContract,
    evidenceAccessContract,
    trustedEvidenceArtifacts,
  });
  const runtimeProfile = buildRuntimeProfile({
    taskSettlement,
    contextPolicy,
  });
  const trustedInstructionPackage = buildTrustedInstructionPackage({
    promptProjection,
  });
  const agentInstantiationId = stableId("wm_agent_instantiation", {
    semanticEventId: taskSettlement.semanticEventId,
    roleTemplateDigest: template.digest,
    constitutionDigest: constitution.digest,
    promptDigest: promptProjection.digest,
  });
  const manifest = buildManifest({
    agentInstantiationId,
    template,
    actorBindingRef,
    projectBindingRef,
    taskBindingRef,
    managerContext,
    policyCompilation,
    promptProjection,
    capabilityEnvelope,
    authorityEnvelope,
    completionEvaluator,
    outputContract,
    trustedEvidenceArtifacts,
  });
  const agreementInput = {
    taskSettlement,
    template,
    constitution,
    authorityEnvelope,
    capabilityEnvelope,
    evidenceAccessContract,
    completionEvaluator,
    outputContract,
    promptProjection,
    runtimeProfile,
    manifest,
    managerContext,
    contextPolicy,
  };
  const projectionAgreement = buildProjectionAgreement(agreementInput);
  if (projectionAgreement.state !== "validated") {
    fail(
      "world_manager_agent_world_projection_agreement_blocked",
      projectionAgreement.disagreements.join(","),
    );
  }
  const agentInstantiation = buildAgentInstantiation({
    agentInstantiationId,
    taskSettlement,
    template,
    actorBindingRef,
    projectBindingRef,
    taskBindingRef,
    managerContext,
    policyCompilation,
    authorityEnvelope,
    capabilityEnvelope,
    budget,
    evidenceAccessContract,
    completionEvaluator,
    outputContract,
    promptProjection,
    runtimeProfile,
    manifest,
  });
  const compiledAgentContext = buildCompiledAgentContext({
    agentInstantiation,
    manifest,
    constitution,
    projectionAgreement,
    contextPolicy,
    trustedInstructionPackage,
    trustedEvidenceArtifacts,
  });
  const compilation = {
    schema: AGENT_WORLD_COMPILATION_SCHEMA,
    agentWorldCompilationId: stableId("wm_agent_world_compilation", {
      semanticEventId: taskSettlement.semanticEventId,
      agentInstantiationDigest: agentInstantiation.digest,
    }),
    semanticEventId: taskSettlement.semanticEventId,
    taskSettlementRef: taskBindingRef,
    roleTemplateRegistryRef: refFor(
      "trusted_role_template_registry",
      trustedRoleTemplateRegistry(),
      "registryId",
    ),
    roleTemplate: template,
    policyCompilation,
    contextPolicy,
    authorityEnvelope,
    capabilityEnvelope,
    budget,
    evidenceAccessContract,
    completionEvaluator,
    outputContract,
    promptProjection,
    runtimeProfile,
    trustedInstructionPackage,
    trustedEvidenceArtifacts,
    manifest,
    agentInstantiation,
    projectionAgreement,
    compiledAgentContext,
    compilationState: "validated_ready_for_k4",
    providerRoleTurnState: "not_started",
    providerRequestCreated: false,
    rendererInstructionInputAccepted: false,
    canonicalWorldstateMutation: false,
    grantsAuthority: false,
  };
  compilation.digest = digestFor(
    AGENT_WORLD_COMPILATION_SCHEMA,
    compilation,
    ["digest"],
  );
  return {
    compilation,
    agreementInput,
  };
}

function rendererSafeAgentWorldSummary(compilation) {
  if (
    !isPlainObject(compilation) ||
    compilation.schema !== AGENT_WORLD_COMPILATION_SCHEMA ||
    compilation.digest !==
      digestFor(AGENT_WORLD_COMPILATION_SCHEMA, compilation, ["digest"])
  ) {
    fail("world_manager_agent_world_compilation_invalid");
  }
  const constitution =
    compilation.policyCompilation.resolvedTaskConstitution;
  const realizationEvidence =
    compilation.trustedEvidenceArtifacts?.find((entry) =>
      entry.schema === TRUSTED_REALIZATION_EVIDENCE_SCHEMA) ||
    null;
  const discourseEvidence =
    compilation.trustedEvidenceArtifacts?.find((entry) =>
      entry.schema === TRUSTED_DISCOURSE_EVIDENCE_SCHEMA) ||
    null;
  const semanticHistoryEvidence =
    compilation.trustedEvidenceArtifacts?.find((entry) =>
      entry.schema ===
        TRUSTED_SEMANTIC_HISTORY_EVIDENCE_SCHEMA) ||
    null;
  const historicalEvidence =
    semanticHistoryEvidence || discourseEvidence;
  return {
    schema: "direct_world_manager_k3_agent_world_summary@1",
    semanticEventId: compilation.semanticEventId,
    agentWorldCompilationId: compilation.agentWorldCompilationId,
    agentWorldCompilationDigest: compilation.digest,
    roleTemplateId: compilation.roleTemplate.roleTemplateId,
    roleTemplateRevision:
      compilation.roleTemplate.roleTemplateRevision,
    taskConstitutionId: constitution.taskConstitutionId,
    taskConstitutionDigest: constitution.digest,
    policyClosureDigest: constitution.policyClosureDigest,
    policyClosureState: constitution.policyClosureState,
    sourcePolicyRefs: constitution.sourcePolicyRefs,
    sourceScopeRevisions: constitution.sourceScopeRevisions,
    requiredActionClasses: constitution.requiredActionClasses,
    permittedActionClasses: constitution.permittedActionClasses,
    prohibitedActionClasses: constitution.prohibitedActionClasses,
    approvalGatedActionClasses:
      constitution.approvalGatedActionClasses,
    activeExceptionRefs: constitution.activeExceptionRefs,
    conflictWitnessRefs: constitution.policyConflictWitnessRefs,
    policyObjectCount:
      compilation.policyCompilation.policyObjects.length,
    policySourcePostures: sortedUnique(
      compilation.policyCompilation.policyObjects.map((policy) =>
        policy.sourcePosture),
    ),
    enforcementStrength:
      compilation.policyCompilation.policyEnforcementProjection
        .enforcementStrength,
    agentInstantiationId:
      compilation.agentInstantiation.agentInstantiationId,
    agentInstantiationDigest: compilation.agentInstantiation.digest,
    manifestId: compilation.manifest.instanceId,
    manifestDigest: compilation.manifest.digest,
    graphRef: compilation.manifest.graphRef,
    graphProjectionRef: compilation.manifest.graphProjectionRef,
    bootPacketRef: compilation.manifest.bootPacketRef,
    promptDigest: compilation.manifest.promptDigest,
    capabilityDigest: compilation.manifest.capabilityDigest,
    authorityDigest: compilation.manifest.authorityDigest,
    evaluatorDigest: compilation.manifest.evaluatorDigest,
    outputContractDigest:
      compilation.manifest.outputContractDigest,
    trustedRealizationEvidenceRef:
      realizationEvidence
        ? {
            kind: "trusted_realization_evidence",
            id: realizationEvidence.evidenceId,
            digest: realizationEvidence.digest,
          }
        : null,
    trustedRealizationOptionCount:
      realizationEvidence?.options?.length || 0,
    trustedDiscourseEvidenceRef:
      historicalEvidence
        ? {
            kind: semanticHistoryEvidence
              ? "trusted_semantic_history_evidence"
              : "trusted_discourse_evidence",
            id: historicalEvidence.evidenceId,
            digest: historicalEvidence.digest,
          }
        : null,
    trustedDiscourseSelectedTurnCount:
      historicalEvidence?.selectedTurnCount || 0,
    trustedDiscourseSelectionMode:
      historicalEvidence?.selectionMode || "",
    trustedSemanticHistoryEvidenceRef:
      semanticHistoryEvidence
        ? {
            kind: "trusted_semantic_history_evidence",
            id: semanticHistoryEvidence.evidenceId,
            digest: semanticHistoryEvidence.digest,
          }
        : null,
    trustedSemanticHistorySelectedTurnCount:
      semanticHistoryEvidence?.selectedTurnCount || 0,
    trustedSemanticHistorySelectedShelfCount:
      semanticHistoryEvidence?.selectedShelfCount || 0,
    toolNames: compilation.capabilityEnvelope.toolNames,
    toolCount: compilation.capabilityEnvelope.toolCount,
    workspaceMutationAvailable:
      compilation.capabilityEnvelope.workspaceMutationAvailable,
    remoteMutationAvailable:
      compilation.capabilityEnvelope.remoteMutationAvailable,
    canonicalWriteAvailable:
      compilation.capabilityEnvelope.canonicalWriteAvailable,
    projectionAgreementId:
      compilation.projectionAgreement.projectionAgreementId,
    projectionAgreementDigest:
      compilation.projectionAgreement.digest,
    projectionAgreementState:
      compilation.projectionAgreement.state,
    projectionDisagreements:
      compilation.projectionAgreement.disagreements,
    launchEligible:
      compilation.projectionAgreement.launchEligible,
    launchBoundary:
      compilation.projectionAgreement.launchBoundary,
    contextPolicyId: compilation.contextPolicy.policyId,
    rendererInstructionInputAccepted: false,
    providerRoleTurnState: "not_started",
    providerRequestCreated: false,
    canonicalWorldstateMutation: false,
    grantsAuthority: false,
  };
}

module.exports = {
  AGENT_AUTHORITY_ENVELOPE_SCHEMA,
  AGENT_CAPABILITY_ENVELOPE_SCHEMA,
  AGENT_COMPLETION_EVALUATOR_SCHEMA,
  AGENT_EVIDENCE_ACCESS_CONTRACT_SCHEMA,
  AGENT_INSTANTIATION_MANIFEST_SCHEMA,
  AGENT_INSTANTIATION_SCHEMA,
  AGENT_OUTPUT_CONTRACT_SCHEMA,
  AGENT_PROMPT_PROJECTION_SCHEMA,
  AGENT_RUNTIME_PROFILE_SCHEMA,
  AGENT_WORLD_COMPILATION_SCHEMA,
  AGENT_WORLD_PROJECTION_AGREEMENT_SCHEMA,
  COMPILED_AGENT_CONTEXT_SCHEMA,
  COMPILER_REVISION,
  TRUSTED_PROVIDER_INSTRUCTION_PACKAGE_SCHEMA,
  buildProjectionAgreement,
  compileWorldManagerAgentWorld,
  contextPolicyArtifact,
  rendererSafeAgentWorldSummary,
};
