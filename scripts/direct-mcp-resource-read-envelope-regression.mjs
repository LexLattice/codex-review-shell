#!/usr/bin/env node

import { strict as assert } from "node:assert";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  MCP_RESOURCE_IDENTITY_SCHEMA,
  MCP_RESOURCE_READ_ENVELOPE_SCHEMA,
  buildMcpResourceIdentity,
  buildMcpResourceReadEnvelope,
  validateMcpResourceIdentity,
  validateMcpResourceReadEnvelope,
} = require("../src/main/direct/external/mcp-resource-read-envelope");
const {
  buildExternalCapabilityProfile,
} = require("../src/main/direct/external/external-capability-profile");
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
  projectId: "project_wave18_pr111_fixture",
  workThreadId: "work_thread_wave18_pr111_fixture",
  generatedAt: "2026-06-20T12:00:00.000Z",
});

const identity = buildMcpResourceIdentity({
  serverIdentityId: "mcp_server_project_fixture",
  resourceUri: "mcp://user:secret@fixture/resource/alpha?token=secret#frag",
});
assert.equal(identity.schema, MCP_RESOURCE_IDENTITY_SCHEMA, "identity schema mismatch");
assert.equal(identity.serverIdentityId, "mcp_server_project_fixture", "identity should cite exact server");
assert.equal(identity.rawResourceUriIncluded, false, "identity must not include raw URI");
assert(!identity.resourceDisplay.includes("secret"), "resource display must redact credentials");
assert(!identity.resourceDisplay.includes("token=secret"), "resource display must redact query values");
validateMcpResourceIdentity(identity);

const fileLikeIdentity = buildMcpResourceIdentity({
  serverIdentityId: "mcp_server_project_fixture",
  resourceUri: "file:///tmp/secrets/config.json",
});
assert.equal(fileLikeIdentity.resourceDisplay, "file:///tmp/secrets/config.json", "file display should preserve file URI slashes and allow legitimate secret-like path segments");
validateMcpResourceIdentity(fileLikeIdentity);

const completed = buildMcpResourceReadEnvelope({
  profile,
  serverIdentityId: "mcp_server_project_fixture",
  resourceUri: "mcp://user:secret@fixture/resource/alpha?token=secret#frag",
  mimeType: "text/markdown",
  payload: "# Resource\n\nBearer abcdefghijklmnopqrstuvwxyz\n\nsafe content",
  callId: "call_read_fixture",
  sourceObservedAt: "2026-06-20T12:00:01.000Z",
});
assert.equal(completed.schema, MCP_RESOURCE_READ_ENVELOPE_SCHEMA, "envelope schema mismatch");
assert.equal(completed.status, "completed", "text resource read should complete");
assert.equal(completed.sideEffectClass, "external_read", "read side effect should be external_read");
assert.equal(completed.mimeKind, "markdown", "markdown MIME should be detected");
assert.equal(completed.contentHandling, "markdown_excerpt_allowed", "markdown should admit bounded excerpt");
assert.equal(completed.contextAdmission, "excerpt_admitted", "completed text read should admit bounded excerpt");
assert.equal(completed.payloadRetention, "stored_redacted", "completed text read should retain redacted payload evidence");
assert.equal(completed.redactionState, "redacted", "secret-like payload should be redacted");
assert(completed.payloadExcerpt.includes("[REDACTED]"), "payload excerpt should show redaction marker");
assert(!completed.payloadExcerpt.includes("abcdefghijklmnopqrstuvwxyz"), "payload excerpt must not include raw bearer token");
assert.equal(completed.rawResourcePayloadIncluded, false, "envelope must not include raw full payload");
assert.equal(completed.rawResourceUriIncluded, false, "envelope must not include raw URI");
assert.equal(completed.executionAuthorityGranted, false, "envelope must not grant execution authority");
assert.equal(completed.workspaceMutationStarted, false, "resource read must not mutate workspace");
assert.equal(completed.projectTruthGranted, false, "resource read must not grant project truth");
assert.equal(completed.durableMemoryAdmissionStarted, false, "resource read must not create memory");
assert.equal(completed.readReplayPolicy.mayAutoRetry, false, "read must not auto retry");
assert.equal(completed.readReplayPolicy.mayReplayAfterHandoffUnknown, false, "read must not replay after handoff unknown");
validateMcpResourceReadEnvelope(completed);

