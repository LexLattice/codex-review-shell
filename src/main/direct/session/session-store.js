"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { assertFixtureRedacted } = require("../fixtures/redaction");

const DIRECT_SESSION_INDEX_SCHEMA = "direct_codex_session_index@1";
const DIRECT_SESSION_SCHEMA = "direct_codex_session@1";
const DIRECT_TURN_SCHEMA = "direct_codex_turn@1";
const DIRECT_DIAGNOSTIC_SCHEMA = "direct_codex_diagnostic@1";
const DIRECT_TOOL_OBLIGATION_SCHEMA = "direct_codex_tool_obligation@1";
const DIRECT_IMPORT_INDEX_SCHEMA = "direct_codex_import_index@1";
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,120}$/;
const DIRECT_TURN_STATES = new Set([
  "created",
  "request_built",
  "streaming",
  "tool_waiting",
  "authority_waiting",
  "continuation_ready",
  "continuation_sent",
  "streaming_continuation",
  "completed",
  "failed",
  "aborted",
  "tool_call_blocked_text_only",
  "transport_handoff_unknown",
  "response_incomplete",
  "content_filter_terminal",
  "max_output_terminal",
  "empty_output_terminal",
  "checkpoint_required",
]);
const DIRECT_RECOVERABLE_ACTIVE_TURN_STATES = new Set([
  "request_built",
  "streaming",
  "tool_waiting",
  "authority_waiting",
  "continuation_ready",
  "continuation_sent",
  "streaming_continuation",
]);
const DIRECT_TOOL_OBLIGATION_TERMINAL_STATUSES = new Set([
  "approved",
  "declined",
  "canceled",
  "result_recorded",
  "continuation_built",
  "continuation_sent",
  "unsupported",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function canonicalImportState(value) {
  const state = normalizeString(value, "imported-readonly");
  if (state === "checkpointed-runnable") return "checkpoint-validated";
  return state;
}

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
}

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function normalizeId(value, fallbackPrefix) {
  const text = normalizeString(value, "");
  if (SAFE_ID_PATTERN.test(text)) return text;
  return newId(fallbackPrefix);
}

function isSafeId(value) {
  return SAFE_ID_PATTERN.test(normalizeString(value, ""));
}

function requireSafeId(value, label) {
  const text = normalizeString(value, "");
  if (isSafeId(text)) return text;
  throw new Error(`Invalid ${label} id.`);
}

function normalizeTurnState(value, fallback = "created") {
  const state = normalizeString(value, fallback);
  return DIRECT_TURN_STATES.has(state) ? state : fallback;
}

function toolObligationKey(event = {}) {
  return normalizeString(event.callId || event.itemId || event.name || `sequence_${event.sequence}`, "unknown_tool_call");
}

function toolObligationId(sessionId, turnId, key) {
  const digest = crypto
    .createHash("sha256")
    .update(`${normalizeString(sessionId, "")}:${normalizeString(turnId, "")}:${normalizeString(key, "")}`)
    .digest("hex")
    .slice(0, 20);
  return `tool_obligation_${digest}`;
}

function buildToolObligationsFromEvents(sessionId, turnId, events = []) {
  const obligations = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    if (!["tool_call_started", "tool_call_delta", "tool_call_completed"].includes(event?.type)) continue;
    const key = toolObligationKey(event);
    const existing = obligations.get(key) || {
      schema: DIRECT_TOOL_OBLIGATION_SCHEMA,
      obligationId: toolObligationId(sessionId, turnId, key),
      sessionId: normalizeString(sessionId, ""),
      turnId: normalizeString(turnId, ""),
      status: "collecting_arguments",
      authorityState: "execution_disabled",
      approvalAvailable: false,
      executionAllowed: false,
      sideEffectExecuted: false,
      continuationAllowed: false,
      toolCallSource: "provider-native-implicit",
      sourceItemId: normalizeString(event.itemId, ""),
      callId: normalizeString(event.callId, ""),
      name: normalizeString(event.name, "tool_call"),
      namespace: normalizeString(event.namespace, ""),
      toolType: normalizeString(event.toolType, "unknown"),
      providerCallType: normalizeString(event.toolType, "unknown"),
      argumentsText: "",
      detectedAtSequence: Number(event.sequence ?? 0),
      completedAtSequence: null,
    };
    const next = {
      ...existing,
      sourceItemId: normalizeString(existing.sourceItemId || event.itemId, ""),
      callId: normalizeString(existing.callId || event.callId, ""),
      name: normalizeString(event.name, existing.name),
      namespace: normalizeString(event.namespace, existing.namespace),
      toolType: normalizeString(event.toolType, existing.toolType),
      providerCallType: normalizeString(event.toolType, existing.providerCallType || existing.toolType),
    };
    if (event.type === "tool_call_delta") {
      next.argumentsText = `${next.argumentsText || ""}${event.argumentsDelta || ""}`;
    }
    if (event.type === "tool_call_completed") {
      next.status = "waiting";
      next.approvalAvailable = false;
      next.argumentsText = normalizeString(event.argumentsJson, next.argumentsText);
      next.completedAtSequence = Number(event.sequence ?? next.completedAtSequence ?? 0);
    }
    obligations.set(key, next);
  }
  return [...obligations.values()];
}

