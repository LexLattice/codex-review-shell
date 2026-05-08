"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { parseJsonl } = require("../fixtures/fixture-loader");
const {
  DIRECT_IMPORT_VALIDATION_REPORT_SCHEMA,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_RECORDS,
  buildDirectCheckpointCandidate,
  buildImportCandidate,
  buildRendererSafeImportSession,
  materializeDirectImportSession,
  validateDirectCheckpointCandidate,
} = require("./codex-jsonl-import");
const {
  DIRECT_IMPORT_CHECKPOINT_CONTINUATION_SCHEMA,
  buildDirectImportCheckpointSeed,
  rendererSafeCheckpointSeedPreview,
} = require("./checkpoint-continuation");

const SOURCE_HANDLE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_SOURCE_LIST_LIMIT = 200;

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmacSha256Hex(secret, value) {
  return crypto.createHmac("sha256", secret).update(String(value || "")).digest("hex");
}

function containsControlChars(value) {
  return /[\0-\x1F\x7F]/.test(String(value || ""));
}

function pathKey(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isPathWithinRoot(filePath, rootPath) {
  const relative = path.relative(rootPath, filePath);
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function sourceRootRealPath(sourceRoot) {
  const root = safeSourcePath(sourceRoot);
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink()) throw new Error("Direct import source root cannot be a symbolic link.");
  if (stat.isFile()) return fs.realpathSync(path.dirname(root));
  if (!stat.isDirectory()) throw new Error("Direct import source root must be a directory or JSONL file.");
  return fs.realpathSync(root);
}

function safeSourcePath(value) {
  const text = normalizeString(value, "");
  if (!text) throw new Error("Direct import source path is required.");
  if (containsControlChars(text)) throw new Error("Direct import source path contains unsupported control characters.");
  return path.resolve(text);
}

function statSource(filePath) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error("Direct import source must be a JSONL file.");
  if (stat.size > MAX_IMPORT_FILE_BYTES) {
    throw new Error(`Direct import source exceeds file size cap: ${stat.size}`);
  }
  return stat;
}

function readJsonlSource(filePath) {
  const stat = statSource(filePath);
  const text = fs.readFileSync(filePath, "utf8");
  const records = parseJsonl(text, filePath);
  if (records.length > MAX_IMPORT_RECORDS) {
    throw new Error(`Direct import source exceeds record cap: ${records.length}`);
  }
  return {
    stat,
    text,
    records,
    sourceFileSha256: sha256Hex(text),
  };
}

function validateSourceReference(sourcePath, sourceRoot = "") {
  const selectedPath = safeSourcePath(sourcePath);
  const selectedRoot = sourceRoot ? safeSourcePath(sourceRoot) : path.dirname(selectedPath);
  const rootLstat = fs.lstatSync(selectedRoot);
  if (rootLstat.isSymbolicLink()) throw new Error("Direct import source root cannot be a symbolic link.");
  if (!rootLstat.isDirectory() && !rootLstat.isFile()) {
    throw new Error("Direct import source root must be a directory or JSONL file.");
  }
  const rootPath = rootLstat.isFile() ? path.dirname(selectedRoot) : selectedRoot;
  const rootRealPath = fs.realpathSync(rootPath);
  const selectedLstat = fs.lstatSync(selectedPath);
  if (selectedLstat.isSymbolicLink()) throw new Error("Direct import source cannot be a symbolic link.");
  const realPath = fs.realpathSync(selectedPath);
  if (!isPathWithinRoot(realPath, rootRealPath)) {
    throw new Error("Direct import source must remain inside the selected source root.");
  }
  statSource(realPath);
  return {
    sourcePath: realPath,
    sourceRoot: rootRealPath,
    sourceRootDisplayName: path.basename(rootRealPath),
  };
}

function rendererSafeSourceSummary(filePath, sourceRoot = "", options = {}) {
  const stat = statSource(filePath);
  return {
    handleId: normalizeString(options.handleId, ""),
    sourceDisplayName: path.basename(filePath),
    sourceRootDisplayName: sourceRoot ? path.basename(sourceRoot) : "",
    sourceClass: normalizeString(options.sourceClass, "codex-cli-jsonl"),
    sourceFileSizeBytes: stat.size,
    sourceFileMtimeMs: stat.mtimeMs,
    sourceEvidenceKey: normalizeString(options.sourceEvidenceKey, ""),
    duplicateMatched: options.duplicateMatched === true,
    rawPathExposed: false,
    rawSourceSha256Exposed: false,
    sourcePath: "",
  };
}

function listJsonlFiles(sourceRoot, limit = 200) {
  if (containsControlChars(sourceRoot)) throw new Error("Direct import source root contains unsupported control characters.");
  const root = path.resolve(sourceRoot);
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink()) throw new Error("Direct import source root cannot be a symbolic link.");
  if (stat.isFile()) {
    const reference = validateSourceReference(root, path.dirname(root));
    return [reference.sourcePath];
  }
  if (!stat.isDirectory()) throw new Error("Direct import source root must be a directory or JSONL file.");
  const results = [];
  const rootRealPath = fs.realpathSync(root);
  const stack = [rootRealPath];
  const visited = new Set([pathKey(rootRealPath)]);
  while (stack.length && results.length < limit) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (containsControlChars(fullPath)) continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        try {
          const real = fs.realpathSync(fullPath);
          if (!isPathWithinRoot(real, rootRealPath)) continue;
          const key = pathKey(real);
          if (!visited.has(key)) {
            visited.add(key);
            stack.push(fullPath);
          }
        } catch {}
      }
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        try {
          const real = fs.realpathSync(fullPath);
          if (!isPathWithinRoot(real, rootRealPath)) continue;
          statSource(real);
          results.push(real);
        } catch {}
      }
      if (results.length >= limit) break;
    }
  }
  return results.sort();
}

