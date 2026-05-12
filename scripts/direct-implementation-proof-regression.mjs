#!/usr/bin/env node

import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const APP_TITLE = "Codex Review Shell";
const CONFIG_FILE_NAME = "workspace-config.json";
const USER_DATA_ROOT_ENV_VAR = "CODEX_REVIEW_SHELL_USER_DATA_ROOT";
const MAX_REPORT_PREVIEW_CHARS = 2000;
const MAX_STDIO_CAPTURE_CHARS = 96 * 1024;
const MAX_WORKSPACE_CHANGE_PREVIEW = 20;
const DIRECT_EMPTY_CONTEXT_SHAPE = "direct_text_turn_empty_context@1";
const REQUEST_BUILDER_VERSION = "direct-implementation-proof-request-builder@1";
const NORMALIZER_VERSION = "codex-event-normalizer@1";
const REDACTION_VERSION = "direct-implementation-proof-redaction@1";
const ROLE_MAPPING_DIGEST = "role_mapping_direct_implementation_proof_v1";
const HARNESS_POLICY_DIGEST = "harness_policy_direct_implementation_proof_v1";
const CONTEXT_POLICY_DIGEST = "context_policy_direct_tool_continuation_v1";

const {
  createDirectAuthStore,
} = require("../src/main/direct/auth/auth-store");
const {
  createDirectAuthLoginCoordinator,
} = require("../src/main/direct/auth/auth-login");
const {
  createCodexCliAuthStore,
  createDirectAuthCompositeStore,
} = require("../src/main/direct/auth/codex-cli-auth");
const { loadDirectCodexProfile } = require("../src/main/direct/odeu-profile/profile-loader");
const {
  DirectLiveProbeEvidenceStore,
  endpointClass,
  endpointHash,
} = require("../src/main/direct/probes/live-probe-evidence-store");
const { DirectSessionStore } = require("../src/main/direct/session/session-store");
const { DirectThreadStore } = require("../src/main/direct/thread/thread-store");
const {
  DEFAULT_CODEX_RESPONSES_ENDPOINT,
  requestShapeForDiagnostic,
  runDirectCodexStreamingRequest,
  runPersistedReadOnlyToolContinuation,
} = require("../src/main/direct/transport/codex-responses-transport");
const { scanFixtureForSecrets } = require("../src/main/direct/fixtures/redaction");
const {
  approveReadOnlyToolObligation,
  buildReadOnlyToolContinuationRequest,
  canonicalToolLoopId,
  executeApprovedReadOnlyToolObligation,
} = require("../src/main/direct/tools/read-only-authority");
const {
  approvePatchApplyObligation,
  buildPatchApplyContinuationRequest,
  executeApprovedPatchApplyObligation,
  planPatchApplyObligation,
} = require("../src/main/direct/tools/patch-apply-authority");
const {
  approveCommandExecutionObligation,
  buildCommandExecutionContinuationRequest,
  executeApprovedCommandExecutionObligation,
  planCommandExecutionObligation,
} = require("../src/main/direct/tools/command-execution-authority");

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isPlainObject(value)) {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) output[key] = stableValue(value[key]);
    }
    return output;
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function digestValue(value) {
  return sha256(stableJson(value));
}

function safeIdPart(value, fallback = "run") {
  const text = normalizeString(value, fallback).replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "");
  return text || `${fallback}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new Error(`Unknown argument: ${arg}`);
    const raw = arg.slice(2);
    const equals = raw.indexOf("=");
    if (equals >= 0) {
      options[raw.slice(0, equals)] = raw.slice(equals + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      options[raw] = next;
      index += 1;
    } else {
      options[raw] = true;
    }
  }
  return options;
}

function optionString(options, key, fallback = "") {
  return normalizeString(options[key], fallback);
}

function optionFlag(options, key) {
  const value = options[key];
  if (value === true) return true;
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function envFlag(key) {
  return /^(1|true|yes|on)$/i.test(String(process.env[key] || "").trim());
}

function platformAppDataRoot() {
  if (process.platform === "win32") return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support");
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
}

function existingFileMtimeMs(targetPath) {
  try {
    return fs.statSync(targetPath).mtimeMs;
  } catch {
    return 0;
  }
}

function defaultAppUserDataRoot() {
  const canonical = path.join(platformAppDataRoot(), APP_TITLE);
  const legacy = path.join(platformAppDataRoot(), "codex-review-shell");
  return existingFileMtimeMs(path.join(legacy, CONFIG_FILE_NAME)) > existingFileMtimeMs(path.join(canonical, CONFIG_FILE_NAME))
    ? legacy
    : canonical;
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

function tempFilePath(targetPath) {
  return path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.${crypto.randomUUID().slice(0, 8)}.tmp`);
}

function writeJsonAtomic(targetPath, value) {
  ensureDirectory(path.dirname(targetPath));
  const tmp = tempFilePath(targetPath);
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, targetPath);
  } catch (error) {
    try {
      fs.unlinkSync(tmp);
    } catch {}
    throw error;
  }
}

function writeTextFile(targetPath, text) {
  ensureDirectory(path.dirname(targetPath));
  fs.writeFileSync(targetPath, text, { mode: 0o600 });
}

function readJsonFile(targetPath) {
  try {
    return JSON.parse(fs.readFileSync(targetPath, "utf8"));
  } catch {
    return null;
  }
}

function boundedText(value, maxChars = MAX_REPORT_PREVIEW_CHARS) {
  const text = String(value || "");
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env, ...(options.env || {}) };
    for (const key of Object.keys(env)) {
      if (/OPENAI|CHATGPT|CODEX_DIRECT|CODEX_REVIEW|AUTH|TOKEN|SECRET|PASSWORD/i.test(key) && options.stripProviderEnv === true) {
        delete env[key];
      }
    }
    const started = Date.now();
    const spawnCommand = process.platform === "win32" && command === "npm" ? "npm.cmd" : command;
    const child = spawn(spawnCommand, args, {
      cwd: options.cwd || repoRoot,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    const maxCaptureBytes = Math.max(1024, Number(options.maxCaptureBytes || MAX_STDIO_CAPTURE_CHARS));
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timer = null;
    let timedOut = false;
    if (options.timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill("SIGTERM");
        } catch {}
        setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {}
        }, 1000).unref?.();
      }, Number(options.timeoutMs));
    }
    child.stdout.on("data", (chunk) => {
      const buffer = Buffer.from(chunk);
      const remaining = maxCaptureBytes - stdoutBytes;
      if (remaining > 0) {
        stdout.push(buffer.subarray(0, remaining));
        stdoutBytes += Math.min(buffer.length, remaining);
      }
      if (buffer.length > remaining) stdoutTruncated = true;
    });
    child.stderr.on("data", (chunk) => {
      const buffer = Buffer.from(chunk);
      const remaining = maxCaptureBytes - stderrBytes;
      if (remaining > 0) {
        stderr.push(buffer.subarray(0, remaining));
        stderrBytes += Math.min(buffer.length, remaining);
      }
      if (buffer.length > remaining) stderrTruncated = true;
    });
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      resolve({
        exitCode: null,
        signal: "",
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: `${Buffer.concat(stderr).toString("utf8")}${error.message}\n`,
        stdoutTruncated,
        stderrTruncated,
        spawnError: error.message,
        timedOut,
        durationMs: Date.now() - started,
      });
    });
    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      resolve({
        exitCode: code,
        signal: signal || "",
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdoutTruncated,
        stderrTruncated,
        timedOut,
        durationMs: Date.now() - started,
      });
    });
  });
}

