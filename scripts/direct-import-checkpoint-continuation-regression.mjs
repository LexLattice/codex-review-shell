#!/usr/bin/env node

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

const { scanFixtureForSecrets } = require("../src/main/direct/fixtures/redaction");
const { loadDirectCodexProfile } = require("../src/main/direct/odeu-profile/profile-loader");
const { createCodexCliAuthStore } = require("../src/main/direct/auth/codex-cli-auth");
const { DirectLiveTextController } = require("../src/main/direct/controller/live-text-controller");
const { DirectImportController } = require("../src/main/direct/import/import-controller");
const { DirectSessionStore, writeJsonAtomic } = require("../src/main/direct/session/session-store");
const { DirectThreadStore } = require("../src/main/direct/thread/thread-store");

const REPORT_SCHEMA = "direct_import_checkpoint_continuation_regression_report@1";
const USER_DATA_ROOT_ENV_VAR = "CODEX_REVIEW_SHELL_USER_DATA_ROOT";
const LIVE_ENV = "CODEX_DIRECT_RUG008_LIVE";
const LIVE_CI_ENV = "CODEX_DIRECT_REAL_TURN_ALLOW_CI";

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function safeIdPart(value, fallback = "run") {
  return normalizeString(value, fallback)
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96) || fallback;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new Error(`Unknown argument: ${arg}`);
    const raw = arg.slice(2);
    const equals = raw.indexOf("=");
    if (equals >= 0) {
      options[raw.slice(0, equals)] = raw.slice(equals + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      options[raw] = next;
      index += 1;
    } else {
      options[raw] = true;
    }
  }
  return options;
}

function platformAppDataRoot() {
  if (process.platform === "win32") return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support");
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
}