function rawSourceSummaryFromReport(report = {}) {
  const source = isPlainObject(report.source) ? report.source : {};
  return {
    warningsCount: Array.isArray(report.warnings) ? report.warnings.length : 0,
    blockersCount: Array.isArray(report.blockers) ? report.blockers.length : 0,
    gates: isPlainObject(report.gates) ? report.gates : {},
    source: {
      sourceDisplayName: normalizeString(source.sourceDisplayName, ""),
      sourceRootDisplayName: normalizeString(source.sourceRootDisplayName, ""),
      sourceClass: normalizeString(source.sourceClass, ""),
      recordCount: Number(source.recordCount || 0),
      timestampStart: normalizeString(source.timestampStart, ""),
      timestampEnd: normalizeString(source.timestampEnd, ""),
    },
  };
}

function canonicalImportState(value) {
  const state = normalizeString(value, "imported-readonly");
  if (state === "checkpointed-runnable") return "checkpoint-validated";
  return state;
}

function safeProblemList(entries) {
  return (Array.isArray(entries) ? entries : []).map((entry) => {
    const code = normalizeString(entry?.code, "unknown");
    if (code === "raw_auth_material_observed") {
      return {
        code,
        message: "Import contains auth-like material and cannot be materialized.",
        categories: ["authorization-header"],
      };
    }
    return {
      code,
      message: normalizeString(entry?.message, code),
    };
  });
}

function rendererSafeWorkspaceMatch(workspaceMatch = {}) {
  return {
    status: normalizeString(workspaceMatch.status, "unknown"),
    selectedProjectId: normalizeString(workspaceMatch.selectedProjectId, ""),
    selectedWorkspaceKind: normalizeString(workspaceMatch.selectedWorkspaceKind, "unknown"),
    sourceWorkspaceKindEvidence: normalizeString(workspaceMatch.sourceWorkspaceKindEvidence, "unknown"),
    matchMethod: normalizeString(workspaceMatch.matchMethod, "none"),
    confidence: normalizeString(workspaceMatch.confidence, "none"),
  };
}

function rendererSafeValidationReport(report = {}) {
  const source = isPlainObject(report.source) ? report.source : {};
  return {
    schema: normalizeString(report.schema, DIRECT_IMPORT_VALIDATION_REPORT_SCHEMA),
    reportId: normalizeString(report.reportId, ""),
    importId: normalizeString(report.lineage?.importId, ""),
    generatedAt: normalizeString(report.generatedAt, ""),
    state: canonicalImportState(report.state),
    source: {
      sourceDisplayName: normalizeString(source.sourceDisplayName, ""),
      sourceRootDisplayName: normalizeString(source.sourceRootDisplayName, ""),
      sourceClass: normalizeString(source.sourceClass, ""),
      sourceFileSizeBytes: Number(source.sourceFileSizeBytes || 0),
      sourceFileMtimeMs: Number(source.sourceFileMtimeMs || 0) || undefined,
      threadId: normalizeString(source.threadId, ""),
      timestampStart: normalizeString(source.timestampStart, ""),
      timestampEnd: normalizeString(source.timestampEnd, ""),
      recordCount: Number(source.recordCount || 0),
      rawPathExposed: false,
      rawSourceSha256Exposed: false,
    },
    workspaceMatch: rendererSafeWorkspaceMatch(report.workspaceMatch || {}),
    gates: isPlainObject(report.gates) ? report.gates : {},
    counts: isPlainObject(report.counts) ? report.counts : {},
    warnings: safeProblemList(report.warnings),
    blockers: safeProblemList(report.blockers),
    continuation: {
      eligible: canonicalImportState(report.state) === "checkpoint-validated",
      runnableNow: false,
      reason: canonicalImportState(report.state) === "checkpoint-validated"
        ? "future_checkpoint_continuation_only"
        : "imported_evidence_only",
    },
    rawPathExposed: false,
    rawRecordsExposed: false,
    rawSourceSha256Exposed: false,
  };
}

class DirectImportController {
  constructor(options = {}) {
    if (!options.sessionStore) throw new Error("DirectImportController requires a sessionStore.");
    this.sessionStore = options.sessionStore;
    this.projectResolver = typeof options.projectResolver === "function" ? options.projectResolver : null;
    this.liveTextController = typeof options.liveTextController === "function" ? options.liveTextController : null;
    this.checkpointContinuationEvidenceResolver = typeof options.checkpointContinuationEvidenceResolver === "function"
      ? options.checkpointContinuationEvidenceResolver
      : null;
    this.sourceHandles = new Map();
    this.handleSecret = options.handleSecret || crypto.randomBytes(32);
    this.seedIntegritySecret = options.seedIntegritySecret || this.handleSecret;
    this.activeCheckpointContinuations = new Map();
  }

  async resolveProject(projectOrId) {
    if (isPlainObject(projectOrId)) return projectOrId;
    if (this.projectResolver) return this.projectResolver(projectOrId);
    return { id: normalizeString(projectOrId, "") };
  }

