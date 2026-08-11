"use strict";

const crypto = require("node:crypto");

const DIRECT_WORKSPACE_WORKER_CONTRACT_SCHEMA = "direct_workspace_worker_contract@1";
const DIRECT_WORKSPACE_WORKER_CONTEXT_ADMISSION_SCHEMA = "direct_workspace_worker_context_admission@1";
const WORKSPACE_MODE_REASONING_ONLY = "reasoning_only";
const WORKSPACE_MODE_ISOLATED_WORKTREE = "isolated_worktree";
const TOOL_PROFILES = Object.freeze({
  read_only_worker: Object.freeze({
    declaredTools: Object.freeze(["read_file"]),
    workspaceMutationAllowed: false,
  }),
  implementation_worker: Object.freeze({
    declaredTools: Object.freeze(["read_file", "apply_patch", "run_test"]),
    workspaceMutationAllowed: true,
  }),
});

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

function normalizeWorkspaceMode(value) {
  const mode = normalizeString(value, WORKSPACE_MODE_REASONING_ONLY);
  if ([WORKSPACE_MODE_REASONING_ONLY, WORKSPACE_MODE_ISOLATED_WORKTREE].includes(mode)) return mode;
  const error = new Error("workspace_mode must be reasoning_only or isolated_worktree");
  error.code = "direct_workspace_worker_mode_invalid";
  throw error;
}

function normalizeToolProfile(value) {
  const profile = normalizeString(value, "read_only_worker");
  if (TOOL_PROFILES[profile]) return profile;
  const error = new Error("tool_profile must be read_only_worker or implementation_worker");
  error.code = "direct_workspace_worker_tool_profile_invalid";
  throw error;
}

function admittedContextMessages(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .map((message) => ({
      role: normalizeString(message?.role, ""),
      text: normalizeString(message?.text || message?.content, ""),
    }))
    .filter((message) => ["user", "assistant"].includes(message.role) && message.text)
    .slice(-200);
}

function buildWorkspaceWorkerContextAdmission(messages = [], mode = "none") {
  const admitted = admittedContextMessages(messages);
  const record = {
    schema: DIRECT_WORKSPACE_WORKER_CONTEXT_ADMISSION_SCHEMA,
    admissionDecision: admitted.length ? "admit_exact_parent_handoff" : "no_parent_context_admitted",
    contextHandoffMode: normalizeString(mode, admitted.length ? "full" : "none"),
    admittedMessageCount: admitted.length,
    admittedContextDigest: admitted.length
      ? digestFor("direct-workspace-worker-admitted-context@1", admitted)
      : "",
    semanticPromotionPerformed: false,
    rawContextIncluded: false,
  };
  record.admissionDigest = digestFor("direct-workspace-worker-context-admission@1", record);
  return { record, admitted };
}

function publicWorkspaceBinding(binding = {}) {
  const source = isPlainObject(binding) ? binding : {};
  const result = {
    schema: "direct_workspace_worker_binding@1",
    bindingId: normalizeString(source.bindingId, ""),
    bindingDigest: normalizeString(source.bindingDigest, ""),
    projectId: normalizeString(source.projectId, ""),
    workerKey: normalizeString(source.workerKey, ""),
    workspaceKind: normalizeString(source.workspaceKind, ""),
    branch: normalizeString(source.branch, ""),
    baseCommit: normalizeString(source.baseCommit, ""),
    rootEvidenceDigest: normalizeString(source.rootEvidenceDigest, ""),
    retainedAfterCompletion: source.retainedAfterCompletion !== false,
    rawWorkspacePathIncluded: false,
  };
  if (!result.bindingId || !result.bindingDigest || !result.branch || !result.baseCommit || !result.rootEvidenceDigest) {
    const error = new Error("Workspace worker binding evidence is incomplete.");
    error.code = "direct_workspace_worker_binding_incomplete";
    throw error;
  }
  if (!result.branch.startsWith("codex/worker/")) {
    const error = new Error("Workspace worker binding branch is outside the compiled local namespace.");
    error.code = "direct_workspace_worker_branch_outside_namespace";
    throw error;
  }
  return result;
}

function publicTestProfile(profile = {}) {
  if (!profile?.available) return null;
  const result = {
    schema: "direct_workspace_worker_test_profile@1",
    profileId: normalizeString(profile.profileId, ""),
    profileDigest: normalizeString(profile.profileDigest, ""),
    targetsAllowed: profile.targetsAllowed === true,
    available: true,
    rawCommandIncluded: false,
  };
  if (!result.profileId || !result.profileDigest) {
    const error = new Error("Workspace worker test profile evidence is incomplete.");
    error.code = "direct_workspace_worker_test_profile_incomplete";
    throw error;
  }
  return result;
}