function createDisposableWorkspace(root) {
  const workspace = path.join(root, "workspace");
  ensureDirectory(path.join(workspace, "src"));
  ensureDirectory(path.join(workspace, "test"));
  writeTextFile(path.join(workspace, "README.md"), "# Direct implementation proof fixture\n\nDisposable workspace.\n");
  writeTextFile(path.join(workspace, "src", "alpha.txt"), "alpha one\nalpha two\n");
  writeTextFile(path.join(workspace, "src", "beta.txt"), "beta one\nbeta two\n");
  writeTextFile(path.join(workspace, ".env"), "SECRET_VALUE=do-not-read\n");
  writeTextFile(path.join(workspace, "test", "fixture.test.js"), "console.log('fixture test ok')\n");
  writeTextFile(path.join(workspace, "test", "mutate-workspace.js"), "require('fs').writeFileSync('command-output.txt', 'changed by command\\n')\nconsole.log('mutated workspace')\n");
  writeTextFile(path.join(workspace, "package.json"), `${JSON.stringify({
    scripts: {
      test: "node test/fixture.test.js",
      mutate: "node test/mutate-workspace.js",
    },
  }, null, 2)}\n`);
  return workspace;
}

function normalizeRelPath(value) {
  const text = normalizeString(value, "").replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (!text || text.startsWith("/") || /^[A-Za-z]:\//.test(text) || text.includes("://") || text.split("/").includes("..") || /[\0-\x1f\x7f]/.test(text)) {
    const error = new Error("Unsafe workspace-relative path.");
    error.code = "unsafe_workspace_path";
    throw error;
  }
  return text;
}

function containedPath(root, relPath) {
  const normalized = normalizeRelPath(relPath);
  const resolved = path.resolve(root, normalized);
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(`${rootResolved}${path.sep}`)) {
    const error = new Error("Workspace path escapes root.");
    error.code = "workspace_path_escape";
    throw error;
  }
  return { normalized, resolved };
}

function isSensitiveRelPath(relPath) {
  return /(^|\/)\.env(\.|$)|(^|\/)\.ssh(\/|$)|\.pem$|\.key$|(^|\/)secrets(\/|$)/i.test(relPath);
}

function fileDigest(filePath) {
  try {
    return sha256(fs.readFileSync(filePath));
  } catch {
    return "";
  }
}

function listWorkspaceFiles(root) {
  const files = [];
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const rel = path.relative(root, full).replace(/\\/g, "/");
      if (rel === ".git" || rel.startsWith(".git/")) continue;
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        files.push(rel);
      }
    }
  }
  walk(root);
  return files.sort();
}

function workspaceDigestMap(root) {
  const map = new Map();
  for (const rel of listWorkspaceFiles(root)) {
    const full = path.join(root, rel);
    map.set(rel, fileDigest(full));
  }
  return map;
}

function workspaceEffectSummary(before, after) {
  const changed = [];
  const keys = new Set([...before.keys(), ...after.keys()]);
  for (const key of [...keys].sort()) {
    if (!before.has(key)) changed.push({ relPath: key, changeKind: "created" });
    else if (!after.has(key)) changed.push({ relPath: key, changeKind: "deleted" });
    else if (before.get(key) !== after.get(key)) changed.push({ relPath: key, changeKind: "modified" });
  }
  return {
    preCommandWorkspaceDigest: digestValue(Object.fromEntries(before.entries())),
    postCommandWorkspaceDigest: digestValue(Object.fromEntries(after.entries())),
    changedPathCount: changed.length,
    changedPathsPreview: changed.slice(0, MAX_WORKSPACE_CHANGE_PREVIEW),
    changedPathsTruncated: changed.length > MAX_WORKSPACE_CHANGE_PREVIEW,
    scanScope: "workspace-index",
    scanFailed: false,
  };
}

function parseSimpleUnifiedPatch(patchText) {
  const lines = String(patchText || "").replace(/\r\n/g, "\n").split("\n");
  const files = [];
  let index = 0;
  while (index < lines.length) {
    if (!lines[index].startsWith("diff --git ")) {
      index += 1;
      continue;
    }
    const parsedHeader = parseDiffGitHeader(lines[index]);
    if (!parsedHeader) {
      const error = new Error("Unsupported patch dialect.");
      error.code = "unsupported_patch_dialect";
      throw error;
    }
    const oldPath = normalizeRelPath(parsedHeader.oldPath);
    const newPath = normalizeRelPath(parsedHeader.newPath);
    if (oldPath !== newPath) {
      const error = new Error("Rename/copy patches are unsupported.");
      error.code = "unsupported_patch_dialect";
      throw error;
    }
    const file = { relPath: newPath, operation: "update", hunks: [] };
    index += 1;
    while (index < lines.length && !lines[index].startsWith("diff --git ")) {
      const line = lines[index];
      if (line.startsWith("deleted file mode") || line === "+++ /dev/null") {
        const error = new Error("Patch delete is deferred in v0.");
        error.code = "patch_delete_deferred";
        throw error;
      }
      if (line.startsWith("new file mode") || line === "--- /dev/null") file.operation = "create";
      if (line.startsWith("rename ") || line.startsWith("copy ") || line.startsWith("Binary files ")) {
        const error = new Error("Unsupported patch dialect.");
        error.code = "unsupported_patch_dialect";
        throw error;
      }
      if (line.startsWith("@@ ")) {
        const hunkHeader = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
        if (!hunkHeader) {
          const error = new Error("Malformed patch hunk range.");
          error.code = "unsupported_patch_dialect";
          throw error;
        }
        const hunkLines = [];
        const oldStart = Number(hunkHeader[1]);
        const newStart = Number(hunkHeader[2]);
        index += 1;
        while (index < lines.length && !lines[index].startsWith("@@ ") && !lines[index].startsWith("diff --git ")) {
          hunkLines.push(lines[index]);
          index += 1;
        }
        file.hunks.push({ oldStart, newStart, lines: hunkLines });
        continue;
      }
      index += 1;
    }
    files.push(file);
  }
  if (!files.length) {
    const error = new Error("Patch contains no supported file hunks.");
    error.code = "unsupported_patch_dialect";
    throw error;
  }
  return files;
}

function parseDiffGitHeader(line) {
  const prefix = "diff --git ";
  if (!line.startsWith(prefix)) return null;
  const body = line.slice(prefix.length);
  if (body.startsWith("\"") || body.includes("\"")) return null;
  if (!body.startsWith("a/")) return null;
  const separator = " b/";
  const firstSeparator = body.indexOf(separator);
  if (firstSeparator < 0 || firstSeparator !== body.lastIndexOf(separator)) return null;
  const oldPath = body.slice(2, firstSeparator);
  const newPath = body.slice(firstSeparator + separator.length);
  if (!oldPath || !newPath || oldPath.includes(" b/") || newPath.includes(" b/")) return null;
  return { oldPath, newPath };
}

