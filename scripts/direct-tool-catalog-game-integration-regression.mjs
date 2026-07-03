#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  activeWorldmodelFixture,
  buildResidentToolCatalogAuthorizationOverlay,
  buildThreadManagerProfile,
  buildWave23WorldmodelAuthorizationGameSuite,
  buildWorkThreadDelegationPacket,
  buildWorkerBootPacket,
  buildWorldmodelManagerProfile,
  runWave23WorldmodelAuthorizationGameSuite,
  validateResidentToolCatalogAuthorizationOverlay,
  validateThreadManagerProfile,
  validateWave23WorldmodelAuthorizationGameReport,
  validateWave23WorldmodelAuthorizationGameSuite,
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

const now = () => Date.UTC(2026, 6, 3, 16, 20, 0);

const managerProfile = buildWorldmodelManagerProfile({
  scopeKind: "work_thread",
  userProfileId: "user_profile_tool_catalog_fixture",
  projectId: "project_tool_catalog_fixture",
  workThreadId: "work_thread_tool_catalog_fixture",
  managerAgentId: "agent_worldmodel_manager_tool_catalog_fixture",
}, { now });

const threadManagerProfile = buildThreadManagerProfile({
  managerProfile,
  threadManagerProfileId: "thread_manager_profile_tool_catalog_fixture",
  threadManagerAgentId: "agent_thread_manager_tool_catalog_fixture",
  workThreadId: "work_thread_tool_catalog_fixture",
}, { now });
validateThreadManagerProfile(threadManagerProfile);

const worldmodel = activeWorldmodelFixture("work_thread", {
  worldmodelId: "worldmodel_tool_catalog_fixture",
  revision: 8,
  subjectAgentId: "agent_worker_tool_catalog_fixture",
});

const delegation = buildWorkThreadDelegationPacket({
  managerProfile,
  threadManagerProfile,
  worldmodel,
  targetWorkThreadId: "work_thread_tool_catalog_fixture",
  objectiveSummary: "Exercise resident catalog authorization routes.",
  roleLane: "implementation_worker",
  requestedLaneKeys: ["task", "environment", "modelSelf"],
  requestedSectionKeys: ["O", "E", "D"],
  authorizationChannelRefs: [{
    kind: "authorization_channel",
    id: "authorization_channel_worldmodel_manager",
    digest: "sha256:authorization_channel_worldmodel_manager",
    label: "Worldmodel Manager route",
  }],
}, { now });
validateWorkThreadDelegationPacket(delegation);

const bootPacket = buildWorkerBootPacket({
  bootPacketId: "worker_boot_packet_tool_catalog_fixture",
  delegationPacket: delegation,
  worldmodel,
}, { now });
validateWorkerBootPacket(bootPacket);

const residentCatalog = {
  schema: "resident_tool_epistemic_catalog@1",
  catalogId: "resident_tool_catalog_tool_catalog_fixture",
  catalogDigest: "sha256:resident_tool_catalog_tool_catalog_fixture",
  rows: [{
    subjectId: "read_file",
    displayLabel: "read_file",
    status: "callable_now",
    callableInCurrentRequest: true,
    evidenceRefs: [{
      kind: "resident_tool_catalog_row",
      id: "read_file_row",
      digest: "sha256:read_file_row",
      label: "read_file row",
    }],
  }, {
    subjectId: "apply_patch",
    displayLabel: "apply_patch",
    status: "blocked_by_policy",
    callableInCurrentRequest: false,
    blockerCodes: ["manager_authorization_required"],
  }, {
    subjectId: "broad_refactor",
    displayLabel: "broad_refactor",
    status: "blocked_by_policy",
    callableInCurrentRequest: false,
    blockerCodes: ["explicit_user_confirmation_required"],
  }, {
    subjectId: "destructive_delete",
    displayLabel: "destructive_delete",
    status: "blocked_by_policy",
    callableInCurrentRequest: false,
    blockerCodes: ["admin_mode_required"],
  }],
};

const overlay = buildResidentToolCatalogAuthorizationOverlay({
  catalog: residentCatalog,
  bootPacket,
  managerProfile,
  capabilityRoutes: [{
    toolName: "apply_patch",
    actionClass: "apply_patch",
    routeReason: "manager_authorization_required",
  }, {
    toolName: "broad_refactor",
    actionClass: "broad_refactor",
    routeReason: "explicit_user_confirmation_required",
  }, {
    toolName: "destructive_delete",
    actionClass: "destructive_delete",
    routeReason: "admin_mode_required",
  }],
}, { now });
validateResidentToolCatalogAuthorizationOverlay(overlay);
assert.equal(overlay.catalogGrantsAuthority, false);
assert.equal(overlay.providerTransportStarted, false);
assert.equal(overlay.workspaceMutationStarted, false);
assert.equal(overlay.byRouteReason.available, 1);
assert.equal(overlay.byRouteReason.manager_authorization_required, 1);
assert.equal(overlay.byRouteReason.explicit_user_confirmation_required, 1);
assert.equal(overlay.byRouteReason.admin_mode_required, 1);
assert(overlay.overlayRows.every((row) => row.bootPacketRef.id === bootPacket.bootPacketId));
assert(overlay.overlayRows.every((row) => row.managerRouteRef.id === managerProfile.managerProfileId));
assert.equal(overlay.overlayRows.find((row) => row.subjectId === "apply_patch").nextStep, "request_manager_authorization");
assert.equal(overlay.overlayRows.find((row) => row.subjectId === "broad_refactor").nextStep, "route_manager_escalation_to_user_confirmation");
assert.equal(overlay.overlayRows.find((row) => row.subjectId === "destructive_delete").nextStep, "route_manager_escalation_to_admin_mode");

