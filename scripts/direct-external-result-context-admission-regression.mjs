#!/usr/bin/env node

import { strict as assert } from "node:assert";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  EXTERNAL_RESULT_CONTEXT_ADMISSION_POLICY_SCHEMA,
  EXTERNAL_RESULT_CONTEXT_ADMISSION_SCHEMA,
  buildExternalResultContextAdmission,
  buildExternalResultContextAdmissionPolicy,
  validateExternalResultContextAdmission,
  validateExternalResultContextAdmissionPolicy,
} = require("../src/main/direct/external/external-result-context-admission");
const {
  buildExternalCapabilityProfile,
} = require("../src/main/direct/external/external-capability-profile");
const {
  buildExternalDiscoveryResultEnvelope,
  buildExternalDiscoveryToolCallGate,
  buildExternalToolResidentDeclaration,
} = require("../src/main/direct/external/external-discovery-tools");
const {
  buildMcpResourceReadEnvelope,
} = require("../src/main/direct/external/mcp-resource-read-envelope");
const {
  buildDirectInformationBridgeAudit,
} = require("../src/main/direct/bridge/information-registry");

function expectThrows(fn, expectedCode) {
  try {
    fn();
  } catch (error) {
    if (expectedCode && !String(error?.message || "").includes(expectedCode)) {
      throw new Error(`expected ${expectedCode}, got ${error?.message || error}`);
    }
    return error;
  }
  throw new Error(`expected throw: ${expectedCode}`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const profile = buildExternalCapabilityProfile({
  projectId: "project_wave18_pr112_fixture",
  workThreadId: "work_thread_wave18_pr112_fixture",
  generatedAt: "2026-06-20T13:00:00.000Z",
});
const declaration = buildExternalToolResidentDeclaration({ profile, generatedAt: "2026-06-20T13:00:00.000Z" });
const searchGate = buildExternalDiscoveryToolCallGate({
  declaration,
  toolCall: {
    name: "tool_search",
    callId: "call_context_admission_search_fixture",
    arguments: JSON.stringify({ families: ["mcp_resource", "mcp_tool"], maxResults: 4 }),
  },
});
const discoveryEnvelope = buildExternalDiscoveryResultEnvelope({ profile, declaration, gate: searchGate });

const policy = buildExternalResultContextAdmissionPolicy({
  summaryTokenBudget: 256,
  excerptByteLimit: 1024,
  generatedAt: "2026-06-20T13:00:00.000Z",
});
assert.equal(policy.schema, EXTERNAL_RESULT_CONTEXT_ADMISSION_POLICY_SCHEMA, "policy schema mismatch");
assert.equal(policy.rawPayloadAdmissionAllowed, false, "policy must not allow raw payload admission");
assert.equal(policy.durableMemoryAdmissionAllowed, false, "policy must not allow durable memory");
assert.equal(policy.projectTruthAllowed, false, "policy must not allow project truth");
validateExternalResultContextAdmissionPolicy(policy);

const discoveryAdmission = buildExternalResultContextAdmission({
  policy,
  envelope: discoveryEnvelope,
});
assert.equal(discoveryAdmission.schema, EXTERNAL_RESULT_CONTEXT_ADMISSION_SCHEMA, "admission schema mismatch");
assert.equal(discoveryAdmission.resultKind, "external_discovery", "discovery result kind mismatch");
assert.equal(discoveryAdmission.admissionState, "summary_admitted", "discovery should admit summary");
assert.equal(discoveryAdmission.visibility.residentContext, "summary", "discovery resident visibility should be summary");
assert.equal(discoveryAdmission.visibility.providerContinuation, "summary_only", "discovery provider visibility should be summary only");
assert(discoveryAdmission.trustWarning.includes("not project truth"), "discovery warning should state not project truth");
assert.equal(discoveryAdmission.projectTruthGranted, false, "discovery must not grant project truth");
assert.equal(discoveryAdmission.durableMemoryAdmissionStarted, false, "discovery must not start memory admission");
validateExternalResultContextAdmission(discoveryAdmission);

const readEnvelope = buildMcpResourceReadEnvelope({
  profile,
  serverIdentityId: "mcp_server_project_fixture",
  resourceUri: "mcp://user:secret@fixture/resource/alpha?token=secret#frag",
  mimeType: "text/markdown",
  payload: "# Resource\n\nBearer abcdefghijklmnopqrstuvwxyz\n\nsafe content",
  callId: "call_context_admission_read_fixture",
});
const readAdmission = buildExternalResultContextAdmission({
  policy,
  envelope: readEnvelope,
});
assert.equal(readAdmission.resultKind, "mcp_resource_read", "read result kind mismatch");
assert.equal(readAdmission.admissionState, "excerpt_admitted", "completed text read should admit excerpt");
assert.equal(readAdmission.visibility.residentContext, "bounded_excerpt", "read resident visibility should be bounded excerpt");
assert.equal(readAdmission.visibility.providerContinuation, "bounded_excerpt", "read provider visibility should be bounded excerpt");
assert(readAdmission.residentVisibleText.includes("[REDACTED]"), "read admission should carry redacted excerpt");
assert(!readAdmission.residentVisibleText.includes("abcdefghijklmnopqrstuvwxyz"), "read admission must not include raw bearer token");
assert(!JSON.stringify(readAdmission).includes("token=secret"), "read admission must not expose raw URI query");
assert.equal(readAdmission.rawExternalPayloadIncluded, false, "read admission must not expose raw payload");
assert.equal(readAdmission.rawResourceUriIncluded, false, "read admission must not expose raw URI");
validateExternalResultContextAdmission(readAdmission);

const providerNotSentPolicy = buildExternalResultContextAdmissionPolicy({
  providerContinuationMode: "not_sent",
  excerptByteLimit: 256,
});
const providerNotSentAdmission = buildExternalResultContextAdmission({
  policy: providerNotSentPolicy,
  envelope: readEnvelope,
});
assert.equal(providerNotSentAdmission.visibility.providerContinuation, "not_sent", "policy should suppress provider continuation");
assert.equal(providerNotSentAdmission.providerProjection.text, "", "not_sent provider projection must have no text");
validateExternalResultContextAdmission(providerNotSentAdmission);

const providerSummaryOnlyPolicy = buildExternalResultContextAdmissionPolicy({
  providerContinuationMode: "summary_only",
  excerptByteLimit: 256,
});
const providerSummaryOnlyAdmission = buildExternalResultContextAdmission({
  policy: providerSummaryOnlyPolicy,
  envelope: readEnvelope,
});
assert.equal(providerSummaryOnlyAdmission.visibility.providerContinuation, "summary_only", "summary policy should downgrade provider excerpt");
assert(!providerSummaryOnlyAdmission.providerProjection.text.includes("safe content"), "summary-only provider projection must not include read excerpt");
validateExternalResultContextAdmission(providerSummaryOnlyAdmission);

const providerRefOnlyPolicy = buildExternalResultContextAdmissionPolicy({
  providerContinuationMode: "ref_only",
  excerptByteLimit: 256,
});
const providerRefOnlyAdmission = buildExternalResultContextAdmission({
  policy: providerRefOnlyPolicy,
  envelope: readEnvelope,
});
assert.equal(providerRefOnlyAdmission.visibility.providerContinuation, "ref_only", "ref-only policy should downgrade provider continuation");
assert(providerRefOnlyAdmission.providerProjection.text.includes("reference only"), "ref-only provider projection should expose only reference posture");
assert(!providerRefOnlyAdmission.providerProjection.text.includes("safe content"), "ref-only provider projection must not include read excerpt");
validateExternalResultContextAdmission(providerRefOnlyAdmission);

const discoveryOnlyPolicy = buildExternalResultContextAdmissionPolicy({
  resultKinds: ["external_discovery"],
});
const scopedOutAdmission = buildExternalResultContextAdmission({
  policy: discoveryOnlyPolicy,
  envelope: readEnvelope,
});
assert.equal(scopedOutAdmission.admissionState, "blocked", "policy resultKinds should block excluded result families");
assert.equal(scopedOutAdmission.visibility.providerContinuation, "not_sent", "scoped-out result must not reach provider");
validateExternalResultContextAdmission(scopedOutAdmission);

const binaryEnvelope = buildMcpResourceReadEnvelope({
  profile,
  serverIdentityId: "mcp_server_project_fixture",
  resourceUri: "mcp://fixture/resource/image",
  mimeType: "image/png",
  byteCount: 512,
  callId: "call_context_admission_binary_fixture",
});
const binaryAdmission = buildExternalResultContextAdmission({
  policy,
  envelope: binaryEnvelope,
});
assert.equal(binaryAdmission.admissionState, "ref_only", "binary read should admit ref only");
assert.equal(binaryAdmission.visibility.residentContext, "ref_only", "binary resident visibility should be ref only");
assert.equal(binaryAdmission.visibility.providerContinuation, "ref_only", "binary provider visibility should be ref only");
validateExternalResultContextAdmission(binaryAdmission);

const disabledReadEnvelope = buildMcpResourceReadEnvelope({
  profile,
  serverIdentityId: "mcp_server_disabled_fixture",
  resourceUri: "mcp://fixture/resource/alpha",
  mimeType: "text/plain",
  payload: "blocked payload must not be admitted",
  callId: "call_context_admission_blocked_fixture",
});
const blockedAdmission = buildExternalResultContextAdmission({
  policy,
  envelope: disabledReadEnvelope,
});
assert.equal(blockedAdmission.admissionState, "blocked", "blocked read should block admission");
assert.equal(blockedAdmission.visibility.residentContext, "none", "blocked resident context should be none");
assert.equal(blockedAdmission.visibility.providerContinuation, "not_sent", "blocked provider continuation should not be sent");
assert(!blockedAdmission.residentVisibleText.includes("blocked payload"), "blocked admission must not include source payload");
validateExternalResultContextAdmission(blockedAdmission);

const noExcerptPolicy = buildExternalResultContextAdmissionPolicy({
  allowReadExcerpt: false,
  allowRefOnly: true,
});
const noExcerptAdmission = buildExternalResultContextAdmission({
  policy: noExcerptPolicy,
  envelope: readEnvelope,
});
assert.equal(noExcerptAdmission.admissionState, "ref_only", "policy should downgrade excerpt to ref-only");
assert.equal(noExcerptAdmission.visibility.residentContext, "ref_only", "downgraded read should be ref-only");
assert(!noExcerptAdmission.residentVisibleText.includes("[REDACTED]"), "ref-only downgrade must not include excerpt");
validateExternalResultContextAdmission(noExcerptAdmission);

const multibyteEnvelope = buildMcpResourceReadEnvelope({
  profile,
  serverIdentityId: "mcp_server_project_fixture",
  resourceUri: "mcp://fixture/resource/multibyte",
  mimeType: "text/plain",
  payload: "語".repeat(3000),
  callId: "call_context_admission_multibyte_fixture",
});
const multibyteAdmission = buildExternalResultContextAdmission({
  policy: buildExternalResultContextAdmissionPolicy({ excerptByteLimit: 4096 }),
  envelope: multibyteEnvelope,
});
assert(Buffer.byteLength(multibyteAdmission.residentVisibleText, "utf8") <= 5120, "resident visible text should remain byte bounded");
assert(Buffer.byteLength(multibyteAdmission.providerProjection.text, "utf8") <= 4096, "provider projection should remain byte bounded");
validateExternalResultContextAdmission(multibyteAdmission);

const malformedTruth = clone(readAdmission);
malformedTruth.projectTruthGranted = true;
expectThrows(() => validateExternalResultContextAdmission(malformedTruth), "external_context_admission_authority_leak:projectTruthGranted");

const malformedProvider = clone(blockedAdmission);
malformedProvider.visibility.providerContinuation = "summary_only";
expectThrows(() => validateExternalResultContextAdmission(malformedProvider), "external_context_admission_blocked_provider_visible");

const malformedProjection = clone(readAdmission);
malformedProjection.providerProjection.rawPayloadIncluded = true;
expectThrows(() => validateExternalResultContextAdmission(malformedProjection), "external_context_admission_projection_raw_leak:rawPayloadIncluded");

const malformedWarning = clone(readAdmission);
malformedWarning.trustWarning = "External source admitted.";
expectThrows(() => validateExternalResultContextAdmission(malformedWarning), "external_context_admission_missing_trust_warning");

const audit = buildDirectInformationBridgeAudit({ generatedAt: "2026-06-20T13:00:00.000Z" });
assert(audit.rows.some((row) => row.id === "ic58.external-result-context-admission"), "information registry should include external context admission row");

const serialized = JSON.stringify({
  discoveryAdmission,
  readAdmission,
  providerNotSentAdmission,
  providerSummaryOnlyAdmission,
  providerRefOnlyAdmission,
  scopedOutAdmission,
  binaryAdmission,
  blockedAdmission,
  noExcerptAdmission,
  multibyteAdmission,
});
for (const forbidden of [
  "\"projectTruthGranted\":true",
  "\"workspaceEvidenceGranted\":true",
  "\"authorityGranted\":true",
  "\"durableMemoryAdmissionStarted\":true",
  "\"providerRawPayloadSent\":true",
  "\"rawExternalPayloadIncluded\":true",
  "\"rawResourceUriIncluded\":true",
  "\"rawSecretIncluded\":true",
  "token=secret",
  "abcdefghijklmnopqrstuvwxyz",
  "blocked payload must not be admitted",
]) {
  assert(!serialized.includes(forbidden), `serialized context admission leaked ${forbidden}`);
}

console.log(JSON.stringify({
  ok: true,
  policyId: policy.policyId,
  discoveryState: discoveryAdmission.admissionState,
  readState: readAdmission.admissionState,
  binaryState: binaryAdmission.admissionState,
  blockedState: blockedAdmission.admissionState,
}));
