#!/usr/bin/env node

import assert from "node:assert/strict";

import {
  assertContextPacketPreviewSafe,
  buildContextPacketPreview,
} from "../src/main/direct/context/preview-workbench.js";
import {
  assertDirectSettingsSurfaceRendererSafe,
  buildDirectSettingsSurfaceProjection,
} from "../src/main/direct/ui/settings-surface.js";
import {
  buildDirectInformationBridgeAudit,
} from "../src/main/direct/bridge/information-registry.js";

function sourceRow(sourceClass, sourceId, overrides = {}) {
  return {
    sourceClass,
    sourceId,
    label: `${sourceClass}:${sourceId}`,
    includedInRequest: sourceClass !== "omission_witness",
    tokenEstimate: 10,
    sizeBytes: 100,
    retentionLaw: "fixture_retention",
    evidenceRefs: [{ kind: "fixture", digest: `${sourceClass}_${sourceId}`, label: "fixture evidence" }],
    ...overrides,
  };
}

const readyPreview = buildContextPacketPreview({
  projectId: "project_direct",
  workThreadId: "work_thread_bridge",
  threadId: "thread_direct",
  nowMs: 0,
  recentDialogue: [sourceRow("recent_dialogue", "dialogue_1", { required: true })],
  durableMemory: [sourceRow("durable_memory", "memory_1")],
  frontierBaton: [sourceRow("frontier_baton", "baton_1")],
  attachments: [sourceRow("attachment", "attachment_1")],
  moduleContextContributions: [sourceRow("module_context", "module_1")],
  toolResultRefs: [sourceRow("tool_result_ref", "tool_1")],
  omissionRows: [sourceRow("omission_witness", "omission_1", {
    includedInRequest: false,
    omissionReason: "trimmed_old_dialogue",
  })],
  contextPack: {
    sourceArtifacts: [
      { artifactKind: "durable_thread_memory", artifactId: "memory_artifact", artifactDigest: "digest_memory_artifact", evidenceRefs: [{}] },
      { artifactKind: "frontier_baton", artifactId: "baton_artifact", artifactDigest: "digest_baton_artifact" },
      { artifactKind: "context_omission_ledger", artifactId: "omission_artifact", artifactDigest: "digest_omission_artifact" },
      { artifactKind: "tool_continuation_context_projection", artifactId: "tool_artifact", artifactDigest: "digest_tool_artifact" },
    ],
    sourceProjections: [
      { projectionKind: "context_projection", projectionId: "projection_artifact", projectionDigest: "digest_projection_artifact" },
    ],
  },
});

assert.equal(readyPreview.schema, "direct_context_packet_preview@1");
assert.equal(readyPreview.previewState, "ready");
assert.equal(readyPreview.generatedAt, "1970-01-01T00:00:00.000Z");
assert.equal(readyPreview.counts.rowCount, 12);
assert.equal(readyPreview.counts.includedSourceCount, 10);
assert.equal(readyPreview.counts.omittedSourceCount, 2);
assert.equal(readyPreview.downstreamRequestConstraints.requestAssemblyAllowed, true);
assert.equal(readyPreview.authority.providerTransportAllowed, false);
assert.equal(readyPreview.authority.requestAssemblyAuthorityGranted, false);
assert.equal(readyPreview.authority.previewEditingAllowed, false);
assertContextPacketPreviewSafe(readyPreview);

const sourceClasses = Object.keys(readyPreview.counts.bySourceClass).sort();
assert.deepEqual(sourceClasses, [
  "attachment",
  "durable_memory",
  "frontier_baton",
  "module_context",
  "omission_witness",
  "recent_dialogue",
  "tool_result_ref",
]);
assert.equal(
  readyPreview.sourceRows.find((row) => row.sourceId === "memory_artifact").evidenceRefs.length,
  0,
  "empty evidence refs should not be retained as noisy default refs",
);

