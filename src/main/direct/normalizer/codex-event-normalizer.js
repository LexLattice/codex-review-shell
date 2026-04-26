"use strict";

const NORMALIZED_EVENT_TYPES = Object.freeze([
  "session_started",
  "message_delta",
  "reasoning_delta",
  "tool_call_started",
  "tool_call_delta",
  "tool_call_completed",
  "usage_delta",
  "response_completed",
  "response_incomplete",
  "response_failed",
  "transport_error",
  "auth_error",
  "quota_error",
  "aborted",
]);

const NORMALIZED_EVENT_TYPE_SET = new Set(NORMALIZED_EVENT_TYPES);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeRawType(raw) {
  if (!isPlainObject(raw)) return "";
  if (typeof raw.event === "string" && raw.event.trim()) return raw.event.trim();
  if (typeof raw.type === "string" && raw.type.trim()) return raw.type.trim();
  if (typeof raw.data?.type === "string" && raw.data.type.trim()) return raw.data.type.trim();
  return "";
}

function rawData(raw) {
  if (!isPlainObject(raw)) return {};
  if (isPlainObject(raw.data)) return raw.data;
  return raw;
}

function normalizeSource(raw, rawIndex) {
  return {
    rawIndex,
    rawType: normalizeRawType(raw) || "unknown",
  };
}

function isDoneEvent(raw) {
  return normalizeRawType(raw) === "[DONE]" || rawData(raw) === "[DONE]";
}

function itemFromData(data) {
  return data.item || data.output_item || data.response?.output?.[0] || data;
}

function responseFromData(data) {
  return data.response || data;
}

function usageFromResponse(response) {
  if (!isPlainObject(response)) return null;
  return response.usage || response.output?.usage || null;
}

function normalizeUsage(usage) {
  if (!isPlainObject(usage)) return null;
  const inputTokens = Number(usage.input_tokens ?? usage.inputTokens ?? usage.prompt_tokens ?? 0);
  const outputTokens = Number(usage.output_tokens ?? usage.outputTokens ?? usage.completion_tokens ?? 0);
  const totalTokens = Number(usage.total_tokens ?? usage.totalTokens ?? 0);
  const cachedInputTokens = Number(
    usage.input_tokens_details?.cached_tokens ??
    usage.inputTokensDetails?.cachedTokens ??
    usage.cached_input_tokens ??
    0,
  );
  const reasoningTokens = Number(
    usage.output_tokens_details?.reasoning_tokens ??
    usage.outputTokensDetails?.reasoningTokens ??
    0,
  );
  return {
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : 0,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : 0,
    totalTokens: Number.isFinite(totalTokens) ? totalTokens : 0,
    cachedInputTokens: Number.isFinite(cachedInputTokens) ? cachedInputTokens : 0,
    reasoningTokens: Number.isFinite(reasoningTokens) ? reasoningTokens : 0,
  };
}

function classifyError(errorLike, rawType = "") {
  const code = String(errorLike?.code || errorLike?.type || rawType || "transport_error").toLowerCase();
  const status = Number(errorLike?.status || errorLike?.statusCode || errorLike?.httpStatus || 0);
  const message = String(errorLike?.message || errorLike?.error || "");
  const haystack = `${code} ${status} ${message}`.toLowerCase();
  if (status === 401 || status === 403 || /auth|unauthorized|forbidden|token|credential/.test(haystack)) {
    return "auth_error";
  }
  if (status === 402 || status === 429 || /quota|rate|limit|credit|billing/.test(haystack)) {
    return "quota_error";
  }
  return "transport_error";
}

function normalizedEvent(type, raw, rawIndex, payload = {}) {
  if (!NORMALIZED_EVENT_TYPE_SET.has(type)) {
    throw new Error(`Unsupported normalized event type: ${type}`);
  }
  return {
    type,
    sequence: rawIndex,
    source: normalizeSource(raw, rawIndex),
    ...payload,
  };
}