const jsonObjectPayload = buildMcpResourceReadEnvelope({
  profile,
  serverIdentityId: "mcp_server_project_fixture",
  resourceUri: "mcp://fixture/resource/json",
  mimeType: "application/json",
  payload: { ok: true, nested: { value: 42 } },
  callId: "call_json_object_fixture",
});
assert.equal(jsonObjectPayload.status, "completed", "JSON object payload should complete");
assert.equal(jsonObjectPayload.mimeKind, "json", "JSON object payload should infer JSON kind");
assert(jsonObjectPayload.payloadDigest, "JSON object payload should produce digest");
assert(jsonObjectPayload.payloadExcerpt.includes("\"ok\":true"), "JSON object payload should produce serialized excerpt");
validateMcpResourceReadEnvelope(jsonObjectPayload);

const failedWithPayload = buildMcpResourceReadEnvelope({
  profile,
  serverIdentityId: "mcp_server_project_fixture",
  resourceUri: "mcp://fixture/resource/failed",
  mimeType: "text/plain",
  payload: "partial failure text should not be admitted",
  status: "failed",
  blockerCodes: ["provider_reported_failure"],
  callId: "call_failed_payload_fixture",
});
assert.equal(failedWithPayload.status, "blocked", "caller blockers should make the envelope blocked");
assert(failedWithPayload.blockerCodes.includes("provider_reported_failure"), "caller blocker codes should be preserved");
assert.equal(failedWithPayload.payloadExcerpt, "", "failed/blocked payload should not admit excerpt");
assert.equal(failedWithPayload.truncationState, "omitted", "non-completed reads should omit payload projection");
validateMcpResourceReadEnvelope(failedWithPayload);

const unavailableWithPayload = buildMcpResourceReadEnvelope({
  profile,
  serverIdentityId: "mcp_server_project_fixture",
  resourceUri: "mcp://fixture/resource/unavailable",
  mimeType: "text/plain",
  payload: "transport error body should not be admitted",
  status: "unavailable",
  callId: "call_unavailable_payload_fixture",
});
assert.equal(unavailableWithPayload.status, "unavailable", "caller unavailable status should be preserved for text resources");
assert.equal(unavailableWithPayload.contextAdmission, "blocked", "unavailable payload should block context admission");
assert.equal(unavailableWithPayload.payloadExcerpt, "", "unavailable payload should not admit excerpt");
validateMcpResourceReadEnvelope(unavailableWithPayload);

const multibyte = buildMcpResourceReadEnvelope({
  profile,
  serverIdentityId: "mcp_server_project_fixture",
  resourceUri: "mcp://fixture/resource/multibyte",
  mimeType: "text/plain",
  payload: "λ".repeat(4096),
  callId: "call_multibyte_fixture",
});
assert(Buffer.byteLength(multibyte.payloadExcerpt, "utf8") <= 4096, "excerpt should be capped by UTF-8 bytes");
validateMcpResourceReadEnvelope(multibyte);

const binary = buildMcpResourceReadEnvelope({
  profile,
  serverIdentityId: "mcp_server_project_fixture",
  resourceUri: "mcp://fixture/resource/image",
  mimeType: "image/png",
  byteCount: 2048,
  status: "completed",
  callId: "call_binary_fixture",
});
assert.equal(binary.status, "unsupported", "binary resources should stay unsupported even if caller reports completed");
assert.equal(binary.contentHandling, "binary_ref_only", "binary resources should be ref-only");
assert.equal(binary.contextAdmission, "ref_only", "binary resources should be ref-only");
assert.equal(binary.payloadRetention, "stored_digest_only", "binary resources should retain digest only");
validateMcpResourceReadEnvelope(binary);

const oversized = buildMcpResourceReadEnvelope({
  profile,
  serverIdentityId: "mcp_server_project_fixture",
  resourceUri: "mcp://fixture/resource/oversized",
  mimeType: "text/plain",
  payload: "x".repeat(70 * 1024),
  status: "completed",
  callId: "call_oversized_fixture",
});
assert.equal(oversized.status, "unsupported", "oversized text should stay unsupported even if caller reports completed");
assert.equal(oversized.contentHandling, "oversize_blocked", "oversized text should be blocked by size policy");
assert.equal(oversized.contextAdmission, "ref_only", "oversized text should not admit excerpt");
assert.equal(oversized.truncationState, "omitted", "oversized text should omit payload projection");
validateMcpResourceReadEnvelope(oversized);

