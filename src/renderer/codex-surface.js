function decodePayload() {
  const raw = window.location.hash.slice(1);
  if (!raw) return null;
  try {
    const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      Array.from(atob(normalized), (char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""),
    );
    return JSON.parse(json);
  } catch (error) {
    console.error("Unable to decode Codex surface payload", error);
    return null;
  }
}

const bridge = window.codexSurfaceBridge;
const payload = decodePayload() || {};
const project = payload.project || null;
let connection = payload.codexConnection || null;

const USER_MESSAGE_PAGE_SIZE = 10;
const USER_MESSAGE_PREVIEW_LINES = 10;
const MAX_COMMAND_OUTPUT_CHARS = 1200;
const EMPTY_TURN_AUTO_RETRY_LIMIT = 1;
const DEFAULT_REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"];
const APPROVAL_POLICY_OPTIONS = ["", "untrusted", "on-failure", "on-request", "never"];
const SANDBOX_MODE_OPTIONS = ["", "read-only", "workspace-write", "danger-full-access"];
const MODEL_LIST_PAGE_LIMIT = 100;
const MODEL_LIST_PAGE_SIZE = 100;
const RATE_LIMIT_STALE_MS = 5 * 60 * 1000;
const CONTEXT_BASELINE_TOKENS = 12000;
const THOUGHT_ITEM_TYPES = new Set([
  "reasoning",
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "webSearch",
  "imageGeneration",
  "collabAgentToolCall",
]);
const TOOL_LIKE_THOUGHT_TYPES = new Set([
  "commandExecution",
  "mcpToolCall",
  "dynamicToolCall",
  "webSearch",
  "collabAgentToolCall",
]);
const THOUGHT_ASSISTANT_PHASES = new Set([
  // Canonical Codex phase for interim assistant preamble/progress text.
  "commentary",
]);

const state = {
  threadId: "",
  threadTitle: "",
  turnId: "",
  activeModel: "",
  accountState: null,
  models: [],
  modelListStatus: "idle",
  modelListError: "",
  rateLimits: null,
  rateLimitsStatus: "idle",
  rateLimitsError: "",
  rateLimitsObservedAt: 0,
  tokenUsage: null,
  tokenUsageStatus: "idle",
  tokenUsageObservedAt: 0,
  configRequirements: null,
  configRequirementsStatus: "idle",
  configRequirementsError: "",
  runtimeOverrides: {
    model: project?.codex?.model || "",
    reasoningEffort: project?.codex?.reasoningEffort || "",
    approvalPolicy: "",
    sandboxMode: "",
    serviceTier: "",
  },
  workspaceStatus: payload.workspaceStatus || null,
  connectionStatus: connection?.wsUrl ? "loading" : "unavailable",
  runtimeConstitution: null,
  runtimeDrawerOpen: false,
  runtimeDrawerTab: "runtime",
  composerMenu: "",
  composerGeometryObserver: null,
  activeTurnId: "",
  turnPending: false,
  turnStopping: false,
  itemMap: new Map(),
  codexItemMap: new Map(),
  thoughtItemMap: new Map(),
  thoughtTurnByItemId: new Map(),
  pendingThoughtRenderMap: new Map(),
  finalMessageByTurnKey: new Map(),
  turnActivityMap: new Map(),
  turnPromptMap: new Map(),
  turnRetryCountMap: new Map(),
  emptyTurnRetrying: new Set(),
  serverRequests: new Map(),
  connected: false,
  readyForThreadOpen: false,
  pendingOpenThreadEvent: null,
  liveAttached: false,
  sourceHome: "",
  sessionFilePath: "",
  openRequestId: 0,
  historyKind: "",
  historyKey: "",
  historyData: null,
  loadedUserMessagePages: 1,
  historyWindow: {
    logicalThreadKey: "",
    mode: "tail",
    loadedUserMessagePages: 1,
    renderRevision: 0,
  },
  isBulkRendering: false,
  removeBridgeListener: null,
};

function capabilityArea(area) {
  return connection?.capabilities?.[area] || {};
}

function hasCapability(area, name) {
  const capabilities = capabilityArea(area);
  if (!Object.keys(capabilities).length) return true;
  return capabilities[name] !== false;
}

function hasCapabilityForMutation(area, name) {
  return capabilityArea(area)[name] === true;
}

function hasScopedRuntimeCapability(area, scopedName, legacyArea, legacyName) {
  const scoped = capabilityArea(area);
  if (Object.hasOwn(scoped, scopedName)) return scoped[scopedName] === true;
  return hasCapabilityForMutation(legacyArea, legacyName);
}

async function reportThreadState(status, details = {}) {
  if (!bridge?.reportThreadState) return;
  try {
    await bridge.reportThreadState({
      projectId: project?.id || payload.codexConnection?.projectId || "",
      threadId: String(details.threadId || state.threadId || ""),
      sourceHome: String(details.sourceHome ?? state.sourceHome ?? ""),
      sessionFilePath: String(details.sessionFilePath ?? state.sessionFilePath ?? ""),
      title: String(details.title || state.threadTitle || ""),
      status,
      activationEpoch: Number(payload.activationEpoch) || 0,
      evidence: String(details.evidence || ""),
      errorDescription: String(details.errorDescription || ""),
    });
  } catch {
    // Thread-state reporting must never block transcript rendering.
  }
}

const els = {
  projectName: document.getElementById("projectName"),
  repoPath: document.getElementById("repoPath"),
  connectionBadge: document.getElementById("connectionBadge"),
  accountBadge: document.getElementById("accountBadge"),
  modelBadge: document.getElementById("modelBadge"),
  reasoningBadge: document.getElementById("reasoningBadge"),
  accessBadge: document.getElementById("accessBadge"),
  usageBadge: document.getElementById("usageBadge"),
  runtimeDrawerButton: document.getElementById("runtimeDrawerButton"),
  environmentChipCluster: document.getElementById("environmentChipCluster"),
  controlChipCluster: document.getElementById("controlChipCluster"),
  runtimeDrawer: document.getElementById("runtimeDrawer"),
  runtimeDrawerTitle: document.getElementById("runtimeDrawerTitle"),
  runtimeDrawerUpdated: document.getElementById("runtimeDrawerUpdated"),
  runtimeDrawerClose: document.getElementById("runtimeDrawerClose"),
  runtimeDrawerTabs: document.getElementById("runtimeDrawerTabs"),
  runtimeDrawerBody: document.getElementById("runtimeDrawerBody"),
  transcript: document.getElementById("transcript"),
  composerForm: document.getElementById("composerForm"),
  composerInput: document.getElementById("composerInput"),
  sendButton: document.getElementById("sendButton"),
  composerAccessButton: document.getElementById("composerAccessButton"),
  composerAccessMenu: document.getElementById("composerAccessMenu"),
  composerModelButton: document.getElementById("composerModelButton"),
  composerModelMenu: document.getElementById("composerModelMenu"),
  composerQuotaChip: document.getElementById("composerQuotaChip"),
  composerContextChip: document.getElementById("composerContextChip"),
};

function workspaceText() {
  if (!project) return "No project bound";
  if (project.workspace?.kind === "wsl") return `WSL ${project.workspace.distro || "default"}:${project.workspace.linuxPath}`;
  return `Local ${project.workspace?.localPath || project.repoPath}`;
}

function updateSurfaceHeader(title = "", detail = "") {
  const cleanTitle = String(title || "").trim();
  state.threadTitle = cleanTitle || state.threadTitle || "";
  els.projectName.textContent = state.threadTitle || project?.name || "Codex session";
  els.projectName.title = state.threadTitle || project?.name || "";
  els.repoPath.textContent = detail || workspaceText();
  els.repoPath.title = detail || workspaceText();
  renderRuntimeConstitution();
}

function setBadge(element, text, className = "") {
  if (!element) return;
  const baseClass = element.classList.contains("runtime-chip") ? "runtime-chip" : "badge";
  element.textContent = text;
  element.className = `${baseClass}${className ? ` ${className}` : ""}`;
}

function setNotice() {}

function setComposerEnabled(enabled, placeholder = "") {
  const nextEnabled = Boolean(enabled);
  els.composerInput.disabled = !nextEnabled;
  els.sendButton.disabled = !nextEnabled && !turnIsActive();
  if (nextEnabled) {
    els.composerInput.placeholder = "Ask Codex to inspect, change, or explain the project…";
  } else if (placeholder) {
    els.composerInput.placeholder = placeholder;
  }
  renderComposerRuntimeBand();
}

function compactValue(value, maxLength = 240) {
  if (value == null) return "";
  if (typeof value === "string") return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
  try {
    const json = JSON.stringify(value);
    return json.length > maxLength ? `${json.slice(0, maxLength)}…` : json;
  } catch {
    return String(value).slice(0, maxLength);
  }
}

const RUNTIME_DRAWER_TABS = [
  ["runtime", "Runtime"],
  ["model", "Model"],
  ["access", "Access"],
  ["usage", "Usage"],
  ["capabilities", "Capabilities"],
  ["environment", "Environment"],
  ["advanced", "Advanced"],
];

function nowIso() {
  return new Date().toISOString();
}

function evidenceRef(kind, label, options = {}) {
  return {
    id: `${kind}_${Math.random().toString(16).slice(2, 10)}`,
    kind,
    label: String(label || kind),
    observedAt: options.observedAt || nowIso(),
    status: options.status || "fresh",
    confidence: options.confidence || "observed",
  };
}

function firstEvidence(refs) {
  return Array.isArray(refs) && refs.length ? refs[0] : null;
}

function workspaceRootText() {
  return connection?.workspaceRoot || project?.workspace?.linuxPath || project?.workspace?.localPath || project?.repoPath || "";
}

