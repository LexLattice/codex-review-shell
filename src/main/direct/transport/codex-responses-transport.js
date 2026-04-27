"use strict";

const {
  normalizeDirectCodexEvents,
  parseSseFixtureText,
} = require("../normalizer/codex-event-normalizer");
const { redactFixture } = require("../fixtures/redaction");

const DIRECT_TEXT_PROBE_RESULT_SCHEMA = "direct_codex_text_probe_result@1";
const DEFAULT_CODEX_RESPONSES_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";
const DEFAULT_TEXT_PROBE_PROMPT = "Reply with exactly: direct text probe ok";
const DEFAULT_TEXT_PROBE_INSTRUCTIONS = "You are Codex running a text-only direct transport probe. Do not request tools.";
const DEFAULT_PRE_STREAM_REFRESH_MS = 120_000;
const DEFAULT_PRE_STREAM_RETRIES = 1;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function redactTextForDiagnostic(value, maxLength = 4000) {
  const text = normalizeString(value, "");
  return redactFixture(text.length > maxLength ? `${text.slice(0, maxLength)}...` : text);
}

function accessTokenFromCredentials(credentials = {}) {
  const token = normalizeString(credentials.accessToken || credentials.access_token || credentials.access, "");
  if (!token) throw new Error("Direct text probe requires an access token.");
  return token;
}

function expiresInMs(credentials = {}, nowMs = Date.now()) {
  const expiresAt = Number(credentials.expiresAt ?? credentials.expires ?? 0) || 0;
  return expiresAt > 0 ? Math.max(0, expiresAt - nowMs) : Number.POSITIVE_INFINITY;
}

function shouldRefreshCredentials(credentials = {}, options = {}) {
  const refreshBeforeMs = Number(options.refreshBeforeMs ?? DEFAULT_PRE_STREAM_REFRESH_MS);
  if (!credentials?.refreshToken && !credentials?.refresh_token && !credentials?.refresh) return false;
  if (options.forceRefresh === true) return true;
  if (!credentials?.accessToken && !credentials?.access_token && !credentials?.access) return true;
  return expiresInMs(credentials, options.nowMs) <= Math.max(0, refreshBeforeMs);
}

async function resolveProbeCredentials(options = {}) {
  const authStore = options.authStore && typeof options.authStore.readCredentials === "function"
    ? options.authStore
    : null;
  let credentials = authStore ? authStore.readCredentials() : options.credentials;
  const refresh = {
    attempted: false,
    ok: false,
    reason: "",
    preStreamOnly: true,
  };
  if (shouldRefreshCredentials(credentials, options)) {
    refresh.attempted = true;
    if (typeof options.refreshCredentials !== "function") {
      refresh.reason = "refresh_unavailable";
      const error = new Error("Direct text probe credentials require refresh before request.");
      error.code = "direct_auth_refresh_unavailable";
      error.refresh = refresh;
      throw error;
    }
    const refreshResult = await options.refreshCredentials({
      authStore,
      credentials,
      reason: options.forceRefresh === true ? "forced" : "expiring",
    });
    refresh.ok = refreshResult?.ok !== false;
    refresh.reason = normalizeString(refreshResult?.reason || refreshResult?.status, "");
    if (!refresh.ok) {
      const error = new Error(refresh.reason || "Direct text probe credential refresh failed.");
      error.code = "direct_auth_refresh_failed";
      error.refresh = refresh;
      throw error;
    }
    credentials = authStore ? authStore.readCredentials() : (refreshResult?.credentials || credentials);
  }
  accessTokenFromCredentials(credentials || {});
  return { credentials, refresh };
}

function modelFromProfile(profileDoc = {}, fallback = "gpt-5.4") {
  const models = profileDoc.profile?.ontology?.models;
  const accepted = Array.isArray(models) ? models.find((model) => model?.id && model.status !== "rejected") : null;
  return normalizeString(accepted?.id, fallback);
}

