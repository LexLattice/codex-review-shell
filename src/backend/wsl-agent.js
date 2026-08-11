#!/usr/bin/env node
"use strict";

/**
 * ADEU workspace backend agent.
 *
 * This file is intentionally plain Node/CommonJS and has no Electron dependency.
 * For WSL projects it runs inside the selected distro, rooted at the canonical
 * Linux workspace path. For local/dev projects it can also run as a local
 * resident backend process. The host talks to it over newline-delimited JSON.
 */

const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");

const PROTOCOL_VERSION = 1;
const PREVIEW_LIMIT_BYTES = 384 * 1024;
const DIRECTORY_ENTRY_LIMIT = 500;
const ATTACHMENT_STAGING_ROOT = ".codex/review-shell/attachments";
const CHATGPT_DOWNLOAD_STAGING_ROOT = ".codex/review-shell/chatgpt-downloads";
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_IMPORT_FILE_BYTES = 50 * 1024 * 1024;
const MAX_CHATGPT_REVIEW_FILE_BYTES = 8 * 1024 * 1024;
const COMMAND_OUTPUT_LIMIT_BYTES = 256 * 1024;
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const MATCH_SCAN_LIMIT = 240;
const MATCH_WALK_LIMIT = 8000;
const CODEX_THREAD_LIMIT = 120;
const CODEX_TRANSCRIPT_ENTRY_LIMIT = 800;
const CODEX_STORED_PROCESS_TEXT_LIMIT = 1400;
const CODEX_ANALYTICS_GAP_MS = 2 * 60 * 1000;
const CODEX_ANALYTICS_TAIL_HASH_LINE_LIMIT = 24;
const CODEX_SANDBOX_ARTIFACT_NAME = ".codex";
const CODEX_SANDBOX_ARTIFACT_EXCLUDE_COMMENT =
  "# codex-review-shell: Codex Linux sandbox may leak a zero-byte bwrap placeholder here.";
const MAX_PATCH_TEXT_CHARS = 256 * 1024;
const MAX_PATCH_FILES = 16;
const MAX_PATCH_HUNKS = 128;
const MAX_PATCH_LINES_CHANGED = 4000;
const MAX_PATCH_FILE_PREVIEW_CHARS = 8000;
const REPOSITORY_SEMANTIC_MANIFEST_LIMIT = 2000;
const REPOSITORY_SEMANTIC_EVIDENCE_LIMIT = 18;
const REPOSITORY_SEMANTIC_EXCERPT_BYTES = 6000;
const REPOSITORY_SEMANTIC_TOTAL_EXCERPT_BYTES = 72 * 1024;
const REPOSITORY_SEMANTIC_MAX_EVIDENCE_FILE_BYTES = 2 * 1024 * 1024;
const DIRECT_EPISTEMIC_CAPTURE_LIMIT_BYTES = 2 * 1024 * 1024;
const DIRECT_EPISTEMIC_UNTRACKED_FILE_LIMIT = 2000;
const DIRECT_EPISTEMIC_UNTRACKED_FILE_BYTES = 16 * 1024 * 1024;
const DIRECT_EPISTEMIC_UNTRACKED_TOTAL_BYTES = 128 * 1024 * 1024;
const DIRECT_EPISTEMIC_PROFILE_SOURCE_BYTES = 8 * 1024 * 1024;
const DIRECT_WORKSPACE_WORKER_TIMEOUT_MS = 120 * 1000;
const DIRECT_WORKSPACE_WORKER_TARGET_LIMIT = 16;
const DIRECT_WORKSPACE_WORKER_TARGET_CHARS = 500;
const ARO_REALIZATION_CONTEXT_FILE_LIMIT = 12;
const ARO_REALIZATION_CONTEXT_EXCERPT_BYTES = 12 * 1024;
const ARO_REALIZATION_CONTEXT_TOTAL_BYTES = 96 * 1024;
const PATCH_DENY_PATTERNS = [
  /(?:^|\/)\.git(?:\/|$)/i,
  /(?:^|\/)node_modules(?:\/|$)/i,
  /(?:^|\/)dist(?:\/|$)/i,
  /(?:^|\/)build(?:\/|$)/i,
  /(?:^|\/)coverage(?:\/|$)/i,
  /(?:^|\/)[^/]*\.lock$/i,
  /(?:^|\/)\.env(?:\.|$)/i,
  /(?:^|\/)[^/]+\.pem$/i,
  /(?:^|\/)[^/]+\.key$/i,
  /(?:^|\/)\.ssh(?:\/|$)/i,
];
const SENSITIVE_READ_FILE_PATTERNS = [
  /(?:^|\/)\.env(?:\.|$)/i,
  /(?:^|\/)[^/]+\.pem$/i,
  /(?:^|\/)[^/]+\.key$/i,
  /(?:^|\/)[^/]+\.p12$/i,
  /(?:^|\/)[^/]+\.pfx$/i,
  /(?:^|\/)id_rsa$/i,
  /(?:^|\/)id_ed25519$/i,
  /(?:^|\/)secrets(?:\/|$)/i,
  /(?:^|\/)\.ssh(?:\/|$)/i,
  /(?:^|\/)\.git\/config$/i,
];
let reviewShellIgnorePromise = null;
let gitWorktreeMutationQueue = Promise.resolve();

const SKIPPED_DIR_NAMES = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  ".next",
  "dist",
  "build",
  "out",
  "coverage",
  "target",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".venv",
  "venv",
]);

function parseArgv(argv) {
  const result = {};
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      result[key] = "true";
    } else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

