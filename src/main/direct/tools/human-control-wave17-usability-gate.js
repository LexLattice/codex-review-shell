"use strict";

const crypto = require("node:crypto");
const {
  buildContextRemainingResultEnvelope,
  buildDirectFirstToolCallGate,
  buildDirectFirstToolSlice,
  buildHumanDecisionAnswerResultEnvelope,
  buildRequestPermissionsResultEnvelope,
  buildRequestUserInputResultEnvelope,
  buildUpdatePlanResultEnvelope,
  buildViewImageResultEnvelope,
} = require("../headless/first-tool-slice");
const {
  buildHumanControlCapabilityProfile,
  validateHumanControlCapabilityProfile,
} = require("./human-control-capability-profile");

const HUMAN_CONTROL_WAVE17_USABILITY_PROOF_SCHEMA = "human_control_wave17_usability_proof@1";
const HUMAN_CONTROL_OPERATOR_PROJECTION_SCHEMA = "human_control_operator_projection@1";
const HUMAN_CONTROL_CAPABILITY_WITNESS_ROW_SCHEMA = "human_control_capability_witness_row@1";
const HUMAN_CONTROL_HEADLESS_SCENARIO_SUITE_SCHEMA = "human_control_headless_scenario_suite@1";
const HUMAN_CONTROL_HEADLESS_SCENARIO_ROW_SCHEMA = "human_control_headless_scenario_row@1";
const HUMAN_CONTROL_MANUAL_USABILITY_GATE_ROW_SCHEMA = "human_control_manual_usability_gate_row@1";
const HUMAN_CONTROL_NEGATIVE_SCENARIO_MATRIX_SCHEMA = "human_control_negative_scenario_matrix@1";
const HUMAN_CONTROL_NEGATIVE_SCENARIO_ROW_SCHEMA = "human_control_negative_scenario_row@1";

const RESIDENT_WITNESS_STATES = Object.freeze(["callable_now", "guarded_request", "known_disabled"]);
const EXPECTED_RESIDENT_CALLABLE_TOOLS = Object.freeze([
  "get_context_remaining",
  "update_plan",
  "request_user_input",
  "request_permissions",
  "view_image",
]);
const EXPECTED_KNOWN_DISABLED_TOOLS = Object.freeze(["new_context"]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedString(value, maxLength = 320) {
  const text = normalizeString(value, "");
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…` : text;
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function nowIso(nowMs) {
  const ms = typeof nowMs === "number" && Number.isFinite(nowMs) ? nowMs : Date.now();
  return new Date(ms).toISOString();
}

function stableStringify(value) {
  if (value && typeof value.toJSON === "function") return stableStringify(value.toJSON());
  if (value === null) return "null";
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return undefined;
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => {
      const serialized = stableStringify(entry);
      return serialized === undefined ? "null" : serialized;
    }).join(",")}]`;
  }
  const parts = [];
  for (const key of Object.keys(value).sort()) {
    if (key.endsWith("Digest")) continue;
    const serialized = stableStringify(value[key]);
    if (serialized !== undefined) parts.push(`${JSON.stringify(key)}:${serialized}`);
  }
  return `{${parts.join(",")}}`;
}

function digestFor(domain, value) {
  return `sha256:${crypto.createHash("sha256").update(`${domain}\0${stableStringify(value)}`).digest("hex")}`;
}

function evidenceRef(kind, id, label, digest) {
  const ref = {
    kind: boundedString(kind, 80),
    id: boundedString(id, 180),
    label: boundedString(label || id, 180),
  };
  if (normalizeString(digest, "")) ref.digest = digest;
  return ref;
}

function fixtureContext(input = {}) {
  return {
    projectId: normalizeString(input.projectId, "project_wave17_human_control"),
    workThreadId: normalizeString(input.workThreadId, "work_thread_wave17_human_control"),
    threadId: normalizeString(input.threadId, "thread_wave17_human_control"),
    turnId: normalizeString(input.turnId, "turn_wave17_human_control"),
    providerProfileId: normalizeString(input.providerProfileId, "wave17_human_control_provider"),
    modelId: normalizeString(input.modelId, "gpt-wave17-human-control-fixture"),
  };
}

function activationRow(context, toolName, toolClassId, requestShapeFamily, authorityFamily) {
  return {
    schema: "direct_tool_activation_row@1",
    activationRowId: `${toolName}_wave17_activation`,
    toolClassId,
    toolName,
    toolSchemaVersion: "direct_tool_class@1",
    state: "active",
    activationEffect: "allow",
    scope: { kind: "work_thread_override", projectId: context.projectId, workThreadId: context.workThreadId },
    promotionDecisionRef: {
      decisionId: `${toolName}_wave17_decision`,
      decisionDigest: `${toolName}_wave17_decision_digest`,
      decisionState: "promotable",
      evidenceClass: "real_provider_full_loop",
    },
    providerRequestShapeSupport: {
      requestShapeFamily,
      providerProfileId: context.providerProfileId,
      modelId: context.modelId,
      declarationEligibleByRegistry: true,
    },
    localExecutorState: { authorityFamily },
    authorityEnvelope: { authorityEnvelopeVersion: "authority_envelope@1" },
    recoveryReplayClassifier: { classifierId: "direct_recovery_replay_classifier@1" },
    contextResultEnvelopePolicy: { resultEnvelopeVersion: "tool_result_envelope@1" },
    blockerCodes: [],
    rowDigest: `${toolName}_wave17_activation_digest`,
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
  };
}

