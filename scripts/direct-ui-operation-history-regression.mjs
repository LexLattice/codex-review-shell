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
  DIRECT_IMPLEMENTATION_LANE_UI_STATUS_SCHEMA,
  DIRECT_OPERATION_HISTORY_PROJECTION_SCHEMA,
  DIRECT_POLICY_READONLY_VIEW_SCHEMA,
  DIRECT_UI_PARITY_REPORT_SCHEMA,
  buildDirectImplementationLaneUiStatus,
  buildDirectPolicyReadOnlyView,
  projectOperationHistoryPage,
  validateDirectUiProjection,
} = require("../src/main/direct/ui/implementation-lane-ui");

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

function fixtureRuntimeStatus() {
  return {
    projectId: "project_ui_fixture",
    direct: {
      status: "ready",
      model: "gpt-ui-fixture",
      modelEvidenceState: "runtime_probed",
      evidenceId: "evidence_model_fixture",
      auth: {
        status: "authenticated",
        source: "codex-cli-auth",
      },
      liveProbeEvidence: {
        usable: true,
      },
    },
    diagnostics: {
      legacyAppServerAvailable: true,
    },
    directTextOnly: {
      selected: false,
      canSelect: true,
      canStartFirstTurn: true,
      blockers: [],
    },
    directImplementationLane: {
      selected: true,
      status: "enabled",
      canSelect: true,
      canStartFirstTurn: true,
      canStartFollowupTurn: true,
      canShowObligations: true,
      canApproveReadFile: true,
      canApprovePatchApply: true,
      canApproveRunCommand: true,
      canSendContinuation: true,
      blockers: [],
      readOnlyToolLoop: {
        continuationEvidenceState: "accepted",
      },
      patchApply: {
        continuationEvidenceState: "accepted",
      },
      commandExecution: {
        continuationEvidenceState: "accepted",
      },
    },
    sessionStore: {
      available: true,
      activeTurnCount: 0,
      unresolvedObligationCount: 0,
      lastTurnState: "completed",
    },
    directThreadStore: {
      available: true,
      operationCount: 2,
      recovery: {
        state: "healthy_terminal",
        confidence: "exact",
      },
    },
  };
}

function fixtureOperationHistory() {
  return {
    history: {
      entries: [
        {
          operationId: "op_read_fixture",
          operationType: "read_file_result_recorded",
          status: "committed",
          requestedAt: nowIso(),
          rendererSafeSummary: "Read result recorded; provider continuation completed.",
          effects: [
            {
              effectKind: "read_file",
              targetKind: "artifact",
              targetId: "read_result_artifact",
              rendererSafeSummary: "Read evidence recorded.",
            },
          ],
        },
        {
          operationId: "op_workspace_effect_fixture",
          operationType: "workspace_effect_summary_recorded",
          status: "committed",
          requestedAt: nowIso(),
          rendererSafeSummary: "Workspace changed; provider saw summary only.",
          effects: [
            {
              effectKind: "workspace-effect",
              targetKind: "artifact",
              targetId: "workspace_effect_summary",
              rendererSafeSummary: "Summary only.",
            },
          ],
        },
      ],
      page: {
        offset: 0,
        limit: 24,
        returned: 2,
        total: 2,
      },
      rawExposure: {
        rawInputPayloadExposed: false,
        rawErrorPayloadExposed: false,
        rawPathExposed: false,
        rawChatGptUrlExposed: false,
      },
    },
  };
}

