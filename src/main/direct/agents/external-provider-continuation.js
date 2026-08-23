"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const EXTERNAL_PROVIDER_CONTINUATION_TRACE_SCHEMA = "direct_external_provider_continuation_trace@1";
const PROVIDER_CHATGPT_DIRECT = "chatgpt-direct";
const PROVIDER_OPENROUTER_OXALPHA = "openrouter-oxalpha";
const PROVIDER_OPENCODE_OXALPHA = "opencode-oxalpha";
const OPENROUTER_OXALPHA_MODEL = "stealth/ox-alpha";
const OPENCODE_OXALPHA_MODEL = "opencode/x-preview-f-free";
const DEFAULT_OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const MAX_OPENCODE_REBASE_OUTPUT_CHARS = 128 * 1024;
const DEFAULT_OPENCODE_RUN_RETENTION_MS = 7 * 24 * 60 * 60_000;
const DEFAULT_OPENCODE_MAX_RETAINED_RUNS = 32;
const DEFAULT_OPENCODE_MAX_RETAINED_BYTES = 64 * 1024 * 1024;
const OPENCODE_RUN_RETENTION_SCHEMA = "direct_opencode_run_retention@1";
const OPENCODE_LAUNCH_TARGET_SCHEMA = "direct_opencode_launch_target@1";
const DEFAULT_CONTINUATION_PROMPT = [
  "Continue from exactly where the prior response stopped.",
  "Do not restart or repeat completed material.",
  "Finish the delegated task and return its terminal answer.",
].join(" ");
const EXTERNAL_PROVIDER_IDS = Object.freeze([
  PROVIDER_OPENROUTER_OXALPHA,
  PROVIDER_OPENCODE_OXALPHA,
]);

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(min, Math.min(max, Math.floor(number)))
    : fallback;
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

function safeError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function abortError() {
  const error = safeError("direct_external_provider_aborted", "External provider child turn was aborted.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function defaultOpenRouterEnvFile(options = {}) {
  const env = options.env || process.env;
  const configured = normalizeString(env.CODEX_OPENROUTER_ENV_FILE, "");
  if (configured) return path.resolve(configured);
  const home = normalizeString(options.homeDir, os.homedir());
  return path.join(home, ".config", "codex", "secrets", "openrouter.env");
}

function parseEnvAssignment(source = "", name = "") {
  for (const rawLine of String(source).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match || match[1] !== name) continue;
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) value = value.slice(1, -1);
    return value.trim();
  }
  return "";
}

function loadOpenRouterApiKey(options = {}) {
  const env = options.env || process.env;
  const inherited = normalizeString(env.OPENROUTER_API_KEY, "");
  if (inherited) return { apiKey: inherited, source: "process_environment", envFile: "" };
  const envFile = defaultOpenRouterEnvFile(options);
  let stat;
  try {
    stat = (options.statSync || fs.statSync)(envFile);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw safeError("direct_openrouter_credentials_missing", "OpenRouter credentials are unavailable.");
    }
    throw safeError("direct_openrouter_credentials_unreadable", "OpenRouter credentials could not be read.");
  }
  if (!stat.isFile()) {
    throw safeError("direct_openrouter_credentials_invalid", "OpenRouter credential source is not a regular file.");
  }
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
    throw safeError("direct_openrouter_credentials_permissions_unsafe", "OpenRouter credential file must not be group/world accessible.");
  }
  let source;
  try {
    source = (options.readFileSync || fs.readFileSync)(envFile, "utf8");
  } catch {
    throw safeError("direct_openrouter_credentials_unreadable", "OpenRouter credentials could not be read.");
  }
  const apiKey = parseEnvAssignment(source, "OPENROUTER_API_KEY");
  if (!apiKey) throw safeError("direct_openrouter_credentials_missing", "OpenRouter credentials are unavailable.");
  return { apiKey, source: "protected_env_file", envFile };
}

function resolveOpenRouterEndpoint(options = {}) {
  const env = options.env || process.env;
  const optionEndpoint = normalizeString(options.endpoint, "");
  const configuredEndpoint = optionEndpoint || normalizeString(
    env.CODEX_OPENROUTER_ENDPOINT,
    DEFAULT_OPENROUTER_ENDPOINT,
  );
  let endpoint;
  try {
    endpoint = new URL(configuredEndpoint);
  } catch {
    throw safeError("direct_openrouter_endpoint_invalid", "OpenRouter endpoint is not a valid URL.");
  }
  if (endpoint.protocol !== "https:") {
    throw safeError("direct_openrouter_endpoint_insecure", "OpenRouter endpoint must use HTTPS.");
  }
  if (endpoint.username || endpoint.password || endpoint.hash) {
    throw safeError("direct_openrouter_endpoint_invalid", "OpenRouter endpoint must not contain credentials or a fragment.");
  }
  const defaultOrigin = new URL(DEFAULT_OPENROUTER_ENDPOINT).origin;
  const trustedProgrammaticOverride = Boolean(
    optionEndpoint && options.allowCustomOpenRouterEndpoint === true,
  );
  if (endpoint.origin !== defaultOrigin && !trustedProgrammaticOverride) {
    throw safeError(
      "direct_openrouter_endpoint_untrusted",
      "OpenRouter credentials may only be sent to the OpenRouter origin.",
    );
  }
  return endpoint.toString();
}

function providerDefaultModel(providerId = "") {
  if (providerId === PROVIDER_OPENROUTER_OXALPHA) return OPENROUTER_OXALPHA_MODEL;
  if (providerId === PROVIDER_OPENCODE_OXALPHA) return OPENCODE_OXALPHA_MODEL;
  return "";
}

function normalizeProviderId(value, fallback = PROVIDER_CHATGPT_DIRECT) {
  const providerId = normalizeString(value, fallback);
  return [PROVIDER_CHATGPT_DIRECT, ...EXTERNAL_PROVIDER_IDS].includes(providerId)
    ? providerId
    : "";
}

function externalProviderProfile(providerId = "", options = {}) {
  if (providerId === PROVIDER_OPENROUTER_OXALPHA) {
    let credentials = "unavailable";
    let blockerCode = "";
    try {
      loadOpenRouterApiKey(options);
      credentials = "available";
      resolveOpenRouterEndpoint(options);
    } catch (error) {
      blockerCode = normalizeString(error?.code, "direct_openrouter_credentials_missing");
    }
    return {
      providerId,
      status: blockerCode ? "blocked" : "ready",
      blockerCode,
      model: OPENROUTER_OXALPHA_MODEL,
      transport: "openrouter_chat_completions_sse",
      credentials,
      childToolsAllowed: false,
      autoContinuation: true,
      rawSecretIncluded: false,
    };
  }
  if (providerId === PROVIDER_OPENCODE_OXALPHA) {
    const launchTarget = resolveOpenCodeLaunchTarget(options);
    return {
      providerId,
      status: launchTarget ? "ready" : "blocked",
      blockerCode: launchTarget ? "" : "direct_opencode_executable_missing",
      model: OPENCODE_OXALPHA_MODEL,
      transport: "opencode_cli_json",
      executionSubstrate: launchTarget?.substrate || "unavailable",
      credentials: "managed_by_opencode",
      childToolsAllowed: false,
      autoContinuation: true,
      rawSecretIncluded: false,
    };
  }
  return {
    providerId,
    status: "blocked",
    blockerCode: "direct_external_provider_unknown",
    model: "",
    transport: "unknown",
    credentials: "unavailable",
    childToolsAllowed: false,
    autoContinuation: false,
    rawSecretIncluded: false,
  };
}

function continuationPolicy(options = {}) {
  return {
    maxAttempts: boundedInteger(options.maxAttempts, 12, 1, 64),
    maxTotalMs: boundedInteger(options.maxTotalMs, 30 * 60_000, 1_000, 6 * 60 * 60_000),
    maxOutputChars: boundedInteger(options.maxOutputChars, 2_000_000, 1_000, 8_000_000),
    retryBaseMs: boundedInteger(options.retryBaseMs, 750, 0, 30_000),
    continuationPrompt: normalizeString(options.continuationPrompt, DEFAULT_CONTINUATION_PROMPT),
  };
}

