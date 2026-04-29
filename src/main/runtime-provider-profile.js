"use strict";

const PROVIDER_KINDS = new Set(["codex_executable", "direct_oai"]);
const EXECUTABLE_FLAVORS = new Set(["vanilla", "lex_fork", "unknown_custom"]);

function cleanString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function evidenceRef(kind, label, options = {}) {
  return {
    id: cleanString(options.id, `${kind}_${Math.random().toString(16).slice(2, 10)}`),
    kind,
    label: cleanString(label, kind),
    observedAt: cleanString(options.observedAt, nowIso()),
    status: cleanString(options.status, "fresh"),
    confidence: cleanString(options.confidence, "observed"),
  };
}

function sourceEntry(source, label, options = {}) {
  const ref = evidenceRef(options.kind || source, label, options);
  return {
    source,
    status: ref.status,
    enablesMutation: Boolean(options.enablesMutation),
    evidenceRef: ref,
  };
}

function statusFromSession(session) {
  const status = cleanString(session?.status, "unknown");
  if (status === "ready") return "ready";
  if (status === "starting") return "loading";
  if (status === "failed" || status === "error") return "failed";
  if (status === "unavailable" || status === "disposed") return "unavailable";
  return "unknown";
}

function truthFromStatus(status) {
  if (status === "ready") return "runtime_declared";
  if (status === "loading") return "runtime_declared";
  if (status === "failed" || status === "unavailable") return "unknown";
  return "project_configured";
}

function normalizeRuntimeProviderConfig(codex = {}) {
  const provider = codex.provider && typeof codex.provider === "object" ? codex.provider : {};
  const rawKind = cleanString(provider.kind || codex.kind || codex.providerKind || codex.connectionPath, "codex_executable");
  const kind = PROVIDER_KINDS.has(rawKind) ? rawKind : "codex_executable";
  const rawFlavor = cleanString(
    provider.flavor?.configuredFlavor ||
      provider.flavor ||
      provider.configuredFlavor ||
      codex.flavor ||
      codex.providerFlavor ||
      "",
  );
  const configuredFlavor = EXECUTABLE_FLAVORS.has(rawFlavor)
    ? rawFlavor
    : kind === "codex_executable"
      ? "vanilla"
      : "";
  return {
    kind,
    configuredFlavor,
    label: provider.label || (kind === "direct_oai" ? "Direct OpenAI harness" : "Codex executable"),
    configuredAt: provider.configuredAt || "",
    selectedBy: cleanString(provider.selectedBy, "project_config"),
  };
}

function scopeSupport(enabled, evidenceRefs, unsupportedReason = "") {
  return {
    nextTurn: Boolean(enabled),
    sessionDefault: false,
    projectDefault: false,
    liveThread: false,
    evidenceRefs,
    unsupportedReason: enabled ? "" : unsupportedReason,
  };
}

function buildSettingsProjection(capabilities, evidenceRefs = []) {
  const caps = capabilities || {};
  const modelNextTurn = caps.model?.canSetNextTurn === true;
  const reasoningNextTurn = caps.reasoning?.canSetNextTurn === true;
  const approvalNextTurn = caps.authority?.canSetNextTurnApprovalPolicy === true;
  const sandboxNextTurn = caps.authority?.canSetNextTurnSandbox === true;
  const canReadRateLimits = caps.usage?.canReadRateLimits === true;
  return {
    model: {
      source: "runtime_probe",
      activeLabel: "",
      configuredDefault: "",
      canList: caps.model?.canList === true,
      availableModels: [],
      scopes: scopeSupport(modelNextTurn, evidenceRefs, "Provider does not expose next-turn model override."),
      evidenceRefs,
    },
    reasoning: {
      source: "runtime_probe",
      activeLabel: "",
      configuredDefault: "",
      availableEfforts: [],
      scopes: scopeSupport(reasoningNextTurn, evidenceRefs, "Provider does not expose next-turn reasoning override."),
      evidenceRefs,
    },
    access: {
      source: "runtime_probe",
      approvalPolicies: Array.isArray(caps.authority?.approvalPolicies) ? caps.authority.approvalPolicies : [],
      sandboxModes: Array.isArray(caps.authority?.sandboxModes) ? caps.authority.sandboxModes : [],
      scopes: {
        approvalPolicy: scopeSupport(approvalNextTurn, evidenceRefs, "Provider does not expose next-turn approval policy override."),
        sandbox: scopeSupport(sandboxNextTurn, evidenceRefs, "Provider does not expose next-turn sandbox override."),
      },
      evidenceRefs,
    },
    usage: {
      providerQuota: {
        canRead: canReadRateLimits,
        readSource: canReadRateLimits ? "account/rateLimits/read" : "",
        eventSource: canReadRateLimits ? "account/rateLimits/updated" : "",
        readOwnedBy: "main_process",
        evidenceRefs,
      },
      // Backward-compatible projection used by the current renderer while the
      // richer descriptor shape lands across all call sites.
      canReadRateLimits,
      rateLimitMethod: canReadRateLimits ? "account/rateLimits/read" : "",
      contextPressure: {
        canRead: false,
        source: "",
        evidenceRefs: [],
      },
      evidenceRefs,
    },
  };
}

