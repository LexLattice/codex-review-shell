"use strict";

const crypto = require("node:crypto");
const {
  createDirectLiveSubAgentToolSurface,
} = require("./live-tool-surface");
const {
  buildOdeuContextAdmissionRecord,
  buildOdeuDigest,
  buildOdeuResultEnvelope,
  digestCanonicalJson,
  normalizeOdeuSourceRef,
  validateOdeuContextAdmissionRecord,
  validateOdeuResultEnvelope,
} = require("../odeu");

const DIRECT_PROVIDER_BACKED_SUB_AGENT_ROUTE_SCHEMA = "direct_provider_backed_sub_agent_route@1";
const DIRECT_PROVIDER_BACKED_SUB_AGENT_RESULT_SCHEMA = "direct_provider_backed_sub_agent_result@1";
const SUB_AGENT_RESULT_REDUCER_POLICY_SCHEMA = "sub_agent_result_reducer_policy@1";
const SUB_AGENT_RESULT_ADMISSION_ENVELOPE_SCHEMA = "sub_agent_result_admission_envelope@1";
const SUB_AGENT_USAGE_ATTRIBUTION_ROW_SCHEMA = "sub_agent_usage_attribution_row@1";
const SUB_AGENT_USAGE_UNAVAILABLE_ROW_SCHEMA = "sub_agent_usage_unavailable_row@1";
const SUB_AGENT_EPISTEMIC_CAPTURE_OMISSION_SCHEMA = "sub_agent_epistemic_capture_omission@1";

