"use strict";

const crypto = require("node:crypto");

const DIRECT_CONTEXT_PACKET_PREVIEW_SCHEMA = "direct_context_packet_preview@1";
const DIRECT_CONTEXT_PREVIEW_SOURCE_ROW_SCHEMA = "direct_context_preview_source_row@1";

const SOURCE_CLASSES = new Set([
  "recent_dialogue",
  "durable_memory",
  "frontier_baton",
  "attachment",
  "module_context",
  "tool_result_ref",
  "omission_witness",
  "harness_policy",
  "unknown",
]);

const BLOCKER_CODES = new Set([
  "required_source_missing",
  "required_source_stale",
  "raw_exposure_unsafe",
  "required_omission_witness_missing",
]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedString(value, maxLength = 280) {
  const text = normalizeString(value, "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function objectOrEmpty(value) {
  return isPlainObject(value) ? value : {};
}

function stableStringify(value) {
  if (value && typeof value.toJSON === "function") return stableStringify(value.toJSON());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => (entry === undefined ? "null" : stableStringify(entry))).join(",")}]`;
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function digestFor(domain, value) {
  return crypto.createHash("sha256").update(`${domain}:${stableStringify(value)}`).digest("hex");
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function normalizeSourceClass(value) {
  const sourceClass = normalizeString(value, "unknown");
  return SOURCE_CLASSES.has(sourceClass) ? sourceClass : "unknown";
}

function evidenceRefsFrom(value) {
  return arrayOrEmpty(value)
    .filter(isPlainObject)
    .filter((ref) => ref.kind || ref.type || ref.digest || ref.refDigest || ref.sourceDigest || ref.label || ref.name)
    .map((ref) => ({
      kind: boundedString(ref.kind || ref.type || "evidence", 80),
      digest: boundedString(ref.digest || ref.refDigest || ref.sourceDigest || "", 96),
      label: boundedString(ref.label || ref.name || "", 160),
    }));
}

function hasUnsafeRawExposure(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((entry) => hasUnsafeRawExposure(entry));
  for (const [key, nested] of Object.entries(value)) {
    if (/^raw[A-Z].*(Included|Exposed)$/.test(key) && nested === true) return true;
    if (nested && typeof nested === "object" && hasUnsafeRawExposure(nested)) return true;
  }
  return false;
}

function sourceClassForArtifact(item = {}) {
  const artifactKind = normalizeString(item.artifactKind || item.projectionKind || item.kind, "");
  if (artifactKind === "durable_thread_memory" || artifactKind === "thread_memory_review_packet" || artifactKind === "thread_memory_refresh_proposal") return "durable_memory";
  if (artifactKind === "frontier_baton") return "frontier_baton";
  if (artifactKind === "context_omission_ledger" || artifactKind === "context_omission_witness" || artifactKind === "context_loss_witness") return "omission_witness";
  if (artifactKind === "tool_continuation_context_projection" || artifactKind === "readonly_tool_result" || artifactKind === "tool_result_ref") return "tool_result_ref";
  if (artifactKind === "attachment" || artifactKind === "composer_attachment") return "attachment";
  if (artifactKind === "module_context" || artifactKind === "module_context_contribution") return "module_context";
  if (artifactKind === "harness_policy" || artifactKind === "work_thread" || artifactKind === "governance_packet" || artifactKind === "semantic_broker_packet" || artifactKind === "controlled_routing_slice") return "harness_policy";
  if (artifactKind === "current_user_prompt" || artifactKind === "context_projection" || artifactKind === "checkpoint_seed" || artifactKind === "fork_seed" || artifactKind === "derived_fork_seed") return "recent_dialogue";
  return "unknown";
}

function normalizeSourceArtifact(item = {}) {
  const artifact = objectOrEmpty(item);
  return {
    sourceClass: sourceClassForArtifact(artifact),
    sourceId: artifact.artifactId || artifact.projectionId || artifact.sourceId || artifact.id || "",
    label: artifact.label || artifact.artifactKind || artifact.projectionKind || artifact.kind || "",
    sourceDigest: artifact.artifactDigest || artifact.projectionDigest || artifact.sourceDigest || artifact.digest || "",
    includedInRequest: artifact.includedInRequest !== false,
    required: artifact.required === true || artifact.requiredForRequest === true,
    stale: artifact.stale === true || artifact.state === "stale",
    missing: artifact.missing === true || artifact.state === "missing",
    rawExposureUnsafe: hasUnsafeRawExposure(artifact),
    evidenceRefs: artifact.evidenceRefs || artifact.refs || [],
    retentionLaw: artifact.retentionLaw || artifact.retention || artifact.policy || "context_pack_source_artifact",
  };
}

function rowIdFor(sourceClass, sourceId, ordinal, source) {
  const explicit = normalizeString(source.previewRowId || source.rowId || source.id, "");
  if (explicit) return boundedString(explicit, 120);
  const safeSourceId = normalizeString(sourceId, "");
  if (safeSourceId) return `context_preview_${sourceClass}_${digestFor("context-preview-row-id@1", { sourceClass, sourceId: safeSourceId }).slice(0, 16)}`;
  return `context_preview_${sourceClass}_${ordinal}`;
}

function coercePreviewSource(source, fallbackClass, ordinal) {
  const item = objectOrEmpty(source);
  const sourceClass = normalizeSourceClass(item.sourceClass || item.kind || fallbackClass);
  const sourceId = boundedString(item.sourceId || item.id || item.refId || item.artifactId || item.itemId || item.digest || "", 160);
  const includedInRequest = item.includedInRequest !== false && sourceClass !== "omission_witness";
  const required = item.required === true || item.requiredForRequest === true;
  const stale = item.stale === true || item.state === "stale";
  const missing = item.missing === true || item.state === "missing";
  const rawExposureUnsafe = item.rawExposureUnsafe === true || hasUnsafeRawExposure(item);
  const row = {
    schema: DIRECT_CONTEXT_PREVIEW_SOURCE_ROW_SCHEMA,
    rowId: rowIdFor(sourceClass, sourceId, ordinal, item),
    sourceClass,
    sourceId,
    label: boundedString(item.label || item.displayLabel || item.title || sourceId || sourceClass, 180),
    includedInRequest,
    required,
    stale,
    missing,
    rawExposureUnsafe,
    retentionLaw: boundedString(item.retentionLaw || item.retention || item.policy || "unspecified", 120),
    omissionReason: includedInRequest ? "" : boundedString(item.omissionReason || item.reason || "not_selected_for_request", 180),
    tokenEstimate: numberOrZero(item.tokenEstimate || item.estimatedTokens || item.tokens),
    sizeBytes: numberOrZero(item.sizeBytes || item.byteSize || item.bytes),
    sourceDigest: boundedString(item.sourceDigest || item.digest || digestFor("context-preview-source@1", {
      sourceClass,
      sourceId,
      label: item.label || item.displayLabel || item.title || "",
      includedInRequest,
      required,
      stale,
      missing,
      rawExposureUnsafe,
    }), 96),
    evidenceRefs: evidenceRefsFrom(item.evidenceRefs || item.refs),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  row.blockerCodes = blockerCodesForRow(row);
  row.rowDigest = digestFor("direct-context-preview-source-row@1", row);
  return row;
}

function blockerCodesForRow(row) {
  const blockers = [];
  if (row.required && row.missing) blockers.push("required_source_missing");
  if (row.required && row.stale) blockers.push("required_source_stale");
  if (row.rawExposureUnsafe) blockers.push("raw_exposure_unsafe");
  return blockers;
}

function extractContextRows(input) {
  const sources = [];
  const addMany = (items, sourceClass) => {
    for (const item of arrayOrEmpty(items)) sources.push(coercePreviewSource(item, sourceClass, sources.length));
  };
  addMany(input.recentDialogue || input.dialogueRows || input.contextPack?.recentDialogue || input.contextPack?.messages || input.contextPacket?.messages, "recent_dialogue");
  addMany(input.durableMemory || input.memoryRows || input.contextPack?.durableMemory || input.contextMaintenance?.durableMemory, "durable_memory");
  addMany(input.frontierBaton || input.batonRows || input.contextPack?.frontierBaton || input.contextMaintenance?.frontierBaton, "frontier_baton");
  addMany(input.attachments || input.attachmentRows || input.contextPack?.attachments, "attachment");
  addMany([
    ...arrayOrEmpty(input.moduleContextContributions),
    ...arrayOrEmpty(input.moduleContextRows),
    ...arrayOrEmpty(input.moduleStatus?.contextContributions),
    ...arrayOrEmpty(input.moduleContextIntake?.acceptedContextPreviewRows),
    ...arrayOrEmpty(input.directModuleContextIntake?.acceptedContextPreviewRows),
  ], "module_context");
  addMany(input.toolResultRefs || input.toolResultRows || input.contextPack?.toolResultRefs, "tool_result_ref");
  addMany(input.omissionRows || input.omissionWitnesses || input.contextMaintenance?.omissionRows || input.contextPack?.omissionRows, "omission_witness");
  addMany(input.harnessPolicyRows || input.policyRows, "harness_policy");
  for (const item of arrayOrEmpty(input.contextPack?.sourceArtifacts || input.sourceArtifacts)) {
    const normalized = normalizeSourceArtifact(item);
    sources.push(coercePreviewSource(normalized, normalized.sourceClass, sources.length));
  }
  for (const item of arrayOrEmpty(input.contextPack?.sourceProjections || input.sourceProjections)) {
    const normalized = normalizeSourceArtifact(item);
    sources.push(coercePreviewSource(normalized, normalized.sourceClass, sources.length));
  }

  const packItems = arrayOrEmpty(input.contextPack?.items || input.contextPack?.contextItems || input.contextPacket?.items);
  for (const item of packItems) {
    const sourceClass = normalizeSourceClass(item?.sourceClass || item?.kind || "unknown");
    sources.push(coercePreviewSource(item, sourceClass, sources.length));
  }
  return sources;
}

function summarizeCounts(rows) {
  const bySourceClass = {};
  for (const row of rows) {
    bySourceClass[row.sourceClass] = Number(bySourceClass[row.sourceClass] || 0) + 1;
  }
  return {
    rowCount: rows.length,
    includedSourceCount: rows.filter((row) => row.includedInRequest).length,
    omittedSourceCount: rows.filter((row) => !row.includedInRequest).length,
    requiredSourceCount: rows.filter((row) => row.required).length,
    staleSourceCount: rows.filter((row) => row.stale).length,
    missingSourceCount: rows.filter((row) => row.missing).length,
    rawExposureUnsafeCount: rows.filter((row) => row.rawExposureUnsafe).length,
    tokenEstimateTotal: rows.reduce((sum, row) => sum + numberOrZero(row.tokenEstimate), 0),
    sizeBytesTotal: rows.reduce((sum, row) => sum + numberOrZero(row.sizeBytes), 0),
    bySourceClass,
  };
}

function buildBlockers(rows, options) {
  const blockers = [];
  for (const row of rows) {
    for (const code of row.blockerCodes) {
      if (!BLOCKER_CODES.has(code)) continue;
      blockers.push({
        code,
        rowId: row.rowId,
        sourceClass: row.sourceClass,
        label: row.label,
      });
    }
  }
  const omissionRequired = options.omissionRequired === true;
  const hasOmissionWitness = rows.some((row) => row.sourceClass === "omission_witness");
  if (omissionRequired && !hasOmissionWitness) {
    blockers.push({
      code: "required_omission_witness_missing",
      rowId: "",
      sourceClass: "omission_witness",
      label: "Required omission witness",
    });
  }
  return blockers;
}

function buildContextPacketPreview(input = {}, options = {}) {
  const source = objectOrEmpty(input);
  const opts = objectOrEmpty(options);
  const rows = extractContextRows(source);
  const blockers = buildBlockers(rows, {
    omissionRequired: opts.omissionRequired === true || source.omissionRequired === true,
  });
  const counts = summarizeCounts(rows);
  const previewState = blockers.length
    ? "blocked_from_request"
    : rows.length
      ? (counts.staleSourceCount || counts.missingSourceCount ? "degraded" : "ready")
      : "empty";
  const sourceDigest = digestFor("direct-context-preview-source@1", {
    projectId: source.projectId,
    workThreadId: source.workThreadId,
    threadId: source.threadId,
    rows,
    omissionRequired: opts.omissionRequired === true || source.omissionRequired === true,
  });
  const preview = {
    schema: DIRECT_CONTEXT_PACKET_PREVIEW_SCHEMA,
    previewId: normalizeString(source.previewId, `direct_context_preview_${sourceDigest.slice(0, 24)}`),
    projectId: boundedString(source.projectId || source.contextPack?.projectId || "", 120),
    workThreadId: boundedString(source.workThreadId || source.contextPack?.workThreadId || source.requestManifest?.workThreadId || "", 160),
    threadId: boundedString(source.threadId || source.contextPack?.threadId || source.requestManifest?.threadId || "", 160),
    generatedAt: normalizeString(source.generatedAt, typeof source.nowMs === "number" ? new Date(source.nowMs).toISOString() : new Date().toISOString()),
    previewState,
    sourceRows: rows,
    blockers,
    counts,
    downstreamRequestConstraints: {
      requestAssemblyAllowed: blockers.length === 0,
      requestAssemblyBlocked: blockers.length > 0,
      providerCallBlocked: blockers.length > 0,
      blockerCodes: [...new Set(blockers.map((blocker) => blocker.code))],
      requiredSourceRows: rows.filter((row) => row.required).map((row) => row.rowId),
      omittedSourceCount: counts.omittedSourceCount,
    },
    authority: {
      displayOnly: true,
      rendererSafe: true,
      previewEditingAllowed: false,
      requestAssemblyAuthorityGranted: false,
      providerTransportAllowed: false,
      workspaceMutationAllowed: false,
      memoryMutationAllowed: false,
      providerCompactionAllowed: false,
      rawTextIncluded: false,
      rawPathIncluded: false,
      rawSecretIncluded: false,
    },
    rendererSafeSummary: {
      state: previewState,
      sourceCount: counts.rowCount,
      includedSourceCount: counts.includedSourceCount,
      omittedSourceCount: counts.omittedSourceCount,
      tokenEstimateTotal: counts.tokenEstimateTotal,
      sizeBytesTotal: counts.sizeBytesTotal,
      blockerCount: blockers.length,
      sourceClasses: Object.keys(counts.bySourceClass).sort(),
    },
    sourceDigest,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  preview.previewDigest = digestFor("direct-context-packet-preview@1", preview);
  return preview;
}

function assertContextPacketPreviewSafe(preview = {}) {
  if (!isPlainObject(preview) || preview.schema !== DIRECT_CONTEXT_PACKET_PREVIEW_SCHEMA) {
    throw new Error("direct_context_packet_preview_schema_mismatch");
  }
  const authority = objectOrEmpty(preview.authority);
  const forbiddenTrueFlags = [
    "previewEditingAllowed",
    "requestAssemblyAuthorityGranted",
    "providerTransportAllowed",
    "workspaceMutationAllowed",
    "memoryMutationAllowed",
    "providerCompactionAllowed",
    "rawTextIncluded",
    "rawPathIncluded",
    "rawSecretIncluded",
  ];
  if (authority.displayOnly !== true || authority.rendererSafe !== true) {
    throw new Error("direct_context_packet_preview_not_display_only");
  }
  for (const flag of forbiddenTrueFlags) {
    if (authority[flag] !== false) throw new Error(`direct_context_packet_preview_authority_leak:${flag}`);
  }
  if (preview.rawTextIncluded !== false || preview.rawPathIncluded !== false || preview.rawSecretIncluded !== false) {
    throw new Error("direct_context_packet_preview_raw_exposure");
  }
  for (const row of arrayOrEmpty(preview.sourceRows)) {
    if (row.rawTextIncluded !== false || row.rawPathIncluded !== false || row.rawSecretIncluded !== false) {
      throw new Error(`direct_context_packet_preview_row_raw_exposure:${row.rowId || ""}`);
    }
  }
  return true;
}

module.exports = {
  DIRECT_CONTEXT_PACKET_PREVIEW_SCHEMA,
  DIRECT_CONTEXT_PREVIEW_SOURCE_ROW_SCHEMA,
  assertContextPacketPreviewSafe,
  buildContextPacketPreview,
  stableStringify,
};