const argv = parseArgv(process.argv);
const root = path.resolve(argv.root || process.cwd());
const workspaceKind = argv["workspace-kind"] || "local";
const projectId = argv["project-id"] || "unknown-project";
const sessionId = `agent_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
const STDIN_CLOSE_EXIT_GRACE_MS = 250;
const STDIN_CLOSE_FORCE_EXIT_MS = 2000;

let activeRequests = 0;
let stdinClosed = false;
let outputClosed = false;
let shutdownTimer = null;
let forceShutdownTimer = null;
const activeChildProcesses = new Set();
const terminatingChildProcesses = new WeakSet();

function isClosedPipeError(error) {
  return ["EPIPE", "ERR_STREAM_DESTROYED", "ERR_STREAM_WRITE_AFTER_END"].includes(error?.code);
}

function requestExitCode(code = 0) {
  if (code !== 0 || process.exitCode === undefined) process.exitCode = code;
}

function scheduleProcessExit(code = 0, delayMs = STDIN_CLOSE_EXIT_GRACE_MS) {
  requestExitCode(code);
  if (shutdownTimer) return;
  shutdownTimer = setTimeout(() => {
    process.exit(process.exitCode ?? code);
  }, delayMs);
  shutdownTimer.unref?.();
}

function requestShutdown(code = 0) {
  stdinClosed = true;
  requestExitCode(code);
  for (const child of activeChildProcesses) {
    terminateChild(child);
  }
  if (!forceShutdownTimer) {
    forceShutdownTimer = setTimeout(() => {
      process.exit(process.exitCode ?? code);
    }, STDIN_CLOSE_FORCE_EXIT_MS);
    forceShutdownTimer.unref?.();
  }
  if (activeRequests === 0) scheduleProcessExit(code);
}

function terminateChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (terminatingChildProcesses.has(child)) return;
  terminatingChildProcesses.add(child);
  try {
    child.kill("SIGTERM");
  } catch {}
  const timer = setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      child.kill("SIGKILL");
    } catch {}
  }, 1200);
  timer.unref?.();
  child.once("close", () => clearTimeout(timer));
}

function trackChildProcess(child) {
  activeChildProcesses.add(child);
  child.once("close", () => {
    activeChildProcesses.delete(child);
  });
  if (stdinClosed) terminateChild(child);
  return child;
}

process.stdout.on("error", (error) => {
  outputClosed = true;
  requestShutdown(isClosedPipeError(error) ? 0 : 1);
});

process.stderr.on("error", (error) => {
  requestShutdown(isClosedPipeError(error) ? 0 : 1);
});

function send(message) {
  if (outputClosed) return false;
  try {
    process.stdout.write(`${JSON.stringify(message)}\n`, (error) => {
      if (!error) return;
      outputClosed = true;
      requestShutdown(isClosedPipeError(error) ? 0 : 1);
    });
    return true;
  } catch (error) {
    outputClosed = true;
    requestShutdown(isClosedPipeError(error) ? 0 : 1);
    return false;
  }
}

function sendEvent(type, payload = {}) {
  return send({ event: type, sessionId, at: new Date().toISOString(), ...payload });
}

function normalizeRelPath(relPath) {
  const text = String(relPath ?? "").replace(/\\/g, "/").trim();
  if (!text || text === ".") return "";
  if (/[\0-\x1f\x7f]/.test(text)) throw new Error("Control characters are not allowed in workspace paths.");
  if (text.startsWith("/") || /^[A-Za-z]:\//.test(text) || text.includes("://")) {
    throw new Error("Absolute workspace paths are not allowed.");
  }
  const parts = text.split("/").filter(Boolean);
  if (parts.some((part) => part === "..")) throw new Error("Parent-path traversal is not allowed.");
  return parts.join(path.sep);
}

function displayRelPath(value) {
  return String(value || "").split(path.sep).join("/");
}

function resolveWithinRoot(relPath = "") {
  const rel = normalizeRelPath(relPath);
  const fullPath = path.resolve(root, rel || ".");
  const relative = path.relative(root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Requested path is outside the workspace root.");
  }
  return {
    root,
    rel,
    fullPath,
    displayRel: displayRelPath(relative === "." ? "" : relative),
  };
}

function pathIsUnderRoot(realRoot, realTarget) {
  const relative = path.relative(realRoot, realTarget);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function resolveFileWithinRoot(relPath = "") {
  const resolved = resolveWithinRoot(relPath);
  const realRoot = await fs.realpath(root);
  const realTarget = await fs.realpath(resolved.fullPath);
  if (!pathIsUnderRoot(realRoot, realTarget)) {
    throw new Error("Requested path resolves outside the workspace root.");
  }
  return {
    ...resolved,
    realRoot,
    requestedFullPath: resolved.fullPath,
    fullPath: realTarget,
  };
}

function sensitiveReadFileReason(relPath = "") {
  const normalized = displayRelPath(normalizeRelPath(relPath));
  return SENSITIVE_READ_FILE_PATTERNS.some((pattern) => pattern.test(normalized)) ? "sensitive_path" : "";
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
}

function sha256Digest(value) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(value)
    .digest("hex")}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function canonicalDigest(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function splitLinesWithEndings(text) {
  const matches = String(text ?? "").match(/[^\n]*\n|[^\n]+/g);
  return matches || [];
}

function stripLineEnding(line) {
  return String(line || "").replace(/\r?\n$/, "");
}

function unquotePatchPath(value = "") {
  const text = String(value || "").trim();
  if (text.length >= 2 && text.startsWith("\"") && text.endsWith("\"")) {
    return text
      .slice(1, -1)
      .replace(/\\(["\\])/g, "$1")
      .replace(/\\t/g, "\t")
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r");
  }
  return text;
}

function safeAttachmentSegment(value, label) {
  const text = String(value || "").trim();
  if (!/^[A-Za-z0-9._-]+$/.test(text) || text.includes("..")) {
    throw new Error(`Invalid attachment ${label}.`);
  }
  return text;
}

function splitGitDiffPaths(headerText = "") {
  const parts = [];
  let current = "";
  let inQuote = false;
  let escaping = false;
  for (const char of String(headerText || "").trim()) {
    if (escaping) {
      current += `\\${char}`;
      escaping = false;
      continue;
    }
    if (char === "\\" && inQuote) {
      escaping = true;
      continue;
    }
    if (char === "\"") {
      inQuote = !inQuote;
      current += char;
      continue;
    }
    if (/\s/.test(char) && !inQuote) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (escaping) current += "\\";
  if (current) parts.push(current);
  return parts;
}

function normalizePatchPath(value = "") {
  let text = unquotePatchPath(value);
  if (!text || text === "/dev/null") return text;
  if (text.startsWith("a/") || text.startsWith("b/")) text = text.slice(2);
  return displayRelPath(normalizeRelPath(text));
}

function assertPatchPathAllowed(relPath) {
  const normalized = displayRelPath(normalizeRelPath(relPath));
  if (PATCH_DENY_PATTERNS.some((pattern) => pattern.test(normalized))) {
    const error = new Error("Patch target is blocked by workspace policy.");
    error.code = "PATCH_GENERATED_PATH_BLOCKED";
    throw error;
  }
  return normalized;
}

function parseHunkHeader(line) {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (!match) throw new Error("Malformed patch hunk range.");
  return {
    oldStart: Number(match[1]),
    oldCount: Number(match[2] || "1"),
    newStart: Number(match[3]),
    newCount: Number(match[4] || "1"),
  };
}

function parseUnifiedPatch(patchText) {
  const patch = String(patchText || "");
  if (!patch.trim()) throw new Error("Patch text is empty.");
  if (patch.length > MAX_PATCH_TEXT_CHARS) {
    const error = new Error("Patch text exceeds the configured size limit.");
    error.code = "PATCH_CAPS_EXCEEDED";
    throw error;
  }
  if (/GIT binary patch|Binary files /i.test(patch)) {
    const error = new Error("Binary patches are unsupported.");
    error.code = "PATCH_BINARY_UNSUPPORTED";
    throw error;
  }
  const lines = patch.split(/\n/);
  const files = [];
  let current = null;
  let currentHunk = null;
  let pendingStandardOldPath = "";

  function finishHunk() {
    if (currentHunk && current) current.hunks.push(currentHunk);
    currentHunk = null;
  }
  function finishFile() {
    finishHunk();
    if (current) files.push(current);
    current = null;
  }
  function recordFileLine(line) {
    if (current) current.rawLines.push(line);
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex];
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.startsWith("diff --git ")) {
      finishFile();
      pendingStandardOldPath = "";
      const parts = splitGitDiffPaths(line.slice("diff --git ".length));
      if (parts.length !== 2) throw new Error("Malformed git-style diff header.");
      current = {
        oldPath: normalizePatchPath(parts[0]),
        newPath: normalizePatchPath(parts[1]),
        operation: "update",
        hunks: [],
        addedLineCount: 0,
        removedLineCount: 0,
        rawLines: [line],
      };
      continue;
    }
    if (!current && line.startsWith("--- ")) {
      pendingStandardOldPath = normalizePatchPath(line.slice(4).split(/\t/)[0]);
      continue;
    }
    if (!current && pendingStandardOldPath && line.startsWith("+++ ")) {
      const newPath = normalizePatchPath(line.slice(4).split(/\t/)[0]);
      if (newPath === "/dev/null") {
        const error = new Error("Patch deletes are deferred in v0.");
        error.code = "PATCH_DELETE_DEFERRED";
        throw error;
      }
      current = {
        oldPath: pendingStandardOldPath,
        newPath,
        operation: pendingStandardOldPath === "/dev/null" ? "create" : "update",
        hunks: [],
        addedLineCount: 0,
        removedLineCount: 0,
        rawLines: [`--- ${pendingStandardOldPath}`, line],
      };
      pendingStandardOldPath = "";
      continue;
    }
    if (!current) {
      if (line.trim()) throw new Error("Patch must use git-style unified diff headers.");
      continue;
    }
    if (/^(rename|copy) (from|to) /.test(line)) throw new Error("Rename/copy patch headers are unsupported.");
    if (/^(old mode|new mode|deleted file mode) /.test(line)) {
      recordFileLine(line);
      if (line.startsWith("deleted file mode")) {
        const error = new Error("Patch deletes are deferred in v0.");
        error.code = "PATCH_DELETE_DEFERRED";
        throw error;
      }
      if (!line.startsWith("new file mode")) throw new Error("Patch mode changes are unsupported.");
    }
    if (line.startsWith("new file mode ")) {
      recordFileLine(line);
      current.operation = "create";
      continue;
    }
    if (line.startsWith("--- ")) {
      recordFileLine(line);
      const oldPath = normalizePatchPath(line.slice(4).split(/\t/)[0]);
      if (oldPath === "/dev/null") current.operation = "create";
      else current.oldPath = oldPath;
      continue;
    }
    if (line.startsWith("+++ ")) {
      recordFileLine(line);
      const newPath = normalizePatchPath(line.slice(4).split(/\t/)[0]);
      if (newPath === "/dev/null") {
        const error = new Error("Patch deletes are deferred in v0.");
        error.code = "PATCH_DELETE_DEFERRED";
        throw error;
      }
      current.newPath = newPath;
      continue;
    }
    const looseHunkHeader = /^-\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.test(line) ? `@@ ${line}` : "";
    if (line.startsWith("@@ ") || looseHunkHeader) {
      const hunkHeaderLine = looseHunkHeader || line;
      recordFileLine(hunkHeaderLine);
      finishHunk();
      currentHunk = { header: parseHunkHeader(hunkHeaderLine), lines: [] };
      continue;
    }
    if (currentHunk) {
      if (line === "" && lineIndex === lines.length - 1) continue;
      recordFileLine(line);
      if (line.startsWith("\\ No newline at end of file")) {
        const previous = currentHunk.lines[currentHunk.lines.length - 1];
        if (previous) previous.noNewline = true;
        continue;
      }
      const prefix = line[0];
      if (![" ", "+", "-"].includes(prefix)) throw new Error("Malformed patch hunk line.");
      currentHunk.lines.push({
        prefix,
        content: line.slice(1),
        noNewline: false,
      });
      if (prefix === "+") current.addedLineCount += 1;
      if (prefix === "-") current.removedLineCount += 1;
    }
  }
  finishFile();
  if (!files.length) throw new Error("Patch contains no file changes.");
  if (files.length > MAX_PATCH_FILES) {
    const error = new Error("Patch file count exceeds the configured cap.");
    error.code = "PATCH_CAPS_EXCEEDED";
    throw error;
  }
  const totalHunks = files.reduce((sum, file) => sum + file.hunks.length, 0);
  const totalChanged = files.reduce((sum, file) => sum + file.addedLineCount + file.removedLineCount, 0);
  if (totalHunks > MAX_PATCH_HUNKS || totalChanged > MAX_PATCH_LINES_CHANGED) {
    const error = new Error("Patch hunk or line-change count exceeds configured caps.");
    error.code = "PATCH_CAPS_EXCEEDED";
    throw error;
  }
  return files.map((file) => ({
    ...file,
    relPath: assertPatchPathAllowed(file.newPath || file.oldPath),
  }));
}

async function fileDigestIfExists(fullPath) {
  try {
    const stat = await fs.lstat(fullPath);
    if (stat.isSymbolicLink()) throw new Error("Symlink patch targets are unsupported.");
    if (!stat.isFile()) throw new Error("Patch target is not a text file.");
    const buffer = await fs.readFile(fullPath);
    if (looksBinary(buffer)) throw new Error("Binary patch targets are unsupported.");
    return { exists: true, text: buffer.toString("utf8"), digest: sha256(buffer.toString("utf8")), size: stat.size };
  } catch (error) {
    if (error.code === "ENOENT") return { exists: false, text: "", digest: "", size: 0 };
    throw error;
  }
}

function applyParsedHunks(beforeText, filePatch) {
  const beforeLines = splitLinesWithEndings(beforeText);
  const output = [];
  let cursor = 0;
  for (const hunk of filePatch.hunks) {
    const oldStartIndex = locateHunkStart(beforeLines, hunk, Math.max(0, Number(hunk.header.oldStart || 1) - 1), cursor);
    while (cursor < oldStartIndex && cursor < beforeLines.length) {
      output.push(beforeLines[cursor]);
      cursor += 1;
    }
    for (const patchLine of hunk.lines) {
      const prefix = patchLine.prefix || String(patchLine)[0];
      const content = typeof patchLine.content === "string" ? patchLine.content : String(patchLine).slice(1);
      if (prefix === " ") {
        const current = beforeLines[cursor];
        if (stripLineEnding(current) !== content) throw new Error("Patch context does not match current file content.");
        output.push(current);
        cursor += 1;
      } else if (prefix === "-") {
        const current = beforeLines[cursor];
        if (stripLineEnding(current) !== content) throw new Error("Patch removal does not match current file content.");
        cursor += 1;
      } else if (prefix === "+") {
        const lineEnding = beforeText.includes("\r\n") ? "\r\n" : "\n";
        output.push(patchLine.noNewline ? content : `${content}${lineEnding}`);
      }
    }
  }
  while (cursor < beforeLines.length) {
    output.push(beforeLines[cursor]);
    cursor += 1;
  }
  return output.join("");
}

function hunkMatchesAt(beforeLines, hunk, startIndex) {
  if (startIndex < 0 || startIndex > beforeLines.length) return false;
  let index = startIndex;
  for (const patchLine of hunk.lines || []) {
    const prefix = patchLine.prefix || String(patchLine)[0];
    if (prefix === "+") continue;
    const content = typeof patchLine.content === "string" ? patchLine.content : String(patchLine).slice(1);
    const current = beforeLines[index];
    if (current === undefined || stripLineEnding(current) !== content) return false;
    index += 1;
  }
  return true;
}

function locateHunkStart(beforeLines, hunk, preferredIndex, cursor) {
  if (hunkMatchesAt(beforeLines, hunk, preferredIndex)) return preferredIndex;
  const start = Math.max(0, cursor);
  const candidates = [];
  for (let index = start; index <= beforeLines.length; index += 1) {
    if (index !== preferredIndex) candidates.push(index);
  }
  candidates.sort((left, right) => {
    const distance = Math.abs(left - preferredIndex) - Math.abs(right - preferredIndex);
    return distance || left - right;
  });
  for (const index of candidates) {
    if (hunkMatchesAt(beforeLines, hunk, index)) return index;
  }
  return preferredIndex;
}

async function resolvePatchTarget(relPath) {
  const normalizedRel = assertPatchPathAllowed(relPath);
  const resolved = resolveWithinRoot(normalizedRel);
  const realRoot = await fs.realpath(root);
  const parentDir = path.dirname(resolved.fullPath);
  let nearestParent = parentDir;
  while (!fsSync.existsSync(nearestParent) && nearestParent !== root && nearestParent !== path.dirname(nearestParent)) {
    nearestParent = path.dirname(nearestParent);
  }
  const realParent = await fs.realpath(nearestParent);
  if (!pathIsUnderRoot(realRoot, realParent)) throw new Error("Patch target parent resolves outside the workspace root.");
  return { ...resolved, displayRel: displayRelPath(normalizedRel), realRoot, realParent };
}

async function applyPatchPlan(params = {}) {
  const patchText = String(params.patch || "");
  const mode = params.mode === "apply" ? "apply" : "dryRun";
  const parsedFiles = parseUnifiedPatch(patchText);
  const seen = new Set();
  const filePlans = [];
  for (const filePatch of parsedFiles) {
    const target = await resolvePatchTarget(filePatch.relPath);
    const normalizedKey = process.platform === "win32"
      ? target.displayRel.toLocaleLowerCase().normalize("NFC")
      : target.displayRel.normalize("NFC");
    if (seen.has(normalizedKey)) throw new Error("Patch has colliding target paths after normalization.");
    seen.add(normalizedKey);
    const before = await fileDigestIfExists(target.fullPath);
    if (filePatch.operation === "create" && before.exists) throw new Error("Patch create target already exists.");
    if (filePatch.operation === "update" && !before.exists) throw new Error("Patch update target does not exist.");
    const afterText = applyParsedHunks(before.text, filePatch);
    const afterDigest = sha256(afterText);
    const filePreviewText = (Array.isArray(filePatch.rawLines) ? filePatch.rawLines : [])
      .join("\n");
    const preview = filePreviewText.slice(0, MAX_PATCH_FILE_PREVIEW_CHARS);
    filePlans.push({
      filePlanId: `patch_file_${sha256(`${target.displayRel}:${before.digest}:${afterDigest}`).slice(0, 20)}`,
      operation: filePatch.operation,
      displayPath: target.displayRel,
      canonicalPathEvidenceKey: sha256(target.displayRel),
      beforeDigest: before.digest,
      afterDigest,
      beforeExists: before.exists,
      beforeNonExistenceProof: before.exists ? null : {
        parentDirectoryEvidenceKey: sha256(target.realParent),
        checkedAt: new Date().toISOString(),
      },
      afterExists: true,
      hunkCount: filePatch.hunks.length,
      addedLineCount: filePatch.addedLineCount,
      removedLineCount: filePatch.removedLineCount,
      previewText: preview,
      previewTextHash: sha256(preview),
      previewTruncated: filePreviewText.length > preview.length,
      _fullPath: target.fullPath,
      _afterText: afterText,
    });
  }

  if (mode === "apply") {
    for (const file of filePlans) {
      await fs.mkdir(path.dirname(file._fullPath), { recursive: true });
      const tempPath = `${file._fullPath}.codex-patch-${process.pid}-${Date.now()}.tmp`;
      await fs.writeFile(tempPath, file._afterText, "utf8");
      await fs.rename(tempPath, file._fullPath);
      file.applied = true;
    }
  }

  const publicPlans = filePlans.map(({ _fullPath, _afterText, ...file }) => file);
  return {
    schema: "workspace_apply_patch_result@1",
    mode,
    status: mode === "apply" ? "applied" : "dry_run_passed",
    patchPlanId: `patch_plan_${sha256(patchText).slice(0, 20)}`,
    patchTextHash: sha256(patchText),
    files: publicPlans,
    totals: {
      fileCount: publicPlans.length,
      createCount: publicPlans.filter((file) => file.operation === "create").length,
      updateCount: publicPlans.filter((file) => file.operation === "update").length,
      deleteCount: 0,
      addedLineCount: publicPlans.reduce((sum, file) => sum + Number(file.addedLineCount || 0), 0),
      removedLineCount: publicPlans.reduce((sum, file) => sum + Number(file.removedLineCount || 0), 0),
      hunkCount: publicPlans.reduce((sum, file) => sum + Number(file.hunkCount || 0), 0),
    },
    rawPathsExposed: false,
  };
}

function assertNoEncodedTraversal(relPath = "") {
  try {
    const decoded = decodeURIComponent(String(relPath || ""));
    if (decoded !== relPath && (decoded.includes("/") || decoded.includes("\\") || decoded.split(/[\\/]/).includes(".."))) {
      throw new Error("Encoded workspace traversal is not allowed.");
    }
  } catch (error) {
    if (error && error.message === "Encoded workspace traversal is not allowed.") throw error;
    throw new Error("Malformed workspace path encoding is not allowed.");
  }
}

async function ensureAttachmentIgnoreInner() {
  const base = path.join(root, ".codex", "review-shell");
  const ignorePath = path.join(base, ".gitignore");
  await fs.mkdir(base, { recursive: true });
  try {
    await fs.writeFile(ignorePath, "attachments/\nchatgpt-downloads/\n", { flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  try {
    const existing = await fs.readFile(ignorePath, "utf8");
    const additions = ["attachments/", "chatgpt-downloads/"].filter((line) => !existing.split(/\r?\n/).includes(line));
    if (additions.length) await fs.appendFile(ignorePath, `${existing.endsWith("\n") ? "" : "\n"}${additions.join("\n")}\n`);
  } catch (error) {
    process.stderr.write(`codex-review-shell: unable to update workspace staging .gitignore: ${error.message}\n`);
  }
}

async function ensureAttachmentIgnore() {
  if (!reviewShellIgnorePromise) {
    reviewShellIgnorePromise = ensureAttachmentIgnoreInner().catch((error) => {
      reviewShellIgnorePromise = null;
      throw error;
    });
  }
  return reviewShellIgnorePromise;
}

async function stageAttachment(params = {}) {
  const draftId = safeAttachmentSegment(params.draftId, "draft id");
  const fileName = safeAttachmentSegment(params.fileName, "file name");
  const content = Buffer.from(String(params.contentBase64 || ""), "base64");
  if (!content.length) throw new Error("Attachment content is empty.");
  if (content.length > MAX_ATTACHMENT_BYTES) throw new Error("Attachment content exceeds size limit.");
  const relPath = path.posix.join(ATTACHMENT_STAGING_ROOT, draftId, fileName);
  const { fullPath, displayRel } = resolveWithinRoot(relPath);
  const draftDir = path.dirname(fullPath);
  await ensureAttachmentIgnore();
  await fs.mkdir(draftDir, { recursive: true });
  await fs.writeFile(fullPath, content, { flag: "wx" });
  const manifest = params.manifest && typeof params.manifest === "object" ? params.manifest : {};
  await fs.writeFile(path.join(draftDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  return {
    relPath: displayRel,
    stagedRelPath: displayRel,
    sizeBytes: content.length,
  };
}

async function removeAttachmentDraft(params = {}) {
  const draftId = safeAttachmentSegment(params.draftId, "draft id");
  const relPath = path.posix.join(ATTACHMENT_STAGING_ROOT, draftId);
  const { fullPath } = resolveWithinRoot(relPath);
  await fs.rm(fullPath, { recursive: true, force: true });
  return { ok: true, draftId };
}

function safeImportFileName(value) {
  const text = path.basename(String(value || "download").replace(/\\/g, "/")).trim();
  const fallback = "download";
  const cleaned = (text || fallback)
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : fallback;
}

async function uniqueFilePath(dirPath, fileName) {
  const parsed = path.parse(fileName);
  for (let index = 0; index < 1000; index += 1) {
    const candidateName = index === 0
      ? fileName
      : `${parsed.name || "download"}-${index}${parsed.ext || ""}`;
    const candidate = path.join(dirPath, candidateName);
    try {
      const handle = await fs.open(candidate, "wx");
      return { handle, fullPath: candidate };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  throw new Error("Unable to allocate a unique import file path.");
}

async function importFile(params = {}) {
  const relDir = normalizeRelPath(params.relDir || CHATGPT_DOWNLOAD_STAGING_ROOT);
  const fileName = safeImportFileName(params.fileName);
  const content = Buffer.from(String(params.contentBase64 || ""), "base64");
  if (!content.length) throw new Error("Import file content is empty.");
  if (content.length > MAX_IMPORT_FILE_BYTES) throw new Error("Import file exceeds size limit.");
  const { fullPath: dirPath, displayRel: dirDisplayRel } = resolveWithinRoot(relDir);
  await ensureAttachmentIgnore();
  await fs.mkdir(dirPath, { recursive: true });
  const { handle, fullPath } = await uniqueFilePath(dirPath, fileName);
  try {
    await handle.writeFile(content);
  } finally {
    await handle.close();
  }
  const relPath = path.join(dirDisplayRel, path.basename(fullPath));
  return {
    relPath: displayRelPath(relPath),
    sizeBytes: content.length,
  };
}

function direntType(dirent) {
  if (dirent.isSymbolicLink()) return "symlink";
  if (dirent.isDirectory()) return "dir";
  if (dirent.isFile()) return "file";
  return "other";
}

async function listTree(params = {}) {
  const { fullPath, displayRel } = resolveWithinRoot(params.relPath || "");
  const stat = await fs.lstat(fullPath);
  if (!stat.isDirectory()) throw new Error("Requested path is not a directory.");

  const rawEntries = await fs.readdir(fullPath, { withFileTypes: true });
  const entries = [];
  let skipped = 0;

  for (const dirent of rawEntries) {
    const type = direntType(dirent);
    if (type === "dir" && SKIPPED_DIR_NAMES.has(dirent.name)) {
      skipped += 1;
      continue;
    }
    if (entries.length >= DIRECTORY_ENTRY_LIMIT) {
      skipped += 1;
      continue;
    }
    const childRel = displayRel ? `${displayRel}/${dirent.name}` : dirent.name;
    entries.push({
      name: dirent.name,
      relPath: childRel,
      type,
      expandable: type === "dir",
    });
  }

  entries.sort((a, b) => {
    if (a.type === "dir" && b.type !== "dir") return -1;
    if (a.type !== "dir" && b.type === "dir") return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  });

  return {
    root,
    relPath: displayRel,
    entries,
    skipped,
    limit: DIRECTORY_ENTRY_LIMIT,
    source: workspaceKind,
  };
}

function repositoryEvidenceKind(relPath) {
  const normalized = String(relPath || "").replace(/\\/g, "/").toLowerCase();
  const base = path.posix.basename(normalized);
  if (
    normalized.includes("/test") ||
    normalized.includes("/spec") ||
    /(?:^|[._-])(test|spec)\.[^.]+$/.test(base) ||
    normalized.startsWith("test") ||
    normalized.startsWith("spec")
  ) {
    return "test_file";
  }
  if (
    normalized.startsWith("docs/") ||
    /\.(md|mdx|rst|adoc|txt)$/.test(base) ||
    /^(readme|agents|contributing|architecture|design)/.test(base)
  ) {
    return "documentation";
  }
  if (
    /^(package\.json|pyproject\.toml|cargo\.toml|go\.mod|composer\.json|gemfile|pom\.xml|build\.gradle|makefile|cmakelists\.txt)$/.test(base) ||
    /\.(ya?ml|toml|ini)$/.test(base)
  ) {
    return "configuration";
  }
  return "source_file";
}

function repositoryEvidencePriority(relPath) {
  const normalized = String(relPath || "").replace(/\\/g, "/").toLowerCase();
  const base = path.posix.basename(normalized);
  let score = 0;
  if (/^readme(?:\.|$)/.test(base)) score += 100;
  if (/^agents(?:\.|$)/.test(base)) score += 86;
  if (
    /^(package\.json|pyproject\.toml|cargo\.toml|go\.mod|composer\.json|gemfile|pom\.xml|build\.gradle|makefile|cmakelists\.txt)$/.test(base)
  ) {
    score += 80;
  }
  if (/(architecture|design|ontology|worldmanager|world-manager|specification|master-status|roadmap)/.test(normalized)) {
    score += 72;
  }
  if (normalized.startsWith("docs/")) score += 30;
  if (/^(src|app|lib|packages)\//.test(normalized)) score += 32;
  if (/(^|\/)(main|index|app|server|service|controller|kernel)\.[^.]+$/.test(normalized)) score += 34;
  if (repositoryEvidenceKind(normalized) === "test_file") score += 24;
  const depth = normalized.split("/").length - 1;
  score -= Math.min(depth * 2, 18);
  if (
    /(?:^|\/)(package-lock|pnpm-lock|yarn\.lock|cargo\.lock|poetry\.lock)(?:$|\.)/.test(normalized) ||
    /\.(map|min\.js|min\.css|snap)$/.test(normalized)
  ) {
    score -= 200;
  }
  return score;
}

async function genericRepositoryManifest() {
  const paths = [];
  let truncated = false;

  async function walk(relDir) {
    if (paths.length >= REPOSITORY_SEMANTIC_MANIFEST_LIMIT) {
      truncated = true;
      return;
    }
    const { fullPath, displayRel } = resolveWithinRoot(relDir);
    let entries;
    try {
      entries = await fs.readdir(fullPath, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (paths.length >= REPOSITORY_SEMANTIC_MANIFEST_LIMIT) {
        truncated = true;
        return;
      }
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && SKIPPED_DIR_NAMES.has(entry.name)) continue;
      const childRel = displayRel ? `${displayRel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(childRel);
      } else if (entry.isFile()) {
        paths.push(childRel);
      }
    }
  }

  await walk("");
  return { paths, truncated };
}

async function repositorySemanticEvidence(manifestPaths) {
  const ranked = [...manifestPaths]
    .filter((relPath) => !sensitiveReadFileReason(relPath))
    .sort((left, right) =>
      repositoryEvidencePriority(right) - repositoryEvidencePriority(left) ||
      left.localeCompare(right));
  const selected = [];
  const seenKinds = new Set();
  let totalExcerptBytes = 0;

  // Give the semantic reasoner at least one view of each available evidence
  // class before filling remaining slots by relevance.
  const ordered = [];
  for (const relPath of ranked) {
    const kind = repositoryEvidenceKind(relPath);
    if (!seenKinds.has(kind)) {
      ordered.push(relPath);
      seenKinds.add(kind);
    }
  }
  for (const relPath of ranked) {
    if (!ordered.includes(relPath)) ordered.push(relPath);
  }

  for (const relPath of ordered) {
    if (
      selected.length >= REPOSITORY_SEMANTIC_EVIDENCE_LIMIT ||
      totalExcerptBytes >= REPOSITORY_SEMANTIC_TOTAL_EXCERPT_BYTES
    ) {
      break;
    }
    let resolved;
    try {
      resolved = await resolveFileWithinRoot(relPath);
      const requestedStat = await fs.lstat(resolved.requestedFullPath);
      if (requestedStat.isSymbolicLink()) continue;
      const stat = await fs.lstat(resolved.fullPath);
      if (
        !stat.isFile() ||
        stat.size > REPOSITORY_SEMANTIC_MAX_EVIDENCE_FILE_BYTES
      ) {
        continue;
      }
      const content = await fs.readFile(resolved.fullPath);
      if (looksBinary(content)) continue;
      const remaining = REPOSITORY_SEMANTIC_TOTAL_EXCERPT_BYTES - totalExcerptBytes;
      const excerptLimit = Math.min(REPOSITORY_SEMANTIC_EXCERPT_BYTES, remaining);
      const excerptBuffer = content.subarray(0, excerptLimit);
      totalExcerptBytes += excerptBuffer.length;
      selected.push({
        evidenceKey: `repo_evidence_${selected.length + 1}`,
        evidenceKind: repositoryEvidenceKind(relPath),
        relativePath: displayRelPath(relPath),
        sizeBytes: stat.size,
        digest: sha256Digest(content),
        excerpt: excerptBuffer.toString("utf8"),
        excerptTruncated: content.length > excerptBuffer.length,
      });
    } catch {
      // A file can disappear between manifest observation and evidence read.
      // The snapshot remains valid and visibly bounded to successfully read files.
    }
  }
  return selected;
}

