import nodeAssert from "node:assert/strict";
import { createRequire } from "node:module";
import crypto from "node:crypto";
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
  buildRendererSafeImportSession,
  materializeDirectImportSession,
  validateDirectCheckpointCandidate,
} = require("../src/main/direct/import/codex-jsonl-import");
const { DirectImportController } = require("../src/main/direct/import/import-controller");
const {
  buildDirectImportCheckpointSeed,
  checkpointContinuationRequestShapeHash,
  rendererSafeCheckpointSeedPreview,
} = require("../src/main/direct/import/checkpoint-continuation");
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
const {
  DirectExperimentalActivationStore,
  activeDirectTurnCountForProject,
  evaluateDirectExperimentalProjectActivation,
} = require("../src/main/direct/runtime/project-activation");
const { DirectSessionStore } = require("../src/main/direct/session/session-store");
const {
  COMPACT_TRANSCRIPT_PROJECTION_KIND,
  CONTEXT_RECENT_DIALOGUE_PROJECTION_KIND,
  DIRECT_OBLIGATIONS_PROJECTION_KIND,
  DIRECT_READONLY_TOOL_CONTINUATION_POLICY_ID,
  DIRECT_THREAD_OPERATION_EVENT_SCHEMA,
  DIRECT_THREAD_OPERATION_LEDGER_MANIFEST_SCHEMA,
  DIRECT_THREAD_STORE_STATUS_SCHEMA,
  DIRECT_TEXT_TURN_EMPTY_CONTEXT_POLICY_ID,
  DIRECT_TEXT_TURN_RECENT_DIALOGUE_POLICY_ID,
  DirectThreadStore,
  FORK_PREVIEW_PROJECTION_KIND,
  MERGE_PREVIEW_PROJECTION_KIND,
  PRUNE_PREVIEW_PROJECTION_KIND,
  RENDERER_TRANSCRIPT_PROJECTION_KIND,
  THREAD_GRAPH_PROJECTION_KIND,
  THREAD_LIFECYCLE_PROJECTION_KIND,
  TOOL_CONTINUATION_CONTEXT_PROJECTION_KIND,
} = require("../src/main/direct/thread/thread-store");
const { DirectThreadWorkbenchController } = require("../src/main/direct/thread/thread-workbench-controller");
const {
  buildContextRecentDialogueProjection: buildContextRecentDialogueProjectionFixture,
} = require("../src/main/direct/thread/context-pack");
const {
  DIRECT_FIXTURE_SURFACE_TRANSPORT,
  DirectFixtureController,
  DirectFixtureSurfaceSession,
  buildDirectFixtureCapabilities,
} = require("../src/main/direct/controller/fixture-controller");
const {
  DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
  DirectLiveTextController,
  DirectLiveTextSurfaceSession,
} = require("../src/main/direct/controller/live-text-controller");
const {
  FAKE_SMOKE_SOURCE,
  FIXED_LIVE_TEXT_PROBE_PROMPT_CLASS,
  DirectLiveProbeEvidenceStore,
  computedEvidenceStatus,
  directTextRequestShapeHash,
  endpointClass,
} = require("../src/main/direct/probes/live-probe-evidence-store");
const {
  DEFAULT_CODEX_RESPONSES_ENDPOINT,
  DEFAULT_TEXT_PROBE_PROMPT,
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
  projectReadResult,
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

function createHashForSmoke(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 20);
}

function normalizedSmokePath(value) {
  return String(value || "").replaceAll("\\", "/");
}

