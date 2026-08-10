"use strict";

const crypto = require("node:crypto");

const DIRECT_RESIDENT_CONTEXT_CHECKPOINT_REQUEST_SCHEMA = "direct_resident_context_checkpoint_request@1";
const DIRECT_RESIDENT_CONTEXT_CHECKPOINT_PAYLOAD_SCHEMA = "direct_resident_context_checkpoint_payload@1";
const DIRECT_RESIDENT_CONTEXT_CHECKPOINT_SCHEMA = "direct_resident_context_checkpoint@1";
const DIRECT_RESIDENT_CONTEXT_CHECKPOINT_REPORT_SCHEMA = "direct_resident_context_checkpoint_report@1";
const DIRECT_RESIDENT_CONTEXT_CHECKPOINT_PROMPT_VERSION = "direct_resident_context_checkpoint_prompt@1";
const DEFAULT_PRESSURE_THRESHOLD_PERCENT = 80;
const MAX_LIST_ITEMS = 24;
const MAX_TEXT = 1200;
const MAX_PROMPT_CHARS = 24_000;

const CHECKPOINT_TRIGGER_KINDS = new Set([
  "pre_compaction_warning",
  "context_pressure",
  "manual_request",
  "turn_boundary",
]);
const CHECKPOINT_STATES = new Set([
  "request_required",
  "not_required",
  "blocked_missing_context",
  "resident_output_invalid",
  "checkpoint_ready",
  "persisted",
]);

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeString(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  const text = value.trim();
  return text || fallback;
}

function boundedString(value, maxLength = MAX_TEXT) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function nowIso(nowMs) {
  const parsed = nowMs === undefined || nowMs === null ? Date.now() : Number(nowMs);
  return new Date(Number.isFinite(parsed) ? parsed : Date.now()).toISOString();
}

function evidenceRef(kind, id, label, digest = "") {
  return {
    artifactKind: normalizeString(kind, "checkpoint_evidence"),
    artifactId: normalizeString(id, ""),
    rendererSafeLabel: boundedString(label || kind, 180),
    artifactDigest: normalizeString(digest, ""),
    rawTextIncluded: false,
  };
}