  projectId(project = {}) {
    return normalizeString(project.id, "");
  }

  pruneExpiredHandles(nowMs = Date.now()) {
    for (const [handleId, handle] of this.sourceHandles.entries()) {
      if (Number(handle.expiresAtMs || 0) <= nowMs) this.sourceHandles.delete(handleId);
    }
  }

  sourceEvidenceKey(value) {
    return `source_${hmacSha256Hex(this.handleSecret, value).slice(0, 24)}`;
  }

  duplicateMatchedFor(sourceFileSha256, candidate = {}) {
    const index = this.sessionStore.recoverImportIndex
      ? this.sessionStore.recoverImportIndex({ write: false })
      : { imports: [] };
    const threadId = normalizeString(candidate.source?.threadId, "");
    const timestampStart = normalizeString(candidate.source?.timestampStart, "");
    const timestampEnd = normalizeString(candidate.source?.timestampEnd, "");
    return (Array.isArray(index.imports) ? index.imports : []).some((entry) =>
      entry.sourceFileSha256 === sourceFileSha256 &&
      (!threadId || entry.threadId === threadId) &&
      (!timestampStart || entry.timestampStart === timestampStart) &&
      (!timestampEnd || entry.timestampEnd === timestampEnd)
    );
  }

  liveController() {
    return this.liveTextController ? this.liveTextController() : null;
  }

  activeContinuationKey(projectId, importId) {
    return `${normalizeString(projectId, "")}:${normalizeString(importId, "")}`;
  }

  terminalContinuationState(value) {
    return ["completed", "failed", "aborted", "manual_resume_required"].includes(normalizeString(value, ""));
  }

  failStaleContinuation(importId, continuationId, previous = {}, failureKind = "restart_interrupted_checkpoint_continuation") {
    const now = new Date().toISOString();
    const failed = {
      ...previous,
      state: "failed",
      updatedAt: now,
      failure: {
        kind: failureKind,
        message: "Checkpoint continuation did not reach a terminal state and requires a new explicit attempt.",
        retryable: false,
      },
      terminalStateObserved: false,
    };
    if (this.sessionStore.writeImportContinuationArtifact) {
      this.sessionStore.writeImportContinuationArtifact(importId, continuationId, "continuation.json", failed);
    }
    return failed;
  }

  checkpointContinuationEvidence(project = {}, params = {}) {
    if (params.manualProbe === true || process.env.CODEX_DIRECT_IMPORT_CHECKPOINT_PROBE === "1") {
      return {
        accepted: true,
        status: "manual_probe",
        evidenceState: "runtime_probed",
        reason: "",
        manualProbe: true,
      };
    }
    if (!this.checkpointContinuationEvidenceResolver) {
      return {
        accepted: false,
        status: "profile_required",
        evidenceState: "unknown",
        reason: "checkpoint_request_shape_unaccepted",
      };
    }
    const evidence = this.checkpointContinuationEvidenceResolver({ project, params }) || {};
    const status = normalizeString(evidence.status, "");
    const expired = status === "expired" || evidence.expired === true;
    const accepted = !expired && (evidence.accepted === true || status === "accepted" || status === "runtime_probed");
    return {
      ...evidence,
      accepted,
      reason: accepted ? "" : normalizeString(evidence.reason, expired ? "checkpoint_continuation_evidence_expired" : "checkpoint_request_shape_unaccepted"),
    };
  }

  registerSourceHandle(projectOrId, params = {}) {
    const project = isPlainObject(projectOrId) ? projectOrId : { id: normalizeString(projectOrId, "") };
    const reference = params.prevalidated === true
      ? {
          sourcePath: safeSourcePath(params.sourcePath),
          sourceRoot: sourceRootRealPath(params.sourceRoot || path.dirname(params.sourcePath)),
        }
      : validateSourceReference(params.sourcePath, params.sourceRoot || path.dirname(params.sourcePath));
    const handleId = crypto.randomBytes(18).toString("base64url");
    const nowMs = Number(params.nowMs || Date.now());
    const stat = statSource(reference.sourcePath);
    const handle = {
      handleId,
      projectId: this.projectId(project),
      sourcePath: reference.sourcePath,
      sourceRoot: reference.sourceRoot,
      sourceSelectionMode: normalizeString(params.sourceSelectionMode, "explicit-configured-source-root"),
      createdAt: new Date(nowMs).toISOString(),
      expiresAtMs: nowMs + SOURCE_HANDLE_TTL_MS,
    };
    this.sourceHandles.set(handleId, handle);
    const sourceEvidenceKey = this.sourceEvidenceKey(`${reference.sourcePath}:${stat.size}:${stat.mtimeMs}`);
    return {
      ...rendererSafeSourceSummary(reference.sourcePath, reference.sourceRoot, {
        handleId,
        sourceEvidenceKey,
        sourceClass: params.sourceClass,
      }),
      expiresAt: new Date(handle.expiresAtMs).toISOString(),
      sourceSelectionMode: handle.sourceSelectionMode,
    };
  }

