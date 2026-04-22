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

const APP_TITLE = "Codex Review Shell";
const CONFIG_FILE_NAME = "workspace-config.json";
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
let currentProject = null;
let layoutPingTimer = null;
let geometrySyncTimer = null;
let workspaceBackends = null;
let codexAppServer = null;
let localSurfaceServer = null;
let codexSurfaceSessions = null;

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function configPath() {
  return path.join(app.getPath("userData"), CONFIG_FILE_NAME);
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

function normalizeReasoningEffort(value) {
  const candidate = normalizeString(value, "").toLowerCase();
  return ["low", "medium", "high", "xhigh"].includes(candidate) ? candidate : "";
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

function safeChatgptUrl(value, fallback = "https://chatgpt.com/") {
  try {
    const parsed = new URL(normalizeString(value, fallback));
    if (parsed.protocol !== "https:") return fallback;
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
      const targetThreadId = threadIds.has(raw.targetThreadId) ? raw.targetThreadId : "";
      return {
        id: normalizeString(raw.id, newId("handoff")),
        projectId,
        source: ["codex", "workspace", "human"].includes(raw.source) ? raw.source : "human",
        targetThreadId,
        kind: HANDOFF_KINDS.has(raw.kind) ? raw.kind : "text-review",
        fileRelPath: normalizeString(raw.fileRelPath, ""),
        title: normalizeString(raw.title, "Untitled handoff"),
        promptText: normalizeString(raw.promptText, ""),
        status: HANDOFF_STATUSES.has(raw.status) ? raw.status : "staged",
        createdAt: normalizeString(raw.createdAt, now),
        updatedAt: normalizeString(raw.updatedAt, now),
      };
    })
    .filter((item) => item.targetThreadId && item.promptText);
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
  try {
    const raw = await fs.readFile(configPath(), "utf8");
    configCache = normalizeConfig(JSON.parse(raw));
    return configCache;
  } catch {
    configCache = normalizeConfig(defaultConfig());
    await saveConfig(configCache);
    return configCache;
  }
}

async function saveConfig(nextConfig) {
  const normalized = normalizeConfig(nextConfig);
  configCache = normalized;
  await fs.mkdir(path.dirname(configPath()), { recursive: true });
  await fs.writeFile(configPath(), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
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
    if (payload?.type === "rpc-request") {
      const reason = payload.params?.reason || payload.params?.command || "";
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

function encodeCodexSurfacePayload(project, extra = {}) {
  const payload = {
    project: {
      id: project.id,
      name: project.name,
      repoPath: project.repoPath,
      workspace: project.workspace,
      codex: project.surfaceBinding.codex,
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
    error: normalizeString(extra.error, ""),
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

async function loadCodexSurface(project) {
  if (!codexView || codexView.webContents.isDestroyed()) return;
  await disposeCodexSurfaceSession();
  const codex = project.surfaceBinding.codex;
  const localSurfaceBaseUrl = await ensureLocalSurfaceServer().ensureStarted();
  if (codex.mode === "url") {
    await ensureCodexAppServerManager().dispose();
    const target = safeLoadableUrl(codex.target, "codex");
    if (target) {
      await codexView.webContents.loadURL(target);
      return;
    }
  }
  if (codex.mode === "managed") {
    try {
      const session = await ensureCodexAppServerManager().ensureForProject(project);
      const localUrl = `${localSurfaceBaseUrl}/codex-surface.html#${encodeCodexSurfacePayload(project, {
        codexConnection: {
          wsUrl: session.wsUrl,
          readyUrl: session.readyUrl,
          runtime: session.runtime,
          workspaceRoot: session.workspaceRoot,
          binaryPath: session.binaryPath,
        },
      })}`;
      await codexView.webContents.loadURL(localUrl);
      return;
    } catch (error) {
      emitToShell("surface:event", {
        surface: "codex",
        type: "load-failed",
        title: error.message,
        at: nowIso(),
      });
      const degradedUrl = `${localSurfaceBaseUrl}/codex-surface.html#${encodeCodexSurfacePayload(project, {
        error: error.message,
      })}`;
      await codexView.webContents.loadURL(degradedUrl);
      return;
    }
  }
  await ensureCodexAppServerManager().dispose();
  const localUrl = `${localSurfaceBaseUrl}/codex-surface.html#${encodeCodexSurfacePayload(project)}`;
  await codexView.webContents.loadURL(localUrl);
}

async function loadChatgptSurface(project, threadId = "") {
  if (!chatgptView || chatgptView.webContents.isDestroyed()) return;
  const thread = threadId
    ? project.chatThreads?.find((item) => item.id === threadId) || activeChatThread(project)
    : activeChatThread(project);
  const target = safeLoadableUrl(thread?.url || project.surfaceBinding.chatgpt.reviewThreadUrl, "chatgpt") || "https://chatgpt.com/";
  await chatgptView.webContents.loadURL(target);
}

function chatgptRecentThreadsScript(limit = 40) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 40, 200));
  return `
    (async () => {
      const limit = ${safeLimit};
      const origin = location.origin || "https://chatgpt.com";

      const normalizeEntry = (item) => {
        if (!item || !item.id) return null;
        const externalId = String(item.id || "");
        return {
          externalId,
          title: String(item.title || "Untitled ChatGPT thread"),
          url: externalId ? origin.replace(/\\/$/, "") + "/c/" + encodeURIComponent(externalId) : "",
          updatedAt: String(item.update_time || ""),
          createdAt: String(item.create_time || ""),
          archived: Boolean(item.is_archived),
          snippet: typeof item.snippet === "string" ? item.snippet : "",
        };
      };

      const dedupe = (items) => {
        const byId = new Map();
        for (const item of items) {
          if (!item || !item.externalId) continue;
          const current = byId.get(item.externalId);
          if (!current || String(item.updatedAt || "") > String(current.updatedAt || "")) {
            byId.set(item.externalId, item);
          }
        }
        return Array.from(byId.values())
          .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
          .slice(0, limit);
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
                const normalized = normalizeEntry(item);
                if (normalized) items.push(normalized);
              }
            }
          } catch {}
        }
        return dedupe(items);
      };

      const fromDom = () => {
        const items = [];
        for (const link of Array.from(document.querySelectorAll('a[href*="/c/"]'))) {
          try {
            const url = new URL(link.href, origin);
            const match = url.pathname.match(/\\/c\\/([^/?#]+)/);
            if (!match) continue;
            items.push({
              externalId: match[1],
              title: (link.textContent || "").trim() || "Untitled ChatGPT thread",
              url: url.toString(),
              updatedAt: "",
              createdAt: "",
              archived: false,
              snippet: "",
            });
          } catch {}
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
          return dedupe(rows.map(normalizeEntry));
        } catch {
          return [];
        }
      };

      const cached = fromCache();
      if (cached.length) return { source: "localStorage-cache", available: true, entries: cached };

      const fetched = await fromBackendApi();
      if (fetched.length) return { source: "backend-api", available: true, entries: fetched };

      const dom = fromDom();
      return {
        source: dom.length ? "dom-fallback" : "unavailable",
        available: dom.length > 0,
        entries: dom,
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

async function loadProjectSurfaces(project) {
  currentProject = project;
  emitToShell("surface:event", {
    surface: "shell",
    type: "project-selected",
    projectId: project.id,
    projectName: project.name,
    at: nowIso(),
  });
  await Promise.allSettled([loadCodexSurface(project), loadChatgptSurface(project)]);
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
  const result = await requestWorkspace(project, "listCodexThreads", {
    limit: 120,
    originators: ["codex_vscode", "Codex Desktop"],
  }, 30_000);
  return {
    ...result,
    workspace: project.workspace,
    workspaceLabel: workspaceLabel(project, repoRoot),
  };
}

async function revealProjectFile(projectId, relPath) {
  const project = await getProjectById(projectId);
  const result = await requestWorkspace(project, "resolvePath", { relPath }, 10_000);
  if (project.workspace?.kind === "local" && result.absolutePath) {
    shell.showItemInFolder(result.absolutePath);
    return { ...result, opened: true, method: "local-show-item" };
  }
  if (project.workspace?.kind === "wsl" && process.platform === "win32") {
    const distro = project.workspace.distro || "Ubuntu";
    const linuxPath = `${project.workspace.linuxPath.replace(/\/$/, "")}/${String(relPath || "").replace(/^\/+/, "")}`;
    const unc = `\\\\wsl$\\${distro}${linuxPath.split("/").join("\\")}`;
    shell.showItemInFolder(unc);
    return { ...result, opened: true, method: "wsl-unc-fallback", uncPath: unc };
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

async function listChatgptRecentThreads(limit = 40) {
  if (!chatgptView || chatgptView.webContents.isDestroyed()) {
    return { source: "unavailable", available: false, entries: [], error: "ChatGPT surface is unavailable." };
  }
  const currentUrl = chatgptView.webContents.getURL() || "";
  if (!currentUrl.includes("chatgpt.com") && !currentUrl.includes("chat.openai.com")) {
    return { source: "unavailable", available: false, entries: [], error: "ChatGPT surface is not loaded yet." };
  }
  try {
    const result = await chatgptView.webContents.executeJavaScript(chatgptRecentThreadsScript(limit), true);
    return {
      source: normalizeString(result?.source, "unknown"),
      available: result?.available !== false,
      entries: Array.isArray(result?.entries) ? result.entries : [],
      limit: Math.max(1, Math.min(Number(limit) || 40, 200)),
    };
  } catch (error) {
    return {
      source: "execute-failed",
      available: false,
      entries: [],
      error: error.message,
      limit: Math.max(1, Math.min(Number(limit) || 40, 200)),
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
  const saved = await saveConfig({ ...config, selectedProjectId });
  const project = getSelectedProject(saved);
  await loadProjectSurfaces(project);
  return { config: saved, project };
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
  return session.connect(payload?.connection || null);
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
  return session.respond(payload?.id, payload?.result || {});
});

ipcMain.handle("surface:open-external", async (_event, surfaceName) => {
  const view = surfaceName === "chatgpt" ? chatgptView : codexView;
  if (!view || view.webContents.isDestroyed()) return false;
  const url = view.webContents.getURL();
  if (!url || url.startsWith("file://")) return false;
  await shell.openExternal(url);
  return true;
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

ipcMain.handle("chatgpt:recent-threads", async (_event, payload) => {
  return listChatgptRecentThreads(payload?.limit);
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
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
