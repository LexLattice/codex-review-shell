"use strict";

const crypto = require("node:crypto");

const DIRECT_WORKSPACE_EFFECT_SUMMARY_SCHEMA = "direct_workspace_effect_summary@1";
const DIRECT_WORKSPACE_POLICY_EVALUATION_SCHEMA = "direct_workspace_policy_evaluation@1";
const DIRECT_WORKSPACE_MUTATION_POLICY_SNAPSHOT_SCHEMA = "direct_workspace_mutation_policy_snapshot@1";
const DIRECT_PATCH_JOURNAL_INSPECTION_SCHEMA = "direct_patch_journal_inspection@1";
const DIRECT_WORKSPACE_EFFECT_PROVIDER_ENVELOPE_SCHEMA = "direct_workspace_effect_provider_envelope@1";
const DIRECT_WORKSPACE_MUTATION_REPORT_SCHEMA = "direct_workspace_mutation_regression_report@1";
const DIRECT_WORKSPACE_MUTATION_POLICY_VERSION = "direct-workspace-mutation-policy@1";
const DIRECT_WORKSPACE_EFFECT_SCANNER_VERSION = "direct-workspace-effect-scanner@1";
const DIRECT_WORKSPACE_PATH_CLASSIFIER_VERSION = "direct-workspace-path-classifier@1";

const DEFAULT_DIRECT_WORKSPACE_MUTATION_CAPS = Object.freeze({
  maxEffectChangedPaths: 200,
  maxEffectPreviewPaths: 50,
  maxPatchChangedFiles: 20,
  maxPatchAddedLines: 1200,
  maxPatchRemovedLines: 1200,
  maxCommandChangedPaths: 50,
  maxPolicyWarningPaths: 25,
  maxProviderEffectSummaryChars: 16 * 1024,
  maxRendererEffectSummaryChars: 24 * 1024,
});

const POLICY_DECISION_RANK = Object.freeze({
  allow: 0,
  allow_with_warning: 1,
  extra_confirmation_required: 2,
  degrade_to_read_only: 3,
  manual_recovery_required: 4,
  block: 5,
});

const DEFAULT_SCAN_CAPABILITIES = Object.freeze({
  seesTrackedFiles: true,
  seesUntrackedFiles: true,
  seesIgnoredFiles: false,
  seesDeletedFiles: true,
  seesModeChanges: false,
  seesSymlinks: false,
  seesCaseOnlyRenames: false,
  seesContentDigests: true,
});

const PATCH_JOURNAL_SCAN_CAPABILITIES = Object.freeze({
  seesTrackedFiles: false,
  seesUntrackedFiles: false,
  seesIgnoredFiles: false,
  seesDeletedFiles: false,
  seesModeChanges: false,
  seesSymlinks: false,
  seesCaseOnlyRenames: false,
  seesContentDigests: false,
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isPlainObject(value)) {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) output[key] = stableValue(value[key]);
    }
    return output;
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function digestValue(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
}

function safeRelPath(value) {
  const text = normalizeString(value, "").replace(/\\/g, "/");
  const normalized = text.replace(/^\/+/, "").split("/").filter(Boolean).join("/");
  if (!normalized || normalized === ".") return "";
  return normalized;
}

function evidenceKeyForPath(relPath) {
  return `path_${sha256(safeRelPath(relPath)).slice(0, 24)}`;
}