function mergeToolArgumentsText(existing = "", incoming = "", incomingIsComplete = false) {
  const previous = normalizeString(existing, "");
  const next = normalizeString(incoming, "");
  if (!previous || incomingIsComplete) return next || previous;
  if (!next || previous === next || previous.endsWith(next)) return previous;
  if (next.startsWith(previous)) return next;
  return `${previous}${next}`;
}

function mergeToolObligation(existing = {}, incoming = {}) {
  if (!isPlainObject(existing) || !existing.obligationId) return incoming;
  if (DIRECT_TOOL_OBLIGATION_TERMINAL_STATUSES.has(normalizeString(existing.status, ""))) {
    return {
      ...existing,
      argumentsText: mergeToolArgumentsText(existing.argumentsText, incoming.argumentsText, incoming.completedAtSequence !== null),
      completedAtSequence: incoming.completedAtSequence ?? existing.completedAtSequence ?? null,
      updatedAt: existing.updatedAt || incoming.updatedAt,
    };
  }
  return {
    ...existing,
    ...incoming,
    status: incoming.status === "waiting" || existing.status === "waiting" ? "waiting" : normalizeString(incoming.status, existing.status),
    authorityState: "execution_disabled",
    approvalAvailable: Boolean(existing.approvalAvailable || incoming.approvalAvailable),
    executionAllowed: false,
    sideEffectExecuted: Boolean(existing.sideEffectExecuted || incoming.sideEffectExecuted),
    continuationAllowed: false,
    sourceItemId: normalizeString(existing.sourceItemId || incoming.sourceItemId, ""),
    callId: normalizeString(existing.callId || incoming.callId, ""),
    name: normalizeString(incoming.name, existing.name),
    namespace: normalizeString(incoming.namespace, existing.namespace),
    toolType: normalizeString(incoming.toolType, existing.toolType),
    providerCallType: normalizeString(incoming.providerCallType, existing.providerCallType || existing.toolType),
    toolCallSource: normalizeString(existing.toolCallSource || incoming.toolCallSource, "provider-native-implicit"),
    argumentsText: mergeToolArgumentsText(existing.argumentsText, incoming.argumentsText, incoming.completedAtSequence !== null),
    detectedAtSequence: Number(existing.detectedAtSequence ?? incoming.detectedAtSequence ?? 0),
    completedAtSequence: incoming.completedAtSequence ?? existing.completedAtSequence ?? null,
  };
}

