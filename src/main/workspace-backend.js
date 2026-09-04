"use strict";

/**
 * Host-side workspace backend transport.
 *
 * The Electron host owns UI and browser surfaces. Workspace truth is delegated to
 * a resident backend process. For WSL workspaces on Windows this starts one
 * long-lived `wsl.exe` process running `src/backend/wsl-agent.js` inside the
 * selected distro/root. For local/dev workspaces it starts the same agent as a
 * local child process.
 */

const { EventEmitter } = require("node:events");
const { spawn } = require("node:child_process");
const path = require("node:path");
const crypto = require("node:crypto");
const fs = require("node:fs");

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const ATTACH_TIMEOUT_MS = 30_000;
const MIN_ATTACH_TIMEOUT_MS = 250;
const MAX_NDJSON_FRAME_BYTES = 2 * 1024 * 1024;
const MUTATION_COMMIT_KINDS_BY_METHOD = Object.freeze({
  applyPatch: new Set(["apply_patch_files"]),
  applyWorkspaceWorkerPatch: new Set(["apply_patch_files"]),
  provisionGitWorktree: new Set(["git_worktree_add"]),
  removeGitWorktree: new Set(["git_worktree_remove_non_force"]),
  ensureCodexSandboxArtifactIgnored: new Set(["git_exclude_append"]),
  stageAttachment: new Set(["stage_attachment"]),
  removeAttachmentDraft: new Set(["remove_attachment_draft"]),
  importFile: new Set(["import_file"]),
});
const PUBLIC_BACKEND_CAPABILITY_NAMES = Object.freeze([
  "listTree",
  "readFilePreview",
  "applyPatch",
  "applyWorkspaceWorkerPatch",
  "readFileTransfer",
  "repositorySemanticSnapshot",
  "directEpistemicRepositoryObservation",
  "repositoryRealizationContext",
  "runCommand",
  "runDirectCommand",
  "provisionGitWorktree",
  "removeGitWorktree",
  "initializeWorkspaceWorkerBinding",
  "directTestProfile",
  "runDirectTest",
  "inspectWorkspaceRepository",
  "listWorkspaceRepositoryFiles",
  "matchWorkspaceRepositoryFiles",
  "searchWorkspaceRepositoryText",
  "readWorkspaceRepositoryFile",
  "ensureCodexSandboxArtifactIgnored",
  "listMatchingFiles",
  "resolvePath",
  "watchScaffold",
  "listCodexThreads",
  "readCodexThreadTranscript",
  "analyzeCodexThread",
  "stageAttachment",
  "removeAttachmentDraft",
  "importFile",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function publicBackendErrorCode(value, fallback = "workspace_backend_unavailable") {
  const code = normalizeString(value, "");
  return /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(code)
    ? code
    : fallback;
}

function publicBackendCapabilities(value) {
  const source = isPlainObject(value) ? value : {};
  return Object.fromEntries(PUBLIC_BACKEND_CAPABILITY_NAMES.map((name) => [
    name,
    source[name] === true,
  ]));
}

function boundedAttachTimeoutMs(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(MIN_ATTACH_TIMEOUT_MS, Math.min(120_000, Math.floor(number)))
    : ATTACH_TIMEOUT_MS;
}

function workspaceAttachFailureCode(input = {}) {
  const originalCode = publicBackendErrorCode(
    input.error?.code,
    "workspace_backend_attach_failed",
  );
  if (input.descriptor?.transport !== "wsl.exe" || input.readySeen === true) {
    return originalCode;
  }
  const diagnostic = (Array.isArray(input.recentDiagnostics) ? input.recentDiagnostics : [])
    .map((entry) => `${entry?.type || ""}: ${entry?.text || ""}`)
    .join(" | ");
  if (/Node\.js is required inside the selected WSL distro/i.test(diagnostic)) {
    return "workspace_wsl_node_missing";
  }
  if (/WSL_E_DISTRO_NOT_FOUND|no distribution with the supplied name|distribution .* was not found/i.test(diagnostic)) {
    return "workspace_wsl_distro_unavailable";
  }
  if (
    originalCode === "workspace_backend_attach_handshake_timeout" ||
    originalCode === "workspace_backend_request_timeout" ||
    /UtilAcceptVsock|accept4 failed 110|timed out after|operation timed out/i.test(diagnostic)
  ) {
    return "workspace_wsl_interop_unavailable";
  }
  return originalCode;
}

function workspaceBackendRecovery(errorCode = "", workspaceKind = "") {
  const code = publicBackendErrorCode(errorCode, "");
  if (workspaceKind === "wsl" && code === "workspace_wsl_interop_unavailable") {
    return {
      retryAvailable: true,
      hostActionRequired: true,
      action: "restart_wsl_interop_then_retry",
      automaticResetAllowed: false,
      canonicalHistoryAtRisk: false,
    };
  }
  if (code && code !== "workspace_backend_agent_missing") {
    return {
      retryAvailable: true,
      hostActionRequired: false,
      action: "retry_workspace_attachment",
      automaticResetAllowed: false,
      canonicalHistoryAtRisk: false,
    };
  }
  return {
    retryAvailable: false,
    hostActionRequired: false,
    action: "none",
    automaticResetAllowed: false,
    canonicalHistoryAtRisk: false,
  };
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function normalizeBackendMutationOutcome(value, pending = {}, resultEnvelope = null) {
  if (!isPlainObject(value) || value.schema !== "workspace_backend_mutation_outcome@1") return null;
  const outcomeDigest = normalizeString(value.outcomeDigest, "");
  if (!/^sha256:[a-f0-9]{64}$/.test(outcomeDigest)) return null;
  const requestId = normalizeString(value.requestId, "");
  const method = normalizeString(value.method, "");
  const commitKind = normalizeString(value.commitKind, "");
  if (
    !requestId || !method || !commitKind ||
    (pending.requestId && requestId !== pending.requestId) ||
    (pending.method && method !== pending.method) ||
    !MUTATION_COMMIT_KINDS_BY_METHOD[method]?.has(commitKind) ||
    value.rawPathIncluded !== false
  ) {
    return null;
  }
  const committed = value.committed === true;
  const indeterminate = value.indeterminate === true;
  const partialMutationPossible = value.partialMutationPossible === true;
  const failureCode = value.committed === true
    ? ""
    : publicBackendErrorCode(value.failureCode, "");
  const resultDigest = normalizeString(value.resultDigest, "");
  if (
    (committed && (indeterminate || partialMutationPossible || failureCode || !/^sha256:[a-f0-9]{64}$/.test(resultDigest))) ||
    (!committed && (!indeterminate || !partialMutationPossible || !failureCode || resultDigest))
  ) {
    return null;
  }
  const base = {
    schema: "workspace_backend_mutation_outcome@1",
    requestId,
    method,
    commitKind,
    committed,
    ...(committed ? {} : { indeterminate, partialMutationPossible }),
    retainedForInspection: value.retainedForInspection === true,
    ...(committed ? { resultDigest } : { failureCode }),
    rawPathIncluded: false,
  };
  const expectedDigest = `sha256:${crypto.createHash("sha256").update(stableStringify(base)).digest("hex")}`;
  if (outcomeDigest !== expectedDigest) return null;
  if (committed && resultEnvelope) {
    const resultBase = { ...resultEnvelope };
    delete resultBase.requestOutcome;
    const expectedResultDigest = `sha256:${crypto.createHash("sha256")
      .update(stableStringify(resultBase)).digest("hex")}`;
    if (resultDigest !== expectedResultDigest) return null;
  }
  return { ...base, outcomeDigest };
}

function indeterminateBackendMutationOutcome(pending = {}, failureCode = "workspace_backend_request_write_failed") {
  const commitKinds = MUTATION_COMMIT_KINDS_BY_METHOD[pending.method];
  if (!(commitKinds instanceof Set) || commitKinds.size !== 1) return null;
  const base = {
    schema: "workspace_backend_mutation_outcome@1",
    requestId: normalizeString(pending.requestId, ""),
    method: normalizeString(pending.method, ""),
    commitKind: [...commitKinds][0],
    committed: false,
    indeterminate: true,
    partialMutationPossible: true,
    retainedForInspection: false,
    failureCode: publicBackendErrorCode(failureCode, "workspace_backend_request_write_failed"),
    rawPathIncluded: false,
  };
  return {
    ...base,
    outcomeDigest: `sha256:${crypto.createHash("sha256").update(stableStringify(base)).digest("hex")}`,
  };
}

function backendIntakeClosedError() {
  const error = new Error("Workspace backend intake is closed for ordered drain.");
  error.code = "workspace_backend_manager_intake_closed";
  return error;
}

function normalizeWorkspace(input, repoPath, fallbackRoot) {
  const raw = isPlainObject(input) ? input : null;
  if (raw?.kind === "wsl") {
    return {
      kind: "wsl",
      distro: normalizeString(raw.distro, ""),
      linuxPath: normalizeLinuxPath(raw.linuxPath, "/home"),
      label: normalizeString(raw.label, ""),
    };
  }
  if (raw?.kind === "windows") {
    return {
      kind: "windows",
      windowsPath: normalizeString(
        raw.windowsPath || raw.localPath,
        normalizeString(repoPath, "C:\\"),
      ),
      windowsNodePath: normalizeString(raw.windowsNodePath, ""),
      label: normalizeString(raw.label, ""),
    };
  }
  return {
    kind: "local",
    localPath: normalizeString(raw?.localPath, normalizeString(repoPath, fallbackRoot)),
    label: normalizeString(raw?.label, ""),
  };
}

function normalizeLinuxPath(value, fallback = "/home") {
  const text = normalizeString(value, fallback).replace(/\\/g, "/");
  return text.startsWith("/") ? text : `/${text}`;
}

function workspaceRootIsAbsolute(value, workspaceKind = "local", hostPlatform = process.platform) {
  const root = normalizeString(value, "");
  if (!root) return false;
  const kind = normalizeString(workspaceKind, "local");
  if (kind === "windows") return path.win32.isAbsolute(root);
  if (kind === "wsl") return path.posix.isAbsolute(root);
  return hostPlatform === "win32"
    ? path.win32.isAbsolute(root)
    : path.posix.isAbsolute(root);
}

function shellSingleQuote(value) {
  return `'${String(value ?? "").replace(/'/g, `'\"'\"'`)}'`;
}

function workspaceRoot(project, fallbackRoot) {
  const workspace = normalizeWorkspace(project?.workspace, project?.repoPath, fallbackRoot);
  return workspace.kind === "wsl"
    ? workspace.linuxPath
    : workspace.kind === "windows"
      ? workspace.windowsPath
      : workspace.localPath;
}

function workspaceLabel(project, fallbackRoot) {
  const workspace = normalizeWorkspace(project?.workspace, project?.repoPath, fallbackRoot);
  if (workspace.kind === "wsl") {
    const distro = workspace.distro ? `${workspace.distro}:` : "default:";
    return `WSL ${distro}${workspace.linuxPath}`;
  }
  if (workspace.kind === "windows") {
    return `Windows ${workspace.windowsPath}`;
  }
  return `Local ${workspace.localPath}`;
}

const PRIVATE_BACKEND_STATUS_KEYS = new Set([
  "args",
  "command",
  "cwd",
  "env",
  "key",
  "localpath",
  "linuxpath",
  "nativeroot",
  "repopath",
  "root",
  "windowspath",
  "workspace",
  "worktreepath",
]);

function rawPathVariants(value) {
  const source = normalizeString(value, "");
  if (!source) return [];
  return [...new Set([
    source,
    source.replace(/\\/g, "/"),
    source.replace(/\//g, "\\"),
  ].filter(Boolean))].sort((left, right) => right.length - left.length);
}

function redactBackendNativePaths(value, nativePaths = []) {
  let text = typeof value === "string" ? value : "";
  for (const nativePath of nativePaths.flatMap(rawPathVariants)) {
    if (!nativePath) continue;
    text = text.replaceAll(nativePath, "<workspace>");
    const escaped = nativePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(escaped, "gi"), "<workspace>");
  }
  return text
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\s"'<>]+/g, "<native-path>")
    .replace(/(^|[\s("'=])\/(?:[^\s"'<>]+)/g, (_match, prefix) => `${prefix}<native-path>`);
}

function safeBackendPublicValue(value, nativePaths = []) {
  if (typeof value === "string") return redactBackendNativePaths(value, nativePaths);
  if (Array.isArray(value)) return value.map((entry) => safeBackendPublicValue(entry, nativePaths));
  if (!isPlainObject(value)) return value;
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (PRIVATE_BACKEND_STATUS_KEYS.has(key.toLowerCase())) continue;
    result[key] = safeBackendPublicValue(entry, nativePaths);
  }
  return result;
}

function workspaceSessionKey(project, fallbackRoot) {
  const workspace = normalizeWorkspace(project?.workspace, project?.repoPath, fallbackRoot);
  if (workspace.kind === "wsl") return `wsl:${workspace.distro || "default"}:${workspace.linuxPath}`;
  if (workspace.kind === "windows") {
    return `windows:${workspace.windowsPath.toLowerCase()}`;
  }
  return `local:${path.resolve(workspace.localPath || fallbackRoot || ".")}`;
}

function cleanEnvForLocalAgent() {
  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
  };
}

function windowsNodePath(workspace, options = {}) {
  const candidates = [
    workspace.windowsNodePath,
    options.windowsNodePath,
    "/mnt/c/Program Files/nodejs/node.exe",
    "/mnt/c/Program Files (x86)/nodejs/node.exe",
  ].map((entry) => normalizeString(entry, "")).filter(Boolean);
  return candidates.find((entry) => fs.existsSync(entry)) || "";
}

function windowsUncPathForWslPath(value, options = {}) {
  const source = normalizeString(value, "").replace(/\//g, "\\");
  const distro = normalizeString(
    options.wslDistro || process.env.WSL_DISTRO_NAME,
    "Ubuntu",
  );
  if (!source.startsWith("\\")) {
    throw new Error("Windows resident executor agent path must be absolute.");
  }
  return `\\\\wsl.localhost\\${distro}${source}`;
}

function launchDescriptor(project, options) {
  const workspace = normalizeWorkspace(project.workspace, project.repoPath, options.fallbackRoot);
  const agentPath = options.agentPath;
  const projectId = project.id || "unknown-project";

  if (workspace.kind === "wsl" && process.platform === "win32") {
    const quotedAgentPath = shellSingleQuote(agentPath);
    const quotedProjectId = shellSingleQuote(projectId);
    const args = [];
    if (workspace.distro) args.push("-d", workspace.distro);
    args.push(
      "--cd",
      workspace.linuxPath,
      "--",
      "bash",
      "-lc",
      [
        "set -e",
        "if ! command -v node >/dev/null 2>&1; then echo 'Node.js is required inside the selected WSL distro.' >&2; exit 127; fi",
        `exec node "$(wslpath -a -- ${quotedAgentPath})" --root "$(pwd)" --workspace-kind wsl --project-id ${quotedProjectId}`,
      ].join("; "),
    );
    return {
      command: "wsl.exe",
      args,
      cwd: undefined,
      env: process.env,
      transport: "wsl.exe",
      workspace,
    };
  }

  if (workspace.kind === "windows" && process.platform !== "win32") {
    const nativeNodePath = windowsNodePath(workspace, options);
    if (!nativeNodePath) {
      throw new Error(
        "Native Windows Node.js is required for a Windows resident workspace executor.",
      );
    }
    const windowsAgentPath = windowsUncPathForWslPath(agentPath, options);
    return {
      command: nativeNodePath,
      args: [
        windowsAgentPath,
        "--root",
        workspace.windowsPath,
        "--workspace-kind",
        "windows",
        "--project-id",
        projectId,
      ],
      cwd: undefined,
      env: process.env,
      transport: "windows-native-resident",
      workspace,
    };
  }

  // Local/dev path. This is also used when running from Linux/WSL directly so
  // the same config can be smoke-tested without a native Windows host.
  const root = workspace.kind === "wsl"
    ? workspace.linuxPath
    : workspace.kind === "windows"
      ? workspace.windowsPath
      : workspace.localPath;
  return {
    command: process.execPath,
    args: [agentPath, "--root", root, "--workspace-kind", workspace.kind, "--project-id", projectId],
    cwd: root,
    env: cleanEnvForLocalAgent(),
    transport: workspace.kind === "wsl" ? "direct-linux-dev" : "local-child",
    workspace,
  };
}

class NdjsonTransport extends EventEmitter {
  constructor(child) {
    super();
    this.child = child;
    this.buffer = Buffer.alloc(0);
    this.bufferBytes = 0;
    this.pending = new Map();
    this.closed = false;

    child.stdout.on("data", (chunk) => this.handleData(chunk));
    child.stdout.on("error", (error) => this.failProtocol(error, "workspace_backend_stdout_read_failed"));
    child.stderr.on("data", (chunk) => this.emit("stderr", chunk));
    child.stderr.on("error", (error) => this.failProtocol(error, "workspace_backend_stderr_read_failed"));
    child.stdin?.on?.("error", (error) => this.failPendingWrites(error));
    child.on("error", (error) => this.close(error));
    child.on("exit", (code, signal) => {
      const error = new Error(`Workspace backend exited: code=${code ?? "null"} signal=${signal ?? "null"}`);
      error.exitCode = code;
      error.signal = signal;
      this.close(error);
      this.emit("exit", { code, signal });
    });
  }

  handleData(chunk) {
    const source = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk || ""), "utf8");
    let offset = 0;
    while (offset < source.length) {
      const newlineIndex = source.indexOf(0x0a, offset);
      const segmentEnd = newlineIndex >= 0 ? newlineIndex : source.length;
      const segmentBytes = segmentEnd - offset;
      if (this.bufferBytes + segmentBytes > MAX_NDJSON_FRAME_BYTES) {
        this.failProtocol(
          new Error("Workspace backend NDJSON frame exceeded the bounded transport limit."),
          "workspace_backend_ndjson_frame_too_large",
        );
        return;
      }
      if (segmentBytes > 0) {
        this.buffer = Buffer.concat([
          this.buffer,
          Buffer.from(source.subarray(offset, segmentEnd)),
        ], this.bufferBytes + segmentBytes);
        this.bufferBytes += segmentBytes;
      }
      if (newlineIndex < 0) return;
      const line = this.buffer.toString("utf8").trim();
      this.buffer = Buffer.alloc(0);
      this.bufferBytes = 0;
      if (line) this.handleLine(line);
      offset = newlineIndex + 1;
    }
  }

  failProtocol(error, fallbackCode) {
    if (this.closed) return;
    const failure = error instanceof Error ? error : new Error(String(error || "Workspace backend transport failed."));
    failure.code = normalizeString(failure.code, fallbackCode);
    this.close(failure);
    try {
      if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill("SIGTERM");
    } catch {}
  }

  failPendingWrites(error) {
    if (this.closed) return;
    const failure = error instanceof Error ? error : new Error(String(error || "Workspace backend request write failed."));
    const writes = [...this.pending.values()].filter((pending) => pending.kind === "request" && pending.writePending);
    if (!writes.length) {
      this.failProtocol(failure, "workspace_backend_stdin_write_failed");
      return;
    }
    for (const pending of writes) this.handleWriteFailure(pending.requestId, failure);
    this.failProtocol(failure, "workspace_backend_stdin_write_failed");
  }

  handleWriteFailure(id, error) {
    const pending = this.clearPending(id);
    if (!pending || pending.clientSettled) return;
    const failureCode = publicBackendErrorCode(error?.code, "workspace_backend_request_write_failed");
    const mutationOutcome = indeterminateBackendMutationOutcome(pending, failureCode);
    const wrapped = error instanceof Error ? error : new Error(String(error || "Workspace backend request write failed."));
    wrapped.code = failureCode;
    wrapped.requestId = pending.requestId;
    wrapped.backendQuiesced = false;
    wrapped.cancellationAcknowledged = false;
    wrapped.backendRequestCompleted = false;
    wrapped.workspaceBackendRequest = true;
    wrapped.mutationOutcome = mutationOutcome;
    wrapped.partialMutationPossible = mutationOutcome?.partialMutationPossible === true;
    pending.clientSettled = true;
    pending.reject(wrapped);
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.emit("event", { type: "protocol-error", error: `Invalid backend JSON: ${error.message}`, raw: line });
      return;
    }

    if (message.event) {
      this.emit("event", message);
      return;
    }

    if (message.id !== undefined && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.clearPending(message.id);
      if (pending.kind === "cancel_control") {
        const target = this.pending.get(pending.targetRequestId);
        if (!target) return;
        if (
          message.error ||
          message.result?.targetRequestId !== pending.targetRequestId ||
          message.result?.acknowledged !== true ||
          message.result?.quiesced !== true
        ) {
          target.cancellationControlError = normalizeString(
            message.error?.code || message.result?.blockerCode,
            "workspace_backend_cancel_unacknowledged",
          );
          return;
        }
        const mutationOutcome = normalizeBackendMutationOutcome(message.result?.mutationOutcome, target);
        if (message.result?.mutationOutcome && !mutationOutcome) {
          target.cancellationControlError = "workspace_backend_mutation_outcome_invalid";
          return;
        }
        if (mutationOutcome?.committed === true) {
          // A cancellation receipt can prove that the commit happened, but it
          // cannot bind or reconstruct the result payload. Retain ownership
          // until the original response arrives and its resultDigest is checked
          // against that exact payload.
          clearTimeout(target.timer);
          target.timer = null;
          this.detachPendingSignal(target);
          target.committedOutcomeReceipt = mutationOutcome;
          return;
        }
        this.clearPending(pending.targetRequestId);
        const error = mutationOutcome?.partialMutationPossible === true
          ? this.backendError({
              message: "Workspace backend mutation failed after entering its commit phase; partial mutation may have occurred.",
              code: "workspace_backend_mutation_commit_failed_indeterminate",
              backendRequestCompleted: true,
              backendQuiesced: true,
              mutationOutcome,
            }, target)
          : this.abortError(target, message.result);
        if (!target.clientSettled) {
          target.clientSettled = true;
          target.reject(error);
        }
        return;
      }
      let requestOutcome = null;
      if (message.result?.requestOutcome !== undefined) {
        requestOutcome = normalizeBackendMutationOutcome(
          message.result.requestOutcome,
          pending,
          message.result,
        );
        if (!requestOutcome) {
          if (pending.cancelRequestId) this.clearPending(pending.cancelRequestId);
          if (!pending.clientSettled) {
            pending.clientSettled = true;
            pending.reject(this.backendError({
              message: "Workspace backend returned an invalid or foreign mutation outcome.",
              code: "workspace_backend_mutation_outcome_invalid",
              backendRequestCompleted: true,
              backendQuiesced: pending.committedOutcomeReceipt ? true : false,
              mutationOutcome: pending.committedOutcomeReceipt || null,
            }, pending));
          }
          return;
        }
        if (
          pending.committedOutcomeReceipt &&
          pending.committedOutcomeReceipt.outcomeDigest !== requestOutcome.outcomeDigest
        ) {
          if (pending.cancelRequestId) this.clearPending(pending.cancelRequestId);
          if (!pending.clientSettled) {
            pending.clientSettled = true;
            pending.reject(this.backendError({
              message: "Workspace backend commit receipts conflicted across cancellation and result delivery.",
              code: "workspace_backend_mutation_outcome_conflict",
              backendRequestCompleted: true,
              backendQuiesced: true,
              mutationOutcome: pending.committedOutcomeReceipt,
            }, pending));
          }
          return;
        }
        message.result = { ...message.result, requestOutcome };
      }
      if (pending.committedOutcomeReceipt && requestOutcome?.committed !== true) {
        if (pending.cancelRequestId) this.clearPending(pending.cancelRequestId);
        if (!pending.clientSettled) {
          pending.clientSettled = true;
          pending.reject(this.backendError({
            message: "Workspace backend proved that a mutation committed but did not return its exact body-bound result receipt.",
            code: "workspace_backend_committed_result_receipt_missing",
            backendRequestCompleted: true,
            backendQuiesced: true,
            mutationOutcome: pending.committedOutcomeReceipt,
          }, pending));
        }
        return;
      }
      if (pending.abortRequested) {
        if (pending.cancelRequestId) this.clearPending(pending.cancelRequestId);
        if (message.error) {
          if (!pending.clientSettled) {
            pending.clientSettled = true;
            pending.reject(this.backendError(message.error, pending));
          }
          return;
        }
        if (requestOutcome?.committed === true) {
          if (!pending.clientSettled) {
            pending.clientSettled = true;
            pending.resolve(message.result);
          }
          return;
        }
        if (!pending.clientSettled) {
          pending.clientSettled = true;
          pending.reject(this.abortError(pending, {
            acknowledged: true,
            quiesced: true,
            acknowledgementKind: "request_completed_after_cancel",
            targetRequestId: message.id,
          }));
        }
        return;
      }
      if (message.error) {
        pending.reject(this.backendError(message.error, pending));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    this.emit("event", { type: "unmatched-message", message });
  }

  clearPending(id) {
    const pending = this.pending.get(id);
    if (!pending) return null;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    this.detachPendingSignal(pending);
    return pending;
  }

  detachPendingSignal(pending) {
    if (pending?.signal?.removeEventListener && pending.abortListener) {
      pending.signal.removeEventListener("abort", pending.abortListener);
    }
    if (pending) pending.abortListener = null;
  }

  backendError(messageError = {}, pending = {}) {
    const mutationOutcome = normalizeBackendMutationOutcome(messageError.mutationOutcome, pending);
    const error = new Error(messageError.message || "Workspace backend request failed.");
    error.code = normalizeString(messageError.code, "");
    error.backendStack = messageError.stack;
    error.requestId = normalizeString(pending.requestId, "");
    error.backendRequestCompleted = messageError.backendRequestCompleted === true;
    error.backendQuiesced = messageError.backendQuiesced === true;
    error.cancellationAcknowledged = (
      pending.abortRequested === true &&
      error.backendRequestCompleted === true &&
      error.backendQuiesced === true
    );
    error.workspaceBackendRequest = true;
    error.mutationOutcome = mutationOutcome;
    error.partialMutationPossible = mutationOutcome?.partialMutationPossible === true;
    if (error.cancellationAcknowledged) {
      error.cancellationReceipt = {
        targetRequestId: normalizeString(pending.requestId, ""),
        acknowledged: true,
        quiesced: true,
        acknowledgementKind: "request_terminal_error_after_cancel",
        outcomeDigest: normalizeString(mutationOutcome?.outcomeDigest, ""),
        rawProcessDetailsIncluded: false,
      };
    }
    return error;
  }

  abortError(pending, cancellationReceipt = {}) {
    const error = new Error(`Workspace backend request cancelled: ${pending.method}`);
    error.name = "AbortError";
    error.code = pending.timeoutTriggered
      ? "workspace_backend_request_timeout"
      : "workspace_backend_request_cancelled";
    error.requestId = pending.requestId;
    error.backendQuiesced = cancellationReceipt.quiesced === true;
    error.cancellationAcknowledged = cancellationReceipt.acknowledged === true;
    error.backendRequestCompleted = cancellationReceipt.quiesced === true;
    error.workspaceBackendRequest = true;
    error.cancellationReceipt = {
      targetRequestId: normalizeString(cancellationReceipt.targetRequestId, pending.requestId),
      acknowledged: cancellationReceipt.acknowledged === true,
      quiesced: cancellationReceipt.quiesced === true,
      acknowledgementKind: normalizeString(cancellationReceipt.acknowledgementKind, "backend_cancel_acknowledged"),
      outcomeDigest: normalizeString(cancellationReceipt.outcomeDigest, ""),
      rawProcessDetailsIncluded: false,
    };
    error.mutationOutcome = normalizeBackendMutationOutcome(cancellationReceipt.mutationOutcome, pending);
    error.partialMutationPossible = error.mutationOutcome?.partialMutationPossible === true;
    return error;
  }

  sendCancellationRequest(pending, options = {}) {
    if (!pending || pending.cancelRequestId || this.closed) return;
    const cancelRequestId = crypto.randomUUID();
    pending.cancelRequestId = cancelRequestId;
    const payload = {
      id: cancelRequestId,
      method: normalizeString(options.cancellationMethod, "cancelRequest"),
      params: {
        requestId: pending.requestId,
        reasonCode: normalizeString(options.reasonCode, "workspace_backend_request_aborted"),
      },
    };
    this.pending.set(cancelRequestId, {
      kind: "cancel_control",
      requestId: cancelRequestId,
      targetRequestId: pending.requestId,
      method: payload.method,
      timer: null,
      signal: null,
      abortListener: null,
      writePending: true,
    });
    try {
      this.child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        const cancelPending = this.pending.get(cancelRequestId);
        if (cancelPending) cancelPending.writePending = false;
        if (!error) return;
        this.clearPending(cancelRequestId);
        pending.cancellationControlError = normalizeString(
          error?.code,
          "workspace_backend_cancel_write_failed",
        );
      });
    } catch (error) {
      this.clearPending(cancelRequestId);
      pending.cancellationControlError = normalizeString(
        error?.code,
        "workspace_backend_cancel_write_failed",
      );
    }
  }

  request(method, params = {}, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, options = {}) {
    if (typeof timeoutMs === "object" && timeoutMs !== null) {
      options = timeoutMs;
      timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    }
    if (this.closed) return Promise.reject(new Error("Workspace backend transport is closed."));
    const id = crypto.randomUUID();
    const payload = { id, method, params };
    const signal = options.signal || null;
    if (signal?.aborted) {
      const pending = { requestId: id, method };
      return Promise.reject(this.abortError(pending, {
        acknowledged: true,
        quiesced: true,
        acknowledgementKind: "cancelled_before_send",
        targetRequestId: id,
      }));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) return;
        pending.timer = null;
        pending.abortRequested = true;
        pending.timeoutTriggered = true;
        this.detachPendingSignal(pending);
        this.sendCancellationRequest(pending, {
          cancellationMethod: options.cancellationMethod,
          reasonCode: pending.signal?.reason || "workspace_backend_request_timeout",
        });
        // A request deadline starts cancellation. It does not prove that the
        // request, its process tree, or a two-phase mutation has stopped.
      }, timeoutMs);
      const pending = {
        kind: "request",
        requestId: id,
        resolve,
        reject,
        timer,
        method,
        signal,
        abortListener: null,
        abortRequested: false,
        abortRequestedBeforeTimeout: false,
        timeoutTriggered: false,
        clientSettled: false,
        cancelRequestId: "",
        cancellationControlError: "",
        writePending: true,
      };
      if (signal?.addEventListener) {
        pending.abortListener = () => {
          if (!this.pending.has(id) || pending.abortRequested) return;
          pending.abortRequested = true;
          pending.abortRequestedBeforeTimeout = true;
          this.sendCancellationRequest(pending, {
            cancellationMethod: options.cancellationMethod,
            reasonCode: signal.reason,
          });
        };
        signal.addEventListener("abort", pending.abortListener, { once: true });
      }
      this.pending.set(id, pending);
      try {
        this.child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
          const sentPending = this.pending.get(id);
          if (sentPending) sentPending.writePending = false;
          if (!error) return;
          const failedPending = this.pending.get(id);
          if (failedPending?.cancelRequestId) this.clearPending(failedPending.cancelRequestId);
          this.handleWriteFailure(id, error);
        });
      } catch (error) {
        const failedPending = this.pending.get(id);
        if (failedPending?.cancelRequestId) this.clearPending(failedPending.cancelRequestId);
        this.handleWriteFailure(id, error);
      }
    });
  }

  pendingRequestCount() {
    return [...this.pending.values()].filter((pending) => pending.kind === "request").length;
  }

  async waitForDrain(options = {}) {
    const timeoutMs = Number.isFinite(Number(options.timeoutMs))
      ? Math.max(0, Math.min(300_000, Math.floor(Number(options.timeoutMs))))
      : 30_000;
    if (this.pendingRequestCount() === 0) return { status: "drained", pendingRequests: 0 };
    if (timeoutMs === 0) {
      return { status: "timeout", blockerCode: "workspace_backend_drain_timeout", pendingRequests: this.pendingRequestCount() };
    }
    const startedAt = Date.now();
    while (this.pendingRequestCount() > 0 && Date.now() - startedAt < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(10, timeoutMs)));
    }
    return this.pendingRequestCount() === 0
      ? { status: "drained", blockerCode: "", pendingRequests: 0 }
      : { status: "timeout", blockerCode: "workspace_backend_drain_timeout", pendingRequests: this.pendingRequestCount() };
  }

  close(error) {
    if (this.closed) return;
    this.closed = true;
    for (const [id, pending] of this.pending.entries()) {
      this.clearPending(id);
      if (pending.kind !== "request") continue;
      const closeError = new Error(error?.message || "Workspace backend transport closed.");
      closeError.code = normalizeString(error?.code, "workspace_backend_transport_closed");
      closeError.backendRequestCompleted = false;
      closeError.backendQuiesced = false;
      closeError.cancellationAcknowledged = false;
      closeError.workspaceBackendRequest = true;
      if (!pending.clientSettled) {
        pending.clientSettled = true;
        pending.reject(closeError);
      }
    }
    this.emit("closed", error);
  }

  dispose() {
    this.close(new Error("Workspace backend disposed."));
    try {
      this.child.stdin.end();
    } catch {}
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    this.child.kill("SIGTERM");
    const timer = setTimeout(() => {
      if (this.child.exitCode !== null || this.child.signalCode !== null) return;
      this.child.kill("SIGKILL");
    }, 1500);
    timer.unref?.();
    this.child.once("exit", () => clearTimeout(timer));
  }
}

