"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { parseJsonl } = require("../fixtures/fixture-loader");
const { redactFixture, scanFixtureForSecrets } = require("../fixtures/redaction");

const DIRECT_IMPORT_CANDIDATE_SCHEMA = "direct_codex_import_candidate@1";
const DIRECT_IMPORT_CHECKPOINT_SCHEMA = "direct_codex_import_checkpoint_candidate@1";
const DIRECT_IMPORT_VALIDATION_REPORT_SCHEMA = "direct_codex_import_validation_report@1";
const DIRECT_MATERIALIZED_IMPORT_SCHEMA = "direct_codex_materialized_import_session@1";
const DIRECT_TURN_SCHEMA = "direct_codex_turn@1";
const DIRECT_IMPORT_PARSER_VERSION = "direct-import-parser@1";
const DIRECT_IMPORT_NORMALIZER_VERSION = "direct-import-normalizer@1";
const DIRECT_IMPORT_CHECKPOINT_BUILDER_VERSION = "direct-import-checkpoint-builder@1";
const DIRECT_IMPORT_REDACTION_VERSION = "direct-import-redaction@1";
const DIRECT_IMPORT_MATERIALIZER_VERSION = "direct-import-materializer@1";
const MAX_IMPORT_FILE_BYTES = 64 * 1024 * 1024;
const MAX_IMPORT_RECORDS = 200_000;
const MAX_RENDERER_TRANSCRIPT_ITEMS = 2_000;
const MAX_RENDERER_TEXT_CHARS_PER_ITEM = 16_000;
const MAX_RAW_RECORD_BYTES = 2 * 1024 * 1024;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function stableDigest(value) {
  return sha256Hex(String(value || "")).slice(0, 20);
}

function safeIdPart(value, fallback = "import") {
  const cleanFallback = firstString(String(fallback || ""), "import")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 121);
  const text = firstString(String(value || ""), cleanFallback || "import")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 121)
    .replace(/[-_]+$/g, "");
  return text || cleanFallback || "import";
}

function fileStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function fileSha256(filePath) {
  try {
    return sha256Hex(fs.readFileSync(filePath));
  } catch {
    return "";
  }
}

function sourceDisplayName(filePath, fallback = "selected Codex JSONL") {
  const base = path.basename(normalizeString(filePath, ""));
  return base || fallback;
}

function roleFromRecord(record) {
  return firstString(
    record.message?.role,
    record.item?.role,
    record.role,
    record.params?.role,
  );
}

function textFromRecord(record) {
  const content = record.message?.content ?? record.item?.content ?? record.content ?? record.text ?? "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : part?.text || part?.content || ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function timestampFromRecord(record) {
  return normalizeTimestamp(
    firstString(record.timestamp, record.created_at, record.createdAt, record.at, record.time),
  );
}

function threadIdFromRecord(record) {
  return firstString(
    record.thread_id,
    record.threadId,
    record.session_id,
    record.sessionId,
    record.params?.threadId,
    record.params?.thread_id,
  );
}

function classifyRecord(record) {
  const type = firstString(record.type, record.event, record.method, record.item?.type, "unknown");
  const role = roleFromRecord(record);
  if (role) return { factKind: "message", subtype: role };
  if (/approval|requestApproval|permissions/i.test(type)) return { factKind: "approval", subtype: type };
  if (/function_call_output|custom_tool_call_output|tool_result|tool_result_completed/i.test(type)) {
    return { factKind: "tool_result", subtype: type };
  }
  if (/tool|function_call|custom_tool_call|mcp/i.test(type)) return { factKind: "tool_call", subtype: type };
  if (/diff|patch|fileChange|file_change/i.test(type)) return { factKind: "file_change", subtype: type };
  if (/command|exec|shell/i.test(type)) return { factKind: "command", subtype: type };
  if (/error|failed/i.test(type)) return { factKind: "error", subtype: type };
  if (/compact|summary/i.test(type)) return { factKind: "compaction", subtype: type };
  if (/noop|heartbeat|ping/i.test(type)) return { factKind: "event", subtype: type, nonSemantic: true };
  if (type === "unknown") return { factKind: "unknown", subtype: type };
  return { factKind: "event", subtype: type };
}

function classifyUnknownRecord(record, seq, sourceHash, classification = {}) {
  if (classification.factKind !== "unknown") return null;
  const sourceType = firstString(record.type, record.event, record.method, record.item?.type, "unknown");
  const isNonSemantic = /noop|heartbeat|ping/i.test(sourceType);
  return {
    sourceHash,
    seq,
    classification: isNonSemantic ? "non-semantic" : "parser-unsupported",
    classifiedBy: "rule",
    ruleId: isNonSemantic ? "direct-import-non-semantic-event@1" : "direct-import-unknown-record@1",
  };
}

