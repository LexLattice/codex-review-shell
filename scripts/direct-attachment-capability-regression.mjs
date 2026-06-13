#!/usr/bin/env node

import { strict as assert } from "node:assert";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  assertDirectAttachmentCapabilityProjectionSafe,
  assertDirectAttachmentSubmitPacketSafe,
  buildDirectAttachmentCapabilityProjection,
  buildDirectAttachmentProviderPrompt,
  buildDirectAttachmentReferenceBlock,
  buildDirectAttachmentSubmitPacket,
} = require("../src/main/direct/attachments/capability");

const projectId = "project_direct_attachment_capability";

const capability = buildDirectAttachmentCapabilityProjection({
  projectId,
  runtimeKind: "direct-live-text",
  status: "ready",
  generatedAt: "2026-06-13T12:00:00.000Z",
});

assertDirectAttachmentCapabilityProjectionSafe(capability);
assert.equal(capability.schema, "direct_attachment_capability_projection@1");
assert.equal(capability.canConsumeProviderFilePayload, false);
assert.equal(capability.canConsumeProviderImagePayload, false);
assert.equal(capability.canConsumeWorkspaceFileReference, true);
assert.equal(capability.canConsumeStagedFileReference, true);
assert.equal(capability.canConsumeTextReference, true);

const workspaceDraft = {
  id: "att_workspace",
  projectId,
  status: "ready",
  kind: "file",
  displayName: "notes.md",
  mimeType: "text/markdown",
  sizeBytes: 120,
  workspaceRelPath: "docs/notes.md",
  workspaceEvidenceKey: "workspace:abc",
  sourcePathEvidenceKey: "source-path:abc",
  provider: {
    disposition: "workspace_file_reference",
    capabilityEvidenceState: "profile_declared",
  },
};

const stagedImageDraft = {
  id: "att_staged_image",
  projectId,
  status: "ready",
  kind: "image",
  displayName: "diagram.png",
  mimeType: "image/png",
  sizeBytes: 4096,
  stagedRelPath: ".codex/review-shell/attachments/att_staged_image/diagram.png",
  stagedPathEvidenceKey: "staged-path:def",
  workspaceEvidenceKey: "workspace:abc",
  provider: {
    disposition: "staged_file_reference",
    capabilityEvidenceState: "profile_declared",
  },
};

const packet = buildDirectAttachmentSubmitPacket({
  projectId,
  surfaceId: "codex",
  turnClientId: "client_turn_attachment",
  text: "review these",
  attachments: [workspaceDraft, stagedImageDraft],
  capabilityProjection: capability,
  createdAt: "2026-06-13T12:00:01.000Z",
});

assertDirectAttachmentSubmitPacketSafe(packet);
assert.equal(packet.schema, "direct_attachment_submit_packet@1");
assert.equal(packet.status, "ready");
assert.equal(packet.attachmentCount, 2);
assert.equal(packet.summary.workspaceRefCount, 1);
assert.equal(packet.summary.stagedRefCount, 1);
assert.equal(packet.summary.providerPayloadCount, 0);
assert.equal(packet.summary.unsupportedCount, 0);
assert(packet.dispositions.some((row) => row.draftId === "att_workspace" && row.disposition === "workspace_ref"));
assert(packet.dispositions.some((row) => row.draftId === "att_staged_image" && row.disposition === "staged_ref"));
assert(packet.transcriptWitnesses.every((row) => row.submitState === "submitted_as_reference"));
assert.equal(packet.rawExternalPathsIncluded, false);
assert.equal(packet.rawClipboardBytesIncluded, false);
assert.equal(packet.rawPayloadIncluded, false);
assert.equal(packet.rawPathIncluded, false);

const referenceBlock = buildDirectAttachmentReferenceBlock(packet);
assert(referenceBlock.includes("docs/notes.md"));
assert(referenceBlock.includes("diagram.png"));
assert(referenceBlock.includes("[workspace_ref]"));
assert(referenceBlock.includes("[staged_ref]"));

const providerPrompt = buildDirectAttachmentProviderPrompt("Review these attachments.", packet);
assert(providerPrompt.includes("Review these attachments."));
assert(providerPrompt.includes("docs/notes.md"));
assert(providerPrompt.includes(".codex/review-shell/attachments/att_staged_image/diagram.png"));
const alreadyExpandedPrompt = buildDirectAttachmentProviderPrompt(providerPrompt, packet);
assert.equal(alreadyExpandedPrompt, providerPrompt, "provider prompt must not duplicate attachment refs");

const blocked = buildDirectAttachmentSubmitPacket({
  projectId,
  turnClientId: "client_turn_blocked",
  attachments: [{
    id: "att_missing_ref",
    status: "ready",
    kind: "file",
    displayName: "missing.bin",
    mimeType: "application/octet-stream",
    sizeBytes: 10,
  }],
  capabilityProjection: capability,
});

assertDirectAttachmentSubmitPacketSafe(blocked);
assert.equal(blocked.status, "blocked");
assert.equal(blocked.summary.unsupportedCount, 1);
assert.equal(blocked.transcriptWitnesses[0].submitState, "blocked_before_submit");

console.log(JSON.stringify({
  ok: true,
  capability: capability.schema,
  packet: packet.schema,
  dispositions: packet.dispositions.map((row) => row.disposition),
  blockedStatus: blocked.status,
}, null, 2));
