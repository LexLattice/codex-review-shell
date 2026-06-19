"use strict";

const crypto = require("node:crypto");
const {
  createDirectLiveSubAgentToolSurface,
} = require("./live-tool-surface");

const DIRECT_PROVIDER_BACKED_SUB_AGENT_ROUTE_SCHEMA = "direct_provider_backed_sub_agent_route@1";
const DIRECT_PROVIDER_BACKED_SUB_AGENT_RESULT_SCHEMA = "direct_provider_backed_sub_agent_result@1";

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedString(value, maxLength = 420) {
  const text = normalizeString(value, "");
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…` : text;
}

function stableStringify(value) {
  if (value && typeof value.toJSON === "function") return stableStringify(value.toJSON());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => {
      const serialized = stableStringify(entry);
      return serialized === undefined ? "null" : serialized;
    }).join(",")}]`;
  }
  const parts = [];
  for (const key of Object.keys(value).filter((entry) => !["routeDigest", "resultDigest"].includes(entry)).sort()) {
    const serialized = stableStringify(value[key]);
    if (serialized !== undefined) parts.push(`${JSON.stringify(key)}:${serialized}`);
  }
  return `{${parts.join(",")}}`;
}

function digestFor(domain, value) {
  return `sha256:${crypto.createHash("sha256").update(`${domain}\0${stableStringify(value)}`).digest("hex")}`;
}

function nowIso(nowMs) {
  const ms = typeof nowMs === "number" && Number.isFinite(nowMs) ? nowMs : Date.now();
  return new Date(ms).toISOString();
}

function safeTokenUsage(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const toFiniteNumber = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
  };
  const usage = {
    inputTokens: toFiniteNumber(source.inputTokens ?? source.input_tokens),
    cachedInputTokens: toFiniteNumber(source.cachedInputTokens ?? source.cached_input_tokens),
    outputTokens: toFiniteNumber(source.outputTokens ?? source.output_tokens),
    reasoningOutputTokens: toFiniteNumber(source.reasoningOutputTokens ?? source.reasoning_output_tokens),
    totalTokens: toFiniteNumber(source.totalTokens ?? source.total_tokens),
  };
  return Object.fromEntries(Object.entries(usage).filter(([, value]) => value !== undefined));
}

function requestShapeFor(requestBody = {}) {
  const input = Array.isArray(requestBody.input) ? requestBody.input : [];
  return {
    model: normalizeString(requestBody.model, ""),
    stream: requestBody.stream === true,
    store: requestBody.store === true,
    inputMessageCount: input.length,
    textInputCount: input.reduce((count, item) => count + (Array.isArray(item?.content)
      ? item.content.filter((content) => content?.type === "input_text").length
      : 0), 0),
    toolCount: Array.isArray(requestBody.tools) ? requestBody.tools.length : 0,
    parallelToolCalls: requestBody.parallel_tool_calls === true,
    reasoningEffort: normalizeString(requestBody.reasoning?.effort || requestBody.reasoning_effort, ""),
  };
}

function buildProviderBackedSubAgentRequest(input = {}) {
  const prompt = normalizeString(input.prompt || input.text || input.task, "");
  const model = normalizeString(input.model, normalizeString(input.defaultModel, "gpt-5.5"));
  const reasoningEffort = normalizeString(
    input.reasoningEffort || input.reasoning_effort || input.effort,
    normalizeString(input.defaultReasoningEffort || input.default_reasoning_effort, "medium"),
  );
  const instructions = normalizeString(input.instructions, [
    "You are a bounded direct child agent.",
    "Answer only the delegated task.",
    "Do not claim primary-agent authority.",
    "Do not request tools unless the harness explicitly declares them for this child route.",
  ].join(" "));
  const requestBody = {
    model,
    stream: true,
    store: false,
    parallel_tool_calls: false,
    instructions,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: prompt,
          },
        ],
      },
    ],
  };
  if (reasoningEffort) requestBody.reasoning = { effort: reasoningEffort };
  return {
    requestBody,
    requestShape: requestShapeFor(requestBody),
    promptDigest: prompt ? digestFor("direct-provider-backed-sub-agent-prompt@1", prompt) : "",
    promptChars: prompt.length,
  };
}