function importSourceIdentity(records, options = {}) {
  const sourcePath = options.sourcePath ? path.resolve(options.sourcePath) : "";
  const sourceRoot = options.codexHome || options.sourceRoot || (sourcePath ? path.dirname(sourcePath) : "");
  const stat = sourcePath ? fileStat(sourcePath) : null;
  const serializedRecords = stableStringify(records || []);
  const fallbackSha = sha256Hex(serializedRecords);
  const sourceFileSha256 = normalizeString(options.sourceFileSha256, "") || (sourcePath ? fileSha256(sourcePath) : "") || fallbackSha;
  const sourceFileSizeBytes = Number(options.sourceFileSizeBytes ?? stat?.size ?? Buffer.byteLength(serializedRecords, "utf8"));
  const timestamps = [];
  const threadIds = new Set();
  for (const record of Array.isArray(records) ? records : []) {
    const timestamp = timestampFromRecord(record || {});
    if (timestamp) timestamps.push(timestamp);
    const threadId = threadIdFromRecord(record || {});
    if (threadId) threadIds.add(threadId);
  }
  timestamps.sort();
  const threadId = firstString(options.threadId, [...threadIds][0], `thread_${stableDigest(sourceFileSha256)}`);
  const sourceRootId = safeIdPart(options.sourceRootId || `source_${stableDigest(sourceRoot || sourceFileSha256)}`, "source");
  return {
    sourceClass: normalizeString(options.sourceClass, "codex-cli-jsonl"),
    sourcePath,
    sourceDisplayName: normalizeString(options.sourceDisplayName, sourceDisplayName(sourcePath)),
    sourceRootId,
    sourceRootDisplayName: normalizeString(options.sourceRootDisplayName, sourceRoot ? sourceDisplayName(sourceRoot, "selected source root") : ""),
    sourceFileSizeBytes,
    sourceFileSha256,
    sourceFileMtimeMs: Number(options.sourceFileMtimeMs ?? stat?.mtimeMs ?? 0) || undefined,
    threadId,
    timestampStart: timestamps[0] || "",
    timestampEnd: timestamps[timestamps.length - 1] || "",
    recordCount: Array.isArray(records) ? records.length : 0,
    importedAt: normalizeString(options.importedAt, nowIso(options.nowMs)),
    codexHome: sourceRoot ? path.resolve(sourceRoot) : "",
    filePath: sourcePath,
  };
}

function importLineage(source, options = {}) {
  const importId = safeIdPart(options.importId || `import_${stableDigest(`${source.sourceFileSha256}:${source.threadId}:${source.timestampStart}:${source.timestampEnd}`)}`, "import");
  return {
    importId,
    sourceId: safeIdPart(options.sourceId || source.sourceRootId || `source_${stableDigest(source.sourceFileSha256)}`, "source"),
    candidateId: safeIdPart(options.candidateId || `candidate_${stableDigest(importId)}`, "candidate"),
    checkpointId: options.checkpointId ? safeIdPart(options.checkpointId, "checkpoint") : undefined,
    validationReportId: options.validationReportId ? safeIdPart(options.validationReportId, "validation_report") : undefined,
    materializedSessionId: options.materializedSessionId ? safeIdPart(options.materializedSessionId, "import_session") : undefined,
    materializedTurnId: options.materializedTurnId ? safeIdPart(options.materializedTurnId, "import_turn") : undefined,
    attemptNumber: Math.max(1, Number(options.attemptNumber || 1)),
    supersedesImportId: normalizeString(options.supersedesImportId, "") || undefined,
  };
}

function defaultWorkspaceMatch(options = {}) {
  const provided = isPlainObject(options.workspaceMatch) ? options.workspaceMatch : {};
  return {
    status: normalizeString(provided.status, "unknown"),
    selectedProjectId: normalizeString(provided.selectedProjectId || options.projectId, ""),
    selectedWorkspaceKind: normalizeString(provided.selectedWorkspaceKind || options.workspaceKind, "unknown"),
    selectedWorkspaceDisplay: normalizeString(provided.selectedWorkspaceDisplay || options.workspaceDisplay, ""),
    sourceCwdDisplay: normalizeString(provided.sourceCwdDisplay, ""),
    sourceCwdHash: normalizeString(provided.sourceCwdHash, ""),
    sourceWorkspaceKindEvidence: normalizeString(provided.sourceWorkspaceKindEvidence, "unknown"),
    matchMethod: normalizeString(provided.matchMethod, "none"),
    confidence: normalizeString(provided.confidence, "none"),
  };
}

function workspaceMatched(workspaceMatch = {}) {
  return (
    workspaceMatch.status === "matched" &&
    (workspaceMatch.confidence === "high" || workspaceMatch.matchMethod === "user-confirmed")
  );
}

function eligibilityForState(state, workspaceMatch = {}) {
  const checkpointValidated = state === "checkpoint-validated";
  return {
    checkpointValidated,
    directContinuationEligible: checkpointValidated && workspaceMatched(workspaceMatch),
    directContinuationRunnableNow: false,
    runnableScope: checkpointValidated ? "future-checkpoint-continuation-only" : "none",
  };
}