function basenameFromPath(value) {
  const text = String(value || "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (!text) return "";
  return text.split("/").filter(Boolean).pop() || text;
}

function connectionLabel() {
  if (!connection?.wsUrl) return "offline";
  const provider = providerProfile();
  const providerSuffix = provider?.flavor ? ` · ${provider.flavor}` : "";
  if (state.connectionStatus === "connected") return `${connection?.runtime || "connected"}${providerSuffix}`;
  if (state.connectionStatus === "connecting") return "connecting";
  if (state.connectionStatus === "error") return "error";
  if (state.connectionStatus === "disconnected") return "offline";
  return `${connection?.runtime || "configured"}${providerSuffix}`;
}

function providerProfile() {
  return connection?.capabilities?.provider || connection?.provider || {
    kind: project?.codex?.provider?.kind || project?.codex?.providerKind || "codex_executable",
    flavor: project?.codex?.provider?.flavor || project?.codex?.providerFlavor || "vanilla",
    label: "Codex executable · vanilla",
    status: connection?.wsUrl ? "configured" : "unknown",
    capabilitySource: "project_config",
  };
}

function providerSettingsProjection() {
  return providerProfile()?.settingsProjection || {};
}

function settingScopeEnabled(scope) {
  return Boolean(scope?.nextTurn || scope?.sessionDefault || scope?.projectDefault || scope?.liveThread);
}

function runtimeStateStatusFromConnection(value) {
  if (value === "connected") return "ready";
  if (value === "connecting") return "loading";
  if (value === "error") return "failed";
  if (value === "disconnected" || value === "unavailable") return "unavailable";
  return value || "unknown";
}

function activeModelId() {
  return state.runtimeOverrides.model || state.activeModel || project?.codex?.model || defaultModelId();
}

function modelLabel() {
  const id = activeModelId();
  const model = modelById(id);
  return model?.displayName || model?.model || id || "default model";
}

function selectedModel() {
  return modelById(activeModelId());
}

function defaultModelId() {
  const defaultModel = state.models.find((model) => model?.isDefault) || null;
  return defaultModel?.model || defaultModel?.id || "";
}

function modelById(value) {
  const id = String(value || "").trim();
  if (!id) return null;
  return state.models.find((model) => model?.id === id || model?.model === id) || null;
}

function supportedReasoningOptions() {
  const model = selectedModel();
  const options = Array.isArray(model?.supportedReasoningEfforts)
    ? model.supportedReasoningEfforts
      .map((item) => String(item?.reasoningEffort || item?.reasoning_effort || "").trim())
      .filter(Boolean)
    : [];
  return options.length ? options : DEFAULT_REASONING_EFFORTS;
}

function reasoningLabel() {
  return state.runtimeOverrides.reasoningEffort || project?.codex?.reasoningEffort || selectedModel()?.defaultReasoningEffort || "unknown";
}

function requestedReasoningEffort() {
  return state.runtimeOverrides.reasoningEffort || project?.codex?.reasoningEffort || null;
}

function approvalPolicyLabel() {
  return state.runtimeOverrides.approvalPolicy || "runtime default";
}

function sandboxModeLabel() {
  return state.runtimeOverrides.sandboxMode || "runtime default";
}

function serviceTierLabel() {
  return state.runtimeOverrides.serviceTier || "runtime default";
}

function defaultReasoningEffort() {
  return selectedModel()?.defaultReasoningEffort || "";
}

function clearedModelId() {
  return state.activeModel || project?.codex?.model || defaultModelId();
}

function clearedReasoningEffort() {
  return project?.codex?.reasoningEffort || defaultReasoningEffort();
}

function defaultServiceTier() {
  const settingsProjection = providerSettingsProjection();
  return String(
    settingsProjection.serviceTier?.defaultTier ||
    settingsProjection.serviceTier?.defaultServiceTier ||
    settingsProjection.serviceTier?.defaultValue ||
    settingsProjection.speed?.defaultTier ||
    settingsProjection.speed?.defaultServiceTier ||
    settingsProjection.speed?.defaultValue ||
    "",
  ).trim();
}

function defaultOptionLabel(value, fallback = "Runtime default") {
  const text = String(value || "").trim();
  return text ? `${text} · default` : fallback;
}

function camelOrSnake(value, camelKey, snakeKey) {
  if (!value || typeof value !== "object") return undefined;
  return value[camelKey] ?? value[snakeKey];
}

function configRequirementsObject() {
  return state.configRequirements?.requirements || state.configRequirements || null;
}

function normalizeRequirementList(values) {
  if (!Array.isArray(values)) return null;
  return values
    .map((value) => {
      if (typeof value === "string") return value.trim();
      if (value && typeof value === "object") return String(value.type || value.value || value.name || "").trim();
      return "";
    })
    .filter(Boolean);
}

function allowedApprovalPoliciesFromRequirements() {
  const requirements = configRequirementsObject();
  return normalizeRequirementList(camelOrSnake(requirements, "allowedApprovalPolicies", "allowed_approval_policies"));
}

function allowedSandboxModesFromRequirements() {
  const requirements = configRequirementsObject();
  return normalizeRequirementList(camelOrSnake(requirements, "allowedSandboxModes", "allowed_sandbox_modes"));
}

function accessRequirementsRows() {
  const requirements = configRequirementsObject();
  const allowedApprovals = allowedApprovalPoliciesFromRequirements();
  const allowedSandbox = allowedSandboxModesFromRequirements();
  return [
    ["requirements status", state.configRequirementsStatus || "unknown"],
    ["requirements source", requirements ? "configRequirements/read" : "none"],
    ["allowed approvals", allowedApprovals ? allowedApprovals.join(", ") || "none" : "unrestricted"],
    ["allowed sandbox", allowedSandbox ? allowedSandbox.join(", ") || "none" : "unrestricted"],
    ...(state.configRequirementsError ? [["requirements error", state.configRequirementsError]] : []),
  ];
}

function accessChipLabel() {
  if (state.runtimeOverrides.approvalPolicy || state.runtimeOverrides.sandboxMode) {
    return `access: ${approvalPolicyLabel()} · ${sandboxModeLabel()}`;
  }
  const authority = capabilityArea("authority");
  const requestHandlingKnown = Boolean(authority.commandApproval || authority.fileChangeApproval || authority.permissionsApproval);
  return requestHandlingKnown ? "access: requests gated" : "access: policy unknown";
}

function sandboxPolicyForMode(mode) {
  if (mode === "read-only") return { type: "readOnly" };
  if (mode === "workspace-write") return { type: "workspaceWrite" };
  if (mode === "danger-full-access") return { type: "dangerFullAccess" };
  return null;
}

function rateLimitWindowLabel(window, fallbackLabel = "window") {
  if (!window || typeof window !== "object") return "";
  const duration = Number(window.windowDurationMins || 0);
  if (duration === 300) return "5h";
  if (duration === 10080) return "weekly";
  if (duration > 0 && duration < 60) return `${duration}m`;
  if (duration > 0 && duration % 1440 === 0) return `${duration / 1440}d`;
  if (duration > 0 && duration % 60 === 0) return `${duration / 60}h`;
  return fallbackLabel;
}

function rateLimitAvailablePercent(window) {
  if (!window || typeof window !== "object") return null;
  const used = Number(window.usedPercent ?? window.used_percent);
  if (!Number.isFinite(used)) return null;
  return Math.max(0, Math.min(100, 100 - Math.round(used)));
}

function resetTimestampMs(window) {
  const raw = Number(window?.resetsAt ?? window?.resets_at ?? window?.resetAt ?? window?.reset_at ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw > 1_000_000_000_000 ? raw : raw * 1000;
}

function resetLabel(window, compact = false) {
  const timestamp = resetTimestampMs(window);
  if (!timestamp) return compact ? "--:--" : "unknown";
  const date = new Date(timestamp);
  const label = rateLimitWindowLabel(window, "");
  const options = label === "weekly"
    ? { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }
    : { hour: "2-digit", minute: "2-digit", hour12: false };
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

function formatResetTime(window) {
  return resetLabel(window, false);
}

function quotaWindowShortLabel(window, fallbackLabel = "window") {
  const label = rateLimitWindowLabel(window, fallbackLabel);
  if (label === "weekly") return "W";
  return label;
}

function quotaWindowPriority(label) {
  if (label === "5h") return 1;
  if (label === "W") return 2;
  return 10;
}

function quotaWindows(snapshot) {
  return [snapshot?.primary, snapshot?.secondary].filter(Boolean).map((window, index) => ({
    window,
    label: quotaWindowShortLabel(window, index === 0 ? "primary" : "secondary"),
    available: rateLimitAvailablePercent(window),
    reset: resetLabel(window, true),
  })).filter((entry) => entry.available != null);
}

function quotaEvidenceStale() {
  if (!state.rateLimitsObservedAt) return false;
  return Date.now() - state.rateLimitsObservedAt > RATE_LIMIT_STALE_MS;
}

function selectRateLimitSnapshot() {
  const response = state.rateLimits || {};
  const buckets = response.rateLimitsByLimitId || response.rate_limits_by_limit_id || {};
  return buckets.codex || buckets.default || response.rateLimits || response.rate_limits || null;
}

function formatQuotaHeader() {
  const snapshot = selectRateLimitSnapshot();
  if (!snapshot) return "quota: not exposed";
  const parts = quotaWindows(snapshot).map((entry) => `${entry.label} ${entry.available}%`);
  return parts.length ? `quota left: ${parts.join(" · ")}` : "quota: available";
}

function composerQuotaLabel() {
  const snapshot = selectRateLimitSnapshot();
  if (!snapshot) return state.rateLimitsStatus === "failed" ? "quota unavailable" : "quota unknown";
  const windows = quotaWindows(snapshot).sort((a, b) =>
    quotaWindowPriority(a.label) - quotaWindowPriority(b.label) || a.available - b.available);
  if (!windows.length) return quotaEvidenceStale() ? "quota stale" : "quota available";
  const visible = windows.slice(0, 2).map((entry) => `${entry.label} ${entry.available}% ${entry.reset}`);
  const label = visible.join(" / ");
  return quotaEvidenceStale() ? `${label} · stale` : label;
}

function numericField(source, ...keys) {
  for (const key of keys) {
    const value = Number(source?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function formatCompactTokens(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return "";
  if (amount === 0) return "0";
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(amount >= 10_000_000 ? 0 : 1)}M`;
  if (amount >= 1000) return `${(amount / 1000).toFixed(amount >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(amount));
}

function normalizeTokenUsageBreakdown(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  return {
    totalTokens: numericField(value, "totalTokens", "total_tokens") ?? 0,
    inputTokens: numericField(value, "inputTokens", "input_tokens") ?? 0,
    cachedInputTokens: numericField(value, "cachedInputTokens", "cached_input_tokens") ?? 0,
    outputTokens: numericField(value, "outputTokens", "output_tokens") ?? 0,
    reasoningOutputTokens: numericField(value, "reasoningOutputTokens", "reasoning_output_tokens") ?? 0,
  };
}

function normalizeThreadTokenUsageUpdate(params) {
  const raw = params?.tokenUsage || params?.token_usage || params || {};
  return {
    threadId: String(params?.threadId || params?.thread_id || ""),
    turnId: String(params?.turnId || params?.turn_id || ""),
    total: normalizeTokenUsageBreakdown(raw.total || raw.total_token_usage),
    last: normalizeTokenUsageBreakdown(raw.last || raw.last_token_usage),
    modelContextWindow: numericField(raw, "modelContextWindow", "model_context_window"),
  };
}

function remainingContextPercent(tokensInWindow, contextWindow) {
  const window = Number(contextWindow);
  const tokens = Number(tokensInWindow);
  if (!Number.isFinite(window) || !Number.isFinite(tokens) || window <= CONTEXT_BASELINE_TOKENS) return null;
  const effectiveWindow = window - CONTEXT_BASELINE_TOKENS;
  const used = Math.max(0, tokens - CONTEXT_BASELINE_TOKENS);
  const remaining = Math.max(0, effectiveWindow - used);
  return Math.round(Math.max(0, Math.min(100, (remaining / effectiveWindow) * 100)));
}

function contextUsageProjection() {
  const usage = state.tokenUsage;
  if (!usage) {
    const status = state.tokenUsageStatus === "failed" ? "failed" : "not_exposed";
    return {
      label: status === "failed" ? "context unavailable" : "context: not exposed",
      compactLabel: status === "failed" ? "context unavailable" : "context unknown",
      status,
      evidenceRefs: [evidenceRef("app_server_probe", "No thread/tokenUsage/updated event has been observed for this Codex thread", {
        status: "unavailable",
        confidence: "unknown",
      })],
    };
  }

  const window = Number(usage.modelContextWindow || 0);
  const lastTokens = Number(usage.last?.totalTokens || 0);
  const totalTokens = Number(usage.total?.totalTokens || 0);
  const remaining = remainingContextPercent(lastTokens, window);
  const usedPercent = remaining == null ? null : Math.max(0, Math.min(100, 100 - remaining));
  const tokenLabel = formatCompactTokens(remaining == null ? totalTokens : lastTokens);
  const windowLabel = formatCompactTokens(window);
  const compactLabel = usedPercent == null
    ? tokenLabel ? `context ${tokenLabel}` : "context available"
    : `context ${usedPercent}%`;
  const detail = usedPercent == null
    ? tokenLabel ? `context: ${tokenLabel} tokens used` : "context: available"
    : `context: ${usedPercent}% used`;
  const label = windowLabel ? `${detail} · ${tokenLabel || "0"} / ${windowLabel} window` : detail;
  return {
    label,
    compactLabel,
    status: "available",
    percentUsed: usedPercent,
    percentRemaining: remaining,
    tokensInContext: remaining == null ? totalTokens : lastTokens,
    totalTokens,
    modelContextWindow: window || null,
    observedAt: state.tokenUsageObservedAt ? new Date(state.tokenUsageObservedAt).toISOString() : "",
    tokenUsage: usage,
    evidenceRefs: [evidenceRef("app_server_probe", "thread/tokenUsage/updated provided token usage and model context window", {
      confidence: "proven",
    })],
  };
}

function applyThreadTokenUsageUpdate(params) {
  const usage = normalizeThreadTokenUsageUpdate(params);
  if (usage.threadId && state.threadId && String(usage.threadId) !== String(state.threadId)) return false;
  state.tokenUsage = usage;
  state.tokenUsageStatus = "ready";
  state.tokenUsageObservedAt = Date.now();
  renderRuntimeConstitution();
  return true;
}

function turnIsActive() {
  if (state.turnPending || state.turnStopping) return true;
  const activeId = String(state.activeTurnId || state.turnId || "");
  if (!activeId) return false;
  const activity = state.turnActivityMap.get(activeId);
  return Boolean(activity && !activity.completedAt && ["inProgress", "running", "pending", "started", "interrupting"].includes(String(activity.status || "").trim()));
}

function countCodexItems(typeSet) {
  let count = 0;
  const seen = new Set();
  for (const item of state.codexItemMap.values()) {
    const id = String(item?.id || "");
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    if (typeSet.has(item?.type)) count += 1;
  }
  return count;
}

function sessionDurationMs() {
  let first = 0;
  let last = 0;
  for (const activity of state.turnActivityMap.values()) {
    const started = Number(activity?.startedAt || 0) * 1000;
    const completed = Number(activity?.completedAt || 0) * 1000;
    if (started && (!first || started < first)) first = started;
    if (completed && completed > last) last = completed;
    else if (started && started > last) last = started;
  }
  return first && last && last >= first ? Math.round(last - first) : 0;
}

function buildRuntimeConstitution() {
  const generatedAt = nowIso();
  const rawCapabilities = connection?.capabilities || {};
  const capabilityEvidence = evidenceRef(
    rawCapabilities.provider ? "app_server_probe" : "runtime_snapshot",
    rawCapabilities.provider ? "App-server capability profile includes runtime provider projection" : "Runtime capability projection unavailable or legacy",
    { confidence: rawCapabilities.provider ? "declared" : "unknown", status: rawCapabilities.provider ? "fresh" : "unavailable" },
  );
  const connectionEvidence = evidenceRef(
    connection?.wsUrl ? "runtime_snapshot" : "project_config",
    connection?.wsUrl ? "Codex app-server connection payload" : "No managed app-server connection payload",
    { confidence: connection?.wsUrl ? "declared" : "configured" },
  );
  const threadEvidence = evidenceRef(
    state.liveAttached ? "app_server_probe" : state.threadId ? "renderer_observation" : "project_config",
    state.liveAttached ? "Codex surface live-attached the thread" : state.threadId ? "Codex surface rendered or requested the thread" : "No active thread evidence yet",
    { confidence: state.liveAttached ? "proven" : state.threadId ? "observed" : "unknown" },
  );
  const account = state.accountState || {
    label: "account unknown",
    status: "unknown",
    truth: "unknown",
    evidenceRefs: [evidenceRef("account_read", "Account has not been read yet", { status: "unavailable", confidence: "unknown" })],
  };
  const settingsProjection = providerSettingsProjection();
  const canOverrideModel = settingsProjection.model?.scopes?.nextTurn === true ||
    hasScopedRuntimeCapability("model", "canSetNextTurn", "turns", "canOverrideModel");
  const canOverrideReasoning = settingsProjection.reasoning?.scopes?.nextTurn === true ||
    hasScopedRuntimeCapability("reasoning", "canSetNextTurn", "turns", "canOverrideReasoning");
  const authority = capabilityArea("authority");
  const canSetApprovalPolicy = settingScopeEnabled(settingsProjection.access?.scopes?.approvalPolicy) ||
    authority.canSetNextTurnApprovalPolicy === true ||
    settingsProjection.access?.scopes?.nextTurnApprovalPolicy === true;
  const canSetSandbox = settingScopeEnabled(settingsProjection.access?.scopes?.sandbox) ||
    authority.canSetNextTurnSandbox === true ||
    settingsProjection.access?.scopes?.nextTurnSandbox === true;
  const canSetAccess = canSetApprovalPolicy || canSetSandbox;
  const requestHandlingKnown = Boolean(authority.commandApproval || authority.fileChangeApproval || authority.permissionsApproval);
  const accessLabel = accessChipLabel();
  const allowedApprovalPolicies = allowedApprovalPoliciesFromRequirements();
  const allowedSandboxModes = allowedSandboxModesFromRequirements();
  const requirementsEvidence = evidenceRef(
    "app_server_probe",
    state.configRequirementsStatus === "ready"
      ? "configRequirements/read returned managed requirements."
      : state.configRequirementsStatus === "none"
        ? "configRequirements/read returned no managed requirements."
        : state.configRequirementsStatus === "failed"
          ? `configRequirements/read failed: ${state.configRequirementsError}`
          : "Config requirements have not been read yet.",
    {
      confidence: state.configRequirementsStatus === "ready" || state.configRequirementsStatus === "none" ? "declared" : "unknown",
      status: state.configRequirementsStatus === "failed" ? "failed" : state.configRequirementsStatus === "idle" ? "unavailable" : "fresh",
    },
  );
  const cwd = workspaceRootText() || workspaceText();
  const repoName = basenameFromPath(cwd);
  const workspaceStatus = state.workspaceStatus || payload.workspaceStatus || {};
  const hygiene = workspaceStatus?.hygiene || {};
  const sandboxPlaceholderIgnored = Boolean(
    hygiene.available && (hygiene.changed || hygiene.reason === "already-ignored" || hygiene.pattern),
  );
  const commandCount = countCodexItems(new Set(["commandExecution"]));
  const toolCallCount = countCodexItems(new Set(["mcpToolCall", "dynamicToolCall", "webSearch", "imageGeneration", "collabAgentToolCall"]));
  const approvalCount = Array.from(state.serverRequests.values()).filter((request) => String(request?.riskCategory || "") !== "unknown").length;
  const turnCount = state.turnActivityMap.size;
  const rateLimitSnapshot = selectRateLimitSnapshot();
  const providerQuota = rateLimitSnapshot ? {
    canRead: settingsProjection.usage?.providerQuota?.canRead === true || settingsProjection.usage?.canReadRateLimits === true,
    readMethod: settingsProjection.usage?.providerQuota?.readSource || settingsProjection.usage?.rateLimitMethod || "account/rateLimits/read",
    eventName: settingsProjection.usage?.providerQuota?.eventSource || "account/rateLimits/updated",
    label: formatQuotaHeader(),
    status: "available",
    snapshot: rateLimitSnapshot,
    response: state.rateLimits,
    evidenceRefs: [evidenceRef("provider_quota", "account/rateLimits/read returned provider quota windows", { confidence: "proven" })],
  } : {
    canRead: settingsProjection.usage?.providerQuota?.canRead === true || settingsProjection.usage?.canReadRateLimits === true,
    readMethod: settingsProjection.usage?.providerQuota?.readSource || settingsProjection.usage?.rateLimitMethod || "",
    eventName: settingsProjection.usage?.providerQuota?.eventSource || (settingsProjection.usage?.canReadRateLimits === true ? "account/rateLimits/updated" : ""),
    label: state.rateLimitsStatus === "failed" ? "quota: unavailable" : "quota: not exposed",
    status: state.rateLimitsStatus === "failed" ? "failed" : "not_exposed",
    error: state.rateLimitsError,
    evidenceRefs: [evidenceRef("provider_quota", state.rateLimitsError || "OpenAI account quota percentage is not exposed to this surface yet", { status: "unavailable", confidence: "unknown" })],
  };
  const projectedContextUsage = contextUsageProjection();
  const contextPressure = {
    canRead: settingsProjection.usage?.contextPressure?.canRead === true ||
      hasCapabilityForMutation("usage", "canReadContextUsage"),
    eventName: settingsProjection.usage?.contextPressure?.eventSource ||
      settingsProjection.usage?.contextPressure?.source ||
      capabilityArea("usage").contextUsageEvent ||
      "thread/tokenUsage/updated",
    ...projectedContextUsage,
  };
  const usageLabel = providerQuota.status === "available"
    ? providerQuota.label
    : contextPressure.status === "available"
      ? contextPressure.label
      : turnCount || commandCount || approvalCount || toolCallCount
      ? `activity: ${turnCount} turn${turnCount === 1 ? "" : "s"}`
      : "usage: unknown";

  const constitution = {
    thread: {
      threadId: state.threadId,
      title: state.threadTitle || project?.name || "Codex session",
      source: state.liveAttached ? "attached_live" : state.threadId ? "rendered_stored" : "unknown",
      status: state.liveAttached ? "attached_live" : state.threadId ? "rendered_stored" : "unknown",
      evidenceRefs: [threadEvidence],
      updatedAt: generatedAt,
    },
    runtime: {
      kind: connection?.runtime || (connection?.wsUrl ? "remote" : "offline"),
      label: connectionLabel(),
      truth: connection?.wsUrl ? "runtime_declared" : "unknown",
      status: state.connectionStatus === "connected" ? "ready" : state.connectionStatus || "unavailable",
      evidenceRefs: [connectionEvidence],
    },
    provider: {
      ...providerProfile(),
      evidenceRefs: [
        evidenceRef("runtime_snapshot", providerProfile()?.evidence?.reason || "Runtime provider profile", {
          confidence: providerProfile()?.evidence?.confidence || "declared",
        }),
      ],
    },
    account,
    model: {
      label: modelLabel(),
      source: state.runtimeOverrides.model ? "operator_requested" : state.activeModel ? "runtime_reported" : project?.codex?.model ? "project_config" : defaultModelId() ? "runtime_default" : "unknown",
      selection: {
        canList: settingsProjection.model?.canList === true && state.modelListStatus === "ready",
        canSetNextTurn: canOverrideModel,
        canSetSessionDefault: false,
        canSetProjectDefault: false,
        canLiveUpdate: false,
        enabledScopes: canOverrideModel ? ["next_turn"] : [],
        unsupportedReason: canOverrideModel ? "" : "Provider profile does not expose next-turn model override.",
      },
      models: state.models,
      selectedId: activeModelId(),
      truth: state.runtimeOverrides.model ? "operator_requested" : state.activeModel ? "runtime_declared" : project?.codex?.model ? "project_configured" : defaultModelId() ? "runtime_declared" : "unknown",
      evidenceRefs: [
        evidenceRef(state.runtimeOverrides.model ? "operator_action" : state.activeModel || defaultModelId() ? "app_server_probe" : "project_config", state.runtimeOverrides.model ? "Operator selected model for subsequent turns" : state.activeModel ? "Thread/model response" : defaultModelId() ? "model/list default model" : "Project model setting", {
          confidence: state.runtimeOverrides.model ? "configured" : state.activeModel || defaultModelId() ? "declared" : project?.codex?.model ? "configured" : "unknown",
        }),
      ],
    },
    reasoning: {
      label: `reasoning: ${reasoningLabel()}`,
      selected: reasoningLabel(),
      supported: supportedReasoningOptions(),
      selection: {
        canSetNextTurn: canOverrideReasoning,
        canSetSessionDefault: false,
        canSetProjectDefault: false,
        canLiveUpdate: false,
        enabledScopes: canOverrideReasoning ? ["next_turn"] : [],
        unsupportedReason: canOverrideReasoning ? "" : "Provider profile does not expose next-turn reasoning override.",
      },
      truth: state.runtimeOverrides.reasoningEffort ? "operator_requested" : project?.codex?.reasoningEffort ? "project_configured" : selectedModel()?.defaultReasoningEffort ? "runtime_declared" : "unknown",
      evidenceRefs: [
        evidenceRef(state.runtimeOverrides.reasoningEffort ? "operator_action" : "project_config", state.runtimeOverrides.reasoningEffort ? "Operator selected reasoning effort for subsequent turns" : project?.codex?.reasoningEffort ? "Project reasoning effort setting" : "Model default reasoning effort", {
          confidence: state.runtimeOverrides.reasoningEffort || project?.codex?.reasoningEffort ? "configured" : selectedModel()?.defaultReasoningEffort ? "declared" : "unknown",
        }),
      ],
    },
    access: {
      label: accessLabel,
      posture: state.runtimeOverrides.sandboxMode === "danger-full-access"
        ? "danger_full_access"
        : state.runtimeOverrides.sandboxMode
          ? "restricted"
          : state.runtimeOverrides.approvalPolicy
            ? "approval"
            : requestHandlingKnown
              ? "requests_gated"
              : "policy_unknown",
      approvalPolicy: state.runtimeOverrides.approvalPolicy || "",
      sandboxMode: state.runtimeOverrides.sandboxMode || "",
      policyKnown: Boolean(state.runtimeOverrides.approvalPolicy || state.runtimeOverrides.sandboxMode),
      requestHandlingKnown,
      requirementsStatus: state.configRequirementsStatus,
      allowedApprovalPolicies,
      allowedSandboxModes,
      mutableScopes: canSetAccess ? ["next_turn"] : [],
      unsupportedReason: canSetAccess ? "" : "Provider profile does not expose next-turn access overrides.",
      truth: state.runtimeOverrides.approvalPolicy || state.runtimeOverrides.sandboxMode ? "operator_requested" : requestHandlingKnown ? "runtime_declared" : "unknown",
      evidenceRefs: [
        evidenceRef(state.runtimeOverrides.approvalPolicy || state.runtimeOverrides.sandboxMode ? "operator_action" : "runtime_snapshot", state.runtimeOverrides.approvalPolicy || state.runtimeOverrides.sandboxMode ? "Operator selected access override for subsequent turns" : requestHandlingKnown ? "Shell handles Codex approval request methods" : "Sandbox/access policy not exposed", {
          confidence: state.runtimeOverrides.approvalPolicy || state.runtimeOverrides.sandboxMode ? "configured" : requestHandlingKnown ? "declared" : "unknown",
          status: requestHandlingKnown ? "fresh" : "unavailable",
        }),
        requirementsEvidence,
      ],
    },
    usage: {
      label: usageLabel,
      status: providerQuota.status === "available" || contextPressure.status === "available" || turnCount || commandCount || approvalCount || toolCallCount ? "available" : "unknown",
      providerQuota,
      contextPressure,
      activity: {
        turnCount,
        commandCount,
        approvalCount,
        toolCallCount,
        sessionDurationMs: sessionDurationMs(),
        evidenceRefs: [evidenceRef("renderer_observation", "Renderer-observed thread activity", { confidence: "observed" })],
      },
    },
    environment: {
      cwd,
      repo: repoName,
      workspaceStatus: workspaceStatus.status || "unknown",
      hygiene: {
        codexSandboxPlaceholderIgnored: sandboxPlaceholderIgnored,
        reason: hygiene.reason || "",
        pattern: hygiene.pattern || "",
      },
      evidenceRefs: [
        evidenceRef("project_config", "Workspace/project path configuration", { confidence: "configured" }),
        ...(workspaceStatus.status
          ? [evidenceRef("workspace_backend", `Workspace backend status: ${workspaceStatus.status}`, { confidence: "observed" })]
          : []),
      ],
    },
    capabilities: {
      profile: rawCapabilities,
      status: rawCapabilities.status === "ready" ? "ready" : runtimeStateStatusFromConnection(state.connectionStatus),
      schemaSource: rawCapabilities.provider?.capabilitySources?.find?.((source) => source.enablesMutation)?.source ||
        rawCapabilities.provider?.capabilitySource ||
        rawCapabilities.coreRuntime?.schemaSource ||
        rawCapabilities.diagnostics?.source ||
        "unknown",
      evidenceRefs: [capabilityEvidence],
      unsupported: [],
    },
    settingsProjection,
    schemaVersion: 1,
    sourceRevision: `${payload.shell?.generatedAt || "unknown"}:${rawCapabilities.generatedAt || "unknown"}`,
    projectId: project?.id || "",
    planeId: "codex",
    updatedAt: generatedAt,
  };

  constitution.chips = runtimeHeaderChips(constitution);
  return constitution;
}

function runtimeHeaderChips(constitution) {
  return [
    {
      id: "runtime",
      label: constitution.runtime.label,
      tab: "runtime",
      role: "read_only_witness",
      truth: constitution.runtime.truth,
      status: constitution.runtime.status,
      evidenceRefs: constitution.runtime.evidenceRefs,
    },
    {
      id: "account",
      label: constitution.account.label,
      tab: "runtime",
      role: "read_only_witness",
      truth: constitution.account.truth,
      status: constitution.account.status === "ready" ? "ready" : constitution.account.status,
      evidenceRefs: constitution.account.evidenceRefs,
    },
    {
      id: "model",
      label: constitution.model.label,
      tab: "model",
      role: constitution.model.selection.canSetNextTurn ? "mutable_control" : "read_only_witness",
      truth: constitution.model.truth,
      status: constitution.model.truth === "unknown" ? "unavailable" : "ready",
      evidenceRefs: constitution.model.evidenceRefs,
    },
    {
      id: "reasoning",
      label: constitution.reasoning.label,
      tab: "model",
      role: constitution.reasoning.selection.canSetNextTurn ? "mutable_control" : "diagnostic",
      truth: constitution.reasoning.truth,
      status: constitution.reasoning.truth === "unknown" ? "unavailable" : "ready",
      evidenceRefs: constitution.reasoning.evidenceRefs,
    },
    {
      id: "access",
      label: constitution.access.label,
      tab: "access",
      role: constitution.access.mutableScopes.includes("next_turn") ? "mutable_control" : "diagnostic",
      truth: constitution.access.truth,
      status: constitution.access.requestHandlingKnown || constitution.access.policyKnown ? "ready" : "unavailable",
      evidenceRefs: constitution.access.evidenceRefs,
    },
    {
      id: "usage",
      label: constitution.usage.label,
      tab: "usage",
      role: "diagnostic",
      truth: constitution.usage.providerQuota.status === "available" || constitution.usage.contextPressure.status === "available" ? "runtime_proven" : "unknown",
      status: constitution.usage.providerQuota.status === "available" || constitution.usage.contextPressure.status === "available" ? "ready" : constitution.usage.status === "available" ? "warning" : "unavailable",
      evidenceRefs: [
        ...constitution.usage.providerQuota.evidenceRefs,
        ...constitution.usage.contextPressure.evidenceRefs,
        ...constitution.usage.activity.evidenceRefs,
      ],
    },
  ];
}

function chipClass(chip) {
  const roleClass = chip.role === "mutable_control" ? "mutable" : chip.role === "diagnostic" ? "diagnostic" : "witness";
  if (chip.status === "ready") return `${roleClass} ready`;
  if (chip.status === "loading" || chip.status === "stale" || chip.status === "degraded") return `${roleClass} warning`;
  if (chip.status === "failed") return `${roleClass} failed`;
  return `${roleClass} unknown`;
}

function applyChip(element, chip) {
  if (!element || !chip) return;
  element.textContent = chip.label;
  element.className = `runtime-chip ${chipClass(chip)}`;
  element.title = firstEvidence(chip.evidenceRefs)?.label || chip.label;
  element.dataset.runtimeTab = chip.tab;
  element.dataset.runtimeChip = chip.id;
  element.dataset.chipRole = chip.role.replace(/_/g, "-");
}

function renderRuntimeConstitution() {
  if (!project) return;
  const constitution = buildRuntimeConstitution();
  state.runtimeConstitution = constitution;
  const chipById = new Map(constitution.chips.map((chip) => [chip.id, chip]));
  applyChip(els.connectionBadge, chipById.get("runtime"));
  applyChip(els.accountBadge, chipById.get("account"));
  applyChip(els.modelBadge, chipById.get("model"));
  applyChip(els.reasoningBadge, chipById.get("reasoning"));
  applyChip(els.accessBadge, chipById.get("access"));
  applyChip(els.usageBadge, chipById.get("usage"));

  if (els.environmentChipCluster) {
    els.environmentChipCluster.innerHTML = "";
    const repoChip = createRuntimeChip({
      id: "repo",
      label: constitution.environment.repo || "repo unknown",
      tab: "environment",
      role: "read_only_witness",
      truth: constitution.environment.repo ? "project_configured" : "unknown",
      status: constitution.environment.repo ? "ready" : "unavailable",
      evidenceRefs: constitution.environment.evidenceRefs,
    });
    const cwdChip = createRuntimeChip({
      id: "cwd",
      label: `cwd: ${constitution.environment.cwd || "unknown"}`,
      tab: "environment",
      role: "read_only_witness",
      truth: constitution.environment.cwd ? "project_configured" : "unknown",
      status: constitution.environment.cwd ? "ready" : "unavailable",
      evidenceRefs: constitution.environment.evidenceRefs,
    });
    els.environmentChipCluster.append(repoChip, cwdChip);
  }

  if (els.runtimeDrawerButton) {
    els.runtimeDrawerButton.setAttribute("aria-expanded", state.runtimeDrawerOpen ? "true" : "false");
  }
  renderRuntimeDrawer();
  renderComposerRuntimeBand();
}

function createRuntimeChip(chip) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `runtime-chip ${chipClass(chip)}`;
  button.textContent = chip.label;
  button.dataset.runtimeTab = chip.tab;
  button.dataset.runtimeChip = chip.id;
  button.dataset.chipRole = chip.role.replace(/_/g, "-");
  button.title = firstEvidence(chip.evidenceRefs)?.label || chip.label;
  return button;
}

function openRuntimeDrawer(tab = "runtime") {
  dismissComposerOverlay("runtime-drawer-open");
  state.runtimeDrawerOpen = true;
  state.runtimeDrawerTab = RUNTIME_DRAWER_TABS.some(([id]) => id === tab) ? tab : "runtime";
  renderRuntimeConstitution();
}

function closeRuntimeDrawer() {
  state.runtimeDrawerOpen = false;
  renderRuntimeDrawer();
}

function fieldRow(key, value) {
  const row = document.createElement("div");
  row.className = "runtime-field";
  const keyNode = document.createElement("div");
  keyNode.className = "runtime-field-key";
  keyNode.textContent = key;
  const valueNode = document.createElement("div");
  valueNode.className = "runtime-field-value";
  valueNode.textContent = value == null || value === "" ? "—" : String(value);
  row.append(keyNode, valueNode);
  return row;
}

function evidenceBlock(refs = []) {
  const block = document.createElement("div");
  block.className = "runtime-evidence";
  for (const ref of refs.slice(0, 5)) {
    const item = document.createElement("div");
    item.className = "runtime-evidence-item";
    item.textContent = `${ref.kind || "evidence"} · ${ref.confidence || "unknown"} · ${ref.status || "unknown"} · ${ref.label || ""}`;
    block.appendChild(item);
  }
  return block;
}

function drawerSection(title, rows = [], refs = []) {
  const section = document.createElement("section");
  section.className = "runtime-section";
  section.dataset.runtimeDrawerSection = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.appendChild(heading);
  for (const [key, value] of rows) section.appendChild(fieldRow(key, value));
  if (refs.length) section.appendChild(evidenceBlock(refs));
  return section;
}

function renderRuntimeDrawer() {
  if (!els.runtimeDrawer || !els.runtimeDrawerTabs || !els.runtimeDrawerBody) return;
  const constitution = state.runtimeConstitution || buildRuntimeConstitution();
  els.runtimeDrawer.hidden = !state.runtimeDrawerOpen;
  if (!state.runtimeDrawerOpen) return;

  const tabLabel = RUNTIME_DRAWER_TABS.find(([id]) => id === state.runtimeDrawerTab)?.[1] || "Runtime";
  els.runtimeDrawerTitle.textContent = tabLabel;
  els.runtimeDrawerUpdated.textContent = `updated ${new Date(constitution.updatedAt).toLocaleTimeString()}`;
  els.runtimeDrawerTabs.innerHTML = "";
  for (const [id, label] of RUNTIME_DRAWER_TABS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `runtime-tab-button${id === state.runtimeDrawerTab ? " active" : ""}`;
    button.textContent = label;
    button.dataset.runtimeDrawerTab = id;
    button.addEventListener("click", () => {
      state.runtimeDrawerTab = id;
      renderRuntimeDrawer();
    });
    els.runtimeDrawerTabs.appendChild(button);
  }

  els.runtimeDrawerBody.innerHTML = "";
  for (const section of runtimeDrawerSections(constitution, state.runtimeDrawerTab)) {
    els.runtimeDrawerBody.appendChild(section);
  }
}

function unsupportedControlNote(text) {
  const note = document.createElement("div");
  note.className = "runtime-control-placeholder";
  note.textContent = text;
  return note;
}

function selectField(label, value, options, onChange, config = {}) {
  const wrapper = document.createElement("label");
  wrapper.className = "runtime-control";
  const labelNode = document.createElement("span");
  labelNode.className = "runtime-control-label";
  labelNode.textContent = label;
  const select = document.createElement("select");
  select.disabled = Boolean(config.disabled);
  for (const option of options) {
    const raw = typeof option === "object" ? option.value : option;
    const optionLabel = typeof option === "object" ? option.label : option || config.emptyLabel || "Runtime default";
    const node = document.createElement("option");
    node.value = raw;
    node.textContent = optionLabel;
    select.appendChild(node);
  }
  select.value = value || "";
  select.addEventListener("change", () => onChange(select.value));
  wrapper.append(labelNode, select);
  if (config.description) {
    const description = document.createElement("span");
    description.className = "runtime-control-description";
    description.textContent = config.description;
    wrapper.appendChild(description);
  }
  return wrapper;
}

function composerMenuSection(title, options, selectedValue, onSelect) {
  const section = document.createElement("section");
  section.className = "composer-menu-section";
  const heading = document.createElement("h4");
  heading.textContent = title;
  section.appendChild(heading);
  for (const option of options) {
    const value = typeof option === "object" ? option.value : option;
    const label = typeof option === "object" ? option.label : option;
    const selected = String(value || "") === String(selectedValue || "");
    const button = document.createElement("button");
    button.type = "button";
    button.className = `composer-menu-item${selected ? " selected" : ""}`;
    button.dataset.value = String(value || "");
    button.setAttribute("aria-pressed", selected ? "true" : "false");
    button.textContent = label || "Runtime default";
    button.title = `${title}: ${label || "Runtime default"}`;
    button.addEventListener("click", () => {
      const nextValue = String(value || "");
      for (const item of section.querySelectorAll(".composer-menu-item")) {
        const isSelected = item.dataset.value === nextValue;
        item.classList.toggle("selected", isSelected);
        item.setAttribute("aria-pressed", isSelected ? "true" : "false");
      }
      onSelect(nextValue);
    });
    section.appendChild(button);
  }
  return section;
}

function dismissComposerOverlay(reason = "unknown") {
  const hadMenu = Boolean(state.composerMenu);
  state.composerMenu = "";
  if (els.composerAccessMenu) els.composerAccessMenu.hidden = true;
  if (els.composerModelMenu) els.composerModelMenu.hidden = true;
  els.composerAccessButton?.setAttribute("aria-expanded", "false");
  els.composerModelButton?.setAttribute("aria-expanded", "false");
  if (hadMenu) {
    els.composerForm?.dataset && (els.composerForm.dataset.lastComposerDismiss = reason);
  }
  return hadMenu;
}

function closeComposerMenus() {
  dismissComposerOverlay("legacy-close");
}

function toggleComposerMenu(menu) {
  state.composerMenu = state.composerMenu === menu ? "" : menu;
  renderComposerRuntimeBand();
  updateComposerGeometry();
}

function eventPathContains(event, selector) {
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  if (path.length) {
    return path.some((node) => node?.matches?.(selector) || node?.closest?.(selector));
  }
  return Boolean(event.target?.closest?.(selector));
}

function eventTargetsElement(event, element) {
  if (!element) return false;
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  if (path.includes(element)) return true;
  const target = event.target;
  return Boolean(target && element.contains?.(target));
}

function eventInsideComposerOverlay(event) {
  return (
    eventTargetsElement(event, els.composerAccessMenu) ||
    eventTargetsElement(event, els.composerModelMenu) ||
    eventTargetsElement(event, els.composerAccessButton) ||
    eventTargetsElement(event, els.composerModelButton)
  );
}

function maybeDismissComposerOverlay(event, reason) {
  if (!state.composerMenu) return;
  if (eventInsideComposerOverlay(event)) return;
  dismissComposerOverlay(reason);
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function updateComposerGeometry() {
  if (!els.composerForm) return;
  const shellRect = els.composerForm.getBoundingClientRect();
  const panelHeight = Math.max(360, document.documentElement.clientHeight || window.innerHeight || 0);
  const shellWidth = Math.max(0, shellRect.width || window.innerWidth || 0);
  const safeWidth = Math.max(180, shellWidth - 24);
  const menuWidth = Math.round(clampNumber(safeWidth * 0.46, 190, 280));
  const modelMenuWidth = Math.round(clampNumber(safeWidth * 0.86, 340, 620));
  const quotaWidth = Math.round(clampNumber(safeWidth * 0.42, 220, 380));
  const witnessWidth = Math.round(clampNumber(safeWidth * 0.14, 76, 150));
  const modelPillWidth = Math.round(clampNumber(safeWidth * 0.28, 120, 280));
  const activeTrigger = state.composerMenu === "model"
    ? els.composerModelButton
    : state.composerMenu === "access"
      ? els.composerAccessButton
      : null;
  const triggerRect = activeTrigger?.getBoundingClientRect?.();
  const topSpace = triggerRect ? Math.max(140, triggerRect.top - 16) : Math.max(160, window.innerHeight * 0.42);
  const modelMenuHeight = Math.round(clampNumber(Math.min(topSpace, panelHeight * 0.54), 240, 430));
  const maxHeight = state.composerMenu === "model"
    ? modelMenuHeight
    : Math.round(clampNumber(topSpace, 140, 360));
  const menuFont = clampNumber(Math.min(safeWidth / 43, modelMenuHeight / 23), 10.5, 14);
  const menuRow = Math.round(clampNumber(menuFont * 2.05, 22, 30));
  els.composerForm.style.setProperty("--composer-popover-max-width", `${Math.round(safeWidth)}px`);
  els.composerForm.style.setProperty("--composer-menu-width", `${menuWidth}px`);
  els.composerForm.style.setProperty("--composer-model-menu-width", `${modelMenuWidth}px`);
  els.composerForm.style.setProperty("--composer-model-menu-height", `${modelMenuHeight}px`);
  els.composerForm.style.setProperty("--composer-popover-max-height", `${maxHeight}px`);
  els.composerForm.style.setProperty("--composer-menu-font-size", `${menuFont.toFixed(1)}px`);
  els.composerForm.style.setProperty("--composer-menu-row-height", `${menuRow}px`);
  els.composerForm.style.setProperty("--composer-witness-max-width", `${witnessWidth}px`);
  els.composerForm.style.setProperty("--composer-quota-max-width", `${quotaWidth}px`);
  els.composerForm.style.setProperty("--composer-model-pill-max-width", `${modelPillWidth}px`);
  els.composerForm.dataset.composerSize = safeWidth < 390 ? "narrow" : safeWidth < 760 ? "medium" : "wide";
}

function installComposerGeometryObserver() {
  updateComposerGeometry();
  if (typeof ResizeObserver === "function" && els.composerForm && !state.composerGeometryObserver) {
    state.composerGeometryObserver = new ResizeObserver(() => updateComposerGeometry());
    state.composerGeometryObserver.observe(els.composerForm);
    if (els.composerForm.parentElement) state.composerGeometryObserver.observe(els.composerForm.parentElement);
  }
}

function renderComposerAccessMenu() {
  if (!els.composerAccessMenu) return;
  els.composerAccessMenu.innerHTML = "";
  els.composerAccessMenu.appendChild(composerMenuSection("Approval", approvalPolicyOptions(), state.runtimeOverrides.approvalPolicy, (value) => setRuntimeOverride("approvalPolicy", value)));
  els.composerAccessMenu.appendChild(composerMenuSection("Sandbox", sandboxModeOptions(), state.runtimeOverrides.sandboxMode, (value) => setRuntimeOverride("sandboxMode", value)));
  const note = document.createElement("p");
  note.className = "composer-menu-note";
  note.textContent = state.configRequirementsStatus === "ready" ? "Restricted by config requirements." : "Runtime defaults apply when unset.";
  els.composerAccessMenu.appendChild(note);
}

function composerSelectedOverride(name) {
  const value = String(state.runtimeOverrides[name] || "");
  if (name === "model" && value === clearedModelId()) return "";
  if (name === "reasoningEffort" && value === clearedReasoningEffort()) return "";
  if (name === "serviceTier" && value === defaultServiceTier()) return "";
  return value;
}

function renderComposerModelMenu() {
  if (!els.composerModelMenu) return;
  els.composerModelMenu.innerHTML = "";
  const body = document.createElement("div");
  body.className = "composer-cascade-grid";
  const leftColumn = document.createElement("div");
  leftColumn.className = "composer-axis-column";
  leftColumn.appendChild(composerMenuSection("Intelligence", reasoningOptions(), composerSelectedOverride("reasoningEffort"), (value) => setRuntimeOverride("reasoningEffort", value)));
  leftColumn.appendChild(composerMenuSection("Speed", serviceTierOptions(), composerSelectedOverride("serviceTier"), (value) => setRuntimeOverride("serviceTier", value)));
  body.appendChild(leftColumn);
  body.appendChild(composerMenuSection("Model", composerModelOptions(), composerSelectedOverride("model"), (value) => setRuntimeOverride("model", value)));
  els.composerModelMenu.appendChild(body);
}

function renderComposerRuntimeBand() {
  if (!els.composerAccessButton || !els.composerModelButton || !els.sendButton) return;
  const active = turnIsActive();
  const accessText = state.runtimeOverrides.sandboxMode === "danger-full-access"
    ? "Full access"
    : state.runtimeOverrides.sandboxMode || state.runtimeOverrides.approvalPolicy || "Access";
  const modelText = `${compactModelLabel()} · ${reasoningLabel()}${state.runtimeOverrides.serviceTier ? ` · ${state.runtimeOverrides.serviceTier}` : ""}`;
  const quotaText = composerQuotaLabel();
  const contextProjection = contextUsageProjection();
  const contextText = contextProjection.compactLabel;

  els.composerAccessButton.textContent = accessText;
  els.composerAccessButton.classList.toggle("danger", state.runtimeOverrides.sandboxMode === "danger-full-access");
  els.composerAccessButton.title = `Next-turn access override. Approval: ${approvalPolicyLabel()}. Sandbox: ${sandboxModeLabel()}.`;
  els.composerAccessButton.setAttribute("aria-label", `Access override: approval ${approvalPolicyLabel()}, sandbox ${sandboxModeLabel()}`);

  els.composerModelButton.textContent = modelText;
  els.composerModelButton.title = `Next-turn model settings. Model: ${compactModelLabel()}. Reasoning: ${reasoningLabel()}. Speed: ${serviceTierLabel()}.`;
  els.composerModelButton.setAttribute("aria-label", `Model override: ${modelText}`);

  els.composerQuotaChip.textContent = quotaText;
  els.composerQuotaChip.title = `Provider quota: ${quotaText}. Shown only when exposed by runtime/account evidence.`;
  els.composerContextChip.textContent = contextText;
  els.composerContextChip.title = `Context pressure: ${contextProjection.label}.`;

  els.sendButton.textContent = state.turnStopping ? "Stopping" : active ? "Stop" : "Send";
  els.sendButton.classList.toggle("stop", active);
  els.sendButton.title = active ? "Stop the current Codex turn." : "Send this prompt to Codex.";
  els.sendButton.setAttribute("aria-label", active ? "Stop current Codex turn" : "Send prompt to Codex");
  els.sendButton.disabled = state.turnStopping || (!active && els.composerInput.disabled);
  els.composerAccessMenu.hidden = state.composerMenu !== "access";
  els.composerModelMenu.hidden = state.composerMenu !== "model";
  els.composerAccessButton.setAttribute("aria-expanded", state.composerMenu === "access" ? "true" : "false");
  els.composerModelButton.setAttribute("aria-expanded", state.composerMenu === "model" ? "true" : "false");
  if (state.composerMenu === "access") renderComposerAccessMenu();
  if (state.composerMenu === "model") renderComposerModelMenu();
  updateComposerGeometry();
}

function refreshButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "runtime-action";
  button.textContent = label;
  button.addEventListener("click", () => onClick());
  return button;
}

function modelOptions() {
  const visible = state.models.filter((model) => !model?.hidden);
  const rows = visible.length ? visible : state.models;
  const providerDefaultId = defaultModelId();
  const clearDefaultId = clearedModelId();
  const options = rows
    .filter((model) => String(model.model || model.id || "") !== String(clearDefaultId || ""))
    .map((model) => {
      const value = model.model || model.id;
      const label = model.displayName || model.model || model.id;
      return {
        value,
        label: `${label}${value === providerDefaultId ? " · provider default" : ""}`,
      };
    });
  const current = activeModelId();
  if (current && current !== clearDefaultId && !options.some((option) => option.value === current)) {
    options.unshift({ value: current, label: current });
  }
  options.unshift({
    value: "",
    label: defaultOptionLabel(modelById(clearDefaultId)?.displayName || clearDefaultId),
  });
  return options;
}

function composerModelOptions() {
  const size = els.composerForm?.dataset?.composerSize || "wide";
  const limit = size === "narrow" ? 5 : size === "medium" ? 7 : 9;
  return modelOptions().slice(0, limit);
}

function reasoningOptions() {
  const clearDefault = clearedReasoningEffort();
  const modelDefault = defaultReasoningEffort();
  return [
    { value: "", label: defaultOptionLabel(clearDefault) },
    ...supportedReasoningOptions()
      .filter((effort) => effort !== clearDefault)
      .map((effort) => ({
        value: effort,
        label: `${effort}${effort === modelDefault ? " · model default" : ""}`,
      })),
  ];
}

function approvalPolicyOptions() {
  const required = allowedApprovalPoliciesFromRequirements();
  const values = required || APPROVAL_POLICY_OPTIONS.filter(Boolean);
  return ["", ...values].map((value) => ({ value, label: value || "Runtime default" }));
}

function sandboxModeOptions() {
  const required = allowedSandboxModesFromRequirements();
  const values = required || SANDBOX_MODE_OPTIONS.filter(Boolean);
  return ["", ...values].map((value) => ({ value, label: value || "Runtime default" }));
}

function serviceTierOptions() {
  const settingsProjection = providerSettingsProjection();
  const configured = settingsProjection.serviceTier?.availableTiers || settingsProjection.speed?.availableTiers || null;
  const values = Array.isArray(configured) && configured.length
    ? configured.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  return ["", ...values].map((value) => ({ value, label: value || defaultOptionLabel(defaultServiceTier()) }));
}

function compactModelLabel() {
  const model = selectedModel();
  const label = model?.displayName || model?.model || activeModelId() || "default";
  return label.replace(/^GPT-/i, "GPT-");
}

function setRuntimeOverride(name, value) {
  state.runtimeOverrides[name] = String(value || "");
  if (name === "model") {
    const supported = supportedReasoningOptions();
    if (state.runtimeOverrides.reasoningEffort && !supported.includes(state.runtimeOverrides.reasoningEffort)) {
      state.runtimeOverrides.reasoningEffort = selectedModel()?.defaultReasoningEffort || "";
    }
  }
  renderRuntimeConstitution();
}

function reconcileAccessOverridesWithRequirements() {
  const allowedApprovals = allowedApprovalPoliciesFromRequirements();
  const allowedSandbox = allowedSandboxModesFromRequirements();
  if (
    state.runtimeOverrides.approvalPolicy &&
    allowedApprovals &&
    !allowedApprovals.includes(state.runtimeOverrides.approvalPolicy)
  ) {
    state.runtimeOverrides.approvalPolicy = "";
  }
  if (
    state.runtimeOverrides.sandboxMode &&
    allowedSandbox &&
    !allowedSandbox.includes(state.runtimeOverrides.sandboxMode)
  ) {
    state.runtimeOverrides.sandboxMode = "";
  }
}

function quotaWindowRows(snapshot) {
  if (!snapshot) return [["status", state.rateLimitsStatus || "unknown"]];
  const windows = [
    ["primary", snapshot.primary],
    ["secondary", snapshot.secondary],
  ].filter(([, window]) => window);
  const rows = [
    ["limit", snapshot.limitName || snapshot.limitId || "codex"],
    ["status", state.rateLimitsStatus || "ready"],
  ];
  for (const [fallback, window] of windows) {
    const label = rateLimitWindowLabel(window, fallback);
    const available = rateLimitAvailablePercent(window);
    rows.push([`${label} available`, available == null ? "unknown" : `${available}%`]);
    const usedPercent = window.usedPercent ?? window.used_percent;
    rows.push([`${label} used`, Number.isFinite(Number(usedPercent)) ? `${usedPercent}%` : "unknown"]);
    rows.push([`${label} resets`, formatResetTime(window)]);
  }
  if (snapshot.credits) {
    rows.push(["credits", snapshot.credits.unlimited ? "unlimited" : snapshot.credits.hasCredits ? snapshot.credits.balance || "available" : "none"]);
  }
  if (snapshot.rateLimitReachedType) rows.push(["limit reached", snapshot.rateLimitReachedType]);
  return rows;
}

function runtimeDrawerSections(c, tab) {
  if (tab === "runtime") {
    return [
      drawerSection("Runtime", [
        ["provider", c.provider?.label || c.provider?.kind || "unknown"],
        ["provider kind", c.provider?.kind || "unknown"],
        ["configured flavor", c.provider?.executable?.flavor?.configuredFlavor || c.provider?.flavor || "—"],
        ["proven flavor", c.provider?.executable?.flavor?.provenFlavor || "unknown"],
        ["compatibility", c.provider?.executable?.flavor?.compatibility || "unknown"],
        ["capability sources", (c.provider?.capabilitySources || []).map((source) => source.source).join(", ") || c.provider?.capabilitySource || "unknown"],
        ["kind", c.runtime.kind],
        ["status", c.runtime.status],
        ["transport", connection?.transport || connection?.capabilities?.coreRuntime?.transport || "websocket"],
        ["binary", connection?.binaryPath || "unknown"],
        ["codex home", connection?.codexHome || "default"],
        ["ready URL", connection?.readyUrl || "not connected"],
        ["thread state", c.thread.status],
      ], [...(c.provider?.evidenceRefs || []), ...c.runtime.evidenceRefs, ...c.thread.evidenceRefs]),
      drawerSection("Account", [
        ["status", c.account.status],
        ["label", c.account.label],
      ], c.account.evidenceRefs),
    ];
  }
  if (tab === "model") {
    const section = drawerSection("Model And Reasoning", [
      ["active model", c.model.label],
      ["model source", c.model.source],
      ["model next turn", c.model.selection.canSetNextTurn ? "supported" : "unsupported"],
      ["reasoning", c.reasoning.label],
      ["reasoning next turn", c.reasoning.selection.canSetNextTurn ? "supported" : "unsupported"],
    ], [...c.model.evidenceRefs, ...c.reasoning.evidenceRefs]);
    section.appendChild(selectField("Model", c.model.selectedId, modelOptions(), (value) => setRuntimeOverride("model", value), {
      disabled: !c.model.selection.canSetNextTurn,
      description: "Applies to the next Codex turn and subsequent turns in this thread.",
    }));
    section.appendChild(selectField("Reasoning effort", state.runtimeOverrides.reasoningEffort, reasoningOptions(), (value) => setRuntimeOverride("reasoningEffort", value), {
      disabled: !c.reasoning.selection.canSetNextTurn,
      description: "Uses the selected model's supported reasoning efforts.",
    }));
    section.appendChild(refreshButton("Refresh models", () => refreshModelList(true)));
    section.appendChild(unsupportedControlNote("Project/session-default persistence is not enabled yet; these controls are runtime turn overrides."));
    return [section];
  }
  if (tab === "access") {
    const section = drawerSection("Access And Safety", [
      ["header label", c.access.label],
      ["policy known", c.access.policyKnown ? "yes" : "no"],
      ["request handling", c.access.requestHandlingKnown ? "known" : "unknown"],
      ["mutable scopes", c.access.mutableScopes.join(", ")],
      ...accessRequirementsRows(),
    ], c.access.evidenceRefs);
    section.appendChild(selectField("Approval policy", c.access.approvalPolicy, approvalPolicyOptions(), (value) => setRuntimeOverride("approvalPolicy", value), {
      disabled: !c.access.mutableScopes.includes("next_turn"),
      description: "Controls when Codex asks before executing risky actions.",
    }));
    section.appendChild(selectField("Sandbox", c.access.sandboxMode, sandboxModeOptions(), (value) => setRuntimeOverride("sandboxMode", value), {
      disabled: !c.access.mutableScopes.includes("next_turn"),
      description: "Applies as a turn-scoped sandbox policy override.",
    }));
    section.appendChild(unsupportedControlNote("Danger-full-access remains explicit and visible; no access setting is auto-promoted."));
    return [section];
  }
  if (tab === "usage") {
    const quotaSection = drawerSection("Provider Quota", quotaWindowRows(c.usage.providerQuota.snapshot), c.usage.providerQuota.evidenceRefs);
    quotaSection.appendChild(refreshButton("Refresh quota", () => refreshRateLimits(true)));
    return [
      quotaSection,
      drawerSection("Context Pressure", [
        ["status", c.usage.contextPressure.status],
        ["label", c.usage.contextPressure.label],
        ["used", c.usage.contextPressure.percentUsed != null ? `${c.usage.contextPressure.percentUsed}%` : "unknown"],
        ["remaining", c.usage.contextPressure.percentRemaining != null ? `${c.usage.contextPressure.percentRemaining}%` : "unknown"],
        ["tokens", c.usage.contextPressure.tokensInContext != null ? formatCompactTokens(c.usage.contextPressure.tokensInContext) : "unknown"],
        ["window", c.usage.contextPressure.modelContextWindow ? formatCompactTokens(c.usage.contextPressure.modelContextWindow) : "unknown"],
        ["event", c.usage.contextPressure.eventName || "thread/tokenUsage/updated"],
        ["observed", c.usage.contextPressure.observedAt || "not observed"],
      ], c.usage.contextPressure.evidenceRefs),
      drawerSection("Local Activity", [
        ["turns", c.usage.activity.turnCount],
        ["commands", c.usage.activity.commandCount],
        ["tool calls", c.usage.activity.toolCallCount],
        ["approvals", c.usage.activity.approvalCount],
        ["duration", c.usage.activity.sessionDurationMs ? `${Math.round(c.usage.activity.sessionDurationMs / 1000)}s` : "—"],
      ], c.usage.activity.evidenceRefs),
    ];
  }
  if (tab === "capabilities") {
    const caps = c.capabilities?.profile || {};
    return [
      drawerSection("Capability Provenance", [
        ["status", c.capabilities?.status || "unknown"],
        ["schema source", c.capabilities?.schemaSource || "unknown"],
        ["unsupported entries", (c.capabilities?.unsupported || []).length],
      ], c.capabilities?.evidenceRefs || []),
      drawerSection("Thread Operations", Object.entries(caps.threads || {}).map(([key, value]) => [key, value ? "yes" : "no"])),
      drawerSection("Turn Operations", Object.entries(caps.turns || {}).map(([key, value]) => [key, value ? "yes" : "no"])),
      drawerSection("Model Scope", Object.entries(caps.model || {}).map(([key, value]) => [key, value ? "yes" : "no"])),
      drawerSection("Reasoning Scope", Object.entries(caps.reasoning || {}).map(([key, value]) => [key, value ? "yes" : "no"])),
      drawerSection("Authority", Object.entries(caps.authority || {}).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") || "none" : value ? "yes" : "no"])),
      drawerSection("Provider Profile", [
        ["kind", caps.provider?.kind || "unknown"],
        ["configured flavor", caps.provider?.executable?.flavor?.configuredFlavor || caps.provider?.flavor || "unknown"],
        ["proven flavor", caps.provider?.executable?.flavor?.provenFlavor || "unknown"],
        ["compatibility", caps.provider?.executable?.flavor?.compatibility || "unknown"],
        ["status", caps.provider?.status || "unknown"],
        ["sources", (caps.provider?.capabilitySources || []).map((source) => `${source.source}${source.enablesMutation ? "*" : ""}`).join(", ") || caps.provider?.capabilitySource || "unknown"],
        ["main default", caps.provider?.defaultForMainBranch ? "yes" : "no"],
      ]),
      drawerSection("Settings Projection", [
        ["model next turn", caps.provider?.settingsProjection?.model?.scopes?.nextTurn ? "yes" : "no"],
        ["model list", caps.provider?.settingsProjection?.model?.canList ? "yes" : "no"],
        ["reasoning next turn", caps.provider?.settingsProjection?.reasoning?.scopes?.nextTurn ? "yes" : "no"],
        ["access approval override", settingScopeEnabled(caps.provider?.settingsProjection?.access?.scopes?.approvalPolicy) || caps.provider?.settingsProjection?.access?.scopes?.nextTurnApprovalPolicy ? "yes" : "no"],
        ["access sandbox override", settingScopeEnabled(caps.provider?.settingsProjection?.access?.scopes?.sandbox) || caps.provider?.settingsProjection?.access?.scopes?.nextTurnSandbox ? "yes" : "no"],
        ["quota read", caps.provider?.settingsProjection?.usage?.providerQuota?.canRead || caps.provider?.settingsProjection?.usage?.canReadRateLimits ? "yes" : "no"],
        ["context usage event", caps.provider?.settingsProjection?.usage?.contextPressure?.canRead || caps.usage?.canReadContextUsage ? "yes" : "no"],
        ["requirements", state.configRequirementsStatus || "unknown"],
      ]),
      drawerSection("Requests", [
        ["supported", (caps.requests?.supportedServerMethods || []).length],
        ["auto unsupported", (caps.requests?.unsupportedButHandledMethods || []).length],
        ["unknown policy", caps.requests?.unknownRequestPolicy || "unknown"],
      ]),
    ];
  }
  if (tab === "environment") {
    return [
      drawerSection("Workspace", [
        ["cwd", c.environment.cwd],
        ["repo", c.environment.repo || "unknown"],
        ["backend", c.environment.workspaceStatus || "unknown"],
        ["branch", c.environment.branch || "not exposed"],
        ["PR", c.environment.pr?.label || "not exposed"],
        ["Codex .codex hygiene", c.environment.hygiene?.codexSandboxPlaceholderIgnored ? "ignored" : "unknown"],
        ["hygiene pattern", c.environment.hygiene?.pattern || "not exposed"],
      ], c.environment.evidenceRefs),
    ];
  }
  return [
    drawerSection("Diagnostics", [
      ["connection status", state.connectionStatus],
      ["connection id", connection?.connectionId || "not connected"],
      ["schema version", state.runtimeConstitution?.schemaVersion || "unknown"],
      ["source revision", state.runtimeConstitution?.sourceRevision || "unknown"],
      ["capability source", state.runtimeConstitution?.capabilities?.schemaSource || connection?.capabilities?.diagnostics?.source || "unknown"],
      ["schema source", connection?.capabilities?.coreRuntime?.schemaSource || "unknown"],
      ["activation epoch", payload.activationEpoch || 0],
    ], [evidenceRef("runtime_snapshot", "Renderer diagnostic snapshot", { confidence: "observed" })]),
  ];
}

function userInputToText(entry) {
  if (!entry) return "";
  if (typeof entry.text === "string" && entry.text.trim()) return entry.text.trim();
  if (entry.type === "input_image" || entry.type === "image") {
    const imageRef = String(entry.image_url || entry.path || "").trim();
    return imageRef ? `[image] ${imageRef}` : "[image]";
  }
  return compactValue(entry, 140);
}

function normalizePhase(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isThoughtAssistantPhase(phase) {
  const normalized = normalizePhase(phase);
  // Keep this conservative: only explicit commentary is treated as thought.
  // Final answer (`final_answer`) and unknown/missing phases render as regular assistant output.
  return Boolean(normalized) && THOUGHT_ASSISTANT_PHASES.has(normalized);
}

function isThoughtAssistantMessageItem(item) {
  if (!item || item.type !== "agentMessage") return false;
  return isThoughtAssistantPhase(item.phase);
}

function isStoredThoughtAssistantEntry(entry) {
  if (!entry || entry.role !== "assistant") return false;
  return isThoughtAssistantPhase(entry.phase);
}

function rememberThoughtAssistantItem(item, turnKey = "") {
  const itemId = String(item?.id || "").trim();
  if (!itemId) return;
  const key = String(turnKey || item?.turnId || state.turnId || `live_${Date.now()}`);
  const phase = normalizePhase(item?.phase || "");
  state.thoughtTurnByItemId.set(itemId, { turnKey: key, phase });
}

function normalizeSlashes(value) {
  return String(value || "").replace(/\\/g, "/");
}

function stripTokenPunctuation(value) {
  return String(value || "").replace(/[),.;!?]+$/g, "");
}

function knownWorkspaceRoots() {
  const roots = [
    connection?.workspaceRoot,
    project?.workspace?.linuxPath,
    project?.workspace?.localPath,
    project?.repoPath,
  ];
  const repoText = String(project?.repoPath || "");
  const wslMatch = repoText.match(/^wsl:[^:]+:(\/.*)$/i);
  if (wslMatch) roots.push(wslMatch[1]);
  return Array.from(new Set(roots.map((root) => normalizeSlashes(root).replace(/\/+$/, "")).filter(Boolean)));
}

function relativePathWithinRoot(filePath) {
  const raw = stripTokenPunctuation(filePath).trim();
  if (!raw || raw.includes("\0")) return "";
  const normalized = normalizeSlashes(raw);
  if (normalized.startsWith("../") || normalized.includes("/../") || normalized === "..") return "";
  if (/\s/.test(normalized)) return "";

  for (const root of knownWorkspaceRoots()) {
    const normalizedRoot = normalizeSlashes(root).replace(/\/+$/, "");
    if (!normalizedRoot) continue;
    const lowerPath = normalized.toLowerCase();
    const lowerRoot = normalizedRoot.toLowerCase();
    if (lowerPath === lowerRoot) return "";
    if (lowerPath.startsWith(`${lowerRoot}/`)) return normalized.slice(normalizedRoot.length + 1);
  }

  const isAbsolute = normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized);
  if (isAbsolute) return "";
  if (!normalized.includes("/") && !/\.[A-Za-z0-9]{1,12}$/.test(normalized)) return "";
  return normalized.replace(/^\.\/+/, "");
}

function splitLineRef(value) {
  const text = stripTokenPunctuation(value).trim();
  const match = text.match(/^(.*?)(?::(\d+)(?::(\d+))?)$/);
  if (!match) return { path: text, line: null, column: null };
  if (/^[A-Za-z]$/.test(match[1])) return { path: text, line: null, column: null };
  return {
    path: match[1],
    line: Number(match[2]),
    column: match[3] ? Number(match[3]) : null,
  };
}

function addTokenCandidate(candidates, start, end, token) {
  if (start < 0 || end <= start) return;
  candidates.push({ start, end, token });
}

function chooseTokenCandidates(candidates) {
  const sorted = candidates
    .filter((candidate) => candidate?.token?.text)
    .sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const result = [];
  let cursor = 0;
  for (const candidate of sorted) {
    if (candidate.start < cursor) continue;
    result.push(candidate);
    cursor = candidate.end;
  }
  return result;
}

function tokenizeTypedContent(text) {
  const source = String(text || "");
  if (!source) return [{ type: "text", text: "" }];
  const candidates = [];

  const urlPattern = /https?:\/\/[^\s<>"'`)\]]+/g;
  for (const match of source.matchAll(urlPattern)) {
    const raw = stripTokenPunctuation(match[0]);
    addTokenCandidate(candidates, match.index, match.index + raw.length, { type: "url", text: raw, href: raw });
  }

  const backtickPattern = /`([^`\n]{1,240})`/g;
  for (const match of source.matchAll(backtickPattern)) {
    const raw = match[1] || "";
    const lineRef = splitLineRef(raw);
    const relPath = relativePathWithinRoot(lineRef.path);
    if (relPath) {
      addTokenCandidate(candidates, match.index, match.index + match[0].length, {
        type: lineRef.line ? "line_ref" : "file_path",
        text: match[0],
        path: relPath,
        line: lineRef.line,
        column: lineRef.column,
      });
      continue;
    }
    const type = /\s|^(npm|pnpm|yarn|node|git|gh|cargo|python|pytest|uv|make|bash|sh)\b/.test(raw.trim())
      ? "command"
      : "symbol";
    addTokenCandidate(candidates, match.index, match.index + match[0].length, { type, text: match[0], value: raw });
  }

  const filePattern = /(?:[A-Za-z]:[\\/]|\/|\.{1,2}\/)?[A-Za-z0-9._@+-][A-Za-z0-9._@+:/\\-]*\.[A-Za-z0-9]{1,12}(?::\d+(?::\d+)?)?/g;
  for (const match of source.matchAll(filePattern)) {
    const raw = stripTokenPunctuation(match[0]);
    if (!raw || /^https?:\/\//i.test(raw)) continue;
    const lineRef = splitLineRef(raw);
    const relPath = relativePathWithinRoot(lineRef.path);
    if (!relPath) continue;
    addTokenCandidate(candidates, match.index, match.index + raw.length, {
      type: lineRef.line ? "line_ref" : "file_path",
      text: raw,
      path: relPath,
      line: lineRef.line,
      column: lineRef.column,
    });
  }

  const chosen = chooseTokenCandidates(candidates);
  const tokens = [];
  let cursor = 0;
  for (const candidate of chosen) {
    if (candidate.start > cursor) tokens.push({ type: "text", text: source.slice(cursor, candidate.start) });
    tokens.push(candidate.token);
    cursor = candidate.end;
  }
  if (cursor < source.length) tokens.push({ type: "text", text: source.slice(cursor) });
  return tokens.length ? tokens : [{ type: "text", text: source }];
}

async function openTypedUrl(url) {
  if (bridge?.openWorkspaceLink) {
    const result = await bridge.openWorkspaceLink(url, {
      disposition: "middle-web",
      source: {
        surface: "codex",
        projectId: project?.id || "",
        threadId: state.threadId || "",
        threadTitle: state.threadTitle || "",
      },
      userGesture: true,
    });
    if (!result?.ok) addSystemMessage(`URL open blocked: ${result?.error || "unknown error"}`);
    return;
  }
  if (!bridge?.openExternalUrl) {
    addSystemMessage("Workspace URL opening is unavailable in this Codex surface.");
    return;
  }
  const result = await bridge.openExternalUrl(url);
  if (!result?.ok) addSystemMessage(`URL open blocked: ${result?.error || "unknown error"}`);
}

async function revealTypedFile(relPath) {
  if (!bridge?.revealProjectFile || !project?.id) {
    addSystemMessage("Project file reveal is unavailable in this Codex surface.");
    return;
  }
  try {
    const result = await bridge.revealProjectFile(project.id, relPath);
    if (!result?.opened && result?.method) addSystemMessage(`File path copied: ${result.absolutePath || relPath}`);
  } catch (error) {
    addSystemMessage(`File reveal failed: ${error.message}`);
  }
}

function renderTypedContent(container, text) {
  container.textContent = "";
  const tokens = tokenizeTypedContent(text);
  for (const token of tokens) {
    if (!token || token.type === "text") {
      container.appendChild(document.createTextNode(token?.text || ""));
      continue;
    }
    if (token.type === "url") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "typed-token typed-token-url";
      button.textContent = token.text;
      button.title = "Open link in browser";
      button.addEventListener("click", () => openTypedUrl(token.href));
      container.appendChild(button);
      continue;
    }
    if (token.type === "file_path" || token.type === "line_ref") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `typed-token ${token.type === "line_ref" ? "typed-token-line-ref" : "typed-token-file"}`;
      button.textContent = token.text;
      button.title = token.line ? `Reveal ${token.path}:${token.line}` : `Reveal ${token.path}`;
      button.addEventListener("click", () => revealTypedFile(token.path));
      container.appendChild(button);
      continue;
    }
    const span = document.createElement("span");
    span.className = `typed-token typed-token-${token.type.replace(/_/g, "-")}`;
    span.textContent = token.text;
    container.appendChild(span);
  }
}

function appendTypedText(parent, text) {
  if (!text) return;
  const span = document.createElement("span");
  renderTypedContent(span, text);
  parent.appendChild(span);
}

function safeMarkdownHref(rawHref) {
  try {
    const parsed = new URL(String(rawHref || ""));
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function markdownLocalHref(rawHref) {
  const original = String(rawHref || "").trim();
  if (!original || original.startsWith("#") || /^[A-Za-z][A-Za-z0-9+.-]*:/i.test(original)) return null;
  const lineHash = original.match(/^(.*)#L(\d+)$/i);
  const withoutHash = lineHash ? lineHash[1] : original.replace(/#.*$/, "");
  const lineRef = splitLineRef(lineHash ? `${withoutHash}:${lineHash[2]}` : withoutHash);
  const relPath = relativePathWithinRoot(lineRef.path);
  if (!relPath) return null;
  return { path: relPath, line: lineRef.line, column: lineRef.column };
}

function appendFileToken(parent, label, fileRef) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `typed-token ${fileRef.line ? "typed-token-line-ref" : "typed-token-file"} assistant-md-link`;
  button.textContent = label || fileRef.path;
  button.title = fileRef.line ? `Reveal ${fileRef.path}:${fileRef.line}` : `Reveal ${fileRef.path}`;
  button.addEventListener("click", () => revealTypedFile(fileRef.path));
  parent.appendChild(button);
}

function appendUrlToken(parent, label, href) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "typed-token typed-token-url assistant-md-link";
  button.textContent = label || href;
  button.title = `Open ${href}`;
  button.addEventListener("click", () => openTypedUrl(href));
  parent.appendChild(button);
}

function appendUnsupportedMarkdownLink(parent, label, reason) {
  const span = document.createElement("span");
  span.className = "assistant-md-link-blocked";
  span.textContent = label;
  span.title = reason || "Unsupported or unsafe link";
  parent.appendChild(span);
}

function appendInlineCode(parent, raw) {
  const code = document.createElement("code");
  code.className = "assistant-md-inline-code";
  const source = String(raw || "");
  const fileRef = markdownLocalHref(source) || (() => {
    const lineRef = splitLineRef(source);
    const relPath = relativePathWithinRoot(lineRef.path);
    return relPath ? { path: relPath, line: lineRef.line, column: lineRef.column } : null;
  })();
  if (fileRef) {
    appendFileToken(code, source, fileRef);
  } else {
    const href = safeMarkdownHref(source);
    if (href) appendUrlToken(code, source, href);
    else {
      const span = document.createElement("span");
      const trimmed = source.trim();
      const tokenType = /^[a-f0-9]{7,40}$/i.test(trimmed)
        ? "commit"
        : /\s|^(npm|pnpm|yarn|node|git|gh|cargo|python|pytest|uv|make|bash|sh)\b/.test(trimmed)
          ? "command"
          : "symbol";
      span.className = `typed-token typed-token-${tokenType}`;
      span.textContent = source;
      code.appendChild(span);
    }
  }
  parent.appendChild(code);
}

function appendInlineMarkdown(parent, text) {
  const source = String(text || "");
  const pattern = /(\[[^\]\n]{1,240}\]\([^) \n]{1,1000}\)|`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|(->|=>))/g;
  let cursor = 0;
  for (const match of source.matchAll(pattern)) {
    if (match.index > cursor) appendTypedText(parent, source.slice(cursor, match.index));
    const token = match[0];
    const linkMatch = token.match(/^\[([^\]\n]+)\]\(([^) \n]+)\)$/);
    if (linkMatch) {
      const href = safeMarkdownHref(linkMatch[2]);
      const fileRef = markdownLocalHref(linkMatch[2]);
      if (href) appendUrlToken(parent, linkMatch[1], href);
      else if (fileRef) appendFileToken(parent, linkMatch[1], fileRef);
      else appendUnsupportedMarkdownLink(parent, linkMatch[1], "Unsupported, unsafe, or unresolved link target");
    } else if (token.startsWith("`")) {
      appendInlineCode(parent, token.slice(1, -1));
    } else if (token.startsWith("**")) {
      const strong = document.createElement("strong");
      strong.className = "assistant-md-strong";
      appendTypedText(strong, token.slice(2, -2));
      parent.appendChild(strong);
    } else if (token.startsWith("*")) {
      const em = document.createElement("em");
      em.className = "assistant-md-emphasis";
      appendTypedText(em, token.slice(1, -1));
      parent.appendChild(em);
    } else {
      const arrow = document.createElement("span");
      arrow.className = "assistant-md-arrow";
      arrow.textContent = token;
      parent.appendChild(arrow);
    }
    cursor = match.index + token.length;
  }
  if (cursor < source.length) appendTypedText(parent, source.slice(cursor));
}

function createMarkdownLineBlock(tagName, className, text) {
  const block = document.createElement(tagName);
  block.className = className;
  appendInlineMarkdown(block, text);
  return block;
}

function isMarkdownBlockStart(line) {
  const trimmed = String(line || "").trim();
  return Boolean(
    !trimmed ||
    /^```/.test(trimmed) ||
    /^#{1,4}\s+/.test(trimmed) ||
    /^>\s?/.test(trimmed) ||
    /^---+$/.test(trimmed) ||
    /^[-*]\s+/.test(trimmed) ||
    /^\d+\.\s+/.test(trimmed) ||
    /^(->|=>)\s+/.test(trimmed)
  );
}

function appendMarkdownList(container, lines, ordered) {
  const list = document.createElement(ordered ? "ol" : "ul");
  list.className = "assistant-md-list";
  for (const line of lines) {
    const raw = ordered
      ? String(line || "").replace(/^\s*\d+\.\s+/, "")
      : String(line || "").replace(/^\s*[-*]\s+/, "");
    const taskMatch = raw.match(/^\[(x|X| )\]\s+([\s\S]*)$/);
    const item = document.createElement("li");
    const appendListText = (target, value) => {
      const fragments = String(value || "").split("\n");
      fragments.forEach((fragment, index) => {
        if (index) target.appendChild(document.createElement("br"));
        appendInlineMarkdown(target, fragment);
      });
    };
    if (taskMatch) {
      const marker = document.createElement("span");
      marker.className = `assistant-md-task-marker${taskMatch[1].trim() ? " done" : ""}`;
      marker.textContent = taskMatch[1].trim() ? "✓" : "□";
      item.appendChild(marker);
      appendListText(item, taskMatch[2]);
    } else {
      appendListText(item, raw);
    }
    list.appendChild(item);
  }
  container.appendChild(list);
}

function renderFinalAssistantContent(container, text) {
  container.textContent = "";
  container.classList.add("assistant-markdown");
  const source = String(text || "").replace(/\r\n/g, "\n");
  if (!source.trim()) return;
  const lines = source.split("\n");
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    const fence = trimmed.match(/^```([A-Za-z0-9_-]+)?\s*$/);
    if (fence) {
      const language = fence[1] || "";
      const codeLines = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      const block = document.createElement("figure");
      block.className = "assistant-md-codeblock";
      if (language) {
        const caption = document.createElement("figcaption");
        caption.textContent = language;
        block.appendChild(caption);
      }
      const pre = document.createElement("pre");
      pre.textContent = codeLines.join("\n");
      block.appendChild(pre);
      container.appendChild(block);
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = Math.min(4, heading[1].length);
      container.appendChild(createMarkdownLineBlock(`h${level}`, `assistant-md-heading level-${level}`, heading[2]));
      index += 1;
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      const divider = document.createElement("hr");
      divider.className = "assistant-md-divider";
      container.appendChild(divider);
      index += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      container.appendChild(createMarkdownLineBlock("blockquote", "assistant-md-quote", quoteLines.join("\n")));
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed) || /^[-*]\s+/.test(trimmed)) {
      const ordered = /^\d+\.\s+/.test(trimmed);
      const listLines = [];
      while (index < lines.length) {
        const nextLine = lines[index];
        const nextTrimmed = lines[index].trim();
        const isNextItem = ordered ? /^\d+\.\s+/.test(nextTrimmed) : /^[-*]\s+/.test(nextTrimmed);
        if (isNextItem) {
          listLines.push(nextLine);
          index += 1;
          continue;
        }
        if (listLines.length && /^\s{2,}\S/.test(nextLine)) {
          listLines[listLines.length - 1] = `${listLines[listLines.length - 1]}\n${nextLine.trim()}`;
          index += 1;
          continue;
        }
        if (!nextTrimmed) {
          index += 1;
          break;
        }
        break;
      }
      if (!listLines.length) {
        index += 1;
      }
      appendMarkdownList(container, listLines, ordered);
      continue;
    }

    const chain = trimmed.match(/^(->|=>)\s*(.*)$/);
    if (chain) {
      const block = document.createElement("p");
      block.className = "assistant-md-chain";
      const arrow = document.createElement("span");
      arrow.className = "assistant-md-arrow";
      arrow.textContent = chain[1];
      block.append(arrow, document.createTextNode(" "));
      appendInlineMarkdown(block, chain[2]);
      container.appendChild(block);
      index += 1;
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (index < lines.length && !isMarkdownBlockStart(lines[index])) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    container.appendChild(createMarkdownLineBlock("p", "assistant-md-paragraph", paragraphLines.join("\n")));
  }
}

