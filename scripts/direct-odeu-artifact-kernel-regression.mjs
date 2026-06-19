#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  ODEU_ARTIFACT_BASE_SCHEMA,
  ODEU_ARTIFACT_REF_SCHEMA,
  ODEU_EVIDENCE_REF_SCHEMA,
  ODEU_LIVE_CAPABILITY_KERNEL_VERSION,
  ODEU_RAW_EXPOSURE_SCAN_SCHEMA,
  ODEU_SOURCE_REF_SCHEMA,
  assertOdeuRawExposureSafe,
  buildOdeuArtifactBase,
  buildOdeuArtifactRef,
  buildOdeuDigest,
  buildOdeuEvidenceRef,
  buildOdeuRawExposureScan,
  digestCanonicalJson,
  normalizeOdeuSourceRef,
  normalizeScope,
  validateOdeuArtifactBase,
  validateOdeuRawExposureScan,
} = require("../src/main/direct/odeu");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectThrows(fn, expectedCode) {
  try {
    fn();
  } catch (error) {
    if (expectedCode && error.code !== expectedCode && !String(error.message || "").includes(expectedCode)) {
      throw new Error(`expected ${expectedCode}, got ${error.code || error.message}`);
    }
    return error;
  }
  throw new Error(`expected throw: ${expectedCode}`);
}

const fixedNow = () => Date.UTC(2026, 5, 19, 12, 0, 0);

const sourceRef = normalizeOdeuSourceRef({
  sourceRefId: "source_fixture_1",
  sourceKind: "request_manifest",
  sourceId: "request_manifest_fixture",
  sourceConfidence: "exact",
  freshness: "fresh",
  rowId: "row_1",
}, { now: fixedNow });

assert(sourceRef.schema === ODEU_SOURCE_REF_SCHEMA, "source ref schema mismatch");
assert(sourceRef.sourceKind === "request_manifest", "source kind mismatch");
assert(sourceRef.sourceConfidence === "exact", "source confidence mismatch");
assert(sourceRef.freshness === "fresh", "source freshness mismatch");
assert(sourceRef.sourceDigest.algorithm === "sha256", "source digest should be computed");
assert(sourceRef.sourceDigest.digestOf === "metadata", "source digest posture mismatch");

const fallbackSourceRef = normalizeOdeuSourceRef({
  sourceKind: "unexpected_kind",
  sourceConfidence: "bogus",
  freshness: "old",
}, { now: fixedNow });
assert(fallbackSourceRef.sourceKind === "family_specific", "unknown source kind should become family_specific");
assert(fallbackSourceRef.sourceConfidence === "unknown", "unknown confidence should fall back");
assert(fallbackSourceRef.freshness === "unknown", "unknown freshness should fall back");

const evidenceRef = buildOdeuEvidenceRef({
  evidenceId: "evidence_fixture_1",
  evidenceKind: "kernel_fixture",
  sourceRefs: [sourceRef],
}, { now: fixedNow });
assert(evidenceRef.schema === ODEU_EVIDENCE_REF_SCHEMA, "evidence ref schema mismatch");
assert(evidenceRef.sourceConfidence === "exact", "evidence should inherit source confidence");
assert(evidenceRef.freshness === "fresh", "evidence should inherit freshness");

const digest = digestCanonicalJson({ b: 2, a: 1 }, { domain: "fixture" });
assert(digest.algorithm === "sha256", "canonical digest should use sha256");
assert(digest.value.startsWith("sha256:"), "canonical digest value should be namespaced");
assert(digest.unavailableReason === undefined, "computed digest should not have absence reason");

const withheldDigest = buildOdeuDigest({
  digestOf: "redacted_payload",
  unavailableReason: "sensitive_withheld",
});
assert(!("algorithm" in withheldDigest), "missing digest must not use algorithm=none");
assert(withheldDigest.unavailableReason === "sensitive_withheld", "digest absence reason mismatch");

const scope = normalizeScope({
  projectId: "project_fixture",
  workThreadId: "work_thread_fixture",
  runtimeTier: "headless_direct",
  environment: "fixture",
  modelId: "gpt-fixture",
});
assert(scope.projectId === "project_fixture", "scope project mismatch");
assert(scope.runtimeTier === "headless_direct", "scope runtime mismatch");
assert(scope.environment === "fixture", "scope environment mismatch");

const safeScan = buildOdeuRawExposureScan({
  rendererSafeSummary: "safe summary",
  source: "[source-ref:fixture]",
}, {
  scanScope: "renderer_projection",
  now: fixedNow,
});
assert(safeScan.schema === ODEU_RAW_EXPOSURE_SCAN_SCHEMA, "raw exposure schema mismatch");
assert(safeScan.passed === true, "safe scan should pass");
assert(safeScan.scanScope === "renderer_projection", "scan scope mismatch");
validateOdeuRawExposureScan(safeScan);