function buildImportCandidate(records, options = {}) {
  if (!Array.isArray(records)) throw new Error("Codex JSONL import records must be an array.");
  if (records.length > MAX_IMPORT_RECORDS && options.allowOverCap !== true) {
    throw new Error(`Codex JSONL import exceeds record cap: ${records.length}`);
  }
  const source = importSourceIdentity(records, options);
  if (source.sourceFileSizeBytes > MAX_IMPORT_FILE_BYTES && options.allowOverCap !== true) {
    throw new Error(`Codex JSONL import exceeds file size cap: ${source.sourceFileSizeBytes}`);
  }
  const lineage = importLineage(source, options);
  const nodes = [];
  const unresolvedObligations = [];
  const unknownRecordClassifications = [];
  const redactionFindings = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] || {};
    const stableRecord = stableStringify(record);
    const rawSize = Buffer.byteLength(stableRecord, "utf8");
    const sourceHash = stableDigest(stableRecord);
    const classification = classifyRecord(record);
    const node = {
      seq: index,
      timestamp: timestampFromRecord(record),
      factKind: classification.factKind,
      subtype: classification.subtype,
      role: roleFromRecord(record),
      text: textFromRecord(record),
      sourceType: firstString(record.type, record.event, record.method, record.item?.type, "unknown"),
      sourceHash,
      rawRecordStoredInMain: rawSize <= MAX_RAW_RECORD_BYTES,
      rendererSafe: scanFixtureForSecrets(record).length === 0,
    };
    nodes.push(node);

    const findings = scanFixtureForSecrets(record);
    if (findings.length) {
      redactionFindings.push({ seq: index, sourceHash, findings });
    }
    const unknownClassification = classifyUnknownRecord(record, index, sourceHash, classification);
    if (unknownClassification) unknownRecordClassifications.push(unknownClassification);

    if (classification.factKind === "tool_call" && /request|call|started|function_call|custom_tool_call/i.test(classification.subtype)) {
      unresolvedObligations.push({
        seq: index,
        kind: "tool_call_pairing_unverified",
        reason: "Legacy import does not grant replayable direct tool authority.",
        autoReplayable: false,
        requiresFreshAuthority: true,
      });
    }
  }

  return {
    schema: DIRECT_IMPORT_CANDIDATE_SCHEMA,
    version: 1,
    candidateId: lineage.candidateId,
    lineage,
    versions: {
      parserVersion: DIRECT_IMPORT_PARSER_VERSION,
      normalizerVersion: DIRECT_IMPORT_NORMALIZER_VERSION,
      redactionVersion: DIRECT_IMPORT_REDACTION_VERSION,
    },
    source,
    target: {
      harness: "direct-chatgpt-codex",
      state: "read-only-imported-evidence",
      runnable: false,
      requiresDirectHarnessCheckpoint: true,
    },
    nodes,
    unresolvedObligations,
    unknownRecordClassifications,
    redaction: {
      rawAuthMaterialObserved: redactionFindings.length > 0,
      findings: redactionFindings,
    },
    validation: {
      roleBoundariesPreserved: nodes.some((node) => Boolean(node.role)),
      userVisibleTextPreserved: nodes.some((node) => Boolean(node.text)),
      assistantMessagesPreserved: nodes.some((node) => node.role === "assistant"),
      sourceTimestampsRetained: Boolean(source.timestampStart && source.timestampEnd),
      toolCallsAutoReplayable: false,
      importedApprovalsCarryAuthority: false,
      notes: [
        "Imported JSONL is evidence only.",
        "No imported tool call may be replayed.",
        "No imported session makes the composer runnable in this bundle.",
      ],
    },
  };
}

function checkpointMessagesFromCandidate(candidate = {}) {
  return (Array.isArray(candidate.nodes) ? candidate.nodes : [])
    .filter((node) => node?.factKind === "message" && node.role)
    .map((node) => ({
      seq: node.seq,
      role: node.role,
      text: node.text,
      timestamp: node.timestamp || "",
      sourceType: node.sourceType || "unknown",
    }));
}