  async resolveSourceReference(projectOrId, params = {}) {
    const project = await this.resolveProject(projectOrId);
    this.pruneExpiredHandles(Number(params.nowMs || Date.now()));
    const handleId = normalizeString(params.handleId, "");
    if (handleId) {
      const handle = this.sourceHandles.get(handleId);
      if (!handle) {
        const error = new Error("Source selection expired. Choose the file again.");
        error.code = "source_handle_expired";
        throw error;
      }
      if (handle.projectId && handle.projectId !== this.projectId(project)) {
        const error = new Error("Source selection belongs to a different project.");
        error.code = "source_handle_project_mismatch";
        throw error;
      }
      const reference = validateSourceReference(handle.sourcePath, handle.sourceRoot);
      handle.sourcePath = reference.sourcePath;
      handle.sourceRoot = reference.sourceRoot;
      return handle;
    }
    const sourcePath = safeSourcePath(params.sourcePath);
    const reference = validateSourceReference(sourcePath, params.sourceRoot || path.dirname(sourcePath));
    return {
      handleId: "",
      projectId: this.projectId(project),
      sourcePath: reference.sourcePath,
      sourceRoot: reference.sourceRoot,
      sourceSelectionMode: normalizeString(params.sourceSelectionMode, "explicit-test-handle"),
    };
  }

  workspaceMatchForProject(project = {}, params = {}) {
    const explicit = isPlainObject(params.workspaceMatch) ? params.workspaceMatch : null;
    if (explicit) return explicit;
    const workspace = isPlainObject(project.workspace) ? project.workspace : {};
    const display = normalizeString(workspace.localPath || workspace.wslPath || project.workspaceDisplayPath, "");
    return {
      status: params.userConfirmedWorkspace === true ? "matched" : "unknown",
      selectedProjectId: normalizeString(project.id, ""),
      selectedWorkspaceKind: normalizeString(workspace.kind, "unknown"),
      selectedWorkspaceDisplay: display,
      sourceCwdDisplay: normalizeString(params.sourceCwdDisplay, ""),
      sourceCwdHash: "",
      sourceWorkspaceKindEvidence: "unknown",
      matchMethod: params.userConfirmedWorkspace === true ? "user-confirmed" : "none",
      confidence: params.userConfirmedWorkspace === true ? "high" : "none",
    };
  }

  async listSources(projectOrId, params = {}) {
    const project = await this.resolveProject(projectOrId);
    const sourceRoot = normalizeString(params.sourceRoot || params.sourcePath, "");
    if (!sourceRoot) {
      return {
        ok: false,
        error: "explicit_source_required",
        sources: [],
      };
    }
    const files = listJsonlFiles(sourceRoot, Number(params.limit || DEFAULT_SOURCE_LIST_LIMIT));
    const sourceRootReal = sourceRootRealPath(sourceRoot);
    return {
      ok: true,
      sourceRootDisplayName: path.basename(path.resolve(sourceRoot)),
      defaultCodexHomeScanned: false,
      sourceSelectionMode: normalizeString(params.sourceSelectionMode, "explicit-configured-source-root"),
      sources: files.map((filePath) => this.registerSourceHandle(project, {
        sourcePath: filePath,
        sourceRoot: sourceRootReal,
        sourceSelectionMode: normalizeString(params.sourceSelectionMode, "explicit-configured-source-root"),
        prevalidated: true,
      })),
    };
  }

  async inspectSource(projectOrId, params = {}) {
    const sourceRef = await this.resolveSourceReference(projectOrId, params);
    const { sourcePath } = sourceRef;
    const { stat, text, records, sourceFileSha256 } = readJsonlSource(sourcePath);
    const candidate = buildImportCandidate(records, {
      sourcePath,
      sourceRoot: sourceRef.sourceRoot,
      sourceFileSha256,
      sourceFileSizeBytes: stat.size,
      sourceFileMtimeMs: stat.mtimeMs,
    });
    return {
      ok: true,
      defaultCodexHomeScanned: false,
      sourceSelectionMode: sourceRef.sourceSelectionMode,
      source: {
        handleId: sourceRef.handleId,
        sourceDisplayName: candidate.source.sourceDisplayName,
        sourceRootDisplayName: candidate.source.sourceRootDisplayName,
        sourceClass: candidate.source.sourceClass,
        sourceFileSizeBytes: stat.size,
        sourceEvidenceKey: this.sourceEvidenceKey(`${sourcePath}:${stat.size}:${stat.mtimeMs}`),
        duplicateMatched: this.duplicateMatchedFor(sourceFileSha256, candidate),
        sourceFileMtimeMs: stat.mtimeMs,
        threadId: candidate.source.threadId,
        timestampStart: candidate.source.timestampStart,
        timestampEnd: candidate.source.timestampEnd,
        recordCount: records.length,
        sourcePath: "",
        rawPathExposed: false,
        rawSourceSha256Exposed: false,
      },
      caps: {
        maxImportFileBytes: MAX_IMPORT_FILE_BYTES,
        maxImportRecords: MAX_IMPORT_RECORDS,
      },
      rawSourceTextExposed: false,
      rawJsonlRecordsExposed: false,
      sourceBytesRead: Buffer.byteLength(text, "utf8"),
    };
  }

  async buildCandidate(projectOrId, params = {}) {
    const sourceRef = await this.resolveSourceReference(projectOrId, params);
    const { sourcePath } = sourceRef;
    const { stat, records, sourceFileSha256 } = readJsonlSource(sourcePath);
    const candidate = buildImportCandidate(records, {
      ...params,
      sourcePath,
      sourceRoot: sourceRef.sourceRoot,
      sourceFileSha256,
      sourceFileSizeBytes: stat.size,
      sourceFileMtimeMs: stat.mtimeMs,
    });
    if (this.sessionStore.writeImportArtifact) {
      this.sessionStore.writeImportArtifact(candidate.lineage.importId, "candidate.json", candidate);
    }
    return candidate;
  }