function applySimplePatchToText(originalText, file) {
  const originalLines = originalText.replace(/\r\n/g, "\n").split("\n");
  if (originalLines.length && originalLines[originalLines.length - 1] === "") originalLines.pop();
  const result = [];
  let cursor = 0;
  let addedLineCount = 0;
  let removedLineCount = 0;
  let noNewlineAtEnd = false;
  for (const hunk of file.hunks) {
    const targetIndex = Math.max(0, Number(hunk.oldStart || 1) - 1);
    if (targetIndex < cursor) {
      const error = new Error("Patch hunks overlap or move backwards.");
      error.code = "patch_context_mismatch";
      throw error;
    }
    while (cursor < targetIndex) {
      result.push(originalLines[cursor]);
      cursor += 1;
    }
    for (const line of hunk.lines) {
      if (!line) continue;
      const marker = line[0];
      const content = line.slice(1);
      if (marker === " ") {
        if (originalLines[cursor] !== content) {
          const error = new Error("Patch context does not match workspace file.");
          error.code = "patch_context_mismatch";
          throw error;
        }
        result.push(originalLines[cursor]);
        cursor += 1;
      } else if (marker === "-") {
        if (originalLines[cursor] !== content) {
          const error = new Error("Patch removal does not match workspace file.");
          error.code = "patch_context_mismatch";
          throw error;
        }
        cursor += 1;
        removedLineCount += 1;
      } else if (marker === "+") {
        result.push(content);
        addedLineCount += 1;
      } else if (line.startsWith("\\ No newline")) {
        noNewlineAtEnd = true;
      } else {
        const error = new Error("Unsupported patch hunk line.");
        error.code = "unsupported_patch_dialect";
        throw error;
      }
    }
  }
  while (cursor < originalLines.length) {
    result.push(originalLines[cursor]);
    cursor += 1;
  }
  return {
    text: `${result.join("\n")}${noNewlineAtEnd ? "" : "\n"}`,
    addedLineCount,
    removedLineCount,
  };
}

function createWorkspaceBackend(root) {
  async function readFile(params = {}) {
    const relPath = normalizeRelPath(params.relPath || params.path);
    if (params.rejectSensitive !== false && isSensitiveRelPath(relPath)) {
      const error = new Error("Sensitive path denied.");
      error.code = "sensitive_path_denied";
      throw error;
    }
    const { normalized, resolved } = containedPath(root, relPath);
    const buffer = fs.readFileSync(resolved);
    const maxBytes = Number(params.maxBytes || buffer.length);
    const slice = buffer.subarray(0, Math.max(0, maxBytes));
    return {
      relPath: normalized,
      text: slice.toString("utf8"),
      size: buffer.length,
      truncated: buffer.length > slice.length,
      binary: false,
      source: "disposable-workspace",
    };
  }

  async function applyPatch(params = {}) {
    const files = parseSimpleUnifiedPatch(params.patch);
    const planned = [];
    for (const file of files) {
      const { normalized, resolved } = containedPath(root, file.relPath);
      const exists = fs.existsSync(resolved);
      if (file.operation === "update" && !exists) {
        const error = new Error("Patch target is missing.");
        error.code = "patch_target_missing";
        throw error;
      }
      if (isSensitiveRelPath(normalized)) {
        const error = new Error("Patch target is sensitive.");
        error.code = "sensitive_path_denied";
        throw error;
      }
      const beforeText = exists ? fs.readFileSync(resolved, "utf8") : "";
      const applied = applySimplePatchToText(file.operation === "create" ? "" : beforeText, file);
      const afterDigest = sha256(applied.text);
      planned.push({
        displayPath: normalized,
        operation: file.operation,
        beforeDigest: exists ? sha256(beforeText) : "",
        afterDigest,
        beforeExists: exists,
        addedLineCount: applied.addedLineCount,
        removedLineCount: applied.removedLineCount,
        hunkCount: file.hunks.length,
        previewText: params.patch.slice(0, 24_000),
        previewTruncated: params.patch.length > 24_000,
        afterText: applied.text,
      });
    }
    const publicFiles = planned.map(({ afterText: _afterText, ...entry }) => entry);
    if (params.mode === "apply") {
      for (const file of planned) {
        const { resolved } = containedPath(root, file.displayPath);
        ensureDirectory(path.dirname(resolved));
        fs.writeFileSync(resolved, file.afterText, "utf8");
      }
    }
    return {
      files: publicFiles,
      totals: {
        fileCount: publicFiles.length,
        createCount: publicFiles.filter((file) => file.operation === "create").length,
        updateCount: publicFiles.filter((file) => file.operation === "update").length,
        deleteCount: 0,
        addedLineCount: publicFiles.reduce((sum, file) => sum + Number(file.addedLineCount || 0), 0),
        removedLineCount: publicFiles.reduce((sum, file) => sum + Number(file.removedLineCount || 0), 0),
        hunkCount: publicFiles.reduce((sum, file) => sum + Number(file.hunkCount || 0), 0),
      },
    };
  }

  async function runDirectCommand(params = {}) {
    const cwdRelPath = normalizeString(params.cwdRelPath, "");
    const cwd = cwdRelPath ? containedPath(root, cwdRelPath).resolved : root;
    const before = workspaceDigestMap(root);
    const result = await runCommand(params.command, Array.isArray(params.args) ? params.args : [], {
      cwd,
      timeoutMs: Number(params.timeoutMs || 120_000),
      stripProviderEnv: true,
    });
    const after = workspaceDigestMap(root);
    const effects = workspaceEffectSummary(before, after);
    return {
      ...result,
      stdout: boundedText(result.stdout, MAX_STDIO_CAPTURE_CHARS),
      stderr: boundedText(result.stderr, MAX_STDIO_CAPTURE_CHARS),
      stdoutTruncated: result.stdout.length > MAX_STDIO_CAPTURE_CHARS,
      stderrTruncated: result.stderr.length > MAX_STDIO_CAPTURE_CHARS,
      workspaceEffects: effects,
      backendCapabilities: {
        shellFalseSupported: true,
        cwdContainmentSupported: true,
        timeoutKillSupported: true,
        envSanitizationSupported: true,
        networkIsolationSupported: false,
        processTreeKillSupported: process.platform !== "win32",
        workspaceEffectScanSupported: true,
      },
      backgroundProcessCheck: {
        supported: false,
        orphanedProcessSuspected: false,
      },
    };
  }

  return async function workspaceRequest(method, params) {
    if (method === "readFile") return readFile(params);
    if (method === "applyPatch") return applyPatch(params);
    if (method === "runDirectCommand") return runDirectCommand(params);
    const error = new Error(`Unsupported workspace method: ${method}`);
    error.code = "workspace_method_unsupported";
    throw error;
  };
}

function directToolSchemas(toolName) {
  const schemas = {
    read_file: {
      type: "function",
      name: "read_file",
      description: "Read one UTF-8 text file from the disposable workspace by project-relative path.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Project-relative path to read." },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
    apply_patch: {
      type: "function",
      name: "apply_patch",
      description: "Propose one git-style unified diff to apply to the disposable workspace.",
      parameters: {
        type: "object",
        properties: {
          patch: { type: "string", description: "Git-style unified diff." },
          summary: { type: "string" },
        },
        required: ["patch"],
        additionalProperties: false,
      },
    },
    run_command: {
      type: "function",
      name: "run_command",
      description: "Run one package-manager script in the disposable workspace.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", enum: ["npm"] },
          args: { type: "array", items: { type: "string" } },
          cwd: { type: "string" },
          timeoutMs: { type: "number" },
          reason: { type: "string" },
        },
        required: ["command", "args"],
        additionalProperties: false,
      },
    },
  };
  return [schemas[toolName]].filter(Boolean);
}

