"use strict";

const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const net = require("node:net");
const {
  SUPPORTED_SERVER_REQUEST_METHODS,
  AUTO_UNSUPPORTED_SERVER_REQUEST_METHODS,
} = require("./codex-app-server-protocol");
const {
  buildRuntimeProviderProfile,
  normalizeRuntimeProviderConfig,
} = require("./runtime-provider-profile");
const {
  buildManagedAppServerProjectProfileConfiguration,
  buildProjectProfileRuntimeLaunchObservation,
  prepareProjectProfileLaunchRequest,
  registerProjectProfileLaunchResponse,
} = require("./direct/worldmodel/project-profile-app-server-adapter");

const DEFAULT_READY_TIMEOUT_MS = 35_000;
const DEFAULT_STARTUP_ATTEMPTS = 2;
const READY_POLL_MS = 200;
const READY_HTTP_TIMEOUT_MS = 1_000;
const READY_TCP_TIMEOUT_MS = 650;
const READY_TCP_STABLE_POLLS = 3;
const MANAGED_APP_SERVER_ORCHESTRATION_PROFILE_SCHEMA = "codex_app_server_orchestration_profile@1";
const MANAGED_APP_SERVER_BASE_PROFILE_VERSION = "reserved-v2-schema@2";
const MANAGED_APP_SERVER_MODEL_OVERRIDE_PROFILE_VERSION = "reserved-v2-model-overrides@2";
const MANAGED_APP_SERVER_MODEL_OVERRIDE_CONFIG = "features.multi_agent_v2.expose_spawn_agent_model_overrides=true";
const MANAGED_APP_SERVER_MODEL_OVERRIDE_DISABLED_CONFIG = "features.multi_agent_v2.expose_spawn_agent_model_overrides=false";
const MANAGED_APP_SERVER_CONFIG_OVERRIDES = Object.freeze([
  "features.multi_agent_v2.hide_spawn_agent_metadata=true",
  MANAGED_APP_SERVER_MODEL_OVERRIDE_DISABLED_CONFIG,
]);

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

const READY_TIMEOUT_MS = normalizeInteger(
  process.env.CODEX_APP_SERVER_READY_TIMEOUT_MS,
  DEFAULT_READY_TIMEOUT_MS,
  5_000,
  180_000,
);
const STARTUP_ATTEMPTS = normalizeInteger(
  process.env.CODEX_APP_SERVER_STARTUP_ATTEMPTS,
  DEFAULT_STARTUP_ATTEMPTS,
  1,
  4,
);

function shellQuote(value) {
  const text = String(value ?? "");
  if (!text) return "''";
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, `'\"'\"'`)}'`;
}

function mkdirCommand(pathValue) {
  const text = normalizeString(pathValue, "");
  return text ? `mkdir -p ${shellQuote(text)}; ` : "";
}

function spawnAgentModelOverridesEnabled(codex = {}) {
  return codex?.spawnAgentModelOverrides === true;
}

function managedAppServerConfigOverrides(codex = {}) {
  return spawnAgentModelOverridesEnabled(codex)
    ? [MANAGED_APP_SERVER_CONFIG_OVERRIDES[0], MANAGED_APP_SERVER_MODEL_OVERRIDE_CONFIG]
    : [...MANAGED_APP_SERVER_CONFIG_OVERRIDES];
}

function managedAppServerConfigArgs(codex = {}) {
  return managedAppServerConfigOverrides(codex).flatMap((override) => ["-c", override]);
}

function buildManagedAppServerArgs(wsUrl, codex = {}) {
  return ["app-server", ...managedAppServerConfigArgs(codex), "--listen", wsUrl];
}

function buildManagedAppServerShellInvocation(binaryPath, wsUrl, codex = {}) {
  return [
    "exec",
    shellQuote(binaryPath),
    ...buildManagedAppServerArgs(wsUrl, codex).map(shellQuote),
  ].join(" ");
}

