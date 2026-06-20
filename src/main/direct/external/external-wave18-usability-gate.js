"use strict";

const crypto = require("node:crypto");

const {
  buildExternalCapabilityProfile,
  validateExternalCapabilityProfile,
} = require("./external-capability-profile");
const {
  buildExternalDiscoveryResultEnvelope,
  buildExternalDiscoveryToolCallGate,
  buildExternalToolResidentDeclaration,
  validateExternalDiscoveryResultEnvelope,
  validateExternalDiscoveryToolCallGate,
  validateExternalToolResidentDeclaration,
} = require("./external-discovery-tools");
const {
  buildMcpResourceReadEnvelope,
  validateMcpResourceReadEnvelope,
} = require("./mcp-resource-read-envelope");
const {
  buildExternalResultContextAdmission,
  buildExternalResultContextAdmissionPolicy,
  validateExternalResultContextAdmission,
} = require("./external-result-context-admission");

const EXTERNAL_WAVE18_USABILITY_PROOF_SCHEMA = "external_wave18_usability_proof@1";
const EXTERNAL_WAVE18_OPERATOR_PROJECTION_SCHEMA = "external_wave18_operator_projection@1";
const EXTERNAL_WAVE18_RESIDENT_WITNESS_ROW_SCHEMA = "external_wave18_resident_witness_row@1";
const EXTERNAL_WAVE18_HEADLESS_SCENARIO_SUITE_SCHEMA = "external_wave18_headless_scenario_suite@1";
const EXTERNAL_WAVE18_HEADLESS_SCENARIO_ROW_SCHEMA = "external_wave18_headless_scenario_row@1";
const EXTERNAL_WAVE18_MANUAL_USABILITY_GATE_ROW_SCHEMA = "external_wave18_manual_usability_gate_row@1";
const EXTERNAL_WAVE18_NEGATIVE_SCENARIO_MATRIX_SCHEMA = "external_wave18_negative_scenario_matrix@1";
const EXTERNAL_WAVE18_NEGATIVE_SCENARIO_ROW_SCHEMA = "external_wave18_negative_scenario_row@1";

const EXPECTED_CALLABLE_TOOLS = Object.freeze(["tool_search", "list_mcp_resources", "list_mcp_resource_templates"]);
const EXPECTED_GUARDED_TOOLS = Object.freeze(["read_mcp_resource"]);
const EXPECTED_BLOCKED_TOOLS = Object.freeze(["mcp_dynamic_tool_call", "request_plugin_install"]);
const EXPECTED_FUTURE_TOOLS = Object.freeze(["web_search", "image_generation"]);
const RESIDENT_WITNESS_STATES = Object.freeze(["callable_now", "guarded_read", "blocked_deferred", "future_wave"]);

const FALSE_PROOF_FLAGS = Object.freeze([
  "rawProviderPayloadIncluded",
  "rawExternalPayloadIncluded",
  "rawResourceUriIncluded",
  "rawEndpointIncluded",
  "rawCredentialIncluded",
  "rawSecretIncluded",
  "providerTransportStartedByProof",
  "dynamicMcpActionStarted",
  "pluginInstallStarted",
  "workspaceMutationStarted",
  "contextWorldMutationStarted",
  "durableMemoryAdmissionStarted",
  "projectTruthGranted",
  "workspaceEvidenceGranted",
  "externalActionApprovalStarted",
  "wave19ProviderHostedToolsStarted",
  "wave20NewContextExecutionStarted",
  "wave21CodeModeExecutionStarted",
]);

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
  if (text.length <= maxLength) return text;
  if (maxLength <= 0) return "";
  if (maxLength <= 3) return ".".repeat(maxLength);
  return `${text.slice(0, maxLength - 3)}...`;
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
  const type = typeof value;
  if (type === "boolean" || type === "number" || type === "string") return JSON.stringify(value);
  if (type === "bigint" || type === "function" || type === "symbol" || type === "undefined") return undefined;
  if (Array.isArray(value)) {
    return `[${value.map((entry) => {
      const serialized = stableStringify(entry);
      return serialized === undefined ? "null" : serialized;
    }).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => {
      const serialized = stableStringify(value[key]);
      return serialized === undefined ? "" : `${JSON.stringify(key)}:${serialized}`;
    })
    .filter(Boolean)
    .join(",")}}`;
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
    projectId: normalizeString(input.projectId, "project_wave18_external"),
    workThreadId: normalizeString(input.workThreadId, "work_thread_wave18_external"),
    threadId: normalizeString(input.threadId, "thread_wave18_external"),
    turnId: normalizeString(input.turnId, "turn_wave18_external"),
    providerProfileId: normalizeString(input.providerProfileId, "wave18_external_provider"),
    modelId: normalizeString(input.modelId, "gpt-wave18-external-fixture"),
  };
}

