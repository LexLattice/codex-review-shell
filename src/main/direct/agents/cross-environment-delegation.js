"use strict";

// Cross-environment delegation: an agent in one Workbench project hands a task
// to a child agent that runs natively in another project, usually in the
// other environment (Windows or a WSL distro). The owner decides which
// projects accept delegated work and up to which Access; a subfolder of an
// accepting project gets its own project, marked as created by delegation.

const path = require("node:path");

const DELEGATION_ACCESS_PROFILES = Object.freeze(["read_only", "workspace", "full_access"]);
const DELEGATION_TARGETS_LIMIT = 24;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeAcceptAccess(value) {
  const text = normalizeString(value, "").toLowerCase().replace(/[\s-]+/g, "_");
  return DELEGATION_ACCESS_PROFILES.includes(text) ? text : "";
}

/**
 * A project's delegation settings, or null when it has none (the default:
 * it accepts no delegated work).
 */
function normalizeProjectDelegation(raw) {
  if (!isPlainObject(raw)) return null;
  const acceptAccess = normalizeAcceptAccess(raw.acceptAccess);
  const createdBy = isPlainObject(raw.createdBy) && normalizeString(raw.createdBy.rootProjectId, "")
    ? {
        rootProjectId: normalizeString(raw.createdBy.rootProjectId, ""),
        fromProjectId: normalizeString(raw.createdBy.fromProjectId, ""),
        fromProjectName: normalizeString(raw.createdBy.fromProjectName, "").slice(0, 160),
        fromThreadId: normalizeString(raw.createdBy.fromThreadId, ""),
        createdAt: normalizeString(raw.createdBy.createdAt, ""),
      }
    : null;
  const includeSubfolders = Boolean(acceptAccess) && raw.includeSubfolders === true;
  if (!acceptAccess && !createdBy) return null;
  return { acceptAccess, includeSubfolders, createdBy };
}

// The lower of two Access profiles; a missing profile counts as read_only.
function lowerAccessProfile(left, right) {
  const rank = (value) => {
    const index = DELEGATION_ACCESS_PROFILES.indexOf(normalizeAcceptAccess(value));
    return index < 0 ? 0 : index;
  };
  return DELEGATION_ACCESS_PROFILES[Math.min(rank(left), rank(right))];
}

function accessLabel(profile) {
  return { read_only: "Read only", workspace: "Workspace", full_access: "Full access" }[profile] || "Off";
}

function projectEnvironment(project = {}) {
  const workspace = isPlainObject(project.workspace) ? project.workspace : {};
  const kind = normalizeString(workspace.kind, "local");
  const distro = kind === "wsl" ? normalizeString(workspace.distro, "") : "";
  const label = kind === "wsl" ? `WSL · ${distro || "default distro"}` : kind === "windows" ? "Windows" : "Local";
  return { kind, distro, label };
}

function projectRoot(project = {}) {
  const workspace = isPlainObject(project.workspace) ? project.workspace : {};
  if (workspace.kind === "wsl") return normalizeString(workspace.linuxPath, "");
  if (workspace.kind === "windows") return normalizeString(workspace.windowsPath, "");
  return normalizeString(workspace.localPath, normalizeString(project.repoPath, ""));
}

// Paths follow the target environment's own rules: Linux paths in WSL,
// Windows paths (case-insensitive) on Windows.
function pathApiFor(kind, hostPlatform = process.platform) {
  if (kind === "windows" || (kind === "local" && hostPlatform === "win32")) return path.win32;
  return path.posix;
}

function normalizeNativeFolder(kind, folder, hostPlatform = process.platform) {
  const text = normalizeString(folder, "");
  if (!text) return "";
  const api = pathApiFor(kind, hostPlatform);
  if (api === path.win32) {
    if (!/^[A-Za-z]:[\\/]/.test(text)) return "";
    return api.normalize(text).replace(/[\\]+$/, (match, offset) => (offset <= 2 ? match : ""));
  }
  if (!text.startsWith("/")) return "";
  const normalized = api.normalize(text);
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
}

function folderRelation(kind, root, folder, hostPlatform = process.platform) {
  const api = pathApiFor(kind, hostPlatform);
  const fold = (value) => (api === path.win32 ? value.toLowerCase() : value);
  const normalizedRoot = normalizeNativeFolder(kind, root, hostPlatform);
  if (!normalizedRoot || !folder) return "outside";
  if (fold(folder) === fold(normalizedRoot)) return "same";
  const prefix = normalizedRoot.endsWith(api.sep) ? normalizedRoot : `${normalizedRoot}${api.sep}`;
  return fold(folder).startsWith(fold(prefix)) ? "inside" : "outside";
}

