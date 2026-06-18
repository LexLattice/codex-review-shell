#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  buildToolCapabilityRegistry,
} = require("../src/main/direct/bridge/tool-capability-registry");
const {
  buildDirectToolActivationRegistry,
  validateDirectToolActivationRegistry,
} = require("../src/main/direct/headless/tool-activation-registry");
const {
  buildDirectFirstToolCallGate,
  buildDirectFirstToolSlice,
  validateDirectFirstToolSlice,
} = require("../src/main/direct/headless/first-tool-slice");
const {
  validateDirectToolPromotionDecisionReport,
} = require("../src/main/direct/headless/tool-promotion-decision-report");
const {
  buildResidentToolEpistemicCatalog,
  buildResidentToolEpistemicRows,
  validateResidentToolEpistemicCatalog,
} = require("../src/main/direct/bridge/resident-tool-epistemic-catalog");

function promotionDecision({ decisionId, toolClassId, toolName, requestShapeFamily, authorityFamily, state = "promotable", evidenceClass = "real_provider_full_loop", blockerCodes = [], missingEvidence = [] }) {
  return {
    schema: "direct_tool_promotion_decision_row@1",
    decisionId,
    decisionDigest: `${decisionId}_digest`,
    sourceLiveSmokeRowDigest: `${decisionId}_smoke_digest`,
    sourceLiveSmokeRowId: `${decisionId}_smoke`,
    sourceSmokeStatus: state === "needs_more_evidence" ? "live_smoke_missing" : "live_smoke_passed",
    scope: {
      toolClassId,
      toolName,
      toolSchemaVersion: "direct_tool_class@1",
      authorityFamily,
      requestShapeFamily,
      providerProfileId: "resident_tool_fixture_provider_profile",
      modelId: "resident-tool-fixture-model",
      runtimeTier: "headless_direct",
      localExecutorVersion: "resident_tool_fixture_executor",
      authorityEnvelopeVersion: "authority_envelope@1",
      resultEnvelopeVersion: "tool_result_envelope@1",
    },
    state,
    evidenceClass,
    restrictions: state === "promotable_restricted"
      ? [{ kind: "headless_only", value: "true" }]
      : [],
    requiredConditionsSatisfied: state === "promotable" || state === "promotable_restricted",
    missingEvidence,
    blockerCodes,
    evidenceRefs: [{
      kind: `${evidenceClass}_evidence`,
      refId: `${decisionId}_evidence`,
      state: blockerCodes.length ? "blocked" : "passed",
      rendererSafe: true,
    }],
    negativeEvidence: {
      noRawExposure: true,
      noRendererAuthorityGrant: true,
      noOutOfContractProviderTransport: true,
      noOutOfContractWorkspaceEffect: true,
      noContextSmuggling: true,
      noReplayUnsafeState: true,
    },
    freshness: {
      generatedAt: "1970-01-01T00:00:00.000Z",
      expiresAt: "",
      staleIfToolConstitutionDigestChanges: true,
      staleIfExecutorDigestChanges: true,
      staleIfProviderProfileDigestChanges: true,
      staleIfResultEnvelopePolicyChanges: true,
    },
    rendererAuthorityGranted: false,
    activationGranted: false,
    runtimeDefaultChanged: false,
    providerCallStartedByDecision: false,
    workspaceMutationStartedByDecision: false,
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
  };
}

function promotionReport({ reportId = "resident_tool_promotion_report", decisions }) {
  return {
    schema: "direct_tool_promotion_decision_report@1",
    reportId,
    reportDigest: `${reportId}_digest`,
    generatedAt: "1970-01-01T00:00:00.000Z",
    sourceEvidence: {
      liveSmokeReportId: `${reportId}_live_smoke`,
      liveSmokeReportDigest: `${reportId}_live_smoke_digest`,
      toolConstitutionDigest: `${reportId}_tool_constitution_digest`,
      implementationDigest: `${reportId}_implementation_digest`,
      providerProfileDigest: `${reportId}_provider_profile_digest`,
    },
    status: "passed",
    validationErrors: [],
    decisionCount: decisions.length,
    decisions,
    rawExposureScan: {
      passed: true,
      blockedReasons: [],
    },
    summary: {
      byState: decisions.reduce((acc, decision) => {
        acc[decision.state] = (acc[decision.state] || 0) + 1;
        return acc;
      }, {}),
      byEvidenceClass: decisions.reduce((acc, decision) => {
        acc[decision.evidenceClass] = (acc[decision.evidenceClass] || 0) + 1;
        return acc;
      }, {}),
      promotableToolClasses: decisions.filter((decision) => decision.state === "promotable").map((decision) => decision.scope.toolClassId),
      restrictedToolClasses: decisions.filter((decision) => decision.state === "promotable_restricted").map((decision) => decision.scope.toolClassId),
      blockedToolClasses: decisions.filter((decision) => decision.state === "blocked").map((decision) => decision.scope.toolClassId),
      needsEvidenceToolClasses: decisions.filter((decision) => decision.state === "needs_more_evidence").map((decision) => decision.scope.toolClassId),
      notApplicableToolClasses: decisions.filter((decision) => decision.state === "not_applicable").map((decision) => decision.scope.toolClassId),
    },
    matrixPromotionCandidate: true,
    activationGranted: false,
    runtimeDefaultChanged: false,
    rendererAuthorityGranted: false,
    providerCallStartedByDecision: false,
    workspaceMutationStartedByDecision: false,
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
  };
}