function cleanupSmokeTempDir(directory) {
  if (!directory) return;
  try {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    if (process.platform !== "win32" || error?.code !== "EPERM") throw error;
    try {
      fs.chmodSync(directory, 0o700);
    } catch {
      // Best effort for Windows temp cleanup after SQLite/Electron handles release late.
    }
    try {
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
    } catch (retryError) {
      if (retryError?.code !== "EPERM") throw retryError;
      console.warn(`Skipping locked Windows smoke temp cleanup: ${directory}`);
    }
  }
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

function acceptedLiveTextProfile() {
  const doc = JSON.parse(JSON.stringify(profileDoc));
  const models = Array.isArray(doc.profile?.ontology?.models) ? doc.profile.ontology.models : [];
  let found = false;
  for (const model of models) {
    if (model?.id !== "gpt-5.4") continue;
    model.status = "accepted";
    found = true;
  }
  if (!found) {
    doc.profile.ontology.models = [
      ...models,
      { id: "gpt-5.4", displayName: "GPT-5.4", status: "accepted", supportsReasoning: null, supportsTools: null },
    ];
  }
  return doc;
}

function acceptedReadOnlyToolProfile() {
  const doc = acceptedLiveTextProfile();
  const shapes = Array.isArray(doc.profile?.ontology?.continuationShapes) ? doc.profile.ontology.continuationShapes : [];
  let found = false;
  for (const shape of shapes) {
    if (shape?.id !== "continuation.tool_result") continue;
    shape.status = "accepted";
    found = true;
  }
  if (!found) {
    doc.profile.ontology.continuationShapes = [
      ...shapes,
      {
        id: "continuation.tool_result",
        field: "tool-result continuation",
        status: "accepted",
        summary: "Smoke-accepted read-only tool continuation shape.",
      },
    ];
  }
  return doc;
}

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
assert(directRuntimeStatus.imports.continuationRunnableNowCount === 0, "Import status must never make continuation runnable now.");
assert(directRuntimeStatus.imports.rawPathsExposed === false, "Import status must not expose raw source paths.");
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
const directRuntimeStatusWithLiveText = buildDirectRuntimeStatus({
  project: { surfaceBinding: { codex: { runtimeMode: "direct-experimental", directTransport: "live-text", model: "gpt-5.4" } } },
  authStatus: { status: "authenticated", storageMode: "file" },
  authSettings: { storageMode: "file" },
  profileDoc: acceptedLiveTextProfile(),
  liveTextRuntime: {
    available: true,
    status: {
      status: "ready",
      turnRunnable: true,
      modelSource: "odeu-profile",
      modelEvidenceState: "accepted",
    },
  },
});
assert(directRuntimeStatusWithLiveText.currentCodexLane === "direct live text experimental", "Expected runtime lane to label live text truthfully.");
assert(directRuntimeStatusWithLiveText.directRuntime.turnRunnable === true, "Expected accepted live text runtime to enable direct turn status.");
assert(directRuntimeStatusWithLiveText.liveTextRuntime.turnRunnable === true, "Expected live text runtime status to project turn runnable.");
assert(directRuntimeStatusWithLiveText.transport.runnable === true, "Expected live text transport status to become runnable only through live runtime evidence.");
const activationProject = {
  id: "project_activation_fixture",
  name: "Activation Fixture",
  workspace: { kind: "local", localPath: "[REDACTED:private-path]" },
  surfaceBinding: {
    codex: {
      mode: "managed",
      runtimeMode: "legacy-app-server",
      directTransport: "fixture",
      model: "gpt-5.4",
      profileId: profileDoc.profile.profileId,
    },
  },
};
const activationAuthStatus = {
  status: "authenticated",
  accountId: "account-fixture",
  hasAccessToken: true,
  hasRefreshToken: true,
  storageMode: "file",
};
const activationWorkspaceStatus = {
  status: "attached",
  key: "local:[REDACTED:private-path]",
  workspace: { kind: "local" },
};
const activationSessionStoreStatus = {
  available: true,
  recovery: { missingSessionFileCount: 0 },
};
const activationLiveTextOnly = {
  status: "ready",
  turnRunnable: true,
  model: "gpt-5.4",
  modelSource: "live-probe",
  modelEvidenceState: "runtime_probed",
  liveProbeEvidence: {
    usable: true,
    status: "runtime_probed",
    evidenceId: "evidence_text",
    source: "manual-live-probe",
  },
  toolsEnabled: false,
  readOnlyToolContinuation: { status: "profile_required", evidenceState: "unknown" },
};
const textOnlyActivation = evaluateDirectExperimentalProjectActivation({
  project: activationProject,
  authStatus: activationAuthStatus,
  liveTextStatus: activationLiveTextOnly,
  sessionStore: activationSessionStoreStatus,
  imports: {},
  workspaceStatus: activationWorkspaceStatus,
});
assert(textOnlyActivation.status.state === "text_only_eligible", "Expected text-only activation to remain informational.");
assert(textOnlyActivation.status.eligible === false, "Text-only preview must not become implementation-lane activation.");
assert(textOnlyActivation.status.gateSummary.blockers.some((item) => item.blockerCode === "tool_evidence_missing"), "Expected activation status to expose renderer-safe blocker details.");
const activationLiveWithTool = {
  ...activationLiveTextOnly,
  toolsEnabled: true,
  readOnlyToolContinuation: {
    status: "ready",
    evidenceState: "accepted",
    capabilityId: "continuation.tool_result",
  },
};
const implementationActivation = evaluateDirectExperimentalProjectActivation({
  project: activationProject,
  authStatus: activationAuthStatus,
  accountEvidenceKey: "raw-account-fixture",
  liveTextStatus: activationLiveWithTool,
  sessionStore: activationSessionStoreStatus,
  imports: {},
  workspaceStatus: activationWorkspaceStatus,
});
assert(implementationActivation.status.state === "eligible", "Expected live text plus read-only tool evidence to be implementation-lane eligible.");
assert(implementationActivation.status.eligible === true, "Expected implementation-lane activation to be eligible.");
assert(implementationActivation.status.rawAuthExposed === false, "Activation status must not expose raw auth.");
assert(implementationActivation.status.rawWorkspacePathExposed === false, "Activation status must not expose raw workspace paths.");
const activationRuntimeStatus = buildDirectRuntimeStatus({
  project: activationProject,
  authStatus: activationAuthStatus,
  profileDoc: acceptedLiveTextProfile(),
  liveTextRuntime: { available: true, status: activationLiveWithTool },
  activation: implementationActivation.status,
});
assert(activationRuntimeStatus.activation.state === "eligible", "Expected runtime status to include activation readiness.");
assert(activationRuntimeStatus.activation.gateSummary.blockedReasons.tool_evidence_missing === undefined, "Eligible activation must not report tool evidence blocker.");
const redactedAccountActivationA = evaluateDirectExperimentalProjectActivation({
  project: activationProject,
  authStatus: { ...activationAuthStatus, accountId: "[REDACTED:account-id]" },
  accountEvidenceKey: "private-account-a",
  liveTextStatus: activationLiveWithTool,
  sessionStore: activationSessionStoreStatus,
  imports: {},
  workspaceStatus: activationWorkspaceStatus,
});
const redactedAccountActivationB = evaluateDirectExperimentalProjectActivation({
  project: activationProject,
  authStatus: { ...activationAuthStatus, accountId: "[REDACTED:account-id]" },
  accountEvidenceKey: "private-account-b",
  liveTextStatus: activationLiveWithTool,
  sessionStore: activationSessionStoreStatus,
  imports: {},
  workspaceStatus: activationWorkspaceStatus,
});
assert(redactedAccountActivationA.gate.scope.accountEvidenceKey !== redactedAccountActivationB.gate.scope.accountEvidenceKey, "Private account evidence must scope gates even when renderer auth status is redacted.");
const activationStoreParent = fs.mkdtempSync(path.join(os.tmpdir(), "direct-codex-activation-store-"));
try {
  const activationStore = new DirectExperimentalActivationStore({ rootDir: path.join(activationStoreParent, "direct-sessions") });
  const pendingActivation = activationStore.createPendingActivation(activationProject, implementationActivation.gate, "client_activation_fixture");
  assert(pendingActivation.transactionState === "pending", "Expected pending activation transaction.");
  const committedActivation = activationStore.markActivationCommitted(pendingActivation);
  assert(committedActivation.transactionState === "committed", "Expected committed activation transaction.");
  assert(activationStore.latestCommittedActivation(activationProject.id).activationId === committedActivation.activationId, "Expected committed activation to recover from store.");
  const pendingRollback = activationStore.createPendingRollback(activationProject, committedActivation, "client_rollback_fixture", "user_requested");
  assert(pendingRollback.transactionState === "pending", "Expected pending rollback transaction.");
  const committedRollback = activationStore.markRollbackCommitted(pendingRollback, committedActivation);
  assert(committedRollback.transactionState === "committed", "Expected committed rollback transaction.");
  const dottedProject = { ...activationProject, id: "project.with.dot" };
  const dottedPending = activationStore.createPendingActivation(dottedProject, implementationActivation.gate, "client_activation_dotted");
  activationStore.markActivationCommitted(dottedPending);
  assert(activationStore.statusForProject(dottedProject.id).committedCount === 1, "Expected dotted legacy project ids to be path-safe in activation store.");
  const corruptProject = { ...activationProject, id: "project_corrupt_activation" };
  const corruptPending = activationStore.createPendingActivation(corruptProject, implementationActivation.gate, "client_activation_corrupt");
  const corruptPath = activationStore.activationPath(corruptProject.id, corruptPending.activationId);
  fs.writeFileSync(corruptPath, "{not-json", "utf8");
  assert(activationStore.statusForProject(corruptProject.id).corruptedCount === 1, "Expected corrupt activation files to produce corrupt status instead of throwing.");
} finally {
  cleanupSmokeTempDir(activationStoreParent);
}
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
    directThreadStore: {
      schema: DIRECT_THREAD_STORE_STATUS_SCHEMA,
      available: true,
      status: "healthy",
      mode: "index_only",
      schemaVersion: "1",
      rootExposed: false,
      dbPathExposed: false,
      projectionsHealthy: true,
      contextBuildsAllowed: false,
      threadCount: 0,
      rolloutCount: 0,
      turnCount: 0,
      operationCount: 0,
    },
  });
  assert(runtimeStatusWithStore.threads.canPersist === true, "Expected runtime status to expose direct session persistence.");
  assert(runtimeStatusWithStore.directRuntime.turnRunnable === false, "Session store availability must not imply runnable turns.");
  assert(runtimeStatusWithStore.sessionStore.rootExposed === false, "Runtime status must not expose direct session store paths.");
  assert(runtimeStatusWithStore.directThreadStore.available === true, "Expected runtime status to expose direct thread store health.");
  assert(runtimeStatusWithStore.directThreadStore.dbPathExposed === false, "Runtime status must not expose direct thread store DB path.");
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
    runtimeMode: "direct-experimental",
    directTransport: "direct-live-text",
    profileSnapshotId: profileDoc.profile.profileId,
  }, { nowMs: 1_700_000_005_000 });
  const interruptedTurn = sessionStore.createTurn(interruptedSession.sessionId, {
    turnId: "turn_streaming_interrupted",
    input: [{ role: "user", text: "stream then restart" }],
  }, { nowMs: 1_700_000_006_000 });
  sessionStore.updateTurnState(interruptedSession.sessionId, interruptedTurn.turnId, "request_built", {}, { nowMs: 1_700_000_007_000 });
  sessionStore.updateTurnState(interruptedSession.sessionId, interruptedTurn.turnId, "streaming", {}, { nowMs: 1_700_000_008_000 });
  assert(activeDirectTurnCountForProject(sessionStore, "project_fixture") === 1, "Expected direct activation rollback guard to find active direct turns.");
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

  const directThreadStore = new DirectThreadStore({
    rootDir: path.join(sessionStoreParent, "direct-sessions"),
    mode: "index_only",
  });
  try {
    const threadStoreInitialStatus = directThreadStore.status();
    assert(threadStoreInitialStatus.schema === DIRECT_THREAD_STORE_STATUS_SCHEMA, "Expected direct thread store status schema.");
    assert(threadStoreInitialStatus.rootExposed === false, "Direct thread store status must not expose root paths.");
    assert(threadStoreInitialStatus.dbPathExposed === false, "Direct thread store status must not expose DB paths.");
    const indexResult = directThreadStore.indexFromSessionStore(reloadedSessionStore, { nowMs: 1_700_000_015_500 });
    assert(indexResult.indexedSessionCount >= 4, "Expected direct thread store to index existing direct sessions.");
    assert(indexResult.indexedTurnCount >= 4, "Expected direct thread store to index existing direct turns.");
    const threadStoreIndexedStatus = directThreadStore.status();
    assert(threadStoreIndexedStatus.threadCount >= 4, "Expected direct thread store status to count indexed threads.");
    assert(threadStoreIndexedStatus.rolloutCount >= 4, "Expected direct thread store status to count rollout manifests.");
    assert(threadStoreIndexedStatus.turnCount >= 4, "Expected direct thread store status to count indexed turns.");
    const manifestFiles = [];
    const collectManifestFiles = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) collectManifestFiles(entryPath);
        else if (entry.isFile() && entry.name.endsWith(".manifest.json")) manifestFiles.push(entryPath);
      }
    };
    collectManifestFiles(path.join(sessionStoreParent, "direct-sessions", "rollouts"));
    assert(manifestFiles.length >= 4, "Expected direct thread store to write rollout manifests.");
    const plannedOperation = directThreadStore.planOperation({
      operationType: "hide_thread",
      projectId: "project_fixture",
      clientOperationId: "client_hide_fixture",
      target: { threadIds: [session.sessionId] },
      parameters: { reason: "smoke" },
      safety: { requiresConfirmation: false },
    }, { nowMs: 1_700_000_015_600 });
    assert(plannedOperation.schema === DIRECT_THREAD_OPERATION_EVENT_SCHEMA, "Expected append-only operation event schema.");
    assert(plannedOperation.eventType === "operation_planned", "Expected planned operation event.");
    const committedOperation = directThreadStore.commitOperation(plannedOperation.operationId, {
      operationType: "hide_thread",
      projectId: "project_fixture",
      target: { threadIds: [session.sessionId] },
      result: {
        effects: [{
          effectKind: "thread_hidden",
          targetKind: "thread",
          targetId: session.sessionId,
          beforeDigest: "before",
          afterDigest: "after",
        }],
      },
      safety: { requiresConfirmation: false },
    }, { nowMs: 1_700_000_015_700 });
    assert(committedOperation.eventType === "operation_committed", "Expected committed operation event.");
    assert(committedOperation.integrity.previousEventDigest === plannedOperation.integrity.eventDigest, "Expected operation ledger hash chaining.");
    const operationManifest = JSON.parse(fs.readFileSync(directThreadStore.operationLedgerManifestPath(), "utf8"));
    assert(operationManifest.schema === DIRECT_THREAD_OPERATION_LEDGER_MANIFEST_SCHEMA, "Expected operation ledger manifest schema.");
    assert(operationManifest.eventCount === 2, "Expected operation ledger manifest to count appended events.");
    directThreadStore.planOperation({
      operationType: "archive_thread",
      projectId: "project_fixture",
      target: { threadIds: ["session_interrupted"] },
      safety: { requiresConfirmation: false },
    }, { nowMs: 1_700_000_015_800 });
    directThreadStore.planOperation({
      operationType: "archive_thread",
      projectId: "project_fixture",
      target: { threadIds: ["session_stale_summary"] },
      safety: { requiresConfirmation: false },
    }, { nowMs: 1_700_000_015_900 });
    const operationRowsWithNullClientId = directThreadStore.db.prepare(
      "select count(*) as count from direct_operations where project_id = ? and client_operation_id is null",
    ).get("project_fixture");
    assert(operationRowsWithNullClientId.count === 2, "Expected omitted client operation ids to persist as SQL NULL.");
    const threadStoreOperationStatus = directThreadStore.status();
    assert(threadStoreOperationStatus.operationCount === 3, "Expected direct thread store to expose operation snapshots.");
    const rendererProjection = directThreadStore.buildRendererTranscriptProjection(session.sessionId, {
      sessionStore: reloadedSessionStore,
      nowMs: 1_700_000_016_000,
    });
    assert(rendererProjection.projectionKind === RENDERER_TRANSCRIPT_PROJECTION_KIND, "Expected renderer transcript projection kind.");
    assert(rendererProjection.status === "valid", "Expected renderer transcript projection to build as valid.");
    assert(rendererProjection.itemCount >= 2, "Expected renderer transcript projection to include user and assistant items.");
    const rendererRead = directThreadStore.readRendererTranscriptProjection(session.sessionId);
    assert(rendererRead.schema === "renderer_safe_direct_transcript_projection@1", "Expected renderer-safe transcript projection schema.");
    assert(rendererRead.composer.authoritative === false, "Projection composer state must be advisory.");
    assert(rendererRead.composer.controlAuthority === "runtime-status", "Projection composer authority must point to runtime status.");
    assert(rendererRead.rawExposure.rawPathExposed === false, "Renderer transcript projection must not expose raw paths.");
    assert(rendererRead.items.some((item) => item.itemKind === "user_message" && item.text === "hello"), "Expected projected user message.");
    assert(rendererRead.items.some((item) => item.itemKind === "assistant_message" && item.text === "ok"), "Expected projected assistant message.");
    assert(rendererRead.items.every((item) => item.flags?.executable === false), "Projected items must be non-executable.");
    assert(rendererRead.items.every((item) => item.stableSourceItemKey), "Projected items must include stable source keys.");
    const rendererPage = directThreadStore.readRendererTranscriptProjection(session.sessionId, { offset: 0, limit: 1 });
    assert(rendererPage.items.length === 1, "Expected renderer projection read pagination.");
    assert(rendererPage.page.total === rendererRead.items.length, "Expected renderer projection page to report total item count.");
    const reusedRendererProjection = directThreadStore.buildRendererTranscriptProjection(session.sessionId, {
      sessionStore: reloadedSessionStore,
      nowMs: 1_700_000_016_100,
    });
    assert(reusedRendererProjection.reused === true, "Expected unchanged renderer projection rebuild to reuse current projection.");
    const contextProjection = directThreadStore.buildContextRecentDialogueProjection(session.sessionId, {
      nowMs: 1_700_000_016_150,
    });
    assert(contextProjection.projectionKind === CONTEXT_RECENT_DIALOGUE_PROJECTION_KIND, "Expected context recent dialogue projection kind.");
    assert(contextProjection.status === "valid", "Expected context recent dialogue projection to build as valid.");
    const syntheticRendererProjection = {
      projectionId: "renderer_projection_synthetic",
      projectId: "project_fixture",
      threadId: "synthetic_thread",
      projectionKind: RENDERER_TRANSCRIPT_PROJECTION_KIND,
      projectionVersion: "renderer_transcript@1",
      projectionDigest: "renderer_digest_synthetic",
      status: "valid",
      unsafeForRenderer: false,
      unsafeForContextBuild: true,
      source: {},
      continuity: {},
      lifecycle: {},
    };
    const syntheticRendererItems = Array.from({ length: 205 }, (_, index) => ({
      itemId: `renderer_item_${index}`,
      stableSourceItemKey: `stable_item_${index}`,
      projectionId: syntheticRendererProjection.projectionId,
      threadId: syntheticRendererProjection.threadId,
      turnId: `turn_${index}`,
      itemKind: "user_message",
      role: "user",
      text: `synthetic item ${index}`,
      textDigest: `digest_${index}`,
      sourceRef: {},
    }));
    const syntheticContext = buildContextRecentDialogueProjectionFixture({
      rendererProjection: syntheticRendererProjection,
      rendererItems: syntheticRendererItems,
      nowMs: 1_700_000_016_151,
    });
    assert(syntheticContext.items.some((item) => item.text === "synthetic item 204"), "Context projection must preserve newest renderer items under caps.");
    assert(!syntheticContext.items.some((item) => item.text === "synthetic item 0"), "Context projection should omit oldest renderer items first under message caps.");
    const surrogateContext = buildContextRecentDialogueProjectionFixture({
      rendererProjection: { ...syntheticRendererProjection, projectionId: "renderer_projection_surrogate", projectionDigest: "renderer_digest_surrogate" },
      rendererItems: [{
        itemId: "renderer_surrogate_item",
        stableSourceItemKey: "stable_surrogate_item",
        projectionId: "renderer_projection_surrogate",
        threadId: syntheticRendererProjection.threadId,
        turnId: "turn_surrogate",
        itemKind: "user_message",
        role: "user",
        text: `${"a".repeat(15_999)}😀`,
        textDigest: "surrogate_digest",
        sourceRef: {},
      }],
      nowMs: 1_700_000_016_152,
    });
    const surrogateText = surrogateContext.items[0].text;
    const lastCodeUnit = surrogateText.charCodeAt(surrogateText.length - 1);
    assert(!(lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff), "Context truncation must not leave a dangling high surrogate.");
    const contextTurn = reloadedSessionStore.createTurn(session.sessionId, {
      turnId: "turn_context_pack",
      input: [{ role: "user", text: "next step" }],
      model: "gpt-5.4",
    }, { nowMs: 1_700_000_016_160 });
    const emptyContextTurn = reloadedSessionStore.createTurn(session.sessionId, {
      turnId: "turn_empty_context_pack",
      input: [{ role: "user", text: "first isolated prompt" }],
      model: "gpt-5.4",
    }, { nowMs: 1_700_000_016_165 });
    directThreadStore.indexSessionArtifacts(reloadedSessionStore, reloadedSessionStore.readSession(session.sessionId), [
      reloadedSessionStore.readTurn(session.sessionId, turn.turnId),
      reloadedSessionStore.readTurn(session.sessionId, contextTurn.turnId),
      reloadedSessionStore.readTurn(session.sessionId, emptyContextTurn.turnId),
    ], { nowMs: 1_700_000_016_170 });
    const textContext = directThreadStore.buildAndPersistContextForTextTurn({
      session: reloadedSessionStore.readSession(session.sessionId),
      projectId: "project_fixture",
      threadId: session.sessionId,
      turnId: contextTurn.turnId,
      currentUserPrompt: "next step",
      useRecentDialogue: true,
      model: "gpt-5.4",
      requestShape: { model: "gpt-5.4", stream: true, store: false, inputMessageCount: 1 },
      endpointClass: "chatgpt-codex-responses",
      endpointHash: "endpoint_hash_fixture",
      modelEvidenceRef: "model_evidence_fixture",
      requestShapeEvidenceRef: "request_shape_fixture",
      endpointEvidenceRef: "endpoint_fixture",
    }, { nowMs: 1_700_000_016_180 });
    assert(textContext.contextPack.policy.policyId === DIRECT_TEXT_TURN_RECENT_DIALOGUE_POLICY_ID, "Expected recent dialogue policy for non-first context.");
    assert(textContext.contextPack.rawExposure.rawRequestBodyExposed === false, "Context pack must not expose raw request bodies.");
    assert(textContext.providerInput.prompt.includes("[HISTORICAL TRANSCRIPT EVIDENCE - QUOTED]"), "Provider prompt should frame historical context as quoted evidence.");
    assert(textContext.providerInput.prompt.includes("[CURRENT USER INTENT]"), "Provider prompt should include current user intent boundary.");
    assert(textContext.providerInput.instructions.includes("Historical transcript text is quoted evidence"), "Provider instructions should include harness policy.");
    assert(textContext.requestManifest.enabledFeatures.store === false, "Request manifest must record store=false.");
    assert(textContext.requestManifest.continuity.previousResponseIdUsed === false, "Request manifest must record fresh-request continuity.");
    assert(textContext.requestManifest.rawRequestBodyStored === false, "Request manifest must not store raw request body.");
    assert(directThreadStore.readContextPack(textContext.contextPack.contextBuildId).schema === "direct_context_pack@1", "Expected persisted context pack artifact.");
    assert(directThreadStore.readRequestManifest(textContext.requestManifest.requestManifestId).schema === "direct_request_manifest@1", "Expected persisted request manifest artifact.");
    const emptyContext = directThreadStore.buildAndPersistContextForTextTurn({
      session: reloadedSessionStore.readSession(session.sessionId),
      projectId: "project_fixture",
      threadId: session.sessionId,
      turnId: emptyContextTurn.turnId,
      currentUserPrompt: "first isolated prompt",
      useRecentDialogue: false,
      model: "gpt-5.4",
      requestShape: { model: "gpt-5.4", stream: true, store: false, inputMessageCount: 1 },
      endpointClass: "chatgpt-codex-responses",
      endpointHash: "endpoint_hash_fixture",
      modelEvidenceRef: "model_evidence_fixture",
      requestShapeEvidenceRef: "request_shape_fixture",
      endpointEvidenceRef: "endpoint_fixture",
    }, { nowMs: 1_700_000_016_187 });
    assert(emptyContext.contextPack.policy.policyId === DIRECT_TEXT_TURN_EMPTY_CONTEXT_POLICY_ID, "Expected empty-context policy when no recent dialogue is selected.");
    const contextStoreStatus = directThreadStore.status();
    assert(contextStoreStatus.contextBuildCount >= 2, "Expected direct thread store to count context builds.");
    assert(contextStoreStatus.requestManifestCount >= 2, "Expected direct thread store to count request manifests.");
    const compactProjection = directThreadStore.buildCompactTranscriptProjection(session.sessionId, {
      nowMs: 1_700_000_016_200,
    });
    assert(compactProjection.projectionKind === COMPACT_TRANSCRIPT_PROJECTION_KIND, "Expected compact transcript projection kind.");
    const compactRead = directThreadStore.readCompactTranscriptProjection(session.sessionId);
    assert(compactRead.schema === "renderer_safe_direct_compact_projection@1", "Expected compact transcript projection read schema.");
    assert(compactRead.unsafeForContextBuild === true, "Compact projection must not be usable for context builds in this bundle.");
    assert(compactRead.items.every((item) => item.sourceStableItemKeys?.length === 1), "Compact items must cite stable renderer item keys.");
    const currentPointers = directThreadStore.db.prepare(`
      select projection_kind, projection_id
      from direct_thread_current_projections
      where thread_id = ?
      order by projection_kind
    `).all(session.sessionId);
    assert(currentPointers.some((row) => row.projection_kind === RENDERER_TRANSCRIPT_PROJECTION_KIND && row.projection_id === rendererProjection.projectionId), "Expected renderer current pointer by kind.");
    assert(currentPointers.some((row) => row.projection_kind === COMPACT_TRANSCRIPT_PROJECTION_KIND && row.projection_id === compactProjection.projectionId), "Expected compact current pointer by kind.");
    assert(currentPointers.find((row) => row.projection_kind === RENDERER_TRANSCRIPT_PROJECTION_KIND).projection_id !== compactProjection.projectionId, "Compact projection must not become current renderer transcript.");
    const parityReport = directThreadStore.projectionParityReport(session.sessionId, { sessionStore: reloadedSessionStore });
    assert(Array.isArray(parityReport.differences), "Expected projection parity report differences list.");
    const secondRendererProjection = directThreadStore.buildRendererTranscriptProjection(staleSummarySession.sessionId, {
      sessionStore: reloadedSessionStore,
      nowMs: 1_700_000_016_205,
    });
    assert(secondRendererProjection.status === "valid", "Expected second source renderer projection for preview smokes.");

    const hiddenLifecycle = directThreadStore.hideThread({
      projectId: "project_fixture",
      threadId: interruptedSession.sessionId,
      clientOperationId: "client_thread_control_hide",
    }, { nowMs: 1_700_000_016_210 });
    assert(hiddenLifecycle.status === "committed", "Expected hide thread lifecycle operation to commit.");
    assert(hiddenLifecycle.result.lifecycle.afterState === "hidden", "Expected hide operation to set hidden state.");
    const duplicateHiddenLifecycle = directThreadStore.hideThread({
      projectId: "project_fixture",
      threadId: interruptedSession.sessionId,
      clientOperationId: "client_thread_control_hide",
    }, { nowMs: 1_700_000_016_211 });
    assert(duplicateHiddenLifecycle.operationId === hiddenLifecycle.operationId, "Expected lifecycle operation idempotency by client operation id.");
    assertThrows(() => directThreadStore.softDeleteThread({
      projectId: "project_fixture",
      threadId: interruptedSession.sessionId,
      clientOperationId: "client_thread_control_hide",
    }, { nowMs: 1_700_000_016_211 }), "Reusing a lifecycle client operation id with different input must fail.");
    assert(!directThreadStore.listThreadSummaries("project_fixture").some((entry) => entry.threadId === interruptedSession.sessionId), "Hidden threads should be filtered from default list summaries.");
    assert(directThreadStore.listThreadSummaries("project_fixture", { includeHidden: true }).some((entry) => entry.threadId === interruptedSession.sessionId), "Explicit hidden list should include hidden thread.");
    const unhiddenLifecycle = directThreadStore.unhideThread({
      projectId: "project_fixture",
      threadId: interruptedSession.sessionId,
      clientOperationId: "client_thread_control_unhide",
    }, { nowMs: 1_700_000_016_212 });
    assert(unhiddenLifecycle.result.lifecycle.afterState === "active", "Expected unhide to restore active lifecycle state.");
    const archivedLifecycle = directThreadStore.archiveThread({
      projectId: "project_fixture",
      threadId: interruptedSession.sessionId,
      clientOperationId: "client_thread_control_archive",
    }, { nowMs: 1_700_000_016_213 });
    assert(archivedLifecycle.result.lifecycle.afterState === "archived", "Expected archive to set archived lifecycle state.");
    const restoredLifecycle = directThreadStore.restoreThread({
      projectId: "project_fixture",
      threadId: interruptedSession.sessionId,
      clientOperationId: "client_thread_control_restore",
    }, { nowMs: 1_700_000_016_214 });
    assert(restoredLifecycle.result.lifecycle.afterState === "active", "Expected restore to return archived thread to active.");
    const softDeletedLifecycle = directThreadStore.softDeleteThread({
      projectId: "project_fixture",
      threadId: interruptedSession.sessionId,
      clientOperationId: "client_thread_control_soft_delete",
    }, { nowMs: 1_700_000_016_215 });
    assert(softDeletedLifecycle.result.lifecycle.afterState === "soft_deleted", "Expected soft delete to set soft_deleted lifecycle state.");
    const restoredSoftDeletedLifecycle = directThreadStore.restoreSoftDeletedThread({
      projectId: "project_fixture",
      threadId: interruptedSession.sessionId,
      clientOperationId: "client_thread_control_restore_soft_deleted",
    }, { nowMs: 1_700_000_016_216 });
    assert(restoredSoftDeletedLifecycle.result.lifecycle.afterState === "active", "Expected explicit restore soft-deleted operation.");
    const activeDeleteBlockedSession = reloadedSessionStore.createSession({
      sessionId: "session_thread_control_active_delete_blocked",
      projectId: "project_fixture",
      workspace: { kind: "local", localPath: "[REDACTED:private-path]" },
      title: "Active delete blocked",
      model: "gpt-5.4",
    }, { nowMs: 1_700_000_016_217 });
    const activeDeleteBlockedTurn = reloadedSessionStore.createTurn(activeDeleteBlockedSession.sessionId, {
      turnId: "turn_thread_control_active_delete_blocked",
      state: "request_built",
      input: [{ role: "user", text: "still active" }],
    }, { nowMs: 1_700_000_016_218 });
    directThreadStore.indexSessionArtifacts(reloadedSessionStore, reloadedSessionStore.readSession(activeDeleteBlockedSession.sessionId), [
      reloadedSessionStore.readTurn(activeDeleteBlockedSession.sessionId, activeDeleteBlockedTurn.turnId),
    ], { nowMs: 1_700_000_016_219 });
    assertThrows(() => directThreadStore.softDeleteThread({
      projectId: "project_fixture",
      threadId: activeDeleteBlockedSession.sessionId,
      clientOperationId: "client_thread_control_soft_delete_active_blocked",
    }, { nowMs: 1_700_000_016_220 }), "Soft delete must be blocked while a direct turn is non-terminal.");
    const lifecycleProjection = directThreadStore.readThreadLifecycleProjection("project_fixture");
    assert(lifecycleProjection.projectionKind === THREAD_LIFECYCLE_PROJECTION_KIND, "Expected project lifecycle projection kind.");
    assert(lifecycleProjection.items.some((item) => item.itemKind === "thread_lifecycle_summary"), "Expected lifecycle projection summary rows.");
    directThreadStore.buildThreadLifecycleProjection("project_fixture", {
      nowMs: 1_700_000_016_221,
    });
    const reusedLifecycleProjection = directThreadStore.buildThreadLifecycleProjection("project_fixture", {
      nowMs: 1_700_000_016_221,
    });
    assert(reusedLifecycleProjection.reused === true, "Expected unchanged lifecycle projection rebuild to reuse current projection.");

    const chatGptRef = directThreadStore.createExternalRef({
      projectId: "project_fixture",
      refKind: "chatgpt_thread_binding",
      displayTitle: "Review pane thread",
      targetId: "chatgpt_binding_fixture",
      rendererSafeUrlHash: "hmac_chatgpt_binding_fixture",
      metadata: { role: "review" },
    }, { nowMs: 1_700_000_016_225 });
    assert(chatGptRef.urlStoredInDirectStore === false && chatGptRef.transcriptImported === false, "External ChatGPT refs must not store URL/transcript content.");
    const bridgeOperation = directThreadStore.bridgeThreads({
      projectId: "project_fixture",
      sourceKind: "direct_thread",
      sourceId: session.sessionId,
      targetKind: "external_ref",
      targetId: chatGptRef.externalRefId,
      edgeKind: "chatgpt_reference",
      clientOperationId: "client_thread_control_bridge_chatgpt",
      metadata: { role: "review" },
    }, { nowMs: 1_700_000_016_226 });
    assert(bridgeOperation.status === "committed", "Expected ChatGPT bridge operation to commit.");
    const duplicateBridgeOperation = directThreadStore.bridgeThreads({
      projectId: "project_fixture",
      sourceKind: "direct_thread",
      sourceId: session.sessionId,
      targetKind: "external_ref",
      targetId: chatGptRef.externalRefId,
      edgeKind: "chatgpt_reference",
      clientOperationId: "client_thread_control_bridge_chatgpt_duplicate",
      metadata: { role: "review" },
    }, { nowMs: 1_700_000_016_227 });
    assert(duplicateBridgeOperation.result.effects[0].effectKind === "lifecycle_noop_already_applied", "Duplicate bridge should be a deterministic no-op.");
    const orderedMetadataRef = directThreadStore.createExternalRef({
      projectId: "project_fixture",
      refKind: "imported_source",
      displayTitle: "Ordered metadata source",
      targetId: "ordered_metadata_source_fixture",
      rendererSafeUrlHash: "hmac_ordered_metadata_source_fixture",
    }, { nowMs: 1_700_000_016_227 });
    const orderedMetadataBridge = directThreadStore.bridgeThreads({
      projectId: "project_fixture",
      sourceKind: "direct_thread",
      sourceId: session.sessionId,
      targetKind: "external_ref",
      targetId: orderedMetadataRef.externalRefId,
      edgeKind: "import_source_reference",
      clientOperationId: "client_thread_control_bridge_ordered_metadata",
      metadata: { a: 1, b: 2 },
    }, { nowMs: 1_700_000_016_227 });
    assert(orderedMetadataBridge.status === "committed", "Expected ordered metadata bridge to commit.");
    const reorderedMetadataBridge = directThreadStore.bridgeThreads({
      projectId: "project_fixture",
      sourceKind: "direct_thread",
      sourceId: session.sessionId,
      targetKind: "external_ref",
      targetId: orderedMetadataRef.externalRefId,
      edgeKind: "import_source_reference",
      clientOperationId: "client_thread_control_bridge_reordered_metadata",
      metadata: { b: 2, a: 1 },
    }, { nowMs: 1_700_000_016_227 });
    assert(reorderedMetadataBridge.result.effects[0].effectKind === "lifecycle_noop_already_applied", "Bridge metadata comparison should be key-order stable.");
    const graphProjection = directThreadStore.readThreadGraphProjection("project_fixture");
    assert(graphProjection.projectionKind === THREAD_GRAPH_PROJECTION_KIND, "Expected graph projection kind.");
    assert(graphProjection.items.some((item) => item.itemKind === "graph_external_ref"), "Expected graph projection to include external ref node.");
    assert(graphProjection.items.some((item) => item.itemKind === "bridge_edge"), "Expected graph projection to include bridge edge.");
    const reusedGraphProjection = directThreadStore.buildThreadGraphProjection("project_fixture", {
      nowMs: 1_700_000_016_227,
    });
    assert(reusedGraphProjection.reused === true, "Expected unchanged graph projection rebuild to reuse current projection.");
    const unlinkOperation = directThreadStore.unlinkBridge({
      projectId: "project_fixture",
      sourceKind: "direct_thread",
      sourceId: session.sessionId,
      targetKind: "external_ref",
      targetId: chatGptRef.externalRefId,
      edgeKind: "chatgpt_reference",
      clientOperationId: "client_thread_control_unlink_chatgpt",
    }, { nowMs: 1_700_000_016_228 });
    assert(unlinkOperation.result.effects[0].effectKind === "edge_removed", "Expected unlink bridge to mark edge removed.");
    const graphAfterUnlink = directThreadStore.readThreadGraphProjection("project_fixture");
    assert(!graphAfterUnlink.items.some((item) => item.itemKind === "bridge_edge" && item.edge?.targetId === chatGptRef.externalRefId), "Unlinked bridge must not appear as an active graph edge.");

    const contextCountBeforePreviews = directThreadStore.db.prepare("select count(*) as count from direct_context_builds").get().count;
    const mergePreviewOperation = directThreadStore.createMergePreview({
      projectId: "project_fixture",
      sourceThreadIds: [session.sessionId, staleSummarySession.sessionId],
      clientOperationId: "client_thread_control_merge_preview",
    }, { nowMs: 1_700_000_016_230 });
    assert(mergePreviewOperation.projectionKind === MERGE_PREVIEW_PROJECTION_KIND, "Expected merge preview projection kind.");
    const mergePreview = directThreadStore.readProjectProjectionByKind("project_fixture", MERGE_PREVIEW_PROJECTION_KIND);
    assert(mergePreview.unsafeForContextBuild === true, "Merge preview must not be context-build usable.");
    assert(mergePreview.continuity.providerContinuityAvailable === false, "Merge preview must not create provider continuity.");
    assert(mergePreview.items.every((item) => item.stableSourceItemKey || item.stablePreviewItemKey), "Merge preview items need stable identity.");
    const prunePreviewOperation = directThreadStore.createPrunePreview({
      projectId: "project_fixture",
      threadId: session.sessionId,
      excludedStableSourceItemKeys: [rendererRead.items[0].stableSourceItemKey],
      clientOperationId: "client_thread_control_prune_preview",
    }, { nowMs: 1_700_000_016_231 });
    assert(prunePreviewOperation.projectionKind === PRUNE_PREVIEW_PROJECTION_KIND, "Expected prune preview projection kind.");
    const prunePreview = directThreadStore.readProjectProjectionByKind("project_fixture", PRUNE_PREVIEW_PROJECTION_KIND);
    assert(prunePreview.items.some((item) => item.itemKind === "prune_omission_marker" && item.omission?.itemCount === 1), "Prune preview must include structured omission marker.");
    const forkPreviewOperation = directThreadStore.createForkPreview({
      projectId: "project_fixture",
      threadId: session.sessionId,
      selectedStableSourceItemKeys: [rendererRead.items[0].stableSourceItemKey],
      clientOperationId: "client_thread_control_fork_preview",
    }, { nowMs: 1_700_000_016_232 });
    assert(forkPreviewOperation.projectionKind === FORK_PREVIEW_PROJECTION_KIND, "Expected fork preview projection kind.");
    const forkPreview = directThreadStore.readProjectProjectionByKind("project_fixture", FORK_PREVIEW_PROJECTION_KIND);
    assert(forkPreview.items[0].seed?.runnableNow === false, "Fork preview seed metadata must not be runnable.");
    assert(forkPreview.items[0].seed?.contextPackWritten === false, "Fork preview must not write context packs.");
    const contextCountAfterPreviews = directThreadStore.db.prepare("select count(*) as count from direct_context_builds").get().count;
    assert(contextCountAfterPreviews === contextCountBeforePreviews, "Thread-control previews must not create context packs.");

    const workbenchController = new DirectThreadWorkbenchController({
      threadStore: directThreadStore,
      sessionStore: reloadedSessionStore,
      now: () => 1_700_000_016_240,
    });
    const workbenchSnapshot = await workbenchController.getSnapshot({ id: "project_fixture", updatedAt: "2023-11-14T22:13:36.240Z" }, {
      refresh: true,
      filters: { includeHidden: true, includeArchived: true, includeSoftDeleted: true },
      page: { threads: { offset: 0, limit: 20 }, operations: { offset: 0, limit: 10 } },
    });
    assert(workbenchSnapshot.schema === "renderer_safe_direct_thread_workbench_snapshot@1", "Expected direct thread workbench snapshot schema.");
    assert(workbenchSnapshot.workbenchRevision && workbenchSnapshot.operationLedgerHeadDigest !== undefined, "Expected workbench revision and ledger digest.");
    assert(workbenchSnapshot.rawExposure.rawPathExposed === false, "Workbench snapshot must not expose raw paths.");
    assert(workbenchSnapshot.threads.some((entry) => entry.threadId === session.sessionId), "Workbench snapshot should include indexed direct thread.");
    const workbenchThreadRead = await workbenchController.readThreadProjection({ id: "project_fixture" }, session.sessionId, { offset: 0, limit: 2 });
    assert(workbenchThreadRead.projection.page.returned <= 2, "Workbench thread projection read should be paged.");
    const currentWorkbenchRendererProjection = workbenchController.currentThreadProjectionSummary(session.sessionId);
    await assertRejects(
      () => workbenchController.runLifecycleAction({ id: "project_fixture" }, {
        threadId: session.sessionId,
        action: "hide",
        expectedWorkbenchRevision: "stale_revision",
        expectedLifecycleState: "active",
        clientOperationId: "client_workbench_stale_hide",
      }),
      "Workbench mutations must reject stale revisions.",
    );
    await assertRejects(
      () => workbenchController.createBridge({ id: "project_fixture" }, {
        edgeKind: "merge_preview_of",
        sourceKind: "direct_thread",
        sourceId: session.sessionId,
        targetKind: "direct_thread",
        targetId: staleSummarySession.sessionId,
        expectedWorkbenchRevision: workbenchSnapshot.workbenchRevision,
        clientOperationId: "client_workbench_bad_lineage_bridge",
      }),
      "Workbench bridge UI must not create lineage-only edge kinds.",
    );
    await assertRejects(
      () => workbenchController.prepareSoftDelete({ id: "project_fixture" }, activeDeleteBlockedSession.sessionId, {
        expectedWorkbenchRevision: workbenchSnapshot.workbenchRevision,
        expectedLifecycleState: "active",
      }),
      "Workbench soft delete prepare must block non-terminal direct turns.",
    );
    const softDeleteConfirmation = await workbenchController.prepareSoftDelete({ id: "project_fixture" }, interruptedSession.sessionId, {
      expectedWorkbenchRevision: workbenchSnapshot.workbenchRevision,
      expectedLifecycleState: "active",
    });
    assert(softDeleteConfirmation.confirmationId, "Expected workbench soft-delete confirmation nonce.");
    const workbenchSoftDelete = await workbenchController.runLifecycleAction({ id: "project_fixture" }, {
      threadId: interruptedSession.sessionId,
      action: "soft_delete",
      confirmationId: softDeleteConfirmation.confirmationId,
      expectedLifecycleState: "active",
      clientOperationId: "client_workbench_soft_delete",
    });
    assert(workbenchSoftDelete.status === "committed", "Expected workbench soft delete to commit with nonce.");
    assert(workbenchSoftDelete.refreshRequired === true, "Workbench mutations should require refresh in v0.");
    const workbenchPreview = await workbenchController.createForkPreview({ id: "project_fixture" }, {
      threadId: session.sessionId,
      selectedStableSourceItemKeys: [rendererRead.items[0].stableSourceItemKey],
      expectedWorkbenchRevision: workbenchSoftDelete.nextWorkbenchRevision,
      expectedLifecycleState: "active",
      expectedRendererProjectionId: currentWorkbenchRendererProjection.projectionId,
      expectedRendererProjectionDigest: currentWorkbenchRendererProjection.projectionDigest,
      clientOperationId: "client_workbench_fork_preview",
    });
    assert(workbenchPreview.projectionKind === FORK_PREVIEW_PROJECTION_KIND, "Expected workbench fork preview result.");
    const workbenchPreviewRead = await workbenchController.readPreviewProjection({ id: "project_fixture" }, workbenchPreview.projectionId, { offset: 0, limit: 1 });
    assert(workbenchPreviewRead.projection.page.returned === 1, "Workbench preview reads should be paged.");

    const forkStartParent = fs.mkdtempSync(path.join(os.tmpdir(), "direct-fork-start-"));
    try {
      const forkStartSessionStore = new DirectSessionStore({ rootDir: path.join(forkStartParent, "direct-sessions") });
      const forkStartThreadStore = new DirectThreadStore({ rootDir: path.join(forkStartParent, "direct-sessions") });
      const forkSourceSession = forkStartSessionStore.createSession({
        sessionId: "session_fork_start_source",
        projectId: "project_fork_start",
        workspace: { kind: "local", localPath: "[REDACTED:private-path]" },
        title: "Fork start source",
        model: "gpt-5.4",
        runtimeMode: "direct-experimental",
        directTransport: "live-text",
        profileSnapshotId: acceptedLiveTextProfile().profile.profileId,
        sourceClass: "direct-native",
        nativeDirectSession: true,
      }, { nowMs: 1_700_000_016_300 });
      forkStartSessionStore.writeSession({
        ...forkSourceSession,
        messages: [{
          id: "fork_source_turn",
          status: "completed",
          items: [
            {
              id: "fork_source_user",
              type: "userMessage",
              turnId: "fork_source_turn",
              content: [{ type: "text", text: "Build a small parser.", text_elements: [] }],
            },
            {
              id: "fork_source_agent",
              type: "agentMessage",
              turnId: "fork_source_turn",
              text: "Parser implementation plan is ready.",
            },
          ],
        }],
      });
      forkStartThreadStore.indexSessionArtifacts(forkStartSessionStore, forkStartSessionStore.readSession(forkSourceSession.sessionId), [], {
        nowMs: 1_700_000_016_301,
      });
      forkStartThreadStore.buildRendererTranscriptProjection(forkSourceSession.sessionId, {
        sessionStore: forkStartSessionStore,
        nowMs: 1_700_000_016_302,
      });
      const forkSourceProjection = forkStartThreadStore.readRendererTranscriptProjection(forkSourceSession.sessionId, { limit: 50 });
      const forkStartPreviewOperation = forkStartThreadStore.createForkPreview({
        projectId: "project_fork_start",
        threadId: forkSourceSession.sessionId,
        selectedStableSourceItemKeys: forkSourceProjection.items.map((item) => item.stableSourceItemKey),
        clientOperationId: "client_fork_start_preview",
      }, { nowMs: 1_700_000_016_303 });
      const forkStartSse = [
        "event: response.created",
        "data: {\"response\":{\"id\":\"resp_fork_start\",\"model\":\"gpt-5.4\"}}",
        "",
        "event: response.output_text.delta",
        "data: {\"item_id\":\"msg_fork_start\",\"delta\":\"fresh fork ok\"}",
        "",
        "event: response.completed",
        "data: {\"response\":{\"id\":\"resp_fork_start\",\"status\":\"completed\"}}",
        "",
      ].join("\n");
      let forkStartFetchCalls = 0;
      let forkStartRequestBody = null;
      const forkStartRequestBodies = [];
      const forkLiveController = new DirectLiveTextController({
        sessionStore: forkStartSessionStore,
        directThreadStore: forkStartThreadStore,
        profileDoc: acceptedLiveTextProfile(),
        authStore: {
          readStatus: () => ({ status: "authenticated", accountId: "acct_fork_start", hasAccessToken: true }),
          readCredentials: () => ({ accessToken: "fork_start_access_token_secret" }),
        },
        fetchImpl: async (_url, init) => {
          forkStartFetchCalls += 1;
          forkStartRequestBody = JSON.parse(init.body);
          forkStartRequestBodies.push(forkStartRequestBody);
          return textResponse(forkStartSse, 200, { "content-type": "text/event-stream" });
        },
      });
      const forkWorkbenchController = new DirectThreadWorkbenchController({
        threadStore: forkStartThreadStore,
        sessionStore: forkStartSessionStore,
        liveTextController: () => forkLiveController,
        now: () => 1_700_000_016_304,
      });
      const forkWorkbenchSnapshot = await forkWorkbenchController.getSnapshot({
        id: "project_fork_start",
        updatedAt: "2023-11-14T22:13:36.304Z",
      }, { refresh: true });
      const forkStartPreparation = await forkWorkbenchController.prepareForkStart({ id: "project_fork_start" }, {
        sourcePreviewId: forkStartPreviewOperation.projectionId,
        expectedSourcePreviewDigest: forkStartThreadStore.readProjectProjectionByKind("project_fork_start", FORK_PREVIEW_PROJECTION_KIND).projectionDigest,
        expectedWorkbenchRevision: forkWorkbenchSnapshot.workbenchRevision,
        expectedOperationLedgerHeadDigest: forkWorkbenchSnapshot.operationLedgerHeadDigest,
      });
      assert(forkStartPreparation.confirmationId, "Expected fork-start prepare to issue a confirmation id.");
      assert(forkStartPreparation.previousResponseIdUsed === false, "Fork-start prepare must advertise fresh-session semantics.");
      const forkStartResult = await forkWorkbenchController.startForkFromPreview({ id: "project_fork_start" }, {
        clientForkStartId: "client_fork_start_1",
        clientOperationId: "client_fork_start_operation_1",
        confirmationId: forkStartPreparation.confirmationId,
        sourcePreviewId: forkStartPreparation.sourcePreviewId,
        expectedSourcePreviewDigest: forkStartPreparation.sourcePreviewDigest,
        currentUserPrompt: "Start from this evidence and implement the parser.",
        selectedModel: forkStartPreparation.selectedModel,
      });
      assert(forkStartResult.status === "completed", "Expected fork start to complete through fake transport.");
      assert(forkStartFetchCalls === 1, "Expected fork start to send exactly one provider request.");
      assert(forkStartRequestBody.stream === true && forkStartRequestBody.store === false, "Fork start request must stream without provider storage.");
      assert(!forkStartRequestBody.previous_response_id, "Fork start must not use previous_response_id.");
      assert(!forkStartRequestBody.tools, "Fork start must not declare tools.");
      assert(forkStartRequestBody.input[0].content[0].text.includes("[FORK SOURCE EVIDENCE - QUOTED]"), "Fork start request must carry quoted source evidence.");
      const forkedSession = forkStartSessionStore.readSession(forkStartResult.sessionId);
      assert(forkedSession.sourceClass === "forked-direct-native", "Fork start must create a forked direct-native session.");
      assert(forkedSession.providerContinuityAvailable === false, "Forked session must not claim provider continuity.");
      assert(forkedSession.composerState === "enabled", "Forked session composer should enable only after terminal completion.");
      const forkedTurn = forkStartSessionStore.readTurn(forkStartResult.sessionId, forkStartResult.turnId);
      assert(forkedTurn.requestShape.previousResponseIdUsed === false, "Forked first turn must record no provider continuity.");
      const forkStartStatus = await forkWorkbenchController.readForkStartStatus({ id: "project_fork_start" }, forkStartResult.forkStartId);
      assert(forkStartStatus.artifacts.contextPackStored === true && forkStartStatus.artifacts.requestManifestStored === true, "Fork-start status must expose durable context/request artifacts without text.");
      const postForkSnapshot = await forkWorkbenchController.getSnapshot({ id: "project_fork_start" }, { refresh: true });
      const mergePreviewOperation = await forkWorkbenchController.createMergePreview({ id: "project_fork_start" }, {
        sources: [{
          threadId: forkSourceSession.sessionId,
          expectedLifecycleState: "active",
          expectedRendererProjectionId: forkSourceProjection.projectionId,
          expectedRendererProjectionDigest: forkSourceProjection.projectionDigest,
        }],
        expectedWorkbenchRevision: postForkSnapshot.workbenchRevision,
        expectedOperationLedgerHeadDigest: postForkSnapshot.operationLedgerHeadDigest,
        clientOperationId: "client_derived_merge_preview",
      });
      const mergeProjection = forkStartThreadStore.readProjectProjectionByKind("project_fork_start", MERGE_PREVIEW_PROJECTION_KIND);
      const mergePreparation = await forkWorkbenchController.prepareDerivedPreviewForkStart({ id: "project_fork_start" }, {
        sourcePreviewId: mergePreviewOperation.projectionId,
        sourcePreviewKind: MERGE_PREVIEW_PROJECTION_KIND,
        expectedSourcePreviewDigest: mergeProjection.projectionDigest,
      });
      assert(mergePreparation.sourcePreviewKind === MERGE_PREVIEW_PROJECTION_KIND, "Expected derived merge fork preparation to bind source kind.");
      const mergeForkResult = await forkWorkbenchController.startForkFromDerivedPreview({ id: "project_fork_start" }, {
        clientDerivedForkStartId: "client_derived_merge_fork_start_1",
        clientOperationId: "client_derived_merge_fork_operation_1",
        confirmationId: mergePreparation.confirmationId,
        sourcePreviewId: mergePreparation.sourcePreviewId,
        sourcePreviewKind: mergePreparation.sourcePreviewKind,
        expectedSourcePreviewDigest: mergePreparation.sourcePreviewDigest,
        expectedSourcePreviewOperationId: mergePreparation.sourcePreviewOperationId,
        currentUserPrompt: "Start a fresh implementation fork from this merged evidence.",
        selectedModel: mergePreparation.selectedModel,
      });
      assert(mergeForkResult.status === "completed", "Expected merge preview fork start to complete through fake transport.");
      const mergeForkRequestBody = forkStartRequestBodies.at(-1);
      assert(mergeForkRequestBody.store === false && !mergeForkRequestBody.previous_response_id && !mergeForkRequestBody.tools, "Derived merge fork request must be fresh, unstored, and tool-free.");
      assert(mergeForkRequestBody.input[0].content[0].text.includes("[DERIVED PREVIEW SOURCE EVIDENCE - QUOTED]"), "Derived merge fork request must use derived preview evidence framing.");
      assert(mergeForkRequestBody.input[0].content[0].text.includes("Source preview kind: merge_preview@1"), "Derived merge fork seed must cite merge preview kind.");
      const mergeForkSession = forkStartSessionStore.readSession(mergeForkResult.sessionId);
      assert(mergeForkSession.sourceClass === "forked-direct-native", "Derived merge fork must create a forked direct-native session.");
      assert(mergeForkSession.providerContinuityAvailable === false, "Derived merge fork must not claim provider continuity.");
      assert(mergeForkSession.composerState === "enabled_after_completed_first_turn", "Derived merge fork composer should enable only after terminal completion.");
      const mergeRetryFetchCallsBefore = forkStartFetchCalls;
      const mergeForkRetry = await forkLiveController.startForkFromDerivedPreview({
        project: { id: "project_fork_start" },
        sourcePreviewId: mergePreparation.sourcePreviewId,
        sourcePreviewKind: mergePreparation.sourcePreviewKind,
        clientDerivedForkStartId: "client_derived_merge_fork_start_1",
        clientOperationId: "client_derived_merge_fork_operation_1",
        currentUserPrompt: "Start a fresh implementation fork from this merged evidence.",
        selectedModel: mergePreparation.selectedModel,
      });
      assert(mergeForkRetry.sessionId === mergeForkResult.sessionId, "Derived fork retry with same idempotency keys should return the existing session.");
      assert(forkStartFetchCalls === mergeRetryFetchCallsBefore, "Derived fork retry must not resend provider transport.");

      const postMergeSnapshot = await forkWorkbenchController.getSnapshot({ id: "project_fork_start" }, { refresh: true });
      const prunePreviewOperation = await forkWorkbenchController.createPrunePreview({ id: "project_fork_start" }, {
        threadId: forkSourceSession.sessionId,
        excludedStableSourceItemKeys: [forkSourceProjection.items[0].stableSourceItemKey],
        expectedLifecycleState: "active",
        expectedRendererProjectionId: forkSourceProjection.projectionId,
        expectedRendererProjectionDigest: forkSourceProjection.projectionDigest,
        expectedWorkbenchRevision: postMergeSnapshot.workbenchRevision,
        expectedOperationLedgerHeadDigest: postMergeSnapshot.operationLedgerHeadDigest,
        clientOperationId: "client_derived_prune_preview",
      });
      const pruneProjection = forkStartThreadStore.readProjectProjectionByKind("project_fork_start", PRUNE_PREVIEW_PROJECTION_KIND);
      const prunePreparation = await forkWorkbenchController.prepareDerivedPreviewForkStart({ id: "project_fork_start" }, {
        sourcePreviewId: prunePreviewOperation.projectionId,
        sourcePreviewKind: PRUNE_PREVIEW_PROJECTION_KIND,
        expectedSourcePreviewDigest: pruneProjection.projectionDigest,
      });
      const pruneForkResult = await forkWorkbenchController.startForkFromDerivedPreview({ id: "project_fork_start" }, {
        clientDerivedForkStartId: "client_derived_prune_fork_start_1",
        clientOperationId: "client_derived_prune_fork_operation_1",
        confirmationId: prunePreparation.confirmationId,
        sourcePreviewId: prunePreparation.sourcePreviewId,
        sourcePreviewKind: prunePreparation.sourcePreviewKind,
        expectedSourcePreviewDigest: prunePreparation.sourcePreviewDigest,
        expectedSourcePreviewOperationId: prunePreparation.sourcePreviewOperationId,
        currentUserPrompt: "Start a fresh fork from the pruned evidence; do not resume prior state.",
        selectedModel: prunePreparation.selectedModel,
      });
      assert(pruneForkResult.status === "completed", "Expected prune preview fork start to complete through fake transport.");
      const pruneForkRequestBody = forkStartRequestBodies.at(-1);
      assert(pruneForkRequestBody.input[0].content[0].text.includes("Source preview kind: prune_preview@1"), "Derived prune fork seed must cite prune preview kind.");
      assert(pruneForkRequestBody.input[0].content[0].text.includes("OMISSION MARKER"), "Derived prune fork seed must carry visible omission evidence.");
      assert(forkStartFetchCalls === 3, "Expected direct fork plus merge/prune derived starts to send three provider requests.");
      const failedForkSnapshot = await forkWorkbenchController.getSnapshot({ id: "project_fork_start" }, { refresh: true });
      const failedForkPreparation = await forkWorkbenchController.prepareForkStart({ id: "project_fork_start" }, {
        sourcePreviewId: forkStartPreviewOperation.projectionId,
        expectedSourcePreviewDigest: forkStartPreparation.sourcePreviewDigest,
        expectedWorkbenchRevision: failedForkSnapshot.workbenchRevision,
        expectedOperationLedgerHeadDigest: failedForkSnapshot.operationLedgerHeadDigest,
      });
      await assertRejects(
        () => forkWorkbenchController.startForkFromPreview({ id: "project_fork_start" }, {
          clientForkStartId: "client_fork_start_blocked",
          clientOperationId: "client_fork_start_operation_blocked",
          confirmationId: failedForkPreparation.confirmationId,
          sourcePreviewId: failedForkPreparation.sourcePreviewId,
          expectedSourcePreviewDigest: failedForkPreparation.sourcePreviewDigest,
          currentUserPrompt: "Authorization: Bearer fork_start_secret_token",
          selectedModel: failedForkPreparation.selectedModel,
        }),
        "Expected blocked fork-start context build to reject.",
      );
      const failedForkOperation = forkStartThreadStore.operationResult(forkStartThreadStore.operationByClient("project_fork_start", "client_fork_start_operation_blocked"));
      assert(failedForkOperation.status === "failed", "Failed fork-start pre-transport attempt must be recorded as failed operation.");
      const failedForkTurn = forkStartSessionStore.readTurn(failedForkOperation.result.createdSessionId, failedForkOperation.result.createdTurnId);
      assert(failedForkTurn.state === "failed", "Failed fork-start pre-transport attempt must not leave a created turn orphaned.");
      assert(forkStartThreadStore.activeTurnCountForProject("project_fork_start") === 0, "Failed fork-start pre-transport attempt must not leave active project turns.");
    } finally {
      cleanupSmokeTempDir(forkStartParent);
    }

    const staleResult = directThreadStore.markProjectionStale(rendererProjection.projectionId, "manual_rebuild_requested");
    assert(staleResult.staleReason === "manual_rebuild_requested", "Expected projection stale reason to persist.");
    assert(staleResult.invalidatedCompactProjectionIds.includes(compactProjection.projectionId), "Expected compact projection to be invalidated with its renderer source.");
    assert(staleResult.invalidatedContextProjectionIds.includes(contextProjection.projectionId), "Expected context projection to be invalidated with its renderer source.");
    const staleRead = directThreadStore.readRendererTranscriptProjection(session.sessionId);
    assert(staleRead.status === "stale", "Expected stale renderer projection to remain readable while renderer-safe.");
    const invalidatedCompactRead = directThreadStore.readCompactTranscriptProjection(session.sessionId);
    assert(invalidatedCompactRead === null, "Expected compact current pointer to be cleared when renderer source goes stale.");

    const importedProjectionSession = reloadedSessionStore.createSession({
      sessionId: "session_projection_imported",
      projectId: "project_fixture",
      workspace: { kind: "local", localPath: "[REDACTED:private-path]" },
      title: "Imported projection session",
      model: "gpt-5.4",
      sourceClass: "imported-readonly",
      importedSessionReadOnly: true,
    }, { nowMs: 1_700_000_016_250 });
    reloadedSessionStore.writeSession({
      ...importedProjectionSession,
      messages: [{
        id: "import_turn_projection",
        status: "checkpoint-validated",
        imported: true,
        items: [
          {
            id: "import_user_projection",
            type: "userMessage",
            turnId: "import_turn_projection",
            content: [{ type: "text", text: "imported user text", text_elements: [] }],
            imported: true,
          },
          {
            id: "import_agent_projection",
            type: "agentMessage",
            turnId: "import_turn_projection",
            text: "imported assistant text",
            imported: true,
          },
        ],
      }],
    });
    directThreadStore.indexSessionArtifacts(reloadedSessionStore, reloadedSessionStore.readSession(importedProjectionSession.sessionId), [], {
      nowMs: 1_700_000_016_260,
    });
    const importedProjection = directThreadStore.buildRendererTranscriptProjection(importedProjectionSession.sessionId, {
      sessionStore: reloadedSessionStore,
      nowMs: 1_700_000_016_270,
    });
    assert(importedProjection.status === "valid", "Expected imported transcript projection to build as valid.");
    const importedProjectionRead = directThreadStore.readRendererTranscriptProjection(importedProjectionSession.sessionId);
    assert(importedProjectionRead.items.some((item) => item.itemKind === "user_message" && item.text === "imported user text"), "Expected imported user transcript item to be preserved.");
    assert(importedProjectionRead.items.some((item) => item.itemKind === "assistant_message" && item.text === "imported assistant text"), "Expected imported assistant transcript item to be preserved.");
    assert(importedProjectionRead.composer.enabledByProjection === false, "Imported-readonly projection must not enable composer.");

    const blockedSession = reloadedSessionStore.createSession({
      sessionId: "session_projection_blocked",
      projectId: "project_fixture",
      workspace: { kind: "local", localPath: "[REDACTED:private-path]" },
      title: "Blocked projection session",
      model: "gpt-5.4",
      nativeDirectSession: true,
    }, { nowMs: 1_700_000_016_300 });
    reloadedSessionStore.createTurn(blockedSession.sessionId, {
      turnId: "turn_projection_blocked",
      input: [{ role: "user", text: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz" }],
    }, { nowMs: 1_700_000_016_400 });
    directThreadStore.indexSessionArtifacts(reloadedSessionStore, reloadedSessionStore.readSession(blockedSession.sessionId), [
      reloadedSessionStore.readTurn(blockedSession.sessionId, "turn_projection_blocked"),
    ], { nowMs: 1_700_000_016_500 });
    const blockedProjection = directThreadStore.buildRendererTranscriptProjection(blockedSession.sessionId, {
      sessionStore: reloadedSessionStore,
      nowMs: 1_700_000_016_600,
    });
    assert(blockedProjection.status === "blocked", "Expected secret-like projection text to block renderer projection.");
    const blockedCurrentRead = directThreadStore.readRendererTranscriptProjection(blockedSession.sessionId);
    assert(blockedCurrentRead === null, "Blocked projection must not become the current renderer projection.");
    const blockedRead = directThreadStore.readRendererTranscriptProjection(blockedSession.sessionId, {
      projectionId: blockedProjection.projectionId,
    });
    assert(blockedRead.items.length === 0, "Blocked projection must not return normal transcript items.");
    assert(blockedRead.unsafeForRenderer === true, "Blocked projection must be marked unsafe for renderer.");
  } finally {
    directThreadStore.close();
  }

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
  cleanupSmokeTempDir(sessionStoreParent);
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
  cleanupSmokeTempDir(fixtureControllerParent);
}

