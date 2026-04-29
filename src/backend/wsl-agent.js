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
const COMMAND_OUTPUT_LIMIT_BYTES = 256 * 1024;
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const MATCH_SCAN_LIMIT = 240;
const MATCH_WALK_LIMIT = 8000;
const CODEX_THREAD_LIMIT = 120;
const CODEX_TRANSCRIPT_ENTRY_LIMIT = 800;
const CODEX_ANALYTICS_GAP_MS = 2 * 60 * 1000;
const CODEX_ANALYTICS_TAIL_HASH_LINE_LIMIT = 24;
const CODEX_SANDBOX_ARTIFACT_NAME = ".codex";
const CODEX_SANDBOX_ARTIFACT_EXCLUDE_COMMENT =
  "# codex-review-shell: Codex Linux sandbox may leak a zero-byte bwrap placeholder here.";

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

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendEvent(type, payload = {}) {
  send({ event: type, sessionId, at: new Date().toISOString(), ...payload });
}

function normalizeRelPath(relPath) {
  const text = String(relPath ?? "").replace(/\\/g, "/").trim();
  if (!text || text === ".") return "";
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

async function readFilePreview(params = {}) {
  const { fullPath, displayRel } = resolveWithinRoot(params.relPath || "");
  const stat = await fs.lstat(fullPath);
  if (stat.isSymbolicLink()) throw new Error("Symlink preview is disabled for this workspace agent.");
  if (!stat.isFile()) throw new Error("Selected path is not a file.");

  const bytesToRead = Math.min(stat.size, PREVIEW_LIMIT_BYTES);
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
    truncated: stat.size > PREVIEW_LIMIT_BYTES,
    binary,
    limit: PREVIEW_LIMIT_BYTES,
    text: binary ? "" : buffer.toString("utf8"),
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

    for (const dirent of dirents) {
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
    const child = spawn(command, args, {
      cwd: fullPath,
      env: { ...process.env, ...(params.env && typeof params.env === "object" ? params.env : {}) },
      shell: false,
      windowsHide: true,
    });

    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 1200);
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

function captureProcess(command, args, options = {}) {
  const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : DEFAULT_COMMAND_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || root,
      env: { ...process.env, ...(options.env && typeof options.env === "object" ? options.env : {}) },
      shell: false,
      windowsHide: true,
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 1200);
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
      fastEntries.push({
        threadId: String(row.id || ""),
        title: String(row.thread_name || "Untitled Codex thread"),
        updatedAt: String(row.updated_at || ""),
        cwd: "",
        originator: inferredOriginator,
        sessionFilePath: "",
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
    const subagentSpawn = payload?.source?.subagent?.thread_spawn;
    metadataById.set(sessionId, {
      sessionId,
      cwd: String(payload.cwd || ""),
      originator: String(payload.originator || "unknown"),
      filePath: fullPath,
      createdAt: String(payload.timestamp || entry.timestamp || ""),
      parentThreadId: String(subagentSpawn?.parent_thread_id || ""),
      agentRole: String(payload.agent_role || ""),
      agentNickname: String(payload.agent_nickname || ""),
      isSubagent: Boolean(subagentSpawn),
      sessionFileMtimeMs: Number.isFinite(Number(stat?.mtimeMs)) ? Math.round(Number(stat.mtimeMs)) : 0,
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
    entries.push({
      threadId: sessionId,
      title: String(row.thread_name || "Untitled Codex thread"),
      updatedAt: String(row.updated_at || ""),
      cwd: String(meta.cwd || ""),
      originator,
      sessionFilePath: String(meta.filePath || ""),
      createdAt: String(meta.createdAt || ""),
      sourceHome: codexHome,
      parentThreadId: String(meta.parentThreadId || ""),
      agentRole: String(meta.agentRole || ""),
      agentNickname: String(meta.agentNickname || ""),
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

function extractTranscriptEntry(row) {
  if (!row || typeof row !== "object") return null;
  const payload = row.payload || {};
  const at = String(row.timestamp || payload.timestamp || "");

  if (row.type === "response_item" && payload.type === "message") {
    const role = String(payload.role || "").toLowerCase();
    if (!role || role === "developer") return null;
    const text = extractContentText(payload.content || []);
    if (!text) return null;
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
  return {
    threadId: foundId,
    createdAt: String(payload.timestamp || entry.timestamp || ""),
    cwd: String(payload.cwd || ""),
    originator: String(payload.originator || "unknown"),
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
    const entry = extractTranscriptEntry(row);
    if (!entry) continue;
    entries.push(entry);
  }
  const deduped = dedupeTranscriptEntries(entries);
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
    sessionFilePath: session.sessionFilePath,
    entries: normalized,
    count: normalized.length,
    totalCount: deduped.length,
    truncated,
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
        runCommand: true,
        ensureCodexSandboxArtifactIgnored: true,
        listMatchingFiles: true,
        resolvePath: true,
        watchScaffold: true,
        listCodexThreads: true,
        readCodexThreadTranscript: true,
        analyzeCodexThread: true,
      },
    };
  }
  if (method === "listTree") return listTree(params);
  if (method === "readFile") return readFilePreview(params);
  if (method === "listMatchingFiles") return listMatchingFiles(params);
  if (method === "resolvePath") return resolvePathPreview(params);
  if (method === "runCommand") return runCommand(params);
  if (method === "ensureCodexSandboxArtifactIgnored") return ensureCodexSandboxArtifactIgnored(params);
  if (method === "watchStatus") return watchStatus(params);
  if (method === "listCodexThreads") return listCodexThreads(params);
  if (method === "readCodexThreadTranscript") return readCodexThreadTranscript(params);
  if (method === "analyzeCodexThread") return analyzeCodexThread(params);
  throw new Error(`Unknown workspace-agent method: ${method}`);
}

async function handleLine(line) {
  if (!line.trim()) return;
  let request;
  try {
    request = JSON.parse(line);
  } catch (error) {
    send({ error: { message: `Invalid JSON: ${error.message}` } });
    return;
  }
  const id = request.id;
  try {
    const result = await handleRequest(request.method, request.params || {});
    send({ id, result });
  } catch (error) {
    send({ id, error: { message: error.message, stack: error.stack } });
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
    // Do not force-exit immediately; allow in-flight async handlers to flush replies.
  });
}

process.on("uncaughtException", (error) => {
  sendEvent("uncaught-exception", { error: error.message, stack: error.stack });
});

process.on("unhandledRejection", (error) => {
  sendEvent("unhandled-rejection", { error: error?.message || String(error), stack: error?.stack });
});

main().catch((error) => {
  sendEvent("fatal", { error: error.message, stack: error.stack });
  process.exit(1);
});