function buildDirectCheckpointCandidate(importCandidate, options = {}) {
  if (!importCandidate || importCandidate.schema !== DIRECT_IMPORT_CANDIDATE_SCHEMA) {
    throw new Error(`Direct import checkpoint requires a ${DIRECT_IMPORT_CANDIDATE_SCHEMA} candidate.`);
  }
  const source = importCandidate.source || {};
  const messages = checkpointMessagesFromCandidate(importCandidate);
  const unresolvedObligations = Array.isArray(importCandidate.unresolvedObligations)
    ? importCandidate.unresolvedObligations.map((obligation) => ({
        ...obligation,
        autoReplayable: false,
        requiresFreshAuthority: true,
      }))
    : [];
  const checkpointSeed = stableStringify({
    sourceFileSha256: source.sourceFileSha256,
    threadId: source.threadId,
    messages,
    unresolvedObligations,
  });
  const checkpointId = safeIdPart(options.checkpointId || `import_checkpoint_${stableDigest(checkpointSeed)}`, "import_checkpoint");
  const lineage = {
    ...(importCandidate.lineage || importLineage(source, options)),
    checkpointId,
  };
  const createdAt = nowIso(options.nowMs);
  const workspaceMatch = defaultWorkspaceMatch(options);
  return {
    schema: DIRECT_IMPORT_CHECKPOINT_SCHEMA,
    checkpointId,
    lineage,
    createdAt,
    state: "checkpoint-candidate",
    runnable: false,
    eligibility: eligibilityForState("checkpoint-candidate", workspaceMatch),
    versions: {
      parserVersion: importCandidate.versions?.parserVersion || DIRECT_IMPORT_PARSER_VERSION,
      normalizerVersion: importCandidate.versions?.normalizerVersion || DIRECT_IMPORT_NORMALIZER_VERSION,
      checkpointBuilderVersion: DIRECT_IMPORT_CHECKPOINT_BUILDER_VERSION,
      redactionVersion: importCandidate.versions?.redactionVersion || DIRECT_IMPORT_REDACTION_VERSION,
    },
    source: {
      ...source,
      harness: source.sourceClass || source.harness || "codex-cli-jsonl",
      filePath: source.filePath || source.sourcePath || "",
      codexHome: source.codexHome || "",
      threadId: source.threadId || "",
      timestampStart: source.timestampStart || "",
      timestampEnd: source.timestampEnd || "",
      recordCount: Number(source.recordCount || 0),
    },
    target: {
      harness: "direct-chatgpt-codex",
      state: "checkpoint-candidate",
      runnable: false,
      requiresValidationBeforeRun: true,
      eligibleForContinuation: false,
    },
    workspaceMatch,
    checkpoint: {
      title: options.title || `Imported Codex session ${source.threadId || source.sourceDisplayName || "unknown"}`,
      messages,
      unresolvedObligations,
      evidenceNodeCount: Array.isArray(importCandidate.nodes) ? importCandidate.nodes.length : 0,
      sourceTimestampRange: {
        start: source.timestampStart || "",
        end: source.timestampEnd || "",
      },
    },
    importCandidate: options.includeCandidate === false ? undefined : importCandidate,
    validation: {
      state: messages.length && importCandidate.validation?.sourceTimestampsRetained ? "checkpoint-candidate" : "imported-validation-failed",
      roleBoundariesPreserved: Boolean(importCandidate.validation?.roleBoundariesPreserved),
      userVisibleTextPreserved: Boolean(importCandidate.validation?.userVisibleTextPreserved),
      assistantMessagesPreserved: Boolean(importCandidate.validation?.assistantMessagesPreserved),
      sourceTimestampsRetained: Boolean(importCandidate.validation?.sourceTimestampsRetained),
      importedToolCallsAutoReplayable: false,
      importedApprovalsCarryAuthority: false,
      unresolvedObligationCount: unresolvedObligations.length,
      rawAuthMaterialObserved: Boolean(importCandidate.redaction?.rawAuthMaterialObserved),
      unknownRecordClassifications: Array.isArray(importCandidate.unknownRecordClassifications)
        ? importCandidate.unknownRecordClassifications
        : [],
      notes: [
        "Checkpoint candidate is derived from imported evidence only.",
        "It is not a provider continuity handle.",
        "Imported tool calls and approvals do not carry execution authority.",
      ],
    },
  };
}

function validationReportForCheckpoint(checkpointCandidate, state, gates, warnings, blockers, options = {}) {
  const source = checkpointCandidate.source || {};
  const lineage = {
    ...(checkpointCandidate.lineage || {}),
    checkpointId: checkpointCandidate.checkpointId,
    validationReportId: safeIdPart(options.validationReportId || `validation_report_${stableDigest(`${checkpointCandidate.checkpointId}:${state}`)}`, "validation_report"),
  };
  const nodes = Array.isArray(checkpointCandidate.importCandidate?.nodes) ? checkpointCandidate.importCandidate.nodes : [];
  const countByKind = (kind) => nodes.filter((node) => node?.factKind === kind).length;
  return {
    schema: DIRECT_IMPORT_VALIDATION_REPORT_SCHEMA,
    reportId: lineage.validationReportId,
    lineage,
    parserVersion: checkpointCandidate.versions?.parserVersion || DIRECT_IMPORT_PARSER_VERSION,
    normalizerVersion: checkpointCandidate.versions?.normalizerVersion || DIRECT_IMPORT_NORMALIZER_VERSION,
    checkpointBuilderVersion: checkpointCandidate.versions?.checkpointBuilderVersion || DIRECT_IMPORT_CHECKPOINT_BUILDER_VERSION,
    redactionVersion: checkpointCandidate.versions?.redactionVersion || DIRECT_IMPORT_REDACTION_VERSION,
    materializerVersion: options.materializerVersion || "",
    generatedAt: nowIso(options.nowMs),
    source,
    workspaceMatch: checkpointCandidate.workspaceMatch || defaultWorkspaceMatch(options),
    state,
    gates,
    counts: {
      records: Number(source.recordCount || 0),
      messages: countByKind("message"),
      toolCalls: countByKind("tool_call"),
      toolResults: countByKind("tool_result"),
      approvals: countByKind("approval"),
      fileChanges: countByKind("file_change"),
      errors: countByKind("error"),
      unknown: countByKind("unknown"),
    },
    warnings,
    blockers,
  };
}

