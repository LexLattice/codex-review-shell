"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DIRECT_WORK_THREAD_REGISTRY_SCHEMA = "direct_work_thread_registry@1";
const DIRECT_WORK_THREAD_SCHEMA = "direct_work_thread@1";
const DIRECT_WORK_THREAD_PROJECTION_SCHEMA = "direct_work_thread_projection@1";
const DIRECT_WORK_TARGET_RESOLUTION_SCHEMA = "direct_work_target_resolution@1";
const DIRECT_WORK_TARGET_RESOLUTION_REPORT_SCHEMA = "direct_work_target_resolution_report@1";
const DIRECT_WORK_THREAD_STORE_STATUS_SCHEMA = "direct_work_thread_store_status@1";

const LIFECYCLE_STATES = new Set(["active", "paused", "completed", "archived", "stale", "unknown"]);
const RESOLUTION_STATES = new Set(["selected", "ambiguous", "unresolved"]);
const ROUTING_GATE_STATES = new Set(["selected_ready", "clarification_required", "stale_blocked", "unresolved_blocked"]);
const RUNTIME_PATHS = new Set(["app-server", "direct-text", "direct-implementation", "unknown"]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function preserveString(value) {
  return typeof value === "string" ? value : "";
}

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isPlainObject(value)) {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (["digest", "projectionDigest", "resolutionDigest", "registryDigest"].includes(key)) continue;
      if (value[key] !== undefined) output[key] = stableValue(value[key]);
    }
    return output;
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function digestValue(prefix, value) {
  return `sha256:${sha256(`${prefix}\0${stableJson(value)}`)}`;
}