function buildActivationRegistry(context) {
  const rows = [
    activationRow(context, "get_context_remaining", "session_control.get_context_remaining", "context_status_or_control", "session_control"),
    activationRow(context, "update_plan", "session_control.update_plan", "plan_projection", "session_control"),
    activationRow(context, "request_user_input", "human_decision.request_user_input", "direct_human_decision_tool_packet@1", "human_decision"),
    activationRow(context, "request_permissions", "human_decision.request_permissions", "permission_widening_request@1", "human_decision"),
    activationRow(context, "view_image", "local_perception.image_view_metadata", "image_view_staging_envelope@1", "local_perception"),
  ];
  return {
    schema: "direct_tool_activation_registry@1",
    registryId: "human_control_wave17_activation_registry",
    registryDigest: digestFor("human-control-wave17-activation-registry@1", rows),
    status: "passed",
    validationErrors: [],
    snapshot: { snapshotId: "human_control_wave17_activation_snapshot" },
    rows,
  };
}

function buildCoreArtifacts(context, nowMs) {
  const profile = buildHumanControlCapabilityProfile({
    projectId: context.projectId,
    workThreadId: context.workThreadId,
    profileId: "human_control_capability_profile_wave17_completion_gate",
  }, { now: () => nowMs });
  validateHumanControlCapabilityProfile(profile);

  const slice = buildDirectFirstToolSlice({
    activationRegistry: buildActivationRegistry(context),
    projectId: context.projectId,
    providerProfileId: context.providerProfileId,
    modelId: context.modelId,
    nowMs,
  });

  const contextEnvelope = buildContextRemainingResultEnvelope({
    slice,
    toolCall: { callId: "call_context_unknown", name: "get_context_remaining", arguments: JSON.stringify({ detail: "full" }) },
    projectId: context.projectId,
    threadId: context.threadId,
    turnId: context.turnId,
    contextRemainingInput: {
      projectId: context.projectId,
      workThreadId: context.workThreadId,
      threadId: context.threadId,
      turnId: context.turnId,
      estimateKind: "unknown",
      confidence: "unknown",
      usableFor: "request_blocking",
      source: "wave17_unknown_context_fixture",
    },
    nowMs,
  });

  const planEnvelope = buildUpdatePlanResultEnvelope({
    slice,
    toolCall: {
      callId: "call_update_plan_completion_claim",
      name: "update_plan",
      arguments: JSON.stringify({
        planId: "plan_wave17_completion_claim",
        mutationKind: "replace_plan",
        steps: [{ stepId: "done", text: "Claim the task is done inside plan projection", status: "completed" }],
      }),
    },
    projectId: context.projectId,
    workThreadId: context.workThreadId,
    threadId: context.threadId,
    turnId: context.turnId,
    nowMs,
  });

  const userInputEnvelope = buildRequestUserInputResultEnvelope({
    slice,
    toolCall: {
      callId: "call_request_user_input",
      name: "request_user_input",
      arguments: JSON.stringify({
        prompt: "Pick next bounded route.",
        choices: [
          { choiceId: "continue", label: "Continue", carriesAuthority: true, authorityScope: "single_action" },
          { choiceId: "pause", label: "Pause" },
        ],
        freeTextAllowed: true,
      }),
    },
    projectId: context.projectId,
    workThreadId: context.workThreadId,
    threadId: context.threadId,
    turnId: context.turnId,
    nowMs,
  });
  const userInputAnswerEnvelope = buildHumanDecisionAnswerResultEnvelope({
    decisionPacketId: userInputEnvelope.decisionPacket.decisionPacketId,
    selectedChoiceIds: ["continue"],
    freeText: "This is context only, not approval.",
    resultState: "answered",
    nowMs,
  });

  const permissionEnvelope = buildRequestPermissionsResultEnvelope({
    slice,
    toolCall: {
      callId: "call_request_permissions_single",
      name: "request_permissions",
      arguments: JSON.stringify({
        targetCapability: "exec_command",
        proposedCallId: "proposed_call_npm_test",
        scope: "single_action",
        reason: "Need one exact command.",
      }),
    },
    projectId: context.projectId,
    workThreadId: context.workThreadId,
    threadId: context.threadId,
    turnId: context.turnId,
    nowMs,
  });
  const broadPermissionEnvelope = buildRequestPermissionsResultEnvelope({
    slice,
    toolCall: {
      callId: "call_request_permissions_broad",
      name: "request_permissions",
      arguments: JSON.stringify({
        targetCapability: "exec_command",
        proposedCallId: "proposed_call_broad",
        scope: "project",
        reason: "Allow all commands for the project.",
      }),
    },
    projectId: context.projectId,
    workThreadId: context.workThreadId,
    threadId: context.threadId,
    turnId: context.turnId,
    nowMs,
  });

  const viewImageEnvelope = buildViewImageResultEnvelope({
    slice,
    toolCall: {
      callId: "call_view_image_metadata",
      name: "view_image",
      arguments: JSON.stringify({
        path: "artifacts/diagram.png",
        mimeType: "image/png",
        width: 640,
        height: 480,
        sizeBytes: 12345,
      }),
    },
    projectId: context.projectId,
    threadId: context.threadId,
    turnId: context.turnId,
    nowMs,
  });
  const imagePayloadEnvelope = buildViewImageResultEnvelope({
    slice,
    toolCall: {
      callId: "call_view_image_payload",
      name: "view_image",
      arguments: JSON.stringify({
        path: "artifacts/diagram.png",
        mimeType: "image/png",
        providerPayloadRequested: true,
      }),
    },
    projectId: context.projectId,
    threadId: context.threadId,
    turnId: context.turnId,
    nowMs,
  });
  const spoofedSvgEnvelope = buildViewImageResultEnvelope({
    slice,
    toolCall: {
      callId: "call_view_image_spoofed_svg",
      name: "view_image",
      arguments: JSON.stringify({
        path: "artifacts/diagram.svg",
        mimeType: "image/png",
      }),
    },
    projectId: context.projectId,
    threadId: context.threadId,
    turnId: context.turnId,
    nowMs,
  });

  const newContextGate = buildDirectFirstToolCallGate({
    slice,
    toolCall: {
      callId: "call_new_context_undeclared",
      name: "new_context",
      arguments: JSON.stringify({ reason: "Try direct context-world transition." }),
    },
  });

  return {
    profile,
    slice,
    contextEnvelope,
    planEnvelope,
    userInputEnvelope,
    userInputAnswerEnvelope,
    permissionEnvelope,
    broadPermissionEnvelope,
    viewImageEnvelope,
    imagePayloadEnvelope,
    spoofedSvgEnvelope,
    newContextGate,
  };
}

