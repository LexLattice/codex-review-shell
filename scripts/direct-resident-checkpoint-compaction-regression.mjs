#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  DIRECT_RESIDENT_CONTEXT_CHECKPOINT_PAYLOAD_SCHEMA,
  DIRECT_RESIDENT_CONTEXT_CHECKPOINT_REPORT_SCHEMA,
  DIRECT_RESIDENT_CONTEXT_CHECKPOINT_REQUEST_SCHEMA,
  DIRECT_RESIDENT_CONTEXT_CHECKPOINT_SCHEMA,
  buildResidentCheckpointPrompt,
  buildResidentCheckpointRequest,
  buildResidentContextCheckpoint,
  buildResidentContextCheckpointReport,
  parseResidentCheckpointPayload,
  persistResidentContextCheckpoint,
  shouldRequestResidentCheckpoint,
  validateResidentContextCheckpoint,
} = require("../src/main/direct/context/resident-checkpoint");
const {
  buildPressureEstimate,
} = require("../src/main/direct/context/maintenance");
const {
  DirectThreadStore,
} = require("../src/main/direct/thread/thread-store");

function assertThrowsMessage(fn, message) {
  let thrown = null;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  assert.equal(thrown?.message, message);
}

const projectId = "project_resident_checkpoint";
const threadId = "direct_session_resident_checkpoint";
const turnId = "turn_checkpoint_001";
const workThreadId = "work_thread_resident_checkpoint";
const pressureEstimate = buildPressureEstimate({
  projectId,
  threadId,
  modelId: "gpt-5.5",
  visibleCharCount: 320_000,
  hiddenRequiredTokens: 4000,
  reservedOutputTokens: 4096,
  modelContextWindowEstimate: 100_000,
  nowMs: 0,
});
const triggerDecision = shouldRequestResidentCheckpoint({
  pressureEstimate,
  pressureThresholdPercent: 80,
  triggerKind: "pre_compaction_warning",
});

assert.equal(triggerDecision.schema, "direct_resident_context_checkpoint_trigger_decision@1");
assert.equal(triggerDecision.state, "request_required");
assert.equal(triggerDecision.checkpointRequired, true);
assert.equal(triggerDecision.serverPreCompactionWarning, true);

const request = buildResidentCheckpointRequest({
  projectId,
  threadId,
  turnId,
  workThreadId,
  triggerDecision,
  sourceRefs: [
    {
      artifactKind: "direct_context_pressure_estimate",
      artifactId: pressureEstimate.pressureEstimateId,
      artifactDigest: pressureEstimate.integrity.artifactDigest,
      rendererSafeLabel: "Context pressure estimate",
    },
  ],
  nowMs: 0,
});

assert.equal(request.schema, DIRECT_RESIDENT_CONTEXT_CHECKPOINT_REQUEST_SCHEMA);
assert.equal(request.providerTransportAllowed, false);
assert.equal(request.automaticContextMutationAllowed, false);
assert.equal(request.providerCompactionAllowed, false);
assert.equal(request.rawPromptIncluded, false);
assert.equal(request.createdAt, "1970-01-01T00:00:00.000Z");

const prompt = buildResidentCheckpointPrompt({
  request,
  contextSummary: "Current work is implementing resident checkpoint compaction. The context is near the pressure threshold.",
  openObligations: [
    "Add schema and validation for resident checkpoint payload.",
    "Persist checkpoint as context-maintenance artifact without mutating live context.",
  ],
  recentDialogueSummaries: [
    "User asked whether old custom compaction carried over.",
    "Assistant found only display/gate scaffolding and proposed a live resident checkpoint slice.",
  ],
});

assert(prompt.includes(DIRECT_RESIDENT_CONTEXT_CHECKPOINT_PAYLOAD_SCHEMA));
assert(prompt.includes("Return exactly one valid JSON object"));
assert(prompt.length < 24_000);