function classifyWorkspacePath(relPath) {
  const rawText = String(relPath || "").replace(/\\/g, "/");
  const path = safeRelPath(relPath);
  const lower = path.toLowerCase();
  if (!path) return { pathClass: "unknown", decision: "allow_with_warning", reasonCode: "path_empty" };
  if (/^[a-z]:/i.test(rawText) || rawText.startsWith("/") || rawText.startsWith("//") || path.split("/").includes("..")) {
    return { pathClass: "outside_workspace", decision: "block", reasonCode: "path_outside_workspace" };
  }
  if (lower === ".git" || lower.startsWith(".git/") || lower === ".hg" || lower.startsWith(".hg/") || lower === ".svn" || lower.startsWith(".svn/")) {
    return { pathClass: "vcs_internal", decision: "block", reasonCode: "vcs_internal_path" };
  }
  if (lower.includes("codex review shell/") || lower.includes(".config/codex review shell/") || lower.includes("direct-") && lower.includes("-runs/")) {
    return { pathClass: "app_private", decision: "block", reasonCode: "app_private_path" };
  }
  if (
    lower === ".env" ||
    lower.startsWith(".env.") ||
    lower.endsWith(".pem") ||
    lower.endsWith(".key") ||
    lower === ".ssh" ||
    lower.startsWith(".ssh/")
  ) {
    return { pathClass: "secret_like", decision: "block", reasonCode: "secret_like_path" };
  }
  if (lower.includes("node_modules/") || lower === "node_modules") {
    return { pathClass: "dependency_dir", decision: "block", reasonCode: "dependency_dir_path" };
  }
  if (lower.startsWith("vendor/") || lower === "vendor") return { pathClass: "vendor", decision: "block", reasonCode: "vendor_path" };
  if (lower.startsWith("dist/") || lower === "dist" || lower.startsWith("build/") || lower === "build") {
    return { pathClass: "build_output", decision: "block", reasonCode: "build_output_path" };
  }
  if (lower.startsWith("coverage/") || lower === "coverage") {
    return { pathClass: "coverage_output", decision: "block", reasonCode: "coverage_output_path" };
  }
  if (lower.startsWith("generated/") || lower === "generated" || lower.includes("/generated/")) {
    return { pathClass: "generated", decision: "block", reasonCode: "generated_path" };
  }
  if (
    lower.endsWith(".lock") ||
    lower === "package-lock.json" ||
    lower === "pnpm-lock.yaml" ||
    lower === "yarn.lock" ||
    lower === "bun.lockb"
  ) {
    return { pathClass: "lockfile", decision: "block", reasonCode: "lockfile_path" };
  }
  if (lower.startsWith("test/") || lower.startsWith("tests/") || lower.includes(".test.") || lower.includes(".spec.")) {
    return { pathClass: "test", decision: "allow", reasonCode: "test_path" };
  }
  if (lower.startsWith("docs/") || lower.endsWith(".md") || lower.endsWith(".mdx")) {
    return { pathClass: "docs", decision: "allow", reasonCode: "docs_path" };
  }
  if (["package.json", "tsconfig.json", "jsconfig.json"].includes(lower) || lower.startsWith(".github/")) {
    return { pathClass: "config", decision: "allow_with_warning", reasonCode: "config_path" };
  }
  return { pathClass: "source", decision: "allow", reasonCode: "source_path" };
}

function strictestDecision(decisions = []) {
  let strictest = "allow";
  for (const decision of decisions) {
    const normalized = normalizeString(decision, "allow");
    if ((POLICY_DECISION_RANK[normalized] ?? 0) > (POLICY_DECISION_RANK[strictest] ?? 0)) strictest = normalized;
  }
  return strictest;
}

function buildPolicySnapshot(input = {}) {
  const snapshot = {
    schema: DIRECT_WORKSPACE_MUTATION_POLICY_SNAPSHOT_SCHEMA,
    policyDigest: normalizeString(input.policyDigest, "") || digestValue({
      policy: DIRECT_WORKSPACE_MUTATION_POLICY_VERSION,
      caps: input.caps || DEFAULT_DIRECT_WORKSPACE_MUTATION_CAPS,
    }),
    sensitivePathPolicyDigest: normalizeString(input.sensitivePathPolicyDigest, "sensitive_path_policy_default@1"),
    generatedVendorLockfilePolicyDigest: normalizeString(input.generatedVendorLockfilePolicyDigest, "generated_vendor_lockfile_policy_default_block@1"),
    commandWorkspaceWritePolicyDigest: normalizeString(input.commandWorkspaceWritePolicyDigest, "command_workspace_write_policy_warn@1"),
    capPolicyDigest: normalizeString(input.capPolicyDigest, "workspace_mutation_caps_default@1"),
    networkRiskPolicyDigest: normalizeString(input.networkRiskPolicyDigest, "network_helpers_blocked_not_sandboxed@1"),
    backendCapabilityDigest: normalizeString(input.backendCapabilityDigest, "backend_capabilities_unknown@1"),
    pathClassifierVersion: DIRECT_WORKSPACE_PATH_CLASSIFIER_VERSION,
    effectScannerVersion: DIRECT_WORKSPACE_EFFECT_SCANNER_VERSION,
  };
  return snapshot;
}