function activationRequest(toolClassId, state, scopeKind = "project_default") {
  return {
    toolClassId,
    state,
    activationEffect: state === "active" ? "allow" : state === "shadow_only" ? "shadow" : state === "revoked" ? "revoke" : "deny",
    activatedBy: "test_fixture",
    reason: `resident_tool_${state}`,
    scope: {
      kind: scopeKind,
      projectId: scopeKind === "global_default" ? "" : "project_resident_tool_fixture",
      workThreadId: scopeKind === "work_thread_override" ? "work_thread_resident_tool_fixture" : "",
      turnId: "",
      operatorId: "operator_resident_tool_fixture",
    },
  };
}

function catalogRow(catalog, subjectId) {
  const row = catalog.rows.find((entry) => entry.subjectId === subjectId);
  assert(row, `missing resident tool row ${subjectId}`);
  return row;
}

const capabilityRegistry = buildToolCapabilityRegistry({
  projectId: "project_resident_tool_fixture",
  workThreadId: "work_thread_resident_tool_fixture",
  nowMs: 0,
});

const fullLoopReport = promotionReport({
  decisions: [
    promotionDecision({
      decisionId: "resident_decision_read_file",
      toolClassId: "local_perception.workspace_read",
      toolName: "read_file",
      requestShapeFamily: "read_file",
      authorityFamily: "local_perception",
    }),
    promotionDecision({
      decisionId: "resident_decision_get_context_remaining",
      toolClassId: "session_control.plan_and_context_witness",
      toolName: "get_context_remaining",
      requestShapeFamily: "context_status_or_control",
      authorityFamily: "session_control",
    }),
  ],
});
assert.deepEqual(validateDirectToolPromotionDecisionReport(fullLoopReport), [], "full-loop promotion report should validate");

const activeRegistry = buildDirectToolActivationRegistry({
  promotionReport: fullLoopReport,
  projectId: "project_resident_tool_fixture",
  workThreadId: "work_thread_resident_tool_fixture",
  activationRequests: [
    activationRequest("local_perception.workspace_read", "active", "project_default"),
    activationRequest("session_control.plan_and_context_witness", "active", "global_default"),
  ],
  nowMs: 0,
});
assert.deepEqual(validateDirectToolActivationRegistry(activeRegistry), [], "active activation registry should validate");

const firstToolSlice = buildDirectFirstToolSlice({ activationRegistry: activeRegistry, nowMs: 0 });
assert.deepEqual(validateDirectFirstToolSlice(firstToolSlice), [], "first tool slice should validate");

const callableCatalog = buildResidentToolEpistemicCatalog({
  capabilityRegistry,
  activationRegistry: activeRegistry,
  firstToolSlice,
  projectId: "project_resident_tool_fixture",
  workThreadId: "work_thread_resident_tool_fixture",
  projectionBudget: { maxRows: 6, maxChars: 900, truncationPolicy: "priority_then_summary" },
  nowMs: 0,
});
assert.deepEqual(validateResidentToolEpistemicCatalog(callableCatalog), [], "callable catalog should validate");
assert.equal(callableCatalog.contextInjectionEnabled, false, "catalog must not inject context by default");
assert.equal(callableCatalog.providerDeclarationsEnabledByCatalog, false, "catalog must not build provider declarations");
assert.equal(callableCatalog.localExecutionEnabledByCatalog, false, "catalog must not enable local execution");
assert.equal(callableCatalog.preview.contextInjectionEnabled, false, "preview must remain display/context-policy inert");
assert.equal(callableCatalog.preview.byStatus.callable_now, 2, "two first-slice tools should be callable");

const readRow = catalogRow(callableCatalog, "direct.read_file");
assert.equal(readRow.status, "callable_now", "read_file should be callable when activation and declaration are present");
assert.equal(readRow.callableInCurrentRequest, true, "callable read_file should set request callable flag");
assert.equal(readRow.declaredAsProviderTool, true, "callable read_file should cite provider declaration");
assert.equal(readRow.perCallAuthorityRequired, true, "callable read_file must still require per-call authority");
assert.equal(readRow.authorityUse, "may_prepare_call", "callable row may prepare call but not bypass authority");
assert(readRow.evidenceRefs.some((ref) => ref.source === "activation_registry"), "read row should cite activation evidence");
assert(readRow.evidenceRefs.some((ref) => ref.source === "promotion_decision"), "read row should cite promotion evidence");
assert(readRow.evidenceRefs.some((ref) => ref.source === "tool_declaration"), "read row should cite declaration evidence");

