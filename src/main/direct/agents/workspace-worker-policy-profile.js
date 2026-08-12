"use strict";

const crypto = require("node:crypto");
const arcagi3Profile = require("../epistemic/profiles/arcagi3-odeu-local.v1.json");

const DIRECT_WORKSPACE_WORKER_POLICY_SCHEMA = "direct_workspace_worker_policy@1";
const DIRECT_WORKSPACE_WORKER_POLICY_COMPILATION_SCHEMA = "direct_workspace_worker_policy_compilation@1";
const DIRECT_WORKSPACE_PARENT_AUTHORITY_PACKET_SCHEMA = "direct_workspace_parent_authority_packet@1";
const DIRECT_WORKSPACE_UPSTREAM_TOOL_POLICY_SCHEMA = "direct_workspace_upstream_tool_policy@1";
const DIRECT_WORKSPACE_WORKER_DELEGATION_POLICY_REF_SCHEMA = "direct_workspace_worker_delegation_policy_ref@1";
const WORKSPACE_PARENT_AUTHORITY_PROVENANCE = "harness_owned_upstream_authority_packet";
const WORKSPACE_UPSTREAM_TOOL_POLICY_PROVENANCE = "harness_owned_upstream_tool_policy";
const harnessOwnedParentAuthorityPackets = new WeakSet();