function buildTextOnlyProbeRequest(options = {}) {
  const prompt = normalizeString(options.prompt, DEFAULT_TEXT_PROBE_PROMPT);
  const instructions = normalizeString(options.instructions, DEFAULT_TEXT_PROBE_INSTRUCTIONS);
  const model = normalizeString(options.model, modelFromProfile(options.profileDoc));
  return {
    model,
    stream: true,
    store: false,
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
}

function requestShapeForDiagnostic(requestBody = {}) {
  return {
    model: normalizeString(requestBody.model, ""),
    stream: requestBody.stream === true,
    store: requestBody.store === true,
    hasInstructions: Boolean(requestBody.instructions),
    inputMessageCount: Array.isArray(requestBody.input) ? requestBody.input.length : 0,
    textInputCount: Array.isArray(requestBody.input)
      ? requestBody.input.reduce((count, item) => count + (Array.isArray(item?.content)
        ? item.content.filter((content) => content?.type === "input_text").length
        : 0), 0)
      : 0,
    toolCount: Array.isArray(requestBody.tools) ? requestBody.tools.length : 0,
  };
}

function authHeaders(credentials = {}) {
  return {
    Authorization: `Bearer ${accessTokenFromCredentials(credentials)}`,
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
}

function decodeTextChunk(decoder, chunk) {
  if (typeof chunk === "string") return decoder.decode(Buffer.from(chunk), { stream: true });
  return decoder.decode(chunk, { stream: true });
}

async function responseText(response) {
  if (response && typeof response.text === "function") return response.text();
  if (response?.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  }
  if (response?.body && typeof response.body[Symbol.asyncIterator] === "function") {
    const decoder = new TextDecoder();
    let text = "";
    for await (const chunk of response.body) text += decodeTextChunk(decoder, chunk);
    text += decoder.decode();
    return text;
  }
  return "";
}

function errorRawEvent(status, message, code = "") {
  return {
    event: "error",
    data: {
      error: {
        status: Number(status) || 0,
        code: normalizeString(code, status ? `http_${status}` : "transport_error"),
        message: normalizeString(message, "Direct text probe transport failed."),
      },
    },
  };
}

function diagnosticFromResult(result = {}) {
  return redactFixture({
    schema: "direct_codex_text_probe_diagnostic@1",
    capturedAt: nowIso(),
    ok: Boolean(result.ok),
    endpoint: normalizeString(result.endpoint, ""),
    request: result.requestShape || {},
    response: result.response || {},
    normalizedEventTypes: Array.isArray(result.normalizedEvents) ? result.normalizedEvents.map((event) => event.type) : [],
    unknownRawTypes: Array.isArray(result.unknownRawTypes) ? result.unknownRawTypes : [],
    error: result.error || null,
  });
}

function notifyLifecycle(callback, phase, details = {}) {
  if (typeof callback !== "function") return;
  callback({
    phase,
    at: nowIso(),
    ...details,
  });
}

function normalizeRetryLimit(options = {}) {
  const value = Number(options.maxPreStreamRetries ?? options.retry?.maxPreStreamRetries ?? DEFAULT_PRE_STREAM_RETRIES);
  return Number.isFinite(value) ? Math.max(0, Math.min(3, Math.floor(value))) : DEFAULT_PRE_STREAM_RETRIES;
}

function isAbortError(error) {
  return error?.name === "AbortError" || error?.code === "ABORT_ERR";
}

function errorCodeFromCaught(error, streamStarted = false) {
  if (isAbortError(error)) return "aborted";
  if (error?.code === "direct_auth_refresh_failed" || error?.code === "direct_auth_refresh_unavailable") return "auth_error";
  return streamStarted ? "stream_failed" : "fetch_failed";
}

function isRetryablePreStreamError(error) {
  const code = normalizeString(error?.code, "").toUpperCase();
  if (isAbortError(error) || error?.code === "direct_auth_refresh_failed" || error?.code === "direct_auth_refresh_unavailable") {
    return false;
  }
  return [
    "ECONNRESET",
    "ECONNREFUSED",
    "EAI_AGAIN",
    "ENETUNREACH",
    "ETIMEDOUT",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_SOCKET",
  ].includes(code);
}

function terminalStateFromNormalizedEvents(normalizedEvents = []) {
  if (normalizedEvents.some((event) => event.type === "aborted")) {
    return { state: "aborted", error: null };
  }
  const failure = normalizedEvents.find((event) =>
    event.type === "response_failed" ||
    event.type === "transport_error" ||
    event.type === "auth_error" ||
    event.type === "quota_error");
  if (failure) {
    return {
      state: "failed",
      error: {
        code: normalizeString(failure.code, failure.type),
        message: normalizeString(failure.message, "Direct text probe failed."),
      },
    };
  }
  if (normalizedEvents.some((event) => event.type === "response_completed")) {
    return { state: "completed", error: null };
  }
  if (normalizedEvents.some((event) => event.type === "response_incomplete")) {
    return {
      state: "failed",
      error: {
        code: "response_incomplete",
        message: "Direct text probe response was incomplete.",
      },
    };
  }
  return {
    state: "failed",
    error: {
      code: "missing_terminal_event",
      message: "Direct text probe ended without a terminal response event.",
    },
  };
}

async function runTextOnlyDirectProbe(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("Direct text probe requires fetch.");
  const endpoint = normalizeString(options.endpoint, DEFAULT_CODEX_RESPONSES_ENDPOINT);
  const requestBody = buildTextOnlyProbeRequest(options);
  notifyLifecycle(options.onLifecycle, "request_built", {
    requestShape: requestShapeForDiagnostic(requestBody),
  });
  const startedAt = nowIso();
  let response = null;
  let rawText = "";
  let rawEvents = [];
  let normalizedEvents = [];
  let unknownRawTypes = [];
  let error = null;
  let responseOk = false;
  let streamStarted = false;
  let credentialRefresh = { attempted: false, ok: false, reason: "", preStreamOnly: true };
  let resolvedCredentials = null;
  const attempts = [];
  const maxPreStreamRetries = normalizeRetryLimit(options);

  for (let attempt = 0; attempt <= maxPreStreamRetries; attempt += 1) {
    const attemptNumber = attempt + 1;
    try {
      if (!resolvedCredentials) {
        const resolved = await resolveProbeCredentials(options);
        credentialRefresh = resolved.refresh;
        resolvedCredentials = resolved.credentials;
      }
      notifyLifecycle(options.onLifecycle, "request_attempt", {
        attempt: attemptNumber,
        maxAttempts: maxPreStreamRetries + 1,
        credentialRefresh,
      });
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: authHeaders(resolvedCredentials || {}),
        body: JSON.stringify(requestBody),
        signal: options.signal,
      });
      const status = Number(response?.status || 0);
      const ok = response?.ok === true || (response?.ok !== false && status >= 200 && status < 300);
      responseOk = ok;
      if (ok) {
        streamStarted = true;
        notifyLifecycle(options.onLifecycle, "streaming", {
          attempt: attemptNumber,
          status,
          contentType: typeof response?.headers?.get === "function" ? normalizeString(response.headers.get("content-type"), "") : "",
        });
      }
      rawText = await responseText(response);
      if (!ok) {
        rawEvents = [errorRawEvent(response.status, rawText || response.statusText || "HTTP request failed.")];
      } else {
        rawEvents = parseSseFixtureText(rawText);
      }
      attempts.push({
        attempt: attemptNumber,
        status,
        streamStarted,
        retry: false,
      });
      break;
    } catch (caught) {
      const aborted = options.signal?.aborted === true || isAbortError(caught);
      const code = errorCodeFromCaught(caught, streamStarted);
      const message = caught?.message || String(caught || (aborted ? "Direct text probe was aborted." : "Direct text probe fetch failed."));
      const retry = !aborted && !streamStarted && attempt < maxPreStreamRetries && isRetryablePreStreamError(caught);
      attempts.push({
        attempt: attemptNumber,
        code,
        streamStarted,
        retry,
      });
      if (retry) {
        notifyLifecycle(options.onLifecycle, "retry_scheduled", {
          attempt: attemptNumber,
          nextAttempt: attemptNumber + 1,
          code,
        });
        continue;
      }
      error = {
        code,
        message,
      };
      rawEvents = aborted
        ? [{ event: "aborted", data: { reason: error.message } }]
        : [errorRawEvent(0, error.message, error.code)];
      break;
    }
  }

  const normalizedResult = normalizeDirectCodexEvents(rawEvents, {
    failOnUnknown: false,
    model: requestBody.model,
  });
  normalizedEvents = normalizedResult.normalized;
  unknownRawTypes = normalizedResult.unknown.map((event) => event.rawType);
  const terminal = terminalStateFromNormalizedEvents(normalizedEvents);
  const result = {
    schema: DIRECT_TEXT_PROBE_RESULT_SCHEMA,
    ok: terminal.state === "completed",
    startedAt,
    completedAt: nowIso(),
    endpoint,
    requestShape: requestShapeForDiagnostic(requestBody),
    response: {
      status: Number(response?.status || 0),
      ok: responseOk,
      contentType: typeof response?.headers?.get === "function" ? normalizeString(response.headers.get("content-type"), "") : "",
      redactedTextPreview: redactTextForDiagnostic(rawText, 1200),
    },
    rawEvents: redactFixture(rawEvents),
    normalizedEvents,
    unknownRawTypes,
    terminal,
    error,
    lifecycle: {
      streamStarted,
      attempts,
      credentialRefresh,
      retryPolicy: {
        maxPreStreamRetries,
        retriesAfterStreamStart: false,
      },
    },
    rawAuthHeadersExposed: false,
    rawBackendRequestsExposed: false,
    rawBackendFramesExposed: false,
  };
  result.diagnostic = diagnosticFromResult(result);
  return result;
}

