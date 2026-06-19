"use strict";

const crypto = require("node:crypto");
const {
  buildAgentLifecycleRegistry,
  buildAgentMailbox,
  buildAgentRuntimeRegistry,
  buildAgentThreadGraph,
} = require("./runtime-substrate");
const {
  buildAgentWaitPlan,
  buildSubAgentListProjection,
  buildTextOnlySubAgentToolSurface,
  buildTextSubAgentSpawnRequest,
} = require("./text-tool-surface");
const {
  buildInspectPacket,
  buildWaitStatusPacket,
} = require("./inspect-wait-containment");
const {
  buildSubAgentEChannelSnapshot,
  buildSubAgentGovernanceEnvelope,
} = require("../bridge/sub-agent-governance-envelope");
const {
  buildResidentEpistemicSnapshot,
} = require("../bridge/resident-epistemic-snapshot");

const DIRECT_LIVE_SUB_AGENT_TOOL_SURFACE_SCHEMA = "direct_live_sub_agent_tool_surface@1";
const DIRECT_LIVE_SUB_AGENT_TOOL_RESULT_SCHEMA = "direct_live_sub_agent_tool_result@1";
const DIRECT_LIVE_SUB_AGENT_TOOL_CATALOG_SCHEMA = "direct_live_sub_agent_tool_catalog@1";