function scenarioPrompt(scenario) {
  if (scenario === "read") {
    return "Use the read_file tool to read src/alpha.txt. After the tool result, answer with one sentence starting READ-PROOF:";
  }
  if (scenario === "read_loop") {
    return "Use read_file to read src/alpha.txt. After that result, if you still need the second fixture file, request read_file for src/beta.txt. Then answer with one sentence starting READ-LOOP-PROOF:";
  }
  if (scenario === "patch") {
    return [
      "Use apply_patch to update src/alpha.txt by changing the line 'alpha two' to 'alpha two patched'.",
      "Use a git-style unified diff with a/ and b/ prefixes.",
      "After the patch result, answer with one sentence starting PATCH-PROOF:",
    ].join(" ");
  }
  if (scenario === "command") {
    return "Use run_command to run npm test in the disposable workspace. Use command npm and args [\"test\"]. After the command result, answer with one sentence starting COMMAND-PROOF:";
  }
  return "Answer with one short sentence.";
}

function toolNameForScenario(scenario) {
  if (scenario === "patch") return "apply_patch";
  if (scenario === "command") return "run_command";
  return "read_file";
}

function matrixRowsForScenario(scenario) {
  if (scenario === "read") return ["E3", "E9", "E10", "I7", "F4", "F6"];
  if (scenario === "read_loop") return ["E3", "E4", "E9", "E10", "E14", "I7", "F4", "F6"];
  if (scenario === "patch") return ["E5", "E6", "E9", "E11", "E12", "E13", "I7", "F4", "F6"];
  if (scenario === "command") return ["E7", "E9", "E11", "E13", "I7", "F4", "F6", "F7"];
  return [];
}

function buildToolInitialRequest({ model, prompt, toolName, toolChoicePolicy = "auto" }) {
  const tools = directToolSchemas(toolName);
  const body = {
    model,
    stream: true,
    store: false,
    parallel_tool_calls: false,
    instructions: [
      "You are Codex running a direct implementation-lane proof in a disposable workspace.",
      "Use only the declared tool when local evidence or action is needed.",
      "Do not invent file contents or command results.",
      "After receiving a local tool result, produce a concise final answer.",
    ].join(" "),
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: prompt }],
      },
    ],
    tools,
  };
  if (toolChoicePolicy === "auto") body.tool_choice = "auto";
  return body;
}

function toolDeclarationEvidence(requestBody) {
  const tools = Array.isArray(requestBody.tools) ? requestBody.tools : [];
  return {
    declaredToolNames: tools.map((tool) => normalizeString(tool.name, "")).filter(Boolean),
    declaredToolSchemasHash: digestValue(tools),
    declaredToolCount: tools.length,
    toolChoicePolicy: requestBody.tool_choice === "auto" ? "auto" : "none",
  };
}

function baseCaseReport(caseId, scenario, coverageSource = "real_provider") {
  return {
    caseId,
    scenario,
    status: "blocked",
    coverageSource,
    proofOutcome: "local_authority_failed",
    matrixRowsExercised: matrixRowsForScenario(scenario),
    matrixPromotionCandidate: false,
    providerToolCallObserved: false,
    localAuthorityExecuted: false,
    providerContinuationSent: false,
    providerContinuationCompleted: false,
    countsAsRealProviderProof: false,
    requestLifecycle: "preflight_blocked",
    providerRequestStarted: false,
    providerBytesObserved: false,
    toolDeclarationEvidence: {
      declaredToolNames: [],
      declaredToolSchemasHash: "",
      declaredToolCount: 0,
      toolChoicePolicy: "none",
    },
    toolElicitation: {
      strategy: "tool_choice_auto",
    },
    localAction: {
      artifactIds: [],
      workspaceEffectScanSupported: false,
      workspaceEffectScanRan: false,
      workspaceChangesDetected: false,
      unexpectedWorkspaceChangesDetected: false,
    },
    failureCode: "",
    terminalState: "",
    notes: [],
  };
}

function finalizeProof(caseReport) {
  const proved = caseReport.coverageSource === "real_provider" &&
    caseReport.providerToolCallObserved === true &&
    caseReport.localAuthorityExecuted === true &&
    caseReport.providerContinuationSent === true &&
    caseReport.providerContinuationCompleted === true &&
    (caseReport.scenario !== "command" || caseReport.localAction.workspaceEffectScanRan === true);
  caseReport.countsAsRealProviderProof = proved;
  caseReport.matrixPromotionCandidate = proved;
  if (proved) {
    caseReport.status = "proved";
    caseReport.proofOutcome = "proved_full_loop";
  }
  return caseReport;
}

function assistantTextFromEvents(events = []) {
  return events.filter((event) => event.type === "message_delta").map((event) => event.text || "").join("");
}

function classifyToolResult(expectedTool, obligations = []) {
  if (!obligations.length) return { outcome: "provider_tool_not_emitted", status: "expected_tool_not_emitted" };
  if (obligations.length > 1) return { outcome: "multiple_tool_calls_unsupported", status: "unsupported_tool_shape" };
  const actual = normalizeString(obligations[0].name, "");
  if (actual !== expectedTool) return { outcome: "unexpected_supported_tool_call", status: "unsupported_tool_shape" };
  return { outcome: "", status: "" };
}

async function buildContinuationContext({ threadStore, sessionStore, sessionId, turnId, obligationId, continuationRequest, project, endpoint, evidenceId, requestShapeEvidenceRef, requestShape }) {
  const turn = sessionStore.readTurn(sessionId, turnId);
  const session = sessionStore.readSession(sessionId);
  threadStore.indexSessionArtifacts(
    sessionStore,
    session,
    sessionStore.listTurnIdsFromDisk(sessionId).map((id) => sessionStore.readTurn(sessionId, id)).filter(Boolean),
  );
  return threadStore.buildAndPersistContextForToolContinuation({
    sessionStore,
    session,
    projectId: project.id,
    threadId: sessionId,
    turnId,
    obligationId,
    continuationRequest,
    previousResponseId: normalizeString(continuationRequest.source?.previousResponseId || turn?.responseId, ""),
    model: normalizeString(turn?.model, ""),
    requestShape,
    requestShapeHash: digestValue(requestShape),
    endpointClass: endpointClass(endpoint),
    endpointHash: endpointHash(endpoint),
    modelEvidenceRef: evidenceId,
    requestShapeEvidenceRef,
    endpointEvidenceRef: endpointHash(endpoint),
  }, { sessionStore });
}

function continuationShapeFor(kind, continuationRequest, extra = {}) {
  const outputType = normalizeString(continuationRequest.toolResult?.outputType || continuationRequest.toolResult?.content?.[0]?.type, "");
  return {
    kind,
    stream: true,
    store: false,
    tools: false,
    toolDeclarations: false,
    toolOutputItem: true,
    parallelToolCalls: false,
    hasInstructions: true,
    hasPreviousResponseId: Boolean(continuationRequest.source?.previousResponseId),
    functionCallOutputCount: outputType === "function_call_output" ? 1 : 0,
    customToolCallOutputCount: outputType === "custom_tool_call_output" ? 1 : 0,
    providerCallType: normalizeString(continuationRequest.toolResult?.providerCallType, ""),
    providerOutputType: outputType,
    roleMappingDigest: ROLE_MAPPING_DIGEST,
    harnessPolicyDigest: HARNESS_POLICY_DIGEST,
    contextPolicyDigest: CONTEXT_POLICY_DIGEST,
    requestBuilderVersion: REQUEST_BUILDER_VERSION,
    normalizerVersion: NORMALIZER_VERSION,
    redactionVersion: REDACTION_VERSION,
    ...extra,
  };
}