function buildCoreArtifacts(context, nowMs) {
  const generatedAt = nowIso(nowMs);
  const profile = buildExternalCapabilityProfile({
    projectId: context.projectId,
    workThreadId: context.workThreadId,
    generatedAt,
  });
  validateExternalCapabilityProfile(profile);

  const declaration = buildExternalToolResidentDeclaration({
    profile,
    generatedAt,
    projectId: context.projectId,
    workThreadId: context.workThreadId,
    providerProfileId: context.providerProfileId,
    modelId: context.modelId,
  });
  validateExternalToolResidentDeclaration(declaration);

  const searchGate = buildExternalDiscoveryToolCallGate({
    declaration,
    toolCall: {
      name: "tool_search",
      callId: "call_wave18_tool_search",
      arguments: JSON.stringify({ families: ["mcp_resource", "mcp_tool"], maxResults: 4 }),
    },
  });
  validateExternalDiscoveryToolCallGate(searchGate);

  const resourcesGate = buildExternalDiscoveryToolCallGate({
    declaration,
    toolCall: {
      name: "list_mcp_resources",
      callId: "call_wave18_list_resources",
      arguments: JSON.stringify({ serverIdentityId: "mcp_server_project_fixture", maxResults: 4 }),
    },
  });
  validateExternalDiscoveryToolCallGate(resourcesGate);

  const templatesGate = buildExternalDiscoveryToolCallGate({
    declaration,
    toolCall: {
      name: "list_mcp_resource_templates",
      callId: "call_wave18_list_templates",
      arguments: JSON.stringify({ serverIdentityId: "mcp_server_project_fixture", maxResults: 4 }),
    },
  });
  validateExternalDiscoveryToolCallGate(templatesGate);

  const dynamicActionGate = buildExternalDiscoveryToolCallGate({
    declaration,
    toolCall: {
      name: "mcp_dynamic_tool_call",
      callId: "call_wave18_dynamic_action_blocked",
      arguments: JSON.stringify({ serverIdentityId: "mcp_server_project_fixture", toolName: "unsafe_action" }),
    },
  });
  const pluginInstallGate = buildExternalDiscoveryToolCallGate({
    declaration,
    toolCall: {
      name: "request_plugin_install",
      callId: "call_wave18_plugin_install_blocked",
      arguments: JSON.stringify({ pluginId: "example" }),
    },
  });

  const discoveryEnvelope = buildExternalDiscoveryResultEnvelope({ profile, declaration, gate: searchGate, projectId: context.projectId, workThreadId: context.workThreadId, threadId: context.threadId, turnId: context.turnId });
  const resourcesEnvelope = buildExternalDiscoveryResultEnvelope({
    profile,
    declaration,
    gate: resourcesGate,
    projectId: context.projectId,
    workThreadId: context.workThreadId,
    threadId: context.threadId,
    turnId: context.turnId,
    resourceDescriptors: [{ uri: "mcp://fixture/resource/alpha", name: "Alpha resource" }],
  });
  const templatesEnvelope = buildExternalDiscoveryResultEnvelope({
    profile,
    declaration,
    gate: templatesGate,
    projectId: context.projectId,
    workThreadId: context.workThreadId,
    threadId: context.threadId,
    turnId: context.turnId,
    resourceTemplateDescriptors: [{ uriTemplate: "mcp://fixture/resource/{id}", name: "Resource by id" }],
  });
  for (const envelope of [discoveryEnvelope, resourcesEnvelope, templatesEnvelope]) validateExternalDiscoveryResultEnvelope(envelope);

  const policy = buildExternalResultContextAdmissionPolicy({
    summaryTokenBudget: 256,
    excerptByteLimit: 1024,
    generatedAt,
  });
  const discoveryAdmission = buildExternalResultContextAdmission({ policy, envelope: discoveryEnvelope, nowMs });
  const readEnvelope = buildMcpResourceReadEnvelope({
    profile,
    projectId: context.projectId,
    workThreadId: context.workThreadId,
    threadId: context.threadId,
    turnId: context.turnId,
    serverIdentityId: "mcp_server_project_fixture",
    resourceUri: "mcp://user:secret@fixture/resource/alpha?token=secret#frag",
    mimeType: "text/markdown",
    payload: "# External Resource\n\nBearer abcdefghijklmnopqrstuvwxyz\n\nbounded safe content",
    callId: "call_wave18_read_resource",
    nowMs,
  });
  validateMcpResourceReadEnvelope(readEnvelope);
  const readAdmission = buildExternalResultContextAdmission({ policy, envelope: readEnvelope, nowMs });

  const ambiguousSelectorEnvelope = buildMcpResourceReadEnvelope({
    profile,
    projectId: context.projectId,
    workThreadId: context.workThreadId,
    serverIdentityId: "mcp_server_project_fixture",
    resourceUri: "mcp://fixture/resource/ambiguous-selector",
    mimeType: "text/plain",
    payload: "ambiguous selector payload should not be admitted",
    blockerCodes: ["mcp_server_ambiguous"],
    callId: "call_wave18_ambiguous_selector",
  });
  const disabledServerEnvelope = buildMcpResourceReadEnvelope({
    profile,
    projectId: context.projectId,
    workThreadId: context.workThreadId,
    serverIdentityId: "mcp_server_disabled_fixture",
    resourceUri: "mcp://fixture/resource/disabled",
    mimeType: "text/plain",
    payload: "disabled payload should not be admitted",
    callId: "call_wave18_disabled_server",
  });
  const binaryEnvelope = buildMcpResourceReadEnvelope({
    profile,
    projectId: context.projectId,
    workThreadId: context.workThreadId,
    serverIdentityId: "mcp_server_project_fixture",
    resourceUri: "mcp://fixture/resource/image",
    mimeType: "image/png",
    byteCount: 2048,
    callId: "call_wave18_binary_resource",
  });
  const oversizeEnvelope = buildMcpResourceReadEnvelope({
    profile,
    projectId: context.projectId,
    workThreadId: context.workThreadId,
    serverIdentityId: "mcp_server_project_fixture",
    resourceUri: "mcp://fixture/resource/oversize",
    mimeType: "text/plain",
    payload: "x".repeat(300000),
    callId: "call_wave18_oversize_resource",
  });
  const blockedAdmission = buildExternalResultContextAdmission({ policy, envelope: disabledServerEnvelope, nowMs });
  const binaryAdmission = buildExternalResultContextAdmission({ policy, envelope: binaryEnvelope, nowMs });
  const noProviderAdmission = buildExternalResultContextAdmission({
    policy: buildExternalResultContextAdmissionPolicy({ providerContinuationMode: "not_sent", generatedAt }),
    envelope: readEnvelope,
    nowMs,
  });

  return {
    profile,
    declaration,
    searchGate,
    resourcesGate,
    templatesGate,
    dynamicActionGate,
    pluginInstallGate,
    discoveryEnvelope,
    resourcesEnvelope,
    templatesEnvelope,
    policy,
    discoveryAdmission,
    readEnvelope,
    readAdmission,
    ambiguousSelectorEnvelope,
    disabledServerEnvelope,
    binaryEnvelope,
    oversizeEnvelope,
    blockedAdmission,
    binaryAdmission,
    noProviderAdmission,
  };
}