function messageCopyText(node) {
  const bubble = node?.querySelector?.(".bubble");
  if (!bubble) return "";
  return String(bubble.dataset.rawText || bubble.textContent || "");
}

async function copyMessageText(node, button) {
  const text = messageCopyText(node);
  if (!text) return;
  const previous = button.textContent;
  try {
    if (bridge?.copyText) await bridge.copyText(text);
    else await navigator.clipboard.writeText(text);
    button.textContent = "Copied";
    button.classList.add("copied");
  } catch {
    button.textContent = "Copy failed";
    button.classList.add("failed");
  } finally {
    setTimeout(() => {
      button.textContent = previous || "Copy";
      button.classList.remove("copied", "failed");
    }, 1000);
  }
}

function ensureMessage(id, role, title = "") {
  if (state.itemMap.has(id)) return state.itemMap.get(id);
  const article = document.createElement("article");
  article.className = `message ${role}`;
  const roleNode = document.createElement("div");
  roleNode.className = "role";
  roleNode.textContent = title || (role === "assistant" ? "Codex" : role === "user" ? "You" : "System");
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  article.append(roleNode, bubble);
  if (role === "assistant" || role === "user") {
    const actions = document.createElement("div");
    actions.className = "message-actions";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "message-copy-button";
    copy.textContent = "Copy";
    copy.title = "Copy raw message text";
    copy.addEventListener("click", () => copyMessageText(article, copy));
    actions.appendChild(copy);
    article.appendChild(actions);
  }
  els.transcript.appendChild(article);
  maybeAutoScrollBottom();
  state.itemMap.set(id, article);
  return article;
}