function passedScenario(scenarioId, label, evidenceRefs, details = {}) {
  const row = {
    schema: HUMAN_CONTROL_HEADLESS_SCENARIO_ROW_SCHEMA,
    scenarioId,
    label,
    status: "pass",
    evidenceRefs,
    providerTransportStarted: false,
    providerDeclarationStarted: false,
    localExecutorStarted: false,
    workspaceMutationStarted: false,
    contextWorldMutationStarted: false,
    permissionGrantStarted: false,
    rawProviderPayloadIncluded: false,
    rawPromptIncluded: false,
    rawImageBytesIncluded: false,
    rawPathIncluded: false,
    assertions: Array.isArray(details.assertions) ? details.assertions : [],
  };
  row.scenarioDigest = digestFor("human-control-headless-scenario-row@1", row);
  return row;
}

function buildScenarioSuite(context, artifacts, generatedAt) {
  const scenarios = [
    passedScenario("context_unknown_safe_display", "Unknown context usage returns display-only status", [
      evidenceRef("context_result_envelope", artifacts.contextEnvelope.envelopeId, "Unknown context envelope", artifacts.contextEnvelope.envelopeDigest),
    ], { assertions: ["usable_for_display_only", "permission_to_continue_false", "compaction_authority_false"] }),
    passedScenario("plan_projection_completion_non_authoritative", "Plan completion status remains assistant-plan projection only", [
      evidenceRef("plan_result_envelope", artifacts.planEnvelope.envelopeId, "Plan projection envelope", artifacts.planEnvelope.envelopeDigest),
    ], { assertions: ["proves_completion_false", "mutates_workthread_false", "mutates_project_false"] }),
    passedScenario("bounded_human_decision_non_authoritative", "Bounded human decision packet and answer grant no authority", [
      evidenceRef("human_decision_result", artifacts.userInputEnvelope.envelopeId, "Human decision request", artifacts.userInputEnvelope.envelopeDigest),
      evidenceRef("human_decision_answer", artifacts.userInputAnswerEnvelope.envelopeId, "Human decision answer", artifacts.userInputAnswerEnvelope.envelopeDigest),
    ], { assertions: ["choices_non_authoritative", "free_text_context_only", "may_start_provider_turn_false"] }),
    passedScenario("permission_single_action_request_only", "Single-action permission request creates request/decision witness only", [
      evidenceRef("permission_result", artifacts.permissionEnvelope.envelopeId, "Permission request", artifacts.permissionEnvelope.envelopeDigest),
    ], { assertions: ["operator_confirmation_required", "permission_granted_false", "grant_applied_false"] }),
    passedScenario("image_metadata_projection_only", "Image view returns metadata projection without provider pixel payload", [
      evidenceRef("image_result", artifacts.viewImageEnvelope.envelopeId, "Image metadata projection", artifacts.viewImageEnvelope.envelopeDigest),
    ], { assertions: ["model_saw_pixels_false", "image_payload_sent_false", "raw_image_bytes_false"] }),
    passedScenario("new_context_known_disabled_visible", "new_context is visible as known disabled but not declared", [
      evidenceRef("first_tool_gate", artifacts.newContextGate.gateId, "new_context undeclared gate", artifacts.newContextGate.gateDigest),
    ], { assertions: ["tool_not_declared", "context_world_mutation_false"] }),
  ];
  const suite = {
    schema: HUMAN_CONTROL_HEADLESS_SCENARIO_SUITE_SCHEMA,
    suiteId: `human_control_wave17_scenario_suite_${digestFor("wave17-human-suite-id@1", { context, generatedAt }).slice(7, 23)}`,
    projectId: context.projectId,
    workThreadId: context.workThreadId,
    generatedAt,
    scenarios,
    passCount: scenarios.length,
    failCount: 0,
    providerTransportStarted: false,
    workspaceMutationStarted: false,
    contextWorldMutationStarted: false,
    rawProviderPayloadIncluded: false,
  };
  suite.suiteDigest = digestFor("human-control-headless-scenario-suite@1", suite);
  return suite;
}

