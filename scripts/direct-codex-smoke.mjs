import nodeAssert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
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
const { normalizeDirectCodexEvents, parseSseFixtureText } = require("../src/main/direct/normalizer/codex-event-normalizer");
const { buildFixtureProfileDelta } = require("../src/main/direct/odeu-profile/profile-delta-builder");
const { loadDirectCodexProfile } = require("../src/main/direct/odeu-profile/profile-loader");
const { buildDirectCodexProfileReport } = require("../src/main/direct/odeu-profile/profile-report");
const {
  DEFAULT_PROBE_MANIFEST_DIR,
  runFixtureBackedProbe,
  runProbeManifestDir,
} = require("../src/main/direct/probes/probe-runner");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertThrows(callback, message) {
  try {
    callback();
  } catch {
    return;
  }
  throw new Error(message);
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
