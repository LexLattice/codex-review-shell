const { contextBridge, ipcRenderer } = require("electron");
const { PLANE_ZOOM_POLICY, clampZoomFactor, zoomDeltaForDirection } = require("./shared/plane-zoom");

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
  adjustPlaneZoom: (plane, direction) => ipcRenderer.invoke("plane-zoom:adjust", { plane, direction }),
  setPlaneZoom: (plane, zoomFactor) => ipcRenderer.invoke("plane-zoom:set", { plane, zoomFactor }),
  zoomConstants: PLANE_ZOOM_POLICY,
  clampPlaneZoom: (zoomFactor) => clampZoomFactor(zoomFactor),
  zoomDeltaForDirection: (direction) => zoomDeltaForDirection(direction),
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
  getDirectAuthSettings: () => ipcRenderer.invoke("direct-auth:settings"),
  getDirectAuthStatus: () => ipcRenderer.invoke("direct-auth:status"),
  setDirectAuthStorageMode: (mode) => ipcRenderer.invoke("direct-auth:set-storage-mode", { mode }),
  beginDirectAuthLogin: () => ipcRenderer.invoke("direct-auth:login"),
  completeDirectAuthLogin: (loginId, input) => ipcRenderer.invoke("direct-auth:complete-manual-login", { loginId, input }),
  logoutDirectAuth: () => ipcRenderer.invoke("direct-auth:logout"),
  getDirectRuntimeStatus: (projectId) => ipcRenderer.invoke("direct-runtime:status", { projectId }),
  getDirectImplementationLaneUiStatus: (projectId) => ipcRenderer.invoke("direct-ui:implementation-status", { projectId }),
  readDirectImplementationOperationHistory: (projectId, options = {}) =>
    ipcRenderer.invoke("direct-ui:operation-history", { ...options, projectId }),
  getDirectImplementationPolicyView: (projectId) => ipcRenderer.invoke("direct-ui:policy-readonly-view", { projectId }),
  setDirectRuntimePath: (projectId, runtimePath, options = {}) =>
    ipcRenderer.invoke("direct-runtime:set-path", { ...options, projectId, runtimePath }),
  selectDirectTextOnlyRuntime: (projectId, options = {}) =>
    ipcRenderer.invoke("direct-runtime:select-text-only", { ...options, projectId }),
  enableDirectExperimentalRuntime: (projectId, options = {}) =>
    ipcRenderer.invoke("direct-runtime:enable-experimental", { ...options, projectId }),
  rollbackDirectExperimentalRuntime: (projectId, options = {}) =>
    ipcRenderer.invoke("direct-runtime:rollback-experimental", { ...options, projectId }),
  chooseDirectImportSourceFile: (projectId) =>
    ipcRenderer.invoke("direct-import:choose-source-file", { projectId }),
  chooseDirectImportSourceRoot: (projectId) =>
    ipcRenderer.invoke("direct-import:choose-source-root", { projectId }),
  listDirectImportSources: (projectId, options = {}) =>
    ipcRenderer.invoke("direct-import:list-sources", { ...options, projectId }),
  inspectDirectImportSource: (projectId, options = {}) =>
    ipcRenderer.invoke("direct-import:inspect-source", { ...options, projectId }),
  buildDirectImportCandidate: (projectId, options = {}) =>
    ipcRenderer.invoke("direct-import:build-candidate", { ...options, projectId }),
  buildDirectImportCheckpoint: (projectId, options = {}) =>
    ipcRenderer.invoke("direct-import:build-checkpoint", { ...options, projectId }),
  materializeDirectImport: (projectId, options = {}) =>
    ipcRenderer.invoke("direct-import:materialize", { ...options, projectId }),
  listDirectImports: (projectId, options = {}) =>
    ipcRenderer.invoke("direct-import:list-imports", { ...options, projectId }),
  readDirectImportReport: (projectId, importId) =>
    ipcRenderer.invoke("direct-import:read-report", { projectId, importId }),
  readDirectImportSession: (projectId, importId) =>
    ipcRenderer.invoke("direct-import:read-session", { projectId, importId }),
  hideDirectImport: (projectId, importId) =>
    ipcRenderer.invoke("direct-import:hide", { projectId, importId }),
  unhideDirectImport: (projectId, importId) =>
    ipcRenderer.invoke("direct-import:unhide", { projectId, importId }),
  cancelDirectImport: (projectId, importId) =>
    ipcRenderer.invoke("direct-import:cancel", { projectId, importId }),
  previewDirectImportCheckpointContinuation: (projectId, options = {}) =>
    ipcRenderer.invoke("direct-import:preview-checkpoint-continuation", { ...options, projectId }),
  startDirectImportCheckpointContinuation: (projectId, options = {}) =>
    ipcRenderer.invoke("direct-import:start-checkpoint-continuation", { ...options, projectId }),
  getDirectThreadWorkbenchSnapshot: (projectId, options = {}) =>
    ipcRenderer.invoke("direct-thread-workbench:snapshot", { ...options, projectId }),
  getDirectThreadEvidenceWorkbenchProjection: (projectId, options = {}) =>
    ipcRenderer.invoke("direct-thread-workbench:evidence-projection", { ...options, projectId }),
  readDirectThreadWorkbenchThreadProjection: (projectId, threadId, options = {}) =>
    ipcRenderer.invoke("direct-thread-workbench:read-thread-projection", { ...options, projectId, threadId }),
  readDirectThreadWorkbenchProjectProjection: (projectId, projectionKind, options = {}) =>
    ipcRenderer.invoke("direct-thread-workbench:read-project-projection", { ...options, projectId, projectionKind }),
  readDirectThreadWorkbenchPreviewProjection: (projectId, previewId, options = {}) =>
    ipcRenderer.invoke("direct-thread-workbench:read-preview-projection", { ...options, projectId, previewId }),
  readDirectThreadWorkbenchOperationHistory: (projectId, options = {}) =>
    ipcRenderer.invoke("direct-thread-workbench:read-operation-history", { ...options, projectId }),
  prepareDirectThreadSoftDelete: (projectId, threadId, options = {}) =>
    ipcRenderer.invoke("direct-thread-workbench:prepare-soft-delete", { ...options, projectId, threadId }),
  runDirectThreadLifecycleAction: (projectId, options = {}) =>
    ipcRenderer.invoke("direct-thread-workbench:run-lifecycle-action", { ...options, projectId }),
  createDirectThreadExternalRef: (projectId, options = {}) =>
    ipcRenderer.invoke("direct-thread-workbench:create-external-ref", { ...options, projectId }),
  createDirectThreadBridge: (projectId, options = {}) =>
    ipcRenderer.invoke("direct-thread-workbench:create-bridge", { ...options, projectId }),
  unlinkDirectThreadBridge: (projectId, options = {}) =>
    ipcRenderer.invoke("direct-thread-workbench:unlink-bridge", { ...options, projectId }),
  createDirectThreadMergePreview: (projectId, options = {}) =>
    ipcRenderer.invoke("direct-thread-workbench:create-merge-preview", { ...options, projectId }),
  createDirectThreadPrunePreview: (projectId, options = {}) =>
    ipcRenderer.invoke("direct-thread-workbench:create-prune-preview", { ...options, projectId }),
  createDirectThreadForkPreview: (projectId, options = {}) =>
    ipcRenderer.invoke("direct-thread-workbench:create-fork-preview", { ...options, projectId }),
  prepareDirectThreadForkStart: (projectId, options = {}) =>
    ipcRenderer.invoke("direct-thread-workbench:prepare-fork-start", { ...options, projectId }),
  startDirectThreadForkFromPreview: (projectId, options = {}) =>
    ipcRenderer.invoke("direct-thread-workbench:start-fork-from-preview", { ...options, projectId }),
  prepareDirectThreadDerivedPreviewForkStart: (projectId, options = {}) =>
    ipcRenderer.invoke("direct-thread-workbench:prepare-derived-preview-fork-start", { ...options, projectId }),
  startDirectThreadForkFromDerivedPreview: (projectId, options = {}) =>
    ipcRenderer.invoke("direct-thread-workbench:start-fork-from-derived-preview", { ...options, projectId }),
  readDirectThreadForkStartStatus: (projectId, forkStartId) =>
    ipcRenderer.invoke("direct-thread-workbench:read-fork-start-status", { projectId, forkStartId }),
  rebuildDirectThreadLifecycleProjection: (projectId, options = {}) =>
    ipcRenderer.invoke("direct-thread-workbench:rebuild-lifecycle-projection", { ...options, projectId }),
  rebuildDirectThreadGraphProjection: (projectId, options = {}) =>
    ipcRenderer.invoke("direct-thread-workbench:rebuild-graph-projection", { ...options, projectId }),
  rebuildDirectThreadRendererProjection: (projectId, threadId, options = {}) =>
    ipcRenderer.invoke("direct-thread-workbench:rebuild-renderer-projection", { ...options, projectId, threadId }),
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