async function repositorySemanticSnapshot() {
  const observedAt = new Date().toISOString();
  const gitIdentity = await captureProcess(
    "git",
    ["rev-parse", "--show-toplevel", "HEAD", "--abbrev-ref", "HEAD"],
    {
      cwd: root,
      timeoutMs: 8_000,
      env: minimalCommandEnv(),
    },
  ).catch((error) => ({
    exitCode: 1,
    stdout: "",
    stderr: error.message,
  }));
  const gitAvailable = gitIdentity.exitCode === 0;
  let manifestPaths = [];
  let manifestTruncated = false;
  let trackedFileCount = 0;
  let headOid = "";
  let branch = "";
  let statusText = "";
  let diffText = "";
  let untrackedState = [];

  if (gitAvailable) {
    const identityLines = String(gitIdentity.stdout || "")
      .split(/\r?\n/)
      .filter(Boolean);
    headOid = identityLines[1] || "";
    branch = identityLines[2] || "";
    const [tracked, untracked, status, diff] = await Promise.all([
      captureProcess("git", ["ls-files", "-z"], {
        cwd: root,
        timeoutMs: 12_000,
        env: minimalCommandEnv(),
      }),
      captureProcess("git", ["ls-files", "-z", "--others", "--exclude-standard"], {
        cwd: root,
        timeoutMs: 12_000,
        env: minimalCommandEnv(),
      }),
      captureProcess("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
        cwd: root,
        timeoutMs: 12_000,
        env: minimalCommandEnv(),
      }),
      captureProcess("git", ["diff", "--binary", "--no-ext-diff", "HEAD", "--"], {
        cwd: root,
        timeoutMs: 20_000,
        env: minimalCommandEnv(),
      }),
    ]);
    const trackedPaths = String(tracked.stdout || "")
      .split("\0")
      .filter(Boolean)
      .map((entry) => displayRelPath(entry));
    const untrackedPaths = String(untracked.stdout || "")
      .split("\0")
      .filter(Boolean)
      .map((entry) => displayRelPath(entry));
    trackedFileCount = trackedPaths.length;
    manifestTruncated =
      tracked.stdoutTruncated === true ||
      untracked.stdoutTruncated === true ||
      trackedPaths.length + untrackedPaths.length >
        REPOSITORY_SEMANTIC_MANIFEST_LIMIT;
    manifestPaths = [...new Set([...trackedPaths, ...untrackedPaths])]
      .sort()
      .slice(0, REPOSITORY_SEMANTIC_MANIFEST_LIMIT);
    statusText = String(status.stdout || "");
    diffText = String(diff.stdout || "");
    for (const relPath of untrackedPaths.slice(0, 400)) {
      try {
        const { fullPath } = resolveWithinRoot(relPath);
        const stat = await fs.lstat(fullPath);
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        untrackedState.push({
          relativePath: relPath,
          sizeBytes: stat.size,
          mtimeMs: Math.floor(stat.mtimeMs),
        });
      } catch {}
    }
  } else {
    const generic = await genericRepositoryManifest();
    manifestPaths = generic.paths;
    manifestTruncated = generic.truncated;
  }

  const evidence = await repositorySemanticEvidence(manifestPaths);
  return {
    schema: "workspace_repository_semantic_observation@1",
    projectId,
    workspaceKind,
    gitAvailable,
    headOid,
    branch,
    dirtyPathCount: statusText
      ? statusText.split("\0").filter(Boolean).length
      : 0,
    statusDigest: sha256Digest(statusText),
    diffDigest: sha256Digest(diffText),
    untrackedStateDigest: sha256Digest(JSON.stringify(untrackedState)),
    manifestDigest: sha256Digest(JSON.stringify(manifestPaths)),
    trackedFileCount,
    manifestPaths,
    manifestTruncated,
    evidence,
    evidenceCatalogComplete:
      !manifestTruncated &&
      evidence.length < REPOSITORY_SEMANTIC_EVIDENCE_LIMIT,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
    observedAt,
  };
}

function directEpistemicProfileRequest(params = {}) {
  const profile = params.profile && typeof params.profile === "object" ? params.profile : {};
  const rawMarkers = Array.isArray(profile.markers) ? profile.markers : [];
  const rawSources = Array.isArray(profile.sources) ? profile.sources : [];
  if (rawMarkers.length > 64 || rawSources.length > 64) {
    throw new Error("direct_epistemic_profile_bounds_exceeded");
  }
  const markers = rawMarkers
    .slice(0, 64)
    .map((entry) => displayRelPath(normalizeRelPath(entry)))
    .filter(Boolean);
  const sources = rawSources
    .slice(0, 64)
    .map((entry) => ({
      id: String(entry?.id || "").trim(),
      relativePath: displayRelPath(normalizeRelPath(entry?.path || "")),
      facet: String(entry?.facet || "").trim(),
      expectedContentDigest: String(entry?.contentDigest || entry?.expectedContentDigest || "").trim().toLowerCase(),
    }))
    .filter((entry) => entry.id && entry.relativePath);
  return {
    profileId: String(profile.profileId || "").trim(),
    revision: Number(profile.revision || 1),
    markers,
    sources,
  };
}

async function directEpistemicFileDigest(relativePath, maxBytes) {
  const resolved = await resolveFileWithinRoot(relativePath);
  if (path.resolve(resolved.realRoot) !== path.resolve(root) ||
      path.resolve(resolved.fullPath) !== path.resolve(resolved.requestedFullPath)) {
    throw new Error("direct_epistemic_physical_path_rejected");
  }
  const requestedStat = await fs.lstat(resolved.requestedFullPath);
  if (requestedStat.isSymbolicLink()) throw new Error("direct_epistemic_symlink_rejected");
  const noFollow = Number(fsSync.constants.O_NOFOLLOW || 0);
  let file;
  try {
    file = await fs.open(resolved.requestedFullPath, fsSync.constants.O_RDONLY | noFollow);
  } catch {
    throw new Error("direct_epistemic_source_open_rejected");
  }
  const sameStat = (left, right) => Boolean(left && right) &&
    left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let totalBytes = 0;
  let before;
  let after;
  try {
    before = await file.stat();
    if (!before.isFile()) throw new Error("direct_epistemic_source_not_file");
    if (before.size > maxBytes) throw new Error("direct_epistemic_source_too_large");
    let bytesRead = 0;
    do {
      const result = await file.read(buffer, 0, buffer.length, null);
      bytesRead = result.bytesRead;
      totalBytes += bytesRead;
      if (totalBytes > maxBytes) throw new Error("direct_epistemic_source_too_large");
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
    after = await file.stat();
  } finally {
    await file.close();
  }
  let finalPathStat = null;
  try { finalPathStat = await fs.lstat(resolved.requestedFullPath); } catch {}
  if (!sameStat(before, after) || totalBytes !== after.size ||
      !sameStat(requestedStat, after) || !sameStat(finalPathStat, after) || finalPathStat?.isSymbolicLink()) {
    throw new Error("direct_epistemic_source_changed_during_read");
  }
  return {
    sizeBytes: after.size,
    contentDigest: hash.digest("hex"),
  };
}

async function directEpistemicUntrackedState(paths) {
  const omissions = [];
  const files = [];
  let totalBytes = 0;
  if (paths.length > DIRECT_EPISTEMIC_UNTRACKED_FILE_LIMIT) {
    omissions.push("untracked_file_count_limit_exceeded");
  }
  for (const relativePath of paths.slice(0, DIRECT_EPISTEMIC_UNTRACKED_FILE_LIMIT)) {
    try {
      const resolved = await resolveFileWithinRoot(relativePath);
      const requestedStat = await fs.lstat(resolved.requestedFullPath);
      if (requestedStat.isSymbolicLink()) {
        omissions.push(`untracked_symlink_rejected:${relativePath}`);
        continue;
      }
      const stat = await fs.lstat(resolved.fullPath);
      if (!stat.isFile()) continue;
      if (stat.size > DIRECT_EPISTEMIC_UNTRACKED_FILE_BYTES || totalBytes + stat.size > DIRECT_EPISTEMIC_UNTRACKED_TOTAL_BYTES) {
        omissions.push(`untracked_content_limit_exceeded:${relativePath}`);
        continue;
      }
      const digest = await directEpistemicFileDigest(relativePath, DIRECT_EPISTEMIC_UNTRACKED_FILE_BYTES);
      totalBytes += digest.sizeBytes;
      files.push({ relativePath, ...digest });
    } catch (error) {
      omissions.push(`untracked_unavailable:${relativePath}:${String(error?.message || "unknown")}`);
    }
  }
  files.sort((left, right) => left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0);
  return { files, omissions, digest: canonicalDigest(files), totalBytes };
}

async function directEpistemicGitCapture() {
  const identity = await captureDigestProcess("git", ["rev-parse", "--show-toplevel", "HEAD", "--abbrev-ref", "HEAD"], {
    cwd: root,
    timeoutMs: 10_000,
  });
  if (identity.exitCode !== 0 || identity.stdoutTruncated) throw new Error("direct_epistemic_git_identity_failed");
  const lines = identity.stdout.toString("utf8").split(/\r?\n/).filter(Boolean);
  const realRoot = await fs.realpath(root);
  const realGitRoot = await fs.realpath(lines[0] || root);
  if (path.resolve(realRoot) !== path.resolve(realGitRoot)) throw new Error("direct_epistemic_repository_root_mismatch");
  const [status, diff, untracked] = await Promise.all([
    captureDigestProcess("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd: root, timeoutMs: 20_000 }),
    captureDigestProcess("git", ["diff", "--no-ext-diff", "--binary", "HEAD", "--"], { cwd: root, timeoutMs: 60_000, captureLimit: 0 }),
    captureDigestProcess("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd: root, timeoutMs: 20_000 }),
  ]);
  if ([status, diff, untracked].some((entry) => entry.exitCode !== 0)) throw new Error("direct_epistemic_git_observation_failed");
  const untrackedPaths = untracked.stdout.toString("utf8").split("\0").filter(Boolean).sort();
  return {
    gitHead: lines[1] || "",
    branch: lines[2] || "",
    statusDigest: status.stdoutDigest,
    statusText: status.stdout.toString("utf8"),
    statusTruncated: status.stdoutTruncated,
    trackedDiffDigest: diff.stdoutDigest,
    trackedDiffBytes: diff.stdoutBytes,
    untrackedPaths,
    untrackedListDigest: untracked.stdoutDigest,
    untrackedListTruncated: untracked.stdoutTruncated,
  };
}

async function directEpistemicProfileSourceState(requestedProfile) {
  const sources = [];
  const omissions = [];
  for (const source of requestedProfile.sources) {
    try {
      const observed = await directEpistemicFileDigest(source.relativePath, DIRECT_EPISTEMIC_PROFILE_SOURCE_BYTES);
      const validationPosture = Boolean(source.expectedContentDigest) &&
        source.expectedContentDigest === observed.contentDigest
        ? "exact"
        : "digest_mismatch";
      if (validationPosture !== "exact") omissions.push(`profile_source_digest_mismatch:${source.id}`);
      sources.push({
        id: source.id,
        relativePath: source.relativePath,
        facet: source.facet,
        ...observed,
        expectedContentDigest: source.expectedContentDigest,
        validationPosture,
      });
    } catch (error) {
      omissions.push(`profile_source_unavailable:${source.id}:${String(error?.message || "unknown")}`);
    }
  }
  const digest = canonicalDigest(sources.map((source) => ({
    id: source.id,
    relativePath: source.relativePath,
    facet: source.facet,
    sizeBytes: source.sizeBytes,
    contentDigest: source.contentDigest,
    expectedContentDigest: source.expectedContentDigest,
    validationPosture: source.validationPosture,
  })));
  return { sources, omissions: [...new Set(omissions)].sort(), digest };
}

async function directEpistemicProfileMarkerState(requestedProfile) {
  const markers = [];
  const omissions = [];
  for (const marker of requestedProfile.markers) {
    let present = false;
    try {
      const resolved = await resolveFileWithinRoot(marker);
      const requestedStat = await fs.lstat(resolved.requestedFullPath);
      present = !requestedStat.isSymbolicLink();
    } catch {}
    markers.push({ marker, present });
    if (!present) omissions.push(`profile_marker_missing:${marker}`);
  }
  return {
    markers,
    omissions: [...new Set(omissions)].sort(),
    digest: canonicalDigest(markers),
  };
}

async function directEpistemicRepositoryObservation(params = {}) {
  const requestedProfile = directEpistemicProfileRequest(params);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const before = await directEpistemicGitCapture();
    const markerState = await directEpistemicProfileMarkerState(requestedProfile);
    const sourceState = await directEpistemicProfileSourceState(requestedProfile);
    const untracked = await directEpistemicUntrackedState(before.untrackedPaths);
    const substrateOmissions = [...untracked.omissions];
    const after = await directEpistemicGitCapture();
    const untrackedAfter = await directEpistemicUntrackedState(after.untrackedPaths);
    const markerStateAfter = await directEpistemicProfileMarkerState(requestedProfile);
    const sourceStateAfter = await directEpistemicProfileSourceState(requestedProfile);
    const substrateCoherent = before.gitHead === after.gitHead &&
      before.branch === after.branch &&
      before.statusDigest === after.statusDigest &&
      before.trackedDiffDigest === after.trackedDiffDigest &&
      before.untrackedListDigest === after.untrackedListDigest &&
      untracked.digest === untrackedAfter.digest;
    const profileCoherent = markerState.digest === markerStateAfter.digest &&
      canonicalDigest(markerState.omissions) === canonicalDigest(markerStateAfter.omissions) &&
      sourceState.digest === sourceStateAfter.digest &&
      canonicalDigest(sourceState.omissions) === canonicalDigest(sourceStateAfter.omissions);
    const coherent = substrateCoherent && profileCoherent;
    if (!coherent && attempt < 2) continue;
    if (!substrateCoherent) substrateOmissions.push("repository_changed_during_observation");
    const profileValidationOmissions = [
      ...markerStateAfter.omissions,
      ...sourceStateAfter.omissions,
    ];
    if (!profileCoherent) profileValidationOmissions.push("profile_sources_changed_during_observation");
    if (before.statusTruncated || before.untrackedListTruncated || after.statusTruncated || after.untrackedListTruncated) {
      substrateOmissions.push("git_observation_capture_truncated");
    }
    const sources = sourceStateAfter.sources;
    const sourceSetDigest = sourceStateAfter.digest;
    const untrackedDigest = untracked.digest;
    const normalizedSubstrateOmissions = [...new Set(substrateOmissions)].sort();
    const normalizedProfileOmissions = [...new Set(profileValidationOmissions)].sort();
    const validationOmissions = [...new Set([...normalizedSubstrateOmissions, ...normalizedProfileOmissions])].sort();
    const substrateObservationComplete = substrateCoherent && normalizedSubstrateOmissions.length === 0;
    const profileValidationComplete = profileCoherent && normalizedProfileOmissions.length === 0;
    const worktreeDigest = canonicalDigest({
      gitHead: before.gitHead,
      branch: before.branch,
      trackedDiffDigest: before.trackedDiffDigest,
      untrackedDigest,
      statusDigest: before.statusDigest,
      untrackedSetDigest: before.untrackedListDigest,
      substrateCoherent,
      substrateOmissionsDigest: canonicalDigest(normalizedSubstrateOmissions),
    });
    const gitWitnessBeforeDigest = canonicalDigest({
      gitHead: before.gitHead,
      branch: before.branch,
      statusDigest: before.statusDigest,
      trackedDiffDigest: before.trackedDiffDigest,
      untrackedSetDigest: before.untrackedListDigest,
    });
    const gitWitnessAfterDigest = canonicalDigest({
      gitHead: after.gitHead,
      branch: after.branch,
      statusDigest: after.statusDigest,
      trackedDiffDigest: after.trackedDiffDigest,
      untrackedSetDigest: after.untrackedListDigest,
    });
    return {
      schema: "direct_epistemic_repository_observation@1",
      profile: {
        profileId: requestedProfile.profileId,
        revision: requestedProfile.revision,
      },
      gitHead: before.gitHead,
      branch: before.branch,
      dirty: before.statusText.split("\0").filter(Boolean).length > 0,
      statusEntryCount: before.statusText.split("\0").filter(Boolean).length,
      trackedDiffBytes: before.trackedDiffBytes,
      untrackedFileCount: untracked.files.length,
      untrackedFiles: untracked.files,
      trackedDiffDigest: before.trackedDiffDigest,
      untrackedDigest,
      statusDigest: before.statusDigest,
      sourceSetDigest,
      worktreeDigest,
      sources,
      omissions: validationOmissions,
      validationOmissions,
      substrateOmissions: normalizedSubstrateOmissions,
      profileValidationOmissions: normalizedProfileOmissions,
      observationComplete: substrateObservationComplete && profileValidationComplete,
      substrateObservationComplete,
      profileValidationComplete,
      captureCoherent: coherent,
      substrateCoherent,
      profileCoherent,
      captureAttempts: attempt,
      gitWitnessBeforeDigest,
      gitWitnessAfterDigest,
      rawWorkspacePathIncluded: false,
      rawFileContentIncluded: false,
      attempt,
    };
  }
  throw new Error("direct_epistemic_repository_observation_failed");
}

function sourceLanguageForPath(relPath) {
  const extension = path.extname(
    String(relPath || ""),
  ).toLowerCase();
  const languages = {
    ".c": "c",
    ".cc": "cpp",
    ".cpp": "cpp",
    ".css": "css",
    ".go": "go",
    ".h": "c",
    ".hpp": "cpp",
    ".html": "html",
    ".java": "java",
    ".js": "javascript",
    ".json": "json",
    ".jsx": "javascript",
    ".md": "markdown",
    ".mjs": "javascript",
    ".py": "python",
    ".rb": "ruby",
    ".rs": "rust",
    ".sh": "shell",
    ".sql": "sql",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".yaml": "yaml",
    ".yml": "yaml",
  };
  return languages[extension] || "";
}

async function repositoryRealizationContext(
  params = {},
) {
  const requestedPaths = [
    ...new Set(
      (
        Array.isArray(
          params.relativePaths,
        )
          ? params.relativePaths
          : []
      )
        .map((entry) =>
          displayRelPath(entry))
        .filter(Boolean),
    ),
  ].slice(
    0,
    ARO_REALIZATION_CONTEXT_FILE_LIMIT,
  );
  const evidence = [];
  const rejectedPaths = [];
  let totalExcerptBytes = 0;
  for (const relativePath of requestedPaths) {
    const sensitiveReason =
      sensitiveReadFileReason(
        relativePath,
      );
    if (sensitiveReason) {
      rejectedPaths.push({
        relativePath,
        reason:
          `sensitive_path:${sensitiveReason}`,
      });
      continue;
    }
    try {
      const resolved =
        await resolveFileWithinRoot(
          relativePath,
        );
      const requestedStat =
        await fs.lstat(
          resolved.requestedFullPath,
        );
      const stat =
        await fs.lstat(
          resolved.fullPath,
        );
      if (
        requestedStat.isSymbolicLink() ||
        stat.isSymbolicLink()
      ) {
        rejectedPaths.push({
          relativePath,
          reason: "symlink_rejected",
        });
        continue;
      }
      if (!stat.isFile()) {
        rejectedPaths.push({
          relativePath,
          reason: "not_a_file",
        });
        continue;
      }
      if (
        stat.size >
          REPOSITORY_SEMANTIC_MAX_EVIDENCE_FILE_BYTES
      ) {
        rejectedPaths.push({
          relativePath,
          reason: "file_too_large",
        });
        continue;
      }
      const content =
        await fs.readFile(
          resolved.fullPath,
        );
      if (looksBinary(content)) {
        rejectedPaths.push({
          relativePath,
          reason: "binary_rejected",
        });
        continue;
      }
      const remaining =
        ARO_REALIZATION_CONTEXT_TOTAL_BYTES -
        totalExcerptBytes;
      if (remaining <= 0) break;
      const excerptLimit = Math.min(
        ARO_REALIZATION_CONTEXT_EXCERPT_BYTES,
        remaining,
      );
      const excerptBuffer =
        content.subarray(
          0,
          excerptLimit,
        );
      const excerpt =
        excerptBuffer.toString("utf8");
      totalExcerptBytes +=
        excerptBuffer.length;
      evidence.push({
        evidenceKey:
          `realization_evidence_${
            evidence.length + 1
          }`,
        evidenceKind:
          repositoryEvidenceKind(
            relativePath,
          ),
        relativePath,
        language:
          sourceLanguageForPath(
            relativePath,
          ),
        sizeBytes: stat.size,
        digest:
          sha256Digest(content),
        lineStart: 1,
        lineEnd: Math.max(
          1,
          excerpt
            .split(/\r?\n/)
            .length,
        ),
        excerpt,
        excerptTruncated:
          content.length >
          excerptBuffer.length,
      });
    } catch (error) {
      rejectedPaths.push({
        relativePath,
        reason:
          error?.code === "ENOENT"
            ? "not_found"
            : "read_failed",
      });
    }
  }
  const gitIdentity =
    await captureProcess(
      "git",
      [
        "rev-parse",
        "HEAD",
        "--abbrev-ref",
        "HEAD",
      ],
      {
        cwd: root,
        timeoutMs: 8_000,
        env: minimalCommandEnv(),
      },
    ).catch(() => ({
      exitCode: 1,
      stdout: "",
    }));
  const identityLines =
    String(
      gitIdentity.stdout || "",
    )
      .split(/\r?\n/)
      .filter(Boolean);
  const [status, diff] =
    gitIdentity.exitCode === 0
      ? await Promise.all([
          captureProcess(
            "git",
            [
              "status",
              "--porcelain=v1",
              "-z",
              "--untracked-files=all",
            ],
            {
              cwd: root,
              timeoutMs: 12_000,
              env: minimalCommandEnv(),
            },
          ),
          captureProcess(
            "git",
            [
              "diff",
              "--binary",
              "--no-ext-diff",
              "HEAD",
              "--",
            ],
            {
              cwd: root,
              timeoutMs: 20_000,
              env: minimalCommandEnv(),
            },
          ),
        ])
      : [
          { stdout: "" },
          { stdout: "" },
        ];
  return {
    schema:
      "workspace_aro_realization_context_observation@1",
    projectId,
    workspaceKind,
    repositoryIdentity: {
      headOid:
        identityLines[0] || "",
      branch:
        identityLines[1] || "",
      statusDigest:
        sha256Digest(
          String(
            status.stdout || "",
          ),
        ),
      diffDigest:
        sha256Digest(
          String(diff.stdout || ""),
        ),
    },
    requestedPaths,
    evidence,
    rejectedPaths,
    sourceInspectionEffect: true,
    workspaceMutationEffect: false,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
    observedAt:
      new Date().toISOString(),
  };
}

function looksBinary(buffer) {
  if (!buffer.length) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return true;
    if (byte < 7 || (byte > 13 && byte < 32)) suspicious += 1;
  }
  return suspicious / sample.length > 0.12;
}

function mimeTypeForFileName(fileName) {
  const ext = path.extname(String(fileName || "")).toLowerCase();
  const table = {
    ".bmp": "image/bmp",
    ".c": "text/x-c",
    ".cc": "text/x-c++src",
    ".cpp": "text/x-c++src",
    ".cxx": "text/x-c++src",
    ".css": "text/css",
    ".csv": "text/csv",
    ".gif": "image/gif",
    ".go": "text/x-go",
    ".h": "text/x-c",
    ".hh": "text/x-c++src",
    ".hpp": "text/x-c++src",
    ".hxx": "text/x-c++src",
    ".htm": "text/html",
    ".html": "text/html",
    ".java": "text/x-java",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript",
    ".json": "application/json",
    ".jsonl": "application/x-ndjson",
    ".md": "text/markdown",
    ".pdf": "application/pdf",
    ".php": "text/x-php",
    ".png": "image/png",
    ".py": "text/x-python",
    ".rb": "text/x-ruby",
    ".rs": "text/rust",
    ".sh": "text/x-sh",
    ".svg": "image/svg+xml",
    ".toml": "application/toml",
    ".ts": "text/typescript",
    ".tsx": "text/tsx",
    ".txt": "text/plain",
    ".webp": "image/webp",
    ".xml": "application/xml",
    ".yaml": "application/yaml",
    ".yml": "application/yaml",
  };
  return table[ext] || "application/octet-stream";
}

async function readFilePreview(params = {}) {
  const normalizedRel = displayRelPath(normalizeRelPath(params.relPath || ""));
  if (params.rejectSensitive === true) assertNoEncodedTraversal(String(params.relPath || ""));
  if (params.rejectSensitive === true && sensitiveReadFileReason(normalizedRel)) {
    const error = new Error("Sensitive file preview is denied for this request.");
    error.code = "SENSITIVE_PATH_DENIED";
    throw error;
  }
  const { fullPath, requestedFullPath, displayRel } = await resolveFileWithinRoot(normalizedRel);
  const requestedStat = await fs.lstat(requestedFullPath);
  if (requestedStat.isSymbolicLink()) throw new Error("Symlink preview is disabled for this workspace agent.");
  const stat = await fs.lstat(fullPath);
  if (!stat.isFile()) throw new Error("Selected path is not a file.");

  const requestedLimit = Number(params.maxBytes || params.limit || PREVIEW_LIMIT_BYTES);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(PREVIEW_LIMIT_BYTES, Math.floor(requestedLimit))
    : PREVIEW_LIMIT_BYTES;
  const bytesToRead = Math.min(stat.size, limit);
  const file = await fs.open(fullPath, "r");
  let buffer;
  try {
    buffer = Buffer.alloc(bytesToRead);
    if (bytesToRead > 0) await file.read(buffer, 0, bytesToRead, 0);
  } finally {
    await file.close();
  }

  const binary = looksBinary(buffer);
  return {
    relPath: displayRel,
    absolutePath: fullPath,
    size: stat.size,
    truncated: stat.size > limit,
    binary,
    limit,
    text: binary ? "" : buffer.toString("utf8"),
    source: workspaceKind,
  };
}

async function readFileTransfer(params = {}) {
  const { fullPath, displayRel } = resolveWithinRoot(params.relPath || "");
  const stat = await fs.lstat(fullPath);
  if (stat.isSymbolicLink()) throw new Error("Symlink transfer is disabled for this workspace agent.");
  if (!stat.isFile()) throw new Error("Selected path is not a file.");
  if (stat.size > MAX_CHATGPT_REVIEW_FILE_BYTES) {
    throw new Error(`Selected file exceeds the ${Math.round(MAX_CHATGPT_REVIEW_FILE_BYTES / (1024 * 1024))} MB ChatGPT transfer limit.`);
  }
  const content = await fs.readFile(fullPath);
  const fileName = path.basename(fullPath);
  return {
    relPath: displayRel,
    fileName,
    size: stat.size,
    mimeType: mimeTypeForFileName(fileName),
    contentBase64: content.toString("base64"),
    source: workspaceKind,
  };
}


function escapeRegex(value) {
  return String(value).replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegex(pattern) {
  const normalized = String(pattern || "").replace(/\\/g, "/").trim();
  if (!normalized) return null;
  let output = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === "*" && next === "*") {
      const after = normalized[index + 2];
      if (after === "/") {
        output += "(?:.*/)?";
        index += 2;
      } else {
        output += ".*";
        index += 1;
      }
    } else if (char === "*") {
      output += "[^/]*";
    } else if (char === "?") {
      output += "[^/]";
    } else {
      output += escapeRegex(char);
    }
  }
  output += "$";
  return new RegExp(output, "i");
}