function continuationDelay(policy, ordinal) {
  return Math.min(8_000, policy.retryBaseMs * (2 ** Math.min(ordinal - 1, 4)));
}

async function waitForRetry(ms, signal, sleepImpl) {
  throwIfAborted(signal);
  if (ms <= 0) return;
  if (sleepImpl) {
    await sleepImpl(ms, signal);
    throwIfAborted(signal);
    return;
  }
  await new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal?.removeEventListener?.("abort", abort);
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      handler(value);
    };
    const timer = setTimeout(() => finish(resolve), ms);
    const abort = () => {
      clearTimeout(timer);
      finish(reject, abortError());
    };
    signal?.addEventListener?.("abort", abort, { once: true });
  });
}

function deadlineSignal(externalSignal, maxTotalMs) {
  const controller = new AbortController();
  let timedOut = false;
  const externalAbort = () => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener?.("abort", externalAbort, { once: true });
  if (externalSignal?.aborted) externalAbort();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(safeError("direct_external_provider_total_timeout"));
  }, maxTotalMs);
  timer.unref?.();
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      externalSignal?.removeEventListener?.("abort", externalAbort);
    },
  };
}

function requestInputText(requestBody = {}) {
  return (Array.isArray(requestBody.input) ? requestBody.input : [])
    .flatMap((message) => Array.isArray(message?.content) ? message.content : [])
    .filter((content) => content?.type === "input_text" && typeof content.text === "string")
    .map((content) => content.text)
    .join("\n\n")
    .trim();
}

function reasoningEffortForOpenRouter(value = "") {
  const effort = normalizeString(value, "medium").toLowerCase();
  if (["none", "minimal", "low"].includes(effort)) return "low";
  if (["high", "xhigh", "max", "ultra"].includes(effort)) return "high";
  return "medium";
}

function reasoningVariantForOpenCode(value = "") {
  const effort = normalizeString(value, "high").toLowerCase();
  if (["xhigh", "max", "ultra"].includes(effort)) return "max";
  if (["high"].includes(effort)) return "high";
  return "low";
}

function overlapMerge(base = "", addition = "") {
  if (!base) return addition;
  if (!addition) return base;
  const maximum = Math.min(base.length, addition.length, 32_768);
  for (let size = maximum; size >= 16; size -= 1) {
    if (base.slice(-size) === addition.slice(0, size)) return base + addition.slice(size);
  }
  return base + addition;
}

function addUsage(total = {}, usage = {}) {
  const read = (names) => {
    for (const name of names) {
      const value = Number(usage?.[name]);
      if (Number.isFinite(value)) return Math.max(0, value);
    }
    return 0;
  };
  return {
    inputTokens: Number(total.inputTokens || 0) + read(["inputTokens", "input_tokens", "input"]),
    cachedInputTokens: Number(total.cachedInputTokens || 0) + read(["cachedInputTokens", "cached_input_tokens", "cache_read"]),
    outputTokens: Number(total.outputTokens || 0) + read(["outputTokens", "output_tokens", "output"]),
    reasoningOutputTokens: Number(total.reasoningOutputTokens || 0) + read(["reasoningOutputTokens", "reasoning_tokens", "reasoning"]),
    totalTokens: Number(total.totalTokens || 0) + read(["totalTokens", "total_tokens", "total"]),
  };
}

function finalTrace(input = {}) {
  const trace = {
    schema: EXTERNAL_PROVIDER_CONTINUATION_TRACE_SCHEMA,
    providerId: input.providerId,
    model: input.model,
    transport: input.transport,
    completionState: input.completionState,
    attemptCount: input.attempts.length,
    semanticContinuationCount: input.semanticContinuationCount,
    transportRetryCount: input.transportRetryCount,
    terminalFinishReason: normalizeString(input.terminalFinishReason, ""),
    outputChars: input.outputText.length,
    outputDigest: digestFor("direct-external-provider-output@1", input.outputText),
    attempts: input.attempts.map((attempt) => ({ ...attempt })),
    rawOutputIncluded: false,
    rawPromptIncluded: false,
    rawProviderPayloadIncluded: false,
    rawSecretIncluded: false,
  };
  trace.traceDigest = digestFor("direct-external-provider-continuation-trace@1", trace);
  return trace;
}

async function* responseBodyChunks(response) {
  if (!response?.body) {
    const body = await response.text();
    yield body;
    return;
  }
  if (typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        yield decoder.decode(value, { stream: true });
      }
      const suffix = decoder.decode();
      if (suffix) yield suffix;
    } finally {
      reader.releaseLock?.();
    }
    return;
  }
  if (typeof response.body[Symbol.asyncIterator] === "function") {
    const decoder = new TextDecoder();
    for await (const value of response.body) {
      yield typeof value === "string" ? value : decoder.decode(value, { stream: true });
    }
    const suffix = decoder.decode();
    if (suffix) yield suffix;
    return;
  }
  const body = await response.text();
  yield body;
}

function sseFramesFromBuffer(buffer = "", flush = false) {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const frames = normalized.split("\n\n");
  const remainder = flush ? "" : frames.pop() || "";
  return { frames: flush ? frames.filter(Boolean) : frames, remainder };
}

function parseSseFrame(frame = "") {
  const lines = frame.split("\n");
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return null;
  if (data.trim() === "[DONE]") return { done: true };
  try {
    return { data: JSON.parse(data) };
  } catch {
    throw safeError("direct_openrouter_sse_invalid", "OpenRouter returned an invalid stream frame.");
  }
}

function contentText(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((entry) => typeof entry === "string"
    ? entry
    : typeof entry?.text === "string" ? entry.text : "").join("");
}

async function streamOpenRouterAttempt(input = {}, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw safeError("direct_openrouter_fetch_missing");
  throwIfAborted(input.signal);
  let response;
  try {
    response = await fetchImpl(input.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "HTTP-Referer": "https://github.com/LexLattice/codex-review-shell",
        "X-Title": "LexLattice Direct Workbench",
      },
      body: JSON.stringify(input.body),
      signal: input.signal,
    });
  } catch (error) {
    if (input.signal?.aborted || error?.name === "AbortError") throw abortError();
    const wrapped = safeError("direct_openrouter_transport_interrupted");
    wrapped.transient = true;
    throw wrapped;
  }
  if (!response?.ok) {
    const status = Number(response?.status || 0);
    const transient = [408, 409, 425, 429, 500, 502, 503, 504].includes(status);
    const error = safeError(
      transient ? "direct_openrouter_transient_http" : "direct_openrouter_http_failed",
      `OpenRouter request failed with status ${status || "unknown"}.`,
    );
    error.transient = transient;
    error.httpStatus = status;
    throw error;
  }
  let buffer = "";
  let outputText = "";
  let finishReason = "";
  let responseId = "";
  let usage = {};
  let doneSeen = false;
  const consume = (frame) => {
    const parsed = parseSseFrame(frame);
    if (!parsed) return;
    if (parsed.done) {
      doneSeen = true;
      return;
    }
    const payload = parsed.data || {};
    if (payload.error) {
      const error = safeError("direct_openrouter_stream_error");
      error.transient = [408, 409, 425, 429, 500, 502, 503, 504].includes(Number(payload.error.code));
      throw error;
    }
    responseId = normalizeString(payload.id, responseId);
    if (payload.usage && typeof payload.usage === "object") usage = payload.usage;
    for (const choice of Array.isArray(payload.choices) ? payload.choices : []) {
      outputText += contentText(choice?.delta?.content);
      finishReason = normalizeString(choice?.finish_reason, finishReason);
    }
  };
  try {
    for await (const chunk of responseBodyChunks(response)) {
      throwIfAborted(input.signal);
      buffer += chunk;
      const split = sseFramesFromBuffer(buffer, false);
      buffer = split.remainder;
      split.frames.forEach(consume);
      if (outputText.length > input.maxOutputChars) throw safeError("direct_external_provider_output_limit");
    }
    if (buffer.trim()) sseFramesFromBuffer(buffer, true).frames.forEach(consume);
  } catch (error) {
    if (input.signal?.aborted || error?.name === "AbortError") throw abortError();
    if (error?.code) {
      error.partialOutputText = outputText;
      error.responseId = responseId;
      error.usage = usage;
      throw error;
    }
    const wrapped = safeError("direct_openrouter_transport_interrupted");
    wrapped.transient = true;
    wrapped.partialOutputText = outputText;
    wrapped.responseId = responseId;
    wrapped.usage = usage;
    throw wrapped;
  }
  return { outputText, finishReason, responseId, usage, doneSeen };
}

