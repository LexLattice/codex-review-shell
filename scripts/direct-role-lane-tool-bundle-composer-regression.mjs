#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  buildDirectRoleLaneRegistry,
  buildDirectRoleLaneSelection,
  composeDirectToolBundle,
  validateDirectRoleLaneSelection,
  validateDirectToolBundleComposition,
  validateResidentCapabilityCatalogue,
} = require("../src/main/direct/bridge/role-lane-tool-bundle-composer");
const {
  buildExternalCapabilityProfile,
} = require("../src/main/direct/external/external-capability-profile");
const nowMs = Date.UTC(2026, 5, 21, 12, 30, 0);
const implementationToolNames = [
  "apply_patch",
  "get_context_remaining",
  "inspect_agent",
  "list_agents",
  "list_mcp_resource_templates",
  "list_mcp_resources",
  "read_file",
  "read_mcp_resource",
  "request_user_input",
  "run_command",
  "tool_search",
  "update_plan",
];
const safeResidentUtilityToolNames = ["get_context_remaining", "request_user_input", "update_plan"];
const readOnlySubAgentStatusToolNames = ["inspect_agent", "list_agents"];
const externalPromotedToolNames = ["list_mcp_resource_templates", "list_mcp_resources", "read_mcp_resource", "tool_search"];
const blockedSubAgentControlToolNames = ["close_agent", "interrupt_agent", "recursive_spawn", "resume_agent", "send_message", "spawn_agent"];