function validateDirectCheckpointCandidate(checkpointCandidate, options = {}) {
  if (!checkpointCandidate || checkpointCandidate.schema !== DIRECT_IMPORT_CHECKPOINT_SCHEMA) {
    throw new Error(`Direct import checkpoint validation requires a ${DIRECT_IMPORT_CHECKPOINT_SCHEMA} candidate.`);
  }
  const source = checkpointCandidate.source || {};
  const checkpoint = checkpointCandidate.checkpoint || {};
  const messages = Array.isArray(checkpoint.messages) ? checkpoint.messages : [];
  const unresolvedObligations = Array.isArray(checkpoint.unresolvedObligations) ? checkpoint.unresolvedObligations : [];
  const workspaceMatch = isPlainObject(options.workspaceMatch)
    ? defaultWorkspaceMatch({ ...options, workspaceMatch: options.workspaceMatch })
    : (checkpointCandidate.workspaceMatch || defaultWorkspaceMatch(options));
  const unknownClassifications = Array.isArray(checkpointCandidate.validation?.unknownRecordClassifications)
    ? checkpointCandidate.validation.unknownRecordClassifications
    : [];
  const semanticUnknowns = unknownClassifications.filter((entry) => entry.classification !== "non-semantic");
  const rawAuthMaterialObserved = Boolean(checkpointCandidate.validation?.rawAuthMaterialObserved);
  const gates = {
    sourceFilePathPreserved: Boolean(source.filePath || source.sourcePath),
    sourceFileHashPreserved: Boolean(source.sourceFileSha256),
    sourceFileSizePreserved: Number(source.sourceFileSizeBytes || 0) >= 0,
    sourceCodexHomePreserved: Boolean(source.codexHome),
    sourceThreadIdPreserved: Boolean(source.threadId),
    sourceTimestampsRetained: Boolean(source.timestampStart && source.timestampEnd),
    roleBoundariesPreserved: messages.length > 0 && messages.every((message) => Boolean(message.role)),
    userVisibleTextPreserved: messages.some((message) => Boolean(message.text)),
    assistantMessagesPreserved: messages.some((message) => message.role === "assistant"),
    toolCallsPaired: unresolvedObligations.length === 0,
    unresolvedImportedToolCallsClear: unresolvedObligations.length === 0,
    importedToolCallsAutoReplayable: false,
    importedApprovalsCarryAuthority: false,
    workspaceIdentityMatched: workspaceMatched(workspaceMatch),
    unknownRecordsClassified: semanticUnknowns.length === 0,
    rendererRawRecordsExposed: false,
    rawAuthMaterialObserved,
  };
  const warnings = [];
  const blockers = [];
  const addBlocker = (code, message) => blockers.push({ code, message });
  if (!gates.sourceFilePathPreserved) addBlocker("missing_source_path", "Source file path was not preserved in the private import record.");
  if (!gates.sourceFileHashPreserved) addBlocker("missing_source_hash", "Source file digest is required before checkpoint validation.");
  if (!gates.sourceThreadIdPreserved) addBlocker("missing_thread_id", "Source thread id is required before checkpoint validation.");
  if (!gates.sourceTimestampsRetained) addBlocker("missing_timestamps", "Source timestamps are required before checkpoint validation.");
  if (!gates.roleBoundariesPreserved) addBlocker("role_boundaries_missing", "Imported transcript role boundaries are incomplete.");
  if (!gates.userVisibleTextPreserved) addBlocker("user_text_missing", "Imported transcript has no preserved user-visible text.");
  if (!gates.unresolvedImportedToolCallsClear) addBlocker("unresolved_imported_tool_calls", "Imported tool calls remain historical evidence only.");
  if (!gates.workspaceIdentityMatched) addBlocker("workspace_not_matched", "Selected project workspace was not matched with high confidence.");
  if (!gates.unknownRecordsClassified) addBlocker("semantic_unknown_records", "Unknown semantic records require classification before checkpoint validation.");
  if (rawAuthMaterialObserved) addBlocker("raw_auth_material_observed", "Auth-like material was observed and must be redacted before materialization.");
  if (!gates.assistantMessagesPreserved) warnings.push({ code: "assistant_text_missing", message: "Source has no assistant message; it may have ended before response." });
  const sourceValid = gates.sourceFilePathPreserved &&
    gates.sourceFileHashPreserved &&
    gates.sourceThreadIdPreserved &&
    gates.sourceTimestampsRetained;
  const evidenceValid = gates.roleBoundariesPreserved && gates.userVisibleTextPreserved;
  const checkpointValidated = sourceValid &&
    evidenceValid &&
    gates.unresolvedImportedToolCallsClear &&
    gates.workspaceIdentityMatched &&
    gates.unknownRecordsClassified &&
    !rawAuthMaterialObserved;
  const validationState = checkpointValidated
    ? "checkpoint-validated"
    : (sourceValid && gates.roleBoundariesPreserved ? "checkpoint-candidate" : "imported-validation-failed");
  const eligibility = eligibilityForState(validationState, workspaceMatch);
  const validatedAt = nowIso(options.nowMs);
  const report = validationReportForCheckpoint(
    { ...checkpointCandidate, workspaceMatch },
    validationState,
    gates,
    warnings,
    blockers,
    options,
  );
  return {
    ...checkpointCandidate,
    lineage: report.lineage,
    state: validationState,
    runnable: false,
    eligibility,
    validatedAt,
    workspaceMatch,
    target: {
      ...(checkpointCandidate.target || {}),
      state: validationState,
      runnable: false,
      requiresValidationBeforeRun: !checkpointValidated,
      eligibleForContinuation: eligibility.directContinuationEligible,
    },
    validationReport: report,
    validation: {
      ...(checkpointCandidate.validation || {}),
      state: validationState,
      validatedAt,
      gates,
      roleBoundariesPreserved: gates.roleBoundariesPreserved,
      userVisibleTextPreserved: gates.userVisibleTextPreserved,
      sourceTimestampsRetained: gates.sourceTimestampsRetained,
      importedToolCallsAutoReplayable: false,
      importedApprovalsCarryAuthority: false,
      unresolvedObligationCount: unresolvedObligations.length,
      warnings,
      blockers,
      notes: [
        ...(Array.isArray(checkpointCandidate.validation?.notes) ? checkpointCandidate.validation.notes : []),
        checkpointValidated
          ? "Checkpoint passed deterministic validation and is eligible for a future checkpoint-continuation flow."
          : "Checkpoint remains non-runnable in this bundle.",
      ],
    },
  };
}