class WorkspaceSession extends EventEmitter {
  constructor(project, options) {
    super();
    this.project = project;
    this.options = options;
    this.key = workspaceSessionKey(project, options.fallbackRoot);
    this.child = null;
    this.transport = null;
    this.status = "idle";
    this.attachPromise = null;
    this.descriptor = null;
    this.hello = null;
    this.lastError = null;
    this.readySeen = false;
    this.hygiene = null;
    this.workspaceWorkerBinding = null;
    this.workspaceWorkerBindingInitialization = null;
    this.recentDiagnostics = [];
    this.acceptingRequests = true;
  }

  snapshot() {
    return {
      key: this.key,
      projectId: this.project.id,
      projectName: this.project.name,
      status: this.status,
      transport: this.descriptor?.transport || "not-started",
      workspace: this.descriptor?.workspace || normalizeWorkspace(this.project.workspace, this.project.repoPath, this.options.fallbackRoot),
      hello: this.hello,
      lastError: this.lastError,
      readySeen: this.readySeen,
      hygiene: this.hygiene,
      workspaceWorkerBinding: this.workspaceWorkerBinding,
    };
  }

  nativePathCandidates() {
    const workspace = this.descriptor?.workspace || normalizeWorkspace(
      this.project.workspace,
      this.project.repoPath,
      this.options.fallbackRoot,
    );
    return [
      workspace?.localPath,
      workspace?.linuxPath,
      workspace?.windowsPath,
      this.descriptor?.cwd,
      this.hello?.root,
      this.hello?.cwd,
    ].map((entry) => normalizeString(entry, "")).filter(Boolean);
  }