function safeSlotPart(value, fallback = "work_thread") {
  const text = normalizeString(value, fallback);
  const safe = text.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
  return safe || fallback;
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function writeJsonAtomic(targetPath, value) {
  ensureDirectory(path.dirname(targetPath));
  const tempPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, targetPath);
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
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

function parseTimeMs(value) {
  const text = normalizeString(value, "");
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function boundedPreview(value, maxChars = 220) {
  const text = preserveString(value).replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function normalizeRef(input = {}, fallbackKind = "unknown") {
  const source = isPlainObject(input) ? input : {};
  const ref = {
    kind: normalizeString(source.kind || source.refKind, fallbackKind),
    id: normalizeString(source.id || source.refId || source.artifactId, ""),
    digest: normalizeString(source.digest || source.artifactDigest || source.sourceDigest, ""),
    label: normalizeString(source.label || source.rendererSafeLabel, source.kind || fallbackKind),
    confidence: normalizeString(source.confidence || source.sourceConfidence, "diagnostic"),
    rawTextIncluded: false,
    rawPathIncluded: false,
  };
  ref.refDigest = digestValue("direct-work-thread-ref@1", ref);
  return ref;
}

function normalizeRefList(values, fallbackKind = "unknown") {
  return (Array.isArray(values) ? values : [])
    .map((value) => normalizeRef(value, fallbackKind))
    .filter((ref) => ref.id || ref.digest);
}

function normalizeIdentity(input = {}, defaults = {}, allowedKeys = []) {
  const source = isPlainObject(input) ? input : {};
  const identity = { ...defaults };
  for (const key of allowedKeys) {
    if (source[key] === undefined) continue;
    const value = boundedPreview(source[key], 240);
    if (value) identity[key] = value;
  }
  return {
    ...identity,
    rawPathIncluded: false,
    rawUrlIncluded: false,
    rawTextIncluded: false,
  };
}

function normalizeObligation(input = {}, index = 0) {
  const source = isPlainObject(input) ? input : {};
  return {
    obligationId: normalizeString(source.obligationId || source.id, `obligation_${index + 1}`),
    kind: normalizeString(source.kind || source.obligationKind, "unknown"),
    status: normalizeString(source.status, "open"),
    summary: boundedPreview(source.summary || source.label || source.description, 240),
    evidenceRefs: normalizeRefList(source.evidenceRefs, "obligation_evidence"),
  };
}

function normalizeLinkedThread(input = {}, index = 0, sourceKind = "codex") {
  const source = isPlainObject(input) ? input : {};
  return {
    threadId: normalizeString(source.threadId || source.id, `${sourceKind}_thread_${index + 1}`),
    source: normalizeString(source.source, sourceKind),
    title: boundedPreview(source.title || source.label, 180),
    status: normalizeString(source.status, "linked"),
    evidenceRefs: normalizeRefList(source.evidenceRefs, `${sourceKind}_thread`),
    rawUrlIncluded: false,
  };
}

function workThreadIdFor(input = {}) {
  const explicit = normalizeString(input.workThreadId || input.id, "");
  if (explicit) return safeSlotPart(explicit, "work_thread");
  const basis = {
    projectId: normalizeString(input.projectId, ""),
    title: normalizeString(input.title, ""),
    objective: normalizeString(input.objective?.summary || input.objective || ""),
    ontologyProfileRef: input.ontologyProfileRef || {},
    workspaceIdentity: input.workspaceIdentity || {},
    branchIdentity: input.branchIdentity || {},
  };
  return `work_thread_${sha256(stableJson(basis)).slice(0, 24)}`;
}

function normalizeLifecycleState(value) {
  const state = normalizeString(value, "active");
  return LIFECYCLE_STATES.has(state) ? state : "unknown";
}

function normalizeRuntimePath(value) {
  const pathValue = normalizeString(value, "unknown");
  return RUNTIME_PATHS.has(pathValue) ? pathValue : "unknown";
}

function buildWorkThread(input = {}, options = {}) {
  const now = normalizeString(input.updatedAt, nowIso(options.nowMs));
  const workThreadId = workThreadIdFor(input);
  const objectiveSummary = boundedPreview(input.objective?.summary || input.objective || input.currentObjective, 500);
  const workThread = {
    schema: DIRECT_WORK_THREAD_SCHEMA,
    workThreadId,
    projectId: normalizeString(input.projectId, ""),
    title: boundedPreview(input.title || objectiveSummary || workThreadId, 180),
    lifecycleState: normalizeLifecycleState(input.lifecycleState),
    ontologyProfileRef: normalizeRef(input.ontologyProfileRef, "ontology_profile"),
    workspaceIdentity: normalizeIdentity(input.workspaceIdentity, {
      workspaceKind: normalizeString(input.workspaceKind, "unknown"),
      workspaceEvidenceKey: normalizeString(input.workspaceEvidenceKey, ""),
    }, ["workspaceKind", "workspaceEvidenceKey", "workspaceLabel", "workspaceDigest", "confidence"]),
    branchIdentity: normalizeIdentity(input.branchIdentity, {
      branchName: normalizeString(input.branchName, ""),
      branchEvidenceKey: normalizeString(input.branchEvidenceKey, ""),
    }, ["branchName", "branchEvidenceKey", "branchDigest", "confidence"]),
    objective: {
      summary: objectiveSummary,
      currentObjective: boundedPreview(input.objective?.currentObjective || input.currentObjective || objectiveSummary, 500),
      priority: normalizeString(input.objective?.priority || input.priority, "normal"),
    },
    currentArc: {
      arcId: normalizeString(input.currentArc?.arcId || input.arcId, ""),
      label: boundedPreview(input.currentArc?.label || input.arcLabel, 160),
      status: normalizeString(input.currentArc?.status || input.arcStatus, "unknown"),
    },
    phaseState: {
      phaseId: normalizeString(input.phaseState?.phaseId || input.phaseId, ""),
      phaseKind: normalizeString(input.phaseState?.phaseKind || input.phaseKind, "unknown"),
      status: normalizeString(input.phaseState?.status || input.phaseStatus, "unknown"),
    },
    authorityBoundary: {
      mutationAllowedBeforeResolution: false,
      allowedActions: Array.isArray(input.authorityBoundary?.allowedActions) ? input.authorityBoundary.allowedActions.map(String) : [],
      forbiddenActions: Array.isArray(input.authorityBoundary?.forbiddenActions) ? input.authorityBoundary.forbiddenActions.map(String) : ["workspace_mutation_before_target_resolution"],
      summary: boundedPreview(input.authorityBoundary?.summary || input.authoritySummary, 320),
    },
    contextPacketRef: normalizeRef(input.contextPacketRef, "context_packet"),
    openObligations: (Array.isArray(input.openObligations) ? input.openObligations : []).map(normalizeObligation),
    activeRuntimePath: normalizeRuntimePath(input.activeRuntimePath),
    linkedCodexThreads: (Array.isArray(input.linkedCodexThreads) ? input.linkedCodexThreads : []).map((thread, index) => normalizeLinkedThread(thread, index, "codex")),
    linkedChatGptThreads: (Array.isArray(input.linkedChatGptThreads) ? input.linkedChatGptThreads : []).map((thread, index) => normalizeLinkedThread(thread, index, "chatgpt")),
    evidenceRefs: normalizeRefList(input.evidenceRefs, "work_thread_evidence"),
    createdAt: normalizeString(input.createdAt, now),
    updatedAt: now,
    rawTextIncluded: false,
    rawPathIncluded: false,
  };
  workThread.digest = digestValue("direct-work-thread@1", workThread);
  return workThread;
}

function workThreadSearchText(workThread = {}) {
  return [
    workThread.workThreadId,
    workThread.projectId,
    workThread.title,
    workThread.objective?.summary,
    workThread.objective?.currentObjective,
    workThread.currentArc?.label,
    workThread.phaseState?.phaseKind,
    workThread.activeRuntimePath,
    ...(workThread.openObligations || []).map((item) => `${item.kind} ${item.summary}`),
    ...(workThread.linkedCodexThreads || []).map((item) => `${item.threadId} ${item.title}`),
    ...(workThread.linkedChatGptThreads || []).map((item) => `${item.threadId} ${item.title}`),
  ].filter(Boolean).join(" ").toLowerCase();
}

function tokenize(text) {
  return preserveString(text)
    .toLowerCase()
    .split(/[^a-z0-9_.:-]+/i)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3);
}

function scoreWorkThreadCandidate(workThread = {}, request = {}) {
  let score = 0;
  const reasons = [];
  const projectId = normalizeString(request.projectId, "");
  if (projectId && workThread.projectId === projectId) {
    score += 40;
    reasons.push("project_match");
  } else if (projectId && workThread.projectId && workThread.projectId !== projectId) {
    score -= 25;
    reasons.push("project_mismatch");
  }
  const branchName = normalizeString(request.branchName, "");
  if (branchName && normalizeString(workThread.branchIdentity?.branchName, "") === branchName) {
    score += 12;
    reasons.push("branch_match");
  }
  const activeRuntimePath = normalizeString(request.activeRuntimePath, "");
  if (activeRuntimePath && workThread.activeRuntimePath === activeRuntimePath) {
    score += 6;
    reasons.push("runtime_path_match");
  }
  const codexThreadId = normalizeString(request.codexThreadId, "");
  if (codexThreadId && (workThread.linkedCodexThreads || []).some((thread) => thread.threadId === codexThreadId)) {
    score += 18;
    reasons.push("codex_thread_match");
  }
  const chatGptThreadId = normalizeString(request.chatGptThreadId, "");
  if (chatGptThreadId && (workThread.linkedChatGptThreads || []).some((thread) => thread.threadId === chatGptThreadId)) {
    score += 18;
    reasons.push("chatgpt_thread_match");
  }
  const queryTokens = tokenize(request.userRequest || request.query || request.requestPreview);
  if (queryTokens.length) {
    const haystack = workThreadSearchText(workThread);
    const matched = queryTokens.filter((token) => haystack.includes(token));
    if (matched.length) {
      const tokenScore = Math.min(32, matched.length * 4);
      score += tokenScore;
      reasons.push(`text_match:${matched.slice(0, 5).join(",")}`);
    }
  }
  if (workThread.lifecycleState === "active") {
    score += 8;
    reasons.push("active_lifecycle");
  }
  if ((workThread.openObligations || []).length) {
    score += 4;
    reasons.push("open_obligations_present");
  }
  return { score, reasons };
}

function buildWorkThreadProjection(workThreads = [], options = {}) {
  const rows = (Array.isArray(workThreads) ? workThreads : [])
    .map((thread) => buildWorkThread(thread, options))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.workThreadId.localeCompare(b.workThreadId))
    .map((thread) => ({
      workThreadId: thread.workThreadId,
      projectId: thread.projectId,
      title: thread.title,
      lifecycleState: thread.lifecycleState,
      objectiveSummary: thread.objective.summary,
      currentArcLabel: thread.currentArc.label,
      phaseKind: thread.phaseState.phaseKind,
      phaseStatus: thread.phaseState.status,
      activeRuntimePath: thread.activeRuntimePath,
      openObligationCount: thread.openObligations.length,
      linkedCodexThreadCount: thread.linkedCodexThreads.length,
      linkedChatGptThreadCount: thread.linkedChatGptThreads.length,
      updatedAt: thread.updatedAt,
      digest: thread.digest,
    }));
  const projection = {
    schema: DIRECT_WORK_THREAD_PROJECTION_SCHEMA,
    projectId: normalizeString(options.projectId, ""),
    generatedAt: normalizeString(options.generatedAt, nowIso(options.nowMs)),
    rowCount: rows.length,
    activeCount: rows.filter((row) => row.lifecycleState === "active").length,
    rows,
    rawTextIncluded: false,
    rawPathIncluded: false,
  };
  projection.projectionDigest = digestValue("direct-work-thread-projection@1", projection);
  return projection;
}

function buildWorkTargetResolution(input = {}, workThreads = [], options = {}) {
  const candidates = (Array.isArray(workThreads) ? workThreads : [])
    .map((thread) => buildWorkThread(thread, options))
    .filter((thread) => !input.projectId || thread.projectId === input.projectId)
    .map((thread) => {
      const scored = scoreWorkThreadCandidate(thread, input);
      return {
        workThreadId: thread.workThreadId,
        title: thread.title,
        projectId: thread.projectId,
        lifecycleState: thread.lifecycleState,
        score: scored.score,
        reasons: scored.reasons,
        evidenceRefs: thread.evidenceRefs,
        digest: thread.digest,
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.workThreadId.localeCompare(b.workThreadId));
  const top = candidates[0] || null;
  const second = candidates[1] || null;
  const ambiguityBlockers = [];
  let resolutionState = "unresolved";
  let selectedWorkThreadId = "";
  if (!top) {
    ambiguityBlockers.push("no_candidate_work_thread");
  } else if (top.score < 50) {
    ambiguityBlockers.push("candidate_confidence_below_threshold");
  } else if (second && top.score - second.score < 12) {
    resolutionState = "ambiguous";
    ambiguityBlockers.push("candidate_margin_too_small");
  } else {
    resolutionState = "selected";
    selectedWorkThreadId = top.workThreadId;
  }
  if (!RESOLUTION_STATES.has(resolutionState)) resolutionState = "unresolved";
  const requestPreview = boundedPreview(input.userRequest || input.query || "", 220);
  const resolution = {
    schema: DIRECT_WORK_TARGET_RESOLUTION_SCHEMA,
    resolutionId: normalizeString(input.resolutionId, `work_target_resolution_${sha256(stableJson({
      projectId: input.projectId,
      requestPreview,
      candidateIds: candidates.map((candidate) => candidate.workThreadId),
    })).slice(0, 24)}`),
    projectId: normalizeString(input.projectId, ""),
    requestDigest: digestValue("direct-work-target-request@1", {
      projectId: input.projectId,
      requestPreview,
      branchName: input.branchName,
      codexThreadId: input.codexThreadId,
      chatGptThreadId: input.chatGptThreadId,
    }),
    requestPreview,
    requestRawTextIncluded: false,
    resolutionState,
    selectedWorkThreadId,
    candidates,
    ambiguityBlockers,
    transitionLaw: {
      mutationAllowed: false,
      providerCallAllowed: false,
      routingEnforced: false,
      reason: "shadow_resolution_only",
    },
    createdAt: normalizeString(input.createdAt, nowIso(options.nowMs)),
  };
  resolution.resolutionDigest = digestValue("direct-work-target-resolution@1", resolution);
  return resolution;
}

function candidateSummaries(candidates = []) {
  return (Array.isArray(candidates) ? candidates : []).slice(0, 8).map((candidate) => ({
    workThreadId: normalizeString(candidate.workThreadId, ""),
    title: boundedPreview(candidate.title, 180),
    projectId: normalizeString(candidate.projectId, ""),
    lifecycleState: normalizeLifecycleState(candidate.lifecycleState),
    score: Number(candidate.score || 0),
    reasons: Array.isArray(candidate.reasons) ? candidate.reasons.map((item) => boundedPreview(item, 80)).filter(Boolean).slice(0, 8) : [],
    digest: normalizeString(candidate.digest, ""),
  }));
}

function buildWorkTargetResolutionReport(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const resolution = isPlainObject(source.resolution) ? source.resolution : buildWorkTargetResolution(source.request || source, source.workThreads || [], options);
  const generatedAt = normalizeString(source.generatedAt, nowIso(options.nowMs));
  const parsedMaxAgeMs = Number(source.maxAgeMs ?? options.maxAgeMs ?? 120000);
  const maxAgeMs = Number.isFinite(parsedMaxAgeMs) ? Math.max(0, parsedMaxAgeMs) : 120000;
  const expectedProjectId = normalizeString(source.expectedProjectId || source.projectId, "");
  const expectedRequestDigest = normalizeString(source.expectedRequestDigest, "");
  const expectedResolutionDigest = normalizeString(source.expectedResolutionDigest, "");
  const staleBlockers = [];
  const createdAtMs = parseTimeMs(resolution.createdAt);
  const generatedAtMs = parseTimeMs(generatedAt);
  if (maxAgeMs && createdAtMs !== null && generatedAtMs !== null && generatedAtMs - createdAtMs > maxAgeMs) staleBlockers.push("resolution_age_exceeded");
  if (expectedProjectId && normalizeString(resolution.projectId, "") !== expectedProjectId) staleBlockers.push("project_mismatch");
  if (expectedRequestDigest && normalizeString(resolution.requestDigest, "") !== expectedRequestDigest) staleBlockers.push("request_digest_mismatch");
  if (expectedResolutionDigest && normalizeString(resolution.resolutionDigest, "") !== expectedResolutionDigest) staleBlockers.push("resolution_digest_mismatch");
  const stale = staleBlockers.length > 0;
  const resolutionState = RESOLUTION_STATES.has(resolution.resolutionState) ? resolution.resolutionState : "unresolved";
  const selected = resolutionState === "selected" && !stale && normalizeString(resolution.selectedWorkThreadId, "");
  let gateState = "unresolved_blocked";
  if (stale) gateState = "stale_blocked";
  else if (resolutionState === "selected") gateState = "selected_ready";
  else if (resolutionState === "ambiguous") gateState = "clarification_required";
  if (!ROUTING_GATE_STATES.has(gateState)) gateState = "unresolved_blocked";
  const blockerCodes = [
    ...((Array.isArray(resolution.ambiguityBlockers) ? resolution.ambiguityBlockers : []).map((item) => normalizeString(item, "")).filter(Boolean)),
    ...staleBlockers,
  ];
  if (resolutionState === "ambiguous" && !blockerCodes.includes("target_resolution_ambiguous")) blockerCodes.push("target_resolution_ambiguous");
  if (resolutionState === "unresolved" && !blockerCodes.includes("target_resolution_unresolved")) blockerCodes.push("target_resolution_unresolved");
  const sourceDigest = digestValue("direct-work-target-resolution-report-source@1", {
    resolutionDigest: resolution.resolutionDigest,
    generatedAt,
    maxAgeMs,
    expectedProjectId,
    expectedRequestDigest,
    expectedResolutionDigest,
    blockerCodes,
  });
  const report = {
    schema: DIRECT_WORK_TARGET_RESOLUTION_REPORT_SCHEMA,
    reportId: normalizeString(source.reportId, `work_target_resolution_report_${sourceDigest.slice(7, 31)}`),
    projectId: normalizeString(source.projectId, resolution.projectId || ""),
    generatedAt,
    uiProjectionGeneration: Number(source.uiProjectionGeneration || 1),
    resolutionId: normalizeString(resolution.resolutionId, ""),
    resolutionDigest: normalizeString(resolution.resolutionDigest, ""),
    requestDigest: normalizeString(resolution.requestDigest, ""),
    requestPreview: boundedPreview(resolution.requestPreview, 220),
    requestRawTextIncluded: false,
    resolutionState,
    routingGateState: gateState,
    selectedWorkThreadId: selected ? resolution.selectedWorkThreadId : "",
    candidateCount: Array.isArray(resolution.candidates) ? resolution.candidates.length : 0,
    candidates: candidateSummaries(resolution.candidates),
    blockerCodes,
    stale,
    staleBlockers,
    maxAgeMs,
    targetResolved: Boolean(selected),
    clarificationRequired: resolutionState === "ambiguous" || resolutionState === "unresolved" || stale,
    nonTargetPreservationRequired: resolutionState !== "selected" || stale,
    mutationBlocked: resolutionState !== "selected" || stale,
    providerCallBlocked: resolutionState !== "selected" || stale,
    mutationAuthorityGranted: false,
    providerCallAuthorityGranted: false,
    routingEnforced: false,
    workspaceMutationAllowed: false,
    providerTransportAllowed: false,
    rendererSafeSummary: stale
      ? "Work-target resolution is stale and cannot route mutation."
      : resolutionState === "selected"
        ? "Work target is selected; this report grants no mutation authority."
        : "Work target is not selected; clarification is required before mutation.",
    sourceDigest,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  report.reportDigest = digestValue("direct-work-target-resolution-report@1", report);
  return report;
}

function assertWorkTargetResolutionReportSafe(report = {}) {
  if (!isPlainObject(report) || report.schema !== DIRECT_WORK_TARGET_RESOLUTION_REPORT_SCHEMA) {
    throw new Error("direct_work_target_resolution_report_schema_mismatch");
  }
  if (report.rawTextIncluded !== false || report.rawPathIncluded !== false || report.rawSecretIncluded !== false) {
    throw new Error("direct_work_target_resolution_report_raw_exposure");
  }
  if (report.mutationAuthorityGranted !== false || report.providerCallAuthorityGranted !== false || report.routingEnforced !== false) {
    throw new Error("direct_work_target_resolution_report_authority_leak");
  }
  if (report.resolutionState !== "selected" && report.selectedWorkThreadId) {
    throw new Error("direct_work_target_resolution_report_selected_when_not_selected");
  }
  if (report.stale === true && report.routingGateState !== "stale_blocked") {
    throw new Error("direct_work_target_resolution_report_stale_not_blocked");
  }
  return true;
}

class DirectWorkThreadRegistryStore {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || path.join(process.cwd(), ".direct-work-threads"));
    this.now = options.now || Date.now;
    if (options.ensureRoot !== false) this.ensureRoot();
  }

  ensureRoot() {
    ensureDirectory(this.workThreadsDir());
    if (!fs.existsSync(this.indexPath())) this.writeIndex([]);
  }

  registryDir() {
    return path.join(this.rootDir, "work-thread-registry");
  }

  workThreadsDir() {
    return path.join(this.registryDir(), "work-threads");
  }

  indexPath() {
    return path.join(this.registryDir(), "index.json");
  }

  workThreadPath(workThreadId) {
    return path.join(this.workThreadsDir(), `${safeSlotPart(workThreadId)}.json`);
  }

  readIndex() {
    return readJsonFile(this.indexPath()) || this.buildIndex([]);
  }

  buildIndex(workThreadRefs = []) {
    const index = {
      schema: DIRECT_WORK_THREAD_REGISTRY_SCHEMA,
      updatedAt: nowIso(this.now()),
      workThreadRefs: Array.isArray(workThreadRefs) ? workThreadRefs : [],
      rawTextIncluded: false,
      rawPathIncluded: false,
    };
    index.registryDigest = digestValue("direct-work-thread-registry@1", index);
    return index;
  }

  writeIndex(workThreadRefs) {
    const index = this.buildIndex(workThreadRefs);
    writeJsonAtomic(this.indexPath(), index);
    return index;
  }

  upsertWorkThread(input = {}) {
    this.ensureRoot();
    const existing = input.workThreadId ? this.readWorkThread(input.workThreadId) : null;
    const workThread = buildWorkThread({
      ...(existing || {}),
      ...input,
      createdAt: input.createdAt || existing?.createdAt,
      updatedAt: input.updatedAt || nowIso(this.now()),
    }, { nowMs: this.now() });
    writeJsonAtomic(this.workThreadPath(workThread.workThreadId), workThread);
    const index = this.readIndex();
    const refs = new Map((index.workThreadRefs || []).map((ref) => [ref.workThreadId, ref]));
    refs.set(workThread.workThreadId, {
      workThreadId: workThread.workThreadId,
      projectId: workThread.projectId,
      title: workThread.title,
      lifecycleState: workThread.lifecycleState,
      updatedAt: workThread.updatedAt,
      digest: workThread.digest,
    });
    this.writeIndex([...refs.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.workThreadId.localeCompare(b.workThreadId)));
    return workThread;
  }

  readWorkThread(workThreadId) {
    const id = normalizeString(workThreadId, "");
    if (!id) return null;
    return readJsonFile(this.workThreadPath(id));
  }

  listWorkThreads(options = {}) {
    this.ensureRoot();
    const refs = this.readIndex().workThreadRefs || [];
    return refs
      .map((ref) => this.readWorkThread(ref.workThreadId))
      .filter(Boolean)
      .filter((thread) => !options.projectId || thread.projectId === options.projectId)
      .filter((thread) => options.includeArchived === true || !["archived"].includes(thread.lifecycleState));
  }

  buildProjection(options = {}) {
    return buildWorkThreadProjection(this.listWorkThreads(options), {
      ...options,
      generatedAt: nowIso(this.now()),
      nowMs: this.now(),
    });
  }

  resolveWorkTarget(input = {}) {
    return buildWorkTargetResolution(input, this.listWorkThreads({ projectId: input.projectId, includeArchived: true }), {
      nowMs: this.now(),
    });
  }

  resolveWorkTargetReport(input = {}) {
    const resolution = this.resolveWorkTarget(input);
    return buildWorkTargetResolutionReport({
      ...input,
      resolution,
      projectId: input.projectId,
    }, {
      nowMs: this.now(),
      maxAgeMs: input.maxAgeMs,
    });
  }

  status(options = {}) {
    const projection = this.buildProjection(options);
    return {
      schema: DIRECT_WORK_THREAD_STORE_STATUS_SCHEMA,
      available: true,
      projectId: normalizeString(options.projectId, ""),
      workThreadCount: projection.rowCount,
      activeCount: projection.activeCount,
      registryPathExposed: false,
      projectionDigest: projection.projectionDigest,
      updatedAt: projection.generatedAt,
    };
  }
}

module.exports = {
  DIRECT_WORK_TARGET_RESOLUTION_REPORT_SCHEMA,
  DIRECT_WORK_TARGET_RESOLUTION_SCHEMA,
  DIRECT_WORK_THREAD_PROJECTION_SCHEMA,
  DIRECT_WORK_THREAD_REGISTRY_SCHEMA,
  DIRECT_WORK_THREAD_SCHEMA,
  DIRECT_WORK_THREAD_STORE_STATUS_SCHEMA,
  DirectWorkThreadRegistryStore,
  assertWorkTargetResolutionReportSafe,
  buildWorkTargetResolutionReport,
  buildWorkTargetResolution,
  buildWorkThread,
  buildWorkThreadProjection,
  scoreWorkThreadCandidate,
};
