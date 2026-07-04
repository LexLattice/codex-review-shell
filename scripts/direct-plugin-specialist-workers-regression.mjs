#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  activeWorldmodelFixture,
  buildActionClassRegistryEntry,
  buildAuthorizationDecision,
  buildAuthorizationRequest,
  buildBrowserVerificationWorkerScaffold,
  buildCrossEnvironmentAuthorizationRouteEnvelope,
  buildDirectEnvironmentTopology,
  buildEnvironmentAwareToolCatalog,
  buildEnvironmentTransitionWitness,
  buildPluginSpecialistDelegationPacket,
  buildPluginSpecialistWorkerContract,
  buildTurnExecutionEnvironment,
  buildWorldmodelManagerProfile,
  validateBrowserVerificationWorkerScaffold,
  validatePluginSpecialistDelegationPacket,
  validatePluginSpecialistWorkerContract,
} = require("../src/main/direct/worldmodel");
const {
  buildToolCapabilityRegistry,
} = require("../src/main/direct/bridge/tool-capability-registry");

function expectThrows(fn, expectedCode) {
  try {
    fn();
  } catch (error) {
    assert.equal(error.code, expectedCode, `expected ${expectedCode}, got ${error.code || error.message}`);
    return error;
  }
  throw new Error(`expected throw: ${expectedCode}`);
}

const now = () => Date.UTC(2026, 6, 4, 17, 20, 0);

const topology = buildDirectEnvironmentTopology({
  topologyId: "plugin_specialist_topology",
  projectId: "project_plugin_specialist",
  defaultEnvironmentId: "env_wsl_plugin_specialist",
  revision: 8,
  environments: [
    {
      environmentId: "env_wsl_plugin_specialist",
      environmentKind: "wsl",
      displayLabel: "WSL implementer",
      defaultShell: "bash",
      workspaceEvidenceKey: "workspace:wsl:plugin_specialist",
      availableToolFamilyRefs: [{
        kind: "tool_family",
        id: "local_workspace",
        digest: "sha256:local_workspace",
        label: "Local workspace",
      }],
    },
    {
      environmentId: "env_windows_browser_specialist",
      environmentKind: "windows",
      displayLabel: "Windows browser verifier",
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
    mappingId: "mapping_wsl_windows_plugin_specialist",
    fromEnvironmentId: "env_wsl_plugin_specialist",
    toEnvironmentId: "env_windows_browser_specialist",
    fromRootEvidenceKey: "root:wsl:plugin_specialist",
    toRootEvidenceKey: "root:windows:plugin_specialist",
    direction: "two_way",
    mappingKind: "wsl_windows_path",
    readAllowed: true,
    writeAllowed: false,
  }],
  constraints: [{
    constraintId: "constraint_browser_specialist_no_workspace_mutation",
    environmentId: "env_windows_browser_specialist",
    constraintKind: "no_workspace_mutation",
    rationale: "Browser verifier returns evidence only.",
  }],
}, { now });

const turnEnvironment = buildTurnExecutionEnvironment({
  topology,
  turnId: "turn_plugin_specialist",
  threadId: "direct_session_plugin_specialist",
  workThreadId: "work_thread_plugin_specialist",
  residentEnvironmentId: "env_wsl_plugin_specialist",
  selectionKind: "thread_default",
  reason: "default_wsl_work_with_windows_browser_specialist",
});

const registry = buildToolCapabilityRegistry({
  registryId: "registry_plugin_specialist",
  projectId: "project_plugin_specialist",
  workThreadId: "work_thread_plugin_specialist",
  rows: [
    {
      toolId: "direct.browser.verify",
      displayName: "browser_verify",
      directNames: ["browser_verify"],
      odeuFamily: "external_capability_discovery",
      capabilityState: "runtime_probed",
      implementationState: "projection_only",
      promotionState: "diagnostic_only",
      providerDeclarationState: "not_declared",
      localExecutorState: "scaffolded",
      requestShapeFamilies: ["browser_verification_task"],
      localExecutor: "src/main/direct/external/browser-specialist.js",
      ownerEnvironmentId: "env_windows_browser_specialist",
      environmentRouteClass: "specialist_worker_required",
      environmentActionClass: "windows_browser_action",
    },
  ],
});

