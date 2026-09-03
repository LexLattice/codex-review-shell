"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const {
  authorizeDirectThreadHarnessCapability,
  validateDirectThreadHarnessGrant,
} = require("../authority/direct-thread-harness-grant");

const MAX_READ_FILE_BYTES = 384 * 1024;
const MAX_PATCH_TARGET_BYTES = 384 * 1024;
const MAX_PATCH_TEXT_CHARS = 256 * 1024;
const MAX_PATCH_FILES = 16;
const MAX_PATCH_LINES = 4000;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedString(value, max = 320) {
  const text = typeof value === "string" ? value : "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
}

function localError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function splitLines(text) {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n");
  const hasFinalNewline = normalized.endsWith("\n");
  const lines = normalized.split("\n");
  if (hasFinalNewline) lines.pop();
  return { lines, hasFinalNewline };
}

function pathText(value, label = "path") {
  const text = normalizeString(value, "").replace(/\\/g, "/");
  if (!text || text.length > 4096 || /[\0-\x1f\x7f]/.test(text)) {
    throw localError("direct_full_access_path_invalid", `${label} is empty or contains control characters.`);
  }
  return text;
}

function patchPath(value) {
  let text = pathText(value, "patch target").replace(/^a\//, "").replace(/^b\//, "");
  if (text === "/dev/null") return text;
  if (text.length >= 2 && text.startsWith("\"") && text.endsWith("\"")) {
    text = text.slice(1, -1).replace(/\\([\\"])/g, "$1");
  }
  return text;
}

function parseHunkHeader(line) {
  const match = /^@@(?: -(\d+)(?:,(\d+))?)?(?: \+(\d+)(?:,(\d+))?)? @@/.exec(line);
  if (!match) throw localError("direct_full_access_patch_invalid", "Patch hunk header is malformed.");
  return {
    oldStart: Number(match[1] || 1),
    oldCount: Number(match[2] ?? (match[1] ? 1 : 0)),
    newStart: Number(match[3] || 1),
    newCount: Number(match[4] ?? (match[3] ? 1 : 0)),
    lines: [],
  };
}

function parseUnifiedPatch(patchText) {
  const text = String(patchText ?? "");
  if (!text.trim() || text.length > MAX_PATCH_TEXT_CHARS) {
    throw localError("direct_full_access_patch_invalid", "Patch text is empty or exceeds the configured bound.");
  }
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const files = [];
  if (lines[0] === "*** Begin Patch") {
    let index = 1;
    while (index < lines.length) {
      const marker = lines[index];
      if (marker === "*** End Patch" || marker === "") break;
      const operation = marker.startsWith("*** Add File: ")
        ? "create"
        : marker.startsWith("*** Delete File: ")
          ? "delete"
          : marker.startsWith("*** Update File: ")
            ? "update"
            : "";
      if (!operation) {
        index += 1;
        continue;
      }
      const relPath = patchPath(marker.slice(marker.indexOf(":") + 1));
      index += 1;
      const hunks = [];
      while (index < lines.length && !lines[index].startsWith("*** ")) {
        if (lines[index].startsWith("@@")) {
          const hunk = parseHunkHeader(lines[index]);
          index += 1;
          while (index < lines.length && !lines[index].startsWith("@@") && !lines[index].startsWith("*** ")) {
            if (lines[index] !== "\\ No newline at end of file") hunk.lines.push(lines[index]);
            index += 1;
          }
          hunks.push(hunk);
          continue;
        }
        if (operation === "create" && (lines[index].startsWith("+") || lines[index] === "")) {
          const hunk = hunks[0] || { oldStart: 0, oldCount: 0, newStart: 1, newCount: 0, lines: [] };
          if (!hunks.length) hunks.push(hunk);
          hunk.lines.push(lines[index] === "" ? "+" : lines[index]);
        }
        index += 1;
      }
      files.push({ operation, relPath, hunks });
    }
  } else {
    let index = 0;
    while (index < lines.length) {
      if (!lines[index].startsWith("--- ")) {
        index += 1;
        continue;
      }
      const oldPath = lines[index].slice(4).split("\t")[0];
      const newHeader = lines[index + 1] || "";
      if (!newHeader.startsWith("+++ ")) throw localError("direct_full_access_patch_invalid", "Patch file header is incomplete.");
      const newPath = newHeader.slice(4).split("\t")[0];
      const operation = oldPath === "/dev/null" ? "create" : newPath === "/dev/null" ? "delete" : "update";
      const relPath = patchPath(operation === "create" ? newPath : oldPath);
      index += 2;
      const hunks = [];
      while (index < lines.length && !lines[index].startsWith("--- ")) {
        if (lines[index] === "" && index === lines.length - 1) {
          index += 1;
          break;
        }
        if (lines[index].startsWith("@@")) {
          const hunk = parseHunkHeader(lines[index]);
          index += 1;
          while (index < lines.length && !lines[index].startsWith("@@") && !lines[index].startsWith("--- ")) {
            if (lines[index] === "" && index === lines.length - 1) {
              index += 1;
              break;
            }
            if (lines[index] !== "\\ No newline at end of file") hunk.lines.push(lines[index]);
            index += 1;
          }
          hunks.push(hunk);
          continue;
        }
        index += 1;
      }
      files.push({ operation, relPath, hunks });
    }
  }
  if (!files.length || files.length > MAX_PATCH_FILES) {
    throw localError("direct_full_access_patch_invalid", "Patch contains no files or exceeds the file bound.");
  }
  return files;
}

function findHunkStart(before, hunk, preferred) {
  const wanted = hunk.lines.filter((line) => line[0] !== "+").map((line) => line.slice(1));
  const matches = (start) => wanted.every((line, offset) => before[start + offset] === line);
  if (matches(preferred)) return preferred;
  for (let start = 0; start <= before.length - wanted.length; start += 1) {
    if (matches(start)) return start;
  }
  throw localError("direct_full_access_patch_conflict", "Patch hunk does not match the selected local file.");
}

function applyHunks(before, hunks, operation) {
  if (operation === "create") {
    const additions = hunks.flatMap((hunk) => hunk.lines).filter((line) => line.startsWith("+")).map((line) => line.slice(1));
    if (additions.length > MAX_PATCH_LINES) throw localError("direct_full_access_patch_invalid", "Patch changes exceed the configured line bound.");
    return additions;
  }
  let result = [...before];
  let cursor = 0;
  let changed = 0;
  for (const hunk of hunks) {
    const preferred = Math.max(0, (hunk.oldStart || 1) - 1);
    const start = findHunkStart(result, hunk, Math.max(cursor, preferred));
    const oldLines = hunk.lines.filter((line) => line[0] !== "+").map((line) => line.slice(1));
    const newLines = hunk.lines.filter((line) => line[0] !== "-").map((line) => line.slice(1));
    result.splice(start, oldLines.length, ...newLines);
    cursor = start + newLines.length;
    changed += hunk.lines.filter((line) => line.startsWith("+") || line.startsWith("-")).length;
  }
  if (changed > MAX_PATCH_LINES) throw localError("direct_full_access_patch_invalid", "Patch changes exceed the configured line bound.");
  return result;
}

function safePathEvidence(target) {
  return `selected_local_path_${sha256(target).slice(0, 24)}`;
}

class DirectFullAccessLocalEnvironmentExecutor {
  constructor(options = {}) {
    this.grantStore = options.grantStore || null;
    this.workspaceRootResolver = typeof options.workspaceRootResolver === "function"
      ? options.workspaceRootResolver
      : (input = {}) => input.workspaceRoot || input.project?.workspaceRoot || "";
  }

  resolveGrant(input = {}, capabilityName) {
    const supplied = isPlainObject(input.harnessGrant) ? input.harnessGrant : null;
    const taskId = normalizeString(input.taskId || input.threadId, "");
    const threadId = normalizeString(input.threadId || input.taskId, taskId);
    const projectId = normalizeString(input.projectId || input.project?.id || input.project?.projectId, "");
    const environmentDigest = normalizeString(input.executionEnvironmentDigest || supplied?.executionEnvironmentDigest, "");
    if (!taskId || !threadId || !projectId || !environmentDigest) {
      throw localError("direct_full_access_scope_mismatch", "Full-access file execution requires exact task, thread, project, and environment binding.");
    }
    const expected = { taskId, threadId, projectId, executionEnvironmentDigest: environmentDigest };
    const grantId = normalizeString(input.grantId || supplied?.grantId, "");
    let grant = supplied;
    if (this.grantStore && grantId && typeof this.grantStore.reconstruct === "function") {
      try { grant = this.grantStore.reconstruct(grantId, { ...expected, grantId, requireCurrent: true }); } catch { grant = null; }
    } else if (this.grantStore && typeof this.grantStore.currentForScope === "function") {
      try { grant = this.grantStore.currentForScope(expected); } catch { grant = null; }
    }
    const errors = grant ? validateDirectThreadHarnessGrant(grant, { ...expected, requireCurrent: true }) : ["grant_missing"];
    if (errors.length || grant?.sandboxMode !== "danger-full-access" || grant?.executionEnvironment?.kind !== "local") {
      throw localError(errors.includes("grant_missing") ? "direct_full_access_grant_missing" : "direct_full_access_grant_not_current", "The exact current local full-access grant is required.");
    }
    const authorization = this.grantStore?.authorize && grant.grantId
      ? this.grantStore.authorize(grant.grantId, capabilityName, expected)
      : authorizeDirectThreadHarnessCapability(grant, capabilityName, { ...expected, runtimeAdmittedCapabilityNames: [capabilityName] });
    if (!authorization?.authorized) throw localError(authorization?.reason || "direct_full_access_capability_not_authorized", "The current task grant does not authorize this local capability.");
    return { grant, expected, authorization };
  }

  resolveTarget(input, grant, rawPath, label) {
    const rootCandidate = this.workspaceRootResolver(input, grant.executionEnvironment);
    if (!rootCandidate || !fs.existsSync(String(rootCandidate))) throw localError("direct_full_access_environment_unavailable", "The selected local execution environment is unavailable.");
    const root = path.resolve(String(rootCandidate));
    const text = pathText(rawPath, label);
    const target = path.resolve(path.isAbsolute(text) ? text : path.join(root, text));
    return { root, target, pathEvidenceKey: safePathEvidence(target) };
  }

  async request(input = {}, method, params = {}) {
    const capability = method === "readFile" ? "read_file" : "apply_patch";
    const { grant, expected, authorization } = this.resolveGrant(input, capability);
    if (method === "readFile") return this.readFile(input, params, grant, expected, authorization);
    if (method === "applyPatch") return this.applyPatch(input, params, grant, expected, authorization);
    throw localError("direct_full_access_method_invalid", `Unsupported full-access local method: ${method}`);
  }

  async readFile(input, params, grant, expected, authorization) {
    const resolved = this.resolveTarget(input, grant, params.relPath || params.path, "read_file path");
    let handle;
    try {
      handle = await fsp.open(resolved.target, "r");
    } catch {
      throw localError("direct_full_access_file_unavailable", "The selected local file is unavailable.");
    }
    try {
      const initialStat = await handle.stat();
      if (!initialStat.isFile()) throw localError("direct_full_access_file_invalid", "The selected local path is not a regular file.");
      const requestedBytes = Number(params.maxBytes);
      const maxBytes = Math.min(
        Number.isFinite(requestedBytes) && requestedBytes > 0 ? Math.floor(requestedBytes) : MAX_READ_FILE_BYTES,
        MAX_READ_FILE_BYTES,
      );
      const buffer = Buffer.alloc(maxBytes);
      let bytesRead = 0;
      while (bytesRead < maxBytes) {
        const readResult = await handle.read(buffer, bytesRead, maxBytes - bytesRead, bytesRead);
        if (!readResult.bytesRead) break;
        bytesRead += readResult.bytesRead;
      }
      const finalStat = await handle.stat();
      const limited = buffer.subarray(0, bytesRead);
      const binary = limited.includes(0);
      return {
        schema: "workspace_read_file_result@1",
        relPath: resolved.pathEvidenceKey,
        pathEvidenceKey: resolved.pathEvidenceKey,
        text: binary ? "" : limited.toString("utf8"),
        size: finalStat.size,
        truncated: finalStat.size > bytesRead,
        binary,
        source: "direct_full_access_local_environment",
        grantId: grant.grantId,
        grantRevision: Number(grant.grantRevision),
        executionEnvironmentDigest: expected.executionEnvironmentDigest,
        authorizationMode: authorization.authorityMode || "full_access_task_grant",
        rawPathIncluded: false,
      };
    } finally {
      await handle.close().catch(() => {});
    }
  }

  async readPatchTarget(target, operation) {
    let handle;
    try {
      handle = await fsp.open(target, "r");
    } catch (error) {
      if (operation === "create" && error?.code === "ENOENT") return { exists: false, bytes: Buffer.alloc(0) };
      throw localError("direct_full_access_patch_target_unavailable", "The selected local patch target is unavailable.");
    }
    try {
      const initialStat = await handle.stat();
      if (!initialStat.isFile()) throw localError("direct_full_access_patch_target_invalid", "The selected local patch target is not a regular file.");
      if (initialStat.size > MAX_PATCH_TARGET_BYTES) throw localError("direct_full_access_patch_target_oversized", "The selected local patch target exceeds the bounded patch input limit.");
      const buffer = Buffer.alloc(MAX_PATCH_TARGET_BYTES + 1);
      let bytesRead = 0;
      while (bytesRead < buffer.length) {
        const result = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
        if (!result.bytesRead) break;
        bytesRead += result.bytesRead;
      }
      const finalStat = await handle.stat();
      if (!finalStat.isFile()) throw localError("direct_full_access_patch_target_invalid", "The selected local patch target is not a regular file.");
      if (finalStat.size !== initialStat.size || finalStat.size > MAX_PATCH_TARGET_BYTES || bytesRead > MAX_PATCH_TARGET_BYTES || bytesRead !== finalStat.size) {
        throw localError("direct_full_access_patch_target_changed", "The selected local patch target changed during bounded validation.");
      }
      return { exists: true, bytes: buffer.subarray(0, bytesRead) };
    } finally {
      await handle.close().catch(() => {});
    }
  }

  async applyPatch(input, params, grant, expected, authorization) {
    const patchText = String(params.patch || "");
    const patches = parseUnifiedPatch(patchText);
    const plans = [];
    for (const filePatch of patches) {
      if (filePatch.relPath === "/dev/null") throw localError("direct_full_access_patch_invalid", "Patch target is missing.");
      const resolved = this.resolveTarget(input, grant, filePatch.relPath, "patch target");
      const beforeTarget = await this.readPatchTarget(resolved.target, filePatch.operation);
      const beforeBuffer = beforeTarget.bytes;
      const beforeText = beforeBuffer.toString("utf8");
      const before = splitLines(beforeText);
      if (filePatch.operation === "update" && !beforeTarget.exists) throw localError("direct_full_access_patch_target_unavailable", "Patch update target does not exist.");
      if (filePatch.operation === "create" && beforeTarget.exists) throw localError("direct_full_access_patch_target_exists", "Patch create target already exists.");
      let afterLines;
      if (filePatch.operation === "delete") {
        const deletionLines = filePatch.hunks.flatMap((hunk) => hunk.lines).filter((line) => line.startsWith("-"));
        if (!filePatch.hunks.length || !deletionLines.length) {
          throw localError("direct_full_access_patch_invalid", "A delete patch requires nonempty deletion hunks.");
        }
        // Validate delete hunks against the same current-content matcher used
        // by updates, then require that the validated successor is empty.
        afterLines = applyHunks(before.lines, filePatch.hunks, "update");
        if (afterLines.length !== 0) {
          throw localError("direct_full_access_patch_conflict", "A delete patch must remove the complete current file.");
        }
      } else {
        afterLines = applyHunks(before.lines, filePatch.hunks, filePatch.operation);
      }
      const afterText = filePatch.operation === "delete" ? "" : `${afterLines.join("\n")}${before.hasFinalNewline || filePatch.operation === "create" ? "\n" : ""}`;
      plans.push({
        operation: filePatch.operation,
        displayPath: resolved.pathEvidenceKey,
        canonicalPathEvidenceKey: resolved.pathEvidenceKey,
        beforeDigest: sha256(beforeText),
        afterDigest: sha256(afterText),
        beforeExists: beforeTarget.exists,
        afterExists: filePatch.operation !== "delete",
        hunkCount: filePatch.hunks.length,
        addedLineCount: filePatch.hunks.flatMap((hunk) => hunk.lines).filter((line) => line.startsWith("+")).length,
        removedLineCount: filePatch.hunks.flatMap((hunk) => hunk.lines).filter((line) => line.startsWith("-")).length,
        previewText: filePatch.hunks.flatMap((hunk) => hunk.lines).join("\n").slice(0, 8000),
        _target: resolved.target,
        _afterText: afterText,
      });
    }
    if (params.mode !== "apply") return this.publicPatchResult(patchText, plans, "dryRun", grant, expected, authorization);
    // Revalidate every existing target with the same bounded reader before
    // mutating any file, preserving validate-all-before-mutate under races.
    for (const plan of plans) {
      if (!plan.beforeExists) {
        const current = await this.readPatchTarget(plan._target, "create");
        if (current.exists) throw localError("direct_full_access_patch_target_exists", "Patch create target appeared before apply.");
        continue;
      }
      const current = await this.readPatchTarget(plan._target, plan.operation === "delete" ? "delete" : "update");
      if (!current.exists || sha256(current.bytes.toString("utf8")) !== plan.beforeDigest) {
        throw localError("direct_full_access_patch_conflict", "The selected local patch target changed before apply.");
      }
    }
    for (const plan of plans) {
      if (plan.operation === "delete") {
        await fsp.unlink(plan._target);
        continue;
      }
      await fsp.mkdir(path.dirname(plan._target), { recursive: true });
      const tempPath = `${plan._target}.codex-direct-patch-${process.pid}-${Date.now()}.tmp`;
      await fsp.writeFile(tempPath, plan._afterText, "utf8");
      await fsp.rename(tempPath, plan._target);
    }
    return this.publicPatchResult(patchText, plans, "apply", grant, expected, authorization);
  }

  publicPatchResult(patchText, plans, mode, grant, expected, authorization) {
    const files = plans.map(({ _target, _afterText, ...file }) => ({ ...file, previewTruncated: file.previewText.length >= 8000 }));
    return {
      schema: "workspace_apply_patch_result@1",
      mode,
      status: mode === "apply" ? "applied" : "dry_run_passed",
      patchPlanId: `patch_plan_${sha256(patchText).slice(0, 20)}`,
      patchTextHash: sha256(patchText),
      files,
      totals: {
        fileCount: files.length,
        createCount: files.filter((file) => file.operation === "create").length,
        updateCount: files.filter((file) => file.operation === "update").length,
        deleteCount: files.filter((file) => file.operation === "delete").length,
        addedLineCount: files.reduce((sum, file) => sum + Number(file.addedLineCount || 0), 0),
        removedLineCount: files.reduce((sum, file) => sum + Number(file.removedLineCount || 0), 0),
        hunkCount: files.reduce((sum, file) => sum + Number(file.hunkCount || 0), 0),
      },
      grantId: grant.grantId,
      grantRevision: Number(grant.grantRevision),
      executionEnvironmentDigest: expected.executionEnvironmentDigest,
      authorizationMode: authorization.authorityMode || "full_access_task_grant",
      workspaceBindingEvidenceKey: `selected_local_environment_${sha256(expected.executionEnvironmentDigest).slice(0, 24)}`,
      backendCapabilities: {
        readFile: false,
        applyPatch: true,
        directFullAccessLocalEnvironment: true,
        grantBound: true,
        rawPathIncluded: false,
      },
      rawPathsExposed: false,
    };
  }
}

module.exports = {
  DirectFullAccessLocalEnvironmentExecutor,
  parseUnifiedPatch,
};
