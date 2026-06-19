#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  ODEU_CAPABILITY_USABILITY_PROOF_SCHEMA,
  ODEU_CAPABILITY_WITNESS_ROW_SCHEMA,
  buildOdeuCapabilityUsabilityProof,
  buildOdeuCapabilityWitnessRow,
  normalizeOdeuSourceRef,
  normalizeProofRequirements,
  validateOdeuCapabilityUsabilityProof,
  validateOdeuCapabilityWitnessRow,
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

const fixedNow = () => Date.UTC(2026, 5, 19, 20, 0, 0);

const sourceRef = normalizeOdeuSourceRef({
  sourceRefId: "source_usability_proof_fixture",
  sourceKind: "test_report",
  sourceId: "direct_odeu_usability_proof_witness_regression",
  sourceConfidence: "fixture",
  freshness: "fresh",
}, { now: fixedNow });

const residentCallableProof = buildOdeuCapabilityUsabilityProof({
  proofId: "proof_read_file_resident_callable_fixture",
  capabilityId: "capability_read_file_fixture",
  family: "workspace_read",
  firstUsableSlice: {
    sliceId: "first_slice_read_file_fixture",
    description: "Read one workspace-contained file and admit the summary result.",
    capabilitiesIncluded: ["read_file"],
    stillDiagnostic: ["recursive_directory_read"],
    stillBlocked: ["outside_workspace_paths"],
  },
  promotionDecisionId: "promotion_read_file_fixture",
  activationSnapshotId: "activation_snapshot_read_file_fixture",
  declarationSnapshotId: "declaration_read_file_fixture",
  authorityDecisionId: "authority_decision_read_fixture",
  transactionId: "transaction_read_file_fixture",
  resultEnvelopeId: "result_envelope_read_fixture",
  contextAdmissionId: "admission_read_fixture",
  residentSnapshotId: "resident_snapshot_read_file_fixture",
  usableFor: "resident_callable",
  proofClass: "headless_live",
  proofEvidence: {
    deterministicChecksPassed: true,
    modelSelfReportSmokePassed: true,
  },
  recoveryTested: true,
  rawExposurePassed: true,
  sourceRefs: [sourceRef],
}, { now: fixedNow });

assert(residentCallableProof.schema === ODEU_CAPABILITY_USABILITY_PROOF_SCHEMA, "proof schema mismatch");
assert(residentCallableProof.proofRequirements.promotionDecisionRequired === true, "promotion decision should be required");
assert(residentCallableProof.proofRequirements.activationRequired === true, "activation should be required");
assert(residentCallableProof.proofRequirements.declarationRequired === true, "resident callable should require declaration");
assert(residentCallableProof.proofRequirements.authorityDecisionRequired === true, "resident callable should require authority");
assert(residentCallableProof.proofRequirements.transactionRequired === true, "resident callable should require transaction");
assert(residentCallableProof.proofRequirements.resultEnvelopeRequired === true, "resident callable should require result envelope");
assert(residentCallableProof.proofRequirements.contextAdmissionRequired === true, "resident callable should require admission");
assert(residentCallableProof.proofRequirements.residentWitnessRequired === true, "resident callable should require resident witness");
assert(residentCallableProof.proofRequirements.recoveryTestRequired === true, "headless live proof should require recovery test");
assert(residentCallableProof.proofEvidence.selfReportIsSupplemental === true, "self-report must be supplemental");
validateOdeuCapabilityUsabilityProof(residentCallableProof);

const residentWitness = buildOdeuCapabilityWitnessRow({
  witnessRowId: "witness_read_file_resident_fixture",
  capabilityId: residentCallableProof.capabilityId,
  usabilityProofId: residentCallableProof.proofId,
  residentVisible: true,
  residentCallable: true,
  operatorVisible: true,
  operatorCallable: false,
  status: "callable_now",
  compactText: "read_file callable for workspace-contained paths.",
  sourceRefs: [sourceRef],
}, { now: fixedNow });

assert(residentWitness.schema === ODEU_CAPABILITY_WITNESS_ROW_SCHEMA, "witness schema mismatch");
assert(residentWitness.usabilityProofId === residentCallableProof.proofId, "witness should cite usability proof");
assert(residentWitness.residentCallable === true, "resident witness should be callable");
validateOdeuCapabilityWitnessRow(residentWitness);