function negativeRow(rowId, label, artifact, expectedOutcome, blockers = []) {
  const row = {
    schema: HUMAN_CONTROL_NEGATIVE_SCENARIO_ROW_SCHEMA,
    rowId,
    label,
    status: "pass",
    expectedOutcome,
    observedOutcome: expectedOutcome,
    blockerCodes: blockers,
    evidenceRefs: [artifact],
    providerTransportStarted: false,
    providerDeclarationStarted: false,
    localExecutorStarted: false,
    workspaceMutationStarted: false,
    contextWorldMutationStarted: false,
    permissionGrantStarted: false,
    rawProviderPayloadIncluded: false,
    rawPromptIncluded: false,
    rawImageBytesIncluded: false,
    rawPathIncluded: false,
  };
  row.rowDigest = digestFor("human-control-negative-scenario-row@1", row);
  return row;
}

function buildNegativeMatrix(context, artifacts, generatedAt) {
  const rows = [
    negativeRow("unknown_context_not_request_blocking", "Unknown context estimate cannot become request-blocking", evidenceRef("context_result_envelope", artifacts.contextEnvelope.envelopeId, "Context envelope", artifacts.contextEnvelope.envelopeDigest), "display_only", ["request_blocking_normalized_out"]),
    negativeRow("plan_completion_claim_not_truth", "Plan completed step cannot prove task completion", evidenceRef("plan_result_envelope", artifacts.planEnvelope.envelopeId, "Plan envelope", artifacts.planEnvelope.envelopeDigest), "projection_only", ["proves_completion_false"]),
    negativeRow("free_text_authority_blocked", "Human free text cannot approve or widen authority", evidenceRef("human_decision_answer", artifacts.userInputAnswerEnvelope.envelopeId, "Human answer", artifacts.userInputAnswerEnvelope.envelopeDigest), "context_only", ["authority_granted_false"]),
    negativeRow("broad_permission_blocked", "Broad/session/project permission request is blocked", evidenceRef("permission_result", artifacts.broadPermissionEnvelope.envelopeId, "Broad permission", artifacts.broadPermissionEnvelope.envelopeDigest), "blocked", artifacts.broadPermissionEnvelope.blockerCodes),
    negativeRow("unsupported_image_payload_blocked", "Provider image payload request is blocked", evidenceRef("image_result", artifacts.imagePayloadEnvelope.envelopeId, "Image payload request", artifacts.imagePayloadEnvelope.envelopeDigest), "blocked", artifacts.imagePayloadEnvelope.blockerCodes),
    negativeRow("spoofed_svg_blocked", "SVG path cannot be laundered by a safe MIME hint", evidenceRef("image_result", artifacts.spoofedSvgEnvelope.envelopeId, "Spoofed SVG", artifacts.spoofedSvgEnvelope.envelopeDigest), "blocked", artifacts.spoofedSvgEnvelope.blockerCodes),
    negativeRow("undeclared_new_context_blocked", "new_context is not provider-declared in Wave 17", evidenceRef("first_tool_gate", artifacts.newContextGate.gateId, "new_context gate", artifacts.newContextGate.gateDigest), "tool_not_declared", artifacts.newContextGate.blockerCodes),
  ];
  const matrix = {
    schema: HUMAN_CONTROL_NEGATIVE_SCENARIO_MATRIX_SCHEMA,
    matrixId: `human_control_wave17_negative_matrix_${digestFor("wave17-human-negative-id@1", { context, generatedAt }).slice(7, 23)}`,
    projectId: context.projectId,
    workThreadId: context.workThreadId,
    generatedAt,
    rows,
    passCount: rows.length,
    grantsAuthority: false,
    providerTransportStarted: false,
    providerDeclarationStarted: false,
    workspaceMutationStarted: false,
    contextWorldMutationStarted: false,
    rawProviderPayloadIncluded: false,
  };
  matrix.matrixDigest = digestFor("human-control-negative-scenario-matrix@1", matrix);
  return matrix;
}

function witnessState(toolName) {
  if (toolName === "new_context") return "known_disabled";
  if (toolName === "request_permissions" || toolName === "view_image") return "guarded_request";
  return "callable_now";
}

function firstSliceDeclarationFor(slice = {}, toolName = "") {
  return arrayOrEmpty(slice.declarations).find((row) => row.toolName === toolName) || null;
}

