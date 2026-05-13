#!/usr/bin/env node

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const { scanFixtureForSecrets } = require("../src/main/direct/fixtures/redaction");
const { writeJsonAtomic } = require("../src/main/direct/session/session-store");
const {
  DIRECT_THREAD_EVIDENCE_WORKBENCH_REPORT_SCHEMA,
  DIRECT_THREAD_LIFECYCLE_TRANSITIONS,
  buildDirectThreadEvidenceWorkbenchReport,
  validateThreadEvidenceWorkbenchProjection,
} = require("../src/main/direct/thread/thread-evidence-workbench");

const USER_DATA_ROOT_ENV_VAR = "CODEX_REVIEW_SHELL_USER_DATA_ROOT";

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function safeIdPart(value, fallback = "run") {
  return normalizeString(value, fallback).replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || fallback;
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
  return path.join(platformAppDataRoot(), "Codex Review Shell");
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function fixtureSnapshot() {
  const generatedAt = nowIso();
  return {
    schema: "renderer_safe_direct_thread_workbench_snapshot@1",
    projectId: "project_workbench_fixture",
    projectGeneration: 7,
    workbenchRevision: "workbench_fixture_revision",
    operationLedgerHeadDigest: "ledger_fixture_head",
    lifecycleProjectionDigest: "lifecycle_fixture_digest",
    graphProjectionDigest: "graph_fixture_digest",
    status: {
      available: true,
      health: "ok",
      threadCount: 3,
      operationCount: 5,
    },
    filters: {
      includeHidden: true,
      includeArchived: true,
      includeSoftDeleted: true,
      textQuery: "",
    },
    search: {
      mode: "none",
      queryApplied: false,
      resultMayBePartial: false,
    },
    lifecycle: {
      projectionId: "thread_lifecycle_fixture",
      status: "valid",
      digest: "lifecycle_fixture_digest",
      counts: {
        active: 1,
        hidden: 1,
        archived: 0,
        soft_deleted: 1,
      },
    },
    graph: {
      projectionId: "thread_graph_fixture",
      status: "valid",
      digest: "graph_fixture_digest",
      itemCount: 5,
      items: [
        {
          itemKind: "graph_thread_node",
          threadId: "thread_active_fixture",
          text: "Active fixture thread",
        },
        {
          itemKind: "graph_external_ref",
          text: "ChatGPT binding reference",
          externalRef: {
            externalRefId: "external_ref_chatgpt_fixture",
            refKind: "chatgpt-thread-binding",
            targetId: "chatgpt_binding_evidence_key",
            rendererSafeUrlHash: "hmac_chatgpt_url",
            transcriptImported: false,
          },
        },
        {
          itemKind: "bridge_edge",
          text: "related:direct_thread->direct_thread",
          edge: {
            edgeId: "edge_related_fixture",
            edgeKind: "related",
            sourceKind: "direct_thread",
            sourceId: "thread_active_fixture",
            targetKind: "direct_thread",
            targetId: "thread_hidden_fixture",
          },
        },
      ],
    },
    threads: [
      {
        threadId: "thread_active_fixture",
        title: "Active fixture thread",
        sourceClass: "direct",
        lifecycle: { state: "active" },
        rendererProjection: {
          projectionId: "renderer_projection_active",
          projectionDigest: "renderer_digest_active",
          status: "valid",
          unsafeForRenderer: false,
          unsafeForContextBuild: true,
        },
        activeTurnCount: 0,
      },
      {
        threadId: "thread_hidden_fixture",
        title: "Hidden imported fixture",
        sourceClass: "legacy-codex-jsonl",
        lifecycle: { state: "hidden" },
        rendererProjection: {
          projectionId: "renderer_projection_hidden",
          projectionDigest: "renderer_digest_hidden",
          status: "valid",
          unsafeForRenderer: false,
          unsafeForContextBuild: true,
        },
        activeTurnCount: 0,
      },
      {
        threadId: "thread_soft_deleted_fixture",
        title: "Reversible tombstone fixture",
        sourceClass: "direct",
        lifecycle: { state: "soft_deleted" },
        rendererProjection: {
          projectionId: "renderer_projection_deleted",
          projectionDigest: "renderer_digest_deleted",
          status: "valid",
          unsafeForRenderer: false,
          unsafeForContextBuild: true,
        },
        activeTurnCount: 0,
      },
    ],
    page: {
      threads: {
        offset: 0,
        limit: 80,
        returned: 3,
        total: 3,
      },
    },
    operationSummary: {
      entries: [
        {
          operationId: "operation_merge_preview_fixture",
          operationType: "create_merge_preview",
          status: "committed",
          requestedAt: generatedAt,
          rendererSafeSummary: "merge preview created",
          effects: [{
            effectKind: "preview_projection_written",
            targetKind: "projection",
            targetId: "merge_preview_fixture",
            rendererSafeSummary: "non-runnable merge preview",
          }],
        },
        {
          operationId: "operation_prune_preview_fixture",
          operationType: "create_prune_preview",
          status: "committed",
          requestedAt: generatedAt,
          rendererSafeSummary: "prune preview created",
          effects: [{
            effectKind: "preview_projection_written",
            targetKind: "projection",
            targetId: "prune_preview_fixture",
            rendererSafeSummary: "omission marker preview",
          }],
        },
        {
          operationId: "operation_soft_delete_fixture",
          operationType: "soft_delete_thread",
          status: "committed",
          requestedAt: generatedAt,
          rendererSafeSummary: "thread soft-deleted",
          effects: [{
            effectKind: "lifecycle_state_changed",
            targetKind: "direct_thread",
            targetId: "thread_soft_deleted_fixture",
            rendererSafeSummary: "active -> soft_deleted",
          }],
        },
      ],
      page: {
        offset: 0,
        limit: 20,
        returned: 3,
        total: 3,
      },
      rawExposure: {
        rawInputPayloadExposed: false,
        rawErrorPayloadExposed: false,
        rawPathExposed: false,
        rawChatGptUrlExposed: false,
      },
    },
    rawExposure: {
      rawPathExposed: false,
      rawChatGptUrlExposed: false,
      rawSourceHashExposed: false,
      rawJsonlExposed: false,
      rawBackendFrameExposed: false,
      rawAuthExposed: false,
    },
  };
}

function buildReport() {
  const report = buildDirectThreadEvidenceWorkbenchReport({ snapshot: fixtureSnapshot() });
  const projection = report.projection;
  assert(report.schema === DIRECT_THREAD_EVIDENCE_WORKBENCH_REPORT_SCHEMA, "Report schema must match.");
  assert(validateThreadEvidenceWorkbenchProjection(projection), "Evidence workbench projection must validate.");
  assert(DIRECT_THREAD_LIFECYCLE_TRANSITIONS.soft_deleted.restore_soft_deleted_thread === "active", "Soft-deleted restore must use explicit operation.");
  assert(!DIRECT_THREAD_LIFECYCLE_TRANSITIONS.soft_deleted.restore_thread, "restore_thread must not restore soft-deleted state.");
  assert(projection.previews.length >= 2, "Fixture should include preview summaries.");
  assert(projection.previews.every((preview) => preview.nonRunnable && preview.canStartFreshForkInThisPr === false), "Previews must be non-runnable in PR 6.");
  assert(projection.operationHistory.rows.every((row) => row.actionability?.actionable === false), "Operation history must be read-only.");
  assert(projection.externalRefs.every((ref) => ref.transcriptImported === false && ref.rawChatGptUrlIncluded === false), "External refs must not import transcript or expose raw URLs.");
  assert(projection.tombstones.some((row) => row.hardPurgeAvailable === false && row.canRestore === true), "Soft-delete tombstone must be reversible and non-purge.");
  assert(Object.values(projection.sentinelCounters).every((value) => Number(value || 0) === 0), "Workbench projection must not exercise provider/runtime authority.");
  return report;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runId = safeIdPart(options["run-id"], `thread_workbench_${Date.now()}`);
  const userDataRoot = normalizeString(process.env[USER_DATA_ROOT_ENV_VAR], defaultAppUserDataRoot());
  const reportDir = path.join(userDataRoot, "direct-thread-evidence-workbench", runId);
  ensureDirectory(reportDir);

  const report = buildReport();
  const reportText = JSON.stringify(report, null, 2);
  const findings = scanFixtureForSecrets(JSON.parse(reportText), { privatePathRoots: [repoRoot, userDataRoot] });
  if (findings.length) {
    const safeFailure = {
      schema: DIRECT_THREAD_EVIDENCE_WORKBENCH_REPORT_SCHEMA,
      generatedAt: nowIso(),
      coverageSource: "fixture_workbench",
      matrixPromotionCandidate: false,
      authorityPromotionCandidate: false,
      runtimeAuthorityExercised: false,
      providerAuthorityExercised: false,
      status: "redaction_blocked",
      blockerCode: "direct_thread_evidence_workbench_raw_exposure",
    };
    writeJsonAtomic(path.join(reportDir, "direct-thread-evidence-workbench-report.json"), safeFailure);
    throw new Error("direct_thread_evidence_workbench_raw_exposure");
  }

  const reportPath = path.join(reportDir, "direct-thread-evidence-workbench-report.json");
  writeJsonAtomic(reportPath, report);
  const reread = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert(reread.schema === DIRECT_THREAD_EVIDENCE_WORKBENCH_REPORT_SCHEMA, "Re-read report schema must match.");
  assert(reread.matrixPromotionCandidate === false, "Fixture workbench must not promote matrix rows.");
  assert(reread.authorityPromotionCandidate === false, "Fixture workbench must not promote authority.");
  console.log(JSON.stringify({
    ok: true,
    reportPath,
    coverageSource: reread.coverageSource,
    matrixPromotionCandidate: reread.matrixPromotionCandidate,
    authorityPromotionCandidate: reread.authorityPromotionCandidate,
    previewCount: reread.projection.previews.length,
    operationRows: reread.projection.operationHistory.rows.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