// Containment on resolved paths: both the accepting project's folder and the
// requested subfolder as the target environment resolves them (symlinks
// followed), so a link inside the project can't point the child elsewhere.
function canonicalFolderWithinRoot(kind, realRoot, realFolder, hostPlatform = process.platform) {
  const folder = normalizeNativeFolder(kind, realFolder, hostPlatform);
  if (!folder) return false;
  return ["same", "inside"].includes(folderRelation(kind, realRoot, folder, hostPlatform));
}

function isDirectToolProject(project = {}) {
  const codex = isPlainObject(project.surfaceBinding?.codex) ? project.surfaceBinding.codex : {};
  const runtimeMode = normalizeString(codex.runtimeMode, "");
  return ["direct", "direct-experimental"].includes(runtimeMode) &&
    normalizeString(codex.directTransport, "") === "live-text" &&
    normalizeString(codex.directTier, "") === "implementation-lane";
}

function activeProjects(projects) {
  return (Array.isArray(projects) ? projects : [])
    .filter((project) => isPlainObject(project) && project.lifecycle?.state !== "archived");
}

/**
 * Projects this source project's agents may delegate to: they accept
 * delegated work, run Direct with tools, and are not the source itself.
 */
function listDelegationTargets(projects, sourceProject = {}) {
  const sourceId = normalizeString(sourceProject?.id, "");
  return activeProjects(projects)
    .filter((project) => normalizeString(project.id, "") !== sourceId)
    .map((project) => ({ project, delegation: normalizeProjectDelegation(project.delegation) }))
    .filter(({ project, delegation }) => delegation?.acceptAccess && isDirectToolProject(project) && projectRoot(project))
    .slice(0, DELEGATION_TARGETS_LIMIT)
    .map(({ project, delegation }) => ({
      projectId: normalizeString(project.id, ""),
      name: normalizeString(project.name, project.id),
      environment: projectEnvironment(project),
      root: projectRoot(project),
      acceptAccess: delegation.acceptAccess,
      includeSubfolders: delegation.includeSubfolders,
      createdByDelegation: Boolean(delegation.createdBy),
    }));
}

function delegationRefusal(code, message) {
  return { ok: false, code, message };
}

/**
 * Resolves a spawn request's target_project and/or target_folder to the
 * project the child runs in. A subfolder without a project of its own
 * returns needsProject; the caller creates it with buildDelegatedProject.
 */
function resolveDelegationTarget(input = {}) {
  const projects = activeProjects(input.projects);
  const sourceProject = isPlainObject(input.sourceProject) ? input.sourceProject : {};
  const hostPlatform = input.hostPlatform || process.platform;
  const targets = listDelegationTargets(projects, sourceProject);
  const requestedProject = normalizeString(input.targetProject, "");
  const requestedFolder = normalizeString(input.targetFolder, "");
  if (!requestedProject && !requestedFolder) {
    return delegationRefusal("direct_delegation_target_missing", "Name a target_project or a target_folder.");
  }
  if (!targets.length) {
    return delegationRefusal("direct_delegation_no_targets", "No project accepts delegated work. The owner can allow it in a project's settings.");
  }
  let target = null;
  if (requestedProject) {
    const lowered = requestedProject.toLowerCase();
    target = targets.find((entry) => entry.projectId === requestedProject) ||
      (() => {
        const byName = targets.filter((entry) => entry.name.toLowerCase() === lowered);
        return byName.length === 1 ? byName[0] : null;
      })();
    if (!target) {
      return delegationRefusal(
        "direct_delegation_target_unknown",
        `No project named "${requestedProject}" accepts delegated work. Targets: ${targets.map((entry) => entry.name).join(", ")}.`,
      );
    }
  }
  if (!requestedFolder) {
    return { ok: true, targetProjectId: target.projectId, target, folder: "", needsProject: false, accessCeiling: target.acceptAccess };
  }
  // A folder: inside the named target, or inside whichever accepting
  // project contains it (the deepest one).
  const candidates = target ? [target] : targets;
  let best = null;
  let folder = "";
  for (const entry of candidates) {
    const normalized = normalizeNativeFolder(entry.environment.kind, requestedFolder, hostPlatform);
    if (!normalized) continue;
    const relation = folderRelation(entry.environment.kind, entry.root, normalized, hostPlatform);
    if (relation === "outside") continue;
    if (!best || entry.root.length > best.entry.root.length) {
      best = { entry, relation };
      folder = normalized;
    }
  }
  if (!best) {
    const where = target ? `inside ${target.name} (${target.root})` : "inside a project that accepts delegated work";
    return delegationRefusal(
      "direct_delegation_folder_outside_targets",
      `target_folder must be an absolute path in the target's environment, ${where}.`,
    );
  }
  if (best.relation === "same") {
    return { ok: true, targetProjectId: best.entry.projectId, target: best.entry, folder: "", needsProject: false, accessCeiling: best.entry.acceptAccess };
  }
  if (!best.entry.includeSubfolders) {
    return delegationRefusal(
      "direct_delegation_subfolders_not_accepted",
      `${best.entry.name} accepts delegated work only in its own folder, not in subfolders.`,
    );
  }
  // A project for exactly that folder decides for itself.
  const api = pathApiFor(best.entry.environment.kind, hostPlatform);
  const fold = (value) => (api === path.win32 ? value.toLowerCase() : value);
  const existing = projects.find((project) => {
    const environment = projectEnvironment(project);
    return environment.kind === best.entry.environment.kind &&
      environment.distro === best.entry.environment.distro &&
      fold(normalizeNativeFolder(environment.kind, projectRoot(project), hostPlatform)) === fold(folder);
  });
  if (existing) {
    const own = targets.find((entry) => entry.projectId === existing.id);
    if (!own) {
      return delegationRefusal(
        "direct_delegation_target_not_accepting",
        `The project for ${folder} (${normalizeString(existing.name, existing.id)}) doesn't accept delegated work.`,
      );
    }
    return { ok: true, targetProjectId: own.projectId, target: own, folder, needsProject: false, accessCeiling: own.acceptAccess };
  }
  return {
    ok: true,
    targetProjectId: "",
    target: best.entry,
    rootProjectId: best.entry.projectId,
    folder,
    needsProject: true,
    accessCeiling: best.entry.acceptAccess,
  };
}

