"use strict";

// Lets an agent drive the running app's real Direct runtime (the same
// controller, executors, grants and model catalog the Workbench uses) from
// the command line, to test real workflows with real model calls. Off unless
// the app is started with DIRECT_TEST_CONTROL=1, and then only reachable on
// 127.0.0.1 with the token written to the profile folder.

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const CONTROL_FILE_NAME = "direct-test-control.json";
const CONTROL_SCHEMA = "direct_test_control@1";
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_EVENTS_PER_PROJECT = 5000;
const DEFAULT_WAIT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_TEXT_LIMIT = 600;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function clip(value, limit = DEFAULT_TEXT_LIMIT) {
  const text = typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value);
  if (!(limit > 0) || text.length <= limit) return text;
  return `${text.slice(0, limit)}… [${text.length - limit} more chars]`;
}

function readJsonLines(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

class DirectTestControlServer {
  constructor(options = {}) {
    this.userDataDir = path.resolve(String(options.userDataDir || "."));
    this.controller = options.controller; // () => DirectLiveTextController
    this.createSurfaceSession = options.createSurfaceSession; // (project) => DirectLiveTextSurfaceSession
    this.projects = options.projects; // { list(), get(id), create(spec) }
    this.createThread = options.createThread; // (project, payload) => draft-session result
    this.terminalStates = options.terminalStates instanceof Set ? options.terminalStates : new Set();
    this.onShutdown = typeof options.onShutdown === "function" ? options.onShutdown : () => {};
    this.appInfo = isPlainObject(options.appInfo) ? options.appInfo : {};
    this.token = crypto.randomBytes(24).toString("hex");
    this.server = null;
    this.port = 0;
    this.sessions = new Map(); // projectId -> { session, events, seq }
  }

  get controlFilePath() {
    return path.join(this.userDataDir, CONTROL_FILE_NAME);
  }

  async listen() {
    this.server = http.createServer((request, response) => {
      this.handle(request, response).catch((error) => {
        this.sendJson(response, error.status || 500, {
          ok: false,
          error: { code: error.code || "test_control_error", message: error.message || String(error) },
        });
      });
    });
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", resolve);
    });
    this.port = this.server.address().port;
    fs.mkdirSync(this.userDataDir, { recursive: true });
    fs.writeFileSync(this.controlFilePath, `${JSON.stringify({
      schema: CONTROL_SCHEMA,
      pid: process.pid,
      host: "127.0.0.1",
      port: this.port,
      token: this.token,
      platform: process.platform,
      userDataDir: this.userDataDir,
      startedAt: new Date().toISOString(),
      ...this.appInfo,
    }, null, 2)}\n`, { mode: 0o600 });
    return { port: this.port };
  }

  async close() {
    try {
      fs.rmSync(this.controlFilePath, { force: true });
    } catch {}
    for (const entry of this.sessions.values()) await entry.session.dispose?.({ silent: true }).catch?.(() => {});
    this.sessions.clear();
    if (this.server) await new Promise((resolve) => this.server.close(() => resolve()));
    this.server = null;
  }

  sendJson(response, status, body) {
    const text = JSON.stringify(body);
    response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text) });
    response.end(text);
  }

  async readBody(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) throw httpError(413, "test_control_body_too_large", "Request body is too large.");
      chunks.push(chunk);
    }
    if (!chunks.length) return {};
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      return isPlainObject(parsed) ? parsed : {};
    } catch {
      throw httpError(400, "test_control_bad_json", "Request body must be a JSON object.");
    }
  }

  authorized(request) {
    const header = String(request.headers.authorization || "");
    const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
    const expected = Buffer.from(this.token);
    const actual = Buffer.from(presented);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }

  async handle(request, response) {
    if (!this.authorized(request)) throw httpError(401, "test_control_unauthorized", "Missing or wrong test control token.");
    const url = new URL(request.url, "http://127.0.0.1");
    const route = `${request.method} ${url.pathname}`;
    const body = request.method === "POST" ? await this.readBody(request) : {};
    const query = Object.fromEntries(url.searchParams.entries());
    const handlers = {
      "GET /v1/status": () => this.status(),
      "GET /v1/projects": () => ({ projects: this.projects.list().map(publicProject) }),
      "POST /v1/projects": () => this.createProject(body),
      "POST /v1/threads": () => this.startThread(body),
      "POST /v1/turns": () => this.startTurn(body),
      "POST /v1/turns/interrupt": () => this.interruptTurn(body),
      "POST /v1/turns/wait": () => this.waitForTurn(body),
      "GET /v1/turns/report": () => this.turnReport(query),
      "GET /v1/threads/report": () => this.threadReport(query),
      "POST /v1/request": () => this.genericRequest(body),
      "GET /v1/events": () => this.events(query),
      "POST /v1/respond": () => this.respond(body),
      "POST /v1/shutdown": () => {
        setTimeout(() => this.onShutdown(), 50);
        return { shuttingDown: true };
      },
    };
    const handler = handlers[route];
    if (!handler) throw httpError(404, "test_control_not_found", `No test control route ${route}.`);
    const result = await handler();
    this.sendJson(response, 200, { ok: true, ...result });
  }

  status() {
    const controller = this.controller();
    const auth = typeof controller.authStatus === "function" ? controller.authStatus() : {};
    return {
      pid: process.pid,
      platform: process.platform,
      userDataDir: this.userDataDir,
      auth: { status: normalizeString(auth.status, "unknown"), source: normalizeString(auth.source || auth.authSource, "") },
      projects: this.projects.list().length,
      ...this.appInfo,
    };
  }

  async project(projectId) {
    const project = await this.projects.get(normalizeString(projectId, ""));
    if (!project) throw httpError(404, "test_control_project_not_found", `No project ${projectId}.`);
    return project;
  }

  async surface(projectId) {
    const project = await this.project(projectId);
    let entry = this.sessions.get(project.id);
    if (!entry) {
      const session = this.createSurfaceSession(project);
      entry = { session, events: [], seq: 0 };
      session.on("event", (event) => {
        entry.seq += 1;
        entry.events.push({ seq: entry.seq, at: new Date().toISOString(), event });
        if (entry.events.length > MAX_EVENTS_PER_PROJECT) entry.events.splice(0, entry.events.length - MAX_EVENTS_PER_PROJECT);
      });
      await session.connect({ transport: "direct-live-text" });
      this.sessions.set(project.id, entry);
    } else {
      entry.session.project = project;
    }
    return { project, entry };
  }

  async createProject(body = {}) {
    const project = await this.projects.create(body);
    return { project: publicProject(project) };
  }

  // As the Workbench's "New thread": a WorkThread draft session, then the
  // thread's Access.
  async startThread(body = {}) {
    const { project, entry } = await this.surface(body.projectId);
    const created = await this.createThread(project, {
      projectId: project.id,
      clientDraftId: `test_control_thread_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`,
      title: normalizeString(body.title, `${project.name} test thread`),
      objectiveSummary: "Test thread driven through the Direct test control port.",
      contextPosture: "fresh_session_only",
      model: normalizeString(body.model, "") || null,
      reasoningEffort: normalizeString(body.reasoningEffort, "") || null,
    });
    if (created?.status !== "created" || !created.thread) {
      throw httpError(409, "test_control_thread_not_created", `Thread draft did not create a session: ${JSON.stringify(created?.draft?.blockerCodes || created?.status || "")}`);
    }
    const threadId = normalizeString(created.thread.id || created.thread.threadId, "");
    const accessProfile = normalizeString(body.accessProfile, "");
    if (accessProfile) await entry.session.request("thread/selectAccessProfile", { sessionId: threadId, accessProfile });
    return {
      threadId,
      workThreadId: normalizeString(created.thread.workThreadId, ""),
      model: normalizeString(created.thread.model, normalizeString(body.model, "")),
      accessProfile,
    };
  }

  workThreadIdFor(threadId) {
    const session = this.controller().sessionStore.readSession(threadId) || {};
    return normalizeString(session.workThreadId || session.workThread?.workThreadId, "");
  }

  // As the Workbench composer's send.
  async startTurn(body = {}) {
    const { entry } = await this.surface(body.projectId);
    const threadId = normalizeString(body.threadId, "");
    const text = typeof body.text === "string" ? body.text : "";
    if (!threadId || !text.trim()) throw httpError(400, "test_control_turn_input_required", "threadId and text are required.");
    const params = {
      threadId,
      input: [{ type: "text", text, text_elements: [] }],
      model: normalizeString(body.model, "") || null,
      effort: normalizeString(body.reasoningEffort || body.effort, "") || undefined,
      clientTurnRequestId: `test_control_turn_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`,
      promptText: text,
      attachmentDrafts: [],
      attachmentDraftSetDigest: "",
      daybreakEnabled: body.daybreak === true,
    };
    const workThreadId = normalizeString(body.workThreadId, "") || this.workThreadIdFor(threadId);
    if (workThreadId) params.workThreadId = workThreadId;
    if (normalizeString(body.serviceTier, "")) params.serviceTier = body.serviceTier;
    const startSeq = entry.seq;
    const result = await entry.session.request("turn/start", params);
    return { threadId, turnId: normalizeString(result?.turn?.id, ""), eventSeq: startSeq };
  }

  async interruptTurn(body = {}) {
    const { entry } = await this.surface(body.projectId);
    const result = await entry.session.request("turn/interrupt", { threadId: body.threadId, turnId: body.turnId });
    return { status: normalizeString(result?.status, "") };
  }

  async genericRequest(body = {}) {
    const { entry } = await this.surface(body.projectId);
    const method = normalizeString(body.method, "");
    if (!method) throw httpError(400, "test_control_method_required", "method is required.");
    return { result: await entry.session.request(method, isPlainObject(body.params) ? body.params : {}) };
  }

  async events(query = {}) {
    const { entry } = await this.surface(query.projectId);
    const since = Number(query.since || 0) || 0;
    const events = entry.events.filter((item) => item.seq > since).map(publicEvent);
    return { events, next: entry.seq };
  }

  approvalResult(request = {}, decision = "approve", answer = "") {
    const params = isPlainObject(request.params) ? request.params : {};
    if (request.method === "item/tool/requestUserInput") {
      const questions = Array.isArray(params.questions) ? params.questions : [];
      const answers = {};
      (questions.length ? questions : [{ id: "answer" }]).forEach((question, index) => {
        answers[normalizeString(question.id, `q${index + 1}`)] = { answers: [answer || "Continue."] };
      });
      return { answers };
    }
    const decisionId = `test_control_${decision}_${crypto.randomBytes(4).toString("hex")}`;
    return {
      decision,
      actionTokenId: normalizeString(params.actionTokens?.[decision], ""),
      clientToolDecisionId: decisionId,
      clientPatchDecisionId: decisionId,
      clientCommandDecisionId: decisionId,
    };
  }

  // Answers in the background: a decision runs the rest of the tool loop.
  async respond(body = {}) {
    const { entry } = await this.surface(body.projectId);
    const key = normalizeString(body.key, "");
    const record = entry.session.serverRequests.get(key);
    if (!record) throw httpError(404, "test_control_request_not_found", `No pending request ${key}.`);
    const decision = ["approve", "decline", "cancel"].includes(body.decision) ? body.decision : "approve";
    const result = isPlainObject(body.result) ? body.result : this.approvalResult(record, decision, normalizeString(body.answer, ""));
    entry.session.respond(key, result).catch(() => {});
    return { key, method: record.method, decision: record.method === "item/tool/requestUserInput" ? "answered" : decision };
  }

  // Waits for the turn to settle, answering owner requests by policy:
  // approvals "approve" | "decline" | "pending" (return when one is raised).
  // stopAfterMs / stopAfterToolCalls press Stop once the condition is met.
  async waitForTurn(body = {}) {
    const { entry } = await this.surface(body.projectId);
    const store = this.controller().sessionStore;
    const threadId = normalizeString(body.threadId, "");
    const turnId = normalizeString(body.turnId, "");
    if (!store.readTurn(threadId, turnId)) throw httpError(404, "test_control_turn_not_found", `No turn ${turnId}.`);
    const timeoutMs = Math.max(1000, Number(body.timeoutMs) || DEFAULT_WAIT_TIMEOUT_MS);
    const approvals = ["approve", "decline", "pending"].includes(body.approvals) ? body.approvals : "approve";
    const stopAfterMs = Number(body.stopAfterMs) || 0;
    const stopAfterToolCalls = Number(body.stopAfterToolCalls) || 0;
    const startedAt = Date.now();
    const answered = new Set();
    const decisions = [];
    let stopped = false;
    let outcome = "settled";
    for (;;) {
      const turn = store.readTurn(threadId, turnId) || {};
      if (this.terminalStates.has(turn.state)) break;
      const pending = [...entry.session.serverRequests.values()].filter((request) =>
        request.status === "pending" && !answered.has(request.key) &&
        normalizeString(request.params?.turnId, turnId) === turnId);
      if (pending.length && approvals === "pending") {
        outcome = "waiting_for_owner";
        break;
      }
      for (const request of pending) {
        answered.add(request.key);
        const decision = request.method === "item/tool/requestUserInput" ? "answered" : approvals;
        decisions.push({ key: request.key, method: request.method, summary: request.summary, decision });
        entry.session.respond(request.key, this.approvalResult(request, approvals, normalizeString(body.answer, ""))).catch(() => {});
      }
      const toolCalls = Array.isArray(turn.unresolvedObligations) ? turn.unresolvedObligations.length : 0;
      if (!stopped && ((stopAfterMs && Date.now() - startedAt >= stopAfterMs) || (stopAfterToolCalls && toolCalls >= stopAfterToolCalls))) {
        stopped = true;
        await entry.session.request("turn/interrupt", { threadId, turnId }).catch(() => {});
      }
      if (Date.now() - startedAt > timeoutMs) {
        outcome = "timeout";
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const report = this.buildTurnReport(threadId, turnId, { textLimit: Number(body.textLimit), rawOutputs: body.rawOutputs === true });
    return {
      outcome,
      stopPressed: stopped,
      ownerDecisions: decisions,
      pendingOwnerRequests: [...entry.session.serverRequests.values()]
        .filter((request) => request.status === "pending")
        .map((request) => ({ key: request.key, method: request.method, summary: request.summary, params: clipDeep(request.params, 400) })),
      report,
    };
  }

  turnReport(query = {}) {
    return {
      report: this.buildTurnReport(normalizeString(query.threadId, ""), normalizeString(query.turnId, ""), {
        textLimit: Number(query.textLimit),
        rawOutputs: query.raw === "1",
      }),
    };
  }

  threadReport(query = {}) {
    const store = this.controller().sessionStore;
    const threadId = normalizeString(query.threadId, "");
    const session = store.readSession(threadId);
    if (!session) throw httpError(404, "test_control_thread_not_found", `No thread ${threadId}.`);
    const turnIds = (Array.isArray(session.messages) ? session.messages : [])
      .map((message) => normalizeString(message.id, ""))
      .filter((id) => id && store.readTurn(threadId, id));
    return {
      thread: {
        threadId,
        projectId: normalizeString(session.projectId, ""),
        model: normalizeString(session.model, ""),
        reasoningEffort: normalizeString(session.reasoningEffort, ""),
        accessProfile: normalizeString(session.accessProfile || session.taskAccessProfile, ""),
        workThreadId: normalizeString(session.workThreadId, ""),
      },
      turns: turnIds.map((turnId) => this.buildTurnReport(threadId, turnId, {
        textLimit: query.textLimit !== undefined ? Number(query.textLimit) : 300,
        rawOutputs: query.raw === "1",
      })),
    };
  }

  // A compact, readable account of one turn: each provider request (shape and
  // tokens), each tool call with its arguments and output, the reply, the
  // end state. Text fields are clipped to textLimit (0 = unclipped).
  buildTurnReport(threadId, turnId, options = {}) {
    const store = this.controller().sessionStore;
    const turn = store.readTurn(threadId, turnId);
    if (!turn) throw httpError(404, "test_control_turn_not_found", `No turn ${turnId}.`);
    const textLimit = Number.isFinite(options.textLimit) && options.textLimit >= 0 ? options.textLimit : DEFAULT_TEXT_LIMIT;
    const events = typeof store.readNormalizedEvents === "function" ? store.readNormalizedEvents(threadId, turnId) || [] : [];
    const usage = events.filter((event) => event?.type === "usage_delta").map((event) => event.usage || {});
    const diagnosticsDir = path.join(store.rootDir, "diagnostics", threadId);
    const shapes = [];
    try {
      for (const name of fs.readdirSync(diagnosticsDir)) {
        for (const line of readJsonLines(path.join(diagnosticsDir, name))) {
          const record = line.record || {};
          const at = normalizeString(line.capturedAt || record.capturedAt, "");
          if (!record.request || !at || at < normalizeString(turn.createdAt, "")) continue;
          if (turn.completedAt && at > turn.completedAt && turn.state !== "aborted") continue;
          shapes.push({ at, kind: name.replace(/\.redacted\.jsonl$/, ""), request: record.request });
        }
      }
    } catch {}
    // Requests are sequential within a turn, so the turn's request records
    // and usage records pair up in order; a stopped request leaves a record
    // with no usage after the last pair.
    shapes.sort((a, b) => a.at.localeCompare(b.at));
    const requests = usage.map((entry, index) => {
      const shape = shapes[index]?.request || null;
      return {
        n: index + 1,
        inputTokens: Number(entry.inputTokens || 0),
        cachedInputTokens: Number(entry.cachedInputTokens || 0),
        outputTokens: Number(entry.outputTokens || 0),
        reasoningTokens: Number(entry.reasoningTokens || 0),
        ...(shape ? {
          toolsDeclared: Number(shape.toolCount || 0),
          inputItems: Number(shape.inputMessageCount || 0),
          callOutputs: Number(shape.functionCallOutputCount || 0) + Number(shape.customToolCallOutputCount || 0),
        } : {}),
      };
    });
    const obligations = Array.isArray(turn.unresolvedObligations) ? turn.unresolvedObligations : [];
    const results = new Map((Array.isArray(turn.toolResults) ? turn.toolResults : []).map((result) => [result.obligationId, result]));
    const toolCalls = obligations.map((obligation, index) => {
      const result = results.get(obligation.obligationId) || obligation.result || null;
      return {
        n: index + 1,
        step: Number(obligation.stepOrdinal || 0) || undefined,
        tool: normalizeString(obligation.name, ""),
        args: clip(normalizeString(obligation.argumentsText, ""), textLimit ? Math.min(textLimit, 400) : 0),
        status: normalizeString(obligation.status, ""),
        authority: normalizeString(obligation.authorityState, ""),
        ...(obligation.failureKind ? { failure: obligation.failureKind } : {}),
        output: result
          ? (options.rawOutputs ? clip(normalizeString(result.providerOutputText, ""), textLimit) : summarizeToolOutput(normalizeString(result.providerOutputText, ""), textLimit))
          : "",
      };
    });
    const session = store.readSession(threadId) || {};
    const message = (Array.isArray(session.messages) ? session.messages : []).find((item) => item.id === turnId) || {};
    const items = Array.isArray(message.items) ? message.items : [];
    const assistantText = items.filter((item) => item?.type === "agentMessage").map((item) => normalizeString(item.text, "")).filter(Boolean).join("\n\n");
    const userText = (Array.isArray(turn.input) ? turn.input : []).map((entry) => normalizeString(entry?.text, "")).filter(Boolean).join("\n");
    const totals = usage.reduce((sum, entry) => ({
      inputTokens: sum.inputTokens + Number(entry.inputTokens || 0),
      cachedInputTokens: sum.cachedInputTokens + Number(entry.cachedInputTokens || 0),
      outputTokens: sum.outputTokens + Number(entry.outputTokens || 0),
    }), { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 });
    const started = Date.parse(turn.createdAt || "") || 0;
    const ended = Date.parse(turn.completedAt || turn.failedAt || turn.abortedAt || turn.updatedAt || "") || 0;
    return {
      threadId,
      turnId,
      state: normalizeString(turn.state, ""),
      error: turn.error ? { code: normalizeString(turn.error.code, ""), message: clip(normalizeString(turn.error.message, ""), 400) } : null,
      model: normalizeString(turn.model, ""),
      reasoningEffort: normalizeString(turn.reasoningEffort, ""),
      durationMs: started && ended ? ended - started : null,
      user: clip(userText, textLimit),
      requests,
      totals: { requests: requests.length, toolCalls: toolCalls.length, ...totals },
      toolCalls,
      assistant: clip(assistantText, textLimit ? Math.max(textLimit, 4000) : 0),
    };
  }
}

// The part of a tool's output a tester reads first: a command's exit and
// output, a file's path and text, an error; otherwise the output itself.
function summarizeToolOutput(text = "", limit = DEFAULT_TEXT_LIMIT) {
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return clip(text, limit);
  }
  if (!isPlainObject(parsed)) return clip(text, limit);
  const parts = [];
  if (parsed.kind === "inspect_self_constitution_result" || parsed.snapshot?.schema === "direct_self_constitution_snapshot@1") {
    return `self-constitution snapshot (${text.length} chars, ${normalizeString(parsed.snapshot?.digest, "no digest")})`;
  }
  const status = normalizeString(parsed.status, "");
  if (status) parts.push(status);
  if (parsed.exitCode !== undefined && parsed.exitCode !== null) parts.push(`exit ${parsed.exitCode}`);
  if (parsed.relPath || parsed.path) parts.push(String(parsed.relPath || parsed.path));
  if (parsed.error || parsed.message) parts.push(`error: ${clip(normalizeString(parsed.error?.message || parsed.error || parsed.message, ""), 300)}`);
  const body = [
    parsed.stdoutPreview ? `stdout: ${parsed.stdoutPreview}` : "",
    parsed.stderrPreview ? `stderr: ${parsed.stderrPreview}` : "",
    parsed.text || parsed.content || parsed.textPreview ? String(parsed.text || parsed.content || parsed.textPreview) : "",
  ].filter(Boolean).join("\n");
  if (!parts.length && !body) return clip(text, limit);
  return clip([parts.join(" · "), body].filter(Boolean).join("\n"), limit);
}

