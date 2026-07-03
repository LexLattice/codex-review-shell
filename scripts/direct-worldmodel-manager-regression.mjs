#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  activeWorldmodelFixture,
  appendWorldmodelManagerLedgerRow,
  buildActiveWorldmodelPointer,
  buildManagerChatSessionMarker,
  buildUserRoleState,
  buildWorldmodelManagerControlPlaneAction,
  buildWorldmodelManagerLedger,
  buildWorldmodelManagerLedgerRow,
  buildWorldmodelManagerProfile,
  buildWorldmodelManagerStatusProjection,
  validateActiveWorldmodelPointer,
  validateManagerChatSessionMarker,
  validateUserRoleState,
  validateWorldmodelManagerControlPlaneAction,
  validateWorldmodelManagerLedger,
  validateWorldmodelManagerProfile,
  validateWorldmodelManagerStatusProjection,
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

const now = () => Date.UTC(2026, 6, 3, 12, 0, 0);

const globalProfile = buildWorldmodelManagerProfile({
  scopeKind: "global_user",
  userProfileId: "user_profile_fixture",
  managerAgentId: "agent_global_worldmodel_manager",
}, { now });
validateWorldmodelManagerProfile(globalProfile);
assert.equal(globalProfile.scope.scopeKind, "global_user");
assert.equal(globalProfile.controlPlaneOnly, true);
assert.equal(globalProfile.canExecuteWorkerTasks, false);
assert(globalProfile.allowedControlPlaneActions.includes("inspect_worldmodel_status"));
assert(globalProfile.blockedWorkerTaskActions.includes("apply_patch"));

const projectProfile = buildWorldmodelManagerProfile({
  scopeKind: "project",
  userProfileId: "user_profile_fixture",
  projectId: "project_fixture",
  managerAgentId: "agent_project_worldmodel_manager",
}, { now });
validateWorldmodelManagerProfile(projectProfile);
assert.equal(projectProfile.scope.projectId, "project_fixture");

const workThreadProfile = buildWorldmodelManagerProfile({
  scopeKind: "work_thread",
  userProfileId: "user_profile_fixture",
  projectId: "project_fixture",
  workThreadId: "work_thread_fixture",
  managerAgentId: "agent_workthread_worldmodel_manager",
}, { now });
validateWorldmodelManagerProfile(workThreadProfile);
assert.equal(workThreadProfile.scope.workThreadId, "work_thread_fixture");

const invalidWorkerProfile = {
  ...projectProfile,
  canExecuteWorkerTasks: true,
};
expectThrows(() => validateWorldmodelManagerProfile(invalidWorkerProfile), "direct_worldmodel_manager_worker_boundary_violation");

const worldmodel = activeWorldmodelFixture("project");
const ledger0 = buildWorldmodelManagerLedger({
  ledgerId: "worldmodel_manager_ledger_fixture",
  managerProfileId: projectProfile.managerProfileId,
}, { now });
validateWorldmodelManagerLedger(ledger0);
assert.equal(ledger0.rowCount, 0);

const profileAppend = appendWorldmodelManagerLedgerRow(ledger0, {
  rowKind: "manager_profile_created",
  managerProfile: projectProfile,
}, { now });
validateWorldmodelManagerLedger(profileAppend.ledger);
assert.equal(profileAppend.row.sequence, 1);
assert.equal(profileAppend.row.previousRowDigest, "");
assert.equal(profileAppend.ledger.ledgerHeadDigest, profileAppend.row.rowDigest);

const pointer = buildActiveWorldmodelPointer({
  pointerId: "active_worldmodel_pointer_fixture",
  managerProfileId: projectProfile.managerProfileId,
  worldmodel,
  ledgerRowId: profileAppend.row.rowId,
  ledgerHeadDigest: profileAppend.row.ledgerHeadDigest,
}, { now });
validateActiveWorldmodelPointer(pointer);
assert.equal(pointer.worldmodelId, worldmodel.worldmodelId);
assert.equal(pointer.worldmodelRevision, worldmodel.revision);

const pointerAppend = appendWorldmodelManagerLedgerRow(profileAppend.ledger, {
  rowKind: "active_worldmodel_pointer_set",
  activePointer: pointer,
  worldmodel,
}, { now });
validateWorldmodelManagerLedger(pointerAppend.ledger);
assert.equal(pointerAppend.row.sequence, 2);
assert.equal(pointerAppend.row.previousRowDigest, profileAppend.row.rowDigest);

const tamperedLedger = {
  ...pointerAppend.ledger,
  rows: pointerAppend.ledger.rows.map((row, index) => index === 1 ? { ...row, previousRowDigest: "sha256:bad" } : row),
};
expectThrows(() => validateWorldmodelManagerLedger(tamperedLedger), "direct_worldmodel_manager_ledger_previous_mismatch");

const tamperedArtifactDigestLedger = {
  ...pointerAppend.ledger,
  rows: pointerAppend.ledger.rows.map((row, index) => index === 1
    ? {
      ...row,
      artifactRefs: row.artifactRefs.map((ref, refIndex) => refIndex === 0 ? { ...ref, digest: "sha256:other_artifact_digest" } : ref),
    }
    : row),
};
expectThrows(() => validateWorldmodelManagerLedger(tamperedArtifactDigestLedger), "direct_worldmodel_manager_digest_mismatch");

expectThrows(() => buildWorldmodelManagerLedger({
  ledgerId: "worldmodel_manager_bad_artifact_ref_ledger",
  managerProfileId: projectProfile.managerProfileId,
  rows: [{
    rowKind: "worldmodel_status_inspected",
    artifactRefs: [{ kind: "bad_ref", id: "ref_without_digest" }],
  }],
}, { now }), "direct_worldmodel_manager_missing_string");

