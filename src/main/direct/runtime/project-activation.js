"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeCodexBinding } = require("./runtime-status");

const DIRECT_EXPERIMENTAL_ACTIVATION_SCHEMA = "direct_experimental_activation_record@1";
const DIRECT_EXPERIMENTAL_ROLLBACK_SCHEMA = "direct_experimental_rollback_record@1";
const DIRECT_EXPERIMENTAL_GATE_SCHEMA = "direct_experimental_project_gate@1";
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,120}$/;
const DEFAULT_GATE_MAX_AGE_MS = 5 * 60 * 1000;

const DIRECT_EXPERIMENTAL_BLOCKER_CODES = Object.freeze({
  PROJECT_MISSING: "project_missing",
  PROJECT_GENERATION_STALE: "project_generation_stale",
  BINDING_UNSUPPORTED: "binding_unsupported",
  WORKSPACE_INVALID: "workspace_invalid",
  WORKSPACE_BACKEND_UNATTACHED: "workspace_backend_unattached",
  AUTH_MISSING: "auth_missing",
  AUTH_REFRESH_FAILED: "auth_refresh_failed",
  ACCOUNT_SCOPE_MISMATCH: "account_scope_mismatch",
  LIVE_TEXT_EVIDENCE_MISSING: "live_text_evidence_missing",
  LIVE_TEXT_EVIDENCE_EXPIRED: "live_text_evidence_expired",
  LIVE_TEXT_SCOPE_MISMATCH: "live_text_scope_mismatch",
  TOOL_EVIDENCE_MISSING: "tool_evidence_missing",
  TOOL_EVIDENCE_EXPIRED: "tool_evidence_expired",
  IMPORT_CHECKPOINT_EVIDENCE_MISSING: "import_checkpoint_evidence_missing",
  SESSION_STORE_CORRUPT: "session_store_corrupt",
  EVIDENCE_INDEX_CORRUPT: "evidence_index_corrupt",
  ACTIVATION_RECORD_CORRUPT: "activation_record_corrupt",
  REDACTION_FAILED: "redaction_failed",
  FAKE_EVIDENCE_NOT_ALLOWED: "fake_evidence_not_allowed",
  ACTIVE_DIRECT_TURN_EXISTS: "active_direct_turn_exists",
  PRODUCTION_DIRECT_UNAVAILABLE: "production_direct_unavailable",
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
}

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function isSafeId(value) {
  return SAFE_ID_PATTERN.test(normalizeString(value, ""));
}

function requireSafeId(value, label) {
  const text = normalizeString(value, "");
  if (isSafeId(text)) return text;
  throw new Error(`Invalid ${label} id.`);
}

function safeProjectDirectoryName(projectId) {
  const text = normalizeString(projectId, "project");
  if (isSafeId(text)) return text;
  return `project_${digest(text).slice(0, 32)}`;
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function tempFilePath(targetPath) {
  return path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.${crypto.randomUUID().slice(0, 8)}.tmp`);
}

function writeJsonAtomic(targetPath, value) {
  ensureDirectory(path.dirname(targetPath));
  const tempPath = tempFilePath(targetPath);
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
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isPlainObject(value)) {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      const next = value[key];
      if (next === undefined) continue;
      result[key] = canonicalize(next);
    }
    return result;
  }
  return value;
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function hmacEvidenceKey(secret, value) {
  return crypto.createHmac("sha256", normalizeString(secret, "direct-experimental-activation")).update(String(value || "")).digest("hex").slice(0, 32);
}

function rendererBindingSummary(binding = {}) {
  const normalized = normalizeCodexBinding(binding);
  return {
    mode: normalizeString(binding.mode, ""),
    runtimeMode: normalized.runtimeMode,
    directTransport: normalized.directTransport,
    bindingProvider: normalized.provider,
    model: normalizeString(binding.model, ""),
    profileId: normalizeString(binding.profileId, ""),
    label: normalizeString(binding.label, ""),
  };
}

function privateBindingSnapshot(binding = {}) {
  return JSON.parse(JSON.stringify(isPlainObject(binding) ? binding : {}));
}

function activationTargetBinding(previousBinding = {}, gate = {}) {
  return {
    ...privateBindingSnapshot(previousBinding),
    mode: normalizeString(previousBinding.mode, "managed"),
    bindingProvider: "direct-chatgpt-codex",
    runtimeMode: "direct-experimental",
    directTransport: "live-text",
    model: normalizeString(gate?.scope?.model || previousBinding.model, previousBinding.model || ""),
  };
}

function activationProjectBindingDigest(binding = {}) {
  const snapshot = privateBindingSnapshot(binding);
  return digest({
    mode: snapshot.mode,
    bindingProvider: snapshot.bindingProvider,
    runtimeMode: snapshot.runtimeMode,
    directTransport: snapshot.directTransport,
    model: snapshot.model,
    profileId: snapshot.profileId,
    provider: snapshot.provider,
    target: snapshot.target,
    runtime: snapshot.runtime,
  });
}

function safeProjectId(project = {}) {
  return normalizeString(project.id, "project");
}

function workspaceKind(project = {}) {
  const kind = normalizeString(project.workspace?.kind, "local");
  return kind === "wsl" ? "wsl" : "local";
}

function workspaceGateFor(project = {}, workspaceStatus = {}, options = {}) {
  const kind = workspaceKind(project);
  const status = normalizeString(workspaceStatus.status, "idle");
  const backendAttached = status === "attached";
  const attachAccepted = options.attachOnFirstTurnAccepted === true;
  const rawKeyInput = [
    kind,
    normalizeString(project.workspace?.distro, ""),
    normalizeString(project.workspace?.linuxPath, ""),
    normalizeString(project.workspace?.localPath, ""),
    normalizeString(workspaceStatus.key, ""),
  ].join("|");
  return {
    kind,
    backendAttached,
    attachPolicy: backendAttached ? "attached_now" : (attachAccepted ? "attach_on_first_turn_accepted" : "unattached"),
    canonicalPathEvidenceKey: hmacEvidenceKey(options.localEvidenceSecret, rawKeyInput),
    rawPathExposed: false,
  };
}

function liveProbeUsable(liveTextStatus = {}) {
  const evidence = liveTextStatus.liveProbeEvidence;
  if (!isPlainObject(evidence)) return false;
  if (evidence.source === "fake-smoke" && process.env.CODEX_DIRECT_ALLOW_FAKE_EVIDENCE !== "1") return false;
  return evidence.usable === true || evidence.status === "runtime_probed";
}

function liveTextReady(liveTextStatus = {}) {
  const state = normalizeString(liveTextStatus.status, "");
  const modelEvidence = normalizeString(liveTextStatus.modelEvidenceState, "");
  return state === "ready" &&
    liveTextStatus.turnRunnable === true &&
    (modelEvidence === "accepted" || modelEvidence === "runtime_probed" || liveProbeUsable(liveTextStatus));
}

function readOnlyToolReady(liveTextStatus = {}) {
  const continuation = isPlainObject(liveTextStatus.readOnlyToolContinuation)
    ? liveTextStatus.readOnlyToolContinuation
    : {};
  const state = normalizeString(continuation.status, "");
  const evidence = normalizeString(continuation.evidenceState, "");
  return liveTextStatus.toolsEnabled === true &&
    state === "ready" &&
    (!evidence || evidence === "accepted" || evidence === "runtime_probed");
}

function sessionStoreHealthy(sessionStore = {}) {
  const recovery = isPlainObject(sessionStore.recovery) ? sessionStore.recovery : {};
  return Number(recovery.missingSessionFileCount || 0) === 0;
}

function activationCorrupt(storeStatus = {}) {
  return Number(storeStatus.corruptedCount || 0) > 0;
}

function importContinuationRequired(imports = {}) {
  return Number(imports.checkpointValidatedCount || 0) > 0 &&
    Number(imports.checkpointContinuationActionAvailableCount || 0) > 0;
}

function importContinuationReady(imports = {}) {
  if (!importContinuationRequired(imports)) return true;
  return Number(imports.checkpointContinuationActionRunnableNowCount || 0) > 0;
}

function requirement(id, label, requirementClass, affects, passed, blockerCode, reason = "") {
  return {
    id,
    label,
    requirementClass,
    status: passed ? "passed" : "blocked",
    affects,
    blockerCode: passed ? "" : blockerCode,
    reason: passed ? "" : reason || blockerCode,
  };
}

function activeDirectTurnCountForProject(sessionStore, projectId) {
  if (!sessionStore || typeof sessionStore.readIndex !== "function") return 0;
  const safeProject = normalizeString(projectId, "");
  try {
    const index = sessionStore.readIndex();
    return (Array.isArray(index.sessions) ? index.sessions : [])
      .filter((session) => session.projectId === safeProject && session.runtimeMode === "direct-experimental")
      .reduce((count, session) => count + Number(session.activeTurnCount || 0), 0);
  } catch {
    return 0;
  }
}

function buildDegradedCapabilities(blockers = []) {
  const codes = new Set(blockers.map((item) => item.blockerCode).filter(Boolean));
  const authBlocked = codes.has(DIRECT_EXPERIMENTAL_BLOCKER_CODES.AUTH_MISSING) ||
    codes.has(DIRECT_EXPERIMENTAL_BLOCKER_CODES.AUTH_REFRESH_FAILED);
  const liveBlocked = authBlocked ||
    codes.has(DIRECT_EXPERIMENTAL_BLOCKER_CODES.LIVE_TEXT_EVIDENCE_MISSING) ||
    codes.has(DIRECT_EXPERIMENTAL_BLOCKER_CODES.LIVE_TEXT_EVIDENCE_EXPIRED) ||
    codes.has(DIRECT_EXPERIMENTAL_BLOCKER_CODES.LIVE_TEXT_SCOPE_MISMATCH) ||
    codes.has(DIRECT_EXPERIMENTAL_BLOCKER_CODES.SESSION_STORE_CORRUPT);
  const toolBlocked = liveBlocked ||
    codes.has(DIRECT_EXPERIMENTAL_BLOCKER_CODES.TOOL_EVIDENCE_MISSING) ||
    codes.has(DIRECT_EXPERIMENTAL_BLOCKER_CODES.TOOL_EVIDENCE_EXPIRED);
  const importBlocked = liveBlocked || codes.has(DIRECT_EXPERIMENTAL_BLOCKER_CODES.IMPORT_CHECKPOINT_EVIDENCE_MISSING);
  const reasons = {};
  for (const blocker of blockers) {
    if (blocker.blockerCode) reasons[blocker.blockerCode] = blocker.reason || blocker.blockerCode;
  }
  return {
    canReadCompletedDirectSessions: true,
    canStartNewTextTurn: !liveBlocked,
    canApproveReadOnlyTool: !toolBlocked,
    canStartImportCheckpointContinuation: !importBlocked,
    canRunManualProbe: true,
    canRollback: true,
    reasons,
  };
}

function countBlockers(requirements = []) {
  const result = {};
  for (const gate of requirements) {
    if (gate.status === "passed" || !gate.blockerCode) continue;
    result[gate.blockerCode] = Number(result[gate.blockerCode] || 0) + 1;
  }
  return result;
}

function rendererSafeBlockers(requirements = []) {
  return requirements
    .filter((item) => item.status !== "passed" && item.requirementClass !== "warning_only")
    .map((item) => ({
      id: normalizeString(item.id, ""),
      label: normalizeString(item.label, ""),
      requirementClass: normalizeString(item.requirementClass, ""),
      affects: normalizeString(item.affects, ""),
      blockerCode: normalizeString(item.blockerCode, ""),
      reason: normalizeString(item.reason, item.blockerCode || ""),
    }));
}

function activationLabels(state, target = {}) {
  if (state === "eligible") {
    return {
      headline: "Direct experimental eligible",
      detail: "Implementation-lane gates pass for this project.",
    };
  }
  if (state === "text_only_eligible") {
    return {
      headline: "Direct experimental text-only preview",
      detail: "Text turns can run, but implementation-lane tool gates are incomplete.",
    };
  }
  if (state === "enabled") {
    return {
      headline: "Direct experimental enabled",
      detail: `Project Codex lane is ${target.runtimeMode || "direct-experimental"}/${target.directTransport || "live-text"}.`,
    };
  }
  if (state === "degraded") {
    return {
      headline: "Direct experimental degraded",
      detail: "Some required gates no longer pass. Rollback remains available.",
    };
  }
  if (state === "rollback_required") {
    return {
      headline: "Rollback required",
      detail: "Direct experimental binding is unsafe until rollback or repair.",
    };
  }
  return {
    headline: "Direct experimental blocked",
    detail: "Required activation gates are missing.",
  };
}

function rendererSafeActivationStatusFromGate(gate = {}, activationState = {}) {
  const requirements = Array.isArray(gate.requirements) ? gate.requirements : [];
  const blockers = requirements.filter((item) => item.status !== "passed" && item.requirementClass !== "warning_only");
  const safeBlockers = rendererSafeBlockers(requirements);
  const warningCount = Array.isArray(gate.optionalWarnings) ? gate.optionalWarnings.length : 0;
  const state = normalizeString(gate.state, "blocked");
  const enabled = state === "enabled" || state === "degraded" || state === "rollback_required";
  return {
    state,
    eligible: state === "eligible",
    enabled,
    degraded: state === "degraded" || state === "rollback_required",
    activationTier: gate.target?.activationTier || "implementation-lane",
    rollbackAvailable: enabled,
    activationId: normalizeString(activationState.activationId, ""),
    gateId: normalizeString(gate.gateId, ""),
    gateDigest: normalizeString(gate.gateDigest, ""),
    target: {
      runtimeMode: "direct-experimental",
      directTransport: "live-text",
    },
    gateSummary: {
      requiredCount: requirements.filter((item) => item.requirementClass !== "warning_only").length,
      passedRequiredCount: requirements.filter((item) => item.requirementClass !== "warning_only" && item.status === "passed").length,
      blockedReasons: countBlockers(requirements),
      blockers: safeBlockers,
      warningsCount: warningCount,
    },
    currentBinding: gate.currentBinding || {},
    labels: activationLabels(state, gate.target),
    degradedCapabilities: enabled ? buildDegradedCapabilities(blockers) : null,
    rawAuthExposed: false,
    rawRequestExposed: false,
    rawStreamExposed: false,
    rawImportPathExposed: false,
    rawWorkspacePathExposed: false,
  };
}

function evaluateDirectExperimentalProjectActivation(options = {}) {
  const nowMs = Number(options.nowMs || Date.now());
  const evaluatedAt = nowIso(nowMs);
  const expiresAt = nowIso(nowMs + Number(options.maxAgeMs || DEFAULT_GATE_MAX_AGE_MS));
  const project = isPlainObject(options.project) ? options.project : {};
  const projectId = normalizeString(project.id, "");
  const binding = normalizeCodexBinding(project.surfaceBinding?.codex || {});
  const authStatus = isPlainObject(options.authStatus) ? options.authStatus : {};
  const liveTextStatus = isPlainObject(options.liveTextStatus) ? options.liveTextStatus : {};
  const sessionStore = isPlainObject(options.sessionStore) ? options.sessionStore : {};
  const imports = isPlainObject(options.imports) ? options.imports : {};
  const workspace = workspaceGateFor(project, options.workspaceStatus || {}, options);
  const storeStatus = isPlainObject(options.activationStoreStatus) ? options.activationStoreStatus : {};
  const latestActivation = isPlainObject(options.latestActivation) ? options.latestActivation : null;
  const target = {
    runtimeMode: "direct-experimental",
    directTransport: "live-text",
    bindingProvider: "direct-chatgpt-codex",
    activationTier: "implementation-lane",
  };
  const authOk = authStatus.status === "authenticated";
  const liveOk = liveTextReady(liveTextStatus);
  const toolOk = readOnlyToolReady(liveTextStatus);
  const workspaceOk = workspace.backendAttached || workspace.attachPolicy === "attach_on_first_turn_accepted";
  const storeOk = sessionStoreHealthy(sessionStore);
  const activationOk = !activationCorrupt(storeStatus);
  const importOk = importContinuationReady(imports);
  const productionDirectSelected = binding.runtimeMode === "direct";
  const bindingSupported = Boolean(projectId) && !productionDirectSelected;
  const requirements = [
    requirement("project", "Project is selected", "hard", "activation", Boolean(projectId), DIRECT_EXPERIMENTAL_BLOCKER_CODES.PROJECT_MISSING),
    requirement("binding", "Binding can target direct experimental", "hard", "activation", bindingSupported, productionDirectSelected ? DIRECT_EXPERIMENTAL_BLOCKER_CODES.PRODUCTION_DIRECT_UNAVAILABLE : DIRECT_EXPERIMENTAL_BLOCKER_CODES.BINDING_UNSUPPORTED),
    requirement("workspace", "Workspace backend is healthy", "tier_implementation_lane", "activation", workspaceOk, DIRECT_EXPERIMENTAL_BLOCKER_CODES.WORKSPACE_BACKEND_UNATTACHED),
    requirement("auth", "Direct auth is authenticated", "hard", "new_turns", authOk, authStatus.status === "refresh_failed" ? DIRECT_EXPERIMENTAL_BLOCKER_CODES.AUTH_REFRESH_FAILED : DIRECT_EXPERIMENTAL_BLOCKER_CODES.AUTH_MISSING),
    requirement("live-text", "Live text evidence is accepted", "tier_text_only", "new_turns", liveOk, liveTextStatus.modelEvidenceState === "expired" ? DIRECT_EXPERIMENTAL_BLOCKER_CODES.LIVE_TEXT_EVIDENCE_EXPIRED : DIRECT_EXPERIMENTAL_BLOCKER_CODES.LIVE_TEXT_EVIDENCE_MISSING, liveTextStatus.reason || ""),
    requirement("read-only-tool", "Read-only tool continuation is accepted", "tier_implementation_lane", "tool_continuation", toolOk, DIRECT_EXPERIMENTAL_BLOCKER_CODES.TOOL_EVIDENCE_MISSING, liveTextStatus.readOnlyToolContinuation?.reason || ""),
    requirement("import-checkpoint", "Import checkpoint continuation is accepted when relevant", "contextual_import", "import_continuation", importOk, DIRECT_EXPERIMENTAL_BLOCKER_CODES.IMPORT_CHECKPOINT_EVIDENCE_MISSING),
    requirement("session-store", "Direct session store recovered cleanly", "hard", "new_turns", storeOk, DIRECT_EXPERIMENTAL_BLOCKER_CODES.SESSION_STORE_CORRUPT),
    requirement("activation-store", "Activation records recovered cleanly", "hard", "activation", activationOk, DIRECT_EXPERIMENTAL_BLOCKER_CODES.ACTIVATION_RECORD_CORRUPT),
  ];
  const hardPass = requirements.every((item) =>
    item.status === "passed" ||
    item.requirementClass === "warning_only" ||
    (item.requirementClass === "contextual_import" && !importContinuationRequired(imports)));
  const textOnlyPass = bindingSupported && authOk && liveOk && storeOk && activationOk;
  const enabledBinding = binding.runtimeMode === "direct-experimental" && binding.directTransport === "live-text";
  const committedActivation = latestActivation?.transactionState === "committed";
  let state = "blocked";
  if (textOnlyPass && !toolOk) state = "text_only_eligible";
  if (hardPass) state = "eligible";
  if (enabledBinding) {
    if (!committedActivation) state = "rollback_required";
    else if (hardPass) state = "enabled";
    else state = "degraded";
  }
  if (!projectId) state = "unavailable";
  const optionalWarnings = [];
  const expiresInMs = Date.parse(normalizeString(liveTextStatus.liveProbeEvidence?.expiresAt, "")) - nowMs;
  if (Number.isFinite(expiresInMs) && expiresInMs > 0 && expiresInMs < 24 * 60 * 60 * 1000) {
    optionalWarnings.push({
      id: "live_probe_expiring",
      label: "Live probe evidence expires soon",
      severity: "warning",
      reason: "live_probe_close_to_expiry",
    });
  }
  if (!importContinuationRequired(imports)) {
    optionalWarnings.push({
      id: "import_checkpoint_not_relevant",
      label: "No eligible imports require checkpoint continuation",
      severity: "info",
      reason: "no_checkpoint_validated_imports",
    });
  }
  const scope = {
    profileId: normalizeString(project.surfaceBinding?.codex?.profileId || options.profileId, ""),
    profileHash: normalizeString(options.profileHash, ""),
    authMode: "chatgpt-subscription",
    accountEvidenceKey: normalizeString(options.accountEvidenceKey || authStatus.accountId, "") ? hmacEvidenceKey(options.localEvidenceSecret, options.accountEvidenceKey || authStatus.accountId) : "",
    endpointClass: normalizeString(options.endpointClass, "chatgpt-codex-responses"),
    endpointHash: hmacEvidenceKey(options.localEvidenceSecret, options.endpointHash || options.endpointClass || "chatgpt-codex-responses"),
    model: normalizeString(liveTextStatus.model || project.surfaceBinding?.codex?.model, ""),
    liveTextRequestShapeHash: normalizeString(liveTextStatus.liveProbeEvidence?.requestShapeHash || liveTextStatus.requestShapeHash, ""),
    readOnlyToolShapeHash: normalizeString(liveTextStatus.readOnlyToolContinuation?.capabilityId, ""),
    importCheckpointSeedShapeHash: importContinuationRequired(imports) ? "contextual-import-checkpoint" : "",
    normalizerVersion: normalizeString(options.normalizerVersion, "direct-normalizer@1"),
    requestBuilderVersion: normalizeString(options.requestBuilderVersion, "direct-request-builder@1"),
    transportAdapterVersion: normalizeString(options.transportAdapterVersion, "direct-transport@1"),
    redactionVersion: normalizeString(options.redactionVersion, "direct-redaction@1"),
  };
  const gateCore = {
    schema: DIRECT_EXPERIMENTAL_GATE_SCHEMA,
    gateId: "",
    projectId,
    evaluatedAt,
    freshness: {
      evaluatedAt,
      expiresAt,
      maxAgeMs: Number(options.maxAgeMs || DEFAULT_GATE_MAX_AGE_MS),
    },
    evaluatorVersion: "direct-experimental-activation@1",
    target,
    state,
    requirements,
    optionalWarnings,
    scope,
    workspace,
    currentBinding: {
      runtimeMode: binding.runtimeMode,
      directTransport: binding.directTransport,
      bindingProvider: binding.provider,
    },
    exposure: {
      rawAuthExposed: false,
      rawRequestExposed: false,
      rawStreamExposed: false,
      rawImportPathExposed: false,
      rawWorkspacePathExposed: false,
    },
  };
  const gateDigest = digest({
    projectId,
    target,
    scope,
    workspace,
    requirements: requirements.map((item) => ({
      id: item.id,
      requirementClass: item.requirementClass,
      status: item.status,
      affects: item.affects,
      blockerCode: item.blockerCode || "",
    })),
    exposure: gateCore.exposure,
    evaluatorVersion: gateCore.evaluatorVersion,
  });
  const gate = { ...gateCore, gateId: `direct_gate_${gateDigest.slice(0, 16)}`, gateDigest };
  return {
    gate,
    status: rendererSafeActivationStatusFromGate(gate, latestActivation || {}),
  };
}

class DirectExperimentalActivationStore {
  constructor(options = {}) {
    const rootDir = normalizeString(options.rootDir, "");
    if (!rootDir) throw new Error("DirectExperimentalActivationStore requires rootDir.");
    this.rootDir = path.resolve(rootDir);
    this._statusCache = new Map();
  }

  projectDir(projectId) {
    return path.join(this.rootDir, "activation", safeProjectDirectoryName(projectId));
  }

  activationPath(projectId, activationId) {
    return path.join(this.projectDir(projectId), "activations", `${requireSafeId(activationId, "activation")}.json`);
  }

  rollbackPath(projectId, rollbackId) {
    return path.join(this.projectDir(projectId), "rollbacks", `${requireSafeId(rollbackId, "rollback")}.json`);
  }

  listIds(projectId, kind) {
    const directory = path.join(this.projectDir(projectId), kind);
    try {
      return fs.readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name.slice(0, -".json".length))
        .filter(isSafeId);
    } catch (error) {
      if (error && error.code === "ENOENT") return [];
      throw error;
    }
  }

  readActivation(projectId, activationId) {
    const record = readJsonFile(this.activationPath(projectId, activationId));
    return record?.schema === DIRECT_EXPERIMENTAL_ACTIVATION_SCHEMA ? record : null;
  }

  writeActivation(record) {
    if (!isPlainObject(record) || record.schema !== DIRECT_EXPERIMENTAL_ACTIVATION_SCHEMA) {
      throw new Error("Invalid direct experimental activation record.");
    }
    writeJsonAtomic(this.activationPath(record.projectId, record.activationId), record);
    this._statusCache.delete(normalizeString(record.projectId, ""));
    return record;
  }

  readRollback(projectId, rollbackId) {
    const record = readJsonFile(this.rollbackPath(projectId, rollbackId));
    return record?.schema === DIRECT_EXPERIMENTAL_ROLLBACK_SCHEMA ? record : null;
  }

  writeRollback(record) {
    if (!isPlainObject(record) || record.schema !== DIRECT_EXPERIMENTAL_ROLLBACK_SCHEMA) {
      throw new Error("Invalid direct experimental rollback record.");
    }
    writeJsonAtomic(this.rollbackPath(record.projectId, record.rollbackId), record);
    this._statusCache.delete(normalizeString(record.projectId, ""));
    return record;
  }

  listActivations(projectId) {
    return this.listIds(projectId, "activations")
      .map((id) => {
        try {
          return this.readActivation(projectId, id);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  }

  latestCommittedActivation(projectId) {
    return this.listActivations(projectId).find((record) => record.transactionState === "committed" && !record.rolledBackByRollbackId) || null;
  }

  findActivationByClientId(projectId, clientActivationId) {
    const key = normalizeString(clientActivationId, "");
    if (!key) return null;
    return this.listActivations(projectId).find((record) => record.clientActivationId === key) || null;
  }

  findRollbackByClientId(projectId, clientRollbackId) {
    const key = normalizeString(clientRollbackId, "");
    if (!key) return null;
    for (const id of this.listIds(projectId, "rollbacks")) {
      const record = this.readRollback(projectId, id);
      if (record?.clientRollbackId === key) return record;
    }
    return null;
  }

  statusForProject(projectId) {
    const cacheKey = normalizeString(projectId, "");
    const cached = this._statusCache.get(cacheKey);
    if (cached) return cached;
    const ids = this.listIds(projectId, "activations");
    let corruptedCount = 0;
    let committedCount = 0;
    let pendingCount = 0;
    let latestActivation = null;
    for (const id of ids) {
      try {
        const record = this.readActivation(projectId, id);
        if (!record) {
          corruptedCount += 1;
          continue;
        }
        if (record.transactionState === "committed") committedCount += 1;
        if (record.transactionState === "pending") pendingCount += 1;
        if (
          record.transactionState === "committed" &&
          !record.rolledBackByRollbackId &&
          (!latestActivation || String(record.createdAt || "").localeCompare(String(latestActivation.createdAt || "")) > 0)
        ) {
          latestActivation = record;
        }
      } catch {
        corruptedCount += 1;
      }
    }
    const status = {
      available: true,
      projectId: normalizeString(projectId, ""),
      committedCount,
      pendingCount,
      corruptedCount,
      latestActivation,
    };
    this._statusCache.set(cacheKey, status);
    return status;
  }

  createPendingActivation(project, gate, clientActivationId) {
    const previousBindingPrivate = privateBindingSnapshot(project.surfaceBinding?.codex || {});
    const activatedBindingPrivate = activationTargetBinding(previousBindingPrivate, gate);
    const now = nowIso();
    const activationId = newId("direct_activation");
    const record = {
      schema: DIRECT_EXPERIMENTAL_ACTIVATION_SCHEMA,
      activationId,
      clientActivationId: normalizeString(clientActivationId, ""),
      projectId: safeProjectId(project),
      createdAt: now,
      transactionState: "pending",
      activatedBy: "user",
      previousBindingPrivate,
      previousBindingRendererSummary: rendererBindingSummary(previousBindingPrivate),
      activatedBindingPrivate,
      activatedBindingRendererSummary: {
        ...rendererBindingSummary(activatedBindingPrivate),
        activationTier: "implementation-lane",
      },
      previousBindingDigest: activationProjectBindingDigest(previousBindingPrivate),
      activatedBindingDigest: activationProjectBindingDigest(activatedBindingPrivate),
      gateId: gate.gateId,
      gateDigest: gate.gateDigest,
      rollbackAvailable: true,
      supersededByActivationId: "",
      rolledBackByRollbackId: "",
    };
    return this.writeActivation(record);
  }

  markActivationCommitted(record) {
    return this.writeActivation({
      ...record,
      transactionState: "committed",
      committedAt: nowIso(),
    });
  }

  markActivationAbandoned(record, reason) {
    return this.writeActivation({
      ...record,
      transactionState: "abandoned",
      abandonedAt: nowIso(),
      abandonedReason: normalizeString(reason, "abandoned"),
    });
  }

  createPendingRollback(project, activation, clientRollbackId, reason) {
    const restoredBindingPrivate = isPlainObject(activation.previousBindingPrivate) ? activation.previousBindingPrivate : null;
    const fallbackToLegacyAppServer = !restoredBindingPrivate;
    const restored = restoredBindingPrivate || {
      ...(isPlainObject(project.surfaceBinding?.codex) ? project.surfaceBinding.codex : {}),
      bindingProvider: "codex-compatible",
      runtimeMode: "legacy-app-server",
      directTransport: "fixture",
    };
    const rollbackId = newId("direct_rollback");
    const record = {
      schema: DIRECT_EXPERIMENTAL_ROLLBACK_SCHEMA,
      rollbackId,
      clientRollbackId: normalizeString(clientRollbackId, ""),
      activationId: normalizeString(activation.activationId, ""),
      projectId: safeProjectId(project),
      createdAt: nowIso(),
      transactionState: "pending",
      reason: normalizeString(reason, fallbackToLegacyAppServer ? "schema_incompatible" : "user_requested"),
      restoredBindingPrivate: restored,
      restoredBindingRendererSummary: rendererBindingSummary(restored),
      restoredBindingDigest: activationProjectBindingDigest(restored),
      fallbackToLegacyAppServer,
      preserved: {
        directSessions: true,
        directImports: true,
        directEvidence: true,
        directDiagnostics: true,
      },
    };
    return this.writeRollback(record);
  }

  markRollbackCommitted(record, activation) {
    const committed = this.writeRollback({
      ...record,
      transactionState: "committed",
      committedAt: nowIso(),
    });
    if (activation) {
      this.writeActivation({
        ...activation,
        rolledBackByRollbackId: committed.rollbackId,
      });
    }
    return committed;
  }
}

module.exports = {
  DIRECT_EXPERIMENTAL_ACTIVATION_SCHEMA,
  DIRECT_EXPERIMENTAL_BLOCKER_CODES,
  DIRECT_EXPERIMENTAL_GATE_SCHEMA,
  DIRECT_EXPERIMENTAL_ROLLBACK_SCHEMA,
  DirectExperimentalActivationStore,
  activeDirectTurnCountForProject,
  activationProjectBindingDigest,
  evaluateDirectExperimentalProjectActivation,
  rendererSafeActivationStatusFromGate,
};
