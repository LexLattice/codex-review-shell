"use strict";

const crypto = require("node:crypto");

const WORKSPACE_WORKER_CLEANUP_PLAN_SCHEMA = "direct_workspace_worker_cleanup_plan@1";
const CLEANUP_SOURCE_STATES = new Set(["completed", "failed", "cancelled", "cleanup_eligible"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function digestFor(domain, value) {
  return `sha256:${crypto.createHash("sha256").update(`${domain}\0${stableStringify(value)}`).digest("hex")}`;
}

function nonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function buildWorkspaceWorkerCleanupPlan(input = {}) {
  const session = isPlainObject(input.session) ? input.session : {};
  const observation = isPlainObject(input.observation) ? input.observation : {};
  const binding = isPlainObject(session.binding) ? session.binding : {};
  const blockers = [];

  if (!normalizeString(session.sessionId, "")) blockers.push("cleanup_session_missing");
  if (!CLEANUP_SOURCE_STATES.has(session.state)) blockers.push("cleanup_session_not_terminal");
  if (session.leaseState !== "released") blockers.push("cleanup_lease_not_released");
  if (session.processState !== "quiescent") blockers.push("cleanup_process_not_quiescent");
  if (!binding.bindingDigest) blockers.push("cleanup_binding_missing");

  if (observation.observationComplete !== true) blockers.push("cleanup_observation_incomplete");
  if (!normalizeString(observation.observationDigest, "")) blockers.push("cleanup_observation_digest_missing");
  if (observation.workerKey !== binding.workerKey) blockers.push("cleanup_worker_key_mismatch");
  if (observation.branchName !== binding.branchName) blockers.push("cleanup_branch_mismatch");
  if (observation.bindingDigest !== binding.bindingDigest) blockers.push("cleanup_binding_digest_mismatch");
  if (observation.worktreePathDigest !== binding.worktreePathDigest) blockers.push("cleanup_worktree_path_digest_mismatch");
  if (observation.worktreeRegistered !== true) blockers.push("cleanup_worktree_not_registered");

  const activeProcessCount = nonNegativeInteger(observation.activeProcessCount, -1);
  if (observation.processQuiescent !== true || activeProcessCount !== 0) {
    blockers.push("cleanup_process_observation_not_quiescent");
  }
  if (observation.gitStatusReadSucceeded !== true) blockers.push("cleanup_git_status_unavailable");
  const statusEntries = Array.isArray(observation.statusEntries) ? observation.statusEntries : [];
  if (statusEntries.length > 0) blockers.push("cleanup_worktree_dirty");
  if (observation.headReadSucceeded !== true) blockers.push("cleanup_head_unavailable");
  if (!normalizeString(observation.headCommit, "")) blockers.push("cleanup_head_missing");
  if (binding.headCommit && observation.headCommit !== binding.headCommit) blockers.push("cleanup_head_mismatch");
  if (observation.uniqueWorkReadSucceeded !== true) blockers.push("cleanup_unique_work_unavailable");
  const uniqueCommitCount = nonNegativeInteger(observation.uniqueCommitCount, -1);
  if (uniqueCommitCount !== 0) blockers.push("cleanup_unique_commits_present");
  if (observation.untrackedFileCount !== undefined && nonNegativeInteger(observation.untrackedFileCount, -1) !== 0) {
    blockers.push("cleanup_untracked_work_present");
  }
  if (observation.conflictState === true) blockers.push("cleanup_conflict_state_present");
  if (observation.gitOperationInProgress === true) blockers.push("cleanup_git_operation_in_progress");

  const uniqueBlockers = [...new Set(blockers)];
  const plan = {
    schema: WORKSPACE_WORKER_CLEANUP_PLAN_SCHEMA,
    planId: `workspace_worker_cleanup_${digestFor("direct-workspace-worker-cleanup-id@1", {
      sessionId: session.sessionId,
      sessionRevision: session.revision,
      observationDigest: observation.observationDigest,
    }).slice(7, 31)}`,
    sessionId: normalizeString(session.sessionId, ""),
    leaseId: normalizeString(session.leaseId, ""),
    sessionRevision: nonNegativeInteger(session.revision, 0),
    bindingDigest: normalizeString(binding.bindingDigest, ""),
    observationDigest: normalizeString(observation.observationDigest, ""),
    action: uniqueBlockers.length ? "retain_workspace" : "remove_clean_worktree",
    canRemove: uniqueBlockers.length === 0,
    blockerCodes: uniqueBlockers,
    dryRun: true,
    forceRemovalAllowed: false,
    branchDeletionAllowed: uniqueBlockers.length === 0,
    workspaceMutationStarted: false,
    processQuiescenceVerified: observation.processQuiescent === true && activeProcessCount === 0,
    bindingVerified: Boolean(binding.bindingDigest) &&
      observation.bindingDigest === binding.bindingDigest &&
      observation.workerKey === binding.workerKey &&
      observation.branchName === binding.branchName &&
      observation.worktreePathDigest === binding.worktreePathDigest,
    gitStatusVerifiedClean: observation.gitStatusReadSucceeded === true && statusEntries.length === 0,
    headVerified: observation.headReadSucceeded === true && Boolean(observation.headCommit) &&
      (!binding.headCommit || observation.headCommit === binding.headCommit),
    uniqueWorkVerifiedAbsent: observation.uniqueWorkReadSucceeded === true && uniqueCommitCount === 0,
    rawWorkspacePathIncluded: false,
  };
  plan.planDigest = digestFor("direct-workspace-worker-cleanup-plan@1", plan);
  return plan;
}

function assertWorkspaceWorkerCleanupPlanSafe(plan = {}) {
  if (plan.schema !== WORKSPACE_WORKER_CLEANUP_PLAN_SCHEMA) {
    const error = new Error("direct_workspace_worker_cleanup_plan_schema_invalid");
    error.code = "direct_workspace_worker_cleanup_plan_schema_invalid";
    throw error;
  }
  if (plan.forceRemovalAllowed !== false || plan.dryRun !== true || plan.workspaceMutationStarted !== false) {
    const error = new Error("direct_workspace_worker_cleanup_plan_authority_leak");
    error.code = "direct_workspace_worker_cleanup_plan_authority_leak";
    throw error;
  }
  if (plan.canRemove && (
    plan.blockerCodes.length ||
    !plan.processQuiescenceVerified ||
    !plan.bindingVerified ||
    !plan.gitStatusVerifiedClean ||
    !plan.headVerified ||
    !plan.uniqueWorkVerifiedAbsent
  )) {
    const error = new Error("direct_workspace_worker_cleanup_plan_unsafe_allow");
    error.code = "direct_workspace_worker_cleanup_plan_unsafe_allow";
    throw error;
  }
  const copy = { ...plan };
  delete copy.planDigest;
  if (plan.planDigest !== digestFor("direct-workspace-worker-cleanup-plan@1", copy)) {
    const error = new Error("direct_workspace_worker_cleanup_plan_digest_invalid");
    error.code = "direct_workspace_worker_cleanup_plan_digest_invalid";
    throw error;
  }
  return plan;
}

module.exports = {
  CLEANUP_SOURCE_STATES,
  WORKSPACE_WORKER_CLEANUP_PLAN_SCHEMA,
  assertWorkspaceWorkerCleanupPlanSafe,
  buildWorkspaceWorkerCleanupPlan,
};