function defaultCapabilities(input = {}) {
  return {
    canonicalRootSupported: input.canonicalRootSupported !== false,
    realpathContainmentSupported: input.realpathContainmentSupported !== false,
    pathEvidenceKeySupported: input.pathEvidenceKeySupported !== false,
    workspaceIndexScanSupported: input.workspaceIndexScanSupported === true,
    gitStatusScanSupported: input.gitStatusScanSupported === true,
    patchJournalInspectionSupported: input.patchJournalInspectionSupported !== false,
    commandWorkspaceEffectScanSupported: input.commandWorkspaceEffectScanSupported !== false,
    processTreeKillSupported: input.processTreeKillSupported === true,
    networkIsolationSupported: input.networkIsolationSupported === true,
    envSanitizationSupported: input.envSanitizationSupported !== false,
  };
}

function scanCapabilitiesForScope(scanScope, input = {}) {
  if (isPlainObject(input.scanCapabilities)) return { ...DEFAULT_SCAN_CAPABILITIES, ...input.scanCapabilities };
  if (scanScope === "patch-journal") return { ...PATCH_JOURNAL_SCAN_CAPABILITIES };
  if (scanScope === "git-status") return { ...DEFAULT_SCAN_CAPABILITIES, seesIgnoredFiles: false, seesContentDigests: false };
  if (scanScope === "workspace-index" || scanScope === "backend-native") return { ...DEFAULT_SCAN_CAPABILITIES };
  return {
    seesTrackedFiles: false,
    seesUntrackedFiles: false,
    seesIgnoredFiles: false,
    seesDeletedFiles: false,
    seesModeChanges: false,
    seesSymlinks: false,
    seesCaseOnlyRenames: false,
    seesContentDigests: false,
  };
}

function normalizeRawChange(change = {}, fallbackExpectation = "unknown") {
  const relPath = safeRelPath(change.relPath || change.path || change.displayPath);
  const classification = classifyWorkspacePath(relPath);
  const changeKind = normalizeString(change.changeKind || change.operation, "modified");
  const sourceExpectation = normalizeString(change.sourceExpectation, fallbackExpectation);
  const providerVisibility = normalizeString(change.providerVisibility, "summary_only");
  return {
    relPath,
    canonicalEvidenceKey: normalizeString(change.canonicalEvidenceKey, "") || evidenceKeyForPath(relPath),
    changeKind: ["created", "modified", "deleted", "renamed", "mode_changed", "unknown"].includes(changeKind) ? changeKind : "modified",
    sourceExpectation,
    beforeEvidenceKey: normalizeString(change.beforeEvidenceKey || change.beforeDigest, ""),
    afterEvidenceKey: normalizeString(change.afterEvidenceKey || change.afterDigest, ""),
    policyClass: classification.pathClass,
    policyDecision: classification.decision,
    policyReasonCode: classification.reasonCode,
    providerVisibility,
    rendererPreviewAllowed: classification.decision !== "block",
    providerSummaryAllowed: classification.decision !== "block",
  };
}

function visibilityFromChanges(changes = [], input = {}) {
  const changedPathsDetected = changes.length;
  const summaryOnlyPathCount = changes.filter((change) => change.providerVisibility === "summary_only").length;
  const contentSeenAfterChangePathCount = changes.filter((change) =>
    change.providerVisibility === "content_seen_after_change" || change.providerVisibility === "content_partially_seen_after_change",
  ).length;
  const notSeenPathCount = changes.filter((change) => change.providerVisibility === "not_seen").length;
  const unknownChangedContentsCount = changes.filter((change) => change.providerVisibility === "unknown").length;
  let providerVisibilityCompleteness = "none";
  if (changedPathsDetected > 0 && contentSeenAfterChangePathCount === changedPathsDetected) providerVisibilityCompleteness = "all_policy_relevant_content";
  else if (contentSeenAfterChangePathCount > 0) providerVisibilityCompleteness = "partial_content";
  else if (summaryOnlyPathCount > 0) providerVisibilityCompleteness = "summary_only";
  else if (unknownChangedContentsCount > 0) providerVisibilityCompleteness = "unknown";
  return {
    changedPathsDetected,
    providerWasToldSummary: input.providerWasToldSummary !== false && changedPathsDetected > 0,
    providerSawChangedFileContents: providerVisibilityCompleteness === "partial_content" || providerVisibilityCompleteness === "all_policy_relevant_content",
    providerSawAllChangedFileContents: providerVisibilityCompleteness === "all_policy_relevant_content",
    providerVisibilityCompleteness,
    summaryOnlyPathCount,
    notSeenPathCount,
    contentSeenAfterChangePathCount,
    unknownChangedContentsCount,
    visibilityEvents: Array.isArray(input.visibilityEvents) ? input.visibilityEvents : [],
    visibilitySource: normalizeString(input.visibilitySource, "effect-summary"),
  };
}

