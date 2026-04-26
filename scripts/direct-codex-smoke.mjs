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

const { buildImportCandidate } = require("../src/main/direct/import/codex-jsonl-import");
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
  DEFAULT_PROBE_MANIFEST_DIR,
  runFixtureBackedProbe,
  runProbeManifestDir,
} = require("../src/main/direct/probes/probe-runner");

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
]);
assert(importCandidate.target.runnable === false, "Imported Codex JSONL must remain non-runnable.");
assert(importCandidate.unresolvedObligations.length === 1, "Expected unpaired tool obligation.");

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