function executableFlavorEvidence(config, status, evidenceRefs) {
  const configuredFlavor = config.configuredFlavor || "vanilla";
  const protocolCompatible = status === "ready";
  return {
    configuredFlavor,
    provenFlavor: protocolCompatible && configuredFlavor === "vanilla" ? "vanilla" : "unproven",
    compatibility: protocolCompatible ? "vanilla_compatible" : "unknown",
    evidenceRefs,
  };
}

function buildRuntimeProviderProfile(session, capabilities) {
  const config = normalizeRuntimeProviderConfig(session?.provider || {});
  const status = config.kind === "direct_oai" ? "unavailable" : statusFromSession(session);
  const profileEvidence = [
    evidenceRef("project_config", `${config.label} selected by ${config.selectedBy}`, { confidence: "configured" }),
  ];
  const capabilitySources = [
    sourceEntry("project_config", "Project selected runtime provider.", { confidence: "configured", enablesMutation: false }),
  ];

  if (config.kind === "direct_oai") {
    const directEvidence = evidenceRef("project_config", "Direct OpenAI harness provider is reserved for the parallel implementation path.", {
      status: "unavailable",
      confidence: "configured",
    });
    return {
      schemaVersion: 1,
      profileId: "direct_oai:unavailable",
      projectId: cleanString(session?.projectId, ""),
      kind: "direct_oai",
      label: "Direct OpenAI harness",
      status,
      truth: "project_configured",
      selectedBy: config.selectedBy,
      selectedAt: config.configuredAt,
      capabilitySources,
      evidenceRefs: [...profileEvidence, directEvidence],
      defaultForMainBranch: false,
      direct: {
        backendStatus: "not_implemented",
        profileSource: "project_config",
        endpointLabel: "",
        evidenceRefs: [directEvidence],
      },
      settingsProjection: {
        model: { source: "served_by_provider", activeLabel: "", configuredDefault: "", canList: false, availableModels: [], scopes: scopeSupport(false, [directEvidence], "Direct provider backend is not implemented."), evidenceRefs: [directEvidence] },
        reasoning: { source: "served_by_provider", activeLabel: "", configuredDefault: "", availableEfforts: [], scopes: scopeSupport(false, [directEvidence], "Direct provider backend is not implemented."), evidenceRefs: [directEvidence] },
        access: {
          source: "served_by_provider",
          approvalPolicies: [],
          sandboxModes: [],
          scopes: {
            approvalPolicy: scopeSupport(false, [directEvidence], "Direct provider backend is not implemented."),
            sandbox: scopeSupport(false, [directEvidence], "Direct provider backend is not implemented."),
          },
          evidenceRefs: [directEvidence],
        },
        usage: {
          providerQuota: { canRead: false, readSource: "", eventSource: "", readOwnedBy: "provider_backend", evidenceRefs: [directEvidence] },
          canReadRateLimits: false,
          rateLimitMethod: "",
          contextPressure: { canRead: false, source: "", evidenceRefs: [directEvidence] },
          evidenceRefs: [directEvidence],
        },
      },
      updatedAt: nowIso(),
    };
  }

  const appServerEvidence = evidenceRef("app_server_probe", status === "ready" ? "Codex app-server is ready." : "Codex app-server is not ready.", {
    confidence: status === "ready" ? "declared" : "unknown",
    status: status === "ready" ? "fresh" : "unavailable",
  });
  capabilitySources.push(sourceEntry("app_server_probe", appServerEvidence.label, {
    confidence: appServerEvidence.confidence,
    status: appServerEvidence.status,
    enablesMutation: status === "ready",
  }));
  const flavor = executableFlavorEvidence(config, status, [...profileEvidence, appServerEvidence]);
  const flavorLabel = flavor.configuredFlavor === "lex_fork"
    ? "Lex fork"
    : flavor.configuredFlavor === "unknown_custom"
      ? "custom / unknown"
      : "vanilla";
  return {
    schemaVersion: 1,
    profileId: `codex_executable:${cleanString(session?.runtime, "unknown")}:${cleanString(session?.binaryPath, "codex")}`,
    projectId: cleanString(session?.projectId, ""),
    kind: "codex_executable",
    flavor: flavor.configuredFlavor,
    label: `Codex executable · ${flavorLabel}`,
    status,
    truth: truthFromStatus(status),
    selectedBy: config.selectedBy,
    selectedAt: config.configuredAt,
    capabilitySources,
    evidenceRefs: [...profileEvidence, appServerEvidence],
    defaultForMainBranch: true,
    executable: {
      requestedRuntime: cleanString(session?.requestedRuntime, "auto"),
      resolvedRuntime: cleanString(session?.runtime, "unknown"),
      command: cleanString(session?.binaryPath, "codex"),
      resolvedCommand: cleanString(session?.command, ""),
      codexHome: cleanString(session?.codexHome, ""),
      workspaceRoot: cleanString(session?.workspaceRoot, ""),
      appServer: {
        status,
        readyUrl: cleanString(session?.readyUrl, ""),
        transport: "websocket",
        schemaSource: "app_server_probe",
        evidenceRefs: [appServerEvidence],
      },
      flavor,
    },
    settingsProjection: buildSettingsProjection(capabilities, [appServerEvidence]),
    updatedAt: nowIso(),
  };
}

module.exports = {
  buildRuntimeProviderProfile,
  normalizeRuntimeProviderConfig,
};