const blockedServer = buildMcpResourceReadEnvelope({
  profile,
  serverIdentityId: "mcp_server_disabled_fixture",
  resourceUri: "mcp://fixture/resource/alpha",
  mimeType: "text/plain",
  payload: "safe",
  callId: "call_disabled_server_fixture",
});
assert.equal(blockedServer.status, "blocked", "disabled server should block read envelope");
assert(blockedServer.blockerCodes.some((code) => code.startsWith("mcp_server_not_selectable")), "blocked server should cite selector blocker");
assert.equal(blockedServer.contextAdmission, "blocked", "blocked server should block context admission");
assert.equal(blockedServer.payloadExcerpt, "", "blocked read must not carry payload excerpt");
validateMcpResourceReadEnvelope(blockedServer);

const blockedScheme = buildMcpResourceReadEnvelope({
  profile,
  serverIdentityId: "mcp_server_project_fixture",
  resourceUri: "javascript:alert(1)",
  mimeType: "text/plain",
  payload: "safe",
  callId: "call_bad_scheme_fixture",
});
assert.equal(blockedScheme.status, "blocked", "blocked URI scheme should block read envelope");
assert(blockedScheme.blockerCodes.includes("resource_uri_scheme_blocked"), "blocked scheme should cite URI blocker");
validateMcpResourceReadEnvelope(blockedScheme);

const digestMismatch = buildMcpResourceReadEnvelope({
  profile,
  serverIdentityId: "mcp_server_project_fixture",
  resourceUri: "mcp://fixture/resource/alpha",
  resourceUriDigest: "wrong-digest",
  mimeType: "text/plain",
  payload: "safe",
  callId: "call_digest_mismatch_fixture",
});
assert.equal(digestMismatch.status, "blocked", "URI digest mismatch should block read envelope");
assert(digestMismatch.blockerCodes.includes("resource_uri_digest_mismatch"), "digest mismatch should cite blocker");
validateMcpResourceReadEnvelope(digestMismatch);

const malformedSelector = clone(completed);
malformedSelector.serverSelector = null;
expectThrows(() => validateMcpResourceReadEnvelope(malformedSelector), "mcp_resource_read_missing_server_selector");

const leakedPayload = clone(completed);
leakedPayload.rawResourcePayloadIncluded = true;
expectThrows(() => validateMcpResourceReadEnvelope(leakedPayload), "mcp_resource_read_envelope_authority_leak:rawResourcePayloadIncluded");

const replayLeak = clone(completed);
replayLeak.readReplayPolicy.mayAutoRetry = true;
expectThrows(() => validateMcpResourceReadEnvelope(replayLeak), "mcp_resource_read_auto_retry_allowed");

const overAdmittedBinary = clone(binary);
overAdmittedBinary.contextAdmission = "excerpt_admitted";
expectThrows(() => validateMcpResourceReadEnvelope(overAdmittedBinary), "mcp_resource_read_binary_not_ref_only");

const audit = buildDirectInformationBridgeAudit({ generatedAt: "2026-06-20T12:00:00.000Z" });
assert(audit.rows.some((row) => row.id === "ic57.mcp-resource-read-envelope"), "information registry should include MCP resource read envelope row");

const serialized = JSON.stringify({
  identity,
  fileLikeIdentity,
  completed,
  jsonObjectPayload,
  failedWithPayload,
  unavailableWithPayload,
  multibyte,
  binary,
  oversized,
  blockedServer,
  blockedScheme,
  digestMismatch,
});
for (const forbidden of [
  "\"rawResourcePayloadIncluded\":true",
  "\"rawResourceUriIncluded\":true",
  "\"rawSecretIncluded\":true",
  "\"executionAuthorityGranted\":true",
  "\"workspaceMutationStarted\":true",
  "\"projectTruthGranted\":true",
  "\"durableMemoryAdmissionStarted\":true",
  "\"autoReplayAllowed\":true",
  "\"mayAutoRetry\":true",
  "\"mayReplayAfterHandoffUnknown\":true",
  "token=secret",
  "abcdefghijklmnopqrstuvwxyz",
]) {
  assert(!serialized.includes(forbidden), `serialized resource read envelope leaked ${forbidden}`);
}

console.log(JSON.stringify({
  ok: true,
  envelopeId: completed.envelopeId,
  completedStatus: completed.status,
  binaryStatus: binary.status,
  blockedServerStatus: blockedServer.status,
  payloadRetention: completed.payloadRetention,
}));