const missingWorldmodelOverlay = buildResidentToolCatalogAuthorizationOverlay({
  catalog: {
    schema: "resident_tool_epistemic_catalog@1",
    catalogId: "resident_tool_catalog_missing_worldmodel_fixture",
    rows: [{ subjectId: "apply_patch", status: "blocked_by_policy", callableInCurrentRequest: false }],
  },
  managerProfile,
}, { now });
validateResidentToolCatalogAuthorizationOverlay(missingWorldmodelOverlay);
assert.equal(missingWorldmodelOverlay.overlayRows[0].routeReason, "missing_worldmodel");
assert.equal(missingWorldmodelOverlay.overlayRows[0].nextStep, "refresh_or_build_active_worldmodel");

const staleDelegation = buildWorkThreadDelegationPacket({
  managerProfile,
  threadManagerProfile,
  worldmodel,
  expectedRevision: 7,
  targetWorkThreadId: "work_thread_tool_catalog_fixture",
  objectiveSummary: "Exercise stale resident catalog authorization route.",
  roleLane: "implementation_worker",
}, { now });
validateWorkThreadDelegationPacket(staleDelegation);
const staleBootPacket = buildWorkerBootPacket({
  bootPacketId: "worker_boot_packet_tool_catalog_stale_fixture",
  delegationPacket: staleDelegation,
  worldmodel,
}, { now });
validateWorkerBootPacket(staleBootPacket);
const staleOverlay = buildResidentToolCatalogAuthorizationOverlay({
  catalog: {
    schema: "resident_tool_epistemic_catalog@1",
    catalogId: "resident_tool_catalog_stale_worldmodel_fixture",
    rows: [{ subjectId: "apply_patch", status: "blocked_by_policy", callableInCurrentRequest: false }],
  },
  bootPacket: staleBootPacket,
  managerProfile,
}, { now });
validateResidentToolCatalogAuthorizationOverlay(staleOverlay);
assert.equal(staleOverlay.overlayRows[0].routeReason, "stale_worldmodel");

const malformed = structuredClone(overlay);
malformed.catalogGrantsAuthority = true;
malformed.overlayDigest = "sha256:wrong";
expectThrows(() => validateResidentToolCatalogAuthorizationOverlay(malformed), "direct_tool_catalog_games_overlay_authority_leak");

const malformedEvidenceRef = structuredClone(overlay);
malformedEvidenceRef.overlayRows[0].evidenceRefs[0].rawSecretIncluded = true;
malformedEvidenceRef.overlayRows[0].rowDigest = "sha256:wrong";
malformedEvidenceRef.overlayDigest = "sha256:wrong";
expectThrows(() => validateResidentToolCatalogAuthorizationOverlay(malformedEvidenceRef), "direct_tool_catalog_games_raw_ref_exposure");

const suite = buildWave23WorldmodelAuthorizationGameSuite({ now });
validateWave23WorldmodelAuthorizationGameSuite(suite);
assert.equal(suite.scenarios.length, 9);
assert(suite.gameIds.includes("w23_g4_worker_broad_refactor_remands_to_manager"));
assert(suite.gameIds.includes("w23_g9_projection_leakage_witness"));
assert.equal(suite.providerTransportExpected, false);
assert.equal(suite.workspaceMutationExpected, false);
const managerReadonly = suite.scenarios.find((scenario) => scenario.scenarioId === "w23_g5_manager_grants_bounded_readonly");
assert.deepEqual(managerReadonly.topology.agents.map((agent) => agent.alias).sort(), ["worker", "world_manager"]);
assert.equal(managerReadonly.topology.agents.find((agent) => agent.alias === "worker").parentAlias, "world_manager");
const projectionLeakage = suite.scenarios.find((scenario) => scenario.scenarioId === "w23_g9_projection_leakage_witness");
assert.deepEqual(projectionLeakage.topology.agents.map((agent) => agent.alias).sort(), ["worker", "world_manager"]);
assert.equal(projectionLeakage.topology.agents.find((agent) => agent.alias === "worker").parentAlias, "world_manager");

const report = runWave23WorldmodelAuthorizationGameSuite(suite);
validateWave23WorldmodelAuthorizationGameReport(report);
assert.equal(report.summary.valid, true);
assert.equal(report.summary.total, 9);
assert.equal(report.summary.passed, 9);
assert.equal(report.providerTransportStarted, false);
assert.equal(report.workspaceMutationStarted, false);
assert.equal(report.rawPayloadIncluded, false);

const invalidReport = structuredClone(report);
invalidReport.workspaceMutationStarted = true;
invalidReport.reportDigest = "sha256:wrong";
expectThrows(() => validateWave23WorldmodelAuthorizationGameReport(invalidReport), "direct_tool_catalog_games_report_authority_or_raw_leak");

const malformedSuiteNoGameIds = structuredClone(suite);
delete malformedSuiteNoGameIds.gameIds;
malformedSuiteNoGameIds.suiteDigest = "sha256:wrong";
expectThrows(() => validateWave23WorldmodelAuthorizationGameSuite(malformedSuiteNoGameIds), "direct_tool_catalog_games_missing_array");

const filteredSuite = structuredClone(suite);
filteredSuite.gameIds = [];
filteredSuite.scenarios = [];
filteredSuite.suiteDigest = "sha256:wrong";
expectThrows(() => runWave23WorldmodelAuthorizationGameSuite(filteredSuite), "direct_tool_catalog_games_scenario_count_mismatch");

console.log("direct tool catalog game integration regression passed");
