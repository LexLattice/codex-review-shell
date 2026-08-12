"use strict";

const {
  DIRECT_WORKSPACE_WORKER_DELEGATION_POLICY_REF_SCHEMA,
  REQUESTED_ROLE_PROFILES,
  WORKSPACE_WORKER_TOOLS,
  createWorkspaceParentAuthorityPacket,
  digestFor,
} = require("./workspace-worker-policy-profile");

const DIRECT_WORKSPACE_WORKER_DELEGATION_POLICY_SCHEMA = "direct_workspace_worker_delegation_policy@1";
const DIRECT_WORKSPACE_WORKER_DELEGATION_SOURCE_SCHEMA = "direct_workspace_worker_delegation_source@1";
const DIRECT_WORKSPACE_WORKER_DELEGATION_POLICY_PROVENANCE = "harness_owned_project_worker_delegation_policy";
const harnessOwnedDelegationPolicies = new WeakSet();
const harnessIssuedDelegatedParentAuthorityPackets = new WeakMap();

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function isSafePolicyIdentifier(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalizeString(value, ""));
}

function isSafeScopeIdentifier(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(normalizeString(value, ""));
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function delegationPolicyError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function exactToolArray(value, label) {
  if (!Array.isArray(value)) {
    throw delegationPolicyError("direct_workspace_worker_delegation_policy_invalid", `${label} must be an explicit canonical tool array.`);
  }
  const admitted = new Set(value.map((entry) => normalizeString(entry, "")).filter(Boolean));
  const canonical = WORKSPACE_WORKER_TOOLS.filter((toolName) => admitted.has(toolName));
  if (stableStringify(value) !== stableStringify(canonical)) {
    throw delegationPolicyError("direct_workspace_worker_delegation_policy_invalid", `${label} contains unknown, duplicate, or non-canonical tools.`);
  }
  return canonical;
}

function exactProfileArray(value) {
  if (!Array.isArray(value)) {
    throw delegationPolicyError(
      "direct_workspace_worker_delegation_policy_invalid",
      "allowedToolProfiles must be an explicit canonical profile array.",
    );
  }
  const canonicalOrder = ["read_only_worker", "implementation_worker"];
  const admitted = new Set(value.map((entry) => normalizeString(entry, "")).filter(Boolean));
  const canonical = canonicalOrder.filter((profileId) => admitted.has(profileId));
  if (stableStringify(value) !== stableStringify(canonical)) {
    throw delegationPolicyError(
      "direct_workspace_worker_delegation_policy_invalid",
      "allowedToolProfiles contains unknown, duplicate, or non-canonical profiles.",
    );
  }
  return canonical;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

function policyBaseFromInput(input = {}) {
  const policyId = normalizeString(input.policyId, "");
  const policyRevision = Number(input.policyRevision || 0);
  const projectId = normalizeString(input.projectId, "");
  const workThreadId = normalizeString(input.workThreadId, "");
  const roleLane = normalizeString(input.roleLane, "");
  const issuedAt = normalizeString(input.issuedAt, "");
  const expiresAt = normalizeString(input.expiresAt, "");
  const issuedAtMs = Date.parse(issuedAt);
  const expiresAtMs = Date.parse(expiresAt);
  const sourceId = normalizeString(input.sourceId, "");
  const sourceDigest = normalizeString(input.sourceDigest, "");
  if (
    !isSafePolicyIdentifier(policyId) || !Number.isInteger(policyRevision) || policyRevision < 1 ||
    !isSafeScopeIdentifier(projectId) || !isSafeScopeIdentifier(workThreadId) || roleLane !== "implementation_worker" ||
    !isSafePolicyIdentifier(sourceId) || !/^sha256:[a-f0-9]{64}$/i.test(sourceDigest) ||
    !Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs) || expiresAtMs <= issuedAtMs
  ) {
    throw delegationPolicyError(
      "direct_workspace_worker_delegation_policy_invalid",
      "Delegation policy requires exact identity, scope, implementation role, revision, and validity interval.",
    );
  }
  const allowedToolProfiles = exactProfileArray(input.allowedToolProfiles);
  const allowedTools = exactToolArray(input.allowedTools, "allowedTools");
  const forbiddenTools = exactToolArray(input.forbiddenTools === undefined ? [] : input.forbiddenTools, "forbiddenTools");
  if (allowedTools.some((toolName) => forbiddenTools.includes(toolName))) {
    throw delegationPolicyError(
      "direct_workspace_worker_delegation_policy_invalid",
      "Delegation policy cannot both allow and forbid a tool.",
    );
  }
  const unsafeFlags = [
    "remoteMutationAllowed",
    "arbitraryCommandAllowed",
    "childMessagingAllowed",
    "recursiveSpawnAllowed",
    "providerMaySupplyAuthority",
    "rawWorkspacePathAllowed",
  ];
  if (unsafeFlags.some((key) => input[key] !== false)) {
    throw delegationPolicyError(
      "direct_workspace_worker_delegation_policy_unsafe",
      "Delegation policy must explicitly deny remote mutation, arbitrary commands, child messaging, recursive spawn, provider authority, and raw paths.",
    );
  }
  return {
    schema: DIRECT_WORKSPACE_WORKER_DELEGATION_POLICY_SCHEMA,
    policyId,
    policyRevision,
    status: "active",
    projectId,
    workThreadId,
    roleLane,
    sourceId,
    sourceDigest,
    allowedToolProfiles,
    allowedTools,
    forbiddenTools,
    issuedAt: new Date(issuedAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    authorityProvenance: DIRECT_WORKSPACE_WORKER_DELEGATION_POLICY_PROVENANCE,
    remoteMutationAllowed: false,
    arbitraryCommandAllowed: false,
    childMessagingAllowed: false,
    recursiveSpawnAllowed: false,
    providerMaySupplyAuthority: false,
    rawWorkspacePathAllowed: false,
  };
}

function createWorkspaceWorkerDelegationPolicy(input = {}) {
  const base = policyBaseFromInput(input);
  const policy = deepFreeze({
    ...base,
    policyDigest: digestFor("direct-workspace-worker-delegation-policy@1", base),
  });
  harnessOwnedDelegationPolicies.add(policy);
  return policy;
}

function validateWorkspaceWorkerDelegationPolicy(value, expected = {}) {
  if (!isPlainObject(value) || !harnessOwnedDelegationPolicies.has(value)) {
    throw delegationPolicyError(
      "direct_workspace_worker_delegation_policy_untrusted",
      "Workspace delegation policy must be resolved from a process-owned harness capability.",
    );
  }
  const base = policyBaseFromInput(value);
  if (
    value.schema !== DIRECT_WORKSPACE_WORKER_DELEGATION_POLICY_SCHEMA ||
    value.status !== "active" ||
    value.authorityProvenance !== DIRECT_WORKSPACE_WORKER_DELEGATION_POLICY_PROVENANCE ||
    normalizeString(value.policyDigest, "") !== digestFor("direct-workspace-worker-delegation-policy@1", base)
  ) {
    throw delegationPolicyError(
      "direct_workspace_worker_delegation_policy_invalid",
      "Workspace delegation policy schema, provenance, status, or digest is invalid.",
    );
  }
  const projectId = normalizeString(expected.projectId, "");
  const workThreadId = normalizeString(expected.workThreadId, "");
  const roleLane = normalizeString(expected.roleLane, "implementation_worker");
  const requestedProfileId = normalizeString(expected.requestedProfileId, "");
  if (projectId && value.projectId !== projectId) {
    throw delegationPolicyError("direct_workspace_worker_delegation_policy_project_mismatch", "Delegation policy belongs to another project.");
  }
  if (workThreadId && value.workThreadId !== workThreadId) {
    throw delegationPolicyError("direct_workspace_worker_delegation_policy_work_thread_mismatch", "Delegation policy belongs to another work thread.");
  }
  if (value.roleLane !== roleLane) {
    throw delegationPolicyError("direct_workspace_worker_delegation_policy_role_mismatch", "Delegation policy belongs to another role lane.");
  }
  if (!REQUESTED_ROLE_PROFILES[requestedProfileId] || !value.allowedToolProfiles.includes(requestedProfileId)) {
    throw delegationPolicyError("direct_workspace_worker_delegation_policy_profile_denied", "Requested workspace profile is not delegated by the upstream policy.");
  }
  const nowMs = Number.isFinite(Number(expected.nowMs)) ? Number(expected.nowMs) : Date.now();
  if (nowMs < Date.parse(value.issuedAt) || nowMs >= Date.parse(value.expiresAt)) {
    throw delegationPolicyError("direct_workspace_worker_delegation_policy_stale", "Workspace delegation policy is not currently valid.");
  }
  return value;
}

function delegationPolicyRef(policy) {
  return Object.freeze({
    schema: DIRECT_WORKSPACE_WORKER_DELEGATION_POLICY_REF_SCHEMA,
    policyId: policy.policyId,
    policyRevision: policy.policyRevision,
    policyDigest: policy.policyDigest,
    sourceId: policy.sourceId,
    sourceDigest: policy.sourceDigest,
    issuedAt: policy.issuedAt,
    expiresAt: policy.expiresAt,
    projectId: policy.projectId,
    workThreadId: policy.workThreadId,
    roleLane: policy.roleLane,
  });
}

function validateWorkspaceDelegatedParentAuthorityPacket(packet, expected = {}) {
  const issuance = isPlainObject(packet)
    ? harnessIssuedDelegatedParentAuthorityPackets.get(packet)
    : null;
  if (!issuance) {
    throw delegationPolicyError(
      "direct_workspace_worker_delegation_policy_untrusted",
      "Workspace delegation authority must be issued from the process-owned delegation-policy registry.",
    );
  }
  const admitted = validateWorkspaceWorkerDelegationPolicy(issuance.policy, expected);
  const expectedRef = delegationPolicyRef(admitted);
  if (stableStringify(packet.delegationPolicyRef) !== stableStringify(expectedRef)) {
    throw delegationPolicyError(
      "direct_workspace_worker_delegation_policy_ref_mismatch",
      "Workspace delegation authority does not carry the exact policy reference issued by the registry.",
    );
  }
  return Object.freeze({
    packet,
    policy: admitted,
    delegationPolicyRef: expectedRef,
  });
}

function sourceBaseFromInput(input = {}) {
  const sourceId = normalizeString(input.sourceId, "");
  const sourceRevision = Number(input.sourceRevision || 0);
  const policyId = normalizeString(input.policyId, "");
  const policyRevision = Number(input.policyRevision || 0);
  const projectId = normalizeString(input.projectId, "");
  const workThreadId = normalizeString(input.workThreadId, "");
  const validFrom = normalizeString(input.validFrom, "");
  const validUntil = normalizeString(input.validUntil, "");
  if (
    input.schema !== DIRECT_WORKSPACE_WORKER_DELEGATION_SOURCE_SCHEMA ||
    !isSafePolicyIdentifier(sourceId) || !Number.isInteger(sourceRevision) || sourceRevision < 1 ||
    !isSafePolicyIdentifier(policyId) || !Number.isInteger(policyRevision) || policyRevision < 1 ||
    !isSafeScopeIdentifier(projectId) || !isSafeScopeIdentifier(workThreadId) ||
    input.status !== "admitted" || input.roleLane !== "implementation_worker" ||
    !Number.isFinite(Date.parse(validFrom)) || !Number.isFinite(Date.parse(validUntil)) ||
    Date.parse(validUntil) <= Date.parse(validFrom)
  ) {
    throw delegationPolicyError(
      "direct_workspace_worker_delegation_source_invalid",
      "Workspace delegation source requires exact source, policy, scope, revision, and validity identities.",
    );
  }
  const allowedToolProfiles = exactProfileArray(input.allowedToolProfiles);
  const allowedTools = exactToolArray(input.allowedTools, "allowedTools");
  const forbiddenTools = exactToolArray(input.forbiddenTools === undefined ? [] : input.forbiddenTools, "forbiddenTools");
  if (allowedTools.some((toolName) => forbiddenTools.includes(toolName))) {
    throw delegationPolicyError("direct_workspace_worker_delegation_source_invalid", "Delegation source cannot both allow and forbid a tool.");
  }
  for (const key of [
    "remoteMutationAllowed",
    "arbitraryCommandAllowed",
    "childMessagingAllowed",
    "recursiveSpawnAllowed",
    "providerMaySupplyAuthority",
    "rawWorkspacePathAllowed",
  ]) {
    if (input[key] !== false) {
      throw delegationPolicyError(
        "direct_workspace_worker_delegation_source_unsafe",
        "Harness delegation sources must explicitly deny every non-workspace-worker authority.",
      );
    }
  }
  return {
    schema: DIRECT_WORKSPACE_WORKER_DELEGATION_SOURCE_SCHEMA,
    sourceId,
    sourceRevision,
    status: "admitted",
    policyId,
    policyRevision,
    projectId,
    workThreadId,
    roleLane: "implementation_worker",
    allowedToolProfiles,
    allowedTools,
    forbiddenTools,
    validFrom: new Date(Date.parse(validFrom)).toISOString(),
    validUntil: new Date(Date.parse(validUntil)).toISOString(),
    authorityProvenance: "harness_admitted_worker_delegation_source",
    remoteMutationAllowed: false,
    arbitraryCommandAllowed: false,
    childMessagingAllowed: false,
    recursiveSpawnAllowed: false,
    providerMaySupplyAuthority: false,
    rawWorkspacePathAllowed: false,
  };
}

class WorkspaceWorkerDelegationPolicyRegistry {
  #now;

  #sources;

  constructor(options = {}) {
    this.#now = typeof options.now === "function" ? options.now : Date.now;
    this.#sources = new Map();
    for (const configured of Array.isArray(options.sources) ? options.sources : []) {
      const base = sourceBaseFromInput(configured);
      const source = deepFreeze({
        ...base,
        sourceDigest: digestFor("direct-workspace-worker-delegation-source@1", base),
      });
      const key = `${source.projectId}\0${source.workThreadId}`;
      if (this.#sources.has(key)) {
        throw delegationPolicyError(
          "direct_workspace_worker_delegation_source_conflict",
          "Only one admitted workspace delegation source may own a project/work-thread scope.",
        );
      }
      this.#sources.set(key, source);
    }
    Object.freeze(this);
  }

  resolve(input = {}) {
    const projectId = normalizeString(input.projectId, "");
    const workThreadId = normalizeString(input.workThreadId, "");
    const requestedProfileId = normalizeString(input.requestedProfileId, "");
    if (!isSafeScopeIdentifier(projectId) || !isSafeScopeIdentifier(workThreadId)) {
      throw delegationPolicyError(
        "direct_workspace_worker_delegation_policy_scope_invalid",
        "Workspace delegation resolution requires exact safe project and work-thread identities.",
      );
    }
    const source = this.#sources.get(`${projectId}\0${workThreadId}`);
    if (!source) {
      throw delegationPolicyError(
        "direct_workspace_worker_delegation_policy_missing",
        "No harness-admitted worker delegation source exists for this project and work thread.",
      );
    }
    const nowMs = Number(this.#now());
    if (nowMs < Date.parse(source.validFrom) || nowMs >= Date.parse(source.validUntil)) {
      throw delegationPolicyError(
        "direct_workspace_worker_delegation_policy_stale",
        "The harness-admitted worker delegation source is not currently valid.",
      );
    }
    if (!source.allowedToolProfiles.includes(requestedProfileId)) {
      throw delegationPolicyError(
        "direct_workspace_worker_delegation_policy_profile_denied",
        "The harness-admitted source does not delegate the requested worker profile.",
      );
    }
    const expiresAtMs = Math.min(nowMs + 5 * 60_000, Date.parse(source.validUntil));
    return createWorkspaceWorkerDelegationPolicy({
      policyId: source.policyId,
      policyRevision: source.policyRevision,
      projectId,
      workThreadId,
      roleLane: "implementation_worker",
      sourceId: source.sourceId,
      sourceDigest: source.sourceDigest,
      allowedToolProfiles: source.allowedToolProfiles,
      allowedTools: source.allowedTools,
      forbiddenTools: source.forbiddenTools,
      issuedAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      remoteMutationAllowed: false,
      arbitraryCommandAllowed: false,
      childMessagingAllowed: false,
      recursiveSpawnAllowed: false,
      providerMaySupplyAuthority: false,
      rawWorkspacePathAllowed: false,
    });
  }

  descriptor() {
    return Object.freeze({
      schema: "direct_workspace_worker_delegation_registry_status@1",
      admittedSourceCount: this.#sources.size,
      configured: this.#sources.size > 0,
      rawPolicyIncluded: false,
      rawWorkspacePathIncluded: false,
    });
  }
}

function issueWorkspaceParentAuthorityFromDelegationPolicy(policy, expected = {}) {
  const admitted = validateWorkspaceWorkerDelegationPolicy(policy, expected);
  const packet = createWorkspaceParentAuthorityPacket({
    boundaryId: `workspace_delegation_${admitted.policyId}_${admitted.policyRevision}`,
    upstreamPolicyId: admitted.policyId,
    upstreamAllowedTools: admitted.allowedTools,
    upstreamForbiddenTools: admitted.forbiddenTools,
    allowedTools: admitted.allowedTools,
    forbiddenTools: admitted.forbiddenTools,
    delegationPolicyRef: delegationPolicyRef(admitted),
  });
  harnessIssuedDelegatedParentAuthorityPackets.set(packet, Object.freeze({ policy: admitted }));
  return packet;
}

module.exports = {
  DIRECT_WORKSPACE_WORKER_DELEGATION_POLICY_PROVENANCE,
  DIRECT_WORKSPACE_WORKER_DELEGATION_POLICY_SCHEMA,
  DIRECT_WORKSPACE_WORKER_DELEGATION_SOURCE_SCHEMA,
  WorkspaceWorkerDelegationPolicyRegistry,
  delegationPolicyRef,
  issueWorkspaceParentAuthorityFromDelegationPolicy,
  validateWorkspaceDelegatedParentAuthorityPacket,
  validateWorkspaceWorkerDelegationPolicy,
};
