#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  CODE_MODE_ARTIFACT_OUTPUT_POLICY_SCHEMA,
  CODE_MODE_EXECUTE_POSTURE_SCHEMA,
  CODE_MODE_EXECUTION_LANE_STATUS_SCHEMA,
  CODE_MODE_KERNEL_SESSION_SCHEMA,
  CODE_MODE_WAIT_CANCEL_POLICY_SCHEMA,
  assertCodeModeExecutionLaneSafe,
  buildCodeModeExecutionLaneStatus,
} = require("../src/main/direct/tools/code-mode-execution-lane");
const {
  buildDirectSettingsSurfaceProjection,
  assertDirectSettingsSurfaceRendererSafe,
} = require("../src/main/direct/ui/settings-surface");
const {
  buildToolCapabilityRegistry,
  validateToolCapabilityRegistry,
} = require("../src/main/direct/bridge/tool-capability-registry");
const {
  buildDirectInformationBridgeAudit,
} = require("../src/main/direct/bridge/information-registry");

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

const status = buildCodeModeExecutionLaneStatus({
  projectId: "project_code_mode_fixture",
  workThreadId: "work_thread_code_mode_fixture",
  threadId: "thread_code_mode_fixture",
  nowMs: 0,
  kernelSession: {
    kernelSessionId: "kernel_code_mode_1",
    kernelKind: "provider_code_mode",
    language: "python",
    state: "not_started",
    resourceClass: "medium",
    maxWallTimeMs: 60000,
    maxOutputBytes: 24000,
  },
  executePosture: {
    executeRequestId: "execute_code_mode_1",
    executionState: "blocked_execution_not_enabled",
    requestShapeFamily: "code_mode_execute_request_posture",
    estimatedResourceClass: "medium",
    providerVisibleOutputBudgetBytes: 12000,
  },
  waitCancelPolicy: {
    waitState: "blocked_execution_not_enabled",
    cancelState: "blocked_execution_not_enabled",
    waitTimeoutMs: 30000,
    cancelTimeoutMs: 5000,
  },
  artifactOutputPolicy: {
    artifactState: "metadata_only",
    allowedArtifactKinds: ["structured_result_ref", "text_summary"],
    artifactRefPolicy: "metadata_only",
  },
});

assert(status.schema === CODE_MODE_EXECUTION_LANE_STATUS_SCHEMA, "status schema mismatch");
assert(status.kernelSession.schema === CODE_MODE_KERNEL_SESSION_SCHEMA, "kernel schema mismatch");
assert(status.executePosture.schema === CODE_MODE_EXECUTE_POSTURE_SCHEMA, "execute posture schema mismatch");
assert(status.waitCancelPolicy.schema === CODE_MODE_WAIT_CANCEL_POLICY_SCHEMA, "wait/cancel policy schema mismatch");
assert(status.artifactOutputPolicy.schema === CODE_MODE_ARTIFACT_OUTPUT_POLICY_SCHEMA, "artifact policy schema mismatch");
assert(status.mode === "projection_only", "code mode lane must be projection-only");
assert(status.laneState === "blocked_until_kernel_authority", "code mode lane must remain blocked");
assert(status.kernelSession.shellApprovalProfileInherited === false, "code mode must not inherit shell approval");
assert(status.executePosture.workspaceMutationAllowed === false, "execute posture must not mutate workspace");
assert(status.artifactOutputPolicy.artifactWriteAllowed === false, "artifact policy must not write artifacts");
assertCodeModeExecutionLaneSafe(status);

