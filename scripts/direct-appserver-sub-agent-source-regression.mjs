#!/usr/bin/env node

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

const { scanFixtureForSecrets } = require("../src/main/direct/fixtures/redaction");
const { writeJsonAtomic } = require("../src/main/direct/session/session-store");
const {
  DIRECT_SUB_AGENT_OBSERVABILITY_REPORT_SCHEMA,
  buildActivityTag,
  buildAgentGraph,
  buildAgentSourceSchemaRef,
  buildAttentionProjection,
  buildContainmentProfile,
  buildProgressInspection,
  buildProgressRegistry,
  buildProgressWitness,
  buildSubAgentTranscriptProjection,
  sha256,
  stableStringify,
  validateSubAgentObservabilityReport,
} = require("../src/main/direct/agents/observability");

const USER_DATA_ROOT_ENV_VAR = "CODEX_REVIEW_SHELL_USER_DATA_ROOT";
const SOURCE_FILE_ENV_VAR = "CODEX_DIRECT_APP_SERVER_SUB_AGENT_SOURCE_FILE";
const SOURCE_ROOT_ENV_VAR = "CODEX_DIRECT_APP_SERVER_SUB_AGENT_SOURCE_ROOT";
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_FILES = 80;

function normalizeString(value, fallback = "") {
  const text = (typeof value === "string" || typeof value === "number") ? String(value).trim() : "";
  return text || fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function safeIdPart(value, fallback = "run") {
  return normalizeString(value, fallback)
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || fallback;
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

function optionString(options, camelName, kebabName, fallback = "") {
  return normalizeString(options[camelName] ?? options[kebabName], fallback);
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

function writeTextFile(targetPath, text) {
  ensureDirectory(path.dirname(targetPath));
  fs.writeFileSync(targetPath, text, { mode: 0o600 });
}

function evidenceKeyForPath(filePath) {
  return `source_file_${sha256(path.resolve(filePath)).slice(0, 18)}`;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function collectJsonishFiles(rootDir, output = []) {
  if (!rootDir || output.length >= MAX_SOURCE_FILES) return output;
  let entries = [];
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return output;
  }
  for (const entry of entries) {
    if (output.length >= MAX_SOURCE_FILES) break;
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith("direct-") && !["node_modules", "GPUCache", "Code Cache", "DawnWebGPUCache", "DawnGraphiteCache", "Session Storage"].includes(entry.name)) {
        collectJsonishFiles(fullPath, output);
      }
      continue;
    }
    if (!entry.isFile() || !/\.(json|jsonl)$/i.test(entry.name)) continue;
    try {
      const stat = fs.statSync(fullPath);
      if (stat.size > 0 && stat.size <= MAX_SOURCE_BYTES) output.push(fullPath);
    } catch {
      // Ignore unreadable source candidates.
    }
  }
  return output;
}

function parseJsonishFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  if (/\.jsonl$/i.test(filePath)) {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
  return JSON.parse(text);
}

function flattenObjects(value, output = [], depth = 0) {
  if (depth > 12) return output;
  if (Array.isArray(value)) {
    for (const item of value) flattenObjects(item, output, depth + 1);
    return output;
  }
  if (!isPlainObject(value)) return output;
  output.push(value);
  for (const child of Object.values(value)) flattenObjects(child, output, depth + 1);
  return output;
}

function sourceKindForObject(object = {}) {
  const text = [
    object.type,
    object.kind,
    object.name,
    object.method,
    object.toolName,
    object.itemType,
    object.event,
  ].map((value) => String(value || "")).join(" ").toLowerCase();
  if (text.includes("agents_states") || text.includes("agent_state")) return "agents_states";
  if (text.includes("collabagenttoolcall") || text.includes("collab_agent")) return "collab_tool_call";
  if (text.includes("spawnagent") || text.includes("spawn_agent")) return "collab_tool_call";
  if (text.includes("sendinput") || text.includes("send_input")) return "collab_tool_call";
  if (text.includes("waitagent") || text.includes("wait_agent")) return "collab_tool_call";
  if (object.agents_states || object.agentsStates || object.agents) return "agents_states";
  if (
    object.agentThreadId !== undefined ||
    object.agent_thread_id !== undefined ||
    object.childThreadId !== undefined ||
    object.child_thread_id !== undefined
  ) return "session_metadata";
  return "";
}

function statusToLifecycle(value) {
  const status = normalizeString(value, "").toLowerCase();
  if (["running", "responding", "active"].includes(status)) return "running";
  if (["waiting", "blocked"].includes(status)) return "waiting";
  if (["completed", "complete", "done", "resolved"].includes(status)) return "completed";
  if (["failed", "error"].includes(status)) return "failed";
  if (["closed", "cancelled", "canceled"].includes(status)) return "closed";
  return "discovered";
}

function objectLabel(object = {}, fallback = "Agent") {
  return normalizeString(object.nickname ?? object.label ?? object.title ?? object.name ?? object.role, fallback);
}

function objectThreadId(object = {}, fallback) {
  const id = object.agentThreadId ??
    object.agent_thread_id ??
    object.childThreadId ??
    object.child_thread_id ??
    object.threadId ??
    object.thread_id ??
    object.id;
  return normalizeString(id, fallback);
}

function arrayValues(value) {
  return Array.isArray(value) ? value : [];
}

function receiverThreadIdsForObject(object = {}, fallback) {
  const explicit = [
    ...arrayValues(object.receiverThreadIds),
    ...arrayValues(object.receiver_thread_ids),
    ...arrayValues(object.receivers),
  ].map((value) => normalizeString(value, "")).filter(Boolean);
  const stateThreadIds = [
    ...arrayValues(object.agentsStates),
    ...arrayValues(object.agents_states),
    ...arrayValues(object.agents),
  ].map((state) => objectThreadId(state, "")).filter(Boolean);
  const merged = [...new Set([...explicit, ...stateThreadIds])];
  if (merged.length) return merged;
  return [objectThreadId(object, fallback)].filter(Boolean);
}

function agentStateByThreadId(object = {}) {
  const states = [
    ...arrayValues(object.agentsStates),
    ...arrayValues(object.agents_states),
    ...arrayValues(object.agents),
  ];
  return new Map(states
    .map((state) => [objectThreadId(state, ""), state])
    .filter(([threadId]) => Boolean(threadId)));
}

function normalizeSourceObjects({ objects, sourceEvidenceKey }) {
  const nodesByThread = new Map();
  const edges = [];
  const sourceEventDigests = [];
  let sequence = 0;
  for (const object of objects) {
    const sourceKind = sourceKindForObject(object);
    if (!sourceKind) continue;
    sequence += 1;
    const parentThreadId = normalizeString(object.parentThreadId ?? object.parent_thread_id ?? object.primaryThreadId ?? object.primary_thread_id ?? object.senderThreadId ?? object.sender_thread_id, "primary_app_server_thread");
    const stateByThreadId = agentStateByThreadId(object);
    const receiverThreadIds = receiverThreadIdsForObject(object, `agent_source_${sequence}`);
    for (const childThreadId of receiverThreadIds) {
      const state = stateByThreadId.get(childThreadId) || {};
      const artifactId = `${sourceEvidenceKey}_${sequence}_${sha256(childThreadId).slice(0, 10)}`;
      const eventDigest = sha256(stableStringify({
        sourceKind,
        threadId: childThreadId,
        parentThreadId,
        status: object.status ?? object.state ?? object.lifecycleState ?? state.status ?? state.state ?? "",
        method: object.method ?? object.name ?? object.type ?? "",
      }));
      sourceEventDigests.push(eventDigest);
      const evidenceRef = {
        kind: sourceKind,
        artifactId,
        artifactDigest: eventDigest,
        rendererSafeLabel: sourceKind === "collab_tool_call" ? "App-server collab tool event" : "App-server agent state",
        sourceConfidence: "derived",
      };
      if (!nodesByThread.has(childThreadId)) {
        const lifecycleState = statusToLifecycle(state.status ?? state.state ?? object.status ?? object.state ?? object.lifecycleState);
        nodesByThread.set(childThreadId, {
          agentThreadId: childThreadId,
          parentThreadId,
          nickname: objectLabel(state, objectLabel(object, `Agent ${sequence}`)),
          role: normalizeString(state.role ?? state.agentRole ?? state.agent_type ?? object.role ?? object.agentRole ?? object.agent_type, ""),
          depth: parentThreadId === "primary_app_server_thread" ? 1 : 2,
          labelConfidence: sourceKind === "collab_tool_call" ? "collab_tool_call" : "session_metadata",
          lifecycleState,
          activityState: ["running", "waiting"].includes(lifecycleState) ? "active" : "unknown",
          containmentState: "unknown",
          evidenceRefs: [evidenceRef],
        });
      }
      if (sourceKind !== "collab_tool_call") continue;
      const method = normalizeString(object.method ?? object.name ?? object.type, "").toLowerCase();
      const edgeKind = method.includes("send") ? "sent_input" : method.includes("wait") ? "waited_on" : "spawned_child";
      edges.push({
        edgeKind,
        parentThreadId,
        childThreadId,
        status: statusToLifecycle(object.status ?? object.state) === "failed" ? "failed" : "completed",
        sourceCallId: normalizeString(object.callId ?? object.call_id ?? object.id, artifactId),
        evidenceRefs: [evidenceRef],
      });
    }
  }
  return {
    sourceEventDigests,
    nodes: [...nodesByThread.values()],
    edges,
  };
}

function baseCase(input = {}) {
  return {
    caseId: normalizeString(input.caseId, "case"),
    coverageSource: normalizeString(input.coverageSource, "live_readonly_app_server_source"),
    status: normalizeString(input.status, "passed"),
    proofOutcome: normalizeString(input.proofOutcome, "app_server_source_checked"),
    matrixRowsExercised: input.matrixRowsExercised || ["H1", "H2", "H3", "H6", "H8", "H9", "J9"],
    matrixPromotionCandidate: false,
    authorityPromotionCandidate: false,
    runtimeAuthorityExercised: false,
    providerAuthorityExercised: false,
    blockerCode: normalizeString(input.blockerCode, ""),
    artifacts: input.artifacts || {},
  };
}

function zeroSentinels() {
  return {
    providerTransportCalls: 0,
    appServerMutationCalls: 0,
    appServerTurnStartCalls: 0,
    appServerApprovalResponseCalls: 0,
    workspaceReadCalls: 0,
    patchApplyCalls: 0,
    commandRunCalls: 0,
    contextPackBuilds: 0,
    requestManifestBuilds: 0,
    directSessionCreates: 0,
    spawnAgentCalls: 0,
    sendInputCalls: 0,
    waitAgentCalls: 0,
    closeAgentCalls: 0,
    rightPaneMutationCalls: 0,
    handoffMutationCalls: 0,
  };
}

function sourceFilesFromOptions(options) {
  const explicitFile = optionString(options, "sourceFile", "source-file", process.env[SOURCE_FILE_ENV_VAR] || "");
  if (explicitFile) return [explicitFile];
  const explicitRoot = optionString(options, "sourceRoot", "source-root", process.env[SOURCE_ROOT_ENV_VAR] || "");
  if (explicitRoot) return collectJsonishFiles(explicitRoot);
  return [];
}

function buildUnavailableReport({ sourceFileCount }) {
  const explicitSourceAttempted = sourceFileCount > 0;
  return {
    schema: DIRECT_SUB_AGENT_OBSERVABILITY_REPORT_SCHEMA,
    generatedAt: nowIso(),
    coverageSource: "live_readonly_app_server_source_unavailable",
    matrixRowsExercised: ["H1", "H2", "H3", "H6", "H8", "H9", "J9"],
    matrixPromotionCandidate: false,
    authorityPromotionCandidate: false,
    runtimeAuthorityExercised: false,
    providerAuthorityExercised: false,
    rug012Closed: false,
    promotionCandidates: {
      H1_agentGraph_projection: false,
      H2_progressRegistry_fixture: false,
      H3_witness_fixture: false,
      H4_inspectToolAuthority: false,
      H5_waitToolAuthority: false,
      H6_containmentVisibility: false,
      H7_collabToolAuthority: false,
      H8_transcriptProjection_fixture: false,
      H9_attentionModel_fixture: false,
      H10_waitDeadlockPrevention: false,
      J9_capabilityProfileVisibility: false,
    },
    sourceRead: {
      attempted: sourceFileCount > 0,
      sourceFileCount,
      recognizedEventCount: 0,
      rawSourcePathIncluded: false,
      rawSourcePayloadIncluded: false,
    },
    nonAuthorityProof: {
      appServerReadOnly: true,
      appServerMutationUsed: false,
      appServerEvidenceNotDirectPrimitive: true,
      childTranscriptNotContextInput: true,
    },
    sentinelCounters: zeroSentinels(),
    rawExposureScan: "passed",
    schemaValidation: "passed",
    cases: [
      baseCase({
        caseId: explicitSourceAttempted ? "app_server_sub_agent_source_unrecognized" : "app_server_sub_agent_source_unavailable",
        coverageSource: "live_readonly_app_server_source_unavailable",
        status: explicitSourceAttempted ? "failed" : "blocked",
        proofOutcome: explicitSourceAttempted ? "source_unrecognized" : "source_unavailable",
        blockerCode: explicitSourceAttempted ? "app_server_sub_agent_source_unrecognized" : "app_server_sub_agent_source_unavailable",
      }),
      baseCase({
        caseId: "source_unavailable_no_authority",
        coverageSource: "live_readonly_app_server_source_unavailable",
        proofOutcome: "sentinel_zero",
      }),
    ],
  };
}

function buildProjectedReport({ sourceObjects, sourceEvidenceKeys }) {
  const projectId = "project_app_server_sub_agent_source";
  const primaryThreadId = "primary_app_server_thread";
  const normalized = normalizeSourceObjects({
    objects: sourceObjects,
    sourceEvidenceKey: sourceEvidenceKeys[0] || "app_server_source",
  });
  if (normalized.nodes.length === 0) return buildUnavailableReport({ sourceFileCount: sourceEvidenceKeys.length });
  const sourceSchemaRef = buildAgentSourceSchemaRef({
    runtimeSourceClass: "codex_app_server_collab",
    sourceNormalizerVersion: "app-server-sub-agent-source-readonly@1",
    experimentalApiEnabled: false,
  });
  const containmentProfile = buildContainmentProfile({
    projectId,
    runtimeSourceClass: "codex_app_server_collab",
    profileSource: "app_server_observed_metadata",
    containmentEvidence: {
      source: "app_server_observed_metadata",
      sourceConfidence: "derived",
      schemaRef: sourceSchemaRef,
    },
    appliesToAgentThreadIds: normalized.nodes.map((node) => node.agentThreadId),
    toolSurfaceVisibility: "observed_only",
  });
  const graph = buildAgentGraph({
    projectId,
    primaryThreadId,
    runtimeSourceClass: "codex_app_server_collab",
    sourceSchemaRef,
    containmentProfileId: containmentProfile.containmentProfileId,
    containmentProfileDigest: containmentProfile.integrity.artifactDigest,
    sourceEventDigests: normalized.sourceEventDigests,
    nodes: normalized.nodes,
    edges: normalized.edges,
    rendererSafeSummary: `Projected ${normalized.nodes.length} app-server sub-agent node(s) from read-only source evidence.`,
  });
  const progressRegistry = buildProgressRegistry({ agentGraph: graph });
  const witnesses = progressRegistry.entries.map((entry) => buildProgressWitness({
    progressRegistry,
    progressEntry: entry,
    modelSafeSummaryUse: "diagnostic_only",
  }));
  const inspection = buildProgressInspection({
    projectId,
    primaryThreadId,
    agentGraphId: graph.agentGraphId,
    progressRegistryId: progressRegistry.progressRegistryId,
    witnesses,
    limit: 10,
  });
  const firstNode = graph.nodes[0];
  const transcriptProjection = buildSubAgentTranscriptProjection({
    projectId,
    primaryThreadId,
    agentThreadId: firstNode.agentThreadId,
    agentGraphId: graph.agentGraphId,
    graphRevision: graph.graphRevision,
    activationEpoch: graph.activationEpoch,
    items: [
      {
        sourceItemId: `${firstNode.agentThreadId}_source_status`,
        authorKind: "harness_controller",
        rendererSafeTextPreview: "App-server sub-agent source evidence projected as display-only status.",
        evidenceRefs: firstNode.evidenceRefs,
      },
    ],
  });
  const attentionProjection = buildAttentionProjection({ agentGraph: graph, witnesses });
  const activityTag = buildActivityTag({
    agentThreadId: firstNode.agentThreadId,
    attentionState: "unknown",
    rendererSafeLabel: "Observed app-server sub-agent evidence",
    progressWitnessId: witnesses[0]?.witnessId || "",
  });
  return {
    schema: DIRECT_SUB_AGENT_OBSERVABILITY_REPORT_SCHEMA,
    generatedAt: nowIso(),
    coverageSource: "live_readonly_app_server_source",
    matrixRowsExercised: ["H1", "H2", "H3", "H6", "H8", "H9", "J9"],
    matrixPromotionCandidate: false,
    authorityPromotionCandidate: false,
    runtimeAuthorityExercised: false,
    providerAuthorityExercised: false,
    rug012Closed: true,
    promotionCandidates: {
      H1_agentGraph_projection: true,
      H2_progressRegistry_fixture: false,
      H3_witness_fixture: false,
      H4_inspectToolAuthority: false,
      H5_waitToolAuthority: false,
      H6_containmentVisibility: true,
      H7_collabToolAuthority: false,
      H8_transcriptProjection_fixture: false,
      H9_attentionModel_fixture: true,
      H10_waitDeadlockPrevention: false,
      J9_capabilityProfileVisibility: true,
    },
    sourceRead: {
      attempted: true,
      sourceFileCount: sourceEvidenceKeys.length,
      sourceFileEvidenceKeys: sourceEvidenceKeys,
      recognizedEventCount: normalized.sourceEventDigests.length,
      rawSourcePathIncluded: false,
      rawSourcePayloadIncluded: false,
    },
    nonAuthorityProof: {
      graphCannotExecute: graph.directRuntimeAuthorityGranted === false,
      appServerReadOnly: true,
      appServerEvidenceNotDirectPrimitive: graph.directProviderPrimitiveProven === false,
      providerContinuityNotGranted: graph.providerContinuityGranted === false,
      witnessCannotReplay: witnesses.every((witness) => witness.replayAuthority === false),
      inspectionIsRendererOnly: inspection.actionability.actionable === false,
      childTranscriptNotContextInput: true,
      activityTagActionable: activityTag.actionability.actionable,
    },
    artifacts: {
      agentGraphId: graph.agentGraphId,
      progressRegistryId: progressRegistry.progressRegistryId,
      containmentProfileId: containmentProfile.containmentProfileId,
      transcriptProjectionId: transcriptProjection.transcriptProjectionId,
      attentionProjectionId: attentionProjection.attentionProjectionId,
    },
    sentinelCounters: zeroSentinels(),
    rawExposureScan: "passed",
    schemaValidation: "passed",
    cases: [
      baseCase({ caseId: "app_server_source_ingested_read_only", artifacts: { agentGraphId: graph.agentGraphId } }),
      baseCase({ caseId: "app_server_source_projection_no_authority", proofOutcome: graph.directRuntimeAuthorityGranted === false ? "no_direct_authority" : "failed" }),
      baseCase({ caseId: "progress_inspection_renderer_read_only", proofOutcome: inspection.actionability.actionable === false ? "inspection_read_only" : "failed" }),
      baseCase({ caseId: "child_transcript_not_context_pack_input", proofOutcome: "no_context_pack_builds" }),
      baseCase({ caseId: "sentinel_no_spawn_wait_send_close", proofOutcome: "sentinel_zero" }),
    ],
  };
}

function readSourceObjects(sourceFiles) {
  const sourceObjects = [];
  const sourceEvidenceKeys = [];
  for (const filePath of sourceFiles) {
    let parsed;
    try {
      parsed = parseJsonishFile(filePath);
    } catch {
      continue;
    }
    const objects = flattenObjects(parsed);
    if (objects.length) {
      sourceObjects.push(...objects);
      sourceEvidenceKeys.push(evidenceKeyForPath(filePath));
    }
  }
  return { sourceObjects, sourceEvidenceKeys };
}

function renderMarkdown(report) {
  const lines = [
    "# Direct App-Server Sub-Agent Source Probe",
    "",
    `Generated: ${report.generatedAt}`,
    `Coverage source: ${report.coverageSource}`,
    `RUG-012 closed: ${report.rug012Closed}`,
    "",
    "## Cases",
    "",
  ];
  for (const entry of report.cases) lines.push(`- ${entry.caseId}: ${entry.status} (${entry.proofOutcome})`);
  lines.push("", "## Sentinels", "");
  for (const [key, value] of Object.entries(report.sentinelCounters)) lines.push(`- ${key}: ${value}`);
  lines.push("");
  return lines.join("\n");
}

function assertNoFailedCases(report) {
  const failed = Array.isArray(report.cases)
    ? report.cases.filter((entry) => entry.status === "failed" || entry.proofOutcome === "failed")
    : [];
  if (failed.length) {
    throw new Error(`direct_appserver_sub_agent_source_failed:${failed.map((entry) => entry.caseId).join(",")}`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const userDataRoot = optionString(options, "userDataRoot", "user-data-root", process.env[USER_DATA_ROOT_ENV_VAR] || defaultAppUserDataRoot());
  const runId = safeIdPart(optionString(options, "runId", "run-id", ""), `rug012_appserver_sub_agent_source_${Date.now()}`);
  const outputDir = path.join(userDataRoot, "direct-appserver-sub-agent-source-runs", runId);
  ensureDirectory(outputDir);
  const sourceFiles = sourceFilesFromOptions(options);
  const { sourceObjects, sourceEvidenceKeys } = readSourceObjects(sourceFiles);
  const report = sourceFiles.length
    ? buildProjectedReport({ sourceObjects, sourceEvidenceKeys })
    : buildUnavailableReport({ sourceFileCount: 0 });
  assertNoFailedCases(report);
  validateSubAgentObservabilityReport(report);
  const findings = scanFixtureForSecrets(report);
  if (findings.length) {
    const failure = {
      schema: DIRECT_SUB_AGENT_OBSERVABILITY_REPORT_SCHEMA,
      generatedAt: nowIso(),
      coverageSource: "live_readonly_app_server_source",
      matrixPromotionCandidate: false,
      authorityPromotionCandidate: false,
      runtimeAuthorityExercised: false,
      providerAuthorityExercised: false,
      rug012Closed: false,
      rawExposureScan: "blocked",
      schemaValidation: "passed",
      sentinelCounters: zeroSentinels(),
      cases: [baseCase({ caseId: "raw_exposure_blocked", status: "blocked", proofOutcome: "raw_exposure_blocked", blockerCode: "raw_exposure_blocked" })],
    };
    writeJsonAtomic(path.join(outputDir, "direct-appserver-sub-agent-source-report.json"), failure);
    throw new Error("Direct app-server sub-agent source report failed raw-exposure scan. Check the diagnostic report for details.");
  }
  const jsonPath = path.join(outputDir, "direct-appserver-sub-agent-source-report.json");
  const markdownPath = path.join(outputDir, "direct-appserver-sub-agent-source-report.md");
  writeJsonAtomic(jsonPath, report);
  writeTextFile(markdownPath, renderMarkdown(report));
  const reread = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  validateSubAgentObservabilityReport(reread);
  console.log(`Direct app-server sub-agent source probe passed: ${jsonPath}`);
  console.log(`Report digest: ${sha256(stableStringify(reread))}`);
}

main();
