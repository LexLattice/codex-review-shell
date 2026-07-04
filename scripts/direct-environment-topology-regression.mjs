#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  activeWorldmodelFixture,
  buildDirectEnvironmentTopology,
  buildEnvironmentExecutionProjection,
  buildTopologyCompatibility,
  buildTurnExecutionEnvironment,
  buildWorkerBootPacket,
  buildWorkThreadDelegationPacket,
  buildWorldmodelManagerProfile,
  buildThreadManagerProfile,
  validateDirectEnvironmentTopology,
  validateEnvironmentPathMapping,
  validateEnvironmentExecutionProjection,
  validateTopologyCompatibility,
  validateTurnExecutionEnvironment,
  validateWorkerBootPacket,
} = require("../src/main/direct/worldmodel");

function expectThrows(fn, expectedCode) {
  try {
    fn();
  } catch (error) {
    assert.equal(error.code, expectedCode, `expected ${expectedCode}, got ${error.code || error.message}`);
    return error;
  }
  throw new Error(`expected throw: ${expectedCode}`);
}

const now = () => Date.UTC(2026, 6, 4, 10, 15, 0);

const topology = buildDirectEnvironmentTopology({
  topologyId: "environment_topology_fixture",
  projectId: "project_env_fixture",
  defaultEnvironmentId: "env_wsl_fixture",
  revision: 4,
  environments: [
    {
      environmentId: "env_wsl_fixture",
      environmentKind: "wsl",
      displayLabel: "WSL workspace",
      workspaceEvidenceKey: "workspace:wsl:odeu",
      defaultShell: "bash",
      availableToolFamilyRefs: [{
        kind: "tool_family",
        id: "workspace_files",
        digest: "sha256:workspace_files",
        label: "Workspace file tools",
      }],
    },
    {
      environmentId: "env_windows_browser_fixture",
      environmentKind: "windows",
      displayLabel: "Windows browser worker",
      defaultShell: "powershell",
      availableToolFamilyRefs: [{
        kind: "tool_family",
        id: "browser_control",
        digest: "sha256:browser_control",
        label: "Browser control",
      }],
    },
  ],
  mappings: [{
    mappingId: "mapping_wsl_windows_fixture",
    fromEnvironmentId: "env_wsl_fixture",
    toEnvironmentId: "env_windows_browser_fixture",
    fromRootEvidenceKey: "root:wsl:odeu",
    toRootEvidenceKey: "root:windows:odeu",
    direction: "two_way",
    mappingKind: "wsl_windows_path",
    readAllowed: true,
    writeAllowed: false,
    evidenceRefs: [{
      kind: "workspace_mapping_probe",
      id: "mapping_probe_fixture",
      digest: "sha256:mapping_probe_fixture",
      label: "Path mapping probe",
    }],
  }],
  constraints: [{
    constraintId: "constraint_windows_browser_no_workspace_mutation",
    environmentId: "env_windows_browser_fixture",
    constraintKind: "no_workspace_mutation",
    rationale: "Browser specialist may observe UI but must not mutate workspace files.",
  }],
}, { now });

validateDirectEnvironmentTopology(topology);
assert.equal(topology.defaultEnvironmentId, "env_wsl_fixture");
assert.equal(topology.environments.length, 2);
assert.equal(topology.mappings[0].writeAllowed, false);
assert.equal(topology.mappings[0].destructiveWriteAllowed, false);

expectThrows(() => validateEnvironmentPathMapping({
  ...topology.mappings[0],
  fromEnvironmentId: "env_wsl_fixture",
  toEnvironmentId: "env_wsl_fixture",
}), "direct_environment_invalid_mapping_endpoints");

expectThrows(() => validateEnvironmentPathMapping({
  ...topology.mappings[0],
  fromRootEvidenceKey: "",
}), "direct_environment_missing_string");

