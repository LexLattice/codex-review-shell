"use strict";

const crypto = require("node:crypto");

const WORKSPACE_WORKER_CLEANUP_PLAN_SCHEMA = "direct_workspace_worker_cleanup_plan@1";
const WORKSPACE_WORKER_CLEANUP_RECEIPT_SCHEMA = "direct_workspace_worker_cleanup_receipt@1";
const WORKSPACE_WORKER_CLEANUP_OBSERVATION_SCHEMA = "direct_workspace_worker_cleanup_observation@1";
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

function buildWorkspaceWorkerCleanupObservation(input = {}) {
  const observation = {
    schema: WORKSPACE_WORKER_CLEANUP_OBSERVATION_SCHEMA,
    observationComplete: input.observationComplete === true,
    workerKey: normalizeString(input.workerKey, ""),
    branchName: normalizeString(input.branchName, ""),
    bindingDigest: normalizeString(input.bindingDigest, ""),
    worktreePathDigest: normalizeString(input.worktreePathDigest, ""),
    worktreeRegistered: input.worktreeRegistered === true,
    processQuiescent: input.processQuiescent === true,
    activeProcessCount: nonNegativeInteger(input.activeProcessCount, -1),
    gitStatusReadSucceeded: input.gitStatusReadSucceeded === true,
    statusEntries: Array.isArray(input.statusEntries) ? input.statusEntries.map((entry) => String(entry)) : [],
    untrackedFileCount: nonNegativeInteger(input.untrackedFileCount, -1),
    headReadSucceeded: input.headReadSucceeded === true,
    headCommit: normalizeString(input.headCommit, ""),
    uniqueWorkReadSucceeded: input.uniqueWorkReadSucceeded === true,
    uniqueCommitCount: nonNegativeInteger(input.uniqueCommitCount, -1),
    conflictState: input.conflictState === false ? false : input.conflictState === true ? true : null,
    gitOperationInProgress: input.gitOperationInProgress === false
      ? false
      : input.gitOperationInProgress === true ? true : null,
    rawWorkspacePathIncluded: false,
  };
  observation.observationDigest = digestFor("direct-workspace-worker-cleanup-observation@1", observation);
  return observation;
}

function assertWorkspaceWorkerCleanupObservationSafe(observation = {}) {
  const rebuilt = buildWorkspaceWorkerCleanupObservation(observation);
  const valid = isPlainObject(observation) &&
    observation.schema === WORKSPACE_WORKER_CLEANUP_OBSERVATION_SCHEMA &&
    observation.observationComplete === true &&
    observation.worktreeRegistered === true &&
    observation.processQuiescent === true &&
    Number.isInteger(observation.activeProcessCount) && observation.activeProcessCount >= 0 &&
    observation.gitStatusReadSucceeded === true &&
    Array.isArray(observation.statusEntries) &&
    observation.statusEntries.every((entry) => typeof entry === "string") &&
    Number.isInteger(observation.untrackedFileCount) && observation.untrackedFileCount >= 0 &&
    observation.headReadSucceeded === true &&
    observation.uniqueWorkReadSucceeded === true &&
    Number.isInteger(observation.uniqueCommitCount) && observation.uniqueCommitCount >= 0 &&
    observation.conflictState === false &&
    observation.gitOperationInProgress === false &&
    /^sha256:[a-f0-9]{64}$/.test(normalizeString(observation.observationDigest, "")) &&
    stableStringify(observation) === stableStringify(rebuilt);
  if (!valid) {
    const error = new Error("direct_workspace_worker_cleanup_observation_invalid");
    error.code = "direct_workspace_worker_cleanup_observation_invalid";
    throw error;
  }
  return observation;
}

