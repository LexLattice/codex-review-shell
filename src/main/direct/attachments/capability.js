"use strict";

const crypto = require("node:crypto");

const DIRECT_ATTACHMENT_CAPABILITY_PROJECTION_SCHEMA = "direct_attachment_capability_projection@1";
const DIRECT_ATTACHMENT_SUBMIT_PACKET_SCHEMA = "direct_attachment_submit_packet@1";

const DIRECT_ATTACHMENT_DISPOSITIONS = new Set([
  "provider_payload",
  "workspace_ref",
  "staged_ref",
  "text_ref",
  "unsupported",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nowIso(nowMs) {
  const ms = typeof nowMs === "number" && Number.isFinite(nowMs) ? nowMs : Date.now();
  return new Date(ms).toISOString();
}

function stableStringify(value) {
  if (value && typeof value.toJSON === "function") return stableStringify(value.toJSON());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => (entry === undefined ? "null" : stableStringify(entry))).join(",")}]`;
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined && !["packetDigest", "projectionDigest", "rowDigest"].includes(key))
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
}

function digestFor(domain, value) {
  return `sha256:${sha256(`${domain}\0${stableStringify(value)}`)}`;
}

function boundedString(value, maxLength = 220) {
  const text = normalizeString(value, "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeCapabilityEvidenceState(value, fallback = "profile_declared") {
  const state = normalizeString(value, fallback);
  if (["accepted", "runtime_probed", "profile_declared", "unknown", "unsupported"].includes(state)) return state;
  return fallback;
}

function providerAttachmentCapabilityFor(input = {}, kind = "file") {
  // The direct transport has no workspace-backend reader for WSL staged
  // bytes.  A resolver or provider profile may still exist, but it cannot
  // establish exact payload custody for a WSL draft.  Keep the capability
  // projection reference-only until that authority exists.
  const workspaceKind = normalizeString(input.workspaceKind || input.workspace?.kind, "").toLowerCase();
  if (workspaceKind === "wsl") return { supported: false, evidenceState: "unsupported", custody: "none" };
  const source = isPlainObject(input.providerAttachmentCapability) ? input.providerAttachmentCapability : {};
  const candidate = source[kind] || source[`${kind}Payload`] || source.providerPayload;
  if (candidate === true) return { supported: true, evidenceState: "accepted", custody: "exact" };
  if (!isPlainObject(candidate)) return { supported: false, evidenceState: "unsupported", custody: "none" };
  const supported = candidate.supported === true || candidate.enabled === true || candidate.available === true;
  return {
    supported,
    evidenceState: normalizeCapabilityEvidenceState(candidate.evidenceState, supported ? "profile_declared" : "unsupported"),
    custody: normalizeString(candidate.payloadCustody || candidate.custody, "none"),
    sourceDigest: normalizeString(candidate.sourceDigest || candidate.evidenceKey, ""),
  };
}

function buildDirectAttachmentCapabilityProjection(input = {}) {
  const status = normalizeString(input.status, "ready");
  const ready = status === "ready";
  const filePayload = providerAttachmentCapabilityFor(input, "file");
  const imagePayload = providerAttachmentCapabilityFor(input, "image");
  const filePayloadReady = ready && filePayload.supported && filePayload.custody === "exact" && filePayload.evidenceState !== "unsupported";
  const imagePayloadReady = ready && imagePayload.supported && imagePayload.custody === "exact" && imagePayload.evidenceState !== "unsupported";
  const projection = {
    schema: DIRECT_ATTACHMENT_CAPABILITY_PROJECTION_SCHEMA,
    projectionId: normalizeString(input.projectionId, `direct_attachment_capability_${sha256(`${input.projectId || ""}:${status}`).slice(0, 24)}`),
    projectId: normalizeString(input.projectId, ""),
    generatedAt: normalizeString(input.generatedAt, nowIso(input.nowMs)),
    runtimeKind: normalizeString(input.runtimeKind || input.transport, "direct-live-text"),
    workspaceKind: normalizeString(input.workspaceKind || input.workspace?.kind, ""),
    status: ready ? "available" : "degraded",
    canConsumeProviderFilePayload: filePayloadReady,
    canConsumeProviderImagePayload: imagePayloadReady,
    canConsumeWorkspaceFileReference: ready,
    canConsumeStagedFileReference: ready,
    canConsumeTextReference: ready,
    capabilityEvidence: {
      providerFilePayload: filePayloadReady ? filePayload.evidenceState : "unsupported",
      providerImagePayload: imagePayloadReady ? imagePayload.evidenceState : "unsupported",
      workspaceFileReference: ready ? "profile_declared" : "unknown",
      stagedFileReference: ready ? "profile_declared" : "unknown",
      textReference: ready ? "profile_declared" : "unknown",
    },
    blockedStateWitnesses: [
      ...(filePayloadReady ? [] : [{
        capability: "provider_file_payload",
        reason: "direct_provider_file_payload_not_proven",
      }]),
      ...(imagePayloadReady ? [] : [{
        capability: "provider_image_payload",
        reason: "direct_provider_image_payload_not_proven",
      }]),
    ],
    rawPayloadIncluded: false,
    rawPathIncluded: false,
    rawTextIncluded: false,
    rawSecretIncluded: false,
    providerPayloadCustody: filePayloadReady || imagePayloadReady ? "exact" : "none",
    providerPayloadEvidence: {
      file: filePayloadReady ? filePayload.sourceDigest : "",
      image: imagePayloadReady ? imagePayload.sourceDigest : "",
    },
  };
  projection.projectionDigest = digestFor("direct-attachment-capability-projection@1", projection);
  return projection;
}

function normalizedDraft(input = {}) {
  const draft = isPlainObject(input) ? input : {};
  return {
    draftId: normalizeString(draft.id || draft.draftId, ""),
    displayName: boundedString(draft.displayName || draft.originalName || "attachment", 160),
    kind: normalizeString(draft.kind, "file") === "image" ? "image" : "file",
    mimeType: boundedString(draft.mimeType || "application/octet-stream", 120),
    sizeBytes: numberValue(draft.sizeBytes, 0),
    status: normalizeString(draft.status, "unknown"),
    workspaceRelPath: normalizeString(draft.workspaceRelPath, ""),
    stagedRelPath: normalizeString(draft.stagedRelPath, ""),
    sourcePathEvidenceKey: normalizeString(draft.sourcePathEvidenceKey, ""),
    stagedPathEvidenceKey: normalizeString(draft.stagedPathEvidenceKey, ""),
    workspaceEvidenceKey: normalizeString(draft.workspaceEvidenceKey, ""),
    capabilityEvidenceState: normalizeCapabilityEvidenceState(draft.provider?.capabilityEvidenceState, "profile_declared"),
    sourceDisposition: normalizeString(draft.provider?.disposition, ""),
    providerReason: normalizeString(draft.provider?.reason, ""),
    unsupportedReason: boundedString(draft.provider?.unsupportedReason || "", 220),
    typeRisk: normalizeString(draft.typeEvidence?.risk, ""),
    providerPayloadCustody: normalizeString(draft.provider?.payloadCustody || draft.provider?.custody, "none"),
    providerPayloadEvidenceKey: normalizeString(draft.provider?.payloadEvidenceKey || draft.provider?.evidenceKey, ""),
  };
}

function directDispositionForDraft(draft = {}, capability = {}) {
  if (draft.status !== "ready") {
    return {
      disposition: "unsupported",
      reason: "attachment_not_ready",
      capabilityEvidenceState: "unsupported",
    };
  }
  const mimeType = draft.mimeType.toLowerCase();
  const displayName = draft.displayName.toLowerCase();
  const activeType = mimeType === "text/html" || mimeType === "application/xhtml+xml" ||
    mimeType === "image/svg+xml" || /\.(?:html?|svg)$/.test(displayName);
  const sourceDisposition = draft.sourceDisposition.toLowerCase();
  const referenceOnlySource = new Set([
    "reference_only",
    "workspace_ref",
    "staged_ref",
    "text_ref",
    "security_policy_blocked",
    "active_content_reference_only",
  ]).has(sourceDisposition);
  const activeContent = activeType || draft.typeRisk === "active_content" ||
    draft.providerReason === "security_policy_blocked" || referenceOnlySource;
  const referenceReason = draft.providerReason ||
    (draft.typeRisk === "active_content" || activeType || referenceOnlySource
      ? "security_policy_blocked"
      : draft.unsupportedReason);
  // Active content and security-policy reference dispositions may use the
  // safest available reference, but are never promoted to provider bytes.
  if (activeContent) {
    if (draft.workspaceRelPath && capability.canConsumeWorkspaceFileReference === true) {
      return {
        disposition: "workspace_ref",
        reason: referenceReason || "security_policy_blocked",
        capabilityEvidenceState: normalizeCapabilityEvidenceState(capability.capabilityEvidence?.workspaceFileReference, "profile_declared"),
        workspaceRelPath: draft.workspaceRelPath,
      };
    }
    if (draft.stagedRelPath && capability.canConsumeStagedFileReference === true) {
      return {
        disposition: "staged_ref",
        reason: referenceReason || "security_policy_blocked",
        capabilityEvidenceState: normalizeCapabilityEvidenceState(capability.capabilityEvidence?.stagedFileReference, "profile_declared"),
        stagedRelPath: draft.stagedRelPath,
      };
    }
    if (capability.canConsumeTextReference === true && (draft.workspaceRelPath || draft.stagedRelPath)) {
      return {
        disposition: "text_ref",
        reason: referenceReason || "security_policy_blocked",
        capabilityEvidenceState: normalizeCapabilityEvidenceState(capability.capabilityEvidence?.textReference, "profile_declared"),
      };
    }
  }
  const exactSource = (sourceDisposition === "provider_payload" && draft.providerPayloadCustody === "exact") ||
    (draft.stagedRelPath && capability.providerPayloadCustody === "exact");
  const workspaceKind = normalizeString(capability.workspaceKind || capability.workspace?.kind, "").toLowerCase();
  const payloadCapable = draft.kind === "image"
    ? capability.canConsumeProviderImagePayload === true
    : capability.canConsumeProviderFilePayload === true;
  if (workspaceKind !== "wsl" && !activeContent && exactSource && payloadCapable) {
    return {
      disposition: "provider_payload",
      reason: "provider_payload_exact_custody",
      capabilityEvidenceState: normalizeCapabilityEvidenceState(
        capability.capabilityEvidence?.[draft.kind === "image" ? "providerImagePayload" : "providerFilePayload"],
        "accepted",
      ),
    };
  }
  if (draft.workspaceRelPath && capability.canConsumeWorkspaceFileReference === true) {
    return {
      disposition: "workspace_ref",
      reason: "workspace_reference_supported",
      capabilityEvidenceState: normalizeCapabilityEvidenceState(capability.capabilityEvidence?.workspaceFileReference, "profile_declared"),
      workspaceRelPath: draft.workspaceRelPath,
    };
  }
  if (draft.stagedRelPath && capability.canConsumeStagedFileReference === true) {
    return {
      disposition: "staged_ref",
      reason: "staged_reference_supported",
      capabilityEvidenceState: normalizeCapabilityEvidenceState(capability.capabilityEvidence?.stagedFileReference, "profile_declared"),
      stagedRelPath: draft.stagedRelPath,
    };
  }
  if (capability.canConsumeTextReference === true && (draft.workspaceRelPath || draft.stagedRelPath)) {
    return {
      disposition: "text_ref",
      reason: "text_reference_only",
      capabilityEvidenceState: normalizeCapabilityEvidenceState(capability.capabilityEvidence?.textReference, "profile_declared"),
    };
  }
  return {
    disposition: "unsupported",
    reason: referenceReason || "attachment_reference_unavailable",
    capabilityEvidenceState: "unsupported",
  };
}

function attachmentReferenceForPacket(entry = {}) {
  if (entry.disposition === "workspace_ref") return entry.workspaceRelPath;
  if (entry.disposition === "staged_ref") return entry.stagedRelPath;
  return entry.workspaceRelPath || entry.stagedRelPath || "";
}

function buildDirectAttachmentSubmitPacket(input = {}) {
  const capability = isPlainObject(input.capabilityProjection)
    ? input.capabilityProjection
    : buildDirectAttachmentCapabilityProjection(input);
  const drafts = arrayOrEmpty(input.attachments).map(normalizedDraft);
  const attachmentRows = drafts.map((draft) => {
    const disposition = directDispositionForDraft(draft, capability);
    const row = {
      draftId: draft.draftId,
      displayName: draft.displayName,
      kind: draft.kind,
      mimeType: draft.mimeType,
      sizeBytes: draft.sizeBytes,
      disposition: DIRECT_ATTACHMENT_DISPOSITIONS.has(disposition.disposition) ? disposition.disposition : "unsupported",
      dispositionReason: normalizeString(disposition.reason, ""),
      capabilityEvidenceState: normalizeCapabilityEvidenceState(disposition.capabilityEvidenceState, "unknown"),
      workspaceRelPath: normalizeString(disposition.workspaceRelPath || draft.workspaceRelPath, ""),
      stagedRelPath: normalizeString(disposition.stagedRelPath || draft.stagedRelPath, ""),
      sourcePathEvidenceKey: draft.sourcePathEvidenceKey,
      stagedPathEvidenceKey: draft.stagedPathEvidenceKey,
      workspaceEvidenceKey: draft.workspaceEvidenceKey,
      rawPayloadIncluded: false,
      rawPathIncluded: false,
      providerPayloadCustody: disposition.disposition === "provider_payload" ? "exact" : "none",
      providerPayloadEvidenceKey: draft.providerPayloadEvidenceKey,
    };
    row.rowDigest = digestFor("direct-attachment-submit-row@1", row);
    return row;
  });
  const unsupportedAttachments = attachmentRows.filter((row) => row.disposition === "unsupported");
  const transcriptWitnesses = attachmentRows.map((row) => ({
    schema: "attachment_transcript_witness@1",
    draftId: row.draftId,
    displayName: row.displayName,
    disposition: row.disposition,
    submitState: row.disposition === "unsupported" ? "blocked_before_submit" : row.disposition === "provider_payload" ? "submitted_as_provider_payload" : "submitted_as_reference",
    providerAccepted: row.disposition === "provider_payload" ? null : false,
    providerAcceptanceEvidenceRef: "",
    rawPayloadIncludedInTranscript: false,
  }));
  const packet = {
    schema: DIRECT_ATTACHMENT_SUBMIT_PACKET_SCHEMA,
    packetId: normalizeString(input.packetId, `direct_attachment_packet_${sha256(`${input.projectId || ""}:${input.turnClientId || ""}:${attachmentRows.map((row) => row.rowDigest).join(":")}`).slice(0, 24)}`),
    projectId: normalizeString(input.projectId, ""),
    surfaceId: normalizeString(input.surfaceId, "codex"),
    turnClientId: normalizeString(input.turnClientId || input.clientTurnRequestId, ""),
    createdAt: normalizeString(input.createdAt, nowIso(input.nowMs)),
    attachmentCount: attachmentRows.length,
    status: unsupportedAttachments.length ? "blocked" : "ready",
    capabilityProjectionDigest: normalizeString(capability.projectionDigest, ""),
    dispositions: attachmentRows,
    transcriptWitnesses,
    unsupportedAttachments: unsupportedAttachments.map((row) => ({
      draftId: row.draftId,
      displayName: row.displayName,
      reason: row.dispositionReason,
    })),
    summary: {
      providerPayloadCount: attachmentRows.filter((row) => row.disposition === "provider_payload").length,
      workspaceRefCount: attachmentRows.filter((row) => row.disposition === "workspace_ref").length,
      stagedRefCount: attachmentRows.filter((row) => row.disposition === "staged_ref").length,
      textRefCount: attachmentRows.filter((row) => row.disposition === "text_ref").length,
      unsupportedCount: unsupportedAttachments.length,
    },
    rawExternalPathsIncluded: false,
    rawClipboardBytesIncluded: false,
    rawPayloadIncluded: false,
    rawPathIncluded: false,
    rawTextIncluded: false,
    rawSecretIncluded: false,
  };
  packet.packetDigest = digestFor("direct-attachment-submit-packet@1", packet);
  return packet;
}

function referenceLinesFromSubmitPacket(packet = {}) {
  const lines = [];
  for (const row of arrayOrEmpty(packet.dispositions)) {
    if (row.disposition === "unsupported") continue;
    const rel = attachmentReferenceForPacket(row);
    if (!rel) continue;
    lines.push(`- ${row.displayName} (${row.mimeType}, ${row.sizeBytes} bytes): ${rel} [${row.disposition}]`);
  }
  return lines;
}

function buildDirectAttachmentReferenceBlock(packet = {}) {
  const lines = referenceLinesFromSubmitPacket(packet);
  if (!lines.length) return "";
  return ["", "Attachments submitted as governed direct references:", ...lines].join("\n");
}

function packetReferenceTargets(packet = {}) {
  return arrayOrEmpty(packet.dispositions)
    .map((row) => attachmentReferenceForPacket(row))
    .filter(Boolean);
}

function buildDirectAttachmentProviderPrompt(promptText = "", packet = {}) {
  const prompt = String(promptText || "");
  const block = buildDirectAttachmentReferenceBlock(packet);
  if (!block) return prompt;
  const targets = packetReferenceTargets(packet);
  if (targets.length && targets.every((target) => prompt.includes(target))) return prompt;
  return `${prompt}${block}`;
}

function assertDirectAttachmentCapabilityProjectionSafe(projection = {}) {
  if (!isPlainObject(projection) || projection.schema !== DIRECT_ATTACHMENT_CAPABILITY_PROJECTION_SCHEMA) {
    throw new Error("direct_attachment_capability_projection_schema_mismatch");
  }
  for (const key of ["rawPayloadIncluded", "rawPathIncluded", "rawTextIncluded", "rawSecretIncluded"]) {
    if (projection[key] !== false) throw new Error(`direct_attachment_capability_raw_exposure:${key}`);
  }
  const canConsumeProviderFilePayload = projection.canConsumeProviderFilePayload === true;
  const canConsumeProviderImagePayload = projection.canConsumeProviderImagePayload === true;
  if (canConsumeProviderFilePayload || canConsumeProviderImagePayload) {
    if (normalizeString(projection.workspaceKind || projection.workspace?.kind, "").toLowerCase() === "wsl") {
      throw new Error("direct_attachment_wsl_payload_capability_overclaimed");
    }
    if (projection.providerPayloadCustody !== "exact") throw new Error("direct_attachment_payload_capability_overclaimed");
    const enabledEvidence = [
      [canConsumeProviderFilePayload, "providerFilePayload"],
      [canConsumeProviderImagePayload, "providerImagePayload"],
    ];
    for (const [enabled, kind] of enabledEvidence) {
      if (!enabled) continue;
      if (["unsupported", "unknown"].includes(normalizeCapabilityEvidenceState(projection.capabilityEvidence?.[kind], "unknown"))) {
        throw new Error("direct_attachment_payload_capability_overclaimed");
      }
    }
  }
  return true;
}

function assertDirectAttachmentSubmitPacketSafe(packet = {}) {
  if (!isPlainObject(packet) || packet.schema !== DIRECT_ATTACHMENT_SUBMIT_PACKET_SCHEMA) {
    throw new Error("direct_attachment_submit_packet_schema_mismatch");
  }
  for (const key of ["rawExternalPathsIncluded", "rawClipboardBytesIncluded", "rawPayloadIncluded", "rawPathIncluded", "rawTextIncluded", "rawSecretIncluded"]) {
    if (packet[key] !== false) throw new Error(`direct_attachment_submit_packet_raw_exposure:${key}`);
  }
  for (const row of arrayOrEmpty(packet.dispositions)) {
    if (row.rawPayloadIncluded !== false || row.rawPathIncluded !== false) {
      throw new Error(`direct_attachment_submit_row_raw_exposure:${row.draftId || ""}`);
    }
  }
  for (const witness of arrayOrEmpty(packet.transcriptWitnesses)) {
    if (witness.rawPayloadIncludedInTranscript !== false) {
      throw new Error(`direct_attachment_transcript_payload_leak:${witness.draftId || ""}`);
    }
  }
  for (const payload of arrayOrEmpty(packet.providerPayloads)) {
    if (payload.rawPayloadIncluded !== false || payload.rawPathIncluded === true) {
      throw new Error(`direct_attachment_provider_payload_raw_exposure:${payload.draftId || ""}`);
    }
    if (!["provider_input", "provider_input_unconfirmed"].includes(normalizeString(payload.modelVisibility, ""))) {
      throw new Error(`direct_attachment_provider_payload_visibility_missing:${payload.draftId || ""}`);
    }
  }
  return true;
}

module.exports = {
  DIRECT_ATTACHMENT_CAPABILITY_PROJECTION_SCHEMA,
  DIRECT_ATTACHMENT_SUBMIT_PACKET_SCHEMA,
  assertDirectAttachmentCapabilityProjectionSafe,
  assertDirectAttachmentSubmitPacketSafe,
  buildDirectAttachmentCapabilityProjection,
  buildDirectAttachmentProviderPrompt,
  buildDirectAttachmentReferenceBlock,
  buildDirectAttachmentSubmitPacket,
};