const repeatReadyPreview = buildContextPacketPreview({
  projectId: "project_direct",
  workThreadId: "work_thread_bridge",
  threadId: "thread_direct",
  nowMs: 0,
  recentDialogue: [sourceRow("recent_dialogue", "dialogue_1", { required: true })],
});
const repeatReadyPreviewAgain = buildContextPacketPreview({
  projectId: "project_direct",
  workThreadId: "work_thread_bridge",
  threadId: "thread_direct",
  nowMs: 0,
  recentDialogue: [sourceRow("recent_dialogue", "dialogue_1", { required: true })],
});
assert.equal(repeatReadyPreview.previewDigest, repeatReadyPreviewAgain.previewDigest, "nowMs should make preview digest deterministic for identical input");

const blockedPreview = buildContextPacketPreview({
  projectId: "project_direct",
  workThreadId: "work_thread_bridge",
  threadId: "thread_direct",
  nowMs: 0,
  recentDialogue: [
    sourceRow("recent_dialogue", "missing_required", { required: true, missing: true }),
    sourceRow("recent_dialogue", "stale_required", { required: true, stale: true }),
    sourceRow("recent_dialogue", "unsafe", { rawExposureUnsafe: true }),
  ],
  contextPack: {
    sourceArtifacts: [
      { artifactKind: "context_projection", artifactId: "raw_exposed_projection", rawPathExposed: true },
    ],
  },
}, { omissionRequired: true });

assert.equal(blockedPreview.previewState, "blocked_from_request");
assert.equal(blockedPreview.downstreamRequestConstraints.requestAssemblyAllowed, false);
assert.equal(blockedPreview.downstreamRequestConstraints.providerCallBlocked, true);
assert(blockedPreview.downstreamRequestConstraints.blockerCodes.includes("required_source_missing"));
assert(blockedPreview.downstreamRequestConstraints.blockerCodes.includes("required_source_stale"));
assert(blockedPreview.downstreamRequestConstraints.blockerCodes.includes("raw_exposure_unsafe"));
assert(blockedPreview.downstreamRequestConstraints.blockerCodes.includes("required_omission_witness_missing"));
assert.equal(blockedPreview.counts.rawExposureUnsafeCount, 2);
assertContextPacketPreviewSafe(blockedPreview);

const settingsProjection = buildDirectSettingsSurfaceProjection({
  projectId: "project_direct",
  contextPreview: blockedPreview,
  registryAudit: buildDirectInformationBridgeAudit({ generatedAt: "2026-06-14T00:00:00.000Z" }),
});

assertDirectSettingsSurfaceRendererSafe(settingsProjection);
assert(settingsProjection.bridgeOrgans.includes("context_packet_preview"));
assert.equal(settingsProjection.sections.contextPreview.available, true);
assert.equal(settingsProjection.sections.contextPreview.previewState, "blocked_from_request");
assert.equal(settingsProjection.sections.contextPreview.requestAssemblyBlocked, true);
assert.equal(settingsProjection.sections.contextPreview.providerTransportAllowed, false);
assert.equal(settingsProjection.sections.contextPreview.workspaceMutationAllowed, false);
assert.equal(settingsProjection.rows.contextPreview.some((row) => row.label === "Authority" && row.value === "display only"), true);
assert(settingsProjection.evidenceRefs.some((ref) => ref.kind === "context_packet_preview" && ref.digest));

const audit = buildDirectInformationBridgeAudit({ generatedAt: "2026-06-14T00:00:00.000Z" });
const previewRegistryRow = audit.rows.find((row) => row.id === "ic3.context-packet-preview-workbench");
assert(previewRegistryRow, "context preview registry row should exist");
assert.equal(previewRegistryRow.role, "context_construction");
assert.equal(previewRegistryRow.implementationState, "partial");
assert.equal(previewRegistryRow.directPathPosture, "keep_guarded");
assert.equal(audit.summary.valid, true);

console.log(JSON.stringify({
  ok: true,
  readyPreviewState: readyPreview.previewState,
  blockedPreviewState: blockedPreview.previewState,
  registryRows: audit.summary.totalRows,
  contextPreviewRows: settingsProjection.rows.contextPreview.length,
}, null, 2));