function buildWorkspaceWorkerCleanupPlan(input = {}) {
  const session = isPlainObject(input.session) ? input.session : {};
  const observation = isPlainObject(input.observation) ? input.observation : {};
  const binding = isPlainObject(session.binding) ? session.binding : {};
  const blockers = [];
  try {
    assertWorkspaceWorkerCleanupObservationSafe(observation);
  } catch {
    blockers.push("cleanup_observation_invalid");
  }

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
  const statusEntriesValid = Array.isArray(observation.statusEntries);
  const statusEntries = statusEntriesValid ? observation.statusEntries : [];
  if (!statusEntriesValid) blockers.push("cleanup_git_status_entries_invalid");
  if (statusEntries.length > 0) blockers.push("cleanup_worktree_dirty");
  if (observation.headReadSucceeded !== true) blockers.push("cleanup_head_unavailable");
  if (!normalizeString(observation.headCommit, "")) blockers.push("cleanup_head_missing");
  if (binding.headCommit && observation.headCommit !== binding.headCommit) blockers.push("cleanup_head_mismatch");
  if (observation.uniqueWorkReadSucceeded !== true) blockers.push("cleanup_unique_work_unavailable");
  const uniqueCommitCount = nonNegativeInteger(observation.uniqueCommitCount, -1);
  if (uniqueCommitCount !== 0) blockers.push("cleanup_unique_commits_present");
  const untrackedFileCountValid = Number.isInteger(observation.untrackedFileCount) &&
    observation.untrackedFileCount >= 0;
  const untrackedFileCount = untrackedFileCountValid ? observation.untrackedFileCount : -1;
  if (!untrackedFileCountValid || untrackedFileCount !== 0) {
    blockers.push("cleanup_untracked_work_present");
  }
  if (observation.conflictState !== false) blockers.push(
    observation.conflictState === true
      ? "cleanup_conflict_state_present"
      : "cleanup_conflict_state_unavailable",
  );
  if (observation.gitOperationInProgress !== false) blockers.push(
    observation.gitOperationInProgress === true
      ? "cleanup_git_operation_in_progress"
      : "cleanup_git_operation_state_unavailable",
  );

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
    gitStatusVerifiedClean: observation.gitStatusReadSucceeded === true &&
      statusEntriesValid && statusEntries.length === 0 && untrackedFileCount === 0,
    headVerified: observation.headReadSucceeded === true && Boolean(observation.headCommit) &&
      (!binding.headCommit || observation.headCommit === binding.headCommit),
    uniqueWorkVerifiedAbsent: observation.uniqueWorkReadSucceeded === true && uniqueCommitCount === 0,
    rawWorkspacePathIncluded: false,
  };
  plan.planDigest = digestFor("direct-workspace-worker-cleanup-plan@1", plan);
  return plan;
}

function buildWorkspaceWorkerCleanupReceipt(input = {}) {
  const core = {
    schema: WORKSPACE_WORKER_CLEANUP_RECEIPT_SCHEMA,
    sessionId: normalizeString(input.sessionId, ""),
    sessionRevision: nonNegativeInteger(input.sessionRevision, 0),
    bindingDigest: normalizeString(input.bindingDigest, ""),
    planDigest: normalizeString(input.planDigest, ""),
    outcome: normalizeString(input.outcome, "removed"),
    removed: input.removed === true,
    forced: input.forced === true,
    removalMode: normalizeString(input.removalMode, "non_force"),
    branchDeleted: input.branchDeleted === true,
    rawWorkspacePathIncluded: false,
  };
  const receiptId = normalizeString(input.receiptId, `workspace_worker_cleanup_receipt_${digestFor(
    "direct-workspace-worker-cleanup-receipt-id@1",
    core,
  ).slice(7, 31)}`);
  const receipt = { ...core, receiptId };
  receipt.receiptDigest = digestFor("direct-workspace-worker-cleanup-receipt@1", receipt);
  return receipt;
}

function assertWorkspaceWorkerCleanupReceiptSafe(receipt = {}) {
  if (!isPlainObject(receipt) || receipt.schema !== WORKSPACE_WORKER_CLEANUP_RECEIPT_SCHEMA) {
    const error = new Error("direct_workspace_worker_cleanup_receipt_schema_invalid");
    error.code = "direct_workspace_worker_cleanup_receipt_schema_invalid";
    throw error;
  }
  const rebuilt = buildWorkspaceWorkerCleanupReceipt(receipt);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(rebuilt.receiptId) ||
    !rebuilt.sessionId ||
    rebuilt.sessionRevision < 1 ||
    !rebuilt.bindingDigest ||
    !rebuilt.planDigest ||
    rebuilt.outcome !== "removed" ||
    rebuilt.removed !== true ||
    rebuilt.forced !== false ||
    rebuilt.removalMode !== "non_force" ||
    rebuilt.rawWorkspacePathIncluded !== false ||
    stableStringify(receipt) !== stableStringify(rebuilt)
  ) {
    const error = new Error("direct_workspace_worker_cleanup_receipt_unsafe");
    error.code = "direct_workspace_worker_cleanup_receipt_unsafe";
    throw error;
  }
  return receipt;
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
  WORKSPACE_WORKER_CLEANUP_OBSERVATION_SCHEMA,
  WORKSPACE_WORKER_CLEANUP_RECEIPT_SCHEMA,
  assertWorkspaceWorkerCleanupPlanSafe,
  assertWorkspaceWorkerCleanupObservationSafe,
  assertWorkspaceWorkerCleanupReceiptSafe,
  buildWorkspaceWorkerCleanupPlan,
  buildWorkspaceWorkerCleanupObservation,
  buildWorkspaceWorkerCleanupReceipt,
};