function ref(kind, id, label = id) {
  return {
    kind,
    id,
    label,
    digest: `fixture_digest_${id}`,
    rendererSafe: true,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

const registry = buildDirectRoleLaneRegistry({ nowMs });
assert.equal(registry.schema, "direct_role_lane_registry@1");
assert.equal(registry.rawPromptIncluded, false);
assert.equal(registry.rawProviderPayloadIncluded, false);
assert.equal(registry.rawSecretIncluded, false);
assert(registry.rows.some((row) => row.laneKind === "implementation_worker"), "missing implementation lane");

const laneSelection = buildDirectRoleLaneSelection({
  registry,
  projectId: "project_role_lane_fixture",
  workThreadId: "work_thread_role_lane_fixture",
  threadId: "direct_session_role_lane_fixture",
  laneKind: "implementation_worker",
  normalizedLaneRequestRef: ref("normalized_lane_request", "normalized_request_impl_001"),
  controlledRouteRef: ref("controlled_route", "controlled_route_impl_001"),
  roleHandoffPacketRef: ref("role_handoff_packet", "role_handoff_impl_001"),
  authorityBoundaryRef: ref("authority_boundary", "authority_boundary_impl_001"),
  objectiveRef: ref("objective", "objective_impl_001"),
  nowMs,
});
assert.deepEqual(validateDirectRoleLaneSelection(laneSelection), []);
assert.equal(laneSelection.laneKind, "implementation_worker");
assert.equal(laneSelection.agentClassSpecRef.kind, "agent_class_spec");
assert.equal(laneSelection.normalizedLaneRequestRef.id, "normalized_request_impl_001");
assert(laneSelection.laneLawRefs.length > 0, "lane selection should carry lane law refs");

const externalCapabilityProfile = buildExternalCapabilityProfile({
  projectId: "project_role_lane_fixture",
  workThreadId: "work_thread_role_lane_fixture",
  generatedAt: "2026-06-21T12:30:00.000Z",
});

const grounded = composeDirectToolBundle({
  registry,
  laneSelection,
  providerProfileRef: ref("provider_profile", "provider_profile_direct_fixture"),
  runtimeFactsRef: ref("runtime_facts", "runtime_facts_direct_fixture"),
  activationSnapshotRefs: [ref("activation_snapshot", "activation_snapshot_direct_fixture")],
  residentEpistemicSnapshotRef: ref("resident_epistemic_snapshot", "resident_epistemic_fixture"),
  sourceMessageRef: ref("source_message", "source_message_impl_001"),
  sourceSpanRefs: [ref("source_span", "source_span_impl_001")],
  semanticParseRef: ref("semantic_parse", "semantic_parse_impl_001"),
  normalizedLaneRequestRef: ref("normalized_lane_request", "normalized_request_impl_001"),
  externalCapabilityProfile,
  contextPacketRef: ref("context_packet", "context_packet_impl_001"),
  requestManifestRef: ref("request_manifest", "request_manifest_impl_001"),
  nowMs,
});

assert.equal(grounded.status, "passed");
assert.deepEqual(validateDirectToolBundleComposition(grounded), []);
assert.equal(grounded.providerDeclaredToolBundle.schema, "provider_declared_tool_bundle@1");
assert.deepEqual(grounded.providerDeclaredToolBundle.declaredToolNames, implementationToolNames);
assert.equal(grounded.providerDeclaredToolBundle.parallelToolCalls, false);
assert.equal(grounded.providerDeclaredToolBundle.toolChoice, "auto");
assert.equal(grounded.residentCapabilityCatalogue.callableNow.length, implementationToolNames.length);
assert.equal(grounded.residentCapabilityCatalogue.knownUnavailable.length, 0);
assert.equal(grounded.witness.providerDeclaredToolBundleRef, grounded.providerDeclaredToolBundle.bundleId);
assert.equal(grounded.witness.residentCatalogueRef, grounded.residentCapabilityCatalogue.catalogueId);
assert.equal(grounded.witness.normalizedLaneRequestRef.id, "normalized_request_impl_001");
assert.equal(grounded.witness.controlledRouteRef.id, "controlled_route_impl_001");
assert.equal(grounded.witness.roleHandoffPacketRef.id, "role_handoff_impl_001");
assert.equal(grounded.witness.rawPromptIncluded, false);
assert.equal(grounded.witness.rawProviderPayloadIncluded, false);
assert.equal(grounded.witness.rawSecretIncluded, false);

for (const row of grounded.witness.declaredTools) {
  assert.equal(row.perCallAuthorityRequired, true);
  assert(row.declarationAuthorityTemplateRef, `missing authority template for ${row.toolName}`);
  assert.equal(row.authorityTemplate.requiresConcreteCallDecision, true);
  assert.equal(row.axes.declarationState, "declared_callable");
  assert.equal(row.axes.currentRequestStatus, "callable_now");
}

for (const toolName of safeResidentUtilityToolNames) {
  const row = grounded.witness.declaredTools.find((entry) => entry.toolName === toolName);
  assert(row, `missing safe resident utility declaration for ${toolName}`);
  assert.equal(row.perCallAuthorityRequired, true, `${toolName} must still require concrete per-call authority`);
  assert.equal(row.axes.currentRequestStatus, "callable_now", `${toolName} must be callable in the current resident catalogue`);
}

for (const toolName of readOnlySubAgentStatusToolNames) {
  const row = grounded.witness.declaredTools.find((entry) => entry.toolName === toolName);
  assert(row, `missing read-only sub-agent status declaration for ${toolName}`);
  assert.equal(row.toolFamily, "agent_runtime_status", `${toolName} must be status-only, not agent control`);
  assert.equal(row.perCallAuthorityRequired, true, `${toolName} must still require concrete per-call authority`);
  assert.equal(row.providerToolSchema.name, toolName, `${toolName} provider schema mismatch`);
  assert.equal(row.authorityTemplate.allowedOperationClasses[0], "agent_runtime_status", `${toolName} authority class mismatch`);
}

for (const toolName of externalPromotedToolNames) {
  const row = grounded.witness.declaredTools.find((entry) => entry.toolName === toolName);
  assert(row, `missing external promoted declaration for ${toolName}`);
  assert(["external_capability_discovery", "external_resource_read"].includes(row.toolFamily), `${toolName} must stay in an external read/discovery family`);
  assert.equal(row.perCallAuthorityRequired, true, `${toolName} must still require concrete per-call authority`);
  assert.equal(row.providerToolSchema.name, toolName, `${toolName} provider schema mismatch`);
  assert.equal(row.authorityTemplate.requiresConcreteCallDecision, true, `${toolName} must keep per-call gate`);
}

const missingExternalSource = composeDirectToolBundle({
  registry,
  laneSelection,
  providerProfileRef: ref("provider_profile", "provider_profile_direct_fixture"),
  runtimeFactsRef: ref("runtime_facts", "runtime_facts_direct_fixture"),
  activationSnapshotRefs: [ref("activation_snapshot", "activation_snapshot_direct_fixture")],
  normalizedLaneRequestRef: ref("normalized_lane_request", "normalized_request_impl_001"),
  toolNames: externalPromotedToolNames,
  nowMs,
});
assert.equal(missingExternalSource.status, "passed");
assert.deepEqual(missingExternalSource.providerDeclaredToolBundle.declaredToolNames, []);
assert.equal(missingExternalSource.residentCapabilityCatalogue.knownUnavailable.length, externalPromotedToolNames.length);
for (const row of missingExternalSource.residentCapabilityCatalogue.knownUnavailable) {
  assert.equal(row.status, "blocked_by_runtime", `${row.toolName} should require external source identity`);
  assert.equal(row.callableInCurrentRequest, false);
  assert.equal(row.nonOmittable, true);
  assert(row.reason.includes("external_source_identity"), `${row.toolName} should cite source identity blocker`);
}

const unsafeSubAgentControls = composeDirectToolBundle({
  registry,
  laneSelection,
  providerProfileRef: ref("provider_profile", "provider_profile_direct_fixture"),
  runtimeFactsRef: ref("runtime_facts", "runtime_facts_direct_fixture"),
  activationSnapshotRefs: [ref("activation_snapshot", "activation_snapshot_direct_fixture")],
  normalizedLaneRequestRef: ref("normalized_lane_request", "normalized_request_impl_001"),
  externalCapabilityProfile,
  toolNames: blockedSubAgentControlToolNames,
  nowMs,
});
assert.equal(unsafeSubAgentControls.status, "passed");
assert.deepEqual(unsafeSubAgentControls.providerDeclaredToolBundle.declaredToolNames, []);
assert.equal(unsafeSubAgentControls.residentCapabilityCatalogue.knownUnavailable.length, blockedSubAgentControlToolNames.length);
for (const row of unsafeSubAgentControls.residentCapabilityCatalogue.knownUnavailable) {
  assert.equal(row.status, "blocked_by_lane", `${row.toolName} should be blocked by implementation-worker lane`);
  assert.equal(row.toolFamily, "agent_runtime_control", `${row.toolName} should remain classified as control/interference`);
  assert.equal(row.callableInCurrentRequest, false);
  assert.equal(row.nonOmittable, true);
}
const waitAgentConditional = composeDirectToolBundle({
  registry,
  laneSelection,
  providerProfileRef: ref("provider_profile", "provider_profile_direct_fixture"),
  runtimeFactsRef: ref("runtime_facts", "runtime_facts_direct_fixture"),
  activationSnapshotRefs: [ref("activation_snapshot", "activation_snapshot_direct_fixture")],
  normalizedLaneRequestRef: ref("normalized_lane_request", "normalized_request_impl_001"),
  externalCapabilityProfile,
  toolNames: ["wait_agent"],
  nowMs,
});
assert.deepEqual(waitAgentConditional.providerDeclaredToolBundle.declaredToolNames, []);
assert.equal(waitAgentConditional.residentCapabilityCatalogue.knownUnavailable[0].toolName, "wait_agent");
assert.equal(waitAgentConditional.residentCapabilityCatalogue.knownUnavailable[0].status, "blocked_by_provider");
assert.equal(waitAgentConditional.residentCapabilityCatalogue.knownUnavailable[0].toolFamily, "agent_runtime_status");

const reviewLaneSelection = buildDirectRoleLaneSelection({
  registry,
  projectId: "project_role_lane_fixture",
  workThreadId: "work_thread_role_lane_fixture",
  threadId: "direct_session_role_lane_fixture",
  laneKind: "review_auditor",
  normalizedLaneRequestRef: ref("normalized_lane_request", "normalized_request_review_001"),
  controlledRouteRef: ref("controlled_route", "controlled_route_review_001"),
  roleHandoffPacketRef: ref("role_handoff_packet", "role_handoff_review_001"),
  authorityBoundaryRef: ref("authority_boundary", "authority_boundary_review_001"),
  nowMs,
});
const explicitReviewTools = composeDirectToolBundle({
  registry,
  laneSelection: reviewLaneSelection,
  providerProfileRef: ref("provider_profile", "provider_profile_direct_fixture"),
  runtimeFactsRef: ref("runtime_facts", "runtime_facts_direct_fixture"),
  activationSnapshotRefs: [ref("activation_snapshot", "activation_snapshot_direct_fixture")],
  normalizedLaneRequestRef: ref("normalized_lane_request", "normalized_request_review_001"),
  externalCapabilityProfile,
  toolNames: ["apply_patch", "read_file"],
  nowMs,
});
assert.equal(explicitReviewTools.status, "passed");
assert.deepEqual(explicitReviewTools.providerDeclaredToolBundle.declaredToolNames, ["read_file"]);
assert.equal(explicitReviewTools.residentCapabilityCatalogue.knownUnavailable.length, 1);
assert.equal(explicitReviewTools.residentCapabilityCatalogue.knownUnavailable[0].toolName, "apply_patch");
assert.equal(explicitReviewTools.residentCapabilityCatalogue.knownUnavailable[0].status, "blocked_by_lane");
assert.equal(explicitReviewTools.residentCapabilityCatalogue.knownUnavailable[0].nonOmittable, true);

const familyRestricted = composeDirectToolBundle({
  registry,
  laneSelection,
  providerProfileRef: ref("provider_profile", "provider_profile_direct_fixture"),
  runtimeFactsRef: ref("runtime_facts", "runtime_facts_direct_fixture"),
  activationSnapshotRefs: [ref("activation_snapshot", "activation_snapshot_direct_fixture")],
  normalizedLaneRequestRef: ref("normalized_lane_request", "normalized_request_impl_001"),
  externalCapabilityProfile,
  requestedToolFamilies: ["local_perception"],
  toolNames: ["apply_patch", "read_file"],
  nowMs,
});
assert.deepEqual(familyRestricted.providerDeclaredToolBundle.declaredToolNames, ["read_file"]);
assert.equal(familyRestricted.residentCapabilityCatalogue.knownUnavailable.length, 1);
assert.equal(familyRestricted.residentCapabilityCatalogue.knownUnavailable[0].toolName, "apply_patch");
assert.equal(familyRestricted.residentCapabilityCatalogue.knownUnavailable[0].status, "blocked_by_policy");

const noDefaultTools = composeDirectToolBundle({
  registry,
  laneSelection,
  providerProfileRef: ref("provider_profile", "provider_profile_direct_fixture"),
  runtimeFactsRef: ref("runtime_facts", "runtime_facts_direct_fixture"),
  activationSnapshotRefs: [ref("activation_snapshot", "activation_snapshot_direct_fixture")],
  normalizedLaneRequestRef: ref("normalized_lane_request", "normalized_request_impl_001"),
  externalCapabilityProfile,
  toolNames: [],
  useLaneDefaultTools: false,
  nowMs,
});
assert.deepEqual(noDefaultTools.providerDeclaredToolBundle.declaredToolNames, []);
assert.equal(noDefaultTools.providerDeclaredToolBundle.toolChoice, "none");
assert.equal(noDefaultTools.residentCapabilityCatalogue.knownUnavailable.length, 0);

const defaultToolsFromEmptyList = composeDirectToolBundle({
  registry,
  laneSelection,
  providerProfileRef: ref("provider_profile", "provider_profile_direct_fixture"),
  runtimeFactsRef: ref("runtime_facts", "runtime_facts_direct_fixture"),
  activationSnapshotRefs: [ref("activation_snapshot", "activation_snapshot_direct_fixture")],
  normalizedLaneRequestRef: ref("normalized_lane_request", "normalized_request_impl_001"),
  externalCapabilityProfile,
  toolNames: [],
  useLaneDefaultTools: true,
  nowMs,
});
assert.notEqual(noDefaultTools.compositionId, defaultToolsFromEmptyList.compositionId, "default-tool policy must participate in composition identity");
assert.deepEqual(defaultToolsFromEmptyList.providerDeclaredToolBundle.declaredToolNames, implementationToolNames);

assert.doesNotThrow(() => composeDirectToolBundle(null));
assert.doesNotThrow(() => composeDirectToolBundle({ registry: {} }));
assert.deepEqual(
  validateResidentCapabilityCatalogue({
    schema: "resident_capability_catalogue@1",
    callableNow: "not-array",
    knownUnavailable: true,
    omittedByClass: {},
    nonOmittableRows: [],
  }).sort(),
  ["callable_now_not_array", "known_unavailable_not_array"].sort(),
);

const ungroundedSelection = buildDirectRoleLaneSelection({
  registry,
  projectId: "project_role_lane_fixture",
  workThreadId: "work_thread_role_lane_fixture",
  threadId: "direct_session_role_lane_fixture",
  laneKind: "implementation_worker",
  authorityBoundaryRef: ref("authority_boundary", "authority_boundary_impl_001"),
  nowMs,
});
assert.deepEqual(validateDirectRoleLaneSelection(ungroundedSelection), []);

const ungrounded = composeDirectToolBundle({
  registry,
  laneSelection: ungroundedSelection,
  providerProfileRef: ref("provider_profile", "provider_profile_direct_fixture"),
  runtimeFactsRef: ref("runtime_facts", "runtime_facts_direct_fixture"),
  activationSnapshotRefs: [ref("activation_snapshot", "activation_snapshot_direct_fixture")],
  nowMs,
});
assert.equal(ungrounded.status, "passed");
assert.deepEqual(validateDirectToolBundleComposition(ungrounded), []);
assert.deepEqual(ungrounded.providerDeclaredToolBundle.declaredToolNames, [], "missing normalized request grounding must block declarations");
assert.equal(ungrounded.providerDeclaredToolBundle.toolChoice, "none");
assert.equal(ungrounded.residentCapabilityCatalogue.callableNow.length, 0);
assert.equal(ungrounded.residentCapabilityCatalogue.knownUnavailable.length, implementationToolNames.length);
assert.equal(ungrounded.residentCapabilityCatalogue.nonOmittableRows.length, implementationToolNames.length);
assert.equal(ungrounded.residentCapabilityCatalogue.omittedByClass.blockedTools, implementationToolNames.length);
assert(ungrounded.witness.omittedReasonRows.every((row) => row.reason.includes("normalized lane request grounding")), "omission should cite missing grounding");
for (const row of ungrounded.residentCapabilityCatalogue.knownUnavailable) {
  assert.equal(row.status, "blocked_by_policy");
  assert.equal(row.callableInCurrentRequest, false);
  assert.equal(row.axes.declarationState, "blocked");
  assert.equal(row.axes.currentRequestStatus, "blocked");
  assert.equal(row.nonOmittable, true);
}

console.log(JSON.stringify({
  ok: true,
  registryId: registry.registryId,
  groundedCompositionId: grounded.compositionId,
  declaredToolNames: grounded.providerDeclaredToolBundle.declaredToolNames,
  ungroundedDeclaredToolNames: ungrounded.providerDeclaredToolBundle.declaredToolNames,
  ungroundedBlockedRows: ungrounded.residentCapabilityCatalogue.knownUnavailable.length,
}, null, 2));