const contextRow = catalogRow(callableCatalog, "vanilla.get_context_remaining");
assert.equal(contextRow.status, "callable_now", "get_context_remaining alias should resolve to the active first-slice declaration");
assert.equal(contextRow.extensions.toolName, "get_context_remaining", "context alias should preserve provider tool name");

const noDeclarationCatalog = buildResidentToolEpistemicCatalog({
  capabilityRegistry,
  activationRegistry: activeRegistry,
  projectId: "project_resident_tool_fixture",
  workThreadId: "work_thread_resident_tool_fixture",
  nowMs: 0,
});
assert.deepEqual(validateResidentToolEpistemicCatalog(noDeclarationCatalog), [], "no-declaration catalog should validate");
assert.equal(catalogRow(noDeclarationCatalog, "direct.read_file").status, "blocked_by_missing_evidence", "active registry without request declaration is not callable");

const blockedGate = buildDirectFirstToolCallGate({
  slice: firstToolSlice,
  toolCall: {
    itemId: "resident_tool_bad_read",
    callId: "resident_tool_bad_read_call",
    name: "read_file",
    arguments: JSON.stringify({ path: "../secret.txt" }),
  },
});
const blockedGateCatalog = buildResidentToolEpistemicCatalog({
  capabilityRegistry,
  activationRegistry: activeRegistry,
  firstToolSlice,
  perCallGates: [blockedGate],
  projectId: "project_resident_tool_fixture",
  workThreadId: "work_thread_resident_tool_fixture",
  nowMs: 0,
});
assert.deepEqual(validateResidentToolEpistemicCatalog(blockedGateCatalog), [], "blocked gate catalog should validate");
assert.equal(catalogRow(blockedGateCatalog, "direct.read_file").status, "blocked_by_policy", "blocked per-call gate should downgrade the row");
assert(catalogRow(blockedGateCatalog, "direct.read_file").blockerCodes.includes("invalid_read_file_path"), "blocked gate reason should be resident-visible");

const restrictedReport = promotionReport({
  reportId: "resident_tool_restricted_report",
  decisions: [
    promotionDecision({
      decisionId: "resident_restricted_read",
      toolClassId: "local_perception.workspace_read",
      toolName: "read_file",
      requestShapeFamily: "read_file",
      authorityFamily: "local_perception",
      state: "promotable_restricted",
      evidenceClass: "diagnostic_only",
    }),
  ],
});
assert.deepEqual(validateDirectToolPromotionDecisionReport(restrictedReport), [], "restricted promotion report should validate");
const restrictedRegistry = buildDirectToolActivationRegistry({
  promotionReport: restrictedReport,
  projectId: "project_resident_tool_fixture",
  activationRequests: [activationRequest("local_perception.workspace_read", "active", "project_default")],
  nowMs: 0,
});
assert.deepEqual(validateDirectToolActivationRegistry(restrictedRegistry), [], "restricted registry should validate");
const restrictedCatalog = buildResidentToolEpistemicCatalog({
  capabilityRegistry,
  activationRegistry: restrictedRegistry,
  projectId: "project_resident_tool_fixture",
  workThreadId: "work_thread_resident_tool_fixture",
  nowMs: 0,
});
assert.equal(catalogRow(restrictedCatalog, "direct.read_file").status, "shadow_only", "restricted activation should be resident-visible as shadow-only");
assert(catalogRow(restrictedCatalog, "direct.read_file").enablementPath.some((step) => step.kind === "live_probe"), "shadow row should expose evidence enablement path");

const disabledRow = catalogRow(callableCatalog, "vanilla.apply_patch");
assert(["known_available", "known_disabled", "not_implemented", "blocked_by_missing_evidence"].includes(disabledRow.status), "non-active tools should be visibly non-callable");
assert.equal(disabledRow.callableInCurrentRequest, false, "disabled tool must not be callable");

const unsupportedRow = catalogRow(callableCatalog, "vanilla.multi_agent_v1.spawn_agent");
assert.equal(unsupportedRow.status, "not_implemented", "unsupported multi-agent primitive should be explicit");
assert(unsupportedRow.enablementPath.some((step) => step.kind === "implementation_required"), "unsupported row should expose implementation-required enablement path");

assert(callableCatalog.snapshot.omittedClassCounts.tool >= 1, "budgeted compact preview should count omitted tool rows");
assert(callableCatalog.snapshot.compactResidentText.includes("Harness epistemic witness:"), "compact preview should use resident witness text");

const mutated = { ...callableCatalog, contextInjectionEnabled: true };
assert(validateResidentToolEpistemicCatalog(mutated).includes("resident_tool_epistemic_authority_or_raw_leak:contextInjectionEnabled"), "context injection leak should be rejected");

const rowsOnly = buildResidentToolEpistemicRows({ capabilityRegistry, activationRegistry: activeRegistry, firstToolSlice });
assert(rowsOnly.some((row) => row.subjectId === "direct.read_file" && row.status === "callable_now"), "row builder should work independently");

console.log("direct resident tool epistemic catalog regression passed");
