#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  activeWorldmodelFixture,
  buildAuthorizationContinuationEnvelope,
  buildAuthorizationDecision,
  buildAuthorizationDecisionLedgerRow,
  buildAuthorizationRequest,
  buildPolicyResolutionTrace,
  buildSeedActionClassRegistry,
  buildWorldmodelManagerProfile,
  validateActionClassRegistryEntry,
  validateAuthorizationContinuationEnvelope,
  validateAuthorizationDecision,
  validateAuthorizationDecisionLedgerRow,
  validateAuthorizationRequest,
  validatePolicyResolutionTrace,
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

const now = () => Date.UTC(2026, 6, 3, 14, 10, 0);

const managerProfile = buildWorldmodelManagerProfile({
  scopeKind: "work_thread",
  userProfileId: "user_profile_fixture",
  projectId: "project_fixture",
  workThreadId: "work_thread_authorization_fixture",
  managerAgentId: "agent_worldmodel_manager_authorization_fixture",
}, { now });

const worldmodel = activeWorldmodelFixture("work_thread", {
  revision: 4,
  subjectAgentId: "agent_worker_authorization_fixture",
});

const registry = buildSeedActionClassRegistry({ now });
assert(registry.length >= 6);
registry.forEach(validateActionClassRegistryEntry);

const readRequest = buildAuthorizationRequest({
  requestId: "authorization_request_read_fixture",
  workerAgentId: "agent_worker_authorization_fixture",
  agentRunId: "agent_run_read_fixture",
  workThreadId: "work_thread_authorization_fixture",
  worldmodel,
  requestedAction: {
    actionClass: "read_context",
    targetKind: "context_pack",
    targetRefs: [{
      kind: "context_pack",
      id: "context_pack_read_fixture",
      digest: "sha256:context_pack_read_fixture",
      label: "Readonly context pack",
    }],
    scope: "work_thread",
    reversibility: "reversible",
    riskLevel: "low",
  },
  workerClaim: {
    whyNeeded: "Need to inspect scoped context before answering.",
    expectedBenefit: "Avoids guessing.",
    knownRisks: [],
    alternativesConsidered: ["Ask manager for summary"],
  },
}, { now });
validateAuthorizationRequest(readRequest);

const readTrace = buildPolicyResolutionTrace({ request: readRequest, registry }, { now });
validatePolicyResolutionTrace(readTrace);
assert.equal(readTrace.dominantPosture, "allow");
assert.equal(readTrace.evidenceSatisfied, true);

const readDecision = buildAuthorizationDecision({
  request: readRequest,
  managerProfile,
  currentWorldmodel: worldmodel,
  registry,
}, { now });
validateAuthorizationDecision(readDecision);
assert.equal(readDecision.decision, "grant");
assert.equal(readDecision.revisionCompatibility.compatibility, "same");
assert.equal(readDecision.rawUserTextExposedToWorker, false);

const readContinuation = buildAuthorizationContinuationEnvelope({ decision: readDecision }, { now });
validateAuthorizationContinuationEnvelope(readContinuation);
assert.equal(readContinuation.status, "authorized");
assert.equal(readContinuation.workerContinuationKind, "continue_with_scoped_authority");

const readLedgerRow = buildAuthorizationDecisionLedgerRow({
  request: readRequest,
  policyResolutionTrace: readTrace,
  decision: readDecision,
  continuation: readContinuation,
}, { now });
validateAuthorizationDecisionLedgerRow(readLedgerRow);
assert.equal(readLedgerRow.rowKind, "authorization_decision_recorded");
assert.equal(readLedgerRow.decision, "grant");

const broadRefactorRequest = buildAuthorizationRequest({
  requestId: "authorization_request_broad_refactor_fixture",
  workerAgentId: "agent_worker_authorization_fixture",
  agentRunId: "agent_run_broad_refactor_fixture",
  workThreadId: "work_thread_authorization_fixture",
  worldmodel,
  requestedAction: {
    actionClass: "broad_refactor",
    targetKind: "workspace",
    targetRefs: [{
      kind: "workspace",
      id: "workspace_fixture",
      digest: "sha256:workspace_fixture",
      label: "Workspace",
    }],
    scope: "project",
    reversibility: "partly_reversible",
    riskLevel: "high",
  },
  evidenceRefs: [{
    kind: "architecture_need",
    id: "architecture_need",
    digest: "sha256:architecture_need",
    label: "Architecture need",
  }, {
    kind: "blast_radius_summary",
    id: "blast_radius_summary",
    digest: "sha256:blast_radius_summary",
    label: "Blast radius summary",
  }],
  workerClaim: {
    whyNeeded: "The current patch crosses module boundaries.",
    expectedBenefit: "Avoids brittle local fix.",
    knownRisks: ["Large change surface"],
    alternativesConsidered: ["Small patch"],
  },
  proposedMode: "explicit_user_confirmation",
}, { now });
validateAuthorizationRequest(broadRefactorRequest);
const broadTrace = buildPolicyResolutionTrace({ request: broadRefactorRequest, registry }, { now });
validatePolicyResolutionTrace(broadTrace);
assert.equal(broadTrace.dominantPosture, "explicit_user_confirmation_required");
assert.equal(broadTrace.evidenceSatisfied, true);
const broadDecision = buildAuthorizationDecision({
  request: broadRefactorRequest,
  managerProfile,
  currentWorldmodel: worldmodel,
  registry,
}, { now });
validateAuthorizationDecision(broadDecision);
assert.equal(broadDecision.decision, "escalate_user_confirmation");
const broadContinuation = buildAuthorizationContinuationEnvelope({ decision: broadDecision }, { now });
validateAuthorizationContinuationEnvelope(broadContinuation);
assert.equal(broadContinuation.status, "escalated");
assert.equal(broadContinuation.workerContinuationKind, "wait_for_external_authority");

