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
const { DirectSessionStore, writeJsonAtomic } = require("../src/main/direct/session/session-store");
const { DirectThreadStore, FORK_PREVIEW_PROJECTION_KIND } = require("../src/main/direct/thread/thread-store");
const { DirectThreadWorkbenchController } = require("../src/main/direct/thread/thread-workbench-controller");

const REPORT_SCHEMA = "direct_fresh_fork_start_regression_report@1";
const USER_DATA_ROOT_ENV_VAR = "CODEX_REVIEW_SHELL_USER_DATA_ROOT";
const LIVE_ENV = "CODEX_DIRECT_RUG007_LIVE";
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

function createProject(projectId, model) {
  return {
    id: projectId,
    name: "RUG-007 Fresh Fork Project",
    updatedAt: "2023-11-14T22:13:40.000Z",
    workspace: { kind: "local", localPath: "[REDACTED:private-path]" },
    surfaceBinding: {
      codex: {
        runtimeMode: "direct-experimental",
        directTransport: "live-text",
        directTier: "text-only",
        model,
        profileId: "rug007_profile",
      },
    },
  };
}

function createSourceThread({ sessionStore, threadStore, projectId, model }) {
  const session = sessionStore.createSession({
    sessionId: "direct_session_rug007_source",
    projectId,
    title: "RUG-007 source thread",
    model,
    runtimeMode: "direct-experimental",
    directTransport: "direct-live-text",
    sourceClass: "direct-native",
    nativeDirectSession: true,
    providerContinuityAvailable: false,
    continuityState: "fresh_session_only",
  }, { nowMs: 1_700_000_020_000 });
  const turn = sessionStore.createTurn(session.sessionId, {
    turnId: "direct_turn_rug007_source",
    state: "completed",
    input: [{
      role: "user",
      text: "Capture a parser implementation plan for a future fresh fork.",
    }],
    model,
    requestShape: { requestShapeClass: "direct_text_turn_recent_dialogue@1", store: false, tools: false },
  }, { nowMs: 1_700_000_020_010 });
  sessionStore.appendNormalizedEvents(session.sessionId, turn.turnId, [
    {
      type: "message_delta",
      text: "Parser plan: tokenize identifiers, parse assignments, and return a compact syntax tree.",
    },
    {
      type: "response_completed",
      responseId: "resp_rug007_source",
    },
  ], { nowMs: 1_700_000_020_020 });
  sessionStore.updateTurnState(session.sessionId, turn.turnId, "completed", {
    responseId: "resp_rug007_source",
  }, { nowMs: 1_700_000_020_030 });
  threadStore.indexSessionArtifacts(sessionStore, sessionStore.readSession(session.sessionId), [sessionStore.readTurn(session.sessionId, turn.turnId)], {
    nowMs: 1_700_000_020_040,
  });
  threadStore.buildRendererTranscriptProjection(session.sessionId, {
    sessionStore,
    force: true,
    nowMs: 1_700_000_020_050,
  });
  return {
    session: sessionStore.readSession(session.sessionId),
    projection: threadStore.readRendererTranscriptProjection(session.sessionId, { limit: 50 }),
  };
}

function fixtureForkStartSse() {
  return [
    "event: response.created",
    "data: {\"response\":{\"id\":\"resp_rug007_fork\",\"model\":\"gpt-5.4\"}}",
    "",
    "event: response.output_text.delta",
    "data: {\"item_id\":\"msg_rug007_fork\",\"delta\":\"Fresh fork completed from quoted source evidence.\"}",
    "",
    "event: response.completed",
    "data: {\"response\":{\"id\":\"resp_rug007_fork\",\"status\":\"completed\"}}",
    "",
  ].join("\n");
}