function clipDeep(value, limit) {
  if (typeof value === "string") return clip(value, limit);
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => clipDeep(entry, limit));
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "actionTokens").map(([key, entry]) => [key, clipDeep(entry, limit)]));
}

function publicProject(project = {}) {
  const codex = project.surfaceBinding?.codex || {};
  return {
    id: project.id,
    name: project.name,
    state: project.lifecycle?.state || "active",
    workspace: project.workspace,
    runtimeMode: codex.runtimeMode,
    directTier: codex.directTier,
    model: codex.model || "",
    reasoningEffort: codex.reasoningEffort || "",
  };
}

function publicEvent(item = {}) {
  const event = item.event || {};
  if (event.type === "rpc-notification") {
    const params = event.params || {};
    return {
      seq: item.seq,
      at: item.at,
      type: "notification",
      method: event.method,
      ...(params.turnId ? { turnId: params.turnId } : {}),
      ...(params.delta ? { delta: params.delta } : {}),
      ...(params.message ? { message: clip(params.message, 400) } : {}),
      ...(params.item ? { item: { type: params.item.type, id: params.item.id, ...(params.item.text ? { text: clip(params.item.text, 400) } : {}) } } : {}),
      ...(params.turn ? { turn: { status: params.turn.status, ...(params.turn.error ? { error: params.turn.error } : {}) } } : {}),
    };
  }
  if (event.type === "rpc-request" || event.type === "rpc-request-updated") {
    const request = event.request || {};
    return {
      seq: item.seq,
      at: item.at,
      type: event.type,
      key: request.key,
      method: request.method,
      status: request.status,
      summary: request.summary,
      ...(request.errorSummary ? { error: request.errorSummary } : {}),
    };
  }
  return { seq: item.seq, at: item.at, type: event.type, ...(event.status ? { status: event.status } : {}) };
}

module.exports = {
  CONTROL_FILE_NAME,
  CONTROL_SCHEMA,
  DirectTestControlServer,
};
