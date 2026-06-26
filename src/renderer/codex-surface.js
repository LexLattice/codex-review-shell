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

function createClientTurnRequestId() {
  if (window.crypto?.randomUUID) return `client_turn_${window.crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  return `client_turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function stringDigest(value) {
  const text = String(value ?? "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
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
]);
const TOOL_LIKE_THOUGHT_TYPES = new Set([
  "commandExecution",
  "mcpToolCall",
  "dynamicToolCall",
  "webSearch",
]);
const DIRECT_FIXTURE_TRANSPORT = "direct-fixture";
const DIRECT_LIVE_TEXT_TRANSPORT = "direct-live-text";
const DIRECT_TRANSPORTS = new Set([DIRECT_FIXTURE_TRANSPORT, DIRECT_LIVE_TEXT_TRANSPORT]);
const ACTIVE_TURN_STATUS_SET = new Set([
  "inprogress",
  "in_progress",
  "running",
  "pending",
  "started",
  "partial",
  "open",
  "active",
  "interrupting",
]);
const THOUGHT_ASSISTANT_PHASES = new Set([
  // Canonical Codex phase for interim assistant preamble/progress text.
  "commentary",
]);

function localStorageGet(key, fallback = "") {
  try {
    return window.localStorage?.getItem(key) ?? fallback;
  } catch (_error) {
    return fallback;
  }
}

function localStorageSet(key, value) {
  try {
    window.localStorage?.setItem(key, String(value));
  } catch (_error) {
    // Local storage can be unavailable in hardened or test contexts.
  }
}

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
  usageLedgerStatus: {
    enabled: false,
    state: "disabled",
    ledgerId: "",
    ledgerLabel: "",
    manifestLabel: "",
    ledgerPathEvidenceKey: "",
    manifestPathEvidenceKey: "",
    queuedRows: 0,
    droppedRows: 0,
    rowCount: 0,
    lastError: "",
    lastObservedAt: "",
  },
  configRequirements: null,
  configRequirementsStatus: "idle",
  configRequirementsError: "",
  runtimePreferencesStatus: "idle",
  runtimePreferencesError: "",
  runtimeOverrides: {
    model: project?.codex?.model || "",
    reasoningEffort: project?.codex?.reasoningEffort || "",
    approvalPolicy: "",
    sandboxMode: "",
    serviceTier: "",
  },
  workspaceStatus: payload.workspaceStatus || null,
  connectionStatus: connectionAvailable() ? "loading" : (payload.runtimeStartupPending ? "starting" : "unavailable"),
  runtimeConstitution: null,
  runtimeDrawerOpen: false,
  runtimeDrawerTab: "runtime",
  analyticsPanelOpen: localStorageGet("codex.threadAnalyticsPanel.open", "false") === "true",
  analyticsPanelDock: localStorageGet("codex.threadAnalyticsPanel.dock", "right"),
  directSurfaceProjection: payload.directSurfaceProjection || connection?.directSurfaceProjection || null,
  directUiStatus: null,
  directUiStatusState: "idle",
  directUiStatusError: "",
  directUiOperationHistory: null,
  directUiPolicyView: null,
  directThreadList: [],
  directThreadDeck: null,
  directThreadListStatus: "idle",
  directThreadListError: "",
  directThreadOpenRequestId: 0,
  composerMenu: "",
  composerAttachments: [],
  composerAttachmentGeneration: 0,
  composerAttachmentError: "",
  composerDragDepth: 0,
  composerGeometryObserver: null,
  queuedComposerMessages: [],
  queuedPromptDrainInProgress: false,
  queuedPromptDrainScheduled: false,
  composerStatusInterval: null,
  activeTurnId: "",
  primaryThreadActive: false,
  primaryThreadActivitySource: "",
  turnPending: false,
  turnStopping: false,
  itemMap: new Map(),
  codexItemMap: new Map(),
  thoughtItemMap: new Map(),
  thoughtTurnByItemId: new Map(),
  pendingThoughtRenderMap: new Map(),
  finalMessageByTurnKey: new Map(),
  finalTurnKeyByMessageId: new Map(),
  turnFileEvidenceByTurn: new Map(),
  turnActivityMap: new Map(),
  turnPromptMap: new Map(),
  turnRetryCountMap: new Map(),
  emptyTurnRetrying: new Set(),
  serverRequests: new Map(),
  contextManagementEvidenceKeys: new Set(),
  connected: false,
  readyForThreadOpen: false,
  pendingOpenThreadEvent: null,
  threadMeta: null,
  agentGraph: null,
  agentGraphRevision: 0,
  agentHydrationRequests: new Map(),
  subagentActivityByTurn: new Map(),
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

function connectionAvailable() {
  return Boolean(connection?.available || connection?.wsUrl || DIRECT_TRANSPORTS.has(connection?.transport));
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

async function reportAgentGraph() {
  if (!bridge?.reportAgentGraph) return;
  const graph = state.agentGraph;
  if (!graph || String(graph.primaryThreadId || "") !== String(state.threadId || "")) return;
  const agents = Array.from(graph.agents.values()).map((agent) => ({
    threadId: agent.threadId,
    parentThreadId: agent.parentThreadId,
    agentPath: agent.agentPath || "",
    label: agent.label,
    nickname: agent.nickname,
    role: agent.role,
    model: agent.model || "",
    reasoningEffort: agent.reasoningEffort || "",
    status: agent.status,
    activityStatus: agent.activityStatus,
    hydrationStatus: agent.hydrationStatus,
    lastAction: agent.lastAction || null,
    promptPreview: agent.promptPreview || "",
    transcript: Array.isArray(agent.transcript) ? agent.transcript : [],
    turnScopes: agent.turnScopes && typeof agent.turnScopes === "object" ? agent.turnScopes : {},
    evidenceRefs: Array.isArray(agent.evidenceRefs) ? agent.evidenceRefs : [],
  }));
  try {
    await bridge.reportAgentGraph({
      projectId: project?.id || payload.codexConnection?.projectId || "",
      primaryThreadId: state.threadId,
      sourceHome: state.sourceHome,
      sessionFilePath: state.sessionFilePath,
      graphRevision: state.agentGraphRevision,
      activationEpoch: Number(payload.activationEpoch) || 0,
      agents,
      activeCount: agents.filter((agent) => ["running", "pending", "inProgress"].includes(String(agent.status || ""))).length,
      completedCount: agents.filter((agent) => String(agent.status || "") === "completed").length,
      erroredCount: agents.filter((agent) => ["failed", "errored"].includes(String(agent.status || ""))).length,
    });
  } catch {
    // Agent graph reporting is advisory and must not block transcript rendering.
  }
}

function contextManagementEvidenceKey(kind, id) {
  return [state.threadId || "", kind, id || ""].map((value) => String(value || "")).join(":");
}

function contextThreadItemEvidenceKey(item = {}) {
  const id = String(item.itemId || item.id || "").trim();
  if (!id) return "";
  const type = String(item.type || "item").trim();
  const memoryKey = String(item.memoryCitation?.evidenceKey || item.memoryCitation?.memoryId || "").trim();
  return contextManagementEvidenceKey("item", [type, id, memoryKey].filter(Boolean).join(":"));
}

function contextControlEvidenceKey(control = {}) {
  const method = String(control.method || "").trim();
  const evidenceKey = String(control.evidenceKey || "").trim();
  if (!method || !evidenceKey) return "";
  return contextManagementEvidenceKey("control", `${method}:${evidenceKey}`);
}

async function reportContextManagementEvidence(input = {}) {
  if (!bridge?.reportContextManagementEvidence) return;
  const threadId = String(input.threadId || state.threadId || "");
  if (!threadId) return;
  const threadItems = Array.isArray(input.threadItems) ? input.threadItems : [];
  const controlsObserved = Array.isArray(input.controlsObserved) ? input.controlsObserved : [];
  const pendingKeys = [];
  const newThreadItems = threadItems.filter((item) => {
    const key = contextThreadItemEvidenceKey(item);
    if (!key || state.contextManagementEvidenceKeys.has(key)) return false;
    pendingKeys.push(key);
    return true;
  });
  const newControlsObserved = controlsObserved.filter((control) => {
    const key = contextControlEvidenceKey(control);
    if (!key || state.contextManagementEvidenceKeys.has(key)) return false;
    pendingKeys.push(key);
    return true;
  });
  if (!newThreadItems.length && !newControlsObserved.length) return;
  try {
    await bridge.reportContextManagementEvidence({
      projectId: project?.id || payload.codexConnection?.projectId || "",
      threadId,
      activationEpoch: Number(payload.activationEpoch) || 0,
      threadItems: newThreadItems,
      controlsObserved: newControlsObserved,
    });
    for (const key of pendingKeys) state.contextManagementEvidenceKeys.add(key);
    if (state.runtimeDrawerOpen && state.runtimeDrawerTab === "implementation") {
      refreshDirectImplementationUi({ force: true }).catch(() => {});
    }
  } catch {
    // Context evidence reporting is status-only and must never block rendering.
  }
}

function maybeReportContextManagementControl(request = {}) {
  const method = String(request.method || "");
  if (!["thread/compact/start", "thread/memoryMode/set", "memory/reset"].includes(method)) return;
  reportContextManagementEvidence({
    controlsObserved: [{
      method,
      evidenceKey: String(request.key || request.requestId || method),
    }],
  }).catch(() => {});
}

function shortAgentThreadId(threadId) {
  const id = String(threadId || "").trim();
  if (!id) return "";
  return id.length <= 8 ? id : id.slice(0, 8);
}

function nullableFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function extractSubagentSourceMeta(source = {}) {
  const spawn = source?.subagent?.thread_spawn ||
    source?.subAgent?.threadSpawn ||
    source?.subagent?.threadSpawn ||
    source?.subAgent?.thread_spawn ||
    null;
  if (!spawn) return null;
  return {
    parentThreadId: String(spawn.parent_thread_id || spawn.parentThreadId || ""),
    agentNickname: String(spawn.agent_nickname || spawn.agentNickname || ""),
    agentRole: String(spawn.agent_role || spawn.agentRole || ""),
    agentPath: String(spawn.agent_path || spawn.agentPath || ""),
    depth: nullableFiniteNumber(spawn.depth),
  };
}

function threadAgentMeta(input = {}) {
  const sourceMeta = extractSubagentSourceMeta(input.source || input.threadMeta?.source || {});
  const threadMeta = input.threadMeta || input;
  const parentThreadId = String(
    threadMeta.parentThreadId ||
    threadMeta.parent_thread_id ||
    sourceMeta?.parentThreadId ||
    "",
  );
  const agentNickname = String(
    threadMeta.agentNickname ||
    threadMeta.agent_nickname ||
    sourceMeta?.agentNickname ||
    "",
  );
  const agentRole = String(
    threadMeta.agentRole ||
    threadMeta.agent_role ||
    sourceMeta?.agentRole ||
    "",
  );
  const agentPath = String(
    threadMeta.agentPath ||
    threadMeta.agent_path ||
    sourceMeta?.agentPath ||
    "",
  );
  const depthValue = threadMeta.depth ?? sourceMeta?.depth;
  return {
    threadId: String(threadMeta.threadId || threadMeta.id || state.threadId || ""),
    isSubagent: Boolean(threadMeta.isSubagent || threadMeta.is_subagent || sourceMeta || parentThreadId),
    parentThreadId,
    agentNickname,
    agentRole,
    agentPath,
    depth: nullableFiniteNumber(depthValue),
  };
}

function agentDisplayLabel(meta = {}) {
  const nickname = String(meta.agentNickname || meta.nickname || "").trim();
  const role = String(meta.agentRole || meta.role || "").trim();
  const id = shortAgentThreadId(meta.threadId || "");
  if (nickname && role) return `${nickname} [${role}]`;
  if (nickname) return nickname;
  if (role && id) return `Agent ${id} [${role}]`;
  if (id) return `Agent ${id}`;
  return "Unknown agent";
}

function parentAgentLabel(meta = {}) {
  const parentId = String(meta.parentThreadId || "").trim();
  if (parentId && parentId === String(state.threadId || "")) return "Primary Codex";
  if (parentId) return `Parent agent ${shortAgentThreadId(parentId)}`;
  return "Parent agent";
}

function setActiveThreadMeta(meta = {}) {
  state.threadMeta = threadAgentMeta(meta);
}

function currentAuthorContext(meta = state.threadMeta) {
  const normalized = threadAgentMeta(meta || {});
  const agentLabel = agentDisplayLabel(normalized);
  return {
    ...normalized,
    agentLabel,
    parentLabel: parentAgentLabel(normalized),
    userRole: normalized.isSubagent ? "system" : "user",
    userTitle: normalized.isSubagent ? `${parentAgentLabel(normalized)} -> ${agentLabel}` : "You",
    assistantTitle: normalized.isSubagent ? agentLabel : "Codex",
  };
}

function resetAgentGraph(threadId = state.threadId) {
  state.agentGraphRevision += 1;
  const primaryThreadId = String(threadId || "");
  state.agentGraph = {
    schemaVersion: 1,
    graphId: `${primaryThreadId || "thread"}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
    primaryThreadId,
    agents: new Map(),
    updatedAt: new Date().toISOString(),
  };
  state.agentHydrationRequests.clear();
  reportAgentGraph();
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
  analyticsPanelButton: document.getElementById("analyticsPanelButton"),
  runtimeDrawerButton: document.getElementById("runtimeDrawerButton"),
  environmentChipCluster: document.getElementById("environmentChipCluster"),
  controlChipCluster: document.getElementById("controlChipCluster"),
  runtimeDrawer: document.getElementById("runtimeDrawer"),
  runtimeDrawerTitle: document.getElementById("runtimeDrawerTitle"),
  runtimeDrawerUpdated: document.getElementById("runtimeDrawerUpdated"),
  runtimeDrawerClose: document.getElementById("runtimeDrawerClose"),
  runtimeDrawerTabs: document.getElementById("runtimeDrawerTabs"),
  runtimeDrawerBody: document.getElementById("runtimeDrawerBody"),
  threadAnalyticsPanel: document.getElementById("threadAnalyticsPanel"),
  threadAnalyticsPanelClose: document.getElementById("threadAnalyticsPanelClose"),
  threadAnalyticsPanelTitle: document.getElementById("threadAnalyticsPanelTitle"),
  threadAnalyticsPanelMeta: document.getElementById("threadAnalyticsPanelMeta"),
  threadAnalyticsPanelBody: document.getElementById("threadAnalyticsPanelBody"),
  threadAnalyticsDockButtons: document.getElementById("threadAnalyticsDockButtons"),
  directThreadStrip: document.getElementById("directThreadStrip"),
  directThreadStatus: document.getElementById("directThreadStatus"),
  directThreadList: document.getElementById("directThreadList"),
  directThreadRefreshButton: document.getElementById("directThreadRefreshButton"),
  directThreadNewButton: document.getElementById("directThreadNewButton"),
  transcript: document.getElementById("transcript"),
  composerForm: document.getElementById("composerForm"),
  composerInput: document.getElementById("composerInput"),
  composerAttachmentRow: document.getElementById("composerAttachmentRow"),
  composerAttachmentList: document.getElementById("composerAttachmentList"),
  chooseAttachmentButton: document.getElementById("chooseAttachmentButton"),
  pasteImageButton: document.getElementById("pasteImageButton"),
  composerActionStack: document.querySelector(".composer-action-stack"),
  composerTurnStatus: document.getElementById("composerTurnStatus"),
  composerStopButton: document.getElementById("composerStopButton"),
  sendButton: document.getElementById("sendButton"),
  activeTurnActions: document.getElementById("activeTurnActions"),
  steerButton: document.getElementById("steerButton"),
  queueButton: document.getElementById("queueButton"),
  composerDispositionMenu: document.getElementById("composerDispositionMenu"),
  steerMenuButton: document.getElementById("steerMenuButton"),
  queueMenuButton: document.getElementById("queueMenuButton"),
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
  if (els.sendButton) els.sendButton.disabled = !nextEnabled && !turnIsActive();
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

function formatBytes(bytes) {
  const number = Number(bytes) || 0;
  if (number < 1024) return `${number} B`;
  if (number < 1024 * 1024) return `${(number / 1024).toFixed(1)} KB`;
  return `${(number / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentRef(attachment) {
  return String(attachment?.workspaceRelPath || attachment?.stagedRelPath || "").trim();
}

function attachmentSubmitBlockers() {
  return state.composerAttachments.filter((attachment) => {
    if (!attachment || attachment.status !== "ready") return true;
    return !attachmentRef(attachment);
  });
}

function attachmentReferenceBlock() {
  const lines = [];
  for (const attachment of state.composerAttachments) {
    if (!attachment || attachment.status !== "ready") continue;
    const rel = attachmentRef(attachment);
    if (!rel) continue;
    const disposition = attachment?.provider?.disposition || "staged_file_reference";
    lines.push(`- ${attachment.displayName || "attachment"} (${attachment.mimeType || "application/octet-stream"}, ${formatBytes(attachment.sizeBytes)}): ${rel} [${disposition}]`);
  }
  if (!lines.length) return "";
  return ["", "Attachments staged as workspace references:", ...lines].join("\n");
}

function composerAttachmentDraftsForSubmit() {
  return state.composerAttachments
    .filter((attachment) => attachment && attachment.status === "ready")
    .map((attachment) => ({
      id: attachment.id || "",
      projectId: attachment.projectId || "",
      surfaceId: attachment.surfaceId || "codex",
      status: attachment.status || "",
      kind: attachment.kind || "file",
      displayName: attachment.displayName || attachment.originalName || "attachment",
      originalName: attachment.originalName || "",
      mimeType: attachment.mimeType || "application/octet-stream",
      sizeBytes: Number(attachment.sizeBytes || 0),
      workspaceRelPath: attachment.workspaceRelPath || "",
      stagedRelPath: attachment.stagedRelPath || "",
      sourcePathEvidenceKey: attachment.sourcePathEvidenceKey || "",
      stagedPathEvidenceKey: attachment.stagedPathEvidenceKey || "",
      workspaceEvidenceKey: attachment.workspaceEvidenceKey || "",
      provider: {
        disposition: attachment.provider?.disposition || "",
        reason: attachment.provider?.reason || "",
        capabilityEvidenceState: attachment.provider?.capabilityEvidenceState || "",
        unsupportedReason: attachment.provider?.unsupportedReason || "",
      },
      typeEvidence: {
        risk: attachment.typeEvidence?.risk || "",
        finalMime: attachment.typeEvidence?.finalMime || attachment.mimeType || "",
      },
    }));
}

function composerAttachmentDraftSetDigest(attachments = []) {
  try {
    return `draftset:${stringDigest(JSON.stringify(attachments))}`;
  } catch {
    return `draftset:${Date.now().toString(36)}`;
  }
}

function composerDraftProjection() {
  const text = String(els.composerInput?.value || "").trim();
  const attachmentBlock = attachmentReferenceBlock();
  const blockers = attachmentSubmitBlockers();
  const attachments = composerAttachmentDraftsForSubmit();
  if (blockers.length) {
    return {
      ok: false,
      reason: "unsupported_attachments",
      message: "Remove or fix unsupported attachments before sending.",
      text: "",
      attachments,
      attachmentDraftSetDigest: composerAttachmentDraftSetDigest(attachments),
      hasContent: Boolean(text || attachmentBlock),
    };
  }
  if (!text && !attachmentBlock) {
    return {
      ok: false,
      reason: "empty",
      message: "",
      text: "",
      attachments,
      attachmentDraftSetDigest: composerAttachmentDraftSetDigest(attachments),
      hasContent: false,
    };
  }
  return {
    ok: true,
    reason: "",
    message: "",
    text: `${text || "Review the attached files/images."}${attachmentBlock}`,
    attachments,
    attachmentDraftSetDigest: composerAttachmentDraftSetDigest(attachments),
    hasContent: true,
  };
}

function clearComposerDraft() {
  if (els.composerInput) els.composerInput.value = "";
  clearComposerAttachments();
}

function addComposerAttachments(result) {
  const attachments = Array.isArray(result?.attachments) ? result.attachments : [];
  if (attachments.length) {
    const byId = new Map(state.composerAttachments.map((attachment) => [attachment.id, attachment]));
    for (const attachment of attachments) byId.set(attachment.id, attachment);
    state.composerAttachments = Array.from(byId.values());
    state.composerAttachmentGeneration += 1;
  }
  const diagnostics = Array.isArray(result?.diagnostics) ? result.diagnostics : [];
  state.composerAttachmentError = diagnostics.map((item) => item.error).filter(Boolean).join(" · ");
  renderComposerAttachments();
  renderComposerRuntimeBand();
}

function clearComposerAttachments() {
  state.composerAttachments = [];
  state.composerAttachmentGeneration += 1;
  state.composerAttachmentError = "";
  renderComposerAttachments();
  renderComposerRuntimeBand();
}

async function removeComposerAttachment(draftId) {
  const id = String(draftId || "");
  state.composerAttachments = state.composerAttachments.filter((attachment) => attachment.id !== id);
  state.composerAttachmentGeneration += 1;
  renderComposerAttachments();
  renderComposerRuntimeBand();
  if (bridge?.removeAttachmentDraft && project?.id) {
    try {
      await bridge.removeAttachmentDraft(project.id, id);
    } catch (error) {
      state.composerAttachmentError = `Attachment cleanup failed: ${error.message}`;
      renderComposerAttachments();
    }
  }
}

function renderComposerAttachments() {
  if (!els.composerAttachmentList) return;
  els.composerAttachmentList.innerHTML = "";
  for (const attachment of state.composerAttachments) {
    const chip = document.createElement("article");
    chip.className = `composer-attachment-chip ${attachment.status || "ready"}`;
    chip.dataset.attachmentDraftId = attachment.id || "";
    chip.dataset.contextTarget = "attachment";
    const label = document.createElement("span");
    label.className = "composer-attachment-label";
    label.textContent = attachment.displayName || "attachment";
    const meta = document.createElement("span");
    meta.className = "composer-attachment-meta";
    const disposition = attachment?.provider?.disposition || "reference";
    meta.textContent = `${attachment.kind || "file"} · ${formatBytes(attachment.sizeBytes)} · ${disposition.replace(/_/g, " ")}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "composer-attachment-remove";
    remove.textContent = "×";
    remove.title = "Remove attachment draft";
    remove.dataset.attachmentAction = "remove";
    remove.addEventListener("click", () => removeComposerAttachment(attachment.id));
    chip.append(label, meta, remove);
    els.composerAttachmentList.appendChild(chip);
  }
  if (state.composerAttachmentError) {
    const error = document.createElement("span");
    error.className = "composer-attachment-chip failed";
    error.textContent = state.composerAttachmentError;
    els.composerAttachmentList.appendChild(error);
  }
}

const RUNTIME_DRAWER_TABS = [
  ["runtime", "Runtime"],
  ["model", "Model"],
  ["access", "Access"],
  ["usage", "Usage"],
  ["implementation", "Implementation"],
  ["history", "History"],
  ["policy", "Policy"],
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
  return project?.workspace?.linuxPath || project?.workspace?.localPath || project?.repoPath || "";
}

function basenameFromPath(value) {
  const text = String(value || "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (!text) return "";
  return text.split("/").filter(Boolean).pop() || text;
}

function connectionLabel() {
  if (payload.runtimeStartupPending && !connectionAvailable()) return "starting";
  if (!connectionAvailable()) return "offline";
  const provider = providerProfile();
  const providerSuffix = provider?.flavor ? ` · ${provider.flavor}` : "";
  if (state.connectionStatus === "connected") return `${connection?.runtime || "connected"}${providerSuffix}`;
  if (state.connectionStatus === "starting") return "starting";
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
    status: connectionAvailable() ? "configured" : "unknown",
    capabilitySource: "project_config",
  };
}

function providerSettingsProjection() {
  return providerProfile()?.settingsProjection || {};
}

function directSurfaceProjection() {
  const projection = state.directSurfaceProjection || connection?.directSurfaceProjection || null;
  return projection?.schema === "direct_codex_surface_projection@1" ? projection : null;
}

function directComposerWitness() {
  const witness = directSurfaceProjection()?.composerRuntimeWitness || null;
  return witness?.schema === "direct_composer_runtime_witness@1" ? witness : null;
}

function directRuntimeWitnessChip(kind) {
  const chips = directSurfaceProjection()?.runtimeWitnessProjection?.chips;
  return Array.isArray(chips) ? chips.find((chip) => String(chip?.kind || "") === kind) || null : null;
}

function directProviderMetadataProfile() {
  const profile = directSurfaceProjection()?.providerMetadataProfile || null;
  return profile?.schema === "direct_provider_metadata_profile@1" ? profile : null;
}

function directMetadataModels() {
  const items = directProviderMetadataProfile()?.modelCatalog?.items;
  if (!Array.isArray(items)) return [];
  return items
    .map((model) => {
      const id = String(model?.id || model?.model || "").trim();
      const modelId = String(model?.model || model?.id || "").trim();
      if (!id && !modelId) return null;
      return {
        ...model,
        id: id || modelId,
        model: modelId || id,
        displayName: String(model?.displayName || model?.display_name || modelId || id).trim(),
        hidden: Boolean(model?.hidden),
        isDefault: Boolean(model?.isDefault || model?.is_default),
        supportedReasoningEfforts: Array.isArray(model?.supportedReasoningEfforts)
          ? model.supportedReasoningEfforts
          : [],
        serviceTiers: Array.isArray(model?.serviceTiers)
          ? model.serviceTiers
          : [],
      };
    })
    .filter(Boolean);
}

function effectiveModels() {
  const directModels = isDirectLiveTextSurface() ? directMetadataModels() : [];
  return directModels.length ? directModels : state.models;
}

function applyDirectMetadataModels(projection = directSurfaceProjection()) {
  if (!projection || !isDirectLiveTextSurface()) return;
  const profile = projection.providerMetadataProfile;
  const models = profile?.schema === "direct_provider_metadata_profile@1"
    ? directMetadataModels()
    : [];
  if (!models.length) {
    state.modelListStatus = projection.metadataCacheState === "missing" ? "unavailable" : state.modelListStatus;
    return;
  }
  state.models = models;
  state.modelListStatus = projection.metadataCacheState === "stale" ? "stale" : "ready";
  state.modelListError = "";
}

function directModelLabel() {
  const witness = directComposerWitness();
  const label = String(witness?.modelLabel || "").trim();
  if (!label || label === "model unknown") return "";
  return label;
}

function directReasoningLabel() {
  const witness = directComposerWitness();
  const label = String(witness?.reasoningLabel || "").trim();
  if (!label || label === "reasoning unknown") return "";
  return label;
}

function settingScopeEnabled(scope) {
  return Boolean(scope?.nextTurn || scope?.sessionDefault || scope?.projectDefault || scope?.liveThread);
}

function runtimeStateStatusFromConnection(value) {
  if (value === "connected") return "ready";
  if (value === "starting") return "loading";
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
  const models = effectiveModels();
  const defaultModel = models.find((model) => model?.isDefault) || null;
  return defaultModel?.model || defaultModel?.id || "";
}

function modelById(value) {
  const id = String(value || "").trim();
  if (!id) return null;
  return effectiveModels().find((model) => model?.id === id || model?.model === id) || null;
}

function supportedReasoningOptions() {
  const model = selectedModel();
  const options = Array.isArray(model?.supportedReasoningEfforts)
    ? model.supportedReasoningEfforts
      .map((item) => String(item?.reasoningEffort || item?.reasoning_effort || "").trim())
      .filter(Boolean)
    : [];
  if (isDirectLiveTextSurface()) return options;
  return options.length ? options : DEFAULT_REASONING_EFFORTS;
}

function reasoningLabel() {
  if (isDirectLiveTextSurface()) {
    return state.runtimeOverrides.reasoningEffort ||
      directReasoningLabel() ||
      project?.codex?.reasoningEffort ||
      defaultReasoningEffort() ||
      "unknown";
  }
  return state.runtimeOverrides.reasoningEffort || project?.codex?.reasoningEffort || selectedModel()?.defaultReasoningEffort || "unknown";
}

function requestedReasoningEffort() {
  if (state.runtimeOverrides.reasoningEffort) return state.runtimeOverrides.reasoningEffort;
  if (project?.codex?.reasoningEffort) return project.codex.reasoningEffort;
  if (isDirectLiveTextSurface()) return defaultReasoningEffort() || null;
  return null;
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
  if (isDirectLiveTextSurface()) {
    return String(selectedModel()?.defaultServiceTier || "").trim();
  }
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
  if (isDirectLiveTextSurface()) {
    const witness = directComposerWitness();
    const quota = String(witness?.quotaLabel || "").trim();
    const usage = String(witness?.usageLabel || "").trim();
    const quotaState = String(witness?.quotaState || "").trim();
    if (usage && usage !== "usage unknown" && (!quota || quota === "quota unknown" || quotaState === "unknown")) return usage;
    if (quota && usage && usage !== "usage unknown") return `${quota} / ${usage}`;
    if (quota) return quota;
  }
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

function directContextWindowFromProjection(projection = directSurfaceProjection()) {
  const profile = projection?.providerMetadataProfile || null;
  const activeId = state.runtimeOverrides.model || profile?.runtimeSettings?.active?.model || profile?.modelCatalog?.defaultModel || "";
  const models = Array.isArray(profile?.modelCatalog?.items) ? profile.modelCatalog.items : [];
  const selected = models.find((model) => (
    String(model?.id || "") === String(activeId || "") ||
    String(model?.model || "") === String(activeId || "")
  )) || models.find((model) => model?.isDefault) || models[0] || null;
  return Number(profile?.usage?.context?.modelContextWindow || selected?.contextWindow || selected?.maxContextWindow || 0);
}

function directLatestUsageForCurrentThread(projection = directSurfaceProjection()) {
  const currentThreadId = String(state.threadId || "").trim();
  const byThread = Array.isArray(projection?.agentUsageStatus?.latestUsageByThread)
    ? projection.agentUsageStatus.latestUsageByThread
    : [];
  if (currentThreadId) {
    const scoped = byThread.find((usage) => String(usage?.threadId || usage?.sessionId || "").trim() === currentThreadId);
    if (scoped) return scoped;
    const latest = projection?.agentUsageStatus?.latestUsage || null;
    const latestThreadId = String(latest?.threadId || latest?.sessionId || "").trim();
    return latestThreadId && latestThreadId === currentThreadId ? latest : null;
  }
  return projection?.agentUsageStatus?.latestUsage || null;
}

function directContextUsageProjection() {
  const witness = directComposerWitness();
  const projection = directSurfaceProjection();
  const contextState = String(witness?.contextState || "unknown").trim();
  const preview = projection?.contextPreview || {};
  const summary = preview.rendererSafeSummary || {};
  const blockerCount = Number(summary.blockerCount || 0);
  const latestUsage = directLatestUsageForCurrentThread(projection) || {};
  const window = directContextWindowFromProjection(projection);
  const tokens = Number(latestUsage.inputTokensKnown ?? projection?.providerMetadataProfile?.usage?.context?.usedTokens ?? projection?.providerMetadataProfile?.usage?.context?.tokensInWindow ?? 0);
  if (Number.isFinite(window) && window > 0 && Number.isFinite(tokens) && tokens > 0) {
    const remaining = remainingContextPercent(tokens, window);
    const usedPercent = remaining == null ? null : Math.max(0, Math.min(100, 100 - remaining));
    const tokenLabel = formatCompactTokens(tokens);
    const windowLabel = formatCompactTokens(window);
    const compactLabel = usedPercent == null ? `context ${tokenLabel}` : `context ${usedPercent}%`;
    const detail = usedPercent == null ? `context: ${tokenLabel} tokens used` : `context: ${usedPercent}% used`;
    const label = windowLabel ? `${detail} · ${tokenLabel} / ${windowLabel} window` : detail;
    return {
      label: [label, blockerCount ? `${blockerCount} blocker${blockerCount === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · "),
      compactLabel,
      status: blockerCount ? "blocked" : "available",
      percentUsed: usedPercent,
      percentRemaining: remaining,
      tokensInContext: tokens,
      totalTokens: numericField(latestUsage, "totalTokensKnown") ?? null,
      modelContextWindow: window,
      observedAt: latestUsage.observedAt || projection?.generatedAt || "",
      tokenUsage: {
        threadId: latestUsage.threadId || "",
        turnId: latestUsage.turnId || "",
        total: {
          totalTokens: Number(latestUsage.totalTokensKnown ?? tokens),
          inputTokens: tokens,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
        },
        last: {
          totalTokens: tokens,
          inputTokens: tokens,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
        },
        modelContextWindow: window,
      },
      evidenceRefs: [evidenceRef("direct_agent_usage", "Direct provider usage rows supplied latest input tokens and model metadata supplied context window", {
        confidence: "declared",
        status: "fresh",
      })],
      directContextPreview: preview,
    };
  }
  const contextLabel = String(witness?.contextLabel || "").trim();
  const scopedContextLabel = state.threadId ? "" : contextLabel;
  const label = [
    scopedContextLabel || (window ? `context fill unknown · ${formatCompactTokens(window)} window` : "context preview unknown"),
    blockerCount ? `${blockerCount} blocker${blockerCount === 1 ? "" : "s"}` : "",
  ].filter(Boolean).join(" · ");
  return {
    label,
    compactLabel: window ? "context unknown" : scopedContextLabel || "context unknown",
    status: blockerCount ? "blocked" : contextState === "diagnostic" ? "not_exposed" : contextState || "unknown",
    modelContextWindow: window || null,
    observedAt: projection?.generatedAt || "",
    evidenceRefs: [evidenceRef("direct_context_packet_preview", label, {
      status: blockerCount ? "blocked" : window ? "unavailable" : "fresh",
      confidence: preview.previewDigest ? "declared" : "unknown",
    })],
    directContextPreview: preview,
  };
}

function contextUsageProjection() {
  if (isDirectLiveTextSurface()) {
    return directContextUsageProjection();
  }
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

function analyticsNumber(value, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  if (Math.abs(number) >= 1_000_000) return `${(number / 1_000_000).toFixed(Math.abs(number) >= 10_000_000 ? 0 : 1)}M`;
  if (Math.abs(number) >= 1000) return `${(number / 1000).toFixed(Math.abs(number) >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(number));
}

function analyticsPercent(value, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return `${Math.max(0, Math.min(100, Math.round(number)))}%`;
}

function analyticsNullableNumber(value) {
  if (value === null || value === undefined || value === "") return NaN;
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function analyticsDuration(valueMs) {
  const number = Number(valueMs);
  if (!Number.isFinite(number) || number < 0) return "—";
  return formatElapsedDuration(number / 1000);
}

function analyticsSectionAvailable(section) {
  return section && !["unavailable", "unknown", "not_exposed", "failed"].includes(String(section.status || ""));
}

function analyticsSourceLabel(projection) {
  const posture = projection?.sourcePosture || {};
  const source = String(posture.primarySource || projection?.tokens?.source || projection?.context?.source || "unknown").replace(/_/g, " ");
  const confidence = String(posture.confidence || projection?.tokens?.confidence || projection?.context?.confidence || "unknown").replace(/_/g, " ");
  return `${source} · ${confidence}`;
}

function liveRuntimeAnalyticsProjection() {
  const context = contextUsageProjection();
  const quotaSnapshot = selectRateLimitSnapshot();
  const tokenUsage = state.tokenUsage || {};
  const total = tokenUsage.total || {};
  const last = tokenUsage.last || {};
  const turns = Array.from(state.turnActivityMap.values());
  const completedTurns = turns.filter((activity) => activity?.completedAt || String(activity?.status || "").includes("completed")).length;
  const activeTurns = turnIsActive() ? 1 : 0;
  const commandCount = countCodexItems(new Set(["commandExecution"]));
  const patchCount = countCodexItems(new Set(["fileChange"]));
  const subagentCount = countCodexItems(new Set(["collabAgentToolCall"]));
  const otherToolCount = countCodexItems(new Set(["mcpToolCall", "dynamicToolCall", "webSearch", "imageGeneration"]));
  const requestRows = Array.from(state.serverRequests.values());
  const requestCount = requestRows.length;
  const pendingRequests = requestRows.filter((request) => String(request?.status || "").toLowerCase().includes("pending")).length;
  const observedAt = nowIso();
  const hasTokens = Boolean(state.tokenUsage);
  const quotaEntries = quotaSnapshot ? quotaWindows(quotaSnapshot).map((entry, index) => ({
    windowKind: entry.label === "W" ? "weekly" : entry.label,
    windowId: entry.label || `window-${index + 1}`,
    name: entry.label,
    remainingPercent: entry.available,
    usedPercent: Number.isFinite(Number(entry.available)) ? 100 - Number(entry.available) : null,
    resetsAt: entry.window?.resetsAt || entry.window?.resets_at || entry.window?.resetAt || entry.window?.reset_at || "",
    windowDurationMins: entry.window?.windowDurationMins || entry.window?.window_duration_mins || null,
    source: "appserver_native",
    confidence: "provider_exact",
  })) : [];
  const toolTotal = commandCount + patchCount + subagentCount + otherToolCount;
  const projection = {
    schema: "runtime_analytics_projection@1",
    adapterVersion: "renderer-live-analytics@1",
    projectId: project?.id || "",
    threadId: state.threadId || "",
    runtimePath: isDirectLiveTextSurface() ? "direct-implementation" : "app-server",
    status: hasTokens || analyticsSectionAvailable(context) || quotaEntries.length || turns.length || toolTotal || requestCount ? "available" : "unavailable",
    generatedAt: observedAt,
    sourcePosture: {
      adapterKind: isDirectLiveTextSurface() ? "direct" : "appserver",
      primarySource: hasTokens ? "appserver_native" : "renderer_observation",
      confidence: hasTokens ? "runtime_exact" : "observed",
      freshness: "live",
      observedAt,
    },
    tokens: hasTokens ? {
      status: "available",
      source: "appserver_native",
      confidence: "runtime_exact",
      observedAt: state.tokenUsageObservedAt ? new Date(state.tokenUsageObservedAt).toISOString() : observedAt,
      inputTokens: numericField(total, "inputTokens"),
      cachedInputTokens: numericField(total, "cachedInputTokens"),
      nonCachedInputTokens: numericField(total, "inputTokens") === null
        ? null
        : Math.max(0, Number(total.inputTokens || 0) - Number(total.cachedInputTokens || 0)),
      outputTokens: numericField(total, "outputTokens"),
      reasoningTokens: numericField(total, "reasoningOutputTokens"),
      totalTokens: numericField(total, "totalTokens"),
      usageScope: "thread_total",
      billingGrade: false,
      evidenceRefs: [evidenceRef("app_server_probe", "thread/tokenUsage/updated supplied live token usage", { confidence: "proven" })],
      blockers: [],
    } : {
      status: "unavailable",
      source: "unavailable",
      confidence: "unavailable",
      observedAt: "",
      inputTokens: null,
      cachedInputTokens: null,
      nonCachedInputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      totalTokens: null,
      usageScope: "",
      billingGrade: false,
      evidenceRefs: [],
      blockers: ["token_usage_unavailable"],
    },
    context: {
      status: context.status || "unknown",
      source: context.status === "available" ? "appserver_native" : "renderer_observation",
      confidence: context.status === "available" ? "runtime_exact" : "observed",
      observedAt: context.observedAt || "",
      modelContextWindow: context.modelContextWindow || tokenUsage.modelContextWindow || null,
      inputTokens: last.inputTokens || last.totalTokens || context.tokensInContext || null,
      usedPercent: context.percentUsed ?? null,
      evidenceRefs: context.evidenceRefs || [],
      blockers: context.status === "available" ? [] : ["context_usage_unavailable"],
    },
    turns: {
      status: turns.length || activeTurns ? "available" : "unavailable",
      source: "renderer_observation",
      confidence: "observed",
      observedAt,
      started: turns.length,
      completed: completedTurns,
      active: activeTurns,
      durationMs: sessionDurationMs() || null,
      timeToFirstTokenMs: null,
      evidenceRefs: [evidenceRef("renderer_observation", "Renderer turn activity map supplied active thread timing", { confidence: "observed" })],
      blockers: [],
    },
    tools: {
      status: toolTotal ? "available" : "unavailable",
      source: "renderer_observation",
      confidence: "observed",
      observedAt,
      total: toolTotal,
      completed: toolTotal,
      failed: 0,
      commands: commandCount,
      patches: patchCount,
      subagents: subagentCount,
      byKind: [
        { xValue: "commands", yValue: commandCount },
        { xValue: "patches", yValue: patchCount },
        { xValue: "subagents", yValue: subagentCount },
        { xValue: "other tools", yValue: otherToolCount },
      ].filter((point) => point.yValue > 0),
      evidenceRefs: [evidenceRef("renderer_observation", "Renderer item map supplied tool activity counts", { confidence: "observed" })],
      blockers: [],
    },
    requests: {
      status: requestCount ? "available" : "unavailable",
      source: "renderer_observation",
      confidence: "observed",
      observedAt,
      total: requestCount,
      pending: pendingRequests,
      resolved: Math.max(0, requestCount - pendingRequests),
      failed: 0,
      byKind: [],
      evidenceRefs: [evidenceRef("renderer_observation", "Renderer server request map supplied request counts", { confidence: "observed" })],
      blockers: [],
    },
    quota: {
      status: quotaEntries.length ? "available" : "unavailable",
      source: quotaEntries.length ? "appserver_native" : "unavailable",
      confidence: quotaEntries.length ? "provider_exact" : "unavailable",
      observedAt: state.rateLimitsObservedAt ? new Date(state.rateLimitsObservedAt).toISOString() : "",
      planType: state.rateLimits?.planType || state.rateLimits?.plan_type || "",
      windows: quotaEntries,
      evidenceRefs: quotaEntries.length ? [evidenceRef("provider_quota", "account/rateLimits/read supplied quota windows", { confidence: "proven" })] : [],
      blockers: quotaEntries.length ? [] : ["quota_unavailable"],
    },
    series: {
      token_mix: [
        { xValue: "input", yValue: Number(total.inputTokens || 0) },
        { xValue: "cached", yValue: Number(total.cachedInputTokens || 0) },
        { xValue: "output", yValue: Number(total.outputTokens || 0) },
        { xValue: "reasoning", yValue: Number(total.reasoningOutputTokens || 0) },
      ].filter((point) => point.yValue > 0),
      tool_kind_mix: [
        { xValue: "commands", yValue: commandCount },
        { xValue: "patches", yValue: patchCount },
        { xValue: "subagents", yValue: subagentCount },
        { xValue: "other tools", yValue: otherToolCount },
      ].filter((point) => point.yValue > 0),
      request_kind_mix: [],
      turn_status_mix: [
        { xValue: "completed", yValue: completedTurns },
        { xValue: "active", yValue: activeTurns },
      ].filter((point) => point.yValue > 0),
    },
    blockers: [],
    evidenceRefs: [evidenceRef("renderer_observation", "Floating analytics panel live fallback projection", { confidence: "observed" })],
    privacy: {
      rawPromptIncluded: false,
      rawResponseIncluded: false,
      rawProviderFrameIncluded: false,
      rawTokenDetailsIncluded: false,
      rawPathIncluded: false,
      rawSecretIncluded: false,
      billingGrade: false,
      costComputed: false,
    },
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  return projection;
}

function activeThreadAnalyticsProjection() {
  const direct = directSurfaceProjection()?.runtimeAnalyticsProjection;
  if (direct?.schema === "runtime_analytics_projection@1") return direct;
  return liveRuntimeAnalyticsProjection();
}

function analyticsResetTimestampMs(window) {
  const numeric = resetTimestampMs(window);
  if (numeric) return numeric;
  const raw = String(window?.resetsAt || window?.resetAt || "").trim();
  if (!raw) return 0;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function analyticsQuotaWindowLabel(window) {
  const duration = Number(window?.windowDurationMins || 0);
  const rawKind = String(window?.windowKind || window?.name || window?.windowId || "").toLowerCase();
  if (duration === 300 || rawKind.includes("5h") || rawKind.includes("five")) return "5h";
  if (duration === 10080 || rawKind.includes("week") || rawKind === "w") return "W";
  if (duration > 0 && duration < 60) return `${duration}m`;
  if (duration > 0 && duration % 1440 === 0) return `${duration / 1440}d`;
  if (duration > 0 && duration % 60 === 0) return `${duration / 60}h`;
  return window?.name || window?.windowKind || "quota";
}

function analyticsQuotaResetLabel(window) {
  const timestamp = analyticsResetTimestampMs(window);
  if (!timestamp) return "--:--";
  const date = new Date(timestamp);
  const label = analyticsQuotaWindowLabel(window);
  const options = label === "W"
    ? { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }
    : { hour: "2-digit", minute: "2-digit", hour12: false };
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

function analyticsQuotaLabel(projection) {
  const windows = Array.isArray(projection?.quota?.windows) ? projection.quota.windows : [];
  if (!windows.length) return "quota unavailable";
  return windows.slice(0, 2).map((window) => {
    const remaining = Number.isFinite(Number(window.remainingPercent))
      ? Number(window.remainingPercent)
      : Number.isFinite(Number(window.usedPercent))
        ? 100 - Number(window.usedPercent)
        : null;
    return `${analyticsQuotaWindowLabel(window)} ${analyticsPercent(remaining)} ${analyticsQuotaResetLabel(window)}`;
  }).join(" / ");
}

function analyticsEl(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== "") node.textContent = text;
  return node;
}

function analyticsMetricCard(label, value, note = "", accent = "") {
  const card = analyticsEl("div", `thread-analytics-card${accent ? ` ${accent}` : ""}`);
  card.appendChild(analyticsEl("span", "thread-analytics-card-label", label));
  card.appendChild(analyticsEl("strong", "thread-analytics-card-value", value));
  if (note) card.appendChild(analyticsEl("span", "thread-analytics-card-note", note));
  return card;
}

function analyticsGauge(label, percent, detail) {
  const wrapper = analyticsEl("div", "thread-analytics-gauge-card");
  const gauge = analyticsEl("div", "thread-analytics-gauge");
  const value = Number(percent);
  const safe = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  gauge.style.setProperty("--analytics-gauge", `${safe}%`);
  gauge.appendChild(analyticsEl("span", "", Number.isFinite(value) ? `${Math.round(safe)}%` : "—"));
  const copy = analyticsEl("div", "thread-analytics-gauge-copy");
  copy.appendChild(analyticsEl("span", "thread-analytics-card-label", label));
  copy.appendChild(analyticsEl("strong", "thread-analytics-card-value", detail || (Number.isFinite(value) ? `${Math.round(safe)}%` : "unknown")));
  wrapper.append(gauge, copy);
  return wrapper;
}

function analyticsBarChart(title, rows, valueFormatter = analyticsNumber) {
  const section = analyticsEl("section", "thread-analytics-chart");
  section.appendChild(analyticsEl("h3", "", title));
  const validRows = rows.filter((row) => Number(row?.value ?? row?.yValue) > 0);
  if (!validRows.length) {
    section.appendChild(analyticsEl("p", "thread-analytics-empty", "No evidence yet."));
    return section;
  }
  const max = Math.max(...validRows.map((row) => Number(row.value ?? row.yValue) || 0), 1);
  const list = analyticsEl("div", "thread-analytics-bars");
  for (const row of validRows.slice(0, 7)) {
    const value = Number(row.value ?? row.yValue) || 0;
    const item = analyticsEl("div", "thread-analytics-bar-row");
    item.appendChild(analyticsEl("span", "thread-analytics-bar-label", String(row.label ?? row.xValue ?? "unknown")));
    const rail = analyticsEl("span", "thread-analytics-bar");
    const fill = analyticsEl("span", "thread-analytics-bar-fill");
    fill.style.width = `${Math.max(2, Math.round((value / max) * 100))}%`;
    rail.appendChild(fill);
    item.appendChild(rail);
    item.appendChild(analyticsEl("span", "thread-analytics-bar-value", valueFormatter(value)));
    list.appendChild(item);
  }
  section.appendChild(list);
  return section;
}

function analyticsShortId(value) {
  const text = String(value || "").trim();
  if (!text) return "unknown";
  if (text.length <= 18) return text;
  return `${text.slice(0, 8)}…${text.slice(-6)}`;
}

function analyticsModelEffortLabel(row = {}) {
  return [
    row.model || "model unknown",
    row.reasoningEffort ? `${row.reasoningEffort}` : "effort default/unknown",
    row.serviceTier ? `${row.serviceTier}` : "",
  ].filter(Boolean).join(" · ");
}

function analyticsTokenSplitLabel(row = {}) {
  return [
    `in ${analyticsNumber(row.inputTokens)}`,
    `uncached ${analyticsNumber(row.nonCachedInputTokens)}`,
    `cached ${analyticsNumber(row.cachedInputTokens)}`,
    `out ${analyticsNumber(row.outputTokens)}`,
    `reason ${analyticsNumber(row.reasoningTokens)}`,
    `total ${analyticsNumber(row.totalTokens)}`,
  ].join(" · ");
}

function analyticsDetailSection(title, rows, rowRenderer, emptyText = "No detail evidence yet.") {
  const section = analyticsEl("section", "thread-analytics-detail");
  section.appendChild(analyticsEl("h3", "", title));
  const list = analyticsEl("div", "thread-analytics-detail-list");
  const safeRows = Array.isArray(rows) ? rows : [];
  if (!safeRows.length) {
    list.appendChild(analyticsEl("p", "thread-analytics-empty", emptyText));
  } else {
    for (const row of safeRows) {
      const rendered = rowRenderer(row);
      if (rendered) list.appendChild(rendered);
    }
  }
  section.appendChild(list);
  return section;
}

function analyticsDetailRow(primary, secondary = "", meta = "") {
  const row = analyticsEl("div", "thread-analytics-detail-row");
  row.appendChild(analyticsEl("strong", "thread-analytics-detail-primary", primary));
  if (secondary) row.appendChild(analyticsEl("span", "thread-analytics-detail-secondary", secondary));
  if (meta) row.appendChild(analyticsEl("span", "thread-analytics-detail-meta", meta));
  return row;
}

function renderThreadAnalyticsPanel() {
  if (!els.threadAnalyticsPanel || !els.threadAnalyticsPanelBody) return;
  const dock = ["float", "left", "right", "bottom"].includes(state.analyticsPanelDock) ? state.analyticsPanelDock : "right";
  els.threadAnalyticsPanel.hidden = !state.analyticsPanelOpen;
  els.threadAnalyticsPanel.className = `thread-analytics-panel dock-${dock}`;
  els.analyticsPanelButton?.setAttribute("aria-expanded", state.analyticsPanelOpen ? "true" : "false");
  els.analyticsPanelButton?.classList.toggle("ready", state.analyticsPanelOpen);
  els.analyticsPanelButton?.classList.toggle("unknown", !state.analyticsPanelOpen);
  for (const button of els.threadAnalyticsDockButtons?.querySelectorAll?.("[data-analytics-dock]") || []) {
    button.classList.toggle("active", button.dataset.analyticsDock === dock);
  }
  if (!state.analyticsPanelOpen) return;

  const projection = activeThreadAnalyticsProjection();
  const title = state.threadTitle || state.threadId || "Thread analytics";
  if (els.threadAnalyticsPanelTitle) els.threadAnalyticsPanelTitle.textContent = title;
  if (els.threadAnalyticsPanelMeta) {
    const freshness = projection?.sourcePosture?.freshness || "live";
    els.threadAnalyticsPanelMeta.textContent = `${projection?.runtimePath || "runtime"} · ${analyticsSourceLabel(projection)} · ${freshness}`;
  }

  const tokens = projection.tokens || {};
  const context = projection.context || {};
  const turns = projection.turns || {};
  const tools = projection.tools || {};
  const requests = projection.requests || {};
  const activeLabel = turnIsActive()
    ? `Active ${activeTurnElapsedLabel() || "now"}`
    : "Idle";
  const tokenTotal = analyticsNullableNumber(tokens.totalTokens);
  const inputTokens = analyticsNullableNumber(tokens.inputTokens);
  const cachedTokens = analyticsNullableNumber(tokens.cachedInputTokens);
  const nonCachedTokens = analyticsNullableNumber(tokens.nonCachedInputTokens);
  const outputTokens = analyticsNullableNumber(tokens.outputTokens);
  const reasoningTokens = analyticsNullableNumber(tokens.reasoningTokens);
  const contextUsed = analyticsNullableNumber(context.usedPercent);
  const contextDetail = Number.isFinite(contextUsed)
    ? `${analyticsNumber(context.inputTokens)} / ${analyticsNumber(context.modelContextWindow)}`
    : context.modelContextWindow
      ? `${analyticsNumber(context.modelContextWindow)} window`
      : "context unknown";

  els.threadAnalyticsPanelBody.innerHTML = "";
  if (projection.status === "unavailable") {
    const empty = analyticsEl("div", "thread-analytics-empty-state");
    empty.appendChild(analyticsEl("strong", "", "No analytics evidence for this thread yet."));
    empty.appendChild(analyticsEl("p", "", "Send a turn or refresh runtime metadata; this panel will fill from direct runtime facts or live app-server observations."));
    els.threadAnalyticsPanelBody.appendChild(empty);
    return;
  }

  const hero = analyticsEl("section", "thread-analytics-hero");
  hero.appendChild(analyticsMetricCard("Thread state", activeLabel, `${analyticsNumber(turns.completed || 0)} completed · ${analyticsNumber(turns.active || 0)} active`, turnIsActive() ? "live" : ""));
  hero.appendChild(analyticsGauge("Context used", contextUsed, contextDetail));
  hero.appendChild(analyticsMetricCard("Quota", analyticsQuotaLabel(projection), projection.quota?.status === "available" ? "provider window" : "not exposed", "quota"));
  els.threadAnalyticsPanelBody.appendChild(hero);

  const metrics = analyticsEl("section", "thread-analytics-grid");
  metrics.appendChild(analyticsMetricCard("Total tokens", analyticsNumber(tokenTotal), tokens.status === "available" ? tokens.usageScope || "known" : "not exposed", "tokens"));
  metrics.appendChild(analyticsMetricCard("Input", analyticsNumber(inputTokens), [
    Number.isFinite(cachedTokens) ? `${analyticsNumber(cachedTokens)} cached` : "cache unknown",
    Number.isFinite(nonCachedTokens) ? `${analyticsNumber(nonCachedTokens)} uncached` : "uncached unknown",
  ].join(" · ")));
  metrics.appendChild(analyticsMetricCard("Output", analyticsNumber(outputTokens), Number.isFinite(reasoningTokens) ? `${analyticsNumber(reasoningTokens)} reasoning` : "reasoning unknown"));
  metrics.appendChild(analyticsMetricCard("Turns", `${analyticsNumber(turns.started || 0)} started`, turns.durationMs ? `${analyticsDuration(turns.durationMs)} wall span` : "duration unknown"));
  metrics.appendChild(analyticsMetricCard("Tools", analyticsNumber(tools.total || 0), `${analyticsNumber(tools.commands || 0)} cmd · ${analyticsNumber(tools.patches || 0)} patch`));
  metrics.appendChild(analyticsMetricCard("Requests", analyticsNumber(requests.total || 0), `${analyticsNumber(requests.pending || 0)} pending`));
  els.threadAnalyticsPanelBody.appendChild(metrics);

  const charts = analyticsEl("section", "thread-analytics-chart-grid");
  charts.appendChild(analyticsBarChart("Token mix", [
    { label: "uncached", value: nonCachedTokens },
    { label: "cached", value: cachedTokens },
    { label: "output", value: outputTokens },
    { label: "reasoning", value: reasoningTokens },
  ].filter((row) => Number.isFinite(row.value) && row.value > 0), analyticsNumber));
  charts.appendChild(analyticsBarChart("Tool mix", [
    ...(Array.isArray(projection.series?.tool_kind_mix) ? projection.series.tool_kind_mix : []),
    ...(!projection.series?.tool_kind_mix?.length ? [
      { xValue: "commands", yValue: tools.commands || 0 },
      { xValue: "patches", yValue: tools.patches || 0 },
      { xValue: "subagents", yValue: tools.subagents || 0 },
    ] : []),
  ], analyticsNumber));
  els.threadAnalyticsPanelBody.appendChild(charts);

  const turnRows = Array.isArray(projection.turnUsageRows) ? projection.turnUsageRows.slice(0, 8) : [];
  const agentRows = Array.isArray(projection.agentUsageRows) ? projection.agentUsageRows.slice(0, 8) : [];
  const edgeRows = Array.isArray(projection.parentTurnAgentEdges) ? projection.parentTurnAgentEdges.slice(0, 6) : [];
  const detailGrid = analyticsEl("section", "thread-analytics-detail-grid");
  detailGrid.appendChild(analyticsDetailSection("Turn usage", turnRows, (row) => analyticsDetailRow(
    `${analyticsShortId(row.turnId)} · ${row.agentKind || "agent"}`,
    analyticsModelEffortLabel(row),
    analyticsTokenSplitLabel(row),
  )));
  detailGrid.appendChild(analyticsDetailSection("Agent usage", agentRows, (row) => analyticsDetailRow(
    `${analyticsShortId(row.agentThreadId)} · ${row.agentKind || "agent"}`,
    analyticsModelEffortLabel(row),
    `${analyticsNumber(row.turnCount)} turn(s) · ${analyticsTokenSplitLabel(row)}`,
  )));
  if (edgeRows.length) {
    detailGrid.appendChild(analyticsDetailSection("Sub-agent links", edgeRows, (row) => analyticsDetailRow(
      `${analyticsShortId(row.parentThreadId)} → ${analyticsShortId(row.childThreadId)}`,
      analyticsModelEffortLabel(row),
      `${row.parentTurnResolved ? "parent turn resolved" : "parent thread only"} · ${analyticsTokenSplitLabel(row)}`,
    )));
  }
  els.threadAnalyticsPanelBody.appendChild(detailGrid);

  const evidence = analyticsEl("section", "thread-analytics-evidence");
  const observedAt = projection.sourcePosture?.observedAt || tokens.observedAt || context.observedAt || projection.generatedAt || "";
  evidence.appendChild(analyticsEl("span", "", `source: ${analyticsSourceLabel(projection)}`));
  evidence.appendChild(analyticsEl("span", "", `observed: ${observedAt ? new Date(observedAt).toLocaleString() : "unknown"}`));
  if (Array.isArray(projection.blockers) && projection.blockers.length) {
    evidence.appendChild(analyticsEl("span", "", `blockers: ${projection.blockers.slice(0, 3).join(", ")}`));
  }
  els.threadAnalyticsPanelBody.appendChild(evidence);
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
  if (state.primaryThreadActive) return true;
  const activeId = String(state.activeTurnId || state.turnId || "");
  if (!activeId) return false;
  const activity = state.turnActivityMap.get(activeId);
  return Boolean(activity && !activity.completedAt && activeTurnStatus(activity.status));
}

function currentActiveTurnId() {
  const candidates = [state.activeTurnId, state.turnId].map((id) => String(id || "").trim()).filter(Boolean);
  for (const id of candidates) {
    const activity = state.turnActivityMap.get(id);
    if (activity && !activity.completedAt && activeTurnStatus(activity.status)) return id;
  }
  return "";
}

function currentActiveTurnActivity() {
  const id = currentActiveTurnId();
  return id ? state.turnActivityMap.get(id) || null : null;
}

function formatElapsedDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function turnDurationLabel(turnKey) {
  const activity = state.turnActivityMap.get(String(turnKey || "").trim());
  if (!activity) return "";
  const durationMs = Number(activity.durationMs);
  if (Number.isFinite(durationMs) && durationMs >= 0) return formatElapsedDuration(durationMs / 1000);
  const startedAt = Number(activity.startedAt || 0);
  const completedAt = Number(activity.completedAt || 0);
  if (startedAt > 0 && completedAt >= startedAt) return formatElapsedDuration(completedAt - startedAt);
  return "";
}

function activeTurnElapsedLabel() {
  const activity = currentActiveTurnActivity();
  const startedAt = Number(activity?.startedAt || 0);
  if (!startedAt) return "";
  return formatElapsedDuration(Date.now() / 1000 - startedAt);
}

function currentQueuedComposerMessages() {
  const threadId = String(state.threadId || "");
  const projectId = String(project?.id || "");
  if (!threadId) return [];
  return state.queuedComposerMessages.filter((item) => (
    String(item?.threadId || "") === threadId &&
    (!projectId || !item?.projectId || String(item.projectId) === projectId)
  ));
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
    connectionAvailable() ? "runtime_snapshot" : "project_config",
    connectionAvailable() ? "Main-owned Codex app-server connection ref" : "No managed app-server connection payload",
    { confidence: connectionAvailable() ? "declared" : "configured" },
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
  const directWitness = isDirectLiveTextSurface() ? directComposerWitness() : null;
  const directQuotaChip = isDirectLiveTextSurface() ? directRuntimeWitnessChip("quota") : null;
  const directModelDisplay = isDirectLiveTextSurface() ? directModelLabel() : "";
  const directReasoningDisplay = isDirectLiveTextSurface() ? directReasoningLabel() : "";
  const effectiveProviderQuota = directWitness ? {
    canRead: false,
    readMethod: "",
    eventName: "",
    label: directWitness.quotaLabel || "quota unknown",
    status: directWitness.quotaState === "blocked" ? "blocked" : "not_exposed",
    error: "",
    evidenceRefs: [evidenceRef("direct_runtime_witness", directQuotaChip?.label || "Direct quota/rate witness", {
      status: directWitness.quotaState || "unknown",
      confidence: directWitness.runtimeWitnessDigest ? "declared" : "unknown",
    })],
  } : providerQuota;
  const usageLabel = directWitness?.usageLabel && directWitness.usageLabel !== "usage unknown"
    ? directWitness.usageLabel
    : effectiveProviderQuota.status === "available"
      ? effectiveProviderQuota.label
    : contextPressure.status === "available"
      ? contextPressure.label
      : turnCount || commandCount || approvalCount || toolCallCount
      ? `activity: ${turnCount} turn${turnCount === 1 ? "" : "s"}`
      : "usage: unknown";
  const ledgerStatus = state.usageLedgerStatus || {};

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
      kind: connection?.runtime || (connectionAvailable() ? "remote" : "offline"),
      label: connectionLabel(),
      truth: connectionAvailable() ? "runtime_declared" : "unknown",
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
      label: directModelDisplay || modelLabel(),
      source: directModelDisplay ? "direct_runtime_witness" : state.runtimeOverrides.model ? "operator_requested" : state.activeModel ? "runtime_reported" : project?.codex?.model ? "project_config" : defaultModelId() ? "runtime_default" : "unknown",
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
      selectedId: activeModelId() || directModelDisplay,
      truth: directModelDisplay ? "runtime_declared" : state.runtimeOverrides.model ? "operator_requested" : state.activeModel ? "runtime_declared" : project?.codex?.model ? "project_configured" : defaultModelId() ? "runtime_declared" : "unknown",
      evidenceRefs: [
        evidenceRef(directModelDisplay ? "direct_runtime_witness" : state.runtimeOverrides.model ? "operator_action" : state.activeModel || defaultModelId() ? "app_server_probe" : "project_config", directModelDisplay ? directRuntimeWitnessChip("model")?.label || "Direct runtime model witness" : state.runtimeOverrides.model ? "Operator selected model for subsequent turns" : state.activeModel ? "Thread/model response" : defaultModelId() ? "model/list default model" : "Project model setting", {
          confidence: directModelDisplay ? "declared" : state.runtimeOverrides.model ? "configured" : state.activeModel || defaultModelId() ? "declared" : project?.codex?.model ? "configured" : "unknown",
        }),
      ],
    },
    reasoning: {
      label: `reasoning: ${directReasoningDisplay || reasoningLabel()}`,
      selected: directReasoningDisplay || reasoningLabel(),
      supported: supportedReasoningOptions(),
      selection: {
        canSetNextTurn: canOverrideReasoning,
        canSetSessionDefault: false,
        canSetProjectDefault: false,
        canLiveUpdate: false,
        enabledScopes: canOverrideReasoning ? ["next_turn"] : [],
        unsupportedReason: canOverrideReasoning ? "" : "Provider profile does not expose next-turn reasoning override.",
      },
      truth: directReasoningDisplay ? "runtime_declared" : state.runtimeOverrides.reasoningEffort ? "operator_requested" : project?.codex?.reasoningEffort ? "project_configured" : selectedModel()?.defaultReasoningEffort ? "runtime_declared" : "unknown",
      evidenceRefs: [
        evidenceRef(directReasoningDisplay ? "direct_runtime_witness" : state.runtimeOverrides.reasoningEffort ? "operator_action" : "project_config", directReasoningDisplay ? directRuntimeWitnessChip("reasoning")?.label || "Direct runtime reasoning witness" : state.runtimeOverrides.reasoningEffort ? "Operator selected reasoning effort for subsequent turns" : project?.codex?.reasoningEffort ? "Project reasoning effort setting" : "Model default reasoning effort", {
          confidence: directReasoningDisplay ? "declared" : state.runtimeOverrides.reasoningEffort || project?.codex?.reasoningEffort ? "configured" : selectedModel()?.defaultReasoningEffort ? "declared" : "unknown",
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
      status: effectiveProviderQuota.status === "available" || contextPressure.status === "available" || directWitness?.usageState === "fresh" || turnCount || commandCount || approvalCount || toolCallCount ? "available" : "unknown",
      providerQuota: effectiveProviderQuota,
      contextPressure,
      activity: {
        turnCount,
        commandCount,
        approvalCount,
        toolCallCount,
        sessionDurationMs: sessionDurationMs(),
        evidenceRefs: [evidenceRef("renderer_observation", "Renderer-observed thread activity", { confidence: "observed" })],
      },
      ledger: {
        enabled: ledgerStatus.enabled === true,
        status: ledgerStatus.state || "disabled",
        ledgerId: ledgerStatus.ledgerId || "",
        ledgerLabel: ledgerStatus.ledgerLabel || ledgerStatus.ledgerPath || "",
        manifestLabel: ledgerStatus.manifestLabel || ledgerStatus.manifestPath || "",
        ledgerPathEvidenceKey: ledgerStatus.ledgerPathEvidenceKey || "",
        manifestPathEvidenceKey: ledgerStatus.manifestPathEvidenceKey || "",
        queuedRows: Number(ledgerStatus.queuedRows || 0),
        droppedRows: Number(ledgerStatus.droppedRows || 0),
        rowCount: Number(ledgerStatus.rowCount || 0),
        lastError: ledgerStatus.lastError || "",
        lastObservedAt: ledgerStatus.lastObservedAt || "",
        evidenceRefs: [evidenceRef("runtime_snapshot", ledgerStatus.enabled ? "Usage ledger collector reported status" : "Usage ledger disabled", {
          confidence: ledgerStatus.enabled ? "observed" : "configured",
          status: ledgerStatus.enabled ? "fresh" : "unavailable",
        })],
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
  renderThreadAnalyticsPanel();
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

async function refreshDirectImplementationUi({ force = false } = {}) {
  if (!project?.id || !bridge?.getDirectImplementationLaneUiStatus) return;
  if (state.directUiStatusState === "loading" && !force) return;
  state.directUiStatusState = "loading";
  state.directUiStatusError = "";
  try {
    const [status, history, policy] = await Promise.all([
      bridge.getDirectImplementationLaneUiStatus(project.id),
      bridge.readDirectImplementationOperationHistory
        ? bridge.readDirectImplementationOperationHistory(project.id, { scope: "active-turn", limit: 24 })
        : Promise.resolve(null),
      bridge.getDirectImplementationPolicyView
        ? bridge.getDirectImplementationPolicyView(project.id)
        : Promise.resolve(null),
    ]);
    state.directUiStatus = status || null;
    state.directUiOperationHistory = history || null;
    state.directUiPolicyView = policy || null;
    state.directUiStatusState = "ready";
  } catch (error) {
    state.directUiStatusState = "failed";
    state.directUiStatusError = error?.message || "Direct implementation UI status unavailable.";
  }
  renderRuntimeConstitution();
}

async function refreshDirectSurfaceProjection(options = {}) {
  if (!project?.id || !isDirectLiveTextSurface() || typeof bridge?.getDirectCodexSurfaceProjection !== "function") return null;
  try {
    const projection = await bridge.getDirectCodexSurfaceProjection(project.id, {
      refreshMetadata: options.refreshMetadata === true,
      threadId: state.threadId || "",
    });
    if (projection?.schema === "direct_codex_surface_projection@1") {
      state.directSurfaceProjection = projection;
      if (connection) connection = { ...connection, directSurfaceProjection: projection };
      applyDirectMetadataModels(projection);
      if (options.render !== false) {
        renderRuntimeConstitution();
        renderComposerRuntimeBand();
        renderDirectThreadList();
      }
      return projection;
    }
  } catch (error) {
    if (options.showErrors) addSystemMessage(`Direct surface projection refresh failed: ${error.message}`);
  }
  return null;
}

function openRuntimeDrawer(tab = "runtime") {
  dismissComposerOverlay("runtime-drawer-open");
  state.runtimeDrawerOpen = true;
  state.runtimeDrawerTab = RUNTIME_DRAWER_TABS.some(([id]) => id === tab) ? tab : "runtime";
  renderRuntimeConstitution();
  if (["implementation", "history", "policy"].includes(state.runtimeDrawerTab)) {
    refreshDirectImplementationUi();
  }
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
      if (["implementation", "history", "policy"].includes(id)) refreshDirectImplementationUi();
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
  if (els.composerDispositionMenu) els.composerDispositionMenu.hidden = true;
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
    eventTargetsElement(event, els.composerDispositionMenu) ||
    eventTargetsElement(event, els.composerAccessButton) ||
    eventTargetsElement(event, els.composerModelButton) ||
    eventTargetsElement(event, els.activeTurnActions) ||
    eventTargetsElement(event, els.sendButton)
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
  const quotaWidth = Math.round(clampNumber(safeWidth * 0.42, 120, 380));
  const witnessWidth = Math.round(clampNumber(safeWidth * 0.14, 58, 150));
  const modelPillWidth = Math.round(clampNumber(safeWidth * 0.28, 88, 280));
  const controlFont = clampNumber(safeWidth / 66, 10, 12);
  const controlGap = Math.round(clampNumber(safeWidth / 108, 4, 8));
  const controlPadX = Math.round(clampNumber(safeWidth / 82, 6, 10));
  const controlHeight = Math.round(clampNumber(controlFont * 2.5, 24, 30));
  const actionWidth = Math.round(clampNumber(safeWidth * 0.18, 96, 150));
  let activeTrigger = null;
  if (state.composerMenu === "model") activeTrigger = els.composerModelButton;
  else if (state.composerMenu === "access") activeTrigger = els.composerAccessButton;
  else if (state.composerMenu === "disposition") activeTrigger = els.activeTurnActions || els.sendButton;
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
  els.composerForm.style.setProperty("--composer-control-font-size", `${controlFont.toFixed(1)}px`);
  els.composerForm.style.setProperty("--composer-control-gap", `${controlGap}px`);
  els.composerForm.style.setProperty("--composer-control-pad-x", `${controlPadX}px`);
  els.composerForm.style.setProperty("--composer-control-height", `${controlHeight}px`);
  els.composerForm.style.setProperty("--composer-action-width", `${actionWidth}px`);
  els.composerForm.dataset.composerSize = safeWidth < 390 ? "narrow" : safeWidth < 760 ? "medium" : "wide";
  document.documentElement.style.setProperty("--composer-shell-height", `${Math.round(shellRect.height || 150)}px`);
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

function updateComposerStatusTicker(active) {
  const shouldTick = Boolean(active && currentActiveTurnActivity()?.startedAt);
  if (shouldTick && !state.composerStatusInterval) {
    state.composerStatusInterval = window.setInterval(() => {
      renderComposerRuntimeBand();
      renderThreadAnalyticsPanel();
    }, 1000);
  } else if (!shouldTick && state.composerStatusInterval) {
    window.clearInterval(state.composerStatusInterval);
    state.composerStatusInterval = null;
  }
}

function renderComposerRuntimeBand() {
  if (!els.composerAccessButton || !els.composerModelButton || !els.sendButton) return;
  if (els.composerForm) els.composerForm.dataset.composerMenu = state.composerMenu || "";
  const active = turnIsActive();
  const activeTurnId = currentActiveTurnId();
  const blockers = attachmentSubmitBlockers();
  const draft = composerDraftProjection();
  const hasDraft = draft.hasContent;
  const canSteer = hasCapabilityForMutation("turns", "canSteer");
  const queuedCount = currentQueuedComposerMessages().length;
  const elapsedLabel = activeTurnElapsedLabel();
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

  const statusClass = state.turnStopping
    ? "stopping"
    : state.turnPending || state.queuedPromptDrainInProgress
      ? "pending"
      : active
        ? "active"
        : queuedCount
          ? "queued"
          : "idle";
  const statusText = state.turnStopping
    ? `Stopping${elapsedLabel ? ` ${elapsedLabel}` : ""}`
    : state.turnPending
      ? "Starting"
      : state.queuedPromptDrainInProgress
        ? "Sending queued"
        : active
          ? `Working${elapsedLabel ? ` ${elapsedLabel}` : ""}${queuedCount ? ` · Q${queuedCount}` : ""}`
          : queuedCount ? `Queued ${queuedCount}` : "Idle";
  if (els.composerTurnStatus) {
    els.composerTurnStatus.textContent = statusText;
    els.composerTurnStatus.className = `composer-turn-status ${statusClass}`;
    els.composerTurnStatus.title = active
      ? `Codex turn is active${elapsedLabel ? ` for ${elapsedLabel}` : ""}${queuedCount ? ` with ${queuedCount} queued message${queuedCount === 1 ? "" : "s"}` : ""}.`
      : queuedCount
        ? `${queuedCount} message${queuedCount === 1 ? "" : "s"} queued for the next Codex turn.`
        : "Codex thread is idle.";
  }

  if (els.composerStopButton) {
    els.composerStopButton.hidden = !active;
    els.composerStopButton.disabled = state.turnStopping || !activeTurnId;
    els.composerStopButton.title = activeTurnId
      ? "Stop the current Codex turn."
      : "Active turn id is not available yet.";
    els.composerStopButton.setAttribute("aria-label", "Stop current Codex turn");
  }

  els.sendButton.hidden = active;
  els.sendButton.textContent = "Send";
  els.sendButton.title = blockers.length
    ? "Remove or fix unsupported attachments before sending."
    : "Send this prompt to Codex.";
  els.sendButton.setAttribute("aria-label", "Send prompt to Codex");
  els.sendButton.disabled = active || els.composerInput.disabled || blockers.length > 0 || !hasDraft;

  if (els.activeTurnActions) els.activeTurnActions.hidden = !active;
  const actionDisabled = state.turnStopping || els.composerInput.disabled || blockers.length > 0 || !hasDraft;
  if (els.steerButton) {
    els.steerButton.disabled = actionDisabled || !canSteer || !activeTurnId;
    els.steerButton.title = !canSteer
      ? "Active runtime does not expose turn/steer capability."
      : !activeTurnId
        ? "Active turn id is not available yet."
        : blockers.length
          ? "Remove or fix unsupported attachments before steering."
          : hasDraft
            ? "Send this message into the active Codex turn."
            : "Write a message to steer the active Codex turn.";
    els.steerButton.setAttribute("aria-label", "Steer current Codex turn");
  }
  if (els.queueButton) {
    els.queueButton.disabled = actionDisabled;
    els.queueButton.title = blockers.length
      ? "Remove or fix unsupported attachments before queueing."
      : hasDraft
        ? "Queue this message to start after the current turn completes."
        : "Write a message to queue for the next Codex turn.";
    els.queueButton.setAttribute("aria-label", "Queue message for next Codex turn");
  }
  if (els.steerMenuButton) els.steerMenuButton.disabled = els.steerButton?.disabled ?? true;
  if (els.queueMenuButton) els.queueMenuButton.disabled = els.queueButton?.disabled ?? true;

  if (els.chooseAttachmentButton) els.chooseAttachmentButton.disabled = els.composerInput.disabled;
  if (els.pasteImageButton) els.pasteImageButton.disabled = els.composerInput.disabled;
  els.composerAccessMenu.hidden = state.composerMenu !== "access";
  els.composerModelMenu.hidden = state.composerMenu !== "model";
  if (els.composerDispositionMenu) els.composerDispositionMenu.hidden = state.composerMenu !== "disposition";
  els.composerAccessButton.setAttribute("aria-expanded", state.composerMenu === "access" ? "true" : "false");
  els.composerModelButton.setAttribute("aria-expanded", state.composerMenu === "model" ? "true" : "false");
  if (state.composerMenu === "access") renderComposerAccessMenu();
  if (state.composerMenu === "model") renderComposerModelMenu();
  updateComposerStatusTicker(active);
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
  const models = effectiveModels();
  const visible = models.filter((model) => !model?.hidden);
  const rows = visible.length ? visible : models;
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

function normalizeRuntimeOverrideValue(name, value) {
  const candidate = String(value || "").trim();
  if (!candidate) return "";
  if (name === "approvalPolicy") return APPROVAL_POLICY_OPTIONS.includes(candidate) ? candidate : "";
  if (name === "sandboxMode") return SANDBOX_MODE_OPTIONS.includes(candidate) ? candidate : "";
  if (name === "reasoningEffort") return supportedReasoningOptions().includes(candidate) ? candidate : "";
  if (name === "model") return candidate;
  return candidate;
}

function runtimePreferencesRequest(threadId = state.threadId) {
  return {
    projectId: project?.id || payload.codexConnection?.projectId || "",
    threadId: String(threadId || ""),
    sourceHome: String(state.sourceHome || ""),
    sessionFilePath: String(state.sessionFilePath || ""),
    activationEpoch: Number(payload.activationEpoch) || 0,
  };
}

function applyGlobalRuntimePreferences(defaults = {}) {
  state.runtimeOverrides.approvalPolicy = normalizeRuntimeOverrideValue("approvalPolicy", defaults.approvalPolicy);
  state.runtimeOverrides.sandboxMode = normalizeRuntimeOverrideValue("sandboxMode", defaults.sandboxMode);
  reconcileAccessOverridesWithRequirements();
}

function applyThreadRuntimePreferences(defaults = {}) {
  state.runtimeOverrides.model = normalizeRuntimeOverrideValue("model", defaults.model);
  state.runtimeOverrides.reasoningEffort = normalizeRuntimeOverrideValue("reasoningEffort", defaults.reasoningEffort);
  if (state.runtimeOverrides.reasoningEffort) {
    const supported = supportedReasoningOptions();
    if (supported.length && !supported.includes(state.runtimeOverrides.reasoningEffort)) {
      state.runtimeOverrides.reasoningEffort = selectedModel()?.defaultReasoningEffort || "";
    }
  }
}

async function loadRuntimePreferences(options = {}) {
  if (!bridge?.getRuntimePreferences) return null;
  const applyGlobal = options.applyGlobal !== false;
  const applyThread = options.applyThread !== false && Boolean(state.threadId);
  const guardThreadId = String(options.guardThreadId || options.threadId || "");
  const hasGuardSourceHome = Object.prototype.hasOwnProperty.call(options, "guardSourceHome");
  const guardSourceHome = hasGuardSourceHome ? String(options.guardSourceHome ?? "") : "";
  const hasGuardSessionFilePath = Object.prototype.hasOwnProperty.call(options, "guardSessionFilePath");
  const guardSessionFilePath = hasGuardSessionFilePath ? String(options.guardSessionFilePath ?? "") : "";
  state.runtimePreferencesStatus = "loading";
  state.runtimePreferencesError = "";
  try {
    const response = await bridge.getRuntimePreferences(runtimePreferencesRequest(options.threadId || state.threadId));
    if (response && response.ok !== false) {
      if (applyGlobal) applyGlobalRuntimePreferences(response.globalDefaults || {});
      const stillCurrentThread =
        !guardThreadId ||
        (state.threadId === guardThreadId &&
          (!hasGuardSourceHome || state.sourceHome === guardSourceHome) &&
          (!hasGuardSessionFilePath || state.sessionFilePath === guardSessionFilePath));
      if (applyThread && stillCurrentThread) applyThreadRuntimePreferences(response.threadDefaults || {});
    }
    state.runtimePreferencesStatus = "ready";
    renderRuntimeConstitution();
    return response;
  } catch (error) {
    state.runtimePreferencesStatus = "failed";
    state.runtimePreferencesError = String(error?.message || error || "Runtime preference load failed.");
    console.warn("Unable to load Codex runtime preferences", error);
    renderRuntimeConstitution();
    return null;
  }
}

async function persistRuntimePreferences(scope) {
  if (!bridge?.updateRuntimePreferences) return null;
  const request = runtimePreferencesRequest();
  if (scope === "global-access") {
    return bridge.updateRuntimePreferences({
      scope,
      approvalPolicy: state.runtimeOverrides.approvalPolicy,
      sandboxMode: state.runtimeOverrides.sandboxMode,
    });
  }
  if (scope === "thread-model") {
    if (!request.projectId || !request.threadId) return null;
    return bridge.updateRuntimePreferences({
      scope,
      ...request,
      model: state.runtimeOverrides.model,
      reasoningEffort: state.runtimeOverrides.reasoningEffort,
    });
  }
  return null;
}

function serviceTierOptions() {
  if (isDirectLiveTextSurface()) {
    const model = selectedModel();
    const tiers = Array.isArray(model?.serviceTiers) ? model.serviceTiers : [];
    const values = tiers
      .map((tier) => String(tier?.id || tier?.serviceTier || tier?.service_tier || tier?.name || tier || "").trim())
      .filter(Boolean);
    return ["", ...values].map((value) => ({ value, label: value || defaultOptionLabel(defaultServiceTier()) }));
  }
  const settingsProjection = providerSettingsProjection();
  const configured = settingsProjection.serviceTier?.availableTiers || settingsProjection.speed?.availableTiers || null;
  const values = Array.isArray(configured) && configured.length
    ? configured.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  return ["", ...values].map((value) => ({ value, label: value || defaultOptionLabel(defaultServiceTier()) }));
}

function compactModelLabel() {
  if (isDirectLiveTextSurface()) {
    const directLabel = directModelLabel();
    if (directLabel) return directLabel.replace(/^GPT-/i, "GPT-");
  }
  const model = selectedModel();
  const label = model?.displayName || model?.model || activeModelId() || "default";
  return label.replace(/^GPT-/i, "GPT-");
}

function setRuntimeOverride(name, value) {
  state.runtimeOverrides[name] = normalizeRuntimeOverrideValue(name, value);
  if (name === "model") {
    const supported = supportedReasoningOptions();
    if (state.runtimeOverrides.reasoningEffort && !supported.includes(state.runtimeOverrides.reasoningEffort)) {
      state.runtimeOverrides.reasoningEffort = selectedModel()?.defaultReasoningEffort || "";
    }
  }
  renderRuntimeConstitution();
  const scope = name === "approvalPolicy" || name === "sandboxMode"
    ? "global-access"
    : name === "model" || name === "reasoningEffort"
      ? "thread-model"
      : "";
  if (scope) {
    persistRuntimePreferences(scope).catch((error) => {
      console.warn("Unable to persist Codex runtime preference", error);
    });
  }
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

function directUiProjectionRows() {
  const status = state.directUiStatus;
  if (state.directUiStatusState === "loading" && !status) return [["status", "loading"]];
  if (state.directUiStatusState === "failed") return [["status", "failed"], ["blocker", state.directUiStatusError || "direct_ui_projection_unavailable"]];
  if (!status) return [["status", "not loaded"]];
  return [
    ["schema", status.schema],
    ["generation", status.meta?.uiProjectionGeneration],
    ["active tier", status.activeRuntimeTier],
    ["source digest", status.meta?.sourceDigest],
    ["ledger digest", status.meta?.operationLedgerHeadDigest],
  ];
}

function readinessRows(readiness = {}) {
  const facets = readiness.facets || {};
  return [
    ["status", readiness.readiness],
    ["selected", readiness.selected ? "yes" : "no"],
    ["start turn", facets.canStartTurn?.state || (readiness.canStartFirstTurn ? "ready" : "blocked")],
    ["show cards", facets.canShowApprovalCards?.state || (readiness.canShowApprovalCards ? "ready" : "blocked")],
    ["approve read", facets.canApproveRead?.state || (readiness.canApproveReadFile ? "ready" : "blocked")],
    ["approve patch", facets.canApprovePatch?.state || (readiness.canApprovePatchApply ? "ready" : "blocked")],
    ["approve command", facets.canApproveCommand?.state || (readiness.canApproveRunCommand ? "ready" : "blocked")],
    ["continue result", facets.canContinueAfterResult?.state || (readiness.canSendContinuation ? "ready" : "blocked")],
    ["workspace truth", facets.workspaceMutationTruth?.state || "unknown"],
    ["policy", facets.policyUsable?.state || "unknown"],
    ["degraded read-only", readiness.degradedToReadOnly ? "yes" : "no"],
    ["blockers", (readiness.blockerCodes || []).join(", ") || "none"],
  ];
}

function witnessRows(status = {}) {
  return (status.witnesses || []).map((chip) => [
    chip.label || chip.kind || "witness",
    [chip.state, chip.freshness, chip.summary].filter(Boolean).join(" · "),
  ]);
}

function contextMaintenanceRows(status = {}) {
  const context = status.contextMaintenance || {};
  const route = context.route || {};
  const memory = context.memory || {};
  const baton = context.baton || {};
  const omission = context.omission || {};
  const providerCompact = context.providerCompact || {};
  const appServerSibling = context.appServerSibling || {};
  if (!context.schema) return [["status", "not loaded"]];
  return [
    ["display", context.displayOnly ? "status only" : "unknown"],
    ["pressure", context.pressureState || "unknown"],
    ["route", [route.routeClass, route.routeKind, route.reasonCode].filter(Boolean).join(" · ") || "unknown"],
    ["memory", [memory.state, memory.pointerState].filter(Boolean).join(" · ") || "unknown"],
    ["baton", [baton.requirement, baton.state].filter(Boolean).join(" · ") || "unknown"],
    ["omissions", omission.state || "none"],
    ["provider compact", `${providerCompact.state || "not_proven"} · transport disabled`],
    ["vanilla sibling", appServerSibling.contextCompactionObserved ? "context compaction observed" : "no context compaction observed"],
    ["sibling memory", [
      appServerSibling.memoryModeObserved ? "memory mode observed" : "",
      appServerSibling.memoryResetObserved ? "memory reset observed" : "",
      appServerSibling.memoryCitationCount ? `${appServerSibling.memoryCitationCount} citation${appServerSibling.memoryCitationCount === 1 ? "" : "s"}` : "",
    ].filter(Boolean).join(" · ") || "none"],
    ["actions", context.actionability?.actionable ? "actionable" : context.actionability?.reason || "read-only"],
    ["compact action", context.compactActionAllowed ? "enabled" : "disabled"],
    ["memory editor", context.memoryEditorAllowed ? "enabled" : "disabled"],
    ["memory reset", context.memoryResetAllowed ? "enabled" : "disabled"],
    ["blockers", (context.blockers || []).join(", ") || "none"],
  ];
}

function operationHistoryRows(history = {}) {
  if (!history?.rows?.length) return [["status", state.directUiStatusState === "loading" ? "loading" : "no rows"]];
  return history.rows.slice(0, 12).map((row) => [
    `${row.family || "operation"} · ${row.status || "unknown"}`,
    `${row.rendererSafeSummary || row.eventKind || row.rowId} · ${row.actionability?.reason || "history_is_read_only"}`,
  ]);
}

function policyRows(policy = {}) {
  if (!policy) return [["status", state.directUiStatusState === "loading" ? "loading" : "not loaded"]];
  return [
    ["editable", policy.editable ? "yes" : "no"],
    ["effective source", policy.effectiveSource || "unknown"],
    ["command classes", policy.commandClasses?.summary || "unknown"],
    ["sensitive paths", policy.sensitivePathPolicy?.summary || "unknown"],
    ["generated/vendor/lock", policy.generatedVendorLockPolicy?.summary || "unknown"],
    ["caps", policy.caps?.summary || "unknown"],
    ["network risk", policy.networkRisk?.summary || "unknown"],
    ["private config", policy.privateConfigIncluded ? "included" : "excluded"],
  ];
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
        ["binary", c.provider?.executable?.command || connection?.runtime || "unknown"],
        ["codex home", c.provider?.executable?.codexHome || "default"],
        ["ready URL", c.provider?.executable?.appServer?.readyUrl || connection?.readyUrlLabel || "not connected"],
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
      drawerSection("Usage Ledger", [
        ["status", c.usage.ledger?.status || "disabled"],
        ["enabled", c.usage.ledger?.enabled ? "yes" : "no"],
        ["rows", c.usage.ledger?.rowCount || 0],
        ["queued", c.usage.ledger?.queuedRows || 0],
        ["dropped", c.usage.ledger?.droppedRows || 0],
        ["ledger id", c.usage.ledger?.ledgerId || "—"],
        ["ledger file", c.usage.ledger?.ledgerLabel || "—"],
        ["manifest file", c.usage.ledger?.manifestLabel || "—"],
        ["ledger evidence", c.usage.ledger?.ledgerPathEvidenceKey || "—"],
        ["last observed", c.usage.ledger?.lastObservedAt || "—"],
        ["error", c.usage.ledger?.lastError || "—"],
      ], c.usage.ledger?.evidenceRefs || []),
    ];
  }
  if (tab === "implementation") {
    const status = state.directUiStatus || {};
    const readiness = status.implementationLane || {};
    return [
      drawerSection("Direct Implementation Projection", directUiProjectionRows()),
      drawerSection("Readiness", readinessRows(readiness)),
      drawerSection("Witness Chips", witnessRows(status)),
      drawerSection("Context Maintenance", contextMaintenanceRows(status)),
      drawerSection("Active Turn", [
        ["state", status.activeTurn?.state || "unknown"],
        ["composer", status.activeTurn?.composerAllowed ? "allowed" : "blocked"],
        ["reason", status.activeTurn?.composerAllowedReason || "unknown"],
        ["unresolved obligations", status.currentSession?.unresolvedObligationCount ?? "unknown"],
      ]),
    ];
  }
  if (tab === "history") {
    const history = state.directUiOperationHistory;
    return [
      drawerSection("Operation History", [
        ["schema", history?.schema || "direct_operation_history_projection@1"],
        ["scope", history?.scope || "active-turn"],
        ["rows", history?.rows?.length ?? 0],
        ["actionable", "false"],
        ["page digest", history?.pageDigest || "not loaded"],
      ]),
      drawerSection("Recent Rows", operationHistoryRows(history)),
    ];
  }
  if (tab === "policy") {
    return [
      drawerSection("Policy Snapshot", policyRows(state.directUiPolicyView)),
      drawerSection("Boundary", [
        ["view", "read-only"],
        ["policy editor", "not enabled"],
        ["runtime authority", "main-process revalidation only"],
        ["right-pane ChatGPT", "separate"],
        ["handoff queue", "unchanged"],
      ]),
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

function hasStrongFilePathEvidence(filePath) {
  const normalized = normalizeSlashes(stripTokenPunctuation(filePath).trim()).replace(/^\.\/+/, "");
  if (!normalized || normalized.includes("\0") || /\s/.test(normalized)) return false;
  if (normalized.startsWith("../") || normalized.includes("/../") || normalized === "..") return false;
  if (!normalized.includes("/")) return false;
  const tail = normalized.split("/").pop() || "";
  return /^[^./][^/]*\.[A-Za-z0-9]{1,12}$/.test(tail);
}

function shouldRenderAmbiguousPathSymbol(value) {
  const raw = stripTokenPunctuation(value).trim();
  if (!raw || /^https?:\/\//i.test(raw) || raw.includes("://") || /\s/.test(raw)) return false;
  const lineRef = splitLineRef(raw);
  if (relativePathWithinRoot(lineRef.path)) return false;
  const normalized = normalizeSlashes(lineRef.path).replace(/^\.\/+/, "");
  if (!normalized || normalized.startsWith("../") || normalized.includes("/../")) return false;
  const hasSlash = normalized.includes("/");
  const hasDot = /(?:^|[A-Za-z0-9_-])\.[A-Za-z0-9_-]+/.test(normalized);
  return hasSlash || hasDot;
}

function knownWorkspaceRoots() {
  const roots = [
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
    if (lowerPath.startsWith(`${lowerRoot}/`)) {
      const relPath = normalized.slice(normalizedRoot.length + 1);
      return hasStrongFilePathEvidence(relPath) ? relPath : "";
    }
  }

  const isAbsolute = normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized);
  if (isAbsolute) return "";
  const relPath = normalized.replace(/^\.\/+/, "");
  return hasStrongFilePathEvidence(relPath) ? relPath : "";
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

function fileRefFromTextCandidate(value) {
  const lineRef = splitLineRef(value);
  const relPath = relativePathWithinRoot(lineRef.path);
  if (!relPath) return null;
  return {
    path: relPath,
    line: lineRef.line,
    column: lineRef.column,
  };
}

function extractFileRefsFromText(value) {
  const source = String(value || "");
  const refs = [];
  const filePattern = /(?:[A-Za-z]:[\\/]|\/|\.{1,2}\/)?[A-Za-z0-9._@+-][A-Za-z0-9._@+:/\\-]*\.[A-Za-z0-9]{1,12}(?::\d+(?::\d+)?)?/g;
  for (const match of source.matchAll(filePattern)) {
    const ref = fileRefFromTextCandidate(match[0]);
    if (ref) refs.push(ref);
  }
  return refs;
}

function fileFallbackForToken(value, context = {}) {
  const lineRef = splitLineRef(value);
  const primary = fileRefFromTextCandidate(value);
  const candidates = Array.isArray(context.fileEvidenceRefs) ? context.fileEvidenceRefs : [];
  const normalizedPrimary = normalizeSlashes(primary?.path || lineRef.path || "").replace(/^\.\/+/, "");
  if (!normalizedPrimary || isBareVersionToken(normalizedPrimary)) return null;
  if (!normalizedPrimary.includes("/") && !/^[^./][^/]*\.[A-Za-z0-9]{1,12}$/.test(normalizedPrimary)) return null;
  const matches = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const candidatePath = normalizeSlashes(candidate?.path || "").replace(/^\.\/+/, "");
    if (!candidatePath || candidatePath === normalizedPrimary || seen.has(candidatePath)) continue;
    if (candidatePath.endsWith(`/${normalizedPrimary}`)) {
      matches.push(candidatePath);
      seen.add(candidatePath);
    }
  }
  if (matches.length !== 1) return null;
  return {
    path: matches[0],
    line: primary?.line ?? lineRef.line,
    column: primary?.column ?? lineRef.column,
  };
}

function normalizeFileAliasToken(value) {
  return stripTokenPunctuation(value).trim().toLowerCase();
}

function isBareVersionToken(value) {
  return /^v\d+(?:\.\d+)+$/i.test(normalizeFileAliasToken(value));
}

function fileAliasForToken(value, context = {}) {
  const key = normalizeFileAliasToken(value);
  if (!key) return null;
  const aliases = context?.fileAliases;
  if (aliases instanceof Map) return aliases.get(key) || null;
  if (aliases && typeof aliases === "object") return aliases[key] || null;
  return null;
}

function addFileAlias(aliases, alias, fileRef) {
  const key = normalizeFileAliasToken(alias);
  if (!key || !fileRef?.path || aliases.has(key)) return;
  aliases.set(key, { ...fileRef });
}

function addVersionAliasesForFile(aliases, label, fileRef) {
  const parts = [
    String(label || ""),
    String(fileRef?.path || "").split("/").pop() || "",
  ];
  for (const part of parts) {
    const withoutExtension = part.replace(/\.[A-Za-z0-9]{1,12}$/i, "");
    const versionMatch = withoutExtension.match(/(?:^|[._-])(v\d+(?:[._-]\d+)+)(?:$|[._-])/i);
    if (!versionMatch) continue;
    const version = versionMatch[1];
    addFileAlias(aliases, version, fileRef);
    addFileAlias(aliases, version.replace(/[._-]/g, "."), fileRef);
  }
}

function buildMarkdownFileAliasMap(text) {
  const aliases = new Map();
  const source = String(text || "");
  const pattern = /\[([^\]\n]{1,240})\]\(([^) \n]{1,1000})\)/g;
  for (const match of source.matchAll(pattern)) {
    const fileRef = markdownLocalHref(match[2]);
    if (fileRef) addVersionAliasesForFile(aliases, match[1], fileRef);
  }
  return aliases;
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

function tokenizeTypedContent(text, context = {}) {
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
    const aliasRef = fileAliasForToken(raw, context);
    if (aliasRef) {
      addTokenCandidate(candidates, match.index, match.index + match[0].length, {
        type: aliasRef.line ? "line_ref" : "file_path",
        text: match[0],
        path: aliasRef.path,
        line: aliasRef.line,
        column: aliasRef.column,
      });
      continue;
    }
    const lineRef = splitLineRef(raw);
    const relPath = relativePathWithinRoot(lineRef.path);
    if (relPath && !isBareVersionToken(raw)) {
      const fallbackRef = fileFallbackForToken(raw, context);
      addTokenCandidate(candidates, match.index, match.index + match[0].length, {
        type: lineRef.line ? "line_ref" : "file_path",
        text: match[0],
        path: relPath,
        line: lineRef.line,
        column: lineRef.column,
        fallbackPath: fallbackRef?.path || "",
      });
      continue;
    }
    const fallbackRef = fileFallbackForToken(raw, context);
    if (fallbackRef) {
      addTokenCandidate(candidates, match.index, match.index + match[0].length, {
        type: fallbackRef.line ? "line_ref" : "file_path",
        text: match[0],
        path: fallbackRef.path,
        line: fallbackRef.line,
        column: fallbackRef.column,
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
    const aliasRef = fileAliasForToken(raw, context);
    if (aliasRef) {
      addTokenCandidate(candidates, match.index, match.index + raw.length, {
        type: aliasRef.line ? "line_ref" : "file_path",
        text: raw,
        path: aliasRef.path,
        line: aliasRef.line,
        column: aliasRef.column,
      });
      continue;
    }
    const lineRef = splitLineRef(raw);
    const relPath = relativePathWithinRoot(lineRef.path);
    if (!relPath) {
      const fallbackRef = fileFallbackForToken(raw, context);
      if (fallbackRef) {
        addTokenCandidate(candidates, match.index, match.index + raw.length, {
          type: fallbackRef.line ? "line_ref" : "file_path",
          text: raw,
          path: fallbackRef.path,
          line: fallbackRef.line,
          column: fallbackRef.column,
        });
        continue;
      }
      if (shouldRenderAmbiguousPathSymbol(raw)) {
        addTokenCandidate(candidates, match.index, match.index + raw.length, { type: "symbol", text: raw, value: raw });
      }
      continue;
    }
    const fallbackRef = fileFallbackForToken(raw, context);
    addTokenCandidate(candidates, match.index, match.index + raw.length, {
      type: lineRef.line ? "line_ref" : "file_path",
      text: raw,
      path: relPath,
      line: lineRef.line,
      column: lineRef.column,
      fallbackPath: fallbackRef?.path || "",
    });
  }

  const slashSymbolPattern = /[A-Za-z0-9._@+-]+(?:[\\/][A-Za-z0-9._@+-]+)+(?::\d+(?::\d+)?)?/g;
  for (const match of source.matchAll(slashSymbolPattern)) {
    const raw = stripTokenPunctuation(match[0]);
    if (!shouldRenderAmbiguousPathSymbol(raw)) continue;
    addTokenCandidate(candidates, match.index, match.index + raw.length, { type: "symbol", text: raw, value: raw });
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

function isFileOpenMissingError(errorText) {
  return /ENOENT|no such file|not found|cannot find/i.test(String(errorText || ""));
}

function errorMessageText(error, fallback = "unknown error") {
  const value = error?.message || (typeof error === "string" ? error : error ? String(error) : "");
  return value || fallback;
}

async function openTypedFile(relPath, options = {}) {
  if (!bridge?.openProjectFile || !project?.id) {
    addSystemMessage("Project file opening is unavailable in this Codex surface.");
    return;
  }
  const fallbackPath = String(options?.fallbackPath || "").trim();
  try {
    const result = await bridge.openProjectFile(project.id, relPath, {
      sourceSurface: "codex",
      threadId: state.threadId || "",
      threadTitle: state.threadTitle || "",
    });
    if (result?.ok) return;
    if (fallbackPath && isFileOpenMissingError(result?.error)) {
      const fallbackResult = await bridge.openProjectFile(project.id, fallbackPath, {
        sourceSurface: "codex",
        threadId: state.threadId || "",
        threadTitle: state.threadTitle || "",
        sourceKind: "project_file",
      });
      if (fallbackResult?.ok) return;
      addSystemMessage(`File open failed: ${fallbackResult?.error || result?.error || "unknown error"}`);
      return;
    }
    addSystemMessage(`File open failed: ${result?.error || "unknown error"}`);
  } catch (error) {
    const message = errorMessageText(error);
    if (fallbackPath && isFileOpenMissingError(message)) {
      try {
        const fallbackResult = await bridge.openProjectFile(project.id, fallbackPath, {
          sourceSurface: "codex",
          threadId: state.threadId || "",
          threadTitle: state.threadTitle || "",
          sourceKind: "project_file",
        });
        if (fallbackResult?.ok) return;
      } catch {}
    }
    addSystemMessage(`File open failed: ${message}`);
  }
}

function renderTypedContent(container, text, context = {}) {
  container.textContent = "";
  const tokens = tokenizeTypedContent(text, context);
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
      button.dataset.contextTarget = "url";
      button.dataset.contextHref = token.href;
      button.addEventListener("click", () => openTypedUrl(token.href));
      container.appendChild(button);
      continue;
    }
    if (token.type === "file_path" || token.type === "line_ref") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `typed-token ${token.type === "line_ref" ? "typed-token-line-ref" : "typed-token-file"}`;
      button.textContent = token.text;
      button.title = token.line ? `Open ${token.path}:${token.line} in Files` : `Open ${token.path} in Files`;
      button.dataset.contextTarget = "file_ref";
      button.dataset.contextFile = token.path;
      if (token.fallbackPath) button.dataset.contextFallbackFile = token.fallbackPath;
      button.addEventListener("click", () => openTypedFile(token.path, { fallbackPath: token.fallbackPath || "" }));
      container.appendChild(button);
      continue;
    }
    const span = document.createElement("span");
    span.className = `typed-token typed-token-${token.type.replace(/_/g, "-")}`;
    span.textContent = token.text;
    container.appendChild(span);
  }
}

function appendTypedText(parent, text, context = {}) {
  if (!text) return;
  const span = document.createElement("span");
  renderTypedContent(span, text, context);
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
  button.title = fileRef.line ? `Open ${fileRef.path}:${fileRef.line} in Files` : `Open ${fileRef.path} in Files`;
  button.dataset.contextTarget = "file_ref";
  button.dataset.contextFile = fileRef.path;
  if (fileRef.fallbackPath) button.dataset.contextFallbackFile = fileRef.fallbackPath;
  button.addEventListener("click", () => openTypedFile(fileRef.path, { fallbackPath: fileRef.fallbackPath || "" }));
  parent.appendChild(button);
}

function appendUrlToken(parent, label, href) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "typed-token typed-token-url assistant-md-link";
  button.textContent = label || href;
  button.title = `Open ${href}`;
  button.dataset.contextTarget = "url";
  button.dataset.contextHref = href;
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

function appendInlineCode(parent, raw, context = {}) {
  const code = document.createElement("code");
  code.className = "assistant-md-inline-code";
  const source = String(raw || "");
  const fileRef = fileAliasForToken(source, context) || markdownLocalHref(source) || (() => {
    if (isBareVersionToken(source)) return null;
    const lineRef = splitLineRef(source);
    const relPath = relativePathWithinRoot(lineRef.path);
    if (!relPath) return fileFallbackForToken(source, context);
    const fallbackRef = fileFallbackForToken(source, context);
    return {
      path: relPath,
      line: lineRef.line,
      column: lineRef.column,
      fallbackPath: fallbackRef?.path || "",
    };
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

function appendInlineMarkdown(parent, text, context = {}) {
  const source = String(text || "");
  const pattern = /(\[[^\]\n]{1,240}\]\([^) \n]{1,1000}\)|`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|(->|=>))/g;
  let cursor = 0;
  for (const match of source.matchAll(pattern)) {
    if (match.index > cursor) appendTypedText(parent, source.slice(cursor, match.index), context);
    const token = match[0];
    const linkMatch = token.match(/^\[([^\]\n]+)\]\(([^) \n]+)\)$/);
    if (linkMatch) {
      const href = safeMarkdownHref(linkMatch[2]);
      const fileRef = markdownLocalHref(linkMatch[2]);
      if (href) appendUrlToken(parent, linkMatch[1], href);
      else if (fileRef) appendFileToken(parent, linkMatch[1], fileRef);
      else appendUnsupportedMarkdownLink(parent, linkMatch[1], "Unsupported, unsafe, or unresolved link target");
    } else if (token.startsWith("`")) {
      appendInlineCode(parent, token.slice(1, -1), context);
    } else if (token.startsWith("**")) {
      const strong = document.createElement("strong");
      strong.className = "assistant-md-strong";
      appendTypedText(strong, token.slice(2, -2), context);
      parent.appendChild(strong);
    } else if (token.startsWith("*")) {
      const em = document.createElement("em");
      em.className = "assistant-md-emphasis";
      appendTypedText(em, token.slice(1, -1), context);
      parent.appendChild(em);
    } else {
      const arrow = document.createElement("span");
      arrow.className = "assistant-md-arrow";
      arrow.textContent = token;
      parent.appendChild(arrow);
    }
    cursor = match.index + token.length;
  }
  if (cursor < source.length) appendTypedText(parent, source.slice(cursor), context);
}

function createMarkdownLineBlock(tagName, className, text, context = {}) {
  const block = document.createElement(tagName);
  block.className = className;
  appendInlineMarkdown(block, text, context);
  return block;
}

function createMarkdownCodeBlock(codeLines, language = "") {
  const block = document.createElement("div");
  block.className = "assistant-md-codeblock";
  const normalizedLanguage = String(language || "").trim();
  if (normalizedLanguage && normalizedLanguage.toLowerCase() !== "text") {
    const caption = document.createElement("div");
    caption.className = "assistant-md-codeblock-label";
    caption.textContent = normalizedLanguage;
    block.appendChild(caption);
  }
  const body = document.createElement("div");
  body.className = "assistant-md-codeblock-body";
  body.textContent = codeLines.join("\n");
  block.appendChild(body);
  return block;
}

function isIndentedMarkdownCodeLine(line) {
  return /^( {4}|\t)/.test(String(line || ""));
}

function stripIndentedMarkdownCodeLine(line) {
  const source = String(line || "");
  return source.startsWith("\t") ? source.slice(1) : source.replace(/^ {4}/, "");
}

function splitMarkdownTableRow(line) {
  let source = String(line || "").trim();
  if (!source.includes("|")) return null;
  if (source.startsWith("|")) source = source.slice(1);
  if (source.endsWith("|")) source = source.slice(0, -1);
  const cells = [];
  let current = "";
  let escaped = false;
  for (const char of source) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells.length >= 2 ? cells : null;
}

function isMarkdownTableDivider(line) {
  const cells = splitMarkdownTableRow(line);
  return Boolean(cells?.length) && cells.every((cell) => /^:?-+:?$/.test(cell.trim()));
}

function markdownTableStart(lines, index) {
  if (!Array.isArray(lines) || index < 0 || index + 1 >= lines.length) return null;
  const header = splitMarkdownTableRow(lines[index]);
  if (!header || !isMarkdownTableDivider(lines[index + 1])) return null;
  return { header };
}

function appendMarkdownTable(container, tableLines, context = {}) {
  const header = splitMarkdownTableRow(tableLines[0]) || [];
  const bodyRows = tableLines.slice(2).map(splitMarkdownTableRow).filter(Boolean);
  const wrapper = document.createElement("div");
  wrapper.className = "assistant-md-table-wrap";
  const table = document.createElement("table");
  table.className = "assistant-md-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const cellText of header) {
    const cell = document.createElement("th");
    appendInlineMarkdown(cell, cellText, context);
    headRow.appendChild(cell);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  for (const rowCells of bodyRows) {
    const row = document.createElement("tr");
    for (let cellIndex = 0; cellIndex < header.length; cellIndex += 1) {
      const cell = document.createElement("td");
      appendInlineMarkdown(cell, rowCells[cellIndex] || "", context);
      row.appendChild(cell);
    }
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  wrapper.appendChild(table);
  container.appendChild(wrapper);
}

function isMarkdownBlockStart(line, lines = null, index = -1) {
  const trimmed = String(line || "").trim();
  return Boolean(
    !trimmed ||
    /^```/.test(trimmed) ||
    isIndentedMarkdownCodeLine(line) ||
    markdownTableStart(lines, index) ||
    /^#{1,4}\s+/.test(trimmed) ||
    /^>\s?/.test(trimmed) ||
    /^---+$/.test(trimmed) ||
    /^[-*]\s+/.test(trimmed) ||
    /^\d+\.\s+/.test(trimmed) ||
    /^(->|=>)\s+/.test(trimmed)
  );
}

function appendMarkdownList(container, lines, ordered, context = {}) {
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
        appendInlineMarkdown(target, fragment, context);
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

function renderFinalAssistantContent(container, text, context = {}) {
  container.textContent = "";
  container.classList.add("assistant-markdown");
  const source = String(text || "").replace(/\r\n/g, "\n");
  if (!source.trim()) return;
  const renderContext = { ...context, fileAliases: buildMarkdownFileAliasMap(source) };
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
      container.appendChild(createMarkdownCodeBlock(codeLines, language));
      continue;
    }

    if (isIndentedMarkdownCodeLine(line)) {
      const codeLines = [];
      while (index < lines.length) {
        const nextLine = lines[index];
        if (isIndentedMarkdownCodeLine(nextLine)) {
          codeLines.push(stripIndentedMarkdownCodeLine(nextLine));
          index += 1;
          continue;
        }
        if (!nextLine.trim() && codeLines.length) {
          codeLines.push("");
          index += 1;
          continue;
        }
        break;
      }
      container.appendChild(createMarkdownCodeBlock(codeLines));
      continue;
    }

    if (markdownTableStart(lines, index)) {
      const tableLines = [lines[index], lines[index + 1]];
      index += 2;
      while (index < lines.length && splitMarkdownTableRow(lines[index])) {
        tableLines.push(lines[index]);
        index += 1;
      }
      appendMarkdownTable(container, tableLines, renderContext);
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = Math.min(4, heading[1].length);
      container.appendChild(createMarkdownLineBlock(`h${level}`, `assistant-md-heading level-${level}`, heading[2], renderContext));
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
      container.appendChild(createMarkdownLineBlock("blockquote", "assistant-md-quote", quoteLines.join("\n"), renderContext));
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
      appendMarkdownList(container, listLines, ordered, renderContext);
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
      appendInlineMarkdown(block, chain[2], renderContext);
      container.appendChild(block);
      index += 1;
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (index < lines.length && !isMarkdownBlockStart(lines[index], lines, index)) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    container.appendChild(createMarkdownLineBlock("p", "assistant-md-paragraph", paragraphLines.join("\n"), renderContext));
  }
}

const typedMarkdownProjection = window.CodexTypedMarkdownProjection;

function codexTypedMarkdownContext(context = {}) {
  const safeContext = context && typeof context === "object" ? context : {};
  return {
    ...safeContext,
    workspaceRoots: knownWorkspaceRoots(),
    includeContextDataset: true,
    urlTokenTitle: "Open link in browser",
    onOpenUrl: (url) => openTypedUrl(url),
    onOpenFile: (relPath, options = {}) => openTypedFile(relPath, { fallbackPath: options.fallbackPath || "" }),
  };
}

if (typedMarkdownProjection) {
  extractFileRefsFromText = function sharedExtractFileRefsFromText(value) {
    return typedMarkdownProjection.extractFileRefsFromText(value, codexTypedMarkdownContext());
  };
  tokenizeTypedContent = function sharedTokenizeTypedContent(text, context = {}) {
    return typedMarkdownProjection.tokenizeTypedContent(text, codexTypedMarkdownContext(context));
  };
  renderTypedContent = function sharedRenderTypedContent(container, text, context = {}) {
    typedMarkdownProjection.renderTypedContent(container, text, codexTypedMarkdownContext(context));
  };
  renderFinalAssistantContent = function sharedRenderFinalAssistantContent(container, text, context = {}) {
    typedMarkdownProjection.renderAssistantMarkdown(container, text, codexTypedMarkdownContext(context));
  };
} else {
  console.error("Shared typed Markdown projection unavailable; using legacy Codex projection.");
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

function setMessageText(id, role, text, title = "", context = {}) {
  const node = ensureMessage(id, role, title);
  const bubble = node.querySelector(".bubble");
  bubble.dataset.rawText = text || "";
  bubble.dataset.typedRendered = "true";
  bubble.dataset.streamingPlain = "false";
  if (role === "assistant") {
    renderFinalAssistantContent(bubble, text || "", context);
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
    const turnKey = state.finalTurnKeyByMessageId.get(String(id || "")) || "";
    renderFinalAssistantContent(bubble, text, turnFileEvidenceContext(turnKey));
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
  state.contextManagementEvidenceKeys.clear();
  state.thoughtItemMap.clear();
  state.thoughtTurnByItemId.clear();
  state.subagentActivityByTurn.clear();
  for (const pending of state.pendingThoughtRenderMap.values()) {
    if (pending?.frameId) cancelAnimationFrame(pending.frameId);
  }
  state.pendingThoughtRenderMap.clear();
  state.finalMessageByTurnKey.clear();
  state.finalTurnKeyByMessageId.clear();
  state.turnFileEvidenceByTurn.clear();
}

function resetThreadSessionState() {
  state.turnId = "";
  state.activeTurnId = "";
  state.turnActivityMap.clear();
  state.turnPromptMap.clear();
  state.turnRetryCountMap.clear();
  state.emptyTurnRetrying.clear();
  state.primaryThreadActive = false;
  state.primaryThreadActivitySource = "";
  state.turnPending = false;
  state.turnStopping = false;
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

function clearPrimaryTurnActivityState() {
  state.activeTurnId = "";
  state.primaryThreadActive = false;
  state.primaryThreadActivitySource = "";
  state.turnPending = false;
  state.turnStopping = false;
}

function threadIdFromNotification(params = {}) {
  return String(
    params.threadId ||
    params.thread_id ||
    params.thread?.id ||
    params.item?.threadId ||
    params.item?.thread_id ||
    "",
  );
}

function notificationMatchesPrimaryThread(params = {}) {
  const threadId = threadIdFromNotification(params);
  return !threadId || !state.threadId || String(threadId) === String(state.threadId);
}

function shouldApplyTurnCompletionNotification(params = {}, turnId = "") {
  if (!notificationMatchesPrimaryThread(params)) return false;
  const threadId = threadIdFromNotification(params);
  if (threadId) return true;
  const id = String(turnId || "").trim();
  if (!id || !state.activeTurnId) return true;
  return String(state.activeTurnId) === id || state.turnActivityMap.has(id);
}

function lifecycleStatus(value = "") {
  if (value && typeof value === "object") return String(value.type || value.status || value.state || "");
  return String(value || "");
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
    durationMs: null,
    status: "",
    hasCodexOutput: false,
    errorShown: false,
    emptyCompletionWarned: false,
  };
  state.turnActivityMap.set(id, next);
  return next;
}

function rememberTurnTiming(turnKey, timing = {}) {
  const key = String(turnKey || timing?.turnId || timing?.id || "").trim();
  if (!key) return null;
  const activity = ensureTurnActivity(key);
  if (!activity) return null;
  const startedAt = timestampSeconds(timing.startedAt || timing.started_at || timing.createdAt || timing.created_at || "");
  const completedAt = timestampSeconds(timing.completedAt || timing.completed_at || timing.finishedAt || timing.finished_at || "");
  const durationMs = Number(timing.durationMs ?? timing.duration_ms);
  if (startedAt && !activity.startedAt) activity.startedAt = startedAt;
  if (completedAt && !activity.completedAt) activity.completedAt = completedAt;
  if (Number.isFinite(durationMs) && durationMs >= 0) activity.durationMs = durationMs;
  else if (activity.startedAt && activity.completedAt && activity.completedAt >= activity.startedAt) {
    activity.durationMs = Math.round((activity.completedAt - activity.startedAt) * 1000);
  }
  return activity;
}

function terminalTurnStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  return new Set([
    "complete",
    "completed",
    "succeeded",
    "failed",
    "error",
    "errored",
    "cancelled",
    "canceled",
    "interrupted",
  ]).has(normalized);
}

function activeTurnStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  return ACTIVE_TURN_STATUS_SET.has(normalized);
}

function reconcileCompletedTurnState(turnId, status = "completed", completedAt = null) {
  const id = String(turnId || "").trim();
  if (!id) return false;
  const activity = ensureTurnActivity(id);
  if (activity) {
    activity.status = String(status || "completed");
    activity.completedAt = activity.completedAt || timestampSeconds(completedAt) || Date.now() / 1000;
    if (!Number.isFinite(Number(activity.durationMs)) && activity.startedAt && activity.completedAt >= activity.startedAt) {
      activity.durationMs = Math.round((activity.completedAt - activity.startedAt) * 1000);
    }
  }
  if (!state.activeTurnId || String(state.activeTurnId) === id || String(state.turnId) === id) {
    clearPrimaryTurnActivityState();
  }
  state.turnId = id;
  return true;
}

function reconcileActiveTurnState(turnId, status = "inProgress", startedAt = null) {
  const id = String(turnId || "").trim();
  if (!id) return false;
  const activity = ensureTurnActivity(id);
  if (activity) {
    activity.status = String(status || "inProgress");
    activity.startedAt = activity.startedAt || timestampSeconds(startedAt) || Date.now() / 1000;
    activity.completedAt = null;
    activity.durationMs = null;
  }
  state.turnId = id;
  state.activeTurnId = id;
  state.primaryThreadActive = true;
  state.primaryThreadActivitySource = "turn-state";
  state.turnPending = false;
  state.turnStopping = false;
  return true;
}

function timestampSeconds(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "string" ? Date.parse(value) : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed > 1_000_000_000_000 ? parsed / 1000 : parsed;
}

function reconcileTurnStateFromStoredPresentationModel(model) {
  const turns = Array.isArray(model?.turns) ? model.turns : [];
  const latest = turns.length ? turns[turns.length - 1] : null;
  if (!latest) return false;
  const status = latest.status || latest.state || latest.lifecycleStatus || "";
  const completedAt = latest.completedAt || latest.completed_at || latest.finishedAt || latest.finished_at || null;
  if (terminalTurnStatus(status) || completedAt) {
    return reconcileCompletedTurnState(latest.turnId || latest.turnKey, status || "completed", completedAt);
  }
  const startedAt = latest.startedAt || latest.started_at || null;
  if (activeTurnStatus(status)) {
    return reconcileActiveTurnState(latest.turnId || latest.turnKey, status || "inProgress", startedAt);
  }
  return false;
}

function reconcileTurnStateFromLiveThread(thread) {
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  const latest = turns.length ? turns[turns.length - 1] : null;
  if (!latest) {
    state.primaryThreadActive = activeTurnStatus(lifecycleStatus(thread?.status));
    state.primaryThreadActivitySource = state.primaryThreadActive ? "thread-status" : "";
    return state.primaryThreadActive;
  }
  const threadStatus = lifecycleStatus(thread?.status);
  const status = latest.status || latest.state || latest.lifecycleStatus || "";
  const completedAt = latest.completedAt || latest.completed_at || latest.finishedAt || latest.finished_at || null;
  if (terminalTurnStatus(status) || completedAt) {
    return reconcileCompletedTurnState(latest.id || latest.turnId || latest.turn_id, status || "completed", completedAt);
  }
  const startedAt = latest.startedAt || latest.started_at || latest.createdAt || latest.created_at || null;
  if (activeTurnStatus(status) || activeTurnStatus(threadStatus)) {
    return reconcileActiveTurnState(latest.id || latest.turnId || latest.turn_id, status || "inProgress", startedAt);
  }
  state.primaryThreadActive = false;
  state.primaryThreadActivitySource = "";
  return false;
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
  if (!hasCapability("threads", "canRollback")) {
    addSystemMessage("Codex completed without output, but this runtime does not expose rollback/retry capability.");
    return;
  }
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
  if (
    prompt &&
    retryCount < EMPTY_TURN_AUTO_RETRY_LIMIT &&
    state.threadId &&
    state.connected &&
    hasCapability("threads", "canRollback")
  ) {
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

function isDirectLiveTextSurface() {
  return connection?.transport === DIRECT_LIVE_TEXT_TRANSPORT;
}

function directThreadTimeLabel(value) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) return "time unknown";
  const date = new Date(parsed);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function directThreadStateLabel(entry = {}) {
  if (!entry) return "unknown";
  const displayState = String(entry.displayState || "").trim();
  if (displayState) return displayState.replace(/_/g, " ");
  if (Number(entry.activeTurnCount || 0) > 0) return "running";
  const lastTurnState = String(entry.lastTurnState || "").trim();
  if (lastTurnState) return lastTurnState.replace(/_/g, " ");
  return String(entry.status || "created").replace(/_/g, " ");
}

function directThreadActionEnabled(entry = {}, actionName = "") {
  const action = entry.actions?.[actionName];
  if (!action || typeof action.enabled !== "boolean") return true;
  return action.enabled === true;
}

function activeDirectThreadRow() {
  const threadId = String(state.threadId || "");
  if (!threadId) return null;
  const rows = Array.isArray(state.directThreadDeck?.rows) ? state.directThreadDeck.rows : state.directThreadList;
  return (Array.isArray(rows) ? rows : []).find((entry) => {
    const id = String(entry?.threadId || entry?.id || entry?.sessionId || "");
    return id && id === threadId;
  }) || null;
}

function renderDirectThreadList() {
  if (!els.directThreadStrip || !els.directThreadList || !els.directThreadStatus) return;
  const enabled = isDirectLiveTextSurface();
  els.directThreadStrip.hidden = !enabled;
  if (!enabled) return;

  const loading = state.directThreadListStatus === "loading";
  const error = state.directThreadListStatus === "error";
  if (els.directThreadRefreshButton) els.directThreadRefreshButton.disabled = loading;
  const startAction = state.directThreadDeck?.actions?.start || null;
  if (els.directThreadNewButton) {
    els.directThreadNewButton.disabled = !state.connected ||
      !hasCapability("threads", "canStart") ||
      (startAction && startAction.enabled === false);
    els.directThreadNewButton.title = startAction?.disabledReason || startAction?.effect || "Start a fresh direct-native thread";
  }

  const threads = Array.isArray(state.directThreadDeck?.rows)
    ? state.directThreadDeck.rows
    : Array.isArray(state.directThreadList) ? state.directThreadList : [];
  if (loading) {
    els.directThreadStatus.textContent = "Refreshing direct sessions…";
  } else if (error) {
    els.directThreadStatus.textContent = `Thread list unavailable: ${state.directThreadListError || "unknown error"}`;
  } else if (!threads.length) {
    els.directThreadStatus.textContent = "No direct sessions for this project yet.";
  } else {
    const activeCount = Number(state.directThreadDeck?.counts?.running ?? threads.filter((entry) => entry && Number(entry.activeTurnCount || 0) > 0).length);
    const recoverableCount = Number(state.directThreadDeck?.counts?.recoverableInterrupted || 0);
    const projection = directSurfaceProjection();
    const workThreadCount = Number(projection?.workThreads?.status?.workThreadCount || state.directThreadDeck?.counts?.workThreadScoped || 0);
    const broker = projection?.operatorBroker || {};
    const brokerSuffix = broker.clarificationRequired
      ? " · target clarification needed"
      : broker.selectedWorkThreadId
        ? " · target resolved"
        : "";
    els.directThreadStatus.textContent = [
      `${threads.length} direct session${threads.length === 1 ? "" : "s"}`,
      `${workThreadCount} WorkThread${workThreadCount === 1 ? "" : "s"}`,
      activeCount ? `${activeCount} running` : "",
      recoverableCount ? `${recoverableCount} recoverable` : "",
    ].filter(Boolean).join(" · ") + brokerSuffix;
  }

  els.directThreadList.replaceChildren();
  for (const entry of threads) {
    if (!entry) continue;
    const threadId = String(entry.threadId || entry.id || "").trim();
    if (!threadId) continue;
    const isActive = threadId === String(state.threadId || "");
    const isRunning = Number(entry.activeTurnCount || 0) > 0 || entry.displayState === "running";
    const button = document.createElement("button");
    button.type = "button";
    button.className = `direct-thread-pill${isActive ? " active" : ""}${isRunning ? " running" : ""}`;
    button.dataset.threadId = threadId;
    button.disabled = !directThreadActionEnabled(entry, "focus");
    button.title = [
      entry.title || threadId,
      threadId,
      entry.workThreadId ? `WorkThread ${entry.workThreadId}` : "WorkThread unresolved",
      entry.actions?.focus?.disabledReason || entry.actions?.focus?.effect || "",
    ].filter(Boolean).join("\n");
    const title = document.createElement("span");
    title.className = "direct-thread-pill-title";
    title.textContent = entry.title || threadId;
    const status = document.createElement("span");
    status.className = "direct-thread-pill-state";
    status.textContent = directThreadStateLabel(entry);
    const meta = document.createElement("span");
    meta.className = "direct-thread-pill-meta";
    const model = String(entry.model || state.activeModel || "").trim();
    meta.textContent = [
      model || "model unknown",
      entry.reasoningEffort || "",
      entry.workThreadId ? "WorkThread scoped" : "project scoped",
      `${Number(entry.turnCount || 0)} turn${Number(entry.turnCount || 0) === 1 ? "" : "s"}`,
      directThreadTimeLabel(entry.updatedAt || entry.createdAt),
    ].filter(Boolean).join(" · ");
    button.append(title, status, meta);
    button.addEventListener("click", () => {
      openDirectThread(threadId).catch((openError) => addSystemMessage(`Unable to open direct thread: ${openError.message}`));
    });
    els.directThreadList.appendChild(button);
  }
}

async function refreshDirectThreadList(options = {}) {
  if (!isDirectLiveTextSurface() || !state.connected || !hasCapability("threads", "canList")) {
    state.directThreadList = [];
    state.directThreadDeck = null;
    state.directThreadListStatus = isDirectLiveTextSurface() ? "unavailable" : "hidden";
    state.directThreadListError = "";
    renderDirectThreadList();
    return;
  }
  state.directThreadListStatus = "loading";
  state.directThreadListError = "";
  renderDirectThreadList();
  try {
    const result = await rpc("thread/list", {
      limit: options.limit || 40,
      defaultModel: activeModelId() || null,
      defaultReasoningEffort: requestedReasoningEffort() || null,
    });
    state.directThreadList = Array.isArray(result?.threads) ? result.threads.filter(Boolean) : [];
    state.directThreadDeck = result?.deck && result.deck.schema === "direct_thread_deck_projection@1" ? result.deck : null;
    state.directThreadListStatus = "ready";
    state.directThreadListError = "";
  } catch (error) {
    state.directThreadListStatus = "error";
    state.directThreadListError = error.message || "unknown error";
    state.directThreadDeck = null;
    if (options.showErrors !== false) addSystemMessage(`Direct thread list failed: ${state.directThreadListError}`);
  }
  renderDirectThreadList();
}

async function openDirectThread(threadId) {
  const requestedThreadId = String(threadId || "").trim();
  if (!requestedThreadId) throw new Error("Missing direct thread id.");
  if (requestedThreadId === String(state.threadId || "") && state.liveAttached) return;
  const openRequestId = state.directThreadOpenRequestId + 1;
  state.directThreadOpenRequestId = openRequestId;
  const result = await readThreadById(requestedThreadId);
  if (state.directThreadOpenRequestId !== openRequestId) return;
  clearRenderedThreadState();
  state.sourceHome = "";
  state.sessionFilePath = "";
  applyLiveThreadResult(result);
  await loadRuntimePreferences({
    applyThread: true,
    threadId: requestedThreadId,
    guardThreadId: requestedThreadId,
    guardSourceHome: state.sourceHome,
    guardSessionFilePath: state.sessionFilePath,
  });
  if (state.directThreadOpenRequestId !== openRequestId || state.threadId !== requestedThreadId) return;
  await reportThreadState("attached_live", {
    threadId: requestedThreadId,
    title: result?.thread?.title || requestedThreadId,
    evidence: "direct-thread-strip-open",
  });
  renderDirectThreadList();
}

async function createDirectThreadFromStrip() {
  await startNewThread();
  await refreshDirectThreadList({ showErrors: false });
}

async function refreshModelList(showErrors = false) {
  if (isDirectLiveTextSurface()) {
    state.modelListStatus = "loading";
    renderRuntimeConstitution();
    const projection = await refreshDirectSurfaceProjection({ render: false, showErrors, refreshMetadata: true });
    applyDirectMetadataModels(projection || directSurfaceProjection());
    if (!effectiveModels().length) {
      state.modelListStatus = "unavailable";
      state.modelListError = "Direct provider metadata did not expose model choices.";
    }
    renderRuntimeConstitution();
    return;
  }
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

function renderDirectReadOnlyToolRequestDetails(request, details, actions) {
  const params = request.params || {};
  appendRequestLine(details, "tool", params.tool || "read_file", { mono: true });
  appendRequestLine(details, "path", params.relPath || "unknown", { mono: true });
  appendRequestLine(details, "call type", params.providerCallType || "unknown", { mono: true });
  if (params.namespace) appendRequestLine(details, "namespace", params.namespace, { mono: true });
  appendRequestLine(details, "source", params.toolCallSource || "provider-native-implicit");
  appendRequestLine(details, "limits", `${params.maxReadFileBytes || 0} bytes read · ${params.maxProviderOutputChars || 0} chars provider output`);
  appendRequestLine(details, "policy", params.sensitivePathPolicy || "deny-by-default");
  if (params.argumentsError) appendRequestLine(details, "arguments", params.argumentsError);
  if (!params.hasContinuityHandle) appendRequestLine(details, "continuation", "Missing provider continuity handle.");
  if (params.approvalAvailable === false) appendRequestLine(details, "approval", "Unavailable for this tool-call shape.");
  const decisionId = (decision) => `${request.key}:${decision}`;
  actions.appendChild(createRequestButton("Approve read", "", (event) => submitRequestResponse(request, {
    decision: "approve",
    clientToolDecisionId: decisionId("approve"),
    actionTokenId: params.actionTokens?.approve || "",
  }, event.currentTarget)));
  actions.appendChild(createRequestButton("Decline", "secondary", (event) => submitRequestResponse(request, {
    decision: "decline",
    clientToolDecisionId: decisionId("decline"),
    actionTokenId: params.actionTokens?.decline || "",
  }, event.currentTarget)));
  actions.appendChild(createRequestButton("Cancel turn", "secondary", (event) => submitRequestResponse(request, {
    decision: "cancel",
    clientToolDecisionId: decisionId("cancel"),
    actionTokenId: params.actionTokens?.cancel || "",
  }, event.currentTarget)));
}

function renderDirectPatchApplyRequestDetails(request, details, actions) {
  const params = request.params || {};
  appendRequestLine(details, "tool", params.tool || "apply_patch", { mono: true });
  appendRequestLine(details, "call type", params.providerCallType || "unknown", { mono: true });
  appendRequestLine(details, "source", params.toolCallSource || "provider-native-implicit");
  appendRequestLine(details, "files", Array.isArray(params.files) && params.files.length
    ? params.files.map((file) => `${file.operation || "update"} ${file.path || "unknown"}`).join("\n")
    : "none", { mono: true, pre: true });
  const totals = params.totals || {};
  appendRequestLine(details, "summary", `${totals.fileCount || params.files?.length || 0} files · +${totals.addedLineCount || 0} -${totals.removedLineCount || 0}`);
  appendRequestLine(details, "preview", params.preview?.text || "Patch preview unavailable.", { mono: true, pre: true });
  if (!params.hasContinuityHandle) appendRequestLine(details, "continuation", "Missing provider continuity handle.");
  if (params.approvalAvailable === false) appendRequestLine(details, "approval", "Unavailable for this patch shape.");
  const decisionId = (decision) => `${request.key}:${decision}`;
  actions.appendChild(createRequestButton("Approve patch", "", (event) => submitRequestResponse(request, {
    decision: "approve",
    clientPatchDecisionId: decisionId("approve"),
    actionTokenId: params.actionTokens?.approve || "",
  }, event.currentTarget)));
  actions.appendChild(createRequestButton("Decline", "secondary", (event) => submitRequestResponse(request, {
    decision: "decline",
    clientPatchDecisionId: decisionId("decline"),
    actionTokenId: params.actionTokens?.decline || "",
  }, event.currentTarget)));
  actions.appendChild(createRequestButton("Cancel turn", "secondary", (event) => submitRequestResponse(request, {
    decision: "cancel",
    clientPatchDecisionId: decisionId("cancel"),
    actionTokenId: params.actionTokens?.cancel || "",
  }, event.currentTarget)));
}

function renderDirectCommandExecutionRequestDetails(request, details, actions) {
  const params = request.params || {};
  appendRequestLine(details, "tool", params.tool || "run_command", { mono: true });
  appendRequestLine(details, "call type", params.providerCallType || "unknown", { mono: true });
  appendRequestLine(details, "command", params.displayCommand || commandText(params), { mono: true, pre: true });
  appendRequestLine(details, "cwd", params.cwdRelPath || ".", { mono: true });
  appendRequestLine(details, "timeout", params.timeoutMs ? `${params.timeoutMs} ms` : "default");
  appendRequestLine(details, "class", params.commandClass || "package_script");
  appendRequestLine(details, "workspace writes", params.workspaceWritePolicy || "writes_possible_with_warning");
  const scriptEvidence = params.packageScriptEvidence || {};
  if (scriptEvidence.scriptName) {
    appendRequestLine(details, "package script", `${scriptEvidence.packageManager || "npm"} ${scriptEvidence.scriptName}`, { mono: true });
    appendRequestLine(details, "script preview", scriptEvidence.scriptCommandPreview || "not available", { mono: true, pre: true });
  }
  if (!params.hasContinuityHandle) appendRequestLine(details, "continuation", "Missing provider continuity handle.");
  if (params.approvalAvailable === false) appendRequestLine(details, "approval", "Unavailable for this command shape.");
  const decisionId = (decision) => `${request.key}:${decision}`;
  actions.appendChild(createRequestButton("Approve command", "", (event) => submitRequestResponse(request, {
    decision: "approve",
    clientCommandDecisionId: decisionId("approve"),
    actionTokenId: params.actionTokens?.approve || "",
  }, event.currentTarget)));
  actions.appendChild(createRequestButton("Decline", "secondary", (event) => submitRequestResponse(request, {
    decision: "decline",
    clientCommandDecisionId: decisionId("decline"),
    actionTokenId: params.actionTokens?.decline || "",
  }, event.currentTarget)));
  actions.appendChild(createRequestButton("Cancel turn", "secondary", (event) => submitRequestResponse(request, {
    decision: "cancel",
    clientCommandDecisionId: decisionId("cancel"),
    actionTokenId: params.actionTokens?.cancel || "",
  }, event.currentTarget)));
}

function renderGenericRequestDetails(request, details) {
  appendRequestLine(details, "method", request.method || "", { mono: true });
  appendRequestLine(details, "params", request.params || "", { mono: true, pre: true });
  if (request.errorSummary) appendRequestLine(details, "error", request.errorSummary);
}

function renderServerRequest(request) {
  if (!request?.key) return;
  maybeReportContextManagementControl(request);
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
  else if (request.method === "direct/tool/readOnly/requestApproval") renderDirectReadOnlyToolRequestDetails(request, details, isPending ? actions : document.createElement("div"));
  else if (request.method === "direct/tool/patchApply/requestApproval") renderDirectPatchApplyRequestDetails(request, details, isPending ? actions : document.createElement("div"));
  else if (request.method === "direct/tool/command/requestApproval") renderDirectCommandExecutionRequestDetails(request, details, isPending ? actions : document.createElement("div"));
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

function subagentNotificationFromText(text) {
  const raw = String(text || "");
  if (!raw.trim().toLowerCase().startsWith("<subagent_notification>")) return null;
  const match = raw.match(/^\s*<subagent_notification>\s*([\s\S]*?)\s*<\/subagent_notification>\s*$/i);
  if (!match) {
    return {
      agentPath: raw.match(/"(?:agent_path|agentPath|agent_id|agentId)"\s*:\s*"([^"]+)"/)?.[1] || "",
      statusKey: "unknown",
      statusDetail: "",
      observedAt: "",
    };
  }
  let body = null;
  try {
    body = JSON.parse(match[1].trim());
  } catch {
    return null;
  }
  const status = body?.status;
  let statusKey = "";
  let statusDetail = "";
  if (typeof status === "string") {
    statusKey = status;
  } else if (status && typeof status === "object") {
    const [key, value] = Object.entries(status)[0] || [];
    statusKey = String(key || "");
    if (typeof value === "string") statusDetail = value;
  }
  const agentPath = String(body?.agent_path || body?.agentPath || body?.agent_id || body?.agentId || "").trim();
  if (!agentPath && !statusKey) return null;
  return {
    agentPath,
    statusKey: statusKey || "unknown",
    statusDetail,
    observedAt: notificationPayloadTimestamp(body),
  };
}

function subagentNotificationFromItem(item) {
  if (!item || item.type !== "subagentNotification") return null;
  return {
    agentPath: String(item.agentPath || item.agent_path || "").trim(),
    statusKey: String(item.statusKey || item.status || "unknown"),
    statusDetail: String(item.statusDetail || item.detail || ""),
    observedAt: notificationMessageTimestamp(item, {}),
  };
}

function normalizedNotificationTimestamp(value) {
  if (value === null || value === undefined || value === "") return "";
  const text = String(value).trim();
  const numeric = typeof value === "number" || /^\d+(\.\d+)?$/.test(text) ? Number(value) : Number.NaN;
  const timestamp = Number.isFinite(numeric)
    ? numeric > 1_000_000_000_000 ? numeric : numeric * 1000
    : Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function notificationPayloadTimestamp(body) {
  if (!body || typeof body !== "object") return "";
  return normalizedNotificationTimestamp(
    body.observedAt ||
    body.observed_at ||
    body.createdAt ||
    body.created_at ||
    body.updatedAt ||
    body.updated_at ||
    body.completedAt ||
    body.completed_at ||
    body.timestamp ||
    body.at ||
    "",
  );
}

function notificationMessageTimestamp(message, notification = {}) {
  return notification.observedAt ||
    normalizedNotificationTimestamp(
      message?.observedAt ||
      message?.observed_at ||
      message?.createdAt ||
      message?.created_at ||
      message?.updatedAt ||
      message?.updated_at ||
      message?.completedAt ||
      message?.completed_at ||
      message?.timestamp ||
      message?.at ||
      "",
    );
}

function storedMessageIsSubagentNotification(message) {
  return Boolean(subagentNotificationFromText(storedMessageText(message)));
}

function normalizedControlText(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trim();
}

function finiteSourceOrder(value, fallback = Number.POSITIVE_INFINITY) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function collabPromptInfoFromItem(item, orderFallback = Number.POSITIVE_INFINITY) {
  if (item?.type !== "collabAgentToolCall") return null;
  const text = normalizedControlText(item.prompt || item.promptPreview || "");
  if (!text) return null;
  return {
    text,
    order: finiteSourceOrder(item.sourceOrderStart ?? item.sourceOrderEnd, orderFallback),
  };
}

function collabPromptInfosFromItems(items = []) {
  const prompts = [];
  for (const item of Array.isArray(items) ? items : []) {
    const prompt = collabPromptInfoFromItem(item);
    if (prompt) prompts.push(prompt);
  }
  return prompts;
}

function messageMatchesCollabPrompt(message, collabPrompts) {
  if (!Array.isArray(collabPrompts) || !collabPrompts.length) return false;
  const text = normalizedControlText(storedMessageText(message));
  if (!text) return false;
  const messageOrder = finiteSourceOrder(message?.sourceOrderStart ?? message?.sourceOrderEnd, Number.NEGATIVE_INFINITY);
  return collabPrompts.some((prompt) => prompt.text === text && prompt.order < messageOrder);
}

function userMessageItemText(item) {
  return (item?.content || []).map(userInputToText).filter(Boolean).join("\n\n");
}

function userMessageItemMatchesCollabPrompt(item, collabPrompts) {
  if (!Array.isArray(collabPrompts) || !collabPrompts.length) return false;
  const text = normalizedControlText(userMessageItemText(item));
  return Boolean(text && collabPrompts.some((prompt) => prompt.text === text));
}

function storedTurnUserMessageCount(turn) {
  if (!Array.isArray(turn?.userMessages)) return 0;
  const collabPrompts = collabPromptInfosFromItems(turn?.thoughtItems);
  return turn.userMessages.filter((message) =>
    !storedMessageIsSubagentNotification(message) &&
    !messageMatchesCollabPrompt(message, collabPrompts)).length;
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

function renderStoredPresentationModel(model, snapshot = {}) {
  const turns = Array.isArray(model?.turns) ? model.turns : [];
  if (!turns.length) return false;
  const previousBulkRendering = state.isBulkRendering;
  state.isBulkRendering = true;
  try {
  const authorContext = currentAuthorContext({
    ...(model?.threadMeta || {}),
    threadId: model?.threadId || snapshot?.threadId || state.threadId,
    isSubagent: Boolean(model?.threadMeta?.isSubagent || snapshot?.isSubagent),
    parentThreadId: model?.threadMeta?.parentThreadId || snapshot?.parentThreadId || "",
    agentNickname: model?.threadMeta?.agentNickname || snapshot?.agentNickname || "",
    agentRole: model?.threadMeta?.agentRole || snapshot?.agentRole || "",
  });
  setActiveThreadMeta(authorContext);
  if (!authorContext.isSubagent) ensureAgentGraph(model?.threadId || snapshot?.threadId || state.threadId);
  const totalUserMessages = turns.reduce((sum, turn) => sum + storedTurnUserMessageCount(turn), 0);
  const visibleUserMessages = visibleUserMessageCount(totalUserMessages);
  const hiddenUserMessages = Math.max(0, totalUserMessages - visibleUserMessages);
  const startTurnIndex = storedStartTurnIndex(turns, hiddenUserMessages);
  const visibleTurns = turns.slice(startTurnIndex);

  renderLoadMoreControl(hiddenUserMessages);

  for (let index = 0; index < visibleTurns.length; index += 1) {
    const turn = visibleTurns[index];
    const turnKey = String(turn.turnKey || turn.turnId || `stored_turn_${startTurnIndex + index + 1}`);
    rememberTurnTiming(turnKey, turn);
    const collabPrompts = collabPromptInfosFromItems(turn.thoughtItems);
    for (let messageIndex = 0; messageIndex < (turn.userMessages || []).length; messageIndex += 1) {
      const message = turn.userMessages[messageIndex];
      const notification = subagentNotificationFromText(storedMessageText(message));
      if (notification) {
        recordNotificationTurnActivity(turnKey, { ...notification, observedAt: notificationMessageTimestamp(message, notification) });
        continue;
      }
      if (messageMatchesCollabPrompt(message, collabPrompts)) continue;
      const id = String(message.id || `stored_user_${turnKey}_${messageIndex}`);
      setMessageText(id, authorContext.userRole, storedMessageText(message), authorContext.userTitle);
    }
    for (let messageIndex = 0; messageIndex < (turn.systemMessages || []).length; messageIndex += 1) {
      const message = turn.systemMessages[messageIndex];
      const id = String(message.id || `stored_system_${turnKey}_${messageIndex}`);
      setMessageText(id, "system", storedMessageText(message), "System");
    }
    const thoughtItems = Array.isArray(turn.thoughtItems) ? turn.thoughtItems : [];
    if (thoughtItems.length) {
      const normalizedThoughtItems = thoughtItems.map((item, itemIndex) => ({
        ...item,
        id: String(item.id || `stored_thought_${turnKey}_${itemIndex}`),
        turnId: turn.turnId || turnKey,
      }));
      const collabItems = normalizedThoughtItems.filter((item) => item?.type === "collabAgentToolCall");
      const notificationItems = normalizedThoughtItems.filter((item) => item?.type === "subagentNotification");
      const processItems = normalizedThoughtItems.filter(
        (item) => item?.type !== "collabAgentToolCall" && item?.type !== "subagentNotification",
      );
      for (const item of collabItems) {
        if (!authorContext.isSubagent) {
          updateAgentFromCollabItem(item);
          recordCollabTurnActivity(turnKey, item);
        }
      }
      for (const item of notificationItems) {
        if (!authorContext.isSubagent) recordNotificationTurnActivity(turnKey, subagentNotificationFromItem(item));
      }
      if (processItems.length) {
        upsertThoughtProcess(turnKey, processItems, { merge: false });
      }
    }
    for (let messageIndex = 0; messageIndex < (turn.assistantFinalMessages || []).length; messageIndex += 1) {
      const message = turn.assistantFinalMessages[messageIndex];
      const id = String(message.id || `stored_assistant_${turnKey}_${messageIndex}`);
      rememberFinalMessageItem(id, turnKey);
      setMessageText(id, "assistant", storedMessageText(message), authorContext.assistantTitle, turnFileEvidenceContext(turnKey));
    }
  }

  const visibleOrphans = (model.orphanItems || []).filter(Boolean);
  if (visibleOrphans.length) {
    const collabOrphans = visibleOrphans.filter((item) => item?.type === "collabAgentToolCall");
    const notificationOrphans = visibleOrphans.filter((item) => item?.type === "subagentNotification");
    const processOrphans = visibleOrphans.filter(
      (item) => item?.type !== "collabAgentToolCall" && item?.type !== "subagentNotification",
    );
    for (const item of collabOrphans) {
      if (!authorContext.isSubagent) {
        updateAgentFromCollabItem(item);
        recordCollabTurnActivity("stored_orphans", item);
      }
    }
    for (const item of notificationOrphans) {
      if (!authorContext.isSubagent) recordNotificationTurnActivity("stored_orphans", subagentNotificationFromItem(item));
    }
    if (processOrphans.length) upsertThoughtProcess("stored_orphans", processOrphans, { merge: false });
  }
  reconcileTurnStateFromStoredPresentationModel(model);
  return true;
  } finally {
    state.isBulkRendering = previousBulkRendering;
  }
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
  setActiveThreadMeta({
    threadId,
    isSubagent: Boolean(snapshot?.isSubagent),
    parentThreadId: snapshot?.parentThreadId || "",
    agentNickname: snapshot?.agentNickname || "",
    agentRole: snapshot?.agentRole || "",
  });
  if (!state.threadMeta?.isSubagent) resetAgentGraph(threadId);
  if (renderStoredPresentationModel(snapshot?.presentationModel, snapshot)) {
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
    if (allEntries[index]?.role === "user" && !subagentNotificationFromText(allEntries[index]?.text || "")) {
      userEntryIndices.push(index);
    }
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
    const notification = entry.role === "user" ? subagentNotificationFromText(entry.text || "") : null;
    if (notification) {
      recordNotificationTurnActivity(`stored_notification_${absoluteIndex + 1}`, { ...notification, observedAt: notificationMessageTimestamp(entry, notification) });
      continue;
    }
    const authorContext = currentAuthorContext();
    const role = entry.role === "assistant"
      ? "assistant"
      : entry.role === "user"
        ? authorContext.userRole
        : "system";
    const roleTitle = role === "assistant"
      ? authorContext.assistantTitle
      : entry.role === "user"
        ? authorContext.userTitle
        : "System";
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
  if (isDirectLiveTextSurface() && hasCapability("threads", "canList")) {
    await refreshDirectThreadList({ showErrors: false });
    let lastOpenError = null;
    for (const entry of state.directThreadList) {
      const threadId = String(entry?.threadId || entry?.id || "").trim();
      if (!threadId) continue;
      try {
        await openDirectThread(threadId);
        return;
      } catch (error) {
        lastOpenError = error;
      }
    }
    if (lastOpenError) {
      addSystemMessage(`Unable to restore existing direct thread: ${lastOpenError.message}. Starting a new thread instead.`);
    }
  }
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

async function resumeThreadById(threadId, sessionFilePath = "", options = {}) {
  const rolloutPath = String(sessionFilePath || "").trim();
  const excludeTurns = Boolean(options.excludeTurns);
  const attempts = [
    ...(rolloutPath ? [
      { method: "thread/resume", params: { threadId, path: rolloutPath, ...(excludeTurns ? { excludeTurns: true } : {}) } },
      { method: "thread/resume", params: { threadId, path: rolloutPath, cwd: workspaceRootText() || null, ...(excludeTurns ? { excludeTurns: true } : {}) } },
    ] : []),
    { method: "thread/resume", params: { threadId, ...(excludeTurns ? { excludeTurns: true } : {}) } },
    { method: "thread/resume", params: { threadId, cwd: workspaceRootText() || null, ...(excludeTurns ? { excludeTurns: true } : {}) } },
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

async function attachLiveThread(threadId, sessionFilePath = "", options = {}) {
  const requestedThreadId = String(threadId || "").trim();
  if (!requestedThreadId) throw new Error("Missing Codex thread id.");
  if (!state.connected) throw new Error("Codex surface is not connected yet.");
  if (!hasCapability("threads", "canResume") && !hasCapability("threads", "canRead")) {
    throw new Error("Active Codex runtime does not expose live thread read/resume capability.");
  }
  let result = null;
  try {
    result = await resumeThreadById(requestedThreadId, sessionFilePath, options);
  } catch (error) {
    if (options.skipReadFallback) throw error;
    result = await readThreadById(requestedThreadId);
  }
  return result;
}

function applyLiveThreadResult(result) {
  if (!result?.thread) return;
  if (shouldPreserveStoredTranscriptOnLiveAttach(result.thread)) {
    bindThread(result.thread, result.model, { liveAttached: true });
    reconcileTurnStateFromLiveThread(result.thread);
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
  state.activeModel = "";
  await loadRuntimePreferences({
    applyThread: true,
    threadId: requestedThreadId,
    guardThreadId: requestedThreadId,
    guardSourceHome: state.sourceHome,
    guardSessionFilePath: state.sessionFilePath,
  });
  if (openRequestId !== state.openRequestId) return;
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
  let preserveStoredTranscriptOnAttach = false;
  try {
    const snapshot = await readStoredThreadTranscript(requestedThreadId, state.sourceHome, sessionFilePath);
    if (openRequestId !== state.openRequestId) return;
    if (snapshot?.entries?.length) {
      preserveStoredTranscriptOnAttach = Boolean(snapshot?.presentationModel);
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
    const liveResult = await attachLiveThread(requestedThreadId, sessionFilePath, {
      excludeTurns: preserveStoredTranscriptOnAttach,
      skipReadFallback: preserveStoredTranscriptOnAttach,
    });
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
        if (payload.runtimeStartupPending) {
          addSystemMessage("Stored transcript rendered while Codex app-server starts.");
          setComposerEnabled(false, "Stored transcript rendered. Live Codex attach is pending app-server startup.");
          return;
        }
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
    addSystemMessage(`Stored transcript rendered. Live attach unavailable for ${requestedThreadId}: ${message}`);
    await reportThreadState("rendered_stored", {
      threadId: requestedThreadId,
      sourceHome: state.sourceHome,
      sessionFilePath: state.sessionFilePath,
      title: state.threadTitle || titleHint || payloadTitle || requestedThreadId,
      evidence: "live-attach-after-stored-render",
      errorDescription: message,
    });
    setComposerEnabled(false, "Stored transcript rendered read-only. Live Codex attach is unavailable for this thread.");
  }
}

function bindThread(thread, modelName = "", options = {}) {
  state.threadId = thread?.id || "";
  setActiveThreadMeta(threadAgentMeta(thread || {}));
  if (!state.threadMeta?.isSubagent && options.resetAgentGraph !== false) ensureAgentGraph(state.threadId);
  state.liveAttached = options.liveAttached !== false;
  state.activeModel = String(modelName || state.activeModel || project?.codex?.model || "");
  const title = thread?.title || thread?.name || thread?.preview || state.threadTitle || payload.initialThreadTitle || state.threadId;
  const isDirectFixture = connection?.transport === DIRECT_FIXTURE_TRANSPORT;
  const isDirectLiveText = connection?.transport === DIRECT_LIVE_TEXT_TRANSPORT;
  updateSurfaceHeader(title, workspaceText());
  setComposerEnabled(state.liveAttached, state.liveAttached ? "" : "Read-only mode");
  setNotice(
    isDirectLiveText ? "Direct live text session ready" : isDirectFixture ? "Direct fixture session ready" : "Codex session ready",
    isDirectFixture
      ? "Fixture-only direct controller is connected."
      : isDirectLiveText
        ? "Live text direct controller is connected. Tools are detection-only."
      : thread?.preview ? `Resumed thread: ${thread.preview}` : "Managed local Codex app-server is connected.",
    { success: true, showNewThread: true },
  );
  reconcileTurnStateFromLiveThread(thread);
  renderDirectThreadList();
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

function collabToolDisplayName(tool) {
  const normalized = String(tool || "").trim();
  const labels = {
    spawnAgent: "Spawn agent",
    spawn_agent: "Spawn agent",
    sendInput: "Send input",
    send_input: "Send input",
    send_message: "Send input",
    resumeAgent: "Resume agent",
    resume_agent: "Resume agent",
    wait: "Wait",
    wait_agent: "Wait",
    closeAgent: "Close agent",
    close_agent: "Close agent",
  };
  return labels[normalized] || normalized || "Sub-agent action";
}

function normalizeCollabAgentItem(item = {}) {
  const receiverThreadIds = Array.isArray(item.receiverThreadIds)
    ? item.receiverThreadIds
    : Array.isArray(item.receiver_thread_ids)
      ? item.receiver_thread_ids
      : [];
  const agentsStates = Array.isArray(item.agentsStates)
    ? item.agentsStates
    : Array.isArray(item.agents_states)
      ? item.agents_states
      : [];
  return {
    id: String(item.id || item.callId || item.call_id || ""),
    tool: String(item.tool || "call"),
    status: String(item.status || "unknown"),
    senderThreadId: String(item.senderThreadId || item.sender_thread_id || state.threadId || ""),
    receiverThreadIds: receiverThreadIds.map((id) => String(id || "")).filter(Boolean),
    prompt: String(item.prompt || ""),
    model: String(item.model || ""),
    reasoningEffort: String(item.reasoningEffort || item.reasoning_effort || ""),
    agentsStates: agentsStates.map((agent) => ({
      threadId: String(agent?.threadId || agent?.thread_id || ""),
      status: String(agent?.status || "unknown"),
      nickname: String(agent?.nickname || agent?.agentNickname || agent?.agent_nickname || ""),
      role: String(agent?.role || agent?.agentRole || agent?.agent_role || ""),
    })).filter((agent) => agent.threadId || agent.status),
  };
}

function ensureAgentGraph(threadId = state.threadId) {
  const primaryThreadId = String(threadId || state.threadId || "");
  if (!state.agentGraph || String(state.agentGraph.primaryThreadId || "") !== primaryThreadId) {
    resetAgentGraph(primaryThreadId);
  }
  return state.agentGraph;
}

function graphAgentLabel(agent) {
  return agentDisplayLabel({
    threadId: agent.threadId,
    agentNickname: agent.nickname,
    agentRole: agent.role,
  });
}

function ensureGraphAgent(threadId, patch = {}) {
  const id = String(threadId || "").trim();
  if (!id) return null;
  const graph = ensureAgentGraph();
  const existing = graph.agents.get(id) || {
    threadId: id,
    parentThreadId: String(patch.parentThreadId || state.threadId || ""),
    nickname: "",
    role: "",
    label: `Agent ${shortAgentThreadId(id)}`,
    status: "discovered",
    activityStatus: "unknown",
    hydrationStatus: "not_requested",
    model: "",
    reasoningEffort: "",
    transcript: [],
    turnScopes: {},
    evidenceRefs: [],
  };
  const next = {
    ...existing,
    ...patch,
    threadId: id,
    parentThreadId: String(patch.parentThreadId || existing.parentThreadId || state.threadId || ""),
    nickname: String(patch.nickname ?? existing.nickname ?? ""),
    role: String(patch.role ?? existing.role ?? ""),
    model: String(patch.model ?? existing.model ?? ""),
    reasoningEffort: String(patch.reasoningEffort ?? existing.reasoningEffort ?? ""),
  };
  next.label = graphAgentLabel(next);
  graph.agents.set(id, next);
  graph.updatedAt = new Date().toISOString();
  return next;
}

function collabPromptPreview(prompt) {
  return compactValue(String(prompt || ""), 220);
}

function normalizeSubagentNotificationStatus(statusKey) {
  const key = String(statusKey || "unknown").trim();
  const labels = {
    pending_init: "pending",
    running: "running",
    interrupted: "interrupted",
    completed: "completed",
    errored: "failed",
    shutdown: "shutdown",
    not_found: "not found",
    unknown: "unknown",
  };
  return {
    key,
    label: labels[key] || key.replace(/_/g, " "),
    graphStatus: key === "errored" ? "failed" : key === "pending_init" ? "pending" : key,
    activityStatus: key === "running"
      ? "active"
      : key === "interrupted"
        ? "waiting"
        : ["completed", "shutdown", "not_found", "errored"].includes(key)
          ? "last_seen_completed"
          : "unknown",
  };
}

function findAgentForSubagentNotification(agentPath) {
  const ref = String(agentPath || "").trim();
  if (!ref || !state.agentGraph?.agents) return null;
  if (state.agentGraph.agents.has(ref)) return state.agentGraph.agents.get(ref);
  const refLeaf = pathLeaf(ref);
  for (const agent of state.agentGraph.agents.values()) {
    const agentPathRef = String(agent.agentPath || "");
    const threadIdRef = String(agent.threadId || "");
    if (agentPathRef === ref) return agent;
    if (threadIdRef === ref || threadIdRef === refLeaf) return agent;
    if (pathLeaf(agentPathRef) === refLeaf) return agent;
  }
  return null;
}

function pathLeaf(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const index = text.lastIndexOf("/");
  return index >= 0 ? text.slice(index + 1) || text : text;
}

function applySubagentNotification(notification) {
  if (!notification || currentAuthorContext().isSubagent) return null;
  const status = normalizeSubagentNotificationStatus(notification.statusKey);
  const existing = findAgentForSubagentNotification(notification.agentPath);
  const fallbackThreadId = String(notification.agentPath || "").includes("/") ? "" : String(notification.agentPath || "");
  const targetThreadId = existing?.threadId || fallbackThreadId;
  if (!targetThreadId) return null;
  const agent = ensureGraphAgent(targetThreadId, {
    agentPath: notification.agentPath || existing?.agentPath || "",
    status: status.graphStatus,
    activityStatus: status.activityStatus,
    lastAction: {
      tool: "subagentNotification",
      status: status.graphStatus,
      callId: `notification:${notification.agentPath}:${notification.statusKey}`,
    },
    promptPreview: notification.statusDetail || existing?.promptPreview || "",
    evidenceRefs: [{
      kind: "subagent_notification",
      label: `Sub-agent ${status.label}`,
      observedAt: notification.observedAt || new Date().toISOString(),
    }],
  });
  if (agent) {
    state.agentGraphRevision += 1;
    reportAgentGraph();
  }
  return agent;
}

function normalizeCollabToolKey(tool) {
  const raw = String(tool || "").trim();
  const aliases = {
    spawn_agent: "spawnAgent",
    send_input: "sendInput",
    send_message: "sendInput",
    resume_agent: "resumeAgent",
    wait_agent: "wait",
    close_agent: "closeAgent",
  };
  return aliases[raw] || raw;
}

function collabActivityVerb(collab) {
  const tool = normalizeCollabToolKey(collab.tool);
  const status = String(collab.status || "unknown");
  if (status === "failed") {
    if (tool === "spawnAgent") return "Failed to create";
    if (tool === "sendInput") return "Failed to send input to";
    if (tool === "resumeAgent") return "Failed to resume";
    if (tool === "wait") return "Wait failed for";
    if (tool === "closeAgent") return "Failed to close";
    return "Sub-agent action failed for";
  }
  if (tool === "spawnAgent") return status === "inProgress" ? "Creating" : "Created";
  if (tool === "sendInput") return "Sent input to";
  if (tool === "resumeAgent") return "Resumed";
  if (tool === "wait") return status === "inProgress" ? "Waiting for" : "Wait completed for";
  if (tool === "closeAgent") return "Closed";
  return collabToolDisplayName(tool);
}

function collabAgentProjection(threadId, statePatch = {}) {
  const id = String(threadId || "").trim();
  const agent = id ? state.agentGraph?.agents?.get(id) : null;
  const meta = {
    threadId: id,
    nickname: statePatch.nickname || agent?.nickname || "",
    role: statePatch.role || agent?.role || "",
  };
  return {
    threadId: id,
    displayLabel: agentDisplayLabel(meta),
    nickname: meta.nickname,
    role: meta.role,
    lifecycleStatus: statePatch.status || agent?.status || "",
    activityStatus: agent?.activityStatus || "",
    model: agent?.model || "",
    reasoningEffort: agent?.reasoningEffort || "",
    clickable: Boolean(id),
  };
}

function projectCollabActivityTag(item) {
  const collab = normalizeCollabAgentItem(item);
  const stateByThreadId = new Map(collab.agentsStates.map((agent) => [agent.threadId, agent]));
  const receiverIds = Array.from(new Set([
    ...collab.receiverThreadIds,
    ...collab.agentsStates.map((agent) => agent.threadId),
  ].filter(Boolean)));
  const agents = receiverIds.map((id) => collabAgentProjection(id, stateByThreadId.get(id) || {}));
  const verb = collabActivityVerb(collab);
  const label = agents.length
    ? `${verb} ${agents.map((agent) => agent.displayLabel).join(", ")}`
    : verb === "Creating" ? "Creating sub-agent..." : `${verb} sub-agent`;
  return {
    id: collab.id || item?.id || "",
    tool: collab.tool,
    status: collab.status,
    senderThreadId: collab.senderThreadId,
    receiverThreadIds: receiverIds,
    label,
    verb,
    promptPreview: collabPromptPreview(collab.prompt),
    model: collab.model,
    reasoningEffort: collab.reasoningEffort,
    agents,
  };
}

function focusSubAgentFromChip(agent, scope = {}) {
  const receiverThreadId = String(agent?.threadId || "").trim();
  if (!receiverThreadId || !bridge?.focusSubAgent) return;
  bridge.focusSubAgent({
    projectId: project?.id || payload.codexConnection?.projectId || "",
    primaryThreadId: state.threadId,
    receiverThreadId,
    scopeMode: scope.mode || "",
    turnKey: scope.turnKey || "",
    graphRevision: state.agentGraphRevision,
    activationEpoch: Number(payload.activationEpoch) || 0,
    label: agent.displayLabel || receiverThreadId,
  }).catch(() => {});
}

function subagentStatusRank(status) {
  const normalized = String(status || "").trim();
  const ranks = {
    unknown: 0,
    discovered: 1,
    pending: 2,
    creating: 3,
    waiting: 4,
    closing: 4,
    running: 5,
    active: 5,
    completed: 6,
    shutdown: 7,
    closed: 7,
    interrupted: 8,
    failed: 9,
    errored: 9,
    not_found: 9,
  };
  return ranks[normalized] ?? 0;
}

function normalizeAgentWorkingStatus(status) {
  const normalized = String(status || "").trim();
  if (normalized === "inProgress") return "running";
  if (normalized === "pending_init") return "pending";
  if (normalized === "errored") return "failed";
  return normalized || "unknown";
}

function collabWorkingStatus(collab) {
  const tool = normalizeCollabToolKey(collab.tool);
  const status = String(collab.status || "unknown");
  if (status === "failed") return "failed";
  if (tool === "spawnAgent") return status === "inProgress" ? "creating" : "running";
  if (tool === "sendInput") return status === "inProgress" ? "running" : "running";
  if (tool === "resumeAgent") return status === "inProgress" ? "running" : "running";
  if (tool === "wait") return status === "inProgress" ? "waiting" : "waiting";
  if (tool === "closeAgent") return status === "inProgress" ? "closing" : "shutdown";
  return normalizeAgentWorkingStatus(status);
}

function ensureSubagentTurnActivity(turnKey) {
  const key = String(turnKey || "live");
  let activity = state.subagentActivityByTurn.get(key);
  if (!activity) {
    activity = { turnKey: key, agents: new Map(), events: [] };
    state.subagentActivityByTurn.set(key, activity);
  }
  return activity;
}

function agentTurnScopeEntry(agent, turnKey) {
  if (!agent) return null;
  if (!agent.turnScopes || typeof agent.turnScopes !== "object") agent.turnScopes = {};
  const key = String(turnKey || "live");
  if (!agent.turnScopes[key]) {
    agent.turnScopes[key] = {
      turnKey: key,
      events: [],
    };
  }
  return agent.turnScopes[key];
}

function recordSubagentTurnEvent(turnKey, agent, event) {
  const key = String(turnKey || "live");
  const activity = ensureSubagentTurnActivity(key);
  const id = String(agent?.threadId || event?.threadId || "").trim();
  if (!id) return;
  const clickable = event.clickable ?? Boolean(agent?.threadId);
  const existing = activity.agents.get(id) || {
    threadId: id,
    displayLabel: agent?.label || agent?.displayLabel || agentDisplayLabel({ threadId: id }),
    status: "unknown",
    activityStatus: "",
    model: "",
    reasoningEffort: "",
    clickable,
    events: [],
  };
  const nextStatus = normalizeAgentWorkingStatus(event.status || existing.status);
  const mergedStatus = subagentStatusRank(nextStatus) >= subagentStatusRank(existing.status)
    ? nextStatus
    : existing.status;
  existing.displayLabel = agent?.label || agent?.displayLabel || existing.displayLabel;
  existing.status = mergedStatus;
  existing.activityStatus = event.activityStatus || existing.activityStatus;
  existing.model = event.model || agent?.model || existing.model || "";
  existing.reasoningEffort = event.reasoningEffort || agent?.reasoningEffort || existing.reasoningEffort || "";
  existing.clickable = existing.clickable || clickable;
  existing.events.push(event);
  activity.events.push({ ...event, threadId: id, displayLabel: existing.displayLabel });
  activity.agents.set(id, existing);

  const scope = agentTurnScopeEntry(agent, key);
  if (scope) {
    scope.status = mergedStatus;
    scope.model = event.model || agent?.model || scope.model || "";
    scope.reasoningEffort = event.reasoningEffort || agent?.reasoningEffort || scope.reasoningEffort || "";
    scope.events.push({ ...event, threadId: id, displayLabel: existing.displayLabel });
  }
}

function renderSubagentTurnActivity(turnKey) {
  const key = String(turnKey || "live");
  const activity = state.subagentActivityByTurn.get(key);
  const agents = Array.from(activity?.agents?.values?.() || []);
  const messageId = `subagent_activity_${key}`;
  if (!agents.length) {
    const existing = state.itemMap.get(messageId);
    if (existing) {
      existing.remove();
      state.itemMap.delete(messageId);
    }
    return;
  }
  const node = ensureMessage(messageId, "system", "Sub-agent activity");
  node.classList.add("collab-meta-message");
  const bubble = node.querySelector(".bubble");
  bubble.innerHTML = "";
  bubble.dataset.rawText = `Sub-agents in this turn: ${agents.map((agent) => `${agent.displayLabel} · ${agent.status}`).join(", ")}`;
  bubble.dataset.typedRendered = "true";
  bubble.dataset.streamingPlain = "false";

  const root = document.createElement("div");
  root.className = "collab-activity-tag collab-activity-summary";
  const action = document.createElement("span");
  action.className = "collab-activity-verb";
  action.textContent = "Sub-agents in this turn ";
  root.appendChild(action);

  const chipList = document.createElement("span");
  chipList.className = "collab-agent-chip-list";
  for (const agent of agents) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `collab-agent-chip status-${String(agent.status || "unknown").replace(/[^a-z0-9_-]/gi, "-")}`;
    chip.textContent = `${agent.displayLabel} · ${String(agent.status || "unknown").replace(/_/g, " ")}`;
    chip.disabled = !agent.clickable;
    chip.title = agent.clickable
      ? `Open ${agent.displayLabel} turn activity in the Sub-agents panel`
      : `${agent.displayLabel} is only available as an unmapped notification`;
    chip.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!agent.clickable) return;
      focusSubAgentFromChip(agent, { mode: "turn", turnKey: key });
    });
    chipList.appendChild(chip);
  }
  root.appendChild(chipList);

  bubble.appendChild(root);
  maybeAutoScrollBottom();
}

function recordCollabTurnActivity(turnKey, item) {
  const projection = projectCollabActivityTag(item);
  const collab = normalizeCollabAgentItem(item);
  for (const agentProjection of projection.agents) {
    const status = normalizeAgentWorkingStatus(agentProjection.lifecycleStatus || collabWorkingStatus(collab));
    const existing = agentProjection.threadId ? state.agentGraph?.agents?.get(agentProjection.threadId) : null;
    const mergedStatus = subagentStatusRank(status) >= subagentStatusRank(existing?.status)
      ? status
      : existing?.status || status;
    const agent = ensureGraphAgent(agentProjection.threadId, {
      nickname: agentProjection.nickname || undefined,
      role: agentProjection.role || undefined,
      model: projection.model || undefined,
      reasoningEffort: projection.reasoningEffort || undefined,
      status: mergedStatus,
      activityStatus: ["creating", "running", "waiting"].includes(mergedStatus) ? "active" : "last_seen_completed",
    });
    recordSubagentTurnEvent(turnKey, agent, {
      kind: "collab_tool_call",
      label: projection.label,
      tool: projection.tool,
      status: mergedStatus,
      actionStatus: projection.status,
      promptPreview: projection.promptPreview || "",
      model: projection.model || "",
      reasoningEffort: projection.reasoningEffort || "",
      observedAt: new Date().toISOString(),
    });
  }
  state.agentGraphRevision += 1;
  reportAgentGraph();
  renderSubagentTurnActivity(turnKey);
}

function recordNotificationTurnActivity(turnKey, notification) {
  const statusInfo = normalizeSubagentNotificationStatus(notification?.statusKey);
  const agent = applySubagentNotification(notification);
  const fallbackPath = String(notification?.agentPath || "").trim();
  const fallbackKey = fallbackPath ? `notification:${fallbackPath}` : "";
  const fallbackAgent = agent || (fallbackKey ? {
    threadId: "",
    label: agentDisplayLabel({ threadId: fallbackPath }),
    displayLabel: agentDisplayLabel({ threadId: fallbackPath }),
  } : null);
  if (!fallbackAgent) return;
  recordSubagentTurnEvent(turnKey, fallbackAgent, {
    kind: "subagent_notification",
    threadId: agent?.threadId || fallbackKey,
    clickable: Boolean(agent?.threadId),
    label: `Sub-agent ${statusInfo.label}`,
    status: normalizeAgentWorkingStatus(statusInfo.graphStatus),
    activityStatus: statusInfo.activityStatus,
    detail: String(notification?.statusDetail || ""),
    observedAt: notification?.observedAt || new Date().toISOString(),
  });
  state.agentGraphRevision += 1;
  reportAgentGraph();
  renderSubagentTurnActivity(turnKey);
}

function updateAgentFromCollabItem(item) {
  const collab = normalizeCollabAgentItem(item);
  if (!collab.receiverThreadIds.length && !collab.agentsStates.length) return;
  const graph = ensureAgentGraph(state.threadId);
  const statusById = new Map(collab.agentsStates.map((agent) => [agent.threadId, agent]));
  const receiverIds = new Set([...collab.receiverThreadIds, ...collab.agentsStates.map((agent) => agent.threadId)].filter(Boolean));
  for (const receiverId of receiverIds) {
    const agentState = statusById.get(receiverId) || {};
    const agent = ensureGraphAgent(receiverId, {
      parentThreadId: collab.senderThreadId || state.threadId,
      nickname: agentState.nickname || undefined,
      role: agentState.role || undefined,
      model: collab.model || undefined,
      reasoningEffort: collab.reasoningEffort || undefined,
      status: agentState.status || collab.status || "unknown",
      activityStatus: collab.status === "inProgress" ? "active" : "last_seen_completed",
      hydrationStatus: "metadata_pending",
      lastAction: {
        tool: collab.tool,
        status: collab.status,
        callId: collab.id,
      },
      promptPreview: collabPromptPreview(collab.prompt),
      evidenceRefs: [{
        kind: "collab_tool_call",
        label: `${collabToolDisplayName(collab.tool)} · ${collab.status}`,
        observedAt: new Date().toISOString(),
      }],
    });
    if (agent) hydrateAgentThread(receiverId, graph.graphId, graph.primaryThreadId);
  }
  state.agentGraphRevision += 1;
  reportAgentGraph();
}

function subAgentTranscriptFromSnapshot(snapshot, agent) {
  const context = currentAuthorContext({
    threadId: snapshot?.threadId || agent.threadId,
    isSubagent: true,
    parentThreadId: snapshot?.parentThreadId || agent.parentThreadId || state.threadId,
    agentNickname: snapshot?.agentNickname || agent.nickname || "",
    agentRole: snapshot?.agentRole || agent.role || "",
  });
  const messages = [];
  const model = snapshot?.presentationModel;
  if (Array.isArray(model?.turns)) {
    for (const turn of model.turns) {
      for (const message of turn.userMessages || []) {
        messages.push({
          id: String(message.id || `sub_user_${messages.length}`),
          role: "parent",
          title: context.userTitle,
          text: storedMessageText(message),
        });
      }
      const thoughtItems = Array.isArray(turn.thoughtItems)
        ? turn.thoughtItems.filter((item) => item?.type !== "subagentNotification")
        : [];
      if (thoughtItems.length) {
        messages.push({
          id: String(`sub_process_${turn.turnId || turn.turnKey || messages.length}`),
          role: "process",
          title: "Thought process",
          text: thoughtItems.map((item) => thoughtItemLabel(item)).join("\n"),
          thoughtItems,
        });
      }
      for (const message of turn.assistantFinalMessages || []) {
        messages.push({
          id: String(message.id || `sub_agent_${messages.length}`),
          role: "child",
          title: context.assistantTitle,
          text: storedMessageText(message),
        });
      }
    }
    return messages;
  }
  for (const entry of snapshot?.entries || []) {
    const role = entry.role === "assistant" ? "child" : entry.role === "user" ? "parent" : "system";
    messages.push({
      id: String(entry.id || `sub_entry_${messages.length}`),
      role,
      title: role === "child" ? context.assistantTitle : role === "parent" ? context.userTitle : "System",
      text: String(entry.text || ""),
    });
  }
  return messages;
}

async function hydrateAgentThread(threadId, graphId, primaryThreadId) {
  const id = String(threadId || "").trim();
  const originGraphId = String(graphId || state.agentGraph?.graphId || "");
  const originPrimaryThreadId = String(primaryThreadId || state.agentGraph?.primaryThreadId || state.threadId || "");
  const requestKey = `${originGraphId}:${id}`;
  if (!id || !originGraphId || !originPrimaryThreadId || state.agentHydrationRequests.has(requestKey)) return;
  state.agentHydrationRequests.set(requestKey, { graphId: originGraphId, primaryThreadId: originPrimaryThreadId });
  const isCurrentHydrationTarget = () =>
    String(state.threadId || "") === originPrimaryThreadId &&
    String(state.agentGraph?.primaryThreadId || "") === originPrimaryThreadId &&
    String(state.agentGraph?.graphId || "") === originGraphId;
  try {
    const snapshot = await bridge.readStoredThreadTranscript?.(
      project?.id || "",
      id,
      state.sourceHome || "",
      "",
      2000,
    );
    if (!isCurrentHydrationTarget()) return;
    const agent = ensureGraphAgent(id, {
      parentThreadId: snapshot?.parentThreadId || state.threadId,
      nickname: snapshot?.agentNickname || undefined,
      role: snapshot?.agentRole || undefined,
      agentPath: snapshot?.agentPath || undefined,
      status: "available",
      hydrationStatus: "turns_ready",
    });
    if (agent) {
      agent.transcript = subAgentTranscriptFromSnapshot(snapshot, agent);
      state.agentGraphRevision += 1;
      reportAgentGraph();
    }
  } catch {
    if (!isCurrentHydrationTarget()) return;
    const agent = ensureGraphAgent(id, { hydrationStatus: "failed" });
    if (agent) {
      state.agentGraphRevision += 1;
      reportAgentGraph();
    }
  } finally {
    state.agentHydrationRequests.delete(requestKey);
  }
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
  if (item.type === "collabAgentToolCall") return `Sub-agent · ${collabToolDisplayName(item.tool)}`;
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
  state.finalTurnKeyByMessageId.set(id, key);
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

function isPatchFileEvidenceItem(item) {
  if (!item) return false;
  if (item.type === "fileChange") return true;
  const toolName = String(item.name || item.tool || item.toolName || "").toLowerCase();
  if (toolName.includes("apply_patch")) return true;
  const body = normalizeThoughtItemBody(item);
  return body.includes("*** Add File:") ||
    body.includes("*** Update File:") ||
    body.includes("*** Delete File:") ||
    body.includes("Updated the following files:");
}

function fileRefsFromPatchEvidenceItem(item) {
  if (!isPatchFileEvidenceItem(item)) return [];
  const refs = [];
  const pushValue = (value) => {
    const ref = fileRefFromTextCandidate(value);
    if (ref) refs.push(ref);
  };
  for (const change of Array.isArray(item?.changes) ? item.changes : []) {
    pushValue(change?.path || change?.relativePath || change?.file || "");
  }
  for (const value of [item?.path, item?.relativePath, item?.file, item?.savedPath, item?.stdout, item?.stderr]) {
    pushValue(value);
  }
  refs.push(...extractFileRefsFromText(normalizeThoughtItemBody(item)));
  return refs;
}

function registerTurnFileEvidence(turnKey, items) {
  const key = String(turnKey || "live");
  const refs = [];
  for (const item of Array.isArray(items) ? items : []) refs.push(...fileRefsFromPatchEvidenceItem(item));
  if (!refs.length) return;
  const evidence = state.turnFileEvidenceByTurn.get(key) || new Map();
  for (const ref of refs) {
    if (!ref?.path) continue;
    evidence.set(ref.path, { path: ref.path, line: ref.line, column: ref.column });
  }
  state.turnFileEvidenceByTurn.set(key, evidence);
}

function turnFileEvidenceContext(turnKey, baseContext = {}) {
  const evidence = state.turnFileEvidenceByTurn.get(String(turnKey || "live"));
  if (!evidence?.size) return baseContext;
  return {
    ...baseContext,
    fileEvidenceRefs: Array.from(evidence.values()),
  };
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
  if (item.type === "collabAgentToolCall") return false;
  if (isToolLikeThoughtItem(item)) return true;
  const body = normalizeThoughtItemBody(item);
  if (item.type === "reasoning" || isThoughtAssistantMessageItem(item)) return !isEmptyThoughtSentinel(body);
  return !isEmptyThoughtSentinel(body);
}

function projectThoughtItemsForRender(thoughtItems) {
  const visible = Array.isArray(thoughtItems) ? thoughtItems.filter(shouldRenderThoughtItem) : [];
  return {
    reasoningItems: visible.filter((item) => item?.type === "reasoning" || isThoughtAssistantMessageItem(item)),
    toolItems: visible.filter((item) => isToolLikeThoughtItem(item)),
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
  const summaryLabel = projection.reasoningItems.length
    ? `Thought process (${projection.visibleCount})`
    : `Process evidence (${projection.visibleCount})`;
  summary.appendChild(document.createTextNode(summaryLabel));
  const durationLabel = turnDurationLabel(turnKey);
  if (durationLabel) {
    const duration = document.createElement("span");
    duration.className = "thought-duration";
    duration.textContent = durationLabel;
    duration.title = "Turn duration";
    summary.appendChild(duration);
  }
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
  registerTurnFileEvidence(key, merged);
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

function renderItem(item, authorContext = currentAuthorContext()) {
  if (!item || !item.id) return;
  rememberCodexItem({ threadId: state.threadId, turnId: item.turnId || state.turnId, itemId: item.id }, item);
  if (item.memoryCitation && typeof item.memoryCitation === "object") {
    reportContextManagementEvidence({
      threadItems: [{
        id: String(item.id),
        type: String(item.type || "memoryCitation"),
        memoryCitation: {
          evidenceKey: String(item.memoryCitation.evidenceKey || item.memoryCitation.memoryId || item.id),
        },
      }],
    }).catch(() => {});
  }
  if (item.type === "userMessage") {
    const text = (item.content || []).map(userInputToText).filter(Boolean).join("\n\n");
    const notification = subagentNotificationFromText(text);
    if (notification) {
      if (!authorContext.isSubagent) recordNotificationTurnActivity(item.turnId || state.turnId || "live", notification);
      return;
    }
    setMessageText(item.id, authorContext.userRole, text, authorContext.userTitle);
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
    setMessageText(
      item.id,
      "assistant",
      item.text || "",
      authorContext.assistantTitle,
      turnFileEvidenceContext(item.turnId || state.turnId || ""),
    );
    return;
  }
  if (item.type === "collabAgentToolCall") {
    if (!authorContext.isSubagent) {
      updateAgentFromCollabItem(item);
      recordCollabTurnActivity(item.turnId || state.turnId || "live", item);
    }
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
    reportContextManagementEvidence({
      threadItems: [{
        id: String(item.id),
        type: "contextCompaction",
        lifecycle: String(item.lifecycle || item.status || "observed"),
      }],
    }).catch(() => {});
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
  setActiveThreadMeta(threadAgentMeta(thread || {}));
  const authorContext = currentAuthorContext();
  if (!authorContext.isSubagent) resetAgentGraph(thread?.id || state.threadId || "");
  const allTurns = Array.isArray(thread?.turns) ? thread.turns : [];
  const userMessageTurnIndices = [];
  for (let index = 0; index < allTurns.length; index += 1) {
    const seenCollabPrompts = [];
    for (const item of allTurns[index]?.items || []) {
      const collabPrompt = collabPromptInfoFromItem(item, seenCollabPrompts.length);
      if (collabPrompt) {
        seenCollabPrompts.push(collabPrompt);
        continue;
      }
      if (item?.type === "userMessage") {
        const text = userMessageItemText(item);
        if (!subagentNotificationFromText(text) && !userMessageItemMatchesCollabPrompt(item, seenCollabPrompts)) {
          userMessageTurnIndices.push(index);
        }
      }
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
    rememberTurnTiming(turnKey, turn);
    const userItems = [];
    const regularItems = [];
    const thoughtItems = [];
    const seenCollabPrompts = [];
    for (const item of turn.items || []) {
      if (!item) continue;
      const normalizedItem = item.turnId ? item : { ...item, turnId: turnKey };
      if (normalizedItem?.id) rememberCodexItem({ threadId: thread?.id || state.threadId, turnId: turnKey, itemId: normalizedItem.id }, normalizedItem);
      const collabPrompt = collabPromptInfoFromItem(normalizedItem, seenCollabPrompts.length);
      if (collabPrompt) seenCollabPrompts.push(collabPrompt);
      if (isThoughtItem(normalizedItem) || isThoughtAssistantMessageItem(normalizedItem)) thoughtItems.push(normalizedItem);
      else if (normalizedItem?.type === "userMessage") {
        if (!userMessageItemMatchesCollabPrompt(normalizedItem, seenCollabPrompts)) userItems.push(normalizedItem);
      }
      else regularItems.push(normalizedItem);
    }
    for (const item of userItems) renderItem(item, authorContext);
    if (thoughtItems.length) {
      for (const item of thoughtItems) {
        if (isThoughtAssistantMessageItem(item)) rememberThoughtAssistantItem(item, turnKey);
      }
      upsertThoughtProcess(turnKey, thoughtItems, { merge: false });
    }
    for (const item of regularItems) renderItem(item, authorContext);
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
  if (isDirectLiveTextSurface() && typeof bridge?.createDirectWorkThreadDraftSession === "function" && project?.id) {
    state.directThreadOpenRequestId += 1;
    const result = await bridge.createDirectWorkThreadDraftSession(project.id, {
      clientDraftId: `codex_surface_new_thread_${Date.now()}`,
      title: `${project?.name || "Direct"} direct session`,
      objectiveSummary: "Operator-created direct Codex session from the Codex plane.",
      contextPosture: "fresh_session_only",
      model: activeModelId() || null,
      reasoningEffort: requestedReasoningEffort() || null,
    });
    if (result?.status === "created" && result.thread) {
      clearRenderedThreadState();
      state.sourceHome = "";
      state.sessionFilePath = "";
      bindThread(result.thread, result.thread.model || activeModelId() || null);
      addSystemMessage(`Created WorkThread-backed direct session${result.workThread?.workThreadId ? ` (${result.workThread.workThreadId})` : ""}.`);
      await persistRuntimePreferences("thread-model");
      await refreshDirectSurfaceProjection({ render: false });
      await refreshDirectThreadList({ showErrors: false });
      renderRuntimeConstitution();
      return;
    }
    const blockers = Array.isArray(result?.draft?.blockerCodes) ? result.draft.blockerCodes.filter(Boolean).join(", ") : "";
    addSystemMessage(`Direct WorkThread draft did not create a session${blockers ? `: ${blockers}` : "."}`);
    return;
  }
  if (isDirectLiveTextSurface()) state.directThreadOpenRequestId += 1;
  const cwd = workspaceRootText();
  const params = {
    cwd,
    model: activeModelId() || null,
    reasoningEffort: requestedReasoningEffort() || null,
    experimentalRawEvents: false,
    persistExtendedHistory: true,
  };
  if (state.runtimeOverrides.approvalPolicy) params.approvalPolicy = state.runtimeOverrides.approvalPolicy;
  if (state.runtimeOverrides.sandboxMode) params.sandbox = state.runtimeOverrides.sandboxMode;
  if (state.runtimeOverrides.serviceTier) params.serviceTier = state.runtimeOverrides.serviceTier;
  const result = await rpc("thread/start", params);
  clearRenderedThreadState();
  state.sourceHome = "";
  state.sessionFilePath = "";
  bindThread(result.thread, result.model);
  await persistRuntimePreferences("thread-model");
  await refreshDirectSurfaceProjection({ render: false });
  await refreshDirectThreadList({ showErrors: false });
}

async function startCodexTurn(text, options = {}) {
  if (!hasCapability("turns", "canStart")) {
    throw new Error("Active Codex runtime does not expose turn/start capability.");
  }
  if (isDirectLiveTextSurface()) await refreshDirectSurfaceProjection({ render: false });
  const params = {
    threadId: state.threadId,
    input: [{ type: "text", text, text_elements: [] }],
    model: activeModelId() || null,
    effort: requestedReasoningEffort(),
  };
  if (connection?.transport === DIRECT_LIVE_TEXT_TRANSPORT || String(connection?.transport || "").startsWith("direct-")) {
    if (connection?.transport === DIRECT_LIVE_TEXT_TRANSPORT) {
      params.clientTurnRequestId = options.clientTurnRequestId || createClientTurnRequestId();
      params.promptText = text;
      const directProjection = directSurfaceProjection();
      const activeRow = activeDirectThreadRow();
      const selectedWorkThreadId = activeRow?.workThreadId ||
        directProjection?.operatorBroker?.selectedWorkThreadId ||
        directProjection?.workThreads?.resolutionReport?.selectedWorkThreadId ||
        "";
      if (selectedWorkThreadId) {
        params.workThreadId = selectedWorkThreadId;
        params.requireControlledRouting = true;
      }
      if (directProjection?.contextPreview?.previewDigest) {
        params.contextPreviewDigest = directProjection.contextPreview.previewDigest;
      }
      if (directProjection?.operatorBroker?.projectionDigest || directProjection?.operatorBroker?.brokerResolutionDigest) {
        params.operatorBrokerResolutionDigest = directProjection.operatorBroker.projectionDigest || directProjection.operatorBroker.brokerResolutionDigest;
      }
      if (directProjection?.workThreads?.resolutionReport?.reportDigest) {
        params.workTargetResolutionReportDigest = directProjection.workThreads.resolutionReport.reportDigest;
      }
    }
    params.attachmentDrafts = Array.isArray(options.attachments) ? options.attachments : [];
    params.attachmentDraftSetDigest = options.attachmentDraftSetDigest || "";
  }
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
      activity.durationMs = null;
    }
    rememberPromptTurn(turnId, text, options.retryCount || 0);
    refreshDirectSurfaceProjection({ render: false }).catch(() => {});
    renderRuntimeConstitution();
  }
  return result;
}

async function sendPrompt(text, options = {}) {
  if (!state.threadId) await startNewThread();
  if (!state.liveAttached && state.threadId) {
    const preserveStoredTranscript = Boolean(renderedStoredSnapshotForThread(state.threadId)?.presentationModel);
    const liveResult = await attachLiveThread(state.threadId, state.sessionFilePath, {
      excludeTurns: preserveStoredTranscript,
      skipReadFallback: preserveStoredTranscript,
    });
    applyLiveThreadResult(liveResult);
  }
  state.turnPending = true;
  renderRuntimeConstitution();
  try {
    await startCodexTurn(text, options);
    if (options.clearComposer !== false) clearComposerDraft();
  } catch (error) {
    clearPrimaryTurnActivityState();
    renderRuntimeConstitution();
    throw error;
  }
}

async function steerCurrentTurn(text) {
  if (!hasCapabilityForMutation("turns", "canSteer")) {
    throw new Error("Active Codex runtime does not expose turn/steer capability.");
  }
  const turnId = currentActiveTurnId();
  if (!state.threadId || !turnId) {
    throw new Error("No active Codex turn is available to steer.");
  }
  const result = await rpc("turn/steer", {
    threadId: state.threadId,
    expectedTurnId: turnId,
    input: [{ type: "text", text, text_elements: [] }],
  });
  clearComposerDraft();
  renderRuntimeConstitution();
  return result;
}

function queueComposerMessage(text, options = {}) {
  const threadId = String(state.threadId || "").trim();
  if (!threadId) throw new Error("No active Codex thread is available for queueing.");
  const item = {
    id: `queued_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    threadId,
    projectId: String(project?.id || ""),
    text,
    attachments: Array.isArray(options.attachments) ? options.attachments : [],
    attachmentDraftSetDigest: options.attachmentDraftSetDigest || "",
    createdAt: new Date().toISOString(),
  };
  state.queuedComposerMessages.push(item);
  clearComposerDraft();
  renderRuntimeConstitution();
  return item;
}

function scheduleQueuedPromptDrain(reason = "turn-completed") {
  if (state.queuedPromptDrainScheduled) return;
  state.queuedPromptDrainScheduled = true;
  window.setTimeout(() => {
    state.queuedPromptDrainScheduled = false;
    drainQueuedComposerMessages(reason).catch((error) => {
      addSystemMessage(`Queued message failed: ${error.message}`);
      renderRuntimeConstitution();
    });
  }, 80);
}

async function drainQueuedComposerMessages(reason = "turn-completed") {
  if (state.queuedPromptDrainInProgress || turnIsActive() || !state.queuedComposerMessages.length) return;
  const threadId = String(state.threadId || "").trim();
  const projectId = String(project?.id || "");
  if (!threadId) return;
  const nextIndex = state.queuedComposerMessages.findIndex((item) => (
    String(item?.threadId || "") === threadId &&
    (!projectId || !item?.projectId || String(item.projectId) === projectId)
  ));
  if (nextIndex < 0) return;
  const [next] = state.queuedComposerMessages.splice(nextIndex, 1);
  if (!next?.text) return;
  state.queuedPromptDrainInProgress = true;
  renderRuntimeConstitution();
  try {
    await sendPrompt(next.text, {
      clearComposer: false,
      queuedReason: reason,
      attachments: Array.isArray(next.attachments) ? next.attachments : [],
      attachmentDraftSetDigest: next.attachmentDraftSetDigest || "",
    });
  } catch (error) {
    state.queuedComposerMessages.splice(nextIndex, 0, next);
    throw error;
  } finally {
    state.queuedPromptDrainInProgress = false;
    renderRuntimeConstitution();
  }
}

function reportComposerDraftBlock(draft) {
  if (!draft?.message) return false;
  addSystemMessage(draft.message);
  renderComposerRuntimeBand();
  return true;
}

async function submitIdleComposerDraft() {
  const draft = composerDraftProjection();
  if (!draft.ok) {
    reportComposerDraftBlock(draft);
    return;
  }
  await sendPrompt(draft.text, {
    attachments: draft.attachments,
    attachmentDraftSetDigest: draft.attachmentDraftSetDigest,
  });
}

async function submitActiveComposerDraft(disposition) {
  const draft = composerDraftProjection();
  if (!draft.ok) {
    reportComposerDraftBlock(draft);
    return;
  }
  if (disposition === "steer") {
    await steerCurrentTurn(draft.text);
    return;
  }
  if (disposition === "queue") {
    queueComposerMessage(draft.text, {
      attachments: draft.attachments,
      attachmentDraftSetDigest: draft.attachmentDraftSetDigest,
    });
    return;
  }
  throw new Error(`Unsupported active-turn composer disposition: ${disposition}`);
}

function setComposerTextForReview(text) {
  if (!els.composerInput) return;
  const existing = String(els.composerInput.value || "").trim();
  els.composerInput.value = existing ? `${existing}\n\n${text}` : text;
  els.composerInput.focus();
  renderComposerRuntimeBand();
}

async function handleExternalComposerMessage(event) {
  const text = String(event?.text || "").trim();
  if (!text) return;
  if (event?.projectId && project?.id && String(event.projectId) !== String(project.id)) return;
  const targetThreadId = String(event?.threadId || "").trim();
  if (targetThreadId && state.threadId !== targetThreadId) {
    await openThreadHybrid(
      targetThreadId,
      event.sourceHome || "",
      event.sessionFilePath || "",
      event.title || "",
    );
  }
  const disposition = String(event?.activeTurnDisposition || "queue");
  try {
    if (turnIsActive()) {
      if (disposition === "steer") {
        await steerCurrentTurn(text);
        addSystemMessage("Sent ChatGPT download note as active-turn steering.");
        return;
      }
      if (disposition === "ask") {
        setComposerTextForReview(text);
        showComposerDispositionMenu();
        addSystemMessage("Prepared ChatGPT download note in the composer.");
        return;
      }
      queueComposerMessage(text);
      addSystemMessage("Queued ChatGPT download note for the linked Codex thread.");
      return;
    }
    await sendPrompt(text);
    addSystemMessage("Sent ChatGPT download note to the linked Codex thread.");
  } catch (error) {
    setComposerTextForReview(text);
    addSystemMessage(`ChatGPT download note was prepared in the composer after send failed: ${error.message}`);
  }
}

function showComposerDispositionMenu() {
  if (!turnIsActive()) return false;
  state.composerMenu = "disposition";
  renderComposerRuntimeBand();
  updateComposerGeometry();
  window.requestAnimationFrame(() => {
    if (!els.steerMenuButton?.disabled) els.steerMenuButton.focus();
    else if (!els.queueMenuButton?.disabled) els.queueMenuButton.focus();
  });
  return true;
}

async function stopCurrentTurn() {
  const turnId = currentActiveTurnId();
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
      if (!Number.isFinite(Number(activity.durationMs)) && activity.startedAt && activity.completedAt >= activity.startedAt) {
        activity.durationMs = Math.round((activity.completedAt - activity.startedAt) * 1000);
      }
    }
    clearPrimaryTurnActivityState();
  } finally {
    state.turnStopping = false;
    renderRuntimeConstitution();
    scheduleQueuedPromptDrain("turn-stopped");
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
    if (!notificationMatchesPrimaryThread(params)) return;
    const turnId = String(params?.turnId || state.turnId || "");
    const activity = ensureTurnActivity(turnId);
    if (activity) {
      activity.hasCodexOutput = true;
      activity.errorShown = true;
      if (!params?.willRetry) {
        activity.status = "error";
        activity.completedAt = activity.completedAt || Date.now() / 1000;
        if (!Number.isFinite(Number(activity.durationMs)) && activity.startedAt && activity.completedAt >= activity.startedAt) {
          activity.durationMs = Math.round((activity.completedAt - activity.startedAt) * 1000);
        }
      }
    }
    if (!params?.willRetry) {
      clearPrimaryTurnActivityState();
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
    appendMessageText(params?.itemId, "assistant", params?.delta || "", currentAuthorContext().assistantTitle);
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
      renderItem(params?.item, currentAuthorContext());
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
    if (completedTurnId && shouldApplyTurnCompletionNotification(params, completedTurnId)) {
      state.turnId = completedTurnId;
      if (!state.activeTurnId || String(state.activeTurnId) === String(completedTurnId)) {
        clearPrimaryTurnActivityState();
      }
      const activity = ensureTurnActivity(completedTurnId);
      if (activity) {
        activity.status = String(params?.turn?.status || "completed");
        activity.completedAt = params?.turn?.completedAt || Date.now() / 1000;
        const durationMs = Number(params?.turn?.durationMs ?? params?.turn?.duration_ms ?? params?.durationMs ?? params?.duration_ms);
        if (Number.isFinite(durationMs) && durationMs >= 0) activity.durationMs = durationMs;
        else if (activity.startedAt && activity.completedAt >= activity.startedAt) {
          activity.durationMs = Math.round((activity.completedAt - activity.startedAt) * 1000);
        }
      }
      renderRuntimeConstitution();
      collapseThoughtProcess(completedTurnId);
      finalizeTurnMessages(completedTurnId);
      renderTurnCompletionNotice(completedTurnId, params?.turn || {});
      refreshDirectSurfaceProjection({ render: false }).catch(() => {});
      refreshDirectThreadList({ showErrors: false }).catch(() => {});
      scheduleQueuedPromptDrain("turn-completed");
    }
    return;
  }
  if (method === "turn/started") {
    const startedTurnId = turnIdFromNotification(params);
    if (startedTurnId && notificationMatchesPrimaryThread(params)) {
      state.turnId = startedTurnId;
      state.activeTurnId = startedTurnId;
      state.primaryThreadActive = true;
      state.primaryThreadActivitySource = "turn-started-notification";
      state.turnPending = false;
      const activity = ensureTurnActivity(startedTurnId);
      if (activity) {
        activity.status = String(params?.turn?.status || "inProgress");
        activity.startedAt = params?.turn?.startedAt || Date.now() / 1000;
        activity.durationMs = null;
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
  if (event.type === "external-composer-message") {
    handleExternalComposerMessage(event).catch((error) => {
      addSystemMessage(`External composer message failed: ${error.message}`);
    });
    return;
  }
  if (event.type === "connection-status") {
    if (event.connection) {
      connection = { ...connection, ...event.connection };
      if (event.connection.directSurfaceProjection?.schema === "direct_codex_surface_projection@1") {
        state.directSurfaceProjection = event.connection.directSurfaceProjection;
        applyDirectMetadataModels(event.connection.directSurfaceProjection);
      }
    }
    if (event.status === "connected") {
      state.connected = true;
      state.connectionStatus = "connected";
      renderRuntimeConstitution();
      renderDirectThreadList();
      if (state.threadId && !state.liveAttached) {
        const expectedThreadId = state.threadId;
        const expectedSourceHome = state.sourceHome;
        const expectedSessionFilePath = state.sessionFilePath;
        const preserveStoredTranscript = Boolean(renderedStoredSnapshotForThread(expectedThreadId)?.presentationModel);
        attachLiveThread(expectedThreadId, expectedSessionFilePath, {
          excludeTurns: preserveStoredTranscript,
          skipReadFallback: preserveStoredTranscript,
        })
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
      renderDirectThreadList();
      return;
    }
    if (event.status === "error") {
      state.connected = false;
      state.liveAttached = false;
      state.connectionStatus = "error";
      setComposerEnabled(false, "Codex connection error.");
      renderRuntimeConstitution();
      renderDirectThreadList();
      if (event.error) addSystemMessage(`Codex connection failed: ${event.error}`);
      return;
    }
    if (event.status === "disconnected") {
      state.connected = false;
      state.liveAttached = false;
      state.connectionStatus = "disconnected";
      setComposerEnabled(false, "Codex disconnected.");
      renderRuntimeConstitution();
      renderDirectThreadList();
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
  if (event.type === "usage-ledger-status") {
    state.usageLedgerStatus = {
      ...state.usageLedgerStatus,
      ...(event.status || {}),
    };
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
  if (event.type === "attachment-drafts") {
    addComposerAttachments(event);
    return;
  }
  if (event.type === "attachment-diagnostic") {
    state.composerAttachmentError = event.message || "Attachment action failed.";
    renderComposerAttachments();
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
  await loadRuntimePreferences({ applyThread: false });
  updateSurfaceHeader(payload.initialThreadTitle || project.name, workspaceText());

  if (!connectionAvailable()) {
    const startupPending = Boolean(payload.runtimeStartupPending);
    state.connectionStatus = startupPending ? "starting" : "unavailable";
    renderRuntimeConstitution();
    addSystemMessage(
      payload.error ||
      payload.runtimeStartupMessage ||
      "Codex fallback surface loaded. The managed app-server is not connected.",
    );
    setComposerEnabled(
      false,
      startupPending
        ? "Read-only transcript mode while Codex app-server starts."
        : "Read-only transcript mode (Codex app-server unavailable).",
    );
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

  const isDirectFixture = connection?.transport === DIRECT_FIXTURE_TRANSPORT;
  const isDirectLiveText = connection?.transport === DIRECT_LIVE_TEXT_TRANSPORT;
  setComposerEnabled(false, isDirectLiveText ? "Connecting direct live text controller…" : isDirectFixture ? "Connecting direct fixture controller…" : "Connecting Codex app-server…");
  setBadge(els.connectionBadge, "connecting", "warning");
  state.connectionStatus = "connecting";
  renderRuntimeConstitution();
  renderDirectThreadList();
  const connectedSession = await bridge.connect(connection);
  if (connectedSession?.connection) connection = { ...connection, ...connectedSession.connection };
  if (connection?.directSurfaceProjection?.schema === "direct_codex_surface_projection@1") {
    state.directSurfaceProjection = connection.directSurfaceProjection;
    applyDirectMetadataModels(connection.directSurfaceProjection);
  }
  state.connected = true;
  state.connectionStatus = "connected";
  await refreshDirectSurfaceProjection({ render: false });
  renderRuntimeConstitution();
  renderDirectThreadList();
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
    showComposerDispositionMenu();
    return;
  }
  submitIdleComposerDraft().catch((error) => addSystemMessage(`Turn failed: ${error.message}`));
});

els.composerStopButton?.addEventListener("click", () => {
  dismissComposerOverlay("composer-stop");
  stopCurrentTurn().catch((error) => addSystemMessage(`Stop failed: ${error.message}`));
});

els.steerButton?.addEventListener("click", () => {
  dismissComposerOverlay("steer-click");
  submitActiveComposerDraft("steer").catch((error) => addSystemMessage(`Steer failed: ${error.message}`));
});

els.queueButton?.addEventListener("click", () => {
  dismissComposerOverlay("queue-click");
  submitActiveComposerDraft("queue").catch((error) => addSystemMessage(`Queue failed: ${error.message}`));
});

els.steerMenuButton?.addEventListener("click", () => {
  dismissComposerOverlay("steer-menu-click");
  submitActiveComposerDraft("steer").catch((error) => addSystemMessage(`Steer failed: ${error.message}`));
});

els.queueMenuButton?.addEventListener("click", () => {
  dismissComposerOverlay("queue-menu-click");
  submitActiveComposerDraft("queue").catch((error) => addSystemMessage(`Queue failed: ${error.message}`));
});

els.composerInput?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
  if (!turnIsActive()) return;
  event.preventDefault();
  showComposerDispositionMenu();
});

els.composerInput?.addEventListener("input", () => {
  renderComposerRuntimeBand();
});

els.composerAccessButton?.addEventListener("click", () => toggleComposerMenu("access"));
els.composerModelButton?.addEventListener("click", () => toggleComposerMenu("model"));
els.directThreadRefreshButton?.addEventListener("click", () => {
  refreshDirectThreadList({ showErrors: true }).catch((error) => addSystemMessage(`Direct thread refresh failed: ${error.message}`));
});
els.directThreadNewButton?.addEventListener("click", () => {
  createDirectThreadFromStrip().catch((error) => addSystemMessage(`New direct thread failed: ${error.message}`));
});
els.chooseAttachmentButton?.addEventListener("click", async () => {
  if (!bridge?.chooseAttachmentFiles || !project?.id) {
    addSystemMessage("Attachment picker is unavailable.");
    return;
  }
  try {
    addComposerAttachments(await bridge.chooseAttachmentFiles(project.id));
  } catch (error) {
    state.composerAttachmentError = `Attachment picker failed: ${error.message}`;
    renderComposerAttachments();
  }
});
els.pasteImageButton?.addEventListener("click", async () => {
  if (!bridge?.pasteImageAttachment || !project?.id) {
    addSystemMessage("Clipboard image paste is unavailable.");
    return;
  }
  try {
    addComposerAttachments(await bridge.pasteImageAttachment(project.id));
  } catch (error) {
    state.composerAttachmentError = `Paste image failed: ${error.message}`;
    renderComposerAttachments();
  }
});

async function droppedFilePaths(event) {
  const files = Array.from(event.dataTransfer?.files || []);
  if (!files.length) return [];
  if (typeof bridge?.getDroppedFilePaths === "function") {
    return bridge.getDroppedFilePaths(files);
  }
  return files
    .map((file) => bridge?.getPathForFile?.(file) || file?.path || "")
    .filter(Boolean);
}

for (const eventName of ["dragenter", "dragover"]) {
  els.composerForm?.addEventListener(eventName, (event) => {
    event.preventDefault();
    state.composerDragDepth += eventName === "dragenter" ? 1 : 0;
    els.composerForm.classList.add("drag-over");
  });
}

els.composerForm?.addEventListener("dragleave", () => {
  state.composerDragDepth = Math.max(0, state.composerDragDepth - 1);
  if (!state.composerDragDepth) els.composerForm.classList.remove("drag-over");
});

els.composerForm?.addEventListener("drop", async (event) => {
  event.preventDefault();
  state.composerDragDepth = 0;
  els.composerForm.classList.remove("drag-over");
  const paths = await droppedFilePaths(event);
  if (!paths.length) {
    state.composerAttachmentError = "Drop did not contain file paths.";
    renderComposerAttachments();
    return;
  }
  try {
    addComposerAttachments(await bridge.stageDroppedAttachments(project.id, paths));
  } catch (error) {
    state.composerAttachmentError = `Drop failed: ${error.message}`;
    renderComposerAttachments();
  }
});

els.composerInput?.addEventListener("paste", (event) => {
  const text = event.clipboardData?.getData("text/plain") || "";
  if (text) return;
  const hasImage = Array.from(event.clipboardData?.items || []).some((item) => String(item?.type || "").startsWith("image/"));
  if (!hasImage || !bridge?.pasteImageAttachment || !project?.id) return;
  event.preventDefault();
  bridge.pasteImageAttachment(project.id)
    .then(addComposerAttachments)
    .catch((error) => {
      state.composerAttachmentError = `Paste image failed: ${error.message}`;
      renderComposerAttachments();
    });
});

function selectedTextInfo(event) {
  const target = event.target;
  if (target === els.composerInput && typeof target.selectionStart === "number") {
    const selected = String(target.value || "").slice(target.selectionStart, target.selectionEnd);
    return { preview: selected.slice(0, 1000), length: selected.length };
  }
  const selection = window.getSelection?.();
  const selected = String(selection || "");
  return { preview: selected.slice(0, 1000), length: selected.length };
}

function selectedFileRefs() {
  const selection = window.getSelection?.();
  if (!selection || selection.isCollapsed || !String(selection).trim()) return [];
  const refs = [];
  const seen = new Set();
  const nodes = document.querySelectorAll("[data-context-target='file_ref'][data-context-file]");
  for (const node of nodes) {
    let intersects = false;
    for (let index = 0; index < selection.rangeCount; index += 1) {
      const range = selection.getRangeAt(index);
      if (range?.intersectsNode?.(node)) {
        intersects = true;
        break;
      }
    }
    if (!intersects) continue;
    const relPath = node.dataset.contextFile || "";
    if (!relPath || seen.has(relPath)) continue;
    seen.add(relPath);
    refs.push({
      relPath,
      fallbackRelPath: node.dataset.contextFallbackFile || "",
      displayPath: relPath || node.textContent || "",
    });
    if (refs.length >= 50) break;
  }
  return refs;
}

function contextMenuTarget(event) {
  const target = event.target?.closest?.("[data-context-target]");
  if (target?.dataset?.contextTarget === "thread_title") {
    return {
      targetKind: "thread_title",
      targetThreadId: state.threadId || "",
      targetLabel: target.textContent || "Codex thread title",
    };
  }
  if (target?.dataset?.contextTarget === "file_ref") {
    const relPath = target.dataset.contextFile || "";
    return {
      targetKind: "file_ref",
      targetFileRef: {
        pathEvidenceKey: "",
        relPath,
        fallbackRelPath: target.dataset.contextFallbackFile || "",
        displayPath: relPath || target.textContent || "",
      },
      targetLabel: target.textContent || "",
    };
  }
  if (target?.dataset?.contextTarget === "url") {
    return {
      targetKind: "url",
      targetHrefDisplay: target.dataset.contextHref || target.textContent || "",
      targetHrefEvidenceKey: "",
      targetLabel: target.textContent || "",
    };
  }
  if (target?.dataset?.contextTarget === "attachment" || event.target?.closest?.("[data-attachment-draft-id]")) {
    const attachment = event.target.closest("[data-attachment-draft-id]");
    return {
      targetKind: "attachment",
      attachmentId: attachment?.dataset?.attachmentDraftId || "",
      targetLabel: attachment?.textContent || "attachment",
    };
  }
  if (event.target === els.composerInput || event.target?.closest?.("#composerForm")) {
    return { targetKind: "composer", targetLabel: "Composer" };
  }
  return { targetKind: "unknown", targetLabel: "" };
}

document.addEventListener("contextmenu", (event) => {
  if (!bridge?.openContextMenu || !project?.id) return;
  const withinSurface = event.target?.closest?.(".codex-shell");
  if (!withinSurface) return;
  event.preventDefault();
  const selected = selectedTextInfo(event);
  const target = contextMenuTarget(event);
  const selectedFiles = selectedFileRefs();
  bridge.openContextMenu({
    schemaVersion: 1,
    requestId: `ctx_${Date.now()}`,
    surface: "codex_surface",
    projectId: project.id,
    threadId: state.threadId || "",
    selectedTextPreview: selected.preview,
    selectedTextLength: selected.length,
    selectedFileRefs: selectedFiles,
    pointer: { x: event.clientX, y: event.clientY },
    expiresAt: new Date(Date.now() + 15_000).toISOString(),
    uiProjectionGeneration: state.composerAttachmentGeneration,
    targetDigest: `${target.targetKind}:${target.targetLabel || ""}:${state.composerAttachmentGeneration}`,
    evidenceRefs: [],
    ...target,
  }).catch((error) => addSystemMessage(`Context menu failed: ${error.message}`));
});

for (const eventType of ["pointerdown", "mousedown", "touchstart", "click"]) {
  document.addEventListener(eventType, (event) => {
    maybeDismissComposerOverlay(event, eventType);
  }, true);
}

document.addEventListener("focusin", (event) => {
  maybeDismissComposerOverlay(event, "focusin");
}, true);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    dismissComposerOverlay("escape");
    const target = event.target;
    const editableTarget = target?.closest?.("input, textarea, [contenteditable='true']");
    if (state.analyticsPanelOpen && !editableTarget) {
      state.analyticsPanelOpen = false;
      localStorageSet("codex.threadAnalyticsPanel.open", "false");
      renderThreadAnalyticsPanel();
    }
  }
});

window.addEventListener("blur", () => dismissComposerOverlay("window-blur"));
window.addEventListener("resize", () => updateComposerGeometry());

document.addEventListener("click", (event) => {
  const target = event.target?.closest?.("[data-runtime-tab]");
  if (!target) return;
  const tab = target.getAttribute("data-runtime-tab") || "runtime";
  openRuntimeDrawer(tab);
});

els.analyticsPanelButton?.addEventListener("click", () => {
  dismissComposerOverlay("thread-analytics-open");
  state.analyticsPanelOpen = !state.analyticsPanelOpen;
  localStorageSet("codex.threadAnalyticsPanel.open", state.analyticsPanelOpen ? "true" : "false");
  renderThreadAnalyticsPanel();
});

els.threadAnalyticsPanelClose?.addEventListener("click", () => {
  state.analyticsPanelOpen = false;
  localStorageSet("codex.threadAnalyticsPanel.open", "false");
  renderThreadAnalyticsPanel();
});

els.threadAnalyticsDockButtons?.addEventListener("click", (event) => {
  const button = event.target?.closest?.("[data-analytics-dock]");
  const dock = button?.dataset?.analyticsDock || "";
  if (!["float", "left", "right", "bottom"].includes(dock)) return;
  state.analyticsPanelDock = dock;
  localStorageSet("codex.threadAnalyticsPanel.dock", dock);
  renderThreadAnalyticsPanel();
});

els.runtimeDrawerClose?.addEventListener("click", () => closeRuntimeDrawer());

installComposerGeometryObserver();

connect().catch((error) => {
  addSystemMessage(`Codex setup failed: ${error.message}`);
});