function matchesAnyPattern(relPath, regexes) {
  const normalized = String(relPath || "").replace(/\\/g, "/");
  return regexes.some((regex) => regex.test(normalized));
}

async function listMatchingFiles(params = {}) {
  const patterns = Array.isArray(params.patterns) ? params.patterns.filter((item) => typeof item === "string" && item.trim()) : [];
  const ignored = new Set(
    (Array.isArray(params.ignoredRelPaths) ? params.ignoredRelPaths : [])
      .filter((item) => typeof item === "string" && item.trim())
      .map((item) => item.replace(/\\/g, "/")),
  );
  const regexes = patterns.map(globToRegex).filter(Boolean);
  if (!regexes.length) {
    return { root, patterns, entries: [], skipped: 0, scanned: 0, limit: MATCH_SCAN_LIMIT, source: workspaceKind };
  }

  const entries = [];
  let skipped = 0;
  let scanned = 0;

  async function walk(relDir) {
    if (scanned >= MATCH_WALK_LIMIT || entries.length >= MATCH_SCAN_LIMIT) return;
    const { fullPath, displayRel } = resolveWithinRoot(relDir);
    let dirents;
    try {
      dirents = await fs.readdir(fullPath, { withFileTypes: true });
    } catch {
      skipped += 1;
      return;
    }

    // Admit files at the current semantic entry point before descending. A
    // large early directory (for example local runtime state) must not exhaust
    // the walk budget and hide canonical root files such as README.md.
    const orderedDirents = [
      ...dirents.filter((dirent) => direntType(dirent) !== "dir"),
      ...dirents.filter((dirent) => direntType(dirent) === "dir"),
    ];
    for (const dirent of orderedDirents) {
      if (scanned >= MATCH_WALK_LIMIT || entries.length >= MATCH_SCAN_LIMIT) return;
      const type = direntType(dirent);
      if (type === "dir" && SKIPPED_DIR_NAMES.has(dirent.name)) {
        skipped += 1;
        continue;
      }
      const childRel = displayRel ? `${displayRel}/${dirent.name}` : dirent.name;
      scanned += 1;
      if (type === "dir") {
        await walk(childRel);
      } else if (type === "file" && !ignored.has(childRel) && matchesAnyPattern(childRel, regexes)) {
        try {
          const stat = await fs.lstat(path.join(root, childRel.split("/").join(path.sep)));
          entries.push({
            name: dirent.name,
            relPath: childRel,
            type: "file",
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            mtime: stat.mtime.toISOString(),
          });
        } catch {
          skipped += 1;
        }
      }
    }
  }

  await walk("");
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs || a.relPath.localeCompare(b.relPath));
  return {
    root,
    patterns,
    entries,
    skipped,
    scanned,
    limit: MATCH_SCAN_LIMIT,
    walkLimit: MATCH_WALK_LIMIT,
    source: workspaceKind,
  };
}

async function resolvePathPreview(params = {}) {
  const { fullPath, displayRel } = resolveWithinRoot(params.relPath || "");
  const stat = await fs.lstat(fullPath);
  return {
    relPath: displayRel,
    absolutePath: fullPath,
    isFile: stat.isFile(),
    isDirectory: stat.isDirectory(),
    size: stat.size,
    source: workspaceKind,
  };
}

function appendLimited(chunks, chunk, limitBytes) {
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
  let current = chunks.reduce((sum, item) => sum + item.length, 0);
  if (current >= limitBytes) return true;
  if (current + buffer.length <= limitBytes) {
    chunks.push(buffer);
    return false;
  }
  chunks.push(buffer.subarray(0, limitBytes - current));
  return true;
}

async function captureDigestProcess(command, args, options = {}) {
  const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : DEFAULT_COMMAND_TIMEOUT_MS;
  const captureLimit = Number.isFinite(Number(options.captureLimit))
    ? Math.max(0, Number(options.captureLimit))
    : DIRECT_EPISTEMIC_CAPTURE_LIMIT_BYTES;
  return new Promise((resolve, reject) => {
    const child = trackChildProcess(spawn(command, args, {
      cwd: options.cwd || root,
      env: options.env || minimalCommandEnv(),
      shell: false,
      windowsHide: true,
    }));
    const stdoutHash = crypto.createHash("sha256");
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stdoutCapturedBytes = 0;
    let stderrTruncated = false;
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) terminateChild(child);
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      const buffer = Buffer.from(chunk);
      stdoutHash.update(buffer);
      stdoutBytes += buffer.length;
      if (stdoutCapturedBytes < captureLimit) {
        const slice = buffer.subarray(0, Math.max(0, captureLimit - stdoutCapturedBytes));
        if (slice.length) stdoutChunks.push(slice);
        stdoutCapturedBytes += slice.length;
      }
    });
    child.stderr.on("data", (chunk) => {
      stderrTruncated = appendLimited(stderrChunks, chunk, 32 * 1024) || stderrTruncated;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      settled = true;
      reject(error);
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      settled = true;
      resolve({
        exitCode,
        signal,
        stdout: Buffer.concat(stdoutChunks),
        stdoutBytes,
        stdoutDigest: stdoutHash.digest("hex"),
        stdoutTruncated: stdoutBytes > stdoutCapturedBytes,
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        stderrTruncated,
      });
    });
  });
}

async function runCommand(params = {}) {
  const command = String(params.command || "").trim();
  if (!command) throw new Error("Command is required.");
  const args = Array.isArray(params.args) ? params.args.map((arg) => String(arg)) : [];
  const { fullPath, displayRel } = resolveWithinRoot(params.cwdRelPath || "");
  const timeoutMs = Number.isFinite(Number(params.timeoutMs))
    ? Math.max(1000, Math.min(Number(params.timeoutMs), 10 * 60_000))
    : DEFAULT_COMMAND_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = trackChildProcess(spawn(command, args, {
      cwd: fullPath,
      env: { ...process.env, ...(params.env && typeof params.env === "object" ? params.env : {}) },
      shell: false,
      windowsHide: true,
    }));

    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      terminateChild(child);
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdoutTruncated = appendLimited(stdoutChunks, chunk, COMMAND_OUTPUT_LIMIT_BYTES) || stdoutTruncated;
    });
    child.stderr.on("data", (chunk) => {
      stderrTruncated = appendLimited(stderrChunks, chunk, COMMAND_OUTPUT_LIMIT_BYTES) || stderrTruncated;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      settled = true;
      reject(error);
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      settled = true;
      resolve({
        command,
        args,
        cwdRelPath: displayRel,
        exitCode,
        signal,
        durationMs: Date.now() - startedAt,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        stdoutTruncated,
        stderrTruncated,
        outputLimit: COMMAND_OUTPUT_LIMIT_BYTES,
      });
    });
  });
}

function minimalCommandEnv(extraEnv = {}) {
  const base = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "SystemRoot", "ComSpec"]) {
    if (process.env[key]) base[key] = process.env[key];
  }
  base.CI = "1";
  base.NO_COLOR = "1";
  return { ...base, ...(extraEnv && typeof extraEnv === "object" ? extraEnv : {}) };
}

function killProcessTree(child, signal) {
  if (!child || !child.pid) return;
  try {
    if (process.platform !== "win32") {
      process.kill(-child.pid, signal);
      return;
    }
  } catch {
    // Fall back to killing the parent process if process-group cleanup failed.
  }
  try {
    child.kill(signal);
  } catch {
    // Ignore cleanup races.
  }
}

function parseGitStatusPorcelain(text) {
  const lines = String(text || "").split(/\r?\n/).filter(Boolean);
  const entries = [];
  for (const line of lines) {
    const status = line.slice(0, 2);
    const rawPath = line.slice(3).trim();
    if (!rawPath) continue;
    const relPath = rawPath.includes(" -> ") ? rawPath.split(" -> ").pop() : rawPath;
    let changeKind = "modified";
    if (status.includes("?") || status.includes("A")) changeKind = "created";
    if (status.includes("D")) changeKind = "deleted";
    if (!status.trim()) changeKind = "unknown";
    let gitStatus = "modified";
    if (status.includes("?")) gitStatus = "untracked";
    else if (status.includes("!")) gitStatus = "ignored";
    else if (status.includes("A")) gitStatus = "added";
    else if (status.includes("D")) gitStatus = "deleted";
    entries.push({
      relPath: displayRelPath(relPath.replace(/^"|"$/g, "")),
      changeKind,
      gitStatus,
    });
  }
  return entries;
}

async function workspaceEffectSnapshot() {
  const git = await captureProcess("git", ["status", "--porcelain"], {
    cwd: root,
    timeoutMs: 5000,
    env: minimalCommandEnv(),
  }).catch((error) => ({ exitCode: 1, stderr: error.message, stdout: "" }));
  if (git.exitCode !== 0) {
    return {
      supported: false,
      scanScope: "none",
      scanFailed: true,
      digest: "",
      entries: [],
      error: String(git.stderr || "").slice(0, 500),
    };
  }
  const entries = parseGitStatusPorcelain(git.stdout);
  return {
    supported: true,
    scanScope: "git-status",
    scanFailed: false,
    digest: crypto.createHash("sha256").update(JSON.stringify(entries)).digest("hex"),
    entries,
  };
}

function workspaceEffectSummary(before, after) {
  if (!after?.supported) {
    return {
      preCommandWorkspaceDigest: before?.digest || "",
      postCommandWorkspaceDigest: after?.digest || "",
      changedPathCount: 0,
      changedPathsPreview: [],
      changedPathsTruncated: false,
      scanScope: "none",
      scanFailed: true,
    };
  }
  const beforeMap = new Map((before?.entries || []).map((entry) => [entry.relPath, entry.changeKind]));
  const changed = [];
  for (const entry of after.entries || []) {
    if (beforeMap.get(entry.relPath) !== entry.changeKind) changed.push(entry);
  }
  for (const entry of before?.entries || []) {
    if (!(after.entries || []).some((next) => next.relPath === entry.relPath)) {
      changed.push({ relPath: entry.relPath, changeKind: "unknown" });
    }
  }
  return {
    preCommandWorkspaceDigest: before?.digest || "",
    postCommandWorkspaceDigest: after.digest || "",
    changedPathCount: changed.length,
    changedPathsPreview: changed.slice(0, 25),
    changedPathsTruncated: changed.length > 25,
    scanScope: after.scanScope || "git-status",
    scanFailed: false,
  };
}

async function runDirectCommand(params = {}) {
  const command = String(params.command || "").trim();
  if (!command) throw new Error("Command is required.");
  const args = Array.isArray(params.args) ? params.args.map((arg) => String(arg)) : [];
  const { fullPath, displayRel } = resolveWithinRoot(params.cwdRelPath || "");
  const timeoutMs = Number.isFinite(Number(params.timeoutMs))
    ? Math.max(1000, Math.min(Number(params.timeoutMs), 2 * 60_000))
    : DEFAULT_COMMAND_TIMEOUT_MS;
  const backendCapabilities = {
    shellFalseSupported: true,
    cwdContainmentSupported: true,
    timeoutKillSupported: true,
    envSanitizationSupported: true,
    networkIsolationSupported: false,
    processTreeKillSupported: process.platform !== "win32",
    workspaceEffectScanSupported: true,
  };
  const beforeEffects = await workspaceEffectSnapshot();
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd: fullPath,
      env: minimalCommandEnv(params.env),
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
    });

    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      killProcessTree(child, "SIGTERM");
      setTimeout(() => {
        if (!settled) killProcessTree(child, "SIGKILL");
      }, 1200);
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdoutTruncated = appendLimited(stdoutChunks, chunk, COMMAND_OUTPUT_LIMIT_BYTES) || stdoutTruncated;
    });
    child.stderr.on("data", (chunk) => {
      stderrTruncated = appendLimited(stderrChunks, chunk, COMMAND_OUTPUT_LIMIT_BYTES) || stderrTruncated;
    });
    child.on("error", async (error) => {
      clearTimeout(timer);
      settled = true;
      const afterEffects = await workspaceEffectSnapshot();
      resolve({
        command,
        args,
        cwdRelPath: displayRel,
        exitCode: null,
        signal: "",
        spawnError: String(error.message || error).slice(0, 500),
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        stdoutTruncated,
        stderrTruncated,
        outputLimit: COMMAND_OUTPUT_LIMIT_BYTES,
        workspaceEffects: workspaceEffectSummary(beforeEffects, afterEffects),
        backendCapabilities,
        backgroundProcessCheck: {
          supported: false,
          orphanedProcessSuspected: false,
        },
      });
    });
    child.on("close", async (exitCode, signal) => {
      clearTimeout(timer);
      settled = true;
      const afterEffects = await workspaceEffectSnapshot();
      resolve({
        command,
        args,
        cwdRelPath: displayRel,
        exitCode,
        signal,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        stdoutTruncated,
        stderrTruncated,
        outputLimit: COMMAND_OUTPUT_LIMIT_BYTES,
        workspaceEffects: workspaceEffectSummary(beforeEffects, afterEffects),
        backendCapabilities,
        backgroundProcessCheck: {
          supported: false,
          orphanedProcessSuspected: false,
        },
      });
    });
  });
}

