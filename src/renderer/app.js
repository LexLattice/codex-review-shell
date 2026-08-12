const bridge = window.workspaceShell;

const MIN_WIDTHS = {
  left: 330,
  middle: 430,
  right: 350,
  splitter: 8,
};

const THREAD_ROLES = ["review", "brainstorming", "architecture", "research", "debugging", "planning", "custom"];
const ROLE_LABELS = {
  review: "Review",
  brainstorming: "Brainstorming",
  architecture: "Architecture",
  research: "Research",
  debugging: "Debugging",
  planning: "Planning",
  custom: "Custom",
};
const HANDOFF_KINDS = {
  "file-review": "File review",
  "text-review": "Text review",
  "architecture-question": "Architecture question",
  "research-question": "Research question",
};
const ACTIVE_HANDOFF_STATUSES = new Set(["staged", "copied", "opened-thread", "submitted-manually", "response-pending", "response-captured"]);
const CHATGPT_ALLOWED_HOSTS = new Set(["chatgpt.com", "www.chatgpt.com", "chat.openai.com", "www.chat.openai.com"]);
const DIRECT_FORK_PREVIEW_ITEM_CAP = 20;
const ZOOM_POLICY = bridge?.zoomConstants || {};
// Fallbacks are only used when preload is absent; normal runtime gets these
// values from the shared zoom policy exposed through the bridge.
const NORMAL_ZOOM_FALLBACK = 1;
const NO_ZOOM_DELTA = 0;
const SUB_AGENT_MESSAGE_PREVIEW_LINES = 10;
const SUB_AGENT_TOOL_LIKE_THOUGHT_TYPES = new Set([
  "commandExecution",
  "mcpToolCall",
  "dynamicToolCall",
  "webSearch",
]);

function zoomPolicyValue(name, fallback = NORMAL_ZOOM_FALLBACK) {
  const value = Number(ZOOM_POLICY?.[name]);
  return Number.isFinite(value) ? value : fallback;
}

const PLANE_ZOOM_DEFAULT = zoomPolicyValue("PLANE_ZOOM_DEFAULT");

const state = {
  config: null,
  configPath: "",
  repoRoot: "",
  platform: "",
  defaultWorkspace: null,
  defaultCodexRuntime: "auto",
  allowNonChatgptUrls: false,
  activeMiddleTab: "overview",
  projectStash: {
    projectId: "",
    targetSurface: "chatgpt",
    files: [],
    message: "review codex output",
    status: "idle",
    lastError: "",
    generation: 0,
  },
  middleWeb: {
    hasPage: false,
    displayUrl: "",
    title: "",
    origin: "",
    loading: false,
    canGoBack: false,
    canGoForward: false,
    lastError: "",
    lastSource: null,
    securityPosture: "unknown",
  },
  middleWebViewMode: "browser",
  middleWebHistory: [],
  middleFile: {
    status: "idle",
    sourceKind: "",
    projectId: "",
    relPath: "",
    displayName: "",
    mimeType: "",
    size: 0,
    truncated: false,
    binary: false,
    text: "",
    error: "",
    workspaceLabel: "",
    openedAt: "",
    source: null,
  },
  middleWebLayoutRevision: 0,
  planeZooms: {
    middle: PLANE_ZOOM_DEFAULT,
  },
  analyticsThreads: [],
  analyticsStatus: "idle",
  analyticsDashboard: null,
  analyticsDashboardStatus: "idle",
  selectedAnalyticsThreadKey: "",
  directImportWorkbench: {
    projectId: "",
    requestGeneration: 0,
    status: "idle",
    sources: [],
    imports: [],
    report: null,
    selectedImportSession: null,
    selectedHandleId: "",
    selectedImportId: "",
    selectedSessionId: "",
    lastError: "",
    includeHidden: false,
  },
  directThreadWorkbench: {
    projectId: "",
    requestGeneration: 0,
    status: "idle",
    snapshot: null,
    evidenceProjection: null,
    selectedThreadId: "",
    selectedPreviewId: "",
    selectedProjection: null,
    selectedPreview: null,
    forkStartPrompt: "",
    newThreadDraftTitle: "",
    newThreadDraftObjective: "",
    newThreadDraftWorkThreadId: "",
    lastError: "",
    filters: {
      includeHidden: false,
      includeArchived: false,
      includeSoftDeleted: false,
      textQuery: "",
    },
  },
  surfaceEvents: {
    codex: { type: "idle" },
    chatgpt: { type: "idle" },
  },
  activeRightTab: "chatgpt",
  rightPlanePinnedTab: "",
  subAgentGraph: null,
  selectedSubAgentThreadId: "",
  selectedSubAgentSelectedBy: "",
  selectedSubAgentScope: { mode: "full", turnKey: "" },
  expandedSubAgentMessages: new Set(),
  drawerMode: "edit",
  threadDrawerMode: "edit",
  currentWidths: { left: 0, middle: 0, right: 0 },
  layoutFrame: 0,
  lastLayoutSignature: "",
  selectedFileRelPath: "",
  selectedFilePreview: null,
  workspaceStatuses: {},
  watchedArtifacts: [],
  watchedArtifactsScan: null,
  codexRequests: new Map(),
  codexThreads: [],
  chatgptRecentThreads: [],
  chatgptRecentThreadsStatus: "idle",
  chatgptRecentThreadsLoadingMode: "cache",
  chatgptRecentThreadsSource: "",
  directAuthSettings: null,
  directAuthStatus: null,
  directAuthLoading: false,
  directAuthError: "",
  directRuntimeStatus: null,
  activeCodexRuntimePathByProject: {},
  directRuntimeLoading: false,
  directRuntimeError: "",
  directImplementationUiStatus: null,
  directImplementationOperationHistory: null,
  directImplementationPolicyView: null,
  directImplementationUiLoading: false,
  directImplementationUiError: "",
  directImplementationUiWarning: "",
  directMetaSessionStatus: null,
  directMetaSessionLoading: false,
  directMetaSessionError: "",
  directBridgeSettingsStatus: null,
  directBridgeSettingsLoading: false,
  directBridgeSettingsError: "",
  selectedCodexThreadId: "",
  openedCodexProjectId: "",
  openedCodexThreadId: "",
  openedCodexThreadTitle: "",
  openedCodexSourceHome: "",
  openedCodexSessionFilePath: "",
  selectedProjectChatThreadId: "",
  selectedRecentChatgptThreadId: "",
  selectedBindingId: "",
  activeChatgptThreadBrowserTab: "project",
  requestVersions: {
    project: 0,
    thread: 0,
    codexThreads: 0,
    recentThreads: 0,
    directImports: 0,
    directImportOperation: 0,
    directThreadWorkbench: 0,
    directThreadWorkbenchOperation: 0,
    directMetaSessionStatus: 0,
    directBridgeSettingsStatus: 0,
    directImplementationUiStatus: 0,
    analyticsThreads: 0,
    analyticsDetail: 0,
    workTree: 0,
    watchedArtifacts: 0,
    preview: 0,
  },
};

const els = {
  appShell: document.getElementById("appShell"),
  controlPlane: document.querySelector(".control-plane"),
  selectedProjectPill: document.getElementById("selectedProjectPill"),
  selectedProjectName: document.getElementById("selectedProjectName"),
  repoPath: document.getElementById("repoPath"),
  workspacePath: document.getElementById("workspacePath"),
  backendStatus: document.getElementById("backendStatus"),
  bindingStatus: document.getElementById("bindingStatus"),
  activeThreadStatus: document.getElementById("activeThreadStatus"),
  overviewTabButton: document.getElementById("overviewTabButton"),
  projectTabButton: document.getElementById("projectTabButton"),
  threadsTabButton: document.getElementById("threadsTabButton"),
  importsTabButton: document.getElementById("importsTabButton"),
  analyticsTabButton: document.getElementById("analyticsTabButton"),
  filesTabButton: document.getElementById("filesTabButton"),
  webTabButton: document.getElementById("webTabButton"),
  overviewTabPanel: document.getElementById("overviewTabPanel"),
  projectTabPanel: document.getElementById("projectTabPanel"),
  threadsTabPanel: document.getElementById("threadsTabPanel"),
  importsTabPanel: document.getElementById("importsTabPanel"),
  analyticsTabPanel: document.getElementById("analyticsTabPanel"),
  filesTabPanel: document.getElementById("filesTabPanel"),
  webTabPanel: document.getElementById("webTabPanel"),
  projectStashCount: document.getElementById("projectStashCount"),
  projectStashTitle: document.getElementById("projectStashTitle"),
  projectStashHint: document.getElementById("projectStashHint"),
  projectStashList: document.getElementById("projectStashList"),
  projectStashMessageInput: document.getElementById("projectStashMessageInput"),
  projectStashStatus: document.getElementById("projectStashStatus"),
  clearProjectStashButton: document.getElementById("clearProjectStashButton"),
  sendProjectStashButton: document.getElementById("sendProjectStashButton"),
  directBridgeSettingsBadge: document.getElementById("directBridgeSettingsBadge"),
  directBridgeSettingsRefreshButton: document.getElementById("directBridgeSettingsRefreshButton"),
  directBridgeSettingsRuntimeList: document.getElementById("directBridgeSettingsRuntimeList"),
  directBridgeSettingsRegistryList: document.getElementById("directBridgeSettingsRegistryList"),
  directBridgeSettingsWorkThreadList: document.getElementById("directBridgeSettingsWorkThreadList"),
  directBridgeSettingsOperatorBrokerList: document.getElementById("directBridgeSettingsOperatorBrokerList"),
  directBridgeSettingsGovernanceList: document.getElementById("directBridgeSettingsGovernanceList"),
  directBridgeSettingsModulesList: document.getElementById("directBridgeSettingsModulesList"),
  directBridgeSettingsAgentClassList: document.getElementById("directBridgeSettingsAgentClassList"),
  directBridgeSettingsContinuityList: document.getElementById("directBridgeSettingsContinuityList"),
  directBridgeSettingsRuntimeWitnessList: document.getElementById("directBridgeSettingsRuntimeWitnessList"),
  directBridgeSettingsAgentUsageList: document.getElementById("directBridgeSettingsAgentUsageList"),
  directBridgeSettingsAppServerFallbackList: document.getElementById("directBridgeSettingsAppServerFallbackList"),
  directBridgeSettingsManualSmokeList: document.getElementById("directBridgeSettingsManualSmokeList"),
  directBridgeSettingsEvidence: document.getElementById("directBridgeSettingsEvidence"),
  projectList: document.getElementById("projectList"),
  projectCount: document.getElementById("projectCount"),
  threadDeck: document.getElementById("threadDeck"),
  threadCount: document.getElementById("threadCount"),
  addThreadButton: document.getElementById("addThreadButton"),
  configPath: document.getElementById("configPath"),
  codexSlot: document.getElementById("codexSlot"),
  chatgptSlot: document.getElementById("chatgptSlot"),
  subAgentsSlot: document.getElementById("subAgentsSlot"),
  rightChatgptTabButton: document.getElementById("rightChatgptTabButton"),
  rightSubAgentsTabButton: document.getElementById("rightSubAgentsTabButton"),
  subAgentCountBadge: document.getElementById("subAgentCountBadge"),
  codexSurfaceTitle: document.getElementById("codexSurfaceTitle"),
  chatgptSurfaceTitle: document.getElementById("chatgptSurfaceTitle"),
  leftSplitter: document.getElementById("leftSplitter"),
  rightSplitter: document.getElementById("rightSplitter"),
  codexStatus: document.getElementById("codexStatus"),
  codexRuntimeQuickStatus: document.getElementById("codexRuntimeQuickStatus"),
  codexRuntimeQuickSelect: document.getElementById("codexRuntimeQuickSelect"),
  codexRuntimeQuickApplyButton: document.getElementById("codexRuntimeQuickApplyButton"),
  codexRuntimeSettingsButton: document.getElementById("codexRuntimeSettingsButton"),
  chatgptStatus: document.getElementById("chatgptStatus"),
  lastEvent: document.getElementById("lastEvent"),
  addProjectButton: document.getElementById("addProjectButton"),
  editProjectButton: document.getElementById("editProjectButton"),
  copyPromptButton: document.getElementById("copyPromptButton"),
  copyHeaderButton: document.getElementById("copyHeaderButton"),
  reloadCodexButton: document.getElementById("reloadCodexButton"),
  reloadChatButton: document.getElementById("reloadChatButton"),
  externalChatButton: document.getElementById("externalChatButton"),
  forceDarkButton: document.getElementById("forceDarkButton"),
  chatSettingsButton: document.getElementById("chatSettingsButton"),
  directAuthState: document.getElementById("directAuthState"),
  directAuthStorageModeSelect: document.getElementById("directAuthStorageModeSelect"),
  directAuthStorageBadge: document.getElementById("directAuthStorageBadge"),
  directAuthExpiryBadge: document.getElementById("directAuthExpiryBadge"),
  directAuthRefreshButton: document.getElementById("directAuthRefreshButton"),
  directAuthLoginButton: document.getElementById("directAuthLoginButton"),
  directAuthLogoutButton: document.getElementById("directAuthLogoutButton"),
  directRuntimePathSelect: document.getElementById("directRuntimePathSelect"),
  directRuntimePathApplyButton: document.getElementById("directRuntimePathApplyButton"),
  directTextOnlyEnableButton: document.getElementById("directTextOnlyEnableButton"),
  directExperimentalEnableButton: document.getElementById("directExperimentalEnableButton"),
  directExperimentalRollbackButton: document.getElementById("directExperimentalRollbackButton"),
  directAuthEvidence: document.getElementById("directAuthEvidence"),
  directRuntimeModeBadge: document.getElementById("directRuntimeModeBadge"),
  directRuntimeStatusBadge: document.getElementById("directRuntimeStatusBadge"),
  directModelSourceBadge: document.getElementById("directModelSourceBadge"),
  directContextPressureBadge: document.getElementById("directContextPressureBadge"),
  directContextRouteBadge: document.getElementById("directContextRouteBadge"),
  directContextMemoryBadge: document.getElementById("directContextMemoryBadge"),
  directContextBatonBadge: document.getElementById("directContextBatonBadge"),
  directContextOmissionBadge: document.getElementById("directContextOmissionBadge"),
  directContextProviderCompactBadge: document.getElementById("directContextProviderCompactBadge"),
  directContextEvidence: document.getElementById("directContextEvidence"),
  directImplementationStatusBadge: document.getElementById("directImplementationStatusBadge"),
  directImplementationRefreshButton: document.getElementById("directImplementationRefreshButton"),
  directImplementationLaneList: document.getElementById("directImplementationLaneList"),
  directImplementationApprovalList: document.getElementById("directImplementationApprovalList"),
  directImplementationActiveTurnList: document.getElementById("directImplementationActiveTurnList"),
  directImplementationToolResultList: document.getElementById("directImplementationToolResultList"),
  directImplementationHistoryList: document.getElementById("directImplementationHistoryList"),
  directImplementationPromotionList: document.getElementById("directImplementationPromotionList"),
  directImplementationEvidence: document.getElementById("directImplementationEvidence"),
  directMetaSessionHealthBadge: document.getElementById("directMetaSessionHealthBadge"),
  directMetaSessionRefreshButton: document.getElementById("directMetaSessionRefreshButton"),
  directMetaSessionSummary: document.getElementById("directMetaSessionSummary"),
  directMetaSessionRoutes: document.getElementById("directMetaSessionRoutes"),
  directMetaSessionEvidence: document.getElementById("directMetaSessionEvidence"),
  directDiagnosticsStatusBadge: document.getElementById("directDiagnosticsStatusBadge"),
  directDiagnosticsContextGrid: document.getElementById("directDiagnosticsContextGrid"),
  directDiagnosticsArtifactList: document.getElementById("directDiagnosticsArtifactList"),
  directDiagnosticsRecoveryList: document.getElementById("directDiagnosticsRecoveryList"),
  directDiagnosticsGovernanceList: document.getElementById("directDiagnosticsGovernanceList"),
  directDiagnosticsBrokerList: document.getElementById("directDiagnosticsBrokerList"),
  directDiagnosticsTransitionList: document.getElementById("directDiagnosticsTransitionList"),
  directDiagnosticsSubAgentList: document.getElementById("directDiagnosticsSubAgentList"),
  directDiagnosticsEvidence: document.getElementById("directDiagnosticsEvidence"),
  promptRoleLabel: document.getElementById("promptRoleLabel"),
  activePromptPreview: document.getElementById("activePromptPreview"),
  handoffTargetThreadSelect: document.getElementById("handoffTargetThreadSelect"),
  stageSelectedFileButton: document.getElementById("stageSelectedFileButton"),
  stagePreviewButton: document.getElementById("stagePreviewButton"),
  stageTextReviewButton: document.getElementById("stageTextReviewButton"),
  stageArchitectureQuestionButton: document.getElementById("stageArchitectureQuestionButton"),
  stageResearchQuestionButton: document.getElementById("stageResearchQuestionButton"),
  handoffQueue: document.getElementById("handoffQueue"),
  handoffCount: document.getElementById("handoffCount"),
  codexRequestList: document.getElementById("codexRequestList"),
  codexRequestCount: document.getElementById("codexRequestCount"),
  watchedArtifactList: document.getElementById("watchedArtifactList"),
  watchedCount: document.getElementById("watchedCount"),
  refreshWatchedButton: document.getElementById("refreshWatchedButton"),
  watchedRulesPreview: document.getElementById("watchedRulesPreview"),
  returnHeaderPreview: document.getElementById("returnHeaderPreview"),
  refreshCodexThreadsButton: document.getElementById("refreshCodexThreadsButton"),
  refreshDirectThreadWorkbenchButton: document.getElementById("refreshDirectThreadWorkbenchButton"),
  directThreadWorkbenchStatus: document.getElementById("directThreadWorkbenchStatus"),
  directThreadIncludeHiddenInput: document.getElementById("directThreadIncludeHiddenInput"),
  directThreadIncludeArchivedInput: document.getElementById("directThreadIncludeArchivedInput"),
  directThreadIncludeSoftDeletedInput: document.getElementById("directThreadIncludeSoftDeletedInput"),
  directThreadTextQueryInput: document.getElementById("directThreadTextQueryInput"),
  directThreadActiveCount: document.getElementById("directThreadActiveCount"),
  directThreadHiddenCount: document.getElementById("directThreadHiddenCount"),
  directThreadArchivedCount: document.getElementById("directThreadArchivedCount"),
  directThreadSoftDeletedCount: document.getElementById("directThreadSoftDeletedCount"),
  directThreadWorkbenchList: document.getElementById("directThreadWorkbenchList"),
  directThreadWorkbenchDetail: document.getElementById("directThreadWorkbenchDetail"),
  directThreadWorkbenchSide: document.getElementById("directThreadWorkbenchSide"),
  refreshCodexThreadListButton: document.getElementById("refreshCodexThreadListButton"),
  refreshRecentChatThreadsButton: document.getElementById("refreshRecentChatThreadsButton"),
  bindingLaneInput: document.getElementById("bindingLaneInput"),
  bindingLabelInput: document.getElementById("bindingLabelInput"),
  bindingDefaultLaneInput: document.getElementById("bindingDefaultLaneInput"),
  bindingOpenOnProjectInput: document.getElementById("bindingOpenOnProjectInput"),
  threadLinkHint: document.getElementById("threadLinkHint"),
  newBindingButton: document.getElementById("newBindingButton"),
  saveBindingButton: document.getElementById("saveBindingButton"),
  laneBindingList: document.getElementById("laneBindingList"),
  projectChatThreadsTabButton: document.getElementById("projectChatThreadsTabButton"),
  recentChatThreadsTabButton: document.getElementById("recentChatThreadsTabButton"),
  chatgptThreadBrowserHint: document.getElementById("chatgptThreadBrowserHint"),
  codexThreadCount: document.getElementById("codexThreadCount"),
  codexThreadList: document.getElementById("codexThreadList"),
  projectChatThreadCount: document.getElementById("projectChatThreadCount"),
  projectChatThreadList: document.getElementById("projectChatThreadList"),
  recentChatThreadCount: document.getElementById("recentChatThreadCount"),
  recentChatThreadList: document.getElementById("recentChatThreadList"),
  openThreadAttachButton: document.getElementById("openThreadAttachButton"),
  importRecentChatThreadButton: document.getElementById("importRecentChatThreadButton"),
  directImportCount: document.getElementById("directImportCount"),
  refreshDirectImportsButton: document.getElementById("refreshDirectImportsButton"),
  chooseDirectImportFileButton: document.getElementById("chooseDirectImportFileButton"),
  chooseDirectImportRootButton: document.getElementById("chooseDirectImportRootButton"),
  directImportWorkspaceConfirmInput: document.getElementById("directImportWorkspaceConfirmInput"),
  directImportHint: document.getElementById("directImportHint"),
  directImportSourceCount: document.getElementById("directImportSourceCount"),
  directImportSourceList: document.getElementById("directImportSourceList"),
  directImportVisibleCount: document.getElementById("directImportVisibleCount"),
  directImportList: document.getElementById("directImportList"),
  directImportDetail: document.getElementById("directImportDetail"),
  analyticsThreadCount: document.getElementById("analyticsThreadCount"),
  updateAnalyticsButton: document.getElementById("updateAnalyticsButton"),
  analyticsHint: document.getElementById("analyticsHint"),
  analyticsThreadList: document.getElementById("analyticsThreadList"),
  analyticsDashboard: document.getElementById("analyticsDashboard"),
  middleWebSlot: document.getElementById("middleWebSlot"),
  webEmptyState: document.getElementById("webEmptyState"),
  webBackButton: document.getElementById("webBackButton"),
  webForwardButton: document.getElementById("webForwardButton"),
  webReloadButton: document.getElementById("webReloadButton"),
  webCopyUrlButton: document.getElementById("webCopyUrlButton"),
  webOpenExternalButton: document.getElementById("webOpenExternalButton"),
  webBrowserTabButton: document.getElementById("webBrowserTabButton"),
  webHistoryTabButton: document.getElementById("webHistoryTabButton"),
  webHistoryCount: document.getElementById("webHistoryCount"),
  webPruneHistoryButton: document.getElementById("webPruneHistoryButton"),
  webHistoryPanel: document.getElementById("webHistoryPanel"),
  webHistoryList: document.getElementById("webHistoryList"),
  webTitle: document.getElementById("webTitle"),
  webOrigin: document.getElementById("webOrigin"),
  webSource: document.getElementById("webSource"),
  middleFileTitle: document.getElementById("middleFileTitle"),
  middleFileMeta: document.getElementById("middleFileMeta"),
  middleFileSource: document.getElementById("middleFileSource"),
  middleFileCopyRefButton: document.getElementById("middleFileCopyRefButton"),
  middleFileRevealButton: document.getElementById("middleFileRevealButton"),
  middleFileContent: document.getElementById("middleFileContent"),
  refreshWorkTreeButton: document.getElementById("refreshWorkTreeButton"),
  workTree: document.getElementById("workTree"),
  previewPath: document.getElementById("previewPath"),
  previewMeta: document.getElementById("previewMeta"),
  filePreview: document.getElementById("filePreview"),
  drawer: document.getElementById("projectDrawer"),
  drawerTitle: document.getElementById("drawerTitle"),
  form: document.getElementById("projectForm"),
  closeDrawerButton: document.getElementById("closeDrawerButton"),
  cancelProjectButton: document.getElementById("cancelProjectButton"),
  chooseRepoButton: document.getElementById("chooseRepoButton"),
  deleteProjectButton: document.getElementById("deleteProjectButton"),
  projectIdInput: document.getElementById("projectIdInput"),
  projectNameInput: document.getElementById("projectNameInput"),
  repoPathInput: document.getElementById("repoPathInput"),
  workspaceKindInput: document.getElementById("workspaceKindInput"),
  workspaceLabelInput: document.getElementById("workspaceLabelInput"),
  wslDistroInput: document.getElementById("wslDistroInput"),
  wslLinuxPathInput: document.getElementById("wslLinuxPathInput"),
  codexModeInput: document.getElementById("codexModeInput"),
  codexLabelInput: document.getElementById("codexLabelInput"),
  codexDefaultPathInput: document.getElementById("codexDefaultPathInput"),
  codexProviderKindInput: document.getElementById("codexProviderKindInput"),
  codexProviderFlavorInput: document.getElementById("codexProviderFlavorInput"),
  codexRuntimeInput: document.getElementById("codexRuntimeInput"),
  codexRuntimeModeInput: document.getElementById("codexRuntimeModeInput"),
  codexDirectTransportInput: document.getElementById("codexDirectTransportInput"),
  codexBinaryPathInput: document.getElementById("codexBinaryPathInput"),
  codexProfileIdInput: document.getElementById("codexProfileIdInput"),
  codexModelInput: document.getElementById("codexModelInput"),
  codexReasoningEffortInput: document.getElementById("codexReasoningEffortInput"),
  codexSpawnAgentModelOverridesRow: document.getElementById("codexSpawnAgentModelOverridesRow"),
  codexSpawnAgentModelOverridesInput: document.getElementById("codexSpawnAgentModelOverridesInput"),
  codexTargetInput: document.getElementById("codexTargetInput"),
  projectChatgptThreadSelect: document.getElementById("projectChatgptThreadSelect"),
  projectCodexThreadSelect: document.getElementById("projectCodexThreadSelect"),
  chatgptUrlInput: document.getElementById("chatgptUrlInput"),
  reduceChromeInput: document.getElementById("reduceChromeInput"),
  chatgptDownloadDirInput: document.getElementById("chatgptDownloadDirInput"),
  chatgptDownloadMacroDirInput: document.getElementById("chatgptDownloadMacroDirInput"),
  chatgptDownloadMacroEnabledInput: document.getElementById("chatgptDownloadMacroEnabledInput"),
  chatgptDownloadNotifyCodexInput: document.getElementById("chatgptDownloadNotifyCodexInput"),
  chatgptDownloadDispositionInput: document.getElementById("chatgptDownloadDispositionInput"),
  chatgptDownloadMessageInput: document.getElementById("chatgptDownloadMessageInput"),
  reviewPromptInput: document.getElementById("reviewPromptInput"),
  architecturePromptInput: document.getElementById("architecturePromptInput"),
  brainstormingPromptInput: document.getElementById("brainstormingPromptInput"),
  researchPromptInput: document.getElementById("researchPromptInput"),
  watchedPatternsInput: document.getElementById("watchedPatternsInput"),
  returnHeaderInput: document.getElementById("returnHeaderInput"),
  threadDrawer: document.getElementById("threadDrawer"),
  threadForm: document.getElementById("threadForm"),
  threadDrawerTitle: document.getElementById("threadDrawerTitle"),
  closeThreadDrawerButton: document.getElementById("closeThreadDrawerButton"),
  cancelThreadButton: document.getElementById("cancelThreadButton"),
  deleteThreadButton: document.getElementById("deleteThreadButton"),
  threadIdInput: document.getElementById("threadIdInput"),
  threadRoleInput: document.getElementById("threadRoleInput"),
  threadTitleInput: document.getElementById("threadTitleInput"),
  threadUrlInput: document.getElementById("threadUrlInput"),
  threadNotesInput: document.getElementById("threadNotesInput"),
  threadPrimaryInput: document.getElementById("threadPrimaryInput"),
  threadPinnedInput: document.getElementById("threadPinnedInput"),
  threadArchivedInput: document.getElementById("threadArchivedInput"),
};

function activeProject() {
  if (!state.config) return null;
  return state.config.projects.find((project) => project.id === state.config.selectedProjectId) ?? state.config.projects[0] ?? null;
}

function createId(prefix = "item") {
  const id = crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "").slice(0, 12) : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}_${id}`;
}

function nowIso() {
  return new Date().toISOString();
}

function nextRequestVersion(kind) {
  const current = Number(state.requestVersions[kind] || 0) + 1;
  state.requestVersions[kind] = current;
  return current;
}

function isRequestStale(kind, version) {
  return Number(state.requestVersions[kind] || 0) !== Number(version || 0);
}

function projectRequestSnapshot(projectId = activeProject()?.id || "") {
  return { projectId, projectVersion: Number(state.requestVersions.project || 0) };
}

function isProjectRequestStale(projectId, projectVersion) {
  const currentProjectId = activeProject()?.id || "";
  return currentProjectId !== projectId || Number(state.requestVersions.project || 0) !== Number(projectVersion || 0);
}

function shortPath(value) {
  const text = String(value ?? "");
  if (text.length <= 64) return text;
  return `${text.slice(0, 28)}…${text.slice(-32)}`;
}

function clamp(value, min, max) {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

function roleLabel(role) {
  return ROLE_LABELS[role] || ROLE_LABELS.custom;
}

function defaultPromptText(role) {
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
  return Object.fromEntries(
    THREAD_ROLES.map((role) => [
      role,
      { id: `template_${role}`, role, title: `${roleLabel(role)} prompt`, text: defaultPromptText(role), updatedAt: nowIso() },
    ]),
  );
}

function projectWorkspace(project) {
  const workspace = project?.workspace;
  if (workspace?.kind === "wsl") {
    return {
      kind: "wsl",
      distro: workspace.distro || "",
      linuxPath: workspace.linuxPath || "/home",
      label: workspace.label || "WSL workspace",
    };
  }
  return {
    kind: "local",
    localPath: workspace?.localPath || project?.repoPath || state.repoRoot || "",
    label: workspace?.label || "Local workspace",
  };
}

function workspaceSummary(project) {
  const workspace = projectWorkspace(project);
  if (workspace.kind === "wsl") return `WSL ${workspace.distro || "default"}:${workspace.linuxPath}`;
  return `Local ${workspace.localPath}`;
}

function workspaceRootValue(project) {
  const workspace = projectWorkspace(project);
  return workspace.kind === "wsl" ? workspace.linuxPath : workspace.localPath;
}

function workspaceRepoPath(workspace) {
  if (workspace?.kind === "wsl") return `wsl:${workspace.distro || "default"}:${workspace.linuxPath || "/home"}`;
  return workspace?.localPath || state.repoRoot || "";
}

function defaultWorkspaceDraft() {
  const workspace = state.defaultWorkspace;
  if (workspace?.kind === "wsl") {
    return {
      kind: "wsl",
      distro: workspace.distro || "",
      linuxPath: workspace.linuxPath || "/home",
      label: workspace.label || "WSL workspace",
    };
  }
  return {
    kind: "local",
    localPath: workspace?.localPath || state.repoRoot || "",
    label: workspace?.label || "Local workspace",
  };
}

function chatThreads(project) {
  return Array.isArray(project?.chatThreads) ? project.chatThreads : [];
}

function primaryReviewThread(project) {
  const threads = chatThreads(project);
  return (
    threads.find((thread) => thread.role === "review" && thread.isPrimary && !thread.archived) ||
    threads.find((thread) => thread.role === "review" && thread.isPrimary) ||
    threads.find((thread) => thread.role === "review" && !thread.archived) ||
    threads.find((thread) => !thread.archived) ||
    threads[0] ||
    null
  );
}

function activeReviewThreadCount(projectOrThreads) {
  const threads = Array.isArray(projectOrThreads) ? projectOrThreads : chatThreads(projectOrThreads);
  return threads.filter((thread) => thread.role === "review" && !thread.archived).length;
}

function activeThread(project = activeProject()) {
  const threads = chatThreads(project);
  return (
    threads.find((thread) => thread.id === project?.activeChatThreadId && !thread.archived) ||
    threads.find((thread) => thread.id === project?.lastActiveThreadId && !thread.archived) ||
    primaryReviewThread(project)
  );
}

function threadById(project, threadId) {
  return chatThreads(project).find((thread) => thread.id === threadId) || null;
}

function extractChatgptConversationId(value) {
  try {
    const url = new URL(String(value || ""), "https://chatgpt.com/");
    const match = url.pathname.match(/\/c\/([^/?#]+)/);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

function projectThreadByConversationId(project, externalId) {
  return chatThreads(project).find((thread) => extractChatgptConversationId(thread.url) === externalId) || null;
}

function laneBindings(project) {
  return Array.isArray(project?.laneBindings) ? project.laneBindings : [];
}

function laneBindingById(project, bindingId) {
  return laneBindings(project).find((binding) => binding.id === bindingId) || null;
}

function codexThreadForBinding(binding) {
  const ref = binding?.codexThreadRef || {};
  const threadId = String(ref.threadId || "").trim();
  if (!threadId) return null;
  const candidates = state.codexThreads.filter((thread) => thread.threadId === threadId);
  if (!candidates.length) return null;
  const sourceHome = String(ref.sourceHome || "").trim();
  if (sourceHome) {
    const match = candidates.find((thread) => String(thread.sourceHome || "") === sourceHome);
    if (match) return match;
  }
  const sessionFilePath = String(ref.sessionFilePath || "").trim();
  if (sessionFilePath) {
    const match = candidates.find((thread) => String(thread.sessionFilePath || "") === sessionFilePath);
    if (match) return match;
  }
  const originator = String(ref.originator || "").trim();
  if (originator) {
    const match = candidates.find((thread) => String(thread.originator || "") === originator);
    if (match) return match;
  }
  const title = String(ref.titleSnapshot || "").trim();
  if (title) {
    const match = candidates.find((thread) => String(thread.title || "") === title);
    if (match) return match;
  }
  return candidates[0];
}

function activeLaneBinding(project) {
  const bindings = laneBindings(project);
  if (!bindings.length) return null;
  return (
    laneBindingById(project, project?.lastActiveBindingId) ||
    bindings.find((binding) => binding.openOnProjectActivate) ||
    bindings.find((binding) => binding.isDefaultForLane) ||
    bindings[0] ||
    null
  );
}

function codexThreadById(threadId) {
  return state.codexThreads.find((thread) => thread.threadId === threadId) || null;
}

function activeCodexThreadForHeader(project) {
  const openedForProject = Boolean(state.openedCodexThreadId && state.openedCodexProjectId === project?.id);
  const openedThread = openedForProject ? codexThreadById(state.openedCodexThreadId) : null;
  if (openedThread) return openedThread;
  if (openedForProject) {
    return {
      threadId: state.openedCodexThreadId,
      title: state.openedCodexThreadTitle || state.openedCodexThreadId,
    };
  }
  const binding = activeLaneBinding(project);
  return codexThreadForBinding(binding);
}

function recentChatgptThreadById(externalId) {
  return state.chatgptRecentThreads.find((thread) => thread.externalId === externalId) || null;
}

function drawerSelectValue(payload) {
  return JSON.stringify(payload);
}

function parseDrawerSelectValue(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function codexDrawerThreadKey(thread) {
  return [
    String(thread?.threadId || ""),
    String(thread?.sourceHome || ""),
    String(thread?.sessionFilePath || ""),
  ].join("\u001f");
}

function codexThreadFromDrawerSelection(selection) {
  if (!selection || selection.kind !== "codex" || !selection.threadId) return null;
  const candidates = state.codexThreads.filter((thread) => thread.threadId === selection.threadId);
  const discovered =
    candidates.find((thread) => selection.sourceHome && thread.sourceHome === selection.sourceHome) ||
    candidates.find((thread) => selection.sessionFilePath && thread.sessionFilePath === selection.sessionFilePath) ||
    candidates[0] ||
    null;
  return {
    threadId: selection.threadId,
    originator: discovered?.originator || selection.originator || "",
    title: discovered?.title || selection.title || selection.threadId,
    cwd: discovered?.cwd || selection.cwd || "",
    sourceHome: discovered?.sourceHome || selection.sourceHome || "",
    sessionFilePath: discovered?.sessionFilePath || selection.sessionFilePath || "",
  };
}

function chatgptDrawerThreadFromSelection(selection, existingThreads, primaryUrl, now) {
  if (selection?.kind === "project") {
    const thread = existingThreads.find((item) => item.id === selection.threadId);
    if (thread) {
      return {
        ...thread,
        role: "review",
        isPrimary: true,
        archived: false,
        updatedAt: now,
      };
    }
  }
  if (selection?.kind === "sourceProject") {
    const sourceProject = state.config?.projects.find((project) => project.id === selection.projectId);
    const thread = threadById(sourceProject, selection.threadId);
    if (thread) {
      return {
        id: createId("thread"),
        role: "review",
        title: thread.title || "Primary review",
        url: normalizeHttpsUrl(thread.url),
        notes: thread.notes || `Linked from ${sourceProject?.name || "another project"}.`,
        isPrimary: true,
        pinned: true,
        archived: false,
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: "",
      };
    }
  }
  if (selection?.kind === "recent") {
    const recent = recentChatgptThreadById(selection.externalId);
    if (recent) {
      const existing = existingThreads.find((thread) => extractChatgptConversationId(thread.url) === recent.externalId);
      if (existing) {
        return {
          ...existing,
          role: "review",
          title: existing.title || recent.title || "Primary review",
          url: normalizeHttpsUrl(existing.url || recent.url),
          isPrimary: true,
          archived: false,
          updatedAt: now,
        };
      }
      return {
        id: createId("thread"),
        role: "review",
        title: recent.title || "Primary review",
        url: normalizeHttpsUrl(recent.url),
        notes: recent.projectName ? `Imported from ChatGPT project ${recent.projectName}.` : "Imported from recent ChatGPT threads.",
        isPrimary: true,
        pinned: true,
        archived: false,
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: "",
      };
    }
  }
  const existingByUrl = existingThreads.find((thread) => normalizeHttpsUrl(thread.url) === primaryUrl);
  if (existingByUrl) {
    return {
      ...existingByUrl,
      role: "review",
      url: primaryUrl,
      isPrimary: true,
      archived: false,
      updatedAt: now,
    };
  }
  const currentPrimary = existingThreads.find((thread) => thread.role === "review" && thread.isPrimary) || existingThreads.find((thread) => thread.role === "review");
  if (currentPrimary) {
    return {
      ...currentPrimary,
      role: "review",
      url: primaryUrl,
      isPrimary: true,
      archived: false,
      updatedAt: now,
    };
  }
  return {
    id: "thread_review_primary",
    role: "review",
    title: "Primary review",
    url: primaryUrl,
    notes: "Main project-bound ChatGPT review thread.",
    isPrimary: true,
    pinned: true,
    archived: false,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: "",
  };
}

function applyPrimaryReviewThread(threads, selectedThread) {
  const withoutSelected = threads.filter((thread) => thread.id !== selectedThread.id);
  return normalizeThreadSet([
    { ...selectedThread, role: "review", isPrimary: true, archived: false },
    ...withoutSelected.map((thread) => (thread.role === "review" ? { ...thread, isPrimary: false } : thread)),
  ]);
}

function preservedThreadId(threads, preferredId, fallbackId = "") {
  const preferred = String(preferredId || "");
  if (preferred && threads.some((thread) => thread.id === preferred && !thread.archived)) return preferred;
  return fallbackId;
}

function projectPrimaryReviewBinding(project) {
  const bindings = laneBindings(project);
  const active = laneBindingById(project, project?.lastActiveBindingId);
  if (active?.lane === "review") return active;
  return (
    bindings.find((binding) => binding.lane === "review" && binding.openOnProjectActivate) ||
    bindings.find((binding) => binding.lane === "review" && binding.isDefaultForLane) ||
    bindings.find((binding) => binding.lane === "review") ||
    null
  );
}

function upsertProjectPrimaryLaneBinding(existingProject, bindings, codexThread, chatThread, now) {
  if (!codexThread?.threadId || !chatThread?.id) {
    return {
      laneBindings: bindings,
      lastActiveBindingId: existingProject?.lastActiveBindingId || "",
    };
  }
  const current = projectPrimaryReviewBinding(existingProject);
  const bindingId = current?.id || createId("binding");
  const anotherOpenBinding = bindings.some((binding) => binding.id !== bindingId && binding.openOnProjectActivate);
  const openOnProjectActivate = current?.openOnProjectActivate ?? !anotherOpenBinding;
  const nextBinding = {
    id: bindingId,
    lane: "review",
    label: current?.label || "Primary review",
    codexThreadRef: {
      threadId: codexThread.threadId,
      originator: codexThread.originator || "",
      titleSnapshot: codexThread.title || "",
      cwdSnapshot: codexThread.cwd || "",
      sourceHome: codexThread.sourceHome || "",
      sessionFilePath: codexThread.sessionFilePath || "",
    },
    chatThreadId: chatThread.id,
    isDefaultForLane: true,
    openOnProjectActivate,
    lastActivatedAt: now,
    status: "resolved",
    createdAt: current?.createdAt || now,
    updatedAt: now,
  };
  const remaining = bindings
    .filter((binding) => binding.id !== bindingId)
    .map((binding) => ({
      ...binding,
      isDefaultForLane: binding.lane === "review" ? false : binding.isDefaultForLane,
      openOnProjectActivate: openOnProjectActivate ? false : binding.openOnProjectActivate,
    }));
  const nextBindings = [nextBinding, ...remaining];
  const existingLastActiveId = String(existingProject?.lastActiveBindingId || "");
  const keepExistingLastActive = !openOnProjectActivate && nextBindings.some((binding) => binding.id === existingLastActiveId);
  return {
    laneBindings: nextBindings,
    lastActiveBindingId: keepExistingLastActive ? existingLastActiveId : bindingId,
  };
}

function clearProjectPrimaryLaneBinding(existingProject, bindings) {
  const current = projectPrimaryReviewBinding(existingProject);
  if (!current) {
    return {
      laneBindings: bindings,
      lastActiveBindingId: existingProject?.lastActiveBindingId || "",
    };
  }
  const remaining = bindings.filter((binding) => binding.id !== current.id);
  const existingLastActiveId = String(existingProject?.lastActiveBindingId || "");
  const keepExistingLastActive = remaining.some((binding) => binding.id === existingLastActiveId);
  return {
    laneBindings: remaining,
    lastActiveBindingId: keepExistingLastActive ? existingLastActiveId : remaining[0]?.id || "",
  };
}

function populateProjectThreadSelectors(draft) {
  if (!els.projectChatgptThreadSelect || !els.projectCodexThreadSelect) return;
  const binding = projectPrimaryReviewBinding(draft);
  const primary = primaryReviewThread(draft);
  const activeSourceProject = activeProject();

  els.projectChatgptThreadSelect.innerHTML = "";
  els.projectChatgptThreadSelect.append(new Option("Use URL field", ""));
  const selectedChatThreadId = state.drawerMode === "new"
    ? state.selectedProjectChatThreadId || primary?.id || ""
    : primary?.id || "";
  for (const thread of sortedThreads(draft, false)) {
    const option = new Option(`${thread.title || "Untitled ChatGPT thread"} · project`, drawerSelectValue({ kind: "project", threadId: thread.id }));
    option.dataset.url = thread.url || "";
    els.projectChatgptThreadSelect.append(option);
  }
  if (state.drawerMode === "new" && activeSourceProject && activeSourceProject.id !== draft.id) {
    const selected = threadById(activeSourceProject, state.selectedProjectChatThreadId);
    const sourceThreads = selected ? [selected] : sortedThreads(activeSourceProject, false).slice(0, 8);
    for (const thread of sourceThreads) {
      const option = new Option(
        `${thread.title || "Untitled ChatGPT thread"} · ${activeSourceProject.name}`,
        drawerSelectValue({ kind: "sourceProject", projectId: activeSourceProject.id, threadId: thread.id }),
      );
      option.dataset.url = thread.url || "";
      els.projectChatgptThreadSelect.append(option);
    }
  }
  const projectConversationIds = new Set(chatThreads(draft).map((thread) => extractChatgptConversationId(thread.url)).filter(Boolean));
  const recentThreads = state.chatgptRecentThreads
    .slice()
    .sort((a, b) => recentThreadSortStamp(b).localeCompare(recentThreadSortStamp(a)))
    .slice(0, 120);
  for (const thread of recentThreads) {
    if (!thread.externalId || projectConversationIds.has(thread.externalId)) continue;
    const source = thread.projectName ? `ChatGPT project: ${thread.projectName}` : "ChatGPT recent";
    const option = new Option(`${thread.title || "Untitled ChatGPT thread"} · ${source}`, drawerSelectValue({ kind: "recent", externalId: thread.externalId }));
    option.dataset.url = thread.url || "";
    els.projectChatgptThreadSelect.append(option);
  }

  const selectedRecentId = state.selectedRecentChatgptThreadId;
  const selectedProjectValue = state.drawerMode !== "new" && selectedChatThreadId ? drawerSelectValue({ kind: "project", threadId: selectedChatThreadId }) : "";
  const selectedSourceProjectValue =
    state.drawerMode === "new" && activeSourceProject && state.selectedProjectChatThreadId
      ? drawerSelectValue({ kind: "sourceProject", projectId: activeSourceProject.id, threadId: state.selectedProjectChatThreadId })
      : "";
  const selectedRecentValue = selectedRecentId ? drawerSelectValue({ kind: "recent", externalId: selectedRecentId }) : "";
  if ([...els.projectChatgptThreadSelect.options].some((option) => option.value === selectedSourceProjectValue)) {
    els.projectChatgptThreadSelect.value = selectedSourceProjectValue;
  } else if (state.drawerMode === "new" && [...els.projectChatgptThreadSelect.options].some((option) => option.value === selectedRecentValue)) {
    els.projectChatgptThreadSelect.value = selectedRecentValue;
  } else if ([...els.projectChatgptThreadSelect.options].some((option) => option.value === selectedProjectValue)) {
    els.projectChatgptThreadSelect.value = selectedProjectValue;
  } else {
    els.projectChatgptThreadSelect.value = "";
  }

  els.projectCodexThreadSelect.innerHTML = "";
  els.projectCodexThreadSelect.append(new Option("No Codex thread binding", ""));
  const codexOptions = new Map();
  for (const thread of state.codexThreads) {
    codexOptions.set(codexDrawerThreadKey(thread), {
      threadId: thread.threadId,
      originator: thread.originator || "",
      title: thread.title || thread.threadId,
      cwd: thread.cwd || "",
      sourceHome: thread.sourceHome || "",
      sessionFilePath: thread.sessionFilePath || "",
    });
  }
  const bindingRef = binding?.codexThreadRef;
  if (bindingRef?.threadId) {
    const bindingOption = {
      threadId: bindingRef.threadId,
      originator: bindingRef.originator || "",
      title: bindingRef.titleSnapshot || bindingRef.threadId,
      cwd: bindingRef.cwdSnapshot || "",
      sourceHome: bindingRef.sourceHome || "",
      sessionFilePath: bindingRef.sessionFilePath || "",
    };
    codexOptions.set(codexDrawerThreadKey(bindingOption), bindingOption);
  }
  for (const thread of codexOptions.values()) {
    const source = thread.originator || "Codex";
    const location = thread.cwd ? ` · ${shortPath(thread.cwd)}` : "";
    els.projectCodexThreadSelect.append(new Option(`${thread.title || thread.threadId} · ${source}${location}`, drawerSelectValue({ kind: "codex", ...thread })));
  }
  const selectedCodex = state.drawerMode === "new" && state.selectedCodexThreadId
    ? state.codexThreads.find((thread) => thread.threadId === state.selectedCodexThreadId)
    : null;
  const selectedCodexValue = selectedCodex
    ? drawerSelectValue({
      kind: "codex",
      threadId: selectedCodex.threadId,
      originator: selectedCodex.originator || "",
      title: selectedCodex.title || selectedCodex.threadId,
      cwd: selectedCodex.cwd || "",
      sourceHome: selectedCodex.sourceHome || "",
      sessionFilePath: selectedCodex.sessionFilePath || "",
    })
    : bindingRef?.threadId
      ? drawerSelectValue({
        kind: "codex",
        threadId: bindingRef.threadId,
        originator: bindingRef.originator || "",
        title: bindingRef.titleSnapshot || bindingRef.threadId,
        cwd: bindingRef.cwdSnapshot || "",
        sourceHome: bindingRef.sourceHome || "",
        sessionFilePath: bindingRef.sessionFilePath || "",
      })
      : "";
  if ([...els.projectCodexThreadSelect.options].some((option) => option.value === selectedCodexValue)) {
    els.projectCodexThreadSelect.value = selectedCodexValue;
  } else {
    els.projectCodexThreadSelect.value = "";
  }
}

function syncProjectChatgptUrlFromSelection() {
  if (!els.projectChatgptThreadSelect || !els.chatgptUrlInput) return;
  const option = els.projectChatgptThreadSelect.selectedOptions?.[0];
  const url = option?.dataset?.url || "";
  if (url) els.chatgptUrlInput.value = normalizeHttpsUrl(url);
}

function recentThreadSortStamp(thread) {
  return String(thread?.updatedAt || thread?.discoveredAt || thread?.createdAt || "");
}

function recentThreadProjectRank(thread) {
  const value = thread?.projectRank;
  if (value === null || value === undefined || value === "") return Number.POSITIVE_INFINITY;
  const rank = Number(value);
  return Number.isFinite(rank) ? rank : Number.POSITIVE_INFINITY;
}

function groupedRecentChatgptThreads(threads) {
  const groups = new Map();
  for (const thread of threads) {
    const projectName = String(thread?.projectName || "").trim();
    const isProject = thread?.sourceKind === "project" || Boolean(projectName);
    const groupKey = projectName
      ? `project:${projectName.toLowerCase()}`
      : isProject
        ? "project:unknown"
        : "recent:general";
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        key: groupKey,
        label: projectName || (isProject ? "Project (unlabeled)" : "General recents"),
        isProject,
        latestStamp: "",
        entries: [],
      });
    }
    const group = groups.get(groupKey);
    group.entries.push(thread);
    const stamp = recentThreadSortStamp(thread);
    if (stamp > group.latestStamp) group.latestStamp = stamp;
  }
  const sortedGroups = Array.from(groups.values()).sort((a, b) => {
    if (a.isProject !== b.isProject) return a.isProject ? -1 : 1;
    const latestDelta = b.latestStamp.localeCompare(a.latestStamp);
    if (latestDelta !== 0) return latestDelta;
    return a.label.localeCompare(b.label);
  });
  for (const group of sortedGroups) {
    group.entries.sort((a, b) => {
      const updatedDelta = recentThreadSortStamp(b).localeCompare(recentThreadSortStamp(a));
      if (updatedDelta !== 0) return updatedDelta;
      const rankDelta = recentThreadProjectRank(a) - recentThreadProjectRank(b);
      if (rankDelta !== 0 && Number.isFinite(rankDelta)) return rankDelta;
      return String(a.title || "").localeCompare(String(b.title || ""));
    });
  }
  return sortedGroups;
}

function buildRecentChatgptThreadRow(project, thread) {
  const attached = projectThreadByConversationId(project, thread.externalId);
  const row = document.createElement("article");
  row.className = `thread-browser-item${thread.externalId === state.selectedRecentChatgptThreadId ? " active" : ""}`;
  row.innerHTML = `
    <div class="thread-topline">
      <span class="role-badge"></span>
      <strong class="truncate"></strong>
    </div>
    <span class="thread-meta truncate"></span>
    <span class="thread-notes truncate"></span>
  `;
  row.querySelector(".role-badge").textContent = attached
    ? "Imported into project"
    : thread.projectName
      ? `Project · ${thread.projectName}`
      : thread.sourceKind === "project"
        ? "Project folder"
        : "Recent ChatGPT";
  row.querySelector("strong").textContent = thread.title || "Untitled ChatGPT thread";
  row.querySelector(".thread-meta").textContent = shortPath(thread.url || "");
  const displayDate = String(thread.displayDate || "").trim();
  row.querySelector(".thread-notes").textContent =
    attached
      ? `Attached as ${attached.title}`
      : thread.projectName
        ? thread.updatedAt
          ? `Project ${thread.projectName} · Updated ${displayDate || formatTime(thread.updatedAt)}`
          : `Project ${thread.projectName}`
        : thread.sourceKind === "project"
          ? thread.updatedAt
            ? `Project folder · Updated ${displayDate || formatTime(thread.updatedAt)}`
            : "Project folder thread"
          : thread.updatedAt
            ? `Updated ${formatTime(thread.updatedAt)}`
            : "No timestamp";
  row.addEventListener("click", () => {
    state.selectedRecentChatgptThreadId = thread.externalId;
    renderThreadsWorkbench();
    openRecentChatgptThread(thread).catch((error) => {
      setLastEvent(`Recent ChatGPT thread open failed: ${error.message}`);
    });
  });
  return row;
}

function laneBindingStatus(project, binding) {
  if (!binding) return "unresolved";
  if (!threadById(project, binding.chatThreadId)) return "missing_chatgpt_thread";
  if (binding.codexThreadRef?.threadId && !codexThreadById(binding.codexThreadRef.threadId)) return "missing_codex_thread";
  return binding.status || "resolved";
}

function laneBindingStatusLabel(status) {
  const labels = {
    resolved: "resolved",
    missing_codex_thread: "missing Codex thread",
    missing_chatgpt_thread: "missing ChatGPT thread",
    chatgpt_discovery_unavailable: "ChatGPT discovery unavailable",
    stale_snapshot: "stale snapshot",
    manually_attached: "manually attached",
    unresolved: "unresolved",
  };
  return labels[status] || status;
}

function sortedThreads(project, includeArchived = true) {
  const order = Object.fromEntries(THREAD_ROLES.map((role, index) => [role, index]));
  return chatThreads(project)
    .filter((thread) => includeArchived || !thread.archived)
    .slice()
    .sort((a, b) => {
      if (a.archived !== b.archived) return a.archived ? 1 : -1;
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return (order[a.role] ?? 99) - (order[b.role] ?? 99) || a.title.localeCompare(b.title);
    });
}

function promptTemplates(project) {
  return { ...defaultPromptTemplates(), ...(project?.promptTemplates || {}) };
}

function templateForThread(project, thread) {
  const templates = promptTemplates(project);
  const role = thread?.role || "review";
  return templates[role]?.text || templates.review?.text || defaultPromptText(role);
}

function selectedFileContents() {
  if (!state.selectedFilePreview || state.selectedFilePreview.binary) return "";
  return state.selectedFilePreview.text || "";
}

function interpolatePrompt(template, options = {}) {
  const project = options.project || activeProject();
  const thread = options.thread || activeThread(project);
  const fileRelPath = options.fileRelPath ?? state.selectedFileRelPath ?? "";
  const fileContents = options.fileContents ?? selectedFileContents();
  const replacements = {
    "project.name": project?.name || "",
    "workspace.path": workspaceRootValue(project) || "",
    "file.relPath": fileRelPath || "No file selected",
    "file.contents": fileContents || "",
    "thread.role": roleLabel(thread?.role || "review"),
    returnHeader: project?.flowProfile?.returnHeader || "GPT feedback",
  };
  return String(template || "").replace(/{{\s*([^}]+?)\s*}}/g, (_match, key) => replacements[key] ?? "");
}

function activePromptText(project = activeProject(), thread = activeThread(project)) {
  return interpolatePrompt(templateForThread(project, thread), { project, thread });
}

function backendStatusText(project) {
  if (!project) return "backend detached";
  const status = state.workspaceStatuses[project.id];
  if (!status) return "backend attaching…";
  const transport = status.transport ? ` · ${status.transport}` : "";
  if (status.status === "attached") return `backend attached${transport}`;
  if (status.status === "failed") return `backend failed${status.lastErrorCode ? ` · ${status.lastErrorCode}` : ""}`;
  if (status.status === "closed") return `backend closed${status.lastErrorCode ? ` · ${status.lastErrorCode}` : ""}`;
  return `backend ${status.status || "unknown"}${transport}`;
}

function updateWorkspaceFieldVisibility() {
  const kind = els.workspaceKindInput?.value || "local";
  for (const element of document.querySelectorAll("[data-workspace-kind]")) {
    element.hidden = element.getAttribute("data-workspace-kind") !== kind;
  }
}

function setLastEvent(message) {
  els.lastEvent.textContent = message;
  els.lastEvent.title = message;
}

function ensureProjectStash(projectId = activeProject()?.id || "") {
  const targetProjectId = String(projectId || "");
  if (state.projectStash.projectId === targetProjectId) return state.projectStash;
  state.projectStash = {
    projectId: targetProjectId,
    targetSurface: "chatgpt",
    files: [],
    message: "review codex output",
    status: "idle",
    lastError: "",
    generation: 0,
  };
  return state.projectStash;
}

function projectStashFileKey(file) {
  return [
    String(file?.projectId || ""),
    String(file?.targetSurface || "chatgpt"),
    String(file?.codexThreadId || ""),
    String(file?.relPath || ""),
  ].join("::");
}

function projectStashDisplayName(file) {
  const relPath = String(file?.relPath || "");
  return relPath.split("/").filter(Boolean).pop() || relPath || "workspace file";
}

function projectStashDefaultMessage(targetSurface) {
  return targetSurface === "codex" ? "review gpt output" : "review codex output";
}

function projectStashTargetFromEvent(event) {
  const explicit = String(event?.targetSurface || event?.target || "").trim().toLowerCase();
  if (explicit === "codex" || explicit === "chatgpt") return explicit;
  const source = String(event?.source || "").toLowerCase();
  return source.includes("chatgpt") ? "codex" : "chatgpt";
}

function addProjectStashFile(event) {
  const project = activeProject();
  const projectId = String(event?.projectId || project?.id || "");
  if (!project || project.id !== projectId) {
    setLastEvent("Project stash add ignored: file belongs to another project.");
    return;
  }
  const relPath = String(event?.relPath || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!relPath) {
    setLastEvent("Project stash add ignored: file reference was empty.");
    return;
  }
  const stash = ensureProjectStash(projectId);
  const targetSurface = projectStashTargetFromEvent(event);
  if (stash.files.length && stash.targetSurface !== targetSurface) {
    setLastEvent(`Project stash add ignored: clear ${stash.targetSurface === "codex" ? "Codex" : "GPT"} handoff files before switching target.`);
    return;
  }
  if (!stash.files.length && stash.targetSurface !== targetSurface) {
    stash.targetSurface = targetSurface;
    stash.message = projectStashDefaultMessage(targetSurface);
  }
  const file = {
    id: createId("stash_file"),
    projectId,
    targetSurface,
    codexThreadId: String(event?.codexThreadId || event?.threadId || ""),
    codexThreadTitle: String(event?.codexThreadTitle || ""),
    chatThreadId: String(event?.chatThreadId || ""),
    chatThreadTitle: String(event?.chatThreadTitle || ""),
    relPath,
    label: String(event?.label || relPath),
    source: String(event?.source || "codex-file-context-menu"),
    addedAt: String(event?.at || nowIso()),
  };
  const key = projectStashFileKey(file);
  if (!stash.files.some((item) => projectStashFileKey(item) === key)) {
    stash.files.push(file);
    stash.status = "ready";
    stash.lastError = "";
    stash.generation += 1;
    setLastEvent(`Added to ${targetSurface === "codex" ? "Codex" : "GPT"} stash: ${relPath}.`);
  } else {
    setLastEvent(`Already in ${targetSurface === "codex" ? "Codex" : "GPT"} stash: ${relPath}.`);
  }
  setMiddleTab("project");
  renderProjectStash();
}

function removeProjectStashFile(fileId) {
  const stash = ensureProjectStash();
  const nextFiles = stash.files.filter((file) => file.id !== fileId);
  if (nextFiles.length === stash.files.length) return;
  stash.files = nextFiles;
  stash.status = nextFiles.length ? "ready" : "idle";
  stash.lastError = "";
  stash.generation += 1;
  renderProjectStash();
}

function clearProjectStash() {
  const stash = ensureProjectStash();
  stash.files = [];
  stash.targetSurface = "chatgpt";
  stash.message = projectStashDefaultMessage(stash.targetSurface);
  stash.status = "idle";
  stash.lastError = "";
  stash.generation += 1;
  renderProjectStash();
  setLastEvent("Cleared GPT handoff stash.");
}

function projectStashStatusText(stash) {
  const targetLabel = stash.targetSurface === "codex" ? "linked Codex thread" : "linked ChatGPT thread";
  if (stash.status === "sending") return `Sending bundle to ${targetLabel}…`;
  if (stash.status === "sent") return `Bundle sent to ${targetLabel}.`;
  if (stash.status === "failed") return stash.lastError || "Bundle send failed.";
  if (!stash.files.length) return "No files stashed.";
  const distinctThreads = new Set(stash.files.map((file) => String(file.codexThreadId || "")).filter(Boolean));
  if (distinctThreads.size > 1) return "Stash has files targeting multiple Codex threads; send is blocked until only one target remains.";
  return `${stash.files.length} file${stash.files.length === 1 ? "" : "s"} ready for ${stash.targetSurface === "codex" ? "Codex" : "GPT"} handoff.`;
}

function renderProjectStash() {
  if (!els.projectStashList) return;
  const project = activeProject();
  const stash = ensureProjectStash(project?.id || "");
  const targetIsCodex = stash.targetSurface === "codex";
  if (els.projectStashTitle) els.projectStashTitle.textContent = targetIsCodex ? "Codex handoff stash" : "GPT handoff stash";
  if (els.projectStashHint) {
    els.projectStashHint.textContent = targetIsCodex
      ? "Right-click ChatGPT file links and add them here, then send one workspace-file bundle to the linked Codex thread."
      : "Right-click Codex file references and add them here, then send one bundle to the linked ChatGPT thread.";
  }
  els.projectStashCount.textContent = String(stash.files.length);
  if (document.activeElement !== els.projectStashMessageInput) {
    els.projectStashMessageInput.value = stash.message || projectStashDefaultMessage(stash.targetSurface);
  }
  els.projectStashList.innerHTML = "";
  if (!stash.files.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No files stashed yet. Use “Add to Project stash” from a Codex file or ChatGPT download context menu.";
    els.projectStashList.appendChild(empty);
  } else {
    for (const file of stash.files) {
      const row = document.createElement("div");
      row.className = "project-stash-item";
      row.innerHTML = `
        <div class="project-stash-file-main">
          <strong class="truncate"></strong>
          <span class="mono muted truncate"></span>
        </div>
        <div class="project-stash-file-meta">
          <span class="pill subtle"></span>
          <button class="ghost small remove-stash-file" type="button">Remove</button>
        </div>
      `;
      row.querySelector("strong").textContent = projectStashDisplayName(file);
      row.querySelector("span.mono").textContent = file.relPath;
      row.querySelector("span.mono").title = file.relPath;
      row.querySelector(".pill").textContent = file.codexThreadTitle || (file.codexThreadId ? `Codex ${file.codexThreadId.slice(0, 8)}` : "target unresolved");
      row.querySelector(".remove-stash-file").addEventListener("click", () => removeProjectStashFile(file.id));
      els.projectStashList.appendChild(row);
    }
  }
  const sending = stash.status === "sending";
  const distinctThreads = new Set(stash.files.map((file) => String(file.codexThreadId || "")).filter(Boolean));
  els.projectStashStatus.textContent = projectStashStatusText(stash);
  els.projectStashStatus.title = els.projectStashStatus.textContent;
  els.projectStashStatus.classList.toggle("project-stash-error", stash.status === "failed" || distinctThreads.size > 1);
  els.clearProjectStashButton.disabled = sending || stash.files.length === 0;
  els.sendProjectStashButton.disabled = sending || stash.files.length === 0 || distinctThreads.size > 1;
  els.sendProjectStashButton.textContent = targetIsCodex ? "Send to Codex" : "Send to GPT";
}

async function sendProjectStash() {
  const project = activeProject();
  const stash = ensureProjectStash(project?.id || "");
  if (!project || !stash.files.length) return;
  stash.message = String(els.projectStashMessageInput?.value || "").trim() || projectStashDefaultMessage(stash.targetSurface);
  const sendGeneration = stash.generation;
  const filesToSend = stash.files.slice();
  const sentFileKeys = new Set(filesToSend.map(projectStashFileKey));
  stash.status = "sending";
  stash.lastError = "";
  renderProjectStash();
  try {
    const result = await (bridge.sendProjectStash || bridge.sendProjectStashToChatgpt)({
      projectId: project.id,
      targetSurface: stash.targetSurface,
      message: stash.message,
      files: filesToSend.map((file) => ({
        relPath: file.relPath,
        codexThreadId: file.codexThreadId,
        chatThreadId: file.chatThreadId,
      })),
      generation: sendGeneration,
    });
    stash.files = stash.generation === sendGeneration
      ? []
      : stash.files.filter((file) => !sentFileKeys.has(projectStashFileKey(file)));
    stash.status = stash.files.length ? "ready" : "sent";
    stash.generation += 1;
    renderProjectStash();
    const targetLabel = stash.targetSurface === "codex"
      ? result.codexThreadTitle || "linked Codex"
      : result.chatThreadTitle || "linked ChatGPT";
    setLastEvent(`Sent ${result.fileCount || 0} stashed file${result.fileCount === 1 ? "" : "s"} to ${targetLabel}.`);
  } catch (error) {
    stash.status = "failed";
    stash.lastError = error.message || "Project stash send failed.";
    renderProjectStash();
    setLastEvent(`Project stash send failed: ${stash.lastError}`);
  }
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

function currentWorkspaceRoots() {
  const project = activeProject();
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

  for (const root of currentWorkspaceRoots()) {
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

function fileFallbackForToken(value, context = {}) {
  const lineRef = splitLineRef(value);
  const relPath = relativePathWithinRoot(lineRef.path);
  const candidates = Array.isArray(context.fileEvidenceRefs) ? context.fileEvidenceRefs : [];
  const normalizedPrimary = normalizeSlashes(relPath || lineRef.path || "").replace(/^\.\/+/, "");
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
    line: lineRef.line,
    column: lineRef.column,
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

async function openSubAgentTypedUrl(url, context = {}) {
  if (!bridge?.openWorkspaceLink) {
    setLastEvent("Workspace link opening is unavailable.");
    return;
  }
  const project = activeProject();
  const result = await bridge.openWorkspaceLink(url, {
    disposition: "middle-web",
    source: {
      surface: "shell",
      projectId: project?.id || "",
      threadId: context.threadId || state.subAgentGraph?.primaryThreadId || state.openedCodexThreadId || "",
      threadTitle: context.threadTitle || "Sub-agent transcript",
    },
    userGesture: true,
  });
  if (!result?.ok) setLastEvent(`URL open blocked: ${result?.error || "unknown error"}`);
}

async function revealSubAgentTypedFile(relPath, options = {}) {
  const project = activeProject();
  if (!project?.id) {
    setLastEvent("Project file opening is unavailable.");
    return;
  }
  const fallbackPath = String(options?.fallbackPath || "").trim();
  try {
    if (bridge?.openProjectFile) {
      const result = await bridge.openProjectFile(project.id, relPath, {
        sourceSurface: "codex",
        threadId: state.subAgentGraph?.primaryThreadId || state.openedCodexThreadId || "",
        threadTitle: state.openedCodexThreadTitle || "",
      });
      if (!result?.ok && fallbackPath && /ENOENT|no such file|not found|cannot find/i.test(String(result?.error || ""))) {
        const fallbackResult = await bridge.openProjectFile(project.id, fallbackPath, {
          sourceSurface: "codex",
          threadId: state.subAgentGraph?.primaryThreadId || state.openedCodexThreadId || "",
          threadTitle: state.openedCodexThreadTitle || "",
          sourceKind: "project_file",
        });
        if (!fallbackResult?.ok) setLastEvent(`File open failed: ${fallbackResult?.error || result?.error || "unknown error"}`);
        return;
      }
      if (!result?.ok) setLastEvent(`File open failed: ${result?.error || "unknown error"}`);
      return;
    }
    if (!bridge?.revealProjectFile) {
      setLastEvent("Project file opening is unavailable.");
      return;
    }
    const result = await bridge.revealProjectFile(project.id, relPath);
    if (!result?.opened && result?.method) setLastEvent(`File path copied: ${result.absolutePath || relPath}`);
  } catch (error) {
    if (bridge?.openProjectFile && fallbackPath && /ENOENT|no such file|not found|cannot find/i.test(String(error?.message || error || ""))) {
      try {
        const fallbackResult = await bridge.openProjectFile(project.id, fallbackPath, {
          sourceSurface: "codex",
          threadId: state.subAgentGraph?.primaryThreadId || state.openedCodexThreadId || "",
          threadTitle: state.openedCodexThreadTitle || "",
          sourceKind: "project_file",
        });
        if (fallbackResult?.ok) return;
      } catch {}
    }
    setLastEvent(`File open failed: ${errorMessageText(error)}`);
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
      button.title = "Open link in workspace web panel";
      button.addEventListener("click", () => openSubAgentTypedUrl(token.href, context));
      container.appendChild(button);
      continue;
    }
    if (token.type === "file_path" || token.type === "line_ref") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `typed-token ${token.type === "line_ref" ? "typed-token-line-ref" : "typed-token-file"}`;
      button.textContent = token.text;
      button.title = token.line ? `Open ${token.path}:${token.line} in Files` : `Open ${token.path} in Files`;
      button.addEventListener("click", () => revealSubAgentTypedFile(token.path, { fallbackPath: token.fallbackPath || "" }));
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
  button.addEventListener("click", () => revealSubAgentTypedFile(fileRef.path, { fallbackPath: fileRef.fallbackPath || "" }));
  parent.appendChild(button);
}

function appendUrlToken(parent, label, href, context = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "typed-token typed-token-url assistant-md-link";
  button.textContent = label || href;
  button.title = `Open ${href}`;
  button.addEventListener("click", () => openSubAgentTypedUrl(href, context));
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
    if (href) appendUrlToken(code, source, href, context);
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
      if (href) appendUrlToken(parent, linkMatch[1], href, context);
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

function markdownFenceStart(line) {
  const trimmed = String(line || "").trim();
  const match = trimmed.match(/^(```|~~~)\s*([A-Za-z0-9_-]+)?(?:\s+.*)?$/);
  if (!match) return null;
  return {
    marker: match[1],
    language: match[2] || "",
  };
}

function markdownFenceClose(line, marker) {
  const trimmed = String(line || "").trim();
  return trimmed === marker;
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
    markdownFenceStart(line) ||
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

function renderSubAgentAssistantMarkdown(container, text, context = {}) {
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

    const fence = markdownFenceStart(line);
    if (fence) {
      const codeLines = [];
      index += 1;
      while (index < lines.length && !markdownFenceClose(lines[index], fence.marker)) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      container.appendChild(createMarkdownCodeBlock(codeLines, fence.language));
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
      if (!listLines.length) index += 1;
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

function renderMiddleFileMarkdown(container, text, context = {}) {
  renderSubAgentAssistantMarkdown(container, text, context);
  container.classList.add("middle-file-markdown");
}

function renderSubAgentMessageBody(container, message, context = {}) {
  const text = String(message?.text || "");
  container.dataset.rawText = text;
  if (message?.role === "process") {
    renderSubAgentProcessBody(container, message);
    return;
  }
  container.classList.toggle("assistant-markdown", message?.role === "child");
  if (message?.role === "child") renderSubAgentAssistantMarkdown(container, text, context);
  else {
    container.classList.remove("assistant-markdown");
    renderTypedContent(container, text, context);
  }
}

const typedMarkdownProjection = window.CodexTypedMarkdownProjection;

function shellTypedMarkdownContext(context = {}) {
  const safeContext = context && typeof context === "object" ? context : {};
  return {
    ...safeContext,
    workspaceRoots: currentWorkspaceRoots(),
    urlTokenTitle: "Open link in workspace web panel",
    onOpenUrl: (url) => openSubAgentTypedUrl(url, safeContext),
    onOpenFile: (relPath, options = {}) => revealSubAgentTypedFile(relPath, { fallbackPath: options.fallbackPath || "" }),
  };
}

if (typedMarkdownProjection) {
  tokenizeTypedContent = function sharedTokenizeTypedContent(text, context = {}) {
    return typedMarkdownProjection.tokenizeTypedContent(text, shellTypedMarkdownContext(context));
  };
  renderTypedContent = function sharedRenderTypedContent(container, text, context = {}) {
    typedMarkdownProjection.renderTypedContent(container, text, shellTypedMarkdownContext(context));
  };
  renderSubAgentAssistantMarkdown = function sharedRenderSubAgentAssistantMarkdown(container, text, context = {}) {
    typedMarkdownProjection.renderAssistantMarkdown(container, text, shellTypedMarkdownContext(context));
  };
  renderMiddleFileMarkdown = function sharedRenderMiddleFileMarkdown(container, text, context = {}) {
    typedMarkdownProjection.renderAssistantMarkdown(container, text, shellTypedMarkdownContext(context));
    container.classList.add("middle-file-markdown");
  };
} else {
  console.error("Shared typed Markdown projection unavailable; using legacy shell projection.");
}

function subAgentMessagePreviewKey(agent, message, index) {
  return [
    subAgentThreadId(agent) || "unknown-agent",
    String(message?.id || `message_${index}`),
    String(message?.role || "message"),
  ].join(":");
}

function setSubAgentMessagePreviewState(body, toggle, key, expanded) {
  const isExpanded = Boolean(expanded);
  body.classList.toggle("is-message-preview-collapsed", !isExpanded);
  body.classList.toggle("is-message-preview-expanded", isExpanded);
  toggle.textContent = isExpanded ? "▴ Collapse" : "▾ Expand";
  toggle.setAttribute("aria-expanded", isExpanded ? "true" : "false");
  if (key) {
    if (isExpanded) state.expandedSubAgentMessages.add(key);
    else state.expandedSubAgentMessages.delete(key);
  }
}

function configureSubAgentMessagePreview(item, body, key) {
  if (!item || !body) return;
  body.classList.remove("is-message-preview-eligible", "is-message-preview-expanded", "is-message-preview-collapsed");
  body.style.setProperty("--sub-agent-preview-lines", String(SUB_AGENT_MESSAGE_PREVIEW_LINES));
  body.classList.add("is-message-preview-eligible", "is-message-preview-collapsed");
  const explicitLineCount = String(body.textContent || "").split(/\r?\n/).length;

  requestAnimationFrame(() => {
    if (!item.isConnected) return;
    const renderedOverflow = body.scrollHeight > body.clientHeight + 1;
    const shouldClamp = explicitLineCount > SUB_AGENT_MESSAGE_PREVIEW_LINES || renderedOverflow;
    if (!shouldClamp) {
      body.classList.remove("is-message-preview-eligible", "is-message-preview-expanded", "is-message-preview-collapsed");
      body.style.removeProperty("--sub-agent-preview-lines");
      return;
    }

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "secondary sub-agent-message-preview-toggle";
    toggle.addEventListener("click", () => {
      const expanded = body.classList.contains("is-message-preview-collapsed");
      setSubAgentMessagePreviewState(body, toggle, key, expanded);
    });
    item.appendChild(toggle);
    setSubAgentMessagePreviewState(body, toggle, key, state.expandedSubAgentMessages.has(key));
  });
}

function subAgentThoughtItemLabel(item) {
  if (!item) return "Thought";
  if (item.type === "reasoning") return "Reasoning";
  if (item.type === "agentMessage") return `Agent · ${String(item.phase || "thought") || "thought"}`;
  if (item.type === "commandExecution") return `Shell · ${String(item.command || "command").slice(0, 88)}`;
  if (item.type === "mcpToolCall") return `Tool · ${item.server || "mcp"}:${item.tool || "tool"}`;
  if (item.type === "dynamicToolCall") return `Dynamic tool · ${item.tool || "tool"}`;
  if (item.type === "webSearch") return `Web search · ${String(item.query || "query").slice(0, 88)}`;
  if (item.type === "fileChange") {
    const changes = Array.isArray(item.changes) ? item.changes.length : 0;
    return `Patch · ${changes} file change${changes === 1 ? "" : "s"}`;
  }
  if (item.type === "imageGeneration") return "Image generation";
  if (item.type === "collabAgentToolCall") return `Sub-agent · ${item.tool || "call"}`;
  return String(item.type || "Thought");
}

function subAgentThoughtItemBody(item) {
  if (!item) return "";
  if (item.type === "agentMessage") return String(item.text || item.message || "").trim();
  if (item.type === "reasoning") return [...(item.summary || []), ...(item.content || [])].filter(Boolean).join("\n").trim();
  if (item.type === "commandExecution") {
    return [
      item.status || "",
      item.cwd ? `cwd: ${item.cwd}` : "",
      item.command || "",
      item.exitCode === null || item.exitCode === undefined ? "" : `exit ${item.exitCode}`,
      item.aggregatedOutput || item.stdout || item.stderr || "",
    ].filter(Boolean).join("\n").trim();
  }
  if (item.type === "fileChange") {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    const header = `${item.patchStatus || item.status || "completed"}`;
    const lines = changes.map((change) => {
      const kind = String(change?.kind || change?.type || "change");
      const relPath = String(change?.path || change?.relativePath || change?.file || "").trim();
      return `- ${kind}${relPath ? ` ${relPath}` : ""}`;
    });
    return [header, lines.join("\n"), item.stdout || "", item.stderr || ""].filter(Boolean).join("\n").trim();
  }
  if (item.type === "mcpToolCall") return [item.server || "mcp", item.tool || "tool", item.status || "unknown", item.result || "", item.error || ""].filter(Boolean).join("\n");
  if (item.type === "dynamicToolCall") return [item.tool || "tool", item.status || "unknown", item.contentItems || ""].filter(Boolean).join("\n");
  if (item.type === "webSearch") return `Query: ${item.query || ""}`.trim();
  if (item.type === "imageGeneration") return [item.revisedPrompt, item.result, item.savedPath].filter(Boolean).join("\n").trim();
  if (item.type === "collabAgentToolCall") {
    const targets = Array.isArray(item.receiverThreadIds) && item.receiverThreadIds.length ? `Targets: ${item.receiverThreadIds.join(", ")}` : "";
    return [item.tool || "call", item.status || "unknown", item.prompt || "", targets].filter(Boolean).join("\n").trim();
  }
  return typeof item === "string" ? item : JSON.stringify(item, null, 2);
}

function subAgentThoughtBody(item) {
  return String(subAgentThoughtItemBody(item) || "").trim();
}

function subAgentEmptyThoughtSentinel(text) {
  const normalized = String(text || "").trim().toLowerCase();
  return !normalized ||
    normalized === "no reasoning text." ||
    normalized === "reasoning not available" ||
    normalized === "reasoning unavailable" ||
    normalized === "no reasoning available";
}

function shouldRenderSubAgentThoughtItem(item) {
  if (!item || item.type === "subagentNotification") return false;
  if (SUB_AGENT_TOOL_LIKE_THOUGHT_TYPES.has(item.type) || item.type === "fileChange" || item.type === "collabAgentToolCall") return true;
  const body = subAgentThoughtBody(item);
  if (item.type === "reasoning" || item.type === "agentMessage") return !subAgentEmptyThoughtSentinel(body);
  return !subAgentEmptyThoughtSentinel(body);
}

function projectSubAgentThoughtItems(items = []) {
  const visible = Array.isArray(items) ? items.filter(shouldRenderSubAgentThoughtItem) : [];
  return {
    reasoningItems: visible.filter((item) => item?.type === "reasoning" || item?.type === "agentMessage"),
    toolItems: visible.filter((item) => SUB_AGENT_TOOL_LIKE_THOUGHT_TYPES.has(item?.type)),
    patchItems: visible.filter((item) => item?.type === "fileChange"),
    otherItems: visible.filter((item) =>
      item?.type !== "reasoning" &&
      item?.type !== "agentMessage" &&
      item?.type !== "fileChange" &&
      !SUB_AGENT_TOOL_LIKE_THOUGHT_TYPES.has(item?.type)),
    visibleCount: visible.length,
  };
}

function appendSubAgentThoughtDetail(parent, item, className = "sub-agent-thought-tool") {
  const detail = document.createElement("details");
  detail.className = className;
  const summary = document.createElement("summary");
  summary.textContent = subAgentThoughtItemLabel(item);
  const content = document.createElement("pre");
  content.className = "sub-agent-thought-content";
  renderTypedContent(content, subAgentThoughtBody(item) || "No details.");
  detail.append(summary, content);
  parent.appendChild(detail);
}

function renderSubAgentProcessBody(container, message) {
  container.textContent = "";
  container.classList.remove("assistant-markdown");
  const projection = projectSubAgentThoughtItems(message?.thoughtItems || []);
  if (!projection.visibleCount) {
    container.textContent = "";
    return;
  }
  const root = document.createElement("details");
  root.className = "sub-agent-thought-process";
  const summary = document.createElement("summary");
  summary.textContent = projection.reasoningItems.length
    ? `Thought process (${projection.visibleCount})`
    : `Process evidence (${projection.visibleCount})`;
  root.appendChild(summary);

  const body = document.createElement("div");
  body.className = "sub-agent-thought-body";
  for (const item of projection.reasoningItems) {
    const block = document.createElement("div");
    block.className = "sub-agent-thought-reasoning";
    renderTypedContent(block, subAgentThoughtBody(item));
    body.appendChild(block);
  }
  if (projection.toolItems.length) {
    const toolsRoot = document.createElement("details");
    toolsRoot.className = "sub-agent-thought-tools";
    const toolsSummary = document.createElement("summary");
    toolsSummary.textContent = `Shell / tool calls (${projection.toolItems.length})`;
    toolsRoot.appendChild(toolsSummary);
    const toolsList = document.createElement("div");
    toolsList.className = "sub-agent-thought-tools-list";
    for (const item of projection.toolItems) appendSubAgentThoughtDetail(toolsList, item);
    toolsRoot.appendChild(toolsList);
    body.appendChild(toolsRoot);
  }
  if (projection.patchItems.length) {
    const patchesRoot = document.createElement("details");
    patchesRoot.className = "sub-agent-thought-tools sub-agent-thought-patches";
    const patchesSummary = document.createElement("summary");
    patchesSummary.textContent = `Patches (${projection.patchItems.length})`;
    patchesRoot.appendChild(patchesSummary);
    const patchesList = document.createElement("div");
    patchesList.className = "sub-agent-thought-tools-list";
    for (const item of projection.patchItems) appendSubAgentThoughtDetail(patchesList, item, "sub-agent-thought-tool sub-agent-thought-patch");
    patchesRoot.appendChild(patchesList);
    body.appendChild(patchesRoot);
  }
  for (const item of projection.otherItems) appendSubAgentThoughtDetail(body, item);
  root.appendChild(body);
  container.appendChild(root);
}

function clampPlaneZoom(value) {
  return typeof bridge?.clampPlaneZoom === "function" ? bridge.clampPlaneZoom(value) : PLANE_ZOOM_DEFAULT;
}

function zoomDeltaForDirection(direction) {
  return typeof bridge?.zoomDeltaForDirection === "function" ? bridge.zoomDeltaForDirection(direction) : NO_ZOOM_DELTA;
}

function applyMiddlePlaneZoom(value) {
  const zoomFactor = clampPlaneZoom(value);
  state.planeZooms.middle = zoomFactor;
  document.documentElement.style.setProperty("--middle-plane-zoom", zoomFactor.toFixed(2));
  scheduleResizeBurst();
}

function planeFromWheelTarget(target) {
  const element = target instanceof Element ? target : target?.parentElement;
  if (!element) return "";
  if (els.controlPlane?.contains(element)) return "middle";
  if (els.codexSlot?.contains(element) || element.closest?.(".codex-plane")) return "codex";
  if (els.chatgptSlot?.contains(element) || els.subAgentsSlot?.contains(element) || element.closest?.(".chatgpt-plane")) return "chatgpt";
  return "";
}

function directionFromWheel(event) {
  return event.deltaY < 0 ? "in" : "out";
}

function handlePlaneZoomWheel(event) {
  if (!event.ctrlKey) return;
  const plane = planeFromWheelTarget(event.target);
  if (!plane) return;
  event.preventDefault();
  const direction = directionFromWheel(event);
  if (plane === "middle") {
    const next = clampPlaneZoom(state.planeZooms.middle + zoomDeltaForDirection(direction));
    applyMiddlePlaneZoom(next);
    bridge.adjustPlaneZoom?.("middle", direction).catch(() => {});
    return;
  }
  bridge.adjustPlaneZoom?.(plane, direction).catch(() => {});
}

function formatBytes(bytes) {
  const number = Number(bytes) || 0;
  if (number < 1024) return `${number} B`;
  if (number < 1024 * 1024) return `${(number / 1024).toFixed(1)} KB`;
  return `${(number / (1024 * 1024)).toFixed(1)} MB`;
}

function errorMessageText(error, fallback = "unknown error") {
  const value = error?.message || (typeof error === "string" ? error : error ? String(error) : "");
  return value || fallback;
}

function formatTime(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return String(value);
  }
}

function codexThreadUpdatedSummary(thread = {}) {
  if (!thread.updatedAt) return { text: "No timestamp", title: "No Codex thread activity timestamp was available." };
  const sourceLabels = {
    session_file: "session file",
    session_index: "index",
    session_created: "created",
  };
  const source = sourceLabels[thread.updatedAtSource] || "thread evidence";
  const titleParts = [`Activity: ${thread.updatedAt}`, `Source: ${source}`];
  if (thread.indexUpdatedAt && thread.indexUpdatedAt !== thread.updatedAt) titleParts.push(`Index: ${thread.indexUpdatedAt}`);
  if (thread.sessionFileMtime && thread.sessionFileMtime !== thread.updatedAt) titleParts.push(`Session file: ${thread.sessionFileMtime}`);
  return {
    text: `Updated ${formatTime(thread.updatedAt)} · ${source}`,
    title: titleParts.join("\n"),
  };
}

function formatDurationMs(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 1 : 2)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${remainSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return `${hours}h ${remainMinutes}m`;
}

function surfaceStatusLabel(event) {
  if (!event || event.type === "idle") return "idle";
  if (event.type === "loading") return "loading";
  if (event.type === "loaded") return event.title ? `loaded · ${event.title}` : "loaded";
  if (event.type === "load-failed") return "load failed";
  if (event.type === "navigation-blocked") return "blocked navigation";
  if (event.type === "settings-opened") return "settings requested";
  if (event.type === "settings-open-failed") return "settings failed";
  return event.type;
}

function renderStatus() {
  for (const [surface, element] of [
    ["codex", els.codexStatus],
    ["chatgpt", els.chatgptStatus],
  ]) {
    const event = state.surfaceEvents[surface] ?? { type: "idle" };
    element.textContent = surfaceStatusLabel(event);
    element.title = event.title || event.url || event.type || "idle";
    element.className = "status-dot";
    if (event.type === "loading") element.classList.add("loading");
    if (event.type === "loaded") element.classList.add("loaded");
    if (event.type === "load-failed") element.classList.add("failed");
    if (event.type === "navigation-blocked") element.classList.add("blocked");
    if (event.type === "settings-opened") element.classList.add("settings-opened");
    if (event.type === "settings-open-failed") element.classList.add("settings-open-failed");
  }
}

function directAuthStatusLabel(status) {
  const value = status?.status || "unauthenticated";
  if (value === "authenticated") return "authenticated";
  if (value === "expired") return "expired";
  if (value === "refresh_failed") return "refresh failed";
  return "unauthenticated";
}

function directAuthExpiryLabel(status) {
  if (!status || !status.expiresAt) return "no expiry";
  if (status.status === "expired") return "expired";
  return `expires in ${formatDurationMs(status.expiresInMs)}`;
}

function sanitizedDirectAuthError(fallback) {
  return fallback || "Direct auth request failed.";
}

function directAuthModeSignature(modes) {
  return modes.map((mode) => String(mode || "")).join("|");
}

function directRuntimeStatusLabel(status) {
  const textOnly = status?.directTextOnly || {};
  const activation = status?.activation || {};
  if (activation.state === "enabled") return "Direct enabled";
  if (activation.state === "eligible") return "Direct eligible";
  if (activation.state === "degraded") return "Direct degraded";
  if (activation.state === "rollback_required") return "rollback required";
  if (textOnly.status === "enabled") return "Direct selected (tools unavailable)";
  if (textOnly.status === "eligible") return "Direct ready (text fallback)";
  if (activation.state === "text_only_eligible") return "Direct text fallback";
  const runtime = status?.directRuntime || {};
  if (runtime.turnRunnable) return "turns runnable";
  if (runtime.status === "not_selected") return "legacy bridge active";
  if (runtime.status === "not_runnable") return "turns not runnable";
  return runtime.status || status?.status || "unknown";
}

function directRuntimeModeLabel(status) {
  return status?.runtimeModeLabel || status?.runtimeMode || "legacy app-server";
}

function directRuntimePathFromCodex(codex = {}) {
  const runtimeMode = String(codex.runtimeMode || "legacy-app-server").toLowerCase();
  const directTransport = String(codex.directTransport || "fixture").toLowerCase();
  const directTier = String(codex.directTier || codex.activationTier || codex.runtimeTier || "none").toLowerCase();
  if (runtimeMode !== "direct-experimental") return "app-server";
  if (directTransport === "live-text" && (directTier === "implementation-lane" || directTier === "implementation_lane")) {
    return "direct-implementation";
  }
  if (directTransport === "live-text" && (directTier === "text-only" || directTier === "text_only")) {
    return "direct-text";
  }
  return "app-server";
}

function directRuntimeBindingFieldsForPath(runtimePath, currentCodex = null) {
  if (runtimePath === "direct-text") {
    return {
      bindingProvider: "direct-chatgpt-codex",
      runtimeMode: "direct-experimental",
      directTransport: "live-text",
      directTier: "text-only",
    };
  }
  if (runtimePath === "direct-implementation" || runtimePath === "direct") {
    return {
      bindingProvider: "direct-chatgpt-codex",
      runtimeMode: "direct-experimental",
      directTransport: "live-text",
      directTier: "implementation-lane",
    };
  }
  return {
    bindingProvider: "codex-compatible",
    runtimeMode: "legacy-app-server",
    directTransport: "fixture",
    directTier: "none",
  };
}

function projectWithRuntimePath(project, runtimePath) {
  return {
    ...project,
    surfaceBinding: {
      ...project.surfaceBinding,
      codex: {
        ...(project.surfaceBinding?.codex || {}),
        ...directRuntimeBindingFieldsForPath(runtimePath),
      },
    },
  };
}

function syncProjectRuntimeFieldsFromDefaultPath() {
  if (!els.codexDefaultPathInput) return;
  const existing = state.config?.projects.find((project) => project.id === els.projectIdInput?.value);
  const fields = directRuntimeBindingFieldsForPath(els.codexDefaultPathInput.value || "app-server", existing?.surfaceBinding?.codex || null);
  if (els.codexRuntimeModeInput) els.codexRuntimeModeInput.value = fields.runtimeMode;
  if (els.codexDirectTransportInput) els.codexDirectTransportInput.value = fields.directTransport;
}

function updateCodexSpawnAgentControlAvailability() {
  const active = els.codexModeInput?.value === "managed"
    && (els.codexProviderKindInput?.value || "codex_executable") === "codex_executable"
    && (els.codexRuntimeModeInput?.value || "legacy-app-server") === "legacy-app-server";
  if (els.codexSpawnAgentModelOverridesInput) els.codexSpawnAgentModelOverridesInput.disabled = !active;
  if (els.codexSpawnAgentModelOverridesRow) {
    els.codexSpawnAgentModelOverridesRow.setAttribute("aria-disabled", active ? "false" : "true");
    els.codexSpawnAgentModelOverridesRow.title = active
      ? "Project-scoped managed app-server orchestration profile."
      : "Dormant unless this project uses the managed codex_executable app-server path.";
  }
}

function persistedDirectRuntimePath() {
  return directRuntimePathFromCodex(activeProject()?.surfaceBinding?.codex || {});
}

function selectedDirectRuntimePath(options = {}) {
  const project = activeProject();
  if (!project) return "app-server";
  if (options.scope === "default") return persistedDirectRuntimePath();
  return state.activeCodexRuntimePathByProject?.[project.id] || persistedDirectRuntimePath();
}

function syncDirectRuntimePathControl(selectEl, applyButton, _status = state.directRuntimeStatus, options = {}) {
  if (!selectEl) return;
  const scope = options.persistDefault ? "default" : "active";
  const currentPath = selectedDirectRuntimePath({ scope });
  const directTextOption = [...selectEl.options].find((option) => option.value === "direct-text");
  const directImplementationOption = [...selectEl.options].find((option) => option.value === "direct-implementation");
  if (directTextOption) directTextOption.disabled = false;
  if (directImplementationOption) directImplementationOption.disabled = false;
  const visiblePath = currentPath === "direct-text" && !directTextOption ? "direct-implementation" : currentPath;
  if (document.activeElement !== selectEl) selectEl.value = visiblePath;
  const selectedPath = selectEl.value || visiblePath;
  if (applyButton) {
    applyButton.disabled =
      state.directRuntimeLoading ||
      !activeProject() ||
      !bridge.setDirectRuntimePath ||
      selectedPath === currentPath;
    const prefix = options.persistDefault ? "Persist this Codex backend as the project default" : "Switch the active Codex lane";
    applyButton.title = selectedPath === currentPath
      ? (options.persistDefault
          ? "This Codex backend is already the persisted project default."
          : "This Codex backend is already active for this session.")
      : selectedPath === "direct-text"
        ? `${prefix}, validate Direct gates, and reload the Codex lane.`
        : `${prefix}, validate Direct tool gates, and reload the Codex lane.`;
  }
}

function directActivationBlockers(status = state.directRuntimeStatus) {
  const blockers = status?.activation?.gateSummary?.blockers;
  return Array.isArray(blockers) ? blockers : [];
}

function directActivationBlockedDetail(status = state.directRuntimeStatus) {
  const activation = status?.activation || {};
  const blockers = directActivationBlockers(status);
  if (blockers.length) {
    return blockers
      .slice(0, 4)
      .map((item) => `${item.label || item.id || "gate"}: ${item.reason || item.blockerCode || "blocked"}`)
      .join("; ");
  }
  const reasons = activation.gateSummary?.blockedReasons || {};
  const codes = Object.keys(reasons);
  if (codes.length) return codes.slice(0, 4).join(", ");
  return activation.labels?.detail || "Required activation gates are missing.";
}

function directTextOnlyBlockedDetail(status = state.directRuntimeStatus) {
  const textOnly = status?.directTextOnly || {};
  const blockers = Array.isArray(textOnly.gateSummary?.blockers) ? textOnly.gateSummary.blockers : [];
  if (blockers.length) {
    return blockers
      .slice(0, 4)
      .map((item) => `${item.label || item.id || "gate"}: ${item.reason || item.blockerCode || "blocked"}`)
      .join("; ");
  }
  const codes = Array.isArray(textOnly.blockers) ? textOnly.blockers : [];
  if (codes.length) return codes.slice(0, 4).join(", ");
  return textOnly.labels?.detail || "Direct text-only gates are missing.";
}

function directEmbarkFailureMessage(result = {}) {
  const error = result?.error || {};
  const runtimeStatus = result?.runtimeStatus || state.directRuntimeStatus || {};
  return error.message ||
    directTextOnlyBlockedDetail(runtimeStatus) ||
    directActivationBlockedDetail(runtimeStatus) ||
    result.status ||
    "Direct embark failed.";
}

async function embarkDirectRuntimeFromControl(project, options = {}) {
  if (!project || !bridge.embarkDirectRuntime) {
    throw new Error("Direct embark bridge is unavailable.");
  }
  let result = await bridge.embarkDirectRuntime(project.id, options);
  if (result?.status === "auth_required" && result.loginRequired) {
    setLastEvent("Direct login required; opening login flow.");
    const loginResult = await beginDirectAuthLogin();
    if (!loginResult?.ok) {
      return {
        ...result,
        status: "auth_required",
        error: {
          code: loginResult?.status || "auth_required",
          message: loginResult?.reason || "Direct login did not complete.",
        },
      };
    }
    result = await bridge.embarkDirectRuntime(project.id, options);
  }
  return result;
}

function directContextMaintenanceStatus(status = state.directRuntimeStatus) {
  const value = status?.directContextMaintenance || status?.contextMaintenance || status?.directImplementationLane?.contextMaintenance || {};
  const projection = value.statusProjection || {};
  const sibling = value.appServerSibling || {};
  const providerCompact = value.providerCompact || {};
  return {
    pressureState: String(value.pressureState || projection.pressureState || "unknown"),
    routeKind: String(value.routeKind || value.currentRouteKind || projection.routeKind || projection.currentRouteId || "none"),
    routeBlocked: value.routeBlocked === true || (Array.isArray(value.blockers) && value.blockers.length > 0),
    memoryState: String(value.memoryState || projection.memoryState || "none"),
    memoryPointerState: String(value.memoryPointerState || projection.memoryPointerState || "none"),
    batonState: String(value.batonState || projection.batonState || "not_required"),
    batonRequirement: String(value.batonRequirement || projection.batonRequirement || "not_required"),
    omissionState: String(value.omissionState || projection.omissionState || "none"),
    providerCompactState: String(providerCompact.state || value.providerCompactState || value.providerCompactionState || "not_proven"),
    providerCompactEvidenceState: String(providerCompact.evidenceState || value.providerCompactionEvidenceState || "missing"),
    appServerSibling: sibling,
    contextCompactionCount: Number(sibling.contextCompactionCount || 0),
    memoryCitationCount: Number(sibling.memoryCitationCount || 0),
    memoryModeObserved: sibling.memoryModeObserved === true,
    memoryResetObserved: sibling.memoryResetObserved === true,
    compactActionAllowed: value.compactActionAllowed === true,
    maintenanceExecutionAllowed: value.maintenanceExecutionAllowed === true,
    memoryEditorAllowed: value.memoryEditorAllowed === true,
    memoryResetAllowed: value.memoryResetAllowed === true,
    providerTransportAllowed: value.providerTransportAllowed === true,
    evidenceKeys: Array.isArray(value.evidenceKeys) ? value.evidenceKeys : [],
    blockers: Array.isArray(value.blockers) ? value.blockers : [],
  };
}

function formatDirectContextState(value) {
  return String(value || "unknown").replace(/_/g, " ");
}

function formatDirectContextBlockers(blockers = []) {
  return blockers
    .slice(0, 4)
    .map((blocker) => {
      if (blocker && typeof blocker === "object") return blocker.label || blocker.id || blocker.blockerCode || blocker.code || "blocked";
      return String(blocker || "").trim();
    })
    .filter(Boolean)
    .join(", ");
}

function directDiagnosticsObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function directDiagnosticsArray(value) {
  return Array.isArray(value) ? value : [];
}

function directDiagnosticsFirstObject(...values) {
  return values.find((value) => value && typeof value === "object" && !Array.isArray(value)) || {};
}

function directDiagnosticsValue(value, fallback = "missing") {
  if (value === true) return "yes";
  if (value === false) return "no";
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : fallback;
  return String(value).replace(/_/g, " ");
}

function directDiagnosticsShortId(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= 18) return text;
  return `${text.slice(0, 8)}…${text.slice(-6)}`;
}

function directDiagnosticsContextInput(status = state.directRuntimeStatus) {
  return directDiagnosticsFirstObject(
    status?.directContextMaintenance,
    status?.contextMaintenance,
    status?.directImplementationLane?.contextMaintenance,
  );
}

function directDiagnosticsEvidenceKeys(...sources) {
  const keys = [];
  for (const source of sources) {
    if (!source) continue;
    if (Array.isArray(source)) {
      for (const item of source) {
        const key = typeof item === "string" ? item : item?.evidenceKey || item?.id || item?.ref || "";
        if (key) keys.push(String(key));
      }
      continue;
    }
    if (typeof source === "string") keys.push(source);
    if (typeof source === "object") {
      for (const key of ["evidenceKey", "evidenceId", "sourceDigest", "projectionDigest", "artifactDigest", "schema"]) {
        if (source[key]) keys.push(String(source[key]));
      }
      if (Array.isArray(source.evidenceKeys)) keys.push(...source.evidenceKeys.map(String));
      if (Array.isArray(source.evidenceRefs)) {
        keys.push(...source.evidenceRefs.map((ref) => ref?.evidenceKey || ref?.id || ref?.ref || "").filter(Boolean).map(String));
      }
    }
  }
  return [...new Set(keys.filter(Boolean))];
}

function directDiagnosticsSubAgentEntries(source = {}) {
  const safeSource = directDiagnosticsObject(source);
  const graph = directDiagnosticsObject(safeSource.agentGraph || safeSource.graph || safeSource);
  const candidates = [
    safeSource.agents,
    safeSource.agentRows,
    safeSource.threads,
    safeSource.nodes,
    graph.agents,
    graph.nodes,
    safeSource.progressRegistry?.entries,
    safeSource.progressEntries,
  ];
  for (const value of candidates) {
    if (Array.isArray(value) && value.length) return value;
  }
  return [];
}

function directDiagnosticsSubAgentLabel(agent = {}, index = 0) {
  const safeAgent = directDiagnosticsObject(agent);
  return safeAgent.displayLabel ||
    safeAgent.nickname ||
    safeAgent.agentNickname ||
    safeAgent.agentRole ||
    safeAgent.role ||
    directDiagnosticsShortId(safeAgent.agentThreadId || safeAgent.threadId || safeAgent.id) ||
    `agent ${index + 1}`;
}

function directDiagnosticsRow(label, value, stateLabel = "diagnostic", title = "") {
  return { label, value: directDiagnosticsValue(value), stateLabel, title };
}

function renderDirectDiagnosticsRows(container, rows = [], emptyText = "No diagnostic evidence exposed.") {
  if (!container) return;
  container.textContent = "";
  const visibleRows = rows.filter(Boolean);
  if (!visibleRows.length) {
    const empty = document.createElement("div");
    empty.className = "direct-diagnostics-empty";
    empty.textContent = emptyText;
    container.appendChild(empty);
    return;
  }
  for (const row of visibleRows) {
    const item = document.createElement("div");
    item.className = `direct-diagnostics-row state-${String(row.stateLabel || "diagnostic").replace(/[^a-z0-9_-]/gi, "-")}`;
    if (row.title) item.title = row.title;
    const label = document.createElement("span");
    label.textContent = row.label || "Status";
    const value = document.createElement("strong");
    value.textContent = row.value || "missing";
    item.append(label, value);
    container.appendChild(item);
  }
}

function directBridgeSettingsRows(sectionName) {
  const rows = state.directBridgeSettingsStatus?.rows?.[sectionName];
  return Array.isArray(rows) ? rows : [];
}

function directBridgeManualSmokeSummary(status) {
  const gate = status?.sections?.manualSmokeGate || {};
  const available = gate.available === true;
  const gateState = typeof gate.gateState === "string" && gate.gateState ? gate.gateState : available ? "unknown" : "not exposed";
  const blocked = Number(gate.blockedCount || 0);
  const requiredBlocked = Number(gate.requiredBlockedCount || 0);
  const warnings = Number(gate.warningCount || 0);
  const notChecked = Number(gate.notCheckedCount || 0);
  return {
    available,
    gateState,
    blocked,
    requiredBlocked,
    warnings,
    notChecked,
    blockerCodes: Array.isArray(gate.blockerCodes) ? gate.blockerCodes.filter(Boolean) : [],
    unexpectedAuthority: Boolean(
      gate.manualSmokeExecutionAllowed ||
      gate.runtimePathMutationAllowed ||
      gate.workThreadMutationAllowed ||
      gate.providerTransportAllowed ||
      gate.workspaceMutationAllowed ||
      gate.appServerReplacementAllowed ||
      gate.autoApprovalAllowed ||
      gate.moduleExecutionAllowed ||
      gate.recursiveWorkerAllowed ||
      gate.matrixPromotionAllowed
    ),
  };
}

function renderDirectBridgeSettingsStatus() {
  if (!els.directBridgeSettingsBadge) return;
  const status = state.directBridgeSettingsStatus || {};
  const projectionOk = status.schema === "direct_settings_surface_projection@1";
  const authority = status.authority || {};
  const fallback = status.sections?.appServerFallbackParity || {};
  const runtimeWitness = status.sections?.runtimeWitness || {};
  const manualSmoke = directBridgeManualSmokeSummary(status);
  const blockedAuthority = [
    authority.runtimeMutationAllowed ? "runtime mutation" : "",
    authority.routingEnforced ? "routing" : "",
    authority.semanticBrokerEnforced ? "semantic broker" : "",
    authority.moduleExecutionAllowed ? "module execution" : "",
    authority.memoryEditingAllowed ? "memory edit" : "",
    authority.memoryResetAllowed ? "memory reset" : "",
    authority.providerCompactionAllowed ? "provider compact" : "",
    authority.providerTransportAllowed ? "provider transport" : "",
    authority.workspaceMutationAllowed ? "workspace mutation" : "",
    runtimeWitness.providerTransportAllowed || runtimeWitness.quotaReadAllowed || runtimeWitness.modelMutationAllowed || runtimeWitness.costComputationAllowed ? "runtime witness authority" : "",
    fallback.providerTransportAllowed || fallback.appServerSpawnAllowed || fallback.appServerReplacementAllowed || fallback.appServerMutationAllowed || fallback.runtimeSelectionMutationAllowed || fallback.workspaceMutationAllowed || fallback.recursiveWorkerAllowed || fallback.matrixPromotionAllowed ? "app-server fallback authority" : "",
    manualSmoke.unexpectedAuthority ? "manual smoke authority" : "",
  ].filter(Boolean);
  els.directBridgeSettingsBadge.textContent = state.directBridgeSettingsLoading
    ? "loading"
    : projectionOk
      ? manualSmoke.available
        ? `smoke ${manualSmoke.gateState}`
        : "status only"
      : "not loaded";
  els.directBridgeSettingsBadge.title = state.directBridgeSettingsError ||
    (projectionOk
      ? manualSmoke.available
        ? `Manual smoke gate: ${manualSmoke.gateState} · blocked: ${manualSmoke.blocked} · required blockers: ${manualSmoke.requiredBlocked}`
        : status.projectionDigest || "Renderer-safe direct bridge settings projection."
      : "Projection not loaded.");
  if (els.directBridgeSettingsRefreshButton) {
    els.directBridgeSettingsRefreshButton.disabled = state.directBridgeSettingsLoading || !bridge.getDirectBridgeSettingsStatus;
    els.directBridgeSettingsRefreshButton.title = "Refresh the renderer-safe direct bridge status surface.";
  }
  renderDirectDiagnosticsRows(els.directBridgeSettingsRuntimeList, directBridgeSettingsRows("runtime"));
  renderDirectDiagnosticsRows(els.directBridgeSettingsRegistryList, directBridgeSettingsRows("registry"));
  renderDirectDiagnosticsRows(els.directBridgeSettingsWorkThreadList, directBridgeSettingsRows("workThreads"));
  renderDirectDiagnosticsRows(els.directBridgeSettingsOperatorBrokerList, directBridgeSettingsRows("operatorBroker"));
  renderDirectDiagnosticsRows(els.directBridgeSettingsGovernanceList, directBridgeSettingsRows("governance"));
  renderDirectDiagnosticsRows(els.directBridgeSettingsModulesList, directBridgeSettingsRows("modules"));
  renderDirectDiagnosticsRows(els.directBridgeSettingsAgentClassList, directBridgeSettingsRows("agentClasses"));
  renderDirectDiagnosticsRows(els.directBridgeSettingsContinuityList, directBridgeSettingsRows("continuity"));
  renderDirectDiagnosticsRows(els.directBridgeSettingsRuntimeWitnessList, directBridgeSettingsRows("runtimeWitness"), "Runtime witness projection is not exposed by the current projection.");
  renderDirectDiagnosticsRows(els.directBridgeSettingsAgentUsageList, directBridgeSettingsRows("agentUsage"));
  renderDirectDiagnosticsRows(els.directBridgeSettingsAppServerFallbackList, directBridgeSettingsRows("appServerFallbackParity"), "App-server fallback parity is not exposed by the current projection.");
  renderDirectDiagnosticsRows(els.directBridgeSettingsManualSmokeList, directBridgeSettingsRows("manualSmokeGate"), "Manual smoke gate is not exposed by the current projection.");
  if (els.directBridgeSettingsEvidence) {
    if (state.directBridgeSettingsError) {
      els.directBridgeSettingsEvidence.textContent = `Bridge settings status unavailable: ${state.directBridgeSettingsError}`;
    } else if (blockedAuthority.length) {
      els.directBridgeSettingsEvidence.textContent = `WARNING: unexpected authority exposed (${blockedAuthority.join(", ")}).`;
    } else if (projectionOk && manualSmoke.available) {
      const blockerText = manualSmoke.blockerCodes.length ? ` · blockers: ${manualSmoke.blockerCodes.slice(0, 5).join(", ")}${manualSmoke.blockerCodes.length > 5 ? "…" : ""}` : "";
      els.directBridgeSettingsEvidence.textContent = `Manual smoke gate is ${manualSmoke.gateState} · blocked ${manualSmoke.blocked} · required blockers ${manualSmoke.requiredBlocked} · warnings ${manualSmoke.warnings} · not checked ${manualSmoke.notChecked}${blockerText}. Display-only: no provider, app-server, module, workspace, approval, recursive worker, or promotion transition is exposed.`;
    } else if (projectionOk) {
      els.directBridgeSettingsEvidence.textContent = "Display-only surface · no routing, module execution, memory edit/reset, provider compact, provider transport, or workspace mutation is exposed.";
    } else {
      els.directBridgeSettingsEvidence.textContent = "Direct bridge settings are display-only; no authority is exposed before a projection loads.";
    }
  }
}

function directDiagnosticsProjection(status = state.directRuntimeStatus) {
  const runtimeStatus = directDiagnosticsObject(status);
  const implementationLane = directDiagnosticsObject(runtimeStatus.directImplementationLane);
  const contextInput = directDiagnosticsContextInput(runtimeStatus);
  const contextMaintenance = directContextMaintenanceStatus(runtimeStatus);
  const statusProjection = directDiagnosticsObject(contextInput.statusProjection);
  const providerCompact = directDiagnosticsObject(contextInput.providerCompact);
  const metaSession = directDiagnosticsObject(state.directMetaSessionStatus);
  const governance = directDiagnosticsFirstObject(
    runtimeStatus.governance,
    runtimeStatus.directGovernance,
    implementationLane.governance,
    implementationLane.governancePacket,
    metaSession.governance,
  );
  const broker = directDiagnosticsFirstObject(
    runtimeStatus.semanticBroker,
    runtimeStatus.directSemanticBroker,
    implementationLane.semanticBroker,
    implementationLane.broker,
    metaSession.semanticBroker,
    metaSession.routeSummary,
  );
  const transitionGraph = directDiagnosticsFirstObject(
    runtimeStatus.transitionGraph,
    runtimeStatus.directTransitionGraph,
    implementationLane.transitionGraph,
    metaSession.transitionGraph,
  );
  const subAgentSource = directDiagnosticsFirstObject(
    runtimeStatus.directSubAgentObservability,
    runtimeStatus.subAgentObservability,
    runtimeStatus.subAgents,
    implementationLane.subAgentObservability,
    implementationLane.agentGraph,
  );
  const subAgentEntries = directDiagnosticsSubAgentEntries(subAgentSource).filter((agent) => agent && typeof agent === "object");
  const actionFlags = [
    contextMaintenance.compactActionAllowed ? "compact" : "",
    contextMaintenance.maintenanceExecutionAllowed ? "maintenance" : "",
    contextMaintenance.memoryEditorAllowed ? "memory edit" : "",
    contextMaintenance.memoryResetAllowed ? "memory reset" : "",
    contextMaintenance.providerTransportAllowed ? "provider compact" : "",
  ].filter(Boolean);
  const blockers = directDiagnosticsArray(contextMaintenance.blockers);
  const evidenceKeys = directDiagnosticsEvidenceKeys(
    contextMaintenance.evidenceKeys,
    contextInput,
    statusProjection,
    providerCompact,
    governance,
    broker,
    transitionGraph,
    subAgentSource,
  );
  const routeSummary = directDiagnosticsObject(metaSession.routeSummary);
  const brokerCandidates = directDiagnosticsArray(broker.candidates || broker.candidateRoutes || broker.routes);
  const transitions = directDiagnosticsArray(transitionGraph.edges || transitionGraph.transitions || implementationLane.transitions);
  const activeRuntime = selectedDirectRuntimePath();
  return {
    badge: state.directRuntimeLoading
      ? "loading"
      : runtimeStatus.status || directRuntimeStatusLabel(runtimeStatus),
    contextRows: [
      directDiagnosticsRow("Pressure", contextMaintenance.pressureState, contextMaintenance.pressureState === "unknown" ? "unknown" : "diagnostic"),
      directDiagnosticsRow("Route", contextMaintenance.routeKind, contextMaintenance.routeBlocked ? "blocked" : "diagnostic"),
      directDiagnosticsRow("Memory", contextMaintenance.memoryPointerState !== "none" ? contextMaintenance.memoryPointerState : contextMaintenance.memoryState),
      directDiagnosticsRow("Baton", contextMaintenance.batonState),
      directDiagnosticsRow("Omission", contextMaintenance.omissionState),
      directDiagnosticsRow("Provider compact", contextMaintenance.providerCompactState, contextMaintenance.providerCompactEvidenceState === "missing" ? "unknown" : "diagnostic"),
    ],
    artifactRows: [
      directDiagnosticsRow("Status projection", statusProjection.projectionDigest || statusProjection.sourceDigest || "not exposed", statusProjection.projectionDigest || statusProjection.sourceDigest ? "diagnostic" : "missing"),
      directDiagnosticsRow("Provider compact evidence", providerCompact.evidenceState || contextMaintenance.providerCompactEvidenceState, providerCompact.evidenceState === "missing" ? "missing" : "diagnostic"),
      directDiagnosticsRow("Evidence keys", evidenceKeys.length, evidenceKeys.length ? "diagnostic" : "missing", evidenceKeys.slice(0, 8).join("\n")),
      directDiagnosticsRow("Sibling compact rows", contextMaintenance.contextCompactionCount),
      directDiagnosticsRow("Sibling memory rows", contextMaintenance.memoryCitationCount),
    ],
    recoveryRows: [
      directDiagnosticsRow("Blockers", blockers.length ? formatDirectContextBlockers(blockers) : "none", blockers.length ? "blocked" : "ok"),
      directDiagnosticsRow("Unexpected actions", actionFlags.length ? actionFlags.join(", ") : "none", actionFlags.length ? "blocked" : "ok"),
      directDiagnosticsRow("Recovery posture", implementationLane.recoveryState || runtimeStatus.recoveryState || "status only"),
      directDiagnosticsRow("Provider transport", contextMaintenance.providerTransportAllowed, contextMaintenance.providerTransportAllowed ? "blocked" : "ok"),
    ],
    governanceRows: [
      directDiagnosticsRow("Packet", governance.schema || governance.packetSchema || "not exposed", governance.schema || governance.packetSchema ? "diagnostic" : "missing"),
      directDiagnosticsRow("Mode", governance.mode || governance.enforcementMode || "shadow only"),
      directDiagnosticsRow("Layer count", directDiagnosticsArray(governance.layers || governance.rows).length),
      directDiagnosticsRow("Authority", governance.enforced === true ? "unexpected enforce" : "not enforced", governance.enforced === true ? "blocked" : "ok"),
      directDiagnosticsRow("Raw payload", "excluded", "ok"),
    ],
    brokerRows: [
      directDiagnosticsRow("Packet", broker.schema || broker.packetSchema || "not exposed", broker.schema || broker.packetSchema ? "diagnostic" : "missing"),
      directDiagnosticsRow("Selected route", broker.selectedRoute || broker.selectedRouteId || broker.selected || "none"),
      directDiagnosticsRow("Candidates", brokerCandidates.length || routeSummary.proposed || 0),
      directDiagnosticsRow("Blocked dispatches", routeSummary.dispatchBlocked || broker.blocked || 0),
      directDiagnosticsRow("Auto reroute", "disabled", "ok"),
    ],
    transitionRows: [
      directDiagnosticsRow("Current path", activeRuntime),
      directDiagnosticsRow("Runtime label", directRuntimeStatusLabel(runtimeStatus)),
      directDiagnosticsRow("Known transitions", transitions.length || "not exposed", transitions.length ? "diagnostic" : "missing"),
      directDiagnosticsRow("Start turn", activeRuntime === "app-server" ? "legacy bridge" : "gated by direct lane", "diagnostic"),
      directDiagnosticsRow("Mutation authority", "not granted here", "ok"),
    ],
    subAgentRows: [
      directDiagnosticsRow("Store", subAgentSource.schema || subAgentSource.observabilityId || subAgentSource.agentGraphId ? "available" : "not exposed", subAgentSource.schema || subAgentSource.observabilityId || subAgentSource.agentGraphId ? "diagnostic" : "missing"),
      directDiagnosticsRow("Agents", subAgentEntries.length),
      ...subAgentEntries.slice(0, 6).map((agent, index) => directDiagnosticsRow(
        directDiagnosticsSubAgentLabel(agent, index),
        agent.lifecycleState || agent.activityState || agent.status || agent.attentionState || "observed",
        agent.lifecycleState === "failed" || agent.status === "failed" ? "blocked" : "diagnostic",
      )),
      directDiagnosticsRow("Controls", "read-only", "ok"),
    ],
    evidenceText: evidenceKeys.length
      ? `Status-only diagnostics · evidence ${evidenceKeys.slice(0, 5).join(", ")}${evidenceKeys.length > 5 ? "…" : ""} · no maintenance, governance, broker, or sub-agent action is exposed.`
      : "Status-only diagnostics · no evidence keys exposed yet · no maintenance, governance, broker, or sub-agent action is exposed.",
  };
}

function renderDirectDiagnosticsStatus(status = state.directRuntimeStatus) {
  if (!els.directDiagnosticsStatusBadge) return;
  const projection = directDiagnosticsProjection(status);
  els.directDiagnosticsStatusBadge.textContent = projection.badge;
  els.directDiagnosticsStatusBadge.title = "Renderer-safe direct diagnostics; all rows are display-only.";
  renderDirectDiagnosticsRows(els.directDiagnosticsContextGrid, projection.contextRows);
  renderDirectDiagnosticsRows(els.directDiagnosticsArtifactList, projection.artifactRows);
  renderDirectDiagnosticsRows(els.directDiagnosticsRecoveryList, projection.recoveryRows);
  renderDirectDiagnosticsRows(els.directDiagnosticsGovernanceList, projection.governanceRows);
  renderDirectDiagnosticsRows(els.directDiagnosticsBrokerList, projection.brokerRows);
  renderDirectDiagnosticsRows(els.directDiagnosticsTransitionList, projection.transitionRows);
  renderDirectDiagnosticsRows(els.directDiagnosticsSubAgentList, projection.subAgentRows);
  if (els.directDiagnosticsEvidence) els.directDiagnosticsEvidence.textContent = projection.evidenceText;
}

function directImplementationBooleanLabel(value) {
  if (value === true) return "yes";
  if (value === false) return "no";
  return "unknown";
}

function directImplementationFacetState(facet, fallbackValue = false) {
  if (facet && typeof facet === "object") return facet.state || (facet.canUse ? "ready" : "blocked");
  return fallbackValue ? "ready" : "blocked";
}

function directImplementationUiRows() {
  const projection = directDiagnosticsObject(state.directImplementationUiStatus);
  const lane = directDiagnosticsObject(projection.implementationLane);
  if (state.directImplementationUiLoading && !projection.schema) return [directDiagnosticsRow("Status", "loading")];
  if (state.directImplementationUiError) return [directDiagnosticsRow("Status", state.directImplementationUiError, "blocked")];
  if (!projection.schema) return [directDiagnosticsRow("Status", "not loaded", "missing")];
  return [
    directDiagnosticsRow("Active tier", projection.activeRuntimeTier || "unknown", projection.activeRuntimeTier === "direct-implementation-lane" ? "ok" : "diagnostic"),
    directDiagnosticsRow("Lane", lane.readiness || lane.status || "unknown", lane.readiness === "ready" ? "ok" : lane.readiness === "blocked" ? "blocked" : "diagnostic"),
    directDiagnosticsRow("Selected", directImplementationBooleanLabel(lane.selected), lane.selected ? "ok" : "unknown"),
    directDiagnosticsRow("Start turn", directImplementationFacetState(lane.facets?.canStartTurn, lane.canStartFirstTurn), lane.canStartFirstTurn ? "ok" : "blocked"),
    directDiagnosticsRow("Rollback", lane.canRollbackToAppServer ? "available" : "blocked", lane.canRollbackToAppServer ? "diagnostic" : "blocked"),
    directDiagnosticsRow("Generation", projection.meta?.uiProjectionGeneration || "missing", projection.meta?.uiProjectionGeneration ? "diagnostic" : "missing"),
  ];
}

function directImplementationApprovalRows() {
  const projection = directDiagnosticsObject(state.directImplementationUiStatus);
  const lane = directDiagnosticsObject(projection.implementationLane);
  const facets = directDiagnosticsObject(lane.facets);
  if (!projection.schema) return [directDiagnosticsRow("Status", state.directImplementationUiLoading ? "loading" : "not loaded", "missing")];
  return [
    directDiagnosticsRow("Cards", directImplementationFacetState(facets.canShowApprovalCards, lane.canShowApprovalCards), lane.canShowApprovalCards ? "ok" : "blocked"),
    directDiagnosticsRow("Read", directImplementationFacetState(facets.canApproveRead, lane.canApproveReadFile), lane.canApproveReadFile ? "ok" : "blocked"),
    directDiagnosticsRow("Patch", directImplementationFacetState(facets.canApprovePatch, lane.canApprovePatchApply), lane.canApprovePatchApply ? "ok" : "blocked"),
    directDiagnosticsRow("Command", directImplementationFacetState(facets.canApproveCommand, lane.canApproveRunCommand), lane.canApproveRunCommand ? "ok" : "blocked"),
    directDiagnosticsRow("Continuation", directImplementationFacetState(facets.canContinueAfterResult, lane.canSendContinuation), lane.canSendContinuation ? "ok" : "blocked"),
    directDiagnosticsRow("Blockers", (lane.blockerCodes || []).join(", ") || "none", lane.blockerCodes?.length ? "blocked" : "ok"),
  ];
}

function directImplementationActiveTurnRows() {
  const projection = directDiagnosticsObject(state.directImplementationUiStatus);
  const activeTurn = directDiagnosticsObject(projection.activeTurn);
  const currentSession = directDiagnosticsObject(projection.currentSession);
  const recovery = directDiagnosticsObject(projection.recovery);
  if (!projection.schema) return [directDiagnosticsRow("Status", state.directImplementationUiLoading ? "loading" : "not loaded", "missing")];
  return [
    directDiagnosticsRow("Turn state", activeTurn.state || "idle", activeTurn.state ? "diagnostic" : "ok"),
    directDiagnosticsRow("Composer", activeTurn.composerAllowed ? "allowed" : "blocked", activeTurn.composerAllowed ? "ok" : "blocked"),
    directDiagnosticsRow("Composer reason", activeTurn.composerAllowedReason || "unknown", activeTurn.composerAllowed ? "ok" : "diagnostic"),
    directDiagnosticsRow("Active turns", currentSession.activeTurnCount ?? "unknown", currentSession.activeTurnCount ? "diagnostic" : "ok"),
    directDiagnosticsRow("Obligations", currentSession.unresolvedObligationCount ?? "unknown", currentSession.unresolvedObligationCount ? "blocked" : "ok"),
    directDiagnosticsRow("Recovery", recovery.state || "unknown", recovery.state && recovery.state !== "healthy" ? "diagnostic" : "ok"),
  ];
}

function directImplementationToolResultRows() {
  const projection = directDiagnosticsObject(state.directImplementationUiStatus);
  const latest = directDiagnosticsObject(projection.latestToolResult);
  if (!projection.schema) return [directDiagnosticsRow("Status", state.directImplementationUiLoading ? "loading" : "not loaded", "missing")];
  if (!latest.schema || latest.status === "none") return [directDiagnosticsRow("Latest result", "none", "missing")];
  return [
    directDiagnosticsRow("Tool", latest.tool || "unknown", "diagnostic"),
    directDiagnosticsRow("Status", latest.status || "unknown", latest.status?.includes("failed") ? "blocked" : "diagnostic"),
    directDiagnosticsRow("Side effect", directImplementationBooleanLabel(latest.sideEffectExecuted), latest.sideEffectExecuted ? "diagnostic" : "ok"),
    directDiagnosticsRow("Effect scan", latest.workspaceEffectScanRan ? "ran" : "not run", latest.workspaceEffectScanRan ? "ok" : "missing"),
    directDiagnosticsRow("Changes", latest.workspaceChangesDetected ? `${latest.changedPathCount || 0}` : "none", latest.workspaceChangesDetected ? "diagnostic" : "ok"),
    directDiagnosticsRow("Provider saw", latest.providerVisibility || "none", latest.providerSawChangedFileContents ? "blocked" : "ok"),
  ];
}

function directImplementationHistoryRows() {
  const history = directDiagnosticsObject(state.directImplementationOperationHistory);
  const rows = Array.isArray(history.rows) ? history.rows : [];
  if (state.directImplementationUiLoading && !rows.length) return [directDiagnosticsRow("Status", "loading")];
  if (state.directImplementationUiError) return [directDiagnosticsRow("Status", state.directImplementationUiError, "blocked")];
  if (!history.schema) return [directDiagnosticsRow("Status", "not loaded", "missing")];
  if (!rows.length) return [directDiagnosticsRow("Rows", "none", "missing")];
  return rows.slice(0, 6).map((row) => directDiagnosticsRow(
    row.family || row.eventKind || "operation",
    `${row.status || "unknown"} · ${row.rendererSafeSummary || row.eventKind || row.rowId || "operation"}`,
    row.status === "failed" ? "blocked" : "diagnostic",
  ));
}

function directImplementationPromotionRows() {
  const projection = directDiagnosticsObject(state.directImplementationUiStatus);
  const queue = directDiagnosticsObject(projection.livePromotionCandidateQueue);
  const candidates = Array.isArray(queue.candidates) ? queue.candidates : [];
  if (!projection.schema) return [directDiagnosticsRow("Status", state.directImplementationUiLoading ? "loading" : "not loaded", "missing")];
  if (!queue.schema) return [directDiagnosticsRow("Queue", "not exposed", "missing")];
  const rows = [
    directDiagnosticsRow("Queue", `${queue.readyCount || 0} ready / ${queue.blockedCount || 0} blocked`, queue.readyCount ? "diagnostic" : "blocked"),
  ];
  for (const candidate of candidates.slice(0, 8)) {
    const blockers = Array.isArray(candidate.blockerCodes) ? candidate.blockerCodes : [];
    const value = `${candidate.gateState || "unknown"} · ${blockers[0] || candidate.promotionState || "candidate"}`;
    rows.push(directDiagnosticsRow(candidate.label || candidate.capabilityId || "Candidate", value, candidate.gateState === "ready" ? "ok" : "blocked", blockers.join(", ")));
  }
  rows.push(directDiagnosticsRow("Authority", "display only", "diagnostic", "No provider transport, workspace mutation, recursive worker, app-server fallback, matrix, or default mutation authority is exposed."));
  return rows;
}

function renderDirectImplementationUiStatus() {
  if (!els.directImplementationStatusBadge) return;
  const projection = directDiagnosticsObject(state.directImplementationUiStatus);
  const history = directDiagnosticsObject(state.directImplementationOperationHistory);
  const policy = directDiagnosticsObject(state.directImplementationPolicyView);
  const schemaOk = projection.schema === "direct_implementation_lane_ui_status@1";
  els.directImplementationStatusBadge.textContent = state.directImplementationUiLoading
    ? "loading"
    : schemaOk
      ? projection.implementationLane?.readiness || projection.activeRuntimeTier || "ready"
      : "not loaded";
  els.directImplementationStatusBadge.title = state.directImplementationUiError ||
    (schemaOk ? projection.meta?.sourceDigest || "Renderer-safe direct implementation-lane status." : "Projection not loaded.");
  if (els.directImplementationRefreshButton) {
    els.directImplementationRefreshButton.disabled = state.directImplementationUiLoading || !bridge.getDirectImplementationLaneUiStatus;
    els.directImplementationRefreshButton.title = "Refresh direct implementation-lane UI readiness, operation history, and policy projection.";
  }
  renderDirectDiagnosticsRows(els.directImplementationLaneList, directImplementationUiRows());
  renderDirectDiagnosticsRows(els.directImplementationApprovalList, directImplementationApprovalRows());
  renderDirectDiagnosticsRows(els.directImplementationActiveTurnList, directImplementationActiveTurnRows());
  renderDirectDiagnosticsRows(els.directImplementationToolResultList, directImplementationToolResultRows());
  renderDirectDiagnosticsRows(els.directImplementationHistoryList, directImplementationHistoryRows());
  renderDirectDiagnosticsRows(els.directImplementationPromotionList, directImplementationPromotionRows());
  if (els.directImplementationEvidence) {
    if (state.directImplementationUiError) {
      els.directImplementationEvidence.textContent = `Implementation-lane projection unavailable: ${state.directImplementationUiError}`;
    } else if (schemaOk) {
      const rowCount = Array.isArray(history.rows) ? history.rows.length : 0;
      const historyScope = history.scope || "not loaded";
      const queue = directDiagnosticsObject(projection.livePromotionCandidateQueue);
      const promotionSummary = queue.schema ? ` · promotion candidates ${queue.readyCount || 0}/${queue.candidateCount || 0} ready` : "";
      const warning = state.directImplementationUiWarning ? ` · warning: ${state.directImplementationUiWarning}` : "";
      els.directImplementationEvidence.textContent = `Read-only projection · ${rowCount} ${historyScope} history row${rowCount === 1 ? "" : "s"} · policy ${policy.schema ? "loaded" : "not loaded"}${promotionSummary} · no approval, replay, recovery, promotion, or workspace mutation action is exposed here.${warning}`;
    } else {
      els.directImplementationEvidence.textContent = "Direct implementation-lane UI status is read-only and not loaded yet.";
    }
  }
}

function directImplementationHistoryRequest(status) {
  const projection = directDiagnosticsObject(status);
  const activeTurnId = projection.activeTurn?.turnId || "";
  if (activeTurnId) return { scope: "active-turn", targetTurnId: activeTurnId, limit: 24 };
  const latestTurnId = projection.latestToolResult?.turnId || "";
  if (latestTurnId) return { scope: "latest-result-turn", targetTurnId: latestTurnId, limit: 24 };
  return { scope: "project", limit: 24 };
}

async function optionalDirectImplementationProjection(label, loader) {
  try {
    return { value: await loader(), warning: "" };
  } catch (error) {
    return { value: null, warning: `${label}: ${error.message || "unavailable"}` };
  }
}

function renderDirectRuntimeStatus() {
  if (!els.directRuntimeModeBadge) return;
  const status = state.directRuntimeStatus || {};
  const runtime = status.directRuntime || {};
  const activation = status.activation || {};
  const modelSource = status.models?.source || "unknown";
  const profileId = status.diagnostics?.profileId || "";
  els.directRuntimeModeBadge.textContent = directRuntimeModeLabel(status);
  els.directRuntimeModeBadge.title = status.currentCodexLane || directRuntimeModeLabel(status);
  els.directRuntimeStatusBadge.textContent = state.directRuntimeLoading ? "loading runtime" : directRuntimeStatusLabel(status);
  els.directRuntimeStatusBadge.title = state.directRuntimeError ||
    (status.directTextOnly?.status === "eligible" || status.directTextOnly?.status === "enabled"
      ? status.directTextOnly?.labels?.detail
      : activation.state === "blocked" ? directActivationBlockedDetail(status) : activation.labels?.detail) ||
    runtime.reason ||
    directRuntimeStatusLabel(status);
  els.directModelSourceBadge.textContent = `models: ${modelSource}`;
  els.directModelSourceBadge.title = profileId ? `Profile: ${profileId}` : "Model source is not available.";
  if (els.codexRuntimeQuickStatus) {
    const currentPath = selectedDirectRuntimePath();
    const label = currentPath === "app-server" ? "App Server" : "Direct";
    els.codexRuntimeQuickStatus.textContent = state.directRuntimeLoading ? "runtime loading" : label;
    els.codexRuntimeQuickStatus.title = `${directRuntimeStatusLabel(status)}. Detailed direct diagnostics live in Project settings.`;
  }
  const contextMaintenance = directContextMaintenanceStatus(status);
  if (els.directContextPressureBadge) {
    els.directContextPressureBadge.textContent = `context ${formatDirectContextState(contextMaintenance.pressureState)}`;
    els.directContextPressureBadge.title = `Direct context pressure is status-only. Evidence: ${contextMaintenance.evidenceKeys[0] || "none"}.`;
  }
  if (els.directContextRouteBadge) {
    els.directContextRouteBadge.textContent = `route ${formatDirectContextState(contextMaintenance.routeKind)}`;
    els.directContextRouteBadge.title = contextMaintenance.routeBlocked
      ? `Route blocked by: ${formatDirectContextBlockers(contextMaintenance.blockers) || "missing/stale required artifact"}.`
      : "Route status is diagnostic only; no maintenance action is executed from this surface.";
  }
  if (els.directContextMemoryBadge) {
    const memoryDisplayState = contextMaintenance.memoryPointerState !== "none"
      ? contextMaintenance.memoryPointerState
      : contextMaintenance.memoryState;
    els.directContextMemoryBadge.textContent = `memory ${formatDirectContextState(memoryDisplayState)}`;
    els.directContextMemoryBadge.title = `Direct memory is app-private status. App-server memory citations observed: ${contextMaintenance.memoryCitationCount}; mode control observed: ${contextMaintenance.memoryModeObserved ? "yes" : "no"}.`;
  }
  if (els.directContextBatonBadge) {
    els.directContextBatonBadge.textContent = `baton ${formatDirectContextState(contextMaintenance.batonState)}`;
    els.directContextBatonBadge.title = `Baton requirement: ${formatDirectContextState(contextMaintenance.batonRequirement)}. Batons do not grant replay, approval, or continuation authority.`;
  }
  if (els.directContextOmissionBadge) {
    els.directContextOmissionBadge.textContent = `omission ${formatDirectContextState(contextMaintenance.omissionState)}`;
    els.directContextOmissionBadge.title = "Omission ledger status is display-only; missing required omission evidence blocks context rather than trimming silently.";
  }
  if (els.directContextProviderCompactBadge) {
    els.directContextProviderCompactBadge.textContent = `compact ${formatDirectContextState(contextMaintenance.providerCompactState)}`;
    els.directContextProviderCompactBadge.title = `Provider compact evidence: ${formatDirectContextState(contextMaintenance.providerCompactEvidenceState)}. Provider transport allowed: ${contextMaintenance.providerTransportAllowed ? "yes" : "no"}.`;
  }
  syncDirectRuntimePathControl(els.directRuntimePathSelect, els.directRuntimePathApplyButton, status, { persistDefault: true });
  syncDirectRuntimePathControl(els.codexRuntimeQuickSelect, els.codexRuntimeQuickApplyButton, status, { compact: true, persistDefault: true });
  if (els.directTextOnlyEnableButton) {
    const canUseTextOnlyAction = Boolean(activeProject()) && Boolean(bridge.selectDirectTextOnlyRuntime) && !state.directRuntimeLoading;
    const canEnableTextOnly = (status.directTextOnly?.status === "eligible" || status.directTextOnly?.status === "enabled") && canUseTextOnlyAction;
    els.directTextOnlyEnableButton.disabled = !canEnableTextOnly || status.directTextOnly?.status === "enabled";
    els.directTextOnlyEnableButton.title = canEnableTextOnly
      ? "Use Direct text fallback when the tool-capable Direct lane is unavailable."
      : `Check Direct fallback gates: ${directTextOnlyBlockedDetail(status)}`;
  }
  if (els.directExperimentalEnableButton) {
    const canUseEnableAction = Boolean(activeProject()) && Boolean(bridge.enableDirectExperimentalRuntime) && !state.directRuntimeLoading;
    const canEnable = (status.directImplementationLane?.canSelect === true || activation.state === "eligible") && canUseEnableAction;
    els.directExperimentalEnableButton.disabled = !canEnable;
    els.directExperimentalEnableButton.title = canEnable
      ? "Enable Direct for this project with tool-capable routing."
      : `Check Direct tool gates: ${directActivationBlockedDetail(status)}`;
  }
  if (els.directExperimentalRollbackButton) {
    const canRollback = activation.rollbackAvailable === true && !state.directRuntimeLoading;
    els.directExperimentalRollbackButton.disabled = !canRollback;
    els.directExperimentalRollbackButton.title = canRollback
      ? "Rollback this project to its previous Codex binding or legacy app-server."
      : "Direct experimental rollback is not available.";
  }
  if (els.directContextEvidence) {
    const actionFlags = [
      contextMaintenance.compactActionAllowed ? "compact action" : "",
      contextMaintenance.maintenanceExecutionAllowed ? "maintenance execution" : "",
      contextMaintenance.memoryEditorAllowed ? "memory editor" : "",
      contextMaintenance.memoryResetAllowed ? "memory reset" : "",
      contextMaintenance.providerTransportAllowed ? "provider compact transport" : "",
    ].filter(Boolean);
    if (actionFlags.length) {
      els.directContextEvidence.textContent = `WARNING: unexpected Direct context actionability exposed (${actionFlags.join(", ")}).`;
    } else if (contextMaintenance.contextCompactionCount || contextMaintenance.memoryCitationCount) {
      els.directContextEvidence.textContent = `Display-only; app-server sibling evidence observed (${contextMaintenance.contextCompactionCount} compaction, ${contextMaintenance.memoryCitationCount} memory).`;
    } else {
      els.directContextEvidence.textContent = "Context maintenance is status-only; no compact, memory reset, memory edit, provider compact, or hidden maintenance action is exposed.";
    }
  }
  renderDirectDiagnosticsStatus(status);
  renderDirectImplementationUiStatus();
}

function metaSessionHealthLabel(status = {}) {
  const health = String(status.health || "missing").replace(/_/g, " ");
  return state.directMetaSessionLoading ? "loading" : health;
}

function appendMetaSessionMetric(container, label, value, stateLabel = "") {
  const item = document.createElement("div");
  const title = document.createElement("span");
  title.textContent = label;
  const strong = document.createElement("strong");
  strong.textContent = value || "0";
  if (stateLabel) strong.title = stateLabel;
  item.append(title, strong);
  container.appendChild(item);
}

function renderDirectMetaSessionStatus() {
  if (!els.directMetaSessionHealthBadge) return;
  const status = state.directMetaSessionStatus || {};
  const healthLabel = metaSessionHealthLabel(status);
  els.directMetaSessionHealthBadge.textContent = healthLabel;
  els.directMetaSessionHealthBadge.title = state.directMetaSessionError || status.sourceDigest || healthLabel;
  if (els.directMetaSessionRefreshButton) {
    els.directMetaSessionRefreshButton.disabled = state.directMetaSessionLoading || !bridge.getDirectMetaSessionStatus;
    els.directMetaSessionRefreshButton.title = "Refresh the renderer-safe meta-session status projection.";
  }
  if (els.directMetaSessionSummary) {
    els.directMetaSessionSummary.textContent = "";
    const rows = Array.isArray(status.summaryRows) ? status.summaryRows.slice(0, 8) : [];
    if (!rows.length) {
      appendMetaSessionMetric(els.directMetaSessionSummary, "Session", "not loaded", "missing");
      appendMetaSessionMetric(els.directMetaSessionSummary, "Authority", "read-only", "non-authority projection");
    } else {
      for (const row of rows) appendMetaSessionMetric(els.directMetaSessionSummary, row.label || "State", row.value || "0", row.state || "");
    }
  }
  if (els.directMetaSessionRoutes) {
    els.directMetaSessionRoutes.textContent = "";
    const routes = status.routeSummary || {};
    appendMetaSessionMetric(els.directMetaSessionRoutes, "Recent proposed", String(routes.proposed || 0), "recent route proposal artifacts");
    appendMetaSessionMetric(els.directMetaSessionRoutes, "Recent accepted", String(routes.accepted || 0), "recent human-approved route artifacts");
    appendMetaSessionMetric(els.directMetaSessionRoutes, "Recent dispatched", String(routes.dispatched || 0), "recent dispatch artifacts; no runtime authority");
    appendMetaSessionMetric(els.directMetaSessionRoutes, "Recent blocked", String(routes.dispatchBlocked || 0), "recent stale dispatch blockers");
  }
  if (els.directMetaSessionEvidence) {
    const selected = status.selectedMetaSession?.metaSessionId || "none";
    const counts = status.counts || {};
    const blockers = status.attemptFailureSummary?.latestBlockerCodes || [];
    els.directMetaSessionEvidence.textContent = state.directMetaSessionError
      ? `Meta-session status unavailable: ${state.directMetaSessionError}`
      : `Projection ${selected} · ledger events ${counts.ledgerEvents || 0} · attempts ${counts.attemptFailures || 0} · latest blockers ${blockers.length ? blockers.join(", ") : "none"} · actionability=false.`;
  }
  renderDirectDiagnosticsStatus(state.directRuntimeStatus);
}

function renderDirectAuthControls() {
  if (!els.directAuthState) return;
  const settings = state.directAuthSettings || {};
  const status = state.directAuthStatus || settings.authStatus || null;
  const loading = state.directAuthLoading;
  const statusLabel = loading ? "loading" : directAuthStatusLabel(status);

  els.directAuthState.textContent = statusLabel;
  els.directAuthState.title = state.directAuthError || statusLabel;
  els.directAuthState.className = "status-dot";
  if (loading) els.directAuthState.classList.add("loading");
  if (status?.status === "authenticated") els.directAuthState.classList.add("loaded");
  if (["expired", "refresh_failed"].includes(status?.status) || state.directAuthError) els.directAuthState.classList.add("failed");

  const availableModes = Array.isArray(settings.availableStorageModes) && settings.availableStorageModes.length
    ? settings.availableStorageModes
    : ["file", "memory"];
  const currentMode = settings.storageMode || status?.storageMode || "file";
  if (els.directAuthStorageModeSelect) {
    const signature = directAuthModeSignature(availableModes);
    if (els.directAuthStorageModeSelect.dataset.modeSignature !== signature) {
      els.directAuthStorageModeSelect.innerHTML = "";
      for (const mode of availableModes) {
        const option = document.createElement("option");
        option.value = mode;
        option.textContent = mode === "file" ? "Persistent file" : "Memory only";
        els.directAuthStorageModeSelect.appendChild(option);
      }
      els.directAuthStorageModeSelect.dataset.modeSignature = signature;
    }
    if (document.activeElement !== els.directAuthStorageModeSelect) {
      els.directAuthStorageModeSelect.value = currentMode;
    }
    els.directAuthStorageModeSelect.disabled = loading;
  }

  els.directAuthStorageBadge.textContent = currentMode === "memory" ? "memory-only store" : "persistent file store";
  els.directAuthExpiryBadge.textContent = directAuthExpiryLabel(status);
  els.directAuthRefreshButton.disabled = loading;
  els.directAuthLoginButton.disabled = loading || !settings.liveOAuthAvailable;
  els.directAuthLoginButton.title = settings.liveOAuthAvailable ? "Start direct auth login." : "Live OAuth is not implemented yet.";
  els.directAuthLogoutButton.disabled = loading || (!status?.hasAccessToken && !status?.hasRefreshToken && status?.status !== "refresh_failed");
  const codex = activeProject()?.surfaceBinding?.codex || {};
  const codexLane = state.directRuntimeStatus?.currentCodexLane || (codex.mode === "managed" ? "legacy app-server bridge" : codex.mode || "unbound");
  els.directAuthEvidence.textContent = state.directAuthError
    ? "Direct auth status unavailable. No raw tokens or paths exposed to renderer."
    : `Codex lane: ${codexLane} · renderer sees redacted auth only · tokens exposed: ${status?.rawTokensExposed ? "yes" : "no"} · paths exposed: ${settings.storagePathExposed ? "yes" : "no"}`;
  renderDirectRuntimeStatus();
  renderDirectMetaSessionStatus();
}

function agentStatusLabel(agent = {}) {
  const status = String(agent.status || agent.activityStatus || agent.hydrationStatus || "unknown");
  return status.replace(/_/g, " ");
}

function subAgentRuntimeSpec(agent = {}) {
  const model = String(agent?.model || "").trim();
  const effort = String(agent?.reasoningEffort || agent?.reasoning_effort || "").trim();
  if (model && effort) return `${model} · ${effort}`;
  if (model) return model;
  if (effort) return `effort ${effort}`;
  return "";
}

function subAgentThreadId(agent = {}) {
  return String(agent.threadId || agent.key?.threadId || "").trim();
}

function shortSubAgentId(threadId) {
  const id = String(threadId || "").trim();
  return id.length <= 8 ? id : id.slice(0, 8);
}

function subAgentBaseTabLabel(agent = {}) {
  const id = subAgentThreadId(agent);
  return String(agent.nickname || agent.label || agent.role || "").trim() || `Agent ${shortSubAgentId(id)}`;
}

function subAgentLabelCounts(agents = []) {
  const counts = new Map();
  for (const agent of agents) {
    const base = subAgentBaseTabLabel(agent);
    counts.set(base, (counts.get(base) || 0) + 1);
  }
  return counts;
}

function subAgentTabLabel(agent = {}, labelCounts = new Map()) {
  const id = subAgentThreadId(agent);
  const base = subAgentBaseTabLabel(agent);
  if ((labelCounts.get(base) || 0) > 1 && id) return `${base} · ${shortSubAgentId(id)}`;
  return base || "Unknown agent";
}

function subAgentIsActive(agent = {}) {
  return ["running", "pending", "inProgress"].includes(String(agent.status || "")) ||
    ["active", "responding", "waiting"].includes(String(agent.activityStatus || ""));
}

function preferredSubAgentThreadId(agents = []) {
  const active = agents.find(subAgentIsActive);
  return subAgentThreadId(active || agents[0] || "");
}

function reconcileSelectedSubAgent(agents = [], preferredThreadId = "") {
  const ids = new Set(agents.map(subAgentThreadId).filter(Boolean));
  const preferred = String(preferredThreadId || "").trim();
  if (preferred && ids.has(preferred)) {
    state.selectedSubAgentThreadId = preferred;
    return preferred;
  }
  const selectedWasOperatorPinned = ["operator", "agent_chip", "restore"].includes(state.selectedSubAgentSelectedBy);
  if (selectedWasOperatorPinned && state.selectedSubAgentThreadId && ids.has(state.selectedSubAgentThreadId)) {
    return state.selectedSubAgentThreadId;
  }
  state.selectedSubAgentThreadId = preferredSubAgentThreadId(agents);
  if (state.selectedSubAgentThreadId && !state.selectedSubAgentSelectedBy) {
    state.selectedSubAgentSelectedBy = "auto_first_active";
  }
  return state.selectedSubAgentThreadId;
}

function selectSubAgentTab(threadId, selectedBy = "operator") {
  const id = String(threadId || "").trim();
  if (!id) return;
  state.selectedSubAgentThreadId = id;
  state.selectedSubAgentSelectedBy = selectedBy;
  if (selectedBy === "operator") state.selectedSubAgentScope = { mode: "full", turnKey: "" };
  renderSubAgentsPanel();
}

function setSubAgentScopeMode(mode) {
  const selectedAgent = Array.isArray(state.subAgentGraph?.agents)
    ? state.subAgentGraph.agents.find((agent) => subAgentThreadId(agent) === state.selectedSubAgentThreadId)
    : null;
  const fallbackTurnKey = firstSubAgentTurnKey(selectedAgent);
  const turnKey = state.selectedSubAgentScope?.turnKey || fallbackTurnKey;
  const next = mode === "turn" && turnKey
    ? "turn"
    : "full";
  state.selectedSubAgentScope = {
    mode: next,
    turnKey,
  };
  renderSubAgentsPanel();
}

function sortedSubAgentTurnKeys(turnScopes = {}) {
  return Object.keys(turnScopes).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

function firstSubAgentTurnKey(agent = {}) {
  const keys = sortedSubAgentTurnKeys(agent?.turnScopes || {});
  return keys[0] || "";
}

function selectSubAgentTurnScope(turnKey) {
  const key = String(turnKey || "").trim();
  if (!key) return;
  state.selectedSubAgentScope = { mode: "turn", turnKey: key };
  renderSubAgentsPanel();
}

function renderSubAgentsPanel() {
  if (!els.subAgentsSlot) return;
  const graph = state.subAgentGraph;
  const agents = Array.isArray(graph?.agents) ? graph.agents : [];
  if (els.subAgentCountBadge) els.subAgentCountBadge.textContent = String(agents.length);
  els.subAgentsSlot.innerHTML = "";
  if (!agents.length) {
    const empty = document.createElement("div");
    empty.className = "sub-agents-empty";
    empty.innerHTML = `
      <p class="eyebrow">Sub-agent workstreams</p>
      <strong>No active sub-agents for this Codex thread.</strong>
      <span>When Codex spawns or messages a sub-agent, its read-only transcript appears here.</span>
    `;
    els.subAgentsSlot.appendChild(empty);
    return;
  }

  const selectedId = reconcileSelectedSubAgent(agents);
  const selectedAgent = agents.find((agent) => subAgentThreadId(agent) === selectedId) || agents[0];
  const labelCounts = subAgentLabelCounts(agents);
  const panel = document.createElement("div");
  panel.className = "sub-agent-panel";

  const tabStrip = document.createElement("div");
  tabStrip.className = "sub-agent-tabstrip";
  tabStrip.setAttribute("role", "tablist");
  tabStrip.setAttribute("aria-label", "Sub-agent conversations");
  for (const agent of agents) {
    const id = subAgentThreadId(agent);
    const selected = id && id === selectedId;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `sub-agent-tab${selected ? " active" : ""}`;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", selected ? "true" : "false");
    button.dataset.agentThreadId = id;
    const labelText = subAgentTabLabel(agent, labelCounts);
    const runtimeSpec = subAgentRuntimeSpec(agent);
    button.title = [
      labelText,
      runtimeSpec,
      id,
    ].filter(Boolean).join(" · ");
    button.addEventListener("click", () => selectSubAgentTab(id, "operator"));

    const label = document.createElement("span");
    label.className = "sub-agent-tab-label";
    label.textContent = labelText;
    const status = document.createElement("span");
    status.className = `sub-agent-tab-status${subAgentIsActive(agent) ? " active" : ""}`;
    status.textContent = agentStatusLabel(agent);
    button.append(label, status);
    if (runtimeSpec) {
      const runtime = document.createElement("span");
      runtime.className = "sub-agent-tab-runtime";
      runtime.textContent = runtimeSpec;
      button.appendChild(runtime);
    }
    tabStrip.appendChild(button);
  }
  panel.appendChild(tabStrip);

  const card = document.createElement("article");
  card.className = "sub-agent-card selected";
  card.dataset.agentThreadId = subAgentThreadId(selectedAgent);

  const header = document.createElement("header");
  header.className = "sub-agent-card-header";
  const title = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Selected sub-agent";
  const heading = document.createElement("h3");
  heading.textContent = subAgentTabLabel(selectedAgent, labelCounts);
  const thread = document.createElement("span");
  thread.className = "muted mono";
  thread.textContent = subAgentThreadId(selectedAgent) || "unknown thread";
  title.append(eyebrow, heading, thread);
  const runtimeSpec = subAgentRuntimeSpec(selectedAgent);
  if (runtimeSpec) {
    const runtime = document.createElement("span");
    runtime.className = "sub-agent-runtime muted";
    runtime.textContent = `Worker runtime: ${runtimeSpec}`;
    title.appendChild(runtime);
  }
  const status = document.createElement("span");
  status.className = `status-dot ${String(selectedAgent?.status || "") === "failed" ? "failed" : "loaded"}`;
  status.textContent = agentStatusLabel(selectedAgent);
  header.append(title, status);

  const action = document.createElement("p");
  action.className = "sub-agent-action";
  const lastAction = selectedAgent?.lastAction?.tool
    ? `${selectedAgent.lastAction.tool} · ${selectedAgent.lastAction.status || "unknown"}`
    : "discovered";
  action.textContent = selectedAgent?.promptPreview ? `${lastAction}: ${selectedAgent.promptPreview}` : lastAction;

  const transcript = document.createElement("div");
  transcript.className = "sub-agent-transcript";
  const messages = Array.isArray(selectedAgent?.transcript) ? selectedAgent.transcript : [];
  const selectedScope = state.selectedSubAgentScope || { mode: "full", turnKey: "" };
  const turnScopes = selectedAgent?.turnScopes && typeof selectedAgent.turnScopes === "object"
    ? selectedAgent.turnScopes
    : {};
  const turnKeys = sortedSubAgentTurnKeys(turnScopes);
  const selectedTurnKey = selectedScope.turnKey && turnScopes[selectedScope.turnKey]
    ? selectedScope.turnKey
    : firstSubAgentTurnKey(selectedAgent);
  if (selectedTurnKey && selectedScope.turnKey !== selectedTurnKey) {
    state.selectedSubAgentScope = { ...selectedScope, turnKey: selectedTurnKey };
  }
  const showTurnMode = state.selectedSubAgentScope?.mode === "turn";
  const turnScope = showTurnMode && selectedTurnKey
    ? turnScopes[selectedTurnKey]
    : null;
  const showTurnScope = Boolean(turnScope);
  if (state.selectedSubAgentScope?.mode === "turn" && !turnScope) {
    state.selectedSubAgentScope = { mode: "full", turnKey: selectedTurnKey || "" };
  }

  const scopeControls = document.createElement("div");
  scopeControls.className = "sub-agent-scope-controls";
  const turnButton = document.createElement("button");
  turnButton.type = "button";
  turnButton.className = `sub-agent-scope-button${showTurnScope ? " active" : ""}`;
  turnButton.textContent = "Turn activity";
  turnButton.disabled = !selectedTurnKey;
  turnButton.title = selectedTurnKey ? "Show parent-side activity from the selected main turn" : "No turn-scoped activity is available";
  turnButton.addEventListener("click", () => setSubAgentScopeMode("turn"));
  const fullButton = document.createElement("button");
  fullButton.type = "button";
  fullButton.className = `sub-agent-scope-button${!showTurnScope ? " active" : ""}`;
  fullButton.textContent = "Full history";
  fullButton.title = "Show the full sub-agent transcript history";
  fullButton.addEventListener("click", () => setSubAgentScopeMode("full"));
  scopeControls.append(turnButton, fullButton);
  transcript.appendChild(scopeControls);

  if (turnKeys.length > 1) {
    const turnSelector = document.createElement("div");
    turnSelector.className = "sub-agent-turn-selector";
    const selectorLabel = document.createElement("span");
    selectorLabel.textContent = "Main turns";
    turnSelector.appendChild(selectorLabel);
    for (let index = 0; index < turnKeys.length; index += 1) {
      const key = turnKeys[index];
      const button = document.createElement("button");
      button.type = "button";
      button.className = `sub-agent-turn-chip${key === selectedTurnKey ? " active" : ""}`;
      button.textContent = `Turn ${index + 1}`;
      button.title = key;
      button.addEventListener("click", () => selectSubAgentTurnScope(key));
      turnSelector.appendChild(button);
    }
    transcript.appendChild(turnSelector);
  }

  if (showTurnScope) {
    const scopeCard = document.createElement("section");
    scopeCard.className = "sub-agent-turn-scope";
    const scopeTitle = document.createElement("p");
    scopeTitle.className = "eyebrow";
    scopeTitle.textContent = `Main-turn activity · ${selectedTurnKey}`;
    scopeCard.appendChild(scopeTitle);
    const events = Array.isArray(turnScope.events) ? turnScope.events : [];
    if (!events.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "No parent-side activity was recorded for this agent in the selected turn.";
      scopeCard.appendChild(empty);
    } else {
      const list = document.createElement("div");
      list.className = "sub-agent-turn-events";
      for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
        const event = events[eventIndex];
        const row = document.createElement("div");
        row.className = `sub-agent-turn-event status-${String(event.status || "unknown").replace(/[^a-z0-9_-]/gi, "-")}`;
        const label = document.createElement("strong");
        label.textContent = String(event.label || event.kind || "Sub-agent event").replace(/_/g, " ");
        const meta = document.createElement("span");
        const runtime = subAgentRuntimeSpec(event);
        meta.textContent = [
          event.status ? `status: ${String(event.status).replace(/_/g, " ")}` : "",
          event.actionStatus ? `action: ${String(event.actionStatus).replace(/_/g, " ")}` : "",
          runtime ? `runtime: ${runtime}` : "",
        ].filter(Boolean).join(" · ");
        row.append(label, meta);
        if (event.promptPreview || event.detail) {
          const detail = document.createElement("p");
          const detailKey = [
            subAgentThreadId(selectedAgent) || "unknown-agent",
            selectedTurnKey,
            `event_${eventIndex}`,
          ].join(":");
          detail.className = "sub-agent-turn-event-detail";
          detail.textContent = event.promptPreview || event.detail;
          row.appendChild(detail);
          configureSubAgentMessagePreview(row, detail, detailKey);
        }
        list.appendChild(row);
      }
      scopeCard.appendChild(list);
    }
    transcript.appendChild(scopeCard);
  } else if (!messages.length) {
    const pending = document.createElement("div");
    pending.className = "sub-agent-message system";
    pending.textContent = selectedAgent?.hydrationStatus === "failed"
      ? "Sub-agent transcript unavailable."
      : "Transcript hydration pending.";
    transcript.appendChild(pending);
  } else {
    for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
      const message = messages[messageIndex];
      const item = document.createElement("section");
      item.className = `sub-agent-message ${message.role || "system"}`;
      const previewKey = subAgentMessagePreviewKey(selectedAgent, message, messageIndex);
      item.dataset.messagePreviewKey = previewKey;
      const label = document.createElement("p");
      label.className = "eyebrow";
      label.textContent = message.title || message.role || "Message";
      const body = document.createElement("div");
      body.className = "sub-agent-message-body";
      renderSubAgentMessageBody(body, message, {
        threadId: subAgentThreadId(selectedAgent),
        threadTitle: subAgentTabLabel(selectedAgent, labelCounts),
      });
      item.append(label, body);
      configureSubAgentMessagePreview(item, body, previewKey);
      transcript.appendChild(item);
    }
  }

  card.append(header, action, transcript);
  panel.appendChild(card);
  els.subAgentsSlot.appendChild(panel);
}

function renderRightPlaneTabs() {
  const active = state.activeRightTab === "subagents" ? "subagents" : "chatgpt";
  for (const [button, slot, tab] of [
    [els.rightChatgptTabButton, els.chatgptSlot, "chatgpt"],
    [els.rightSubAgentsTabButton, els.subAgentsSlot, "subagents"],
  ]) {
    if (!button || !slot) continue;
    const selected = active === tab;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", selected ? "true" : "false");
    slot.classList.toggle("active", selected);
    slot.hidden = !selected;
  }
  renderSubAgentsPanel();
}

function setRightPlaneTab(tab, options = {}) {
  const next = tab === "subagents" ? "subagents" : "chatgpt";
  if (!options.auto) state.rightPlanePinnedTab = next;
  if (state.activeRightTab === next) {
    renderRightPlaneTabs();
    scheduleResizeBurst();
    return;
  }
  state.activeRightTab = next;
  renderRightPlaneTabs();
  scheduleResizeBurst();
}

function handleCodexAgentGraph(event) {
  const project = activeProject();
  if (!project || String(event.projectId || project.id) !== project.id) return;
  state.subAgentGraph = {
    ...event,
    agents: Array.isArray(event.agents) ? event.agents : [],
  };
  reconcileSelectedSubAgent(state.subAgentGraph.agents);
  renderRightPlaneTabs();
  const hasActiveAgents = state.subAgentGraph.agents.some(subAgentIsActive);
  if (hasActiveAgents && !state.rightPlanePinnedTab && state.activeRightTab === "chatgpt") {
    setRightPlaneTab("subagents", { auto: true });
  }
}

function handleCodexFocusSubAgent(event) {
  const project = activeProject();
  if (!project || String(event.projectId || project.id) !== project.id) return;
  const receiverThreadId = String(event.receiverThreadId || "").trim();
  if (!receiverThreadId) return;
  const primaryThreadId = String(event.primaryThreadId || "");
  if (state.subAgentGraph?.primaryThreadId && primaryThreadId && String(state.subAgentGraph.primaryThreadId) !== primaryThreadId) return;
  state.selectedSubAgentThreadId = receiverThreadId;
  state.selectedSubAgentSelectedBy = "agent_chip";
  state.selectedSubAgentScope = event.scopeMode === "turn" && event.turnKey
    ? { mode: "turn", turnKey: String(event.turnKey) }
    : { mode: "full", turnKey: "" };
  setRightPlaneTab("subagents");
  renderSubAgentsPanel();
  setLastEvent(`Opened sub-agent: ${event.label || receiverThreadId}.`);
}

function renderMiddleTabs() {
  const tabs = [
    [els.overviewTabButton, els.overviewTabPanel, "overview"],
    [els.projectTabButton, els.projectTabPanel, "project"],
    [els.threadsTabButton, els.threadsTabPanel, "threads"],
    [els.importsTabButton, els.importsTabPanel, "imports"],
    [els.analyticsTabButton, els.analyticsTabPanel, "analytics"],
    [els.filesTabButton, els.filesTabPanel, "files"],
    [els.webTabButton, els.webTabPanel, "web"],
  ];
  for (const [button, panel, tab] of tabs) {
    const active = state.activeMiddleTab === tab;
    button.classList.toggle("active", active);
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  }
  renderMiddleFileTab();
  renderMiddleWebTab();
}

function middleWebSourceLabel(source) {
  if (!source?.surface) return "";
  const labels = { codex: "Codex", chatgpt: "ChatGPT", shell: "Shell" };
  const surface = labels[source.surface] || source.surface;
  const thread = source.threadTitle || source.threadId || "";
  return thread ? `Opened from: ${surface} · ${thread}` : `Opened from: ${surface}`;
}

function setMiddleWebViewMode(mode) {
  state.middleWebViewMode = mode === "history" ? "history" : "browser";
  renderMiddleWebTab();
  scheduleResizeBurst();
}

function renderMiddleWebHistory() {
  if (!els.webHistoryList) return;
  const entries = Array.isArray(state.middleWebHistory) ? state.middleWebHistory : [];
  els.webHistoryCount.textContent = String(entries.length);
  els.webPruneHistoryButton.disabled = entries.length === 0;
  els.webHistoryList.innerHTML = "";
  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "web-history-empty";
    empty.innerHTML = `
      <p class="eyebrow">No history yet</p>
      <strong>Open links from Codex or ChatGPT to build quick reopen history.</strong>
      <span class="muted">Blocked or failed navigations are not added.</span>
    `;
    els.webHistoryList.appendChild(empty);
    return;
  }
  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = "web-history-item";
    row.innerHTML = `
      <button class="web-history-open" type="button">
        <strong class="truncate"></strong>
        <span class="mono muted truncate"></span>
        <span class="muted web-history-meta"></span>
      </button>
      <button class="ghost small web-history-prune" type="button">Prune</button>
    `;
    row.querySelector("strong").textContent = entry.title || entry.origin || entry.displayUrl || "Untitled page";
    row.querySelector("span.mono").textContent = entry.displayUrl || "";
    row.querySelector("span.mono").title = entry.displayUrl || "";
    const meta = [
      entry.origin || "",
      entry.lastOpenedAt ? `opened ${formatTime(entry.lastOpenedAt)}` : "",
      Number(entry.visitCount) > 1 ? `${entry.visitCount} visits` : "",
      middleWebSourceLabel(entry.lastSource),
    ].filter(Boolean).join(" · ");
    row.querySelector(".web-history-meta").textContent = meta;
    row.querySelector(".web-history-open").addEventListener("click", () => reopenMiddleWebHistoryEntry(entry));
    row.querySelector(".web-history-prune").addEventListener("click", () => pruneMiddleWebHistoryEntry(entry.id));
    els.webHistoryList.appendChild(row);
  }
}

function renderMiddleWebTab() {
  const web = state.middleWeb || {};
  const hasPage = Boolean(web.hasPage || web.displayUrl || web.origin);
  const blocked = Boolean(web.lastError);
  const historyMode = state.middleWebViewMode === "history";
  els.webTitle.textContent = blocked
    ? web.lastError
    : web.title || (hasPage ? "Loading web page…" : "No page open");
  els.webTitle.title = els.webTitle.textContent;
  els.webOrigin.textContent = web.origin || web.displayUrl || "Links clicked from Codex or ChatGPT will open here.";
  els.webOrigin.title = web.displayUrl || web.origin || "";
  els.webSource.textContent = middleWebSourceLabel(web.lastSource);
  els.webSource.title = els.webSource.textContent;
  els.webEmptyState.hidden = historyMode || hasPage;
  els.webHistoryPanel.hidden = !historyMode;
  els.webEmptyState.classList.toggle("web-error-state", blocked);
  if (blocked) {
    els.webEmptyState.querySelector("strong").textContent = web.lastError;
    els.webEmptyState.querySelector("span").textContent = web.displayUrl || web.origin || "Navigation was blocked by the workspace Web policy.";
  } else {
    els.webEmptyState.querySelector("strong").textContent = "No page open yet.";
    els.webEmptyState.querySelector("span").textContent = "Links clicked from Codex or ChatGPT will open here.";
  }
  els.webBackButton.disabled = !web.canGoBack;
  els.webForwardButton.disabled = !web.canGoForward;
  els.webReloadButton.textContent = web.loading ? "Stop" : "Reload";
  els.webReloadButton.disabled = !hasPage;
  els.webCopyUrlButton.disabled = !hasPage;
  els.webOpenExternalButton.disabled = !hasPage;
  els.webBrowserTabButton.classList.toggle("active", !historyMode);
  els.webHistoryTabButton.classList.toggle("active", historyMode);
  renderMiddleWebHistory();
}

function middleFileSourceLabel(file) {
  const source = file?.source || {};
  const labels = { codex: "Codex", chatgpt: "ChatGPT", shell: "Shell" };
  if (source.surface) {
    const surface = labels[source.surface] || source.surface;
    const thread = source.threadTitle || source.threadId || "";
    return thread ? `Opened from: ${surface} · ${thread}` : `Opened from: ${surface}`;
  }
  if (file?.sourceKind === "chatgpt_download") return "Opened from: ChatGPT download · imported project copy";
  if (file?.sourceKind === "chatgpt_download_host") return "Opened from: ChatGPT download";
  if (file?.sourceKind === "project_file") return "Opened from: project file reference";
  return "";
}

function middleFileLooksMarkdown(file) {
  const name = String(file?.relPath || file?.displayName || "").toLowerCase();
  const mime = String(file?.mimeType || "").toLowerCase();
  return mime === "text/markdown" || /\.(md|markdown|mdown)$/.test(name);
}

function renderMiddleFileMessage(className, eyebrow, title, detail) {
  els.middleFileContent.className = `middle-file-content ${className}`;
  els.middleFileContent.textContent = "";
  const wrapper = document.createElement("div");
  wrapper.className = "file-empty-state";
  const label = document.createElement("p");
  label.className = "eyebrow";
  label.textContent = eyebrow;
  const strong = document.createElement("strong");
  strong.textContent = title;
  const span = document.createElement("span");
  span.textContent = detail;
  wrapper.append(label, strong, span);
  els.middleFileContent.appendChild(wrapper);
}

function middleFileStateFromEvent(event = {}) {
  const next = {
    status: "idle",
    sourceKind: "",
    projectId: "",
    relPath: "",
    displayName: "",
    mimeType: "",
    size: 0,
    truncated: false,
    binary: false,
    text: "",
    error: "",
    workspaceLabel: "",
    openedAt: "",
    source: null,
    ...event,
  };
  delete next.type;
  delete next.fileEventType;
  return next;
}

function renderMiddleFileTab() {
  const file = state.middleFile || {};
  const status = file.status || "idle";
  const hasFile = status && status !== "idle";
  const title = file.displayName || file.relPath || (status === "loading" ? "Opening file..." : "No file open");
  els.middleFileTitle.textContent = title;
  els.middleFileTitle.title = file.relPath || file.displayName || "";
  const metaParts = [
    file.relPath || "",
    Number.isFinite(Number(file.size)) && Number(file.size) > 0 ? formatBytes(file.size) : "",
    file.truncated ? `first ${formatBytes(file.limit || 0)}` : "",
    file.mimeType || "",
    file.workspaceLabel || "",
  ].filter(Boolean);
  els.middleFileMeta.textContent = metaParts.length ? metaParts.join(" · ") : "Open Codex file references or ChatGPT downloads here.";
  els.middleFileMeta.title = els.middleFileMeta.textContent;
  els.middleFileSource.textContent = middleFileSourceLabel(file);
  els.middleFileSource.title = els.middleFileSource.textContent;
  els.middleFileCopyRefButton.disabled = !hasFile || status === "loading" || (!file.relPath && !file.displayName);
  els.middleFileRevealButton.disabled = !file.projectId || !file.relPath || status === "loading";

  els.middleFileContent.className = "middle-file-content";
  els.middleFileContent.textContent = "";
  if (status === "idle") {
    renderMiddleFileMessage(
      "is-empty",
      "Read-only file viewport",
      "No file open yet.",
      "Codex file references and ChatGPT downloads can be projected here without making them transcript evidence.",
    );
    return;
  }
  if (status === "loading") {
    renderMiddleFileMessage("is-empty", "Opening file", title, "Reading a safe text preview.");
    return;
  }
  if (status === "failed") {
    renderMiddleFileMessage("is-error", "File open failed", title, file.error || "The file could not be opened.");
    return;
  }
  if (file.binary || status === "unsupported") {
    renderMiddleFileMessage("is-binary", "Unsupported preview", title, "Binary or non-text file preview is intentionally disabled in the middle Files tab.");
    return;
  }

  const text = String(file.text || "");
  if (middleFileLooksMarkdown(file)) {
    renderMiddleFileMarkdown(els.middleFileContent, text, {
      threadTitle: file.displayName || file.relPath || "File viewer",
    });
    return;
  }
  const pre = document.createElement("pre");
  pre.textContent = `${file.truncated ? "/* Preview truncated for responsiveness. */\n\n" : ""}${text}`;
  els.middleFileContent.appendChild(pre);
}

async function copyMiddleFileRef() {
  const file = state.middleFile || {};
  const text = file.relPath || file.displayName || "";
  if (!text || !bridge.copyText) return;
  await bridge.copyText(text);
  setLastEvent(`Copied file reference: ${text}`);
}

async function revealMiddleFile() {
  const file = state.middleFile || {};
  if (!file.projectId || !file.relPath || !bridge.revealProjectFile) return;
  try {
    const result = await bridge.revealProjectFile(file.projectId, file.relPath);
    if (result?.opened) setLastEvent(`Revealed ${file.relPath}.`);
    else setLastEvent(`Copied file path: ${file.relPath}.`);
  } catch (error) {
    setLastEvent(`File reveal failed: ${error.message}`);
  }
}

async function loadMiddleWebHistory() {
  if (!bridge.middleWebHistory) return;
  try {
    const result = await bridge.middleWebHistory();
    state.middleWebHistory = Array.isArray(result?.entries) ? result.entries : [];
    renderMiddleWebTab();
  } catch (error) {
    setLastEvent(`Web history load failed: ${error.message}`);
  }
}

async function reopenMiddleWebHistoryEntry(entry) {
  const id = String(entry?.id || "");
  if (!id) return;
  setMiddleWebViewMode("browser");
  try {
    const result = await bridge.middleWebOpenHistoryEntry({
      id,
      userGesture: true,
    });
    if (!result?.ok) setLastEvent(`Web history reopen blocked: ${result?.error || "unknown error"}`);
  } catch (error) {
    setLastEvent(`Web history reopen failed: ${error.message}`);
  }
}

async function pruneMiddleWebHistoryEntry(id) {
  if (!bridge.middleWebPruneHistory) return;
  try {
    const result = await bridge.middleWebPruneHistory({ id });
    state.middleWebHistory = Array.isArray(result?.entries) ? result.entries : state.middleWebHistory.filter((entry) => entry.id !== id);
    renderMiddleWebTab();
    setLastEvent("Pruned Web history entry.");
  } catch (error) {
    setLastEvent(`Web history prune failed: ${error.message}`);
  }
}

async function pruneAllMiddleWebHistory() {
  if (!bridge.middleWebPruneHistory) return;
  try {
    const result = await bridge.middleWebPruneHistory({ clearAll: true });
    state.middleWebHistory = Array.isArray(result?.entries) ? result.entries : [];
    renderMiddleWebTab();
    setLastEvent("Pruned Web history.");
  } catch (error) {
    setLastEvent(`Web history prune failed: ${error.message}`);
  }
}

function renderProjectList() {
  const config = state.config;
  if (!config) return;
  els.projectCount.textContent = String(config.projects.length);
  els.projectList.innerHTML = "";
  for (const project of config.projects) {
    const current = activeThread(project);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `project-item${project.id === config.selectedProjectId ? " active" : ""}`;
    button.innerHTML = `
      <strong></strong>
      <span class="truncate mono"></span>
      <span class="truncate"></span>
    `;
    button.querySelector("strong").textContent = project.name;
    button.querySelectorAll("span")[0].textContent = shortPath(workspaceSummary(project));
    button.querySelectorAll("span")[1].textContent = `${chatThreads(project).filter((thread) => !thread.archived).length} ChatGPT threads · ${current?.title || "No active thread"}`;
    button.addEventListener("click", () => selectProject(project.id));
    els.projectList.appendChild(button);
  }
}

function renderSelectedProject() {
  const project = activeProject();
  if (!project) return;
  const codex = project.surfaceBinding.codex;
  const workspace = projectWorkspace(project);
  const workspaceText = workspaceSummary(project);
  const currentThread = activeThread(project);
  const nonArchivedThreads = chatThreads(project).filter((thread) => !thread.archived);

  els.selectedProjectName.textContent = project.name;
  els.selectedProjectPill.textContent = project.name;
  els.selectedProjectPill.title = workspaceText;
  els.repoPath.textContent = project.repoPath;
  els.repoPath.title = project.repoPath;
  els.workspacePath.textContent = workspaceText;
  els.workspacePath.title = workspaceText;
  els.backendStatus.textContent = backendStatusText(project);
  els.backendStatus.title = backendStatusText(project);
  const codexDetails = codex.mode === "managed"
    ? `managed/${codex.runtime || "auto"}${codex.model ? ` · ${codex.model}` : ""}`
    : codex.mode;
  els.bindingStatus.textContent = `${workspace.kind.toUpperCase()} · ${codexDetails} Codex · ${nonArchivedThreads.length} ChatGPT threads`;
  els.activeThreadStatus.textContent = currentThread ? `Active ${roleLabel(currentThread.role)} · ${currentThread.title}` : "No active ChatGPT thread";
  els.activeThreadStatus.title = currentThread?.url || "";
  const binding = activeLaneBinding(project);
  const linkedCodex = activeCodexThreadForHeader(project);
  const codexTitle = linkedCodex?.title || binding?.codexThreadRef?.titleSnapshot || "Codex implementation companion";
  els.codexSurfaceTitle.textContent = codexTitle;
  els.codexSurfaceTitle.title = binding?.codexThreadRef?.threadId || "";
  els.chatgptSurfaceTitle.textContent = currentThread?.title || "ChatGPT review/world-model";
  els.chatgptSurfaceTitle.title = currentThread?.url || "";
  els.watchedRulesPreview.textContent = (project.flowProfile?.watchedFilePatterns || []).join("\n");
  els.returnHeaderPreview.textContent = project.flowProfile?.returnHeader || "GPT feedback";
}

function renderThreadDeck() {
  const project = activeProject();
  if (!project) return;
  const active = activeThread(project);
  const threads = sortedThreads(project, true);
  const activeCount = threads.filter((thread) => !thread.archived).length;
  els.threadCount.textContent = String(activeCount);
  els.threadDeck.innerHTML = "";

  if (!threads.length) {
    els.threadDeck.innerHTML = `<div class="empty-state">No ChatGPT threads are bound to this project yet.</div>`;
    return;
  }

  for (const thread of threads) {
    const row = document.createElement("div");
    row.className = `thread-item${thread.id === active?.id ? " active" : ""}${thread.archived ? " archived" : ""}`;
    row.innerHTML = `
      <button class="thread-main" type="button">
        <span class="thread-topline">
          <span class="role-badge"></span>
          <strong class="truncate"></strong>
        </span>
        <span class="thread-meta truncate"></span>
        <span class="thread-notes truncate"></span>
      </button>
      <div class="thread-actions">
        <button class="ghost small open-thread" type="button">Open</button>
        <button class="ghost small edit-thread" type="button">Edit</button>
      </div>
    `;
    row.querySelector(".role-badge").textContent = `${thread.isPrimary ? "★ " : ""}${roleLabel(thread.role)}${thread.pinned ? " · pinned" : ""}${thread.archived ? " · archived" : ""}`;
    row.querySelector("strong").textContent = thread.title;
    row.querySelector(".thread-meta").textContent = shortPath(thread.url);
    row.querySelector(".thread-notes").textContent = thread.notes || (thread.lastOpenedAt ? `Last opened ${formatTime(thread.lastOpenedAt)}` : "No notes");
    row.querySelector(".thread-main").addEventListener("click", () => selectThread(thread.id));
    row.querySelector(".open-thread").addEventListener("click", () => selectThread(thread.id));
    row.querySelector(".edit-thread").addEventListener("click", () => openThreadDrawer("edit", thread.id));
    els.threadDeck.appendChild(row);
  }
}

function resetBindingEditor() {
  state.selectedBindingId = "";
  els.bindingLaneInput.value = "review";
  els.bindingLabelInput.value = "";
  els.bindingDefaultLaneInput.checked = false;
  els.bindingOpenOnProjectInput.checked = false;
}

function populateBindingEditor(binding) {
  if (!binding) {
    resetBindingEditor();
    return;
  }
  state.selectedBindingId = binding.id;
  els.bindingLaneInput.value = binding.lane || "review";
  els.bindingLabelInput.value = binding.label || "";
  els.bindingDefaultLaneInput.checked = Boolean(binding.isDefaultForLane);
  els.bindingOpenOnProjectInput.checked = Boolean(binding.openOnProjectActivate);
  state.selectedCodexThreadId = binding.codexThreadRef?.threadId || "";
  state.selectedProjectChatThreadId = binding.chatThreadId || "";
}

function renderLaneBindingList() {
  const project = activeProject();
  if (!project) return;
  const bindings = laneBindings(project);
  els.laneBindingList.innerHTML = "";
  if (!bindings.length) {
    els.laneBindingList.innerHTML = `<div class="empty-state">No lane bindings yet. Link a Codex thread and a project-attached ChatGPT thread to create one.</div>`;
    return;
  }

  for (const binding of bindings) {
    const codexThread = codexThreadById(binding.codexThreadRef?.threadId || "");
    const chatThread = threadById(project, binding.chatThreadId);
    const status = laneBindingStatus(project, binding);
    const row = document.createElement("article");
    row.className = `binding-item${binding.id === state.selectedBindingId ? " active" : ""}`;
    row.innerHTML = `
      <div class="thread-topline">
        <span class="role-badge"></span>
        <strong class="truncate"></strong>
      </div>
      <div class="binding-meta"></div>
      <div class="thread-actions">
        <button class="ghost small select-binding" type="button">Edit</button>
      </div>
    `;
    row.querySelector(".role-badge").textContent = `${roleLabel(binding.lane)}${binding.isDefaultForLane ? " · default" : ""}${binding.openOnProjectActivate ? " · open" : ""}`;
    row.querySelector("strong").textContent = binding.label || `${roleLabel(binding.lane)} lane`;
    row.querySelector(".binding-meta").textContent =
      `Codex: ${codexThread?.title || binding.codexThreadRef?.titleSnapshot || "missing"} · ChatGPT: ${chatThread?.title || "missing"} · ${laneBindingStatusLabel(status)}`;
    row.querySelector(".select-binding").addEventListener("click", () => {
      populateBindingEditor(binding);
      renderThreadsWorkbench();
      setLastEvent(`Editing lane binding: ${binding.label || roleLabel(binding.lane)}.`);
    });
    els.laneBindingList.appendChild(row);
  }
}

function renderCodexThreadBrowser() {
  els.codexThreadCount.textContent = String(state.codexThreads.length);
  els.codexThreadList.innerHTML = "";
  if (!state.codexThreads.length) {
    els.codexThreadList.innerHTML = `<div class="empty-state">No Codex threads discovered yet. Attach the workspace backend and refresh this view.</div>`;
    return;
  }
  for (const thread of state.codexThreads) {
    const row = document.createElement("article");
    row.className = `thread-browser-item${thread.threadId === state.selectedCodexThreadId ? " active" : ""}`;
    row.innerHTML = `
      <div class="thread-topline">
        <span class="role-badge"></span>
        <strong class="truncate"></strong>
      </div>
      <span class="thread-meta truncate"></span>
      <span class="thread-notes truncate"></span>
    `;
    row.querySelector(".role-badge").textContent = thread.originator || "Codex";
    row.querySelector("strong").textContent = thread.title || "Untitled Codex thread";
    row.querySelector(".thread-meta").textContent = shortPath(thread.cwd || "");
    const updated = codexThreadUpdatedSummary(thread);
    row.querySelector(".thread-notes").textContent = updated.text;
    row.querySelector(".thread-notes").title = updated.title;
    row.addEventListener("click", () => {
      selectCodexThread(thread.threadId, thread.sourceHome || "", thread.sessionFilePath || "").catch((error) => {
        setLastEvent(`Codex thread open failed: ${error.message}`);
      });
    });
    els.codexThreadList.appendChild(row);
  }
}

function renderProjectChatThreadBrowser() {
  const project = activeProject();
  if (!project) return;
  const threads = sortedThreads(project, true);
  els.projectChatThreadCount.textContent = String(threads.length);
  els.projectChatThreadList.innerHTML = "";
  if (!threads.length) {
    els.projectChatThreadList.innerHTML = `<div class="empty-state">No project-attached ChatGPT threads yet. Use Attach / edit to add one.</div>`;
    return;
  }
  for (const thread of threads) {
    const row = document.createElement("article");
    row.className = `thread-browser-item${thread.id === state.selectedProjectChatThreadId ? " active" : ""}`;
    row.innerHTML = `
      <div class="thread-topline">
        <span class="role-badge"></span>
        <strong class="truncate"></strong>
      </div>
      <span class="thread-meta truncate"></span>
      <span class="thread-notes truncate"></span>
    `;
    row.querySelector(".role-badge").textContent = `${roleLabel(thread.role)}${thread.isPrimary ? " · primary" : ""}`;
    row.querySelector("strong").textContent = thread.title;
    row.querySelector(".thread-meta").textContent = shortPath(thread.url);
    row.querySelector(".thread-notes").textContent = thread.notes || (thread.lastOpenedAt ? `Last opened ${formatTime(thread.lastOpenedAt)}` : "No notes");
    row.addEventListener("click", () => {
      state.selectedProjectChatThreadId = thread.id;
      renderThreadsWorkbench();
      selectThread(thread.id).catch((error) => {
        setLastEvent(`Thread open failed: ${error.message}`);
      });
    });
    els.projectChatThreadList.appendChild(row);
  }
}

function renderRecentChatgptThreadBrowser() {
  const project = activeProject();
  if (!project) return;
  const threads = state.chatgptRecentThreads;
  els.recentChatThreadCount.textContent = String(threads.length);
  els.recentChatThreadList.innerHTML = "";

  if (state.chatgptRecentThreadsStatus === "loading") {
    const loadingLabel = state.chatgptRecentThreadsLoadingMode === "refresh"
      ? "Refreshing ChatGPT recents and project folders…"
      : "Loading cached ChatGPT threads…";
    els.recentChatThreadList.innerHTML = `<div class="empty-state">${loadingLabel}</div>`;
    return;
  }

  if (!threads.length) {
    const source = state.chatgptRecentThreadsSource ? ` Source: ${state.chatgptRecentThreadsSource}.` : "";
    const cacheSource = String(state.chatgptRecentThreadsSource || "").includes("persisted-cache");
    const message =
      state.chatgptRecentThreadsStatus === "error"
        ? `No recent ChatGPT threads available right now.${source}`
        : cacheSource
          ? "No cached ChatGPT threads yet. Click Refresh recent to append current recents and project-folder threads into the local cache."
          : `No recent ChatGPT threads available right now.${source}`;
    els.recentChatThreadList.innerHTML = `<div class="empty-state">${message}</div>`;
    return;
  }

  for (const group of groupedRecentChatgptThreads(threads)) {
    const section = document.createElement("section");
    section.className = "thread-browser-group";
    const header = document.createElement("header");
    header.className = "thread-browser-group-header";
    const prefix = document.createElement("span");
    prefix.className = "thread-browser-group-prefix";
    prefix.textContent = group.isProject ? "Project folder" : "Recents";
    const title = document.createElement("strong");
    title.className = "thread-browser-group-title";
    title.textContent = group.label;
    const count = document.createElement("span");
    count.className = "counter";
    count.textContent = String(group.entries.length);
    header.append(prefix, title, count);
    const list = document.createElement("div");
    list.className = "thread-browser-group-list";
    for (const thread of group.entries) {
      list.appendChild(buildRecentChatgptThreadRow(project, thread));
    }
    section.append(header, list);
    els.recentChatThreadList.appendChild(section);
  }
}

function renderChatgptThreadSource() {
  const project = activeProject();
  if (!project) return;
  const recentActive = state.activeChatgptThreadBrowserTab === "recent";
  els.projectChatThreadsTabButton.classList.toggle("active", !recentActive);
  els.recentChatThreadsTabButton.classList.toggle("active", recentActive);
  els.projectChatThreadList.hidden = recentActive;
  els.recentChatThreadList.hidden = !recentActive;
  els.openThreadAttachButton.hidden = recentActive;
  els.importRecentChatThreadButton.hidden = !recentActive;
  els.importRecentChatThreadButton.disabled = !recentActive || !state.selectedRecentChatgptThreadId;
  els.refreshRecentChatThreadsButton.disabled = state.chatgptRecentThreadsStatus === "loading";
  els.chatgptThreadBrowserHint.textContent = recentActive
    ? "Recent threads are grouped by project folder and loaded from local cache first. Use Refresh recent to append newly discovered recents/project threads."
    : "Project-attached ChatGPT threads can be linked directly to Codex threads.";
  renderProjectChatThreadBrowser();
  renderRecentChatgptThreadBrowser();
}

function renderThreadsWorkbench() {
  const project = activeProject();
  if (!project) return;
  renderDirectThreadWorkbench();
  renderLaneBindingList();
  renderCodexThreadBrowser();
  renderChatgptThreadSource();
  const codexThread = codexThreadById(state.selectedCodexThreadId);
  const chatThread = threadById(project, state.selectedProjectChatThreadId);
  if (state.activeChatgptThreadBrowserTab === "recent") {
    const recentThread = recentChatgptThreadById(state.selectedRecentChatgptThreadId);
    els.threadLinkHint.textContent = recentThread
      ? `Import ${recentThread.title} into the project before creating or updating a lane binding.`
      : "Select one ChatGPT thread (recent or project-folder) to import, or switch back to Project threads for lane binding.";
  } else {
    els.threadLinkHint.textContent = codexThread && chatThread
      ? `Link ${codexThread.title} to ${chatThread.title} for the selected lane.`
      : "Select one Codex thread and one ChatGPT project thread, then create or update a lane binding.";
  }
}

function selectedDirectWorkbenchThread() {
  const threads = state.directThreadWorkbench.snapshot?.threads || [];
  return threads.find((thread) => thread.threadId === state.directThreadWorkbench.selectedThreadId) || null;
}

function canOpenDirectWorkbenchThreadInCodexPlane(thread = {}) {
  const sourceClass = String(thread.sourceClass || "direct-native").trim();
  const lifecycleState = String(thread.lifecycle?.state || thread.lifecycleState || "active").trim();
  const projection = thread.rendererProjection || {};
  if (!thread.threadId || lifecycleState === "soft_deleted" || projection.unsafeForRenderer === true) return false;
  return [
    "direct",
    "direct-native",
    "forked-direct-native",
    "import-checkpoint-continuation",
    "direct-import-checkpoint-continuation",
  ].includes(sourceClass);
}

function directThreadWorkbenchExpectedInput(extra = {}) {
  const snapshot = state.directThreadWorkbench.snapshot || {};
  const projection = state.directThreadWorkbench.evidenceProjection || {};
  return {
    expectedWorkbenchRevision: snapshot.workbenchRevision || "",
    expectedOperationLedgerHeadDigest: snapshot.operationLedgerHeadDigest || "",
    expectedUiProjectionGeneration: projection.meta?.uiProjectionGeneration || "",
    expectedUiProjectionSourceDigest: projection.meta?.sourceDigest || "",
    ...extra,
  };
}

function renderDirectThreadWorkbenchList() {
  if (!els.directThreadWorkbenchList) return;
  els.directThreadWorkbenchList.textContent = "";
  const workbench = state.directThreadWorkbench;
  const threads = workbench.snapshot?.threads || [];
  if (workbench.status === "loading") {
    const item = document.createElement("div");
    item.className = "thread-browser-item";
    item.textContent = "Loading direct thread controls…";
    els.directThreadWorkbenchList.appendChild(item);
    return;
  }
  if (!threads.length) {
    const item = document.createElement("div");
    item.className = "thread-browser-item";
    item.textContent = workbench.lastError || "No direct-owned threads indexed for this project.";
    els.directThreadWorkbenchList.appendChild(item);
    return;
  }
  for (const thread of threads) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `thread-browser-item direct-thread-row${thread.threadId === workbench.selectedThreadId ? " active" : ""}`;
    row.dataset.threadId = thread.threadId;
    const title = document.createElement("strong");
    title.textContent = thread.title || "Untitled direct thread";
    const meta = document.createElement("span");
    meta.className = "binding-meta";
    const projection = thread.rendererProjection;
    meta.textContent = `${thread.lifecycle?.state || "active"} · ${thread.sourceClass || "direct"} · projection ${projection?.status || "missing"}`;
    const chips = document.createElement("span");
    chips.className = "direct-thread-row-chips";
    for (const label of [thread.activeTurnCount ? `${thread.activeTurnCount} active turn(s)` : "", projection?.projectionId ? "renderer projection" : "projection missing"].filter(Boolean)) {
      const chip = document.createElement("span");
      chip.className = "pill subtle";
      chip.textContent = label;
      chips.appendChild(chip);
    }
    row.append(title, meta, chips);
    row.addEventListener("click", () => {
      selectDirectWorkbenchThread(thread.threadId).catch((error) => setLastEvent(`Direct thread read failed: ${error.message}`));
    });
    els.directThreadWorkbenchList.appendChild(row);
  }
}

function renderDirectWorkThreadOperatorDeckSection() {
  const snapshot = state.directThreadWorkbench.snapshot;
  const deck = snapshot?.workThreadOperatorDeck || null;
  const section = document.createElement("div");
  section.className = "direct-thread-side-section direct-workthread-deck-section";
  const heading = document.createElement("div");
  heading.className = "section-heading compact";
  const title = document.createElement("div");
  title.innerHTML = `<p class="eyebrow">WorkThread deck</p><h4>Work identity</h4>`;
  const count = document.createElement("span");
  count.className = "counter";
  count.textContent = deck ? `${deck.rowCount || 0}` : "0";
  heading.append(title, count);
  section.appendChild(heading);

  const law = document.createElement("p");
  law.className = "muted";
  law.textContent = "WorkThread is the control-plane identity; provider thread ids are runtime identities only.";
  section.appendChild(law);

  const counts = document.createElement("div");
  counts.className = "direct-workthread-counts";
  const deckCounts = deck?.counts || {};
  for (const key of ["active", "recoverable", "blocked", "candidate", "stale", "archived"]) {
    const pill = document.createElement("span");
    pill.className = "pill subtle";
    pill.textContent = `${key} ${Number(deckCounts[key] || 0)}`;
    counts.appendChild(pill);
  }
  section.appendChild(counts);

  const list = document.createElement("div");
  list.className = "direct-workthread-list";
  const rows = deck?.rows || [];
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No WorkThread rows yet. Draft one below before starting provider work.";
    list.appendChild(empty);
  } else {
    for (const row of rows.slice(0, 12)) {
      const item = document.createElement("div");
      item.className = `direct-workthread-row state-${row.operatorState || "unknown"}`;
      const itemTitle = document.createElement("strong");
      itemTitle.textContent = row.title || row.workThreadId || "WorkThread";
      const meta = document.createElement("span");
      meta.className = "binding-meta";
      meta.textContent = `${row.operatorState || "unknown"} · ${row.workThreadId || "unscoped"}`;
      const runtime = document.createElement("span");
      runtime.className = "binding-meta";
      runtime.textContent = row.primaryRuntimeThreadId
        ? `runtime thread ${row.primaryRuntimeThreadId}`
        : "no runtime thread";
      item.append(itemTitle, meta, runtime);
      if (row.primaryRuntimeThreadId) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ghost small";
        button.textContent = "Open runtime";
        button.disabled = state.directThreadWorkbench.status === "working";
        button.addEventListener("click", () => {
          selectDirectWorkbenchThread(row.primaryRuntimeThreadId).catch((error) => setLastEvent(`Open WorkThread runtime failed: ${error.message}`));
        });
        item.appendChild(button);
      }
      list.appendChild(item);
    }
  }
  section.appendChild(list);

  const form = document.createElement("div");
  form.className = "direct-workthread-draft-form";
  const titleLabel = document.createElement("label");
  titleLabel.textContent = "New thread title";
  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.placeholder = "Direct work thread title";
  titleInput.value = state.directThreadWorkbench.newThreadDraftTitle || "";
  titleLabel.appendChild(titleInput);

  const objectiveLabel = document.createElement("label");
  objectiveLabel.textContent = "Objective / context posture";
  const objectiveInput = document.createElement("textarea");
  objectiveInput.rows = 4;
  objectiveInput.placeholder = "State the work-world objective before creating a local direct thread.";
  objectiveInput.value = state.directThreadWorkbench.newThreadDraftObjective || "";
  objectiveLabel.appendChild(objectiveInput);

  const idLabel = document.createElement("label");
  idLabel.textContent = "WorkThread id (optional)";
  const idInput = document.createElement("input");
  idInput.type = "text";
  idInput.placeholder = "Generated if omitted";
  idInput.value = state.directThreadWorkbench.newThreadDraftWorkThreadId || "";
  idLabel.appendChild(idInput);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "primary small";
  button.textContent = "Create local draft";
  const updateButton = () => {
    state.directThreadWorkbench.newThreadDraftTitle = titleInput.value;
    state.directThreadWorkbench.newThreadDraftObjective = objectiveInput.value;
    state.directThreadWorkbench.newThreadDraftWorkThreadId = idInput.value;
    button.disabled = state.directThreadWorkbench.status === "working" ||
      !bridge.createDirectWorkThreadDraftSession ||
      !titleInput.value.trim() ||
      !objectiveInput.value.trim();
  };
  titleInput.addEventListener("input", updateButton);
  objectiveInput.addEventListener("input", updateButton);
  idInput.addEventListener("input", updateButton);
  button.addEventListener("click", () => {
    createDirectWorkThreadDraftSession().catch((error) => setLastEvent(`Create local WorkThread draft failed: ${error.message}`));
  });
  updateButton();
  const note = document.createElement("p");
  note.className = "muted";
  note.textContent = "Creates local direct thread evidence only. It does not start a provider turn, worker, app-server fallback, or workspace mutation.";
  form.append(titleLabel, objectiveLabel, idLabel, button, note);
  section.appendChild(form);
  return section;
}

function renderDirectThreadProjectionDetail() {
  if (!els.directThreadWorkbenchDetail) return;
  const workbench = state.directThreadWorkbench;
  const thread = selectedDirectWorkbenchThread();
  const projection = workbench.selectedProjection?.projection || null;
  els.directThreadWorkbenchDetail.textContent = "";
  if (!thread) {
    const empty = document.createElement("div");
    empty.className = "direct-thread-empty";
    empty.textContent = "Select a direct-owned thread to inspect its renderer-safe projection and controls.";
    els.directThreadWorkbenchDetail.appendChild(empty);
    return;
  }

  const header = document.createElement("div");
  header.className = "direct-thread-detail-header";
  const title = document.createElement("div");
  title.innerHTML = `<p class="eyebrow">Selected direct thread</p><h4></h4>`;
  title.querySelector("h4").textContent = thread.title || thread.threadId;
  const actions = document.createElement("div");
  actions.className = "heading-actions direct-thread-actions";
  const openButton = document.createElement("button");
  const canOpenInCodexPlane = canOpenDirectWorkbenchThreadInCodexPlane(thread);
  openButton.type = "button";
  openButton.className = "primary small";
  openButton.textContent = "Open in Codex plane";
  openButton.disabled = state.directThreadWorkbench.status === "working" || !bridge.selectCodexThread || !canOpenInCodexPlane;
  openButton.title = canOpenInCodexPlane
    ? "Open this direct-owned thread in the left Codex plane without promoting derived previews."
    : "Only direct-native runtime sessions can be opened in the Codex plane; imported or derived evidence remains non-runnable.";
  openButton.addEventListener("click", () => {
    openDirectWorkbenchThreadInCodexPlane(thread.threadId).catch((error) => setLastEvent(`Direct thread open failed: ${error.message}`));
  });
  actions.appendChild(openButton);
  const actionSpecs = [
    ["hide", "Hide"],
    ["unhide", "Unhide"],
    ["archive", "Archive"],
    ["restore", "Restore"],
    ["restore_soft_deleted", "Restore soft-deleted"],
    ["soft_delete", "Soft delete"],
  ];
  for (const [action, label] of actionSpecs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `ghost small${action === "soft_delete" ? " danger" : ""}`;
    button.textContent = label;
    button.disabled = state.directThreadWorkbench.status === "working";
    button.addEventListener("click", () => {
      runDirectThreadLifecycle(action).catch((error) => setLastEvent(`Direct thread ${label.toLowerCase()} failed: ${error.message}`));
    });
    actions.appendChild(button);
  }
  header.append(title, actions);
  els.directThreadWorkbenchDetail.appendChild(header);

  const meta = document.createElement("div");
  meta.className = "direct-thread-meta-grid";
  const metaEntries = [
    ["Lifecycle", thread.lifecycle?.state || "active"],
    ["Source", thread.sourceClass || "direct"],
    ["Projection", projection?.status || thread.rendererProjection?.status || "missing"],
    ["Composer", "runtime status is authoritative"],
  ];
  for (const [label, value] of metaEntries) {
    const entry = document.createElement("div");
    entry.innerHTML = `<span></span><strong></strong>`;
    entry.querySelector("span").textContent = label;
    entry.querySelector("strong").textContent = value;
    meta.appendChild(entry);
  }
  els.directThreadWorkbenchDetail.appendChild(meta);

  const previewActions = document.createElement("div");
  previewActions.className = "threads-action-bar direct-preview-actions";
  const hint = document.createElement("p");
  hint.className = "muted";
  hint.textContent = `Previews are non-runnable information views. Fork preview seed metadata uses the first ${DIRECT_FORK_PREVIEW_ITEM_CAP} loaded projection items only.`;
  const buttons = document.createElement("div");
  buttons.className = "heading-actions";
  for (const [kind, label] of [["merge", "Merge preview"], ["prune", "Prune preview"], ["fork", "Fork preview"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost small";
    button.textContent = label;
    button.disabled = state.directThreadWorkbench.status === "working" || !thread.rendererProjection?.projectionId;
    button.addEventListener("click", () => {
      createDirectThreadPreview(kind).catch((error) => setLastEvent(`${label} failed: ${error.message}`));
    });
    buttons.appendChild(button);
  }
  previewActions.append(hint, buttons);
  els.directThreadWorkbenchDetail.appendChild(previewActions);

  const transcript = document.createElement("div");
  transcript.className = "direct-thread-transcript";
  const items = projection?.items || [];
  if (!items.length) {
    const item = document.createElement("div");
    item.className = "import-transcript-item";
    item.textContent = projection?.failureSummary || "Renderer-safe transcript projection is not loaded yet.";
    transcript.appendChild(item);
  } else {
    for (const entry of items.slice(0, 40)) {
      const item = document.createElement("div");
      item.className = "import-transcript-item";
      const role = document.createElement("strong");
      role.textContent = `${entry.role || entry.itemKind || "item"} · ${entry.status || "evidence"}`;
      const pre = document.createElement("pre");
      pre.textContent = entry.text || "";
      item.append(role, pre);
      transcript.appendChild(item);
    }
  }
  els.directThreadWorkbenchDetail.appendChild(transcript);
}

function renderDirectThreadWorkbenchSide() {
  if (!els.directThreadWorkbenchSide) return;
  const snapshot = state.directThreadWorkbench.snapshot;
  const preview = state.directThreadWorkbench.selectedPreview?.projection || null;
  els.directThreadWorkbenchSide.textContent = "";
  els.directThreadWorkbenchSide.appendChild(renderDirectWorkThreadOperatorDeckSection());

  const revision = document.createElement("div");
  revision.className = "direct-thread-side-section";
  revision.innerHTML = `<p class="eyebrow">Workbench revision</p><p class="mono muted"></p><p class="muted"></p>`;
  revision.querySelector("p.mono").textContent = snapshot?.workbenchRevision || "not loaded";
  revision.querySelector("p.muted:last-child").textContent = state.directThreadWorkbench.evidenceProjection
    ? "Evidence workbench projection is renderer-safe and non-runnable."
    : "Evidence projection not loaded.";
  els.directThreadWorkbenchSide.appendChild(revision);

  const graph = document.createElement("div");
  graph.className = "direct-thread-side-section";
  const graphItems = snapshot?.graph?.items || [];
  graph.innerHTML = `<p class="eyebrow">Graph</p><div></div>`;
  const graphBody = graph.querySelector("div");
  if (!graphItems.length) {
    graphBody.textContent = snapshot?.graph?.status ? `Graph ${snapshot.graph.status}` : "No graph projection.";
  } else {
    for (const item of graphItems.slice(0, 12)) {
      const row = document.createElement("div");
      row.className = "direct-thread-side-row";
      row.textContent = item.text || item.itemKind || "graph item";
      graphBody.appendChild(row);
    }
  }
  els.directThreadWorkbenchSide.appendChild(graph);

  const previewSection = document.createElement("div");
  previewSection.className = "direct-thread-side-section";
  previewSection.innerHTML = `<p class="eyebrow">Selected preview</p><div></div>`;
  const previewBody = previewSection.querySelector("div");
  if (!preview) {
    previewBody.textContent = "No preview selected.";
  } else {
    const badge = document.createElement("p");
    badge.className = "muted";
    badge.textContent = `${preview.projectionKind} · ${preview.status} · non-runnable`;
    previewBody.appendChild(badge);
    if (["fork_preview", "merge_preview", "prune_preview"].includes(preview.projectionKind) && preview.status === "valid") {
      const isDerivedPreview = preview.projectionKind === "merge_preview" || preview.projectionKind === "prune_preview";
      const bridgeReady = isDerivedPreview
        ? Boolean(bridge.prepareDirectThreadDerivedPreviewForkStart && bridge.startDirectThreadForkFromDerivedPreview)
        : Boolean(bridge.prepareDirectThreadForkStart && bridge.startDirectThreadForkFromPreview);
      const forkForm = document.createElement("div");
      forkForm.className = "direct-fork-start-form";
      const intentLabel = document.createElement("label");
      intentLabel.className = "direct-fork-start-label";
      intentLabel.textContent = "Fresh fork intent";
      const intentInput = document.createElement("textarea");
      intentInput.className = "direct-fork-start-input";
      intentInput.rows = 4;
      intentInput.placeholder = "Tell the new direct session what to do with this preview evidence...";
      intentInput.value = state.directThreadWorkbench.forkStartPrompt || "";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "primary small";
      button.textContent = "Start fresh fork";
      const updateButtonDisabled = () => {
        button.disabled = state.directThreadWorkbench.status === "working" || !bridgeReady || !String(intentInput.value || "").trim();
      };
      updateButtonDisabled();
      button.title = bridgeReady
        ? "Create a fresh direct-native session from quoted preview evidence. This does not resume provider state."
        : "Fork-start bridge is unavailable for this preview kind.";
      button.addEventListener("click", () => {
        startDirectThreadForkFromSelectedPreview().catch((error) => setLastEvent(`Start fresh fork failed: ${error.message}`));
      });
      intentInput.addEventListener("input", () => {
        state.directThreadWorkbench.forkStartPrompt = intentInput.value;
        updateButtonDisabled();
      });
      const note = document.createElement("p");
      note.className = "muted";
      note.textContent = isDerivedPreview
        ? "Starts a fresh direct session from quoted merge/prune preview evidence. Source previews remain non-runnable and no provider continuity is reused."
        : "Starts a fresh direct session from fork-preview seed metadata. Source thread state is not resumed.";
      forkForm.append(intentLabel, intentInput, button, note);
      previewBody.appendChild(forkForm);
    }
    for (const item of (preview.items || []).slice(0, 8)) {
      const row = document.createElement("div");
      row.className = "direct-thread-side-row";
      row.textContent = item.text || item.itemKind || "preview item";
      previewBody.appendChild(row);
    }
  }
  els.directThreadWorkbenchSide.appendChild(previewSection);

  const operations = document.createElement("div");
  operations.className = "direct-thread-side-section";
  operations.innerHTML = `<p class="eyebrow">Operations</p><div></div>`;
  const operationBody = operations.querySelector("div");
  const entries = snapshot?.operationSummary?.entries || [];
  if (!entries.length) {
    operationBody.textContent = "No thread-control operations.";
  } else {
    for (const operation of entries.slice(0, 10)) {
      const row = document.createElement("div");
      row.className = "direct-thread-side-row";
      row.textContent = `${operation.operationType} · ${operation.status} · read-only history`;
      operationBody.appendChild(row);
    }
  }
  els.directThreadWorkbenchSide.appendChild(operations);
}

function renderDirectThreadWorkbench() {
  if (!els.directThreadWorkbenchStatus) return;
  const workbench = state.directThreadWorkbench;
  const counts = workbench.snapshot?.lifecycle?.counts || {};
  els.directThreadWorkbenchStatus.textContent = workbench.status || "idle";
  els.directThreadActiveCount.textContent = String(counts.active || 0);
  els.directThreadHiddenCount.textContent = String(counts.hidden || 0);
  els.directThreadArchivedCount.textContent = String(counts.archived || 0);
  els.directThreadSoftDeletedCount.textContent = String(counts.soft_deleted || 0);
  if (els.directThreadIncludeHiddenInput) els.directThreadIncludeHiddenInput.checked = Boolean(workbench.filters.includeHidden);
  if (els.directThreadIncludeArchivedInput) els.directThreadIncludeArchivedInput.checked = Boolean(workbench.filters.includeArchived);
  if (els.directThreadIncludeSoftDeletedInput) els.directThreadIncludeSoftDeletedInput.checked = Boolean(workbench.filters.includeSoftDeleted);
  if (els.directThreadTextQueryInput && document.activeElement !== els.directThreadTextQueryInput) {
    els.directThreadTextQueryInput.value = workbench.filters.textQuery || "";
  }
  renderDirectThreadWorkbenchList();
  renderDirectThreadProjectionDetail();
  renderDirectThreadWorkbenchSide();
}

function importStateLabel(stateValue) {
  const value = String(stateValue || "imported-readonly");
  if (value === "checkpoint-validated" || value === "checkpointed-runnable") return "Checkpoint validated";
  if (value === "checkpoint-candidate") return "Checkpoint candidate";
  if (value === "imported-validation-failed") return "Validation failed";
  if (value === "import-canceled") return "Canceled";
  if (value === "imported-unvalidated") return "Unvalidated";
  return "Imported read-only";
}

function importComposerReasonLabel(reason) {
  if (reason === "live-continuation-not-implemented") return "live continuation not implemented";
  if (reason === "checkpoint-validation-only") return "checkpoint validation only";
  return "imported read-only";
}

function resetDirectImportWorkbench(projectId = activeProject()?.id || "") {
  state.directImportWorkbench = {
    projectId,
    requestGeneration: Number(state.directImportWorkbench?.requestGeneration || 0) + 1,
    status: "idle",
    sources: [],
    imports: [],
    report: null,
    selectedImportSession: null,
    selectedHandleId: "",
    selectedImportId: "",
    selectedSessionId: "",
    lastError: "",
    includeHidden: false,
  };
}

function resetDirectThreadWorkbench(projectId = activeProject()?.id || "") {
  state.directThreadWorkbench = {
    projectId,
    requestGeneration: Number(state.directThreadWorkbench?.requestGeneration || 0) + 1,
    status: "idle",
    snapshot: null,
    evidenceProjection: null,
    selectedThreadId: "",
    selectedPreviewId: "",
    selectedProjection: null,
    selectedPreview: null,
    forkStartPrompt: "",
    newThreadDraftTitle: "",
    newThreadDraftObjective: "",
    newThreadDraftWorkThreadId: "",
    lastError: "",
    filters: {
      includeHidden: Boolean(state.directThreadWorkbench?.filters?.includeHidden),
      includeArchived: Boolean(state.directThreadWorkbench?.filters?.includeArchived),
      includeSoftDeleted: Boolean(state.directThreadWorkbench?.filters?.includeSoftDeleted),
      textQuery: "",
    },
  };
}

function selectedDirectImportSource() {
  const handleId = state.directImportWorkbench.selectedHandleId;
  return (state.directImportWorkbench.sources || []).find((source) => source.handleId === handleId) || null;
}

function selectedDirectImportEntry() {
  const importId = state.directImportWorkbench.selectedImportId;
  return (state.directImportWorkbench.imports || []).find((entry) => entry.importId === importId) || null;
}

function updateDirectImportHint() {
  if (!els.directImportHint) return;
  const workbench = state.directImportWorkbench;
  const runtimeImports = state.directRuntimeStatus?.imports || {};
  if (workbench.status === "loading") {
    els.directImportHint.textContent = "Loading import evidence from the direct session store.";
    return;
  }
  if (workbench.status === "working") {
    els.directImportHint.textContent = "Import operation is running in the main process; raw source paths remain private.";
    return;
  }
  if (workbench.lastError) {
    els.directImportHint.textContent = workbench.lastError;
    return;
  }
  const visibleCount = (workbench.imports || []).length || Number(runtimeImports.importedSessionCount || 0);
  const eligible = Number(runtimeImports.continuationEligibleCount || 0);
  els.directImportHint.textContent = `${visibleCount} imported evidence session${visibleCount === 1 ? "" : "s"} · ${eligible} checkpoint validated · composer disabled for all imports.`;
}

function renderDirectImportSourceList() {
  const list = els.directImportSourceList;
  if (!list) return;
  const sources = state.directImportWorkbench.sources || [];
  els.directImportSourceCount.textContent = String(sources.length);
  list.innerHTML = "";
  if (!sources.length) {
    list.innerHTML = `<div class="empty-state">No source selected. Choose a JSONL file or an explicit source root.</div>`;
    return;
  }
  for (const source of sources) {
    const row = document.createElement("article");
    row.className = `thread-browser-item import-source-item${source.handleId === state.directImportWorkbench.selectedHandleId ? " active" : ""}`;
    row.innerHTML = `
      <div class="thread-topline">
        <span class="role-badge"></span>
        <strong class="truncate"></strong>
      </div>
      <span class="thread-meta truncate"></span>
      <span class="thread-notes truncate"></span>
      <div class="thread-actions">
        <button class="ghost small inspect-import-source" type="button">Inspect</button>
        <button class="primary small materialize-import-source" type="button">Import</button>
      </div>
    `;
    row.querySelector(".role-badge").textContent = source.duplicateMatched ? "Existing source" : "Selected source";
    row.querySelector("strong").textContent = source.sourceDisplayName || "Codex JSONL";
    row.querySelector(".thread-meta").textContent = `${source.sourceRootDisplayName || "explicit root"} · ${formatBytes(source.sourceFileSizeBytes || 0)}`;
    row.querySelector(".thread-notes").textContent = source.recordCount
      ? `${source.recordCount} records · ${source.threadId || "thread unknown"}`
      : source.expiresAt
        ? `Handle expires ${formatTime(source.expiresAt)}`
        : "Source handle is main-owned.";
    row.addEventListener("click", () => {
      state.directImportWorkbench.selectedHandleId = source.handleId || "";
      state.directImportWorkbench.selectedImportId = "";
      state.directImportWorkbench.report = null;
      state.directImportWorkbench.selectedImportSession = null;
      renderDirectImportWorkbench();
    });
    row.querySelector(".inspect-import-source").addEventListener("click", (event) => {
      event.stopPropagation();
      inspectDirectImportSource(source.handleId).catch((error) => setLastEvent(`Import inspect failed: ${error.message}`));
    });
    row.querySelector(".materialize-import-source").addEventListener("click", (event) => {
      event.stopPropagation();
      materializeSelectedDirectImportSource(source.handleId).catch((error) => setLastEvent(`Import failed: ${error.message}`));
    });
    list.appendChild(row);
  }
}

function renderDirectImportList() {
  const list = els.directImportList;
  if (!list) return;
  const entries = state.directImportWorkbench.imports || [];
  els.directImportVisibleCount.textContent = String(entries.length);
  els.directImportCount.textContent = String(entries.length);
  list.innerHTML = "";
  if (state.directImportWorkbench.status === "loading") {
    list.innerHTML = `<div class="empty-state">Loading imported sessions…</div>`;
    return;
  }
  if (!entries.length) {
    list.innerHTML = `<div class="empty-state">No materialized imports yet. Importing creates read-only local evidence only.</div>`;
    return;
  }
  for (const entry of entries) {
    const row = document.createElement("article");
    row.className = `thread-browser-item import-session-item${entry.importId === state.directImportWorkbench.selectedImportId ? " active" : ""}`;
    row.innerHTML = `
      <div class="thread-topline">
        <span class="role-badge"></span>
        <strong class="truncate"></strong>
      </div>
      <span class="thread-meta truncate"></span>
      <span class="thread-notes truncate"></span>
      <div class="thread-actions">
        <button class="ghost small open-import-report" type="button">Report</button>
        <button class="danger small hide-import-record" type="button">Hide</button>
      </div>
    `;
    row.querySelector(".role-badge").textContent = importStateLabel(entry.state);
    row.querySelector("strong").textContent = entry.title || entry.sourceDisplayName || entry.source?.sourceDisplayName || "Imported Codex session";
    row.querySelector(".thread-meta").textContent = `${entry.threadId || "thread unknown"} · ${entry.recoveryState || "healthy"}`;
    const composer = entry.composer || { enabled: false, reason: "imported-readonly" };
    row.querySelector(".thread-notes").textContent = `Composer ${composer.enabled ? "enabled" : "disabled"} · ${importComposerReasonLabel(composer.reason)}`;
    row.addEventListener("click", () => selectDirectImport(entry.importId).catch((error) => setLastEvent(`Import report load failed: ${error.message}`)));
    row.querySelector(".open-import-report").addEventListener("click", (event) => {
      event.stopPropagation();
      selectDirectImport(entry.importId).catch((error) => setLastEvent(`Import report load failed: ${error.message}`));
    });
    row.querySelector(".hide-import-record").addEventListener("click", (event) => {
      event.stopPropagation();
      hideDirectImport(entry.importId).catch((error) => setLastEvent(`Hide import failed: ${error.message}`));
    });
    list.appendChild(row);
  }
}

function renderImportGateList(container, gates = {}) {
  const rows = Object.entries(gates || {});
  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No gate data recorded.";
    container.appendChild(empty);
    return;
  }
  const list = document.createElement("div");
  list.className = "import-gate-list";
  for (const [key, value] of rows) {
    const row = document.createElement("div");
    row.className = "import-gate-row";
    const name = document.createElement("span");
    name.textContent = key.replace(/([A-Z])/g, " $1").toLowerCase();
    const stateNode = document.createElement("span");
    stateNode.className = `pill ${value ? "" : "subtle"}`;
    stateNode.textContent = value ? "pass" : "blocked";
    row.append(name, stateNode);
    list.appendChild(row);
  }
  container.appendChild(list);
}

function renderProblemList(container, title, entries = []) {
  const section = document.createElement("section");
  section.className = "import-problem-section";
  const heading = document.createElement("h4");
  heading.textContent = title;
  section.appendChild(heading);
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "None recorded.";
    section.appendChild(empty);
  } else {
    for (const entry of entries) {
      const item = document.createElement("div");
      item.className = "import-problem-item";
      const code = document.createElement("span");
      code.className = "role-badge";
      code.textContent = entry.code || "unknown";
      const message = document.createElement("span");
      message.textContent = entry.message || entry.code || "Import issue";
      item.append(code, message);
      section.appendChild(item);
    }
  }
  container.appendChild(section);
}

function rendererTextFromImportItem(item = {}) {
  if (typeof item.text === "string") return item.text;
  if (Array.isArray(item.content)) {
    return item.content
      .map((entry) => (typeof entry?.text === "string" ? entry.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function renderImportTranscript(container, session = {}) {
  const items = Array.isArray(session.transcriptItems) ? session.transcriptItems : [];
  const transcript = document.createElement("div");
  transcript.className = "import-transcript";
  if (!items.length) {
    transcript.innerHTML = `<div class="empty-state">No renderer-safe transcript items were materialized.</div>`;
    container.appendChild(transcript);
    return;
  }
  for (const item of items) {
    const row = document.createElement("article");
    row.className = "import-transcript-item";
    const role = item.type === "agentMessage" ? "assistant" : item.type === "userMessage" ? "user" : (item.role || "evidence");
    const heading = document.createElement("div");
    heading.className = "thread-topline";
    const badge = document.createElement("span");
    badge.className = "role-badge";
    badge.textContent = role;
    const timestamp = document.createElement("strong");
    timestamp.className = "truncate";
    timestamp.textContent = item.sourceTimestamp ? formatTime(item.sourceTimestamp) : `seq ${Number(item.sourceSeq ?? 0)}`;
    heading.append(badge, timestamp);
    const body = document.createElement("pre");
    body.textContent = rendererTextFromImportItem(item) || "[no display text]";
    row.append(heading, body);
    transcript.appendChild(row);
  }
  container.appendChild(transcript);
}

function renderDirectImportDetail() {
  const detail = els.directImportDetail;
  if (!detail) return;
  detail.innerHTML = "";
  const selectedSource = selectedDirectImportSource();
  const selectedEntry = selectedDirectImportEntry();
  const report = state.directImportWorkbench.report;

  if (selectedSource && !selectedEntry) {
    const header = document.createElement("section");
    header.className = "import-detail-header";
    header.innerHTML = `
      <p class="eyebrow">Selected source</p>
      <h3></h3>
      <p class="muted"></p>
      <div class="direct-auth-status">
        <span class="pill subtle">raw path hidden</span>
        <span class="pill subtle">raw records hidden</span>
        <span class="pill subtle">source hash hidden</span>
      </div>
    `;
    header.querySelector("h3").textContent = selectedSource.sourceDisplayName || "Codex JSONL";
    header.querySelector(".muted").textContent = selectedSource.recordCount
      ? `${selectedSource.recordCount} records · ${selectedSource.threadId || "thread unknown"}`
      : `${selectedSource.sourceRootDisplayName || "explicit root"} · inspect before materialization if you need counts.`;
    const actions = document.createElement("div");
    actions.className = "heading-actions";
    const inspectButton = document.createElement("button");
    inspectButton.className = "ghost small";
    inspectButton.type = "button";
    inspectButton.textContent = "Inspect";
    inspectButton.addEventListener("click", () => inspectDirectImportSource(selectedSource.handleId).catch((error) => setLastEvent(`Import inspect failed: ${error.message}`)));
    const importButton = document.createElement("button");
    importButton.className = "primary small";
    importButton.type = "button";
    importButton.textContent = "Import read-only";
    importButton.addEventListener("click", () => materializeSelectedDirectImportSource(selectedSource.handleId).catch((error) => setLastEvent(`Import failed: ${error.message}`)));
    actions.append(inspectButton, importButton);
    header.appendChild(actions);
    detail.appendChild(header);
    return;
  }

  if (!selectedEntry) {
    detail.innerHTML = `<div class="empty-state">Select a source or imported session. This workbench never starts direct continuation requests.</div>`;
    return;
  }

  const session = state.directImportWorkbench.selectedImportSession || {};
  const header = document.createElement("section");
  header.className = "import-detail-header";
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = importStateLabel(selectedEntry.state);
  const title = document.createElement("h3");
  title.textContent = session.title || selectedEntry.sourceDisplayName || "Imported Codex session";
  const meta = document.createElement("p");
  meta.className = "muted";
  const composer = selectedEntry.composer || session.composer || { enabled: false, reason: "imported-readonly" };
  const continuation = selectedEntry.continuation || session.continuation || {};
  meta.textContent = `Composer disabled · ${importComposerReasonLabel(composer.reason)} · checkpoint action: ${continuation.runnableNow ? "available" : (continuation.reason || "blocked")}`;
  const badges = document.createElement("div");
  badges.className = "direct-auth-status";
  for (const label of session.labels || ["Imported read-only", "Continuation not started", "Composer disabled"]) {
    const badge = document.createElement("span");
    badge.className = "pill subtle";
    badge.textContent = label;
    badges.appendChild(badge);
  }
  header.append(eyebrow, title, meta, badges);
  const actions = document.createElement("div");
  actions.className = "heading-actions";
  const checkpointButton = document.createElement("button");
  checkpointButton.className = "primary small";
  checkpointButton.type = "button";
  checkpointButton.textContent = "Continue in Direct";
  checkpointButton.disabled = !continuation.runnableNow || !bridge.startDirectImportCheckpointContinuation;
  checkpointButton.title = continuation.runnableNow
    ? "Start a fresh direct-native text session from this checkpoint."
    : (continuation.reason || "Checkpoint continuation is not runnable yet.");
  checkpointButton.addEventListener("click", () => startDirectImportCheckpointContinuation(selectedEntry.importId).catch((error) => {
    setLastEvent(`Checkpoint continuation failed: ${error.message}`);
  }));
  actions.appendChild(checkpointButton);
  header.appendChild(actions);
  detail.appendChild(header);

  if (report) {
    const summary = document.createElement("section");
    summary.className = "import-report-summary";
    const counts = report.counts || {};
    summary.innerHTML = `
      <div class="analytics-summary-strip">
        <div class="analytics-metric-card"><span class="metric-key">Records</span><span class="metric-value"></span><span class="metric-evidence">source evidence</span></div>
        <div class="analytics-metric-card"><span class="metric-key">Blockers</span><span class="metric-value"></span><span class="metric-evidence">validation report</span></div>
        <div class="analytics-metric-card"><span class="metric-key">Warnings</span><span class="metric-value"></span><span class="metric-evidence">validation report</span></div>
      </div>
    `;
    const values = summary.querySelectorAll(".metric-value");
    values[0].textContent = String(counts.records || selectedEntry.recordCount || 0);
    values[1].textContent = String((report.blockers || []).length);
    values[2].textContent = String((report.warnings || []).length);
    detail.appendChild(summary);

    const gates = document.createElement("section");
    gates.className = "import-report-section";
    const gatesHeading = document.createElement("h4");
    gatesHeading.textContent = "Validation gates";
    gates.appendChild(gatesHeading);
    renderImportGateList(gates, report.gates || {});
    detail.appendChild(gates);

    renderProblemList(detail, "Blockers", report.blockers || []);
    renderProblemList(detail, "Warnings", report.warnings || []);
  }

  renderImportTranscript(detail, session);
}

function renderDirectImportWorkbench() {
  if (!els.directImportDetail) return;
  updateDirectImportHint();
  const working = ["loading", "working"].includes(state.directImportWorkbench.status);
  if (els.refreshDirectImportsButton) els.refreshDirectImportsButton.disabled = working;
  if (els.chooseDirectImportFileButton) els.chooseDirectImportFileButton.disabled = working;
  if (els.chooseDirectImportRootButton) els.chooseDirectImportRootButton.disabled = working;
  renderDirectImportSourceList();
  renderDirectImportList();
  renderDirectImportDetail();
}

function renderHandoffTargetSelect() {
  const project = activeProject();
  if (!project) return;
  const current = activeThread(project);
  const previous = els.handoffTargetThreadSelect.value;
  els.handoffTargetThreadSelect.innerHTML = "";
  for (const thread of sortedThreads(project, false)) {
    const option = document.createElement("option");
    option.value = thread.id;
    option.textContent = `${roleLabel(thread.role)} · ${thread.title}`;
    els.handoffTargetThreadSelect.appendChild(option);
  }
  els.handoffTargetThreadSelect.value = previous || current?.id || primaryReviewThread(project)?.id || "";
}

function renderPromptPreview() {
  const project = activeProject();
  const thread = activeThread(project);
  const prompt = activePromptText(project, thread);
  els.promptRoleLabel.textContent = thread ? `${roleLabel(thread.role)} prompt · ${thread.title}` : "Active thread prompt";
  els.activePromptPreview.textContent = prompt || "No prompt template configured.";
}

function renderHandoffQueue() {
  const project = activeProject();
  if (!project) return;
  const handoffs = Array.isArray(project.handoffs) ? project.handoffs : [];
  const activeHandoffs = handoffs.filter((item) => ACTIVE_HANDOFF_STATUSES.has(item.status));
  els.handoffCount.textContent = String(activeHandoffs.length);
  els.handoffQueue.innerHTML = "";

  if (!handoffs.length) {
    els.handoffQueue.innerHTML = `<div class="empty-state">No handoffs staged. Select a file or stage a question to create one.</div>`;
    return;
  }

  for (const item of handoffs.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))) {
    const thread = threadById(project, item.targetThreadId);
    const row = document.createElement("article");
    row.className = `handoff-item status-${item.status}`;
    row.innerHTML = `
      <div class="handoff-summary">
        <span class="role-badge"></span>
        <strong class="truncate"></strong>
        <span class="handoff-meta truncate"></span>
        <span class="handoff-prompt-preview"></span>
      </div>
      <div class="handoff-actions">
        <button class="ghost small open-handoff" type="button">Open thread</button>
        <button class="ghost small copy-handoff" type="button">Copy prompt</button>
        <button class="ghost small reveal-handoff" type="button">Reveal file</button>
        <button class="ghost small submitted-handoff" type="button">Mark submitted</button>
        <button class="ghost small pasted-handoff" type="button">Mark pasted back</button>
        <button class="ghost small dismiss-handoff" type="button">Dismiss</button>
      </div>
    `;
    row.querySelector(".role-badge").textContent = `${HANDOFF_KINDS[item.kind] || item.kind} · ${item.status}`;
    row.querySelector("strong").textContent = item.title;
    const orphaned = !item.targetThreadId || !thread;
    row.querySelector(".handoff-meta").textContent = `Target: ${thread ? `${roleLabel(thread.role)} · ${thread.title}` : "missing thread"}${item.fileRelPath ? ` · ${item.fileRelPath}` : ""}`;
    row.querySelector(".handoff-prompt-preview").textContent = item.promptText;
    row.querySelector(".open-handoff").disabled = orphaned;
    row.querySelector(".open-handoff").addEventListener("click", () => openHandoffThread(item.id));
    row.querySelector(".copy-handoff").addEventListener("click", () => copyHandoffPrompt(item.id));
    row.querySelector(".reveal-handoff").disabled = !item.fileRelPath;
    row.querySelector(".reveal-handoff").addEventListener("click", () => revealHandoffFile(item.id));
    row.querySelector(".submitted-handoff").addEventListener("click", () => updateHandoffStatus(item.id, "submitted-manually"));
    row.querySelector(".pasted-handoff").addEventListener("click", () => updateHandoffStatus(item.id, "pasted-back"));
    row.querySelector(".dismiss-handoff").addEventListener("click", () => updateHandoffStatus(item.id, "dismissed"));
    els.handoffQueue.appendChild(row);
  }
}

function codexRequestResultForAction(request, action) {
  if (request.method === "item/commandExecution/requestApproval") {
    return { decision: action === "cancel" ? "cancel" : "decline" };
  }
  if (request.method === "item/fileChange/requestApproval") {
    return { decision: action === "cancel" ? "cancel" : "decline" };
  }
  if (request.method === "execCommandApproval" || request.method === "applyPatchApproval") {
    return { decision: action === "cancel" ? "abort" : "denied" };
  }
  if (request.method === "mcpServer/elicitation/request") {
    return { action: action === "cancel" ? "cancel" : "decline", content: null, _meta: null };
  }
  if (request.method === "item/permissions/requestApproval") {
    return { permissions: {}, scope: "turn" };
  }
  return null;
}

function renderCodexRequests() {
  const entries = [...state.codexRequests.values()]
    .filter((request) => ["pending", "responding", "timed-out"].includes(request.status || "pending"))
    .sort((a, b) => String(a.receivedAt || "").localeCompare(String(b.receivedAt || "")));
  els.codexRequestCount.textContent = String(entries.length);
  els.codexRequestList.innerHTML = "";

  if (!entries.length) {
    els.codexRequestList.innerHTML = `<div class="empty-state">No pending Codex approval or input requests.</div>`;
    return;
  }

  for (const request of entries) {
    const row = document.createElement("article");
    row.className = `codex-request-item status-${request.status || "pending"}`;
    row.innerHTML = `
      <div class="codex-request-summary">
        <span class="role-badge"></span>
        <strong class="truncate"></strong>
        <span class="codex-request-meta truncate"></span>
      </div>
      <div class="codex-request-actions">
        <button class="ghost small focus-request" type="button">Focus</button>
        <button class="ghost small decline-request" type="button">Decline</button>
        <button class="ghost small cancel-request" type="button">Cancel</button>
      </div>
    `;
    row.querySelector(".role-badge").textContent = `${request.riskCategory || "request"} · ${request.status || "pending"}`;
    row.querySelector("strong").textContent = request.title || request.method || "Codex request";
    row.querySelector(".codex-request-meta").textContent = request.summary || request.method || "";
    row.querySelector(".focus-request").addEventListener("click", async () => {
      try {
        await bridge.focusCodexRequest(request.key);
        setLastEvent(`Focused Codex request: ${request.title || request.method}.`);
      } catch (error) {
        setLastEvent(`Codex request focus failed: ${error.message}`);
      }
    });
    row.querySelector(".decline-request").disabled = request.status !== "pending" || !codexRequestResultForAction(request, "decline");
    row.querySelector(".cancel-request").disabled = request.status !== "pending" || !codexRequestResultForAction(request, "cancel");
    row.querySelector(".decline-request").addEventListener("click", async () => {
      const result = codexRequestResultForAction(request, "decline");
      if (!result) return;
      try {
        await bridge.respondCodexRequest(request.key, result);
        setLastEvent(`Declined Codex request: ${request.title || request.method}.`);
      } catch (error) {
        setLastEvent(`Codex request decline failed: ${error.message}`);
      }
    });
    row.querySelector(".cancel-request").addEventListener("click", async () => {
      const result = codexRequestResultForAction(request, "cancel");
      if (!result) return;
      try {
        await bridge.respondCodexRequest(request.key, result);
        setLastEvent(`Canceled Codex request: ${request.title || request.method}.`);
      } catch (error) {
        setLastEvent(`Codex request cancel failed: ${error.message}`);
      }
    });
    els.codexRequestList.appendChild(row);
  }
}

function renderWatchedArtifacts() {
  els.watchedCount.textContent = String(state.watchedArtifacts.length);
  els.watchedArtifactList.innerHTML = "";
  if (state.watchedArtifactsScan?.warning) {
    const warning = document.createElement("div");
    warning.className = "empty-state";
    warning.textContent = state.watchedArtifactsScan.warning;
    els.watchedArtifactList.appendChild(warning);
  }
  if (!state.watchedArtifacts.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No matching review artifacts detected. Scan uses configured watched patterns through the workspace backend.";
    els.watchedArtifactList.appendChild(empty);
    return;
  }
  for (const artifact of state.watchedArtifacts) {
    const row = document.createElement("article");
    row.className = "artifact-item";
    row.innerHTML = `
      <div class="artifact-summary">
        <strong class="truncate"></strong>
        <span class="artifact-meta"></span>
      </div>
      <div class="artifact-actions">
        <button class="ghost small preview-artifact" type="button">Preview</button>
        <button class="primary small stage-artifact" type="button">Stage for review</button>
        <button class="ghost small ignore-artifact" type="button">Ignore</button>
      </div>
    `;
    row.querySelector("strong").textContent = artifact.relPath;
    row.querySelector(".artifact-meta").textContent = `${formatBytes(artifact.size)}${artifact.mtime ? ` · ${formatTime(artifact.mtime)}` : ""}`;
    row.querySelector(".preview-artifact").addEventListener("click", () => previewFile(artifact.relPath));
    row.querySelector(".stage-artifact").addEventListener("click", () => stageFileHandoff(artifact.relPath, primaryReviewThread(activeProject())?.id, "workspace"));
    row.querySelector(".ignore-artifact").addEventListener("click", () => ignoreWatchedArtifact(artifact.relPath));
    els.watchedArtifactList.appendChild(row);
  }
}

function analyticsStatusLabel(entry) {
  if (!entry) return "never processed";
  if (entry.status === "unavailable") return "unavailable";
  if (entry.parseStatus === "error" || entry.status === "error") return "error";
  if (!entry.snapshotId) return "never processed";
  return entry.parseStatus === "ready" ? "ready" : entry.status || "ready";
}

function analyticsMetric(dashboard, key) {
  return dashboard?.metrics?.[key] || null;
}

function analyticsMetricDisplay(metric, key) {
  if (!metric) return "—";
  const numeric = Number(metric.numValue);
  if (Number.isFinite(numeric)) {
    if (metric.unit === "ms" || key.endsWith("_ms")) return formatDurationMs(numeric);
    if (metric.unit === "ratio" || key.endsWith("_ratio")) return `${(numeric * 100).toFixed(1)}%`;
    if (Math.abs(numeric) >= 1000) return Math.round(numeric).toLocaleString();
    if (Number.isInteger(numeric)) return String(numeric);
    return numeric.toFixed(2);
  }
  return metric.textValue || "—";
}

function buildAnalyticsBarChart(title, points, options = {}) {
  const wrapper = document.createElement("section");
  wrapper.className = "analytics-chart";
  const heading = document.createElement("h4");
  heading.textContent = title;
  wrapper.appendChild(heading);

  const rows = Array.isArray(points) ? points : [];
  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No data in this snapshot yet.";
    wrapper.appendChild(empty);
    return wrapper;
  }

  const values = rows.map((point) => Number(point?.yValue)).filter((value) => Number.isFinite(value));
  const maxValue = values.length ? Math.max(...values, 1) : 1;
  const list = document.createElement("div");
  list.className = "analytics-bars";
  const capped = rows.slice(0, Math.max(1, Number(options.limit) || 8));

  for (const point of capped) {
    const numeric = Number(point?.yValue);
    const value = Number.isFinite(numeric) ? numeric : 0;
    const label = point?.xValue || point?.payload?.label || "item";
    const row = document.createElement("div");
    row.className = "analytics-bar-row";
    const labelNode = document.createElement("span");
    labelNode.textContent = label;
    const bar = document.createElement("div");
    bar.className = "analytics-bar";
    const fill = document.createElement("div");
    fill.className = "analytics-bar-fill";
    fill.style.width = `${Math.max(0, Math.min(100, (value / maxValue) * 100))}%`;
    bar.appendChild(fill);
    const valueNode = document.createElement("span");
    if (typeof options.valueFormatter === "function") valueNode.textContent = options.valueFormatter(value);
    else valueNode.textContent = Math.round(value).toLocaleString();
    row.append(labelNode, bar, valueNode);
    list.appendChild(row);
  }

  wrapper.appendChild(list);
  return wrapper;
}

function usageLedgerNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return Math.round(number).toLocaleString();
}

function usageLedgerMetricCard(label, value, evidence = "") {
  const card = document.createElement("article");
  card.className = "analytics-metric-card";
  const keyNode = document.createElement("span");
  keyNode.className = "metric-key";
  keyNode.textContent = label;
  const valueNode = document.createElement("strong");
  valueNode.className = "metric-value";
  valueNode.textContent = value;
  const evidenceNode = document.createElement("span");
  evidenceNode.className = "metric-evidence";
  evidenceNode.textContent = evidence || "Evidence: —";
  card.append(keyNode, valueNode, evidenceNode);
  return card;
}

function usageLedgerResetLabel(window) {
  const resetsAt = window?.resetsAt;
  if (!resetsAt) return "";
  const date = new Date(resetsAt);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function usageLedgerRateLimitLabel(window, fallbackLabel) {
  if (!window) return "";
  const percent = Number(window.usedPercent);
  const used = Number.isFinite(percent) ? `${Math.round(percent)}%` : "unknown";
  const reset = usageLedgerResetLabel(window);
  return `${fallbackLabel} ${used}${reset ? ` reset ${reset}` : ""}`;
}

function renderUsageLedgerAnalytics(dashboard) {
  const ledger = dashboard?.usageLedger;
  const wrapper = document.createElement("section");
  wrapper.className = "analytics-ledger-section";

  const header = document.createElement("div");
  header.className = "analytics-ledger-header";
  const title = document.createElement("h4");
  title.textContent = "Usage ledger";
  const status = document.createElement("span");
  status.className = `status-chip status-${ledger?.status || "unavailable"}`;
  status.textContent = ledger?.status || "unavailable";
  header.append(title, status);
  wrapper.appendChild(header);

  if (!ledger || !["available", "partial"].includes(ledger.status)) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = ledger?.reason || "No usage ledger evidence is available for this thread yet.";
    wrapper.appendChild(empty);
    return wrapper;
  }

  const tokens = ledger.tokens || {};
  const turns = ledger.turns || {};
  const tools = ledger.tools || {};
  const requests = ledger.requests || {};
  const metricGrid = document.createElement("div");
  metricGrid.className = "analytics-ledger-grid";
  metricGrid.append(
    usageLedgerMetricCard("Token snapshot", usageLedgerNumber(tokens.totalTokens), `Source: ${tokens.usageScope || "snapshot"} · ${tokens.confidence || "unknown"}`),
    usageLedgerMetricCard("Input / cached", `${usageLedgerNumber(tokens.inputTokens)} / ${usageLedgerNumber(tokens.cachedInputTokens)}`, "Latest provider token row"),
    usageLedgerMetricCard("Output / reasoning", `${usageLedgerNumber(tokens.outputTokens)} / ${usageLedgerNumber(tokens.reasoningOutputTokens)}`, "Latest provider token row"),
    usageLedgerMetricCard("Turns", `${usageLedgerNumber(turns.completed)} done · ${usageLedgerNumber(turns.active)} active`, `Avg first token: ${formatDurationMs(turns.timeToFirstTokenMs)}`),
    usageLedgerMetricCard("Tool calls", `${usageLedgerNumber(tools.total)} total · ${usageLedgerNumber(tools.failed)} failed`, `${usageLedgerNumber(tools.commands)} commands · ${usageLedgerNumber(tools.patches)} patches`),
    usageLedgerMetricCard("Requests", `${usageLedgerNumber(requests.total)} total`, `${usageLedgerNumber(requests.pending)} pending · ${usageLedgerNumber(requests.resolved)} resolved`),
  );
  wrapper.appendChild(metricGrid);

  const rateLimit = ledger.rateLimits || {};
  if (rateLimit.status === "available") {
    const rateLine = document.createElement("p");
    rateLine.className = "analytics-ledger-evidence";
    const primary = usageLedgerRateLimitLabel(rateLimit.primary, "Primary");
    const secondary = usageLedgerRateLimitLabel(rateLimit.secondary, "Secondary");
    rateLine.textContent = [
      rateLimit.planType ? `Plan: ${rateLimit.planType}` : "",
      primary,
      secondary,
      rateLimit.observedAt ? `Observed ${formatTime(rateLimit.observedAt)}` : "",
    ].filter(Boolean).join(" · ");
    wrapper.appendChild(rateLine);
  }

  const chartGrid = document.createElement("div");
  chartGrid.className = "analytics-ledger-charts";
  const series = ledger.series || {};
  chartGrid.append(
    buildAnalyticsBarChart("Token mix", series.token_mix || []),
    buildAnalyticsBarChart("Ledger tool mix", series.tool_kind_mix || []),
  );
  if (Array.isArray(series.request_kind_mix) && series.request_kind_mix.length) {
    chartGrid.appendChild(buildAnalyticsBarChart("Request mix", series.request_kind_mix));
  }
  wrapper.appendChild(chartGrid);

  const evidence = document.createElement("p");
  evidence.className = "analytics-ledger-evidence";
  evidence.textContent = [
    `${usageLedgerNumber(ledger.matchedRowCount)} matched rows`,
    `${usageLedgerNumber(ledger.fileCount)} ledger files`,
    ledger.rowLimitReached ? "row limit reached" : "",
    ledger.lastObservedAt ? `Last observed ${formatTime(ledger.lastObservedAt)}` : "",
    ledger.outputDirEvidenceKey ? `Path witness ${ledger.outputDirEvidenceKey}` : "",
  ].filter(Boolean).join(" · ");
  wrapper.appendChild(evidence);
  return wrapper;
}

function renderAnalyticsThreadList() {
  els.analyticsThreadCount.textContent = String(state.analyticsThreads.length);
  els.analyticsThreadList.innerHTML = "";

  if (state.analyticsStatus === "loading") {
    els.analyticsThreadList.innerHTML = `<div class="empty-state">Loading saved analytics from local database…</div>`;
    return;
  }

  if (!state.analyticsThreads.length) {
    els.analyticsThreadList.innerHTML = `<div class="empty-state">No analytics snapshots yet. Click Update analytics to scan new/changed Codex threads for this project.</div>`;
    return;
  }

  for (const entry of state.analyticsThreads) {
    const row = document.createElement("article");
    row.className = `thread-browser-item${entry.threadKey === state.selectedAnalyticsThreadKey ? " active" : ""}`;
    row.innerHTML = `
      <div class="thread-topline">
        <span class="role-badge"></span>
        <strong class="truncate"></strong>
      </div>
      <span class="thread-meta truncate"></span>
      <span class="thread-notes truncate"></span>
    `;
    const statusLabel = analyticsStatusLabel(entry);
    row.querySelector(".role-badge").textContent = `${entry.lane ? `${roleLabel(entry.lane)} · ` : ""}${statusLabel}`;
    row.querySelector("strong").textContent = entry.title || "Untitled Codex thread";
    row.querySelector(".thread-meta").textContent = shortPath(entry.cwd || "");
    row.querySelector(".thread-notes").textContent = entry.updatedAt
      ? `Updated ${formatTime(entry.updatedAt)}`
      : "No source timestamp";
    row.addEventListener("click", () => {
      selectAnalyticsThread(entry.threadKey).catch((error) => {
        setLastEvent(`Analytics dashboard load failed: ${error.message}`);
      });
    });
    els.analyticsThreadList.appendChild(row);
  }
}

function renderAnalyticsDashboard() {
  const container = els.analyticsDashboard;
  container.innerHTML = "";

  if (state.analyticsDashboardStatus === "loading") {
    container.innerHTML = `<div class="empty-state">Loading analytics dashboard…</div>`;
    return;
  }

  if (!state.selectedAnalyticsThreadKey) {
    container.innerHTML = `<div class="empty-state">Select a thread to view saved metrics and chart series.</div>`;
    return;
  }

  const dashboard = state.analyticsDashboard;
  if (!dashboard?.thread) {
    container.innerHTML = `<div class="empty-state">No analytics snapshot for this thread yet. Run Update analytics first.</div>`;
    return;
  }

  const threadMeta = document.createElement("div");
  threadMeta.className = "analytics-chart";
  const heading = document.createElement("h4");
  heading.textContent = dashboard.thread.title || "Thread analytics";
  const meta = document.createElement("p");
  meta.className = "muted";
  const processedAt = dashboard.snapshot?.processedAt ? formatTime(dashboard.snapshot.processedAt) : "not processed";
  meta.textContent = `Status: ${analyticsStatusLabel(dashboard.thread)} · Snapshot: ${processedAt} · Originator: ${dashboard.thread.originator || "unknown"}`;
  threadMeta.append(heading, meta);
  container.appendChild(threadMeta);

  const summaryStrip = document.createElement("div");
  summaryStrip.className = "analytics-summary-strip";
  const summaryMetrics = [
    ["turn_count", "Turns"],
    ["thread_wall_clock_span_ms", "Total period"],
    ["thread_active_work_time_ms", "Active work"],
    ["thread_utilization_ratio", "Utilization"],
    ["command_execution_count", "Tool calls"],
    ["reasoning_item_count", "Reasoning items"],
  ];
  for (const [key, label] of summaryMetrics) {
    const metric = analyticsMetric(dashboard, key);
    const card = document.createElement("article");
    card.className = "analytics-metric-card";
    const keyNode = document.createElement("span");
    keyNode.className = "metric-key";
    keyNode.textContent = label;
    const valueNode = document.createElement("strong");
    valueNode.className = "metric-value";
    valueNode.textContent = analyticsMetricDisplay(metric, key);
    const evidenceNode = document.createElement("span");
    evidenceNode.className = "metric-evidence";
    evidenceNode.textContent = metric?.evidenceGrade ? `Evidence: ${metric.evidenceGrade}` : "Evidence: —";
    card.append(keyNode, valueNode, evidenceNode);
    summaryStrip.appendChild(card);
  }
  container.appendChild(summaryStrip);
  container.appendChild(renderUsageLedgerAnalytics(dashboard));

  const series = dashboard.series || {};
  container.appendChild(buildAnalyticsBarChart("Work composition", series.work_composition || []));
  container.appendChild(buildAnalyticsBarChart("Tool mix", series.tool_mix || []));
  const recentDensity = Array.isArray(series.activity_density) ? series.activity_density.slice(-12) : [];
  container.appendChild(buildAnalyticsBarChart("Activity density (recent buckets)", recentDensity, { valueFormatter: (value) => String(Math.round(value)) }));
  const topGaps = Array.isArray(series.gap_map)
    ? series.gap_map.slice().sort((a, b) => Number(b?.yValue || 0) - Number(a?.yValue || 0)).slice(0, 8)
    : [];
  container.appendChild(buildAnalyticsBarChart("Longest idle gaps", topGaps, { valueFormatter: (value) => formatDurationMs(value) }));
}

function renderAnalyticsPanel() {
  const loading = state.analyticsStatus === "updating";
  els.updateAnalyticsButton.disabled = loading;
  els.analyticsHint.textContent = loading
    ? "Updating analytics snapshots for new/changed project threads…"
    : "Select a thread to load its persisted analytics snapshot.";
  renderAnalyticsThreadList();
  renderAnalyticsDashboard();
}

function render() {
  if (!state.config) return;
  els.configPath.textContent = state.configPath;
  els.configPath.title = state.configPath;
  renderMiddleTabs();
  renderProjectList();
  renderSelectedProject();
  renderThreadDeck();
  renderProjectStash();
  renderDirectBridgeSettingsStatus();
  renderThreadsWorkbench();
  renderDirectImportWorkbench();
  renderAnalyticsPanel();
  renderHandoffTargetSelect();
  renderPromptPreview();
  renderHandoffQueue();
  renderCodexRequests();
  renderWatchedArtifacts();
  renderDirectAuthControls();
  renderDirectMetaSessionStatus();
  renderStatus();
  renderRightPlaneTabs();
  scheduleResizeBurst();
}

function getUiRatios() {
  const ui = state.config?.ui ?? {};
  return {
    leftRatio: Number.isFinite(Number(ui.leftRatio)) ? Number(ui.leftRatio) : 0.34,
    middleRatio: Number.isFinite(Number(ui.middleRatio)) ? Number(ui.middleRatio) : 0.3,
  };
}

function computePlaneWidths() {
  const rect = els.appShell.getBoundingClientRect();
  const split = MIN_WIDTHS.splitter;
  const total = Math.max(1, Math.round(rect.width) - split * 2);
  const ratios = getUiRatios();

  const minSum = MIN_WIDTHS.left + MIN_WIDTHS.middle + MIN_WIDTHS.right;
  if (total <= minSum) {
    const scale = total / minSum;
    const left = Math.max(280, Math.floor(MIN_WIDTHS.left * scale));
    const middle = Math.max(340, Math.floor(MIN_WIDTHS.middle * scale));
    const right = Math.max(280, total - left - middle);
    return { left, middle, right, total };
  }

  let left = Math.round(total * ratios.leftRatio);
  left = clamp(left, MIN_WIDTHS.left, total - MIN_WIDTHS.middle - MIN_WIDTHS.right);

  let middle = Math.round(total * ratios.middleRatio);
  middle = clamp(middle, MIN_WIDTHS.middle, total - left - MIN_WIDTHS.right);

  let right = total - left - middle;
  if (right < MIN_WIDTHS.right) {
    const deficit = MIN_WIDTHS.right - right;
    const middleCanGive = Math.max(0, middle - MIN_WIDTHS.middle);
    const giveFromMiddle = Math.min(deficit, middleCanGive);
    middle -= giveFromMiddle;
    left = Math.max(MIN_WIDTHS.left, left - (deficit - giveFromMiddle));
    right = total - left - middle;
  }

  return { left, middle, right, total };
}

function applyPlaneWidths() {
  const widths = computePlaneWidths();
  state.currentWidths = widths;
  document.documentElement.style.setProperty("--left-plane-width", `${widths.left}px`);
  document.documentElement.style.setProperty("--control-plane-width", `${widths.middle}px`);
  return widths;
}

function rectToBounds(rect) {
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}

function sendSurfaceLayout() {
  if (!bridge || !els.codexSlot || !els.chatgptSlot) return;
  const codex = rectToBounds(els.codexSlot.getBoundingClientRect());
  const hiddenNativeBounds = { x: -12000, y: -12000, width: 1, height: 1 };
  const chatgpt = state.activeRightTab === "chatgpt"
    ? rectToBounds(els.chatgptSlot.getBoundingClientRect())
    : hiddenNativeBounds;
  const web = els.middleWebSlot ? rectToBounds(els.middleWebSlot.getBoundingClientRect()) : { x: 0, y: 0, width: 1, height: 1 };
  const webVisible = state.activeMiddleTab === "web" &&
    state.middleWebViewMode !== "history" &&
    Boolean(state.middleWeb?.hasPage || state.middleWeb?.displayUrl);
  const signature = [
    `${codex.x},${codex.y},${codex.width},${codex.height}`,
    `${chatgpt.x},${chatgpt.y},${chatgpt.width},${chatgpt.height},${state.activeRightTab}`,
    `${web.x},${web.y},${web.width},${web.height},${webVisible ? 1 : 0},${state.activeMiddleTab}`,
  ].join("|");
  if (signature === state.lastLayoutSignature) return;
  state.lastLayoutSignature = signature;
  bridge.setSurfaceLayout({ codex, chatgpt }).catch((error) => {
    console.error("Unable to set surface layout", error);
  });
  if (bridge.setMiddleWebLayout) {
    state.middleWebLayoutRevision += 1;
    bridge.setMiddleWebLayout({
      visible: webVisible,
      bounds: web,
      tab: state.activeMiddleTab,
      layoutRevision: state.middleWebLayoutRevision,
    }).catch((error) => {
      console.error("Unable to set middle Web layout", error);
    });
  }
}

function performLayout() {
  applyPlaneWidths();
  sendSurfaceLayout();
}

function scheduleLayout() {
  if (state.layoutFrame) cancelAnimationFrame(state.layoutFrame);
  state.layoutFrame = requestAnimationFrame(() => {
    state.layoutFrame = 0;
    performLayout();
  });
}

function scheduleResizeBurst() {
  state.lastLayoutSignature = "";
  for (const delay of [0, 16, 48, 110, 240, 480]) setTimeout(scheduleLayout, delay);
}

async function saveConfig(config) {
  const result = await bridge.saveConfig(config);
  state.config = result.config;
  state.configPath = result.configPath;
  render();
  return result.config;
}

async function loadCodexThreads(options = {}) {
  const snapshot = {
    ...projectRequestSnapshot(),
    ...(options || {}),
  };
  if (!snapshot.projectId || !bridge.listCodexThreads) return;
  const requestVersion = nextRequestVersion("codexThreads");
  try {
    const result = await bridge.listCodexThreads(snapshot.projectId);
    if (isRequestStale("codexThreads", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.codexThreads = result.entries || [];
    if (result.fallback?.mode === "fast" && result.fallback?.reason) {
      setLastEvent(`Codex thread discovery used fast fallback: ${result.fallback.reason}`);
    }
  } catch (error) {
    if (isRequestStale("codexThreads", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.codexThreads = [];
    setLastEvent(`Codex thread discovery failed: ${error.message}`);
  }
  if (isRequestStale("codexThreads", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
  if (state.selectedCodexThreadId && !codexThreadById(state.selectedCodexThreadId)) state.selectedCodexThreadId = "";
  renderThreadsWorkbench();
}

async function loadChatgptRecentThreads(options = {}) {
  const snapshot = {
    ...projectRequestSnapshot(),
    ...(options || {}),
  };
  if (!snapshot.projectId) return;
  if (!bridge.listChatgptRecentThreads && !bridge.listCachedChatgptRecentThreads) return;
  const refresh = Boolean(options?.refresh);
  const requestVersion = nextRequestVersion("recentThreads");
  state.chatgptRecentThreadsStatus = "loading";
  state.chatgptRecentThreadsLoadingMode = refresh ? "refresh" : "cache";
  renderThreadsWorkbench();
  try {
    const result = refresh
      ? await bridge.listChatgptRecentThreads(120, { refresh: true })
      : bridge.listCachedChatgptRecentThreads
        ? await bridge.listCachedChatgptRecentThreads(120)
        : await bridge.listChatgptRecentThreads(120, { refresh: false });
    if (isRequestStale("recentThreads", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.chatgptRecentThreads = Array.isArray(result.entries) ? result.entries : [];
    state.chatgptRecentThreadsSource = result.source || "";
    state.chatgptRecentThreadsStatus = result.available === false ? "unavailable" : "loaded";
    if (result.error) {
      const modeLabel = refresh ? "refresh" : "cache load";
      setLastEvent(`ChatGPT recent-thread ${modeLabel}: ${result.error}`);
    }
  } catch (error) {
    if (isRequestStale("recentThreads", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.chatgptRecentThreads = [];
    state.chatgptRecentThreadsSource = "error";
    state.chatgptRecentThreadsStatus = "error";
    const modeLabel = refresh ? "refresh" : "cache load";
    setLastEvent(`ChatGPT recent-thread ${modeLabel} failed: ${error.message}`);
  }
  if (isRequestStale("recentThreads", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
  if (state.selectedRecentChatgptThreadId && !recentChatgptThreadById(state.selectedRecentChatgptThreadId)) {
    state.selectedRecentChatgptThreadId = "";
  }
  renderThreadsWorkbench();
}

async function loadAnalyticsThreads(options = {}) {
  const snapshot = {
    ...projectRequestSnapshot(),
    ...(options || {}),
  };
  if (!snapshot.projectId || !bridge.listThreadAnalytics) return;
  const requestVersion = nextRequestVersion("analyticsThreads");
  state.analyticsStatus = options?.refresh ? "updating" : "loading";
  renderAnalyticsPanel();
  try {
    const result = await bridge.listThreadAnalytics(snapshot.projectId, { limit: 260 });
    if (isRequestStale("analyticsThreads", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.analyticsThreads = Array.isArray(result?.entries) ? result.entries : [];
    state.analyticsStatus = "loaded";
  } catch (error) {
    if (isRequestStale("analyticsThreads", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.analyticsThreads = [];
    state.analyticsStatus = "error";
    setLastEvent(`Analytics list load failed: ${error.message}`);
  }
  if (isRequestStale("analyticsThreads", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
  if (state.selectedAnalyticsThreadKey && !state.analyticsThreads.find((entry) => entry.threadKey === state.selectedAnalyticsThreadKey)) {
    state.selectedAnalyticsThreadKey = "";
    state.analyticsDashboard = null;
    state.analyticsDashboardStatus = "idle";
  }
  renderAnalyticsPanel();
}

async function selectAnalyticsThread(threadKey) {
  const project = activeProject();
  const key = String(threadKey || "").trim();
  if (!project || !key || !bridge.getThreadAnalytics) return;
  state.selectedAnalyticsThreadKey = key;
  state.analyticsDashboardStatus = "loading";
  renderAnalyticsPanel();
  const requestVersion = nextRequestVersion("analyticsDetail");
  const snapshot = { projectId: project.id, projectVersion: Number(state.requestVersions.project || 0) };
  try {
    const result = await bridge.getThreadAnalytics(project.id, key);
    if (isRequestStale("analyticsDetail", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.analyticsDashboard = result?.dashboard || null;
    state.analyticsDashboardStatus = "loaded";
  } catch (error) {
    if (isRequestStale("analyticsDetail", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.analyticsDashboard = null;
    state.analyticsDashboardStatus = "error";
    setLastEvent(`Analytics dashboard load failed: ${error.message}`);
  }
  if (isRequestStale("analyticsDetail", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
  renderAnalyticsPanel();
}

async function loadDirectImports(options = {}) {
  const project = activeProject();
  if (!project || !bridge.listDirectImports) return;
  const requestVersion = nextRequestVersion("directImports");
  const snapshot = { projectId: project.id, projectVersion: Number(state.requestVersions.project || 0) };
  state.directImportWorkbench.status = options?.refresh || state.directImportWorkbench.status === "idle"
    ? "loading"
    : state.directImportWorkbench.status || "loading";
  state.directImportWorkbench.lastError = "";
  renderDirectImportWorkbench();
  try {
    const result = await bridge.listDirectImports(project.id, { includeHidden: Boolean(state.directImportWorkbench.includeHidden) });
    if (isRequestStale("directImports", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.directImportWorkbench.projectId = project.id;
    state.directImportWorkbench.imports = Array.isArray(result?.entries) ? result.entries : [];
    state.directImportWorkbench.status = "loaded";
    if (state.directImportWorkbench.selectedImportId &&
      !state.directImportWorkbench.imports.find((entry) => entry.importId === state.directImportWorkbench.selectedImportId)) {
      state.directImportWorkbench.selectedImportId = "";
      state.directImportWorkbench.selectedSessionId = "";
      state.directImportWorkbench.report = null;
      state.directImportWorkbench.selectedImportSession = null;
    }
  } catch (error) {
    if (isRequestStale("directImports", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.directImportWorkbench.status = "error";
    state.directImportWorkbench.lastError = `Import list failed: ${error.message}`;
  }
  if (isRequestStale("directImports", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
  renderDirectImportWorkbench();
  await refreshDirectRuntimeStatus(project.id);
}

async function loadDirectThreadWorkbench(options = {}) {
  const project = activeProject();
  if (!project || !bridge.getDirectThreadWorkbenchSnapshot) return;
  const requestVersion = nextRequestVersion("directThreadWorkbench");
  const snapshot = { projectId: project.id, projectVersion: Number(state.requestVersions.project || 0) };
  state.directThreadWorkbench.status = options?.refresh || state.directThreadWorkbench.status === "idle"
    ? "loading"
    : state.directThreadWorkbench.status || "loading";
  state.directThreadWorkbench.lastError = "";
  renderDirectThreadWorkbench();
  try {
    const result = await bridge.getDirectThreadWorkbenchSnapshot(project.id, {
      refresh: Boolean(options?.refresh),
      filters: state.directThreadWorkbench.filters,
      page: {
        threads: { offset: 0, limit: 80 },
        operations: { offset: 0, limit: 20 },
      },
    });
    if (isRequestStale("directThreadWorkbench", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.directThreadWorkbench.projectId = project.id;
    state.directThreadWorkbench.snapshot = result || null;
    if (bridge.getDirectThreadEvidenceWorkbenchProjection) {
      try {
        state.directThreadWorkbench.evidenceProjection = await bridge.getDirectThreadEvidenceWorkbenchProjection(project.id, {
          refresh: false,
          filters: state.directThreadWorkbench.filters,
          page: {
            threads: { offset: 0, limit: 80 },
            operations: { offset: 0, limit: 20 },
          },
        });
      } catch (projectionError) {
        state.directThreadWorkbench.evidenceProjection = result?.evidenceWorkbench || null;
      }
    } else {
      state.directThreadWorkbench.evidenceProjection = result?.evidenceWorkbench || null;
    }
    state.directThreadWorkbench.status = "loaded";
    const threads = result?.threads || [];
    if (state.directThreadWorkbench.selectedThreadId && !threads.find((thread) => thread.threadId === state.directThreadWorkbench.selectedThreadId)) {
      state.directThreadWorkbench.selectedThreadId = "";
      state.directThreadWorkbench.selectedProjection = null;
      state.directThreadWorkbench.selectedPreviewId = "";
      state.directThreadWorkbench.selectedPreview = null;
      state.directThreadWorkbench.forkStartPrompt = "";
    }
  } catch (error) {
    if (isRequestStale("directThreadWorkbench", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.directThreadWorkbench.status = "error";
    state.directThreadWorkbench.lastError = `Direct thread workbench failed: ${error.message}`;
    setLastEvent(state.directThreadWorkbench.lastError);
  }
  if (isRequestStale("directThreadWorkbench", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
  renderDirectThreadWorkbench();
}

async function selectDirectWorkbenchThread(threadId) {
  const project = activeProject();
  const id = String(threadId || "").trim();
  if (!project || !id || !bridge.readDirectThreadWorkbenchThreadProjection) return;
  const threadChanged = state.directThreadWorkbench.selectedThreadId !== id;
  state.directThreadWorkbench.selectedThreadId = id;
  state.directThreadWorkbench.selectedProjection = null;
  if (threadChanged) {
    state.directThreadWorkbench.selectedPreviewId = "";
    state.directThreadWorkbench.selectedPreview = null;
    state.directThreadWorkbench.forkStartPrompt = "";
  }
  state.directThreadWorkbench.status = "working";
  renderDirectThreadWorkbench();
  const requestVersion = nextRequestVersion("directThreadWorkbenchOperation");
  const snapshot = { projectId: project.id, projectVersion: Number(state.requestVersions.project || 0) };
  try {
    const result = await bridge.readDirectThreadWorkbenchThreadProjection(project.id, id, {
      offset: 0,
      limit: 80,
    });
    if (isRequestStale("directThreadWorkbenchOperation", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.directThreadWorkbench.selectedProjection = result || null;
    state.directThreadWorkbench.status = "loaded";
  } catch (error) {
    if (isRequestStale("directThreadWorkbenchOperation", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.directThreadWorkbench.status = "error";
    state.directThreadWorkbench.lastError = `Direct thread projection failed: ${error.message}`;
    setLastEvent(state.directThreadWorkbench.lastError);
  }
  if (isRequestStale("directThreadWorkbenchOperation", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
  renderDirectThreadWorkbench();
}

async function openDirectWorkbenchThreadInCodexPlane(threadId) {
  const project = activeProject();
  const id = String(threadId || "").trim();
  if (!project || !id || !bridge.selectCodexThread) return;
  const thread = selectedDirectWorkbenchThread();
  if (!thread || thread.threadId !== id || !canOpenDirectWorkbenchThreadInCodexPlane(thread)) {
    setLastEvent("Direct thread open skipped: selected workbench item is not a runnable direct session.");
    renderDirectThreadWorkbench();
    return;
  }
  const snapshot = { projectId: project.id, projectVersion: Number(state.requestVersions.project || 0) };
  const requestVersion = nextRequestVersion("directThreadWorkbenchOperation");
  state.directThreadWorkbench.status = "working";
  renderDirectThreadWorkbench();
  try {
    const result = await bridge.selectCodexThread(project.id, id, "", "");
    if (isRequestStale("directThreadWorkbenchOperation", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.directThreadWorkbench.status = "loaded";
    if (!result?.ok) {
      setLastEvent(`Direct thread open skipped: ${result?.error || "unknown reason"}`);
      renderDirectThreadWorkbench();
      return;
    }
    state.selectedCodexThreadId = id;
    if (result.warning) {
      setLastEvent(`Requested direct thread in Codex plane with warning: ${result.warning}`);
    } else {
      setLastEvent(`Requested direct thread in Codex plane: ${thread?.title || id}.`);
    }
  } catch (error) {
    if (isRequestStale("directThreadWorkbenchOperation", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.directThreadWorkbench.status = "error";
    state.directThreadWorkbench.lastError = `Direct thread open failed: ${error.message}`;
    setLastEvent(state.directThreadWorkbench.lastError);
  }
  if (isRequestStale("directThreadWorkbenchOperation", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
  renderSelectedProject();
  renderDirectThreadWorkbench();
}

async function runDirectThreadLifecycle(action) {
  const project = activeProject();
  const thread = selectedDirectWorkbenchThread();
  if (!project || !thread || !bridge.runDirectThreadLifecycleAction) return;
  let confirmationId = "";
  if (action === "soft_delete") {
    const prepared = await bridge.prepareDirectThreadSoftDelete(project.id, thread.threadId, directThreadWorkbenchExpectedInput({
      expectedLifecycleState: thread.lifecycle?.state || "active",
    }));
    const confirmed = confirm(`Soft delete "${prepared.rendererSafeThreadLabel}"? This is reversible and does not purge artifacts.`);
    if (!confirmed) return;
    confirmationId = prepared.confirmationId || "";
  }
  state.directThreadWorkbench.status = "working";
  renderDirectThreadWorkbench();
  const requestVersion = nextRequestVersion("directThreadWorkbenchOperation");
  const snapshot = { projectId: project.id, projectVersion: Number(state.requestVersions.project || 0) };
  try {
    const result = await bridge.runDirectThreadLifecycleAction(project.id, directThreadWorkbenchExpectedInput({
      clientOperationId: createId(`direct_${action}`),
      threadId: thread.threadId,
      action,
      confirmationId,
      expectedLifecycleState: thread.lifecycle?.state || "active",
      expectedRendererProjectionId: thread.rendererProjection?.projectionId || "",
      expectedRendererProjectionDigest: thread.rendererProjection?.projectionDigest || "",
    }));
    if (isRequestStale("directThreadWorkbenchOperation", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    setLastEvent(`Direct thread operation ${result.status}: ${action}.`);
    await loadDirectThreadWorkbench({ refresh: true });
  } catch (error) {
    if (isRequestStale("directThreadWorkbenchOperation", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.directThreadWorkbench.status = "error";
    state.directThreadWorkbench.lastError = `Direct thread operation failed: ${error.message}`;
    setLastEvent(state.directThreadWorkbench.lastError);
    renderDirectThreadWorkbench();
  }
}

async function createDirectThreadPreview(kind) {
  const project = activeProject();
  const thread = selectedDirectWorkbenchThread();
  if (!project || !thread) return;
  const expected = directThreadWorkbenchExpectedInput({
    clientOperationId: createId(`direct_${kind}_preview`),
    threadId: thread.threadId,
    expectedLifecycleState: thread.lifecycle?.state || "active",
    expectedRendererProjectionId: thread.rendererProjection?.projectionId || "",
    expectedRendererProjectionDigest: thread.rendererProjection?.projectionDigest || "",
  });
  state.directThreadWorkbench.status = "working";
  renderDirectThreadWorkbench();
  const requestVersion = nextRequestVersion("directThreadWorkbenchOperation");
  const snapshot = { projectId: project.id, projectVersion: Number(state.requestVersions.project || 0) };
  try {
    let result = null;
    if (kind === "merge") {
      result = await bridge.createDirectThreadMergePreview(project.id, {
        ...directThreadWorkbenchExpectedInput({ clientOperationId: expected.clientOperationId }),
        sources: [{
          threadId: thread.threadId,
          expectedLifecycleState: thread.lifecycle?.state || "active",
          expectedRendererProjectionId: thread.rendererProjection?.projectionId || "",
          expectedRendererProjectionDigest: thread.rendererProjection?.projectionDigest || "",
        }],
      });
    } else if (kind === "prune") {
      const firstKey = state.directThreadWorkbench.selectedProjection?.projection?.items?.[0]?.stableSourceItemKey;
      result = await bridge.createDirectThreadPrunePreview(project.id, {
        ...expected,
        excludedStableSourceItemKeys: firstKey ? [firstKey] : [],
      });
    } else if (kind === "fork") {
      result = await bridge.createDirectThreadForkPreview(project.id, {
        ...expected,
        selectedStableSourceItemKeys: (state.directThreadWorkbench.selectedProjection?.projection?.items || [])
          .slice(0, DIRECT_FORK_PREVIEW_ITEM_CAP)
          .map((item) => item.stableSourceItemKey)
          .filter(Boolean),
      });
    }
    if (isRequestStale("directThreadWorkbenchOperation", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    if (kind === "fork") {
      const loadedCount = state.directThreadWorkbench.selectedProjection?.projection?.items?.length || 0;
      if (loadedCount > DIRECT_FORK_PREVIEW_ITEM_CAP) {
        setLastEvent(`Fork preview seed metadata used first ${DIRECT_FORK_PREVIEW_ITEM_CAP} loaded projection items out of ${loadedCount}.`);
      } else {
        setLastEvent(`Created fork preview (${result?.projectionId || "projection"}).`);
      }
    }
    state.directThreadWorkbench.selectedPreviewId = result?.projectionId || "";
    if (state.directThreadWorkbench.selectedPreviewId && bridge.readDirectThreadWorkbenchPreviewProjection) {
      state.directThreadWorkbench.selectedPreview = await bridge.readDirectThreadWorkbenchPreviewProjection(project.id, state.directThreadWorkbench.selectedPreviewId, {
        offset: 0,
        limit: 60,
        includeSourceRefs: false,
      });
    }
    state.directThreadWorkbench.status = "loaded";
    if (kind !== "fork") setLastEvent(`Created ${kind} preview (${result?.projectionId || "projection"}).`);
    await loadDirectThreadWorkbench({ refresh: true });
  } catch (error) {
    if (isRequestStale("directThreadWorkbenchOperation", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.directThreadWorkbench.status = "error";
    state.directThreadWorkbench.lastError = `${kind} preview failed: ${error.message}`;
    setLastEvent(state.directThreadWorkbench.lastError);
    renderDirectThreadWorkbench();
  }
}

async function startDirectThreadForkFromSelectedPreview() {
  const project = activeProject();
  const preview = state.directThreadWorkbench.selectedPreview?.projection || null;
  const currentUserPrompt = String(state.directThreadWorkbench.forkStartPrompt || "").trim();
  if (!project || !preview || !["fork_preview", "merge_preview", "prune_preview"].includes(preview.projectionKind)) return;
  const isDerivedPreview = preview.projectionKind === "merge_preview" || preview.projectionKind === "prune_preview";
  if (isDerivedPreview) {
    if (!bridge.prepareDirectThreadDerivedPreviewForkStart || !bridge.startDirectThreadForkFromDerivedPreview) return;
  } else if (!bridge.prepareDirectThreadForkStart || !bridge.startDirectThreadForkFromPreview) return;
  if (!currentUserPrompt) {
    setLastEvent("Start fresh fork needs current user intent.");
    return;
  }
  state.directThreadWorkbench.status = "working";
  renderDirectThreadWorkbench();
  const requestVersion = nextRequestVersion("directThreadWorkbenchOperation");
  const snapshot = { projectId: project.id, projectVersion: Number(state.requestVersions.project || 0) };
  try {
    const expected = directThreadWorkbenchExpectedInput({
      sourcePreviewId: preview.projectionId,
      sourcePreviewKind: preview.projectionKind,
      expectedSourcePreviewDigest: preview.projectionDigest || "",
    });
    const prepared = isDerivedPreview
      ? await bridge.prepareDirectThreadDerivedPreviewForkStart(project.id, expected)
      : await bridge.prepareDirectThreadForkStart(project.id, expected);
    if (isRequestStale("directThreadWorkbenchOperation", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    const confirmed = confirm(`Start fresh fork from this preview using ${prepared.selectedModel || "the selected direct model"}? This does not resume provider state.`);
    if (!confirmed) {
      state.directThreadWorkbench.status = "loaded";
      renderDirectThreadWorkbench();
      return;
    }
    const startPayload = directThreadWorkbenchExpectedInput({
      clientForkStartId: createId(isDerivedPreview ? "direct_derived_fork_start" : "direct_fork_start"),
      clientDerivedForkStartId: createId("direct_derived_fork_start"),
      clientOperationId: createId("direct_fork_start_op"),
      confirmationId: prepared.confirmationId,
      sourcePreviewId: prepared.sourcePreviewId,
      sourcePreviewKind: prepared.sourcePreviewKind || preview.projectionKind,
      expectedSourcePreviewDigest: prepared.sourcePreviewDigest,
      expectedSourcePreviewOperationId: prepared.sourcePreviewOperationId || "",
      currentUserPrompt,
      selectedModel: prepared.selectedModel || "",
    });
    const result = isDerivedPreview
      ? await bridge.startDirectThreadForkFromDerivedPreview(project.id, startPayload)
      : await bridge.startDirectThreadForkFromPreview(project.id, startPayload);
    if (isRequestStale("directThreadWorkbenchOperation", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.directThreadWorkbench.forkStartPrompt = "";
    state.directThreadWorkbench.selectedThreadId = result?.threadId || state.directThreadWorkbench.selectedThreadId;
    setLastEvent(`Fresh fork ${result?.status || "started"} (${result?.threadId || "new thread"}).`);
    await loadDirectThreadWorkbench({ refresh: true });
    if (result?.threadId) await selectDirectWorkbenchThread(result.threadId);
  } catch (error) {
    if (isRequestStale("directThreadWorkbenchOperation", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.directThreadWorkbench.status = "error";
    state.directThreadWorkbench.lastError = `Start fresh fork failed: ${error.message}`;
    setLastEvent(state.directThreadWorkbench.lastError);
    renderDirectThreadWorkbench();
  }
}

async function createDirectWorkThreadDraftSession() {
  const project = activeProject();
  if (!project || !bridge.createDirectWorkThreadDraftSession) return;
  const title = String(state.directThreadWorkbench.newThreadDraftTitle || "").trim();
  const objectiveSummary = String(state.directThreadWorkbench.newThreadDraftObjective || "").trim();
  const workThreadId = String(state.directThreadWorkbench.newThreadDraftWorkThreadId || "").trim();
  if (!title || !objectiveSummary) {
    setLastEvent("Local WorkThread draft needs both title and objective.");
    renderDirectThreadWorkbench();
    return;
  }
  state.directThreadWorkbench.status = "working";
  renderDirectThreadWorkbench();
  const requestVersion = nextRequestVersion("directThreadWorkbenchOperation");
  const snapshot = { projectId: project.id, projectVersion: Number(state.requestVersions.project || 0) };
  try {
    const result = await bridge.createDirectWorkThreadDraftSession(project.id, directThreadWorkbenchExpectedInput({
      clientDraftId: createId("direct_workthread_draft"),
      title,
      objectiveSummary,
      workThreadId,
      contextPosture: "explicit_operator_draft",
    }));
    if (isRequestStale("directThreadWorkbenchOperation", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    if (result?.status !== "created") {
      state.directThreadWorkbench.status = "loaded";
      setLastEvent(`Local WorkThread draft blocked: ${(result?.draft?.blockerCodes || []).join(", ") || "unknown blocker"}.`);
      renderDirectThreadWorkbench();
      return;
    }
    state.directThreadWorkbench.newThreadDraftTitle = "";
    state.directThreadWorkbench.newThreadDraftObjective = "";
    state.directThreadWorkbench.newThreadDraftWorkThreadId = "";
    state.directThreadWorkbench.selectedThreadId = result.thread?.threadId || result.thread?.id || "";
    setLastEvent(`Created local WorkThread draft: ${result.thread?.title || result.draft?.title || "direct thread"}.`);
    await loadDirectThreadWorkbench({ refresh: true });
    if (state.directThreadWorkbench.selectedThreadId) await selectDirectWorkbenchThread(state.directThreadWorkbench.selectedThreadId);
  } catch (error) {
    if (isRequestStale("directThreadWorkbenchOperation", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.directThreadWorkbench.status = "error";
    state.directThreadWorkbench.lastError = `Create local WorkThread draft failed: ${error.message}`;
    setLastEvent(state.directThreadWorkbench.lastError);
    renderDirectThreadWorkbench();
  }
}

async function chooseDirectImportFile() {
  const project = activeProject();
  if (!project || !bridge.chooseDirectImportSourceFile) return;
  const requestVersion = nextRequestVersion("directImportOperation");
  const snapshot = { projectId: project.id, projectVersion: Number(state.requestVersions.project || 0) };
  state.directImportWorkbench.status = "working";
  state.directImportWorkbench.lastError = "";
  renderDirectImportWorkbench();
  try {
    const result = await bridge.chooseDirectImportSourceFile(project.id);
    if (isRequestStale("directImportOperation", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    if (!result?.ok || result.canceled) {
      state.directImportWorkbench.status = "loaded";
      renderDirectImportWorkbench();
      return;
    }
    const source = result.source;
    state.directImportWorkbench.sources = source ? [source, ...state.directImportWorkbench.sources.filter((entry) => entry.handleId !== source.handleId)] : state.directImportWorkbench.sources;
    state.directImportWorkbench.selectedHandleId = source?.handleId || "";
    state.directImportWorkbench.selectedImportId = "";
    state.directImportWorkbench.report = null;
    state.directImportWorkbench.selectedImportSession = null;
    state.directImportWorkbench.status = "loaded";
    setLastEvent(`Selected import source: ${source?.sourceDisplayName || "Codex JSONL"}.`);
  } catch (error) {
    if (isRequestStale("directImportOperation", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.directImportWorkbench.status = "error";
    state.directImportWorkbench.lastError = `Choose source failed: ${error.message}`;
  }
  renderDirectImportWorkbench();
}

async function chooseDirectImportRoot() {
  const project = activeProject();
  if (!project || !bridge.chooseDirectImportSourceRoot) return;
  const requestVersion = nextRequestVersion("directImportOperation");
  const snapshot = { projectId: project.id, projectVersion: Number(state.requestVersions.project || 0) };
  state.directImportWorkbench.status = "working";
  state.directImportWorkbench.lastError = "";
  renderDirectImportWorkbench();
  try {
    const result = await bridge.chooseDirectImportSourceRoot(project.id);
    if (isRequestStale("directImportOperation", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    if (!result?.ok || result.canceled) {
      state.directImportWorkbench.status = "loaded";
      renderDirectImportWorkbench();
      return;
    }
    state.directImportWorkbench.sources = Array.isArray(result.sources) ? result.sources : [];
    state.directImportWorkbench.selectedHandleId = state.directImportWorkbench.sources[0]?.handleId || "";
    state.directImportWorkbench.selectedImportId = "";
    state.directImportWorkbench.report = null;
    state.directImportWorkbench.selectedImportSession = null;
    state.directImportWorkbench.status = "loaded";
    setLastEvent(`Import source root loaded: ${state.directImportWorkbench.sources.length} JSONL source(s).`);
  } catch (error) {
    if (isRequestStale("directImportOperation", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.directImportWorkbench.status = "error";
    state.directImportWorkbench.lastError = `Choose root failed: ${error.message}`;
  }
  renderDirectImportWorkbench();
}

async function inspectDirectImportSource(handleId) {
  const project = activeProject();
  const sourceHandleId = String(handleId || state.directImportWorkbench.selectedHandleId || "").trim();
  if (!project || !sourceHandleId || !bridge.inspectDirectImportSource) return;
  const requestVersion = nextRequestVersion("directImportOperation");
  const snapshot = { projectId: project.id, projectVersion: Number(state.requestVersions.project || 0) };
  state.directImportWorkbench.status = "working";
  state.directImportWorkbench.lastError = "";
  renderDirectImportWorkbench();
  try {
    const result = await bridge.inspectDirectImportSource(project.id, { handleId: sourceHandleId });
    if (isRequestStale("directImportOperation", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    if (result?.source) {
      state.directImportWorkbench.sources = state.directImportWorkbench.sources.map((source) =>
        source.handleId === sourceHandleId ? { ...source, ...result.source } : source
      );
      state.directImportWorkbench.selectedHandleId = sourceHandleId;
    }
    state.directImportWorkbench.status = "loaded";
    setLastEvent(`Inspected import source: ${result?.source?.recordCount || 0} record(s).`);
  } catch (error) {
    if (isRequestStale("directImportOperation", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.directImportWorkbench.status = "error";
    state.directImportWorkbench.lastError = `Inspect failed: ${error.message}`;
  }
  renderDirectImportWorkbench();
}

async function materializeSelectedDirectImportSource(handleId) {
  const project = activeProject();
  const sourceHandleId = String(handleId || state.directImportWorkbench.selectedHandleId || "").trim();
  if (!project || !sourceHandleId || !bridge.materializeDirectImport) return;
  const requestVersion = nextRequestVersion("directImportOperation");
  const snapshot = { projectId: project.id, projectVersion: Number(state.requestVersions.project || 0) };
  state.directImportWorkbench.status = "working";
  state.directImportWorkbench.lastError = "";
  renderDirectImportWorkbench();
  try {
    const result = await bridge.materializeDirectImport(project.id, {
      handleId: sourceHandleId,
      userConfirmedWorkspace: Boolean(els.directImportWorkspaceConfirmInput?.checked),
    });
    if (isRequestStale("directImportOperation", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    const safeSession = result?.rendererSafeSession || {};
    state.directImportWorkbench.selectedImportId = safeSession.importId || result?.importId || "";
    state.directImportWorkbench.selectedSessionId = safeSession.sessionId || result?.sessionId || "";
    state.directImportWorkbench.selectedHandleId = "";
    state.directImportWorkbench.report = null;
    state.directImportWorkbench.selectedImportSession = safeSession.sessionId ? safeSession : null;
    state.directImportWorkbench.status = "loaded";
    setLastEvent(`Materialized read-only import: ${safeSession.title || result?.importState || "Codex JSONL"}.`);
    await loadDirectImports({ refresh: true });
    if (state.directImportWorkbench.selectedImportId) {
      await selectDirectImport(state.directImportWorkbench.selectedImportId);
    }
  } catch (error) {
    if (isRequestStale("directImportOperation", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.directImportWorkbench.status = "error";
    state.directImportWorkbench.lastError = `Import failed: ${error.message}`;
    renderDirectImportWorkbench();
  }
}

async function selectDirectImport(importId) {
  const project = activeProject();
  const id = String(importId || "").trim();
  if (!project || !id) return;
  state.directImportWorkbench.selectedImportId = id;
  state.directImportWorkbench.selectedHandleId = "";
  const entry = selectedDirectImportEntry();
  state.directImportWorkbench.selectedSessionId = entry?.materializedSessionId || "";
  state.directImportWorkbench.report = null;
  state.directImportWorkbench.selectedImportSession = null;
  renderDirectImportWorkbench();
  if (!bridge.readDirectImportReport && !bridge.readDirectImportSession) return;
  const requestVersion = nextRequestVersion("directImportOperation");
  const snapshot = { projectId: project.id, projectVersion: Number(state.requestVersions.project || 0) };
  try {
    const [reportResult, sessionResult] = await Promise.all([
      bridge.readDirectImportReport ? bridge.readDirectImportReport(project.id, id) : Promise.resolve(null),
      bridge.readDirectImportSession ? bridge.readDirectImportSession(project.id, id) : Promise.resolve(null),
    ]);
    if (isRequestStale("directImportOperation", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.directImportWorkbench.report = reportResult?.report || null;
    state.directImportWorkbench.selectedImportSession = sessionResult?.rendererSafeSession || null;
    state.directImportWorkbench.selectedSessionId = sessionResult?.rendererSafeSession?.sessionId || entry?.materializedSessionId || "";
  } catch (error) {
    if (isRequestStale("directImportOperation", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.directImportWorkbench.lastError = `Report load failed: ${error.message}`;
  }
  renderDirectImportWorkbench();
}

async function hideDirectImport(importId) {
  const project = activeProject();
  const id = String(importId || "").trim();
  if (!project || !id || !bridge.hideDirectImport) return;
  const requestVersion = nextRequestVersion("directImportOperation");
  const snapshot = { projectId: project.id, projectVersion: Number(state.requestVersions.project || 0) };
  state.directImportWorkbench.status = "working";
  renderDirectImportWorkbench();
  try {
    await bridge.hideDirectImport(project.id, id);
    if (isRequestStale("directImportOperation", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    if (state.directImportWorkbench.selectedImportId === id) {
      state.directImportWorkbench.selectedImportId = "";
      state.directImportWorkbench.selectedSessionId = "";
      state.directImportWorkbench.report = null;
      state.directImportWorkbench.selectedImportSession = null;
    }
    state.directImportWorkbench.status = "loaded";
    await loadDirectImports({ refresh: true });
    setLastEvent("Import hidden. Source JSONL was not modified.");
  } catch (error) {
    if (isRequestStale("directImportOperation", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.directImportWorkbench.status = "error";
    state.directImportWorkbench.lastError = `Hide failed: ${error.message}`;
    renderDirectImportWorkbench();
  }
}

async function startDirectImportCheckpointContinuation(importId) {
  const project = activeProject();
  const id = String(importId || state.directImportWorkbench.selectedImportId || "").trim();
  if (!project || !id || !bridge.startDirectImportCheckpointContinuation) return;
  const requestVersion = nextRequestVersion("directImportOperation");
  const snapshot = { projectId: project.id, projectVersion: Number(state.requestVersions.project || 0) };
  state.directImportWorkbench.status = "working";
  state.directImportWorkbench.lastError = "";
  renderDirectImportWorkbench();
  try {
    const clientCheckpointContinuationId = `checkpoint_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const result = await bridge.startDirectImportCheckpointContinuation(project.id, {
      importId: id,
      clientCheckpointContinuationId,
    });
    if (isRequestStale("directImportOperation", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.directImportWorkbench.status = "loaded";
    await loadDirectImports({ refresh: true });
    await selectDirectImport(id);
    await refreshDirectRuntimeStatus(project.id);
    setLastEvent(result?.ok
      ? `Started checkpoint continuation session: ${result.sessionId || "direct session"}.`
      : `Checkpoint continuation finished with ${result?.continuation?.state || "unknown"} state.`);
  } catch (error) {
    if (isRequestStale("directImportOperation", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.directImportWorkbench.status = "error";
    state.directImportWorkbench.lastError = `Checkpoint continuation failed: ${error.message}`;
    renderDirectImportWorkbench();
  }
}

async function loadDirectAuthSettings() {
  if (!bridge?.getDirectAuthSettings) return;
  state.directAuthLoading = true;
  state.directAuthError = "";
  renderDirectAuthControls();
  try {
    const settings = await bridge.getDirectAuthSettings();
    state.directAuthSettings = settings;
    state.directAuthStatus = settings?.authStatus || null;
  } catch (error) {
    state.directAuthError = sanitizedDirectAuthError("Direct auth settings failed.");
  } finally {
    state.directAuthLoading = false;
    renderDirectAuthControls();
  }
}

async function refreshDirectAuthStatus() {
  if (!bridge?.getDirectAuthStatus) return;
  state.directAuthLoading = true;
  state.directAuthError = "";
  renderDirectAuthControls();
  try {
    state.directAuthStatus = await bridge.getDirectAuthStatus();
    if (state.directAuthSettings) {
      state.directAuthSettings = { ...state.directAuthSettings, authStatus: state.directAuthStatus };
    }
    await refreshDirectRuntimeStatus();
    setLastEvent(`Direct auth ${directAuthStatusLabel(state.directAuthStatus)}.`);
  } catch (error) {
    state.directAuthError = sanitizedDirectAuthError("Direct auth status failed.");
    setLastEvent(`Direct auth status failed: ${state.directAuthError}`);
  } finally {
    state.directAuthLoading = false;
    renderDirectAuthControls();
  }
}

async function refreshDirectRuntimeStatus(projectId = activeProject()?.id || "") {
  if (!bridge.getDirectRuntimeStatus || !projectId) return;
  state.directRuntimeLoading = true;
  state.directRuntimeError = "";
  renderDirectRuntimeStatus();
  try {
    state.directRuntimeStatus = await bridge.getDirectRuntimeStatus(projectId);
    await refreshDirectImplementationUiStatus(projectId, { renderBefore: false });
  } catch (error) {
    state.directRuntimeError = error.message || "Direct runtime status failed.";
  } finally {
    state.directRuntimeLoading = false;
    renderDirectRuntimeStatus();
  }
}

async function refreshDirectImplementationUiStatus(projectId = activeProject()?.id || "", options = {}) {
  if (!bridge.getDirectImplementationLaneUiStatus || !projectId) return;
  const requestVersion = nextRequestVersion("directImplementationUiStatus");
  const snapshot = projectRequestSnapshot(projectId);
  state.directImplementationUiLoading = true;
  state.directImplementationUiError = "";
  state.directImplementationUiWarning = "";
  if (options.renderBefore !== false) renderDirectImplementationUiStatus();
  try {
    const status = await bridge.getDirectImplementationLaneUiStatus(projectId);
    const historyRequest = directImplementationHistoryRequest(status);
    const [historyResult, policyResult] = await Promise.all([
      bridge.readDirectImplementationOperationHistory
        ? optionalDirectImplementationProjection("operation history", () => bridge.readDirectImplementationOperationHistory(projectId, historyRequest))
        : Promise.resolve({ value: null, warning: "" }),
      bridge.getDirectImplementationPolicyView
        ? optionalDirectImplementationProjection("policy", () => bridge.getDirectImplementationPolicyView(projectId))
        : Promise.resolve({ value: null, warning: "" }),
    ]);
    if (isRequestStale("directImplementationUiStatus", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.directImplementationUiStatus = status || null;
    state.directImplementationOperationHistory = historyResult.value || null;
    state.directImplementationPolicyView = policyResult.value || null;
    state.directImplementationUiWarning = [historyResult.warning, policyResult.warning].filter(Boolean).join("; ");
  } catch (error) {
    if (isRequestStale("directImplementationUiStatus", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.directImplementationUiStatus = null;
    state.directImplementationOperationHistory = null;
    state.directImplementationPolicyView = null;
    state.directImplementationUiWarning = "";
    state.directImplementationUiError = error.message || "Direct implementation-lane UI status failed.";
  } finally {
    if (!isRequestStale("directImplementationUiStatus", requestVersion)) {
      state.directImplementationUiLoading = false;
      renderDirectImplementationUiStatus();
    }
  }
}

async function refreshDirectMetaSessionStatus(projectId = activeProject()?.id || "") {
  if (!bridge.getDirectMetaSessionStatus || !projectId) return;
  const requestVersion = nextRequestVersion("directMetaSessionStatus");
  const snapshot = { projectId, projectVersion: Number(state.requestVersions.project || 0) };
  state.directMetaSessionLoading = true;
  state.directMetaSessionError = "";
  renderDirectMetaSessionStatus();
  try {
    const status = await bridge.getDirectMetaSessionStatus(projectId);
    if (isRequestStale("directMetaSessionStatus", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.directMetaSessionStatus = status;
  } catch (error) {
    if (isRequestStale("directMetaSessionStatus", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.directMetaSessionError = error.message || "Meta-session status failed.";
  } finally {
    if (!isRequestStale("directMetaSessionStatus", requestVersion)) {
      state.directMetaSessionLoading = false;
      renderDirectMetaSessionStatus();
    }
  }
}

async function refreshDirectBridgeSettingsStatus(projectId = activeProject()?.id || "") {
  if (!bridge.getDirectBridgeSettingsStatus || !projectId) return;
  const requestVersion = nextRequestVersion("directBridgeSettingsStatus");
  const snapshot = projectRequestSnapshot(projectId);
  state.directBridgeSettingsLoading = true;
  state.directBridgeSettingsError = "";
  renderDirectBridgeSettingsStatus();
  try {
    const status = await bridge.getDirectBridgeSettingsStatus(projectId);
    if (isRequestStale("directBridgeSettingsStatus", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.directBridgeSettingsStatus = status;
  } catch (error) {
    if (isRequestStale("directBridgeSettingsStatus", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.directBridgeSettingsError = error.message || "Direct bridge settings status failed.";
  } finally {
    if (!isRequestStale("directBridgeSettingsStatus", requestVersion)) {
      state.directBridgeSettingsLoading = false;
      renderDirectBridgeSettingsStatus();
    }
  }
}

function directActivationClientId(prefix) {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

async function enableDirectExperimentalRuntime() {
  const project = activeProject();
  if (!project || !bridge.enableDirectExperimentalRuntime) return;
  await refreshDirectAuthStatus();
  await refreshDirectRuntimeStatus(project.id);
  const activation = state.directRuntimeStatus?.activation || {};
  if (activation.state !== "eligible") {
    setLastEvent(`Direct experimental activation blocked: ${directActivationBlockedDetail(state.directRuntimeStatus)}`);
    return;
  }
  const confirmed = window.confirm("Enable direct experimental live-text for this project? This changes only the left Codex lane and keeps rollback available.");
  if (!confirmed) return;
  state.directRuntimeLoading = true;
  renderDirectRuntimeStatus();
  try {
    const result = await bridge.enableDirectExperimentalRuntime(project.id, {
      clientActivationId: directActivationClientId("client_activation"),
      expectedGateId: activation.gateId,
      expectedGateDigest: activation.gateDigest,
      expectedRuntimeMode: "direct-experimental",
      expectedDirectTransport: "live-text",
    });
    if (result?.config) {
      state.config = result.config;
      render();
    }
    state.directRuntimeStatus = result?.status ? { ...state.directRuntimeStatus, activation: result.status } : state.directRuntimeStatus;
    await refreshDirectRuntimeStatus(project.id);
    setLastEvent(result?.duplicate ? "Direct experimental already enabled for this project." : "Direct experimental enabled for this project.");
  } catch (error) {
    state.directRuntimeError = error.message || "Direct experimental activation failed.";
    setLastEvent(`Direct experimental activation failed: ${state.directRuntimeError}`);
  } finally {
    state.directRuntimeLoading = false;
    renderDirectRuntimeStatus();
  }
}

async function selectDirectTextOnlyRuntime() {
  const project = activeProject();
  if (!project || !bridge.selectDirectTextOnlyRuntime) return;
  await refreshDirectAuthStatus();
  await refreshDirectRuntimeStatus(project.id);
  const textOnly = state.directRuntimeStatus?.directTextOnly || {};
  if (textOnly.state !== "eligible" && textOnly.status !== "eligible" && textOnly.status !== "enabled") {
    setLastEvent(`Direct text fallback blocked: ${directTextOnlyBlockedDetail(state.directRuntimeStatus)}`);
    return;
  }
  if (textOnly.status !== "enabled") {
    const confirmed = window.confirm("Use Direct text fallback for this project? This is only intended when tool-capable Direct is unavailable.");
    if (!confirmed) return;
  }
  state.directRuntimeLoading = true;
  renderDirectRuntimeStatus();
  try {
    const result = await bridge.selectDirectTextOnlyRuntime(project.id, {
      clientOperationId: directActivationClientId("client_direct_text_only"),
      expectedGateId: textOnly.gateId,
      expectedGateDigest: textOnly.gateDigest,
    });
    if (result?.config) {
      state.config = result.config;
      render();
    }
    await refreshDirectRuntimeStatus(project.id);
    setLastEvent(result?.duplicate ? "Direct text fallback was already selected for this project." : "Direct text fallback selected for this project.");
  } catch (error) {
    state.directRuntimeError = error.message || "Direct text fallback selection failed.";
    setLastEvent(`Direct text fallback selection failed: ${state.directRuntimeError}`);
  } finally {
    state.directRuntimeLoading = false;
    renderDirectRuntimeStatus();
  }
}

async function setDirectRuntimePathFromControl(selectEl = els.directRuntimePathSelect) {
  const project = activeProject();
  if (!project || !bridge.setDirectRuntimePath || !selectEl) return;
  const persistDefault = true;
  const runtimePath = selectEl.value || "app-server";
  const currentPath = selectedDirectRuntimePath({ scope: persistDefault ? "default" : "active" });
  if (runtimePath === currentPath) return;
  let requestRuntimePath = runtimePath;
  const isDirectPath = runtimePath === "direct-text" || runtimePath === "direct-implementation";
  const options = {
    clientOperationId: directActivationClientId(isDirectPath ? "client_direct_embark" : "client_runtime_path"),
    persistDefault,
  };
  const label = runtimePath === "app-server" ? "App Server" : "Direct";
  state.directRuntimeLoading = true;
  renderDirectRuntimeStatus();
  try {
    let result;
    if (isDirectPath && bridge.embarkDirectRuntime) {
      result = await embarkDirectRuntimeFromControl(project, {
        ...options,
        clientEmbarkId: options.clientOperationId,
        requestedFrom: selectEl?.id || "runtime-selector",
      });
      if (!result?.ok) throw new Error(directEmbarkFailureMessage(result));
      requestRuntimePath = result.runtimePath || runtimePath;
    } else {
      result = await bridge.setDirectRuntimePath(project.id, requestRuntimePath, options);
    }
    if (result?.config) {
      state.config = result.config;
      render();
    }
    if (result?.project?.id) {
      state.activeCodexRuntimePathByProject[result.project.id] = requestRuntimePath;
    }
    await refreshDirectRuntimeStatus(project.id);
    if (persistDefault) {
      setLastEvent(result?.duplicate ? `${label} is already the default Codex backend.` : `Default Codex backend set to ${label}.`);
    } else {
      setLastEvent(result?.duplicate ? `${label} is already the active Codex backend.` : `Active Codex backend switched to ${label}.`);
    }
  } catch (error) {
    state.directRuntimeError = error.message || "Codex backend switch failed.";
    setLastEvent(`Codex backend switch failed: ${state.directRuntimeError}`);
  } finally {
    state.directRuntimeLoading = false;
    renderDirectRuntimeStatus();
  }
}

async function rollbackDirectExperimentalRuntime() {
  const project = activeProject();
  const activation = state.directRuntimeStatus?.activation || {};
  if (!project || !bridge.rollbackDirectExperimentalRuntime) return;
  if (!activation.rollbackAvailable) {
    setLastEvent("Direct experimental rollback is not available.");
    return;
  }
  const confirmed = window.confirm("Rollback this project Codex lane to legacy app-server or the previous binding? Direct sessions and imports are preserved.");
  if (!confirmed) return;
  state.directRuntimeLoading = true;
  renderDirectRuntimeStatus();
  try {
    const result = await bridge.rollbackDirectExperimentalRuntime(project.id, {
      clientRollbackId: directActivationClientId("client_rollback"),
      activationId: activation.activationId,
      reason: "user_requested",
    });
    if (result?.config) {
      state.config = result.config;
      render();
    }
    state.directRuntimeStatus = result?.status ? { ...state.directRuntimeStatus, activation: result.status } : state.directRuntimeStatus;
    await refreshDirectRuntimeStatus(project.id);
    setLastEvent(result?.duplicate ? "Direct experimental rollback was already applied." : "Rolled back Codex lane from direct experimental.");
  } catch (error) {
    state.directRuntimeError = error.message || "Direct experimental rollback failed.";
    setLastEvent(`Direct experimental rollback failed: ${state.directRuntimeError}`);
  } finally {
    state.directRuntimeLoading = false;
    renderDirectRuntimeStatus();
  }
}

async function setDirectAuthStorageMode(mode) {
  if (!bridge?.setDirectAuthStorageMode) return;
  state.directAuthLoading = true;
  state.directAuthError = "";
  renderDirectAuthControls();
  try {
    const result = await bridge.setDirectAuthStorageMode(mode);
    state.directAuthSettings = result.settings || state.directAuthSettings;
    state.directAuthStatus = result.authStatus || result.settings?.authStatus || state.directAuthStatus;
    setLastEvent(`Direct auth storage: ${state.directAuthSettings?.storageMode || mode}.`);
  } catch (error) {
    state.directAuthError = sanitizedDirectAuthError("Direct auth storage switch failed.");
    setLastEvent(`Direct auth storage failed: ${state.directAuthError}`);
  } finally {
    state.directAuthLoading = false;
    renderDirectAuthControls();
  }
}

async function beginDirectAuthLogin() {
  if (!bridge?.beginDirectAuthLogin) return;
  state.directAuthLoading = true;
  state.directAuthError = "";
  renderDirectAuthControls();
  let result = null;
  try {
    result = await bridge.beginDirectAuthLogin();
    if (result?.manualCodeRequired && result.loginId && bridge.completeDirectAuthLogin) {
      const pasted = window.prompt("Paste the authorization code or full localhost redirect URL.");
      if (pasted && pasted.trim()) {
        result = await bridge.completeDirectAuthLogin(result.loginId, pasted.trim());
      }
    }
    state.directAuthStatus = result.authStatus || state.directAuthStatus;
    setLastEvent(result.ok ? "Direct auth login completed." : `Direct auth login unavailable: ${result.reason || result.status}.`);
  } catch (error) {
    state.directAuthError = sanitizedDirectAuthError("Direct auth login failed.");
    setLastEvent(`Direct auth login failed: ${state.directAuthError}`);
    result = {
      ok: false,
      status: "failed",
      reason: state.directAuthError,
    };
  } finally {
    state.directAuthLoading = false;
    renderDirectAuthControls();
  }
  return result;
}

async function logoutDirectAuth() {
  if (!bridge?.logoutDirectAuth) return;
  state.directAuthLoading = true;
  state.directAuthError = "";
  renderDirectAuthControls();
  try {
    const result = await bridge.logoutDirectAuth();
    state.directAuthSettings = result.settings || state.directAuthSettings;
    state.directAuthStatus = result.authStatus || result.settings?.authStatus || state.directAuthStatus;
    setLastEvent("Direct auth credentials cleared.");
  } catch (error) {
    state.directAuthError = sanitizedDirectAuthError("Direct auth logout failed.");
    setLastEvent(`Direct auth logout failed: ${state.directAuthError}`);
  } finally {
    state.directAuthLoading = false;
    renderDirectAuthControls();
  }
}

async function updateAnalytics() {
  const project = activeProject();
  if (!project || !bridge.updateThreadAnalytics) return;
  const requestVersion = nextRequestVersion("analyticsThreads");
  const snapshot = { projectId: project.id, projectVersion: Number(state.requestVersions.project || 0) };
  state.analyticsStatus = "updating";
  renderAnalyticsPanel();
  try {
    const result = await bridge.updateThreadAnalytics(project.id, { scope: "project" });
    if (isRequestStale("analyticsThreads", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.analyticsThreads = Array.isArray(result?.entries) ? result.entries : [];
    state.analyticsStatus = "loaded";
    const counts = result?.counts || {};
    const fallbackNote = result?.fallback?.reason ? ` Fallback: ${result.fallback.reason}` : "";
    setLastEvent(
      `Analytics updated: ${Number(counts.discovered || 0)} discovered, ${Number(counts.processed || 0)} processed, ${Number(counts.skipped || 0)} skipped, ${Number(counts.failed || 0)} failed.${fallbackNote}`,
    );
    if (state.selectedAnalyticsThreadKey) {
      await selectAnalyticsThread(state.selectedAnalyticsThreadKey);
      return;
    }
  } catch (error) {
    if (isRequestStale("analyticsThreads", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.analyticsStatus = "error";
    setLastEvent(`Analytics update failed: ${error.message}`);
  }
  if (isRequestStale("analyticsThreads", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
  renderAnalyticsPanel();
}

async function selectProject(projectId) {
  const projectVersion = nextRequestVersion("project");
  nextRequestVersion("thread");
  nextRequestVersion("codexThreads");
  nextRequestVersion("recentThreads");
  nextRequestVersion("directImports");
  nextRequestVersion("directImportOperation");
  nextRequestVersion("directThreadWorkbench");
  nextRequestVersion("directThreadWorkbenchOperation");
  nextRequestVersion("directMetaSessionStatus");
  nextRequestVersion("directBridgeSettingsStatus");
  nextRequestVersion("analyticsThreads");
  nextRequestVersion("analyticsDetail");
  nextRequestVersion("workTree");
  nextRequestVersion("watchedArtifacts");
  nextRequestVersion("preview");
  const previous = state.config?.selectedProjectId;
  state.surfaceEvents.codex = { type: "loading" };
  state.surfaceEvents.chatgpt = { type: "loading" };
  renderStatus();
  const result = await bridge.selectProject(projectId);
  if (isRequestStale("project", projectVersion)) return;
  state.config = result.config;
  if (state.openedCodexThreadId && state.openedCodexProjectId !== projectId) {
    state.openedCodexProjectId = "";
    state.openedCodexThreadId = "";
    state.openedCodexThreadTitle = "";
    state.openedCodexSourceHome = "";
    state.openedCodexSessionFilePath = "";
  }
  state.selectedFileRelPath = "";
  state.selectedFilePreview = null;
  state.watchedArtifactsScan = null;
  state.selectedBindingId = "";
  state.selectedCodexThreadId = "";
  state.selectedProjectChatThreadId = "";
  state.selectedRecentChatgptThreadId = "";
  state.selectedAnalyticsThreadKey = "";
  state.analyticsThreads = [];
  state.analyticsStatus = "idle";
  state.analyticsDashboard = null;
  state.analyticsDashboardStatus = "idle";
  resetDirectImportWorkbench(projectId);
  resetDirectThreadWorkbench(projectId);
  state.directMetaSessionStatus = null;
  state.directMetaSessionError = "";
  state.directMetaSessionLoading = false;
  state.directBridgeSettingsStatus = null;
  state.directBridgeSettingsError = "";
  state.directBridgeSettingsLoading = false;
  state.activeChatgptThreadBrowserTab = "project";
  state.subAgentGraph = null;
  state.selectedSubAgentThreadId = "";
  state.selectedSubAgentSelectedBy = "";
  state.selectedSubAgentScope = { mode: "full", turnKey: "" };
  state.rightPlanePinnedTab = "";
  render();
  const project = activeProject();
  if (!project || project.id !== projectId || isRequestStale("project", projectVersion)) return;
  await refreshDirectRuntimeStatus(project.id);
  await refreshDirectMetaSessionStatus(project.id);
  await refreshDirectBridgeSettingsStatus(project.id);
  if (state.activeMiddleTab === "imports") {
    await loadDirectImports({ refresh: false });
  }
  if (state.activeMiddleTab === "threads") {
    await loadDirectThreadWorkbench({ refresh: false });
  }
  if (project?.lastActiveBindingId) {
    const binding = laneBindingById(project, project.lastActiveBindingId);
    if (binding) populateBindingEditor(binding);
  } else {
    resetBindingEditor();
    state.selectedProjectChatThreadId = activeThread(project)?.id || "";
  }
  setLastEvent(`Selected ${project?.name ?? projectId}.`);
  if (project && bridge.attachWorkspace) {
    setLastEvent(`Attaching workspace: ${workspaceSummary(project)}…`);
    try {
      const status = await bridge.attachWorkspace(project.id);
      if (isRequestStale("project", projectVersion) || isProjectRequestStale(project.id, projectVersion)) return;
      state.workspaceStatuses[project.id] = status;
      renderSelectedProject();
      await loadCodexThreads({ projectId: project.id, projectVersion });
      await loadAnalyticsThreads({ projectId: project.id, projectVersion });
    } catch (error) {
      if (isRequestStale("project", projectVersion) || isProjectRequestStale(project.id, projectVersion)) return;
      state.codexThreads = [];
      state.workspaceStatuses[project.id] = { status: "failed", lastError: error.message };
      renderSelectedProject();
      renderThreadsWorkbench();
      await loadAnalyticsThreads({ projectId: project.id, projectVersion });
    }
  }
  const currentProject = activeProject();
  const activationBinding = result.activationBinding || activeLaneBinding(currentProject);
  if (currentProject && activationBinding?.codexThreadRef?.threadId) {
    await openProjectCodexBinding(currentProject, activationBinding, { projectId: currentProject.id, projectVersion });
  }
  await loadWorkTreeRoot({ projectId: project.id, projectVersion });
  await loadWatchedArtifacts({ projectId: project.id, projectVersion });
  if (isRequestStale("project", projectVersion)) return;
  if (previous !== projectId) scheduleResizeBurst();
}

async function openProjectCodexBinding(project, binding, snapshot) {
  const ref = binding?.codexThreadRef || {};
  const threadId = String(ref.threadId || "").trim();
  if (!project || !threadId || !bridge.selectCodexThread) return;
  if (isRequestStale("project", snapshot.projectVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;

  const discovered = codexThreadForBinding(binding);
  const sourceHome = String(ref.sourceHome || discovered?.sourceHome || "").trim();
  const sessionFilePath = String(ref.sessionFilePath || discovered?.sessionFilePath || "").trim();
  state.selectedBindingId = binding.id || state.selectedBindingId;
  state.selectedProjectChatThreadId = binding.chatThreadId || state.selectedProjectChatThreadId;
  renderThreadsWorkbench();
  try {
    const result = await bridge.selectCodexThread(project.id, threadId, sourceHome, sessionFilePath);
    if (isRequestStale("project", snapshot.projectVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    if (!result?.ok) {
      setLastEvent(`Project Codex thread open skipped: ${result?.error || "unknown reason"}`);
      return;
    }
    const title = discovered?.title || ref.titleSnapshot || threadId;
    state.selectedCodexThreadId = threadId;
    renderSelectedProject();
    renderThreadsWorkbench();
    setLastEvent(`Requested project Codex thread: ${title}.`);
  } catch (error) {
    if (isRequestStale("project", snapshot.projectVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    setLastEvent(`Project Codex thread open failed: ${error.message}`);
  }
}

async function selectThread(threadId) {
  const project = activeProject();
  if (!project || !threadId) return;
  const thread = threadById(project, threadId);
  if (!thread) return;
  if (thread.archived) {
    setLastEvent(`Archived thread not opened: ${thread.title}.`);
    return;
  }
  state.selectedProjectChatThreadId = threadId;
  renderThreadsWorkbench();
  state.surfaceEvents.chatgpt = { type: "loading" };
  renderStatus();
  const threadVersion = nextRequestVersion("thread");
  const snapshot = { projectId: project.id, projectVersion: Number(state.requestVersions.project || 0) };
  try {
    const result = await bridge.selectChatThread(project.id, threadId);
    if (isRequestStale("thread", threadVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.config = result.config;
    render();
    setLastEvent(`Opened ${roleLabel(result.thread?.role)} thread: ${result.thread?.title}.`);
  } catch (error) {
    if (isRequestStale("thread", threadVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    setLastEvent(`Thread open failed: ${error.message}`);
  }
}

async function selectCodexThread(threadId, sourceHome = "", sessionFilePath = "") {
  const project = activeProject();
  if (!threadId) return;
  state.selectedCodexThreadId = threadId;
  renderThreadsWorkbench();
  if (!project || !bridge.selectCodexThread) return;
  const result = await bridge.selectCodexThread(project.id, threadId, sourceHome, sessionFilePath);
  if (!result?.ok) {
    setLastEvent(`Codex thread open skipped: ${result?.error || "unknown reason"}`);
    return;
  }
  const thread = codexThreadById(threadId);
  if (result.warning) {
    setLastEvent(`Requested ${thread?.title || threadId} (read-only fallback): ${result.warning}`);
  } else if (result.runtimeRoute?.autoSwitch && result.runtimeRoute?.selectedRuntimePath === "app-server") {
    setLastEvent(`Opened ${thread?.title || threadId} through its native App Server backend. Continue in Direct remains available as a checkpoint continuation.`);
  } else {
    setLastEvent(`Requested Codex thread open: ${thread?.title || threadId}.`);
  }
  renderSelectedProject();
}

async function reloadActiveCodexRuntime() {
  const project = activeProject();
  if (!project) return;
  const openedForProject = state.openedCodexProjectId === project.id;
  const selectedThread = codexThreadById(state.selectedCodexThreadId);
  const threadId = openedForProject
    ? state.openedCodexThreadId
    : state.selectedCodexThreadId || selectedThread?.threadId || "";
  const restoreTarget = threadId
    ? {
      projectId: project.id,
      threadId,
      sourceHome: openedForProject ? state.openedCodexSourceHome : selectedThread?.sourceHome || "",
      sessionFilePath: openedForProject ? state.openedCodexSessionFilePath : selectedThread?.sessionFilePath || "",
      title: openedForProject ? state.openedCodexThreadTitle : selectedThread?.title || threadId,
    }
    : null;
  state.surfaceEvents.codex = { type: "loading", title: "Reloading Codex runtime" };
  renderStatus();
  try {
    const result = bridge.reloadCodexRuntime
      ? await bridge.reloadCodexRuntime({ projectId: project.id, restoreTarget })
      : { ok: await bridge.reloadSurface("codex"), restarted: false };
    if (!result?.ok) {
      setLastEvent(`Codex runtime reload failed: ${result?.error || "unknown error"}`);
      return;
    }
    if (result.restarted === false && result.reason) {
      setLastEvent(`Reloaded Codex surface: ${result.reason}`);
      return;
    }
    setLastEvent(
      result.threadId
        ? `Reloaded Codex runtime and requested thread restore: ${restoreTarget?.title || result.threadId}.`
        : "Reloaded Codex runtime.",
    );
  } catch (error) {
    setLastEvent(`Codex runtime reload failed: ${error.message}`);
  }
}

function handleCodexThreadState(event) {
  const project = activeProject();
  const projectId = String(event.projectId || project?.id || "");
  const threadId = String(event.threadId || "");
  if (!project || !threadId || projectId !== project.id) return;

  const status = String(event.status || "");
  const title = event.title || codexThreadById(threadId)?.title || threadId;
  if (status === "rendered_stored" || status === "attached_live") {
    state.selectedCodexThreadId = threadId;
    state.openedCodexProjectId = project.id;
    state.openedCodexThreadId = threadId;
    state.openedCodexThreadTitle = title;
    state.openedCodexSourceHome = String(event.sourceHome || "");
    state.openedCodexSessionFilePath = String(event.sessionFilePath || "");
    if (state.subAgentGraph?.primaryThreadId && String(state.subAgentGraph.primaryThreadId) !== threadId) {
      state.subAgentGraph = null;
      state.selectedSubAgentThreadId = "";
      state.selectedSubAgentSelectedBy = "";
      state.selectedSubAgentScope = { mode: "full", turnKey: "" };
      if (state.activeRightTab === "subagents" && !state.rightPlanePinnedTab) state.activeRightTab = "chatgpt";
      renderRightPlaneTabs();
    }
    renderSelectedProject();
    renderThreadsWorkbench();
    setLastEvent(
      status === "attached_live"
        ? `Attached live Codex thread: ${title}.`
        : `Rendered stored Codex thread: ${title}.`,
    );
    return;
  }

  if (status === "failed" && state.selectedCodexThreadId === threadId) {
    setLastEvent(`Codex thread open failed: ${event.errorDescription || title}.`);
  }
}

async function openRecentChatgptThread(thread) {
  if (!thread?.url || !bridge.openChatgptThreadUrl) return;
  state.surfaceEvents.chatgpt = { type: "loading" };
  renderStatus();
  const result = await bridge.openChatgptThreadUrl(thread.url);
  if (!result?.ok) {
    setLastEvent(`Recent ChatGPT thread open skipped: ${result?.error || "unknown reason"}`);
    return;
  }
  setLastEvent(`Opened recent ChatGPT thread: ${thread.title || "Untitled ChatGPT thread"}.`);
}

function openDrawer(mode) {
  const project = mode === "new" ? null : activeProject();
  state.drawerMode = mode;
  els.drawer.classList.add("open");
  els.drawer.setAttribute("aria-hidden", "false");
  bridge.setSurfaceVisible(false).catch(() => {});
  els.drawerTitle.textContent = mode === "new" ? "New project" : "Edit project";
  els.deleteProjectButton.style.display = mode === "new" ? "none" : "inline-flex";

  const now = nowIso();
  const defaultWorkspace = defaultWorkspaceDraft();
  const draft = project ?? {
    id: createId("project"),
    name: "New project",
    repoPath: workspaceRepoPath(defaultWorkspace),
    workspace: defaultWorkspace,
    surfaceBinding: {
      codex: {
        mode: "managed",
        bindingProvider: "codex-compatible",
        runtimeMode: "legacy-app-server",
        directTransport: "fixture",
        provider: {
          kind: "codex_executable",
          flavor: "vanilla",
        },
        runtime: state.defaultCodexRuntime || "auto",
        profileId: "",
        binaryPath: "codex",
        target: "",
        model: "",
        reasoningEffort: "",
        spawnAgentModelOverrides: false,
        label: "Managed Codex lane",
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
      {
        id: "thread_review_primary",
        role: "review",
        title: "Primary review",
        url: "https://chatgpt.com/",
        notes: "Main project-bound ChatGPT review thread.",
        isPrimary: true,
        pinned: true,
        archived: false,
        createdAt: now,
        updatedAt: now,
      },
    ],
    activeChatThreadId: "thread_review_primary",
    laneBindings: [],
    lastActiveBindingId: "",
    promptTemplates: defaultPromptTemplates(),
    flowProfile: {
      reviewPromptTemplate: defaultPromptText("review"),
      watchedFilePatterns: ["**/*REVIEW*.md", "**/*review*.md", "artifacts/**/*.md"],
      returnHeader: "GPT feedback",
      handoffMode: "assisted",
    },
    handoffs: [],
    ignoredWatchedArtifactPaths: [],
    createdAt: now,
    updatedAt: now,
  };

  const workspace = projectWorkspace(draft);
  const templates = promptTemplates(draft);
  const primary = primaryReviewThread(draft);
  els.projectIdInput.value = draft.id;
  els.projectNameInput.value = draft.name;
  els.workspaceKindInput.value = workspace.kind;
  els.workspaceLabelInput.value = workspace.label || "";
  els.repoPathInput.value = workspace.kind === "local" ? workspace.localPath : draft.repoPath;
  els.wslDistroInput.value = workspace.kind === "wsl" ? workspace.distro : "";
  els.wslLinuxPathInput.value = workspace.kind === "wsl" ? workspace.linuxPath : "";
  updateWorkspaceFieldVisibility();
  els.codexModeInput.value = draft.surfaceBinding.codex.mode;
  els.codexLabelInput.value = draft.surfaceBinding.codex.label;
  if (els.codexDefaultPathInput) {
    els.codexDefaultPathInput.value = directRuntimePathFromCodex(draft.surfaceBinding.codex);
  }
  els.codexRuntimeModeInput.value = draft.surfaceBinding.codex.runtimeMode || "legacy-app-server";
  els.codexDirectTransportInput.value = draft.surfaceBinding.codex.directTransport || "fixture";
  syncProjectRuntimeFieldsFromDefaultPath();
  els.codexProviderKindInput.value = draft.surfaceBinding.codex.provider?.kind || draft.surfaceBinding.codex.providerKind || "codex_executable";
  els.codexProviderFlavorInput.value = draft.surfaceBinding.codex.provider?.flavor || draft.surfaceBinding.codex.providerFlavor || "vanilla";
  els.codexRuntimeInput.value = draft.surfaceBinding.codex.runtime || "auto";
  els.codexProfileIdInput.value = draft.surfaceBinding.codex.profileId || "";
  els.codexBinaryPathInput.value = draft.surfaceBinding.codex.binaryPath || "codex";
  els.codexModelInput.value = draft.surfaceBinding.codex.model || "";
  els.codexReasoningEffortInput.value = draft.surfaceBinding.codex.reasoningEffort || "";
  els.codexSpawnAgentModelOverridesInput.checked = draft.surfaceBinding.codex.spawnAgentModelOverrides === true;
  updateCodexSpawnAgentControlAvailability();
  els.codexTargetInput.value = draft.surfaceBinding.codex.target;
  els.chatgptUrlInput.value = primary?.url || draft.surfaceBinding.chatgpt.reviewThreadUrl || "https://chatgpt.com/";
  populateProjectThreadSelectors(draft);
  syncProjectChatgptUrlFromSelection();
  els.reduceChromeInput.checked = draft.surfaceBinding.chatgpt.reduceChrome !== false;
  const downloads = state.config?.chatgptDownloads || {};
  const macro = draft.surfaceBinding.chatgpt.downloadMacro || {};
  els.chatgptDownloadDirInput.value = downloads.windowsDownloadDir || "";
  els.chatgptDownloadMacroDirInput.value = macro.workspaceRelDir || ".codex/review-shell/chatgpt-downloads";
  els.chatgptDownloadMacroEnabledInput.checked = macro.enabled !== false;
  els.chatgptDownloadNotifyCodexInput.checked = macro.notifyCodex !== false;
  els.chatgptDownloadDispositionInput.value = ["queue", "steer", "ask"].includes(macro.activeTurnDisposition) ? macro.activeTurnDisposition : "queue";
  els.chatgptDownloadMessageInput.value = macro.messageTemplate || "GPT review is at {{workspacePath}}";
  els.reviewPromptInput.value = templates.review?.text || draft.flowProfile.reviewPromptTemplate;
  els.architecturePromptInput.value = templates.architecture?.text || defaultPromptText("architecture");
  els.brainstormingPromptInput.value = templates.brainstorming?.text || defaultPromptText("brainstorming");
  els.researchPromptInput.value = templates.research?.text || defaultPromptText("research");
  els.watchedPatternsInput.value = (draft.flowProfile.watchedFilePatterns || []).join(", ");
  els.returnHeaderInput.value = draft.flowProfile.returnHeader || "GPT feedback";
  setTimeout(() => els.projectNameInput.focus(), 0);
}

function closeDrawer() {
  els.drawer.classList.remove("open");
  els.drawer.setAttribute("aria-hidden", "true");
  bridge.setSurfaceVisible(true).then(scheduleResizeBurst).catch(scheduleResizeBurst);
}

function closeThreadDrawer() {
  els.threadDrawer.classList.remove("open");
  els.threadDrawer.setAttribute("aria-hidden", "true");
  bridge.setSurfaceVisible(true).then(scheduleResizeBurst).catch(scheduleResizeBurst);
}

function normalizeHttpsUrl(value) {
  const text = String(value || "").trim() || "https://chatgpt.com/";
  try {
    const url = new URL(text);
    if (url.protocol !== "https:") return "https://chatgpt.com/";
    if (!state.allowNonChatgptUrls && !CHATGPT_ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return "https://chatgpt.com/";
    return url.toString();
  } catch {
    return "https://chatgpt.com/";
  }
}

function projectFromForm() {
  const existing = state.config?.projects.find((project) => project.id === els.projectIdInput.value);
  const now = nowIso();
  const workspaceKind = els.workspaceKindInput.value || "local";
  const workspaceLabel = els.workspaceLabelInput.value.trim();
  const localPath = els.repoPathInput.value.trim();
  const linuxPathInput = els.wslLinuxPathInput.value.trim() || "/home";
  const linuxPath = linuxPathInput.startsWith("/") ? linuxPathInput : `/${linuxPathInput}`;
  const workspace = workspaceKind === "wsl"
    ? { kind: "wsl", distro: els.wslDistroInput.value.trim(), linuxPath, label: workspaceLabel || "WSL workspace" }
    : { kind: "local", localPath, label: workspaceLabel || "Local workspace" };
  const repoPath = workspace.kind === "wsl" ? `wsl:${workspace.distro || "default"}:${workspace.linuxPath}` : workspace.localPath;
  const templates = { ...defaultPromptTemplates(), ...(existing?.promptTemplates || {}) };
  templates.review = { ...(templates.review || {}), role: "review", text: els.reviewPromptInput.value.trim() || defaultPromptText("review"), updatedAt: now };
  templates.architecture = { ...(templates.architecture || {}), role: "architecture", text: els.architecturePromptInput.value.trim() || defaultPromptText("architecture"), updatedAt: now };
  templates.brainstorming = { ...(templates.brainstorming || {}), role: "brainstorming", text: els.brainstormingPromptInput.value.trim() || defaultPromptText("brainstorming"), updatedAt: now };
  templates.research = { ...(templates.research || {}), role: "research", text: els.researchPromptInput.value.trim() || defaultPromptText("research"), updatedAt: now };

  const primaryUrl = normalizeHttpsUrl(els.chatgptUrlInput.value.trim());
  const selectedChatSelection = parseDrawerSelectValue(els.projectChatgptThreadSelect?.value || "");
  const selectedCodexSelection = parseDrawerSelectValue(els.projectCodexThreadSelect?.value || "");
  let threads = chatThreads(existing).slice();
  const selectedChatThread = chatgptDrawerThreadFromSelection(selectedChatSelection, threads, primaryUrl, now);
  threads = applyPrimaryReviewThread(threads, selectedChatThread);
  const currentPrimary = primaryReviewThread({ chatThreads: threads });
  const selectedCodexThread = codexThreadFromDrawerSelection(selectedCodexSelection);
  const bindings = laneBindings(existing).slice();
  const bindingDraft = selectedCodexThread
    ? upsertProjectPrimaryLaneBinding(existing, bindings, selectedCodexThread, currentPrimary, now)
    : clearProjectPrimaryLaneBinding(existing, bindings);
  const fallbackThreadId = currentPrimary?.id || threads[0]?.id || "";
  const activeChatThreadId = preservedThreadId(threads, existing?.activeChatThreadId, fallbackThreadId);
  const lastActiveThreadId = preservedThreadId(threads, existing?.lastActiveThreadId, activeChatThreadId);
  const runtimePathFields = directRuntimeBindingFieldsForPath(
    els.codexDefaultPathInput?.value || "app-server",
    existing?.surfaceBinding?.codex || null,
  );

  return {
    id: els.projectIdInput.value || createId("project"),
    name: els.projectNameInput.value.trim() || "Untitled project",
    repoPath,
    workspace,
    surfaceBinding: {
      codex: {
        mode: els.codexModeInput.value,
        bindingProvider: runtimePathFields.bindingProvider,
        runtimeMode: runtimePathFields.runtimeMode,
        directTransport: runtimePathFields.directTransport,
        directTier: runtimePathFields.directTier,
        provider: {
          kind: els.codexProviderKindInput.value || "codex_executable",
          flavor: els.codexProviderFlavorInput.value || "vanilla",
        },
        runtime: els.codexRuntimeInput.value,
        profileId: els.codexProfileIdInput.value.trim(),
        binaryPath: els.codexBinaryPathInput.value.trim() || "codex",
        target: els.codexTargetInput.value.trim(),
        model: els.codexModelInput.value.trim(),
        reasoningEffort: els.codexReasoningEffortInput.value,
        spawnAgentModelOverrides: els.codexSpawnAgentModelOverridesInput.checked,
        label:
          els.codexLabelInput.value.trim() ||
          (els.codexModeInput.value === "managed" ? "Managed Codex lane" : els.codexModeInput.value === "fallback" ? "Fallback Codex lane" : "Codex target"),
      },
      chatgpt: {
        reviewThreadUrl: primaryUrl,
        reduceChrome: els.reduceChromeInput.checked,
        downloadMacro: {
          enabled: els.chatgptDownloadMacroEnabledInput.checked,
          workspaceRelDir: els.chatgptDownloadMacroDirInput.value.trim() || ".codex/review-shell/chatgpt-downloads",
          notifyCodex: els.chatgptDownloadNotifyCodexInput.checked,
          activeTurnDisposition: els.chatgptDownloadDispositionInput.value || "queue",
          messageTemplate: els.chatgptDownloadMessageInput.value.trim() || "GPT review is at {{workspacePath}}",
        },
      },
    },
    chatThreads: threads,
    activeChatThreadId,
    lastActiveThreadId,
    laneBindings: bindingDraft.laneBindings,
    lastActiveBindingId: bindingDraft.lastActiveBindingId,
    promptTemplates: templates,
    flowProfile: {
      reviewPromptTemplate: templates.review.text,
      watchedFilePatterns: els.watchedPatternsInput.value.split(",").map((item) => item.trim()).filter(Boolean),
      returnHeader: els.returnHeaderInput.value.trim() || "GPT feedback",
      handoffMode: "assisted",
    },
    handoffs: existing?.handoffs || [],
    ignoredWatchedArtifactPaths: existing?.ignoredWatchedArtifactPaths || [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

async function handleProjectFormSubmit(event) {
  event.preventDefault();
  if (!state.config) return;
  const project = projectFromForm();
  if (activeReviewThreadCount(project) < 1) {
    alert("Each project must keep at least one active Review ChatGPT thread.");
    return;
  }
  const existingIndex = state.config.projects.findIndex((item) => item.id === project.id);
  const existingProject = existingIndex >= 0 ? state.config.projects[existingIndex] : null;
  const requestedRuntimePath = directRuntimePathFromCodex(project.surfaceBinding?.codex || {});
  const currentRuntimePath = directRuntimePathFromCodex(existingProject?.surfaceBinding?.codex || {});
  const runtimePathChanged = requestedRuntimePath !== currentRuntimePath;
  const projectForConfig = runtimePathChanged ? projectWithRuntimePath(project, currentRuntimePath) : project;
  const projects = [...state.config.projects];
  if (existingIndex >= 0) projects[existingIndex] = projectForConfig;
  else projects.push(projectForConfig);
  await saveConfig({
    ...state.config,
    selectedProjectId: projectForConfig.id,
    chatgptDownloads: {
      ...(state.config.chatgptDownloads || {}),
      enabled: state.config.chatgptDownloads?.enabled !== false,
      windowsDownloadDir: els.chatgptDownloadDirInput.value.trim(),
    },
    projects,
  });
  closeDrawer();
  await selectProject(projectForConfig.id);
  if (runtimePathChanged && bridge.setDirectRuntimePath) {
    state.directRuntimeLoading = true;
    renderDirectRuntimeStatus();
    try {
      const result = await bridge.setDirectRuntimePath(project.id, requestedRuntimePath, {
        clientOperationId: directActivationClientId("client_project_runtime_path"),
      });
      if (result?.config) {
        state.config = result.config;
        render();
      }
      await refreshDirectRuntimeStatus(project.id);
      setLastEvent(`Saved project binding for ${project.name}; default Codex backend updated.`);
    } catch (error) {
      state.directRuntimeError = error.message || "Codex backend switch failed.";
      setLastEvent(`Saved project binding for ${project.name}; Codex backend change blocked: ${state.directRuntimeError}`);
    } finally {
      state.directRuntimeLoading = false;
      renderDirectRuntimeStatus();
    }
    return;
  }
  setLastEvent(`Saved project binding for ${project.name}.`);
}

async function deleteSelectedProject() {
  if (!state.config) return;
  const project = activeProject();
  if (!project) return;
  const confirmed = confirm(`Delete project binding "${project.name}"? This does not delete files or chats.`);
  if (!confirmed) return;
  const projects = state.config.projects.filter((item) => item.id !== project.id);
  if (!projects.length) {
    alert("At least one project binding is required.");
    return;
  }
  const nextSelected = projects[0].id;
  await saveConfig({ ...state.config, selectedProjectId: nextSelected, projects });
  closeDrawer();
  await selectProject(nextSelected);
  setLastEvent(`Deleted binding for ${project.name}.`);
}

function openThreadDrawer(mode, threadId = "") {
  const project = activeProject();
  if (!project) return;
  state.threadDrawerMode = mode;
  const now = nowIso();
  const draft = mode === "new"
    ? {
        id: createId("thread"),
        role: "review",
        title: "New ChatGPT thread",
        url: "https://chatgpt.com/",
        notes: "",
        isPrimary: false,
        pinned: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
      }
    : threadById(project, threadId) || activeThread(project);
  if (!draft) return;
  els.threadDrawer.classList.add("open");
  els.threadDrawer.setAttribute("aria-hidden", "false");
  bridge.setSurfaceVisible(false).catch(() => {});
  els.threadDrawerTitle.textContent = mode === "new" ? "Add ChatGPT thread" : "Edit ChatGPT thread";
  els.deleteThreadButton.style.display = mode === "new" ? "none" : "inline-flex";
  els.threadIdInput.value = draft.id;
  els.threadRoleInput.value = draft.role || "review";
  els.threadTitleInput.value = draft.title || "";
  els.threadUrlInput.value = draft.url || "https://chatgpt.com/";
  els.threadNotesInput.value = draft.notes || "";
  els.threadPrimaryInput.checked = Boolean(draft.isPrimary);
  els.threadPinnedInput.checked = Boolean(draft.pinned);
  els.threadArchivedInput.checked = Boolean(draft.archived);
  setTimeout(() => els.threadTitleInput.focus(), 0);
}

function threadFromForm() {
  const existing = threadById(activeProject(), els.threadIdInput.value);
  const now = nowIso();
  const role = THREAD_ROLES.includes(els.threadRoleInput.value) ? els.threadRoleInput.value : "custom";
  return {
    id: els.threadIdInput.value || createId("thread"),
    role,
    title: els.threadTitleInput.value.trim() || `${roleLabel(role)} thread`,
    url: normalizeHttpsUrl(els.threadUrlInput.value.trim()),
    notes: els.threadNotesInput.value.trim(),
    isPrimary: role === "review" && els.threadPrimaryInput.checked,
    pinned: els.threadPinnedInput.checked,
    archived: els.threadArchivedInput.checked,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    lastOpenedAt: existing?.lastOpenedAt || "",
  };
}

function normalizeThreadSet(threads) {
  const normalized = threads.map((thread) => ({ ...thread, isPrimary: thread.role === "review" ? Boolean(thread.isPrimary) : false }));
  let primary = normalized.find((thread) => thread.role === "review" && thread.isPrimary && !thread.archived) || normalized.find((thread) => thread.role === "review" && !thread.archived);
  if (!primary) primary = normalized.find((thread) => thread.role === "review") || normalized.find((thread) => !thread.archived) || normalized[0];
  if (primary) {
    for (const thread of normalized) thread.isPrimary = thread.id === primary.id && thread.role === "review";
  }
  return normalized;
}

async function handleThreadFormSubmit(event) {
  event.preventDefault();
  const project = activeProject();
  if (!project || !state.config) return;
  const thread = threadFromForm();
  let threads = chatThreads(project).slice();
  const existingIndex = threads.findIndex((item) => item.id === thread.id);
  if (existingIndex >= 0) threads[existingIndex] = thread;
  else threads.push(thread);
  if (thread.isPrimary) threads = threads.map((item) => ({ ...item, isPrimary: item.id === thread.id && item.role === "review" }));
  if (activeReviewThreadCount(threads) < 1) {
    alert("At least one active Review ChatGPT thread is required for each project.");
    return;
  }
  threads = normalizeThreadSet(threads);
  const activeId = !thread.archived ? thread.id : activeThread({ ...project, chatThreads: threads })?.id;
  const primary = primaryReviewThread({ ...project, chatThreads: threads });
  const updatedProject = {
    ...project,
    chatThreads: threads,
    activeChatThreadId: activeId,
    lastActiveThreadId: activeId,
    surfaceBinding: {
      ...project.surfaceBinding,
      chatgpt: { ...project.surfaceBinding.chatgpt, reviewThreadUrl: primary?.url || "https://chatgpt.com/" },
    },
    updatedAt: nowIso(),
  };
  const projects = state.config.projects.map((item) => (item.id === project.id ? updatedProject : item));
  await saveConfig({ ...state.config, projects });
  closeThreadDrawer();
  if (activeId) await selectThread(activeId);
  setLastEvent(`Saved ChatGPT thread binding: ${thread.title}.`);
}

async function deleteThreadFromDrawer() {
  const project = activeProject();
  if (!project || !state.config) return;
  const threadId = els.threadIdInput.value;
  const thread = threadById(project, threadId);
  if (!thread) return;
  const nonArchived = chatThreads(project).filter((item) => !item.archived);
  if (nonArchived.length <= 1) {
    alert("At least one active ChatGPT thread is required for a project.");
    return;
  }
  const remainingThreads = chatThreads(project).filter((item) => item.id !== threadId);
  if (activeReviewThreadCount(remainingThreads) < 1) {
    alert("At least one active Review ChatGPT thread is required for each project.");
    return;
  }
  const confirmed = confirm(`Remove ChatGPT thread binding "${thread.title}"? This does not delete the ChatGPT conversation.`);
  if (!confirmed) return;
  const threads = normalizeThreadSet(remainingThreads);
  const activeId = activeThread({ ...project, chatThreads: threads })?.id;
  const primary = primaryReviewThread({ ...project, chatThreads: threads });
  const updatedProject = {
    ...project,
    chatThreads: threads,
    activeChatThreadId: activeId,
    lastActiveThreadId: activeId,
    surfaceBinding: { ...project.surfaceBinding, chatgpt: { ...project.surfaceBinding.chatgpt, reviewThreadUrl: primary?.url || "https://chatgpt.com/" } },
    updatedAt: nowIso(),
  };
  await saveConfig({ ...state.config, projects: state.config.projects.map((item) => (item.id === project.id ? updatedProject : item)) });
  closeThreadDrawer();
  if (activeId) await selectThread(activeId);
  setLastEvent(`Removed thread binding: ${thread.title}.`);
}

function setMiddleTab(tab) {
  if (tab === "project") state.activeMiddleTab = "project";
  else if (tab === "threads") state.activeMiddleTab = "threads";
  else if (tab === "imports") state.activeMiddleTab = "imports";
  else if (tab === "analytics") state.activeMiddleTab = "analytics";
  else if (tab === "files") state.activeMiddleTab = "files";
  else if (tab === "web") state.activeMiddleTab = "web";
  else state.activeMiddleTab = "overview";
  if (state.activeMiddleTab === "web" && els.controlPlane) els.controlPlane.scrollTop = 0;
  renderMiddleTabs();
  if (state.activeMiddleTab === "analytics" && state.analyticsStatus === "idle") {
    loadAnalyticsThreads({ refresh: false }).catch((error) => {
      setLastEvent(`Analytics list load failed: ${error.message}`);
    });
  }
  if (state.activeMiddleTab === "project" && !state.directBridgeSettingsStatus && !state.directBridgeSettingsLoading) {
    refreshDirectBridgeSettingsStatus().catch((error) => {
      setLastEvent(`Bridge settings status load failed: ${error.message}`);
    });
  }
  if (state.activeMiddleTab === "imports" && state.directImportWorkbench.status === "idle") {
    loadDirectImports({ refresh: false }).catch((error) => {
      setLastEvent(`Import list load failed: ${error.message}`);
    });
  }
  if (state.activeMiddleTab === "threads" && state.directThreadWorkbench.status === "idle") {
    loadDirectThreadWorkbench({ refresh: false }).catch((error) => {
      setLastEvent(`Direct thread workbench load failed: ${error.message}`);
    });
  }
  scheduleResizeBurst();
}

function setChatgptThreadBrowserTab(tab) {
  state.activeChatgptThreadBrowserTab = tab === "recent" ? "recent" : "project";
  renderThreadsWorkbench();
  if (state.activeChatgptThreadBrowserTab === "recent" && state.chatgptRecentThreadsStatus === "idle") {
    loadChatgptRecentThreads({ refresh: false }).catch((error) => {
      setLastEvent(`ChatGPT recent-thread cache load failed: ${error.message}`);
    });
  }
}

async function importRecentChatgptThread() {
  const project = activeProject();
  if (!project || !state.config) return;
  const recent = recentChatgptThreadById(state.selectedRecentChatgptThreadId);
  if (!recent) {
    setLastEvent("Select a recent ChatGPT thread before importing.");
    return;
  }

  const existing = projectThreadByConversationId(project, recent.externalId);
  if (existing) {
    state.selectedProjectChatThreadId = existing.id;
    state.activeChatgptThreadBrowserTab = "project";
    renderThreadsWorkbench();
    setLastEvent(`ChatGPT thread already attached as ${existing.title}.`);
    return;
  }

  const now = nowIso();
  const importedThread = {
    id: createId("thread"),
    role: "custom",
    title: recent.title || "Imported ChatGPT thread",
    url: normalizeHttpsUrl(recent.url),
    notes: "Imported from recent ChatGPT threads.",
    isPrimary: false,
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: "",
  };
  const threads = normalizeThreadSet([importedThread, ...chatThreads(project)]);
  if (activeReviewThreadCount(threads) < 1) {
    setLastEvent("Cannot import thread: this project has no active Review thread. Add one first.");
    return;
  }
  const updatedProject = {
    ...project,
    chatThreads: threads,
    updatedAt: now,
  };
  await saveConfig({ ...state.config, projects: state.config.projects.map((item) => (item.id === project.id ? updatedProject : item)) });
  state.selectedProjectChatThreadId = importedThread.id;
  state.activeChatgptThreadBrowserTab = "project";
  renderThreadsWorkbench();
  setLastEvent(`Imported ChatGPT thread: ${importedThread.title}.`);
}

async function saveLaneBinding() {
  const project = activeProject();
  if (!project || !state.config) return;
  const codexThread = codexThreadById(state.selectedCodexThreadId);
  const chatThread = threadById(project, state.selectedProjectChatThreadId);
  if (!codexThread || !chatThread) {
    setLastEvent("Select one Codex thread and one ChatGPT thread before linking.");
    return;
  }
  const lane = THREAD_ROLES.includes(els.bindingLaneInput.value) ? els.bindingLaneInput.value : "custom";
  const label = els.bindingLabelInput.value.trim() || `${roleLabel(lane)} lane`;
  const now = nowIso();
  let bindings = laneBindings(project).slice();
  const bindingId = state.selectedBindingId || createId("binding");
  const nextBinding = {
    id: bindingId,
    lane,
    label,
    codexThreadRef: {
      threadId: codexThread.threadId,
      originator: codexThread.originator || "",
      titleSnapshot: codexThread.title || "",
      cwdSnapshot: codexThread.cwd || "",
      sourceHome: codexThread.sourceHome || "",
      sessionFilePath: codexThread.sessionFilePath || "",
    },
    chatThreadId: chatThread.id,
    isDefaultForLane: els.bindingDefaultLaneInput.checked,
    openOnProjectActivate: els.bindingOpenOnProjectInput.checked,
    lastActivatedAt: now,
    status: "resolved",
    createdAt: laneBindingById(project, bindingId)?.createdAt || now,
    updatedAt: now,
  };
  bindings = bindings.filter((binding) => binding.id !== bindingId);
  if (nextBinding.isDefaultForLane) {
    bindings = bindings.map((binding) => binding.lane === lane ? { ...binding, isDefaultForLane: false } : binding);
  }
  if (nextBinding.openOnProjectActivate) {
    bindings = bindings.map((binding) => ({ ...binding, openOnProjectActivate: false }));
  }
  bindings.unshift(nextBinding);
  const updatedProject = {
    ...project,
    laneBindings: bindings,
    lastActiveBindingId: bindingId,
    updatedAt: now,
  };
  await saveConfig({ ...state.config, projects: state.config.projects.map((item) => (item.id === project.id ? updatedProject : item)) });
  state.selectedBindingId = bindingId;
  renderThreadsWorkbench();
  setLastEvent(`Saved lane binding: ${label}.`);
}

async function copyActivePrompt() {
  const project = activeProject();
  if (!project) return;
  const prompt = activePromptText(project, activeThread(project));
  await bridge.copyText(prompt);
  setLastEvent("Active role-aware prompt copied to clipboard.");
}

async function copyReturnHeader() {
  const project = activeProject();
  if (!project) return;
  await bridge.copyText(project.flowProfile?.returnHeader || "GPT feedback");
  setLastEvent("Return header copied to clipboard.");
}

function targetThreadForKind(kind) {
  const project = activeProject();
  if (!project) return null;
  const selected = threadById(project, els.handoffTargetThreadSelect.value);
  if (kind === "architecture-question") return chatThreads(project).find((thread) => thread.role === "architecture" && !thread.archived) || selected || activeThread(project);
  if (kind === "research-question") return chatThreads(project).find((thread) => thread.role === "research" && !thread.archived) || selected || activeThread(project);
  return selected || activeThread(project) || primaryReviewThread(project);
}

function makeHandoff({ kind, title, promptText, targetThreadId, fileRelPath = "", source = "human" }) {
  const project = activeProject();
  const now = nowIso();
  return {
    id: createId("handoff"),
    projectId: project.id,
    source,
    targetThreadId,
    kind,
    fileRelPath,
    title,
    promptText,
    status: "staged",
    createdAt: now,
    updatedAt: now,
  };
}

async function addHandoff(item) {
  const project = activeProject();
  if (!project || !state.config) return;
  const updatedProject = { ...project, handoffs: [item, ...(project.handoffs || [])], updatedAt: nowIso() };
  await saveConfig({ ...state.config, projects: state.config.projects.map((candidate) => (candidate.id === project.id ? updatedProject : candidate)) });
  setLastEvent(`Staged handoff: ${item.title}.`);
}

async function stageFileHandoff(relPath = state.selectedFileRelPath, targetThreadId = "", source = "workspace") {
  const project = activeProject();
  if (!project || !relPath) {
    setLastEvent("Select a file before staging a file review handoff.");
    return;
  }
  const snapshot = projectRequestSnapshot(project.id);
  let preview = state.selectedFilePreview && state.selectedFilePreview.relPath === relPath ? state.selectedFilePreview : null;
  if (!preview) {
    try {
      preview = await bridge.readProjectFile(snapshot.projectId, relPath);
      if (isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
      state.selectedFilePreview = preview;
      state.selectedFileRelPath = preview.relPath;
    } catch (error) {
      if (isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
      state.selectedFilePreview = null;
      setLastEvent(`Unable to read file for handoff: ${error.message}`);
      return;
    }
  }
  if (isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
  const thread = threadById(project, targetThreadId) || targetThreadForKind("file-review");
  if (!thread) return;
  const prompt = interpolatePrompt(templateForThread(project, thread), {
    project,
    thread,
    fileRelPath: relPath,
    fileContents: preview.binary ? "" : preview.text || "",
  });
  await addHandoff(
    makeHandoff({
      kind: "file-review",
      source,
      targetThreadId: thread.id,
      fileRelPath: relPath,
      title: `Review ${relPath}`,
      promptText: prompt,
    }),
  );
}

async function stageQuestion(kind) {
  const project = activeProject();
  if (!project) return;
  const question = prompt(kind === "architecture-question" ? "Architecture question to stage:" : kind === "research-question" ? "Research question to stage:" : "Text review prompt to stage:");
  if (!question || !question.trim()) return;
  const thread = targetThreadForKind(kind);
  if (!thread) return;
  const base = interpolatePrompt(templateForThread(project, thread), { project, thread });
  const promptText = `${question.trim()}\n\n---\n\n${base}`;
  await addHandoff(
    makeHandoff({
      kind,
      source: "human",
      targetThreadId: thread.id,
      title: question.trim().slice(0, 90),
      promptText,
    }),
  );
}

async function updateHandoffStatus(handoffId, status) {
  const project = activeProject();
  if (!project || !state.config) return;
  const updatedProject = {
    ...project,
    handoffs: (project.handoffs || []).map((item) => (item.id === handoffId ? { ...item, status, updatedAt: nowIso() } : item)),
    updatedAt: nowIso(),
  };
  await saveConfig({ ...state.config, projects: state.config.projects.map((candidate) => (candidate.id === project.id ? updatedProject : candidate)) });
  setLastEvent(`Handoff marked ${status}.`);
}

function handoffById(project, handoffId) {
  return (project?.handoffs || []).find((item) => item.id === handoffId) || null;
}

async function openHandoffThread(handoffId) {
  const project = activeProject();
  const item = handoffById(project, handoffId);
  if (!item || !item.targetThreadId) {
    setLastEvent("This handoff is orphaned and needs a valid target thread.");
    return;
  }
  await selectThread(item.targetThreadId);
  await updateHandoffStatus(handoffId, "opened-thread");
}

async function copyHandoffPrompt(handoffId) {
  const project = activeProject();
  const item = handoffById(project, handoffId);
  if (!item) return;
  await bridge.copyText(item.promptText);
  await updateHandoffStatus(handoffId, "copied");
}

async function revealHandoffFile(handoffId) {
  const project = activeProject();
  const item = handoffById(project, handoffId);
  if (!project || !item?.fileRelPath) return;
  try {
    const result = await bridge.revealProjectFile(project.id, item.fileRelPath);
    setLastEvent(`Reveal file requested via ${result.method}.`);
  } catch (error) {
    setLastEvent(`Reveal file failed: ${error.message}`);
  }
}

async function ignoreWatchedArtifact(relPath) {
  const project = activeProject();
  if (!project || !state.config) return;
  const ignored = Array.from(new Set([...(project.ignoredWatchedArtifactPaths || []), relPath]));
  const updatedProject = { ...project, ignoredWatchedArtifactPaths: ignored, updatedAt: nowIso() };
  await saveConfig({ ...state.config, projects: state.config.projects.map((item) => (item.id === project.id ? updatedProject : item)) });
  await loadWatchedArtifacts();
  setLastEvent(`Ignored watched artifact: ${relPath}.`);
}

async function loadWatchedArtifacts(options = {}) {
  const snapshot = {
    ...projectRequestSnapshot(),
    ...(options || {}),
  };
  if (!snapshot.projectId) return;
  const requestVersion = nextRequestVersion("watchedArtifacts");
  try {
    const result = await bridge.listWatchedArtifacts(snapshot.projectId);
    if (isRequestStale("watchedArtifacts", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    const entries = Array.isArray(result.entries) ? result.entries : [];
    const scanLimit = Number(result.limit || 0);
    const walkLimit = Number(result.walkLimit || 0);
    const scanned = Number(result.scanned || 0);
    const scanLimitHit = scanLimit > 0 && entries.length >= scanLimit;
    const walkLimitHit = walkLimit > 0 && scanned >= walkLimit;
    const warning = scanLimitHit || walkLimitHit
      ? `Scan may be partial: ${scanLimitHit ? "entry limit reached" : ""}${scanLimitHit && walkLimitHit ? " · " : ""}${walkLimitHit ? "walk limit reached" : ""}.`
      : "";
    state.watchedArtifactsScan = {
      scanned,
      scanLimit,
      walkLimit,
      scanLimitHit,
      walkLimitHit,
      warning,
    };
    state.watchedArtifacts = entries;
    renderWatchedArtifacts();
    setLastEvent(
      `Watched artifact scan found ${state.watchedArtifacts.length} matching files.${warning ? ` ${warning}` : ""}`
    );
  } catch (error) {
    if (isRequestStale("watchedArtifacts", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.watchedArtifactsScan = null;
    state.watchedArtifacts = [];
    renderWatchedArtifacts();
    setLastEvent(`Watched artifact scan failed: ${error.message}`);
  }
}

function beginDrag(splitterName, event) {
  if (!state.config) return;
  event.preventDefault();
  const drag = { splitterName, pointerId: event.pointerId, startX: event.clientX, startWidths: { ...state.currentWidths } };
  document.body.classList.add("dragging");
  bridge.setSurfaceVisible(false).catch(() => {});

  const move = (moveEvent) => {
    const rect = els.appShell.getBoundingClientRect();
    const total = Math.max(1, Math.round(rect.width) - MIN_WIDTHS.splitter * 2);
    let left = drag.startWidths.left;
    let middle = drag.startWidths.middle;

    if (splitterName === "left") {
      left = clamp(moveEvent.clientX - rect.left, MIN_WIDTHS.left, total - MIN_WIDTHS.middle - MIN_WIDTHS.right);
      middle = clamp(middle, MIN_WIDTHS.middle, total - left - MIN_WIDTHS.right);
    } else {
      middle = clamp(moveEvent.clientX - rect.left - left - MIN_WIDTHS.splitter, MIN_WIDTHS.middle, total - left - MIN_WIDTHS.right);
    }

    const right = total - left - middle;
    state.currentWidths = { left, middle, right, total };
    state.config = {
      ...state.config,
      ui: { ...(state.config.ui ?? {}), leftRatio: left / total, middleRatio: middle / total },
    };
    document.documentElement.style.setProperty("--left-plane-width", `${Math.round(left)}px`);
    document.documentElement.style.setProperty("--control-plane-width", `${Math.round(middle)}px`);
  };

  const stop = async () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
    document.body.classList.remove("dragging");
    await saveConfig(state.config);
    bridge.setSurfaceVisible(true).then(scheduleResizeBurst).catch(scheduleResizeBurst);
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
}

function renderTreeEntries(container, entries) {
  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No visible files in this directory.";
    container.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    const wrapper = document.createElement("div");
    wrapper.className = "tree-node";

    const row = document.createElement("button");
    row.type = "button";
    row.className = `tree-row ${entry.type}`;
    row.dataset.relPath = entry.relPath;
    row.innerHTML = `<span class="twisty"></span><span class="truncate mono"></span>`;
    row.querySelector(".twisty").textContent = entry.type === "dir" ? "▸" : entry.type === "file" ? "•" : "◇";
    row.querySelector(".truncate").textContent = entry.name;
    row.title = entry.relPath;

    const children = document.createElement("div");
    children.className = "tree-children";
    children.hidden = true;

    row.addEventListener("click", () => {
      if (entry.type === "dir") toggleDirectory(entry, row, children);
      else if (entry.type === "file") previewFile(entry.relPath, row);
      else setLastEvent(`Preview unavailable for ${entry.type}: ${entry.relPath}`);
    });

    wrapper.appendChild(row);
    wrapper.appendChild(children);
    container.appendChild(wrapper);
  }
}

async function loadWorkTreeRoot(options = {}) {
  const snapshot = {
    ...projectRequestSnapshot(),
    ...(options || {}),
  };
  if (!snapshot.projectId) return;
  const project = activeProject();
  if (!project || project.id !== snapshot.projectId) return;
  const requestVersion = nextRequestVersion("workTree");
  els.workTree.innerHTML = `<div class="empty-state">Loading ${project.name}…</div>`;
  resetPreview("Select a text/code file from the work tree.");
  try {
    const result = await bridge.listWorkTree(snapshot.projectId, "");
    if (isRequestStale("workTree", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    els.workTree.innerHTML = "";
    renderTreeEntries(els.workTree, result.entries);
    if (result.skipped) {
      const skipped = document.createElement("div");
      skipped.className = "empty-state";
      skipped.textContent = `${result.skipped} heavy or extra entries hidden for responsiveness.`;
      els.workTree.appendChild(skipped);
    }
    setLastEvent(`Loaded work tree for ${project.name}.`);
  } catch (error) {
    if (isRequestStale("workTree", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    els.workTree.innerHTML = `<div class="empty-state"></div>`;
    els.workTree.querySelector(".empty-state").textContent = `Work tree error: ${error.message}`;
    setLastEvent(`Work tree error: ${error.message}`);
  }
}

async function toggleDirectory(entry, row, children) {
  if (children.dataset.loaded === "true") {
    children.hidden = !children.hidden;
    row.querySelector(".twisty").textContent = children.hidden ? "▸" : "▾";
    return;
  }

  const project = activeProject();
  if (!project) return;
  row.querySelector(".twisty").textContent = "…";
  children.hidden = false;
  children.innerHTML = `<div class="empty-state">Loading…</div>`;
  try {
    const result = await bridge.listWorkTree(project.id, entry.relPath);
    children.innerHTML = "";
    renderTreeEntries(children, result.entries);
    if (result.skipped) {
      const skipped = document.createElement("div");
      skipped.className = "empty-state";
      skipped.textContent = `${result.skipped} entries hidden.`;
      children.appendChild(skipped);
    }
    children.dataset.loaded = "true";
    row.querySelector(".twisty").textContent = "▾";
  } catch (error) {
    children.innerHTML = `<div class="empty-state"></div>`;
    children.querySelector(".empty-state").textContent = error.message;
    row.querySelector(".twisty").textContent = "!";
  }
}

function resetPreview(message) {
  state.selectedFileRelPath = "";
  state.selectedFilePreview = null;
  els.previewPath.textContent = "No file selected";
  els.previewPath.title = "";
  els.previewMeta.textContent = "—";
  els.filePreview.textContent = message;
  renderPromptPreview();
}

async function previewFile(relPath, row) {
  const project = activeProject();
  if (!project) return;
  const requestVersion = nextRequestVersion("preview");
  const snapshot = projectRequestSnapshot(project.id);
  for (const selected of els.workTree.querySelectorAll(".tree-row.selected")) selected.classList.remove("selected");
  row?.classList.add("selected");
  state.selectedFileRelPath = relPath;
  els.previewPath.textContent = relPath;
  els.previewPath.title = relPath;
  els.previewMeta.textContent = "loading…";
  els.filePreview.textContent = "Loading preview…";

  try {
    const result = await bridge.readProjectFile(project.id, relPath);
    if (isRequestStale("preview", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.selectedFilePreview = result;
    state.selectedFileRelPath = result.relPath;
    els.previewPath.textContent = result.relPath;
    els.previewPath.title = result.absolutePath;
    els.previewMeta.textContent = `${formatBytes(result.size)}${result.truncated ? ` · first ${formatBytes(result.limit)}` : ""}`;
    if (result.binary) {
      els.filePreview.textContent = "Binary or non-text file. Preview intentionally disabled.";
    } else {
      els.filePreview.textContent = `${result.truncated ? "/* Preview truncated for responsiveness. */\n\n" : ""}${result.text}`;
    }
    renderPromptPreview();
    setLastEvent(`Previewing ${result.relPath}.`);
  } catch (error) {
    if (isRequestStale("preview", requestVersion) || isProjectRequestStale(snapshot.projectId, snapshot.projectVersion)) return;
    state.selectedFilePreview = null;
    els.previewMeta.textContent = "error";
    els.filePreview.textContent = error.message;
    setLastEvent(`Preview error: ${error.message}`);
  }
}

function bindEvents() {
  els.rightChatgptTabButton?.addEventListener("click", () => setRightPlaneTab("chatgpt"));
  els.rightSubAgentsTabButton?.addEventListener("click", () => setRightPlaneTab("subagents"));
  els.overviewTabButton.addEventListener("click", () => setMiddleTab("overview"));
  els.projectTabButton.addEventListener("click", () => setMiddleTab("project"));
  els.threadsTabButton.addEventListener("click", () => setMiddleTab("threads"));
  els.importsTabButton.addEventListener("click", () => setMiddleTab("imports"));
  els.analyticsTabButton.addEventListener("click", () => setMiddleTab("analytics"));
  els.filesTabButton.addEventListener("click", () => setMiddleTab("files"));
  els.webTabButton.addEventListener("click", () => setMiddleTab("web"));
  els.middleFileCopyRefButton.addEventListener("click", () => {
    copyMiddleFileRef().catch((error) => setLastEvent(`Copy file reference failed: ${error.message}`));
  });
  els.middleFileRevealButton.addEventListener("click", () => {
    revealMiddleFile().catch((error) => setLastEvent(`File reveal failed: ${error.message}`));
  });
  els.projectStashMessageInput.addEventListener("input", () => {
    const stash = ensureProjectStash();
    stash.message = String(els.projectStashMessageInput.value || "");
  });
  els.clearProjectStashButton.addEventListener("click", clearProjectStash);
  els.sendProjectStashButton.addEventListener("click", () => {
    sendProjectStash().catch((error) => {
      const stash = ensureProjectStash();
      stash.status = "failed";
      stash.lastError = error.message || "Project stash send failed.";
      renderProjectStash();
      setLastEvent(`Project stash send failed: ${stash.lastError}`);
    });
  });
  els.addProjectButton.addEventListener("click", () => openDrawer("new"));
  els.editProjectButton.addEventListener("click", () => openDrawer("edit"));
  els.closeDrawerButton.addEventListener("click", closeDrawer);
  els.cancelProjectButton.addEventListener("click", closeDrawer);
  els.form.addEventListener("submit", handleProjectFormSubmit);
  els.deleteProjectButton.addEventListener("click", deleteSelectedProject);
  els.chooseRepoButton.addEventListener("click", async () => {
    const selected = await bridge.chooseDirectory();
    if (selected) els.repoPathInput.value = selected;
  });
  els.refreshDirectImportsButton?.addEventListener("click", () => {
    loadDirectImports({ refresh: true }).catch((error) => setLastEvent(`Import refresh failed: ${error.message}`));
  });
  els.refreshDirectThreadWorkbenchButton?.addEventListener("click", () => {
    loadDirectThreadWorkbench({ refresh: true }).catch((error) => setLastEvent(`Direct thread workbench refresh failed: ${error.message}`));
  });
  els.directThreadIncludeHiddenInput?.addEventListener("change", () => {
    state.directThreadWorkbench.filters.includeHidden = Boolean(els.directThreadIncludeHiddenInput.checked);
    loadDirectThreadWorkbench({ refresh: true }).catch((error) => setLastEvent(`Direct thread filter failed: ${error.message}`));
  });
  els.directThreadIncludeArchivedInput?.addEventListener("change", () => {
    state.directThreadWorkbench.filters.includeArchived = Boolean(els.directThreadIncludeArchivedInput.checked);
    loadDirectThreadWorkbench({ refresh: true }).catch((error) => setLastEvent(`Direct thread filter failed: ${error.message}`));
  });
  els.directThreadIncludeSoftDeletedInput?.addEventListener("change", () => {
    state.directThreadWorkbench.filters.includeSoftDeleted = Boolean(els.directThreadIncludeSoftDeletedInput.checked);
    loadDirectThreadWorkbench({ refresh: true }).catch((error) => setLastEvent(`Direct thread filter failed: ${error.message}`));
  });
  els.directThreadTextQueryInput?.addEventListener("input", () => {
    state.directThreadWorkbench.filters.textQuery = els.directThreadTextQueryInput.value || "";
    loadDirectThreadWorkbench({ refresh: false }).catch((error) => setLastEvent(`Direct thread search failed: ${error.message}`));
  });
  els.chooseDirectImportFileButton?.addEventListener("click", () => {
    chooseDirectImportFile().catch((error) => setLastEvent(`Choose import source failed: ${error.message}`));
  });
  els.chooseDirectImportRootButton?.addEventListener("click", () => {
    chooseDirectImportRoot().catch((error) => setLastEvent(`Choose import root failed: ${error.message}`));
  });
  els.workspaceKindInput.addEventListener("change", updateWorkspaceFieldVisibility);
  els.codexDefaultPathInput?.addEventListener("change", () => {
    syncProjectRuntimeFieldsFromDefaultPath();
    updateCodexSpawnAgentControlAvailability();
  });
  els.codexModeInput?.addEventListener("change", updateCodexSpawnAgentControlAvailability);
  els.codexProviderKindInput?.addEventListener("change", updateCodexSpawnAgentControlAvailability);
  els.codexRuntimeModeInput?.addEventListener("change", updateCodexSpawnAgentControlAvailability);
  els.projectChatgptThreadSelect.addEventListener("change", syncProjectChatgptUrlFromSelection);
  els.addThreadButton.addEventListener("click", () => openThreadDrawer("new"));
  els.threadForm.addEventListener("submit", handleThreadFormSubmit);
  els.closeThreadDrawerButton.addEventListener("click", closeThreadDrawer);
  els.cancelThreadButton.addEventListener("click", closeThreadDrawer);
  els.deleteThreadButton.addEventListener("click", deleteThreadFromDrawer);
  els.projectChatThreadsTabButton.addEventListener("click", () => setChatgptThreadBrowserTab("project"));
  els.recentChatThreadsTabButton.addEventListener("click", () => setChatgptThreadBrowserTab("recent"));
  els.openThreadAttachButton.addEventListener("click", () => {
    const project = activeProject();
    const selected = threadById(project, state.selectedProjectChatThreadId);
    openThreadDrawer(selected ? "edit" : "new", selected?.id || "");
  });
  const refreshCodexThreadList = () => {
    loadCodexThreads().catch((error) => {
      setLastEvent(`Codex thread refresh failed: ${errorMessageText(error)}`);
    });
  };
  els.refreshCodexThreadsButton.addEventListener("click", refreshCodexThreadList);
  els.refreshCodexThreadListButton?.addEventListener("click", refreshCodexThreadList);
  els.refreshRecentChatThreadsButton.addEventListener("click", () => {
    loadChatgptRecentThreads({ refresh: true }).catch((error) => {
      setLastEvent(`ChatGPT recent-thread refresh failed: ${error.message}`);
    });
  });
  els.updateAnalyticsButton.addEventListener("click", () => {
    updateAnalytics().catch((error) => {
      setLastEvent(`Analytics update failed: ${error.message}`);
    });
  });
  els.importRecentChatThreadButton.addEventListener("click", importRecentChatgptThread);
  els.newBindingButton.addEventListener("click", () => {
    state.selectedBindingId = "";
    resetBindingEditor();
    renderThreadsWorkbench();
  });
  els.saveBindingButton.addEventListener("click", saveLaneBinding);
  els.threadRoleInput.addEventListener("change", () => {
    if (els.threadRoleInput.value !== "review") els.threadPrimaryInput.checked = false;
  });
  els.copyPromptButton.addEventListener("click", copyActivePrompt);
  els.copyHeaderButton.addEventListener("click", copyReturnHeader);
  els.stageSelectedFileButton.addEventListener("click", () => stageFileHandoff());
  els.stagePreviewButton.addEventListener("click", () => stageFileHandoff());
  els.stageTextReviewButton.addEventListener("click", () => stageQuestion("text-review"));
  els.stageArchitectureQuestionButton.addEventListener("click", () => stageQuestion("architecture-question"));
  els.stageResearchQuestionButton.addEventListener("click", () => stageQuestion("research-question"));
  els.reloadCodexButton.addEventListener("click", reloadActiveCodexRuntime);
  els.reloadChatButton.addEventListener("click", () => bridge.reloadSurface("chatgpt"));
  els.externalChatButton.addEventListener("click", () => bridge.openSurfaceExternal("chatgpt"));
  els.forceDarkButton.addEventListener("click", async () => {
    await bridge.forceChatgptDark();
    setLastEvent("Requested best-effort ChatGPT dark mode.");
  });
  els.chatSettingsButton.addEventListener("click", async () => {
    const result = await bridge.openChatgptSettings();
    setLastEvent(result.ok ? `Requested ChatGPT settings (${result.method}).` : `ChatGPT settings failed (${result.method}).`);
  });
  els.directAuthRefreshButton.addEventListener("click", refreshDirectAuthStatus);
  els.directAuthStorageModeSelect.addEventListener("change", () => setDirectAuthStorageMode(els.directAuthStorageModeSelect.value));
  els.directAuthLoginButton.addEventListener("click", beginDirectAuthLogin);
  els.directAuthLogoutButton.addEventListener("click", logoutDirectAuth);
  els.directRuntimePathSelect?.addEventListener("change", renderDirectRuntimeStatus);
  els.directRuntimePathApplyButton?.addEventListener("click", () => setDirectRuntimePathFromControl(els.directRuntimePathSelect));
  els.codexRuntimeQuickSelect?.addEventListener("change", renderDirectRuntimeStatus);
  els.codexRuntimeQuickApplyButton?.addEventListener("click", () => setDirectRuntimePathFromControl(els.codexRuntimeQuickSelect));
  els.codexRuntimeSettingsButton?.addEventListener("click", () => {
    setMiddleTab("project");
    setLastEvent("Opened Project settings for direct runtime details.");
  });
  els.directImplementationRefreshButton?.addEventListener("click", () => refreshDirectImplementationUiStatus().catch((error) => setLastEvent(`Direct implementation UI refresh failed: ${error.message}`)));
  els.directMetaSessionRefreshButton?.addEventListener("click", () => refreshDirectMetaSessionStatus().catch((error) => setLastEvent(`Meta-session status refresh failed: ${error.message}`)));
  els.directBridgeSettingsRefreshButton?.addEventListener("click", () => refreshDirectBridgeSettingsStatus().catch((error) => setLastEvent(`Bridge settings status refresh failed: ${error.message}`)));
  els.directTextOnlyEnableButton?.addEventListener("click", selectDirectTextOnlyRuntime);
  els.directExperimentalEnableButton?.addEventListener("click", enableDirectExperimentalRuntime);
  els.directExperimentalRollbackButton?.addEventListener("click", rollbackDirectExperimentalRuntime);
  els.refreshWorkTreeButton.addEventListener("click", loadWorkTreeRoot);
  els.refreshWatchedButton.addEventListener("click", loadWatchedArtifacts);
  els.webBackButton.addEventListener("click", () => {
    if (bridge.middleWebGoBack) bridge.middleWebGoBack().catch((error) => setLastEvent(`Web back failed: ${error.message}`));
  });
  els.webForwardButton.addEventListener("click", () => {
    if (bridge.middleWebGoForward) bridge.middleWebGoForward().catch((error) => setLastEvent(`Web forward failed: ${error.message}`));
  });
  els.webReloadButton.addEventListener("click", () => {
    const action = state.middleWeb?.loading ? bridge.middleWebStop : bridge.middleWebReload;
    if (action) action().catch((error) => setLastEvent(`Web ${state.middleWeb?.loading ? "stop" : "reload"} failed: ${error.message}`));
  });
  els.webCopyUrlButton.addEventListener("click", async () => {
    try {
      const result = await bridge.middleWebCopyUrl?.();
      setLastEvent(result?.ok ? "Copied Web tab URL." : `Copy URL blocked: ${result?.error || "unknown error"}`);
    } catch (error) {
      setLastEvent(`Copy URL failed: ${error.message}`);
    }
  });
  els.webOpenExternalButton.addEventListener("click", async () => {
    try {
      const result = await bridge.middleWebOpenExternal?.();
      setLastEvent(result?.ok ? "Opened Web tab externally." : `Open external blocked: ${result?.error || "unknown error"}`);
    } catch (error) {
      setLastEvent(`Open external failed: ${error.message}`);
    }
  });
  els.webBrowserTabButton.addEventListener("click", () => setMiddleWebViewMode("browser"));
  els.webHistoryTabButton.addEventListener("click", () => setMiddleWebViewMode("history"));
  els.webPruneHistoryButton.addEventListener("click", () => {
    pruneAllMiddleWebHistory().catch((error) => setLastEvent(`Web history prune failed: ${error.message}`));
  });

  els.leftSplitter.addEventListener("pointerdown", (event) => beginDrag("left", event));
  els.rightSplitter.addEventListener("pointerdown", (event) => beginDrag("right", event));

  window.addEventListener("resize", scheduleResizeBurst);
  document.addEventListener("wheel", handlePlaneZoomWheel, { passive: false, capture: true });
  if (window.visualViewport) window.visualViewport.addEventListener("resize", scheduleResizeBurst);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) scheduleResizeBurst();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && els.threadDrawer.classList.contains("open")) closeThreadDrawer();
    else if (event.key === "Escape" && els.drawer.classList.contains("open")) closeDrawer();
    if (event.key === "Escape") bridge.dismissCodexComposerOverlay?.("shell-escape").catch(() => {});
  });

  document.addEventListener("pointerdown", () => {
    bridge.dismissCodexComposerOverlay?.("shell-pointerdown").catch(() => {});
  }, true);

  document.addEventListener("focusin", () => {
    bridge.dismissCodexComposerOverlay?.("shell-focusin").catch(() => {});
  }, true);

  const resizeObserver = new ResizeObserver(scheduleResizeBurst);
  resizeObserver.observe(els.appShell);
  resizeObserver.observe(els.codexSlot);
  resizeObserver.observe(els.chatgptSlot);
  if (els.subAgentsSlot) resizeObserver.observe(els.subAgentsSlot);
  if (els.middleWebSlot) resizeObserver.observe(els.middleWebSlot);
  if (els.controlPlane) els.controlPlane.addEventListener("scroll", scheduleResizeBurst, { passive: true });

  bridge.onSurfaceEvent((event) => {
    if (event.surface === "codex" && event.type === "focus-sub-agent") {
      handleCodexFocusSubAgent(event);
      return;
    }
    if (event.surface === "codex" || event.surface === "chatgpt") {
      state.surfaceEvents[event.surface] = event;
      renderStatus();
      if (event.type === "loaded") setLastEvent(`${event.surface} loaded: ${event.title || event.url || "ready"}`);
      if (event.type === "load-failed") setLastEvent(`${event.surface} load failed: ${event.errorDescription}`);
      if (event.type === "navigation-blocked") setLastEvent(`${event.surface} blocked navigation: ${event.url}`);
      if (event.type === "settings-opened") setLastEvent(`ChatGPT settings requested via ${event.method}.`);
      if (event.type === "settings-open-failed") setLastEvent(`ChatGPT settings request failed via ${event.method}.`);
      if (event.surface === "codex" && event.type === "thread-state") handleCodexThreadState(event);
      if (event.surface === "codex" && event.type === "agent-graph") handleCodexAgentGraph(event);
    }
  });

  bridge.onShellEvent((event) => {
    if (event.type === "config-updated" && event.config) {
      state.config = event.config;
      render();
    }
    if (event.type === "layout-request") scheduleResizeBurst();
    if (event.type === "middle-web-open-requested") {
      state.middleWebViewMode = "browser";
      setMiddleTab("web");
    }
    if (event.type === "middle-file-open-requested") {
      setMiddleTab("files");
    }
    if (event.type === "project-stash-add-file") {
      addProjectStashFile(event);
    }
    if (event.type === "middle-file-state") {
      state.middleFile = middleFileStateFromEvent(event);
      renderMiddleFileTab();
      if (event.fileEventType === "loaded") setLastEvent(`Opened file: ${event.relPath || event.displayName || "file"}.`);
      else if (event.fileEventType === "failed") setLastEvent(`File open failed: ${event.error || "unknown error"}.`);
    }
    if (event.type === "middle-web-state") {
      state.middleWeb = {
        ...state.middleWeb,
        ...event,
      };
      delete state.middleWeb.type;
      delete state.middleWeb.webEventType;
      renderMiddleWebTab();
      scheduleResizeBurst();
      if (event.webEventType === "navigation-blocked") setLastEvent(event.lastError || "Middle Web navigation blocked.");
      else if (event.webEventType === "load-failed") setLastEvent(`Middle Web load failed: ${event.lastError || event.errorDescription || "unknown error"}`);
    }
    if (event.type === "middle-web-history") {
      state.middleWebHistory = Array.isArray(event.entries) ? event.entries : [];
      renderMiddleWebTab();
    }
    if (event.type === "plane-zoom-state" && event.plane === "middle") {
      applyMiddlePlaneZoom(event.zoomFactor);
    }
    if (event.type === "backend-status" && event.session?.projectId) {
      state.workspaceStatuses[event.session.projectId] = event.session;
      renderSelectedProject();
      if (event.error) setLastEvent(`Workspace backend error: ${event.error}`);
      else if (event.session.status === "attached") setLastEvent(`Workspace backend attached: ${event.session.transport}`);
      else if (event.session.status === "failed") setLastEvent(`Workspace backend failed: ${event.session.lastErrorCode || "unknown"}`);
    }
    if (event.type === "chatgpt-download-started") {
      setLastEvent(`ChatGPT download started: ${event.fileName || "download"}.`);
    }
    if (event.type === "chatgpt-download-completed") {
      const macro = event.macro || {};
      if (event.stash?.added) {
        setLastEvent(`ChatGPT download added to Project stash: ${macro.importedRelPath || event.fileName || "download"}.`);
      } else if (macro.activated) {
        setLastEvent(`ChatGPT download imported: ${macro.importedRelPath || event.fileName || "download"}.`);
      } else {
        setLastEvent(`ChatGPT download saved: ${event.fileName || "download"}.`);
      }
    }
    if (event.type === "chatgpt-download-failed") {
      setLastEvent(`ChatGPT download failed: ${event.error || event.state || "unknown error"}.`);
    }
    if (event.type === "context-menu-diagnostic") {
      setLastEvent(event.message || "Context menu action completed.");
    }
    if (event.type === "codex-runtime-status") {
      const status = event.session?.status || "unknown";
      const details = event.session?.error ? `: ${event.session.error}` : "";
      setLastEvent(`Codex runtime ${status}${details}`);
    }
    if (event.type === "codex-approval-requested") {
      const details = event.reason ? `: ${event.reason}` : "";
      setLastEvent(`Codex approval requested via ${event.method}${details}`);
    }
    if (event.type === "direct-auth-status") {
      state.directAuthStatus = event.status || state.directAuthStatus;
      state.directAuthSettings = event.settings || state.directAuthSettings;
      renderDirectAuthControls();
      setLastEvent(`Direct auth ${event.action}: ${directAuthStatusLabel(state.directAuthStatus)}.`);
    }
    if (event.type === "direct-auth-bridge-status") {
      setLastEvent(`Direct auth bridge ${event.status || "unknown"}: ${event.reason || "no details"}`);
    }
    if (event.type === "direct-runtime-status") {
      state.directRuntimeStatus = event.status || state.directRuntimeStatus;
      renderDirectAuthControls();
      refreshDirectImplementationUiStatus(activeProject()?.id || "", { renderBefore: false }).catch(() => {});
      setLastEvent(`Direct runtime ${directRuntimeModeLabel(state.directRuntimeStatus)}: ${directRuntimeStatusLabel(state.directRuntimeStatus)}.`);
    }
    if (event.type === "codex-runtime-auto-routed" && event.projectId && event.toRuntimePath) {
      state.activeCodexRuntimePathByProject[event.projectId] = event.toRuntimePath;
      renderDirectRuntimeStatus();
    }
    if (event.type === "codex-request-updated" && event.request?.key) {
      const request = event.request;
      if (["resolved", "declined", "canceled", "connection-closed"].includes(request.status)) {
        state.codexRequests.delete(request.key);
      } else {
        state.codexRequests.set(request.key, request);
      }
      renderCodexRequests();
      if (request.status === "pending") {
        setLastEvent(`Codex request pending: ${request.title || request.method}${request.summary ? `: ${request.summary}` : ""}`);
      }
    }
  });
}

async function init() {
  if (!bridge) {
    document.body.innerHTML = "<main style='padding:24px;color:white'>Electron preload bridge is unavailable.</main>";
    return;
  }
  applyMiddlePlaneZoom(PLANE_ZOOM_DEFAULT);
  bindEvents();
  const result = await bridge.loadConfig();
  state.config = result.config;
  state.configPath = result.configPath;
  state.repoRoot = result.repoRoot;
  state.platform = result.platform || "";
  state.defaultWorkspace = result.defaultWorkspace || null;
  state.defaultCodexRuntime = result.defaultCodexRuntime || "auto";
  state.directRuntimeStatus = result.directRuntimeStatus || null;
  state.directMetaSessionStatus = result.directMetaSessionStatus || null;
  state.allowNonChatgptUrls = Boolean(result.allowNonChatgptUrls);
  render();
  await loadDirectAuthSettings();
  await loadMiddleWebHistory();
  await selectProject(state.config.selectedProjectId);
  await loadChatgptRecentThreads({ refresh: false });
}

init().catch((error) => {
  console.error(error);
  setLastEvent(`Startup error: ${error.message}`);
});
