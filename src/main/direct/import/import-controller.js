"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { parseJsonl } = require("../fixtures/fixture-loader");
const {
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_RECORDS,
  buildDirectCheckpointCandidate,
  buildImportCandidate,
  buildRendererSafeImportSession,
  materializeDirectImportSession,
  validateDirectCheckpointCandidate,
} = require("./codex-jsonl-import");

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeSourcePath(value) {
  const text = normalizeString(value, "");
  if (!text) throw new Error("Direct import source path is required.");
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

function rendererSafeSourceSummary(filePath, sourceRoot = "") {
  const stat = statSource(filePath);
  return {
    sourcePath: filePath,
    sourceDisplayName: path.basename(filePath),
    sourceRootDisplayName: sourceRoot ? path.basename(sourceRoot) : "",
    sourceFileSizeBytes: stat.size,
    sourceFileMtimeMs: stat.mtimeMs,
  };
}

function listJsonlFiles(sourceRoot, limit = 200) {
  const root = path.resolve(sourceRoot);
  const stat = fs.statSync(root);
  if (stat.isFile()) return [root];
  if (!stat.isDirectory()) throw new Error("Direct import source root must be a directory or JSONL file.");
  const results = [];
  const stack = [root];
  while (stack.length && results.length < limit) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".")) stack.push(fullPath);
      if (entry.isFile() && entry.name.endsWith(".jsonl")) results.push(fullPath);
      if (results.length >= limit) break;
    }
  }
  return results.sort();
}

class DirectImportController {
  constructor(options = {}) {
    if (!options.sessionStore) throw new Error("DirectImportController requires a sessionStore.");
    this.sessionStore = options.sessionStore;
    this.projectResolver = typeof options.projectResolver === "function" ? options.projectResolver : null;
  }

  async resolveProject(projectOrId) {
    if (isPlainObject(projectOrId)) return projectOrId;
    if (this.projectResolver) return this.projectResolver(projectOrId);
    return { id: normalizeString(projectOrId, "") };
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
    await this.resolveProject(projectOrId);
    const sourceRoot = normalizeString(params.sourceRoot || params.sourcePath, "");
    if (!sourceRoot) {
      return {
        ok: false,
        error: "explicit_source_required",
        sources: [],
      };
    }
    const files = listJsonlFiles(sourceRoot, Number(params.limit || 200));
    return {
      ok: true,
      sourceRootDisplayName: path.basename(path.resolve(sourceRoot)),
      defaultCodexHomeScanned: false,
      sources: files.map((filePath) => {
        const summary = rendererSafeSourceSummary(filePath, path.resolve(sourceRoot));
        return {
          sourceDisplayName: summary.sourceDisplayName,
          sourceRootDisplayName: summary.sourceRootDisplayName,
          sourceFileSizeBytes: summary.sourceFileSizeBytes,
          sourceFileMtimeMs: summary.sourceFileMtimeMs,
          sourcePath: "",
        };
      }),
    };
  }

  async inspectSource(projectOrId, params = {}) {
    await this.resolveProject(projectOrId);
    const sourcePath = safeSourcePath(params.sourcePath);
    const { stat, text, records, sourceFileSha256 } = readJsonlSource(sourcePath);
    const candidate = buildImportCandidate(records, {
      sourcePath,
      sourceRoot: params.sourceRoot || path.dirname(sourcePath),
      sourceFileSha256,
      sourceFileSizeBytes: stat.size,
      sourceFileMtimeMs: stat.mtimeMs,
    });
    return {
      ok: true,
      defaultCodexHomeScanned: false,
      source: {
        sourceDisplayName: candidate.source.sourceDisplayName,
        sourceRootDisplayName: candidate.source.sourceRootDisplayName,
        sourceClass: candidate.source.sourceClass,
        sourceFileSizeBytes: stat.size,
        sourceFileSha256,
        sourceFileMtimeMs: stat.mtimeMs,
        threadId: candidate.source.threadId,
        timestampStart: candidate.source.timestampStart,
        timestampEnd: candidate.source.timestampEnd,
        recordCount: records.length,
        sourcePath: "",
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
    await this.resolveProject(projectOrId);
    const sourcePath = safeSourcePath(params.sourcePath);
    const { stat, records, sourceFileSha256 } = readJsonlSource(sourcePath);
    const candidate = buildImportCandidate(records, {
      ...params,
      sourcePath,
      sourceRoot: params.sourceRoot || path.dirname(sourcePath),
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

  async readReport(_projectOrId, params = {}) {
    const importId = normalizeString(params.importId, "");
    if (!importId) throw new Error("importId is required.");
    const report = this.sessionStore.readImportArtifact
      ? this.sessionStore.readImportArtifact(importId, "validation-report.json")
      : null;
    return {
      ok: Boolean(report),
      report,
    };
  }

  async cancelImport(_projectOrId, params = {}) {
    const importId = normalizeString(params.importId, "");
    if (!importId) return { ok: false, error: "missing_import_id" };
    const report = {
      schema: "direct_codex_import_validation_report@1",
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
};