  publicSnapshot() {
    const workspaceKind = normalizeString(
      this.descriptor?.workspace?.kind || this.project.workspace?.kind,
      "local",
    );
    const lastErrorCode = this.lastError
      ? publicBackendErrorCode(this.lastError?.code)
      : "";
    const hello = this.hello ? {
      protocolVersion: this.hello.protocolVersion,
      sessionId: normalizeString(this.hello.sessionId, ""),
      projectId: normalizeString(this.hello.projectId, this.project.id),
      workspaceKind: normalizeString(this.hello.workspaceKind, ""),
      platform: normalizeString(this.hello.platform, "unknown"),
      node: normalizeString(this.hello.node, ""),
      capabilities: publicBackendCapabilities(this.hello.capabilities),
      rawWorkspacePathIncluded: false,
    } : null;
    return {
      schema: "workspace_backend_public_session@1",
      sessionKeyDigest: `sha256:${crypto.createHash("sha256").update(this.key).digest("hex")}`,
      projectId: normalizeString(this.project.id, ""),
      projectName: normalizeString(this.project.name, ""),
      status: this.status,
      transport: this.descriptor?.transport || "not-started",
      workspaceKind,
      hello,
      lastErrorCode,
      recovery: workspaceBackendRecovery(lastErrorCode, workspaceKind),
      readySeen: this.readySeen,
      hygiene: isPlainObject(this.hygiene) ? {
        available: this.hygiene.available === true,
        changed: this.hygiene.changed === true,
        skipped: this.hygiene.skipped === true,
        reason: normalizeString(this.hygiene.reason, ""),
      } : null,
      workspaceWorkerBinding: safeBackendPublicValue(
        this.workspaceWorkerBinding,
        this.nativePathCandidates(),
      ),
      rawWorkspacePathIncluded: false,
    };
  }

