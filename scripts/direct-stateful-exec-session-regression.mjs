#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  DIRECT_STATEFUL_EXEC_SESSION_SURFACE_SCHEMA,
  DIRECT_STATEFUL_EXEC_SESSION_PLAN_SCHEMA,
  DIRECT_STATEFUL_EXEC_OUTPUT_FRAME_SCHEMA,
  DIRECT_STATEFUL_EXEC_STDIN_PLAN_SCHEMA,
  DIRECT_STATEFUL_EXEC_CLEANUP_PLAN_SCHEMA,
  DIRECT_STATEFUL_EXEC_RECOVERY_CLASSIFICATION_SCHEMA,
  buildStatefulExecSessionSurface,
  assertStatefulExecSessionSurfaceSafe,
} = require("../src/main/direct/tools/stateful-exec-session");
const {
  buildDirectSettingsSurfaceProjection,
  assertDirectSettingsSurfaceRendererSafe,
} = require("../src/main/direct/ui/settings-surface");
const {
  buildToolCapabilityRegistry,
  validateToolCapabilityRegistry,
} = require("../src/main/direct/bridge/tool-capability-registry");

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

const surface = buildStatefulExecSessionSurface({
  projectId: "project_stateful_exec_fixture",
  workThreadId: "work_thread_stateful_exec_fixture",
  nowMs: 0,
  sessionPlan: {
    sessionId: "session_running_1",
    projectId: "project_stateful_exec_fixture",
    workThreadId: "work_thread_stateful_exec_fixture",
    turnId: "turn_1",
    toolCallId: "call_exec_1",
    commandClass: "test_runner",
    commandPreview: "npm test",
    cwdEvidenceKey: "workspace_root_evidence_key",
    sessionState: "running",
    transportMode: "plain_pipe",
    idleTimeoutMs: 30000,
    hardTimeoutMs: 120000,
    outputBudgetChars: 24000,
    providerResultBudgetChars: 12000,
  },
  outputFrames: [
    {
      sessionId: "session_running_1",
      sequence: 1,
      stream: "stdout",
      originalChars: 1200,
      previewChars: 1200,
      providerVisible: true,
      outputEvidenceKey: "stdout_frame_1",
      observedAt: "1970-01-01T00:00:00.000Z",
    },
    {
      sessionId: "session_running_1",
      sequence: 2,
      stream: "stderr",
      originalChars: 20000,
      previewChars: 12000,
      providerVisible: true,
      outputEvidenceKey: "stderr_frame_2",
      observedAt: "1970-01-01T00:00:01.000Z",
    },
  ],
  stdinPlan: {
    stdinPolicy: "line_input",
    inputPreviewChars: 8,
  },
  cleanupPlan: {
    cleanupState: "pending",
  },
  recoveryClassification: {
    sessionState: "running",
  },
});

assert(surface.schema === DIRECT_STATEFUL_EXEC_SESSION_SURFACE_SCHEMA, "surface schema mismatch");
assert(surface.sessionPlan.schema === DIRECT_STATEFUL_EXEC_SESSION_PLAN_SCHEMA, "session plan schema mismatch");
assert(surface.outputFrames[0].schema === DIRECT_STATEFUL_EXEC_OUTPUT_FRAME_SCHEMA, "output frame schema mismatch");
assert(surface.stdinPlan.schema === DIRECT_STATEFUL_EXEC_STDIN_PLAN_SCHEMA, "stdin plan schema mismatch");
assert(surface.cleanupPlan.schema === DIRECT_STATEFUL_EXEC_CLEANUP_PLAN_SCHEMA, "cleanup plan schema mismatch");
assert(surface.recoveryClassification.schema === DIRECT_STATEFUL_EXEC_RECOVERY_CLASSIFICATION_SCHEMA, "recovery schema mismatch");
assert(surface.sessionPlan.runCommandAlias === false, "exec_command must not be a run_command alias");
assert(surface.sessionPlan.terminal === false, "running session must not be terminal");
assert(surface.recoveryClassification.terminalSuccessClaimAllowed === false, "running session must not claim success");
assert(surface.recoveryClassification.replayAllowed === false, "running session replay must be forbidden");
assert(surface.outputFrameSequenceValid === true, "output frame sequence should be valid");
assert(surface.outputFrames[1].truncated === true, "large output frame should be marked truncated");
assert(surface.stdinPlan.canWrite === true, "line-input policy should allow stdin for running session");
assert(surface.writeStdinToolEnabledInThisPr === true, "write_stdin should be enabled only with valid stdin plan");
assert(surface.providerDeclarationAllowed === false, "provider declaration must remain blocked");
assert(surface.providerTransportAllowed === false, "provider transport must remain blocked");
assert(surface.ptyModeEnabledInThisPr === false, "PTY mode must remain deferred");
assertStatefulExecSessionSurfaceSafe(surface);