const NO_INTERFERENCE_POLICIES = new Set([
  "observe_only",
  "sealed_audit",
  "blind_run",
  "operator_locked",
  "time_boxed",
  "handoff_only",
]);
const TOOL_NAMES = new Set(["spawn_agent", "list_agents", "inspect_agent", "wait_agent", "send_message"]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedString(value, maxLength = 320) {
  const text = normalizeString(value, "");
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…` : text;
}

function stableStringify(value) {
  if (value && typeof value.toJSON === "function") return stableStringify(value.toJSON());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => (entry === undefined ? "null" : stableStringify(entry))).join(",")}]`;
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined && !["surfaceDigest", "resultDigest", "catalogDigest"].includes(key))
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function digestFor(domain, value) {
  return `sha256:${crypto.createHash("sha256").update(`${domain}\0${stableStringify(value)}`).digest("hex")}`;
}

function nowIso(nowMs) {
  const ms = typeof nowMs === "number" && Number.isFinite(nowMs) ? nowMs : Date.now();
  return new Date(ms).toISOString();
}

function textEvidenceRef(kind, id, text = "", label = "") {
  return {
    kind,
    id,
    digest: digestFor(`direct-live-sub-agent-${kind}@1`, text),
    label: boundedString(label || kind, 160),
    confidence: "operator_declared",
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function resultFor(surface, toolName, patch = {}) {
  const status = normalizeString(patch.status, "completed");
  const blockerCode = normalizeString(patch.blockerCode || patch.error, "");
  const result = {
    schema: DIRECT_LIVE_SUB_AGENT_TOOL_RESULT_SCHEMA,
    toolName,
    status,
    blockerCode,
    projectId: surface.projectId,
    workThreadId: surface.workThreadId,
    primaryThreadId: surface.primaryThreadId,
    graphRevision: surface.graphRevision,
    providerTransportStarted: false,
    providerDeclarationStarted: false,
    workspaceMutationStarted: false,
    childTranscriptPromotionStarted: false,
    parentSelfBindingRespected: true,
    rawPromptIncluded: false,
    rawTranscriptIncluded: false,
    rawProviderFrameIncluded: false,
    rawSecretIncluded: false,
    observedAt: nowIso(surface.nowMs),
    ...patch,
  };
  result.resultDigest = digestFor("direct-live-sub-agent-tool-result@1", result);
  return result;
}

function isNoInterferencePolicy(value) {
  return NO_INTERFERENCE_POLICIES.has(normalizeString(value, ""));
}

function shouldBlockTargetedInterference(targetAgentId, target) {
  if (targetAgentId && !target) {
    return { blocked: true, reason: "target_agent_missing" };
  }
  if (target?.parentSelfBindingEnforced === true) {
    return { blocked: true, reason: `no_interference_policy:${target.noInterferencePolicy}` };
  }
  return { blocked: false, reason: "" };
}

function nodeFromAgent(agent) {
  return {
    agentThreadId: agent.agentThreadId,
    parentAgentThreadId: agent.parentAgentThreadId,
    displayLabel: agent.displayLabel,
    nickname: agent.nickname,
    role: agent.role,
    agentClassKind: agent.agentClassKind,
    model: agent.model,
    reasoningEffort: agent.reasoningEffort,
    nodeState: agent.lifecycleState,
    lifecycleState: agent.lifecycleState,
    activityState: agent.activityState,
    contextPacketFamilyId: "text_only_child_context",
    evidenceRefs: agent.evidenceRefs,
  };
}

function lifecycleEntryFromAgent(agent) {
  return {
    agentThreadId: agent.agentThreadId,
    lifecycleState: agent.lifecycleState,
    progressLabel: `${agent.lifecycleState}/${agent.activityState}`,
    startedAt: agent.createdAt,
    lastEventAt: agent.updatedAt,
    completedAt: agent.completedAt || "",
    terminal: ["completed", "failed", "closed"].includes(agent.lifecycleState),
    parentNotified: false,
    resultAccepted: false,
    evidenceRefs: agent.evidenceRefs,
  };
}

function messageFor(input = {}) {
  return {
    messageId: input.messageId,
    sequence: input.sequence,
    messageKind: input.messageKind,
    direction: input.direction,
    parentAgentId: input.parentAgentId,
    childAgentId: input.childAgentId,
    state: input.state || "recorded",
    createdAt: input.createdAt,
    payloadRef: input.payloadRef,
  };
}

function capabilityRow({ toolName, status, blockerCodes = [], targetAgentId = "", label = "" }) {
  const callable = status === "callable_now";
  const subjectId = `vanilla.agent.${toolName}`;
  return {
    subjectKind: "tool",
    subjectId,
    displayLabel: label || toolName,
    family: "agent_runtime",
    status,
    knowledgeClass: "exact_runtime",
    residentVisible: true,
    callableInCurrentRequest: callable,
    declaredAsProviderTool: false,
    controlState: callable ? "callable_now" : status === "blocked_by_policy" ? "blocked_by_policy" : "known_available",
    perCallAuthorityRequired: callable,
    availableActions: callable ? ["call"] : [],
    blockedActions: blockerCodes,
    controlAvailable: callable,
    controlAuthorityRequired: callable || status === "blocked_by_policy",
    epistemicVisibility: "full_status",
    transcriptVisible: "not_applicable",
    epistemicUse: callable ? "planning_context" : "avoidance_context",
    authorityUse: callable ? "may_prepare_call" : "may_not_act",
    priority: callable ? "critical" : "normal",
    omitWhenBudgeted: false,
    scope: "work_thread",
    blockerCodes,
    evidenceRefs: [{ refId: subjectId, source: "agent_graph" }],
    compactText: `${toolName} is ${status}${targetAgentId ? ` for ${targetAgentId}` : ""}; provider declaration remains disabled; local direct surface enforces policy per call.`,
    extensions: {
      toolName,
      targetAgentId,
      providerDeclarationState: "not_declared",
      localExecutor: "src/main/direct/agents/live-tool-surface.js",
    },
  };
}

class DirectLiveSubAgentToolSurface {
  constructor(input = {}) {
    this.projectId = normalizeString(input.projectId, "project_direct_live_sub_agents");
    this.workThreadId = normalizeString(input.workThreadId, "work_thread_direct_live_sub_agents");
    this.primaryThreadId = normalizeString(input.primaryThreadId, "primary_direct_agent");
    this.parentAgentId = normalizeString(input.parentAgentId, this.primaryThreadId);
    this.defaultModel = normalizeString(input.defaultModel || input.model, "gpt-5.5");
    this.defaultReasoningEffort = normalizeString(input.defaultReasoningEffort || input.reasoningEffort, "medium");
    this.nowMs = input.nowMs;
    this.graphRevision = 1;
    this.sequence = 0;
    this.agents = new Map();
    this.messages = [];
    for (const agent of Array.isArray(input.agents) ? input.agents : []) {
      const normalized = this.normalizeAgent(agent);
      this.agents.set(normalized.agentThreadId, normalized);
    }
  }

  now() {
    return nowIso(this.nowMs);
  }

  nextSequence() {
    this.sequence += 1;
    return this.sequence;
  }

  normalizeAgent(input = {}) {
    const idSource = {
      projectId: this.projectId,
      primaryThreadId: this.primaryThreadId,
      label: input.displayLabel || input.nickname || input.role || "",
      sequence: this.agents.size + 1,
    };
    const agentThreadId = normalizeString(input.agentThreadId || input.childAgentId, `direct_child_${digestFor("direct-live-sub-agent-id@1", idSource).slice(7, 23)}`);
    const createdAt = normalizeString(input.createdAt, this.now());
    const policy = normalizeString(input.noInterferencePolicy || input.selfBindingPolicy, "");
    const hasNoInterferencePolicy = isNoInterferencePolicy(policy);
    return {
      agentThreadId,
      parentAgentThreadId: normalizeString(input.parentAgentThreadId || input.parentThreadId, this.primaryThreadId),
      displayLabel: boundedString(input.displayLabel || input.nickname || input.role || `Agent ${agentThreadId.slice(0, 8)}`, 160),
      nickname: boundedString(input.nickname || input.displayLabel, 120),
      role: boundedString(input.role || "worker", 120),
      agentClassKind: normalizeString(input.agentClassKind, "sub_agent_worker"),
      model: normalizeString(input.model, this.defaultModel),
      reasoningEffort: normalizeString(input.reasoningEffort, this.defaultReasoningEffort),
      lifecycleState: normalizeString(input.lifecycleState, "running"),
      activityState: normalizeString(input.activityState, "active"),
      noInterferencePolicy: hasNoInterferencePolicy ? policy : "",
      parentSelfBindingEnforced: hasNoInterferencePolicy,
      createdAt,
      updatedAt: normalizeString(input.updatedAt, createdAt),
      completedAt: normalizeString(input.completedAt, ""),
      evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs : [{
        kind: "direct_live_sub_agent",
        id: agentThreadId,
        digest: digestFor("direct-live-sub-agent-evidence@1", { agentThreadId, createdAt }),
        label: "Direct live sub-agent state",
        confidence: "harness_observed",
      }],
    };
  }

  graph() {
    return buildAgentThreadGraph({
      projectId: this.projectId,
      primaryThreadId: this.primaryThreadId,
      graphRevision: this.graphRevision,
      nodes: [...this.agents.values()].map(nodeFromAgent),
      edges: [...this.agents.values()].map((agent) => ({
        edgeKind: "spawned",
        parentAgentThreadId: agent.parentAgentThreadId,
        childAgentThreadId: agent.agentThreadId,
        status: agent.lifecycleState,
      })),
    });
  }

  mailbox() {
    return buildAgentMailbox({
      projectId: this.projectId,
      primaryThreadId: this.primaryThreadId,
      graphId: this.graph().graphId,
      messages: this.messages,
    });
  }

  lifecycleRegistry() {
    return buildAgentLifecycleRegistry({
      projectId: this.projectId,
      graphId: this.graph().graphId,
      entries: [...this.agents.values()].map(lifecycleEntryFromAgent),
    });
  }

  runtimeRegistry() {
    return buildAgentRuntimeRegistry({
      projectId: this.projectId,
      primaryThreadId: this.primaryThreadId,
    });
  }

  inspectPacketFor(agentThreadId, reason = "operator_focus") {
    const agent = this.agents.get(agentThreadId);
    if (!agent) return null;
    return buildInspectPacket({
      projectId: this.projectId,
      workThreadId: this.workThreadId,
      primaryThreadId: this.primaryThreadId,
      agentGraphId: this.graph().graphId,
      graphRevision: this.graphRevision,
      inspectReason: reason,
      requestedAgentThreadId: agentThreadId,
      agentNode: {
        ...nodeFromAgent(agent),
        parentThreadId: agent.parentAgentThreadId,
        identityResolution: { confidence: "harness_observed" },
      },
      progressEntry: {
        progressEntryId: `progress_${agentThreadId}`,
        phase: agent.lifecycleState,
        lastEventAt: agent.updatedAt,
      },
      transcriptProjection: {
        transcriptProjectionId: `sub_agent_transcript_${agentThreadId}`,
        itemCount: this.messages.filter((message) => message.childAgentId === agentThreadId).length,
        rendererSafeItems: [],
      },
    });
  }

  governanceEnvelope() {
    const graph = this.graph();
    const policies = [...this.agents.values()]
      .filter((agent) => agent.parentSelfBindingEnforced)
      .map((agent) => ({
        agentThreadId: agent.agentThreadId,
        noInterferencePolicy: agent.noInterferencePolicy,
      }));
    return buildSubAgentGovernanceEnvelope({
      projectId: this.projectId,
      workThreadId: this.workThreadId,
      primaryThreadId: this.primaryThreadId,
      agentGraph: graph,
      progressRegistry: {
        entries: [...this.agents.values()].map((agent) => ({
          agentThreadId: agent.agentThreadId,
          phase: agent.lifecycleState,
          lastEventAt: agent.updatedAt,
        })),
      },
      inspectPackets: [...this.agents.keys()].map((agentThreadId) => this.inspectPacketFor(agentThreadId, "operator_focus")).filter(Boolean),
      policies,
      defaultNoInterferencePolicy: "observe_only",
      generatedAt: this.now(),
    });
  }

  eChannelSnapshot() {
    return buildSubAgentEChannelSnapshot({
      envelope: this.governanceEnvelope(),
      workThreadId: this.workThreadId,
      primaryThreadId: this.primaryThreadId,
    });
  }

  textOnlySurface(input = {}) {
    return buildTextOnlySubAgentToolSurface({
      projectId: this.projectId,
      primaryThreadId: this.primaryThreadId,
      graph: this.graph(),
      mailbox: this.mailbox(),
      lifecycleRegistry: this.lifecycleRegistry(),
      runtimeRegistry: this.runtimeRegistry(),
      ...input,
    });
  }

  listAgents() {
    const projection = buildSubAgentListProjection({
      projectId: this.projectId,
      primaryThreadId: this.primaryThreadId,
      graph: this.graph(),
      lifecycleRegistry: this.lifecycleRegistry(),
    });
    return resultFor(this, "list_agents", {
      status: "completed",
      result: {
        listProjection: projection,
        eChannelSnapshot: this.eChannelSnapshot(),
        liveToolCatalog: this.liveToolCatalog(),
      },
    });
  }

  spawnAgent(input = {}) {
    const prompt = normalizeString(input.prompt || input.text || input.task, "");
    if (!prompt) {
      return resultFor(this, "spawn_agent", {
        status: "blocked",
        blockerCode: "missing_spawn_prompt",
      });
    }
    const agent = this.normalizeAgent({
      ...input,
      lifecycleState: "running",
      activityState: "active",
      createdAt: this.now(),
      updatedAt: this.now(),
    });
    const spawnRequest = buildTextSubAgentSpawnRequest({
      projectId: this.projectId,
      primaryThreadId: this.primaryThreadId,
      graph: this.graph(),
      mailbox: this.mailbox(),
      runtimeRegistry: this.runtimeRegistry(),
      childAgentId: agent.agentThreadId,
      requestedAgentClassKind: agent.agentClassKind,
      promptChars: prompt.length,
      promptEvidenceRef: textEvidenceRef("spawn_prompt_ref", `spawn_prompt_${agent.agentThreadId}`, prompt, "Bounded direct spawn prompt"),
    });
    if (spawnRequest.acceptedAsTextOnlyIntent !== true) {
      return resultFor(this, "spawn_agent", {
        status: "blocked",
        blockerCode: spawnRequest.blockerCodes?.[0] || "spawn_request_not_accepted",
        result: { spawnRequest },
      });
    }
    if (this.agents.has(agent.agentThreadId)) {
      return resultFor(this, "spawn_agent", {
        status: "blocked",
        blockerCode: "duplicate_child_agent_id",
        result: {
          spawnRequest,
          existingAgentId: agent.agentThreadId,
          liveToolCatalog: this.liveToolCatalog({ targetAgentId: agent.agentThreadId }),
          eChannelSnapshot: this.eChannelSnapshot(),
        },
      });
    }
    this.agents.set(agent.agentThreadId, agent);
    const spawnSeq = this.nextSequence();
    this.messages.push(messageFor({
      messageId: `mailbox_spawn_${agent.agentThreadId}`,
      sequence: spawnSeq,
      messageKind: "spawn_intent",
      direction: "parent_to_child",
      parentAgentId: this.parentAgentId,
      childAgentId: agent.agentThreadId,
      createdAt: this.now(),
      payloadRef: textEvidenceRef("spawn_prompt_ref", `spawn_prompt_${agent.agentThreadId}`, prompt, "Bounded direct spawn prompt"),
    }));
    this.graphRevision += 1;
    return resultFor(this, "spawn_agent", {
      status: "completed",
      result: {
        agent,
        spawnRequest,
        listProjection: this.listAgents().result.listProjection,
        eChannelSnapshot: this.eChannelSnapshot(),
        liveToolCatalog: this.liveToolCatalog({ targetAgentId: agent.agentThreadId }),
      },
    });
  }

  sendMessage(input = {}) {
    const targetAgentId = normalizeString(input.targetAgentId || input.agentThreadId || input.childAgentId, "");
    const text = normalizeString(input.text || input.message || input.prompt, "");
    const agent = this.agents.get(targetAgentId);
    if (!agent) {
      return resultFor(this, "send_message", {
        status: "blocked",
        blockerCode: "target_agent_missing",
      });
    }
    if (agent.parentSelfBindingEnforced) {
      return resultFor(this, "send_message", {
        status: "blocked",
        blockerCode: `no_interference_policy_blocks_send_input:${agent.noInterferencePolicy}`,
        result: {
          liveToolCatalog: this.liveToolCatalog({ targetAgentId }),
          eChannelSnapshot: this.eChannelSnapshot(),
        },
      });
    }
    if (!text) {
      return resultFor(this, "send_message", {
        status: "blocked",
        blockerCode: "missing_message_text",
      });
    }
    const nextSeq = this.nextSequence();
    this.messages.push(messageFor({
      messageId: `mailbox_send_${targetAgentId}_${nextSeq}`,
      sequence: nextSeq,
      messageKind: "parent_prompt",
      direction: "parent_to_child",
      parentAgentId: this.parentAgentId,
      childAgentId: targetAgentId,
      createdAt: this.now(),
      payloadRef: textEvidenceRef("agent_message_ref", `agent_message_${targetAgentId}_${nextSeq}`, text, "Bounded direct parent-to-child message"),
    }));
    agent.lifecycleState = "running";
    agent.activityState = "active";
    agent.updatedAt = this.now();
    this.graphRevision += 1;
    return resultFor(this, "send_message", {
      status: "completed",
      result: {
        writeAccepted: true,
        targetAgentId,
        mailbox: this.mailbox(),
        eChannelSnapshot: this.eChannelSnapshot(),
        liveToolCatalog: this.liveToolCatalog({ targetAgentId }),
      },
    });
  }

  inspectAgent(input = {}) {
    const targetAgentId = normalizeString(input.targetAgentId || input.agentThreadId || input.childAgentId, "");
    const packet = this.inspectPacketFor(targetAgentId, "operator_focus");
    if (!packet) {
      return resultFor(this, "inspect_agent", {
        status: "blocked",
        blockerCode: "target_agent_missing",
      });
    }
    return resultFor(this, "inspect_agent", {
      status: "completed",
      result: {
        inspectPacket: packet,
        eChannelSnapshot: this.eChannelSnapshot(),
        liveToolCatalog: this.liveToolCatalog({ targetAgentId }),
      },
    });
  }

  waitAgent(input = {}) {
    const targetAgentId = normalizeString(input.targetAgentId || input.agentThreadId || input.childAgentId, "");
    const packet = this.inspectPacketFor(targetAgentId, "wait_status_refresh");
    if (!packet) {
      return resultFor(this, "wait_agent", {
        status: "blocked",
        blockerCode: "target_agent_missing",
      });
    }
    const waitPlan = buildAgentWaitPlan({
      projectId: this.projectId,
      primaryThreadId: this.primaryThreadId,
      graph: this.graph(),
      lifecycleRegistry: this.lifecycleRegistry(),
      parentAgentId: this.parentAgentId,
      targetAgentIds: [targetAgentId],
      waitMode: "specific",
      timeoutMs: input.timeoutMs || 30000,
      maxWaitDepth: input.maxWaitDepth || 1,
    });
    const waitStatus = {
      ...buildWaitStatusPacket({ inspectPacket: packet }),
      providerTransportAllowed: false,
      providerDeclarationAllowed: false,
    };
    return resultFor(this, "wait_agent", {
      status: waitPlan?.noDeadlockLawSatisfied ? "completed" : "blocked",
      blockerCode: waitPlan?.noDeadlockLawSatisfied ? "" : "wait_deadlock_or_target_law_failed",
      result: {
        waitPlan,
        waitStatus,
        eChannelSnapshot: this.eChannelSnapshot(),
        liveToolCatalog: this.liveToolCatalog({ targetAgentId }),
      },
    });
  }

  liveToolCatalog(input = {}) {
    const targetAgentId = normalizeString(input.targetAgentId, "");
    const target = this.agents.get(targetAgentId) || null;
    const sendBlock = shouldBlockTargetedInterference(targetAgentId, target);
    const rows = [
      capabilityRow({ toolName: "spawn_agent", status: "callable_now" }),
      capabilityRow({ toolName: "list_agents", status: "callable_now" }),
      capabilityRow({ toolName: "inspect_agent", status: targetAgentId && !target ? "blocked_by_policy" : "callable_now", blockerCodes: targetAgentId && !target ? ["target_agent_missing"] : [], targetAgentId }),
      capabilityRow({ toolName: "wait_agent", status: targetAgentId && !target ? "blocked_by_policy" : "callable_now", blockerCodes: targetAgentId && !target ? ["target_agent_missing"] : [], targetAgentId }),
      capabilityRow({
        toolName: "send_message",
        status: sendBlock.blocked ? "blocked_by_policy" : "callable_now",
        blockerCodes: sendBlock.blocked ? [sendBlock.reason] : [],
        targetAgentId,
      }),
    ];
    const snapshot = buildResidentEpistemicSnapshot({
      workThreadId: this.workThreadId,
      codexThreadId: this.primaryThreadId,
      runtimeFamily: "direct",
      generatedAt: this.now(),
      projectionBudget: { maxRows: 8, maxChars: 1800, truncationPolicy: "priority_then_summary" },
      rows,
    });
    const catalog = {
      schema: DIRECT_LIVE_SUB_AGENT_TOOL_CATALOG_SCHEMA,
      projectId: this.projectId,
      workThreadId: this.workThreadId,
      primaryThreadId: this.primaryThreadId,
      targetAgentId,
      rowCount: rows.length,
      rows: snapshot.rows,
      snapshot,
      callableToolIds: snapshot.rows.filter((row) => row.status === "callable_now").map((row) => row.subjectId),
      blockedToolIds: snapshot.rows.filter((row) => row.status.startsWith("blocked_")).map((row) => row.subjectId),
      providerDeclarationsEnabledByCatalog: false,
      localExecutionEnabledByCatalog: false,
      perCallAuthorityBypassed: false,
      rawPromptIncluded: false,
      rawTranscriptIncluded: false,
      rawProviderFrameIncluded: false,
      rawSecretIncluded: false,
    };
    catalog.catalogDigest = digestFor("direct-live-sub-agent-tool-catalog@1", catalog);
    return catalog;
  }

  snapshot() {
    const surface = {
      schema: DIRECT_LIVE_SUB_AGENT_TOOL_SURFACE_SCHEMA,
      projectId: this.projectId,
      workThreadId: this.workThreadId,
      primaryThreadId: this.primaryThreadId,
      graphRevision: this.graphRevision,
      agentCount: this.agents.size,
      mailboxMessageCount: this.messages.length,
      graph: this.graph(),
      mailbox: this.mailbox(),
      lifecycleRegistry: this.lifecycleRegistry(),
      textOnlySurface: this.textOnlySurface(),
      eChannelSnapshot: this.eChannelSnapshot(),
      liveToolCatalog: this.liveToolCatalog(),
      toolNames: [...TOOL_NAMES].sort(),
      providerTransportAllowed: false,
      providerDeclarationAllowed: false,
      workspaceMutationAllowed: false,
      childTranscriptPromotionAllowed: false,
      recursiveSpawnAllowed: false,
      rawPromptIncluded: false,
      rawTranscriptIncluded: false,
      rawProviderFrameIncluded: false,
      rawSecretIncluded: false,
      generatedAt: this.now(),
    };
    surface.surfaceDigest = digestFor("direct-live-sub-agent-tool-surface@1", surface);
    return surface;
  }
}

function createDirectLiveSubAgentToolSurface(input = {}) {
  return new DirectLiveSubAgentToolSurface(input);
}

function assertDirectLiveSubAgentToolSurfaceSafe(surface = {}) {
  if (!isPlainObject(surface) || surface.schema !== DIRECT_LIVE_SUB_AGENT_TOOL_SURFACE_SCHEMA) {
    throw new Error("direct_live_sub_agent_tool_surface_schema_mismatch");
  }
  for (const flag of [
    "providerTransportAllowed",
    "providerDeclarationAllowed",
    "workspaceMutationAllowed",
    "childTranscriptPromotionAllowed",
    "recursiveSpawnAllowed",
    "rawPromptIncluded",
    "rawTranscriptIncluded",
    "rawProviderFrameIncluded",
    "rawSecretIncluded",
  ]) {
    if (surface[flag] !== false) throw new Error(`direct_live_sub_agent_surface_authority_or_raw_leak:${flag}`);
  }
  for (const required of TOOL_NAMES) {
    if (!Array.isArray(surface.toolNames) || !surface.toolNames.includes(required)) {
      throw new Error(`direct_live_sub_agent_surface_tool_missing:${required}`);
    }
  }
  if (surface.liveToolCatalog?.providerDeclarationsEnabledByCatalog !== false) {
    throw new Error("direct_live_sub_agent_catalog_provider_declaration_leak");
  }
  if (surface.eChannelSnapshot?.controlAuthorityGranted !== false) {
    throw new Error("direct_live_sub_agent_e_channel_control_authority_leak");
  }
  return true;
}

module.exports = {
  DIRECT_LIVE_SUB_AGENT_TOOL_CATALOG_SCHEMA,
  DIRECT_LIVE_SUB_AGENT_TOOL_RESULT_SCHEMA,
  DIRECT_LIVE_SUB_AGENT_TOOL_SURFACE_SCHEMA,
  DirectLiveSubAgentToolSurface,
  assertDirectLiveSubAgentToolSurfaceSafe,
  createDirectLiveSubAgentToolSurface,
};