const turnEnvironment = buildTurnExecutionEnvironment({
  topology,
  turnId: "turn_env_fixture",
  threadId: "direct_thread_env_fixture",
  workThreadId: "work_thread_env_fixture",
  residentEnvironmentId: "env_wsl_fixture",
  delegatedSpecialistEnvironmentId: "env_windows_browser_fixture",
  selectionKind: "specialist_worker_delegation",
  reason: "tool_requires_environment",
}, { now });

validateTurnExecutionEnvironment(turnEnvironment);
assert.equal(turnEnvironment.defaultEnvironmentId, "env_wsl_fixture");
assert.equal(turnEnvironment.residentEnvironmentId, "env_wsl_fixture");
assert.equal(turnEnvironment.delegatedSpecialistEnvironmentId, "env_windows_browser_fixture");

const staleCompatibilityAllowed = buildTopologyCompatibility({
  expectedTopologyId: topology.topologyId,
  expectedRevision: 3,
  currentTopology: topology,
  relevantEnvironmentIds: ["env_wsl_fixture"],
  changedEnvironmentIds: ["env_windows_browser_fixture"],
  compatibilityWitnessKind: "changed_fields_irrelevant",
}, { now });
validateTopologyCompatibility(staleCompatibilityAllowed);
assert.equal(staleCompatibilityAllowed.compatibility, "stale");
assert.equal(staleCompatibilityAllowed.routeMayProceed, true);
assert.equal(staleCompatibilityAllowed.requiresRemand, false);

const staleCompatibilityBlocked = buildTopologyCompatibility({
  expectedTopologyId: topology.topologyId,
  expectedRevision: 3,
  currentTopology: topology,
  relevantEnvironmentIds: ["env_windows_browser_fixture"],
  changedEnvironmentIds: ["env_windows_browser_fixture"],
  compatibilityWitnessKind: "changed_fields_irrelevant",
}, { now });
validateTopologyCompatibility(staleCompatibilityBlocked);
assert.equal(staleCompatibilityBlocked.routeMayProceed, false);
assert.equal(staleCompatibilityBlocked.requiresRemand, true);

expectThrows(() => validateTopologyCompatibility({
  ...staleCompatibilityBlocked,
  requiresRemand: false,
}), "direct_environment_invalid_topology_route_state");

const managerProfile = buildWorldmodelManagerProfile({
  scopeKind: "work_thread",
  userProfileId: "user_profile_env_fixture",
  projectId: "project_env_fixture",
  workThreadId: "work_thread_env_fixture",
  managerAgentId: "agent_worldmodel_manager_env_fixture",
}, { now });
const threadManagerProfile = buildThreadManagerProfile({
  managerProfile,
  threadManagerProfileId: "thread_manager_profile_env_fixture",
  threadManagerAgentId: "agent_thread_manager_env_fixture",
  workThreadId: "work_thread_env_fixture",
}, { now });
const worldmodel = activeWorldmodelFixture("work_thread", {
  revision: 2,
  subjectAgentId: "agent_worker_env_fixture",
});
const delegation = buildWorkThreadDelegationPacket({
  managerProfile,
  threadManagerProfile,
  worldmodel,
  targetWorkThreadId: "work_thread_env_fixture",
  objectiveSummary: "Use a WSL worker and delegate browser verification to a Windows specialist.",
  roleLane: "implementation_worker",
}, { now });
const bootPacket = buildWorkerBootPacket({
  bootPacketId: "worker_boot_packet_env_fixture",
  delegationPacket: delegation,
  worldmodel,
  environmentTopology: topology,
  turnExecutionEnvironment: turnEnvironment,
  topologyCompatibility: staleCompatibilityAllowed,
  environmentRouteSummary: "Parent worker remains in WSL; browser verification delegates to Windows specialist.",
}, { now });

validateWorkerBootPacket(bootPacket);
validateEnvironmentExecutionProjection(bootPacket.environmentExecutionProjection);
assert.equal(bootPacket.environmentExecutionProjection.residentEnvironmentRef.id, "env_wsl_fixture");
assert.equal(bootPacket.environmentExecutionProjection.delegatedSpecialistEnvironmentRef.id, "env_windows_browser_fixture");
assert.equal(bootPacket.environmentExecutionProjection.workspaceMutationDefault, "forbidden_cross_env_without_authority");