const missingTarget = buildStatefulExecSessionSurface({
  sessionPlan: {
    sessionId: "missing_target_surface_session",
    sessionState: "running",
  },
  stdinPlan: {
    sessionId: "different_missing_session",
    targetExists: false,
    stdinPolicy: "line_input",
  },
});
assert(missingTarget.stdinPlan.canWrite === false, "stdin should not target missing session");
assert(missingTarget.stdinPlan.blockerCodes.includes("missing_session"), "missing target should be explicit");
assert(missingTarget.writeStdinToolEnabledInThisPr === false, "write_stdin should be disabled for missing target");
assertStatefulExecSessionSurfaceSafe(missingTarget);

const terminalTarget = buildStatefulExecSessionSurface({
  sessionPlan: {
    sessionId: "terminal_session",
    sessionState: "completed",
    exitCode: 0,
  },
  stdinPlan: {
    stdinPolicy: "line_input",
  },
});
assert(terminalTarget.sessionPlan.terminal === true, "completed session should be terminal");
assert(terminalTarget.stdinPlan.canWrite === false, "stdin should not target terminal session");
assert(terminalTarget.recoveryClassification.terminalSuccessClaimAllowed === true, "completed session with terminal evidence can claim terminal success");
assertStatefulExecSessionSurfaceSafe(terminalTarget);

const badSequence = buildStatefulExecSessionSurface({
  sessionPlan: {
    sessionId: "bad_sequence_session",
    sessionState: "running",
  },
  outputFrames: [
    { sequence: 2 },
    { sequence: 2 },
  ],
});
assert(badSequence.outputFrameSequenceValid === false, "duplicate output sequence should be invalid");
expectThrows(() => assertStatefulExecSessionSurfaceSafe(badSequence), "direct_stateful_exec_output_frame_sequence_invalid");

const settingsProjection = buildDirectSettingsSurfaceProjection({
  projectId: "project_stateful_exec_fixture",
  statefulExecStatus: surface,
});
assert(settingsProjection.sections.statefulExec.available === true, "settings should expose stateful exec surface");
assert(settingsProjection.sections.statefulExec.execCommandToolEnabledInThisPr === true, "settings should show restricted exec_command");
assert(settingsProjection.sections.statefulExec.writeStdinToolEnabledInThisPr === true, "settings should show write_stdin with valid policy");
assert(settingsProjection.sections.statefulExec.runCommandAliasAllowed === false, "settings must block run_command aliasing");
assert(Array.isArray(settingsProjection.rows.statefulExec) && settingsProjection.rows.statefulExec.length >= 8, "settings should render stateful exec rows");
assert(settingsProjection.authority.statefulExecProviderDeclarationAllowed === false, "settings authority must block provider declaration");
assert(settingsProjection.authority.statefulExecRunCommandAliasAllowed === false, "settings authority must block run_command alias");
assertDirectSettingsSurfaceRendererSafe(settingsProjection);

const registry = buildToolCapabilityRegistry({
  projectId: "project_stateful_exec_fixture",
  nowMs: 0,
});
validateToolCapabilityRegistry(registry);
const rows = byToolId(registry);
const execCommand = rows.get("vanilla.exec_command");
const writeStdin = rows.get("vanilla.write_stdin");
const runCommand = rows.get("direct.run_command");
assert(execCommand.promotionState === "direct_restricted", "exec_command should be promoted to restricted stateful surface");
assert(execCommand.localExecutor === "src/main/direct/tools/stateful-exec-session.js", "exec_command should cite stateful executor");
assert(execCommand.requestShapeFamilies.includes("stateful_exec_session_envelope"), "exec_command should declare session envelope");
assert(writeStdin.promotionState === "direct_restricted", "write_stdin should be promoted to restricted stdin surface");
assert(writeStdin.requestShapeFamilies.includes("stateful_stdin_envelope"), "write_stdin should declare stdin envelope");
assert(runCommand.localExecutor !== execCommand.localExecutor, "exec_command must remain separate from run_command");

const serialized = JSON.stringify({ surface, settingsProjection, registry });
for (const forbidden of [
  "\"rawCommandIncluded\":true",
  "\"rawOutputIncluded\":true",
  "\"rawInputIncluded\":true",
  "\"rawPathIncluded\":true",
  "\"rawSecretIncluded\":true",
  "super-secret-token",
]) {
  assert(!serialized.includes(forbidden), `serialized surface leaked ${forbidden}`);
}

console.log(JSON.stringify({
  ok: true,
  surfaceId: surface.surfaceId,
  sessionId: surface.sessionPlan.sessionId,
  outputFrameCount: surface.outputFrameCount,
  recoveryClass: surface.recoveryClassification.recoveryClass,
}));
