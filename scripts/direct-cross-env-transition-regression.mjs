#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  activeWorldmodelFixture,
  buildActionClassRegistryEntry,
  buildAuthorizationDecision,
  buildAuthorizationRequest,
  buildCrossEnvironmentAuthorizationRouteEnvelope,
  buildDirectEnvironmentTopology,
  buildEnvironmentAwareToolCatalog,
  buildEnvironmentTransitionLifecycleRow,
  buildEnvironmentTransitionWitness,
  buildTurnExecutionEnvironment,
  buildWorldmodelManagerProfile,
  validateCrossEnvironmentAuthorizationRouteEnvelope,
  validateEnvironmentTransitionLifecycleRow,
  validateEnvironmentTransitionWitness,
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

const now = () => Date.UTC(2026, 6, 4, 16, 10, 0);

const topology = buildDirectEnvironmentTopology({
  topologyId: "cross_env_transition_topology",
  projectId: "project_cross_env_transition",
  defaultEnvironmentId: "env_wsl_transition",
  revision: 7,
  environments: [
    {
      environmentId: "env_wsl_transition",
      environmentKind: "wsl",
      displayLabel: "WSL implementer",
      defaultShell: "bash",
      workspaceEvidenceKey: "workspace:wsl:transition",
      availableToolFamilyRefs: [{
        kind: "tool_family",
        id: "local_perception",
        digest: "sha256:local_perception",
        label: "Local perception",
      }],
    },
    {
      environmentId: "env_windows_browser_transition",
      environmentKind: "windows",
      displayLabel: "Windows browser specialist",
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
    mappingId: "mapping_wsl_windows_transition",
    fromEnvironmentId: "env_wsl_transition",
    toEnvironmentId: "env_windows_browser_transition",
    fromRootEvidenceKey: "root:wsl:transition",
    toRootEvidenceKey: "root:windows:transition",
    direction: "two_way",
    mappingKind: "wsl_windows_path",
    readAllowed: true,
    writeAllowed: false,
  }],
  constraints: [{
    constraintId: "constraint_windows_browser_no_workspace_mutation_transition",
    environmentId: "env_windows_browser_transition",
    constraintKind: "no_workspace_mutation",
    rationale: "Browser specialist can observe UI but must not mutate workspace files.",
  }],
}, { now });

const turnEnvironment = buildTurnExecutionEnvironment({
  topology,
  turnId: "turn_cross_env_transition",
  threadId: "direct_session_cross_env_transition",
  workThreadId: "work_thread_cross_env_transition",
  residentEnvironmentId: "env_wsl_transition",
  selectionKind: "thread_default",
  reason: "default_work",
});

const registry = buildToolCapabilityRegistry({
  registryId: "registry_cross_env_transition",
  projectId: "project_cross_env_transition",
  workThreadId: "work_thread_cross_env_transition",
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
      ownerEnvironmentId: "env_windows_browser_transition",
      environmentRouteClass: "cross_environment_tool_session",
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
    ownerEnvironmentId: "env_windows_browser_transition",
    environmentRouteClass: "cross_environment_tool_session",
    environmentActionClass: "windows_browser_action",
  }],
}, { now });

const routeRow = catalog.routeRows[0];
assert.equal(routeRow.routeClass, "cross_environment_tool_session");
assert.equal(routeRow.actionClass, "windows_browser_action");
assert.equal(routeRow.workspaceMutationAuthorized, false);

