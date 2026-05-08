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
    this.sourceHandles = new Map();
    this.handleSecret = options.handleSecret || crypto.randomBytes(32);
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
      ? this.sessionStore.recoverImportIndex({ write: true })
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

  registerSourceHandle(projectOrId, params = {}) {
    const project = isPlainObject(projectOrId) ? projectOrId : { id: normalizeString(projectOrId, "") };
    const reference = validateSourceReference(params.sourcePath, params.sourceRoot || path.dirname(params.sourcePath));
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
    return {
      ok: true,
      sourceRootDisplayName: path.basename(path.resolve(sourceRoot)),
      defaultCodexHomeScanned: false,
      sourceSelectionMode: normalizeString(params.sourceSelectionMode, "explicit-configured-source-root"),
      sources: files.map((filePath) => this.registerSourceHandle(project, {
        sourcePath: filePath,
        sourceRoot,
        sourceSelectionMode: normalizeString(params.sourceSelectionMode, "explicit-configured-source-root"),
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
        sourceEvidenceKey: this.sourceEvidenceKey(sourceFileSha256),
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
      ? this.sessionStore.recoverImportIndex({ write: true })
      : { imports: [], recovery: {} };
    const includeHidden = params.includeHidden === true;
    const entries = [];
    for (const entry of Array.isArray(index.imports) ? index.imports : []) {
      if (!includeHidden && entry.hidden) continue;
      if (entry.projectId && projectId && entry.projectId !== projectId) continue;
      let rendererSafeSession = null;
      if (entry.materializedSessionId && this.sessionStore.readSession) {
        rendererSafeSession = buildRendererSafeImportSession(this.sessionStore.readSession(entry.materializedSessionId) || {});
      }
      const report = this.sessionStore.readImportArtifact
        ? this.sessionStore.readImportArtifact(entry.importId, "validation-report.json")
        : null;
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
          runnableNow: false,
          reason: entry.checkpointEligible === true ? "future_checkpoint_continuation_only" : "imported_evidence_only",
        },
        source: rendererSafeSession?.source || (report ? rendererSafeValidationReport(report).source : null),
        reportSummary: rendererSafeSession?.reportSummary || (report ? {
          warningsCount: Array.isArray(report.warnings) ? report.warnings.length : 0,
          blockersCount: Array.isArray(report.blockers) ? report.blockers.length : 0,
          gates: isPlainObject(report.gates) ? report.gates : {},
        } : { warningsCount: 0, blockersCount: 0, gates: {} }),
        composer: {
          enabled: false,
          reason: entry.checkpointEligible ? "live-continuation-not-implemented" : "imported-readonly",
        },
        rendererSafeSession,
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
      ? this.sessionStore.recoverImportIndex({ write: true })
      : { imports: [], recovery: {} };
    const visible = (Array.isArray(index.imports) ? index.imports : []).filter((entry) =>
      !entry.hidden && (!entry.projectId || !projectId || entry.projectId === projectId)
    );
    const all = (Array.isArray(index.imports) ? index.imports : []).filter((entry) =>
      !entry.projectId || !projectId || entry.projectId === projectId
    );
    const countState = (state) => visible.filter((entry) => canonicalImportState(entry.state) === state).length;
    const latestUpdatedAt = all
      .map((entry) => normalizeString(entry.updatedAt || entry.timestampEnd || entry.hiddenAt, ""))
      .filter(Boolean)
      .sort()
      .pop() || "";
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
      lastImportUpdatedAt: latestUpdatedAt,
      rawPathsExposed: false,
      rawRecordsExposed: false,
      rawSourceSha256Exposed: false,
      recovery: index.recovery || {},
    };
  }

  importEntryForProject(project = {}, importId = "") {
    const index = this.sessionStore.recoverImportIndex
      ? this.sessionStore.recoverImportIndex({ write: true })
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