function transcriptItemFromCheckpointMessage(message = {}, turnId = "imported_checkpoint") {
  const role = firstString(message.role, "unknown");
  const id = `${turnId}_message_${Number(message.seq ?? 0)}`;
  if (role === "user") {
    return {
      id,
      type: "userMessage",
      turnId,
      content: [{ type: "text", text: firstString(message.text, ""), text_elements: [] }],
      imported: true,
      sourceSeq: Number(message.seq ?? 0),
      sourceTimestamp: message.timestamp || "",
    };
  }
  if (role === "assistant") {
    return {
      id,
      type: "agentMessage",
      turnId,
      text: firstString(message.text, ""),
      imported: true,
      sourceSeq: Number(message.seq ?? 0),
      sourceTimestamp: message.timestamp || "",
    };
  }
  return {
    id,
    type: "importedMessage",
    role,
    turnId,
    text: firstString(message.text, ""),
    imported: true,
    sourceSeq: Number(message.seq ?? 0),
    sourceTimestamp: message.timestamp || "",
  };
}

function materializationKindForState(state) {
  if (state === "checkpoint-validated") return "checkpoint-validated";
  if (state === "checkpoint-candidate") return "checkpoint-candidate";
  return "readonly-transcript";
}

function writeImportArtifacts(sessionStore, importId, artifacts = {}) {
  if (!sessionStore || typeof sessionStore.writeImportArtifact !== "function") return;
  if (artifacts.candidate) sessionStore.writeImportArtifact(importId, "candidate.json", artifacts.candidate);
  if (artifacts.checkpoint) sessionStore.writeImportArtifact(importId, "checkpoint.json", artifacts.checkpoint);
  if (artifacts.validationReport) sessionStore.writeImportArtifact(importId, "validation-report.json", artifacts.validationReport);
}

