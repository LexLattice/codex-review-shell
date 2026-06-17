"use strict";

const crypto = require("node:crypto");
const { buildToolCapabilityRegistry } = require("../bridge/tool-capability-registry");

const DIRECT_HEADLESS_TOOL_CLASS_EXAMPLE_PACK_SCHEMA = "direct_headless_tool_class_example_pack@1";
const DIRECT_HEADLESS_TOOL_CLASS_EXAMPLE_SCHEMA = "direct_headless_tool_class_example@1";
const DIRECT_HEADLESS_TOOL_CLASS_EXAMPLE_REPORT_SCHEMA = "direct_headless_tool_class_example_report@1";

const TEST_MODES = new Set(["real_provider", "headless_fixture", "projection_blocked", "unsupported_blocked"]);
const REALISM_TIERS = new Set(["real_provider", "headless_runtime", "fixture", "projection", "unsupported"]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedString(value, maxLength = 420) {
  const text = normalizeString(value, "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function normalizeStringList(values, fallback = []) {
  const source = Array.isArray(values) ? values : fallback;
  return [...new Set(source.map((value) => normalizeString(value, "")).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

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

function nowIso(nowMs) {
  const ms = typeof nowMs === "number" && Number.isFinite(nowMs) ? nowMs : Date.now();
  return new Date(ms).toISOString();
}

function rowMapForRegistry(registry = {}) {
  return new Map((Array.isArray(registry.rows) ? registry.rows : []).map((row) => [row.toolId, row]));
}

function normalizeEnum(value, allowed, fallback) {
  const text = normalizeString(value, fallback);
  return allowed.has(text) ? text : fallback;
}

function defaultExamples() {
  return [
    {
      exampleId: "ex.local_perception.read_file",
      toolClassId: "local_perception.workspace_read",
      toolIdsCovered: ["direct.read_file"],
      testMode: "headless_fixture",
      realismTier: "headless_runtime",
      runnerScripts: ["scripts/direct-headless-implementation-runtime-regression.mjs", "scripts/direct-read-tool-loop-regression.mjs"],
      npmScripts: ["direct:headless-implementation-runtime", "direct:read-tool-loop"],
      inputExample: {
        schema: "direct_read_file_tool_call_example@1",
        path: "README.md",
        rawPathIncluded: false,
      },
      expectedEvidenceSchemas: ["direct_tool_obligation", "direct_read_file_result", "direct_tool_continuation_request"],
      successAssertions: ["workspace read is approved before execution", "result enters provider only through bounded continuation"],
      forbiddenSideEffects: ["workspace_write", "process_spawn", "provider_tool_laundering"],
    },
    {
      exampleId: "ex.local_perception.view_image_projection",
      toolClassId: "local_perception.image_view_metadata",
      toolIdsCovered: ["vanilla.view_image"],
      testMode: "projection_blocked",
      realismTier: "projection",
      runnerScripts: ["scripts/direct-control-tool-substrate-regression.mjs"],
      npmScripts: ["direct:control-tool-substrate"],
      inputExample: {
        schema: "direct_view_image_projection_example@1",
        imageEvidenceKey: "image_ref_fixture",
        rawImageBytesIncluded: false,
      },
      expectedEvidenceSchemas: ["direct_view_image_projection"],
      successAssertions: ["renderer-safe image metadata can be projected without reading raw image bytes"],
      forbiddenSideEffects: ["provider_transport", "workspace_write", "raw_image_exposure"],
    },
    {
      exampleId: "ex.workspace_process.patch_apply",
      toolClassId: "workspace_process.patch_apply",
      toolIdsCovered: ["vanilla.apply_patch"],
      testMode: "headless_fixture",
      realismTier: "headless_runtime",
      runnerScripts: ["scripts/direct-patch-tool-loop-regression.mjs"],
      npmScripts: ["direct:patch-tool-loop"],
      inputExample: {
        schema: "direct_apply_patch_example@1",
        patchDialect: "unified_diff",
        workspaceFixture: "disposable_temp_workspace",
      },
      expectedEvidenceSchemas: ["direct_patch_apply_obligation", "direct_patch_apply_result", "workspace_mutation_truth"],
      successAssertions: ["patch is approved before write", "workspace mutation truth is recorded"],
      forbiddenSideEffects: ["path_escape", "silent_workspace_write", "raw_secret_exposure"],
    },
    {
      exampleId: "ex.workspace_process.run_command",
      toolClassId: "workspace_process.run_command",
      toolIdsCovered: ["direct.run_command"],
      testMode: "headless_fixture",
      realismTier: "headless_runtime",
      runnerScripts: ["scripts/direct-command-tool-loop-regression.mjs"],
      npmScripts: ["direct:command-tool-loop"],
      inputExample: {
        schema: "direct_run_command_example@1",
        commandPreview: "node -e console.log('ok')",
        shell: false,
      },
      expectedEvidenceSchemas: ["direct_command_execution_obligation", "direct_command_execution_result", "workspace_effect_summary"],
      successAssertions: ["command is approved before spawn", "stdout/stderr are bounded", "workspace effects are scanned"],
      forbiddenSideEffects: ["shell_true_default", "unbounded_output", "environment_secret_leak"],
    },
    {
      exampleId: "ex.workspace_process.stateful_exec",
      toolClassId: "workspace_process.stateful_exec_session",
      toolIdsCovered: ["vanilla.exec_command", "vanilla.write_stdin"],
      testMode: "headless_fixture",
      realismTier: "headless_runtime",
      runnerScripts: ["scripts/direct-stateful-exec-session-regression.mjs"],
      npmScripts: ["direct:stateful-exec-session"],
      inputExample: {
        schema: "stateful_exec_session_envelope_example@1",
        stdinFrame: "echo ok",
        tty: false,
      },
      expectedEvidenceSchemas: ["stateful_exec_session_envelope", "stateful_stdin_envelope", "bounded_output_frame"],
      successAssertions: ["stdin targets a known session id", "output frames are bounded and ordered"],
      forbiddenSideEffects: ["stdin_without_session", "pty_by_default", "session_replay_without_state"],
    },
    {
      exampleId: "ex.workspace_process.unsupported_shell",
      toolClassId: "workspace_process.unsupported_shell_command",
      toolIdsCovered: ["vanilla.shell_command"],
      testMode: "unsupported_blocked",
      realismTier: "unsupported",
      runnerScripts: ["scripts/direct-tool-capability-registry-regression.mjs"],
      npmScripts: ["direct:tool-capability-registry"],
      inputExample: {
        schema: "unsupported_shell_command_example@1",
        reason: "shell_command is not direct-path authority; use governed command surfaces",
      },
      expectedEvidenceSchemas: ["direct_tool_capability_row"],
      successAssertions: ["registry marks shell_command unsupported"],
      forbiddenSideEffects: ["shell_spawn", "authority_aliasing"],
    },
    {
      exampleId: "ex.session_control.plan_context",
      toolClassId: "session_control.plan_and_context_witness",
      toolIdsCovered: ["vanilla.get_context_remaining", "vanilla.update_plan"],
      testMode: "projection_blocked",
      realismTier: "projection",
      runnerScripts: ["scripts/direct-control-tool-substrate-regression.mjs"],
      npmScripts: ["direct:control-tool-substrate"],
      inputExample: {
        schema: "direct_control_projection_example@1",
        planRows: ["pending", "in_progress", "completed"],
      },
      expectedEvidenceSchemas: ["direct_context_remaining_witness", "direct_plan_artifact"],
      successAssertions: ["plan/context controls are projected without claiming task completion authority"],
      forbiddenSideEffects: ["provider_transport", "goal_completion_claim", "context_mutation_without_gate"],
    },
    {
      exampleId: "ex.session_control.new_context_blocked",
      toolClassId: "session_control.new_context_blocked",
      toolIdsCovered: ["vanilla.new_context"],
      testMode: "unsupported_blocked",
      realismTier: "unsupported",
      runnerScripts: ["scripts/direct-control-tool-substrate-regression.mjs"],
      npmScripts: ["direct:control-tool-substrate"],
      inputExample: {
        schema: "direct_new_context_blocked_example@1",
        reason: "new_context changes the informational world and needs context-maintenance law",
      },
      expectedEvidenceSchemas: ["direct_new_context_blocked_projection"],
      successAssertions: ["new_context remains blocked until maintenance/omission/frontier law is wired"],
      forbiddenSideEffects: ["context_reset", "silent_history_drop", "provider_continuation_reset"],
    },
    {
      exampleId: "ex.human_authority.decision_bridge",
      toolClassId: "human_authority.decision_packet",
      toolIdsCovered: ["vanilla.request_user_input", "vanilla.request_permissions"],
      testMode: "projection_blocked",
      realismTier: "projection",
      runnerScripts: ["scripts/direct-control-tool-substrate-regression.mjs"],
      npmScripts: ["direct:control-tool-substrate"],
      inputExample: {
        schema: "direct_human_decision_tool_packet_example@1",
        choices: ["continue", "pause"],
      },
      expectedEvidenceSchemas: ["direct_human_decision_tool_packet"],
      successAssertions: ["human decision packets are bounded and do not auto-widen authority"],
      forbiddenSideEffects: ["permission_grant_without_operator", "free_text_authority_widening"],
    },
    {
      exampleId: "ex.agent_runtime.text_surface",
      toolClassId: "agent_runtime.text_only_sub_agent_surface",
      toolIdsCovered: [
        "vanilla.agent.followup_task",
        "vanilla.agent.list_agents",
        "vanilla.agent.send_message",
        "vanilla.agent.spawn_agent",
        "vanilla.agent.wait_agent",
      ],
      testMode: "headless_fixture",
      realismTier: "headless_runtime",
      runnerScripts: ["scripts/direct-agent-runtime-substrate-regression.mjs", "scripts/direct-text-sub-agent-tool-surface-regression.mjs"],
      npmScripts: ["direct:agent-runtime-substrate", "direct:text-sub-agent-tool-surface"],
      inputExample: {
        schema: "direct_text_sub_agent_spawn_request_example@1",
        agentClassKind: "implementation_worker",
        childToolsAllowed: false,
      },
      expectedEvidenceSchemas: ["direct_text_sub_agent_tool_surface", "direct_agent_wait_plan", "direct_agent_mailbox_write_plan"],
      successAssertions: ["agent graph identity is explicit", "child tool authority is not inherited"],
      forbiddenSideEffects: ["recursive_spawn_default", "parent_success_laundering", "child_tool_inheritance"],
    },
    {
      exampleId: "ex.agent_runtime.interrupt_projection",
      toolClassId: "agent_runtime.interrupt_projection",
      toolIdsCovered: ["vanilla.agent.interrupt_agent"],
      testMode: "projection_blocked",
      realismTier: "projection",
      runnerScripts: ["scripts/direct-text-sub-agent-tool-surface-regression.mjs"],
      npmScripts: ["direct:text-sub-agent-tool-surface"],
      inputExample: {
        schema: "direct_agent_interrupt_request_example@1",
        providerCancelAllowed: false,
      },
      expectedEvidenceSchemas: ["direct_agent_interrupt_request"],
      successAssertions: ["interrupt is represented without provider cancel authority"],
      forbiddenSideEffects: ["provider_cancel_without_support", "thread_shutdown_without_gate"],
    },
    {
      exampleId: "ex.agent_runtime.multi_agent_v1_unsupported",
      toolClassId: "agent_runtime.multi_agent_v1_unsupported",
      toolIdsCovered: [
        "vanilla.multi_agent_v1.close_agent",
        "vanilla.multi_agent_v1.resume_agent",
        "vanilla.multi_agent_v1.send_input",
        "vanilla.multi_agent_v1.spawn_agent",
        "vanilla.multi_agent_v1.wait_agent",
      ],
      testMode: "unsupported_blocked",
      realismTier: "unsupported",
      runnerScripts: ["scripts/direct-tool-capability-registry-regression.mjs"],
      npmScripts: ["direct:tool-capability-registry"],
      inputExample: {
        schema: "multi_agent_v1_unsupported_example@1",
        replacementSurface: "vanilla.agent.* direct text-only surface",
      },
      expectedEvidenceSchemas: ["direct_tool_capability_row"],
      successAssertions: ["legacy multi_agent_v1 rows stay unsupported"],
      forbiddenSideEffects: ["legacy_agent_api_aliasing"],
    },
    {
      exampleId: "ex.external.discovery_registry",
      toolClassId: "external.discovery_registry",
      toolIdsCovered: [
        "vanilla.list_available_plugins_to_install",
        "vanilla.list_mcp_resource_templates",
        "vanilla.list_mcp_resources",
        "vanilla.tool_search",
      ],
      testMode: "projection_blocked",
      realismTier: "projection",
      runnerScripts: ["scripts/direct-external-capability-discovery-regression.mjs", "scripts/direct-plugin-governance-regression.mjs"],
      npmScripts: ["direct:external-capability-discovery", "direct:plugin-governance"],
      inputExample: {
        schema: "external_capability_discovery_example@1",
        discoverySource: "deferred_registry",
      },
      expectedEvidenceSchemas: ["external_capability_descriptor", "external_resource_descriptor", "plugin_catalog_descriptor"],
      successAssertions: ["external discovery stays descriptor-only"],
      forbiddenSideEffects: ["external_tool_execution", "plugin_install", "raw_manifest_exposure"],
    },
    {
      exampleId: "ex.external.resource_action_boundary",
      toolClassId: "external.resource_action_boundary",
      toolIdsCovered: ["vanilla.mcp_dynamic_tool", "vanilla.read_mcp_resource"],
      testMode: "projection_blocked",
      realismTier: "projection",
      runnerScripts: ["scripts/direct-mcp-resource-tool-boundary-regression.mjs"],
      npmScripts: ["direct:mcp-boundary"],
      inputExample: {
        schema: "mcp_resource_action_boundary_example@1",
        resourceEvidenceKey: "mcp_resource_fixture",
      },
      expectedEvidenceSchemas: ["mcp_resource_read_boundary", "mcp_dynamic_tool_call_boundary"],
      successAssertions: ["external reads/actions require provenance and remain deferred"],
      forbiddenSideEffects: ["external_mutation", "credential_exposure", "unbounded_result_import"],
    },
    {
      exampleId: "ex.plugin.install_governance",
      toolClassId: "plugin.install_governance",
      toolIdsCovered: ["vanilla.request_plugin_install"],
      testMode: "projection_blocked",
      realismTier: "projection",
      runnerScripts: ["scripts/direct-plugin-governance-regression.mjs"],
      npmScripts: ["direct:plugin-governance"],
      inputExample: {
        schema: "plugin_install_request_posture_example@1",
        sourcePinned: false,
      },
      expectedEvidenceSchemas: ["plugin_install_request_posture", "plugin_capability_diff", "plugin_rollback_law"],
      successAssertions: ["plugin install remains a governed mutation request, not an executable action"],
      forbiddenSideEffects: ["plugin_install", "auto_enable_new_tools", "registry_mutation"],
    },
    {
      exampleId: "ex.provider_hosted.projection",
      toolClassId: "provider_hosted.web_image_projection",
      toolIdsCovered: ["vanilla.hosted.image_generation", "vanilla.hosted.web_search"],
      testMode: "projection_blocked",
      realismTier: "projection",
      runnerScripts: ["scripts/direct-provider-hosted-tools-regression.mjs"],
      npmScripts: ["direct:provider-hosted-tools"],
      inputExample: {
        schema: "provider_hosted_tool_capability_example@1",
        providerMetadataRequired: true,
      },
      expectedEvidenceSchemas: ["provider_web_search_evidence_contract", "provider_image_generation_artifact_contract"],
      successAssertions: ["hosted tools require provider metadata before declaration"],
      forbiddenSideEffects: ["provider_tool_declaration", "web_request", "generated_artifact_write"],
    },
    {
      exampleId: "ex.structured_execution.code_mode",
      toolClassId: "structured_execution.code_mode_lane",
      toolIdsCovered: ["vanilla.code_mode_execute", "vanilla.code_mode_wait"],
      testMode: "projection_blocked",
      realismTier: "projection",
      runnerScripts: ["scripts/direct-code-mode-execution-lane-regression.mjs"],
      npmScripts: ["direct:code-mode-execution-lane"],
      inputExample: {
        schema: "code_mode_execute_request_posture_example@1",
        kernelSessionState: "not_started",
      },
      expectedEvidenceSchemas: ["code_mode_execution_lane_status", "code_mode_wait_cancel_policy"],
      successAssertions: ["code mode stays a separate structured lane and execution remains blocked"],
      forbiddenSideEffects: ["kernel_start", "workspace_artifact_write", "shell_aliasing"],
    },
    {
      exampleId: "ex.batch_agent.job_projection",
      toolClassId: "batch_agent.fanout_fanin_job",
      toolIdsCovered: ["vanilla.report_agent_job_result", "vanilla.spawn_agents_on_csv"],
      testMode: "projection_blocked",
      realismTier: "projection",
      runnerScripts: ["scripts/direct-batch-agent-jobs-regression.mjs"],
      npmScripts: ["direct:batch-agent-jobs"],
      inputExample: {
        schema: "direct_batch_agent_job_plan_example@1",
        csvEvidenceKey: "csv_fixture_ref",
        workerCount: 2,
      },
      expectedEvidenceSchemas: ["direct_batch_agent_job_plan", "direct_batch_agent_result_contract", "direct_batch_agent_aggregation_ledger"],
      successAssertions: ["fan-out/fan-in contracts exist without spawning workers"],
      forbiddenSideEffects: ["local_batch_execution", "parent_claim_worker_success", "raw_csv_exposure"],
    },
  ];
}

function normalizeExample(input = {}, registryRowsByToolId = new Map()) {
  const toolIdsCovered = normalizeStringList(input.toolIdsCovered);
  const coveredRows = toolIdsCovered.map((toolId) => registryRowsByToolId.get(toolId)).filter(Boolean);
  const example = {
    schema: DIRECT_HEADLESS_TOOL_CLASS_EXAMPLE_SCHEMA,
    exampleId: normalizeString(input.exampleId, ""),
    toolClassId: normalizeString(input.toolClassId, ""),
    toolIdsCovered,
    missingToolIds: toolIdsCovered.filter((toolId) => !registryRowsByToolId.has(toolId)),
    odeuFamilies: normalizeStringList(coveredRows.map((row) => row.odeuFamily)),
    implementationStates: normalizeStringList(coveredRows.map((row) => row.implementationState)),
    promotionStates: normalizeStringList(coveredRows.map((row) => row.promotionState)),
    authorityRequirements: normalizeStringList(coveredRows.map((row) => row.authorityRequired)),
    sideEffectClasses: normalizeStringList(coveredRows.map((row) => row.sideEffectClass)),
    testMode: normalizeEnum(input.testMode, TEST_MODES, "projection_blocked"),
    realismTier: normalizeEnum(input.realismTier, REALISM_TIERS, "projection"),
    runnerScripts: normalizeStringList(input.runnerScripts),
    npmScripts: normalizeStringList(input.npmScripts),
    inputExample: isPlainObject(input.inputExample) ? { ...input.inputExample } : {},
    expectedEvidenceSchemas: normalizeStringList(input.expectedEvidenceSchemas),
    successAssertions: normalizeStringList(input.successAssertions),
    forbiddenSideEffects: normalizeStringList(input.forbiddenSideEffects),
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
    rendererAuthorityGranted: false,
    providerTransportStartedByExample: false,
    workspaceMutationStartedByExample: false,
    runnerExecutionDefault: "validate_only",
    rendererSafeSummary: boundedString(input.rendererSafeSummary || `${input.toolClassId || input.exampleId} has a headless test-class example.`, 420),
  };
  example.exampleDigest = digestFor("direct-headless-tool-class-example@1", example);
  return example;
}

function duplicateToolIds(examples = []) {
  const seen = new Set();
  const duplicates = new Set();
  for (const example of examples) {
    for (const toolId of example.toolIdsCovered || []) {
      if (seen.has(toolId)) duplicates.add(toolId);
      seen.add(toolId);
    }
  }
  return [...duplicates].sort((a, b) => a.localeCompare(b));
}

function buildDirectHeadlessToolClassExamplePack(options = {}) {
  const registry = isPlainObject(options.registry)
    ? options.registry
    : buildToolCapabilityRegistry({
      projectId: normalizeString(options.projectId, "direct_headless_tool_class_examples"),
      nowMs: options.nowMs,
    });
  const registryRowsByToolId = rowMapForRegistry(registry);
  const examples = defaultExamples().map((example) => normalizeExample(example, registryRowsByToolId));
  const coveredToolIds = new Set(examples.flatMap((example) => example.toolIdsCovered));
  const registryToolIds = [...registryRowsByToolId.keys()].sort((a, b) => a.localeCompare(b));
  const uncoveredToolIds = registryToolIds.filter((toolId) => !coveredToolIds.has(toolId));
  const duplicateCoverageToolIds = duplicateToolIds(examples);
  const pack = {
    schema: DIRECT_HEADLESS_TOOL_CLASS_EXAMPLE_PACK_SCHEMA,
    packId: normalizeString(options.packId, `direct_headless_tool_class_examples_${digestFor("direct-headless-tool-class-pack-source@1", registryToolIds).slice(0, 24)}`),
    registryId: normalizeString(registry.registryId, ""),
    registryDigest: normalizeString(registry.registryDigest, ""),
    generatedAt: normalizeString(options.generatedAt, nowIso(options.nowMs)),
    purpose: "Provide one canonical headless example posture per direct tool authority class before broad real testing.",
    executionDefault: "validate_only",
    fixtureExecutionOptInFlag: "--execute-fixtures",
    examples,
    coverage: {
      registryToolCount: registryToolIds.length,
      coveredToolCount: registryToolIds.filter((toolId) => coveredToolIds.has(toolId)).length,
      exampleCount: examples.length,
      uncoveredToolIds,
      duplicateCoverageToolIds,
      missingToolIds: [...new Set(examples.flatMap((example) => example.missingToolIds))].sort((a, b) => a.localeCompare(b)),
      realProviderExampleCount: examples.filter((example) => example.testMode === "real_provider").length,
      headlessFixtureExampleCount: examples.filter((example) => example.testMode === "headless_fixture").length,
      projectionBlockedExampleCount: examples.filter((example) => example.testMode === "projection_blocked").length,
      unsupportedBlockedExampleCount: examples.filter((example) => example.testMode === "unsupported_blocked").length,
    },
    noProviderTransportByDefault: true,
    noWorkspaceMutationByDefault: true,
    noRendererAuthorityByDefault: true,
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
  };
  pack.packDigest = digestFor("direct-headless-tool-class-example-pack@1", pack);
  return pack;
}

function validateDirectHeadlessToolClassExamplePack(pack = {}) {
  const errors = [];
  if (!isPlainObject(pack) || pack.schema !== DIRECT_HEADLESS_TOOL_CLASS_EXAMPLE_PACK_SCHEMA) {
    return ["direct_headless_tool_class_example_pack_schema_mismatch"];
  }
  if (pack.noProviderTransportByDefault !== true) errors.push("provider_transport_default_not_blocked");
  if (pack.noWorkspaceMutationByDefault !== true) errors.push("workspace_mutation_default_not_blocked");
  if (pack.noRendererAuthorityByDefault !== true) errors.push("renderer_authority_default_not_blocked");
  for (const flag of ["rawPromptIncluded", "rawResultIncluded", "rawWorkspacePathIncluded", "rawSecretIncluded"]) {
    if (pack[flag] !== false) errors.push(`pack_raw_exposure:${flag}`);
  }
  if (!Array.isArray(pack.examples) || !pack.examples.length) errors.push("examples_missing");
  for (const example of Array.isArray(pack.examples) ? pack.examples : []) {
    if (!isPlainObject(example) || example.schema !== DIRECT_HEADLESS_TOOL_CLASS_EXAMPLE_SCHEMA) {
      errors.push("example_schema_mismatch");
      continue;
    }
    if (!example.exampleId) errors.push("example_missing_id");
    if (!example.toolClassId) errors.push(`example_missing_tool_class:${example.exampleId || ""}`);
    if (!Array.isArray(example.toolIdsCovered) || !example.toolIdsCovered.length) errors.push(`example_missing_tools:${example.exampleId || ""}`);
    if (Array.isArray(example.missingToolIds) && example.missingToolIds.length) errors.push(`example_missing_registry_tools:${example.exampleId}:${example.missingToolIds.join(",")}`);
    if (!TEST_MODES.has(example.testMode)) errors.push(`example_invalid_test_mode:${example.exampleId}:${example.testMode || ""}`);
    if (!REALISM_TIERS.has(example.realismTier)) errors.push(`example_invalid_realism_tier:${example.exampleId}:${example.realismTier || ""}`);
    if (!Array.isArray(example.expectedEvidenceSchemas) || !example.expectedEvidenceSchemas.length) errors.push(`example_missing_evidence:${example.exampleId || ""}`);
    for (const flag of ["rawPromptIncluded", "rawResultIncluded", "rawWorkspacePathIncluded", "rawSecretIncluded", "rendererAuthorityGranted", "providerTransportStartedByExample", "workspaceMutationStartedByExample"]) {
      if (example[flag] !== false) errors.push(`example_authority_or_raw_leak:${example.exampleId}:${flag}`);
    }
  }
  if (pack.coverage?.uncoveredToolIds?.length) errors.push(`uncovered_tool_ids:${pack.coverage.uncoveredToolIds.join(",")}`);
  if (pack.coverage?.duplicateCoverageToolIds?.length) errors.push(`duplicate_tool_coverage:${pack.coverage.duplicateCoverageToolIds.join(",")}`);
  if (pack.coverage?.missingToolIds?.length) errors.push(`missing_tool_ids:${pack.coverage.missingToolIds.join(",")}`);
  return errors;
}

function buildDirectHeadlessToolClassExampleReport(options = {}) {
  const pack = isPlainObject(options.pack) ? options.pack : buildDirectHeadlessToolClassExamplePack(options);
  const validationErrors = validateDirectHeadlessToolClassExamplePack(pack);
  const report = {
    schema: DIRECT_HEADLESS_TOOL_CLASS_EXAMPLE_REPORT_SCHEMA,
    reportId: normalizeString(options.reportId, `direct_headless_tool_class_example_report_${digestFor("direct-headless-tool-class-report-source@1", pack.packDigest).slice(0, 24)}`),
    generatedAt: normalizeString(options.generatedAt, nowIso(options.nowMs)),
    packId: pack.packId,
    packDigest: pack.packDigest,
    status: validationErrors.length ? "failed" : "passed",
    executionMode: "validate_only",
    validationErrors,
    coverage: { ...(pack.coverage || {}) },
    exampleRows: (pack.examples || []).map((example) => ({
      exampleId: example.exampleId,
      toolClassId: example.toolClassId,
      toolIdsCovered: [...example.toolIdsCovered],
      testMode: example.testMode,
      realismTier: example.realismTier,
      runnerScripts: [...example.runnerScripts],
      npmScripts: [...example.npmScripts],
      expectedEvidenceSchemas: [...example.expectedEvidenceSchemas],
      forbiddenSideEffects: [...example.forbiddenSideEffects],
      exampleDigest: example.exampleDigest,
      runnableByDefault: false,
    })),
    providerTransportStarted: false,
    workspaceMutationStarted: false,
    rendererAuthorityGranted: false,
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
  };
  report.reportDigest = digestFor("direct-headless-tool-class-example-report@1", report);
  return report;
}

module.exports = {
  DIRECT_HEADLESS_TOOL_CLASS_EXAMPLE_PACK_SCHEMA,
  DIRECT_HEADLESS_TOOL_CLASS_EXAMPLE_REPORT_SCHEMA,
  DIRECT_HEADLESS_TOOL_CLASS_EXAMPLE_SCHEMA,
  buildDirectHeadlessToolClassExamplePack,
  buildDirectHeadlessToolClassExampleReport,
  validateDirectHeadlessToolClassExamplePack,
};