function openRouterMessages(requestBody = {}) {
  const instructions = normalizeString(requestBody.instructions, "You are a bounded Direct child agent.");
  const task = requestInputText(requestBody);
  return [
    { role: "system", content: instructions },
    { role: "user", content: task },
  ];
}

function attemptRow(input = {}) {
  return {
    ordinal: input.ordinal,
    outcome: input.outcome,
    trigger: input.trigger,
    finishReason: normalizeString(input.finishReason, ""),
    outputChars: Number(input.outputChars || 0),
    responseIdentityDigest: input.responseId
      ? digestFor("direct-external-provider-response-id@1", input.responseId)
      : "",
    usageObserved: input.usageObserved === true,
    semanticContinuationScheduled: input.semanticContinuationScheduled === true,
  };
}

function normalizedAttemptEvents(input = {}) {
  const events = [];
  if (input.ordinal === 1) {
    events.push({
      type: "session_started",
      responseId: input.responseId,
      model: input.model,
      providerId: input.providerId,
    });
  }
  if (input.outputText) {
    events.push({
      type: "message_delta",
      responseId: input.responseId,
      itemId: `${input.providerId}_attempt_${input.ordinal}`,
      text: input.outputText,
      continuationOrdinal: input.ordinal,
    });
  }
  if (Object.values(input.usage || {}).some((value) => Number(value) > 0)) {
    events.push({
      type: "usage_delta",
      responseId: input.responseId,
      usage: {
        inputTokens: Number(input.usage.inputTokens || input.usage.input_tokens || input.usage.input || 0),
        cachedInputTokens: Number(input.usage.cachedInputTokens || input.usage.cached_input_tokens || input.usage.cache_read || 0),
        outputTokens: Number(input.usage.outputTokens || input.usage.output_tokens || input.usage.output || 0),
        reasoningTokens: Number(input.usage.reasoningOutputTokens || input.usage.reasoning_tokens || input.usage.reasoning || 0),
        totalTokens: Number(input.usage.totalTokens || input.usage.total_tokens || input.usage.total || 0),
      },
    });
  }
  events.push({
    type: input.completed
      ? "response_completed"
      : input.continuityRebased === true
        ? "provider_continuity_rebased"
        : "provider_continuation_scheduled",
    responseId: input.responseId,
    stopReason: input.completed ? "completed" : normalizeString(input.trigger, "incomplete"),
    continuationOrdinal: input.ordinal,
  });
  return events;
}

function renumberEvents(events = []) {
  return events.map((event, sequence) => ({ ...event, sequence }));
}

async function appendCommittedAttemptEvents(normalizedEvents, events, options = {}) {
  const normalizedOffset = normalizedEvents.length;
  const committed = (Array.isArray(events) ? events : []).map((event, index) => ({
    ...event,
    sequence: normalizedOffset + index,
  }));
  if (!committed.length) return committed;
  normalizedEvents.push(...committed);
  if (typeof options.onNormalizedEventsCommitted === "function") {
    await options.onNormalizedEventsCommitted(committed, { normalizedOffset });
  }
  return committed;
}

function boundedOpenCodeRebaseOutput(value = "") {
  const source = String(value || "");
  if (source.length <= MAX_OPENCODE_REBASE_OUTPUT_CHARS) return source;
  const headChars = Math.floor(MAX_OPENCODE_REBASE_OUTPUT_CHARS / 4);
  const tailChars = MAX_OPENCODE_REBASE_OUTPUT_CHARS - headChars;
  const omitted = source.length - headChars - tailChars;
  return [
    source.slice(0, headChars),
    `\n\n[${omitted} captured characters omitted from the continuity projection]\n\n`,
    source.slice(-tailChars),
  ].join("");
}

function buildOpenCodeRebasePrompt(input = {}) {
  const priorOutput = String(input.outputText || "");
  return [
    "[DIRECT CHILD CONSTITUTION]",
    normalizeString(input.instructions, "You are a bounded Direct child agent. Answer only the delegated task."),
    "[END DIRECT CHILD CONSTITUTION]",
    "",
    "[PROVIDER CONTINUITY REBASE]",
    "The prior provider session is unavailable. The Direct Workbench capture below is the continuity authority.",
    "Treat it as work already produced. Continue without restarting or repeating completed material.",
    `Captured output digest: ${digestFor("direct-external-provider-output@1", priorOutput)}`,
    "[END PROVIDER CONTINUITY REBASE]",
    "",
    "[ORIGINAL DELEGATED TASK]",
    String(input.task || ""),
    "[END ORIGINAL DELEGATED TASK]",
    "",
    "[CAPTURED PARTIAL OUTPUT]",
    boundedOpenCodeRebaseOutput(priorOutput),
    "[END CAPTURED PARTIAL OUTPUT]",
    "",
    "[COMPLETION CONTRACT]",
    normalizeString(input.continuationPrompt, DEFAULT_CONTINUATION_PROMPT),
    "[END COMPLETION CONTRACT]",
  ].join("\n");
}

