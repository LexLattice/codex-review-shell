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

const state = {
  config: null,
  configPath: "",
  repoRoot: "",
  platform: "",
  defaultWorkspace: null,
  defaultCodexRuntime: "auto",
  allowNonChatgptUrls: false,
  activeMiddleTab: "overview",
  analyticsThreads: [],
  analyticsStatus: "idle",
  analyticsDashboard: null,
  analyticsDashboardStatus: "idle",
  selectedAnalyticsThreadKey: "",
  surfaceEvents: {
    codex: { type: "idle" },
    chatgpt: { type: "idle" },
  },
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
  selectedCodexThreadId: "",
  openedCodexProjectId: "",
  openedCodexThreadId: "",
  openedCodexThreadTitle: "",
  selectedProjectChatThreadId: "",
  selectedRecentChatgptThreadId: "",
  selectedBindingId: "",
  activeChatgptThreadBrowserTab: "project",
  requestVersions: {
    project: 0,
    thread: 0,
    codexThreads: 0,
    recentThreads: 0,
    analyticsThreads: 0,
    analyticsDetail: 0,
    workTree: 0,
    watchedArtifacts: 0,
    preview: 0,
  },
};

const els = {
  appShell: document.getElementById("appShell"),
  selectedProjectName: document.getElementById("selectedProjectName"),
  repoPath: document.getElementById("repoPath"),
  workspacePath: document.getElementById("workspacePath"),
  backendStatus: document.getElementById("backendStatus"),
  bindingStatus: document.getElementById("bindingStatus"),
  activeThreadStatus: document.getElementById("activeThreadStatus"),
  overviewTabButton: document.getElementById("overviewTabButton"),
  threadsTabButton: document.getElementById("threadsTabButton"),
  analyticsTabButton: document.getElementById("analyticsTabButton"),
  overviewTabPanel: document.getElementById("overviewTabPanel"),
  threadsTabPanel: document.getElementById("threadsTabPanel"),
  analyticsTabPanel: document.getElementById("analyticsTabPanel"),
  projectList: document.getElementById("projectList"),
  projectCount: document.getElementById("projectCount"),
  threadDeck: document.getElementById("threadDeck"),
  threadCount: document.getElementById("threadCount"),
  addThreadButton: document.getElementById("addThreadButton"),
  configPath: document.getElementById("configPath"),
  codexSlot: document.getElementById("codexSlot"),
  chatgptSlot: document.getElementById("chatgptSlot"),
  codexSurfaceTitle: document.getElementById("codexSurfaceTitle"),
  chatgptSurfaceTitle: document.getElementById("chatgptSurfaceTitle"),
  leftSplitter: document.getElementById("leftSplitter"),
  rightSplitter: document.getElementById("rightSplitter"),
  codexStatus: document.getElementById("codexStatus"),
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
  directAuthEvidence: document.getElementById("directAuthEvidence"),
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
  analyticsThreadCount: document.getElementById("analyticsThreadCount"),
  updateAnalyticsButton: document.getElementById("updateAnalyticsButton"),
  analyticsHint: document.getElementById("analyticsHint"),
  analyticsThreadList: document.getElementById("analyticsThreadList"),
  analyticsDashboard: document.getElementById("analyticsDashboard"),
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
  codexRuntimeInput: document.getElementById("codexRuntimeInput"),
  codexBinaryPathInput: document.getElementById("codexBinaryPathInput"),
  codexModelInput: document.getElementById("codexModelInput"),
  codexReasoningEffortInput: document.getElementById("codexReasoningEffortInput"),
  codexTargetInput: document.getElementById("codexTargetInput"),
  projectChatgptThreadSelect: document.getElementById("projectChatgptThreadSelect"),
  projectCodexThreadSelect: document.getElementById("projectCodexThreadSelect"),
  chatgptUrlInput: document.getElementById("chatgptUrlInput"),
  reduceChromeInput: document.getElementById("reduceChromeInput"),
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
  row.querySelector(".thread-notes").textContent =
    attached
      ? `Attached as ${attached.title}`
      : thread.projectName
        ? thread.updatedAt
          ? `Project ${thread.projectName} · Updated ${formatTime(thread.updatedAt)}`
          : `Project ${thread.projectName}`
        : thread.sourceKind === "project"
          ? thread.updatedAt
            ? `Project folder · Updated ${formatTime(thread.updatedAt)}`
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
  if (status.status === "failed") return `backend failed${status.lastError ? ` · ${status.lastError}` : ""}`;
  if (status.status === "closed") return `backend closed${status.lastError ? ` · ${status.lastError}` : ""}`;
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

function formatBytes(bytes) {
  const number = Number(bytes) || 0;
  if (number < 1024) return `${number} B`;
  if (number < 1024 * 1024) return `${(number / 1024).toFixed(1)} KB`;
  return `${(number / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return String(value);
  }
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
  els.directAuthEvidence.textContent = state.directAuthError
    ? "Direct auth status unavailable. No raw tokens or paths exposed to renderer."
    : `Renderer sees redacted status only · tokens exposed: ${status?.rawTokensExposed ? "yes" : "no"} · paths exposed: ${settings.storagePathExposed ? "yes" : "no"}`;
}

function renderMiddleTabs() {
  const tabs = [
    [els.overviewTabButton, els.overviewTabPanel, "overview"],
    [els.threadsTabButton, els.threadsTabPanel, "threads"],
    [els.analyticsTabButton, els.analyticsTabPanel, "analytics"],
  ];
  for (const [button, panel, tab] of tabs) {
    const active = state.activeMiddleTab === tab;
    button.classList.toggle("active", active);
    panel.classList.toggle("active", active);
    panel.hidden = !active;
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
    row.querySelector(".thread-notes").textContent = thread.updatedAt ? `Updated ${formatTime(thread.updatedAt)}` : "No timestamp";
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
  renderThreadsWorkbench();
  renderAnalyticsPanel();
  renderHandoffTargetSelect();
  renderPromptPreview();
  renderHandoffQueue();
  renderCodexRequests();
  renderWatchedArtifacts();
  renderDirectAuthControls();
  renderStatus();
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
  const chatgpt = rectToBounds(els.chatgptSlot.getBoundingClientRect());
  const signature = `${codex.x},${codex.y},${codex.width},${codex.height}|${chatgpt.x},${chatgpt.y},${chatgpt.width},${chatgpt.height}`;
  if (signature === state.lastLayoutSignature) return;
  state.lastLayoutSignature = signature;
  bridge.setSurfaceLayout({ codex, chatgpt }).catch((error) => {
    console.error("Unable to set surface layout", error);
  });
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
    setLastEvent(`Direct auth ${directAuthStatusLabel(state.directAuthStatus)}.`);
  } catch (error) {
    state.directAuthError = sanitizedDirectAuthError("Direct auth status failed.");
    setLastEvent(`Direct auth status failed: ${state.directAuthError}`);
  } finally {
    state.directAuthLoading = false;
    renderDirectAuthControls();
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
  try {
    const result = await bridge.beginDirectAuthLogin();
    state.directAuthStatus = result.authStatus || state.directAuthStatus;
    setLastEvent(result.ok ? "Direct auth login started." : `Direct auth login unavailable: ${result.reason || result.status}.`);
  } catch (error) {
    state.directAuthError = sanitizedDirectAuthError("Direct auth login failed.");
    setLastEvent(`Direct auth login failed: ${state.directAuthError}`);
  } finally {
    state.directAuthLoading = false;
    renderDirectAuthControls();
  }
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
  state.activeChatgptThreadBrowserTab = "project";
  render();
  const project = activeProject();
  if (!project || project.id !== projectId || isRequestStale("project", projectVersion)) return;
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
  } else {
    setLastEvent(`Requested Codex thread open: ${thread?.title || threadId}.`);
  }
  renderSelectedProject();
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
        runtime: state.defaultCodexRuntime || "auto",
        binaryPath: "codex",
        target: "",
        model: "",
        reasoningEffort: "",
        label: "Managed Codex lane",
      },
      chatgpt: { reviewThreadUrl: "https://chatgpt.com/", reduceChrome: true },
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
  els.codexRuntimeInput.value = draft.surfaceBinding.codex.runtime || "auto";
  els.codexBinaryPathInput.value = draft.surfaceBinding.codex.binaryPath || "codex";
  els.codexModelInput.value = draft.surfaceBinding.codex.model || "";
  els.codexReasoningEffortInput.value = draft.surfaceBinding.codex.reasoningEffort || "";
  els.codexTargetInput.value = draft.surfaceBinding.codex.target;
  els.chatgptUrlInput.value = primary?.url || draft.surfaceBinding.chatgpt.reviewThreadUrl || "https://chatgpt.com/";
  populateProjectThreadSelectors(draft);
  syncProjectChatgptUrlFromSelection();
  els.reduceChromeInput.checked = draft.surfaceBinding.chatgpt.reduceChrome !== false;
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

  return {
    id: els.projectIdInput.value || createId("project"),
    name: els.projectNameInput.value.trim() || "Untitled project",
    repoPath,
    workspace,
    surfaceBinding: {
      codex: {
        mode: els.codexModeInput.value,
        runtime: els.codexRuntimeInput.value,
        binaryPath: els.codexBinaryPathInput.value.trim() || "codex",
        target: els.codexTargetInput.value.trim(),
        model: els.codexModelInput.value.trim(),
        reasoningEffort: els.codexReasoningEffortInput.value,
        label:
          els.codexLabelInput.value.trim() ||
          (els.codexModeInput.value === "managed" ? "Managed Codex lane" : els.codexModeInput.value === "fallback" ? "Fallback Codex lane" : "Codex target"),
      },
      chatgpt: {
        reviewThreadUrl: primaryUrl,
        reduceChrome: els.reduceChromeInput.checked,
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
  const projects = [...state.config.projects];
  if (existingIndex >= 0) projects[existingIndex] = project;
  else projects.push(project);
  await saveConfig({ ...state.config, selectedProjectId: project.id, projects });
  closeDrawer();
  await selectProject(project.id);
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
  if (tab === "threads") state.activeMiddleTab = "threads";
  else if (tab === "analytics") state.activeMiddleTab = "analytics";
  else state.activeMiddleTab = "overview";
  renderMiddleTabs();
  if (state.activeMiddleTab === "analytics" && state.analyticsStatus === "idle") {
    loadAnalyticsThreads({ refresh: false }).catch((error) => {
      setLastEvent(`Analytics list load failed: ${error.message}`);
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
  els.overviewTabButton.addEventListener("click", () => setMiddleTab("overview"));
  els.threadsTabButton.addEventListener("click", () => setMiddleTab("threads"));
  els.analyticsTabButton.addEventListener("click", () => setMiddleTab("analytics"));
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
  els.workspaceKindInput.addEventListener("change", updateWorkspaceFieldVisibility);
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
  els.refreshCodexThreadsButton.addEventListener("click", loadCodexThreads);
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
  els.reloadCodexButton.addEventListener("click", () => bridge.reloadSurface("codex"));
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
  els.refreshWorkTreeButton.addEventListener("click", loadWorkTreeRoot);
  els.refreshWatchedButton.addEventListener("click", loadWatchedArtifacts);

  els.leftSplitter.addEventListener("pointerdown", (event) => beginDrag("left", event));
  els.rightSplitter.addEventListener("pointerdown", (event) => beginDrag("right", event));

  window.addEventListener("resize", scheduleResizeBurst);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", scheduleResizeBurst);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) scheduleResizeBurst();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && els.threadDrawer.classList.contains("open")) closeThreadDrawer();
    else if (event.key === "Escape" && els.drawer.classList.contains("open")) closeDrawer();
  });

  const resizeObserver = new ResizeObserver(scheduleResizeBurst);
  resizeObserver.observe(els.appShell);
  resizeObserver.observe(els.codexSlot);
  resizeObserver.observe(els.chatgptSlot);

  bridge.onSurfaceEvent((event) => {
    if (event.surface === "codex" || event.surface === "chatgpt") {
      state.surfaceEvents[event.surface] = event;
      renderStatus();
      if (event.type === "loaded") setLastEvent(`${event.surface} loaded: ${event.title || event.url || "ready"}`);
      if (event.type === "load-failed") setLastEvent(`${event.surface} load failed: ${event.errorDescription}`);
      if (event.type === "navigation-blocked") setLastEvent(`${event.surface} blocked navigation: ${event.url}`);
      if (event.type === "settings-opened") setLastEvent(`ChatGPT settings requested via ${event.method}.`);
      if (event.type === "settings-open-failed") setLastEvent(`ChatGPT settings request failed via ${event.method}.`);
      if (event.surface === "codex" && event.type === "thread-state") handleCodexThreadState(event);
    }
  });

  bridge.onShellEvent((event) => {
    if (event.type === "layout-request") scheduleResizeBurst();
    if (event.type === "backend-status" && event.session?.projectId) {
      state.workspaceStatuses[event.session.projectId] = event.session;
      renderSelectedProject();
      if (event.error) setLastEvent(`Workspace backend error: ${event.error}`);
      else if (event.session.status === "attached") setLastEvent(`Workspace backend attached: ${event.session.transport}`);
      else if (event.session.status === "failed") setLastEvent(`Workspace backend failed: ${event.session.lastError || "unknown"}`);
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
  bindEvents();
  const result = await bridge.loadConfig();
  state.config = result.config;
  state.configPath = result.configPath;
  state.repoRoot = result.repoRoot;
  state.platform = result.platform || "";
  state.defaultWorkspace = result.defaultWorkspace || null;
  state.defaultCodexRuntime = result.defaultCodexRuntime || "auto";
  state.allowNonChatgptUrls = Boolean(result.allowNonChatgptUrls);
  render();
  await loadDirectAuthSettings();
  await selectProject(state.config.selectedProjectId);
  await loadChatgptRecentThreads({ refresh: false });
}

init().catch((error) => {
  console.error(error);
  setLastEvent(`Startup error: ${error.message}`);
});
