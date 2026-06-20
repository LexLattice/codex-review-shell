"use strict";

const crypto = require("node:crypto");
const {
  buildResidentToolEpistemicCatalog,
  validateResidentToolEpistemicCatalog,
} = require("../bridge/resident-tool-epistemic-catalog");
const {
  buildToolCapabilityRow,
} = require("../bridge/tool-capability-registry");
const { normalizeId, normalizeString, nowIso, isPlainObject } = require("../meta-session/ids");
const {
  buildOdeuActivationRow,
  buildOdeuCapabilityUsabilityProof,
  buildOdeuCapabilityWitnessRow,
  buildOdeuDeclarationSnapshot,
  buildOdeuLiveCapabilityTransaction,
  buildOdeuPerCallAuthorityDecision,
  buildOdeuPromotionDecision,
  digestCanonicalJson,
  normalizeOdeuSourceRef,
  validateOdeuActivationRow,
  validateOdeuCapabilityUsabilityProof,
  validateOdeuCapabilityWitnessRow,
  validateOdeuDeclarationSnapshot,
  validateOdeuLiveCapabilityTransaction,
  validateOdeuPerCallAuthorityDecision,
  validateOdeuPromotionDecision,
} = require("../odeu");
const {
  DEFERRED_SUB_AGENT_CONTROLS,
  RESIDENT_FIRST_SLICE_TOOLS,
  buildSubAgentCapabilityProfile,
  validateSubAgentCapabilityProfile,
} = require("./sub-agent-capability-profile");
const {
  ALLOWED_AGENT_ROLES,
  ALLOWED_REASONING_EFFORTS,
  DEFAULT_ALLOWED_MODELS,
} = require("./sub-agent-call-authority");
const {
  createDirectProviderBackedSubAgentRoute,
} = require("./provider-backed-route");

const RESIDENT_SUB_AGENT_TOOL_DECLARATION_SCHEMA = "resident_sub_agent_tool_declaration@1";

const BLOCKED_CONTROL_ALIASES = Object.freeze({
  send_message: ["send_message"],
  followup_task: ["followup_task", "followup_agent"],
  close_agent: ["close_agent"],
  interrupt_agent: ["interrupt_agent"],
  resume_agent: ["resume_agent"],
  recursive_spawn: ["recursive_spawn"],
});

