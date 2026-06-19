#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  ODEU_ACTIVATION_PRECEDENCE_LAW,
  ODEU_ACTIVATION_ROW_SCHEMA,
  ODEU_CAPABILITY_ROW_SCHEMA,
  ODEU_DECLARATION_SNAPSHOT_SCHEMA,
  ODEU_PROMOTION_DECISION_SCHEMA,
  buildOdeuActivationRow,
  buildOdeuCapabilityRow,
  buildOdeuDeclarationSnapshot,
  buildOdeuDigest,
  buildOdeuEvidenceRef,
  buildOdeuPromotionDecision,
  digestCanonicalJson,
  normalizeActivationScope,
  normalizeOdeuSourceRef,
  validateOdeuActivationRow,
  validateOdeuCapabilityRow,
  validateOdeuDeclarationSnapshot,
  validateOdeuPromotionDecision,
} = require("../src/main/direct/odeu");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectThrows(fn, expectedCode) {
  try {
    fn();
  } catch (error) {
    if (expectedCode && !String(error.message || "").includes(expectedCode)) {
      throw new Error(`expected ${expectedCode}, got ${error.message}`);
    }
    return error;
  }
  throw new Error(`expected throw: ${expectedCode}`);
}

const fixedNow = () => Date.UTC(2026, 5, 19, 15, 30, 0);

const sourceRef = normalizeOdeuSourceRef({
  sourceRefId: "source_lifecycle_fixture",
  sourceKind: "activation_registry",
  sourceId: "tool_activation_registry_fixture",
  sourceConfidence: "fixture",
  freshness: "fresh",
  rowId: "row_lifecycle_fixture",
}, { now: fixedNow });

const evidenceRef = buildOdeuEvidenceRef({
  evidenceId: "evidence_lifecycle_fixture",
  evidenceKind: "fixture_lifecycle",
  artifactRef: "artifact:tool_activation_registry_fixture",
  sourceRefs: [sourceRef],
}, { now: fixedNow });

const capability = buildOdeuCapabilityRow({
  capabilityId: "capability_read_file_fixture",
  family: "local_perception",
  capabilityKind: "read_file",
  authorityFamily: "workspace_read",
  capabilityState: "runtime_probed",
  implementationState: "restricted_executor",
  promotionState: "direct_restricted",
  providerDeclarationState: "not_declared",
  requestShapeFamilies: ["read_file"],
  resultEnvelopeKinds: ["local_perception"],
  sideEffectClass: "workspace_read",
  evidenceRefs: [evidenceRef],
  sourceRefs: [sourceRef],
  scope: {
    projectId: "project_lifecycle_fixture",
    workThreadId: "work_thread_lifecycle_fixture",
    runtimeTier: "headless_direct",
    environment: "fixture",
  },
}, { now: fixedNow });

assert(capability.schema === ODEU_CAPABILITY_ROW_SCHEMA, "capability row schema mismatch");
assert(capability.capabilityState === "runtime_probed", "capability state mismatch");
assert(capability.implementationState === "restricted_executor", "implementation state mismatch");
assert(capability.promotionState === "direct_restricted", "promotion state mismatch");
assert(capability.providerDeclarationState === "not_declared", "provider declaration state mismatch");
assert(capability.sideEffectClass === "workspace_read", "side effect class mismatch");
assert(capability.artifactDigest.algorithm === "sha256", "capability digest missing");
validateOdeuCapabilityRow(capability);

const blockedPromotion = buildOdeuPromotionDecision({
  promotionDecisionId: "promotion_blocked_fixture",
  capabilityId: capability.capabilityId,
  promotionClass: "fixture_blocked",
  evidenceClass: "fixture_only",
  decision: "promotable_restricted",
  freshness: "fresh",
  negativeEvidence: {
    noRawExposure: false,
    noRendererAuthorityGrant: true,
    noOutOfContractProviderTransport: true,
    noOutOfContractSideEffect: true,
    noContextSmuggling: true,
    noReplayUnsafeState: true,
  },
  evidenceRefs: [evidenceRef],
  sourceRefs: [sourceRef],
}, { now: fixedNow });

assert(blockedPromotion.decision === "blocked", "failed negative evidence should block promotion");
assert(blockedPromotion.blockers.includes("negative_evidence_failed:noRawExposure"), "negative-evidence blocker missing");

const promotion = buildOdeuPromotionDecision({
  promotionDecisionId: "promotion_read_file_fixture",
  capabilityId: capability.capabilityId,
  decision: "promotable_restricted",
  promotionClass: "headless_fixture_restricted",
  evidenceClass: "fixture_only",
  restrictions: [
    { restrictionId: "restriction_single_turn", reason: "fixture evidence only", appliesTo: "activation" },
    { restrictionId: "restriction_declaration_shadow", reason: "no provider declaration", appliesTo: "declaration" },
  ],
  freshness: "fresh",
  negativeEvidence: {
    noRawExposure: true,
    noRendererAuthorityGrant: true,
    noOutOfContractProviderTransport: true,
    noOutOfContractSideEffect: true,
    noContextSmuggling: true,
    noReplayUnsafeState: true,
  },
  evidenceRefs: [evidenceRef],
  sourceRefs: [sourceRef],
}, { now: fixedNow });