async function runOpenRouterOxAlphaTurnWithinDeadline(input = {}, options = {}) {
  const policy = options.resolvedPolicy || continuationPolicy({
    maxAttempts: options.maxAttempts ?? process.env.CODEX_DIRECT_0XALPHA_MAX_ATTEMPTS,
    maxTotalMs: options.maxTotalMs ?? process.env.CODEX_DIRECT_0XALPHA_MAX_TOTAL_MS,
    maxOutputChars: options.maxOutputChars ?? process.env.CODEX_DIRECT_0XALPHA_MAX_OUTPUT_CHARS,
    retryBaseMs: options.retryBaseMs ?? process.env.CODEX_DIRECT_0XALPHA_RETRY_BASE_MS,
    continuationPrompt: options.continuationPrompt,
  });
  const endpoint = resolveOpenRouterEndpoint(options);
  const credentials = loadOpenRouterApiKey(options);
  const model = normalizeString(input.requestBody?.model, OPENROUTER_OXALPHA_MODEL);
  if (model !== OPENROUTER_OXALPHA_MODEL) throw safeError("direct_openrouter_model_not_allowed");
  const messages = openRouterMessages(input.requestBody);
  if (!messages[1].content) throw safeError("direct_external_provider_prompt_missing");
  const startedAt = Date.now();
  const attempts = [];
  const normalizedEvents = [];
  let outputText = "";
  let tokenUsage = {};
  let semanticContinuationCount = 0;
  let transportRetryCount = 0;
  let lastResponseId = "";
  for (let ordinal = 1; ordinal <= policy.maxAttempts; ordinal += 1) {
    throwIfAborted(input.signal);
    if (Date.now() - startedAt >= policy.maxTotalMs) break;
    let outcome;
    let attemptOutput = "";
    let trigger = "";
    let finishReason = "";
    let responseId = "";
    let usage = {};
    try {
      outcome = await streamOpenRouterAttempt({
        endpoint,
        apiKey: credentials.apiKey,
        signal: input.signal,
        maxOutputChars: policy.maxOutputChars,
        body: {
          model,
          messages,
          stream: true,
          stream_options: { include_usage: true },
          reasoning: {
            effort: reasoningEffortForOpenRouter(input.requestShape?.reasoningEffort),
          },
        },
      }, options);
      attemptOutput = outcome.outputText;
      finishReason = outcome.finishReason;
      responseId = outcome.responseId;
      usage = outcome.usage;
      const candidateOutputText = overlapMerge(outputText, attemptOutput);
      if (finishReason === "stop" && outcome.doneSeen && candidateOutputText) {
        outputText = candidateOutputText;
        tokenUsage = addUsage(tokenUsage, usage);
        lastResponseId = responseId || lastResponseId;
        attempts.push(attemptRow({
          ordinal,
          outcome: "completed",
          trigger: "terminal_stop",
          finishReason,
          outputChars: attemptOutput.length,
          responseId,
          usageObserved: Object.keys(usage).length > 0,
          semanticContinuationScheduled: false,
        }));
        await appendCommittedAttemptEvents(normalizedEvents, normalizedAttemptEvents({
          ordinal,
          providerId: PROVIDER_OPENROUTER_OXALPHA,
          model,
          outputText: attemptOutput,
          responseId,
          usage,
          completed: true,
          trigger: "terminal_stop",
        }), options);
        const continuationTrace = finalTrace({
          providerId: PROVIDER_OPENROUTER_OXALPHA,
          model,
          transport: "openrouter_chat_completions_sse",
          completionState: "completed",
          attempts,
          semanticContinuationCount,
          transportRetryCount,
          terminalFinishReason: finishReason,
          outputText,
        });
        return {
          ok: true,
          terminalState: "completed",
          errorCode: "",
          outputText,
          responseId: lastResponseId,
          tokenUsage,
          normalizedEvents: renumberEvents(normalizedEvents),
          continuationTrace,
        };
      }
      if (finishReason === "content_filter") {
        throw safeError("direct_openrouter_content_filter_terminal");
      }
      if (finishReason && !["length", "stop"].includes(finishReason)) {
        throw safeError("direct_openrouter_finish_reason_unsupported");
      }
      trigger = finishReason === "length"
        ? "max_output_incomplete"
        : finishReason === "stop" && outcome.doneSeen
          ? "empty_terminal_output"
          : outcome.doneSeen ? "terminal_evidence_missing" : "stream_done_missing";
    } catch (error) {
      if (input.signal?.aborted || error?.name === "AbortError") throw abortError();
      if (error?.code === "direct_external_provider_output_limit") throw error;
      if (error?.transient !== true) throw error;
      attemptOutput = typeof error.partialOutputText === "string" ? error.partialOutputText : "";
      responseId = normalizeString(error.responseId, "");
      usage = error.usage || {};
      trigger = attemptOutput ? "transport_interrupted_after_output" : "transport_interrupted_before_output";
    }
    outputText = overlapMerge(outputText, attemptOutput);
    if (outputText.length > policy.maxOutputChars) throw safeError("direct_external_provider_output_limit");
    tokenUsage = addUsage(tokenUsage, usage);
    lastResponseId = responseId || lastResponseId;
    const semanticContinuation = Boolean(attemptOutput);
    if (semanticContinuation) {
      semanticContinuationCount += 1;
      messages.push({ role: "assistant", content: attemptOutput });
      messages.push({ role: "user", content: policy.continuationPrompt });
    } else {
      transportRetryCount += 1;
    }
    attempts.push(attemptRow({
      ordinal,
      outcome: "incomplete",
      trigger,
      finishReason,
      outputChars: attemptOutput.length,
      responseId,
      usageObserved: Object.keys(usage).length > 0,
      semanticContinuationScheduled: semanticContinuation,
    }));
    await appendCommittedAttemptEvents(normalizedEvents, normalizedAttemptEvents({
      ordinal,
      providerId: PROVIDER_OPENROUTER_OXALPHA,
      model,
      outputText: attemptOutput,
      responseId,
      usage,
      completed: false,
      trigger,
    }), options);
    if (ordinal < policy.maxAttempts) {
      await waitForRetry(continuationDelay(policy, ordinal), input.signal, options.sleepImpl);
    }
  }
  const continuationTrace = finalTrace({
    providerId: PROVIDER_OPENROUTER_OXALPHA,
    model,
    transport: "openrouter_chat_completions_sse",
    completionState: "continuation_exhausted",
    attempts,
    semanticContinuationCount,
    transportRetryCount,
    terminalFinishReason: "",
    outputText,
  });
  const error = safeError("direct_external_provider_continuation_exhausted");
  error.continuationTrace = continuationTrace;
  error.normalizedEvents = renumberEvents(normalizedEvents);
  throw error;
}

async function runOpenRouterOxAlphaTurn(input = {}, options = {}) {
  const policy = continuationPolicy({
    maxAttempts: options.maxAttempts ?? process.env.CODEX_DIRECT_0XALPHA_MAX_ATTEMPTS,
    maxTotalMs: options.maxTotalMs ?? process.env.CODEX_DIRECT_0XALPHA_MAX_TOTAL_MS,
    maxOutputChars: options.maxOutputChars ?? process.env.CODEX_DIRECT_0XALPHA_MAX_OUTPUT_CHARS,
    retryBaseMs: options.retryBaseMs ?? process.env.CODEX_DIRECT_0XALPHA_RETRY_BASE_MS,
    continuationPrompt: options.continuationPrompt,
  });
  const deadline = deadlineSignal(input.signal, policy.maxTotalMs);
  try {
    return await runOpenRouterOxAlphaTurnWithinDeadline({ ...input, signal: deadline.signal }, {
      ...options,
      resolvedPolicy: policy,
    });
  } catch (error) {
    if (deadline.timedOut() && !input.signal?.aborted) {
      throw safeError("direct_external_provider_total_timeout");
    }
    throw error;
  } finally {
    deadline.dispose();
  }
}

function inferredOpenCodeWslExecutable(env = {}) {
  const configured = normalizeString(env.CODEX_DIRECT_OPENCODE_WSL_BIN, "");
  if (configured) return configured;
  const projectPath = normalizeString(env.CODEX_REVIEW_SHELL_DEFAULT_WSL_PATH, "");
  const homeMatch = /^(\/home\/[^/]+)(?:\/|$)/.exec(projectPath.replace(/\\/g, "/"));
  return homeMatch ? `${homeMatch[1]}/.opencode/bin/opencode` : "";
}

