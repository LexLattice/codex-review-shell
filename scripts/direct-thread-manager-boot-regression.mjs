#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  activeWorldmodelFixture,
  buildAuthorityBoundary,
  buildRevisionCompatibility,
  buildThreadManagerProfile,
  buildWorkThreadDelegationPacket,
  buildWorkerBootPacket,
  buildWorldmodelManagerProfile,
  compareAuthorityBoundaries,
  validateAuthorityBoundaryComparisonWitness,
  validateThreadManagerProfile,
  validateWorkThreadDelegationPacket,
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

const now = () => Date.UTC(2026, 6, 3, 13, 30, 0);

const managerProfile = buildWorldmodelManagerProfile({
  scopeKind: "work_thread",
  userProfileId: "user_profile_fixture",
  projectId: "project_fixture",
  workThreadId: "work_thread_boot_fixture",
  managerAgentId: "agent_worldmodel_manager_fixture",
}, { now });

const threadManagerProfile = buildThreadManagerProfile({
  managerProfile,
  threadManagerProfileId: "thread_manager_profile_fixture",
  threadManagerAgentId: "agent_thread_manager_fixture",
  workThreadId: "work_thread_boot_fixture",
}, { now });
validateThreadManagerProfile(threadManagerProfile);
assert.equal(threadManagerProfile.roleKind, "thread_manager");
assert.equal(threadManagerProfile.canReceiveDelegation, true);
assert.equal(threadManagerProfile.canBuildWorkerBootPackets, true);
assert.equal(threadManagerProfile.canExecuteWorkerTasks, false);

const threadManagerProfileFromRef = buildThreadManagerProfile({
  managerProfileRef: {
    kind: "worldmodel_manager_profile",
    id: managerProfile.managerProfileId,
    digest: managerProfile.profileDigest,
    label: "Stored manager profile ref",
  },
  threadManagerProfileId: "thread_manager_profile_from_ref_fixture",
  threadManagerAgentId: "agent_thread_manager_from_ref_fixture",
  workThreadId: "work_thread_boot_fixture",
}, { now });
validateThreadManagerProfile(threadManagerProfileFromRef);
assert.equal(threadManagerProfileFromRef.managerProfileRef.id, managerProfile.managerProfileId);
assert.equal(threadManagerProfileFromRef.managerProfileRef.digest, managerProfile.profileDigest);

const worldmodel = activeWorldmodelFixture("work_thread", {
  revision: 3,
  subjectAgentId: "agent_worker_subject_fixture",
});

const delegation = buildWorkThreadDelegationPacket({
  managerProfile,
  threadManagerProfile,
  worldmodel,
  targetWorkThreadId: "work_thread_boot_fixture",
  objectiveSummary: "Implement a bounded worker task from the active worldmodel.",
  roleLane: "implementation_worker",
  requestedLaneKeys: ["task", "environment", "modelSelf"],
  requestedSectionKeys: ["O", "E", "D"],
  capabilityBundleRefs: [{
    kind: "capability_bundle",
    id: "capability_bundle_readonly_fixture",
    digest: "sha256:capability_bundle_fixture",
    label: "Readonly worker bundle",
  }],
  authorizationChannelRefs: [{
    kind: "authorization_channel",
    id: "authorization_channel_manager_fixture",
    digest: "sha256:authorization_channel_fixture",
    label: "Manager authorization route",
  }],
}, { now });
validateWorkThreadDelegationPacket(delegation);
assert.equal(delegation.status, "ready_for_thread_manager");
assert.equal(delegation.blockerCodes.length, 0);
assert.equal(delegation.worldmodelRef.id, worldmodel.worldmodelId);

const bootPacket = buildWorkerBootPacket({
  bootPacketId: "worker_boot_packet_fixture",
  delegationPacket: delegation,
  worldmodel,
  contextPackRef: {
    kind: "context_pack",
    id: "context_pack_shadow_fixture",
    digest: "sha256:context_pack_shadow_fixture",
    label: "Shadow context pack",
  },
}, { now });
validateWorkerBootPacket(bootPacket);
assert.equal(bootPacket.status, "ready_for_worker_boot");
assert.equal(bootPacket.targetWorkThreadId, "work_thread_boot_fixture");
assert.deepEqual(bootPacket.includedLaneKeys, ["task", "environment", "modelSelf"]);
assert.deepEqual(bootPacket.includedSectionKeys, ["O", "E", "D"]);
assert(bootPacket.roleLaneProjection.task.sections.O.summary.includes("task object world"));
assert(bootPacket.bootOmissions.some((omission) => omission.laneKey === "governance"));
assert(bootPacket.bootOmissions.some((omission) => omission.sectionKey === "U"));
assert.equal(bootPacket.shadowContextPackIntegration.mode, "shadow_only");
assert.equal(bootPacket.shadowContextPackIntegration.providerInjectionEnabled, false);
assert.equal(bootPacket.projectionWitness.bootPacketId, "worker_boot_packet_fixture");
assert.equal(bootPacket.projectionWitness.rawTextIncluded, false);
assert.equal(bootPacket.rawPromptIncluded, false);
assert.equal(bootPacket.rawTextIncluded, false);
assert.equal(bootPacket.rawPathIncluded, false);
assert.equal(bootPacket.rawSecretIncluded, false);

