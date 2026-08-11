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

const codexSurfaceApi = {
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
  getDirectCodexSurfaceProjection: (projectId, options = {}) => ipcRenderer.invoke("codex-surface:direct-projection", { projectId, ...options }),
  createDirectWorkThreadDraftSession: (projectId, options = {}) =>
    ipcRenderer.invoke("direct-thread-workbench:create-work-thread-draft-session", { ...options, projectId }),
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
  chooseDirectImportSourceFile: (projectId) =>
    ipcRenderer.invoke("direct-import:choose-source-file", { projectId }),
  chooseDirectImportSourceRoot: (projectId) =>
    ipcRenderer.invoke("direct-import:choose-source-root", { projectId }),
  inspectDirectImportSource: (projectId, options = {}) =>
    ipcRenderer.invoke("direct-import:inspect-source", { ...options, projectId }),
  materializeDirectImport: (projectId, options = {}) =>
    ipcRenderer.invoke("direct-import:materialize", { ...options, projectId }),
  listDirectImports: (projectId, options = {}) =>
    ipcRenderer.invoke("direct-import:list-imports", { ...options, projectId }),
  readDirectThreadIntakeProjection: (projectId, options = {}) =>
    ipcRenderer.invoke("direct-import:thread-intake-projection", { ...options, projectId }),
  startDirectImportCheckpointContinuation: (projectId, options = {}) =>
    ipcRenderer.invoke("direct-import:start-checkpoint-continuation", { ...options, projectId }),
  getWorldManagerSemanticSnapshot: () =>
    ipcRenderer.invoke("world-manager-semantic:snapshot"),
  submitWorldManagerSemanticMessage: (payload = {}) =>
    ipcRenderer.invoke("world-manager-semantic:submit", payload),
  inspectWorldManagerProposal: (proposalId) =>
    ipcRenderer.invoke("world-manager-semantic:inspect-proposal", { proposalId }),
  admitWorldManagerProposal: (proposalId, actorId = "operator") =>
    ipcRenderer.invoke("world-manager-semantic:admit-proposal", { proposalId, actorId }),
  resetWorldManagerSemanticMockup: (mode = "fixture") =>
    ipcRenderer.invoke("world-manager-semantic:reset", { mode }),
  getWorldManagerSnapshot: () =>
    ipcRenderer.invoke("world-manager:snapshot"),
  getWorldManagerRuntimeSettings: (refreshMetadata = false) =>
    ipcRenderer.invoke("world-manager:runtime-settings", {
      refreshMetadata,
    }),
  updateWorldManagerRuntimeSettings: (payload = {}) =>
    ipcRenderer.invoke(
      "world-manager:update-runtime-settings",
      payload,
    ),
  getWorldManagerEpistemicFabric: () =>
    ipcRenderer.invoke("world-manager:epistemic-fabric"),
  acknowledgeWorldManagerLedgerDelivery: (payload = {}) =>
    ipcRenderer.invoke("world-manager:ack-ledger-delivery", payload),
  importWorldManagerLedgerDeliveryContext: (payload = {}) =>
    ipcRenderer.invoke("world-manager:import-ledger-delivery", payload),
  requestWorldManagerArtifactAdmission: (payload = {}) =>
    ipcRenderer.invoke("world-manager:request-artifact-admission", payload),
  submitWorldManagerMessage: (payload = {}) =>
    ipcRenderer.invoke("world-manager:submit", payload),
  transitionWorldManagerDecision: (payload = {}) =>
    ipcRenderer.invoke("world-manager:transition-decision", payload),
  inspectWorldManagerPlanProposal: (payload = {}) =>
    ipcRenderer.invoke("world-manager:inspect-plan-proposal", payload),
  admitWorldManagerPlanProposal: (payload = {}) =>
    ipcRenderer.invoke("world-manager:admit-plan-proposal", payload),
  prepareWorldManagerPlanExecution: (payload = {}) =>
    ipcRenderer.invoke("world-manager:prepare-plan-execution", payload),
  authorizeWorldManagerPlanExecution: (payload = {}) =>
    ipcRenderer.invoke("world-manager:authorize-plan-execution", payload),
  completeWorldManagerPlanExecution: (payload = {}) =>
    ipcRenderer.invoke("world-manager:complete-plan-execution", payload),
  focusWorldManagerProject: (projectId, expectedProjectionRevision = null) =>
    ipcRenderer.invoke("world-manager:focus-project", { projectId, expectedProjectionRevision }),
  inspectWorldManagerProjectGenesisCandidate: (
    candidateId,
    semanticRegionBindingRef = null,
  ) =>
    ipcRenderer.invoke(
      "world-manager:inspect-project-genesis",
      {
        candidateId,
        semanticRegionBindingRef,
      },
    ),
  admitWorldManagerProjectGenesisCandidate: (
    candidateId,
    actorId = "operator",
    semanticRegionBindingRef = null,
  ) =>
    ipcRenderer.invoke(
      "world-manager:admit-project-genesis",
      {
        candidateId,
        actorId,
        semanticRegionBindingRef,
      },
    ),
  provisionWorldManagerProjectSubstrate: (
    projectId,
    workspace,
    actorId = "operator",
  ) =>
    ipcRenderer.invoke(
      "world-manager:provision-project-substrate",
      {
        projectId,
        workspace,
        actorId,
      },
    ),
  reviewWorldManagerAroReconstruction: (
    candidateId,
    candidateDigest,
    expectedCandidateRevision,
    semanticRegionBindingRef,
    actorId = "operator",
  ) =>
    ipcRenderer.invoke(
      "world-manager:review-aro-reconstruction",
      {
        candidateId,
        candidateDigest,
        expectedCandidateRevision,
        semanticRegionBindingRef,
        actorId,
      },
    ),
  admitWorldManagerAroReconstruction: (
    candidateId,
    candidateDigest,
    expectedCandidateRevision,
    semanticRegionBindingRef,
    actorId = "operator",
  ) =>
    ipcRenderer.invoke(
      "world-manager:admit-aro-reconstruction",
      {
        candidateId,
        candidateDigest,
        expectedCandidateRevision,
        semanticRegionBindingRef,
        actorId,
      },
    ),
  defineWorldManagerAroTarget: (
    projectId,
    currentAroId,
    currentAroDigest,
    targetIntent,
    semanticRegionBindingRef,
    retry = false,
  ) =>
    ipcRenderer.invoke(
      "world-manager:define-aro-target",
      {
        projectId,
        currentAroId,
        currentAroDigest,
        targetIntent,
        semanticRegionBindingRef,
        retry,
      },
    ),
  retryWorldManagerAroReconstruction: (
    projectId,
    expectedRunDigest = "",
  ) =>
    ipcRenderer.invoke(
      "world-manager:retry-aro-reconstruction",
      {
        projectId,
        expectedRunDigest,
      },
    ),
  compileWorldManagerAroMutationContract: (
    projectId,
    comparisonId,
    comparisonDigest,
    semanticRegionBindingRef,
    retry = false,
    expectedRunDigest = "",
  ) =>
    ipcRenderer.invoke(
      "world-manager:compile-aro-mutation-contract",
      {
        projectId,
        comparisonId,
        comparisonDigest,
        semanticRegionBindingRef,
        retry,
        expectedRunDigest,
      },
    ),
  mapWorldManagerAroRealizationContext: (
    projectId,
    contractId,
    contractDigest,
    semanticRegionBindingRef,
    retry = false,
    expectedRunDigest = "",
  ) =>
    ipcRenderer.invoke(
      "world-manager:map-aro-realization-context",
      {
        projectId,
        contractId,
        contractDigest,
        semanticRegionBindingRef,
        retry,
        expectedRunDigest,
      },
    ),
  prepareWorldManagerAroWorker: (
    payload = {},
  ) =>
    ipcRenderer.invoke(
      "world-manager:prepare-aro-worker",
      payload,
    ),
  authorizeWorldManagerAroWorker: (
    payload = {},
  ) =>
    ipcRenderer.invoke(
      "world-manager:authorize-aro-worker",
      payload,
    ),
  respondWorldManagerAroWorkerRequest: (
    key,
    result = {},
  ) =>
    ipcRenderer.invoke(
      "world-manager:respond-aro-worker-request",
      {
        key,
        result,
      },
    ),
  captureWorldManagerAroExecutionEvidence: (
    payload = {},
  ) =>
    ipcRenderer.invoke(
      "world-manager:capture-aro-execution-evidence",
      payload,
    ),
  verifyWorldManagerAroRealization: (
    payload = {},
  ) =>
    ipcRenderer.invoke(
      "world-manager:verify-aro-realization",
      payload,
    ),
  applyWorldManagerThoughtBrush: (
    payload = {},
  ) =>
    ipcRenderer.invoke(
      "world-manager:apply-thought-brush",
      payload,
    ),
  undoWorldManagerContextCanvas: (
    payload = {},
  ) =>
    ipcRenderer.invoke(
      "world-manager:undo-context-canvas",
      payload,
    ),
  extractWorldManagerContextCanvasInsight: (
    payload = {},
  ) =>
    ipcRenderer.invoke(
      "world-manager:extract-context-canvas-insight",
      payload,
    ),
  getWorldManagerStatus: () =>
    ipcRenderer.invoke("world-manager:status"),
  onEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("codex-surface:event", listener);
    return () => ipcRenderer.removeListener("codex-surface:event", listener);
  },
  onWorldManagerSemanticEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("world-manager-semantic:event", listener);
    return () => ipcRenderer.removeListener("world-manager-semantic:event", listener);
  },
  onWorldManagerEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("world-manager:event", listener);
    return () => ipcRenderer.removeListener("world-manager:event", listener);
  },
};

const directWorkbenchPreload = process.env.CODEX_EXPERIENCE === "direct-workbench" ||
  (!process.env.CODEX_EXPERIENCE && process.env.CODEX_DIRECT_T3_GUI === "1");

if (directWorkbenchPreload) {
  Object.assign(codexSurfaceApi, {
    readDirectWorkbenchProjectDirectory: () =>
      ipcRenderer.invoke("direct-workbench:project-directory"),
    activateDirectWorkbenchProject: (payload = {}) =>
      ipcRenderer.invoke("direct-workbench:activate-project", payload),
    onDirectWorkbenchProjectDirectoryEvent: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("direct-workbench:project-directory-event", listener);
      return () => ipcRenderer.removeListener("direct-workbench:project-directory-event", listener);
    },
  });
  for (const key of Object.keys(codexSurfaceApi)) {
    if (key.includes("WorldManager")) delete codexSurfaceApi[key];
  }
}

contextBridge.exposeInMainWorld("codexSurfaceBridge", codexSurfaceApi);