function resolveOpenCodeLaunchTarget(options = {}) {
  const env = options.env || process.env;
  const platform = normalizeString(options.platform, process.platform);
  const pathApi = platform === "win32" ? path.win32 : path;
  const homeDir = normalizeString(options.homeDir, os.homedir());
  const accessSync = options.accessSync || fs.accessSync;
  const candidates = [
    normalizeString(options.openCodeExecutable, ""),
    normalizeString(env.CODEX_DIRECT_OPENCODE_BIN, ""),
    pathApi.join(homeDir, ".opencode", "bin", platform === "win32" ? "opencode.exe" : "opencode"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      accessSync(candidate, platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
      return Object.freeze({
        schema: OPENCODE_LAUNCH_TARGET_SCHEMA,
        substrate: "native",
        command: candidate,
        openCodeExecutable: candidate,
        distro: "",
        rawExecutablePathExposed: false,
      });
    } catch {}
  }
  if (platform !== "win32") return null;

  const distro = normalizeString(
    options.openCodeWslDistro || env.CODEX_DIRECT_OPENCODE_WSL_DISTRO ||
      env.CODEX_REVIEW_SHELL_DEFAULT_WSL_DISTRO,
    "",
  );
  const openCodeWslExecutable = normalizeString(
    options.openCodeWslExecutable,
    inferredOpenCodeWslExecutable(env),
  );
  const windowsRoot = normalizeString(env.SystemRoot || env.WINDIR, "C:\\Windows");
  const wslCandidates = [
    normalizeString(options.wslExecutable, ""),
    normalizeString(env.CODEX_DIRECT_WSL_EXE, ""),
    path.win32.join(windowsRoot, "System32", "wsl.exe"),
  ].filter(Boolean);
  if (!distro || !openCodeWslExecutable.startsWith("/")) return null;
  for (const wslExecutable of wslCandidates) {
    try {
      accessSync(wslExecutable, fs.constants.F_OK);
      return Object.freeze({
        schema: OPENCODE_LAUNCH_TARGET_SCHEMA,
        substrate: "wsl",
        command: wslExecutable,
        openCodeExecutable: openCodeWslExecutable,
        distro,
        rawExecutablePathExposed: false,
      });
    } catch {}
  }
  return null;
}

function resolveOpenCodeExecutable(options = {}) {
  return resolveOpenCodeLaunchTarget(options)?.openCodeExecutable || "";
}

function openCodeRunDirectories(input = {}, options = {}) {
  const baseDirectory = path.resolve(normalizeString(options.workingDirectory, os.tmpdir()));
  const identity = normalizeString(input.attemptId, crypto.randomUUID());
  const runKey = digestFor("direct-opencode-run-directory@1", identity).slice("sha256:".length, 31);
  const runsRoot = path.join(baseDirectory, "opencode-runs");
  const runRoot = path.join(runsRoot, runKey);
  return {
    runKey,
    runsRoot,
    runRoot,
    workingDirectory: path.join(runRoot, "workspace"),
    runtimeDirectory: path.join(runRoot, "runtime"),
    eventJournalPath: path.join(runRoot, "provider-events.ndjson"),
    retentionManifestPath: path.join(runRoot, "retention.json"),
  };
}

function openCodeRetentionPolicy(options = {}) {
  const env = options.env || process.env;
  return {
    retentionMs: boundedInteger(
      options.openCodeRetentionMs ?? env.CODEX_DIRECT_OPENCODE_RETENTION_MS,
      DEFAULT_OPENCODE_RUN_RETENTION_MS,
      60_000,
      90 * 24 * 60 * 60_000,
    ),
    maxRuns: boundedInteger(
      options.openCodeMaxRetainedRuns ?? env.CODEX_DIRECT_OPENCODE_MAX_RETAINED_RUNS,
      DEFAULT_OPENCODE_MAX_RETAINED_RUNS,
      1,
      512,
    ),
    maxBytes: boundedInteger(
      options.openCodeMaxRetainedBytes ?? env.CODEX_DIRECT_OPENCODE_MAX_RETAINED_BYTES,
      DEFAULT_OPENCODE_MAX_RETAINED_BYTES,
      1_024,
      2 * 1024 * 1024 * 1024,
    ),
  };
}

function directorySizeBytes(rootPath, stopAfterBytes = Number.MAX_SAFE_INTEGER) {
  const pending = [rootPath];
  let total = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (stat.isSymbolicLink()) continue;
    if (!stat.isDirectory()) {
      total += stat.size;
      if (total > stopAfterBytes) return total;
      continue;
    }
    for (const entry of fs.readdirSync(current)) pending.push(path.join(current, entry));
  }
  return total;
}

function removeOpenCodeRun(runRoot) {
  fs.rmSync(runRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}

function pruneOpenCodeRuns(runsRoot, options = {}) {
  const configuredRoot = normalizeString(runsRoot, "");
  if (!configuredRoot) throw safeError("direct_opencode_retention_root_missing");
  const root = path.resolve(configuredRoot);
  const policy = openCodeRetentionPolicy(options);
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  let dirents;
  try {
    dirents = fs.readdirSync(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { discovered: 0, retained: 0, removed: 0, retainedBytes: 0, policy };
    }
    throw safeError("direct_opencode_retention_scan_failed");
  }
  const finalized = [];
  let removed = 0;
  for (const dirent of dirents) {
    if (!dirent.isDirectory() || !/^[a-f0-9]{24}$/.test(dirent.name)) continue;
    const runRoot = path.join(root, dirent.name);
    const manifestPath = path.join(runRoot, "retention.json");
    let manifest = null;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) {
        throw safeError("direct_opencode_retention_scan_failed");
      }
    }
    let stat;
    try {
      stat = fs.statSync(runRoot);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw safeError("direct_opencode_retention_scan_failed");
    }
    const finalizedAtMs = Date.parse(manifest?.finalizedAt || "");
    if (!manifest || manifest.schema !== OPENCODE_RUN_RETENTION_SCHEMA || !Number.isFinite(finalizedAtMs)) {
      if (nowMs - stat.mtimeMs > policy.retentionMs) {
        removeOpenCodeRun(runRoot);
        removed += 1;
      }
      continue;
    }
    finalized.push({
      runRoot,
      finalizedAtMs,
      sizeBytes: directorySizeBytes(runRoot, policy.maxBytes + 1),
    });
  }
  finalized.sort((left, right) => right.finalizedAtMs - left.finalizedAtMs);
  let retained = 0;
  let retainedBytes = 0;
  for (const entry of finalized) {
    const expired = nowMs - entry.finalizedAtMs > policy.retentionMs;
    const overCount = retained >= policy.maxRuns;
    const overBytes = retainedBytes + entry.sizeBytes > policy.maxBytes;
    if (expired || overCount || overBytes) {
      removeOpenCodeRun(entry.runRoot);
      removed += 1;
      continue;
    }
    retained += 1;
    retainedBytes += entry.sizeBytes;
  }
  return { discovered: dirents.length, retained, removed, retainedBytes, policy };
}

function finalizeOpenCodeRunDirectories(directories = {}, options = {}) {
  const configuredRunRoot = normalizeString(directories.runRoot, "");
  if (!configuredRunRoot) throw safeError("direct_opencode_retention_root_missing");
  const runRoot = path.resolve(configuredRunRoot);
  if (!fs.existsSync(runRoot)) return null;
  try {
    fs.rmSync(directories.runtimeDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    fs.rmSync(directories.workingDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    const journalPresent = fs.existsSync(directories.eventJournalPath);
    const manifest = {
      schema: OPENCODE_RUN_RETENTION_SCHEMA,
      finalizedAt: new Date(Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now()).toISOString(),
      retainedRawJournal: journalPresent,
      journalBytes: journalPresent ? fs.statSync(directories.eventJournalPath).size : 0,
      disposableProviderStateRemoved: true,
    };
    const temporaryPath = `${directories.retentionManifestPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(manifest)}\n`, { encoding: "utf8", mode: 0o600 });
    if (process.platform !== "win32") fs.chmodSync(temporaryPath, 0o600);
    fs.renameSync(temporaryPath, directories.retentionManifestPath);
    if (process.platform !== "win32") fs.chmodSync(directories.retentionManifestPath, 0o600);
    return pruneOpenCodeRuns(directories.runsRoot, options);
  } catch (error) {
    if (error?.code?.startsWith("direct_opencode_retention_")) throw error;
    throw safeError("direct_opencode_retention_finalize_failed");
  }
}

function ensureOpenCodeRunDirectories(directories = {}, options = {}) {
  const mkdirSync = options.mkdirSync || fs.mkdirSync;
  for (const directory of [
    directories.runRoot,
    directories.workingDirectory,
    directories.runtimeDirectory,
    path.join(directories.runtimeDirectory, "data"),
    path.join(directories.runtimeDirectory, "cache"),
    path.join(directories.runtimeDirectory, "state"),
    path.join(directories.runtimeDirectory, "config"),
    path.join(directories.runtimeDirectory, "config", "opencode"),
  ]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
}

function openOpenCodeEventJournal(input = {}) {
  const journalPath = normalizeString(input.journalPath, "");
  if (!journalPath) return null;
  let descriptor;
  try {
    fs.mkdirSync(path.dirname(journalPath), { recursive: true, mode: 0o700 });
    descriptor = fs.openSync(journalPath, "a", 0o600);
    if (process.platform !== "win32") fs.fchmodSync(descriptor, 0o600);
  } catch {
    throw safeError("direct_opencode_event_journal_unavailable");
  }
  let closed = false;
  return {
    append(event) {
      if (closed) throw safeError("direct_opencode_event_journal_closed");
      const record = {
        schema: "direct_opencode_provider_event_journal@1",
        attemptOrdinal: Math.max(1, Number(input.attemptOrdinal || 1)),
        observedAt: new Date().toISOString(),
        event,
      };
      try {
        fs.writeSync(descriptor, `${JSON.stringify(record)}\n`, null, "utf8");
        fs.fsyncSync(descriptor);
      } catch {
        throw safeError("direct_opencode_event_journal_write_failed");
      }
    },
    close() {
      if (closed) return;
      closed = true;
      try { fs.closeSync(descriptor); } catch {}
    },
  };
}

function safeOpenCodeRuntimeEnv(options = {}) {
  const env = { ...(options.env || process.env) };
  const platform = normalizeString(options.platform, process.platform);
  const pathApi = platform === "win32" ? path.win32 : path;
  const runtimeDirectory = pathApi.resolve(normalizeString(
    options.openCodeRuntimeDirectory || options.runtimeDirectory || env.CODEX_DIRECT_OPENCODE_RUNTIME_DIR,
    pathApi.join(os.tmpdir(), "codex-direct-opencode-runtime"),
  ));
  env.XDG_DATA_HOME = pathApi.join(runtimeDirectory, "data");
  env.XDG_CACHE_HOME = pathApi.join(runtimeDirectory, "cache");
  env.XDG_STATE_HOME = pathApi.join(runtimeDirectory, "state");
  env.XDG_CONFIG_HOME = pathApi.join(runtimeDirectory, "config");
  delete env.OPENCODE_CONFIG;
  delete env.OPENCODE_TUI_CONFIG;
  env.OPENCODE_CONFIG_DIR = pathApi.join(runtimeDirectory, "config", "opencode");
  env.OPENCODE_DISABLE_PROJECT_CONFIG = "1";
  env.OPENCODE_DISABLE_DEFAULT_PLUGINS = "1";
  env.OPENCODE_DISABLE_LSP_DOWNLOAD = "1";
  env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
    share: "disabled",
    permission: "deny",
    tools: { "*": false },
    plugin: [],
  });
  delete env.OPENCODE_SERVER_PASSWORD;
  delete env.OPENCODE_SERVER_USERNAME;
  return env;
}