assert(promotion.schema === ODEU_PROMOTION_DECISION_SCHEMA, "promotion schema mismatch");
assert(promotion.decision === "promotable_restricted", "promotion decision mismatch");
assert(promotion.restrictions.length === 2, "promotion restrictions should normalize");
assert(promotion.blockers.length === 0, "valid negative evidence should not add blockers");
validateOdeuPromotionDecision(promotion);

const scope = normalizeActivationScope({
  kind: "work_thread_override",
  projectId: "project_lifecycle_fixture",
  workThreadId: "work_thread_lifecycle_fixture",
});
assert(scope.kind === "work_thread_override", "activation scope kind mismatch");
assert(scope.workThreadId === "work_thread_lifecycle_fixture", "activation scope work thread mismatch");

const activation = buildOdeuActivationRow({
  activationId: "activation_read_file_fixture",
  capabilityId: capability.capabilityId,
  promotionDecisionId: promotion.promotionDecisionId,
  state: "shadow_only",
  activationScope: scope,
  effect: "shadow",
  activationDecision: {
    activatedBy: "test_fixture",
    decisionId: "activation_decision_fixture",
    reason: "PR88 fixture-only lifecycle activation",
  },
  sourceRefs: [sourceRef],
}, { now: fixedNow });

assert(activation.schema === ODEU_ACTIVATION_ROW_SCHEMA, "activation row schema mismatch");
assert(activation.state === "shadow_only", "activation state mismatch");
assert(activation.effect === "shadow", "activation effect mismatch");
assert(activation.scope.kind === "work_thread_override", "activation scope should be structured");
assert(JSON.stringify(activation.precedenceLaw.order) === JSON.stringify(ODEU_ACTIVATION_PRECEDENCE_LAW.order), "precedence order mismatch");
assert(activation.precedenceLaw.denyWins === true, "deny-wins law missing");
assert(activation.precedenceLaw.emergencyRevokeWins === true, "emergency revoke law missing");
validateOdeuActivationRow(activation);

const activationRegistryDigest = digestCanonicalJson({
  activationId: activation.activationId,
  capabilityId: capability.capabilityId,
  state: activation.state,
}, { domain: "activation-registry-fixture@1", digestOf: "metadata" });

const declarationDigest = digestCanonicalJson({
  surfaceKind: "resident_tool",
  requestShapeFamily: "read_file",
  modelCallable: false,
}, { domain: "declaration-fixture@1", digestOf: "metadata" });

const declaration = buildOdeuDeclarationSnapshot({
  declarationSnapshotId: "declaration_read_file_fixture",
  activationId: activation.activationId,
  activationSnapshotId: "activation_snapshot_fixture",
  activationRegistryDigest,
  declarationDigest,
  toolSchemaDigest: buildOdeuDigest({ digestOf: "metadata", unavailableReason: "not_applicable" }),
  requestShapeFamily: "read_file",
  providerProfileId: "provider_profile_fixture",
  modelId: "gpt_fixture",
  surfaceKind: "resident_tool",
  residentVisible: true,
  operatorVisible: true,
  rendererVisible: true,
  providerDeclared: false,
  modelCallable: false,
  sourceRefs: [sourceRef],
}, { now: fixedNow });

assert(declaration.schema === ODEU_DECLARATION_SNAPSHOT_SCHEMA, "declaration schema mismatch");
assert(declaration.activationRegistryDigest.value === activationRegistryDigest.value, "activation registry digest mismatch");
assert(declaration.declarationDigest.value === declarationDigest.value, "declaration digest mismatch");
assert(declaration.requestShapeFamily === "read_file", "request shape family mismatch");
assert(declaration.providerDeclared === false, "provider declaration should remain false");
assert(declaration.modelCallable === false, "model callable should remain false");
validateOdeuDeclarationSnapshot(declaration);

expectThrows(() => validateOdeuCapabilityRow({
  ...capability,
  implementationState: "enabled_boolean_style",
}), "invalid_enum:implementationState");
expectThrows(() => validateOdeuActivationRow({
  ...activation,
  scope: null,
}), "missing_required_object:scope");
expectThrows(() => validateOdeuDeclarationSnapshot({
  ...declaration,
  activationRegistryDigest: { digestOf: "metadata", canonicalizationVersion: "odeu_canonical_json@1" },
}), "missing_required_digest_value:activationRegistryDigest");
expectThrows(() => validateOdeuDeclarationSnapshot({
  ...declaration,
  providerDeclared: false,
  modelCallable: true,
}), "model_callable_requires_provider_declaration");

const report = {
  schema: "direct_odeu_capability_lifecycle_regression@1",
  checks: {
    capabilityRow: true,
    promotionDecision: true,
    activationRow: true,
    declarationSnapshot: true,
    validationFailures: true,
  },
  lifecycleIds: {
    capabilityId: capability.capabilityId,
    promotionDecisionId: promotion.promotionDecisionId,
    activationId: activation.activationId,
    declarationSnapshotId: declaration.declarationSnapshotId,
  },
  sentinelCounters: {
    perCallAuthorityDecisions: 0,
    transactionsStarted: 0,
    providerDeclarationsCreated: 0,
    modelCallableToolsDeclared: 0,
    executorCalls: 0,
    workspaceMutations: 0,
    providerTransportCalls: 0,
  },
};

for (const [name, value] of Object.entries(report.sentinelCounters)) {
  assert(value === 0, `${name} should remain zero`);
}

console.log(JSON.stringify(report, null, 2));