const deleteRequest = buildAuthorizationRequest({
  requestId: "authorization_request_delete_fixture",
  workerAgentId: "agent_worker_authorization_fixture",
  agentRunId: "agent_run_delete_fixture",
  workThreadId: "work_thread_authorization_fixture",
  worldmodel,
  requestedAction: {
    actionClass: "destructive_delete",
    targetKind: "workspace_file",
    targetRefs: [{
      kind: "workspace_file",
      id: "src/delete-me.js",
      digest: "sha256:delete_target",
      label: "delete target",
    }],
    scope: "workspace",
    reversibility: "irreversible",
    riskLevel: "critical",
  },
  evidenceRefs: [{
    kind: "target_inventory",
    id: "target_inventory",
    digest: "sha256:target_inventory",
    label: "Target inventory",
  }],
  proposedMode: "admin_mode",
}, { now });
validateAuthorizationRequest(deleteRequest);
const deleteTrace = buildPolicyResolutionTrace({ request: deleteRequest, registry }, { now });
validatePolicyResolutionTrace(deleteTrace);
assert.equal(deleteTrace.dominantPosture, "admin_mode_required");
assert.equal(deleteTrace.evidenceSatisfied, false);
assert(deleteTrace.missingEvidence.some((item) => item.requirementId === "explicit_admin_intent"));
const deleteDecision = buildAuthorizationDecision({
  request: deleteRequest,
  managerProfile,
  currentWorldmodel: worldmodel,
  registry,
}, { now });
validateAuthorizationDecision(deleteDecision);
assert.equal(deleteDecision.decision, "remand");
assert(deleteDecision.rationale.includes("admin_mode_required"));

const adminDeleteRequest = buildAuthorizationRequest({
  ...deleteRequest,
  requestId: "authorization_request_admin_delete_fixture",
  evidenceRefs: [...deleteRequest.evidenceRefs, {
    kind: "explicit_admin_intent",
    id: "explicit_admin_intent",
    digest: "sha256:explicit_admin_intent",
    label: "Explicit admin intent",
  }],
}, { now });
const adminDeleteDecision = buildAuthorizationDecision({
  request: adminDeleteRequest,
  managerProfile,
  currentWorldmodel: worldmodel,
  registry,
}, { now });
validateAuthorizationDecision(adminDeleteDecision);
assert.equal(adminDeleteDecision.decision, "escalate_admin_mode");

const staleRequest = buildAuthorizationRequest({
  requestId: "authorization_request_stale_fixture",
  workerAgentId: "agent_worker_authorization_fixture",
  agentRunId: "agent_run_stale_fixture",
  workThreadId: "work_thread_authorization_fixture",
  worldmodelId: worldmodel.worldmodelId,
  worldmodelRevision: worldmodel.revision - 1,
  requestedAction: {
    actionClass: "apply_patch",
    targetKind: "workspace_file",
    targetRefs: [{
      kind: "workspace_file",
      id: "src/example.js",
      digest: "sha256:example",
      label: "Example file",
    }],
    scope: "work_thread",
    reversibility: "partly_reversible",
    riskLevel: "medium",
  },
}, { now });
const staleDecision = buildAuthorizationDecision({
  request: staleRequest,
  managerProfile,
  currentWorldmodel: worldmodel,
  registry,
}, { now });
validateAuthorizationDecision(staleDecision);
assert.equal(staleDecision.decision, "remand");
assert.equal(staleDecision.revisionCompatibility.compatibility, "stale");

const unknownRequest = buildAuthorizationRequest({
  requestId: "authorization_request_unknown_fixture",
  workerAgentId: "agent_worker_authorization_fixture",
  agentRunId: "agent_run_unknown_fixture",
  workThreadId: "work_thread_authorization_fixture",
  worldmodel,
  requestedAction: {
    actionClass: "unregistered_power_tool",
    targetKind: "unknown",
    scope: "global",
    reversibility: "unknown",
    riskLevel: "critical",
  },
}, { now });
const unknownDecision = buildAuthorizationDecision({
  request: unknownRequest,
  managerProfile,
  currentWorldmodel: worldmodel,
  registry,
}, { now });
validateAuthorizationDecision(unknownDecision);
assert.equal(unknownDecision.decision, "remand");

const rawTargetRefRequest = buildAuthorizationRequest({
  requestId: "authorization_request_raw_ref_fixture",
  workerAgentId: "agent_worker_authorization_fixture",
  agentRunId: "agent_run_raw_ref_fixture",
  workThreadId: "work_thread_authorization_fixture",
  worldmodel,
  requestedAction: {
    actionClass: "read_context",
    targetKind: "context_pack",
    targetRefs: [{
      kind: "context_pack",
      id: "raw_context_pack",
      digest: "sha256:raw_context_pack",
    }],
    scope: "work_thread",
    reversibility: "reversible",
    riskLevel: "low",
  },
}, { now });
rawTargetRefRequest.requestedAction.targetRefs[0].rawTextIncluded = true;
expectThrows(() => validateAuthorizationRequest(rawTargetRefRequest), "direct_authorization_router_raw_ref_exposure");

console.log("direct authorization router regression passed");
