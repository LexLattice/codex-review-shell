const { contextBridge, ipcRenderer, webUtils } = require("electron");

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

contextBridge.exposeInMainWorld("codexSurfaceBridge", {
  connect: (connection) => ipcRenderer.invoke("codex-surface:connect", { connection }),
  disconnect: () => ipcRenderer.invoke("codex-surface:disconnect"),
  request: (method, params) => ipcRenderer.invoke("codex-surface:request", { method, params }),
  notify: (method, params) => ipcRenderer.invoke("codex-surface:notify", { method, params }),
  respond: (id, result) => ipcRenderer.invoke("codex-surface:respond", { id, result }),
  respondRequest: (key, result) => ipcRenderer.invoke("codex-surface:respond", { key, result }),
  reportThreadState: (state) => ipcRenderer.invoke("codex-surface:thread-state", state),
  reportAgentGraph: (graph) => ipcRenderer.invoke("codex-surface:agent-graph", graph),
  reportContextManagementEvidence: (evidence) => ipcRenderer.invoke("codex-surface:context-management-evidence", evidence),
  focusSubAgent: (request) => ipcRenderer.invoke("codex-surface:focus-sub-agent", request),
  getRuntimePreferences: (request) => ipcRenderer.invoke("codex-runtime-preferences:get", request || {}),
  updateRuntimePreferences: (request) => ipcRenderer.invoke("codex-runtime-preferences:update", request || {}),
  getDirectImplementationLaneUiStatus: (projectId) => ipcRenderer.invoke("direct-ui:implementation-status", { projectId }),
  readDirectImplementationOperationHistory: (projectId, options = {}) =>
    ipcRenderer.invoke("direct-ui:operation-history", { ...options, projectId }),
  getDirectImplementationPolicyView: (projectId) => ipcRenderer.invoke("direct-ui:policy-readonly-view", { projectId }),
  openWorkspaceLink: (url, options = {}) => ipcRenderer.invoke("link:open", { ...options, url }),
  openExternalUrl: (url) => ipcRenderer.invoke("external:open-url", { url }),
  openProjectFile: (projectId, relPath, options = {}) => ipcRenderer.invoke("file-view:open-project-file", { ...options, projectId, relPath }),
  revealProjectFile: (projectId, relPath) => ipcRenderer.invoke("worktree:reveal-file", { projectId, relPath }),
  getPathForFile: (file) => fileSystemPathForFile(file),
  getDroppedFilePaths: (files) => fileSystemPathsForFiles(files),
  chooseAttachmentFiles: (projectId) => ipcRenderer.invoke("attachments:choose-files", { projectId }),
  stageDroppedAttachments: (projectId, paths = []) => ipcRenderer.invoke("attachments:stage-drop", { projectId, paths }),
  pasteImageAttachment: (projectId) => ipcRenderer.invoke("attachments:paste-image", { projectId }),
  removeAttachmentDraft: (projectId, draftId) => ipcRenderer.invoke("attachments:remove-draft", { projectId, draftId }),
  openContextMenu: (request) => ipcRenderer.invoke("context-menu:open", request || {}),
  readStoredThreadTranscript: (projectId, threadId, sourceHome = "", sessionFilePath = "", limit = 800) =>
    ipcRenderer.invoke("codex-thread:transcript", { projectId, threadId, sourceHome, sessionFilePath, limit }),
  onEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("codex-surface:event", listener);
    return () => ipcRenderer.removeListener("codex-surface:event", listener);
  },
});
