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
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,120}$/;
const DIRECT_TURN_STATES = new Set([
  "created",
  "request_built",
  "streaming",
  "tool_waiting",
  "authority_waiting",
  "continuation_ready",
  "completed",
  "failed",
  "aborted",
  "checkpoint_required",
]);
const DIRECT_RECOVERABLE_ACTIVE_TURN_STATES = new Set(["request_built", "streaming"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
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
      status: "detected",
      authorityState: "execution_disabled",
      executionAllowed: false,
      sideEffectExecuted: false,
      continuationAllowed: false,
      sourceItemId: normalizeString(event.itemId, ""),
      callId: normalizeString(event.callId, ""),
      name: normalizeString(event.name, "tool_call"),
      toolType: normalizeString(event.toolType, "unknown"),
      argumentsText: "",
      detectedAtSequence: Number(event.sequence ?? 0),
      completedAtSequence: null,
    };
    const next = {
      ...existing,
      sourceItemId: normalizeString(existing.sourceItemId || event.itemId, ""),
      callId: normalizeString(existing.callId || event.callId, ""),
      name: normalizeString(event.name, existing.name),
      toolType: normalizeString(event.toolType, existing.toolType),
    };
    if (event.type === "tool_call_delta") {
      next.argumentsText = `${next.argumentsText || ""}${event.argumentsDelta || ""}`;
    }
    if (event.type === "tool_call_completed") {
      next.status = "waiting";
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
  return {
    ...existing,
    ...incoming,
    status: incoming.status === "waiting" || existing.status === "waiting" ? "waiting" : normalizeString(incoming.status, existing.status),
    authorityState: "execution_disabled",
    executionAllowed: false,
    sideEffectExecuted: Boolean(existing.sideEffectExecuted || incoming.sideEffectExecuted),
    continuationAllowed: false,
    sourceItemId: normalizeString(existing.sourceItemId || incoming.sourceItemId, ""),
    callId: normalizeString(existing.callId || incoming.callId, ""),
    name: normalizeString(incoming.name, existing.name),
    toolType: normalizeString(incoming.toolType, existing.toolType),
    argumentsText: mergeToolArgumentsText(existing.argumentsText, incoming.argumentsText, incoming.completedAtSequence !== null),
    detectedAtSequence: Number(existing.detectedAtSequence ?? incoming.detectedAtSequence ?? 0),
    completedAtSequence: incoming.completedAtSequence ?? existing.completedAtSequence ?? null,
  };
}

function toolTranscriptItemFromObligation(obligation = {}) {
  return {
    id: obligation.obligationId,
    type: "dynamicToolCall",
    turnId: obligation.turnId,
    tool: normalizeString(obligation.name, "tool_call"),
    status: "waiting",
    contentItems: normalizeString(obligation.argumentsText, ""),
    executionAllowed: false,
    continuationAllowed: false,
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

  ensure() {
    for (const directory of ["sessions", "turns", "events", "diagnostics"]) {
      ensureDirectory(path.join(this.rootDir, directory));
    }
    if (!fs.existsSync(this.indexPath())) {
      return this.recoverIndex({ write: true });
    }
    return this.readIndex();
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
      promptCacheKey: normalizeString(input.promptCacheKey, ""),
      profileSnapshotId: normalizeString(input.profileSnapshotId, ""),
      messages: Array.isArray(input.messages) ? input.messages : [],
      turns: [],
      unresolvedObligations: Array.isArray(input.unresolvedObligations) ? input.unresolvedObligations : [],
      compactionCheckpoints: Array.isArray(input.compactionCheckpoints) ? input.compactionCheckpoints : [],
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
      requestBuiltAt: "",
      streamStartedAt: "",
      completedAt: "",
      failedAt: "",
      abortedAt: "",
      requestShape: isPlainObject(input.requestShape) ? input.requestShape : {},
      responseStatus: 0,
      responseContentType: "",
      input: Array.isArray(input.input) ? input.input : [],
      normalizedEventCount: 0,
      unresolvedObligations: Array.isArray(input.unresolvedObligations) ? input.unresolvedObligations : [],
      error: isPlainObject(input.error) ? input.error : null,
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