function policyEvaluationForChanges(changes = [], input = {}) {
  const decisions = changes.map((change) => ({
    relPath: change.relPath,
    canonicalEvidenceKey: change.canonicalEvidenceKey,
    pathClass: change.policyClass,
    action: normalizeString(input.action, "provider_summary"),
    decision: change.policyDecision,
    reasonCode: normalizeString(change.policyReasonCode, ""),
  }));
  return {
    schema: DIRECT_WORKSPACE_POLICY_EVALUATION_SCHEMA,
    policyDigest: buildPolicySnapshot(input.policySnapshot || input).policyDigest,
    evaluatedAt: normalizeString(input.evaluatedAt, nowIso(input.nowMs)),
    decisions,
    hardBlockCount: decisions.filter((decision) => decision.decision === "block").length,
    warningCount: decisions.filter((decision) => decision.decision !== "allow").length,
    strictestDecision: strictestDecision(decisions.map((decision) => decision.decision)),
  };
}

function effectSummaryIdFor(input = {}) {
  return `workspace_effect_${sha256(`${normalizeString(input.source, "")}:${normalizeString(input.sourceArtifactId, "")}:${stableJson(input.changes || [])}`).slice(0, 24)}`;
}

function positiveInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function buildWorkspaceEffectSummary(input = {}) {
  const source = normalizeString(input.source, "manual_fixture");
  const rawChanges = Array.isArray(input.changes) ? input.changes : [];
  const sourceArtifactId = normalizeString(input.sourceArtifactId, "");
  const scanScope = normalizeString(input.scanScope, rawChanges.length ? "workspace-index" : "none");
  const scanFailed = input.scanFailed === true;
  const preState = isPlainObject(input.preState) ? input.preState : null;
  const postState = isPlainObject(input.postState) ? input.postState : null;
  const preStateConfidence = normalizeString(input.preStateConfidence, preState ? "exact" : (scanScope === "patch-journal" ? "derived" : "missing"));
  const expectationConfidence = normalizeString(
    input.expectationConfidence,
    preStateConfidence === "exact" ? "exact" : (source === "patch_apply" ? "derived_from_patch_plan" : "unknown_due_to_missing_prestate"),
  );
  const changes = rawChanges.map((change) => normalizeRawChange(change, source === "patch_apply" ? "expected_patch_change" : "expected_command_change"));
  const caps = { ...DEFAULT_DIRECT_WORKSPACE_MUTATION_CAPS, ...(isPlainObject(input.caps) ? input.caps : {}) };
  const reportedChangedPathCount = Math.max(positiveInteger(input.changedPathCount, changes.length), changes.length);
  const omittedChangeCount = Math.max(0, reportedChangedPathCount - changes.length);
  const changedPathsPreview = changes.filter((change) => change.providerSummaryAllowed).slice(0, caps.maxEffectPreviewPaths).map((change) => ({
    relPath: change.relPath,
    changeKind: change.changeKind,
    policyClass: change.policyClass,
    expected: change.sourceExpectation === "expected_patch_change" || change.sourceExpectation === "expected_command_change",
    providerVisibility: change.providerVisibility,
  }));
  const policyEvaluation = policyEvaluationForChanges(changes, {
    ...input,
    action: source === "patch_apply" ? "patch_apply" : "command_effect",
  });
  if (omittedChangeCount > 0) {
    policyEvaluation.warningCount += omittedChangeCount;
    policyEvaluation.unknownPolicyRelevantChangeCount = omittedChangeCount;
    policyEvaluation.strictestDecision = strictestDecision([policyEvaluation.strictestDecision, "manual_recovery_required"]);
  }
  const providerVisibility = visibilityFromChanges(changes, input);
  const effectSummaryId = normalizeString(input.effectSummaryId, "") || effectSummaryIdFor({ ...input, source, sourceArtifactId, changes });
  const baselineDirtyState = isPlainObject(input.baselineDirtyState)
    ? input.baselineDirtyState
    : {
        captured: preStateConfidence === "exact",
        dirtyPathCount: 0,
        dirtyPathsPreview: [],
        dirtyPathsTruncated: false,
      };
  return {
    schema: DIRECT_WORKSPACE_EFFECT_SUMMARY_SCHEMA,
    effectSummaryId,
    projectId: normalizeString(input.projectId, ""),
    sessionId: normalizeString(input.sessionId, ""),
    turnId: normalizeString(input.turnId, ""),
    loopId: normalizeString(input.loopId, ""),
    stepId: normalizeString(input.stepId, ""),
    stepOrdinal: Number(input.stepOrdinal || 0) || undefined,
    source,
    sourceArtifactId,
    sourceOperationId: normalizeString(input.sourceOperationId, ""),
    scan: {
      supported: input.scanSupported !== false && scanScope !== "none",
      ran: input.scanRan !== false && scanScope !== "none",
      scanScope,
      scanVersion: normalizeString(input.scanVersion, DIRECT_WORKSPACE_EFFECT_SCANNER_VERSION),
      scanFailed,
      scanFailureCode: normalizeString(input.scanFailureCode, ""),
      startedAt: normalizeString(input.scanStartedAt, ""),
      completedAt: normalizeString(input.scanCompletedAt, nowIso(input.nowMs)),
      scanInputDigest: normalizeString(input.scanInputDigest, "") || digestValue({ source, sourceArtifactId, rawChanges }),
      scanPolicyDigest: buildPolicySnapshot(input.policySnapshot || input).policyDigest,
      workspaceBindingEvidenceKey: normalizeString(input.workspaceBindingEvidenceKey, "workspace_binding_unknown"),
      sourceArtifactDigest: normalizeString(input.sourceArtifactDigest, "") || digestValue({ sourceArtifactId, source }),
      capabilities: scanCapabilitiesForScope(scanScope, input),
      consistency: normalizeString(input.scanConsistency, "stable"),
    },
    preState: preState || undefined,
    postState: postState || undefined,
    preStateConfidence,
    expectationConfidence,
    baselineDirtyState,
    changes,
    changedPathCount: reportedChangedPathCount,
    knownChangedPathCount: changes.length,
    omittedChangeCount,
    unknownPolicyRelevantChangeCount: omittedChangeCount,
    changedPathsPreview,
    changedPathsTruncated: input.changedPathsTruncated === true || reportedChangedPathCount > changedPathsPreview.length,
    expectedChangeCount: changes.filter((change) => change.sourceExpectation === "expected_patch_change" || change.sourceExpectation === "expected_command_change").length,
    unexpectedChangeCount: changes.filter((change) => change.sourceExpectation === "unexpected_extra_change").length,
    blockedChangeCount: changes.filter((change) => change.policyDecision === "block").length,
    sensitiveChangeCount: changes.filter((change) => change.policyClass === "secret_like" || change.policyClass === "app_private" || change.policyClass === "vcs_internal").length,
    generatedOrVendorChangeCount: changes.filter((change) => ["generated", "vendor", "dependency_dir", "build_output", "coverage_output"].includes(change.policyClass)).length,
    lockfileChangeCount: changes.filter((change) => change.policyClass === "lockfile").length,
    providerVisibility,
    policyEvaluation,
    rendererSafeSummary: {
      changedPathCount: reportedChangedPathCount,
      knownChangedPathCount: changes.length,
      omittedChangeCount,
      changedPathsPreview,
      changedPathsTruncated: input.changedPathsTruncated === true || reportedChangedPathCount > changedPathsPreview.length,
      providerVisibilityCompleteness: providerVisibility.providerVisibilityCompleteness,
      strictestPolicyDecision: policyEvaluation.strictestDecision,
      rawPathsIncluded: false,
    },
    rawWorkspacePathExposed: false,
    rawContentIncluded: false,
    rawDigestExposedToRenderer: false,
    rawDigestExposedToProvider: false,
    retention: {
      class: "workspace-mutation-evidence",
      defaultExport: false,
      redactionRequiredForExport: true,
    },
  };
}

