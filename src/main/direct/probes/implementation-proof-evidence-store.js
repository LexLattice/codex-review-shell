"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DIRECT_IMPLEMENTATION_PROOF_RUNS_ROOT_NAME = "direct-implementation-proof-runs";
const DIRECT_IMPLEMENTATION_SCOPED_PROOF_SCHEMA = "direct_implementation_lane_scoped_tool_proof@1";
const DIRECT_IMPLEMENTATION_PROOF_SUMMARY_SCHEMA = "direct_implementation_lane_scoped_proof_summary@1";
const DEFAULT_IMPLEMENTATION_PROOF_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

const DIRECT_IMPLEMENTATION_REQUIRED_CAPABILITIES = Object.freeze([
  {
    capabilityId: "read_file",
    scenario: "read",
    toolName: "read_file",
    requestShapeClass: "direct_implementation_read_initial@1",
    continuationShapeClass: "direct_readonly_tool_continuation@1",
  },
  {
    capabilityId: "read_file_loop",
    scenario: "read_loop",
    toolName: "read_file",
    requestShapeClass: "direct_implementation_read_loop_initial@1",
    continuationShapeClass: "direct_readonly_tool_loop_continuation@1",
  },
  {
    capabilityId: "apply_patch",
    scenario: "patch",
    toolName: "apply_patch",
    requestShapeClass: "direct_implementation_patch_initial@1",
    continuationShapeClass: "direct_patch_apply_continuation@1",
  },
  {
    capabilityId: "run_command",
    scenario: "command",
    toolName: "run_command",
    requestShapeClass: "direct_implementation_command_initial@1",
    continuationShapeClass: "direct_command_execution_continuation@1",
  },
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isPlainObject(value)) {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) result[key] = canonicalize(value[key]);
    }
    return result;
  }
  return value;
}

