"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const {
  authorizeDirectThreadHarnessCapability,
  validateDirectThreadHarnessGrant,
} = require("../authority/direct-thread-harness-grant");
const { spawn } = require("node:child_process");
const { BubblewrapExecSandbox, sandboxedReadRefusal, workspaceExecutesLocally } = require("./exec-sandbox");
const { WindowsJobSandbox } = require("./windows-job-runner");

const SANDBOXED_WRITER_PATH = path.join(__dirname, "sandboxed-file-writer.js");
const SANDBOXED_WRITE_TIMEOUT_MS = 30_000;
const SANDBOXED_WRITER_ENV_KEYS = [
  "PATH", "HOME", "SystemRoot", "ComSpec", "PATHEXT", "windir", "SystemDrive",
  "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "ProgramData",
  "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "USERNAME", "OS",
  "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS",
];

// Runs sandboxed-file-writer.js inside the Workspace sandbox of this host
// (bubblewrap on Linux, the Low-integrity job runner on Windows) with this
// process's own runtime (node, or Electron as node).
function runSandboxedWrites({ root, files }) {
  const platform = process.platform;
  const sandbox = platform === "win32" ? new WindowsJobSandbox({ platform }) : new BubblewrapExecSandbox({ platform });
  const plan = sandbox.wrap({
    sandboxMode: "workspace-write",
    root,
    cwd: root,
    command: process.execPath,
    args: [SANDBOXED_WRITER_PATH],
  });
  const env = { ELECTRON_RUN_AS_NODE: "1" };
  for (const key of SANDBOXED_WRITER_ENV_KEYS) if (process.env[key] !== undefined) env[key] = process.env[key];
  Object.assign(env, plan.env || {});
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(plan.command, plan.args, { cwd: root, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    } catch (error) {
      reject(localError("direct_access_profile_sandboxed_write_unavailable", `The sandboxed writer couldn't start (${error?.code || error?.message || "error"}).`));
      return;
    }
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, SANDBOXED_WRITE_TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(localError("direct_access_profile_sandboxed_write_unavailable", `The sandboxed writer couldn't start (${error?.code || "error"}).`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (plan.scratchDir) fs.rm(plan.scratchDir, { recursive: true, force: true, maxRetries: 3 }, () => {});
      let result = null;
      try { result = JSON.parse(out); } catch {}
      if (code === 0 && result?.ok === true) {
        resolve(result);
        return;
      }
      reject(localError(
        normalizeString(result?.code, "direct_access_profile_sandboxed_write_failed"),
        normalizeString(result?.message, `The sandboxed write failed${err ? `: ${boundedString(err.trim(), 200)}` : ""}.`),
      ));
    });
    child.stdin.end(JSON.stringify({ root, files }));
  });
}

const LOCAL_EXECUTOR_SANDBOX_MODES = new Set(["read-only", "workspace-write", "danger-full-access"]);

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

// Patches are matched on LF-normalized lines; the result is written back
// with the file's own dominant line ending, and new files use the
// environment's default (CRLF on Windows, as the model is told).
function lineEndingFor(existingText, environmentKind) {
  const text = String(existingText || "");
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/\n/g) || []).length - crlf;
  if (crlf || lf) return crlf > lf ? "\r\n" : "\n";
  return environmentKind === "windows" ? "\r\n" : "\n";
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

