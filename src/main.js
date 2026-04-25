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
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { CodexAppServerManager } = require("./main/codex-app-server");
const { LocalSurfaceServer } = require("./main/local-surface-server");
const { CodexSurfaceSession } = require("./main/codex-surface-session");
const { WorkspaceBackendManager, workspaceLabel, workspaceRoot } = require("./main/workspace-backend");
const { ThreadAnalyticsStore, buildThreadKey } = require("./main/thread-analytics-store");

const APP_TITLE = "Codex Review Shell";
const CONFIG_FILE_NAME = "workspace-config.json";
const CHATGPT_THREAD_CACHE_FILE_NAME = "chatgpt-thread-cache.json";
const CHATGPT_THREAD_CACHE_VERSION = 1;
const CHATGPT_THREAD_CACHE_MAX_ENTRIES = 1500;
const THREAD_ANALYTICS_DB_FILE_NAME = "thread-analytics.sqlite";
const THREAD_ANALYTICS_ANALYZER_VERSION = "analytics-v0.1";
const ANALYTICS_DISCOVERY_THREAD_LIMIT = 260;
const ANALYTICS_DISCOVERY_SCAN_LIMIT = 420;
const ANALYTICS_DISCOVERY_TIMEOUT_MS = 70_000;
const CODEX_PARTITION = "persist:codex-review-shell-codex";
const CHATGPT_PARTITION = "persist:codex-review-shell-chatgpt";
const PREVIEW_LIMIT_BYTES = 384 * 1024;
const DIRECTORY_ENTRY_LIMIT = 500;

const appRoot = path.resolve(__dirname, "..");
const repoRoot = appRoot;
const legacyStandaloneRepoRoot = path.resolve(appRoot, "..", "..");
const rendererRoot = path.join(__dirname, "renderer");
const shellHtmlPath = path.join(rendererRoot, "index.html");
const codexSurfacePreloadPath = path.join(__dirname, "preload-codex-surface.js");
const smokeExitMs = Number.parseInt(process.env.CODEX_REVIEW_SHELL_SMOKE_EXIT_MS ?? "", 10);
const workspaceAgentPath = path.join(__dirname, "backend", "wsl-agent.js");

let mainWindow = null;
let shellView = null;
let codexView = null;
let chatgptView = null;
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
let surfaceActivationEpoch = 0;