const REPOSITORY_READ_TOOLS = Object.freeze([
  "inspect_repository",
  "list_files",
  "match_files",
  "search_text",
  "read_file",
]);
const WORKSPACE_WORKER_TOOLS = Object.freeze([
  ...REPOSITORY_READ_TOOLS,
  "apply_patch",
  "run_test",
]);
const REQUESTED_ROLE_PROFILES = Object.freeze({
  read_only_worker: Object.freeze({
    requestedTools: REPOSITORY_READ_TOOLS,
    declaredTools: REPOSITORY_READ_TOOLS,
    workspaceMutationRequested: false,
    workspaceMutationAllowed: false,
  }),
  implementation_worker: Object.freeze({
    requestedTools: WORKSPACE_WORKER_TOOLS,
    declaredTools: WORKSPACE_WORKER_TOOLS,
    workspaceMutationRequested: true,
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

function sortedToolSet(value, fallback = []) {
  const source = Array.isArray(value) ? value : fallback;
  const admitted = new Set(source.map((entry) => normalizeString(entry, "")).filter(Boolean));
  return WORKSPACE_WORKER_TOOLS.filter((toolName) => admitted.has(toolName));
}

function workspaceAuthorityError(message) {
  const error = new Error(message);
  error.code = "direct_workspace_parent_authority_invalid";
  return error;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

function exactToolArray(value, label) {
  if (!Array.isArray(value)) {
    throw workspaceAuthorityError(`${label} must be one explicit canonical tool array.`);
  }
  const canonical = sortedToolSet(value, []);
  if (stableStringify(value) !== stableStringify(canonical)) {
    throw workspaceAuthorityError(`${label} contains unknown, duplicate, or non-canonical tools.`);
  }
  return canonical;
}

function createWorkspaceParentAuthorityPacket(input = {}) {
  const boundaryId = normalizeString(input.boundaryId, "");
  const upstreamPolicyId = normalizeString(input.upstreamPolicyId, "");
  if (!boundaryId || !upstreamPolicyId || !Array.isArray(input.upstreamAllowedTools)) {
    throw workspaceAuthorityError(
      "Harness authority issuance requires explicit boundary identity, upstream policy identity, and canonical upstream tools.",
    );
  }
  const upstreamAllowedTools = exactToolArray(input.upstreamAllowedTools, "upstreamAllowedTools");
  const upstreamForbiddenTools = input.upstreamForbiddenTools === undefined
    ? []
    : exactToolArray(input.upstreamForbiddenTools, "upstreamForbiddenTools");
  const upstreamPolicyBase = {
    schema: DIRECT_WORKSPACE_UPSTREAM_TOOL_POLICY_SCHEMA,
    policyId: upstreamPolicyId,
    allowedTools: upstreamAllowedTools.filter((toolName) => !upstreamForbiddenTools.includes(toolName)),
    forbiddenTools: upstreamForbiddenTools,
    authorityProvenance: WORKSPACE_UPSTREAM_TOOL_POLICY_PROVENANCE,
  };
  const upstreamToolPolicy = {
    ...upstreamPolicyBase,
    policyDigest: digestFor("direct-workspace-upstream-tool-policy@1", upstreamPolicyBase),
  };
  const requestedAllowedTools = sortedToolSet(input.allowedTools, upstreamToolPolicy.allowedTools);
  const forbiddenTools = sortedToolSet(input.forbiddenTools, []);
  const delegationPolicyRef = isPlainObject(input.delegationPolicyRef)
    ? {
        schema: normalizeString(input.delegationPolicyRef.schema, ""),
        policyId: normalizeString(input.delegationPolicyRef.policyId, ""),
        policyRevision: Number(input.delegationPolicyRef.policyRevision || 0),
        policyDigest: normalizeString(input.delegationPolicyRef.policyDigest, ""),
        sourceId: normalizeString(input.delegationPolicyRef.sourceId, ""),
        sourceDigest: normalizeString(input.delegationPolicyRef.sourceDigest, ""),
        issuedAt: normalizeString(input.delegationPolicyRef.issuedAt, ""),
        expiresAt: normalizeString(input.delegationPolicyRef.expiresAt, ""),
        projectId: normalizeString(input.delegationPolicyRef.projectId, ""),
        workThreadId: normalizeString(input.delegationPolicyRef.workThreadId, ""),
        roleLane: normalizeString(input.delegationPolicyRef.roleLane, ""),
      }
    : null;
  if (delegationPolicyRef && (
    delegationPolicyRef.schema !== DIRECT_WORKSPACE_WORKER_DELEGATION_POLICY_REF_SCHEMA ||
    !delegationPolicyRef.policyId ||
    !Number.isInteger(delegationPolicyRef.policyRevision) || delegationPolicyRef.policyRevision < 1 ||
    !/^sha256:[a-f0-9]{64}$/i.test(delegationPolicyRef.policyDigest) ||
    !delegationPolicyRef.sourceId ||
    !/^sha256:[a-f0-9]{64}$/i.test(delegationPolicyRef.sourceDigest) ||
    !Number.isFinite(Date.parse(delegationPolicyRef.issuedAt)) ||
    !Number.isFinite(Date.parse(delegationPolicyRef.expiresAt)) ||
    Date.parse(delegationPolicyRef.expiresAt) <= Date.parse(delegationPolicyRef.issuedAt) ||
    !delegationPolicyRef.projectId ||
    !delegationPolicyRef.workThreadId ||
    delegationPolicyRef.roleLane !== "implementation_worker"
  )) {
    throw workspaceAuthorityError("Workspace parent authority has an invalid delegation-policy reference.");
  }
  const boundaryBase = {
    schema: DIRECT_WORKSPACE_PARENT_AUTHORITY_PACKET_SCHEMA,
    boundaryId,
    allowedTools: requestedAllowedTools.filter((toolName) =>
      upstreamToolPolicy.allowedTools.includes(toolName) &&
      !upstreamToolPolicy.forbiddenTools.includes(toolName) &&
      !forbiddenTools.includes(toolName)),
    forbiddenTools,
    authorityProvenance: WORKSPACE_PARENT_AUTHORITY_PROVENANCE,
    upstreamToolPolicy,
    ...(delegationPolicyRef ? { delegationPolicyRef } : {}),
  };
  const packet = deepFreeze({
    ...boundaryBase,
    boundaryDigest: digestFor("direct-workspace-parent-authority-packet@1", boundaryBase),
  });
  harnessOwnedParentAuthorityPackets.add(packet);
  return packet;
}

function validateWorkspaceParentAuthorityPacket(value) {
  if (!isPlainObject(value)) {
    throw workspaceAuthorityError("Workspace launch requires one harness-owned parent authority packet.");
  }
  if (!harnessOwnedParentAuthorityPackets.has(value)) {
    throw workspaceAuthorityError("Workspace parent authority was reconstructed from an untrusted caller object.");
  }
  if (
    value.schema !== DIRECT_WORKSPACE_PARENT_AUTHORITY_PACKET_SCHEMA ||
    value.authorityProvenance !== WORKSPACE_PARENT_AUTHORITY_PROVENANCE
  ) {
    throw workspaceAuthorityError("Workspace parent authority schema or provenance is invalid.");
  }
  const boundaryId = normalizeString(value.boundaryId, "");
  if (!boundaryId) throw workspaceAuthorityError("Workspace parent authority boundary id is missing.");
  const upstream = value.upstreamToolPolicy;
  if (
    !isPlainObject(upstream) ||
    upstream.schema !== DIRECT_WORKSPACE_UPSTREAM_TOOL_POLICY_SCHEMA ||
    upstream.authorityProvenance !== WORKSPACE_UPSTREAM_TOOL_POLICY_PROVENANCE
  ) {
    throw workspaceAuthorityError("Workspace parent authority has no valid upstream tool policy.");
  }
  const upstreamPolicyId = normalizeString(upstream.policyId, "");
  if (!upstreamPolicyId) throw workspaceAuthorityError("Workspace upstream tool policy id is missing.");
  const upstreamAllowedTools = exactToolArray(upstream.allowedTools, "upstreamToolPolicy.allowedTools");
  const upstreamForbiddenTools = exactToolArray(upstream.forbiddenTools, "upstreamToolPolicy.forbiddenTools");
  if (upstreamAllowedTools.some((toolName) => upstreamForbiddenTools.includes(toolName))) {
    throw workspaceAuthorityError("Workspace upstream tool policy grants and forbids the same tool.");
  }
  const upstreamPolicyBase = {
    schema: DIRECT_WORKSPACE_UPSTREAM_TOOL_POLICY_SCHEMA,
    policyId: upstreamPolicyId,
    allowedTools: upstreamAllowedTools,
    forbiddenTools: upstreamForbiddenTools,
    authorityProvenance: WORKSPACE_UPSTREAM_TOOL_POLICY_PROVENANCE,
  };
  const expectedPolicyDigest = digestFor("direct-workspace-upstream-tool-policy@1", upstreamPolicyBase);
  if (normalizeString(upstream.policyDigest, "") !== expectedPolicyDigest) {
    throw workspaceAuthorityError("Workspace upstream tool policy digest is invalid.");
  }
  const allowedTools = exactToolArray(value.allowedTools, "parentAuthority.allowedTools");
  const forbiddenTools = exactToolArray(value.forbiddenTools, "parentAuthority.forbiddenTools");
  if (allowedTools.some((toolName) =>
    !upstreamAllowedTools.includes(toolName) ||
    upstreamForbiddenTools.includes(toolName) ||
    forbiddenTools.includes(toolName))) {
    throw workspaceAuthorityError("Workspace parent authority exceeds its upstream tool policy.");
  }
  const boundaryBase = {
    schema: DIRECT_WORKSPACE_PARENT_AUTHORITY_PACKET_SCHEMA,
    boundaryId,
    allowedTools,
    forbiddenTools,
    authorityProvenance: WORKSPACE_PARENT_AUTHORITY_PROVENANCE,
    upstreamToolPolicy: { ...upstreamPolicyBase, policyDigest: expectedPolicyDigest },
    ...(value.delegationPolicyRef ? {
      delegationPolicyRef: {
        schema: normalizeString(value.delegationPolicyRef.schema, ""),
        policyId: normalizeString(value.delegationPolicyRef.policyId, ""),
        policyRevision: Number(value.delegationPolicyRef.policyRevision || 0),
        policyDigest: normalizeString(value.delegationPolicyRef.policyDigest, ""),
        sourceId: normalizeString(value.delegationPolicyRef.sourceId, ""),
        sourceDigest: normalizeString(value.delegationPolicyRef.sourceDigest, ""),
        issuedAt: normalizeString(value.delegationPolicyRef.issuedAt, ""),
        expiresAt: normalizeString(value.delegationPolicyRef.expiresAt, ""),
        projectId: normalizeString(value.delegationPolicyRef.projectId, ""),
        workThreadId: normalizeString(value.delegationPolicyRef.workThreadId, ""),
        roleLane: normalizeString(value.delegationPolicyRef.roleLane, ""),
      },
    } : {}),
  };
  if (boundaryBase.delegationPolicyRef && (
    boundaryBase.delegationPolicyRef.schema !== DIRECT_WORKSPACE_WORKER_DELEGATION_POLICY_REF_SCHEMA ||
    !boundaryBase.delegationPolicyRef.policyId ||
    !Number.isInteger(boundaryBase.delegationPolicyRef.policyRevision) || boundaryBase.delegationPolicyRef.policyRevision < 1 ||
    !/^sha256:[a-f0-9]{64}$/i.test(boundaryBase.delegationPolicyRef.policyDigest) ||
    !boundaryBase.delegationPolicyRef.sourceId ||
    !/^sha256:[a-f0-9]{64}$/i.test(boundaryBase.delegationPolicyRef.sourceDigest) ||
    !Number.isFinite(Date.parse(boundaryBase.delegationPolicyRef.issuedAt)) ||
    !Number.isFinite(Date.parse(boundaryBase.delegationPolicyRef.expiresAt)) ||
    Date.parse(boundaryBase.delegationPolicyRef.expiresAt) <= Date.parse(boundaryBase.delegationPolicyRef.issuedAt) ||
    !boundaryBase.delegationPolicyRef.projectId ||
    !boundaryBase.delegationPolicyRef.workThreadId ||
    boundaryBase.delegationPolicyRef.roleLane !== "implementation_worker"
  )) {
    throw workspaceAuthorityError("Workspace parent authority has an invalid delegation-policy reference.");
  }
  const expectedBoundaryDigest = digestFor("direct-workspace-parent-authority-packet@1", boundaryBase);
  if (normalizeString(value.boundaryDigest, "") !== expectedBoundaryDigest) {
    throw workspaceAuthorityError("Workspace parent authority packet digest is invalid.");
  }
  return value;
}

function parentAuthorityBoundaryFromPacket(value) {
  const packet = validateWorkspaceParentAuthorityPacket(value);
  return Object.freeze({
    boundaryId: packet.boundaryId,
    boundaryDigest: packet.boundaryDigest,
    allowedTools: [...packet.allowedTools],
    forbiddenTools: [...packet.forbiddenTools],
    authorityProvenance: packet.authorityProvenance,
    delegationPolicyRef: packet.delegationPolicyRef ? { ...packet.delegationPolicyRef } : null,
  });
}

function sourceById(profile, id) {
  return (Array.isArray(profile?.sources) ? profile.sources : []).find((source) => source?.id === id) || null;
}

function safePolicySourcePath(value) {
  const text = normalizeString(value, "").replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (!text || text.startsWith("/") || /^[A-Za-z]:\//.test(text) || text.includes("://") || /[\0-\x1f\x7f]/.test(text)) return "";
  const parts = text.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === ".." || part.toLowerCase() === ".git")) return "";
  return parts.join("/");
}

function pinnedWorkspaceRepositoryProfiles() {
  const constitution = sourceById(arcagi3Profile, "constitution");
  const buildGates = sourceById(arcagi3Profile, "build_gates");
  const profile = {
    schema: "direct_workspace_worker_pinned_repository_profile@1",
    profileId: arcagi3Profile.profileId,
    revision: Number(arcagi3Profile.revision || 1),
    markers: [...arcagi3Profile.markers],
    policySources: [constitution, buildGates].filter(Boolean).map((source) => ({
      id: source.id,
      path: source.path,
      facet: source.facet,
      contentDigest: source.contentDigest,
    })),
    allowedTools: [...WORKSPACE_WORKER_TOOLS],
    selectedConstraints: [
      "Treat only files and tools in the bound repository as authoritative.",
      "Keep edits scoped and preserve unrelated changes.",
      "Use the repository's pinned Make actions for tests; focused evidence never substitutes for a closure gate.",
      "Do not add or mutate remotes, publish branches, or discard unrelated work.",
    ],
    omittedPolicyFacets: [
      "Raw AGENTS.md text is evidence, not an automatically inherited worker instruction package.",
      "Solver-domain architecture guidance is omitted unless the delegated task requires a separately compiled semantic port.",
    ],
    testProfile: {
      profileId: "arcagi3_pinned_make_actions",
      defaultAction: "check",
      targetedAction: "test_focus",
      actions: [
        { name: "test_focus", makeTarget: "test-focus", targetsAllowed: true, targetsRequired: true },
        { name: "check", makeTarget: "check", targetsAllowed: false, targetsRequired: false },
        { name: "test", makeTarget: "test", targetsAllowed: false, targetsRequired: false },
      ],
    },
  };
  profile.profileDigest = digestFor("direct-workspace-worker-pinned-repository-profile@1", profile);
  return Object.freeze([Object.freeze(profile)]);
}

function genericWorkspaceRepositoryProfile() {
  const profile = {
    schema: DIRECT_WORKSPACE_WORKER_POLICY_SCHEMA,
    profileId: "unprofiled_git_repository",
    profileRevision: 1,
    validationPosture: "builtin_generic",
    allowedTools: [...WORKSPACE_WORKER_TOOLS],
    selectedConstraints: [
      "Treat only files and tools in the bound Git repository as authoritative.",
      "Keep edits scoped and do not mutate remotes or private Git metadata.",
    ],
    sourceRefs: [],
    omissionLedger: [{
      source: "repository_policy",
      reason: "No pinned repository policy matched; raw repository instructions were not inherited.",
      count: 1,
    }],
    testProfile: null,
    authorityProvenance: "builtin_generic_repository_policy",
    rawPolicyTextIncluded: false,
    rawWorkspacePathIncluded: false,
  };
  profile.profileDigest = digestFor("direct-workspace-worker-generic-repository-profile@1", profile);
  return Object.freeze(profile);
}

function publicRepositoryPolicy(value = {}) {
  const source = isPlainObject(value) ? value : {};
  const sourceRefs = (Array.isArray(source.sourceRefs) ? source.sourceRefs : [])
    .slice(0, 16)
    .map((ref) => ({
      id: normalizeString(ref?.id, ""),
      path: safePolicySourcePath(ref?.path || ref?.relativePath),
      facet: normalizeString(ref?.facet, ""),
      contentDigest: normalizeString(ref?.contentDigest, ""),
      validationPosture: normalizeString(ref?.validationPosture, "unknown"),
    }))
    .filter((ref) => ref.id && ref.path && ref.contentDigest);
  const claimedProfileId = normalizeString(source.profileId, "unprofiled_repository");
  const claimedProfileDigest = normalizeString(source.profileDigest, "");
  const pinned = pinnedWorkspaceRepositoryProfiles().find((profile) =>
    profile.profileId === claimedProfileId && profile.profileDigest === claimedProfileDigest);
  const claimedPinned = pinnedWorkspaceRepositoryProfiles().some((profile) =>
    profile.profileId === claimedProfileId) || source.validationPosture === "exact";
  const pinnedEvidenceExact = Boolean(pinned) &&
    source.schema === DIRECT_WORKSPACE_WORKER_POLICY_SCHEMA &&
    source.validationPosture === "exact" && pinned.policySources.every((expected) =>
    sourceRefs.some((ref) =>
      ref.id === expected.id &&
      ref.path === expected.path &&
      ref.contentDigest === expected.contentDigest &&
      ref.validationPosture === "exact"));
  const generic = genericWorkspaceRepositoryProfile();
  const genericEvidenceExact = !claimedPinned &&
    source.schema === DIRECT_WORKSPACE_WORKER_POLICY_SCHEMA &&
    source.profileId === generic.profileId &&
    source.profileDigest === generic.profileDigest &&
    source.validationPosture === generic.validationPosture;
  const admittedProfile = pinnedEvidenceExact ? pinned : genericEvidenceExact ? generic : null;
  const validationPosture = pinnedEvidenceExact
    ? "exact"
    : genericEvidenceExact
      ? generic.validationPosture
      : claimedPinned
        ? "profile_evidence_mismatch"
        : "repository_policy_unavailable";
  const result = {
    schema: DIRECT_WORKSPACE_WORKER_POLICY_SCHEMA,
    profileId: admittedProfile?.profileId || claimedProfileId,
    profileRevision: admittedProfile?.revision || admittedProfile?.profileRevision || 0,
    profileDigest: admittedProfile?.profileDigest || claimedProfileDigest,
    validationPosture,
    allowedTools: admittedProfile ? [...admittedProfile.allowedTools] : [],
    selectedConstraints: admittedProfile ? [...admittedProfile.selectedConstraints] : [],
    sourceRefs: pinnedEvidenceExact ? sourceRefs : [],
    omissionLedger: pinnedEvidenceExact
      ? pinned.omittedPolicyFacets.map((reason) => ({ source: pinned.profileId, reason, count: 1 }))
      : genericEvidenceExact
        ? generic.omissionLedger.map((entry) => ({ ...entry }))
        : [{
          source: "repository_policy",
          reason: claimedPinned
            ? "Claimed pinned repository-policy evidence did not match the local pinned profile and granted no authority."
            : "No system-owned repository-policy profile was admitted; repository tool authority was denied.",
          count: 1,
        }],
    authorityProvenance: pinnedEvidenceExact
      ? "pinned_repository_policy_exact"
      : genericEvidenceExact
        ? generic.authorityProvenance
        : "repository_policy_safe_deny",
    rawPolicyTextIncluded: false,
    rawWorkspacePathIncluded: false,
  };
  if (!result.profileDigest) {
    result.profileDigest = digestFor("direct-workspace-worker-unprofiled-repository-policy@1", {
      profileId: result.profileId,
      validationPosture: result.validationPosture,
      allowedTools: result.allowedTools,
      sourceRefs: result.sourceRefs,
    });
  }
  result.policyDigest = digestFor("direct-workspace-worker-repository-policy@1", result);
  return result;
}

function authorityTools(value, fallback, kind) {
  if (!isPlainObject(value)) {
    return {
      explicit: false,
      boundaryId: `${kind}_missing_safe_deny`,
      boundaryDigest: digestFor(`direct-workspace-worker-${kind}-missing-safe-deny@1`, []),
      allowedTools: [],
      forbiddenTools: [],
      authorityProvenance: "missing_safe_deny",
    };
  }
  const allowedTools = sortedToolSet(value.allowedTools || value.declaredTools || value.availableTools, []);
  const forbiddenTools = sortedToolSet(value.forbiddenTools, []);
  const effective = allowedTools.filter((toolName) => !forbiddenTools.includes(toolName));
  return {
    explicit: true,
    boundaryId: normalizeString(value.boundaryId || value.authorityBoundaryId || value.capabilityProfileId, `${kind}_boundary`),
    boundaryDigest: normalizeString(
      value.boundaryDigest || value.authorityBoundaryDigest || value.capabilityDigest,
      digestFor(`direct-workspace-worker-${kind}-boundary@1`, { allowedTools: effective, forbiddenTools }),
    ),
    allowedTools: effective,
    forbiddenTools,
    authorityProvenance: normalizeString(value.authorityProvenance, "explicit_boundary"),
  };
}

function compileWorkspaceWorkerPolicy(input = {}) {
  const requestedProfileId = normalizeString(input.requestedProfileId || input.toolProfile, "read_only_worker");
  const requested = REQUESTED_ROLE_PROFILES[requestedProfileId];
  if (!requested) {
    const error = new Error("tool_profile must be read_only_worker or implementation_worker");
    error.code = "direct_workspace_worker_tool_profile_invalid";
    throw error;
  }
  const repositoryPolicy = publicRepositoryPolicy(input.repositoryPolicy);
  const parent = authorityTools(input.parentAuthority, requested.requestedTools, "parent_authority");
  const substrate = authorityTools(input.substrateCapabilities, WORKSPACE_WORKER_TOOLS, "substrate_capability");
  const declaredTools = requested.requestedTools.filter((toolName) =>
    parent.allowedTools.includes(toolName) &&
    repositoryPolicy.allowedTools.includes(toolName) &&
    substrate.allowedTools.includes(toolName));
  const pinnedTestRequiresExactPolicy = input.testProfile?.profileId === "arcagi3_pinned_make_actions";
  const testAvailable = input.testProfile?.available === true &&
    (!pinnedTestRequiresExactPolicy || repositoryPolicy.validationPosture === "exact");
  const effectiveTools = declaredTools.filter((toolName) => toolName !== "run_test" || testAvailable);
  const wideningSources = effectiveTools.flatMap((toolName) => [
    ...(!requested.requestedTools.includes(toolName) ? [`requested_role:${toolName}`] : []),
    ...(!parent.allowedTools.includes(toolName) ? [`parent_authority:${toolName}`] : []),
    ...(!repositoryPolicy.allowedTools.includes(toolName) ? [`repository_policy:${toolName}`] : []),
    ...(!substrate.allowedTools.includes(toolName) ? [`substrate_capability:${toolName}`] : []),
  ]);
  const omittedTools = requested.requestedTools
    .filter((toolName) => !effectiveTools.includes(toolName))
    .map((toolName) => ({
      toolName,
      deniedBy: [
        ...(!parent.allowedTools.includes(toolName) ? ["parent_authority"] : []),
        ...(!repositoryPolicy.allowedTools.includes(toolName) ? ["repository_policy"] : []),
        ...(!substrate.allowedTools.includes(toolName) ? ["substrate_capability"] : []),
        ...(toolName === "run_test" && !testAvailable ? ["test_profile_unavailable"] : []),
      ],
    }));
  const boundaryOmissions = [
    ...(!parent.explicit ? [{
      boundary: "parent_authority",
      reason: "Launcher did not carry an explicit parent boundary; the missing boundary granted no tools.",
    }] : []),
    ...(!substrate.explicit ? [{
      boundary: "substrate_capability",
      reason: "Provisioner did not carry an explicit substrate capability profile; the missing boundary granted no tools.",
    }] : []),
  ];
  const compilation = {
    schema: DIRECT_WORKSPACE_WORKER_POLICY_COMPILATION_SCHEMA,
    requestedProfileId,
    requestedProfileAdvisory: true,
    requestedTools: [...requested.requestedTools],
    parentAuthority: parent,
    repositoryPolicyRef: {
      profileId: repositoryPolicy.profileId,
      profileDigest: repositoryPolicy.profileDigest,
      policyDigest: repositoryPolicy.policyDigest,
      validationPosture: repositoryPolicy.validationPosture,
    },
    substrateCapability: substrate,
    declaredTools: effectiveTools,
    omittedTools,
    boundaryOmissions,
    inheritedConstraintCount: repositoryPolicy.selectedConstraints.length,
    omissionCount: repositoryPolicy.omissionLedger.reduce((sum, entry) => sum + entry.count, 0) + omittedTools.length + boundaryOmissions.length,
    parentAuthorityExplicit: parent.explicit,
    substrateCapabilityExplicit: substrate.explicit,
    repositoryAuthorityProvenance: repositoryPolicy.authorityProvenance,
    authorityProvenance: {
      requestedRole: "advisory_candidate",
      parentAuthority: parent.authorityProvenance,
      repositoryPolicy: repositoryPolicy.authorityProvenance,
      substrateCapability: substrate.authorityProvenance,
    },
    wideningSources,
    wideningPerformed: wideningSources.length > 0,
    rawPolicyTextIncluded: false,
    rawWorkspacePathIncluded: false,
  };
  compilation.compilationDigest = digestFor("direct-workspace-worker-policy-compilation@1", compilation);
  return { repositoryPolicy, compilation, declaredTools: effectiveTools };
}

module.exports = {
  DIRECT_WORKSPACE_PARENT_AUTHORITY_PACKET_SCHEMA,
  DIRECT_WORKSPACE_UPSTREAM_TOOL_POLICY_SCHEMA,
  DIRECT_WORKSPACE_WORKER_DELEGATION_POLICY_REF_SCHEMA,
  DIRECT_WORKSPACE_WORKER_POLICY_COMPILATION_SCHEMA,
  DIRECT_WORKSPACE_WORKER_POLICY_SCHEMA,
  REPOSITORY_READ_TOOLS,
  REQUESTED_ROLE_PROFILES,
  WORKSPACE_WORKER_TOOLS,
  compileWorkspaceWorkerPolicy,
  createWorkspaceParentAuthorityPacket,
  digestFor,
  genericWorkspaceRepositoryProfile,
  parentAuthorityBoundaryFromPacket,
  pinnedWorkspaceRepositoryProfiles,
  publicRepositoryPolicy,
  validateWorkspaceParentAuthorityPacket,
};