// `@@ -a,b +c,d @@` (unified), or as in Codex's patch format a bare `@@`,
// optionally followed by an anchor: a line the hunk comes after (for
// example `@@ def handler():`). Bare hunks are located by their context.
function parseHunkHeader(line) {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (match) {
    return {
      oldStart: Number(match[1]),
      oldCount: Number(match[2] ?? 1),
      newStart: Number(match[3]),
      newCount: Number(match[4] ?? 1),
      lines: [],
    };
  }
  if (!line.startsWith("@@")) throw localError("direct_full_access_patch_invalid", "Patch hunk header is malformed.");
  const anchor = line.slice(2).replace(/^ /, "").replace(/ ?@@$/, "");
  return { oldStart: null, oldCount: null, newStart: null, newCount: null, anchor, lines: [] };
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
      while (index < lines.length && (!lines[index].startsWith("*** ") || lines[index] === "*** End of File")) {
        if (lines[index] === "*** End of File") {
          if (hunks.length) hunks[hunks.length - 1].endOfFile = true;
          index += 1;
          continue;
        }
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
        // Codex lets an update's first hunk start without an `@@` line.
        if (operation === "update" && !hunks.length && /^[ +-]/.test(lines[index])) {
          const hunk = { oldStart: null, oldCount: null, newStart: null, newCount: null, anchor: "", lines: [] };
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
      // A blank line closing a hunk is the patch's own layout, not context.
      for (const hunk of hunks) {
        if (operation === "create") continue;
        while (hunk.lines.length && hunk.lines[hunk.lines.length - 1] === "") hunk.lines.pop();
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

// As Codex does, context matches exactly first, then ignoring trailing
// whitespace, then ignoring surrounding whitespace.
const LINE_COMPARISONS = [
  (a, b) => a === b,
  (a, b) => a.trimEnd() === b.trimEnd(),
  (a, b) => a.trim() === b.trim(),
];

function hunkMismatchMessage(hunk, wanted) {
  const first = wanted.find((line) => line.trim()) ?? wanted[0] ?? "";
  return `Patch hunk${hunk.anchor ? ` after "${boundedString(hunk.anchor, 120)}"` : ""} does not match the file: no lines matching "${boundedString(first, 160)}"${wanted.length > 1 ? ` (and the ${wanted.length - 1} lines after it)` : ""} were found. Read the file and retry with its current text.`;
}

function findHunkStart(before, hunk, preferred, minimumStart = 0) {
  const wanted = hunk.lines.filter((line) => line[0] !== "+").map((line) => line.slice(1));
  const lastStart = before.length - wanted.length;
  for (const same of LINE_COMPARISONS) {
    const matches = (start) => start >= minimumStart && start <= lastStart &&
      wanted.every((line, offset) => same(before[start + offset], line));
    if (hunk.endOfFile && matches(lastStart)) return lastStart;
    const boundedPreferred = Math.max(minimumStart, preferred);
    if (matches(boundedPreferred)) return boundedPreferred;
    for (let start = minimumStart; start <= lastStart; start += 1) {
      if (matches(start)) return start;
    }
  }
  throw localError("direct_full_access_patch_conflict", hunkMismatchMessage(hunk, wanted));
}

function anchorIndex(lines, anchor, from) {
  for (const same of LINE_COMPARISONS) {
    for (let index = from; index < lines.length; index += 1) {
      if (same(lines[index], anchor)) return index;
    }
  }
  throw localError("direct_full_access_patch_conflict", `Patch anchor "${boundedString(anchor, 160)}" was not found in the file. Read the file and retry with its current text.`);
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
    let minimum = cursor;
    if (hunk.anchor) minimum = anchorIndex(result, hunk.anchor, cursor) + 1;
    const hasContext = hunk.lines.some((line) => line[0] !== "+");
    // A bare hunk with no context adds after its anchor, or at the end.
    const preferred = hunk.oldStart !== null && hunk.oldStart !== undefined
      ? Math.max(0, (hunk.oldStart || 1) - 1)
      : hasContext ? minimum : hunk.anchor ? minimum : result.length;
    const start = hasContext || hunk.oldStart !== null
      ? findHunkStart(result, hunk, Math.max(minimum, preferred), minimum)
      : preferred;
    const oldLines = hunk.lines.filter((line) => line[0] !== "+").map((line) => line.slice(1));
    // Context lines keep the file's own text (they may have matched loosely).
    const newLines = [];
    let oldOffset = 0;
    for (const line of hunk.lines) {
      if (line[0] === "+") newLines.push(line.slice(1));
      else if (line[0] === "-") oldOffset += 1;
      else {
        newLines.push(result[start + oldOffset]);
        oldOffset += 1;
      }
    }
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

// Resolves symlinks on the deepest existing ancestor so a not-yet-created
// file is still checked against the real directory it would land in.
function realPathOfNearestExistingAncestor(target) {
  let current = target;
  const suffix = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...suffix.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
      const parent = path.dirname(current);
      if (parent === current) return target;
      suffix.push(path.basename(current));
      current = parent;
    }
  }
}

function pathIsInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

/**
 * Everything that touches files for the Direct file environment. The host
 * executor class owns grants, patch parsing, planning, and results; a port
 * owns target resolution, bounded reads, profile checks, and the final
 * verify-then-write commit. LocalFilePort runs in-process; the WSL executor
 * runs this same class natively behind `fs/*`, and ExecutorFilePort (in
 * executor-file-port.js) reaches it from another host.
 */
class LocalFilePort {
  constructor(options = {}) {
    this.kind = "local";
    this.workspaceRootResolver = typeof options.workspaceRootResolver === "function"
      ? options.workspaceRootResolver
      : (input = {}) => input.workspaceRoot || input.project?.workspaceRoot || "";
    this.sandboxedWriter = typeof options.sandboxedWriter === "function" ? options.sandboxedWriter : runSandboxedWrites;
  }

  // Sandboxed profiles: the checks before opening and the open itself are
  // separate steps, so a concurrent (sandboxed) command could swap a path for
  // a symlink in between. After opening, the path is resolved again and must
  // still name the very file that was opened, and that file must be allowed.
  async assertOpenedFileAllowed(grant, resolved, handle, purpose = "read") {
    if (!grant || grant.sandboxMode === "danger-full-access") return;
    const changed = () => localError("direct_access_profile_path_changed", "The file changed while it was being opened. Try again.");
    const opened = await handle.stat();
    let real;
    let current;
    try {
      real = fs.realpathSync(resolved.target);
      current = fs.statSync(real);
    } catch {
      throw changed();
    }
    if (current.dev !== opened.dev || current.ino !== opened.ino) throw changed();
    let realRoot = resolved.root;
    try { realRoot = fs.realpathSync(resolved.root); } catch {}
    if (purpose === "patch") {
      if (!pathIsInside(realRoot, real)) {
        throw localError(
          "direct_access_profile_path_outside_workspace",
          "Workspace access only allows changes inside the project folder. Ask the user to switch Access to Full access to change files outside it.",
        );
      }
      return;
    }
    const refusal = sandboxedReadRefusal(real, { workspaceRoot: realRoot });
    if (refusal) {
      throw localError(
        refusal,
        refusal === "direct_access_profile_credential_store_hidden"
          ? "Workspace and Read-only access cannot read credential stores. Ask the user to switch Access to Full access if this file is needed."
          : "Workspace and Read-only access cannot read outside this environment's own filesystem. Ask the user to switch Access to Full access if this file is needed.",
      );
    }
  }

  resolveTarget(input, grant, rawPath, label) {
    const rootCandidate = this.workspaceRootResolver(input, grant?.executionEnvironment);
    if (!rootCandidate || !fs.existsSync(String(rootCandidate))) throw localError("direct_full_access_environment_unavailable", "The selected local execution environment is unavailable.");
    const root = path.resolve(String(rootCandidate));
    const text = pathText(rawPath, label);
    const target = path.resolve(path.isAbsolute(text) ? text : path.join(root, text));
    return {
      root,
      target,
      canonicalTarget: process.platform === "win32" ? target.toLowerCase() : target,
      pathEvidenceKey: safePathEvidence(target),
    };
  }

  // Sandboxed profiles see what their sandboxed shell sees: no Windows drives
  // from WSL, no interop sockets, no credential stores.
  assertReadable(grant, resolved) {
    if (grant?.sandboxMode === "danger-full-access") return;
    let real = resolved.target;
    try { real = fs.realpathSync(resolved.target); } catch {}
    let realRoot = resolved.root;
    try { realRoot = fs.realpathSync(resolved.root); } catch {}
    const refusal = sandboxedReadRefusal(real, { workspaceRoot: realRoot });
    if (refusal) {
      throw localError(
        refusal,
        refusal === "direct_access_profile_credential_store_hidden"
          ? "Workspace and Read-only access cannot read credential stores. Ask the user to switch Access to Full access if this file is needed."
          : "Workspace and Read-only access cannot read outside this environment's own filesystem. Ask the user to switch Access to Full access if this file is needed.",
      );
    }
  }

  async readFile(resolved, maxBytesInput, _input = {}, grant = null) {
    let handle;
    try {
      handle = await fsp.open(resolved.target, "r");
    } catch {
      throw localError("direct_full_access_file_unavailable", "The selected local file is unavailable.");
    }
    try {
      await this.assertOpenedFileAllowed(grant, resolved, handle, "read");
      const initialStat = await handle.stat();
      if (!initialStat.isFile()) throw localError("direct_full_access_file_invalid", "The selected local path is not a regular file.");
      const requestedBytes = Number(maxBytesInput);
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
      return { size: finalStat.size, bytes: buffer.subarray(0, bytesRead) };
    } finally {
      await handle.close().catch(() => {});
    }
  }

  async readPatchTarget(resolved, operation, _input = {}, grant = null) {
    let handle;
    try {
      handle = await fsp.open(resolved.target, "r");
    } catch (error) {
      if (operation === "create" && error?.code === "ENOENT") return { exists: false, bytes: Buffer.alloc(0) };
      throw localError("direct_full_access_patch_target_unavailable", "The selected local patch target is unavailable.");
    }
    try {
      await this.assertOpenedFileAllowed(grant, resolved, handle, "patch");
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

  async assertWritable(grant, resolved) {
    if (grant.sandboxMode === "danger-full-access") return;
    if (grant.sandboxMode === "read-only") {
      throw localError(
        "direct_access_profile_write_blocked",
        "Read-only access does not allow file changes. Ask the user to switch Access to Workspace or Full access.",
      );
    }
    const realRoot = fs.realpathSync(resolved.root);
    const realTarget = realPathOfNearestExistingAncestor(resolved.target);
    if (!pathIsInside(realRoot, realTarget)) {
      throw localError(
        "direct_access_profile_path_outside_workspace",
        "Workspace access only allows changes inside the project folder. Ask the user to switch Access to Full access to change files outside it.",
      );
    }
  }

  // Revalidates every target (profile, existence, before-digest) before
  // mutating any of them, preserving validate-all-before-mutate under races.
  async commit(grant, plans) {
    for (const plan of plans) {
      await this.assertWritable(grant, plan._resolved);
      if (!plan.beforeExists) {
        const current = await this.readPatchTarget(plan._resolved, "create", {}, grant);
        if (current.exists) throw localError("direct_full_access_patch_target_exists", "Patch create target appeared before apply.");
        continue;
      }
      const current = await this.readPatchTarget(plan._resolved, plan.operation === "delete" ? "delete" : "update", {}, grant);
      if (!current.exists || sha256(current.bytes.toString("utf8")) !== plan.beforeDigest) {
        throw localError("direct_full_access_patch_conflict", "The selected local patch target changed before apply.");
      }
    }
    if (grant?.sandboxMode === "workspace-write") {
      // Workspace writes happen inside the sandbox, like Codex's apply_patch:
      // the host checks above can't stop a path from being swapped for a
      // symlink before a host-side write, but the sandbox can't reach
      // outside the project however the path resolves.
      const root = fs.realpathSync(plans[0]._resolved.root);
      await this.sandboxedWriter({
        root,
        files: plans.map((plan) => ({
          target: path.join(root, path.relative(plan._resolved.root, plan._resolved.target)),
          operation: plan.operation === "delete" ? "delete" : "write",
          contentBase64: plan.operation === "delete" ? "" : Buffer.from(plan._afterText, "utf8").toString("base64"),
        })),
      });
      return;
    }
    for (const plan of plans) {
      const target = plan._resolved.target;
      if (plan.operation === "delete") {
        await fsp.unlink(target);
        continue;
      }
      await fsp.mkdir(path.dirname(target), { recursive: true });
      const tempPath = `${target}.codex-direct-patch-${process.pid}-${Date.now()}.tmp`;
      await fsp.writeFile(tempPath, plan._afterText, "utf8");
      await fsp.rename(tempPath, target);
    }
  }
}

function resolveFileEnvironmentGrant(input = {}, capabilityName, grantStore = null) {
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
  if (grantStore && grantId && typeof grantStore.reconstruct === "function") {
    try { grant = grantStore.reconstruct(grantId, { ...expected, grantId, requireCurrent: true }); } catch { grant = null; }
  } else if (grantStore && typeof grantStore.currentForScope === "function") {
    try { grant = grantStore.currentForScope(expected); } catch { grant = null; }
  }
  const errors = grant ? validateDirectThreadHarnessGrant(grant, { ...expected, requireCurrent: true }) : ["grant_missing"];
  if (errors.length || !LOCAL_EXECUTOR_SANDBOX_MODES.has(grant?.sandboxMode)) {
    throw localError(errors.includes("grant_missing") ? "direct_full_access_grant_missing" : "direct_full_access_grant_not_current", "The exact current local full-access grant is required.");
  }
  const authorization = grantStore?.authorize && grant.grantId
    ? grantStore.authorize(grant.grantId, capabilityName, expected)
    : authorizeDirectThreadHarnessCapability(grant, capabilityName, { ...expected, runtimeAdmittedCapabilityNames: [capabilityName] });
  if (!authorization?.authorized) throw localError(authorization?.reason || "direct_full_access_capability_not_authorized", "The current task grant does not authorize this local capability.");
  return { grant, expected, authorization };
}

class DirectFullAccessLocalEnvironmentExecutor {
  constructor(options = {}) {
    this.grantStore = options.grantStore || null;
    this.localPort = new LocalFilePort({ workspaceRootResolver: options.workspaceRootResolver });
    this.executorFilePort = options.executorFilePort || null;
    this.workspaceLocalityResolver = typeof options.workspaceLocalityResolver === "function"
      ? options.workspaceLocalityResolver
      : (kind, project) => workspaceExecutesLocally(kind, project);
  }

  // The local port serves workspaces local to this host; a WSL or Windows
  // workspace opened from elsewhere is served by that environment's executor.
  portFor(grant, project = {}) {
    const kind = grant?.executionEnvironment?.kind;
    if (this.workspaceLocalityResolver(kind, project)) return this.localPort;
    if ((kind === "wsl" || kind === "windows") && this.executorFilePort) return this.executorFilePort;
    return null;
  }

  canServe(grant, project = {}) {
    return Boolean(this.portFor(grant, project));
  }

  resolveGrant(input = {}, capabilityName) {
    const resolved = resolveFileEnvironmentGrant(input, capabilityName, this.grantStore);
    if (!this.portFor(resolved.grant, input.project || {})) {
      throw localError("direct_full_access_grant_not_current", "The exact current local full-access grant is required.");
    }
    return resolved;
  }

  async request(input = {}, method, params = {}) {
    const capability = method === "readFile" ? "read_file" : "apply_patch";
    const { grant, expected, authorization } = this.resolveGrant(input, capability);
    const port = this.portFor(grant, input.project || {});
    if (method === "readFile") return this.readFile(port, input, params, grant, expected, authorization);
    if (method === "applyPatch") return this.applyPatch(port, input, params, grant, expected, authorization);
    throw localError("direct_full_access_method_invalid", `Unsupported full-access local method: ${method}`);
  }

  async readFile(port, input, params, grant, expected, authorization) {
    const resolved = port.resolveTarget(input, grant, params.relPath || params.path, "read_file path");
    await port.assertReadable(grant, resolved, input);
    const { size, bytes } = await port.readFile(resolved, params.maxBytes, input, grant);
    const binary = bytes.includes(0);
    return {
      schema: "workspace_read_file_result@1",
      relPath: resolved.pathEvidenceKey,
      pathEvidenceKey: resolved.pathEvidenceKey,
      text: binary ? "" : bytes.toString("utf8"),
      size,
      truncated: size > bytes.length,
      binary,
      source: port.kind === "local" ? "direct_full_access_local_environment" : "direct_environment_executor",
      grantId: grant.grantId,
      grantRevision: Number(grant.grantRevision),
      executionEnvironmentDigest: expected.executionEnvironmentDigest,
      authorizationMode: authorization.authorityMode || "full_access_task_grant",
      rawPathIncluded: false,
    };
  }

  async applyPatch(port, input, params, grant, expected, authorization) {
    let plans;
    try {
      plans = await this.planPatch(port, input, params, grant);
    } catch (error) {
      // Planning re-reads and re-matches every target before anything is
      // written, so an apply that fails here provably changed nothing (for
      // example, the file changed after the dry run).
      if (params.mode === "apply" && error && typeof error === "object") {
        error.authoritativeNoEffect = true;
        error.effectPhase = "before_effect";
      }
      throw error;
    }
    const patchText = String(params.patch || "");
    if (params.mode !== "apply") return this.publicPatchResult(patchText, plans, "dryRun", grant, expected, authorization);
    await port.commit(grant, plans, input);
    return this.publicPatchResult(patchText, plans, "apply", grant, expected, authorization);
  }

  async planPatch(port, input, params, grant) {
    const patchText = String(params.patch || "");
    const patches = parseUnifiedPatch(patchText);
    const plans = [];
    const canonicalTargets = new Map();
    for (const filePatch of patches) {
      if (filePatch.relPath === "/dev/null") throw localError("direct_full_access_patch_invalid", "Patch target is missing.");
      const resolved = port.resolveTarget(input, grant, filePatch.relPath, "patch target");
      await port.assertWritable(grant, resolved, input);
      if (canonicalTargets.has(resolved.canonicalTarget)) {
        throw localError("direct_full_access_patch_duplicate_target", "Patch contains duplicate canonical workspace targets.");
      }
      canonicalTargets.set(resolved.canonicalTarget, filePatch.relPath);
      const beforeTarget = await port.readPatchTarget(resolved, filePatch.operation, input, grant);
      const beforeText = beforeTarget.bytes.toString("utf8");
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
      const eol = lineEndingFor(beforeTarget.exists ? beforeText : "", grant?.executionEnvironment?.kind);
      const afterText = filePatch.operation === "delete" ? "" : `${afterLines.join(eol)}${before.hasFinalNewline || filePatch.operation === "create" ? eol : ""}`;
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
        _resolved: resolved,
        _afterText: afterText,
      });
    }
    return plans;
  }

  publicPatchResult(patchText, plans, mode, grant, expected, authorization) {
    const files = plans.map(({ _resolved, _afterText, ...file }) => ({ ...file, previewTruncated: file.previewText.length >= 8000 }));
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
  LocalFilePort,
  MAX_PATCH_TARGET_BYTES,
  MAX_READ_FILE_BYTES,
  applyHunks,
  lineEndingFor,
  localError,
  parseUnifiedPatch,
  pathText,
  resolveFileEnvironmentGrant,
  safePathEvidence,
  sha256,
};
