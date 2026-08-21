"use strict";

const {
  buildOdeuLiveCapabilityTransaction,
  buildOdeuPerCallAuthorityDecision,
  digestCanonicalJson,
  normalizeOdeuSourceRef,
  validateOdeuLiveCapabilityTransaction,
  validateOdeuPerCallAuthorityDecision,
} = require("../odeu");
const { normalizeString, nowIso } = require("../meta-session/ids");
const {
  RESIDENT_FIRST_SLICE_TOOLS,
  buildSubAgentCapabilityProfile,
} = require("./sub-agent-capability-profile");

const SUB_AGENT_PER_CALL_AUTHORITY_PACKET_SCHEMA = "sub_agent_per_call_authority_packet@1";
const SUB_AGENT_SPAWN_PLAN_SCHEMA = "sub_agent_spawn_plan@1";
const SUB_AGENT_WAIT_PLAN_SCHEMA = "sub_agent_wait_plan@1";
const SUB_AGENT_SPAWN_IDEMPOTENCY_LEDGER_SCHEMA = "sub_agent_spawn_idempotency_ledger@1";

const ALLOWED_AGENT_ROLES = Object.freeze([
  "researcher",
  "auditor",
  "summarizer",
  "implementation_observer",
  "child_worker",
]);

const ALLOWED_REASONING_EFFORTS = Object.freeze([
  "low",
  "medium",
  "high",
  "xhigh",
]);

const DEFAULT_ALLOWED_MODELS = Object.freeze([
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "stealth/ox-alpha",
  "opencode/x-preview-f-free",
]);

const ALLOWED_PROVIDER_IDS = Object.freeze([
  "chatgpt-direct",
  "openrouter-oxalpha",
  "opencode-oxalpha",
]);