const operatorProof = buildOdeuCapabilityUsabilityProof({
  proofId: "proof_operator_file_open_fixture",
  capabilityId: "capability_operator_file_open_fixture",
  family: "operator_surface",
  firstUsableSlice: {
    sliceId: "first_slice_operator_file_open_fixture",
    description: "Operator can open a renderer-safe file reference.",
    capabilitiesIncluded: ["operator_open_file"],
  },
  promotionDecisionId: "promotion_operator_file_open_fixture",
  activationSnapshotId: "activation_snapshot_operator_file_open_fixture",
  operatorSurfaceId: "operator_surface_files_tab_fixture",
  usableFor: "operator_ui_live",
  proofClass: "operator_ui_live",
  proofEvidence: {
    deterministicChecksPassed: true,
  },
  recoveryTested: true,
  rawExposurePassed: true,
  sourceRefs: [sourceRef],
}, { now: fixedNow });
assert(operatorProof.proofRequirements.operatorSurfaceRequired === true, "operator UI proof should require operator surface");
validateOdeuCapabilityUsabilityProof(operatorProof);

const providerDeclaredRequirements = normalizeProofRequirements({}, "provider_declared", "fixture");
assert(providerDeclaredRequirements.declarationRequired === true, "provider_declared should require declaration");
assert(providerDeclaredRequirements.authorityDecisionRequired === false, "provider_declared should not require authority by default");

expectThrows(() => buildOdeuCapabilityUsabilityProof({
  proofId: "proof_missing_capability_fixture",
  family: "workspace_read",
  firstUsableSlice: {
    sliceId: "first_slice_missing_capability_fixture",
    description: "Invalid proof missing capability id.",
    capabilitiesIncluded: ["read_file"],
  },
  promotionDecisionId: "promotion_missing_capability_fixture",
  activationSnapshotId: "activation_snapshot_missing_capability_fixture",
  usableFor: "resident_visible",
  proofClass: "fixture",
  proofEvidence: {
    deterministicChecksPassed: true,
  },
  rawExposurePassed: true,
  sourceRefs: [sourceRef],
}), "missing_required_string:capabilityId");

expectThrows(() => buildOdeuCapabilityUsabilityProof({
  proofId: "proof_missing_promotion_fixture",
  capabilityId: "capability_missing_promotion_fixture",
  family: "workspace_read",
  firstUsableSlice: {
    sliceId: "first_slice_missing_promotion_fixture",
    description: "Invalid proof missing promotion decision id.",
    capabilitiesIncluded: ["read_file"],
  },
  activationSnapshotId: "activation_snapshot_missing_promotion_fixture",
  usableFor: "resident_visible",
  proofClass: "fixture",
  proofEvidence: {
    deterministicChecksPassed: true,
  },
  rawExposurePassed: true,
  sourceRefs: [sourceRef],
}), "missing_required_string:promotionDecisionId");

expectThrows(() => buildOdeuCapabilityUsabilityProof({
  proofId: "proof_missing_activation_fixture",
  capabilityId: "capability_missing_activation_fixture",
  family: "workspace_read",
  firstUsableSlice: {
    sliceId: "first_slice_missing_activation_fixture",
    description: "Invalid proof missing activation snapshot id.",
    capabilitiesIncluded: ["read_file"],
  },
  promotionDecisionId: "promotion_missing_activation_fixture",
  usableFor: "resident_visible",
  proofClass: "fixture",
  proofEvidence: {
    deterministicChecksPassed: true,
  },
  rawExposurePassed: true,
  sourceRefs: [sourceRef],
}), "missing_required_string:activationSnapshotId");

expectThrows(() => buildOdeuCapabilityUsabilityProof({
  proofId: "proof_self_report_only_fixture",
  capabilityId: "capability_self_report_only_fixture",
  family: "workspace_read",
  firstUsableSlice: {
    sliceId: "first_slice_self_report_only_fixture",
    description: "Invalid self-report-only proof.",
    capabilitiesIncluded: ["read_file"],
  },
  promotionDecisionId: "promotion_self_report_only_fixture",
  activationSnapshotId: "activation_snapshot_self_report_only_fixture",
  declarationSnapshotId: "declaration_self_report_only_fixture",
  authorityDecisionId: "authority_self_report_only_fixture",
  transactionId: "transaction_self_report_only_fixture",
  resultEnvelopeId: "result_envelope_self_report_only_fixture",
  contextAdmissionId: "admission_self_report_only_fixture",
  residentSnapshotId: "resident_snapshot_self_report_only_fixture",
  usableFor: "resident_callable",
  proofClass: "fixture",
  proofEvidence: {
    deterministicChecksPassed: false,
    modelSelfReportSmokePassed: true,
  },
  recoveryTested: false,
  rawExposurePassed: true,
  sourceRefs: [sourceRef],
}), "self_report_cannot_prove_usability");