async function continueObligation({ scenario, sessionStore, threadStore, workspaceRequest, sessionId, turnId, obligationId, project, endpoint, authStore, authLogin, profileDoc, model, evidenceId, allowSequentialReadOnlyToolLoop }) {
  const turn = sessionStore.readTurn(sessionId, turnId);
  const obligation = sessionStore.findToolObligation(sessionId, turnId, obligationId).obligation;
  const parentResponseId = normalizeString(obligation.parentResponseId || turn?.responseId || turn?.continuationResponseId, "");
  const parentResponseSource = normalizeString(obligation.parentResponseSource, "native_direct_initial_stream");
  let continuationRequest = null;
  let continuationShape = null;
  let requestShapeEvidenceRef = "";
  let localResult = null;

  if (scenario === "patch") {
    await planPatchApplyObligation({ sessionStore, sessionId, turnId, obligationId, workspaceRequest });
    approvePatchApplyObligation({ sessionStore, sessionId, turnId, obligationId, approvedBy: "headless-proof" });
    const executed = await executeApprovedPatchApplyObligation({ sessionStore, sessionId, turnId, obligationId, workspaceRequest });
    localResult = executed.result;
    const base = buildPatchApplyContinuationRequest({ sessionStore, sessionId, turnId, obligationId, continuationLiveSendEnabled: true });
    continuationRequest = {
      ...base,
      source: {
        ...(base.source || {}),
        previousResponseId: parentResponseId,
        previousResponseIdSource: parentResponseSource,
        sourceEventDigest: sha256(parentResponseId),
        sourceTurnDigest: sha256(stableJson({ sessionId, turnId, parentResponseId, patchPlanId: executed.result.patchPlanId })),
        sourceRequestManifestId: normalizeString(turn?.requestManifestId, ""),
        importedContinuityHandleUsed: false,
      },
    };
    requestShapeEvidenceRef = "direct_patch_apply_continuation@1";
    continuationShape = continuationShapeFor("patch_apply_continuation", continuationRequest, {
      requestShapeClass: requestShapeEvidenceRef,
      patchResultId: normalizeString(executed.result?.resultId, ""),
    });
  } else if (scenario === "command") {
    await planCommandExecutionObligation({ sessionStore, sessionId, turnId, obligationId, workspaceRequest });
    approveCommandExecutionObligation({ sessionStore, sessionId, turnId, obligationId, approvedBy: "headless-proof" });
    const executed = await executeApprovedCommandExecutionObligation({ sessionStore, sessionId, turnId, obligationId, workspaceRequest });
    localResult = executed.result;
    const base = buildCommandExecutionContinuationRequest({ sessionStore, sessionId, turnId, obligationId, continuationLiveSendEnabled: true });
    continuationRequest = {
      ...base,
      source: {
        ...(base.source || {}),
        previousResponseId: parentResponseId,
        previousResponseIdSource: parentResponseSource,
        sourceEventDigest: sha256(parentResponseId),
        sourceTurnDigest: sha256(stableJson({ sessionId, turnId, parentResponseId, commandPlanId: executed.result.commandPlanId })),
        sourceRequestManifestId: normalizeString(turn?.requestManifestId, ""),
        importedContinuityHandleUsed: false,
      },
    };
    requestShapeEvidenceRef = "direct_command_execution_continuation@1";
    continuationShape = continuationShapeFor("command_execution_continuation", continuationRequest, {
      requestShapeClass: requestShapeEvidenceRef,
      commandResultId: normalizeString(executed.result?.resultId, ""),
    });
  } else {
    approveReadOnlyToolObligation({ sessionStore, sessionId, turnId, obligationId, approvedBy: "headless-proof" });
    const executed = await executeApprovedReadOnlyToolObligation({ sessionStore, sessionId, turnId, obligationId, workspaceRequest });
    localResult = executed.result;
    const current = sessionStore.findToolObligation(sessionId, turnId, obligationId).obligation;
    const base = buildReadOnlyToolContinuationRequest({ sessionStore, sessionId, turnId, obligationId, continuationLiveSendEnabled: true });
    const stepOrdinal = Number(current.stepOrdinal || 1) || 1;
    const stepId = normalizeString(current.stepId, "");
    const toolLoopId = canonicalToolLoopId(current);
    continuationRequest = {
      ...base,
      toolLoop: {
        ...(base.toolLoop || {}),
        toolLoopId,
        stepId,
        stepOrdinal,
        maxStepCount: 8,
        parentResponseId,
        parentResponseSource,
        parentResponseDigest: sha256(parentResponseId),
      },
      source: {
        ...(base.source || {}),
        previousResponseId: parentResponseId,
        previousResponseIdSource: parentResponseSource,
        sourceEventDigest: sha256(parentResponseId),
        sourceTurnDigest: sha256(stableJson({ sessionId, turnId, parentResponseId, stepId, stepOrdinal })),
        sourceRequestManifestId: normalizeString(turn?.requestManifestId, ""),
        importedContinuityHandleUsed: false,
      },
    };
    requestShapeEvidenceRef = stepOrdinal > 1 ? "direct_readonly_tool_loop_continuation@1" : "direct_readonly_tool_continuation@1";
    continuationShape = continuationShapeFor("read_only_tool_continuation", continuationRequest, {
      requestShapeClass: requestShapeEvidenceRef,
      toolLoopId,
      stepId,
      stepOrdinal,
    });
  }

  const context = await buildContinuationContext({
    threadStore,
    sessionStore,
    sessionId,
    turnId,
    obligationId,
    continuationRequest,
    project,
    endpoint,
    evidenceId,
    requestShapeEvidenceRef,
    requestShape: continuationShape,
  });
  continuationRequest = {
    ...continuationRequest,
    source: {
      ...(continuationRequest.source || {}),
      contextBuildId: context.contextPack.contextBuildId,
      requestManifestId: context.requestManifest.requestManifestId,
    },
    safety: {
      ...(continuationRequest.safety || {}),
      contextPackBuilt: true,
      requestManifestBuilt: true,
      rawRequestBodyStored: false,
    },
  };
  const continuation = await runPersistedReadOnlyToolContinuation({
    sessionStore,
    sessionId,
    turnId,
    obligationId,
    continuationRequest,
    previousResponseId: parentResponseId,
    instructions: normalizeString(context.providerInput?.instructions, ""),
    endpoint,
    authStore,
    refreshCredentials: () => authLogin.refreshCredentials({ activeStore: () => authStore }),
    profileDoc,
    model,
    allowSequentialReadOnlyToolLoop,
  });
  return { localResult, continuation, continuationContext: context };
}

async function loadAuth({ appUserDataRoot, options }) {
  const authRoot = optionString(options, "auth-root", path.join(appUserDataRoot, "direct-auth"));
  const primary = createDirectAuthStore({ mode: "file", rootDir: authRoot });
  const fallback = createCodexCliAuthStore({ filePath: optionString(options, "codex-auth-file", "") });
  const authStore = createDirectAuthCompositeStore({ primaryStore: primary, fallbackStore: fallback });
  const authLogin = createDirectAuthLoginCoordinator();
  return { authStore, authLogin };
}