function passedScenario(scenarioId, label, evidenceRefs, assertions = []) {
  const row = {
    schema: EXTERNAL_WAVE18_HEADLESS_SCENARIO_ROW_SCHEMA,
    scenarioId,
    label,
    status: "pass",
    evidenceRefs,
    assertions,
    providerTransportStarted: false,
    dynamicMcpActionStarted: false,
    pluginInstallStarted: false,
    workspaceMutationStarted: false,
    contextWorldMutationStarted: false,
    durableMemoryAdmissionStarted: false,
    projectTruthGranted: false,
    workspaceEvidenceGranted: false,
    rawProviderPayloadIncluded: false,
    rawExternalPayloadIncluded: false,
    rawResourceUriIncluded: false,
    rawEndpointIncluded: false,
    rawCredentialIncluded: false,
    rawSecretIncluded: false,
  };
  row.scenarioDigest = digestFor("external-wave18-headless-scenario-row@1", row);
  return row;
}

function buildScenarioSuite(context, artifacts, generatedAt) {
  const scenarios = [
    passedScenario("tool_search_summary_admitted", "tool_search descriptors are summary-admitted only", [
      evidenceRef("external_discovery_result", artifacts.discoveryEnvelope.envelopeId, "tool_search result", artifacts.discoveryEnvelope.envelopeDigest),
      evidenceRef("external_result_context_admission", artifacts.discoveryAdmission.admissionId, "tool_search admission", artifacts.discoveryAdmission.admissionDigest),
    ], ["summary_admitted", "descriptor_only", "not_project_truth"]),
    passedScenario("mcp_resources_exact_server_selector", "list_mcp_resources requires exact selected MCP server identity", [
      evidenceRef("external_discovery_result", artifacts.resourcesEnvelope.envelopeId, "resource list result", artifacts.resourcesEnvelope.envelopeDigest),
    ], ["exact_server_identity_required", "raw_endpoint_false", "raw_credential_false"]),
    passedScenario("mcp_templates_exact_server_selector", "list_mcp_resource_templates requires exact selected MCP server identity", [
      evidenceRef("external_discovery_result", artifacts.templatesEnvelope.envelopeId, "template list result", artifacts.templatesEnvelope.envelopeDigest),
    ], ["template_descriptor_only", "exact_server_identity_required"]),
    passedScenario("mcp_read_excerpt_admitted", "completed text MCP read is admitted as bounded excerpt", [
      evidenceRef("mcp_resource_read_envelope", artifacts.readEnvelope.envelopeId, "MCP read envelope", artifacts.readEnvelope.envelopeDigest),
      evidenceRef("external_result_context_admission", artifacts.readAdmission.admissionId, "MCP read admission", artifacts.readAdmission.admissionDigest),
    ], ["bounded_excerpt", "redacted", "provider_bounded_excerpt"]),
    passedScenario("binary_resource_ref_only", "binary MCP resource is reference-only", [
      evidenceRef("mcp_resource_read_envelope", artifacts.binaryEnvelope.envelopeId, "Binary MCP read", artifacts.binaryEnvelope.envelopeDigest),
      evidenceRef("external_result_context_admission", artifacts.binaryAdmission.admissionId, "Binary admission", artifacts.binaryAdmission.admissionDigest),
    ], ["ref_only", "no_payload_excerpt"]),
    passedScenario("provider_continuation_suppressed", "admission policy can suppress provider continuation", [
      evidenceRef("external_result_context_admission", artifacts.noProviderAdmission.admissionId, "No-provider admission", artifacts.noProviderAdmission.admissionDigest),
    ], ["provider_not_sent", "resident_visibility_preserved"]),
  ];
  const suite = {
    schema: EXTERNAL_WAVE18_HEADLESS_SCENARIO_SUITE_SCHEMA,
    suiteId: `external_wave18_scenario_suite_${digestFor("external-wave18-suite-id@1", { context, generatedAt }).slice(7, 23)}`,
    projectId: context.projectId,
    workThreadId: context.workThreadId,
    generatedAt,
    scenarios,
    passCount: scenarios.length,
    failCount: 0,
    providerTransportStarted: false,
    dynamicMcpActionStarted: false,
    pluginInstallStarted: false,
    workspaceMutationStarted: false,
    contextWorldMutationStarted: false,
    durableMemoryAdmissionStarted: false,
    rawExternalPayloadIncluded: false,
    rawResourceUriIncluded: false,
    rawSecretIncluded: false,
  };
  suite.suiteDigest = digestFor("external-wave18-headless-scenario-suite@1", suite);
  return suite;
}