const catalog = buildEnvironmentAwareToolCatalog({
  capabilityRegistry: registry,
  topology,
  turnEnvironment,
  rows: [{
    toolId: "direct.browser.verify",
    ownerEnvironmentId: "env_windows_browser_specialist",
    environmentRouteClass: "specialist_worker_required",
    environmentActionClass: "windows_browser_action",
  }],
}, { now });

const routeRow = catalog.routeRows[0];
assert.equal(routeRow.routeClass, "specialist_worker_required");
assert.equal(routeRow.routeStatus, "manager_route_required");
assert.equal(routeRow.workspaceMutationAuthorized, false);

const worldmodel = activeWorldmodelFixture("work_thread", {
  revision: 4,
  subjectAgentId: "agent_main_worker_plugin_specialist",
});
const managerProfile = buildWorldmodelManagerProfile({
  scopeKind: "work_thread",
  userProfileId: "user_profile_plugin_specialist",
  projectId: "project_plugin_specialist",
  workThreadId: "work_thread_plugin_specialist",
  managerAgentId: "agent_worldmodel_manager_plugin_specialist",
}, { now });
const actionEntry = buildActionClassRegistryEntry({
  actionClass: "windows_browser_action",
  roleLane: "implementation_worker",
  targetKind: "external_browser",
  defaultPosture: "manager_discretion",
  riskCeiling: "medium",
  reversibility: "reversible",
  dangerousAction: false,
  managerCanDecide: true,
  userConfirmationAllowed: true,
  adminModeRequired: false,
  evidenceRequirements: ["tool_route_ref"],
}, { now });
const authorizationRequest = buildAuthorizationRequest({
  requestId: "authorization_request_plugin_specialist",
  workerAgentId: "agent_main_worker_plugin_specialist",
  agentRunId: "agent_run_plugin_specialist",
  workThreadId: "work_thread_plugin_specialist",
  worldmodel,
  requestedAction: {
    actionClass: "windows_browser_action",
    toolName: "browser_verify",
    roleLane: "implementation_worker",
    targetKind: "external_browser",
    targetRefs: [{
      kind: "tool_route_ref",
      id: routeRow.rowId,
      digest: routeRow.rowDigest,
      label: "Browser specialist tool route",
    }],
    scope: "single_specialist_worker_contract",
    reversibility: "reversible",
    riskLevel: "low",
  },
  workerClaim: {
    whyNeeded: "Need a Windows browser specialist to verify UI behavior without switching the WSL implementer.",
    expectedBenefit: "Keeps browser plugin attention bounded to a verifier role.",
    knownRisks: ["Browser observations are evidence, not workspace authority."],
    alternativesConsidered: ["Ask the operator to verify manually."],
  },
  evidenceRefs: [{
    kind: "tool_route_ref",
    id: routeRow.rowId,
    digest: routeRow.rowDigest,
    label: "Browser specialist tool route",
  }],
}, { now });
const authorizationDecision = buildAuthorizationDecision({
  request: authorizationRequest,
  registryEntry: actionEntry,
  managerProfile,
  currentWorldmodel: worldmodel,
}, { now });
assert.equal(authorizationDecision.decision, "grant");

const envelope = buildCrossEnvironmentAuthorizationRouteEnvelope({
  envelopeId: "plugin_specialist_route_envelope",
  topology,
  turnEnvironment,
  routeRow,
  authorizationRequest,
  authorizationDecision,
  transitionKind: "specialist_worker_delegation",
}, { now });
assert.equal(envelope.routeStatus, "route_ready_for_authorization");
assert.equal(envelope.transitionKind, "specialist_worker_delegation");

