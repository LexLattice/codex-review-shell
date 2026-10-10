"use strict";

// The Workbench sidebar's view of every project at once: each active
// project with its recent threads and what they need (running, or waiting
// for the owner: an approval, a question, a form). Built in the main
// process from the session index and the open surfaces' pending requests;
// carries names and states only, never paths.

const DIRECT_WORKBENCH_THREAD_OVERVIEW_SCHEMA = "direct_workbench_thread_overview@1";
const DEFAULT_THREADS_PER_PROJECT = 6;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function updatedMs(entry = {}) {
  const parsed = Date.parse(normalizeString(entry.updatedAt, normalizeString(entry.createdAt, "")));
  return Number.isFinite(parsed) ? parsed : 0;
}

function workspaceBadge(project = {}) {
  const workspace = isPlainObject(project.workspace) ? project.workspace : {};
  const kind = ["wsl", "windows", "local"].includes(workspace.kind) ? workspace.kind : "unknown";
  return {
    workspaceKind: kind,
    // A distro name is an environment identity, not a path.
    distro: kind === "wsl" ? normalizeString(workspace.distro, "").slice(0, 80) : "",
  };
}

// pendingRequests: [{ projectId, threadId }] for every owner request still
// open in a surface. sessions: the session index entries.
function buildDirectWorkbenchThreadOverview(input = {}) {
  const projects = (Array.isArray(input.projects) ? input.projects : [])
    .filter((project) => isPlainObject(project) && project.lifecycle?.state !== "archived");
  const selectedProjectId = normalizeString(input.selectedProjectId, "");
  const liveProjectIds = input.liveProjectIds instanceof Set ? input.liveProjectIds : new Set(input.liveProjectIds || []);
  const perProject = Math.max(1, Math.min(40, Number(input.threadsPerProject) || DEFAULT_THREADS_PER_PROJECT));
  const waiting = new Map();
  for (const request of Array.isArray(input.pendingRequests) ? input.pendingRequests : []) {
    const projectId = normalizeString(request?.projectId, "");
    if (!projectId) continue;
    const key = `${projectId}\u0000${normalizeString(request.threadId, "")}`;
    waiting.set(key, (waiting.get(key) || 0) + 1);
  }
  const sessionsByProject = new Map();
  for (const entry of Array.isArray(input.sessions) ? input.sessions : []) {
    const projectId = normalizeString(entry?.projectId, "");
    const threadId = normalizeString(entry?.sessionId, "");
    // Sub-agent threads belong to their parent's transcript.
    if (!projectId || !threadId || normalizeString(entry.agentKind, "")) continue;
    if (!sessionsByProject.has(projectId)) sessionsByProject.set(projectId, []);
    sessionsByProject.get(projectId).push(entry);
  }
  const rows = projects.map((project) => {
    const projectId = normalizeString(project.id, "");
    const entries = (sessionsByProject.get(projectId) || []).slice().sort((left, right) => updatedMs(right) - updatedMs(left));
    const threads = entries.map((entry) => {
      const threadId = normalizeString(entry.sessionId, "");
      const needsYou = waiting.get(`${projectId}\u0000${threadId}`) || 0;
      const running = Number(entry.activeTurnCount || 0) > 0;
      return {
        threadId,
        title: normalizeString(entry.title, "Untitled thread").slice(0, 160),
        updatedAt: normalizeString(entry.updatedAt, normalizeString(entry.createdAt, "")),
        state: needsYou ? "needs_you" : running ? "running" : "idle",
        running,
        needsYouCount: needsYou,
      };
    });
    // A request whose thread isn't in the index (or wasn't named) still
    // counts for the project.
    const known = new Set(threads.map((thread) => thread.threadId));
    let unattributed = 0;
    for (const [key, count] of waiting) {
      const [requestProjectId, threadId] = key.split("\u0000");
      if (requestProjectId === projectId && !known.has(threadId)) unattributed += count;
    }
    const needsYouCount = threads.reduce((sum, thread) => sum + thread.needsYouCount, 0) + unattributed;
    const runningCount = threads.filter((thread) => thread.running).length;
    // Recent threads, plus any older one that is running or waiting.
    const shown = threads.slice(0, perProject);
    for (const thread of threads.slice(perProject)) {
      if (thread.state !== "idle") shown.push(thread);
    }
    return {
      projectId,
      displayName: normalizeString(project.name, "Unnamed project").slice(0, 160),
      ...workspaceBadge(project),
      selected: projectId === selectedProjectId,
      live: liveProjectIds.has(projectId),
      runningCount,
      needsYouCount,
      threadCount: threads.length,
      threads: shown,
      moreThreadCount: Math.max(0, threads.length - shown.length),
    };
  });
  return {
    schema: DIRECT_WORKBENCH_THREAD_OVERVIEW_SCHEMA,
    generatedAt: normalizeString(input.generatedAt, new Date().toISOString()),
    selectedProjectId,
    projects: rows,
    rawPathExposed: false,
  };
}

module.exports = {
  DIRECT_WORKBENCH_THREAD_OVERVIEW_SCHEMA,
  buildDirectWorkbenchThreadOverview,
};
