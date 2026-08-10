(function exposeCodexAppServerEvidence(root) {
  "use strict";

  const ENVIRONMENT_STATUSES = new Set(["ready", "pending", "disconnected", "unknown"]);

  function finiteTimestampMs(value, fallback = null) {
    if (value === null || value === undefined || value === "") return fallback;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > 8.64e15) return fallback;
    return number;
  }

  function isoFromTimestampMs(value) {
    const timestamp = finiteTimestampMs(value);
    return timestamp === null ? "" : new Date(timestamp).toISOString();
  }

  function normalizeNotificationEnvelope(message = {}, receivedAtMs = Date.now()) {
    const received = finiteTimestampMs(receivedAtMs, Date.now());
    const emitted = finiteTimestampMs(message.emittedAtMs);
    return {
      method: typeof message.method === "string" ? message.method : "",
      params: message.params && typeof message.params === "object" ? message.params : {},
      emittedAtMs: emitted,
      emittedAt: isoFromTimestampMs(emitted),
      receivedAtMs: received,
      receivedAt: isoFromTimestampMs(received),
      observedAt: isoFromTimestampMs(emitted) || isoFromTimestampMs(received),
    };
  }

  function normalizeThreadDirectInput(thread = {}) {
    const isObject = Boolean(thread) && typeof thread === "object" && !Array.isArray(thread);
    const capabilityReported = isObject && Object.prototype.hasOwnProperty.call(thread, "canAcceptDirectInput");
    if (!capabilityReported) {
      return {
        status: "legacy_unreported",
        canAcceptDirectInput: null,
        capabilityReported: false,
        allowsMutation: true,
        evidenceSource: "legacy_compatibility_fallback",
      };
    }
    if (thread.canAcceptDirectInput === true) {
      return {
        status: "accepted",
        canAcceptDirectInput: true,
        capabilityReported: true,
        allowsMutation: true,
        evidenceSource: "thread.canAcceptDirectInput",
      };
    }
    if (thread.canAcceptDirectInput === false) {
      return {
        status: "rejected",
        canAcceptDirectInput: false,
        capabilityReported: true,
        allowsMutation: false,
        evidenceSource: "thread.canAcceptDirectInput",
      };
    }
    return {
      status: "unknown",
      canAcceptDirectInput: null,
      capabilityReported: true,
      allowsMutation: false,
      evidenceSource: "thread.canAcceptDirectInput",
    };
  }

  function directInputBlockMessage(evidence = {}) {
    if (evidence.status === "rejected") return "This Codex thread is read-only and does not accept direct input.";
    if (evidence.status === "unknown") return "Codex did not confirm that this thread accepts direct input.";
    return "Codex direct-input eligibility is unavailable.";
  }

  function normalizeEnvironmentState(input = {}) {
    const status = ENVIRONMENT_STATUSES.has(input.status) ? input.status : "unknown";
    const emittedAtMs = finiteTimestampMs(input.emittedAtMs);
    const receivedAtMs = finiteTimestampMs(input.receivedAtMs);
    return {
      threadId: typeof input.threadId === "string" ? input.threadId : "",
      environmentId: typeof input.environmentId === "string" ? input.environmentId : "",
      status,
      error: typeof input.error === "string" ? input.error : "",
      evidenceSource: typeof input.evidenceSource === "string" ? input.evidenceSource : "unknown",
      emittedAtMs,
      emittedAt: isoFromTimestampMs(emittedAtMs),
      receivedAtMs,
      receivedAt: isoFromTimestampMs(receivedAtMs),
      observedAt: isoFromTimestampMs(emittedAtMs) || isoFromTimestampMs(receivedAtMs),
    };
  }

  function environmentStateFromNotification(method, params = {}, timing = {}) {
    if (method !== "thread/environment/connected" && method !== "thread/environment/disconnected") return null;
    return normalizeEnvironmentState({
      threadId: String(params.threadId || ""),
      environmentId: String(params.environmentId || ""),
      status: method === "thread/environment/connected" ? "ready" : "disconnected",
      evidenceSource: method,
      emittedAtMs: timing.emittedAtMs,
      receivedAtMs: timing.receivedAtMs,
    });
  }

  function environmentStateFromStatus(environmentId, response = {}, timing = {}) {
    return normalizeEnvironmentState({
      threadId: String(timing.threadId || ""),
      environmentId: String(environmentId || ""),
      status: String(response.status || "unknown"),
      error: String(response.error || ""),
      evidenceSource: "environment/status",
      emittedAtMs: timing.emittedAtMs,
      receivedAtMs: timing.receivedAtMs,
    });
  }

  function boundedText(value, maxLength = 320) {
    const text = typeof value === "string" ? value.trim() : "";
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
  }

  function normalizeAppToolSummary(value = {}) {
    return {
      name: boundedText(value.name, 160),
      title: boundedText(value.title, 160),
      description: boundedText(value.description, 320),
      displayOnly: true,
      actionAuthorityGranted: false,
    };
  }

  function normalizeAppEvidence(installedResponse = {}, metadataResponse = {}, timing = {}) {
    const installedApps = (Array.isArray(installedResponse.apps) ? installedResponse.apps : []).slice(0, 100);
    const metadataApps = (Array.isArray(metadataResponse.apps) ? metadataResponse.apps : []).slice(0, 100);
    const metadataById = new Map(metadataApps.map((app) => [String(app?.id || ""), app]));
    const seen = new Set();
    const installedIds = new Set();
    const apps = [];
    for (const installed of installedApps) {
      const id = String(installed?.id || "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      installedIds.add(id);
      const metadata = metadataById.get(id) || {};
      const toolSummaries = (Array.isArray(metadata.toolSummaries) ? metadata.toolSummaries : [])
        .slice(0, 100)
        .map(normalizeAppToolSummary)
        .filter((tool) => tool.name);
      apps.push({
        id,
        runtimeName: boundedText(installed.runtimeName, 160),
        name: boundedText(metadata.name || installed.runtimeName || id, 160),
        description: boundedText(metadata.description, 320),
        distributionChannel: boundedText(metadata.distributionChannel, 120),
        pluginDisplayNames: [...new Set((Array.isArray(metadata.pluginDisplayNames) ? metadata.pluginDisplayNames : [])
          .slice(0, 20)
          .map((value) => boundedText(value, 160))
          .filter(Boolean))],
        installedEvidence: true,
        enabled: installed.enabled === true,
        callable: installed.callable === true,
        metadataAvailable: Boolean(metadataById.has(id)),
        toolSummaries,
        toolSummaryCount: toolSummaries.length,
        toolSummariesDisplayOnly: true,
        actionAuthorityGranted: false,
        providerToolDeclarationGranted: false,
      });
    }
    for (const metadata of metadataApps) {
      const id = String(metadata?.id || "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const toolSummaries = (Array.isArray(metadata.toolSummaries) ? metadata.toolSummaries : [])
        .slice(0, 100)
        .map(normalizeAppToolSummary)
        .filter((tool) => tool.name);
      apps.push({
        id,
        runtimeName: "",
        name: boundedText(metadata.name || id, 160),
        description: boundedText(metadata.description, 320),
        distributionChannel: boundedText(metadata.distributionChannel, 120),
        pluginDisplayNames: [...new Set((Array.isArray(metadata.pluginDisplayNames) ? metadata.pluginDisplayNames : [])
          .slice(0, 20)
          .map((value) => boundedText(value, 160))
          .filter(Boolean))],
        installedEvidence: false,
        enabled: false,
        callable: false,
        metadataAvailable: true,
        toolSummaries,
        toolSummaryCount: toolSummaries.length,
        toolSummariesDisplayOnly: true,
        actionAuthorityGranted: false,
        providerToolDeclarationGranted: false,
      });
    }
    const observedAtMs = finiteTimestampMs(timing.observedAtMs, Date.now());
    return {
      schema: "codex_app_evidence_snapshot@1",
      threadId: typeof timing.threadId === "string" ? timing.threadId : "",
      status: "ready",
      apps,
      installedCount: installedIds.size,
      enabledCount: apps.filter((app) => app.enabled).length,
      callableCount: apps.filter((app) => app.callable).length,
      metadataCount: apps.filter((app) => app.metadataAvailable).length,
      toolSummaryCount: apps.reduce((total, app) => total + app.toolSummaryCount, 0),
      missingAppIds: [...new Set((Array.isArray(metadataResponse.missingAppIds) ? metadataResponse.missingAppIds : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean))],
      metadataError: boundedText(timing.metadataError, 320),
      evidenceSource: "app/installed+app/read",
      observedAtMs,
      observedAt: isoFromTimestampMs(observedAtMs),
      actionAuthorityGranted: false,
      providerToolDeclarationGranted: false,
    };
  }

  const api = {
    directInputBlockMessage,
    environmentStateFromNotification,
    environmentStateFromStatus,
    normalizeAppEvidence,
    normalizeEnvironmentState,
    normalizeNotificationEnvelope,
    normalizeThreadDirectInput,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else if (root) root.CodexAppServerEvidence = api;
})(typeof window !== "undefined" ? window : globalThis);