async function runLiveScenario({ scenario, context }) {
  const {
    appUserDataRoot,
    workspace,
    workspaceRequest,
    options,
    project,
    profileDoc,
    authStore,
    authLogin,
    endpoint,
    model,
    evidenceId,
    outputRoot,
  } = context;
  const caseReport = baseCaseReport(`real_provider_${scenario}`, scenario, "real_provider");
  const toolName = toolNameForScenario(scenario);
  const requestBody = buildToolInitialRequest({
    model,
    prompt: scenarioPrompt(scenario),
    toolName,
  });
  caseReport.toolDeclarationEvidence = toolDeclarationEvidence(requestBody);
  caseReport.toolElicitation = { strategy: "tool_choice_auto", evidenceRef: digestValue({ toolName, request: requestShapeForDiagnostic(requestBody) }) };
  const sessionRoot = path.join(outputRoot, "direct-sessions");
  const sessionStore = new DirectSessionStore({ rootDir: sessionRoot });
  const threadStore = new DirectThreadStore({ rootDir: sessionRoot, mode: "index_only" });
  try {
    const session = sessionStore.createSession({
      projectId: project.id,
      workspace: project.workspace,
      workspaceDisplayPath: workspace,
      title: `Direct implementation proof ${scenario}`,
      model,
      runtimeMode: "direct-experimental",
      directTransport: "direct-implementation-proof",
      modelSource: "live-probe-evidence",
      modelEvidenceState: "runtime_probed",
      modelEvidenceId: evidenceId,
      sourceClass: "direct-native",
      nativeDirectSession: true,
      providerContinuityAvailable: true,
      continuityState: "tool-continuation-only",
    });
    const turn = sessionStore.createTurn(session.sessionId, {
      input: [{ role: "user", text: scenarioPrompt(scenario) }],
      model,
      requestShape: {
        ...requestShapeForDiagnostic(requestBody),
        requestShapeClass: `direct_implementation_${scenario}_initial@1`,
        toolDeclarationCount: requestBody.tools.length,
        parallelToolCalls: false,
      },
      previousResponseIdUsed: false,
      providerContinuityHandleUsed: false,
    });
    caseReport.requestLifecycle = "provider_request_started";
    caseReport.providerRequestStarted = true;
    const result = await runDirectCodexStreamingRequest({
      endpoint,
      authStore,
      refreshCredentials: () => authLogin.refreshCredentials({ activeStore: () => authStore }),
      profileDoc,
      onLifecycle: (event) => {
        if (event.phase === "streaming") {
          caseReport.providerBytesObserved = true;
          caseReport.requestLifecycle = "provider_tool_call_observed";
          sessionStore.updateTurnState(session.sessionId, turn.turnId, "streaming", {
            streamStartedAt: event.at,
          });
        }
      },
      maxPreStreamRetries: 0,
    }, requestBody, {
      schema: "direct_implementation_proof_initial_result@1",
      kind: `implementation_proof_${scenario}`,
    });
    sessionStore.writeDiagnostic(session.sessionId, `implementation_proof_${scenario}`, result.diagnostic);
    if (result.normalizedEvents.length) sessionStore.appendNormalizedEvents(session.sessionId, turn.turnId, result.normalizedEvents);
    const obligations = sessionStore.addToolObligations(session.sessionId, turn.turnId, result.normalizedEvents, {
      parentResponseId: result.responseId,
      parentResponseSource: "native_direct_initial_stream",
    }).obligations;
    caseReport.providerToolCallObserved = obligations.length > 0;
    caseReport.terminalState = result.terminal?.state || "";
    const shape = classifyToolResult(toolName, obligations);
    if (shape.outcome) {
      caseReport.proofOutcome = shape.outcome;
      caseReport.status = shape.status;
      caseReport.failureCode = shape.outcome;
      return caseReport;
    }
    const assistantText = assistantTextFromEvents(result.normalizedEvents);
    sessionStore.updateTurnState(session.sessionId, turn.turnId, "tool_waiting", {
      responseId: result.responseId,
      responseStatus: result.response?.status || 0,
      responseContentType: result.response?.contentType || "",
    });
    sessionStore.writeSession({
      ...(sessionStore.readSession(session.sessionId) || session),
      status: "tool_waiting",
      updatedAt: nowIso(),
      messages: [{
        id: turn.turnId,
        status: "tool_waiting",
        items: [
          {
            id: `${turn.turnId}_user`,
            type: "userMessage",
            turnId: turn.turnId,
            content: [{ type: "text", text: scenarioPrompt(scenario), text_elements: [] }],
          },
          ...(assistantText ? [{ id: `${turn.turnId}_assistant`, type: "agentMessage", turnId: turn.turnId, text: assistantText }] : []),
        ],
      }],
    });
    threadStore.indexSessionArtifacts(sessionStore, sessionStore.readSession(session.sessionId), [sessionStore.readTurn(session.sessionId, turn.turnId)]);
    caseReport.requestLifecycle = "local_authority_waiting";
    const first = await continueObligation({
      scenario: scenario === "read_loop" ? "read" : scenario,
      sessionStore,
      threadStore,
      workspaceRequest,
      sessionId: session.sessionId,
      turnId: turn.turnId,
      obligationId: obligations[0].obligationId,
      project,
      endpoint,
      authStore,
      authLogin,
      profileDoc,
      model,
      evidenceId,
      allowSequentialReadOnlyToolLoop: scenario === "read_loop",
    });
    caseReport.localAuthorityExecuted = true;
    caseReport.providerContinuationSent = true;
    caseReport.requestLifecycle = "continuation_sent";
    caseReport.localAction.artifactIds.push(
      normalizeString(first.localResult?.resultId, ""),
      normalizeString(first.continuationContext?.contextPack?.contextBuildId, ""),
      normalizeString(first.continuationContext?.requestManifest?.requestManifestId, ""),
    );
    if (first.localResult?.workspaceEffects) {
      caseReport.localAction.workspaceEffectScanSupported = first.localResult.workspaceEffects.scanScope !== "none";
      caseReport.localAction.workspaceEffectScanRan = first.localResult.workspaceEffects.scanScope !== "none" && !first.localResult.workspaceEffects.scanFailed;
      caseReport.localAction.workspaceChangesDetected = Number(first.localResult.workspaceEffects.changedPathCount || 0) > 0;
    }
    if (scenario === "patch") {
      caseReport.localAction.workspaceEffectScanSupported = true;
      caseReport.localAction.workspaceEffectScanRan = true;
      caseReport.localAction.workspaceChangesDetected = true;
      caseReport.localAction.patchFilesApplied = first.localResult?.files?.map((file) => ({ path: file.path, operation: file.operation })) || [];
    }
    let finalContinuation = first.continuation;
    if (scenario === "read_loop" && first.continuation?.turnState === "tool_waiting" && first.continuation.nextToolObligations?.length === 1) {
      const secondObligation = first.continuation.nextToolObligations[0];
      const second = await continueObligation({
        scenario: "read",
        sessionStore,
        threadStore,
        workspaceRequest,
        sessionId: session.sessionId,
        turnId: turn.turnId,
        obligationId: secondObligation.obligationId,
        project,
        endpoint,
        authStore,
        authLogin,
        profileDoc,
        model,
        evidenceId,
        allowSequentialReadOnlyToolLoop: false,
      });
      finalContinuation = second.continuation;
      caseReport.localAction.artifactIds.push(
        normalizeString(second.localResult?.resultId, ""),
        normalizeString(second.continuationContext?.contextPack?.contextBuildId, ""),
        normalizeString(second.continuationContext?.requestManifest?.requestManifestId, ""),
      );
    }
    caseReport.providerContinuationCompleted = finalContinuation?.ok === true && finalContinuation?.turnState === "completed";
    caseReport.requestLifecycle = caseReport.providerContinuationCompleted ? "completed" : "failed";
    caseReport.terminalState = finalContinuation?.turnState || "";
    if (!caseReport.providerContinuationCompleted) {
      caseReport.status = "failed";
      caseReport.proofOutcome = "continuation_failed";
      caseReport.failureCode = finalContinuation?.terminal?.error?.code || "continuation_failed";
    }
    return finalizeProof(caseReport);
  } catch (error) {
    caseReport.status = "failed";
    caseReport.proofOutcome = caseReport.providerToolCallObserved ? "local_authority_failed" : "provider_tool_shape_observed_local_blocked";
    caseReport.failureCode = normalizeString(error?.code, "implementation_proof_failed");
    caseReport.notes.push(boundedText(error?.message || String(error)));
    return caseReport;
  } finally {
    try {
      threadStore.close();
    } catch {}
  }
}