const liveTextControllerParent = fs.mkdtempSync(path.join(os.tmpdir(), "direct-codex-live-text-controller-"));
try {
  const liveProfileDoc = acceptedLiveTextProfile();
  const liveAuthStore = createDirectAuthStore({ mode: "memory" });
  liveAuthStore.writeCredentials({
    accessToken: "live_text_access_token_secret_1234567890",
    refreshToken: "live_text_refresh_token_secret_1234567890",
    expiresAt: Date.now() + 3_600_000,
    accountId: "[REDACTED:account-id]",
  });
  const liveProject = {
    id: "project_live_text",
    name: "Live Text Project",
    workspace: { kind: "local", localPath: "[REDACTED:private-path]" },
    surfaceBinding: {
      codex: {
        runtimeMode: "direct-experimental",
        directTransport: "live-text",
        model: "gpt-5.4",
        profileId: liveProfileDoc.profile.profileId,
      },
    },
  };
  const liveSse = [
    "event: response.created",
    "data: {\"response\":{\"id\":\"resp_live_text\",\"model\":\"gpt-5.4\"}}",
    "",
    "event: response.reasoning_summary_text.delta",
    "data: {\"item_id\":\"reason_live_text\",\"delta\":\"hidden reasoning summary\"}",
    "",
    "event: response.output_text.delta",
    "data: {\"item_id\":\"msg_live_text\",\"delta\":\"direct\"}",
    "",
    "event: response.output_text.delta",
    "data: {\"item_id\":\"msg_live_text\",\"delta\":\" ok\"}",
    "",
    "event: response.completed",
    "data: {\"response\":{\"id\":\"resp_live_text\",\"status\":\"completed\",\"usage\":{\"input_tokens\":2,\"output_tokens\":2,\"total_tokens\":4}}}",
    "",
    "data: [DONE]",
    "",
  ].join("\n");

  const liveSessionStore = new DirectSessionStore({ rootDir: path.join(liveTextControllerParent, "direct-sessions") });
  let liveFetchCalls = 0;
  let capturedLiveRequest = null;
  const liveController = new DirectLiveTextController({
    sessionStore: liveSessionStore,
    profileDoc: liveProfileDoc,
    authStore: liveAuthStore,
    fetchImpl: async (url, init) => {
      liveFetchCalls += 1;
      capturedLiveRequest = { url, init, body: JSON.parse(init.body) };
      return textResponse(liveSse, 200, { "content-type": "text/event-stream" });
    },
  });
  const liveStatus = liveController.statusForProject(liveProject);
  assert(liveStatus.status === "ready", "Expected accepted model and auth to make live text controller ready.");
  assert(liveStatus.modelEvidenceState === "accepted", "Expected live text status to expose accepted model evidence.");
  assert(liveStatus.appServerRequired === false, "Live text controller must not require app-server.");
  assert(liveStatus.auth.rawTokensExposed === false, "Live text status must not expose raw tokens.");
  const activationBlockedLiveController = new DirectLiveTextController({
    sessionStore: liveSessionStore,
    profileDoc: liveProfileDoc,
    authStore: liveAuthStore,
    activationStatusResolver: () => ({ state: "rollback_required", degradedCapabilities: { canStartNewTextTurn: false } }),
    fetchImpl: async () => textResponse(liveSse, 200, { "content-type": "text/event-stream" }),
  });
  await assertRejects(
    () => activationBlockedLiveController.startThread({}, { project: liveProject }),
    "Expected direct live text thread start to fail closed when activation requires rollback.",
  );

  const candidateController = new DirectLiveTextController({
    sessionStore: liveSessionStore,
    profileDoc,
    authStore: liveAuthStore,
    fetchImpl: async () => textResponse(liveSse, 200, { "content-type": "text/event-stream" }),
  });
  assert(candidateController.statusForProject(liveProject).status === "profile_required", "Observed baseline models must not make live turns runnable.");
  await assertRejects(
    () => candidateController.startThread({}, { project: liveProject }),
    "Expected live text thread start to require accepted or runtime-probed model evidence.",
  );

  const promotionSse = [
    "event: response.created",
    "data: {\"response\":{\"id\":\"resp_live_probe_evidence\",\"model\":\"gpt-5.4\"}}",
    "",
    "event: response.output_text.delta",
    "data: {\"item_id\":\"msg_live_probe_evidence\",\"delta\":\"direct evidence ok\"}",
    "",
    "event: response.completed",
    "data: {\"response\":{\"id\":\"resp_live_probe_evidence\",\"status\":\"completed\",\"usage\":{\"input_tokens\":2,\"output_tokens\":3,\"total_tokens\":5}}}",
    "",
    "data: [DONE]",
    "",
  ].join("\n");
  const promotionResult = await runTextOnlyDirectProbe({
    endpoint: DEFAULT_CODEX_RESPONSES_ENDPOINT,
    credentials: liveAuthStore.readCredentials(),
    profileDoc,
    model: "gpt-5.4",
    prompt: DEFAULT_TEXT_PROBE_PROMPT,
    fetchImpl: async () => textResponse(promotionSse, 200, { "content-type": "text/event-stream" }),
  });
  const liveProbeEvidenceRoot = path.join(liveTextControllerParent, "direct-probe-evidence");
  const liveProbeEvidenceStore = new DirectLiveProbeEvidenceStore({
    rootDir: liveProbeEvidenceRoot,
    allowFakeEvidence: true,
  });
  const liveProbeContext = {
    source: FAKE_SMOKE_SOURCE,
    allowFakeEvidence: true,
    profileDoc,
    authStatus: liveAuthStore.readStatus(),
    credentials: liveAuthStore.readCredentials(),
    endpoint: DEFAULT_CODEX_RESPONSES_ENDPOINT,
    model: "gpt-5.4",
    project: liveProject,
    prompt: DEFAULT_TEXT_PROBE_PROMPT,
    promptClass: FIXED_LIVE_TEXT_PROBE_PROMPT_CLASS,
    evidenceId: "live_probe_evidence_runtime_probed",
    nowMs: Date.now(),
  };
  const recordedLiveProbe = liveProbeEvidenceStore.recordProbeResult(promotionResult, liveProbeContext);
  assert(recordedLiveProbe.evidence.status === "runtime_probed", "Expected exact fake live probe evidence to persist as runtime_probed.");
  assert(recordedLiveProbe.view.usable === true, "Expected exact fake live probe evidence to be usable in test mode.");
  assert(recordedLiveProbe.evidence.result.assistantTextObserved === true, "Runtime-probed evidence must require non-empty assistant text.");
  assert(recordedLiveProbe.evidence.result.usageSummary.observed === true, "Expected usage to be recorded as observed when provider emits usage.");
  assert(directTextRequestShapeHash({ model: "gpt-5.4" }) === directTextRequestShapeHash({ model: "gpt-5.5" }), "Request-shape hash must not include model identity.");
  assert(endpointClass(DEFAULT_CODEX_RESPONSES_ENDPOINT) === "chatgpt-codex-responses", "Expected default direct endpoint class.");
  assert(endpointClass("https://example.invalid/custom/responses") === "custom", "Expected custom endpoints to use a distinct endpoint class.");

	  const liveProbeResolved = liveProbeEvidenceStore.resolveModelEvidence(liveProbeContext);
	  assert(liveProbeResolved.accepted === true, "Expected matching live probe evidence to resolve as accepted.");
	  assert(liveProbeResolved.modelSource === "live-probe", "Expected matching live probe evidence source.");
	  assert(liveProbeResolved.liveProbeEvidence.scope.accountMatches === true, "Expected live probe evidence to be account-scoped.");
	  assert(liveProbeResolved.liveProbeEvidence.scope.workspaceMatches === true, "Expected live probe evidence to be workspace-scoped.");
	  const originalLiveProbeIndex = liveProbeEvidenceStore.readIndex();
	  fs.writeFileSync(liveProbeEvidenceStore.indexPath(), `${JSON.stringify({
	    ...originalLiveProbeIndex,
	    evidence: [],
	    updatedAt: new Date().toISOString(),
	  }, null, 2)}\n`);
	  const externalProbeBlocked = liveProbeEvidenceStore.resolveModelEvidence(liveProbeContext);
	  assert(externalProbeBlocked.accepted === false, "Expected modified evidence index to invalidate cached probe evidence.");
	  fs.writeFileSync(liveProbeEvidenceStore.indexPath(), `${JSON.stringify({
	    ...originalLiveProbeIndex,
	    updatedAt: new Date().toISOString(),
	  }, null, 2)}\n`);
	  const externalProbeAccepted = liveProbeEvidenceStore.resolveModelEvidence(liveProbeContext);
	  assert(externalProbeAccepted.accepted === true, "Expected evidence resolver to reload externally updated probe evidence index.");

	  const evidenceBackedController = new DirectLiveTextController({
    sessionStore: liveSessionStore,
    profileDoc,
    authStore: liveAuthStore,
    modelEvidenceResolver: (context) => liveProbeEvidenceStore.resolveModelEvidence(context),
    fetchImpl: async () => textResponse(promotionSse, 200, { "content-type": "text/event-stream" }),
  });
  const evidenceBackedStatus = evidenceBackedController.statusForProject(liveProject);
  assert(evidenceBackedStatus.status === "ready", "Expected live probe evidence to unlock the candidate-profile live text controller.");
  assert(evidenceBackedStatus.modelSource === "live-probe", "Expected live probe evidence to drive model source.");
  assert(evidenceBackedStatus.modelEvidenceState === "runtime_probed", "Expected live probe evidence state to be runtime_probed.");
  assert(evidenceBackedStatus.liveProbeEvidence.usable === true, "Expected controller status to expose renderer-safe live evidence view.");

  const strictEvidenceStore = new DirectLiveProbeEvidenceStore({ rootDir: liveProbeEvidenceRoot });
  const { allowFakeEvidence: _allowFakeEvidence, source: _fakeSource, evidenceId: _fakeEvidenceId, ...normalResolverContext } = liveProbeContext;
  const strictResolved = strictEvidenceStore.resolveModelEvidence(normalResolverContext);
  assert(strictResolved.accepted === false, "Fake-smoke evidence must be ignored by the normal resolver.");
  assert(strictResolved.liveProbeEvidence.status === "missing", "Normal resolver must hide fake-smoke evidence without explicit test mode.");

  const modelMismatch = liveProbeEvidenceStore.resolveModelEvidence({
    ...liveProbeContext,
    model: "gpt-5.5",
  });
  assert(modelMismatch.accepted === false, "Live probe evidence must not unlock a different model.");
  assert(modelMismatch.liveProbeEvidence.status === "scope_mismatch", "Expected model mismatch to be reported as a scope mismatch.");

  const expiredEvidenceStore = new DirectLiveProbeEvidenceStore({
    rootDir: path.join(liveTextControllerParent, "expired-direct-probe-evidence"),
    allowFakeEvidence: true,
  });
  const expiredRecorded = expiredEvidenceStore.recordProbeResult(promotionResult, {
    ...liveProbeContext,
    evidenceId: "live_probe_evidence_expired",
    nowMs: 1_700_000_060_000,
    ttlMs: 1,
  });
  assert(expiredRecorded.evidence.status === "runtime_probed", "Expired must remain a stored runtime_probed status.");
  assert(computedEvidenceStatus(expiredRecorded.evidence, { nowMs: 1_700_000_061_000 }) === "expired", "Expected expiry to be computed from expiresAt.");
  assert(expiredEvidenceStore.status({ nowMs: 1_700_000_061_000 }).latestStatus === "expired", "Expected store status to compute expiry from index entries.");
  const expiredResolved = expiredEvidenceStore.resolveModelEvidence({
    ...liveProbeContext,
    nowMs: 1_700_000_061_000,
  });
  assert(expiredResolved.accepted === false, "Expired live probe evidence must not unlock runtime.");
  assert(expiredResolved.liveProbeEvidence.status === "expired", "Expected expired evidence status to be computed.");

  const nonRunnableEvidenceStore = new DirectLiveProbeEvidenceStore({
    rootDir: path.join(liveTextControllerParent, "non-runnable-direct-probe-evidence"),
    allowFakeEvidence: true,
  });
  const recordNonRunnableEvidence = (resultPatch, evidenceId) => nonRunnableEvidenceStore.recordProbeResult({
    ...promotionResult,
    ...resultPatch,
  }, {
    ...liveProbeContext,
    evidenceId,
  });
  const unknownEvidence = recordNonRunnableEvidence({
    unknownRawTypes: ["response.unexpected"],
  }, "live_probe_evidence_unknown_event");
  assert(unknownEvidence.view.usable === false, "Unknown raw events must not produce runnable evidence.");
  assert(unknownEvidence.evidence.status === "candidate", "Unknown raw events should remain candidate evidence.");
  const reasoningEvidence = recordNonRunnableEvidence({
    normalizedEvents: [
      ...promotionResult.normalizedEvents,
      { type: "reasoning_delta", itemId: "reasoning_evidence", text: "hidden" },
    ],
  }, "live_probe_evidence_reasoning_event");
  assert(reasoningEvidence.view.usable === false, "Reasoning deltas must not promote live text evidence in this bundle.");
  assert(reasoningEvidence.evidence.status === "candidate", "Reasoning deltas should remain candidate evidence.");
  const toolEvidence = recordNonRunnableEvidence({
    normalizedEvents: [
      ...promotionResult.normalizedEvents,
      { type: "tool_call_started", itemId: "tool_evidence", callId: "call_evidence", name: "read_file" },
    ],
  }, "live_probe_evidence_tool_call");
  assert(toolEvidence.view.usable === false, "Tool calls must not produce runnable text-only evidence.");
  assert(toolEvidence.evidence.result.failureKind === "tool_call_detected", "Expected tool calls to be classified explicitly.");
  const authFailureEvidence = recordNonRunnableEvidence({
    ok: false,
    terminal: { state: "failed", error: { code: "auth_error", message: "unauthorized" } },
    response: { status: 401, ok: false, contentType: "application/json" },
    normalizedEvents: [{ type: "auth_error", code: "auth_error", message: "unauthorized" }],
    unknownRawTypes: [],
  }, "live_probe_evidence_auth_failure");
  assert(authFailureEvidence.view.usable === false, "Auth failures must not produce runnable evidence.");
  assert(authFailureEvidence.evidence.status === "unstable", "Auth failures must not reject the model/request shape globally.");
  assert(authFailureEvidence.evidence.result.failureKind === "auth", "Expected auth failure taxonomy.");

  const unauthController = new DirectLiveTextController({
    sessionStore: liveSessionStore,
    profileDoc: liveProfileDoc,
    authStore: createDirectAuthStore({ mode: "memory" }),
    fetchImpl: async () => textResponse(liveSse, 200, { "content-type": "text/event-stream" }),
  });
  assert(unauthController.statusForProject(liveProject).status === "auth_required", "Expected live text controller to fail closed without direct auth.");
  await assertRejects(
    () => unauthController.startThread({}, { project: liveProject }),
    "Expected live text thread start to require direct auth.",
  );
  const dynamicUnauthStore = createDirectAuthStore({ mode: "memory" });
  const dynamicAuthStore = createDirectAuthStore({ mode: "memory" });
  dynamicAuthStore.writeCredentials({
    accessToken: "dynamic_live_text_access_token_secret_1234567890",
    refreshToken: "dynamic_live_text_refresh_token_secret_1234567890",
    expiresAt: Date.now() + 3_600_000,
    accountId: "[REDACTED:account-id]",
  });
  let dynamicActiveStore = dynamicUnauthStore;
  const dynamicStoreController = new DirectLiveTextController({
    sessionStore: liveSessionStore,
    profileDoc: liveProfileDoc,
    authStore: () => dynamicActiveStore,
    fetchImpl: async () => textResponse(liveSse, 200, { "content-type": "text/event-stream" }),
  });
  assert(dynamicStoreController.statusForProject(liveProject).status === "auth_required", "Expected live text auth getter to see the initial unauthenticated store.");
  dynamicActiveStore = dynamicAuthStore;
  assert(dynamicStoreController.statusForProject(liveProject).status === "ready", "Expected live text auth getter to follow storage mode changes.");

  const liveEvents = [];
  const liveSurface = new DirectLiveTextSurfaceSession({
    isDestroyed: () => false,
    send: (_channel, payload) => liveEvents.push(payload),
  }, {
    controller: liveController,
    project: liveProject,
  });
  const liveConnected = await liveSurface.connect({ transport: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT });
  assert(liveConnected.connected === true, "Expected live text surface session to connect.");
  assert(liveConnected.connection.transport === DIRECT_LIVE_TEXT_SURFACE_TRANSPORT, "Expected live text transport in connection.");
  assert(liveSurface.hasServerRequest() === false, "Live text surface must not expose app-server pending requests.");
  const liveInitialized = await liveSurface.request("initialize", {});
  assert(liveInitialized.runtime === DIRECT_LIVE_TEXT_SURFACE_TRANSPORT, "Expected live text initialize runtime.");
  assert(liveInitialized.capabilities.threads.canStart === true, "Expected ready live text controller to allow thread start.");
  assert(liveInitialized.capabilities.diagnostics.appServerRequired === false, "Expected live text capabilities to deny app-server requirement.");
  const liveAccount = await liveSurface.request("account/read", {});
  assert(liveAccount.requiresOpenaiAuth === false, "Expected authenticated live text account.");
  assert(liveAccount.rawTokensExposed === false, "Expected live text account projection to redact tokens.");
  const liveThread = await liveSurface.request("thread/start", { model: "gpt-5.4" });
  assert(liveThread.thread.id, "Expected live text thread start to create a direct session.");
  const liveAck = await liveSurface.request("turn/start", {
    threadId: liveThread.thread.id,
    promptText: "live text prompt",
    clientTurnRequestId: "client_req_live_text_1",
    model: "gpt-5.4",
  });
  assert(liveAck.turn.status === "inProgress", "Expected live text turn/start to return an immediate ack.");
  await waitForCondition(
    () => liveEvents.some((event) => event.type === "rpc-notification" && event.method === "turn/completed" && event.params?.turnId === liveAck.turn.id),
    "Expected live text surface to emit terminal notification.",
  );
  assert(liveFetchCalls === 1, "Expected live text turn to make exactly one provider request.");
  assert(capturedLiveRequest.body.stream === true && capturedLiveRequest.body.store === false, "Expected live text request to use text-only streaming shape.");
  assert(!capturedLiveRequest.body.tools, "Live text request must not include tools.");
  assert(!capturedLiveRequest.body.tool_choice, "Live text request must not include tool choice.");
  assert(!capturedLiveRequest.body.parallel_tool_calls, "Live text request must not include parallel tool calls.");
  assert(capturedLiveRequest.init.headers.Authorization.startsWith("Bearer "), "Expected live text request to include main-process auth header.");
  const liveDuplicate = await liveSurface.request("turn/start", {
    threadId: liveThread.thread.id,
    promptText: "live text prompt",
    clientTurnRequestId: "client_req_live_text_1",
    model: "gpt-5.4",
  });
  assert(liveDuplicate.reused === true, "Expected duplicate live text client request id to reuse existing turn.");
  assert(liveFetchCalls === 1, "Expected duplicate live text turn/start not to create a second provider request.");
  const livePersisted = liveSessionStore.readSession(liveThread.thread.id);
  assert(livePersisted.runtimeMode === "direct-experimental", "Expected live text session runtime metadata.");
  assert(livePersisted.directTransport === DIRECT_LIVE_TEXT_SURFACE_TRANSPORT, "Expected live text session transport metadata.");
  assert(livePersisted.modelSource === "odeu-profile", "Expected live text session model source metadata.");
  assert(livePersisted.modelEvidenceState === "accepted", "Expected live text session model evidence metadata.");
  assert(livePersisted.workspaceDisplayPath === "[REDACTED:private-path]", "Expected live text session workspace display path metadata.");
  assert(livePersisted.clientTurnRequests.client_req_live_text_1 === liveAck.turn.id, "Expected live text session to persist client turn id mapping.");
  const liveAssistant = livePersisted.messages[0].items.find((item) => item.type === "agentMessage");
  assert(liveAssistant.text === "direct ok", "Expected live text transcript to persist assistant text.");
  assert(!liveAssistant.text.includes("hidden reasoning"), "Reasoning deltas must not render into assistant transcript.");
  const liveAssistantId = `${liveAck.turn.id}_assistant`;
  const liveAssistantStarts = liveEvents.filter((event) => event.type === "rpc-notification" && event.method === "item/started" && event.params?.item?.id === liveAssistantId);
  const liveAssistantDeltas = liveEvents.filter((event) => event.type === "rpc-notification" && event.method === "item/agentMessage/delta" && event.params?.itemId === liveAssistantId);
  const liveAssistantCompletes = liveEvents.filter((event) => event.type === "rpc-notification" && event.method === "item/completed" && event.params?.item?.id === liveAssistantId);
  assert(liveAssistantStarts.length === 1, "Expected live text assistant item to start once.");
  assert(liveAssistantDeltas.length === 2, "Expected live text assistant item to receive stable-id deltas.");
  assert(liveAssistantCompletes.length === 1, "Expected live text assistant item to complete once.");
  assert(!liveEvents.some((event) => JSON.stringify(event).includes("hidden reasoning")), "Reasoning deltas must not be exposed to renderer events.");
  const liveEventLog = fs.readFileSync(liveSessionStore.eventPath(liveThread.thread.id, liveAck.turn.id), "utf8");
  assert(liveEventLog.includes("reasoning_delta"), "Expected reasoning deltas to persist as normalized evidence.");
  const liveRead = await liveSurface.request("thread/read", { threadId: liveThread.thread.id });
  assert(liveRead.thread.turns[0].items.some((item) => item.type === "agentMessage" && item.text === "direct ok"), "Expected thread/read to reconstruct live text transcript.");
  const liveCompletedInterrupt = await liveSurface.request("turn/interrupt", {
    threadId: liveThread.thread.id,
    turnId: liveAck.turn.id,
  });
  assert(liveCompletedInterrupt.status === "completed_already", "Expected abort after completion to preserve completed terminal state.");
  await assertRejects(
    () => liveSurface.request("thread/resume", { threadId: liveThread.thread.id }),
    "Expected unsupported live text methods to fail visibly.",
  );
  assert(liveFetchCalls === 1, "Unsupported live text methods must not be forwarded to provider transport.");

  const truncatedStore = new DirectSessionStore({ rootDir: path.join(liveTextControllerParent, "truncated-direct-sessions") });
  const truncatedController = new DirectLiveTextController({
    sessionStore: truncatedStore,
    profileDoc: liveProfileDoc,
    authStore: liveAuthStore,
    maxAssistantChars: 6,
    fetchImpl: async () => textResponse(liveSse, 200, { "content-type": "text/event-stream" }),
  });
  const truncatedEvents = [];
  const truncatedSurface = new DirectLiveTextSurfaceSession({
    isDestroyed: () => false,
    send: (_channel, payload) => truncatedEvents.push(payload),
  }, {
    controller: truncatedController,
    project: liveProject,
  });
  await truncatedSurface.connect({ transport: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT });
  const truncatedThread = await truncatedSurface.request("thread/start", {});
  const truncatedAck = await truncatedSurface.request("turn/start", {
    threadId: truncatedThread.thread.id,
    promptText: "truncated prompt",
    clientTurnRequestId: "client_req_truncated_live_text_1",
    model: "gpt-5.4",
  });
  await waitForCondition(
    () => truncatedEvents.some((event) => event.type === "rpc-notification" && event.method === "turn/completed" && event.params?.turnId === truncatedAck.turn.id),
    "Expected truncated live text surface to emit terminal notification.",
  );
  const truncatedPersisted = truncatedStore.readSession(truncatedThread.thread.id);
  const truncatedAssistant = truncatedPersisted.messages[0].items.find((item) => item.type === "agentMessage");
  const truncatedRendererText = truncatedEvents
    .filter((event) => event.type === "rpc-notification" && event.method === "item/agentMessage/delta")
    .map((event) => event.params?.delta || "")
    .join("");
  assert(truncatedAssistant.text === "direct", "Expected truncated live text transcript to respect maxAssistantChars.");
  assert(truncatedRendererText === truncatedAssistant.text, "Expected emitted live text deltas to match persisted truncation.");

  const slowStore = new DirectSessionStore({ rootDir: path.join(liveTextControllerParent, "slow-direct-sessions") });
  let slowFetchCalls = 0;
  let releaseSlowFetch = null;
  const slowFetchReleased = new Promise((resolve) => { releaseSlowFetch = resolve; });
  const slowController = new DirectLiveTextController({
    sessionStore: slowStore,
    profileDoc: liveProfileDoc,
    authStore: liveAuthStore,
    fetchImpl: async (_url, init) => {
      slowFetchCalls += 1;
      await slowFetchReleased;
      if (init.signal?.aborted) throw Object.assign(new Error("slow live text aborted"), { name: "AbortError" });
      return textResponse(liveSse, 200, { "content-type": "text/event-stream" });
    },
  });
  const slowEvents = [];
  const slowSurface = new DirectLiveTextSurfaceSession({
    isDestroyed: () => false,
    send: (_channel, payload) => slowEvents.push(payload),
  }, {
    controller: slowController,
    project: liveProject,
  });
  await slowSurface.connect({ transport: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT });
  const slowThread = await slowSurface.request("thread/start", {});
  const slowAck = await slowSurface.request("turn/start", {
    threadId: slowThread.thread.id,
    promptText: "slow prompt",
    clientTurnRequestId: "client_req_slow_live_text_1",
    model: "gpt-5.4",
  });
  await waitForCondition(() => slowFetchCalls === 1, "Expected slow live text fetch to start.");
  const reloadedSlowEvents = [];
  const reloadedSlowSurface = new DirectLiveTextSurfaceSession({
    isDestroyed: () => false,
    send: (_channel, payload) => reloadedSlowEvents.push(payload),
  }, {
    controller: slowController,
    project: liveProject,
  });
  await reloadedSlowSurface.connect({ transport: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT });
  const slowRunningRead = await reloadedSlowSurface.request("thread/read", { threadId: slowThread.thread.id });
  assert(slowRunningRead.thread.id === slowThread.thread.id, "Expected renderer reload to read the main-owned live text session.");
  const slowDuplicateFromReload = await reloadedSlowSurface.request("turn/start", {
    threadId: slowThread.thread.id,
    promptText: "slow prompt",
    clientTurnRequestId: "client_req_slow_live_text_1",
    model: "gpt-5.4",
  });
  assert(slowDuplicateFromReload.reused === true, "Expected renderer reload duplicate request to reuse active live turn.");
  assert(slowFetchCalls === 1, "Renderer reload must not start a second live provider request.");
  await assertRejects(
    () => reloadedSlowSurface.request("turn/start", {
      threadId: slowThread.thread.id,
      promptText: "second slow prompt",
      clientTurnRequestId: "client_req_slow_live_text_2",
      model: "gpt-5.4",
    }),
    "Expected live text controller to reject a second active turn in the same session.",
  );
  const slowAbort = await slowSurface.request("turn/interrupt", {
    threadId: slowThread.thread.id,
    turnId: slowAck.turn.id,
  });
  assert(slowAbort.status === "abort_requested", "Expected live text abort to request cancellation while stream is active.");
  releaseSlowFetch();
  await waitForCondition(
    () => slowEvents.some((event) => event.type === "rpc-notification" && event.method === "turn/completed" && event.params?.turnId === slowAck.turn.id),
    "Expected slow live text abort to emit a terminal notification.",
  );
  const slowAbortedTurn = slowStore.readTurn(slowThread.thread.id, slowAck.turn.id);
  assert(slowAbortedTurn.state === "aborted", "Expected aborted live text turn to persist aborted state.");
  const slowDuplicateAfterAbort = await reloadedSlowSurface.request("turn/start", {
    threadId: slowThread.thread.id,
    promptText: "slow prompt",
    clientTurnRequestId: "client_req_slow_live_text_1",
    model: "gpt-5.4",
  });
  assert(slowDuplicateAfterAbort.reused === true, "Expected duplicate live text request to reuse aborted terminal snapshot.");
  assert(slowFetchCalls === 1, "Expected aborted duplicate live text request not to retry the original provider request.");

  const toolStore = new DirectSessionStore({ rootDir: path.join(liveTextControllerParent, "tool-direct-sessions") });
  const liveToolSse = [
    "event: response.created",
    "data: {\"response\":{\"id\":\"resp_live_tool\",\"model\":\"gpt-5.4\"}}",
    "",
    "event: response.output_item.added",
    "data: {\"item\":{\"id\":\"tool_live_text\",\"type\":\"function_call\",\"call_id\":\"call_live_read\",\"name\":\"read_file\"}}",
    "",
    "event: response.function_call_arguments.delta",
    "data: {\"item_id\":\"tool_live_text\",\"call_id\":\"call_live_read\",\"delta\":\"{\\\"path\\\"\"}",
    "",
    "event: response.function_call_arguments.delta",
    "data: {\"item_id\":\"tool_live_text\",\"call_id\":\"call_live_read\",\"delta\":\":\\\"README.md\\\"}\"}",
    "",
    "event: response.output_item.done",
    "data: {\"item\":{\"id\":\"tool_live_text\",\"type\":\"function_call\",\"call_id\":\"call_live_read\",\"name\":\"read_file\",\"arguments\":\"{\\\"path\\\":\\\"README.md\\\"}\"}}",
    "",
    "event: response.completed",
    "data: {\"response\":{\"id\":\"resp_live_tool\",\"status\":\"completed\"}}",
    "",
  ].join("\n");
  const toolController = new DirectLiveTextController({
    sessionStore: toolStore,
    profileDoc: liveProfileDoc,
    authStore: liveAuthStore,
    fetchImpl: async () => textResponse(liveToolSse, 200, { "content-type": "text/event-stream" }),
  });
  const liveToolEvents = [];
  const liveToolSurface = new DirectLiveTextSurfaceSession({
    isDestroyed: () => false,
    send: (_channel, payload) => liveToolEvents.push(payload),
  }, {
    controller: toolController,
    project: liveProject,
  });
  await liveToolSurface.connect({ transport: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT });
  const liveToolThread = await liveToolSurface.request("thread/start", {});
  const liveToolAck = await liveToolSurface.request("turn/start", {
    threadId: liveToolThread.thread.id,
    promptText: "tool prompt",
    clientTurnRequestId: "client_req_live_tool_1",
    model: "gpt-5.4",
  });
  await waitForCondition(
    () => liveToolEvents.some((event) => event.type === "rpc-notification" && event.method === "turn/completed" && event.params?.turnId === liveToolAck.turn.id),
    "Expected live text tool detection to emit a terminal notification.",
  );
  const liveToolTurn = toolStore.readTurn(liveToolThread.thread.id, liveToolAck.turn.id);
  const liveToolSession = toolStore.readSession(liveToolThread.thread.id);
  assert(liveToolTurn.state === "failed", "Expected live text tool call to fail closed without accepted tool-continuation evidence.");
  assert(liveToolTurn.unresolvedObligations.length === 1, "Expected live text tool call to persist one obligation.");
  assert(liveToolTurn.unresolvedObligations[0].executionAllowed === false, "Live text tool detection must not authorize execution before approval.");
  assert(liveToolTurn.unresolvedObligations[0].continuationAllowed === false, "Live text tool detection must not authorize continuation.");
  assert(liveToolTurn.unresolvedObligations[0].sideEffectExecuted === false, "Live text tool detection must not execute side effects.");
  assert(liveToolTurn.unresolvedObligations[0].status === "unsupported", "Expected text-only evidence alone not to unlock read-only tool continuation.");
  assert(liveToolTurn.unresolvedObligations[0].failureKind === "tool_continuation_profile_required", "Expected missing tool-continuation profile gate to be explicit.");
  assert(liveToolSession.messages[0].items.some((item) => item.type === "dynamicToolCall" && item.status === "unsupported"), "Expected unsupported tool call to render in transcript.");
  assert(liveToolSurface.hasServerRequest() === false, "Text-only runtime evidence alone must not create read-only authority requests.");
  assert(!liveToolEvents.some((event) => event.type === "rpc-request" && event.request?.method === "direct/tool/readOnly/requestApproval"), "Text-only evidence alone must not expose tool approval.");
  assert(liveToolEvents.some((event) => event.type === "rpc-notification" && event.method === "warning"), "Expected live text tool detection to warn about local authority state.");
  const liveToolAbort = await liveToolSurface.request("turn/interrupt", {
    threadId: liveToolThread.thread.id,
    turnId: liveToolAck.turn.id,
  });
  assert(liveToolAbort.status === "failed_already", "Expected failed unsupported tool turn to remain terminal.");

  const approvedToolStore = new DirectSessionStore({ rootDir: path.join(liveTextControllerParent, "approved-tool-direct-sessions") });
  const approvedContinuationSse = [
    "event: response.created",
    "data: {\"response\":{\"id\":\"resp_live_tool_continued\",\"model\":\"gpt-5.4\"}}",
    "",
    "event: response.output_text.delta",
    "data: {\"item_id\":\"msg_live_tool_continued\",\"delta\":\"read result accepted\"}",
    "",
    "event: response.completed",
    "data: {\"response\":{\"id\":\"resp_live_tool_continued\",\"status\":\"completed\"}}",
    "",
  ].join("\n");
  let approvedFetchCalls = 0;
  let approvedContinuationBody = null;
  let approvedWorkspaceReads = 0;
  const approvedToolThreadStore = new DirectThreadStore({
    rootDir: path.join(liveTextControllerParent, "approved-tool-direct-thread-store"),
    mode: "index_only",
  });
  const approvedToolController = new DirectLiveTextController({
    sessionStore: approvedToolStore,
    directThreadStore: approvedToolThreadStore,
    profileDoc: acceptedReadOnlyToolProfile(),
    authStore: liveAuthStore,
    readOnlyWorkspaceTimeoutMs: 45_000,
    toolDecisionCacheLimit: 1,
    workspaceRequest: async (project, method, params, timeoutMs) => {
      approvedWorkspaceReads += 1;
      assert(project.id === liveProject.id, "Expected direct read-only controller to preserve project binding.");
      assert(method === "readFile", "Expected direct read-only controller to route through workspace readFile.");
      assert(params.relPath === "README.md", "Expected direct read-only controller to request the approved relative path.");
      assert(params.rejectSensitive === true, "Expected direct read-only controller to enforce sensitive-path policy in workspace backend.");
      assert(params.maxBytes === 384 * 1024, "Expected direct read-only controller to pass bounded read size.");
      assert(timeoutMs === 45_000, "Expected direct read-only controller to use configured workspace timeout.");
      return {
        relPath: "README.md",
        size: 23,
        truncated: false,
        binary: false,
        text: "live approved read result",
        source: "local",
        absolutePath: "/private/path/README.md",
      };
    },
    fetchImpl: async (_url, init = {}) => {
      approvedFetchCalls += 1;
      if (approvedFetchCalls === 2 && init.body) approvedContinuationBody = JSON.parse(init.body);
      return textResponse(approvedFetchCalls === 1 ? liveToolSse : approvedContinuationSse, 200, { "content-type": "text/event-stream" });
    },
  });
  const approvedToolEvents = [];
  const approvedToolSurface = new DirectLiveTextSurfaceSession({
    isDestroyed: () => false,
    send: (_channel, payload) => approvedToolEvents.push(payload),
  }, {
    controller: approvedToolController,
    project: liveProject,
  });
  await approvedToolSurface.connect({ transport: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT });
  const approvedThread = await approvedToolSurface.request("thread/start", {});
  const approvedAck = await approvedToolSurface.request("turn/start", {
    threadId: approvedThread.thread.id,
    promptText: "approved tool prompt",
    clientTurnRequestId: "client_req_live_tool_approved_1",
    model: "gpt-5.4",
  });
  await waitForCondition(
    () => approvedToolEvents.some((event) => event.type === "rpc-request" && event.request?.method === "direct/tool/readOnly/requestApproval"),
    "Expected approved live text tool path to request read-only authority.",
  );
  const approvalRequest = approvedToolEvents.find((event) => event.type === "rpc-request")?.request;
  assert(approvalRequest.params.relPath === "README.md", "Expected approval request to show relative path.");
  assert(approvalRequest.params.approvalAvailable === true, "Expected approval request to be available only after completed parseable arguments.");
  assert(approvalRequest.params.hasContinuityHandle === true, "Expected approval request to require original response continuity.");
  const approvalResponse = await approvedToolSurface.respond(approvalRequest.key, {
    decision: "approve",
    clientToolDecisionId: "client_tool_decision_approved_1",
  });
  assert(approvalResponse.response.continuation.ok === true, "Expected approved direct read-only tool continuation to complete.");
  assert(approvedFetchCalls === 2, "Expected approved direct tool path to make one initial and one continuation provider request.");
  assert(approvedWorkspaceReads === 1, "Expected approved direct tool path to read the workspace exactly once.");
  assert(approvedToolSurface.hasServerRequest() === false, "Expected completed read-only approval request not to remain pending.");
  const approvedTurn = approvedToolStore.readTurn(approvedThread.thread.id, approvedAck.turn.id);
  assert(approvedTurn.state === "completed", "Expected approved direct read-only continuation to complete the turn.");
  assert(approvedTurn.streamPhase === "continuation", "Expected approved continuation to record continuation stream phase.");
  assert(approvedTurn.continuationRequestShape.hasPreviousResponseId === true, "Expected approved continuation to require previous_response_id.");
  assert(approvedTurn.contextBuildId, "Expected approved live tool continuation to persist context build id before transport.");
  assert(approvedTurn.requestManifestId, "Expected approved live tool continuation to persist request manifest id before transport.");
  const approvedToolContextPack = approvedToolThreadStore.readContextPack(approvedTurn.contextBuildId);
  const approvedToolRequestManifest = approvedToolThreadStore.readRequestManifest(approvedTurn.requestManifestId);
  assert(approvedToolContextPack.policy.policyId === DIRECT_READONLY_TOOL_CONTINUATION_POLICY_ID, "Expected approved live tool continuation to use read-only tool context policy.");
  assert(approvedToolRequestManifest.enabledFeatures.previousResponseId === true, "Expected approved live tool manifest to record previous_response_id.");
  assert(approvedToolRequestManifest.enabledFeatures.store === false, "Expected approved live tool manifest to record store=false.");
  assert(approvedToolRequestManifest.rawRequestBodyStored === false, "Expected approved live tool manifest not to store raw request body.");
  assert(approvedContinuationBody.instructions.includes("Do not request or execute another tool"), "Expected approved live tool continuation request to preserve continuation-specific instructions.");
  const approvedObligation = approvedTurn.unresolvedObligations[0];
  assert(approvedObligation.status === "continuation_sent", "Expected approved obligation to record sent continuation.");
  assert(JSON.parse(approvedObligation.result.providerOutputText).textPreview === "live approved read result", "Expected approved provider output to be bounded JSON evidence.");
  const approvedSession = approvedToolStore.readSession(approvedThread.thread.id);
  assert(approvedSession.messages[0].items.some((item) => item.type === "agentMessage" && item.text === "read result accepted"), "Expected approved continuation assistant output to persist.");
  await approvedToolSurface.respond(approvalRequest.key, {
    decision: "approve",
    clientToolDecisionId: "client_tool_decision_approved_1",
  });
  assert(approvedWorkspaceReads === 1, "Expected duplicate completed approval response not to reread workspace.");
  assert(approvedToolController.toolDecisionClaims.size <= 1, "Expected direct tool decision claim cache to stay bounded.");
  assert(approvedToolController.toolDecisionResults.size <= 1, "Expected direct tool decision result cache to stay bounded.");
  approvedToolThreadStore.close();
} finally {
  cleanupSmokeTempDir(liveTextControllerParent);
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
  cleanupSmokeTempDir(authStoreParent);
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

const currentResponsesLifecycleEvents = normalizeDirectCodexEvents([
  { event: "response.created", data: { response: { id: "resp_lifecycle", model: "gpt-5.5" } } },
  { event: "response.output_item.added", data: { item: { id: "msg_lifecycle", type: "message", role: "assistant" } } },
  { event: "response.content_part.added", data: { item_id: "msg_lifecycle", content_index: 0 } },
  { event: "response.output_text.delta", data: { item_id: "msg_lifecycle", delta: "direct text probe ok" } },
  { event: "response.output_text.done", data: { item_id: "msg_lifecycle", text: "direct text probe ok" } },
  { event: "response.content_part.done", data: { item_id: "msg_lifecycle", content_index: 0 } },
  { event: "response.output_item.done", data: { item: { id: "msg_lifecycle", type: "message", role: "assistant" } } },
  { event: "response.completed", data: { response: { id: "resp_lifecycle", status: "completed" } } },
], { failOnUnknown: true, model: "gpt-5.5" });
assert(currentResponsesLifecycleEvents.unknown.length === 0, "Expected known Responses message lifecycle events not to block live probe evidence.");
assert(currentResponsesLifecycleEvents.normalized.some((event) => event.type === "message_delta"), "Expected current Responses lifecycle sample to preserve assistant text.");

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
  const whitespaceResult = projectReadResult({
    relPath: "README.md",
    size: 7,
    truncated: false,
    binary: false,
    text: "  x  \n",
    source: "local",
  }, {
    obligationId: "tool_obligation_whitespace_result",
    name: "read_file",
  }, new Date(1_700_000_021_500).toISOString(), 1_700_000_021_500);
  assert(whitespaceResult.textPreview === "  x  \n", "Expected read-only result preview to preserve leading and trailing whitespace.");
  assert(JSON.parse(whitespaceResult.providerOutputText).textPreview === "  x  \n", "Expected provider output envelope to preserve exact file whitespace.");
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
  const continuationOutputEnvelope = JSON.parse(continuationRequest.toolResult.content[0].text);
  assert(continuationOutputEnvelope.textPreview === "fixture read result", "Expected continuation to include recorded tool output in a bounded envelope.");
  assert(continuationOutputEnvelope.truncated === false, "Expected continuation envelope to preserve truncation truth.");
  assert(!JSON.stringify(continuationRequest).includes("/private/path"), "Read-only continuation must not expose raw workspace paths.");
  assertThrows(() => projectReadResult({
    relPath: "src/config.txt",
    size: 64,
    truncated: false,
    binary: false,
    text: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456",
    source: "local",
  }, {
    obligationId: "tool_obligation_secret_result",
    name: "read_file",
  }, new Date(1_700_000_022_200).toISOString(), 1_700_000_022_200), "Expected read-only provider output to block auth-like file content.");
  const probeThreadStore = new DirectThreadStore({
    rootDir: path.join(textProbeParent, "direct-thread-store"),
    mode: "index_only",
  });
  try {
    probeThreadStore.indexSessionArtifacts(probeSessionStore, probeSessionStore.readSession(persistedToolProbe.sessionId), [
      probeSessionStore.readTurn(persistedToolProbe.sessionId, persistedToolProbe.turnId),
    ], { nowMs: 1_700_000_022_300 });
    const obligationProjection = probeThreadStore.buildDirectObligationsProjection(persistedToolProbe.sessionId, persistedToolProbe.turnId, {
      sessionStore: probeSessionStore,
      nowMs: 1_700_000_022_400,
    });
    assert(obligationProjection.projectionKind === DIRECT_OBLIGATIONS_PROJECTION_KIND, "Expected direct obligations projection kind.");
    assert(obligationProjection.status === "valid", "Expected unsupported-free obligation projection to be valid.");
    const obligationProjectionRead = probeThreadStore.readProjectionByKind(persistedToolProbe.sessionId, DIRECT_OBLIGATIONS_PROJECTION_KIND);
    assert(obligationProjectionRead.items[0].actionHints.authoritative === false, "Obligation projection action hints must not be authoritative.");
    assert(obligationProjectionRead.items[0].itemValidity.usableForContinuation === true, "Expected recorded read_file obligation item to be usable for continuation.");
    const continuationWithContextSource = {
      ...continuationRequest,
      source: {
        ...(continuationRequest.source || {}),
        previousResponseId: "resp_tool_probe",
      },
    };
    const toolContext = probeThreadStore.buildAndPersistContextForToolContinuation({
      sessionStore: probeSessionStore,
      session: probeSessionStore.readSession(persistedToolProbe.sessionId),
      projectId: "project_direct_text_probe",
      threadId: persistedToolProbe.sessionId,
      turnId: persistedToolProbe.turnId,
      obligationId: persistedToolProbe.toolObligations[0].obligationId,
      continuationRequest: continuationWithContextSource,
      previousResponseId: "resp_tool_probe",
      model: "gpt-5.4",
      requestShape: {
        kind: "read_only_tool_continuation",
        stream: true,
        store: false,
        tools: false,
        hasPreviousResponseId: true,
        functionCallOutputCount: 1,
      },
      requestShapeEvidenceRef: "continuation.tool_result",
      modelEvidenceRef: "model_evidence_fixture",
      endpointEvidenceRef: "endpoint_fixture",
      endpointHash: "endpoint_hash_fixture",
    }, {
      sessionStore: probeSessionStore,
      nowMs: 1_700_000_022_500,
    });
    assert(toolContext.toolContinuationContext.projectionKind === TOOL_CONTINUATION_CONTEXT_PROJECTION_KIND, "Expected tool continuation context projection kind.");
    assert(toolContext.contextPack.policy.policyId === DIRECT_READONLY_TOOL_CONTINUATION_POLICY_ID, "Expected read-only tool continuation context policy.");
    assert(toolContext.contextPack.messages.some((message) => message.authority === "tool-result-evidence"), "Expected tool result evidence in continuation context pack.");
    assert(toolContext.providerInput.instructions.includes("Fresh local authority"), "Expected continuation provider input to resend harness policy.");
    assert(toolContext.providerInput.instructions.includes("Do not request or execute another tool"), "Expected continuation provider input to include continuation-specific guidance.");
    assert(!toolContext.toolContinuationItems[0].text.includes("[LOCAL READ-ONLY TOOL RESULT EVIDENCE - QUOTED]"), "Expected tool continuation projection item text not to duplicate context-pack framing.");
    const continuationIntent = toolContext.contextPack.messages.find((message) => message.text.startsWith("[CONTINUATION INTENT]"));
    assert(
      continuationIntent.textHash === crypto.createHash("sha256").update(continuationIntent.text).digest("hex"),
      "Expected continuation intent hash to match actual message text.",
    );
    assert(toolContext.requestManifest.enabledFeatures.store === false, "Expected tool continuation manifest to record store=false.");
    assert(toolContext.requestManifest.enabledFeatures.previousResponseId === true, "Expected tool continuation manifest to record previous_response_id usage.");
    assert(toolContext.requestManifest.continuity.importedContinuityHandleUsed === false, "Tool continuation manifest must not use imported continuity.");
    assert(toolContext.requestManifest.rawRequestBodyStored === false, "Tool continuation manifest must not store raw request body.");
    assert(probeThreadStore.readContextPack(toolContext.contextPack.contextBuildId).schema === "direct_context_pack@1", "Expected persisted tool continuation context pack.");
    assert(probeThreadStore.readRequestManifest(toolContext.requestManifest.requestManifestId).schema === "direct_request_manifest@1", "Expected persisted tool continuation request manifest.");
  } finally {
    probeThreadStore.close();
  }
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
  assert(JSON.parse(capturedContinuationRequest.body.input[0].output).textPreview === "fixture read result", "Expected read-only continuation to send recorded tool output envelope.");
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
    namespace: "",
    toolType: "function_call",
    providerCallType: "function_call",
    argumentsText: "{\"path\":\"README.md\"}",
    completedAtSequence: 3,
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
  cleanupSmokeTempDir(textProbeParent);
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
assert(normalizedSmokePath(importCandidate.source.codexHome).endsWith("/tmp/codex"), "Expected import candidate to preserve source CODEX_HOME.");
assert(importCandidate.source.sourceFileSha256.length === 64, "Expected import candidate to preserve source digest.");
assert(importCandidate.lineage.importId, "Expected import candidate lineage.");
const stableRecordCandidateA = buildImportCandidate([
  { timestamp: "2026-04-25T10:00:00Z", thread_id: "thread_stable", message: { role: "user", content: "Stable." } },
]);
const stableRecordCandidateB = buildImportCandidate([
  { message: { content: "Stable.", role: "user" }, thread_id: "thread_stable", timestamp: "2026-04-25T10:00:00Z" },
]);
assert(stableRecordCandidateA.nodes[0].sourceHash === stableRecordCandidateB.nodes[0].sourceHash, "Expected import source hashes to be stable across object key order.");
assert(stableRecordCandidateA.source.sourceFileSha256 === stableRecordCandidateB.source.sourceFileSha256, "Expected import source digest to be stable across object key order.");
const importCheckpoint = buildDirectCheckpointCandidate(importCandidate, { nowMs: 1_700_000_040_000 });
assert(importCheckpoint.schema === "direct_codex_import_checkpoint_candidate@1", "Expected direct import checkpoint candidate schema.");
assert(importCheckpoint.state === "checkpoint-candidate", "Expected import checkpoint candidate state.");
assert(importCheckpoint.runnable === false, "Import checkpoint candidate must not be runnable.");
assert(importCheckpoint.target.eligibleForContinuation === false, "Import checkpoint candidate must not allow continuation yet.");
assert(normalizedSmokePath(importCheckpoint.source.filePath).endsWith("/tmp/codex/history/thread_1.jsonl"), "Expected import checkpoint to preserve source file path.");
assert(normalizedSmokePath(importCheckpoint.source.codexHome).endsWith("/tmp/codex"), "Expected import checkpoint to preserve source CODEX_HOME.");
assert(importCheckpoint.checkpoint.messages.length === 1, "Expected import checkpoint to preserve user-visible messages.");
assert(importCheckpoint.checkpoint.unresolvedObligations.length === 1, "Expected import checkpoint to carry unresolved obligations.");
assert(importCheckpoint.checkpoint.unresolvedObligations[0].autoReplayable === false, "Imported tool calls must not be auto-replayable.");
assert(importCheckpoint.validation.importedApprovalsCarryAuthority === false, "Imported approvals must not carry future authority.");
const unresolvedImportValidation = validateDirectCheckpointCandidate(importCheckpoint, { nowMs: 1_700_000_040_500 });
assert(unresolvedImportValidation.state === "checkpoint-candidate", "Expected unresolved import checkpoint to remain a checkpoint candidate.");
assert(unresolvedImportValidation.runnable === false, "Expected unresolved import checkpoint to remain non-runnable.");
assert(unresolvedImportValidation.target.eligibleForContinuation === false, "Expected unresolved import checkpoint not to allow continuation.");
assert(unresolvedImportValidation.validation.gates.unresolvedImportedToolCallsClear === false, "Expected unresolved import checkpoint validation to block on tool obligations.");
assert(unresolvedImportValidation.validationReport.blockers.some((blocker) => blocker.code === "unresolved_imported_tool_calls"), "Expected unresolved tool call blocker.");
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
assert(roleOnlyValidation.validation.gates.userVisibleTextPreserved === false, "Expected role-only import validation to require user-visible text before checkpoint validation.");
const cleanImportCandidate = buildImportCandidate([
  { timestamp: "2026-04-25T10:00:04Z", thread_id: "thread_clean", message: { role: "user", content: "Inspect this file." } },
  { timestamp: "2026-04-25T10:00:05Z", thread_id: "thread_clean", message: { role: "assistant", content: "Inspection complete." } },
], {
  sourcePath: "/tmp/codex/history/thread_clean.jsonl",
  codexHome: "/tmp/codex",
});
const cleanCheckpoint = buildDirectCheckpointCandidate(cleanImportCandidate, { nowMs: 1_700_000_042_000 });
const cleanValidation = validateDirectCheckpointCandidate(cleanCheckpoint, {
  nowMs: 1_700_000_043_000,
  workspaceMatch: {
    status: "matched",
    selectedProjectId: "project_clean_import",
    selectedWorkspaceKind: "local",
    selectedWorkspaceDisplay: "/tmp/workspace",
    matchMethod: "user-confirmed",
    confidence: "high",
  },
});
assert(cleanValidation.state === "checkpoint-validated", "Expected clean import checkpoint to validate as checkpoint-validated.");
assert(cleanValidation.runnable === false, "Validated import checkpoint must still not be runnable in this bundle.");
assert(cleanValidation.target.eligibleForContinuation === true, "Expected clean import checkpoint to become eligible for continuation.");
assert(cleanValidation.eligibility.directContinuationRunnableNow === false, "Expected clean import checkpoint not to be runnable now.");
assert(cleanValidation.validation.gates.sourceFilePathPreserved === true, "Expected clean import validation to require source file path.");
assert(cleanValidation.validation.gates.sourceCodexHomePreserved === true, "Expected clean import validation to require source CODEX_HOME.");
assert(cleanValidation.validation.gates.sourceThreadIdPreserved === true, "Expected clean import validation to require source thread id.");
assert(cleanValidation.validation.importedApprovalsCarryAuthority === false, "Validated imported checkpoints must not inherit approval authority.");
const authLikeCandidate = buildImportCandidate([
  { timestamp: "2026-04-25T10:00:06Z", thread_id: "thread_auth", message: { role: "user", content: "secret check" }, headers: { Authorization: "Bearer abcdefghijklmnop" } },
], {
  sourcePath: "/tmp/codex/history/thread_auth.jsonl",
  codexHome: "/tmp/codex",
});
const authLikeCheckpoint = buildDirectCheckpointCandidate(authLikeCandidate, { nowMs: 1_700_000_043_500 });
const authLikeValidation = validateDirectCheckpointCandidate(authLikeCheckpoint, {
  nowMs: 1_700_000_043_600,
  workspaceMatch: {
    status: "matched",
    selectedProjectId: "project_auth_import",
    selectedWorkspaceKind: "local",
    selectedWorkspaceDisplay: "/tmp/workspace",
    matchMethod: "user-confirmed",
    confidence: "high",
  },
});
assert(authLikeValidation.state !== "checkpoint-validated", "Expected auth-like imported material to block checkpoint validation.");
assert(authLikeValidation.validation.gates.rawAuthMaterialObserved === true, "Expected nested auth-like material to be detected.");
const importStoreParent = fs.mkdtempSync(path.join(os.tmpdir(), "direct-codex-import-store-"));
try {
  const importSessionStore = new DirectSessionStore({ rootDir: path.join(importStoreParent, "direct-sessions") });
  assertThrows(
    () => materializeDirectImportSession(authLikeValidation, {
      sessionStore: importSessionStore,
      nowMs: 1_700_000_043_700,
    }),
    "Expected auth-like imports to be blocked before materialization writes artifacts.",
  );
  const materializedReadonly = materializeDirectImportSession(unresolvedImportValidation, {
    sessionStore: importSessionStore,
    nowMs: 1_700_000_044_000,
  });
  assert(materializedReadonly.schema === "direct_codex_materialized_import_session@1", "Expected materialized import session schema.");
  assert(materializedReadonly.importState === "checkpoint-candidate", "Expected unresolved import materialization to preserve checkpoint-candidate state.");
  assert(materializedReadonly.readOnlyImported === true, "Expected unresolved import materialization to remain read-only.");
  assert(materializedReadonly.continuationEligible === false, "Expected unresolved import materialization not to allow continuation.");
  assert(materializedReadonly.nativeDirectSession === false, "Expected unresolved import materialization to remain non-native.");
  const materializedReadonlySession = importSessionStore.readSession(materializedReadonly.sessionId);
  assert(materializedReadonlySession.runtimeMode === "imported-readonly", "Expected unresolved import session runtime mode.");
  assert(normalizedSmokePath(materializedReadonlySession.importSource.filePath).endsWith("/tmp/codex/history/thread_1.jsonl"), "Expected materialized import session to preserve source path.");
  assert(normalizedSmokePath(materializedReadonlySession.importSource.codexHome).endsWith("/tmp/codex"), "Expected materialized import session to preserve CODEX_HOME.");
  assert(materializedReadonlySession.readOnlyImported === true, "Expected materialized import session to stay read-only.");
  assert(materializedReadonlySession.nativeDirectSession === false, "Expected materialized import session not to be native direct.");
  assert(materializedReadonlySession.messages[0].items.length === 1, "Expected materialized import session to preserve transcript items.");
  assert(materializedReadonlySession.turns.length === 1, "Expected materialized import session to persist a turn summary.");
  assert(materializedReadonlySession.turns[0].state === "checkpoint_required", "Expected unresolved materialized import turn to require checkpoint.");
  const materializedReadonlyTurn = importSessionStore.readTurn(materializedReadonly.sessionId, materializedReadonly.turnId);
  assert(materializedReadonlyTurn.imported === true, "Expected materialized import turn JSON to persist.");
  assert(materializedReadonlyTurn.importState === "checkpoint-candidate", "Expected materialized import turn state.");
  assert(materializedReadonlySession.unresolvedObligations[0].autoReplayable === false, "Expected materialized import obligations not to auto-replay.");
  assert(materializedReadonlySession.compactionCheckpoints[0].runnable === false, "Expected unresolved import checkpoint to remain non-runnable.");
  const rematerializedReadonly = materializeDirectImportSession(unresolvedImportValidation, {
    sessionStore: importSessionStore,
    sessionId: materializedReadonly.sessionId,
    nowMs: 1_700_000_044_500,
  });
  assert(rematerializedReadonly.sessionId === materializedReadonly.sessionId, "Expected rematerialized import to reuse the same session id.");
  const rematerializedReadonlySession = importSessionStore.readSession(materializedReadonly.sessionId);
  assert(rematerializedReadonlySession.messages.length === 1, "Expected rematerialized import not to duplicate transcript groups.");
  assert(rematerializedReadonlySession.turns.length === 1, "Expected rematerialized import not to duplicate turn summaries.");
  assert(rematerializedReadonlySession.compactionCheckpoints.length === 1, "Expected rematerialized import not to duplicate checkpoints.");
  assert(rematerializedReadonlySession.unresolvedObligations[0].autoReplayable === false, "Expected rematerialized import obligation to remain non-replayable.");

  const materializedValidated = materializeDirectImportSession(cleanValidation, {
    sessionStore: importSessionStore,
    sessionId: "import_session_clean",
    nowMs: 1_700_000_045_000,
  });
  assert(materializedValidated.importState === "checkpoint-validated", "Expected clean import materialization to preserve checkpoint-validated state.");
  assert(materializedValidated.readOnlyImported === true, "Expected clean import materialization to remain read-only.");
  assert(materializedValidated.nativeDirectSession === false, "Expected clean import materialization not to be native direct.");
  assert(materializedValidated.continuationEligible === true, "Expected clean import materialization to allow future continuation eligibility.");
  assert(materializedValidated.eligibility.directContinuationRunnableNow === false, "Expected validated import not to be runnable now.");
  const materializedValidatedSession = importSessionStore.readSession(materializedValidated.sessionId);
  assert(materializedValidatedSession.runtimeMode === "imported-readonly", "Expected clean import session runtime mode.");
  assert(materializedValidatedSession.continuationEligible === true, "Expected clean import session continuation eligibility.");
  assert(materializedValidatedSession.messages[0].items.length === 2, "Expected clean import session transcript items.");
  assert(materializedValidatedSession.turns.length === 1, "Expected clean import session turn summary.");
  assert(materializedValidatedSession.turns[0].state === "completed", "Expected clean import turn summary to be completed.");
  assert(materializedValidatedSession.directImportCheckpoint.validation.importedApprovalsCarryAuthority === false, "Expected materialized import checkpoint not to inherit approval authority.");
  const materializedValidatedTurn = importSessionStore.readTurn(materializedValidated.sessionId, materializedValidated.turnId);
  assert(materializedValidatedTurn.importState === "checkpoint-validated", "Expected validated import turn JSON to preserve import state.");
  const rendererSafeImport = buildRendererSafeImportSession(materializedValidatedSession);
  assert(rendererSafeImport.continuation.runnableNow === false, "Expected renderer-safe import projection not to mark runnable now.");
  assert(rendererSafeImport.composer.enabled === false, "Expected renderer-safe import projection to disable composer.");
  assert(rendererSafeImport.rawSourceSha256Exposed === false, "Expected renderer-safe import projection not to expose raw source digests.");
  assert(!JSON.stringify(rendererSafeImport).includes("/tmp/codex/history/thread_clean.jsonl"), "Expected renderer-safe import projection to omit raw source paths.");
  const recoveredImportArtifactIndex = importSessionStore.recoverImportIndex({ write: true });
  assert(recoveredImportArtifactIndex.imports.some((entry) => entry.importId === cleanValidation.lineage.importId), "Expected import artifact recovery to find clean import.");
  const materializedUnsafeId = materializeDirectImportSession(cleanValidation, {
    sessionStore: importSessionStore,
    sessionId: `-${"x".repeat(180)}_`,
    nowMs: 1_700_000_046_000,
  });
  assert(/^[A-Za-z0-9]/.test(materializedUnsafeId.sessionId), "Expected materialized import session id to start with an alphanumeric character.");
  assert(materializedUnsafeId.sessionId.length <= 121, "Expected materialized import session id to respect store id length limits.");
  const reloadedImportStore = new DirectSessionStore({ rootDir: path.join(importStoreParent, "direct-sessions") });
  const recoveredImportIndex = reloadedImportStore.recoverIndex({ write: true });
  assert(recoveredImportIndex.sessions.length === 3, "Expected import session index recovery to find materialized sessions.");
  const recoveredReadonlySession = reloadedImportStore.readSession(materializedReadonly.sessionId);
  assert(recoveredReadonlySession.sourceClass === "legacy-codex-jsonl-import", "Expected recovered import session source class.");
  assert(recoveredReadonlySession.runtimeMode === "imported-readonly", "Expected recovered readonly import runtime mode.");
  assert(recoveredReadonlySession.continuationEligible === false, "Expected recovered readonly import not to allow continuation.");
  assert(normalizedSmokePath(recoveredReadonlySession.compactionCheckpoints[0].source.codexHome).endsWith("/tmp/codex"), "Expected recovered import checkpoint to preserve CODEX_HOME.");
  const recoveredValidatedSession = reloadedImportStore.readSession(materializedValidated.sessionId);
  assert(recoveredValidatedSession.runtimeMode === "imported-readonly", "Expected recovered validated import runtime mode.");
  assert(recoveredValidatedSession.continuationEligible === true, "Expected recovered validated import continuation eligibility.");
  const recoveredValidatedTurn = reloadedImportStore.readTurn(materializedValidated.sessionId, materializedValidated.turnId);
  assert(recoveredValidatedTurn.importState === "checkpoint-validated", "Expected recovered validated import turn.");
  const controllerSourceRoot = path.join(importStoreParent, "legacy-source");
  fs.mkdirSync(controllerSourceRoot, { recursive: true });
  const controllerSourcePath = path.join(controllerSourceRoot, "thread_controller.jsonl");
  fs.writeFileSync(controllerSourcePath, [
    JSON.stringify({ timestamp: "2026-04-25T10:00:07Z", thread_id: "thread_controller", message: { role: "user", content: "Controller import." } }),
    JSON.stringify({ timestamp: "2026-04-25T10:00:08Z", thread_id: "thread_controller", message: { role: "assistant", content: "Controller imported." } }),
  ].join("\n"), "utf8");
  try {
    fs.symlinkSync(controllerSourceRoot, path.join(controllerSourceRoot, "loop"));
  } catch {}
  const importController = new DirectImportController({ sessionStore: importSessionStore });
  const listedSources = await importController.listSources({ id: "project_controller", workspace: { kind: "local", localPath: "/tmp/workspace" } }, { sourceRoot: controllerSourceRoot });
  assert(listedSources.ok === true && listedSources.sources.length === 1, "Expected explicit source listing to find controller JSONL.");
  assert(listedSources.sources[0].sourcePath === "", "Expected renderer-safe source listing to omit private paths.");
  assert(listedSources.sources[0].handleId, "Expected renderer-safe source listing to include an opaque source handle.");
  assert(listedSources.sources[0].rawSourceSha256Exposed === false, "Expected renderer-safe source listing not to expose raw source digest.");
  const inspectedSource = await importController.inspectSource({ id: "project_controller" }, { handleId: listedSources.sources[0].handleId });
  assert(inspectedSource.source.sourceEvidenceKey.startsWith("source_"), "Expected controller inspect to expose only a local source evidence key.");
  assert(inspectedSource.source.sourceEvidenceKey === listedSources.sources[0].sourceEvidenceKey, "Expected source evidence key to stay stable between list and inspect.");
  assert(inspectedSource.source.rawSourceSha256Exposed === false, "Expected controller inspect not to expose raw source digest.");
  const controllerMaterialized = await importController.materialize({ id: "project_controller", workspace: { kind: "local", localPath: "/tmp/workspace" } }, {
    handleId: listedSources.sources[0].handleId,
    userConfirmedWorkspace: true,
  });
  assert(controllerMaterialized.importState === "checkpoint-validated", "Expected controller materialization to validate user-confirmed workspace import.");
  assert(controllerMaterialized.rendererSafeSession.continuation.runnableNow === false, "Expected controller renderer projection to remain non-runnable.");
  assert(controllerMaterialized.rendererSafeSession.source.sourceDisplayName === "thread_controller.jsonl", "Expected controller renderer projection source display name.");
  assert(controllerMaterialized.rendererSafeSession.composer.enabled === false, "Expected controller renderer projection composer to stay disabled.");
  const controllerImports = await importController.listImports({ id: "project_controller" });
  assert(controllerImports.entries.some((entry) => entry.importId === controllerMaterialized.rendererSafeSession.importId), "Expected controller import list to include materialized import.");
  assert(controllerImports.entries.every((entry) => !("rendererSafeSession" in entry)), "Expected import list to stay summary-only and omit full transcripts.");
  assert(controllerImports.rawPathExposed === false && controllerImports.rawSourceSha256Exposed === false, "Expected controller import list to stay renderer-safe.");
  const controllerImportSession = await importController.readImportSession({ id: "project_controller" }, { importId: controllerMaterialized.rendererSafeSession.importId });
  assert(controllerImportSession.rendererSafeSession.transcriptItems.length === 2, "Expected import transcript to load only on demand.");
  const controllerReport = await importController.readReport({ id: "project_controller" }, { importId: controllerMaterialized.rendererSafeSession.importId });
  assert(controllerReport.report.rawPathExposed === false, "Expected renderer-safe import report to omit raw paths.");
  assert(!JSON.stringify(controllerReport.report).includes(controllerSourcePath), "Expected renderer-safe import report not to include the raw source path.");
  const importStatus = importController.statusForProject({ id: "project_controller" });
  assert(importStatus.importedSessionCount >= 1, "Expected import status to count materialized imports.");
  assert(importStatus.continuationRunnableNowCount === 0, "Expected import status to keep continuation non-runnable now.");
  assert(importStatus.checkpointContinuationActionAvailableCount >= 1, "Expected validated imports to expose checkpoint action availability.");
  assert(importStatus.checkpointContinuationActionRunnableNowCount === 0, "Expected checkpoint action to remain blocked without request-shape evidence.");

  const materializedControllerSession = importSessionStore.readSession(controllerMaterialized.rendererSafeSession.sessionId);
  const controllerReportForSeed = importSessionStore.readImportArtifact(controllerMaterialized.rendererSafeSession.importId, "validation-report.json");
  const controllerCheckpointForSeed = importSessionStore.readImportArtifact(controllerMaterialized.rendererSafeSession.importId, "checkpoint.json");
  const checkpointSeed = buildDirectImportCheckpointSeed({
    importSession: materializedControllerSession,
    validationReport: controllerReportForSeed,
    checkpoint: controllerCheckpointForSeed,
  }, {
    integritySecret: "smoke_checkpoint_seed_secret",
    profileId: "smoke_profile",
    profileHash: "smoke_profile_hash",
  });
  assert(checkpointSeed.schema === "direct_import_checkpoint_seed@1", "Expected checkpoint seed schema.");
  assert(checkpointSeed.seedShapeHash && checkpointSeed.seedShapeHash !== checkpointSeed.seedTextHash, "Expected seed shape hash to differ from seed text hash.");
  assert(checkpointSeed.requestShapeHash === checkpointContinuationRequestShapeHash(), "Expected checkpoint seed to carry canonical request-shape hash.");
  assert(checkpointSeed.seedText.includes("[IMPORTED TRANSCRIPT EVIDENCE - QUOTED]"), "Expected seed to frame imported transcript as quoted evidence.");
  assert(checkpointSeed.seedText.includes("[BEGIN IMPORTED_TRANSCRIPT_EVIDENCE_"), "Expected seed to use stable per-message evidence delimiters.");
  assert(!checkpointSeed.seedText.includes('"""'), "Expected checkpoint seed not to use fragile triple-quote delimiters.");
  assert(checkpointSeed.seedText.includes("[CURRENT USER INTENT]"), "Expected seed to include current intent section.");
  assert(!checkpointSeed.seedText.includes(controllerSourcePath), "Expected checkpoint seed not to include raw source path.");
  assert(checkpointSeed.excluded.importedSystemDeveloperPolicy === true, "Expected checkpoint seed to exclude imported runtime policy.");
  assert(checkpointSeed.integrity.digest, "Expected checkpoint seed to carry an integrity digest.");
  const seedPreview = rendererSafeCheckpointSeedPreview(checkpointSeed);
  assert(seedPreview.rawPathExposed === false && seedPreview.rawSourceSha256Exposed === false, "Expected seed preview to be renderer-safe.");
  assert(!JSON.stringify(seedPreview).includes(controllerSourcePath), "Expected seed preview not to expose raw source path.");
  assertThrows(
    () => buildDirectImportCheckpointSeed({
      importSession: materializedControllerSession,
      validationReport: controllerReportForSeed,
      checkpoint: controllerCheckpointForSeed,
      userPromptText: "Authorization: Bearer very_private_followup_token",
    }),
    "Expected auth-like user follow-up to be blocked before transport.",
  );

  const continuationParent = fs.mkdtempSync(path.join(os.tmpdir(), "direct-import-continuation-"));
  try {
    const continuationStore = new DirectSessionStore({ rootDir: path.join(continuationParent, "direct-sessions") });
    const continuationMaterialized = materializeDirectImportSession(cleanValidation, {
      sessionStore: continuationStore,
      sessionId: "import_session_continuation_clean",
      projectId: "project_clean_import",
    });
    const continuationSse = [
      "event: response.created",
      "data: {\"response\":{\"id\":\"resp_import_checkpoint\",\"model\":\"gpt-5.4\"}}",
      "",
      "event: response.output_text.delta",
      "data: {\"item_id\":\"msg_import_checkpoint\",\"delta\":\"checkpoint continuation ok\"}",
      "",
      "event: response.completed",
      "data: {\"response\":{\"id\":\"resp_import_checkpoint\",\"status\":\"completed\"}}",
      "",
    ].join("\n");
    let checkpointFetchCalls = 0;
    let checkpointRequestBody = null;
    const checkpointLiveController = new DirectLiveTextController({
      sessionStore: continuationStore,
      profileDoc: acceptedLiveTextProfile(),
      authStore: {
        readStatus: () => ({ status: "authenticated", accountId: "acct_checkpoint_smoke", hasAccessToken: true }),
        readCredentials: () => ({ accessToken: "checkpoint_smoke_access_token" }),
      },
      fetchImpl: async (_url, init) => {
        checkpointFetchCalls += 1;
        checkpointRequestBody = JSON.parse(init.body);
        return textResponse(continuationSse, 200, { "content-type": "text/event-stream" });
      },
    });
    const continuationController = new DirectImportController({
      sessionStore: continuationStore,
      liveTextController: () => checkpointLiveController,
      checkpointContinuationEvidenceResolver: () => ({ accepted: true, status: "runtime_probed" }),
      seedIntegritySecret: "smoke_checkpoint_seed_secret",
    });
    const blockedWithoutEvidence = new DirectImportController({
      sessionStore: continuationStore,
      liveTextController: () => checkpointLiveController,
    });
    await assertRejects(
      () => blockedWithoutEvidence.startCheckpointContinuation({ id: "project_clean_import" }, {
        importId: continuationMaterialized.session.importLineage.importId,
        clientCheckpointContinuationId: "client_checkpoint_blocked",
      }),
      "Expected normal checkpoint continuation to require request-shape evidence.",
    );
    const continuationResult = await continuationController.startCheckpointContinuation({ id: "project_clean_import" }, {
      importId: continuationMaterialized.session.importLineage.importId,
      clientCheckpointContinuationId: "client_checkpoint_1",
    });
    assert(continuationResult.ok === true, `Expected checkpoint continuation to complete through fake live transport: ${JSON.stringify(continuationResult.continuation?.failure || {})}`);
    assert(checkpointFetchCalls === 1, "Expected checkpoint continuation to make one provider request.");
    assert(checkpointRequestBody.stream === true && checkpointRequestBody.store === false, "Expected checkpoint continuation request to stream without store.");
    assert(!checkpointRequestBody.previous_response_id, "Checkpoint continuation must not use imported previous_response_id.");
    assert(!checkpointRequestBody.tools, "Checkpoint continuation must not declare tools in this bundle.");
    assert(checkpointRequestBody.input[0].content[0].text.includes("[IMPORTED TRANSCRIPT EVIDENCE - QUOTED]"), "Expected provider request to carry quoted checkpoint evidence.");
    const duplicateContinuation = await continuationController.startCheckpointContinuation({ id: "project_clean_import" }, {
      importId: continuationMaterialized.session.importLineage.importId,
      clientCheckpointContinuationId: "client_checkpoint_1",
    });
    assert(duplicateContinuation.reused === true, "Expected duplicate checkpoint continuation id to reuse existing record.");
    assert(checkpointFetchCalls === 1, "Expected duplicate checkpoint continuation not to resend provider request.");
    const continuationSession = continuationStore.readSession(continuationResult.sessionId);
    assert(continuationSession.sourceClass === "direct-import-checkpoint-continuation", "Expected new session source class to record checkpoint continuation.");
    assert(continuationSession.nativeDirectSession === true, "Expected checkpoint continuation to create a native direct session.");
    assert(continuationSession.importedSessionReadOnly === true, "Expected new session to record imported parent remains read-only.");
    assert(continuationSession.parentImportLineage.importId === continuationMaterialized.session.importLineage.importId, "Expected new session to retain parent import lineage.");
    assert(continuationSession.messages[0].items.some((item) => item.type === "harnessCheckpointSeed"), "Expected new transcript to render checkpoint seed as a harness item.");
    assert(continuationSession.messages[0].items.some((item) => item.type === "agentMessage" && item.text === "checkpoint continuation ok"), "Expected checkpoint assistant output to persist.");
    const continuationTurn = continuationStore.readTurn(continuationResult.sessionId, continuationResult.turnId);
    assert(continuationTurn.checkpointSeedId === continuationSession.checkpointSeedId, "Expected turn to persist checkpoint seed id.");
    assert(continuationTurn.requestShape.previousResponseIdFromImportUsed === false, "Expected turn request shape to deny imported continuity handles.");
    const importedParentAfterContinuation = continuationStore.readSession(continuationMaterialized.sessionId);
    assert(importedParentAfterContinuation.readOnlyImported === true, "Expected parent imported session to remain read-only after continuation.");
    assert(importedParentAfterContinuation.nativeDirectSession === false, "Expected parent imported session not to become native direct.");
    const continuationRecord = continuationStore.readImportContinuationArtifact(
      continuationMaterialized.session.importLineage.importId,
      continuationResult.continuation.continuationId,
      "continuation.json",
    );
    assert(continuationRecord.state === "completed", "Expected continuation record to persist completed state.");
    assert(continuationRecord.previousResponseIdFromImportUsed === false, "Expected continuation record to deny imported continuity handles.");
    assert(continuationRecord.importedToolReplayAttempted === false, "Expected continuation record to deny imported tool replay.");

    const failingContinuationController = new DirectImportController({
      sessionStore: continuationStore,
      liveTextController: () => ({
        statusForProject: () => ({ status: "ready" }),
        runImportCheckpointContinuation: async () => {
          const error = new Error("simulated live controller loss");
          error.code = "live_controller_lost";
          throw error;
        },
      }),
      checkpointContinuationEvidenceResolver: () => ({ accepted: true, status: "runtime_probed" }),
      seedIntegritySecret: "smoke_checkpoint_seed_secret",
    });
    await assertRejects(
      () => failingContinuationController.startCheckpointContinuation({ id: "project_clean_import" }, {
        importId: continuationMaterialized.session.importLineage.importId,
        clientCheckpointContinuationId: "client_checkpoint_partial",
      }),
      "Expected failing checkpoint continuation to reject.",
    );
    const partialContinuationId = `checkpoint_continuation_${createHashForSmoke(`${continuationMaterialized.session.importLineage.importId}:client_checkpoint_partial`)}`;
    const failedPartialRecord = continuationStore.readImportContinuationArtifact(
      continuationMaterialized.session.importLineage.importId,
      partialContinuationId,
      "continuation.json",
    );
    assert(failedPartialRecord.state === "failed", "Expected partial checkpoint continuation start to persist failed state.");
    assert(failedPartialRecord.failure.kind === "live_controller_lost", "Expected partial checkpoint continuation failure kind to persist.");
    const reusedFailedPartial = await failingContinuationController.startCheckpointContinuation({ id: "project_clean_import" }, {
      importId: continuationMaterialized.session.importLineage.importId,
      clientCheckpointContinuationId: "client_checkpoint_partial",
    });
    assert(reusedFailedPartial.reused === true && reusedFailedPartial.continuation.state === "failed", "Expected retry of failed partial continuation to return terminal failed snapshot.");

    const toolSse = [
      "event: response.created",
      "data: {\"response\":{\"id\":\"resp_import_checkpoint_tool\",\"model\":\"gpt-5.4\"}}",
      "",
      "event: response.output_item.added",
      "data: {\"item\":{\"id\":\"tool_import_checkpoint\",\"type\":\"function_call\",\"call_id\":\"call_import_read\",\"name\":\"read_file\"}}",
      "",
      "event: response.completed",
      "data: {\"response\":{\"id\":\"resp_import_checkpoint_tool\",\"status\":\"completed\"}}",
      "",
    ].join("\n");
    const toolContinuationController = new DirectImportController({
      sessionStore: continuationStore,
      liveTextController: () => new DirectLiveTextController({
        sessionStore: continuationStore,
        profileDoc: acceptedLiveTextProfile(),
        authStore: {
          readStatus: () => ({ status: "authenticated", accountId: "acct_checkpoint_smoke", hasAccessToken: true }),
          readCredentials: () => ({ accessToken: "checkpoint_smoke_access_token" }),
        },
        fetchImpl: async () => textResponse(toolSse, 200, { "content-type": "text/event-stream" }),
      }),
      checkpointContinuationEvidenceResolver: () => ({ accepted: true, status: "runtime_probed" }),
    });
    const toolResult = await toolContinuationController.startCheckpointContinuation({ id: "project_clean_import" }, {
      importId: continuationMaterialized.session.importLineage.importId,
      clientCheckpointContinuationId: "client_checkpoint_tool",
    });
    assert(toolResult.ok === false, "Expected checkpoint continuation tool call to fail closed.");
    assert(toolResult.continuation.failure.kind === "tool_call_unsupported", "Expected tool-call failure kind.");
  } finally {
    cleanupSmokeTempDir(continuationParent);
  }

  const hiddenImport = await importController.hideImport({ id: "project_controller" }, { importId: controllerMaterialized.rendererSafeSession.importId });
  assert(hiddenImport.hidden === true, "Expected controller hide to mark import hidden.");
  const importsAfterHide = await importController.listImports({ id: "project_controller" });
  assert(!importsAfterHide.entries.some((entry) => entry.importId === controllerMaterialized.rendererSafeSession.importId), "Expected hidden import to be omitted by default.");
  await importController.unhideImport({ id: "project_controller" }, { importId: controllerMaterialized.rendererSafeSession.importId });
  const replacedSourcePath = path.join(controllerSourceRoot, "thread_replaced.jsonl");
  fs.writeFileSync(replacedSourcePath, [
    JSON.stringify({ timestamp: "2026-04-25T10:00:09Z", thread_id: "thread_replaced", message: { role: "user", content: "Replace me." } }),
  ].join("\n"), "utf8");
  const replacedHandle = importController.registerSourceHandle({ id: "project_controller" }, {
    sourcePath: replacedSourcePath,
    sourceRoot: controllerSourceRoot,
  });
  try {
    fs.unlinkSync(replacedSourcePath);
    fs.symlinkSync(controllerSourcePath, replacedSourcePath);
    await assertRejects(
      () => importController.inspectSource({ id: "project_controller" }, { handleId: replacedHandle.handleId }),
      "Expected handle resolution to revalidate symlink replacement before reading.",
    );
  } catch (error) {
    if (error?.code !== "EPERM" && error?.code !== "EACCES" && error?.code !== "ENOSYS") throw error;
  }
  const canceledImport = await importController.cancelImport({ id: "project_controller" }, { importId: "import_canceled_smoke" });
  assert(canceledImport.state === "import-canceled", "Expected controller cancel to write canceled import report.");
  const corruptImportDir = path.join(importStoreParent, "direct-sessions", "imports", "import_corrupt_smoke");
  fs.mkdirSync(corruptImportDir, { recursive: true });
  fs.writeFileSync(path.join(corruptImportDir, "candidate.json"), "{", "utf8");
  const recoveredWithCorruptImport = importSessionStore.recoverImportIndex({ write: true });
  const corruptEntry = recoveredWithCorruptImport.imports.find((entry) => entry.importId === "import_corrupt_smoke");
  assert(corruptEntry?.recoveryState === "corrupted", "Expected corrupt import artifact recovery to continue and mark import corrupted.");
} finally {
  cleanupSmokeTempDir(importStoreParent);
}

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
