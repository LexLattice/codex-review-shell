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

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
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
    this.buffer = "";
    this.pending = new Map();
    this.closed = false;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.handleData(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => this.emit("stderr", chunk));
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
    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line) this.handleLine(line);
      newlineIndex = this.buffer.indexOf("\n");
    }
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
        this.clearPending(pending.targetRequestId);
        const error = this.abortError(target, message.result);
        if (!target.clientSettled) {
          target.clientSettled = true;
          target.reject(error);
        }
        return;
      }
      if (pending.abortRequested) {
        if (pending.cancelRequestId) this.clearPending(pending.cancelRequestId);
        if (message.result?.requestOutcome?.committed === true) {
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
        const error = new Error(message.error.message || "Workspace backend request failed.");
        error.code = normalizeString(message.error.code, "");
        error.backendStack = message.error.stack;
        error.backendRequestCompleted = true;
        error.backendQuiesced = true;
        error.workspaceBackendRequest = true;
        pending.reject(error);
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
    });
    this.child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
      if (!error) return;
      this.clearPending(cancelRequestId);
      pending.cancellationControlError = normalizeString(
        error?.code,
        "workspace_backend_cancel_write_failed",
      );
    });
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
      this.child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (!error) return;
        const failedPending = this.clearPending(id);
        if (failedPending?.cancelRequestId) this.clearPending(failedPending.cancelRequestId);
        error.backendQuiesced = false;
        error.cancellationAcknowledged = false;
        error.backendRequestCompleted = false;
        error.workspaceBackendRequest = true;
        if (!failedPending?.clientSettled) {
          failedPending.clientSettled = true;
          reject(error);
        }
      });
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
    const hello = this.hello ? {
      protocolVersion: this.hello.protocolVersion,
      sessionId: normalizeString(this.hello.sessionId, ""),
      projectId: normalizeString(this.hello.projectId, this.project.id),
      workspaceKind: normalizeString(this.hello.workspaceKind, ""),
      platform: normalizeString(this.hello.platform, "unknown"),
      node: normalizeString(this.hello.node, ""),
      capabilities: isPlainObject(this.hello.capabilities) ? { ...this.hello.capabilities } : {},
      rawWorkspacePathIncluded: false,
    } : null;
    return {
      schema: "workspace_backend_public_session@1",
      sessionKeyDigest: `sha256:${crypto.createHash("sha256").update(this.key).digest("hex")}`,
      projectId: normalizeString(this.project.id, ""),
      projectName: normalizeString(this.project.name, ""),
      status: this.status,
      transport: this.descriptor?.transport || "not-started",
      workspaceKind: normalizeString(
        this.descriptor?.workspace?.kind || this.project.workspace?.kind,
        "local",
      ),
      hello,
      lastErrorCode: normalizeString(this.lastError?.code, this.lastError ? "workspace_backend_unavailable" : ""),
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
      errorCode: normalizeString(event.error?.code || event.code, event.error ? "workspace_backend_event_error" : ""),
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
      errorCode: normalizeString(extra.error?.code || extra.errorCode, extra.error ? "workspace_backend_unavailable" : ""),
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
    this.workspaceWorkerBinding = null;
    this.workspaceWorkerBindingInitialization = null;
    this.recentDiagnostics = [];
    this.descriptor = launchDescriptor(this.project, this.options);
    this.emitStatus("backend-starting");

    if (!fs.existsSync(this.options.agentPath)) {
      const message = `Workspace backend agent is missing: ${this.options.agentPath}`;
      this.status = "failed";
      this.lastError = message;
      this.emitStatus("backend-failed", { error: message });
      throw new Error(message);
    }

    this.child = spawn(this.descriptor.command, this.descriptor.args, {
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
      this.hello = await this.transport.request("hello", {}, ATTACH_TIMEOUT_MS);
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
      const message = this.attachFailureMessage(error);
      this.status = "failed";
      this.lastError = message;
      this.emitStatus("backend-failed", { error: message });
      this.dispose();
      const attachError = new Error(message);
      attachError.code = normalizeString(error?.code, "");
      throw attachError;
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

  dispose() {
    this.status = "disposed";
    if (this.transport) this.transport.dispose();
    this.emitStatus("backend-disposed");
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
  workspaceLabel,
  workspaceRoot,
  workspaceRootIsAbsolute,
  workspaceSessionKey,
};
