(function installDirectWorkbenchThreadDirectoryModel(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.DirectWorkbenchThreadDirectoryModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const DIRECTORY_SCHEMA = "direct_workbench_thread_directory@1";
  const ROW_SCHEMA = "direct_workbench_thread_directory_row@1";
  const FORBIDDEN_KEYS = new Set([
    "cwd",
    "path",
    "repoPath",
    "linuxPath",
    "windowsPath",
    "localPath",
    "sourceHome",
    "sessionFilePath",
    "nextCursor",
    "backwardsCursor",
  ]);

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function text(value, fallback = "") {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
  }

  function boundedText(value, fallback = "", maxChars = 180) {
    const normalized = text(value, fallback);
    if (normalized.length <= maxChars) return normalized;
    return `${normalized.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
  }

  function uniqueStrings(values = []) {
    return [...new Set(values.map((value) => text(value, "")).filter(Boolean))];
  }

  function timestamp(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      const millis = value > 10_000_000_000 ? value : value * 1000;
      return new Date(millis).toISOString();
    }
    const normalized = text(value, "");
    if (!normalized) return "";
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
  }

  function sourceKind(value, runtimePath) {
    if (text(runtimePath, "").startsWith("direct")) return "direct";
    if (typeof value === "string") return value.trim().toLowerCase() || "unknown";
    if (!isPlainObject(value)) return "unknown";
    const explicit = text(value.type || value.kind, "");
    if (explicit) return explicit.toLowerCase();
    return text(Object.keys(value)[0], "unknown").toLowerCase();
  }

  function sourceLabel(kind) {
    const normalized = text(kind, "unknown").replaceAll("_", "-").toLowerCase();
    const labels = {
      direct: "Direct runtime",
      cli: "Codex CLI",
      vscode: "VS Code",
      "vs-code": "VS Code",
      exec: "Codex Exec",
      appserver: "App Server",
      "app-server": "App Server",
      subagent: "Sub-agent",
      "sub-agent": "Sub-agent",
      unknown: "Source unknown",
    };
    return labels[normalized] || boundedText(normalized.replaceAll("-", " "), "Source unknown", 80);
  }

  function runtimeLabel(runtimePath) {
    const labels = {
      "app-server": "App Server",
      "direct-text": "Direct text",
      "direct-implementation": "Direct implementation",
      "direct-fixture": "Direct fixture",
    };
    return labels[text(runtimePath, "")] || "Runtime unknown";
  }

  function statusType(value) {
    if (typeof value === "string") {
      return value.trim().replace(/([a-z0-9])([A-Z])/g, "$1-$2").replaceAll("_", "-").toLowerCase();
    }
    if (!isPlainObject(value)) return "unknown";
    return text(value.type || value.state || value.status, "unknown")
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .replaceAll("_", "-")
      .toLowerCase();
  }

  function activeTurnCount(entry, lifecycleState) {
    const explicit = Number(entry?.activeTurnCount || 0);
    if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
    return lifecycleState === "active" || lifecycleState === "running" ? 1 : 0;
  }

  function focusContract(entry, runtimePath, capabilities = {}) {
    const blockers = [];
    const directAction = entry?.actions?.focus;
    if (!text(entry?.threadId || entry?.id || entry?.sessionId, "")) blockers.push("thread_identity_missing");
    if (entry?.ephemeral === true) blockers.push("ephemeral_thread_unavailable");
    if (directAction && directAction.enabled === false) {
      blockers.push(text(directAction.disabledReason, "thread_focus_unavailable"));
    }
    if (!directAction && runtimePath === "app-server" && capabilities.canResume !== true && capabilities.canRead !== true) {
      blockers.push("provider_thread_focus_unavailable");
    }
    return {
      focusEligible: blockers.length === 0,
      blockerCodes: uniqueStrings(blockers),
    };
  }

  function normalizeRow(entry = {}, options = {}) {
    const runtimePath = text(options.runtimePath, "runtime-unknown");
    const threadId = text(entry.threadId || entry.id || entry.sessionId, "");
    const lifecycleState = statusType(entry.displayState || entry.status || entry.lifecycleState);
    const source = sourceKind(entry.source || entry.sourceKind, runtimePath);
    const focus = focusContract(entry, runtimePath, options.capabilities || {});
    const continuationMode = runtimePath === "app-server" ? "provider_resume" : "direct_project_read";
    return {
      schema: ROW_SCHEMA,
      threadId,
      projectId: text(entry.projectId, text(options.projectId, "")),
      displayTitle: boundedText(entry.name || entry.title || entry.preview || threadId, "Untitled thread"),
      runtimePath,
      runtimeLabel: runtimeLabel(runtimePath),
      sourceKind: source,
      sourceLabel: sourceLabel(source),
      lifecycleState,
      lifecycleLabel: lifecycleState.replaceAll("-", " "),
      activeTurnCount: activeTurnCount(entry, lifecycleState),
      modelLabel: boundedText(entry.model || entry.modelProvider, "model unknown", 80),
      turnCount: Math.max(0, Number(entry.turnCount || entry.turns?.length || 0)),
      workThreadId: text(entry.workThreadId, ""),
      createdAt: timestamp(entry.createdAt),
      updatedAt: timestamp(entry.updatedAt || entry.createdAt),
      continuationMode,
      continuationLabel: continuationMode === "provider_resume" ? "Provider resume" : "Project-scoped Direct read",
      focusEligible: focus.focusEligible,
      blockerCodes: focus.blockerCodes,
      rawPathExposed: false,
      rawCursorExposed: false,
    };
  }

  function normalizeThreadDirectory(response = {}, options = {}) {
    const runtimePath = text(options.runtimePath, "runtime-unknown");
    const deckRows = Array.isArray(response?.deck?.rows) ? response.deck.rows : null;
    const sourceRows = deckRows || (Array.isArray(response?.threads)
      ? response.threads
      : Array.isArray(response?.data) ? response.data : []);
    const rows = sourceRows
      .filter(Boolean)
      .map((entry) => normalizeRow(entry, { ...options, runtimePath }))
      .filter((row) => row.threadId)
      .sort((left, right) => Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || ""));
    const partial = Boolean(response?.nextCursor);
    const projection = {
      schema: DIRECTORY_SCHEMA,
      projectId: text(options.projectId, text(response.projectId, "")),
      runtimePath,
      runtimeLabel: runtimeLabel(runtimePath),
      observedAt: text(options.observedAt, new Date().toISOString()),
      status: partial ? "partial" : "ready",
      partial,
      counts: {
        rows: rows.length,
        running: rows.filter((row) => row.activeTurnCount > 0).length,
        recoverable: rows.filter((row) => row.lifecycleState.includes("recoverable")).length,
      },
      rows,
      rawPathExposed: false,
      rawCursorExposed: false,
      worldManagerAuthorityGranted: false,
    };
    assertRendererSafe(projection);
    return projection;
  }

  function providerRequestThreadId(request = {}) {
    const params = isPlainObject(request.params) ? request.params : {};
    return text(
      request.threadId ||
      request.sessionId ||
      request.conversationId ||
      params.threadId ||
      params.sessionId ||
      params.conversationId,
      "",
    );
  }

  function pendingProviderRequestCount(requests = [], activeThreadId = "") {
    const threadId = text(activeThreadId, "");
    if (!threadId) return 0;
    return (Array.isArray(requests) ? requests : []).filter((request) => {
      const status = text(request?.status, "pending").toLowerCase();
      if (status !== "pending" && status !== "responding") return false;
      return providerRequestThreadId(request) === threadId;
    }).length;
  }

  function resolveThreadFocusPosture(row = {}, options = {}) {
    const activeThreadId = text(options.activeThreadId, "");
    const targetThreadId = text(row.threadId, "");
    const selected = Boolean(
      targetThreadId &&
      targetThreadId === activeThreadId &&
      options.activeThreadAttached !== false,
    );
    const blockers = [...(Array.isArray(row.blockerCodes) ? row.blockerCodes : [])];
    if (selected) blockers.push("thread_already_active");
    if (!selected && options.currentTurnActive === true) blockers.push("active_turn_in_current_thread");
    if (!selected && Number(options.pendingProviderRequestCount || 0) > 0) {
      blockers.push("pending_provider_request_in_current_thread");
    }
    if (!selected && text(options.transitionState, "idle") === "opening") {
      blockers.push("thread_focus_transition_in_progress");
    }
    if (!selected && text(options.directoryStatus, "ready") === "loading") {
      blockers.push("thread_directory_loading");
    }
    if (!selected && text(options.directoryStatus, "ready") === "error") {
      blockers.push("thread_directory_refresh_failed");
    }
    const blockerCodes = uniqueStrings(blockers);
    return {
      selected,
      enabled: !selected && row.focusEligible === true && blockerCodes.length === 0,
      state: selected
        ? "active"
        : options.transitionState === "opening" && options.transitionTargetThreadId === targetThreadId
          ? "opening"
          : blockerCodes.length ? "blocked" : row.activeTurnCount > 0 ? "running" : "available",
      blockerCodes,
    };
  }

  function assertRendererSafe(value, path = "directory") {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => assertRendererSafe(entry, `${path}[${index}]`));
      return true;
    }
    if (!isPlainObject(value)) return true;
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) throw new Error(`thread_directory_raw_exposure:${path}.${key}`);
      assertRendererSafe(entry, `${path}.${key}`);
    }
    if (path === "directory" && (value.rawPathExposed !== false || value.rawCursorExposed !== false)) {
      throw new Error("thread_directory_raw_exposure:flags");
    }
    return true;
  }

  return Object.freeze({
    DIRECTORY_SCHEMA,
    ROW_SCHEMA,
    assertRendererSafe,
    normalizeThreadDirectory,
    pendingProviderRequestCount,
    resolveThreadFocusPosture,
  });
});