function materializeDirectImportSession(checkpointCandidate, options = {}) {
  const sessionStore = options.sessionStore;
  if (!sessionStore || typeof sessionStore.createSession !== "function" || typeof sessionStore.writeSession !== "function") {
    throw new Error("Direct import materialization requires a direct session store.");
  }
  if (!checkpointCandidate || checkpointCandidate.schema !== DIRECT_IMPORT_CHECKPOINT_SCHEMA) {
    throw new Error(`Direct import materialization requires a ${DIRECT_IMPORT_CHECKPOINT_SCHEMA} candidate.`);
  }
  const authBlocked = checkpointCandidate.validation?.gates?.rawAuthMaterialObserved === true ||
    checkpointCandidate.validationReport?.gates?.rawAuthMaterialObserved === true ||
    (Array.isArray(checkpointCandidate.validation?.blockers) &&
      checkpointCandidate.validation.blockers.some((blocker) => blocker?.code === "raw_auth_material_observed")) ||
    (Array.isArray(checkpointCandidate.validationReport?.blockers) &&
      checkpointCandidate.validationReport.blockers.some((blocker) => blocker?.code === "raw_auth_material_observed"));
  if (authBlocked) {
    throw new Error("Direct import materialization blocked: raw auth-like material was observed and must be redacted first.");
  }
  const checkpoint = checkpointCandidate.checkpoint || {};
  const source = checkpointCandidate.source || {};
  const checkpointState = firstString(checkpointCandidate.state, checkpointCandidate.validation?.state, "checkpoint-candidate");
  const workspaceMatch = checkpointCandidate.workspaceMatch || defaultWorkspaceMatch(options);
  const eligibility = checkpointCandidate.eligibility || eligibilityForState(checkpointState, workspaceMatch);
  const lineage = {
    ...(checkpointCandidate.lineage || importLineage(source, options)),
    checkpointId: checkpointCandidate.checkpointId,
  };
  const sessionId = safeIdPart(options.sessionId || lineage.materializedSessionId || `import_session_${stableDigest(checkpointCandidate.checkpointId || JSON.stringify(source))}`, "import_session");
  const turnId = safeIdPart(options.turnId || lineage.materializedTurnId || `import_turn_${stableDigest(checkpointCandidate.checkpointId || sessionId)}`, "import_turn");
  const finalLineage = {
    ...lineage,
    validationReportId: checkpointCandidate.validationReport?.reportId || lineage.validationReportId || `validation_report_${stableDigest(checkpointCandidate.checkpointId || sessionId)}`,
    materializedSessionId: sessionId,
    materializedTurnId: turnId,
  };
  const now = nowIso(options.nowMs);
  const messages = Array.isArray(checkpoint.messages) ? checkpoint.messages : [];
  const unresolvedObligations = Array.isArray(checkpoint.unresolvedObligations)
    ? checkpoint.unresolvedObligations.map((obligation) => ({
        ...obligation,
        autoReplayable: false,
        requiresFreshAuthority: true,
      }))
    : [];
  const transcriptItems = messages.map((message) => transcriptItemFromCheckpointMessage(message, turnId));
  const existingSession = typeof sessionStore.readSession === "function" ? sessionStore.readSession(sessionId) : null;
  const session = existingSession || sessionStore.createSession({
    sessionId,
    projectId: firstString(options.projectId, workspaceMatch.selectedProjectId, source.threadId, "imported-codex-session"),
    title: checkpoint.title || `Imported Codex session ${source.threadId || source.sourceDisplayName || "unknown"}`,
    createdAt: checkpointCandidate.createdAt || now,
    model: firstString(options.model, ""),
    runtimeMode: "imported-readonly",
  }, options);
  const existingCheckpointById = new Map((Array.isArray(session.compactionCheckpoints) ? session.compactionCheckpoints : [])
    .map((entry) => [entry.checkpointId, entry]));
  existingCheckpointById.set(checkpointCandidate.checkpointId, {
    checkpointId: checkpointCandidate.checkpointId,
    state: checkpointState,
    runnable: false,
    eligibility,
    source,
    validationReportId: finalLineage.validationReportId,
    validation: checkpointCandidate.validation || {},
  });
  const nextMessages = [
    ...(Array.isArray(session.messages) ? session.messages.filter((message) => message?.id !== turnId) : []),
    {
      id: turnId,
      status: checkpointState,
      imported: true,
      items: transcriptItems,
    },
  ];
  const importedTurnState = checkpointState === "checkpoint-validated" ? "completed" : "checkpoint_required";
  const turnSummary = {
    turnId,
    state: importedTurnState,
    createdAt: checkpointCandidate.createdAt || now,
    updatedAt: now,
    model: firstString(options.model, session.model, ""),
    normalizedEventCount: 0,
    imported: true,
    importState: checkpointState,
    checkpointId: checkpointCandidate.checkpointId,
    continuationEligible: eligibility.directContinuationEligible,
  };
  const nextTurns = [
    ...(Array.isArray(session.turns) ? session.turns.filter((turn) => turn?.turnId !== turnId) : []),
    turnSummary,
  ];
  const materializedSession = sessionStore.writeSession({
    ...session,
    status: checkpointState,
    updatedAt: now,
    messages: nextMessages,
    turns: nextTurns,
    sourceClass: "legacy-codex-jsonl-import",
    runtimeMode: "imported-readonly",
    materializationKind: materializationKindForState(checkpointState),
    importState: checkpointState,
    readOnlyImported: true,
    nativeDirectSession: false,
    continuationEligible: eligibility.directContinuationEligible,
    importLineage: finalLineage,
    importSource: source,
    workspaceMatch,
    directImportCheckpoint: {
      ...checkpointCandidate,
      lineage: finalLineage,
      eligibility,
    },
    unresolvedObligations,
    compactionCheckpoints: [...existingCheckpointById.values()],
  });
  const turnRecord = {
    schema: DIRECT_TURN_SCHEMA,
    sessionId,
    turnId,
    state: importedTurnState,
    createdAt: checkpointCandidate.createdAt || now,
    updatedAt: now,
    model: firstString(options.model, materializedSession.model, ""),
    profileSnapshotId: "",
    clientTurnRequestId: "",
    requestBuiltAt: "",
    streamStartedAt: "",
    streamPhase: "",
    completedAt: importedTurnState === "completed" ? now : "",
    failedAt: "",
    abortedAt: "",
    requestShape: {},
    responseStatus: 0,
    responseContentType: "",
    input: [],
    normalizedEventCount: 0,
    unresolvedObligations,
    toolResults: [],
    continuationRequests: [],
    error: null,
    imported: true,
    sourceClass: "legacy-codex-jsonl-import",
    importLineage: finalLineage,
    importState: checkpointState,
    checkpointId: checkpointCandidate.checkpointId,
    continuationEligible: eligibility.directContinuationEligible,
  };
  if (typeof sessionStore.writeTurn === "function") sessionStore.writeTurn(turnRecord);
  writeImportArtifacts(sessionStore, finalLineage.importId, {
    candidate: checkpointCandidate.importCandidate,
    checkpoint: { ...checkpointCandidate, lineage: finalLineage, eligibility },
    validationReport: checkpointCandidate.validationReport,
  });
  return {
    schema: DIRECT_MATERIALIZED_IMPORT_SCHEMA,
    materializedAt: now,
    sessionId: materializedSession.sessionId,
    turnId,
    importState: checkpointState,
    materializationKind: materializationKindForState(checkpointState),
    readOnlyImported: true,
    nativeDirectSession: false,
    continuationEligible: eligibility.directContinuationEligible,
    eligibility,
    session: materializedSession,
    turn: turnRecord,
  };
}

