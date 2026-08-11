"use strict";

const crypto = require("node:crypto");
const {
  directRuntimePathFromBinding,
  directRuntimePathLabel,
} = require("../runtime/runtime-path-selection");

const DIRECT_WORKBENCH_PROJECT_DIRECTORY_SCHEMA = "direct_workbench_project_directory@1";
const DIRECT_WORKBENCH_PROJECT_ACTIVATION_RECEIPT_SCHEMA = "direct_workbench_project_activation_receipt@1";
const DIRECT_WORKBENCH_PROJECT_BINDING_DRAFT_SCHEMA = "direct_workbench_project_binding_draft@1";
const DIRECT_WORKBENCH_PROJECT_BINDING_RECEIPT_SCHEMA = "direct_workbench_project_binding_receipt@1";
const DIRECT_WORKBENCH_PROJECT_LIFECYCLE_DRAFT_SCHEMA = "direct_workbench_project_lifecycle_draft@1";
const DIRECT_WORKBENCH_PROJECT_LIFECYCLE_RECEIPT_SCHEMA = "direct_workbench_project_lifecycle_receipt@1";
const PROJECT_TRANSITION_STATES = new Set(["idle", "activating", "completed", "failed"]);
const WORKSPACE_KINDS = new Set(["wsl", "windows", "local"]);
const PROJECT_BINDING_MODES = new Set(["create", "edit"]);
const PROJECT_LIFECYCLE_ACTIONS = new Set(["archive", "restore", "delete"]);
const FORBIDDEN_RENDERER_KEYS = new Set([
  "repoPath",
  "localPath",
  "linuxPath",
  "windowsPath",
  "windowsNodePath",
  "sourceHome",
  "sessionFilePath",
  "binaryPath",
  "remoteAuth",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => (entry === undefined ? "null" : stableStringify(entry))).join(",")}]`;
  }
  if (!isPlainObject(value)) return JSON.stringify(value);
  return `{${Object.keys(value)
    .sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function digest(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => normalizeString(value, "")).filter(Boolean))];
}