function changesFromCommandEffects(workspaceEffects = {}) {
  const preview = Array.isArray(workspaceEffects.changedPathsPreview) ? workspaceEffects.changedPathsPreview : [];
  return preview.map((entry) => ({
    relPath: entry.relPath || entry.path,
    changeKind: entry.changeKind || "modified",
    sourceExpectation: "expected_command_change",
    providerVisibility: "summary_only",
  }));
}

function buildCommandWorkspaceEffectSummary(input = {}) {
  const workspaceEffects = isPlainObject(input.workspaceEffects) ? input.workspaceEffects : {};
  const changes = Array.isArray(input.changes) ? input.changes : changesFromCommandEffects(workspaceEffects);
  const scanScope = normalizeString(workspaceEffects.scanScope || input.scanScope, changes.length ? "workspace-index" : "none");
  return buildWorkspaceEffectSummary({
    ...input,
    source: "run_command",
    sourceArtifactId: normalizeString(input.sourceArtifactId || input.resultId, ""),
    scanScope,
    scanFailed: workspaceEffects.scanFailed === true || input.scanFailed === true,
    scanSupported: scanScope !== "none",
    changedPathCount: positiveInteger(workspaceEffects.changedPathCount, changes.length),
    changedPathsTruncated: workspaceEffects.changedPathsTruncated === true,
    preState: workspaceEffects.preCommandWorkspaceDigest ? {
      evidenceKey: `workspace_state_${sha256(workspaceEffects.preCommandWorkspaceDigest).slice(0, 24)}`,
      algorithm: "backend-index",
      capturedAt: normalizeString(input.startedAt, ""),
      digestVisibleToRenderer: false,
      digestVisibleToProvider: false,
    } : input.preState,
    postState: workspaceEffects.postCommandWorkspaceDigest ? {
      evidenceKey: `workspace_state_${sha256(workspaceEffects.postCommandWorkspaceDigest).slice(0, 24)}`,
      algorithm: "backend-index",
      capturedAt: normalizeString(input.completedAt, ""),
      digestVisibleToRenderer: false,
      digestVisibleToProvider: false,
    } : input.postState,
    changes,
  });
}