  async buildCheckpoint(projectOrId, params = {}) {
    const project = await this.resolveProject(projectOrId);
    const candidate = params.candidate || await this.buildCandidate(project, params);
    const checkpoint = buildDirectCheckpointCandidate(candidate, {
      ...params,
      workspaceMatch: this.workspaceMatchForProject(project, params),
    });
    const validation = validateDirectCheckpointCandidate(checkpoint, {
      ...params,
      workspaceMatch: this.workspaceMatchForProject(project, params),
    });
    if (this.sessionStore.writeImportArtifact) {
      this.sessionStore.writeImportArtifact(validation.lineage.importId, "candidate.json", candidate);
      this.sessionStore.writeImportArtifact(validation.lineage.importId, "checkpoint.json", validation);
      this.sessionStore.writeImportArtifact(validation.lineage.importId, "validation-report.json", validation.validationReport);
    }
    return validation;
  }

  async materialize(projectOrId, params = {}) {
    const project = await this.resolveProject(projectOrId);
    const checkpoint = params.checkpoint || await this.buildCheckpoint(project, params);
    const materialized = materializeDirectImportSession(checkpoint, {
      ...params,
      projectId: normalizeString(project.id, ""),
      sessionStore: this.sessionStore,
    });
    const session = this.sessionStore.readSession(materialized.sessionId);
    return {
      ...materialized,
      rendererSafeSession: buildRendererSafeImportSession(session),
    };
  }

  async readReport(projectOrId, params = {}) {
    const project = await this.resolveProject(projectOrId);
    const importId = normalizeString(params.importId, "");
    if (!importId) throw new Error("importId is required.");
    this.importEntryForProject(project, importId);
    const report = this.sessionStore.readImportArtifact
      ? this.sessionStore.readImportArtifact(importId, "validation-report.json")
      : null;
    return {
      ok: Boolean(report),
      report: report ? rendererSafeValidationReport(report) : null,
    };
  }

  async listImports(projectOrId, params = {}) {
    const project = await this.resolveProject(projectOrId);
    const projectId = this.projectId(project);
    const index = this.sessionStore.recoverImportIndex
      ? this.sessionStore.recoverImportIndex({ write: false })
      : { imports: [], recovery: {} };
    const includeHidden = params.includeHidden === true;
    const entries = [];
    for (const entry of Array.isArray(index.imports) ? index.imports : []) {
      if (!includeHidden && entry.hidden) continue;
      if (entry.projectId && projectId && entry.projectId !== projectId) continue;
      const report = this.sessionStore.readImportArtifact
        ? this.sessionStore.readImportArtifact(entry.importId, "validation-report.json")
        : null;
      const reportSummary = report ? rawSourceSummaryFromReport(report) : null;
      entries.push({
        importId: entry.importId,
        state: canonicalImportState(entry.state),
        recoveryState: normalizeString(entry.recoveryState, "healthy"),
        hidden: entry.hidden === true,
        hiddenAt: normalizeString(entry.hiddenAt, ""),
        sourceDisplayName: normalizeString(entry.sourceDisplayName, ""),
        sourceRootDisplayName: normalizeString(entry.sourceRootDisplayName, ""),
        threadId: normalizeString(entry.threadId, ""),
        timestampStart: normalizeString(entry.timestampStart, ""),
        timestampEnd: normalizeString(entry.timestampEnd, ""),
        recordCount: Number(entry.recordCount || 0),
        validationReportId: normalizeString(entry.validationReportId, ""),
        materializedSessionId: normalizeString(entry.materializedSessionId, ""),
        checkpointEligible: entry.checkpointEligible === true,
        continuation: {
          eligible: entry.checkpointEligible === true,
          runnableNow: !this.continuationBlockReason(project, entry, {}),
          reason: this.continuationBlockReason(project, entry, {}) ||
            (entry.checkpointEligible === true ? "checkpoint_continuation_ready" : "imported_evidence_only"),
        },
        source: reportSummary?.source || null,
        reportSummary: reportSummary
          ? {
              warningsCount: reportSummary.warningsCount,
              blockersCount: reportSummary.blockersCount,
              gates: reportSummary.gates,
            }
          : { warningsCount: 0, blockersCount: 0, gates: {} },
        composer: {
          enabled: false,
          reason: entry.checkpointEligible ? "checkpoint-validation-only" : "imported-readonly",
        },
        rawPathExposed: false,
        rawRecordsExposed: false,
        rawSourceSha256Exposed: false,
      });
    }
    return {
      ok: true,
      entries,
      recovery: index.recovery || {},
      rawPathExposed: false,
      rawRecordsExposed: false,
      rawSourceSha256Exposed: false,
    };
  }