const EXACT_TERMINAL_STATES = Object.freeze(["completed", "failed", "timeout", "cancelled"]);
const TERMINAL_STATES = Object.freeze([...EXACT_TERMINAL_STATES, "handoff_unknown"]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function publicCaptureCode(value, fallback = "") {
  const code = normalizeString(value, "");
  return /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(code) ? code : fallback;
}

function publicCaptureId(value) {
  const id = normalizeString(value, "");
  return /^[A-Za-z][A-Za-z0-9._:-]{0,255}$/.test(id) ? id : "";
}

function publicCaptureDigest(value) {
  const digest = normalizeString(value, "");
  return /^(?:sha256:)?[a-f0-9]{64}$/.test(digest) ? digest : "";
}

function normalizeEpistemicCapture(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const sourceStatus = normalizeString(source.status, "unavailable");
  const status = new Set(["pending", "captured", "failed", "unavailable"]).has(sourceStatus)
    ? sourceStatus
    : "unavailable";
  const unsafeStatus = status !== sourceStatus;
  const unsafeErrorCode = Boolean(normalizeString(source.errorCode, "")) &&
    !publicCaptureCode(source.errorCode, "");
  const unsafeReceiptDigest = Boolean(normalizeString(source.receiptDigest, "")) &&
    !publicCaptureDigest(source.receiptDigest);
  const unsafeSessionId = Boolean(normalizeString(source.sessionId, "")) &&
    !publicCaptureId(source.sessionId);
  const unsafeTurnId = Boolean(normalizeString(source.turnId, "")) &&
    !publicCaptureId(source.turnId);
  const capture = {
    status,
    errorCode: publicCaptureCode(source.errorCode, unsafeErrorCode ? "capture_error_code_invalid" : ""),
    receiptDigest: publicCaptureDigest(source.receiptDigest),
    sessionId: publicCaptureId(source.sessionId),
    turnId: publicCaptureId(source.turnId),
  };
  const complete = capture.status === "captured" &&
    !capture.errorCode &&
    Boolean(capture.receiptDigest) &&
    Boolean(capture.sessionId) &&
    Boolean(capture.turnId);
  if (complete) return { ...capture, complete: true, omission: null };
  const omissionBase = {
    schema: SUB_AGENT_EPISTEMIC_CAPTURE_OMISSION_SCHEMA,
    omissionKind: "native_child_epistemic_capture",
    captureStatus: capture.status,
    code: unsafeStatus ? "capture_status_invalid"
      : unsafeReceiptDigest ? "capture_receipt_invalid"
        : unsafeSessionId || unsafeTurnId ? "capture_identity_invalid"
          : capture.errorCode || (capture.status === "captured"
            ? capture.receiptDigest ? "capture_identity_missing" : "capture_receipt_missing"
            : `epistemic_capture_${capture.status}`),
    evidencePosture: "provider_result_without_complete_local_capture",
    rawProviderPayloadIncluded: false,
    rawTranscriptIncluded: false,
    rawSecretIncluded: false,
  };
  const omissionDigest = digestFor("sub-agent-epistemic-capture-omission@1", omissionBase);
  return {
    ...capture,
    complete: false,
    omission: {
      ...omissionBase,
      omissionId: `sub_agent_capture_omission_${omissionDigest.slice(7, 23)}`,
      omissionDigest,
    },
  };
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

function sourceRefFor(route, callId, sourceKind = "provider_response") {
  return normalizeOdeuSourceRef({
    sourceRefId: `source_sub_agent_provider_backed_${callId}`,
    sourceKind,
    sourceId: route.routeId,
    sourceConfidence: "provider_reported",
    freshness: "fresh",
    callId,
  }, { now: route.nowMs });
}

function buildSubAgentResultReducerPolicy(input = {}) {
  const maxSummaryChars = Number.isFinite(Number(input.maxSummaryChars)) ? Number(input.maxSummaryChars) : 420;
  const policy = {
    schema: SUB_AGENT_RESULT_REDUCER_POLICY_SCHEMA,
    policyId: normalizeString(input.policyId, "sub_agent_result_reducer_policy_default"),
    maxSummaryChars: Math.max(80, Math.min(1200, maxSummaryChars)),
    includeArtifactRefs: input.includeArtifactRefs !== false,
    includeUsageSummary: input.includeUsageSummary !== false,
    includeTranscriptQuotes: false,
    includeRawProviderPayload: false,
    includeRawPrompt: false,
  };
  policy.policyDigest = digestCanonicalJson(policy, { domain: "sub-agent-result-reducer-policy@1", digestOf: "metadata" });
  return policy;
}

function normalizeTerminalState(value, ok = true, fallback = "") {
  const normalized = normalizeString(value, "");
  if (TERMINAL_STATES.includes(normalized)) return normalized;
  if (normalized === "canceled") return "cancelled";
  if (normalized === "timed_out") return "timeout";
  if (normalized === "unknown") return "handoff_unknown";
  if (fallback && TERMINAL_STATES.includes(fallback)) return fallback;
  return ok ? "completed" : "failed";
}

function reduceSubAgentResult(input = {}) {
  const policy = buildSubAgentResultReducerPolicy(input.policy || {});
  const terminalState = normalizeTerminalState(input.terminalState, input.ok !== false);
  const sourceText = normalizeString(input.outputText || input.errorCode, "");
  const fallback = terminalState === "completed" ? "Child agent completed."
    : terminalState === "handoff_unknown" ? "Child agent handoff state is unknown."
      : `Child agent ended with status: ${terminalState}.`;
  const summaryText = boundedString(sourceText || fallback, policy.maxSummaryChars);
  const truncationState = sourceText && summaryText !== sourceText ? "truncated" : "none";
  const summary = {
    summaryText,
    summaryPolicyId: policy.policyId,
    sourceResultDigest: digestFor("sub-agent-result-source-metadata@1", {
      terminalState,
      outputChars: sourceText.length,
      responseId: normalizeString(input.responseId, ""),
      upstreamRequestId: normalizeString(input.upstreamRequestId, ""),
    }),
    summaryDigest: digestFor("sub-agent-result-summary@1", {
      terminalState,
      summaryText,
      truncationState,
    }),
    truncationState,
    redactionState: "none_needed",
    rawChildOutputIncluded: false,
    rawChildPromptIncluded: false,
    rawProviderPayloadIncluded: false,
  };
  return { policy, summary, terminalState };
}

function usageRowFor(route, input = {}) {
  const tokenUsage = safeTokenUsage(input.tokenUsage);
  const childAgentId = normalizeString(input.childAgentId, "");
  const childThreadId = normalizeString(input.childThreadId, childAgentId);
  if (Object.keys(tokenUsage).length) {
    const row = {
      schema: SUB_AGENT_USAGE_ATTRIBUTION_ROW_SCHEMA,
      usageAttributionId: `sub_agent_usage_${digestFor("sub-agent-usage-row-id@1", { childAgentId, tokenUsage }).slice(7, 23)}`,
      projectId: route.projectId,
      workThreadId: route.workThreadId,
      primaryThreadId: route.primaryThreadId,
      childAgentId,
      childThreadId,
      model: normalizeString(input.model, route.defaultModel),
      reasoningEffort: normalizeString(input.reasoningEffort, route.defaultReasoningEffort),
      sourceKind: "provider_reported",
      tokenUsage,
      confidence: "provider_reported",
      rawProviderPayloadIncluded: false,
      observedAt: nowIso(route.nowMs),
    };
    row.usageDigest = digestCanonicalJson(row, { domain: "sub-agent-usage-attribution-row@1", digestOf: "metadata" });
    return { usageAttributionRow: row, usageUnavailableRow: null };
  }
  const row = {
    schema: SUB_AGENT_USAGE_UNAVAILABLE_ROW_SCHEMA,
    usageUnavailableId: `sub_agent_usage_unavailable_${digestFor("sub-agent-usage-unavailable-row-id@1", { childAgentId, childThreadId }).slice(7, 23)}`,
    projectId: route.projectId,
    workThreadId: route.workThreadId,
    primaryThreadId: route.primaryThreadId,
    childAgentId,
    childThreadId,
    unavailableKind: "token_usage_missing",
    targetKind: "agent",
    reason: "provider_usage_not_exposed",
    confidence: "unavailable",
    rawProviderPayloadIncluded: false,
    observedAt: nowIso(route.nowMs),
  };
  row.unavailableDigest = digestCanonicalJson(row, { domain: "sub-agent-usage-unavailable-row@1", digestOf: "metadata" });
  return { usageAttributionRow: null, usageUnavailableRow: row };
}

function buildResultAdmissionArtifacts(route, input = {}) {
  const callId = normalizeString(input.callId, `sub_agent_provider_${normalizeString(input.childAgentId, "unknown")}`);
  const childAgentId = normalizeString(input.childAgentId, "");
  const childThreadId = normalizeString(input.childThreadId, childAgentId);
  const sourceRef = sourceRefFor(route, callId);
  const terminalState = normalizeTerminalState(input.terminalState, input.ok !== false, input.fallbackTerminalState);
  const terminalExact = EXACT_TERMINAL_STATES.includes(terminalState);
  const { policy, summary } = reduceSubAgentResult({
    policy: input.reducerPolicy,
    terminalState,
    ok: input.ok,
    outputText: terminalExact ? input.outputText : "",
    errorCode: input.errorCode,
    responseId: input.responseId,
    upstreamRequestId: input.upstreamRequestId,
  });
  const { usageAttributionRow, usageUnavailableRow } = usageRowFor(route, {
    childAgentId,
    childThreadId,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    tokenUsage: input.tokenUsage,
  });
  const epistemicCapture = normalizeEpistemicCapture(input.epistemicCapture);
  const familyExtension = {
    childAgentId,
    childThreadId,
    terminalState,
    terminalExact,
    summaryPolicyId: policy.policyId,
    summaryDigest: summary.summaryDigest,
    usageAttributionId: usageAttributionRow?.usageAttributionId || "",
    usageUnavailableId: usageUnavailableRow?.usageUnavailableId || "",
    childTranscriptFlattened: false,
    admittedToPrimaryTranscript: "activity_summary_only",
    rawChildPromptIncluded: false,
    rawChildTranscriptIncluded: false,
    rawProviderPayloadIncluded: false,
    epistemicCaptureStatus: epistemicCapture.status,
    epistemicCaptureComplete: epistemicCapture.complete,
    epistemicCaptureReceiptDigest: epistemicCapture.receiptDigest,
    epistemicCaptureErrorCode: epistemicCapture.errorCode,
    epistemicCaptureOmission: epistemicCapture.omission,
  };
  const resultEnvelope = buildOdeuResultEnvelope({
    resultEnvelopeId: `sub_agent_result_envelope_${digestFor("sub-agent-result-envelope-id@1", { routeId: route.routeId, callId, childAgentId }).slice(7, 23)}`,
    capabilityId: "capability_sub_agent_provider_backed_spawn_run",
    callId,
    resultKind: terminalExact ? "agent_result" : "status",
    familyResultKind: "sub_agent_child_result_summary",
    familyExtension,
    sourceRefs: [sourceRef],
    resultDigest: digestCanonicalJson(familyExtension, { domain: "sub-agent-result-family-extension@1", digestOf: "metadata" }),
    rendererSafeSummary: summary.summaryText,
    providerVisibleSummary: terminalExact ? summary.summaryText : "",
    visibility: {
      localRecorded: true,
      rendererVisible: "summary",
      residentVisible: terminalExact ? "summary" : "status_only",
      providerVisible: terminalExact ? "summary_only" : "not_seen",
      transcriptVisible: "summary",
    },
    payloadPolicy: {
      rawPayloadStored: false,
      rawPayloadProviderSent: false,
      rawPayloadRendererVisible: false,
      redactionState: summary.redactionState,
      truncationState: summary.truncationState,
    },
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawProviderPayloadIncluded: false,
    confidence: terminalExact && epistemicCapture.complete ? "exact" : "partial",
  }, { now: route.nowMs });
  const admission = buildOdeuContextAdmissionRecord({
    admissionId: `sub_agent_result_admission_${digestFor("sub-agent-result-admission-id@1", { resultEnvelopeId: resultEnvelope.resultEnvelopeId }).slice(7, 23)}`,
    resultEnvelopeId: resultEnvelope.resultEnvelopeId,
    contextPackId: normalizeString(input.contextPackId, ""),
    requestManifestId: normalizeString(input.requestManifestId, ""),
    admissionDecision: terminalExact ? "admit" : "do_not_admit",
    admittedAs: terminalExact ? "agent_result_summary" : "not_admitted",
    providerSawResult: terminalExact ? "summary_only" : "not_seen",
    omissionLedgerRefs: epistemicCapture.omission ? [epistemicCapture.omission.omissionId] : [],
    admissionPolicyDigest: buildOdeuDigest({
      digestOf: "metadata",
      unavailableReason: epistemicCapture.omission
        ? epistemicCapture.omission.code
        : terminalExact ? "not_applicable" : "source_unavailable",
    }),
    sourceRefs: [sourceRef],
  }, { now: route.nowMs });
  const resultAdmissionEnvelope = {
    schema: SUB_AGENT_RESULT_ADMISSION_ENVELOPE_SCHEMA,
    envelopeId: `sub_agent_result_admission_envelope_${digestFor("sub-agent-result-admission-envelope-id@1", { childAgentId, resultEnvelopeId: resultEnvelope.resultEnvelopeId }).slice(7, 23)}`,
    childAgentId,
    childThreadId,
    spawnPlanId: normalizeString(input.spawnPlanId, ""),
    waitPlanId: normalizeString(input.waitPlanId, ""),
    terminalState,
    terminalExact,
    resultEnvelopeId: resultEnvelope.resultEnvelopeId,
    contextAdmissionId: admission.admissionId,
    admittedToParentContext: terminalExact,
    admittedToPrimaryTranscript: "activity_summary_only",
    childTranscriptFlattened: false,
    rawChildPromptIncluded: false,
    rawChildTranscriptIncluded: false,
    rawProviderPayloadIncluded: false,
    epistemicCapture: {
      status: epistemicCapture.status,
      errorCode: epistemicCapture.errorCode,
      receiptDigest: epistemicCapture.receiptDigest,
      sessionId: epistemicCapture.sessionId,
      turnId: epistemicCapture.turnId,
    },
    epistemicCaptureComplete: epistemicCapture.complete,
    epistemicCaptureOmission: epistemicCapture.omission,
    summary,
    usageAttributionRef: usageAttributionRow?.usageAttributionId || usageUnavailableRow?.usageUnavailableId || "",
    observedAt: nowIso(route.nowMs),
  };
  resultAdmissionEnvelope.envelopeDigest = digestCanonicalJson(resultAdmissionEnvelope, { domain: "sub-agent-result-admission-envelope@1", digestOf: "metadata" });
  validateOdeuResultEnvelope(resultEnvelope);
  validateOdeuContextAdmissionRecord(admission);
  return {
    reducerPolicy: policy,
    reducedSummary: summary,
    resultEnvelope,
    contextAdmission: admission,
    resultAdmissionEnvelope,
    usageAttributionRow,
    usageUnavailableRow,
    epistemicCapture: resultAdmissionEnvelope.epistemicCapture,
    epistemicCaptureComplete: epistemicCapture.complete,
    epistemicCaptureOmission: epistemicCapture.omission,
  };
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

function normalizeContextHandoffMessages(input = {}) {
  const source = Array.isArray(input.contextMessages)
    ? input.contextMessages
    : Array.isArray(input.parentContextMessages)
      ? input.parentContextMessages
      : [];
  return source
    .map((message) => ({
      role: normalizeString(message?.role, ""),
      text: normalizeString(message?.text || message?.content, ""),
    }))
    .filter((message) => ["user", "assistant"].includes(message.role) && message.text)
    .slice(-200);
}

function contextHandoffPrompt(messages = [], task = "") {
  if (!messages.length) return task;
  const context = messages
    .map((message) => `${message.role === "assistant" ? "Assistant" : "User"}: ${message.text}`)
    .join("\n\n");
  return [
    "[ADMITTED PARENT CONTEXT]",
    context,
    "[END ADMITTED PARENT CONTEXT]",
    "",
    "[DELEGATED TASK]",
    task,
  ].join("\n");
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
  const contextMessages = normalizeContextHandoffMessages(input);
  const contextMode = normalizeString(
    input.contextHandoffMode || input.contextMode,
    contextMessages.length ? "full" : "none",
  );
  const providerPrompt = contextHandoffPrompt(contextMessages, prompt);
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
            text: providerPrompt,
          },
        ],
      },
    ],
  };
  if (reasoningEffort) requestBody.reasoning = { effort: reasoningEffort };
  const requestShape = {
    ...requestShapeFor(requestBody),
    contextHandoffMode: contextMode,
    contextMessageCount: contextMessages.length,
    contextHandoffIndependentOfRuntimeProfile: true,
  };
  return {
    requestBody,
    requestShape,
    promptDigest: prompt ? digestFor("direct-provider-backed-sub-agent-prompt@1", prompt) : "",
    promptChars: prompt.length,
    contextDigest: contextMessages.length
      ? digestFor("direct-provider-backed-sub-agent-context@1", contextMessages)
      : "",
    contextMessageCount: contextMessages.length,
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
  const ok = source.ok !== false;
  const epistemicCapture = normalizeEpistemicCapture(source.epistemicCapture);
  return {
    ok,
    responseId: normalizeString(source.responseId || source.response_id, ""),
    upstreamRequestId: normalizeString(source.upstreamRequestId || source.upstream_request_id, ""),
    outputText: normalizeString(source.outputText || source.finalText || source.text, ""),
    terminalState: normalizeTerminalState(source.terminalState || source.state, ok),
    tokenUsage: safeTokenUsage(source.tokenUsage || source.usage),
    errorCode: normalizeString(source.errorCode || source.error?.code, ""),
    epistemicCapture,
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
      contextHandoffIndependentOfModel: true,
      contextHandoffIndependentOfReasoningEffort: true,
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
    if (input.signal?.aborted) {
      return resultFor(this, {
        status: "cancelled",
        blockerCode: "provider_child_turn_aborted",
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
        projectId: this.projectId,
        workThreadId: this.workThreadId,
        primaryThreadId: this.primaryThreadId,
        requestBody: request.requestBody,
        requestShape: request.requestShape,
        promptDigest: request.promptDigest,
        contextDigest: request.contextDigest,
        contextMessageCount: request.contextMessageCount,
        promptChars: request.promptChars,
        attemptId: normalizeString(input.callId, `call_provider_backed_${agent.agentThreadId}`),
        signal: input.signal,
      }));
      const terminalStatus = providerOutcome.terminalState;
      const terminalExact = EXACT_TERMINAL_STATES.includes(terminalStatus);
      const childResult = this.surface.recordChildResult({
        targetAgentId: agent.agentThreadId,
        status: terminalStatus,
        statusOnly: terminalStatus === "handoff_unknown",
        resultText: terminalExact ? providerOutcome.outputText || providerOutcome.errorCode || terminalStatus : terminalStatus,
      });
      const admissionArtifacts = buildResultAdmissionArtifacts(this, {
        callId: normalizeString(input.callId, `call_provider_backed_${agent.agentThreadId}`),
        childAgentId: agent.agentThreadId,
        childThreadId: agent.agentThreadId,
        spawnPlanId: normalizeString(input.spawnPlanId, ""),
        waitPlanId: normalizeString(input.waitPlanId, ""),
        contextPackId: normalizeString(input.contextPackId, ""),
        requestManifestId: normalizeString(input.requestManifestId, ""),
        terminalState: terminalStatus,
        ok: providerOutcome.ok,
        outputText: providerOutcome.outputText,
        errorCode: providerOutcome.errorCode,
        responseId: providerOutcome.responseId,
        upstreamRequestId: providerOutcome.upstreamRequestId,
        model: request.requestShape.model,
        reasoningEffort: request.requestShape.reasoningEffort,
        tokenUsage: providerOutcome.tokenUsage,
        epistemicCapture: providerOutcome.epistemicCapture,
        epistemicCaptureComplete: providerOutcome.epistemicCapture.complete,
      });
      return resultFor(this, {
        status: terminalStatus,
        blockerCode: terminalStatus === "completed" ? "" : providerOutcome.errorCode || `provider_child_turn_${terminalStatus}`,
        providerRequestStarted: true,
        providerCompleted: providerOutcome.ok && terminalStatus === "completed",
        requestShape: request.requestShape,
        promptDigest: request.promptDigest,
        contextDigest: request.contextDigest,
        contextMessageCount: request.contextMessageCount,
        agentThreadId: agent.agentThreadId,
        responseId: providerOutcome.responseId,
        upstreamRequestId: providerOutcome.upstreamRequestId,
        tokenUsage: providerOutcome.tokenUsage,
        epistemicCapture: providerOutcome.epistemicCapture,
        epistemicCaptureComplete: providerOutcome.epistemicCapture.complete,
        childResultDigest: childResult.resultDigest,
        childResultPreview: terminalExact ? admissionArtifacts.reducedSummary.summaryText : "",
        ...admissionArtifacts,
        eChannelSnapshot: this.surface.eChannelSnapshot(),
        liveToolCatalog: this.surface.liveToolCatalog({ targetAgentId: agent.agentThreadId }),
        childOutputPromotedToPrimaryTranscript: false,
        primaryTranscriptMutationStarted: false,
      });
    } catch (error) {
      const aborted = input.signal?.aborted || error?.name === "AbortError";
      const errorCode = aborted
        ? "provider_child_turn_aborted"
        : normalizeString(error?.code, "provider_child_turn_exception");
      const childResult = this.surface.recordChildResult({
        targetAgentId: agent.agentThreadId,
        status: aborted ? "cancelled" : "failed",
        resultText: errorCode,
      });
      return resultFor(this, {
        status: aborted ? "cancelled" : "failed",
        blockerCode: errorCode,
        providerRequestStarted: true,
        providerCompleted: false,
        requestShape: request.requestShape,
        promptDigest: request.promptDigest,
        contextDigest: request.contextDigest,
        contextMessageCount: request.contextMessageCount,
        agentThreadId: agent.agentThreadId,
        childResultDigest: childResult.resultDigest,
        ...buildResultAdmissionArtifacts(this, {
          callId: normalizeString(input.callId, `call_provider_backed_${agent.agentThreadId}`),
          childAgentId: agent.agentThreadId,
          childThreadId: agent.agentThreadId,
          spawnPlanId: normalizeString(input.spawnPlanId, ""),
          waitPlanId: normalizeString(input.waitPlanId, ""),
          contextPackId: normalizeString(input.contextPackId, ""),
          requestManifestId: normalizeString(input.requestManifestId, ""),
          terminalState: aborted ? "cancelled" : "failed",
          ok: false,
          outputText: "",
          errorCode,
          model: request.requestShape.model,
          reasoningEffort: request.requestShape.reasoningEffort,
          tokenUsage: {},
        }),
        eChannelSnapshot: this.surface.eChannelSnapshot(),
        liveToolCatalog: this.surface.liveToolCatalog({ targetAgentId: agent.agentThreadId }),
        childOutputPromotedToPrimaryTranscript: false,
        primaryTranscriptMutationStarted: false,
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
    for (const flag of ["childOutputPromotedToPrimaryTranscript", "primaryTranscriptMutationStarted"]) {
      if (Object.prototype.hasOwnProperty.call(result, flag) && result[flag] !== false) {
        throw new Error(`direct_provider_backed_sub_agent_result_authority_or_raw_leak:${flag}`);
      }
    }
    if (result.epistemicCapture) {
      const capture = normalizeEpistemicCapture(result.epistemicCapture);
      if (result.epistemicCaptureComplete !== capture.complete) {
        throw new Error("direct_provider_backed_sub_agent_capture_completeness_mismatch");
      }
      if (capture.omission) {
        if (result.epistemicCaptureOmission?.omissionId !== capture.omission.omissionId) {
          throw new Error("direct_provider_backed_sub_agent_capture_omission_missing");
        }
        if (!result.contextAdmission?.omissionLedgerRefs?.includes(capture.omission.omissionId)) {
          throw new Error("direct_provider_backed_sub_agent_capture_omission_unreferenced");
        }
        for (const flag of ["rawProviderPayloadIncluded", "rawTranscriptIncluded", "rawSecretIncluded"]) {
          if (result.epistemicCaptureOmission[flag] !== false) {
            throw new Error(`direct_provider_backed_sub_agent_capture_omission_raw_leak:${flag}`);
          }
        }
        if (result.resultEnvelope?.confidence === "exact") {
          throw new Error("direct_provider_backed_sub_agent_capture_omission_exact_confidence");
        }
      }
    }
    if (result.resultEnvelope) validateOdeuResultEnvelope(result.resultEnvelope);
    if (result.contextAdmission) validateOdeuContextAdmissionRecord(result.contextAdmission);
    if (result.resultAdmissionEnvelope) {
      for (const flag of ["childTranscriptFlattened", "rawChildPromptIncluded", "rawChildTranscriptIncluded", "rawProviderPayloadIncluded"]) {
        if (result.resultAdmissionEnvelope[flag] !== false) {
          throw new Error(`sub_agent_result_admission_boundary_leak:${flag}`);
        }
      }
    }
  }
  return true;
}

module.exports = {
  DIRECT_PROVIDER_BACKED_SUB_AGENT_RESULT_SCHEMA,
  DIRECT_PROVIDER_BACKED_SUB_AGENT_ROUTE_SCHEMA,
  SUB_AGENT_RESULT_ADMISSION_ENVELOPE_SCHEMA,
  SUB_AGENT_EPISTEMIC_CAPTURE_OMISSION_SCHEMA,
  SUB_AGENT_RESULT_REDUCER_POLICY_SCHEMA,
  SUB_AGENT_USAGE_ATTRIBUTION_ROW_SCHEMA,
  SUB_AGENT_USAGE_UNAVAILABLE_ROW_SCHEMA,
  DirectProviderBackedSubAgentRoute,
  assertDirectProviderBackedSubAgentRouteSafe,
  buildProviderBackedSubAgentRequest,
  buildSubAgentResultReducerPolicy,
  createDirectProviderBackedSubAgentRoute,
  normalizeEpistemicCapture,
};