function safeWorkspaceExecutionProjection(value = {}) {
  if (!isPlainObject(value) || value.schema !== "direct_workspace_worker_execution@1") {
    const error = new Error("Workspace worker execution projection has an invalid schema.");
    error.code = "direct_workspace_worker_execution_schema_invalid";
    throw error;
  }
  const projection = JSON.parse(JSON.stringify(value));
  const forbiddenKeys = new Set([
    "worktreepath",
    "nativeroot",
    "repopath",
    "localpath",
    "linuxpath",
    "windowspath",
    "command",
    "baseargs",
  ]);
  function inspect(current) {
    if (Array.isArray(current)) {
      for (const entry of current) inspect(entry);
      return;
    }
    if (!isPlainObject(current)) return;
    for (const [key, entry] of Object.entries(current)) {
      if (forbiddenKeys.has(key.toLowerCase())) {
        const error = new Error("Workspace worker execution projection contains a private realization field.");
        error.code = "direct_workspace_worker_execution_private_realization_present";
        throw error;
      }
      if (
        typeof entry === "string" &&
        (/^\//.test(entry) || /^[A-Za-z]:[\\/]/.test(entry) || /^\\\\/.test(entry))
      ) {
        const error = new Error("Workspace worker execution projection contains an absolute native path.");
        error.code = "direct_workspace_worker_execution_native_path_present";
        throw error;
      }
      inspect(entry);
    }
  }
  inspect(projection);
  if (projection.rawWorkspacePathIncluded !== false) {
    const error = new Error("Workspace worker execution projection does not deny raw workspace paths.");
    error.code = "direct_workspace_worker_execution_raw_path_flag_unsafe";
    throw error;
  }
  return projection;
}

function compileWorkspaceWorkerContract(input = {}) {
  const workspaceMode = normalizeWorkspaceMode(input.workspaceMode || input.workspace_mode);
  if (workspaceMode !== WORKSPACE_MODE_ISOLATED_WORKTREE) {
    const error = new Error("Workspace worker contract compilation requires isolated_worktree mode.");
    error.code = "direct_workspace_worker_contract_mode_mismatch";
    throw error;
  }
  const toolProfile = normalizeToolProfile(input.toolProfile || input.tool_profile);
  const profile = TOOL_PROFILES[toolProfile];
  const binding = publicWorkspaceBinding(input.binding);
  const projectId = normalizeString(input.projectId, binding.projectId);
  const childAgentId = normalizeString(input.childAgentId, "");
  if (!projectId || binding.projectId !== projectId) {
    const error = new Error("Workspace worker binding does not belong to the requested project.");
    error.code = "direct_workspace_worker_project_binding_mismatch";
    throw error;
  }
  if (!childAgentId) {
    const error = new Error("Workspace worker contract requires one exact child identity.");
    error.code = "direct_workspace_worker_child_identity_missing";
    throw error;
  }
  const testProfile = publicTestProfile(input.testProfile);
  const context = buildWorkspaceWorkerContextAdmission(
    input.contextMessages,
    input.contextHandoffMode,
  );
  const declaredTools = profile.declaredTools.filter((toolName) => toolName !== "run_test" || testProfile);
  const authority = {
    schema: "direct_workspace_worker_authority@1",
    toolProfile,
    declaredTools,
    workspaceReadAllowed: declaredTools.includes("read_file"),
    workspaceMutationAllowed: declaredTools.includes("apply_patch"),
    boundedTestExecutionAllowed: declaredTools.includes("run_test"),
    arbitraryCommandAllowed: false,
    remoteMutationAllowed: false,
    testProcessIsolationGuaranteed: false,
    testNetworkIsolationGuaranteed: false,
    recursiveSpawnAllowed: false,
    bottomUpMessagingAllowed: false,
    interWorkerWorkspaceAccessAllowed: false,
    childTranscriptPromotionAllowed: false,
  };
  authority.authorityDigest = digestFor("direct-workspace-worker-authority@1", authority);
  const contract = {
    schema: DIRECT_WORKSPACE_WORKER_CONTRACT_SCHEMA,
    contractId: "",
    projectId,
    workThreadId: normalizeString(input.workThreadId, "work_thread_direct_agents"),
    primaryThreadId: normalizeString(input.primaryThreadId, "primary_direct_agent"),
    childAgentId,
    role: normalizeString(input.role, "sub_agent_worker"),
    workspaceMode,
    binding,
    contextAdmission: context.record,
    testProfile,
    authority,
    maxToolSteps: Math.max(1, Math.min(24, Number(input.maxToolSteps || 12) || 12)),
    workspaceBindingFrozen: true,
    contextAdmissionFrozen: true,
    toolAuthorityFrozen: true,
    providerMaySelectNativePath: false,
    providerMaySelectExecutable: false,
    rawWorkspacePathIncluded: false,
    rawPromptIncluded: false,
    rawContextIncluded: false,
  };
  const identityDigest = digestFor("direct-workspace-worker-contract-id@1", contract);
  contract.contractId = `workspace_worker_contract_${identityDigest.slice(7, 31)}`;
  contract.contractDigest = digestFor("direct-workspace-worker-contract@1", contract);
  assertWorkspaceWorkerContractSafe(contract);
  return { contract, admittedContextMessages: context.admitted };
}

function workspaceWorkerToolSchemas(contract = {}) {
  assertWorkspaceWorkerContractSafe(contract);
  const schemas = {
    read_file: {
      type: "function",
      name: "read_file",
      description: "Read one UTF-8 text file from this worker's isolated Git worktree by project-relative path.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Project-relative path inside this worker's worktree." },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
    apply_patch: {
      type: "function",
      name: "apply_patch",
      description: "Apply one Git-style unified diff only to this worker's isolated worktree.",
      parameters: {
        type: "object",
        properties: {
          patch: { type: "string", description: "Git-style unified diff with project-relative paths." },
          summary: { type: "string" },
        },
        required: ["patch"],
        additionalProperties: false,
      },
    },
    run_test: {
      type: "function",
      name: "run_test",
      description: "Run the harness-compiled local test profile. You cannot choose the executable or base command.",
      parameters: {
        type: "object",
        properties: {
          targets: {
            type: "array",
            items: { type: "string" },
            description: "Optional contained test paths when the compiled profile permits targeted tests.",
          },
          timeout_ms: { type: "number", description: "Timeout from 1000 through 120000 milliseconds." },
        },
        additionalProperties: false,
      },
    },
  };
  return contract.authority.declaredTools.map((name) => schemas[name]).filter(Boolean);
}

function workspaceWorkerInstructions(contract = {}) {
  assertWorkspaceWorkerContractSafe(contract);
  return [
    "You are a bounded Direct workspace worker in one isolated Git worktree.",
    "Complete only the delegated task using only the declared tools.",
    "Treat tool results as evidence; do not invent file contents, patch outcomes, or test outcomes.",
    "You cannot select another workspace, execute arbitrary commands, mutate remotes, message other agents, or spawn children.",
    "Request at most one tool call per response. Answer final only when the delegated task is complete or genuinely blocked.",
    `Constitution: ${contract.contractId}. Tool profile: ${contract.authority.toolProfile}.`,
  ].join(" ");
}

function assertWorkspaceWorkerContractSafe(contract = {}) {
  if (!isPlainObject(contract) || contract.schema !== DIRECT_WORKSPACE_WORKER_CONTRACT_SCHEMA) {
    throw new Error("direct_workspace_worker_contract_schema_mismatch");
  }
  if (contract.workspaceMode !== WORKSPACE_MODE_ISOLATED_WORKTREE) {
    throw new Error("direct_workspace_worker_contract_mode_unsafe");
  }
  if (!Array.isArray(contract.authority?.declaredTools) || !contract.authority.declaredTools.length) {
    throw new Error("direct_workspace_worker_contract_tools_missing");
  }
  const allowed = new Set(["read_file", "apply_patch", "run_test"]);
  if (contract.authority.declaredTools.some((name) => !allowed.has(name))) {
    throw new Error("direct_workspace_worker_contract_tool_unsafe");
  }
  for (const flag of [
    "arbitraryCommandAllowed",
    "remoteMutationAllowed",
    "recursiveSpawnAllowed",
    "bottomUpMessagingAllowed",
    "interWorkerWorkspaceAccessAllowed",
    "childTranscriptPromotionAllowed",
  ]) {
    if (contract.authority?.[flag] !== false) throw new Error(`direct_workspace_worker_contract_authority_unsafe:${flag}`);
  }
  for (const flag of [
    "providerMaySelectNativePath",
    "providerMaySelectExecutable",
    "rawWorkspacePathIncluded",
    "rawPromptIncluded",
    "rawContextIncluded",
  ]) {
    if (contract[flag] !== false) throw new Error(`direct_workspace_worker_contract_raw_or_authority_leak:${flag}`);
  }
  if (contract.binding?.rawWorkspacePathIncluded !== false) {
    throw new Error("direct_workspace_worker_binding_raw_path_leak");
  }
  if (Object.prototype.hasOwnProperty.call(contract.binding || {}, "worktreePath")) {
    throw new Error("direct_workspace_worker_binding_private_path_present");
  }
  return true;
}

module.exports = {
  DIRECT_WORKSPACE_WORKER_CONTRACT_SCHEMA,
  DIRECT_WORKSPACE_WORKER_CONTEXT_ADMISSION_SCHEMA,
  TOOL_PROFILES,
  WORKSPACE_MODE_ISOLATED_WORKTREE,
  WORKSPACE_MODE_REASONING_ONLY,
  admittedContextMessages,
  assertWorkspaceWorkerContractSafe,
  buildWorkspaceWorkerContextAdmission,
  compileWorkspaceWorkerContract,
  digestFor,
  normalizeToolProfile,
  normalizeWorkspaceMode,
  publicWorkspaceBinding,
  safeWorkspaceExecutionProjection,
  workspaceWorkerInstructions,
  workspaceWorkerToolSchemas,
};