function boundedText(value, max = 240) {
  const text = normalizeString(value, "");
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

function digestValue(value, domain) {
  return digestCanonicalJson(value, { domain, digestOf: "metadata" }).value;
}

function digestSpawnPlan(plan = {}) {
  const { spawnPlanDigest, ...digestablePlan } = plan;
  return digestCanonicalJson(digestablePlan, { domain: "sub-agent-spawn-plan@1", digestOf: "metadata" });
}

function sourceRefFor(toolName, options = {}) {
  return normalizeOdeuSourceRef({
    sourceRefId: `source_sub_agent_per_call_${toolName}`,
    sourceKind: "tool_call",
    sourceId: "sub_agent_per_call_authority_adapter",
    sourceConfidence: "fixture",
    freshness: "fresh",
    callId: `call_sub_agent_${toolName}`,
  }, options);
}

function buildScope(input = {}) {
  return {
    projectId: normalizeString(input.projectId, "project_sub_agent_per_call"),
    workThreadId: normalizeString(input.workThreadId, "work_thread_sub_agent_per_call"),
    threadId: normalizeString(input.parentThreadId || input.threadId, "thread_sub_agent_parent"),
    turnId: normalizeString(input.parentTurnId || input.turnId, "turn_sub_agent_parent"),
    runtimeTier: "headless_direct",
    environment: "fixture",
  };
}

function capabilityFor(profile, toolName) {
  return profile.capabilityRows.find((row) => row.capabilityKind === toolName) || null;
}

function activationFor(profile, capabilityId) {
  return profile.activationRows.find((row) => row.capabilityId === capabilityId) || null;
}

function declarationFor(profile, activationId) {
  return profile.declarationSnapshots.find((row) => row.activationId === activationId) || null;
}

function normalizeAgentIndex(input = {}) {
  const map = new Map();
  for (const agent of Array.isArray(input.agents) ? input.agents : []) {
    const agentThreadId = normalizeString(agent.agentThreadId || agent.childAgentId || agent.id, "");
    if (!agentThreadId) continue;
    map.set(agentThreadId, {
      agentThreadId,
      workThreadId: normalizeString(agent.workThreadId, input.workThreadId || ""),
      parentThreadId: normalizeString(agent.parentThreadId || agent.parentAgentThreadId, input.parentThreadId || ""),
      lifecycleState: normalizeString(agent.lifecycleState, "running"),
      stale: agent.stale === true,
      ancestors: Array.isArray(agent.ancestors) ? agent.ancestors.map((entry) => normalizeString(entry, "")).filter(Boolean) : [],
    });
  }
  return map;
}

function validateRoleModelEffort(args = {}, options = {}) {
  const blockers = [];
  const agentRole = normalizeString(args.agentRole, "child_worker");
  const provider = normalizeString(args.provider, "chatgpt-direct");
  const providerDefaultModel = provider === "openrouter-oxalpha"
    ? "stealth/ox-alpha"
    : provider === "opencode-oxalpha"
      ? "opencode/x-preview-f-free"
      : options.defaultModel || "gpt-5.5";
  const model = normalizeString(args.model, providerDefaultModel);
  const reasoningEffort = normalizeString(args.reasoningEffort, options.defaultReasoningEffort || "medium");
  const allowedModels = Array.isArray(options.allowedModels) && options.allowedModels.length ? options.allowedModels : DEFAULT_ALLOWED_MODELS;
  if (!ALLOWED_AGENT_ROLES.includes(agentRole)) blockers.push("unknown_agent_role");
  if (!ALLOWED_PROVIDER_IDS.includes(provider)) blockers.push("provider_not_allowed");
  if (!allowedModels.includes(model)) blockers.push("model_not_allowed");
  const externalModels = new Set(["stealth/ox-alpha", "opencode/x-preview-f-free"]);
  if (
    (provider === "chatgpt-direct" && externalModels.has(model)) ||
    (provider !== "chatgpt-direct" && model !== providerDefaultModel)
  ) blockers.push("provider_model_mismatch");
  if (!ALLOWED_REASONING_EFFORTS.includes(reasoningEffort)) blockers.push("reasoning_effort_not_allowed");
  return { agentRole, provider, model, reasoningEffort, allowedModels, blockers };
}

function canonicalSpawnInput(args = {}, scope = {}, policyDigest = "") {
  const task = normalizeString(args.task || args.prompt || args.text, "");
  return {
    parentWorkThreadId: scope.workThreadId,
    parentThreadId: scope.threadId,
    parentTurnId: scope.turnId,
    taskDigest: digestValue({ task }, "sub-agent-spawn-task@1"),
    agentRole: normalizeString(args.agentRole, "child_worker"),
    provider: normalizeString(args.provider, "chatgpt-direct"),
    model: normalizeString(args.model, "gpt-5.5"),
    reasoningEffort: normalizeString(args.reasoningEffort, "medium"),
    noInterferencePolicy: normalizeString(args.noInterferencePolicy, "observe_only"),
    spawnPolicyDigest: policyDigest,
  };
}

function buildIdempotencyLedger(args = {}, canonicalInput = {}, options = {}) {
  const canonicalInputDigest = digestCanonicalJson(canonicalInput, { domain: "sub-agent-spawn-idempotency-input@1", digestOf: "metadata" });
  const key = normalizeString(args.idempotencyKey, canonicalInputDigest.value);
  const existing = Array.isArray(options.existingLedger)
    ? options.existingLedger.find((row) => normalizeString(row.idempotencyKey, "") === key)
    : null;
  let status = "new";
  const blockers = [];
  if (existing?.canonicalInputDigest?.value === canonicalInputDigest.value) status = "duplicate_same_input";
  if (existing && existing.canonicalInputDigest?.value !== canonicalInputDigest.value) {
    status = "idempotency_conflict";
    blockers.push("idempotency_conflict");
  }
  const row = {
    schema: SUB_AGENT_SPAWN_IDEMPOTENCY_LEDGER_SCHEMA,
    ledgerRowId: `sub_agent_spawn_idempotency_${digestValue({ key, canonicalInputDigest }, "sub-agent-idempotency-row-id@1").slice(7, 23)}`,
    idempotencyKey: key,
    canonicalInputDigest,
    status,
    existingChildAgentId: normalizeString(existing?.childAgentId, ""),
    duplicateSuppressed: status === "duplicate_same_input",
    blockers,
    observedAt: nowIso(options.now || Date.now),
    rawTaskIncluded: false,
  };
  row.ledgerDigest = digestCanonicalJson(row, { domain: "sub-agent-spawn-idempotency-ledger@1", digestOf: "metadata" });
  return row;
}

function buildSpawnPlan(args = {}, scope = {}, options = {}) {
  const policy = validateRoleModelEffort(args, options);
  const task = normalizeString(args.task || args.prompt || args.text, "");
  const policyDigest = digestValue({
    allowedRoles: ALLOWED_AGENT_ROLES,
    allowedProviders: ALLOWED_PROVIDER_IDS,
    allowedReasoningEfforts: ALLOWED_REASONING_EFFORTS,
    allowedModels: policy.allowedModels,
  }, "sub-agent-spawn-policy@1");
  const canonicalInput = canonicalSpawnInput({
    ...args,
    agentRole: policy.agentRole,
    provider: policy.provider,
    model: policy.model,
    reasoningEffort: policy.reasoningEffort,
  }, scope, policyDigest);
  const idempotency = buildIdempotencyLedger(args, canonicalInput, options);
  const blockers = [...policy.blockers, ...idempotency.blockers];
  if (!task) blockers.push("missing_task");
  const plan = {
    schema: SUB_AGENT_SPAWN_PLAN_SCHEMA,
    spawnPlanId: `sub_agent_spawn_plan_${digestValue({ canonicalInput }, "sub-agent-spawn-plan-id@1").slice(7, 23)}`,
    parentWorkThreadId: scope.workThreadId,
    parentThreadId: scope.threadId,
    parentTurnId: scope.turnId,
    taskDigest: canonicalInput.taskDigest,
    taskPreview: boundedText(task, 220),
    agentRole: policy.agentRole,
    provider: policy.provider,
    model: policy.model,
    reasoningEffort: policy.reasoningEffort,
    childToolsEnabled: false,
    recursiveSpawnEnabled: false,
    inheritedParentAuthority: false,
    noInterferencePolicy: canonicalInput.noInterferencePolicy,
    contextPackId: normalizeString(args.contextPackId, `context_pack_${scope.turnId}`),
    requestManifestId: normalizeString(args.requestManifestId, `request_manifest_${scope.turnId}`),
    perCallAuthorityDecisionId: "",
    idempotencyKey: idempotency.idempotencyKey,
    idempotencyLedgerRow: idempotency,
    canonicalInput,
    canonicalInputDigest: idempotency.canonicalInputDigest,
    accepted: blockers.length === 0,
    blockers,
    rawTaskIncluded: false,
  };
  plan.spawnPlanDigest = digestSpawnPlan(plan);
  return plan;
}

function validateTarget(toolName, args = {}, scope = {}, agentIndex = new Map()) {
  if (!["inspect_agent", "wait_agent"].includes(toolName)) return { target: null, blockers: [] };
  const targetAgentThreadId = normalizeString(args.agentThreadId || args.targetAgentThreadId || args.childAgentId, "");
  const blockers = [];
  if (!targetAgentThreadId) blockers.push("missing_target_agent");
  const target = targetAgentThreadId ? agentIndex.get(targetAgentThreadId) : null;
  if (targetAgentThreadId && !target) blockers.push("child_missing");
  if (target?.stale) blockers.push("child_stale");
  if (target && target.workThreadId && target.workThreadId !== scope.workThreadId) blockers.push("child_wrong_work_thread");
  return { target, targetAgentThreadId, blockers };
}

function buildWaitPlan(args = {}, scope = {}, targetValidation = {}, options = {}) {
  const timeoutMs = Number.isFinite(Number(args.timeoutMs)) ? Number(args.timeoutMs) : 30000;
  const maxWaitDepth = Number.isFinite(Number(args.maxWaitDepth)) ? Number(args.maxWaitDepth) : 1;
  const targetLifecycle = targetValidation.target?.lifecycleState || "missing";
  const blockers = [...(targetValidation.blockers || [])];
  if (timeoutMs <= 0 || timeoutMs > 120000) blockers.push("invalid_timeout");
  if (maxWaitDepth < 1 || maxWaitDepth > 3) blockers.push("invalid_max_wait_depth");
  if (targetValidation.targetAgentThreadId === scope.threadId) blockers.push("wait_cycle_parent");
  if (targetValidation.target?.ancestors?.includes(scope.threadId)) blockers.push("wait_cycle_ancestor");
  if (["handoff_unknown", "unknown"].includes(targetLifecycle)) blockers.push("wait_lifecycle_unknown");
  const cycleCheck = blockers.some((blocker) => blocker.startsWith("wait_cycle")) ? "failed" : "passed";
  const lifecycle = blockers.length ? "blocked"
    : ["completed", "failed"].includes(targetLifecycle) ? `target_${targetLifecycle}`
      : "planned";
  const plan = {
    schema: SUB_AGENT_WAIT_PLAN_SCHEMA,
    waitId: `sub_agent_wait_${digestValue({ scope, target: targetValidation.targetAgentThreadId, timeoutMs, maxWaitDepth }, "sub-agent-wait-id@1").slice(7, 23)}`,
    parentThreadId: scope.threadId,
    parentTurnId: scope.turnId,
    targetAgentThreadId: normalizeString(targetValidation.targetAgentThreadId, ""),
    waitMode: "terminal_or_timeout",
    timeoutMs,
    maxWaitDepth,
    waitGraphDigest: digestCanonicalJson({
      parentThreadId: scope.threadId,
      targetAgentThreadId: normalizeString(targetValidation.targetAgentThreadId, ""),
      targetLifecycle,
    }, { domain: "sub-agent-wait-graph@1", digestOf: "metadata" }),
    cycleCheck,
    targetLifecycleAtStart: ["created", "running", "completed", "failed", "timeout", "handoff_unknown", "missing", "stale"].includes(targetLifecycle)
      ? targetLifecycle
      : "running",
    lifecycle,
    replayAllowed: false,
    blockers,
  };
  plan.waitPlanDigest = digestCanonicalJson(plan, { domain: "sub-agent-wait-plan@1", digestOf: "metadata" });
  return plan;
}

function argumentValidationFor(toolName, args, scope, helper = {}) {
  const blockers = [];
  let plan = null;
  let idempotencyLedgerRow = null;
  if (!RESIDENT_FIRST_SLICE_TOOLS.includes(toolName)) blockers.push("tool_not_in_first_slice");
  if (toolName === "spawn_agent") {
    plan = buildSpawnPlan(args, scope, helper.options || {});
    idempotencyLedgerRow = plan.idempotencyLedgerRow;
    blockers.push(...plan.blockers);
  }
  if (toolName === "inspect_agent" || toolName === "wait_agent") {
    blockers.push(...helper.targetValidation.blockers);
  }
  if (toolName === "wait_agent") {
    plan = buildWaitPlan(args, scope, helper.targetValidation, helper.options || {});
    blockers.push(...plan.blockers);
  }
  return {
    plan,
    idempotencyLedgerRow,
    argumentValidation: {
      state: blockers.length ? "invalid" : "valid",
      blockers: [...new Set(blockers)].sort((a, b) => a.localeCompare(b)),
      argumentsDigest: digestCanonicalJson({
        toolName,
        scope,
        args: {
          agentRole: args.agentRole,
          provider: args.provider,
          model: args.model,
          reasoningEffort: args.reasoningEffort,
          targetAgentThreadId: args.agentThreadId || args.targetAgentThreadId || args.childAgentId,
          timeoutMs: args.timeoutMs,
          maxWaitDepth: args.maxWaitDepth,
          idempotencyKey: args.idempotencyKey,
        },
        planDigest: plan?.spawnPlanDigest || plan?.waitPlanDigest || null,
      }, { domain: "sub-agent-per-call-arguments@1", digestOf: "metadata" }),
    },
  };
}

function buildSubAgentPerCallAuthorityPacket(input = {}, options = {}) {
  const toolName = normalizeString(input.toolName, "");
  const scope = buildScope(input);
  const profile = input.profile || buildSubAgentCapabilityProfile({
    projectId: scope.projectId,
    workThreadId: scope.workThreadId,
  }, options);
  const capability = capabilityFor(profile, toolName);
  const activation = capability ? activationFor(profile, capability.capabilityId) : null;
  const declaration = activation ? declarationFor(profile, activation.activationId) : null;
  const agentIndex = normalizeAgentIndex({
    agents: input.agents,
    workThreadId: scope.workThreadId,
    parentThreadId: scope.threadId,
  });
  const targetValidation = validateTarget(toolName, input.arguments || {}, scope, agentIndex);
  const sourceRef = sourceRefFor(toolName || "unknown", options);
  const args = input.arguments || {};
  const { plan, idempotencyLedgerRow, argumentValidation } = argumentValidationFor(toolName, args, scope, {
    targetValidation,
    options: {
      ...options,
      allowedModels: input.allowedModels,
      defaultModel: input.defaultModel,
      defaultReasoningEffort: input.defaultReasoningEffort,
      existingLedger: input.existingIdempotencyLedger,
    },
  });
  if (!capability) {
    argumentValidation.state = "invalid";
    argumentValidation.blockers = [...new Set([...argumentValidation.blockers, "capability_not_profiled"])].sort((a, b) => a.localeCompare(b));
  }
  const callId = normalizeString(input.callId, `call_sub_agent_${toolName || "unknown"}_${digestValue({ scope, toolName, args }, "sub-agent-call-id@1").slice(7, 19)}`);
  const authorityDecision = buildOdeuPerCallAuthorityDecision({
    authorityDecisionId: `authority_${callId}`,
    callId,
    capabilityId: capability?.capabilityId || `sub_agent_${toolName || "unknown"}`,
    scope,
    activationSnapshotId: declaration?.activationSnapshotId || "",
    declarationSnapshotId: declaration?.declarationSnapshotId || "",
    activationRowId: activation?.activationId || "",
    caller: "resident_model",
    callSurface: "provider_tool_call",
    argumentValidation,
    activationDecision: activation?.state || "not_found",
    policyDecision: argumentValidation.blockers.length ? "block" : "allow",
    approvalRequirement: "none",
    executorState: argumentValidation.blockers.length ? "not_started" : "ready",
    recoveryState: argumentValidation.blockers.length ? "not_retryable" : "not_needed",
    replayPolicy: toolName === "spawn_agent" && !argumentValidation.blockers.length ? "idempotent_same_key" : "never",
    sideEffectClass: capability?.sideEffectClass || "agent_runtime",
    sourceRefs: [sourceRef],
  }, options);
  if (plan && Object.prototype.hasOwnProperty.call(plan, "perCallAuthorityDecisionId")) {
    plan.perCallAuthorityDecisionId = authorityDecision.authorityDecisionId;
    plan.spawnPlanDigest = digestSpawnPlan(plan);
  }
  const transaction = buildOdeuLiveCapabilityTransaction({
    transactionId: `transaction_${callId}`,
    authorityDecision,
    lifecycle: authorityDecision.finalDecision === "block" ? "authority_blocked" : "planned",
    replayAllowed: false,
    idempotencyKey: idempotencyLedgerRow?.idempotencyKey || "",
    sourceRefs: [sourceRef],
  }, options);
  const packet = {
    schema: SUB_AGENT_PER_CALL_AUTHORITY_PACKET_SCHEMA,
    packetId: `sub_agent_authority_packet_${digestValue({ callId, toolName }, "sub-agent-authority-packet-id@1").slice(7, 23)}`,
    toolName,
    projectId: scope.projectId,
    workThreadId: scope.workThreadId,
    parentThreadId: scope.threadId,
    parentTurnId: scope.turnId,
    capabilityId: capability?.capabilityId || "",
    authorityDecision,
    transaction,
    spawnPlan: toolName === "spawn_agent" ? plan : null,
    waitPlan: toolName === "wait_agent" ? plan : null,
    idempotencyLedgerRow,
    targetValidation,
    providerTransportStarted: false,
    providerDeclarationStarted: false,
    executorStarted: false,
    workspaceMutationStarted: false,
    childProviderRunStarted: false,
    rawTaskIncluded: false,
    rawPromptIncluded: false,
    rawTranscriptIncluded: false,
    rawProviderPayloadIncluded: false,
    observedAt: nowIso(options.now || Date.now),
  };
  packet.packetDigest = digestCanonicalJson(packet, { domain: "sub-agent-per-call-authority-packet@1", digestOf: "metadata" });
  validateSubAgentPerCallAuthorityPacket(packet);
  return packet;
}

function validateSubAgentPerCallAuthorityPacket(packet = {}) {
  if (packet.schema !== SUB_AGENT_PER_CALL_AUTHORITY_PACKET_SCHEMA) throw new Error("sub_agent_per_call_authority_packet_schema_mismatch");
  validateOdeuPerCallAuthorityDecision(packet.authorityDecision);
  validateOdeuLiveCapabilityTransaction(packet.transaction, { authorityDecision: packet.authorityDecision });
  for (const flag of [
    "providerTransportStarted",
    "providerDeclarationStarted",
    "executorStarted",
    "workspaceMutationStarted",
    "childProviderRunStarted",
    "rawTaskIncluded",
    "rawPromptIncluded",
    "rawTranscriptIncluded",
    "rawProviderPayloadIncluded",
  ]) {
    if (packet[flag] !== false) throw new Error(`sub_agent_per_call_authority_boundary_leak:${flag}`);
  }
  if (packet.toolName === "spawn_agent" && packet.spawnPlan?.schema !== SUB_AGENT_SPAWN_PLAN_SCHEMA) {
    throw new Error("sub_agent_spawn_plan_missing");
  }
  if (packet.toolName === "wait_agent" && packet.waitPlan?.schema !== SUB_AGENT_WAIT_PLAN_SCHEMA) {
    throw new Error("sub_agent_wait_plan_missing");
  }
  return true;
}

module.exports = {
  ALLOWED_AGENT_ROLES,
  ALLOWED_PROVIDER_IDS,
  ALLOWED_REASONING_EFFORTS,
  DEFAULT_ALLOWED_MODELS,
  SUB_AGENT_PER_CALL_AUTHORITY_PACKET_SCHEMA,
  SUB_AGENT_SPAWN_IDEMPOTENCY_LEDGER_SCHEMA,
  SUB_AGENT_SPAWN_PLAN_SCHEMA,
  SUB_AGENT_WAIT_PLAN_SCHEMA,
  buildSubAgentPerCallAuthorityPacket,
  validateSubAgentPerCallAuthorityPacket,
};