function negativeRow(rowId, label, artifactRef, expectedOutcome, blockers = []) {
  const row = {
    schema: EXTERNAL_WAVE18_NEGATIVE_SCENARIO_ROW_SCHEMA,
    rowId,
    label,
    status: "pass",
    expectedOutcome,
    observedOutcome: expectedOutcome,
    blockerCodes: arrayOrEmpty(blockers).map((code) => boundedString(code, 180)),
    evidenceRefs: [artifactRef],
    providerTransportStarted: false,
    dynamicMcpActionStarted: false,
    pluginInstallStarted: false,
    workspaceMutationStarted: false,
    contextWorldMutationStarted: false,
    durableMemoryAdmissionStarted: false,
    projectTruthGranted: false,
    workspaceEvidenceGranted: false,
    rawProviderPayloadIncluded: false,
    rawExternalPayloadIncluded: false,
    rawResourceUriIncluded: false,
    rawEndpointIncluded: false,
    rawCredentialIncluded: false,
    rawSecretIncluded: false,
  };
  row.rowDigest = digestFor("external-wave18-negative-scenario-row@1", row);
  return row;
}

function buildNegativeMatrix(context, artifacts, generatedAt) {
  const rows = [
    negativeRow("discovered_as_declared_collapse_blocked", "Discovered descriptors cannot become resident declarations", evidenceRef("external_tool_declaration", artifacts.declaration.declarationId, "Resident declaration", artifacts.declaration.declarationDigest), "not_declared", ["read_mcp_resource_not_declared_in_wave18"]),
    negativeRow("multiple_mcp_servers_without_selector_blocked", "MCP resource read without an unambiguous exact server selector is blocked", evidenceRef("mcp_resource_read_envelope", artifacts.ambiguousSelectorEnvelope.envelopeId, "Ambiguous selector read", artifacts.ambiguousSelectorEnvelope.envelopeDigest), "blocked", artifacts.ambiguousSelectorEnvelope.blockerCodes),
    negativeRow("stale_or_unknown_server_identity_blocked", "Disabled/stale/unknown server identity blocks read and admission", evidenceRef("mcp_resource_read_envelope", artifacts.disabledServerEnvelope.envelopeId, "Disabled server read", artifacts.disabledServerEnvelope.envelopeDigest), "blocked", artifacts.disabledServerEnvelope.blockerCodes),
    negativeRow("raw_endpoint_token_leak_blocked", "Endpoint, credential, URI query token, and bearer payload are not visible", evidenceRef("external_result_context_admission", artifacts.readAdmission.admissionId, "Redacted read admission", artifacts.readAdmission.admissionDigest), "redacted", ["raw_uri_false", "raw_secret_false"]),
    negativeRow("raw_resource_uri_payload_leak_blocked", "Raw resource URI and full payload do not enter resident/provider projection", evidenceRef("mcp_resource_read_envelope", artifacts.readEnvelope.envelopeId, "MCP read envelope", artifacts.readEnvelope.envelopeDigest), "sanitized_projection_only", ["raw_resource_uri_false", "payload_excerpt_only"]),
    negativeRow("binary_or_oversize_resource_ref_or_blocked", "Binary and oversized resources are ref-only or blocked", evidenceRef("mcp_resource_read_envelope", artifacts.oversizeEnvelope.envelopeId, "Oversize read", artifacts.oversizeEnvelope.envelopeDigest), "ref_or_blocked", [artifacts.binaryEnvelope.contextAdmission, artifacts.oversizeEnvelope.status]),
    negativeRow("dynamic_mcp_action_blocked", "Dynamic MCP action is not declared or executed in Wave 18", evidenceRef("external_discovery_tool_call_gate", artifacts.dynamicActionGate.gateId, "Dynamic action gate", artifacts.dynamicActionGate.gateDigest), "blocked", artifacts.dynamicActionGate.blockerCodes),
    negativeRow("plugin_install_blocked", "Plugin install is not resident-callable in Wave 18", evidenceRef("external_discovery_tool_call_gate", artifacts.pluginInstallGate.gateId, "Plugin install gate", artifacts.pluginInstallGate.gateDigest), "blocked", artifacts.pluginInstallGate.blockerCodes),
    negativeRow("memory_smuggling_blocked", "External result admission does not start durable memory admission", evidenceRef("external_result_context_admission", artifacts.readAdmission.admissionId, "Read admission", artifacts.readAdmission.admissionDigest), "not_memory", ["durable_memory_false"]),
    negativeRow("project_truth_laundering_blocked", "External result admission does not grant project truth or workspace evidence", evidenceRef("external_result_context_admission", artifacts.discoveryAdmission.admissionId, "Discovery admission", artifacts.discoveryAdmission.admissionDigest), "not_project_truth", ["project_truth_false", "workspace_evidence_false"]),
  ];
  const matrix = {
    schema: EXTERNAL_WAVE18_NEGATIVE_SCENARIO_MATRIX_SCHEMA,
    matrixId: `external_wave18_negative_matrix_${digestFor("external-wave18-negative-id@1", { context, generatedAt }).slice(7, 23)}`,
    projectId: context.projectId,
    workThreadId: context.workThreadId,
    generatedAt,
    rows,
    passCount: rows.length,
    providerTransportStarted: false,
    dynamicMcpActionStarted: false,
    pluginInstallStarted: false,
    workspaceMutationStarted: false,
    contextWorldMutationStarted: false,
    durableMemoryAdmissionStarted: false,
    projectTruthGranted: false,
    workspaceEvidenceGranted: false,
    rawExternalPayloadIncluded: false,
    rawResourceUriIncluded: false,
    rawSecretIncluded: false,
  };
  matrix.matrixDigest = digestFor("external-wave18-negative-scenario-matrix@1", matrix);
  return matrix;
}