const worldmodel = activeWorldmodelFixture("work_thread", {
  revision: 3,
  subjectAgentId: "agent_worker_cross_env_transition",
});
const managerProfile = buildWorldmodelManagerProfile({
  scopeKind: "work_thread",
  userProfileId: "user_profile_cross_env_transition",
  projectId: "project_cross_env_transition",
  workThreadId: "work_thread_cross_env_transition",
  managerAgentId: "agent_worldmodel_manager_cross_env_transition",
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
  requestId: "authorization_request_cross_env_transition",
  workerAgentId: "agent_worker_cross_env_transition",
  agentRunId: "agent_run_cross_env_transition",
  workThreadId: "work_thread_cross_env_transition",
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
      label: "Browser verification tool route",
    }],
    scope: "single_tool_session",
    reversibility: "reversible",
    riskLevel: "low",
  },
  workerClaim: {
    whyNeeded: "Need to verify UI behavior through the Windows browser environment.",
    expectedBenefit: "Avoids guessing from WSL-only evidence.",
    knownRisks: ["Cross-environment observation can be mistaken for workspace authority."],
    alternativesConsidered: ["Ask the user to verify manually."],
  },
  evidenceRefs: [{
    kind: "tool_route_ref",
    id: routeRow.rowId,
    digest: routeRow.rowDigest,
    label: "Browser verification tool route",
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
  envelopeId: "cross_env_route_envelope_fixture",
  topology,
  turnEnvironment,
  routeRow,
  authorizationRequest,
  authorizationDecision,
  transitionKind: "tool_session",
}, { now });
validateCrossEnvironmentAuthorizationRouteEnvelope(envelope);
assert.equal(envelope.routeStatus, "route_ready_for_authorization");
assert.equal(envelope.workspaceMutationAuthorized, false);
assert.equal(envelope.providerTransportStarted, false);
assert.equal(envelope.toolSessionStarted, false);
assert.equal(envelope.liveEnvironmentSwitched, false);

const witness = buildEnvironmentTransitionWitness({
  witnessId: "environment_transition_witness_fixture",
  envelope,
  transitionKind: "tool_session",
  lifecycleState: "requested",
}, { now });
validateEnvironmentTransitionWitness(witness);
assert.equal(witness.scope, "single_tool_session");
assert.equal(witness.workspaceMutationPerformed, false);
assert.equal(witness.evidenceReturnContract, "return_bounded_evidence_only");

const requestedRow = buildEnvironmentTransitionLifecycleRow({
  rowId: "environment_transition_lifecycle_requested",
  sequence: 1,
  witness,
  lifecycleEvent: "requested",
  resultSummary: "Cross-env browser tool session requested but not started.",
}, { now });
validateEnvironmentTransitionLifecycleRow(requestedRow);
assert.equal(requestedRow.lifecycleEvent, "requested");
assert.equal(requestedRow.workspaceMutationPerformed, false);

const remandedEnvelope = buildCrossEnvironmentAuthorizationRouteEnvelope({
  topology,
  turnEnvironment,
  routeRow: {
    ...routeRow,
    routeClass: "unsupported_environment",
    routeMayProceed: false,
    blockerCodes: ["environment_route_unavailable"],
  },
  routeStatus: "route_ready_for_authorization",
}, { now });
validateCrossEnvironmentAuthorizationRouteEnvelope(remandedEnvelope);
assert.equal(remandedEnvelope.routeStatus, "unsupported_route");

const mismatchedGrantEnvelope = buildCrossEnvironmentAuthorizationRouteEnvelope({
  topology,
  turnEnvironment,
  routeRow: {
    ...routeRow,
    actionClass: "different_browser_action",
  },
  authorizationRequest,
  authorizationDecision,
}, { now });
validateCrossEnvironmentAuthorizationRouteEnvelope(mismatchedGrantEnvelope);
assert.equal(mismatchedGrantEnvelope.routeStatus, "authorization_remanded");

expectThrows(() => validateCrossEnvironmentAuthorizationRouteEnvelope({
  ...envelope,
  workspaceMutationAuthorized: true,
}), "direct_environment_transition_authority_leak");

expectThrows(() => validateEnvironmentTransitionWitness({
  ...witness,
  workspaceMutationPerformed: true,
}), "direct_environment_transition_authority_leak");

expectThrows(() => validateEnvironmentTransitionLifecycleRow({
  ...requestedRow,
  toolSessionStarted: true,
}), "direct_environment_transition_authority_leak");

expectThrows(() => validateCrossEnvironmentAuthorizationRouteEnvelope(undefined), "direct_environment_transition_invalid_object");
expectThrows(() => validateEnvironmentTransitionWitness(undefined), "direct_environment_transition_invalid_object");
expectThrows(() => validateEnvironmentTransitionLifecycleRow(undefined), "direct_environment_transition_invalid_object");

console.log(JSON.stringify({
  ok: true,
  envelopeSchema: envelope.schema,
  witnessSchema: witness.schema,
  lifecycleEvent: requestedRow.lifecycleEvent,
  routeStatus: envelope.routeStatus,
}, null, 2));