function resultFor(route, patch = {}) {
  const status = normalizeString(patch.status, "completed");
  const blockerCode = normalizeString(patch.blockerCode || patch.error, "");
  const result = {
    ...patch,
    schema: DIRECT_PROVIDER_BACKED_SUB_AGENT_RESULT_SCHEMA,
    status,
    blockerCode,
    routeId: route.routeId,
    projectId: route.projectId,
    workThreadId: route.workThreadId,
    primaryThreadId: route.primaryThreadId,
    providerRequestStarted: patch.providerRequestStarted === true,
    providerCompleted: patch.providerCompleted === true,
    providerTransportAllowed: route.providerTransportAllowed === true,
    providerDeclarationAllowed: false,
    workspaceMutationStarted: false,
    childTranscriptPromotionStarted: false,
    usageAttribution: "agent_thread",
    rawPromptIncluded: false,
    rawProviderPayloadIncluded: false,
    rawProviderFrameIncluded: false,
    rawTranscriptIncluded: false,
    rawSecretIncluded: false,
    observedAt: nowIso(route.nowMs),
  };
  result.resultDigest = digestFor("direct-provider-backed-sub-agent-result@1", result);
  return result;
}

function normalizeProviderOutcome(outcome = {}) {
  const source = isPlainObject(outcome) ? outcome : {};
  return {
    ok: source.ok !== false,
    responseId: normalizeString(source.responseId || source.response_id, ""),
    upstreamRequestId: normalizeString(source.upstreamRequestId || source.upstream_request_id, ""),
    outputText: normalizeString(source.outputText || source.finalText || source.text, ""),
    terminalState: normalizeString(source.terminalState || source.state, source.ok === false ? "failed" : "completed"),
    tokenUsage: safeTokenUsage(source.tokenUsage || source.usage),
    errorCode: normalizeString(source.errorCode || source.error?.code, ""),
  };
}

class DirectProviderBackedSubAgentRoute {
  constructor(input = {}) {
    this.projectId = normalizeString(input.projectId, "project_provider_backed_sub_agents");
    this.workThreadId = normalizeString(input.workThreadId, "work_thread_provider_backed_sub_agents");
    this.primaryThreadId = normalizeString(input.primaryThreadId, "primary_provider_backed_sub_agents");
    this.routeId = normalizeString(input.routeId, "direct_provider_backed_sub_agent_route");
    this.nowMs = input.nowMs;
    this.defaultModel = normalizeString(input.defaultModel || input.model, "gpt-5.5");
    this.defaultReasoningEffort = normalizeString(input.defaultReasoningEffort || input.reasoningEffort, "medium");
    this.providerTurnRunner = typeof input.providerTurnRunner === "function" ? input.providerTurnRunner : null;
    this.surface = input.surface || createDirectLiveSubAgentToolSurface({
      projectId: this.projectId,
      workThreadId: this.workThreadId,
      primaryThreadId: this.primaryThreadId,
      defaultModel: this.defaultModel,
      defaultReasoningEffort: this.defaultReasoningEffort,
      nowMs: input.nowMs,
    });
    this.providerTransportAllowed = this.providerTurnRunner !== null;
  }

  descriptor() {
    const descriptor = {
      schema: DIRECT_PROVIDER_BACKED_SUB_AGENT_ROUTE_SCHEMA,
      routeId: this.routeId,
      projectId: this.projectId,
      workThreadId: this.workThreadId,
      primaryThreadId: this.primaryThreadId,
      providerTransportAllowed: this.providerTransportAllowed,
      providerDeclarationAllowed: false,
      childToolsAllowed: false,
      recursiveSpawnAllowed: false,
      workspaceMutationAllowed: false,
      childTranscriptPromotionAllowed: false,
      usageAttribution: "agent_thread",
      rawPromptIncluded: false,
      rawProviderPayloadIncluded: false,
      rawProviderFrameIncluded: false,
      rawSecretIncluded: false,
      generatedAt: nowIso(this.nowMs),
    };
    descriptor.routeDigest = digestFor("direct-provider-backed-sub-agent-route@1", descriptor);
    return descriptor;
  }