  publicAgentEvent(event = {}) {
    return {
      event: normalizeString(event.event || event.type, "backend-event"),
      platform: normalizeString(event.platform, ""),
      protocolVersion: Number(event.protocolVersion || 0),
      projectId: normalizeString(event.projectId, this.project.id),
      workspaceKind: normalizeString(event.workspaceKind, this.project.workspace?.kind || ""),
      errorCode: event.error || event.code
        ? publicBackendErrorCode(event.error?.code || event.code, "workspace_backend_event_error")
        : "",
      rawWorkspacePathIncluded: false,
      rawProtocolFrameIncluded: false,
    };
  }

  noteDiagnostic(type, value) {
    const text = normalizeString(value, "");
    if (!text) return;
    this.recentDiagnostics.push({
      type,
      text: text.slice(0, 500),
      at: new Date().toISOString(),
    });
    if (this.recentDiagnostics.length > 8) this.recentDiagnostics.shift();
  }

  attachFailureMessage(error) {
    const details = [];
    if (this.descriptor) {
      details.push(`transport=${this.descriptor.transport}`);
      details.push(`command=${this.descriptor.command}`);
      if (this.descriptor.cwd) details.push(`cwd=${this.descriptor.cwd}`);
    }
    details.push(`readySeen=${this.readySeen ? "yes" : "no"}`);
    const recent = this.recentDiagnostics.map((item) => `${item.type}: ${item.text}`).join(" | ");
    if (recent) details.push(`recent=${recent}`);
    return redactBackendNativePaths(
      `${error.message}${details.length ? ` (${details.join("; ")})` : ""}`,
      this.nativePathCandidates(),
    );
  }