function toolTranscriptItemFromObligation(obligation = {}) {
  const resultSummary = isPlainObject(obligation.result)
    ? obligation.result.summary || obligation.result.textPreview || obligation.result.status
    : (isPlainObject(obligation.authorityDecision) ? obligation.authorityDecision.reason : "");
  return {
    id: obligation.obligationId,
    type: "dynamicToolCall",
    turnId: obligation.turnId,
    tool: normalizeString(obligation.name, "tool_call"),
    status: normalizeString(obligation.status, "waiting"),
    contentItems: normalizeString(obligation.argumentsText, ""),
    result: resultSummary,
    approvalAvailable: Boolean(obligation.approvalAvailable),
    executionAllowed: Boolean(obligation.executionAllowed),
    continuationAllowed: Boolean(obligation.continuationAllowed),
    providerCallType: normalizeString(obligation.providerCallType || obligation.toolType, ""),
    namespace: normalizeString(obligation.namespace, ""),
    relPath: normalizeString(obligation.approvedRead?.relPath || obligation.result?.relPath, ""),
    resultClass: normalizeString(obligation.result?.resultClass, ""),
    toolCallSource: normalizeString(obligation.toolCallSource, "provider-native-implicit"),
  };
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function tempFilePath(targetPath) {
  return path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.${crypto.randomUUID().slice(0, 8)}.tmp`);
}

function writeJsonAtomic(targetPath, value) {
  ensureDirectory(path.dirname(targetPath));
  const tempPath = tempFilePath(targetPath);
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, targetPath);
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch {}
    throw error;
  }
}

function safeArtifactName(value) {
  const name = normalizeString(value, "");
  if (/^[a-z0-9][a-z0-9-]{0,80}\.json$/i.test(name)) return name;
  throw new Error("Invalid direct import artifact name.");
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

function indexEntryFromSession(session) {
  const sessionId = normalizeString(session.sessionId, "");
  const turns = Array.isArray(session.turns) ? session.turns : [];
  return {
    sessionId,
    projectId: normalizeString(session.projectId, ""),
    title: normalizeString(session.title, "Untitled direct session"),
    createdAt: normalizeString(session.createdAt, ""),
    updatedAt: normalizeString(session.updatedAt, ""),
    status: normalizeString(session.status, "created"),
    model: normalizeString(session.model, ""),
    runtimeMode: normalizeString(session.runtimeMode, ""),
    directTransport: normalizeString(session.directTransport, ""),
    modelSource: normalizeString(session.modelSource, ""),
    modelEvidenceState: normalizeString(session.modelEvidenceState, ""),
    modelEvidenceId: normalizeString(session.modelEvidenceId, ""),
    profileSnapshotId: normalizeString(session.profileSnapshotId, ""),
    turnCount: turns.length,
    unresolvedObligationCount: Array.isArray(session.unresolvedObligations) ? session.unresolvedObligations.length : 0,
    eventCount: turns.reduce((count, turn) => count + Number(turn.normalizedEventCount || 0), 0),
    activeTurnCount: turns.filter((turn) => DIRECT_RECOVERABLE_ACTIVE_TURN_STATES.has(turn.state)).length,
    lastTurnState: turns[turns.length - 1]?.state || "",
  };
}

class DirectSessionStore {
  constructor(options = {}) {
    const rootDir = normalizeString(options.rootDir, "");
    if (!rootDir) throw new Error("DirectSessionStore requires an explicit rootDir.");
    this.rootDir = path.resolve(rootDir);
    this._index = null;
  }

  indexPath() {
    return path.join(this.rootDir, "index.json");
  }

  sessionPath(sessionId) {
    return path.join(this.rootDir, "sessions", requireSafeId(sessionId, "session"), "session.json");
  }

  turnPath(sessionId, turnId) {
    return path.join(this.rootDir, "turns", requireSafeId(sessionId, "session"), `${requireSafeId(turnId, "turn")}.json`);
  }

  eventPath(sessionId, turnId) {
    return path.join(this.rootDir, "events", requireSafeId(sessionId, "session"), `${requireSafeId(turnId, "turn")}.normalized.jsonl`);
  }

  diagnosticPath(sessionId, fixtureId) {
    return path.join(this.rootDir, "diagnostics", requireSafeId(sessionId, "session"), `${requireSafeId(fixtureId, "diagnostic")}.redacted.jsonl`);
  }

  importPath(importId, artifactName) {
    return path.join(this.rootDir, "imports", requireSafeId(importId, "import"), safeArtifactName(artifactName));
  }

  importContinuationPath(importId, continuationId, artifactName) {
    return path.join(
      this.rootDir,
      "imports",
      requireSafeId(importId, "import"),
      "checkpoint-continuations",
      requireSafeId(continuationId, "checkpoint continuation"),
      safeArtifactName(artifactName),
    );
  }

  importIndexPath() {
    return path.join(this.rootDir, "imports", "index.json");
  }

  ensure() {
    for (const directory of ["sessions", "turns", "events", "diagnostics", "imports"]) {
      ensureDirectory(path.join(this.rootDir, directory));
    }
    if (!fs.existsSync(this.indexPath())) {
      return this.recoverIndex({ write: true });
    }
    return this.readIndex();
  }

  emptyImportIndex() {
    return {
      schema: DIRECT_IMPORT_INDEX_SCHEMA,
      version: 1,
      updatedAt: nowIso(),
      imports: [],
      recovery: {
        recoveredAt: "",
        healthyCount: 0,
        partialCount: 0,
        corruptedCount: 0,
        reportOnlyCount: 0,
      },
    };
  }

  emptyIndex() {
    return {
      schema: DIRECT_SESSION_INDEX_SCHEMA,
      version: 1,
      updatedAt: nowIso(),
      sessions: [],
      recovery: {
        recoveredAt: "",
        recoveredSessionCount: 0,
        missingSessionFileCount: 0,
      },
    };
  }

  readIndex() {
    if (this._index) return this._index;
    const index = readJsonFile(this.indexPath());
    if (!index) return this.recoverIndex({ write: true });
    if (index.schema !== DIRECT_SESSION_INDEX_SCHEMA || !Array.isArray(index.sessions)) {
      return this.recoverIndex({ write: true });
    }
    this._index = index;
    return index;
  }

  writeIndex(sessions, recovery = {}) {
    const empty = this.emptyIndex();
    const index = {
      ...empty,
      updatedAt: nowIso(),
      sessions: sessions.slice().sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))),
      recovery: {
        ...empty.recovery,
        ...recovery,
      },
    };
    writeJsonAtomic(this.indexPath(), index);
    this._index = index;
    return index;
  }

  listSessionIdsFromDisk() {
    const sessionsDir = path.join(this.rootDir, "sessions");
    try {
      return fs.readdirSync(sessionsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter(isSafeId);
    } catch (error) {
      if (error && error.code === "ENOENT") return [];
      throw error;
    }
  }

  listTurnIdsFromDisk(sessionId) {
    const turnsDir = path.join(this.rootDir, "turns", requireSafeId(sessionId, "session"));
    try {
      return fs.readdirSync(turnsDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name.slice(0, -".json".length))
        .filter(isSafeId);
    } catch (error) {
      if (error && error.code === "ENOENT") return [];
      throw error;
    }
  }

  listImportIdsFromDisk() {
    const importsDir = path.join(this.rootDir, "imports");
    try {
      return fs.readdirSync(importsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter(isSafeId);
    } catch (error) {
      if (error && error.code === "ENOENT") return [];
      throw error;
    }
  }

  writeImportArtifact(importId, artifactName, value) {
    writeJsonAtomic(this.importPath(importId, artifactName), value);
    return value;
  }

  readImportArtifact(importId, artifactName) {
    return readJsonFile(this.importPath(importId, artifactName));
  }

  writeImportContinuationArtifact(importId, continuationId, artifactName, value) {
    writeJsonAtomic(this.importContinuationPath(importId, continuationId, artifactName), value);
    return value;
  }

  readImportContinuationArtifact(importId, continuationId, artifactName) {
    return readJsonFile(this.importContinuationPath(importId, continuationId, artifactName));
  }

  listImportContinuationIds(importId) {
    const directory = path.join(this.rootDir, "imports", requireSafeId(importId, "import"), "checkpoint-continuations");
    try {
      return fs.readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter(isSafeId);
    } catch (error) {
      if (error && error.code === "ENOENT") return [];
      throw error;
    }
  }

  listImportContinuationRecords(importId) {
    return this.listImportContinuationIds(importId)
      .map((continuationId) => this.readImportContinuationArtifact(importId, continuationId, "continuation.json"))
      .filter((record) => isPlainObject(record));
  }

  setImportHidden(importId, hidden = true, options = {}) {
    const safeImportId = requireSafeId(importId, "import");
    if (!hidden) {
      try {
        fs.unlinkSync(this.importPath(safeImportId, "hidden.json"));
      } catch (error) {
        if (!error || error.code !== "ENOENT") throw error;
      }
      this.recoverImportIndex({ write: true, nowMs: options.nowMs });
      return { importId: safeImportId, hidden: false };
    }
    const marker = {
      schema: "direct_codex_import_hidden@1",
      importId: safeImportId,
      hidden: true,
      hiddenAt: nowIso(options.nowMs),
      reason: normalizeString(options.reason, "operator_hidden"),
    };
    writeJsonAtomic(this.importPath(safeImportId, "hidden.json"), marker);
    this.recoverImportIndex({ write: true, nowMs: options.nowMs });
    return marker;
  }

  recoverImportIndex(options = {}) {
    const entries = [];
    const recovery = {
      recoveredAt: nowIso(options.nowMs),
      healthyCount: 0,
      partialCount: 0,
      corruptedCount: 0,
      reportOnlyCount: 0,
    };
    for (const importId of this.listImportIdsFromDisk()) {
      let candidate = null;
      let checkpoint = null;
      let report = null;
      let hidden = null;
      let artifactReadFailed = false;
      try {
        candidate = this.readImportArtifact(importId, "candidate.json");
      } catch {
        artifactReadFailed = true;
      }
      try {
        checkpoint = this.readImportArtifact(importId, "checkpoint.json");
      } catch {
        artifactReadFailed = true;
      }
      try {
        report = this.readImportArtifact(importId, "validation-report.json");
      } catch {
        artifactReadFailed = true;
      }
      try {
        hidden = this.readImportArtifact(importId, "hidden.json");
      } catch {
        artifactReadFailed = true;
      }
      let recoveryState = "healthy";
      if (artifactReadFailed) recoveryState = "corrupted";
      else if (!candidate && !checkpoint && report) recoveryState = "report-only";
      else if (!artifactReadFailed && (!report || !checkpoint)) recoveryState = "partial";
      if (report && checkpoint && report.lineage?.importId && checkpoint.lineage?.importId && report.lineage.importId !== checkpoint.lineage.importId) {
        recoveryState = "corrupted";
      }
      if (recoveryState === "healthy") recovery.healthyCount += 1;
      else if (recoveryState === "partial") recovery.partialCount += 1;
      else if (recoveryState === "report-only") recovery.reportOnlyCount += 1;
      else recovery.corruptedCount += 1;
      const source = report?.source || checkpoint?.source || candidate?.source || {};
      const workspaceMatch = report?.workspaceMatch || checkpoint?.workspaceMatch || {};
      const state = canonicalImportState(report?.state || checkpoint?.state || candidate?.target?.state || "");
      entries.push({
        importId,
        recoveryState,
        state,
        projectId: normalizeString(workspaceMatch.selectedProjectId, ""),
        sourceDisplayName: normalizeString(source.sourceDisplayName, ""),
        sourceRootDisplayName: normalizeString(source.sourceRootDisplayName, ""),
        sourceFileSha256: normalizeString(source.sourceFileSha256, ""),
        sourceFileSizeBytes: Number(source.sourceFileSizeBytes || 0),
        sourceFileMtimeMs: Number(source.sourceFileMtimeMs || 0) || undefined,
        threadId: normalizeString(source.threadId, ""),
        timestampStart: normalizeString(source.timestampStart, ""),
        timestampEnd: normalizeString(source.timestampEnd, ""),
        recordCount: Number(source.recordCount || 0),
        validationReportId: normalizeString(report?.reportId, ""),
        materializedSessionId: normalizeString(report?.lineage?.materializedSessionId || checkpoint?.lineage?.materializedSessionId, ""),
        checkpointEligible: state === "checkpoint-validated" && recoveryState === "healthy",
        hidden: hidden?.hidden === true,
        hiddenAt: normalizeString(hidden?.hiddenAt, ""),
        updatedAt: normalizeString(report?.generatedAt || checkpoint?.validatedAt || checkpoint?.createdAt || candidate?.source?.importedAt, ""),
      });
    }
    const index = {
      ...this.emptyImportIndex(),
      updatedAt: nowIso(options.nowMs),
      imports: entries.sort((a, b) => String(a.importId).localeCompare(String(b.importId))),
      recovery,
    };
    if (options.write) writeJsonAtomic(this.importIndexPath(), index);
    return index;
  }

  recoverIndex(options = {}) {
    const entries = [];
    let missingSessionFileCount = 0;
    for (const sessionId of this.listSessionIdsFromDisk()) {
      const session = readJsonFile(this.sessionPath(sessionId));
      if (!session || session.schema !== DIRECT_SESSION_SCHEMA) {
        missingSessionFileCount += 1;
        continue;
      }
      entries.push(indexEntryFromSession(session));
    }
    const recovery = {
      recoveredAt: nowIso(),
      recoveredSessionCount: entries.length,
      missingSessionFileCount,
    };
    if (options.write) return this.writeIndex(entries, recovery);
    return { ...this.emptyIndex(), sessions: entries, recovery };
  }

  updateIndexForSession(session) {
    const index = this.readIndex();
    const entry = indexEntryFromSession(session);
    const sessions = index.sessions.filter((existing) => existing.sessionId !== entry.sessionId);
    sessions.push(entry);
    return this.writeIndex(sessions, index.recovery);
  }

  readSession(sessionId) {
    const session = readJsonFile(this.sessionPath(sessionId));
    if (!session || session.schema !== DIRECT_SESSION_SCHEMA) return null;
    return session;
  }

  writeSession(session) {
    if (!isPlainObject(session) || session.schema !== DIRECT_SESSION_SCHEMA) {
      throw new Error("Direct session must use direct_codex_session@1.");
    }
    writeJsonAtomic(this.sessionPath(session.sessionId), session);
    this.updateIndexForSession(session);
    return session;
  }

  createSession(input = {}, options = {}) {
    this.ensure();
    const now = nowIso(options.nowMs);
    const sessionId = normalizeId(input.sessionId, "direct_session");
    const session = {
      schema: DIRECT_SESSION_SCHEMA,
      sessionId,
      projectId: normalizeString(input.projectId, ""),
      workspace: isPlainObject(input.workspace) ? input.workspace : {},
      title: normalizeString(input.title, "Untitled direct session"),
      status: "created",
      createdAt: normalizeString(input.createdAt, now),
      updatedAt: normalizeString(input.updatedAt, now),
      model: normalizeString(input.model, ""),
      runtimeMode: normalizeString(input.runtimeMode, ""),
      directTransport: normalizeString(input.directTransport, ""),
      workspaceDisplayPath: normalizeString(input.workspaceDisplayPath, ""),
      modelSource: normalizeString(input.modelSource, ""),
      modelEvidenceState: normalizeString(input.modelEvidenceState, ""),
      modelEvidenceId: normalizeString(input.modelEvidenceId, ""),
      promptCacheKey: normalizeString(input.promptCacheKey, ""),
      profileSnapshotId: normalizeString(input.profileSnapshotId, ""),
      clientTurnRequests: isPlainObject(input.clientTurnRequests) ? input.clientTurnRequests : {},
      messages: Array.isArray(input.messages) ? input.messages : [],
      turns: [],
      unresolvedObligations: Array.isArray(input.unresolvedObligations) ? input.unresolvedObligations : [],
      compactionCheckpoints: Array.isArray(input.compactionCheckpoints) ? input.compactionCheckpoints : [],
      sourceClass: normalizeString(input.sourceClass, ""),
      nativeDirectSession: input.nativeDirectSession === true,
      parentImportLineage: isPlainObject(input.parentImportLineage) ? input.parentImportLineage : null,
      checkpointContinuationId: normalizeString(input.checkpointContinuationId, ""),
      checkpointSeedId: normalizeString(input.checkpointSeedId, ""),
      seedShapeHash: normalizeString(input.seedShapeHash, ""),
      requestShapeHash: normalizeString(input.requestShapeHash, ""),
      importedSessionId: normalizeString(input.importedSessionId, ""),
      importedSessionReadOnly: input.importedSessionReadOnly === true,
      providerContinuityAvailable: input.providerContinuityAvailable === true,
      continuityState: normalizeString(input.continuityState, ""),
      composerState: normalizeString(input.composerState, ""),
      forkStartId: normalizeString(input.forkStartId, ""),
      forkSeedId: normalizeString(input.forkSeedId, ""),
      sourcePreviewId: normalizeString(input.sourcePreviewId, ""),
      sourcePreviewDigest: normalizeString(input.sourcePreviewDigest, ""),
      parentForkLineage: isPlainObject(input.parentForkLineage) ? input.parentForkLineage : null,
      sourcePreviousResponseIdUsed: input.sourcePreviousResponseIdUsed === true,
    };
    this.writeSession(session);
    return session;
  }

  readTurn(sessionId, turnId) {
    const turn = readJsonFile(this.turnPath(sessionId, turnId));
    if (!turn || turn.schema !== DIRECT_TURN_SCHEMA) return null;
    return turn;
  }

  writeTurn(turn) {
    if (!isPlainObject(turn) || turn.schema !== DIRECT_TURN_SCHEMA) {
      throw new Error("Direct turn must use direct_codex_turn@1.");
    }
    writeJsonAtomic(this.turnPath(turn.sessionId, turn.turnId), turn);
    return turn;
  }

  createTurn(sessionId, input = {}, options = {}) {
    const session = this.readSession(sessionId);
    if (!session) throw new Error(`Direct session not found: ${sessionId}`);
    const now = nowIso(options.nowMs);
    const turnId = normalizeId(input.turnId, "direct_turn");
    const turn = {
      schema: DIRECT_TURN_SCHEMA,
      sessionId: session.sessionId,
      turnId,
      state: normalizeTurnState(input.state, "created"),
      createdAt: normalizeString(input.createdAt, now),
      updatedAt: normalizeString(input.updatedAt, now),
      model: normalizeString(input.model, session.model),
      profileSnapshotId: normalizeString(input.profileSnapshotId, session.profileSnapshotId),
      clientTurnRequestId: normalizeString(input.clientTurnRequestId, ""),
      requestBuiltAt: "",
      streamStartedAt: "",
      streamPhase: "",
      completedAt: "",
      failedAt: "",
      abortedAt: "",
      requestShape: isPlainObject(input.requestShape) ? input.requestShape : {},
      responseStatus: 0,
      responseContentType: "",
      input: Array.isArray(input.input) ? input.input : [],
      normalizedEventCount: 0,
      unresolvedObligations: Array.isArray(input.unresolvedObligations) ? input.unresolvedObligations : [],
      toolResults: Array.isArray(input.toolResults) ? input.toolResults : [],
      continuationRequests: Array.isArray(input.continuationRequests) ? input.continuationRequests : [],
      error: isPlainObject(input.error) ? input.error : null,
      sourceClass: normalizeString(input.sourceClass, ""),
      nativeDirectSession: input.nativeDirectSession === true,
      parentImportLineage: isPlainObject(input.parentImportLineage) ? input.parentImportLineage : null,
      checkpointContinuationId: normalizeString(input.checkpointContinuationId, ""),
      checkpointSeedId: normalizeString(input.checkpointSeedId, ""),
      seedShapeHash: normalizeString(input.seedShapeHash, ""),
      importedSessionId: normalizeString(input.importedSessionId, ""),
      importedSessionReadOnly: input.importedSessionReadOnly === true,
      forkStartId: normalizeString(input.forkStartId, ""),
      forkSeedId: normalizeString(input.forkSeedId, ""),
      sourcePreviewId: normalizeString(input.sourcePreviewId, ""),
      sourcePreviewDigest: normalizeString(input.sourcePreviewDigest, ""),
      parentForkLineage: isPlainObject(input.parentForkLineage) ? input.parentForkLineage : null,
      requestManifestId: normalizeString(input.requestManifestId, ""),
      contextBuildId: normalizeString(input.contextBuildId, ""),
      providerContinuityHandleUsed: input.providerContinuityHandleUsed === true,
      previousResponseIdUsed: input.previousResponseIdUsed === true,
      sourceProviderContinuityHandleUsed: input.sourceProviderContinuityHandleUsed === true,
    };
    this.writeTurn(turn);
    const nextSession = {
      ...session,
      updatedAt: now,
      status: "active",
      turns: [
        ...session.turns.filter((summary) => summary.turnId !== turnId),
        {
          turnId,
          state: turn.state,
          createdAt: turn.createdAt,
          updatedAt: turn.updatedAt,
          model: turn.model,
          normalizedEventCount: 0,
          sourceClass: normalizeString(turn.sourceClass, ""),
          checkpointContinuationId: normalizeString(turn.checkpointContinuationId, ""),
          checkpointSeedId: normalizeString(turn.checkpointSeedId, ""),
          seedShapeHash: normalizeString(turn.seedShapeHash, ""),
        },
      ],
    };
    this.writeSession(nextSession);
    return turn;
  }

  updateTurnState(sessionId, turnId, nextState, patch = {}, options = {}) {
    const turn = this.readTurn(sessionId, turnId);
    if (!turn) throw new Error(`Direct turn not found: ${turnId}`);
    const now = nowIso(options.nowMs);
    const state = normalizeTurnState(nextState, turn.state);
    const terminalPatch = {};
    if (state === "request_built" && !turn.requestBuiltAt) terminalPatch.requestBuiltAt = now;
    if (state === "completed") terminalPatch.completedAt = now;
    if (state === "failed") terminalPatch.failedAt = now;
    if (state === "aborted") terminalPatch.abortedAt = now;
    const nextTurn = {
      ...turn,
      ...patch,
      ...terminalPatch,
      state,
      updatedAt: now,
    };
    this.writeTurn(nextTurn);
    const session = this.readSession(sessionId);
    if (session) {
      const nextSession = {
        ...session,
        updatedAt: now,
        status: state,
        turns: session.turns.map((summary) =>
          summary.turnId === turnId
            ? { ...summary, state, updatedAt: now, normalizedEventCount: nextTurn.normalizedEventCount }
            : summary,
        ),
      };
      this.writeSession(nextSession);
    }
    return nextTurn;
  }

  addToolObligations(sessionId, turnId, normalizedEvents = [], options = {}) {
    const turn = this.readTurn(sessionId, turnId);
    if (!turn) throw new Error(`Direct turn not found: ${turnId}`);
    const obligations = buildToolObligationsFromEvents(sessionId, turnId, normalizedEvents);
    if (!obligations.length) return { turn, obligations: [] };
    const now = nowIso(options.nowMs);
    const existingTurnObligations = new Map((Array.isArray(turn.unresolvedObligations) ? turn.unresolvedObligations : [])
      .map((obligation) => [obligation.obligationId, obligation]));
    for (const obligation of obligations) {
      existingTurnObligations.set(obligation.obligationId, mergeToolObligation(existingTurnObligations.get(obligation.obligationId), obligation));
    }
    const nextTurn = {
      ...turn,
      state: "tool_waiting",
      updatedAt: now,
      unresolvedObligations: [...existingTurnObligations.values()],
      error: null,
    };
    this.writeTurn(nextTurn);
    const session = this.readSession(sessionId);
    if (session) {
      const existingSessionObligations = new Map((Array.isArray(session.unresolvedObligations) ? session.unresolvedObligations : [])
        .map((obligation) => [obligation.obligationId, obligation]));
      for (const obligation of obligations) {
        existingSessionObligations.set(
          obligation.obligationId,
          mergeToolObligation(existingSessionObligations.get(obligation.obligationId), existingTurnObligations.get(obligation.obligationId)),
        );
      }
      this.writeSession({
        ...session,
        status: "tool_waiting",
        updatedAt: now,
        unresolvedObligations: [...existingSessionObligations.values()],
        turns: session.turns.map((summary) =>
          summary.turnId === turnId
            ? { ...summary, state: "tool_waiting", updatedAt: now, normalizedEventCount: nextTurn.normalizedEventCount }
            : summary,
        ),
      });
    }
    return { turn: nextTurn, obligations: obligations.map((obligation) => existingTurnObligations.get(obligation.obligationId)) };
  }

  findToolObligation(sessionId, turnId, obligationId) {
    const turn = this.readTurn(sessionId, turnId);
    if (!turn) throw new Error(`Direct turn not found: ${turnId}`);
    const obligationKey = normalizeString(obligationId, "");
    const obligation = (Array.isArray(turn.unresolvedObligations) ? turn.unresolvedObligations : [])
      .find((entry) => entry?.obligationId === obligationKey);
    if (!obligation) throw new Error(`Direct tool obligation not found: ${obligationKey}`);
    return { turn, obligation };
  }

  updateToolObligation(sessionId, turnId, obligationId, patch = {}, options = {}) {
    const { turn, obligation } = this.findToolObligation(sessionId, turnId, obligationId);
    const now = nowIso(options.nowMs);
    const nextObligation = {
      ...obligation,
      ...patch,
      updatedAt: now,
    };
    const nextObligations = (Array.isArray(turn.unresolvedObligations) ? turn.unresolvedObligations : [])
      .map((entry) => entry?.obligationId === obligation.obligationId ? nextObligation : entry);
    const nextState = normalizeTurnState(options.nextTurnState, turn.state);
    const turnPatch = isPlainObject(options.turnPatch) ? options.turnPatch : {};
    const nextTurn = {
      ...turn,
      ...turnPatch,
      state: nextState,
      updatedAt: now,
      unresolvedObligations: nextObligations,
      toolResults: Array.isArray(turn.toolResults) ? turn.toolResults : [],
      continuationRequests: Array.isArray(turn.continuationRequests) ? turn.continuationRequests : [],
    };
    if (isPlainObject(patch.result)) {
      const existingResults = new Map((Array.isArray(turn.toolResults) ? turn.toolResults : [])
        .map((result) => [result.obligationId, result]));
      existingResults.set(obligation.obligationId, patch.result);
      nextTurn.toolResults = [...existingResults.values()];
    }
    if (isPlainObject(patch.continuationRequest)) {
      const existingContinuations = new Map((Array.isArray(turn.continuationRequests) ? turn.continuationRequests : [])
        .map((request) => [request.continuationId, request]));
      existingContinuations.set(patch.continuationRequest.continuationId, patch.continuationRequest);
      nextTurn.continuationRequests = [...existingContinuations.values()];
    }
    this.writeTurn(nextTurn);
    const session = this.readSession(sessionId);
    if (session) {
      const sessionObligations = (Array.isArray(session.unresolvedObligations) ? session.unresolvedObligations : [])
        .map((entry) => entry?.obligationId === obligation.obligationId ? nextObligation : entry);
      const nextMessages = Array.isArray(session.messages)
        ? session.messages.map((message) => ({
            ...message,
            items: Array.isArray(message.items)
              ? message.items.map((item) => item?.id === obligation.obligationId
                  ? toolTranscriptItemFromObligation(nextObligation)
                  : item)
              : message.items,
          }))
        : session.messages;
      this.writeSession({
        ...session,
        status: nextState,
        updatedAt: now,
        unresolvedObligations: sessionObligations,
        messages: nextMessages,
        turns: session.turns.map((summary) =>
          summary.turnId === turnId
            ? { ...summary, state: nextState, updatedAt: now, normalizedEventCount: nextTurn.normalizedEventCount }
            : summary,
        ),
      });
    }
    return { turn: nextTurn, obligation: nextObligation };
  }

  recoverInterruptedTurns(options = {}) {
    const recoveredAt = nowIso(options.nowMs);
    let recoveredTurnCount = 0;
    for (const sessionId of this.listSessionIdsFromDisk()) {
      const session = this.readSession(sessionId);
      if (!session || !Array.isArray(session.turns)) continue;
      const turnIds = new Set([
        ...session.turns.map((summary) => summary?.turnId).filter(isSafeId),
        ...this.listTurnIdsFromDisk(session.sessionId),
      ]);
      const recoveredByTurnId = new Map();
      for (const turnId of turnIds) {
        const turn = this.readTurn(session.sessionId, turnId);
        if (!turn || !DIRECT_RECOVERABLE_ACTIVE_TURN_STATES.has(turn.state)) continue;
        const nextTurn = {
          ...turn,
          state: "failed",
          updatedAt: recoveredAt,
          failedAt: recoveredAt,
          error: {
            code: "restart_interrupted_turn",
            message: "Direct text probe turn was interrupted before a terminal event and needs explicit user resume.",
            previousState: turn.state,
            recoveredAt,
          },
        };
        this.writeTurn(nextTurn);
        recoveredByTurnId.set(nextTurn.turnId, nextTurn);
        recoveredTurnCount += 1;
      }
      if (!recoveredByTurnId.size) continue;
      const existingTurnIds = new Set(session.turns.map((summary) => summary.turnId));
      const recoveredSummaries = [...recoveredByTurnId.values()]
        .filter((turn) => !existingTurnIds.has(turn.turnId))
        .map((turn) => ({
          turnId: turn.turnId,
          state: turn.state,
          createdAt: turn.createdAt,
          updatedAt: turn.updatedAt,
          model: turn.model,
          normalizedEventCount: turn.normalizedEventCount,
        }));
      this.writeSession({
        ...session,
        updatedAt: recoveredAt,
        status: "failed",
        turns: [
          ...session.turns.map((summary) => {
            const recovered = recoveredByTurnId.get(summary.turnId);
            return recovered
              ? {
                  ...summary,
                  state: recovered.state,
                  updatedAt: recovered.updatedAt,
                  normalizedEventCount: recovered.normalizedEventCount,
                }
              : summary;
          }),
          ...recoveredSummaries,
        ],
      });
    }
    return {
      recoveredAt,
      recoveredTurnCount,
    };
  }

  appendNormalizedEvent(sessionId, turnId, event, options = {}) {
    return this.appendNormalizedEvents(sessionId, turnId, [event], options);
  }

  appendNormalizedEvents(sessionId, turnId, events, options = {}) {
    const turn = this.readTurn(sessionId, turnId);
    if (!turn) throw new Error(`Direct turn not found: ${turnId}`);
    const normalizedEvents = Array.isArray(events) ? events : [];
    if (!normalizedEvents.length) return turn;
    const at = nowIso(options.nowMs);
    const lines = normalizedEvents.map((event) => JSON.stringify({ at, event })).join("\n");
    ensureDirectory(path.dirname(this.eventPath(sessionId, turnId)));
    fs.appendFileSync(this.eventPath(sessionId, turnId), `${lines}\n`, "utf8");
    return this.updateTurnState(sessionId, turnId, turn.state, {
      normalizedEventCount: turn.normalizedEventCount + normalizedEvents.length,
    }, options);
  }

  writeDiagnostic(sessionId, fixtureId, record, options = {}) {
    const diagnostic = {
      schema: DIRECT_DIAGNOSTIC_SCHEMA,
      capturedAt: nowIso(options.nowMs),
      sessionId: requireSafeId(sessionId, "session"),
      fixtureId: requireSafeId(fixtureId, "diagnostic"),
      record,
    };
    assertFixtureRedacted(diagnostic, options.redactionOptions || {});
    ensureDirectory(path.dirname(this.diagnosticPath(sessionId, fixtureId)));
    fs.appendFileSync(this.diagnosticPath(sessionId, fixtureId), `${JSON.stringify(diagnostic)}\n`, "utf8");
    return diagnostic;
  }

  status() {
    const index = this.ensure();
    const sessionCount = index.sessions.length;
    const turnCount = index.sessions.reduce((count, session) => count + Number(session.turnCount || 0), 0);
    const eventCount = index.sessions.reduce((count, session) => count + Number(session.eventCount || 0), 0);
    const activeTurnCount = index.sessions.reduce((count, session) => count + Number(session.activeTurnCount || 0), 0);
    const unresolvedObligationCount = index.sessions.reduce((count, session) => count + Number(session.unresolvedObligationCount || 0), 0);
    return {
      schema: "direct_codex_session_store_status@1",
      available: true,
      rootExposed: false,
      sessionCount,
      turnCount,
      eventCount,
      activeTurnCount,
      unresolvedObligationCount,
      lastTurnState: index.sessions[0]?.lastTurnState || "",
      lastSessionUpdatedAt: index.sessions[0]?.updatedAt || "",
      recovery: index.recovery || {},
    };
  }
}

module.exports = {
  DIRECT_DIAGNOSTIC_SCHEMA,
  DIRECT_IMPORT_INDEX_SCHEMA,
  DIRECT_RECOVERABLE_ACTIVE_TURN_STATES,
  DIRECT_SESSION_INDEX_SCHEMA,
  DIRECT_SESSION_SCHEMA,
  DIRECT_TOOL_OBLIGATION_SCHEMA,
  DIRECT_TURN_SCHEMA,
  DIRECT_TURN_STATES,
  DirectSessionStore,
  buildToolObligationsFromEvents,
  normalizeTurnState,
  toolTranscriptItemFromObligation,
  writeJsonAtomic,
};