  statusForProject(projectOrId) {
    const project = isPlainObject(projectOrId) ? projectOrId : { id: normalizeString(projectOrId, "") };
    const projectId = this.projectId(project);
    const index = this.sessionStore.recoverImportIndex
      ? this.sessionStore.recoverImportIndex({ write: false })
      : { imports: [], recovery: {} };
    const visible = (Array.isArray(index.imports) ? index.imports : []).filter((entry) =>
      !entry.hidden && (!entry.projectId || !projectId || entry.projectId === projectId)
    );
    const all = (Array.isArray(index.imports) ? index.imports : []).filter((entry) =>
      !entry.projectId || !projectId || entry.projectId === projectId
    );
    const countState = (state) => visible.filter((entry) => canonicalImportState(entry.state) === state).length;
    const continuationBlockReasons = {};
    let actionRunnable = 0;
    let actionAvailable = 0;
    let running = 0;
    let completed = 0;
    let failed = 0;
    for (const entry of visible) {
      if (!entry.checkpointEligible) continue;
      actionAvailable += 1;
      const reason = this.continuationBlockReason(project, entry, {});
      if (!reason) actionRunnable += 1;
      else continuationBlockReasons[reason] = Number(continuationBlockReasons[reason] || 0) + 1;
      if (this.sessionStore.listImportContinuationRecords) {
        for (const record of this.sessionStore.listImportContinuationRecords(entry.importId)) {
          const state = normalizeString(record.state, "");
          if (["seed_built", "session_created", "request_built", "streaming"].includes(state)) running += 1;
          else if (state === "completed") completed += 1;
          else if (state === "failed" || state === "aborted") failed += 1;
        }
      }
    }
    const latestUpdatedAt = all.reduce((latest, entry) => {
      const current = normalizeString(entry.updatedAt || entry.timestampEnd || entry.hiddenAt, "");
      return current > latest ? current : latest;
    }, "");
    return {
      available: true,
      sourceSelectionAvailable: true,
      importedSessionCount: visible.length,
      checkpointCandidateCount: countState("checkpoint-candidate"),
      checkpointValidatedCount: countState("checkpoint-validated"),
      validationFailedCount: countState("imported-validation-failed"),
      canceledCount: countState("import-canceled"),
      corruptedCount: visible.filter((entry) => entry.recoveryState === "corrupted").length,
      hiddenCount: all.filter((entry) => entry.hidden).length,
      continuationEligibleCount: visible.filter((entry) => entry.checkpointEligible).length,
      continuationRunnableNowCount: 0,
      checkpointContinuationActionAvailableCount: actionAvailable,
      checkpointContinuationActionRunnableNowCount: actionRunnable,
      checkpointContinuationRunningCount: running,
      checkpointContinuationCompletedCount: completed,
      checkpointContinuationFailedCount: failed,
      continuationBlockedReasons: continuationBlockReasons,
      lastImportUpdatedAt: latestUpdatedAt,
      rawPathsExposed: false,
      rawRecordsExposed: false,
      rawSourceSha256Exposed: false,
      recovery: index.recovery || {},
    };
  }

  importEntryForProject(project = {}, importId = "") {
    const index = this.sessionStore.recoverImportIndex
      ? this.sessionStore.recoverImportIndex({ write: false })
      : { imports: [] };
    const entry = (Array.isArray(index.imports) ? index.imports : []).find((item) => item.importId === importId);
    const projectId = this.projectId(project);
    if (entry?.projectId && projectId && entry.projectId !== projectId) {
      const error = new Error("Import record belongs to a different project.");
      error.code = "import_project_mismatch";
      throw error;
    }
    return entry || null;
  }

  async readImportSession(projectOrId, params = {}) {
    const project = await this.resolveProject(projectOrId);
    const importId = normalizeString(params.importId, "");
    if (!importId) throw new Error("importId is required.");
    const entry = this.importEntryForProject(project, importId);
    if (!entry?.materializedSessionId || !this.sessionStore.readSession) {
      return {
        ok: false,
        rendererSafeSession: null,
      };
    }
    const session = this.sessionStore.readSession(entry.materializedSessionId);
    return {
      ok: Boolean(session),
      rendererSafeSession: session ? buildRendererSafeImportSession(session) : null,
      rawPathExposed: false,
      rawRecordsExposed: false,
      rawSourceSha256Exposed: false,
    };
  }

  continuationBlockReason(project = {}, entry = {}, params = {}) {
    if (!entry) return "missing_import";
    if (canonicalImportState(entry.state) !== "checkpoint-validated") return "import_not_checkpoint_validated";
    if (entry.hidden) return "import_hidden";
    if (entry.recoveryState !== "healthy") return entry.recoveryState === "corrupted" ? "import_corrupted" : "import_recovery_not_healthy";
    if (!entry.materializedSessionId) return "validation_report_missing";
    const report = this.sessionStore.readImportArtifact
      ? this.sessionStore.readImportArtifact(entry.importId, "validation-report.json")
      : null;
    if (!report) return "validation_report_missing";
    const session = this.sessionStore.readSession ? this.sessionStore.readSession(entry.materializedSessionId) : null;
    if (!session) return "import_corrupted";
    if (session.readOnlyImported !== true || session.nativeDirectSession === true) return "unsupported_import_kind";
    const workspaceMatch = report.workspaceMatch || {};
    const workspaceMatched = workspaceMatch.status === "matched" &&
      (workspaceMatch.confidence === "high" || workspaceMatch.matchMethod === "user-confirmed");
    if (!workspaceMatched) return "workspace_mismatch";
    const live = this.liveController();
    const liveStatus = live?.statusForProject ? live.statusForProject(project) : null;
    if (!liveStatus || liveStatus.status === "auth_required") return "direct_auth_required";
    if (liveStatus.status !== "ready") return liveStatus.reason || "live_text_unavailable";
    const evidence = this.checkpointContinuationEvidence(project, params);
    if (!evidence.accepted) return evidence.reason || "checkpoint_request_shape_unaccepted";
    return "";
  }