  emitStatus(type, extra = {}) {
    const payload = {
      type,
      session: this.publicSnapshot(),
      at: new Date().toISOString(),
      errorCode: extra.error || extra.errorCode
        ? publicBackendErrorCode(extra.error?.code || extra.errorCode)
        : "",
      rawWorkspacePathIncluded: false,
    };
    this.emit("status", payload);
  }

  async attach(options = {}) {
    if (!this.acceptingRequests && options.allowDuringDrain !== true) {
      throw backendIntakeClosedError();
    }
    if (this.status === "attached" && this.transport && !this.transport.closed) {
      if (options.workspaceWorkerBinding) {
        await this.initializeWorkspaceWorkerBinding(options.workspaceWorkerBinding);
      }
      return this;
    }
    if (this.attachPromise) {
      const attached = await this.attachPromise;
      if (options.workspaceWorkerBinding) {
        await this.initializeWorkspaceWorkerBinding(options.workspaceWorkerBinding);
      }
      return attached;
    }

    this.attachPromise = this.attachInner(options)
      .then(() => {
        this.attachPromise = null;
        return this;
      })
      .catch((error) => {
        this.attachPromise = null;
        throw error;
      });
    return this.attachPromise;
  }

  async attachInner(options = {}) {
    this.status = "starting";
    this.lastError = null;
    this.readySeen = false;
    this.hello = null;
    this.hygiene = null;
    this.workspaceWorkerBinding = null;
    this.workspaceWorkerBindingInitialization = null;
    this.recentDiagnostics = [];
    this.descriptor = launchDescriptor(this.project, this.options);
    this.emitStatus("backend-starting");

    if (!fs.existsSync(this.options.agentPath)) {
      const error = new Error("Workspace backend agent is unavailable.");
      error.code = "workspace_backend_agent_missing";
      this.status = "failed";
      this.lastError = error;
      this.emitStatus("backend-failed", { error });
      throw error;
    }

    const spawnImpl = this.options.spawnImpl || spawn;
    this.child = spawnImpl(this.descriptor.command, this.descriptor.args, {
      cwd: this.descriptor.cwd,
      env: this.descriptor.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.transport = new NdjsonTransport(this.child);
    this.transport.on("event", (event) => {
      this.emit("agent-event", {
        session: this.publicSnapshot(),
        event: this.publicAgentEvent(event),
        rawWorkspacePathIncluded: false,
      });
      if (event.event === "ready") {
        this.readySeen = true;
        this.noteDiagnostic("agent-ready", `${event.platform || "unknown"} pid=${event.pid || "unknown"}`);
        this.emitStatus("backend-agent-ready", { agent: event });
      }
      if (event.event === "startup-error") {
        this.lastError = event.error;
        this.noteDiagnostic("startup-error", event.error);
        this.status = "failed";
        this.emitStatus("backend-failed", { error: event.error });
      }
    });
    this.transport.on("stderr", (chunk) => {
      const text = String(chunk || "").trim();
      if (text) {
        this.noteDiagnostic("stderr", text);
        this.emitStatus("backend-stderr", { stderr: text.slice(0, 2000) });
      }
    });
    this.transport.on("closed", (error) => {
      if (this.status !== "failed" && this.status !== "disposed") {
        this.status = "closed";
        this.lastError = error?.message || "Backend closed.";
        this.emitStatus("backend-closed", { error: this.lastError });
      }
    });

    this.status = "attaching";
    try {
      const attachTimeoutMs = boundedAttachTimeoutMs(this.options.attachTimeoutMs);
      let handshakeTimer = null;
      try {
        this.hello = await Promise.race([
          this.transport.request("hello", {}, attachTimeoutMs),
          new Promise((_resolve, reject) => {
            handshakeTimer = setTimeout(() => {
              const timeoutError = new Error("Workspace backend attach handshake timed out.");
              timeoutError.code = "workspace_backend_attach_handshake_timeout";
              reject(timeoutError);
            }, attachTimeoutMs);
          }),
        ]);
      } finally {
        if (handshakeTimer) clearTimeout(handshakeTimer);
      }
      if (options.workspaceWorkerBinding) {
        await this.initializeWorkspaceWorkerBinding(options.workspaceWorkerBinding);
      }
      if (options.workspaceHygiene !== false) {
        try {
          this.hygiene = await this.transport.request("ensureCodexSandboxArtifactIgnored", {}, DEFAULT_REQUEST_TIMEOUT_MS);
          if (this.hygiene?.changed) {
            this.noteDiagnostic("workspace-hygiene", `Added local Git exclude ${this.hygiene.pattern || ""}`.trim());
          }
        } catch (error) {
          this.hygiene = { available: false, changed: false, error: error.message };
          this.noteDiagnostic("workspace-hygiene", error.message);
        }
      } else {
        this.hygiene = {
          available: true,
          changed: false,
          skipped: true,
          reason: "probe_only_attachment",
        };
      }
      this.status = "attached";
      this.emitStatus("backend-attached");
    } catch (error) {
      const privateMessage = this.attachFailureMessage(error);
      const errorCode = workspaceAttachFailureCode({
        error,
        descriptor: this.descriptor,
        readySeen: this.readySeen,
        recentDiagnostics: this.recentDiagnostics,
      });
      this.status = "failed";
      const publicError = new Error("Workspace backend attach failed.");
      publicError.code = errorCode;
      this.lastError = publicError;
      this.noteDiagnostic("attach-failed", privateMessage);
      this.emitStatus("backend-failed", { error: publicError });
      this.dispose({ preserveStatus: true });
      throw publicError;
    }
  }

  async request(method, params = {}, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, requestOptions = {}) {
    const cancellationControl = method === "cancelRequest";
    if (!this.acceptingRequests && !cancellationControl) throw backendIntakeClosedError();
    await this.attach({ allowDuringDrain: true });
    if (!this.transport) throw new Error("Workspace backend transport is unavailable.");
    return this.transport.request(method, params, timeoutMs, requestOptions);
  }

  beginDrain() {
    this.acceptingRequests = false;
    return {
      status: "draining",
      pendingRequests: this.transport?.pendingRequestCount?.() || 0,
    };
  }

  async drain(options = {}) {
    if (!this.transport) return { status: "drained", blockerCode: "", pendingRequests: 0 };
    return this.transport.waitForDrain(options);
  }

  async initializeWorkspaceWorkerBinding(binding) {
    if (!this.transport || this.transport.closed) {
      throw new Error("Workspace backend transport is unavailable for worker binding initialization.");
    }
    const requestedDigest = normalizeString(binding?.bindingDigest, "");
    if (!requestedDigest) {
      const error = new Error("Workspace worker binding initialization requires one binding digest.");
      error.code = "workspace_worker_binding_missing";
      throw error;
    }
    if (this.workspaceWorkerBinding?.bindingDigest === requestedDigest) {
      return this.workspaceWorkerBinding;
    }
    if (this.workspaceWorkerBinding) {
      const error = new Error("Workspace backend session already has a different immutable worker binding.");
      error.code = "workspace_worker_binding_already_initialized";
      throw error;
    }
    if (this.workspaceWorkerBindingInitialization) {
      if (this.workspaceWorkerBindingInitialization.bindingDigest !== requestedDigest) {
        const error = new Error("Workspace backend session has a conflicting binding initialization in flight.");
        error.code = "workspace_worker_binding_already_initialized";
        throw error;
      }
      return this.workspaceWorkerBindingInitialization.promise;
    }
    const pending = { bindingDigest: requestedDigest, promise: null };
    pending.promise = this.transport.request(
      "initializeWorkspaceWorkerBinding",
      { binding },
      DEFAULT_REQUEST_TIMEOUT_MS,
    ).then((initialized) => {
      if (
        normalizeString(initialized?.bindingDigest, "") !== requestedDigest ||
        initialized?.immutable !== true
      ) {
        const error = new Error("Workspace backend did not acknowledge the requested immutable worker binding.");
        error.code = "workspace_worker_binding_initialization_unacknowledged";
        throw error;
      }
      this.workspaceWorkerBinding = {
        schema: normalizeString(initialized.schema, "direct_workspace_worker_binding_initialization@1"),
        bindingId: normalizeString(initialized.bindingId, ""),
        bindingDigest: requestedDigest,
        backendSessionId: normalizeString(initialized.backendSessionId, ""),
        projectId: normalizeString(initialized.projectId, ""),
        workerKey: normalizeString(initialized.workerKey, ""),
        workspaceKind: normalizeString(initialized.workspaceKind, ""),
        branch: normalizeString(initialized.branch, ""),
        baseCommit: normalizeString(initialized.baseCommit, ""),
        rootEvidenceDigest: normalizeString(initialized.rootEvidenceDigest, ""),
        immutable: true,
        rawWorkspacePathIncluded: false,
      };
      return this.workspaceWorkerBinding;
    }).finally(() => {
      if (this.workspaceWorkerBindingInitialization === pending) {
        this.workspaceWorkerBindingInitialization = null;
      }
    });
    this.workspaceWorkerBindingInitialization = pending;
    return pending.promise;
  }

  dispose(options = {}) {
    const preserveStatus = options.preserveStatus === true;
    if (!preserveStatus) this.status = "disposed";
    if (this.transport) this.transport.dispose();
    if (!preserveStatus) this.emitStatus("backend-disposed");
  }
}

class WorkspaceBackendManager extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.sessions = new Map();
    this.intakeState = "accepting";
  }

