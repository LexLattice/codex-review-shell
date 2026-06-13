"use strict";

const crypto = require("node:crypto");

const DIRECT_MEMORY_REVIEW_WORKBENCH_SCHEMA = "direct_memory_review_workbench@1";
const DIRECT_MEMORY_REVIEW_WORKBENCH_ROW_SCHEMA = "direct_memory_review_workbench_row@1";

const ROW_KINDS = new Set([
  "review_packet",
  "refresh_proposal",
  "reset_policy",
  "reset_confirmation",
  "execution_transition",
  "context_loss_link",
  "omission_impact",
  "rollback_posture",
]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function objectOrEmpty(value) {
  return isPlainObject(value) ? value : {};
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedString(value, maxLength = 280) {
  const text = normalizeString(value, "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
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

function evidenceRefsFrom(value) {
  return arrayOrEmpty(value)
    .filter(isPlainObject)
    .filter((ref) => ref.kind || ref.artifactKind || ref.digest || ref.artifactDigest || ref.sourceDigest || ref.label || ref.rendererSafeLabel)
    .map((ref) => ({
      kind: boundedString(ref.kind || ref.artifactKind || "evidence", 80),
      artifactId: boundedString(ref.artifactId || ref.id || "", 160),
      digest: boundedString(ref.digest || ref.artifactDigest || ref.sourceDigest || "", 96),
      label: boundedString(ref.label || ref.rendererSafeLabel || ref.name || "", 180),
    }));
}

function artifactDigestFor(artifact = {}) {
  return normalizeString(artifact.integrity?.artifactDigest || artifact.projectionDigest || artifact.memoryDigest || artifact.digest, "");
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

function row(kind, state, artifact, options = {}) {
  const safeKind = ROW_KINDS.has(kind) ? kind : "review_packet";
  const source = objectOrEmpty(artifact);
  const rowSource = {
    kind: safeKind,
    state,
    id: options.artifactId || source.memoryReviewPacketId || source.memoryRefreshProposalId || source.memoryResetPolicyId || source.memoryResetConfirmationId || source.executionPacketId || source.executionResultId || source.contextLossWitnessId || source.omissionLedgerId || source.memoryId || source.batonId || "",
    digest: artifactDigestFor(source) || options.digest || "",
    summary: source.rendererSafeSummary || options.summary || "",
    evidenceRefs: options.evidenceRefs || source.sourceRefs || source.omissionRefs || source.materializedArtifacts || source.previewArtifacts || source.retainedArtifacts || [],
  };
  const rowDigest = digestFor("direct-memory-review-workbench-row-source@1", rowSource);
  return {
    schema: DIRECT_MEMORY_REVIEW_WORKBENCH_ROW_SCHEMA,
    rowId: normalizeString(options.rowId, `memory_workbench_${safeKind}_${rowDigest.slice(0, 16)}`),
    rowKind: safeKind,
    state: boundedString(state, 80),
    artifactId: boundedString(rowSource.id, 160),
    artifactDigest: boundedString(rowSource.digest, 96),
    label: boundedString(options.label || source.label || source.rendererSafeLabel || safeKind, 160),
    summary: boundedString(rowSource.summary, 360),
    staleCount: Number(options.staleCount ?? source.staleEntryCount ?? 0),
    conflictCount: Number(options.conflictCount ?? source.conflictEntryCount ?? 0),
    omittedItemCount: Number(options.omittedItemCount ?? source.omissionItemCount ?? source.totals?.omittedItemCount ?? 0),
    omittedTokenEstimate: Number(options.omittedTokenEstimate ?? source.totals?.omittedTokenEstimate ?? 0),
    rollbackPosture: boundedString(options.rollbackPosture || source.rollbackPosture || "", 120),
    retentionLaw: boundedString(options.retentionLaw || source.retentionLaw || "", 160),
    omissionRisk: boundedString(options.omissionRisk || source.omissionRisk || "", 160),
    actionAvailable: options.actionAvailable === true,
    actionBlocked: options.actionBlocked === true,
    blockerCode: boundedString(options.blockerCode || source.blockerCode || "", 120),
    evidenceRefs: evidenceRefsFrom(rowSource.evidenceRefs),
    rawExposureUnsafe: hasUnsafeRawExposure(source),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    rowDigest,
  };
}

function buildDirectMemoryReviewWorkbench(input = {}) {
  const source = objectOrEmpty(input);
  const memoryReviewPacket = objectOrEmpty(source.memoryReviewPacket || source.reviewPacket);
  const memoryRefreshProposal = objectOrEmpty(source.memoryRefreshProposal || source.refreshProposal);
  const memoryResetPolicy = objectOrEmpty(source.memoryResetPolicy || source.resetPolicy);
  const memoryResetConfirmation = objectOrEmpty(source.memoryResetConfirmation || source.resetConfirmation);
  const executionPacket = objectOrEmpty(source.executionPacket || source.contextMaintenanceExecutionPacket);
  const executionResult = objectOrEmpty(source.executionResult || source.contextMaintenanceExecutionResult);
  const contextLossWitness = objectOrEmpty(source.contextLossWitness || source.lossWitness);
  const omissionLedger = objectOrEmpty(source.omissionLedger);

  const rows = [];
  if (memoryReviewPacket.schema) {
    rows.push(row("review_packet", normalizeString(memoryReviewPacket.reviewState, "unknown"), memoryReviewPacket, {
      label: "Memory review",
      actionAvailable: memoryReviewPacket.refreshProposalAllowed === true,
      staleCount: memoryReviewPacket.staleEntryCount,
      conflictCount: memoryReviewPacket.conflictEntryCount,
      omittedItemCount: memoryReviewPacket.omissionItemCount,
    }));
  }
  if (memoryRefreshProposal.schema) {
    rows.push(row("refresh_proposal", normalizeString(memoryRefreshProposal.proposalState, "unknown"), memoryRefreshProposal, {
      label: "Memory refresh proposal",
      actionAvailable: memoryRefreshProposal.proposalState === "proposed" || memoryRefreshProposal.proposalState === "accepted" || memoryRefreshProposal.proposalState === "rejected",
      actionBlocked: memoryRefreshProposal.proposalState === "blocked",
    }));
  }
  if (memoryResetPolicy.schema) {
    rows.push(row("reset_policy", normalizeString(memoryResetPolicy.policyState, "disabled"), memoryResetPolicy, {
      label: "Memory reset policy",
      actionAvailable: memoryResetPolicy.resetWorkflowVisible === true,
      actionBlocked: memoryResetPolicy.resetAllowedInThisPr !== true,
    }));
  }
  if (memoryResetConfirmation.schema) {
    rows.push(row("reset_confirmation", normalizeString(memoryResetConfirmation.confirmationState, "not_requested"), memoryResetConfirmation, {
      label: "Memory reset confirmation",
      actionAvailable: false,
      actionBlocked: memoryResetConfirmation.resetAllowedInThisPr !== true,
    }));
  }
  if (executionPacket.schema || executionResult.schema) {
    rows.push(row("execution_transition", normalizeString(executionResult.resultState, executionPacket.operatorDecision || "not_requested"), executionResult.schema ? executionResult : executionPacket, {
      label: "Local memory transition",
      actionAvailable: false,
      actionBlocked: executionResult.resultState === "blocked" || executionResult.resultState === "rejected",
      blockerCode: executionResult.blockerCode,
      rollbackPosture: executionResult.rollbackPosture || executionPacket.rollbackPosture,
      retentionLaw: executionResult.retentionLaw || executionPacket.retentionLaw,
      omissionRisk: executionResult.omissionRisk || executionPacket.omissionRisk,
    }));
  }
  if (contextLossWitness.schema) {
    rows.push(row("context_loss_link", normalizeString(contextLossWitness.lossState, "represented"), contextLossWitness, {
      label: "Context loss witness",
      omittedItemCount: contextLossWitness.totals?.omittedItemCount,
      omittedTokenEstimate: contextLossWitness.totals?.omittedTokenEstimate,
    }));
  }
  if (omissionLedger.schema) {
    rows.push(row("omission_impact", normalizeString(omissionLedger.ledgerState, "represented"), omissionLedger, {
      label: "Omission impact",
      omittedItemCount: omissionLedger.totals?.omittedItemCount,
      omittedTokenEstimate: omissionLedger.totals?.omittedTokenEstimate,
    }));
  }
  if (executionResult.rollbackPosture || executionPacket.rollbackPosture || memoryRefreshProposal.currentMemoryRetained === true) {
    rows.push(row("rollback_posture", normalizeString(executionResult.rollbackPosture || executionPacket.rollbackPosture || "previous_pointer_retained"), executionResult.schema ? executionResult : memoryRefreshProposal, {
      label: "Rollback posture",
      rollbackPosture: executionResult.rollbackPosture || executionPacket.rollbackPosture || "previous_pointer_retained",
      retentionLaw: executionResult.retentionLaw || executionPacket.retentionLaw || "source_refs_and_previous_pointer_retained",
    }));
  }

  const rawExposureUnsafeCount = rows.filter((entry) => entry.rawExposureUnsafe).length;
  const blockedRowCount = rows.filter((entry) => entry.actionBlocked || entry.rawExposureUnsafe).length;
  const acceptedRefresh = memoryRefreshProposal.proposalState === "accepted";
  const rejectedRefresh = memoryRefreshProposal.proposalState === "rejected";
  const localMaterialized = executionResult.resultState === "executed" && executionResult.memoryPointerUpdated === true;
  const scopedProjectId = normalizeString(
    source.projectId ||
      memoryReviewPacket.projectId ||
      memoryRefreshProposal.projectId ||
      memoryResetPolicy.projectId ||
      memoryResetConfirmation.projectId ||
      executionResult.projectId ||
      executionPacket.projectId ||
      contextLossWitness.projectId ||
      omissionLedger.projectId,
    "",
  );
  const scopedThreadId = normalizeString(
    source.threadId ||
      memoryReviewPacket.threadId ||
      memoryRefreshProposal.threadId ||
      memoryResetPolicy.threadId ||
      memoryResetConfirmation.threadId ||
      executionResult.threadId ||
      executionPacket.threadId ||
      contextLossWitness.threadId ||
      omissionLedger.threadId,
    "",
  );
  const scopedWorkThreadId = normalizeString(
    source.workThreadId ||
      memoryReviewPacket.workThreadId ||
      memoryRefreshProposal.workThreadId ||
      memoryResetPolicy.workThreadId ||
      memoryResetConfirmation.workThreadId ||
      executionResult.workThreadId ||
      executionPacket.workThreadId ||
      contextLossWitness.workThreadId ||
      omissionLedger.workThreadId,
    "",
  );
  const sourceDigest = digestFor("direct-memory-review-workbench-source@1", {
    memoryReviewDigest: artifactDigestFor(memoryReviewPacket),
    memoryRefreshDigest: artifactDigestFor(memoryRefreshProposal),
    memoryResetPolicyDigest: artifactDigestFor(memoryResetPolicy),
    memoryResetConfirmationDigest: artifactDigestFor(memoryResetConfirmation),
    executionPacketDigest: artifactDigestFor(executionPacket),
    executionResultDigest: artifactDigestFor(executionResult),
    contextLossDigest: artifactDigestFor(contextLossWitness),
    omissionLedgerDigest: artifactDigestFor(omissionLedger),
    rows,
  });
  const workbench = {
    schema: DIRECT_MEMORY_REVIEW_WORKBENCH_SCHEMA,
    workbenchId: normalizeString(source.workbenchId, `direct_memory_review_workbench_${sourceDigest.slice(0, 24)}`),
    projectId: scopedProjectId,
    threadId: scopedThreadId,
    workThreadId: scopedWorkThreadId,
    generatedAt: normalizeString(source.generatedAt, typeof source.nowMs === "number" ? new Date(source.nowMs).toISOString() : new Date().toISOString()),
    workbenchState: rawExposureUnsafeCount ? "blocked_raw_exposure" : rows.length ? "ready" : "empty",
    rows,
    counts: {
      rowCount: rows.length,
      reviewRowCount: rows.filter((entry) => entry.rowKind === "review_packet").length,
      refreshProposalRowCount: rows.filter((entry) => entry.rowKind === "refresh_proposal").length,
      resetRowCount: rows.filter((entry) => entry.rowKind === "reset_policy" || entry.rowKind === "reset_confirmation").length,
      executionTransitionRowCount: rows.filter((entry) => entry.rowKind === "execution_transition").length,
      contextLossRowCount: rows.filter((entry) => entry.rowKind === "context_loss_link").length,
      omissionImpactRowCount: rows.filter((entry) => entry.rowKind === "omission_impact").length,
      staleMemoryEntryCount: rows.reduce((sum, entry) => sum + Number(entry.staleCount || 0), 0),
      conflictedMemoryEntryCount: rows.reduce((sum, entry) => sum + Number(entry.conflictCount || 0), 0),
      omittedItemCount: rows.reduce((sum, entry) => sum + Number(entry.omittedItemCount || 0), 0),
      omittedTokenEstimate: rows.reduce((sum, entry) => sum + Number(entry.omittedTokenEstimate || 0), 0),
      blockedRowCount,
      rawExposureUnsafeCount,
    },
    transitions: {
      acceptedRefreshVisible: acceptedRefresh,
      rejectedRefreshVisible: rejectedRefresh,
      localMaterializationWitnessVisible: localMaterialized,
      rollbackPostureVisible: rows.some((entry) => entry.rowKind === "rollback_posture"),
      resetWorkflowVisible: memoryResetPolicy.resetWorkflowVisible === true,
      resetExecutionAllowed: false,
      memoryMutationAuthorityGranted: false,
      providerMemoryClaimAccepted: false,
      providerCompactionAllowed: false,
      automaticRefreshAllowed: false,
      providerTransportAllowed: false,
    },
    authority: {
      displayOnly: true,
      rendererSafe: true,
      memoryMutationAllowed: false,
      providerMemoryClaimAccepted: false,
      providerCompactionAllowed: false,
      automaticRefreshAllowed: false,
      providerTransportAllowed: false,
      workspaceMutationAllowed: false,
      rawTextIncluded: false,
      rawPathIncluded: false,
      rawSecretIncluded: false,
    },
    rendererSafeSummary: {
      rowCount: rows.length,
      state: rawExposureUnsafeCount ? "blocked_raw_exposure" : rows.length ? "ready" : "empty",
      staleMemoryEntryCount: rows.reduce((sum, entry) => sum + Number(entry.staleCount || 0), 0),
      conflictedMemoryEntryCount: rows.reduce((sum, entry) => sum + Number(entry.conflictCount || 0), 0),
      omittedItemCount: rows.reduce((sum, entry) => sum + Number(entry.omittedItemCount || 0), 0),
      acceptedRefreshVisible: acceptedRefresh,
      localMaterializationWitnessVisible: localMaterialized,
    },
    sourceDigest,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  workbench.workbenchDigest = digestFor("direct-memory-review-workbench@1", workbench);
  return workbench;
}

function assertDirectMemoryReviewWorkbenchSafe(workbench = {}) {
  if (!isPlainObject(workbench) || workbench.schema !== DIRECT_MEMORY_REVIEW_WORKBENCH_SCHEMA) {
    throw new Error("direct_memory_review_workbench_schema_mismatch");
  }
  const authority = objectOrEmpty(workbench.authority);
  const forbiddenTrueFlags = [
    "memoryMutationAllowed",
    "providerMemoryClaimAccepted",
    "providerCompactionAllowed",
    "automaticRefreshAllowed",
    "providerTransportAllowed",
    "workspaceMutationAllowed",
    "rawTextIncluded",
    "rawPathIncluded",
    "rawSecretIncluded",
  ];
  if (authority.displayOnly !== true || authority.rendererSafe !== true) {
    throw new Error("direct_memory_review_workbench_not_display_only");
  }
  for (const flag of forbiddenTrueFlags) {
    if (authority[flag] !== false) throw new Error(`direct_memory_review_workbench_authority_leak:${flag}`);
  }
  if (workbench.rawTextIncluded !== false || workbench.rawPathIncluded !== false || workbench.rawSecretIncluded !== false) {
    throw new Error("direct_memory_review_workbench_raw_exposure");
  }
  for (const entry of arrayOrEmpty(workbench.rows)) {
    if (entry.rawTextIncluded !== false || entry.rawPathIncluded !== false || entry.rawSecretIncluded !== false) {
      throw new Error(`direct_memory_review_workbench_row_raw_exposure:${entry.rowId || ""}`);
    }
  }
  return true;
}

module.exports = {
  DIRECT_MEMORY_REVIEW_WORKBENCH_ROW_SCHEMA,
  DIRECT_MEMORY_REVIEW_WORKBENCH_SCHEMA,
  assertDirectMemoryReviewWorkbenchSafe,
  buildDirectMemoryReviewWorkbench,
  stableStringify,
};