function changesFromPatchFiles(files = []) {
  return files.map((file) => ({
    relPath: file.path || file.displayPath,
    changeKind: file.operation === "create" ? "created" : (file.operation === "delete" ? "deleted" : "modified"),
    sourceExpectation: file.expected === false ? "unexpected_extra_change" : "expected_patch_change",
    beforeEvidenceKey: file.beforeEvidenceKey || file.beforeDigest,
    afterEvidenceKey: file.afterEvidenceKey || file.afterDigest,
    providerVisibility: "summary_only",
  }));
}

function buildPatchWorkspaceEffectSummary(input = {}) {
  const files = Array.isArray(input.files) ? input.files : [];
  return buildWorkspaceEffectSummary({
    ...input,
    source: "patch_apply",
    sourceArtifactId: normalizeString(input.sourceArtifactId || input.resultId, ""),
    scanScope: normalizeString(input.scanScope, "patch-journal"),
    preStateConfidence: normalizeString(input.preStateConfidence, "derived"),
    expectationConfidence: normalizeString(input.expectationConfidence, "derived_from_patch_plan"),
    changes: Array.isArray(input.changes) ? input.changes : changesFromPatchFiles(files),
  });
}

function inspectPatchJournal(input = {}) {
  const files = Array.isArray(input.files) ? input.files : [];
  const plannedFiles = Array.isArray(input.plannedFiles) ? input.plannedFiles : files;
  const appliedFiles = Array.isArray(input.appliedFiles) ? input.appliedFiles : files;
  const effectSummary = input.effectSummary;
  const journalStatus = normalizeString(input.journalStatus || input.journal?.status, files.length ? "applied_verified" : "planned_only");
  const unexpectedChangesDetected = Number(effectSummary?.unexpectedChangeCount || 0) > 0;
  const beforeAfterEvidenceComplete = appliedFiles.every((file) => {
    const operation = normalizeString(file.operation, "update");
    const beforeOk = operation === "create" || Boolean(normalizeString(file.beforeEvidenceKey || file.beforeDigest, ""));
    const afterOk = operation === "delete" || Boolean(normalizeString(file.afterEvidenceKey || file.afterDigest, ""));
    return beforeOk && afterOk;
  });
  const appliedKeys = new Set(appliedFiles.map((file) =>
    `${safeRelPath(file.path || file.displayPath)}:${normalizeString(file.operation, "update")}`,
  ));
  const missingExpectedFiles = plannedFiles.filter((file) => file.expected !== false && !appliedKeys.has(
    `${safeRelPath(file.path || file.displayPath)}:${normalizeString(file.operation, "update")}`,
  ));
  return {
    schema: DIRECT_PATCH_JOURNAL_INSPECTION_SCHEMA,
    inspectionId: `patch_journal_inspection_${sha256(`${normalizeString(input.patchPlanId, "")}:${normalizeString(input.patchResultId, "")}:${journalStatus}`).slice(0, 24)}`,
    patchPlanId: normalizeString(input.patchPlanId, ""),
    patchResultId: normalizeString(input.patchResultId, ""),
    journalId: normalizeString(input.journalId || input.journal?.journalId, ""),
    journalState: journalStatus,
    plannedFiles: plannedFiles.map((file) => ({
      path: normalizeString(file.path || file.displayPath, ""),
      operation: normalizeString(file.operation, "update"),
    })),
    appliedFiles: appliedFiles.map((file) => ({
      path: normalizeString(file.path || file.displayPath, ""),
      operation: normalizeString(file.operation, "update"),
      beforeEvidenceKey: normalizeString(file.beforeEvidenceKey || file.beforeDigest, ""),
      afterEvidenceKey: normalizeString(file.afterEvidenceKey || file.afterDigest, ""),
    })),
    expectedWorkspaceEffectSummaryId: normalizeString(effectSummary?.effectSummaryId, ""),
    actualWorkspaceEffectSummaryId: normalizeString(effectSummary?.effectSummaryId, ""),
    unexpectedChangesDetected,
    missingExpectedChangesDetected: missingExpectedFiles.length > 0,
    missingExpectedFiles: missingExpectedFiles.map((file) => ({
      path: normalizeString(file.path || file.displayPath, ""),
      operation: normalizeString(file.operation, "update"),
    })),
    beforeAfterEvidenceComplete,
    userFacingRevertAvailable: false,
  };
}