  async previewCheckpointContinuation(projectOrId, params = {}) {
    const project = await this.resolveProject(projectOrId);
    const importId = normalizeString(params.importId, "");
    if (!importId) throw new Error("importId is required.");
    const entry = this.importEntryForProject(project, importId);
    const blockReason = this.continuationBlockReason(project, entry, params);
    if (!entry?.materializedSessionId) {
      return { ok: false, blockReason: blockReason || "missing_import", seedPreview: null };
    }
    const session = this.sessionStore.readSession(entry.materializedSessionId);
    const report = this.sessionStore.readImportArtifact(importId, "validation-report.json");
    const checkpoint = this.sessionStore.readImportArtifact(importId, "checkpoint.json");
    const seed = buildDirectImportCheckpointSeed({
      importId,
      projectId: this.projectId(project),
      importSession: session,
      validationReport: report,
      checkpoint,
      userPromptText: params.userPromptText,
    }, {
      integritySecret: this.seedIntegritySecret,
      profileId: normalizeString(project.surfaceBinding?.codex?.profileId, ""),
      profileHash: normalizeString(params.profileHash, ""),
    });
    return {
      ok: !blockReason,
      blockReason,
      seedPreview: rendererSafeCheckpointSeedPreview(seed, blockReason),
      rawPathExposed: false,
      rawRecordsExposed: false,
      rawSourceSha256Exposed: false,
    };
  }

  async startCheckpointContinuation(projectOrId, params = {}) {
    const project = await this.resolveProject(projectOrId);
    const projectId = this.projectId(project);
    const importId = normalizeString(params.importId, "");
    const clientCheckpointContinuationId = normalizeString(params.clientCheckpointContinuationId, "");
    if (!importId) throw new Error("importId is required.");
    if (!clientCheckpointContinuationId) {
      const error = new Error("clientCheckpointContinuationId is required.");
      error.code = "missing_client_checkpoint_continuation_id";
      throw error;
    }
    const entry = this.importEntryForProject(project, importId);
    const activeKey = this.activeContinuationKey(projectId, importId);
    const activeProjectPrefix = `${projectId}:`;
    for (const [key, active] of this.activeCheckpointContinuations.entries()) {
      if (active.clientCheckpointContinuationId === clientCheckpointContinuationId && active.importId === importId) {
        return active.promise;
      }
      if (key.startsWith(activeProjectPrefix)) {
        const error = new Error("Project already has an active checkpoint continuation.");
        error.code = "active_checkpoint_continuation_exists";
        error.continuationId = active.continuationId;
        throw error;
      }
    }
    const blockReason = this.continuationBlockReason(project, entry, params);
    if (blockReason) {
      const error = new Error(`Checkpoint continuation blocked: ${blockReason}`);
      error.code = blockReason;
      throw error;
    }
    const continuationId = `checkpoint_continuation_${crypto.createHash("sha256").update(`${importId}:${clientCheckpointContinuationId}`).digest("hex").slice(0, 20)}`;
    const previous = this.sessionStore.readImportContinuationArtifact
      ? this.sessionStore.readImportContinuationArtifact(importId, continuationId, "continuation.json")
      : null;
    if (previous) {
      const reusable = this.terminalContinuationState(previous.state)
        ? previous
        : this.failStaleContinuation(importId, continuationId, previous);
      return { ok: reusable.state === "completed", reused: true, continuation: reusable };
    }
    const run = this._startCheckpointContinuation(project, {
      ...params,
      importId,
      continuationId,
      clientCheckpointContinuationId,
      entry,
    }).finally(() => {
      const active = this.activeCheckpointContinuations.get(activeKey);
      if (active?.promise === run) this.activeCheckpointContinuations.delete(activeKey);
    });
    this.activeCheckpointContinuations.set(activeKey, {
      importId,
      continuationId,
      clientCheckpointContinuationId,
      promise: run,
    });
    return run;
  }

