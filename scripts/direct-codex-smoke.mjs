import nodeAssert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");

const {
  buildDirectCheckpointCandidate,
  buildImportCandidate,
  validateDirectCheckpointCandidate,
} = require("../src/main/direct/import/codex-jsonl-import");
const {
  DEFAULT_FIXTURE_ROOT,
  NORMALIZED_FIXTURE_DIR,
  PROFILE_DELTAS_FIXTURE_DIR,
  RAW_FIXTURE_DIR,
  listFixtureFiles,
  loadFixtureFile,
} = require("../src/main/direct/fixtures/fixture-loader");
const { redactFixture, assertFixtureRedacted, scanFixtureForSecrets } = require("../src/main/direct/fixtures/redaction");
const { createDirectAuthStore, DEFAULT_DIRECT_AUTH_FILE_NAME } = require("../src/main/direct/auth/auth-store");
const {
  createDirectAuthIpcController,
  registerDirectAuthIpcHandlers,
} = require("../src/main/direct/auth/auth-ipc");
const { createDirectAuthLoginCoordinator } = require("../src/main/direct/auth/auth-login");
const { codexAuthTokensFromCredentials } = require("../src/main/direct/auth/app-server-auth-bridge");
const { normalizeDirectCodexEvents, parseSseFixtureText } = require("../src/main/direct/normalizer/codex-event-normalizer");
const { buildFixtureProfileDelta } = require("../src/main/direct/odeu-profile/profile-delta-builder");
const { loadDirectCodexProfile } = require("../src/main/direct/odeu-profile/profile-loader");
const { buildDirectCodexProfileReport } = require("../src/main/direct/odeu-profile/profile-report");
const {
  DIRECT_RUNTIME_STATUS_SCHEMA,
  buildDirectRuntimeStatus,
  normalizeCodexRuntimeMode,
} = require("../src/main/direct/runtime/runtime-status");
const { DirectSessionStore } = require("../src/main/direct/session/session-store");
const {
  DIRECT_FIXTURE_SURFACE_TRANSPORT,
  DirectFixtureController,
  DirectFixtureSurfaceSession,
  buildDirectFixtureCapabilities,
} = require("../src/main/direct/controller/fixture-controller");
const {
  DEFAULT_CODEX_RESPONSES_ENDPOINT,
  DIRECT_TOOL_CONTINUATION_RESULT_SCHEMA,
  DIRECT_TEXT_PROBE_RESULT_SCHEMA,
  buildTextOnlyProbeRequest,
  runPersistedReadOnlyToolContinuation,
  runPersistedTextOnlyDirectProbe,
  runTextOnlyDirectProbe,
} = require("../src/main/direct/transport/codex-responses-transport");
const {
  DEFAULT_PROBE_MANIFEST_DIR,
  runFixtureBackedProbe,
  runProbeManifestDir,
} = require("../src/main/direct/probes/probe-runner");
const {
  DIRECT_READONLY_TOOL_AUTHORITY_DECISION_SCHEMA,
  DIRECT_READONLY_TOOL_CONTINUATION_REQUEST_SCHEMA,
  DIRECT_READONLY_TOOL_RESULT_SCHEMA,
  approveReadOnlyToolObligation,
  buildReadOnlyToolContinuationRequest,
  cancelReadOnlyToolObligation,
  declineReadOnlyToolObligation,
  executeApprovedReadOnlyToolObligation,
  recordReadOnlyToolContinuationRequest,
} = require("../src/main/direct/tools/read-only-authority");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertThrows(callback, message) {
  try {
    callback();
  } catch {
    return;
  }
  throw new Error(message);
}

