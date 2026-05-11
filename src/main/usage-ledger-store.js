"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const SCHEMA_VERSION = 1;
const LEDGER_KIND = "codex_usage_ledger";
const WRITER_VERSION = "usage-ledger-v0.1";
const MAX_QUEUE_LENGTH = 1000;

function nowIso() {
  return new Date().toISOString();
}

function cleanString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function sha256(text) {
  return crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

async function writeTextAtomic(targetPath, text) {
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.${crypto.randomUUID().slice(0, 8)}.tmp`;
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await fs.writeFile(tempPath, text, "utf8");
    await fs.rename(tempPath, targetPath);
  } catch (error) {
    try {
      await fs.unlink(tempPath);
    } catch {}
    throw error;
  }
}

function evidenceRef(kind, label, options = {}) {
  return {
    id: cleanString(options.id, `${kind}_${crypto.randomUUID().slice(0, 8)}`),
    kind,
    label: cleanString(label, kind),
    observedAt: cleanString(options.observedAt, nowIso()),
    status: cleanString(options.status, "fresh"),
    confidence: cleanString(options.confidence, "observed"),
  };
}

function scanSerializedRow(serialized, rawPathPolicy = "excluded") {
  const blockers = [];
  const text = String(serialized || "");
  const checks = [
    [/bearer\s+[a-z0-9._~+/-]+=*/i, "bearer_token"],
    [/"authorization"\s*:/i, "authorization_header"],
    [/"cookie"\s*:/i, "cookie"],
    [/"prompt"\s*:/i, "prompt_field"],
    [/"reasoning(Text|Content|Output)?"\s*:/i, "reasoning_field"],
    [/"assistant(Output|Text|Message)"\s*:/i, "assistant_output_field"],
    [/"toolOutput(Text|Content)?"\s*:/i, "tool_output_field"],
    [/"rawProviderPayload"\s*:/i, "raw_provider_payload"],
  ];
  for (const [pattern, label] of checks) {
    if (pattern.test(text)) blockers.push(label);
  }
  if (rawPathPolicy === "excluded" && /(?:[A-Za-z]:\\|\\\\wsl(?:\.localhost)?\\|\/home\/|\/Users\/|\/mnt\/[a-z]\/)/i.test(text)) {
    blockers.push("raw_local_path");
  }
  return blockers;
}

function redactionBlockedRow(originalRow, blockers) {
  return {
    rowKind: "usage_unavailable",
    sourceKind: "unavailable",
    confidence: "unknown",
    projectId: originalRow.projectId,
    connectionId: originalRow.connectionId,
    threadId: originalRow.threadId,
    turnId: originalRow.turnId,
    agentId: originalRow.agentId,
    unavailableKind: "ledger_write_degraded",
    targetKind: originalRow.turnId ? "turn" : originalRow.threadId ? "thread" : "session",
    targetId: originalRow.turnId || originalRow.threadId || originalRow.connectionId || "",
    reason: `redaction_blocked:${blockers.join(",")}`,
    evidenceRefs: [
      evidenceRef("inference", `Redaction scanner blocked ${cleanString(originalRow.rowKind, "row")}`, {
        status: "failed",
        confidence: "proven",
      }),
    ],
  };
}

class UsageLedgerStore {
  constructor(options = {}) {
    this.ledgerPath = cleanString(options.ledgerPath, "");
    if (!this.ledgerPath) throw new Error("Usage ledger path is required.");
    this.manifestPath = cleanString(options.manifestPath, `${this.ledgerPath}.manifest.json`);
    this.ledgerId = cleanString(options.ledgerId, `ledger_${crypto.randomUUID()}`);
    this.rawPathPolicy = cleanString(options.rawPathPolicy, "excluded");
    this.writerVersion = cleanString(options.writerVersion, WRITER_VERSION);
    this.queue = Promise.resolve();
    this.pendingCount = 0;
    this.droppedRows = 0;
    this.seq = 0;
    this.lastRowDigest = "";
    this.firstObservedAt = "";
    this.lastObservedAt = "";
    this.completedAt = "";
    this.interrupted = false;
    this.rowCount = 0;
    this.state = "idle";
    this.lastError = "";
    this.seenDedupeKeys = new Set();
  }

  status() {
    return {
      enabled: true,
      state: this.state,
      ledgerId: this.ledgerId,
      ledgerPath: this.ledgerPath,
      manifestPath: this.manifestPath,
      queuedRows: this.pendingCount,
      droppedRows: this.droppedRows,
      rowCount: this.rowCount,
      lastError: this.lastError,
      lastObservedAt: this.lastObservedAt,
    };
  }

  async initialize(header) {
    await fs.mkdir(path.dirname(this.ledgerPath), { recursive: true });
    await fs.writeFile(this.ledgerPath, "", { flag: "a" });
    await this.append({
      rowKind: "ledger_header",
      sourceKind: "codex_app_server_event",
      confidence: "runtime_exact",
      projectId: header.projectId,
      header: {
        schemaVersion: SCHEMA_VERSION,
        ledgerKind: LEDGER_KIND,
        ledgerId: this.ledgerId,
        createdAt: nowIso(),
        ...header,
      },
      evidenceRefs: [
        evidenceRef("runtime_provider_profile", "Usage ledger header initialized", { confidence: "declared" }),
      ],
    });
  }

  append(row) {
    if (!row || typeof row !== "object") return Promise.resolve({ ok: false, skipped: true });
    if (row.dedupeKey && this.seenDedupeKeys.has(row.dedupeKey)) {
      return Promise.resolve({ ok: true, skipped: true, dedupeKey: row.dedupeKey });
    }
    if (this.pendingCount >= MAX_QUEUE_LENGTH) {
      this.droppedRows += 1;
      this.state = "backpressured";
      return Promise.resolve({ ok: false, skipped: true, error: "usage ledger writer queue is full" });
    }
    this.pendingCount += 1;
    this.queue = this.queue
      .then(() => this.writeRow(row))
      .catch((error) => {
        this.state = "failed";
        this.lastError = error.message;
        return { ok: false, error: error.message };
      })
      .finally(() => {
        this.pendingCount = Math.max(0, this.pendingCount - 1);
        if (this.state === "writing" && this.pendingCount === 0) this.state = "idle";
      });
    return this.queue;
  }

  async writeRow(candidate) {
    this.state = "writing";
    let row = {
      schemaVersion: SCHEMA_VERSION,
      ledgerId: this.ledgerId,
      seq: this.seq + 1,
      rowId: cleanString(candidate.rowId, `row_${crypto.randomUUID()}`),
      observedAt: cleanString(candidate.observedAt, nowIso()),
      sourceKind: cleanString(candidate.sourceKind, "codex_app_server_event"),
      confidence: cleanString(candidate.confidence, "runtime_exact"),
      evidenceRefs: Array.isArray(candidate.evidenceRefs) ? candidate.evidenceRefs : [],
      ...candidate,
    };
    row.seq = this.seq + 1;
    row.previousRowDigest = this.lastRowDigest || undefined;

    const preDigest = { ...row };
    delete preDigest.rowDigest;
    const blockers = scanSerializedRow(stableStringify(preDigest), this.rawPathPolicy);
    if (blockers.length) {
      row = {
        schemaVersion: SCHEMA_VERSION,
        ledgerId: this.ledgerId,
        seq: this.seq + 1,
        rowId: `row_${crypto.randomUUID()}`,
        observedAt: nowIso(),
        previousRowDigest: this.lastRowDigest || undefined,
        ...redactionBlockedRow(row, blockers),
      };
    }

    const digestInput = { ...row };
    delete digestInput.rowDigest;
    row.rowDigest = sha256(stableStringify(digestInput));
    await fs.mkdir(path.dirname(this.ledgerPath), { recursive: true });
    await fs.appendFile(this.ledgerPath, `${JSON.stringify(row)}\n`, "utf8");

    this.seq = row.seq;
    this.rowCount += 1;
    this.lastRowDigest = row.rowDigest;
    this.firstObservedAt = this.firstObservedAt || row.observedAt;
    this.lastObservedAt = row.observedAt;
    if (row.dedupeKey) this.seenDedupeKeys.add(row.dedupeKey);
    await this.writeManifest();
    this.lastError = "";
    return { ok: true, rowId: row.rowId, seq: row.seq };
  }

  async writeManifest() {
    const manifest = {
      ledgerId: this.ledgerId,
      schemaVersion: SCHEMA_VERSION,
      rowCount: this.rowCount,
      firstObservedAt: this.firstObservedAt || undefined,
      lastObservedAt: this.lastObservedAt || undefined,
      completedAt: this.completedAt || undefined,
      interrupted: Boolean(this.interrupted),
      writerVersion: this.writerVersion,
      lastRowDigest: this.lastRowDigest || undefined,
    };
    await writeTextAtomic(this.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  async close(status = "completed") {
    this.interrupted = status !== "completed";
    this.completedAt = nowIso();
    await this.queue;
    await this.writeManifest();
  }
}

module.exports = {
  UsageLedgerStore,
  evidenceRef,
  sha256,
  stableStringify,
  WRITER_VERSION,
};
