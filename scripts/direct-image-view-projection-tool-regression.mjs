#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  buildViewImageProjection,
  DIRECT_VIEW_IMAGE_PROJECTION_SCHEMA,
} = require("../src/main/direct/tools/control-perception-decision-substrate");
const {
  buildDirectFirstToolCallGate,
  buildDirectFirstToolSlice,
  buildViewImageResultEnvelope,
  validateDirectFirstToolCallGate,
  validateDirectFirstToolSlice,
} = require("../src/main/direct/headless/first-tool-slice");
const {
  buildDirectToolActivationRegistry,
  validateDirectToolActivationRegistry,
} = require("../src/main/direct/headless/tool-activation-registry");
const {
  validateDirectToolPromotionDecisionReport,
} = require("../src/main/direct/headless/tool-promotion-decision-report");

function viewImagePromotionReport() {
  const decision = {
    schema: "direct_tool_promotion_decision_row@1",
    decisionId: "decision_view_image",
    decisionDigest: "decision_view_image_digest",
    sourceLiveSmokeRowDigest: "decision_view_image_smoke_digest",
    sourceLiveSmokeRowId: "decision_view_image_smoke",
    sourceSmokeStatus: "live_smoke_passed",
    scope: {
      toolClassId: "local_perception.image_view_metadata",
      toolName: "view_image",
      toolSchemaVersion: "direct_tool_class@1",
      authorityFamily: "local_perception",
      requestShapeFamily: "image_view_staging_envelope@1",
      providerProfileId: "view_image_provider_profile",
      modelId: "view-image-model",
      runtimeTier: "headless_direct",
      localExecutorVersion: "view_image_projection_fixture",
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
      refId: "decision_view_image_evidence",
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
  return {
    schema: "direct_tool_promotion_decision_report@1",
    reportId: "view_image_promotion_report",
    reportDigest: "view_image_promotion_report_digest",
    generatedAt: "1970-01-01T00:00:00.000Z",
    sourceEvidence: {
      liveSmokeReportId: "view_image_live_smoke",
      liveSmokeReportDigest: "view_image_live_smoke_digest",
      toolConstitutionDigest: "view_image_tool_constitution_digest",
      implementationDigest: "view_image_implementation_digest",
      providerProfileDigest: "view_image_provider_profile_digest",
    },
    status: "passed",
    validationErrors: [],
    decisionCount: 1,
    decisions: [decision],
    rawExposureScan: {
      passed: true,
      blockedReasons: [],
    },
    summary: {
      byState: { promotable: 1 },
      byEvidenceClass: { real_provider_full_loop: 1 },
      promotableToolClasses: ["local_perception.image_view_metadata"],
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

const pngProjection = buildViewImageProjection({
  projectId: "project_view_image_fixture",
  threadId: "thread_view_image_fixture",
  turnId: "turn_view_image_fixture",
  pathEvidenceKey: "path_evidence_png",
  displayName: "diagram.png",
  mimeType: "image/png",
  width: 640,
  height: 480,
  sizeBytes: 12_345,
  rendererPreviewAvailable: true,
  nowMs: 0,
});
assert.equal(pngProjection.schema, DIRECT_VIEW_IMAGE_PROJECTION_SCHEMA, "projection schema mismatch");
assert.equal(pngProjection.status, "metadata_only", "contained PNG should produce metadata-only projection");
assert.equal(pngProjection.residentPerceptionLevel, "renderer_preview_only", "renderer preview should be only a projection level");
assert.equal(pngProjection.providerVisibilityState, "metadata_only", "PNG metadata should not imply payload submission");
assert.equal(pngProjection.providerImagePayloadSupported, false, "provider image payload must stay unsupported");
assert.equal(pngProjection.modelSawPixels, false, "model must not be said to have seen pixels");
assert.equal(pngProjection.imagePayloadSent, false, "image payload must not be sent");
assert.equal(pngProjection.rawPathIncluded, false, "raw path must not be included");
assert.equal(pngProjection.rawImageBytesIncluded, false, "raw image bytes must not be included");

const svgProjection = buildViewImageProjection({
  pathEvidenceKey: "path_evidence_svg",
  displayName: "diagram.svg",
  mimeType: "image/svg+xml",
  rendererPreviewAvailable: true,
  nowMs: 0,
});
assert.equal(svgProjection.status, "blocked", "SVG should be blocked in Wave 17");
assert(svgProjection.blockerCodes.includes("image_active_content_blocked"), "SVG active-content blocker should be explicit");
assert.equal(svgProjection.inlineSvgRendered, false, "SVG must not be rendered inline");
assert.equal(svgProjection.modelSawPixels, false, "SVG block must not imply model vision");

const hugeProjection = buildViewImageProjection({
  pathEvidenceKey: "path_evidence_huge",
  displayName: "huge.png",
  mimeType: "image/png",
  width: 100_000,
  height: 100_000,
  nowMs: 0,
});
assert.equal(hugeProjection.status, "blocked", "oversized decoded image should be blocked");
assert(hugeProjection.blockerCodes.includes("image_decoded_pixel_cap_exceeded"), "decoded cap blocker should be explicit");

const payloadProjection = buildViewImageProjection({
  pathEvidenceKey: "path_evidence_payload",
  displayName: "diagram.png",
  mimeType: "image/png",
  providerPayloadRequested: true,
  nowMs: 0,
});
assert.equal(payloadProjection.status, "blocked", "provider payload request should be blocked");
assert.equal(payloadProjection.providerVisibilityState, "unsupported", "payload request should become unsupported visibility");
assert.equal(payloadProjection.payloadUnsupportedWitness.requested, true, "payload unsupported witness should cite the request");
assert.equal(payloadProjection.payloadUnsupportedWitness.supported, false, "payload unsupported witness should deny support");
assert.equal(payloadProjection.imagePayloadSent, false, "blocked payload request must not send pixels");
assert.equal(payloadProjection.modelSawPixels, false, "blocked payload request must not claim model vision");

const report = viewImagePromotionReport();
assert.deepEqual(validateDirectToolPromotionDecisionReport(report), [], "view_image promotion report should validate");
const activationRegistry = buildDirectToolActivationRegistry({
  promotionReport: report,
  projectId: "project_view_image_fixture",
  activationRequests: [{
    toolClassId: "local_perception.image_view_metadata",
    state: "active",
    activationEffect: "allow",
    activatedBy: "test_fixture",
    reason: "activate_view_image_fixture",
    scope: {
      kind: "project_default",
      projectId: "project_view_image_fixture",
      workThreadId: "",
      turnId: "",
      operatorId: "operator_view_image_fixture",
    },
  }],
  nowMs: 0,
});
assert.deepEqual(validateDirectToolActivationRegistry(activationRegistry), [], "activation registry should validate");
const slice = buildDirectFirstToolSlice({ activationRegistry, nowMs: 0 });
assert.deepEqual(validateDirectFirstToolSlice(slice), [], "first tool slice should validate");
assert.deepEqual(slice.summary.declaredToolNames, ["view_image"], "slice should declare only view_image");
assert.equal(slice.summary.viewImageDeclared, true, "view_image summary flag should be true");
assert.equal(slice.providerRequestPatch.tools[0].name, "view_image", "provider request patch should declare view_image");

const viewGate = buildDirectFirstToolCallGate({
  slice,
  toolCall: {
    itemId: "tool_item_view_image",
    callId: "call_view_image",
    name: "view_image",
    arguments: JSON.stringify({
      path: "artifacts/diagram.png",
      mimeType: "image/png",
      width: 320,
      height: 240,
      sizeBytes: 4567,
    }),
  },
});
assert.deepEqual(validateDirectFirstToolCallGate(viewGate), [], "view_image gate should validate");
assert.equal(viewGate.status, "accepted", "contained image path should be accepted");
assert.equal(viewGate.parsedArguments.path, "artifacts/diagram.png", "path should be normalized");

const viewEnvelope = buildViewImageResultEnvelope({
  gate: viewGate,
  projectId: "project_view_image_fixture",
  threadId: "thread_view_image_fixture",
  turnId: "turn_view_image_fixture",
  nowMs: 0,
});
assert.equal(viewEnvelope.status, "ready_for_provider_continuation", "metadata-only view image result should be continuation-ready");
assert.equal(viewEnvelope.resultKind, "image_metadata_projection", "result kind should be image metadata projection");
assert.equal(viewEnvelope.providerOutput.kind, "view_image_result", "provider output kind should be view_image_result");
assert.equal(viewEnvelope.providerOutput.modelSawPixels, false, "provider output must not claim model saw pixels");
assert.equal(viewEnvelope.providerOutput.imagePayloadSent, false, "provider output must not claim payload sent");
assert.equal(viewEnvelope.providerOutput.providerImagePayloadSupported, false, "provider output must not claim payload support");
assert.equal(viewEnvelope.contextAdmission.admittedAs, "image_metadata_projection", "context admission should be metadata-only");
assert.equal(viewEnvelope.rawWorkspacePathIncluded, false, "result envelope must not expose raw workspace path");

const payloadGate = buildDirectFirstToolCallGate({
  slice,
  toolCall: {
    itemId: "tool_item_payload",
    callId: "call_payload",
    name: "view_image",
    arguments: JSON.stringify({
      path: "artifacts/diagram.png",
      mimeType: "image/png",
      providerPayloadRequested: true,
    }),
  },
});
const payloadEnvelope = buildViewImageResultEnvelope({
  gate: payloadGate,
  projectId: "project_view_image_fixture",
  threadId: "thread_view_image_fixture",
  turnId: "turn_view_image_fixture",
  nowMs: 0,
});
assert.equal(payloadEnvelope.status, "blocked", "provider payload request should block the result envelope");
assert(payloadEnvelope.blockerCodes.includes("image:provider_image_payload_unsupported"), "provider payload blocker should be visible");
assert.equal(payloadEnvelope.providerOutput.imagePayloadSent, false, "payload-blocked envelope must not send pixels");
assert.equal(payloadEnvelope.providerOutput.modelSawPixels, false, "payload-blocked envelope must not claim model vision");

const escapedGate = buildDirectFirstToolCallGate({
  slice,
  toolCall: {
    itemId: "tool_item_escape",
    callId: "call_escape",
    name: "view_image",
    arguments: JSON.stringify({ path: "../outside.png", mimeType: "image/png" }),
  },
});
assert.equal(escapedGate.status, "blocked", "escaped image path should be blocked");
assert(escapedGate.blockerCodes.includes("invalid_read_file_path"), "escaped image path should cite containment blocker");

console.log(JSON.stringify({
  ok: true,
  sliceId: slice.sliceId,
  declaredToolNames: slice.summary.declaredToolNames,
  viewEnvelopeStatus: viewEnvelope.status,
  payloadEnvelopeStatus: payloadEnvelope.status,
}, null, 2));