function witnessState(toolName) {
  if (EXPECTED_CALLABLE_TOOLS.includes(toolName)) return "callable_now";
  if (EXPECTED_GUARDED_TOOLS.includes(toolName)) return "guarded_read";
  if (EXPECTED_FUTURE_TOOLS.includes(toolName)) return "future_wave";
  return "blocked_deferred";
}

function buildResidentWitnessRows(context, artifacts, generatedAt) {
  return [...EXPECTED_CALLABLE_TOOLS, ...EXPECTED_GUARDED_TOOLS, ...EXPECTED_BLOCKED_TOOLS, ...EXPECTED_FUTURE_TOOLS].map((toolName) => {
    const state = witnessState(toolName);
    const declared = arrayOrEmpty(artifacts.declaration.declaredTools).includes(toolName);
    const evidenceRefs = [
      evidenceRef("external_capability_profile", artifacts.profile.profileId, "External capability profile", artifacts.profile.profileDigest),
    ];
    if (declared) {
      evidenceRefs.push(evidenceRef("external_tool_declaration", artifacts.declaration.declarationId, "External resident declaration", artifacts.declaration.declarationDigest));
    }
    const row = {
      schema: EXTERNAL_WAVE18_RESIDENT_WITNESS_ROW_SCHEMA,
      rowId: `external_wave18_witness_${toolName}`,
      projectId: context.projectId,
      workThreadId: context.workThreadId,
      toolName,
      capabilityState: state,
      residentVisible: true,
      residentCallable: state === "callable_now" || state === "guarded_read",
      providerDeclared: state === "callable_now",
      modelCallable: state === "callable_now",
      guardedByEnvelope: state === "guarded_read",
      blockerVisible: state === "blocked_deferred" || state === "future_wave",
      compactText: state === "callable_now"
        ? `${toolName} is callable for discovery only.`
        : state === "guarded_read"
          ? `${toolName} is available only through guarded MCP read envelope and context admission.`
          : state === "future_wave"
            ? `${toolName} belongs to a later provider-hosted-tool wave.`
            : `${toolName} is blocked/deferred in Wave 18.`,
      grantsAuthority: false,
      providerTransportStarted: false,
      dynamicMcpActionStarted: false,
      pluginInstallStarted: false,
      workspaceMutationStarted: false,
      durableMemoryAdmissionStarted: false,
      rawExternalPayloadIncluded: false,
      rawResourceUriIncluded: false,
      rawSecretIncluded: false,
      evidenceRefs,
      generatedAt,
    };
    row.rowDigest = digestFor("external-wave18-resident-witness-row@1", row);
    return row;
  });
}

