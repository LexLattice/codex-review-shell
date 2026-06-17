#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
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
} = require("../src/main/direct/agents/batch-job-surface");
const {
  buildDirectSettingsSurfaceProjection,
  assertDirectSettingsSurfaceRendererSafe,
} = require("../src/main/direct/ui/settings-surface");
const {
  buildToolCapabilityRegistry,
  validateToolCapabilityRegistry,
} = require("../src/main/direct/bridge/tool-capability-registry");
const {
  buildDirectInformationBridgeAudit,
} = require("../src/main/direct/bridge/information-registry");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectThrows(fn, expectedMessage) {
  try {
    fn();
  } catch (error) {
    if (expectedMessage && !String(error?.message || "").includes(expectedMessage)) {
      throw new Error(`expected ${expectedMessage}, got ${error?.message || error}`);
    }
    return;
  }
  throw new Error(`expected throw: ${expectedMessage}`);
}

function byToolId(registry) {
  return new Map(registry.rows.map((row) => [row.toolId, row]));
}

const projectId = "project_batch_agent_fixture";
const primaryThreadId = "thread_batch_agent_primary_fixture";
const workThreadId = "work_thread_batch_agent_fixture";

const workerOne = buildBatchAgentWorkerItem({
  batchJobId: "batch_job_fixture",
  workerItemId: "worker_item_1",
  itemOrdinal: 1,
  csvRowKey: "row_alpha",
  agentClassKind: "sub_agent_worker",
  model: "gpt-5.5",
  reasoningEffort: "medium",
  inputEvidenceKey: "csv_row_alpha_ref",
  resultEvidenceKey: "result_alpha_ref",
  workerState: "completed",
  resultState: "accepted",
}, 0);
const workerTwo = buildBatchAgentWorkerItem({
  batchJobId: "batch_job_fixture",
  workerItemId: "worker_item_2",
  itemOrdinal: 2,
  csvRowKey: "row_beta",
  inputEvidenceKey: "csv_row_beta_ref",
  workerState: "planned",
  resultState: "not_reported",
}, 1);
assert(workerOne.schema === DIRECT_BATCH_AGENT_WORKER_ITEM_SCHEMA, "worker item schema mismatch");
assert(workerOne.rawCsvRowIncluded === false, "worker item must not include raw CSV row");
assert(workerOne.rawPromptIncluded === false, "worker item must not include raw prompt");

const jobPlan = buildBatchAgentJobPlan({
  projectId,
  primaryThreadId,
  workThreadId,
  batchJobId: "batch_job_fixture",
  csvEvidenceKey: "csv_fixture_ref",
  csvHeaderDigest: "sha256:csv_header_fixture",
  rowCount: 2,
  maxWorkers: 4,
  concurrencyLimit: 2,
  workerItems: [workerOne, workerTwo],
});
assert(jobPlan.schema === DIRECT_BATCH_AGENT_JOB_PLAN_SCHEMA, "job plan schema mismatch");
assert(jobPlan.spawnAgentsOnCsvAcceptedAsPlan === true, "valid batch job should be accepted as a plan");
assert(jobPlan.fanOutState === "planned", "valid batch plan should be planned");
assert(jobPlan.workerItemCount === 2, "job plan should retain worker count");
assert(jobPlan.localSpawnAllowed === false, "job plan must not enable local spawn");
assert(jobPlan.recursiveSpawnAllowed === false, "job plan must not enable recursive spawn");

const blockedPlan = buildBatchAgentJobPlan({
  projectId,
  primaryThreadId,
  batchJobId: "blocked_batch_job_fixture",
  rowCount: 3,
  maxWorkers: 2,
  workerItems: [
    { workerItemId: "dup_worker", csvRowKey: "row_1" },
    { workerItemId: "dup_worker", csvRowKey: "row_2" },
  ],
});
assert(blockedPlan.spawnAgentsOnCsvAcceptedAsPlan === false, "missing csv/over-limit duplicate plan should be blocked");
assert(blockedPlan.fanOutBlockers.includes("csv_evidence_missing"), "blocked plan should cite missing CSV evidence");
assert(blockedPlan.fanOutBlockers.includes("row_count_exceeds_max_workers"), "blocked plan should cite max worker violation");
assert(blockedPlan.fanOutBlockers.includes("duplicate_worker_item_id"), "blocked plan should cite duplicate workers");

const resultContract = buildBatchAgentResultContract({
  batchJobId: jobPlan.batchJobId,
  resultEnvelopeType: "batch_worker_result_ref",
  requiredFields: ["workerItemId", "resultState", "resultEvidenceKey"],
});
assert(resultContract.schema === DIRECT_BATCH_AGENT_RESULT_CONTRACT_SCHEMA, "result contract schema mismatch");
assert(resultContract.workerMayReportOnlyOwnItem === true, "worker result contract must scope worker reporting");
assert(resultContract.parentMaySynthesizeMissingResult === false, "parent must not synthesize missing worker result");

const aggregationLedger = buildBatchAgentAggregationLedger({
  batchJobId: jobPlan.batchJobId,
  expectedWorkerCount: 2,
  workerItems: [workerOne, workerTwo],
});
assert(aggregationLedger.schema === DIRECT_BATCH_AGENT_AGGREGATION_LEDGER_SCHEMA, "aggregation ledger schema mismatch");
assert(aggregationLedger.receivedResultCount === 1, "aggregation should count reported results");
assert(aggregationLedger.missingResultCount === 1, "aggregation should count missing results");
assert(aggregationLedger.aggregationState === "partial", "aggregation should remain partial with missing result");
assert(aggregationLedger.aggregationExportWriteAllowed === false, "aggregation must not write export");