  sessionForProject(project) {
    const key = workspaceSessionKey(project, this.options.fallbackRoot);
    let session = this.sessions.get(key);
    if (!session) {
      if (this.intakeState !== "accepting") throw backendIntakeClosedError();
      session = new WorkspaceSession(project, this.options);
      session.on("status", (payload) => this.emit("status", payload));
      session.on("agent-event", (payload) => this.emit("agent-event", payload));
      this.sessions.set(key, session);
    } else {
      session.project = project;
    }
    return session;
  }

  async ensureForProject(project, options = {}) {
    if (this.intakeState !== "accepting") throw backendIntakeClosedError();
    const session = this.sessionForProject(project);
    await session.attach(options);
    return session;
  }

  async requestForProject(project, method, params = {}, timeoutMs, requestOptions = {}) {
    if (this.intakeState !== "accepting" && method !== "cancelRequest") {
      throw backendIntakeClosedError();
    }
    if (this.intakeState !== "accepting") {
      const key = workspaceSessionKey(project, this.options.fallbackRoot);
      const ownedSession = this.sessions.get(key);
      if (!ownedSession) throw backendIntakeClosedError();
      return ownedSession.request(method, params, timeoutMs, requestOptions);
    }
    const session = await this.ensureForProject(project);
    return session.request(method, params, timeoutMs, requestOptions);
  }

