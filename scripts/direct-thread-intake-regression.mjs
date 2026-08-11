#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DIRECT_THREAD_INTAKE_LINEAGE_SCHEMA,
  DIRECT_THREAD_INTAKE_PROJECTION_SCHEMA,
  assertDirectThreadIntakeProjectionSafe,
  buildDirectThreadIntakeLineage,
  buildDirectThreadIntakeProjection,
} = require("../src/main/direct/import/thread-intake.js");
const {
  RUG008_PROMOTED_SCOPE,
  buildCheckpointContinuationEvidenceScope,
  resolvePromotedCheckpointContinuationEvidence,
} = require("../src/main/direct/import/checkpoint-continuation-evidence.js");
const { buildImportCandidate } = require("../src/main/direct/import/codex-jsonl-import.js");
const { rendererSafeMaterializationResult } = require("../src/main/direct/import/import-controller.js");

const source = {
  sourceState: "materialized",
  importId: "import_dw_i1",
  sourceClass: "codex-cli-jsonl",
  sourceDisplayName: "rollout-2026-08-11.jsonl",
  sourceRootDisplayName: "sessions",
  providerThreadId: "thread_provider_original",
  timestampStart: "2026-08-11T08:00:00.000Z",
  timestampEnd: "2026-08-11T09:00:00.000Z",
  recordCount: 42,
  importState: "checkpoint-validated",
  recoveryState: "healthy",
  materializedSessionId: "session_imported_readonly",
  checkpointEligible: true,
};

const workspaceMatch = {
  status: "matched",
  confidence: "high",
  matchMethod: "user-confirmed",
};

const windowsProject = {
  id: "project_windows_context_menu",
  workspace: {
    kind: "windows",
    windowsPath: "C:\\Work\\ContextMenu",
    label: "Native Windows checkout",
  },
};

const appServerProjection = buildDirectThreadIntakeProjection({
  project: windowsProject,
  source,
  workspaceMatch,
  runtime: {
    transport: "codex-app-server",
    runtimePath: "app-server",
    projectBound: true,
    providerResumeCapability: true,
    providerReadCapability: true,
    freshDirectCapability: false,
    evidenceState: "active_runtime_projection",
  },
  freshContinuationBlockReason: "live_text_unavailable",
  generatedAt: "2026-08-11T10:00:00.000Z",
});

assert.equal(appServerProjection.schema, DIRECT_THREAD_INTAKE_PROJECTION_SCHEMA);
assert.equal(appServerProjection.controlPlane, "direct-thread");
assert.equal(appServerProjection.projectSubstrateBinding.workspaceKind, "windows");
assert.equal(appServerProjection.projectSubstrateBinding.environmentId, "env_windows_native");
assert.equal(appServerProjection.projectSubstrateBinding.inheritedByFreshThread, true);
assert.equal(appServerProjection.projectSubstrateBinding.operatorMutableInThisAction, false);
assert.equal(appServerProjection.modes.resumeOriginalThread.enabled, true);
assert.equal(appServerProjection.modes.resumeOriginalThread.identityDisposition, "preserve_provider_thread_identity");
assert.equal(appServerProjection.modes.resumeOriginalThread.runtimeVerification, "provider_verifies_thread_on_execution");
assert.equal(appServerProjection.modes.continueInFreshDirectThread.enabled, false);
assert(appServerProjection.modes.continueInFreshDirectThread.blockerCodes.includes("direct_runtime_required"));
assert.equal(assertDirectThreadIntakeProjectionSafe(appServerProjection), true);
assert.equal(JSON.stringify(appServerProjection).includes("C:\\Work"), false);

const directProjection = buildDirectThreadIntakeProjection({
  project: {
    id: "project_wsl_dev",
    workspace: {
      kind: "wsl",
      distro: "Ubuntu",
      linuxPath: "/home/rose/work/project",
      label: "WSL development checkout",
    },
  },
  source,
  workspaceMatch,
  runtime: {
    transport: "direct-live-text",
    runtimePath: "direct-implementation",
    projectBound: true,
    providerResumeCapability: false,
    providerReadCapability: true,
    freshDirectCapability: true,
    evidenceState: "active_runtime_projection",
  },
  freshContinuationBlockReason: "",
  generatedAt: "2026-08-11T10:00:00.000Z",
});