function makeAuthStore(mode) {
  if (mode === "live") return createCodexCliAuthStore();
  return {
    readStatus: () => ({ status: "authenticated", accountId: "acct_rug007_fixture", hasAccessToken: true }),
    readCredentials: () => ({ accessToken: "rug007_fixture_access_token_secret" }),
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
    return textResponse(fixtureForkStartSse(), 200, { "content-type": "text/event-stream" });
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
    throw new Error(`Live fresh-fork start requires --allow-live-provider-call, ${LIVE_ENV}=1, or CODEX_DIRECT_REAL_TURN=1.`);
  }
  if (mode === "live" && process.env.CI === "true" && process.env[LIVE_CI_ENV] !== "1") {
    throw new Error(`Live fresh-fork start in CI requires ${LIVE_CI_ENV}=1.`);
  }

  const runId = safeIdPart(options["run-id"] || options.runId || `rug007_${mode}_${Date.now()}`);
  const model = normalizeString(options.model, "gpt-5.4");
  const root = path.resolve(normalizeString(process.env[USER_DATA_ROOT_ENV_VAR], defaultAppUserDataRoot()));
  const runRoot = path.join(root, "direct-fresh-fork-start-runs", runId);
  fs.rmSync(runRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  ensureDirectory(runRoot);

  const projectId = "project_rug007_fresh_fork";
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
    const project = createProject(projectId, model);
    const source = createSourceThread({ sessionStore, threadStore, projectId, model });

    const liveController = new DirectLiveTextController({
      sessionStore,
      directThreadStore: threadStore,
      profileDoc: acceptedLiveTextProfile(model),
      authStore: makeAuthStore(mode),
      endpoint: normalizeString(options.endpoint, ""),
      fetchImpl: makeFetchImpl({ mode, counters, requestBodies }),
    });
    const workbench = new DirectThreadWorkbenchController({
      threadStore,
      sessionStore,
      liveTextController: () => liveController,
      now: () => 1_700_000_020_100,
    });

    const initialSnapshot = await workbench.getSnapshot(project, { refresh: true });
    const previewOperation = await workbench.createForkPreview(project, {
      threadId: source.session.sessionId,
      selectedStableSourceItemKeys: source.projection.items.map((item) => item.stableSourceItemKey),
      expectedLifecycleState: "active",
      expectedRendererProjectionId: source.projection.projectionId,
      expectedRendererProjectionDigest: source.projection.projectionDigest,
      expectedWorkbenchRevision: initialSnapshot.workbenchRevision,
      expectedOperationLedgerHeadDigest: initialSnapshot.operationLedgerHeadDigest,
      clientOperationId: "client_rug007_fork_preview",
    });
    const previewProjection = threadStore.readProjectProjectionByKind(projectId, FORK_PREVIEW_PROJECTION_KIND);
    assertCase(cases, "fresh_fork_preview_valid", previewOperation.projectionKind === FORK_PREVIEW_PROJECTION_KIND && previewProjection.status === "valid", {
      projectionKind: previewOperation.projectionKind,
      status: previewProjection.status,
    });

    const snapshotAfterPreview = await workbench.getSnapshot(project, { refresh: true });
    const preparation = await workbench.prepareForkStart(project, {
      sourcePreviewId: previewOperation.projectionId,
      expectedSourcePreviewDigest: previewProjection.projectionDigest,
      expectedWorkbenchRevision: snapshotAfterPreview.workbenchRevision,
      expectedOperationLedgerHeadDigest: snapshotAfterPreview.operationLedgerHeadDigest,
      selectedModel: model,
    });
    assertCase(cases, "fresh_fork_confirmation_fresh_session_only", Boolean(preparation.confirmationId) && preparation.previousResponseIdUsed === false, {
      requestShapeEvidenceRef: preparation.requestShapeEvidenceRef,
      sourcePreviewOperationIdPresent: Boolean(preparation.sourcePreviewOperationId),
    });

    const result = await workbench.startForkFromPreview(project, {
      clientForkStartId: "client_rug007_fork_start",
      clientOperationId: "client_rug007_fork_start_operation",
      confirmationId: preparation.confirmationId,
      sourcePreviewId: preparation.sourcePreviewId,
      expectedSourcePreviewDigest: preparation.sourcePreviewDigest,
      currentUserPrompt: "Start a fresh fork from the quoted parser plan. Do not resume provider state.",
      selectedModel: preparation.selectedModel,
    });
    const requestBody = requestBodies.at(-1) || {};
    assertCase(cases, "fresh_fork_provider_request_shape", result.status === "completed" && counters.directProviderRequestCalls === 1, {
      status: result.status,
      directProviderRequestCalls: counters.directProviderRequestCalls,
      coverageSource: mode === "live" ? "real_provider" : "fixture_provider_shaped",
    });
    assertCase(cases, "fresh_fork_no_source_continuity", !requestBody.previous_response_id && requestBody.store === false && !requestBody.tools, {
      previousResponseIdUsed: Boolean(requestBody.previous_response_id),
      store: requestBody.store,
      toolsDeclared: Boolean(requestBody.tools),
    });
    assertCase(cases, "fresh_fork_source_evidence_quoted", String(requestBody.input?.[0]?.content?.[0]?.text || "").includes("[FORK SOURCE EVIDENCE - QUOTED]"), {
      sourceEvidenceQuoted: true,
    });

    const forkedSession = sessionStore.readSession(result.sessionId);
    const forkedTurn = sessionStore.readTurn(result.sessionId, result.turnId);
    const requestManifest = threadStore.readRequestManifest(forkedTurn.requestManifestId);
    const contextPack = threadStore.readContextPack(forkedTurn.contextBuildId);
    const seedArtifact = JSON.parse(fs.readFileSync(threadStore.forkStartPath(projectId, result.forkStartId, "fork-seed.json"), "utf8"));
    assertCase(cases, "fresh_fork_artifacts_persisted", Boolean(seedArtifact.forkSeedId && requestManifest?.requestManifestId && contextPack?.contextBuildId), {
      seedPolicyId: seedArtifact.seedPolicyId,
      requestShapeClass: requestManifest?.requestShapeClass,
      contextPurpose: contextPack?.purpose,
    });
    assertCase(cases, "fresh_fork_session_terminal_state", forkedSession.sourceClass === "forked-direct-native" &&
      forkedSession.providerContinuityAvailable === false &&
      forkedSession.composerState === "enabled" &&
      forkedTurn.firstTurnTerminalKind === "completed_with_assistant_text", {
      sourceClass: forkedSession.sourceClass,
      providerContinuityAvailable: forkedSession.providerContinuityAvailable,
      composerState: forkedSession.composerState,
      firstTurnTerminalKind: forkedTurn.firstTurnTerminalKind,
    });

    const status = await workbench.readForkStartStatus(project, result.forkStartId);
    assertCase(cases, "fresh_fork_status_renderer_safe", status.artifacts.contextPackStored === true &&
      status.artifacts.requestManifestStored === true &&
      status.artifacts.contextTextExposed === false &&
      status.artifacts.requestBodyExposed === false, {
      status: status.status,
      contextTextExposed: status.artifacts.contextTextExposed,
      requestBodyExposed: status.artifacts.requestBodyExposed,
    });

    const retryCallsBefore = counters.directProviderRequestCalls;
    const retry = await liveController.startForkFromPreview({
      project,
      sourcePreviewId: preparation.sourcePreviewId,
      clientForkStartId: "client_rug007_fork_start",
      clientOperationId: "client_rug007_fork_start_operation",
      currentUserPrompt: "Start a fresh fork from the quoted parser plan. Do not resume provider state.",
      selectedModel: preparation.selectedModel,
    });
    assertCase(cases, "fresh_fork_idempotent_retry_no_resend", retry.sessionId === result.sessionId && counters.directProviderRequestCalls === retryCallsBefore, {
      retrySessionIdMatches: retry.sessionId === result.sessionId,
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
    assertCase(cases, "fresh_fork_forbidden_sentinels_zero", forbiddenSentinelsZero, counters);

    const failedCases = cases.filter((entry) => entry.status !== "passed");
    const report = {
      schema: REPORT_SCHEMA,
      runId,
      generatedAt: nowIso(),
      status: failedCases.length ? "failed" : "passed",
      coverageSource: mode === "live" ? "real_provider" : "fixture_provider_shaped",
      matrixRowsExercised: ["G8"],
      matrixPromotionCandidate: mode === "live" && failedCases.length === 0,
      rug007Closed: mode === "live" && failedCases.length === 0,
      liveProviderOptIn: mode === "live",
      counts: {
        passed: cases.length - failedCases.length,
        failed: failedCases.length,
        total: cases.length,
      },
      sourcePreviewKind: "fork_preview",
      sourcePreviewDigest: previewProjection.projectionDigest,
      forkStart: {
        forkStartId: result.forkStartId,
        sessionId: result.sessionId,
        turnId: result.turnId,
        firstTurnTerminalKind: forkedTurn.firstTurnTerminalKind,
        localSessionState: result.localSessionState,
        composerState: forkedSession.composerState,
        previousResponseIdUsed: false,
        providerContinuityHandleUsed: false,
        sourcePreviousResponseIdUsed: false,
        requestShapeClass: requestManifest.requestShapeClass,
        seedPolicyId: seedArtifact.seedPolicyId,
      },
      rawExposure: {
        rawPathExposed: false,
        rawUrlExposed: false,
        rawCredentialsExposed: false,
        rawBackendFrameExposed: false,
        rawRequestBodyStored: false,
        contextTextExposed: false,
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
        caseId: "fresh_fork_report_raw_exposure_scan",
        status: "failed",
        details: { findings },
      });
    }
    const reportPath = path.join(runRoot, "direct-fresh-fork-start-report.json");
    writeJsonAtomic(reportPath, report);
    console.log(JSON.stringify({
      ok: report.status === "passed",
      reportPath,
      status: report.status,
      coverageSource: report.coverageSource,
      matrixPromotionCandidate: report.matrixPromotionCandidate,
      rug007Closed: report.rug007Closed,
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