const remandedBootPacket = buildWorkerBootPacket({
  bootPacketId: "worker_boot_packet_env_remanded_fixture",
  delegationPacket: delegation,
  worldmodel,
  environmentTopology: topology,
  turnExecutionEnvironment: turnEnvironment,
  topologyCompatibility: staleCompatibilityBlocked,
}, { now });
validateWorkerBootPacket(remandedBootPacket);
assert.equal(remandedBootPacket.status, "blocked");
assert(remandedBootPacket.blockerCodes.includes("environment_topology_requires_remand"));

const turnEnvironmentRefOnly = buildTurnExecutionEnvironment({
  topologyRef: {
    kind: "direct_environment_topology",
    id: topology.topologyId,
    digest: topology.topologyDigest,
    label: "Stored topology ref",
  },
  turnId: "turn_env_ref_only_fixture",
  threadId: "direct_thread_env_fixture",
  defaultEnvironmentId: "env_wsl_fixture",
  residentEnvironmentId: "env_wsl_fixture",
}, { now });
validateTurnExecutionEnvironment(turnEnvironmentRefOnly);
const missingTopologyBootPacket = buildWorkerBootPacket({
  bootPacketId: "worker_boot_packet_missing_topology_fixture",
  delegationPacket: delegation,
  worldmodel,
  turnExecutionEnvironment: turnEnvironmentRefOnly,
}, { now });
validateWorkerBootPacket(missingTopologyBootPacket);
assert.equal(missingTopologyBootPacket.status, "blocked");
assert.equal(missingTopologyBootPacket.environmentExecutionProjection, undefined);
assert(missingTopologyBootPacket.blockerCodes.includes("environment_topology_missing"));

const rehydratedProjection = {
  ...bootPacket.environmentExecutionProjection,
  projectionId: "environment_execution_projection_rehydrated_fixture",
  executionProjectionDigest: undefined,
};
const rebuiltProjection = buildEnvironmentExecutionProjection(rehydratedProjection);
validateEnvironmentExecutionProjection(rebuiltProjection);
assert.equal(rebuiltProjection.defaultEnvironmentRef.id, "env_wsl_fixture");
assert.equal(rebuiltProjection.residentEnvironmentRef.id, "env_wsl_fixture");

const toolScopedTurn = buildTurnExecutionEnvironment({
  topology,
  turnId: "turn_tool_env_fixture",
  threadId: "direct_thread_env_fixture",
  selectedToolEnvironmentId: "env_windows_browser_fixture",
  selectionKind: "tool_scoped_transition",
  reason: "tool_requires_environment",
}, { now });
validateTurnExecutionEnvironment(toolScopedTurn);
assert.equal(toolScopedTurn.selectedToolEnvironmentId, "env_windows_browser_fixture");

expectThrows(() => validateDirectEnvironmentTopology({
  ...topology,
  mappings: [{
    ...topology.mappings[0],
    destructiveWriteAllowed: true,
  }],
}), "direct_environment_destructive_mapping_write");

expectThrows(() => validateTurnExecutionEnvironment(buildTurnExecutionEnvironment({
  topology,
  turnId: "turn_invalid_tool_env_fixture",
  threadId: "direct_thread_env_fixture",
  selectionKind: "tool_scoped_transition",
})), "direct_environment_missing_string");

expectThrows(() => validateDirectEnvironmentTopology({
  ...topology,
  defaultEnvironmentId: "missing_env",
}), "direct_environment_default_missing");

const tamperedProjection = {
  ...bootPacket.environmentExecutionProjection,
  workspaceMutationDefault: "allowed",
};
expectThrows(() => validateEnvironmentExecutionProjection(tamperedProjection), "direct_environment_invalid_workspace_mutation_default");

console.log("direct environment topology regression passed");