function digestValue(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function scopedAccountEvidenceKey(value) {
  const text = normalizeString(value, "");
  return text ? digestValue({ schema: "direct_implementation_account_scope@1", accountId: text }).slice(0, 32) : "";
}

function accountEvidenceKeyFromInputs({ authStatus = {}, credentials = {} } = {}) {
  return scopedAccountEvidenceKey(
    credentials.accountId ||
    credentials.chatgptAccountId ||
    authStatus.accountId ||
    authStatus.chatgptAccountId ||
    "",
  );
}

function endpointClass(endpoint = "") {
  const text = normalizeString(endpoint, "");
  if (!text || text.includes("/backend-api/codex/responses")) return "chatgpt-codex-responses";
  return "custom";
}

function endpointHash(endpoint = "") {
  return crypto.createHash("sha256")
    .update(normalizeString(endpoint, "https://chatgpt.com/backend-api/codex/responses"))
    .digest("hex");
}

function capabilityForScenario(scenario) {
  const normalized = normalizeString(scenario, "");
  return DIRECT_IMPLEMENTATION_REQUIRED_CAPABILITIES.find((item) => item.scenario === normalized) || null;
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function reportCaseDigest(caseReport = {}) {
  return digestValue({
    caseId: caseReport.caseId,
    scenario: caseReport.scenario,
    status: caseReport.status,
    proofOutcome: caseReport.proofOutcome,
    coverageSource: caseReport.coverageSource,
    countsAsRealProviderProof: caseReport.countsAsRealProviderProof,
    providerToolCallObserved: caseReport.providerToolCallObserved,
    localAuthorityExecuted: caseReport.localAuthorityExecuted,
    providerContinuationSent: caseReport.providerContinuationSent,
    providerContinuationCompleted: caseReport.providerContinuationCompleted,
    toolDeclarationEvidence: caseReport.toolDeclarationEvidence || {},
    localAction: caseReport.localAction || {},
  });
}

function buildScopedProofEvidenceFromCase(caseReport = {}, context = {}) {
  const capability = capabilityForScenario(caseReport.scenario);
  if (!capability) return null;
  const sourceCaseDigest = reportCaseDigest(caseReport);
  const coverageSource = normalizeString(caseReport.coverageSource, "");
  const countsAsRealProviderProof = caseReport.countsAsRealProviderProof === true;
  const proved = coverageSource === "real_provider" &&
    normalizeString(caseReport.status, "") === "proved" &&
    countsAsRealProviderProof &&
    caseReport.providerToolCallObserved === true &&
    caseReport.localAuthorityExecuted === true &&
    caseReport.providerContinuationSent === true &&
    caseReport.providerContinuationCompleted === true;
  const scope = {
    capabilityId: capability.capabilityId,
    scenario: capability.scenario,
    toolName: capability.toolName,
    requestShapeClass: capability.requestShapeClass,
    continuationShapeClass: capability.continuationShapeClass,
    model: normalizeString(context.model, ""),
    accountEvidenceKey: normalizeString(context.accountEvidenceKey, ""),
    endpointClass: normalizeString(context.endpointClass, "chatgpt-codex-responses"),
    endpointHash: normalizeString(context.endpointHash, ""),
    profileHash: normalizeString(context.profileHash, ""),
    requestBuilderVersion: normalizeString(context.requestBuilderVersion, ""),
    normalizerVersion: normalizeString(context.normalizerVersion, ""),
    redactionVersion: normalizeString(context.redactionVersion, ""),
  };
  const evidenceCore = {
    schema: DIRECT_IMPLEMENTATION_SCOPED_PROOF_SCHEMA,
    evidenceId: "",
    status: proved ? "runtime_probed" : "not_proved",
    usable: proved,
    generatedAt: normalizeString(context.generatedAt, "") || nowIso(),
    expiresAt: normalizeString(context.expiresAt, ""),
    coverageSource,
    countsAsRealProviderProof,
    sourceReportRunId: normalizeString(context.runId, ""),
    sourceCaseId: normalizeString(caseReport.caseId, ""),
    sourceCaseDigest,
    scope,
    rawProviderPayloadIncluded: false,
    rawToolArgsIncluded: false,
    rawWorkspacePathIncluded: false,
    rawAccountIncluded: false,
  };
  const evidenceId = `impl_tool_proof_${digestValue(evidenceCore).slice(0, 20)}`;
  return { ...evidenceCore, evidenceId };
}

function buildScopedImplementationLaneProofEvidence({ report = {}, model = "", endpoint = "", authStatus = {}, credentials = {}, profileHash = "" } = {}) {
  const createdAt = normalizeString(report.createdAt, "") || nowIso();
  const context = {
    runId: report.runId,
    generatedAt: createdAt,
    expiresAt: nowIso(Date.parse(createdAt) + DEFAULT_IMPLEMENTATION_PROOF_MAX_AGE_MS),
    model,
    accountEvidenceKey: accountEvidenceKeyFromInputs({ authStatus, credentials }),
    endpointClass: endpointClass(endpoint),
    endpointHash: endpointHash(endpoint),
    profileHash,
    requestBuilderVersion: normalizeString(report.versions?.requestBuilderVersion || report.runtimeEvidence?.requestBuilderVersion, ""),
    normalizerVersion: normalizeString(report.versions?.normalizerVersion || report.runtimeEvidence?.normalizerVersion, ""),
    redactionVersion: normalizeString(report.versions?.redactionVersion || report.runtimeEvidence?.redactionVersion, ""),
  };
  const evidence = (Array.isArray(report.cases) ? report.cases : [])
    .map((entry) => buildScopedProofEvidenceFromCase(entry, context))
    .filter(Boolean);
  return {
    schema: DIRECT_IMPLEMENTATION_PROOF_SUMMARY_SCHEMA,
    generatedAt: createdAt,
    requiredCapabilities: DIRECT_IMPLEMENTATION_REQUIRED_CAPABILITIES.map((item) => item.capabilityId),
    evidence,
    rawProviderPayloadIncluded: false,
    rawToolArgsIncluded: false,
    rawWorkspacePathIncluded: false,
    rawAccountIncluded: false,
  };
}

function newestFiles(rootDir, maxFiles = 100) {
  let children = [];
  try {
    children = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return children
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const filePath = path.join(rootDir, entry.name, "implementation-proof-report.json");
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(filePath).mtimeMs;
      } catch {}
      return { filePath, mtimeMs };
    })
    .filter((entry) => entry.mtimeMs > 0)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, maxFiles)
    .map((entry) => entry.filePath);
}

function rowScopeMatches(row = {}, expected = {}) {
  const scope = isPlainObject(row.scope) ? row.scope : {};
  const capability = capabilityForScenario(scope.scenario) ||
    DIRECT_IMPLEMENTATION_REQUIRED_CAPABILITIES.find((item) => item.capabilityId === scope.capabilityId);
  if (!capability) return false;
  if (scope.capabilityId !== capability.capabilityId) return false;
  if (scope.requestShapeClass !== capability.requestShapeClass) return false;
  if (scope.toolName !== capability.toolName) return false;
  const model = normalizeString(expected.model, "");
  if (model && normalizeString(scope.model, "") && normalizeString(scope.model, "") !== model) return false;
  const accountEvidenceKey = normalizeString(expected.accountEvidenceKey, "");
  if (accountEvidenceKey && normalizeString(scope.accountEvidenceKey, "") && normalizeString(scope.accountEvidenceKey, "") !== accountEvidenceKey) return false;
  const expectedEndpointClass = normalizeString(expected.endpointClass, "");
  if (expectedEndpointClass && normalizeString(scope.endpointClass, "") && normalizeString(scope.endpointClass, "") !== expectedEndpointClass) return false;
  return true;
}