  async _startCheckpointContinuation(project = {}, params = {}) {
    const importId = params.importId;
    const session = this.sessionStore.readSession(params.entry.materializedSessionId);
    const report = this.sessionStore.readImportArtifact(importId, "validation-report.json");
    const checkpoint = this.sessionStore.readImportArtifact(importId, "checkpoint.json");
    const seed = buildDirectImportCheckpointSeed({
      importId,
      projectId: this.projectId(project),
      importSession: session,
      validationReport: report,
      checkpoint,
      userPromptText: params.userPromptText,
    }, {
      integritySecret: this.seedIntegritySecret,
      profileId: normalizeString(project.surfaceBinding?.codex?.profileId, ""),
      profileHash: normalizeString(params.profileHash, ""),
    });
    const now = new Date().toISOString();
    const recordBase = {
      schema: DIRECT_IMPORT_CHECKPOINT_CONTINUATION_SCHEMA,
      continuationId: params.continuationId,
      clientCheckpointContinuationId: params.clientCheckpointContinuationId,
      projectId: this.projectId(project),
      importId,
      seedId: seed.seedId,
      state: "seed_built",
      createdAt: now,
      updatedAt: now,
      createdSessionId: "",
      createdTurnId: "",
      importedSessionId: seed.materializedSessionId,
      checkpointSeedId: seed.seedId,
      seedShapeHash: seed.seedShapeHash,
      requestShapeHash: seed.requestShapeHash,
      model: normalizeString(params.model, ""),
      parentImportLineage: session.importLineage || report.lineage || {},
      terminalStateObserved: false,
      appServerRequired: false,
      previousResponseIdFromImportUsed: false,
      importedToolReplayAttempted: false,
      rightPaneModified: false,
    };
    this.sessionStore.writeImportContinuationArtifact(importId, params.continuationId, "seed.json", seed);
    this.sessionStore.writeImportContinuationArtifact(importId, params.continuationId, "continuation.json", recordBase);
    const live = this.liveController();
    if (!live?.runImportCheckpointContinuation) {
      const error = new Error("Direct live text controller is unavailable.");
      error.code = "live_text_unavailable";
      throw error;
    }
    this.sessionStore.writeImportContinuationArtifact(importId, params.continuationId, "request-shape.json", {
      requestShapeHash: seed.requestShapeHash,
      seedShapeHash: seed.seedShapeHash,
      previousResponseIdFromImportUsed: false,
      importedToolReplayAttempted: false,
    });
    try {
      const result = await live.runImportCheckpointContinuation({
        project,
        seed,
        continuationId: params.continuationId,
        clientCheckpointContinuationId: params.clientCheckpointContinuationId,
        parentImportLineage: recordBase.parentImportLineage,
        model: params.model,
      });
      const terminalState = result.turnState || result.terminal?.state || "failed";
      const completedAt = new Date().toISOString();
      const finalRecord = {
        ...recordBase,
        state: terminalState === "completed" ? "completed" : "failed",
        updatedAt: completedAt,
        createdSessionId: result.sessionId || "",
        createdTurnId: result.turnId || "",
        model: normalizeString(result.model || params.model || seed.source?.model, ""),
        failure: terminalState === "completed"
          ? undefined
          : {
              kind: normalizeString(result.terminal?.error?.code || result.error?.code, "other"),
              message: normalizeString(result.terminal?.error?.message || result.error?.message, "Checkpoint continuation failed."),
              retryable: false,
            },
        terminalStateObserved: true,
      };
      this.sessionStore.writeImportContinuationArtifact(importId, params.continuationId, "continuation.json", finalRecord);
      this.sessionStore.recoverImportIndex({ write: true });
      return {
        ok: finalRecord.state === "completed",
        reused: false,
        continuation: finalRecord,
        seedPreview: rendererSafeCheckpointSeedPreview(seed, finalRecord.state === "completed" ? "" : finalRecord.failure?.kind || "failed"),
        sessionId: result.sessionId,
        turnId: result.turnId,
        terminal: result.terminal || null,
        rawPathExposed: false,
        rawRecordsExposed: false,
        rawSourceSha256Exposed: false,
      };
    } catch (error) {
      const failed = {
        ...recordBase,
        state: "failed",
        updatedAt: new Date().toISOString(),
        failure: {
          kind: normalizeString(error?.code, "other"),
          message: normalizeString(error?.message, "Checkpoint continuation failed before terminal state."),
          retryable: false,
        },
        terminalStateObserved: false,
      };
      this.sessionStore.writeImportContinuationArtifact(importId, params.continuationId, "continuation.json", failed);
      throw error;
    }
  }

  async hideImport(projectOrId, params = {}) {
    const project = await this.resolveProject(projectOrId);
    const importId = normalizeString(params.importId, "");
    if (!importId) return { ok: false, error: "missing_import_id" };
    if (!this.importEntryForProject(project, importId)) return { ok: false, error: "missing_import" };
    if (!this.sessionStore.setImportHidden) return { ok: false, error: "hide_unavailable" };
    const hidden = this.sessionStore.setImportHidden(importId, true);
    return { ok: true, hidden: true, importId, hiddenAt: hidden.hiddenAt };
  }

  async unhideImport(projectOrId, params = {}) {
    const project = await this.resolveProject(projectOrId);
    const importId = normalizeString(params.importId, "");
    if (!importId) return { ok: false, error: "missing_import_id" };
    if (!this.importEntryForProject(project, importId)) return { ok: false, error: "missing_import" };
    if (!this.sessionStore.setImportHidden) return { ok: false, error: "unhide_unavailable" };
    this.sessionStore.setImportHidden(importId, false);
    return { ok: true, hidden: false, importId };
  }

  async cancelImport(_projectOrId, params = {}) {
    const importId = normalizeString(params.importId, "");
    if (!importId) return { ok: false, error: "missing_import_id" };
    const report = {
      schema: DIRECT_IMPORT_VALIDATION_REPORT_SCHEMA,
      reportId: `validation_report_${importId}_canceled`,
      lineage: {
        importId,
        sourceId: "",
        candidateId: "",
        validationReportId: `validation_report_${importId}_canceled`,
        attemptNumber: 1,
      },
      generatedAt: new Date().toISOString(),
      state: "import-canceled",
      gates: {},
      counts: {},
      warnings: [],
      blockers: [{ code: "import_canceled", message: "User canceled import before materialization." }],
    };
    if (this.sessionStore.writeImportArtifact) {
      this.sessionStore.writeImportArtifact(importId, "validation-report.json", report);
    }
    return { ok: true, state: "import-canceled", report };
  }
}

module.exports = {
  DirectImportController,
  rendererSafeValidationReport,
};