function postSideEffectPolicyViolation(summary = {}, source = "", workspaceWritePolicy = "writes_possible_with_warning") {
  if (!isPlainObject(summary)) return "unknown";
  if (summary.sensitiveChangeCount > 0) {
    const hasAppPrivate = (summary.changes || []).some((change) => change.policyClass === "app_private");
    const hasVcs = (summary.changes || []).some((change) => change.policyClass === "vcs_internal");
    if (hasAppPrivate) return "app_private_path_changed";
    if (hasVcs) return "vcs_internal_changed";
    return "sensitive_path_changed";
  }
  if (summary.blockedChangeCount > 0) return "policy_blocked_path_changed";
  if (source === "run_command" && Number(summary.unknownPolicyRelevantChangeCount || 0) > 0) {
    return "workspace_changes_truncated_unknown";
  }
  if (source === "run_command" && workspaceWritePolicy === "must_not_write" && summary.changedPathCount > 0) {
    return "must_not_write_changed_files";
  }
  return "none";
}

function providerEnvelopeForEffectSummary(summary = {}, input = {}) {
  const providerVisibility = normalizeString(
    input.providerVisibility || summary.providerVisibility?.providerVisibilityCompleteness,
    summary.changedPathCount ? "summary_only" : "none",
  );
  return {
    schema: DIRECT_WORKSPACE_EFFECT_PROVIDER_ENVELOPE_SCHEMA,
    effectSummaryId: normalizeString(summary.effectSummaryId, ""),
    source: normalizeString(summary.source, "run_command"),
    changedPathCount: Number(summary.changedPathCount || 0),
    changedPathsPreview: Array.isArray(summary.changedPathsPreview) ? summary.changedPathsPreview : [],
    changedPathsTruncated: summary.changedPathsTruncated === true,
    omittedChangeCount: Number(summary.omittedChangeCount || 0),
    unknownPolicyRelevantChangeCount: Number(summary.unknownPolicyRelevantChangeCount || 0),
    expectedChangeCount: Number(summary.expectedChangeCount || 0),
    unexpectedChangeCount: Number(summary.unexpectedChangeCount || 0),
    policyBlockedChangeCount: Number(summary.blockedChangeCount || 0),
    providerVisibility: providerVisibility === "none" ? "summary_only" : providerVisibility,
    note: normalizeString(input.note, summary.changedPathCount
      ? "Workspace changed; provider saw a bounded summary, not changed file contents."
      : "Workspace effect scan recorded no changed paths."),
    rawPathsIncluded: false,
    rawFileContentsIncluded: false,
    rawDigestsIncluded: false,
  };
}