  statusForProject(project) {
    const key = workspaceSessionKey(project, this.options.fallbackRoot);
    const session = this.sessions.get(key);
    if (session) return session.publicSnapshot();
    if (this.intakeState !== "accepting") return null;
    return this.sessionForProject(project).publicSnapshot();
  }

  privateStatusForProject(project) {
    const key = workspaceSessionKey(project, this.options.fallbackRoot);
    const session = this.sessions.get(key);
    if (session) return session.snapshot();
    if (this.intakeState !== "accepting") return null;
    return this.sessionForProject(project).snapshot();
  }

  disposeForProject(project) {
    const key = workspaceSessionKey(project, this.options.fallbackRoot);
    const session = this.sessions.get(key);
    if (!session) return false;
    session.dispose();
    this.sessions.delete(key);
    return true;
  }

  disposeAll() {
    this.intakeState = "disposed";
    for (const session of this.sessions.values()) session.dispose();
    this.sessions.clear();
  }

  async drainAll(options = {}) {
    this.intakeState = "draining";
    for (const session of this.sessions.values()) session.beginDrain();
    const rows = await Promise.all([...this.sessions.values()].map(async (session) => ({
      key: session.key,
      ...(await session.drain(options)),
    })));
    const blocked = rows.filter((row) => row.status !== "drained");
    return {
      status: blocked.length ? "timeout" : "drained",
      blockerCode: blocked.length ? "workspace_backend_manager_drain_timeout" : "",
      sessions: rows,
      pendingRequests: rows.reduce((total, row) => total + Number(row.pendingRequests || 0), 0),
    };
  }
}

module.exports = {
  NdjsonTransport,
  WorkspaceSession,
  WorkspaceBackendManager,
  normalizeWorkspace,
  publicBackendErrorCode,
  workspaceAttachFailureCode,
  workspaceBackendRecovery,
  workspaceLabel,
  workspaceRoot,
  workspaceRootIsAbsolute,
  workspaceSessionKey,
};
