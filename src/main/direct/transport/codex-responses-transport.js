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
  const startedAt = nowIso();
  let response = null;
  let rawText = "";
  let rawEvents = [];
  let normalizedEvents = [];
  let unknownRawTypes = [];
  let error = null;
  let responseOk = false;

  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: authHeaders(options.credentials || {}),
      body: JSON.stringify(requestBody),
      signal: options.signal,
    });
    rawText = await responseText(response);
    const status = Number(response?.status || 0);
    const ok = response?.ok === true || (response?.ok !== false && status >= 200 && status < 300);
    responseOk = ok;
    if (!ok) {
      rawEvents = [errorRawEvent(response.status, rawText || response.statusText || "HTTP request failed.")];
    } else {
      rawEvents = parseSseFixtureText(rawText);
    }
  } catch (caught) {
    const aborted = options.signal?.aborted === true || caught?.name === "AbortError" || caught?.code === "ABORT_ERR";
    error = {
      code: aborted ? "aborted" : "fetch_failed",
      message: caught?.message || String(caught || (aborted ? "Direct text probe was aborted." : "Direct text probe fetch failed.")),
    };
    rawEvents = aborted
      ? [{ event: "aborted", data: { reason: error.message } }]
      : [errorRawEvent(0, error.message, error.code)];
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
  const result = await runTextOnlyDirectProbe(options);
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