function workspaceEffectRecoveryState(result = {}) {
  if (!isPlainObject(result)) return "effect_summary_not_required";
  const summary = isPlainObject(result.workspaceEffectSummary) ? result.workspaceEffectSummary : null;
  if (!summary && (result.tool === "run_command" || result.tool === "apply_patch")) return "effect_summary_missing";
  if (!summary) return "effect_summary_not_required";
  if (summary.schema !== DIRECT_WORKSPACE_EFFECT_SUMMARY_SCHEMA) return "effect_summary_corrupt";
  if (summary.scan?.scanFailed === true) return "effect_summary_scan_failed";
  return "effect_summary_present_valid";
}

function validateWorkspaceMutationReport(report = {}) {
  if (!isPlainObject(report) || report.schema !== DIRECT_WORKSPACE_MUTATION_REPORT_SCHEMA) {
    throw new Error("Invalid direct workspace mutation report schema.");
  }
  if (!Array.isArray(report.cases)) throw new Error("Direct workspace mutation report cases must be an array.");
  for (const entry of report.cases) {
    const source = normalizeString(entry.coverageSource || report.coverageSource, "");
    if (!["real_provider", "real_runtime"].includes(source) && entry.matrixPromotionCandidate === true) {
      throw new Error(`Fixture/non-real case ${entry.caseId || "unknown"} cannot promote workspace mutation rows.`);
    }
    if (!["real_provider", "real_runtime"].includes(source) && entry.countsAsWorkspaceTruthProof === true) {
      throw new Error(`Fixture/non-real case ${entry.caseId || "unknown"} cannot count as workspace truth proof.`);
    }
  }
  return true;
}

module.exports = {
  DEFAULT_DIRECT_WORKSPACE_MUTATION_CAPS,
  DIRECT_PATCH_JOURNAL_INSPECTION_SCHEMA,
  DIRECT_WORKSPACE_EFFECT_PROVIDER_ENVELOPE_SCHEMA,
  DIRECT_WORKSPACE_EFFECT_SCANNER_VERSION,
  DIRECT_WORKSPACE_EFFECT_SUMMARY_SCHEMA,
  DIRECT_WORKSPACE_MUTATION_POLICY_SNAPSHOT_SCHEMA,
  DIRECT_WORKSPACE_MUTATION_POLICY_VERSION,
  DIRECT_WORKSPACE_MUTATION_REPORT_SCHEMA,
  DIRECT_WORKSPACE_PATH_CLASSIFIER_VERSION,
  DIRECT_WORKSPACE_POLICY_EVALUATION_SCHEMA,
  buildCommandWorkspaceEffectSummary,
  buildPatchWorkspaceEffectSummary,
  buildPolicySnapshot,
  buildWorkspaceEffectSummary,
  classifyWorkspacePath,
  defaultCapabilities,
  inspectPatchJournal,
  postSideEffectPolicyViolation,
  providerEnvelopeForEffectSummary,
  strictestDecision,
  validateWorkspaceMutationReport,
  workspaceEffectRecoveryState,
};