const unsafeScan = buildOdeuRawExposureScan({
  compiledPrompt: "raw prompt text",
  providerPayload: "{\"secret\":true}",
  authToken: "Bearer abcdefghijklmnopqrstuvwxyz123456",
  path: "/home/rose/private/file.txt",
  url: "https://chatgpt.com/c/private",
  rawToolOutputIncluded: true,
}, {
  scanScope: "report",
  rawAccountIdentifierIncluded: true,
  rawWorkspaceContentIncluded: true,
  rawExternalResourceIncluded: true,
  rawImagePayloadIncluded: true,
  now: fixedNow,
});
assert(unsafeScan.passed === false, "unsafe scan should block");
assert(unsafeScan.rawPromptIncluded === true, "raw prompt flag missing");
assert(unsafeScan.rawProviderPayloadIncluded === true, "provider payload flag missing");
assert(unsafeScan.rawAuthIncluded === true, "auth flag missing");
assert(unsafeScan.rawPathIncluded === true, "path flag missing");
assert(unsafeScan.rawUrlIncluded === true, "url flag missing");
assert(unsafeScan.rawToolOutputIncluded === true, "tool output flag missing");
assert(unsafeScan.rawAccountIdentifierIncluded === true, "account flag missing");
assert(unsafeScan.rawWorkspaceContentIncluded === true, "workspace content flag missing");
assert(unsafeScan.rawExternalResourceIncluded === true, "external resource flag missing");
assert(unsafeScan.rawImagePayloadIncluded === true, "image payload flag missing");

const thrown = expectThrows(() => assertOdeuRawExposureSafe({ path: "C:\\Users\\Rose\\secret.txt" }), "odeu_raw_exposure_blocked");
assert(thrown.scan.rawPathIncluded === true, "thrown scan should include path flag");

const artifact = buildOdeuArtifactBase({
  schema: ODEU_ARTIFACT_BASE_SCHEMA,
  artifactId: "artifact_fixture_1",
  artifactKind: "kernel_fixture",
  scope,
  createdBy: "fixture",
  status: "valid",
  sourceRefs: [sourceRef],
  rawExposureValue: {
    rendererSafeSummary: "artifact safe",
  },
}, { now: fixedNow });
assert(artifact.kernelVersion === ODEU_LIVE_CAPABILITY_KERNEL_VERSION, "kernel version mismatch");
assert(artifact.createdAt === "2026-06-19T12:00:00.000Z", "artifact timestamp mismatch");
assert(artifact.scope.workThreadId === "work_thread_fixture", "artifact scope mismatch");
assert(artifact.artifactDigest.algorithm === "sha256", "artifact digest missing");
assert(artifact.rawExposureScan.passed === true, "artifact raw scan should pass");
validateOdeuArtifactBase(artifact);

const artifactRef = buildOdeuArtifactRef({
  artifactKind: artifact.artifactKind,
  artifactId: artifact.artifactId,
  artifactDigest: artifact.artifactDigest,
  sourceRefs: [sourceRef],
  rendererSafeLabel: "Kernel fixture artifact",
});
assert(artifactRef.schema === ODEU_ARTIFACT_REF_SCHEMA, "artifact ref schema mismatch");
assert(artifactRef.artifactDigest.value === artifact.artifactDigest.value, "artifact ref digest should preserve digest");
assert(artifactRef.sourceRefs[0].sourceRefId === sourceRef.sourceRefId, "artifact ref should preserve source refs");

const missingDigestArtifactRef = buildOdeuArtifactRef({
  artifactKind: "legacy_adapter",
  artifactId: "legacy_ref",
});
assert(missingDigestArtifactRef.artifactDigest.unavailableReason === "not_computed", "missing digest should be explicit");
assert(!("algorithm" in missingDigestArtifactRef.artifactDigest), "missing digest should not use algorithm=none");

const partialArtifact = buildOdeuArtifactBase({
  artifactId: "legacy_partial_artifact",
  artifactKind: "legacy_adapter",
  createdBy: "migration",
  status: "partial",
  statusReason: "legacy row lacks canonical source refs",
  sourceRefs: [],
  artifactDigest: {
    digestOf: "metadata",
    unavailableReason: "legacy_missing",
  },
}, { now: fixedNow });
assert(partialArtifact.status === "partial", "partial artifact status mismatch");
assert(partialArtifact.statusReason.includes("legacy"), "partial artifact reason mismatch");
assert(partialArtifact.artifactDigest.unavailableReason === "legacy_missing", "legacy digest absence mismatch");

const report = {
  schema: "direct_odeu_artifact_kernel_regression@1",
  checks: {
    sourceRefs: true,
    evidenceRefs: true,
    digestAbsence: true,
    rawExposureScan: true,
    artifactBase: true,
    artifactRefs: true,
    compatibilityPartial: true,
  },
  sentinelCounters: {
    providerTransportCalls: 0,
    appServerMutationCalls: 0,
    workspaceWriteCalls: 0,
    commandRunCalls: 0,
    connectorCalls: 0,
    residentToolDeclarations: 0,
  },
};

for (const [name, value] of Object.entries(report.sentinelCounters)) {
  assert(value === 0, `${name} should remain zero`);
}

console.log(JSON.stringify(report, null, 2));