function truncateText(text, limit = MAX_RENDERER_TEXT_CHARS_PER_ITEM) {
  const value = String(text || "");
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n[truncated]`;
}

function rendererSafeTranscriptItem(item = {}) {
  const safe = { ...item };
  if (typeof safe.text === "string") safe.text = truncateText(safe.text);
  if (Array.isArray(safe.content)) {
    safe.content = safe.content.map((entry) => {
      if (!isPlainObject(entry)) return entry;
      return typeof entry.text === "string" ? { ...entry, text: truncateText(entry.text) } : entry;
    });
  }
  delete safe.rawRecord;
  delete safe.sourcePath;
  return safe;
}

function buildRendererSafeImportSession(session = {}) {
  const source = session.importSource || {};
  const report = session.directImportCheckpoint?.validationReport || {};
  const groups = Array.isArray(session.messages) ? session.messages : [];
  const transcriptItems = groups
    .flatMap((group) => Array.isArray(group.items) ? group.items : [])
    .slice(0, MAX_RENDERER_TRANSCRIPT_ITEMS)
    .map(rendererSafeTranscriptItem);
  return {
    sessionId: normalizeString(session.sessionId, ""),
    importId: normalizeString(session.importLineage?.importId, ""),
    title: normalizeString(session.title, "Imported Codex session"),
    importState: normalizeString(session.importState, "imported-readonly"),
    labels: [
      session.importState === "checkpoint-validated" ? "Checkpoint validated" : "Imported read-only",
      "Direct continuation not started",
    ],
    source: {
      sourceDisplayName: normalizeString(source.sourceDisplayName, ""),
      sourceRootDisplayName: normalizeString(source.sourceRootDisplayName, ""),
      sourceClass: normalizeString(source.sourceClass, ""),
      recordCount: Number(source.recordCount || 0),
      timestampStart: normalizeString(source.timestampStart, ""),
      timestampEnd: normalizeString(source.timestampEnd, ""),
    },
    reportSummary: {
      warningsCount: Array.isArray(report.warnings) ? report.warnings.length : 0,
      blockersCount: Array.isArray(report.blockers) ? report.blockers.length : 0,
      gates: isPlainObject(report.gates) ? report.gates : {},
    },
    transcriptItems,
    continuation: {
      eligible: session.continuationEligible === true,
      runnableNow: false,
      reason: session.continuationEligible === true
        ? "future_checkpoint_continuation_only"
        : "checkpoint_not_validated",
    },
  };
}

function loadCodexJsonlImportCandidate(filePath, options = {}) {
  const resolvedPath = path.resolve(filePath);
  const stat = fs.statSync(resolvedPath);
  if (stat.size > MAX_IMPORT_FILE_BYTES && options.allowOverCap !== true) {
    throw new Error(`Codex JSONL import exceeds file size cap: ${stat.size}`);
  }
  const text = fs.readFileSync(resolvedPath, "utf8");
  const records = parseJsonl(text, resolvedPath);
  if (records.length > MAX_IMPORT_RECORDS && options.allowOverCap !== true) {
    throw new Error(`Codex JSONL import exceeds record cap: ${records.length}`);
  }
  return buildImportCandidate(records, {
    ...options,
    sourcePath: resolvedPath,
    sourceFileSha256: sha256Hex(text),
    sourceFileSizeBytes: stat.size,
    sourceFileMtimeMs: stat.mtimeMs,
  });
}

module.exports = {
  DIRECT_IMPORT_CANDIDATE_SCHEMA,
  DIRECT_IMPORT_CHECKPOINT_SCHEMA,
  DIRECT_IMPORT_CHECKPOINT_BUILDER_VERSION,
  DIRECT_IMPORT_MATERIALIZER_VERSION,
  DIRECT_IMPORT_NORMALIZER_VERSION,
  DIRECT_IMPORT_PARSER_VERSION,
  DIRECT_IMPORT_REDACTION_VERSION,
  DIRECT_IMPORT_VALIDATION_REPORT_SCHEMA,
  DIRECT_MATERIALIZED_IMPORT_SCHEMA,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_RECORDS,
  MAX_RAW_RECORD_BYTES,
  MAX_RENDERER_TEXT_CHARS_PER_ITEM,
  MAX_RENDERER_TRANSCRIPT_ITEMS,
  buildDirectCheckpointCandidate,
  buildImportCandidate,
  buildRendererSafeImportSession,
  loadCodexJsonlImportCandidate,
  materializeDirectImportSession,
  redactFixture,
  stableStringify,
  validateDirectCheckpointCandidate,
};
