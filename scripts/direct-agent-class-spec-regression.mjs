#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  DIRECT_AGENT_CLASS_REGISTRY_SCHEMA,
  DIRECT_AGENT_CLASS_SPEC_SCHEMA,
  DIRECT_AGENT_CLASS_STATUS_PROJECTION_SCHEMA,
  buildAgentClassRegistry,
  buildAgentClassSpec,
  buildAgentClassStatusProjection,
  defaultAgentClassInputs,
  validateAgentClassRegistry,
} = require("../src/main/direct/bridge/agent-class-spec");
const {
  buildDirectSettingsSurfaceProjection,
} = require("../src/main/direct/ui/settings-surface");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  const defaults = defaultAgentClassInputs();
  const expectedKinds = [
    "audit_worker",
    "closeout_worker",
    "fix_worker",
    "governance_broker",
    "implementation_worker",
    "memory_compaction_worker",
    "meta_orchestrator",
    "primary_agent",
    "sub_agent_worker",
    "work_thread_broker",
  ];
  const registry = buildAgentClassRegistry({
    projectId: "project_agent_class_fixture",
    workThreadId: "work_thread_agent_class_fixture",
    nowMs: 0,
  });
  assert(registry.schema === DIRECT_AGENT_CLASS_REGISTRY_SCHEMA, "registry schema mismatch");
  assert(registry.specCount === expectedKinds.length, "default registry should contain all expected agent classes");
  assert(registry.createdAt === "1970-01-01T00:00:00.000Z", "epoch-zero timestamp should be preserved");
  assert(defaults.length === expectedKinds.length, "default input count should match expected role count");
  assert(registry.specs.every((spec) => spec.schema === DIRECT_AGENT_CLASS_SPEC_SCHEMA), "all specs should have schema");
  assert(JSON.stringify(registry.specs.map((spec) => spec.agentClassKind)) === JSON.stringify(expectedKinds), "agent classes should be sorted and complete");
  validateAgentClassRegistry(registry);

  const implementationWorker = registry.specs.find((spec) => spec.agentClassKind === "implementation_worker");
  const auditWorker = registry.specs.find((spec) => spec.agentClassKind === "audit_worker");
  const metaOrchestrator = registry.specs.find((spec) => spec.agentClassKind === "meta_orchestrator");
  const broker = registry.specs.find((spec) => spec.agentClassKind === "work_thread_broker");
  const memoryWorker = registry.specs.find((spec) => spec.agentClassKind === "memory_compaction_worker");
  const subAgent = registry.specs.find((spec) => spec.agentClassKind === "sub_agent_worker");
  assert(implementationWorker.forbiddenConflations.includes("worker_self_audits_completion"), "implementation worker must not self-audit");
  assert(auditWorker.authorityContract.mayJudgeObjectValidity === true, "audit worker should own object-level judgment");
  assert(auditWorker.authorityContract.mayExecuteWorkspaceMutation === false, "audit worker must not mutate object artifact");
  assert(metaOrchestrator.forbiddenConflations.includes("meta_orchestrator_performs_object_audit"), "meta-orchestrator must not perform object audit");
  assert(broker.authorityContract.mayResolveWorkTarget === true, "work-thread broker should resolve target");
  assert(broker.forbiddenConflations.includes("broker_executes_worker_task"), "broker must not execute worker task");
  assert(memoryWorker.forbiddenConflations.includes("baton_becomes_replay_authority"), "baton must not become replay authority");
  assert(subAgent.forbiddenConflations.includes("sub_agent_reply_becomes_primary_final"), "sub-agent output must not flatten into primary final answer");

  const hostileSpec = buildAgentClassSpec({
    agentClassKind: "audit_worker",
    displayName: "Hostile audit worker",
    executionEnabledInThisPr: true,
    routingEnabledInThisPr: true,
    providerCallEnabledInThisPr: true,
    workspaceMutationEnabledInThisPr: true,
    objectAuditAutomationEnabledInThisPr: true,
    subAgentSpawnEnabledInThisPr: true,
    memoryMutationEnabledInThisPr: true,
    providerCompactionEnabledInThisPr: true,
  });
  assert(hostileSpec.authorityContract.authorityInflationAttempted === true, "hostile spec should retain blocked authority witness");
  for (const flag of [
    "executionEnabledInThisPr",
    "routingEnabledInThisPr",
    "providerCallEnabledInThisPr",
    "workspaceMutationEnabledInThisPr",
    "objectAuditAutomationEnabledInThisPr",
    "subAgentSpawnEnabledInThisPr",
    "memoryMutationEnabledInThisPr",
    "providerCompactionEnabledInThisPr",
  ]) {
    assert(hostileSpec.authorityContract[flag] === false, `${flag} must remain disabled`);
  }

  const status = buildAgentClassStatusProjection({ registry });
  assert(status.schema === DIRECT_AGENT_CLASS_STATUS_PROJECTION_SCHEMA, "status projection schema mismatch");
  assert(status.specCount === expectedKinds.length, "status should expose spec count");
  assert(status.actionable === false, "status must be display-only");
  assert(status.executionEnabledInThisPr === false, "status must not enable execution");
  assert(status.routingEnabledInThisPr === false, "status must not enable routing");
  assert(status.objectAuditAutomationEnabledInThisPr === false, "status must not enable automated audit");

  const settingsProjection = buildDirectSettingsSurfaceProjection({
    projectId: registry.projectId,
    agentClassStatus: status,
  });
  assert(settingsProjection.sections.agentClasses.specCount === expectedKinds.length, "settings surface should include agent class count");
  assert(settingsProjection.sections.agentClasses.executionEnabledInThisPr === false, "settings surface must not enable agent execution");
  assert(settingsProjection.sections.agentClasses.objectAuditAutomationEnabledInThisPr === false, "settings surface must not enable audit automation");
  assert(Array.isArray(settingsProjection.rows.agentClasses) && settingsProjection.rows.agentClasses.length >= 4, "settings surface should render agent class rows");

  const rawSerialized = JSON.stringify({ registry, status, settingsProjection });
  assert(!rawSerialized.includes("rawTextIncluded\":true"), "raw text flag must stay false");
  assert(!rawSerialized.includes("rawSecretIncluded\":true"), "raw secret flag must stay false");

  console.log(JSON.stringify({
    ok: true,
    registryId: registry.registryId,
    specCount: registry.specCount,
    projectionDigest: status.projectionDigest,
    settingsProjectionDigest: settingsProjection.projectionDigest,
  }, null, 2));
}

main();