const surface = buildBatchAgentJobSurface({
  projectId,
  primaryThreadId,
  workThreadId,
  jobPlan,
  resultContract,
  aggregationLedger,
  nowMs: 0,
});
assert(surface.schema === DIRECT_BATCH_AGENT_JOB_SURFACE_SCHEMA, "surface schema mismatch");
assert(surface.structuredBatchPlanAvailable === true, "surface should expose structured plan");
assert(surface.workerResultContractExists === true, "surface should expose worker result contract");
assert(surface.aggregationLedgerExists === true, "surface should expose aggregation ledger");
assert(surface.spawnAgentsOnCsvToolEnabledInThisPr === false, "batch spawn tool must remain blocked");
assert(surface.reportAgentJobResultToolEnabledInThisPr === false, "worker result report tool must remain blocked");
assert(surface.separateWorkerUsageAttributionRequired === true, "batch jobs require separate worker usage attribution");
assertBatchAgentJobSurfaceSafe(surface);

const duplicateResultLedger = buildBatchAgentAggregationLedger({
  batchJobId: "dup_result_batch",
  expectedWorkerCount: 2,
  workerItems: [
    { workerItemId: "dup_a", resultEvidenceKey: "same_result", resultState: "accepted" },
    { workerItemId: "dup_b", resultEvidenceKey: "same_result", resultState: "accepted" },
  ],
});
assert(duplicateResultLedger.duplicateResultCount === 1, "aggregation should detect duplicate result evidence");
assert(duplicateResultLedger.aggregationState === "blocked", "duplicate results should block aggregation");

const settingsProjection = buildDirectSettingsSurfaceProjection({
  projectId,
  batchAgentJobSurfaceStatus: surface,
});
assert(settingsProjection.sections.batchAgentJobSurface.available === true, "settings should expose batch agent job surface");
assert(settingsProjection.sections.batchAgentJobSurface.workerItemCount === 2, "settings should expose worker item count");
assert(settingsProjection.sections.batchAgentJobSurface.receivedResultCount === 1, "settings should expose received result count");
assert(settingsProjection.sections.batchAgentJobSurface.localBatchExecutionAllowed === false, "settings must block local batch execution");
assert(settingsProjection.bridgeOrgans.includes("batch_agent_job_surface"), "settings should cite batch bridge organ");
assert(Array.isArray(settingsProjection.rows.batchAgentJobSurface) && settingsProjection.rows.batchAgentJobSurface.length >= 8, "settings should render batch rows");
assert(settingsProjection.authority.batchAgentLocalExecutionAllowed === false, "settings authority must block local execution");
assert(settingsProjection.authority.batchAgentParentMayClaimWorkerSuccess === false, "settings authority must block parent success laundering");
assertDirectSettingsSurfaceRendererSafe(settingsProjection);

const registry = buildToolCapabilityRegistry({
  projectId,
  nowMs: 0,
});
validateToolCapabilityRegistry(registry);
const toolRows = byToolId(registry);
const spawnCsv = toolRows.get("vanilla.spawn_agents_on_csv");
const reportResult = toolRows.get("vanilla.report_agent_job_result");
assert(spawnCsv.odeuFamily === "batch_agent_orchestration", "spawn_agents_on_csv should be batch orchestration");
assert(spawnCsv.implementationState === "projection_only", "spawn_agents_on_csv should be projection-only");
assert(spawnCsv.promotionState === "diagnostic_only", "spawn_agents_on_csv should be diagnostic-only");
assert(spawnCsv.localExecutor === "src/main/direct/agents/batch-job-surface.js", "spawn_agents_on_csv should cite batch surface");
assert(spawnCsv.requestShapeFamilies.includes("direct_batch_agent_job_plan"), "spawn_agents_on_csv should declare job plan");
assert(spawnCsv.requestShapeFamilies.includes("direct_batch_agent_aggregation_ledger"), "spawn_agents_on_csv should declare aggregation ledger");
assert(reportResult.agentEligibility === "batch_worker_only", "report_agent_job_result should be worker-only");
assert(reportResult.requestShapeFamilies.includes("direct_batch_agent_result_contract"), "report_agent_job_result should declare result contract");
assert(reportResult.providerResultEnvelopeType === "agent_mailbox_event", "report_agent_job_result should use mailbox event envelope");

const audit = buildDirectInformationBridgeAudit({ generatedAt: "1970-01-01T00:00:00.000Z" });
assert(audit.rows.some((row) => row.id === "ic32.batch-agent-job-surface"), "information registry should include batch job row");

const hostile = buildBatchAgentJobSurface({
  projectId: "hostile_batch",
  jobPlan: {
    csvEvidenceKey: "hostile_csv_ref",
  },
  nowMs: 0,
});
hostile.localBatchExecutionAllowed = true;
expectThrows(() => assertBatchAgentJobSurfaceSafe(hostile), "direct_batch_agent_job_surface_authority_leak");

const serialized = JSON.stringify({ surface, settingsProjection, registry, audit });
for (const forbidden of [
  "\"localBatchExecutionAllowed\":true",
  "\"providerTransportAllowed\":true",
  "\"requestShapeMutationAllowed\":true",
  "\"recursiveSpawnAllowed\":true",
  "\"childToolsAllowed\":true",
  "\"parentMayClaimWorkerSuccess\":true",
  "\"rawCsvIncluded\":true",
  "\"rawWorkerPromptIncluded\":true",
  "\"rawResultIncluded\":true",
  "\"rawExportIncluded\":true",
  "\"rawPathIncluded\":true",
  "\"rawSecretIncluded\":true",
  "super-secret-batch-token",
]) {
  assert(!serialized.includes(forbidden), `serialized batch surface leaked ${forbidden}`);
}

console.log("direct-batch-agent-jobs regression passed");
