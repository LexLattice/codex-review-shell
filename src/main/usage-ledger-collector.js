"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const { UsageLedgerStore, evidenceRef, sha256, WRITER_VERSION } = require("./usage-ledger-store");

function nowIso() {
  return new Date().toISOString();
}

function cleanString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function cleanNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cleanOptionalNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeUsageLedgerConfig(value = {}) {
  const raw = isPlainObject(value) ? value : {};
  const envEnabled = /^(1|true|yes)$/i.test(String(process.env.CODEX_USAGE_LEDGER_ENABLED || "").trim());
  const rawPathPolicy = cleanString(raw.rawPathPolicy || raw.raw_path_policy, "excluded");
  const payloadHashMode = cleanString(raw.payloadHashMode || raw.payload_hash_mode, "none");
  return {
    enabled: raw.enabled !== false || envEnabled,
    mode: cleanString(raw.mode, "metadata_only"),
    outputDir: cleanString(raw.outputDir || raw.output_dir, ".codex/usage-ledgers"),
    strict: raw.strict === true,
    includePayloadRefs: raw.includePayloadRefs === true || raw.include_payload_refs === true,
    includePromptText: raw.includePromptText === true || raw.include_prompt_text === true,
    includeToolOutputText: raw.includeToolOutputText === true || raw.include_tool_output_text === true,
    includeRequestPayloadHashes: raw.includeRequestPayloadHashes === true || raw.include_request_payload_hashes === true,
    includeResponsePayloadHashes: raw.includeResponsePayloadHashes === true || raw.include_response_payload_hashes === true,
    payloadHashMode: ["none", "sha256", "hmac_sha256"].includes(payloadHashMode) ? payloadHashMode : "none",
    rawPathPolicy: ["excluded", "private_diagnostic_only", "included_explicit"].includes(rawPathPolicy) ? rawPathPolicy : "excluded",
  };
}

function wslUncPath(workspace) {
  if (process.platform !== "win32" || workspace?.kind !== "wsl") return "";
  const distro = cleanString(workspace.distro, "");
  if (!distro) return "";
  const linuxPath = cleanString(workspace.linuxPath, "/").replace(/\\/g, "/").replace(/^\/+/, "");
  return `\\\\wsl.localhost\\${distro}\\${linuxPath.replace(/\//g, "\\")}`;
}

function projectFilesystemRoot(project) {
  if (project?.workspace?.kind === "local") return cleanString(project.workspace.localPath, project.repoPath || "");
  const unc = wslUncPath(project?.workspace);
  if (unc) return unc;
  if (process.platform !== "win32" && project?.workspace?.kind === "wsl") {
    return cleanString(project.workspace.linuxPath, "");
  }
  return "";
}

function safeLedgerSegment(value) {
  return cleanString(value, "unknown").replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 80) || "unknown";
}

function evidenceKey(prefix, value) {
  const text = cleanString(value, "");
  return text ? `${prefix}:${sha256(text).slice(0, 16)}` : "";
}

function tokenUsageBreakdown(value = {}) {
  const raw = isPlainObject(value) ? value : {};
  const inputTokens = cleanNumber(raw.inputTokens ?? raw.input_tokens, 0);
  const cachedInputTokens = cleanNumber(raw.cachedInputTokens ?? raw.cached_input_tokens, 0);
  const outputTokens = cleanNumber(raw.outputTokens ?? raw.output_tokens, 0);
  const reasoningOutputTokens = cleanNumber(raw.reasoningOutputTokens ?? raw.reasoning_output_tokens, 0);
  const totalTokens = cleanNumber(raw.totalTokens ?? raw.total_tokens, inputTokens + outputTokens);
  return {
    inputTokens,
    cachedInputTokens,
    nonCachedInputTokens: Math.max(0, inputTokens - cachedInputTokens),
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
  };
}

function normalizeThreadTokenUsage(params = {}) {
  const usage = params.tokenUsage || params.token_usage || params;
  const total = usage.total || usage.totalTokenUsage || usage.total_token_usage || usage;
  const last = usage.last || usage.lastTokenUsage || usage.last_token_usage || null;
  return {
    threadId: cleanString(params.threadId || params.thread_id, ""),
    turnId: cleanString(params.turnId || params.turn_id, ""),
    total: tokenUsageBreakdown(total),
    last: last ? tokenUsageBreakdown(last) : null,
    modelContextWindow: cleanOptionalNumber(
      usage.modelContextWindow ??
      usage.model_context_window ??
      params.modelContextWindow ??
      params.model_context_window,
    ),
  };
}