const maliciousAppend = appendWorldmodelManagerLedgerRow(pointerAppend.ledger, {
  rowKind: "worldmodel_status_inspected",
  managerProfileId: "manager_profile_attempted_override",
}, { now });
assert.equal(
  maliciousAppend.row.managerProfileId,
  pointerAppend.ledger.managerProfileId,
  "append input must not override the ledger managerProfileId",
);

const otherManagerRow = buildWorldmodelManagerLedgerRow({
  rowKind: "worldmodel_status_inspected",
  managerProfileId: "manager_profile_other",
}, null, { now });
expectThrows(() => validateWorldmodelManagerLedger({
  ...ledger0,
  rowCount: 1,
  rows: [otherManagerRow],
  ledgerHeadDigest: otherManagerRow.ledgerHeadDigest,
}), "direct_worldmodel_manager_ledger_manager_mismatch");

const managerChat = buildManagerChatSessionMarker({
  markerId: "manager_chat_marker_fixture",
  managerProfileId: projectProfile.managerProfileId,
  managerAgentId: projectProfile.managerAgentId,
  sessionId: "direct_manager_session_fixture",
}, { now });
validateManagerChatSessionMarker(managerChat);
assert.equal(managerChat.identityMarker, "worldmodel_manager_direct_chat");
assert.equal(managerChat.canExecuteWorkerTasks, false);

const roleState = buildUserRoleState({
  roleStateId: "user_role_state_fixture",
  userProfileId: "user_profile_fixture",
  activeMode: "manager_mode",
  managerProfileId: projectProfile.managerProfileId,
}, { now });
validateUserRoleState(roleState);
assert.equal(roleState.adminPolicyUpdateEnabled, false);
assert.equal(roleState.maySelfGrantAuthority, false);

const invalidRoleState = {
  ...roleState,
  maySelfGrantAuthority: true,
};
expectThrows(() => validateUserRoleState(invalidRoleState), "direct_worldmodel_manager_user_role_boundary_violation");

const invalidRolePosture = {
  ...roleState,
  posture: "root_mode",
};
expectThrows(() => validateUserRoleState(invalidRolePosture), "direct_worldmodel_manager_invalid_user_role_posture");

const inspectAction = buildWorldmodelManagerControlPlaneAction({
  actionId: "manager_action_inspect_fixture",
  managerProfileId: projectProfile.managerProfileId,
  actionKind: "inspect_worldmodel_status",
  targetWorldmodelId: worldmodel.worldmodelId,
}, { now });
validateWorldmodelManagerControlPlaneAction(inspectAction);
assert.equal(inspectAction.actionClass, "control_plane");
assert.equal(inspectAction.status, "allowed");

const workerAction = buildWorldmodelManagerControlPlaneAction({
  actionId: "manager_action_apply_patch_fixture",
  managerProfileId: projectProfile.managerProfileId,
  actionKind: "apply_patch",
}, { now });
validateWorldmodelManagerControlPlaneAction(workerAction);
assert.equal(workerAction.actionClass, "worker_task");
assert.equal(workerAction.status, "blocked");
assert.equal(workerAction.blockerCode, "manager_cannot_execute_worker_tasks");

const projection = buildWorldmodelManagerStatusProjection({
  managerProfile: projectProfile,
  ledger: pointerAppend.ledger,
  activePointer: pointer,
  chatMarker: managerChat,
});
validateWorldmodelManagerStatusProjection(projection);
assert.equal(projection.schema, "worldmodel_manager_status_projection@1");
assert.equal(projection.managerProfileId, projectProfile.managerProfileId);
assert.equal(projection.activeWorldmodelId, worldmodel.worldmodelId);
assert.equal(projection.ledgerRowCount, 2);
assert.equal(projection.managerChatSessionId, "direct_manager_session_fixture");
assert.equal(projection.canInspectWorldmodelStatus, true);
assert.equal(projection.canExecuteWorkerTasks, false);
assert.equal(projection.rawTextIncluded, false);
assert.equal(projection.rawPathIncluded, false);
assert.equal(projection.rawSecretIncluded, false);

const topLevelActionProjection = buildWorldmodelManagerStatusProjection({
  managerProfileId: projectProfile.managerProfileId,
  managerAgentId: projectProfile.managerAgentId,
  scopeKind: "project",
  allowedControlPlaneActions: ["inspect_worldmodel_status"],
  blockedWorkerTaskActions: ["run_command"],
});
validateWorldmodelManagerStatusProjection(topLevelActionProjection);
assert.deepEqual(topLevelActionProjection.allowedControlPlaneActions, ["inspect_worldmodel_status"]);
assert.deepEqual(topLevelActionProjection.blockedWorkerTaskActions, ["run_command"]);

const tamperedProjection = {
  ...projection,
  canExecuteWorkerTasks: true,
};
expectThrows(() => validateWorldmodelManagerStatusProjection(tamperedProjection), "direct_worldmodel_manager_worker_boundary_violation");

expectThrows(() => validateWorldmodelManagerStatusProjection({
  ...projection,
  allowedControlPlaneActions: ["inspect_worldmodel_status", "apply_patch"],
}), "direct_worldmodel_manager_invalid_control_action");

expectThrows(() => validateWorldmodelManagerStatusProjection({
  ...projection,
  blockedWorkerTaskActions: ["run_command", "inspect_worldmodel_status"],
}), "direct_worldmodel_manager_invalid_worker_action");

console.log("direct worldmodel manager regression passed");