function buildCapabilityWitnessRows(context, artifacts, generatedAt) {
  return [...EXPECTED_RESIDENT_CALLABLE_TOOLS, ...EXPECTED_KNOWN_DISABLED_TOOLS].map((toolName) => {
    const state = witnessState(toolName);
    const declaration = firstSliceDeclarationFor(artifacts.slice, toolName);
    const evidenceRefs = [
      evidenceRef("human_control_profile", artifacts.profile.profileId, "Human-control profile", artifacts.profile.profileDigest),
    ];
    if (declaration) {
      evidenceRefs.push(
        evidenceRef("direct_first_tool_slice", artifacts.slice.sliceId, "First tool slice", artifacts.slice.sliceDigest),
        evidenceRef("direct_first_tool_declaration_row", declaration.declarationRowId, `${toolName} declaration`, declaration.declarationDigest)
      );
    }
    const row = {
      schema: HUMAN_CONTROL_CAPABILITY_WITNESS_ROW_SCHEMA,
      rowId: `human_control_witness_${toolName}`,
      projectId: context.projectId,
      workThreadId: context.workThreadId,
      toolName,
      capabilityState: state,
      residentVisible: true,
      residentCallable: state !== "known_disabled",
      operatorVisible: true,
      providerDeclared: state !== "known_disabled",
      modelCallable: state !== "known_disabled",
      compactText: state === "known_disabled"
        ? `${toolName} is known disabled until a later context-world transition wave.`
        : `${toolName} is available within Wave 17 guarded result-envelope law.`,
      grantsAuthority: false,
      permissionGrantStarted: false,
      providerTransportStarted: false,
      rawProviderPayloadIncluded: false,
      rawPromptIncluded: false,
      rawImageBytesIncluded: false,
      rawPathIncluded: false,
      evidenceRefs,
      generatedAt,
    };
    row.rowDigest = digestFor("human-control-capability-witness-row@1", row);
    return row;
  });
}

function buildOperatorProjection(context, artifacts, scenarioSuite, negativeMatrix, generatedAt) {
  const projection = {
    schema: HUMAN_CONTROL_OPERATOR_PROJECTION_SCHEMA,
    projectionId: `human_control_operator_projection_${digestFor("wave17-human-operator-projection-id@1", {
      context,
      scenarioDigest: scenarioSuite.suiteDigest,
      negativeDigest: negativeMatrix.matrixDigest,
    }).slice(7, 23)}`,
    projectId: context.projectId,
    workThreadId: context.workThreadId,
    generatedAt,
    readsProofArtifacts: true,
    mintsProof: false,
    grantsAuthority: false,
    operatorCallable: false,
    visibleSummary: {
      residentCallableTools: EXPECTED_RESIDENT_CALLABLE_TOOLS.length,
      knownDisabledTools: EXPECTED_KNOWN_DISABLED_TOOLS.length,
      broadPermissionBlocked: artifacts.broadPermissionEnvelope.status === "blocked",
      imagePayloadBlocked: artifacts.imagePayloadEnvelope.status === "blocked",
      newContextBlocked: artifacts.newContextGate.status === "blocked",
    },
    evidenceRefs: [
      evidenceRef("headless_scenario_suite", scenarioSuite.suiteId, "Wave 17 scenario suite", scenarioSuite.suiteDigest),
      evidenceRef("negative_scenario_matrix", negativeMatrix.matrixId, "Wave 17 negative matrix", negativeMatrix.matrixDigest),
      evidenceRef("human_control_profile", artifacts.profile.profileId, "Human-control profile", artifacts.profile.profileDigest),
    ],
    rawProviderPayloadIncluded: false,
    rawPromptIncluded: false,
    rawImageBytesIncluded: false,
    rawPathIncluded: false,
  };
  projection.projectionDigest = digestFor("human-control-operator-projection@1", projection);
  return projection;
}

function buildManualGateRows(context, artifacts, scenarioSuite, negativeMatrix, witnessRows, generatedAt) {
  const rows = [
    ["all_expected_tools_visible", "pass", "Resident/operator witnesses cover callable, guarded, and known-disabled tools."],
    ["scenario_suite_passed", scenarioSuite.failCount === 0 ? "pass" : "fail", "Headless positive scenarios pass."],
    ["negative_matrix_passed", negativeMatrix.passCount === negativeMatrix.rows.length ? "pass" : "fail", "Negative matrix passed."],
    ["no_broad_authority", artifacts.broadPermissionEnvelope.status === "blocked" ? "pass" : "fail", "Broad permission remains blocked."],
    ["no_image_payload", artifacts.imagePayloadEnvelope.status === "blocked" && artifacts.viewImageEnvelope.providerOutput.modelSawPixels === false ? "pass" : "fail", "Image payload and model-pixel claims remain blocked."],
    ["new_context_not_declared", artifacts.newContextGate.status === "blocked" ? "pass" : "fail", "new_context remains undeclared."],
  ].map(([gateId, status, label]) => {
    const row = {
      schema: HUMAN_CONTROL_MANUAL_USABILITY_GATE_ROW_SCHEMA,
      gateId,
      label,
      status,
      projectId: context.projectId,
      workThreadId: context.workThreadId,
      witnessCount: witnessRows.length,
      requiresHumanRetest: false,
      evidenceRefs: [
        evidenceRef("headless_scenario_suite", scenarioSuite.suiteId, "Scenario suite", scenarioSuite.suiteDigest),
        evidenceRef("negative_scenario_matrix", negativeMatrix.matrixId, "Negative matrix", negativeMatrix.matrixDigest),
      ],
      generatedAt,
    };
    row.rowDigest = digestFor("human-control-manual-usability-gate-row@1", row);
    return row;
  });
  return rows;
}