function numeric(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pressurePercentFrom(input = {}) {
  const explicit = numeric(input.pressurePercent ?? input.usedPercent, NaN);
  if (Number.isFinite(explicit)) return Math.max(0, Math.min(100, explicit));
  const used = numeric(input.usedTokens ?? input.contextTokensUsed, 0);
  const window = numeric(input.contextWindow ?? input.modelContextWindowEstimate, 0);
  if (!window) return null;
  return Math.max(0, Math.min(100, Math.round((used / window) * 100)));
}

function checkpointTriggerKind(input = {}) {
  const kind = normalizeString(input.triggerKind || input.trigger, "context_pressure");
  return CHECKPOINT_TRIGGER_KINDS.has(kind) ? kind : "context_pressure";
}

function shouldRequestResidentCheckpoint(input = {}) {
  const pressure = isPlainObject(input.pressureEstimate) ? input.pressureEstimate : input;
  const pressurePercent = pressurePercentFrom({
    pressurePercent: input.pressurePercent,
    usedPercent: input.usedPercent,
    usedTokens: input.usedTokens ?? pressure.totalEstimatedTokens,
    contextWindow: input.contextWindow ?? pressure.modelContextWindowEstimate,
  });
  const pressureState = normalizeString(input.pressureState || pressure.pressureState, "unknown");
  const threshold = Math.max(1, Math.min(99, numeric(input.pressureThresholdPercent, DEFAULT_PRESSURE_THRESHOLD_PERCENT)));
  const triggerKind = checkpointTriggerKind(input);
  const serverWarning = input.serverPreCompactionWarning === true || triggerKind === "pre_compaction_warning";
  const overThreshold = pressurePercent !== null && pressurePercent >= threshold;
  const stateRequires = ["approaching_budget", "over_budget", "required_artifact_at_risk"].includes(pressureState);
  const required = serverWarning || overThreshold || stateRequires || input.manualRequest === true;
  const blockerCodes = [];
  if (input.contextUnavailable === true) blockerCodes.push("context_unavailable");
  if (input.activeProviderTurn === true && input.allowDuringActiveTurn !== true) blockerCodes.push("active_turn_checkpoint_deferred");
  return {
    schema: "direct_resident_context_checkpoint_trigger_decision@1",
    triggerKind,
    state: blockerCodes.length ? "blocked_missing_context" : required ? "request_required" : "not_required",
    checkpointRequired: required && blockerCodes.length === 0,
    pressurePercent,
    pressureThresholdPercent: threshold,
    pressureState,
    serverPreCompactionWarning: serverWarning,
    blockerCodes,
    rawTextIncluded: false,
  };
}

function normalizeStringList(values, maxItems = MAX_LIST_ITEMS) {
  const source = Array.isArray(values) ? values : [];
  return source.map((value) => boundedString(typeof value === "string" ? value : value?.summary || value?.text || "", MAX_TEXT))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeRefList(values, maxItems = MAX_LIST_ITEMS) {
  const source = Array.isArray(values) ? values : [];
  return source.map((value, index) => {
    if (!isPlainObject(value)) return null;
    const label = normalizeString(value.rendererSafeLabel || value.label || value.summary || value.path || value.artifactKind, `source ${index + 1}`);
    return {
      artifactKind: normalizeString(value.artifactKind || value.kind, "checkpoint_source"),
      artifactId: normalizeString(value.artifactId || value.id, ""),
      artifactDigest: normalizeString(value.artifactDigest || value.digest, ""),
      rendererSafeLabel: boundedString(label, 220),
      rawTextIncluded: false,
    };
  }).filter(Boolean).slice(0, maxItems);
}

function normalizeObjectList(values, fields, maxItems = MAX_LIST_ITEMS) {
  const source = Array.isArray(values) ? values : [];
  return source.map((value, index) => {
    const item = isPlainObject(value) ? value : { summary: value };
    const output = {};
    for (const [field, fallback] of fields) {
      output[field] = boundedString(item[field], MAX_TEXT) || fallback(index, item);
    }
    output.rawTextIncluded = false;
    return output;
  }).filter((item) => Object.values(item).some((value) => typeof value === "string" && value && value !== "unknown")).slice(0, maxItems);
}

function residentCheckpointJsonSchema() {
  const stringArray = { type: "array", items: { type: "string" } };
  const objectArray = (required, properties) => ({
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      required,
      properties,
    },
  });
  return {
    type: "object",
    additionalProperties: false,
    required: ["schema", "taskState", "openObligations", "evidenceState", "artifactRefs", "decisions", "risks", "nextActions"],
    properties: {
      schema: { const: DIRECT_RESIDENT_CONTEXT_CHECKPOINT_PAYLOAD_SCHEMA },
      taskState: {
        type: "object",
        additionalProperties: false,
        required: ["currentGoal", "phase", "progressSummary"],
        properties: {
          currentGoal: { type: "string" },
          phase: { type: "string" },
          progressSummary: { type: "string" },
        },
      },
      openObligations: objectArray(["summary", "status", "nextStep"], {
        summary: { type: "string" },
        status: { type: "string" },
        nextStep: { type: "string" },
      }),
      evidenceState: {
        type: "object",
        additionalProperties: false,
        required: ["knownFacts", "uncertainties", "sourceRefs"],
        properties: {
          knownFacts: stringArray,
          uncertainties: stringArray,
          sourceRefs: objectArray(["artifactKind", "rendererSafeLabel"], {
            artifactKind: { type: "string" },
            artifactId: { type: "string" },
            artifactDigest: { type: "string" },
            rendererSafeLabel: { type: "string" },
          }),
        },
      },
      artifactRefs: objectArray(["artifactKind", "displayPath", "purpose", "state"], {
        artifactKind: { type: "string" },
        displayPath: { type: "string" },
        purpose: { type: "string" },
        state: { type: "string" },
      }),
      toolState: {
        type: "object",
        additionalProperties: false,
        required: ["pendingToolCalls", "importantToolResults"],
        properties: {
          pendingToolCalls: stringArray,
          importantToolResults: stringArray,
        },
      },
      decisions: objectArray(["summary", "reason", "source"], {
        summary: { type: "string" },
        reason: { type: "string" },
        source: { type: "string" },
      }),
      risks: objectArray(["summary", "severity", "mitigation"], {
        summary: { type: "string" },
        severity: { type: "string" },
        mitigation: { type: "string" },
      }),
      nextActions: stringArray,
      confidence: { type: "string" },
    },
  };
}

function buildResidentCheckpointRequest(input = {}) {
  const decision = isPlainObject(input.triggerDecision) ? input.triggerDecision : shouldRequestResidentCheckpoint(input);
  const sourceRefs = normalizeRefList(input.sourceRefs || input.evidenceRefs);
  const request = {
    schema: DIRECT_RESIDENT_CONTEXT_CHECKPOINT_REQUEST_SCHEMA,
    requestId: normalizeString(input.requestId, `resident_checkpoint_request_${sha256(stableStringify({
      projectId: input.projectId,
      threadId: input.threadId,
      turnId: input.turnId,
      decision,
      sourceRefs,
    })).slice(0, 24)}`),
    projectId: normalizeString(input.projectId, ""),
    threadId: normalizeString(input.threadId, ""),
    turnId: normalizeString(input.turnId, ""),
    workThreadId: normalizeString(input.workThreadId, ""),
    triggerDecision: decision,
    sourceRefs,
    promptVersion: DIRECT_RESIDENT_CONTEXT_CHECKPOINT_PROMPT_VERSION,
    checkpointJsonSchema: residentCheckpointJsonSchema(),
    providerTransportAllowed: decision.checkpointRequired === true && input.providerTransportAllowed === true,
    automaticContextMutationAllowed: false,
    providerCompactionAllowed: false,
    rawPromptIncluded: false,
    rawTranscriptIncluded: false,
    createdAt: normalizeString(input.createdAt, nowIso(input.nowMs)),
  };
  request.requestDigest = sha256(stableStringify(request));
  return request;
}

function buildResidentCheckpointPrompt(input = {}) {
  const request = isPlainObject(input.request) ? input.request : buildResidentCheckpointRequest(input);
  const status = {
    projectId: request.projectId,
    threadId: request.threadId,
    turnId: request.turnId,
    workThreadId: request.workThreadId,
    trigger: request.triggerDecision,
    sourceRefs: request.sourceRefs,
  };
  const contextSummary = boundedString(input.contextSummary || input.rendererSafeContextSummary || "", 6000);
  const obligations = normalizeStringList(input.openObligations || input.obligations, 16);
  const recent = normalizeStringList(input.recentDialogueSummaries || input.recentTurns, 12);
  const text = [
    "You are producing a resident context checkpoint before possible context loss.",
    "Return exactly one valid JSON object. Do not include markdown fences.",
    "Do not request tools. Do not mutate files. Do not claim that compaction has happened.",
    "Summarize your current working state for a future continuation.",
    "",
    "Required JSON schema name:",
    DIRECT_RESIDENT_CONTEXT_CHECKPOINT_PAYLOAD_SCHEMA,
    "",
    "Runtime checkpoint request:",
    JSON.stringify(status, null, 2),
    "",
    "Renderer-safe context summary:",
    contextSummary || "(none supplied)",
    "",
    "Open obligations:",
    obligations.length ? obligations.map((entry) => `- ${entry}`).join("\n") : "(none supplied)",
    "",
    "Recent dialogue summaries:",
    recent.length ? recent.map((entry) => `- ${entry}`).join("\n") : "(none supplied)",
    "",
    "Return fields:",
    "- schema",
    "- taskState: { currentGoal, phase, progressSummary }",
    "- openObligations: array of { summary, status, nextStep }",
    "- evidenceState: { knownFacts, uncertainties, sourceRefs }",
    "- artifactRefs: array of { artifactKind, displayPath, purpose, state }",
    "- toolState: { pendingToolCalls, importantToolResults }",
    "- decisions: array of { summary, reason, source }",
    "- risks: array of { summary, severity, mitigation }",
    "- nextActions: array of strings",
    "- confidence: string",
  ].join("\n");
  return text.length > MAX_PROMPT_CHARS ? `${text.slice(0, MAX_PROMPT_CHARS)}\n\n[checkpoint prompt truncated by harness]` : text;
}

function stripJsonFence(text = "") {
  const source = normalizeString(text, "");
  const fenced = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : source;
}

function extractJsonObjectText(text = "") {
  const source = stripJsonFence(text);
  if (!source) return "";
  if (source.startsWith("{") && source.endsWith("}")) return source;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  return start >= 0 && end > start ? source.slice(start, end + 1) : "";
}

function parseResidentCheckpointPayload(textOrObject) {
  if (isPlainObject(textOrObject)) return { ok: true, payload: textOrObject, errorCode: "" };
  const jsonText = extractJsonObjectText(textOrObject);
  if (!jsonText) return { ok: false, payload: null, errorCode: "checkpoint_json_missing" };
  try {
    const parsed = JSON.parse(jsonText);
    return isPlainObject(parsed)
      ? { ok: true, payload: parsed, errorCode: "" }
      : { ok: false, payload: null, errorCode: "checkpoint_json_not_object" };
  } catch {
    return { ok: false, payload: null, errorCode: "checkpoint_json_invalid" };
  }
}

function normalizeCheckpointPayload(payload = {}) {
  const task = isPlainObject(payload.taskState) ? payload.taskState : {};
  const evidence = isPlainObject(payload.evidenceState) ? payload.evidenceState : {};
  const toolState = isPlainObject(payload.toolState) ? payload.toolState : {};
  return {
    schema: DIRECT_RESIDENT_CONTEXT_CHECKPOINT_PAYLOAD_SCHEMA,
    taskState: {
      currentGoal: boundedString(task.currentGoal, MAX_TEXT),
      phase: boundedString(task.phase, 240) || "unknown",
      progressSummary: boundedString(task.progressSummary, MAX_TEXT),
    },
    openObligations: normalizeObjectList(payload.openObligations, [
      ["summary", (_index, item) => boundedString(item.text || item.description, MAX_TEXT)],
      ["status", () => "unknown"],
      ["nextStep", () => ""],
    ]),
    evidenceState: {
      knownFacts: normalizeStringList(evidence.knownFacts || evidence.facts, 32),
      uncertainties: normalizeStringList(evidence.uncertainties || evidence.unknowns, 32),
      sourceRefs: normalizeRefList(evidence.sourceRefs),
    },
    artifactRefs: normalizeObjectList(payload.artifactRefs, [
      ["artifactKind", () => "artifact"],
      ["displayPath", (_index, item) => boundedString(item.path || item.file || item.name, MAX_TEXT)],
      ["purpose", () => ""],
      ["state", () => "unknown"],
    ]),
    toolState: {
      pendingToolCalls: normalizeStringList(toolState.pendingToolCalls, 24),
      importantToolResults: normalizeStringList(toolState.importantToolResults, 24),
    },
    decisions: normalizeObjectList(payload.decisions, [
      ["summary", (_index, item) => boundedString(item.text || item.description, MAX_TEXT)],
      ["reason", () => ""],
      ["source", () => ""],
    ]),
    risks: normalizeObjectList(payload.risks, [
      ["summary", (_index, item) => boundedString(item.text || item.description, MAX_TEXT)],
      ["severity", () => "unknown"],
      ["mitigation", () => ""],
    ]),
    nextActions: normalizeStringList(payload.nextActions || payload.nextSteps, 32),
    confidence: boundedString(payload.confidence, 120) || "unknown",
  };
}

function validationCode(path, suffix) {
  return `checkpoint_${path.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").toLowerCase()}_${suffix}`;
}

function validateObjectShape(errors, value, path, requiredFields, allowedFields = requiredFields) {
  if (!isPlainObject(value)) {
    errors.push(validationCode(path, "not_object"));
    return false;
  }
  for (const field of requiredFields) {
    if (!Object.hasOwn(value, field)) errors.push(validationCode(`${path}.${field}`, "missing"));
  }
  for (const field of Object.keys(value)) {
    if (!allowedFields.includes(field)) errors.push(validationCode(`${path}.${field}`, "unexpected"));
  }
  return true;
}

function validateStringArray(errors, value, path) {
  if (!Array.isArray(value)) {
    errors.push(validationCode(path, "not_array"));
    return;
  }
  value.forEach((item, index) => {
    if (typeof item !== "string") errors.push(validationCode(`${path}.${index}`, "not_string"));
  });
}

function validateObjectArray(errors, value, path, requiredFields, allowedFields = requiredFields) {
  if (!Array.isArray(value)) {
    errors.push(validationCode(path, "not_array"));
    return;
  }
  value.forEach((item, index) => {
    if (!validateObjectShape(errors, item, `${path}.${index}`, requiredFields, allowedFields)) return;
    for (const field of Object.keys(item)) {
      if (typeof item[field] !== "string") errors.push(validationCode(`${path}.${index}.${field}`, "not_string"));
    }
  });
}

function checkpointValidationErrors(payload = {}) {
  const errors = [];
  if (!isPlainObject(payload)) return ["checkpoint_payload_missing"];
  const rootFields = [
    "schema",
    "taskState",
    "openObligations",
    "evidenceState",
    "artifactRefs",
    "toolState",
    "decisions",
    "risks",
    "nextActions",
    "confidence",
  ];
  const requiredRootFields = rootFields.filter((field) => !["toolState", "confidence"].includes(field));
  validateObjectShape(errors, payload, "payload", requiredRootFields, rootFields);
  if (payload.schema !== DIRECT_RESIDENT_CONTEXT_CHECKPOINT_PAYLOAD_SCHEMA) errors.push("checkpoint_payload_schema_mismatch");
  if (validateObjectShape(errors, payload.taskState, "taskState", ["currentGoal", "phase", "progressSummary"])) {
    for (const field of ["currentGoal", "phase", "progressSummary"]) {
      if (typeof payload.taskState[field] !== "string") errors.push(validationCode(`taskState.${field}`, "not_string"));
    }
    if (!normalizeString(payload.taskState.currentGoal, "")) errors.push("checkpoint_current_goal_missing");
    if (!normalizeString(payload.taskState.progressSummary, "")) errors.push("checkpoint_progress_summary_missing");
  }
  validateObjectArray(errors, payload.openObligations, "openObligations", ["summary", "status", "nextStep"]);
  if (validateObjectShape(errors, payload.evidenceState, "evidenceState", ["knownFacts", "uncertainties", "sourceRefs"])) {
    validateStringArray(errors, payload.evidenceState.knownFacts, "evidenceState.knownFacts");
    validateStringArray(errors, payload.evidenceState.uncertainties, "evidenceState.uncertainties");
    validateObjectArray(
      errors,
      payload.evidenceState.sourceRefs,
      "evidenceState.sourceRefs",
      ["artifactKind", "rendererSafeLabel"],
      ["artifactKind", "artifactId", "artifactDigest", "rendererSafeLabel"],
    );
  }
  validateObjectArray(errors, payload.artifactRefs, "artifactRefs", ["artifactKind", "displayPath", "purpose", "state"]);
  if (payload.toolState !== undefined
    && validateObjectShape(errors, payload.toolState, "toolState", ["pendingToolCalls", "importantToolResults"])) {
    validateStringArray(errors, payload.toolState.pendingToolCalls, "toolState.pendingToolCalls");
    validateStringArray(errors, payload.toolState.importantToolResults, "toolState.importantToolResults");
  }
  validateObjectArray(errors, payload.decisions, "decisions", ["summary", "reason", "source"]);
  validateObjectArray(errors, payload.risks, "risks", ["summary", "severity", "mitigation"]);
  validateStringArray(errors, payload.nextActions, "nextActions");
  if (Array.isArray(payload.nextActions) && payload.nextActions.length === 0) errors.push("checkpoint_next_actions_missing");
  if (payload.confidence !== undefined && typeof payload.confidence !== "string") {
    errors.push("checkpoint_confidence_not_string");
  }
  return [...new Set(errors)];
}

function buildResidentContextCheckpoint(input = {}) {
  const request = isPlainObject(input.request) ? input.request : buildResidentCheckpointRequest(input);
  const parse = parseResidentCheckpointPayload(input.residentOutput || input.payload || input.assistantText || "");
  if (!parse.ok) {
    return {
      schema: DIRECT_RESIDENT_CONTEXT_CHECKPOINT_SCHEMA,
      checkpointId: normalizeString(input.checkpointId, `resident_checkpoint_failed_${sha256(`${request.requestId}:${parse.errorCode}`).slice(0, 24)}`),
      requestId: request.requestId,
      projectId: request.projectId,
      threadId: request.threadId,
      turnId: request.turnId,
      workThreadId: request.workThreadId,
      state: "resident_output_invalid",
      validationErrors: [parse.errorCode],
      payload: null,
      requestDigest: request.requestDigest,
      automaticContextMutationAllowed: false,
      providerCompactionAllowed: false,
      providerTransportUsed: input.providerTransportUsed === true,
      rawResidentOutputIncluded: false,
      rawPromptIncluded: false,
      createdAt: normalizeString(input.createdAt, nowIso(input.nowMs)),
    };
  }
  const validationErrors = checkpointValidationErrors(parse.payload);
  const payload = normalizeCheckpointPayload(parse.payload);
  const sourceDigest = sha256(stableStringify({
    requestDigest: request.requestDigest,
    payload,
    validationErrors,
  }));
  const checkpoint = {
    schema: DIRECT_RESIDENT_CONTEXT_CHECKPOINT_SCHEMA,
    checkpointId: normalizeString(input.checkpointId, `resident_checkpoint_${sourceDigest.slice(0, 24)}`),
    requestId: request.requestId,
    projectId: request.projectId,
    threadId: request.threadId,
    turnId: request.turnId,
    workThreadId: request.workThreadId,
    state: validationErrors.length ? "resident_output_invalid" : "checkpoint_ready",
    validationErrors,
    payload,
    requestDigest: request.requestDigest,
    sourceDigest,
    evidenceRefs: [
      evidenceRef("resident_checkpoint_request", request.requestId, "Resident checkpoint request", request.requestDigest),
      ...request.sourceRefs,
    ],
    automaticContextMutationAllowed: false,
    providerCompactionAllowed: false,
    providerTransportUsed: input.providerTransportUsed === true,
    rawResidentOutputIncluded: false,
    rawPromptIncluded: false,
    createdAt: normalizeString(input.createdAt, nowIso(input.nowMs)),
  };
  checkpoint.checkpointDigest = sha256(stableStringify(checkpoint));
  return checkpoint;
}

function persistResidentContextCheckpoint(input = {}) {
  const threadStore = input.threadStore;
  const request = isPlainObject(input.request) ? input.request : null;
  const checkpoint = isPlainObject(input.checkpoint) ? input.checkpoint : null;
  if (!threadStore || typeof threadStore.writeContextMaintenanceArtifact !== "function") {
    throw new Error("resident_checkpoint_thread_store_missing");
  }
  if (!checkpoint || checkpoint.schema !== DIRECT_RESIDENT_CONTEXT_CHECKPOINT_SCHEMA) {
    throw new Error("resident_checkpoint_schema_mismatch");
  }
  if (checkpoint.state !== "checkpoint_ready") {
    throw new Error("resident_checkpoint_not_ready");
  }
  const projectId = normalizeString(checkpoint.projectId, "");
  const threadId = normalizeString(checkpoint.threadId, "");
  const persisted = {
    ...checkpoint,
    state: "persisted",
    persistedAt: normalizeString(input.persistedAt, nowIso(input.nowMs)),
  };
  persisted.checkpointDigest = sha256(stableStringify({ ...persisted, checkpointDigest: "" }));
  threadStore.writeContextMaintenanceArtifact(projectId, threadId, `${persisted.checkpointId}.json`, persisted);
  threadStore.writeContextMaintenanceArtifact(projectId, threadId, "resident-checkpoint-latest.json", persisted);
  if (request) threadStore.writeContextMaintenanceArtifact(projectId, threadId, `${request.requestId}.json`, request);
  const operationId = normalizeString(input.operationId, `resident_checkpoint_op_${sha256(persisted.checkpointDigest).slice(0, 24)}`);
  let operation = null;
  if (typeof threadStore.commitOperation === "function") {
    operation = threadStore.commitOperation(operationId, {
      projectId,
      operationType: "resident_context_checkpoint",
      clientOperationId: persisted.checkpointId,
      target: {
        targetKind: "thread",
        targetId: threadId,
      },
      result: {
        checkpointId: persisted.checkpointId,
        checkpointDigest: persisted.checkpointDigest,
        effects: [{
          effectKind: "resident_context_checkpoint_persisted",
          targetKind: "context_maintenance_artifact",
          targetId: persisted.checkpointId,
          beforeDigest: "",
          afterDigest: persisted.checkpointDigest,
          rendererSafeSummary: "Resident context checkpoint persisted.",
        }],
      },
    });
  }
  return { checkpoint: persisted, operation };
}

function buildResidentContextCheckpointReport(input = {}) {
  const request = isPlainObject(input.request) ? input.request : null;
  const checkpoint = isPlainObject(input.checkpoint) ? input.checkpoint : null;
  const persisted = isPlainObject(input.persisted) ? input.persisted : null;
  const selectedCheckpoint = persisted || checkpoint;
  const noAuthorityLeak = selectedCheckpoint?.automaticContextMutationAllowed === false
    && selectedCheckpoint?.providerCompactionAllowed === false;
  const rawOutputExcluded = selectedCheckpoint?.rawResidentOutputIncluded === false
    && selectedCheckpoint?.rawPromptIncluded === false;
  const assertions = [
    {
      assertionId: "request_schema",
      passed: request?.schema === DIRECT_RESIDENT_CONTEXT_CHECKPOINT_REQUEST_SCHEMA,
      blockerCode: request?.schema === DIRECT_RESIDENT_CONTEXT_CHECKPOINT_REQUEST_SCHEMA ? "" : "request_schema_mismatch",
    },
    {
      assertionId: "checkpoint_ready_or_persisted",
      passed: ["checkpoint_ready", "persisted"].includes(normalizeString((persisted || checkpoint)?.state, "")),
      blockerCode: ["checkpoint_ready", "persisted"].includes(normalizeString((persisted || checkpoint)?.state, "")) ? "" : "checkpoint_not_ready",
    },
    {
      assertionId: "no_context_mutation_authority",
      passed: noAuthorityLeak,
      blockerCode: noAuthorityLeak ? "" : "checkpoint_authority_leak",
    },
    {
      assertionId: "raw_output_excluded",
      passed: rawOutputExcluded,
      blockerCode: rawOutputExcluded ? "" : "checkpoint_raw_exposure",
    },
  ];
  const report = {
    schema: DIRECT_RESIDENT_CONTEXT_CHECKPOINT_REPORT_SCHEMA,
    reportId: normalizeString(input.reportId, `resident_checkpoint_report_${sha256(stableStringify({ request, checkpoint, persisted })).slice(0, 24)}`),
    projectId: normalizeString(request?.projectId || checkpoint?.projectId || persisted?.projectId, ""),
    threadId: normalizeString(request?.threadId || checkpoint?.threadId || persisted?.threadId, ""),
    requestId: normalizeString(request?.requestId, ""),
    checkpointId: normalizeString((persisted || checkpoint)?.checkpointId, ""),
    status: assertions.every((row) => row.passed) ? "pass" : "fail",
    assertions,
    providerTransportUsed: (persisted || checkpoint)?.providerTransportUsed === true,
    providerCompactionUsed: false,
    automaticContextMutationUsed: false,
    rawPromptIncluded: false,
    rawResidentOutputIncluded: false,
    generatedAt: normalizeString(input.generatedAt, nowIso(input.nowMs)),
  };
  report.reportDigest = sha256(stableStringify(report));
  return report;
}

function validateResidentContextCheckpoint(input = {}) {
  const checkpoint = isPlainObject(input.checkpoint) ? input.checkpoint : input;
  if (checkpoint.schema !== DIRECT_RESIDENT_CONTEXT_CHECKPOINT_SCHEMA) throw new Error("resident_context_checkpoint_schema_mismatch");
  if (!CHECKPOINT_STATES.has(checkpoint.state)) throw new Error("resident_context_checkpoint_state_invalid");
  if (checkpoint.rawResidentOutputIncluded !== false || checkpoint.rawPromptIncluded !== false) {
    throw new Error("resident_context_checkpoint_raw_exposure");
  }
  if (checkpoint.automaticContextMutationAllowed !== false || checkpoint.providerCompactionAllowed !== false) {
    throw new Error("resident_context_checkpoint_authority_leak");
  }
  if (["checkpoint_ready", "persisted"].includes(checkpoint.state) && checkpoint.validationErrors?.length) {
    throw new Error("resident_context_checkpoint_ready_with_validation_errors");
  }
  return true;
}

module.exports = {
  CHECKPOINT_STATES,
  DIRECT_RESIDENT_CONTEXT_CHECKPOINT_PAYLOAD_SCHEMA,
  DIRECT_RESIDENT_CONTEXT_CHECKPOINT_PROMPT_VERSION,
  DIRECT_RESIDENT_CONTEXT_CHECKPOINT_REPORT_SCHEMA,
  DIRECT_RESIDENT_CONTEXT_CHECKPOINT_REQUEST_SCHEMA,
  DIRECT_RESIDENT_CONTEXT_CHECKPOINT_SCHEMA,
  buildResidentCheckpointPrompt,
  buildResidentCheckpointRequest,
  buildResidentContextCheckpoint,
  buildResidentContextCheckpointReport,
  parseResidentCheckpointPayload,
  persistResidentContextCheckpoint,
  residentCheckpointJsonSchema,
  shouldRequestResidentCheckpoint,
  validateResidentContextCheckpoint,
};