const generatedIdBootPacket = buildWorkerBootPacket({
  delegationPacket: delegation,
  worldmodel,
  contextPackRef: {
    kind: "context_pack",
    id: "context_pack_generated_id_fixture",
    digest: "sha256:context_pack_generated_id_fixture",
    label: "Generated-id shadow context pack",
  },
}, { now });
validateWorkerBootPacket(generatedIdBootPacket);
assert.equal(generatedIdBootPacket.shadowContextPackIntegration.bootPacketId, generatedIdBootPacket.bootPacketId);
assert.equal(generatedIdBootPacket.projectionWitness.bootPacketId, generatedIdBootPacket.bootPacketId);

const broadWorkerBoundary = buildAuthorityBoundary({
  authorityBoundaryId: "authority_boundary_broad_worker",
  workThreadId: "work_thread_boot_fixture",
  roleLane: "implementation_worker",
  allowedActionClasses: ["read_context", "summarize", "request_authorization", "apply_patch"],
  forbiddenActionClasses: ["run_command", "external_write", "account_mutation"],
});
const broadBootPacket = buildWorkerBootPacket({
  delegationPacket: delegation,
  worldmodel,
  workerAuthorityBoundary: broadWorkerBoundary,
}, { now });
validateWorkerBootPacket(broadBootPacket);
assert.equal(broadBootPacket.status, "blocked");
assert(broadBootPacket.blockerCodes.includes("authority_boundary_broadened"));

const parentBoundary = buildAuthorityBoundary({
  authorityBoundaryId: "authority_boundary_parent_fixture",
  allowedActionClasses: ["read_context", "summarize", "request_authorization"],
  forbiddenActionClasses: ["apply_patch", "run_command"],
});
const narrowerBoundary = buildAuthorityBoundary({
  authorityBoundaryId: "authority_boundary_narrower_fixture",
  allowedActionClasses: ["read_context"],
  forbiddenActionClasses: ["apply_patch", "run_command", "external_write"],
});
const comparison = compareAuthorityBoundaries({ parentBoundary, childBoundary: narrowerBoundary });
validateAuthorityBoundaryComparisonWitness(comparison);
assert.equal(comparison.decision, "narrower");
assert.equal(comparison.blocksBoot, false);

const staleCompatibility = buildRevisionCompatibility({
  expectedWorldmodelId: worldmodel.worldmodelId,
  expectedRevision: 2,
  currentWorldmodel: worldmodel,
});
const staleDelegation = buildWorkThreadDelegationPacket({
  managerProfile,
  threadManagerProfile,
  worldmodel,
  revisionCompatibility: staleCompatibility,
  targetWorkThreadId: "work_thread_boot_fixture",
}, { now });
validateWorkThreadDelegationPacket(staleDelegation);
assert.equal(staleDelegation.status, "blocked");
assert(staleDelegation.blockerCodes.includes("worldmodel_revision_not_current"));

const staleBootPacket = buildWorkerBootPacket({
  delegationPacket: staleDelegation,
  worldmodel,
}, { now });
validateWorkerBootPacket(staleBootPacket);
assert.equal(staleBootPacket.status, "blocked");
assert(staleBootPacket.staleWarnings.some((warning) => warning.warningKind === "worldmodel_revision_stale"));

const differentWorldmodel = activeWorldmodelFixture("project", {
  revision: 3,
  subjectAgentId: "agent_worker_different_fixture",
});
expectThrows(() => buildWorkerBootPacket({
  delegationPacket: delegation,
  worldmodel: differentWorldmodel,
}, { now }), "direct_thread_manager_worldmodel_mismatch");

const tamperedBootPacket = {
  ...bootPacket,
  roleLane: "review_auditor",
};
expectThrows(() => validateWorkerBootPacket(tamperedBootPacket), "direct_thread_manager_digest_mismatch");

const invalidContextIntegration = {
  ...bootPacket,
  shadowContextPackIntegration: {
    ...bootPacket.shadowContextPackIntegration,
    providerInjectionEnabled: true,
  },
};
expectThrows(() => validateWorkerBootPacket(invalidContextIntegration), "direct_thread_manager_context_integration_not_shadow");

console.log("direct thread manager boot regression passed");