function buildManagedAppServerOrchestrationProfile(codex = {}, projectProfileConfiguration = null) {
  const modelOverridesEnabled = spawnAgentModelOverridesEnabled(codex);
  return {
    schema: MANAGED_APP_SERVER_ORCHESTRATION_PROFILE_SCHEMA,
    profileVersion: modelOverridesEnabled
      ? MANAGED_APP_SERVER_MODEL_OVERRIDE_PROFILE_VERSION
      : MANAGED_APP_SERVER_BASE_PROFILE_VERSION,
    runtimeSurface: "managed_app_server",
    binarySelection: modelOverridesEnabled ? "configured_binary_required" : "default_or_home_bundled",
    multiAgentVersionSelection: "model_selected_at_turn",
    spawnAgentControls: {
      reservedProviderSchema: true,
      providerContract: modelOverridesEnabled ? "v2_split_model_overrides" : "v2_hidden_metadata",
      requestedByProject: modelOverridesEnabled,
      effectiveStatus: modelOverridesEnabled ? "configured_unverified" : "disabled",
      providerAcceptanceStatus: modelOverridesEnabled ? "unverified" : "not_requested",
      minimumCodexVersion: modelOverridesEnabled ? "0.145.0-alpha.7" : "",
      visibleInputFields: [
        "task_name",
        "message",
        "fork_turns",
        ...(modelOverridesEnabled ? ["model", "reasoning_effort"] : []),
      ],
      hiddenInputFields: modelOverridesEnabled
        ? ["agent_type", "service_tier"]
        : ["agent_type", "model", "reasoning_effort", "service_tier"],
      visibleResultFields: ["task_name"],
      hiddenResultFields: ["nickname"],
      modelOverrideConfigured: modelOverridesEnabled,
      reasoningEffortOverrideConfigured: modelOverridesEnabled,
      agentTypeOverrideConfigured: false,
      serviceTierOverrideConfigured: false,
      runtimeSelection: modelOverridesEnabled ? "root_selectable_within_active_backend" : "provider_managed",
      fullHistoryForkInheritsParentProfile: true,
      fullHistoryOverrideAllowed: false,
      overrideForkTurns: modelOverridesEnabled ? ["none", "positive_integer"] : [],
      compatibleModelSet: modelOverridesEnabled ? "active_multi_agent_backend" : "provider_managed",
      clientSchemaExtensionAllowed: false,
      runtimeEvidenceRequired: modelOverridesEnabled,
    },
    rootOrchestration: {
      activationControl: "reasoning_effort",
      proactiveValue: "ultra",
      explicitDelegationBelowUltra: true,
    },
    workerInteraction: {
      operatorCanObserve: true,
      operatorCanChatDirectly: false,
      parentAgentMediated: true,
    },
    configOverrides: managedAppServerConfigOverrides(codex),
    projectProfile: projectProfileConfiguration ? {
      resolutionRef: projectProfileConfiguration.resolutionRef,
      selectionTraceRef: projectProfileConfiguration.selectionTraceRef,
      resolutionInputRefsDigest: projectProfileConfiguration.resolutionInputRefsDigest,
      requestedProfile: projectProfileConfiguration.requestedProfile,
      configuredProfile: projectProfileConfiguration.configuredProfile,
      specialistPosture: projectProfileConfiguration.specialistPosture,
      requestedStatus: projectProfileConfiguration.requestedStatus,
      configuredStatus: projectProfileConfiguration.configuredStatus,
      providerAcceptedStatus: projectProfileConfiguration.providerAcceptedStatus,
      runtimeVerifiedStatus: projectProfileConfiguration.runtimeVerifiedStatus,
      authorityGranted: false,
    } : null,
    source: "managed_app_server_launch_config",
  };
}

function normalizeBinaryCommand(binaryPath, runtime) {
  const text = normalizeString(binaryPath, "codex");
  if (process.platform === "win32" && runtime === "host" && !/[.][A-Za-z0-9]+$/.test(text)) {
    return `${text}.cmd`;
  }
  return text;
}

function defaultCodexHomeForRuntime(runtime) {
  if (runtime === "wsl") {
    return normalizeString(
      process.env.CODEX_REVIEW_SHELL_DEFAULT_WSL_CODEX_HOME,
      normalizeString(process.env.CODEX_REVIEW_SHELL_DEFAULT_CODEX_HOME, ""),
    );
  }
  return normalizeString(
    process.env.CODEX_REVIEW_SHELL_DEFAULT_HOST_CODEX_HOME,
    normalizeString(process.env.CODEX_REVIEW_SHELL_DEFAULT_CODEX_HOME, ""),
  );
}