const OPENCODE_WSL_RUNTIME_ENV_KEYS = Object.freeze([
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
  "XDG_CONFIG_HOME",
  "OPENCODE_CONFIG_DIR",
  "OPENCODE_DISABLE_PROJECT_CONFIG",
  "OPENCODE_DISABLE_DEFAULT_PLUGINS",
  "OPENCODE_DISABLE_LSP_DOWNLOAD",
  "OPENCODE_CONFIG_CONTENT",
]);
const OPENCODE_WSL_PATH_ENV_KEYS = new Set([
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
  "XDG_CONFIG_HOME",
  "OPENCODE_CONFIG_DIR",
]);

function wslPathForWindowsPath(value, options = {}) {
  const source = normalizeString(value, "");
  if (!source) throw safeError("direct_opencode_wsl_path_translation_failed");
  if (source.startsWith("/")) return source.replace(/\\/g, "/");
  const normalized = source.replace(/\//g, "\\");
  const uncMatch = /^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)(?:\\(.*))?$/i.exec(normalized);
  if (uncMatch) {
    const expectedDistro = normalizeString(options.distro, "");
    if (expectedDistro && uncMatch[1].toLowerCase() !== expectedDistro.toLowerCase()) {
      throw safeError("direct_opencode_wsl_path_distro_mismatch");
    }
    return `/${normalizeString(uncMatch[2], "").replace(/\\/g, "/")}`;
  }
  const driveMatch = /^([A-Za-z]):\\(.*)$/.exec(normalized);
  if (driveMatch) {
    return `/mnt/${driveMatch[1].toLowerCase()}/${driveMatch[2].replace(/\\/g, "/")}`;
  }
  throw safeError("direct_opencode_wsl_path_translation_failed");
}

function safeOpenCodeWslHostEnv(options = {}) {
  const env = { ...(options.env || process.env) };
  for (const key of Object.keys(env)) {
    if (/(?:API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key)) delete env[key];
    if (key.startsWith("OPENCODE_")) delete env[key];
  }
  env.WSLENV = "";
  return env;
}

function openCodeProcessLaunchDescriptor(input = {}, options = {}) {
  const launchTarget = input.launchTarget || {
    schema: OPENCODE_LAUNCH_TARGET_SCHEMA,
    substrate: "native",
    command: input.executable,
    openCodeExecutable: input.executable,
    distro: "",
  };
  if (launchTarget.substrate !== "wsl") {
    return {
      command: launchTarget.command || input.executable,
      args: [...(Array.isArray(input.args) ? input.args : [])],
      cwd: input.cwd,
      env: safeOpenCodeRuntimeEnv({
        ...options,
        openCodeRuntimeDirectory: input.runtimeDirectory,
      }),
      transport: "native",
    };
  }

  const translatePath = options.wslPathTranslator || wslPathForWindowsPath;
  const runtimeEnv = safeOpenCodeRuntimeEnv({
    ...options,
    openCodeRuntimeDirectory: input.runtimeDirectory,
  });
  const runtimeAssignments = OPENCODE_WSL_RUNTIME_ENV_KEYS.map((key) => {
    const rawValue = normalizeString(runtimeEnv[key], "");
    const value = OPENCODE_WSL_PATH_ENV_KEYS.has(key)
      ? translatePath(rawValue, { distro: launchTarget.distro })
      : rawValue;
    return `${key}=${value}`;
  });
  const providerCwd = normalizeString(
    input.providerCwd,
    translatePath(input.cwd, { distro: launchTarget.distro }),
  );
  return {
    command: launchTarget.command,
    args: [
      "-d",
      launchTarget.distro,
      "--cd",
      providerCwd,
      "--",
      "/usr/bin/env",
      ...runtimeAssignments,
      launchTarget.openCodeExecutable,
      ...(Array.isArray(input.args) ? input.args : []),
    ],
    cwd: input.cwd,
    env: safeOpenCodeWslHostEnv(options),
    transport: "wsl.exe",
  };
}

function spawnOpenCodeProcess(input = {}, options = {}) {
  const spawnImpl = options.spawnImpl || spawn;
  return new Promise((resolve, reject) => {
    throwIfAborted(input.signal);
    let journal;
    try {
      journal = openOpenCodeEventJournal({
        journalPath: input.eventJournalPath,
        attemptOrdinal: input.attemptOrdinal,
      });
    } catch (error) {
      reject(error);
      return;
    }
    const descriptor = openCodeProcessLaunchDescriptor(input, options);
    const child = spawnImpl(descriptor.command, descriptor.args, {
      cwd: descriptor.cwd,
      env: descriptor.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    let stdout = "";
    let journalBuffer = "";
    let stderrChars = 0;
    let settled = false;
    let terminationTimer = null;
    const cleanup = () => {
      input.signal?.removeEventListener?.("abort", abort);
      if (terminationTimer) clearTimeout(terminationTimer);
      journal?.close();
    };
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      handler(value);
    };
    const abort = () => {
      try { child.kill("SIGTERM"); } catch {}
      terminationTimer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch {}
      }, 2_000);
    };
    input.signal?.addEventListener?.("abort", abort, { once: true });
    child.stdout?.setEncoding?.("utf8");
    child.stderr?.setEncoding?.("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
      journalBuffer += chunk;
      const lines = journalBuffer.split(/\r?\n/);
      journalBuffer = lines.pop() || "";
      try {
        for (const line of lines) {
          if (!journal || !line.trim()) continue;
          let parsed;
          try { parsed = JSON.parse(line); } catch { continue; }
          journal.append(parsed);
        }
      } catch (error) {
        try { child.kill("SIGTERM"); } catch {}
        finish(reject, error?.code?.startsWith("direct_opencode_event_journal_")
          ? error
          : safeError("direct_opencode_event_journal_write_failed"));
        return;
      }
      if (stdout.length > input.maxStdoutChars) {
        try { child.kill("SIGTERM"); } catch {}
        finish(reject, safeError("direct_opencode_output_limit"));
      }
    });
    child.stderr?.on("data", (chunk) => { stderrChars += String(chunk).length; });
    child.on("error", (error) => {
      if (input.signal?.aborted || error?.name === "AbortError") finish(reject, abortError());
      else finish(reject, safeError("direct_opencode_process_failed"));
    });
    child.on("close", (code, signal) => {
      if (input.signal?.aborted) {
        finish(reject, abortError());
        return;
      }
      if (journalBuffer.trim()) {
        try {
          journal?.append(JSON.parse(journalBuffer));
        } catch (error) {
          if (error?.code?.startsWith("direct_opencode_event_journal_")) {
            finish(reject, error);
            return;
          }
          // Preserve malformed tail evidence in stdout for typed incomplete
          // handling, but never write a non-JSON record to the parsed journal.
        }
      }
      finish(resolve, {
        exitCode: Number.isInteger(code) ? code : -1,
        signal: normalizeString(signal, ""),
        stdout,
        stderrObserved: stderrChars > 0,
      });
    });
  });
}

