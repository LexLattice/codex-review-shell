"use strict";

const crypto = require("node:crypto");

const DIRECT_BATCH_AGENT_JOB_SURFACE_SCHEMA = "direct_batch_agent_job_surface@1";
const DIRECT_BATCH_AGENT_JOB_PLAN_SCHEMA = "direct_batch_agent_job_plan@1";
const DIRECT_BATCH_AGENT_WORKER_ITEM_SCHEMA = "direct_batch_agent_worker_item@1";
const DIRECT_BATCH_AGENT_RESULT_CONTRACT_SCHEMA = "direct_batch_agent_result_contract@1";
const DIRECT_BATCH_AGENT_AGGREGATION_LEDGER_SCHEMA = "direct_batch_agent_aggregation_ledger@1";

const FAN_OUT_STATES = new Set(["not_requested", "planned", "blocked", "queued", "running", "completed", "failed", "unknown"]);
const WORKER_STATES = new Set(["planned", "blocked", "queued", "running", "completed", "failed", "unknown"]);
const RESULT_STATES = new Set(["not_reported", "reported", "accepted", "rejected", "duplicate", "missing", "unknown"]);
const AGGREGATION_STATES = new Set(["not_started", "partial", "complete", "blocked", "failed", "unknown"]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedString(value, maxLength = 320) {
  const text = normalizeString(value, "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nonNegativeInt(value, fallback = 0) {
  const parsed = Math.floor(finiteNumber(value, fallback));
  return parsed >= 0 ? parsed : fallback;
}

function positiveInt(value, fallback = 1) {
  const parsed = Math.floor(finiteNumber(value, fallback));
  return parsed > 0 ? parsed : fallback;
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeEnum(value, allowed, fallback) {
  const text = normalizeString(value, fallback);
  return allowed.has(text) ? text : fallback;
}

function normalizeStringList(values, fallback = []) {
  const source = Array.isArray(values) ? values : fallback;
  return [...new Set(source.map((value) => normalizeString(value, "")).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function boundedWithFallback(value, fallback, maxLength = 320) {
  return boundedString(value, maxLength) || boundedString(fallback, maxLength);
}

function stableStringifyValue(value, seen) {
  if (value && typeof value.toJSON === "function") return stableStringifyValue(value.toJSON(), seen);
  if (value === null) return "null";
  const type = typeof value;
  if (type === "boolean" || type === "number" || type === "string") return JSON.stringify(value);
  if (type === "bigint" || type === "function" || type === "symbol" || type === "undefined") return undefined;
  if (seen.has(value)) return JSON.stringify("[Circular]");
  seen.add(value);
  if (Array.isArray(value)) {
    const serialized = `[${value.map((entry) => {
      const item = stableStringifyValue(entry, seen);
      return item === undefined ? "null" : item;
    }).join(",")}]`;
    seen.delete(value);
    return serialized;
  }
  const serialized = `{${Object.keys(value)
    .sort()
    .map((key) => {
      const item = stableStringifyValue(value[key], seen);
      return item === undefined ? "" : `${JSON.stringify(key)}:${item}`;
    })
    .filter(Boolean)
    .join(",")}}`;
  seen.delete(value);
  return serialized;
}

function stableStringify(value) {
  return stableStringifyValue(value, new WeakSet());
}

function digestFor(domain, value) {
  return crypto.createHash("sha256").update(`${domain}:${stableStringify(value)}`).digest("hex");
}

function nowIso(nowMs) {
  const ms = typeof nowMs === "number" && Number.isFinite(nowMs) ? nowMs : Date.now();
  return new Date(ms).toISOString();
}

function normalizeEvidenceRef(input = {}, fallbackKind = "batch_agent_job") {
  const source = isPlainObject(input) ? input : {};
  const ref = {
    kind: boundedString(source.kind || source.refKind || fallbackKind, 100),
    id: boundedString(source.id || source.refId || source.artifactId, 180),
    digest: boundedString(source.digest || source.artifactDigest || source.refDigest, 220),
    label: boundedString(source.label || source.rendererSafeLabel || fallbackKind, 180),
    confidence: boundedString(source.confidence || source.sourceConfidence || "diagnostic", 80),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  ref.refDigest = digestFor("direct-batch-agent-evidence-ref@1", ref);
  return ref;
}

function normalizeEvidenceRefs(values, fallbackKind = "batch_agent_job") {
  return arrayOrEmpty(values)
    .filter((value) => isPlainObject(value))
    .map((value) => normalizeEvidenceRef(value, fallbackKind));
}

function buildBatchAgentWorkerItem(input = {}, index = 0) {
  const source = isPlainObject(input) ? input : {};
  const item = {
    schema: DIRECT_BATCH_AGENT_WORKER_ITEM_SCHEMA,
    workerItemId: boundedWithFallback(source.workerItemId, `batch_worker_${index + 1}`, 180),
    batchJobId: boundedString(source.batchJobId, 180),
    itemOrdinal: nonNegativeInt(source.itemOrdinal, index + 1),
    csvRowKey: boundedWithFallback(source.csvRowKey || source.rowKey, `row_${index + 1}`, 180),
    agentThreadId: boundedString(source.agentThreadId, 180),
    agentClassKind: boundedString(source.agentClassKind || "sub_agent_worker", 120),
    model: boundedString(source.model || "runtime_default", 120),
    reasoningEffort: boundedString(source.reasoningEffort || "runtime_default", 80),
    inputEvidenceKey: boundedString(source.inputEvidenceKey || source.rowEvidenceKey, 180),
    resultEvidenceKey: boundedString(source.resultEvidenceKey, 180),
    workerState: normalizeEnum(source.workerState, WORKER_STATES, "planned"),
    resultState: normalizeEnum(source.resultState, RESULT_STATES, "not_reported"),
    resultReportedAt: boundedString(source.resultReportedAt, 80),
    rawCsvRowIncluded: false,
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawSecretIncluded: false,
  };
  item.workerItemDigest = digestFor("direct-batch-agent-worker-item@1", item);
  return item;
}

function duplicateCount(values) {
  const counts = new Map();
  let duplicateTotal = 0;
  for (const value of values) {
    const key = normalizeString(value, "");
    if (!key) continue;
    const next = Number(counts.get(key) || 0) + 1;
    counts.set(key, next);
    if (next === 2) duplicateTotal += 1;
  }
  return duplicateTotal;
}

function buildBatchAgentJobPlan(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const batchJobId = boundedWithFallback(source.batchJobId, `batch_agent_job_${digestFor("direct-batch-agent-job-source@1", source).slice(0, 24)}`, 180);
  const workerItems = arrayOrEmpty(source.workerItems).map((item, index) => buildBatchAgentWorkerItem({ ...item, batchJobId }, index));
  const maxWorkers = positiveInt(source.maxWorkers, 50);
  const rowCount = nonNegativeInt(source.rowCount, workerItems.length);
  const duplicateWorkerItemCount = duplicateCount(workerItems.map((item) => item.workerItemId));
  const fanOutBlockers = [];
  if (rowCount > maxWorkers) fanOutBlockers.push("row_count_exceeds_max_workers");
  if (duplicateWorkerItemCount) fanOutBlockers.push("duplicate_worker_item_id");
  if (!normalizeString(source.csvEvidenceKey, "")) fanOutBlockers.push("csv_evidence_missing");
  const plan = {
    schema: DIRECT_BATCH_AGENT_JOB_PLAN_SCHEMA,
    batchJobId,
    projectId: boundedString(source.projectId, 160),
    primaryThreadId: boundedString(source.primaryThreadId, 180),
    workThreadId: boundedString(source.workThreadId, 180),
    csvEvidenceKey: boundedString(source.csvEvidenceKey, 180),
    csvHeaderDigest: boundedString(source.csvHeaderDigest, 220),
    rowCount,
    workerItemCount: workerItems.length,
    maxWorkers,
    concurrencyLimit: positiveInt(source.concurrencyLimit, Math.min(4, maxWorkers)),
    fanOutState: fanOutBlockers.length ? "blocked" : normalizeEnum(source.fanOutState, FAN_OUT_STATES, "planned"),
    fanOutBlockers,
    workerItems,
    spawnAgentsOnCsvAcceptedAsPlan: fanOutBlockers.length === 0,
    providerDeclarationAllowed: false,
    providerTransportAllowed: false,
    localSpawnAllowed: false,
    recursiveSpawnAllowed: false,
    childToolsAllowed: false,
    inheritedParentAuthorityAllowed: false,
    requestShapeMutationAllowed: false,
    rawCsvIncluded: false,
    rawPromptIncluded: false,
    rawSecretIncluded: false,
  };
  plan.planDigest = digestFor("direct-batch-agent-job-plan@1", plan);
  return plan;
}

function buildBatchAgentResultContract(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const contract = {
    schema: DIRECT_BATCH_AGENT_RESULT_CONTRACT_SCHEMA,
    contractId: boundedWithFallback(source.contractId, `batch_result_contract_${digestFor("direct-batch-agent-result-contract-source@1", source).slice(0, 24)}`, 180),
    batchJobId: boundedString(source.batchJobId, 180),
    resultEnvelopeType: boundedString(source.resultEnvelopeType || "batch_worker_result_ref", 140),
    requiredFields: normalizeStringList(source.requiredFields, ["workerItemId", "resultState", "resultEvidenceKey"]),
    acceptedResultStates: normalizeStringList(source.acceptedResultStates, ["accepted", "reported", "rejected"]),
    workerMayReportOnlyOwnItem: true,
    parentMaySynthesizeMissingResult: false,
    reportAgentJobResultAcceptedAsContractEvidence: true,
    providerTransportAllowed: false,
    requestShapeMutationAllowed: false,
    rawResultIncluded: false,
    rawSecretIncluded: false,
  };
  contract.contractDigest = digestFor("direct-batch-agent-result-contract@1", contract);
  return contract;
}

function buildBatchAgentAggregationLedger(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const workerItems = arrayOrEmpty(source.workerItems).map((item, index) => buildBatchAgentWorkerItem(item, index));
  const expectedWorkerCount = nonNegativeInt(source.expectedWorkerCount, workerItems.length);
  const receivedResultCount = workerItems.filter((item) => ["reported", "accepted", "rejected"].includes(item.resultState)).length;
  const duplicateResultCount = duplicateCount(workerItems.filter((item) => item.resultEvidenceKey).map((item) => item.resultEvidenceKey));
  const missingResultCount = Math.max(0, expectedWorkerCount - receivedResultCount);
  const aggregationState = expectedWorkerCount === 0
    ? "not_started"
    : duplicateResultCount
      ? "blocked"
      : missingResultCount === 0
        ? "complete"
        : "partial";
  const ledger = {
    schema: DIRECT_BATCH_AGENT_AGGREGATION_LEDGER_SCHEMA,
    ledgerId: boundedWithFallback(source.ledgerId, `batch_aggregation_${digestFor("direct-batch-agent-aggregation-source@1", source).slice(0, 24)}`, 180),
    batchJobId: boundedString(source.batchJobId, 180),
    expectedWorkerCount,
    receivedResultCount,
    missingResultCount,
    duplicateResultCount,
    aggregationState,
    exportPolicy: boundedString(source.exportPolicy || "metadata_only", 120),
    exportEvidenceKey: boundedString(source.exportEvidenceKey, 180),
    workerResultRefs: workerItems
      .filter((item) => item.resultEvidenceKey)
      .map((item) => ({
        workerItemId: item.workerItemId,
        resultEvidenceKey: item.resultEvidenceKey,
        resultState: item.resultState,
        workerItemDigest: item.workerItemDigest,
      })),
    aggregationExportWriteAllowed: false,
    parentMayClaimWorkerSuccess: false,
    rawResultIncluded: false,
    rawExportIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  ledger.ledgerDigest = digestFor("direct-batch-agent-aggregation-ledger@1", ledger);
  return ledger;
}

function buildBatchAgentJobSurface(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const jobPlan = buildBatchAgentJobPlan({
    ...(isPlainObject(source.jobPlan) ? source.jobPlan : {}),
    projectId: source.projectId,
    primaryThreadId: source.primaryThreadId,
    workThreadId: source.workThreadId,
  });
  const resultContract = buildBatchAgentResultContract({
    batchJobId: jobPlan.batchJobId,
    ...(isPlainObject(source.resultContract) ? source.resultContract : {}),
  });
  const aggregationLedger = buildBatchAgentAggregationLedger({
    ...(isPlainObject(source.aggregationLedger) ? source.aggregationLedger : {}),
    batchJobId: jobPlan.batchJobId,
    workerItems: jobPlan.workerItems,
    expectedWorkerCount: jobPlan.workerItemCount,
  });
  const surface = {
    schema: DIRECT_BATCH_AGENT_JOB_SURFACE_SCHEMA,
    surfaceId: boundedWithFallback(source.surfaceId, `batch_agent_surface_${digestFor("direct-batch-agent-surface-source@1", { jobPlan, resultContract, aggregationLedger }).slice(0, 24)}`, 180),
    projectId: boundedString(source.projectId || jobPlan.projectId, 160),
    primaryThreadId: boundedString(source.primaryThreadId || jobPlan.primaryThreadId, 180),
    workThreadId: boundedString(source.workThreadId || jobPlan.workThreadId, 180),
    mode: "batch_agent_job_projection",
    jobPlan,
    resultContract,
    aggregationLedger,
    spawnAgentsOnCsvToolEnabledInThisPr: false,
    reportAgentJobResultToolEnabledInThisPr: false,
    structuredBatchPlanAvailable: true,
    workerResultContractExists: true,
    aggregationLedgerExists: true,
    separateWorkerUsageAttributionRequired: true,
    providerDeclarationAllowed: false,
    providerTransportAllowed: false,
    localBatchExecutionAllowed: false,
    requestShapeMutationAllowed: false,
    recursiveSpawnAllowed: false,
    childToolsAllowed: false,
    inheritedParentAuthorityAllowed: false,
    aggregationExportWriteAllowed: false,
    parentMayClaimWorkerSuccess: false,
    rawCsvIncluded: false,
    rawWorkerPromptIncluded: false,
    rawResultIncluded: false,
    rawExportIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    rendererSafeSummary: boundedString(source.rendererSafeSummary || "Batch agent jobs are projected as fan-out/fan-in contracts with worker-result and aggregation ledgers; execution remains blocked.", 420),
    evidenceRefs: normalizeEvidenceRefs(source.evidenceRefs, "batch_agent_job_surface"),
    generatedAt: normalizeString(source.generatedAt, nowIso(source.nowMs)),
  };
  surface.surfaceDigest = digestFor("direct-batch-agent-job-surface@1", surface);
  return surface;
}

function assertBatchAgentJobSurfaceSafe(surface = {}) {
  if (!isPlainObject(surface) || surface.schema !== DIRECT_BATCH_AGENT_JOB_SURFACE_SCHEMA) {
    throw new Error("direct_batch_agent_job_surface_schema_mismatch");
  }
  if (surface.jobPlan?.schema !== DIRECT_BATCH_AGENT_JOB_PLAN_SCHEMA) throw new Error("direct_batch_agent_job_plan_missing");
  if (surface.resultContract?.schema !== DIRECT_BATCH_AGENT_RESULT_CONTRACT_SCHEMA) throw new Error("direct_batch_agent_result_contract_missing");
  if (surface.aggregationLedger?.schema !== DIRECT_BATCH_AGENT_AGGREGATION_LEDGER_SCHEMA) throw new Error("direct_batch_agent_aggregation_ledger_missing");
  for (const flag of [
    "spawnAgentsOnCsvToolEnabledInThisPr",
    "reportAgentJobResultToolEnabledInThisPr",
    "providerDeclarationAllowed",
    "providerTransportAllowed",
    "localBatchExecutionAllowed",
    "requestShapeMutationAllowed",
    "recursiveSpawnAllowed",
    "childToolsAllowed",
    "inheritedParentAuthorityAllowed",
    "aggregationExportWriteAllowed",
    "parentMayClaimWorkerSuccess",
    "rawCsvIncluded",
    "rawWorkerPromptIncluded",
    "rawResultIncluded",
    "rawExportIncluded",
    "rawPathIncluded",
    "rawSecretIncluded",
  ]) {
    if (surface[flag] !== false) throw new Error(`direct_batch_agent_job_surface_authority_leak:${flag}`);
  }
  if (surface.separateWorkerUsageAttributionRequired !== true) throw new Error("direct_batch_agent_usage_attribution_missing");
  if (
    surface.jobPlan.providerDeclarationAllowed !== false ||
    surface.jobPlan.providerTransportAllowed !== false ||
    surface.jobPlan.localSpawnAllowed !== false ||
    surface.jobPlan.recursiveSpawnAllowed !== false ||
    surface.jobPlan.childToolsAllowed !== false ||
    surface.jobPlan.inheritedParentAuthorityAllowed !== false ||
    surface.jobPlan.requestShapeMutationAllowed !== false ||
    surface.jobPlan.rawCsvIncluded !== false ||
    surface.jobPlan.rawPromptIncluded !== false ||
    surface.jobPlan.rawSecretIncluded !== false
  ) {
    throw new Error("direct_batch_agent_job_plan_spawn_authority_leak");
  }
  if (
    surface.resultContract.providerTransportAllowed !== false ||
    surface.resultContract.requestShapeMutationAllowed !== false ||
    surface.resultContract.parentMaySynthesizeMissingResult !== false ||
    surface.resultContract.rawResultIncluded !== false ||
    surface.resultContract.rawSecretIncluded !== false
  ) {
    throw new Error("direct_batch_agent_result_contract_authority_leak");
  }
  if (
    surface.aggregationLedger.aggregationExportWriteAllowed !== false ||
    surface.aggregationLedger.parentMayClaimWorkerSuccess !== false ||
    surface.aggregationLedger.rawResultIncluded !== false ||
    surface.aggregationLedger.rawExportIncluded !== false ||
    surface.aggregationLedger.rawPathIncluded !== false ||
    surface.aggregationLedger.rawSecretIncluded !== false
  ) {
    throw new Error("direct_batch_agent_aggregation_authority_leak");
  }
  for (const item of arrayOrEmpty(surface.jobPlan.workerItems)) {
    if (!isPlainObject(item) || item.schema !== DIRECT_BATCH_AGENT_WORKER_ITEM_SCHEMA) throw new Error("direct_batch_agent_worker_item_schema_mismatch");
    if (item.rawCsvRowIncluded !== false || item.rawPromptIncluded !== false || item.rawResultIncluded !== false || item.rawSecretIncluded !== false) {
      throw new Error("direct_batch_agent_worker_item_raw_exposure");
    }
  }
  return true;
}

module.exports = {
  DIRECT_BATCH_AGENT_AGGREGATION_LEDGER_SCHEMA,
  DIRECT_BATCH_AGENT_JOB_PLAN_SCHEMA,
  DIRECT_BATCH_AGENT_JOB_SURFACE_SCHEMA,
  DIRECT_BATCH_AGENT_RESULT_CONTRACT_SCHEMA,
  DIRECT_BATCH_AGENT_WORKER_ITEM_SCHEMA,
  assertBatchAgentJobSurfaceSafe,
  buildBatchAgentAggregationLedger,
  buildBatchAgentJobPlan,
  buildBatchAgentJobSurface,
  buildBatchAgentResultContract,
  buildBatchAgentWorkerItem,
  stableStringify,
};
