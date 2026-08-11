"use strict";

const crypto = require("node:crypto");
const {
  directRuntimePathFromBinding,
  directRuntimePathLabel,
} = require("../runtime/runtime-path-selection");

const DIRECT_WORKBENCH_PROJECT_DIRECTORY_SCHEMA = "direct_workbench_project_directory@1";
const DIRECT_WORKBENCH_PROJECT_ACTIVATION_RECEIPT_SCHEMA = "direct_workbench_project_activation_receipt@1";
const PROJECT_TRANSITION_STATES = new Set(["idle", "activating", "completed", "failed"]);
const WORKSPACE_KINDS = new Set(["wsl", "windows", "local"]);
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
  const rows = projects.map((project) => {
    const projectId = normalizeString(project.id, "");
    const selected = projectId === activeProjectId;
    const targetActiveTurnCount = activeTurnCount(activeTurns, projectId);
    const blockerCodes = [];
    if (!selected && transition.state === "activating") blockerCodes.push("project_activation_in_progress");
    if (!selected && currentActiveTurnCount > 0) blockerCodes.push("active_turn_in_current_project");
    if (!selected && targetActiveTurnCount > 0) blockerCodes.push("active_turn_in_target_project");
    const substrate = substrateProjection(project);
    const runtime = runtimeProjection(project);
    if (!substrate.configured) blockerCodes.push("project_substrate_unknown");
    if (!runtime.configured) blockerCodes.push("project_runtime_unconfigured");
    const activating = transition.state === "activating" && transition.targetProjectId === projectId;
    return {
      projectId,
      displayName: safeLabel(project.name, "Unnamed project"),
      selected,
      state: selected ? "active" : activating ? "activating" : blockerCodes.length ? "blocked" : "available",
      selectable: !selected && !activating && blockerCodes.length === 0,
      blockerCodes: uniqueStrings(blockerCodes),
      activeTurnCount: targetActiveTurnCount,
      substrate,
      runtime,
      restore: restoreProjection(project),
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
      activationAuthorityDigest: activationAuthorityDigest(projectsById.get(row.projectId)),
    })),
  };
  const projection = {
    schema: DIRECT_WORKBENCH_PROJECT_DIRECTORY_SCHEMA,
    generatedAt: normalizeString(options.generatedAt, new Date().toISOString()),
    catalogRevision: digest(revisionInput),
    activeProjectId,
    projectCount: rows.length,
    transition,
    projects: rows,
    authorityBoundary: {
      catalogOwnsActivation: false,
      rendererMayMutateConfig: false,
      rendererMaySupplyWorkspaceLocator: false,
      mainRevalidatesActivation: true,
      worldManagerStateAffected: false,
    },
    rawPathExposed: false,
    rawProviderConfigExposed: false,
    rawAuthExposed: false,
  };
  assertDirectWorkbenchProjectDirectoryRendererSafe(projection);
  return projection;
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
  DIRECT_WORKBENCH_PROJECT_DIRECTORY_SCHEMA,
  assertDirectWorkbenchProjectDirectoryRendererSafe,
  buildDirectWorkbenchProjectActivationReceipt,
  buildDirectWorkbenchProjectDirectory,
  resolveDirectWorkbenchProjectActivationReplay,
  validateDirectWorkbenchProjectActivation,
};
