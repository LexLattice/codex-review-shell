const { contextBridge, ipcRenderer, webUtils } = require("electron");
const { PLANE_ZOOM_POLICY, clampZoomFactor, zoomDeltaForDirection } = require("./shared/plane-zoom");

function fileSystemPathForFile(file) {
  try {
    return webUtils?.getPathForFile?.(file) || file?.path || "";
  } catch {
    return "";
  }
}

function fileSystemPathsForFiles(files) {
  return Array.from(files || [])
    .map((file) => fileSystemPathForFile(file))
    .filter(Boolean);
}

contextBridge.exposeInMainWorld("workspaceShell", {
  loadConfig: () => ipcRenderer.invoke("config:load"),
  saveConfig: (config) => ipcRenderer.invoke("config:save", config),
  selectProject: (projectId) => ipcRenderer.invoke("project:select", projectId),
  chooseDirectory: () => ipcRenderer.invoke("dialog:choose-directory"),
  setSurfaceLayout: (bounds) => ipcRenderer.invoke("surface:set-layout", bounds),
  setSurfaceVisible: (visible) => ipcRenderer.invoke("surface:set-visible", visible),
  reloadSurface: (surfaceName) => ipcRenderer.invoke("surface:reload", surfaceName),
  reloadCodexRuntime: (options = {}) => ipcRenderer.invoke("codex:reload-runtime", options),
  openSurfaceExternal: (surfaceName) => ipcRenderer.invoke("surface:open-external", surfaceName),
  openWorkspaceLink: (url, options = {}) => ipcRenderer.invoke("link:open", { ...options, url }),
  setMiddleWebLayout: (layout) => ipcRenderer.invoke("middle-web:set-layout", layout),
  middleWebGoBack: () => ipcRenderer.invoke("middle-web:go-back"),
  middleWebGoForward: () => ipcRenderer.invoke("middle-web:go-forward"),
  middleWebReload: () => ipcRenderer.invoke("middle-web:reload"),
  middleWebStop: () => ipcRenderer.invoke("middle-web:stop"),
  middleWebOpenExternal: () => ipcRenderer.invoke("middle-web:open-external"),
  middleWebCopyUrl: () => ipcRenderer.invoke("middle-web:copy-url"),
  middleWebSnapshot: () => ipcRenderer.invoke("middle-web:snapshot"),
  middleWebHistory: () => ipcRenderer.invoke("middle-web:history"),
  middleWebPruneHistory: (payload = {}) => ipcRenderer.invoke("middle-web:prune-history", payload),
  adjustPlaneZoom: (plane, direction) => ipcRenderer.invoke("plane-zoom:adjust", { plane, direction }),
  setPlaneZoom: (plane, zoomFactor) => ipcRenderer.invoke("plane-zoom:set", { plane, zoomFactor }),
  zoomConstants: PLANE_ZOOM_POLICY,
  clampPlaneZoom: (zoomFactor) => clampZoomFactor(zoomFactor),
  zoomDeltaForDirection: (direction) => zoomDeltaForDirection(direction),
  copyText: (text) => ipcRenderer.invoke("clipboard:write-text", text),
  getPathForFile: (file) => fileSystemPathForFile(file),
  getDroppedFilePaths: (files) => fileSystemPathsForFiles(files),
  chooseAttachmentFiles: (projectId) => ipcRenderer.invoke("attachments:choose-files", { projectId }),
  stageDroppedAttachments: (projectId, paths = []) => ipcRenderer.invoke("attachments:stage-drop", { projectId, paths }),
  pasteImageAttachment: (projectId) => ipcRenderer.invoke("attachments:paste-image", { projectId }),
  removeAttachmentDraft: (projectId, draftId) => ipcRenderer.invoke("attachments:remove-draft", { projectId, draftId }),
  openContextMenu: (request) => ipcRenderer.invoke("context-menu:open", request || {}),
  sendProjectStashToChatgpt: (payload) => ipcRenderer.invoke("project-stash:send-to-chatgpt", payload || {}),
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
