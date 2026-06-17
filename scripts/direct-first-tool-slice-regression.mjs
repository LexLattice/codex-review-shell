#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  buildDirectToolActivationRegistry,
  validateDirectToolActivationRegistry,
} = require("../src/main/direct/headless/tool-activation-registry");
const {
  buildContextRemainingResultEnvelope,
  buildDirectFirstToolCallGate,
  buildDirectFirstToolSlice,
  validateDirectFirstToolCallGate,
  validateDirectFirstToolSlice,
} = require("../src/main/direct/headless/first-tool-slice");
const {
  validateDirectToolPromotionDecisionReport,
} = require("../src/main/direct/headless/tool-promotion-decision-report");

function promotionDecision({ decisionId, toolClassId, toolName, requestShapeFamily, authorityFamily }) {
  return {
    schema: "direct_tool_promotion_decision_row@1",
    decisionId,
    decisionDigest: `${decisionId}_digest`,
    sourceLiveSmokeRowDigest: `${decisionId}_smoke_digest`,
    sourceLiveSmokeRowId: `${decisionId}_smoke`,
    sourceSmokeStatus: "live_smoke_passed",
    scope: {
      toolClassId,
      toolName,
      toolSchemaVersion: "direct_tool_class@1",
      authorityFamily,
      requestShapeFamily,
      providerProfileId: "first_slice_provider_profile",
      modelId: "first-slice-model",
      runtimeTier: "headless_direct",
      localExecutorVersion: "first_slice_executor_fixture",
      authorityEnvelopeVersion: "authority_envelope@1",
      resultEnvelopeVersion: "tool_result_envelope@1",
    },
    state: "promotable",
    evidenceClass: "real_provider_full_loop",
    restrictions: [],
    requiredConditionsSatisfied: true,
    missingEvidence: [],
    blockerCodes: [],
    evidenceRefs: [{
      kind: "real_provider_full_loop_evidence",
      refId: `${decisionId}_evidence`,
      state: "passed",
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

function promotionReport() {
  const decisions = [
    promotionDecision({
      decisionId: "decision_read_file",
      toolClassId: "local_perception.workspace_read",
      toolName: "read_file",
      requestShapeFamily: "read_file",
      authorityFamily: "local_perception",
    }),
    promotionDecision({
      decisionId: "decision_get_context_remaining",
      toolClassId: "session_control.plan_and_context_witness",
      toolName: "get_context_remaining",
      requestShapeFamily: "context_status_or_control",
      authorityFamily: "session_control",
    }),
  ];
  return {
    schema: "direct_tool_promotion_decision_report@1",
    reportId: "first_slice_promotion_report",
    reportDigest: "first_slice_promotion_report_digest",
    generatedAt: "1970-01-01T00:00:00.000Z",
    sourceEvidence: {
      liveSmokeReportId: "first_slice_live_smoke",
      liveSmokeReportDigest: "first_slice_live_smoke_digest",
      toolConstitutionDigest: "first_slice_tool_constitution_digest",
      implementationDigest: "first_slice_implementation_digest",
      providerProfileDigest: "first_slice_provider_profile_digest",
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
      byState: { promotable: decisions.length },
      byEvidenceClass: { real_provider_full_loop: decisions.length },
      promotableToolClasses: decisions.map((decision) => decision.scope.toolClassId),
      restrictedToolClasses: [],
      blockedToolClasses: [],
      needsEvidenceToolClasses: [],
      notApplicableToolClasses: [],
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

function activationRequest(toolClassId, state, scopeKind) {
  return {
    toolClassId,
    state,
    activationEffect: state === "active" ? "allow" : "deny",
    activatedBy: "test_fixture",
    reason: `first_slice_${state}`,
    scope: {
      kind: scopeKind,
      projectId: scopeKind === "global_default" ? "" : "project_first_tool_slice_fixture",
      workThreadId: "",
      turnId: "",
      operatorId: "operator_first_tool_slice_fixture",
    },
  };
}

const report = promotionReport();
assert.deepEqual(validateDirectToolPromotionDecisionReport(report), [], "fixture promotion report should validate");

const activationRegistry = buildDirectToolActivationRegistry({
  promotionReport: report,
  projectId: "project_first_tool_slice_fixture",
  activationRequests: [
    activationRequest("local_perception.workspace_read", "active", "project_default"),
    activationRequest("session_control.plan_and_context_witness", "active", "global_default"),
  ],
  nowMs: 0,
});
assert.deepEqual(validateDirectToolActivationRegistry(activationRegistry), [], "activation registry should validate");
assert.equal(activationRegistry.summary.byState.active, 2, "two first-slice rows should be active");

const slice = buildDirectFirstToolSlice({
  activationRegistry,
  nowMs: 0,
});
assert.deepEqual(validateDirectFirstToolSlice(slice), [], "first tool slice should validate");
assert.equal(slice.declarationCount, 2, "slice should declare two tools");
assert.deepEqual(slice.summary.declaredToolNames.sort(), ["get_context_remaining", "read_file"]);
assert.equal(slice.providerRequestPatch.parallel_tool_calls, false, "parallel calls must stay disabled");
assert.equal(slice.providerRequestPatch.tools.length, 2, "provider request patch should contain two tools");
assert(slice.toolDeclarationDigest, "tool declaration digest should be frozen");
assert(slice.activationRegistryDigest === activationRegistry.registryDigest, "slice should cite activation registry digest");

const readGate = buildDirectFirstToolCallGate({
  slice,
  toolCall: {
    itemId: "tool_item_read",
    callId: "call_read",
    name: "read_file",
    arguments: JSON.stringify({ path: "README.md" }),
  },
});
assert.deepEqual(validateDirectFirstToolCallGate(readGate), [], "read_file gate should validate");
assert.equal(readGate.status, "accepted", "read_file should be accepted when declared and arguments are contained");
assert.equal(readGate.parsedArguments.path, "README.md", "read_file path should be normalized");
assert.equal(readGate.perCallAuthorityRequired, true, "read_file still requires per-call authority");

const escapedReadGate = buildDirectFirstToolCallGate({
  slice,
  toolCall: {
    itemId: "tool_item_escape",
    callId: "call_escape",
    name: "read_file",
    arguments: JSON.stringify({ path: "../secrets.txt" }),
  },
});
assert.equal(escapedReadGate.status, "blocked", "path escape should be blocked before local execution");
assert(escapedReadGate.blockerCodes.includes("invalid_read_file_path"), "path escape blocker should be explicit");

const encodedEscapedReadGate = buildDirectFirstToolCallGate({
  slice,
  toolCall: {
    itemId: "tool_item_encoded_escape",
    callId: "call_encoded_escape",
    name: "read_file",
    arguments: JSON.stringify({ path: "%2e%2e%2fsecrets.txt" }),
  },
});
assert.equal(encodedEscapedReadGate.status, "blocked", "encoded path escape should be blocked before local execution");
assert(encodedEscapedReadGate.blockerCodes.includes("invalid_read_file_path"), "encoded path escape blocker should be explicit");

const undeclaredGate = buildDirectFirstToolCallGate({
  slice,
  toolCall: {
    itemId: "tool_item_patch",
    callId: "call_patch",
    name: "apply_patch",
    arguments: JSON.stringify({ patch: "diff --git a/a b/a" }),
  },
});
assert.equal(undeclaredGate.status, "blocked", "non-first-slice tools should stay undeclared");
assert(undeclaredGate.blockerCodes.includes("tool_not_declared:apply_patch"), "undeclared tool blocker should be explicit");

const contextGate = buildDirectFirstToolCallGate({
  slice,
  toolCall: {
    itemId: "tool_item_context",
    callId: "call_context",
    name: "get_context_remaining",
    arguments: JSON.stringify({ detail: "full" }),
  },
});
assert.deepEqual(validateDirectFirstToolCallGate(contextGate), [], "context gate should validate");
assert.equal(contextGate.status, "accepted", "get_context_remaining should be accepted when declared");

const rawResponsesContextGate = buildDirectFirstToolCallGate({
  slice,
  toolCall: {
    id: "provider_item_context",
    call_id: "provider_call_context",
    name: "get_context_remaining",
    arguments: JSON.stringify({ detail: "compact" }),
  },
});
assert.equal(rawResponsesContextGate.status, "accepted", "raw Responses tool call should be accepted when declared");
assert.equal(rawResponsesContextGate.callId, "provider_call_context", "provider call_id should be echoed as callId");
assert.equal(rawResponsesContextGate.providerItemId, "provider_item_context", "provider item id should stay distinct");

const contextEnvelope = buildContextRemainingResultEnvelope({
  gate: contextGate,
  projectId: "project_first_tool_slice_fixture",
  threadId: "thread_first_tool_slice_fixture",
  turnId: "turn_first_tool_slice_fixture",
  contextRemainingInput: {
    tokensLeft: 12345,
    confidence: "derived",
    estimateKind: "budget_policy_estimate",
    source: "first_slice_fixture_estimate",
  },
  nowMs: 0,
});
assert.equal(contextEnvelope.status, "ready_for_provider_continuation", "context result should be continuation-ready");
assert.equal(contextEnvelope.providerOutput.tokensLeft, 12345, "context result should include estimate");
assert.equal(contextEnvelope.providerOutput.permissionToContinue, false, "context estimate must not authorize continuation");
assert.equal(contextEnvelope.providerOutput.compactionAuthority, false, "context estimate must not authorize compaction");
assert.equal(contextEnvelope.rawResultIncluded, false, "context result must not expose raw result");

const revokedRegistry = buildDirectToolActivationRegistry({
  promotionReport: report,
  projectId: "project_first_tool_slice_fixture",
  activationRequests: [
    activationRequest("local_perception.workspace_read", "revoked", "project_default"),
    activationRequest("session_control.plan_and_context_witness", "active", "global_default"),
  ],
  nowMs: 0,
});
const revokedSlice = buildDirectFirstToolSlice({
  activationRegistry: revokedRegistry,
  nowMs: 0,
});
assert.deepEqual(validateDirectFirstToolSlice(revokedSlice), [], "revoked slice should validate");
assert.equal(revokedSlice.declarations.some((row) => row.toolName === "read_file"), false, "revoked read_file must not be declared");
assert.equal(revokedSlice.declarations.some((row) => row.toolName === "get_context_remaining"), true, "active context status may remain declared");

console.log(JSON.stringify({
  ok: true,
  sliceId: slice.sliceId,
  declaredToolNames: slice.summary.declaredToolNames,
  toolDeclarationDigest: slice.toolDeclarationDigest,
  contextEnvelopeStatus: contextEnvelope.status,
}, null, 2));
