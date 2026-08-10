const {
  app,
  BaseWindow,
  WebContentsView,
  ipcMain,
  dialog,
  shell,
  Menu,
  clipboard,
  nativeTheme,
} = require("electron");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { CodexAppServerManager } = require("./main/codex-app-server");
const { LocalSurfaceServer } = require("./main/local-surface-server");
const { CodexSurfaceSession } = require("./main/codex-surface-session");
const { MiddleWebHost } = require("./main/middle-web-host");
const { WorkspaceBackendManager, workspaceLabel, workspaceRoot } = require("./main/workspace-backend");
const { ThreadAnalyticsStore, buildThreadKey } = require("./main/thread-analytics-store");
const {
  createDirectAuthIpcController,
  registerDirectAuthIpcHandlers,
} = require("./main/direct/auth/auth-ipc");
const { createDirectAuthLoginCoordinator } = require("./main/direct/auth/auth-login");
const { codexAuthTokensFromCredentials } = require("./main/direct/auth/app-server-auth-bridge");
const { createCodexCliAuthStore, createDirectAuthCompositeStore } = require("./main/direct/auth/codex-cli-auth");
const { loadDirectCodexProfile } = require("./main/direct/odeu-profile/profile-loader");
const { DirectSessionStore } = require("./main/direct/session/session-store");
const { DirectThreadStore } = require("./main/direct/thread/thread-store");
const { DirectThreadWorkbenchController } = require("./main/direct/thread/thread-workbench-controller");
const { DirectWorkThreadRegistryStore } = require("./main/direct/bridge/work-thread-registry");
const { DirectAgentRegistryStore } = require("./main/direct/bridge/agent-registry");
const { DirectImportController } = require("./main/direct/import/import-controller");
const {
  DirectMetaSessionStore,
  assertMetaSessionRendererSafe,
  buildDirectMetaSessionStatusProjection,
} = require("./main/direct/meta-session");
const {
  DIRECT_IMPLEMENTATION_PROOF_RUNS_ROOT_NAME,
  DirectImplementationProofEvidenceStore,
} = require("./main/direct/probes/implementation-proof-evidence-store");
const {
  DIRECT_LIVE_PROBE_EVIDENCE_ROOT_NAME,
  DirectLiveProbeEvidenceStore,
} = require("./main/direct/probes/live-probe-evidence-store");
const {
  DIRECT_FIXTURE_SURFACE_TRANSPORT,
  DirectFixtureController,
  DirectFixtureSurfaceSession,
  buildDirectFixtureCapabilities,
} = require("./main/direct/controller/fixture-controller");
const {
  DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
  DirectLiveTextController,
  DirectLiveTextSurfaceSession,
  buildDirectLiveTextCapabilities,
} = require("./main/direct/controller/live-text-controller");
const {
  DEFAULT_TEXT_PROBE_INSTRUCTIONS,
  DEFAULT_TEXT_PROBE_PROMPT,
  runImplementationToolInitialProbe,
  runTextOnlyDirectProbe,
} = require("./main/direct/transport/codex-responses-transport");
const {
  buildDirectRuntimeStatus,
  directRuntimeLaneLabel,
  normalizeCodexBindingProvider,
  normalizeDirectExperimentalRuntimeTier,
  normalizeCodexRuntimeMode: normalizeDirectRuntimeModeForStatus,
} = require("./main/direct/runtime/runtime-status");
const {
  bindingForDirectRuntimePath,
  directRuntimePathFromBinding,
  normalizeDirectRuntimePath,
  resolveCodexThreadOpenRuntime,
} = require("./main/direct/runtime/runtime-path-selection");
const {
  buildDirectImplementationLaneUiStatus,
  buildDirectPolicyReadOnlyView,
  projectOperationHistoryPage,
} = require("./main/direct/ui/implementation-lane-ui");
const {
  assertDirectSettingsSurfaceRendererSafe,
  buildDirectSettingsSurfaceProjection,
} = require("./main/direct/ui/settings-surface");
const {
  buildDirectInformationBridgeAudit,
} = require("./main/direct/bridge/information-registry");
const {
  assertDirectManualSmokeGateSafe,
  buildDirectManualSmokeGate,
} = require("./main/direct/readiness/manual-smoke-gate");
const {
  buildRuntimeWitnessProjection,
  normalizeEvidenceRef,
} = require("./main/direct/readiness/usage-readiness");
const {
  DirectServerMetadataAdapter,
} = require("./main/direct/provider/metadata-adapter");
const {
  assertProviderHostedToolsStatusSafe,
  buildProviderHostedToolsStatus,
} = require("./main/direct/provider/hosted-tools");
const {
  assertPluginGovernanceStatusSafe,
  buildPluginGovernanceStatus,
} = require("./main/direct/external/plugin-governance");
const {
  assertContextPacketPreviewSafe,
  buildContextPacketPreview,
} = require("./main/direct/context/preview-workbench");
const {
  assertOperatorBrokerProjectionSafe,
  assertOperatorBrokerResolutionSafe,
  buildOperatorBrokerResolution,
  buildOperatorBrokerResolutionProjection,
} = require("./main/direct/governance/operator-broker-resolution");
const {
  buildAppServerFallbackParityReport,
} = require("./main/direct/readiness/appserver-fallback-parity");
const {
  buildBridgeModuleStatusProjection,
} = require("./main/direct/bridge/skills-hooks-apps");
const {
  buildAgentClassRegistry,
  buildAgentClassStatusProjection,
} = require("./main/direct/bridge/agent-class-spec");
const {
  buildToolCapabilityRegistry,
  buildToolCapabilityStatusProjection,
  validateToolCapabilityRegistry,
} = require("./main/direct/bridge/tool-capability-registry");
const {
  buildDirectAgentUsageLedger,
  buildDirectAgentUsageSummaryProjection,
} = require("./main/direct/usage/agent-ledger");
const {
  assertAgentRuntimeSubstrateSafe,
  buildAgentMailbox,
  buildAgentRuntimeSubstrateStatus,
  buildAgentThreadGraph,
} = require("./main/direct/agents/runtime-substrate");
const {
  assertTextOnlySubAgentToolSurfaceSafe,
  buildTextOnlySubAgentToolSurface,
} = require("./main/direct/agents/text-tool-surface");
const {
  createDirectLiveSubAgentToolSurface,
} = require("./main/direct/agents/live-tool-surface");
const {
  DirectNativeAgentPool,
} = require("./main/direct/agents/native-agent-pool");
const {
  assertBatchAgentJobSurfaceSafe,
  buildBatchAgentJobSurface,
} = require("./main/direct/agents/batch-job-surface");
const {
  assertStatefulExecSessionSurfaceSafe,
  buildStatefulExecSessionSurface,
} = require("./main/direct/tools/stateful-exec-session");
const {
  assertCodeModeExecutionLaneSafe,
  buildCodeModeExecutionLaneStatus,
} = require("./main/direct/tools/code-mode-execution-lane");
const {
  assertExternalCapabilityDiscoveryRegistrySafe,
  buildExternalCapabilityDiscoveryRegistry,
  buildExternalCapabilityDiscoveryStatusProjection,
} = require("./main/direct/external/capability-discovery");
const {
  buildExternalCapabilityProfile,
} = require("./main/direct/external/external-capability-profile");
const {
  assertMcpResourceToolBoundarySafe,
  buildMcpResourceToolBoundaryStatus,
} = require("./main/direct/external/mcp-boundary");
const {
  assertControlToolSubstrateSafe,
  buildControlToolSubstrateStatus,
} = require("./main/direct/tools/control-perception-decision-substrate");
const {
  buildVanillaSiblingContextEvidence,
} = require("./main/direct/context/maintenance");
const {
  DirectExperimentalActivationStore,
  activeDirectTurnCountForProject,
  activationProjectBindingDigest,
  evaluateDirectTextOnlyRuntimeSelection,
  evaluateDirectExperimentalProjectActivation,
} = require("./main/direct/runtime/project-activation");
const { UsageLedgerCollector } = require("./main/usage-ledger-collector");
const {
  createCodexSurfaceConnectionAuthority,
  publicCodexSurfaceConnection,
  validateCodexSurfaceConnectionRequest,
} = require("./main/codex-surface-connection-authority");
const {
  blockedMessage: externalNavigationBlockedMessage,
  navigationDecision: externalNavigationDecision,
} = require("./main/external-navigation-policy");
const {
  CODEX_SURFACE_BRIDGE_PROFILES,
  CODEX_SURFACE_TRUST_PROFILES,
  SURFACE_ROLES,
  codexSurfaceAuthorityForTarget,
  hasFullCodexBridge,
  codexClientNotificationDecision,
  codexClientRequestDecision,
  normalizeCodexBridgeProfile,
  normalizeCodexTrustProfile,
  normalizeSurfaceRole,
} = require("./main/authority-catalog");
const {
  stagePaths: stageAttachmentPaths,
  stageClipboardImage,
  removeDraft: removeAttachmentDraft,
} = require("./main/attachment-staging-store");
const { defaultUsageLedgerConfig, normalizeUsageLedgerConfig } = require("./main/usage-ledger-config");
const { readUsageLedgerAnalytics } = require("./main/usage-ledger-analytics");
const {
  buildRuntimeAnalyticsProjection,
} = require("./main/direct/analytics/runtime-analytics-adapter");
const { PLANE_ZOOM_DEFAULT, clampZoomFactor, zoomDeltaForDirection } = require("./shared/plane-zoom");
const {
  APP_EXPERIENCES,
  publicAppExperience,
  resolveAppExperience,
} = require("./main/app-experience");

const APP_TITLE = "Codex Review Shell";
const CONFIG_FILE_NAME = "workspace-config.json";
const CHATGPT_THREAD_CACHE_FILE_NAME = "chatgpt-thread-cache.json";
const MIDDLE_WEB_HISTORY_FILE_NAME = "middle-web-history.json";
const CHATGPT_THREAD_CACHE_VERSION = 1;
const CHATGPT_THREAD_CACHE_MAX_ENTRIES = 1500;
const THREAD_ANALYTICS_DB_FILE_NAME = "thread-analytics.sqlite";
const DIRECT_SESSION_ROOT_NAME = "direct-sessions";
const THREAD_ANALYTICS_ANALYZER_VERSION = "analytics-v0.1";
const ANALYTICS_DISCOVERY_THREAD_LIMIT = 260;
const ANALYTICS_DISCOVERY_SCAN_LIMIT = 420;
const ANALYTICS_DISCOVERY_TIMEOUT_MS = 70_000;
const CODEX_PARTITION = "persist:codex-review-shell-codex";
const CHATGPT_PARTITION = "persist:codex-review-shell-chatgpt";
const PREVIEW_LIMIT_BYTES = 384 * 1024;
const DIRECTORY_ENTRY_LIMIT = 500;
const CODEX_THREAD_RUNTIME_PREF_MAX_ENTRIES = 500;
const PROFILE_ENV_VAR = "CODEX_REVIEW_SHELL_PROFILE";
const USER_DATA_DIR_ENV_VAR = "CODEX_REVIEW_SHELL_USER_DATA_DIR";
const USER_DATA_ROOT_ENV_VAR = "CODEX_REVIEW_SHELL_USER_DATA_ROOT";
const CHATGPT_DOWNLOAD_MACRO_REQUEST_TTL_MS = 60_000;
const APP_EXPERIENCE = resolveAppExperience(process.env);
const DIRECT_WORKBENCH_MODE = APP_EXPERIENCE.id === APP_EXPERIENCES.DIRECT_WORKBENCH;

const appRoot = path.resolve(__dirname, "..");
const repoRoot = appRoot;
const legacyStandaloneRepoRoot = path.resolve(appRoot, "..", "..");
const rendererRoot = path.join(__dirname, "renderer");
const shellHtmlPath = path.join(rendererRoot, "index.html");
const codexSurfacePreloadPath = path.join(__dirname, "preload-codex-surface.js");
const smokeExitMs = Number.parseInt(process.env.CODEX_REVIEW_SHELL_SMOKE_EXIT_MS ?? "", 10);
const workspaceAgentPath = path.join(__dirname, "backend", "wsl-agent.js");

function earlyNormalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stableEvidenceKey(prefix, value) {
  const text = earlyNormalizeString(value, "");
  return text
    ? `${prefix}:${crypto.createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16)}`
    : "";
}

function existingFileMtimeMs(targetPath) {
  try {
    return fsSync.statSync(targetPath).mtimeMs;
  } catch {
    return 0;
  }
}

function uniquePaths(values) {
  const seen = new Set();
  return values.filter((value) => {
    const normalized = path.resolve(value);
    const key = process.platform === "win32" ? normalized.toLowerCase() : normalized;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeProfileName(value) {
  const text = earlyNormalizeString(value, "");
  if (!text || text === "default") return "";
  return text.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function configureAppProfile() {
  app.setName(APP_TITLE);
  const explicitUserDataDir = earlyNormalizeString(process.env[USER_DATA_DIR_ENV_VAR], "");
  if (explicitUserDataDir) {
    const userData = path.resolve(explicitUserDataDir);
    app.setPath("userData", userData);
    return {
      profileName: "explicit",
      isolated: true,
      userData,
    };
  }
  const profileName = normalizeProfileName(process.env[PROFILE_ENV_VAR]);
  if (!profileName) {
    const appDataPath = app.getPath("appData");
    const canonicalUserDataPath = path.join(appDataPath, APP_TITLE);
    const legacyUserDataPath = path.join(appDataPath, "codex-review-shell");
    const formerDirectUserDataPath = path.join(appDataPath, "codex-review-shell-direct");
    // A promoted installation may have been active on either former lineage.
    // Keep using the profile with the newest persisted workspace configuration.
    const candidates = uniquePaths([
      canonicalUserDataPath,
      legacyUserDataPath,
      formerDirectUserDataPath,
      app.getPath("userData"),
    ]);
    let selectedPath = canonicalUserDataPath;
    let selectedMtime = 0;
    for (const candidate of candidates) {
      const mtime = existingFileMtimeMs(path.join(candidate, CONFIG_FILE_NAME));
      if (mtime > selectedMtime) {
        selectedPath = candidate;
        selectedMtime = mtime;
      }
    }
    app.setPath("userData", selectedPath);
    return {
      profileName: "default",
      isolated: false,
      userData: selectedPath,
    };
  }
  const configuredRoot = earlyNormalizeString(process.env[USER_DATA_ROOT_ENV_VAR], "");
  const profileRoot = configuredRoot || path.join(app.getPath("appData"), APP_TITLE);
  const userData = path.join(profileRoot, profileName);
  app.setPath("userData", userData);
  return {
    profileName,
    isolated: true,
    userData,
  };
}

const activeAppProfile = configureAppProfile();

let mainWindow = null;
let shellView = null;
let codexView = null;
let chatgptView = null;
let middleWebHost = null;
let lastSurfaceBounds = null;
let surfacesVisible = true;
let configCache = null;
let chatgptThreadCache = null;
let currentProject = null;
let activeCodexSurfaceConnection = null;
let layoutPingTimer = null;
let geometrySyncTimer = null;
let workspaceBackends = null;
let codexAppServer = null;
let localSurfaceServer = null;
let codexSurfaceSessions = null;
let threadAnalyticsStore = null;
let directAuthController = null;
let directAuthLoginCoordinator = null;
let directCodexCliAuthStore = null;
let directCodexProfileDoc = null;
let directSessionStore = null;
let directThreadStore = null;
let directWorkThreadStore = null;
let directAgentRegistryStore = null;
let directThreadWorkbenchController = null;
let directImportController = null;
let directMetaSessionStore = null;
let directLiveProbeEvidenceStore = null;
let directImplementationProofEvidenceStore = null;
let directFixtureController = null;
let directLiveTextController = null;
let directNativeAgentPool = null;
let directProviderMetadataAdapter = null;
let directActivationStore = null;
const directActivationLocks = new Map();
const directAgentRegistryBackfillStateByProject = new Map();
let chatgptDownloadHandler = null;
let pendingChatgptDownloadMacroRequests = [];
let activeChatgptContext = null;
let surfaceActivationEpoch = 0;
const webContentsAuthorityProfiles = new Map();
const webContentsAuthorityCleanupRegistered = new Set();
const CODEX_SURFACE_SENSITIVE_RESPONSE_RISKS = new Set(["command", "file-change", "network", "permission"]);
const nativePlaneZoomFactors = {
  codex: PLANE_ZOOM_DEFAULT,
  chatgpt: PLANE_ZOOM_DEFAULT,
};
const lastSuccessfulCodexThreadByProject = new Map();
const latestCodexOpenTargetByProject = new Map();
const latestCodexThreadFailureByProject = new Map();
const latestContextManagementEvidenceByProject = new Map();
const contextManagementObservationsByProject = new Map();
const latestCodexAgentGraphByProjectThread = new Map();

function nowIso() {
  return new Date().toISOString();
}

function stableDigestValue(value, seen = new WeakSet()) {
  if (typeof value === "bigint") return `bigint:${value.toString()}`;
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    return value.map((item) => stableDigestValue(item, seen));
  }
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) output[key] = stableDigestValue(value[key], seen);
    }
    return output;
  }
  return value;
}

function stableDigest(value) {
  try {
    return crypto.createHash("sha256").update(JSON.stringify(stableDigestValue(value))).digest("hex");
  } catch {
    return crypto.createHash("sha256").update(String(value || "")).digest("hex");
  }
}

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function configPath() {
  return path.join(app.getPath("userData"), CONFIG_FILE_NAME);
}

function chatgptThreadCachePath() {
  return path.join(app.getPath("userData"), CHATGPT_THREAD_CACHE_FILE_NAME);
}

function middleWebHistoryPath() {
  return path.join(app.getPath("userData"), MIDDLE_WEB_HISTORY_FILE_NAME);
}

function threadAnalyticsDbPath() {
  return path.join(app.getPath("userData"), THREAD_ANALYTICS_DB_FILE_NAME);
}

function directAuthRootDir() {
  return path.join(app.getPath("userData"), "direct-auth");
}

function directProviderMetadataRootDir() {
  return path.join(app.getPath("userData"), "direct-provider-metadata");
}

function directSessionRootDir() {
  return path.join(app.getPath("userData"), DIRECT_SESSION_ROOT_NAME);
}

function directLiveProbeEvidenceRootDir() {
  return path.join(app.getPath("userData"), DIRECT_LIVE_PROBE_EVIDENCE_ROOT_NAME);
}

function directImplementationProofRunsRootDir() {
  return path.join(app.getPath("userData"), DIRECT_IMPLEMENTATION_PROOF_RUNS_ROOT_NAME);
}

function directMetaSessionRootDir() {
  return path.join(app.getPath("userData"), ".direct-meta-session");
}

function tempFilePath(targetPath) {
  return `${targetPath}.${process.pid}.${Date.now()}.${crypto.randomUUID().slice(0, 8)}.tmp`;
}

async function writeTextAtomic(targetPath, text) {
  const directory = path.dirname(targetPath);
  const tempPath = tempFilePath(targetPath);
  try {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(tempPath, text, "utf8");
    await fs.rename(tempPath, targetPath);
  } catch (error) {
    try {
      await fs.unlink(tempPath);
    } catch {}
    throw error;
  }
}

async function preserveMalformedJson(targetPath, rawContents, reason = "parse-error") {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${targetPath}.bad.${stamp}.${reason}.json`;
    await writeTextAtomic(backupPath, typeof rawContents === "string" ? rawContents : String(rawContents || ""));
    return backupPath;
  } catch {
    return "";
  }
}

function normalizeLinuxPathValue(value, fallback = "/home") {
  const text = (typeof value === "string" && value.trim() ? value.trim() : fallback).replace(/\\/g, "/");
  return text.startsWith("/") ? text : `/${text}`;
}

function defaultProjectWorkspaceConfig() {
  const preferredWslPath = typeof process.env.CODEX_REVIEW_SHELL_DEFAULT_WSL_PATH === "string"
    ? process.env.CODEX_REVIEW_SHELL_DEFAULT_WSL_PATH.trim()
    : "";
  if (process.platform === "win32" && preferredWslPath) {
    return {
      kind: "wsl",
      distro: typeof process.env.CODEX_REVIEW_SHELL_DEFAULT_WSL_DISTRO === "string"
        ? process.env.CODEX_REVIEW_SHELL_DEFAULT_WSL_DISTRO.trim()
        : "",
      linuxPath: normalizeLinuxPathValue(preferredWslPath, "/home"),
      label: "WSL workspace",
    };
  }
  return {
    kind: "local",
    localPath: repoRoot,
    label: "Local checkout",
  };
}

function defaultProjectRepoPath(workspace = defaultProjectWorkspaceConfig()) {
  if (workspace.kind === "wsl") {
    const distro = workspace.distro || "default";
    return `wsl:${distro}:${workspace.linuxPath}`;
  }
  return workspace.localPath;
}

function defaultCodexRuntimeForWorkspace(workspace) {
  return workspace?.kind === "wsl" && process.platform === "win32" ? "wsl" : "auto";
}

function defaultConfig() {
  const defaultProjectId = "project_example";
  const defaultWorkspace = defaultProjectWorkspaceConfig();
  const defaultRepoPath = defaultProjectRepoPath(defaultWorkspace);
  return {
    version: 5,
    selectedProjectId: defaultProjectId,
    ui: {
      leftRatio: 0.34,
      middleRatio: 0.3,
    },
    runtimeDefaults: {
      codex: {
        approvalPolicy: "",
        sandboxMode: "",
      },
    },
    codexThreadRuntimeDefaults: {},
    chatgptDownloads: {
      enabled: true,
      windowsDownloadDir: "",
    },
    projects: [
      {
        id: defaultProjectId,
        name: "Example Project",
        repoPath: defaultRepoPath,
        workspace: defaultWorkspace,
        surfaceBinding: {
          codex: {
            mode: "managed",
            bindingProvider: "codex-compatible",
            runtimeMode: "legacy-app-server",
            directTransport: "fixture",
            runtime: defaultCodexRuntimeForWorkspace(defaultWorkspace),
            profileId: "",
            target: "",
            binaryPath: "codex",
            model: "",
            reasoningEffort: "",
            spawnAgentModelOverrides: false,
            label: "Managed Codex lane",
            provider: {
              kind: "codex_executable",
              flavor: "vanilla",
            },
            usageLedger: defaultUsageLedgerConfig(),
            remoteAuth: {
              mode: "none",
              tokenFilePath: "",
              tokenEnvVar: "",
              serverAuthScheme: "unknown",
            },
          },
          chatgpt: {
            reviewThreadUrl: "https://chatgpt.com/",
            reduceChrome: true,
            downloadMacro: {
              enabled: true,
              workspaceRelDir: ".codex/review-shell/chatgpt-downloads",
              notifyCodex: true,
              activeTurnDisposition: "queue",
              messageTemplate: "GPT review is at {{workspacePath}}",
            },
          },
        },
        chatThreads: [
          defaultChatThread({
            id: "thread_review_primary",
            role: "review",
            title: "Primary review",
            url: "https://chatgpt.com/",
            isPrimary: true,
            pinned: true,
            notes: "Main project-bound ChatGPT review thread.",
          }),
        ],
        activeChatThreadId: "thread_review_primary",
        laneBindings: [],
        lastActiveBindingId: "",
        promptTemplates: defaultPromptTemplates(),
        flowProfile: {
          reviewPromptTemplate: defaultPromptTemplateText("review"),
          watchedFilePatterns: ["**/*REVIEW*.md", "**/*review*.md", "artifacts/**/*.md"],
          returnHeader: "GPT feedback",
          handoffMode: "assisted",
        },
        handoffs: [],
        ignoredWatchedArtifactPaths: [],
        createdAt: nowIso(),
        updatedAt: nowIso(),
      },
    ],
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeCodexMode(value) {
  const candidate = normalizeString(value, "managed").toLowerCase();
  if (candidate === "local" || candidate === "command") return "managed";
  if (["managed", "url", "fallback"].includes(candidate)) return candidate;
  return "managed";
}

function normalizeCodexRuntime(value) {
  const candidate = normalizeString(value, "auto").toLowerCase();
  return ["auto", "host", "wsl"].includes(candidate) ? candidate : "auto";
}

function normalizeDirectExperimentalTransport(value) {
  const candidate = normalizeString(value, "fixture").toLowerCase();
  return ["fixture", "live-text"].includes(candidate) ? candidate : "fixture";
}

function normalizeRemoteAuthConfig(value) {
  const raw = isPlainObject(value) ? value : {};
  const modeCandidate = normalizeString(raw.mode, "none").toLowerCase();
  const mode = ["none", "bearer-token-file", "bearer-token-env"].includes(modeCandidate) ? modeCandidate : "none";
  const schemeCandidate = normalizeString(raw.serverAuthScheme, "unknown").toLowerCase();
  const serverAuthScheme = ["unknown", "capability-token", "signed-bearer-token"].includes(schemeCandidate)
    ? schemeCandidate
    : "unknown";
  return {
    mode,
    tokenFilePath: mode === "bearer-token-file" ? normalizeString(raw.tokenFilePath, "") : "",
    tokenEnvVar: mode === "bearer-token-env" ? normalizeString(raw.tokenEnvVar, "") : "",
    serverAuthScheme,
  };
}

function normalizeChatgptDownloadsConfig(value) {
  const raw = isPlainObject(value) ? value : {};
  return {
    enabled: raw.enabled !== false,
    windowsDownloadDir: normalizeString(raw.windowsDownloadDir, ""),
  };
}

function normalizeWorkspaceRelDir(value, fallback) {
  const text = normalizeString(value, fallback).replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  const parts = text.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === "..")) return fallback;
  return parts.join("/");
}

function normalizeDownloadMacroConfig(value) {
  const raw = isPlainObject(value) ? value : {};
  const disposition = normalizeString(raw.activeTurnDisposition, "queue").toLowerCase();
  return {
    enabled: raw.enabled !== false,
    workspaceRelDir: normalizeWorkspaceRelDir(raw.workspaceRelDir, ".codex/review-shell/chatgpt-downloads"),
    notifyCodex: raw.notifyCodex !== false,
    activeTurnDisposition: ["queue", "steer", "ask"].includes(disposition) ? disposition : "queue",
    messageTemplate: normalizeString(raw.messageTemplate, "GPT review is at {{workspacePath}}"),
  };
}

function normalizeReasoningEffort(value) {
  const candidate = normalizeString(value, "").toLowerCase();
  return ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"].includes(candidate) ? candidate : "";
}

function normalizeApprovalPolicy(value) {
  const candidate = normalizeString(value, "").toLowerCase();
  return ["untrusted", "on-failure", "on-request", "never"].includes(candidate) ? candidate : "";
}

function normalizeSandboxMode(value) {
  const candidate = normalizeString(value, "").toLowerCase();
  return ["read-only", "workspace-write", "danger-full-access"].includes(candidate) ? candidate : "";
}

function normalizeRuntimeDefaults(value) {
  const raw = isPlainObject(value) ? value : {};
  const rawCodex = isPlainObject(raw.codex) ? raw.codex : {};
  return {
    codex: {
      approvalPolicy: normalizeApprovalPolicy(rawCodex.approvalPolicy),
      sandboxMode: normalizeSandboxMode(rawCodex.sandboxMode),
    },
  };
}

function codexThreadRuntimePreferenceKey(parts = {}) {
  const values = [
    normalizeString(parts.projectId, ""),
    normalizeString(parts.threadId, ""),
    normalizeString(parts.sourceHome, ""),
    normalizeString(parts.sessionFilePath, ""),
  ];
  if (!values[0] || !values[1]) return "";
  return values.map((value) => Buffer.from(value, "utf8").toString("base64url")).join(".");
}

function codexThreadRuntimePreferenceMatchScore(entry = {}, parts = {}) {
  let score = 0;
  const requestedSourceHome = normalizeString(parts.sourceHome, "");
  const requestedSessionFilePath = normalizeString(parts.sessionFilePath, "");
  if (requestedSourceHome && normalizeString(entry.sourceHome, "") === requestedSourceHome) score += 2;
  if (requestedSessionFilePath && normalizeString(entry.sessionFilePath, "") === requestedSessionFilePath) score += 2;
  if (!requestedSourceHome && !normalizeString(entry.sourceHome, "")) score += 1;
  if (!requestedSessionFilePath && !normalizeString(entry.sessionFilePath, "")) score += 1;
  return score;
}

function findCodexThreadRuntimePreference(threadDefaults, parts = {}) {
  const defaults = isPlainObject(threadDefaults) ? threadDefaults : {};
  const threadKey = codexThreadRuntimePreferenceKey(parts);
  if (threadKey && defaults[threadKey]) {
    return { key: threadKey, value: defaults[threadKey], match: "exact" };
  }

  const projectId = normalizeString(parts.projectId, "");
  const threadId = normalizeString(parts.threadId, "");
  if (!projectId || !threadId) return { key: threadKey, value: null, match: "none" };

  const matches = Object.entries(defaults)
    .filter(([, entry]) => {
      return (
        normalizeString(entry?.projectId, "") === projectId &&
        normalizeString(entry?.threadId, "") === threadId
      );
    })
    .map(([key, entry]) => ({
      key,
      entry,
      score: codexThreadRuntimePreferenceMatchScore(entry, parts),
      updatedAt: normalizeString(entry?.updatedAt, ""),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
    });

  const match = matches[0];
  return match
    ? { key: match.key, value: match.entry, match: "thread" }
    : { key: threadKey, value: null, match: "none" };
}

function normalizeCodexThreadRuntimeDefaults(value) {
  if (!isPlainObject(value)) return {};
  const entries = [];
  for (const rawEntry of Object.values(value)) {
    const entry = isPlainObject(rawEntry) ? rawEntry : {};
    const projectId = normalizeString(entry.projectId, "");
    const threadId = normalizeString(entry.threadId, "");
    if (!projectId || !threadId) continue;
    const sourceHome = normalizeString(entry.sourceHome, "");
    const sessionFilePath = normalizeString(entry.sessionFilePath, "");
    const key = codexThreadRuntimePreferenceKey({ projectId, threadId, sourceHome, sessionFilePath });
    if (!key) continue;
    const model = normalizeString(entry.model, "");
    const reasoningEffort = normalizeReasoningEffort(entry.reasoningEffort);
    if (!model && !reasoningEffort) continue;
    entries.push({
      key,
      value: {
        projectId,
        threadId,
        sourceHome,
        sessionFilePath,
        model,
        reasoningEffort,
        updatedAt: normalizeString(entry.updatedAt, nowIso()),
      },
    });
  }
  entries.sort((left, right) => String(right.value.updatedAt || "").localeCompare(String(left.value.updatedAt || "")));
  const normalized = {};
  for (const entry of entries.slice(0, CODEX_THREAD_RUNTIME_PREF_MAX_ENTRIES)) normalized[entry.key] = entry.value;
  return normalized;
}

function normalizeCodexProviderConfig(value) {
  const raw = isPlainObject(value) ? value : {};
  const kindCandidate = normalizeString(raw.kind || raw.providerKind || raw.connectionPath, "codex_executable");
  const kind = ["codex_executable", "direct_oai"].includes(kindCandidate) ? kindCandidate : "codex_executable";
  const flavorCandidate = normalizeString(
    isPlainObject(raw.flavor) ? raw.flavor.configuredFlavor : raw.flavor || raw.configuredFlavor || raw.providerFlavor,
    kind === "codex_executable" ? "vanilla" : "",
  );
  const flavor = ["vanilla", "lex_fork", "unknown_custom"].includes(flavorCandidate)
    ? flavorCandidate
    : kind === "codex_executable"
      ? "vanilla"
      : "";
  return {
    kind,
    flavor,
    selectedBy: normalizeString(raw.selectedBy, "project_config"),
    configuredAt: normalizeString(raw.configuredAt, ""),
  };
}

function safeRecentThreadLimit(limit = 40) {
  return Math.max(1, Math.min(Number(limit) || 40, 200));
}

function mergeThreadSourceLabels(...values) {
  return Array.from(
    new Set(
      values
        .filter(Boolean)
        .flatMap((value) => String(value).split("+").map((part) => part.trim()).filter(Boolean))
    )
  ).join("+");
}

function optionalRecentThreadRank(value) {
  if (value === null || value === undefined || value === "") return null;
  const rank = Number(value);
  return Number.isFinite(rank) ? rank : null;
}

function normalizeRecentThreadEntry(raw, fallbackDiscoveredAt = "") {
  if (!isPlainObject(raw)) return null;
  const externalId = normalizeString(raw.externalId, "");
  if (!externalId) return null;
  return {
    externalId,
    title: normalizeString(raw.title, "Untitled ChatGPT thread"),
    url: normalizeString(raw.url, ""),
    updatedAt: normalizeString(raw.updatedAt, ""),
    createdAt: normalizeString(raw.createdAt, ""),
    displayDate: normalizeString(raw.displayDate, ""),
    projectRank: optionalRecentThreadRank(raw.projectRank),
    archived: Boolean(raw.archived),
    snippet: normalizeString(raw.snippet, ""),
    projectName: normalizeString(raw.projectName, ""),
    workspaceId: normalizeString(raw.workspaceId, ""),
    sourceKind: normalizeString(raw.sourceKind, "recent").toLowerCase() === "project" ? "project" : "recent",
    source: normalizeString(raw.source, ""),
    discoveredAt: normalizeString(raw.discoveredAt, fallbackDiscoveredAt),
  };
}

function mergeRecentThreadEntries(current, incoming) {
  if (!current) return incoming;
  const incomingUpdated = String(incoming.updatedAt || "");
  const currentUpdated = String(current.updatedAt || "");
  const incomingCreated = String(incoming.createdAt || "");
  const currentCreated = String(current.createdAt || "");
  const mergedUpdatedAt = incomingUpdated > currentUpdated ? incomingUpdated : currentUpdated;
  const incomingTitle = normalizeString(incoming.title, "");
  const currentTitle = normalizeString(current.title, "");
  const chooseIncomingTitle = incomingTitle && incomingTitle !== "Untitled ChatGPT thread";
  const incomingHasProjectUrl = /\/g\//.test(String(incoming.url || ""));
  const currentHasProjectUrl = /\/g\//.test(String(current.url || ""));
  const preferIncomingUrl = Boolean(
    incoming.url &&
      (!current.url ||
        (incoming.sourceKind === "project" && incomingHasProjectUrl && !currentHasProjectUrl))
  );
  return {
    ...current,
    ...incoming,
    title: chooseIncomingTitle ? incomingTitle : currentTitle || incomingTitle || "Untitled ChatGPT thread",
    url: preferIncomingUrl ? incoming.url : current.url || incoming.url || "",
    updatedAt: mergedUpdatedAt,
    createdAt:
      !currentCreated
        ? incomingCreated
        : !incomingCreated
          ? currentCreated
          : incomingCreated < currentCreated
            ? incomingCreated
            : currentCreated,
    archived: Boolean(current.archived && incoming.archived),
    snippet: current.snippet || incoming.snippet || "",
    displayDate:
      mergedUpdatedAt && mergedUpdatedAt === incomingUpdated
        ? incoming.displayDate || current.displayDate || ""
        : current.displayDate || incoming.displayDate || "",
    projectRank:
      optionalRecentThreadRank(incoming.projectRank) !== null
        ? optionalRecentThreadRank(incoming.projectRank)
        : optionalRecentThreadRank(current.projectRank) !== null
          ? optionalRecentThreadRank(current.projectRank)
          : null,
    projectName: incoming.projectName || current.projectName || "",
    workspaceId: incoming.workspaceId || current.workspaceId || "",
    sourceKind:
      incoming.sourceKind === "project" || current.sourceKind === "project"
        ? "project"
        : "recent",
    source: mergeThreadSourceLabels(current.source, incoming.source),
    discoveredAt:
      String(incoming.discoveredAt || "") > String(current.discoveredAt || "")
        ? String(incoming.discoveredAt || "")
        : String(current.discoveredAt || ""),
  };
}

function sortRecentThreadEntries(entries) {
  return entries.slice().sort((a, b) => {
    const projectDelta = (b.sourceKind === "project" ? 1 : 0) - (a.sourceKind === "project" ? 1 : 0);
    if (projectDelta !== 0) return projectDelta;
    const updatedDelta = String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    if (updatedDelta !== 0) return updatedDelta;
    const createdDelta = String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    if (createdDelta !== 0) return createdDelta;
    const aRank = optionalRecentThreadRank(a.projectRank) ?? Number.POSITIVE_INFINITY;
    const bRank = optionalRecentThreadRank(b.projectRank) ?? Number.POSITIVE_INFINITY;
    if (aRank !== bRank) return aRank - bRank;
    return String(a.title || "").localeCompare(String(b.title || ""));
  });
}

function normalizeChatgptThreadCache(input) {
  const raw = isPlainObject(input) ? input : {};
  const byId = new Map();
  const now = nowIso();
  const rows = Array.isArray(raw.entries) ? raw.entries : [];
  for (const row of rows) {
    const normalized = normalizeRecentThreadEntry(row, now);
    if (!normalized) continue;
    byId.set(normalized.externalId, mergeRecentThreadEntries(byId.get(normalized.externalId), normalized));
  }
  const entries = sortRecentThreadEntries(Array.from(byId.values())).slice(0, CHATGPT_THREAD_CACHE_MAX_ENTRIES);
  return {
    version: CHATGPT_THREAD_CACHE_VERSION,
    updatedAt: normalizeString(raw.updatedAt, now),
    entries,
  };
}

function isDefaultExampleProject(raw, fallback) {
  if (!raw || fallback.id !== "project_example") return false;
  const projectId = normalizeString(raw.id, "");
  const projectName = normalizeString(raw.name, "");
  return projectId === fallback.id && projectName === fallback.name;
}

function shouldRepairExampleProjectRoot(raw, fallback, workspace, repoPath) {
  if (!isDefaultExampleProject(raw, fallback)) return false;
  if (workspace.kind !== "local") return false;
  const localPath = normalizeString(workspace.localPath, "");
  const repoCandidate = normalizeString(repoPath, "");
  return localPath === legacyStandaloneRepoRoot || repoCandidate === legacyStandaloneRepoRoot;
}

function shouldPromoteExampleProjectToDefaultWsl(raw, fallback, workspace, repoPath) {
  const preferredWorkspace = defaultProjectWorkspaceConfig();
  if (preferredWorkspace.kind !== "wsl") return false;
  if (!isDefaultExampleProject(raw, fallback)) return false;
  if (workspace.kind !== "local") return false;
  const localPath = normalizeString(workspace.localPath, "");
  const repoCandidate = normalizeString(repoPath, "");
  return [repoRoot, legacyStandaloneRepoRoot].includes(localPath) || [repoRoot, legacyStandaloneRepoRoot].includes(repoCandidate);
}


const CHAT_THREAD_ROLES = new Set(["review", "brainstorming", "architecture", "research", "debugging", "planning", "custom"]);
const PROMPT_TEMPLATE_ROLES = ["review", "architecture", "brainstorming", "research", "debugging", "planning", "custom"];
const HANDOFF_KINDS = new Set(["file-review", "text-review", "architecture-question", "research-question"]);
const HANDOFF_STATUSES = new Set([
  "staged",
  "copied",
  "opened-thread",
  "submitted-manually",
  "response-pending",
  "response-captured",
  "pasted-back",
  "dismissed",
  "orphaned",
]);

function defaultPromptTemplateText(role) {
  const templates = {
    review:
      "Review {{file.relPath}} for project {{project.name}}. Focus on correctness, risks, missing checks, and concrete next actions. Return concise feedback under the header {{returnHeader}}.\n\nSelected file contents:\n{{file.contents}}",
    architecture:
      "For project {{project.name}}, evaluate this architecture question in the {{thread.role}} thread. Identify tradeoffs, risks, invariants, and a recommended next move.\n\nContext/file: {{file.relPath}}\n{{file.contents}}",
    brainstorming:
      "Brainstorm options for project {{project.name}} without collapsing into implementation yet. Reframe the problem, list promising directions, and call out unknowns.\n\nContext/file: {{file.relPath}}\n{{file.contents}}",
    research:
      "Research/synthesize the question for project {{project.name}}. Separate confirmed facts, assumptions, risks, and follow-up checks.\n\nContext/file: {{file.relPath}}\n{{file.contents}}",
    debugging:
      "Help debug project {{project.name}}. Triage symptoms, likely causes, evidence to collect, and next actions.\n\nContext/file: {{file.relPath}}\n{{file.contents}}",
    planning:
      "Plan the next implementation steps for project {{project.name}}. Keep Codex as the implementation partner and return an actionable sequence.\n\nContext/file: {{file.relPath}}\n{{file.contents}}",
    custom:
      "Use the {{thread.role}} ChatGPT thread for project {{project.name}}.\n\nContext/file: {{file.relPath}}\n{{file.contents}}",
  };
  return templates[role] || templates.custom;
}

function defaultPromptTemplates() {
  const result = {};
  for (const role of PROMPT_TEMPLATE_ROLES) {
    result[role] = {
      id: `template_${role}`,
      role,
      title: `${role[0].toUpperCase()}${role.slice(1)} prompt`,
      text: defaultPromptTemplateText(role),
      updatedAt: nowIso(),
    };
  }
  return result;
}

function normalizeRole(value, fallback = "custom") {
  const candidate = normalizeString(value, fallback).toLowerCase();
  return CHAT_THREAD_ROLES.has(candidate) ? candidate : fallback;
}

function isAllowedChatgptHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return (
    host === "chatgpt.com" ||
    host === "www.chatgpt.com" ||
    host === "chat.openai.com" ||
    host === "www.chat.openai.com"
  );
}

function allowNonChatgptUrls() {
  const raw = typeof process !== "undefined" ? process.env.CODEX_REVIEW_SHELL_ALLOW_NON_CHATGPT_URLS : "";
  return /^(1|true|yes)$/i.test(String(raw || "").trim());
}

function safeChatgptUrl(value, fallback = "https://chatgpt.com/") {
  try {
    const parsed = new URL(normalizeString(value, fallback));
    if (parsed.protocol !== "https:") return fallback;
    if (!allowNonChatgptUrls() && !isAllowedChatgptHost(parsed.hostname)) return fallback;
    return parsed.toString();
  } catch {
    return fallback;
  }
}

function defaultChatThread(overrides = {}) {
  const now = nowIso();
  const role = normalizeRole(overrides.role, "review");
  return {
    id: normalizeString(overrides.id, newId("thread")),
    role,
    title: normalizeString(overrides.title, role === "review" ? "Primary review" : `${role[0].toUpperCase()}${role.slice(1)} thread`),
    url: safeChatgptUrl(overrides.url, "https://chatgpt.com/"),
    notes: normalizeString(overrides.notes, ""),
    isPrimary: Boolean(overrides.isPrimary),
    pinned: Boolean(overrides.pinned),
    archived: Boolean(overrides.archived),
    createdAt: normalizeString(overrides.createdAt, now),
    updatedAt: normalizeString(overrides.updatedAt, now),
    lastOpenedAt: normalizeString(overrides.lastOpenedAt, ""),
  };
}

function roleLabelText(role) {
  return role[0].toUpperCase() + role.slice(1);
}

function defaultLaneBinding(overrides = {}) {
  const now = nowIso();
  const lane = normalizeRole(overrides.lane, "review");
  const rawCodex = isPlainObject(overrides.codexThreadRef) ? overrides.codexThreadRef : {};
  return {
    id: normalizeString(overrides.id, newId("binding")),
    lane,
    label: normalizeString(overrides.label, roleLabelText(lane)),
    codexThreadRef: {
      threadId: normalizeString(rawCodex.threadId, ""),
      originator: normalizeString(rawCodex.originator, ""),
      titleSnapshot: normalizeString(rawCodex.titleSnapshot, ""),
      cwdSnapshot: normalizeString(rawCodex.cwdSnapshot, ""),
      sourceHome: normalizeString(rawCodex.sourceHome, ""),
      sessionFilePath: normalizeString(rawCodex.sessionFilePath, ""),
    },
    chatThreadId: normalizeString(overrides.chatThreadId, ""),
    isDefaultForLane: Boolean(overrides.isDefaultForLane),
    openOnProjectActivate: Boolean(overrides.openOnProjectActivate),
    lastActivatedAt: normalizeString(overrides.lastActivatedAt, ""),
    status: normalizeString(overrides.status, "resolved"),
    createdAt: normalizeString(overrides.createdAt, now),
    updatedAt: normalizeString(overrides.updatedAt, now),
  };
}

function normalizeChatThreads(rawProject, rawChatgpt) {
  const rawThreads = Array.isArray(rawProject.chatThreads) ? rawProject.chatThreads : [];
  const threads = [];
  const ids = new Set();

  for (const item of rawThreads) {
    if (!isPlainObject(item)) continue;
    const role = normalizeRole(item.role, "custom");
    const thread = defaultChatThread({ ...item, role, url: item.url });
    if (!normalizeString(thread.url, "")) continue;
    if (ids.has(thread.id)) thread.id = newId("thread");
    ids.add(thread.id);
    threads.push(thread);
  }

  if (!threads.length) {
    const legacyUrl = safeChatgptUrl(rawChatgpt?.reviewThreadUrl, "https://chatgpt.com/");
    threads.push(
      defaultChatThread({
        id: "thread_review_primary",
        role: "review",
        title: "Primary review",
        url: legacyUrl,
        isPrimary: true,
        pinned: true,
        notes: "Migrated from the legacy single ChatGPT review URL.",
      }),
    );
  }

  let primaryReviewId = "";
  for (const thread of threads) {
    if (thread.role !== "review") thread.isPrimary = false;
    if (thread.role === "review" && thread.isPrimary && !thread.archived && !primaryReviewId) {
      primaryReviewId = thread.id;
    } else if (thread.role === "review" && thread.isPrimary) {
      thread.isPrimary = false;
    }
  }

  if (!primaryReviewId) {
    const candidate = threads.find((thread) => thread.role === "review" && !thread.archived) || threads.find((thread) => thread.role === "review");
    if (candidate) {
      candidate.isPrimary = true;
      primaryReviewId = candidate.id;
    } else {
      const legacyUrl = safeChatgptUrl(rawChatgpt?.reviewThreadUrl, "https://chatgpt.com/");
      const thread = defaultChatThread({ role: "review", title: "Primary review", url: legacyUrl, isPrimary: true, pinned: true });
      threads.unshift(thread);
      primaryReviewId = thread.id;
    }
  }

  return threads;
}

function normalizeLaneBindings(rawBindings, chatThreads) {
  if (!Array.isArray(rawBindings)) return [];
  const chatThreadIds = new Set((chatThreads || []).map((thread) => thread.id));
  const ids = new Set();
  return rawBindings
    .filter(isPlainObject)
    .map((binding) => {
      const normalized = defaultLaneBinding(binding);
      if (ids.has(normalized.id)) normalized.id = newId("binding");
      ids.add(normalized.id);
      if (!chatThreadIds.has(normalized.chatThreadId)) normalized.status = "missing_chatgpt_thread";
      return normalized;
    })
    .filter((binding) => binding.chatThreadId || binding.codexThreadRef.threadId);
}

function primaryReviewThread(project) {
  return (
    project?.chatThreads?.find((thread) => thread.role === "review" && thread.isPrimary && !thread.archived) ||
    project?.chatThreads?.find((thread) => thread.role === "review" && thread.isPrimary) ||
    project?.chatThreads?.find((thread) => thread.role === "review" && !thread.archived) ||
    project?.chatThreads?.find((thread) => thread.role === "review") ||
    project?.chatThreads?.find((thread) => !thread.archived) ||
    project?.chatThreads?.[0]
  );
}

function activeChatThread(project) {
  if (!project) return null;
  const threads = Array.isArray(project.chatThreads) ? project.chatThreads : [];
  return (
    threads.find((thread) => thread.id === project.activeChatThreadId && !thread.archived) ||
    threads.find((thread) => thread.id === project.lastActiveThreadId && !thread.archived) ||
    primaryReviewThread(project) ||
    null
  );
}

function projectActivationBinding(project) {
  const bindings = Array.isArray(project?.laneBindings)
    ? project.laneBindings.filter((binding) => binding?.chatThreadId || binding?.codexThreadRef?.threadId)
    : [];
  if (!bindings.length) return null;
  const activeRole = normalizeRole(activeChatThread(project)?.role, "review");
  return (
    bindings.find((binding) => binding.openOnProjectActivate) ||
    bindings.find((binding) => binding.isDefaultForLane && normalizeRole(binding.lane, "review") === activeRole) ||
    bindings.find((binding) => binding.isDefaultForLane) ||
    bindings[0] ||
    null
  );
}

function applyProjectActivationBinding(project) {
  const binding = projectActivationBinding(project);
  if (!binding) return { project, binding: null };
  const now = nowIso();
  const chatThreadId = normalizeString(binding.chatThreadId, "");
  const hasChatThread = Boolean(project.chatThreads?.some((thread) => thread.id === chatThreadId && !thread.archived));
  const chatThreads = hasChatThread
    ? project.chatThreads.map((thread) =>
      thread.id === chatThreadId ? { ...thread, lastOpenedAt: now, updatedAt: now } : thread,
    )
    : project.chatThreads;
  const laneBindings = (project.laneBindings || []).map((item) =>
    item.id === binding.id ? { ...item, lastActivatedAt: now, updatedAt: now } : item,
  );
  return {
    binding: { ...binding, lastActivatedAt: now, updatedAt: now },
    project: {
      ...project,
      chatThreads,
      laneBindings,
      lastActiveBindingId: binding.id,
      activeChatThreadId: hasChatThread ? chatThreadId : project.activeChatThreadId,
      lastActiveThreadId: hasChatThread ? chatThreadId : project.lastActiveThreadId,
      updatedAt: now,
    },
  };
}

function codexSurfaceOptionsForBinding(binding) {
  const ref = binding?.codexThreadRef || {};
  const threadId = normalizeString(ref.threadId, "");
  if (!threadId) return {};
  const sourceHome = normalizeString(ref.sourceHome, "");
  return {
    codexHome: sourceHome,
    initialThreadId: threadId,
    initialThreadSourceHome: sourceHome,
    initialThreadSessionFilePath: normalizeString(ref.sessionFilePath, ""),
    initialThreadTitle: normalizeString(ref.titleSnapshot, ""),
  };
}

function normalizePromptTemplates(rawTemplates, rawFlow) {
  const defaults = defaultPromptTemplates();
  const result = { ...defaults };
  const source = Array.isArray(rawTemplates)
    ? Object.fromEntries(rawTemplates.filter(isPlainObject).map((template) => [normalizeRole(template.role, "custom"), template]))
    : isPlainObject(rawTemplates)
      ? rawTemplates
      : {};

  for (const role of PROMPT_TEMPLATE_ROLES) {
    const raw = isPlainObject(source[role]) ? source[role] : {};
    const fallbackText = role === "review" ? rawFlow?.reviewPromptTemplate || defaults.review.text : defaults[role].text;
    result[role] = {
      id: normalizeString(raw.id, `template_${role}`),
      role,
      title: normalizeString(raw.title, defaults[role].title),
      text: normalizeString(raw.text, fallbackText),
      updatedAt: normalizeString(raw.updatedAt, nowIso()),
    };
  }
  return result;
}

function normalizeHandoffs(rawHandoffs, projectId, threadIds) {
  if (!Array.isArray(rawHandoffs)) return [];
  const now = nowIso();
  return rawHandoffs
    .filter(isPlainObject)
    .map((raw) => {
      const hasTarget = threadIds.has(raw.targetThreadId);
      const targetThreadId = hasTarget ? raw.targetThreadId : "";
      const normalizedStatus = HANDOFF_STATUSES.has(raw.status) ? raw.status : "staged";
      return {
        id: normalizeString(raw.id, newId("handoff")),
        projectId,
        source: ["codex", "workspace", "human"].includes(raw.source) ? raw.source : "human",
        targetThreadId,
        kind: HANDOFF_KINDS.has(raw.kind) ? raw.kind : "text-review",
        fileRelPath: normalizeString(raw.fileRelPath, ""),
        title: normalizeString(raw.title, "Untitled handoff"),
        promptText: normalizeString(raw.promptText, ""),
        status: hasTarget ? normalizedStatus : "orphaned",
        createdAt: normalizeString(raw.createdAt, now),
        updatedAt: normalizeString(raw.updatedAt, now),
      };
    })
    .filter((item) => item.promptText);
}

function parseWslUncPath(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const colonMatch = text.match(/^wsl:([^:]+):(\/.*)$/i);
  if (colonMatch) {
    return {
      kind: "wsl",
      distro: colonMatch[1] === "default" ? "" : colonMatch[1],
      linuxPath: colonMatch[2] || "/",
      label: "Migrated from WSL display path",
    };
  }
  const normalized = text.replace(/\\/g, "/");
  const match = normalized.match(/^\/?\/?wsl(?:\.localhost)?\$?\/([^/]+)(\/.*)?$/i);
  if (!match) return null;
  return {
    kind: "wsl",
    distro: match[1],
    linuxPath: match[2] || "/",
    label: "Migrated from WSL UNC path",
  };
}

function normalizeLinuxPath(value, fallback = "/home") {
  const text = normalizeString(value, fallback).replace(/\\/g, "/");
  return text.startsWith("/") ? text : `/${text}`;
}

function normalizeWorkspaceConfig(rawWorkspace, repoPath) {
  const legacyWsl = parseWslUncPath(repoPath);
  const raw = isPlainObject(rawWorkspace) ? rawWorkspace : null;

  if (raw?.kind === "wsl") {
    return {
      kind: "wsl",
      distro: normalizeString(raw.distro, legacyWsl?.distro ?? ""),
      linuxPath: normalizeLinuxPath(raw.linuxPath, legacyWsl?.linuxPath ?? "/home"),
      label: normalizeString(raw.label, legacyWsl?.label ?? "WSL workspace"),
    };
  }

  if (!raw && legacyWsl) return legacyWsl;

  return {
    kind: "local",
    localPath: normalizeString(raw?.localPath, normalizeString(repoPath, repoRoot)),
    label: normalizeString(raw?.label, "Local workspace"),
  };
}

function workspaceToRepoPath(workspace, fallback = repoRoot) {
  if (workspace?.kind === "wsl") {
    const distro = workspace.distro || "default";
    return `wsl:${distro}:${workspace.linuxPath}`;
  }
  return normalizeString(workspace?.localPath, fallback);
}

function normalizePlaneRatio(value, fallback, min, max) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(max, Math.max(min, numberValue));
}

function migrateUi(rawUi) {
  const defaults = defaultConfig().ui;
  if (!isPlainObject(rawUi)) return defaults;

  // v0 had only splitRatio for Codex/ChatGPT. v1 introduces a real middle ADEU plane.
  const legacySplit = Number(rawUi.splitRatio);
  const legacyLeft = Number.isFinite(legacySplit) ? Math.min(0.42, Math.max(0.26, legacySplit * 0.72)) : defaults.leftRatio;

  const leftRatio = normalizePlaneRatio(rawUi.leftRatio, legacyLeft, 0.2, 0.58);
  const middleRatio = normalizePlaneRatio(rawUi.middleRatio, defaults.middleRatio, 0.22, 0.5);
  const total = leftRatio + middleRatio;

  if (total > 0.78) {
    const scale = 0.78 / total;
    return {
      leftRatio: Math.max(0.2, leftRatio * scale),
      middleRatio: Math.max(0.22, middleRatio * scale),
    };
  }

  return { leftRatio, middleRatio };
}

function normalizeProject(input, index = 0) {
  const fallback = defaultConfig().projects[0];
  const raw = isPlainObject(input) ? input : {};
  const surfaceBinding = isPlainObject(raw.surfaceBinding) ? raw.surfaceBinding : {};
  const rawCodex = isPlainObject(surfaceBinding.codex) ? surfaceBinding.codex : {};
  const rawChatgpt = isPlainObject(surfaceBinding.chatgpt) ? surfaceBinding.chatgpt : {};
  const rawFlow = isPlainObject(raw.flowProfile) ? raw.flowProfile : {};
  const codexMode = normalizeCodexMode(rawCodex.mode);
  const codexRuntimeMode = normalizeDirectRuntimeModeForStatus(rawCodex.runtimeMode);
  const directTransport = normalizeDirectExperimentalTransport(rawCodex.directTransport);
  const directTier = normalizeDirectExperimentalRuntimeTier(
    rawCodex.directTier || rawCodex.activationTier || rawCodex.runtimeTier,
    codexRuntimeMode === "direct-experimental" && directTransport === "live-text" ? "implementation-lane" : "none",
  );
  const patterns = Array.isArray(rawFlow.watchedFilePatterns)
    ? rawFlow.watchedFilePatterns.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
    : fallback.flowProfile.watchedFilePatterns;

  const id = normalizeString(raw.id, index === 0 ? fallback.id : newId("project"));
  const now = nowIso();
  const legacyRepoPath = normalizeString(raw.repoPath, repoRoot);
  let workspace = normalizeWorkspaceConfig(raw.workspace, legacyRepoPath);
  let repoPath = workspaceToRepoPath(workspace, legacyRepoPath);
  if (shouldRepairExampleProjectRoot(raw, fallback, workspace, repoPath)) {
    workspace = { ...workspace, localPath: repoRoot };
    repoPath = repoRoot;
  }
  if (shouldPromoteExampleProjectToDefaultWsl(raw, fallback, workspace, repoPath)) {
    workspace = defaultProjectWorkspaceConfig();
    repoPath = defaultProjectRepoPath(workspace);
  }
  const chatThreads = normalizeChatThreads(raw, rawChatgpt);
  const threadIds = new Set(chatThreads.map((thread) => thread.id));
  const activeThreadCandidate = normalizeString(raw.activeChatThreadId, normalizeString(raw.lastActiveThreadId, ""));
  const activeThreadId = threadIds.has(activeThreadCandidate) && !chatThreads.find((thread) => thread.id === activeThreadCandidate)?.archived
    ? activeThreadCandidate
    : primaryReviewThread({ chatThreads })?.id || chatThreads[0]?.id;
  const primaryReview = primaryReviewThread({ chatThreads });
  const laneBindings = normalizeLaneBindings(raw.laneBindings, chatThreads);
  const promptTemplates = normalizePromptTemplates(raw.promptTemplates, rawFlow);
  const ignoredWatchedArtifactPaths = Array.isArray(raw.ignoredWatchedArtifactPaths)
    ? raw.ignoredWatchedArtifactPaths.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
    : [];

  return {
    id,
    name: normalizeString(raw.name, index === 0 ? fallback.name : `Project ${index + 1}`),
    repoPath,
    workspace,
    surfaceBinding: {
      codex: {
        mode: codexMode,
        bindingProvider: normalizeCodexBindingProvider(
          rawCodex.bindingProvider || (typeof rawCodex.provider === "string" ? rawCodex.provider : ""),
          codexRuntimeMode === "legacy-app-server" ? "codex-compatible" : "direct-chatgpt-codex",
        ),
        runtimeMode: codexRuntimeMode,
        directTier,
        directTransport,
        runtime: normalizeCodexRuntime(normalizeString(rawCodex.runtime, defaultCodexRuntimeForWorkspace(workspace))),
        profileId: normalizeString(rawCodex.profileId, ""),
        target: normalizeString(rawCodex.target, codexMode === "url" ? "http://127.0.0.1:3000" : ""),
        binaryPath: normalizeString(rawCodex.binaryPath, "codex"),
        model: normalizeString(rawCodex.model, ""),
        reasoningEffort: normalizeReasoningEffort(rawCodex.reasoningEffort),
        spawnAgentModelOverrides: rawCodex.spawnAgentModelOverrides === true,
        label: normalizeString(rawCodex.label, codexMode === "managed" ? "Managed Codex lane" : "Codex target"),
        provider: normalizeCodexProviderConfig((isPlainObject(rawCodex.provider) ? rawCodex.provider : null) || {
          kind: rawCodex.providerKind,
          flavor: rawCodex.providerFlavor,
          configuredFlavor: rawCodex.configuredFlavor,
          connectionPath: rawCodex.connectionPath,
        }),
        usageLedger: normalizeUsageLedgerConfig(rawCodex.usageLedger || rawCodex.usage_ledger),
        remoteAuth: normalizeRemoteAuthConfig(rawCodex.remoteAuth),
      },
      chatgpt: {
        reviewThreadUrl: safeChatgptUrl(primaryReview?.url || rawChatgpt.reviewThreadUrl, "https://chatgpt.com/"),
        reduceChrome: rawChatgpt.reduceChrome !== false,
        downloadMacro: normalizeDownloadMacroConfig(rawChatgpt.downloadMacro),
      },
    },
    chatThreads,
    activeChatThreadId: activeThreadId,
    lastActiveThreadId: normalizeString(raw.lastActiveThreadId, activeThreadId),
    laneBindings,
    lastActiveBindingId: normalizeString(raw.lastActiveBindingId, ""),
    promptTemplates,
    flowProfile: {
      reviewPromptTemplate: normalizeString(rawFlow.reviewPromptTemplate, promptTemplates.review.text),
      watchedFilePatterns: patterns.length ? patterns : fallback.flowProfile.watchedFilePatterns,
      returnHeader: normalizeString(rawFlow.returnHeader, fallback.flowProfile.returnHeader),
      handoffMode: normalizeString(rawFlow.handoffMode, "assisted"),
    },
    handoffs: normalizeHandoffs(raw.handoffs, id, threadIds),
    ignoredWatchedArtifactPaths,
    createdAt: normalizeString(raw.createdAt, now),
    updatedAt: normalizeString(raw.updatedAt, now),
  };
}

function normalizeConfig(input) {
  const defaults = defaultConfig();
  const raw = isPlainObject(input) ? input : {};
  const rawProjects = Array.isArray(raw.projects) ? raw.projects : defaults.projects;
  const projects = rawProjects.map((project, index) => normalizeProject(project, index));
  const dedupedProjects = [];
  const ids = new Set();

  for (const project of projects) {
    let id = project.id;
    if (ids.has(id)) id = newId("project");
    ids.add(id);
    dedupedProjects.push({ ...project, id });
  }

  if (!dedupedProjects.length) dedupedProjects.push(defaults.projects[0]);

  const selectedCandidate = normalizeString(raw.selectedProjectId, dedupedProjects[0].id);
  const selectedProjectId = dedupedProjects.some((project) => project.id === selectedCandidate)
    ? selectedCandidate
    : dedupedProjects[0].id;

  return {
    version: 5,
    selectedProjectId,
    ui: migrateUi(raw.ui),
    runtimeDefaults: normalizeRuntimeDefaults(raw.runtimeDefaults),
    codexThreadRuntimeDefaults: normalizeCodexThreadRuntimeDefaults(raw.codexThreadRuntimeDefaults),
    chatgptDownloads: normalizeChatgptDownloadsConfig(raw.chatgptDownloads),
    projects: dedupedProjects,
  };
}

async function loadConfig() {
  if (configCache) return configCache;
  const targetPath = configPath();
  try {
    const raw = await fs.readFile(targetPath, "utf8");
    try {
      configCache = normalizeConfig(JSON.parse(raw));
      return configCache;
    } catch {
      await preserveMalformedJson(targetPath, raw, "json-parse");
      configCache = normalizeConfig(defaultConfig());
      await saveConfig(configCache);
      return configCache;
    }
  } catch (error) {
    if (error && error.code === "ENOENT") {
      configCache = normalizeConfig(defaultConfig());
      await saveConfig(configCache);
      return configCache;
    }
    throw error;
  }
}

async function saveConfig(nextConfig) {
  const normalized = normalizeConfig(nextConfig);
  configCache = normalized;
  await writeTextAtomic(configPath(), `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

function codexRuntimePreferenceLookup(config, payload = {}) {
  const normalizedConfig = config || {};
  const runtimeDefaults = normalizeRuntimeDefaults(normalizedConfig.runtimeDefaults);
  const threadDefaults = normalizeCodexThreadRuntimeDefaults(normalizedConfig.codexThreadRuntimeDefaults);
  const parts = {
    projectId: normalizeString(payload.projectId, ""),
    threadId: normalizeString(payload.threadId, ""),
    sourceHome: normalizeString(payload.sourceHome, ""),
    sessionFilePath: normalizeString(payload.sessionFilePath, ""),
  };
  const threadKey = codexThreadRuntimePreferenceKey(parts);
  const threadMatch = findCodexThreadRuntimePreference(threadDefaults, parts);
  return {
    globalDefaults: runtimeDefaults.codex,
    threadDefaults: threadMatch.value,
    threadKey,
    resolvedThreadKey: threadMatch.key || "",
    threadMatch: threadMatch.match,
  };
}

async function updateCodexRuntimePreferences(payload = {}) {
  const scope = normalizeString(payload.scope, "");
  const config = await loadConfig();
  const runtimeDefaults = normalizeRuntimeDefaults(config.runtimeDefaults);
  const codexThreadRuntimeDefaults = normalizeCodexThreadRuntimeDefaults(config.codexThreadRuntimeDefaults);

  if (scope === "global-access") {
    runtimeDefaults.codex = {
      approvalPolicy: normalizeApprovalPolicy(payload.approvalPolicy),
      sandboxMode: normalizeSandboxMode(payload.sandboxMode),
    };
  } else if (scope === "thread-model") {
    const projectId = normalizeString(payload.projectId, "");
    const threadId = normalizeString(payload.threadId, "");
    const sourceHome = normalizeString(payload.sourceHome, "");
    const sessionFilePath = normalizeString(payload.sessionFilePath, "");
    const threadKey = codexThreadRuntimePreferenceKey({ projectId, threadId, sourceHome, sessionFilePath });
    if (!threadKey) throw new Error("Missing project/thread identity for Codex runtime preferences.");
    const model = normalizeString(payload.model, "");
    const reasoningEffort = normalizeReasoningEffort(payload.reasoningEffort);
    if (model || reasoningEffort) {
      codexThreadRuntimeDefaults[threadKey] = {
        projectId,
        threadId,
        sourceHome,
        sessionFilePath,
        model,
        reasoningEffort,
        updatedAt: nowIso(),
      };
    } else {
      delete codexThreadRuntimeDefaults[threadKey];
    }
  } else {
    throw new Error(`Unsupported Codex runtime preference scope: ${scope || "missing"}.`);
  }

  const saved = await saveConfig({
    ...config,
    runtimeDefaults,
    codexThreadRuntimeDefaults,
  });
  emitShellEvent({ type: "config-updated", reason: "codex-runtime-preferences", config: saved, at: nowIso() });
  return {
    ok: true,
    preferences: codexRuntimePreferenceLookup(saved, payload),
  };
}

async function loadChatgptThreadCache() {
  if (chatgptThreadCache) return chatgptThreadCache;
  const targetPath = chatgptThreadCachePath();
  try {
    const raw = await fs.readFile(targetPath, "utf8");
    try {
      chatgptThreadCache = normalizeChatgptThreadCache(JSON.parse(raw));
      return chatgptThreadCache;
    } catch {
      await preserveMalformedJson(targetPath, raw, "json-parse");
      chatgptThreadCache = normalizeChatgptThreadCache({ entries: [] });
      return chatgptThreadCache;
    }
  } catch (error) {
    if (error && error.code === "ENOENT") {
      chatgptThreadCache = normalizeChatgptThreadCache({ entries: [] });
      return chatgptThreadCache;
    }
    throw error;
  }
}

async function saveChatgptThreadCache(nextCache) {
  const normalized = normalizeChatgptThreadCache(nextCache);
  chatgptThreadCache = normalized;
  await writeTextAtomic(chatgptThreadCachePath(), `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

function getSelectedProject(config) {
  return config.projects.find((project) => project.id === config.selectedProjectId) ?? config.projects[0];
}

async function getProjectById(projectId) {
  const config = await loadConfig();
  const project = config.projects.find((item) => item.id === projectId) ?? getSelectedProject(config);
  if (!project) throw new Error("No project is configured.");
  return project;
}

function sanitizeBounds(bounds) {
  return {
    x: Math.max(0, Math.floor(Number(bounds?.x) || 0)),
    y: Math.max(0, Math.floor(Number(bounds?.y) || 0)),
    width: Math.max(1, Math.floor(Number(bounds?.width) || 1)),
    height: Math.max(1, Math.floor(Number(bounds?.height) || 1)),
  };
}

function offscreenBounds() {
  return { x: -12000, y: -12000, width: 1, height: 1 };
}

function applySurfaceBounds() {
  if (!codexView || !chatgptView) return;
  if (!surfacesVisible || !lastSurfaceBounds) {
    codexView.setBounds(offscreenBounds());
    chatgptView.setBounds(offscreenBounds());
    middleWebHost?.setNativeSurfacesVisible(false);
    return;
  }
  codexView.setBounds(sanitizeBounds(lastSurfaceBounds.codex));
  chatgptView.setBounds(sanitizeBounds(lastSurfaceBounds.chatgpt));
  middleWebHost?.setNativeSurfacesVisible(true);
}

function emitToShell(channel, payload) {
  if (!shellView || shellView.webContents.isDestroyed()) return;
  shellView.webContents.send(channel, payload);
}

function emitShellEvent(payload) {
  emitToShell("shell:event", payload);
}

function ensureMiddleWebHost() {
  if (!middleWebHost) {
    middleWebHost = new MiddleWebHost({ emitShellEvent });
    middleWebHost.setHistoryStorePath(middleWebHistoryPath());
  }
  return middleWebHost;
}

function viewForZoomPlane(plane) {
  if (plane === "codex") return codexView;
  if (plane === "chatgpt") return chatgptView;
  return null;
}

function setNativePlaneZoom(plane, factor) {
  const normalizedPlane = plane === "chatgpt" ? "chatgpt" : "codex";
  const zoomFactor = clampZoomFactor(factor);
  nativePlaneZoomFactors[normalizedPlane] = zoomFactor;
  const view = viewForZoomPlane(normalizedPlane);
  if (view?.webContents && !view.webContents.isDestroyed()) view.webContents.setZoomFactor(zoomFactor);
  emitShellEvent({
    type: "plane-zoom-state",
    plane: normalizedPlane,
    zoomFactor,
    at: nowIso(),
  });
  return { ok: true, plane: normalizedPlane, zoomFactor };
}

function adjustPlaneZoom(plane, direction) {
  if (plane === "middle") return ensureMiddleWebHost().adjustZoom(direction);
  const normalizedPlane = plane === "chatgpt" ? "chatgpt" : "codex";
  return setNativePlaneZoom(
    normalizedPlane,
    nativePlaneZoomFactors[normalizedPlane] + zoomDeltaForDirection(direction),
  );
}

function nextSurfaceActivationEpoch() {
  surfaceActivationEpoch += 1;
  return surfaceActivationEpoch;
}

function isStaleSurfaceActivationEpoch(epoch) {
  return Number.isFinite(Number(epoch)) && Number(epoch) > 0 && Number(epoch) !== surfaceActivationEpoch;
}

const CODEX_THREAD_RESTORE_SUCCESS_STATUSES = new Set(["rendered_stored", "attached_live"]);
const CODEX_THREAD_RESTORE_IN_FLIGHT_STATUSES = new Set(["requested", "dispatched", "hint", "binding"]);

function codexRestoreTargetTime(target) {
  const parsed = Date.parse(target?.observedAt || target?.at || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeCodexThreadRestoreTarget(payload = {}, fallback = {}) {
  const status = normalizeString(payload.status || fallback.status, "hint");
  const projectId = normalizeString(payload.projectId || fallback.projectId, "");
  const threadId = normalizeString(payload.threadId || fallback.threadId, "");
  const sourceHome = normalizeString(payload.sourceHome ?? fallback.sourceHome, "");
  const sessionFilePath = normalizeString(payload.sessionFilePath ?? fallback.sessionFilePath, "");
  const title = normalizeString(payload.title || fallback.title || threadId, "");
  const observedAt = normalizeString(payload.observedAt || payload.at || fallback.observedAt || fallback.at, nowIso());
  const usableForRestore = Boolean(
    projectId &&
    threadId &&
    (CODEX_THREAD_RESTORE_SUCCESS_STATUSES.has(status) || CODEX_THREAD_RESTORE_IN_FLIGHT_STATUSES.has(status)),
  );
  return {
    projectId,
    threadId,
    sourceHome,
    sessionFilePath,
    title,
    status,
    evidence: normalizeString(payload.evidence || fallback.evidence, ""),
    errorDescription: normalizeString(payload.errorDescription || payload.error || fallback.errorDescription, ""),
    activationEpoch: Number(payload.activationEpoch || fallback.activationEpoch) || 0,
    observedAt,
    usableForRestore,
  };
}

function rememberCodexThreadRestoreTarget(payload = {}) {
  const target = normalizeCodexThreadRestoreTarget(payload);
  if (!target.projectId || !target.threadId) return null;
  if (CODEX_THREAD_RESTORE_SUCCESS_STATUSES.has(target.status) && target.usableForRestore) {
    lastSuccessfulCodexThreadByProject.set(target.projectId, target);
    latestCodexOpenTargetByProject.set(target.projectId, target);
    return target;
  }
  if (CODEX_THREAD_RESTORE_IN_FLIGHT_STATUSES.has(target.status) && target.usableForRestore) {
    latestCodexOpenTargetByProject.set(target.projectId, target);
    return target;
  }
  if (target.status === "failed") {
    latestCodexThreadFailureByProject.set(target.projectId, target);
    const latestOpen = latestCodexOpenTargetByProject.get(target.projectId);
    if (
      latestOpen?.threadId === target.threadId &&
      (!target.activationEpoch || !latestOpen.activationEpoch || target.activationEpoch >= latestOpen.activationEpoch)
    ) {
      latestCodexOpenTargetByProject.delete(target.projectId);
    }
  }
  return target;
}

function codexRestoreTargetFromBinding(project) {
  const binding = projectActivationBinding(project);
  const ref = binding?.codexThreadRef || {};
  const threadId = normalizeString(ref.threadId, "");
  if (!project?.id || !threadId) return null;
  return normalizeCodexThreadRestoreTarget({
    projectId: project.id,
    threadId,
    sourceHome: ref.sourceHome,
    sessionFilePath: ref.sessionFilePath,
    title: ref.titleSnapshot,
    status: "binding",
    evidence: "project-lane-binding",
  });
}

function codexRestoreTargetFromHint(project, hint = {}) {
  if (!project?.id || !isPlainObject(hint)) return null;
  const target = normalizeCodexThreadRestoreTarget({
    projectId: hint.projectId || project.id,
    threadId: hint.threadId,
    sourceHome: hint.sourceHome,
    sessionFilePath: hint.sessionFilePath,
    title: hint.title,
    status: "hint",
    evidence: "renderer-restore-hint",
  });
  return target.usableForRestore ? target : null;
}

function chooseCodexThreadRestoreTarget(project, hint = {}) {
  const projectId = normalizeString(project?.id, "");
  if (!projectId) return null;
  const lastSuccess = lastSuccessfulCodexThreadByProject.get(projectId) || null;
  const latestOpen = latestCodexOpenTargetByProject.get(projectId) || null;
  if (
    latestOpen?.usableForRestore &&
    CODEX_THREAD_RESTORE_IN_FLIGHT_STATUSES.has(latestOpen.status) &&
    (!lastSuccess || codexRestoreTargetTime(latestOpen) > codexRestoreTargetTime(lastSuccess))
  ) {
    return latestOpen;
  }
  if (lastSuccess?.usableForRestore) return lastSuccess;
  const hinted = codexRestoreTargetFromHint(project, hint);
  if (hinted) return hinted;
  return codexRestoreTargetFromBinding(project);
}

function ensureWorkspaceBackendManager() {
  if (workspaceBackends) return workspaceBackends;
  workspaceBackends = new WorkspaceBackendManager({
    agentPath: workspaceAgentPath,
    fallbackRoot: repoRoot,
  });
  workspaceBackends.on("status", (payload) => {
    emitShellEvent({ type: "backend-status", ...payload });
    const projectId = payload?.session?.projectId || "";
    if (
      projectId &&
      currentProject?.id === projectId &&
      codexView?.webContents &&
      !codexView.webContents.isDestroyed()
    ) {
      codexView.webContents.send("codex-surface:event", {
        type: "workspace-status",
        session: payload.session,
        at: payload.at || nowIso(),
      });
    }
  });
  workspaceBackends.on("agent-event", (payload) => {
    emitShellEvent({ type: "backend-agent-event", ...payload });
  });
  return workspaceBackends;
}

function ensureThreadAnalyticsStore() {
  if (threadAnalyticsStore) return threadAnalyticsStore;
  threadAnalyticsStore = new ThreadAnalyticsStore(threadAnalyticsDbPath());
  return threadAnalyticsStore;
}

function ensureDirectAuthController() {
  if (directAuthController) return directAuthController;
  directAuthController = createDirectAuthIpcController({
    rootDir: directAuthRootDir(),
    fallbackStore: () => ensureDirectCodexCliAuthStore(),
    loginStarter: (payload, controller) => ensureDirectAuthLoginCoordinator().beginLogin(payload, controller),
    manualLoginCompleter: (payload, controller) => ensureDirectAuthLoginCoordinator().completeManualLogin(payload, controller),
  });
  return directAuthController;
}

function ensureDirectAuthLoginCoordinator() {
  if (directAuthLoginCoordinator) return directAuthLoginCoordinator;
  directAuthLoginCoordinator = createDirectAuthLoginCoordinator({
    openExternal: (url) => shell.openExternal(url),
  });
  return directAuthLoginCoordinator;
}

function ensureDirectCodexCliAuthStore() {
  if (directCodexCliAuthStore) return directCodexCliAuthStore;
  directCodexCliAuthStore = createCodexCliAuthStore();
  return directCodexCliAuthStore;
}

function directRuntimeAuthStore() {
  return createDirectAuthCompositeStore({
    primaryStore: () => ensureDirectAuthController().activeStore(),
    fallbackStore: () => ensureDirectCodexCliAuthStore(),
  });
}

function directRuntimeAuthRefreshController() {
  return {
    activeStore: () => directRuntimeAuthStore(),
  };
}

function refreshDirectRuntimeCredentials(options = {}) {
  return ensureDirectAuthLoginCoordinator().refreshCredentials(directRuntimeAuthRefreshController(), options);
}

function ensureDirectProviderMetadataAdapter() {
  if (directProviderMetadataAdapter) return directProviderMetadataAdapter;
  directProviderMetadataAdapter = new DirectServerMetadataAdapter({
    rootDir: directProviderMetadataRootDir(),
    authStoreFactory: () => directRuntimeAuthStore(),
    refreshCredentials: (options) => refreshDirectRuntimeCredentials(options),
  });
  return directProviderMetadataAdapter;
}

function directProviderMetadataStatusForProject(project = {}) {
  try {
    return ensureDirectProviderMetadataAdapter().cachedStatus(project?.id || "");
  } catch (error) {
    return {
      profile: null,
      driftReport: {
        schema: "direct_metadata_drift_report@1",
        projectId: normalizeString(project?.id, ""),
        observedAt: nowIso(),
        status: "unavailable",
        cacheState: "missing",
        fetchStatus: "failed",
        source: normalizeString(error?.message, "metadata_cache_unavailable"),
        validation: { ok: false, errors: ["metadata_cache_unavailable"], warnings: [] },
        unknownEnums: [],
        missingFields: [],
        changedDefaults: [],
        rawTextIncluded: false,
        rawPathIncluded: false,
        rawSecretIncluded: false,
      },
      cacheState: "missing",
      error,
    };
  }
}

async function refreshDirectProviderMetadataForProject(project = {}) {
  try {
    return await ensureDirectProviderMetadataAdapter().refreshForProject(project);
  } catch (error) {
    return {
      ...directProviderMetadataStatusForProject(project),
      cacheState: "failed",
      error,
    };
  }
}

function ensureDirectCodexProfileDoc() {
  if (directCodexProfileDoc) return directCodexProfileDoc;
  directCodexProfileDoc = loadDirectCodexProfile();
  return directCodexProfileDoc;
}

function ensureDirectSessionStore() {
  if (directSessionStore) return directSessionStore;
  directSessionStore = new DirectSessionStore({ rootDir: directSessionRootDir() });
  try {
    directSessionStore.ensure();
    directSessionStore.recoverInterruptedTurns();
  } catch (error) {
    console.warn("[direct] session recovery failed", error);
  }
  return directSessionStore;
}

function ensureDirectThreadStore() {
  if (directThreadStore) return directThreadStore;
  directThreadStore = new DirectThreadStore({
    rootDir: directSessionRootDir(),
    mode: "index_only",
  });
  return directThreadStore;
}

function ensureDirectWorkThreadStore() {
  if (directWorkThreadStore) return directWorkThreadStore;
  directWorkThreadStore = new DirectWorkThreadRegistryStore({
    rootDir: directSessionRootDir(),
  });
  return directWorkThreadStore;
}

function ensureDirectAgentRegistryStore() {
  if (directAgentRegistryStore) return directAgentRegistryStore;
  directAgentRegistryStore = new DirectAgentRegistryStore({
    rootDir: directSessionRootDir(),
  });
  return directAgentRegistryStore;
}

function ensureDirectThreadWorkbenchController() {
  if (directThreadWorkbenchController) return directThreadWorkbenchController;
  directThreadWorkbenchController = new DirectThreadWorkbenchController({
    threadStore: ensureDirectThreadStore(),
    sessionStore: ensureDirectSessionStore(),
    workThreadStore: ensureDirectWorkThreadStore(),
    projectResolver: (projectId) => getProjectById(projectId),
    liveTextController: () => ensureDirectLiveTextController(),
  });
  return directThreadWorkbenchController;
}

function ensureDirectMetaSessionStore() {
  if (directMetaSessionStore) return directMetaSessionStore;
  directMetaSessionStore = new DirectMetaSessionStore({
    rootDir: directMetaSessionRootDir(),
    ensureRoot: false,
  });
  return directMetaSessionStore;
}

function buildDirectMetaSessionStatusForProject(project, options = {}) {
  const projectId = normalizeString(project?.id, "");
  const projectBindingDigest = project ? stableDigest({
    projectId: project.id,
    codexBinding: project.surfaceBinding?.codex || {},
  }) : "";
  try {
    const projection = ensureDirectMetaSessionStore().readLatestStatusProjection({
      metaSessionId: options?.metaSessionId,
    });
    const status = {
      ...projection,
      projectId,
      projectBindingDigest,
      actionability: {
        actionable: false,
        allowedActions: [],
      },
    };
    assertMetaSessionRendererSafe(status);
    return status;
  } catch {
    const status = {
      ...buildDirectMetaSessionStatusProjection({
        metaSessionId: normalizeString(options?.metaSessionId, ""),
        health: "degraded",
        ledgerStatus: { ok: false, ledgerHeadDigest: "", events: [] },
        currentPointers: null,
        sessionDir: "",
        details: {
          summaryRows: [
            { label: "Session", value: "unavailable", state: "missing" },
            { label: "Status", value: "read-only", state: "ok" },
          ],
          routeSummary: { total: 0, recentWindowCount: 0, proposed: 0, accepted: 0, dispatched: 0, dispatchBlocked: 0, latest: [] },
          guardDecisionSummary: { total: 0, recentWindowCount: 0, allowShadow: 0, denyShadow: 0, askHumanShadow: 0, reclassifyShadow: 0, stopShadow: 0 },
          attemptFailureSummary: { total: 0, recentWindowCount: 0, latestBlockerCodes: ["status_projection_unavailable"] },
          availableMetaSessions: [],
          rendererSafe: true,
        },
      }),
      projectId,
      projectBindingDigest,
      unavailableReason: "meta_session_status_unavailable",
      actionability: {
        actionable: false,
        allowedActions: [],
      },
    };
    assertMetaSessionRendererSafe(status);
    return status;
  }
}

function directThreadStoreStatus() {
  try {
    return ensureDirectThreadStore().status();
  } catch (error) {
    return {
      schema: "direct_thread_store_status@1",
      available: false,
      status: "disabled",
      mode: "disabled",
      schemaVersion: "",
      rootExposed: false,
      dbPathExposed: false,
      projectionsHealthy: false,
      contextBuildsAllowed: false,
      threadCount: 0,
      rolloutCount: 0,
      turnCount: 0,
      operationCount: 0,
      projectionCount: 0,
      contextBuildCount: 0,
      requestManifestCount: 0,
      contextPolicyCount: 0,
      context: {
        contextBuildsAllowed: false,
        contextBuildRequiredForNewTurns: false,
        reasonIfBlocked: "direct_thread_store_unavailable",
      },
      recovery: {
        error: normalizeString(error?.message, "direct_thread_store_unavailable"),
      },
    };
  }
}

function ensureDirectActivationStore() {
  if (directActivationStore) return directActivationStore;
  directActivationStore = new DirectExperimentalActivationStore({ rootDir: directSessionRootDir() });
  return directActivationStore;
}

function ensureDirectImportController() {
  if (directImportController) return directImportController;
  directImportController = new DirectImportController({
    sessionStore: ensureDirectSessionStore(),
    projectResolver: (projectId) => getProjectById(projectId),
    liveTextController: () => ensureDirectLiveTextController(),
    checkpointContinuationEvidenceResolver: () => ({
      accepted: process.env.CODEX_DIRECT_IMPORT_CHECKPOINT_PROBE === "1",
      status: process.env.CODEX_DIRECT_IMPORT_CHECKPOINT_PROBE === "1" ? "runtime_probed" : "profile_required",
      evidenceState: process.env.CODEX_DIRECT_IMPORT_CHECKPOINT_PROBE === "1" ? "runtime_probed" : "unknown",
      reason: process.env.CODEX_DIRECT_IMPORT_CHECKPOINT_PROBE === "1" ? "" : "checkpoint_request_shape_unaccepted",
    }),
  });
  return directImportController;
}

function ensureDirectLiveProbeEvidenceStore() {
  if (directLiveProbeEvidenceStore) return directLiveProbeEvidenceStore;
  directLiveProbeEvidenceStore = new DirectLiveProbeEvidenceStore({
    rootDir: directLiveProbeEvidenceRootDir(),
  });
  return directLiveProbeEvidenceStore;
}

function ensureDirectImplementationProofEvidenceStore() {
  if (directImplementationProofEvidenceStore) return directImplementationProofEvidenceStore;
  directImplementationProofEvidenceStore = new DirectImplementationProofEvidenceStore({
    rootDir: directImplementationProofRunsRootDir(),
  });
  return directImplementationProofEvidenceStore;
}

function ensureDirectFixtureController() {
  if (directFixtureController) return directFixtureController;
  directFixtureController = new DirectFixtureController({
    sessionStore: ensureDirectSessionStore(),
    profileDoc: ensureDirectCodexProfileDoc(),
  });
  return directFixtureController;
}

function assistantTextFromDirectProviderResult(result = {}) {
  return (Array.isArray(result.normalizedEvents) ? result.normalizedEvents : [])
    .filter((event) => event?.type === "message_delta")
    .map((event) => normalizeString(event?.text, ""))
    .join("");
}

async function runDirectNativeChildProviderTurn(input = {}) {
  const result = await runImplementationToolInitialProbe({
    authStore: directRuntimeAuthStore(),
    refreshCredentials: () => refreshDirectRuntimeCredentials(),
    profileDoc: ensureDirectCodexProfileDoc(),
    requestBody: input.requestBody,
  });
  const terminal = result.terminal || {};
  const usageEvent = [...(Array.isArray(result.normalizedEvents) ? result.normalizedEvents : [])]
    .reverse()
    .find((event) => event?.type === "usage_delta" && event.usage);
  const usage = usageEvent?.usage;
  return {
    ok: terminal.state === "completed",
    terminalState: terminal.state === "aborted"
      ? "cancelled"
      : terminal.state === "completed"
        ? "completed"
        : "failed",
    errorCode: terminal.state === "tool_waiting"
      ? "direct_child_tools_not_declared"
      : normalizeString(terminal.error?.code || result.error?.code, ""),
    outputText: assistantTextFromDirectProviderResult(result),
    responseId: normalizeString(result.responseId, ""),
    tokenUsage: usage
      ? {
          inputTokens: Number(usage.inputTokens || 0),
          cachedInputTokens: Number(usage.cachedInputTokens || 0),
          outputTokens: Number(usage.outputTokens || 0),
          reasoningOutputTokens: Number(usage.reasoningTokens || 0),
          totalTokens: Number(usage.totalTokens || 0),
        }
      : {},
  };
}

function ensureDirectNativeAgentPool() {
  if (directNativeAgentPool) return directNativeAgentPool;
  directNativeAgentPool = new DirectNativeAgentPool({
    maxActiveChildren: Number(
      process.env.CODEX_DIRECT_SUB_AGENT_MAX_ACTIVE || 8,
    ),
    maxQueuedChildren: Number(
      process.env.CODEX_DIRECT_SUB_AGENT_MAX_QUEUED || 64,
    ),
    defaultModel: normalizeString(
      process.env.CODEX_DIRECT_SUB_AGENT_DEFAULT_MODEL,
      "gpt-5.6-sol",
    ),
    defaultReasoningEffort: normalizeString(
      process.env.CODEX_DIRECT_SUB_AGENT_DEFAULT_REASONING_EFFORT,
      "medium",
    ),
    providerTurnRunner: (input) => runDirectNativeChildProviderTurn(input),
  });
  return directNativeAgentPool;
}

function ensureDirectLiveTextController() {
  if (directLiveTextController) return directLiveTextController;
  directLiveTextController = new DirectLiveTextController({
    sessionStore: ensureDirectSessionStore(),
    directThreadStore: ensureDirectThreadStore(),
    workThreadStore: ensureDirectWorkThreadStore(),
    profileDoc: ensureDirectCodexProfileDoc(),
    authStore: () => directRuntimeAuthStore(),
    refreshCredentials: () => refreshDirectRuntimeCredentials(),
    modelEvidenceResolver: (context) => ensureDirectLiveProbeEvidenceStore().resolveModelEvidence(context),
    implementationProofEvidenceResolver: (context) => ensureDirectImplementationProofEvidenceStore().resolveScopedProofEvidence(context),
    activationStatusResolver: (project) => directActivationEvaluationForProject(project).status,
    subAgentPool: ensureDirectNativeAgentPool(),
    subAgentStatusSurfaceResolver: (context) => directSubAgentStatusSurfaceFor(context),
    externalCapabilityProfileResolver: (context) => buildDirectExternalCapabilityProfileForProject(context),
    providerHostedToolsStatusResolver: (context) => buildDirectProviderHostedToolsStatusForProject(context),
    workspaceRequest: (project, method, params, timeoutMs) => requestWorkspace(project, method, params, timeoutMs),
  });
  return directLiveTextController;
}

function currentLegacyAppServerSnapshot() {
  return codexAppServer?.snapshot?.() || null;
}

function latestDirectSessionForProject(sessionStore, projectId) {
  try {
    const index = sessionStore?.ensure?.() || sessionStore?.readIndex?.() || {};
    const sessions = Array.isArray(index.sessions) ? index.sessions : [];
    return sessions.find((session) => normalizeString(session.projectId, "") === projectId) || null;
  } catch {
    return null;
  }
}

function codexAgentGraphCacheKey(projectId = "", primaryThreadId = "") {
  return `${normalizeString(projectId, "")}::${normalizeString(primaryThreadId, "")}`;
}

function normalizeCachedAgentGraphAgent(agent = {}) {
  const key = agent.key && typeof agent.key === "object" ? agent.key : {};
  const agentThreadId = normalizeString(
    agent.agentThreadId || agent.threadId || key.threadId || agent.receiverThreadId || agent.childAgentId,
    "",
  );
  return {
    agentThreadId,
    parentAgentThreadId: normalizeString(agent.parentAgentThreadId || agent.parentThreadId || key.parentThreadId, ""),
    displayLabel: normalizeString(agent.displayLabel || agent.nickname || agent.label || agent.role, agentThreadId ? `Agent ${agentThreadId.slice(0, 8)}` : "Agent"),
    nickname: normalizeString(agent.nickname || agent.displayLabel || agent.label, ""),
    role: normalizeString(agent.role || agent.agentRole || "worker", "worker"),
    agentClassKind: normalizeString(agent.agentClassKind || agent.kind || "sub_agent_worker", "sub_agent_worker"),
    model: normalizeString(agent.model || agent.runtime?.model, ""),
    reasoningEffort: normalizeString(agent.reasoningEffort || agent.reasoning_effort || agent.runtime?.reasoningEffort, ""),
    lifecycleState: normalizeString(agent.lifecycleState || agent.lifecycleStatus || agent.status || agent.nodeState, "unknown"),
    activityState: normalizeString(agent.activityState || agent.activityStatus || agent.nodeState, "unknown"),
    completedAt: normalizeString(agent.completedAt, ""),
    updatedAt: normalizeString(agent.updatedAt || agent.lastEventAt, ""),
    evidenceRefs: Array.isArray(agent.evidenceRefs) ? agent.evidenceRefs : [],
  };
}

function directSubAgentStatusSurfaceFor({ sessionId = "", project = {} } = {}) {
  const projectId = normalizeString(project?.id || project?.projectId || project?.name, "");
  const primaryThreadId = normalizeString(sessionId, "");
  if (!projectId || !primaryThreadId) return null;
  const nativePool = directNativeAgentPool;
  if (nativePool) {
    return nativePool.statusSurface({
      projectId,
      workThreadId: normalizeString(project.workThreadId, ""),
      primaryThreadId,
    });
  }
  const graphState = latestCodexAgentGraphByProjectThread.get(codexAgentGraphCacheKey(projectId, primaryThreadId));
  if (!graphState) return null;
  const agents = (Array.isArray(graphState.agents) ? graphState.agents : [])
    .map((agent) => normalizeCachedAgentGraphAgent(agent))
    .filter((agent) => agent.agentThreadId);
  return createDirectLiveSubAgentToolSurface({
    projectId,
    workThreadId: normalizeString(project.workThreadId, ""),
    primaryThreadId,
    agents,
  });
}

function readContextMaintenanceArtifactSafe(threadStore, projectId, threadId, artifactName) {
  if (!threadStore || !projectId || !threadId) return { artifact: null, errorCode: "" };
  try {
    return {
      artifact: threadStore.readContextMaintenanceArtifact(projectId, threadId, artifactName),
      errorCode: "",
    };
  } catch {
    return { artifact: null, errorCode: `context_${artifactName.replace(/[^a-z0-9]+/gi, "_")}_corrupt` };
  }
}

function contextEvidenceCounts(evidence = {}) {
  return {
    contextCompactionCount: Array.isArray(evidence.contextCompaction) ? evidence.contextCompaction.length : 0,
    memoryCitationCount: Array.isArray(evidence.memoryCitations) ? evidence.memoryCitations.length : 0,
    memoryModeObserved: Array.isArray(evidence.memoryControls)
      ? evidence.memoryControls.some((control) => normalizeString(control.method, "") === "thread/memoryMode/set")
      : false,
    memoryResetObserved: Array.isArray(evidence.memoryControls)
      ? evidence.memoryControls.some((control) => normalizeString(control.method, "") === "memory/reset")
      : false,
    compactControlObserved: Array.isArray(evidence.compactControls) && evidence.compactControls.length > 0,
  };
}

function buildDirectContextMaintenanceRuntimeStatus(project, sessionStore, threadStore) {
  const projectId = normalizeString(project?.id, "");
  const latestSession = latestDirectSessionForProject(sessionStore, projectId);
  const threadId = normalizeString(latestSession?.sessionId, "");
  const blockers = [];
  const { artifact: statusProjection, errorCode } = readContextMaintenanceArtifactSafe(threadStore, projectId, threadId, "status-projection.json");
  if (errorCode) blockers.push(errorCode);
  const siblingEvidence = latestContextManagementEvidenceByProject.get(projectId) || null;
  const siblingCounts = contextEvidenceCounts(siblingEvidence || {});
  return {
    schema: "direct_context_maintenance_runtime_status@1",
    projectId,
    threadId,
    sourceDigest: stableDigest({
      projectId,
      threadId,
      statusProjectionDigest: statusProjection?.projectionDigest || "",
      siblingEvidenceId: siblingEvidence?.evidenceId || "",
      siblingObservedAt: siblingEvidence?.observedAt || "",
    }),
    statusProjection: isPlainObject(statusProjection) ? statusProjection : null,
    pressureState: normalizeString(statusProjection?.pressureState, "unknown"),
    memoryState: normalizeString(statusProjection?.memoryState, "none"),
    memoryPointerState: normalizeString(statusProjection?.memoryPointerState, "none"),
    batonState: normalizeString(statusProjection?.batonState, "not_required"),
    batonRequirement: normalizeString(statusProjection?.batonRequirement, "not_required"),
    omissionState: normalizeString(statusProjection?.omissionState, "none"),
    providerCompactState: "not_proven",
    providerCompactionEvidenceState: "missing",
    appServerSibling: siblingEvidence ? {
      ...siblingEvidence,
      ...siblingCounts,
      displayOnly: true,
      directArtifactPromotionAllowed: false,
      directContextPackUsable: false,
    } : {
      sourceClass: "vanilla_app_server_sibling",
      sourceConfidence: "unknown",
      displayOnly: true,
      contextCompaction: [],
      compactControls: [],
      memoryCitations: [],
      memoryControls: [],
      contextCompactionCount: 0,
      memoryCitationCount: 0,
      memoryModeObserved: false,
      memoryResetObserved: false,
      compactControlObserved: false,
      directArtifactPromotionAllowed: false,
      directContextPackUsable: false,
      rawTextIncluded: false,
      rawPayloadIncluded: false,
    },
    blockers,
    warnings: [],
    evidenceKeys: [
      statusProjection?.projectionDigest ? "direct_context_maintenance_status_projection@1" : "",
      siblingEvidence?.evidenceId ? "vanilla_sibling_context_evidence@1" : "",
    ].filter(Boolean),
    displayOnly: true,
    rawTextIncluded: false,
    rawPayloadIncluded: false,
    providerTransportAllowed: false,
    maintenanceExecutionAllowed: false,
    memoryEditorAllowed: false,
    memoryResetAllowed: false,
    compactActionAllowed: false,
  };
}

function mergeUniqueByKey(existing = [], incoming = [], keyFn = (item) => JSON.stringify(item)) {
  const byKey = new Map();
  for (const item of [...existing, ...incoming]) {
    const key = keyFn(item);
    if (key) byKey.set(key, item);
  }
  return Array.from(byKey.values());
}

function sanitizeContextThreadItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const type = normalizeString(item?.type, "");
      const id = normalizeString(item?.id || item?.itemId, "");
      if (!id) return null;
      if (type === "contextCompaction") {
        return {
          id,
          type,
          lifecycle: normalizeString(item.lifecycle || item.status, "observed"),
        };
      }
      if (isPlainObject(item?.memoryCitation)) {
        return {
          id,
          type: type || "memoryCitation",
          memoryCitation: {
            evidenceKey: normalizeString(item.memoryCitation.evidenceKey || item.memoryCitation.memoryId || id, ""),
          },
        };
      }
      return null;
    })
    .filter(Boolean);
}

function sanitizeContextControls(controls = []) {
  const allowedMethods = new Set(["thread/compact/start", "thread/memoryMode/set", "memory/reset"]);
  return (Array.isArray(controls) ? controls : [])
    .map((control) => ({
      method: normalizeString(control?.method, ""),
      evidenceKey: normalizeString(control?.evidenceKey, ""),
    }))
    .filter((control) => allowedMethods.has(control.method) && control.evidenceKey);
}

function recordContextManagementEvidence(payload = {}) {
  const projectId = normalizeString(payload.projectId, "");
  const threadId = normalizeString(payload.threadId, "");
  if (!projectId || !threadId) return null;
  const incomingThreadItems = sanitizeContextThreadItems(payload.threadItems);
  const incomingControls = sanitizeContextControls(payload.controlsObserved);
  if (!incomingThreadItems.length && !incomingControls.length) return null;
  const previous = contextManagementObservationsByProject.get(projectId) || {
    threadId,
    threadItems: [],
    controlsObserved: [],
  };
  const scopedPrevious = normalizeString(previous.threadId, "") === threadId
    ? previous
    : { threadId, threadItems: [], controlsObserved: [] };
  const threadItems = mergeUniqueByKey(scopedPrevious.threadItems, incomingThreadItems, (item) =>
    `${item.type}:${item.id}:${item.memoryCitation?.evidenceKey || ""}`);
  const controlsObserved = mergeUniqueByKey(scopedPrevious.controlsObserved, incomingControls, (control) =>
    `${control.method}:${control.evidenceKey}`);
  contextManagementObservationsByProject.set(projectId, {
    threadId,
    threadItems,
    controlsObserved,
  });
  const evidence = buildVanillaSiblingContextEvidence({
    projectId,
    threadId,
    threadItems,
    controlsObserved,
    sourceConfidence: "observed",
    sourceRefs: [{
      kind: "renderer_observation",
      evidenceKey: "codex_surface_context_management_observation",
      rawTextIncluded: false,
    }],
  });
  latestContextManagementEvidenceByProject.set(projectId, {
    ...evidence,
    observedAt: nowIso(),
  });
  return latestContextManagementEvidenceByProject.get(projectId);
}

function buildDirectRuntimeStatusForProject(project, options = {}) {
  const controller = ensureDirectAuthController();
  const authSettings = controller.readSettings(options);
  const runtimeAuthStore = directRuntimeAuthStore();
  const runtimeAuthStatus = runtimeAuthStore.readStatus(options);
  const credentials = runtimeAuthStore.readCredentials() || {};
  authSettings.authStatus = runtimeAuthStatus;
  const profileDoc = ensureDirectCodexProfileDoc();
  const sessionStore = ensureDirectSessionStore();
  const imports = ensureDirectImportController().statusForProject(project);
  const liveTextStatus = ensureDirectLiveTextController().statusForProject(project);
  const activationStore = ensureDirectActivationStore();
  const projectId = normalizeString(project?.id, "");
  const sessionStoreStatus = sessionStore.status({ projectId });
  const activationStoreStatus = projectId ? activationStore.statusForProject(projectId) : {};
  const legacySession = currentLegacyAppServerSnapshot();
  const activationEvaluation = evaluateDirectExperimentalProjectActivation({
    project,
    authSettings,
    authStatus: authSettings.authStatus,
    profileDoc,
    sessionStore: sessionStoreStatus,
    sessionStoreObject: sessionStore,
    imports,
    liveTextStatus,
    workspaceStatus: workspaceBackends?.statusForProject(project) || null,
    activationStoreStatus,
    latestActivation: activationStoreStatus.latestActivation || null,
    accountEvidenceKey: normalizeString(credentials.accountId || credentials.chatgptAccountId, ""),
    attachOnFirstTurnAccepted: false,
    profileHash: normalizeString(profileDoc.summary?.profileHash || profileDoc.profile?.profileHash, ""),
  });
  const textOnlyEvaluation = evaluateDirectTextOnlyRuntimeSelection({
    project,
    authSettings,
    authStatus: authSettings.authStatus,
    profileDoc,
    sessionStore: sessionStoreStatus,
    liveTextStatus,
    activationStoreStatus,
    latestSelection: activationStoreStatus.latestRuntimeSelection || null,
    profileHash: normalizeString(profileDoc.summary?.profileHash || profileDoc.profile?.profileHash, ""),
  });
  const runtimeStatus = buildDirectRuntimeStatus({
    project,
    authSettings,
    authStatus: authSettings.authStatus,
    profileDoc,
    sessionStore: sessionStoreStatus,
    directThreadStore: directThreadStoreStatus(),
    imports,
    activation: activationEvaluation.status,
    fixtureRuntime: { available: true, capabilities: buildDirectFixtureCapabilities() },
    liveTextRuntime: { available: true, status: liveTextStatus, capabilities: buildDirectLiveTextCapabilities(liveTextStatus) },
    legacySession,
  });
  runtimeStatus.directTextOnly = {
    ...(runtimeStatus.directTextOnly || {}),
    ...textOnlyEvaluation.status,
  };
  const implementationBlockers = activationEvaluation.status.gateSummary?.blockers
    ?.map((item) => item.blockerCode || item.reason || item.id)
    .filter(Boolean) || [];
  runtimeStatus.directImplementationLane = {
    ...(runtimeStatus.directImplementationLane || {}),
    tier: "implementation-lane",
    status: activationEvaluation.status.enabled
      ? (activationEvaluation.status.degraded ? "degraded" : "enabled")
      : (activationEvaluation.status.eligible ? "eligible" : "blocked"),
    selected: activationEvaluation.status.enabled === true,
    canEnable: activationEvaluation.status.eligible === true,
    blockers: implementationBlockers,
    missingImplementationOnlyGates: implementationBlockers,
  };
  runtimeStatus.direct = {
    ...(runtimeStatus.direct || {}),
    status: runtimeStatus.directImplementationLane.selected
      ? runtimeStatus.directImplementationLane.status
      : runtimeStatus.directTextOnly?.selected
        ? "degraded_text_only"
        : runtimeStatus.directImplementationLane.canSelect || runtimeStatus.directImplementationLane.canEnable
          ? "eligible"
          : runtimeStatus.directTextOnly?.canEnable
            ? "eligible_text_only_fallback"
            : "blocked",
    selected: runtimeStatus.directImplementationLane.selected === true || runtimeStatus.directTextOnly?.selected === true,
    canSelect: runtimeStatus.directImplementationLane.canSelect === true ||
      runtimeStatus.directImplementationLane.canEnable === true ||
      runtimeStatus.directTextOnly?.canEnable === true,
    toolMode: runtimeStatus.directImplementationLane.selected && runtimeStatus.liveTextRuntime?.toolsEnabled
      ? "tool_capable"
      : runtimeStatus.directTextOnly?.selected
        ? "text_only_fallback"
        : "unavailable",
    toolsAvailable: runtimeStatus.directImplementationLane.selected === true && runtimeStatus.liveTextRuntime?.toolsEnabled === true,
    textOnlyFallbackAvailable: runtimeStatus.directTextOnly?.canEnable === true,
    blockers: runtimeStatus.directImplementationLane.canSelect || runtimeStatus.directImplementationLane.canEnable
      ? []
      : runtimeStatus.directImplementationLane.blockers,
    fallbackBlockers: runtimeStatus.directTextOnly?.blockers || [],
    userFacingLabel: "Direct",
  };
  let threadStoreForContext = null;
  try {
    threadStoreForContext = ensureDirectThreadStore();
  } catch {}
  runtimeStatus.directContextMaintenance = buildDirectContextMaintenanceRuntimeStatus(project, sessionStore, threadStoreForContext);
  runtimeStatus.appServerFallbackParity = buildAppServerFallbackParityReport({
    projectId,
    runtimeStatus,
    legacySession,
    directFallbackBlockers: implementationBlockers,
    generatedAt: runtimeStatus.generatedAt,
  });
  return runtimeStatus;
}

function buildDirectSettingsSurfaceStatusForProject(project) {
  const projectId = normalizeString(project?.id, "");
  const generatedAt = nowIso();
  const runtimeStatus = buildDirectRuntimeStatusForProject(project);
  const metaSessionStatus = buildDirectMetaSessionStatusForProject(project, {});
  const moduleStatus = buildBridgeModuleStatusProjection({
    projectId,
    status: "shadow_only",
    rendererSafeSummary: "Skills, hooks, and apps are classified by the bridge module contract; no execution runner is enabled.",
  });
  const agentClassRegistry = buildAgentClassRegistry({
    projectId,
    mode: "shadow",
  });
  const agentClassStatus = buildAgentClassStatusProjection({
    projectId,
    registry: agentClassRegistry,
    status: "shadow_only",
  });
  const toolCapabilityRegistry = buildToolCapabilityRegistry({
    projectId,
    mode: "constitution_only",
  });
  validateToolCapabilityRegistry(toolCapabilityRegistry);
  const toolCapabilityStatus = buildToolCapabilityStatusProjection({
    projectId,
    registry: toolCapabilityRegistry,
    status: "constitution_only",
  });
  const externalDiscoveryStatus = buildDirectExternalCapabilityDiscoveryStatusForProject({
    project,
    generatedAt,
  });
  const mcpBoundaryStatus = buildDirectMcpBoundaryStatusForProject({
    project,
    generatedAt,
  });
  const agentUsageStatus = buildDirectAgentUsageStatusForProject(projectId);
  const implementationLaneUiStatus = buildDirectImplementationLaneUiStatus({ project, runtimeStatus });
  const directProviderMetadata = directProviderMetadataStatusForProject(project);
  const providerHostedToolsStatus = buildDirectProviderHostedToolsStatusForProject({
    project,
    directProviderMetadata,
    generatedAt,
  });
  const pluginGovernanceStatus = buildDirectPluginGovernanceStatusForProject({
    project,
    generatedAt,
  });
  const appServerFallbackParity = runtimeStatus.appServerFallbackParity || buildAppServerFallbackParityReport({
    projectId,
    runtimeStatus,
    legacySession: currentLegacyAppServerSnapshot(),
  });
  const workThreadBundle = directWorkThreadProjectionForProject(project);
  const agentRegistryBundle = directAgentRegistryProjectionForProject(project);
  const runtimeWitnessProjection = buildDirectRuntimeWitnessProjectionForProject({
    project,
    runtimeStatus,
    agentUsageStatus,
    appServerFallbackParity,
    directProviderMetadata,
    generatedAt,
  });
  const controlToolStatus = buildDirectControlToolStatusForProject({
    project,
    runtimeStatus,
    agentUsageStatus,
    directProviderMetadata,
    generatedAt,
  });
  const agentRuntimeStatus = buildDirectAgentRuntimeSubstrateStatusForProject({
    project,
    runtimeStatus,
    agentUsageStatus,
    generatedAt,
  });
  const agentToolSurfaceStatus = buildDirectTextSubAgentToolSurfaceForProject({
    project,
    runtimeStatus,
    agentRuntimeStatus,
    generatedAt,
  });
  const batchAgentJobSurfaceStatus = buildDirectBatchAgentJobSurfaceForProject({
    project,
    runtimeStatus,
    workThreadBundle,
    generatedAt,
  });
  const statefulExecStatus = buildDirectStatefulExecSessionSurfaceForProject({
    project,
    runtimeStatus,
    workThreadBundle,
    generatedAt,
  });
  const codeModeExecutionLaneStatus = buildDirectCodeModeExecutionLaneStatusForProject({
    project,
    runtimeStatus,
    workThreadBundle,
    generatedAt,
  });
  const contextPreview = directContextPreviewForProject(project, {
    runtimeStatus,
    runtimeWitnessProjection,
    agentUsageStatus,
    workThreadBundle,
  });
  const operatorBroker = directOperatorBrokerProjectionForProject(project, workThreadBundle);
  const registryAudit = buildDirectInformationBridgeAudit({
    branch: "codex/direct-chatgpt-harness",
    generatedAt,
  });
  const projectionInput = {
    projectId,
    runtimeStatus,
    registryAudit,
    workThreads: workThreadBundle,
    agents: agentRegistryBundle,
    operatorBroker,
    metaSessionStatus,
    moduleStatus,
    agentClassStatus,
    toolCapabilityStatus,
    externalDiscoveryStatus,
    mcpBoundaryStatus,
    providerHostedToolsStatus,
    pluginGovernanceStatus,
    controlToolStatus,
    agentRuntimeStatus,
    agentToolSurfaceStatus,
    batchAgentJobSurfaceStatus,
    statefulExecStatus,
    codeModeExecutionLaneStatus,
    continuityStatus: runtimeStatus.directContextMaintenance,
    contextPreview,
    runtimeWitnessProjection,
    agentUsageStatus,
    appServerFallbackParityReport: appServerFallbackParity,
    generatedAt,
  };
  const baseProjection = buildDirectSettingsSurfaceProjection(projectionInput);
  const manualSmokeGate = buildDirectManualSmokeGate({
    ...projectionInput,
    settingsProjection: baseProjection,
    implementationLaneUiStatus,
    runtimeWitnessProjection,
    appServerFallbackParityReport: appServerFallbackParity,
    appServerFallbackAvailable: runtimeStatus.diagnostics?.legacyAppServerAvailable === true,
    generatedAt,
  });
  assertDirectManualSmokeGateSafe(manualSmokeGate);
  const projection = buildDirectSettingsSurfaceProjection({
    ...projectionInput,
    manualSmokeGate,
  });
  assertDirectSettingsSurfaceRendererSafe(projection);
  return projection;
}

function buildDirectAgentRuntimeSubstrateStatusForProject(input = {}) {
  const project = input.project || {};
  const projectId = normalizeString(project.id || input.runtimeStatus?.projectId, "");
  const primaryThreadId = normalizeString(
    input.runtimeStatus?.activeProviderThreadId ||
      input.runtimeStatus?.activeDirectSessionId ||
      project.codexThreadId ||
      project.threadId,
    "primary_agent",
  );
  const generatedAt = normalizeString(input.generatedAt, nowIso());
  const status = buildAgentRuntimeSubstrateStatus({
    projectId,
    primaryThreadId,
    nodes: [],
    edges: [],
    messages: [],
    lifecycleEntries: [],
    generatedAt,
  });
  assertAgentRuntimeSubstrateSafe(status);
  return status;
}

function buildDirectExternalCapabilityDiscoveryStatusForProject(input = {}) {
  const project = input.project || {};
  const projectId = normalizeString(project.id, "");
  const registry = buildExternalCapabilityDiscoveryRegistry({
    projectId,
    workThreadId: normalizeString(project.workThreadId, ""),
    generatedAt: normalizeString(input.generatedAt, nowIso()),
  });
  assertExternalCapabilityDiscoveryRegistrySafe(registry);
  return buildExternalCapabilityDiscoveryStatusProjection(registry);
}

function buildDirectExternalCapabilityProfileForProject(input = {}) {
  const project = input.project || input || {};
  const projectId = normalizeString(project.id || project.projectId, "");
  const workThreadId = normalizeString(input.workThreadId || project.workThreadId, "");
  const generatedAt = normalizeString(input.generatedAt, nowIso());
  const serverIdentities = [
    ...(Array.isArray(input.serverIdentities) ? input.serverIdentities : []),
    ...(Array.isArray(project.serverIdentities) ? project.serverIdentities : []),
    ...(Array.isArray(project.mcpServerIdentities) ? project.mcpServerIdentities : []),
    ...(Array.isArray(project.externalCapabilityProfile?.serverIdentities) ? project.externalCapabilityProfile.serverIdentities : []),
    ...(Array.isArray(project.directExternalCapabilityProfile?.serverIdentities) ? project.directExternalCapabilityProfile.serverIdentities : []),
    ...(Array.isArray(project.codex?.mcpServerIdentities) ? project.codex.mcpServerIdentities : []),
    ...(Array.isArray(project.surfaceBinding?.codex?.mcpServerIdentities) ? project.surfaceBinding.codex.mcpServerIdentities : []),
  ];
  if (!serverIdentities.length) {
    return {
      status: "unavailable",
      reason: "external_source_identity_missing",
      projectId,
      workThreadId,
      serverIdentities: [],
      rawEndpointIncluded: false,
      rawCredentialIncluded: false,
      rawSecretIncluded: false,
    };
  }
  const discoveryRegistry = buildExternalCapabilityDiscoveryRegistry({
    projectId,
    workThreadId,
    generatedAt,
  });
  assertExternalCapabilityDiscoveryRegistrySafe(discoveryRegistry);
  const mcpBoundaryStatus = buildMcpResourceToolBoundaryStatus({
    projectId,
    workThreadId,
    generatedAt,
  });
  assertMcpResourceToolBoundarySafe(mcpBoundaryStatus);
  return buildExternalCapabilityProfile({
    projectId,
    workThreadId,
    generatedAt,
    discoveryRegistry,
    mcpBoundaryStatus,
    serverIdentities,
  });
}

function buildDirectMcpBoundaryStatusForProject(input = {}) {
  const project = input.project || {};
  const projectId = normalizeString(project.id, "");
  const status = buildMcpResourceToolBoundaryStatus({
    projectId,
    workThreadId: normalizeString(project.workThreadId, ""),
    generatedAt: normalizeString(input.generatedAt, nowIso()),
  });
  assertMcpResourceToolBoundarySafe(status);
  return status;
}

function buildDirectProviderHostedToolsStatusForProject(input = {}) {
  const project = input.project || {};
  const projectId = normalizeString(project.id, "");
  const directProviderMetadata = input.directProviderMetadata || {};
  const existingStatus = [
    input.providerHostedToolsStatus,
    project.providerHostedToolsStatus,
    project.directProviderHostedToolsStatus,
    project.surfaceBinding?.codex?.providerHostedToolsStatus,
  ].find(isPlainObject) || {};
  const existingActivationSnapshot = [
    input.providerHostedActivationSnapshot,
    existingStatus.activationSnapshot,
    project.providerHostedActivationSnapshot,
    project.surfaceBinding?.codex?.providerHostedActivationSnapshot,
  ].find(isPlainObject) || null;
  const existingCapabilities = [
    input.capabilities,
    existingStatus.capabilities,
    existingActivationSnapshot?.capabilities,
    project.providerHostedCapabilities,
    project.surfaceBinding?.codex?.providerHostedCapabilities,
  ].find(Array.isArray) || [];
  const status = buildProviderHostedToolsStatus({
    projectId,
    workThreadId: normalizeString(project.workThreadId, ""),
    providerMetadataProfile: directProviderMetadata.profile || input.providerMetadataProfile || null,
    ...(existingActivationSnapshot ? { activationSnapshot: existingActivationSnapshot } : {}),
    ...(existingCapabilities.length ? { capabilities: existingCapabilities } : {}),
    requestShapeProofs: [
      ...(Array.isArray(input.requestShapeProofs) ? input.requestShapeProofs : []),
      ...(Array.isArray(project.providerHostedRequestShapeProofs) ? project.providerHostedRequestShapeProofs : []),
      ...(Array.isArray(project.providerHostedToolsStatus?.activationSnapshot?.requestShapeProofs) ? project.providerHostedToolsStatus.activationSnapshot.requestShapeProofs : []),
      ...(Array.isArray(project.directProviderHostedToolsStatus?.activationSnapshot?.requestShapeProofs) ? project.directProviderHostedToolsStatus.activationSnapshot.requestShapeProofs : []),
      ...(Array.isArray(existingActivationSnapshot?.requestShapeProofs) ? existingActivationSnapshot.requestShapeProofs : []),
      ...(Array.isArray(project.surfaceBinding?.codex?.providerHostedRequestShapeProofs) ? project.surfaceBinding.codex.providerHostedRequestShapeProofs : []),
    ],
    generatedAt: normalizeString(input.generatedAt, nowIso()),
  });
  assertProviderHostedToolsStatusSafe(status);
  return status;
}

function buildDirectPluginGovernanceStatusForProject(input = {}) {
  const project = input.project || {};
  const projectId = normalizeString(project.id, "");
  const status = buildPluginGovernanceStatus({
    projectId,
    workThreadId: normalizeString(project.workThreadId, ""),
    generatedAt: normalizeString(input.generatedAt, nowIso()),
  });
  assertPluginGovernanceStatusSafe(status);
  return status;
}

function buildDirectTextSubAgentToolSurfaceForProject(input = {}) {
  const project = input.project || {};
  const projectId = normalizeString(project.id || input.runtimeStatus?.projectId || input.agentRuntimeStatus?.projectId, "");
  const primaryThreadId = normalizeString(
    input.agentRuntimeStatus?.primaryThreadId ||
      input.runtimeStatus?.activeProviderThreadId ||
      input.runtimeStatus?.activeDirectSessionId ||
      project.codexThreadId ||
      project.threadId,
    "primary_agent",
  );
  const generatedAt = normalizeString(input.generatedAt, nowIso());
  const graph = buildAgentThreadGraph({
    projectId,
    primaryThreadId,
    nodes: [],
    edges: [],
  });
  const mailbox = buildAgentMailbox({
    projectId,
    primaryThreadId,
    graphId: graph.graphId,
    messages: [],
  });
  const surface = buildTextOnlySubAgentToolSurface({
    projectId,
    primaryThreadId,
    graph,
    mailbox,
    spawnRequest: {
      childAgentId: "planned_text_child_agent",
      promptChars: 120,
      promptEvidenceId: "planned_text_child_spawn_prompt",
    },
    waitPlan: {
      targetAgentIds: ["planned_text_child_agent"],
      waitMode: "specific",
      timeoutMs: 30000,
      maxWaitDepth: 1,
    },
    sendMessagePlan: {
      targetAgentId: "planned_text_child_agent",
      payloadId: "planned_text_child_message",
    },
    followupTaskPlan: {
      targetAgentId: "planned_text_child_agent",
      payloadId: "planned_text_child_followup",
    },
    interruptRequest: {
      targetAgentId: "planned_text_child_agent",
    },
    generatedAt,
  });
  assertTextOnlySubAgentToolSurfaceSafe(surface);
  return surface;
}

function buildDirectStatefulExecSessionSurfaceForProject(input = {}) {
  const project = input.project || {};
  const projectId = normalizeString(project.id || input.runtimeStatus?.projectId, "");
  const workThreadId = normalizeString(
    input.workThreadBundle?.activeWorkThreadId ||
      input.workThreadBundle?.projection?.activeWorkThreadId ||
      project.workThreadId,
    "work_thread_stateful_exec_preview",
  );
  const surface = buildStatefulExecSessionSurface({
    projectId,
    workThreadId,
    sessionPlan: {
      projectId,
      workThreadId,
      sessionId: "planned_stateful_exec_session",
      sessionState: "planned",
      commandClass: "plain_pipe_process_session",
      commandPreview: "metadata-only command preview",
      transportMode: "plain_pipe",
      cwdEvidenceKey: "workspace_root_evidence_key",
      idleTimeoutMs: 30000,
      hardTimeoutMs: 120000,
      outputBudgetChars: 24000,
      providerResultBudgetChars: 12000,
    },
    outputFrames: [],
    stdinPlan: {
      stdinPolicy: "blocked_until_policy",
      inputPreviewChars: 0,
    },
    cleanupPlan: {
      cleanupState: "not_required",
    },
    recoveryClassification: {
      sessionState: "planned",
    },
    generatedAt: normalizeString(input.generatedAt, nowIso()),
  });
  assertStatefulExecSessionSurfaceSafe(surface);
  return surface;
}

function buildDirectBatchAgentJobSurfaceForProject(input = {}) {
  const project = input.project || {};
  const runtimeStatus = input.runtimeStatus || {};
  const projectId = normalizeString(project.id || runtimeStatus.projectId, "");
  const workThreadId = normalizeString(
    input.workThreadBundle?.activeWorkThreadId ||
      input.workThreadBundle?.projection?.activeWorkThreadId ||
      project.workThreadId,
    "work_thread_batch_agent_preview",
  );
  const surface = buildBatchAgentJobSurface({
    projectId,
    primaryThreadId: normalizeString(runtimeStatus.activeProviderThreadId || runtimeStatus.activeDirectSessionId || project.codexThreadId || project.threadId, ""),
    workThreadId,
    jobPlan: {
      csvEvidenceKey: "planned_batch_csv_evidence_key",
      csvHeaderDigest: "planned_batch_csv_header_digest",
      rowCount: 0,
      workerItems: [],
      maxWorkers: 50,
      concurrencyLimit: 4,
    },
    resultContract: {
      resultEnvelopeType: "batch_worker_result_ref",
      requiredFields: ["workerItemId", "resultState", "resultEvidenceKey"],
    },
    aggregationLedger: {
      expectedWorkerCount: 0,
      exportPolicy: "metadata_only",
    },
    generatedAt: normalizeString(input.generatedAt, nowIso()),
  });
  assertBatchAgentJobSurfaceSafe(surface);
  return surface;
}

function buildDirectCodeModeExecutionLaneStatusForProject(input = {}) {
  const project = input.project || {};
  const runtimeStatus = input.runtimeStatus || {};
  const projectId = normalizeString(project.id || runtimeStatus.projectId, "");
  const workThreadId = normalizeString(
    input.workThreadBundle?.activeWorkThreadId ||
      input.workThreadBundle?.projection?.activeWorkThreadId ||
      project.workThreadId,
    "work_thread_code_mode_preview",
  );
  const status = buildCodeModeExecutionLaneStatus({
    projectId,
    workThreadId,
    threadId: normalizeString(runtimeStatus.activeProviderThreadId || runtimeStatus.activeDirectSessionId || project.codexThreadId || project.threadId, ""),
    kernelSession: {
      kernelSessionId: "planned_code_mode_kernel_session",
      state: "not_started",
      kernelKind: "provider_code_mode",
      language: "unknown",
      resourceClass: "unknown",
      maxWallTimeMs: 0,
      maxOutputBytes: 0,
    },
    executePosture: {
      executionState: "blocked_execution_not_enabled",
      requestShapeFamily: "code_mode_execute_request_posture",
      estimatedResourceClass: "unknown",
    },
    waitCancelPolicy: {
      waitState: "blocked_execution_not_enabled",
      cancelState: "blocked_execution_not_enabled",
      waitTimeoutMs: 0,
    },
    artifactOutputPolicy: {
      artifactState: "metadata_only",
      artifactRefPolicy: "metadata_only",
      allowedArtifactKinds: ["structured_result_ref", "text_summary"],
    },
    generatedAt: normalizeString(input.generatedAt, nowIso()),
  });
  assertCodeModeExecutionLaneSafe(status);
  return status;
}

function buildDirectAgentUsageStatusForProject(projectId) {
  const safeProjectId = normalizeString(projectId, "");
  try {
    const sessionStore = ensureDirectSessionStore();
    const index = sessionStore.ensure();
    const sessions = (Array.isArray(index.sessions) ? index.sessions : [])
      .filter((entry) => !safeProjectId || normalizeString(entry?.projectId, "") === safeProjectId)
      .map((entry) => {
        const session = entry?.sessionId ? sessionStore.readSession(entry.sessionId) : null;
        if (!session) return null;
        const turnIds = new Set([
          ...(Array.isArray(session.turns) ? session.turns.map((turn) => normalizeString(turn?.turnId, "")).filter(Boolean) : []),
          ...(sessionStore.listTurnIdsFromDisk(session.sessionId) || []),
        ]);
        const turns = [...turnIds]
          .map((turnId) => sessionStore.readTurn(session.sessionId, turnId))
          .filter(Boolean);
        return { session, turns };
      })
      .filter(Boolean);
    const ledger = buildDirectAgentUsageLedger({
      projectId: safeProjectId,
      sessionTurns: sessions,
    });
    try {
      ensureDirectThreadStore().recordDirectRuntimeAnalyticsFacts({
        projectId: safeProjectId,
        sessionTurns: sessions,
      });
    } catch {}
    return buildDirectAgentUsageSummaryProjection(ledger);
  } catch (error) {
    return {
      schema: "direct_agent_usage_summary_projection@1",
      projectId: safeProjectId,
      rowCount: 0,
      totals: {
        rowCount: 0,
        turnCount: 0,
        inputTokensKnown: 0,
        cachedInputTokensKnown: 0,
        nonCachedInputTokensKnown: 0,
        outputTokensKnown: 0,
        reasoningTokensKnown: 0,
        totalTokensKnown: 0,
        missingUsageRowCount: 0,
        durationMsKnown: 0,
      },
      byAgent: [],
      byWorkThread: [],
      byRoute: [],
      evidencePosture: {
        exactWhereProviderReported: false,
        missingUsageIsNotZero: true,
        costComputed: false,
        billingGrade: false,
      },
      privacy: {
        rawPromptIncluded: false,
        rawResponseIncluded: false,
        rawProviderFrameIncluded: false,
        rawTokenDetailsIncluded: false,
      },
      error: {
        code: "direct_agent_usage_status_unavailable",
        message: normalizeString(error?.message, "Direct agent usage status unavailable."),
      },
      rawTextIncluded: false,
      rawPathIncluded: false,
      rawSecretIncluded: false,
    };
  }
}

function emptyDirectWorkThreadProjection(projectId, reason = "work_thread_registry_unavailable") {
  return {
    status: {
      available: false,
      reason,
      workThreadCount: 0,
      activeCount: 0,
      projectionDigest: "",
    },
    projection: {
      schema: "direct_work_thread_projection@1",
      projectId,
      generatedAt: nowIso(),
      rowCount: 0,
      activeCount: 0,
      rows: [],
      projectionDigest: "",
      rawTextIncluded: false,
      rawPathIncluded: false,
    },
    resolutionReport: {
      resolutionState: "unavailable",
      routingGateState: "unavailable",
      selectedWorkThreadId: "",
      candidateCount: 0,
      blockerCodes: [reason],
      ambiguityBlockers: [reason],
      clarificationRequired: false,
      nonTargetPreservationRequired: true,
      mutationBlocked: true,
      providerCallBlocked: true,
      reportDigest: "",
    },
  };
}

function directWorkThreadProjectionForProject(project = {}) {
  const projectId = normalizeString(project?.id, "");
  if (!projectId) return emptyDirectWorkThreadProjection("", "project_missing");
  try {
    const store = ensureDirectWorkThreadStore();
    const status = store.status({ projectId });
    const projection = store.buildProjection({ projectId });
    const resolutionReport = store.resolveWorkTargetReport({
      projectId,
      activeRuntimePath: directRuntimePathFromBinding(project.surfaceBinding?.codex || {}),
      maxAgeMs: 10 * 60 * 1000,
    });
    return { status, projection, resolutionReport };
  } catch (error) {
    return emptyDirectWorkThreadProjection(projectId, normalizeString(error?.code || error?.message, "work_thread_registry_unavailable"));
  }
}

function emptyDirectAgentRegistryProjection(projectId, reason = "agent_registry_unavailable") {
  return {
    status: {
      schema: "direct_agent_registry_status@1",
      available: false,
      state: "degraded",
      reason,
      projectId,
      agentCount: 0,
      backfilledCount: 0,
      activeCount: 0,
      threadLinkCount: 0,
      registryPathExposed: false,
      projectionDigest: "",
      rawTextIncluded: false,
      rawPathIncluded: false,
      rawSecretIncluded: false,
    },
    projection: {
      schema: "direct_agent_registry_projection@1",
      projectId,
      generatedAt: nowIso(),
      rowCount: 0,
      backfilledCount: 0,
      activeCount: 0,
      rows: [],
      projectionDigest: "",
      rawTextIncluded: false,
      rawPathIncluded: false,
      rawSecretIncluded: false,
    },
    backfillReport: null,
  };
}

function directAgentRegistryProjectionForProject(project = {}) {
  const projectId = normalizeString(project?.id, "");
  if (!projectId) return emptyDirectAgentRegistryProjection("", "project_missing");
  try {
    const store = ensureDirectAgentRegistryStore();
    const sessionStore = ensureDirectSessionStore();
    const sessionStatus = sessionStore.status({ projectId });
    const cacheKey = [
      normalizeString(sessionStatus.lastSessionUpdatedAt, ""),
      Number(sessionStatus.sessionCount || 0),
      Number(sessionStatus.turnCount || 0),
    ].join("::");
    let backfillReport = null;
    if (directAgentRegistryBackfillStateByProject.get(projectId) !== cacheKey) {
      backfillReport = store.backfillFromSessionStore(sessionStore, { projectId });
      directAgentRegistryBackfillStateByProject.set(projectId, cacheKey);
    } else {
      const projection = store.buildProjection({ projectId });
      backfillReport = {
        schema: "direct_agent_registry_backfill_report@1",
        projectId,
        generatedAt: nowIso(),
        touchedAgentCount: 0,
        touchedAgentRunCount: 0,
        touchedThreadLinkCount: 0,
        projection,
        status: store.status({ projectId, projection, threadLinkCount: projection.rows.reduce((count, row) => count + Number(row.linkedThreadCount || 0), 0) }),
        sessionRewritePerformed: false,
        rawTextIncluded: false,
        rawPathIncluded: false,
        rawSecretIncluded: false,
      };
    }
    return {
      status: backfillReport.status,
      projection: backfillReport.projection,
      backfillReport: {
        schema: backfillReport.schema,
        projectId: backfillReport.projectId,
        generatedAt: backfillReport.generatedAt,
        touchedAgentCount: backfillReport.touchedAgentCount,
        touchedAgentRunCount: backfillReport.touchedAgentRunCount,
        touchedThreadLinkCount: backfillReport.touchedThreadLinkCount,
        sessionRewritePerformed: false,
        rawTextIncluded: false,
        rawPathIncluded: false,
        rawSecretIncluded: false,
      },
    };
  } catch (error) {
    return emptyDirectAgentRegistryProjection(projectId, normalizeString(error?.code || error?.message, "agent_registry_unavailable"));
  }
}

function directOperatorBrokerProjectionForProject(project = {}, workThreadBundle = null) {
  const projectId = normalizeString(project?.id, "");
  if (!projectId) return null;
  try {
    const store = ensureDirectWorkThreadStore();
    const workThreads = store.listWorkThreads({ projectId, includeArchived: true });
    const resolution = buildOperatorBrokerResolution({
      projectId,
      activeRuntimePath: directRuntimePathFromBinding(project.surfaceBinding?.codex || {}),
      workTargetResolutionReport: workThreadBundle?.resolutionReport,
    }, workThreads, { nowMs: Date.now() });
    assertOperatorBrokerResolutionSafe(resolution);
    const projection = buildOperatorBrokerResolutionProjection(resolution);
    assertOperatorBrokerProjectionSafe(projection);
    return projection;
  } catch (error) {
    return {
      schema: "operator_broker_resolution_projection@1",
      brokerResolutionId: "",
      projectId,
      resolutionState: "unavailable",
      routingGateState: "unavailable",
      selectedWorkThreadId: "",
      candidateCount: 0,
      confidenceLabel: "none",
      candidates: [],
      ambiguityBlockers: [normalizeString(error?.code || error?.message, "operator_broker_unavailable")],
      clarificationRequired: false,
      nonTargetPreservationRequired: true,
      nonTargetPreservationConstraints: ["preserve_non_target_workthreads"],
      workWorldSnapshot: {},
      authority: {
        mutationAuthorityGranted: false,
        providerCallAuthorityGranted: false,
        routingEnforced: false,
        workspaceMutationAllowed: false,
        providerTransportAllowed: false,
        rawTextIncluded: false,
        rawPathIncluded: false,
        rawSecretIncluded: false,
      },
      rawTextIncluded: false,
      rawPathIncluded: false,
      rawSecretIncluded: false,
    };
  }
}

function directContextPreviewForProject(project = {}, input = {}) {
  const projectId = normalizeString(project?.id, "");
  const runtimePath = directRuntimePathFromBinding(project?.surfaceBinding?.codex || {});
  const workThreadBundle = input.workThreadBundle || directWorkThreadProjectionForProject(project);
  const contextMaintenance = input.runtimeStatus?.directContextMaintenance || {};
  const preview = buildContextPacketPreview({
    projectId,
    harnessPolicyRows: [
      {
        sourceClass: "harness_policy",
        sourceId: "direct_runtime_path",
        label: `Direct runtime path: ${runtimePath || "unknown"}`,
        includedInRequest: true,
        required: true,
        stale: false,
        missing: !runtimePath,
        retentionLaw: "runtime_selection_witness",
      },
      {
        sourceClass: "harness_policy",
        sourceId: "work_thread_registry",
        label: `WorkThread registry: ${Number(workThreadBundle?.status?.workThreadCount || 0)} active-world row(s)`,
        includedInRequest: true,
        required: false,
        stale: false,
        missing: workThreadBundle?.status?.available !== true,
        retentionLaw: "work_thread_identity_witness",
      },
      {
        sourceClass: "harness_policy",
        sourceId: "context_maintenance",
        label: `Context maintenance: ${normalizeString(contextMaintenance.pressureState, "unknown")}`,
        includedInRequest: true,
        required: false,
        stale: false,
        missing: false,
        retentionLaw: "context_status_witness",
      },
    ],
    sourceArtifacts: [
      {
        artifactKind: "runtime_witness",
        artifactId: input.runtimeWitnessProjection?.projectionId || "",
        label: "Direct model/reasoning/quota/usage witness",
        artifactDigest: input.runtimeWitnessProjection?.integrity?.artifactDigest || "",
        requiredForRequest: false,
      },
      {
        artifactKind: "usage_projection",
        artifactId: input.agentUsageStatus?.projectionId || "",
        label: "Direct usage summary projection",
        artifactDigest: input.agentUsageStatus?.projectionDigest || "",
        requiredForRequest: false,
      },
    ],
  }, { nowMs: Date.now() });
  assertContextPacketPreviewSafe(preview);
  return preview;
}

function directWitnessStateFromEvidence(value) {
  const state = normalizeString(value, "unknown");
  if (state === "runtime_probed" || state === "accepted" || state === "exact") return "fresh";
  if (state === "expired") return "expired";
  if (state === "rejected" || state === "scope_mismatch") return "blocked";
  if (state === "candidate" || state === "diagnostic" || state === "unstable") return "diagnostic";
  return "unknown";
}

function runtimeWitnessEvidenceRef(kind, artifactId, label, confidence = "diagnostic") {
  const digest = crypto.createHash("sha256").update(`${kind}:${artifactId || label || ""}`).digest("hex");
  return normalizeEvidenceRef({
    kind,
    artifactId: normalizeString(artifactId, kind),
    artifactDigest: digest,
    sourceConfidence: confidence,
    rendererSafeLabel: label,
  });
}

function directMetadataModelItems(profile = {}) {
  const items = profile?.modelCatalog?.items;
  return Array.isArray(items) ? items : [];
}

function directMetadataModelById(profile = {}, value = "") {
  const id = normalizeString(value, "");
  if (!id) return null;
  return directMetadataModelItems(profile).find((model) => (
    normalizeString(model.id, "") === id ||
    normalizeString(model.model, "") === id
  )) || null;
}

function directMetadataSelectedModel(profile = {}, project = {}, runtimeStatus = {}) {
  const codexBinding = project.surfaceBinding?.codex || {};
  const liveText = runtimeStatus.liveTextRuntime || {};
  const modelIds = Array.isArray(runtimeStatus.models?.ids) ? runtimeStatus.models.ids.filter(Boolean) : [];
  const candidate = normalizeString(
    codexBinding.model ||
      profile?.runtimeSettings?.active?.model ||
      profile?.modelCatalog?.defaultModel ||
      liveText.liveProbeEvidence?.model ||
      modelIds[0],
    "",
  );
  return {
    id: candidate,
    descriptor: directMetadataModelById(profile, candidate),
  };
}

function directMetadataReasoningEffort(profile = {}, project = {}, modelDescriptor = null) {
  const codexBinding = project.surfaceBinding?.codex || {};
  return normalizeString(
    codexBinding.reasoningEffort ||
      profile?.runtimeSettings?.active?.reasoningEffort ||
      modelDescriptor?.defaultReasoningEffort,
    "",
  );
}

function directMetadataWitnessState(profile = {}, driftReport = {}) {
  if (driftReport?.status === "invalid" || driftReport?.status === "blocked") return "blocked";
  if (profile?.modelCatalog?.source === "server_model_list") return "fresh";
  if (profile?.modelCatalog?.source === "cache") return "diagnostic";
  return "unknown";
}

function directMetadataQuotaWindows(profile = {}) {
  const windows = profile?.usage?.quota?.windows;
  if (!Array.isArray(windows) || !windows.length) return [];
  const codexWindows = windows.filter((window) => String(window?.windowId || "").startsWith("codex:"));
  const selectedWindows = codexWindows.length ? codexWindows : windows;
  return [...selectedWindows].sort((a, b) => {
    const priority = (window) => {
      const label = directMetadataQuotaWindowLabel(window);
      if (label === "5h") return 1;
      if (label === "W") return 2;
      return 10;
    };
    const priorityDiff = priority(a) - priority(b);
    if (priorityDiff) return priorityDiff;
    const aPercent = Number(a?.usedPercent);
    const bPercent = Number(b?.usedPercent);
    if (Number.isFinite(aPercent) && Number.isFinite(bPercent) && aPercent !== bPercent) return bPercent - aPercent;
    return 0;
  });
}

function directMetadataQuotaWindowLabel(window = {}) {
  const safeWindow = window ?? {};
  if (safeWindow.windowKind === "weekly") return "W";
  if (safeWindow.windowKind === "five_hour") return "5h";
  const duration = Number(safeWindow.windowDurationMins || 0);
  if (duration === 300) return "5h";
  if (duration === 10080) return "W";
  if (duration > 0 && duration < 60) return `${duration}m`;
  if (duration > 0 && duration % 1440 === 0) return `${duration / 1440}d`;
  if (duration > 0 && duration % 60 === 0) return `${duration / 60}h`;
  return normalizeString(safeWindow.windowKind, "quota");
}

function directMetadataAvailablePercent(window = {}) {
  const used = Number(window?.usedPercent);
  if (!Number.isFinite(used)) return null;
  return Math.max(0, Math.min(100, 100 - Math.round(used)));
}

function directMetadataResetLabel(window = {}) {
  const resetAt = window?.resetsAt;
  if (!resetAt) return "";
  const date = new Date(resetAt);
  if (!Number.isFinite(date.getTime())) return "";
  const options = directMetadataQuotaWindowLabel(window) === "W"
    ? { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }
    : { hour: "2-digit", minute: "2-digit", hour12: false };
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

function directMetadataQuotaLabel(profile = {}) {
  const windows = directMetadataQuotaWindows(profile);
  if (!windows.length) return "Quota/rate unknown";
  const parts = windows
    .slice(0, 2)
    .map((window) => {
      const percent = directMetadataAvailablePercent(window);
      if (percent == null) return "";
      const reset = directMetadataResetLabel(window);
      return [directMetadataQuotaWindowLabel(window), `${percent}%`, reset].filter(Boolean).join(" ");
    })
    .filter(Boolean);
  return parts.length ? `Quota/rate ${parts.join(" / ")}` : "Quota/rate available";
}

function directMetadataContextLabel(profile = {}, modelDescriptor = null, agentUsageStatus = {}) {
  const contextWindow = Number(profile?.usage?.context?.modelContextWindow || modelDescriptor?.contextWindow || 0);
  const latestUsage = agentUsageStatus?.latestUsage || {};
  const usedTokens = Number(
    profile?.usage?.context?.usedTokens ??
      profile?.usage?.context?.tokensInWindow ??
      latestUsage.inputTokensKnown ??
      0,
  );
  if (Number.isFinite(contextWindow) && contextWindow > 0 && Number.isFinite(usedTokens) && usedTokens > 0) {
    const usedPercent = Math.max(0, Math.min(100, Math.round((usedTokens / contextWindow) * 100)));
    return `Context ${usedPercent}% · ${usedTokens}/${contextWindow}`;
  }
  if (Number.isFinite(contextWindow) && contextWindow > 0) return `Context fill unknown · window ${contextWindow}`;
  return "Context unknown";
}

function buildDirectControlToolStatusForProject(input = {}) {
  const project = input.project || {};
  const projectId = normalizeString(project.id || input.runtimeStatus?.projectId, "");
  const runtimeStatus = input.runtimeStatus || {};
  const agentUsageStatus = input.agentUsageStatus || {};
  const directProviderMetadata = input.directProviderMetadata || {};
  const metadataProfile = directProviderMetadata.profile || input.providerMetadataProfile || null;
  const selected = directMetadataSelectedModel(metadataProfile || {}, project, runtimeStatus);
  const modelDescriptor = selected.descriptor || {};
  const contextWindow = Number(metadataProfile?.usage?.context?.modelContextWindow || modelDescriptor.contextWindow || 0);
  const usedTokenCandidate =
    metadataProfile?.usage?.context?.usedTokens ??
      metadataProfile?.usage?.context?.tokensInWindow ??
      agentUsageStatus?.latestUsage?.inputTokensKnown;
  const usedTokens = Number(usedTokenCandidate);
  const hasUsageEvidence = usedTokenCandidate !== undefined && usedTokenCandidate !== null && Number.isFinite(usedTokens);
  const tokensLeft = Number.isFinite(contextWindow) && contextWindow > 0 && hasUsageEvidence
    ? Math.max(0, contextWindow - Math.max(0, usedTokens))
    : null;
  const estimateKind = metadataProfile?.usage?.context?.source === "provider_reported"
    ? "provider_reported"
    : Number.isFinite(tokensLeft)
      ? "budget_policy_estimate"
      : "unknown";
  const generatedAt = normalizeString(input.generatedAt, nowIso());
  const status = buildControlToolSubstrateStatus({
    projectId,
    generatedAt,
    contextRemainingInput: {
      projectId,
      tokensLeft,
      confidence: Number.isFinite(tokensLeft) ? "derived" : "unknown",
      source: Number.isFinite(tokensLeft) ? "direct_provider_metadata_and_usage" : "unavailable",
      estimateKind,
      usableFor: "display_only",
      observedAt: generatedAt,
    },
    planInput: {
      projectId,
      source: "model_tool_call",
      status: "active",
      sourceRefs: [{ kind: "tool_capability_row", ref: "vanilla.update_plan" }],
      steps: [],
      conflictsWithCurrentUserIntent: false,
      createdAt: generatedAt,
    },
    viewImageInput: {
      projectId,
      providerVisibilityState: "metadata_only",
      providerVisibilityEvidence: "not_sent",
      metadataStrippingPolicy: "not_payload_sent",
      decodeCapsApplied: true,
      observedAt: generatedAt,
    },
    humanDecisionInput: {
      projectId,
      toolKind: "request_user_input",
      promptPreview: "No active request_user_input packet.",
      choices: [],
      freeTextAllowed: true,
      createdAt: generatedAt,
    },
    newContextInput: {
      projectId,
      reason: "blocked_until_context_maintenance_law",
      observedAt: generatedAt,
    },
  });
  assertControlToolSubstrateSafe(status);
  return status;
}

function buildDirectRuntimeWitnessProjectionForProject(input = {}) {
  const project = input.project || {};
  const projectId = normalizeString(project.id || input.runtimeStatus?.projectId, "");
  const runtimeStatus = input.runtimeStatus || {};
  const agentUsageStatus = input.agentUsageStatus || {};
  const generatedAt = normalizeString(input.generatedAt, nowIso());
  const directProviderMetadata = input.directProviderMetadata || {};
  const metadataProfile = directProviderMetadata.profile || input.providerMetadataProfile || null;
  const driftReport = directProviderMetadata.driftReport || input.metadataDriftReport || null;
  const selected = directMetadataSelectedModel(metadataProfile || {}, project, runtimeStatus);
  const selectedModel = selected.id;
  const modelEvidenceState = metadataProfile?.modelCatalog?.source || runtimeStatus.models?.source || "";
  const modelState = metadataProfile ? directMetadataWitnessState(metadataProfile, driftReport || {}) : directWitnessStateFromEvidence(modelEvidenceState);
  const reasoningEffort = directMetadataReasoningEffort(metadataProfile || {}, project, selected.descriptor);
  const reasoningState = reasoningEffort
    ? metadataProfile ? modelState : "diagnostic"
    : "unknown";
  const usageAvailable = agentUsageStatus.schema === "direct_agent_usage_summary_projection@1";
  const missingUsage = Number(agentUsageStatus.totals?.missingUsageRowCount || 0);
  const knownUsage = Number(agentUsageStatus.totals?.totalTokensKnown || 0);
  const usageState = usageAvailable
    ? missingUsage
      ? "diagnostic"
      : knownUsage > 0
        ? "fresh"
        : "unknown"
    : "unknown";
  const appServerFallback = input.appServerFallbackParity || {};
  const appServerFallbackState = normalizeString(appServerFallback.parityState, "");
  const quotaWindows = metadataProfile ? directMetadataQuotaWindows(metadataProfile) : [];
  const quotaState = quotaWindows.length ? modelState : "unknown";
  const contextLabel = metadataProfile ? directMetadataContextLabel(metadataProfile, selected.descriptor, agentUsageStatus) : "Context unknown";
  const contextHasFill = Number(agentUsageStatus?.latestUsage?.inputTokensKnown ?? metadataProfile?.usage?.context?.usedTokens ?? metadataProfile?.usage?.context?.tokensInWindow ?? 0) > 0;
  const contextState = contextHasFill
    ? modelState
    : selected.descriptor?.contextWindow
      ? "diagnostic"
      : "unknown";
  const driftStatus = normalizeString(driftReport?.status, metadataProfile ? "stable" : "unknown");
  const driftState = driftStatus === "invalid" || driftStatus === "blocked"
    ? "blocked"
    : driftStatus === "stable" || driftStatus === "ok"
      ? modelState
      : driftStatus === "unknown"
        ? "unknown"
        : "diagnostic";
  return buildRuntimeWitnessProjection({
    projectId,
    generatedAt,
    chips: [
      {
        kind: "model",
        label: selectedModel
          ? `Model ${selectedModel} (${modelEvidenceState || "unknown"})`
          : "Model unknown",
        state: modelState,
        evidenceRefs: [runtimeWitnessEvidenceRef("direct_provider_metadata", metadataProfile?.profileDigest || runtimeStatus.statusDigest || "runtime_status", "Direct provider model metadata")],
      },
      {
        kind: "reasoning",
        label: reasoningEffort
          ? `Reasoning ${reasoningEffort} (${metadataProfile ? "metadata" : "configured"})`
          : "Reasoning effort unknown",
        state: reasoningState,
        evidenceRefs: [runtimeWitnessEvidenceRef("direct_provider_metadata", metadataProfile?.profileDigest || projectId || "project", "Direct reasoning metadata")],
      },
      {
        kind: "quota",
        label: metadataProfile ? directMetadataQuotaLabel(metadataProfile) : "Quota/rate unknown (no direct read authority)",
        state: quotaState,
        evidenceRefs: [runtimeWitnessEvidenceRef("quota", appServerFallbackState || "quota_not_read", "Quota/rate not read by direct witness", "unknown")],
      },
      {
        kind: "usage",
        label: usageAvailable
          ? `Usage rows ${Number(agentUsageStatus.rowCount || 0)} · known tokens ${knownUsage}`
          : "Usage unavailable",
        state: usageState,
        evidenceRefs: [runtimeWitnessEvidenceRef("direct_agent_usage", agentUsageStatus.projectionDigest || agentUsageStatus.ledgerDigest || "usage_projection", "Direct usage witness")],
      },
      {
        kind: "context",
        label: contextLabel,
        state: contextState,
        evidenceRefs: [runtimeWitnessEvidenceRef("direct_provider_metadata", metadataProfile?.profileDigest || "context_unknown", "Direct context metadata", metadataProfile ? "observed" : "unknown")],
      },
      {
        kind: "drift",
        label: driftReport
          ? `Drift ${driftStatus} (${Number(driftReport.unknownEnums?.length || 0)} unknown, ${Number(driftReport.missingFields?.length || 0)} missing)`
          : "Drift unknown (no direct drift report)",
        state: driftState,
        evidenceRefs: [runtimeWitnessEvidenceRef("direct_metadata_drift", driftReport?.reportDigest || "drift_not_run", "Direct metadata drift report", driftReport ? "observed" : "unknown")],
      },
    ],
  });
}

function directRuntimeWitnessChip(witness = {}, kind = "") {
  return (Array.isArray(witness.chips) ? witness.chips : [])
    .find((chip) => normalizeString(chip?.kind, "") === kind) || null;
}

function directCompactWitnessLabel(label = "", prefix = "") {
  const text = normalizeString(label, "");
  if (!text) return "";
  const trimmed = prefix && text.toLowerCase().startsWith(prefix.toLowerCase())
    ? text.slice(prefix.length).trim()
    : text;
  return trimmed.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

function buildDirectComposerRuntimeWitness(input = {}) {
  const runtimeWitness = input.runtimeWitnessProjection || {};
  const contextPreview = input.contextPreview || {};
  const agentUsage = input.agentUsageStatus || {};
  const modelChip = directRuntimeWitnessChip(runtimeWitness, "model");
  const reasoningChip = directRuntimeWitnessChip(runtimeWitness, "reasoning");
  const quotaChip = directRuntimeWitnessChip(runtimeWitness, "quota");
  const usageChip = directRuntimeWitnessChip(runtimeWitness, "usage");
  const contextChip = directRuntimeWitnessChip(runtimeWitness, "context");
  const sourceCount = Number(contextPreview?.rendererSafeSummary?.sourceCount ?? contextPreview?.counts?.rowCount ?? 0);
  const includedCount = Number(contextPreview?.rendererSafeSummary?.includedSourceCount ?? contextPreview?.counts?.includedSourceCount ?? 0);
  const blockerCount = Number(contextPreview?.rendererSafeSummary?.blockerCount ?? 0);
  const knownTokens = Number(agentUsage?.totals?.totalTokensKnown || 0);
  return {
    schema: "direct_composer_runtime_witness@1",
    modelLabel: directCompactWitnessLabel(modelChip?.label, "Model") || "model unknown",
    modelState: normalizeString(modelChip?.state, "unknown"),
    reasoningLabel: directCompactWitnessLabel(reasoningChip?.label, "Reasoning") || "reasoning unknown",
    reasoningState: normalizeString(reasoningChip?.state, "unknown"),
    quotaLabel: directCompactWitnessLabel(quotaChip?.label, "Quota/rate") || "quota unknown",
    quotaState: normalizeString(quotaChip?.state, "unknown"),
    usageLabel: knownTokens > 0
      ? `usage ${knownTokens} token${knownTokens === 1 ? "" : "s"} known`
      : directCompactWitnessLabel(usageChip?.label, "Usage") || "usage unknown",
    usageState: normalizeString(usageChip?.state, "unknown"),
    contextLabel: contextChip
      ? directCompactWitnessLabel(contextChip.label, "Context")
      : sourceCount
      ? `context preview ${includedCount}/${sourceCount}`
      : "context preview unknown",
    contextState: blockerCount ? "blocked" : normalizeString(contextChip?.state, sourceCount ? "diagnostic" : "unknown"),
    contextPreviewDigest: normalizeString(contextPreview.previewDigest, ""),
    usageProjectionDigest: normalizeString(agentUsage.projectionDigest, ""),
    runtimeWitnessDigest: normalizeString(runtimeWitness.integrity?.artifactDigest || runtimeWitness.projectionDigest, ""),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function buildDirectCodexSurfaceProjectionForProject(project = {}, input = {}) {
  const projectId = normalizeString(project?.id, "");
  const activeThreadId = normalizeString(input.threadId || input.activeThreadId || "", "");
  const runtimeStatus = input.runtimeStatus || buildDirectRuntimeStatusForProject(project);
  const liveTextStatus = input.liveTextStatus || ensureDirectLiveTextController().statusForProject(project);
  const agentUsageStatus = input.agentUsageStatus || buildDirectAgentUsageStatusForProject(projectId);
  const workThreadBundle = input.workThreadBundle || directWorkThreadProjectionForProject(project);
  const agentRegistryBundle = input.agentRegistryBundle || directAgentRegistryProjectionForProject(project);
  const appServerFallbackParity = input.appServerFallbackParity || runtimeStatus.appServerFallbackParity || buildAppServerFallbackParityReport({
    projectId,
    runtimeStatus,
    legacySession: currentLegacyAppServerSnapshot(),
  });
  const directProviderMetadata = input.directProviderMetadata || directProviderMetadataStatusForProject(project);
  if (directProviderMetadata?.profile) {
    try {
      ensureDirectThreadStore().recordDirectRuntimeAnalyticsFacts({
        projectId,
        providerMetadataProfile: directProviderMetadata.profile,
      });
    } catch {}
  }
  const generatedAt = normalizeString(input.generatedAt, nowIso());
  const runtimeWitnessProjection = input.runtimeWitnessProjection || buildDirectRuntimeWitnessProjectionForProject({
    project,
    runtimeStatus,
    agentUsageStatus,
    appServerFallbackParity,
    directProviderMetadata,
    generatedAt,
  });
  const contextPreview = input.contextPreview || directContextPreviewForProject(project, {
    runtimeStatus,
    runtimeWitnessProjection,
    agentUsageStatus,
    workThreadBundle,
  });
  const operatorBroker = input.operatorBroker || directOperatorBrokerProjectionForProject(project, workThreadBundle);
  const composerRuntimeWitness = buildDirectComposerRuntimeWitness({
    runtimeWitnessProjection,
    contextPreview,
    agentUsageStatus,
  });
  let directRuntimeAnalyticsSnapshot = null;
  try {
    directRuntimeAnalyticsSnapshot = ensureDirectThreadStore().getDirectRuntimeAnalyticsFactSnapshot(projectId, {
      threadId: activeThreadId,
    });
  } catch {}
  const runtimeAnalyticsProjection = buildRuntimeAnalyticsProjection({
    projectId,
    threadId: activeThreadId,
    runtimePath: directRuntimePathFromBinding(project?.surfaceBinding?.codex || {}),
    directFactSnapshot: directRuntimeAnalyticsSnapshot,
    directProviderMetadataProfile: directProviderMetadata?.profile || null,
    generatedAt,
  });
  const projection = {
    schema: "direct_codex_surface_projection@1",
    projectId,
    generatedAt,
    runtimePath: directRuntimePathFromBinding(project?.surfaceBinding?.codex || {}),
    liveTextStatus,
    directAuthPreflight: input.directAuthPreflight || null,
    runtimeWitnessProjection,
    composerRuntimeWitness,
    providerMetadataProfile: directProviderMetadata?.profile || null,
    metadataDriftReport: directProviderMetadata?.driftReport || null,
    metadataCacheState: normalizeString(directProviderMetadata?.cacheState, ""),
    contextPreview,
    agentUsageStatus,
    runtimeAnalyticsProjection,
    operatorBroker,
    workThreads: {
      status: workThreadBundle.status,
      projection: workThreadBundle.projection,
      resolutionReport: workThreadBundle.resolutionReport,
    },
    agents: {
      status: agentRegistryBundle.status,
      projection: agentRegistryBundle.projection,
      backfillReport: agentRegistryBundle.backfillReport,
    },
    attachmentCapability: input.attachmentCapability || null,
    authority: {
      displayOnly: true,
      rendererSafe: true,
      runtimeMutationAllowed: false,
      providerTransportAllowed: false,
      workspaceMutationAllowed: false,
      rawTextIncluded: false,
      rawPathIncluded: false,
      rawSecretIncluded: false,
    },
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  projection.projectionDigest = crypto.createHash("sha256").update(JSON.stringify([
    projection.schema,
    projectId,
    generatedAt,
    projection.runtimePath,
    runtimeAnalyticsProjection.projectionDigest,
    composerRuntimeWitness.runtimeWitnessDigest,
    composerRuntimeWitness.contextPreviewDigest,
    composerRuntimeWitness.usageProjectionDigest,
    workThreadBundle?.projection?.projectionDigest || "",
  ])).digest("hex");
  return projection;
}

function emitDirectRuntimeStatus(project = currentProject) {
  if (!project) return null;
  const status = buildDirectRuntimeStatusForProject(project);
  emitShellEvent({
    type: "direct-runtime-status",
    status,
    at: nowIso(),
  });
  return status;
}

async function withDirectActivationLock(projectId, action) {
  const key = normalizeString(projectId, "");
  if (!key) throw new Error("Direct activation requires a project id.");
  if (directActivationLocks.has(key)) {
    const error = new Error("A direct activation or rollback is already running for this project.");
    error.code = "direct_activation_conflict";
    throw error;
  }
  const run = Promise.resolve()
    .then(action)
    .finally(() => {
      if (directActivationLocks.get(key) === run) directActivationLocks.delete(key);
    });
  directActivationLocks.set(key, run);
  return run;
}

function directActivationEvaluationForProject(project) {
  const controller = ensureDirectAuthController();
  const authSettings = controller.readSettings();
  const runtimeAuthStore = directRuntimeAuthStore();
  const runtimeAuthStatus = runtimeAuthStore.readStatus();
  const credentials = runtimeAuthStore.readCredentials() || {};
  authSettings.authStatus = runtimeAuthStatus;
  const profileDoc = ensureDirectCodexProfileDoc();
  const sessionStore = ensureDirectSessionStore();
  const projectId = normalizeString(project?.id, "");
  const activationStoreStatus = projectId ? ensureDirectActivationStore().statusForProject(projectId) : {};
  return evaluateDirectExperimentalProjectActivation({
    project,
    authSettings,
    authStatus: authSettings.authStatus,
    profileDoc,
    sessionStore: sessionStore.status(),
    imports: ensureDirectImportController().statusForProject(project),
    liveTextStatus: ensureDirectLiveTextController().statusForProject(project),
    workspaceStatus: workspaceBackends?.statusForProject(project) || null,
    activationStoreStatus,
    latestActivation: activationStoreStatus.latestActivation || null,
    accountEvidenceKey: normalizeString(credentials.accountId || credentials.chatgptAccountId, ""),
    attachOnFirstTurnAccepted: false,
    profileHash: normalizeString(profileDoc.summary?.profileHash || profileDoc.profile?.profileHash, ""),
  });
}

function projectWithCodexBinding(project, codexBinding) {
  return {
    ...project,
    updatedAt: nowIso(),
    surfaceBinding: {
      ...project.surfaceBinding,
      codex: {
        ...(project.surfaceBinding?.codex || {}),
        ...(codexBinding || {}),
      },
    },
  };
}

async function switchActiveCodexRuntimePath(project, runtimePath, reason = "active-runtime-path-switch") {
  const projectId = normalizeString(project?.id, "");
  if (!projectId) throw new Error("Project not found.");
  const activeTurns = activeDirectTurnCountForProject(ensureDirectSessionStore(), projectId);
  if (activeTurns > 0) {
    const error = new Error("A direct turn is active. Wait before changing the active runtime selection.");
    error.code = "active_direct_turn_exists";
    throw error;
  }
  const nextBinding = bindingForDirectRuntimePath(project.surfaceBinding?.codex || {}, runtimePath);
  const activeProject = projectWithCodexBinding(project, nextBinding);
  currentProject = activeProject;
  await loadCodexSurface(activeProject, { activationEpoch: nextSurfaceActivationEpoch(reason) });
  emitDirectRuntimeStatus(activeProject);
  return {
    ok: true,
    runtimePath,
    activeOnly: true,
    project: activeProject,
    config: null,
    status: buildDirectRuntimeStatusForProject(activeProject),
  };
}

async function enableDirectExperimentalProject(payload = {}) {
  const projectId = normalizeString(payload.projectId, "");
  return withDirectActivationLock(projectId, async () => {
    const config = await loadConfig();
    const project = config.projects.find((item) => item.id === projectId);
    if (!project) throw new Error("Project not found.");
    const store = ensureDirectActivationStore();
    const duplicate = store.findActivationByClientId(projectId, payload.clientActivationId);
    if (duplicate?.transactionState === "committed") {
      return {
        ok: true,
        duplicate: true,
        activation: duplicate,
        status: buildDirectRuntimeStatusForProject(project).activation,
      };
    }
    if (duplicate && duplicate.transactionState !== "abandoned") {
      const error = new Error("Direct activation idempotency key is already in use.");
      error.code = "direct_activation_id_conflict";
      throw error;
    }
    const evaluation = directActivationEvaluationForProject(project);
    const gate = evaluation.gate;
    if (gate.state !== "eligible") {
      const error = new Error("Direct experimental activation gates are not eligible.");
      error.code = "direct_activation_not_eligible";
      error.activation = evaluation.status;
      throw error;
    }
    if (normalizeString(payload.expectedGateId, "") && normalizeString(payload.expectedGateId, "") !== gate.gateId) {
      const error = new Error("Direct experimental activation gate is stale.");
      error.code = "gate_stale";
      error.activation = evaluation.status;
      throw error;
    }
    if (normalizeString(payload.expectedGateDigest, "") && normalizeString(payload.expectedGateDigest, "") !== gate.gateDigest) {
      const error = new Error("Direct experimental activation digest is stale.");
      error.code = "gate_stale";
      error.activation = evaluation.status;
      throw error;
    }
    const pending = store.createPendingActivation(project, gate, payload.clientActivationId || newId("client_activation"));
    let committed = null;
    try {
      const latestConfig = await loadConfig();
      const nextProjects = latestConfig.projects.map((item) =>
        item.id === projectId ? projectWithCodexBinding(item, pending.activatedBindingPrivate) : item,
      );
      const saved = await saveConfig({ ...latestConfig, projects: nextProjects });
      const savedProject = saved.projects.find((item) => item.id === projectId) || project;
      const savedDigest = activationProjectBindingDigest(savedProject.surfaceBinding?.codex || {});
      if (savedDigest !== pending.activatedBindingDigest) {
        store.markActivationAbandoned(pending, "binding_digest_mismatch");
        throw new Error("Direct experimental activation binding digest mismatch.");
      }
      committed = store.markActivationCommitted(pending);
      currentProject = savedProject;
      await loadCodexSurface(savedProject, { activationEpoch: nextSurfaceActivationEpoch("direct-activation") });
      const status = buildDirectRuntimeStatusForProject(savedProject).activation;
      emitDirectRuntimeStatus(savedProject);
      return { ok: true, activation: committed, project: savedProject, config: saved, status };
    } catch (error) {
      if (!committed) store.markActivationAbandoned(pending, error.message || "activation_failed");
      throw error;
    }
  });
}

async function selectDirectTextOnlyRuntime(payload = {}) {
  const projectId = normalizeString(payload.projectId, "");
  return withDirectActivationLock(projectId, async () => {
    const config = await loadConfig();
    const project = config.projects.find((item) => item.id === projectId);
    if (!project) throw new Error("Project not found.");
    const activeTurns = activeDirectTurnCountForProject(ensureDirectSessionStore(), projectId);
    if (activeTurns > 0) {
      const error = new Error("A direct turn is active. Wait before changing the runtime selection.");
      error.code = "active_direct_turn_exists";
      throw error;
    }
    const store = ensureDirectActivationStore();
    const clientOperationId = normalizeString(payload.clientOperationId || payload.clientSelectionId, "") || newId("client_runtime_selection");
    const duplicate = store.findRuntimeSelectionByClientId(projectId, clientOperationId);
    if (duplicate?.transactionState === "committed") {
      return {
        ok: true,
        duplicate: true,
        selection: duplicate,
        status: buildDirectRuntimeStatusForProject(project).directTextOnly,
      };
    }
    if (duplicate && duplicate.transactionState !== "abandoned") {
      const error = new Error("Direct runtime selection idempotency key is already in use.");
      error.code = "direct_runtime_selection_id_conflict";
      throw error;
    }
    const controller = ensureDirectAuthController();
    const authSettings = controller.readSettings();
    authSettings.authStatus = directRuntimeAuthStore().readStatus();
    const sessionStore = ensureDirectSessionStore();
    const liveTextStatus = ensureDirectLiveTextController().statusForProject(project);
    const activationStoreStatus = store.statusForProject(projectId);
    const evaluation = evaluateDirectTextOnlyRuntimeSelection({
      project,
      authSettings,
      authStatus: authSettings.authStatus,
      profileDoc: ensureDirectCodexProfileDoc(),
      sessionStore: sessionStore.status(),
      liveTextStatus,
      activationStoreStatus,
      latestSelection: activationStoreStatus.latestRuntimeSelection || null,
    });
    const gate = evaluation.gate;
    if (gate.state !== "eligible" && gate.state !== "enabled") {
      const error = new Error("Direct text-only runtime gates are not eligible.");
      error.code = "direct_text_only_not_eligible";
      error.status = evaluation.status;
      throw error;
    }
    if (normalizeString(payload.expectedGateId, "") && normalizeString(payload.expectedGateId, "") !== gate.gateId) {
      const error = new Error("Direct text-only runtime gate is stale.");
      error.code = "gate_stale";
      error.status = evaluation.status;
      throw error;
    }
    if (normalizeString(payload.expectedGateDigest, "") && normalizeString(payload.expectedGateDigest, "") !== gate.gateDigest) {
      const error = new Error("Direct text-only runtime digest is stale.");
      error.code = "gate_stale";
      error.status = evaluation.status;
      throw error;
    }
    const pending = store.createPendingRuntimeSelection(project, gate, clientOperationId);
    let committed = null;
    try {
      const latestConfig = await loadConfig();
      const nextProjects = latestConfig.projects.map((item) =>
        item.id === projectId ? projectWithCodexBinding(item, pending.selectedBindingPrivate) : item,
      );
      const saved = await saveConfig({ ...latestConfig, projects: nextProjects });
      const savedProject = saved.projects.find((item) => item.id === projectId) || project;
      const savedDigest = activationProjectBindingDigest(savedProject.surfaceBinding?.codex || {});
      if (savedDigest !== pending.selectedBindingDigest) {
        store.markRuntimeSelectionAbandoned(pending, "binding_digest_mismatch");
        throw new Error("Direct text-only runtime binding digest mismatch.");
      }
      committed = store.markRuntimeSelectionCommitted(pending);
      currentProject = savedProject;
      await loadCodexSurface(savedProject, { activationEpoch: nextSurfaceActivationEpoch("direct-text-only-selection") });
      const status = buildDirectRuntimeStatusForProject(savedProject).directTextOnly;
      emitDirectRuntimeStatus(savedProject);
      return { ok: true, selection: committed, project: savedProject, config: saved, status };
    } catch (error) {
      if (!committed) store.markRuntimeSelectionAbandoned(pending, error.message || "selection_failed");
      throw error;
    }
  });
}

function directEmbarkStep(step, status = "completed", details = {}) {
  return {
    step,
    status,
    at: nowIso(),
    ...details,
  };
}

function directEmbarkResult(projectId, status, details = {}) {
  return {
    schema: "direct_runtime_embark_result@1",
    ok: status === "direct_surface_ready" || status === "direct_thread_ready",
    projectId,
    status,
    rawTokensExposed: false,
    rawBackendFramesExposed: false,
    ...details,
  };
}

function directAuthIsAuthenticated(authStatus = {}) {
  return normalizeString(authStatus.status, "") === "authenticated";
}

async function directEmbarkAuthStatus(steps = []) {
  const authStore = directRuntimeAuthStore();
  let authStatus = authStore.readStatus();
  if (directAuthIsAuthenticated(authStatus)) {
    steps.push(directEmbarkStep("auth_ready"));
    return authStatus;
  }
  if (authStatus?.hasRefreshToken) {
    steps.push(directEmbarkStep("auth_refresh", "started"));
    try {
      await refreshDirectRuntimeCredentials();
      authStatus = authStore.readStatus();
      steps.push(directEmbarkStep("auth_refresh", directAuthIsAuthenticated(authStatus) ? "completed" : "failed", {
        authStatus: authStatus.status,
      }));
    } catch (error) {
      steps.push(directEmbarkStep("auth_refresh", "failed", {
        reason: normalizeString(error?.code || error?.message, "auth_refresh_failed"),
      }));
      authStatus = authStore.readStatus();
    }
  }
  if (directAuthIsAuthenticated(authStatus)) {
    steps.push(directEmbarkStep("auth_ready"));
  }
  return authStatus;
}

async function preflightDirectRuntimeAuth(reason = "direct-surface-load") {
  const steps = [directEmbarkStep(reason, "started")];
  try {
    const authStatus = await directEmbarkAuthStatus(steps);
    return {
      ok: directAuthIsAuthenticated(authStatus),
      authStatus,
      steps,
    };
  } catch (error) {
    return {
      ok: false,
      authStatus: directRuntimeAuthStore().readStatus(),
      steps: [
        ...steps,
        directEmbarkStep(reason, "failed", {
          reason: normalizeString(error?.code || error?.message, "direct_auth_preflight_failed"),
        }),
      ],
      error: {
        code: normalizeString(error?.code, "direct_auth_preflight_failed"),
        message: normalizeString(error?.message, "Direct auth preflight failed."),
      },
    };
  }
}

function directTextOnlyCanSelect(runtimeStatus = {}) {
  const status = normalizeString(runtimeStatus.directTextOnly?.status, "");
  return status === "eligible" || status === "enabled";
}

function directImplementationCanSelect(runtimeStatus = {}) {
  const implementation = runtimeStatus.directImplementationLane || {};
  const status = normalizeString(implementation.status, "");
  return implementation.canSelect === true ||
    implementation.canEnable === true ||
    status === "eligible" ||
    status === "enabled";
}

function directLiveProbeModel(project = {}, runtimeStatus = {}) {
  return normalizeString(
    project?.surfaceBinding?.codex?.model ||
      runtimeStatus.liveTextRuntime?.model ||
      runtimeStatus.liveTextRuntime?.status?.model ||
      runtimeStatus.directTextOnly?.scope?.model,
    "",
  );
}

async function recordDirectEmbarkLiveProbe(project, runtimeStatus, steps = []) {
  const profileDoc = ensureDirectCodexProfileDoc();
  const authStore = directRuntimeAuthStore();
  const model = directLiveProbeModel(project, runtimeStatus);
  steps.push(directEmbarkStep("probing", "started", { model: model || "profile-default" }));
  const result = await runTextOnlyDirectProbe({
    authStore,
    refreshCredentials: () => refreshDirectRuntimeCredentials(),
    profileDoc,
    model,
    prompt: DEFAULT_TEXT_PROBE_PROMPT,
    instructions: DEFAULT_TEXT_PROBE_INSTRUCTIONS,
  });
  const requestedModel = normalizeString(result.requestShape?.model || model, "");
  const recorded = ensureDirectLiveProbeEvidenceStore().recordProbeResult(result, {
    source: "direct-runtime-embark",
    project,
    profileDoc,
    authStatus: authStore.readStatus(),
    credentials: authStore.readCredentials(),
    model: requestedModel,
    promptClass: "fixed-live-text-probe",
    prompt: DEFAULT_TEXT_PROBE_PROMPT,
  });
  steps.push(directEmbarkStep("probing", recorded.view?.usable ? "completed" : "failed", {
    evidenceStatus: recorded.view?.status || "unknown",
    evidenceId: recorded.view?.evidenceId || "",
  }));
  return {
    probeResult: {
      ok: Boolean(result.ok),
      terminalState: normalizeString(result.terminal?.state, ""),
      responseStatus: Number(result.response?.status || 0),
      evidenceStatus: recorded.view?.status || "",
      evidenceUsable: recorded.view?.usable === true,
      evidenceId: recorded.view?.evidenceId || "",
      rawBackendFramesExposed: false,
    },
    recorded,
  };
}

async function embarkDirectRuntime(payload = {}) {
  const projectId = normalizeString(payload.projectId, "");
  const clientOperationId = normalizeString(payload.clientOperationId || payload.clientEmbarkId, "") || newId("client_direct_embark");
  const steps = [directEmbarkStep("requested")];
  const config = await loadConfig();
  const project = config.projects.find((item) => item.id === projectId);
  if (!project) throw new Error("Project not found.");

  let authStatus = await directEmbarkAuthStatus(steps);
  let runtimeStatus = buildDirectRuntimeStatusForProject(project);
  let probeResult = null;
  if (!directAuthIsAuthenticated(authStatus)) {
    steps.push(directEmbarkStep("auth_required", "blocked", { authStatus: authStatus.status || "unknown" }));
    return directEmbarkResult(projectId, "auth_required", {
      loginRequired: true,
      steps,
      authStatus,
      runtimeStatus,
    });
  }

  if (!directImplementationCanSelect(runtimeStatus) && !directTextOnlyCanSelect(runtimeStatus)) {
    steps.push(directEmbarkStep("probe_required"));
    try {
      const probe = await recordDirectEmbarkLiveProbe(project, runtimeStatus, steps);
      probeResult = probe.probeResult;
    } catch (error) {
      runtimeStatus = buildDirectRuntimeStatusForProject(project);
      return directEmbarkResult(projectId, "probe_failed", {
        steps,
        authStatus,
        runtimeStatus,
        error: {
          code: normalizeString(error?.code, "direct_probe_failed"),
          message: normalizeString(error?.message, "Direct probe failed."),
        },
      });
    }
    runtimeStatus = buildDirectRuntimeStatusForProject(project);
  }

  if (!directImplementationCanSelect(runtimeStatus) && !directTextOnlyCanSelect(runtimeStatus)) {
    return directEmbarkResult(projectId, "probe_failed", {
      steps,
      authStatus,
      runtimeStatus,
      probeResult,
      error: {
        code: "direct_not_eligible",
        message: "Direct gates are still blocked after probe.",
      },
    });
  }

  steps.push(directEmbarkStep("switching_backend", "started"));
  try {
    const runtimePath = directImplementationCanSelect(runtimeStatus) ? "direct-implementation" : "direct-text";
    const selection = await setCodexRuntimePath({
      ...payload,
      projectId,
      runtimePath,
      clientOperationId,
      expectedGateId: runtimePath === "direct-text" ? runtimeStatus.directTextOnly?.gateId || "" : "",
      expectedGateDigest: runtimePath === "direct-text" ? runtimeStatus.directTextOnly?.gateDigest || "" : "",
    });
    steps.push(directEmbarkStep("switching_backend", "completed"));
    return directEmbarkResult(projectId, "direct_surface_ready", {
      duplicate: selection?.duplicate === true,
      runtimePath,
      steps,
      authStatus: directRuntimeAuthStore().readStatus(),
      runtimeStatus: selection?.status || buildDirectRuntimeStatusForProject(selection?.project || project),
      probeResult,
      project: selection?.project,
      config: selection?.config,
      selection: selection?.selection || null,
    });
  } catch (error) {
    runtimeStatus = buildDirectRuntimeStatusForProject(project);
    steps.push(directEmbarkStep("switching_backend", "failed", {
      reason: normalizeString(error?.code || error?.message, "switch_failed"),
    }));
    return directEmbarkResult(projectId, "switch_failed", {
      steps,
      authStatus: directRuntimeAuthStore().readStatus(),
      runtimeStatus,
      error: {
        code: normalizeString(error?.code, "switch_failed"),
        message: normalizeString(error?.message, "Direct backend switch failed."),
      },
    });
  }
}

async function setCodexRuntimePath(payload = {}) {
  const projectId = normalizeString(payload.projectId, "");
  const runtimePath = normalizeDirectRuntimePath(payload.runtimePath || payload.path);
  const persistDefault = payload.persistDefault !== false;
  const config = await loadConfig();
  const project = config.projects.find((item) => item.id === projectId);
  if (!project) throw new Error("Project not found.");

  const currentPath = directRuntimePathFromBinding(project.surfaceBinding?.codex || {});
  if (persistDefault && currentPath === runtimePath) {
    return {
      ok: true,
      duplicate: true,
      runtimePath,
      project,
      config,
      status: buildDirectRuntimeStatusForProject(project),
    };
  }

  if (runtimePath === "direct-implementation") {
    return enableDirectExperimentalProject({
      ...payload,
      projectId,
      clientActivationId: payload.clientActivationId || payload.clientOperationId,
      expectedRuntimeMode: "direct-experimental",
      expectedDirectTransport: "live-text",
    });
  }

  if (!persistDefault) {
    return switchActiveCodexRuntimePath(project, runtimePath, `active-runtime-path-${runtimePath}`);
  }

  if (runtimePath === "direct-text") {
    return selectDirectTextOnlyRuntime({
      ...payload,
      projectId,
      clientOperationId: payload.clientOperationId || payload.clientSelectionId,
    });
  }

  return withDirectActivationLock(projectId, async () => {
    const latestConfig = await loadConfig();
    const latestProject = latestConfig.projects.find((item) => item.id === projectId);
    if (!latestProject) throw new Error("Project not found.");
    const activeTurns = activeDirectTurnCountForProject(ensureDirectSessionStore(), projectId);
    if (activeTurns > 0) {
      const error = new Error("A direct turn is active. Wait before changing the runtime selection.");
      error.code = "active_direct_turn_exists";
      throw error;
    }
    const nextBinding = bindingForDirectRuntimePath(latestProject.surfaceBinding?.codex || {}, "app-server");
    const nextProjects = latestConfig.projects.map((item) =>
      item.id === projectId ? projectWithCodexBinding(item, nextBinding) : item,
    );
    const saved = await saveConfig({ ...latestConfig, projects: nextProjects });
    const savedProject = saved.projects.find((item) => item.id === projectId) || latestProject;
    currentProject = savedProject;
    await loadCodexSurface(savedProject, { activationEpoch: nextSurfaceActivationEpoch("runtime-path-app-server") });
    emitDirectRuntimeStatus(savedProject);
    return {
      ok: true,
      runtimePath: "app-server",
      project: savedProject,
      config: saved,
      status: buildDirectRuntimeStatusForProject(savedProject),
    };
  });
}

async function rollbackDirectExperimentalProject(payload = {}) {
  const projectId = normalizeString(payload.projectId, "");
  return withDirectActivationLock(projectId, async () => {
    const config = await loadConfig();
    const project = config.projects.find((item) => item.id === projectId);
    if (!project) throw new Error("Project not found.");
    const activeTurns = activeDirectTurnCountForProject(ensureDirectSessionStore(), projectId);
    if (activeTurns > 0) {
      const error = new Error("A direct turn is active. Abort or wait before rollback.");
      error.code = "active_direct_turn_exists";
      throw error;
    }
    const store = ensureDirectActivationStore();
    const duplicate = store.findRollbackByClientId(projectId, payload.clientRollbackId);
    if (duplicate?.transactionState === "committed") {
      return {
        ok: true,
        duplicate: true,
        rollback: duplicate,
        status: buildDirectRuntimeStatusForProject(project).activation,
      };
    }
    const activation = normalizeString(payload.activationId, "")
      ? store.readActivation(projectId, payload.activationId)
      : store.latestCommittedActivation(projectId);
    if (!activation) {
      const selection = store.latestCommittedRuntimeSelection(projectId);
      const fallbackActivation = {
        activationId: "",
        previousBindingPrivate: selection?.previousBindingPrivate || {
          ...(project.surfaceBinding?.codex || {}),
          bindingProvider: "codex-compatible",
          runtimeMode: "legacy-app-server",
          directTier: "none",
          directTransport: "fixture",
        },
      };
      const pending = store.createPendingRollback(project, fallbackActivation, payload.clientRollbackId || newId("client_rollback"), "schema_incompatible");
      const latestConfig = await loadConfig();
      const nextProjects = latestConfig.projects.map((item) =>
        item.id === projectId ? projectWithCodexBinding(item, pending.restoredBindingPrivate) : item,
      );
      const saved = await saveConfig({ ...latestConfig, projects: nextProjects });
      const committed = store.markRollbackCommitted(pending, null);
      const savedProject = saved.projects.find((item) => item.id === projectId) || project;
      currentProject = savedProject;
      await loadCodexSurface(savedProject, { activationEpoch: nextSurfaceActivationEpoch("direct-rollback") });
      emitDirectRuntimeStatus(savedProject);
      return { ok: true, rollback: committed, project: savedProject, config: saved, status: buildDirectRuntimeStatusForProject(savedProject).activation };
    }
    const pending = store.createPendingRollback(project, activation, payload.clientRollbackId || newId("client_rollback"), payload.reason || "user_requested");
    const latestConfig = await loadConfig();
    const nextProjects = latestConfig.projects.map((item) =>
      item.id === projectId ? projectWithCodexBinding(item, pending.restoredBindingPrivate) : item,
    );
    const saved = await saveConfig({ ...latestConfig, projects: nextProjects });
    const savedProject = saved.projects.find((item) => item.id === projectId) || project;
    const savedDigest = activationProjectBindingDigest(savedProject.surfaceBinding?.codex || {});
    if (savedDigest !== pending.restoredBindingDigest) {
      const error = new Error("Direct experimental rollback binding digest mismatch.");
      error.code = "direct_rollback_digest_mismatch";
      throw error;
    }
    const committed = store.markRollbackCommitted(pending, activation);
    currentProject = savedProject;
    await loadCodexSurface(savedProject, { activationEpoch: nextSurfaceActivationEpoch("direct-rollback") });
    emitDirectRuntimeStatus(savedProject);
    return { ok: true, rollback: committed, project: savedProject, config: saved, status: buildDirectRuntimeStatusForProject(savedProject).activation };
  });
}

function ensureCodexAppServerManager() {
  if (codexAppServer) return codexAppServer;
  codexAppServer = new CodexAppServerManager();
  codexAppServer.on("status", (payload) => {
    emitShellEvent({ type: "codex-runtime-status", ...payload });
    const sessionStatus = payload?.session?.status || "starting";
    const eventType =
      sessionStatus === "ready"
        ? "loaded"
        : ["failed", "exited"].includes(sessionStatus)
          ? "load-failed"
          : "loading";
    emitToShell("surface:event", {
      surface: "codex",
      type: eventType,
      title: sessionStatus,
      url: payload?.session?.wsUrl || "",
      errorDescription: payload?.session?.error || "",
      at: payload.at,
    });
  });
  return codexAppServer;
}

async function disposeCodexAppServerManager() {
  if (!codexAppServer) return;
  const manager = codexAppServer;
  codexAppServer = null;
  await manager.dispose();
}

function ensureLocalSurfaceServer() {
  if (localSurfaceServer) return localSurfaceServer;
  localSurfaceServer = new LocalSurfaceServer(rendererRoot);
  return localSurfaceServer;
}

function ensureCodexSurfaceSessions() {
  if (codexSurfaceSessions) return codexSurfaceSessions;
  codexSurfaceSessions = new Map();
  return codexSurfaceSessions;
}

function normalizedWebContentsAuthority(profile = {}) {
  return {
    surfaceRole: normalizeSurfaceRole(profile.surfaceRole),
    codexTrustProfile: normalizeCodexTrustProfile(profile.codexTrustProfile),
    codexBridgeProfile: normalizeCodexBridgeProfile(profile.codexBridgeProfile),
    surfaceName: normalizeString(profile.surfaceName, ""),
    projectId: normalizeString(profile.projectId, ""),
    targetUrl: normalizeString(profile.targetUrl, ""),
    reason: normalizeString(profile.reason, ""),
    updatedAt: nowIso(),
  };
}

function registerWebContentsAuthority(view, profile = {}) {
  const contents = view?.webContents || view;
  if (!contents || contents.isDestroyed()) return null;
  const authority = normalizedWebContentsAuthority(profile);
  webContentsAuthorityProfiles.set(contents.id, authority);
  if (!webContentsAuthorityCleanupRegistered.has(contents.id)) {
    webContentsAuthorityCleanupRegistered.add(contents.id);
    contents.once("destroyed", () => {
      webContentsAuthorityProfiles.delete(contents.id);
      webContentsAuthorityCleanupRegistered.delete(contents.id);
    });
    contents.on("did-start-navigation", (_event, url, isInPlace, isMainFrame) => {
      if (!isMainFrame || isInPlace) return;
      const current = webContentsAuthorityProfiles.get(contents.id);
      if (current?.surfaceName !== "codex" || !hasFullCodexBridge(current)) return;
      if (urlsShareCodexSurfaceDocument(url, current.targetUrl)) return;
      demoteCodexSurfaceAuthorityForNavigation(contents, url, "main-frame-navigation-demotion");
    });
  }
  return authority;
}

function updateWebContentsAuthority(view, profile = {}) {
  const contents = view?.webContents || view;
  if (!contents || contents.isDestroyed()) return null;
  const previous = webContentsAuthorityProfiles.get(contents.id) || {};
  return registerWebContentsAuthority(contents, { ...previous, ...profile });
}

function senderAuthority(sender) {
  if (!sender || sender.isDestroyed?.()) {
    return normalizedWebContentsAuthority({ surfaceRole: SURFACE_ROLES.UNKNOWN });
  }
  return webContentsAuthorityProfiles.get(sender.id) ||
    normalizedWebContentsAuthority({ surfaceRole: SURFACE_ROLES.UNKNOWN });
}

function urlsShareCodexSurfaceDocument(left, right) {
  try {
    const leftUrl = new URL(String(left || ""));
    const rightUrl = new URL(String(right || ""));
    const managedSurfacePath = (pathname) =>
      pathname.endsWith("/codex-surface.html") ||
      pathname.endsWith("/t3-direct-surface.html");
    return leftUrl.href === rightUrl.href ||
      (
        leftUrl.origin === rightUrl.origin &&
        leftUrl.pathname === rightUrl.pathname &&
        managedSurfacePath(leftUrl.pathname)
      );
  } catch {
    return false;
  }
}

function codexCurrentUrlMatchesAuthority(authority, currentUrl) {
  if (!hasFullCodexBridge(authority)) return false;
  if (
    authority.codexTrustProfile !== CODEX_SURFACE_TRUST_PROFILES.MANAGED_LOCAL_SURFACE &&
    authority.codexTrustProfile !== CODEX_SURFACE_TRUST_PROFILES.FALLBACK_LOCAL_SURFACE
  ) {
    return false;
  }
  return urlsShareCodexSurfaceDocument(currentUrl, authority.targetUrl);
}

function demoteCodexSurfaceAuthorityForNavigation(contents, targetUrl, reason = "navigation-demotion") {
  const current = webContentsAuthorityProfiles.get(contents.id) || {};
  updateWebContentsAuthority(contents, {
    ...codexSurfaceAuthorityForTarget(targetUrl),
    surfaceName: "codex",
    projectId: current.projectId || "",
    targetUrl,
    reason,
  });
  if (codexSurfaceSessions?.has(contents.id)) {
    const session = codexSurfaceSessions.get(contents.id);
    codexSurfaceSessions.delete(contents.id);
    session?.dispose?.({ silent: true, reason: "Codex surface authority demoted." }).catch(() => {});
  }
  activeCodexSurfaceConnection = null;
}

function requireSenderRole(sender, allowedRoles, channel) {
  const authority = senderAuthority(sender);
  if (!allowedRoles.includes(authority.surfaceRole)) {
    throw new Error(`${channel} is not available from ${authority.surfaceRole || SURFACE_ROLES.UNKNOWN}.`);
  }
  return authority;
}

function requireFullCodexSurfaceBridge(sender, channel) {
  const authority = requireSenderRole(sender, [SURFACE_ROLES.TRUSTED_CODEX_SURFACE], channel);
  if (!hasFullCodexBridge(authority)) {
    throw new Error(`${channel} requires a trusted managed Codex surface bridge.`);
  }
  const currentUrl = normalizeString(sender?.getURL?.(), "");
  if (!codexCurrentUrlMatchesAuthority(authority, currentUrl)) {
    throw new Error(`${channel} requires the active trusted Codex surface document.`);
  }
  return authority;
}

function requireShellOrTrustedCodex(sender, channel) {
  const authority = requireSenderRole(sender, [SURFACE_ROLES.SHELL_RENDERER, SURFACE_ROLES.TRUSTED_CODEX_SURFACE], channel);
  if (authority.surfaceRole === SURFACE_ROLES.TRUSTED_CODEX_SURFACE && !hasFullCodexBridge(authority)) {
    throw new Error(`${channel} requires a trusted managed Codex surface bridge.`);
  }
  return authority;
}

function setCodexSurfaceAuthority(profile = {}) {
  if (!codexView?.webContents || codexView.webContents.isDestroyed()) return null;
  return updateWebContentsAuthority(codexView, {
    surfaceName: "codex",
    ...profile,
  });
}

function setManagedCodexSurfaceAuthority(project, targetUrl, reason) {
  return setCodexSurfaceAuthority({
    ...codexSurfaceAuthorityForTarget(targetUrl, {
      trustProfile: CODEX_SURFACE_TRUST_PROFILES.MANAGED_LOCAL_SURFACE,
      bridgeProfile: CODEX_SURFACE_BRIDGE_PROFILES.FULL,
    }),
    projectId: project?.id || "",
    targetUrl,
    reason,
  });
}

function setExternalCodexSurfaceAuthority(project, targetUrl, reason) {
  return setCodexSurfaceAuthority({
    ...codexSurfaceAuthorityForTarget(targetUrl),
    projectId: project?.id || "",
    targetUrl,
    reason,
  });
}

function isCodexSurfaceSender(sender) {
  return Boolean(codexView?.webContents && !codexView.webContents.isDestroyed() && sender.id === codexView.webContents.id);
}

function codexSurfaceSessionKindForConnection(connection = {}) {
  const transport = normalizeString(connection?.transport, "");
  if (transport === DIRECT_FIXTURE_SURFACE_TRANSPORT) return DIRECT_FIXTURE_SURFACE_TRANSPORT;
  if (transport === DIRECT_LIVE_TEXT_SURFACE_TRANSPORT) return DIRECT_LIVE_TEXT_SURFACE_TRANSPORT;
  return "codex-app-server";
}

function createCodexSurfaceSession(sender, connection = {}) {
  const kind = codexSurfaceSessionKindForConnection(connection);
  if (kind === DIRECT_FIXTURE_SURFACE_TRANSPORT) {
    return new DirectFixtureSurfaceSession(sender, {
      controller: ensureDirectFixtureController(),
      project: currentProject,
    });
  }
  if (kind === DIRECT_LIVE_TEXT_SURFACE_TRANSPORT) {
    return new DirectLiveTextSurfaceSession(sender, {
      controller: ensureDirectLiveTextController(),
      project: currentProject,
    });
  }
  const usageLedger = new UsageLedgerCollector({
    getProjectById,
    emitStatus: (status) => {
      if (sender.isDestroyed()) return;
      sender.send("codex-surface:event", {
        type: "usage-ledger-status",
        status,
        at: nowIso(),
      });
    },
  });
  const session = new CodexSurfaceSession(sender, { usageLedger });
  session.transportKind = "codex-app-server";
  return session;
}

function refreshActiveDirectCodexSurfaceCapabilities() {
  const transport = normalizeString(activeCodexSurfaceConnection?.transport, "");
  if (transport === DIRECT_LIVE_TEXT_SURFACE_TRANSPORT) {
    const liveTextStatus = currentProject ? ensureDirectLiveTextController().statusForProject(currentProject) : null;
    activeCodexSurfaceConnection = {
      ...activeCodexSurfaceConnection,
      capabilities: buildDirectLiveTextCapabilities(liveTextStatus || {}),
      directLiveText: liveTextStatus || null,
    };
    return activeCodexSurfaceConnection.capabilities;
  }
  if (transport === DIRECT_FIXTURE_SURFACE_TRANSPORT) {
    activeCodexSurfaceConnection = {
      ...activeCodexSurfaceConnection,
      capabilities: buildDirectFixtureCapabilities(),
    };
    return activeCodexSurfaceConnection.capabilities;
  }
  return activeCodexSurfaceConnection?.capabilities || {};
}

function directLiveTextAuthorizationCapabilities(capabilities = {}) {
  const clone = typeof structuredClone === "function"
    ? structuredClone(capabilities || {})
    : JSON.parse(JSON.stringify(capabilities || {}));
  clone.coreRuntime = {
    ...(clone.coreRuntime || {}),
    canInitialize: true,
  };
  clone.account = {
    ...(clone.account || {}),
    canRead: true,
  };
  clone.configRequirements = {
    ...(clone.configRequirements || {}),
    canRead: true,
  };
  clone.threads = {
    ...(clone.threads || {}),
    canStart: true,
    canRead: true,
    canList: true,
  };
  clone.turns = {
    ...(clone.turns || {}),
    canStart: true,
    canInterrupt: true,
  };
  return clone;
}

function codexSurfaceRequestAuthorizationCapabilities() {
  const capabilities = refreshActiveDirectCodexSurfaceCapabilities();
  const transport = normalizeString(activeCodexSurfaceConnection?.transport, "");
  if (transport === DIRECT_LIVE_TEXT_SURFACE_TRANSPORT) {
    return directLiveTextAuthorizationCapabilities(capabilities);
  }
  return capabilities;
}

function codexSurfaceSessionFor(sender, options = {}) {
  if (!isCodexSurfaceSender(sender)) throw new Error("Codex surface bridge is not available from this renderer.");
  requireFullCodexSurfaceBridge(sender, "codex-surface session");
  const sessions = ensureCodexSurfaceSessions();
  const requestedKind = options.connection ? codexSurfaceSessionKindForConnection(options.connection) : "";
  const existing = sessions.get(sender.id);
  if (existing && (!requestedKind || existing.transportKind === requestedKind)) return existing;
  if (existing) {
    sessions.delete(sender.id);
    if (existing.destroyedListener) sender.removeListener("destroyed", existing.destroyedListener);
    existing.dispose({ silent: true, reason: "Codex surface runtime changed." }).catch(() => {});
  }
  const session = createCodexSurfaceSession(sender, options.connection || {});
  session.on("event", (payload) => {
    if (payload?.type === "rpc-request" || payload?.type === "rpc-request-updated") {
      emitShellEvent({
        type: "codex-request-updated",
        request: payload.request || payload,
        at: nowIso(),
      });
    }
    if (payload?.type === "rpc-request") {
      const reason = payload.request?.summary || payload.params?.reason || payload.params?.command || "";
      emitShellEvent({
        type: "codex-approval-requested",
        method: payload.method,
        reason,
        at: nowIso(),
      });
    }
  });
  sessions.set(sender.id, session);
  session.destroyedListener = () => {
    if (sessions.get(sender.id) !== session) return;
    session.dispose({ silent: true, reason: "Codex surface renderer destroyed." }).catch(() => {});
    sessions.delete(sender.id);
  };
  sender.once("destroyed", session.destroyedListener);
  return session;
}

async function directAuthTokensForCodexAppServer(options = {}) {
  const store = directRuntimeAuthStore();
  let credentials = store.readCredentials();
  if (!credentials) return null;

  const status = store.readStatus();
  if (options.refresh || status.status === "expired" || status.status === "refresh_failed") {
    const refreshResult = await refreshDirectRuntimeCredentials();
    if (!refreshResult.ok) {
      const reason = normalizeString(refreshResult.reason || refreshResult.status, "direct_auth_refresh_failed");
      const normalizedReason = reason.toLowerCase().replace(/[^a-z0-9_ -]+/g, " ").trim();
      const error = new Error(
        normalizedReason === "expired" || normalizedReason === "invalid_grant" || normalizedReason.includes("token expired")
          ? "Direct auth expired. Sign in again before starting a direct Codex turn."
          : reason,
      );
      error.code = normalizedReason === "expired" || normalizedReason === "invalid_grant" || normalizedReason.includes("token expired")
        ? "direct_auth_expired"
        : "direct_auth_refresh_failed";
      throw error;
    }
    credentials = store.readCredentials();
  }

  const projected = codexAuthTokensFromCredentials(credentials || {}, {
    includeType: options.includeType !== false,
  });
  if (!projected.ok) throw new Error(projected.reason || "direct_auth_tokens_unavailable");
  return projected.tokens;
}

async function attachDirectAuthToCodexSession(session) {
  const loginTokens = await directAuthTokensForCodexAppServer({ includeType: true });
  if (!loginTokens) return { attached: false, reason: "direct_auth_unavailable" };
  await session.request("account/login/start", loginTokens);
  return { attached: true };
}

async function attachDirectAuthAfterInitialize(session, initializeResult) {
  try {
    return {
      result: initializeResult,
      directAuth: await attachDirectAuthToCodexSession(session),
    };
  } catch (error) {
    const reason = error?.message || "direct_auth_attach_failed";
    emitShellEvent({
      type: "direct-auth-bridge-status",
      status: "failed",
      reason,
      at: nowIso(),
    });
    return {
      result: initializeResult,
      directAuth: {
        attached: false,
        optional: true,
        reason,
      },
    };
  }
}

function findCodexSurfaceSessionForRequest(requestKey) {
  const key = String(requestKey || "");
  if (!key || !codexSurfaceSessions) return null;
  for (const session of codexSurfaceSessions.values()) {
    if (session?.hasServerRequest?.(key)) return session;
  }
  return null;
}

async function disposeCodexSurfaceSession(reason = "Codex surface reloaded.") {
  if (!codexSurfaceSessions || !codexView?.webContents) return;
  const session = codexSurfaceSessions.get(codexView.webContents.id);
  if (!session) return;
  codexSurfaceSessions.delete(codexView.webContents.id);
  await session.dispose({ silent: true, reason });
}

async function attachProjectWorkspace(project, options = {}) {
  const manager = ensureWorkspaceBackendManager();
  const wait = options.wait !== false;
  const attachPromise = manager.ensureForProject(project);
  if (wait) return attachPromise;
  attachPromise.catch((error) => {
    emitShellEvent({
      type: "backend-status",
      session: manager.statusForProject(project),
      error: error.message,
      at: nowIso(),
    });
  });
  return manager.statusForProject(project);
}

async function requestWorkspace(project, method, params = {}, timeoutMs) {
  const manager = ensureWorkspaceBackendManager();
  return manager.requestForProject(project, method, params, timeoutMs);
}

function scheduleLayoutPing(reason = "window-change") {
  if (!shellView || shellView.webContents.isDestroyed()) return;
  if (layoutPingTimer) clearTimeout(layoutPingTimer);
  const delays = [0, 40, 100, 220, 420];
  for (const delay of delays) {
    setTimeout(() => {
      if (!mainWindow || !shellView || shellView.webContents.isDestroyed()) return;
      emitShellEvent({ type: "layout-request", reason, bounds: mainWindow.getContentBounds(), at: nowIso() });
    }, delay);
  }
  layoutPingTimer = setTimeout(() => {
    layoutPingTimer = null;
  }, Math.max(...delays) + 10);
}

function safeLoadableUrl(value, surfaceName) {
  const fallback = surfaceName === "chatgpt" ? "https://chatgpt.com/" : null;
  try {
    const parsed = new URL(value || "");
    if (surfaceName === "chatgpt") {
      if (parsed.protocol !== "https:") return fallback;
      return parsed.toString();
    }
    if (parsed.protocol === "https:") return parsed.toString();
    if (parsed.protocol === "http:") {
      const host = parsed.hostname.toLowerCase();
      if (["localhost", "127.0.0.1", "::1"].includes(host)) return parsed.toString();
      return null;
    }
    if (parsed.protocol === "file:") return parsed.toString();
    return null;
  } catch {
    return fallback;
  }
}

function encodeProjectForLocalSurface(project) {
  return encodeCodexSurfacePayload(project, {});
}

function publicCodexSurfaceBinding(codex) {
  const raw = isPlainObject(codex) ? codex : {};
  const { remoteAuth: _remoteAuth, ...rest } = raw;
  const remoteAuth = normalizeRemoteAuthConfig(raw.remoteAuth);
  return {
    ...rest,
    remoteAuth: {
      mode: remoteAuth.mode,
      serverAuthScheme: remoteAuth.serverAuthScheme,
    },
  };
}

function encodeCodexSurfacePayload(project, extra = {}) {
  const payload = {
    project: {
      id: project.id,
      name: project.name,
      repoPath: project.repoPath,
      workspace: project.workspace,
      codex: publicCodexSurfaceBinding(project.surfaceBinding.codex),
      chatgpt: project.surfaceBinding.chatgpt,
      chatThreads: project.chatThreads,
      activeChatThreadId: project.activeChatThreadId,
      promptTemplates: project.promptTemplates,
      flowProfile: project.flowProfile,
    },
    shell: {
      generatedAt: nowIso(),
      doctrine: "Codex plane is a work chat. ADEU control plane owns the binding. ChatGPT plane remains the review/world-model thread.",
    },
    appExperience: publicAppExperience(APP_EXPERIENCE),
    codexConnection: extra.codexConnection || null,
    workspaceStatus: extra.workspaceStatus || null,
    activationEpoch: Number(extra.activationEpoch) || 0,
    initialThreadId: normalizeString(extra.initialThreadId, ""),
    initialThreadSourceHome: normalizeString(extra.initialThreadSourceHome, ""),
    initialThreadSessionFilePath: normalizeString(extra.initialThreadSessionFilePath, ""),
    initialThreadTitle: normalizeString(extra.initialThreadTitle, ""),
    error: normalizeString(extra.error, ""),
    runtimeStartupPending: Boolean(extra.runtimeStartupPending),
    runtimeStartupMessage: normalizeString(extra.runtimeStartupMessage, ""),
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function codexSurfaceUrl(baseUrl, project, extra = {}) {
  const token = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return `${baseUrl}/${APP_EXPERIENCE.rendererDocument}?reload=${token}#${encodeCodexSurfacePayload(project, extra)}`;
}

function codexSurfaceThreadExtras(options = {}) {
  return {
    activationEpoch: Number(options.activationEpoch) || 0,
    initialThreadId: normalizeString(options.initialThreadId, ""),
    initialThreadSourceHome: normalizeString(options.initialThreadSourceHome, ""),
    initialThreadSessionFilePath: normalizeString(options.initialThreadSessionFilePath, ""),
    initialThreadTitle: normalizeString(options.initialThreadTitle, ""),
  };
}

async function loadCodexSurface(project, options = {}) {
  if (!codexView || codexView.webContents.isDestroyed()) return;
  if (isStaleSurfaceActivationEpoch(options.activationEpoch)) return { skipped: true, stale: true };
  await disposeCodexSurfaceSession();
  const codex = project.surfaceBinding.codex;
  const localSurfaceBaseUrl = await ensureLocalSurfaceServer().ensureStarted();
  if (isStaleSurfaceActivationEpoch(options.activationEpoch)) return { skipped: true, stale: true };
  const threadExtras = codexSurfaceThreadExtras(options);
  const runtimeMode = normalizeDirectRuntimeModeForStatus(codex.runtimeMode);
  if (runtimeMode !== "legacy-app-server") {
    await disposeCodexAppServerManager();
    const directAuthPreflight = await preflightDirectRuntimeAuth("direct-surface-load");
    const directProviderMetadata = await refreshDirectProviderMetadataForProject(project);
    const runtimeStatus = buildDirectRuntimeStatusForProject(project);
    const directTransport = normalizeDirectExperimentalTransport(codex.directTransport);
    const isLiveText = directTransport === "live-text";
    const liveTextStatus = isLiveText ? ensureDirectLiveTextController().statusForProject(project) : null;
    const transport = isLiveText ? DIRECT_LIVE_TEXT_SURFACE_TRANSPORT : DIRECT_FIXTURE_SURFACE_TRANSPORT;
    const capabilities = isLiveText
      ? buildDirectLiveTextCapabilities(liveTextStatus)
      : buildDirectFixtureCapabilities();
    const directSurfaceProjection = buildDirectCodexSurfaceProjectionForProject(project, {
      runtimeStatus,
      liveTextStatus,
      directAuthPreflight,
      directProviderMetadata,
      attachmentCapability: capabilities.attachments || null,
    });
    const directConnection = {
      connectionRef: newId("direct_codex_conn"),
      projectId: project.id,
      transport,
      runtime: transport,
      directTier: codex.directTier || "none",
      workspaceRoot: workspaceRoot(project),
      capabilities,
      activationEpoch: Number(options.activationEpoch) || 0,
      directLiveText: liveTextStatus || null,
      directSurfaceProjection,
      fixture: isLiveText ? null : {
        id: "plain-text-turn",
        source: "normalized-fixture",
      },
    };
    activeCodexSurfaceConnection = directConnection;
    const localUrl = codexSurfaceUrl(localSurfaceBaseUrl, project, {
      codexConnection: directConnection,
      directSurfaceProjection,
      ...threadExtras,
      error: [
        `Direct runtime selected: ${runtimeStatus.runtimeModeLabel}.`,
        `Direct tier: ${runtimeStatus.directTier || "none"}.`,
        isLiveText
          ? `Live text direct controller selected: ${liveTextStatus?.status || "unknown"}.`
          : "Fixture-only direct controller is enabled; live direct backend turns are not runnable yet.",
        `Model source: ${runtimeStatus.models.source}.`,
      ].join(" "),
    });
    emitToShell("surface:event", {
      surface: "codex",
      type: "loaded",
      title: directRuntimeLaneLabel(codex),
      url: "",
      at: nowIso(),
    });
    emitDirectRuntimeStatus(project);
    if (isStaleSurfaceActivationEpoch(options.activationEpoch)) return { skipped: true, stale: true };
    setManagedCodexSurfaceAuthority(project, localUrl, "direct-local-ready");
    await codexView.webContents.loadURL(localUrl);
    return;
  }
  if (codex.mode === "url") {
    await disposeCodexAppServerManager();
    activeCodexSurfaceConnection = null;
    const target = safeLoadableUrl(codex.target, "codex");
    if (target) {
      if (isStaleSurfaceActivationEpoch(options.activationEpoch)) return { skipped: true, stale: true };
      setExternalCodexSurfaceAuthority(project, target, "configured-codex-url");
      await codexView.webContents.loadURL(target);
      return;
    }
  }
  if (codex.mode === "managed") {
    const workspaceStatus = workspaceBackends?.statusForProject(project) || null;
    try {
      const requestedCodexHome = normalizeString(options.codexHome, "");
      if (!options.codexSession) {
        activeCodexSurfaceConnection = null;
        const startingUrl = codexSurfaceUrl(localSurfaceBaseUrl, project, {
          ...threadExtras,
          workspaceStatus,
          runtimeStartupPending: true,
          runtimeStartupMessage: "Starting Codex app-server…",
        });
        if (isStaleSurfaceActivationEpoch(options.activationEpoch)) return { skipped: true, stale: true };
        setManagedCodexSurfaceAuthority(project, startingUrl, "managed-local-starting");
        await codexView.webContents.loadURL(startingUrl);
      }
      const session =
        options.codexSession ||
        await ensureCodexAppServerManager().ensureForProject(
          project,
          requestedCodexHome ? { codexHome: requestedCodexHome } : {},
        );
      if (isStaleSurfaceActivationEpoch(options.activationEpoch)) return { skipped: true, stale: true };
      const connectionAuthority = createCodexSurfaceConnectionAuthority(project, session, {
        activationEpoch: Number(options.activationEpoch) || 0,
      });
      activeCodexSurfaceConnection = connectionAuthority.privateConnection;
      const localUrl = codexSurfaceUrl(localSurfaceBaseUrl, project, {
        codexConnection: connectionAuthority.publicConnection,
        workspaceStatus,
        ...threadExtras,
      });
      if (isStaleSurfaceActivationEpoch(options.activationEpoch)) return { skipped: true, stale: true };
      setManagedCodexSurfaceAuthority(project, localUrl, "managed-local-ready");
      await codexView.webContents.loadURL(localUrl);
      return;
    } catch (error) {
      activeCodexSurfaceConnection = null;
      emitToShell("surface:event", {
        surface: "codex",
        type: "load-failed",
        title: error.message,
        at: nowIso(),
      });
      const degradedUrl = codexSurfaceUrl(localSurfaceBaseUrl, project, {
        ...threadExtras,
        workspaceStatus,
        error: error.message,
      });
      if (isStaleSurfaceActivationEpoch(options.activationEpoch)) return { skipped: true, stale: true };
      setManagedCodexSurfaceAuthority(project, degradedUrl, "managed-local-degraded");
      await codexView.webContents.loadURL(degradedUrl);
      return;
    }
  }
  await disposeCodexAppServerManager();
  activeCodexSurfaceConnection = null;
  const localUrl = codexSurfaceUrl(localSurfaceBaseUrl, project, threadExtras);
  if (isStaleSurfaceActivationEpoch(options.activationEpoch)) return { skipped: true, stale: true };
  setManagedCodexSurfaceAuthority(project, localUrl, "fallback-local-surface");
  await codexView.webContents.loadURL(localUrl);
}

async function loadChatgptSurface(project, threadId = "", options = {}) {
  if (!chatgptView || chatgptView.webContents.isDestroyed()) return;
  if (isStaleSurfaceActivationEpoch(options.activationEpoch)) return { skipped: true, stale: true };
  const thread = threadId
    ? project.chatThreads?.find((item) => item.id === threadId) || activeChatThread(project)
    : activeChatThread(project);
  const target = safeLoadableUrl(thread?.url || project.surfaceBinding.chatgpt.reviewThreadUrl, "chatgpt") || "https://chatgpt.com/";
  setActiveChatgptProjectThread(project, thread, "project-chatgpt-surface");
  if (isStaleSurfaceActivationEpoch(options.activationEpoch)) return { skipped: true, stale: true };
  await chatgptView.webContents.loadURL(target);
}

async function ensureChatgptThreadDisplayed(project, chatThread) {
  if (!chatgptView || chatgptView.webContents.isDestroyed()) {
    throw new Error("ChatGPT surface is unavailable.");
  }
  const target = safeLoadableUrl(chatThread?.url || project?.surfaceBinding?.chatgpt?.reviewThreadUrl, "chatgpt");
  if (!target) throw new Error("Linked ChatGPT thread URL is invalid.");
  if (!trustedChatgptPageUrl(target)) {
    throw new Error("ChatGPT file handoff is restricted to trusted ChatGPT/OpenAI origins.");
  }
  const currentUrl = chatgptView.webContents.getURL() || "";
  setActiveChatgptProjectThread(project, chatThread, "codex-file-review");
  if (urlsEquivalent(currentUrl, target)) {
    return { ok: true, reused: true, url: target };
  }
  await chatgptView.webContents.loadURL(target);
  return { ok: true, loaded: true, url: target };
}

async function requestCodexThreadOpen(projectId, threadId, sourceHome = "", sessionFilePath = "") {
  const nextThreadId = normalizeString(threadId, "");
  if (!nextThreadId) return { ok: false, error: "Codex thread id is required." };
  let persistedProject = null;
  try {
    persistedProject = await getProjectById(projectId);
  } catch (error) {
    return { ok: false, error: error.message || "Unable to resolve selected project." };
  }
  let project = currentProject?.id === persistedProject?.id ? currentProject : persistedProject;
  if (!project) return { ok: false, error: "No project is selected." };

  let session = null;
  let sessionStartupError = "";
  const requestedHome = normalizeString(sourceHome, "");
  const requestedSessionFilePath = normalizeString(sessionFilePath, "");
  const runtimeRoute = resolveCodexThreadOpenRuntime(project.surfaceBinding?.codex || {}, {
    threadId: nextThreadId,
    sourceHome: requestedHome,
    sessionFilePath: requestedSessionFilePath,
  });
  if (runtimeRoute.autoSwitch && runtimeRoute.selectedRuntimePath === "app-server") {
    const activeTurns = activeDirectTurnCountForProject(ensureDirectSessionStore(), project.id);
    if (activeTurns > 0) {
      return {
        ok: false,
        error: "A Direct turn is active. Wait before opening this app-server-native Codex thread.",
        runtimeRoute,
      };
    }
    project = projectWithCodexBinding(
      project,
      bindingForDirectRuntimePath(project.surfaceBinding?.codex || {}, "app-server"),
    );
    currentProject = project;
    emitDirectRuntimeStatus(project);
    emitShellEvent({
      type: "codex-runtime-auto-routed",
      projectId: project.id,
      threadId: nextThreadId,
      fromRuntimePath: runtimeRoute.currentRuntimePath,
      toRuntimePath: runtimeRoute.selectedRuntimePath,
      continuityMode: runtimeRoute.continuityMode,
      at: nowIso(),
    });
  }
  if (project.surfaceBinding?.codex?.mode === "managed") {
    try {
      session = await ensureCodexAppServerManager().ensureForProject(
        project,
        requestedHome ? { codexHome: requestedHome } : {},
      );
    } catch (error) {
      sessionStartupError = `Codex app-server startup failed: ${error.message}`;
    }
  }

  if (!codexView || codexView.webContents.isDestroyed()) {
    return { ok: false, error: "Codex surface is unavailable." };
  }
  const currentUrl = codexView.webContents.getURL() || "";
  const surfaceModeManaged = project.surfaceBinding?.codex?.mode === "managed";
  const hasLocalSurface =
    currentUrl.includes("codex-surface.html") ||
    currentUrl.includes("t3-direct-surface.html");
  const needsSurfaceReload = !hasLocalSurface ||
    !surfaceModeManaged ||
    !activeCodexSurfaceConnection ||
    String(activeCodexSurfaceConnection.wsUrl || "") !== String(session?.wsUrl || "") ||
    String(activeCodexSurfaceConnection.codexHome || "") !== String(session?.codexHome || "");

  const openEventPayload = {
    type: "open-thread-request",
    threadId: nextThreadId,
    sourceHome: requestedHome || session?.codexHome || "",
    sessionFilePath: requestedSessionFilePath,
    title: "",
    projectId: project.id,
    runtimeRoute,
    at: nowIso(),
  };
  rememberCodexThreadRestoreTarget({
    ...openEventPayload,
    status: "requested",
    activationEpoch: Number(activeCodexSurfaceConnection?.activationEpoch) || 0,
    evidence: "codex-select-thread",
  });

  if (needsSurfaceReload) {
    if (project.surfaceBinding?.codex?.mode !== "managed") {
      return { ok: false, error: "Codex surface is not in managed mode." };
    }
    const activationEpoch = nextSurfaceActivationEpoch();
    rememberCodexThreadRestoreTarget({
      ...openEventPayload,
      status: "requested",
      activationEpoch,
      evidence: "codex-select-thread-surface-reload",
    });
    const targetContents = codexView.webContents;
    const dispatchAfterLoad = new Promise((resolve) => {
      let settled = false;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        targetContents.removeListener("did-finish-load", onLoad);
      };
      const onLoad = () => {
        setTimeout(() => {
          cleanup();
          try {
            if (
              codexView &&
              codexView.webContents &&
              !codexView.webContents.isDestroyed() &&
              codexView.webContents.id === targetContents.id &&
              !isStaleSurfaceActivationEpoch(activationEpoch)
            ) {
              codexView.webContents.send("codex-surface:event", openEventPayload);
              resolve(true);
              return;
            }
          } catch {}
          resolve(false);
        }, 150);
      };
      const timeout = setTimeout(() => {
        cleanup();
        resolve(false);
      }, 2500);
      targetContents.once("did-finish-load", onLoad);
    });

    await loadCodexSurface(project, {
      codexSession: session,
      activationEpoch,
      initialThreadId: nextThreadId,
      initialThreadSourceHome: requestedHome || session?.codexHome || "",
      initialThreadSessionFilePath: requestedSessionFilePath,
    });
    const dispatchedAfterReload = await dispatchAfterLoad;
    return {
      ok: true,
      reloaded: true,
      dispatchedAfterReload,
      threadId: nextThreadId,
      sourceHome: requestedHome || session?.codexHome || "",
      warning: sessionStartupError,
      runtimeRoute,
    };
  }
  codexView.webContents.send("codex-surface:event", openEventPayload);
  return {
    ok: true,
    dispatched: true,
    threadId: nextThreadId,
    sourceHome: requestedHome || session?.codexHome || "",
    warning: sessionStartupError,
    runtimeRoute,
  };
}

async function reloadCodexRuntime(options = {}) {
  const requestedProjectId = normalizeString(options?.projectId || currentProject?.id, "");
  const project = await getProjectById(requestedProjectId);
  currentProject = project;
  const restoreTarget = chooseCodexThreadRestoreTarget(project, options?.restoreTarget || options) || null;
  const activationEpoch = nextSurfaceActivationEpoch();
  const mode = normalizeString(project?.surfaceBinding?.codex?.mode, "fallback");

  emitShellEvent({
    type: "codex-runtime-reload-started",
    projectId: project.id,
    threadId: restoreTarget?.threadId || "",
    at: nowIso(),
  });

  await disposeCodexSurfaceSession("Codex runtime restarted.");
  activeCodexSurfaceConnection = null;

  if (mode !== "managed") {
    await loadCodexSurface(project, {
      activationEpoch,
      initialThreadId: restoreTarget?.threadId || "",
      initialThreadSourceHome: restoreTarget?.sourceHome || "",
      initialThreadSessionFilePath: restoreTarget?.sessionFilePath || "",
      initialThreadTitle: restoreTarget?.title || "",
    });
    return {
      ok: true,
      restarted: false,
      reason: `Codex mode ${mode || "fallback"} does not manage a local executable.`,
      threadId: restoreTarget?.threadId || "",
      activationEpoch,
    };
  }

  if (codexAppServer) await codexAppServer.dispose();
  await loadCodexSurface(project, {
    activationEpoch,
    codexHome: restoreTarget?.sourceHome || "",
    initialThreadId: restoreTarget?.threadId || "",
    initialThreadSourceHome: restoreTarget?.sourceHome || "",
    initialThreadSessionFilePath: restoreTarget?.sessionFilePath || "",
    initialThreadTitle: restoreTarget?.title || "",
  });

  return {
    ok: true,
    restarted: true,
    threadId: restoreTarget?.threadId || "",
    sourceHome: restoreTarget?.sourceHome || "",
    sessionFilePath: restoreTarget?.sessionFilePath || "",
    title: restoreTarget?.title || "",
    activationEpoch,
  };
}

async function openChatgptThreadUrl(url) {
  const target = safeLoadableUrl(url, "chatgpt");
  if (!target) return { ok: false, error: "Invalid ChatGPT thread URL." };
  if (!chatgptView || chatgptView.webContents.isDestroyed()) {
    return { ok: false, error: "ChatGPT surface is unavailable." };
  }
  activeChatgptContext = await resolveChatgptContextForUrl(target);
  await chatgptView.webContents.loadURL(target);
  return { ok: true, url: target };
}

function safeHostDownloadFileName(value) {
  const base = path.basename(String(value || "download").replace(/\\/g, "/")).trim() || "download";
  const cleaned = base
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : "download";
}

function defaultChatgptWindowsDownloadDir() {
  return path.join(app.getPath("downloads"), "codex-review-shell", "chatgpt");
}

function chatgptWindowsDownloadDir(config) {
  const configured = normalizeString(config?.chatgptDownloads?.windowsDownloadDir, "");
  return configured ? path.resolve(configured) : defaultChatgptWindowsDownloadDir();
}

function uniqueHostDownloadPathSync(dirPath, fileName) {
  fsSync.mkdirSync(dirPath, { recursive: true });
  const parsed = path.parse(fileName);
  for (let index = 0; index < 1000; index += 1) {
    const candidateName = index === 0
      ? fileName
      : `${parsed.name || "download"}-${index}${parsed.ext || ""}`;
    const candidate = path.join(dirPath, candidateName);
    try {
      const fd = fsSync.openSync(candidate, "wx");
      fsSync.closeSync(fd);
      return candidate;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  throw new Error("Unable to allocate a unique ChatGPT download path.");
}

function fileViewMimeType(fileName) {
  const ext = path.extname(String(fileName || "")).toLowerCase();
  const map = {
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".mdown": "text/markdown",
    ".txt": "text/plain",
    ".log": "text/plain",
    ".json": "application/json",
    ".jsonl": "application/jsonl",
    ".yaml": "application/yaml",
    ".yml": "application/yaml",
    ".toml": "application/toml",
    ".csv": "text/csv",
    ".tsv": "text/tab-separated-values",
    ".js": "text/javascript",
    ".ts": "text/typescript",
    ".tsx": "text/typescript",
    ".jsx": "text/javascript",
    ".css": "text/css",
    ".html": "text/html",
    ".htm": "text/html",
    ".xml": "application/xml",
    ".py": "text/x-python",
    ".rs": "text/x-rust",
    ".go": "text/x-go",
    ".sh": "text/x-shellscript",
  };
  return map[ext] || "text/plain";
}

function isProbablyBinaryBuffer(buffer) {
  if (!buffer || buffer.length === 0) return false;
  if (buffer.includes(0)) return true;
  const text = buffer.toString("utf8");
  const replacementCount = (text.match(/\uFFFD/g) || []).length;
  return replacementCount > Math.max(8, text.length * 0.03);
}

function normalizeMiddleFileSource(options = {}) {
  const nested = isPlainObject(options.source) ? options.source : {};
  const surface = normalizeString(nested.surface || options.sourceSurface, "");
  if (!surface) return null;
  return {
    surface,
    threadId: normalizeString(nested.threadId || options.threadId, ""),
    threadTitle: normalizeString(nested.threadTitle || options.threadTitle, ""),
    itemId: normalizeString(nested.itemId || options.itemId, ""),
  };
}

function emitMiddleFileState(payload) {
  emitShellEvent({
    type: "middle-file-state",
    at: nowIso(),
    ...payload,
  });
}

function normalizeProjectFileViewRelPath(project, value) {
  const text = normalizeString(value, "").replace(/^<|>$/g, "").replace(/\\/g, "/");
  if (!text) return "";
  const root = workspaceRoot(project, repoRoot).replace(/\\/g, "/").replace(/\/+$/, "");
  if (root && text === root) return "";
  if (root && text.startsWith(`${root}/`)) return text.slice(root.length + 1);
  return text.replace(/^\/+/, "");
}

function prunePendingChatgptDownloadMacroRequests() {
  const now = Date.now();
  const cutoff = now - CHATGPT_DOWNLOAD_MACRO_REQUEST_TTL_MS;
  pendingChatgptDownloadMacroRequests = pendingChatgptDownloadMacroRequests.filter((request) => {
    const keep = request.createdAtMs >= cutoff && (!request.expiresAtMs || request.expiresAtMs >= now);
    if (!keep && request.timeout) clearTimeout(request.timeout);
    return keep;
  });
}

function enqueueChatgptDownloadMacroRequest(url, context, options = {}) {
  prunePendingChatgptDownloadMacroRequests();
  const targetUrl = safeDownloadLinkUrl(url);
  if (!targetUrl && !options.allowUnresolvedUrl) throw new Error("Download macro requires a safe HTTPS download URL.");
  const timeoutMs = Math.max(5_000, Math.min(Number(options.timeoutMs) || 15_000, CHATGPT_DOWNLOAD_MACRO_REQUEST_TTL_MS));
  const request = {
    id: `chatgpt_download_macro_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    url: targetUrl,
    context: context ? { ...context } : null,
    action: normalizeString(options.action, "send_to_codex"),
    createdAtMs: Date.now(),
    expiresAtMs: Date.now() + timeoutMs,
    timeout: null,
  };
  request.timeout = setTimeout(() => removePendingChatgptDownloadMacroRequest(request.id), timeoutMs);
  request.timeout.unref?.();
  pendingChatgptDownloadMacroRequests.push(request);
  return request;
}

function consumeChatgptDownloadMacroRequest(item) {
  prunePendingChatgptDownloadMacroRequests();
  if (!pendingChatgptDownloadMacroRequests.length) return null;
  const itemUrl = safeDownloadLinkUrl(item?.getURL?.() || "");
  let index = itemUrl
    ? pendingChatgptDownloadMacroRequests.findIndex((request) => urlsEquivalent(request.url, itemUrl))
    : -1;
  if (index < 0) {
    const stashIndex = pendingChatgptDownloadMacroRequests.findIndex((request) => (
      request.action === "add_to_project_stash" &&
      Date.now() - request.createdAtMs <= 30_000
    ));
    if (stashIndex >= 0) index = stashIndex;
  }
  if (index < 0 && pendingChatgptDownloadMacroRequests.length === 1) {
    const [candidate] = pendingChatgptDownloadMacroRequests;
    if (Date.now() - candidate.createdAtMs <= 30_000) index = 0;
  }
  if (index < 0) return null;
  const [request] = pendingChatgptDownloadMacroRequests.splice(index, 1);
  if (request.timeout) clearTimeout(request.timeout);
  return request;
}

function removePendingChatgptDownloadMacroRequest(requestId) {
  const target = normalizeString(requestId, "");
  if (!target) return;
  pendingChatgptDownloadMacroRequests = pendingChatgptDownloadMacroRequests.filter((request) => {
    const remove = request.id === target;
    if (remove && request.timeout) clearTimeout(request.timeout);
    return !remove;
  });
}

function findPendingChatgptDownloadMacroNavigation(url) {
  const targetUrl = safeDownloadLinkUrl(url);
  if (!targetUrl) return null;
  prunePendingChatgptDownloadMacroRequests();
  const directMatch = pendingChatgptDownloadMacroRequests.find((request) => (
    (request.action === "add_to_project_stash" || request.action === "open_in_files_tab" || request.action === "send_to_codex") &&
    urlsEquivalent(request.url, targetUrl)
  ));
  if (directMatch) return directMatch;
  const unresolved = pendingChatgptDownloadMacroRequests.filter((request) => (
    !request.url &&
    (request.action === "add_to_project_stash" || request.action === "open_in_files_tab" || request.action === "send_to_codex") &&
    Date.now() - request.createdAtMs <= 30_000
  ));
  return unresolved.length === 1 ? unresolved[0] : null;
}

function emitChatgptDownloadNavigationBlocked(request, url) {
  emitShellEvent({
    type: "chatgpt-download-failed",
    fileName: "download",
    state: request?.action === "add_to_project_stash" ? "stash-opened-link-instead-of-download" : "macro-opened-link-instead-of-download",
    error: "The selected ChatGPT target opened a link instead of starting a file download. Right-click the actual download link/control and choose a download action.",
    url,
    at: nowIso(),
  });
}

function downloadPendingChatgptMacroNavigation(contents, request, url) {
  const targetUrl = safeDownloadLinkUrl(url);
  if (!targetUrl) {
    emitChatgptDownloadNavigationBlocked(request, url);
    if (request?.id) removePendingChatgptDownloadMacroRequest(request.id);
    return false;
  }
  try {
    contents.downloadURL(targetUrl);
    return true;
  } catch (error) {
    emitShellEvent({
      type: "chatgpt-download-failed",
      fileName: "download",
      state: request?.action === "add_to_project_stash" ? "stash-download-start-failed" : "macro-download-start-failed",
      error: error.message,
      url: targetUrl,
      at: nowIso(),
    });
    if (request?.id) removePendingChatgptDownloadMacroRequest(request.id);
    return false;
  }
}

function urlsEquivalent(left, right) {
  try {
    const a = new URL(left);
    const b = new URL(right);
    a.hash = "";
    b.hash = "";
    return a.toString().replace(/\/+$/, "") === b.toString().replace(/\/+$/, "");
  } catch {
    return false;
  }
}

function trustedChatgptPageUrl(value) {
  try {
    const parsed = new URL(normalizeString(value, ""));
    return parsed.protocol === "https:" && isAllowedChatgptHost(parsed.hostname);
  } catch {
    return false;
  }
}

function safeDownloadLinkUrl(value) {
  try {
    const parsed = new URL(normalizeString(value, ""));
    if (parsed.protocol !== "https:") return "";
    if (parsed.username || parsed.password) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function isLikelyDownloadUrl(value) {
  try {
    const parsed = new URL(normalizeString(value, ""));
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase();
    const pathname = decodeURIComponent(parsed.pathname || "").toLowerCase();
    const search = parsed.search.toLowerCase();
    if (host.endsWith("oaiusercontent.com")) return true;
    if (!isAllowedChatgptHost(host)) return false;
    if (pathname.includes("/download") || pathname.includes("/backend-api/files/")) return true;
    if (search.includes("download=") || search.includes("response-content-disposition=attachment")) return true;
    return false;
  } catch {
    return false;
  }
}

async function resolveChatgptContextForUrl(url) {
  const config = await loadConfig();
  for (const project of config.projects || []) {
    for (const thread of project.chatThreads || []) {
      if (!thread?.archived && urlsEquivalent(thread.url, url)) {
        return {
          projectId: project.id,
          threadId: thread.id,
          url,
          source: "configured-chatgpt-thread",
        };
      }
    }
  }
  return { projectId: "", threadId: "", url, source: "unbound-url" };
}

function setActiveChatgptProjectThread(project, thread, source = "project-thread") {
  activeChatgptContext = {
    projectId: project?.id || "",
    threadId: thread?.id || "",
    url: thread?.url || "",
    source,
  };
}

function bindingForChatThread(project, chatThreadId) {
  const target = normalizeString(chatThreadId, "");
  if (!target) return null;
  return (project?.laneBindings || []).find((binding) => (
    normalizeString(binding?.chatThreadId, "") === target &&
    normalizeString(binding?.codexThreadRef?.threadId, "")
  )) || null;
}

function bindingsForCodexThread(project, codexThreadId) {
  const target = normalizeString(codexThreadId, "");
  if (!target) return [];
  const chatThreads = new Map((project?.chatThreads || [])
    .filter((thread) => normalizeString(thread?.id, "") && !thread.archived)
    .map((thread) => [thread.id, thread]));
  const byChatThreadId = new Map();
  for (const binding of project?.laneBindings || []) {
    const bindingCodexThreadId = normalizeString(binding?.codexThreadRef?.threadId, "");
    const chatThreadId = normalizeString(binding?.chatThreadId, "");
    if (bindingCodexThreadId !== target || !chatThreadId || !chatThreads.has(chatThreadId)) continue;
    if (!byChatThreadId.has(chatThreadId)) {
      byChatThreadId.set(chatThreadId, { binding, chatThread: chatThreads.get(chatThreadId) });
    }
  }
  return [...byChatThreadId.values()];
}

function renderDownloadMacroMessage(template, values) {
  const fallback = "GPT review is at {{workspacePath}}";
  const text = normalizeString(template, fallback);
  return text
    .replaceAll("{{workspacePath}}", values.workspacePath || "")
    .replaceAll("{{relPath}}", values.relPath || "")
    .replaceAll("{{fileName}}", values.fileName || "");
}

function chatgptCodexFileReviewScript(payload) {
  const safePayload = JSON.stringify(payload)
    .replace(/\\/g, "\\\\")
    .replace(/[$`]/g, "\\$&")
    .replace(/</g, "\\u003c");
  return `
    (async () => {
      const payload = ${safePayload};
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const visible = (element) => {
        if (!element) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const waitFor = async (fn, timeoutMs) => {
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
          const value = fn();
          if (value) return value;
          await sleep(150);
        }
        return null;
      };
      const decodeBase64 = (value) => Uint8Array.from(atob(value || ""), (char) => char.charCodeAt(0));
      const files = Array.isArray(payload.files) && payload.files.length
        ? payload.files
        : [{
            fileName: payload.fileName,
            mimeType: payload.mimeType,
            contentBase64: payload.contentBase64,
          }];
      if (!files.length || files.some((file) => !file || !file.contentBase64)) {
        return { ok: false, error: "no_files_to_attach", attached: false };
      }
      const fileInput = await waitFor(() => {
        const inputs = [...document.querySelectorAll('input[type="file"]')];
        return inputs.find((input) => !input.disabled && !input.webkitdirectory) || null;
      }, 6000);
      if (!fileInput) return { ok: false, error: "file_input_not_found", attached: false };
      const dataTransfer = new DataTransfer();
      for (const fileData of files) {
        const file = new File([decodeBase64(fileData.contentBase64)], fileData.fileName || "codex-output", {
          type: fileData.mimeType || "application/octet-stream",
        });
        dataTransfer.items.add(file);
      }
      fileInput.files = dataTransfer.files;
      fileInput.dispatchEvent(new Event("input", { bubbles: true }));
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(1200);

      const composer = await waitFor(() => (
        document.querySelector("#prompt-textarea") ||
        document.querySelector('textarea[data-testid="prompt-textarea"]') ||
        [...document.querySelectorAll('[contenteditable="true"]')].find(visible)
      ), 10000);
      if (!composer) return { ok: false, error: "composer_not_found", attached: true };

      composer.focus();
      if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(composer), "value")?.set;
        if (setter) setter.call(composer, payload.promptText || "");
        else composer.value = payload.promptText || "";
        composer.dispatchEvent(new Event("input", { bubbles: true }));
        composer.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(composer);
        selection.removeAllRanges();
        selection.addRange(range);
        document.execCommand("insertText", false, payload.promptText || "");
        if (!String(composer.textContent || "").includes(payload.promptText || "")) {
          composer.textContent = payload.promptText || "";
          composer.dispatchEvent(new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: payload.promptText || "",
          }));
        }
      }

      const findSendButton = () => {
        const preferred = document.querySelector('[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send message"]');
        if (preferred) return preferred;
        return [...document.querySelectorAll("button")].find((button) => {
          const label = [button.getAttribute("aria-label"), button.title, button.textContent].filter(Boolean).join(" ");
          return /\\bsend\\b/i.test(label);
        }) || null;
      };
      const sendButton = await waitFor(() => {
        const button = findSendButton();
        if (!button || !visible(button)) return null;
        if (button.disabled || button.getAttribute("aria-disabled") === "true") return null;
        return button;
      }, 30000);
      if (!sendButton) return { ok: false, error: "send_button_unavailable", attached: true };
      sendButton.click();
      return { ok: true, attached: true, submitted: true, fileCount: files.length };
    })();
  `;
}

function workspaceDisplayPath(project, relPath) {
  const rootPath = workspaceRoot(project, repoRoot).replace(/[\\/]+$/, "");
  const cleanRel = normalizeString(relPath, "").replace(/\\/g, "/").replace(/^\/+/, "");
  return cleanRel ? `${rootPath}/${cleanRel}` : rootPath;
}

async function importChatgptDownload(project, macro, hostPath, fileName) {
  const contentBase64 = await fs.readFile(hostPath, { encoding: "base64" });
  const result = await requestWorkspace(project, "importFile", {
    relDir: macro.workspaceRelDir,
    fileName,
    contentBase64,
  }, 90_000);
  return result;
}

async function resolveProjectFileReference(projectId, relPath) {
  const project = await getProjectById(projectId);
  const requestedRelPath = normalizeString(relPath, "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!requestedRelPath) throw new Error("File reference is empty.");
  const result = await requestWorkspace(project, "resolvePath", { relPath: requestedRelPath }, 10_000);
  if (!result?.isFile) throw new Error("Selected reference is not a workspace file.");
  return {
    project,
    relPath: normalizeString(result.relPath, requestedRelPath),
    resolved: result,
  };
}

function isMissingFileReferenceError(error) {
  return /ENOENT|no such file|not found|cannot find/i.test(error?.message || error || "");
}

function errorMessageText(error, fallback = "unknown error") {
  const value = error?.message || (typeof error === "string" ? error : error ? String(error) : "");
  return normalizeString(value, fallback);
}

async function resolveProjectFileReferenceWithFallback(projectId, relPath, fallbackRelPath = "") {
  try {
    return await resolveProjectFileReference(projectId, relPath);
  } catch (error) {
    const fallback = normalizeString(fallbackRelPath, "").replace(/\\/g, "/").replace(/^\/+/, "");
    if (!fallback || !isMissingFileReferenceError(error)) throw error;
    return resolveProjectFileReference(projectId, fallback);
  }
}

async function submitCodexFileBundleToChatgpt(fileTransfers, promptText = "review codex output") {
  if (!chatgptView || chatgptView.webContents.isDestroyed()) {
    throw new Error("ChatGPT surface is unavailable.");
  }
  const transfers = Array.isArray(fileTransfers) ? fileTransfers : [fileTransfers].filter(Boolean);
  if (!transfers.length) throw new Error("No files are available to send to ChatGPT.");
  let currentUrl = null;
  try {
    currentUrl = new URL(chatgptView.webContents.getURL() || "");
  } catch {
    throw new Error("ChatGPT surface URL is unavailable.");
  }
  if (!trustedChatgptPageUrl(currentUrl.toString())) {
    throw new Error("ChatGPT file handoff is restricted to trusted ChatGPT/OpenAI origins.");
  }
  const result = await chatgptView.webContents.executeJavaScript(chatgptCodexFileReviewScript({
    files: transfers.map((fileTransfer) => ({
      fileName: normalizeString(fileTransfer?.fileName, "codex-output"),
      mimeType: normalizeString(fileTransfer?.mimeType, "application/octet-stream"),
      contentBase64: normalizeString(fileTransfer?.contentBase64, ""),
    })),
    promptText: normalizeString(promptText, "review codex output"),
  }), true);
  if (!result?.ok) {
    throw new Error(`ChatGPT review submit failed: ${normalizeString(result?.error, "unknown_error")}`);
  }
  return result;
}

async function submitCodexFileReviewToChatgpt(fileTransfer) {
  return submitCodexFileBundleToChatgpt([fileTransfer], "review codex output");
}

async function sendCodexFileToLinkedChatgpt(projectId, codexThreadId, relPath) {
  const threadId = normalizeString(codexThreadId, "");
  if (!threadId) throw new Error("Codex thread id is unavailable.");
  const { project, relPath: resolvedRelPath } = await resolveProjectFileReference(projectId, relPath);
  const matches = bindingsForCodexThread(project, threadId);
  if (matches.length < 1) throw new Error("No linked ChatGPT thread was found for this Codex thread.");
  if (matches.length > 1) throw new Error("More than one linked ChatGPT thread was found for this Codex thread.");
  const { chatThread } = matches[0];
  const transfer = await requestWorkspace(project, "readFileTransfer", { relPath: resolvedRelPath }, 90_000);
  const surfaceResult = await ensureChatgptThreadDisplayed(project, chatThread);
  const submitResult = await submitCodexFileReviewToChatgpt(transfer);
  return {
    ok: true,
    projectId: project.id,
    codexThreadId: threadId,
    chatThreadId: chatThread.id,
    chatThreadTitle: normalizeString(chatThread.title, chatThread.id),
    relPath: normalizeString(transfer.relPath, resolvedRelPath),
    surfaceResult,
    submitResult,
  };
}

function linkedChatgptTargetForProjectStash(project, files) {
  const threadIds = [...new Set(files
    .map((file) => normalizeString(file?.codexThreadId, ""))
    .filter(Boolean))];
  if (threadIds.length > 1) {
    throw new Error("Stashed files belong to more than one Codex thread.");
  }
  if (threadIds.length === 1) {
    const matches = bindingsForCodexThread(project, threadIds[0]);
    if (matches.length < 1) throw new Error("No linked ChatGPT thread was found for this Codex thread.");
    if (matches.length > 1) throw new Error("More than one linked ChatGPT thread was found for this Codex thread.");
    return { ...matches[0], codexThreadId: threadIds[0] };
  }
  const binding = projectActivationBinding(project);
  const fallbackThread = primaryReviewThread(project);
  const chatThread = binding?.chatThreadId
    ? (project.chatThreads || []).find((thread) => thread.id === binding.chatThreadId && !thread.archived)
    : (fallbackThread && !fallbackThread.archived ? fallbackThread : null);
  if (!chatThread) throw new Error("No active linked ChatGPT thread was found for this project.");
  return {
    binding: binding || null,
    chatThread,
    codexThreadId: normalizeString(binding?.codexThreadRef?.threadId, ""),
  };
}

async function sendProjectStashToLinkedChatgpt(payload = {}) {
  const projectId = normalizeString(payload.projectId, "");
  const project = await getProjectById(projectId);
  const files = Array.isArray(payload.files)
    ? payload.files
      .map((file) => ({
        relPath: normalizeString(file?.relPath, "").replace(/\\/g, "/").replace(/^\/+/, ""),
        codexThreadId: normalizeString(file?.codexThreadId, ""),
      }))
      .filter((file) => file.relPath)
    : [];
  if (!files.length) throw new Error("Project stash is empty.");
  if (files.length > 12) throw new Error("Project stash is limited to 12 files per GPT handoff.");

  const seen = new Set();
  const uniqueFiles = [];
  for (const file of files) {
    const dedupeKey = `${file.codexThreadId}::${file.relPath}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    uniqueFiles.push(file);
  }
  const transfers = await Promise.all(uniqueFiles.map(async (file) => {
    const { relPath: resolvedRelPath } = await resolveProjectFileReference(project.id, file.relPath);
    const transfer = await requestWorkspace(project, "readFileTransfer", { relPath: resolvedRelPath }, 90_000);
    return {
      ...transfer,
      codexThreadId: file.codexThreadId,
      relPath: normalizeString(transfer.relPath, resolvedRelPath),
    };
  }));
  if (!transfers.length) throw new Error("No stashed files could be read from the workspace.");

  const target = linkedChatgptTargetForProjectStash(project, files);
  const surfaceResult = await ensureChatgptThreadDisplayed(project, target.chatThread);
  const submitResult = await submitCodexFileBundleToChatgpt(transfers, payload.message);
  return {
    ok: true,
    projectId: project.id,
    codexThreadId: target.codexThreadId,
    chatThreadId: target.chatThread.id,
    chatThreadTitle: normalizeString(target.chatThread.title, target.chatThread.id),
    fileCount: transfers.length,
    relPaths: transfers.map((transfer) => transfer.relPath),
    surfaceResult,
    submitResult,
  };
}

function codexTargetForProjectStash(project, files) {
  const threadIds = [...new Set(files
    .map((file) => normalizeString(file?.codexThreadId, ""))
    .filter(Boolean))];
  if (threadIds.length > 1) {
    throw new Error("Stashed files target more than one Codex thread.");
  }
  if (threadIds.length === 1) {
    const matches = (project?.laneBindings || []).filter((binding) =>
      normalizeString(binding?.codexThreadRef?.threadId, "") === threadIds[0]);
    if (matches.length < 1) throw new Error("No linked Codex thread was found for this stash.");
    return { binding: matches[0], codexThreadId: threadIds[0] };
  }
  const binding = projectActivationBinding(project);
  if (!binding?.codexThreadRef?.threadId) throw new Error("No active linked Codex thread was found for this project.");
  return { binding, codexThreadId: normalizeString(binding.codexThreadRef.threadId, "") };
}

async function sendProjectStashToLinkedCodex(payload = {}) {
  if (!codexView || codexView.webContents.isDestroyed()) {
    throw new Error("Codex surface is unavailable.");
  }
  const projectId = normalizeString(payload.projectId, "");
  const project = await getProjectById(projectId);
  const files = Array.isArray(payload.files)
    ? payload.files
      .map((file) => ({
        relPath: normalizeString(file?.relPath, "").replace(/\\/g, "/").replace(/^\/+/, ""),
        codexThreadId: normalizeString(file?.codexThreadId, ""),
      }))
      .filter((file) => file.relPath)
    : [];
  if (!files.length) throw new Error("Project stash is empty.");
  if (files.length > 12) throw new Error("Project stash is limited to 12 files per Codex handoff.");

  const seen = new Set();
  const uniqueFiles = [];
  for (const file of files) {
    const { relPath: resolvedRelPath } = await resolveProjectFileReference(project.id, file.relPath);
    const dedupeKey = `${file.codexThreadId}::${resolvedRelPath}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    uniqueFiles.push({ ...file, relPath: resolvedRelPath });
  }
  const target = codexTargetForProjectStash(project, uniqueFiles);
  const ref = target.binding.codexThreadRef || {};
  const message = normalizeString(payload.message, "review gpt output");
  const fileLines = uniqueFiles.map((file) => `- ${workspaceDisplayPath(project, file.relPath)}`).join("\n");
  const text = `${message}\n\nFiles:\n${fileLines}`;
  codexView.webContents.send("codex-surface:event", {
    type: "external-composer-message",
    source: "project-stash-chatgpt",
    projectId: project.id,
    threadId: normalizeString(ref.threadId, ""),
    sourceHome: normalizeString(ref.sourceHome, ""),
    sessionFilePath: normalizeString(ref.sessionFilePath, ""),
    title: normalizeString(ref.titleSnapshot, ""),
    text,
    activeTurnDisposition: normalizeString(payload.activeTurnDisposition, "queue"),
    at: nowIso(),
  });
  return {
    ok: true,
    projectId: project.id,
    codexThreadId: target.codexThreadId,
    codexThreadTitle: normalizeString(ref.titleSnapshot, target.codexThreadId),
    fileCount: uniqueFiles.length,
    relPaths: uniqueFiles.map((file) => file.relPath),
  };
}

function sendChatgptDownloadMessageToCodex(project, binding, macro, importResult, fileName) {
  if (!codexView || codexView.webContents.isDestroyed()) {
    return { ok: false, error: "Codex surface is unavailable." };
  }
  const ref = binding?.codexThreadRef || {};
  const relPath = normalizeString(importResult?.relPath, "");
  const text = renderDownloadMacroMessage(macro.messageTemplate, {
    workspacePath: workspaceDisplayPath(project, relPath),
    relPath,
    fileName,
  });
  codexView.webContents.send("codex-surface:event", {
    type: "external-composer-message",
    source: "chatgpt-download",
    projectId: project.id,
    threadId: normalizeString(ref.threadId, ""),
    sourceHome: normalizeString(ref.sourceHome, ""),
    sessionFilePath: normalizeString(ref.sessionFilePath, ""),
    title: normalizeString(ref.titleSnapshot, ""),
    text,
    activeTurnDisposition: macro.activeTurnDisposition || "queue",
    at: nowIso(),
  });
  return { ok: true };
}

async function runChatgptDownloadMacro(savePath, fileName, downloadContext = null, options = {}) {
  const context = downloadContext || activeChatgptContext || {};
  if (!context.projectId || !context.threadId) return { activated: false, reason: "unbound_chatgpt_thread" };
  const project = await getProjectById(context.projectId);
  const activeThread = (project.chatThreads || []).find((thread) => thread.id === context.threadId && !thread.archived);
  if (!activeThread) return { activated: false, reason: "chatgpt_thread_not_found" };
  const binding = bindingForChatThread(project, activeThread.id);
  if (!binding) return { activated: false, reason: "no_linked_codex_thread" };
  const macro = normalizeDownloadMacroConfig(project.surfaceBinding?.chatgpt?.downloadMacro);
  if (!macro.enabled) return { activated: false, reason: "project_macro_disabled" };
  const importResult = await importChatgptDownload(project, macro, savePath, fileName);
  let notifyResult = { ok: false, skipped: true };
  const shouldNotifyCodex = Object.prototype.hasOwnProperty.call(options, "notifyCodex")
    ? Boolean(options.notifyCodex)
    : macro.notifyCodex;
  if (shouldNotifyCodex) {
    notifyResult = sendChatgptDownloadMessageToCodex(project, binding, macro, importResult, fileName);
  }
  return {
    activated: true,
    projectId: project.id,
    chatThreadId: activeThread.id,
    chatThreadTitle: activeThread.title || "",
    codexThreadId: binding.codexThreadRef.threadId,
    importedRelPath: importResult.relPath,
    notifyResult,
  };
}

async function chatgptDownloadMacroAvailability(downloadContext = null) {
  let context = downloadContext || activeChatgptContext || {};
  if ((!context.projectId || !context.threadId) && chatgptView && !chatgptView.webContents.isDestroyed()) {
    context = await resolveChatgptContextForUrl(chatgptView.webContents.getURL() || "");
  }
  if (!context.projectId || !context.threadId) return { ok: false, reason: "No linked ChatGPT thread is active." };
  const project = await getProjectById(context.projectId);
  const activeThread = (project.chatThreads || []).find((thread) => thread.id === context.threadId && !thread.archived);
  if (!activeThread) return { ok: false, reason: "Active ChatGPT thread is not configured for this project." };
  const binding = bindingForChatThread(project, activeThread.id);
  if (!binding) return { ok: false, reason: "Active ChatGPT thread is not linked to a Codex thread." };
  const config = configCache || await loadConfig();
  const downloads = normalizeChatgptDownloadsConfig(config.chatgptDownloads);
  if (!downloads.enabled) return { ok: false, reason: "ChatGPT download bridge is disabled." };
  const macro = normalizeDownloadMacroConfig(project.surfaceBinding?.chatgpt?.downloadMacro);
  if (!macro.enabled) return { ok: false, reason: "Project download macro is disabled." };
  return {
    ok: true,
    project,
    activeThread,
    binding,
    context: { ...context },
  };
}

function chatgptElementFromPointClickScript(params = {}) {
  const x = Math.max(0, Math.round(Number(params.x) || 0));
  const y = Math.max(0, Math.round(Number(params.y) || 0));
  const directUrlForScript = JSON.stringify(safeDownloadLinkUrl(params.linkURL || params.srcURL || ""));
  return `
    (() => {
      const directUrlFromElectron = ${directUrlForScript};
      const start = document.elementFromPoint(${x}, ${y});
      if (!start) return { ok: false, error: "no_element_at_pointer" };
      const visible = (node) => {
        if (!node) return false;
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const safeHrefForCompare = (value) => {
        try {
          const url = new URL(String(value || ""), location.href);
          if (url.protocol !== "https:" || url.username || url.password) return "";
          url.hash = "";
          let normalized = url.toString();
          while (normalized.endsWith("/")) normalized = normalized.slice(0, -1);
          return normalized;
        } catch {
          return "";
        }
      };
      const candidates = [];
      const pushCandidate = (node) => {
        if (!node || candidates.includes(node)) return;
        candidates.push(node);
      };
      pushCandidate(start.closest?.("a[href]"));
      pushCandidate(start.closest?.("button"));
      pushCandidate(start.closest?.('[role="button"]'));
      for (let node = start; node && candidates.length < 8; node = node.parentElement) {
        pushCandidate(node.closest?.("a[href]"));
        pushCandidate(node.closest?.("button"));
        pushCandidate(node.closest?.('[role="button"]'));
      }
      let target = null;
      if (directUrlFromElectron) {
        target = candidates.find((node) => safeHrefForCompare(node.href || node.getAttribute?.("href")) === safeHrefForCompare(directUrlFromElectron));
      }
      if (!target) target = candidates.find(visible);
      if (!target) return { ok: false, error: "no_clickable_target_near_pointer" };
      const href = target.href || target.getAttribute?.("href") || "";
      const PointerEventClass = window.PointerEvent || MouseEvent;
      target.dispatchEvent(new PointerEventClass("pointerdown", { bubbles: true, cancelable: true, view: window }));
      target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return {
        ok: true,
        href: href ? new URL(href, location.href).toString() : "",
        tagName: target.tagName || "",
        text: String(target.textContent || "").trim().slice(0, 120),
      };
    })();
  `;
}

async function clickChatgptDownloadTarget(params = {}) {
  if (!chatgptView || chatgptView.webContents.isDestroyed()) throw new Error("ChatGPT surface is unavailable.");
  if (!trustedChatgptPageUrl(chatgptView.webContents.getURL() || "")) throw new Error("ChatGPT download action is restricted to trusted ChatGPT/OpenAI origins.");
  return chatgptView.webContents.executeJavaScript(chatgptElementFromPointClickScript(params), true);
}

async function startChatgptDownloadMacroFromContext(url, params = {}) {
  if (!chatgptView || chatgptView.webContents.isDestroyed()) throw new Error("ChatGPT surface is unavailable.");
  const targetUrl = safeDownloadLinkUrl(url);
  const context = activeChatgptContext || await resolveChatgptContextForUrl(chatgptView.webContents.getURL() || "");
  const availability = await chatgptDownloadMacroAvailability(context);
  if (!availability.ok) throw new Error(availability.reason);
  const request = enqueueChatgptDownloadMacroRequest(targetUrl, availability.context, { allowUnresolvedUrl: true });
  try {
    const clickResult = await clickChatgptDownloadTarget(params);
    if (!clickResult?.ok) throw new Error(clickResult?.error || "download_target_click_failed");
  } catch (error) {
    removePendingChatgptDownloadMacroRequest(request.id);
    throw error;
  }
  return {
    ok: true,
    url: targetUrl,
    projectId: availability.project.id,
    chatThreadId: availability.activeThread.id,
    codexThreadId: availability.binding.codexThreadRef.threadId,
  };
}

async function startChatgptDownloadFileViewFromContext(url, params = {}) {
  if (!chatgptView || chatgptView.webContents.isDestroyed()) throw new Error("ChatGPT surface is unavailable.");
  const targetUrl = safeDownloadLinkUrl(url);
  const context = activeChatgptContext || await resolveChatgptContextForUrl(chatgptView.webContents.getURL() || "");
  const request = enqueueChatgptDownloadMacroRequest(targetUrl, context, {
    action: "open_in_files_tab",
    allowUnresolvedUrl: true,
  });
  try {
    const clickResult = await clickChatgptDownloadTarget(params);
    if (!clickResult?.ok) throw new Error(clickResult?.error || "download_target_click_failed");
  } catch (error) {
    removePendingChatgptDownloadMacroRequest(request.id);
    throw error;
  }
  return { ok: true, url: targetUrl };
}

async function startChatgptDownloadStashFromContext(url, params = {}) {
  if (!chatgptView || chatgptView.webContents.isDestroyed()) throw new Error("ChatGPT surface is unavailable.");
  if (!trustedChatgptPageUrl(chatgptView.webContents.getURL() || "")) throw new Error("ChatGPT download action is restricted to trusted ChatGPT/OpenAI origins.");
  const targetUrl = safeDownloadLinkUrl(url);
  const context = activeChatgptContext || await resolveChatgptContextForUrl(chatgptView.webContents.getURL() || "");
  const availability = await chatgptDownloadMacroAvailability(context);
  if (!availability.ok) throw new Error(availability.reason);
  const request = enqueueChatgptDownloadMacroRequest(targetUrl, availability.context, {
    action: "add_to_project_stash",
    allowUnresolvedUrl: true,
  });
  try {
    const clickResult = await clickChatgptDownloadTarget(params);
    if (!clickResult?.ok) {
      throw new Error(clickResult?.error || "download_target_click_failed");
    }
  } catch (error) {
    removePendingChatgptDownloadMacroRequest(request.id);
    throw error;
  }
  return {
    ok: true,
    fileCount: 1,
    projectId: availability.project.id,
    chatThreadId: availability.activeThread.id,
    codexThreadId: availability.binding.codexThreadRef.threadId,
  };
}

async function handleCompletedChatgptDownload(savePath, fileName, downloadContext = null) {
  try {
    const macroResult = await runChatgptDownloadMacro(savePath, fileName, downloadContext);
    emitShellEvent({
      type: "chatgpt-download-completed",
      fileName,
      savePath,
      macro: macroResult,
      at: nowIso(),
    });
  } catch (error) {
    emitShellEvent({
      type: "chatgpt-download-completed",
      fileName,
      savePath,
      macro: { activated: false, error: error.message },
      at: nowIso(),
    });
  }
}

async function handleCompletedChatgptDownloadForProjectStash(savePath, fileName, downloadContext = null) {
  let macroResult = { activated: false, reason: "normal_download" };
  try {
    macroResult = await runChatgptDownloadMacro(savePath, fileName, downloadContext, { notifyCodex: false });
    if (!macroResult?.activated || !macroResult.importedRelPath || !macroResult.projectId) {
      throw new Error(macroResult?.reason || "download_not_project_linked");
    }
    emitShellEvent({
      type: "project-stash-add-file",
      projectId: macroResult.projectId,
      codexThreadId: macroResult.codexThreadId || "",
      relPath: macroResult.importedRelPath,
      label: macroResult.importedRelPath,
      source: "chatgpt-download-stash",
      targetSurface: "codex",
      chatThreadId: macroResult.chatThreadId || "",
      chatThreadTitle: macroResult.chatThreadTitle || "",
      at: nowIso(),
    });
    emitShellEvent({
      type: "chatgpt-download-completed",
      fileName,
      savePath,
      macro: macroResult,
      stash: { added: true, targetSurface: "codex" },
      at: nowIso(),
    });
  } catch (error) {
    emitShellEvent({
      type: "chatgpt-download-completed",
      fileName,
      savePath,
      macro: { ...macroResult, activated: false, error: error.message },
      stash: { added: false, targetSurface: "codex", error: error.message },
      at: nowIso(),
    });
  }
}

async function handleCompletedChatgptDownloadForFileView(savePath, fileName, downloadContext = null) {
  let macroResult = { activated: false, reason: "normal_download" };
  try {
    macroResult = await runChatgptDownloadMacro(savePath, fileName, downloadContext, { notifyCodex: false });
    if (macroResult?.activated && macroResult.importedRelPath && macroResult.projectId) {
      await openProjectFileInMiddle({
        projectId: macroResult.projectId,
        relPath: macroResult.importedRelPath,
        sourceKind: "chatgpt_download",
        source: {
          surface: "chatgpt",
          threadId: macroResult.chatThreadId || "",
          threadTitle: macroResult.chatThreadTitle || "",
        },
      });
    } else {
      await openHostFileInMiddle(savePath, {
        displayName: fileName,
        sourceKind: "chatgpt_download_host",
        source: { surface: "chatgpt" },
      });
    }
    emitShellEvent({
      type: "chatgpt-download-completed",
      fileName,
      savePath,
      macro: macroResult,
      fileView: { opened: true },
      at: nowIso(),
    });
  } catch (error) {
    const fallbackResult = await openHostFileInMiddle(savePath, {
      displayName: fileName,
      sourceKind: "chatgpt_download_host",
      source: { surface: "chatgpt" },
    }).catch((fallbackError) => ({ ok: false, error: fallbackError.message }));
    emitShellEvent({
      type: "chatgpt-download-completed",
      fileName,
      savePath,
      macro: { ...macroResult, activated: false, error: error.message },
      fileView: { opened: Boolean(fallbackResult?.ok), fallback: "host_file", error: fallbackResult?.error || "" },
      at: nowIso(),
    });
  }
}

function prepareChatgptDownload(item, options = {}) {
  const config = configCache || normalizeConfig(defaultConfig());
  const downloads = normalizeChatgptDownloadsConfig(config.chatgptDownloads);
  if (!downloads.enabled) return null;
  const macroRequest = options.macroRequest || null;
  const downloadContext = macroRequest?.context || activeChatgptContext || null;
  const fileName = safeHostDownloadFileName(item.getFilename?.() || "download");
  const savePath = uniqueHostDownloadPathSync(chatgptWindowsDownloadDir({ chatgptDownloads: downloads }), fileName);
  item.setSavePath(savePath);
  item.once("done", (_event, state) => {
    const completedPath = savePath || item.getSavePath?.() || "";
    if (state !== "completed") {
      try {
        if (completedPath) {
          const stat = fsSync.statSync(completedPath);
          if (stat.size === 0) fsSync.unlinkSync(completedPath);
        }
      } catch {}
      emitShellEvent({
        type: "chatgpt-download-failed",
        fileName,
        savePath: completedPath,
        state,
        at: nowIso(),
      });
      return;
    }
    if (macroRequest) {
      if (macroRequest.action === "add_to_project_stash") {
        handleCompletedChatgptDownloadForProjectStash(completedPath, path.basename(completedPath), downloadContext).catch(() => {});
      } else if (macroRequest.action === "open_in_files_tab") {
        handleCompletedChatgptDownloadForFileView(completedPath, path.basename(completedPath), downloadContext).catch(() => {});
      } else {
        handleCompletedChatgptDownload(completedPath, path.basename(completedPath), downloadContext).catch(() => {});
      }
      return;
    }
    handleCompletedChatgptDownloadForFileView(completedPath, path.basename(completedPath), downloadContext).catch(() => {});
  });
  emitShellEvent({
    type: "chatgpt-download-started",
    fileName,
    savePath,
    at: nowIso(),
  });
  return { fileName, savePath };
}

function resolveChatgptContextMenuLink(params = {}) {
  return safeDownloadLinkUrl(params.linkURL || params.srcURL || "");
}

function hasChatgptContextSelection(params = {}) {
  return typeof params.selectionText === "string" && params.selectionText.length > 0;
}

function showChatgptSelectionContextMenu() {
  Menu.buildFromTemplate([{ role: "copy", label: "Copy selected text" }]).popup();
}

function openChatgptContextMenu(params = {}) {
  const template = [];
  if (hasChatgptContextSelection(params)) {
    showChatgptSelectionContextMenu();
    return true;
  }
  const linkUrl = resolveChatgptContextMenuLink(params);
  if (!params.isEditable) {
    template.push({
      label: "Download and open in Files tab",
      click: async () => {
        try {
          await startChatgptDownloadFileViewFromContext(linkUrl, params);
        } catch (error) {
          emitShellEvent({ type: "chatgpt-download-failed", fileName: "download", state: "start-failed", error: error.message, at: nowIso() });
        }
      },
    });
    template.push({
      label: "Download and send to linked Codex",
      click: async () => {
        try {
          await startChatgptDownloadMacroFromContext(linkUrl, params);
        } catch (error) {
          emitShellEvent({
            type: "chatgpt-download-failed",
            fileName: linkUrl ? (path.basename(new URL(linkUrl).pathname) || "download") : "download",
            state: "macro-start-failed",
            error: error.message,
            at: nowIso(),
          });
        }
      },
    });
    template.push({
      label: "Download and add to Project stash",
      click: async () => {
        try {
          const result = await startChatgptDownloadStashFromContext(linkUrl, params);
          emitShellEvent({
            type: "context-menu-diagnostic",
            message: `Started ${result.fileCount || 0} ChatGPT download${result.fileCount === 1 ? "" : "s"} for Project stash.`,
            at: nowIso(),
          });
        } catch (error) {
          emitShellEvent({
            type: "chatgpt-download-failed",
            fileName: "download",
            state: "stash-start-failed",
            error: error.message,
            at: nowIso(),
          });
        }
      },
    });
    if (linkUrl) {
      template.push({ label: "Copy link URL", click: () => clipboard.writeText(linkUrl) });
    }
  }
  if (params.isEditable) {
    if (template.length) template.push({ type: "separator" });
    template.push({ role: "paste", label: "Paste" });
  }
  if (!template.length) return false;
  Menu.buildFromTemplate(template).popup();
  return true;
}

function chatgptRecentThreadsScript(limit = 40) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 40, 200));
  return `
    (async () => {
      const limit = ${safeLimit};
      const origin = location.origin || "https://chatgpt.com";
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const normalizeText = (value) => String(value || "").replace(/\\s+/g, " ").trim();
      const optionalProjectRank = (value) => {
        if (value === null || value === undefined || value === "") return null;
        const rank = Number(value);
        return Number.isFinite(rank) ? rank : null;
      };
      const monthIndex = {
        jan: 0,
        january: 0,
        feb: 1,
        february: 1,
        mar: 2,
        march: 2,
        apr: 3,
        april: 3,
        may: 4,
        jun: 5,
        june: 5,
        jul: 6,
        july: 6,
        aug: 7,
        august: 7,
        sep: 8,
        sept: 8,
        september: 8,
        oct: 9,
        october: 9,
        nov: 10,
        november: 10,
        dec: 11,
        december: 11,
      };
      const displayedDateCandidatePattern = /\\b(today|yesterday|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\b(?:\\s+\\d{1,2}(?:,\\s*\\d{4})?)?/i;
      const visible = (element) => {
        if (!element) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 3 && rect.height > 3;
      };
      const click = (element) => {
        if (!element) return false;
        element.scrollIntoView?.({ block: "center", inline: "center" });
        const PointerEventClass = window.PointerEvent || MouseEvent;
        element.dispatchEvent(new PointerEventClass("pointerdown", { bubbles: true, cancelable: true, view: window }));
        element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
        element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
        element.click();
        return true;
      };
      const isoDateForLocalDay = (date) => {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return year + "-" + month + "-" + day + "T12:00:00.000Z";
      };
      const parseDisplayedThreadDate = (value) => {
        const label = normalizeText(value);
        if (!label) return "";
        const now = new Date();
        if (/^today$/i.test(label)) return isoDateForLocalDay(now);
        if (/^yesterday$/i.test(label)) {
          const yesterday = new Date(now);
          yesterday.setDate(yesterday.getDate() - 1);
          return isoDateForLocalDay(yesterday);
        }
        const match = label.match(/^([A-Za-z]{3,9})\\s+(\\d{1,2})(?:,\\s*(\\d{4}))?$/);
        if (!match) return "";
        const month = monthIndex[match[1].toLowerCase()];
        const day = Number(match[2]);
        if (!Number.isInteger(month) || !Number.isFinite(day) || day < 1 || day > 31) return "";
        let year = match[3] ? Number(match[3]) : now.getFullYear();
        let parsed = new Date(year, month, day, 12, 0, 0, 0);
        if (!match[3] && parsed.getTime() - now.getTime() > 36 * 60 * 60 * 1000) {
          year -= 1;
          parsed = new Date(year, month, day, 12, 0, 0, 0);
        }
        return isoDateForLocalDay(parsed);
      };
      const directText = (element) =>
        Array.from(element?.childNodes || [])
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => normalizeText(node.textContent))
          .filter(Boolean)
          .join(" ");
      const threadRowForLink = (link) => {
        let node = link;
        let compactFallback = link;
        for (let depth = 0; node && depth < 7; depth += 1, node = node.parentElement) {
          const anchors = node.querySelectorAll ? Array.from(node.querySelectorAll('a[href*="/c/"]')) : [];
          const text = normalizeText(node.textContent);
          if (anchors.length > 2 || text.length > 1200) continue;
          compactFallback = node;
          if (node.querySelector?.("time,[datetime]") || displayedDateCandidatePattern.test(text)) return node;
        }
        return compactFallback;
      };
      const displayedDateFromThreadRow = (row) => {
        if (!row) return { label: "", iso: "" };
        for (const element of Array.from(row.querySelectorAll?.("time,[datetime]") || [])) {
          const datetime = normalizeText(element.getAttribute("datetime"));
          if (datetime) {
            const parsed = new Date(datetime);
            if (!Number.isNaN(parsed.getTime())) return { label: normalizeText(element.textContent) || datetime, iso: parsed.toISOString() };
          }
        }
        const datePattern = new RegExp(displayedDateCandidatePattern.source, "gi");
        const candidates = [];
        for (const element of Array.from(row.querySelectorAll?.("*") || [])) {
          const pieces = [directText(element), element.getAttribute("aria-label"), element.getAttribute("title")]
            .map(normalizeText)
            .filter(Boolean);
          for (const piece of pieces) {
            for (const match of piece.matchAll(datePattern)) candidates.push(match[0]);
          }
        }
        if (!candidates.length) {
          for (const match of normalizeText(row.textContent).matchAll(datePattern)) candidates.push(match[0]);
        }
        for (let index = candidates.length - 1; index >= 0; index -= 1) {
          const label = normalizeText(candidates[index]);
          const iso = parseDisplayedThreadDate(label);
          if (iso) return { label, iso };
        }
        return { label: "", iso: "" };
      };

      const normalizeEntry = (item, extra = {}) => {
        if (!item || !item.id) return null;
        const externalId = String(item.id || "");
        const projectName = String(extra.projectName || "").trim();
        const sourceKind = projectName ? "project" : String(extra.sourceKind || "recent");
        const workspaceId =
          item.workspace_id != null && item.workspace_id !== ""
            ? String(item.workspace_id)
            : String(extra.workspaceId || "");
        return {
          externalId,
          title: String(item.title || "Untitled ChatGPT thread"),
          url: externalId ? origin.replace(/\\/$/, "") + "/c/" + encodeURIComponent(externalId) : "",
          updatedAt: String(item.update_time || extra.updatedAt || ""),
          createdAt: String(item.create_time || ""),
          archived: Boolean(item.is_archived),
          snippet: typeof item.snippet === "string" ? item.snippet : "",
          displayDate: String(extra.displayDate || ""),
          projectRank: optionalProjectRank(extra.projectRank),
          projectName,
          workspaceId,
          sourceKind,
          source: String(extra.source || ""),
        };
      };

      const mergeEntries = (current, incoming) => {
        if (!current) return incoming;
        const incomingUpdated = String(incoming.updatedAt || "");
        const currentUpdated = String(current.updatedAt || "");
        const incomingWinsUpdatedAt = Boolean(incomingUpdated && incomingUpdated >= currentUpdated);
        const incomingRank = optionalProjectRank(incoming.projectRank);
        const currentRank = optionalProjectRank(current.projectRank);
        const merged = {
          ...current,
          ...incoming,
          title:
            incoming.title && incoming.title !== "Untitled ChatGPT thread"
              ? incoming.title
              : current.title || incoming.title || "Untitled ChatGPT thread",
          url: incoming.url || current.url,
          updatedAt: incomingWinsUpdatedAt ? incomingUpdated : currentUpdated,
          createdAt: current.createdAt || incoming.createdAt || "",
          archived: Boolean(current.archived && incoming.archived),
          snippet: current.snippet || incoming.snippet || "",
          displayDate: incomingWinsUpdatedAt
            ? incoming.displayDate || current.displayDate || ""
            : current.displayDate || incoming.displayDate || "",
          projectRank: incomingRank !== null ? incomingRank : currentRank,
          projectName: incoming.projectName || current.projectName || "",
          workspaceId: incoming.workspaceId || current.workspaceId || "",
          sourceKind:
            incoming.sourceKind === "project" || current.sourceKind === "project"
              ? "project"
              : "recent",
          source: Array.from(
            new Set(
              [current.source, incoming.source]
                .filter(Boolean)
                .flatMap((value) => String(value).split("+").map((part) => part.trim()).filter(Boolean))
            )
          ).join("+"),
        };
        return merged;
      };

      const dedupe = (items) => {
        const byId = new Map();
        for (const item of items) {
          if (!item || !item.externalId) continue;
          byId.set(item.externalId, mergeEntries(byId.get(item.externalId), item));
        }
        const entries = Array.from(byId.values()).sort((a, b) => {
          const updatedDelta = String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
          if (updatedDelta !== 0) return updatedDelta;
          const aRank = optionalProjectRank(a.projectRank) ?? Number.POSITIVE_INFINITY;
          const bRank = optionalProjectRank(b.projectRank) ?? Number.POSITIVE_INFINITY;
          if (aRank !== bRank) return aRank - bRank;
          return String(a.title || "").localeCompare(String(b.title || ""));
        });
        const projectEntries = entries.filter((entry) => entry.sourceKind === "project");
        const otherEntries = entries.filter((entry) => entry.sourceKind !== "project");
        return [...projectEntries, ...otherEntries].slice(0, limit);
      };

      const fromCache = () => {
        const items = [];
        for (const key of Object.keys(localStorage)) {
          if (!key.includes("/conversation-history")) continue;
          try {
            const parsed = JSON.parse(localStorage.getItem(key) || "null");
            const pages = parsed?.value?.pages || [];
            for (const page of pages) {
              for (const item of page?.items || []) {
                const normalized = normalizeEntry(item, {
                  source: "localStorage-cache",
                  sourceKind: item?.workspace_id != null && item.workspace_id !== "" ? "project" : "recent",
                });
                if (normalized) items.push(normalized);
              }
            }
          } catch {}
        }
        return dedupe(items);
      };

      const parseLinkEntry = (link, fallbackKind, source, forcedProjectName = "", extra = {}) => {
        try {
          const url = new URL(link.href, origin);
          const match = url.pathname.match(/\\/c\\/([^/?#]+)/);
          if (!match) return null;
          const aria = normalizeText(link.getAttribute("aria-label"));
          const projectMatch = aria.match(/chat in project\\s+(.+)$/i);
          const projectName = normalizeText(forcedProjectName || (projectMatch ? projectMatch[1] : ""));
          const sourceKind = projectName ? "project" : fallbackKind;
          let title = normalizeText(aria || link.textContent) || "Untitled ChatGPT thread";
          const chatInProjectTitle = title.match(/^(.+?),\\s*chat in project\\b/i);
          if (chatInProjectTitle) title = normalizeText(chatInProjectTitle[1]);
          if (source === "project-iframe" && title.length > 120) {
            title = title.slice(0, 117).trimEnd() + "...";
          }
          return {
            externalId: match[1],
            title,
            url: url.toString(),
            updatedAt: String(extra.updatedAt || ""),
            createdAt: "",
            archived: false,
            snippet: "",
            displayDate: String(extra.displayDate || ""),
            projectRank: optionalProjectRank(extra.projectRank),
            projectName,
            workspaceId: "",
            sourceKind,
            source,
          };
        } catch {
          return null;
        }
      };

      const fromDomRoot = (root, fallbackKind, source, forcedProjectName = "") => {
        const items = [];
        for (const link of Array.from((root || document).querySelectorAll('a[href*="/c/"]'))) {
          const parsed = parseLinkEntry(link, fallbackKind, source, forcedProjectName);
          if (parsed) items.push(parsed);
        }
        return dedupe(items);
      };

      const parseProjectAnchor = (link) => {
        try {
          const rawHref = String(link?.getAttribute("href") || "").trim();
          if (!rawHref || !rawHref.includes("/g/g-p-") || !rawHref.includes("/project")) return null;
          const url = new URL(rawHref, origin);
          const match = url.pathname.match(/^\\/g\\/(g-p-[^/]+)\\/project(?:\\/)?$/i);
          if (!match) return null;
          const title = normalizeText(link.textContent);
          const aria = normalizeText(link.getAttribute("aria-label"));
          const openMatch = aria.match(/^open\\s+(.+?)\\s+project$/i);
          const projectName = normalizeText(openMatch ? openMatch[1] : title);
          const projectIdMatch = match[1].match(/^g-p-[0-9a-f]+/i);
          return {
            key: match[1].toLowerCase(),
            projectId: projectIdMatch ? projectIdMatch[0].toLowerCase() : "",
            url: url.toString(),
            projectName,
          };
        } catch {
          return null;
        }
      };

      const collectProjectAnchors = () => {
        const byKey = new Map();
        for (const link of Array.from(document.querySelectorAll('a[href*="/g/g-p-"][href*="/project"]'))) {
          const parsed = parseProjectAnchor(link);
          if (!parsed || !parsed.key) continue;
          const current = byKey.get(parsed.key);
          if (!current) {
            byKey.set(parsed.key, parsed);
            continue;
          }
          if (!current.projectName && parsed.projectName) byKey.set(parsed.key, parsed);
        }
        return Array.from(byKey.values());
      };

      const projectKeyFromThreadUrl = (value) => {
        try {
          const url = new URL(String(value || ""), origin);
          const match = url.pathname.match(/^\\/g\\/(g-p-[^/]+)\\/c\\/[^/?#]+/i);
          if (!match) return "";
          const idMatch = match[1].match(/^g-p-[0-9a-f]+/i);
          return idMatch ? idMatch[0].toLowerCase() : "";
        } catch {
          return "";
        }
      };
      const projectMatchesEntry = (project, entry) => {
        if (!project || !entry) return false;
        const entryProjectKey = projectKeyFromThreadUrl(entry.url);
        if (project.projectId && entryProjectKey === project.projectId) return true;
        const projectNameKey = normalizeText(project.projectName).toLowerCase();
        return Boolean(projectNameKey && normalizeText(entry.projectName).toLowerCase() === projectNameKey);
      };

      const ensureSidebarVisible = async () => {
        const openButton = document.querySelector('[data-testid="open-sidebar-button"]');
        if (openButton && visible(openButton)) {
          click(openButton);
          await sleep(480);
        }
        const candidates = Array.from(
          document.querySelectorAll("button,[role='button'],summary,a")
        );
        let showMoreClicks = 0;
        for (const element of candidates) {
          if (showMoreClicks >= 8) break;
          const label = normalizeText(element.textContent || element.getAttribute("aria-label"));
          if (!label || !/^show more$/i.test(label)) continue;
          if (!visible(element)) continue;
          if (click(element)) {
            showMoreClicks += 1;
            await sleep(140);
          }
        }
        await sleep(320);
      };

      const fromSidebarDom = async () => {
        await ensureSidebarVisible();
        const sidebar =
          document.querySelector('[data-testid="history-sidebar"]') ||
          document.querySelector('[data-testid="sidebar"]') ||
          document.querySelector('nav[aria-label="Chat history"]') ||
          document.querySelector('[aria-label="Chat history"]') ||
          document.querySelector("aside") ||
          null;
        if (!sidebar) return [];
        return fromDomRoot(sidebar, "recent", "sidebar-dom");
      };

      const fromDom = () => fromDomRoot(document, "recent", "dom-fallback");

      const fromProjectIframes = async (targets = null) => {
        await ensureSidebarVisible();
        const projectAnchors = (Array.isArray(targets) && targets.length ? targets : collectProjectAnchors()).slice(0, 5);
        if (!projectAnchors.length) return [];
        const items = [];
        for (const project of projectAnchors) {
          const frame = document.createElement("iframe");
          frame.style.position = "fixed";
          frame.style.left = "-16000px";
          frame.style.top = "0";
          frame.style.width = "1200px";
          frame.style.height = "900px";
          frame.style.opacity = "0";
          frame.style.pointerEvents = "none";
          frame.setAttribute("aria-hidden", "true");
          frame.src = project.url;
          document.body.appendChild(frame);
          await new Promise((resolve) => {
            let done = false;
            const finish = () => {
              if (done) return;
              done = true;
              resolve();
            };
            frame.addEventListener("load", () => setTimeout(finish, 2600), { once: true });
            setTimeout(finish, 9000);
          });
          try {
            const doc = frame.contentDocument;
            if (doc) {
              const links = Array.from(doc.querySelectorAll('a[href*="/c/"]'));
              const scopedEntries = [];
              for (const link of links) {
                let include = true;
                if (project.projectId) {
                  try {
                    const linkUrl = new URL(link.href, origin);
                    const pathMatch = linkUrl.pathname.match(/^\\/g\\/(g-p-[^/]+)\\/c\\/[^/?#]+/i);
                    if (!pathMatch) {
                      include = false;
                    } else {
                      const idMatch = pathMatch[1].match(/^g-p-[0-9a-f]+/i);
                      include = Boolean(idMatch && idMatch[0].toLowerCase() === project.projectId);
                    }
                  } catch {
                    include = false;
                  }
                }
                if (!include) continue;
                const row = threadRowForLink(link);
                const displayedDate = displayedDateFromThreadRow(row);
                const parsed = parseLinkEntry(link, "project", "project-iframe", project.projectName || "", {
                  updatedAt: displayedDate.iso,
                  displayDate: displayedDate.label,
                  projectRank: scopedEntries.length,
                });
                if (parsed) scopedEntries.push(parsed);
              }
              for (const entry of scopedEntries.slice(0, 10)) items.push(entry);
            }
          } catch {}
          frame.remove();
          await sleep(120);
        }
        return dedupe(items);
      };

      const fromBackendApi = async () => {
        try {
          const response = await fetch("/backend-api/conversations?offset=0&limit=" + limit + "&order=updated", {
            credentials: "include",
          });
          if (!response.ok) return [];
          const payload = await response.json();
          const rows = Array.isArray(payload?.items)
            ? payload.items
            : Array.isArray(payload?.conversations)
              ? payload.conversations
              : Array.isArray(payload)
                ? payload
                : [];
          return dedupe(
            rows
              .map((item) =>
                normalizeEntry(item, {
                  source: "backend-api",
                  sourceKind: item?.workspace_id != null && item.workspace_id !== "" ? "project" : "recent",
                })
              )
              .filter(Boolean)
          );
        } catch {
          return [];
        }
      };

      const cached = fromCache();
      const fetched = await fromBackendApi();
      const sidebar = await fromSidebarDom();
      const dom = fromDom();
      const baseline = dedupe([...cached, ...fetched, ...sidebar, ...dom]);
      const baselineProjects = baseline.filter((entry) => entry.sourceKind === "project");
      const discoveredProjectNames = new Set(
        baselineProjects
          .map((entry) => normalizeText(entry.projectName).toLowerCase())
          .filter(Boolean)
      );
      const discoveredProjectKeys = new Set(
        baselineProjects
          .map((entry) => projectKeyFromThreadUrl(entry.url))
          .filter(Boolean)
      );
      const sidebarProjects = collectProjectAnchors().slice(0, 5);
      const missingSidebarProjects = sidebarProjects.filter((project) => {
        const projectNameKey = normalizeText(project.projectName).toLowerCase();
        const knownById = project.projectId && discoveredProjectKeys.has(project.projectId);
        const knownByName = projectNameKey && discoveredProjectNames.has(projectNameKey);
        const knownRows = baselineProjects.filter((entry) => projectMatchesEntry(project, entry));
        const needsDisplayedDateRefresh = knownRows.some((entry) => !entry.updatedAt);
        return !(knownById || knownByName) || needsDisplayedDateRefresh;
      });
      const iframeProjects = missingSidebarProjects.length ? await fromProjectIframes(missingSidebarProjects) : [];
      const combined = dedupe([...baseline, ...iframeProjects]);

      const sourceParts = [];
      if (cached.length) sourceParts.push("localStorage-cache");
      if (fetched.length) sourceParts.push("backend-api");
      if (sidebar.length) sourceParts.push("sidebar-dom");
      if (dom.length) sourceParts.push("dom-fallback");
      if (iframeProjects.length) sourceParts.push("project-iframe");

      return {
        source: sourceParts.length ? sourceParts.join("+") : "unavailable",
        available: combined.length > 0,
        entries: combined,
      };
    })()
  `;
}

function chatgptDarkCss() {
  return `
    html, body {
      color-scheme: dark !important;
      background: #0d0f14 !important;
    }
    body, main, [role="main"], #__next, [class*="bg-token"] {
      background-color: #0d0f14 !important;
    }
  `;
}

function chatgptChromeCss() {
  return `
    /* v1 conservative chrome reduction. This is best-effort and may need selector updates after ChatGPT UI changes. */
    html, body { color-scheme: dark !important; background: #0d0f14 !important; }
    [data-testid="history-sidebar"],
    [data-testid="sidebar"],
    [data-testid="workspace-sidebar"],
    [aria-label="Chat history"],
    nav[aria-label="Chat history"],
    div[class*="sidebar"]:has(nav),
    aside[class*="sidebar"] {
      display: none !important;
      visibility: hidden !important;
      width: 0 !important;
      min-width: 0 !important;
      max-width: 0 !important;
    }
    main,
    [role="main"] {
      max-width: none !important;
    }
    [data-testid="conversation-turn"],
    article {
      max-width: min(980px, calc(100vw - 72px)) !important;
    }
  `;
}

function chatgptDarkBootstrapScript() {
  return `(() => {
    try {
      const keys = ["theme", "chatgpt-theme", "oai-theme", "oai/apps/theme", "color-theme"];
      for (const key of keys) {
        try { window.localStorage.setItem(key, "dark"); } catch (_) {}
      }
      document.documentElement.classList.add("dark");
      document.documentElement.style.colorScheme = "dark";
      document.body && (document.body.style.colorScheme = "dark");
    } catch (_) {}
  })();`;
}

async function forceChatgptDark() {
  if (!chatgptView || chatgptView.webContents.isDestroyed()) return false;
  try {
    await chatgptView.webContents.executeJavaScript(chatgptDarkBootstrapScript(), true);
  } catch {}
  try {
    await chatgptView.webContents.insertCSS(chatgptDarkCss());
  } catch {}
  return true;
}

function scheduleChatgptPolish() {
  if (!chatgptView || chatgptView.webContents.isDestroyed()) return;
  const currentUrl = chatgptView.webContents.getURL();
  if (!currentUrl.includes("chatgpt.com") && !currentUrl.includes("chat.openai.com")) return;
  for (const delay of [0, 250, 900, 1800, 3200]) {
    setTimeout(async () => {
      if (!chatgptView || chatgptView.webContents.isDestroyed()) return;
      await forceChatgptDark();
      if (!chatgptView || chatgptView.webContents.isDestroyed()) return;
      if (currentProject?.surfaceBinding?.chatgpt?.reduceChrome) {
        chatgptView.webContents.insertCSS(chatgptChromeCss()).catch(() => {});
      }
    }, delay);
  }
}

async function loadProjectSurfaces(project, activationBinding = null) {
  const activationEpoch = nextSurfaceActivationEpoch();
  currentProject = project;
  emitToShell("surface:event", {
    surface: "shell",
    type: "project-selected",
    projectId: project.id,
    projectName: project.name,
    at: nowIso(),
  });
  emitDirectRuntimeStatus(project);
  const codexOptions = { ...codexSurfaceOptionsForBinding(activationBinding), activationEpoch };
  await Promise.allSettled([
    loadCodexSurface(project, codexOptions),
    loadChatgptSurface(project, normalizeString(activationBinding?.chatThreadId, ""), { activationEpoch }),
  ]);
  if (isStaleSurfaceActivationEpoch(activationEpoch)) return;
  scheduleLayoutPing("project-selected");
}

function loadProjectSurfacesDetached(project, activationBinding = null) {
  const loadPromise = loadProjectSurfaces(project, activationBinding);
  loadPromise.catch((error) => {
    emitToShell("surface:event", {
      surface: "shell",
      type: "load-failed",
      title: error.message || "Project surface load failed.",
      at: nowIso(),
    });
  });
  return loadPromise;
}

function isLikelyChatAuthOrAppUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return (
      host === "chatgpt.com" ||
      host.endsWith(".chatgpt.com") ||
      host === "chat.openai.com" ||
      host.endsWith(".chat.openai.com") ||
      host === "auth.openai.com" ||
      host.endsWith(".auth.openai.com") ||
      host === "login.openai.com" ||
      host.endsWith(".login.openai.com") ||
      host === "accounts.google.com" ||
      host.endsWith(".accounts.google.com") ||
      host === "login.microsoftonline.com" ||
      host.endsWith(".login.microsoftonline.com")
    );
  } catch {
    return false;
  }
}

function isPermittedNavigationUrl(rawUrl, surfaceName) {
  try {
    const parsed = new URL(rawUrl);
    if (surfaceName === "codex") {
      if (parsed.protocol === "file:" || parsed.protocol === "https:") return true;
      if (parsed.protocol === "http:") {
        const host = parsed.hostname.toLowerCase();
        return host === "localhost" || host === "127.0.0.1" || host === "::1";
      }
      return false;
    }
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function configureGuestSurface(surfaceName, view) {
  const contents = view.webContents;
  const zoomPlane = surfaceName === "chatgpt" ? "chatgpt" : "codex";
  contents.setZoomFactor(nativePlaneZoomFactors[zoomPlane]);
  contents.on("zoom-changed", (event, direction) => {
    event.preventDefault();
    adjustPlaneZoom(zoomPlane, direction);
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (surfaceName === "chatgpt") {
      const pendingMacroNavigation = findPendingChatgptDownloadMacroNavigation(url);
      if (pendingMacroNavigation) {
        downloadPendingChatgptMacroNavigation(contents, pendingMacroNavigation, url);
        return { action: "deny" };
      }
    }
    if (surfaceName === "chatgpt" && isLikelyDownloadUrl(url)) {
      setImmediate(() => {
        if (!contents.isDestroyed()) contents.downloadURL(url);
      });
      return { action: "deny" };
    }
    if (surfaceName === "chatgpt" && isLikelyChatAuthOrAppUrl(url)) {
      setImmediate(() => {
        if (!contents.isDestroyed()) contents.loadURL(url).catch(() => {});
      });
      return { action: "deny" };
    }
    if (url.startsWith("http://") || url.startsWith("https://")) {
      ensureMiddleWebHost().openLink({
        url,
        source: { surface: surfaceName === "chatgpt" ? "chatgpt" : "codex" },
        userGesture: true,
      }).catch((error) => {
        emitShellEvent({
          type: "middle-web-state",
          webEventType: "load-failed",
          lastError: error.message || "Unable to open workspace link.",
          at: nowIso(),
        });
      });
    }
    return { action: "deny" };
  });
  if (surfaceName === "chatgpt") {
    contents.on("context-menu", (event, params) => {
      event.preventDefault();
      if (hasChatgptContextSelection(params)) {
        showChatgptSelectionContextMenu();
        return;
      }
      try {
        openChatgptContextMenu(params);
      } catch (error) {
        emitShellEvent({
          type: "chatgpt-download-failed",
          fileName: "download",
          state: "context-menu-failed",
          error: error.message,
          at: nowIso(),
        });
      }
    });
  }
  contents.on("will-navigate", (event, url) => {
    if (surfaceName === "chatgpt") {
      const pendingMacroNavigation = findPendingChatgptDownloadMacroNavigation(url);
      if (pendingMacroNavigation) {
        event.preventDefault();
        downloadPendingChatgptMacroNavigation(contents, pendingMacroNavigation, url);
        return;
      }
    }
    if (surfaceName === "chatgpt" && isLikelyDownloadUrl(url)) {
      event.preventDefault();
      contents.downloadURL(url);
      return;
    }
    if (!isPermittedNavigationUrl(url, surfaceName)) {
      event.preventDefault();
      emitToShell("surface:event", {
        surface: surfaceName,
        type: "navigation-blocked",
        url,
        at: nowIso(),
      });
    }
  });
  contents.on("did-start-loading", () => {
    emitToShell("surface:event", {
      surface: surfaceName,
      type: "loading",
      url: contents.getURL(),
      at: nowIso(),
    });
  });
  contents.on("did-stop-loading", () => {
    if (surfaceName === "chatgpt") {
      resolveChatgptContextForUrl(contents.getURL() || "")
        .then((context) => {
          activeChatgptContext = context;
        })
        .catch(() => {});
    }
    emitToShell("surface:event", {
      surface: surfaceName,
      type: "loaded",
      url: contents.getURL(),
      title: contents.getTitle(),
      at: nowIso(),
    });
    if (surfaceName === "chatgpt") scheduleChatgptPolish();
    scheduleLayoutPing(`${surfaceName}-loaded`);
  });
  contents.on("dom-ready", () => {
    if (surfaceName === "chatgpt") scheduleChatgptPolish();
  });
  contents.on("focus", () => {
    if (surfaceName !== "codex" && codexView?.webContents && !codexView.webContents.isDestroyed()) {
      codexView.webContents.send("codex-surface:event", {
        type: "dismiss-composer-overlay",
        reason: `${surfaceName}-focus`,
      });
    }
  });
  contents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    emitToShell("surface:event", {
      surface: surfaceName,
      type: "load-failed",
      url: validatedURL,
      errorCode,
      errorDescription,
      at: nowIso(),
    });
  });
  contents.on("page-title-updated", (_event, title) => {
    emitToShell("surface:event", {
      surface: surfaceName,
      type: "title",
      title,
      url: contents.getURL(),
      at: nowIso(),
    });
  });
}

function configureChatgptDownloadBridge() {
  if (!chatgptView || chatgptView.webContents.isDestroyed()) return;
  const webSession = chatgptView.webContents.session;
  if (!webSession) return;
  if (chatgptDownloadHandler) {
    webSession.removeListener("will-download", chatgptDownloadHandler);
    chatgptDownloadHandler = null;
  }
  chatgptDownloadHandler = (event, item) => {
    try {
      prepareChatgptDownload(item, { macroRequest: consumeChatgptDownloadMacroRequest(item) });
    } catch (error) {
      event.preventDefault();
      emitShellEvent({
        type: "chatgpt-download-failed",
        fileName: item?.getFilename?.() || "download",
        state: "prepare-failed",
        error: error.message,
        at: nowIso(),
      });
    }
  };
  webSession.on("will-download", chatgptDownloadHandler);
}

function setShellBoundsToWindow() {
  if (!mainWindow || !shellView) return;
  const bounds = mainWindow.getContentBounds();
  shellView.setBounds({ x: 0, y: 0, width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) });
}

function syncWindowGeometry(reason = "window-change") {
  if (!mainWindow || !shellView) return;
  setShellBoundsToWindow();
  applySurfaceBounds();
  scheduleLayoutPing(reason);
}

function startGeometrySyncLoop() {
  if (geometrySyncTimer) clearInterval(geometrySyncTimer);
  geometrySyncTimer = setInterval(() => {
    syncWindowGeometry("geometry-sync-loop");
  }, 200);
}

function stopGeometrySyncLoop() {
  if (!geometrySyncTimer) return;
  clearInterval(geometrySyncTimer);
  geometrySyncTimer = null;
}

function closeView(view) {
  if (!view || !view.webContents || view.webContents.isDestroyed()) return;
  view.webContents.close();
}

async function listWorkTree(projectId, relPath) {
  const project = await getProjectById(projectId);
  const result = await requestWorkspace(project, "listTree", { relPath });
  return {
    ...result,
    workspace: project.workspace,
    workspaceLabel: workspaceLabel(project, repoRoot),
  };
}

async function readProjectFile(projectId, relPath) {
  const project = await getProjectById(projectId);
  const result = await requestWorkspace(project, "readFile", { relPath });
  return {
    ...result,
    workspace: project.workspace,
    workspaceLabel: workspaceLabel(project, repoRoot),
  };
}

async function openProjectFileInMiddle(payload = {}) {
  const projectId = normalizeString(payload.projectId, "");
  const requestedRelPath = normalizeString(payload.relPath, "").replace(/^<|>$/g, "");
  const displayName = path.basename(requestedRelPath.replace(/\\/g, "/")) || "file";
  const source = normalizeMiddleFileSource(payload);
  emitShellEvent({ type: "middle-file-open-requested", at: nowIso() });
  emitMiddleFileState({
    fileEventType: "loading",
    status: "loading",
    sourceKind: normalizeString(payload.sourceKind, "project_file"),
    projectId,
    relPath: requestedRelPath,
    displayName,
    source,
  });
  try {
    const project = await getProjectById(projectId);
    const normalizedRelPath = normalizeProjectFileViewRelPath(project, requestedRelPath);
    const result = await requestWorkspace(project, "readFile", { relPath: normalizedRelPath });
    const relPath = normalizeString(result.relPath, requestedRelPath);
    const binary = Boolean(result.binary);
    emitMiddleFileState({
      fileEventType: "loaded",
      status: binary ? "unsupported" : "ready",
      sourceKind: normalizeString(payload.sourceKind, "project_file"),
      projectId,
      relPath,
      displayName: path.basename(relPath.replace(/\\/g, "/")) || displayName,
      mimeType: fileViewMimeType(relPath),
      size: Number(result.size) || 0,
      truncated: Boolean(result.truncated),
      limit: Number(result.limit) || PREVIEW_LIMIT_BYTES,
      binary,
      text: binary ? "" : String(result.text || ""),
      workspaceLabel: workspaceLabel(project, repoRoot),
      source,
      openedAt: nowIso(),
    });
    return { ok: true, status: binary ? "unsupported" : "ready", projectId, relPath };
  } catch (error) {
    emitMiddleFileState({
      fileEventType: "failed",
      status: "failed",
      sourceKind: normalizeString(payload.sourceKind, "project_file"),
      projectId,
      relPath: requestedRelPath,
      displayName,
      error: error.message || "Unable to open file.",
      source,
    });
    return { ok: false, error: error.message || "Unable to open file." };
  }
}

async function readHostFilePreview(hostPath) {
  const stat = await fs.lstat(hostPath);
  if (!stat.isFile()) throw new Error("Selected download is not a file.");
  const byteCount = Math.min(stat.size, PREVIEW_LIMIT_BYTES);
  const handle = await fs.open(hostPath, "r");
  try {
    const buffer = Buffer.alloc(byteCount);
    const result = await handle.read(buffer, 0, byteCount, 0);
    const slice = buffer.subarray(0, result.bytesRead);
    const binary = isProbablyBinaryBuffer(slice);
    return {
      size: stat.size,
      truncated: stat.size > PREVIEW_LIMIT_BYTES,
      limit: PREVIEW_LIMIT_BYTES,
      binary,
      text: binary ? "" : slice.toString("utf8"),
    };
  } finally {
    await handle.close();
  }
}

async function openHostFileInMiddle(hostPath, options = {}) {
  const displayName = safeHostDownloadFileName(options.displayName || path.basename(hostPath));
  const source = normalizeMiddleFileSource(options);
  emitShellEvent({ type: "middle-file-open-requested", at: nowIso() });
  emitMiddleFileState({
    fileEventType: "loading",
    status: "loading",
    sourceKind: normalizeString(options.sourceKind, "host_file"),
    displayName,
    source,
  });
  try {
    const preview = await readHostFilePreview(hostPath);
    emitMiddleFileState({
      fileEventType: "loaded",
      status: preview.binary ? "unsupported" : "ready",
      sourceKind: normalizeString(options.sourceKind, "host_file"),
      displayName,
      mimeType: fileViewMimeType(displayName),
      size: preview.size,
      truncated: preview.truncated,
      limit: preview.limit,
      binary: preview.binary,
      text: preview.text,
      source,
      openedAt: nowIso(),
    });
    return { ok: true, status: preview.binary ? "unsupported" : "ready", displayName };
  } catch (error) {
    emitMiddleFileState({
      fileEventType: "failed",
      status: "failed",
      sourceKind: normalizeString(options.sourceKind, "host_file"),
      displayName,
      error: error.message || "Unable to open downloaded file.",
      source,
    });
    return { ok: false, error: error.message || "Unable to open downloaded file." };
  }
}


async function listWatchedArtifacts(projectId) {
  const project = await getProjectById(projectId);
  const patterns = project.flowProfile?.watchedFilePatterns || [];
  const ignoredRelPaths = project.ignoredWatchedArtifactPaths || [];
  const result = await requestWorkspace(project, "listMatchingFiles", { patterns, ignoredRelPaths }, 30_000);
  return {
    ...result,
    workspace: project.workspace,
    workspaceLabel: workspaceLabel(project, repoRoot),
  };
}

async function listCodexThreads(projectId) {
  const project = await getProjectById(projectId);
  let result;
  try {
    result = await requestWorkspace(project, "listCodexThreads", {
      limit: 160,
      includeSubagents: false,
      perHomeScanLimit: 260,
      fastMode: false,
    }, 35_000);
  } catch (primaryError) {
    result = await requestWorkspace(project, "listCodexThreads", {
      limit: 120,
      includeSubagents: true,
      fastMode: true,
      perHomeScanLimit: 120,
    }, 15_000);
    result.fallback = {
      mode: "fast",
      reason: primaryError?.message || "primary discovery failed",
    };
  }
  return {
    ...result,
    workspace: project.workspace,
    workspaceLabel: workspaceLabel(project, repoRoot),
  };
}

async function discoverCodexThreadsForAnalytics(project) {
  try {
    return await requestWorkspace(project, "listCodexThreads", {
      limit: ANALYTICS_DISCOVERY_THREAD_LIMIT,
      includeSubagents: false,
      perHomeScanLimit: ANALYTICS_DISCOVERY_SCAN_LIMIT,
      fastMode: false,
      dedupeByThreadId: false,
    }, ANALYTICS_DISCOVERY_TIMEOUT_MS);
  } catch (primaryError) {
    const fallback = await listCodexThreads(project.id);
    return {
      ...fallback,
      analyticsFallback: {
        mode: fallback?.fallback?.mode ?? "thread-list",
        reason: primaryError?.message ?? fallback?.fallback?.reason ?? "analytics discovery failed",
      },
    };
  }
}

async function readCodexThreadTranscript(projectId, threadId, sourceHome = "", sessionFilePath = "", limit = 800) {
  const project = await getProjectById(projectId);
  const result = await requestWorkspace(project, "readCodexThreadTranscript", {
    threadId,
    sourceHome: normalizeString(sourceHome, ""),
    sessionFilePath: normalizeString(sessionFilePath, ""),
    limit: Number.isFinite(Number(limit)) ? Number(limit) : 800,
  }, 45_000);
  return {
    ...result,
    workspace: project.workspace,
    workspaceLabel: workspaceLabel(project, repoRoot),
  };
}

function analyticsCheapFingerprintMatches(current, entry) {
  if (!current || String(current.parseStatus || "") !== "ready") return false;
  if (String(current.analyzerVersion || "") !== THREAD_ANALYTICS_ANALYZER_VERSION) return false;
  if (String(current.sessionUpdatedAt || "") !== String(entry.updatedAt || "")) return false;
  const currentMtime = Math.round(Number(current.fileMtimeMs || 0));
  const nextMtime = Math.round(Number(entry.sessionFileMtimeMs || 0));
  if (currentMtime !== nextMtime) return false;
  const currentSize = Math.round(Number(current.fileSizeBytes || 0));
  const nextSize = Math.round(Number(entry.sessionFileSizeBytes || 0));
  if (currentSize !== nextSize) return false;
  return true;
}

function projectAnalyticsBindingHints(project, discoveredEntries) {
  const hints = new Map();
  const byThreadId = new Map();
  for (const entry of discoveredEntries) {
    const threadId = normalizeString(entry.threadId, "");
    if (!threadId) continue;
    if (!byThreadId.has(threadId)) byThreadId.set(threadId, []);
    byThreadId.get(threadId).push(entry);
  }

  for (const binding of Array.isArray(project?.laneBindings) ? project.laneBindings : []) {
    const threadId = normalizeString(binding?.codexThreadRef?.threadId, "");
    if (!threadId) continue;
    const candidates = byThreadId.get(threadId) || [];
    if (!candidates.length) continue;
    const hintOriginator = normalizeString(binding?.codexThreadRef?.originator, "");
    const resolved = hintOriginator
      ? candidates.find((item) => normalizeString(item.originator, "") === hintOriginator) || candidates[0]
      : candidates[0];
    const threadKey = buildThreadKey(normalizeString(resolved.sourceHome, ""), normalizeString(resolved.threadId, ""));
    hints.set(threadKey, {
      lane: normalizeString(binding?.lane, ""),
      bindingId: normalizeString(binding?.id, ""),
      linkedAt: normalizeString(binding?.createdAt, nowIso()),
    });
  }
  return hints;
}

async function listThreadAnalytics(projectId, options = {}) {
  const project = await getProjectById(projectId);
  const store = ensureThreadAnalyticsStore();
  const limit = Math.max(1, Math.min(Number(options?.limit) || 220, 500));
  const entries = store.listProjectThreads(project.id, limit);
  return {
    projectId: project.id,
    entries,
    analyzerVersion: THREAD_ANALYTICS_ANALYZER_VERSION,
    dbPathLabel: THREAD_ANALYTICS_DB_FILE_NAME,
    dbPathEvidenceKey: stableEvidenceKey("thread-analytics-db", threadAnalyticsDbPath()),
  };
}

async function getThreadAnalyticsDashboard(projectId, threadKey) {
  const project = await getProjectById(projectId);
  const store = ensureThreadAnalyticsStore();
  const key = normalizeString(threadKey, "");
  if (!key) throw new Error("threadKey is required.");
  const dashboard = store.getProjectThreadDashboard(project.id, key);
  const usageLedger = dashboard
    ? await readUsageLedgerAnalytics(project, dashboard.thread?.threadId || "")
    : null;
  const runtimeAnalyticsProjection = dashboard
    ? buildRuntimeAnalyticsProjection({
        projectId: project.id,
        threadId: dashboard.thread?.threadId || "",
        runtimePath: "app-server",
        usageLedgerAnalytics: usageLedger,
      })
    : null;
  return {
    projectId: project.id,
    threadKey: key,
    dashboard: dashboard ? { ...dashboard, usageLedger, runtimeAnalyticsProjection } : dashboard,
    analyzerVersion: THREAD_ANALYTICS_ANALYZER_VERSION,
  };
}

async function updateThreadAnalytics(projectId, options = {}) {
  const project = await getProjectById(projectId);
  const store = ensureThreadAnalyticsStore();
  const scopeMode = normalizeString(options?.scope, "project");
  const runId = store.startScanRun(scopeMode || "project", project.id);
  const counts = {
    discovered: 0,
    processed: 0,
    skipped: 0,
    failed: 0,
  };

  try {
    const discovery = await discoverCodexThreadsForAnalytics(project);

    const discoveredEntries = Array.isArray(discovery?.entries)
      ? discovery.entries.filter((entry) => normalizeString(entry?.threadId, "") && normalizeString(entry?.sourceHome, ""))
      : [];
    counts.discovered = discoveredEntries.length;

    const hints = projectAnalyticsBindingHints(project, discoveredEntries);
    store.upsertDiscoveredThreads(project.id, discoveredEntries, hints, nowIso());

    const staleCandidates = [];
    for (const entry of discoveredEntries) {
      const threadKey = buildThreadKey(normalizeString(entry.sourceHome, ""), normalizeString(entry.threadId, ""));
      if (!threadKey || !normalizeString(entry.sessionFilePath, "")) {
        store.markThreadUnavailable(threadKey, normalizeString(entry.updatedAt, ""), nowIso());
        counts.skipped += 1;
        continue;
      }

      const current = store.getCurrentSnapshotFingerprint(threadKey);
      if (analyticsCheapFingerprintMatches(current, entry)) {
        store.markThreadReady(threadKey, normalizeString(entry.updatedAt, ""), nowIso());
        counts.skipped += 1;
        continue;
      }
      staleCandidates.push({ entry, threadKey });
    }

    const workerCount = Math.max(1, Math.min(Number(options?.concurrency) || 4, 12));
    let queueIndex = 0;
    const workers = Array.from({ length: Math.min(workerCount, staleCandidates.length) }, async () => {
      while (true) {
        const currentIndex = queueIndex;
        queueIndex += 1;
        if (currentIndex >= staleCandidates.length) return;
        const candidate = staleCandidates[currentIndex];
        const entry = candidate.entry;
        const threadKey = candidate.threadKey;
        const processedAt = nowIso();
        try {
          const analysis = await requestWorkspace(project, "analyzeCodexThread", {
            threadId: entry.threadId,
            sourceHome: entry.sourceHome,
            sessionFilePath: entry.sessionFilePath,
          }, 140_000);
          store.insertSuccessfulSnapshot(
            threadKey,
            entry,
            analysis,
            THREAD_ANALYTICS_ANALYZER_VERSION,
            processedAt,
          );
          counts.processed += 1;
        } catch (error) {
          store.insertErrorSnapshot(
            threadKey,
            entry,
            THREAD_ANALYTICS_ANALYZER_VERSION,
            error?.message || "Analytics parse failed.",
            processedAt,
          );
          counts.failed += 1;
        }
      }
    });
    await Promise.all(workers);

    const entries = store.listProjectThreads(project.id, 260);
    store.finishScanRun(runId, counts, "");
    return {
      ok: true,
      projectId: project.id,
      runId,
      counts,
      entries,
      analyzerVersion: THREAD_ANALYTICS_ANALYZER_VERSION,
      sourceHomes: Array.isArray(discovery?.sourceHomes) ? discovery.sourceHomes : [],
      fallback: discovery?.analyticsFallback ?? discovery?.fallback ?? null,
    };
  } catch (error) {
    counts.failed += 1;
    store.finishScanRun(runId, counts, error.message);
    throw error;
  }
}

async function revealProjectFile(projectId, relPath) {
  const project = await getProjectById(projectId);
  const result = await requestWorkspace(project, "resolvePath", { relPath }, 10_000);
  if (project.workspace?.kind === "local" && result.absolutePath) {
    try {
      shell.showItemInFolder(result.absolutePath);
      return { ...result, opened: true, method: "local-show-item" };
    } catch {
      await clipboard.writeText(result.absolutePath);
      return { ...result, opened: false, method: "copied-path" };
    }
  }
  if (project.workspace?.kind === "wsl" && process.platform === "win32") {
    const distro = project.workspace.distro || "Ubuntu";
    const linuxPath = `${project.workspace.linuxPath.replace(/\/$/, "")}/${String(relPath || "").replace(/^\/+/, "")}`;
    const unc = `\\\\wsl$\\${distro}${linuxPath.split("/").join("\\")}`;
    try {
      shell.showItemInFolder(unc);
    } catch {}
    await clipboard.writeText(unc);
    return { ...result, opened: true, method: "wsl-unc-fallback", uncPath: unc, copiedPath: true };
  }
  await clipboard.writeText(result.absolutePath || relPath || "");
  return { ...result, opened: false, method: "copied-path" };
}

async function chooseAttachmentFiles(projectId) {
  const project = await getProjectById(projectId);
  const result = await dialog.showOpenDialog({
    title: "Attach files to Codex prompt",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (result.canceled || !result.filePaths?.length) return { ok: true, attachments: [], diagnostics: [] };
  return stageAttachmentPaths(project, result.filePaths, "file_picker", requestWorkspace);
}

async function stageDroppedAttachments(projectId, paths) {
  const project = await getProjectById(projectId);
  return stageAttachmentPaths(project, paths, "drag_drop", requestWorkspace);
}

async function pasteClipboardImageAttachment(projectId) {
  const project = await getProjectById(projectId);
  const image = clipboard.readImage();
  if (image.isEmpty()) throw new Error("Clipboard does not contain an image.");
  return stageClipboardImage(project, image.toPNG(), image.getSize(), requestWorkspace);
}

async function removeComposerAttachmentDraft(projectId, draftId) {
  const project = await getProjectById(projectId);
  return removeAttachmentDraft(project, draftId, requestWorkspace);
}

function safeContextUrl(value) {
  try {
    const parsed = new URL(normalizeString(value, ""));
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    if (parsed.username || parsed.password) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function normalizeContextFileRef(value) {
  if (!value || typeof value !== "object") return null;
  const relPath = normalizeString(value.relPath || value.path || value.displayPath, "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!relPath) return null;
  return {
    relPath,
    fallbackRelPath: normalizeString(value.fallbackRelPath || value.fallbackPath || "", "").replace(/\\/g, "/").replace(/^\/+/, ""),
    displayPath: normalizeString(value.displayPath || relPath, ""),
  };
}

function selectedContextFileRefs(request = {}) {
  const refs = Array.isArray(request.selectedFileRefs) ? request.selectedFileRefs : [];
  const selected = [];
  const seen = new Set();
  for (const raw of refs.slice(0, 50)) {
    const ref = normalizeContextFileRef(raw);
    if (!ref || seen.has(ref.relPath)) continue;
    seen.add(ref.relPath);
    selected.push(ref);
  }
  return selected;
}

function sendContextMenuActionResult(sender, result = {}) {
  if (!sender || sender.isDestroyed()) return;
  const authority = senderAuthority(sender);
  const payload = {
    type: "context-menu-action-result",
    schemaVersion: 1,
    requestId: normalizeString(result.requestId, ""),
    actionId: normalizeString(result.actionId || result.requestId, ""),
    actionType: normalizeString(result.actionType, "unknown"),
    status: normalizeString(result.status, "unknown"),
    reason: normalizeString(result.reason, ""),
    mutatedDraftState: Boolean(result.mutatedDraftState),
    mutatedProjectFiles: false,
    approvedCodexRequest: false,
    providerTransportCalls: Number(result.providerTransportCalls) || 0,
    appServerMutationCalls: 0,
    codexApprovalCalls: 0,
    patchApplyCalls: 0,
    commandRunCalls: 0,
    rightPaneMutated: Boolean(result.rightPaneMutated),
    handoffMutationCalls: Number(result.handoffMutationCalls) || 0,
    attachmentStagingWrites: Number(result.attachmentStagingWrites) || 0,
    at: nowIso(),
  };
  if (authority.surfaceRole === SURFACE_ROLES.TRUSTED_CODEX_SURFACE) {
    sender.send("codex-surface:event", payload);
    return;
  }
  sender.send("surface:event", { surface: "shell", ...payload });
}

function sendCodexSurfaceDiagnostic(sender, message) {
  if (!sender || sender.isDestroyed()) return;
  const text = typeof message === "string" ? message.trim() : errorMessageText(message);
  if (!text) return;
  const authority = senderAuthority(sender);
  if (authority.surfaceRole === SURFACE_ROLES.TRUSTED_CODEX_SURFACE) {
    sender.send("codex-surface:event", { type: "attachment-diagnostic", message: text });
  } else {
    sender.send("surface:event", { surface: "shell", type: "context-menu-diagnostic", message: text, at: nowIso() });
  }
}

function runContextMenuAction(sender, requestId, actionType, options = {}, action) {
  Promise.resolve()
    .then(() => action())
    .then((result = {}) => {
      sendContextMenuActionResult(sender, {
        requestId,
        actionType,
        status: "completed",
        ...options,
        ...result,
      });
    })
    .catch((error) => {
      if (typeof options.diagnostic === "function") {
        try {
          sendCodexSurfaceDiagnostic(sender, options.diagnostic(error));
        } catch {
          sendCodexSurfaceDiagnostic(sender, error);
        }
      }
      sendContextMenuActionResult(sender, {
        requestId,
        actionType,
        status: "failed",
        reason: errorMessageText(error),
      });
    });
}

async function openContextMenu(event, request = {}) {
  const sender = event.sender;
  const requestId = normalizeString(request.requestId, "") || crypto.randomUUID();
  const projectId = normalizeString(request.projectId, "");
  const targetKind = normalizeString(request.targetKind, "unknown");
  const selectedTextLength = Math.max(0, Number(request.selectedTextLength) || 0);
  const selectedTextPreview = normalizeString(request.selectedTextPreview, "").slice(0, 1000);
  const rawFileRef = normalizeContextFileRef(request.targetFileRef);
  const fileRef = rawFileRef?.relPath || "";
  const fallbackFileRef = rawFileRef?.fallbackRelPath || "";
  const selectedFileRefs = selectedContextFileRefs(request);
  const stashFileRefs = selectedFileRefs.length > 1
    ? selectedFileRefs
    : rawFileRef ? [rawFileRef] : selectedFileRefs;
  const href = safeContextUrl(request.targetHrefDisplay);
  const threadId = normalizeString(request.targetThreadId || request.threadId, "");
  const template = [];

  if (selectedTextLength > 0 || selectedTextPreview) {
    template.push({ role: "copy", label: "Copy selected text" });
  } else {
    template.push({ role: "copy", label: "Copy" });
  }
  if (targetKind === "composer") {
    template.push({ role: "paste", label: "Paste text" });
    template.push({
      label: "Paste image",
      click: () => runContextMenuAction(
        sender,
        requestId,
        "paste_image_into_composer",
        { mutatedDraftState: true, attachmentStagingWrites: 1, diagnostic: (error) => errorMessageText(error) },
        async () => {
          const result = await pasteClipboardImageAttachment(projectId);
          sender.send("codex-surface:event", { type: "attachment-drafts", action: "add", ...result });
          return { attachmentStagingWrites: Array.isArray(result?.drafts) ? result.drafts.length : 1 };
        },
      ),
    });
  }
  if (href) {
    template.push({ type: "separator" });
    template.push({
      label: "Copy link URL",
      click: () => runContextMenuAction(sender, requestId, "copy_link_url", {}, async () => {
        clipboard.writeText(href);
      }),
    });
  }
  if (targetKind === "thread_title" && threadId) {
    template.push({ type: "separator" });
    template.push({
      label: "Copy thread ID",
      click: () => runContextMenuAction(sender, requestId, "copy_thread_id", {}, async () => {
        clipboard.writeText(threadId);
      }),
    });
  }
  if ((fileRef || stashFileRefs.length) && projectId) {
    template.push({ type: "separator" });
    if (fileRef) {
      template.push({
        label: "Copy file reference",
        click: () => runContextMenuAction(sender, requestId, "copy_file_ref", {}, async () => {
          try {
            const resolved = await resolveProjectFileReferenceWithFallback(projectId, fileRef, fallbackFileRef);
            await clipboard.writeText(resolved.relPath || fileRef);
          } catch (error) {
            await clipboard.writeText(fileRef);
            sendCodexSurfaceDiagnostic(sender, `Copied unresolved file reference: ${errorMessageText(error)}`);
          }
        }),
      });
      template.push({
        label: "Reveal file",
        click: () => runContextMenuAction(
          sender,
          requestId,
          "reveal_project_file",
          { diagnostic: (error) => `Reveal failed: ${errorMessageText(error)}` },
          async () => {
            const resolved = await resolveProjectFileReferenceWithFallback(projectId, fileRef, fallbackFileRef);
            await revealProjectFile(projectId, resolved.relPath || fileRef);
          },
        ),
      });
    }
    template.push({
      label: stashFileRefs.length > 1 ? `Add ${stashFileRefs.length} selected files to Project stash` : "Add to Project stash",
      click: () => runContextMenuAction(
        sender,
        requestId,
        "add_to_project_stash",
        { rightPaneMutated: true, diagnostic: (error) => `Project stash add failed: ${errorMessageText(error)}` },
        async () => {
          let added = 0;
          const failed = [];
          for (const ref of stashFileRefs) {
            try {
              const resolved = await resolveProjectFileReferenceWithFallback(projectId, ref.relPath, ref.fallbackRelPath);
              emitShellEvent({
                type: "project-stash-add-file",
                projectId,
                codexThreadId: threadId,
                relPath: resolved.relPath || ref.relPath,
                label: resolved.relPath || ref.relPath,
                source: stashFileRefs.length > 1 ? "codex-selection-context-menu" : "codex-file-context-menu",
                at: nowIso(),
              });
              added += 1;
            } catch (error) {
              failed.push(`${ref.relPath}: ${errorMessageText(error)}`);
            }
          }
          sendCodexSurfaceDiagnostic(
            sender,
            failed.length
              ? `Added ${added} file${added === 1 ? "" : "s"} to Project stash; ${failed.length} failed.`
              : `Added ${added} file${added === 1 ? "" : "s"} to Project stash.`,
          );
          return {
            status: failed.length ? (added ? "partial" : "failed") : "completed",
            rightPaneMutated: added > 0,
            reason: failed.length ? `${failed.length} file(s) failed` : "",
          };
        },
      ),
    });
    if (threadId && fileRef) {
      try {
        const project = await getProjectById(projectId);
        const matches = bindingsForCodexThread(project, threadId);
        if (matches.length === 1) {
          const targetTitle = normalizeString(matches[0].chatThread?.title, "linked ChatGPT");
          template.push({
            label: `Send to ${targetTitle} for review`,
            click: () => runContextMenuAction(
              sender,
              requestId,
              "send_file_to_linked_chatgpt",
              { handoffMutationCalls: 1, rightPaneMutated: true, diagnostic: (error) => `ChatGPT review send failed: ${errorMessageText(error)}` },
              async () => {
                const resolved = await resolveProjectFileReferenceWithFallback(projectId, fileRef, fallbackFileRef);
                const result = await sendCodexFileToLinkedChatgpt(projectId, threadId, resolved.relPath || fileRef);
                sendCodexSurfaceDiagnostic(sender, `Sent ${result.relPath} to linked ChatGPT thread "${result.chatThreadTitle}".`);
              },
            ),
          });
        } else {
          template.push({
            label: matches.length ? "Send to ChatGPT unavailable: multiple linked threads" : "Send to ChatGPT unavailable: no linked thread",
            enabled: false,
          });
        }
      } catch {
        template.push({ label: "Send to ChatGPT unavailable: project not found", enabled: false });
      }
    }
  }
  if (!template.length) return { ok: false, status: "blocked", reason: "No menu items available." };
  Menu.buildFromTemplate(template).popup();
  return {
    ok: true,
    schemaVersion: 1,
    type: "context-menu-open-result",
    requestId,
    status: "menu_opened",
    itemCount: template.length,
    actionResultDelivery: "async_context_menu_action_result_event",
  };
}

async function getWorkspaceStatus(projectId) {
  const project = await getProjectById(projectId);
  const manager = ensureWorkspaceBackendManager();
  return {
    ...manager.statusForProject(project),
    root: workspaceRoot(project, repoRoot),
    label: workspaceLabel(project, repoRoot),
  };
}

function openChatgptSettingsScript() {
  return `
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const norm = (value) => String(value || "").replace(/\\s+/g, " ").trim();
      const visible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 4 && rect.height > 4 && style.visibility !== "hidden" && style.display !== "none";
      };
      const click = (element) => {
        if (!element) return false;
        element.scrollIntoView?.({ block: "center", inline: "center" });
        const PointerEventClass = window.PointerEvent || MouseEvent;
        element.dispatchEvent(new PointerEventClass("pointerdown", { bubbles: true, cancelable: true, view: window }));
        element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
        element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
        element.click();
        return true;
      };
      const hasSettingsDialog = () => {
        const dialog = document.querySelector('[role="dialog"], [data-testid*="modal" i]');
        return dialog && /settings|general|personalization|data controls/i.test(norm(dialog.textContent));
      };
      const findByText = (selector, pattern) => {
        for (const element of document.querySelectorAll(selector)) {
          if (visible(element) && pattern.test(norm(element.textContent || element.getAttribute("aria-label")))) return element;
        }
        return null;
      };

      try {
        document.documentElement.classList.add("dark");
        document.documentElement.style.colorScheme = "dark";
      } catch (_) {}

      if (hasSettingsDialog()) return { ok: true, method: "already-open" };

      // Several ChatGPT builds have honored a settings hash. Try it first because it keeps
      // this as a control-plane action rather than requiring visible sidebar/account chrome.
      const priorHash = window.location.hash;
      window.location.hash = "settings/General";
      await sleep(700);
      if (hasSettingsDialog()) return { ok: true, method: "hash-settings-general" };
      if (window.location.hash === "#settings/General" && priorHash && priorHash !== window.location.hash) {
        // Keep the hash if it worked; otherwise the menu-click fallback below remains harmless.
      }

      const profileSelectors = [
        '[data-testid="profile-button"]',
        '[data-testid="user-menu"]',
        '[data-testid*="profile" i]',
        '[data-testid*="account" i]',
        'button[aria-label*="profile" i]',
        'button[aria-label*="account" i]',
        'button[aria-label*="user" i]',
        'button:has(img)'
      ];

      let profileButton = null;
      for (const selector of profileSelectors) {
        profileButton = Array.from(document.querySelectorAll(selector)).reverse().find(visible);
        if (profileButton) break;
      }
      if (!profileButton) {
        const candidates = Array.from(document.querySelectorAll('button, [role="button"]')).filter(visible);
        candidates.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
        profileButton = candidates.find((button) => /profile|account|settings|user|plan|upgrade/i.test(norm(button.textContent || button.getAttribute("aria-label")))) || candidates[0];
      }

      if (profileButton) {
        click(profileButton);
        await sleep(500);
        const settingsItem =
          findByText('[role="menuitem"], button, a, [role="button"]', /^settings$/i) ||
          findByText('[role="menuitem"], button, a, [role="button"]', /settings/i);
        if (settingsItem) {
          click(settingsItem);
          await sleep(700);
          if (hasSettingsDialog()) return { ok: true, method: "account-menu" };
          return { ok: true, method: "clicked-settings-candidate" };
        }
        return { ok: false, method: "profile-clicked-no-settings-item" };
      }
      return { ok: false, method: "no-profile-control-found" };
    })();
  `;
}

async function openChatgptSettings() {
  if (!chatgptView || chatgptView.webContents.isDestroyed()) return { ok: false, method: "no-chatgpt-view" };
  try {
    await forceChatgptDark();
    const result = await chatgptView.webContents.executeJavaScript(openChatgptSettingsScript(), true);
    if (result?.ok) return result;
  } catch (error) {
    // Fall through to hash-load approximation.
  }

  try {
    const current = chatgptView.webContents.getURL() || "https://chatgpt.com/";
    const url = new URL(current.startsWith("http") ? current : "https://chatgpt.com/");
    if (!url.hostname.includes("chatgpt.com") && !url.hostname.includes("chat.openai.com")) {
      url.href = "https://chatgpt.com/";
    }
    url.hash = "settings/General";
    await chatgptView.webContents.loadURL(url.toString());
    return { ok: true, method: "hash-route-load" };
  } catch (error) {
    return { ok: false, method: "failed", error: error.message };
  }
}

async function listCachedChatgptRecentThreads(limit = 40) {
  const safeLimit = safeRecentThreadLimit(limit);
  const cache = await loadChatgptThreadCache();
  const entries = sortRecentThreadEntries(cache.entries).slice(0, safeLimit);
  return {
    source: "persisted-cache",
    available: entries.length > 0,
    entries,
    limit: safeLimit,
    cachedAt: cache.updatedAt,
    cachedCount: cache.entries.length,
  };
}

async function listChatgptRecentThreads(limit = 40, options = {}) {
  const safeLimit = safeRecentThreadLimit(limit);
  const refresh = Boolean(options?.refresh);
  if (!refresh) return listCachedChatgptRecentThreads(safeLimit);

  const cache = await loadChatgptThreadCache();
  const fallbackEntries = sortRecentThreadEntries(cache.entries).slice(0, safeLimit);

  if (!chatgptView || chatgptView.webContents.isDestroyed()) {
    return {
      source: "persisted-cache",
      available: fallbackEntries.length > 0,
      entries: fallbackEntries,
      limit: safeLimit,
      cachedAt: cache.updatedAt,
      cachedCount: cache.entries.length,
      error: "ChatGPT surface is unavailable.",
    };
  }

  const currentUrl = chatgptView.webContents.getURL() || "";
  if (!currentUrl.includes("chatgpt.com") && !currentUrl.includes("chat.openai.com")) {
    return {
      source: "persisted-cache",
      available: fallbackEntries.length > 0,
      entries: fallbackEntries,
      limit: safeLimit,
      cachedAt: cache.updatedAt,
      cachedCount: cache.entries.length,
      error: "ChatGPT surface is not loaded yet.",
    };
  }

  try {
    const live = await chatgptView.webContents.executeJavaScript(chatgptRecentThreadsScript(safeLimit), true);
    const discoveredAt = nowIso();
    const incoming = Array.isArray(live?.entries)
      ? live.entries
        .map((entry) =>
          normalizeRecentThreadEntry(
            {
              ...entry,
              source: mergeThreadSourceLabels(entry?.source, "manual-refresh"),
              discoveredAt,
            },
            discoveredAt,
          )
        )
        .filter(Boolean)
      : [];

    if (!incoming.length) {
      return {
        source: mergeThreadSourceLabels("persisted-cache", normalizeString(live?.source, "refresh-empty")),
        available: fallbackEntries.length > 0,
        entries: fallbackEntries,
        limit: safeLimit,
        cachedAt: cache.updatedAt,
        cachedCount: cache.entries.length,
        error: normalizeString(live?.error, ""),
      };
    }

    const mergedCache = await saveChatgptThreadCache({
      version: CHATGPT_THREAD_CACHE_VERSION,
      updatedAt: discoveredAt,
      entries: [...cache.entries, ...incoming],
    });
    const mergedEntries = sortRecentThreadEntries(mergedCache.entries).slice(0, safeLimit);
    return {
      source: mergeThreadSourceLabels("persisted-cache", normalizeString(live?.source, "manual-refresh")),
      available: mergedEntries.length > 0,
      entries: mergedEntries,
      limit: safeLimit,
      fetchedCount: incoming.length,
      cachedCount: mergedCache.entries.length,
      cachedAt: mergedCache.updatedAt,
      error: normalizeString(live?.error, ""),
    };
  } catch (error) {
    return {
      source: "persisted-cache",
      available: fallbackEntries.length > 0,
      entries: fallbackEntries,
      limit: safeLimit,
      cachedAt: cache.updatedAt,
      cachedCount: cache.entries.length,
      error: error.message,
    };
  }
}

async function createDirectWorkbenchWindow() {
  Menu.setApplicationMenu(null);
  console.log(
    `[Direct Workbench] launch experience=${APP_EXPERIENCE.id} ` +
      `controlPlane=${APP_EXPERIENCE.controlPlane} source=${APP_EXPERIENCE.source}`,
  );
  app.setName(APP_EXPERIENCE.label);
  nativeTheme.themeSource = "dark";

  mainWindow = new BaseWindow({
    width: 1720,
    height: 980,
    minWidth: 720,
    minHeight: 620,
    title: APP_EXPERIENCE.label,
    backgroundColor: "#090a0c",
    show: true,
  });
  codexView = new WebContentsView({
    webPreferences: {
      preload: codexSurfacePreloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      partition: CODEX_PARTITION,
      devTools: true,
    },
  });
  registerWebContentsAuthority(codexView, {
    surfaceName: "codex",
    surfaceRole: SURFACE_ROLES.EXTERNAL_CODEX_URL,
    codexTrustProfile: CODEX_SURFACE_TRUST_PROFILES.UNKNOWN,
    codexBridgeProfile: CODEX_SURFACE_BRIDGE_PROFILES.NONE,
    reason: "direct-workbench-surface-not-loaded",
  });
  mainWindow.contentView.addChildView(codexView);

  const applyBounds = () => {
    if (!mainWindow || !codexView || codexView.webContents.isDestroyed()) return;
    const bounds = mainWindow.getContentBounds();
    codexView.setBounds({
      x: 0,
      y: 0,
      width: Math.max(1, bounds.width),
      height: Math.max(1, bounds.height),
    });
  };
  applyBounds();
  for (const eventName of ["resize", "resized", "maximize", "unmaximize", "enter-full-screen", "leave-full-screen", "restore"]) {
    mainWindow.on(eventName, applyBounds);
  }
  configureGuestSurface("codex", codexView);

  mainWindow.on("closed", () => {
    workspaceBackends?.disposeAll();
    workspaceBackends = null;
    codexAppServer?.dispose();
    codexAppServer = null;
    for (const session of codexSurfaceSessions?.values() || []) {
      session.dispose({ silent: true, reason: "Direct Workbench window closed." }).catch(() => {});
    }
    codexSurfaceSessions = null;
    localSurfaceServer?.dispose();
    localSurfaceServer = null;
    threadAnalyticsStore?.close();
    threadAnalyticsStore = null;
    directFixtureController = null;
    directLiveTextController = null;
    directLiveProbeEvidenceStore = null;
    directImplementationProofEvidenceStore = null;
    directActivationStore = null;
    directThreadWorkbenchController = null;
    directThreadStore?.close();
    directThreadStore = null;
    directSessionStore = null;
    directWorkThreadStore = null;
    directAgentRegistryStore = null;
    directAgentRegistryBackfillStateByProject.clear();
    middleWebHost?.dispose();
    middleWebHost = null;
    closeView(codexView);
    codexView = null;
    mainWindow = null;
  });

  const config = await loadConfig();
  const selectedProject = getSelectedProject(config);
  if (!selectedProject) throw new Error("Direct Workbench requires at least one configured project.");
  const activation = applyProjectActivationBinding(selectedProject);
  const projects = activation.project
    ? config.projects.map((project) => (project.id === activation.project.id ? activation.project : project))
    : config.projects;
  const saved = await saveConfig({ ...config, projects });
  currentProject = getSelectedProject(saved);
  const activationBinding = activation.binding?.id
    ? currentProject?.laneBindings?.find((item) => item.id === activation.binding.id) || activation.binding
    : null;
  await loadCodexSurface(currentProject, {
    ...codexSurfaceOptionsForBinding(activationBinding),
    activationEpoch: nextSurfaceActivationEpoch(),
  });
}

async function createWindow() {
  if (DIRECT_WORKBENCH_MODE) {
    return createDirectWorkbenchWindow();
  }
  Menu.setApplicationMenu(null);
  app.setName(APP_TITLE);
  nativeTheme.themeSource = "dark";

  mainWindow = new BaseWindow({
    width: 1720,
    height: 980,
    minWidth: 1180,
    minHeight: 700,
    title: APP_TITLE,
    backgroundColor: "#080b10",
    show: true,
  });

  shellView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      devTools: true,
    },
  });

  codexView = new WebContentsView({
    webPreferences: {
      preload: codexSurfacePreloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      partition: CODEX_PARTITION,
      devTools: true,
    },
  });

  chatgptView = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      partition: CHATGPT_PARTITION,
      devTools: true,
    },
  });

  registerWebContentsAuthority(shellView, {
    surfaceName: "shell",
    surfaceRole: SURFACE_ROLES.SHELL_RENDERER,
    reason: "shell-preload",
  });
  registerWebContentsAuthority(codexView, {
    surfaceName: "codex",
    surfaceRole: SURFACE_ROLES.EXTERNAL_CODEX_URL,
    codexTrustProfile: CODEX_SURFACE_TRUST_PROFILES.UNKNOWN,
    codexBridgeProfile: CODEX_SURFACE_BRIDGE_PROFILES.NONE,
    reason: "codex-surface-not-loaded",
  });
  registerWebContentsAuthority(chatgptView, {
    surfaceName: "chatgpt",
    surfaceRole: SURFACE_ROLES.CHATGPT_WEB,
    reason: "chatgpt-webcontents",
  });

  mainWindow.contentView.addChildView(shellView);
  mainWindow.contentView.addChildView(codexView);
  mainWindow.contentView.addChildView(chatgptView);
  ensureMiddleWebHost().attachTo(mainWindow.contentView);
  syncWindowGeometry("initial-attach");
  startGeometrySyncLoop();

  configureGuestSurface("codex", codexView);
  configureGuestSurface("chatgpt", chatgptView);
  configureChatgptDownloadBridge();

  for (const eventName of ["resize", "resized", "maximize", "unmaximize", "enter-full-screen", "leave-full-screen", "restore"]) {
    mainWindow.on(eventName, () => {
      syncWindowGeometry(eventName);
    });
  }

  for (const eventName of ["show", "focus"]) {
    mainWindow.on(eventName, () => {
      syncWindowGeometry(eventName);
    });
  }

  mainWindow.on("closed", () => {
    stopGeometrySyncLoop();
    workspaceBackends?.disposeAll();
    workspaceBackends = null;
    codexAppServer?.dispose();
    codexAppServer = null;
    for (const session of codexSurfaceSessions?.values() || []) {
      session.dispose({ silent: true, reason: "Main window closed." }).catch(() => {});
    }
    codexSurfaceSessions = null;
    localSurfaceServer?.dispose();
    localSurfaceServer = null;
    threadAnalyticsStore?.close();
    threadAnalyticsStore = null;
    directFixtureController = null;
    directLiveTextController = null;
    directLiveProbeEvidenceStore = null;
    directImplementationProofEvidenceStore = null;
    directActivationStore = null;
    directThreadWorkbenchController = null;
    directThreadStore?.close();
    directThreadStore = null;
    directSessionStore = null;
    directWorkThreadStore = null;
    directAgentRegistryStore = null;
    directAgentRegistryBackfillStateByProject.clear();
    middleWebHost?.dispose();
    middleWebHost = null;
    if (chatgptDownloadHandler && chatgptView?.webContents && !chatgptView.webContents.isDestroyed()) {
      chatgptView.webContents.session?.removeListener("will-download", chatgptDownloadHandler);
    }
    chatgptDownloadHandler = null;
    activeChatgptContext = null;
    closeView(codexView);
    closeView(chatgptView);
    closeView(shellView);
    mainWindow = null;
    shellView = null;
    codexView = null;
    chatgptView = null;
  });

  await shellView.webContents.loadFile(shellHtmlPath);
  syncWindowGeometry("initial-load");
}

ipcMain.handle("config:load", async () => {
  const config = await loadConfig();
  const defaultWorkspace = defaultProjectWorkspaceConfig();
  const selectedProject = getSelectedProject(config);
  return {
    config,
    configPath: configPath(),
    repoRoot,
    appVersion: app.getVersion(),
    platform: process.platform,
    profile: {
      name: activeAppProfile.profileName,
      isolated: activeAppProfile.isolated,
      userData: activeAppProfile.userData,
    },
    defaultWorkspace,
    defaultCodexRuntime: defaultCodexRuntimeForWorkspace(defaultWorkspace),
    directRuntimeStatus: selectedProject ? buildDirectRuntimeStatusForProject(selectedProject) : null,
    directMetaSessionStatus: selectedProject ? buildDirectMetaSessionStatusForProject(selectedProject) : null,
    allowNonChatgptUrls: allowNonChatgptUrls(),
  };
});

ipcMain.handle("config:save", async (_event, nextConfig) => {
  const saved = await saveConfig(nextConfig);
  return { config: saved, configPath: configPath() };
});

ipcMain.handle("project:select", async (_event, projectId) => {
  const config = await loadConfig();
  const selectedProjectId = config.projects.some((project) => project.id === projectId)
    ? projectId
    : config.projects[0]?.id;
  const selectedProject = config.projects.find((project) => project.id === selectedProjectId) || config.projects[0] || null;
  const activation = applyProjectActivationBinding(selectedProject);
  const projects = activation.project
    ? config.projects.map((project) => (project.id === activation.project.id ? activation.project : project))
    : config.projects;
  const saved = await saveConfig({ ...config, selectedProjectId, projects });
  const project = getSelectedProject(saved);
  const binding = activation.binding?.id
    ? project?.laneBindings?.find((item) => item.id === activation.binding.id) || activation.binding
    : null;
  loadProjectSurfacesDetached(project, binding);
  return { config: saved, project, activationBinding: binding || null };
});

ipcMain.handle("dialog:choose-directory", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog({
    title: "Choose project workspace path",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle("surface:set-layout", async (_event, bounds) => {
  lastSurfaceBounds = {
    codex: sanitizeBounds(bounds?.codex),
    chatgpt: sanitizeBounds(bounds?.chatgpt),
  };
  applySurfaceBounds();
  return true;
});

ipcMain.handle("surface:set-visible", async (_event, visible) => {
  surfacesVisible = Boolean(visible);
  applySurfaceBounds();
  if (surfacesVisible) scheduleLayoutPing("surfaces-visible");
  return surfacesVisible;
});

ipcMain.handle("surface:reload", async (_event, surfaceName) => {
  const view = surfaceName === "chatgpt" ? chatgptView : codexView;
  if (!view || view.webContents.isDestroyed()) return false;
  view.webContents.reload();
  return true;
});

ipcMain.handle("codex:reload-runtime", async (_event, options) => {
  return reloadCodexRuntime(options || {});
});

ipcMain.handle("codex-surface:connect", async (event, payload) => {
  requireFullCodexSurfaceBridge(event.sender, "codex-surface:connect");
  const requestedConnection = payload?.connection || null;
  const activeTransport = normalizeString(activeCodexSurfaceConnection?.transport, "");
  const requestedTransport = normalizeString(requestedConnection?.transport, "");
  const directTransport =
    activeTransport === DIRECT_FIXTURE_SURFACE_TRANSPORT ||
    activeTransport === DIRECT_LIVE_TEXT_SURFACE_TRANSPORT;
  const connection = directTransport
    ? (
        requestedTransport === activeTransport
          ? { ...activeCodexSurfaceConnection, remoteAuth: activeCodexSurfaceConnection.remoteAuth || { mode: "none" } }
          : null
      )
    : {
        ...validateCodexSurfaceConnectionRequest(activeCodexSurfaceConnection, requestedConnection),
        remoteAuth: activeCodexSurfaceConnection.remoteAuth || { mode: "none" },
      };
  if (!connection) throw new Error("Renderer-supplied direct Codex connection ref is stale or invalid.");
  const session = codexSurfaceSessionFor(event.sender, { connection });
  const connectionWithProviders = directTransport
    ? connection
    : {
        ...connection,
        chatgptAuthTokensProvider: async () => directAuthTokensForCodexAppServer({
          refresh: true,
          includeType: false,
        }),
      };
  const connected = await session.connect(connectionWithProviders);
  return {
    connected: true,
    connection: directTransport ? connected?.connection || connection : publicCodexSurfaceConnection(connection),
    connectionId: connected?.connectionId || connection.connectionRef,
    directAuth: directTransport ? { attached: false, reason: "not_app_server_transport" } : { attached: false, reason: "pending_initialize" },
  };
});

ipcMain.handle("codex-surface:disconnect", async (event) => {
  requireFullCodexSurfaceBridge(event.sender, "codex-surface:disconnect");
  const session = codexSurfaceSessionFor(event.sender);
  await session.dispose({ reason: "Renderer requested disconnect." });
  return true;
});

ipcMain.handle("codex-surface:direct-projection", async (event, payload) => {
  requireFullCodexSurfaceBridge(event.sender, "codex-surface:direct-projection");
  const requestedProjectId = normalizeString(payload?.projectId, "");
  const project = currentProject?.id && currentProject.id === requestedProjectId
    ? currentProject
    : await getProjectById(requestedProjectId);
  if (!project) throw new Error("Project not found.");
  const directProviderMetadata = payload?.refreshMetadata
    ? await refreshDirectProviderMetadataForProject(project)
    : directProviderMetadataStatusForProject(project);
  return buildDirectCodexSurfaceProjectionForProject(project, {
    directProviderMetadata,
    threadId: normalizeString(payload?.threadId, ""),
  });
});

ipcMain.handle("codex-surface:request", async (event, payload) => {
  requireFullCodexSurfaceBridge(event.sender, "codex-surface:request");
  const method = normalizeString(payload?.method, "");
  const capabilities = codexSurfaceRequestAuthorizationCapabilities();
  const decision = codexClientRequestDecision(method, capabilities);
  if (!decision.ok) {
    throw new Error(`Codex app-server request method is not authorized: ${method || "<empty>"} (${decision.reason})`);
  }
  const session = codexSurfaceSessionFor(event.sender);
  const result = await session.request(method, payload?.params || {});
  if (
    method === "initialize" &&
    ![DIRECT_FIXTURE_SURFACE_TRANSPORT, DIRECT_LIVE_TEXT_SURFACE_TRANSPORT].includes(session.transportKind)
  ) {
    return attachDirectAuthAfterInitialize(session, result);
  }
  return result;
});

ipcMain.handle("codex-surface:notify", async (event, payload) => {
  requireFullCodexSurfaceBridge(event.sender, "codex-surface:notify");
  const method = normalizeString(payload?.method, "");
  const capabilities = codexSurfaceRequestAuthorizationCapabilities();
  const decision = codexClientNotificationDecision(method, capabilities);
  if (!decision.ok) {
    throw new Error(`Codex app-server notification method is not authorized: ${method || "<empty>"} (${decision.reason})`);
  }
  const session = codexSurfaceSessionFor(event.sender);
  return session.notify(method, payload?.params || {});
});

ipcMain.handle("codex-surface:respond", async (event, payload) => {
  requireFullCodexSurfaceBridge(event.sender, "codex-surface:respond");
  const session = codexSurfaceSessionFor(event.sender);
  const requestKey = payload?.key || payload?.id || "";
  const record = session.findServerRequest(requestKey);
  if (record && CODEX_SURFACE_SENSITIVE_RESPONSE_RISKS.has(record.riskCategory)) {
    throw new Error("Sensitive Codex requests must be answered from the shell control plane.");
  }
  return session.respondServerRequest(requestKey, payload?.result || {});
});

ipcMain.handle("codex-surface:thread-state", async (event, payload) => {
  requireFullCodexSurfaceBridge(event.sender, "codex-surface:thread-state");
  if (isStaleSurfaceActivationEpoch(payload?.activationEpoch)) return { ok: false, stale: true };
  const session = codexSurfaceSessionFor(event.sender);
  const state = {
    surface: "codex",
    type: "thread-state",
    projectId: normalizeString(payload?.projectId, ""),
    threadId: normalizeString(payload?.threadId, ""),
    sourceHome: normalizeString(payload?.sourceHome, ""),
    sessionFilePath: normalizeString(payload?.sessionFilePath, ""),
    title: normalizeString(payload?.title, ""),
    status: normalizeString(payload?.status, "unknown"),
    activationEpoch: Number(payload?.activationEpoch) || 0,
    evidence: normalizeString(payload?.evidence, ""),
    errorDescription: normalizeString(payload?.errorDescription || payload?.error, ""),
    connectionId: session.connectionId || "",
    at: nowIso(),
  };
  const previousContextEvidence = latestContextManagementEvidenceByProject.get(state.projectId);
  if (
    previousContextEvidence &&
    normalizeString(previousContextEvidence.threadId, "") &&
    state.threadId &&
    normalizeString(previousContextEvidence.threadId, "") !== state.threadId
  ) {
    latestContextManagementEvidenceByProject.delete(state.projectId);
    contextManagementObservationsByProject.delete(state.projectId);
  }
  rememberCodexThreadRestoreTarget(state);
  emitToShell("surface:event", state);
  return { ok: true };
});

ipcMain.handle("codex-surface:context-management-evidence", async (event, payload) => {
  if (isStaleSurfaceActivationEpoch(payload?.activationEpoch)) return { ok: false, stale: true };
  const session = codexSurfaceSessionFor(event.sender);
  const evidence = recordContextManagementEvidence({
    projectId: normalizeString(payload?.projectId, ""),
    threadId: normalizeString(payload?.threadId, ""),
    threadItems: payload?.threadItems,
    controlsObserved: payload?.controlsObserved,
  });
  if (!evidence) return { ok: false, error: "context_management_evidence_empty" };
  const state = {
    surface: "codex",
    type: "context-management-evidence",
    projectId: evidence.projectId,
    threadId: evidence.threadId,
    evidenceId: evidence.evidenceId,
    contextCompactionCount: Array.isArray(evidence.contextCompaction) ? evidence.contextCompaction.length : 0,
    compactControlCount: Array.isArray(evidence.compactControls) ? evidence.compactControls.length : 0,
    memoryCitationCount: Array.isArray(evidence.memoryCitations) ? evidence.memoryCitations.length : 0,
    memoryControlCount: Array.isArray(evidence.memoryControls) ? evidence.memoryControls.length : 0,
    connectionId: session.connectionId || "",
    at: nowIso(),
  };
  emitToShell("surface:event", state);
  return { ok: true, evidenceId: evidence.evidenceId };
});

ipcMain.handle("codex-surface:agent-graph", async (event, payload) => {
  requireFullCodexSurfaceBridge(event.sender, "codex-surface:agent-graph");
  if (isStaleSurfaceActivationEpoch(payload?.activationEpoch)) return { ok: false, stale: true };
  const session = codexSurfaceSessionFor(event.sender);
  const state = {
    surface: "codex",
    type: "agent-graph",
    projectId: normalizeString(payload?.projectId, ""),
    primaryThreadId: normalizeString(payload?.primaryThreadId || payload?.threadId, ""),
    sourceHome: normalizeString(payload?.sourceHome, ""),
    sessionFilePath: normalizeString(payload?.sessionFilePath, ""),
    graphRevision: Number(payload?.graphRevision) || 0,
    activationEpoch: Number(payload?.activationEpoch) || 0,
    agents: Array.isArray(payload?.agents) ? payload.agents : [],
    activeCount: Number(payload?.activeCount) || 0,
    completedCount: Number(payload?.completedCount) || 0,
    erroredCount: Number(payload?.erroredCount) || 0,
    connectionId: session.connectionId || "",
    at: nowIso(),
  };
  if (state.projectId && state.primaryThreadId) {
    latestCodexAgentGraphByProjectThread.set(codexAgentGraphCacheKey(state.projectId, state.primaryThreadId), state);
  }
  emitToShell("surface:event", state);
  return { ok: true };
});

ipcMain.handle("codex-surface:focus-sub-agent", async (event, payload) => {
  requireFullCodexSurfaceBridge(event.sender, "codex-surface:focus-sub-agent");
  if (isStaleSurfaceActivationEpoch(payload?.activationEpoch)) return { ok: false, stale: true };
  const state = {
    surface: "codex",
    type: "focus-sub-agent",
    projectId: normalizeString(payload?.projectId, ""),
    primaryThreadId: normalizeString(payload?.primaryThreadId || payload?.threadId, ""),
    receiverThreadId: normalizeString(payload?.receiverThreadId, ""),
    scopeMode: normalizeString(payload?.scopeMode, ""),
    turnKey: normalizeString(payload?.turnKey, ""),
    graphRevision: Number(payload?.graphRevision) || 0,
    activationEpoch: Number(payload?.activationEpoch) || 0,
    label: normalizeString(payload?.label, ""),
    at: nowIso(),
  };
  if (!state.receiverThreadId) return { ok: false, error: "missing_receiver_thread_id" };
  emitToShell("surface:event", state);
  return { ok: true };
});

ipcMain.handle("codex-runtime-preferences:get", async (event, payload) => {
  requireFullCodexSurfaceBridge(event.sender, "codex-runtime-preferences:get");
  const config = await loadConfig();
  return { ok: true, ...codexRuntimePreferenceLookup(config, payload || {}) };
});

ipcMain.handle("codex-runtime-preferences:update", async (event, payload) => {
  requireFullCodexSurfaceBridge(event.sender, "codex-runtime-preferences:update");
  return updateCodexRuntimePreferences(payload || {});
});

ipcMain.handle("codex:respond-request", async (_event, payload) => {
  const requestKey = payload?.key || payload?.id || "";
  const session = findCodexSurfaceSessionForRequest(requestKey);
  if (!session) throw new Error("Codex request is no longer pending.");
  return session.respondServerRequest(requestKey, payload?.result || {});
});

ipcMain.handle("codex:focus-request", async (_event, payload) => {
  const requestKey = normalizeString(payload?.key, "");
  if (!requestKey || !codexView?.webContents || codexView.webContents.isDestroyed()) return false;
  codexView.webContents.send("codex-surface:event", {
    type: "focus-server-request",
    key: requestKey,
  });
  return true;
});

ipcMain.handle("codex:dismiss-composer-overlay", async (_event, payload) => {
  if (!codexView?.webContents || codexView.webContents.isDestroyed()) return false;
  codexView.webContents.send("codex-surface:event", {
    type: "dismiss-composer-overlay",
    reason: normalizeString(payload?.reason, "shell"),
  });
  return true;
});

ipcMain.handle("surface:open-external", async (_event, surfaceName) => {
  const view = surfaceName === "chatgpt" ? chatgptView : codexView;
  if (!view || view.webContents.isDestroyed()) return false;
  const url = view.webContents.getURL();
  const decision = externalNavigationDecision(url);
  if (decision.action !== "allow") return false;
  await shell.openExternal(decision.normalizedUrl);
  return true;
});

ipcMain.handle("link:open", async (event, payload) => {
  requireShellOrTrustedCodex(event.sender, "link:open");
  return ensureMiddleWebHost().openLink(payload || {});
});

ipcMain.handle("middle-web:set-layout", async (_event, payload) => {
  return ensureMiddleWebHost().setLayout(payload || {});
});

ipcMain.handle("middle-web:go-back", async () => ensureMiddleWebHost().goBack());

ipcMain.handle("middle-web:go-forward", async () => ensureMiddleWebHost().goForward());

ipcMain.handle("middle-web:reload", async () => ensureMiddleWebHost().reload());

ipcMain.handle("middle-web:stop", async () => ensureMiddleWebHost().stop());

ipcMain.handle("middle-web:open-external", async () => ensureMiddleWebHost().openExternal());

ipcMain.handle("middle-web:copy-url", async () => ensureMiddleWebHost().copyUrl());

ipcMain.handle("middle-web:snapshot", async () => ensureMiddleWebHost().snapshot());

ipcMain.handle("middle-web:history", async () => {
  return { ok: true, entries: ensureMiddleWebHost().history() };
});

ipcMain.handle("middle-web:open-history-entry", async (_event, payload) => {
  return ensureMiddleWebHost().openHistoryEntry(payload || {});
});

ipcMain.handle("middle-web:prune-history", async (_event, payload) => {
  return ensureMiddleWebHost().pruneHistory(payload || {});
});

ipcMain.handle("plane-zoom:adjust", async (_event, payload) => {
  return adjustPlaneZoom(normalizeString(payload?.plane, "middle"), payload?.direction);
});

ipcMain.handle("plane-zoom:set", async (_event, payload) => {
  const plane = normalizeString(payload?.plane, "middle");
  if (plane === "middle") return ensureMiddleWebHost().setZoomFactor(payload?.zoomFactor);
  return setNativePlaneZoom(plane, payload?.zoomFactor);
});

ipcMain.handle("external:open-url", async (event, payload) => {
  requireShellOrTrustedCodex(event.sender, "external:open-url");
  const rawUrl = normalizeString(payload?.url, "");
  const decision = externalNavigationDecision(rawUrl);
  if (decision.action !== "allow") {
    return { ok: false, error: externalNavigationBlockedMessage(decision.reason), reason: decision.reason };
  }
  await shell.openExternal(decision.normalizedUrl);
  return { ok: true, url: decision.displayUrl };
});

ipcMain.handle("clipboard:write-text", async (_event, text) => {
  clipboard.writeText(String(text ?? ""));
  return true;
});

ipcMain.handle("worktree:list", async (_event, payload) => {
  return listWorkTree(payload?.projectId, payload?.relPath);
});

ipcMain.handle("worktree:read-file", async (_event, payload) => {
  return readProjectFile(payload?.projectId, payload?.relPath);
});

ipcMain.handle("file-view:open-project-file", async (event, payload) => {
  requireShellOrTrustedCodex(event.sender, "file-view:open-project-file");
  return openProjectFileInMiddle(payload || {});
});


ipcMain.handle("worktree:list-watched", async (_event, payload) => {
  return listWatchedArtifacts(payload?.projectId);
});

ipcMain.handle("codex-threads:list", async (_event, payload) => {
  return listCodexThreads(payload?.projectId);
});

ipcMain.handle("codex-thread:transcript", async (event, payload) => {
  requireFullCodexSurfaceBridge(event.sender, "codex-thread:transcript");
  return readCodexThreadTranscript(
    payload?.projectId,
    payload?.threadId,
    payload?.sourceHome,
    payload?.sessionFilePath,
    payload?.limit,
  );
});

ipcMain.handle("codex:select-thread", async (_event, payload) => {
  return requestCodexThreadOpen(
    payload?.projectId,
    payload?.threadId,
    payload?.sourceHome,
    payload?.sessionFilePath,
  );
});

ipcMain.handle("thread-analytics:list", async (_event, payload) => {
  return listThreadAnalytics(payload?.projectId, { limit: payload?.limit });
});

ipcMain.handle("thread-analytics:update", async (_event, payload) => {
  return updateThreadAnalytics(payload?.projectId, { scope: payload?.scope });
});

ipcMain.handle("thread-analytics:detail", async (_event, payload) => {
  return getThreadAnalyticsDashboard(payload?.projectId, payload?.threadKey);
});

ipcMain.handle("worktree:reveal-file", async (event, payload) => {
  requireShellOrTrustedCodex(event.sender, "worktree:reveal-file");
  return revealProjectFile(payload?.projectId, payload?.relPath);
});

ipcMain.handle("attachments:choose-files", async (event, payload) => {
  requireShellOrTrustedCodex(event.sender, "attachments:choose-files");
  return chooseAttachmentFiles(payload?.projectId);
});

ipcMain.handle("attachments:stage-drop", async (event, payload) => {
  requireShellOrTrustedCodex(event.sender, "attachments:stage-drop");
  return stageDroppedAttachments(payload?.projectId, payload?.paths);
});

ipcMain.handle("attachments:paste-image", async (event, payload) => {
  requireShellOrTrustedCodex(event.sender, "attachments:paste-image");
  return pasteClipboardImageAttachment(payload?.projectId);
});

ipcMain.handle("attachments:remove-draft", async (event, payload) => {
  requireShellOrTrustedCodex(event.sender, "attachments:remove-draft");
  return removeComposerAttachmentDraft(payload?.projectId, payload?.draftId);
});

ipcMain.handle("context-menu:open", async (event, payload) => {
  requireShellOrTrustedCodex(event.sender, "context-menu:open");
  return openContextMenu(event, payload || {});
});

ipcMain.handle("project-stash:send-to-chatgpt", async (_event, payload) => {
  return sendProjectStashToLinkedChatgpt(payload || {});
});

ipcMain.handle("project-stash:send", async (_event, payload) => {
  const target = normalizeString(payload?.targetSurface, "chatgpt");
  if (target === "codex") return sendProjectStashToLinkedCodex(payload || {});
  return sendProjectStashToLinkedChatgpt(payload || {});
});

ipcMain.handle("chatgpt:select-thread", async (_event, payload) => {
  const config = await loadConfig();
  const projectId = normalizeString(payload?.projectId, config.selectedProjectId);
  const threadId = normalizeString(payload?.threadId, "");
  const projects = config.projects.map((project) => {
    if (project.id !== projectId) return project;
    const exists = project.chatThreads?.some((thread) => thread.id === threadId && !thread.archived);
    if (!exists) return project;
    const now = nowIso();
    const chatThreads = project.chatThreads.map((thread) =>
      thread.id === threadId ? { ...thread, lastOpenedAt: now, updatedAt: now } : thread,
    );
    return { ...project, chatThreads, activeChatThreadId: threadId, lastActiveThreadId: threadId, updatedAt: now };
  });
  const saved = await saveConfig({ ...config, selectedProjectId: projectId, projects });
  const project = saved.projects.find((item) => item.id === projectId) || getSelectedProject(saved);
  const thread = project?.chatThreads?.find((item) => item.id === project.activeChatThreadId) || activeChatThread(project);
  if (project && thread) {
    currentProject = project;
    await loadChatgptSurface(project, thread.id);
    scheduleLayoutPing("chatgpt-thread-selected");
  }
  return { config: saved, project, thread };
});

ipcMain.handle("chatgpt:cached-threads", async (_event, payload) => {
  return listCachedChatgptRecentThreads(payload?.limit);
});

ipcMain.handle("chatgpt:recent-threads", async (_event, payload) => {
  return listChatgptRecentThreads(payload?.limit, { refresh: Boolean(payload?.refresh) });
});

ipcMain.handle("chatgpt:open-url", async (_event, payload) => {
  return openChatgptThreadUrl(payload?.url);
});

ipcMain.handle("workspace:attach", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  const session = await attachProjectWorkspace(project, { wait: true });
  return session.snapshot();
});

ipcMain.handle("workspace:status", async (_event, payload) => {
  return getWorkspaceStatus(payload?.projectId);
});

ipcMain.handle("direct-runtime:status", async (_event, payload) => {
  const requestedProjectId = normalizeString(payload?.projectId, "");
  const project = currentProject?.id && currentProject.id === requestedProjectId
    ? currentProject
    : await getProjectById(requestedProjectId);
  return buildDirectRuntimeStatusForProject(project);
});

ipcMain.handle("direct-ui:implementation-status", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  const runtimeStatus = buildDirectRuntimeStatusForProject(project);
  return buildDirectImplementationLaneUiStatus({ project, runtimeStatus });
});

ipcMain.handle("direct-ui:operation-history", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  const cursorOffset = Number.parseInt(String(payload?.cursor || ""), 10);
  const rawOffset = Number.parseInt(String(payload?.offset || ""), 10);
  const rawLimit = Number.parseInt(String(payload?.limit || ""), 10);
  const offset = Number.isFinite(cursorOffset) ? cursorOffset : Number.isFinite(rawOffset) ? rawOffset : undefined;
  const limit = Number.isFinite(rawLimit) ? rawLimit : undefined;
  const params = {
    limit,
    offset,
    operationTypes: payload?.operationTypes,
    statuses: payload?.statuses,
    targetTurnId: payload?.targetTurnId,
    targetObligationId: payload?.targetObligationId,
  };
  const operationHistory = await ensureDirectThreadWorkbenchController().readOperationHistory(project, params);
  return projectOperationHistoryPage({
    projectId: project.id,
    operationHistory,
    request: {
      scope: payload?.scope || "active-turn",
      limit,
      offset,
    },
  });
});

ipcMain.handle("direct-ui:policy-readonly-view", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  const runtimeStatus = buildDirectRuntimeStatusForProject(project);
  return buildDirectPolicyReadOnlyView({ project, runtimeStatus });
});

ipcMain.handle("direct-meta-session:status", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  return buildDirectMetaSessionStatusForProject(project, payload || {});
});

ipcMain.handle("direct-settings:bridge-status", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  return buildDirectSettingsSurfaceStatusForProject(project);
});

ipcMain.handle("direct-runtime:select-text-only", async (_event, payload) => {
  return selectDirectTextOnlyRuntime(payload || {});
});

ipcMain.handle("direct-runtime:embark", async (_event, payload) => {
  return embarkDirectRuntime(payload || {});
});

ipcMain.handle("direct-runtime:set-path", async (_event, payload) => {
  return setCodexRuntimePath(payload || {});
});

ipcMain.handle("direct-runtime:enable-experimental", async (_event, payload) => {
  return enableDirectExperimentalProject(payload || {});
});

ipcMain.handle("direct-runtime:rollback-experimental", async (_event, payload) => {
  return rollbackDirectExperimentalProject(payload || {});
});

ipcMain.handle("direct-import:list-sources", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  return ensureDirectImportController().listSources(project, payload || {});
});

ipcMain.handle("direct-import:choose-source-file", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  if (!mainWindow) return { ok: false, canceled: true, source: null };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose legacy Codex JSONL source",
    properties: ["openFile"],
    filters: [
      { name: "Codex JSONL", extensions: ["jsonl"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true, source: null };
  const sourcePath = result.filePaths[0];
  const source = ensureDirectImportController().registerSourceHandle(project, {
    sourcePath,
    sourceRoot: path.dirname(sourcePath),
    sourceSelectionMode: "native-file-picker",
  });
  return { ok: true, canceled: false, source, defaultCodexHomeScanned: false };
});

ipcMain.handle("direct-import:choose-source-root", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  if (!mainWindow) return { ok: false, canceled: true, sources: [] };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose legacy Codex JSONL source root",
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true, sources: [] };
  return ensureDirectImportController().listSources(project, {
    sourceRoot: result.filePaths[0],
    sourceSelectionMode: "native-root-picker",
  });
});

ipcMain.handle("direct-import:inspect-source", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  return ensureDirectImportController().inspectSource(project, payload || {});
});

ipcMain.handle("direct-import:build-candidate", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  return ensureDirectImportController().buildCandidate(project, payload || {});
});

ipcMain.handle("direct-import:build-checkpoint", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  return ensureDirectImportController().buildCheckpoint(project, payload || {});
});

ipcMain.handle("direct-import:materialize", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  return ensureDirectImportController().materialize(project, payload || {});
});

ipcMain.handle("direct-import:read-report", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  return ensureDirectImportController().readReport(project, payload || {});
});

ipcMain.handle("direct-import:read-session", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  return ensureDirectImportController().readImportSession(project, payload || {});
});

ipcMain.handle("direct-import:list-imports", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  return ensureDirectImportController().listImports(project, payload || {});
});

ipcMain.handle("direct-import:hide", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  return ensureDirectImportController().hideImport(project, payload || {});
});

ipcMain.handle("direct-import:unhide", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  return ensureDirectImportController().unhideImport(project, payload || {});
});

ipcMain.handle("direct-import:cancel", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  return ensureDirectImportController().cancelImport(project, payload || {});
});

ipcMain.handle("direct-import:preview-checkpoint-continuation", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  return ensureDirectImportController().previewCheckpointContinuation(project, payload || {});
});

ipcMain.handle("direct-import:start-checkpoint-continuation", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  const result = await ensureDirectImportController().startCheckpointContinuation(project, payload || {});
  emitDirectRuntimeStatus(project);
  return result;
});

ipcMain.handle("direct-thread-workbench:snapshot", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  return ensureDirectThreadWorkbenchController().getSnapshot(project, payload || {});
});

ipcMain.handle("direct-thread-workbench:evidence-projection", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  return ensureDirectThreadWorkbenchController().getEvidenceWorkbenchProjection(project, payload || {});
});

ipcMain.handle("direct-thread-workbench:read-thread-projection", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  return ensureDirectThreadWorkbenchController().readThreadProjection(project, payload?.threadId, payload || {});
});

ipcMain.handle("direct-thread-workbench:read-project-projection", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  return ensureDirectThreadWorkbenchController().readProjectProjection(project, payload?.projectionKind, payload || {});
});

ipcMain.handle("direct-thread-workbench:read-preview-projection", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  return ensureDirectThreadWorkbenchController().readPreviewProjection(project, payload?.previewId, payload || {});
});

ipcMain.handle("direct-thread-workbench:read-operation-history", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  return ensureDirectThreadWorkbenchController().readOperationHistory(project, payload || {});
});

ipcMain.handle("direct-thread-workbench:create-work-thread-draft-session", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  const result = await ensureDirectThreadWorkbenchController().createWorkThreadDraftSession(project, payload || {});
  emitDirectRuntimeStatus(project);
  return result;
});

ipcMain.handle("direct-thread-workbench:prepare-soft-delete", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  return ensureDirectThreadWorkbenchController().prepareSoftDelete(project, payload?.threadId, payload || {});
});

ipcMain.handle("direct-thread-workbench:run-lifecycle-action", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  const result = await ensureDirectThreadWorkbenchController().runLifecycleAction(project, payload || {});
  emitDirectRuntimeStatus(project);
  return result;
});

ipcMain.handle("direct-thread-workbench:create-external-ref", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  return ensureDirectThreadWorkbenchController().createExternalRef(project, payload || {});
});

ipcMain.handle("direct-thread-workbench:create-bridge", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  return ensureDirectThreadWorkbenchController().createBridge(project, payload || {});
});

ipcMain.handle("direct-thread-workbench:unlink-bridge", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  return ensureDirectThreadWorkbenchController().unlinkBridge(project, payload || {});
});

ipcMain.handle("direct-thread-workbench:create-merge-preview", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  return ensureDirectThreadWorkbenchController().createMergePreview(project, payload || {});
});

ipcMain.handle("direct-thread-workbench:create-prune-preview", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  return ensureDirectThreadWorkbenchController().createPrunePreview(project, payload || {});
});

ipcMain.handle("direct-thread-workbench:create-fork-preview", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  return ensureDirectThreadWorkbenchController().createForkPreview(project, payload || {});
});

ipcMain.handle("direct-thread-workbench:prepare-fork-start", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  return ensureDirectThreadWorkbenchController().prepareForkStart(project, payload || {});
});

ipcMain.handle("direct-thread-workbench:start-fork-from-preview", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  const result = await ensureDirectThreadWorkbenchController().startForkFromPreview(project, payload || {});
  emitDirectRuntimeStatus(project);
  return result;
});

ipcMain.handle("direct-thread-workbench:prepare-derived-preview-fork-start", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  return ensureDirectThreadWorkbenchController().prepareDerivedPreviewForkStart(project, payload || {});
});

ipcMain.handle("direct-thread-workbench:start-fork-from-derived-preview", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  const result = await ensureDirectThreadWorkbenchController().startForkFromDerivedPreview(project, payload || {});
  emitDirectRuntimeStatus(project);
  return result;
});

ipcMain.handle("direct-thread-workbench:read-fork-start-status", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  return ensureDirectThreadWorkbenchController().readForkStartStatus(project, payload?.forkStartId);
});

ipcMain.handle("direct-thread-workbench:rebuild-lifecycle-projection", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  return ensureDirectThreadWorkbenchController().rebuildLifecycleProjection(project, payload || {});
});

ipcMain.handle("direct-thread-workbench:rebuild-graph-projection", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  return ensureDirectThreadWorkbenchController().rebuildGraphProjection(project, payload || {});
});

ipcMain.handle("direct-thread-workbench:rebuild-renderer-projection", async (_event, payload) => {
  const project = await getProjectById(payload?.projectId);
  return ensureDirectThreadWorkbenchController().rebuildRendererTranscriptProjection(project, payload?.threadId, payload || {});
});

ipcMain.handle("workspace:run-command", async (_event, payload) => {
  return runWorkspaceCommand(payload?.projectId, payload?.command);
});

ipcMain.handle("chatgpt:open-settings", async () => {
  const result = await openChatgptSettings();
  emitToShell("surface:event", {
    surface: "chatgpt",
    type: result.ok ? "settings-opened" : "settings-open-failed",
    method: result.method,
    error: result.error,
    at: nowIso(),
  });
  return result;
});

ipcMain.handle("chatgpt:force-dark", async () => forceChatgptDark());

app.whenReady().then(async () => {
  nativeTheme.themeSource = "dark";
  ensureWorkspaceBackendManager();
  await loadConfig();
  await createWindow();
  if (Number.isFinite(smokeExitMs) && smokeExitMs > 0) {
    setTimeout(() => {
      app.quit();
    }, smokeExitMs);
  }
  app.on("activate", async () => {
    if (!mainWindow) await createWindow();
  });
});

app.on("before-quit", () => {
  workspaceBackends?.disposeAll();
  workspaceBackends = null;
  threadAnalyticsStore?.close();
  threadAnalyticsStore = null;
  directAuthLoginCoordinator = null;
  directCodexCliAuthStore = null;
  directFixtureController = null;
  directLiveTextController = null;
  directLiveProbeEvidenceStore = null;
  directImplementationProofEvidenceStore = null;
  directActivationStore = null;
  directThreadWorkbenchController = null;
    directThreadStore?.close();
    directThreadStore = null;
    directSessionStore = null;
    directWorkThreadStore = null;
    directAgentRegistryStore = null;
    directAgentRegistryBackfillStateByProject.clear();
});

function emitDirectAuthAndRuntimeStatus(event) {
  emitShellEvent(event);
  emitDirectRuntimeStatus(currentProject);
}

registerDirectAuthIpcHandlers(ipcMain, () => ensureDirectAuthController(), {
  onStatusChange: emitDirectAuthAndRuntimeStatus,
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
