const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("workspaceShell", {
  loadConfig: () => ipcRenderer.invoke("config:load"),
  saveConfig: (config) => ipcRenderer.invoke("config:save", config),
  selectProject: (projectId) => ipcRenderer.invoke("project:select", projectId),
  chooseDirectory: () => ipcRenderer.invoke("dialog:choose-directory"),
  setSurfaceLayout: (bounds) => ipcRenderer.invoke("surface:set-layout", bounds),
  setSurfaceVisible: (visible) => ipcRenderer.invoke("surface:set-visible", visible),
  reloadSurface: (surfaceName) => ipcRenderer.invoke("surface:reload", surfaceName),
  openSurfaceExternal: (surfaceName) => ipcRenderer.invoke("surface:open-external", surfaceName),
  copyText: (text) => ipcRenderer.invoke("clipboard:write-text", text),
  listWorkTree: (projectId, relPath) => ipcRenderer.invoke("worktree:list", { projectId, relPath }),
  readProjectFile: (projectId, relPath) => ipcRenderer.invoke("worktree:read-file", { projectId, relPath }),
  listWatchedArtifacts: (projectId) => ipcRenderer.invoke("worktree:list-watched", { projectId }),
  listCodexThreads: (projectId) => ipcRenderer.invoke("codex-threads:list", { projectId }),
  listThreadAnalytics: (projectId, options = {}) =>
    ipcRenderer.invoke("thread-analytics:list", { projectId, limit: options?.limit }),
  updateThreadAnalytics: (projectId, options = {}) =>
    ipcRenderer.invoke("thread-analytics:update", { projectId, scope: options?.scope || "project" }),
  getThreadAnalytics: (projectId, threadKey) =>
    ipcRenderer.invoke("thread-analytics:detail", { projectId, threadKey }),
  selectCodexThread: (projectId, threadId, sourceHome = "", sessionFilePath = "") =>
    ipcRenderer.invoke("codex:select-thread", { projectId, threadId, sourceHome, sessionFilePath }),
  listCachedChatgptRecentThreads: (limit) => ipcRenderer.invoke("chatgpt:cached-threads", { limit }),
  listChatgptRecentThreads: (limit, options = {}) =>
    ipcRenderer.invoke("chatgpt:recent-threads", { limit, refresh: Boolean(options?.refresh) }),
  openChatgptThreadUrl: (url) => ipcRenderer.invoke("chatgpt:open-url", { url }),
  revealProjectFile: (projectId, relPath) => ipcRenderer.invoke("worktree:reveal-file", { projectId, relPath }),
  attachWorkspace: (projectId) => ipcRenderer.invoke("workspace:attach", { projectId }),
  workspaceStatus: (projectId) => ipcRenderer.invoke("workspace:status", { projectId }),
  runWorkspaceCommand: (projectId, command) => ipcRenderer.invoke("workspace:run-command", { projectId, command }),
  selectChatThread: (projectId, threadId) => ipcRenderer.invoke("chatgpt:select-thread", { projectId, threadId }),
  respondCodexRequest: (key, result) => ipcRenderer.invoke("codex:respond-request", { key, result }),
  focusCodexRequest: (key) => ipcRenderer.invoke("codex:focus-request", { key }),
  dismissCodexComposerOverlay: (reason = "shell") => ipcRenderer.invoke("codex:dismiss-composer-overlay", { reason }),
  openChatgptSettings: () => ipcRenderer.invoke("chatgpt:open-settings"),
  forceChatgptDark: () => ipcRenderer.invoke("chatgpt:force-dark"),
  onSurfaceEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("surface:event", listener);
    return () => ipcRenderer.removeListener("surface:event", listener);
  },
  onShellEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("shell:event", listener);
    return () => ipcRenderer.removeListener("shell:event", listener);
  },
});