function normalizeRateLimitWindow(window) {
  if (!isPlainObject(window)) return undefined;
  const resetsAt = cleanOptionalNumber(window.resetsAt ?? window.resets_at);
  return {
    usedPercent: cleanOptionalNumber(window.usedPercent ?? window.used_percent),
    windowDurationMins: cleanOptionalNumber(window.windowDurationMins ?? window.window_duration_mins),
    resetsAt,
    resetsAtIso: resetsAt ? new Date(resetsAt * 1000).toISOString() : undefined,
  };
}

function normalizeRateLimitSnapshot(params = {}) {
  const response = params.rateLimits || params.rate_limits || params;
  const buckets = response.rateLimitsByLimitId || response.rate_limits_by_limit_id || {};
  const snapshot = buckets.codex || buckets.default || response.rateLimits || response.rate_limits || response;
  if (!isPlainObject(snapshot)) return null;
  return {
    limitId: cleanString(snapshot.limitId ?? snapshot.limit_id, ""),
    limitName: cleanString(snapshot.limitName ?? snapshot.limit_name, ""),
    planType: cleanString(snapshot.planType ?? snapshot.plan_type, ""),
    primary: normalizeRateLimitWindow(snapshot.primary),
    secondary: normalizeRateLimitWindow(snapshot.secondary),
    rateLimitReachedType: cleanString(snapshot.rateLimitReachedType ?? snapshot.rate_limit_reached_type, ""),
  };
}

function turnIdFromParams(params = {}) {
  return cleanString(params.turnId || params.turn_id || params.turn?.id || params.turn?.turnId || params.turn?.turn_id, "");
}

function threadIdFromParams(params = {}) {
  return cleanString(params.threadId || params.thread_id || params.thread?.id || params.thread?.threadId || params.thread?.thread_id, "");
}

function itemFromParams(params = {}) {
  return isPlainObject(params.item) ? params.item : {};
}

function classifyToolKind(item = {}) {
  const type = cleanString(item.type || item.kind, "unknown");
  if (type === "commandExecution" || type === "command_execution") return "command_exec";
  if (type === "fileChange" || type === "file_change") return "file_change";
  if (type === "mcpToolCall" || type === "mcp_tool_call") return "mcp_tool";
  if (type === "dynamicToolCall" || type === "dynamic_tool_call") return "dynamic_tool";
  if (type === "collabAgentToolCall" || type === "collab_tool_call") return "subagent";
  if (type === "hookPrompt") return "hook";
  if (type === "webSearch") return "dynamic_tool";
  return "unknown";
}

function commandPreview(item = {}) {
  const command = item.command || item.cmd || item.arguments?.command || "";
  const text = Array.isArray(command) ? command.join(" ") : String(command || "");
  if (!text) return "";
  return text.length > 180 ? `${text.slice(0, 180)}...` : text;
}

function statusFromItem(item = {}, fallback) {
  return cleanString(item.status || item.state, fallback);
}

function serverRequestKind(method, riskCategory) {
  if (riskCategory === "command" || riskCategory === "file-change" || riskCategory === "permission" || riskCategory === "network") return "approval";
  if (riskCategory === "user-input") return "user_input";
  if (riskCategory === "auth") return "auth_refresh";
  if (riskCategory === "mcp") return "mcp_elicitation";
  if (riskCategory === "dynamic-tool") return "dynamic_tool";
  if (/approval/i.test(method)) return "approval";
  return "unknown";
}

class UsageLedgerCollector {
  constructor(options = {}) {
    this.getProjectById = options.getProjectById;
    this.emitStatus = options.emitStatus;
    this.store = null;
    this.config = normalizeUsageLedgerConfig();
    this.project = null;
    this.connection = null;
    this.started = false;
    this.status = {
      enabled: false,
      state: "disabled",
      ledgerId: "",
      ledgerPath: "",
      manifestPath: "",
      queuedRows: 0,
      droppedRows: 0,
      rowCount: 0,
      lastError: "",
      lastObservedAt: "",
    };
    this.tokenSnapshotSeqByThread = new Map();
    this.lastTokenSnapshotRefByThread = new Map();
  }

  publicStatus() {
    return { ...this.status, ...(this.store ? this.store.status() : {}) };
  }

  publishStatus() {
    this.status = this.publicStatus();
    if (typeof this.emitStatus === "function") this.emitStatus(this.status);
  }