function setMessageText(id, role, text, title = "") {
  const node = ensureMessage(id, role, title);
  const bubble = node.querySelector(".bubble");
  bubble.dataset.rawText = text || "";
  bubble.dataset.typedRendered = "true";
  bubble.dataset.streamingPlain = "false";
  if (role === "assistant") {
    renderFinalAssistantContent(bubble, text || "");
  } else {
    bubble.classList.remove("assistant-markdown");
    renderTypedContent(bubble, text || "");
  }
  configureUserMessagePreview(node, role);
  maybeAutoScrollBottom();
}

function appendMessageText(id, role, delta, title = "") {
  const node = ensureMessage(id, role, title);
  const bubble = node.querySelector(".bubble");
  const textDelta = String(delta || "");
  const previous = bubble.dataset.rawText || bubble.textContent || "";
  const next = `${previous}${textDelta}`;
  bubble.dataset.rawText = next;
  bubble.dataset.typedRendered = "false";
  if (bubble.dataset.streamingPlain !== "true") {
    bubble.classList.remove("assistant-markdown");
    bubble.textContent = previous;
    bubble.dataset.streamingPlain = "true";
  }
  if (textDelta) bubble.appendChild(document.createTextNode(textDelta));
  configureUserMessagePreview(node, role);
  maybeAutoScrollBottom();
}