function nowIso() {
  return new Date().toISOString();
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

function threadAnalyticsDbPath() {
  return path.join(app.getPath("userData"), THREAD_ANALYTICS_DB_FILE_NAME);
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
    version: 4,
    selectedProjectId: defaultProjectId,
    ui: {
      leftRatio: 0.34,
      middleRatio: 0.3,
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
            runtime: defaultCodexRuntimeForWorkspace(defaultWorkspace),
            target: "",
            binaryPath: "codex",
            model: "",
            reasoningEffort: "",
            label: "Managed Codex lane",
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

function normalizeReasoningEffort(value) {
  const candidate = normalizeString(value, "").toLowerCase();
  return ["low", "medium", "high", "xhigh"].includes(candidate) ? candidate : "";
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
    updatedAt: incomingUpdated > currentUpdated ? incomingUpdated : currentUpdated,
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
        runtime: normalizeCodexRuntime(normalizeString(rawCodex.runtime, defaultCodexRuntimeForWorkspace(workspace))),
        target: normalizeString(rawCodex.target, codexMode === "url" ? "http://127.0.0.1:3000" : ""),
        binaryPath: normalizeString(rawCodex.binaryPath, "codex"),
        model: normalizeString(rawCodex.model, ""),
        reasoningEffort: normalizeReasoningEffort(rawCodex.reasoningEffort),
        label: normalizeString(rawCodex.label, codexMode === "managed" ? "Managed Codex lane" : "Codex target"),
        remoteAuth: normalizeRemoteAuthConfig(rawCodex.remoteAuth),
      },
      chatgpt: {
        reviewThreadUrl: safeChatgptUrl(primaryReview?.url || rawChatgpt.reviewThreadUrl, "https://chatgpt.com/"),
        reduceChrome: rawChatgpt.reduceChrome !== false,
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
    version: 4,
    selectedProjectId,
    ui: migrateUi(raw.ui),
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
    return;
  }
  codexView.setBounds(sanitizeBounds(lastSurfaceBounds.codex));
  chatgptView.setBounds(sanitizeBounds(lastSurfaceBounds.chatgpt));
}

function emitToShell(channel, payload) {
  if (!shellView || shellView.webContents.isDestroyed()) return;
  shellView.webContents.send(channel, payload);
}

function emitShellEvent(payload) {
  emitToShell("shell:event", payload);
}

function nextSurfaceActivationEpoch() {
  surfaceActivationEpoch += 1;
  return surfaceActivationEpoch;
}

function isStaleSurfaceActivationEpoch(epoch) {
  return Number.isFinite(Number(epoch)) && Number(epoch) > 0 && Number(epoch) !== surfaceActivationEpoch;
}

function ensureWorkspaceBackendManager() {
  if (workspaceBackends) return workspaceBackends;
  workspaceBackends = new WorkspaceBackendManager({
    agentPath: workspaceAgentPath,
    fallbackRoot: repoRoot,
  });
  workspaceBackends.on("status", (payload) => {
    emitShellEvent({ type: "backend-status", ...payload });
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

function isCodexSurfaceSender(sender) {
  return Boolean(codexView?.webContents && !codexView.webContents.isDestroyed() && sender.id === codexView.webContents.id);
}

function codexSurfaceSessionFor(sender) {
  if (!isCodexSurfaceSender(sender)) throw new Error("Codex surface bridge is not available from this renderer.");
  const sessions = ensureCodexSurfaceSessions();
  if (sessions.has(sender.id)) return sessions.get(sender.id);
  const session = new CodexSurfaceSession(sender);
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
  sender.once("destroyed", () => {
    session.dispose({ silent: true, reason: "Codex surface renderer destroyed." }).catch(() => {});
    sessions.delete(sender.id);
  });
  return session;
}

function findCodexSurfaceSessionForRequest(requestKey) {
  const key = String(requestKey || "");
  if (!key || !codexSurfaceSessions) return null;
  for (const session of codexSurfaceSessions.values()) {
    if (session?.hasServerRequest?.(key)) return session;
  }
  return null;
}

async function disposeCodexSurfaceSession() {
  if (!codexSurfaceSessions || !codexView?.webContents) return;
  const session = codexSurfaceSessions.get(codexView.webContents.id);
  if (!session) return;
  codexSurfaceSessions.delete(codexView.webContents.id);
  await session.dispose({ silent: true, reason: "Codex surface reloaded." });
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
    codexConnection: extra.codexConnection || null,
    activationEpoch: Number(extra.activationEpoch) || 0,
    initialThreadId: normalizeString(extra.initialThreadId, ""),
    initialThreadSourceHome: normalizeString(extra.initialThreadSourceHome, ""),
    initialThreadSessionFilePath: normalizeString(extra.initialThreadSessionFilePath, ""),
    initialThreadTitle: normalizeString(extra.initialThreadTitle, ""),
    error: normalizeString(extra.error, ""),
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function codexSurfaceUrl(baseUrl, project, extra = {}) {
  const token = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return `${baseUrl}/codex-surface.html?reload=${token}#${encodeCodexSurfacePayload(project, extra)}`;
}

async function loadCodexSurface(project, options = {}) {
  if (!codexView || codexView.webContents.isDestroyed()) return;
  if (isStaleSurfaceActivationEpoch(options.activationEpoch)) return { skipped: true, stale: true };
  await disposeCodexSurfaceSession();
  const codex = project.surfaceBinding.codex;
  const localSurfaceBaseUrl = await ensureLocalSurfaceServer().ensureStarted();
  if (isStaleSurfaceActivationEpoch(options.activationEpoch)) return { skipped: true, stale: true };
  if (codex.mode === "url") {
    await ensureCodexAppServerManager().dispose();
    activeCodexSurfaceConnection = null;
    const target = safeLoadableUrl(codex.target, "codex");
    if (target) {
      if (isStaleSurfaceActivationEpoch(options.activationEpoch)) return { skipped: true, stale: true };
      await codexView.webContents.loadURL(target);
      return;
    }
  }
  if (codex.mode === "managed") {
    try {
      const requestedCodexHome = normalizeString(options.codexHome, "");
      const session =
        options.codexSession ||
        await ensureCodexAppServerManager().ensureForProject(
          project,
          requestedCodexHome ? { codexHome: requestedCodexHome } : {},
        );
      if (isStaleSurfaceActivationEpoch(options.activationEpoch)) return { skipped: true, stale: true };
      const localUrl = codexSurfaceUrl(localSurfaceBaseUrl, project, {
        codexConnection: {
          projectId: project.id,
          wsUrl: session.wsUrl,
          readyUrl: session.readyUrl,
          runtime: session.runtime,
          workspaceRoot: session.workspaceRoot,
          binaryPath: session.binaryPath,
          codexHome: session.codexHome || "",
          capabilities: session.capabilities || null,
          activationEpoch: Number(options.activationEpoch) || 0,
        },
        activationEpoch: Number(options.activationEpoch) || 0,
        initialThreadId: normalizeString(options.initialThreadId, ""),
        initialThreadSourceHome: normalizeString(options.initialThreadSourceHome, ""),
        initialThreadSessionFilePath: normalizeString(options.initialThreadSessionFilePath, ""),
        initialThreadTitle: normalizeString(options.initialThreadTitle, ""),
      });
      activeCodexSurfaceConnection = {
        projectId: project.id,
        wsUrl: session.wsUrl,
        runtime: session.runtime,
        codexHome: session.codexHome || "",
        capabilities: session.capabilities || null,
        activationEpoch: Number(options.activationEpoch) || 0,
        remoteAuth: project.surfaceBinding?.codex?.remoteAuth || { mode: "none" },
      };
      if (isStaleSurfaceActivationEpoch(options.activationEpoch)) return { skipped: true, stale: true };
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
        activationEpoch: Number(options.activationEpoch) || 0,
        initialThreadId: normalizeString(options.initialThreadId, ""),
        initialThreadSourceHome: normalizeString(options.initialThreadSourceHome, ""),
        initialThreadSessionFilePath: normalizeString(options.initialThreadSessionFilePath, ""),
        initialThreadTitle: normalizeString(options.initialThreadTitle, ""),
        error: error.message,
      });
      if (isStaleSurfaceActivationEpoch(options.activationEpoch)) return { skipped: true, stale: true };
      await codexView.webContents.loadURL(degradedUrl);
      return;
    }
  }
  await ensureCodexAppServerManager().dispose();
  activeCodexSurfaceConnection = null;
  const localUrl = codexSurfaceUrl(localSurfaceBaseUrl, project, { activationEpoch: Number(options.activationEpoch) || 0 });
  if (isStaleSurfaceActivationEpoch(options.activationEpoch)) return { skipped: true, stale: true };
  await codexView.webContents.loadURL(localUrl);
}

async function loadChatgptSurface(project, threadId = "", options = {}) {
  if (!chatgptView || chatgptView.webContents.isDestroyed()) return;
  if (isStaleSurfaceActivationEpoch(options.activationEpoch)) return { skipped: true, stale: true };
  const thread = threadId
    ? project.chatThreads?.find((item) => item.id === threadId) || activeChatThread(project)
    : activeChatThread(project);
  const target = safeLoadableUrl(thread?.url || project.surfaceBinding.chatgpt.reviewThreadUrl, "chatgpt") || "https://chatgpt.com/";
  if (isStaleSurfaceActivationEpoch(options.activationEpoch)) return { skipped: true, stale: true };
  await chatgptView.webContents.loadURL(target);
}

async function requestCodexThreadOpen(projectId, threadId, sourceHome = "", sessionFilePath = "") {
  const nextThreadId = normalizeString(threadId, "");
  if (!nextThreadId) return { ok: false, error: "Codex thread id is required." };
  let project = null;
  try {
    project = await getProjectById(projectId);
  } catch (error) {
    return { ok: false, error: error.message || "Unable to resolve selected project." };
  }
  if (!project) return { ok: false, error: "No project is selected." };

  let session = null;
  let sessionStartupError = "";
  const requestedHome = normalizeString(sourceHome, "");
  const requestedSessionFilePath = normalizeString(sessionFilePath, "");
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
  const hasLocalSurface = currentUrl.includes("codex-surface.html");
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
    at: nowIso(),
  };

  if (needsSurfaceReload) {
    if (project.surfaceBinding?.codex?.mode !== "managed") {
      return { ok: false, error: "Codex surface is not in managed mode." };
    }
    const activationEpoch = nextSurfaceActivationEpoch();
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
    };
  }
  codexView.webContents.send("codex-surface:event", openEventPayload);
  return {
    ok: true,
    dispatched: true,
    threadId: nextThreadId,
    sourceHome: requestedHome || session?.codexHome || "",
    warning: sessionStartupError,
  };
}

async function openChatgptThreadUrl(url) {
  const target = safeLoadableUrl(url, "chatgpt");
  if (!target) return { ok: false, error: "Invalid ChatGPT thread URL." };
  if (!chatgptView || chatgptView.webContents.isDestroyed()) {
    return { ok: false, error: "ChatGPT surface is unavailable." };
  }
  await chatgptView.webContents.loadURL(target);
  return { ok: true, url: target };
}

function chatgptRecentThreadsScript(limit = 40) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 40, 200));
  return `
    (async () => {
      const limit = ${safeLimit};
      const origin = location.origin || "https://chatgpt.com";
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const normalizeText = (value) => String(value || "").replace(/\\s+/g, " ").trim();
      const visible = (element) => {
        if (!element) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 3 && rect.height > 3;
      };
      const click = (element) => {
        if (!element) return false;
        element.scrollIntoView?.({ block: "center", inline: "center" });
        element.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, view: window }));
        element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
        element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
        element.click();
        return true;
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
          updatedAt: String(item.update_time || ""),
          createdAt: String(item.create_time || ""),
          archived: Boolean(item.is_archived),
          snippet: typeof item.snippet === "string" ? item.snippet : "",
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
        const merged = {
          ...current,
          ...incoming,
          title:
            incoming.title && incoming.title !== "Untitled ChatGPT thread"
              ? incoming.title
              : current.title || incoming.title || "Untitled ChatGPT thread",
          url: incoming.url || current.url,
          updatedAt: incomingUpdated > currentUpdated ? incomingUpdated : currentUpdated,
          createdAt: current.createdAt || incoming.createdAt || "",
          archived: Boolean(current.archived && incoming.archived),
          snippet: current.snippet || incoming.snippet || "",
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
        const entries = Array.from(byId.values()).sort((a, b) =>
          String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))
        );
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

      const parseLinkEntry = (link, fallbackKind, source, forcedProjectName = "") => {
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
            updatedAt: "",
            createdAt: "",
            archived: false,
            snippet: "",
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
                const parsed = parseLinkEntry(link, "project", "project-iframe", project.projectName || "");
                if (parsed) scopedEntries.push(parsed);
              }
              for (const entry of scopedEntries.slice(0, 5)) items.push(entry);
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
        return !(knownById || knownByName);
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
  const codexOptions = { ...codexSurfaceOptionsForBinding(activationBinding), activationEpoch };
  await Promise.allSettled([
    loadCodexSurface(project, codexOptions),
    loadChatgptSurface(project, normalizeString(activationBinding?.chatThreadId, ""), { activationEpoch }),
  ]);
  if (isStaleSurfaceActivationEpoch(activationEpoch)) return;
  scheduleLayoutPing("project-selected");
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
  contents.setWindowOpenHandler(({ url }) => {
    if (surfaceName === "chatgpt" && isLikelyChatAuthOrAppUrl(url)) {
      setImmediate(() => {
        if (!contents.isDestroyed()) contents.loadURL(url).catch(() => {});
      });
      return { action: "deny" };
    }
    if (url.startsWith("http://") || url.startsWith("https://")) shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
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

async function readCodexThreadTranscript(projectId, threadId, sourceHome = "", sessionFilePath = "") {
  const project = await getProjectById(projectId);
  const result = await requestWorkspace(project, "readCodexThreadTranscript", {
    threadId,
    sourceHome: normalizeString(sourceHome, ""),
    sessionFilePath: normalizeString(sessionFilePath, ""),
    limit: 800,
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
    dbPath: threadAnalyticsDbPath(),
  };
}

async function getThreadAnalyticsDashboard(projectId, threadKey) {
  const project = await getProjectById(projectId);
  const store = ensureThreadAnalyticsStore();
  const key = normalizeString(threadKey, "");
  if (!key) throw new Error("threadKey is required.");
  const dashboard = store.getProjectThreadDashboard(project.id, key);
  return {
    projectId: project.id,
    threadKey: key,
    dashboard,
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

async function runWorkspaceCommand(projectId, commandPayload) {
  const project = await getProjectById(projectId);
  return requestWorkspace(project, "runCommand", commandPayload, 60_000);
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
        element.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, view: window }));
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

async function createWindow() {
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

  mainWindow.contentView.addChildView(shellView);
  mainWindow.contentView.addChildView(codexView);
  mainWindow.contentView.addChildView(chatgptView);
  syncWindowGeometry("initial-attach");
  startGeometrySyncLoop();

  configureGuestSurface("codex", codexView);
  configureGuestSurface("chatgpt", chatgptView);

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
  return {
    config,
    configPath: configPath(),
    repoRoot,
    appVersion: app.getVersion(),
    platform: process.platform,
    defaultWorkspace,
    defaultCodexRuntime: defaultCodexRuntimeForWorkspace(defaultWorkspace),
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
  await loadProjectSurfaces(project, binding);
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
  if (surfaceName === "codex" && currentProject) {
    await loadCodexSurface(currentProject);
    return true;
  }
  const view = surfaceName === "chatgpt" ? chatgptView : codexView;
  if (!view || view.webContents.isDestroyed()) return false;
  view.webContents.reload();
  return true;
});

ipcMain.handle("codex-surface:connect", async (event, payload) => {
  const session = codexSurfaceSessionFor(event.sender);
  const requestedConnection = payload?.connection || null;
  const connection =
    activeCodexSurfaceConnection &&
    requestedConnection &&
    String(activeCodexSurfaceConnection.wsUrl || "") === String(requestedConnection.wsUrl || "")
      ? { ...requestedConnection, remoteAuth: activeCodexSurfaceConnection.remoteAuth || { mode: "none" } }
      : requestedConnection;
  return session.connect(connection);
});

ipcMain.handle("codex-surface:disconnect", async (event) => {
  const session = codexSurfaceSessionFor(event.sender);
  await session.dispose({ reason: "Renderer requested disconnect." });
  return true;
});

ipcMain.handle("codex-surface:request", async (event, payload) => {
  const session = codexSurfaceSessionFor(event.sender);
  return session.request(payload?.method, payload?.params || {});
});

ipcMain.handle("codex-surface:notify", async (event, payload) => {
  const session = codexSurfaceSessionFor(event.sender);
  return session.notify(payload?.method, payload?.params || {});
});

ipcMain.handle("codex-surface:respond", async (event, payload) => {
  const session = codexSurfaceSessionFor(event.sender);
  return session.respond(payload?.key || payload?.id, payload?.result || {});
});

ipcMain.handle("codex-surface:thread-state", async (event, payload) => {
  const session = codexSurfaceSessionFor(event.sender);
  if (isStaleSurfaceActivationEpoch(payload?.activationEpoch)) return { ok: false, stale: true };
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
  emitToShell("surface:event", state);
  return { ok: true };
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

ipcMain.handle("surface:open-external", async (_event, surfaceName) => {
  const view = surfaceName === "chatgpt" ? chatgptView : codexView;
  if (!view || view.webContents.isDestroyed()) return false;
  const url = view.webContents.getURL();
  if (!url || url.startsWith("file://")) return false;
  await shell.openExternal(url);
  return true;
});

ipcMain.handle("external:open-url", async (_event, payload) => {
  const rawUrl = normalizeString(payload?.url, "");
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, error: "Only http and https URLs can be opened externally." };
    }
    await shell.openExternal(parsed.toString());
    return { ok: true, url: parsed.toString() };
  } catch (error) {
    return { ok: false, error: error.message || "Invalid URL." };
  }
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


ipcMain.handle("worktree:list-watched", async (_event, payload) => {
  return listWatchedArtifacts(payload?.projectId);
});

ipcMain.handle("codex-threads:list", async (_event, payload) => {
  return listCodexThreads(payload?.projectId);
});

ipcMain.handle("codex-thread:transcript", async (_event, payload) => {
  return readCodexThreadTranscript(
    payload?.projectId,
    payload?.threadId,
    payload?.sourceHome,
    payload?.sessionFilePath,
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

ipcMain.handle("worktree:reveal-file", async (_event, payload) => {
  return revealProjectFile(payload?.projectId, payload?.relPath);
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
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