function parseOpenCodeJsonOutput(source = "") {
  const events = [];
  let invalidJsonObserved = false;
  for (const line of String(source).split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      invalidJsonObserved = true;
    }
  }
  let sessionId = "";
  let outputText = "";
  let finishReason = "";
  let usage = {};
  let toolUseObserved = false;
  let errorObserved = false;
  for (const event of events) {
    sessionId = normalizeString(event?.sessionID, sessionId);
    if (event?.type === "text" && typeof event?.part?.text === "string") {
      outputText = overlapMerge(outputText, event.part.text);
    }
    if (event?.type === "tool_use") toolUseObserved = true;
    if (event?.type === "error") errorObserved = true;
    if (event?.type === "step_finish") {
      finishReason = normalizeString(event?.part?.reason, finishReason);
      usage = event?.part?.tokens || usage;
    }
  }
  return {
    sessionId,
    outputText,
    finishReason,
    usage,
    toolUseObserved,
    errorObserved: errorObserved || invalidJsonObserved,
    invalidJsonObserved,
  };
}

async function runOpenCodeOxAlphaTurnWithinDeadline(input = {}, options = {}) {
  const policy = options.resolvedPolicy || continuationPolicy({
    maxAttempts: options.maxAttempts ?? process.env.CODEX_DIRECT_0XALPHA_MAX_ATTEMPTS,
    maxTotalMs: options.maxTotalMs ?? process.env.CODEX_DIRECT_0XALPHA_MAX_TOTAL_MS,
    maxOutputChars: options.maxOutputChars ?? process.env.CODEX_DIRECT_0XALPHA_MAX_OUTPUT_CHARS,
    retryBaseMs: options.retryBaseMs ?? process.env.CODEX_DIRECT_0XALPHA_RETRY_BASE_MS,
    continuationPrompt: options.continuationPrompt,
  });
  const launchTarget = resolveOpenCodeLaunchTarget(options);
  if (!launchTarget) throw safeError("direct_opencode_executable_missing");
  const model = normalizeString(input.requestBody?.model, OPENCODE_OXALPHA_MODEL);
  if (model !== OPENCODE_OXALPHA_MODEL) throw safeError("direct_opencode_model_not_allowed");
  const task = requestInputText(input.requestBody);
  const instructions = normalizeString(
    input.requestBody?.instructions,
    "You are a bounded Direct child agent. Answer only the delegated task.",
  );
  const prompt = [
    "[DIRECT CHILD CONSTITUTION]",
    instructions,
    "[END DIRECT CHILD CONSTITUTION]",
    "",
    "[DELEGATED TASK]",
    task,
  ].join("\n");
  if (!task) throw safeError("direct_external_provider_prompt_missing");
  const runDirectories = options.runDirectories || openCodeRunDirectories(input, options);
  pruneOpenCodeRuns(runDirectories.runsRoot, options);
  ensureOpenCodeRunDirectories(runDirectories, options);
  const cwd = runDirectories.workingDirectory;
  const providerCwd = launchTarget.substrate === "wsl"
    ? (options.wslPathTranslator || wslPathForWindowsPath)(cwd, { distro: launchTarget.distro })
    : cwd;
  const startedAt = Date.now();
  const attempts = [];
  const normalizedEvents = [];
  let outputText = "";
  let tokenUsage = {};
  let semanticContinuationCount = 0;
  let transportRetryCount = 0;
  let sessionId = "";
  let rebasePending = false;
  for (let ordinal = 1; ordinal <= policy.maxAttempts; ordinal += 1) {
    throwIfAborted(input.signal);
    if (Date.now() - startedAt >= policy.maxTotalMs) break;
    const usedSession = Boolean(sessionId);
    const requestedSessionId = sessionId;
    const usedRebase = !usedSession && rebasePending && Boolean(outputText);
    const args = ["run", "--format", "json", "--dir", providerCwd, "--model", model, "--variant",
      reasoningVariantForOpenCode(input.requestShape?.reasoningEffort)];
    if (usedSession) args.push("--session", sessionId);
    args.push(usedSession
      ? policy.continuationPrompt
      : usedRebase
        ? buildOpenCodeRebasePrompt({
            instructions,
            task,
            outputText,
            continuationPrompt: policy.continuationPrompt,
          })
        : prompt);
    let processResult;
    try {
      processResult = await (options.processRunner || spawnOpenCodeProcess)({
        executable: launchTarget.openCodeExecutable,
        launchTarget,
        args,
        cwd,
        providerCwd,
        runtimeDirectory: runDirectories.runtimeDirectory,
        eventJournalPath: runDirectories.eventJournalPath,
        attemptOrdinal: ordinal,
        signal: input.signal,
        maxStdoutChars: policy.maxOutputChars * 2,
      }, options);
    } catch (error) {
      if (input.signal?.aborted || error?.name === "AbortError") throw abortError();
      if (error?.code !== "direct_opencode_process_failed") throw error;
      transportRetryCount += 1;
      const continuityRebased = usedSession && Boolean(outputText);
      const trigger = continuityRebased
        ? "opencode_session_continuity_lost"
        : "opencode_process_failed";
      if (usedSession) {
        sessionId = "";
        rebasePending = Boolean(outputText);
      }
      attempts.push(attemptRow({
        ordinal,
        outcome: "incomplete",
        trigger,
        finishReason: "",
        outputChars: 0,
        responseId: usedSession ? requestedSessionId : "",
        usageObserved: false,
        semanticContinuationScheduled: continuityRebased,
      }));
      await appendCommittedAttemptEvents(normalizedEvents, normalizedAttemptEvents({
        ordinal,
        providerId: PROVIDER_OPENCODE_OXALPHA,
        model,
        outputText: "",
        responseId: "",
        usage: {},
        completed: false,
        trigger,
        continuityRebased,
      }), options);
      if (ordinal < policy.maxAttempts) {
        await waitForRetry(continuationDelay(policy, ordinal), input.signal, options.sleepImpl);
      }
      continue;
    }
    const parsed = parseOpenCodeJsonOutput(processResult.stdout);
    const resolvedSessionId = normalizeString(parsed.sessionId, sessionId);
    if (!resolvedSessionId) {
      transportRetryCount += 1;
      outputText = overlapMerge(outputText, parsed.outputText);
      if (outputText.length > policy.maxOutputChars) throw safeError("direct_external_provider_output_limit");
      tokenUsage = addUsage(tokenUsage, parsed.usage);
      rebasePending = Boolean(outputText);
      if (parsed.outputText) semanticContinuationCount += 1;
      const trigger = parsed.invalidJsonObserved
        ? "opencode_json_incomplete"
        : "opencode_session_identity_missing";
      attempts.push(attemptRow({
        ordinal,
        outcome: "incomplete",
        trigger,
        finishReason: parsed.finishReason,
        outputChars: parsed.outputText.length,
        responseId: "",
        usageObserved: Object.keys(parsed.usage).length > 0,
        semanticContinuationScheduled: rebasePending,
      }));
      await appendCommittedAttemptEvents(normalizedEvents, normalizedAttemptEvents({
        ordinal,
        providerId: PROVIDER_OPENCODE_OXALPHA,
        model,
        outputText: parsed.outputText,
        responseId: "",
        usage: parsed.usage,
        completed: false,
        trigger,
        continuityRebased: rebasePending,
      }), options);
      if (ordinal < policy.maxAttempts) {
        await waitForRetry(continuationDelay(policy, ordinal), input.signal, options.sleepImpl);
      }
      continue;
    }
    sessionId = resolvedSessionId;
    rebasePending = false;
    const attemptSessionId = sessionId;
    if (parsed.toolUseObserved) throw safeError("direct_opencode_tool_boundary_violated");
    outputText = overlapMerge(outputText, parsed.outputText);
    if (outputText.length > policy.maxOutputChars) throw safeError("direct_external_provider_output_limit");
    tokenUsage = addUsage(tokenUsage, parsed.usage);
    const completed = parsed.finishReason === "stop" && processResult.exitCode === 0 && !parsed.errorObserved && Boolean(outputText);
    if (completed) {
      attempts.push(attemptRow({
        ordinal,
        outcome: "completed",
        trigger: "terminal_stop",
        finishReason: parsed.finishReason,
        outputChars: parsed.outputText.length,
        responseId: attemptSessionId,
        usageObserved: Object.keys(parsed.usage).length > 0,
        semanticContinuationScheduled: false,
      }));
      await appendCommittedAttemptEvents(normalizedEvents, normalizedAttemptEvents({
        ordinal,
        providerId: PROVIDER_OPENCODE_OXALPHA,
        model,
        outputText: parsed.outputText,
        responseId: attemptSessionId,
        usage: parsed.usage,
        completed: true,
        trigger: "terminal_stop",
      }), options);
      return {
        ok: true,
        terminalState: "completed",
        errorCode: "",
        outputText,
        responseId: attemptSessionId,
        upstreamRequestId: attemptSessionId,
        tokenUsage,
        normalizedEvents: renumberEvents(normalizedEvents),
        continuationTrace: finalTrace({
          providerId: PROVIDER_OPENCODE_OXALPHA,
          model,
          transport: "opencode_cli_json",
          completionState: "completed",
          attempts,
          semanticContinuationCount,
          transportRetryCount,
          terminalFinishReason: parsed.finishReason,
          outputText,
        }),
      };
    }
    if (["content-filter"].includes(parsed.finishReason)) {
      throw safeError("direct_opencode_content_filter_terminal");
    }
    const semanticContinuation = Boolean(parsed.outputText);
    const continuityRebased = usedSession && !semanticContinuation && Boolean(outputText) && (
      processResult.exitCode !== 0 || parsed.errorObserved || parsed.invalidJsonObserved
    );
    const trigger = continuityRebased
      ? "opencode_session_continuity_lost"
      : parsed.finishReason === "length"
      ? "max_output_incomplete"
      : parsed.finishReason === "unknown"
        ? "opencode_finish_unknown"
        : parsed.finishReason === "stop" && processResult.exitCode === 0 && !parsed.errorObserved
          ? "empty_terminal_output"
        : parsed.invalidJsonObserved
          ? "opencode_json_incomplete"
        : processResult.exitCode !== 0 || parsed.errorObserved
          ? "opencode_transport_failed"
          : "opencode_terminal_evidence_missing";
    if (semanticContinuation) semanticContinuationCount += 1;
    else transportRetryCount += 1;
    attempts.push(attemptRow({
      ordinal,
      outcome: "incomplete",
      trigger,
      finishReason: parsed.finishReason,
      outputChars: parsed.outputText.length,
      responseId: attemptSessionId,
      usageObserved: Object.keys(parsed.usage).length > 0,
      semanticContinuationScheduled: semanticContinuation || continuityRebased,
    }));
    await appendCommittedAttemptEvents(normalizedEvents, normalizedAttemptEvents({
      ordinal,
      providerId: PROVIDER_OPENCODE_OXALPHA,
      model,
      outputText: parsed.outputText,
      responseId: attemptSessionId,
      usage: parsed.usage,
      completed: false,
      trigger,
      continuityRebased,
    }), options);
    if (continuityRebased) {
      sessionId = "";
      rebasePending = true;
    } else if (!semanticContinuation && !outputText) {
      sessionId = "";
      rebasePending = false;
    }
    if (ordinal < policy.maxAttempts) {
      await waitForRetry(continuationDelay(policy, ordinal), input.signal, options.sleepImpl);
    }
  }
  const continuationTrace = finalTrace({
    providerId: PROVIDER_OPENCODE_OXALPHA,
    model,
    transport: "opencode_cli_json",
    completionState: "continuation_exhausted",
    attempts,
    semanticContinuationCount,
    transportRetryCount,
    terminalFinishReason: "",
    outputText,
  });
  const error = safeError("direct_external_provider_continuation_exhausted");
  error.continuationTrace = continuationTrace;
  error.normalizedEvents = renumberEvents(normalizedEvents);
  throw error;
}