const transitionWitness = buildEnvironmentTransitionWitness({
  witnessId: "plugin_specialist_transition_witness",
  envelope,
  transitionKind: "specialist_worker_delegation",
  lifecycleState: "requested",
}, { now });
assert.equal(transitionWitness.workspaceMutationPerformed, false);

const scaffold = buildBrowserVerificationWorkerScaffold({
  scaffoldId: "browser_verification_scaffold_fixture",
  targetEnvironmentId: routeRow.ownerEnvironmentId,
  allowedTools: ["browser.console", "browser.inspect", "browser.screenshot"],
}, { now });
validateBrowserVerificationWorkerScaffold(scaffold);
assert.equal(scaffold.targetAgentClass, "browser_verification_worker");
assert.equal(scaffold.pluginControlEnabledInThisPr, false);

const contract = buildPluginSpecialistWorkerContract({
  contractId: "plugin_specialist_contract_fixture",
  sourceAgentId: "agent_main_worker_plugin_specialist",
  routeRow,
  authorizationRouteEnvelope: envelope,
  objective: "Verify the rendered app state in Windows Chrome and return bounded evidence only.",
  inputEvidenceRefs: [{
    kind: "turn_execution_environment",
    id: turnEnvironment.turnId,
    digest: turnEnvironment.turnEnvironmentDigest,
    label: "WSL resident turn environment",
  }],
}, { now });
validatePluginSpecialistWorkerContract(contract);
assert.equal(contract.status, "ready_for_specialist_delegation");
assert.equal(contract.managerAuthorizationSatisfied, true);
assert.equal(contract.delegationMayProceedAsEvidence, true);
assert.equal(contract.workerRuntimeEnabledInThisPr, false);
assert.equal(contract.pluginControlEnabledInThisPr, false);
assert.equal(contract.workspaceMutationAllowed, false);
assert(contract.forbiddenActions.includes("unbounded_browser_automation"));

const packet = buildPluginSpecialistDelegationPacket({
  packetId: "plugin_specialist_delegation_packet_fixture",
  parentTurnId: turnEnvironment.turnId,
  workThreadId: "work_thread_plugin_specialist",
  contract,
  scaffold,
  transitionWitness,
}, { now });
validatePluginSpecialistDelegationPacket(packet);
assert.equal(packet.status, "ready_for_worker_start_transition");
assert.equal(packet.workerStartTransitionRequired, true);
assert.equal(packet.workerRuntimeEnabledInThisPr, false);
assert.equal(packet.specialistProviderCallAllowed, false);
assert.equal(packet.pluginControlEnabledInThisPr, false);
assert.equal(packet.evidenceReturnOnly, true);
assert.equal(packet.childDialogueFlattenedIntoPrimary, false);

const unsupportedContract = buildPluginSpecialistWorkerContract({
  sourceAgentId: "agent_main_worker_plugin_specialist",
  routeRow: {
    ...routeRow,
    routeClass: "cross_environment_tool_session",
  },
  authorizationRouteEnvelope: envelope,
}, { now });
validatePluginSpecialistWorkerContract(unsupportedContract);
assert.equal(unsupportedContract.status, "unsupported_route");
assert(unsupportedContract.blockerCodes.includes("route_not_specialist_worker"));

expectThrows(() => validatePluginSpecialistWorkerContract({
  ...contract,
  workerRuntimeEnabledInThisPr: true,
}), "direct_plugin_specialist_authority_leak");

expectThrows(() => validatePluginSpecialistDelegationPacket({
  ...packet,
  specialistProviderCallAllowed: true,
}), "direct_plugin_specialist_authority_leak");

expectThrows(() => validateBrowserVerificationWorkerScaffold({
  ...scaffold,
  evidenceReturnContract: {
    ...scaffold.evidenceReturnContract,
    rawPayloadAllowed: true,
  },
}), "direct_plugin_specialist_authority_leak");

console.log(JSON.stringify({
  ok: true,
  contractSchema: contract.schema,
  packetSchema: packet.schema,
  targetAgentClass: contract.targetAgentClass,
  status: packet.status,
}, null, 2));