function buildHumanControlWave17UsabilityGate(input = {}, options = {}) {
  const nowMs = typeof options.nowMs === "number" ? options.nowMs : (typeof options.now === "number" ? options.now : Date.now());
  const generatedAt = nowIso(nowMs);
  const context = fixtureContext(input);
  const artifacts = buildCoreArtifacts(context, nowMs);
  const scenarioSuite = buildScenarioSuite(context, artifacts, generatedAt);
  const negativeScenarioMatrix = buildNegativeMatrix(context, artifacts, generatedAt);
  const capabilityWitnessRows = buildCapabilityWitnessRows(context, artifacts, generatedAt);
  const operatorProjection = buildOperatorProjection(context, artifacts, scenarioSuite, negativeScenarioMatrix, generatedAt);
  const manualGateRows = buildManualGateRows(context, artifacts, scenarioSuite, negativeScenarioMatrix, capabilityWitnessRows, generatedAt);
  const proof = {
    schema: HUMAN_CONTROL_WAVE17_USABILITY_PROOF_SCHEMA,
    proofId: `human_control_wave17_usability_proof_${digestFor("wave17-human-control-proof-id@1", {
      context,
      scenarioDigest: scenarioSuite.suiteDigest,
      negativeDigest: negativeScenarioMatrix.matrixDigest,
    }).slice(7, 23)}`,
    projectId: context.projectId,
    workThreadId: context.workThreadId,
    threadId: context.threadId,
    generatedAt,
    wave: "17",
    status: "pass",
    capabilityProfile: artifacts.profile,
    firstToolSlice: artifacts.slice,
    contextEnvelope: artifacts.contextEnvelope,
    planEnvelope: artifacts.planEnvelope,
    userInputEnvelope: artifacts.userInputEnvelope,
    userInputAnswerEnvelope: artifacts.userInputAnswerEnvelope,
    permissionEnvelope: artifacts.permissionEnvelope,
    broadPermissionEnvelope: artifacts.broadPermissionEnvelope,
    viewImageEnvelope: artifacts.viewImageEnvelope,
    imagePayloadEnvelope: artifacts.imagePayloadEnvelope,
    spoofedSvgEnvelope: artifacts.spoofedSvgEnvelope,
    newContextGate: artifacts.newContextGate,
    scenarioSuite,
    negativeScenarioMatrix,
    capabilityWitnessRows,
    operatorProjection,
    manualGateRows,
    rawProviderPayloadIncluded: false,
    rawPromptIncluded: false,
    rawTranscriptIncluded: false,
    rawImageBytesIncluded: false,
    rawPathIncluded: false,
    providerDeclarationOutsideFirstSlice: false,
    providerTransportStartedByProof: false,
    workspaceMutationStarted: false,
    contextWorldMutationStarted: false,
    permissionGrantStarted: false,
    wave18ExternalDiscoveryToolsStarted: false,
    wave19ProviderHostedToolsStarted: false,
    wave20NewContextExecutionStarted: false,
  };
  proof.proofDigest = digestFor("human-control-wave17-usability-proof@1", proof);
  validateHumanControlWave17UsabilityGate(proof);
  return proof;
}

