"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  SEMANTIC_ROUTER_META_ROLE_ID,
  createDefaultConstitutionalMetaRoleRegistry,
} = require("../worldmanager/constitutional-meta-role");

const DIRECT_ACTIVE_SUB_AGENT_POLICY_SCHEMA =
  "direct_active_sub_agent_policy@1";
const DIRECT_ACTIVE_SUB_AGENT_POLICY_STORE_SCHEMA =
  "direct_active_sub_agent_policy_store@1";
const DIRECT_ACTIVE_SUB_AGENT_POLICY_PROJECTION_SCHEMA =
  "direct_active_sub_agent_policy_projection@1";
const DIRECT_ACTIVE_SUB_AGENT_POLICY_SEMANTIC_SETTLEMENT_SCHEMA =
  "direct_active_sub_agent_policy_semantic_settlement@1";
const DIRECT_ACTIVE_SUB_AGENT_SPAWN_DECISION_SCHEMA =
  "direct_active_sub_agent_spawn_decision@1";
const DIRECT_ACTIVE_SUB_AGENT_POLICY_EXCEPTION_SCHEMA =
  "direct_active_sub_agent_policy_exception@1";
const DIRECT_ACTIVE_SUB_AGENT_POLICY_UPDATE_REQUEST_SCHEMA =
  "direct_active_sub_agent_policy_update_request@1";

const POLICY_NO_CHANGE_TOOL =
  "direct_no_sub_agent_policy_change";
const POLICY_UPDATE_TOOL =
  "direct_propose_sub_agent_policy_update";
const POLICY_CLARIFICATION_TOOL =
  "direct_request_sub_agent_policy_clarification";