function defaultAppUserDataRoot() {
  return path.join(platformAppDataRoot(), "codex-review-shell");
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

function writeTextFile(targetPath, text) {
  ensureDirectory(path.dirname(targetPath));
  fs.writeFileSync(targetPath, text, { mode: 0o600 });
}

function assertCase(cases, caseId, condition, details = {}) {
  cases.push({
    caseId,
    status: condition ? "passed" : "failed",
    details,
  });
}

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

function acceptedLiveTextProfile(model = "gpt-5.4") {
  const doc = JSON.parse(JSON.stringify(loadDirectCodexProfile()));
  const models = Array.isArray(doc.profile?.ontology?.models) ? doc.profile.ontology.models : [];
  let found = false;
  for (const entry of models) {
    if (entry?.id !== model) continue;
    entry.status = "accepted";
    found = true;
  }
  if (!found) {
    doc.profile.ontology.models = [
      ...models,
      { id: model, displayName: model, status: "accepted", supportsReasoning: null, supportsTools: null },
    ];
  }
  return doc;
}

function createProject(projectId, model, workspaceRoot) {
  return {
    id: projectId,
    name: "RUG-008 Import Checkpoint Project",
    updatedAt: "2023-11-14T22:13:45.000Z",
    workspace: { kind: "local", localPath: workspaceRoot },
    surfaceBinding: {
      codex: {
        runtimeMode: "direct-experimental",
        directTransport: "live-text",
        directTier: "text-only",
        model,
        profileId: "rug008_profile",
      },
    },
  };
}

function writeImportSource(sourceRoot) {
  const sourcePath = path.join(sourceRoot, "thread_rug008.jsonl");
  const records = [
    {
      timestamp: "2026-04-25T10:00:04Z",
      thread_id: "thread_rug008",
      message: { role: "user", content: "Investigate the parser failure and preserve next steps." },
    },
    {
      timestamp: "2026-04-25T10:00:05Z",
      thread_id: "thread_rug008",
      message: { role: "assistant", content: "Checkpoint: parser failure is isolated to identifier tokenization; next step is to add fresh workspace evidence before editing." },
    },
  ];
  writeTextFile(sourcePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  return sourcePath;
}

function fixtureContinuationSse() {
  return [
    "event: response.created",
    "data: {\"response\":{\"id\":\"resp_rug008_checkpoint\",\"model\":\"gpt-5.4\"}}",
    "",
    "event: response.output_text.delta",
    "data: {\"item_id\":\"msg_rug008_checkpoint\",\"delta\":\"Checkpoint continuation completed from quoted imported evidence.\"}",
    "",
    "event: response.completed",
    "data: {\"response\":{\"id\":\"resp_rug008_checkpoint\",\"status\":\"completed\"}}",
    "",
  ].join("\n");
}

function makeAuthStore(mode) {
  if (mode === "live") return createCodexCliAuthStore();
  return {
    readStatus: () => ({ status: "authenticated", accountId: "acct_rug008_fixture", hasAccessToken: true }),
    readCredentials: () => ({ accessToken: "rug008_fixture_access_token_secret" }),
  };
}

function makeFetchImpl({ mode, counters, requestBodies }) {
  if (mode === "live") {
    return async (...args) => {
      counters.liveProviderTransportCalls += 1;
      counters.directProviderRequestCalls += 1;
      try {
        requestBodies.push(JSON.parse(args[1]?.body || "{}"));
      } catch {
        requestBodies.push({});
      }
      return globalThis.fetch(...args);
    };
  }
  return async (_url, init) => {
    counters.fixtureProviderShapeCalls += 1;
    counters.directProviderRequestCalls += 1;
    requestBodies.push(JSON.parse(init?.body || "{}"));
    return textResponse(fixtureContinuationSse(), 200, { "content-type": "text/event-stream" });
  };
}

function liveAllowed(options = {}) {
  return options["allow-live-provider-call"] === true || process.env[LIVE_ENV] === "1" || process.env.CODEX_DIRECT_REAL_TURN === "1";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const mode = normalizeString(options.mode, "fixture");
  if (!["fixture", "live"].includes(mode)) throw new Error("--mode must be fixture or live.");
  if (mode === "live" && !liveAllowed(options)) {
    throw new Error(`Live import checkpoint continuation requires --allow-live-provider-call, ${LIVE_ENV}=1, or CODEX_DIRECT_REAL_TURN=1.`);
  }
  if (mode === "live" && process.env.CI === "true" && process.env[LIVE_CI_ENV] !== "1") {
    throw new Error(`Live import checkpoint continuation in CI requires ${LIVE_CI_ENV}=1.`);
  }

  const runId = safeIdPart(options["run-id"] || options.runId || `rug008_${mode}_${Date.now()}`);
  const model = normalizeString(options.model, "gpt-5.4");
  const root = path.resolve(normalizeString(process.env[USER_DATA_ROOT_ENV_VAR], defaultAppUserDataRoot()));
  const runRoot = path.join(root, "direct-import-checkpoint-continuation-runs", runId);
  fs.rmSync(runRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  ensureDirectory(runRoot);

  const projectId = "project_rug008_import_checkpoint";
  const sourceRoot = path.join(runRoot, "source-root");
  const workspaceRoot = path.join(runRoot, "workspace");
  ensureDirectory(sourceRoot);
  ensureDirectory(workspaceRoot);
  const sourcePath = writeImportSource(sourceRoot);
  const project = createProject(projectId, model, workspaceRoot);
  const cases = [];
  const counters = {
    directProviderRequestCalls: 0,
    fixtureProviderShapeCalls: 0,
    liveProviderTransportCalls: 0,
    appServerSpawnCalls: 0,
    appServerMutationCalls: 0,
    workspaceReadCalls: 0,
    patchApplyCalls: 0,
    commandRunCalls: 0,
    rightPaneMutationCalls: 0,
    handoffMutationCalls: 0,
  };
  const requestBodies = [];
  let threadStore = null;

  try {
    const sessionStore = new DirectSessionStore({ rootDir: path.join(runRoot, "sessions") });
    sessionStore.ensure();
    threadStore = new DirectThreadStore({ rootDir: path.join(runRoot, "thread-store") });
    const liveController = new DirectLiveTextController({
      sessionStore,
      directThreadStore: threadStore,
      profileDoc: acceptedLiveTextProfile(model),
      authStore: makeAuthStore(mode),
      endpoint: normalizeString(options.endpoint, ""),
      fetchImpl: makeFetchImpl({ mode, counters, requestBodies }),
    });
    const importController = new DirectImportController({
      sessionStore,
      liveTextController: () => liveController,
      checkpointContinuationEvidenceResolver: () => ({ accepted: true, status: "runtime_probed", evidenceState: "runtime_probed" }),
      seedIntegritySecret: "rug008_checkpoint_seed_secret",
    });
    const blockedImportController = new DirectImportController({
      sessionStore,
      liveTextController: () => liveController,
      seedIntegritySecret: "rug008_checkpoint_seed_secret",
    });

    const listed = await importController.listSources(project, { sourceRoot });
    assertCase(cases, "import_source_list_renderer_safe", listed.ok === true && listed.sources.length === 1 && listed.sources[0].rawPathExposed === false, {
      sourceCount: listed.sources.length,
      sourceDisplayName: listed.sources[0]?.sourceDisplayName,
    });
    const materialized = await importController.materialize(project, {
      handleId: listed.sources[0].handleId,
      userConfirmedWorkspace: true,
      workspaceMatch: {
        status: "matched",
        selectedProjectId: projectId,
        selectedWorkspaceKind: "local",
        selectedWorkspaceDisplay: "[REDACTED:private-path]",
        matchMethod: "user-confirmed",
        confidence: "high",
      },
    });
    assertCase(cases, "import_checkpoint_validated_readonly", materialized.importState === "checkpoint-validated" &&
      materialized.rendererSafeSession.composer.enabled === false &&
      materialized.session.readOnlyImported === true &&
      materialized.session.nativeDirectSession === false, {
      importState: materialized.importState,
      composerEnabled: materialized.rendererSafeSession.composer.enabled,
      readOnlyImported: materialized.session.readOnlyImported,
      nativeDirectSession: materialized.session.nativeDirectSession,
    });
    const importStatus = importController.statusForProject(project);
    assertCase(cases, "checkpoint_action_available_with_evidence", importStatus.checkpointContinuationActionAvailableCount === 1 &&
      importStatus.checkpointContinuationActionRunnableNowCount === 1, {
      available: importStatus.checkpointContinuationActionAvailableCount,
      runnableNow: importStatus.checkpointContinuationActionRunnableNowCount,
      blockedReasons: importStatus.continuationBlockedReasons,
    });
    let blockedWithoutEvidence = false;
    try {
      await blockedImportController.startCheckpointContinuation(project, {
        importId: materialized.session.importLineage.importId,
        clientCheckpointContinuationId: "client_rug008_blocked",
      });
    } catch (error) {
      blockedWithoutEvidence = error.code === "checkpoint_request_shape_unaccepted";
    }
    assertCase(cases, "checkpoint_continuation_requires_request_shape_evidence", blockedWithoutEvidence, {
      blockedWithoutEvidence,
    });

    const preview = await importController.previewCheckpointContinuation(project, {
      importId: materialized.session.importLineage.importId,
      userPromptText: "Continue from this imported checkpoint as fresh evidence; do not resume provider state.",
    });
    assertCase(cases, "checkpoint_seed_preview_renderer_safe", preview.ok === true &&
      preview.seedPreview.continuation.runnableNow === true &&
      preview.seedPreview.rawPathExposed === false &&
      preview.seedPreview.rawSourceSha256Exposed === false, {
      runnableNow: preview.seedPreview?.continuation?.runnableNow,
      previewTruncated: preview.seedPreview?.included?.previewTruncated,
    });

    const result = await importController.startCheckpointContinuation(project, {
      importId: materialized.session.importLineage.importId,
      clientCheckpointContinuationId: "client_rug008_checkpoint_1",
      userPromptText: "Continue from this imported checkpoint as fresh evidence; do not resume provider state.",
      model,
    });
    const requestBody = requestBodies.at(-1) || {};
    assertCase(cases, "checkpoint_continuation_provider_request_shape", result.ok === true && counters.directProviderRequestCalls === 1, {
      ok: result.ok,
      directProviderRequestCalls: counters.directProviderRequestCalls,
      coverageSource: mode === "live" ? "real_provider" : "fixture_provider_shaped",
    });
    assertCase(cases, "checkpoint_continuation_no_imported_continuity", !requestBody.previous_response_id && requestBody.store === false && !requestBody.tools, {
      previousResponseIdUsed: Boolean(requestBody.previous_response_id),
      store: requestBody.store,
      toolsDeclared: Boolean(requestBody.tools),
    });
    assertCase(cases, "checkpoint_seed_quoted_imported_evidence", String(requestBody.input?.[0]?.content?.[0]?.text || "").includes("[IMPORTED TRANSCRIPT EVIDENCE - QUOTED]"), {
      quotedImportedEvidence: true,
    });

    const continuationSession = sessionStore.readSession(result.sessionId);
    const continuationTurn = sessionStore.readTurn(result.sessionId, result.turnId);
    const continuationRecord = sessionStore.readImportContinuationArtifact(
      materialized.session.importLineage.importId,
      result.continuation.continuationId,
      "continuation.json",
    );
    const seedArtifact = sessionStore.readImportContinuationArtifact(
      materialized.session.importLineage.importId,
      result.continuation.continuationId,
      "seed.json",
    );
    const requestShapeArtifact = sessionStore.readImportContinuationArtifact(
      materialized.session.importLineage.importId,
      result.continuation.continuationId,
      "request-shape.json",
    );
    assertCase(cases, "checkpoint_continuation_artifacts_persisted", continuationRecord.state === "completed" &&
      seedArtifact.schema === "direct_import_checkpoint_seed@1" &&
      requestShapeArtifact.previousResponseIdFromImportUsed === false &&
      requestShapeArtifact.importedToolReplayAttempted === false, {
      continuationState: continuationRecord.state,
      seedSchema: seedArtifact.schema,
      requestShapeHashPresent: Boolean(requestShapeArtifact.requestShapeHash),
    });
    assertCase(cases, "checkpoint_continuation_session_fresh_direct", continuationSession.sourceClass === "direct-import-checkpoint-continuation" &&
      continuationSession.nativeDirectSession === true &&
      continuationSession.importedSessionReadOnly === true &&
      continuationTurn.requestShape.previousResponseIdFromImportUsed === false &&
      continuationTurn.requestShape.importedToolReplayAttempted === false, {
      sourceClass: continuationSession.sourceClass,
      nativeDirectSession: continuationSession.nativeDirectSession,
      importedSessionReadOnly: continuationSession.importedSessionReadOnly,
      turnState: continuationTurn.state,
    });
    const importedParentAfterContinuation = sessionStore.readSession(materialized.sessionId);
    assertCase(cases, "imported_parent_remains_readonly", importedParentAfterContinuation.readOnlyImported === true &&
      importedParentAfterContinuation.nativeDirectSession === false, {
      readOnlyImported: importedParentAfterContinuation.readOnlyImported,
      nativeDirectSession: importedParentAfterContinuation.nativeDirectSession,
    });
    const retryCallsBefore = counters.directProviderRequestCalls;
    const duplicate = await importController.startCheckpointContinuation(project, {
      importId: materialized.session.importLineage.importId,
      clientCheckpointContinuationId: "client_rug008_checkpoint_1",
      userPromptText: "Continue from this imported checkpoint as fresh evidence; do not resume provider state.",
      model,
    });
    assertCase(cases, "checkpoint_continuation_idempotent_retry_no_resend", duplicate.reused === true && counters.directProviderRequestCalls === retryCallsBefore, {
      reused: duplicate.reused,
      directProviderRequestCalls: counters.directProviderRequestCalls,
    });
    const forbiddenSentinelsZero = [
      counters.appServerSpawnCalls,
      counters.appServerMutationCalls,
      counters.workspaceReadCalls,
      counters.patchApplyCalls,
      counters.commandRunCalls,
      counters.rightPaneMutationCalls,
      counters.handoffMutationCalls,
    ].every((count) => count === 0);
    assertCase(cases, "checkpoint_continuation_forbidden_sentinels_zero", forbiddenSentinelsZero, counters);

    const failedCases = cases.filter((entry) => entry.status !== "passed");
    const report = {
      schema: REPORT_SCHEMA,
      runId,
      generatedAt: nowIso(),
      status: failedCases.length ? "failed" : "passed",
      coverageSource: mode === "live" ? "real_provider" : "fixture_provider_shaped",
      matrixRowsExercised: ["import_checkpoint_continuation"],
      matrixPromotionCandidate: mode === "live" && failedCases.length === 0,
      rug008Closed: mode === "live" && failedCases.length === 0,
      liveProviderOptIn: mode === "live",
      counts: {
        passed: cases.length - failedCases.length,
        failed: failedCases.length,
        total: cases.length,
      },
      importCheckpoint: {
        importId: materialized.session.importLineage.importId,
        importState: materialized.importState,
        materializedSessionId: materialized.sessionId,
        readOnlyImported: true,
        nativeDirectSession: false,
        sourceDisplayName: materialized.rendererSafeSession.source.sourceDisplayName,
      },
      continuation: {
        continuationId: result.continuation.continuationId,
        sessionId: result.sessionId,
        turnId: result.turnId,
        turnState: continuationTurn.state,
        sourceClass: continuationSession.sourceClass,
        previousResponseIdFromImportUsed: false,
        importedToolReplayAttempted: false,
        seedShapeHashPresent: Boolean(seedArtifact.seedShapeHash),
        requestShapeHashPresent: Boolean(requestShapeArtifact.requestShapeHash),
      },
      rawExposure: {
        rawPathExposed: false,
        rawUrlExposed: false,
        rawCredentialsExposed: false,
        rawBackendFrameExposed: false,
        rawRequestBodyStored: false,
        contextTextExposed: false,
        rawSourceSha256Exposed: false,
      },
      sentinelCounters: counters,
      cases,
    };
    const findings = scanFixtureForSecrets(report);
    if (findings.length) {
      report.status = "failed";
      report.rawExposure.rawExposureScanFailed = true;
      report.rawExposure.findings = findings;
      report.cases.push({
        caseId: "checkpoint_continuation_report_raw_exposure_scan",
        status: "failed",
        details: { findings },
      });
    }
    const reportPath = path.join(runRoot, "direct-import-checkpoint-continuation-report.json");
    writeJsonAtomic(reportPath, report);
    console.log(JSON.stringify({
      ok: report.status === "passed",
      reportPath,
      status: report.status,
      coverageSource: report.coverageSource,
      matrixPromotionCandidate: report.matrixPromotionCandidate,
      rug008Closed: report.rug008Closed,
      passedCases: report.counts.passed,
      totalCases: report.counts.total,
    }, null, 2));
    process.exitCode = report.status === "passed" ? 0 : 1;
  } finally {
    if (threadStore) threadStore.close();
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