async function assertRejects(callback, message) {
  try {
    await callback();
  } catch {
    return;
  }
  throw new Error(message);
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function syntheticJwt(payload) {
  return `${base64UrlJson({ alg: "none", typ: "JWT" })}.${base64UrlJson(payload)}.signature`;
}

async function waitForCondition(callback, message, timeoutMs = 1_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (callback()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

function listenHttp(server, host = "127.0.0.1", port = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeHttp(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

function canReadBackMode(filePath, expectedMode) {
  if (process.platform === "win32") return false;
  try {
    const originalMode = fs.statSync(filePath).mode & 0o777;
    fs.chmodSync(filePath, expectedMode);
    const observedMode = fs.statSync(filePath).mode & 0o777;
    fs.chmodSync(filePath, originalMode);
    return observedMode === expectedMode;
  } catch {
    return false;
  }
}

function stripGeneratedAt(value) {
  const clone = structuredClone(value);
  delete clone.generatedAt;
  return clone;
}

function expectedFixturePath(directory, rawFixtureId) {
  const fixtureName = rawFixtureId.replace(/^raw\//, "");
  return path.join(directory, `${fixtureName}.json`);
}

function validateCommittedFixtureCorpus() {
  const fixtureRoot = path.resolve(appRoot, DEFAULT_FIXTURE_ROOT);
  const rawFiles = listFixtureFiles(RAW_FIXTURE_DIR);
  assert(rawFiles.length >= 4, "Expected at least four committed direct Codex raw fixtures.");

  for (const rawPath of rawFiles) {
    const rawFixture = loadFixtureFile(rawPath, { rootDir: fixtureRoot, requireRedacted: true });
    const normalized = normalizeDirectCodexEvents(rawFixture.records, { failOnUnknown: true });

    const expectedNormalized = loadFixtureFile(
      expectedFixturePath(NORMALIZED_FIXTURE_DIR, rawFixture.id),
      { rootDir: fixtureRoot, requireRedacted: true },
    );
    nodeAssert.deepStrictEqual(
      normalized.normalized,
      expectedNormalized.records,
      `Normalized fixture mismatch for ${rawFixture.id}.`,
    );

    const actualDelta = buildFixtureProfileDelta({
      fixtureId: rawFixture.id,
      normalizedEvents: normalized.normalized,
      unknownRawTypes: normalized.unknown.map((event) => event.rawType),
    });
    const expectedDelta = loadFixtureFile(
      expectedFixturePath(PROFILE_DELTAS_FIXTURE_DIR, rawFixture.id),
      { rootDir: fixtureRoot, requireRedacted: true },
    );
    assert(expectedDelta.records.length > 0, `Expected at least one delta record in ${expectedDelta.id}.`);
    nodeAssert.deepStrictEqual(
      stripGeneratedAt(actualDelta),
      stripGeneratedAt(expectedDelta.records[0]),
      `Profile delta fixture mismatch for ${rawFixture.id}.`,
    );
  }

  return rawFiles.length;
}

const profileDoc = loadDirectCodexProfile();
assert(profileDoc.profile.source === "imported-baseline", "Expected imported conceptual baseline profile.");
assert(profileDoc.capabilityIndex.get("direct_backend_endpoint")?.status === "observed", "Expected direct endpoint to remain observed.");
assert(profileDoc.capabilityIndex.get("consumer_chatgpt_thread_programmatic_control")?.status === "rejected", "Expected consumer web-thread automation to be rejected.");
assert(normalizeCodexRuntimeMode("experimental-direct") === "direct-experimental", "Expected direct runtime mode alias normalization.");
const directRuntimeStatus = buildDirectRuntimeStatus({
  project: {
    surfaceBinding: {
      codex: {
        mode: "managed",
        provider: "direct-chatgpt-codex",
        runtimeMode: "direct-experimental",
        profileId: profileDoc.profile.profileId,
      },
    },
  },
  authStatus: {
    status: "authenticated",
    accountId: "[REDACTED:account-id]",
    hasAccessToken: true,
    hasRefreshToken: true,
    rawTokensExposed: false,
    storageMode: "file",
  },
  authSettings: {
    storageMode: "file",
    storagePathExposed: false,
  },
  profileDoc,
});
assert(directRuntimeStatus.schema === DIRECT_RUNTIME_STATUS_SCHEMA, "Expected direct runtime status schema.");
assert(directRuntimeStatus.runtimeMode === "direct-experimental", "Expected direct experimental runtime mode.");
assert(directRuntimeStatus.directRuntime.turnRunnable === false, "Phase 0 direct runtime must not claim turns are runnable.");
assert(directRuntimeStatus.models.source === "static-baseline", "Expected direct model source to be visible as static baseline.");
assert(directRuntimeStatus.models.selectorEnabled === false, "Model selector must remain disabled until direct gates pass.");
assert(directRuntimeStatus.models.ids.length > 0, "Expected ODEU baseline model ids in runtime status.");
assert(directRuntimeStatus.auth.rawTokensExposed === false, "Direct runtime status must not expose raw tokens.");
assert(directRuntimeStatus.auth.capability.storage === "plain-file-dev-only", "Expected file auth storage to be labeled dev-file only.");
assert(directRuntimeStatus.diagnostics.rawBackendFramesExposed === false, "Direct runtime status must not expose raw backend frames.");
assert(directRuntimeStatus.textProbe.available === true, "Expected direct text probe to be advertised in direct mode.");
assert(directRuntimeStatus.textProbe.runnable === false, "Text probe availability must not make normal direct turns runnable.");
assert(directRuntimeStatus.textProbe.manualOnly === true, "Live text probe must remain manual-only.");
const directRuntimeStatusWithFixture = buildDirectRuntimeStatus({
  project: { surfaceBinding: { codex: { runtimeMode: "direct-experimental" } } },
  authStatus: { status: "authenticated", storageMode: "file" },
  authSettings: { storageMode: "file" },
  profileDoc,
  fixtureRuntime: { available: true, capabilities: buildDirectFixtureCapabilities() },
});
assert(directRuntimeStatusWithFixture.directRuntime.turnRunnable === false, "Fixture path must not imply live direct turns are runnable.");
assert(directRuntimeStatusWithFixture.fixtureRuntime.turnRunnable === true, "Expected fixture-only turn path to be separately exposed.");
assert(directRuntimeStatusWithFixture.fixtureRuntime.liveBackend === false, "Fixture runtime must be labeled as non-live.");
const memoryDirectRuntimeStatus = buildDirectRuntimeStatus({
  project: { surfaceBinding: { codex: { runtimeMode: "direct-experimental" } } },
  authStatus: { status: "unauthenticated", storageMode: "memory" },
  authSettings: { storageMode: "memory" },
  profileDoc,
});
assert(memoryDirectRuntimeStatus.auth.capability.storage === "ephemeral-memory", "Expected memory auth storage to be labeled separately.");

const sessionStoreParent = fs.mkdtempSync(path.join(os.tmpdir(), "direct-codex-session-store-"));
try {
  const sessionStore = new DirectSessionStore({ rootDir: path.join(sessionStoreParent, "direct-sessions") });
  const session = sessionStore.createSession({
    sessionId: "session_fixture",
    projectId: "project_fixture",
    workspace: { kind: "local", localPath: "[REDACTED:private-path]" },
    title: "Fixture direct session",
    model: "gpt-5.4",
    profileSnapshotId: profileDoc.profile.profileId,
  }, { nowMs: 1_700_000_000_000 });
  const turn = sessionStore.createTurn(session.sessionId, {
    turnId: "turn_fixture",
    input: [{ role: "user", text: "hello" }],
  }, { nowMs: 1_700_000_001_000 });
  sessionStore.appendNormalizedEvent(session.sessionId, turn.turnId, {
    type: "message_delta",
    sequence: 0,
    text: "ok",
  }, { nowMs: 1_700_000_002_000 });
  const completedTurn = sessionStore.updateTurnState(session.sessionId, turn.turnId, "completed", {}, { nowMs: 1_700_000_003_000 });
  assert(completedTurn.state === "completed", "Expected direct turn to transition to completed.");
  sessionStore.writeDiagnostic(session.sessionId, "fixture_diag", {
    message: "redacted diagnostic",
    accountId: "[REDACTED:account-id]",
  }, { nowMs: 1_700_000_004_000 });
  const storeStatus = sessionStore.status();
  assert(storeStatus.available === true, "Expected direct session store to report available.");
  assert(storeStatus.rootExposed === false, "Direct session store status must not expose root paths.");
  assert(storeStatus.sessionCount === 1, "Expected one direct session in store status.");
  assert(storeStatus.turnCount === 1, "Expected one direct turn in store status.");
  assert(storeStatus.eventCount === 1, "Expected one normalized event in store status.");
  const runtimeStatusWithStore = buildDirectRuntimeStatus({
    project: { surfaceBinding: { codex: { runtimeMode: "direct-experimental" } } },
    profileDoc,
    sessionStore: storeStatus,
  });
  assert(runtimeStatusWithStore.threads.canPersist === true, "Expected runtime status to expose direct session persistence.");
  assert(runtimeStatusWithStore.directRuntime.turnRunnable === false, "Session store availability must not imply runnable turns.");
  assert(runtimeStatusWithStore.sessionStore.rootExposed === false, "Runtime status must not expose direct session store paths.");
  fs.unlinkSync(sessionStore.indexPath());
  const statusAfterMissingIndex = sessionStore.status();
  assert(statusAfterMissingIndex.sessionCount === 1, "Expected status to recover a missing session index from session files.");
  const recovered = sessionStore.recoverIndex({ write: true });
  assert(recovered.recovery.recoveredSessionCount === 1, "Expected session index recovery from session files.");

  const interruptedSession = sessionStore.createSession({
    sessionId: "session_interrupted",
    projectId: "project_fixture",
    workspace: { kind: "local", localPath: "[REDACTED:private-path]" },
    title: "Interrupted direct session",
    model: "gpt-5.4",
    profileSnapshotId: profileDoc.profile.profileId,
  }, { nowMs: 1_700_000_005_000 });
  const interruptedTurn = sessionStore.createTurn(interruptedSession.sessionId, {
    turnId: "turn_streaming_interrupted",
    input: [{ role: "user", text: "stream then restart" }],
  }, { nowMs: 1_700_000_006_000 });
  sessionStore.updateTurnState(interruptedSession.sessionId, interruptedTurn.turnId, "request_built", {}, { nowMs: 1_700_000_007_000 });
  sessionStore.updateTurnState(interruptedSession.sessionId, interruptedTurn.turnId, "streaming", {}, { nowMs: 1_700_000_008_000 });
  const staleSummarySession = sessionStore.createSession({
    sessionId: "session_stale_summary",
    projectId: "project_fixture",
    workspace: { kind: "local", localPath: "[REDACTED:private-path]" },
    title: "Stale summary direct session",
    model: "gpt-5.4",
    profileSnapshotId: profileDoc.profile.profileId,
  }, { nowMs: 1_700_000_010_000 });
  const staleSummaryTurn = sessionStore.createTurn(staleSummarySession.sessionId, {
    turnId: "turn_stale_summary",
    input: [{ role: "user", text: "crash between turn and session writes" }],
  }, { nowMs: 1_700_000_011_000 });
  sessionStore.writeTurn({
    ...staleSummaryTurn,
    state: "streaming",
    updatedAt: "2023-11-14T22:13:32.000Z",
    streamStartedAt: "2023-11-14T22:13:32.000Z",
  });
  const activeSession = sessionStore.createSession({
    sessionId: "session_multiple_active",
    projectId: "project_fixture",
    workspace: { kind: "local", localPath: "[REDACTED:private-path]" },
    title: "Multiple active direct session",
    model: "gpt-5.4",
    profileSnapshotId: profileDoc.profile.profileId,
  }, { nowMs: 1_700_000_012_000 });
  sessionStore.createTurn(activeSession.sessionId, {
    turnId: "turn_active_one",
    state: "request_built",
    input: [{ role: "user", text: "active one" }],
  }, { nowMs: 1_700_000_013_000 });
  sessionStore.createTurn(activeSession.sessionId, {
    turnId: "turn_active_two",
    state: "streaming",
    input: [{ role: "user", text: "active two" }],
  }, { nowMs: 1_700_000_014_000 });
  const activeStatus = sessionStore.status();
  assert(activeStatus.activeTurnCount === 3, "Expected status to count active turns across all session turns.");
  const reloadedSessionStore = new DirectSessionStore({ rootDir: path.join(sessionStoreParent, "direct-sessions") });
  const interruptedRecovery = reloadedSessionStore.recoverInterruptedTurns({ nowMs: 1_700_000_015_000 });
  assert(interruptedRecovery.recoveredTurnCount === 4, "Expected interrupted active turns to recover on explicit reload maintenance.");
  const recoveredTurn = reloadedSessionStore.readTurn(interruptedSession.sessionId, interruptedTurn.turnId);
  assert(recoveredTurn.state === "failed", "Expected interrupted streaming turn to reload as failed.");
  assert(recoveredTurn.error.code === "restart_interrupted_turn", "Expected interrupted turn recovery error code.");
  const recoveredStaleSummaryTurn = reloadedSessionStore.readTurn(staleSummarySession.sessionId, staleSummaryTurn.turnId);
  assert(recoveredStaleSummaryTurn.state === "failed", "Expected stale-summary active turn file to recover as failed.");
  const postRecoveryStatus = reloadedSessionStore.status();
  assert(postRecoveryStatus.activeTurnCount === 0, "Expected status to remain read-only and report no active turns after explicit recovery.");

  const incrementalSession = sessionStore.createSession({
    sessionId: "session_incremental_tool",
    projectId: "project_fixture",
    workspace: { kind: "local", localPath: "[REDACTED:private-path]" },
    title: "Incremental tool obligation session",
    model: "gpt-5.4",
    profileSnapshotId: profileDoc.profile.profileId,
  }, { nowMs: 1_700_000_016_000 });
  const incrementalTurn = sessionStore.createTurn(incrementalSession.sessionId, {
    turnId: "turn_incremental_tool",
    input: [{ role: "user", text: "incremental tool" }],
  }, { nowMs: 1_700_000_017_000 });
  sessionStore.addToolObligations(incrementalSession.sessionId, incrementalTurn.turnId, [
    { type: "tool_call_started", sequence: 0, itemId: "tool_incremental", callId: "call_incremental", name: "read_file", toolType: "function_call" },
    { type: "tool_call_delta", sequence: 1, itemId: "tool_incremental", callId: "call_incremental", argumentsDelta: "{\"path\"" },
  ], { nowMs: 1_700_000_018_000 });
  const incrementalResult = sessionStore.addToolObligations(incrementalSession.sessionId, incrementalTurn.turnId, [
    { type: "tool_call_delta", sequence: 2, itemId: "tool_incremental", callId: "call_incremental", argumentsDelta: ":\"README.md\"}" },
  ], { nowMs: 1_700_000_019_000 });
  assert(incrementalResult.obligations[0].argumentsText === "{\"path\":\"README.md\"}", "Expected incremental tool obligation updates to merge argument deltas.");
  const incrementalPersisted = sessionStore.readTurn(incrementalSession.sessionId, incrementalTurn.turnId);
  assert(incrementalPersisted.unresolvedObligations.length === 1, "Expected incremental tool obligation updates to preserve one stable obligation.");
} finally {
  fs.rmSync(sessionStoreParent, { recursive: true, force: true });
}

const fixtureControllerParent = fs.mkdtempSync(path.join(os.tmpdir(), "direct-codex-fixture-controller-"));
try {
  const sessionStore = new DirectSessionStore({ rootDir: path.join(fixtureControllerParent, "direct-sessions") });
  const controller = new DirectFixtureController({ sessionStore, profileDoc });
  const sentEvents = [];
  const fakeWebContents = {
    isDestroyed: () => false,
    send: (_channel, payload) => sentEvents.push(payload),
  };
  const surfaceSession = new DirectFixtureSurfaceSession(fakeWebContents, {
    controller,
    project: {
      id: "project_fixture_controller",
      name: "Fixture Controller Project",
      workspace: { kind: "local", localPath: "[REDACTED:private-path]" },
      surfaceBinding: { codex: { runtimeMode: "direct-experimental", model: "gpt-5.4" } },
    },
  });
  const connected = await surfaceSession.connect({
    transport: DIRECT_FIXTURE_SURFACE_TRANSPORT,
    runtime: DIRECT_FIXTURE_SURFACE_TRANSPORT,
    capabilities: buildDirectFixtureCapabilities(),
  });
  assert(connected.connected === true, "Expected fixture surface session to connect.");
  const initialized = await surfaceSession.request("initialize", {});
  assert(initialized.runtime === DIRECT_FIXTURE_SURFACE_TRANSPORT, "Expected direct fixture initialize result.");
  const account = await surfaceSession.request("account/read", {});
  assert(account.account.type === "chatgpt", "Expected fixture account to mimic ChatGPT auth state.");
  const started = await surfaceSession.request("thread/start", { model: "gpt-5.4" });
  assert(started.thread.id, "Expected fixture thread start to create a direct session.");
  const turnResult = await surfaceSession.request("turn/start", {
    threadId: started.thread.id,
    input: [{ type: "text", text: "fixture prompt", text_elements: [] }],
    model: "gpt-5.4",
  });
  assert(turnResult.turn.status === "completed", "Expected fixture turn to complete.");
  const persisted = sessionStore.readSession(started.thread.id);
  assert(persisted?.messages?.[0]?.items?.some((item) => item.type === "agentMessage"), "Expected fixture transcript to persist assistant output.");
  const fixtureStatus = sessionStore.status();
  assert(fixtureStatus.sessionCount === 1, "Expected fixture controller to persist one session.");
  assert(fixtureStatus.turnCount === 1, "Expected fixture controller to persist one turn.");
  assert(fixtureStatus.eventCount > 0, "Expected fixture controller to persist normalized events.");
  assert(sentEvents.some((event) => event.type === "rpc-notification" && event.method === "item/agentMessage/delta"), "Expected fixture controller to stream renderer notifications.");
  assert(sentEvents.some((event) => event.type === "rpc-notification" && event.method === "turn/completed"), "Expected fixture controller to emit turn completion.");

  const toolStore = new DirectSessionStore({ rootDir: path.join(fixtureControllerParent, "tool-direct-sessions") });
  const toolEvents = [];
  const toolSurface = new DirectFixtureSurfaceSession({
    isDestroyed: () => false,
    send: (_channel, payload) => toolEvents.push(payload),
  }, {
    controller: new DirectFixtureController({
      sessionStore: toolStore,
      profileDoc,
      fixturePath: path.join(NORMALIZED_FIXTURE_DIR, "tool-call-turn.json"),
    }),
    project: { id: "project_tool_fixture", name: "Tool Fixture", surfaceBinding: { codex: { runtimeMode: "direct-experimental" } } },
  });
  await toolSurface.connect({ transport: DIRECT_FIXTURE_SURFACE_TRANSPORT });
  const toolThread = await toolSurface.request("thread/start", {});
  const toolTurn = await toolSurface.request("turn/start", {
    threadId: toolThread.thread.id,
    input: [{ type: "text", text: "tool prompt", text_elements: [] }],
  });
  assert(toolTurn.turn.status === "tool_waiting", "Expected fixture tool calls to pause without execution.");
  assert(toolTurn.turn.toolObligationCount === 1, "Expected fixture tool call to create one local obligation.");
  assert(toolSurface.hasServerRequest() === false, "Fixture tool detection must not create executable server requests.");
  const toolPersisted = toolStore.readSession(toolThread.thread.id);
  assert(toolPersisted.unresolvedObligations.length === 1, "Expected tool obligation to persist on the direct session.");
  assert(toolPersisted.unresolvedObligations[0].sideEffectExecuted === false, "Tool detection must not execute side effects.");
  assert(toolPersisted.messages[0].items.some((item) => item.type === "dynamicToolCall" && item.status === "waiting"), "Expected transcript to retain detected tool call.");
  const toolPersistedTurn = toolStore.readTurn(toolThread.thread.id, toolTurn.turn.id);
  assert(toolPersistedTurn.state === "tool_waiting", "Expected fixture tool turn to persist tool_waiting state.");
  assert(toolPersistedTurn.unresolvedObligations[0].executionAllowed === false, "Tool obligation must deny execution in detection-only phase.");
  assert(toolEvents.some((event) => event.type === "rpc-notification" && event.method === "warning"), "Expected fixture tool detection to emit a warning.");
  const toolStoreStatus = toolStore.status();
  assert(toolStoreStatus.unresolvedObligationCount === 1, "Expected session store status to count unresolved tool obligations.");
  const toolRuntimeStatus = buildDirectRuntimeStatus({
    project: { surfaceBinding: { codex: { runtimeMode: "direct-experimental" } } },
    profileDoc,
    sessionStore: toolStoreStatus,
  });
  assert(toolRuntimeStatus.toolDetection.status === "detect_only", "Expected runtime status to label tool detection as detect-only.");
  assert(toolRuntimeStatus.toolDetection.detectedObligationCount === 1, "Expected runtime status to project detected tool obligations.");
  assert(toolRuntimeStatus.toolDetection.executionEnabled === false, "Expected runtime status to keep tool execution disabled.");

  const reasoningFixturePath = path.join(fixtureControllerParent, "reasoning-multi.json");
  fs.writeFileSync(reasoningFixturePath, JSON.stringify({
    events: [
      { type: "reasoning_delta", itemId: "reasoning_fixture", text: "first " },
      { type: "reasoning_delta", itemId: "reasoning_fixture", text: "second" },
      { type: "response_completed", responseId: "resp_reasoning_fixture", stopReason: "completed" },
    ],
  }), "utf8");
  const reasoningStore = new DirectSessionStore({ rootDir: path.join(fixtureControllerParent, "reasoning-direct-sessions") });
  const reasoningEvents = [];
  const reasoningSurface = new DirectFixtureSurfaceSession({
    isDestroyed: () => false,
    send: (_channel, payload) => reasoningEvents.push(payload),
  }, {
    controller: new DirectFixtureController({ sessionStore: reasoningStore, profileDoc, fixturePath: reasoningFixturePath }),
    project: { id: "project_reasoning_fixture", name: "Reasoning Fixture", surfaceBinding: { codex: { runtimeMode: "direct-experimental" } } },
  });
  await reasoningSurface.connect({ transport: DIRECT_FIXTURE_SURFACE_TRANSPORT });
  const reasoningThread = await reasoningSurface.request("thread/start", {});
  await reasoningSurface.request("turn/start", {
    threadId: reasoningThread.thread.id,
    input: [{ type: "text", text: "reasoning prompt", text_elements: [] }],
  });
  const reasoningPersisted = reasoningStore.readSession(reasoningThread.thread.id);
  const reasoningItem = reasoningPersisted.messages[0].items.find((item) => item.id === "reasoning_fixture");
  assert(reasoningItem?.text === "first second", "Expected reasoning deltas to be accumulated and persisted.");
  const reasoningStarts = reasoningEvents.filter((event) => event.type === "rpc-notification" && event.method === "item/started" && event.params?.item?.id === "reasoning_fixture");
  const reasoningDeltas = reasoningEvents.filter((event) => event.type === "rpc-notification" && event.method === "item/agentMessage/delta" && event.params?.itemId === "reasoning_fixture");
  assert(reasoningStarts.length === 1, "Expected reasoning item to start once.");
  assert(reasoningDeltas.length === 2, "Expected reasoning deltas to stream as deltas.");

  const failureStore = new DirectSessionStore({ rootDir: path.join(fixtureControllerParent, "failure-direct-sessions") });
  const failureSurface = new DirectFixtureSurfaceSession({
    isDestroyed: () => false,
    send: () => {},
  }, {
    controller: new DirectFixtureController({
      sessionStore: failureStore,
      profileDoc,
      fixturePath: path.join(NORMALIZED_FIXTURE_DIR, "failure-cases.json"),
    }),
    project: { id: "project_failure_fixture", name: "Failure Fixture", surfaceBinding: { codex: { runtimeMode: "direct-experimental" } } },
  });
  await failureSurface.connect({ transport: DIRECT_FIXTURE_SURFACE_TRANSPORT });
  const failureThread = await failureSurface.request("thread/start", {});
  const failureTurn = await failureSurface.request("turn/start", {
    threadId: failureThread.thread.id,
    input: [{ type: "text", text: "failure prompt", text_elements: [] }],
  });
  assert(failureTurn.turn.status === "failed", "Expected failure fixture turn to fail.");
  const failurePersisted = failureStore.readSession(failureThread.thread.id);
  assert(failurePersisted.messages[0].status === "failed", "Expected failed fixture turn transcript to be persisted.");
  assert(failurePersisted.messages[0].items.some((item) => item.type === "userMessage"), "Expected failed fixture transcript to retain the user prompt.");
} finally {
  fs.rmSync(fixtureControllerParent, { recursive: true, force: true });
}

const secretFixture = {
  headers: {
    authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhY2N0XzEyMyJ9.signature123456789",
    cookie: "oai-did=private-cookie",
  },
  auth_code: "code_very_private_authorization_code",
  account_id: "acct_private_account",
  cwd: "/home/rose/work/private-project",
};
const redacted = redactFixture(secretFixture);
assertFixtureRedacted(redacted);
const keyScopedSecrets = {
  access_token: "short-secret",
  headers: { cookie: "session=short-secret" },
};
const secretFindings = scanFixtureForSecrets(keyScopedSecrets);
assert(secretFindings.some((finding) => finding.includes("access_token")), "Expected access_token key finding.");
assert(secretFindings.some((finding) => finding.includes("headers.cookie")), "Expected headers.cookie key finding.");
assertThrows(() => assertFixtureRedacted(keyScopedSecrets), "Expected key-scoped secrets to fail redaction checks.");

const authStoreParent = fs.mkdtempSync(path.join(os.tmpdir(), "direct-codex-auth-store-"));
const authStoreRoot = path.join(authStoreParent, "direct-auth");
try {
  const nowMs = 1_700_000_000_000;
  const expiresAt = nowMs + 3_600_000;
  const credentials = {
    accessToken: "fixture-access-token-secret",
    refreshToken: "fixture-refresh-token-secret",
    idToken: "fixture-id-token-secret",
    accountId: "acct_fixture_secret",
    expiresAt,
    tokenType: "Bearer",
    scope: "openid profile email offline_access",
  };
  const fileStore = createDirectAuthStore({ mode: "file", rootDir: authStoreRoot });
  const status = fileStore.writeCredentials(credentials, { nowMs });
  assert(status.status === "authenticated", "Expected file auth store to project authenticated status.");
  assert(status.accountId === "[REDACTED:account-id]", "Expected file auth status to redact account id.");
  assert(status.hasAccessToken && status.hasRefreshToken && status.hasIdToken, "Expected auth status token presence flags.");
  assert(status.rawTokensExposed === false, "Expected auth status to deny raw token exposure.");
  assertFixtureRedacted(status);
  assert(!JSON.stringify(status).includes("fixture-access-token-secret"), "Auth status must not expose access token.");
  assert(!JSON.stringify(status).includes(authStoreRoot), "Auth status must not expose private store paths.");

  const authFilePath = path.join(authStoreRoot, DEFAULT_DIRECT_AUTH_FILE_NAME);
  const rawAuthFile = fs.readFileSync(authFilePath, "utf8");
  assert(rawAuthFile.includes("fixture-refresh-token-secret"), "Private auth file should persist refresh token.");
  if (process.platform !== "win32") {
    const directoryMode = fs.statSync(authStoreRoot).mode & 0o777;
    const fileMode = fs.statSync(authFilePath).mode & 0o777;
    if (canReadBackMode(authStoreRoot, 0o700)) {
      nodeAssert.equal(directoryMode, 0o700, "Auth store directory must be user-only.");
    }
    if (canReadBackMode(authFilePath, 0o600)) {
      nodeAssert.equal(fileMode, 0o600, "Auth store file must be user-only.");
    }
  }

  const renameFailureRoot = path.join(authStoreParent, "rename-failure");
  const renameFailureStore = createDirectAuthStore({ mode: "file", rootDir: renameFailureRoot });
  const originalRenameSync = fs.renameSync;
  fs.renameSync = () => {
    throw Object.assign(new Error("Synthetic auth store rename failure."), { code: "EXDEV" });
  };
  try {
    assertThrows(
      () => renameFailureStore.writeCredentials(credentials, { nowMs }),
      "Expected synthetic rename failure to abort auth credential write.",
    );
  } finally {
    fs.renameSync = originalRenameSync;
  }
  const renameFailureTmpFiles = fs.existsSync(renameFailureRoot)
    ? fs.readdirSync(renameFailureRoot).filter((fileName) => fileName.endsWith(".tmp"))
    : [];
  nodeAssert.deepStrictEqual(renameFailureTmpFiles, [], "Expected failed auth writes to clean up temp files.");

  const reloadedStore = createDirectAuthStore({ mode: "file", rootDir: authStoreRoot });
  nodeAssert.equal(reloadedStore.readCredentials().accessToken, "fixture-access-token-secret");
  nodeAssert.equal(reloadedStore.readStatus({ nowMs: expiresAt + 1 }).status, "expired");
  const refreshedStatus = reloadedStore.writeCredentials({
    access_token: "fixture-refreshed-access-token-secret",
    expires_in: 7_200,
    token_type: "Bearer",
    scope: "openid profile email offline_access",
  }, { nowMs: expiresAt + 1 });
  assert(refreshedStatus.status === "authenticated", "Expected refreshed credentials to project authenticated status.");
  assert(refreshedStatus.hasRefreshToken, "Expected partial refresh write to preserve refresh token status.");
  assert(refreshedStatus.accountId === "[REDACTED:account-id]", "Expected partial refresh write to preserve account id.");
  assertFixtureRedacted(refreshedStatus);
  const refreshedCredentials = reloadedStore.readCredentials();
  nodeAssert.equal(refreshedCredentials.accessToken, "fixture-refreshed-access-token-secret");
  nodeAssert.equal(refreshedCredentials.refreshToken, "fixture-refresh-token-secret");
  nodeAssert.equal(refreshedCredentials.accountId, "acct_fixture_secret");
  nodeAssert.equal(refreshedCredentials.expiresAt, expiresAt + 1 + 7_200_000);
  const refreshFailed = reloadedStore.markRefreshFailed({
    error: "server_error",
    errorDescription: "Synthetic transient refresh failure.",
    retryable: true,
  }, { nowMs: expiresAt + 1 });
  assert(refreshFailed.status === "refresh_failed", "Expected refresh failure status.");
  assert(refreshFailed.hasRefreshToken && refreshFailed.preservesRefreshToken, "Expected refresh failure to preserve refresh token.");
  assertFixtureRedacted(refreshFailed);

  const memoryStore = createDirectAuthStore({ mode: "memory" });
  memoryStore.writeCredentials(credentials, { nowMs });
  assert(memoryStore.readStatus({ nowMs }).status === "authenticated", "Expected memory auth store to project status.");
  let refreshCalls = 0;
  const refreshOne = memoryStore.runWithRefreshLock(async () => {
    refreshCalls += 1;
    assert(memoryStore.readStatus({ nowMs }).refreshLockActive === true, "Expected refresh lock to project active status.");
    await Promise.resolve();
    return "refresh-result";
  });
  const refreshTwo = memoryStore.runWithRefreshLock(async () => {
    refreshCalls += 1;
    return "unexpected-second-refresh";
  });
  nodeAssert.equal(await refreshOne, "refresh-result");
  nodeAssert.equal(await refreshTwo, "refresh-result");
  nodeAssert.equal(refreshCalls, 1, "Expected concurrent refresh attempts to share one lock.");
  assert(memoryStore.readStatus({ nowMs }).refreshLockActive === false, "Expected refresh lock to clear after refresh.");
  assert(memoryStore.logout({ nowMs }).removed === true, "Expected memory logout to remove credentials.");
  assert(memoryStore.readStatus({ nowMs }).status === "unauthenticated", "Expected memory logout status.");
  assert(reloadedStore.logout({ nowMs }).removed === true, "Expected file logout to delete credentials.");
  assert(!fs.existsSync(authFilePath), "Expected file auth logout to delete auth file.");

  fs.mkdirSync(authStoreRoot, { recursive: true });
  fs.writeFileSync(authFilePath, "{not-json", "utf8");
  const corruptStore = createDirectAuthStore({ mode: "file", rootDir: authStoreRoot });
  nodeAssert.equal(corruptStore.readCredentials(), null);
  nodeAssert.equal(corruptStore.readStatus({ nowMs }).status, "unauthenticated");

  fs.writeFileSync(authFilePath, JSON.stringify({
    schema: "direct_codex_auth_store@future",
    accessToken: "fixture-future-access-token-secret",
  }), "utf8");
  const futureSchemaStore = createDirectAuthStore({ mode: "file", rootDir: authStoreRoot });
  nodeAssert.equal(futureSchemaStore.readCredentials(), null);
  const futureSchemaStatus = futureSchemaStore.readStatus({ nowMs });
  nodeAssert.equal(futureSchemaStatus.status, "unauthenticated");
  assertFixtureRedacted(futureSchemaStatus);

  const authIpcRoot = path.join(authStoreParent, "auth-ipc");
  const authIpcController = createDirectAuthIpcController({ rootDir: authIpcRoot });
  const initialIpcSettings = authIpcController.readSettings({ nowMs });
  nodeAssert.equal(initialIpcSettings.storageMode, "file");
  nodeAssert.equal(initialIpcSettings.authStatus.status, "unauthenticated");
  nodeAssert.equal(initialIpcSettings.storagePathExposed, false);
  nodeAssert.equal(initialIpcSettings.rawTokensExposed, false);
  assertFixtureRedacted(initialIpcSettings);
  assert(!JSON.stringify(initialIpcSettings).includes(authIpcRoot), "Direct auth settings must not expose store paths.");

  const ipcFileStatus = authIpcController.writeCredentials(credentials, { nowMs });
  nodeAssert.equal(ipcFileStatus.status, "authenticated");
  const setMemoryResult = authIpcController.setStorageMode("memory", { nowMs });
  nodeAssert.equal(setMemoryResult.authStatus.status, "unauthenticated");
  nodeAssert.equal(setMemoryResult.settings.storageMode, "memory");
  authIpcController.writeCredentials({
    accessToken: "fixture-memory-access-token-secret",
    refreshToken: "fixture-memory-refresh-token-secret",
    expiresAt,
  }, { nowMs });
  nodeAssert.equal(authIpcController.readStatus({ nowMs }).storageMode, "memory");
  nodeAssert.equal(authIpcController.readStatus({ nowMs }).status, "authenticated");
  const setFileResult = authIpcController.setStorageMode("file", { nowMs });
  nodeAssert.equal(setFileResult.authStatus.status, "authenticated");
  nodeAssert.equal(setFileResult.settings.storageMode, "file");

  const loginResult = await authIpcController.beginLogin({ nowMs });
  nodeAssert.equal(loginResult.ok, false);
  nodeAssert.equal(loginResult.status, "not_implemented");
  nodeAssert.equal(loginResult.reason, "live_oauth_not_implemented");
  assertFixtureRedacted(loginResult);

  const missingClientController = createDirectAuthIpcController({
    rootDir: path.join(authStoreParent, "auth-login-missing-client"),
    loginStarter: (payload, controller) => createDirectAuthLoginCoordinator({
      clientId: "",
      openExternal: () => {},
    }).beginLogin(payload, controller),
  });
  const missingClientResult = await missingClientController.beginLogin({ nowMs });
  nodeAssert.equal(missingClientResult.ok, false);
  nodeAssert.equal(missingClientResult.status, "not_configured");
  nodeAssert.equal(missingClientResult.reason, "missing_client_id");
  assertFixtureRedacted(missingClientResult);

  const loginRoot = path.join(authStoreParent, "auth-login");
  const loginController = createDirectAuthIpcController({ rootDir: loginRoot });
  let openedAuthUrl = "";
  let tokenRequest = null;
  const loginCoordinator = createDirectAuthLoginCoordinator({
    clientId: "codex-desktop-fixture-client",
    callbackPort: 0,
    callbackTimeoutMs: 5_000,
    openExternal: async (url) => {
      openedAuthUrl = url;
    },
    tokenClient: async (request) => {
      tokenRequest = request;
      return {
        access_token: syntheticJwt({
          "https://api.openai.com/auth": { chatgpt_account_id: "acct_login_fixture_secret" },
        }),
        refresh_token: "fixture-login-refresh-token-secret",
        id_token: "fixture-login-id-token-secret",
        token_type: "Bearer",
        expires_in: 3_600,
        scope: "openid profile email offline_access",
      };
    },
  });
  nodeAssert.equal(loginCoordinator.callbackPort, 0);
  const liveLogin = loginCoordinator.beginLogin({ nowMs }, loginController);
  await waitForCondition(() => openedAuthUrl, "Expected auth coordinator to open an authorization URL.");
  const authorizationUrl = new URL(openedAuthUrl);
  const redirectUri = authorizationUrl.searchParams.get("redirect_uri");
  const state = authorizationUrl.searchParams.get("state");
  assert(redirectUri, "Expected authorization URL to include redirect_uri.");
  assert(state, "Expected authorization URL to include state.");
  const callbackResponse = await fetch(`${redirectUri}?code=fixture-login-code-secret&state=${encodeURIComponent(state)}`);
  nodeAssert.equal(callbackResponse.status, 200);
  const liveLoginResult = await liveLogin;
  nodeAssert.equal(liveLoginResult.ok, true);
  nodeAssert.equal(liveLoginResult.status, "authenticated");
  assertFixtureRedacted(liveLoginResult);
  nodeAssert.equal(tokenRequest.body.client_id, "codex-desktop-fixture-client");
  nodeAssert.equal(tokenRequest.body.code, "fixture-login-code-secret");
  assert(tokenRequest.body.code_verifier.length >= 43, "Expected token request to carry PKCE verifier.");
  nodeAssert.equal(tokenRequest.body.redirect_uri, redirectUri);
  const loginStatus = loginController.readStatus({ nowMs });
  nodeAssert.equal(loginStatus.status, "authenticated");
  nodeAssert.equal(loginStatus.accountId, "[REDACTED:account-id]");
  assertFixtureRedacted(loginStatus);
  const loginCredentials = loginController.activeStore().readCredentials();
  nodeAssert.equal(loginCredentials.refreshToken, "fixture-login-refresh-token-secret");
  nodeAssert.equal(loginCredentials.accountId, "acct_login_fixture_secret");
  nodeAssert.equal(loginCredentials.expiresAt, nowMs + 3_600_000);
  const appServerLoginTokens = codexAuthTokensFromCredentials(loginCredentials);
  nodeAssert.equal(appServerLoginTokens.ok, true);
  nodeAssert.equal(appServerLoginTokens.tokens.type, "chatgptAuthTokens");
  nodeAssert.equal(appServerLoginTokens.tokens.chatgptAccountId, "acct_login_fixture_secret");
  assert(!JSON.stringify(appServerLoginTokens).includes("fixture-login-refresh-token-secret"), "App-server auth bridge must not expose refresh token.");
  assert(!JSON.stringify(liveLoginResult).includes("fixture-login-code-secret"), "Login result must not expose auth code.");
  assert(!JSON.stringify(liveLoginResult).includes("fixture-login-refresh-token-secret"), "Login result must not expose refresh token.");

  const occupiedCallbackServer = http.createServer((_request, response) => {
    response.writeHead(409, { "content-type": "text/plain; charset=utf-8" });
    response.end("occupied");
  });
  await listenHttp(occupiedCallbackServer);
  try {
    const occupiedAddress = occupiedCallbackServer.address();
    const manualRoot = path.join(authStoreParent, "auth-login-manual-fallback");
    const manualController = createDirectAuthIpcController({ rootDir: manualRoot });
    let manualAuthUrl = "";
    let manualTokenRequest = null;
    const manualCoordinator = createDirectAuthLoginCoordinator({
      clientId: "codex-desktop-fixture-client",
      callbackPort: occupiedAddress.port,
      callbackTimeoutMs: 5_000,
      openExternal: async (url) => {
        manualAuthUrl = url;
      },
      tokenClient: async (request) => {
        manualTokenRequest = request;
        return {
          access_token: syntheticJwt({
            "https://api.openai.com/auth": { chatgpt_account_id: "acct_manual_fixture_secret" },
          }),
          refresh_token: "fixture-manual-refresh-token-secret",
          token_type: "Bearer",
          expires_in: 3_600,
        };
      },
    });
    const manualStartResult = await manualCoordinator.beginLogin({ nowMs }, manualController);
    nodeAssert.equal(manualStartResult.ok, false);
    nodeAssert.equal(manualStartResult.status, "manual_code_required");
    nodeAssert.equal(manualStartResult.reason, "callback_port_unavailable");
    assert(manualStartResult.loginId, "Expected manual fallback to return a login id.");
    assert(manualAuthUrl.includes("redirect_uri="), "Expected manual fallback to open an authorization URL.");
    const manualState = new URL(manualAuthUrl).searchParams.get("state");
    const manualCompleteResult = await manualCoordinator.completeManualLogin({
      loginId: manualStartResult.loginId,
      input: `?code=fixture-manual-code-secret&state=${encodeURIComponent(manualState)}`,
      nowMs,
    }, manualController);
    nodeAssert.equal(manualCompleteResult.ok, true);
    nodeAssert.equal(manualCompleteResult.status, "authenticated");
    nodeAssert.equal(manualTokenRequest.body.code, "fixture-manual-code-secret");
    nodeAssert.equal(manualTokenRequest.body.redirect_uri, "http://localhost:1455/auth/callback");
    assertFixtureRedacted(manualCompleteResult);
  } finally {
    await closeHttp(occupiedCallbackServer);
  }

  const incompleteController = createDirectAuthIpcController({ rootDir: path.join(authStoreParent, "auth-login-incomplete") });
  const incompleteCoordinator = createDirectAuthLoginCoordinator({
    clientId: "codex-desktop-fixture-client",
    tokenClient: async () => ({ token_type: "Bearer" }),
  });
  const incompleteFlow = incompleteCoordinator.buildFlow({
    redirectUri: "http://localhost:0/auth/callback",
    pkceVerifier: "fixture-pkce-verifier-for-incomplete-token-response",
    state: "fixture-state",
  });
  incompleteFlow.authorizationCode = "fixture-incomplete-code";
  const incompleteResult = await incompleteCoordinator.exchangeAndStore(incompleteFlow, incompleteController, { nowMs });
  nodeAssert.equal(incompleteResult.ok, false);
  nodeAssert.equal(incompleteResult.status, "unauthenticated");
  nodeAssert.equal(incompleteResult.reason, "token_exchange_incomplete");
  assertFixtureRedacted(incompleteResult);

  const nonJsonTokenServer = http.createServer((_request, response) => {
    response.writeHead(500, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>proxy error</title>");
  });
  await listenHttp(nonJsonTokenServer);
  try {
    const nonJsonAddress = nonJsonTokenServer.address();
    const nonJsonController = createDirectAuthIpcController({ rootDir: path.join(authStoreParent, "auth-login-non-json") });
    const nonJsonCoordinator = createDirectAuthLoginCoordinator({
      clientId: "codex-desktop-fixture-client",
      tokenEndpoint: `http://127.0.0.1:${nonJsonAddress.port}/token`,
    });
    const nonJsonFlow = nonJsonCoordinator.buildFlow({
      redirectUri: "http://localhost:0/auth/callback",
      pkceVerifier: "fixture-pkce-verifier-for-non-json-token-response",
      state: "fixture-state",
    });
    nonJsonFlow.authorizationCode = "fixture-non-json-code";
    const nonJsonResult = await nonJsonCoordinator.exchangeAndStore(nonJsonFlow, nonJsonController, { nowMs });
    nodeAssert.equal(nonJsonResult.ok, false);
    nodeAssert.equal(nonJsonResult.status, "token_exchange_failed");
    nodeAssert.equal(nonJsonResult.reason, "http_500");
    assertFixtureRedacted(nonJsonResult);
  } finally {
    await closeHttp(nonJsonTokenServer);
  }

  const authEvents = [];
  const ipcHandlers = new Map();
  registerDirectAuthIpcHandlers(
    { handle: (channel, handler) => ipcHandlers.set(channel, handler) },
    () => authIpcController,
    { onStatusChange: (event) => authEvents.push(event) },
  );
  nodeAssert.equal(await ipcHandlers.get("direct-auth:status")({}, { nowMs }).then((status) => status.status), "authenticated");
  const ipcModeResult = await ipcHandlers.get("direct-auth:set-storage-mode")({}, { mode: "memory", nowMs });
  nodeAssert.equal(ipcModeResult.settings.storageMode, "memory");
  const ipcLoginResult = await ipcHandlers.get("direct-auth:login")({}, { nowMs });
  nodeAssert.equal(ipcLoginResult.reason, "live_oauth_not_implemented");
  const ipcLogoutResult = await ipcHandlers.get("direct-auth:logout")({}, { nowMs });
  nodeAssert.equal(ipcLogoutResult.authStatus.status, "unauthenticated");
  nodeAssert.equal(ipcLogoutResult.removedStorageModes.file, true);
  nodeAssert.equal(ipcLogoutResult.removedStorageModes.memory, true);
  assertFixtureRedacted(ipcLogoutResult);
  assert(authEvents.some((event) => event.action === "set-storage-mode"), "Expected direct auth IPC mode change event.");
  assert(authEvents.some((event) => event.action === "logout"), "Expected direct auth IPC logout event.");
  assert(authEvents.every((event) => event.status === null || isPlainObject(event.status)), "Expected auth IPC events to carry auth status objects.");
  assert(!fs.existsSync(path.join(authIpcRoot, DEFAULT_DIRECT_AUTH_FILE_NAME)), "Expected direct auth IPC logout to clear file credentials.");
} finally {
  fs.rmSync(authStoreParent, { recursive: true, force: true });
}

const sampleEvents = [
  { event: "response.created", data: { response: { id: "resp_1", model: "gpt-5.4" } } },
  { event: "response.output_text.delta", data: { item_id: "msg_1", delta: "hello" } },
  { event: "response.reasoning_summary_text.delta", data: { item_id: "rs_1", delta: "summary" } },
  {
    event: "response.output_item.added",
    data: { item: { id: "tool_1", type: "function_call", call_id: "call_1", name: "read_file" } },
  },
  {
    event: "response.function_call_arguments.delta",
    data: { item_id: "tool_1", call_id: "call_1", delta: "{\"path\"" },
  },
  {
    event: "response.output_item.done",
    data: {
      item: {
        id: "tool_1",
        type: "function_call",
        call_id: "call_1",
        name: "read_file",
        arguments: "{\"path\":\"README.md\"}",
      },
    },
  },
  {
    event: "response.completed",
    data: {
      response: {
        id: "resp_1",
        status: "completed",
        usage: {
          input_tokens: 7,
          output_tokens: 11,
          input_tokens_details: { cached_tokens: 3 },
          output_tokens_details: { reasoning_tokens: 5 },
        },
      },
    },
  },
];

const normalized = normalizeDirectCodexEvents(sampleEvents, { failOnUnknown: true });
const normalizedTypes = normalized.normalized.map((event) => event.type);
for (const required of [
  "session_started",
  "message_delta",
  "reasoning_delta",
  "tool_call_started",
  "tool_call_delta",
  "tool_call_completed",
  "usage_delta",
  "response_completed",
]) {
  assert(normalizedTypes.includes(required), `Missing normalized event type ${required}.`);
}

const sseEvents = parseSseFixtureText([
  "event: response.output_text.delta",
  "data: {\"item_id\":\"msg_2\",\"delta\":\"ok\"}",
  "",
  "data: [DONE]",
  "",
].join("\n"));
assert(sseEvents.length === 2, "Expected two parsed SSE frames.");
assert(sseEvents[0].event === "response.output_text.delta", "Expected SSE event type to be retained.");
const strictSseNormalized = normalizeDirectCodexEvents(sseEvents, { failOnUnknown: true });
assert(strictSseNormalized.normalized.length === 1, "Expected strict SSE normalization to ignore [DONE].");

const failedResponse = normalizeDirectCodexEvents([
  { event: "response.failed", data: { response: { id: "resp_failed", error: { code: "server_error", message: "failed" } } } },
]);
assert(failedResponse.normalized[0].type === "response_failed", "Expected response.failed to normalize as response_failed.");

function textResponse(text, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? "OK" : "Error",
    headers: {
      get: (name) => headers[String(name || "").toLowerCase()] || "",
    },
    text: async () => text,
  };
}

function asyncIteratorTextResponse(text, splitAt, status = 200, headers = {}) {
  const bytes = new TextEncoder().encode(text);
  const chunks = Number.isInteger(splitAt) && splitAt > 0 && splitAt < bytes.length
    ? [bytes.slice(0, splitAt), bytes.slice(splitAt)]
    : [bytes];
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? "OK" : "Error",
    headers: {
      get: (name) => headers[String(name || "").toLowerCase()] || "",
    },
    body: {
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) yield chunk;
      },
    },
  };
}

const textProbeRequest = buildTextOnlyProbeRequest({
  profileDoc,
  prompt: "probe prompt",
  model: "gpt-5.4",
});
assert(textProbeRequest.stream === true, "Expected direct text probe request to stream.");
assert(textProbeRequest.store === false, "Expected direct text probe request to disable backend storage.");
assert(!textProbeRequest.tools, "Text-only probe must not include tools.");

let capturedProbeRequest = null;
const probeSse = [
  "event: response.created",
  "data: {\"response\":{\"id\":\"resp_probe\",\"model\":\"gpt-5.4\"}}",
  "",
  "event: response.output_text.delta",
  "data: {\"item_id\":\"msg_probe\",\"delta\":\"direct text probe ok\"}",
  "",
  "event: response.completed",
  "data: {\"response\":{\"id\":\"resp_probe\",\"status\":\"completed\",\"usage\":{\"input_tokens\":4,\"output_tokens\":4,\"total_tokens\":8}}}",
  "",
  "data: [DONE]",
  "",
].join("\n");
const directTextProbe = await runTextOnlyDirectProbe({
  endpoint: DEFAULT_CODEX_RESPONSES_ENDPOINT,
  credentials: { accessToken: "probe_access_token_secret_1234567890" },
  profileDoc,
  model: "gpt-5.4",
  prompt: "probe prompt",
  fetchImpl: async (url, init) => {
    capturedProbeRequest = { url, init, body: JSON.parse(init.body) };
    return textResponse(probeSse, 200, { "content-type": "text/event-stream" });
  },
});
assert(directTextProbe.schema === DIRECT_TEXT_PROBE_RESULT_SCHEMA, "Expected direct text probe result schema.");
assert(directTextProbe.ok === true, "Expected mocked direct text probe to complete.");
assert(capturedProbeRequest.url === DEFAULT_CODEX_RESPONSES_ENDPOINT, "Expected direct text probe endpoint.");
assert(capturedProbeRequest.init.headers.Authorization.startsWith("Bearer "), "Expected direct text probe auth header.");
assert(capturedProbeRequest.body.stream === true && capturedProbeRequest.body.store === false, "Expected direct text probe body shape.");
assert(directTextProbe.normalizedEvents.some((event) => event.type === "message_delta"), "Expected text probe to normalize message deltas.");
assert(directTextProbe.rawAuthHeadersExposed === false, "Direct text probe must not expose raw auth headers.");
assertFixtureRedacted(directTextProbe.diagnostic);

const toolProbeSse = [
  "event: response.created",
  "data: {\"response\":{\"id\":\"resp_tool_probe\",\"model\":\"gpt-5.4\"}}",
  "",
  "event: response.output_item.added",
  "data: {\"item\":{\"id\":\"tool_probe\",\"type\":\"function_call\",\"call_id\":\"call_probe_read\",\"name\":\"read_file\"}}",
  "",
  "event: response.function_call_arguments.delta",
  "data: {\"item_id\":\"tool_probe\",\"call_id\":\"call_probe_read\",\"delta\":\"{\\\"path\\\"\"}",
  "",
  "event: response.function_call_arguments.delta",
  "data: {\"item_id\":\"tool_probe\",\"call_id\":\"call_probe_read\",\"delta\":\":\\\"README.md\\\"}\"}",
  "",
  "event: response.output_item.done",
  "data: {\"item\":{\"id\":\"tool_probe\",\"type\":\"function_call\",\"call_id\":\"call_probe_read\",\"name\":\"read_file\",\"arguments\":\"{\\\"path\\\":\\\"README.md\\\"}\"}}",
  "",
  "event: response.completed",
  "data: {\"response\":{\"id\":\"resp_tool_probe\",\"status\":\"completed\"}}",
  "",
].join("\n");
const directToolProbe = await runTextOnlyDirectProbe({
  endpoint: DEFAULT_CODEX_RESPONSES_ENDPOINT,
  credentials: { accessToken: "tool_probe_access_token_secret_1234567890" },
  profileDoc,
  model: "gpt-5.4",
  prompt: "tool probe prompt",
  fetchImpl: async () => textResponse(toolProbeSse, 200, { "content-type": "text/event-stream" }),
});
assert(directToolProbe.ok === false, "Expected direct text probe to pause rather than succeed when a tool call appears.");
assert(directToolProbe.terminal.state === "tool_waiting", "Expected direct text probe tool call to enter tool_waiting.");
assert(directToolProbe.toolDetection.detected === true, "Expected direct text probe to report tool detection.");
assert(directToolProbe.toolDetection.executionAllowed === false, "Expected direct text probe to deny tool execution.");
assertFixtureRedacted(directToolProbe.diagnostic);

const utf8ProbeSse = [
  "event: response.output_text.delta",
  `data: ${JSON.stringify({ item_id: "msg_utf8_probe", delta: "héllo direct" })}`,
  "",
  "event: response.completed",
  `data: ${JSON.stringify({ response: { id: "resp_utf8_probe", status: "completed" } })}`,
  "",
].join("\n");
const utf8ProbeBytes = new TextEncoder().encode(utf8ProbeSse);
const utf8SplitAt = utf8ProbeBytes.indexOf(0xc3) + 1;
assert(utf8SplitAt > 0, "Expected UTF-8 probe fixture to contain a multibyte split point.");
const utf8Probe = await runTextOnlyDirectProbe({
  endpoint: DEFAULT_CODEX_RESPONSES_ENDPOINT,
  credentials: { accessToken: "utf8_probe_access_token_secret_1234567890" },
  profileDoc,
  model: "gpt-5.4",
  prompt: "utf8 probe prompt",
  fetchImpl: async () => asyncIteratorTextResponse(utf8ProbeSse, utf8SplitAt, 200, { "content-type": "text/event-stream" }),
});
const utf8ProbeText = utf8Probe.normalizedEvents
  .filter((event) => event.type === "message_delta")
  .map((event) => event.text || "")
  .join("");
assert(utf8ProbeText === "héllo direct", "Expected async iterator response decoding to preserve split UTF-8 characters.");

const expiringAuthStore = createDirectAuthStore({ mode: "memory" });
expiringAuthStore.writeCredentials({
  accessToken: "expiring_probe_access_token_secret_1234567890",
  refreshToken: "expiring_probe_refresh_token_secret_1234567890",
  expiresAt: 1_700_000_030_000,
}, { nowMs: 1_700_000_000_000 });
let refreshBeforeProbeCalls = 0;
let refreshedAuthorization = "";
const refreshedProbe = await runTextOnlyDirectProbe({
  endpoint: DEFAULT_CODEX_RESPONSES_ENDPOINT,
  authStore: expiringAuthStore,
  nowMs: 1_700_000_000_000,
  refreshBeforeMs: 60_000,
  profileDoc,
  model: "gpt-5.4",
  prompt: "refresh probe prompt",
  refreshCredentials: async ({ authStore }) => {
    refreshBeforeProbeCalls += 1;
    authStore.writeCredentials({
      accessToken: "refreshed_probe_access_token_secret_1234567890",
      expiresIn: 3_600,
    }, { nowMs: 1_700_000_000_000 });
    return { ok: true, status: "authenticated" };
  },
  fetchImpl: async (_url, init) => {
    refreshedAuthorization = init.headers.Authorization;
    return textResponse(probeSse, 200, { "content-type": "text/event-stream" });
  },
});
assert(refreshedProbe.ok === true, "Expected pre-stream credential refresh probe to complete.");
assert(refreshBeforeProbeCalls === 1, "Expected expiring probe credentials to refresh exactly once before request.");
assert(refreshedAuthorization.includes("refreshed_probe_access_token_secret"), "Expected direct probe request to use refreshed access token.");
assert(refreshedProbe.lifecycle.credentialRefresh.attempted === true, "Expected lifecycle to record pre-stream credential refresh.");

let retryFetchCalls = 0;
const retriedProbe = await runTextOnlyDirectProbe({
  endpoint: DEFAULT_CODEX_RESPONSES_ENDPOINT,
  credentials: { accessToken: "retry_probe_access_token_secret_1234567890" },
  profileDoc,
  model: "gpt-5.4",
  prompt: "retry probe prompt",
  maxPreStreamRetries: 1,
  fetchImpl: async () => {
    retryFetchCalls += 1;
    if (retryFetchCalls === 1) throw Object.assign(new Error("synthetic pre-stream reset"), { code: "ECONNRESET" });
    return textResponse(probeSse, 200, { "content-type": "text/event-stream" });
  },
});
assert(retriedProbe.ok === true, "Expected pre-stream transient failure to retry and complete.");
assert(retryFetchCalls === 2, "Expected one pre-stream retry.");
assert(retriedProbe.lifecycle.attempts.length === 2, "Expected lifecycle to record both retry attempts.");
assert(retriedProbe.lifecycle.attempts[0].retry === true, "Expected first pre-stream attempt to be marked retryable.");

let genericFailureFetchCalls = 0;
const genericFailureProbe = await runTextOnlyDirectProbe({
  endpoint: DEFAULT_CODEX_RESPONSES_ENDPOINT,
  credentials: { accessToken: "generic_failure_access_token_secret_1234567890" },
  profileDoc,
  model: "gpt-5.4",
  prompt: "generic failure probe prompt",
  maxPreStreamRetries: 1,
  fetchImpl: async () => {
    genericFailureFetchCalls += 1;
    throw new Error("synthetic generic pre-stream failure");
  },
});
assert(genericFailureProbe.ok === false, "Expected generic pre-stream failure to fail the probe.");
assert(genericFailureFetchCalls === 1, "Expected generic pre-stream errors without known transient codes not to retry.");
assert(genericFailureProbe.lifecycle.attempts[0].retry === false, "Expected generic pre-stream failure to be marked non-retryable.");

let streamFailureFetchCalls = 0;
const streamFailedProbe = await runTextOnlyDirectProbe({
  endpoint: DEFAULT_CODEX_RESPONSES_ENDPOINT,
  credentials: { accessToken: "stream_failure_access_token_secret_1234567890" },
  profileDoc,
  model: "gpt-5.4",
  prompt: "stream failure probe prompt",
  maxPreStreamRetries: 1,
  fetchImpl: async () => {
    streamFailureFetchCalls += 1;
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => "text/event-stream" },
      text: async () => {
        throw Object.assign(new Error("synthetic stream read failure"), { code: "ECONNRESET" });
      },
    };
  },
});
assert(streamFailedProbe.ok === false, "Expected stream read failure to fail the probe.");
assert(streamFailureFetchCalls === 1, "Expected no retry after stream start.");
assert(streamFailedProbe.error.code === "stream_failed", "Expected stream read failure to be classified separately from fetch failure.");
assert(streamFailedProbe.lifecycle.streamStarted === true, "Expected lifecycle to record that stream had started.");

const textProbeParent = fs.mkdtempSync(path.join(os.tmpdir(), "direct-codex-text-probe-"));
try {
  const probeSessionStore = new DirectSessionStore({ rootDir: path.join(textProbeParent, "direct-sessions") });
  const persistedProbe = await runPersistedTextOnlyDirectProbe({
    endpoint: "https://chatgpt.com/backend-api/codex/responses",
    credentials: { accessToken: "persisted_probe_access_token_secret_1234567890" },
    profileDoc,
    model: "gpt-5.4",
    prompt: "persisted probe prompt",
    sessionStore: probeSessionStore,
    project: { id: "project_direct_text_probe", workspace: { kind: "local", localPath: "[REDACTED:private-path]" } },
    fetchImpl: async () => textResponse(probeSse, 200, { "content-type": "text/event-stream" }),
  });
  assert(persistedProbe.ok === true, "Expected persisted direct text probe to complete.");
  const persistedStatus = probeSessionStore.status();
  assert(persistedStatus.sessionCount === 1, "Expected direct text probe to persist a session.");
  assert(persistedStatus.turnCount === 1, "Expected direct text probe to persist a turn.");
  assert(persistedStatus.eventCount >= 3, "Expected direct text probe to persist normalized events.");
  const persistedSession = probeSessionStore.readSession(persistedProbe.sessionId);
  assert(persistedSession.messages[0].items.some((item) => item.type === "agentMessage"), "Expected direct text probe transcript to persist assistant output.");
  const persistedTurn = probeSessionStore.readTurn(persistedProbe.sessionId, persistedProbe.turnId);
  assert(persistedTurn.requestBuiltAt, "Expected persisted direct text probe to record request_built phase.");
  assert(persistedTurn.streamStartedAt, "Expected persisted direct text probe to record streaming phase.");
  assert(persistedTurn.requestShape.stream === true, "Expected persisted direct text probe to persist request shape.");

  const persistedToolProbe = await runPersistedTextOnlyDirectProbe({
    endpoint: "https://chatgpt.com/backend-api/codex/responses",
    credentials: { accessToken: "persisted_tool_probe_access_token_secret_1234567890" },
    profileDoc,
    model: "gpt-5.4",
    prompt: "persisted tool probe prompt",
    sessionStore: probeSessionStore,
    project: { id: "project_direct_text_probe", workspace: { kind: "local", localPath: "[REDACTED:private-path]" } },
    fetchImpl: async () => textResponse(toolProbeSse, 200, { "content-type": "text/event-stream" }),
  });
  assert(persistedToolProbe.ok === false, "Expected persisted direct tool probe to pause without succeeding.");
  assert(persistedToolProbe.turnState === "tool_waiting", "Expected persisted direct tool probe to persist tool_waiting state.");
  assert(persistedToolProbe.toolObligations.length === 1, "Expected persisted direct tool probe to return one tool obligation.");
  assert(persistedToolProbe.toolObligations[0].sideEffectExecuted === false, "Persisted direct tool probe must not execute side effects.");
  const persistedToolSession = probeSessionStore.readSession(persistedToolProbe.sessionId);
  assert(persistedToolSession.unresolvedObligations.length === 1, "Expected persisted direct tool obligation on session.");
  assert(persistedToolSession.messages[0].items.some((item) => item.type === "dynamicToolCall"), "Expected persisted direct tool transcript item.");
  const persistedToolTurn = probeSessionStore.readTurn(persistedToolProbe.sessionId, persistedToolProbe.turnId);
  assert(persistedToolTurn.unresolvedObligations[0].continuationAllowed === false, "Tool detection phase must deny continuation.");

  const declinedToolProbe = await runPersistedTextOnlyDirectProbe({
    endpoint: "https://chatgpt.com/backend-api/codex/responses",
    credentials: { accessToken: "declined_tool_probe_access_token_secret_1234567890" },
    profileDoc,
    model: "gpt-5.4",
    prompt: "declined tool probe prompt",
    sessionStore: probeSessionStore,
    project: { id: "project_direct_text_probe", workspace: { kind: "local", localPath: "[REDACTED:private-path]" } },
    fetchImpl: async () => textResponse(toolProbeSse, 200, { "content-type": "text/event-stream" }),
  });
  const declinedTool = declineReadOnlyToolObligation({
    sessionStore: probeSessionStore,
    sessionId: declinedToolProbe.sessionId,
    turnId: declinedToolProbe.turnId,
    obligationId: declinedToolProbe.toolObligations[0].obligationId,
    decidedBy: "smoke-test",
    reason: "Smoke test declined read-only access.",
    nowMs: 1_700_000_018_000,
  });
  assert(declinedTool.obligation.status === "declined", "Expected declined read-only tool to persist declined status.");
  assert(declinedTool.obligation.authorityDecision.schema === DIRECT_READONLY_TOOL_AUTHORITY_DECISION_SCHEMA, "Expected declined read-only tool to persist decision schema.");
  assert(declinedTool.obligation.executionAllowed === false, "Expected declined read-only tool not to allow execution.");
  assert(declinedTool.obligation.continuationAllowed === false, "Expected declined read-only tool not to allow continuation.");
  assert(declinedTool.obligation.sideEffectExecuted === false, "Expected declined read-only tool not to mark side effects.");
  const declinedTurn = probeSessionStore.readTurn(declinedToolProbe.sessionId, declinedToolProbe.turnId);
  assert(declinedTurn.state === "failed", "Expected declined read-only tool to put the turn in failed state.");
  assert(declinedTurn.error.code === "tool_obligation_declined", "Expected declined read-only tool to persist terminal error.");
  const declinedSession = probeSessionStore.readSession(declinedToolProbe.sessionId);
  const declinedToolItem = declinedSession.messages[0].items.find((item) => item.id === declinedToolProbe.toolObligations[0].obligationId);
  assert(declinedToolItem.status === "declined", "Expected declined tool transcript item status.");
  assert(declinedToolItem.result === "Smoke test declined read-only access.", "Expected declined tool transcript item to show decision reason.");
  await assertRejects(
    () => executeApprovedReadOnlyToolObligation({
      sessionStore: probeSessionStore,
      sessionId: declinedToolProbe.sessionId,
      turnId: declinedToolProbe.turnId,
      obligationId: declinedToolProbe.toolObligations[0].obligationId,
      workspaceRequest: async () => {
        throw new Error("unexpected declined read.");
      },
    }),
    "Expected declined read-only tool execution to be rejected.",
  );

  const canceledToolProbe = await runPersistedTextOnlyDirectProbe({
    endpoint: "https://chatgpt.com/backend-api/codex/responses",
    credentials: { accessToken: "canceled_tool_probe_access_token_secret_1234567890" },
    profileDoc,
    model: "gpt-5.4",
    prompt: "canceled tool probe prompt",
    sessionStore: probeSessionStore,
    project: { id: "project_direct_text_probe", workspace: { kind: "local", localPath: "[REDACTED:private-path]" } },
    fetchImpl: async () => textResponse(toolProbeSse, 200, { "content-type": "text/event-stream" }),
  });
  const canceledTool = cancelReadOnlyToolObligation({
    sessionStore: probeSessionStore,
    sessionId: canceledToolProbe.sessionId,
    turnId: canceledToolProbe.turnId,
    obligationId: canceledToolProbe.toolObligations[0].obligationId,
    decidedBy: "smoke-test",
    reason: "Smoke test canceled read-only access.",
    nowMs: 1_700_000_019_000,
  });
  assert(canceledTool.obligation.status === "canceled", "Expected canceled read-only tool to persist canceled status.");
  assert(canceledTool.obligation.authorityDecision.decision === "canceled", "Expected canceled read-only tool to persist canceled decision.");
  assert(canceledTool.obligation.executionAllowed === false, "Expected canceled read-only tool not to allow execution.");
  assert(canceledTool.obligation.continuationAllowed === false, "Expected canceled read-only tool not to allow continuation.");
  assert(canceledTool.obligation.sideEffectExecuted === false, "Expected canceled read-only tool not to mark side effects.");
  const canceledTurn = probeSessionStore.readTurn(canceledToolProbe.sessionId, canceledToolProbe.turnId);
  assert(canceledTurn.state === "aborted", "Expected canceled read-only tool to put the turn in aborted state.");
  const canceledSession = probeSessionStore.readSession(canceledToolProbe.sessionId);
  const canceledToolItem = canceledSession.messages[0].items.find((item) => item.id === canceledToolProbe.toolObligations[0].obligationId);
  assert(canceledToolItem.status === "canceled", "Expected canceled tool transcript item status.");

  const malformedToolProbeSse = [
    "event: response.created",
    "data: {\"response\":{\"id\":\"resp_malformed_tool_probe\",\"model\":\"gpt-5.4\"}}",
    "",
    "event: response.output_item.added",
    "data: {\"item\":{\"id\":\"tool_malformed_probe\",\"type\":\"function_call\",\"call_id\":\"call_malformed_read\",\"name\":\"read_file\"}}",
    "",
    "event: response.output_item.done",
    "data: {\"item\":{\"id\":\"tool_malformed_probe\",\"type\":\"function_call\",\"call_id\":\"call_malformed_read\",\"name\":\"read_file\",\"arguments\":\"{\\\"path\\\":\\\"/etc/passwd\\\"}\"}}",
    "",
    "event: response.completed",
    "data: {\"response\":{\"id\":\"resp_malformed_tool_probe\",\"status\":\"completed\"}}",
    "",
  ].join("\n");
  const malformedToolProbe = await runPersistedTextOnlyDirectProbe({
    endpoint: "https://chatgpt.com/backend-api/codex/responses",
    credentials: { accessToken: "malformed_tool_probe_access_token_secret_1234567890" },
    profileDoc,
    model: "gpt-5.4",
    prompt: "malformed tool probe prompt",
    sessionStore: probeSessionStore,
    project: { id: "project_direct_text_probe", workspace: { kind: "local", localPath: "[REDACTED:private-path]" } },
    fetchImpl: async () => textResponse(malformedToolProbeSse, 200, { "content-type": "text/event-stream" }),
  });
  const declinedMalformedTool = declineReadOnlyToolObligation({
    sessionStore: probeSessionStore,
    sessionId: malformedToolProbe.sessionId,
    turnId: malformedToolProbe.turnId,
    obligationId: malformedToolProbe.toolObligations[0].obligationId,
    decidedBy: "smoke-test",
    reason: "Smoke test declined malformed read-only access.",
    nowMs: 1_700_000_019_500,
  });
  assert(declinedMalformedTool.obligation.status === "declined", "Expected malformed read-only tool to be declinable.");
  const declinedMalformedTurn = probeSessionStore.readTurn(malformedToolProbe.sessionId, malformedToolProbe.turnId);
  assert(declinedMalformedTurn.state === "failed", "Expected malformed declined read-only tool to terminate the turn.");

  await assertRejects(
    () => executeApprovedReadOnlyToolObligation({
      sessionStore: probeSessionStore,
      sessionId: persistedToolProbe.sessionId,
      turnId: persistedToolProbe.turnId,
      obligationId: persistedToolProbe.toolObligations[0].obligationId,
      workspaceRequest: async () => {
        throw new Error("unexpected pre-approval read.");
      },
    }),
    "Expected read-only tool execution to require explicit approval.",
  );
  const approvedTool = approveReadOnlyToolObligation({
    sessionStore: probeSessionStore,
    sessionId: persistedToolProbe.sessionId,
    turnId: persistedToolProbe.turnId,
    obligationId: persistedToolProbe.toolObligations[0].obligationId,
    approvedBy: "smoke-test",
    nowMs: 1_700_000_020_000,
  });
  assert(approvedTool.obligation.status === "approved", "Expected read-only tool approval to persist approved status.");
  assert(approvedTool.obligation.executionAllowed === true, "Expected approved read-only tool to allow one backend execution.");
  let workspaceReadCalls = 0;
  const executedTool = await executeApprovedReadOnlyToolObligation({
    sessionStore: probeSessionStore,
    sessionId: persistedToolProbe.sessionId,
    turnId: persistedToolProbe.turnId,
    obligationId: persistedToolProbe.toolObligations[0].obligationId,
    workspaceRequest: async (method, params) => {
      workspaceReadCalls += 1;
      assert(method === "readFile", "Expected read-only authority to use workspace backend readFile.");
      assert(params.relPath === "README.md", "Expected read-only authority to request the model-selected relative path.");
      return {
        relPath: params.relPath,
        size: 19,
        truncated: false,
        binary: false,
        text: "fixture read result",
        source: "local",
        absolutePath: "/private/path/README.md",
      };
    },
    nowMs: 1_700_000_021_000,
  });
  assert(executedTool.result.textPreview === "fixture read result", "Expected read-only tool result preview to persist.");
  assert(executedTool.result.recordedAt === new Date(1_700_000_021_000).toISOString(), "Expected read-only tool result timestamp to use execution time.");
  assert(executedTool.result.rawWorkspacePathExposed === false, "Expected read-only tool result to avoid raw workspace path exposure.");
  assert(executedTool.obligation.status === "result_recorded", "Expected read-only tool obligation to persist result_recorded status.");
  assert(executedTool.obligation.sideEffectExecuted === false, "Read-only tool execution must not mark side effects.");
  const reusedTool = await executeApprovedReadOnlyToolObligation({
    sessionStore: probeSessionStore,
    sessionId: persistedToolProbe.sessionId,
    turnId: persistedToolProbe.turnId,
    obligationId: persistedToolProbe.toolObligations[0].obligationId,
    workspaceRequest: async () => {
      workspaceReadCalls += 1;
      throw new Error("unexpected duplicate read.");
    },
  });
  assert(reusedTool.reused === true, "Expected recorded read-only result to be reused idempotently.");
  assert(workspaceReadCalls === 1, "Expected read-only tool result persistence to prevent duplicate backend reads.");
  const resultRecordedTurn = probeSessionStore.readTurn(persistedToolProbe.sessionId, persistedToolProbe.turnId);
  assert(resultRecordedTurn.state === "continuation_ready", "Expected read-only result persistence to leave turn ready for later continuation.");
  assert(resultRecordedTurn.toolResults.length === 1, "Expected read-only result to pair to exactly one obligation.");
  const resultRecordedSession = probeSessionStore.readSession(persistedToolProbe.sessionId);
  const recordedToolItem = resultRecordedSession.messages[0].items.find((item) => item.id === persistedToolProbe.toolObligations[0].obligationId);
  assert(recordedToolItem.status === "result_recorded", "Expected transcript tool item to reflect recorded result.");
  const continuationRequest = buildReadOnlyToolContinuationRequest({
    sessionStore: probeSessionStore,
    sessionId: persistedToolProbe.sessionId,
    turnId: persistedToolProbe.turnId,
    obligationId: persistedToolProbe.toolObligations[0].obligationId,
    nowMs: 1_700_000_022_000,
  });
  assert(continuationRequest.schema === DIRECT_READONLY_TOOL_CONTINUATION_REQUEST_SCHEMA, "Expected read-only continuation schema.");
  assert(continuationRequest.safety.fromRecordedResult === true, "Expected read-only continuation to cite recorded evidence.");
  assert(continuationRequest.safety.originalRequestRetried === false, "Read-only continuation must not retry the original request.");
  assert(continuationRequest.safety.continuationLiveSendEnabled === false, "Read-only continuation must remain fixture/local only.");
  assert(continuationRequest.toolResult.metadata.resultId === executedTool.result.resultId, "Expected continuation to pair to recorded tool result.");
  assert(continuationRequest.toolResult.content[0].text === "fixture read result", "Expected continuation to include recorded tool output.");
  assert(!JSON.stringify(continuationRequest).includes("/private/path"), "Read-only continuation must not expose raw workspace paths.");
  const continuationSse = [
    "event: response.created",
    "data: {\"response\":{\"id\":\"resp_tool_continuation\",\"model\":\"gpt-5.4\"}}",
    "",
    "event: response.output_text.delta",
    "data: {\"item_id\":\"msg_tool_continuation\",\"delta\":\"continued after read\"}",
    "",
    "event: response.completed",
    "data: {\"response\":{\"id\":\"resp_tool_continuation\",\"status\":\"completed\"}}",
    "",
  ].join("\n");
  let capturedContinuationRequest = null;
  const sentContinuation = await runPersistedReadOnlyToolContinuation({
    sessionStore: probeSessionStore,
    sessionId: persistedToolProbe.sessionId,
    turnId: persistedToolProbe.turnId,
    obligationId: persistedToolProbe.toolObligations[0].obligationId,
    continuationRequest,
    endpoint: "https://chatgpt.com/backend-api/codex/responses",
    credentials: { accessToken: "continuation_probe_access_token_secret_1234567890" },
    profileDoc,
    model: "gpt-5.4",
    fetchImpl: async (url, init) => {
      capturedContinuationRequest = { url, init, body: JSON.parse(init.body) };
      return textResponse(continuationSse, 200, { "content-type": "text/event-stream" });
    },
    nowMs: 1_700_000_023_000,
  });
  assert(sentContinuation.schema === DIRECT_TOOL_CONTINUATION_RESULT_SCHEMA, "Expected read-only continuation send schema.");
  assert(sentContinuation.ok === true, "Expected read-only tool-result continuation to complete.");
  assert(sentContinuation.turnState === "completed", "Expected read-only continuation send to complete the turn.");
  assert(capturedContinuationRequest.url === DEFAULT_CODEX_RESPONSES_ENDPOINT, "Expected read-only continuation to use direct Codex endpoint.");
  assert(capturedContinuationRequest.body.previous_response_id === "resp_tool_probe", "Expected read-only continuation to cite previous response id.");
  assert(capturedContinuationRequest.body.input[0].type === "function_call_output", "Expected read-only continuation to send function call output.");
  assert(capturedContinuationRequest.body.input[0].call_id === "call_probe_read", "Expected read-only continuation to pair to the original tool call id.");
  assert(capturedContinuationRequest.body.input[0].output === "fixture read result", "Expected read-only continuation to send recorded tool output.");
  assert(sentContinuation.continuation.originalRequestRetried === false, "Read-only continuation send must not retry the original request.");
  assert(sentContinuation.obligation.status === "continuation_sent", "Expected read-only continuation to persist sent status.");
  assert(sentContinuation.obligation.continuationAllowed === false, "Read-only continuation must not enable automatic further continuation.");
  assert(sentContinuation.obligation.continuationRequest.continuationId === continuationRequest.continuationId, "Expected continuation request to persist on obligation.");
  assert(sentContinuation.obligation.continuationRequest.safety.continuationLiveSendEnabled === true, "Expected sent continuation evidence to record explicit live send.");
  const continuationTurn = probeSessionStore.readTurn(persistedToolProbe.sessionId, persistedToolProbe.turnId);
  assert(continuationTurn.state === "completed", "Expected continuation send persistence to complete the turn.");
  assert(continuationTurn.continuationRequestBuiltAt === new Date(1_700_000_023_000).toISOString(), "Expected continuation request built timestamp to use caller time.");
  assert(continuationTurn.continuationRequests.length === 1, "Expected continuation request to persist once on the turn.");
  const reusedContinuation = recordReadOnlyToolContinuationRequest({
    sessionStore: probeSessionStore,
    sessionId: persistedToolProbe.sessionId,
    turnId: persistedToolProbe.turnId,
    obligationId: persistedToolProbe.toolObligations[0].obligationId,
  });
  assert(reusedContinuation.reused === true, "Expected recorded continuation request to be reused idempotently.");
  const finalContinuationTurn = probeSessionStore.readTurn(persistedToolProbe.sessionId, persistedToolProbe.turnId);
  assert(finalContinuationTurn.continuationRequests.length === 1, "Expected idempotent continuation recording to avoid duplicates.");
  const continuationSession = probeSessionStore.readSession(persistedToolProbe.sessionId);
  const continuationMessage = continuationSession.messages[0].items.find((item) => item.id === `${persistedToolProbe.turnId}_${continuationRequest.continuationId}_assistant`);
  assert(continuationMessage.text === "continued after read", "Expected continuation assistant output to persist in transcript.");
  const repeatedApproval = approveReadOnlyToolObligation({
    sessionStore: probeSessionStore,
    sessionId: persistedToolProbe.sessionId,
    turnId: persistedToolProbe.turnId,
    obligationId: persistedToolProbe.toolObligations[0].obligationId,
    approvedBy: "smoke-test",
  });
  assert(repeatedApproval.obligation.status === "continuation_sent", "Expected duplicate approval to preserve completed continuation state.");
  assert(repeatedApproval.obligation.executionAllowed === false, "Expected duplicate approval not to re-enable execution after result recording.");
  assert(repeatedApproval.obligation.continuationRequest.continuationId === continuationRequest.continuationId, "Expected duplicate approval not to drop continuation evidence.");

  const failedContinuationSession = probeSessionStore.createSession({
    projectId: "project_failed_continuation",
    title: "Failed continuation probe",
    model: "gpt-5.4",
  });
  probeSessionStore.writeSession({
    ...failedContinuationSession,
    messages: "unexpected-malformed-messages",
  });
  const failedContinuationObligation = {
    obligationId: "tool_obligation_failed_continuation",
    sessionId: failedContinuationSession.sessionId,
    turnId: "turn_failed_continuation",
    status: "result_recorded",
    authorityState: "result_recorded",
    executionAllowed: false,
    continuationAllowed: false,
    sourceItemId: "tool_failed_continuation",
    callId: "call_failed_continuation",
    name: "read_file",
    argumentsText: "{\"path\":\"README.md\"}",
    result: {
      schema: DIRECT_READONLY_TOOL_RESULT_SCHEMA,
      resultId: "tool_result_failed_continuation",
      obligationId: "tool_obligation_failed_continuation",
      tool: "read_file",
      status: "completed",
      relPath: "README.md",
      size: 19,
      truncated: false,
      binary: false,
      textPreview: "failed continuation fixture",
      summary: "README.md · 19 bytes",
      source: "local",
      approvedAt: new Date(1_700_000_024_000).toISOString(),
      recordedAt: new Date(1_700_000_025_000).toISOString(),
      sideEffectExecuted: false,
      rawWorkspacePathExposed: false,
    },
  };
  probeSessionStore.createTurn(failedContinuationSession.sessionId, {
    turnId: "turn_failed_continuation",
    state: "continuation_ready",
    model: "gpt-5.4",
    unresolvedObligations: [failedContinuationObligation],
    toolResults: [failedContinuationObligation.result],
  });
  const failedContinuationRequest = {
    ...buildReadOnlyToolContinuationRequest({
      sessionStore: probeSessionStore,
      sessionId: failedContinuationSession.sessionId,
      turnId: "turn_failed_continuation",
      obligationId: failedContinuationObligation.obligationId,
      nowMs: 1_700_000_026_000,
    }),
    source: {
      previousResponseId: "resp_preserved_from_continuation_source",
    },
  };
  let capturedFailedContinuationRequest = null;
  const failedContinuation = await runPersistedReadOnlyToolContinuation({
    sessionStore: probeSessionStore,
    sessionId: failedContinuationSession.sessionId,
    turnId: "turn_failed_continuation",
    obligationId: failedContinuationObligation.obligationId,
    continuationRequest: failedContinuationRequest,
    endpoint: "https://chatgpt.com/backend-api/codex/responses",
    credentials: { accessToken: "failed_continuation_probe_access_token_secret_1234567890" },
    profileDoc,
    model: "gpt-5.4",
    fetchImpl: async (_url, init) => {
      capturedFailedContinuationRequest = { body: JSON.parse(init.body) };
      return textResponse("{\"error\":\"temporary failure\"}", 500, { "content-type": "application/json" });
    },
    nowMs: 1_700_000_027_000,
  });
  assert(failedContinuation.ok === false, "Expected failed read-only continuation to report failure.");
  assert(capturedFailedContinuationRequest.body.previous_response_id === "resp_preserved_from_continuation_source", "Expected read-only continuation to preserve existing previous response id.");
  assert(failedContinuation.obligation.status === "continuation_built", "Expected failed read-only continuation to remain retryable.");
  assert(failedContinuation.obligation.continuationSentAt === "", "Expected failed read-only continuation not to record sent timestamp.");
  const failedContinuationSessionAfter = probeSessionStore.readSession(failedContinuationSession.sessionId);
  assert(failedContinuationSessionAfter.messages === "unexpected-malformed-messages", "Expected malformed session messages to be preserved.");

  const failedProbe = await runPersistedTextOnlyDirectProbe({
    endpoint: "https://chatgpt.com/backend-api/codex/responses",
    credentials: { accessToken: "failed_probe_access_token_secret_1234567890" },
    profileDoc,
    model: "gpt-5.4",
    prompt: "failed probe prompt",
    sessionStore: probeSessionStore,
    project: { id: "project_direct_text_probe", workspace: { kind: "local", localPath: "[REDACTED:private-path]" } },
    fetchImpl: async () => textResponse("{\"error\":\"unauthorized\"}", 401, { "content-type": "application/json" }),
  });
  assert(failedProbe.ok === false, "Expected failed direct text probe to remain failed.");
  assert(failedProbe.turnState === "failed", "Expected failed direct text probe to persist terminal failed state.");
  assert(failedProbe.normalizedEvents.some((event) => event.type === "auth_error"), "Expected 401 probe failure to normalize as auth_error.");
  assertFixtureRedacted(failedProbe.diagnostic);

  const abortController = new AbortController();
  abortController.abort();
  const abortedProbe = await runPersistedTextOnlyDirectProbe({
    endpoint: "https://chatgpt.com/backend-api/codex/responses",
    credentials: { accessToken: "aborted_probe_access_token_secret_1234567890" },
    profileDoc,
    model: "gpt-5.4",
    prompt: "aborted probe prompt",
    sessionStore: probeSessionStore,
    project: { id: "project_direct_text_probe", workspace: { kind: "local", localPath: "[REDACTED:private-path]" } },
    signal: abortController.signal,
    fetchImpl: async () => {
      throw Object.assign(new Error("probe aborted"), { name: "AbortError" });
    },
  });
  assert(abortedProbe.ok === false, "Expected aborted direct text probe to remain non-ok.");
  assert(abortedProbe.turnState === "aborted", "Expected aborted direct text probe to persist terminal aborted state.");
  assert(abortedProbe.normalizedEvents.some((event) => event.type === "aborted"), "Expected aborted probe failure to normalize as aborted.");
  assertFixtureRedacted(abortedProbe.diagnostic);
} finally {
  fs.rmSync(textProbeParent, { recursive: true, force: true });
}

const delta = buildFixtureProfileDelta({
  fixtureId: "inline/plain-tool-turn",
  normalizedEvents: normalized.normalized,
  unknownRawTypes: normalized.unknown.map((event) => event.rawType),
});
assert(delta.acceptance === "candidate", "Expected fixture profile delta to be a candidate.");
assert(delta.normalizedEventCounts.message_delta === 1, "Expected message delta count.");

const importCandidate = buildImportCandidate([
  { timestamp: "2026-04-25T10:00:00Z", thread_id: "thread_1", message: { role: "user", content: "Inspect this." } },
  { timestamp: "2026-04-25T10:00:02Z", type: "tool_call_started", item: { type: "function_call" } },
], {
  sourcePath: "/tmp/codex/history/thread_1.jsonl",
  codexHome: "/tmp/codex",
});
assert(importCandidate.target.runnable === false, "Imported Codex JSONL must remain non-runnable.");
assert(importCandidate.unresolvedObligations.length === 1, "Expected unpaired tool obligation.");
assert(importCandidate.source.codexHome.endsWith("/tmp/codex"), "Expected import candidate to preserve source CODEX_HOME.");
const importCheckpoint = buildDirectCheckpointCandidate(importCandidate, { nowMs: 1_700_000_040_000 });
assert(importCheckpoint.schema === "direct_codex_import_checkpoint_candidate@1", "Expected direct import checkpoint candidate schema.");
assert(importCheckpoint.state === "checkpoint-candidate", "Expected import checkpoint candidate state.");
assert(importCheckpoint.runnable === false, "Import checkpoint candidate must not be runnable.");
assert(importCheckpoint.target.eligibleForContinuation === false, "Import checkpoint candidate must not allow continuation yet.");
assert(importCheckpoint.source.filePath.endsWith("/tmp/codex/history/thread_1.jsonl"), "Expected import checkpoint to preserve source file path.");
assert(importCheckpoint.source.codexHome.endsWith("/tmp/codex"), "Expected import checkpoint to preserve source CODEX_HOME.");
assert(importCheckpoint.checkpoint.messages.length === 1, "Expected import checkpoint to preserve user-visible messages.");
assert(importCheckpoint.checkpoint.unresolvedObligations.length === 1, "Expected import checkpoint to carry unresolved obligations.");
assert(importCheckpoint.checkpoint.unresolvedObligations[0].autoReplayable === false, "Imported tool calls must not be auto-replayable.");
assert(importCheckpoint.validation.importedApprovalsCarryAuthority === false, "Imported approvals must not carry future authority.");
const unresolvedImportValidation = validateDirectCheckpointCandidate(importCheckpoint, { nowMs: 1_700_000_040_500 });
assert(unresolvedImportValidation.state === "checkpoint-candidate", "Expected unresolved import checkpoint to remain a checkpoint candidate.");
assert(unresolvedImportValidation.runnable === false, "Expected unresolved import checkpoint to remain non-runnable.");
assert(unresolvedImportValidation.target.eligibleForContinuation === false, "Expected unresolved import checkpoint not to allow continuation.");
assert(unresolvedImportValidation.validation.gates.unresolvedImportedToolCallsClear === false, "Expected unresolved import checkpoint validation to block on tool obligations.");
const roleOnlyImportCandidate = buildImportCandidate([
  { timestamp: "2026-04-25T10:00:03Z", thread_id: "thread_role_only", message: { role: "assistant", content: "" } },
], {
  sourcePath: "/tmp/codex/history/thread_role_only.jsonl",
  codexHome: "/tmp/codex",
});
const roleOnlyCheckpoint = buildDirectCheckpointCandidate(roleOnlyImportCandidate, { nowMs: 1_700_000_041_000 });
assert(roleOnlyCheckpoint.validation.state === "checkpoint-candidate", "Expected role-only imported messages to remain checkpoint candidates.");
assert(roleOnlyCheckpoint.checkpoint.messages.length === 1, "Expected role-only imported messages to be preserved.");
assert(roleOnlyCheckpoint.checkpoint.messages[0].role === "assistant", "Expected role-only assistant boundary to be preserved.");
const roleOnlyValidation = validateDirectCheckpointCandidate(roleOnlyCheckpoint, { nowMs: 1_700_000_041_500 });
assert(roleOnlyValidation.state === "checkpoint-candidate", "Expected role-only import checkpoint to validate as non-runnable candidate.");
assert(roleOnlyValidation.validation.gates.userVisibleTextPreserved === false, "Expected role-only import validation to require user-visible text before runnable state.");
const cleanImportCandidate = buildImportCandidate([
  { timestamp: "2026-04-25T10:00:04Z", thread_id: "thread_clean", message: { role: "user", content: "Inspect this file." } },
  { timestamp: "2026-04-25T10:00:05Z", thread_id: "thread_clean", message: { role: "assistant", content: "Inspection complete." } },
], {
  sourcePath: "/tmp/codex/history/thread_clean.jsonl",
  codexHome: "/tmp/codex",
});
const cleanCheckpoint = buildDirectCheckpointCandidate(cleanImportCandidate, { nowMs: 1_700_000_042_000 });
const cleanValidation = validateDirectCheckpointCandidate(cleanCheckpoint, { nowMs: 1_700_000_043_000 });
assert(cleanValidation.state === "checkpointed-runnable", "Expected clean import checkpoint to validate as checkpointed-runnable.");
assert(cleanValidation.runnable === true, "Expected clean import checkpoint to become runnable after validation.");
assert(cleanValidation.target.eligibleForContinuation === true, "Expected clean import checkpoint to become eligible for continuation.");
assert(cleanValidation.validation.gates.sourceFilePathPreserved === true, "Expected clean import validation to require source file path.");
assert(cleanValidation.validation.gates.sourceCodexHomePreserved === true, "Expected clean import validation to require source CODEX_HOME.");
assert(cleanValidation.validation.gates.sourceThreadIdPreserved === true, "Expected clean import validation to require source thread id.");
assert(cleanValidation.validation.importedApprovalsCarryAuthority === false, "Validated imported checkpoints must not inherit approval authority.");

const committedFixtureCount = validateCommittedFixtureCorpus();
assert(committedFixtureCount >= 4, "Expected committed direct Codex fixture corpus coverage.");
const probeResults = runProbeManifestDir(DEFAULT_PROBE_MANIFEST_DIR, { fixtureRoot: DEFAULT_FIXTURE_ROOT });
assert(probeResults.length >= 22, "Expected committed direct Codex stream and auth probe manifests.");
const failedProbes = probeResults.filter((probe) => probe.status !== "passed");
assert(
  failedProbes.length === 0,
  `Expected all fixture-backed probes to pass: ${failedProbes.map((probe) => `${probe.id}: ${probe.errorMessage || probe.status}`).join("; ")}`,
);
assert(
  probeResults
    .filter((probe) => probe.source === "committed-fixture")
    .every((probe) => probe.blockedLiveGates.length > 0),
  "Expected stream fixture-backed probes to record blocked live gates.",
);
const authProbeResults = probeResults.filter((probe) => probe.source === "auth-shape-fixture");
assert(authProbeResults.length >= 18, "Expected committed direct Codex auth-shape probes.");
assert(
  authProbeResults.every((probe) => probe.authOperation && probe.blockedLiveGates.length > 0),
  "Expected auth-shape probes to record operations and blocked live gates.",
);
const authProbeOperations = new Set(authProbeResults.map((probe) => probe.authOperation));
for (const operation of [
  "authorization_url",
  "callback_parse",
  "credential_status_projection",
  "jwt_account_id_extraction",
  "manual_code_paste",
  "refresh_failure_projection",
  "token_exchange_request_shape",
  "token_refresh_request_shape",
  "token_response_normalization",
]) {
  assert(authProbeOperations.has(operation), `Expected auth-shape probe operation ${operation}.`);
}
const intentionallyFailedProbe = runFixtureBackedProbe({
  schema: "direct_codex_probe_manifest@1",
  id: "probe.fixture.intentional_failure",
  name: "Intentional Failed Probe",
  hypothesis: "A bad expected acceptance state should produce a failed probe result.",
  fixture: {
    source: "committed-fixture",
    rawFixtureId: "raw/plain-text-turn",
  },
  normalization: {
    expectedFixtureId: "normalized/plain-text-turn",
    failOnUnknown: true,
  },
  profileDelta: {
    expectedFixtureId: "profile-deltas/plain-text-turn",
  },
  acceptance: {
    expectedState: "accepted",
    requiredEventTypes: ["session_started"],
  },
  blockedLiveGates: ["No live backend request."],
}, { fixtureRoot: DEFAULT_FIXTURE_ROOT });
assert(intentionallyFailedProbe.status === "failed", "Expected failed probes to return a failed result.");
assert(Boolean(intentionallyFailedProbe.errorMessage), "Expected failed probes to include an error message.");

const report = buildDirectCodexProfileReport({
  profileDoc,
  profileDeltas: [delta],
  probeResults,
  fixtureSummaries: [{ id: "inline/plain-tool-turn", recordCount: sampleEvents.length, redactionStatus: "passed" }],
});
assert(report.includes("imported GPTPro conceptual baseline"), "Expected report to identify the conceptual baseline.");
assert(report.includes("inline/plain-tool-turn"), "Expected report to include fixture delta evidence.");
assert(report.includes("## Probe Results"), "Expected report to include probe results.");

console.log("Direct Codex profile harness smoke passed.");