function looksLikeRawLocator(value) {
  const text = normalizeString(value, "");
  return Boolean(
    text.startsWith("/") ||
    text.startsWith("\\\\") ||
    /^[A-Za-z]:[\\/]/.test(text) ||
    /^wsl:/i.test(text) ||
    /^file:/i.test(text) ||
    /(^|[\s('"`])\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~ -]+)*/.test(text) ||
    /(^|[\s('"`])[A-Za-z]:[\\/]/.test(text) ||
    text.includes("\\\\") ||
    /(^|\s)(?:wsl|file):/i.test(text)
  );
}

function safeLabel(value, fallback) {
  const text = normalizeString(value, fallback);
  return looksLikeRawLocator(text) ? fallback : text.slice(0, 160);
}

function substrateProjection(project = {}) {
  const workspace = isPlainObject(project.workspace) ? project.workspace : {};
  const workspaceKind = WORKSPACE_KINDS.has(workspace.kind) ? workspace.kind : "unknown";
  const defaults = {
    wsl: { environmentId: "env_wsl_native", displayLabel: "WSL workspace" },
    windows: { environmentId: "env_windows_native", displayLabel: "Windows workspace" },
    local: { environmentId: "env_local_native", displayLabel: "Local workspace" },
    unknown: { environmentId: "environment_unknown", displayLabel: "Workspace unavailable" },
  };
  const fallback = defaults[workspaceKind];
  return {
    workspaceKind,
    environmentId: fallback.environmentId,
    displayLabel: safeLabel(workspace.label, fallback.displayLabel),
    configured: workspaceKind !== "unknown",
    rawPathExposed: false,
  };
}

function runtimeProjection(project = {}) {
  const binding = isPlainObject(project.surfaceBinding?.codex) ? project.surfaceBinding.codex : {};
  const runtimePath = directRuntimePathFromBinding(binding);
  return {
    runtimePath,
    displayLabel: directRuntimePathLabel(runtimePath),
    configured: Boolean(Object.keys(binding).length),
    rawProviderConfigExposed: false,
  };
}

function restoreProjection(project = {}) {
  const bindings = Array.isArray(project.laneBindings) ? project.laneBindings.filter(isPlainObject) : [];
  const binding = bindings.find((entry) => entry.openOnProjectActivate && entry.codexThreadRef?.threadId) ||
    bindings.find((entry) => entry.isDefaultForLane && entry.codexThreadRef?.threadId) ||
    bindings.find((entry) => entry.codexThreadRef?.threadId) ||
    null;
  return {
    available: Boolean(binding),
    displayLabel: binding ? "Configured thread binding" : "New or runtime-selected thread",
    rawThreadIdentityExposed: false,
  };
}

function activationAuthorityDigest(project = {}) {
  return digest({
    projectId: normalizeString(project.id, ""),
    repoPath: normalizeString(project.repoPath, ""),
    workspace: isPlainObject(project.workspace) ? project.workspace : {},
    codexRuntime: isPlainObject(project.surfaceBinding?.codex) ? project.surfaceBinding.codex : {},
    lifecycle: isPlainObject(project.lifecycle) ? project.lifecycle : {},
    laneBindings: Array.isArray(project.laneBindings) ? project.laneBindings : [],
    chatActivation: {
      activeChatThreadId: normalizeString(project.activeChatThreadId, ""),
      lastActiveThreadId: normalizeString(project.lastActiveThreadId, ""),
      lastActiveBindingId: normalizeString(project.lastActiveBindingId, ""),
      threads: (Array.isArray(project.chatThreads) ? project.chatThreads : []).map((thread) => ({
        id: normalizeString(thread?.id, ""),
        role: normalizeString(thread?.role, ""),
        isPrimary: thread?.isPrimary === true,
        archived: thread?.archived === true,
      })),
    },
  });
}

function projectLifecycleState(project = {}) {
  return project.lifecycle?.state === "archived" ? "archived" : "active";
}

function normalizeDirectWorkbenchProjectLifecycleCatalog(projects = [], selectedProjectId = "", now = new Date().toISOString()) {
  const normalizedProjects = (Array.isArray(projects) ? projects : []).filter(isPlainObject).map((project) => ({
    ...project,
    lifecycle: projectLifecycleState(project) === "archived"
      ? {
          state: "archived",
          archivedAt: normalizeString(project.lifecycle?.archivedAt, normalizeString(project.lifecycle?.updatedAt, now)),
          restoredAt: normalizeString(project.lifecycle?.restoredAt, ""),
          updatedAt: normalizeString(project.lifecycle?.updatedAt, ""),
        }
      : {
          state: "active",
          archivedAt: "",
          restoredAt: normalizeString(project.lifecycle?.restoredAt, ""),
          updatedAt: normalizeString(project.lifecycle?.updatedAt, ""),
        },
  }));
  if (normalizedProjects.length && !normalizedProjects.some((project) => projectLifecycleState(project) === "active")) {
    normalizedProjects[0] = {
      ...normalizedProjects[0],
      lifecycle: {
        state: "active",
        archivedAt: "",
        restoredAt: now,
        updatedAt: now,
      },
      updatedAt: now,
    };
  }
  const selectedCandidate = normalizeString(selectedProjectId, "");
  const selected = normalizedProjects.find((project) =>
    normalizeString(project.id, "") === selectedCandidate && projectLifecycleState(project) === "active") ||
    normalizedProjects.find((project) => projectLifecycleState(project) === "active") ||
    null;
  return {
    projects: normalizedProjects,
    selectedProjectId: normalizeString(selected?.id, ""),
  };
}

function projectBindingRevision(project = {}) {
  return digest({
    projectId: normalizeString(project.id, ""),
    displayName: normalizeString(project.name, ""),
    activationAuthority: activationAuthorityDigest(project),
  });
}

function workspaceBindingDraft(workspace = {}) {
  const kind = WORKSPACE_KINDS.has(workspace.kind) ? workspace.kind : "local";
  return {
    kind,
    label: normalizeString(workspace.label, ""),
    localPath: kind === "local" ? normalizeString(workspace.localPath, "") : "",
    windowsPath: kind === "windows" ? normalizeString(workspace.windowsPath, "") : "",
    distro: kind === "wsl" ? normalizeString(workspace.distro, "") : "",
    linuxPath: kind === "wsl" ? normalizeString(workspace.linuxPath, "") : "",
  };
}

function buildDirectWorkbenchProjectBindingDraft(config = {}, options = {}) {
  const projects = Array.isArray(config.projects) ? config.projects.filter(isPlainObject) : [];
  const projectId = normalizeString(options.projectId, "");
  const project = projectId ? projects.find((entry) => normalizeString(entry.id, "") === projectId) : null;
  if (projectId && !project) throw projectDirectoryError("project_binding_target_unknown");
  if (project && projectLifecycleState(project) === "archived") {
    throw projectDirectoryError("project_binding_archived");
  }
  const mode = project ? "edit" : "create";
  const defaults = isPlainObject(options.defaults) ? options.defaults : {};
  const workspace = project?.workspace || defaults.workspace || {};
  return {
    schema: DIRECT_WORKBENCH_PROJECT_BINDING_DRAFT_SCHEMA,
    mode,
    sourceProjectId: normalizeString(options.sourceProjectId, config.selectedProjectId || projects[0]?.id || ""),
    projectId: project ? normalizeString(project.id, "") : "",
    expectedCatalogRevision: normalizeString(options.catalogRevision, ""),
    expectedProjectRevision: project ? projectBindingRevision(project) : "",
    fields: {
      displayName: normalizeString(project?.name, normalizeString(defaults.displayName, "New project")),
      workspace: workspaceBindingDraft(workspace),
      runtimePath: directRuntimePathFromBinding(project?.surfaceBinding?.codex || defaults.codexBinding || {}),
    },
    evidence: {
      projectIdentityAssignedByMain: mode === "create",
      workspaceLocatorVisibleForEditing: true,
      remoteAuthExposed: false,
      providerSecretsExposed: false,
      activeProjectEditRebindsRuntime: mode === "edit" && normalizeString(project?.id, "") === normalizeString(config.selectedProjectId, ""),
    },
    authorityBoundary: {
      rendererMayProposeBindingFields: true,
      rendererMayAssignProjectIdentity: false,
      rendererMayPersistConfig: false,
      mainRevalidatesRevisionAndActiveWork: true,
      worldManagerStateAffected: false,
    },
  };
}

function normalizeProjectBindingWorkspace(input = {}) {
  const kind = normalizeString(input.kind, "").toLowerCase();
  if (!WORKSPACE_KINDS.has(kind)) throw projectDirectoryError("project_binding_workspace_kind_invalid");
  const label = normalizeString(input.label, "").slice(0, 160);
  if (kind === "wsl") {
    const linuxPath = normalizeString(input.linuxPath, "");
    if (!linuxPath.startsWith("/")) throw projectDirectoryError("project_binding_wsl_path_invalid");
    return {
      kind,
      distro: normalizeString(input.distro, "").slice(0, 120),
      linuxPath,
      label: label || "WSL workspace",
    };
  }
  if (kind === "windows") {
    const windowsPath = normalizeString(input.windowsPath, "");
    if (!/^(?:[A-Za-z]:[\\/]|\\\\)/.test(windowsPath)) {
      throw projectDirectoryError("project_binding_windows_path_invalid");
    }
    return { kind, windowsPath, label: label || "Windows workspace" };
  }
  const localPath = normalizeString(input.localPath, "");
  if (!localPath || (!localPath.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(localPath))) {
    throw projectDirectoryError("project_binding_local_path_invalid");
  }
  return { kind, localPath, label: label || "Local workspace" };
}

function validateDirectWorkbenchProjectBindingMutation(directory = {}, config = {}, request = {}) {
  if (directory.schema !== DIRECT_WORKBENCH_PROJECT_DIRECTORY_SCHEMA) {
    throw projectDirectoryError("project_directory_schema_mismatch");
  }
  const mode = normalizeString(request.mode, "").toLowerCase();
  const clientMutationId = normalizeString(request.clientMutationId, "");
  const sourceProjectId = normalizeString(request.sourceProjectId, "");
  const projectId = normalizeString(request.projectId, "");
  if (!PROJECT_BINDING_MODES.has(mode)) throw projectDirectoryError("project_binding_mode_invalid");
  if (!clientMutationId) throw projectDirectoryError("client_mutation_id_required");
  if (sourceProjectId !== directory.activeProjectId) throw projectDirectoryError("project_binding_source_stale");
  if (normalizeString(request.expectedCatalogRevision, "") !== directory.catalogRevision) {
    throw projectDirectoryError("project_catalog_revision_stale");
  }
  if (directory.transition?.state === "activating") throw projectDirectoryError("project_activation_in_progress");
  const projects = Array.isArray(config.projects) ? config.projects.filter(isPlainObject) : [];
  const project = projectId ? projects.find((entry) => normalizeString(entry.id, "") === projectId) : null;
  if (mode === "edit") {
    if (!project) throw projectDirectoryError("project_binding_target_unknown");
    if (normalizeString(request.expectedProjectRevision, "") !== projectBindingRevision(project)) {
      throw projectDirectoryError("project_binding_revision_stale");
    }
    const directoryRow = directory.projects.find((row) => row.projectId === projectId);
    if (Number(directoryRow?.activeTurnCount || 0) > 0) {
      throw projectDirectoryError(
        projectId === directory.activeProjectId
          ? "active_turn_in_current_project"
          : "active_turn_in_target_project",
      );
    }
  } else if (projectId) {
    throw projectDirectoryError("project_binding_create_identity_forbidden");
  }
  const displayName = normalizeString(request.fields?.displayName, "").slice(0, 160);
  if (!displayName) throw projectDirectoryError("project_binding_name_required");
  const workspace = normalizeProjectBindingWorkspace(request.fields?.workspace || {});
  const runtimePath = normalizeString(request.fields?.runtimePath, "");
  if (!["app-server", "direct-text", "direct-implementation"].includes(runtimePath)) {
    throw projectDirectoryError("project_binding_runtime_path_invalid");
  }
  return {
    mode,
    clientMutationId,
    sourceProjectId,
    projectId,
    expectedCatalogRevision: directory.catalogRevision,
    expectedProjectRevision: mode === "edit" ? projectBindingRevision(project) : "",
    displayName,
    workspace,
    runtimePath,
    mutationId: `project_binding_${digest({ clientMutationId, sourceProjectId, mode, projectId }).slice(0, 24)}`,
  };
}

function buildDirectWorkbenchProjectBindingReceipt(input = {}) {
  return {
    schema: DIRECT_WORKBENCH_PROJECT_BINDING_RECEIPT_SCHEMA,
    ok: input.ok === true,
    status: normalizeString(input.status, input.ok === true ? "accepted" : "failed"),
    mutationId: normalizeString(input.mutationId, ""),
    clientMutationId: normalizeString(input.clientMutationId, ""),
    mode: PROJECT_BINDING_MODES.has(input.mode) ? input.mode : "",
    sourceProjectId: normalizeString(input.sourceProjectId, ""),
    projectId: normalizeString(input.projectId, ""),
    reason: normalizeString(input.reason, ""),
    duplicate: input.duplicate === true,
    acceptedAt: normalizeString(input.acceptedAt, ""),
    completedAt: normalizeString(input.completedAt, ""),
    worldManagerStateAffected: false,
  };
}

function resolveDirectWorkbenchProjectBindingReplay(operations, authorityProjectId, request = {}) {
  const clientMutationId = normalizeString(request.clientMutationId, "");
  const existing = clientMutationId && operations instanceof Map ? operations.get(clientMutationId) : null;
  if (!existing) return null;
  const signature = {
    sourceProjectId: normalizeString(request.sourceProjectId, ""),
    mode: normalizeString(request.mode, ""),
    projectId: normalizeString(request.projectId, ""),
  };
  if (existing.sourceProjectId !== signature.sourceProjectId || existing.mode !== signature.mode || existing.projectId !== signature.projectId) {
    throw projectDirectoryError("client_mutation_id_reused");
  }
  if (normalizeString(authorityProjectId, "") !== existing.sourceProjectId) {
    throw projectDirectoryError("project_binding_source_stale");
  }
  return { ...existing.receipt, duplicate: true };
}

function normalizedTransition(input = {}) {
  const state = PROJECT_TRANSITION_STATES.has(input.state) ? input.state : "idle";
  return {
    state,
    activationId: normalizeString(input.activationId, ""),
    sourceProjectId: normalizeString(input.sourceProjectId, ""),
    targetProjectId: normalizeString(input.targetProjectId, ""),
    reason: normalizeString(input.reason, ""),
    updatedAt: normalizeString(input.updatedAt, ""),
  };
}

function activeTurnCount(input = {}, projectId = "") {
  if (input instanceof Map) return Math.max(0, Number(input.get(projectId) || 0));
  if (isPlainObject(input)) return Math.max(0, Number(input[projectId] || 0));
  return 0;
}

function buildDirectWorkbenchProjectDirectory(config = {}, options = {}) {
  const projects = Array.isArray(config.projects) ? config.projects.filter(isPlainObject) : [];
  const projectsById = new Map(
    projects.map((project) => [normalizeString(project.id, ""), project]),
  );
  const activeProjectId = normalizeString(
    options.activeProjectId,
    normalizeString(config.selectedProjectId, projects[0]?.id || ""),
  );
  const transition = normalizedTransition(options.transition);
  const activeTurns = options.activeTurnCounts || {};
  const currentActiveTurnCount = activeTurnCount(activeTurns, activeProjectId);
  const activeProjectCount = projects.filter((project) => projectLifecycleState(project) === "active").length;
  const archivedProjectCount = projects.length - activeProjectCount;
  const rows = projects.map((project) => {
    const projectId = normalizeString(project.id, "");
    const selected = projectId === activeProjectId;
    const lifecycleState = projectLifecycleState(project);
    const archived = lifecycleState === "archived";
    const targetActiveTurnCount = activeTurnCount(activeTurns, projectId);
    const blockerCodes = [];
    if (!selected && transition.state === "activating") blockerCodes.push("project_activation_in_progress");
    if (!selected && currentActiveTurnCount > 0) blockerCodes.push("active_turn_in_current_project");
    if (!selected && targetActiveTurnCount > 0) blockerCodes.push("active_turn_in_target_project");
    if (archived) blockerCodes.push("project_binding_archived");
    const substrate = substrateProjection(project);
    const runtime = runtimeProjection(project);
    if (!substrate.configured) blockerCodes.push("project_substrate_unknown");
    if (!runtime.configured) blockerCodes.push("project_runtime_unconfigured");
    const activating = !archived && transition.state === "activating" && transition.targetProjectId === projectId;
    const lifecycleBlockerCodes = [];
    if (selected) lifecycleBlockerCodes.push("project_lifecycle_active_project_forbidden");
    if (targetActiveTurnCount > 0) lifecycleBlockerCodes.push("active_turn_in_target_project");
    if (transition.state === "activating") lifecycleBlockerCodes.push("project_activation_in_progress");
    const lifecycleEligible = lifecycleBlockerCodes.length === 0;
    return {
      projectId,
      displayName: safeLabel(project.name, "Unnamed project"),
      selected,
      state: archived ? "archived" : selected ? "active" : activating ? "activating" : blockerCodes.length ? "blocked" : "available",
      selectable: !archived && !selected && !activating && blockerCodes.length === 0,
      blockerCodes: uniqueStrings(blockerCodes),
      activeTurnCount: targetActiveTurnCount,
      substrate,
      runtime,
      restore: restoreProjection(project),
      lifecycle: {
        state: lifecycleState,
        archivedAt: archived ? normalizeString(project.lifecycle?.archivedAt, "") : "",
        canArchive: !archived && lifecycleEligible,
        canRestore: archived && lifecycleEligible,
        canDelete: archived && lifecycleEligible,
        blockerCodes: uniqueStrings(lifecycleBlockerCodes),
      },
    };
  });
  const revisionInput = {
    activeProjectId,
    transition: {
      state: transition.state === "activating" ? "activating" : "settled",
      targetProjectId: transition.state === "activating" ? transition.targetProjectId : "",
    },
    projects: rows.map((row) => ({
      projectId: row.projectId,
      displayName: row.displayName,
      selected: row.selected,
      selectable: row.selectable,
      blockerCodes: row.blockerCodes,
      activeTurnCount: row.activeTurnCount,
      substrate: row.substrate,
      runtime: row.runtime,
      restore: row.restore,
      lifecycle: row.lifecycle,
      activationAuthorityDigest: activationAuthorityDigest(projectsById.get(row.projectId)),
    })),
  };
  const projection = {
    schema: DIRECT_WORKBENCH_PROJECT_DIRECTORY_SCHEMA,
    generatedAt: normalizeString(options.generatedAt, new Date().toISOString()),
    catalogRevision: digest(revisionInput),
    activeProjectId,
    projectCount: rows.length,
    activeProjectCount,
    archivedProjectCount,
    transition,
    projects: rows,
    authorityBoundary: {
      catalogOwnsActivation: false,
      rendererMayMutateConfig: false,
      rendererMaySupplyWorkspaceLocator: false,
      mainRevalidatesActivation: true,
      mainOwnsProjectLifecycle: true,
      worldManagerStateAffected: false,
    },
    rawPathExposed: false,
    rawProviderConfigExposed: false,
    rawAuthExposed: false,
  };
  assertDirectWorkbenchProjectDirectoryRendererSafe(projection);
  return projection;
}

function projectLifecycleActionProjection(row = {}, action = "") {
  const lifecycle = isPlainObject(row.lifecycle) ? row.lifecycle : {};
  const eligibility = action === "archive"
    ? lifecycle.canArchive === true
    : action === "restore"
      ? lifecycle.canRestore === true
      : lifecycle.canDelete === true;
  const wrongState = action === "archive"
    ? lifecycle.state !== "active"
    : lifecycle.state !== "archived";
  return {
    eligible: eligibility,
    blockerCodes: uniqueStrings([
      ...(Array.isArray(lifecycle.blockerCodes) ? lifecycle.blockerCodes : []),
      wrongState ? `project_lifecycle_${action}_state_invalid` : "",
    ]),
  };
}

function buildDirectWorkbenchProjectLifecycleDraft(config = {}, directory = {}, options = {}) {
  if (directory.schema !== DIRECT_WORKBENCH_PROJECT_DIRECTORY_SCHEMA) {
    throw projectDirectoryError("project_directory_schema_mismatch");
  }
  const projectId = normalizeString(options.projectId, "");
  const project = (Array.isArray(config.projects) ? config.projects : [])
    .find((entry) => normalizeString(entry?.id, "") === projectId);
  const row = (Array.isArray(directory.projects) ? directory.projects : [])
    .find((entry) => entry?.projectId === projectId);
  if (!project || !row) throw projectDirectoryError("project_binding_target_unknown");
  const displayName = safeLabel(project.name, "Unnamed project");
  const requiredConfirmation = `DELETE ${displayName}`;
  return {
    schema: DIRECT_WORKBENCH_PROJECT_LIFECYCLE_DRAFT_SCHEMA,
    sourceProjectId: directory.activeProjectId,
    projectId,
    expectedCatalogRevision: directory.catalogRevision,
    expectedProjectRevision: projectBindingRevision(project),
    target: {
      displayName,
      lifecycleState: row.lifecycle?.state || "active",
      substrateLabel: row.substrate?.displayLabel || "Workspace unavailable",
      runtimeLabel: row.runtime?.displayLabel || "Runtime unavailable",
      restoreLabel: row.restore?.displayLabel || "Thread restore unavailable",
      selected: row.selected === true,
      activeTurnCount: Number(row.activeTurnCount || 0),
    },
    actions: {
      archive: projectLifecycleActionProjection(row, "archive"),
      restore: projectLifecycleActionProjection(row, "restore"),
      delete: {
        ...projectLifecycleActionProjection(row, "delete"),
        requiredConfirmation,
      },
    },
    effects: {
      archivePreservesProjectBinding: true,
      restorePreservesProjectIdentity: true,
      deleteRemovesProjectBindingIdentity: true,
      workspaceFilesDeleted: false,
      gitStateDeleted: false,
      threadEvidenceDeleted: false,
      worldManagerStateAffected: false,
    },
    authorityBoundary: {
      rendererMayRequestLifecycleTransition: true,
      rendererMayPersistOrDeleteConfig: false,
      mainRevalidatesRevisionAndActiveWork: true,
      deleteRequiresExactConfirmation: true,
    },
  };
}

function validateDirectWorkbenchProjectLifecycleMutation(directory = {}, config = {}, request = {}) {
  if (directory.schema !== DIRECT_WORKBENCH_PROJECT_DIRECTORY_SCHEMA) {
    throw projectDirectoryError("project_directory_schema_mismatch");
  }
  const clientLifecycleId = normalizeString(request.clientLifecycleId, "");
  const action = normalizeString(request.action, "").toLowerCase();
  const sourceProjectId = normalizeString(request.sourceProjectId, "");
  const projectId = normalizeString(request.projectId, "");
  if (!clientLifecycleId) throw projectDirectoryError("client_lifecycle_id_required");
  if (!PROJECT_LIFECYCLE_ACTIONS.has(action)) throw projectDirectoryError("project_lifecycle_action_invalid");
  if (sourceProjectId !== directory.activeProjectId) throw projectDirectoryError("project_binding_source_stale");
  if (normalizeString(request.expectedCatalogRevision, "") !== directory.catalogRevision) {
    throw projectDirectoryError("project_catalog_revision_stale");
  }
  if (directory.transition?.state === "activating") throw projectDirectoryError("project_activation_in_progress");
  const project = (Array.isArray(config.projects) ? config.projects : [])
    .find((entry) => normalizeString(entry?.id, "") === projectId);
  const row = (Array.isArray(directory.projects) ? directory.projects : [])
    .find((entry) => entry?.projectId === projectId);
  if (!project || !row) throw projectDirectoryError("project_binding_target_unknown");
  if (normalizeString(request.expectedProjectRevision, "") !== projectBindingRevision(project)) {
    throw projectDirectoryError("project_binding_revision_stale");
  }
  const actionProjection = projectLifecycleActionProjection(row, action);
  if (!actionProjection.eligible) {
    throw projectDirectoryError(actionProjection.blockerCodes[0] || "project_lifecycle_transition_blocked");
  }
  const requiredConfirmation = `DELETE ${safeLabel(project.name, "Unnamed project")}`;
  if (action === "delete" && request.confirmation !== requiredConfirmation) {
    throw projectDirectoryError("project_lifecycle_delete_confirmation_invalid");
  }
  return {
    clientLifecycleId,
    action,
    sourceProjectId,
    projectId,
    expectedCatalogRevision: directory.catalogRevision,
    expectedProjectRevision: projectBindingRevision(project),
    confirmation: action === "delete" ? request.confirmation : "",
    requiredConfirmation: action === "delete" ? requiredConfirmation : "",
    lifecycleId: `project_lifecycle_${digest({ clientLifecycleId, sourceProjectId, projectId, action }).slice(0, 24)}`,
  };
}

function buildDirectWorkbenchProjectLifecycleReceipt(input = {}) {
  return {
    schema: DIRECT_WORKBENCH_PROJECT_LIFECYCLE_RECEIPT_SCHEMA,
    ok: input.ok === true,
    status: normalizeString(input.status, input.ok === true ? "accepted" : "failed"),
    lifecycleId: normalizeString(input.lifecycleId, ""),
    clientLifecycleId: normalizeString(input.clientLifecycleId, ""),
    action: PROJECT_LIFECYCLE_ACTIONS.has(input.action) ? input.action : "",
    sourceProjectId: normalizeString(input.sourceProjectId, ""),
    projectId: normalizeString(input.projectId, ""),
    reason: normalizeString(input.reason, ""),
    duplicate: input.duplicate === true,
    acceptedAt: normalizeString(input.acceptedAt, ""),
    completedAt: normalizeString(input.completedAt, ""),
    workspaceFilesDeleted: false,
    gitStateDeleted: false,
    threadEvidenceDeleted: false,
    worldManagerStateAffected: false,
  };
}

function resolveDirectWorkbenchProjectLifecycleReplay(operations, authorityProjectId, request = {}) {
  const clientLifecycleId = normalizeString(request.clientLifecycleId, "");
  const existing = clientLifecycleId && operations instanceof Map ? operations.get(clientLifecycleId) : null;
  if (!existing) return null;
  const signature = {
    sourceProjectId: normalizeString(request.sourceProjectId, ""),
    projectId: normalizeString(request.projectId, ""),
    action: normalizeString(request.action, ""),
  };
  if (
    existing.sourceProjectId !== signature.sourceProjectId ||
    existing.projectId !== signature.projectId ||
    existing.action !== signature.action
  ) {
    throw projectDirectoryError("client_lifecycle_id_reused");
  }
  if (normalizeString(authorityProjectId, "") !== existing.sourceProjectId) {
    throw projectDirectoryError("project_binding_source_stale");
  }
  return { ...existing.receipt, duplicate: true };
}

function projectDirectoryError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validateDirectWorkbenchProjectActivation(directory = {}, request = {}) {
  if (directory.schema !== DIRECT_WORKBENCH_PROJECT_DIRECTORY_SCHEMA) {
    throw projectDirectoryError("project_directory_schema_mismatch");
  }
  const clientActivationId = normalizeString(request.clientActivationId, "");
  const sourceProjectId = normalizeString(request.sourceProjectId, "");
  const targetProjectId = normalizeString(request.targetProjectId, "");
  const expectedCatalogRevision = normalizeString(request.expectedCatalogRevision, "");
  if (!clientActivationId) throw projectDirectoryError("client_activation_id_required");
  if (sourceProjectId !== directory.activeProjectId) {
    throw projectDirectoryError("project_activation_source_stale");
  }
  if (!expectedCatalogRevision || expectedCatalogRevision !== directory.catalogRevision) {
    throw projectDirectoryError("project_catalog_revision_stale");
  }
  if (directory.transition?.state === "activating") {
    throw projectDirectoryError("project_activation_in_progress");
  }
  const target = directory.projects.find((row) => row.projectId === targetProjectId);
  if (!target) throw projectDirectoryError("project_activation_target_unknown");
  if (target.selected) throw projectDirectoryError("project_already_active");
  if (!target.selectable) {
    throw projectDirectoryError(target.blockerCodes[0] || "project_activation_blocked");
  }
  return {
    clientActivationId,
    sourceProjectId,
    targetProjectId,
    expectedCatalogRevision,
    activationId: `project_activation_${digest({ clientActivationId, sourceProjectId, targetProjectId }).slice(0, 24)}`,
  };
}

function resolveDirectWorkbenchProjectActivationReplay(operations, authorityProjectId, request = {}) {
  const clientActivationId = normalizeString(request.clientActivationId, "");
  const existing = clientActivationId && operations instanceof Map
    ? operations.get(clientActivationId)
    : null;
  if (!existing) return null;
  const sourceProjectId = normalizeString(request.sourceProjectId, "");
  const targetProjectId = normalizeString(request.targetProjectId, "");
  if (existing.sourceProjectId !== sourceProjectId || existing.targetProjectId !== targetProjectId) {
    throw projectDirectoryError(
      "client_activation_id_reused",
      "The client activation id already belongs to another project transition.",
    );
  }
  const authority = normalizeString(authorityProjectId, "");
  if (authority !== existing.sourceProjectId && authority !== existing.targetProjectId) {
    throw projectDirectoryError(
      "project_activation_source_stale",
      "The activation replay does not belong to the current Direct Workbench project.",
    );
  }
  return { ...existing.receipt, duplicate: true };
}

function buildDirectWorkbenchProjectActivationReceipt(input = {}) {
  return {
    schema: DIRECT_WORKBENCH_PROJECT_ACTIVATION_RECEIPT_SCHEMA,
    ok: input.ok === true,
    status: normalizeString(input.status, input.ok === true ? "accepted" : "failed"),
    activationId: normalizeString(input.activationId, ""),
    clientActivationId: normalizeString(input.clientActivationId, ""),
    sourceProjectId: normalizeString(input.sourceProjectId, ""),
    targetProjectId: normalizeString(input.targetProjectId, ""),
    reason: normalizeString(input.reason, ""),
    duplicate: input.duplicate === true,
    acceptedAt: normalizeString(input.acceptedAt, ""),
    completedAt: normalizeString(input.completedAt, ""),
    rawPathExposed: false,
    rawProviderConfigExposed: false,
    rawAuthExposed: false,
  };
}

function assertNoForbiddenKeys(value, path = "projection") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenKeys(entry, `${path}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_RENDERER_KEYS.has(key)) {
      throw projectDirectoryError("direct_workbench_project_directory_raw_exposure", `${path}.${key}`);
    }
    assertNoForbiddenKeys(entry, `${path}.${key}`);
  }
}

function assertDirectWorkbenchProjectDirectoryRendererSafe(projection = {}) {
  if (projection.schema !== DIRECT_WORKBENCH_PROJECT_DIRECTORY_SCHEMA) {
    throw projectDirectoryError("project_directory_schema_mismatch");
  }
  assertNoForbiddenKeys(projection);
  for (const flag of ["rawPathExposed", "rawProviderConfigExposed", "rawAuthExposed"]) {
    if (projection[flag] !== false) {
      throw projectDirectoryError("direct_workbench_project_directory_raw_exposure", flag);
    }
  }
  return true;
}

module.exports = {
  DIRECT_WORKBENCH_PROJECT_ACTIVATION_RECEIPT_SCHEMA,
  DIRECT_WORKBENCH_PROJECT_BINDING_DRAFT_SCHEMA,
  DIRECT_WORKBENCH_PROJECT_BINDING_RECEIPT_SCHEMA,
  DIRECT_WORKBENCH_PROJECT_DIRECTORY_SCHEMA,
  DIRECT_WORKBENCH_PROJECT_LIFECYCLE_DRAFT_SCHEMA,
  DIRECT_WORKBENCH_PROJECT_LIFECYCLE_RECEIPT_SCHEMA,
  assertDirectWorkbenchProjectDirectoryRendererSafe,
  buildDirectWorkbenchProjectActivationReceipt,
  buildDirectWorkbenchProjectBindingDraft,
  buildDirectWorkbenchProjectBindingReceipt,
  buildDirectWorkbenchProjectDirectory,
  buildDirectWorkbenchProjectLifecycleDraft,
  buildDirectWorkbenchProjectLifecycleReceipt,
  normalizeDirectWorkbenchProjectLifecycleCatalog,
  projectBindingRevision,
  resolveDirectWorkbenchProjectBindingReplay,
  resolveDirectWorkbenchProjectLifecycleReplay,
  resolveDirectWorkbenchProjectActivationReplay,
  validateDirectWorkbenchProjectBindingMutation,
  validateDirectWorkbenchProjectLifecycleMutation,
  validateDirectWorkbenchProjectActivation,
};