function finalizeMessageTypedContent(id) {
  const node = state.itemMap.get(String(id || ""));
  const bubble = node?.querySelector(".bubble");
  if (!bubble || bubble.dataset.typedRendered === "true") return;
  const text = bubble.dataset.rawText || bubble.textContent || "";
  bubble.dataset.rawText = text;
  bubble.dataset.typedRendered = "true";
  bubble.dataset.streamingPlain = "false";
  const role = node.classList.contains("user") ? "user" : node.classList.contains("assistant") ? "assistant" : "system";
  if (role === "assistant") {
    renderFinalAssistantContent(bubble, text);
  } else {
    bubble.classList.remove("assistant-markdown");
    renderTypedContent(bubble, text);
  }
  configureUserMessagePreview(node, role);
}

function addSystemMessage(text) {
  setMessageText(`system_${Date.now()}_${Math.random().toString(16).slice(2)}`, "system", text, "System");
}

function clearRenderedDomState() {
  els.transcript.innerHTML = "";
  state.itemMap.clear();
  state.codexItemMap.clear();
  state.thoughtItemMap.clear();
  state.thoughtTurnByItemId.clear();
  for (const pending of state.pendingThoughtRenderMap.values()) {
    if (pending?.frameId) cancelAnimationFrame(pending.frameId);
  }
  state.pendingThoughtRenderMap.clear();
  state.finalMessageByTurnKey.clear();
}

function resetThreadSessionState() {
  state.turnActivityMap.clear();
  state.turnPromptMap.clear();
  state.turnRetryCountMap.clear();
  state.emptyTurnRetrying.clear();
}

function clearRenderedThreadState(options = {}) {
  clearRenderedDomState();
  if (options.resetSession !== false) resetThreadSessionState();
}

function openThreadFromEvent(event) {
  if (!event?.threadId) return;
  if (!state.readyForThreadOpen) {
    state.pendingOpenThreadEvent = event;
    return;
  }
  if (String(event.threadId) === String(state.threadId) && (state.liveAttached || state.historyData)) return;
  reportThreadState("dispatched", {
    threadId: event.threadId,
    sourceHome: event.sourceHome || "",
    sessionFilePath: event.sessionFilePath || "",
    title: event.title || "",
    evidence: "open-thread-request",
  });
  openThreadHybrid(event.threadId, event.sourceHome || "", event.sessionFilePath || "", event.title || "").catch((error) => {
    reportThreadState("failed", {
      threadId: event.threadId,
      sourceHome: event.sourceHome || "",
      sessionFilePath: event.sessionFilePath || "",
      title: event.title || "",
      evidence: "open-thread-request",
      errorDescription: error.message,
    });
    addSystemMessage(`Unable to open Codex thread ${event.threadId || ""}: ${error.message}`);
  });
}

function turnIdFromNotification(params) {
  return String(params?.turn?.id || params?.turnId || "");
}

function ensureTurnActivity(turnId) {
  const id = String(turnId || "").trim();
  if (!id) return null;
  const existing = state.turnActivityMap.get(id);
  if (existing) return existing;
  const next = {
    id,
    startedAt: null,
    completedAt: null,
    status: "",
    hasCodexOutput: false,
    errorShown: false,
    emptyCompletionWarned: false,
  };
  state.turnActivityMap.set(id, next);
  return next;
}

function markTurnCodexOutput(turnId) {
  const activity = ensureTurnActivity(turnId);
  if (activity) activity.hasCodexOutput = true;
}

function rememberPromptTurn(turnId, text, retryCount = 0) {
  const id = String(turnId || "").trim();
  if (!id || !text) return;
  state.turnPromptMap.set(id, text);
  state.turnRetryCountMap.set(id, Math.max(0, Number(retryCount) || 0));
}

async function retryEmptyTurn(turnId) {
  const id = String(turnId || "").trim();
  if (!id || state.emptyTurnRetrying.has(id)) return;
  const prompt = state.turnPromptMap.get(id);
  const retryCount = state.turnRetryCountMap.get(id) || 0;
  if (!prompt || retryCount >= EMPTY_TURN_AUTO_RETRY_LIMIT) return;

  state.emptyTurnRetrying.add(id);
  try {
    setComposerEnabled(false, "Retrying empty Codex turn…");
    addSystemMessage("Rolling back the empty Codex turn and retrying the prompt once.");
    const rollback = await rpc("thread/rollback", { threadId: state.threadId, numTurns: 1 });
    if (!rollback?.thread) throw new Error("Rollback failed to return updated thread state.");
    renderThreadHistory(rollback.thread);
    bindThread(rollback.thread, project?.codex?.model || "", { liveAttached: true });
    setComposerEnabled(false, "Retrying empty Codex turn…");
    await startCodexTurn(prompt, { retryCount: retryCount + 1 });
  } catch (error) {
    addSystemMessage(`Automatic retry failed: ${error.message}`);
    setComposerEnabled(state.liveAttached, state.liveAttached ? "" : "Read-only mode");
  } finally {
    state.emptyTurnRetrying.delete(id);
  }
}

function renderTurnCompletionNotice(turnId, turn) {
  const id = String(turnId || turn?.id || "").trim();
  if (!id) return;
  const activity = ensureTurnActivity(id);
  if (!activity || activity.emptyCompletionWarned) return;

  if (turn?.status === "failed" && turn?.error) {
    if (activity.errorShown) return;
    activity.errorShown = true;
    activity.emptyCompletionWarned = true;
    const details = [
      turn.error.message || "Codex turn failed.",
      turn.error.additionalDetails || "",
    ].filter(Boolean).join("\n");
    addSystemMessage(details);
    return;
  }

  if (activity.hasCodexOutput) return;
  activity.emptyCompletionWarned = true;
  const status = String(turn?.status || "completed");
  const duration = Number.isFinite(turn?.durationMs) ? ` in ${Math.max(0, Math.round(turn.durationMs))}ms` : "";
  if (status !== "completed") {
    addSystemMessage(`Codex turn ended as ${status}${duration} without assistant, tool, or reasoning output.`);
    return;
  }
  const prompt = state.turnPromptMap.get(id);
  const retryCount = state.turnRetryCountMap.get(id) || 0;
  if (prompt && retryCount < EMPTY_TURN_AUTO_RETRY_LIMIT && state.threadId && state.connected) {
    addSystemMessage(
      `Codex accepted the prompt but completed${duration} without assistant, tool, or reasoning output. This empty turn will be rolled back and retried once.`,
    );
    retryEmptyTurn(id);
    return;
  }
  addSystemMessage(
    `Codex accepted the prompt but completed${duration} without assistant, tool, or reasoning output. The prompt was recorded in the thread; this usually means the app-server/core turn stopped before model output was produced.`,
  );
}

function removeUserMessagePreviewToggle(node) {
  if (!node) return;
  const existing = node.querySelector(".user-message-preview-toggle");
  if (existing) existing.remove();
}

function setUserMessagePreviewState(node, expanded) {
  const bubble = node?.querySelector(".bubble");
  const toggle = node?.querySelector(".user-message-preview-toggle");
  if (!bubble || !toggle) return;
  const isExpanded = Boolean(expanded);
  bubble.classList.toggle("is-user-preview-collapsed", !isExpanded);
  bubble.classList.toggle("is-user-preview-expanded", isExpanded);
  toggle.textContent = isExpanded ? "▴ Collapse" : "▾ Expand";
  toggle.setAttribute("aria-expanded", isExpanded ? "true" : "false");
}

function configureUserMessagePreview(node, role) {
  if (!node) return;
  const bubble = node.querySelector(".bubble");
  if (!bubble) return;

  removeUserMessagePreviewToggle(node);
  bubble.classList.remove("is-user-preview-collapsed", "is-user-preview-expanded", "is-user-preview-eligible");
  bubble.style.removeProperty("--user-preview-lines");

  if (role !== "user") return;

  bubble.style.setProperty("--user-preview-lines", String(USER_MESSAGE_PREVIEW_LINES));
  bubble.classList.add("is-user-preview-collapsed");

  const previewVersion = (Number(node.dataset.previewVersion || "0") || 0) + 1;
  node.dataset.previewVersion = String(previewVersion);
  const explicitLineCount = String(bubble.textContent || "").split(/\r?\n/).length;

  requestAnimationFrame(() => {
    if (!node.isConnected) return;
    if (node.dataset.previewVersion !== String(previewVersion)) return;

    const renderedOverflow = bubble.scrollHeight > bubble.clientHeight + 1;
    const shouldClamp = explicitLineCount > USER_MESSAGE_PREVIEW_LINES || renderedOverflow;

    if (!shouldClamp) {
      bubble.classList.remove("is-user-preview-collapsed", "is-user-preview-expanded", "is-user-preview-eligible");
      bubble.style.removeProperty("--user-preview-lines");
      removeUserMessagePreviewToggle(node);
      return;
    }

    bubble.classList.add("is-user-preview-eligible");
    bubble.classList.remove("is-user-preview-expanded");
    bubble.classList.add("is-user-preview-collapsed");

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "secondary user-message-preview-toggle";
    toggle.addEventListener("click", () => {
      const expanded = bubble.classList.contains("is-user-preview-collapsed");
      setUserMessagePreviewState(node, expanded);
    });
    node.appendChild(toggle);
    setUserMessagePreviewState(node, false);
  });
}

function rpc(method, params = {}) {
  if (!bridge) return Promise.reject(new Error("Codex surface bridge is unavailable."));
  return bridge.request(method, params);
}

async function refreshModelList(showErrors = false) {
  const settingsProjection = providerSettingsProjection();
  if (settingsProjection.model?.canList !== true && !hasCapabilityForMutation("model", "canList")) {
    state.modelListStatus = "unavailable";
    renderRuntimeConstitution();
    return;
  }
  state.modelListStatus = "loading";
  renderRuntimeConstitution();
  try {
    const models = [];
    let cursor = null;
    const seenCursors = new Set();
    let truncated = false;
    for (let page = 0; page < MODEL_LIST_PAGE_LIMIT; page += 1) {
      if (cursor) {
        if (seenCursors.has(cursor)) throw new Error(`model/list returned a repeated cursor after ${page} page(s).`);
        seenCursors.add(cursor);
      }
      const response = await rpc("model/list", { cursor, limit: MODEL_LIST_PAGE_SIZE, includeHidden: false });
      models.push(...(Array.isArray(response?.data) ? response.data : []));
      cursor = response?.nextCursor || null;
      if (!cursor) break;
      if (page === MODEL_LIST_PAGE_LIMIT - 1) truncated = true;
    }
    state.models = models;
    state.modelListStatus = truncated ? "partial" : "ready";
    state.modelListError = truncated
      ? `Model list stopped after ${MODEL_LIST_PAGE_LIMIT} page(s); additional models may be available.`
      : "";
    if (truncated && showErrors) addSystemMessage(state.modelListError);
  } catch (error) {
    state.modelListStatus = "failed";
    state.modelListError = error.message;
    if (showErrors) addSystemMessage(`Model list refresh failed: ${error.message}`);
  }
  renderRuntimeConstitution();
}

async function refreshRateLimits(showErrors = false) {
  const settingsProjection = providerSettingsProjection();
  if (settingsProjection.usage?.providerQuota?.canRead !== true && settingsProjection.usage?.canReadRateLimits !== true && !hasCapabilityForMutation("usage", "canReadRateLimits")) {
    state.rateLimitsStatus = "unavailable";
    renderRuntimeConstitution();
    return;
  }
  state.rateLimitsStatus = "loading";
  renderRuntimeConstitution();
  try {
    state.rateLimits = await rpc("account/rateLimits/read", {});
    state.rateLimitsStatus = "ready";
    state.rateLimitsError = "";
    state.rateLimitsObservedAt = Date.now();
  } catch (error) {
    state.rateLimitsStatus = "failed";
    state.rateLimitsError = error.message;
    if (showErrors) addSystemMessage(`Quota refresh failed: ${error.message}`);
  }
  renderRuntimeConstitution();
}

async function refreshConfigRequirements(showErrors = false) {
  state.configRequirementsStatus = "loading";
  renderRuntimeConstitution();
  try {
    const response = await rpc("configRequirements/read", {});
    state.configRequirements = response || { requirements: null };
    state.configRequirementsStatus = response?.requirements ? "ready" : "none";
    state.configRequirementsError = "";
    reconcileAccessOverridesWithRequirements();
  } catch (error) {
    state.configRequirementsStatus = "failed";
    state.configRequirementsError = error.message;
    if (showErrors) addSystemMessage(`Config requirements refresh failed: ${error.message}`);
  }
  renderRuntimeConstitution();
}

function maybeAutoScrollBottom() {
  if (state.isBulkRendering) return;
  els.transcript.scrollTop = els.transcript.scrollHeight;
}

function rerenderCurrentHistory(options = {}) {
  if (state.historyKind === "thread" && state.historyData) {
    renderThreadHistory(state.historyData, { ...options, keepPagination: true });
    return;
  }
  if (state.historyKind === "stored" && state.historyData?.snapshot && state.historyData?.threadId) {
    renderStoredTranscript(state.historyData.snapshot, state.historyData.threadId, { ...options, keepPagination: true });
  }
}

function logicalHistoryKey(threadId = "") {
  return `thread:${String(threadId || state.threadId || "").trim()}`;
}

function ensureHistoryWindow(logicalThreadKey, options = {}) {
  const key = String(logicalThreadKey || "").trim();
  if (!key) return state.historyWindow;
  if (state.historyWindow.logicalThreadKey !== key) {
    state.historyWindow = {
      logicalThreadKey: key,
      mode: "tail",
      loadedUserMessagePages: 1,
      renderRevision: state.historyWindow.renderRevision + 1,
    };
    state.loadedUserMessagePages = 1;
    return state.historyWindow;
  }
  if (!options.keepPagination && options.resetWindow) {
    state.historyWindow.mode = "tail";
    state.historyWindow.loadedUserMessagePages = 1;
    state.historyWindow.renderRevision += 1;
  }
  state.loadedUserMessagePages = state.historyWindow.loadedUserMessagePages;
  return state.historyWindow;
}

function visibleUserMessageCount(totalUserMessages) {
  const total = Math.max(0, Number(totalUserMessages) || 0);
  if (!total) return 0;
  if (state.historyWindow.mode === "all") return total;
  return Math.min(total, Math.max(1, state.historyWindow.loadedUserMessagePages) * USER_MESSAGE_PAGE_SIZE);
}

async function refreshCurrentHistorySource() {
  const currentThreadId = String(state.threadId || "").trim();
  if (!currentThreadId) return;
  const storedSnapshot = renderedStoredSnapshotForThread(currentThreadId);
  if (
    state.historyKind === "stored" &&
    storedSnapshot?.presentationModel &&
    bridge?.readStoredThreadTranscript
  ) {
    const snapshot = await readStoredThreadTranscript(currentThreadId, state.sourceHome, state.sessionFilePath);
    if (String(state.threadId || "") !== currentThreadId || !snapshot?.entries) return;
    state.historyKind = "stored";
    state.historyKey = logicalHistoryKey(currentThreadId);
    state.historyData = { snapshot, threadId: currentThreadId };
    return;
  }
  if (state.connected && (hasCapability("threads", "canRead") || hasCapability("threads", "canResume"))) {
    const result = await readThreadById(currentThreadId);
    if (String(state.threadId || "") !== currentThreadId || !result?.thread) return;
    state.historyKind = "thread";
    state.historyKey = logicalHistoryKey(currentThreadId);
    state.historyData = result.thread;
    return;
  }
  if (state.historyKind === "stored" && state.historyData?.snapshot && bridge?.readStoredThreadTranscript) {
    const snapshot = await readStoredThreadTranscript(currentThreadId, state.sourceHome, state.sessionFilePath);
    if (String(state.threadId || "") !== currentThreadId || !snapshot?.entries) return;
    state.historyData = { snapshot, threadId: currentThreadId };
  }
}

async function expandHistoryWindow(mode = "expanded") {
  if (mode === "all") {
    state.historyWindow.mode = "all";
  } else {
    state.historyWindow.mode = "expanded";
    state.historyWindow.loadedUserMessagePages += 1;
  }
  state.loadedUserMessagePages = state.historyWindow.loadedUserMessagePages;
  state.historyWindow.renderRevision += 1;
  let refreshError = "";
  try {
    await refreshCurrentHistorySource();
  } catch (error) {
    refreshError = error.message;
  }
  rerenderCurrentHistory({ preserveViewport: true, resetSession: false });
  if (refreshError) addSystemMessage(`History refresh before expansion failed; showing newest local transcript: ${refreshError}`);
}