async function runOpenCodeOxAlphaTurn(input = {}, options = {}) {
  const policy = continuationPolicy({
    maxAttempts: options.maxAttempts ?? process.env.CODEX_DIRECT_0XALPHA_MAX_ATTEMPTS,
    maxTotalMs: options.maxTotalMs ?? process.env.CODEX_DIRECT_0XALPHA_MAX_TOTAL_MS,
    maxOutputChars: options.maxOutputChars ?? process.env.CODEX_DIRECT_0XALPHA_MAX_OUTPUT_CHARS,
    retryBaseMs: options.retryBaseMs ?? process.env.CODEX_DIRECT_0XALPHA_RETRY_BASE_MS,
    continuationPrompt: options.continuationPrompt,
  });
  const deadline = deadlineSignal(input.signal, policy.maxTotalMs);
  const runDirectories = openCodeRunDirectories(input, options);
  let result;
  let primaryError = null;
  try {
    result = await runOpenCodeOxAlphaTurnWithinDeadline({ ...input, signal: deadline.signal }, {
      ...options,
      resolvedPolicy: policy,
      runDirectories,
    });
  } catch (error) {
    if (deadline.timedOut() && !input.signal?.aborted) {
      primaryError = safeError("direct_external_provider_total_timeout");
    } else {
      primaryError = error;
    }
  } finally {
    deadline.dispose();
  }
  try {
    finalizeOpenCodeRunDirectories(runDirectories, options);
  } catch (retentionError) {
    if (!primaryError) throw retentionError;
    primaryError.retentionFailureCode = normalizeString(
      retentionError?.code,
      "direct_opencode_retention_finalize_failed",
    );
  }
  if (primaryError) throw primaryError;
  return result;
}

async function runExternalProviderContinuationTurn(input = {}, options = {}) {
  const providerId = normalizeProviderId(input.providerId || input.provider, "");
  if (providerId === PROVIDER_OPENROUTER_OXALPHA) return runOpenRouterOxAlphaTurn(input, options);
  if (providerId === PROVIDER_OPENCODE_OXALPHA) return runOpenCodeOxAlphaTurn(input, options);
  throw safeError("direct_external_provider_unknown");
}

module.exports = {
  DEFAULT_CONTINUATION_PROMPT,
  EXTERNAL_PROVIDER_CONTINUATION_TRACE_SCHEMA,
  EXTERNAL_PROVIDER_IDS,
  OPENROUTER_OXALPHA_MODEL,
  OPENCODE_OXALPHA_MODEL,
  PROVIDER_CHATGPT_DIRECT,
  PROVIDER_OPENCODE_OXALPHA,
  PROVIDER_OPENROUTER_OXALPHA,
  addUsage,
  buildOpenCodeRebasePrompt,
  continuationPolicy,
  externalProviderProfile,
  loadOpenRouterApiKey,
  normalizeProviderId,
  openCodeProcessLaunchDescriptor,
  overlapMerge,
  finalizeOpenCodeRunDirectories,
  openCodeRunDirectories,
  openCodeRetentionPolicy,
  openOpenCodeEventJournal,
  parseEnvAssignment,
  parseOpenCodeJsonOutput,
  providerDefaultModel,
  pruneOpenCodeRuns,
  reasoningEffortForOpenRouter,
  reasoningVariantForOpenCode,
  resolveOpenRouterEndpoint,
  resolveOpenCodeExecutable,
  resolveOpenCodeLaunchTarget,
  runExternalProviderContinuationTurn,
  runOpenCodeOxAlphaTurn,
  runOpenRouterOxAlphaTurn,
  safeOpenCodeRuntimeEnv,
  spawnOpenCodeProcess,
  streamOpenRouterAttempt,
  wslPathForWindowsPath,
};