assert.equal(directProjection.projectSubstrateBinding.workspaceKind, "wsl");
assert.equal(directProjection.projectSubstrateBinding.environmentId, "env_wsl_native");
assert.equal(directProjection.modes.resumeOriginalThread.enabled, false);
assert(directProjection.modes.resumeOriginalThread.blockerCodes.includes("app_server_runtime_required"));
assert.equal(directProjection.modes.continueInFreshDirectThread.enabled, true);
assert.equal(directProjection.modes.continueInFreshDirectThread.identityDisposition, "create_new_direct_thread_identity");
assert.equal(directProjection.authorityBoundary.importedApprovalsCarryAuthority, false);
assert.equal(directProjection.authorityBoundary.importedToolCallsReplayable, false);
assert.equal(directProjection.authorityBoundary.worldManagerAdmissionPerformed, false);

const lineage = buildDirectThreadIntakeLineage(directProjection, "transplant_into_fresh_direct_thread");
assert.equal(lineage.schema, DIRECT_THREAD_INTAKE_LINEAGE_SCHEMA);
assert.equal(lineage.mode, "transplant_into_fresh_direct_thread");
assert.equal(lineage.source.providerThreadId, "thread_provider_original");
assert.equal(lineage.identityDisposition, "create_new_direct_thread_identity");
assert.equal(lineage.projectSubstrateBinding.environmentId, "env_wsl_native");
assert.equal(lineage.importedAuthorityInherited, false);
assert.match(lineage.lineageDigest, /^[a-f0-9]{64}$/);

const selectedOnly = buildDirectThreadIntakeProjection({
  project: windowsProject,
  source: {
    sourceState: "selected",
    handleId: "source_handle",
    sourceDisplayName: "selected.jsonl",
    providerThreadId: "thread_provider_original",
  },
  workspaceMatch,
  runtime: {
    transport: "codex-app-server",
    runtimePath: "app-server",
    projectBound: true,
    providerResumeCapability: true,
  },
  freshContinuationBlockReason: "read_only_import_required",
});
assert.equal(selectedOnly.modes.resumeOriginalThread.enabled, true);
assert.equal(selectedOnly.modes.continueInFreshDirectThread.enabled, false);
assert(selectedOnly.modes.continueInFreshDirectThread.blockerCodes.includes("read_only_import_required"));

const syntheticIdentityCandidate = buildImportCandidate([
  { timestamp: "2026-08-11T08:00:00.000Z", message: { role: "user", content: "No provider id." } },
  { timestamp: "2026-08-11T08:01:00.000Z", message: { role: "assistant", content: "Still no provider id." } },
], { sourceFileSha256: "a".repeat(64) });
assert.match(syntheticIdentityCandidate.source.threadId, /^thread_/);
assert.equal(syntheticIdentityCandidate.source.providerThreadId, "");
assert.equal(syntheticIdentityCandidate.source.providerThreadIdProvenance, "unavailable");
const syntheticResumeProjection = buildDirectThreadIntakeProjection({
  project: windowsProject,
  source: {
    ...source,
    threadId: syntheticIdentityCandidate.source.threadId,
    providerThreadId: syntheticIdentityCandidate.source.providerThreadId,
  },
  workspaceMatch,
  runtime: {
    transport: "codex-app-server",
    projectBound: true,
    providerResumeCapability: true,
  },
});
assert.equal(syntheticResumeProjection.modes.resumeOriginalThread.enabled, false);
assert(syntheticResumeProjection.modes.resumeOriginalThread.blockerCodes.includes("provider_thread_identity_missing"));