const residentPayload = {
  schema: DIRECT_RESIDENT_CONTEXT_CHECKPOINT_PAYLOAD_SCHEMA,
  taskState: {
    currentGoal: "Implement resident checkpoint compaction first slice.",
    phase: "implementation",
    progressSummary: "Schemas, prompt, parsing, and persistence are being added.",
  },
  openObligations: [
    {
      summary: "Persist checkpoint without context mutation.",
      status: "open",
      nextStep: "Write checkpoint artifact and operation evidence.",
    },
  ],
  evidenceState: {
    knownFacts: [
      "Current direct path has compaction gates but no resident JSON checkpoint call.",
    ],
    uncertainties: [
      "Live provider compaction primitive remains intentionally unpromoted.",
    ],
    sourceRefs: [
      {
        artifactKind: "direct_context_pressure_estimate",
        artifactId: pressureEstimate.pressureEstimateId,
        artifactDigest: pressureEstimate.integrity.artifactDigest,
        rendererSafeLabel: "Pressure estimate",
      },
    ],
  },
  artifactRefs: [
    {
      artifactKind: "source_file",
      displayPath: "src/main/direct/context/resident-checkpoint.js",
      purpose: "Checkpoint schema and parser.",
      state: "created",
    },
  ],
  toolState: {
    pendingToolCalls: [],
    importantToolResults: ["rg confirmed provider compaction is display-only."],
  },
  decisions: [
    {
      summary: "Do not mutate live context in this slice.",
      reason: "Avoid hidden compaction authority.",
      source: "implementation policy",
    },
  ],
  risks: [
    {
      summary: "JSON payload could omit important obligations.",
      severity: "medium",
      mitigation: "Validate required task state and next actions.",
    },
  ],
  nextActions: [
    "Run focused regression.",
    "Only later admit checkpoint into context packs.",
  ],
  confidence: "high",
};

const fencedParse = parseResidentCheckpointPayload(`\`\`\`json\n${JSON.stringify(residentPayload, null, 2)}\n\`\`\``);
assert.equal(fencedParse.ok, true);
assert.equal(fencedParse.payload.schema, DIRECT_RESIDENT_CONTEXT_CHECKPOINT_PAYLOAD_SCHEMA);

const checkpoint = buildResidentContextCheckpoint({
  request,
  residentOutput: JSON.stringify(residentPayload),
  nowMs: 0,
});

assert.equal(checkpoint.schema, DIRECT_RESIDENT_CONTEXT_CHECKPOINT_SCHEMA);
assert.equal(checkpoint.state, "checkpoint_ready");
assert.equal(checkpoint.validationErrors.length, 0);
assert.equal(checkpoint.payload.taskState.currentGoal, residentPayload.taskState.currentGoal);
assert.equal(checkpoint.automaticContextMutationAllowed, false);
assert.equal(checkpoint.providerCompactionAllowed, false);
assert.equal(checkpoint.rawResidentOutputIncluded, false);
assert.equal(checkpoint.createdAt, "1970-01-01T00:00:00.000Z");
assert.deepEqual(Object.keys(checkpoint.evidenceRefs[0]).sort(), [
  "artifactDigest",
  "artifactId",
  "artifactKind",
  "rawTextIncluded",
  "rendererSafeLabel",
]);
validateResidentContextCheckpoint(checkpoint);

const invalidCheckpoint = buildResidentContextCheckpoint({
  request,
  residentOutput: JSON.stringify({
    schema: DIRECT_RESIDENT_CONTEXT_CHECKPOINT_PAYLOAD_SCHEMA,
    taskState: {
      currentGoal: "",
      phase: "implementation",
      progressSummary: "",
    },
    openObligations: [],
    evidenceState: {},
    artifactRefs: [],
    decisions: [],
    risks: [],
    nextActions: [],
  }),
});
assert.equal(invalidCheckpoint.state, "resident_output_invalid");
assert(invalidCheckpoint.validationErrors.includes("checkpoint_current_goal_missing"));
assert(invalidCheckpoint.validationErrors.includes("checkpoint_next_actions_missing"));

const schemaMismatchCheckpoint = buildResidentContextCheckpoint({
  request,
  residentOutput: JSON.stringify({
    ...residentPayload,
    schema: "wrong_schema@1",
  }),
});
assert.equal(schemaMismatchCheckpoint.state, "resident_output_invalid");
assert(schemaMismatchCheckpoint.validationErrors.includes("checkpoint_payload_schema_mismatch"));