/**
 * The project for a delegated subfolder: same environment and runtime as
 * the enclosing project, its ceiling, no subfolders of its own, and a
 * record of who created it. The caller assigns the id and normalizes.
 */
function buildDelegatedProject(input = {}) {
  const rootProject = isPlainObject(input.rootProject) ? input.rootProject : {};
  const kind = projectEnvironment(rootProject).kind;
  const folder = normalizeString(input.folder, "");
  const api = pathApiFor(kind, input.hostPlatform || process.platform);
  const baseName = api.basename(folder) || folder;
  const workspace = { ...(isPlainObject(rootProject.workspace) ? rootProject.workspace : {}) };
  if (kind === "wsl") workspace.linuxPath = folder;
  else if (kind === "windows") workspace.windowsPath = folder;
  else workspace.localPath = folder;
  workspace.label = `${baseName} (delegated)`;
  const rootDelegation = normalizeProjectDelegation(rootProject.delegation) || {};
  return {
    name: baseName,
    workspace,
    surfaceBinding: {
      ...(isPlainObject(rootProject.surfaceBinding) ? rootProject.surfaceBinding : {}),
      codex: {
        ...(isPlainObject(rootProject.surfaceBinding?.codex) ? rootProject.surfaceBinding.codex : {}),
        model: "",
      },
    },
    delegation: {
      acceptAccess: rootDelegation.acceptAccess || "read_only",
      includeSubfolders: false,
      createdBy: {
        rootProjectId: normalizeString(rootProject.id, ""),
        fromProjectId: normalizeString(input.sourceProject?.id, ""),
        fromProjectName: normalizeString(input.sourceProject?.name, ""),
        fromThreadId: normalizeString(input.sourceThreadId, ""),
        createdAt: normalizeString(input.createdAt, new Date().toISOString()),
      },
    },
  };
}

// Appended to spawn_agent's description each turn so the model knows where
// it can delegate.
function delegationTargetsDescription(targets = []) {
  if (!targets.length) {
    return "No project currently accepts delegated work, so target_project and target_folder are unavailable.";
  }
  const lines = targets.map((target) =>
    `- "${target.name}": ${target.environment.label}, ${target.root}, up to ${accessLabel(target.acceptAccess)}` +
    `${target.includeSubfolders ? ", also any subfolder via target_folder" : ""}`);
  return [
    "To run work natively in another environment, set target_project (and optionally target_folder, an absolute path there) to start a full agent in that project with its own shell and files. Its Access is the lower of yours and the project's limit, it can't delegate further, and wait_agent returns its final message. Targets:",
    ...lines,
  ].join("\n");
}

function composeDelegatedTaskPrompt(input = {}) {
  const from = normalizeString(input.sourceProjectName, "another project");
  const environment = normalizeString(input.sourceEnvironmentLabel, "");
  return [
    `[Delegated task] An agent working in ${from}${environment ? ` (${environment})` : ""} delegated this task to you.`,
    input.folder ? `Work in ${input.folder}.` : "",
    "Your final message is returned to that agent, so end with a concise report of what you did and found.",
    "",
    normalizeString(input.message, ""),
  ].filter((line, index) => line || index === 3).join("\n");
}

module.exports = {
  DELEGATION_ACCESS_PROFILES,
  accessLabel,
  buildDelegatedProject,
  canonicalFolderWithinRoot,
  composeDelegatedTaskPrompt,
  delegationTargetsDescription,
  isDirectToolProject,
  listDelegationTargets,
  lowerAccessProfile,
  normalizeNativeFolder,
  normalizeProjectDelegation,
  projectEnvironment,
  projectRoot,
  resolveDelegationTarget,
};
