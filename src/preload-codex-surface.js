const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("codexSurfaceBridge", {
  connect: (connection) => ipcRenderer.invoke("codex-surface:connect", { connection }),
  disconnect: () => ipcRenderer.invoke("codex-surface:disconnect"),
  request: (method, params) => ipcRenderer.invoke("codex-surface:request", { method, params }),
  notify: (method, params) => ipcRenderer.invoke("codex-surface:notify", { method, params }),
  respond: (id, result) => ipcRenderer.invoke("codex-surface:respond", { id, result }),
  respondRequest: (key, result) => ipcRenderer.invoke("codex-surface:respond", { key, result }),
  reportThreadState: (state) => ipcRenderer.invoke("codex-surface:thread-state", state),
  openExternalUrl: (url) => ipcRenderer.invoke("external:open-url", { url }),
  revealProjectFile: (projectId, relPath) => ipcRenderer.invoke("worktree:reveal-file", { projectId, relPath }),
  readStoredThreadTranscript: (projectId, threadId, sourceHome = "", sessionFilePath = "") =>
    ipcRenderer.invoke("codex-thread:transcript", { projectId, threadId, sourceHome, sessionFilePath }),
  onEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("codex-surface:event", listener);
    return () => ipcRenderer.removeListener("codex-surface:event", listener);
  },
});