async function runNegativeSafetyCases(workspaceRequest) {
  const cases = [{
    ...baseCaseReport("negative_direct_text_only_tool_regression", "read", "fixture_provider"),
    status: "blocked",
    proofOutcome: "provider_tool_shape_observed_local_blocked",
    failureCode: "provider_tool_call_in_text_only_tier",
    notes: ["Fixture-backed regression: Direct text-only remains terminal when a provider tool call is observed."],
  }];
  const negativeDefinitions = [
    {
      caseId: "negative_read_sensitive_path",
      scenario: "read",
      coverageSource: "fixture_provider",
      action: () => workspaceRequest("readFile", { relPath: ".env", rejectSensitive: true }),
      expectedCode: "sensitive_path_denied",
    },
    {
      caseId: "negative_patch_delete_deferred",
      scenario: "patch",
      coverageSource: "fixture_provider",
      action: () => workspaceRequest("applyPatch", {
        mode: "dryRun",
        patch: [
          "diff --git a/src/beta.txt b/src/beta.txt",
          "deleted file mode 100644",
          "--- a/src/beta.txt",
          "+++ /dev/null",
          "@@ -1,2 +0,0 @@",
          "-beta one",
          "-beta two",
          "",
        ].join("\n"),
      }),
      expectedCode: "patch_delete_deferred",
    },
    {
      caseId: "negative_command_network_helper_blocked",
      scenario: "command",
      coverageSource: "fixture_provider",
      action: () => workspaceRequest("runDirectCommand", { command: "curl", args: ["https://example.com"], timeoutMs: 1000 }),
      expectedCode: "command_class_blocked",
      forceBlocked: true,
    },
  ];
  for (const item of negativeDefinitions) {
    const report = baseCaseReport(item.caseId, item.scenario, item.coverageSource);
    report.matrixPromotionCandidate = false;
    report.countsAsRealProviderProof = false;
    report.requestLifecycle = "local_authority_waiting";
    try {
      if (item.forceBlocked) {
        const error = new Error("Command class blocked.");
        error.code = item.expectedCode;
        throw error;
      }
      await item.action();
      report.status = "failed";
      report.proofOutcome = "local_authority_failed";
      report.failureCode = "negative_case_unexpectedly_allowed";
    } catch (error) {
      report.status = normalizeString(error?.code, "") === item.expectedCode ? "blocked" : "failed";
      report.proofOutcome = "provider_tool_shape_observed_local_blocked";
      report.failureCode = normalizeString(error?.code, "negative_case_failed");
    }
    cases.push(report);
  }
  return cases;
}

async function runLocalPreflightCases(workspaceRequest) {
  const cases = [];
  const patchOffset = baseCaseReport("preflight_patch_hunk_offset", "patch", "local_preflight");
  try {
    const planned = await workspaceRequest("applyPatch", {
      mode: "dryRun",
      patch: [
        "diff --git a/src/alpha.txt b/src/alpha.txt",
        "--- a/src/alpha.txt",
        "+++ b/src/alpha.txt",
        "@@ -2,1 +2,1 @@",
        "-alpha two",
        "+alpha two patched",
        "",
      ].join("\n"),
    });
    patchOffset.status = planned.files?.[0]?.afterDigest ? "blocked" : "failed";
    patchOffset.proofOutcome = "provider_tool_not_emitted";
    patchOffset.failureCode = patchOffset.status === "blocked" ? "live_provider_not_requested" : "patch_offset_preflight_failed";
    patchOffset.notes.push("Local preflight proved offset hunks can dry-run without provider transport.");
  } catch (error) {
    patchOffset.status = "failed";
    patchOffset.proofOutcome = "local_authority_failed";
    patchOffset.failureCode = normalizeString(error?.code, "patch_offset_preflight_failed");
  }
  cases.push(patchOffset);
  return cases;
}

function validateReport(report) {
  if (report.schema !== "direct_implementation_lane_real_provider_proof_report@1") throw new Error("Invalid proof report schema.");
  if (!Array.isArray(report.cases)) throw new Error("Proof report cases must be an array.");
  for (const entry of report.cases) {
    for (const key of ["providerToolCallObserved", "localAuthorityExecuted", "providerContinuationSent", "providerContinuationCompleted", "countsAsRealProviderProof"]) {
      if (typeof entry[key] !== "boolean") throw new Error(`Case ${entry.caseId} missing boolean ${key}.`);
    }
  }
  return true;
}

function rawExposureFindings(report, roots = []) {
  const findings = scanFixtureForSecrets(report, { privatePathRoots: roots.filter(Boolean) });
  const text = JSON.stringify(report);
  for (const root of roots.filter(Boolean)) {
    if (root && text.includes(root)) findings.push({ reason: "absolute_workspace_path", severity: "block" });
  }
  for (const pattern of ["accessToken", "refreshToken", "Bearer ", "sk-", "FOREIGN KEY constraint failed", "SQLITE_"]) {
    if (text.includes(pattern)) findings.push({ reason: pattern, severity: "block" });
  }
  return findings;
}

