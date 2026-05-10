"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { assertFixtureRedacted, redactFixture } = require("../fixtures/redaction");
const { extractChatgptAccountIdFromJwt } = require("../auth/oauth-shapes");

const DIRECT_LIVE_PROBE_EVIDENCE_SCHEMA = "direct_codex_live_probe_evidence@1";
const DIRECT_LIVE_PROBE_EVIDENCE_INDEX_SCHEMA = "direct_codex_live_probe_evidence_index@1";
const DIRECT_TEXT_REQUEST_SHAPE_SCHEMA = "direct_text_request_shape@1";
const DIRECT_LIVE_PROBE_EVIDENCE_SCHEMA_VERSION = 1;
const DIRECT_LIVE_PROBE_EVIDENCE_ROOT_NAME = "direct-probe-evidence";
const DEFAULT_RUNTIME_PROBED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_NON_RUNNABLE_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_BUILDER_VERSION = "direct-text-request-builder@1";
const TRANSPORT_ADAPTER_VERSION = "codex-responses-transport@1";
const NORMALIZER_VERSION = "codex-event-normalizer@1";
const REDACTION_VERSION = "direct-fixture-redaction@1";
const PROBE_SCRIPT_VERSION = "direct-codex-live-probe@1";
const ENDPOINT_CLASS = "chatgpt-codex-responses";
const FIXED_LIVE_TEXT_PROBE_PROMPT_CLASS = "fixed-live-text-probe";
const FAKE_SMOKE_SOURCE = "fake-smoke";
const MANUAL_LIVE_PROBE_SOURCE = "manual-live-probe";