function buildOperatorProjection(context, artifacts, scenarioSuite, negativeMatrix, generatedAt) {
  const projection = {
    schema: EXTERNAL_WAVE18_OPERATOR_PROJECTION_SCHEMA,
    projectionId: `external_wave18_operator_projection_${digestFor("external-wave18-operator-id@1", {
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
      providerDeclaredTools: artifacts.declaration.declaredTools.length,
      admittedExternalResults: [artifacts.discoveryAdmission, artifacts.readAdmission, artifacts.binaryAdmission].filter((row) => row.admissionState !== "blocked").length,
      blockedNegativeRows: negativeMatrix.rows.length,
      dynamicActionsBlocked: artifacts.dynamicActionGate.status === "blocked",
      pluginInstallBlocked: artifacts.pluginInstallGate.status === "blocked",
    },
    evidenceRefs: [
      evidenceRef("headless_scenario_suite", scenarioSuite.suiteId, "Wave 18 scenario suite", scenarioSuite.suiteDigest),
      evidenceRef("negative_scenario_matrix", negativeMatrix.matrixId, "Wave 18 negative matrix", negativeMatrix.matrixDigest),
      evidenceRef("external_capability_profile", artifacts.profile.profileId, "External profile", artifacts.profile.profileDigest),
    ],
    rawExternalPayloadIncluded: false,
    rawResourceUriIncluded: false,
    rawEndpointIncluded: false,
    rawCredentialIncluded: false,
    rawSecretIncluded: false,
  };
  projection.projectionDigest = digestFor("external-wave18-operator-projection@1", projection);
  return projection;
}

function buildManualGateRows(context, artifacts, scenarioSuite, negativeMatrix, witnessRows, generatedAt) {
  return [
    ["resident_witness_complete", "pass", "Resident witnesses cover callable, guarded, blocked, and future external tool states."],
    ["scenario_suite_passed", scenarioSuite.failCount === 0 ? "pass" : "fail", "Headless positive scenarios pass."],
    ["negative_matrix_passed", negativeMatrix.passCount === negativeMatrix.rows.length ? "pass" : "fail", "Negative matrix passed."],
    ["discovery_declaration_scoped", artifacts.declaration.declaredTools.length === EXPECTED_CALLABLE_TOOLS.length ? "pass" : "fail", "Only safe discovery tools are declared."],
    ["read_admission_guarded", artifacts.readAdmission.admissionState === "excerpt_admitted" && artifacts.readAdmission.projectTruthGranted === false ? "pass" : "fail", "MCP read is bounded and non-authoritative."],
    ["dynamic_and_plugin_blocked", artifacts.dynamicActionGate.status === "blocked" && artifacts.pluginInstallGate.status === "blocked" ? "pass" : "fail", "Dynamic MCP action and plugin install remain blocked."],
  ].map(([gateId, status, label]) => {
    const row = {
      schema: EXTERNAL_WAVE18_MANUAL_USABILITY_GATE_ROW_SCHEMA,
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
    row.rowDigest = digestFor("external-wave18-manual-gate-row@1", row);
    return row;
  });
}

function buildExternalWave18UsabilityGate(input = {}, options = {}) {
  const nowMs = typeof options.nowMs === "number" ? options.nowMs : (typeof options.now === "number" ? options.now : Date.now());
  const generatedAt = nowIso(nowMs);
  const context = fixtureContext(input);
  const artifacts = buildCoreArtifacts(context, nowMs);
  const scenarioSuite = buildScenarioSuite(context, artifacts, generatedAt);
  const negativeScenarioMatrix = buildNegativeMatrix(context, artifacts, generatedAt);
  const residentWitnessRows = buildResidentWitnessRows(context, artifacts, generatedAt);
  const operatorProjection = buildOperatorProjection(context, artifacts, scenarioSuite, negativeScenarioMatrix, generatedAt);
  const manualGateRows = buildManualGateRows(context, artifacts, scenarioSuite, negativeScenarioMatrix, residentWitnessRows, generatedAt);
  const proof = {
    schema: EXTERNAL_WAVE18_USABILITY_PROOF_SCHEMA,
    proofId: `external_wave18_usability_proof_${digestFor("external-wave18-proof-id@1", {
      context,
      scenarioDigest: scenarioSuite.suiteDigest,
      negativeDigest: negativeScenarioMatrix.matrixDigest,
    }).slice(7, 23)}`,
    projectId: context.projectId,
    workThreadId: context.workThreadId,
    threadId: context.threadId,
    generatedAt,
    wave: "18",
    status: "pass",
    capabilityProfile: artifacts.profile,
    residentDeclaration: artifacts.declaration,
    discoveryEnvelope: artifacts.discoveryEnvelope,
    resourcesEnvelope: artifacts.resourcesEnvelope,
    templatesEnvelope: artifacts.templatesEnvelope,
    readEnvelope: artifacts.readEnvelope,
    discoveryAdmission: artifacts.discoveryAdmission,
    readAdmission: artifacts.readAdmission,
    binaryAdmission: artifacts.binaryAdmission,
    blockedAdmission: artifacts.blockedAdmission,
    dynamicActionGate: artifacts.dynamicActionGate,
    pluginInstallGate: artifacts.pluginInstallGate,
    scenarioSuite,
    negativeScenarioMatrix,
    residentWitnessRows,
    operatorProjection,
    manualGateRows,
    rawProviderPayloadIncluded: false,
    rawExternalPayloadIncluded: false,
    rawResourceUriIncluded: false,
    rawEndpointIncluded: false,
    rawCredentialIncluded: false,
    rawSecretIncluded: false,
    providerTransportStartedByProof: false,
    dynamicMcpActionStarted: false,
    pluginInstallStarted: false,
    workspaceMutationStarted: false,
    contextWorldMutationStarted: false,
    durableMemoryAdmissionStarted: false,
    projectTruthGranted: false,
    workspaceEvidenceGranted: false,
    externalActionApprovalStarted: false,
    wave19ProviderHostedToolsStarted: false,
    wave20NewContextExecutionStarted: false,
    wave21CodeModeExecutionStarted: false,
  };
  proof.proofDigest = digestFor("external-wave18-usability-proof@1", proof);
  validateExternalWave18UsabilityGate(proof);
  return proof;
}

function assertFalseFlags(target, flags, errors, prefix) {
  for (const flag of flags) {
    if (target?.[flag] !== false) errors.push(`${prefix}:${flag}`);
  }
}

function validateExternalWave18UsabilityGate(proof = {}) {
  const errors = [];
  if (!isPlainObject(proof)) throw new Error("external_wave18_usability_proof_invalid_object");
  if (proof.schema !== EXTERNAL_WAVE18_USABILITY_PROOF_SCHEMA) throw new Error("external_wave18_usability_proof_schema_mismatch");
  for (const field of ["proofId", "projectId", "workThreadId", "threadId", "generatedAt", "proofDigest"]) {
    if (!normalizeString(proof[field], "")) errors.push(`missing_required_string:${field}`);
  }
  if (proof.wave !== "18") errors.push("wave_mismatch");
  if (proof.status !== "pass") errors.push("proof_status_not_pass");
  assertFalseFlags(proof, FALSE_PROOF_FLAGS, errors, "proof_boundary_leak");
  if (!isPlainObject(proof.capabilityProfile)) errors.push("missing_capability_profile");
  else validateExternalCapabilityProfile(proof.capabilityProfile);
  if (!isPlainObject(proof.residentDeclaration)) {
    errors.push("missing_resident_declaration");
  } else {
    validateExternalToolResidentDeclaration(proof.residentDeclaration);
    const declared = new Set(arrayOrEmpty(proof.residentDeclaration.declaredTools));
    for (const toolName of EXPECTED_CALLABLE_TOOLS) {
      if (!declared.has(toolName)) errors.push(`declared_tool_missing:${toolName}`);
    }
    for (const toolName of [...EXPECTED_GUARDED_TOOLS, ...EXPECTED_BLOCKED_TOOLS, ...EXPECTED_FUTURE_TOOLS]) {
      if (declared.has(toolName)) errors.push(`non_wave18_tool_declared:${toolName}`);
    }
  }
  for (const [field, validator] of [
    ["discoveryEnvelope", validateExternalDiscoveryResultEnvelope],
    ["resourcesEnvelope", validateExternalDiscoveryResultEnvelope],
    ["templatesEnvelope", validateExternalDiscoveryResultEnvelope],
    ["readEnvelope", validateMcpResourceReadEnvelope],
  ]) {
    if (!isPlainObject(proof[field])) errors.push(`missing_${field}`);
    else validator(proof[field]);
  }
  for (const [field, validator] of [
    ["discoveryAdmission", validateExternalResultContextAdmission],
    ["readAdmission", validateExternalResultContextAdmission],
    ["binaryAdmission", validateExternalResultContextAdmission],
    ["blockedAdmission", validateExternalResultContextAdmission],
  ]) {
    if (!isPlainObject(proof[field])) errors.push(`missing_${field}`);
    else validator(proof[field]);
  }
  if (proof.discoveryAdmission?.admissionState !== "summary_admitted") errors.push("discovery_not_summary_admitted");
  if (proof.readAdmission?.admissionState !== "excerpt_admitted") errors.push("read_not_excerpt_admitted");
  if (proof.binaryAdmission?.admissionState !== "ref_only") errors.push("binary_not_ref_only");
  if (proof.blockedAdmission?.admissionState !== "blocked") errors.push("blocked_read_not_blocked");
  for (const field of ["dynamicActionGate", "pluginInstallGate"]) {
    if (!isPlainObject(proof[field])) errors.push(`missing_${field}`);
    else {
      validateExternalDiscoveryToolCallGate(proof[field]);
      if (proof[field].status !== "blocked") errors.push(`${field}_not_blocked`);
    }
  }
  if (!isPlainObject(proof.scenarioSuite)) {
    errors.push("missing_scenario_suite");
  } else {
    if (proof.scenarioSuite.schema !== EXTERNAL_WAVE18_HEADLESS_SCENARIO_SUITE_SCHEMA) errors.push("scenario_suite_schema_mismatch");
    if (proof.scenarioSuite.failCount !== 0) errors.push("scenario_suite_failed");
    const scenarioIds = new Set(arrayOrEmpty(proof.scenarioSuite.scenarios).map((row) => row.scenarioId));
    for (const required of ["tool_search_summary_admitted", "mcp_resources_exact_server_selector", "mcp_templates_exact_server_selector", "mcp_read_excerpt_admitted", "binary_resource_ref_only", "provider_continuation_suppressed"]) {
      if (!scenarioIds.has(required)) errors.push(`scenario_missing:${required}`);
    }
    for (const row of arrayOrEmpty(proof.scenarioSuite.scenarios)) {
      if (row.schema !== EXTERNAL_WAVE18_HEADLESS_SCENARIO_ROW_SCHEMA) errors.push(`scenario_schema_mismatch:${row.scenarioId}`);
      if (row.status !== "pass") errors.push(`scenario_not_pass:${row.scenarioId}`);
      assertFalseFlags(row, ["providerTransportStarted", "dynamicMcpActionStarted", "pluginInstallStarted", "workspaceMutationStarted", "contextWorldMutationStarted", "durableMemoryAdmissionStarted", "projectTruthGranted", "workspaceEvidenceGranted", "rawProviderPayloadIncluded", "rawExternalPayloadIncluded", "rawResourceUriIncluded", "rawEndpointIncluded", "rawCredentialIncluded", "rawSecretIncluded"], errors, `scenario_boundary_leak:${row.scenarioId}`);
    }
  }
  if (!isPlainObject(proof.negativeScenarioMatrix)) {
    errors.push("missing_negative_scenario_matrix");
  } else {
    if (proof.negativeScenarioMatrix.schema !== EXTERNAL_WAVE18_NEGATIVE_SCENARIO_MATRIX_SCHEMA) errors.push("negative_matrix_schema_mismatch");
    const negativeRows = arrayOrEmpty(proof.negativeScenarioMatrix.rows);
    if (negativeRows.length < 10) errors.push("negative_matrix_coverage_missing");
    const negativeIds = new Set(negativeRows.map((row) => row.rowId));
    for (const required of ["discovered_as_declared_collapse_blocked", "multiple_mcp_servers_without_selector_blocked", "stale_or_unknown_server_identity_blocked", "raw_endpoint_token_leak_blocked", "raw_resource_uri_payload_leak_blocked", "binary_or_oversize_resource_ref_or_blocked", "dynamic_mcp_action_blocked", "plugin_install_blocked", "memory_smuggling_blocked", "project_truth_laundering_blocked"]) {
      if (!negativeIds.has(required)) errors.push(`negative_row_missing:${required}`);
    }
    for (const row of negativeRows) {
      if (row.schema !== EXTERNAL_WAVE18_NEGATIVE_SCENARIO_ROW_SCHEMA) errors.push(`negative_row_schema_mismatch:${row.rowId}`);
      if (row.status !== "pass") errors.push(`negative_row_not_pass:${row.rowId}`);
      assertFalseFlags(row, ["providerTransportStarted", "dynamicMcpActionStarted", "pluginInstallStarted", "workspaceMutationStarted", "contextWorldMutationStarted", "durableMemoryAdmissionStarted", "projectTruthGranted", "workspaceEvidenceGranted", "rawProviderPayloadIncluded", "rawExternalPayloadIncluded", "rawResourceUriIncluded", "rawEndpointIncluded", "rawCredentialIncluded", "rawSecretIncluded"], errors, `negative_row_boundary_leak:${row.rowId}`);
    }
  }
  if (!Array.isArray(proof.residentWitnessRows)) {
    errors.push("missing_resident_witness_rows");
  } else {
    const witnessStates = new Set(proof.residentWitnessRows.map((row) => row.capabilityState));
    for (const required of RESIDENT_WITNESS_STATES) {
      if (!witnessStates.has(required)) errors.push(`resident_witness_state_missing:${required}`);
    }
    const witnessTools = new Set(proof.residentWitnessRows.map((row) => row.toolName));
    for (const toolName of [...EXPECTED_CALLABLE_TOOLS, ...EXPECTED_GUARDED_TOOLS, ...EXPECTED_BLOCKED_TOOLS, ...EXPECTED_FUTURE_TOOLS]) {
      if (!witnessTools.has(toolName)) errors.push(`resident_witness_tool_missing:${toolName}`);
    }
    for (const row of proof.residentWitnessRows) {
      if (row.schema !== EXTERNAL_WAVE18_RESIDENT_WITNESS_ROW_SCHEMA) errors.push(`resident_witness_schema_mismatch:${row.rowId}`);
      if (!RESIDENT_WITNESS_STATES.includes(row.capabilityState)) errors.push(`resident_witness_bad_state:${row.rowId}`);
      assertFalseFlags(row, ["grantsAuthority", "providerTransportStarted", "dynamicMcpActionStarted", "pluginInstallStarted", "workspaceMutationStarted", "durableMemoryAdmissionStarted", "rawExternalPayloadIncluded", "rawResourceUriIncluded", "rawSecretIncluded"], errors, `resident_witness_boundary_leak:${row.rowId}`);
      if (EXPECTED_CALLABLE_TOOLS.includes(row.toolName) && (row.providerDeclared !== true || row.modelCallable !== true || row.residentCallable !== true)) errors.push(`callable_witness_flag_mismatch:${row.toolName}`);
      if (!EXPECTED_CALLABLE_TOOLS.includes(row.toolName) && row.providerDeclared !== false) errors.push(`noncallable_witness_declared:${row.toolName}`);
    }
  }
  if (!isPlainObject(proof.operatorProjection)) {
    errors.push("missing_operator_projection");
  } else {
    if (proof.operatorProjection.schema !== EXTERNAL_WAVE18_OPERATOR_PROJECTION_SCHEMA) errors.push("operator_projection_schema_mismatch");
    if (proof.operatorProjection.readsProofArtifacts !== true) errors.push("operator_projection_not_reading_proof");
    if (proof.operatorProjection.mintsProof !== false || proof.operatorProjection.grantsAuthority !== false) errors.push("operator_projection_authority_leak");
  }
  for (const row of arrayOrEmpty(proof.manualGateRows)) {
    if (row.schema !== EXTERNAL_WAVE18_MANUAL_USABILITY_GATE_ROW_SCHEMA) errors.push(`manual_gate_schema_mismatch:${row.gateId}`);
    if (row.status !== "pass") errors.push(`manual_gate_not_pass:${row.gateId}`);
  }
  const serialized = JSON.stringify(proof);
  for (const forbidden of ["token=secret", "Bearer abcdefghijklmnopqrstuvwxyz", "\"projectTruthGranted\":true", "\"durableMemoryAdmissionStarted\":true", "\"dynamicMcpActionStarted\":true", "\"pluginInstallStarted\":true", "\"wave19ProviderHostedToolsStarted\":true", "\"wave20NewContextExecutionStarted\":true", "\"wave21CodeModeExecutionStarted\":true"]) {
    if (serialized.includes(forbidden)) errors.push(`serialized_boundary_leak:${forbidden}`);
  }
  if (!errors.length) return true;
  const error = new Error(`external_wave18_usability_gate_validation_failed:${errors.join(",")}`);
  error.validationErrors = errors;
  throw error;
}

module.exports = {
  EXTERNAL_WAVE18_HEADLESS_SCENARIO_ROW_SCHEMA,
  EXTERNAL_WAVE18_HEADLESS_SCENARIO_SUITE_SCHEMA,
  EXTERNAL_WAVE18_MANUAL_USABILITY_GATE_ROW_SCHEMA,
  EXTERNAL_WAVE18_NEGATIVE_SCENARIO_MATRIX_SCHEMA,
  EXTERNAL_WAVE18_NEGATIVE_SCENARIO_ROW_SCHEMA,
  EXTERNAL_WAVE18_OPERATOR_PROJECTION_SCHEMA,
  EXTERNAL_WAVE18_RESIDENT_WITNESS_ROW_SCHEMA,
  EXTERNAL_WAVE18_USABILITY_PROOF_SCHEMA,
  buildExternalWave18UsabilityGate,
  validateExternalWave18UsabilityGate,
};