const settingsProjection = buildDirectSettingsSurfaceProjection({
  projectId: "project_code_mode_fixture",
  codeModeExecutionLaneStatus: status,
});
assert(settingsProjection.sections.codeModeExecutionLane.available === true, "settings should expose code mode lane");
assert(settingsProjection.sections.codeModeExecutionLane.executionState === "blocked_execution_not_enabled", "settings should show blocked execute posture");
assert(settingsProjection.sections.codeModeExecutionLane.artifactState === "metadata_only", "settings should show artifact policy");
assert(settingsProjection.bridgeOrgans.includes("code_mode_execution_lane"), "settings should cite code mode bridge organ");
assert(Array.isArray(settingsProjection.rows.codeModeExecutionLane) && settingsProjection.rows.codeModeExecutionLane.length >= 8, "settings should render code mode rows");
assert(settingsProjection.authority.codeModeProviderTransportAllowed === false, "settings authority must block provider transport");
assert(settingsProjection.authority.codeModeLocalExecutionAllowed === false, "settings authority must block local execution");
assert(settingsProjection.authority.codeModeShellApprovalProfileInherited === false, "settings authority must block shell approval inheritance");
assertDirectSettingsSurfaceRendererSafe(settingsProjection);

const registry = buildToolCapabilityRegistry({
  projectId: "project_code_mode_fixture",
  nowMs: 0,
});
validateToolCapabilityRegistry(registry);
const rows = byToolId(registry);
const execute = rows.get("vanilla.code_mode_execute");
const wait = rows.get("vanilla.code_mode_wait");
assert(execute.odeuFamily === "structured_execution_lane", "execute should be structured execution lane");
assert(execute.implementationState === "projection_only", "execute should be projection-only");
assert(execute.promotionState === "diagnostic_only", "execute should be diagnostic-only");
assert(execute.localExecutor === "src/main/direct/tools/code-mode-execution-lane.js", "execute should cite code-mode lane artifact");
assert(execute.authorityRequired === "code_mode_execution_gate", "execute should require code-mode gate");
assert(execute.requestShapeFamilies.includes("code_mode_execute_request_posture"), "execute should declare execute posture");
assert(wait.requestShapeFamilies.includes("code_mode_wait_cancel_policy"), "wait should declare wait/cancel policy");
assert(wait.localExecutor === execute.localExecutor, "wait should cite same code-mode lane artifact");

const audit = buildDirectInformationBridgeAudit({ generatedAt: "1970-01-01T00:00:00.000Z" });
assert(audit.rows.some((row) => row.id === "ic31.code-mode-execution-lane"), "information registry should include code mode row");

const hostile = buildCodeModeExecutionLaneStatus({
  projectId: "hostile_code_mode",
  nowMs: 0,
});
hostile.localExecutionAllowed = true;
expectThrows(() => assertCodeModeExecutionLaneSafe(hostile), "code_mode_execution_lane_authority_leak");

const hostilePart = buildCodeModeExecutionLaneStatus({
  projectId: "hostile_code_mode_part",
  nowMs: 0,
});
hostilePart.executePosture.rawCodeIncluded = true;
expectThrows(() => assertCodeModeExecutionLaneSafe(hostilePart), "code_mode_execution_lane_part_authority_leak");

const serialized = JSON.stringify({ status, settingsProjection, registry, audit });
for (const forbidden of [
  "\"localExecutionAllowed\":true",
  "\"providerTransportAllowed\":true",
  "\"requestShapeMutationAllowed\":true",
  "\"shellApprovalProfileInherited\":true",
  "\"rawCodeIncluded\":true",
  "\"rawOutputIncluded\":true",
  "\"rawArtifactIncluded\":true",
  "\"rawPathIncluded\":true",
  "\"rawSecretIncluded\":true",
  "print('secret')",
]) {
  assert(!serialized.includes(forbidden), `serialized code-mode lane leaked ${forbidden}`);
}

const circular = { name: "circular_code_mode_fixture" };
circular.self = circular;
const circularStatus = buildCodeModeExecutionLaneStatus({
  projectId: "project_circular_code_mode",
  kernelSession: circular,
  nowMs: 0,
});
assertCodeModeExecutionLaneSafe(circularStatus);
assert(circularStatus.statusDigest && circularStatus.kernelSession.sessionDigest, "circular fixture should still produce digests");

console.log("direct-code-mode-execution-lane regression passed");