function captureProcess(command, args, options = {}) {
  const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : DEFAULT_COMMAND_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const child = trackChildProcess(spawn(command, args, {
      cwd: options.cwd || root,
      env: { ...process.env, ...(options.env && typeof options.env === "object" ? options.env : {}) },
      shell: false,
      windowsHide: true,
    }));
    const stdoutChunks = [];
    const stderrChunks = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      terminateChild(child);
    }, timeoutMs);
    child.stdout.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      clearTimeout(timer);
      settled = true;
      reject(error);
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      settled = true;
      resolve({
        exitCode,
        signal,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    });
  });
}

function safeWorkspaceWorkerKey(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(text)) {
    const error = new Error("Workspace worker key must use only lowercase letters, digits, underscores, and hyphens.");
    error.code = "workspace_worker_key_invalid";
    throw error;
  }
  return text;
}

function safeWorkspaceWorkerBranch(value) {
  const text = String(value || "").trim();
  if (
    !/^codex\/worker\/[a-z0-9][a-z0-9._/-]{0,150}$/.test(text) ||
    text.includes("..") ||
    text.endsWith(".") ||
    text.endsWith("/") ||
    text.includes("//") ||
    /[~^:?*\[\\\s]/.test(text)
  ) {
    const error = new Error("Workspace worker branch must be a safe local codex/worker/* branch.");
    error.code = "workspace_worker_branch_invalid";
    throw error;
  }
  return text;
}

async function exactGitWorkspace() {
  const result = await captureProcess("git", ["rev-parse", "--show-toplevel", "--git-dir"], {
    cwd: root,
    timeoutMs: 10_000,
  });
  if (result.exitCode !== 0) {
    const error = new Error("Workspace root is not an attached Git worktree.");
    error.code = "workspace_worker_git_unavailable";
    throw error;
  }
  const lines = String(result.stdout || "").split(/\r?\n/).filter(Boolean);
  const topLevel = path.resolve(lines[0] || "");
  const realRoot = await fs.realpath(root);
  const realTopLevel = await fs.realpath(topLevel);
  const rootsMatch = process.platform === "win32"
    ? realRoot.toLowerCase() === realTopLevel.toLowerCase()
    : realRoot === realTopLevel;
  if (!rootsMatch) {
    const error = new Error("Workspace worker provisioning requires the configured workspace root to be the Git top level.");
    error.code = "workspace_worker_git_root_mismatch";
    throw error;
  }
  return {
    topLevel: realTopLevel,
    gitDir: lines[1] || "",
  };
}

function workspaceWorkerRootFor(topLevel, workerKey) {
  return path.join(
    path.dirname(topLevel),
    ".codex-worktrees",
    path.basename(topLevel),
    safeWorkspaceWorkerKey(workerKey),
  );
}

async function provisionGitWorktree(params = {}) {
  const workerKey = safeWorkspaceWorkerKey(params.workerKey);
  const branch = safeWorkspaceWorkerBranch(params.branch);
  const baseRef = String(params.baseRef || "HEAD").trim();
  if (!baseRef || /[\0\r\n]/.test(baseRef) || baseRef.startsWith("-")) {
    const error = new Error("Workspace worker base ref is invalid.");
    error.code = "workspace_worker_base_ref_invalid";
    throw error;
  }
  const git = await exactGitWorkspace();
  const statusResult = await captureProcess("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    cwd: git.topLevel,
    timeoutMs: 10_000,
  });
  if (statusResult.exitCode !== 0) {
    const error = new Error("Git could not verify the parent workspace state before worker provisioning.");
    error.code = "workspace_worker_parent_status_unavailable";
    throw error;
  }
  if (Buffer.byteLength(String(statusResult.stdout || ""), "utf8") > 0) {
    const error = new Error("Workspace worker provisioning requires a clean committed parent checkout in EXEC1.");
    error.code = "workspace_worker_parent_worktree_dirty";
    throw error;
  }
  const commitResult = await captureProcess("git", ["rev-parse", "--verify", `${baseRef}^{commit}`], {
    cwd: git.topLevel,
    timeoutMs: 10_000,
  });
  const baseCommit = String(commitResult.stdout || "").trim();
  if (commitResult.exitCode !== 0 || !/^[a-f0-9]{40,64}$/i.test(baseCommit)) {
    const error = new Error("Workspace worker base ref did not resolve to one commit.");
    error.code = "workspace_worker_base_ref_unresolved";
    throw error;
  }
  const branchResult = await captureProcess("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
    cwd: git.topLevel,
    timeoutMs: 10_000,
  });
  if (branchResult.exitCode === 0) {
    const error = new Error("Workspace worker branch already exists.");
    error.code = "workspace_worker_branch_collision";
    throw error;
  }
  const worktreePath = workspaceWorkerRootFor(git.topLevel, workerKey);
  if (await pathExists(worktreePath)) {
    const error = new Error("Workspace worker directory already exists.");
    error.code = "workspace_worker_directory_collision";
    throw error;
  }
  await fs.mkdir(path.dirname(worktreePath), { recursive: true });
  const add = await captureProcess("git", ["worktree", "add", "-b", branch, worktreePath, baseCommit], {
    cwd: git.topLevel,
    timeoutMs: 30_000,
  });
  if (add.exitCode !== 0) {
    const error = new Error("Git could not provision the workspace worker worktree.");
    error.code = "workspace_worker_provision_failed";
    throw error;
  }
  const rootEvidenceDigest = sha256Digest(await fs.realpath(worktreePath));
  const bindingBase = {
    schema: "direct_workspace_worker_binding@1",
    projectId,
    workerKey,
    workspaceKind,
    branch,
    baseCommit,
    rootEvidenceDigest,
    retainedAfterCompletion: true,
    rawWorkspacePathIncluded: false,
  };
  const bindingDigest = sha256Digest(canonicalJson(bindingBase));
  return {
    ...bindingBase,
    bindingId: `workspace_worker_binding_${bindingDigest.slice(7, 31)}`,
    bindingDigest,
    worktreePath,
  };
}

async function removeGitWorktree(params = {}) {
  const workerKey = safeWorkspaceWorkerKey(params.workerKey);
  const branch = safeWorkspaceWorkerBranch(params.branch);
  const git = await exactGitWorkspace();
  const worktreePath = workspaceWorkerRootFor(git.topLevel, workerKey);
  const remove = await captureProcess("git", ["worktree", "remove", "--force", worktreePath], {
    cwd: git.topLevel,
    timeoutMs: 30_000,
  });
  if (remove.exitCode !== 0 && await pathExists(worktreePath)) {
    const error = new Error("Git could not remove the workspace worker worktree.");
    error.code = "workspace_worker_remove_failed";
    throw error;
  }
  let branchRemoved = false;
  if (params.deleteBranch === true) {
    const deleted = await captureProcess("git", ["branch", "-D", branch], {
      cwd: git.topLevel,
      timeoutMs: 10_000,
    });
    branchRemoved = deleted.exitCode === 0;
  }
  return {
    schema: "direct_workspace_worker_cleanup@1",
    workerKey,
    branch,
    worktreeRemoved: !(await pathExists(worktreePath)),
    branchRemoved,
    rawWorkspacePathIncluded: false,
  };
}

function serializeGitWorktreeMutation(operation) {
  const pending = gitWorktreeMutationQueue.then(operation, operation);
  gitWorktreeMutationQueue = pending.catch(() => {});
  return pending;
}

async function directTestProfile() {
  const packageJsonPath = path.join(root, "package.json");
  if (await pathExists(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
      if (typeof packageJson?.scripts?.test === "string" && packageJson.scripts.test.trim()) {
        const base = {
          schema: "direct_workspace_worker_test_profile@1",
          profileId: "node_package_test",
          command: "npm",
          baseArgs: ["test"],
          targetsAllowed: false,
          workspaceKind,
        };
        return { ...base, profileDigest: sha256Digest(canonicalJson(base)), available: true };
      }
    } catch {}
  }
  const pythonMarkers = ["pyproject.toml", "pytest.ini", "setup.cfg", "tox.ini"];
  if ((await Promise.all(pythonMarkers.map((name) => pathExists(path.join(root, name))))).some(Boolean)) {
    const base = {
      schema: "direct_workspace_worker_test_profile@1",
      profileId: "python_pytest",
      command: process.platform === "win32" ? "python" : "python3",
      baseArgs: ["-m", "pytest"],
      targetsAllowed: true,
      workspaceKind,
    };
    return { ...base, profileDigest: sha256Digest(canonicalJson(base)), available: true };
  }
  const makefilePath = path.join(root, "Makefile");
  if (await pathExists(makefilePath)) {
    const body = await fs.readFile(makefilePath, "utf8").catch(() => "");
    if (/^test\s*:/m.test(body)) {
      const base = {
        schema: "direct_workspace_worker_test_profile@1",
        profileId: "make_test",
        command: "make",
        baseArgs: ["test"],
        targetsAllowed: false,
        workspaceKind,
      };
      return { ...base, profileDigest: sha256Digest(canonicalJson(base)), available: true };
    }
  }
  return {
    schema: "direct_workspace_worker_test_profile@1",
    profileId: "",
    profileDigest: "",
    available: false,
    targetsAllowed: false,
    workspaceKind,
  };
}

