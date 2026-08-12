"use strict";

const {
  REQUESTED_ROLE_PROFILES,
  WORKSPACE_WORKER_TOOLS,
  compileWorkspaceWorkerPolicy,
  digestFor,
  parentAuthorityBoundaryFromPacket,
} = require("./workspace-worker-policy-profile");
const {
  repositoryToolSchemas,
} = require("./workspace-worker-repository-tools");

const DIRECT_WORKSPACE_WORKER_CONTRACT_SCHEMA = "direct_workspace_worker_contract@1";
const DIRECT_WORKSPACE_WORKER_CONTEXT_ADMISSION_SCHEMA = "direct_workspace_worker_context_admission@1";
const WORKSPACE_MODE_REASONING_ONLY = "reasoning_only";
const WORKSPACE_MODE_ISOLATED_WORKTREE = "isolated_worktree";
const TOOL_PROFILES = REQUESTED_ROLE_PROFILES;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
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
    sourceRepositoryDigest: normalizeString(source.sourceRepositoryDigest, ""),
    retainedAfterCompletion: source.retainedAfterCompletion !== false,
    rawWorkspacePathIncluded: false,
  };
  if (
    !result.bindingId ||
    !result.bindingDigest ||
    !result.branch ||
    !result.baseCommit ||
    !result.rootEvidenceDigest ||
    !result.sourceRepositoryDigest
  ) {
    const error = new Error("Workspace worker binding evidence is incomplete.");
    error.code = "direct_workspace_worker_binding_incomplete";
    throw error;
  }
  if (
    !/^sha256:[a-f0-9]{64}$/i.test(result.bindingDigest) ||
    !/^sha256:[a-f0-9]{64}$/i.test(result.rootEvidenceDigest) ||
    !/^sha256:[a-f0-9]{64}$/i.test(result.sourceRepositoryDigest) ||
    !/^[a-f0-9]{40,64}$/i.test(result.baseCommit)
  ) {
    const error = new Error("Workspace worker binding digests or base commit are malformed.");
    error.code = "direct_workspace_worker_binding_evidence_invalid";
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
  const actionsAllowed = (Array.isArray(profile.actionsAllowed) ? profile.actionsAllowed : [])
    .map((entry) => normalizeString(entry, ""))
    .filter(Boolean)
    .slice(0, 12);
  const result = {
    schema: "direct_workspace_worker_test_profile@1",
    profileId: normalizeString(profile.profileId, ""),
    profileDigest: normalizeString(profile.profileDigest, ""),
    targetsAllowed: profile.targetsAllowed === true,
    actionsAllowed,
    defaultAction: normalizeString(profile.defaultAction, actionsAllowed[0] || "test"),
    targetedAction: normalizeString(profile.targetedAction, ""),
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
  function containsNativePath(entry) {
    const candidates = [entry];
    for (let index = 0; index < 2; index += 1) {
      try {
        const decoded = decodeURIComponent(candidates.at(-1));
        if (decoded === candidates.at(-1)) break;
        candidates.push(decoded);
      } catch {
        break;
      }
    }
    return candidates.some((candidate) => {
      const text = candidate.trim();
      return /^\//.test(text) ||
        /^[A-Za-z]:[\\/]/.test(text) ||
        /^\\\\/.test(text) ||
        /^file:/i.test(text);
    });
  }
  function inspect(current) {
    if (typeof current === "string") {
      if (containsNativePath(current)) {
        const error = new Error("Workspace worker execution projection contains an absolute native path.");
        error.code = "direct_workspace_worker_execution_native_path_present";
        throw error;
      }
      return;
    }
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
  const parentAuthority = input.parentAuthorityPacket
    ? parentAuthorityBoundaryFromPacket(input.parentAuthorityPacket)
    : undefined;
  if (parentAuthority?.delegationPolicyRef && (
    parentAuthority.delegationPolicyRef.projectId !== projectId ||
    parentAuthority.delegationPolicyRef.workThreadId !== normalizeString(input.workThreadId, "work_thread_direct_agents")
  )) {
    const error = new Error("Workspace delegation policy does not match the contract project/work-thread scope.");
    error.code = "direct_workspace_worker_delegation_policy_scope_mismatch";
    throw error;
  }
  if (parentAuthority?.delegationPolicyRef && (
    Date.now() < Date.parse(parentAuthority.delegationPolicyRef.issuedAt) ||
    Date.now() >= Date.parse(parentAuthority.delegationPolicyRef.expiresAt)
  )) {
    const error = new Error("Workspace delegation policy expired before contract compilation.");
    error.code = "direct_workspace_worker_delegation_policy_stale";
    throw error;
  }
  const compiledPolicy = compileWorkspaceWorkerPolicy({
    requestedProfileId: toolProfile,
    parentAuthority,
    repositoryPolicy: input.repositoryPolicy || input.testProfile?.repositoryPolicy,
    substrateCapabilities: input.substrateCapabilities || input.testProfile?.substrateCapabilities,
    testProfile: input.testProfile,
  });
  const testProfile = compiledPolicy.declaredTools.includes("run_test")
    ? publicTestProfile(input.testProfile)
    : null;
  const context = buildWorkspaceWorkerContextAdmission(
    input.contextMessages,
    input.contextHandoffMode,
  );
  const declaredTools = [...compiledPolicy.declaredTools];
  const authority = {
    schema: "direct_workspace_worker_authority@1",
    toolProfile,
    requestedToolProfileAdvisory: true,
    declaredTools,
    repositoryInspectionAllowed: declaredTools.includes("inspect_repository"),
    workspaceReadAllowed: declaredTools.some((toolName) => ["read_file", "list_files", "match_files", "search_text"].includes(toolName)),
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
    workspaceWorkerDelegationPolicyRef: parentAuthority?.delegationPolicyRef
      ? { ...parentAuthority.delegationPolicyRef }
      : null,
    binding,
    contextAdmission: context.record,
    repositoryPolicy: compiledPolicy.repositoryPolicy,
    policyCompilation: compiledPolicy.compilation,
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
    ...repositoryToolSchemas(),
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
          action: {
            type: "string",
            enum: contract.testProfile?.actionsAllowed?.length ? contract.testProfile.actionsAllowed : undefined,
            description: "One action admitted by the pinned repository test profile.",
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
  const inherited = contract.repositoryPolicy.selectedConstraints.length
    ? ` Inherited repository constraints: ${contract.repositoryPolicy.selectedConstraints.join(" ")}`
    : "";
  return [
    "You are a bounded Direct workspace worker in one isolated Git worktree.",
    "Complete only the delegated task using only the declared tools.",
    "Treat tool results as evidence; do not invent file contents, patch outcomes, or test outcomes.",
    "Repository discovery and reads are limited to the Git-canonical tracked/non-ignored-untracked manifest. Never infer omitted, ignored, sensitive, binary, symlinked, or Git-metadata content.",
    "You cannot select another workspace, execute arbitrary commands, mutate remotes, message upstream or other agents, request human input, or spawn children.",
    "Request at most one tool call per response. Answer final only when the delegated task is complete or genuinely blocked.",
    `Constitution: ${contract.contractId}. Requested tool profile is advisory: ${contract.authority.toolProfile}. Compiled tools: ${contract.authority.declaredTools.join(", ")}.${inherited}`,
  ].join(" ");
}

function assertWorkspaceWorkerContractSafe(contract = {}) {
  if (!isPlainObject(contract) || contract.schema !== DIRECT_WORKSPACE_WORKER_CONTRACT_SCHEMA) {
    throw new Error("direct_workspace_worker_contract_schema_mismatch");
  }
  if (contract.workspaceMode !== WORKSPACE_MODE_ISOLATED_WORKTREE) {
    throw new Error("direct_workspace_worker_contract_mode_unsafe");
  }
  if (!Array.isArray(contract.authority?.declaredTools)) {
    throw new Error("direct_workspace_worker_contract_tools_missing");
  }
  const allowed = new Set(WORKSPACE_WORKER_TOOLS);
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
  const delegationRef = contract.workspaceWorkerDelegationPolicyRef;
  if (delegationRef && (
    delegationRef.schema !== "direct_workspace_worker_delegation_policy_ref@1" ||
    !/^sha256:[a-f0-9]{64}$/i.test(normalizeString(delegationRef.policyDigest, "")) ||
    !/^sha256:[a-f0-9]{64}$/i.test(normalizeString(delegationRef.sourceDigest, "")) ||
    delegationRef.projectId !== contract.projectId ||
    delegationRef.workThreadId !== contract.workThreadId ||
    delegationRef.roleLane !== "implementation_worker"
  )) {
    throw new Error("direct_workspace_worker_delegation_policy_ref_unsafe");
  }
  if (Object.prototype.hasOwnProperty.call(contract.binding || {}, "worktreePath")) {
    throw new Error("direct_workspace_worker_binding_private_path_present");
  }
  if (contract.authority?.requestedToolProfileAdvisory !== true || contract.policyCompilation?.requestedProfileAdvisory !== true) {
    throw new Error("direct_workspace_worker_requested_profile_not_advisory");
  }
  if (contract.policyCompilation?.wideningPerformed !== false) {
    throw new Error("direct_workspace_worker_policy_widening_detected");
  }
  if (
    JSON.stringify(contract.policyCompilation?.declaredTools || []) !==
    JSON.stringify(contract.authority.declaredTools)
  ) {
    throw new Error("direct_workspace_worker_policy_authority_mismatch");
  }
  if (contract.repositoryPolicy?.rawPolicyTextIncluded !== false || contract.repositoryPolicy?.rawWorkspacePathIncluded !== false) {
    throw new Error("direct_workspace_worker_repository_policy_raw_evidence_leak");
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