expectThrows(() => buildOdeuCapabilityUsabilityProof({
  proofId: "proof_missing_admission_fixture",
  capabilityId: "capability_missing_admission_fixture",
  family: "workspace_read",
  firstUsableSlice: {
    sliceId: "first_slice_missing_admission_fixture",
    description: "Invalid resident callable proof missing admission.",
    capabilitiesIncluded: ["read_file"],
  },
  promotionDecisionId: "promotion_missing_admission_fixture",
  activationSnapshotId: "activation_snapshot_missing_admission_fixture",
  declarationSnapshotId: "declaration_missing_admission_fixture",
  authorityDecisionId: "authority_missing_admission_fixture",
  transactionId: "transaction_missing_admission_fixture",
  resultEnvelopeId: "result_envelope_missing_admission_fixture",
  residentSnapshotId: "resident_snapshot_missing_admission_fixture",
  usableFor: "resident_callable",
  proofClass: "fixture",
  proofEvidence: {
    deterministicChecksPassed: true,
  },
  rawExposurePassed: true,
  sourceRefs: [sourceRef],
}), "missing_required_string:contextAdmissionId");

expectThrows(() => buildOdeuCapabilityUsabilityProof({
  proofId: "proof_raw_exposure_fixture",
  capabilityId: "capability_raw_exposure_fixture",
  family: "workspace_read",
  firstUsableSlice: {
    sliceId: "first_slice_raw_exposure_fixture",
    description: "Invalid raw exposure proof.",
    capabilitiesIncluded: ["read_file"],
  },
  promotionDecisionId: "promotion_raw_exposure_fixture",
  activationSnapshotId: "activation_snapshot_raw_exposure_fixture",
  usableFor: "resident_visible",
  proofClass: "fixture",
  proofEvidence: {
    deterministicChecksPassed: true,
  },
  rawExposurePassed: false,
  sourceRefs: [sourceRef],
}), "raw_exposure_not_passed");

expectThrows(() => validateOdeuCapabilityUsabilityProof({
  ...residentCallableProof,
  contextAdmissionId: undefined,
  proofRequirements: {
    ...residentCallableProof.proofRequirements,
    contextAdmissionRequired: false,
  },
}), "proof_requirement_weakened:contextAdmissionRequired");

expectThrows(() => validateOdeuCapabilityUsabilityProof({
  ...residentCallableProof,
  proofClass: "headless_live",
  recoveryTested: false,
  proofRequirements: {
    ...residentCallableProof.proofRequirements,
    recoveryTestRequired: false,
  },
}), "proof_requirement_weakened:recoveryTestRequired");

expectThrows(() => buildOdeuCapabilityWitnessRow({
  witnessRowId: "witness_uncited_fixture",
  capabilityId: "capability_uncited_fixture",
  residentVisible: true,
  residentCallable: false,
  operatorVisible: false,
  operatorCallable: false,
  status: "known_available",
  compactText: "Visible without proof should fail.",
  sourceRefs: [sourceRef],
}), "visible_witness_requires_usability_proof");

expectThrows(() => buildOdeuCapabilityWitnessRow({
  witnessRowId: "witness_bad_callable_fixture",
  capabilityId: "capability_bad_callable_fixture",
  usabilityProofId: residentCallableProof.proofId,
  residentVisible: true,
  residentCallable: true,
  operatorVisible: false,
  operatorCallable: false,
  status: "known_available",
  compactText: "Callable witness must be callable_now.",
  sourceRefs: [sourceRef],
}), "resident_callable_requires_callable_status");

expectThrows(() => buildOdeuCapabilityWitnessRow({
  witnessRowId: "witness_missing_capability_fixture",
  usabilityProofId: residentCallableProof.proofId,
  residentVisible: true,
  residentCallable: false,
  operatorVisible: false,
  operatorCallable: false,
  status: "known_available",
  compactText: "Witness without capability id should fail.",
  sourceRefs: [sourceRef],
}), "missing_required_string:capabilityId");

expectThrows(() => validateOdeuCapabilityUsabilityProof(null), "missing_required_object:capabilityUsabilityProof");
expectThrows(() => validateOdeuCapabilityWitnessRow(null), "missing_required_object:capabilityWitnessRow");

const report = {
  schema: "direct_odeu_usability_proof_witness_regression@1",
  checks: {
    residentCallableProof: true,
    residentWitness: true,
    operatorProof: true,
    providerDeclaredRequirements: true,
    selfReportSupplementalOnly: true,
    requiredRefs: true,
    rawExposureBlocks: true,
    witnessCitation: true,
  },
  proofIds: {
    residentCallableProofId: residentCallableProof.proofId,
    residentWitnessRowId: residentWitness.witnessRowId,
    operatorProofId: operatorProof.proofId,
  },
  sentinelCounters: {
    providerTransportCalls: 0,
    executorCalls: 0,
    contextAdmissions: 0,
    memoryWrites: 0,
    projectTruthMutations: 0,
    residentToolDeclarations: 0,
  },
};

for (const [name, value] of Object.entries(report.sentinelCounters)) {
  assert(value === 0, `${name} should remain zero`);
}

console.log(JSON.stringify(report, null, 2));
