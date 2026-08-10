import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  compileRoleLedgerToolBundle,
  decideLedgerToolCall,
  operationRegistry,
  validateRoleLedgerToolBundle,
} = require("../src/main/direct/worldmanager/ledger-tool-compiler.js");

const ref = (kind, id) => ({
  kind,
  id,
  digest: `sha256:${id}`,
});
const now = () => Date.parse("2026-08-01T12:00:00.000Z");
const common = {
  scope: {
    kind: "project",
    userWorldId: "user_world_local",
    projectId: "project_alpha",
  },
  actorRef: ref("agent", "agent_alpha"),
  agentWorldRef: ref("agent_world", "agent_world_alpha"),
  authorityBoundaryRef: ref("authority_boundary", "authority_alpha"),
  now,
};

const registry = operationRegistry({ now });
assert.equal(registry.unrestrictedWriteAvailable, false);
assert.equal(registry.operations.some((row) => row.operationName === "ledger_write"), false);

const worker = compileRoleLedgerToolBundle({
  ...common,
  roleLane: "implementation_worker",
  canonicalAdmissionEnabled: false,
});
validateRoleLedgerToolBundle(worker, registry);
assert.equal(worker.operationNames.includes("ledger_submit_candidate_artifact"), true);
assert.equal(worker.operationNames.includes("ledger_admit_canonical"), false);
assert.equal(worker.operationNames.includes("ledger_submit_audit_verdict"), false);

const auditor = compileRoleLedgerToolBundle({
  ...common,
  roleLane: "review_auditor",
});
assert.equal(auditor.operationNames.includes("ledger_submit_audit_verdict"), true);
assert.equal(auditor.operationNames.includes("ledger_submit_candidate_artifact"), false);

const managerWithoutAdmission = compileRoleLedgerToolBundle({
  ...common,
  roleLane: "world_manager",
  canonicalAdmissionEnabled: false,
});
assert.equal(managerWithoutAdmission.operationNames.includes("ledger_admit_canonical"), false);

const manager = compileRoleLedgerToolBundle({
  ...common,
  roleLane: "world_manager",
  canonicalAdmissionEnabled: true,
});
assert.equal(manager.operationNames.includes("ledger_admit_canonical"), true);

const workerCall = decideLedgerToolCall({
  bundle: worker,
  registry,
  operationName: "ledger_propose_claim",
  arguments: {
    subjectScope: common.scope,
    semanticPayload: { claimType: "open_vocabulary", claim: "Candidate interpretation." },
    rendererSafeSummary: "Candidate interpretation proposed.",
    idempotencyKey: "worker-proposal-1",
    expectedRevisionVector: [
      {
        scopeKind: "project",
        scopeId: "project_alpha",
        revision: 4,
        digest: "sha256:project-alpha-r4",
      },
    ],
    evidenceRefs: [ref("test_evidence", "test_1")],
  },
  currentRevisionByScope: {
    "project:project_alpha": {
      revision: 4,
      digest: "sha256:project-alpha-r4",
    },
  },
  visibleEvidenceRefs: [ref("test_evidence", "test_1")],
});
assert.equal(workerCall.allowed, true);
assert.equal(workerCall.semanticContentValidated, false);

const staleCall = decideLedgerToolCall({
  bundle: worker,
  registry,
  operationName: "ledger_propose_claim",
  arguments: {
    subjectScope: common.scope,
    semanticPayload: { claim: "Stale candidate." },
    rendererSafeSummary: "Stale candidate.",
    idempotencyKey: "worker-proposal-stale",
    expectedRevisionVector: [
      {
        scopeKind: "project",
        scopeId: "project_alpha",
        revision: 3,
        digest: "sha256:project-alpha-r3",
      },
    ],
  },
  currentRevisionByScope: {
    "project:project_alpha": {
      revision: 4,
      digest: "sha256:project-alpha-r4",
    },
  },
});
assert.equal(staleCall.allowed, false);
assert.equal(staleCall.blockerCodes.includes("stale_revision:project:project_alpha"), true);

const unknownRevisionCall = decideLedgerToolCall({
  bundle: worker,
  registry,
  operationName: "ledger_propose_claim",
  arguments: {
    subjectScope: common.scope,
    semanticPayload: { claim: "Revision source is unavailable." },
    rendererSafeSummary: "Revision source is unavailable.",
    idempotencyKey: "worker-proposal-unknown-revision",
    expectedRevisionVector: [{
      scopeKind: "project",
      scopeId: "project_alpha",
      revision: 4,
      digest: "sha256:project-alpha-r4",
    }],
  },
  currentRevisionByScope: {},
  visibleEvidenceRefs: [],
});
assert.equal(unknownRevisionCall.allowed, false);
assert.equal(
  unknownRevisionCall.blockerCodes.includes(
    "revision_unknown:project:project_alpha",
  ),
  true,
);

const invisibleEvidenceCall = decideLedgerToolCall({
  bundle: worker,
  registry,
  operationName: "ledger_propose_claim",
  arguments: {
    subjectScope: common.scope,
    semanticPayload: { claim: "Invisible evidence must not be cited." },
    rendererSafeSummary: "Invisible evidence citation rejected.",
    idempotencyKey: "worker-proposal-invisible-evidence",
    evidenceRefs: [ref("test_evidence", "not_visible")],
  },
  currentRevisionByScope: {},
  visibleEvidenceRefs: [],
});
assert.equal(invisibleEvidenceCall.allowed, false);
assert.equal(
  invisibleEvidenceCall.blockerCodes.includes(
    "evidence_not_visible:not_visible",
  ),
  true,
);

const crossProjectCall = decideLedgerToolCall({
  bundle: worker,
  registry,
  operationName: "ledger_propose_claim",
  arguments: {
    subjectScope: {
      kind: "project",
      userWorldId: "user_world_local",
      projectId: "project_beta",
    },
    semanticPayload: { claim: "Wrong project." },
    rendererSafeSummary: "Wrong project.",
    idempotencyKey: "worker-proposal-cross-project",
  },
});
assert.equal(crossProjectCall.allowed, false);
assert.equal(crossProjectCall.blockerCodes.includes("subject_scope_outside_compiled_boundary"), true);

const noAuthorityReceipt = decideLedgerToolCall({
  bundle: manager,
  registry,
  operationName: "ledger_admit_canonical",
  arguments: {
    subjectScope: common.scope,
    semanticPayload: { deltaRef: "delta_1" },
    rendererSafeSummary: "Attempt canonical admission.",
    idempotencyKey: "manager-admit-1",
  },
  externalAuthorityReceiptPresent: false,
});
assert.equal(noAuthorityReceipt.allowed, false);
assert.equal(noAuthorityReceipt.blockerCodes.includes("external_authority_receipt_required"), true);

const daemon = compileRoleLedgerToolBundle({
  ...common,
  roleLane: "headless_daemon",
});
assert.deepEqual(
  daemon.operationNames.sort(),
  ["ledger_ack_delivery", "ledger_publish_mechanical_witness"],
);

console.log(JSON.stringify({
  schema: "direct_world_manager_ledger_tool_compiler_regression@1",
  status: "passed",
  operationCount: registry.operations.length,
  workerOperationCount: worker.operationNames.length,
  auditorOperationCount: auditor.operationNames.length,
  managerAdmissionGuarded: true,
  staleRevisionGuarded: true,
  unknownRevisionGuarded: true,
  evidenceVisibilityClosedWorld: true,
  crossProjectGuarded: true,
}, null, 2));