const POLICY_SCOPE_KINDS = new Set([
  "thread",
  "project",
]);
const PROVIDER_IDS = new Set([
  "chatgpt-direct",
  "openrouter-oxalpha",
  "opencode-oxalpha",
]);
const PROVIDER_DEFAULT_MODELS = Object.freeze({
  "openrouter-oxalpha": "stealth/ox-alpha",
  "opencode-oxalpha": "opencode/x-preview-f-free",
});
const REASONING_EFFORTS = new Set([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);
const WORKSPACE_MODES = new Set([
  "reasoning_only",
  "isolated_worktree",
]);
const TOOL_PROFILES = new Set([
  "read_only_worker",
  "implementation_worker",
]);
const DEVIATION_DISPOSITIONS = new Set([
  "one_time_exception",
  "propose_policy_update",
]);
const ONE_TIME_AUTHORITIES = new Set([
  "resident_reasoned_exception",
  "operator_only",
]);

const trustedSpawnDecisions = new WeakSet();

function isPlainObject(value) {
  return Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : fallback;
}

function boundedString(value, fallback = "", max = 720) {
  return normalizeString(value, fallback).slice(0, max);
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function digestFor(domain, value) {
  return `sha256:${crypto.createHash("sha256")
    .update(`${domain}\0${stableStringify(value)}`)
    .digest("hex")}`;
}

function safeId(value, label, fallback = "") {
  const id = normalizeString(value, fallback);
  if (!id || !/^[A-Za-z0-9*][A-Za-z0-9*._:-]{0,191}$/.test(id)) {
    const error = new Error(`Invalid ${label}.`);
    error.code = `direct_active_sub_agent_policy_${label}_invalid`;
    throw error;
  }
  return id;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

function writeJsonAtomic(targetPath, value) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(
      tempPath,
      `${JSON.stringify(value, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    fs.renameSync(tempPath, targetPath);
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch {}
    throw error;
  }
}

function readJson(targetPath) {
  try {
    return JSON.parse(fs.readFileSync(targetPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function policyScope(input = {}) {
  const scopeKind = POLICY_SCOPE_KINDS.has(
    normalizeString(input.scopeKind, "thread"),
  )
    ? normalizeString(input.scopeKind, "thread")
    : "thread";
  const projectId = safeId(input.projectId, "project_id");
  const threadId = scopeKind === "thread"
    ? safeId(input.threadId, "thread_id")
    : "";
  return {
    scopeKind,
    projectId,
    threadId,
  };
}

function scopeKey(scope = {}) {
  return scope.scopeKind === "project"
    ? `project:${scope.projectId}`
    : `thread:${scope.projectId}:${scope.threadId}`;
}

function normalizeForkTurns(value) {
  const forkTurns = normalizeString(value, "");
  if (!forkTurns) return "";
  if (["none", "all"].includes(forkTurns)) return forkTurns;
  if (/^[1-9][0-9]{0,3}$/.test(forkTurns)) return forkTurns;
  const error = new Error("Invalid sub-agent context-handoff policy.");
  error.code = "direct_active_sub_agent_policy_fork_turns_invalid";
  throw error;
}

function canonicalRoleId(value) {
  const role = normalizeString(value, "sub_agent_worker")
    .toLowerCase()
    .replace(/[ -]+/g, "_");
  const aliases = {
    implementation: "implementation_worker",
    implementer: "implementation_worker",
    worker: "sub_agent_worker",
    auditor: "review_auditor",
    reviewer: "review_auditor",
    research: "discovery_research",
    researcher: "discovery_research",
    observer: "thread_observer",
    transcriber: "thread_transcriber",
  };
  return safeId(aliases[role] || role, "role_id");
}

function normalizeRoleBinding(input = {}) {
  if (!isPlainObject(input)) {
    const error = new Error("Sub-agent policy role binding must be an object.");
    error.code = "direct_active_sub_agent_policy_binding_invalid";
    throw error;
  }
  const roleId = input.roleId === "*"
    ? "*"
    : canonicalRoleId(input.roleId);
  const providerId = normalizeString(
    input.providerId || input.provider,
    "",
  );
  const model = boundedString(input.model, "", 160);
  const reasoningEffort = normalizeString(
    input.reasoningEffort || input.reasoning_effort,
    "",
  );
  const forkTurns = normalizeForkTurns(
    input.forkTurns || input.fork_turns,
  );
  const workspaceMode = normalizeString(
    input.workspaceMode || input.workspace_mode,
    "",
  );
  const toolProfile = normalizeString(
    input.toolProfile || input.tool_profile,
    "",
  );
  if (providerId && !PROVIDER_IDS.has(providerId)) {
    const error = new Error("Sub-agent policy provider is not supported.");
    error.code = "direct_active_sub_agent_policy_provider_invalid";
    throw error;
  }
  if (
    model &&
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(model)
  ) {
    const error = new Error("Sub-agent policy model id is invalid.");
    error.code = "direct_active_sub_agent_policy_model_invalid";
    throw error;
  }
  if (reasoningEffort && !REASONING_EFFORTS.has(reasoningEffort)) {
    const error = new Error("Sub-agent policy reasoning effort is not supported.");
    error.code = "direct_active_sub_agent_policy_effort_invalid";
    throw error;
  }
  if (workspaceMode && !WORKSPACE_MODES.has(workspaceMode)) {
    const error = new Error("Sub-agent policy workspace mode is not supported.");
    error.code = "direct_active_sub_agent_policy_workspace_mode_invalid";
    throw error;
  }
  if (toolProfile && !TOOL_PROFILES.has(toolProfile)) {
    const error = new Error("Sub-agent policy tool profile is not supported.");
    error.code = "direct_active_sub_agent_policy_tool_profile_invalid";
    throw error;
  }
  if (
    (workspaceMode === "reasoning_only" && toolProfile) ||
    (workspaceMode && workspaceMode !== "isolated_worktree" && toolProfile)
  ) {
    const error = new Error(
      "A reasoning-only sub-agent policy cannot declare a workspace tool profile.",
    );
    error.code = "direct_active_sub_agent_policy_workspace_tool_mismatch";
    throw error;
  }
  return {
    roleId,
    providerId,
    model,
    reasoningEffort,
    forkTurns,
    workspaceMode,
    toolProfile,
    unspecifiedDimensions: "inherit_request_then_parent_runtime",
  };
}

function normalizeRoleBindings(values = []) {
  const source = Array.isArray(values) ? values : [];
  const byRole = new Map();
  for (const value of source) {
    const binding = normalizeRoleBinding(value);
    if (byRole.has(binding.roleId)) {
      const error = new Error(
        `Duplicate sub-agent policy binding for role ${binding.roleId}.`,
      );
      error.code = "direct_active_sub_agent_policy_duplicate_role";
      throw error;
    }
    byRole.set(binding.roleId, binding);
  }
  if (!byRole.has("*")) {
    byRole.set("*", normalizeRoleBinding({ roleId: "*" }));
  }
  return [...byRole.values()].sort((left, right) =>
    left.roleId === "*"
      ? -1
      : right.roleId === "*"
        ? 1
        : left.roleId.localeCompare(right.roleId));
}

function normalizeDeviationRule(value = {}) {
  const source = isPlainObject(value) ? value : {};
  const oneTimeAuthority = normalizeString(
    source.oneTimeAuthority,
    "resident_reasoned_exception",
  );
  if (!ONE_TIME_AUTHORITIES.has(oneTimeAuthority)) {
    const error = new Error("Invalid one-time deviation authority.");
    error.code = "direct_active_sub_agent_policy_deviation_authority_invalid";
    throw error;
  }
  return {
    mismatchPosture: "require_explicit_reason_and_disposition",
    oneTimeAuthority,
    permanentUpdateAuthority:
      "operator_semantic_admission_or_worldmanager_delegation",
    permittedDispositions: [...DEVIATION_DISPOSITIONS],
    silentOverrideAllowed: false,
  };
}

function buildActiveSubAgentPolicy(input = {}) {
  const scope = policyScope(input.scope || input);
  const revision = Number(input.revision || 0);
  if (!Number.isInteger(revision) || revision < 1) {
    const error = new Error("Active sub-agent policy requires a positive revision.");
    error.code = "direct_active_sub_agent_policy_revision_invalid";
    throw error;
  }
  const roleBindings = normalizeRoleBindings(input.roleBindings);
  const maxActiveChildren = Number(input.maxActiveChildren || 0);
  if (
    !Number.isInteger(maxActiveChildren) ||
    maxActiveChildren < 0 ||
    maxActiveChildren > 64
  ) {
    const error = new Error("Active sub-agent policy concurrency limit is invalid.");
    error.code = "direct_active_sub_agent_policy_concurrency_invalid";
    throw error;
  }
  const createdAt = normalizeString(
    input.createdAt,
    new Date().toISOString(),
  );
  const updatedAt = normalizeString(input.updatedAt, createdAt);
  const provenance = isPlainObject(input.provenance)
    ? {
        authorityKind: normalizeString(
          input.provenance.authorityKind,
          "operator_semantic_admission",
        ),
        actorId: normalizeString(
          input.provenance.actorId,
          "operator",
        ),
        sourceRef: isPlainObject(input.provenance.sourceRef)
          ? {
              kind: normalizeString(
                input.provenance.sourceRef.kind,
                "operator_policy_statement",
              ),
              id: normalizeString(input.provenance.sourceRef.id, ""),
              digest: normalizeString(
                input.provenance.sourceRef.digest,
                "",
              ),
            }
          : null,
        semanticSettlementRef:
          isPlainObject(input.provenance.semanticSettlementRef)
            ? {
                kind: normalizeString(
                  input.provenance.semanticSettlementRef.kind,
                  "active_sub_agent_policy_semantic_settlement",
                ),
                id: normalizeString(
                  input.provenance.semanticSettlementRef.id,
                  "",
                ),
                digest: normalizeString(
                  input.provenance.semanticSettlementRef.digest,
                  "",
                ),
              }
            : null,
      }
    : {
        authorityKind: "operator_semantic_admission",
        actorId: "operator",
        sourceRef: null,
        semanticSettlementRef: null,
      };
  const base = {
    schema: DIRECT_ACTIVE_SUB_AGENT_POLICY_SCHEMA,
    policyId: normalizeString(
      input.policyId,
      `active_sub_agent_policy_${digestFor("active-sub-agent-policy-id@1", scope).slice(7, 31)}`,
    ),
    revision,
    status: "active",
    scope,
    roleBindings,
    maxActiveChildren,
    deviationRule: normalizeDeviationRule(input.deviationRule),
    initializationRule: {
      missingPolicyPosture:
        "block_spawn_and_request_semantic_settlement",
      rendererMayInventDefault: false,
      residentMayInventDefault: false,
    },
    updateAuthority: {
      operatorUtterance: "semantic_admission",
      residentAgent: "candidate_only",
      worldManager: "delegated_admission_only",
      renderer: "request_only",
    },
    inheritanceRule: {
      exactThreadBeforeProject: true,
      declaredRoleBeforeWildcard: true,
      declaredDimensionsOverrideRequest: true,
      unspecifiedDimensions:
        "inherit_request_then_parent_runtime",
    },
    provenance,
    createdAt,
    updatedAt,
    rawUserTextIncluded: false,
    rawProviderPayloadIncluded: false,
    grantsWorkspaceAuthority: false,
    grantsRemoteMutationAuthority: false,
  };
  return deepFreeze({
    ...base,
    digest: digestFor("direct-active-sub-agent-policy@1", base),
  });
}

function validateActiveSubAgentPolicy(value = {}) {
  const rebuilt = buildActiveSubAgentPolicy(value);
  if (
    value.schema !== DIRECT_ACTIVE_SUB_AGENT_POLICY_SCHEMA ||
    rebuilt.digest !== value.digest
  ) {
    const error = new Error("Active sub-agent policy digest or schema is invalid.");
    error.code = "direct_active_sub_agent_policy_invalid";
    throw error;
  }
  return true;
}

function policyRef(policy) {
  return policy
    ? {
        kind: "active_sub_agent_policy",
        id: policy.policyId,
        digest: policy.digest,
        revision: policy.revision,
      }
    : null;
}

function safePolicySummary(policy) {
  return policy
    ? {
        schema: policy.schema,
        policyId: policy.policyId,
        revision: policy.revision,
        status: policy.status,
        scope: policy.scope,
        roleBindings: policy.roleBindings,
        maxActiveChildren: policy.maxActiveChildren,
        deviationRule: policy.deviationRule,
        initializationRule: policy.initializationRule,
        updateAuthority: policy.updateAuthority,
        inheritanceRule: policy.inheritanceRule,
        provenance: policy.provenance,
        createdAt: policy.createdAt,
        updatedAt: policy.updatedAt,
        digest: policy.digest,
        rawUserTextIncluded: false,
        rawProviderPayloadIncluded: false,
        grantsWorkspaceAuthority: false,
        grantsRemoteMutationAuthority: false,
      }
    : null;
}

function emptyStore() {
  const base = {
    schema: DIRECT_ACTIVE_SUB_AGENT_POLICY_STORE_SCHEMA,
    currentByScope: {},
    revisions: [],
    semanticSettlements: [],
    exceptions: [],
    updateRequests: [],
    updatedAt: new Date(0).toISOString(),
  };
  return {
    ...base,
    digest: digestFor("direct-active-sub-agent-policy-store@1", base),
  };
}

function validateStore(store = {}) {
  if (store.schema !== DIRECT_ACTIVE_SUB_AGENT_POLICY_STORE_SCHEMA) {
    throw Object.assign(
      new Error("Active sub-agent policy store schema is invalid."),
      { code: "direct_active_sub_agent_policy_store_invalid" },
    );
  }
  const { digest, ...base } = store;
  if (digest !== digestFor("direct-active-sub-agent-policy-store@1", base)) {
    throw Object.assign(
      new Error("Active sub-agent policy store digest is invalid."),
      { code: "direct_active_sub_agent_policy_store_invalid" },
    );
  }
  for (const policy of Object.values(store.currentByScope || {})) {
    validateActiveSubAgentPolicy(policy);
  }
  return true;
}

class ActiveSubAgentPolicyStore {
  constructor(options = {}) {
    this.rootDir = path.resolve(
      options.rootDir ||
        path.join(process.cwd(), ".direct-active-sub-agent-policy"),
    );
    this.now = typeof options.now === "function"
      ? options.now
      : Date.now;
    fs.mkdirSync(this.rootDir, { recursive: true });
    if (!fs.existsSync(this.storePath())) {
      writeJsonAtomic(this.storePath(), emptyStore());
    }
    validateStore(this.read());
  }

  storePath() {
    return path.join(
      this.rootDir,
      "active-sub-agent-policies.json",
    );
  }

  read() {
    return readJson(this.storePath()) || emptyStore();
  }

  write(next = {}) {
    const base = {
      schema: DIRECT_ACTIVE_SUB_AGENT_POLICY_STORE_SCHEMA,
      currentByScope: next.currentByScope || {},
      revisions: (Array.isArray(next.revisions)
        ? next.revisions
        : []).slice(-1000),
      semanticSettlements: (Array.isArray(next.semanticSettlements)
        ? next.semanticSettlements
        : []).slice(-1000),
      exceptions: (Array.isArray(next.exceptions)
        ? next.exceptions
        : []).slice(-1000),
      updateRequests: (Array.isArray(next.updateRequests)
        ? next.updateRequests
        : []).slice(-1000),
      updatedAt: new Date(this.now()).toISOString(),
    };
    const store = {
      ...base,
      digest: digestFor(
        "direct-active-sub-agent-policy-store@1",
        base,
      ),
    };
    validateStore(store);
    writeJsonAtomic(this.storePath(), store);
    return store;
  }

  exact(scope) {
    return this.read().currentByScope?.[scopeKey(scope)] || null;
  }

  effective(projectId, threadId = "") {
    const store = this.read();
    const threadKey = threadId
      ? scopeKey({ scopeKind: "thread", projectId, threadId })
      : "";
    return (
      (threadKey ? store.currentByScope?.[threadKey] : null) ||
      store.currentByScope?.[
        scopeKey({ scopeKind: "project", projectId, threadId: "" })
      ] ||
      null
    );
  }

  admit(input = {}) {
    const scope = policyScope(input.scope || input);
    const store = this.read();
    const key = scopeKey(scope);
    const current = store.currentByScope?.[key] || null;
    const expectedRevision = Number(
      input.expectedRevision ?? input.expectedPolicyRevision ?? 0,
    );
    if (Number(current?.revision || 0) !== expectedRevision) {
      const error = new Error(
        "Active sub-agent policy revision changed before admission.",
      );
      error.code = "direct_active_sub_agent_policy_revision_conflict";
      error.currentRevision = Number(current?.revision || 0);
      throw error;
    }
    const policy = buildActiveSubAgentPolicy({
      ...input,
      scope,
      policyId: current?.policyId || input.policyId,
      revision: expectedRevision + 1,
      createdAt: current?.createdAt ||
        normalizeString(input.createdAt, new Date(this.now()).toISOString()),
      updatedAt: normalizeString(
        input.updatedAt,
        new Date(this.now()).toISOString(),
      ),
    });
    this.write({
      ...store,
      currentByScope: {
        ...store.currentByScope,
        [key]: policy,
      },
      revisions: [
        ...(store.revisions || []),
        safePolicySummary(policy),
      ],
    });
    return policy;
  }

  recordSemanticSettlement(settlement) {
    const store = this.read();
    this.write({
      ...store,
      semanticSettlements: [
        ...(store.semanticSettlements || []),
        settlement,
      ],
    });
    return settlement;
  }

  recordException(exception) {
    const store = this.read();
    this.write({
      ...store,
      exceptions: [
        ...(store.exceptions || []),
        exception,
      ],
    });
    return exception;
  }

  recordUpdateRequest(request) {
    const store = this.read();
    this.write({
      ...store,
      updateRequests: [
        ...(store.updateRequests || []),
        request,
      ],
    });
    return request;
  }

  projection(projectId, threadId = "") {
    const store = this.read();
    const current = this.effective(projectId, threadId);
    const history = (store.revisions || [])
      .filter((policy) =>
        policy.scope?.projectId === projectId &&
        (!threadId ||
          policy.scope.scopeKind === "project" ||
          policy.scope.threadId === threadId))
      .slice(-20)
      .reverse();
    const settlements = (store.semanticSettlements || [])
      .filter((entry) =>
        entry.scope?.projectId === projectId &&
        (!threadId ||
          entry.scope?.scopeKind === "project" ||
          entry.scope?.threadId === threadId))
      .slice(-20)
      .reverse();
    const exceptions = (store.exceptions || [])
      .filter((entry) =>
        entry.projectId === projectId &&
        (!threadId || entry.threadId === threadId))
      .slice(-20)
      .reverse();
    const updateRequests = (store.updateRequests || [])
      .filter((entry) =>
        entry.projectId === projectId &&
        (!threadId || entry.threadId === threadId))
      .slice(-20)
      .reverse();
    const base = {
      schema: DIRECT_ACTIVE_SUB_AGENT_POLICY_PROJECTION_SCHEMA,
      projectId,
      threadId,
      state: current ? "active" : "unsettled",
      activePolicy: safePolicySummary(current),
      activePolicyRef: policyRef(current),
      resolutionSource: current
        ? current.scope.scopeKind === "thread"
          ? "thread_policy"
          : "project_policy"
        : "none",
      history,
      latestSemanticSettlement: settlements[0] || null,
      recentSemanticSettlements: settlements,
      recentExceptions: exceptions,
      recentUpdateRequests: updateRequests,
      spawnPosture: current
        ? "resolve_mechanically_from_active_policy"
        : "block_and_request_policy_settlement",
      editable: true,
      mutationAuthority: "operator_semantic_admission",
      rawUserTextIncluded: false,
      rawProviderPayloadIncluded: false,
      grantsAuthority: false,
      generatedAt: new Date(this.now()).toISOString(),
    };
    return {
      ...base,
      digest: digestFor(
        "direct-active-sub-agent-policy-projection@1",
        base,
      ),
    };
  }
}

function bindingPatchFromSemantic(value = {}) {
  return normalizeRoleBinding({
    roleId: value.role_id || value.roleId,
    providerId: value.provider_id || value.providerId,
    model: value.model,
    reasoningEffort:
      value.reasoning_effort || value.reasoningEffort,
    forkTurns: value.fork_turns || value.forkTurns,
    workspaceMode:
      value.workspace_mode || value.workspaceMode,
    toolProfile: value.tool_profile || value.toolProfile,
  });
}

function mergeRoleBindings(currentPolicy, patches = []) {
  const existing = new Map(
    (currentPolicy?.roleBindings || []).map((binding) => [
      binding.roleId,
      binding,
    ]),
  );
  if (!existing.has("*")) {
    existing.set("*", normalizeRoleBinding({ roleId: "*" }));
  }
  for (const rawPatch of patches) {
    const patch = bindingPatchFromSemantic(rawPatch);
    const prior = existing.get(patch.roleId) ||
      normalizeRoleBinding({ roleId: patch.roleId });
    const clearDimensions = new Set(
      Array.isArray(rawPatch?.clear_dimensions)
        ? rawPatch.clear_dimensions
        : [],
    );
    const cleared = {
      ...(clearDimensions.has("provider_id") ? { providerId: "" } : {}),
      ...(clearDimensions.has("model") ? { model: "" } : {}),
      ...(clearDimensions.has("reasoning_effort")
        ? { reasoningEffort: "" }
        : {}),
      ...(clearDimensions.has("fork_turns") ? { forkTurns: "" } : {}),
      ...(clearDimensions.has("workspace_mode")
        ? { workspaceMode: "" }
        : {}),
      ...(clearDimensions.has("tool_profile")
        ? { toolProfile: "" }
        : {}),
    };
    existing.set(
      patch.roleId,
      normalizeRoleBinding({
        ...prior,
        ...cleared,
        ...Object.fromEntries(
          Object.entries(patch)
            .filter(([key, value]) =>
              key === "roleId" ||
              (key !== "unspecifiedDimensions" && value !== "")),
        ),
      }),
    );
  }
  return [...existing.values()];
}

function semanticToolSchemas() {
  const semanticBinding = {
    type: "object",
    properties: {
      role_id: {
        type: "string",
        description:
          "Structured child role affected by the policy, such as implementation_worker, review_auditor, thread_transcriber, or *.",
      },
      provider_id: {
        type: "string",
        enum: [...PROVIDER_IDS],
      },
      model: { type: "string" },
      reasoning_effort: {
        type: "string",
        enum: [...REASONING_EFFORTS],
      },
      fork_turns: {
        type: "string",
        description: "none, all, or a positive integer string.",
      },
      workspace_mode: {
        type: "string",
        enum: [...WORKSPACE_MODES],
      },
      tool_profile: {
        type: "string",
        enum: [...TOOL_PROFILES],
      },
      clear_dimensions: {
        type: "array",
        items: {
          type: "string",
          enum: [
            "provider_id",
            "model",
            "reasoning_effort",
            "fork_turns",
            "workspace_mode",
            "tool_profile",
          ],
        },
        uniqueItems: true,
        description:
          "Previously governed dimensions to return to inherit-request-then-parent behavior for this role.",
      },
    },
    required: ["role_id"],
    additionalProperties: false,
  };
  return [
    {
      type: "function",
      name: POLICY_NO_CHANGE_TOOL,
      description:
        "Use when the user utterance does not establish, revise, revoke, or ask to settle active sub-agent policy.",
      parameters: {
        type: "object",
        properties: {
          rationale: { type: "string" },
        },
        required: ["rationale"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: POLICY_UPDATE_TOOL,
      description:
        "Use when the user semantically establishes or revises active sub-agent policy. Include only dimensions actually settled by the utterance; the harness preserves other dimensions.",
      parameters: {
        type: "object",
        properties: {
          scope_kind: {
            type: "string",
            enum: [...POLICY_SCOPE_KINDS],
          },
          role_bindings: {
            type: "array",
            items: semanticBinding,
            minItems: 1,
          },
          max_active_children: {
            type: "integer",
            minimum: 0,
            maximum: 64,
            description:
              "Scope-relative child cap. Zero delegates the cap to the native runtime.",
          },
          one_time_authority: {
            type: "string",
            enum: [...ONE_TIME_AUTHORITIES],
          },
          summary: { type: "string" },
          rationale: { type: "string" },
        },
        required: [
          "scope_kind",
          "summary",
          "rationale",
        ],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: POLICY_CLARIFICATION_TOOL,
      description:
        "Use only when the utterance plausibly concerns active sub-agent policy but leaves a material policy dimension or scope ambiguous.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string" },
          unresolved_dimensions: {
            type: "array",
            items: { type: "string" },
          },
          rationale: { type: "string" },
        },
        required: [
          "question",
          "unresolved_dimensions",
          "rationale",
        ],
        additionalProperties: false,
      },
    },
  ];
}

function semanticInstructions(input = {}) {
  const invocation = input.metaRoleInvocation;
  return [
    `You are executing the harness-owned constitutional meta-role ${invocation.metaRoleId}.`,
    "Classify only whether this user utterance updates the active sub-agent policy for the bound Direct project/task.",
    "A policy update changes durable defaults or constraints for future child-agent launches: role, provider, model, reasoning effort, context handoff, workspace realization, tool profile, concurrency, or deviation authority.",
    "When the user removes an earlier constraint, emit clear_dimensions for the affected role; use max_active_children zero to return concurrency control to the native runtime.",
    "Ordinary requests to perform work, use a child once, report status, discuss architecture, or answer a question are not durable policy updates unless the user establishes standing future behavior.",
    "Do not infer a policy update from model names appearing in examples, quoted text, logs, or questions.",
    "Preserve semantic content. The tool schema governs form, not a closed vocabulary of possible roles or policies.",
    "Call exactly one supplied function. Do not produce assistant prose.",
    "You have no launch, workspace, remote, canonical-worldstate, or policy-admission authority. The harness alone may admit a proposal using the operator utterance as authority provenance.",
  ].join(" ");
}

function semanticPrompt(input = {}) {
  const projection = input.currentProjection || {};
  return [
    "Bound semantic region: active sub-agent policy.",
    `Project: ${input.projectId}.`,
    `Task/thread: ${input.threadId}.`,
    input.scopeBinding
      ? `The operator used a ${input.scopeBinding}-scoped policy editor. Preserve that scope in any update action.`
      : "No UI scope binding was supplied; settle thread versus project scope semantically.",
    `Current policy state: ${projection.state || "unsettled"}.`,
    projection.activePolicy
      ? `Current policy projection: ${JSON.stringify({
          scope: projection.activePolicy.scope,
          roleBindings: projection.activePolicy.roleBindings,
          maxActiveChildren:
            projection.activePolicy.maxActiveChildren,
          deviationRule:
            projection.activePolicy.deviationRule,
        })}`
      : "No current policy exists.",
    `User utterance: ${boundedString(input.userText, "", 12_000)}`,
  ].join("\n");
}

function parseActionCall(call = {}) {
  const name = normalizeString(call.name || call.toolName, "");
  let args;
  try {
    args = JSON.parse(normalizeString(call.argumentsJson, "{}"));
  } catch {
    const error = new Error("Sub-agent policy router returned invalid JSON.");
    error.code = "direct_active_sub_agent_policy_semantic_json_invalid";
    throw error;
  }
  if (
    ![
      POLICY_NO_CHANGE_TOOL,
      POLICY_UPDATE_TOOL,
      POLICY_CLARIFICATION_TOOL,
    ].includes(name) ||
    !isPlainObject(args)
  ) {
    const error = new Error("Sub-agent policy router returned an invalid action.");
    error.code = "direct_active_sub_agent_policy_semantic_action_invalid";
    throw error;
  }
  return { name, args };
}

function buildSemanticSettlement(input = {}) {
  const base = {
    schema:
      DIRECT_ACTIVE_SUB_AGENT_POLICY_SEMANTIC_SETTLEMENT_SCHEMA,
    settlementId: normalizeString(
      input.settlementId,
      `direct_sub_agent_policy_settlement_${digestFor("direct-sub-agent-policy-settlement-id@1", {
        projectId: input.scope.projectId,
        threadId: input.scope.threadId,
        clientRequestId: input.clientRequestId,
        actionName: input.actionName,
      }).slice(7, 31)}`,
    ),
    scope: input.scope,
    clientRequestId: normalizeString(input.clientRequestId, ""),
    actionName: input.actionName,
    state: input.state,
    summary: boundedString(input.summary, "", 480),
    rationale: boundedString(input.rationale, "", 960),
    clarificationQuestion: boundedString(
      input.clarificationQuestion,
      "",
      720,
    ),
    unresolvedDimensions: (Array.isArray(input.unresolvedDimensions)
      ? input.unresolvedDimensions
      : [])
      .map((entry) => boundedString(entry, "", 180))
      .filter(Boolean),
    metaRoleId: SEMANTIC_ROUTER_META_ROLE_ID,
    metaRoleInvocationRef: input.metaRoleInvocationRef,
    realizationPolicyRef: input.realizationPolicyRef,
    model: normalizeString(input.telemetry?.model, ""),
    reasoningEffort: normalizeString(
      input.telemetry?.reasoningEffort,
      "",
    ),
    admittedPolicyRef: input.admittedPolicyRef || null,
    operatorUtteranceSuppliedAuthority: true,
    metaRoleGrantedAuthority: false,
    rawUserTextIncluded: false,
    rawProviderPayloadIncluded: false,
    createdAt: normalizeString(
      input.createdAt,
      new Date().toISOString(),
    ),
  };
  return {
    ...base,
    digest: digestFor(
      "direct-active-sub-agent-policy-semantic-settlement@1",
      base,
    ),
  };
}

function requestedSpawnShape(input = {}) {
  const args = isPlainObject(input.args) ? input.args : {};
  return {
    roleId: canonicalRoleId(
      args.agent_type || args.agentType || args.role,
    ),
    providerId: normalizeString(
      args.provider || args.provider_id || args.providerId,
      "",
    ),
    model: normalizeString(args.model, ""),
    reasoningEffort: normalizeString(
      args.reasoning_effort || args.reasoningEffort,
      "",
    ),
    forkTurns: normalizeString(
      args.fork_turns || args.forkTurns,
      "",
    ),
    workspaceMode: normalizeString(
      args.workspace_mode || args.workspaceMode,
      "",
    ),
    toolProfile: normalizeString(
      args.tool_profile || args.toolProfile,
      "",
    ),
    exceptionReason: boundedString(
      args.policy_exception_reason || args.policyExceptionReason,
      "",
      720,
    ),
    policyDisposition: normalizeString(
      args.policy_disposition || args.policyDisposition,
      "",
    ),
  };
}

function effectiveDefaults(input = {}, requested = {}) {
  const providerId = requested.providerId || "chatgpt-direct";
  return {
    roleId: requested.roleId,
    providerId,
    model: requested.model ||
      PROVIDER_DEFAULT_MODELS[providerId] ||
      normalizeString(input.parentModel, ""),
    reasoningEffort:
      requested.reasoningEffort ||
      normalizeString(input.parentReasoningEffort, "medium"),
    forkTurns: requested.forkTurns || "all",
    workspaceMode: requested.workspaceMode || "reasoning_only",
    toolProfile: requested.workspaceMode === "reasoning_only"
      ? ""
      : requested.toolProfile,
  };
}

function policyBindingFor(policy, roleId) {
  return policy.roleBindings.find((entry) => entry.roleId === roleId) ||
    policy.roleBindings.find((entry) => entry.roleId === "*") ||
    normalizeRoleBinding({ roleId: "*" });
}

function buildSpawnDecision(input = {}) {
  const projectId = safeId(input.projectId, "project_id");
  const threadId = safeId(input.threadId, "thread_id");
  const requested = requestedSpawnShape(input);
  const policy = input.policy || null;
  if (!policy) {
    const base = {
      schema: DIRECT_ACTIVE_SUB_AGENT_SPAWN_DECISION_SCHEMA,
      decisionId: `direct_sub_agent_spawn_decision_${digestFor("direct-sub-agent-spawn-decision-id@1", {
        projectId,
        threadId,
        requested,
        state: "unsettled",
      }).slice(7, 31)}`,
      projectId,
      threadId,
      roleId: requested.roleId,
      state: "blocked",
      blockerCode: "direct_active_sub_agent_policy_unsettled",
      policyRef: null,
      bindingRoleId: "",
      requestedSpawn: requested,
      effectiveSpawn: null,
      inheritedFields: [],
      deviations: [],
      exceptionDisposition: "",
      launchEligible: false,
      policyUpdateRequested: false,
      grantsWorkspaceAuthority: false,
      grantsRemoteMutationAuthority: false,
      createdAt: normalizeString(
        input.createdAt,
        new Date().toISOString(),
      ),
    };
    const decision = deepFreeze({
      ...base,
      digest: digestFor(
        "direct-active-sub-agent-spawn-decision@1",
        base,
      ),
    });
    trustedSpawnDecisions.add(decision);
    return decision;
  }
  validateActiveSubAgentPolicy(policy);
  const binding = policyBindingFor(policy, requested.roleId);
  const effective = effectiveDefaults(input, requested);
  const inheritedFields = [];
  const deviations = [];
  const governed = {
    providerId: binding.providerId,
    model: binding.model,
    reasoningEffort: binding.reasoningEffort,
    forkTurns: binding.forkTurns,
    workspaceMode: binding.workspaceMode,
    toolProfile: binding.toolProfile,
  };
  for (const [field, governedValue] of Object.entries(governed)) {
    if (!governedValue) continue;
    const requestedValue = requested[field];
    if (requestedValue && requestedValue !== governedValue) {
      deviations.push({
        field,
        policyValue: governedValue,
        requestedValue,
      });
      effective[field] = requestedValue;
    } else {
      effective[field] = governedValue;
      if (!requestedValue) inheritedFields.push(field);
    }
  }
  if (
    !requested.model &&
    !binding.model &&
    PROVIDER_DEFAULT_MODELS[effective.providerId]
  ) {
    effective.model = PROVIDER_DEFAULT_MODELS[effective.providerId];
    if (!inheritedFields.includes("model")) {
      inheritedFields.push("model");
    }
  }
  if (effective.workspaceMode === "reasoning_only") {
    effective.toolProfile = "";
  }
  const activeChildren = Number(input.activeChildren || 0);
  const capacityBlocked = policy.maxActiveChildren > 0 &&
    activeChildren >= policy.maxActiveChildren;
  const disposition = requested.policyDisposition;
  const reasonSufficient = requested.exceptionReason.length >= 12;
  const oneTimeAllowed = deviations.length > 0 &&
    disposition === "one_time_exception" &&
    reasonSufficient &&
    policy.deviationRule.oneTimeAuthority ===
      "resident_reasoned_exception";
  const updateRequested = deviations.length > 0 &&
    disposition === "propose_policy_update" &&
    reasonSufficient;
  let blockerCode = "";
  if (capacityBlocked) {
    blockerCode = "direct_active_sub_agent_policy_capacity_reached";
  } else if (deviations.length && !oneTimeAllowed) {
    blockerCode = updateRequested
      ? "direct_active_sub_agent_policy_update_requires_admission"
      : !reasonSufficient
        ? "direct_active_sub_agent_policy_deviation_reason_required"
        : "direct_active_sub_agent_policy_deviation_not_authorized";
  }
  const base = {
    schema: DIRECT_ACTIVE_SUB_AGENT_SPAWN_DECISION_SCHEMA,
    decisionId: `direct_sub_agent_spawn_decision_${digestFor("direct-sub-agent-spawn-decision-id@1", {
      projectId,
      threadId,
      policyDigest: policy.digest,
      requested,
      activeChildren,
    }).slice(7, 31)}`,
    projectId,
    threadId,
    roleId: requested.roleId,
    state: blockerCode ? "blocked" : "resolved",
    blockerCode,
    policyRef: policyRef(policy),
    bindingRoleId: binding.roleId,
    requestedSpawn: requested,
    effectiveSpawn: blockerCode ? null : effective,
    inheritedFields,
    deviations,
    exceptionDisposition: oneTimeAllowed
      ? "one_time_exception"
      : updateRequested
        ? "propose_policy_update"
        : "",
    launchEligible: !blockerCode,
    policyUpdateRequested: updateRequested,
    grantsWorkspaceAuthority: false,
    grantsRemoteMutationAuthority: false,
    createdAt: normalizeString(
      input.createdAt,
      new Date().toISOString(),
    ),
  };
  const decision = deepFreeze({
    ...base,
    digest: digestFor(
      "direct-active-sub-agent-spawn-decision@1",
      base,
    ),
  });
  trustedSpawnDecisions.add(decision);
  return decision;
}

function validateActiveSubAgentSpawnDecision(value, expected = {}) {
  if (!isPlainObject(value) || !trustedSpawnDecisions.has(value)) {
    const error = new Error(
      "Sub-agent spawn decision must be issued by the active-policy service.",
    );
    error.code = "direct_active_sub_agent_policy_decision_untrusted";
    throw error;
  }
  const { digest, ...base } = value;
  if (
    value.schema !== DIRECT_ACTIVE_SUB_AGENT_SPAWN_DECISION_SCHEMA ||
    digest !== digestFor(
      "direct-active-sub-agent-spawn-decision@1",
      base,
    ) ||
    (expected.projectId && value.projectId !== expected.projectId) ||
    (expected.threadId && value.threadId !== expected.threadId)
  ) {
    const error = new Error("Sub-agent spawn policy decision is invalid.");
    error.code = "direct_active_sub_agent_policy_decision_invalid";
    throw error;
  }
  return value;
}

function buildExceptionReceipt(decision) {
  const base = {
    schema: DIRECT_ACTIVE_SUB_AGENT_POLICY_EXCEPTION_SCHEMA,
    exceptionId: `direct_sub_agent_policy_exception_${decision.digest.slice(7, 31)}`,
    projectId: decision.projectId,
    threadId: decision.threadId,
    policyRef: decision.policyRef,
    spawnDecisionRef: {
      kind: "active_sub_agent_spawn_decision",
      id: decision.decisionId,
      digest: decision.digest,
    },
    roleId: decision.roleId,
    deviations: decision.deviations,
    disposition: decision.exceptionDisposition,
    reasonSummary: boundedString(
      decision.requestedSpawn.exceptionReason,
      "",
      720,
    ),
    state: "authorized_for_single_launch_attempt",
    policyRevisionChanged: false,
    rawProviderPayloadIncluded: false,
    createdAt: normalizeString(
      decision.createdAt,
      new Date().toISOString(),
    ),
  };
  return {
    ...base,
    digest: digestFor(
      "direct-active-sub-agent-policy-exception@1",
      base,
    ),
  };
}

function buildPolicyUpdateRequest(decision) {
  const base = {
    schema: DIRECT_ACTIVE_SUB_AGENT_POLICY_UPDATE_REQUEST_SCHEMA,
    requestId: `direct_sub_agent_policy_update_${decision.digest.slice(7, 31)}`,
    projectId: decision.projectId,
    threadId: decision.threadId,
    policyRef: decision.policyRef,
    spawnDecisionRef: {
      kind: "active_sub_agent_spawn_decision",
      id: decision.decisionId,
      digest: decision.digest,
    },
    roleId: decision.roleId,
    deviations: decision.deviations,
    reasonSummary: boundedString(
      decision.requestedSpawn.exceptionReason,
      "",
      720,
    ),
    state: "candidate_only",
    requiredAdmissionAuthority:
      "operator_semantic_admission_or_worldmanager_delegation",
    launchAuthorityGranted: false,
    policyRevisionChanged: false,
    rawProviderPayloadIncluded: false,
    createdAt: normalizeString(
      decision.createdAt,
      new Date().toISOString(),
    ),
  };
  return {
    ...base,
    digest: digestFor(
      "direct-active-sub-agent-policy-update-request@1",
      base,
    ),
  };
}

class DirectActiveSubAgentPolicyService {
  constructor(options = {}) {
    this.store = options.store ||
      new ActiveSubAgentPolicyStore({
        rootDir: options.rootDir,
        now: options.now,
      });
    this.semanticRunner = typeof options.semanticRunner === "function"
      ? options.semanticRunner
      : null;
    this.metaRoleRegistry = options.metaRoleRegistry ||
      createDefaultConstitutionalMetaRoleRegistry();
    this.admissionGuard = typeof options.admissionGuard === "function"
      ? options.admissionGuard
      : null;
    this.now = typeof options.now === "function"
      ? options.now
      : Date.now;
  }

  projection(input = {}) {
    return this.store.projection(
      safeId(input.projectId, "project_id"),
      normalizeString(input.threadId, ""),
    );
  }

  admit(input = {}) {
    return this.store.admit(input);
  }

  async semanticPreflight(input = {}) {
    if (!this.semanticRunner) {
      const error = new Error(
        "Active sub-agent policy semantic router is unavailable.",
      );
      error.code =
        "direct_active_sub_agent_policy_semantic_router_unavailable";
      throw error;
    }
    const projectId = safeId(input.projectId, "project_id");
    const threadId = safeId(input.threadId, "thread_id");
    const currentProjection = this.store.projection(
      projectId,
      threadId,
    );
    const createdAt = new Date(this.now()).toISOString();
    const activationDigest = digestFor(
      "direct-active-sub-agent-policy-user-utterance@1",
      {
        projectId,
        threadId,
        clientRequestId: input.clientRequestId,
        userTextDigest: digestFor(
          "direct-active-sub-agent-policy-user-text@1",
          boundedString(input.userText, "", 12_000),
        ),
      },
    );
    const metaRoleInvocation =
      this.metaRoleRegistry.compileInvocation({
        metaRoleId: SEMANTIC_ROUTER_META_ROLE_ID,
        activationRef: {
          kind: "direct_user_policy_utterance",
          id: safeId(
            input.clientRequestId,
            "client_request_id",
          ),
          digest: activationDigest,
        },
        createdAt,
      });
    const member = this.metaRoleRegistry.member(
      SEMANTIC_ROUTER_META_ROLE_ID,
    );
    const realizationPolicy =
      this.metaRoleRegistry.realizationPolicy(
        SEMANTIC_ROUTER_META_ROLE_ID,
      );
    const tools = semanticToolSchemas();
    const result = await this.semanticRunner({
      schema:
        "direct_active_sub_agent_policy_semantic_runner_request@1",
      projectId,
      threadId,
      clientRequestId: input.clientRequestId,
      userText: input.userText,
      runtimeRoleClass: "constitutional_meta_role",
      metaRoleId: SEMANTIC_ROUTER_META_ROLE_ID,
      metaRoleInvocation,
      metaRoleRealizationPolicy: realizationPolicy,
      instructions: semanticInstructions({
        metaRoleInvocation,
      }),
      prompt: semanticPrompt({
        projectId,
        threadId,
        userText: input.userText,
        currentProjection,
        scopeBinding: POLICY_SCOPE_KINDS.has(input.scopeBinding)
          ? input.scopeBinding
          : "",
      }),
      tools,
      outputContract: {
        schema:
          "direct_active_sub_agent_policy_semantic_contract@1",
        metaRoleMemberRef: {
          kind: "constitutional_meta_role_member",
          id: member.metaRoleId,
          digest: member.digest,
        },
        metaRoleInvocationRef: {
          kind: "constitutional_meta_role_invocation",
          id: metaRoleInvocation.metaRoleInvocationId,
          digest: metaRoleInvocation.digest,
        },
        realizationPolicyRef:
          metaRoleInvocation.realizationPolicyRef,
        tools,
        exactlyOneActionRequired: true,
        grantsAuthority: false,
      },
      grantsAuthority: false,
    });
    const calls = Array.isArray(result?.actionCalls)
      ? result.actionCalls
      : [];
    if (calls.length !== 1) {
      const error = new Error(
        "Active sub-agent policy router must return exactly one action.",
      );
      error.code =
        "direct_active_sub_agent_policy_semantic_action_count_invalid";
      throw error;
    }
    const action = parseActionCall(calls[0]);
    const boundScopeKind = POLICY_SCOPE_KINDS.has(input.scopeBinding)
      ? input.scopeBinding
      : "";
    const requestedScopeKind = boundScopeKind || (
      POLICY_SCOPE_KINDS.has(
        normalizeString(action.args.scope_kind, "thread"),
      )
        ? normalizeString(action.args.scope_kind, "thread")
        : "thread"
    );
    const scope = policyScope({
      scopeKind: requestedScopeKind,
      projectId,
      threadId,
    });
    let admittedPolicy = null;
    let state = "no_change";
    if (action.name === POLICY_UPDATE_TOOL) {
      if (this.admissionGuard) {
        await this.admissionGuard({
          scope,
          projectId,
          threadId,
          clientRequestId: input.clientRequestId,
        });
      }
      const exactCurrent = this.store.exact(scope);
      admittedPolicy = this.store.admit({
        scope,
        expectedRevision: Number(exactCurrent?.revision || 0),
        roleBindings: mergeRoleBindings(
          exactCurrent,
          action.args.role_bindings,
        ),
        maxActiveChildren:
          Object.prototype.hasOwnProperty.call(
            action.args,
            "max_active_children",
          )
            ? Number(action.args.max_active_children)
            : Number(exactCurrent?.maxActiveChildren || 0),
        deviationRule: {
          ...(exactCurrent?.deviationRule || {}),
          ...(action.args.one_time_authority
            ? {
                oneTimeAuthority:
                  action.args.one_time_authority,
              }
            : {}),
        },
        provenance: {
          authorityKind: "operator_semantic_admission",
          actorId: "operator",
          sourceRef: {
            kind: "direct_user_policy_utterance",
            id: normalizeString(input.clientRequestId, ""),
            digest: activationDigest,
          },
          semanticSettlementRef: null,
        },
        createdAt,
        updatedAt: createdAt,
      });
      state = "policy_admitted";
    } else if (action.name === POLICY_CLARIFICATION_TOOL) {
      state = "clarification_required";
    }
    const settlement = buildSemanticSettlement({
      scope,
      clientRequestId: input.clientRequestId,
      actionName: action.name,
      state,
      summary: state === "no_change"
        ? "The utterance does not revise active sub-agent policy."
        : state === "clarification_required"
          ? "The possible sub-agent policy change requires clarification."
          : `Admitted active sub-agent policy fields for ${(
              action.args.role_bindings || []
            ).map((entry) => entry.role_id).filter(Boolean).join(", ") || "the bound scope"}.`,
      rationale: state === "no_change"
        ? "No durable worker-realization instruction was established."
        : state === "clarification_required"
          ? `Unresolved policy dimensions: ${(
              action.args.unresolved_dimensions || []
            ).join(", ") || "unspecified"}.`
          : "The operator utterance established standing future behavior and supplied admission authority.",
      clarificationQuestion: state === "clarification_required"
        ? `Please clarify the intended active sub-agent policy for: ${(
            action.args.unresolved_dimensions || []
          ).join(", ") || "the unresolved dimensions"}.`
        : "",
      unresolvedDimensions:
        action.args.unresolved_dimensions,
      metaRoleInvocationRef: {
        kind: "constitutional_meta_role_invocation",
        id: metaRoleInvocation.metaRoleInvocationId,
        digest: metaRoleInvocation.digest,
      },
      realizationPolicyRef:
        metaRoleInvocation.realizationPolicyRef,
      telemetry: result.telemetry,
      admittedPolicyRef: policyRef(admittedPolicy),
      createdAt,
    });
    this.store.recordSemanticSettlement(settlement);
    return {
      settlement,
      admittedPolicy: safePolicySummary(admittedPolicy),
      projection: this.store.projection(projectId, threadId),
    };
  }

  resolveSpawn(input = {}) {
    const projectId = safeId(input.projectId, "project_id");
    const threadId = safeId(input.threadId, "thread_id");
    const policy = this.store.effective(projectId, threadId);
    const decision = buildSpawnDecision({
      ...input,
      projectId,
      threadId,
      policy,
      activeChildren: policy?.scope?.scopeKind === "project"
        ? Number(
            input.projectActiveChildren ?? input.activeChildren ?? 0,
          )
        : Number(input.activeChildren || 0),
      createdAt: new Date(this.now()).toISOString(),
    });
    if (
      decision.launchEligible &&
      decision.exceptionDisposition === "one_time_exception"
    ) {
      this.store.recordException(buildExceptionReceipt(decision));
    }
    if (decision.policyUpdateRequested) {
      this.store.recordUpdateRequest(
        buildPolicyUpdateRequest(decision),
      );
    }
    return decision;
  }
}

module.exports = {
  DIRECT_ACTIVE_SUB_AGENT_POLICY_EXCEPTION_SCHEMA,
  DIRECT_ACTIVE_SUB_AGENT_POLICY_PROJECTION_SCHEMA,
  DIRECT_ACTIVE_SUB_AGENT_POLICY_SCHEMA,
  DIRECT_ACTIVE_SUB_AGENT_POLICY_SEMANTIC_SETTLEMENT_SCHEMA,
  DIRECT_ACTIVE_SUB_AGENT_POLICY_STORE_SCHEMA,
  DIRECT_ACTIVE_SUB_AGENT_POLICY_UPDATE_REQUEST_SCHEMA,
  DIRECT_ACTIVE_SUB_AGENT_SPAWN_DECISION_SCHEMA,
  POLICY_CLARIFICATION_TOOL,
  POLICY_NO_CHANGE_TOOL,
  POLICY_UPDATE_TOOL,
  ActiveSubAgentPolicyStore,
  DirectActiveSubAgentPolicyService,
  buildActiveSubAgentPolicy,
  buildSpawnDecision,
  canonicalRoleId,
  policyRef,
  safePolicySummary,
  semanticInstructions,
  semanticPrompt,
  semanticToolSchemas,
  validateActiveSubAgentPolicy,
  validateActiveSubAgentSpawnDecision,
};