function safeTestTargets(values = []) {
  const source = Array.isArray(values) ? values : [];
  if (source.length > DIRECT_WORKSPACE_WORKER_TARGET_LIMIT) {
    const error = new Error("Workspace worker test target count exceeded the compiled limit.");
    error.code = "workspace_worker_test_targets_exceeded";
    throw error;
  }
  return source.map((value) => {
    const target = String(value || "").trim();
    if (
      !target ||
      target.length > DIRECT_WORKSPACE_WORKER_TARGET_CHARS ||
      target.startsWith("-") ||
      /[\0\r\n|&;`$<>]/.test(target)
    ) {
      const error = new Error("Workspace worker test target is invalid.");
      error.code = "workspace_worker_test_target_invalid";
      throw error;
    }
    const filePart = target.split("::", 1)[0];
    resolveWithinRoot(filePart);
    return target.replace(/\\/g, "/");
  });
}

async function runDirectTest(params = {}) {
  const profile = await directTestProfile();
  if (!profile.available) {
    const error = new Error("No bounded test profile is available in this workspace.");
    error.code = "workspace_worker_test_profile_unavailable";
    throw error;
  }
  if (!params.profileDigest || params.profileDigest !== profile.profileDigest) {
    const error = new Error("Workspace worker test profile changed after constitution compilation.");
    error.code = "workspace_worker_test_profile_drift";
    throw error;
  }
  const targets = safeTestTargets(params.targets);
  if (targets.length && profile.targetsAllowed !== true) {
    const error = new Error("The compiled test profile does not permit provider-selected targets.");
    error.code = "workspace_worker_test_targets_not_allowed";
    throw error;
  }
  const timeoutMs = Number.isFinite(Number(params.timeoutMs))
    ? Math.max(1000, Math.min(Number(params.timeoutMs), DIRECT_WORKSPACE_WORKER_TIMEOUT_MS))
    : DIRECT_WORKSPACE_WORKER_TIMEOUT_MS;
  const result = await runDirectCommand({
    command: profile.command,
    args: [...profile.baseArgs, ...targets],
    cwdRelPath: "",
    timeoutMs,
  });
  return {
    ...result,
    schema: "direct_workspace_worker_test_result@1",
    command: profile.profileId,
    args: targets,
    testProfileId: profile.profileId,
    testProfileDigest: profile.profileDigest,
    rawCommandIncluded: false,
    rawWorkspacePathIncluded: false,
  };
}

function toGitExcludePatternPath(value) {
  return String(value || "").split(path.sep).join("/").replace(/^\/+|\/+$/g, "");
}

async function ensureCodexSandboxArtifactIgnored() {
  const git = await captureProcess("git", ["rev-parse", "--show-toplevel", "--git-path", "info/exclude"], {
    cwd: root,
    timeoutMs: 5000,
  }).catch((error) => ({ exitCode: 1, stderr: error.message }));
  if (git.exitCode !== 0) {
    return {
      available: false,
      changed: false,
      reason: "workspace-is-not-a-git-worktree",
      error: String(git.stderr || "").trim(),
    };
  }

  const lines = String(git.stdout || "").split(/\r?\n/).filter(Boolean);
  const topLevel = path.resolve(lines[0] || root);
  const rawExcludePath = lines[1] || ".git/info/exclude";
  const excludePath = path.isAbsolute(rawExcludePath) ? rawExcludePath : path.resolve(root, rawExcludePath);
  const relRoot = path.relative(topLevel, root);
  const relPattern = toGitExcludePatternPath(relRoot);
  const pattern = relPattern ? `/${relPattern}/${CODEX_SANDBOX_ARTIFACT_NAME}` : `/${CODEX_SANDBOX_ARTIFACT_NAME}`;

  let existing = "";
  try {
    existing = await fs.readFile(excludePath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const existingLines = existing.split(/\r?\n/).map((line) => line.trim());
  if (existingLines.includes(pattern)) {
    return {
      available: true,
      changed: false,
      pattern,
      excludePath,
      reason: "already-ignored",
    };
  }

  const separator = existing && !existing.endsWith("\n") ? "\n" : "";
  const addition = `${separator}${existing ? "\n" : ""}${CODEX_SANDBOX_ARTIFACT_EXCLUDE_COMMENT}\n${pattern}\n`;
  await fs.mkdir(path.dirname(excludePath), { recursive: true });
  await fs.appendFile(excludePath, addition, "utf8");
  return {
    available: true,
    changed: true,
    pattern,
    excludePath,
    reason: "added-local-git-exclude",
  };
}

async function watchStatus() {
  return {
    available: typeof fsSync.watch === "function",
    active: false,
    note: "Watcher protocol scaffold is present; persistent watch subscriptions are reserved for the next iteration.",
  };
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function defaultCodexHomeCandidates() {
  const primary = path.join(os.homedir(), ".codex");
  const legacy = path.join(os.homedir(), ".codex-custom");
  const candidates = [await pathExists(path.join(primary, "session_index.jsonl")) ? primary : legacy];
  const windowsUsersRoot = "/mnt/c/Users";
  try {
    const userDirs = await fs.readdir(windowsUsersRoot, { withFileTypes: true });
    for (const dirent of userDirs) {
      if (!dirent.isDirectory()) continue;
      const candidate = path.join(windowsUsersRoot, dirent.name, ".codex");
      if (await pathExists(path.join(candidate, "session_index.jsonl"))) candidates.push(candidate);
    }
  } catch {
    // Non-WSL environments won't expose /mnt/c. Ignore silently.
  }
  return candidates;
}

async function resolveCodexHomes(params = {}) {
  const requestedHomes = Array.isArray(params.homePaths)
    ? params.homePaths.filter((item) => typeof item === "string" && item.trim()).map((item) => path.resolve(item))
    : [];
  const candidates = requestedHomes.length ? requestedHomes : await defaultCodexHomeCandidates();
  const dedupedCandidates = Array.from(new Set(candidates));
  const resolved = [];
  for (const candidate of dedupedCandidates) {
    if (await pathExists(path.join(candidate, "session_index.jsonl"))) resolved.push(candidate);
  }
  return resolved.length ? resolved : dedupedCandidates.slice(0, 1);
}

async function resolveCodexHome(params = {}) {
  const homes = await resolveCodexHomes(params);
  if (homes.length) return homes[0];
  const fallback = path.join(os.homedir(), ".codex");
  return fallback;
}

function sortCodexThreadEntries(entries) {
  return entries.slice().sort((a, b) => {
    const updatedDelta = String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    if (updatedDelta !== 0) return updatedDelta;
    const createdDelta = String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    if (createdDelta !== 0) return createdDelta;
    return String(a.title || "").localeCompare(String(b.title || ""));
  });
}

function timestampMs(value) {
  if (!value) return null;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function codexThreadActivityStamp({ indexUpdatedAt = "", sessionFileMtime = "", createdAt = "" } = {}) {
  const candidates = [
    { source: "session_file", value: sessionFileMtime, ms: timestampMs(sessionFileMtime) },
    { source: "session_index", value: indexUpdatedAt, ms: timestampMs(indexUpdatedAt) },
    { source: "session_created", value: createdAt, ms: timestampMs(createdAt) },
  ].filter((candidate) => candidate.value && candidate.ms !== null);
  candidates.sort((a, b) => b.ms - a.ms);
  const selected = candidates[0];
  return {
    updatedAt: selected?.value || "",
    updatedAtSource: selected?.source || "unknown",
  };
}

function nullableFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function extractSubagentSessionMeta(payload = {}) {
  const source = payload?.source || {};
  const spawn = source?.subagent?.thread_spawn ||
    source?.subAgent?.threadSpawn ||
    source?.subagent?.threadSpawn ||
    source?.subAgent?.thread_spawn ||
    null;
  return {
    parentThreadId: String(spawn?.parent_thread_id || spawn?.parentThreadId || ""),
    agentRole: String(payload.agent_role || payload.agentRole || spawn?.agent_role || spawn?.agentRole || ""),
    agentNickname: String(payload.agent_nickname || payload.agentNickname || spawn?.agent_nickname || spawn?.agentNickname || ""),
    agentPath: String(spawn?.agent_path || spawn?.agentPath || ""),
    depth: nullableFiniteNumber(spawn?.depth),
    isSubagent: Boolean(spawn),
    source,
  };
}

async function listCodexThreadsFromHome(codexHome, options = {}) {
  const { originators, includeSubagents, perHomeScanLimit, fastMode } = options;
  const sessionIndexPath = path.join(codexHome, "session_index.jsonl");
  const sessionsRoot = path.join(codexHome, "sessions");
  const rawIndex = await fs.readFile(sessionIndexPath, "utf8");
  const rows = rawIndex
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .slice(-perHomeScanLimit)
    .reverse();

  const inferredOriginator = String(codexHome || "").includes("/mnt/c/Users/")
    ? "Codex Desktop"
    : "codex_vscode";

  if (fastMode) {
    const fastEntries = [];
    for (const row of rows) {
      const indexUpdatedAt = String(row.updated_at || "");
      fastEntries.push({
        threadId: String(row.id || ""),
        title: String(row.thread_name || "Untitled Codex thread"),
        updatedAt: indexUpdatedAt,
        indexUpdatedAt,
        updatedAtSource: indexUpdatedAt ? "session_index" : "unknown",
        cwd: "",
        originator: inferredOriginator,
        sessionFilePath: "",
        sessionFileMtime: "",
        createdAt: "",
        sourceHome: codexHome,
        parentThreadId: "",
        agentRole: "",
        agentNickname: "",
        isSubagent: false,
        sessionFileMtimeMs: 0,
        sessionFileSizeBytes: 0,
      });
    }
    return fastEntries.filter((entry) => entry.threadId);
  }
  const wantedIds = new Set(rows.map((row) => String(row.id || "")).filter(Boolean));
  const metadataById = new Map();
  await walkJsonlFiles(sessionsRoot, async (fullPath) => {
    if (metadataById.size >= wantedIds.size) return true;
    let line;
    try {
      line = await readJsonlFirstLine(fullPath);
    } catch {
      return false;
    }
    if (!line) return false;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      return false;
    }
    const payload = entry?.payload || {};
    const sessionId = String(payload.id || "");
    if (!wantedIds.has(sessionId) || metadataById.has(sessionId)) return false;
    let stat = null;
    try {
      stat = await fs.lstat(fullPath);
    } catch {}
    const subagentMeta = extractSubagentSessionMeta(payload);
    metadataById.set(sessionId, {
      sessionId,
      cwd: String(payload.cwd || ""),
      originator: String(payload.originator || "unknown"),
      filePath: fullPath,
      createdAt: String(payload.timestamp || entry.timestamp || ""),
      parentThreadId: subagentMeta.parentThreadId,
      agentRole: subagentMeta.agentRole,
      agentNickname: subagentMeta.agentNickname,
      agentPath: subagentMeta.agentPath,
      depth: subagentMeta.depth,
      isSubagent: subagentMeta.isSubagent,
      sessionFileMtimeMs: Number.isFinite(Number(stat?.mtimeMs)) ? Math.round(Number(stat.mtimeMs)) : 0,
      sessionFileMtime: stat?.mtime instanceof Date ? stat.mtime.toISOString() : "",
      sessionFileSizeBytes: Number.isFinite(Number(stat?.size)) ? Math.round(Number(stat.size)) : 0,
    });
    return metadataById.size >= wantedIds.size;
  });

  const entries = [];
  for (const row of rows) {
    const sessionId = String(row.id || "");
    const meta = metadataById.get(sessionId) || {};
    const originator = String(meta.originator || inferredOriginator || "unknown");
    if (originators.size && !originators.has(originator)) continue;
    if (!includeSubagents && meta.isSubagent) continue;
    const indexUpdatedAt = String(row.updated_at || "");
    const createdAt = String(meta.createdAt || "");
    const sessionFileMtime = String(meta.sessionFileMtime || "");
    const activity = codexThreadActivityStamp({ indexUpdatedAt, sessionFileMtime, createdAt });
    entries.push({
      threadId: sessionId,
      title: String(row.thread_name || "Untitled Codex thread"),
      updatedAt: activity.updatedAt,
      indexUpdatedAt,
      updatedAtSource: activity.updatedAtSource,
      cwd: String(meta.cwd || ""),
      originator,
      sessionFilePath: String(meta.filePath || ""),
      sessionFileMtime,
      createdAt,
      sourceHome: codexHome,
      parentThreadId: String(meta.parentThreadId || ""),
      agentRole: String(meta.agentRole || ""),
      agentNickname: String(meta.agentNickname || ""),
      agentPath: String(meta.agentPath || ""),
      depth: meta.depth ?? null,
      isSubagent: Boolean(meta.isSubagent),
      sessionFileMtimeMs: Number.isFinite(Number(meta.sessionFileMtimeMs)) ? Number(meta.sessionFileMtimeMs) : 0,
      sessionFileSizeBytes: Number.isFinite(Number(meta.sessionFileSizeBytes)) ? Number(meta.sessionFileSizeBytes) : 0,
    });
  }
  return entries;
}

function dedupeCodexThreadEntries(entries) {
  const byId = new Map();
  for (const entry of entries) {
    const key = String(entry.threadId || "");
    if (!key) continue;
    if (!byId.has(key)) {
      byId.set(key, entry);
      continue;
    }
    const current = byId.get(key);
    const updatedDelta = String(entry.updatedAt || "").localeCompare(String(current.updatedAt || ""));
    if (updatedDelta > 0) {
      byId.set(key, entry);
      continue;
    }
    if (updatedDelta === 0) {
      const currentIsLegacy = String(current.sourceHome || "").endsWith(".codex-custom");
      const incomingIsLegacy = String(entry.sourceHome || "").endsWith(".codex-custom");
      if (currentIsLegacy && !incomingIsLegacy) byId.set(key, entry);
    }
  }
  return Array.from(byId.values());
}

async function listCodexThreads(params = {}) {
  const limit = Number.isFinite(Number(params.limit))
    ? Math.max(1, Math.min(Number(params.limit), 300))
    : CODEX_THREAD_LIMIT;
  const originators = new Set(
    (Array.isArray(params.originators) ? params.originators : [])
      .filter((item) => typeof item === "string" && item.trim())
      .map((item) => item.trim()),
  );
  const includeSubagents = Boolean(params.includeSubagents);
  const fastMode = Boolean(params.fastMode);
  const dedupeByThreadId = params.dedupeByThreadId !== false;
  const codexHomes = await resolveCodexHomes(params);
  const perHomeScanLimit = Number.isFinite(Number(params.perHomeScanLimit))
    ? Math.max(40, Math.min(Number(params.perHomeScanLimit), 800))
    : Math.max(Math.min(limit * 2, 360), 120);
  const allEntries = [];
  for (const codexHome of codexHomes) {
    try {
      const homeEntries = await listCodexThreadsFromHome(codexHome, {
        originators,
        includeSubagents,
        fastMode,
        perHomeScanLimit,
      });
      allEntries.push(...homeEntries);
    } catch {
      // Ignore unavailable/invalid homes and keep the remaining sources.
    }
  }
  const deduped = dedupeByThreadId
    ? dedupeCodexThreadEntries(allEntries)
    : allEntries.filter((entry) => String(entry.threadId || "").trim());
  const entries = sortCodexThreadEntries(deduped).slice(0, limit);
  return {
    root,
    source: workspaceKind,
    codexHome: codexHomes[0] || "",
    sourceHomes: codexHomes,
    entries,
    limit,
    includeSubagents,
    fastMode,
    dedupeByThreadId,
    perHomeScanLimit,
  };
}

function safeCodexTranscriptLimit(value) {
  if (!Number.isFinite(Number(value))) return CODEX_TRANSCRIPT_ENTRY_LIMIT;
  return Math.max(50, Math.min(Number(value), 2000));
}

function extractContentText(content = []) {
  if (!Array.isArray(content)) return "";
  const chunks = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const text = typeof part.text === "string" ? part.text.trim() : "";
    if (text) {
      chunks.push(text);
      continue;
    }
    if (part.type === "input_image" || part.type === "output_image") {
      const ref = String(part.image_url || part.path || "").trim();
      chunks.push(ref ? `[image] ${ref}` : "[image]");
    }
  }
  return chunks.join("\n\n").trim();
}

function compactStoredText(value, maxLength = CODEX_STORED_PROCESS_TEXT_LIMIT) {
  const text = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value, null, 2);
  const normalized = String(text || "").trim();
  if (!normalized) return "";
  const limit = Math.max(80, Number(maxLength) || CODEX_STORED_PROCESS_TEXT_LIMIT);
  return normalized.length > limit
    ? `${normalized.slice(0, limit)}\n... [${normalized.length - limit} chars omitted]`
    : normalized;
}

function parseJsonObject(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function parseSubagentNotificationText(value) {
  const raw = String(value || "").trim();
  if (!raw.toLowerCase().startsWith("<subagent_notification>")) return null;
  const match = raw.match(/^<subagent_notification>\s*([\s\S]*?)\s*<\/subagent_notification>\s*$/i);
  const bodyText = match ? match[1].trim() : "";
  const body = parseJsonObject(bodyText);
  if (!body) {
    const agentPath = raw.match(/"(?:agent_path|agentPath|agent_id|agentId)"\s*:\s*"([^"]+)"/)?.[1] || "";
    return {
      agentPath,
      statusKey: "unknown",
      statusDetail: "",
      rawText: raw,
    };
  }
  const status = body.status;
  let statusKey = "";
  let statusDetail = "";
  if (typeof status === "string") {
    statusKey = status;
  } else if (status && typeof status === "object") {
    const [key, value] = Object.entries(status)[0] || [];
    statusKey = String(key || "");
    if (typeof value === "string") statusDetail = value;
  }
  const agentPath = String(body.agent_path || body.agentPath || body.agent_id || body.agentId || "").trim();
  if (!agentPath && !statusKey) return null;
  return {
    agentPath,
    statusKey: statusKey || "unknown",
    statusDetail,
    rawText: raw,
  };
}

function durationMillis(duration) {
  if (!duration || typeof duration !== "object") return null;
  const secs = Number(duration.secs ?? duration.seconds ?? 0);
  const nanos = Number(duration.nanos ?? duration.nanoseconds ?? 0);
  const millis = secs * 1000 + nanos / 1_000_000;
  return Number.isFinite(millis) && millis >= 0 ? Math.round(millis) : null;
}

function sourceRowRef(rowIndex, payload, kind) {
  return {
    rowIndex,
    eventId: String(payload.event_id || payload.eventId || payload.id || ""),
    itemId: String(payload.item_id || payload.itemId || ""),
    callId: String(payload.call_id || payload.callId || ""),
    kind,
  };
}

function createTranscriptTurn(turnId, rowIndex, kind) {
  const stableId = String(turnId || "").trim();
  return {
    turnKey: stableId || `stored_orphan_turn_${rowIndex}`,
    turnId: stableId,
    sourceRows: [{ rowIndex, kind }],
    userMessages: [],
    systemMessages: [],
    assistantFinalMessages: [],
    thoughtItems: [],
    status: "unknown",
    startedAt: null,
    completedAt: null,
    durationMs: null,
  };
}

function createStoredPresentationBuilder(threadId, sourceFile, threadMeta = {}) {
  const turns = [];
  const turnById = new Map();
  const orphanItems = [];
  const warnings = [];
  const callItems = new Map();
  let currentTurnId = "";

  function ensureTurn(turnId, rowIndex, kind = "unknown") {
    const id = String(turnId || "").trim() || currentTurnId;
    if (!id) return null;
    let turn = turnById.get(id);
    if (!turn) {
      turn = createTranscriptTurn(id, rowIndex, kind);
      turnById.set(id, turn);
      turns.push(turn);
    } else {
      turn.sourceRows.push({ rowIndex, kind });
    }
    return turn;
  }

  function rowTurnId(payload = {}) {
    return String(payload.turn_id || payload.turnId || payload.turn?.id || "").trim() || currentTurnId;
  }

  function updateCurrentTurn(row, rowIndex) {
    const payload = row.payload || {};
    const found = String(payload.turn_id || payload.turnId || payload.id || payload.turn?.id || "").trim();
    if (row.type === "turn_context" && found) currentTurnId = found;
    if (row.type === "event_msg" && payload.type === "task_started" && found) {
      currentTurnId = found;
      const turn = ensureTurn(found, rowIndex, "task_started");
      if (turn) {
        turn.status = "partial";
        turn.startedAt = payload.started_at || payload.startedAt || row.timestamp || turn.startedAt || null;
      }
    }
    if (row.type === "event_msg" && payload.type === "task_complete") {
      const turn = ensureTurn(found || currentTurnId, rowIndex, "task_complete");
      if (turn) {
        turn.status = payload.last_agent_message ? "complete" : "unknown";
        turn.completedAt = payload.completed_at || payload.completedAt || row.timestamp || turn.completedAt || null;
        const durationMs = Number(payload.duration_ms ?? payload.durationMs);
        if (Number.isFinite(durationMs) && durationMs >= 0) turn.durationMs = durationMs;
        else {
          const payloadDurationMs = durationMillis(payload.duration);
          if (Number.isFinite(payloadDurationMs) && payloadDurationMs >= 0) turn.durationMs = payloadDurationMs;
          else {
            const startedMs = parseIsoMillis(turn.startedAt);
            const completedMs = parseIsoMillis(turn.completedAt);
            if (startedMs !== null && completedMs !== null && completedMs >= startedMs) {
              turn.durationMs = completedMs - startedMs;
            }
          }
        }
      }
    }
  }

  function addMessage(turn, target, message) {
    if (!turn || !message?.text) return;
    const list = target === "user"
      ? turn.userMessages
      : target === "system"
        ? turn.systemMessages
        : turn.assistantFinalMessages;
    const previous = list[list.length - 1];
    if (
      previous &&
      previous.role === message.role &&
      previous.phase === message.phase &&
      previous.text === message.text &&
      Math.abs(Number(previous.sourceOrderEnd || 0) - Number(message.sourceOrderStart || 0)) <= 2
    ) {
      previous.sourceRows.push(...message.sourceRows);
      previous.sourceOrderEnd = message.sourceOrderEnd;
      return;
    }
    list.push(message);
  }

  function addThoughtItem(turn, item) {
    if (!item) return;
    if (!turn) {
      orphanItems.push(item);
      warnings.push({
        kind: "orphan_process_item",
        message: `Stored process item ${item.id || item.type || "unknown"} could not be attached to a turn with confidence.`,
        sourceRows: item.sourceRows || [],
      });
      return;
    }
    const previous = turn.thoughtItems[turn.thoughtItems.length - 1];
    if (
      previous &&
      item.type === "agentMessage" &&
      previous.type === item.type &&
      previous.phase === item.phase &&
      item.text &&
      previous.text === item.text &&
      Math.abs(Number(previous.sourceOrderEnd || 0) - Number(item.sourceOrderStart || 0)) <= 2
    ) {
      previous.sourceRows.push(...(item.sourceRows || []));
      previous.sourceOrderEnd = item.sourceOrderEnd;
      return;
    }
    turn.thoughtItems.push(item);
  }

  function callKey(turn, callId, fallback) {
    return `${turn?.turnKey || "orphan"}:${String(callId || fallback || "").trim()}`;
  }

  function existingCallItem(turn, callId, fallbackId) {
    return callItems.get(callKey(turn, callId, fallbackId));
  }

  function mergeCallItem(turn, callId, fallbackId, patch) {
    const key = callKey(turn, callId, fallbackId);
    const existing = callItems.get(key);
    if (existing) {
      const sourceRows = [...(existing.sourceRows || []), ...(patch.sourceRows || [])];
      const sourceOrderStart = Math.min(
        Number(existing.sourceOrderStart || patch.sourceOrderStart || 0),
        Number(patch.sourceOrderStart || existing.sourceOrderStart || 0),
      );
      const sourceOrderEnd = Math.max(
        Number(existing.sourceOrderEnd || patch.sourceOrderEnd || 0),
        Number(patch.sourceOrderEnd || existing.sourceOrderEnd || 0),
      );
      Object.assign(existing, patch, { sourceRows, sourceOrderStart, sourceOrderEnd });
      return existing;
    }
    callItems.set(key, patch);
    addThoughtItem(turn, patch);
    return patch;
  }

  function commandFromArgs(args, payload) {
    if (Array.isArray(payload.command)) return payload.command.join(" ");
    if (typeof args?.cmd === "string") return args.cmd;
    if (Array.isArray(args?.cmd)) return args.cmd.join(" ");
    if (typeof args?.command === "string") return args.command;
    return "";
  }

  function collabToolFromFunctionName(name) {
    const normalized = String(name || "").trim();
    const map = {
      spawn_agent: "spawnAgent",
      send_input: "sendInput",
      send_message: "sendInput",
      resume_agent: "resumeAgent",
      wait_agent: "wait",
      close_agent: "closeAgent",
    };
    return map[normalized] || "";
  }

  function receiverThreadIdsFromCollabArgs(args = {}) {
    const candidates = [
      args.id,
      args.agent_id,
      args.agentId,
      args.target,
      args.thread_id,
      args.threadId,
      args.ids,
      args.agent_ids,
      args.agentIds,
    ];
    const ids = [];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        for (const item of candidate) ids.push(String(item || ""));
      } else if (candidate) {
        ids.push(String(candidate));
      }
    }
    return Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
  }

  function collabPromptFromArgs(args = {}) {
    if (typeof args.message === "string") return args.message;
    if (typeof args.prompt === "string") return args.prompt;
    if (Array.isArray(args.items)) return compactStoredText(args.items, 1200);
    return "";
  }

  function changesFromPatchPayload(payload) {
    const changes = payload.changes && typeof payload.changes === "object" ? payload.changes : {};
    return Object.entries(changes).map(([filePath, change]) => ({
      path: filePath,
      kind: String(change?.type || change?.kind || "change"),
      type: String(change?.type || change?.kind || "change"),
      summary: compactStoredText(change?.unified_diff || change?.content || change, 600),
    }));
  }

  function normalizeCollabToolPayload(payload) {
    const receiverThreadIds = Array.isArray(payload.receiver_thread_ids)
      ? payload.receiver_thread_ids
      : Array.isArray(payload.receiverThreadIds)
        ? payload.receiverThreadIds
        : [];
    const agentsStates = Array.isArray(payload.agents_states)
      ? payload.agents_states
      : Array.isArray(payload.agentsStates)
        ? payload.agentsStates
        : [];
    return {
      tool: String(payload.tool || "call"),
      status: String(payload.status || "unknown"),
      senderThreadId: String(payload.sender_thread_id || payload.senderThreadId || ""),
      receiverThreadIds: receiverThreadIds.map((id) => String(id || "")).filter(Boolean),
      prompt: String(payload.prompt || ""),
      model: String(payload.model || ""),
      reasoningEffort: String(payload.reasoning_effort || payload.reasoningEffort || ""),
      agentsStates: agentsStates.map((agent) => ({
        threadId: String(agent?.thread_id || agent?.threadId || ""),
        status: String(agent?.status || "unknown"),
        nickname: String(agent?.nickname || agent?.agent_nickname || agent?.agentNickname || ""),
        role: String(agent?.role || agent?.agent_role || agent?.agentRole || ""),
      })).filter((agent) => agent.threadId || agent.status),
    };
  }

  function ingest(row, rowIndex) {
    if (!row || typeof row !== "object") return;
    const payload = row.payload || {};
    const payloadType = String(payload.type || "").trim();
    updateCurrentTurn(row, rowIndex);
    const at = String(row.timestamp || payload.timestamp || "");
    const turn = ensureTurn(rowTurnId(payload), rowIndex, payloadType || row.type);
    const sourceRows = [sourceRowRef(rowIndex, payload, payloadType || row.type)];
    const base = {
      at,
      sourceRows,
      sourceFile,
      sourceOrderStart: rowIndex,
      sourceOrderEnd: rowIndex,
    };

    if (row.type === "response_item" && payloadType === "message") {
      const role = String(payload.role || "").toLowerCase();
      if (!role || role === "developer") return;
      const text = extractContentText(payload.content || []);
      if (!text) return;
      const phase = String(payload.phase || "");
      const notification = role === "user" ? parseSubagentNotificationText(text) : null;
      if (notification) {
        addThoughtItem(turn, {
          ...base,
          id: `stored_subagent_notification_${rowIndex}`,
          type: "subagentNotification",
          status: notification.statusKey,
          statusKey: notification.statusKey,
          statusDetail: notification.statusDetail,
          agentPath: notification.agentPath,
          text: notification.rawText,
          sourceType: "response_item.message.subagent_notification",
        });
        return;
      }
      const message = {
        ...base,
        id: `stored_msg_${rowIndex}`,
        role: role === "assistant" || role === "user" ? role : "system",
        text,
        phase,
        sourceType: "response_item.message",
      };
      if (message.role === "user") addMessage(turn, "user", message);
      else if (message.role === "assistant" && String(phase).toLowerCase() === "commentary") {
        addThoughtItem(turn, { ...base, id: `stored_agent_${rowIndex}`, type: "agentMessage", phase: "commentary", text });
      } else if (message.role === "assistant") addMessage(turn, "assistant", message);
      else addMessage(turn, "system", message);
      return;
    }

    if (row.type === "event_msg" && payloadType === "user_message") {
      const text = String(payload.message || "").trim();
      if (!text) return;
      const notification = parseSubagentNotificationText(text);
      if (notification) {
        addThoughtItem(turn, {
          ...base,
          id: `stored_subagent_notification_${rowIndex}`,
          type: "subagentNotification",
          status: notification.statusKey,
          statusKey: notification.statusKey,
          statusDetail: notification.statusDetail,
          agentPath: notification.agentPath,
          text: notification.rawText,
          sourceType: "event_msg.user_message.subagent_notification",
        });
        return;
      }
      addMessage(turn, "user", {
        ...base,
        id: `stored_user_${rowIndex}`,
        role: "user",
        text,
        phase: "",
        sourceType: "event_msg.user_message",
      });
      return;
    }

    if (row.type === "event_msg" && payloadType === "agent_message") {
      const text = String(payload.message || "").trim();
      if (!text) return;
      const phase = String(payload.phase || "");
      if (phase.toLowerCase() === "commentary") {
        addThoughtItem(turn, { ...base, id: `stored_agent_${rowIndex}`, type: "agentMessage", phase: "commentary", text });
      } else {
        addMessage(turn, "assistant", {
          ...base,
          id: `stored_agent_final_${rowIndex}`,
          role: "assistant",
          text,
          phase,
          sourceType: "event_msg.agent_message",
        });
      }
      return;
    }

    if (row.type === "response_item" && payloadType === "reasoning") {
      const summary = Array.isArray(payload.summary) ? payload.summary.filter(Boolean).map(String) : [];
      const content = Array.isArray(payload.content) ? payload.content.filter(Boolean).map(String) : [];
      if (!summary.length && !content.length) return;
      addThoughtItem(turn, { ...base, id: `stored_reasoning_${rowIndex}`, type: "reasoning", summary, content });
      return;
    }

    if (row.type === "response_item" && payloadType === "function_call") {
      const callId = String(payload.call_id || "");
      const name = String(payload.name || "tool");
      const args = parseJsonObject(payload.arguments) || {};
      const collabTool = collabToolFromFunctionName(name);
      if (collabTool) {
        mergeCallItem(turn, callId, rowIndex, {
          ...base,
          id: `stored_collab_${callId || rowIndex}`,
          type: "collabAgentToolCall",
          status: "started",
          tool: collabTool,
          senderThreadId: threadId,
          receiverThreadIds: receiverThreadIdsFromCollabArgs(args),
          prompt: collabPromptFromArgs(args),
          model: String(args.model || ""),
          reasoningEffort: String(args.reasoning_effort || args.reasoningEffort || ""),
          agentsStates: [],
          callId,
        });
        return;
      }
      if (name === "exec_command") {
        mergeCallItem(turn, callId, rowIndex, {
          ...base,
          id: `stored_command_${callId || rowIndex}`,
          type: "commandExecution",
          status: "started",
          command: commandFromArgs(args, payload),
          cwd: String(args.cwd || args.workdir || ""),
          callId,
        });
      } else {
        mergeCallItem(turn, callId, rowIndex, {
          ...base,
          id: `stored_tool_${callId || rowIndex}`,
          type: "dynamicToolCall",
          status: "started",
          tool: name,
          callId,
          contentItems: compactStoredText(args, 900),
        });
      }
      return;
    }

    if (row.type === "event_msg" && payloadType === "exec_command_end") {
      const callId = String(payload.call_id || "");
      const output = payload.aggregated_output || [payload.stdout, payload.stderr].filter(Boolean).join("\n");
      mergeCallItem(turn, callId, rowIndex, {
        ...base,
        id: `stored_command_${callId || rowIndex}`,
        type: "commandExecution",
        status: Number(payload.exit_code) === 0 ? "completed" : "failed",
        command: commandFromArgs({}, payload),
        cwd: String(payload.cwd || ""),
        exitCode: Number.isFinite(Number(payload.exit_code)) ? Number(payload.exit_code) : null,
        durationMs: durationMillis(payload.duration),
        aggregatedOutput: compactStoredText(output),
        callId,
      });
      return;
    }

    if (row.type === "response_item" && payloadType === "function_call_output") {
      const callId = String(payload.call_id || "");
      const existing = existingCallItem(turn, callId, rowIndex);
      if (existing?.type === "collabAgentToolCall") {
        const output = parseJsonObject(payload.output) || parseJsonObject(payload.result) || {};
        const resultAgentId = String(output.agent_id || output.agentId || output.id || "");
        const receiverThreadIds = Array.from(new Set([
          ...(Array.isArray(existing.receiverThreadIds) ? existing.receiverThreadIds : []),
          resultAgentId,
        ].map((id) => String(id || "").trim()).filter(Boolean)));
        mergeCallItem(turn, callId, rowIndex, {
          ...base,
          id: existing.id || `stored_collab_${callId || rowIndex}`,
          type: "collabAgentToolCall",
          status: payload.success === false ? "failed" : "completed",
          tool: existing.tool || "call",
          senderThreadId: existing.senderThreadId || threadId,
          receiverThreadIds,
          prompt: existing.prompt || "",
          model: existing.model || "",
          reasoningEffort: existing.reasoningEffort || "",
          agentsStates: receiverThreadIds.map((id) => ({
            threadId: id,
            status: payload.success === false ? "errored" : "completed",
            nickname: String(output.nickname || ""),
            role: String(output.role || output.agent_role || output.agentRole || ""),
          })),
          callId,
        });
        return;
      }
      if (existing?.type === "dynamicToolCall") {
        mergeCallItem(turn, callId, rowIndex, {
          ...base,
          id: existing.id || `stored_tool_${callId || rowIndex}`,
          type: "dynamicToolCall",
          status: "completed",
          tool: existing.tool || String(payload.name || payload.tool_name || "tool"),
          contentItems: compactStoredText(payload.output || payload.result || payload, 1200),
          callId,
        });
        return;
      }
      mergeCallItem(turn, callId, rowIndex, {
        ...base,
        id: `stored_command_${callId || rowIndex}`,
        type: "commandExecution",
        status: "completed",
        aggregatedOutput: compactStoredText(payload.output),
        callId,
      });
      return;
    }

    if (row.type === "response_item" && payloadType === "custom_tool_call") {
      const callId = String(payload.call_id || "");
      mergeCallItem(turn, callId, rowIndex, {
        ...base,
        id: `stored_tool_${callId || rowIndex}`,
        type: "dynamicToolCall",
        status: "started",
        tool: String(payload.name || payload.tool_name || "custom_tool"),
        callId,
        contentItems: compactStoredText(payload.input || payload.arguments || payload, 900),
      });
      return;
    }

    if (row.type === "response_item" && payloadType === "custom_tool_call_output") {
      const callId = String(payload.call_id || "");
      mergeCallItem(turn, callId, rowIndex, {
        ...base,
        id: `stored_tool_${callId || rowIndex}`,
        type: "dynamicToolCall",
        status: "completed",
        tool: String(payload.name || payload.tool_name || "custom_tool"),
        callId,
        contentItems: compactStoredText(payload.output || payload.result || payload, 1200),
      });
      return;
    }

    if (row.type === "event_msg" && payloadType === "patch_apply_end") {
      const callId = String(payload.call_id || "");
      addThoughtItem(turn, {
        ...base,
        id: `stored_patch_${callId || rowIndex}`,
        type: "fileChange",
        status: payload.success === false ? "failed" : "completed",
        patchStatus: payload.success === false ? "failed" : "applied",
        callId,
        changes: changesFromPatchPayload(payload),
        stdout: compactStoredText(payload.stdout, 900),
        stderr: compactStoredText(payload.stderr, 900),
      });
      return;
    }

    if (payloadType === "collab_agent_tool_call" || payloadType === "collabAgentToolCall") {
      const callId = String(payload.call_id || payload.callId || payload.id || "");
      const collab = normalizeCollabToolPayload(payload);
      mergeCallItem(turn, callId, rowIndex, {
        ...base,
        id: `stored_collab_${callId || rowIndex}`,
        type: "collabAgentToolCall",
        status: collab.status,
        tool: collab.tool,
        senderThreadId: collab.senderThreadId,
        receiverThreadIds: collab.receiverThreadIds,
        prompt: collab.prompt,
        model: collab.model,
        reasoningEffort: collab.reasoningEffort,
        agentsStates: collab.agentsStates,
        callId,
      });
    }
  }

  function finalize() {
    return {
      schemaVersion: 1,
      threadId,
      threadMeta: {
        threadId,
        isSubagent: Boolean(threadMeta.isSubagent),
        parentThreadId: String(threadMeta.parentThreadId || ""),
        agentRole: String(threadMeta.agentRole || ""),
        agentNickname: String(threadMeta.agentNickname || ""),
        agentPath: String(threadMeta.agentPath || ""),
        depth: threadMeta.depth ?? null,
      },
      source: "stored_jsonl",
      sourceFile,
      turns,
      orphanItems,
      warnings,
    };
  }

  return { ingest, finalize };
}

function primaryProjectionCount(turn) {
  const thoughtMessages = Array.isArray(turn?.thoughtItems)
    ? turn.thoughtItems.filter((item) => item?.type === "agentMessage" || item?.type === "subagentNotification").length
    : 0;
  return (turn?.userMessages?.length || 0) +
    (turn?.systemMessages?.length || 0) +
    (turn?.assistantFinalMessages?.length || 0) +
    thoughtMessages;
}

function trimPresentationModel(model, limit) {
  const maxPrimary = Math.max(50, Number(limit) || CODEX_TRANSCRIPT_ENTRY_LIMIT);
  const turns = Array.isArray(model?.turns) ? model.turns : [];
  let total = 0;
  let start = turns.length;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    total += Math.max(1, primaryProjectionCount(turns[index]));
    start = index;
    if (total >= maxPrimary) break;
  }
  const visibleTurns = turns.slice(start);
  const firstOrder = visibleTurns[0]?.sourceOrderStart || visibleTurns[0]?.sourceRows?.[0]?.rowIndex || 0;
  return {
    ...model,
    turns: visibleTurns,
    orphanItems: (model.orphanItems || []).filter((item) => Number(item.sourceOrderStart || 0) >= firstOrder),
    truncated: start > 0,
    totalTurns: turns.length,
  };
}

function legacyEntriesFromPresentationModel(model) {
  const entries = [];
  for (const turn of model?.turns || []) {
    for (const message of turn.userMessages || []) entries.push(message);
    for (const message of turn.systemMessages || []) entries.push(message);
    for (const item of turn.thoughtItems || []) {
      if (item?.type !== "agentMessage") continue;
      entries.push({
        ...item,
        role: "assistant",
        text: item.text || "",
        phase: item.phase || "commentary",
        sourceType: "presentation.agentMessage",
      });
    }
    for (const message of turn.assistantFinalMessages || []) entries.push(message);
  }
  return entries;
}

function extractTranscriptEntry(row) {
  if (!row || typeof row !== "object") return null;
  const payload = row.payload || {};
  const at = String(row.timestamp || payload.timestamp || "");

  if (row.type === "response_item" && payload.type === "message") {
    const role = String(payload.role || "").toLowerCase();
    if (!role || role === "developer") return null;
    const text = extractContentText(payload.content || []);
    if (!text) return null;
    if (role === "user" && parseSubagentNotificationText(text)) return null;
    return {
      role: role === "assistant" || role === "user" ? role : "system",
      text,
      at,
      sourceType: "response_item.message",
      phase: String(payload.phase || ""),
    };
  }

  if (row.type === "event_msg" && payload.type === "user_message") {
    const text = String(payload.message || "").trim();
    if (!text) return null;
    if (parseSubagentNotificationText(text)) return null;
    return {
      role: "user",
      text,
      at,
      sourceType: "event_msg.user_message",
      phase: "",
    };
  }

  if (row.type === "event_msg" && payload.type === "agent_message") {
    const text = String(payload.message || "").trim();
    if (!text) return null;
    return {
      role: "assistant",
      text,
      at,
      sourceType: "event_msg.agent_message",
      phase: String(payload.phase || ""),
    };
  }

  return null;
}

function dedupeTranscriptEntries(entries) {
  const deduped = [];
  for (const entry of entries) {
    const last = deduped[deduped.length - 1];
    if (
      last &&
      last.role === entry.role &&
      last.text === entry.text &&
      String(last.phase || "") === String(entry.phase || "") &&
      String(last.sourceType || "") === String(entry.sourceType || "")
    ) {
      continue;
    }
    deduped.push(entry);
  }
  return deduped;
}

async function readSessionIndexRow(codexHome, threadId) {
  const sessionIndexPath = path.join(codexHome, "session_index.jsonl");
  let rawIndex;
  try {
    rawIndex = await fs.readFile(sessionIndexPath, "utf8");
  } catch {
    return null;
  }
  const lines = rawIndex.split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    let row;
    try {
      row = JSON.parse(lines[index]);
    } catch {
      continue;
    }
    if (String(row.id || "") === threadId) return row;
  }
  return null;
}

async function readSessionMetaFromFile(fullPath, threadId = "") {
  let line;
  try {
    line = await readJsonlFirstLine(fullPath);
  } catch {
    return null;
  }
  if (!line) return null;
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }
  const payload = entry?.payload || {};
  const foundId = String(payload.id || "");
  if (threadId && foundId !== threadId) return null;
  const subagentMeta = extractSubagentSessionMeta(payload);
  return {
    threadId: foundId,
    createdAt: String(payload.timestamp || entry.timestamp || ""),
    cwd: String(payload.cwd || ""),
    originator: String(payload.originator || "unknown"),
    parentThreadId: subagentMeta.parentThreadId,
    agentRole: subagentMeta.agentRole,
    agentNickname: subagentMeta.agentNickname,
    agentPath: subagentMeta.agentPath,
    depth: subagentMeta.depth,
    isSubagent: subagentMeta.isSubagent,
    source: subagentMeta.source,
  };
}

async function findCodexThreadSession(codexHome, threadId, preferredSessionFilePath = "") {
  const sessionsRoot = path.join(codexHome, "sessions");
  const indexRow = await readSessionIndexRow(codexHome, threadId);
  const preferredFile = String(preferredSessionFilePath || "").trim();

  if (preferredFile) {
    const meta = await readSessionMetaFromFile(preferredFile, threadId);
    if (meta) {
      return {
        threadId,
        sourceHome: codexHome,
        sessionFilePath: preferredFile,
        title: String(indexRow?.thread_name || "Untitled Codex thread"),
        updatedAt: String(indexRow?.updated_at || ""),
        createdAt: meta.createdAt,
        cwd: meta.cwd,
        originator: meta.originator,
        parentThreadId: meta.parentThreadId,
        agentRole: meta.agentRole,
        agentNickname: meta.agentNickname,
        agentPath: meta.agentPath,
        depth: meta.depth,
        isSubagent: meta.isSubagent,
        source: meta.source,
      };
    }
  }

  let found = null;
  await walkJsonlFiles(sessionsRoot, async (fullPath) => {
    const meta = await readSessionMetaFromFile(fullPath, threadId);
    if (!meta) return false;
    found = {
      threadId,
      sourceHome: codexHome,
      sessionFilePath: fullPath,
      title: String(indexRow?.thread_name || "Untitled Codex thread"),
      updatedAt: String(indexRow?.updated_at || ""),
      createdAt: meta.createdAt,
      cwd: meta.cwd,
      originator: meta.originator,
      parentThreadId: meta.parentThreadId,
      agentRole: meta.agentRole,
      agentNickname: meta.agentNickname,
      agentPath: meta.agentPath,
      depth: meta.depth,
      isSubagent: meta.isSubagent,
      source: meta.source,
    };
    return true;
  });
  return found;
}

async function readCodexThreadTranscript(params = {}) {
  const threadId = String(params.threadId || "").trim();
  if (!threadId) throw new Error("threadId is required.");
  const sourceHome = String(params.sourceHome || "").trim();
  const sessionFilePath = String(params.sessionFilePath || "").trim();
  const limit = safeCodexTranscriptLimit(params.limit);
  const homes = await resolveCodexHomes(sourceHome ? { homePaths: [sourceHome] } : {});

  let session = null;
  for (const home of homes) {
    session = await findCodexThreadSession(home, threadId, sessionFilePath);
    if (session) break;
  }
  if (!session) {
    throw new Error(`Thread ${threadId} not found in discovered Codex homes.`);
  }

  const stream = fsSync.createReadStream(session.sessionFilePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const entries = [];
  const presentationBuilder = createStoredPresentationBuilder(threadId, session.sessionFilePath, session);
  let lineCount = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    lineCount += 1;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    presentationBuilder.ingest(row, lineCount);
    const entry = extractTranscriptEntry(row);
    if (!entry) continue;
    entries.push(entry);
  }
  const presentationModel = trimPresentationModel(presentationBuilder.finalize(), limit);
  const presentationEntries = legacyEntriesFromPresentationModel(presentationModel);
  const deduped = dedupeTranscriptEntries(presentationEntries.length ? presentationEntries : entries);
  const truncated = deduped.length > limit;
  const tail = truncated ? deduped.slice(-limit) : deduped;
  const normalized = tail.map((entry, index) => ({
    id: `stored_${index + 1}`,
    role: entry.role,
    text: entry.text,
    at: entry.at,
    sourceType: entry.sourceType,
    phase: entry.phase || "",
  }));

  return {
    root,
    source: workspaceKind,
    threadId,
    sourceHome: session.sourceHome,
    title: session.title,
    updatedAt: session.updatedAt,
    createdAt: session.createdAt,
    cwd: session.cwd,
    originator: session.originator,
    parentThreadId: String(session.parentThreadId || ""),
    agentRole: String(session.agentRole || ""),
    agentNickname: String(session.agentNickname || ""),
    agentPath: String(session.agentPath || ""),
    depth: session.depth ?? null,
    isSubagent: Boolean(session.isSubagent),
    sessionFilePath: session.sessionFilePath,
    entries: normalized,
    presentationModel,
    count: normalized.length,
    totalCount: deduped.length,
    truncated: truncated || Boolean(presentationModel.truncated),
    lineCount,
    limit,
  };
}

function parseIsoMillis(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

function minuteBucketIso(ms) {
  return new Date(Math.floor(ms / 60_000) * 60_000).toISOString();
}

function parseToolWallTimeMs(text) {
  const source = String(text || "");
  if (!source) return 0;
  const match = source.match(/Wall time:\s*([0-9]+(?:\.[0-9]+)?)\s*(ms|milliseconds?|s|sec|seconds?|m|min|minutes?)?/i);
  if (!match) return 0;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return 0;
  const unit = String(match[2] || "s").toLowerCase();
  if (unit.startsWith("ms")) return Math.round(value);
  if (unit.startsWith("m")) return Math.round(value * 60_000);
  return Math.round(value * 1000);
}

function pushMetric(metrics, key, numValue, unit = "", evidenceGrade = "exact", textValue = "") {
  metrics.push({
    key,
    numValue: Number.isFinite(Number(numValue)) ? Number(numValue) : null,
    textValue: String(textValue || ""),
    unit: String(unit || ""),
    evidenceGrade: String(evidenceGrade || "estimated"),
  });
}

async function analyzeCodexThread(params = {}) {
  const threadId = String(params.threadId || "").trim();
  if (!threadId) throw new Error("threadId is required.");
  const sourceHome = String(params.sourceHome || "").trim();
  const sessionFilePath = String(params.sessionFilePath || "").trim();
  const homes = await resolveCodexHomes(sourceHome ? { homePaths: [sourceHome] } : {});

  let session = null;
  for (const home of homes) {
    session = await findCodexThreadSession(home, threadId, sessionFilePath);
    if (session) break;
  }
  if (!session) throw new Error(`Thread ${threadId} not found in discovered Codex homes.`);

  let stat = null;
  try {
    stat = await fs.lstat(session.sessionFilePath);
  } catch {}

  const stream = fsSync.createReadStream(session.sessionFilePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const activityBuckets = new Map();
  const gapMap = [];
  const turnTimeline = [];
  const tailLines = [];

  const counters = {
    eventUserMessage: 0,
    responseUserMessage: 0,
    eventAssistantMessage: 0,
    responseAssistantMessage: 0,
    eventCommentaryMessage: 0,
    responseCommentaryMessage: 0,
    eventFinalAnswerMessage: 0,
    responseFinalAnswerMessage: 0,
    eventReasoning: 0,
    responseReasoning: 0,
    turnCount: 0,
    abortedTurnCount: 0,
    commandExecutionCount: 0,
    mcpToolCallCount: 0,
    dynamicToolCallCount: 0,
    collabAgentToolCallCount: 0,
    webSearchCount: 0,
    fileChangeCount: 0,
    contextCompactionCount: 0,
  };

  let knownToolDurationMs = 0;
  let lineCount = 0;
  let firstAtMs = null;
  let lastAtMs = null;
  let previousAtMs = null;
  let firstUserAtMs = null;
  let firstAgentItemAtMs = null;
  let firstToolAtMs = null;
  let idleGapTotalMs = 0;
  let maxIdleGapMs = 0;
  let turnOrdinal = 0;

  for await (const line of rl) {
    const trimmed = String(line || "").trim();
    if (!trimmed) continue;
    lineCount += 1;

    tailLines.push(trimmed);
    if (tailLines.length > CODEX_ANALYTICS_TAIL_HASH_LINE_LIMIT) tailLines.shift();

    let row;
    try {
      row = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const atText = String(row.timestamp || row?.payload?.timestamp || "");
    const atMs = parseIsoMillis(atText);
    if (atMs !== null) {
      if (firstAtMs === null) firstAtMs = atMs;
      lastAtMs = atMs;
      const bucketKey = minuteBucketIso(atMs);
      activityBuckets.set(bucketKey, Number(activityBuckets.get(bucketKey) || 0) + 1);

      if (previousAtMs !== null) {
        const gap = atMs - previousAtMs;
        if (Number.isFinite(gap) && gap > CODEX_ANALYTICS_GAP_MS) {
          idleGapTotalMs += gap;
          if (gap > maxIdleGapMs) maxIdleGapMs = gap;
          gapMap.push({
            xValue: new Date(atMs).toISOString(),
            yValue: gap,
            payload: {
              from: new Date(previousAtMs).toISOString(),
              to: new Date(atMs).toISOString(),
              gapMs: gap,
            },
          });
        }
      }
      previousAtMs = atMs;
    }

    const payloadType = String(row?.payload?.type || "").trim();

    if (row.type === "turn_context") {
      counters.turnCount += 1;
      turnOrdinal += 1;
      if (atMs !== null) {
        turnTimeline.push({
          xValue: new Date(atMs).toISOString(),
          yValue: turnOrdinal,
          payload: { kind: "turn_context" },
        });
      }
      continue;
    }

    if (row.type === "compacted") {
      counters.contextCompactionCount += 1;
      continue;
    }

    if (row.type === "event_msg") {
      if (payloadType === "user_message") {
        counters.eventUserMessage += 1;
        if (firstUserAtMs === null && atMs !== null) firstUserAtMs = atMs;
      } else if (payloadType === "agent_message") {
        counters.eventAssistantMessage += 1;
        const phase = String(row?.payload?.phase || "").toLowerCase();
        if (phase === "commentary") counters.eventCommentaryMessage += 1;
        else counters.eventFinalAnswerMessage += 1;
        if (firstAgentItemAtMs === null && atMs !== null) firstAgentItemAtMs = atMs;
      } else if (payloadType === "agent_reasoning") {
        counters.eventReasoning += 1;
        if (firstAgentItemAtMs === null && atMs !== null) firstAgentItemAtMs = atMs;
      } else if (payloadType === "turn_aborted") {
        counters.abortedTurnCount += 1;
      } else if (payloadType === "context_compacted" || payloadType === "compaction") {
        counters.contextCompactionCount += 1;
      }
      continue;
    }

    if (row.type !== "response_item") continue;

    if (payloadType === "message") {
      const role = String(row?.payload?.role || "").toLowerCase();
      const phase = String(row?.payload?.phase || "").toLowerCase();
      if (role === "user") {
        counters.responseUserMessage += 1;
        if (firstUserAtMs === null && atMs !== null) firstUserAtMs = atMs;
      } else if (role === "assistant") {
        counters.responseAssistantMessage += 1;
        if (phase === "commentary") counters.responseCommentaryMessage += 1;
        else counters.responseFinalAnswerMessage += 1;
        if (firstAgentItemAtMs === null && atMs !== null) firstAgentItemAtMs = atMs;
      }
      continue;
    }

    if (payloadType === "reasoning") {
      counters.responseReasoning += 1;
      if (firstAgentItemAtMs === null && atMs !== null) firstAgentItemAtMs = atMs;
      continue;
    }

    if (payloadType === "function_call" || payloadType === "mcp_tool_call" || payloadType === "mcpToolCall") {
      counters.commandExecutionCount += 1;
      counters.mcpToolCallCount += 1;
      if (firstToolAtMs === null && atMs !== null) firstToolAtMs = atMs;
      continue;
    }

    if (payloadType === "custom_tool_call" || payloadType === "dynamic_tool_call" || payloadType === "dynamicToolCall") {
      counters.commandExecutionCount += 1;
      counters.dynamicToolCallCount += 1;
      if (firstToolAtMs === null && atMs !== null) firstToolAtMs = atMs;
      continue;
    }

    if (payloadType === "collab_agent_tool_call" || payloadType === "collabAgentToolCall") {
      counters.collabAgentToolCallCount += 1;
      if (firstToolAtMs === null && atMs !== null) firstToolAtMs = atMs;
      continue;
    }

    if (payloadType === "web_search" || payloadType === "webSearch") {
      counters.webSearchCount += 1;
      continue;
    }

    if (payloadType === "file_change" || payloadType === "fileChange") {
      counters.fileChangeCount += 1;
      continue;
    }

    if (
      payloadType === "function_call_output" ||
      payloadType === "custom_tool_call_output" ||
      payloadType === "mcp_tool_call_output"
    ) {
      knownToolDurationMs += parseToolWallTimeMs(row?.payload?.output || "");
    }
  }

  const userMessageCount = counters.eventUserMessage > 0 ? counters.eventUserMessage : counters.responseUserMessage;
  const assistantMessageCount = counters.eventAssistantMessage > 0 ? counters.eventAssistantMessage : counters.responseAssistantMessage;
  const commentaryMessageCount = counters.eventAssistantMessage > 0
    ? counters.eventCommentaryMessage
    : counters.responseCommentaryMessage;
  const finalAnswerCount = counters.eventAssistantMessage > 0
    ? counters.eventFinalAnswerMessage
    : counters.responseFinalAnswerMessage;
  const reasoningItemCount = counters.responseReasoning > 0 ? counters.responseReasoning : counters.eventReasoning;
  const turnCount = counters.turnCount;
  const abortedTurnCount = counters.abortedTurnCount;
  const completedTurnCount = Math.max(0, turnCount - abortedTurnCount);

  const wallClockSpanMs = firstAtMs !== null && lastAtMs !== null ? Math.max(0, lastAtMs - firstAtMs) : 0;
  const activeWorkTimeMs = Math.max(0, wallClockSpanMs - idleGapTotalMs);
  const threadUtilizationRatio = wallClockSpanMs > 0 ? activeWorkTimeMs / wallClockSpanMs : 0;
  const residualModelTimeMs = Math.max(0, activeWorkTimeMs - knownToolDurationMs);
  const reasoningToToolRatio = counters.commandExecutionCount > 0
    ? reasoningItemCount / counters.commandExecutionCount
    : null;

  const timeToFirstAgentItemMs = (
    firstUserAtMs !== null &&
    firstAgentItemAtMs !== null &&
    firstAgentItemAtMs >= firstUserAtMs
  )
    ? firstAgentItemAtMs - firstUserAtMs
    : null;

  const timeToFirstToolMs = (
    firstUserAtMs !== null &&
    firstToolAtMs !== null &&
    firstToolAtMs >= firstUserAtMs
  )
    ? firstToolAtMs - firstUserAtMs
    : null;

  const metrics = [];
  pushMetric(metrics, "thread_wall_clock_span_ms", wallClockSpanMs, "ms", "exact");
  pushMetric(metrics, "thread_active_work_time_ms", activeWorkTimeMs, "ms", "estimated");
  pushMetric(metrics, "thread_utilization_ratio", threadUtilizationRatio, "ratio", "estimated");
  pushMetric(metrics, "turn_count", turnCount, "count", "exact");
  pushMetric(metrics, "completed_turn_count", completedTurnCount, "count", "estimated");
  pushMetric(metrics, "failed_turn_count", 0, "count", "estimated");
  pushMetric(metrics, "aborted_turn_count", abortedTurnCount, "count", "exact");
  pushMetric(metrics, "idle_gap_total_ms", idleGapTotalMs, "ms", "estimated");
  pushMetric(metrics, "max_idle_gap_ms", maxIdleGapMs, "ms", "estimated");
  pushMetric(metrics, "user_message_count", userMessageCount, "count", "exact");
  pushMetric(metrics, "commentary_message_count", commentaryMessageCount, "count", "exact");
  pushMetric(metrics, "final_answer_count", finalAnswerCount, "count", "exact");
  pushMetric(metrics, "reasoning_item_count", reasoningItemCount, "count", "exact");
  pushMetric(metrics, "command_execution_count", counters.commandExecutionCount, "count", "exact");
  pushMetric(metrics, "mcp_tool_call_count", counters.mcpToolCallCount, "count", "exact");
  pushMetric(metrics, "dynamic_tool_call_count", counters.dynamicToolCallCount, "count", "exact");
  pushMetric(metrics, "collab_agent_tool_call_count", counters.collabAgentToolCallCount, "count", "exact");
  pushMetric(metrics, "web_search_count", counters.webSearchCount, "count", "exact");
  pushMetric(metrics, "file_change_count", counters.fileChangeCount, "count", "exact");
  pushMetric(metrics, "context_compaction_count", counters.contextCompactionCount, "count", "exact");
  pushMetric(metrics, "known_tool_duration_ms", knownToolDurationMs, "ms", "estimated");
  pushMetric(metrics, "residual_model_time_ms", residualModelTimeMs, "ms", "estimated");
  if (reasoningToToolRatio !== null) pushMetric(metrics, "reasoning_to_tool_ratio", reasoningToToolRatio, "ratio", "estimated");
  if (timeToFirstAgentItemMs !== null) pushMetric(metrics, "time_to_first_agent_item_ms", timeToFirstAgentItemMs, "ms", "rollout-derived");
  if (timeToFirstToolMs !== null) pushMetric(metrics, "time_to_first_tool_ms", timeToFirstToolMs, "ms", "rollout-derived");

  const activityDensity = Array.from(activityBuckets.entries())
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .map(([bucket, count]) => ({
      xValue: bucket,
      yValue: Number(count),
      payload: null,
    }));

  const workComposition = [
    { xValue: "final_answer", yValue: Number(finalAnswerCount), payload: null },
    { xValue: "commentary", yValue: Number(commentaryMessageCount), payload: null },
    { xValue: "reasoning", yValue: Number(reasoningItemCount), payload: null },
    { xValue: "tool_calls", yValue: Number(counters.commandExecutionCount), payload: null },
  ];

  const toolMix = [
    { xValue: "mcp_tool_call", yValue: Number(counters.mcpToolCallCount), payload: null },
    { xValue: "dynamic_tool_call", yValue: Number(counters.dynamicToolCallCount), payload: null },
    { xValue: "collab_agent_tool_call", yValue: Number(counters.collabAgentToolCallCount), payload: null },
  ];

  const series = [
    { seriesKey: "activity_density", points: activityDensity },
    { seriesKey: "work_composition", points: workComposition },
    { seriesKey: "tool_mix", points: toolMix },
    { seriesKey: "gap_map", points: gapMap.slice(-120) },
    { seriesKey: "turn_timeline", points: turnTimeline.slice(-500) },
  ];

  const tailHash = crypto.createHash("sha1").update(tailLines.join("\n")).digest("hex");
  const lastRolloutAt = lastAtMs !== null ? new Date(lastAtMs).toISOString() : "";

  return {
    threadId: session.threadId,
    sourceHome: session.sourceHome,
    sessionFilePath: session.sessionFilePath,
    title: session.title,
    cwd: session.cwd,
    originator: session.originator,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    fingerprint: {
      sessionUpdatedAt: String(session.updatedAt || ""),
      fileMtimeMs: Number.isFinite(Number(stat?.mtimeMs)) ? Math.round(Number(stat.mtimeMs)) : 0,
      fileSizeBytes: Number.isFinite(Number(stat?.size)) ? Math.round(Number(stat.size)) : 0,
      lineCount,
      lastRolloutAt,
      tailHash,
    },
    metrics,
    series,
  };
}

async function walkJsonlFiles(rootDir, onFile) {
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    let dirents;
    try {
      dirents = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dirent of dirents) {
      const fullPath = path.join(current, dirent.name);
      if (dirent.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (dirent.isFile() && dirent.name.endsWith(".jsonl")) {
        const shouldStop = await onFile(fullPath);
        if (shouldStop) return;
      }
    }
  }
}

async function readJsonlFirstLine(fullPath) {
  const handle = await fs.open(fullPath, "r");
  try {
    const chunkSize = 16 * 1024;
    const maxBytes = 512 * 1024;
    const parts = [];
    let position = 0;
    let totalBytes = 0;

    while (totalBytes < maxBytes) {
      const chunk = Buffer.alloc(chunkSize);
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      if (!bytesRead) break;
      const slice = chunk.subarray(0, bytesRead);
      const newline = slice.indexOf(10);
      if (newline >= 0) {
        parts.push(slice.subarray(0, newline));
        break;
      }
      parts.push(slice);
      position += bytesRead;
      totalBytes += bytesRead;
    }

    return Buffer.concat(parts).toString("utf8").trim();
  } finally {
    await handle.close();
  }
}

async function handleRequest(method, params = {}) {
  if (method === "hello") {
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) throw new Error("Workspace root is not a directory.");
    return {
      protocolVersion: PROTOCOL_VERSION,
      sessionId,
      projectId,
      workspaceKind,
      root,
      platform: process.platform,
      pid: process.pid,
      node: process.version,
      cwd: process.cwd(),
      capabilities: {
        listTree: true,
        readFilePreview: true,
        applyPatch: true,
        readFileTransfer: true,
        repositorySemanticSnapshot: true,
        directEpistemicRepositoryObservation: true,
        repositoryRealizationContext: true,
        runCommand: true,
        runDirectCommand: true,
        provisionGitWorktree: true,
        removeGitWorktree: true,
        directTestProfile: true,
        runDirectTest: true,
        ensureCodexSandboxArtifactIgnored: true,
        listMatchingFiles: true,
        resolvePath: true,
        watchScaffold: true,
        listCodexThreads: true,
        readCodexThreadTranscript: true,
        analyzeCodexThread: true,
        stageAttachment: true,
        removeAttachmentDraft: true,
        importFile: true,
      },
    };
  }
  if (method === "listTree") return listTree(params);
  if (method === "readFile") return readFilePreview(params);
  if (method === "applyPatch") return applyPatchPlan(params);
  if (method === "readFileTransfer") return readFileTransfer(params);
  if (method === "repositorySemanticSnapshot") {
    return repositorySemanticSnapshot(params);
  }
  if (method === "directEpistemicRepositoryObservation") {
    return directEpistemicRepositoryObservation(params);
  }
  if (
    method ===
      "repositoryRealizationContext"
  ) {
    return repositoryRealizationContext(
      params,
    );
  }
  if (method === "listMatchingFiles") return listMatchingFiles(params);
  if (method === "resolvePath") return resolvePathPreview(params);
  if (method === "runCommand") return runCommand(params);
  if (method === "runDirectCommand") return runDirectCommand(params);
  if (method === "provisionGitWorktree") {
    return serializeGitWorktreeMutation(() => provisionGitWorktree(params));
  }
  if (method === "removeGitWorktree") {
    return serializeGitWorktreeMutation(() => removeGitWorktree(params));
  }
  if (method === "directTestProfile") return directTestProfile(params);
  if (method === "runDirectTest") return runDirectTest(params);
  if (method === "ensureCodexSandboxArtifactIgnored") return ensureCodexSandboxArtifactIgnored(params);
  if (method === "watchStatus") return watchStatus(params);
  if (method === "listCodexThreads") return listCodexThreads(params);
  if (method === "readCodexThreadTranscript") return readCodexThreadTranscript(params);
  if (method === "analyzeCodexThread") return analyzeCodexThread(params);
  if (method === "stageAttachment") return stageAttachment(params);
  if (method === "removeAttachmentDraft") return removeAttachmentDraft(params);
  if (method === "importFile") return importFile(params);
  throw new Error(`Unknown workspace-agent method: ${method}`);
}

async function handleLine(line) {
  if (stdinClosed) return;
  if (!line.trim()) return;
  activeRequests += 1;
  let request;
  try {
    request = JSON.parse(line);
  } catch (error) {
    send({ error: { message: `Invalid JSON: ${error.message}` } });
    activeRequests -= 1;
    if (stdinClosed && activeRequests === 0) requestShutdown();
    return;
  }
  const id = request.id;
  try {
    const result = await handleRequest(request.method, request.params || {});
    send({ id, result });
  } catch (error) {
    send({ id, error: { message: error.message, code: error.code || "", stack: error.stack } });
  } finally {
    activeRequests -= 1;
    if (stdinClosed && activeRequests === 0) requestShutdown();
  }
}

async function main() {
  try {
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) throw new Error(`${root} is not a directory.`);
  } catch (error) {
    sendEvent("startup-error", { root, workspaceKind, projectId, error: error.message });
    process.exitCode = 2;
    return;
  }

  sendEvent("ready", {
    protocolVersion: PROTOCOL_VERSION,
    root,
    workspaceKind,
    projectId,
    pid: process.pid,
    platform: process.platform,
  });

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    handleLine(line).catch((error) => {
      sendEvent("internal-error", { error: error.message });
    });
  });
  rl.on("close", () => {
    requestShutdown();
  });
}

process.on("uncaughtException", (error) => {
  sendEvent("uncaught-exception", { error: error.message, stack: error.stack });
  requestShutdown(1);
});

process.on("unhandledRejection", (error) => {
  sendEvent("unhandled-rejection", { error: error?.message || String(error), stack: error?.stack });
  requestShutdown(1);
});

main().catch((error) => {
  if (!sendEvent("fatal", { error: error.message, stack: error.stack })) process.exit(1);
  process.exit(1);
});
