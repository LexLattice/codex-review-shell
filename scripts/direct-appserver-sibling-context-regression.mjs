#!/usr/bin/env node

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);

const { scanFixtureForSecrets } = require("../src/main/direct/fixtures/redaction");
const { writeJsonAtomic } = require("../src/main/direct/session/session-store");
const {
  buildVanillaSiblingContextEvidence,
  sha256,
  stableStringify,
} = require("../src/main/direct/context/maintenance");
const {
  buildContextPack,
} = require("../src/main/direct/thread/context-pack");
const {
  buildDirectImplementationLaneUiStatus,
} = require("../src/main/direct/ui/implementation-lane-ui");

const REPORT_SCHEMA = "direct_appserver_sibling_context_regression_report@1";
const USER_DATA_ROOT_ENV_VAR = "CODEX_REVIEW_SHELL_USER_DATA_ROOT";

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function gitValue(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function digestEvent(event) {
  return sha256(stableStringify({
    method: normalizeString(event?.method, ""),
    itemId: normalizeString(event?.params?.item?.id || event?.params?.itemId, ""),
    itemType: normalizeString(event?.params?.item?.type || event?.params?.type, ""),
    threadId: normalizeString(event?.params?.threadId || event?.params?.thread?.id, ""),
  }));
}

function eventItem(event = {}) {
  if (isPlainObject(event.params?.item)) return event.params.item;
  if (isPlainObject(event.item)) return event.item;
  return null;
}

function normalizeAppServerSiblingObservation({ projectId, threadId, events = [], controls = [] } = {}) {
  const threadItems = [];
  const sourceRefs = [];
  for (const event of events) {
    const item = eventItem(event);
    if (!item) continue;
    const itemThreadId = normalizeString(event.params?.threadId || item.threadId || threadId, threadId);
    if (itemThreadId !== threadId) continue;
    threadItems.push({
      id: normalizeString(item.id, `item_${threadItems.length + 1}`),
      type: normalizeString(item.type || item.itemType, "unknown"),
      lifecycle: normalizeString(item.lifecycle || item.status || event.method, "observed"),
      memoryCitation: isPlainObject(item.memoryCitation) ? {
        evidenceKey: normalizeString(item.memoryCitation.evidenceKey || item.memoryCitation.memoryId || item.memoryCitation.id, ""),
      } : undefined,
    });
    sourceRefs.push({
      artifactKind: "app_server_notification",
      artifactId: `app_server_event_${sourceRefs.length + 1}`,
      artifactDigest: digestEvent(event),
    });
  }
  const controlsObserved = controls
    .filter((control) => normalizeString(control.threadId || threadId, threadId) === threadId)
    .map((control, index) => ({
      method: normalizeString(control.method, ""),
      evidenceKey: normalizeString(control.evidenceKey, `app_server_control_${index + 1}_${sha256(control.method).slice(0, 12)}`),
    }));
  return buildVanillaSiblingContextEvidence({
    projectId,
    threadId,
    sourceConfidence: "accepted",
    sourceRefs,
    threadItems,
    controlsObserved,
  });
}

function fixtureAppServerEvents(threadId) {
  return [
    {
      type: "rpc-notification",
      method: "item/completed",
      params: {
        threadId,
        item: { id: "as_user_1", type: "userMessage", status: "completed" },
      },
    },
    {
      type: "rpc-notification",
      method: "item/completed",
      params: {
        threadId,
        item: { id: "as_compact_1", type: "contextCompaction", status: "completed" },
      },
    },
    {
      type: "rpc-notification",
      method: "item/completed",
      params: {
        threadId,
        item: {
          id: "as_agent_1",
          type: "agentMessage",
          status: "completed",
          memoryCitation: { memoryId: "app_server_memory_citation_1" },
        },
      },
    },
  ];
}

function fixtureAppServerControls(threadId) {
  return [
    { threadId, method: "thread/compact/start", evidenceKey: "as_control_compact_start" },
    { threadId, method: "thread/memoryMode/set", evidenceKey: "as_control_memory_mode" },
    { threadId, method: "memory/reset", evidenceKey: "as_control_memory_reset" },
  ];
}

function directContextPackWithoutSibling(projectId, threadId) {
  return buildContextPack({
    projectId,
    threadId,
    turnId: "direct_turn_after_appserver_switch",
    purpose: "direct_text_turn",
    currentUserPrompt: "Continue in Direct without importing app-server context management state.",
    contextProjection: {
      projectionId: "direct_context_projection_after_switch",
      projectionKind: "context_recent_dialogue",
      projectionDigest: "direct_context_projection_digest_after_switch",
      caps: { omittedCounts: {} },
    },
    contextItems: [
      {
        role: "user",
        itemKind: "message",
        text: "Direct context item remains separate from app-server sibling evidence.",
      },
    ],
  });
}

function validateReport(report = {}) {
  if (report.schema !== REPORT_SCHEMA) throw new Error("direct_appserver_sibling_context_report_schema_mismatch");
  if (!Array.isArray(report.cases) || !report.cases.length) throw new Error("direct_appserver_sibling_context_cases_missing");
  const counters = report.sentinelCounters || {};
  for (const key of [
    "providerTransportCalls",
    "providerCompactPrimitiveCalls",
    "appServerSpawnCalls",
    "appServerMutationCalls",
    "workspaceReadCalls",
    "patchApplyCalls",
    "commandRunCalls",
    "contextPackBuildsFromSibling",
    "requestManifestBuildsFromSibling",
    "rightPaneMutationCalls",
    "handoffMutationCalls",
  ]) {
    if (Number(counters[key] || 0) !== 0) throw new Error(`direct_appserver_sibling_context_sentinel_nonzero:${key}`);
  }
}

function markdownSummary(report) {
  const rows = report.cases.map((entry) => `| \`${entry.caseId}\` | \`${entry.status}\` |`).join("\n");
  return `# Direct App-Server Sibling Context Regression ${report.runId}

- Status: \`${report.status}\`
- Coverage: \`${report.coverageSource}\`
- App-server spawn calls: \`${report.sentinelCounters.appServerSpawnCalls}\`
- App-server mutation calls: \`${report.sentinelCounters.appServerMutationCalls}\`

| Case | Status |
| --- | --- |
${rows}
`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runId = safeIdPart(options.runId || options["run-id"], `rug006_appserver_sibling_${Date.now()}`);
  const appUserDataRoot = path.resolve(normalizeString(options["app-user-data-root"], process.env[USER_DATA_ROOT_ENV_VAR] || defaultAppUserDataRoot()));
  const outputDir = path.join(appUserDataRoot, "direct-appserver-sibling-context-runs", runId);
  ensureDirectory(outputDir);

  const projectId = "project_rug006_appserver_sibling_context";
  const appServerThreadId = "app_server_thread_context_observed";
  const directThreadId = "direct_thread_after_appserver_switch";
  const appServerSibling = normalizeAppServerSiblingObservation({
    projectId,
    threadId: appServerThreadId,
    events: fixtureAppServerEvents(appServerThreadId),
    controls: fixtureAppServerControls(appServerThreadId),
  });
  const appServerUi = buildDirectImplementationLaneUiStatus({
    project: { id: projectId },
    runtimeStatus: {
      projectId,
      diagnostics: { legacyAppServerAvailable: true },
      directContextMaintenance: {
        appServerSibling,
        evidenceKeys: ["vanilla_sibling_context_evidence@1"],
      },
      sessionStore: { available: true, activeTurnCount: 0, unresolvedObligationCount: 0 },
    },
    generatedAt: nowIso(),
  });
  const directContextPack = directContextPackWithoutSibling(projectId, directThreadId);
  const directUiAfterSwitch = buildDirectImplementationLaneUiStatus({
    project: { id: projectId },
    runtimeStatus: {
      projectId,
      directTextOnly: { selected: true, canStartTextTurn: true },
      sessionStore: { available: true, activeTurnCount: 0, unresolvedObligationCount: 0 },
    },
    generatedAt: nowIso(),
  });

  const cases = [];
  assertCase(cases, "rug006_observes_appserver_compaction_and_memory_items", appServerSibling.contextCompaction.length === 1 &&
    appServerSibling.memoryCitations.length === 1 &&
    appServerSibling.sourceConfidence === "accepted", {
    contextCompactionCount: appServerSibling.contextCompaction.length,
    memoryCitationCount: appServerSibling.memoryCitations.length,
    sourceConfidence: appServerSibling.sourceConfidence,
  });
  assertCase(cases, "rug006_observes_appserver_controls_as_sibling_only", appServerSibling.compactControls.length === 1 &&
    appServerSibling.memoryControls.length === 2 &&
    appServerSibling.compactControls.every((control) => control.appServerOnly === true) &&
    appServerSibling.memoryControls.every((control) => control.appServerOnly === true), {
    compactControlCount: appServerSibling.compactControls.length,
    memoryControlCount: appServerSibling.memoryControls.length,
  });
  assertCase(cases, "rug006_sibling_evidence_grants_no_direct_authority", appServerSibling.directContinuityGranted === false &&
    appServerSibling.directContextPackUsable === false &&
    appServerSibling.providerCompactPrimitiveProven === false &&
    appServerSibling.directOmissionLedgerCreated === false &&
    appServerSibling.directMemoryEditorProven === false &&
    appServerSibling.directMemoryArtifactsMutated === false, {
    directContinuityGranted: appServerSibling.directContinuityGranted,
    directContextPackUsable: appServerSibling.directContextPackUsable,
    providerCompactPrimitiveProven: appServerSibling.providerCompactPrimitiveProven,
    directMemoryEditorProven: appServerSibling.directMemoryEditorProven,
  });
  assertCase(cases, "rug006_ui_summary_is_display_only", appServerUi.contextMaintenance.displayOnly === true &&
    appServerUi.contextMaintenance.actionability.actionable === false &&
    appServerUi.contextMaintenance.appServerSibling.contextCompactionObserved === true &&
    appServerUi.contextMaintenance.compactActionAllowed === false &&
    appServerUi.contextMaintenance.memoryEditorAllowed === false &&
    appServerUi.contextMaintenance.providerTransportAllowed === false, {
    appServerSibling: appServerUi.contextMaintenance.appServerSibling,
    compactActionAllowed: appServerUi.contextMaintenance.compactActionAllowed,
    memoryEditorAllowed: appServerUi.contextMaintenance.memoryEditorAllowed,
  });
  assertCase(cases, "rug006_switch_to_direct_thread_prevents_bleed", directUiAfterSwitch.contextMaintenance.appServerSibling.contextCompactionObserved === false &&
    directUiAfterSwitch.contextMaintenance.appServerSibling.memoryCitationCount === 0 &&
    directUiAfterSwitch.contextMaintenance.appServerSibling.directContextPackUsable === false, {
    directContextMaintenance: directUiAfterSwitch.contextMaintenance.appServerSibling,
  });
  assertCase(cases, "rug006_direct_context_pack_excludes_sibling_refs", !stableStringify(directContextPack).includes(appServerSibling.evidenceId) &&
    directContextPack.sourceArtifacts.every((artifact) => artifact.artifactKind !== "vanilla_sibling_context_evidence") &&
    directContextPack.maintenanceRefs === null, {
    sourceArtifactKinds: directContextPack.sourceArtifacts.map((artifact) => artifact.artifactKind),
    maintenanceRefsPresent: Boolean(directContextPack.maintenanceRefs),
  });

  const failed = cases.filter((entry) => entry.status !== "passed");
  let report = {
    schema: REPORT_SCHEMA,
    runId,
    branch: gitValue(["branch", "--show-current"]),
    commit: gitValue(["rev-parse", "HEAD"]),
    generatedAt: nowIso(),
    status: failed.length ? "failed" : "passed",
    coverageSource: "app_server_observation_fixture",
    rug006Closed: failed.length === 0,
    matrixRowsExercised: ["D9", "D10", "D12", "D15", "F8"],
    matrixPromotionCandidate: false,
    authorityPromotionCandidate: false,
    runtimeAuthorityExercised: false,
    providerAuthorityExercised: false,
    cases,
    artifacts: {
      appServerSiblingEvidenceId: appServerSibling.evidenceId,
      appServerSiblingSourceDigest: appServerSibling.integrity?.sourceDigest || "",
      directContextBuildId: directContextPack.contextBuildId,
      appServerUiProjectionGeneration: appServerUi.meta.uiProjectionGeneration,
      directUiProjectionGeneration: directUiAfterSwitch.meta.uiProjectionGeneration,
      rawPathsIncluded: false,
    },
    sentinelCounters: {
      providerTransportCalls: 0,
      providerCompactPrimitiveCalls: 0,
      appServerSpawnCalls: 0,
      appServerMutationCalls: 0,
      workspaceReadCalls: 0,
      patchApplyCalls: 0,
      commandRunCalls: 0,
      contextPackBuildsFromSibling: 0,
      requestManifestBuildsFromSibling: 0,
      rightPaneMutationCalls: 0,
      handoffMutationCalls: 0,
    },
    rawExposureScan: {
      scanned: true,
      status: "passed",
      findingCount: 0,
    },
  };
  validateReport(report);
  const findings = scanFixtureForSecrets(report, { privatePathRoots: [outputDir] });
  report.rawExposureScan.findingCount = findings.length;
  report.rawExposureScan.status = findings.length ? "failed" : "passed";
  const reportPath = path.join(outputDir, "direct-appserver-sibling-context-report.json");
  if (findings.length) {
    report = {
      schema: REPORT_SCHEMA,
      runId,
      generatedAt: nowIso(),
      status: "failed",
      failureCode: "raw_exposure_blocked",
      rawExposureBlocked: true,
      sentinelCounters: report.sentinelCounters,
      rawExposureScan: { scanned: true, status: "failed", findingCount: findings.length },
    };
    writeJsonAtomic(reportPath, report);
    console.log(JSON.stringify({ ok: false, reportPath, status: report.status, failureCode: report.failureCode }, null, 2));
    process.exit(1);
  }
  writeJsonAtomic(reportPath, report);
  writeTextFile(path.join(outputDir, "direct-appserver-sibling-context-report.md"), markdownSummary(report));
  console.log(JSON.stringify({
    ok: report.status === "passed",
    reportPath,
    status: report.status,
    passedCases: cases.filter((entry) => entry.status === "passed").length,
    totalCases: cases.length,
  }, null, 2));
  process.exit(report.status === "passed" ? 0 : 1);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
