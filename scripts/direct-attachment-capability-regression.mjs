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

// WSL staged bytes remain references until a workspace-backend payload reader
// is installed; a provider resolver's mere existence cannot grant custody.
const wslCapability = buildDirectAttachmentCapabilityProjection({
  projectId,
  runtimeKind: "direct-live-text",
  workspaceKind: "wsl",
  status: "ready",
  providerAttachmentCapability: {
    file: { supported: true, payloadCustody: "exact", evidenceState: "accepted", sourceDigest: "resolver:wsl" },
    image: { supported: true, payloadCustody: "exact", evidenceState: "accepted", sourceDigest: "resolver:wsl" },
  },
});
assertDirectAttachmentCapabilityProjectionSafe(wslCapability);
assert.equal(wslCapability.canConsumeProviderFilePayload, false);
assert.equal(wslCapability.canConsumeProviderImagePayload, false);
const wslPacket = buildDirectAttachmentSubmitPacket({
  projectId,
  attachments: [{
    id: "att_wsl_staged",
    status: "ready",
    kind: "file",
    displayName: "wsl-notes.md",
    mimeType: "text/markdown",
    stagedRelPath: ".codex/review-shell/attachments/att_wsl_staged/wsl-notes.md",
  }],
  capabilityProjection: wslCapability,
});
assert.equal(wslPacket.dispositions[0].disposition, "staged_ref");
assert.notEqual(wslPacket.dispositions[0].disposition, "provider_payload");

// Active content stays reference-only even when the provider can consume
// exact file/image payloads.
const payloadCapability = buildDirectAttachmentCapabilityProjection({
  projectId,
  status: "ready",
  providerAttachmentCapability: {
    file: { supported: true, payloadCustody: "exact", evidenceState: "accepted", sourceDigest: "resolver:local" },
    image: { supported: true, payloadCustody: "exact", evidenceState: "accepted", sourceDigest: "resolver:local" },
  },
});
assertDirectAttachmentCapabilityProjectionSafe(payloadCapability);
assert.equal(payloadCapability.canConsumeProviderFilePayload, true);
assert.equal(payloadCapability.canConsumeProviderImagePayload, true);

const fileOnlyCapability = buildDirectAttachmentCapabilityProjection({
  projectId,
  status: "ready",
  providerAttachmentCapability: {
    file: { supported: true, payloadCustody: "exact", evidenceState: "accepted", sourceDigest: "resolver:file-only" },
    image: { supported: false, payloadCustody: "none", evidenceState: "unsupported" },
  },
});
assertDirectAttachmentCapabilityProjectionSafe(fileOnlyCapability);
assert.equal(fileOnlyCapability.canConsumeProviderFilePayload, true);
assert.equal(fileOnlyCapability.canConsumeProviderImagePayload, false);
assert.equal(fileOnlyCapability.capabilityEvidence.providerImagePayload, "unsupported");
const fileOnlyPacket = buildDirectAttachmentSubmitPacket({
  projectId,
  attachments: [{
    id: "att_file_only",
    status: "ready",
    kind: "file",
    displayName: "file-only.txt",
    mimeType: "text/plain",
    stagedRelPath: ".codex/review-shell/attachments/att_file_only/file-only.txt",
  }],
  capabilityProjection: fileOnlyCapability,
});
assert.equal(fileOnlyPacket.dispositions[0].disposition, "provider_payload");

const imageOnlyCapability = buildDirectAttachmentCapabilityProjection({
  projectId,
  status: "ready",
  providerAttachmentCapability: {
    file: { supported: false, payloadCustody: "none", evidenceState: "unsupported" },
    image: { supported: true, payloadCustody: "exact", evidenceState: "accepted", sourceDigest: "resolver:image-only" },
  },
});
assertDirectAttachmentCapabilityProjectionSafe(imageOnlyCapability);
assert.equal(imageOnlyCapability.canConsumeProviderFilePayload, false);
assert.equal(imageOnlyCapability.canConsumeProviderImagePayload, true);
assert.equal(imageOnlyCapability.capabilityEvidence.providerFilePayload, "unsupported");
const imageOnlyPacket = buildDirectAttachmentSubmitPacket({
  projectId,
  attachments: [{
    id: "att_image_only",
    status: "ready",
    kind: "image",
    displayName: "image-only.png",
    mimeType: "image/png",
    stagedRelPath: ".codex/review-shell/attachments/att_image_only/image-only.png",
  }],
  capabilityProjection: imageOnlyCapability,
});
assert.equal(imageOnlyPacket.dispositions[0].disposition, "provider_payload");

const noAttachmentPacket = buildDirectAttachmentSubmitPacket({
  projectId,
  attachments: [],
  capabilityProjection: fileOnlyCapability,
});
assert.equal(noAttachmentPacket.status, "ready");
assert.equal(noAttachmentPacket.attachmentCount, 0);
const activePacket = buildDirectAttachmentSubmitPacket({
  projectId,
  attachments: [{
    id: "att_active_html",
    status: "ready",
    kind: "file",
    displayName: "dashboard.html",
    mimeType: "text/html",
    stagedRelPath: ".codex/review-shell/attachments/att_active_html/dashboard.html",
    typeEvidence: { risk: "active_content" },
    provider: { disposition: "reference_only", reason: "security_policy_blocked" },
  }],
  capabilityProjection: payloadCapability,
});
assert.equal(activePacket.dispositions[0].disposition, "staged_ref");
assert.equal(activePacket.dispositions[0].dispositionReason, "security_policy_blocked");

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