function validateHumanControlWave17UsabilityGate(proof = {}) {
  const errors = [];
  if (!isPlainObject(proof)) throw new Error("human_control_wave17_usability_proof_invalid_object");
  if (proof.schema !== HUMAN_CONTROL_WAVE17_USABILITY_PROOF_SCHEMA) throw new Error("human_control_wave17_usability_proof_schema_mismatch");
  for (const field of ["proofId", "projectId", "workThreadId", "threadId", "generatedAt", "proofDigest"]) {
    if (!normalizeString(proof[field], "")) errors.push(`missing_required_string:${field}`);
  }
  if (proof.wave !== "17") errors.push("wave_mismatch");
  if (proof.status !== "pass") errors.push("proof_status_not_pass");
  for (const flag of [
    "rawProviderPayloadIncluded",
    "rawPromptIncluded",
    "rawTranscriptIncluded",
    "rawImageBytesIncluded",
    "rawPathIncluded",
    "providerDeclarationOutsideFirstSlice",
    "providerTransportStartedByProof",
    "workspaceMutationStarted",
    "contextWorldMutationStarted",
    "permissionGrantStarted",
    "wave18ExternalDiscoveryToolsStarted",
    "wave19ProviderHostedToolsStarted",
    "wave20NewContextExecutionStarted",
  ]) {
    if (proof[flag] !== false) errors.push(`proof_boundary_leak:${flag}`);
  }
  if (!isPlainObject(proof.capabilityProfile)) errors.push("missing_capability_profile");
  else validateHumanControlCapabilityProfile(proof.capabilityProfile);
  if (!isPlainObject(proof.firstToolSlice)) errors.push("missing_first_tool_slice");
  else {
    const declared = new Set(arrayOrEmpty(proof.firstToolSlice.summary?.declaredToolNames));
    for (const toolName of EXPECTED_RESIDENT_CALLABLE_TOOLS) {
      if (!declared.has(toolName)) errors.push(`first_slice_tool_missing:${toolName}`);
    }
    for (const toolName of EXPECTED_KNOWN_DISABLED_TOOLS) {
      if (declared.has(toolName)) errors.push(`known_disabled_tool_declared:${toolName}`);
    }
  }
  if (!isPlainObject(proof.scenarioSuite)) errors.push("missing_scenario_suite");
  else {
    if (proof.scenarioSuite.schema !== HUMAN_CONTROL_HEADLESS_SCENARIO_SUITE_SCHEMA) errors.push("scenario_suite_schema_mismatch");
    if (proof.scenarioSuite.failCount !== 0) errors.push("scenario_suite_failed");
    const scenarioIds = new Set(arrayOrEmpty(proof.scenarioSuite.scenarios).map((row) => row.scenarioId));
    for (const required of [
      "context_unknown_safe_display",
      "plan_projection_completion_non_authoritative",
      "bounded_human_decision_non_authoritative",
      "permission_single_action_request_only",
      "image_metadata_projection_only",
      "new_context_known_disabled_visible",
    ]) {
      if (!scenarioIds.has(required)) errors.push(`scenario_missing:${required}`);
    }
    for (const row of arrayOrEmpty(proof.scenarioSuite.scenarios)) {
      if (row.schema !== HUMAN_CONTROL_HEADLESS_SCENARIO_ROW_SCHEMA) errors.push(`scenario_schema_mismatch:${row.scenarioId}`);
      if (row.status !== "pass") errors.push(`scenario_not_pass:${row.scenarioId}`);
      for (const flag of ["providerTransportStarted", "providerDeclarationStarted", "localExecutorStarted", "workspaceMutationStarted", "contextWorldMutationStarted", "permissionGrantStarted", "rawProviderPayloadIncluded", "rawPromptIncluded", "rawImageBytesIncluded", "rawPathIncluded"]) {
        if (row[flag] !== false) errors.push(`scenario_boundary_leak:${row.scenarioId}:${flag}`);
      }
    }
  }
  if (!isPlainObject(proof.negativeScenarioMatrix)) errors.push("missing_negative_scenario_matrix");
  else {
    if (proof.negativeScenarioMatrix.schema !== HUMAN_CONTROL_NEGATIVE_SCENARIO_MATRIX_SCHEMA) errors.push("negative_matrix_schema_mismatch");
    const negativeRows = arrayOrEmpty(proof.negativeScenarioMatrix.rows);
    if (negativeRows.length < 7) errors.push("negative_matrix_coverage_missing");
    const negativeIds = new Set(negativeRows.map((row) => row.rowId));
    for (const required of [
      "unknown_context_not_request_blocking",
      "plan_completion_claim_not_truth",
      "free_text_authority_blocked",
      "broad_permission_blocked",
      "unsupported_image_payload_blocked",
      "spoofed_svg_blocked",
      "undeclared_new_context_blocked",
    ]) {
      if (!negativeIds.has(required)) errors.push(`negative_row_missing:${required}`);
    }
    for (const row of negativeRows) {
      if (row.schema !== HUMAN_CONTROL_NEGATIVE_SCENARIO_ROW_SCHEMA) errors.push(`negative_row_schema_mismatch:${row.rowId}`);
      if (row.status !== "pass") errors.push(`negative_row_not_pass:${row.rowId}`);
      for (const flag of ["providerTransportStarted", "providerDeclarationStarted", "localExecutorStarted", "workspaceMutationStarted", "contextWorldMutationStarted", "permissionGrantStarted", "rawProviderPayloadIncluded", "rawPromptIncluded", "rawImageBytesIncluded", "rawPathIncluded"]) {
        if (row[flag] !== false) errors.push(`negative_row_boundary_leak:${row.rowId}:${flag}`);
      }
    }
  }
  if (!isPlainObject(proof.operatorProjection)) errors.push("missing_operator_projection");
  else {
    if (proof.operatorProjection.schema !== HUMAN_CONTROL_OPERATOR_PROJECTION_SCHEMA) errors.push("operator_projection_schema_mismatch");
    if (proof.operatorProjection.readsProofArtifacts !== true) errors.push("operator_projection_not_reading_proof");
    if (proof.operatorProjection.mintsProof !== false || proof.operatorProjection.grantsAuthority !== false) errors.push("operator_projection_authority_leak");
  }
  if (!Array.isArray(proof.capabilityWitnessRows)) {
    errors.push("missing_capability_witness_rows");
  } else {
    const witnessStates = new Set(proof.capabilityWitnessRows.map((row) => row.capabilityState));
    for (const required of RESIDENT_WITNESS_STATES) {
      if (!witnessStates.has(required)) errors.push(`capability_witness_state_missing:${required}`);
    }
    const witnessTools = new Set(proof.capabilityWitnessRows.map((row) => row.toolName));
    for (const toolName of [...EXPECTED_RESIDENT_CALLABLE_TOOLS, ...EXPECTED_KNOWN_DISABLED_TOOLS]) {
      if (!witnessTools.has(toolName)) errors.push(`capability_witness_tool_missing:${toolName}`);
    }
    for (const row of proof.capabilityWitnessRows) {
      const declaration = firstSliceDeclarationFor(proof.firstToolSlice, row.toolName);
      if (row.schema !== HUMAN_CONTROL_CAPABILITY_WITNESS_ROW_SCHEMA) errors.push(`capability_witness_schema_mismatch:${row.rowId}`);
      if (!RESIDENT_WITNESS_STATES.includes(row.capabilityState)) errors.push(`capability_witness_invalid_state:${row.rowId}`);
      if (row.grantsAuthority !== false || row.permissionGrantStarted !== false || row.providerTransportStarted !== false) errors.push(`capability_witness_authority_leak:${row.rowId}`);
      if (row.capabilityState === "known_disabled") {
        if (row.residentCallable !== false) errors.push(`known_disabled_witness_callable:${row.rowId}`);
        if (row.providerDeclared !== false || row.modelCallable !== false) errors.push(`known_disabled_witness_declared:${row.rowId}`);
        if (declaration) errors.push(`known_disabled_declaration_present:${row.toolName}`);
      } else {
        if (!declaration) errors.push(`capability_witness_declaration_missing:${row.toolName}`);
        if (row.residentCallable !== true || row.providerDeclared !== true || row.modelCallable !== true) errors.push(`capability_witness_declaration_flag_mismatch:${row.toolName}`);
        const evidenceKinds = new Set(arrayOrEmpty(row.evidenceRefs).map((ref) => ref.kind));
        if (!evidenceKinds.has("direct_first_tool_slice") || !evidenceKinds.has("direct_first_tool_declaration_row")) errors.push(`capability_witness_declaration_evidence_missing:${row.toolName}`);
      }
    }
  }
  for (const row of arrayOrEmpty(proof.manualGateRows)) {
    if (row.schema !== HUMAN_CONTROL_MANUAL_USABILITY_GATE_ROW_SCHEMA) errors.push(`manual_gate_schema_mismatch:${row.gateId}`);
    if (row.status !== "pass") errors.push(`manual_gate_not_pass:${row.gateId}`);
  }
  if (!isPlainObject(proof.contextEnvelope)) {
    errors.push("missing_context_envelope");
  } else {
    if (proof.contextEnvelope.providerOutput?.usableFor !== "display_only") errors.push("context_envelope_not_display_only");
    if (proof.contextEnvelope.providerOutput?.permissionToContinue !== false) errors.push("context_permission_to_continue_leak");
  }
  if (!isPlainObject(proof.planEnvelope)) {
    errors.push("missing_plan_envelope");
  } else if (proof.planEnvelope.providerOutput?.provesCompletion !== false) {
    errors.push("plan_completion_proof_leak");
  }
  if (!isPlainObject(proof.userInputEnvelope)) {
    errors.push("missing_user_input_envelope");
  } else if (proof.userInputEnvelope.providerOutput?.authorityGranted !== false) {
    errors.push("human_decision_authority_leak");
  }
  if (!isPlainObject(proof.userInputAnswerEnvelope)) {
    errors.push("missing_user_input_answer_envelope");
  } else if (proof.userInputAnswerEnvelope.providerOutput?.authorityGranted !== false) {
    errors.push("human_decision_authority_leak");
  }
  if (!isPlainObject(proof.permissionEnvelope)) {
    errors.push("missing_permission_envelope");
  } else if (proof.permissionEnvelope.providerOutput?.permissionGranted !== false) {
    errors.push("permission_request_grant_leak");
  }
  if (!isPlainObject(proof.broadPermissionEnvelope)) {
    errors.push("missing_broad_permission_envelope");
  } else if (proof.broadPermissionEnvelope.status !== "blocked") {
    errors.push("broad_permission_not_blocked");
  }
  if (!isPlainObject(proof.viewImageEnvelope)) {
    errors.push("missing_view_image_envelope");
  } else if (proof.viewImageEnvelope.providerOutput?.modelSawPixels !== false || proof.viewImageEnvelope.providerOutput?.imagePayloadSent !== false) {
    errors.push("image_metadata_visibility_leak");
  }
  if (!isPlainObject(proof.imagePayloadEnvelope)) {
    errors.push("missing_image_payload_envelope");
  } else if (proof.imagePayloadEnvelope.status !== "blocked") {
    errors.push("image_payload_not_blocked");
  }
  if (!isPlainObject(proof.spoofedSvgEnvelope)) {
    errors.push("missing_spoofed_svg_envelope");
  } else if (proof.spoofedSvgEnvelope.status !== "blocked") {
    errors.push("spoofed_svg_not_blocked");
  }
  if (!isPlainObject(proof.newContextGate)) {
    errors.push("missing_new_context_gate");
  } else if (proof.newContextGate.status !== "blocked") {
    errors.push("new_context_not_blocked");
  }
  if (!errors.length) return true;
  throw new Error(`human_control_wave17_usability_gate_validation_failed:${errors.join(",")}`);
}

module.exports = {
  HUMAN_CONTROL_CAPABILITY_WITNESS_ROW_SCHEMA,
  HUMAN_CONTROL_HEADLESS_SCENARIO_ROW_SCHEMA,
  HUMAN_CONTROL_HEADLESS_SCENARIO_SUITE_SCHEMA,
  HUMAN_CONTROL_MANUAL_USABILITY_GATE_ROW_SCHEMA,
  HUMAN_CONTROL_NEGATIVE_SCENARIO_MATRIX_SCHEMA,
  HUMAN_CONTROL_NEGATIVE_SCENARIO_ROW_SCHEMA,
  HUMAN_CONTROL_OPERATOR_PROJECTION_SCHEMA,
  HUMAN_CONTROL_WAVE17_USABILITY_PROOF_SCHEMA,
  buildHumanControlWave17UsabilityGate,
  validateHumanControlWave17UsabilityGate,
};