function usableRow(row = {}, expected = {}, nowMs = Date.now()) {
  if (row.schema !== DIRECT_IMPLEMENTATION_SCOPED_PROOF_SCHEMA) return false;
  if (row.usable !== true || row.status !== "runtime_probed") return false;
  if (row.coverageSource !== "real_provider" || row.countsAsRealProviderProof !== true) return false;
  const expiresAtMs = Date.parse(normalizeString(row.expiresAt, ""));
  if (Number.isFinite(expiresAtMs) && expiresAtMs > 0 && expiresAtMs <= nowMs) return false;
  return rowScopeMatches(row, expected);
}

class DirectImplementationProofEvidenceStore {
  constructor(options = {}) {
    this.rootDir = normalizeString(options.rootDir, "");
    this.maxReports = Number(options.maxReports || 100);
  }

  readEvidenceRows() {
    const rows = [];
    for (const filePath of newestFiles(this.rootDir, this.maxReports)) {
      const report = readJsonFile(filePath);
      const summary = isPlainObject(report?.scopedImplementationLaneProof) ? report.scopedImplementationLaneProof : null;
      if (report?.schema !== "direct_implementation_lane_real_provider_proof_report@1") continue;
      if (report.rawExposureScan?.status && report.rawExposureScan.status !== "passed") continue;
      for (const row of Array.isArray(summary?.evidence) ? summary.evidence : []) {
        if (isPlainObject(row)) rows.push(row);
      }
    }
    return rows;
  }

  resolveScopedProofEvidence(options = {}) {
    const nowMs = Number(options.nowMs || Date.now());
    const expected = {
      model: normalizeString(options.model || options.project?.surfaceBinding?.codex?.model, ""),
      accountEvidenceKey: accountEvidenceKeyFromInputs(options),
      endpointClass: endpointClass(options.endpoint),
    };
    const rows = this.readEvidenceRows();
    const capabilities = DIRECT_IMPLEMENTATION_REQUIRED_CAPABILITIES.map((capability) => {
      const row = rows.find((candidate) =>
        candidate?.scope?.capabilityId === capability.capabilityId &&
        usableRow(candidate, expected, nowMs));
      return {
        capabilityId: capability.capabilityId,
        scenario: capability.scenario,
        toolName: capability.toolName,
        requestShapeClass: capability.requestShapeClass,
        continuationShapeClass: capability.continuationShapeClass,
        status: row ? "ready" : "missing",
        evidenceState: row ? "runtime_probed" : "missing",
        evidenceId: normalizeString(row?.evidenceId, ""),
        sourceReportRunId: normalizeString(row?.sourceReportRunId, ""),
        sourceCaseId: normalizeString(row?.sourceCaseId, ""),
        sourceCaseDigest: normalizeString(row?.sourceCaseDigest, ""),
        rawProviderPayloadIncluded: false,
        rawToolArgsIncluded: false,
        rawWorkspacePathIncluded: false,
        rawAccountIncluded: false,
      };
    });
    const missing = capabilities.filter((item) => item.status !== "ready");
    return {
      schema: DIRECT_IMPLEMENTATION_PROOF_SUMMARY_SCHEMA,
      status: missing.length ? (capabilities.length === missing.length ? "missing" : "partial") : "ready",
      evidenceState: missing.length ? (capabilities.length === missing.length ? "missing" : "partial") : "runtime_probed",
      canSelectImplementationLane: missing.length === 0,
      generatedAt: nowIso(nowMs),
      expectedScope: {
        model: expected.model,
        endpointClass: expected.endpointClass,
        accountEvidenceKeyPresent: Boolean(expected.accountEvidenceKey),
        rawAccountIncluded: false,
      },
      requiredCapabilities: capabilities,
      missingCapabilityIds: missing.map((item) => item.capabilityId),
      rawProviderPayloadIncluded: false,
      rawToolArgsIncluded: false,
      rawWorkspacePathIncluded: false,
      rawAccountIncluded: false,
    };
  }
}

module.exports = {
  DEFAULT_IMPLEMENTATION_PROOF_MAX_AGE_MS,
  DIRECT_IMPLEMENTATION_PROOF_RUNS_ROOT_NAME,
  DIRECT_IMPLEMENTATION_PROOF_SUMMARY_SCHEMA,
  DIRECT_IMPLEMENTATION_REQUIRED_CAPABILITIES,
  DIRECT_IMPLEMENTATION_SCOPED_PROOF_SCHEMA,
  DirectImplementationProofEvidenceStore,
  accountEvidenceKeyFromInputs,
  buildScopedImplementationLaneProofEvidence,
  scopedAccountEvidenceKey,
};