  async start(connection = {}) {
    this.connection = connection || {};
    const projectId = cleanString(connection.projectId, "");
    const project = projectId && typeof this.getProjectById === "function" ? await this.getProjectById(projectId) : null;
    this.project = project;
    const codex = project?.surfaceBinding?.codex || {};
    this.config = normalizeUsageLedgerConfig(codex.usageLedger || codex.usage_ledger || {});
    if (!this.config.enabled) {
      this.status = { ...this.status, enabled: false, state: "disabled", lastError: "" };
      this.publishStatus();
      return this.status;
    }

    const root = projectFilesystemRoot(project);
    if (!root) {
      this.status = {
        ...this.status,
        enabled: true,
        state: "unavailable",
        lastError: "Usage ledger output root is unavailable for this workspace.",
      };
      this.publishStatus();
      if (this.config.strict) throw new Error(this.status.lastError);
      return this.status;
    }

    const outputDir = path.resolve(root, this.config.outputDir);
    const ledgerId = `ledger_${safeLedgerSegment(projectId)}_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
    const ledgerPath = path.join(outputDir, `${ledgerId}.jsonl`);
    try {
      this.store = new UsageLedgerStore({
        ledgerId,
        ledgerPath,
        manifestPath: `${ledgerPath}.manifest.json`,
        rawPathPolicy: this.config.rawPathPolicy,
      });
      await this.store.initialize({
        projectId,
        workspaceRootEvidenceKey: evidenceKey("workspaceRoot", root),
        sourceHome: "",
        codexReleaseTag: "",
        codexReleaseCommit: "",
        codexRuntimeRef: cleanString(connection.binaryPath || "codex", "codex"),
        providerKind: connection.provider?.kind || connection.provider?.profile?.kind || "codex_executable",
        providerProfileId: connection.provider?.profileId || connection.capabilities?.provider?.profileId || "",
        appServerSchemaRef: {
          codexVersion: connection.capabilities?.version || "",
          schemaGeneratedAt: connection.capabilities?.generatedAt || "",
          schemaSource: connection.capabilities ? "manual-static" : "unknown",
          experimentalApiEnabled: true,
        },
        capturePosture: "codex_app_server_event",
        privacyMode: this.config.mode,
        rawPathPolicy: this.config.rawPathPolicy,
      });
    } catch (error) {
      this.store = null;
      this.status = {
        ...this.status,
        enabled: true,
        state: "failed",
        lastError: error.message,
      };
      this.publishStatus();
      if (this.config.strict) throw error;
      return this.status;
    }
    this.started = true;
    this.publishStatus();
    this.append({
      rowKind: "session_started",
      sourceKind: "codex_app_server_event",
      confidence: "runtime_exact",
      projectId,
      connectionId: cleanString(connection.connectionId, ""),
      providerKind: connection.provider?.kind || "codex_executable",
      providerProfileId: connection.provider?.profileId || connection.capabilities?.provider?.profileId || "",
      runtimeCommand: cleanString(connection.binaryPath || "codex", "codex"),
      resolvedRuntime: cleanString(connection.runtime, "unknown"),
      workspaceRootEvidenceKey: evidenceKey("workspaceRoot", root),
      codexHomeEvidenceKey: evidenceKey("codexHome", connection.codexHome || ""),
      appServerTransport: cleanString(connection.transport, "websocket"),
      evidenceRefs: [evidenceRef("app_server_response", "Codex app-server connection initialized", { confidence: "declared" })],
    });
    this.captureConnectionOpened(connection);
    return this.publicStatus();
  }

  append(row) {
    if (!this.store || !this.config.enabled) return Promise.resolve({ ok: false, skipped: true });
    const enriched = {
      projectId: cleanString(row.projectId, cleanString(this.connection?.projectId, "")),
      connectionId: cleanString(row.connectionId, cleanString(this.connection?.connectionId, "")),
      appServerTransport: cleanString(row.appServerTransport, cleanString(this.connection?.transport, "websocket")),
      ...row,
    };
    return this.store.append(enriched).then((result) => {
      this.publishStatus();
      return result;
    });
  }

  captureConnectionOpened(connection = {}) {
    return this.append({
      rowKind: "app_server_connection_opened",
      sourceKind: "codex_app_server_event",
      confidence: "runtime_exact",
      dedupeKey: `${connection.connectionId}:connection_opened`,
      connectionId: cleanString(connection.connectionId, ""),
      transport: cleanString(connection.transport, "websocket"),
      readyUrlEvidenceKey: evidenceKey("readyUrl", connection.readyUrl || ""),
      openedAt: nowIso(),
      evidenceRefs: [evidenceRef("app_server_response", "Codex app-server WebSocket connection opened", { confidence: "proven" })],
    });
  }

  captureConnectionClosed(reason = "") {
    return this.append({
      rowKind: "app_server_connection_closed",
      sourceKind: "codex_app_server_event",
      confidence: "runtime_exact",
      dedupeKey: `${this.connection?.connectionId}:connection_closed:${reason}`,
      connectionId: cleanString(this.connection?.connectionId, ""),
      transport: cleanString(this.connection?.transport, "websocket"),
      closedAt: nowIso(),
      closeReason: cleanString(reason, "closed"),
      evidenceRefs: [evidenceRef("app_server_notification", "Codex app-server connection closed", { confidence: "observed" })],
    });
  }

  captureNotification(method, params = {}) {
    const cleanMethod = cleanString(method, "");
    if (!cleanMethod) return Promise.resolve({ ok: false, skipped: true });
    if (cleanMethod === "turn/started") return this.captureTurnStarted(params);
    if (cleanMethod === "turn/completed") return this.captureTurnCompleted(params);
    if (cleanMethod === "thread/tokenUsage/updated") return this.captureTokenUsage(params);
    if (cleanMethod === "account/rateLimits/updated") return this.captureRateLimits(params, "account/rateLimits/updated");
    if (cleanMethod === "item/started" || cleanMethod === "item/completed") return this.captureItemLifecycle(cleanMethod, params);
    if (cleanMethod === "serverRequest/resolved") {
      return this.append({
        rowKind: "server_request_resolved",
        sourceKind: "codex_app_server_event",
        confidence: "runtime_exact",
        dedupeKey: `${this.connection?.connectionId}:serverRequest/resolved:${params?.requestId}`,
        requestKey: `${cleanString(this.connection?.connectionId, "")}:${String(params?.requestId ?? "")}`,
        requestId: params?.requestId ?? "",
        method: "serverRequest/resolved",
        serverRequestKind: "unknown",
        riskCategory: "unknown",
        status: "resolved",
        resolvedAt: nowIso(),
        evidenceRefs: [evidenceRef("app_server_notification", "serverRequest/resolved notification", { confidence: "proven" })],
      });
    }
    return Promise.resolve({ ok: true, skipped: true });
  }

  captureTurnStarted(params = {}) {
    const turnId = turnIdFromParams(params);
    if (!turnId) return Promise.resolve({ ok: true, skipped: true });
    const threadId = threadIdFromParams(params);
    const turn = params.turn || {};
    return this.append({
      rowKind: "turn_started",
      sourceKind: "codex_app_server_event",
      confidence: "runtime_exact",
      sourceEventKey: `${this.connection?.connectionId}:turn/started:${threadId}:${turnId}`,
      dedupeKey: `${this.connection?.connectionId}:turn/started:${threadId}:${turnId}`,
      threadId,
      turnId,
      modelContextWindow: cleanOptionalNumber(turn.modelContextWindow ?? turn.model_context_window ?? params.modelContextWindow ?? params.model_context_window),
      collaborationModeKind: cleanString(turn.collaborationModeKind ?? turn.collaboration_mode_kind ?? params.collaborationModeKind ?? params.collaboration_mode_kind, ""),
      startedAt: cleanString(turn.startedAt ?? turn.started_at ?? params.startedAt ?? params.started_at, ""),
      evidenceRefs: [evidenceRef("app_server_notification", "turn/started notification", { confidence: "proven" })],
    });
  }

  captureTurnCompleted(params = {}) {
    const turnId = turnIdFromParams(params);
    if (!turnId) return Promise.resolve({ ok: true, skipped: true });
    const threadId = threadIdFromParams(params);
    const turn = params.turn || {};
    return this.append({
      rowKind: "turn_completed",
      sourceKind: "codex_app_server_event",
      confidence: "runtime_exact",
      sourceEventKey: `${this.connection?.connectionId}:turn/completed:${threadId}:${turnId}`,
      dedupeKey: `${this.connection?.connectionId}:turn/completed:${threadId}:${turnId}:${turn.status || ""}`,
      threadId,
      turnId,
      status: cleanString(turn.status || params.status, "completed"),
      completedAt: cleanString(turn.completedAt ?? turn.completed_at ?? params.completedAt ?? params.completed_at, ""),
      durationMs: cleanOptionalNumber(turn.durationMs ?? turn.duration_ms ?? params.durationMs ?? params.duration_ms),
      timeToFirstTokenMs: cleanOptionalNumber(turn.timeToFirstTokenMs ?? turn.time_to_first_token_ms ?? params.timeToFirstTokenMs ?? params.time_to_first_token_ms),
      evidenceRefs: [evidenceRef("app_server_notification", "turn/completed notification", { confidence: "proven" })],
    });
  }

  captureTokenUsage(params = {}) {
    const usage = normalizeThreadTokenUsage(params);
    const threadId = usage.threadId || cleanString(params.threadId, "");
    const snapshotSeq = (this.tokenSnapshotSeqByThread.get(threadId) || 0) + 1;
    this.tokenSnapshotSeqByThread.set(threadId, snapshotSeq);
    const previousSnapshotRef = this.lastTokenSnapshotRefByThread.get(threadId) || "";
    const usageRef = `usage_${crypto.randomUUID()}`;
    this.lastTokenSnapshotRefByThread.set(threadId, usageRef);
    return this.append({
      rowKind: "token_usage",
      sourceKind: "codex_app_server_event",
      confidence: "provider_exact",
      sourceEventKey: `${this.connection?.connectionId}:thread/tokenUsage/updated:${threadId}:${usage.turnId}:${snapshotSeq}`,
      dedupeKey: `${this.connection?.connectionId}:thread/tokenUsage/updated:${threadId}:${usage.turnId}:${snapshotSeq}`,
      threadId,
      turnId: usage.turnId,
      usageRef,
      usageScope: "thread_total",
      snapshotSeq,
      previousSnapshotRef: previousSnapshotRef || undefined,
      ...usage.total,
      lastTokenUsage: usage.last || undefined,
      modelContextWindow: usage.modelContextWindow,
      sourcePayloadShape: "TokenUsageInfo",
      evidenceRefs: [evidenceRef("app_server_notification", "thread/tokenUsage/updated notification", { confidence: "proven" })],
    });
  }

  captureRateLimits(params = {}, sourceMethod = "account/rateLimits/read", requestId = "") {
    const snapshot = normalizeRateLimitSnapshot(params);
    if (!snapshot) {
      return this.append({
        rowKind: "usage_unavailable",
        sourceKind: "unavailable",
        confidence: "unknown",
        unavailableKind: "rate_limits_unsupported",
        targetKind: "account",
        reason: "Rate-limit snapshot was unavailable or unsupported.",
        evidenceRefs: [evidenceRef("app_server_response", `${sourceMethod} did not expose a rate-limit snapshot`, { status: "unavailable", confidence: "unknown" })],
      });
    }
    const snapshotRef = `rate_${crypto.randomUUID()}`;
    return this.append({
      rowKind: "rate_limit_snapshot",
      sourceKind: "codex_app_server_event",
      confidence: "provider_exact",
      sourceEventKey: `${this.connection?.connectionId}:${sourceMethod}:${requestId || snapshotRef}`,
      dedupeKey: `${this.connection?.connectionId}:${sourceMethod}:${requestId || snapshotRef}`,
      snapshotRef,
      accountEvidenceKey: evidenceKey("account", `${snapshot.planType || ""}:${snapshot.limitId || ""}`),
      authMode: "chatgpt",
      ...snapshot,
      evidenceRefs: [evidenceRef(sourceMethod.includes("updated") ? "app_server_notification" : "app_server_response", sourceMethod, { confidence: "proven" })],
    });
  }

  captureItemLifecycle(method, params = {}) {
    const item = itemFromParams(params);
    const toolKind = classifyToolKind(item);
    if (toolKind === "unknown") return Promise.resolve({ ok: true, skipped: true });
    const itemId = cleanString(item.id || params.itemId || params.item_id || "");
    const threadId = threadIdFromParams(params);
    const turnId = turnIdFromParams(params) || cleanString(item.turnId || item.turn_id, "");
    const rowKind = method === "item/started" ? "tool_call_started" : statusFromItem(item, "completed") === "failed" ? "tool_call_failed" : "tool_call_completed";
    const preview = commandPreview(item);
    return this.append({
      rowKind,
      sourceKind: "codex_app_server_event",
      confidence: "runtime_exact",
      sourceEventKey: `${this.connection?.connectionId}:${method}:${threadId}:${turnId}:${itemId}`,
      dedupeKey: `${this.connection?.connectionId}:${method}:${threadId}:${turnId}:${itemId}:${rowKind}`,
      threadId,
      turnId,
      toolCallId: itemId || `tool_${crypto.randomUUID()}`,
      itemId,
      itemKind: cleanString(item.kind || item.type, ""),
      threadItemType: cleanString(item.type || item.kind, ""),
      toolName: cleanString(item.name || item.toolName || item.type, toolKind),
      toolKind,
      status: rowKind === "tool_call_started" ? "started" : statusFromItem(item, rowKind === "tool_call_failed" ? "failed" : "completed"),
      startedAt: cleanString(item.startedAt || item.started_at || params.startedAt || "", ""),
      completedAt: cleanString(item.completedAt || item.completed_at || params.completedAt || "", ""),
      durationMs: cleanOptionalNumber(item.durationMs ?? item.duration_ms),
      commandPreview: preview,
      commandPreviewHash: preview ? sha256(preview).slice(0, 24) : "",
      commandPreviewTruncated: preview.endsWith("..."),
      cwdEvidenceKey: evidenceKey("cwd", item.cwd || item.workingDirectory || item.working_directory || ""),
      exitCode: cleanOptionalNumber(item.exitCode ?? item.exit_code),
      targetAgentId: cleanString(item.receiverThreadId || item.receiver_thread_id || item.agentId || item.agent_id, ""),
      evidenceRefs: [evidenceRef("app_server_notification", `${method} ${cleanString(item.type || item.kind, "item")}`, { confidence: "proven" })],
    });
  }

  captureServerRequest(record = {}, type = "server_request_started") {
    const requestId = record.requestId ?? "";
    const connectionId = cleanString(record.connectionId || this.connection?.connectionId, "");
    const method = cleanString(record.method, "");
    const status = cleanString(record.status, "pending").replace(/-/g, "_");
    const rowKind =
      type === "rpc-request-updated" && status === "resolved"
        ? "server_request_resolved"
        : type === "rpc-request-updated" && (status === "connection_closed" || status === "connection-closed")
          ? "server_request_closed"
          : type === "rpc-request-updated"
            ? "server_request_responded"
            : "server_request_started";
    return this.append({
      rowKind,
      sourceKind: "codex_app_server_event",
      confidence: "runtime_exact",
      sourceEventKey: `${connectionId}:${method}:${requestId}:${rowKind}:${status}`,
      dedupeKey: `${connectionId}:${method}:${requestId}:${rowKind}:${status}`,
      connectionId,
      threadId: cleanString(record.threadId, ""),
      turnId: cleanString(record.turnId, ""),
      requestKey: `${connectionId}:${String(requestId)}`,
      requestId,
      method,
      serverRequestKind: serverRequestKind(method, record.riskCategory),
      riskCategory: cleanString(record.riskCategory, "unknown"),
      status,
      receivedAt: cleanString(record.receivedAt, ""),
      respondedAt: cleanString(record.respondedAt, ""),
      resolvedAt: cleanString(record.resolvedAt, ""),
      responseSummary: cleanString(record.responseSummary, ""),
      errorSummary: cleanString(record.errorSummary, ""),
      evidenceRefs: [evidenceRef("app_server_request", `Server request ${method}`, { confidence: "proven" })],
    });
  }

  captureClientResponse(method, result, requestId = "") {
    if (method === "account/rateLimits/read") return this.captureRateLimits(result || {}, method, requestId);
    return Promise.resolve({ ok: true, skipped: true });
  }

  captureClientError(method, error, requestId = "") {
    return this.append({
      rowKind: "app_server_error",
      sourceKind: "codex_app_server_event",
      confidence: "runtime_exact",
      dedupeKey: `${this.connection?.connectionId}:${method}:${requestId}:error:${error?.code || ""}:${error?.message || ""}`,
      errorCode: cleanOptionalNumber(error?.code),
      errorMessageClass: cleanString(error?.code === -32001 ? "server_overloaded" : error?.message ? "request_error" : "unknown", "unknown"),
      retryable: error?.code === -32001,
      method: cleanString(method, ""),
      requestKey: requestId ? `${cleanString(this.connection?.connectionId, "")}:${requestId}` : "",
      evidenceRefs: [evidenceRef("app_server_response", `App-server request failed for ${method}`, { status: "failed", confidence: "observed" })],
    });
  }

  async close(reason = "closed") {
    await this.captureConnectionClosed(reason);
    if (this.store) await this.store.close(reason === "completed" ? "completed" : "interrupted");
    this.publishStatus();
  }
}

module.exports = {
  UsageLedgerCollector,
  normalizeUsageLedgerConfig,
};