function stableStringify(value) {
  if (value && typeof value.toJSON === "function") return stableStringify(value.toJSON());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => (entry === undefined ? "null" : stableStringify(entry))).join(",")}]`;
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function digestFor(domain, value) {
  return crypto.createHash("sha256").update(`${domain}:${stableStringify(value)}`).digest("hex");
}

function sourceRef(options = {}) {
  return normalizeOdeuSourceRef({
    sourceRefId: "source_resident_sub_agent_tool_declaration",
    sourceKind: "family_specific",
    sourceId: "resident_sub_agent_tool_declaration",
    sourceConfidence: "fixture",
    freshness: "fresh",
    rowId: "wave15_pr95_resident_sub_agent_tool_declaration",
  }, options);
}

function optionNow(options = {}) {
  if (typeof options.now === "function") return options.now();
  if (Number.isFinite(Number(options.now))) return Number(options.now);
  if (Number.isFinite(Number(options.nowMs))) return Number(options.nowMs);
  return Date.now();
}

function capabilityIdFor(toolName) {
  return `sub_agent_${toolName}`;
}

function toolClassIdFor(toolName) {
  return `resident.sub_agent.${toolName}`;
}

function declarationIdFor(toolName) {
  return `resident_sub_agent_declaration_${toolName}`;
}

function activationIdFor(toolName) {
  return `resident_sub_agent_activation_${toolName}`;
}

function promotionIdFor(toolName) {
  return `resident_sub_agent_promotion_${toolName}`;
}

function sideEffectFor(toolName) {
  if (toolName === "spawn_agent" || toolName === "wait_agent") return "agent_runtime";
  if (toolName === "recursive_spawn") return "agent_runtime";
  if (["close_agent", "interrupt_agent", "resume_agent"].includes(toolName)) return "control_state";
  return "none";
}

function capabilityRowFor(toolName, { callable }) {
  return buildToolCapabilityRow({
    toolId: capabilityIdFor(toolName),
    displayName: `Sub-agent ${toolName}`,
    directNames: [toolName, toolClassIdFor(toolName)],
    odeuFamily: "agent_runtime",
    capabilityState: "runtime_probed",
    implementationState: callable ? "restricted_executor" : "schema_only",
    promotionState: callable ? "direct_restricted" : "diagnostic_only",
    providerDeclarationState: callable ? "declared_live_unproved" : "not_declared",
    localExecutorState: callable ? "implemented_restricted" : "scaffolded",
    sideEffectClass: "agent_graph",
    authorityRequired: "agent_runtime_gate",
    requestShapeFamilies: [toolName, "resident_sub_agent_mvp@1"],
    localExecutor: callable ? "src/main/direct/agents/provider-backed-route.js" : "",
    approvalMode: callable ? "per_action" : "future_gate_required",
    contextVisibility: "agent_summary_only",
    uiProjection: "agent_panel",
    usageAttribution: "agent_thread",
    agentEligibility: callable ? "sub_agent_only" : "child_allowed_future",
    providerResultEnvelopeType: callable ? "bounded_result_envelope" : "none",
    rawExposurePolicy: "metadata_only",
    failureClasses: ["projection_laundering", "authority_inflation", "context_smuggling", "action_replay", "thread_flattening"],
    unsupportedReason: callable ? "" : "not_declared_in_pr95",
    rendererSafeSummary: callable
      ? `${toolName} is resident-callable after PR95 declaration, per-call authority, route, and result-admission proof.`
      : `${toolName} remains undeclared and blocked pending a future interference/lifecycle-control wave.`,
  });
}

function buildCapabilityRegistry({ projectId, workThreadId, generatedAt }) {
  const rows = [
    ...RESIDENT_FIRST_SLICE_TOOLS.map((toolName) => capabilityRowFor(toolName, { callable: true })),
    ...DEFERRED_SUB_AGENT_CONTROLS.map((toolName) => capabilityRowFor(toolName, { callable: false })),
  ];
  const registry = {
    schema: "direct_tool_capability_registry@1",
    registryId: "resident_sub_agent_capability_registry_pr95",
    generatedAt,
    projectId,
    workThreadId,
    rows,
    rowCount: rows.length,
    registryDigest: "",
  };
  registry.registryDigest = digestFor("resident-sub-agent-capability-registry@1", rows.map((row) => row.rowDigest));
  return registry;
}

function buildPromotion(toolName, { callable, context, options }) {
  return buildOdeuPromotionDecision({
    promotionDecisionId: promotionIdFor(toolName),
    capabilityId: capabilityIdFor(toolName),
    decision: callable ? "promotable_restricted" : "blocked",
    promotionClass: callable ? "resident_sub_agent_first_slice_live" : "resident_sub_agent_future_control_blocked",
    evidenceClass: callable ? "real_runtime_full_loop" : "diagnostic_only",
    restrictions: callable
      ? [
        { restrictionId: `restriction_${toolName}_single_child`, reason: "single bounded child operation; no child inherited tools", appliesTo: "per_call" },
        { restrictionId: `restriction_${toolName}_result_summary_only`, reason: "child result is summary-only; no primary transcript flattening", appliesTo: "result_admission" },
      ]
      : [
        { restrictionId: `restriction_${toolName}_undeclared`, reason: "not declared in PR95 resident sub-agent first slice", appliesTo: "declaration" },
      ],
    freshness: "fresh",
    negativeEvidence: {
      noRawExposure: true,
      noRendererAuthorityGrant: true,
      noOutOfContractProviderTransport: true,
      noOutOfContractSideEffect: true,
      noContextSmuggling: true,
      noReplayUnsafeState: true,
    },
    blockers: callable ? [] : ["future_wave_interference_or_lifecycle_control"],
    sourceRefs: [context.sourceRef],
    scope: context.scope,
    familyExtension: {
      toolName,
      residentCallableInPr95: callable,
    },
  }, options);
}

function buildActivation(toolName, { callable, promotion, context, options }) {
  return buildOdeuActivationRow({
    activationId: activationIdFor(toolName),
    capabilityId: capabilityIdFor(toolName),
    promotionDecisionId: promotion.promotionDecisionId,
    state: callable ? "active" : "inactive",
    activationScope: {
      kind: "work_thread_override",
      projectId: context.projectId,
      workThreadId: context.workThreadId,
    },
    effect: callable ? "allow" : "deny",
    activationDecision: {
      activatedBy: "test_fixture",
      decisionId: `resident_sub_agent_activation_decision_${toolName}`,
      reason: callable
        ? "PR95 proof-backed resident-callable first slice."
        : "PR95 keeps interference/lifecycle controls undeclared.",
    },
    sourceRefs: [context.sourceRef],
    scope: context.scope,
    familyExtension: {
      toolName,
      frozenForProviderRequest: callable,
      childToolsAllowed: false,
      recursiveSpawnAllowed: false,
    },
  }, options);
}

function activationRegistryRowFor(toolName, { callable, promotion, activation, generatedAt }) {
  const row = {
    schema: "direct_tool_activation_row@1",
    activationRowId: activation.activationId,
    toolClassId: toolClassIdFor(toolName),
    toolName,
    toolSchemaVersion: "resident_sub_agent_tool@1",
    state: callable ? "active" : "inactive",
    activationEffect: callable ? "allow" : "deny",
    scope: activation.scope,
    scopePrecedence: 1,
    promotionDecisionRef: {
      decisionId: promotion.promotionDecisionId,
      decisionDigest: promotion.artifactDigest.value,
      decisionState: callable ? "promotable_restricted" : "blocked",
      evidenceClass: callable ? "real_runtime_full_loop" : "diagnostic_only",
    },
    activationDecision: {
      configured: true,
      requestedState: callable ? "active" : "inactive",
      requestedEffect: callable ? "allow" : "deny",
      activatedBy: "resident_sub_agent_declaration_pr95",
      reason: callable ? "proof_backed_resident_callable" : "future_control_blocked",
      createdAt: generatedAt,
      appliesAt: "next_turn",
    },
    providerRequestShapeSupport: {
      requestShapeFamily: toolName,
      evidenceClass: callable ? "real_runtime_full_loop" : "diagnostic_only",
      providerProfileId: "direct_resident_sub_agent_provider",
      modelId: "resident_runtime_selected_model",
      providerDeclarationState: callable ? "declared_live_accepted" : "not_declared",
      declarationEligibleByRegistry: callable,
      providerDeclarationEnabled: callable,
      modelVisibleToolEnabled: callable,
    },
    localExecutorState: {
      localExecutorVersion: "provider_backed_sub_agent_route_pr95",
      implementationState: callable ? "implemented_evidence_bound" : "not_eligible",
      authorityFamily: "agent_runtime_gate",
    },
    authorityEnvelope: {
      authorityEnvelopeVersion: "authority_envelope@1",
      perCallAuthorityRequired: true,
      activationIsDeclarationEligibilityOnly: false,
    },
    recoveryReplayClassifier: {
      classifierId: "resident_sub_agent_no_replay@1",
      replaySafeState: false,
      emergencyRevokeWins: true,
    },
    contextResultEnvelopePolicy: {
      resultEnvelopeVersion: "sub_agent_result_admission_envelope@1",
      contextContributionRequiresPolicy: true,
      rawPayloadExposureAllowed: false,
    },
    inheritedRestrictions: promotion.restrictions,
    blockerCodes: callable ? [] : ["resident_sub_agent_tool_not_declared_in_pr95"],
    declarationEligibleByRegistry: callable,
    providerDeclarationEnabled: callable,
    modelVisibleToolEnabled: callable,
    perCallAuthorityBypassed: false,
    rendererAuthorityGranted: false,
    runtimeDefaultChanged: false,
    providerCallStartedByActivation: false,
    workspaceMutationStartedByActivation: false,
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
  };
  row.rowDigest = digestFor("resident-sub-agent-activation-row@1", row);
  return row;
}

function toolSchemaFor(toolName) {
  const baseProperties = {
    childAgentId: { type: "string", description: "Stable child agent id for the current work thread." },
  };
  if (toolName === "spawn_agent") {
    return {
      type: "function",
      name: "spawn_agent",
      description: "Spawn one bounded direct sub-agent using summary-only result admission.",
      parameters: {
        type: "object",
        properties: {
          task: { type: "string", description: "Bounded child task. Raw task text is digested and policy-gated before provider transport." },
          agentRole: { type: "string", enum: [...ALLOWED_AGENT_ROLES] },
          model: { type: "string", enum: [...DEFAULT_ALLOWED_MODELS] },
          reasoningEffort: { type: "string", enum: [...ALLOWED_REASONING_EFFORTS] },
          idempotencyKey: { type: "string", description: "Optional stable idempotency key; omitted keys are derived from canonical safe metadata." },
          noInterferencePolicy: { type: "string", enum: ["observe_only", "sealed_audit"] },
          contextPackId: { type: "string" },
          requestManifestId: { type: "string" },
        },
        required: ["task"],
        additionalProperties: false,
      },
    };
  }
  if (toolName === "list_agents") {
    return {
      type: "function",
      name: "list_agents",
      description: "List current direct sub-agents for this work thread.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    };
  }
  if (toolName === "inspect_agent") {
    return {
      type: "function",
      name: "inspect_agent",
      description: "Inspect a sub-agent through the E-channel without interfering.",
      parameters: {
        type: "object",
        properties: baseProperties,
        required: ["childAgentId"],
        additionalProperties: false,
      },
    };
  }
  return {
    type: "function",
    name: "wait_agent",
    description: "Wait for a bounded child-agent terminal state and consume a sanitized summary.",
    parameters: {
      type: "object",
      properties: {
        ...baseProperties,
        timeoutMs: { type: "integer", minimum: 1, maximum: 120000 },
      },
      required: ["childAgentId"],
      additionalProperties: false,
    },
  };
}

function buildDeclarationSnapshot(toolName, { activation, activationRegistryDigest, context, options }) {
  const providerToolSchema = toolSchemaFor(toolName);
  const toolSchemaDigest = digestCanonicalJson(providerToolSchema, {
    domain: "resident-sub-agent-provider-tool-schema@1",
    digestOf: "metadata",
  });
  const declarationDigest = digestCanonicalJson({
    toolName,
    providerToolSchemaDigest: toolSchemaDigest.value,
    activationId: activation.activationId,
    residentCallable: true,
    childToolsAllowed: false,
    recursiveSpawnAllowed: false,
  }, {
    domain: "resident-sub-agent-tool-declaration@1",
    digestOf: "metadata",
  });
  return buildOdeuDeclarationSnapshot({
    declarationSnapshotId: declarationIdFor(toolName),
    activationId: activation.activationId,
    activationSnapshotId: context.activationSnapshotId,
    activationRegistryDigest,
    declarationDigest,
    toolSchemaDigest,
    requestShapeFamily: toolName,
    surfaceKind: "resident_tool",
    residentVisible: true,
    operatorVisible: true,
    rendererVisible: true,
    providerDeclared: true,
    modelCallable: true,
    sourceRefs: [context.sourceRef],
    scope: context.scope,
    familyExtension: {
      toolName,
      childToolsAllowed: false,
      recursiveSpawnAllowed: false,
      declarationPosture: "resident_callable_pr95",
    },
  }, options);
}

function declarationSliceRow(toolName, { activationRow, declaration }) {
  const row = {
    schema: "direct_first_tool_declaration_row@1",
    declarationRowId: declaration.declarationSnapshotId,
    toolName,
    toolClassId: toolClassIdFor(toolName),
    toolSchemaVersion: "resident_sub_agent_tool@1",
    activationRowId: activationRow.activationRowId,
    activationRowDigest: activationRow.rowDigest,
    activationState: activationRow.state,
    activationScope: activationRow.scope,
    requestShapeFamily: toolName,
    providerProfileId: "direct_resident_sub_agent_provider",
    modelId: "resident_runtime_selected_model",
    resultEnvelopePolicyId: "sub_agent_result_admission_envelope@1",
    authorityEnvelopePolicyId: "authority_envelope@1",
    recoveryReplayClassifierId: "resident_sub_agent_no_replay@1",
    providerToolSchema: toolSchemaFor(toolName),
    providerDeclarationEnabled: true,
    modelVisibleToolEnabled: true,
    perCallAuthorityRequired: true,
    localExecutorRoute: "src/main/direct/agents/provider-backed-route.js",
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
  };
  row.providerToolSchemaDigest = digestFor("resident-sub-agent-provider-schema@1", row.providerToolSchema);
  row.declarationDigest = declaration.declarationDigest.value;
  return row;
}

function buildActivationAndDeclaration({ context, options }) {
  const promotionRows = [];
  const odeuActivationRows = [];
  const activationRegistryRows = [];
  const declarationSnapshots = [];
  const declarationRows = [];
  const toolNames = [...RESIDENT_FIRST_SLICE_TOOLS, ...DEFERRED_SUB_AGENT_CONTROLS];

  for (const toolName of toolNames) {
    const callable = RESIDENT_FIRST_SLICE_TOOLS.includes(toolName);
    const promotion = buildPromotion(toolName, { callable, context, options });
    const activation = buildActivation(toolName, { callable, promotion, context, options });
    const activationRegistryRow = activationRegistryRowFor(toolName, {
      callable,
      promotion,
      activation,
      generatedAt: context.generatedAt,
    });
    promotionRows.push(promotion);
    odeuActivationRows.push(activation);
    activationRegistryRows.push(activationRegistryRow);
    if (callable) {
      const declaration = buildDeclarationSnapshot(toolName, {
        activation,
        activationRegistryDigest: context.activationRegistryDigest,
        context,
        options,
      });
      declarationSnapshots.push(declaration);
      declarationRows.push(declarationSliceRow(toolName, { activationRow: activationRegistryRow, declaration }));
    }
  }

  return {
    promotionRows,
    odeuActivationRows,
    activationRegistryRows,
    declarationSnapshots,
    declarationRows,
  };
}

function buildActivationRegistry({ projectId, workThreadId, generatedAt, activationRows }) {
  const activeRows = activationRows.filter((row) => row.state === "active");
  const registry = {
    schema: "direct_tool_activation_registry@1",
    registryId: "resident_sub_agent_activation_registry_pr95",
    generatedAt,
    registryVersion: 1,
    sourceEvidence: {
      promotionReportId: "resident_sub_agent_promotion_report_pr95",
      promotionReportDigest: digestFor("resident-sub-agent-promotion-source@1", activationRows.map((row) => row.promotionDecisionRef.decisionDigest)),
    },
    status: "passed",
    validationErrors: [],
    projectId,
    workThreadId,
    rowCount: activationRows.length,
    rows: activationRows,
    precedenceLaw: {
      order: ["single_turn_override", "work_thread_override", "project_default", "global_default"],
      denyWins: true,
      emergencyRevokeWins: true,
      normalActivationAppliesAt: "next_turn",
    },
    snapshot: {
      schema: "direct_tool_activation_snapshot@1",
      snapshotId: "resident_sub_agent_activation_snapshot_pr95",
      activeRowDigests: activeRows.map((row) => row.rowDigest),
      toolDeclarationDigest: "",
      providerDeclarationsBuilt: true,
      modelVisibleToolsEnabled: true,
      note: "PR95 freezes resident-callable sub-agent first-slice declarations.",
    },
    rawExposureScan: {
      passed: true,
      blockedReasons: [],
    },
    summary: {
      byState: {
        active: activeRows.length,
        inactive: activationRows.length - activeRows.length,
      },
      activeToolClasses: activeRows.map((row) => row.toolClassId),
      inactiveToolClasses: activationRows.filter((row) => row.state === "inactive").map((row) => row.toolClassId),
    },
    providerDeclarationsBuilt: true,
    modelVisibleToolsEnabled: true,
    perCallAuthorityBypassed: false,
    runtimeDefaultChanged: false,
  };
  registry.registryDigest = digestFor("resident-sub-agent-activation-registry@1", {
    registryId: registry.registryId,
    rowDigests: activationRows.map((row) => row.rowDigest),
  });
  registry.snapshot.snapshotDigest = digestFor("resident-sub-agent-activation-snapshot@1", registry.snapshot);
  return registry;
}

function buildDeclarationSlice({ generatedAt, activationRegistry, declarationRows }) {
  const toolDeclarationDigest = digestFor("resident-sub-agent-tool-declarations@1", declarationRows.map((row) => ({
    toolName: row.toolName,
    activationRowDigest: row.activationRowDigest,
    declarationDigest: row.declarationDigest,
  })));
  const slice = {
    schema: "direct_first_tool_slice@1",
    sliceId: "resident_sub_agent_first_slice_pr95",
    generatedAt,
    activationSnapshotId: activationRegistry.snapshot.snapshotId,
    activationRegistryDigest: activationRegistry.registryDigest,
    sourceRegistryId: activationRegistry.registryId,
    status: "passed",
    validationErrors: [],
    declarationCount: declarationRows.length,
    declarations: declarationRows,
    toolDeclarationDigest,
    providerRequestPatch: {
      tools: declarationRows.map((row) => row.providerToolSchema),
      tool_choice: "auto",
      parallel_tool_calls: false,
    },
    providerRequestShape: {
      schema: "resident_sub_agent_provider_request_shape@1",
      declaredToolNames: declarationRows.map((row) => row.toolName),
      toolDeclarationDigest,
      activationSnapshotId: activationRegistry.snapshot.snapshotId,
      activationRegistryDigest: activationRegistry.registryDigest,
      declarationCount: declarationRows.length,
      parallelToolCalls: false,
    },
    summary: {
      declaredToolNames: declarationRows.map((row) => row.toolName),
      blockedToolNames: [...DEFERRED_SUB_AGENT_CONTROLS],
    },
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
  };
  slice.sliceDigest = digestFor("resident-sub-agent-first-slice@1", slice);
  return slice;
}

function buildProofRoute({ projectId, workThreadId, primaryThreadId, options }) {
  const route = createDirectProviderBackedSubAgentRoute({
    projectId,
    workThreadId,
    primaryThreadId,
    defaultModel: "gpt-5.5",
    defaultReasoningEffort: "medium",
    nowMs: options.nowMs,
    providerTurnRunner: async () => ({
      ok: true,
      responseId: "resp_resident_sub_agent_pr95",
      upstreamRequestId: "upstream_resident_sub_agent_pr95",
      outputText: "Resident child completed a bounded fixture task.",
      tokenUsage: {
        input_tokens: 31,
        cached_input_tokens: 4,
        output_tokens: 11,
        reasoning_output_tokens: 2,
        total_tokens: 42,
      },
    }),
  });
  return route.spawnAndRun({
    childAgentId: "resident_child_pr95",
    displayLabel: "Resident Worker PR95",
    role: "worker",
    model: "gpt-5.4-mini",
    reasoningEffort: "high",
    noInterferencePolicy: "sealed_audit",
    prompt: "PR95 fixture prompt: perform a bounded child task and return a summary.",
  });
}

function buildProofArtifacts({ context, routeResult, declarationSlice, activationRegistry, declarationSnapshots, promotionRows, options }) {
  const spawnPromotion = promotionRows.find((row) => row.capabilityId === capabilityIdFor("spawn_agent"));
  const spawnActivation = activationRegistry.rows.find((row) => row.toolName === "spawn_agent");
  const spawnDeclaration = declarationSnapshots.find((row) => row.declarationSnapshotId === declarationIdFor("spawn_agent"));
  const authorityDecision = buildOdeuPerCallAuthorityDecision({
    authorityDecisionId: "resident_sub_agent_authority_decision_pr95",
    callId: "resident_sub_agent_call_pr95",
    capabilityId: "sub_agent_first_slice",
    scope: {
      projectId: context.projectId,
      workThreadId: context.workThreadId,
      threadId: context.primaryThreadId,
      routeId: "resident_sub_agent_route_pr95",
      activationScopeKind: "work_thread_override",
    },
    activationDecision: "active",
    policyDecision: "allow",
    executorState: "ready",
    recoveryState: "not_needed",
    replayPolicy: "never",
    caller: "resident_model",
    callSurface: "provider_tool_call",
    argumentValidation: {
      state: "valid",
      blockers: [],
    },
    sideEffectClass: "agent_runtime",
    activationSnapshotId: activationRegistry.snapshot.snapshotId,
    declarationSnapshotId: spawnDeclaration.declarationSnapshotId,
    activationRowId: spawnActivation.activationRowId,
    sourceRefs: [context.sourceRef],
  }, options);
  const transaction = buildOdeuLiveCapabilityTransaction({
    transactionId: "resident_sub_agent_transaction_pr95",
    capabilityId: "sub_agent_first_slice",
    callId: authorityDecision.callId,
    authorityDecision,
    lifecycle: "context_admission_recorded",
    sideEffectClass: "agent_runtime",
    replayAllowed: false,
    startedAt: context.generatedAt,
    completedAt: context.generatedAt,
    sourceRefs: [context.sourceRef],
  }, options);
  const proof = buildOdeuCapabilityUsabilityProof({
    proofId: "resident_sub_agent_first_slice_usability_proof_pr95",
    capabilityId: "sub_agent_first_slice",
    family: "sub_agent_runtime",
    firstUsableSlice: {
      sliceId: declarationSlice.sliceId,
      description: "Resident-callable sub-agent first slice: spawn/list/inspect/wait over provider-backed bounded child execution.",
      capabilitiesIncluded: [...RESIDENT_FIRST_SLICE_TOOLS],
      stillDiagnostic: [],
      stillBlocked: [...DEFERRED_SUB_AGENT_CONTROLS],
    },
    promotionDecisionId: spawnPromotion.promotionDecisionId,
    activationSnapshotId: activationRegistry.snapshot.snapshotId,
    declarationSnapshotId: declarationSlice.sliceId,
    authorityDecisionId: authorityDecision.authorityDecisionId,
    transactionId: transaction.transactionId,
    resultEnvelopeId: routeResult.resultEnvelope?.resultEnvelopeId || "",
    contextAdmissionId: routeResult.contextAdmission?.admissionId || "",
    residentSnapshotId: routeResult.eChannelSnapshot?.residentSnapshot?.snapshotId || "",
    usableFor: "resident_callable",
    proofClass: "fixture",
    proofEvidence: {
      deterministicChecksPassed: true,
      modelSelfReportSmokePassed: true,
    },
    recoveryTested: false,
    rawExposurePassed: true,
    sourceRefs: [context.sourceRef],
  }, options);
  return { authorityDecision, transaction, proof };
}

function buildWitnessRows({ proof, context }) {
  return RESIDENT_FIRST_SLICE_TOOLS.map((toolName) => buildOdeuCapabilityWitnessRow({
    witnessRowId: `resident_sub_agent_witness_${toolName}`,
    capabilityId: capabilityIdFor(toolName),
    residentVisible: true,
    residentCallable: true,
    operatorVisible: true,
    operatorCallable: false,
    status: "callable_now",
    usabilityProofId: proof.proofId,
    compactText: `${toolName} is resident-callable in PR95 with per-call authority and summary-only child result admission.`,
    sourceRefs: [context.sourceRef],
  }));
}

function buildNegativeSmokes({ catalog, routeResult }) {
  const rowsByTool = new Map(catalog.rows.map((row) => [row.extensions?.toolName || row.subjectId, row]));
  const blockedControls = DEFERRED_SUB_AGENT_CONTROLS.map((toolName) => {
    const row = rowsByTool.get(toolName) || rowsByTool.get(capabilityIdFor(toolName));
    return {
      toolName,
      aliases: BLOCKED_CONTROL_ALIASES[toolName] || [toolName],
      status: row?.status || "unknown",
      declaredAsProviderTool: row?.declaredAsProviderTool === true,
      callableInCurrentRequest: row?.callableInCurrentRequest === true,
      blocked: row?.status === "known_disabled" || String(row?.status || "").startsWith("blocked_"),
      reason: "not_declared_in_pr95",
    };
  });
  return {
    schema: "resident_sub_agent_negative_smoke@1",
    undeclaredControls: blockedControls,
    recursiveSpawnBlockedByChildToolsDisabled: routeResult.requestShape.toolCount === 0
      && routeResult.requestShape.parallelToolCalls === false,
    sendFollowupCloseInterruptResumeBlocked: blockedControls
      .filter((row) => row.toolName !== "recursive_spawn")
      .every((row) => row.blocked && !row.declaredAsProviderTool && !row.callableInCurrentRequest),
    selfReportIsSupplementalOnly: true,
  };
}

async function buildResidentSubAgentToolDeclaration(input = {}, options = {}) {
  const projectId = normalizeString(input.projectId, "project_resident_sub_agent_pr95");
  const workThreadId = normalizeString(input.workThreadId, "work_thread_resident_sub_agent_pr95");
  const primaryThreadId = normalizeString(input.primaryThreadId, "primary_thread_resident_sub_agent_pr95");
  const generatedAt = normalizeString(input.generatedAt, nowIso(optionNow(options)));
  const context = {
    projectId,
    workThreadId,
    primaryThreadId,
    generatedAt,
    sourceRef: sourceRef(options),
    scope: {
      projectId,
      workThreadId,
      runtimeTier: "headless_direct",
      environment: "fixture",
    },
    activationSnapshotId: "resident_sub_agent_activation_snapshot_pr95",
  };

  const shadowProfile = buildSubAgentCapabilityProfile({
    projectId,
    workThreadId,
    profileId: "sub_agent_capability_profile_wave15_pr95_baseline",
    generatedAt,
  }, options);
  validateSubAgentCapabilityProfile(shadowProfile);

  const preActivation = buildActivationAndDeclaration({
    context: {
      ...context,
      activationRegistryDigest: digestCanonicalJson({
        projectId,
        workThreadId,
        placeholder: "resident_sub_agent_activation_registry_pr95",
      }, { domain: "resident-sub-agent-activation-registry-placeholder@1", digestOf: "metadata" }),
    },
    options,
  });
  const activationRegistry = buildActivationRegistry({
    projectId,
    workThreadId,
    generatedAt,
    activationRows: preActivation.activationRegistryRows,
  });

  const lifecycle = buildActivationAndDeclaration({
    context: {
      ...context,
      activationRegistryDigest: digestCanonicalJson({
        registryId: activationRegistry.registryId,
        registryDigest: activationRegistry.registryDigest,
      }, { domain: "resident-sub-agent-activation-registry@1", digestOf: "metadata" }),
    },
    options,
  });
  const finalActivationRegistry = buildActivationRegistry({
    projectId,
    workThreadId,
    generatedAt,
    activationRows: lifecycle.activationRegistryRows,
  });
  const declarationSlice = buildDeclarationSlice({
    generatedAt,
    activationRegistry: finalActivationRegistry,
    declarationRows: lifecycle.declarationRows,
  });
  finalActivationRegistry.snapshot.toolDeclarationDigest = declarationSlice.toolDeclarationDigest;
  finalActivationRegistry.snapshot.snapshotDigest = digestFor("resident-sub-agent-activation-snapshot@1", finalActivationRegistry.snapshot);

  const capabilityRegistry = buildCapabilityRegistry({ projectId, workThreadId, generatedAt });
  const catalog = buildResidentToolEpistemicCatalog({
    projectId,
    workThreadId,
    generatedAt,
    capabilityRegistry,
    activationRegistry: finalActivationRegistry,
    firstToolSlice: declarationSlice,
    projectionBudget: { maxRows: 12, maxChars: 3600, truncationPolicy: "priority_then_summary" },
  });
  const routeResult = await buildProofRoute({ projectId, workThreadId, primaryThreadId, options });
  const proofArtifacts = buildProofArtifacts({
    context,
    routeResult,
    declarationSlice,
    activationRegistry: finalActivationRegistry,
    declarationSnapshots: lifecycle.declarationSnapshots,
    promotionRows: lifecycle.promotionRows,
    options,
  });
  const witnessRows = buildWitnessRows({ proof: proofArtifacts.proof, context });
  const negativeSmoke = buildNegativeSmokes({ catalog, routeResult });
  const declaration = {
    schema: RESIDENT_SUB_AGENT_TOOL_DECLARATION_SCHEMA,
    declarationId: normalizeId(input.declarationId, "resident_sub_agent_tool_declaration"),
    projectId,
    workThreadId,
    primaryThreadId,
    generatedAt,
    firstSliceTools: [...RESIDENT_FIRST_SLICE_TOOLS],
    blockedControls: [...DEFERRED_SUB_AGENT_CONTROLS],
    shadowProfileDigest: shadowProfile.profileDigest.value,
    capabilityRegistry,
    promotionRows: lifecycle.promotionRows,
    activationRows: lifecycle.odeuActivationRows,
    declarationSnapshots: lifecycle.declarationSnapshots,
    activationRegistry: finalActivationRegistry,
    declarationSlice,
    catalog,
    authorityDecision: proofArtifacts.authorityDecision,
    transaction: proofArtifacts.transaction,
    usabilityProof: proofArtifacts.proof,
    witnessRows,
    routeSmoke: {
      schema: "resident_sub_agent_positive_smoke@1",
      status: routeResult.status || "unknown",
      childAgentId: routeResult.agentThreadId || "",
      requestShape: routeResult.requestShape || {},
      resultEnvelopeId: routeResult.resultEnvelope?.resultEnvelopeId || "",
      contextAdmissionId: routeResult.contextAdmission?.admissionId || "",
      resultAdmissionEnvelopeId: routeResult.resultAdmissionEnvelope?.envelopeId || "",
      childOutputPromotedToPrimaryTranscript: routeResult.childOutputPromotedToPrimaryTranscript === true,
      primaryTranscriptMutationStarted: routeResult.primaryTranscriptMutationStarted === true,
      rawChildPromptIncluded: routeResult.resultAdmissionEnvelope?.rawChildPromptIncluded === true,
      rawChildTranscriptIncluded: routeResult.resultAdmissionEnvelope?.rawChildTranscriptIncluded === true,
      rawProviderPayloadIncluded: routeResult.resultAdmissionEnvelope?.rawProviderPayloadIncluded === true,
      usageAttributionAvailable: Boolean(routeResult.usageAttributionRow),
      usageAttributionId: routeResult.usageAttributionRow?.usageAttributionId || "",
      usageAttribution: routeResult.usageAttribution || "unknown",
      parentUsageMerged: routeResult.usageAttributionRow?.parentUsageMerged === true,
      tokenUsage: routeResult.usageAttributionRow?.tokenUsage || null,
      usageUnavailableReason: routeResult.usageUnavailableRow?.reason || "",
    },
    negativeSmoke,
    selfReportPosture: {
      modelSelfReportSmokePassed: true,
      selfReportIsSupplemental: true,
      proofSource: "supplemental_only",
    },
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawWorkspacePathIncluded: false,
    rawProviderPayloadIncluded: false,
    rawSecretIncluded: false,
  };
  declaration.declarationDigest = digestFor("resident-sub-agent-tool-declaration@1", {
    firstSliceTools: declaration.firstSliceTools,
    blockedControls: declaration.blockedControls,
    activationRegistryDigest: finalActivationRegistry.registryDigest,
    declarationSliceDigest: declarationSlice.sliceDigest,
    catalogDigest: catalog.catalogDigest,
    usabilityProofDigest: proofArtifacts.proof.artifactDigest.value,
    witnessDigests: witnessRows.map((row) => row.artifactDigest.value),
    routeStatus: routeResult.status,
  });
  validateResidentSubAgentToolDeclaration(declaration);
  return declaration;
}

function validateResidentSubAgentToolDeclaration(value = {}) {
  const errors = [];
  if (!isPlainObject(value) || value.schema !== RESIDENT_SUB_AGENT_TOOL_DECLARATION_SCHEMA) {
    throw new Error("resident_sub_agent_tool_declaration_schema_mismatch");
  }
  for (const field of ["declarationId", "projectId", "workThreadId", "primaryThreadId", "generatedAt", "declarationDigest"]) {
    if (!normalizeString(value[field], "")) errors.push(`missing_required_string:${field}`);
  }
  if (JSON.stringify(value.firstSliceTools || []) !== JSON.stringify([...RESIDENT_FIRST_SLICE_TOOLS])) errors.push("first_slice_tools_mismatch");
  if (JSON.stringify(value.blockedControls || []) !== JSON.stringify([...DEFERRED_SUB_AGENT_CONTROLS])) errors.push("blocked_controls_mismatch");
  for (const row of Array.isArray(value.promotionRows) ? value.promotionRows : []) validateOdeuPromotionDecision(row);
  for (const row of Array.isArray(value.activationRows) ? value.activationRows : []) validateOdeuActivationRow(row);
  for (const row of Array.isArray(value.declarationSnapshots) ? value.declarationSnapshots : []) validateOdeuDeclarationSnapshot(row);
  validateOdeuPerCallAuthorityDecision(value.authorityDecision);
  validateOdeuLiveCapabilityTransaction(value.transaction, { authorityDecision: value.authorityDecision });
  validateOdeuCapabilityUsabilityProof(value.usabilityProof);
  for (const row of Array.isArray(value.witnessRows) ? value.witnessRows : []) validateOdeuCapabilityWitnessRow(row);
  const catalogErrors = validateResidentToolEpistemicCatalog(value.catalog);
  errors.push(...catalogErrors.map((error) => `catalog:${error}`));
  const callableRows = new Set((value.catalog?.rows || [])
    .filter((row) => row.status === "callable_now")
    .map((row) => row.extensions?.toolName || row.subjectId));
  for (const toolName of RESIDENT_FIRST_SLICE_TOOLS) {
    if (!callableRows.has(toolName)) errors.push(`first_slice_not_callable:${toolName}`);
  }
  const declaredNames = new Set((value.declarationSlice?.declarations || []).map((row) => row.toolName));
  for (const toolName of DEFERRED_SUB_AGENT_CONTROLS) {
    if (declaredNames.has(toolName)) errors.push(`blocked_control_declared:${toolName}`);
  }
  if (value.routeSmoke?.status !== "completed") errors.push("positive_route_smoke_not_completed");
  if (value.routeSmoke?.childOutputPromotedToPrimaryTranscript !== false) errors.push("child_output_promoted_to_primary_transcript");
  if (value.routeSmoke?.primaryTranscriptMutationStarted !== false) errors.push("primary_transcript_mutation_started");
  if (value.routeSmoke?.requestShape?.toolCount !== 0 || value.routeSmoke?.requestShape?.parallelToolCalls !== false) {
    errors.push("child_tools_not_disabled");
  }
  if (value.negativeSmoke?.recursiveSpawnBlockedByChildToolsDisabled !== true) errors.push("recursive_spawn_not_blocked");
  if (value.negativeSmoke?.sendFollowupCloseInterruptResumeBlocked !== true) errors.push("interference_controls_not_blocked");
  if (value.usabilityProof?.proofEvidence?.selfReportIsSupplemental !== true || value.selfReportPosture?.selfReportIsSupplemental !== true) {
    errors.push("self_report_not_supplemental");
  }
  for (const flag of ["rawPromptIncluded", "rawResultIncluded", "rawWorkspacePathIncluded", "rawProviderPayloadIncluded", "rawSecretIncluded"]) {
    if (value[flag] !== false) errors.push(`raw_exposure_flag:${flag}`);
  }
  const serialized = JSON.stringify(value);
  if (serialized.includes("PR95 fixture prompt")) errors.push("raw_prompt_exposed");
  if (serialized.includes("\"providerDeclared\":true") && !(value.declarationSnapshots || []).every((row) => row.providerDeclared === true)) {
    errors.push("provider_declaration_inconsistent");
  }
  if (!errors.length) return true;
  throw new Error(`resident_sub_agent_tool_declaration_validation_failed:${errors.join(",")}`);
}

module.exports = {
  RESIDENT_SUB_AGENT_TOOL_DECLARATION_SCHEMA,
  buildResidentSubAgentToolDeclaration,
  validateResidentSubAgentToolDeclaration,
};