const malformedPayloadCases = [
  ["openObligations", {}, "checkpoint_openobligations_not_array"],
  ["evidenceState", [], "checkpoint_evidencestate_not_object"],
  ["artifactRefs", "not-an-array", "checkpoint_artifactrefs_not_array"],
  ["decisions", {}, "checkpoint_decisions_not_array"],
  ["risks", {}, "checkpoint_risks_not_array"],
  ["nextActions", ["valid", 42], "checkpoint_nextactions_1_not_string"],
];
for (const [field, value, errorCode] of malformedPayloadCases) {
  const malformedCheckpoint = buildResidentContextCheckpoint({
    request,
    residentOutput: JSON.stringify({
      ...residentPayload,
      [field]: value,
    }),
  });
  assert.equal(malformedCheckpoint.state, "resident_output_invalid", field);
  assert(malformedCheckpoint.validationErrors.includes(errorCode), `${field}: ${malformedCheckpoint.validationErrors.join(", ")}`);
}

const malformedNestedCheckpoint = buildResidentContextCheckpoint({
  request,
  residentOutput: JSON.stringify({
    ...residentPayload,
    decisions: [{ summary: "Decision", reason: 42, source: "resident" }],
  }),
});
assert.equal(malformedNestedCheckpoint.state, "resident_output_invalid");
assert(malformedNestedCheckpoint.validationErrors.includes("checkpoint_decisions_0_reason_not_string"));

assertThrowsMessage(() => validateResidentContextCheckpoint({
  ...checkpoint,
  providerCompactionAllowed: true,
}), "resident_context_checkpoint_authority_leak");

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "direct-resident-checkpoint-"));
const threadStore = new DirectThreadStore({
  rootDir,
  mode: "index_only",
});

try {
  const persisted = persistResidentContextCheckpoint({
    threadStore,
    request,
    checkpoint,
    nowMs: 0,
  });
  assert.equal(persisted.checkpoint.state, "persisted");
  assert.equal(persisted.operation.operationType, "resident_context_checkpoint");
  const latest = threadStore.readContextMaintenanceArtifact(projectId, threadId, "resident-checkpoint-latest.json");
  assert.equal(latest.schema, DIRECT_RESIDENT_CONTEXT_CHECKPOINT_SCHEMA);
  assert.equal(latest.state, "persisted");
  assert.equal(latest.checkpointId, persisted.checkpoint.checkpointId);

  const report = buildResidentContextCheckpointReport({
    request,
    checkpoint,
    persisted: persisted.checkpoint,
    nowMs: 0,
  });
  assert.equal(report.schema, DIRECT_RESIDENT_CONTEXT_CHECKPOINT_REPORT_SCHEMA);
  assert.equal(report.status, "pass");
  assert.equal(report.providerCompactionUsed, false);
  assert.equal(report.automaticContextMutationUsed, false);
  assert(report.assertions.every((assertion) => assertion.passed ? assertion.blockerCode === "" : true));

  const authorityLeakReport = buildResidentContextCheckpointReport({
    request,
    checkpoint: {
      ...checkpoint,
      automaticContextMutationAllowed: true,
    },
    nowMs: 0,
  });
  assert.equal(authorityLeakReport.status, "fail");
  assert.equal(
    authorityLeakReport.assertions.find((assertion) => assertion.assertionId === "no_context_mutation_authority")?.blockerCode,
    "checkpoint_authority_leak",
  );

  const serialized = JSON.stringify({ request, checkpoint, persisted, report });
  assert(!serialized.includes("\"providerCompactionAllowed\":true"));
  assert(!serialized.includes("\"automaticContextMutationAllowed\":true"));
  assert(!serialized.includes("\"rawResidentOutputIncluded\":true"));

  console.log(JSON.stringify({
    ok: true,
    requestId: request.requestId,
    checkpointId: persisted.checkpoint.checkpointId,
    state: persisted.checkpoint.state,
    operationType: persisted.operation.operationType,
    reportStatus: report.status,
  }, null, 2));
} finally {
  threadStore.close();
  fs.rmSync(rootDir, { recursive: true, force: true });
}