function normalizeDirectCodexEvent(raw, context) {
  const rawIndex = context.rawIndex;
  const rawType = normalizeRawType(raw);
  const data = rawData(raw);
  const lowerType = rawType.toLowerCase();

  if (isDoneEvent(raw)) return [];
  if (lowerType === "aborted" || lowerType === "abort") {
    return [normalizedEvent("aborted", raw, rawIndex, { reason: data.reason || "aborted" })];
  }

  const error = data.error || raw.error || (/error|failed/.test(lowerType) ? data : null);
  if (error && lowerType !== "response.failed" && lowerType !== "response.incomplete" && lowerType !== "response.completed") {
    const type = lowerType.includes("incomplete") ? "response_incomplete" : classifyError(error, rawType);
    return [
      normalizedEvent(type, raw, rawIndex, {
        code: String(error.code || error.type || rawType || ""),
        message: String(error.message || error.error || error.reason || "Backend event reported an error."),
        retryable: Boolean(error.retryable || data.retryable),
      }),
    ];
  }

  if (lowerType === "response.created" || lowerType === "response.in_progress") {
    const response = responseFromData(data);
    return [
      normalizedEvent("session_started", raw, rawIndex, {
        responseId: response.id || data.response_id || "",
        model: response.model || data.model || context.model || "",
      }),
    ];
  }

  if (lowerType === "response.output_text.delta" || lowerType === "response.message.delta") {
    return [
      normalizedEvent("message_delta", raw, rawIndex, {
        itemId: data.item_id || data.itemId || data.output_index || "",
        text: String(data.delta ?? data.text ?? ""),
      }),
    ];
  }

  if (
    lowerType === "response.reasoning_summary_text.delta" ||
    lowerType === "response.reasoning_text.delta" ||
    lowerType === "response.reasoning.delta"
  ) {
    return [
      normalizedEvent("reasoning_delta", raw, rawIndex, {
        itemId: data.item_id || data.itemId || "",
        text: String(data.delta ?? data.text ?? ""),
        visibility: lowerType.includes("summary") ? "summary" : "opaque",
      }),
    ];
  }

  if (lowerType === "response.output_item.added") {
    const item = itemFromData(data);
    if (item.type === "function_call" || item.type === "custom_tool_call") {
      return [
        normalizedEvent("tool_call_started", raw, rawIndex, {
          itemId: item.id || data.item_id || "",
          callId: item.call_id || item.callId || "",
          name: item.name || "",
          toolType: item.type,
        }),
      ];
    }
    return [];
  }

  if (
    lowerType === "response.function_call_arguments.delta" ||
    lowerType === "response.custom_tool_call_input.delta"
  ) {
    return [
      normalizedEvent("tool_call_delta", raw, rawIndex, {
        itemId: data.item_id || data.itemId || "",
        callId: data.call_id || data.callId || "",
        argumentsDelta: String(data.delta ?? data.arguments_delta ?? data.input_delta ?? ""),
      }),
    ];
  }

  if (lowerType === "response.output_item.done") {
    const item = itemFromData(data);
    if (item.type === "function_call" || item.type === "custom_tool_call") {
      return [
        normalizedEvent("tool_call_completed", raw, rawIndex, {
          itemId: item.id || data.item_id || "",
          callId: item.call_id || item.callId || "",
          name: item.name || "",
          argumentsJson: String(item.arguments ?? item.input ?? ""),
          toolType: item.type,
        }),
      ];
    }
    return [];
  }

  if (lowerType === "response.completed") {
    const response = responseFromData(data);
    const events = [];
    const usage = normalizeUsage(usageFromResponse(response));
    if (usage) events.push(normalizedEvent("usage_delta", raw, rawIndex, { usage }));
    events.push(
      normalizedEvent("response_completed", raw, rawIndex, {
        responseId: response.id || data.response_id || "",
        stopReason: response.status || "completed",
      }),
    );
    return events;
  }

  if (lowerType === "response.incomplete") {
    const response = responseFromData(data);
    return [
      normalizedEvent("response_incomplete", raw, rawIndex, {
        responseId: response.id || data.response_id || "",
        reason: response.incomplete_details?.reason || data.reason || "incomplete",
      }),
    ];
  }

  if (lowerType === "response.failed") {
    const response = responseFromData(data);
    const failed = response.error || data.error || {};
    return [
      normalizedEvent("response_failed", raw, rawIndex, {
        responseId: response.id || data.response_id || "",
        code: String(failed.code || failed.type || ""),
        message: String(failed.message || "Response failed."),
        retryable: Boolean(failed.retryable),
      }),
    ];
  }

  return [];
}

function normalizeDirectCodexEvents(rawEvents, options = {}) {
  if (!Array.isArray(rawEvents)) throw new Error("Raw events must be an array.");
  const normalized = [];
  const unknown = [];
  for (let index = 0; index < rawEvents.length; index += 1) {
    const before = normalized.length;
    const events = normalizeDirectCodexEvent(rawEvents[index], { rawIndex: index, model: options.model || "" });
    normalized.push(...events);
    if (events.length === 0) {
      const rawType = normalizeRawType(rawEvents[index]);
      if (rawType && rawType !== "[DONE]") unknown.push({ rawIndex: index, rawType });
    }
    if (normalized.length === before && options.failOnUnknown && !isDoneEvent(rawEvents[index])) {
      const rawType = normalizeRawType(rawEvents[index]) || "unknown";
      throw new Error(`No normalizer mapping for raw event ${rawType} at index ${index}.`);
    }
  }
  return { normalized, unknown };
}

function parseSseFixtureText(text) {
  const events = [];
  const frames = String(text || "").split(/\r?\n\r?\n/);
  for (const frame of frames) {
    const trimmed = frame.trim();
    if (!trimmed) continue;
    let event = "";
    const dataLines = [];
    for (const line of trimmed.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice("event:".length).trim();
      if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trimStart());
    }
    const dataText = dataLines.join("\n");
    if (dataText === "[DONE]") {
      events.push({ event: "[DONE]", data: "[DONE]" });
      continue;
    }
    try {
      const data = dataText ? JSON.parse(dataText) : {};
      events.push(event ? { event, data } : data);
    } catch (error) {
      throw new Error(`Invalid SSE data JSON for event ${event || "message"}: ${error.message}`);
    }
  }
  return events;
}

module.exports = {
  NORMALIZED_EVENT_TYPES,
  classifyError,
  normalizeDirectCodexEvent,
  normalizeDirectCodexEvents,
  parseSseFixtureText,
};