function assistantTextFromEvents(normalizedEvents = []) {
  return normalizedEvents
    .filter((event) => event.type === "message_delta")
    .map((event) => event.text || "")
    .join("");
}

async function runPersistedTextOnlyDirectProbe(options = {}) {
  const sessionStore = options.sessionStore;
  if (!sessionStore) throw new Error("Persisted direct text probe requires a session store.");
  const project = isPlainObject(options.project) ? options.project : {};
  const requestBody = buildTextOnlyProbeRequest(options);
  const prompt = requestBody.input?.[0]?.content?.find((item) => item?.type === "input_text")?.text || DEFAULT_TEXT_PROBE_PROMPT;
  const session = sessionStore.createSession({
    projectId: normalizeString(project.id, "direct_text_probe"),
    workspace: isPlainObject(project.workspace) ? project.workspace : {},
    title: "Direct text probe",
    model: requestBody.model,
    profileSnapshotId: normalizeString(project.surfaceBinding?.codex?.profileId, ""),
  });
  const turn = sessionStore.createTurn(session.sessionId, {
    input: [{ role: "user", text: prompt }],
    model: requestBody.model,
  });
  const requestShape = requestShapeForDiagnostic(requestBody);
  sessionStore.updateTurnState(session.sessionId, turn.turnId, "request_built", {
    requestShape,
  }, options);
  const callerLifecycle = options.onLifecycle;
  const result = await runTextOnlyDirectProbe({
    ...options,
    onLifecycle: (event) => {
      if (event.phase === "streaming") {
        sessionStore.updateTurnState(session.sessionId, turn.turnId, "streaming", {
          streamStartedAt: event.at,
          responseStatus: event.status,
          responseContentType: event.contentType,
        }, options);
      }
      if (typeof callerLifecycle === "function") callerLifecycle(event);
    },
  });
  sessionStore.writeDiagnostic(session.sessionId, "direct_text_probe", result.diagnostic, options);
  if (result.normalizedEvents.length) {
    sessionStore.appendNormalizedEvents(session.sessionId, turn.turnId, result.normalizedEvents, options);
  }
  const terminal = result.terminal || terminalStateFromNormalizedEvents(result.normalizedEvents);
  const completedTurn = sessionStore.updateTurnState(
    session.sessionId,
    turn.turnId,
    terminal.state,
    terminal.error ? { error: terminal.error } : {},
    options,
  );
  const nextSession = sessionStore.readSession(session.sessionId);
  sessionStore.writeSession({
    ...(nextSession || session),
    updatedAt: nowIso(),
    status: terminal.state,
    messages: [
      ...((nextSession || session).messages || []),
      {
        id: turn.turnId,
        status: terminal.state,
        items: [
          {
            id: `${turn.turnId}_user`,
            type: "userMessage",
            turnId: turn.turnId,
            content: [{ type: "text", text: prompt, text_elements: [] }],
          },
          ...(assistantTextFromEvents(result.normalizedEvents)
            ? [{
                id: `${turn.turnId}_assistant`,
                type: "agentMessage",
                turnId: turn.turnId,
                text: assistantTextFromEvents(result.normalizedEvents),
              }]
            : []),
        ],
      },
    ],
  });
  return {
    ...result,
    sessionId: session.sessionId,
    turnId: turn.turnId,
    turnState: completedTurn.state,
  };
}

module.exports = {
  DEFAULT_CODEX_RESPONSES_ENDPOINT,
  DEFAULT_TEXT_PROBE_INSTRUCTIONS,
  DEFAULT_TEXT_PROBE_PROMPT,
  DIRECT_TEXT_PROBE_RESULT_SCHEMA,
  buildTextOnlyProbeRequest,
  diagnosticFromResult,
  requestShapeForDiagnostic,
  runPersistedTextOnlyDirectProbe,
  runTextOnlyDirectProbe,
  terminalStateFromNormalizedEvents,
};