function hostReadablePathForWslMountPath(linuxPath) {
  const text = normalizeString(linuxPath, "");
  if (process.platform !== "win32") return text;
  const match = text.match(/^\/mnt\/([a-z])\/(.+)$/i);
  if (!match) return text;
  return `${match[1].toUpperCase()}:\\${match[2].replace(/\//g, "\\")}`;
}

function bundledWslCodexForHome(codexHome) {
  const home = normalizeString(codexHome, "");
  if (!/^\/mnt\/[a-z]\/.+\/\.codex$/i.test(home)) return "";
  const wslBinRoot = `${home}/bin/wsl`;
  const hostBinRoot = hostReadablePathForWslMountPath(wslBinRoot);
  try {
    const candidates = fs.readdirSync(hostBinRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const fullPath = `${wslBinRoot}/${entry.name}/codex`;
        const hostPath = hostReadablePathForWslMountPath(fullPath);
        try {
          const stat = fs.statSync(hostPath);
          return stat.isFile() ? { fullPath, mtimeMs: stat.mtimeMs } : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((left, right) => right.mtimeMs - left.mtimeMs);
    if (candidates[0]?.fullPath) return candidates[0].fullPath;
    const legacyPath = `${wslBinRoot}/codex`;
    return fs.statSync(hostReadablePathForWslMountPath(legacyPath)).isFile() ? legacyPath : "";
  } catch {
    return "";
  }
}

function resolveManagedAppServerBinaryPath(runtime, configuredBinaryPath, codexHome, codex = {}, options = {}) {
  const configured = normalizeString(configuredBinaryPath, "codex");
  const preserveConfiguredBinary = runtime === "wsl" && spawnAgentModelOverridesEnabled(codex);
  if (runtime !== "wsl" || configured !== "codex" || preserveConfiguredBinary) return configured;
  const resolveBundled = typeof options.resolveBundled === "function" ? options.resolveBundled : bundledWslCodexForHome;
  return resolveBundled(codexHome) || configured;
}

async function allocatePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

function portFromReadyUrl(readyUrl) {
  try {
    const parsed = new URL(String(readyUrl || ""));
    const parsedPort = Number.parseInt(parsed.port, 10);
    return Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 0;
  } catch {
    return 0;
  }
}

async function probeReadyHttpStatus(readyUrl, timeoutMs = READY_HTTP_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(100, timeoutMs));
  try {
    const response = await fetch(readyUrl, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    return Number(response.status) || 0;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

async function probeTcpPort(port, timeoutMs = READY_TCP_TIMEOUT_MS) {
  if (!Number.isFinite(port) || port <= 0) return false;
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {}
      resolve(Boolean(value));
    };
    socket.setTimeout(Math.max(100, timeoutMs));
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect({ host: "127.0.0.1", port });
  });
}

async function waitForReady(readyUrl, child, timeoutMs = READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  const port = portFromReadyUrl(readyUrl);
  let tcpReadyStreak = 0;
  let lastReadyStatus = 0;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Codex app-server exited before becoming ready (code ${child.exitCode}).`);
    }
    const readyStatus = await probeReadyHttpStatus(readyUrl, READY_HTTP_TIMEOUT_MS);
    if (readyStatus > 0) lastReadyStatus = readyStatus;
    if (readyStatus >= 200 && readyStatus < 300) {
      return { readyBy: "readyz", status: readyStatus };
    }
    if (port > 0) {
      const tcpReachable = await probeTcpPort(port, READY_TCP_TIMEOUT_MS);
      tcpReadyStreak = tcpReachable ? tcpReadyStreak + 1 : 0;
      if (tcpReadyStreak >= READY_TCP_STABLE_POLLS) {
        return { readyBy: "tcp", status: lastReadyStatus };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  const statusNote = lastReadyStatus ? ` (last /readyz status ${lastReadyStatus})` : "";
  throw new Error(`Timed out waiting for Codex app-server readiness at ${readyUrl}.${statusNote}`);
}

function resolveRuntime(project, codex) {
  const requested = normalizeString(codex.runtime, "auto");
  if (requested === "host" || requested === "wsl") return requested;
  if (process.platform === "win32" && project?.workspace?.kind === "wsl") return "wsl";
  return "host";
}

function buildRuntimeCapabilityProfile(session) {
  const status = normalizeString(session?.status, "unknown");
  const ready = status === "ready";
  const profile = {
    version: 1,
    status,
    generatedAt: new Date().toISOString(),
    coreRuntime: {
      canConnect: ready,
      canInitialize: ready,
      transport: "websocket",
      transports: ["websocket"],
      schemaSource: "unknown",
    },
    account: {
      canRead: ready,
      canStartLogin: ready,
    },
    config: {
      canRead: ready,
    },
    configRequirements: {
      canRead: ready,
    },
    threads: {
      canStart: ready,
      canRead: ready,
      canResume: ready,
      canList: ready,
      canFork: ready,
      canRollback: ready,
      canPersistExtendedHistory: true,
    },
    turns: {
      canStart: ready,
      canSteer: ready,
      canInterrupt: ready,
      canOverrideModel: ready,
      canOverrideReasoning: ready,
      canUseOutputSchema: false,
    },
    model: {
      canList: ready,
      canSetNextTurn: ready,
      canSetSessionDefault: false,
      canSetProjectDefault: false,
      canLiveUpdate: false,
    },
    reasoning: {
      canSetNextTurn: ready,
      canSetSessionDefault: false,
      canSetProjectDefault: false,
      canLiveUpdate: false,
    },
    agents: {
      runtimeAvailability: ready ? "model_selected_at_turn" : "unavailable",
      binarySelection: normalizeString(session?.orchestrationProfile?.binarySelection, "unknown"),
      reservedProviderToolSchema: session?.orchestrationProfile?.spawnAgentControls?.reservedProviderSchema === true,
      spawnVisibleInputFields: Array.isArray(session?.orchestrationProfile?.spawnAgentControls?.visibleInputFields)
        ? [...session.orchestrationProfile.spawnAgentControls.visibleInputFields]
        : [],
      spawnHiddenInputFields: Array.isArray(session?.orchestrationProfile?.spawnAgentControls?.hiddenInputFields)
        ? [...session.orchestrationProfile.spawnAgentControls.hiddenInputFields]
        : [],
      spawnProviderContract: normalizeString(session?.orchestrationProfile?.spawnAgentControls?.providerContract, "unknown"),
      spawnContractStatus: normalizeString(session?.orchestrationProfile?.spawnAgentControls?.effectiveStatus, "unknown"),
      spawnProviderAcceptanceStatus: normalizeString(session?.orchestrationProfile?.spawnAgentControls?.providerAcceptanceStatus, "unknown"),
      spawnModelOverrideMinimumCodexVersion: normalizeString(session?.orchestrationProfile?.spawnAgentControls?.minimumCodexVersion, ""),
      modelVisibleSpawnControlsConfigured:
        session?.orchestrationProfile?.spawnAgentControls?.modelOverrideConfigured === true
        && session?.orchestrationProfile?.spawnAgentControls?.reasoningEffortOverrideConfigured === true,
      spawnModelOverrideConfigured: session?.orchestrationProfile?.spawnAgentControls?.modelOverrideConfigured === true,
      spawnReasoningEffortOverrideConfigured: session?.orchestrationProfile?.spawnAgentControls?.reasoningEffortOverrideConfigured === true,
      activeToolSchemaWitnessRequired: true,
      effectiveModelVisibleSpawnControls: "unknown",
      fullHistoryForkInheritsParentProfile: true,
      fullHistoryOverrideAllowed: session?.orchestrationProfile?.spawnAgentControls?.fullHistoryOverrideAllowed === true,
      perSpawnOverrideForkTurns: Array.isArray(session?.orchestrationProfile?.spawnAgentControls?.overrideForkTurns)
        ? [...session.orchestrationProfile.spawnAgentControls.overrideForkTurns]
        : [],
      compatibleModelSet: normalizeString(session?.orchestrationProfile?.spawnAgentControls?.compatibleModelSet, "unknown"),
      perSpawnRuntimeSelection: normalizeString(session?.orchestrationProfile?.spawnAgentControls?.runtimeSelection, "unknown"),
      clientSchemaExtensionAllowed: false,
      configSource: normalizeString(session?.orchestrationProfile?.source, ""),
      projectProfileRequestedStatus: normalizeString(session?.projectProfileConfiguration?.requestedStatus, "not_requested"),
      projectProfileConfiguredStatus: normalizeString(session?.projectProfileConfiguration?.configuredStatus, "not_configured"),
      projectProfileProviderAcceptedStatus: normalizeString(session?.projectProfileConfiguration?.providerAcceptedStatus, "not_yet_observed"),
      projectProfileRuntimeVerifiedStatus: normalizeString(session?.projectProfileConfiguration?.runtimeVerifiedStatus, "not_yet_observed"),
      projectProfileResolutionRef: session?.projectProfileConfiguration?.resolutionRef || null,
      projectProfileAuthorityGranted: false,
    },
    serviceTier: {
      canSetNextTurn: ready,
      availableTiers: ["fast", "flex"],
    },
    authority: {
      commandApproval: ready,
      fileChangeApproval: ready,
      permissionsApproval: ready,
      approvalPolicies: ["untrusted", "on-failure", "on-request", "never"],
      sandboxModes: ["read-only", "workspace-write", "danger-full-access"],
      canSetNextTurnApprovalPolicy: ready,
      canSetNextTurnSandbox: ready,
    },
    usage: {
      canReadRateLimits: ready,
      rateLimitMethod: "account/rateLimits/read",
      canReadContextUsage: ready,
      contextUsageEvent: "thread/tokenUsage/updated",
    },
    requests: {
      supportedServerMethods: SUPPORTED_SERVER_REQUEST_METHODS,
      unsupportedButHandledMethods: AUTO_UNSUPPORTED_SERVER_REQUEST_METHODS,
      unknownRequestPolicy: "error-visible",
    },
    fork: {
      present: false,
      governancePath: false,
      contextMaintenance: false,
      continuationBridge: false,
      threadMemoryArtifacts: false,
      refreshPruneMethods: false,
      agentProgressArtifacts: false,
    },
    diagnostics: {
      runtime: normalizeString(session?.runtime, ""),
      binaryPath: normalizeString(session?.binaryPath, ""),
      codexHome: normalizeString(session?.codexHome, ""),
      readyUrl: normalizeString(session?.readyUrl, ""),
      source: "runtime-manager",
    },
  };
  profile.provider = buildRuntimeProviderProfile(session, profile);
  return profile;
}

function buildDescriptor(project, codex, port, options = {}) {
  const runtime = resolveRuntime(project, codex);
  const hostPlatform = normalizeString(options.hostPlatform, process.platform);
  const wsUrl = `ws://127.0.0.1:${port}`;
  const readyUrl = `http://127.0.0.1:${port}/readyz`;
  const configuredBinaryPath = normalizeBinaryCommand(codex.binaryPath, runtime);
  const codexHome = normalizeString(options.codexHome, "") || defaultCodexHomeForRuntime(runtime);
  const binaryPath = resolveManagedAppServerBinaryPath(runtime, configuredBinaryPath, codexHome, codex);
  const workspace = project?.workspace || { kind: "local", localPath: project?.repoPath || process.cwd() };
  const provider = normalizeRuntimeProviderConfig(codex);
  if (provider.kind === "direct_oai") {
    return {
      key: `provider-unavailable:${project?.id || "project"}:direct_oai`,
      runtime: "direct_oai",
      wsUrl: "",
      readyUrl: "",
      command: "",
      args: [],
      cwd: undefined,
      binaryPath: "",
      workspaceRoot: workspace.kind === "wsl"
        ? normalizeString(workspace.linuxPath, project?.repoPath || "")
        : normalizeString(workspace.localPath, project?.repoPath || process.cwd()),
      codexHome,
      provider,
      envExtras: {},
      unavailable: true,
      error: "Direct OpenAI harness provider is not implemented in this shell workspace yet.",
    };
  }
  const projectProfileConfiguration = buildManagedAppServerProjectProfileConfiguration(
    options.projectProfileLaunchInput,
    { ...options, projectId: project?.id || "" },
  );
  const orchestrationProfile = buildManagedAppServerOrchestrationProfile(codex, projectProfileConfiguration);
  const orchestrationProfileVersion = orchestrationProfile.profileVersion;
  const projectProfileKeySuffix = projectProfileConfiguration
    ? `:${projectProfileConfiguration.configurationDigest}`
    : "";

  if (runtime === "wsl") {
    const linuxPath = normalizeString(workspace.linuxPath, "/home");
    if (hostPlatform === "win32") {
      const codexHomeMkdir = mkdirCommand(codexHome);
      const codexHomeExport = codexHome ? `export CODEX_HOME=${shellQuote(codexHome)}; ` : "";
      const args = [];
      if (workspace.distro) args.push("-d", workspace.distro);
      args.push(
        "--cd",
        linuxPath,
        "--",
        "bash",
        "-lc",
        `set -e; ${codexHomeMkdir}${codexHomeExport}${buildManagedAppServerShellInvocation(binaryPath, wsUrl, codex)}`,
      );
      return {
        key: `wsl:${workspace.distro || "default"}:${linuxPath}:${binaryPath}:${codexHome || "default"}:${orchestrationProfileVersion}${projectProfileKeySuffix}`,
        runtime,
        wsUrl,
        readyUrl,
        command: "wsl.exe",
        args,
        cwd: undefined,
        binaryPath,
        workspaceRoot: linuxPath,
        codexHome,
        provider,
        orchestrationProfile,
        projectProfileConfiguration,
        envExtras: {},
      };
    }
    return {
      key: `linux:${linuxPath}:${binaryPath}:${codexHome || "default"}:${orchestrationProfileVersion}${projectProfileKeySuffix}`,
      runtime,
      wsUrl,
      readyUrl,
      command: binaryPath,
      args: buildManagedAppServerArgs(wsUrl, codex),
      cwd: linuxPath,
      binaryPath,
      workspaceRoot: linuxPath,
      codexHome,
      provider,
      orchestrationProfile,
      projectProfileConfiguration,
      envExtras: codexHome ? { CODEX_HOME: codexHome } : {},
    };
  }

  if (workspace.kind === "wsl" && hostPlatform === "win32") {
    throw new Error("Host runtime cannot target a WSL workspace on Windows. Use Codex runtime = WSL.");
  }

  const localPath = normalizeString(workspace.localPath, project?.repoPath || process.cwd());
  return {
    key: `host:${localPath}:${binaryPath}:${codexHome || "default"}:${orchestrationProfileVersion}${projectProfileKeySuffix}`,
    runtime,
    wsUrl,
    readyUrl,
    command: binaryPath,
    args: buildManagedAppServerArgs(wsUrl, codex),
    cwd: localPath,
    binaryPath,
    workspaceRoot: localPath,
    codexHome,
    provider,
    orchestrationProfile,
    projectProfileConfiguration,
    envExtras: codexHome ? { CODEX_HOME: codexHome } : {},
  };
}

class CodexAppServerManager extends EventEmitter {
  constructor() {
    super();
    this.session = null;
  }

  snapshot() {
    if (!this.session) return null;
    const { key, status, runtime, wsUrl, readyUrl, binaryPath, workspaceRoot, codexHome, provider, orchestrationProfile, projectProfileConfiguration, error, logs } = this.session;
    return {
      key,
      status,
      runtime,
      wsUrl,
      readyUrl,
      binaryPath,
      workspaceRoot,
      codexHome,
      provider,
      orchestrationProfile,
      projectProfileConfiguration,
      error,
      capabilities: buildRuntimeCapabilityProfile(this.session),
      logs: logs.slice(-20),
    };
  }

  emitStatus() {
    this.emit("status", {
      at: new Date().toISOString(),
      session: this.snapshot(),
    });
  }

  appendLog(kind, chunk) {
    if (!this.session) return;
    const lines = String(chunk || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of lines) {
      this.session.logs.push({ kind, line, at: new Date().toISOString() });
    }
    if (this.session.logs.length > 200) this.session.logs.splice(0, this.session.logs.length - 200);
  }

  async ensureForProject(project, options = {}) {
    const codex = project?.surfaceBinding?.codex || {};
    const probeDescriptor = buildDescriptor(project, codex, 1, options);
    if (probeDescriptor.unavailable) {
      await this.dispose();
      this.session = {
        ...probeDescriptor,
        child: null,
        status: "unavailable",
        error: probeDescriptor.error || "Codex runtime provider is unavailable.",
        logs: [{
          kind: "status",
          line: probeDescriptor.error || "Codex runtime provider is unavailable.",
          at: new Date().toISOString(),
        }],
      };
      this.emitStatus();
      return this.snapshot();
    }
    if (this.session && this.session.key === probeDescriptor.key && this.session.status === "ready") {
      return this.snapshot();
    }

    const startupAttempts = normalizeInteger(options.startupAttempts, STARTUP_ATTEMPTS, 1, 4);
    let lastFailure = null;

    for (let attempt = 1; attempt <= startupAttempts; attempt += 1) {
      const port = await allocatePort();
      const descriptor = buildDescriptor(project, codex, port, options);
      if (descriptor.runtime === "host" && descriptor.codexHome) {
        fs.mkdirSync(descriptor.codexHome, { recursive: true });
      }

      await this.dispose();

      const child = spawn(descriptor.command, descriptor.args, {
        cwd: descriptor.cwd,
        env: { ...process.env, ...(descriptor.envExtras || {}) },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      this.session = {
        ...descriptor,
        child,
        status: "starting",
        error: "",
        logs: [],
      };

      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk) => this.appendLog("stdout", chunk));
      child.stderr?.on("data", (chunk) => this.appendLog("stderr", chunk));
      child.on("error", (error) => {
        if (!this.session || this.session.child !== child) return;
        this.session.status = "failed";
        this.session.error = error.message;
        this.emitStatus();
      });
      child.on("exit", (code, signal) => {
        if (!this.session || this.session.child !== child) return;
        if (this.session.status !== "disposed") {
          this.session.status = "exited";
          this.session.error = `Codex app-server exited (code=${code ?? "null"} signal=${signal ?? "null"}).`;
          this.emitStatus();
        }
      });

      this.emitStatus();

      try {
        const ready = await waitForReady(descriptor.readyUrl, child);
        if (!this.session || this.session.child !== child) throw new Error("Codex app-server session was replaced before readiness.");
        this.session.status = "ready";
        if (ready?.readyBy === "tcp") {
          this.appendLog(
            "status",
            `Codex app-server accepted as ready via TCP probe after /readyz status ${ready.status || "unavailable"}.`,
          );
        }
        this.emitStatus();
        return this.snapshot();
      } catch (error) {
        if (this.session && this.session.child === child) {
          this.session.status = "failed";
          const logTail = this.session.logs
            .slice(-6)
            .map((entry) => `${entry.kind}: ${entry.line}`)
            .join(" | ");
          this.session.error = error.message;
          this.emitStatus();
          lastFailure = new Error(logTail ? `${error.message} Last logs: ${logTail}` : error.message);
        } else {
          lastFailure = error instanceof Error ? error : new Error(String(error));
        }
        await this.dispose();
        if (attempt < startupAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
        }
      }
    }

    throw lastFailure || new Error("Codex app-server startup failed.");
  }

  async dispose() {
    if (!this.session) return;
    const { child } = this.session;
    this.session.status = "disposed";
    this.emitStatus();
    this.session = null;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        child.kill("SIGKILL");
      }, 1200);
      timer.unref?.();
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

module.exports = {
  MANAGED_APP_SERVER_CONFIG_OVERRIDES,
  MANAGED_APP_SERVER_MODEL_OVERRIDE_CONFIG,
  MANAGED_APP_SERVER_MODEL_OVERRIDE_DISABLED_CONFIG,
  buildDescriptor,
  buildManagedAppServerArgs,
  buildManagedAppServerOrchestrationProfile,
  buildManagedAppServerShellInvocation,
  buildManagedAppServerProjectProfileConfiguration,
  buildProjectProfileRuntimeLaunchObservation,
  prepareProjectProfileLaunchRequest,
  registerProjectProfileLaunchResponse,
  buildRuntimeCapabilityProfile,
  CodexAppServerManager,
  managedAppServerConfigOverrides,
  resolveManagedAppServerBinaryPath,
  resolveRuntime,
};
