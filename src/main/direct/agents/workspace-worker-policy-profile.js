"use strict";

const crypto = require("node:crypto");
const arcagi3Profile = require("../epistemic/profiles/arcagi3-odeu-local.v1.json");

const DIRECT_WORKSPACE_WORKER_POLICY_SCHEMA = "direct_workspace_worker_policy@1";
const DIRECT_WORKSPACE_WORKER_POLICY_COMPILATION_SCHEMA = "direct_workspace_worker_policy_compilation@1";

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
    workspaceMutationRequested: false,
  }),
  implementation_worker: Object.freeze({
    requestedTools: WORKSPACE_WORKER_TOOLS,
    workspaceMutationRequested: true,
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
  const pinnedEvidenceExact = Boolean(pinned) && source.validationPosture === "exact" && pinned.policySources.every((expected) =>
    sourceRefs.some((ref) =>
      ref.id === expected.id &&
      ref.path === expected.path &&
      ref.contentDigest === expected.contentDigest &&
      ref.validationPosture === "exact"));
  const result = {
    schema: DIRECT_WORKSPACE_WORKER_POLICY_SCHEMA,
    profileId: pinnedEvidenceExact ? pinned.profileId : claimedProfileId,
    profileRevision: pinnedEvidenceExact
      ? pinned.revision
      : Math.max(0, Number(source.profileRevision || source.revision || 0) || 0),
    profileDigest: pinnedEvidenceExact ? pinned.profileDigest : claimedProfileDigest,
    validationPosture: pinnedEvidenceExact
      ? "exact"
      : normalizeString(source.validationPosture, "unprofiled") === "exact"
        ? "profile_evidence_mismatch"
        : normalizeString(source.validationPosture, "unprofiled"),
    allowedTools: pinnedEvidenceExact
      ? [...pinned.allowedTools]
      : sortedToolSet(source.allowedTools, WORKSPACE_WORKER_TOOLS),
    selectedConstraints: pinnedEvidenceExact
      ? [...pinned.selectedConstraints]
      : [
          "Treat only files and tools in the bound Git repository as authoritative.",
          "Keep edits scoped and do not mutate remotes or private Git metadata.",
        ],
    sourceRefs: pinnedEvidenceExact ? sourceRefs : [],
    omissionLedger: pinnedEvidenceExact
      ? pinned.omittedPolicyFacets.map((reason) => ({ source: pinned.profileId, reason, count: 1 }))
      : [{
          source: "repository_policy",
          reason: "No pinned repository-policy evidence was admitted; raw repository instructions were omitted.",
          count: 1,
        }],
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
      boundaryId: `${kind}_compatibility_boundary`,
      boundaryDigest: digestFor(`direct-workspace-worker-${kind}-compatibility-boundary@1`, fallback),
      allowedTools: [...fallback],
      forbiddenTools: [],
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
      reason: "Launcher did not carry an explicit parent boundary; compatibility boundary is limited to the requested role candidate.",
    }] : []),
    ...(!substrate.explicit ? [{
      boundary: "substrate_capability",
      reason: "Provisioner did not carry an explicit substrate capability profile; compatibility boundary remains locally bounded.",
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
    wideningPerformed: false,
    rawPolicyTextIncluded: false,
    rawWorkspacePathIncluded: false,
  };
  compilation.compilationDigest = digestFor("direct-workspace-worker-policy-compilation@1", compilation);
  return { repositoryPolicy, compilation, declaredTools: effectiveTools };
}

module.exports = {
  DIRECT_WORKSPACE_WORKER_POLICY_COMPILATION_SCHEMA,
  DIRECT_WORKSPACE_WORKER_POLICY_SCHEMA,
  REPOSITORY_READ_TOOLS,
  REQUESTED_ROLE_PROFILES,
  WORKSPACE_WORKER_TOOLS,
  compileWorkspaceWorkerPolicy,
  digestFor,
  pinnedWorkspaceRepositoryProfiles,
  publicRepositoryPolicy,
};