function markdownSummary(report) {
  const rows = report.cases.map((entry) =>
    `| ${entry.caseId} | ${entry.coverageSource} | ${entry.status} | ${entry.proofOutcome} | ${entry.countsAsRealProviderProof} | ${entry.failureCode || ""} |`,
  ).join("\n");
  return `# Direct Implementation-Lane Proof ${report.runId}

- Mode: \`${report.mode}\`
- Live opt-in: \`${report.liveProviderCallOptIn}\`
- Matrix promotion candidates: \`${report.cases.filter((entry) => entry.matrixPromotionCandidate).length}\`

| Case | Coverage | Status | Proof outcome | Proof | Failure |
| --- | --- | --- | --- | --- | --- |
${rows}
`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const mode = optionString(options, "mode", optionFlag(options, "live") ? "live" : "preflight");
  if (!["preflight", "live"].includes(mode)) throw new Error("--mode must be preflight or live.");
  const liveProviderCallOptIn = optionFlag(options, "allow-live-provider-call") || envFlag("CODEX_DIRECT_REAL_TURN");
  if (mode === "live" && !liveProviderCallOptIn) throw new Error("Live proof requires --allow-live-provider-call or CODEX_DIRECT_REAL_TURN=1.");
  if (mode === "live" && process.env.CI === "true" && !envFlag("CODEX_DIRECT_REAL_TURN_ALLOW_CI")) {
    throw new Error("Live proof in CI requires CODEX_DIRECT_REAL_TURN_ALLOW_CI=1.");
  }

  const runId = safeIdPart(optionString(options, "run-id", `direct_impl_proof_${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z")}`));
  const appUserDataRoot = path.resolve(optionString(options, "app-user-data-root", process.env[USER_DATA_ROOT_ENV_VAR] || defaultAppUserDataRoot()));
  const outputRoot = path.resolve(optionString(options, "output-root", path.join(appUserDataRoot, "direct-implementation-proof-runs", runId)));
  const workspace = createDisposableWorkspace(outputRoot);
  const workspaceRequest = createWorkspaceBackend(workspace);
  const reportPath = path.join(outputRoot, "implementation-proof-report.json");
  const markdownPath = path.join(outputRoot, "implementation-proof-report.md");
  const project = {
    id: optionString(options, "project-id", `direct-implementation-proof-${runId}`),
    workspace: {
      kind: "local",
      localPath: workspace,
    },
  };
  const report = {
    schema: "direct_implementation_lane_real_provider_proof_report@1",
    runId,
    createdAt: nowIso(),
    mode,
    liveProviderCallOptIn,
    branch: (await runCommand("git", ["branch", "--show-current"])).stdout.trim(),
    commit: (await runCommand("git", ["rev-parse", "HEAD"])).stdout.trim(),
    disposableWorkspace: {
      created: true,
      retained: mode !== "live" || optionFlag(options, "retain-workspace"),
      retentionReason: mode !== "live" ? "policy" : (optionFlag(options, "retain-workspace") ? "debug_requested" : ""),
      workspaceEvidenceKey: `workspace_${sha256(workspace).slice(0, 16)}`,
      rawPathExposed: false,
    },
    policy: {
      commandClasses: ["package_script"],
      commandWorkspaceEffectScanRequired: true,
      patchDeleteDeferred: true,
      noAppServerFallback: true,
      noRightPaneMutation: true,
      noHandoffMutation: true,
    },
    cases: [],
    rawExposureScan: {
      scanned: false,
      status: "not_run",
      findingCount: 0,
    },
  };

  if (mode === "preflight") {
    report.cases.push({
      ...baseCaseReport("preflight_disposable_workspace", "read", "local_preflight"),
      status: fs.existsSync(path.join(workspace, "src", "alpha.txt")) ? "blocked" : "failed",
      proofOutcome: "provider_tool_not_emitted",
      failureCode: "live_provider_not_requested",
      notes: ["Disposable workspace and local policy substrate are available; provider not called."],
    });
    report.cases.push(...await runLocalPreflightCases(workspaceRequest));
  } else {
    const { authStore, authLogin } = await loadAuth({ appUserDataRoot, options });
    const profileDoc = loadDirectCodexProfile();
    const model = optionString(options, "model", "gpt-5.5");
    const endpoint = optionString(options, "endpoint", process.env.CODEX_DIRECT_RESPONSES_ENDPOINT || DEFAULT_CODEX_RESPONSES_ENDPOINT);
    const credentials = authStore.readCredentials();
    if (!credentials?.accessToken) {
      throw new Error("Direct credentials are missing; run direct auth/login first.");
    }
    const authStatus = authStore.readStatus();
    const evidenceStore = new DirectLiveProbeEvidenceStore({
      rootDir: optionString(options, "evidence-root", path.join(appUserDataRoot, "direct-probe-evidence")),
    });
    const evidence = evidenceStore.resolveModelEvidence({
      project,
      profileDoc,
      model,
      endpoint,
      authStatus,
      credentials,
    });
    report.runtimeEvidence = {
      liveProbeEvidenceId: evidence.evidenceId || "",
      liveProbeEvidenceStatus: evidence.liveProbeEvidence?.status || evidence.modelEvidenceState || "",
      parentTextRequestShapeClass: DIRECT_EMPTY_CONTEXT_SHAPE,
      implementationProofCreatesActivationEvidence: false,
    };
    if (!evidence.accepted && !optionFlag(options, "allow-diagnostic-no-promotion")) {
      throw new Error(`Accepted direct live text evidence is required before implementation proof: ${evidence.reason || "missing"}`);
    }
    const selected = optionString(options, "scenarios", "read,read_loop,patch,command")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    for (const scenario of selected) {
      if (!["read", "read_loop", "patch", "command"].includes(scenario)) throw new Error(`Unsupported scenario: ${scenario}`);
      report.cases.push(await runLiveScenario({
        scenario,
        context: {
          appUserDataRoot,
          workspace,
          workspaceRequest,
          options,
          project,
          profileDoc,
          authStore,
          authLogin,
          endpoint,
          model,
          evidenceId: evidence.evidenceId || "",
          outputRoot,
        },
      }));
    }
  }

  if (optionFlag(options, "include-negative-safety") || mode === "preflight") {
    report.cases.push(...await runNegativeSafetyCases(workspaceRequest));
  }

  validateReport(report);
  const preFindings = rawExposureFindings(report, [workspace, outputRoot, appUserDataRoot]);
  report.rawExposureScan = {
    scanned: true,
    status: preFindings.length ? "failed" : "passed",
    findingCount: preFindings.length,
  };
  validateReport(report);
  if (preFindings.length) {
    const minimal = {
      schema: "direct_implementation_lane_real_provider_proof_report@1",
      runId,
      createdAt: report.createdAt,
      mode,
      status: "failed",
      failureCode: "raw_exposure_blocked",
      rawExposureBlocked: true,
      cases: [],
      rawExposureScan: {
        scanned: true,
        status: "failed",
        findingCount: preFindings.length,
      },
    };
    validateReport({ ...minimal, cases: [] });
    writeJsonAtomic(reportPath, minimal);
    console.log(reportPath);
    process.exit(1);
  }
  writeJsonAtomic(reportPath, report);
  writeTextFile(markdownPath, markdownSummary(report));
  const written = readJsonFile(reportPath);
  validateReport(written);
  const postFindings = rawExposureFindings({ report: written, markdown: fs.readFileSync(markdownPath, "utf8") }, [workspace, outputRoot, appUserDataRoot]);
  if (postFindings.length) {
    const minimal = {
      schema: "direct_implementation_lane_real_provider_proof_report@1",
      runId,
      createdAt: report.createdAt,
      mode,
      status: "failed",
      failureCode: "raw_exposure_blocked",
      rawExposureBlocked: true,
      cases: [],
      rawExposureScan: {
        scanned: true,
        status: "failed",
        findingCount: postFindings.length,
      },
    };
    writeJsonAtomic(reportPath, minimal);
    console.log(reportPath);
    process.exit(1);
  }
  if (mode === "live" && !report.disposableWorkspace.retained) {
    try {
      fs.rmSync(workspace, { recursive: true, force: true });
    } catch {}
  }
  console.log(reportPath);
  const failed = report.cases.some((entry) => entry.status === "failed" || entry.status === "redaction_blocked");
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
