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
  directImplementationToolSchemas,
} = require("../src/main/direct/transport/codex-responses-transport");

const nowMs = Date.UTC(2026, 5, 21, 12, 30, 0);

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
  contextPacketRef: ref("context_packet", "context_packet_impl_001"),
  requestManifestRef: ref("request_manifest", "request_manifest_impl_001"),
  nowMs,
});

assert.equal(grounded.status, "passed");
assert.deepEqual(validateDirectToolBundleComposition(grounded), []);
assert.equal(grounded.providerDeclaredToolBundle.schema, "provider_declared_tool_bundle@1");
assert.deepEqual(grounded.providerDeclaredToolBundle.declaredToolNames, ["apply_patch", "read_file", "run_command"]);
assert.equal(grounded.providerDeclaredToolBundle.parallelToolCalls, false);
assert.equal(grounded.providerDeclaredToolBundle.toolChoice, "auto");
assert.equal(grounded.residentCapabilityCatalogue.callableNow.length, 3);
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

const oldToolNames = directImplementationToolSchemas(["read_file", "apply_patch", "run_command"]).map((schema) => schema.name).sort();
assert.deepEqual(grounded.providerDeclaredToolBundle.declaredToolNames, oldToolNames, "composer must preserve current implementation tool set in PR120");

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
  requestedToolFamilies: ["local_perception"],
  toolNames: ["apply_patch", "read_file"],
  nowMs,
});
assert.deepEqual(familyRestricted.providerDeclaredToolBundle.declaredToolNames, ["read_file"]);
assert.equal(familyRestricted.residentCapabilityCatalogue.knownUnavailable.length, 1);
assert.equal(familyRestricted.residentCapabilityCatalogue.knownUnavailable[0].toolName, "apply_patch");
assert.equal(familyRestricted.residentCapabilityCatalogue.knownUnavailable[0].status, "blocked_by_policy");

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
assert.equal(ungrounded.residentCapabilityCatalogue.knownUnavailable.length, 3);
assert.equal(ungrounded.residentCapabilityCatalogue.nonOmittableRows.length, 3);
assert.equal(ungrounded.residentCapabilityCatalogue.omittedByClass.blockedTools, 3);
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
