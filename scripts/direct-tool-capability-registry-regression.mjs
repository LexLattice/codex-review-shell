#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  DIRECT_TOOL_CAPABILITY_REGISTRY_SCHEMA,
  DIRECT_TOOL_CAPABILITY_ROW_SCHEMA,
  DIRECT_TOOL_CAPABILITY_STATUS_PROJECTION_SCHEMA,
  buildToolCapabilityRegistry,
  buildToolCapabilityRow,
  buildToolCapabilityStatusProjection,
  defaultToolCapabilityInputs,
  validateToolCapabilityRegistry,
} = require("../src/main/direct/bridge/tool-capability-registry");
const {
  assertDirectSettingsSurfaceRendererSafe,
  buildDirectSettingsSurfaceProjection,
} = require("../src/main/direct/ui/settings-surface");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectThrows(fn, expectedMessage) {
  try {
    fn();
  } catch (error) {
    if (expectedMessage && !String(error?.message || "").includes(expectedMessage)) {
      throw new Error(`expected ${expectedMessage}, got ${error?.message || error}`);
    }
    return;
  }
  throw new Error(`expected throw: ${expectedMessage}`);
}

function byToolId(registry) {
  return new Map(registry.rows.map((row) => [row.toolId, row]));
}

function main() {
  const defaultRows = defaultToolCapabilityInputs();
  const registry = buildToolCapabilityRegistry({
    projectId: "project_tool_capability_fixture",
    workThreadId: "work_thread_tool_capability_fixture",
    nowMs: 0,
  });
  assert(registry.schema === DIRECT_TOOL_CAPABILITY_REGISTRY_SCHEMA, "registry schema mismatch");
  assert(registry.rowCount >= 30, "default registry should cover vanilla tool families broadly");
  assert(defaultRows.length === registry.rowCount, "default input count should match registry rows");
  assert(registry.createdAt === "1970-01-01T00:00:00.000Z", "epoch-zero timestamp should be preserved");
  assert(Boolean(registry.registrySourceDigest), "registry source digest should exist");
  assert(Boolean(registry.registryDigest), "registry digest should exist");
  assert(registry.registryDigest !== registry.registrySourceDigest, "registry artifact digest should differ from source digest");
  validateToolCapabilityRegistry(registry);

  const rows = byToolId(registry);
  for (const requiredToolId of [
    "direct.read_file",
    "direct.run_command",
    "vanilla.apply_patch",
    "vanilla.exec_command",
    "vanilla.write_stdin",
    "vanilla.request_permissions",
    "vanilla.view_image",
    "vanilla.update_plan",
    "vanilla.request_user_input",
    "vanilla.get_context_remaining",
    "vanilla.new_context",
    "vanilla.agent.spawn_agent",
    "vanilla.agent.wait_agent",
    "vanilla.multi_agent_v1.spawn_agent",
    "vanilla.spawn_agents_on_csv",
    "vanilla.tool_search",
    "vanilla.read_mcp_resource",
    "vanilla.mcp_dynamic_tool",
    "vanilla.request_plugin_install",
    "vanilla.hosted.web_search",
    "vanilla.hosted.image_generation",
    "vanilla.code_mode_execute",
  ]) {
    assert(rows.has(requiredToolId), `missing required tool row: ${requiredToolId}`);
  }

  const directRead = rows.get("direct.read_file");
  const applyPatch = rows.get("vanilla.apply_patch");
  const runCommand = rows.get("direct.run_command");
  const execCommand = rows.get("vanilla.exec_command");
  const newContext = rows.get("vanilla.new_context");
  const spawnAgent = rows.get("vanilla.agent.spawn_agent");
  const listAgents = rows.get("vanilla.agent.list_agents");
  const waitAgent = rows.get("vanilla.agent.wait_agent");
  const sendMessage = rows.get("vanilla.agent.send_message");
  const followupTask = rows.get("vanilla.agent.followup_task");
  const interruptAgent = rows.get("vanilla.agent.interrupt_agent");
  const pluginInstall = rows.get("vanilla.request_plugin_install");
  const codeModeExecute = rows.get("vanilla.code_mode_execute");
  const codeModeWait = rows.get("vanilla.code_mode_wait");
  assert(directRead.schema === DIRECT_TOOL_CAPABILITY_ROW_SCHEMA, "tool row schema mismatch");
  assert(directRead.promotionState === "direct_restricted", "direct read should be restricted");
  assert(directRead.localExecutorState === "implemented_restricted", "direct read should cite restricted executor");
  assert(applyPatch.promotionState === "direct_restricted", "apply_patch should be restricted");
  assert(runCommand.promotionState === "direct_restricted", "run_command should be restricted");
  assert(execCommand.promotionState === "direct_restricted", "exec_command should be restricted through stateful exec session surface");
  assert(execCommand.localExecutorState === "implemented_restricted", "exec_command should cite restricted stateful executor");
  assert(execCommand.localExecutor === "src/main/direct/tools/stateful-exec-session.js", "exec_command should not be aliased to direct run_command");
  assert(rows.get("vanilla.write_stdin").promotionState === "direct_restricted", "write_stdin should be restricted through stateful stdin surface");
  assert(rows.get("vanilla.write_stdin").localExecutor === "src/main/direct/tools/stateful-exec-session.js", "write_stdin should cite restricted stateful executor");
  assert(runCommand.localExecutor !== execCommand.localExecutor, "run_command and exec_command should remain separate executors");
  assert(newContext.promotionState === "unsupported", "new_context should remain blocked");
  assert(newContext.authorityRequired === "context_maintenance_gate", "new_context should require context maintenance law");
  assert(spawnAgent.odeuFamily === "agent_runtime", "spawn_agent should be classified as agent runtime");
  assert(spawnAgent.promotionState === "direct_restricted", "spawn_agent should be restricted through the text-only sub-agent surface");
  assert(spawnAgent.localExecutorState === "implemented_restricted", "spawn_agent should cite the restricted text-only executor");
  assert(listAgents.promotionState === "direct_restricted", "list_agents should be restricted through the text-only sub-agent surface");
  assert(waitAgent.promotionState === "direct_restricted", "wait_agent should be restricted through bounded wait plans");
  assert(sendMessage.promotionState === "direct_restricted", "send_message should be restricted through mailbox write plans");
  assert(followupTask.promotionState === "direct_restricted", "followup_task should be restricted through mailbox write plans");
  assert(interruptAgent.promotionState === "diagnostic_only", "interrupt_agent should remain provider-cancel disabled");
  assert(pluginInstall.sideEffectClass === "capability_mutation", "plugin install should be capability mutation");
  assert(pluginInstall.promotionState === "deferred_external_authority", "plugin install should defer external authority");
  assert(codeModeExecute.odeuFamily === "structured_execution_lane", "code_mode_execute should be structured execution lane");
  assert(codeModeExecute.promotionState === "diagnostic_only", "code_mode_execute should remain diagnostic-only");
  assert(codeModeExecute.localExecutor === "src/main/direct/tools/code-mode-execution-lane.js", "code_mode_execute should cite code mode lane");
  assert(codeModeExecute.requestShapeFamilies.includes("code_mode_execute_request_posture"), "code_mode_execute should declare execute posture");
  assert(codeModeWait.requestShapeFamilies.includes("code_mode_wait_cancel_policy"), "code_mode_wait should declare wait/cancel policy");

  for (const row of registry.rows) {
    assert(row.toolEnabledInThisPr === false, `${row.toolId} must not enable tool`);
    assert(row.providerDeclarationEnabledInThisPr === false, `${row.toolId} must not enable provider declaration`);
    assert(row.localExecutionEnabledInThisPr === false, `${row.toolId} must not enable local execution`);
    assert(row.authorityGateEnabledInThisPr === false, `${row.toolId} must not enable authority gate`);
    assert(row.rawTextIncluded === false, `${row.toolId} must not expose raw text`);
    assert(row.rawSecretIncluded === false, `${row.toolId} must not expose raw secret`);
  }

  const status = buildToolCapabilityStatusProjection({ registry });
  assert(status.schema === DIRECT_TOOL_CAPABILITY_STATUS_PROJECTION_SCHEMA, "status projection schema mismatch");
  assert(status.rowCount === registry.rowCount, "status row count should match registry");
  assert(status.directRestrictedCount >= 3, "status should count already-restricted direct tools");
  assert(status.unsupportedCount >= 1, "status should count unsupported tools");
  assert(status.deferredExternalAuthorityCount >= 1, "status should count deferred external authority");
  assert(status.providerDeclarationsEnabledInThisPr === false, "status must not enable provider declarations");
  assert(status.localExecutionEnabledInThisPr === false, "status must not enable local execution");
  assert(status.authorityGateEnabledInThisPr === false, "status must not enable authority gates");
  assert(status.actionable === false, "status must be read-only");

  const settingsProjection = buildDirectSettingsSurfaceProjection({
    projectId: registry.projectId,
    toolCapabilityStatus: status,
  });
  assert(settingsProjection.sections.toolCapabilities.rowCount === registry.rowCount, "settings surface should include tool capability count");
  assert(settingsProjection.sections.toolCapabilities.localExecutionEnabledInThisPr === false, "settings surface must not enable execution");
  assert(settingsProjection.sections.toolCapabilities.authorityGateEnabledInThisPr === false, "settings surface must not enable authority gates");
  assert(Array.isArray(settingsProjection.rows.toolCapabilities) && settingsProjection.rows.toolCapabilities.length >= 6, "settings surface should render tool capability rows");
  assert(settingsProjection.authority.toolProviderDeclarationAllowed === false, "settings authority must block provider tool declaration");
  assert(settingsProjection.authority.toolLocalExecutionAllowed === false, "settings authority must block local tool execution");
  assertDirectSettingsSurfaceRendererSafe(settingsProjection);

  const pollutedSettingsProjection = buildDirectSettingsSurfaceProjection({
    projectId: registry.projectId,
    status: "polluted_parent_status",
    rowCount: 999,
    toolCapabilityStatus: status,
  });
  assert(pollutedSettingsProjection.sections.toolCapabilities.rowCount === registry.rowCount, "settings surface should prefer nested tool capability status over parent fields");
  assert(pollutedSettingsProjection.sections.toolCapabilities.status === "constitution_only", "settings surface should not inherit parent status field");

  const missingSettingsProjection = buildDirectSettingsSurfaceProjection({
    projectId: registry.projectId,
    status: "polluted_parent_status",
    rowCount: 999,
  });
  assert(missingSettingsProjection.sections.toolCapabilities.rowCount === 0, "missing tool capability status should not inherit parent rowCount");
  assert(missingSettingsProjection.sections.toolCapabilities.status === "not_exposed", "missing tool capability status should not inherit parent status");

  const hostileEnabled = buildToolCapabilityRegistry({
    rows: [{
      toolId: "hostile.enabled_without_executor",
      displayName: "hostile enabled",
      odeuFamily: "workspace_process_authority",
      capabilityState: "provider_accepted",
      implementationState: "schema_only",
      promotionState: "direct_enabled",
      providerDeclarationState: "declared_live_accepted",
      localExecutorState: "scaffolded",
      requestShapeFamilies: ["function_call"],
    }],
  });
  expectThrows(() => validateToolCapabilityRegistry(hostileEnabled), "enabled_without_full_executor");

  const hostileMissingExecutorPath = buildToolCapabilityRegistry({
    rows: [{
      toolId: "hostile.missing_executor_path",
      displayName: "hostile missing executor path",
      odeuFamily: "workspace_process_authority",
      capabilityState: "runtime_probed",
      implementationState: "restricted_executor",
      promotionState: "direct_restricted",
      providerDeclarationState: "declared_live_unproved",
      localExecutorState: "implemented_restricted",
      requestShapeFamilies: ["function_call"],
    }],
  });
  expectThrows(() => validateToolCapabilityRegistry(hostileMissingExecutorPath), "missing_executor_path");

  const hostileUnsupported = buildToolCapabilityRegistry({
    rows: [{
      toolId: "hostile.unsupported_declared",
      displayName: "hostile unsupported",
      odeuFamily: "local_perception",
      capabilityState: "provider_accepted",
      implementationState: "none",
      promotionState: "unsupported",
      providerDeclarationState: "declared_live_accepted",
      localExecutorState: "none",
      requestShapeFamilies: ["function_call"],
      unsupportedReason: "test",
    }],
  });
  expectThrows(() => validateToolCapabilityRegistry(hostileUnsupported), "unsupported_provider_declared");

  const rawSerialized = JSON.stringify({ registry, status, settingsProjection });
  assert(!rawSerialized.includes("rawTextIncluded\":true"), "raw text flag must stay false");
  assert(!rawSerialized.includes("rawSecretIncluded\":true"), "raw secret flag must stay false");
  assert(!rawSerialized.includes("toolEnabledInThisPr\":true"), "tool enabled flag must stay false");

  console.log(JSON.stringify({
    ok: true,
    registryId: registry.registryId,
    rowCount: registry.rowCount,
    projectionDigest: status.projectionDigest,
    settingsProjectionDigest: settingsProjection.projectionDigest,
  }, null, 2));
}

main();
