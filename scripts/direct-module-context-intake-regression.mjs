#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  assertDirectModuleContextIntakeSafe,
  buildDirectModuleContextIntake,
} = require("../src/main/direct/bridge/module-context-intake");
const {
  assertContextPacketPreviewSafe,
  buildContextPacketPreview,
} = require("../src/main/direct/context/preview-workbench");
const {
  assertDirectSettingsSurfaceRendererSafe,
  buildDirectSettingsSurfaceProjection,
} = require("../src/main/direct/ui/settings-surface");
const {
  buildDirectInformationBridgeAudit,
} = require("../src/main/direct/bridge/information-registry");

const projectId = "project_direct";
const workThreadId = "work_thread_module_context";
const threadId = "thread_module_context";

const intake = buildDirectModuleContextIntake({
  projectId,
  workThreadId,
  threadId,
  nowMs: 0,
  contextContributions: [
    {
      rowId: "skill_context_a",
      moduleId: "skill_domain_loader",
      moduleKind: "skill",
      sourceScope: "work_thread",
      title: "Domain ontology loading notes",
      rendererSafeSummary: "Bounded HOB loading notes for this WorkThread.",
      tokenEstimate: 42,
      evidenceRefs: [{ kind: "skill_context_ref", artifactId: "domain_loader_notes", artifactDigest: "digest_skill_context" }],
    },
    {
      rowId: "skill_pending_review",
      moduleId: "skill_pending",
      moduleKind: "skill",
      sourceScope: "work_thread",
      state: "pending_review",
      title: "Pending context note",
    },
  ],
  importedEvidenceRows: [
    {
      rowId: "connector_review_evidence",
      moduleId: "connector_github_review",
      moduleKind: "connector",
      sourceScope: "work_thread",
      title: "Imported review finding",
      rendererSafeSummary: "Connector supplied a bounded review finding.",
      tokenEstimate: 12,
      evidenceRefs: [{ kind: "review_comment", artifactId: "comment_1", artifactDigest: "digest_review_comment" }],
    },
  ],
  blockedRows: [
    {
      rowId: "blocked_raw_hook",
      moduleId: "hook_bad_actor",
      moduleKind: "hook",
      sourceScope: "work_thread",
      title: "Blocked raw hook proposal",
      rawPayloadIncluded: true,
      hookExecutionAllowed: true,
    },
    {
      rowId: "blocked_unbound",
      moduleId: "skill_unbound",
      moduleKind: "skill",
      sourceScope: "project",
      workThreadId: "",
      title: "Missing WorkThread binding",
    },
  ],
});

assert.equal(intake.schema, "direct_module_context_intake@1");
assert.equal(intake.generatedAt, "1970-01-01T00:00:00.000Z");
assert.equal(intake.intakeState, "blocked");
assert.equal(intake.counts.rowCount, 5);
assert.equal(intake.counts.acceptedRowCount, 2);
assert.equal(intake.counts.pendingReviewRowCount, 1);
assert.equal(intake.counts.blockedRowCount, 2);
assert.equal(intake.counts.importedEvidenceRowCount, 1);
assert.equal(intake.counts.contextEligibleRowCount, 2);
assert.equal(intake.counts.acceptedContextPreviewRowCount, 2);
assert.equal(intake.counts.rawExposureUnsafeCount, 1);
assert.equal(intake.authority.contextPreviewRowsAvailable, true);
assert.equal(intake.authority.contextPacketMutationAllowed, false);
assert.equal(intake.authority.connectorMutationAllowed, false);
assert.equal(intake.authority.hookExecutionAllowed, false);
assert.equal(intake.authority.autoInvocationAllowed, false);
assert.equal(intake.authority.workspaceMutationAllowed, false);
assert.equal(intake.authority.providerTransportAllowed, false);
assert.equal(intake.authority.moduleExecutionAllowed, false);
assertDirectModuleContextIntakeSafe(intake);

const blockedHook = intake.rows.find((row) => row.rowId === "blocked_raw_hook");
assert(blockedHook.blockReasons.includes("raw_exposure_unsafe"));
assert(blockedHook.blockReasons.includes("hook_execution_disabled"));
assert.equal(blockedHook.contextEligible, false);

const preview = buildContextPacketPreview({
  projectId,
  workThreadId,
  threadId,
  nowMs: 0,
  moduleContextIntake: intake,
  recentDialogue: [{
    sourceClass: "recent_dialogue",
    sourceId: "dialogue_seed",
    label: "dialogue seed",
    required: true,
    tokenEstimate: 5,
  }],
});

assert.equal(preview.schema, "direct_context_packet_preview@1");
assert.equal(preview.previewState, "ready");
assert.equal(preview.counts.bySourceClass.module_context, 2);
assert.equal(preview.counts.rowCount, 3);
assert.equal(preview.downstreamRequestConstraints.requestAssemblyAllowed, true);
assertContextPacketPreviewSafe(preview);

const settingsProjection = buildDirectSettingsSurfaceProjection({
  projectId,
  moduleContextIntake: intake,
  contextPreview: preview,
  registryAudit: buildDirectInformationBridgeAudit({ generatedAt: "2026-06-14T00:00:00.000Z" }),
});

assertDirectSettingsSurfaceRendererSafe(settingsProjection);
assert(settingsProjection.bridgeOrgans.includes("module_context_intake"));
assert.equal(settingsProjection.sections.moduleContextIntake.available, true);
assert.equal(settingsProjection.sections.moduleContextIntake.contextEligibleRowCount, 2);
assert.equal(settingsProjection.sections.moduleContextIntake.blockedRowCount, 2);
assert.equal(settingsProjection.sections.moduleContextIntake.providerTransportAllowed, false);
assert.equal(settingsProjection.rows.moduleContextIntake.some((row) => row.label === "Authority" && row.value === "display only"), true);
assert(settingsProjection.evidenceRefs.some((ref) => ref.kind === "module_context_intake" && ref.digest));

const audit = buildDirectInformationBridgeAudit({ generatedAt: "2026-06-14T00:00:00.000Z" });
const intakeRegistryRow = audit.rows.find((row) => row.id === "ic14.module-context-intake");
assert(intakeRegistryRow, "module context intake registry row should exist");
assert.equal(intakeRegistryRow.role, "context_construction");
assert.equal(intakeRegistryRow.implementationState, "partial");
assert.equal(intakeRegistryRow.directPathPosture, "keep_guarded");
assert.equal(audit.summary.totalRows, 37);
assert.equal(audit.summary.byImplementationState.partial, 25);
assert.equal(audit.summary.valid, true);

console.log(JSON.stringify({
  ok: true,
  intakeState: intake.intakeState,
  acceptedContextRows: intake.acceptedContextPreviewRows.length,
  previewModuleContextRows: preview.counts.bySourceClass.module_context,
  registryRows: audit.summary.totalRows,
}, null, 2));