const providerIdentityCandidate = buildImportCandidate([
  { timestamp: "2026-08-11T08:00:00.000Z", thread_id: "provider_thread_1", message: { role: "user", content: "Provider id." } },
], { sourceFileSha256: "b".repeat(64) });
assert.equal(providerIdentityCandidate.source.providerThreadId, "provider_thread_1");
assert.equal(providerIdentityCandidate.source.providerThreadIdProvenance, "source_record");
assert.equal(providerIdentityCandidate.source.providerThreadIdDurable, true);

const ambiguousProviderIdentityCandidate = buildImportCandidate([
  { timestamp: "2026-08-11T08:00:00.000Z", thread_id: "provider_thread_1", message: { role: "user", content: "First id." } },
  { timestamp: "2026-08-11T08:01:00.000Z", thread_id: "provider_thread_2", message: { role: "assistant", content: "Second id." } },
], { sourceFileSha256: "c".repeat(64) });
assert.equal(ambiguousProviderIdentityCandidate.source.providerThreadId, "");
assert.equal(ambiguousProviderIdentityCandidate.source.providerThreadIdProvenance, "ambiguous_source_records");
assert.equal(ambiguousProviderIdentityCandidate.source.providerThreadIdDurable, false);

const unsafeMaterialization = {
  schema: "direct_codex_materialized_import_session@1",
  sessionId: "safe_session",
  turnId: "safe_turn",
  importState: "checkpoint-validated",
  materializationKind: "readonly-transcript",
  readOnlyImported: true,
  nativeDirectSession: false,
  continuationEligible: true,
  session: {
    sessionId: "safe_session",
    title: "Imported transcript",
    importState: "checkpoint-validated",
    importLineage: { importId: "safe_import" },
    importSource: {
      sourcePath: "/private/raw/source.jsonl",
      sourceFileSha256: "secret_hash",
      sourceDisplayName: "source.jsonl",
    },
    directImportCheckpoint: { validationReport: { warnings: [], blockers: [], gates: {} } },
    messages: [{ items: [{ type: "agentMessage", text: "Safe projected text", rawRecord: { secret: true } }] }],
  },
  turn: { raw: "private" },
};
const safeMaterialization = rendererSafeMaterializationResult(unsafeMaterialization);
assert.equal(safeMaterialization.importId, "safe_import");
assert.equal(safeMaterialization.rendererSafeSession.transcriptItems[0].text, "Safe projected text");
assert.equal(JSON.stringify(safeMaterialization).includes("/private/raw/source.jsonl"), false);
assert.equal(JSON.stringify(safeMaterialization).includes("secret_hash"), false);
assert.equal(JSON.stringify(safeMaterialization).includes('"raw"'), false);

const sampleEvidenceScope = buildCheckpointContinuationEvidenceScope({
  profileDoc: {
    summary: {
      schema: "direct_codex_odeu_profile@1",
      profileId: "test_profile",
      backendContractVersion: "test_contract@1",
    },
  },
  credentials: { authMode: "chatgpt", accountId: "account_fixture" },
  model: "gpt-5.4",
});
const matchingEvidence = resolvePromotedCheckpointContinuationEvidence(sampleEvidenceScope, sampleEvidenceScope);
assert.equal(matchingEvidence.accepted, true);
assert.equal(matchingEvidence.rawAccountIdentityExposed, false);
assert.equal(JSON.stringify(matchingEvidence).includes("account_fixture"), false);
for (const field of Object.keys(sampleEvidenceScope)) {
  const mismatch = resolvePromotedCheckpointContinuationEvidence(
    { ...sampleEvidenceScope, [field]: `different_${field}` },
    sampleEvidenceScope,
  );
  assert.equal(mismatch.accepted, false, `${field} mismatch must fail closed`);
  assert(mismatch.mismatchedFields.includes(field));
}
assert.equal(RUG008_PROMOTED_SCOPE.requestShapeHash, "b5ca37664b0622ae6e9207aa810363f8f24e05a71e893f88c2dc28d33c55db9b");

assert.throws(
  () => buildDirectThreadIntakeLineage(appServerProjection, "transplant_into_fresh_direct_thread"),
  (error) => error?.code === "direct_runtime_required",
);

console.log("Direct thread intake regression passed.");