function renderLoadMoreControl(hiddenUserMessageCount) {
  if (!Number.isFinite(hiddenUserMessageCount) || hiddenUserMessageCount <= 0) return;
  const loadCount = Math.min(USER_MESSAGE_PAGE_SIZE, hiddenUserMessageCount);
  const wrapper = document.createElement("div");
  wrapper.className = "transcript-load-more";
  const label = document.createElement("span");
  label.className = "transcript-load-more-label";
  label.textContent = `${hiddenUserMessageCount} older user message${hiddenUserMessageCount === 1 ? "" : "s"} hidden`;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary transcript-load-more-button";
  button.textContent = `Load ${loadCount} more`;
  button.addEventListener("click", () => expandHistoryWindow("expanded"));
  const loadAllButton = document.createElement("button");
  loadAllButton.type = "button";
  loadAllButton.className = "secondary transcript-load-more-button";
  loadAllButton.textContent = "Load all";
  loadAllButton.addEventListener("click", () => expandHistoryWindow("all"));
  const actions = document.createElement("span");
  actions.className = "transcript-load-more-actions";
  actions.append(button, loadAllButton);
  wrapper.append(label, actions);
  els.transcript.appendChild(wrapper);
}

function respond(id, result) {
  if (!bridge) return Promise.reject(new Error("Codex surface bridge is unavailable."));
  return bridge.respond(id, result);
}

function respondRequest(key, result) {
  if (!bridge) return Promise.reject(new Error("Codex surface bridge is unavailable."));
  if (typeof bridge.respondRequest === "function") return bridge.respondRequest(key, result);
  return bridge.respond(key, result);
}

function codexItemKey(threadId, turnId, itemId) {
  return [threadId, turnId, itemId].map((value) => String(value || "")).join(":");
}

function rememberCodexItem(context, item) {
  if (!item?.id) return;
  const threadId = String(context?.threadId || state.threadId || "");
  const turnId = String(context?.turnId || item.turnId || state.turnId || "");
  const itemId = String(context?.itemId || item.id || "");
  const enriched = { ...item, threadId, turnId, id: itemId };
  state.codexItemMap.set(codexItemKey(threadId, turnId, itemId), enriched);
  state.codexItemMap.set(`item:${itemId}`, enriched);
}

function itemForRequest(request) {
  const params = request?.params || {};
  const threadId = String(request?.threadId || params.threadId || state.threadId || "");
  const turnId = String(request?.turnId || params.turnId || state.turnId || "");
  const itemId = String(request?.itemId || params.itemId || params.callId || "");
  return state.codexItemMap.get(codexItemKey(threadId, turnId, itemId)) || state.codexItemMap.get(`item:${itemId}`) || null;
}

function requestMessageId(request) {
  return `server_request_${String(request?.key || request?.requestId || Date.now())}`;
}

function requestStatusLabel(status) {
  if (status === "pending") return "waiting";
  if (status === "responding") return "sent";
  if (status === "resolved") return "resolved";
  if (status === "declined") return "declined";
  if (status === "canceled") return "canceled";
  if (status === "timed-out") return "timed out";
  if (status === "connection-closed") return "connection closed";
  return status || "unknown";
}

function decisionAllowed(params, decision) {
  const available = Array.isArray(params?.availableDecisions) ? params.availableDecisions : null;
  if (!available || !available.length) return true;
  return available.some((entry) => {
    if (typeof entry === "string") return entry === decision;
    return Boolean(entry && typeof entry === "object" && Object.prototype.hasOwnProperty.call(entry, decision));
  });
}

function appendRequestLine(parent, label, value, options = {}) {
  const text = typeof value === "string" ? value : compactValue(value, options.maxLength || 1600);
  if (!text) return;
  const row = document.createElement("div");
  row.className = "codex-request-line";
  const key = document.createElement("span");
  key.className = "codex-request-line-key";
  key.textContent = label;
  const body = document.createElement(options.pre ? "pre" : "span");
  body.className = options.mono ? "mono codex-request-line-value" : "codex-request-line-value";
  renderTypedContent(body, text);
  row.append(key, body);
  parent.appendChild(row);
}

function createRequestButton(label, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className || "secondary";
  button.textContent = label;
  if (typeof onClick === "function") button.addEventListener("click", onClick);
  return button;
}

async function submitRequestResponse(request, result, button) {
  const key = String(request?.key || "");
  if (!key) return;
  if (button) button.disabled = true;
  try {
    const response = await respondRequest(key, result);
    if (response?.request) updateServerRequest(response.request);
  } catch (error) {
    addSystemMessage(`Codex request response failed: ${error.message}`);
    if (button) button.disabled = false;
  }
}

function commandText(params) {
  if (Array.isArray(params?.command)) return params.command.join(" ");
  return String(params?.command || "");
}

function fileChangeTextForRequest(request) {
  const params = request?.params || {};
  if (params.fileChanges && typeof params.fileChanges === "object") {
    return Object.entries(params.fileChanges)
      .map(([filePath, change]) => `${filePath}\n${compactValue(change, 1200)}`)
      .join("\n\n");
  }
  const item = itemForRequest(request);
  if (item?.type === "fileChange") return thoughtItemBody(item);
  if (params.grantRoot) return `Requested write grant root: ${params.grantRoot}`;
  return "";
}

function renderCommandRequestDetails(request, details, actions) {
  const params = request.params || {};
  const network = params.networkApprovalContext || null;
  if (network) {
    appendRequestLine(details, "Network", `${network.protocol || "network"}://${network.host || "unknown host"}`, { mono: true });
  }
  appendRequestLine(details, "cwd", params.cwd || "", { mono: true });
  appendRequestLine(details, "command", commandText(params), { mono: true, pre: true });
  appendRequestLine(details, "reason", params.reason || "");
  appendRequestLine(details, "permissions", params.additionalPermissions || "", { pre: true });

  const decisions = [
    ["Approve once", "accept", { decision: "accept" }, ""],
    ["Approve for session", "acceptForSession", { decision: "acceptForSession" }, ""],
    ["Decline", "decline", { decision: "decline" }, "secondary"],
    ["Cancel", "cancel", { decision: "cancel" }, "secondary"],
  ];
  for (const [label, decision, result, className] of decisions) {
    if (!decisionAllowed(params, decision)) continue;
    actions.appendChild(createRequestButton(label, className, (event) => submitRequestResponse(request, result, event.currentTarget)));
  }
}

function renderLegacyCommandRequestDetails(request, details, actions) {
  const params = request.params || {};
  appendRequestLine(details, "cwd", params.cwd || "", { mono: true });
  appendRequestLine(details, "command", commandText(params), { mono: true, pre: true });
  appendRequestLine(details, "reason", params.reason || "");
  actions.appendChild(createRequestButton("Approve once", "", (event) => submitRequestResponse(request, { decision: "approved" }, event.currentTarget)));
  actions.appendChild(createRequestButton("Approve for session", "", (event) => submitRequestResponse(request, { decision: "approved_for_session" }, event.currentTarget)));
  actions.appendChild(createRequestButton("Deny", "secondary", (event) => submitRequestResponse(request, { decision: "denied" }, event.currentTarget)));
  actions.appendChild(createRequestButton("Abort", "secondary", (event) => submitRequestResponse(request, { decision: "abort" }, event.currentTarget)));
}

function renderFileChangeRequestDetails(request, details, actions) {
  const params = request.params || {};
  appendRequestLine(details, "reason", params.reason || "");
  appendRequestLine(details, "grant root", params.grantRoot || "", { mono: true });
  const diffText = fileChangeTextForRequest(request);
  appendRequestLine(details, diffText ? "changes" : "changes unavailable", diffText || "Diff unavailable. Open details, decline, or cancel.", {
    mono: true,
    pre: true,
  });
  if (!diffText && request.method === "item/fileChange/requestApproval") {
    actions.appendChild(createRequestButton("Decline", "secondary", (event) => submitRequestResponse(request, { decision: "decline" }, event.currentTarget)));
    actions.appendChild(createRequestButton("Cancel turn", "secondary", (event) => submitRequestResponse(request, { decision: "cancel" }, event.currentTarget)));
    return;
  }
  actions.appendChild(createRequestButton("Approve once", "", (event) => submitRequestResponse(request, { decision: request.method === "applyPatchApproval" ? "approved" : "accept" }, event.currentTarget)));
  if (request.method === "item/fileChange/requestApproval") {
    actions.appendChild(createRequestButton("Approve for session", "", (event) => submitRequestResponse(request, { decision: "acceptForSession" }, event.currentTarget)));
    actions.appendChild(createRequestButton("Decline", "secondary", (event) => submitRequestResponse(request, { decision: "decline" }, event.currentTarget)));
    actions.appendChild(createRequestButton("Cancel turn", "secondary", (event) => submitRequestResponse(request, { decision: "cancel" }, event.currentTarget)));
  } else {
    actions.appendChild(createRequestButton("Deny", "secondary", (event) => submitRequestResponse(request, { decision: "denied" }, event.currentTarget)));
    actions.appendChild(createRequestButton("Abort", "secondary", (event) => submitRequestResponse(request, { decision: "abort" }, event.currentTarget)));
  }
}

function renderUserInputRequestDetails(request, details, actions) {
  const questions = Array.isArray(request.params?.questions) ? request.params.questions : [];
  const form = document.createElement("form");
  form.className = "codex-request-form";
  for (const question of questions) {
    const field = document.createElement("label");
    field.className = "codex-request-field";
    const title = document.createElement("span");
    title.textContent = question.header || question.question || question.id || "Question";
    const prompt = document.createElement("small");
    prompt.textContent = question.question || "";
    field.append(title, prompt);
    if (Array.isArray(question.options) && question.options.length) {
      const select = document.createElement("select");
      select.dataset.questionId = question.id || "";
      for (const option of question.options) {
        const opt = document.createElement("option");
        opt.value = option.id || option.label || "";
        opt.textContent = option.description ? `${option.label} - ${option.description}` : option.label || "Option";
        select.appendChild(opt);
      }
      field.appendChild(select);
    } else {
      const input = document.createElement(question.isSecret ? "input" : "textarea");
      input.dataset.questionId = question.id || "";
      if (question.isSecret) input.type = "password";
      input.placeholder = question.isOther ? "Other answer" : "Answer";
      field.appendChild(input);
    }
    form.appendChild(field);
  }
  const submit = createRequestButton("Submit answers", "", null);
  submit.addEventListener("click", (event) => {
    event.preventDefault();
    const answers = {};
    for (const input of form.querySelectorAll("[data-question-id]")) {
      const id = input.dataset.questionId;
      if (!id) continue;
      answers[id] = { answers: [String(input.value || "")] };
    }
    submitRequestResponse(request, { answers }, submit);
  });
  actions.appendChild(submit);
  details.appendChild(form);
}

function renderMcpRequestDetails(request, details, actions) {
  const params = request.params || {};
  appendRequestLine(details, "server", params.serverName || "");
  appendRequestLine(details, "message", params.message || "");
  if (params.mode === "url") {
    appendRequestLine(details, "url", params.url || "", { mono: true });
    actions.appendChild(createRequestButton("Open URL", "secondary", () => {
      openTypedUrl(String(params.url || ""));
    }));
  } else {
    appendRequestLine(details, "schema", params.requestedSchema || "", { mono: true, pre: true });
  }
  actions.appendChild(createRequestButton("Accept", "", (event) => submitRequestResponse(request, { action: "accept", content: params.mode === "form" ? {} : null, _meta: null }, event.currentTarget)));
  actions.appendChild(createRequestButton("Decline", "secondary", (event) => submitRequestResponse(request, { action: "decline", content: null, _meta: null }, event.currentTarget)));
  actions.appendChild(createRequestButton("Cancel", "secondary", (event) => submitRequestResponse(request, { action: "cancel", content: null, _meta: null }, event.currentTarget)));
}

function renderPermissionRequestDetails(request, details, actions) {
  const params = request.params || {};
  appendRequestLine(details, "cwd", params.cwd || "", { mono: true });
  appendRequestLine(details, "reason", params.reason || "");
  appendRequestLine(details, "permissions", params.permissions || "", { mono: true, pre: true });
  actions.appendChild(createRequestButton("Grant for turn", "", (event) => submitRequestResponse(request, { permissions: params.permissions || {}, scope: "turn" }, event.currentTarget)));
  actions.appendChild(createRequestButton("Deny", "secondary", (event) => submitRequestResponse(request, { permissions: {}, scope: "turn" }, event.currentTarget)));
}

function renderGenericRequestDetails(request, details) {
  appendRequestLine(details, "method", request.method || "", { mono: true });
  appendRequestLine(details, "params", request.params || "", { mono: true, pre: true });
  if (request.errorSummary) appendRequestLine(details, "error", request.errorSummary);
}

function renderServerRequest(request) {
  if (!request?.key) return;
  state.serverRequests.set(request.key, request);
  renderRuntimeConstitution();
  const node = ensureMessage(requestMessageId(request), "system", request.title || "Codex request");
  node.dataset.requestKey = request.key;
  const bubble = node.querySelector(".bubble");
  bubble.innerHTML = "";

  const card = document.createElement("section");
  card.className = `codex-request-card ${request.riskCategory || "unknown"} ${request.status || "pending"}`;
  const header = document.createElement("div");
  header.className = "codex-request-header";
  const title = document.createElement("strong");
  title.textContent = request.title || request.method || "Codex request";
  const status = document.createElement("span");
  status.className = "codex-request-status";
  status.textContent = requestStatusLabel(request.status);
  header.append(title, status);
  card.appendChild(header);

  const meta = document.createElement("div");
  meta.className = "codex-request-meta";
  meta.textContent = [request.riskCategory, request.summary].filter(Boolean).join(" · ");
  card.appendChild(meta);

  const details = document.createElement("div");
  details.className = "codex-request-details";
  const actions = document.createElement("div");
  actions.className = "codex-request-actions";
  const isPending = request.status === "pending";

  if (request.method === "item/commandExecution/requestApproval") renderCommandRequestDetails(request, details, isPending ? actions : document.createElement("div"));
  else if (request.method === "execCommandApproval") renderLegacyCommandRequestDetails(request, details, isPending ? actions : document.createElement("div"));
  else if (request.method === "item/fileChange/requestApproval" || request.method === "applyPatchApproval") renderFileChangeRequestDetails(request, details, isPending ? actions : document.createElement("div"));
  else if (request.method === "item/tool/requestUserInput") renderUserInputRequestDetails(request, details, isPending ? actions : document.createElement("div"));
  else if (request.method === "mcpServer/elicitation/request") renderMcpRequestDetails(request, details, isPending ? actions : document.createElement("div"));
  else if (request.method === "item/permissions/requestApproval") renderPermissionRequestDetails(request, details, isPending ? actions : document.createElement("div"));
  else renderGenericRequestDetails(request, details);

  if (!isPending) {
    appendRequestLine(details, "response", request.responseSummary || request.errorSummary || requestStatusLabel(request.status));
  }

  card.appendChild(details);
  if (isPending && actions.childElementCount) card.appendChild(actions);
  bubble.appendChild(card);
  maybeAutoScrollBottom();
}

function updateServerRequest(request) {
  if (!request?.key) return;
  const previous = state.serverRequests.get(request.key) || {};
  const next = { ...previous, ...request };
  state.serverRequests.set(request.key, next);
  renderRuntimeConstitution();
  renderServerRequest(next);
}

function focusServerRequest(key) {
  const node = els.transcript.querySelector(`[data-request-key="${CSS.escape(String(key || ""))}"]`);
  if (!node) return;
  node.scrollIntoView({ block: "center", behavior: "smooth" });
  node.classList.add("request-focus-pulse");
  setTimeout(() => node.classList.remove("request-focus-pulse"), 900);
}

function storedTranscriptReadLimit() {
  if (state.historyWindow.mode === "all") return 2000;
  if (state.historyWindow.mode === "expanded") {
    return Math.min(2000, Math.max(800, state.historyWindow.loadedUserMessagePages * 800));
  }
  return 800;
}

async function readStoredThreadTranscript(threadId, sourceHome = "", sessionFilePath = "", limit = storedTranscriptReadLimit()) {
  if (!bridge?.readStoredThreadTranscript || !project?.id || !threadId) return null;
  return bridge.readStoredThreadTranscript(project.id, threadId, sourceHome, sessionFilePath, limit);
}

function storedMessageText(message) {
  return String(message?.text || message?.message || "").trim();
}

function storedTurnUserMessageCount(turn) {
  return Array.isArray(turn?.userMessages) ? turn.userMessages.length : 0;
}

function storedStartTurnIndex(turns, hiddenUserMessages) {
  if (!hiddenUserMessages) return 0;
  let seen = 0;
  for (let index = 0; index < turns.length; index += 1) {
    const count = storedTurnUserMessageCount(turns[index]);
    if (seen + count > hiddenUserMessages) return index;
    seen += count;
  }
  return 0;
}

function renderedStoredSnapshotForThread(threadId) {
  const id = String(threadId || state.threadId || "").trim();
  if (!id) return null;
  if (state.historyKind === "stored" && String(state.historyData?.threadId || "") === id) {
    return state.historyData.snapshot || null;
  }
  return null;
}

function shouldPreserveStoredTranscriptOnLiveAttach(thread) {
  const snapshot = renderedStoredSnapshotForThread(thread?.id || state.threadId);
  return Boolean(snapshot?.presentationModel);
}

function renderStoredPresentationModel(model) {
  const turns = Array.isArray(model?.turns) ? model.turns : [];
  if (!turns.length) return false;
  const totalUserMessages = turns.reduce((sum, turn) => sum + storedTurnUserMessageCount(turn), 0);
  const visibleUserMessages = visibleUserMessageCount(totalUserMessages);
  const hiddenUserMessages = Math.max(0, totalUserMessages - visibleUserMessages);
  const startTurnIndex = storedStartTurnIndex(turns, hiddenUserMessages);
  const visibleTurns = turns.slice(startTurnIndex);

  renderLoadMoreControl(hiddenUserMessages);

  for (let index = 0; index < visibleTurns.length; index += 1) {
    const turn = visibleTurns[index];
    const turnKey = String(turn.turnKey || turn.turnId || `stored_turn_${startTurnIndex + index + 1}`);
    for (let messageIndex = 0; messageIndex < (turn.userMessages || []).length; messageIndex += 1) {
      const message = turn.userMessages[messageIndex];
      const id = String(message.id || `stored_user_${turnKey}_${messageIndex}`);
      setMessageText(id, "user", storedMessageText(message), "You");
    }
    for (let messageIndex = 0; messageIndex < (turn.systemMessages || []).length; messageIndex += 1) {
      const message = turn.systemMessages[messageIndex];
      const id = String(message.id || `stored_system_${turnKey}_${messageIndex}`);
      setMessageText(id, "system", storedMessageText(message), "System");
    }
    const thoughtItems = Array.isArray(turn.thoughtItems) ? turn.thoughtItems : [];
    if (thoughtItems.length) {
      upsertThoughtProcess(turnKey, thoughtItems.map((item, itemIndex) => ({
        ...item,
        id: String(item.id || `stored_thought_${turnKey}_${itemIndex}`),
        turnId: turn.turnId || turnKey,
      })), { merge: false });
    }
    for (let messageIndex = 0; messageIndex < (turn.assistantFinalMessages || []).length; messageIndex += 1) {
      const message = turn.assistantFinalMessages[messageIndex];
      const id = String(message.id || `stored_assistant_${turnKey}_${messageIndex}`);
      setMessageText(id, "assistant", storedMessageText(message), "Codex");
    }
  }

  const visibleOrphans = (model.orphanItems || []).filter(Boolean);
  if (visibleOrphans.length) {
    upsertThoughtProcess("stored_orphans", visibleOrphans, { merge: false });
  }
  return true;
}

function renderStoredTranscript(snapshot, threadId, options = {}) {
  const historyKey = logicalHistoryKey(threadId);
  ensureHistoryWindow(historyKey, options);
  state.historyKind = "stored";
  state.historyKey = historyKey;
  state.historyData = { snapshot, threadId };

  const previousScrollTop = options.preserveViewport ? els.transcript.scrollTop : 0;
  const previousScrollHeight = options.preserveViewport ? els.transcript.scrollHeight : 0;

  state.isBulkRendering = true;
  clearRenderedThreadState({ resetSession: options.resetSession !== false });
  state.threadId = threadId;
  state.liveAttached = false;
  const title = String(snapshot?.title || "Stored transcript");
  addSystemMessage(`Loaded ${title} from local Codex session logs. Live attach is running in background.`);
  if (renderStoredPresentationModel(snapshot?.presentationModel)) {
    setComposerEnabled(false, "Read-only transcript while connecting this thread to live Codex…");
    state.isBulkRendering = false;
    if (options.preserveViewport) {
      const nextScrollHeight = els.transcript.scrollHeight;
      const delta = Math.max(0, nextScrollHeight - previousScrollHeight);
      els.transcript.scrollTop = Math.max(0, previousScrollTop + delta);
    } else {
      els.transcript.scrollTop = els.transcript.scrollHeight;
    }
    renderRuntimeConstitution();
    return;
  }
  const allEntries = Array.isArray(snapshot?.entries) ? snapshot.entries : [];
  const userEntryIndices = [];
  for (let index = 0; index < allEntries.length; index += 1) {
    if (allEntries[index]?.role === "user") userEntryIndices.push(index);
  }
  const totalUserMessages = userEntryIndices.length;
  const visibleUserMessages = visibleUserMessageCount(totalUserMessages);
  const hiddenUserMessages = Math.max(0, totalUserMessages - visibleUserMessages);
  const startEntryIndex = totalUserMessages && hiddenUserMessages > 0
    ? userEntryIndices[Math.max(0, totalUserMessages - visibleUserMessages)] ?? 0
    : 0;
  const entries = allEntries.slice(startEntryIndex);

  renderLoadMoreControl(hiddenUserMessages);

  let thoughtBuffer = [];
  let thoughtBlockIndex = 0;
  function flushThoughtBuffer() {
    if (!thoughtBuffer.length) return;
    thoughtBlockIndex += 1;
    upsertThoughtProcess(`stored_${thoughtBlockIndex}`, thoughtBuffer, { merge: false });
    thoughtBuffer = [];
  }
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const absoluteIndex = startEntryIndex + index;
    if (isStoredThoughtAssistantEntry(entry)) {
      thoughtBuffer.push({
        id: String(entry.id || `stored_thought_${absoluteIndex + 1}`),
        type: "agentMessage",
        phase: normalizePhase(entry.phase || "commentary"),
        text: String(entry.text || ""),
      });
      continue;
    }
    flushThoughtBuffer();
    const role = entry.role === "assistant" || entry.role === "user" ? entry.role : "system";
    const roleTitle = role === "assistant" ? "Codex" : role === "user" ? "You" : "System";
    setMessageText(String(entry.id || `stored_${absoluteIndex + 1}`), role, entry.text || "", roleTitle);
  }
  flushThoughtBuffer();
  setComposerEnabled(false, "Read-only transcript while connecting this thread to live Codex…");
  state.isBulkRendering = false;
  if (options.preserveViewport) {
    const nextScrollHeight = els.transcript.scrollHeight;
    const delta = Math.max(0, nextScrollHeight - previousScrollHeight);
    els.transcript.scrollTop = Math.max(0, previousScrollTop + delta);
  } else {
    els.transcript.scrollTop = els.transcript.scrollHeight;
  }
  renderRuntimeConstitution();
}