const STORED_EVIDENCE_STATUSES = new Set(["candidate", "runtime_probed", "unstable", "rejected"]);
const PROMOTING_NORMALIZED_EVENTS = new Set(["session_started", "message_delta", "usage_delta", "response_completed"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
}

function parseTimeMs(value) {
  const parsed = Date.parse(normalizeString(value, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeId(value, fallbackPrefix = "live_probe_evidence") {
  const text = normalizeString(value, "");
  if (/^[A-Za-z0-9][A-Za-z0-9_-]{0,120}$/.test(text)) return text;
  return `${fallbackPrefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(directory, 0o700);
    } catch {}
  }
}

function tempFilePath(targetPath) {
  return path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.${crypto.randomUUID().slice(0, 8)}.tmp`);
}

function writeJsonAtomic(targetPath, value) {
  ensureDirectory(path.dirname(targetPath));
  const tempPath = tempFilePath(targetPath);
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    if (process.platform !== "win32") fs.chmodSync(tempPath, 0o600);
    fs.renameSync(tempPath, targetPath);
    if (process.platform !== "win32") fs.chmodSync(targetPath, 0o600);
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch {}
    throw error;
  }
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (isPlainObject(value)) {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      const entry = value[key];
      if (entry !== undefined) output[key] = canonicalValue(entry);
    }
    return output;
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function hashValue(value) {
  return sha256Hex(canonicalJson(value));
}

function hmacHex(secret, value) {
  return crypto.createHmac("sha256", String(secret || "")).update(canonicalJson(value)).digest("hex");
}

function buildDirectTextRequestShape(options = {}) {
  return {
    schema: DIRECT_TEXT_REQUEST_SHAPE_SCHEMA,
    requestBuilderVersion: normalizeString(options.requestBuilderVersion, REQUEST_BUILDER_VERSION),
    stream: true,
    store: false,
    instructionClass: FIXED_LIVE_TEXT_PROBE_PROMPT_CLASS,
    inputKind: "one_plain_user_text",
    tools: "omitted",
    tool_choice: "omitted",
    parallel_tool_calls: "omitted",
    reasoning: "omitted",
    text_format: "omitted",
    include: "omitted",
    service_tier: "omitted",
    prompt_cache_key: "omitted",
    previous_response_id: "omitted",
  };
}

function directTextRequestShapeHash(options = {}) {
  return hashValue(buildDirectTextRequestShape(options));
}

function profileHash(profileDoc = {}) {
  return hashValue(profileDoc.profile || profileDoc);
}

function endpointClass(endpoint = "") {
  const value = normalizeString(endpoint, "");
  if (!value || value.includes("/backend-api/codex/responses")) return ENDPOINT_CLASS;
  return "custom";
}

function endpointHash(endpoint = "") {
  return sha256Hex(normalizeString(endpoint, "https://chatgpt.com/backend-api/codex/responses"));
}

function accountIdentityFromCredentials(credentials = {}) {
  const direct = normalizeString(credentials.accountId || credentials.chatgptAccountId, "");
  if (direct) return { value: direct, source: "token-claim" };
  const idToken = normalizeString(credentials.idToken || credentials.id_token, "");
  if (idToken) {
    const extracted = extractChatgptAccountIdFromJwt(idToken, { redact: false });
    if (extracted.status === "ok" && extracted.accountId) {
      return { value: extracted.accountId, source: "token-claim" };
    }
  }
  return { value: "", source: "unknown" };
}

function workspaceIdentityFromProject(project = {}) {
  const workspace = isPlainObject(project.workspace) ? project.workspace : {};
  const projectId = normalizeString(project.id, "");
  const workspaceKind = normalizeString(workspace.kind, "");
  const workspacePath = normalizeString(workspace.linuxPath || workspace.localPath || project.repoPath, "");
  if (projectId || workspaceKind || workspacePath) {
    return {
      value: canonicalJson({
        projectId,
        workspaceKind,
        workspacePath,
      }),
      source: "project-binding",
      scoped: true,
    };
  }
  return {
    value: "",
    source: "unknown",
    scoped: false,
  };
}

function observedModelFromEvents(events = []) {
  for (const event of Array.isArray(events) ? events : []) {
    if (event?.type === "session_started" && event.model) return normalizeString(event.model, "");
  }
  return "";
}

function assistantTextFromEvents(events = []) {
  return (Array.isArray(events) ? events : [])
    .filter((event) => event?.type === "message_delta")
    .map((event) => String(event.text || ""))
    .join("");
}

function usageSummaryFromEvents(events = []) {
  for (const event of Array.isArray(events) ? events : []) {
    if (event?.type !== "usage_delta" || !isPlainObject(event.usage)) continue;
    return {
      observed: true,
      inputTokens: Number(event.usage.inputTokens || 0),
      outputTokens: Number(event.usage.outputTokens || 0),
      totalTokens: Number(event.usage.totalTokens || 0),
    };
  }
  return { observed: false };
}

function includesType(types, values) {
  return values.some((value) => types.includes(value));
}

function failureKindForResult(result = {}, facts = {}) {
  const types = facts.normalizedEventTypes || [];
  const errorCode = normalizeString(result.error?.code || result.terminal?.error?.code, "").toLowerCase();
  const errorMessage = normalizeString(result.error?.message || result.terminal?.error?.message, "").toLowerCase();
  const haystack = `${errorCode} ${errorMessage}`;
  if (facts.rawExposureDetected) return "renderer_exposure";
  if (!facts.assistantTextObserved && result.terminal?.state === "completed") return "assistant_text_missing";
  if (types.includes("reasoning_delta")) return "reasoning_event_detected";
  if (facts.unknownRawTypes.length) return "unknown_event";
  if (facts.toolCallDetected) return "tool_call_detected";
  if (types.includes("auth_error")) return "auth";
  if (types.includes("quota_error")) return /rate/.test(haystack) ? "rate_limit" : "quota";
  if (types.includes("transport_error")) return result.lifecycle?.streamStarted ? "transport_after_stream" : "transport_pre_stream";
  if (types.includes("aborted")) return "transport_after_stream";
  if (types.includes("response_failed")) {
    if (/model|not_found|unavailable|unsupported/.test(haystack)) return "model_unavailable";
    if (/malformed|invalid|schema|request/.test(haystack)) return "malformed_request";
    return "other";
  }
  if (types.includes("response_incomplete")) return "transport_after_stream";
  return "other";
}

function statusForFailureKind(kind) {
  if (kind === "model_unavailable" || kind === "malformed_request" || kind === "redaction_failed" || kind === "renderer_exposure") {
    return "rejected";
  }
  if (kind === "unknown_event" || kind === "reasoning_event_detected" || kind === "assistant_text_missing") {
    return "candidate";
  }
  return "unstable";
}

function buildProbeFacts(result = {}) {
  const normalizedEvents = Array.isArray(result.normalizedEvents) ? result.normalizedEvents : [];
  const normalizedEventTypes = normalizedEvents.map((event) => event.type).filter(Boolean);
  const unknownRawTypes = Array.isArray(result.unknownRawTypes) ? result.unknownRawTypes.filter(Boolean) : [];
  const assistantText = assistantTextFromEvents(normalizedEvents);
  const toolCallDetected = Boolean(result.toolDetection?.detected) ||
    includesType(normalizedEventTypes, ["tool_call_started", "tool_call_delta", "tool_call_completed"]);
  const rawExposureDetected = Boolean(
    result.rawAuthHeadersExposed ||
    result.rawBackendRequestsExposed ||
    result.rawBackendFramesExposed ||
    result.diagnostic?.rawAuthHeadersExposed ||
    result.diagnostic?.rawBackendRequestsExposed ||
    result.diagnostic?.rawBackendFramesExposed,
  );
  return {
    normalizedEvents,
    normalizedEventTypes,
    unknownRawTypes,
    assistantTextObserved: assistantText.length > 0,
    assistantTextCharCount: assistantText.length,
    toolCallDetected,
    rawExposureDetected,
    observedModel: observedModelFromEvents(normalizedEvents),
    usageSummary: usageSummaryFromEvents(normalizedEvents),
  };
}

function evaluateProbePromotion(result = {}, context = {}) {
  const facts = buildProbeFacts(result);
  const terminalState = normalizeString(result.terminal?.state || result.turnState, result.ok ? "completed" : "failed");
  const responseStatus = Number(result.response?.status || 0);
  const promptClass = normalizeString(context.promptClass, "");
  const modelRequested = normalizeString(context.model || result.requestShape?.model, "");
  const modelObserved = facts.observedModel;
  const modelMatches = !modelObserved || !modelRequested || modelObserved === modelRequested;
  const allowedEvents = facts.normalizedEventTypes.every((type) => PROMOTING_NORMALIZED_EVENTS.has(type));
  const completedOk = Boolean(result.ok) &&
    responseStatus >= 200 &&
    responseStatus < 300 &&
    terminalState === "completed" &&
    facts.normalizedEventTypes.includes("message_delta") &&
    facts.normalizedEventTypes.includes("response_completed") &&
    facts.assistantTextObserved &&
    allowedEvents &&
    !facts.unknownRawTypes.length &&
    !facts.toolCallDetected &&
    !facts.rawExposureDetected &&
    modelMatches &&
    promptClass === FIXED_LIVE_TEXT_PROBE_PROMPT_CLASS &&
    !includesType(facts.normalizedEventTypes, [
      "auth_error",
      "quota_error",
      "transport_error",
      "response_failed",
      "response_incomplete",
      "aborted",
      "reasoning_delta",
    ]);
  if (completedOk) {
    return {
      status: "runtime_probed",
      failureKind: "",
      facts,
      modelMismatchReason: "",
    };
  }
  const failureKind = !modelMatches ? "model_unavailable" : failureKindForResult(result, facts);
  return {
    status: statusForFailureKind(failureKind),
    failureKind,
    facts,
    modelMismatchReason: modelMatches ? "" : "observed_model_mismatch",
  };
}

function computedEvidenceStatus(evidence = {}, options = {}) {
  const nowMs = Number(options.nowMs ?? Date.now()) || Date.now();
  if (parseTimeMs(evidence.expiresAt) > 0 && parseTimeMs(evidence.expiresAt) <= nowMs) return "expired";
  return STORED_EVIDENCE_STATUSES.has(evidence.status) ? evidence.status : "candidate";
}

function evidenceUsable(evidence = {}, options = {}) {
  return computedEvidenceStatus(evidence, options) === "runtime_probed";
}

function ttlForStatus(status, options = {}) {
  const override = Number(options.ttlMs || 0);
  if (override > 0) return override;
  return status === "runtime_probed" ? DEFAULT_RUNTIME_PROBED_TTL_MS : DEFAULT_NON_RUNNABLE_TTL_MS;
}

function indexEntryFromEvidence(evidence = {}, options = {}) {
  const computedStatus = computedEvidenceStatus(evidence, options);
  return {
    evidenceId: normalizeString(evidence.evidenceId, ""),
    status: normalizeString(evidence.status, "candidate"),
    computedStatus,
    usable: computedStatus === "runtime_probed",
    source: normalizeString(evidence.source, ""),
    createdAt: normalizeString(evidence.createdAt, ""),
    expiresAt: normalizeString(evidence.expiresAt, ""),
    model: normalizeString(evidence.model?.requested, ""),
    endpointHash: normalizeString(evidence.provider?.endpointHash, ""),
    requestShapeHash: normalizeString(evidence.requestShape?.shapeHash, ""),
    profileHash: normalizeString(evidence.profile?.profileHash, ""),
    accountEvidenceKey: normalizeString(evidence.auth?.accountEvidenceKey, ""),
    workspaceScoped: Boolean(evidence.auth?.workspaceScoped),
  };
}

class DirectLiveProbeEvidenceStore {
  constructor(options = {}) {
    const rootDir = normalizeString(options.rootDir, "");
    if (!rootDir) throw new Error("DirectLiveProbeEvidenceStore requires rootDir.");
    this.rootDir = path.resolve(rootDir);
    this.allowFakeEvidence = options.allowFakeEvidence === true;
    this.allowAccountOnlyEvidence = options.allowAccountOnlyEvidence === true;
    this._index = null;
    this._indexMtimeMs = 0;
  }

  indexPath() {
    return path.join(this.rootDir, "index.json");
  }

  evidencePath(evidenceId) {
    return path.join(this.rootDir, "evidence", `${safeId(evidenceId, "evidence")}.json`);
  }

  diagnosticPath(evidenceId) {
    return path.join(this.rootDir, "diagnostics", `${safeId(evidenceId, "evidence")}.redacted.jsonl`);
  }

  secretPath() {
    return path.join(this.rootDir, "secret.json");
  }

  ensure() {
    ensureDirectory(path.join(this.rootDir, "evidence"));
    ensureDirectory(path.join(this.rootDir, "diagnostics"));
    this.ensureSecret();
    if (!fs.existsSync(this.indexPath())) return this.recoverIndex({ write: true });
    return this.readIndex();
  }

  ensureSecret() {
    const existing = readJsonFile(this.secretPath());
    if (existing?.secret && existing?.keyId) return existing;
    const secret = crypto.randomBytes(32).toString("base64url");
    const record = {
      schema: "direct_codex_live_probe_evidence_secret@1",
      keyId: sha256Hex(secret).slice(0, 16),
      secret,
      createdAt: nowIso(),
    };
    writeJsonAtomic(this.secretPath(), record);
    return record;
  }

  secretRecord() {
    return this.ensureSecret();
  }

  emptyIndex() {
    return {
      schema: DIRECT_LIVE_PROBE_EVIDENCE_INDEX_SCHEMA,
      version: 1,
      updatedAt: nowIso(),
      evidence: [],
      recovery: {
        recoveredAt: "",
        recoveredEvidenceCount: 0,
        invalidEvidenceCount: 0,
      },
    };
  }

  readIndex() {
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(this.indexPath()).mtimeMs;
    } catch {}
    if (this._index && mtimeMs > 0 && mtimeMs === this._indexMtimeMs) return this._index;
    const index = readJsonFile(this.indexPath());
    if (!index || index.schema !== DIRECT_LIVE_PROBE_EVIDENCE_INDEX_SCHEMA || !Array.isArray(index.evidence)) {
      return this.recoverIndex({ write: true });
    }
    this._index = index;
    this._indexMtimeMs = mtimeMs;
    return index;
  }

  writeIndex(entries, recovery = {}) {
    const base = this.emptyIndex();
    const index = {
      ...base,
      updatedAt: nowIso(),
      evidence: entries.slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))),
      recovery: {
        ...base.recovery,
        ...recovery,
      },
    };
    writeJsonAtomic(this.indexPath(), index);
    this._index = index;
    try {
      this._indexMtimeMs = fs.statSync(this.indexPath()).mtimeMs;
    } catch {
      this._indexMtimeMs = 0;
    }
    return index;
  }

  evidenceIdsFromDisk() {
    const evidenceDir = path.join(this.rootDir, "evidence");
    try {
      return fs.readdirSync(evidenceDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name.slice(0, -".json".length))
        .filter(Boolean);
    } catch (error) {
      if (error && error.code === "ENOENT") return [];
      throw error;
    }
  }

  readEvidence(evidenceId) {
    const evidence = readJsonFile(this.evidencePath(evidenceId));
    if (!evidence || evidence.schema !== DIRECT_LIVE_PROBE_EVIDENCE_SCHEMA) return null;
    return evidence;
  }

  listEvidence() {
    this.ensure();
    return this.evidenceIdsFromDisk()
      .map((evidenceId) => this.readEvidence(evidenceId))
      .filter(Boolean);
  }

  recoverIndex(options = {}) {
    let invalidEvidenceCount = 0;
    const entries = [];
    for (const evidenceId of this.evidenceIdsFromDisk()) {
      const evidence = this.readEvidence(evidenceId);
      if (!evidence || !this.verifyIntegrity(evidence)) {
        invalidEvidenceCount += 1;
        continue;
      }
      entries.push(indexEntryFromEvidence(evidence));
    }
    const recovery = {
      recoveredAt: nowIso(),
      recoveredEvidenceCount: entries.length,
      invalidEvidenceCount,
    };
    if (options.write) return this.writeIndex(entries, recovery);
    return { ...this.emptyIndex(), evidence: entries, recovery };
  }

  updateIndexForEvidence(evidence) {
    const index = this.readIndex();
    const entry = indexEntryFromEvidence(evidence);
    const entries = index.evidence.filter((existing) => existing.evidenceId !== entry.evidenceId);
    entries.push(entry);
    return this.writeIndex(entries, index.recovery);
  }

  evidenceScope(context = {}) {
    const profileDoc = isPlainObject(context.profileDoc) ? context.profileDoc : {};
    const credentials = isPlainObject(context.credentials) ? context.credentials : {};
    const authStatus = isPlainObject(context.authStatus) ? context.authStatus : {};
    const project = isPlainObject(context.project) ? context.project : {};
    const secret = this.secretRecord().secret;
    const accountIdentity = accountIdentityFromCredentials(credentials);
    const workspaceIdentity = workspaceIdentityFromProject(project);
    const accountKnown = Boolean(accountIdentity.value);
    const workspaceAllowed = workspaceIdentity.scoped || this.allowAccountOnlyEvidence || context.allowAccountOnlyEvidence === true;
    const effectiveAccountScope = {
      authMode: "chatgpt",
      account: accountIdentity.value,
      workspace: workspaceIdentity.value,
      planClass: normalizeString(context.planClass, ""),
    };
    const model = normalizeString(context.model || context.requestedModel, "");
    return {
      profileId: normalizeString(profileDoc.profile?.profileId || profileDoc.summary?.profileId, ""),
      profileVersion: Number(profileDoc.profile?.profileVersion || 0) || 0,
      profileObservedAt: normalizeString(profileDoc.profile?.observedAt || profileDoc.summary?.observedAt, ""),
      profileSource: normalizeString(profileDoc.profile?.source || profileDoc.summary?.source, ""),
      profileHash: profileHash(profileDoc),
      authMode: "chatgpt",
      storageMode: normalizeString(authStatus.storageMode, ""),
      accountIdSource: accountIdentity.source,
      accountEvidenceKey: accountKnown ? hmacHex(secret, effectiveAccountScope) : "",
      accountKnown,
      workspaceEvidenceSource: workspaceIdentity.source,
      workspaceScoped: Boolean(workspaceIdentity.scoped),
      workspaceAllowed,
      endpointClass: endpointClass(context.endpoint),
      endpointHash: endpointHash(context.endpoint),
      transport: "sse",
      model,
      requestShape: buildDirectTextRequestShape(context),
      requestShapeHash: directTextRequestShapeHash(context),
      versions: {
        evidenceSchemaVersion: DIRECT_LIVE_PROBE_EVIDENCE_SCHEMA_VERSION,
        profileId: normalizeString(profileDoc.profile?.profileId || profileDoc.summary?.profileId, ""),
        profileVersion: Number(profileDoc.profile?.profileVersion || 0) || 0,
        profileHash: profileHash(profileDoc),
        requestBuilderVersion: normalizeString(context.requestBuilderVersion, REQUEST_BUILDER_VERSION),
        transportAdapterVersion: normalizeString(context.transportAdapterVersion, TRANSPORT_ADAPTER_VERSION),
        normalizerVersion: normalizeString(context.normalizerVersion, NORMALIZER_VERSION),
        redactionVersion: normalizeString(context.redactionVersion, REDACTION_VERSION),
        probeScriptVersion: normalizeString(context.probeScriptVersion, PROBE_SCRIPT_VERSION),
      },
    };
  }

  signEvidence(unsignedEvidence) {
    const secretRecord = this.secretRecord();
    const unsigned = {
      ...unsignedEvidence,
      integrity: {
        algorithm: "hmac-sha256",
        keyId: secretRecord.keyId,
        digest: "",
      },
    };
    const digest = hmacHex(secretRecord.secret, {
      ...unsigned,
      integrity: {
        ...unsigned.integrity,
        digest: "",
      },
    });
    return {
      ...unsigned,
      integrity: {
        ...unsigned.integrity,
        digest,
      },
    };
  }

  verifyIntegrity(evidence = {}) {
    if (!isPlainObject(evidence.integrity) || evidence.integrity.algorithm !== "hmac-sha256" || !evidence.integrity.digest) {
      return false;
    }
    const secretRecord = this.secretRecord();
    if (evidence.integrity.keyId !== secretRecord.keyId) return false;
    const expected = hmacHex(secretRecord.secret, {
      ...evidence,
      integrity: {
        ...evidence.integrity,
        digest: "",
      },
    });
    const expectedBuffer = Buffer.from(expected, "hex");
    const digestBuffer = Buffer.from(evidence.integrity.digest, "hex");
    if (expectedBuffer.length !== digestBuffer.length) return false;
    try {
      return crypto.timingSafeEqual(expectedBuffer, digestBuffer);
    } catch {
      return false;
    }
  }

  recordProbeResult(result = {}, context = {}) {
    this.ensure();
    const source = normalizeString(context.source, MANUAL_LIVE_PROBE_SOURCE);
    if (source === FAKE_SMOKE_SOURCE && !(this.allowFakeEvidence || context.allowFakeEvidence === true)) {
      throw new Error("Fake live probe evidence requires explicit test mode.");
    }
    const scope = this.evidenceScope({
      ...context,
      model: normalizeString(context.model || result.requestShape?.model, ""),
    });
    const evaluation = evaluateProbePromotion(result, context);
    const createdAtMs = Number(context.nowMs ?? Date.now()) || Date.now();
    const createdAt = nowIso(createdAtMs);
    const expiresAt = nowIso(createdAtMs + ttlForStatus(evaluation.status, context));
    const promptClass = normalizeString(context.promptClass, "");
    const promptHash = promptClass === FIXED_LIVE_TEXT_PROBE_PROMPT_CLASS
      ? sha256Hex(normalizeString(context.prompt, ""))
      : "";
    const evidenceId = safeId(context.evidenceId, "live_probe_evidence");
    const unsignedEvidence = {
      schema: DIRECT_LIVE_PROBE_EVIDENCE_SCHEMA,
      evidenceId,
      status: evaluation.status,
      source,
      createdAt,
      expiresAt,
      versions: scope.versions,
      profile: {
        profileId: scope.profileId,
        profileObservedAt: scope.profileObservedAt,
        profileSource: scope.profileSource,
        profileHash: scope.profileHash,
      },
      auth: {
        authMode: "chatgpt",
        storageMode: scope.storageMode || "unknown",
        accountIdSource: scope.accountIdSource,
        accountEvidenceKey: scope.accountEvidenceKey,
        accountEvidenceKeyDerivation: "local-hmac-sha256",
        workspaceEvidenceSource: scope.workspaceEvidenceSource,
        workspaceScoped: scope.workspaceScoped,
        rawTokensExposed: false,
      },
      provider: {
        endpointClass: scope.endpointClass,
        endpointHash: scope.endpointHash,
        transport: scope.transport,
      },
      model: {
        requested: scope.model,
        observed: evaluation.facts.observedModel || "",
        evidenceState: evaluation.status,
        ...(evaluation.modelMismatchReason ? { mismatchReason: evaluation.modelMismatchReason } : {}),
      },
      requestShape: {
        ...scope.requestShape,
        shapeHash: scope.requestShapeHash,
        toolCount: 0,
        functionCallOutputCount: 0,
        forbiddenFieldsPresent: false,
      },
      probePrompt: {
        promptClass: promptClass || "unknown",
        promptHash,
        privatePromptExposed: false,
      },
      result: {
        ok: Boolean(result.ok),
        terminalState: normalizeString(result.terminal?.state || result.turnState, result.ok ? "completed" : "failed"),
        ...(evaluation.failureKind ? { failureKind: evaluation.failureKind } : {}),
        responseStatus: Number(result.response?.status || 0),
        contentType: normalizeString(result.response?.contentType, ""),
        normalizedEventTypes: evaluation.facts.normalizedEventTypes,
        unknownRawTypes: evaluation.facts.unknownRawTypes,
        toolCallDetected: evaluation.facts.toolCallDetected,
        assistantTextObserved: evaluation.facts.assistantTextObserved,
        assistantTextCharCount: evaluation.facts.assistantTextCharCount,
        usageSummary: evaluation.facts.usageSummary,
      },
      diagnostics: {
        diagnosticId: `${evidenceId}_diagnostic`,
        rawAuthHeadersExposed: false,
        rawBackendRequestsExposed: false,
        rawBackendFramesExposed: false,
        privatePromptExposed: false,
        rawAccountIdExposed: false,
      },
    };
    const evidence = this.signEvidence(unsignedEvidence);
    assertFixtureRedacted(evidence);
    writeJsonAtomic(this.evidencePath(evidence.evidenceId), evidence);
    this.writeDiagnostic(evidence.evidenceId, result.diagnostic || {});
    this.updateIndexForEvidence(evidence);
    return {
      evidence,
      view: this.viewForEvidence(evidence, { scope }),
    };
  }

  writeDiagnostic(evidenceId, diagnostic = {}) {
    const record = {
      schema: "direct_codex_live_probe_evidence_diagnostic@1",
      capturedAt: nowIso(),
      evidenceId: safeId(evidenceId, "evidence"),
      record: redactFixture(diagnostic),
    };
    assertFixtureRedacted(record);
    ensureDirectory(path.dirname(this.diagnosticPath(evidenceId)));
    fs.appendFileSync(this.diagnosticPath(evidenceId), `${JSON.stringify(record)}\n`, "utf8");
    return record;
  }

  scopeMatchesEvidence(evidence = {}, scope = {}, options = {}) {
    const requestedModel = normalizeString(scope.model, "");
    return {
      profileMatches: evidence.profile?.profileHash === scope.profileHash && evidence.profile?.profileId === scope.profileId,
      accountMatches: Boolean(scope.accountEvidenceKey) && evidence.auth?.accountEvidenceKey === scope.accountEvidenceKey,
      endpointMatches: evidence.provider?.endpointHash === scope.endpointHash && evidence.provider?.endpointClass === scope.endpointClass,
      requestShapeMatches: evidence.requestShape?.shapeHash === scope.requestShapeHash,
      modelMatches: !requestedModel || evidence.model?.requested === requestedModel,
      workspaceMatches: scope.workspaceAllowed === true && (evidence.auth?.workspaceScoped === true || this.allowAccountOnlyEvidence || options.allowAccountOnlyEvidence === true),
      versionMatches: evidence.versions?.normalizerVersion === scope.versions?.normalizerVersion &&
        evidence.versions?.requestBuilderVersion === scope.versions?.requestBuilderVersion &&
        evidence.versions?.transportAdapterVersion === scope.versions?.transportAdapterVersion &&
        evidence.versions?.redactionVersion === scope.versions?.redactionVersion,
    };
  }

  viewForEvidence(evidence = {}, options = {}) {
    const scope = isPlainObject(options.scope) ? options.scope : null;
    const computedStatus = computedEvidenceStatus(evidence, options);
    const scopeMatches = scope ? this.scopeMatchesEvidence(evidence, scope, options) : null;
    const allScopeMatches = scopeMatches
      ? Object.values(scopeMatches).every(Boolean)
      : true;
    const fakeAllowed = evidence.source !== FAKE_SMOKE_SOURCE || this.allowFakeEvidence || options.allowFakeEvidence === true;
    const usable = computedStatus === "runtime_probed" && allScopeMatches && fakeAllowed;
    const status = !fakeAllowed ? "missing" : allScopeMatches ? computedStatus : "scope_mismatch";
    return {
      available: true,
      usable,
      status,
      storedStatus: normalizeString(evidence.status, "candidate"),
      model: normalizeString(evidence.model?.requested, ""),
      modelSource: "live-probe",
      modelEvidenceState: usable ? "runtime_probed" : normalizeString(evidence.model?.evidenceState, "candidate"),
      evidenceId: normalizeString(evidence.evidenceId, ""),
      observedAt: normalizeString(evidence.createdAt, ""),
      expiresAt: normalizeString(evidence.expiresAt, ""),
      source: normalizeString(evidence.source, ""),
      failureKind: normalizeString(evidence.result?.failureKind, ""),
      reason: usable ? "" : status,
      scope: scopeMatches || {
        profileMatches: false,
        accountMatches: false,
        endpointMatches: false,
        requestShapeMatches: false,
        modelMatches: false,
        workspaceMatches: false,
        versionMatches: false,
      },
      rawTokensExposed: false,
      rawBackendFramesExposed: false,
    };
  }

  findEvidenceForScope(scope = {}, options = {}) {
    const index = this.ensure();
    let latestRelated = null;
    for (const entry of index.evidence || []) {
      if (entry.source === FAKE_SMOKE_SOURCE && !(this.allowFakeEvidence || options.allowFakeEvidence === true)) continue;
      if (entry.endpointHash !== scope.endpointHash || entry.requestShapeHash !== scope.requestShapeHash) continue;
      const evidence = this.readEvidence(entry.evidenceId);
      if (!evidence || !this.verifyIntegrity(evidence)) continue;
      const view = this.viewForEvidence(evidence, { ...options, scope });
      if (!latestRelated) latestRelated = view;
      if (view.usable) return view;
    }
    return latestRelated || {
      available: false,
      usable: false,
      status: "missing",
      model: normalizeString(scope.model, ""),
      modelSource: "live-probe",
      modelEvidenceState: "unknown",
      evidenceId: "",
      observedAt: "",
      expiresAt: "",
      source: "",
      failureKind: "",
      scope: {
        profileMatches: false,
        accountMatches: false,
        endpointMatches: false,
        requestShapeMatches: false,
        modelMatches: false,
        workspaceMatches: false,
        versionMatches: false,
      },
      rawTokensExposed: false,
      rawBackendFramesExposed: false,
    };
  }

  resolveModelEvidence(context = {}) {
    const requestedModel = normalizeString(context.model || context.requestedModel, "");
    const scope = this.evidenceScope({
      ...context,
      model: requestedModel,
    });
    const view = this.findEvidenceForScope(scope, context);
    return {
      model: view.usable ? view.model : requestedModel,
      modelSource: "live-probe",
      modelEvidenceState: view.usable ? "runtime_probed" : view.modelEvidenceState || "unknown",
      accepted: view.usable,
      evidenceId: view.evidenceId || "",
      reason: view.usable ? "" : view.status || "live_probe_evidence_missing",
      liveProbeEvidence: view,
    };
  }

  status(options = {}) {
    const index = this.ensure();
    const evidence = (index.evidence || []).map((entry) => {
      const computedStatus = computedEvidenceStatus(entry, options);
      return {
        ...entry,
        computedStatus,
        usable: computedStatus === "runtime_probed",
      };
    });
    return {
      schema: "direct_codex_live_probe_evidence_store_status@1",
      available: true,
      rootExposed: false,
      evidenceCount: evidence.length,
      usableEvidenceCount: evidence.filter((entry) => entry.usable).length,
      latestStatus: evidence[0]?.computedStatus || "",
      latestEvidenceId: evidence[0]?.evidenceId || "",
      latestObservedAt: evidence[0]?.createdAt || "",
      recovery: index.recovery || {},
      rawTokensExposed: false,
      rawBackendFramesExposed: false,
    };
  }
}

module.exports = {
  DIRECT_LIVE_PROBE_EVIDENCE_INDEX_SCHEMA,
  DIRECT_LIVE_PROBE_EVIDENCE_ROOT_NAME,
  DIRECT_LIVE_PROBE_EVIDENCE_SCHEMA,
  DIRECT_TEXT_REQUEST_SHAPE_SCHEMA,
  ENDPOINT_CLASS,
  FAKE_SMOKE_SOURCE,
  FIXED_LIVE_TEXT_PROBE_PROMPT_CLASS,
  MANUAL_LIVE_PROBE_SOURCE,
  NORMALIZER_VERSION,
  PROBE_SCRIPT_VERSION,
  REDACTION_VERSION,
  REQUEST_BUILDER_VERSION,
  TRANSPORT_ADAPTER_VERSION,
  DirectLiveProbeEvidenceStore,
  buildDirectTextRequestShape,
  canonicalJson,
  computedEvidenceStatus,
  directTextRequestShapeHash,
  endpointClass,
  endpointHash,
  evaluateProbePromotion,
  evidenceUsable,
  profileHash,
};