  async spawnAndRun(input = {}) {
    const request = buildProviderBackedSubAgentRequest({
      defaultModel: this.defaultModel,
      defaultReasoningEffort: this.defaultReasoningEffort,
      ...input,
    });
    if (!request.promptDigest) {
      return resultFor(this, {
        status: "blocked",
        blockerCode: "missing_spawn_prompt",
        requestShape: request.requestShape,
        providerRequestStarted: false,
      });
    }
    if (!this.providerTurnRunner) {
      return resultFor(this, {
        status: "blocked",
        blockerCode: "provider_runner_missing",
        requestShape: request.requestShape,
        providerRequestStarted: false,
      });
    }
    const spawn = this.surface.spawnAgent({
      ...input,
      prompt: normalizeString(input.prompt || input.text || input.task, ""),
      model: request.requestBody.model,
      reasoningEffort: request.requestShape.reasoningEffort,
    });
    if (spawn.status !== "completed") {
      return resultFor(this, {
        status: "blocked",
        blockerCode: spawn.blockerCode || "spawn_blocked",
        requestShape: request.requestShape,
        spawnResultDigest: spawn.resultDigest,
        providerRequestStarted: false,
      });
    }
    const agent = spawn.result.agent;
    try {
      const providerOutcome = normalizeProviderOutcome(await this.providerTurnRunner({
        agent,
        requestBody: request.requestBody,
        requestShape: request.requestShape,
        promptDigest: request.promptDigest,
        promptChars: request.promptChars,
      }));
      const terminalStatus = providerOutcome.ok ? "completed" : "failed";
      const childResult = this.surface.recordChildResult({
        targetAgentId: agent.agentThreadId,
        status: terminalStatus,
        resultText: providerOutcome.outputText || providerOutcome.errorCode || terminalStatus,
      });
      return resultFor(this, {
        status: providerOutcome.ok ? "completed" : "failed",
        blockerCode: providerOutcome.ok ? "" : providerOutcome.errorCode || "provider_child_turn_failed",
        providerRequestStarted: true,
        providerCompleted: providerOutcome.ok,
        requestShape: request.requestShape,
        promptDigest: request.promptDigest,
        agentThreadId: agent.agentThreadId,
        responseId: providerOutcome.responseId,
        upstreamRequestId: providerOutcome.upstreamRequestId,
        tokenUsage: providerOutcome.tokenUsage,
        childResultDigest: childResult.resultDigest,
        childResultPreview: boundedString(providerOutcome.outputText, 240),
        eChannelSnapshot: this.surface.eChannelSnapshot(),
        liveToolCatalog: this.surface.liveToolCatalog({ targetAgentId: agent.agentThreadId }),
      });
    } catch (error) {
      const errorCode = normalizeString(error?.code, "provider_child_turn_exception");
      const childResult = this.surface.recordChildResult({
        targetAgentId: agent.agentThreadId,
        status: "failed",
        resultText: errorCode,
      });
      return resultFor(this, {
        status: "failed",
        blockerCode: errorCode,
        providerRequestStarted: true,
        providerCompleted: false,
        requestShape: request.requestShape,
        promptDigest: request.promptDigest,
        agentThreadId: agent.agentThreadId,
        childResultDigest: childResult.resultDigest,
        eChannelSnapshot: this.surface.eChannelSnapshot(),
        liveToolCatalog: this.surface.liveToolCatalog({ targetAgentId: agent.agentThreadId }),
      });
    }
  }
}

function createDirectProviderBackedSubAgentRoute(input = {}) {
  return new DirectProviderBackedSubAgentRoute(input);
}

function assertDirectProviderBackedSubAgentRouteSafe(route = {}, result = null) {
  if (!isPlainObject(route) || route.schema !== DIRECT_PROVIDER_BACKED_SUB_AGENT_ROUTE_SCHEMA) {
    throw new Error("direct_provider_backed_sub_agent_route_schema_mismatch");
  }
  for (const flag of [
    "providerDeclarationAllowed",
    "childToolsAllowed",
    "recursiveSpawnAllowed",
    "workspaceMutationAllowed",
    "childTranscriptPromotionAllowed",
    "rawPromptIncluded",
    "rawProviderPayloadIncluded",
    "rawProviderFrameIncluded",
    "rawSecretIncluded",
  ]) {
    if (route[flag] !== false) throw new Error(`direct_provider_backed_sub_agent_route_authority_or_raw_leak:${flag}`);
  }
  if (result) {
    if (!isPlainObject(result) || result.schema !== DIRECT_PROVIDER_BACKED_SUB_AGENT_RESULT_SCHEMA) {
      throw new Error("direct_provider_backed_sub_agent_result_schema_mismatch");
    }
    for (const flag of [
      "providerDeclarationAllowed",
      "workspaceMutationStarted",
      "childTranscriptPromotionStarted",
      "rawPromptIncluded",
      "rawProviderPayloadIncluded",
      "rawProviderFrameIncluded",
      "rawTranscriptIncluded",
      "rawSecretIncluded",
    ]) {
      if (result[flag] !== false) throw new Error(`direct_provider_backed_sub_agent_result_authority_or_raw_leak:${flag}`);
    }
  }
  return true;
}

module.exports = {
  DIRECT_PROVIDER_BACKED_SUB_AGENT_RESULT_SCHEMA,
  DIRECT_PROVIDER_BACKED_SUB_AGENT_ROUTE_SCHEMA,
  DirectProviderBackedSubAgentRoute,
  assertDirectProviderBackedSubAgentRouteSafe,
  buildProviderBackedSubAgentRequest,
  createDirectProviderBackedSubAgentRoute,
};