function buildReport() {
  const project = { id: "project_ui_fixture", name: "UI fixture" };
  const runtimeStatus = fixtureRuntimeStatus();
  const uiStatus = buildDirectImplementationLaneUiStatus({ project, runtimeStatus });
  const recoveryRuntimeStatus = fixtureRuntimeStatus();
  recoveryRuntimeStatus.directImplementationLane.activeRecoveryState = "stream_interrupted";
  const recoveryUiStatus = buildDirectImplementationLaneUiStatus({ project, runtimeStatus: recoveryRuntimeStatus });
  const circularRuntimeStatus = fixtureRuntimeStatus();
  circularRuntimeStatus.self = circularRuntimeStatus;
  const circularUiStatus = buildDirectImplementationLaneUiStatus({ project, runtimeStatus: circularRuntimeStatus });
  const policy = buildDirectPolicyReadOnlyView({ project, runtimeStatus });
  const history = projectOperationHistoryPage({
    projectId: project.id,
    operationHistory: fixtureOperationHistory(),
    request: { scope: "active-turn", limit: 24 },
  });

  assert(validateDirectUiProjection(uiStatus, DIRECT_IMPLEMENTATION_LANE_UI_STATUS_SCHEMA), "UI status projection must validate.");
  assert(validateDirectUiProjection(policy, DIRECT_POLICY_READONLY_VIEW_SCHEMA), "Policy projection must validate.");
  assert(validateDirectUiProjection(history, DIRECT_OPERATION_HISTORY_PROJECTION_SCHEMA), "History projection must validate.");
  assert(uiStatus.implementationLane.facets.canApproveRead.canUse, "Read approval facet should be usable.");
  assert(uiStatus.implementationLane.facets.canApprovePatch.canUse, "Patch approval facet should be usable.");
  assert(uiStatus.implementationLane.facets.canApproveCommand.canUse, "Command approval facet should be usable.");
  assert(recoveryUiStatus.implementationLane.canRollbackToAppServer === false, "Active recovery must block app-server rollback.");
  assert(validateDirectUiProjection(circularUiStatus, DIRECT_IMPLEMENTATION_LANE_UI_STATUS_SCHEMA), "Circular runtime input must still produce a safe projection.");
  assert(policy.editable === false && policy.privateConfigIncluded === false, "Policy view must be read-only and private-config-free.");
  assert(history.rows.every((row) => row.actionability?.actionable === false), "Operation history rows must be read-only.");
  assert(uiStatus.witnesses.some((entry) => entry.kind === "handoff-boundary" && entry.handoff?.handoffStateUsedForReadiness === false), "Handoff witness must stay non-authoritative.");

  return {
    schema: DIRECT_UI_PARITY_REPORT_SCHEMA,
    generatedAt: nowIso(),
    coverageSource: "fixture_ui",
    matrixPromotionCandidate: false,
    rowsExercised: ["F5", "F6", "F7", "F8", "F9", "J1", "J3", "J4", "J5", "J6", "J7", "J8"],
    status: "passed",
    projections: {
      uiStatusSchema: uiStatus.schema,
      uiProjectionGeneration: uiStatus.meta.uiProjectionGeneration,
      historySchema: history.schema,
      policySchema: policy.schema,
      historyRows: history.rows.length,
      witnessCount: uiStatus.witnesses.length,
      policyEditable: policy.editable,
      operationHistoryActionableRows: history.rows.filter((row) => row.actionability?.actionable).length,
    },
    sentinelCounters: {
      providerTransportCalls: 0,
      appServerSpawnCalls: 0,
      workspaceReadCalls: 0,
      patchApplyCalls: 0,
      commandRunCalls: 0,
      rightPaneMutationCalls: 0,
      handoffMutationCalls: 0,
    },
    rawExposure: {
      rawProviderPayloadIncluded: false,
      rawLocalPathIncluded: false,
      rawToolOutputIncluded: false,
      rawChatGptUrlIncluded: false,
    },
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runId = safeIdPart(options["run-id"], `ui_${Date.now()}`);
  const userDataRoot = normalizeString(process.env[USER_DATA_ROOT_ENV_VAR], defaultAppUserDataRoot());
  const reportDir = path.join(userDataRoot, "direct-ui-operation-history", runId);
  ensureDirectory(reportDir);

  const report = buildReport();
  const reportText = JSON.stringify(report, null, 2);
  const findings = scanFixtureForSecrets(JSON.parse(reportText), { privatePathRoots: [repoRoot, userDataRoot] });
  if (findings.length) {
    const safeFailure = {
      schema: DIRECT_UI_PARITY_REPORT_SCHEMA,
      generatedAt: nowIso(),
      coverageSource: "fixture_ui",
      matrixPromotionCandidate: false,
      status: "redaction_blocked",
      blockerCode: "direct_ui_report_raw_exposure",
    };
    writeJsonAtomic(path.join(reportDir, "direct-ui-operation-history-report.json"), safeFailure);
    throw new Error("direct_ui_report_raw_exposure");
  }

  const reportPath = path.join(reportDir, "direct-ui-operation-history-report.json");
  writeJsonAtomic(reportPath, report);
  const reread = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert(reread.schema === DIRECT_UI_PARITY_REPORT_SCHEMA, "Re-read report schema must match.");
  assert(reread.matrixPromotionCandidate === false, "Fixture UI report must not promote matrix rows.");
  console.log(JSON.stringify({
    ok: true,
    reportPath,
    status: report.status,
    coverageSource: report.coverageSource,
    matrixPromotionCandidate: report.matrixPromotionCandidate,
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