async function loadExistingThreadOrStartNew() {
  setNotice("Preparing Codex session…", "Starting a fresh Codex thread for this workspace.", { showNewThread: true });
  await startNewThread();
}

function normalizeThreadReadResult(result, requestedThreadId) {
  if (!result || typeof result !== "object") return null;
  const candidate = typeof result.thread === "object" && result.thread ? result.thread : result;
  const threadId = String(candidate.id || "");
  if (!threadId) return null;
  if (requestedThreadId && threadId !== requestedThreadId) {
    const candidateAlt = String(candidate.threadId || "");
    if (!candidateAlt || candidateAlt !== requestedThreadId) return null;
  }
  return {
    thread: candidate,
    model: String(result.model || ""),
  };
}

async function resumeThreadById(threadId) {
  const attempts = [
    { method: "thread/resume", params: { threadId } },
    { method: "thread/resume", params: { threadId, cwd: connection?.workspaceRoot || project?.repoPath || null } },
  ];
  let lastError = null;
  for (const attempt of attempts) {
    try {
      const result = await rpc(attempt.method, attempt.params);
      const normalized = normalizeThreadReadResult(result, threadId);
      if (normalized?.thread?.id) return normalized;
      lastError = new Error(`Unexpected response from ${attempt.method}.`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Unable to resume Codex thread.");
}

async function readThreadById(threadId) {
  const attempts = [
    { method: "thread/read", params: { threadId, includeTurns: true } },
    { method: "thread/read", params: { threadId } },
  ];
  let lastError = null;
  for (const attempt of attempts) {
    try {
      const result = await rpc(attempt.method, attempt.params);
      const normalized = normalizeThreadReadResult(result, threadId);
      if (normalized?.thread?.id) return normalized;
      lastError = new Error(`Unexpected response from ${attempt.method}.`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Unable to read Codex thread.");
}

async function attachLiveThread(threadId) {
  const requestedThreadId = String(threadId || "").trim();
  if (!requestedThreadId) throw new Error("Missing Codex thread id.");
  if (!state.connected) throw new Error("Codex surface is not connected yet.");
  if (!hasCapability("threads", "canResume") && !hasCapability("threads", "canRead")) {
    throw new Error("Active Codex runtime does not expose live thread read/resume capability.");
  }
  let result = null;
  try {
    result = await resumeThreadById(requestedThreadId);
  } catch {
    result = await readThreadById(requestedThreadId);
  }
  return result;
}

function applyLiveThreadResult(result) {
  if (!result?.thread) return;
  if (shouldPreserveStoredTranscriptOnLiveAttach(result.thread)) {
    bindThread(result.thread, result.model, { liveAttached: true });
    state.historyKind = "stored";
    renderRuntimeConstitution();
    return;
  }
  renderThreadHistory(result.thread);
  bindThread(result.thread, result.model, { liveAttached: true });
}

async function openThreadHybrid(threadId, sourceHome = "", sessionFilePath = "", titleHint = "") {
  const requestedThreadId = String(threadId || "").trim();
  if (!requestedThreadId) throw new Error("Missing Codex thread id.");
  const openRequestId = state.openRequestId + 1;
  state.openRequestId = openRequestId;
  state.threadId = requestedThreadId;
  state.sourceHome = String(sourceHome || "");
  state.sessionFilePath = String(sessionFilePath || "");
  state.liveAttached = false;
  state.tokenUsage = null;
  state.tokenUsageStatus = "loading";
  state.tokenUsageObservedAt = 0;
  clearRenderedThreadState();
  const payloadTitle = requestedThreadId === String(payload.initialThreadId || "") ? payload.initialThreadTitle : "";
  updateSurfaceHeader(titleHint || payloadTitle || requestedThreadId, workspaceText());
  await reportThreadState("requested", {
    threadId: requestedThreadId,
    sourceHome: state.sourceHome,
    sessionFilePath: state.sessionFilePath,
    title: titleHint || payloadTitle || requestedThreadId,
    evidence: "openThreadHybrid",
  });
  addSystemMessage(`Loading thread ${requestedThreadId}…`);
  setComposerEnabled(false, "Loading stored transcript and attaching live Codex session…");
  let renderedStored = false;
  try {
    const snapshot = await readStoredThreadTranscript(requestedThreadId, state.sourceHome, sessionFilePath);
    if (openRequestId !== state.openRequestId) return;
    if (snapshot?.entries?.length) {
      updateSurfaceHeader(snapshot.title || titleHint || payloadTitle || requestedThreadId, workspaceText());
      renderStoredTranscript(snapshot, requestedThreadId);
      renderedStored = true;
      await reportThreadState("rendered_stored", {
        threadId: requestedThreadId,
        sourceHome: state.sourceHome,
        sessionFilePath: state.sessionFilePath,
        title: snapshot.title || titleHint || payloadTitle || requestedThreadId,
        evidence: "stored-transcript",
      });
    }
  } catch (error) {
    if (openRequestId !== state.openRequestId) return;
    addSystemMessage(`Stored transcript read failed: ${error.message}`);
  }

  try {
    const liveResult = await attachLiveThread(requestedThreadId);
    if (openRequestId !== state.openRequestId) return;
    applyLiveThreadResult(liveResult);
    await reportThreadState("attached_live", {
      threadId: requestedThreadId,
      sourceHome: state.sourceHome,
      sessionFilePath: state.sessionFilePath,
      title: liveResult?.thread?.title || liveResult?.thread?.name || state.threadTitle || requestedThreadId,
      evidence: "app-server-thread-attach",
    });
  } catch (error) {
    if (openRequestId !== state.openRequestId) return;
    const message = String(error?.message || "");
    if (message.toLowerCase().includes("not connected yet")) {
      if (renderedStored) {
        addSystemMessage(`Stored transcript rendered. Live attach unavailable: ${message}`);
        await reportThreadState("failed", {
          threadId: requestedThreadId,
          sourceHome: state.sourceHome,
          sessionFilePath: state.sessionFilePath,
          title: state.threadTitle || titleHint || payloadTitle || requestedThreadId,
          evidence: "stored-render-live-unavailable",
          errorDescription: message,
        });
        setComposerEnabled(false, "Stored transcript rendered. Live Codex attach is unavailable.");
        return;
      }
      setComposerEnabled(false, "Connecting live Codex session for this thread…");
      return;
    }
    if (!renderedStored) {
      await reportThreadState("failed", {
        threadId: requestedThreadId,
        sourceHome: state.sourceHome,
        sessionFilePath: state.sessionFilePath,
        title: titleHint || payloadTitle || requestedThreadId,
        evidence: "app-server-thread-attach",
        errorDescription: message,
      });
      throw error;
    }
    addSystemMessage(`Live attach failed for ${requestedThreadId}: ${message}`);
    await reportThreadState("failed", {
      threadId: requestedThreadId,
      sourceHome: state.sourceHome,
      sessionFilePath: state.sessionFilePath,
      title: state.threadTitle || titleHint || payloadTitle || requestedThreadId,
      evidence: "live-attach-after-stored-render",
      errorDescription: message,
    });
    setComposerEnabled(false, "Live Codex attach failed for this thread. Select another thread or retry.");
  }
}

function bindThread(thread, modelName = "", options = {}) {
  state.threadId = thread?.id || "";
  state.liveAttached = options.liveAttached !== false;
  state.activeModel = String(modelName || state.activeModel || project?.codex?.model || "");
  const title = thread?.title || thread?.name || thread?.preview || state.threadTitle || payload.initialThreadTitle || state.threadId;
  updateSurfaceHeader(title, workspaceText());
  setComposerEnabled(state.liveAttached, state.liveAttached ? "" : "Read-only mode");
  setNotice(
    "Codex session ready",
    thread?.preview ? `Resumed thread: ${thread.preview}` : "Managed local Codex app-server is connected.",
    { success: true, showNewThread: true },
  );
}

function isThoughtItem(item) {
  return Boolean(item?.type && THOUGHT_ITEM_TYPES.has(item.type));
}

function isToolLikeThoughtItem(item) {
  return Boolean(item?.type && TOOL_LIKE_THOUGHT_TYPES.has(item.type));
}

function formatCommandExecutionText(item) {
  const output = String(item?.aggregatedOutput || "");
  const preview = output.length > MAX_COMMAND_OUTPUT_CHARS
    ? `${output.slice(0, MAX_COMMAND_OUTPUT_CHARS)}\n… [${output.length - MAX_COMMAND_OUTPUT_CHARS} chars omitted]`
    : output;
  const status = [
    String(item?.status || ""),
    Number.isFinite(item?.exitCode) ? `exit ${item.exitCode}` : "",
    Number.isFinite(item?.durationMs) ? `${Math.max(0, Math.round(item.durationMs))}ms` : "",
  ].filter(Boolean).join(" · ");
  return [String(item?.command || ""), status, preview].filter(Boolean).join("\n");
}

function thoughtItemLabel(item) {
  if (!item) return "Thought";
  if (item.type === "reasoning") return "Reasoning";
  if (item.type === "agentMessage") return `Codex · ${normalizePhase(item.phase || "thought") || "thought"}`;
  if (item.type === "commandExecution") return `Shell · ${compactValue(item.command || "command", 88)}`;
  if (item.type === "mcpToolCall") return `Tool · ${item.server || "mcp"}:${item.tool || "tool"}`;
  if (item.type === "dynamicToolCall") return `Dynamic tool · ${item.tool || "tool"}`;
  if (item.type === "webSearch") return `Web search · ${compactValue(item.query || "query", 88)}`;
  if (item.type === "fileChange") {
    const changes = Array.isArray(item.changes) ? item.changes.length : 0;
    return `Patch · ${changes} file change${changes === 1 ? "" : "s"}`;
  }
  if (item.type === "imageGeneration") return "Image generation";
  if (item.type === "collabAgentToolCall") return `Sub-agent tool · ${item.tool || "call"}`;
  return String(item.type || "Thought");
}

function thoughtItemBody(item) {
  if (!item) return "";
  if (item.type === "agentMessage") {
    return String(item.text || item.message || "").trim();
  }
  if (item.type === "reasoning") {
    return [...(item.summary || []), ...(item.content || [])].filter(Boolean).join("\n").trim();
  }
  if (item.type === "commandExecution") {
    return formatCommandExecutionText(item).trim();
  }
  if (item.type === "fileChange") {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    const header = `${item.patchStatus || item.status || "completed"}`;
    if (!changes.length) return `${header} · no file changes listed`;
    const lines = changes.slice(0, 40).map((change) => {
      const kind = String(change?.kind || change?.type || "change");
      const relPath = String(change?.path || change?.relativePath || change?.file || "").trim();
      return `- ${kind}${relPath ? ` ${relPath}` : ""}`;
    });
    if (changes.length > lines.length) lines.push(`… ${changes.length - lines.length} more change entries`);
    const output = [item.stdout, item.stderr].filter(Boolean).join("\n").trim();
    return [header, lines.join("\n"), output].filter(Boolean).join("\n");
  }
  if (item.type === "mcpToolCall") {
    const header = `${item.server || "mcp"} · ${item.tool || "tool"} · ${item.status || "unknown"}`;
    const result = item.result ? `\nResult: ${compactValue(item.result, 1400)}` : "";
    const error = item.error ? `\nError: ${compactValue(item.error, 1400)}` : "";
    return `${header}${result}${error}`.trim();
  }
  if (item.type === "dynamicToolCall") {
    const header = `${item.tool || "tool"} · ${item.status || "unknown"}`;
    const body = item.contentItems ? `\nOutput: ${compactValue(item.contentItems, 1400)}` : "";
    return `${header}${body}`.trim();
  }
  if (item.type === "webSearch") {
    return `Query: ${item.query || ""}`.trim();
  }
  if (item.type === "imageGeneration") {
    return [item.revisedPrompt, item.result, item.savedPath].filter(Boolean).join("\n").trim();
  }
  if (item.type === "collabAgentToolCall") {
    const base = `${item.tool || "call"} · ${item.status || "unknown"}`;
    const prompt = item.prompt ? `\nPrompt: ${compactValue(item.prompt, 1200)}` : "";
    const targets = Array.isArray(item.receiverThreadIds) && item.receiverThreadIds.length
      ? `\nTargets: ${item.receiverThreadIds.join(", ")}`
      : "";
    return `${base}${prompt}${targets}`.trim();
  }
  return compactValue(item, 1800);
}

function thoughtMessageId(turnKey) {
  return `thought_${String(turnKey || "live")}`;
}

function rememberFinalMessageItem(itemId, turnKey = "") {
  const id = String(itemId || "").trim();
  const key = String(turnKey || state.turnId || "").trim();
  if (!id || !key) return;
  state.finalMessageByTurnKey.set(key, id);
  const thoughtNode = state.itemMap.get(thoughtMessageId(key));
  const finalNode = state.itemMap.get(id);
  if (thoughtNode && finalNode && finalNode.parentNode === els.transcript) {
    els.transcript.insertBefore(thoughtNode, finalNode);
  }
}

function positionThoughtProcessNode(turnKey, node) {
  const key = String(turnKey || "").trim();
  const finalId = state.finalMessageByTurnKey.get(key);
  const finalNode = finalId ? state.itemMap.get(finalId) : null;
  if (node && finalNode && finalNode.parentNode === els.transcript) {
    els.transcript.insertBefore(node, finalNode);
  }
}

function normalizeThoughtItemBody(item) {
  return String(thoughtItemBody(item) || "").trim();
}

function isEmptyThoughtSentinel(text) {
  const normalized = String(text || "").trim().toLowerCase();
  return !normalized ||
    normalized === "no reasoning text." ||
    normalized === "reasoning not available" ||
    normalized === "reasoning unavailable" ||
    normalized === "no reasoning available";
}

function shouldRenderThoughtItem(item) {
  if (!item) return false;
  if (isToolLikeThoughtItem(item)) return true;
  const body = normalizeThoughtItemBody(item);
  if (item.type === "reasoning" || isThoughtAssistantMessageItem(item)) return !isEmptyThoughtSentinel(body);
  return !isEmptyThoughtSentinel(body);
}

function projectThoughtItemsForRender(thoughtItems) {
  const visible = Array.isArray(thoughtItems) ? thoughtItems.filter(shouldRenderThoughtItem) : [];
  return {
    reasoningItems: visible.filter((item) => item?.type === "reasoning" || isThoughtAssistantMessageItem(item)),
    toolItems: visible.filter(isToolLikeThoughtItem),
    patchItems: visible.filter((item) => item?.type === "fileChange"),
    otherItems: visible.filter((item) =>
      item?.type !== "reasoning" &&
      item?.type !== "fileChange" &&
      !isThoughtAssistantMessageItem(item) &&
      !isToolLikeThoughtItem(item)),
    visibleCount: visible.length,
  };
}

function renderThoughtProcess(turnKey, thoughtItems, options = {}) {
  const messageId = thoughtMessageId(turnKey);
  const projection = projectThoughtItemsForRender(thoughtItems);
  if (!projection.visibleCount) {
    const existing = state.itemMap.get(messageId);
    if (existing) {
      existing.remove();
      state.itemMap.delete(messageId);
    }
    return;
  }
  const node = ensureMessage(messageId, "system", "Thought process");
  positionThoughtProcessNode(turnKey, node);
  const bubble = node.querySelector(".bubble");
  bubble.innerHTML = "";

  const root = document.createElement("details");
  root.className = "thought-process";
  if (options.open) root.open = true;
  const summary = document.createElement("summary");
  summary.textContent = projection.reasoningItems.length
    ? `Thought process (${projection.visibleCount})`
    : `Process evidence (${projection.visibleCount})`;
  root.appendChild(summary);

  const body = document.createElement("div");
  body.className = "thought-body";

  for (const item of projection.reasoningItems) {
    const block = document.createElement("div");
    block.className = "thought-reasoning";
    renderTypedContent(block, normalizeThoughtItemBody(item));
    body.appendChild(block);
  }

  if (projection.toolItems.length) {
    const toolsRoot = document.createElement("details");
    toolsRoot.className = "thought-tools";
    const toolsSummary = document.createElement("summary");
    toolsSummary.textContent = `Shell / tool calls (${projection.toolItems.length})`;
    toolsRoot.appendChild(toolsSummary);
    const toolsList = document.createElement("div");
    toolsList.className = "thought-tools-list";
    for (const item of projection.toolItems) {
      const toolDetail = document.createElement("details");
      toolDetail.className = "thought-tool";
      const toolSummary = document.createElement("summary");
      toolSummary.textContent = thoughtItemLabel(item);
      const toolBody = document.createElement("pre");
      toolBody.className = "thought-content";
      renderTypedContent(toolBody, normalizeThoughtItemBody(item) || "No details.");
      toolDetail.append(toolSummary, toolBody);
      toolsList.appendChild(toolDetail);
    }
    toolsRoot.appendChild(toolsList);
    body.appendChild(toolsRoot);
  }

  if (projection.patchItems.length) {
    const patchesRoot = document.createElement("details");
    patchesRoot.className = "thought-tools thought-patches";
    const patchesSummary = document.createElement("summary");
    patchesSummary.textContent = `Patches (${projection.patchItems.length})`;
    patchesRoot.appendChild(patchesSummary);
    const patchesList = document.createElement("div");
    patchesList.className = "thought-tools-list";
    for (const item of projection.patchItems) {
      const patchDetail = document.createElement("details");
      patchDetail.className = "thought-tool thought-patch";
      const patchSummary = document.createElement("summary");
      patchSummary.textContent = thoughtItemLabel(item);
      const patchBody = document.createElement("pre");
      patchBody.className = "thought-content";
      renderTypedContent(patchBody, normalizeThoughtItemBody(item) || "No details.");
      patchDetail.append(patchSummary, patchBody);
      patchesList.appendChild(patchDetail);
    }
    patchesRoot.appendChild(patchesList);
    body.appendChild(patchesRoot);
  }

  for (const item of projection.otherItems) {
    const detail = document.createElement("details");
    detail.className = "thought-tool";
    const title = document.createElement("summary");
    title.textContent = thoughtItemLabel(item);
    const content = document.createElement("pre");
    content.className = "thought-content";
    renderTypedContent(content, normalizeThoughtItemBody(item) || "No details.");
    detail.append(title, content);
    body.appendChild(detail);
  }

  root.appendChild(body);
  bubble.appendChild(root);
}

function mergeThoughtItems(existingItems, incomingItems) {
  const base = Array.isArray(existingItems) ? existingItems : [];
  const next = Array.isArray(incomingItems) ? incomingItems : [];
  const merged = [];
  const indexById = new Map();

  function pushItem(item) {
    if (!item) return;
    const key = typeof item.id === "string" && item.id ? item.id : "";
    if (key && indexById.has(key)) {
      const index = indexById.get(key);
      merged[index] = { ...merged[index], ...item };
      return;
    }
    const index = merged.push(item) - 1;
    if (key) indexById.set(key, index);
  }

  for (const item of base) pushItem(item);
  for (const item of next) pushItem(item);
  return merged;
}

function upsertThoughtProcess(turnKey, items, options = {}) {
  const key = String(turnKey || "live");
  const shouldMerge = options.merge !== false;
  const existing = shouldMerge ? state.thoughtItemMap.get(key) || [] : [];
  const merged = shouldMerge ? mergeThoughtItems(existing, items) : [...(items || [])];
  state.thoughtItemMap.set(key, merged);
  if (options.defer) {
    scheduleThoughtProcessRender(key, { open: Boolean(options.open) });
    return;
  }
  renderThoughtProcess(key, merged, { open: Boolean(options.open) });
}

function scheduleThoughtProcessRender(turnKey, options = {}) {
  const key = String(turnKey || "live");
  const existing = state.pendingThoughtRenderMap.get(key);
  if (existing) {
    existing.open = existing.open || Boolean(options.open);
    return;
  }
  const pending = { open: Boolean(options.open), frameId: 0 };
  pending.frameId = requestAnimationFrame(() => {
    state.pendingThoughtRenderMap.delete(key);
    const items = state.thoughtItemMap.get(key);
    if (!items?.length) return;
    renderThoughtProcess(key, items, { open: pending.open });
  });
  state.pendingThoughtRenderMap.set(key, pending);
}

function cancelPendingThoughtRender(turnKey) {
  const key = String(turnKey || "").trim();
  const pending = state.pendingThoughtRenderMap.get(key);
  if (!pending) return;
  if (pending.frameId) cancelAnimationFrame(pending.frameId);
  state.pendingThoughtRenderMap.delete(key);
}

function collapseThoughtProcess(turnKey) {
  const key = String(turnKey || "").trim();
  if (!key) return;
  cancelPendingThoughtRender(key);
  const items = state.thoughtItemMap.get(key);
  if (!items?.length) return;
  renderThoughtProcess(key, items, { open: false });
}

function finalizeTurnMessages(turnKey) {
  const key = String(turnKey || "").trim();
  if (!key) return;
  finalizeMessageTypedContent(state.finalMessageByTurnKey.get(key));
}

function appendThoughtAssistantDelta(itemId, delta, phaseHint = "") {
  const id = String(itemId || "").trim();
  if (!id) return false;
  const textDelta = String(delta || "");
  if (!textDelta) return false;

  const hintPhase = normalizePhase(phaseHint);
  const existingMeta = state.thoughtTurnByItemId.get(id);
  if (!existingMeta && !isThoughtAssistantPhase(hintPhase)) return false;

  const turnKey = String(existingMeta?.turnKey || state.turnId || `live_${Date.now()}`);
  const phase = hintPhase || existingMeta?.phase || "commentary";
  if (!existingMeta) {
    state.thoughtTurnByItemId.set(id, { turnKey, phase });
  } else if (phase && phase !== existingMeta.phase) {
    state.thoughtTurnByItemId.set(id, { ...existingMeta, phase });
  }

  const currentItems = state.thoughtItemMap.get(turnKey) || [];
  const currentItem = currentItems.find((entry) => entry?.id === id);
  const currentText = typeof currentItem?.text === "string" ? currentItem.text : "";
  upsertThoughtProcess(
    turnKey,
    [{ id, type: "agentMessage", phase, text: `${currentText}${textDelta}` }],
    { merge: true, open: true, defer: true },
  );
  return true;
}

function renderItem(item) {
  if (!item || !item.id) return;
  rememberCodexItem({ threadId: state.threadId, turnId: item.turnId || state.turnId, itemId: item.id }, item);
  if (item.type === "userMessage") {
    const text = (item.content || []).map(userInputToText).filter(Boolean).join("\n\n");
    setMessageText(item.id, "user", text, "You");
    return;
  }
  if (item.type === "agentMessage") {
    if (isThoughtAssistantMessageItem(item)) {
      const turnKey = String(item.turnId || state.turnId || `live_${Date.now()}`);
      rememberThoughtAssistantItem(item, turnKey);
      upsertThoughtProcess(turnKey, [item], { merge: true, open: !state.isBulkRendering });
      return;
    }
    rememberFinalMessageItem(item.id, item.turnId || state.turnId || "");
    setMessageText(item.id, "assistant", item.text || "", "Codex");
    return;
  }
  if (item.type === "plan") {
    setMessageText(item.id, "system", item.text || "", "Plan");
    return;
  }
  if (item.type === "reasoning") {
    const text = [...(item.summary || []), ...(item.content || [])].filter(Boolean).join("\n");
    setMessageText(item.id, "system", text, "Reasoning");
    return;
  }
  if (item.type === "commandExecution") {
    const text = formatCommandExecutionText(item);
    setMessageText(item.id, "system", text || "Command execution", "Command");
    return;
  }
  if (item.type === "fileChange") {
    const changes = Array.isArray(item.changes) ? item.changes.length : 0;
    setMessageText(
      item.id,
      "system",
      `${item.status || "completed"} · ${changes} file change${changes === 1 ? "" : "s"}`,
      "Patch",
    );
    return;
  }
  if (item.type === "contextCompaction") {
    setMessageText(item.id, "system", "Context compacted for this thread.", "System");
    return;
  }
  if (item.type === "mcpToolCall") {
    const body = `${item.server || "mcp"} · ${item.tool || "tool"} · ${item.status || "unknown"}`;
    setMessageText(item.id, "system", body, "MCP");
    return;
  }
  if (item.type === "dynamicToolCall") {
    const body = `${item.tool || "dynamic tool"} · ${item.status || "unknown"}`;
    setMessageText(item.id, "system", body, "Tool");
    return;
  }
  if (item.type === "webSearch") {
    setMessageText(item.id, "system", item.query ? `Query: ${item.query}` : "Web search", "Web");
    return;
  }
  if (item.type === "imageGeneration") {
    setMessageText(item.id, "system", item.revisedPrompt || item.result || "Image generation", "Image");
    return;
  }
  setMessageText(item.id, "system", compactValue(item, 320) || `[${item.type}]`, "Event");
}

function renderThreadHistory(thread, options = {}) {
  const historyKey = logicalHistoryKey(thread?.id || state.threadId || "");
  ensureHistoryWindow(historyKey, options);
  state.historyKind = "thread";
  state.historyKey = historyKey;
  state.historyData = thread;

  const previousScrollTop = options.preserveViewport ? els.transcript.scrollTop : 0;
  const previousScrollHeight = options.preserveViewport ? els.transcript.scrollHeight : 0;

  state.isBulkRendering = true;
  clearRenderedThreadState({ resetSession: options.resetSession !== false });
  const allTurns = Array.isArray(thread?.turns) ? thread.turns : [];
  const userMessageTurnIndices = [];
  for (let index = 0; index < allTurns.length; index += 1) {
    for (const item of allTurns[index]?.items || []) {
      if (item?.type === "userMessage") userMessageTurnIndices.push(index);
    }
  }
  const totalUserMessages = userMessageTurnIndices.length;
  const visibleUserMessages = visibleUserMessageCount(totalUserMessages);
  const hiddenUserMessages = Math.max(0, totalUserMessages - visibleUserMessages);
  const startTurnIndex = totalUserMessages && hiddenUserMessages > 0
    ? userMessageTurnIndices[Math.max(0, totalUserMessages - visibleUserMessages)] ?? 0
    : 0;
  const visibleTurns = allTurns.slice(startTurnIndex);

  renderLoadMoreControl(hiddenUserMessages);

  for (let index = 0; index < visibleTurns.length; index += 1) {
    const turn = visibleTurns[index];
    const absoluteTurnIndex = startTurnIndex + index;
    const turnKey = String(turn?.id || `${absoluteTurnIndex + 1}`);
    const userItems = [];
    const regularItems = [];
    const thoughtItems = [];
    for (const item of turn.items || []) {
      if (item?.id) rememberCodexItem({ threadId: thread?.id || state.threadId, turnId: turnKey, itemId: item.id }, item);
      if (isThoughtItem(item) || isThoughtAssistantMessageItem(item)) thoughtItems.push(item);
      else if (item?.type === "userMessage") userItems.push(item);
      else regularItems.push(item);
    }
    for (const item of userItems) renderItem(item);
    if (thoughtItems.length) {
      for (const item of thoughtItems) {
        if (isThoughtAssistantMessageItem(item)) rememberThoughtAssistantItem(item, turnKey);
      }
      upsertThoughtProcess(turnKey, thoughtItems, { merge: false });
    }
    for (const item of regularItems) renderItem(item);
  }
  state.isBulkRendering = false;
  if (options.preserveViewport) {
    const nextScrollHeight = els.transcript.scrollHeight;
    const delta = Math.max(0, nextScrollHeight - previousScrollHeight);
    els.transcript.scrollTop = Math.max(0, previousScrollTop + delta);
  } else {
    els.transcript.scrollTop = els.transcript.scrollHeight;
  }
  renderRuntimeConstitution();
}

async function startNewThread() {
  if (!hasCapability("threads", "canStart")) {
    throw new Error("Active Codex runtime does not expose thread/start capability.");
  }
  const cwd = connection?.workspaceRoot || project?.workspace?.linuxPath || project?.workspace?.localPath || project?.repoPath || "";
  const params = {
    cwd,
    model: activeModelId() || null,
    experimentalRawEvents: false,
    persistExtendedHistory: true,
  };
  if (state.runtimeOverrides.approvalPolicy) params.approvalPolicy = state.runtimeOverrides.approvalPolicy;
  if (state.runtimeOverrides.sandboxMode) params.sandbox = state.runtimeOverrides.sandboxMode;
  if (state.runtimeOverrides.serviceTier) params.serviceTier = state.runtimeOverrides.serviceTier;
  const result = await rpc("thread/start", params);
  clearRenderedThreadState();
  bindThread(result.thread, result.model);
}

async function startCodexTurn(text, options = {}) {
  if (!hasCapability("turns", "canStart")) {
    throw new Error("Active Codex runtime does not expose turn/start capability.");
  }
  const params = {
    threadId: state.threadId,
    input: [{ type: "text", text, text_elements: [] }],
    model: activeModelId() || null,
    effort: requestedReasoningEffort(),
  };
  if (state.runtimeOverrides.approvalPolicy) params.approvalPolicy = state.runtimeOverrides.approvalPolicy;
  if (state.runtimeOverrides.serviceTier) params.serviceTier = state.runtimeOverrides.serviceTier;
  const sandboxPolicy = sandboxPolicyForMode(state.runtimeOverrides.sandboxMode);
  if (sandboxPolicy) params.sandboxPolicy = sandboxPolicy;
  const result = await rpc("turn/start", params);
  const turnId = String(result?.turn?.id || "");
  if (turnId) {
    state.activeTurnId = turnId;
    state.turnId = turnId;
    state.turnPending = false;
    const activity = ensureTurnActivity(turnId);
    if (activity) {
      activity.status = String(result?.turn?.status || "inProgress");
      activity.startedAt = activity.startedAt || result?.turn?.startedAt || Date.now() / 1000;
    }
    rememberPromptTurn(turnId, text, options.retryCount || 0);
    renderRuntimeConstitution();
  }
  return result;
}

async function sendPrompt(text) {
  if (!state.threadId) await startNewThread();
  if (!state.liveAttached && state.threadId) {
    const liveResult = await attachLiveThread(state.threadId);
    applyLiveThreadResult(liveResult);
  }
  state.turnPending = true;
  renderRuntimeConstitution();
  try {
    await startCodexTurn(text);
    els.composerInput.value = "";
  } catch (error) {
    state.turnPending = false;
    state.activeTurnId = "";
    renderRuntimeConstitution();
    throw error;
  }
}

async function stopCurrentTurn() {
  const turnId = String(state.activeTurnId || state.turnId || "").trim();
  if (!state.threadId || !turnId) {
    addSystemMessage("No active Codex turn is available to stop yet.");
    return;
  }
  state.turnStopping = true;
  const activity = ensureTurnActivity(turnId);
  if (activity) activity.status = "interrupting";
  renderRuntimeConstitution();
  try {
    await rpc("turn/interrupt", { threadId: state.threadId, turnId });
    if (activity) {
      activity.status = "interrupted";
      activity.completedAt = activity.completedAt || Date.now() / 1000;
    }
    state.activeTurnId = "";
    state.turnPending = false;
  } finally {
    state.turnStopping = false;
    renderRuntimeConstitution();
  }
}

async function initializeBridgeSession() {
  await rpc("initialize", {
    clientInfo: { name: "codex-review-shell", title: "Codex Review Shell", version: "0.4.0" },
    capabilities: { experimentalApi: true },
  });
  await bridge.notify("initialized", {});
  await loadAccountState();
  await Promise.allSettled([refreshModelList(), refreshRateLimits(), refreshConfigRequirements()]);
}

function handleNotification(method, params) {
  if (method === "error") {
    const turnId = String(params?.turnId || state.turnId || "");
    const activity = ensureTurnActivity(turnId);
    if (activity) {
      activity.hasCodexOutput = true;
      activity.errorShown = true;
      if (!params?.willRetry) {
        activity.status = "error";
        activity.completedAt = activity.completedAt || Date.now() / 1000;
      }
    }
    if (!params?.willRetry) {
      state.turnPending = false;
      state.activeTurnId = "";
      state.turnStopping = false;
      renderRuntimeConstitution();
    }
    const error = params?.error || {};
    const message = [
      params?.willRetry ? "Codex stream error; retrying." : "Codex error.",
      error.message || "",
      error.additionalDetails || "",
    ].filter(Boolean).join("\n");
    addSystemMessage(message);
    return;
  }
  if (method === "warning") {
    if (!params?.threadId || String(params.threadId) === String(state.threadId || "")) {
      addSystemMessage(`Codex warning: ${params?.message || "Unknown warning."}`);
    }
    return;
  }
  if (method === "serverRequest/resolved") {
    const requestId = String(params?.requestId || "");
    for (const request of state.serverRequests.values()) {
      if (String(request.requestId) === requestId && request.status !== "resolved") {
        updateServerRequest({ ...request, status: "resolved", resolvedAt: new Date().toISOString() });
      }
    }
    return;
  }
  if (method === "item/agentMessage/delta") {
    const turnKey = String(params?.turnId || state.turnId || "");
    markTurnCodexOutput(turnKey);
    if (appendThoughtAssistantDelta(params?.itemId, params?.delta || "", params?.phase || "")) return;
    rememberFinalMessageItem(params?.itemId, turnKey);
    appendMessageText(params?.itemId, "assistant", params?.delta || "", "Codex");
    return;
  }
  if (method === "item/started" || method === "item/completed") {
    if (params?.item?.type && params.item.type !== "userMessage") {
      markTurnCodexOutput(params?.turnId || params.item.turnId || state.turnId);
    }
    if (params?.item?.id) {
      rememberCodexItem(
        { threadId: params.threadId || state.threadId, turnId: params.turnId || params.item.turnId || state.turnId, itemId: params.item.id },
        params.item,
      );
    }
    if (isThoughtItem(params?.item) || isThoughtAssistantMessageItem(params?.item)) {
      const turnKey = String(params?.turnId || params?.item?.turnId || state.turnId || `live_${Date.now()}`);
      if (isThoughtAssistantMessageItem(params?.item)) rememberThoughtAssistantItem(params.item, turnKey);
      upsertThoughtProcess(turnKey, [params.item], { merge: true, open: true });
    } else {
      renderItem(params?.item);
    }
    return;
  }
  if (method === "account/updated") {
    loadAccountState().catch((error) => addSystemMessage(`Failed to refresh account state: ${error.message}`));
    refreshRateLimits().catch(() => {});
    return;
  }
  if (method === "account/rateLimits/updated") {
    state.rateLimits = { rateLimits: params?.rateLimits || params?.rate_limits || params || null };
    state.rateLimitsStatus = "ready";
    state.rateLimitsError = "";
    state.rateLimitsObservedAt = Date.now();
    renderRuntimeConstitution();
    return;
  }
  if (method === "thread/tokenUsage/updated") {
    applyThreadTokenUsageUpdate(params);
    return;
  }
  if (method === "account/login/completed") {
    if (params.success) {
      setNotice("Codex account ready", "Authentication completed. Refreshing account state…", { success: true, showNewThread: true });
      loadAccountState().catch((error) => addSystemMessage(`Failed to refresh account state: ${error.message}`));
    } else {
      setNotice("Login failed", params.error || "Codex account login failed.", { error: true, showLogin: true });
    }
    return;
  }
  if (method === "turn/completed") {
    const completedTurnId = turnIdFromNotification(params);
    if (completedTurnId) {
      state.turnId = completedTurnId;
      if (String(state.activeTurnId) === String(completedTurnId)) state.activeTurnId = "";
      state.turnPending = false;
      state.turnStopping = false;
      const activity = ensureTurnActivity(completedTurnId);
      if (activity) {
        activity.status = String(params?.turn?.status || "completed");
        activity.completedAt = params?.turn?.completedAt || Date.now() / 1000;
      }
      renderRuntimeConstitution();
      collapseThoughtProcess(completedTurnId);
      finalizeTurnMessages(completedTurnId);
      renderTurnCompletionNotice(completedTurnId, params?.turn || {});
    }
    return;
  }
  if (method === "turn/started") {
    const startedTurnId = turnIdFromNotification(params);
    if (startedTurnId) {
      state.turnId = startedTurnId;
      state.activeTurnId = startedTurnId;
      state.turnPending = false;
      const activity = ensureTurnActivity(startedTurnId);
      if (activity) {
        activity.status = String(params?.turn?.status || "inProgress");
        activity.startedAt = params?.turn?.startedAt || Date.now() / 1000;
      }
      renderRuntimeConstitution();
    }
  }
}

function handleBridgeEvent(event) {
  if (!event) return;
  if (event.type === "open-thread-request") {
    openThreadFromEvent(event);
    return;
  }
  if (event.type === "connection-status") {
    if (event.connection) connection = { ...connection, ...event.connection };
    if (event.status === "connected") {
      state.connected = true;
      state.connectionStatus = "connected";
      renderRuntimeConstitution();
      if (state.threadId && !state.liveAttached) {
        const expectedThreadId = state.threadId;
        const expectedSourceHome = state.sourceHome;
        const expectedSessionFilePath = state.sessionFilePath;
        attachLiveThread(expectedThreadId)
          .then((result) => {
            if (state.threadId !== expectedThreadId) return;
            applyLiveThreadResult(result);
            reportThreadState("attached_live", {
              threadId: expectedThreadId,
              sourceHome: expectedSourceHome,
              sessionFilePath: expectedSessionFilePath,
              title: result?.thread?.title || result?.thread?.name || state.threadTitle || expectedThreadId,
              evidence: "delayed-connection-live-attach",
            });
          })
          .catch(() => {});
      }
      return;
    }
    if (event.status === "connecting") {
      state.connected = false;
      state.connectionStatus = "connecting";
      setComposerEnabled(false, "Connecting Codex app-server…");
      renderRuntimeConstitution();
      return;
    }
    if (event.status === "error") {
      state.connected = false;
      state.liveAttached = false;
      state.connectionStatus = "error";
      setComposerEnabled(false, "Codex connection error.");
      renderRuntimeConstitution();
      if (event.error) addSystemMessage(`Codex connection failed: ${event.error}`);
      return;
    }
    if (event.status === "disconnected") {
      state.connected = false;
      state.liveAttached = false;
      state.connectionStatus = "disconnected";
      setComposerEnabled(false, "Codex disconnected.");
      renderRuntimeConstitution();
      if (event.error && !String(event.error).toLowerCase().includes("renderer requested disconnect")) {
        addSystemMessage(`Codex disconnected: ${event.error}`);
      }
      return;
    }
  }
  if (event.type === "workspace-status") {
    state.workspaceStatus = event.session || null;
    renderRuntimeConstitution();
    return;
  }
  if (event.type === "rpc-request") {
    renderServerRequest(event.request || event);
    return;
  }
  if (event.type === "rpc-request-updated") {
    updateServerRequest(event.request || event);
    return;
  }
  if (event.type === "focus-server-request") {
    dismissComposerOverlay("focus-server-request");
    focusServerRequest(event.key);
    return;
  }
  if (event.type === "dismiss-composer-overlay") {
    dismissComposerOverlay(event.reason || "shell-event");
    return;
  }
  if (event.type === "rpc-notification") {
    handleNotification(event.method, event.params || {});
    return;
  }
  if (event.type === "protocol-error") {
    addSystemMessage(`Codex protocol error: ${event.error}`);
  }
}

async function loadAccountState() {
  const account = await rpc("account/read", { refreshToken: false });
  if (account?.account?.type === "chatgpt") {
    state.accountState = {
      label: `${account.account.planType || "account"} · ${account.account.email || "email unknown"}`,
      status: "ready",
      truth: "runtime_proven",
      evidenceRefs: [evidenceRef("account_read", "account/read returned ChatGPT account details", { confidence: "proven" })],
    };
  } else if (account?.requiresOpenaiAuth) {
    state.accountState = {
      label: "login required",
      status: "login_required",
      truth: "runtime_declared",
      evidenceRefs: [evidenceRef("account_read", "account/read requires OpenAI authentication", { confidence: "declared" })],
    };
    addSystemMessage("Codex requires login in the control plane.");
  } else {
    state.accountState = {
      label: "account unavailable",
      status: "unavailable",
      truth: "unknown",
      evidenceRefs: [evidenceRef("account_read", "account/read did not expose account state", { status: "unavailable", confidence: "unknown" })],
    };
  }
  renderRuntimeConstitution();
}

async function login() {
  const response = await rpc("account/login/start", { type: "chatgpt" });
  if (response?.authUrl) {
    window.open(response.authUrl, "_blank");
    addSystemMessage("Complete the Codex login flow in your external browser.");
  }
}

async function connect() {
  if (!bridge) {
    addSystemMessage("Codex bridge unavailable in this surface.");
    return;
  }
  if (!project) {
    addSystemMessage("This Codex surface was loaded without a project payload.");
    return;
  }
  state.removeBridgeListener?.();
  state.removeBridgeListener = bridge.onEvent(handleBridgeEvent);
  updateSurfaceHeader(payload.initialThreadTitle || project.name, workspaceText());

  if (!connection?.wsUrl) {
    state.connectionStatus = "unavailable";
    renderRuntimeConstitution();
    addSystemMessage(payload.error || "Codex fallback surface loaded. The managed app-server is not connected.");
    setComposerEnabled(false, "Read-only transcript mode (Codex app-server unavailable).");
    state.readyForThreadOpen = true;
    if (payload.initialThreadId) {
      try {
        await openThreadHybrid(
          payload.initialThreadId,
          payload.initialThreadSourceHome || "",
          payload.initialThreadSessionFilePath || "",
        );
      } catch (error) {
        addSystemMessage(`Unable to open fallback thread ${payload.initialThreadId}: ${error.message}`);
      }
    }
    return;
  }

  setComposerEnabled(false, "Connecting Codex app-server…");
  state.connectionStatus = "connecting";
  renderRuntimeConstitution();
  const connectedSession = await bridge.connect(connection);
  if (connectedSession?.connection) connection = { ...connection, ...connectedSession.connection };
  state.connected = true;
  state.connectionStatus = "connected";
  renderRuntimeConstitution();
  try {
    await initializeBridgeSession();
    state.readyForThreadOpen = true;
    const queuedOpen = state.pendingOpenThreadEvent;
    state.pendingOpenThreadEvent = null;
    if (queuedOpen?.threadId) {
      openThreadFromEvent(queuedOpen);
    } else if (payload.initialThreadId) {
      try {
        await openThreadHybrid(
          payload.initialThreadId,
          payload.initialThreadSourceHome || "",
          payload.initialThreadSessionFilePath || "",
        );
      } catch (error) {
        addSystemMessage(`Unable to open startup thread ${payload.initialThreadId}: ${error.message}`);
        await loadExistingThreadOrStartNew();
      }
    } else {
      await loadExistingThreadOrStartNew();
    }
  } catch (error) {
    addSystemMessage(`Codex initialization failed: ${error.message}`);
  }
}

els.composerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  dismissComposerOverlay("composer-submit");
  if (turnIsActive()) {
    stopCurrentTurn().catch((error) => addSystemMessage(`Stop failed: ${error.message}`));
    return;
  }
  const text = els.composerInput.value.trim();
  if (!text) return;
  sendPrompt(text).catch((error) => addSystemMessage(`Turn failed: ${error.message}`));
});

els.composerAccessButton?.addEventListener("click", () => toggleComposerMenu("access"));
els.composerModelButton?.addEventListener("click", () => toggleComposerMenu("model"));

for (const eventType of ["pointerdown", "mousedown", "touchstart", "click"]) {
  document.addEventListener(eventType, (event) => {
    maybeDismissComposerOverlay(event, eventType);
  }, true);
}

document.addEventListener("focusin", (event) => {
  maybeDismissComposerOverlay(event, "focusin");
}, true);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") dismissComposerOverlay("escape");
});

window.addEventListener("blur", () => dismissComposerOverlay("window-blur"));
window.addEventListener("resize", () => updateComposerGeometry());

document.addEventListener("click", (event) => {
  const target = event.target?.closest?.("[data-runtime-tab]");
  if (!target) return;
  const tab = target.getAttribute("data-runtime-tab") || "runtime";
  openRuntimeDrawer(tab);
});

els.runtimeDrawerClose?.addEventListener("click", () => closeRuntimeDrawer());

installComposerGeometryObserver();

connect().catch((error) => {
  addSystemMessage(`Codex setup failed: ${error.message}`);
});
