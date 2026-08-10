"use strict";

const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const {
  createDirectProviderBackedSubAgentRoute,
} = require("./provider-backed-route");

const DIRECT_NATIVE_AGENT_POOL_SCHEMA = "direct_native_agent_pool@1";
const DIRECT_NATIVE_AGENT_LAUNCH_SCHEMA = "direct_native_agent_launch@1";
const DIRECT_NATIVE_AGENT_STATUS_SCHEMA = "direct_native_agent_status@1";
const TERMINAL_STATES = new Set(["completed", "failed", "timeout", "cancelled"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

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

function nowIso(now = Date.now) {
  return new Date(now()).toISOString();
}

function normalizeForkTurns(value) {
  const text = normalizeString(value, "all").toLowerCase();
  if (text === "all") return { mode: "full", recentTurnCount: 0, forkTurns: "all" };
  if (text === "none") return { mode: "none", recentTurnCount: 0, forkTurns: "none" };
  const count = Number(text);
  if (!Number.isInteger(count) || count < 1 || count > 200) {
    const error = new Error("fork_turns must be `none`, `all`, or a positive integer string up to 200");
    error.code = "direct_agent_invalid_fork_turns";
    throw error;
  }
  return { mode: "recent", recentTurnCount: count, forkTurns: String(count) };
}

function selectContextMessages(messages = [], handoff = normalizeForkTurns("none")) {
  const normalized = (Array.isArray(messages) ? messages : [])
    .map((message) => ({
      role: normalizeString(message?.role, ""),
      text: normalizeString(message?.text || message?.content, ""),
      turnId: normalizeString(message?.turnId, ""),
    }))
    .filter((message) => ["user", "assistant"].includes(message.role) && message.text);
  if (handoff.mode === "none") return [];
  if (handoff.mode === "full") return normalized;
  const turnIds = [];
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const turnId = normalized[index].turnId || `message_${index}`;
    if (!turnIds.includes(turnId)) turnIds.push(turnId);
    if (turnIds.length >= handoff.recentTurnCount) break;
  }
  const accepted = new Set(turnIds);
  return normalized.filter((message, index) => accepted.has(message.turnId || `message_${index}`));
}

function safeTaskName(value) {
  const normalized = normalizeString(value, "agent")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return normalized || "agent";
}

function scopeKey(projectId, primaryThreadId) {
  return `${normalizeString(projectId, "project_direct")}::${normalizeString(primaryThreadId, "primary_direct")}`;
}

class DirectNativeAgentPool extends EventEmitter {
  constructor(options = {}) {
    super();
    this.maxActiveChildren = boundedInteger(options.maxActiveChildren, 8, 1, 32);
    this.maxQueuedChildren = boundedInteger(options.maxQueuedChildren, 64, 0, 512);
    this.defaultModel = normalizeString(options.defaultModel, "gpt-5.6-sol");
    this.defaultReasoningEffort = normalizeString(options.defaultReasoningEffort, "medium");
    this.providerTurnRunner = typeof options.providerTurnRunner === "function"
      ? options.providerTurnRunner
      : null;
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.routes = new Map();
    this.jobs = new Map();
    this.taskIndex = new Map();
    this.queue = [];
    this.activeCount = 0;
    this.sequence = 0;
  }

  descriptor() {
    const descriptor = {
      schema: DIRECT_NATIVE_AGENT_POOL_SCHEMA,
      maxActiveChildren: this.maxActiveChildren,
      maxQueuedChildren: this.maxQueuedChildren,
      activeChildren: this.activeCount,
      queuedChildren: this.queue.length,
      totalChildren: this.jobs.size,
      providerTransportAvailable: Boolean(this.providerTurnRunner),
      capacityScope: "direct_runtime_process_shared_across_agent_tree",
      capacityIncludesPrimaryAgent: false,
      contextHandoffIndependentOfModel: true,
      contextHandoffIndependentOfReasoningEffort: true,
      supportedForkTurns: ["none", "all", "positive_integer"],
      generatedAt: nowIso(this.now),
    };
    descriptor.poolDigest = digestFor("direct-native-agent-pool@1", descriptor);
    return descriptor;
  }

  routeFor(record) {
    const key = scopeKey(record.projectId, record.primaryThreadId);
    if (!this.routes.has(key)) {
      this.routes.set(key, createDirectProviderBackedSubAgentRoute({
        projectId: record.projectId,
        workThreadId: record.workThreadId,
        primaryThreadId: record.primaryThreadId,
        routeId: `direct_native_agent_pool_${digestFor("direct-native-agent-pool-route@1", key).slice(7, 23)}`,
        defaultModel: this.defaultModel,
        defaultReasoningEffort: this.defaultReasoningEffort,
        providerTurnRunner: this.providerTurnRunner,
      }));
    }
    return this.routes.get(key);
  }

  launch(input = {}) {
    if (!this.providerTurnRunner) {
      return this.launchResult(null, "blocked", "provider_runner_missing");
    }
    const task = normalizeString(input.message || input.prompt || input.task, "");
    if (!task) return this.launchResult(null, "blocked", "missing_spawn_prompt");
    const projectId = normalizeString(input.projectId, "project_direct_agents");
    const primaryThreadId = normalizeString(input.primaryThreadId || input.parentThreadId, "primary_direct_agent");
    const workThreadId = normalizeString(input.workThreadId, "work_thread_direct_agents");
    const parentAgentId = normalizeString(input.parentAgentId, primaryThreadId);
    const taskName = safeTaskName(input.taskName || input.task_name || `agent_${this.sequence + 1}`);
    const taskKey = `${scopeKey(projectId, primaryThreadId)}::${taskName}`;
    const existingId = this.taskIndex.get(taskKey);
    if (existingId && !TERMINAL_STATES.has(this.jobs.get(existingId)?.state)) {
      return this.launchResult(this.jobs.get(existingId), "blocked", "duplicate_live_task_name");
    }
    if (this.queue.length >= this.maxQueuedChildren && this.activeCount >= this.maxActiveChildren) {
      return this.launchResult(null, "blocked", "direct_agent_queue_full");
    }
    const handoff = normalizeForkTurns(input.forkTurns || input.fork_turns);
    const contextMessages = selectContextMessages(input.parentContextMessages, handoff);
    const model = normalizeString(input.model, normalizeString(input.parentModel, this.defaultModel));
    const reasoningEffort = normalizeString(
      input.reasoningEffort || input.reasoning_effort,
      normalizeString(input.parentReasoningEffort, this.defaultReasoningEffort),
    );
    const childAgentId = normalizeString(
      input.childAgentId,
      `direct_child_${++this.sequence}_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`,
    );
    const record = {
      schema: DIRECT_NATIVE_AGENT_STATUS_SCHEMA,
      childAgentId,
      taskName,
      projectId,
      workThreadId,
      primaryThreadId,
      parentAgentId,
      role: normalizeString(input.agentType || input.agent_type || input.role, "sub_agent_worker"),
      displayLabel: normalizeString(input.displayLabel, taskName),
      state: this.activeCount < this.maxActiveChildren ? "accepted" : "queued",
      model,
      reasoningEffort,
      contextHandoff: handoff,
      contextMessageCount: contextMessages.length,
      contextDigest: contextMessages.length
        ? digestFor("direct-native-agent-context@1", contextMessages)
        : "",
      taskDigest: digestFor("direct-native-agent-task@1", task),
      runtimeProfileIndependentOfContext: true,
      createdAt: nowIso(this.now),
      startedAt: "",
      completedAt: "",
      resultSummary: "",
      blockerCode: "",
      resultDigest: "",
      rawTaskPersisted: false,
      rawContextPersisted: false,
      _task: task,
      _contextMessages: contextMessages,
      _waiters: new Set(),
    };
    this.jobs.set(childAgentId, record);
    this.taskIndex.set(taskKey, childAgentId);
    if (record.state === "queued") this.queue.push(childAgentId);
    else this.startRecord(record);
    this.emit("changed", this.publicRecord(record));
    return this.launchResult(record, record.state, "");
  }

  launchResult(record, status, blockerCode) {
    const result = {
      schema: DIRECT_NATIVE_AGENT_LAUNCH_SCHEMA,
      status,
      blockerCode: normalizeString(blockerCode, ""),
      childAgentId: normalizeString(record?.childAgentId, ""),
      taskName: normalizeString(record?.taskName, ""),
      state: normalizeString(record?.state, status),
      model: normalizeString(record?.model, ""),
      reasoningEffort: normalizeString(record?.reasoningEffort, ""),
      contextHandoff: record?.contextHandoff || null,
      contextMessageCount: Number(record?.contextMessageCount || 0),
      runtimeProfileIndependentOfContext: record?.runtimeProfileIndependentOfContext === true,
      pool: this.descriptor(),
      rawTaskIncluded: false,
      rawContextIncluded: false,
    };
    result.resultDigest = digestFor("direct-native-agent-launch@1", result);
    return result;
  }

  startRecord(record) {
    record.state = "running";
    record.startedAt = nowIso(this.now);
    this.activeCount += 1;
    Promise.resolve().then(async () => {
      const route = this.routeFor(record);
      const result = await route.spawnAndRun({
        childAgentId: record.childAgentId,
        displayLabel: record.displayLabel,
        role: record.role,
        prompt: record._task,
        model: record.model,
        reasoningEffort: record.reasoningEffort,
        contextHandoffMode: record.contextHandoff.mode,
        contextMessages: record._contextMessages,
      });
      record.state = TERMINAL_STATES.has(result.status) ? result.status : "failed";
      record.blockerCode = normalizeString(result.blockerCode, "");
      record.resultSummary = normalizeString(
        result.reducedSummary?.summaryText || result.childResultPreview || record.blockerCode,
        record.state === "completed" ? "Child agent completed." : `Child agent ${record.state}.`,
      );
      record.resultDigest = normalizeString(result.resultDigest, "");
      record.completedAt = nowIso(this.now);
    }).catch((error) => {
      record.state = "failed";
      record.blockerCode = normalizeString(error?.code, "direct_agent_runtime_exception");
      record.resultSummary = record.blockerCode;
      record.completedAt = nowIso(this.now);
    }).finally(() => {
      record._task = "";
      record._contextMessages = [];
      this.activeCount = Math.max(0, this.activeCount - 1);
      for (const waiter of record._waiters) waiter(this.publicRecord(record));
      record._waiters.clear();
      this.emit("changed", this.publicRecord(record));
      this.drain();
    });
  }

  drain() {
    while (this.activeCount < this.maxActiveChildren && this.queue.length) {
      const childAgentId = this.queue.shift();
      const record = this.jobs.get(childAgentId);
      if (record?.state === "queued") this.startRecord(record);
    }
  }

  publicRecord(record) {
    if (!record) return null;
    return {
      schema: DIRECT_NATIVE_AGENT_STATUS_SCHEMA,
      childAgentId: record.childAgentId,
      taskName: record.taskName,
      projectId: record.projectId,
      workThreadId: record.workThreadId,
      primaryThreadId: record.primaryThreadId,
      parentAgentId: record.parentAgentId,
      role: record.role,
      displayLabel: record.displayLabel,
      state: record.state,
      model: record.model,
      reasoningEffort: record.reasoningEffort,
      contextHandoff: record.contextHandoff,
      contextMessageCount: record.contextMessageCount,
      contextDigest: record.contextDigest,
      taskDigest: record.taskDigest,
      runtimeProfileIndependentOfContext: true,
      createdAt: record.createdAt,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      resultSummary: record.resultSummary,
      blockerCode: record.blockerCode,
      resultDigest: record.resultDigest,
      rawTaskIncluded: false,
      rawContextIncluded: false,
    };
  }

  records(input = {}) {
    const projectId = normalizeString(input.projectId, "");
    const primaryThreadId = normalizeString(input.primaryThreadId, "");
    return [...this.jobs.values()]
      .filter((record) => (!projectId || record.projectId === projectId) &&
        (!primaryThreadId || record.primaryThreadId === primaryThreadId))
      .map((record) => this.publicRecord(record));
  }

  resolveTarget(target, input = {}) {
    const text = normalizeString(target, "");
    const projectId = normalizeString(input.projectId, "");
    const primaryThreadId = normalizeString(input.primaryThreadId, "");
    if (this.jobs.has(text)) {
      const record = this.jobs.get(text);
      return (
        (!projectId || record.projectId === projectId) &&
        (!primaryThreadId || record.primaryThreadId === primaryThreadId)
      ) ? record : null;
    }
    return [...this.jobs.values()].find((record) =>
      record.taskName === text &&
      (!projectId || record.projectId === projectId) &&
      (!primaryThreadId || record.primaryThreadId === primaryThreadId)) || null;
  }

  inspect(input = {}) {
    const record = this.resolveTarget(
      input.target || input.childAgentId || input.taskName || input.task_name,
      input,
    );
    return record ? this.publicRecord(record) : null;
  }

  async wait(input = {}) {
    const rawTargets = Array.isArray(input.targets)
      ? input.targets
      : [input.target || input.childAgentId || input.taskName || input.task_name].filter(Boolean);
    const records = rawTargets.map((target) => this.resolveTarget(target, input)).filter(Boolean);
    if (!records.length) {
      return { status: "blocked", blockerCode: "target_agent_missing", updates: [], pool: this.descriptor() };
    }
    const terminal = records.filter((record) => TERMINAL_STATES.has(record.state));
    if (terminal.length) {
      return { status: "completed", blockerCode: "", updates: terminal.map((record) => this.publicRecord(record)), pool: this.descriptor() };
    }
    const timeoutMs = boundedInteger(input.timeoutMs ?? input.timeout_ms, 30_000, 0, 300_000);
    if (timeoutMs === 0) {
      return { status: "timeout", blockerCode: "", updates: [], pool: this.descriptor() };
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = (payload) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        for (const record of records) record._waiters.delete(onUpdate);
        resolve(payload);
      };
      const onUpdate = (record) => finish({
        status: "completed",
        blockerCode: "",
        updates: [record],
        pool: this.descriptor(),
      });
      for (const record of records) record._waiters.add(onUpdate);
      const timer = setTimeout(() => finish({
        status: "timeout",
        blockerCode: "",
        updates: [],
        pool: this.descriptor(),
      }), timeoutMs);
    });
  }

  statusSurface(input = {}) {
    const scoped = { projectId: input.projectId, primaryThreadId: input.primaryThreadId };
    const resultBase = (toolName, result, blockerCode = "") => ({
      schema: "direct_live_sub_agent_tool_result@1",
      toolName,
      status: blockerCode ? "blocked" : "completed",
      blockerCode,
      projectId: normalizeString(input.projectId, "project_direct_agents"),
      workThreadId: normalizeString(input.workThreadId, "work_thread_direct_agents"),
      primaryThreadId: normalizeString(input.primaryThreadId, "primary_direct_agent"),
      graphRevision: this.jobs.size,
      providerTransportStarted: false,
      providerDeclarationStarted: false,
      workspaceMutationStarted: false,
      childTranscriptPromotionStarted: false,
      parentSelfBindingRespected: true,
      result,
      rawPromptIncluded: false,
      rawTranscriptIncluded: false,
      rawProviderFrameIncluded: false,
      rawSecretIncluded: false,
      observedAt: nowIso(this.now),
    });
    return {
      listAgents: () => {
        const rows = this.records(scoped);
        return resultBase("list_agents", {
          listProjection: {
            schema: "direct_native_agent_list_projection@1",
            rowCount: rows.length,
            activeCount: rows.filter((row) => ["running", "accepted"].includes(row.state)).length,
            queuedCount: rows.filter((row) => row.state === "queued").length,
            terminalCount: rows.filter((row) => TERMINAL_STATES.has(row.state)).length,
            rows,
          },
          pool: this.descriptor(),
        });
      },
      inspectAgent: (args = {}) => {
        const record = this.inspect({ ...scoped, ...args, target: args.childAgentId || args.taskName });
        return resultBase("inspect_agent", record ? { inspectPacket: record, pool: this.descriptor() } : {}, record ? "" : "target_agent_missing");
      },
    };
  }
}

module.exports = {
  DIRECT_NATIVE_AGENT_LAUNCH_SCHEMA,
  DIRECT_NATIVE_AGENT_POOL_SCHEMA,
  DIRECT_NATIVE_AGENT_STATUS_SCHEMA,
  DirectNativeAgentPool,
  normalizeForkTurns,
  selectContextMessages,
};
