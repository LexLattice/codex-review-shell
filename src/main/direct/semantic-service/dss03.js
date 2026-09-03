"use strict";

/*
 * DSS-0.3 is intentionally a small, closed fake backend.  The worker is a
 * pure function over an owner-installed fixture bundle; the state file is the
 * durable custody boundary.  Nothing in this module can read a repository,
 * invoke a compiler/materializer, contact a provider, or mint DSS-0.2
 * authority.  The implementation is kept separate from the DSS-0.2 event
 * ledger because that ledger is execution-blind by design.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  Dss02Error,
  dss02Fail,
  canonicalJson,
  digestObject,
  digestBytes,
  randomRef,
  isoNow,
  atomicWrite,
  ensureDirectory,
  parseJsonStrict,
  immutableId,
  immutableDigest,
  checkedInteger,
  deepFreeze,
} = require("./dss02-common");
const { Dss03SqliteStore } = require("./dss03-sqlite");

const DSS03_SCHEMA = "direct_semantic_service_dss03@1";
const DSS03_TRANCHE_REVISION = "direct-semantic-service-dss03@0.3";
const DSS03_STATE_SCHEMA = "direct_semantic_service_dss03_state@1";
const RESULT_STATUSES = new Set(["support", "refute", "inconclusive", "remand"]);
const TERMINAL_CLASSES = new Set(["RESULT_EVALUATED", "EXPLICIT_REMAND", "TERMINAL_FAILURE", "AUTHORIZED_CANCELLATION"]);
const RETRYABLE_FAILURES = new Set([
  "transport_unavailable_before_dispatch",
  "transport_interrupted_before_raw_capture",
  "runtime_failed_before_raw_capture",
  "raw_result_structural_rejection",
]);
const FORBIDDEN_FIXTURE_KEYS = /(?:credential|private.?key|secret|network|socket|repository.?path|filesystem.?path|database|cas.?handle|quarantine.?handle|provider|model.?call|compiler.?invocation|materializer.?invocation)/i;
const LINEAGE_DIMENSIONS = ["principalRoot", "backendRoot", "kernelRoot", "routeRoot", "materializationRoot", "dataRoot", "runtimeRoot", "oracleRoot", "authorityRoot"];

/* Exact generation-9 carrier names are intentionally mapped here instead of
 * relying on a prose assertion that a camel-case field is "close enough".
 * The regression harness mechanically reconciles this table against the
 * frozen module.v0 carrier declarations.  Paths may be derived values, but
 * each exact frozen field has one and only one implementation source. */
const DSS03_CARRIER_FIELD_MAP = Object.freeze({
  "e.dss03-service-generation": { profile_ref: "generation.profileRef", daemon_generation: "generation.daemonGeneration", schema_revision: "generation.schema_revision", custody_head: "generation.custody_head", recovery_digest: "generation.recoveryDigest" },
  "e.dss02-handoff-intake": { job_ref: "handoffs[*].jobRef", admission_digest: "handoffs[*].jobAdmissionEventDigest", job_event_head: "handoffs[*].jobEventHead", dss02_generation: "handoffs[*].dss02Generation", fencing_token: "handoffs[*].fencingToken", dispatch_revision: "handoffs[*].dispatchBoundaryRevision", target_tranche_revision: "handoffs[*].targetTrancheRevision", handoff_digest: "handoffs[*].handoffEventDigest", dss03_generation: "handoffs[*].dss03Generation" },
  "d.dss02-request-authorization": { principal_lineage_ref: "boundary.verifyAuthorization.principalRef", request_digest: "authorization.authorizationDigest", operation: "authorization.operation", authorization_receipt_digest: "authorization.authorizationDigest", revocation_epoch: "authorization.revocationEpoch", registry_revision: "authorization.registryRevision", daemon_generation: "authorization.daemonGeneration", validation_time: "authorization.validationTime" },
  "e.fake-fixture-root": { installation_ref: "fixture.bundle.root.installationRef", root_fingerprint: "fixture.bundle.root.rootFingerprint", fixture_policy_digest: "fixture.bundle.root.fixturePolicyDigest" },
  "e.fake-fixture-registry": { registry_revision: "fixture.bundle.registry.registryRevision", root_fingerprint: "fixture.bundle.root.rootFingerprint", fixture_population_digest: "fixture.bundle.registry.fixturePopulationDigest", scenario_population_digest: "fixture.bundle.registry.scenarioPopulationDigest", signature: "fixture.bundle.registry.signature" },
  "e.fake-compiled-obligation-fixture": { fixture_ref: "fixture.bundle.compiled.fixtureRef", compiled_set_digest: "fixture.bundle.compiled.compiledSetDigest", edge_population_digest: "fixture.bundle.compiled.edgePopulationDigest", compiler_pin_ref: "fixture.bundle.compiled.compilerPinRef" },
  "e.fake-materialization-fixture": { materialization_ref: "fixture.bundle.materializations[*].materializationRef", route_ref: "fixture.bundle.materializations[*].routeRef", edge_ref: "fixture.bundle.materializations[*].edgeRef", required_cells_digest: "fixture.bundle.materializations[*].requiredCellsDigest", page_digest: "fixture.bundle.materializations[*].pageDigest", sufficiency_posture: "fixture.bundle.materializations[*].sufficiencyPosture" },
  "e.fake-runtime-revision": { runtime_revision: "fixture.bundle.runtime.runtimeRevision", adapter_digest: "fixture.bundle.runtime.adapterDigest", isolation_digest: "fixture.bundle.runtime.isolationDigest", environment_digest: "fixture.bundle.runtime.environmentDigest", output_policy_digest: "fixture.bundle.runtime.outputPolicyDigest" },
  "e.attempt-policy": { attempt_policy_ref: "plan.attemptPolicy.attemptPolicyRef", retryable_classes_digest: "plan.attemptPolicy.retryable_classes_digest", max_attempts: "plan.attemptPolicy.max_attempts", replicate_count: "plan.attemptPolicy.replicate_count", selection_rule: "plan.attemptPolicy.selection_rule", timeout_ms: "plan.attemptPolicy.timeout_ms", output_byte_limit: "plan.attemptPolicy.output_byte_limit" },
  "e.execution-plan": { job_ref: "plan.jobRef", execution_plan_ref: "plan.planRef", compiled_population_digest: "plan.compiledPopulationDigest", selected_population_digest: "plan.selectedPopulationDigest", excluded_population_digest: "plan.excludedPopulationDigest", expected_cells_digest: "plan.expectedCellsDigest", attempt_policy_ref: "plan.attemptPolicy.attemptPolicyRef", plan_digest: "plan.planDigest" },
  "e.expected-cell-population": { execution_plan_ref: "plan.planRef", expected_cells_digest: "plan.expectedCellsDigest", terminal_partition_digest: "plan.terminalPartitionDigest" },
  "e.cell-terminal-witness": { cell_ref: "cell.cellRef", terminal_class: "cell.terminalWitness.terminalClass", source_artifact_ref: "cell.terminalWitness.sourceArtifactRef", source_artifact_digest: "cell.terminalWitness.sourceArtifactDigest", terminal_event_digest: "cell.terminalWitness.terminalEventDigest" },
  "e.execution-capsule": { capsule_ref: "capsule.capsuleRef", cell_ref: "capsule.cellRef", kernel_ref: "capsule.kernelRef", edge_ref: "capsule.edgeRef", materialization_digest: "capsule.materializationDigest", runtime_revision: "capsule.runtimeRevision", attempt_policy_ref: "capsule.attemptPolicyRef", output_schema_digest: "capsule.outputSchemaDigest", compiler_pin_ref: "capsule.compilerPinRef", capsule_digest: "capsule.capsuleDigest" },
  "e.preexecution-assurance": { capsule_ref: "assurance.capsuleRef", assurance_digest: "assurance.assuranceDigest", generation: "assurance.generationRef", fixture_head: "assurance.fixtureHead", isolation_digest: "assurance.isolationDigest", sufficiency_posture: "assurance.sufficiencyPosture" },
  "e.execution-event-history": { profile_ref: "state.profileRef", global_head: "state.globalHead", job_population_digest: "state.jobPopulationDigest", custody_key_revision: "state.custodyKeyRevision" },
  "e.execution-derived-state": { job_ref: "plan.jobRef", reducer_revision: "state.reducerRevision", event_head: "state.globalHead", projection_digest: "state.projectionDigest" },
  "e.attempt-allocation": { cell_ref: "attempt.cellRef", replicate_slot: "attempt.replicateSlot", attempt_ordinal: "attempt.attemptOrdinal", attempt_ref: "attempt.attemptRef", policy_ref: "attempt.policyRef", allocation_event_digest: "attempt.allocationEventDigest" },
  "d.attempt-lease": { attempt_ref: "lease.attemptRef", capsule_ref: "lease.capsuleRef", generation: "lease.daemonGeneration", fencing_token: "lease.fencingToken", expiry: "lease.expiresAt", lease_event_digest: "lease.leaseEventDigest" },
  "e.execution-attempt": { attempt_ref: "attempt.attemptRef", cell_ref: "attempt.cellRef", replicate_slot: "attempt.replicateSlot", ordinal: "attempt.attemptOrdinal", capsule_ref: "attempt.capsuleRef", causal_failure_ref: "attempt.causalFailureRef", runtime_process_ref: "attempt.runtimeProcessRef" },
  "d.running-cancellation": { attempt_ref: "cancellation.attemptRef", request_digest: "cancellation.operationInputDigest", authorization_receipt: "cancellation.authorizationReceiptDigest", attempt_event_head: "cancellation.attemptEventHead", signal_event_digest: "cancellation.signalEventDigest" },
  "e.fake-runtime-observation": { attempt_ref: "observation.attemptRef", process_ref: "observation.processRef", start_time: "observation.startedAt", terminal_kind: "observation.terminalKind", terminal_time: "observation.terminalAt", stream_closure_digest: "observation.streamClosureDigest", buffered_byte_count: "observation.bufferedByteCount" },
  "e.raw-result": { attempt_ref: "raw.attemptRef", raw_result_ref: "raw.rawRef", capsule_ref: "raw.capsuleRef", process_ref: "raw.processRef", terminal_kind: "raw.terminalKind", digest: "raw.digest", byte_count: "raw.byteCount", quarantine_ref: "raw.quarantineRef", captured_at: "raw.capturedAt" },
  "e.raw-quarantine-custody": { quarantine_ref: "raw.quarantineRef", raw_digest: "raw.digest", byte_count: "raw.byteCount", retention_policy: "raw.retentionPolicy", custody_tag: "raw.custodyTag" },
  "e.microresult-admission": { attempt_ref: "admission.attemptRef", raw_digest: "admission.rawDigest", structural_receipts_digest: "admission.structuralReceiptsDigest", binding_receipts_digest: "admission.bindingReceiptsDigest", rejection_codes_digest: "admission.rejectionCodesDigest", admitted_microresult_ref: "admission.microresultRef" },
  "e.microresult": { microresult_ref: "microresult.microresultRef", cell_ref: "microresult.cellRef", kernel_ref: "microresult.kernelRef", capsule_ref: "microresult.capsuleRef", attempt_ref: "microresult.attemptRef", edge_ref: "microresult.edgeRef", materialization_digest: "microresult.materializationDigest", result_status: "microresult.resultStatus", claims_digest: "microresult.claimsDigest", evidence_refs_digest: "microresult.evidenceRefsDigest" },
  "e.page-fault-candidate": { candidate_ref: "candidate.candidateRef", attempt_ref: "candidate.attemptRef", materialization_ref: "candidate.materializationRef", candidate_kind: "candidate.candidateKind", rationale_digest: "candidate.rationaleDigest" },
  "e.novel-edge-candidate": { candidate_ref: "candidate.candidateRef", attempt_ref: "candidate.attemptRef", edge_ref: "candidate.edgeRef", bounded_report_digest: "candidate.boundedReportDigest" },
  "e.independence-assessment": { assessment_ref: "assessment.assessmentRef", compared_results_digest: "assessment.comparedResultsDigest", required_dimensions_digest: "assessment.requiredDimensionsDigest", observed_dimensions_digest: "assessment.observedDimensionsDigest", shared_dimensions_digest: "assessment.sharedDimensionsDigest", lineage_graph_digest: "assessment.lineageGraphDigest" },
  "e.evaluation-policy": { evaluation_policy_ref: "fixture.bundle.policies.evaluationPolicy.evaluationPolicyRef", attestation_law_digest: "fixture.bundle.policies.evaluationPolicy.attestationLawDigest", evaluation_law_digest: "fixture.bundle.policies.evaluationPolicy.evaluationLawDigest", selection_rule_digest: "fixture.bundle.policies.evaluationPolicy.selectionRuleDigest" },
  "e.attestation": { attestation_ref: "attestation.attestationRef", microresult_population_digest: "attestation.microresultPopulationDigest", class: "attestation.class", evidence_digest: "attestation.evidenceDigest", independence_ref: "attestation.independenceRef", verdict: "attestation.verdict" },
  "e.evaluation": { evaluation_ref: "evaluation.evaluationRef", cell_ref: "evaluation.cellRef", attempt_population_digest: "evaluation.attemptPopulationDigest", result_population_digest: "evaluation.resultPopulationDigest", attestation_population_digest: "evaluation.attestationPopulationDigest", dissent_digest: "evaluation.dissentDigest", disposition: "evaluation.disposition" },
  "e.terminal-coverage": { execution_plan_ref: "coverage.planRef", coverage_receipt_ref: "coverage.coverageReceiptRef", expected_digest: "coverage.expectedDigest", witness_population_digest: "coverage.witnessPopulationDigest", results_digest: "coverage.resultsDigest", remands_digest: "coverage.remandsDigest", failures_digest: "coverage.failuresDigest", cancellations_digest: "coverage.cancellationsDigest", duplicates_digest: "coverage.duplicatesDigest", unclassified_digest: "coverage.unclassifiedDigest" },
  "e.advisory-disposition": { job_ref: "disposition.jobRef", disposition_ref: "disposition.dispositionRef", plan_ref: "disposition.planRef", coverage_ref: "disposition.coverageReceiptRef", terminal_witness_population_digest: "disposition.terminalWitnessPopulationDigest", evaluation_population_digest: "disposition.evaluationPopulationDigest", selection_mode: "disposition.selectionMode", coverage_posture: "disposition.coveragePosture", disposition: "disposition.disposition" },
  "e.result-seal": { job_ref: "seal.jobRef", result_seal_ref: "seal.resultSealRef", coverage_ref: "seal.coverageReceiptRef", disposition_ref: "seal.dispositionRef", terminal_witness_population_digest: "seal.terminalWitnessPopulationDigest", artifact_population_digest: "seal.artifactPopulationDigest", event_head: "seal.eventHead", seal_digest: "seal.sealDigest" },
  "e.usage-accounting": { attempt_ref: "accounting.attemptRef", input_bytes: "accounting.inputBytes", output_bytes: "accounting.outputBytes", elapsed_fake_time: "accounting.elapsedFakeTime", model_tokens: "accounting.modelTokens", cost_microunits: "accounting.costMicrounits", accounting_event_digest: "accounting.accountingEventDigest" },
  "e.execution-recovery": { daemon_generation: "generation.daemonGeneration", population_digest: "state.populationDigest", event_head: "state.globalHead", artifact_inventory_digest: "generation.artifactInventoryDigest", classification_digest: "generation.classificationDigest" },
});

class Dss03Error extends Dss02Error {
  constructor(code, message = code, details = undefined) {
    super(code, message, details);
    this.name = "Dss03Error";
  }
}

function fail(code, message, details) { throw new Dss03Error(code, message, details); }
function object(value, code = "DSS03_OBJECT_INVALID") {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value;
}
function array(value, code = "DSS03_ARRAY_INVALID") {
  if (!Array.isArray(value)) fail(code);
  return value;
}
function string(value, label, { empty = false, max = 4096 } = {}) {
  if (typeof value !== "string" || (!empty && value.length === 0) || value.length > max || value.trim() !== value) fail("DSS03_STRING_INVALID", label);
  return value;
}
function id(value, label) { try { return immutableId(value, label); } catch (_) { fail("DSS03_ID_INVALID", label); } }
function digest(value, label) { try { return immutableDigest(value, label); } catch (_) { fail("DSS03_DIGEST_INVALID", label); } }
function nowValue(now) { return isoNow(typeof now === "function" ? now() : now); }
function clone(value) { return parseJsonStrict(canonicalJson(value)); }
function freeze(value) { return deepFreeze(clone(value)); }
function fixtureRawBytes(bundle) {
  const bytes = new Map();
  for (const [scenarioRef, scenario] of Object.entries(bundle.scenarios || {})) if (scenario.rawBytesBase64 !== undefined) {
    if (typeof scenario.rawBytesBase64 !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(scenario.rawBytesBase64)) fail("DSS03_RAW_FIXTURE_INVALID", scenarioRef);
    bytes.set(scenarioRef, Buffer.from(scenario.rawBytesBase64, "base64"));
  }
  return bytes;
}
function scrubFixtureRawBytes(bundle) {
  const value = clone(bundle);
  for (const scenario of Object.values(value.scenarios || {})) delete scenario.rawBytesBase64;
  return value;
}
function unique(values, label) {
  array(values, "DSS03_ARRAY_INVALID");
  const seen = new Set();
  for (const value of values) { const key = string(value, label); if (seen.has(key)) fail("DSS03_DUPLICATE_SET_ENTRY", label); seen.add(key); }
  return [...values];
}
function digestList(values, domain) { return digestObject(domain, [...values].sort()); }
function expectedCellPopulationDigest(cells) {
  return digestObject("Dss03.ExpectedCells.v1", cells.map((cell) => {
    const value = clone(cell);
    delete value.capsuleRef; delete value.state; delete value.terminalClass; delete value.terminalWitness; delete value.evaluationRef;
    return value;
  }).sort((a, b) => a.cellRef.localeCompare(b.cellRef)));
}
function terminalPartitionDigest(cells) {
  /* The expected-cell partition is frozen at plan admission.  Terminal
   * classes are mutable reducer output and therefore must not be folded into
   * the plan's immutable population identity. */
  return digestObject("Dss03.TerminalPartition.v1", cells.map((cell) => ({ cellRef: cell.cellRef, edgeOccurrenceRef: cell.edgeOccurrenceRef, replicateSlot: cell.replicateSlot })).sort((a, b) => a.cellRef.localeCompare(b.cellRef)));
}
function operationDigest(operation, input) { return digestObject(`DirectSemanticService.Dss03Operation.${operation}.v1`, input); }
function canonicalArtifactDigest(bytes) { return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`; }
function statusOf(record) { return record?.status || record?.state || null; }
function stateDigest(state) {
  const copy = clone(state);
  delete copy.integrity;
  return digestObject("DirectSemanticService.Dss03State.v1", copy);
}

/* The offline verifier is deliberately an owner-supplied boundary, not a
 * receipt parser.  It closes over immutable, exact predecessor records and
 * returns a copy only after the supplied identity digest matches the retained
 * record.  Production use normally injects the adapter below for a live
 * DSS-0.2 daemon. */
function createDss03PredecessorBoundary({ handoffs = [], authorizations = [] } = {}) {
  const handoffByJob = new Map(handoffs.map((entry) => {
    const value = clone(entry);
    if (!value.jobRef || !value.identityDigest) fail("DSS03_PREDECESSOR_FIXTURE_INVALID");
    return [value.jobRef, value];
  }));
  const authorizationByReceipt = new Map(authorizations.map((entry) => {
    const value = clone(entry);
    if (!value.receiptRef || !value.authorizationDigest) fail("DSS03_PREDECESSOR_AUTH_FIXTURE_INVALID");
    return [value.receiptRef, value];
  }));
  return Object.freeze({
    verifyHandoff(input = {}) {
      const retained = handoffByJob.get(input.jobRef);
      const identityTuple = retained && Object.fromEntries(Object.entries(retained).filter(([key]) => !["identityDigest", "state"].includes(key)));
      if (!retained || retained.state !== "HANDOFF_COMMITTED" || retained.identityDigest !== digestObject("DirectSemanticService.Dss03Handoff.v1", identityTuple)) fail("DSS03_PREDECESSOR_HANDOFF_UNVERIFIED");
      for (const key of ["jobAdmissionEventDigest", "jobEventHead", "dss02Generation", "fencingToken", "dispatchBoundaryRevision", "targetTrancheRevision", "handoffEventDigest"]) if (input[key] !== undefined && input[key] !== retained[key]) fail("DSS03_PREDECESSOR_HANDOFF_MISMATCH", key);
      const predecessor = clone(retained); delete predecessor.state; return predecessor;
    },
    verifyAuthorization(receipt, { operation, jobRef } = {}) {
      if (!receipt || !receipt.receiptRef) fail("DSS03_INHERITED_AUTHORIZATION_INVALID");
      const retained = authorizationByReceipt.get(receipt.receiptRef);
      if (!retained || retained.authorizationDigest !== digestObject("DirectSemanticService.Dss03Authorization.v1", Object.fromEntries(Object.entries(retained).filter(([key]) => key !== "authorizationDigest")))) fail("DSS03_INHERITED_AUTHORIZATION_INVALID");
      if (retained.operation !== operation || (retained.jobRef && retained.jobRef !== jobRef)) fail("DSS03_INHERITED_AUTHORIZATION_INVALID");
      const suppliedDigest = digestObject("DirectSemanticService.Dss03Authorization.v1", Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== "authorizationDigest")));
      if (suppliedDigest !== retained.authorizationDigest) fail("DSS03_INHERITED_AUTHORIZATION_INVALID");
      return clone(retained);
    },
  });
}

function createDss02PredecessorBoundary(daemon) {
  if (!daemon?.store) fail("DSS03_PREDECESSOR_BOUNDARY_INVALID");
  return Object.freeze({
    verifyHandoff(input = {}) {
      const jobRef = id(input.jobRef, "jobRef");
      if (daemon.ledger?.verify) daemon.ledger.verify();
      if (daemon.ledger?.assertHeads) daemon.ledger.assertHeads();
      const job = daemon.store.get("SELECT * FROM jobs WHERE job_ref=?", jobRef);
      const boundary = daemon.store.get("SELECT * FROM dispatch_boundaries WHERE job_ref=?", jobRef);
      if (!job || !boundary || boundary.state !== "HANDOFF_COMMITTED") fail("DSS03_DSS02_HANDOFF_UNVERIFIED");
      const admission = daemon.store.get("SELECT * FROM service_events WHERE job_ref=? AND event_type='job_admitted' ORDER BY job_sequence LIMIT 1", jobRef);
      const event = daemon.store.get("SELECT * FROM service_events WHERE event_digest=?", boundary.handoff_event_digest);
      if (!admission || !event) fail("DSS03_DSS02_EVENT_PREFIX_INVALID");
      const payload = JSON.parse(event.payload_json);
      if (event.job_ref !== jobRef || event.event_type !== "later_tranche_handoff_committed" || event.event_digest !== boundary.handoff_event_digest || payload.boundaryRevision !== boundary.boundary_revision - 1 || payload.targetTrancheRevision !== boundary.target_tranche_revision || payload.daemonGeneration !== boundary.daemon_generation || payload.fencingToken !== boundary.fencing_token || payload.leaseRef === undefined || payload.leaseRevision === undefined) fail("DSS03_DSS02_HANDOFF_PAYLOAD_MISMATCH");
      const retained = { jobRef, jobAdmissionEventDigest: admission.event_digest, jobEventHead: job.event_digest, dss02Generation: boundary.daemon_generation, fencingToken: boundary.fencing_token, dispatchBoundaryRevision: boundary.boundary_revision, targetTrancheRevision: boundary.target_tranche_revision, handoffEventDigest: boundary.handoff_event_digest, leaseRef: payload.leaseRef, leaseRevision: payload.leaseRevision };
      for (const key of ["jobAdmissionEventDigest", "jobEventHead", "dss02Generation", "fencingToken", "dispatchBoundaryRevision", "targetTrancheRevision", "handoffEventDigest"]) if (input[key] !== undefined && input[key] !== retained[key]) fail("DSS03_DSS02_HANDOFF_MISMATCH", key);
      return retained;
    },
    verifyAuthorization(receipt, { operation } = {}) {
      if (typeof daemon.validateAuthorizationReceipt !== "function") fail("DSS03_INHERITED_AUTHORIZATION_INVALID");
      try { return daemon.validateAuthorizationReceipt(receipt, { operation }); } catch (_) { fail("DSS03_INHERITED_AUTHORIZATION_INVALID"); }
    },
  });
}
function result(value, status, extra = {}) { return freeze({ schema: DSS03_SCHEMA, status, authorityEffect: "none", ...extra, ...(value || {}) }); }

function rejectForbiddenFixtureContent(value, location = "fixture") {
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (FORBIDDEN_FIXTURE_KEYS.test(value)) fail("DSS03_FIXTURE_CONTENT_FORBIDDEN", location);
    return;
  }
  if (Array.isArray(value)) { for (const entry of value) rejectForbiddenFixtureContent(entry, location); return; }
  if (typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_FIXTURE_KEYS.test(key)) fail("DSS03_FIXTURE_CONTENT_FORBIDDEN", `${location}.${key}`);
      rejectForbiddenFixtureContent(entry, `${location}.${key}`);
    }
  }
}

function normalizeFixtureBundle(bundle) {
  object(bundle, "DSS03_FIXTURE_BUNDLE_INVALID");
  rejectForbiddenFixtureContent(bundle);
  if (bundle.schema !== "direct_semantic_fake_fixture_bundle@1") fail("DSS03_FIXTURE_SCHEMA_INVALID");
  const root = object(bundle.root, "DSS03_FIXTURE_ROOT_INVALID");
  const registry = object(bundle.registry, "DSS03_FIXTURE_REGISTRY_INVALID");
  const compiled = object(bundle.compiled, "DSS03_COMPILED_FIXTURE_INVALID");
  const runtime = object(bundle.runtime, "DSS03_RUNTIME_FIXTURE_INVALID");
  const policies = object(bundle.policies, "DSS03_POLICIES_INVALID");
  const edgeOccurrences = array(compiled.edgeOccurrences, "DSS03_EDGE_POPULATION_INVALID");
  if (edgeOccurrences.length === 0) fail("DSS03_EDGE_POPULATION_EMPTY");
  const edges = edgeOccurrences.map((entry, index) => {
    object(entry, "DSS03_EDGE_OCCURRENCE_INVALID");
    return {
      edgeOccurrenceRef: id(entry.edgeOccurrenceRef || `edge-occurrence-${index + 1}`, "edgeOccurrenceRef"),
      edgeRef: id(entry.edgeRef || entry.edgeOccurrenceRef || `edge-${index + 1}`, "edgeRef"),
      obligationRef: id(entry.obligationRef || entry.edgeOccurrenceRef || `obligation-${index + 1}`, "obligationRef"),
      materializationRef: id(entry.materializationRef || `materialization-${index + 1}`, "materializationRef"),
      sourceDigest: entry.sourceDigest ? digest(entry.sourceDigest, "sourceDigest") : digestObject("Dss03.Fixture.Edge.v1", entry),
    };
  });
  const materials = array(bundle.materializations, "DSS03_MATERIALIZATION_POPULATION_INVALID");
  const materializations = materials.map((entry) => {
    object(entry, "DSS03_MATERIALIZATION_INVALID");
    const sufficiency = entry.sufficiencyPosture || entry.sufficiency || "SUFFICIENT";
    if (!["SUFFICIENT", "KNOWN_INSUFFICIENT"].includes(sufficiency)) fail("DSS03_MATERIALIZATION_SUFFICIENCY_INVALID");
    return {
      materializationRef: id(entry.materializationRef, "materializationRef"),
      routeRef: id(entry.routeRef || `route-${entry.materializationRef}`, "routeRef"),
      edgeRef: id(entry.edgeRef || entry.materializationRef, "edgeRef"),
      requiredCells: Array.isArray(entry.requiredCells) ? unique(entry.requiredCells, "requiredCells").map((v) => id(v, "requiredCellRef")) : [],
      pageDigest: entry.pageDigest ? digest(entry.pageDigest, "pageDigest") : digestObject("Dss03.Fixture.Page.v1", entry),
      sufficiencyPosture: sufficiency,
      root: entry.root || root.rootFingerprint || "fixture-materialization-root",
    };
  });
  const scenarios = object(bundle.scenarios || {}, "DSS03_SCENARIOS_INVALID");
  const normalizedScenarios = {};
  for (const [key, scenario] of Object.entries(scenarios)) {
    object(scenario, "DSS03_SCENARIO_INVALID");
    const raw = scenario.rawResult || scenario.raw || {
      schema: "direct_semantic_microresult@1",
      resultStatus: scenario.resultStatus || "support",
      claims: scenario.claims || { fixture: key },
      evidenceRefs: scenario.evidenceRefs || [],
      authorityEffect: "none",
    };
    if (!RESULT_STATUSES.has(raw.resultStatus)) fail("DSS03_RESULT_STATUS_INVALID");
    const rawValue = clone(raw);
    for (const candidateField of ["pageFaultCandidate", "novelEdgeCandidate"]) if (rawValue[candidateField]) {
      object(rawValue[candidateField], "DSS03_RAW_CANDIDATE_INVALID");
      if (rawValue[candidateField].candidateRef === undefined) rawValue[candidateField].candidateRef = `raw-${candidateField}-${digestObject("Dss03.RawCandidate.v1", rawValue[candidateField]).slice(7)}`;
      id(rawValue[candidateField].candidateRef, "candidateRef");
    }
    normalizedScenarios[key] = {
      runtimeTerminal: scenario.runtimeTerminal || "EXIT",
      failureClass: scenario.failureClass || null,
      runtimeFacts: { acknowledged: scenario.runtimeFacts?.acknowledged === true, contactLost: scenario.runtimeFacts?.contactLost === true, reaped: scenario.runtimeFacts?.reaped === true, streamsClosed: scenario.runtimeFacts?.streamsClosed === true, bufferedBytes: checkedInteger(Number(scenario.runtimeFacts?.bufferedBytes || 0), "bufferedBytes", 0) },
      rawResult: rawValue,
      ...(scenario.rawBytesBase64 === undefined ? {} : { rawBytesBase64: scenario.rawBytesBase64 }),
      pageFaultCandidate: scenario.pageFaultCandidate || null,
      novelEdgeCandidate: scenario.novelEdgeCandidate || null,
      lineage: clone(scenario.lineage || Object.fromEntries(LINEAGE_DIMENSIONS.map((dimension) => [dimension, `${dimension}:${key}`]))),
      elapsedFakeTime: Number.isSafeInteger(scenario.elapsedFakeTime) && scenario.elapsedFakeTime >= 0 ? scenario.elapsedFakeTime : 1,
    };
  }
  if (!Object.keys(normalizedScenarios).length) normalizedScenarios.default = {
    runtimeTerminal: "EXIT",
    failureClass: null,
    rawResult: { schema: "direct_semantic_microresult@1", resultStatus: "support", claims: { fixture: "default" }, evidenceRefs: [], authorityEffect: "none" },
    pageFaultCandidate: null,
    novelEdgeCandidate: null,
    lineage: Object.fromEntries(LINEAGE_DIMENSIONS.map((dimension) => [dimension, `${dimension}:default`])),
    elapsedFakeTime: 1,
  };
  const attemptPolicy = object(policies.attemptPolicy, "DSS03_ATTEMPT_POLICY_INVALID");
  const normalizedPolicy = {
    attemptPolicyRef: id(attemptPolicy.attemptPolicyRef || "attempt-policy-dss03", "attemptPolicyRef"),
    retryableFailureClasses: unique(attemptPolicy.retryableFailureClasses || [], "retryableFailureClasses"),
    maximumAttemptsPerReplicateSlot: checkedInteger(Number(attemptPolicy.maximumAttemptsPerReplicateSlot || 1), "maximumAttemptsPerReplicateSlot", 1),
    replicateCountPerCell: checkedInteger(Number(attemptPolicy.replicateCountPerCell || 1), "replicateCountPerCell", 1),
    selectionRule: attemptPolicy.selectionRule || "all_results_independent",
    timeoutMs: checkedInteger(Number(attemptPolicy.timeoutMs || 1000), "timeoutMs", 1),
    outputByteLimit: checkedInteger(Number(attemptPolicy.outputByteLimit || 64 * 1024), "outputByteLimit", 1),
    fixedBeforeExecution: true,
  };
  if (!normalizedPolicy.retryableFailureClasses.every((entry) => RETRYABLE_FAILURES.has(entry))) fail("DSS03_RETRY_CLASS_INVALID");
  if (!["all_results_independent", "unanimity_reports_agreement_only", "fixed_majority_reports_agreement_only"].includes(normalizedPolicy.selectionRule)) fail("DSS03_SELECTION_RULE_INVALID");
  const evaluationPolicy = object(policies.evaluationPolicy || {}, "DSS03_EVALUATION_POLICY_INVALID");
  const boundMaterializations = materializations.map((materialization) => {
    const owningEdges = edges.filter((edge) => edge.materializationRef === materialization.materializationRef);
    const derivedRequiredCells = owningEdges.flatMap((edge) => Array.from({ length: normalizedPolicy.replicateCountPerCell }, (_, slot) => `${edge.edgeOccurrenceRef}:slot:${slot}`));
    const requiredCells = materialization.requiredCells.length ? [...materialization.requiredCells].sort() : derivedRequiredCells.sort();
    const requiredCellsDigest = digestObject("Dss03.RequiredCells.v1", requiredCells);
    return { ...materialization, requiredCells, requiredCellsDigest, required_cells_digest: requiredCellsDigest };
  });
  const normalized = {
    schema: bundle.schema,
    root: { installationRef: id(root.installationRef || "offline-direct-installation", "installationRef"), rootFingerprint: string(root.rootFingerprint || digestObject("Dss03.Fixture.Root", root), "rootFingerprint"), fixturePolicyDigest: root.fixturePolicyDigest || digestObject("Dss03.Fixture.Policy", root) },
    registry: { registryRevision: id(registry.registryRevision || "fixture-registry-dss03", "registryRevision"), fixturePopulationDigest: registry.fixturePopulationDigest || digestObject("Dss03.Fixture.Population", bundle), scenarioPopulationDigest: registry.scenarioPopulationDigest || digestObject("Dss03.Fixture.Scenarios", normalizedScenarios), signature: string(registry.signature || "owner-installed-fixture-signature", "signature") },
    compiled: { fixtureRef: id(compiled.fixtureRef || "compiled-obligations-dss03", "fixtureRef"), compilerPinRef: id(compiled.compilerPinRef || "structural-fixture-compiler-pin", "compilerPinRef"), compiledSetDigest: compiled.compiledSetDigest || digestObject("Dss03.Fixture.CompiledSet", edges), edgePopulationDigest: compiled.edgePopulationDigest || digestObject("Dss03.Fixture.Edges", edges), edgeOccurrences: edges },
    materializations: boundMaterializations,
    runtime: { runtimeRevision: id(runtime.runtimeRevision || "fake-runtime-dss03", "runtimeRevision"), executionProfileRef: id(runtime.executionProfileRef || "fake-execution-profile-dss03", "executionProfileRef"), kernelRef: id(runtime.kernelRef || "fake-kernel-dss03", "kernelRef"), adapterDigest: runtime.adapterDigest || digestObject("Dss03.Fixture.Runtime", runtime), isolationDigest: runtime.isolationDigest || digestObject("Dss03.Fixture.Isolation", { network: false, model: false, credentials: false }), environmentDigest: runtime.environmentDigest || digestObject("Dss03.Fixture.Environment", runtime), outputPolicyDigest: runtime.outputPolicyDigest || digestObject("Dss03.Fixture.OutputPolicy", runtime) },
    policies: { attemptPolicy: { ...normalizedPolicy, fakeRuntimeRevision: runtime.runtimeRevision, retryableClassesDigest: digestList(normalizedPolicy.retryableFailureClasses, "Dss03.RetryableClasses.v1"), maxAttempts: normalizedPolicy.maximumAttemptsPerReplicateSlot, replicateCount: normalizedPolicy.replicateCountPerCell, fake_runtime_revision: runtime.runtimeRevision, retryable_classes_digest: digestList(normalizedPolicy.retryableFailureClasses, "Dss03.RetryableClasses.v1"), max_attempts: normalizedPolicy.maximumAttemptsPerReplicateSlot, replicate_count: normalizedPolicy.replicateCountPerCell, selection_rule: normalizedPolicy.selectionRule, timeout_ms: normalizedPolicy.timeoutMs, output_byte_limit: normalizedPolicy.outputByteLimit }, evaluationPolicy: { evaluationPolicyRef: id(evaluationPolicy.evaluationPolicyRef || "evaluation-policy-dss03", "evaluationPolicyRef"), lawDigest: evaluationPolicy.lawDigest || digestObject("Dss03.Fixture.EvaluationLaw", evaluationPolicy), requiredIndependentResults: evaluationPolicy.requiredIndependentResults !== false, lineageDimensions: [...LINEAGE_DIMENSIONS], attestationLawDigest: evaluationPolicy.attestationLawDigest || digestObject("Dss03.AttestationLaw.v1", { requiredIndependentResults: evaluationPolicy.requiredIndependentResults !== false }), evaluationLawDigest: evaluationPolicy.evaluationLawDigest || digestObject("Dss03.EvaluationLaw.v1", evaluationPolicy), selectionRuleDigest: evaluationPolicy.selectionRuleDigest || digestObject("Dss03.SelectionRule.v1", normalizedPolicy.selectionRule) } },
    scenarios: normalizedScenarios,
  };
  normalized.policies.attemptPolicy.fakeRuntimeRevision = normalized.runtime.runtimeRevision;
  normalized.policies.attemptPolicy.fake_runtime_revision = normalized.runtime.runtimeRevision;
  normalized.bundleDigest = digestObject("DirectSemanticService.Dss03FixtureBundle.v1", normalized);
  return freeze(normalized);
}

function emptyState(profileRef) {
  return { schema: DSS03_STATE_SCHEMA, profileRef, trancheRevision: DSS03_TRANCHE_REVISION, schema_revision: DSS03_STATE_SCHEMA, generation: null, fixture: null, handoffs: {}, plans: {}, capsules: {}, assurances: {}, cells: {}, attempts: {}, leases: {}, observations: {}, raw: {}, admissions: {}, microresults: {}, candidates: {}, assessments: {}, attestations: {}, evaluations: {}, coverages: {}, dispositions: {}, seals: {}, accounting: {}, cas: {}, events: [], counters: { eventSequence: 0, attemptSequence: 0 }, globalHead: null, jobPopulationDigest: null, custodyKeyRevision: null, reducerRevision: "dss03-reducer-v1", projectionDigest: null, populationDigest: null, integrity: null };
}

class Dss03FakeExecutionBackend {
  constructor(options = {}) {
    object(options, "DSS03_OPTIONS_INVALID");
    const allowed = new Set(["profileRoot", "profileRef", "now", "dss02", "predecessorBoundary", "ownerFixtureBundle", "trancheRevision"]);
    for (const key of Object.keys(options)) if (!allowed.has(key)) fail("DSS03_OPTIONS_INVALID", key);
    this.profileRef = options.profileRef || "direct-profile";
    this.profileRoot = options.profileRoot || null;
    this.now = options.now;
    this.dss02 = options.dss02 || null;
    this.predecessorBoundary = options.predecessorBoundary || (this.dss02 ? createDss02PredecessorBoundary(this.dss02) : null);
    this.trancheRevision = options.trancheRevision || DSS03_TRANCHE_REVISION;
    this.ownerFixtureBundle = options.ownerFixtureBundle ? normalizeFixtureBundle(options.ownerFixtureBundle) : null;
    this.fixtureRawBytes = this.ownerFixtureBundle ? fixtureRawBytes(this.ownerFixtureBundle) : new Map();
    this.statePath = this.profileRoot ? path.join(path.resolve(this.profileRoot), "direct-semantic-dss03.state.json") : null;
    this.sqlite = this.profileRoot ? new Dss03SqliteStore({ root: path.resolve(this.profileRoot), dss02: this.dss02, now: this.now }) : null;
    this.state = emptyState(this.profileRef);
    this.memoryQuarantine = new Map();
    this.opened = false;
    this.recoveryRequired = false;
    this._load();
  }

  clock() { return nowValue(this.now); }
  _load() {
    if (this.sqlite) {
      const authoritative = this.sqlite.readState();
      if (authoritative) {
        if (authoritative.schema !== DSS03_STATE_SCHEMA || authoritative.profileRef !== this.profileRef || authoritative.trancheRevision !== this.trancheRevision) fail("DSS03_STATE_IDENTITY_INVALID");
        this.state = authoritative;
        this.state.cas ||= {};
        if (this.state.generation && this.state.generation.state !== "BLOCKED") this.recoveryRequired = true;
        return;
      }
      if (this.statePath && fs.existsSync(this.statePath)) fail("DSS03_SQLITE_SIGNED_IMPORT_REQUIRED");
    }
    if (!this.statePath || !fs.existsSync(this.statePath)) return;
    try { if (fs.lstatSync(this.statePath).isSymbolicLink()) fail("DSS03_STATE_SYMLINK_FORBIDDEN"); } catch (error) { if (error.code !== "ENOENT") throw error; }
    let parsed;
    try { parsed = parseJsonStrict(fs.readFileSync(this.statePath, "utf8")); } catch (error) { fail("DSS03_STATE_CORRUPT", error.message); }
    if (parsed.schema !== DSS03_STATE_SCHEMA || parsed.profileRef !== this.profileRef || parsed.trancheRevision !== this.trancheRevision) fail("DSS03_STATE_IDENTITY_INVALID");
    if (parsed.integrity && parsed.integrity.stateDigest !== stateDigest(parsed)) fail("DSS03_STATE_DIGEST_MISMATCH");
    if (this.profileRoot) for (const raw of Object.values(parsed.raw || {})) delete raw.payloadBase64;
    this.state = parsed;
    this.state.cas ||= {};
    if (this.sqlite) {
      try { this.sqlite.writeState(this.state); }
      catch (error) { const authoritative = this.sqlite.readState(); if (authoritative) this.state = authoritative; throw error; }
    }
    if (this.state.generation && this.state.generation.state !== "BLOCKED") this.recoveryRequired = true;
  }
  _persist() {
    for (const raw of Object.values(this.state.raw || {})) delete raw.payloadBase64;
    this.state.globalHead = this.state.events.length ? this.state.events[this.state.events.length - 1].eventDigest : null;
    this.state.jobPopulationDigest = digestObject("Dss03.JobPopulation.v1", Object.values(this.state.handoffs || {}).map((handoff) => ({ jobRef: handoff.jobRef, identityDigest: handoff.identityDigest })).sort((a, b) => a.jobRef.localeCompare(b.jobRef)));
    this.state.populationDigest = digestObject("Dss03.Population.v1", Object.fromEntries(["handoffs", "plans", "cells", "capsules", "assurances", "attempts", "leases", "observations", "raw", "admissions", "microresults", "candidates", "assessments", "attestations", "evaluations", "coverages", "dispositions", "seals", "accounting", "cas"].map((name) => [name, Object.keys(this.state[name] || {}).sort()])));
    const projectionBasis = clone(this.state); delete projectionBasis.integrity; delete projectionBasis.projectionDigest;
    this.state.projectionDigest = digestObject("Dss03.Projection.v1", projectionBasis);
    if (this.state.generation) { this.state.generation.schema_revision = DSS03_STATE_SCHEMA; this.state.generation.custody_head = this.state.globalHead; this.state.generation.daemon_generation = this.state.generation.daemonGeneration; this.state.generation.recovery_digest = this.state.generation.recoveryDigest; this.state.generation.artifactInventoryDigest = digestObject("Dss03.ArtifactInventory.v1", Object.keys(this.state.cas || {}).sort()); this.state.generation.classificationDigest = this.state.generation.classificationDigest || null; }
    this.state.integrity = { stateDigest: stateDigest(this.state), persistedAt: this.clock() };
    if (this.sqlite) {
      try { this.sqlite.writeState(this.state); }
      catch (error) { const authoritative = this.sqlite.readState(); if (authoritative) this.state = authoritative; else { this.recoveryRequired = true; } throw error; }
    }
    if (this.statePath) { try { ensureDirectory(path.dirname(this.statePath)); atomicWrite(this.statePath, Buffer.from(canonicalJson(this.state), "utf8")); } catch (_) { /* SQLite is authoritative; projection repair is recoverable on the next open. */ } }
  }
  _event(type, payload = {}) {
    const event = { eventRef: randomRef("dss03-event"), sequence: ++this.state.counters.eventSequence, type, payload: clone(payload), recordedAt: this.clock(), priorDigest: this.state.events.length ? this.state.events[this.state.events.length - 1].eventDigest : null };
    event.eventDigest = digestObject("DirectSemanticService.Dss03ExecutionEvent.v1", event);
    this.state.events.push(event);
    return event;
  }
  _saveEvent(type, payload, extra = {}) { const event = this._event(type, payload); this._persist(); return { ...extra, eventDigest: event.eventDigest, eventSequence: event.sequence }; }
  _requireOpen() { if (!this.opened) fail("DSS03_NOT_OPEN"); }
  _requireReady() { this._requireOpen(); if (this.recoveryRequired || !this.state.generation || this.state.generation.state !== "READY") fail("DSS03_GENERATION_NOT_READY"); }
  _requireInitialOrReady() { this._requireOpen(); if (this.recoveryRequired) fail("DSS03_RECOVERY_REQUIRED"); if (!this.state.generation || !["OPEN", "READY"].includes(this.state.generation.state)) fail("DSS03_GENERATION_NOT_READY"); }
  _requireGeneration(generationRef = undefined) { this._requireOpen(); if (!this.state.generation) fail("DSS03_GENERATION_UNOPENED"); if (generationRef && this.state.generation.generationRef !== generationRef) fail("DSS03_FOREIGN_GENERATION"); return this.state.generation; }
  _job(jobRef) { const handoff = this.state.handoffs[jobRef]; if (!handoff) fail("DSS03_HANDOFF_UNKNOWN"); return handoff; }
  _plan(planRef) { const plan = this.state.plans[planRef]; if (!plan) fail("DSS03_PLAN_UNKNOWN"); return plan; }
  _cell(cellRef) { const cell = this.state.cells[cellRef]; if (!cell) fail("DSS03_CELL_UNKNOWN"); return cell; }
  _fixture() { if (!this.state.fixture || this.state.fixture.state !== "INSTALLED") fail("DSS03_FIXTURE_REGISTRY_UNAVAILABLE"); return this.state.fixture.bundle; }
  _policy() { return this._fixture().policies.attemptPolicy; }
  _assertNoCallerFixture(value) { if (value !== undefined) fail("DSS03_CALLER_FIXTURE_FORBIDDEN"); }
  _validateLease(input, attempt, { operation = "lease" } = {}) {
    object(input, "DSS03_LEASE_INPUT_INVALID");
    const leaseRef = id(input.leaseRef, "leaseRef");
    const leaseRevision = checkedInteger(Number(input.leaseRevision), "leaseRevision", 1);
    const fencingToken = checkedInteger(Number(input.fencingToken), "fencingToken", 0);
    const lease = this.state.leases[leaseRef];
    if (!lease || attempt.leaseRef !== leaseRef || lease.attemptRef !== attempt.attemptRef || lease.leaseRevision !== leaseRevision || lease.fencingToken !== fencingToken || lease.daemonGeneration !== this.state.generation.generationRef) fail("DSS03_STALE_LEASE", operation);
    if (lease.state !== "ACTIVE") fail("DSS03_LEASE_NOT_ACTIVE", operation);
    if (new Date(lease.expiresAt).getTime() <= new Date(this.clock()).getTime()) fail("DSS03_LEASE_EXPIRED", operation);
    return lease;
  }
  _replayOrConflict(record, inputDigest, operation) {
    if (!record) return null;
    if (record.operationInputDigest !== inputDigest) fail("DSS03_REPLAY_INPUT_CONFLICT", operation);
    return result(null, "EXACT_REPLAY", { [operation]: record });
  }

  openDss03Generation() {
    if (this.opened && this.state.generation) return result(null, "EXACT_REPLAY", { generation: this.state.generation });
    if (this.state.generation?.state === "BLOCKED") fail("DSS03_GENERATION_BLOCKED");
    if (this.state.fixture?.state === "BROKEN") fail("DSS03_FIXTURE_BROKEN");
    this.opened = true;
    if (this.state.generation) return result(null, "EXACT_REPLAY", { generation: this.state.generation, recoveryRequired: this.recoveryRequired });
    const generation = { generationRef: this.state.generation?.generationRef || randomRef("dss03-generation"), profileRef: this.profileRef, trancheRevision: this.trancheRevision, state: "OPEN", daemonGeneration: this.dss02?.generation?.generationRef || this.dss02?.store?.currentGeneration?.()?.generation_ref || null, openedAt: this.clock(), recoveryDigest: null };
    this.state.generation = generation;
    this._saveEvent("generation_opened", { generationRef: generation.generationRef, trancheRevision: this.trancheRevision });
    return result(null, "OPEN", { generation });
  }

  installFakeFixtureRegistry(options = undefined) {
    this._requireOpen();
    if (options !== undefined) fail("DSS03_CALLER_FIXTURE_FORBIDDEN");
    if (!this.ownerFixtureBundle) fail("DSS03_OWNER_FIXTURE_BUNDLE_REQUIRED");
    if (this.state.fixture) {
      if (this.state.fixture.state === "BROKEN") fail("DSS03_FIXTURE_BROKEN");
      if (this.state.fixture.bundleDigest === this.ownerFixtureBundle.bundleDigest && this.state.fixture.state === "INSTALLED") { const publicFixture = clone(this.state.fixture); delete publicFixture.bundle; return result(null, "EXACT_REPLAY", { fixture: publicFixture }); }
      fail("DSS03_FIXTURE_REGISTRY_REPLACEMENT_FORBIDDEN");
    }
    const fixture = { state: "INSTALLED", bundleDigest: this.ownerFixtureBundle.bundleDigest, root: this.ownerFixtureBundle.root, registry: this.ownerFixtureBundle.registry, bundle: scrubFixtureRawBytes(this.ownerFixtureBundle), installedAt: this.clock() };
    this.state.fixture = fixture;
    this._saveEvent("fixture_registry_installed", { bundleDigest: fixture.bundleDigest, registryRevision: fixture.registry.registryRevision });
    const publicFixture = { ...fixture };
    delete publicFixture.bundle;
    return result(null, "INSTALLED", { fixture: publicFixture });
  }

  verifyFakeFixtureRegistry() {
    this._requireOpen();
    if (this.state.fixture?.state === "BROKEN") fail("DSS03_FIXTURE_BROKEN");
    const fixture = this._fixture();
    const withoutDigest = clone(fixture);
    delete withoutDigest.bundleDigest;
    const recomputed = digestObject("DirectSemanticService.Dss03FixtureBundle.v1", withoutDigest);
    if (this.ownerFixtureBundle?.bundleDigest !== fixture.bundleDigest && fixture.bundleDigest !== recomputed) fail("DSS03_FIXTURE_DIGEST_MISMATCH");
    if (Object.values(fixture.scenarios || {}).some((scenario) => scenario.rawBytesBase64 !== undefined)) fail("DSS03_RAW_BYTES_IN_ORDINARY_STATE");
    if (!this.state.fixture.root || this.state.fixture.root.rootFingerprint !== fixture.root.rootFingerprint) fail("DSS03_FIXTURE_ROOT_MISMATCH");
    if (this.ownerFixtureBundle && this.ownerFixtureBundle.bundleDigest !== fixture.bundleDigest) fail("DSS03_FIXTURE_OWNER_MISMATCH");
    if (this.ownerFixtureBundle && canonicalJson(fixture) !== canonicalJson(scrubFixtureRawBytes(this.ownerFixtureBundle))) fail("DSS03_FIXTURE_BUNDLE_MISMATCH");
    if (this.ownerFixtureBundle && canonicalJson(fixture.root) !== canonicalJson(this.ownerFixtureBundle.root)) fail("DSS03_FIXTURE_ROOT_MISMATCH");
    if (this.ownerFixtureBundle && canonicalJson(fixture.registry) !== canonicalJson(this.ownerFixtureBundle.registry)) fail("DSS03_FIXTURE_REGISTRY_MISMATCH");
    return result(null, "VERIFIED", { registryRevision: fixture.registry.registryRevision, bundleDigest: fixture.bundleDigest, rootFingerprint: fixture.root.rootFingerprint });
  }

  acceptDss02Handoff(input = {}) {
    this._requireReady(); object(input, "DSS03_HANDOFF_INVALID");
    const jobRef = id(input.jobRef, "jobRef");
    if (!this.predecessorBoundary || typeof this.predecessorBoundary.verifyHandoff !== "function") fail("DSS03_PREDECESSOR_BOUNDARY_REQUIRED");
    const existing = this.state.handoffs[jobRef];
    const predecessor = this.predecessorBoundary.verifyHandoff(input);
    const tuple = { ...predecessor }; delete tuple.identityDigest; tuple.dss03Generation = this.state.generation.generationRef;
    if (tuple.targetTrancheRevision !== this.trancheRevision) fail("DSS03_TARGET_TRANCHE_MISMATCH");
    for (const key of ["jobAdmissionEventDigest", "jobEventHead", "dss02Generation", "fencingToken", "dispatchBoundaryRevision", "targetTrancheRevision", "handoffEventDigest", "dss03Generation"]) if (tuple[key] === undefined || tuple[key] === null) fail("DSS03_HANDOFF_TUPLE_INCOMPLETE", key);
    const identity = digestObject("DirectSemanticService.Dss03Handoff.v1", tuple);
    if (existing) { if (existing.identityDigest !== identity) fail("DSS03_HANDOFF_REPLAY_MISMATCH"); return result(null, "EXACT_REPLAY", { handoff: existing }); }
    const handoff = { ...tuple, identityDigest: identity, state: "ACCEPTED", acceptedAt: this.clock() };
    this.state.handoffs[jobRef] = handoff;
    this._saveEvent("dss02_handoff_accepted", { jobRef, identityDigest: identity, targetTrancheRevision: tuple.targetTrancheRevision });
    return result(null, "ACCEPTED", { handoff });
  }

  instantiateExecutionPlan(input = {}) {
    this._requireReady(); object(input, "DSS03_PLAN_INPUT_INVALID");
    const handoff = this._job(id(input.jobRef, "jobRef"));
    const fixture = this._fixture();
    const selectionMode = input.selectionMode || "partial_selection";
    if (!["partial_selection", "exhaustive"].includes(selectionMode)) fail("DSS03_SELECTION_MODE_INVALID");
    const selectedRefs = input.edgeOccurrenceRefs || fixture.compiled.edgeOccurrences.map((edge) => edge.edgeOccurrenceRef);
    const selected = unique(selectedRefs, "edgeOccurrenceRefs").map((ref) => id(ref, "edgeOccurrenceRef"));
    const compiled = fixture.compiled.edgeOccurrences.map((edge) => edge.edgeOccurrenceRef);
    if (selected.some((ref) => !compiled.includes(ref))) fail("DSS03_EDGE_NOT_COMPILED", selected.find((ref) => !compiled.includes(ref)));
    if (selectionMode === "exhaustive" && (selected.length !== compiled.length || selected.some((ref, i) => ref !== compiled[i]))) fail("DSS03_EXHAUSTIVE_SELECTION_DRIFT");
    const policy = clone(fixture.policies.attemptPolicy);
    const planRef = id(input.executionPlanRef || randomRef("execution-plan"), "executionPlanRef");
    const inputDigest = operationDigest("instantiateExecutionPlan", { jobRef: handoff.jobRef, executionPlanRef: planRef, selectionMode, edgeOccurrenceRefs: selected });
    if (this.state.plans[planRef]) { if (this.state.plans[planRef].operationInputDigest !== inputDigest) fail("DSS03_REPLAY_INPUT_CONFLICT", "instantiateExecutionPlan"); return result(null, "EXACT_REPLAY", { plan: this.state.plans[planRef] }); }
    const expectedCells = [];
    for (const edge of fixture.compiled.edgeOccurrences.filter((item) => selected.includes(item.edgeOccurrenceRef))) {
      for (let slot = 0; slot < policy.replicateCountPerCell; slot += 1) {
        const cellRef = randomRef("cell");
        expectedCells.push({ cellRef, planRef, jobRef: handoff.jobRef, edgeOccurrenceRef: edge.edgeOccurrenceRef, edgeRef: edge.edgeRef, obligationRef: edge.obligationRef, materializationRef: edge.materializationRef, replicateSlot: slot, state: "OPEN", terminalClass: null });
        this.state.cells[cellRef] = expectedCells[expectedCells.length - 1];
      }
    }
    const excluded = compiled.filter((ref) => !selected.includes(ref));
    policy.fakeRuntimeRevision = fixture.runtime.runtimeRevision;
    const plan = { planRef, jobRef: handoff.jobRef, generationRef: this.state.generation.generationRef, selectionMode, selectedEdgeOccurrenceRefs: selected, compiledEdgeOccurrenceRefs: compiled, excludedEdgeOccurrenceRefs: excluded, expectedCellRefs: expectedCells.map((cell) => cell.cellRef), compiledPopulationDigest: fixture.compiled.compiledSetDigest, selectedPopulationDigest: digestList(selected, "Dss03.SelectedPopulation.v1"), excludedPopulationDigest: digestList(excluded, "Dss03.ExcludedPopulation.v1"), expectedCellsDigest: expectedCellPopulationDigest(expectedCells), terminalPartitionDigest: terminalPartitionDigest(expectedCells), attemptPolicy: policy, attemptPolicyDigest: digestObject("Dss03.AttemptPolicy.v1", policy), operationInputDigest: inputDigest, state: "ADMITTED", createdAt: this.clock() };
    plan.planDigest = digestObject("DirectSemanticService.Dss03ExecutionPlan.v1", plan);
    this.state.plans[planRef] = plan;
    this._saveEvent("execution_plan_frozen", { planRef, jobRef: handoff.jobRef, expectedCellsDigest: plan.expectedCellsDigest, selectionMode });
    return result(null, "ADMITTED", { plan });
  }

  admitExecutionCapsule(input = {}) {
    this._requireReady(); object(input, "DSS03_CAPSULE_INPUT_INVALID");
    const plan = this._plan(id(input.planRef, "planRef"));
    const cell = this._cell(id(input.cellRef, "cellRef"));
    if (cell.planRef !== plan.planRef) fail("DSS03_PLAN_CELL_MISMATCH");
    const fixture = this._fixture();
    const materialization = fixture.materializations.find((item) => item.materializationRef === cell.materializationRef);
    if (!materialization) fail("DSS03_MATERIALIZATION_UNKNOWN");
    const capsuleRef = id(input.capsuleRef || randomRef("capsule"), "capsuleRef");
    const kernelRef = fixture.runtime.kernelRef;
    if (input.kernelRef !== undefined && id(input.kernelRef, "kernelRef") !== kernelRef) fail("DSS03_KERNEL_SELECTOR_FORBIDDEN");
    const scenarioRef = string(input.scenarioRef || "default", "scenarioRef");
    if (!Object.prototype.hasOwnProperty.call(fixture.scenarios, scenarioRef)) fail("DSS03_SCENARIO_UNDECLARED", scenarioRef);
    const inputDigest = operationDigest("admitExecutionCapsule", { planRef: plan.planRef, cellRef: cell.cellRef, capsuleRef, kernelRef, scenarioRef });
    if (this.state.capsules[capsuleRef]) { if (this.state.capsules[capsuleRef].operationInputDigest !== inputDigest) fail("DSS03_REPLAY_INPUT_CONFLICT", "admitExecutionCapsule"); return result(null, "EXACT_REPLAY", { capsule: this.state.capsules[capsuleRef] }); }
    const capsule = { capsuleRef, cellRef: cell.cellRef, planRef: plan.planRef, jobRef: plan.jobRef, generationRef: this.state.generation.generationRef, fixtureBundleDigest: fixture.bundleDigest, fixtureRootFingerprint: fixture.root.rootFingerprint, fixtureRegistryRevision: fixture.registry.registryRevision, kernelRef, edgeRef: cell.edgeRef, materializationRef: materialization.materializationRef, materializationDigest: materialization.pageDigest, routeRef: materialization.routeRef, runtimeRevision: fixture.runtime.runtimeRevision, executionProfileRef: fixture.runtime.executionProfileRef, attemptPolicyRef: plan.attemptPolicy.attemptPolicyRef, attemptPolicyDigest: plan.attemptPolicyDigest, outputSchemaDigest: digestObject("Dss03.OutputSchema.v1", { schema: "direct_semantic_microresult@1", status: [...RESULT_STATUSES] }), compilerPinRef: fixture.compiled.compilerPinRef, scenarioRef, operationInputDigest: inputDigest, capsuleDigest: null, state: "ADMITTED", admittedAt: this.clock() };
    capsule.capsuleDigest = digestObject("DirectSemanticService.Dss03ExecutionCapsule.v1", capsule);
    this.state.capsules[capsuleRef] = capsule;
    cell.capsuleRef = capsuleRef;
    this._saveEvent("execution_capsule_admitted", { capsuleRef, cellRef: cell.cellRef, capsuleDigest: capsule.capsuleDigest });
    return result(null, "ADMITTED", { capsule });
  }

  performPreexecutionAssurance(input = {}) {
    this._requireReady(); object(input, "DSS03_ASSURANCE_INPUT_INVALID");
    const capsule = this.state.capsules[id(input.capsuleRef, "capsuleRef")]; if (!capsule) fail("DSS03_CAPSULE_UNKNOWN");
    const cell = this._cell(capsule.cellRef); const plan = this._plan(capsule.planRef); const fixture = this._fixture();
    const materialization = fixture.materializations.find((item) => item.materializationRef === capsule.materializationRef);
    if (!materialization) fail("DSS03_MATERIALIZATION_UNKNOWN");
    this._assertPlanPolicyFrozen(plan); const capsuleUnsigned = clone(capsule); capsuleUnsigned.capsuleDigest = null;
    const outputSchemaDigest = digestObject("Dss03.OutputSchema.v1", { schema: "direct_semantic_microresult@1", status: [...RESULT_STATUSES] });
    const edge = fixture.compiled.edgeOccurrences.find((candidate) => candidate.edgeOccurrenceRef === cell.edgeOccurrenceRef);
    const requiredCellKey = `${cell.edgeOccurrenceRef}:slot:${cell.replicateSlot}`;
    const expectedCellsForPlan = Object.values(this.state.cells).filter((candidate) => candidate.planRef === plan.planRef).sort((a, b) => a.cellRef.localeCompare(b.cellRef));
    if (capsule.capsuleDigest !== digestObject("DirectSemanticService.Dss03ExecutionCapsule.v1", capsuleUnsigned) || capsule.state !== "ADMITTED" || capsule.jobRef !== plan.jobRef || capsule.generationRef !== this.state.generation.generationRef || capsule.fixtureBundleDigest !== fixture.bundleDigest || capsule.fixtureRootFingerprint !== fixture.root.rootFingerprint || capsule.fixtureRegistryRevision !== fixture.registry.registryRevision || capsule.kernelRef !== fixture.runtime.kernelRef || capsule.cellRef !== cell.cellRef || !edge || cell.edgeRef !== edge.edgeRef || capsule.materializationRef !== cell.materializationRef || capsule.materializationDigest !== materialization.pageDigest || capsule.routeRef !== materialization.routeRef || capsule.runtimeRevision !== fixture.runtime.runtimeRevision || capsule.executionProfileRef !== fixture.runtime.executionProfileRef || capsule.attemptPolicyRef !== plan.attemptPolicy.attemptPolicyRef || capsule.attemptPolicyDigest !== plan.attemptPolicyDigest || capsule.compilerPinRef !== fixture.compiled.compilerPinRef || capsule.outputSchemaDigest !== outputSchemaDigest || !Object.prototype.hasOwnProperty.call(fixture.scenarios, capsule.scenarioRef) || !materialization.requiredCells.includes(requiredCellKey) || materialization.requiredCellsDigest !== digestObject("Dss03.RequiredCells.v1", [...materialization.requiredCells].sort()) || expectedCellsForPlan.length !== plan.expectedCellRefs.length || expectedCellPopulationDigest(expectedCellsForPlan) !== plan.expectedCellsDigest) fail("DSS03_CAPSULE_BINDING_INVALID");
    if (input.networkEnabled === true || input.modelEnabled === true || input.credentialsAvailable === true || input.repositoryRead === true || input.projectMutation === true || input.materializerInvocation === true || input.compilerInvocation === true) fail("DSS03_PREFLIGHT_ISOLATION_VIOLATION");
    const assuranceRef = id(input.assuranceRef || randomRef("assurance"), "assuranceRef");
    const inputDigest = operationDigest("performPreexecutionAssurance", { capsuleRef: capsule.capsuleRef, assuranceRef, networkEnabled: input.networkEnabled === true, modelEnabled: input.modelEnabled === true, credentialsAvailable: input.credentialsAvailable === true, repositoryRead: input.repositoryRead === true, projectMutation: input.projectMutation === true, materializerInvocation: input.materializerInvocation === true, compilerInvocation: input.compilerInvocation === true });
    if (this.state.assurances[assuranceRef]) { if (this.state.assurances[assuranceRef].operationInputDigest !== inputDigest) fail("DSS03_REPLAY_INPUT_CONFLICT", "performPreexecutionAssurance"); return result(null, "EXACT_REPLAY", { assurance: this.state.assurances[assuranceRef] }); }
    const assurance = { assuranceRef, capsuleRef: capsule.capsuleRef, cellRef: cell.cellRef, planRef: plan.planRef, generationRef: this.state.generation.generationRef, fixtureHead: fixture.bundleDigest, fixtureBundleDigest: fixture.bundleDigest, pageDigest: materialization.pageDigest, sufficiencyPosture: materialization.sufficiencyPosture, isolation: { network: false, model: false, credentials: false, repositoryRead: false, projectMutation: false }, isolationDigest: fixture.runtime.isolationDigest, outputByteLimit: plan.attemptPolicy.outputByteLimit, operationInputDigest: inputDigest, assuranceDigest: null, state: materialization.sufficiencyPosture === "KNOWN_INSUFFICIENT" ? "KNOWN_INSUFFICIENT_REMAND" : "ELIGIBLE", createdAt: this.clock() };
    assurance.assuranceDigest = digestObject("Dss03.PreexecutionAssurance.v1", { ...assurance, assuranceDigest: null });
    this.state.assurances[assuranceRef] = assurance;
    if (assurance.state === "KNOWN_INSUFFICIENT_REMAND") {
      cell.state = "EXPLICIT_REMAND"; cell.terminalClass = "EXPLICIT_REMAND"; cell.terminalWitness = this._witness(cell, "EXPLICIT_REMAND", assuranceRef);
      this._saveEvent("cell_explicit_remand", { cellRef: cell.cellRef, assuranceRef, reason: "KNOWN_INSUFFICIENT" });
      return result(null, "KNOWN_INSUFFICIENT_REMAND", { assurance, cell: this._publicCell(cell) });
    }
    this._saveEvent("preexecution_assurance_eligible", { assuranceRef, capsuleRef: capsule.capsuleRef });
    return result(null, "ELIGIBLE", { assurance });
  }

  _publicCell(cell) { const output = clone(cell); delete output.terminalWitness; return output; }
  _witness(cell, terminalClass, sourceArtifactRef, terminalEventDigest = undefined) {
    if (!TERMINAL_CLASSES.has(terminalClass)) fail("DSS03_TERMINAL_CLASS_INVALID");
    if (cell.terminalWitness) { if (cell.terminalWitness.terminalClass === terminalClass) return cell.terminalWitness; fail("DSS03_DUPLICATE_TERMINAL_WITNESS"); }
    const witness = { witnessRef: randomRef("cell-witness"), cellRef: cell.cellRef, planRef: cell.planRef, terminalClass, sourceArtifactRef, sourceArtifactDigest: digestObject("Dss03.Witness.Source.v1", { sourceArtifactRef, terminalClass }), terminalEventDigest: terminalEventDigest || digestObject("Dss03.Witness.Event.v1", { cellRef: cell.cellRef, terminalClass, sourceArtifactRef }), createdAt: this.clock() };
    cell.terminalWitness = witness;
    return witness;
  }
  _assertPlanPolicyFrozen(plan) { if (plan.attemptPolicyDigest !== digestObject("Dss03.AttemptPolicy.v1", plan.attemptPolicy)) fail("DSS03_FROZEN_POLICY_DRIFT", plan.planRef); }

  allocateAttempt(input = {}) {
    this._requireReady(); object(input, "DSS03_ALLOCATION_INPUT_INVALID");
    const capsule = this.state.capsules[id(input.capsuleRef, "capsuleRef")]; if (!capsule) fail("DSS03_CAPSULE_UNKNOWN");
    const cell = this._cell(capsule.cellRef); const plan = this._plan(capsule.planRef); this._assertPlanPolicyFrozen(plan);
    const requestedAttemptRef = input.attemptRef === undefined ? null : id(input.attemptRef, "attemptRef");
    const inputDigest = operationDigest("allocateAttempt", { capsuleRef: capsule.capsuleRef, attemptRef: requestedAttemptRef });
    if (requestedAttemptRef && this.state.attempts[requestedAttemptRef]) { if (this.state.attempts[requestedAttemptRef].allocationInputDigest !== inputDigest) fail("DSS03_REPLAY_INPUT_CONFLICT", "allocateAttempt"); return result(null, "EXACT_REPLAY", { attempt: this.state.attempts[requestedAttemptRef] }); }
    const assurance = Object.values(this.state.assurances).find((item) => item.capsuleRef === capsule.capsuleRef && item.state === "ELIGIBLE");
    if (!assurance) { if (cell.state === "EXPLICIT_REMAND") return result(null, "EXACT_REPLAY", { cell: this._publicCell(cell) }); fail("DSS03_ASSURANCE_REQUIRED"); }
    if (cell.state !== "OPEN") fail("DSS03_CELL_TERMINAL");
    const existing = Object.values(this.state.attempts).filter((attempt) => attempt.cellRef === cell.cellRef && attempt.replicateSlot === cell.replicateSlot).sort((a, b) => b.attemptOrdinal - a.attemptOrdinal)[0];
    const nextOrdinal = existing ? existing.attemptOrdinal + 1 : 1;
    if (existing?.state === "RESULT_ADMITTED" || existing?.state === "RAW_CAPTURED") fail("DSS03_ADMITTED_RESULT_NOT_RETRYABLE");
    if (existing && existing.state !== "RETRYABLE_FAILURE") fail("DSS03_EXHAUSTION_PREDECESSOR_INVALID");
    if (nextOrdinal > plan.attemptPolicy.maximumAttemptsPerReplicateSlot) {
      const event = this._event("attempt_exhausted", { cellRef: cell.cellRef, replicateSlot: cell.replicateSlot });
      cell.state = "TERMINAL_FAILURE"; cell.terminalClass = "TERMINAL_FAILURE"; cell.terminalWitness = this._witness(cell, "TERMINAL_FAILURE", existing?.attemptRef || "attempt-exhausted", event.eventDigest); this._persist();
      return result(null, "EXHAUSTED", { cell: this._publicCell(cell), eventDigest: event.eventDigest });
    }
    const attemptRef = requestedAttemptRef || id(randomRef("attempt"), "attemptRef");
    if (this.state.attempts[attemptRef]) { if (this.state.attempts[attemptRef].allocationInputDigest !== inputDigest) fail("DSS03_REPLAY_INPUT_CONFLICT", "allocateAttempt"); return result(null, "EXACT_REPLAY", { attempt: this.state.attempts[attemptRef] }); }
    const allocationSequence = this.state.counters.attemptSequence + 1;
    const attempt = { attemptRef, capsuleRef: capsule.capsuleRef, cellRef: cell.cellRef, planRef: plan.planRef, policyRef: plan.attemptPolicy.attemptPolicyRef, replicateSlot: cell.replicateSlot, attemptOrdinal: nextOrdinal, allocationSequence, state: "ALLOCATED", daemonGeneration: this.state.generation.generationRef, fencingToken: this._job(plan.jobRef).fencingToken, causalFailureRef: null, runtimeProcessRef: null, allocationEventDigest: null, allocationInputDigest: inputDigest, allocatedAt: this.clock(), startedAt: null, terminalAt: null };
    this.state.attempts[attemptRef] = attempt;
    this.state.counters.attemptSequence += 1;
    const allocationEvent = this._saveEvent("attempt_allocated", { attemptRef, cellRef: cell.cellRef, attemptOrdinal: nextOrdinal, replicateSlot: cell.replicateSlot }); attempt.allocationEventDigest = allocationEvent.eventDigest; this._persist();
    return result(null, "ALLOCATED", { attempt });
  }

  acquireAttemptLease(input = {}) {
    this._requireReady(); object(input, "DSS03_LEASE_INPUT_INVALID");
    const attempt = this.state.attempts[id(input.attemptRef, "attemptRef")]; if (!attempt) fail("DSS03_ATTEMPT_UNKNOWN");
    const leaseRef = id(input.leaseRef || randomRef("lease"), "leaseRef");
    const ttlMs = checkedInteger(Number(input.ttlMs === undefined ? this._policy().timeoutMs : input.ttlMs), "lease ttl", 1); if (ttlMs !== this._policy().timeoutMs) fail("DSS03_LEASE_TTL_POLICY_DRIFT");
    const inputDigest = operationDigest("acquireAttemptLease", { attemptRef: attempt.attemptRef, leaseRef, ttlMs });
    const plan = this._plan(attempt.planRef); this._assertPlanPolicyFrozen(plan);
    if (attempt.leaseRef) { const current = this.state.leases[attempt.leaseRef]; if (current && current.leaseRef === leaseRef) { if (current.operationInputDigest !== inputDigest) fail("DSS03_REPLAY_INPUT_CONFLICT", "acquireAttemptLease"); return result(null, "EXACT_REPLAY", { lease: current }); } fail("DSS03_LEASE_ALREADY_HELD"); }
    if (attempt.state !== "ALLOCATED") fail("DSS03_ATTEMPT_NOT_ALLOCATED");
    const lease = { leaseRef, attemptRef: attempt.attemptRef, cellRef: attempt.cellRef, capsuleRef: attempt.capsuleRef, daemonGeneration: this.state.generation.generationRef, fencingToken: attempt.fencingToken, leaseRevision: 1, state: "ACTIVE", leaseEventDigest: null, operationInputDigest: inputDigest, acquiredAt: this.clock(), expiresAt: new Date(new Date(this.clock()).getTime() + ttlMs).toISOString() };
    this.state.leases[leaseRef] = lease; attempt.leaseRef = leaseRef;
    const leaseEvent = this._saveEvent("attempt_lease_acquired", { leaseRef, attemptRef: attempt.attemptRef, fencingToken: lease.fencingToken }); lease.leaseEventDigest = leaseEvent.eventDigest; this._persist();
    return result(null, "ACTIVE", { lease });
  }

  startFakeAttempt(input = {}) {
    this._requireReady(); object(input, "DSS03_START_INPUT_INVALID");
    const attempt = this.state.attempts[id(input.attemptRef, "attemptRef")]; if (!attempt) fail("DSS03_ATTEMPT_UNKNOWN");
    const lease = this._validateLease(input, attempt, { operation: "startFakeAttempt" });
    this._assertPlanPolicyFrozen(this._plan(attempt.planRef));
    const inputDigest = operationDigest("startFakeAttempt", { attemptRef: attempt.attemptRef, leaseRef: lease.leaseRef, leaseRevision: lease.leaseRevision, fencingToken: lease.fencingToken });
    if (attempt.state === "STARTED") { if (attempt.startInputDigest !== inputDigest) fail("DSS03_REPLAY_INPUT_CONFLICT", "startFakeAttempt"); return result(null, "EXACT_REPLAY", { attempt, observation: this.state.observations[attempt.observationRef] }); }
    if (attempt.state !== "ALLOCATED") fail("DSS03_ATTEMPT_NOT_STARTABLE");
    const capsule = this.state.capsules[attempt.capsuleRef]; const fixture = this._fixture(); const scenario = fixture.scenarios[capsule.scenarioRef]; if (!scenario) fail("DSS03_SCENARIO_UNDECLARED", capsule.scenarioRef);
    const facts = scenario.runtimeFacts; const processRef = facts.processRef || `fake-process:${attempt.attemptRef}`; const observation = { observationRef: randomRef("runtime-observation"), attemptRef: attempt.attemptRef, capsuleRef: capsule.capsuleRef, runtimeRevision: fixture.runtime.runtimeRevision, processRef, startedAt: this.clock(), terminalKind: scenario.runtimeTerminal, terminalAt: null, streamClosureDigest: digestObject("Dss03.StreamClosure.v1", { reaped: facts.reaped, streamsClosed: facts.streamsClosed, bufferedByteCount: facts.bufferedBytes }), bufferedByteCount: facts.bufferedBytes, isolation: { network: false, model: false, credentials: false }, elapsedFakeTime: scenario.elapsedFakeTime, scenarioRef: capsule.scenarioRef };
    this.state.observations[observation.observationRef] = observation; attempt.observationRef = observation.observationRef; attempt.runtimeProcessRef = processRef; attempt.startInputDigest = inputDigest; attempt.state = "STARTED"; attempt.startedAt = observation.startedAt;
    const startEvent = this._saveEvent("fake_attempt_started", { attemptRef: attempt.attemptRef, observationRef: observation.observationRef, runtimeRevision: observation.runtimeRevision, processRef }); observation.startEventDigest = startEvent.eventDigest; this._persist();
    return result(null, "STARTED", { attempt, observation });
  }

  recordRuntimeTerminal(input = {}) {
    this._requireReady(); object(input, "DSS03_TERMINAL_INPUT_INVALID");
    const attempt = this.state.attempts[id(input.attemptRef, "attemptRef")]; if (!attempt) fail("DSS03_ATTEMPT_UNKNOWN");
    const lease = this._validateLease(input, attempt, { operation: "recordRuntimeTerminal" });
    const capsule = this.state.capsules[attempt.capsuleRef]; const scenario = this._fixture().scenarios[capsule.scenarioRef]; if (!scenario) fail("DSS03_SCENARIO_UNDECLARED", capsule.scenarioRef); if (input.terminalKind !== undefined && input.terminalKind !== scenario.runtimeTerminal) fail("DSS03_RUNTIME_OBSERVATION_OVERRIDE"); if (input.failureClass !== undefined && input.failureClass !== scenario.failureClass) fail("DSS03_RUNTIME_OBSERVATION_OVERRIDE");
    const requestedTerminal = input.terminalKind || this.state.observations[attempt.observationRef]?.terminalKind || scenario.runtimeTerminal || null;
    const requestedFailure = input.failureClass || scenario.failureClass || null;
    const inputDigest = operationDigest("recordRuntimeTerminal", { attemptRef: attempt.attemptRef, leaseRef: lease.leaseRef, leaseRevision: lease.leaseRevision, fencingToken: lease.fencingToken, terminalKind: requestedTerminal, failureClass: requestedFailure });
    if (["RAW_READY", "RAW_CAPTURED", "RESULT_ADMITTED", "RETRYABLE_FAILURE", "TERMINAL_FAILURE", "CANCEL_ACKNOWLEDGED", "INTERRUPTED_UNKNOWN"].includes(attempt.state)) { if (attempt.terminalInputDigest !== inputDigest) fail("DSS03_REPLAY_INPUT_CONFLICT", "recordRuntimeTerminal"); return result(null, "EXACT_REPLAY", { attempt }); }
    if (attempt.state !== "STARTED") fail("DSS03_ATTEMPT_NOT_STARTED");
    const observation = this.state.observations[attempt.observationRef];
    const terminalKind = scenario.runtimeTerminal;
    const failureClass = scenario.failureClass;
    const event = this._event("runtime_terminal_observed", { attemptRef: attempt.attemptRef, terminalKind, failureClass: failureClass || null, processRef: observation.processRef }); observation.terminalAt = this.clock(); observation.terminalEventDigest = event.eventDigest; observation.terminalKind = terminalKind;
    attempt.terminalInputDigest = operationDigest("recordRuntimeTerminal", { attemptRef: attempt.attemptRef, leaseRef: lease.leaseRef, leaseRevision: lease.leaseRevision, fencingToken: lease.fencingToken, terminalKind, failureClass: failureClass || null });
    if (terminalKind === "LOST_CONTACT" || terminalKind === "INTERRUPTED_UNKNOWN") { attempt.state = "INTERRUPTED_UNKNOWN"; attempt.terminalAt = observation.terminalAt; observation.terminalKind = "INTERRUPTED_UNKNOWN"; this._persist(); return result(null, "INTERRUPTED_UNKNOWN", { attempt, observation }); }
    if (terminalKind === "CANCEL_ACKNOWLEDGED") { attempt.state = "CANCEL_ACKNOWLEDGED"; attempt.terminalAt = observation.terminalAt; observation.terminalKind = terminalKind; this._persist(); return result(null, "CANCEL_ACKNOWLEDGED", { attempt, observation }); }
    const plan = this._plan(attempt.planRef);
    if (["RETRYABLE_FAILURE", "TIMEOUT", "FAILURE"].includes(terminalKind) && failureClass && plan.attemptPolicy.retryableFailureClasses.includes(failureClass)) {
      if (attempt.attemptOrdinal >= plan.attemptPolicy.maximumAttemptsPerReplicateSlot) { attempt.state = "TERMINAL_FAILURE"; attempt.failureClass = failureClass; attempt.terminalAt = this.clock(); const cell = this._cell(attempt.cellRef); cell.state = "TERMINAL_FAILURE"; cell.terminalClass = "TERMINAL_FAILURE"; cell.terminalWitness = this._witness(cell, "TERMINAL_FAILURE", attempt.attemptRef, event.eventDigest); this._persist(); return result(null, "TERMINAL_FAILURE", { attempt, cell: this._publicCell(cell), observation }); }
      attempt.state = "RETRYABLE_FAILURE"; attempt.failureClass = failureClass; attempt.causalFailureRef = event.eventDigest; attempt.terminalAt = observation.terminalAt; this._persist(); return result(null, "RETRYABLE_FAILURE", { attempt, observation });
    }
    if (terminalKind !== "EXIT" || failureClass) {
      attempt.state = "TERMINAL_FAILURE"; attempt.failureClass = failureClass || "non_retryable_runtime_failure"; attempt.causalFailureRef = event.eventDigest; attempt.terminalAt = observation.terminalAt; const cell = this._cell(attempt.cellRef); cell.state = "TERMINAL_FAILURE"; cell.terminalClass = "TERMINAL_FAILURE"; cell.terminalWitness = this._witness(cell, "TERMINAL_FAILURE", attempt.attemptRef, event.eventDigest); this._persist(); return result(null, "TERMINAL_FAILURE", { attempt, cell: this._publicCell(cell), observation });
    }
    attempt.state = "RAW_READY"; attempt.terminalAt = observation.terminalAt; observation.terminalKind = "EXIT"; attempt.scenarioRef = capsule.scenarioRef; this._persist();
    return result(null, "RAW_READY", { attempt, observation });
  }

  requestPrestartCancellation(input = {}) {
    this._requireReady(); object(input, "DSS03_CANCEL_INPUT_INVALID");
    const jobRef = id(input.jobRef, "jobRef");
    this._assertAuthorization(input.authorizationReceipt, "cancel", jobRef);
    const plan = this._plan(id(input.planRef, "planRef")); const cell = this._cell(id(input.cellRef, "cellRef"));
    if (plan.jobRef !== jobRef || cell.planRef !== plan.planRef) fail("DSS03_CANCEL_SCOPE");
    const authorizationDigest = input.authorizationReceipt.authorizationDigest || digestObject("DirectSemanticService.Dss03Authorization.v1", Object.fromEntries(Object.entries(input.authorizationReceipt).filter(([key]) => key !== "authorizationDigest")));
    const inputDigest = operationDigest("requestPrestartCancellation", { jobRef, planRef: plan.planRef, cellRef: cell.cellRef, authorizationDigest });
    const existingEvent = this.state.events.find((event) => event.type === "prestart_cancellation_authorized" && event.payload?.jobRef === jobRef && event.payload?.planRef === plan.planRef && event.payload?.cellRef === cell.cellRef);
    if (existingEvent) {
      if (existingEvent.payload.operationInputDigest !== inputDigest) fail("DSS03_REPLAY_INPUT_CONFLICT", "requestPrestartCancellation");
      return result(null, "EXACT_REPLAY", { cell: this._publicCell(cell), witness: cell.terminalWitness, eventDigest: existingEvent.eventDigest });
    }
    if (Object.values(this.state.attempts).some((attempt) => attempt.cellRef === cell.cellRef && ["ALLOCATED", "STARTED", "RETRYABLE_FAILURE", "RAW_READY", "RAW_CAPTURED", "RESULT_ADMITTED", "CANCEL_ACKNOWLEDGED", "INTERRUPTED_UNKNOWN"].includes(attempt.state))) fail("DSS03_PRESTART_CANCEL_ATTEMPT_EXISTS");
    if (cell.state !== "OPEN") fail("DSS03_CELL_NOT_OPEN");
    cell.state = "AUTHORIZED_CANCELLATION"; cell.terminalClass = "AUTHORIZED_CANCELLATION"; const event = this._event("prestart_cancellation_authorized", { jobRef, planRef: plan.planRef, cellRef: cell.cellRef, operationInputDigest: inputDigest, result: "PRESTART_CANCELLED" }); cell.terminalWitness = this._witness(cell, "AUTHORIZED_CANCELLATION", input.authorizationReceipt.receiptRef || input.authorizationReceipt.authorizationDigest || "dss02-authorization", event.eventDigest); this._persist();
    return result(null, "PRESTART_CANCELLED", { cell: this._publicCell(cell), witness: cell.terminalWitness, eventDigest: event.eventDigest });
  }

  _assertAuthorization(receipt, operation, jobRef) {
    if (!receipt || receipt.decision !== "AUTHORIZED" || receipt.operation !== operation) fail("DSS03_AUTHORIZATION_REQUIRED");
    if (!this.predecessorBoundary || typeof this.predecessorBoundary.verifyAuthorization !== "function") fail("DSS03_PREDECESSOR_BOUNDARY_REQUIRED");
    let authoritative;
    try { authoritative = this.predecessorBoundary.verifyAuthorization(receipt, { operation, jobRef }); } catch (_) { fail("DSS03_INHERITED_AUTHORIZATION_INVALID"); }
    if (!authoritative || authoritative.decision !== "AUTHORIZED" || authoritative.operation !== operation) fail("DSS03_INHERITED_AUTHORIZATION_INVALID");
    const handoff = this._job(jobRef); if (receipt.principalRef && this.dss02?.store) { const job = this.dss02.store.get("SELECT principal_ref FROM jobs WHERE job_ref=?", jobRef); if (job && job.principal_ref !== receipt.principalRef) fail("DSS03_AUTHORIZATION_SCOPE"); }
    if (handoff.dss03Generation !== this.state.generation.generationRef) fail("DSS03_AUTHORIZATION_GENERATION_STALE");
  }

  requestRunningCancellation(input = {}) {
    this._requireReady(); object(input, "DSS03_RUNNING_CANCEL_INPUT_INVALID");
    this._assertAuthorization(input.authorizationReceipt, "cancel", input.jobRef);
    const attempt = this.state.attempts[id(input.attemptRef, "attemptRef")]; if (!attempt) fail("DSS03_ATTEMPT_UNKNOWN");
    if (this._plan(attempt.planRef).jobRef !== id(input.jobRef, "jobRef")) fail("DSS03_CANCEL_SCOPE");
    if (attempt.state !== "STARTED") fail("DSS03_RUNNING_CANCEL_NOT_RUNNING");
    const lease = this._validateLease(input, attempt, { operation: "requestRunningCancellation" });
    const authorizationDigest = input.authorizationReceipt.authorizationDigest || digestObject("DirectSemanticService.Dss03Authorization.v1", Object.fromEntries(Object.entries(input.authorizationReceipt).filter(([key]) => key !== "authorizationDigest")));
    const inputDigest = operationDigest("requestRunningCancellation", { jobRef: id(input.jobRef, "jobRef"), attemptRef: attempt.attemptRef, leaseRef: lease.leaseRef, leaseRevision: lease.leaseRevision, fencingToken: lease.fencingToken, authorizationDigest });
    const existing = Object.values(this.state.observations).find((observation) => observation.cancellationRef && observation.attemptRef === attempt.attemptRef);
    if (existing) { if (existing.operationInputDigest !== inputDigest) fail("DSS03_REPLAY_INPUT_CONFLICT", "requestRunningCancellation"); return result(null, "EXACT_REPLAY", { cancellation: existing }); }
    const cancellation = { cancellationRef: randomRef("running-cancellation"), jobRef: id(input.jobRef, "jobRef"), attemptRef: attempt.attemptRef, leaseRef: lease.leaseRef, leaseRevision: lease.leaseRevision, fencingToken: lease.fencingToken, authorizationReceiptDigest: authorizationDigest, attemptEventHead: this.state.globalHead, signalEventDigest: null, operationInputDigest: inputDigest, state: "SIGNAL_REQUESTED", requestedAt: this.clock(), acknowledgedAt: null };
    this.state.observations[cancellation.cancellationRef] = cancellation;
    const signalEvent = this._saveEvent("running_cancellation_requested", { cancellationRef: cancellation.cancellationRef, attemptRef: attempt.attemptRef }); cancellation.signalEventDigest = signalEvent.eventDigest; cancellation.attemptEventHead = signalEvent.eventDigest; this._persist();
    return result(null, "SIGNAL_REQUESTED", { cancellation });
  }

  adjudicateCancellationRace(input = {}) {
    this._requireReady(); object(input, "DSS03_CANCEL_RACE_INPUT_INVALID");
    const cancellation = this.state.observations[id(input.cancellationRef, "cancellationRef")]; if (!cancellation) fail("DSS03_CANCELLATION_UNKNOWN");
    const attempt = this.state.attempts[cancellation.attemptRef]; if (!attempt) fail("DSS03_ATTEMPT_UNKNOWN");
    const lease = this._validateLease(input, attempt, { operation: "adjudicateCancellationRace" });
    const cell = this._cell(attempt.cellRef); const observation = this.state.observations[attempt.observationRef];
    this._assertAuthorization(input.authorizationReceipt, "cancel", cancellation.jobRef);
    const scenario = this._fixture().scenarios[this.state.capsules[attempt.capsuleRef].scenarioRef]; if (!scenario) fail("DSS03_SCENARIO_UNDECLARED"); const facts = scenario.runtimeFacts;
    for (const [field, expected] of [["acknowledged", facts.acknowledged], ["contactLost", facts.contactLost], ["reaped", facts.reaped], ["streamsClosed", facts.streamsClosed]]) if (input[field] !== undefined && input[field] !== expected) fail("DSS03_RUNTIME_OBSERVATION_OVERRIDE", field);
    if (input.bufferedBytes !== undefined && Number(input.bufferedBytes) !== facts.bufferedBytes) fail("DSS03_RUNTIME_OBSERVATION_OVERRIDE", "bufferedBytes");
    const authorizationDigest = input.authorizationReceipt.authorizationDigest || digestObject("DirectSemanticService.Dss03Authorization.v1", Object.fromEntries(Object.entries(input.authorizationReceipt).filter(([key]) => key !== "authorizationDigest")));
    const requestEvent = this.state.events.find((event) => event.type === "running_cancellation_requested" && event.payload.cancellationRef === cancellation.cancellationRef); const earlierTerminal = this.state.events.some((event) => event.type === "runtime_terminal_observed" && event.payload.attemptRef === attempt.attemptRef && requestEvent && event.sequence < requestEvent.sequence); if (input.earlierTerminal !== undefined && input.earlierTerminal !== earlierTerminal) fail("DSS03_RUNTIME_OBSERVATION_OVERRIDE", "earlierTerminal");
    const proof = { reaped: facts.reaped, streamsClosed: facts.streamsClosed, bufferedBytes: facts.bufferedBytes, earlierTerminal };
    const inputDigest = operationDigest("adjudicateCancellationRace", { cancellationRef: cancellation.cancellationRef, leaseRef: lease.leaseRef, leaseRevision: lease.leaseRevision, fencingToken: lease.fencingToken, acknowledged: facts.acknowledged, contactLost: facts.contactLost, authorizationDigest, proof });
    if (cancellation.adjudicationInputDigest) { if (cancellation.adjudicationInputDigest !== inputDigest) fail("DSS03_REPLAY_INPUT_CONFLICT", "adjudicateCancellationRace"); return result(null, cancellation.adjudicationOutcome, { cancellation, attempt, cell: cancellation.state === "ACKNOWLEDGED" ? this._publicCell(cell) : undefined }); }
    if (cancellation.state !== "SIGNAL_REQUESTED") fail("DSS03_CANCELLATION_UNKNOWN");
    if (["RAW_READY", "RAW_CAPTURED", "RESULT_ADMITTED", "TERMINAL_FAILURE"].includes(attempt.state)) { cancellation.adjudicationInputDigest = inputDigest; cancellation.adjudicationOutcome = "RAW_OR_TERMINAL_WON"; this._event("running_cancellation_raw_or_terminal_won", { cancellationRef: cancellation.cancellationRef, attemptRef: attempt.attemptRef }); this._persist(); return result(null, "RAW_OR_TERMINAL_WON", { cancellation, attempt }); }
    if (facts.contactLost) {
      const terminalAt = this.clock();
      cancellation.adjudicationInputDigest = inputDigest; cancellation.adjudicationOutcome = "INTERRUPTED_UNKNOWN"; cancellation.state = "INTERRUPTED_UNKNOWN"; cancellation.terminalAt = terminalAt;
      attempt.state = "INTERRUPTED_UNKNOWN"; attempt.terminalAt = terminalAt;
      if (observation) { observation.terminalAt = terminalAt; observation.terminalKind = "INTERRUPTED_UNKNOWN"; }
      const contactEvent = this._event("running_cancellation_contact_lost", { cancellationRef: cancellation.cancellationRef, attemptRef: attempt.attemptRef, terminalAt });
      attempt.causalFailureRef = contactEvent.eventDigest;
      if (lease.state === "ACTIVE") {
        lease.state = "RELEASED"; lease.releasedAt = terminalAt; lease.disposition = "INTERRUPTED_UNKNOWN";
        const releaseEvent = this._event("attempt_lease_released", { leaseRef: lease.leaseRef, attemptRef: attempt.attemptRef, disposition: lease.disposition, terminalAt });
        lease.releaseEventDigest = releaseEvent.eventDigest;
      }
      if (observation) observation.terminalEventDigest = contactEvent.eventDigest;
      this._persist(); return result(null, "INTERRUPTED_UNKNOWN", { cancellation, attempt });
    }
    if (!facts.acknowledged) return result(null, "REJECTED", { cancellation, attempt });
    if (attempt.state !== "CANCEL_ACKNOWLEDGED") fail("DSS03_CANCEL_ACK_REQUIRED");
    if (!proof.reaped || !proof.streamsClosed || proof.bufferedBytes !== 0 || proof.earlierTerminal) fail("DSS03_CANCEL_REAP_PROOF_REQUIRED");
    cancellation.adjudicationInputDigest = inputDigest; cancellation.adjudicationOutcome = "CANCEL_ACKNOWLEDGED"; cancellation.state = "ACKNOWLEDGED"; cancellation.acknowledgedAt = this.clock(); cell.state = "AUTHORIZED_CANCELLATION"; cell.terminalClass = "AUTHORIZED_CANCELLATION"; const event = this._event("running_cancellation_won", { cancellationRef: cancellation.cancellationRef, attemptRef: attempt.attemptRef }); cell.terminalWitness = this._witness(cell, "AUTHORIZED_CANCELLATION", cancellation.cancellationRef, event.eventDigest); if (observation) observation.cancelled = true; this._persist();
    return result(null, "CANCEL_ACKNOWLEDGED", { cancellation, attempt, cell: this._publicCell(cell), eventDigest: event.eventDigest });
  }

  captureRawResultToQuarantine(input = {}) {
    this._requireReady(); object(input, "DSS03_CAPTURE_INPUT_INVALID");
    const attempt = this.state.attempts[id(input.attemptRef, "attemptRef")]; if (!attempt) fail("DSS03_ATTEMPT_UNKNOWN");
    const lease = this._validateLease(input, attempt, { operation: "captureRawResultToQuarantine" });
    const inputDigest = operationDigest("captureRawResultToQuarantine", { attemptRef: attempt.attemptRef, leaseRef: lease.leaseRef, leaseRevision: lease.leaseRevision, fencingToken: lease.fencingToken });
    if (attempt.state === "RAW_CAPTURED") { const raw = this.state.raw[attempt.rawRef]; if (!raw || raw.operationInputDigest !== inputDigest) fail("DSS03_REPLAY_INPUT_CONFLICT", "captureRawResultToQuarantine"); return result(null, "EXACT_REPLAY", { raw }); }
    if (attempt.state !== "RAW_READY") { if (attempt.state === "INTERRUPTED_UNKNOWN") return result(null, "INTERRUPTED_UNKNOWN", { attempt }); fail("DSS03_RAW_NOT_READY"); }
    const capsule = this.state.capsules[attempt.capsuleRef]; const scenario = this._fixture().scenarios[capsule.scenarioRef]; if (!scenario) fail("DSS03_SCENARIO_UNDECLARED", capsule.scenarioRef); const fixtureBytes = this.fixtureRawBytes.get(capsule.scenarioRef); const bytes = fixtureBytes ? Buffer.from(fixtureBytes) : Buffer.from(canonicalJson({ ...scenario.rawResult, capsuleRef: capsule.capsuleRef, attemptRef: attempt.attemptRef, cellRef: attempt.cellRef, edgeRef: capsule.edgeRef, materializationRef: capsule.materializationRef, kernelRef: capsule.kernelRef }), "utf8");
    const limit = this._policy().outputByteLimit;
    const rawRef = randomRef("raw-result"); let quarantineRef; let relativePath;
    if (this.dss02?.quarantine && typeof this.dss02.quarantine.capture === "function") { const quarantined = this.dss02.quarantine.capture(bytes); quarantineRef = quarantined.quarantineRef; relativePath = quarantined.relativePath || `quarantine/${quarantineRef}.bin`; }
    else { quarantineRef = randomRef("quarantine"); relativePath = this.profileRoot ? `quarantine/${quarantineRef}.bin` : null; if (this.profileRoot) { const filePath = path.join(path.resolve(this.profileRoot), relativePath); ensureDirectory(path.dirname(filePath)); atomicWrite(filePath, bytes); } else this.memoryQuarantine.set(quarantineRef, Buffer.from(bytes)); }
    const observation = this.state.observations[attempt.observationRef]; const rawDigest = digestBytes("DirectSemanticService.RawResult.v1", bytes); const raw = { rawRef, rawResultRef: rawRef, quarantineRef, attemptRef: attempt.attemptRef, capsuleRef: capsule.capsuleRef, cellRef: attempt.cellRef, processRef: observation?.processRef || attempt.runtimeProcessRef, terminalKind: observation?.terminalKind || null, byteLength: bytes.length, byteCount: bytes.length, digest: rawDigest, retentionPolicy: "DSS03_PRIVATE_QUARANTINE", custodyTag: digestObject("Dss03.RawCustody.v1", { quarantineRef, rawDigest, byteCount: bytes.length, retentionPolicy: "DSS03_PRIVATE_QUARANTINE" }), relativePath, operationInputDigest: inputDigest, state: "QUARANTINED", capturedAt: this.clock() };
    this.state.raw[rawRef] = raw; attempt.rawRef = rawRef; attempt.state = "RAW_CAPTURED"; this._saveEvent("raw_result_captured", { rawRef, quarantineRef, attemptRef: attempt.attemptRef, byteLength: bytes.length, digest: raw.digest });
    if (bytes.length > limit) return this._rawStructuralFailure(attempt, "DSS03_RAW_OUTPUT_OVERSIZED", raw);
    return result(null, "CAPTURED", { raw: this._publicRaw(raw) });
  }

  _publicRaw(raw) { const output = clone(raw); delete output.payloadBase64; return output; }

  _rawStructuralFailure(attempt, code, raw = undefined) {
    if (raw) { raw.state = "REJECTED"; raw.diagnosticCode = code; }
    const plan = this._plan(attempt.planRef);
    const event = this._event("raw_structural_rejection", { attemptRef: attempt.attemptRef, rawRef: raw?.rawRef || null, code });
    if (plan.attemptPolicy.retryableFailureClasses.includes("raw_result_structural_rejection")) {
      attempt.state = "RETRYABLE_FAILURE"; attempt.failureClass = "raw_result_structural_rejection"; attempt.terminalAt = this.clock();
    } else {
      attempt.state = "TERMINAL_FAILURE"; attempt.failureClass = "raw_result_structural_rejection"; attempt.terminalAt = this.clock(); const cell = this._cell(attempt.cellRef); cell.state = "TERMINAL_FAILURE"; cell.terminalClass = "TERMINAL_FAILURE"; cell.terminalWitness = this._witness(cell, "TERMINAL_FAILURE", attempt.attemptRef, event.eventDigest);
    }
    this._persist(); fail(code);
  }

  _casPath(digestValue) {
    digest(digestValue, "casDigest");
    if (this.dss02?.cas && typeof this.dss02.cas.pathForDigest === "function") return this.dss02.cas.pathForDigest(digestValue);
    if (!this.profileRoot) return null;
    return path.join(path.resolve(this.profileRoot), "dss03-cas", `${digestValue.slice(7)}.json`);
  }

  _publishCanonical(kind, objectRef, value, context = {}) {
    const bytes = Buffer.from(canonicalJson(value), "utf8");
    const artifactDigest = canonicalArtifactDigest(bytes);
    const artifactRef = `dss03-cas-${artifactDigest.slice(7)}`;
    const existing = this.state.cas[artifactRef];
    if (existing && (existing.digest !== artifactDigest || existing.objectRef !== objectRef || existing.kind !== kind)) fail("DSS03_CAS_REFERENCE_CONFLICT", objectRef);
    const target = this._casPath(artifactDigest);
    if (target) {
      ensureDirectory(path.dirname(target));
      if (this.dss02?.cas && typeof this.dss02.cas.publish === "function") this.dss02.cas.publish(bytes, { digest: artifactDigest, kind: `dss03-${kind}`, artifactRef });
      if (fs.existsSync(target)) {
        const stat = fs.lstatSync(target);
        if (stat.isSymbolicLink() || !stat.isFile()) fail("DSS03_CAS_NOT_REGULAR", objectRef);
        if (canonicalArtifactDigest(fs.readFileSync(target)) !== artifactDigest) fail("DSS03_CAS_DIGEST_MISMATCH", objectRef);
      } else atomicWrite(target, bytes);
    }
    const descriptor = existing || { schema: "direct_semantic_dss03_cas_artifact@1", artifactRef, objectRef, kind, digest: artifactDigest, relativePath: target && this.profileRoot ? path.relative(path.resolve(this.profileRoot), target) : (target ? path.basename(target) : null), byteLength: bytes.length, payloadBase64: target ? null : bytes.toString("base64"), state: "PUBLISHED", planRef: context.planRef || null, jobRef: context.jobRef || null, createdAt: this.clock(), referenceCount: 0 };
    this.state.cas[artifactRef] = descriptor;
    return descriptor;
  }

  _verifyCasArtifact(descriptor) {
    if (!descriptor || !descriptor.digest || !descriptor.artifactRef) fail("DSS03_CAS_REFERENCE_UNKNOWN");
    let bytes;
    const target = this._casPath(descriptor.digest);
    if (target) {
      let stat;
      try { stat = fs.lstatSync(target); } catch (_) { fail("DSS03_CAS_MISSING", descriptor.objectRef); }
      if (stat.isSymbolicLink() || !stat.isFile() || (!this.dss02?.cas && path.resolve(target) !== path.join(path.resolve(this.profileRoot), descriptor.relativePath))) fail("DSS03_CAS_CUSTODY_INVALID", descriptor.objectRef);
      bytes = fs.readFileSync(target);
    } else if (descriptor.payloadBase64) bytes = Buffer.from(descriptor.payloadBase64, "base64");
    else fail("DSS03_CAS_MISSING", descriptor.objectRef);
    if (bytes.length !== descriptor.byteLength || canonicalArtifactDigest(bytes) !== descriptor.digest) fail("DSS03_CAS_DIGEST_MISMATCH", descriptor.objectRef);
    return parseJsonStrict(bytes);
  }

  _verifyRawCustody(raw) {
    if (!raw) fail("DSS03_RAW_UNKNOWN");
    if ((this.profileRoot || this.dss02?.quarantine) && raw.payloadBase64) fail("DSS03_RAW_BYTES_IN_ORDINARY_STATE", raw.rawRef);
    let bytes;
    if (this.dss02?.quarantine && typeof this.dss02.quarantine.readInternal === "function") {
      try { bytes = this.dss02.quarantine.readInternal(raw.quarantineRef); } catch (_) { fail("DSS03_RAW_CUSTODY_INVALID", raw.rawRef); }
    } else if (this.profileRoot) {
      const root = path.resolve(this.profileRoot);
      const target = path.join(root, raw.relativePath);
      if (path.resolve(target) !== target || !target.startsWith(`${root}${path.sep}`)) fail("DSS03_RAW_PATH_INVALID");
      let stat; try { stat = fs.lstatSync(target); } catch (_) { fail("DSS03_RAW_MISSING", raw.rawRef); }
      if (stat.isSymbolicLink() || !stat.isFile()) fail("DSS03_RAW_CUSTODY_INVALID", raw.rawRef);
      bytes = fs.readFileSync(target);
    } else if (this.memoryQuarantine.has(raw.quarantineRef)) bytes = this.memoryQuarantine.get(raw.quarantineRef);
    else fail("DSS03_RAW_MISSING", raw.rawRef);
    if (bytes.length !== raw.byteLength || digestBytes("DirectSemanticService.RawResult.v1", bytes) !== raw.digest) fail("DSS03_RAW_DIGEST_MISMATCH", raw.rawRef);
    return bytes;
  }

  admitMicroresult(input = {}) {
    this._requireReady(); object(input, "DSS03_ADMISSION_INPUT_INVALID");
    const attempt = this.state.attempts[id(input.attemptRef, "attemptRef")]; if (!attempt) fail("DSS03_ATTEMPT_UNKNOWN");
    const lease = this._validateLease(input, attempt, { operation: "admitMicroresult" });
    const raw = this.state.raw[attempt.rawRef]; if (!raw) fail("DSS03_RAW_UNKNOWN");
    const inputDigest = operationDigest("admitMicroresult", { attemptRef: attempt.attemptRef, leaseRef: lease.leaseRef, leaseRevision: lease.leaseRevision, fencingToken: lease.fencingToken, rawRef: raw.rawRef });
    if (this.state.admissions[raw.rawRef]) { if (this.state.admissions[raw.rawRef].operationInputDigest !== inputDigest) fail("DSS03_REPLAY_INPUT_CONFLICT", "admitMicroresult"); return result(null, "EXACT_REPLAY", { admission: this.state.admissions[raw.rawRef], microresult: this.state.microresults[this.state.admissions[raw.rawRef].microresultRef] || null }); }
    const capsule = this.state.capsules[attempt.capsuleRef]; const scenario = this._fixture().scenarios[capsule.scenarioRef]; if (!scenario) fail("DSS03_SCENARIO_UNDECLARED", capsule.scenarioRef);
    let bytes;
    try { bytes = this._verifyRawCustody(raw); } catch (error) { return this._rawStructuralFailure(attempt, error.code || "DSS03_RAW_DIGEST_MISMATCH", raw); }
    let microresult;
    try { microresult = parseJsonStrict(bytes, { maximumBytes: this._policy().outputByteLimit }); } catch (_) { return this._rawStructuralFailure(attempt, "DSS03_RAW_JSON_REJECTED", raw); }
    const allowedRawKeys = new Set(["schema", "resultStatus", "claims", "evidenceRefs", "authorityEffect", "pageFaultCandidate", "novelEdgeCandidate", "capsuleRef", "attemptRef", "cellRef", "edgeRef", "materializationRef", "kernelRef"]);
    if (!microresult || typeof microresult !== "object" || Object.keys(microresult).some((key) => !allowedRawKeys.has(key)) || microresult.schema !== "direct_semantic_microresult@1" || !RESULT_STATUSES.has(microresult.resultStatus) || microresult.authorityEffect !== "none" || !Array.isArray(microresult.evidenceRefs) || !microresult.claims || typeof microresult.claims !== "object") {
      return this._rawStructuralFailure(attempt, "DSS03_RAW_SCHEMA_REJECTED", raw);
    }
    const bindings = { capsuleRef: capsule.capsuleRef, attemptRef: attempt.attemptRef, cellRef: attempt.cellRef, edgeRef: capsule.edgeRef, materializationRef: capsule.materializationRef, kernelRef: capsule.kernelRef };
    for (const [key, expected] of Object.entries(bindings)) if (microresult[key] !== undefined && microresult[key] !== expected) { return this._rawStructuralFailure(attempt, "DSS03_RAW_BINDING_REJECTED", raw); }
    delete microresult.capsuleRef; delete microresult.attemptRef; delete microresult.cellRef; delete microresult.edgeRef; delete microresult.materializationRef; delete microresult.kernelRef;
    const candidate = { ...microresult, ...bindings, microresultRef: randomRef("microresult"), kernelRef: capsule.kernelRef, materializationDigest: capsule.materializationDigest, claimsDigest: digestObject("Dss03.Claims.v1", microresult.claims), evidenceRefsDigest: digestList(microresult.evidenceRefs, "Dss03.EvidenceRefs.v1"), lineage: scenario.lineage, authorityEffect: "none", admittedAt: this.clock() };
    this.state.microresults[candidate.microresultRef] = candidate; raw.state = "ADMITTED";
    const admission = { admissionRef: randomRef("microresult-admission"), rawRef: raw.rawRef, rawDigest: raw.digest, microresultRef: candidate.microresultRef, attemptRef: attempt.attemptRef, structuralReceiptsDigest: digestObject("Dss03.StructuralReceipts.v1", { schema: microresult.schema, resultStatus: microresult.resultStatus, claims: microresult.claims, evidenceRefs: microresult.evidenceRefs }), bindingReceiptsDigest: digestObject("Dss03.BindingReceipts.v1", bindings), rejectionCodesDigest: digestList([], "Dss03.RejectionCodes.v1"), operationInputDigest: inputDigest, state: "ADMITTED", subtype: "ADMITTED_NO_CANDIDATE", admittedAt: this.clock() };
    const candidateRefs = [];
    const pageFaultCandidate = microresult.pageFaultCandidate;
    const novelEdgeCandidate = microresult.novelEdgeCandidate;
    delete microresult.pageFaultCandidate; delete microresult.novelEdgeCandidate;
    if (pageFaultCandidate) { const ref = id(pageFaultCandidate.candidateRef, "candidateRef"); if (this.state.candidates[ref]) fail("DSS03_DUPLICATE_CANDIDATE_REF"); const rationale = clone(pageFaultCandidate); delete rationale.candidateRef; this.state.candidates[ref] = { candidateRef: ref, candidateKind: "EVIDENCE_PAGE_FAULT", attemptRef: attempt.attemptRef, materializationRef: capsule.materializationRef, rationale, rationaleDigest: digestObject("Dss03.CandidateRationale.v1", rationale), authorityEffect: "none", state: "RECORDED" }; candidateRefs.push(ref); }
    if (novelEdgeCandidate) { const ref = id(novelEdgeCandidate.candidateRef, "candidateRef"); if (this.state.candidates[ref]) fail("DSS03_DUPLICATE_CANDIDATE_REF"); const boundedReport = clone(novelEdgeCandidate); delete boundedReport.candidateRef; this.state.candidates[ref] = { candidateRef: ref, candidateKind: "NOVEL_EDGE", attemptRef: attempt.attemptRef, edgeRef: capsule.edgeRef, boundedReport, boundedReportDigest: digestObject("Dss03.BoundedReport.v1", boundedReport), authorityEffect: "none", state: "RECORDED" }; candidateRefs.push(ref); }
    if (candidateRefs.length) admission.subtype = candidateRefs.length === 2 ? "ADMITTED_BOTH_CANDIDATES" : (Boolean(pageFaultCandidate) ? "ADMITTED_PAGE_FAULT_CANDIDATE" : "ADMITTED_NOVEL_EDGE_CANDIDATE");
    admission.candidateRefs = candidateRefs; this.state.admissions[raw.rawRef] = admission; attempt.state = "RESULT_ADMITTED"; this._saveEvent("microresult_admitted", { admissionRef: admission.admissionRef, microresultRef: candidate.microresultRef, subtype: admission.subtype });
    return result(null, admission.subtype, { admission, microresult: candidate, candidateRefs });
  }

  assessResultIndependence(input = {}) {
    this._requireReady(); object(input, "DSS03_INDEPENDENCE_INPUT_INVALID");
    const refs = unique(input.microresultRefs || [], "microresultRefs").map((ref) => id(ref, "microresultRef")); if (refs.length < 2) fail("DSS03_INDEPENDENCE_CARDINALITY");
    const results = refs.map((ref) => this.state.microresults[ref]).map((value) => { if (!value) fail("DSS03_MICRORESULT_UNKNOWN"); return value; });
    const dimensions = [...LINEAGE_DIMENSIONS];
    if (input.requiredDimensions !== undefined) {
      const supplied = unique(input.requiredDimensions, "requiredDimensions");
      if (supplied.length !== dimensions.length || supplied.some((dimension, index) => dimension !== dimensions[index])) fail("DSS03_LINEAGE_POLICY_WIDENING");
    }
    const observed = Object.fromEntries(dimensions.map((dimension) => [dimension, results.map((item) => item.lineage?.[dimension] || null)]));
    const shared = dimensions.filter((dimension) => new Set(observed[dimension]).size < results.length);
    const assessmentRef = id(input.assessmentRef || randomRef("independence"), "assessmentRef");
    const inputDigest = operationDigest("assessResultIndependence", { assessmentRef, microresultRefs: refs, requiredDimensions: dimensions });
    const assessment = { assessmentRef, microresultRefs: refs, requiredDimensions: dimensions, requiredDimensionsDigest: digestList(dimensions, "Dss03.RequiredDimensions.v1"), comparedResultsDigest: digestList(refs, "Dss03.ComparedResults.v1"), observedDimensions: observed, observedDimensionsDigest: digestObject("Dss03.ObservedDimensions.v1", observed), sharedDimensions: shared, sharedDimensionsDigest: digestList(shared, "Dss03.SharedDimensions.v1"), lineageGraphDigest: digestObject("Dss03.LineageGraph.v1", results.map((item) => ({ microresultRef: item.microresultRef, lineage: item.lineage }))), operationInputDigest: inputDigest, state: shared.length ? "DOES_NOT_SATISFY" : "SATISFIES", assessedAt: this.clock() };
    if (this.state.assessments[assessment.assessmentRef]) { if (this.state.assessments[assessment.assessmentRef].operationInputDigest !== inputDigest) fail("DSS03_REPLAY_INPUT_CONFLICT", "assessResultIndependence"); return result(null, "EXACT_REPLAY", { assessment: this.state.assessments[assessment.assessmentRef] }); }
    this.state.assessments[assessment.assessmentRef] = assessment; this._saveEvent("independence_assessed", { assessmentRef: assessment.assessmentRef, state: assessment.state, sharedDimensions: shared });
    return result(null, assessment.state, { assessment });
  }

  recordAttestation(input = {}) {
    this._requireReady(); object(input, "DSS03_ATTESTATION_INPUT_INVALID");
    const assessment = this.state.assessments[id(input.assessmentRef, "assessmentRef")]; if (!assessment) fail("DSS03_ASSESSMENT_UNKNOWN");
    const microresultRefs = assessment.microresultRefs; const attestationRef = id(input.attestationRef || randomRef("attestation"), "attestationRef");
    const inputDigest = operationDigest("recordAttestation", { assessmentRef: assessment.assessmentRef, attestationRef, microresultRefs });
    if (this.state.attestations[attestationRef]) { if (this.state.attestations[attestationRef].operationInputDigest !== inputDigest) fail("DSS03_REPLAY_INPUT_CONFLICT", "recordAttestation"); return result(null, "EXACT_REPLAY", { attestation: this.state.attestations[attestationRef] }); }
    const attestation = { attestationRef, microresultRefs, microresultPopulationDigest: digestList(microresultRefs, "Dss03.MicroresultPopulation.v1"), class: assessment.state === "SATISFIES" ? "INDEPENDENT" : "SHARED_LINEAGE", independenceRef: assessment.assessmentRef, evidenceDigest: digestObject("Dss03.AttestationEvidence.v1", microresultRefs.map((ref) => this.state.microresults[ref])), verifierRef: this._fixture().policies.evaluationPolicy.evaluationPolicyRef, operationInputDigest: inputDigest, verdict: assessment.state === "SATISFIES" ? "AGREE" : "REMANDED", state: assessment.state === "SATISFIES" ? "RECORDED" : "REMANDED", recordedAt: this.clock() };
    this.state.attestations[attestationRef] = attestation; this._saveEvent("attestation_recorded", { attestationRef, state: attestation.state, verdict: attestation.verdict });
    return result(null, attestation.state, { attestation });
  }

  evaluateExpectedCell(input = {}) {
    this._requireReady(); object(input, "DSS03_EVALUATION_INPUT_INVALID");
    const cell = this._cell(id(input.cellRef, "cellRef")); const plan = this._plan(cell.planRef); const evaluationRef = input.evaluationRef === undefined ? null : id(input.evaluationRef, "evaluationRef"); const inputDigest = operationDigest("evaluateExpectedCell", { cellRef: cell.cellRef, evaluationRef }); if (cell.state === "RESULT_EVALUATED") { const existing = this.state.evaluations[cell.evaluationRef]; if (!existing || (evaluationRef !== null && existing.operationInputDigest !== inputDigest)) fail("DSS03_REPLAY_INPUT_CONFLICT", "evaluateExpectedCell"); return result(null, "EXACT_REPLAY", { evaluation: existing }); }
    if (cell.state !== "OPEN" && cell.state !== "RESULT_ADMITTED") fail("DSS03_CELL_NOT_EVALUABLE");
    const groupCells = plan.expectedCellRefs.filter((ref) => this.state.cells[ref].edgeOccurrenceRef === cell.edgeOccurrenceRef); const attempts = Object.values(this.state.attempts).filter((attempt) => groupCells.includes(attempt.cellRef)); const results = attempts.map((attempt) => this.state.microresults[this.state.admissions[this.state.raw[attempt.rawRef]?.rawRef]?.microresultRef]).filter(Boolean);
    const policy = plan.attemptPolicy;
    // A plan cell is one edge occurrence plus one predeclared replicate slot.
    // Retry ordinals are attempts within that slot, not additional expected
    // cells; one admitted result is therefore sufficient for this cell.
    if (results.length < 1) fail("DSS03_EVALUATION_INCOMPLETE_REPLICATES");
    if (results.some((item) => !RESULT_STATUSES.has(item.resultStatus))) fail("DSS03_EVALUATION_RESULT_INVALID");
    const groupResultRefs = Object.values(this.state.attempts).filter((attempt) => groupCells.includes(attempt.cellRef)).map((attempt) => this.state.admissions[this.state.raw[attempt.rawRef]?.rawRef]?.microresultRef).filter(Boolean).sort();
    const attestations = Object.values(this.state.attestations).filter((attestation) => attestation.state === "RECORDED" && JSON.stringify([...attestation.microresultRefs].sort()) === JSON.stringify(groupResultRefs));
    if (this._fixture().policies.evaluationPolicy.requiredIndependentResults && groupResultRefs.length >= 2 && attestations.length === 0) fail("DSS03_EVALUATION_ATTESTATION_REQUIRED");
    const statuses = results.map((item) => item.resultStatus); let disposition;
    if (statuses.includes("remand")) disposition = "ADVISORY_REMAND";
    else if (statuses.includes("inconclusive") || new Set(statuses).size > 1) disposition = "ADVISORY_INCONCLUSIVE";
    else if (statuses[0] === "support") disposition = "ADVISORY_SUPPORT";
    else disposition = "ADVISORY_REFUTATION";
    const evaluation = { evaluationRef: evaluationRef || randomRef("evaluation"), cellRef: cell.cellRef, attemptRefs: attempts.map((attempt) => attempt.attemptRef), resultRefs: results.map((item) => item.microresultRef), attestationRefs: attestations.map((attestation) => attestation.attestationRef), attemptPopulationDigest: digestList(attempts.map((attempt) => attempt.attemptRef), "Dss03.AttemptPopulation.v1"), resultPopulationDigest: digestList(results.map((item) => item.microresultRef), "Dss03.ResultPopulation.v1"), attestationPopulationDigest: digestList(attestations.map((attestation) => attestation.attestationRef), "Dss03.AttestationPopulation.v1"), dissentDigest: digestObject("Dss03.Dissent.v1", statuses), operationInputDigest: inputDigest, disposition, authorityEffect: "none", evaluatedAt: this.clock() };
    this.state.evaluations[evaluation.evaluationRef] = evaluation; cell.state = "RESULT_EVALUATED"; cell.terminalClass = "RESULT_EVALUATED"; cell.evaluationRef = evaluation.evaluationRef; const event = this._event("expected_cell_evaluated", { cellRef: cell.cellRef, evaluationRef: evaluation.evaluationRef, disposition }); cell.terminalWitness = this._witness(cell, "RESULT_EVALUATED", evaluation.evaluationRef, event.eventDigest); this._persist();
    return result(null, disposition, { evaluation, cell: this._publicCell(cell) });
  }

  reconcileTerminalCoverage(input = {}) {
    this._requireReady(); object(input, "DSS03_COVERAGE_INPUT_INVALID"); const plan = this._plan(id(input.planRef, "planRef"));
    const cells = plan.expectedCellRefs.map((ref) => this._cell(ref)); const witnesses = cells.map((cell) => cell.terminalWitness).filter(Boolean); const duplicateRefs = witnesses.map((witness) => witness.cellRef).filter((ref, index, all) => all.indexOf(ref) !== index); const unclassified = cells.filter((cell) => !cell.terminalWitness || !TERMINAL_CLASSES.has(cell.terminalWitness.terminalClass)).map((cell) => cell.cellRef);
    if (duplicateRefs.length || unclassified.length || witnesses.length !== cells.length) return result(null, "OPEN", { planRef: plan.planRef, expectedCellRefs: plan.expectedCellRefs, duplicateCellRefs: duplicateRefs, unclassifiedCellRefs: unclassified });
    if (plan.selectionMode === "exhaustive" && plan.excludedEdgeOccurrenceRefs.length) fail("DSS03_EXHAUSTIVE_COVERAGE_NOT_CLOSED");
    const partitions = Object.fromEntries([...TERMINAL_CLASSES].map((kind) => [kind, witnesses.filter((witness) => witness.terminalClass === kind).map((witness) => witness.cellRef)]));
    const coverageReceiptRef = id(input.coverageReceiptRef || randomRef("coverage"), "coverageReceiptRef"); const inputDigest = operationDigest("reconcileTerminalCoverage", { planRef: plan.planRef, coverageReceiptRef });
    if (this.state.coverages[coverageReceiptRef]) { if (this.state.coverages[coverageReceiptRef].operationInputDigest !== inputDigest) fail("DSS03_REPLAY_INPUT_CONFLICT", "reconcileTerminalCoverage"); return result(null, "EXACT_REPLAY", { coverage: this.state.coverages[coverageReceiptRef] }); }
    const coverage = { coverageReceiptRef, planRef: plan.planRef, expectedDigest: plan.expectedCellsDigest, witnessPopulationDigest: digestObject("Dss03.WitnessPopulation.v1", witnesses), partitions, resultsDigest: digestList(partitions.RESULT_EVALUATED, "Dss03.Coverage.Results.v1"), remandsDigest: digestList(partitions.EXPLICIT_REMAND, "Dss03.Coverage.Remands.v1"), failuresDigest: digestList(partitions.TERMINAL_FAILURE, "Dss03.Coverage.Failures.v1"), cancellationsDigest: digestList(partitions.AUTHORIZED_CANCELLATION, "Dss03.Coverage.Cancellations.v1"), duplicatesDigest: digestList(duplicateRefs, "Dss03.Coverage.Duplicates.v1"), unclassifiedDigest: digestList(unclassified, "Dss03.Coverage.Unclassified.v1"), operationInputDigest: inputDigest, state: "CLOSED", closedAt: this.clock() };
    coverage.coverageDigest = digestObject("DirectSemanticService.Dss03TerminalCoverage.v1", coverage); this.state.coverages[coverage.coverageReceiptRef] = coverage; this._saveEvent("terminal_coverage_closed", { coverageReceiptRef: coverage.coverageReceiptRef, planRef: plan.planRef, witnessPopulationDigest: coverage.witnessPopulationDigest });
    return result(null, "CLOSED", { coverage });
  }

  issueAdvisoryDisposition(input = {}) {
    this._requireReady(); object(input, "DSS03_DISPOSITION_INPUT_INVALID"); const coverage = this.state.coverages[id(input.coverageReceiptRef, "coverageReceiptRef")]; if (!coverage || coverage.state !== "CLOSED") fail("DSS03_COVERAGE_REQUIRED"); const plan = this._plan(coverage.planRef);
    const dispositionRef = id(input.dispositionRef || randomRef("disposition"), "dispositionRef"); const inputDigest = operationDigest("issueAdvisoryDisposition", { coverageReceiptRef: coverage.coverageReceiptRef, dispositionRef }); if (this.state.dispositions[dispositionRef]) { if (this.state.dispositions[dispositionRef].operationInputDigest !== inputDigest) fail("DSS03_REPLAY_INPUT_CONFLICT", "issueAdvisoryDisposition"); return result(null, "EXACT_REPLAY", { disposition: this.state.dispositions[dispositionRef] }); }
    const evaluationRefs = Object.values(this.state.evaluations).filter((evaluation) => evaluation.cellRef && plan.expectedCellRefs.includes(evaluation.cellRef)).map((evaluation) => evaluation.evaluationRef).sort();
    const disposition = { dispositionRef, jobRef: plan.jobRef, planRef: plan.planRef, coverageReceiptRef: coverage.coverageReceiptRef, terminalWitnessPopulationDigest: coverage.witnessPopulationDigest, evaluationRefs, evaluationPopulationDigest: digestList(evaluationRefs, "Dss03.EvaluationPopulation.v1"), selectionMode: plan.selectionMode, coveragePosture: "CLOSED", operationInputDigest: inputDigest, disposition: this._aggregateDisposition(evaluationRefs), authorityEffect: "none", issuedAt: this.clock() };
    this.state.dispositions[dispositionRef] = disposition; this._saveEvent("advisory_disposition_issued", { dispositionRef, coverageReceiptRef: coverage.coverageReceiptRef, disposition: disposition.disposition }); return result(null, "ISSUED", { disposition });
  }
  _aggregateDisposition(refs) { const values = refs.map((ref) => this.state.evaluations[ref]?.disposition).filter(Boolean); if (values.includes("ADVISORY_REMAND")) return "ADVISORY_REMAND"; if (values.includes("ADVISORY_INCONCLUSIVE")) return "ADVISORY_INCONCLUSIVE"; if (values.includes("ADVISORY_REFUTATION")) return "ADVISORY_REFUTATION"; return values.length ? "ADVISORY_SUPPORT" : "NON_RESULT_TERMINALS_ONLY"; }

  _sealDigestInput(seal) { const input = clone(seal); delete input.sealDigest; delete input.completedAt; delete input.completionInputDigest; input.state = "SEALED"; return input; }
  _verifySeal(seal) {
    if (seal?.state === "PREPARED") {
      if (seal.sealDigest !== null || !seal.resultSealRef || !seal.artifactRefs?.length || seal.artifactPopulationDigest !== digestList(seal.artifactRefs, "Dss03.Seal.Artifacts.v1")) fail("DSS03_PREPARED_SEAL_INVALID");
      const coverage = this.state.coverages[seal.coverageReceiptRef]; const disposition = this.state.dispositions[seal.dispositionRef];
      if (!coverage || !disposition || disposition.coverageReceiptRef !== seal.coverageReceiptRef || seal.terminalWitnessPopulationDigest !== coverage.witnessPopulationDigest) fail("DSS03_PREPARED_SEAL_INVALID");
      for (const artifactRef of seal.artifactRefs) { const artifact = this.state.cas[artifactRef]; if (!artifact || !["PUBLISHED", "REFERENCED"].includes(artifact.state) || artifact.planRef !== seal.planRef || artifact.jobRef !== seal.jobRef) fail("DSS03_PREPARED_SEAL_INVALID", artifactRef); this._verifyCasArtifact(artifact); }
      return true;
    }
    if (!seal || seal.sealDigest !== digestObject("DirectSemanticService.Dss03ResultSeal.v1", this._sealDigestInput(seal))) fail("DSS03_SEAL_DIGEST_INVALID");
    const coverage = this.state.coverages[seal.coverageReceiptRef]; const disposition = this.state.dispositions[seal.dispositionRef];
    if (!coverage || !disposition || disposition.coverageReceiptRef !== seal.coverageReceiptRef || seal.terminalWitnessPopulationDigest !== coverage.witnessPopulationDigest) fail("DSS03_SEAL_PREDECESSOR_INVALID");
    if (seal.artifactPopulationDigest !== digestList(seal.artifactRefs || [], "Dss03.Seal.Artifacts.v1")) fail("DSS03_SEAL_ARTIFACT_DIGEST_INVALID");
    for (const artifactRef of seal.artifactRefs || []) { const artifact = this.state.cas[artifactRef]; if (!artifact || artifact.state !== "REFERENCED" || artifact.sealRef !== seal.resultSealRef) fail("DSS03_CAS_REFERENCE_INVALID", artifactRef); this._verifyCasArtifact(artifact); }
    return true;
  }

  sealJobResults(input = {}) {
    this._requireReady(); object(input, "DSS03_SEAL_INPUT_INVALID"); const disposition = this.state.dispositions[id(input.dispositionRef, "dispositionRef")]; if (!disposition) fail("DSS03_DISPOSITION_REQUIRED"); const coverage = this.state.coverages[disposition.coverageReceiptRef]; if (!coverage || coverage.state !== "CLOSED") fail("DSS03_COVERAGE_REQUIRED");
    const resultSealRef = id(input.resultSealRef || randomRef("result-seal"), "resultSealRef"); const inputDigest = operationDigest("sealJobResults", { dispositionRef: disposition.dispositionRef, resultSealRef }); const existing = this.state.seals[resultSealRef] || Object.values(this.state.seals).find((seal) => seal.dispositionRef === disposition.dispositionRef); if (existing) { if (existing.operationInputDigest !== inputDigest) fail("DSS03_REPLAY_INPUT_CONFLICT", "sealJobResults"); if (existing.state === "PREPARED") return result(null, this._finishPreparedSeal(existing), { seal: existing }); this._verifySeal(existing); return result(null, "EXACT_REPLAY", { seal: existing }); }
    const plan = this._plan(disposition.planRef); const cells = plan.expectedCellRefs.map((ref) => this._cell(ref)); if (cells.some((cell) => !cell.terminalWitness)) fail("DSS03_TERMINAL_WITNESS_MISSING");
    const canonicalArtifacts = [];
    for (const cell of cells) {
      canonicalArtifacts.push(this._publishCanonical("cell-terminal-witness", cell.terminalWitness.witnessRef, cell.terminalWitness, { planRef: plan.planRef, jobRef: plan.jobRef }));
      for (const attempt of Object.values(this.state.attempts).filter((item) => item.cellRef === cell.cellRef)) {
        if (attempt.rawRef) this._verifyRawCustody(this.state.raw[attempt.rawRef]);
        const admission = attempt.rawRef ? this.state.admissions[attempt.rawRef] : null;
        if (admission) {
          const microresult = this.state.microresults[admission.microresultRef];
          if (microresult) canonicalArtifacts.push(this._publishCanonical("microresult", microresult.microresultRef, microresult, { planRef: plan.planRef, jobRef: plan.jobRef }));
        }
      }
      if (cell.evaluationRef) {
        const evaluation = this.state.evaluations[cell.evaluationRef];
        if (!evaluation) fail("DSS03_EVALUATION_UNKNOWN", cell.evaluationRef);
        canonicalArtifacts.push(this._publishCanonical("evaluation", evaluation.evaluationRef, evaluation, { planRef: plan.planRef, jobRef: plan.jobRef }));
        for (const attestationRef of evaluation.attestationRefs || []) { const attestation = this.state.attestations[attestationRef]; if (!attestation) fail("DSS03_ATTESTATION_UNKNOWN", attestationRef); canonicalArtifacts.push(this._publishCanonical("attestation", attestation.attestationRef, attestation, { planRef: plan.planRef, jobRef: plan.jobRef })); }
      }
    }
    canonicalArtifacts.push(this._publishCanonical("terminal-coverage", coverage.coverageReceiptRef, coverage, { planRef: plan.planRef, jobRef: plan.jobRef }));
    canonicalArtifacts.push(this._publishCanonical("advisory-disposition", disposition.dispositionRef, disposition, { planRef: plan.planRef, jobRef: plan.jobRef }));
    const uniqueArtifacts = [...new Map(canonicalArtifacts.map((artifact) => [artifact.artifactRef, artifact])).values()];
    const artifactRefs = uniqueArtifacts.map((artifact) => artifact.artifactRef);
    for (const artifact of uniqueArtifacts) this._verifyCasArtifact(artifact);
    const seal = { resultSealRef, jobRef: plan.jobRef, planRef: plan.planRef, coverageReceiptRef: coverage.coverageReceiptRef, dispositionRef: disposition.dispositionRef, terminalWitnessPopulationDigest: coverage.witnessPopulationDigest, artifactRefs, artifactPopulationDigest: digestList(artifactRefs, "Dss03.Seal.Artifacts.v1"), operationInputDigest: inputDigest, eventHead: this.state.events.length ? this.state.events[this.state.events.length - 1].eventDigest : null, state: "PREPARED", sealDigest: null, preparedAt: this.clock() };
    this.state.seals[seal.resultSealRef] = seal; this._saveEvent("job_results_seal_prepared", { resultSealRef: seal.resultSealRef, dispositionRef: seal.dispositionRef, artifactPopulationDigest: seal.artifactPopulationDigest });
    const status = this._finishPreparedSeal(seal); return result(null, status, { seal });
  }

  _finishPreparedSeal(seal) {
    this._verifySeal(seal);
    for (const artifactRef of seal.artifactRefs) { const artifact = this.state.cas[artifactRef]; artifact.state = "REFERENCED"; artifact.referenceCount = (artifact.referenceCount || 0) + 1; artifact.sealRef = seal.resultSealRef; }
    seal.state = "SEALED"; seal.sealedAt = this.clock(); seal.eventHead = this.state.events.length ? this.state.events[this.state.events.length - 1].eventDigest : null; seal.sealDigest = digestObject("DirectSemanticService.Dss03ResultSeal.v1", this._sealDigestInput(seal)); this._saveEvent("job_results_sealed", { resultSealRef: seal.resultSealRef, dispositionRef: seal.dispositionRef, artifactPopulationDigest: seal.artifactPopulationDigest }); return "SEALED";
  }

  completeJobResults(input = {}) {
    this._requireReady(); object(input, "DSS03_COMPLETE_INPUT_INVALID"); const seal = this.state.seals[id(input.resultSealRef, "resultSealRef")]; if (!seal) fail("DSS03_SEAL_REQUIRED"); const inputDigest = operationDigest("completeJobResults", { resultSealRef: seal.resultSealRef }); if (seal.state === "COMPLETED") { if (seal.completionInputDigest !== inputDigest) fail("DSS03_REPLAY_INPUT_CONFLICT", "completeJobResults"); this._verifySeal(seal); return result(null, "EXACT_REPLAY", { seal }); } if (seal.state !== "SEALED") fail("DSS03_SEAL_NOT_DURABLE"); this._verifySeal(seal);
    seal.state = "COMPLETED"; seal.completionInputDigest = inputDigest; seal.completedAt = this.clock(); this._saveEvent("job_results_completed", { resultSealRef: seal.resultSealRef, priorSealDigest: seal.sealDigest }); return result(null, "COMPLETED", { seal });
  }

  recordAttemptAccounting(input = {}) {
    this._requireReady(); object(input, "DSS03_ACCOUNTING_INPUT_INVALID"); const attempt = this.state.attempts[id(input.attemptRef, "attemptRef")]; if (!attempt) fail("DSS03_ATTEMPT_UNKNOWN"); const lease = this._validateLease(input, attempt, { operation: "recordAttemptAccounting" }); const inputBytes = checkedInteger(Number(input.inputBytes || 0), "inputBytes", 0); const inputDigest = operationDigest("recordAttemptAccounting", { attemptRef: attempt.attemptRef, leaseRef: lease.leaseRef, leaseRevision: lease.leaseRevision, fencingToken: lease.fencingToken, inputBytes }); const existing = this.state.accounting[attempt.attemptRef]; if (existing) { if (existing.operationInputDigest !== inputDigest) fail("DSS03_REPLAY_INPUT_CONFLICT", "recordAttemptAccounting"); return result(null, "EXACT_REPLAY", { accounting: existing }); } const observation = this.state.observations[attempt.observationRef]; const raw = attempt.rawRef ? this.state.raw[attempt.rawRef] : null; const accounting = { attemptRef: attempt.attemptRef, inputBytes, outputBytes: raw?.byteLength || 0, elapsedFakeTime: observation?.elapsedFakeTime || 0, modelTokens: 0, costMicrounits: 0, operationInputDigest: inputDigest, accountingEventDigest: digestObject("Dss03.Accounting.v1", { attemptRef: attempt.attemptRef, outputBytes: raw?.byteLength || 0 }), recordedAt: this.clock() }; this.state.accounting[attempt.attemptRef] = accounting; this._saveEvent("attempt_accounting_recorded", { attemptRef: attempt.attemptRef, outputBytes: accounting.outputBytes, modelTokens: 0, costMicrounits: 0 }); return result(null, "RECORDED", { accounting }); }

  releaseAttemptLease(input = {}) { this._requireReady(); object(input, "DSS03_RELEASE_INPUT_INVALID"); const attempt = this.state.attempts[id(input.attemptRef, "attemptRef")]; if (!attempt) fail("DSS03_ATTEMPT_UNKNOWN"); const leaseRef = id(input.leaseRef, "leaseRef"); const lease = this.state.leases[leaseRef]; if (!lease || lease.attemptRef !== attempt.attemptRef || lease.daemonGeneration !== this.state.generation.generationRef) fail("DSS03_STALE_LEASE", "releaseAttemptLease"); const leaseRevision = checkedInteger(Number(input.leaseRevision), "leaseRevision", 1); const fencingToken = checkedInteger(Number(input.fencingToken), "fencingToken", 0); const disposition = input.disposition || "RELEASED"; const inputDigest = operationDigest("releaseAttemptLease", { attemptRef: attempt.attemptRef, leaseRef, leaseRevision, fencingToken, disposition }); if (lease.releaseInputDigest) { if (lease.releaseInputDigest !== inputDigest) fail("DSS03_REPLAY_INPUT_CONFLICT", "releaseAttemptLease"); return result(null, "EXACT_REPLAY", { lease }); } if (lease.state !== "ACTIVE" || lease.leaseRevision !== leaseRevision || lease.fencingToken !== fencingToken) fail("DSS03_STALE_LEASE", "releaseAttemptLease"); if (new Date(lease.expiresAt).getTime() <= new Date(this.clock()).getTime()) fail("DSS03_LEASE_EXPIRED", "releaseAttemptLease"); lease.releaseInputDigest = inputDigest; lease.state = "RELEASED"; lease.releasedAt = this.clock(); lease.disposition = disposition; this._saveEvent("attempt_lease_released", { leaseRef: lease.leaseRef, attemptRef: lease.attemptRef, disposition }); return result(null, "RELEASED", { lease }); }

  rebuildExecutionState() {
    this._requireOpen();
    let priorDigest = null;
    for (let index = 0; index < this.state.events.length; index += 1) {
      const event = this.state.events[index];
      if (event.sequence !== index + 1 || event.priorDigest !== priorDigest) fail("DSS03_EVENT_CHAIN_INVALID");
      const unsigned = clone(event); delete unsigned.eventDigest;
      if (event.eventDigest !== digestObject("DirectSemanticService.Dss03ExecutionEvent.v1", unsigned)) fail("DSS03_EVENT_DIGEST_INVALID");
      priorDigest = event.eventDigest;
    }
    const expected = stateDigest(this.state); if (this.state.integrity && this.state.integrity.stateDigest !== expected) fail("DSS03_REBUILD_DRIFT");
    this._validateDurablePopulations();
    return result(null, "CURRENT", { stateDigest: expected, eventHead: priorDigest });
  }

  _validateDurablePopulations() {
    if (this.dss02?.store) {
      const integrity = this.dss02.store.all("PRAGMA integrity_check");
      if (!integrity.length || integrity.some((row) => Object.values(row)[0] !== "ok")) fail("DSS03_SQLITE_INTEGRITY_FAILURE");
      if (this.dss02.store.all("PRAGMA foreign_key_check").length) fail("DSS03_SQLITE_FOREIGN_KEY_FAILURE");
    }
    const maps = ["handoffs", "plans", "cells", "capsules", "assurances", "attempts", "leases", "observations", "raw", "admissions", "microresults", "candidates", "assessments", "attestations", "evaluations", "coverages", "dispositions", "seals", "accounting", "cas"];
    for (const name of maps) {
      if (!this.state[name] || typeof this.state[name] !== "object" || Array.isArray(this.state[name])) fail("DSS03_POPULATION_INVALID", name);
      for (const [key, value] of Object.entries(this.state[name])) if (!value || typeof value !== "object") fail("DSS03_POPULATION_MEMBER_INVALID", `${name}.${key}`);
    }
    if (this.state.counters.eventSequence !== this.state.events.length) fail("DSS03_EVENT_COUNTER_DRIFT");
    for (const [jobRef, handoff] of Object.entries(this.state.handoffs)) {
      if (handoff.jobRef !== jobRef || handoff.dss03Generation !== this.state.generation?.generationRef || handoff.state !== "ACCEPTED") fail("DSS03_HANDOFF_POPULATION_INVALID", jobRef);
      const tuple = clone(handoff); delete tuple.identityDigest; delete tuple.state; delete tuple.acceptedAt;
      if (handoff.identityDigest !== digestObject("DirectSemanticService.Dss03Handoff.v1", tuple)) fail("DSS03_HANDOFF_DIGEST_INVALID", jobRef);
    }
    for (const [planRef, plan] of Object.entries(this.state.plans)) {
      if (plan.planRef !== planRef || !this.state.handoffs[plan.jobRef] || plan.state !== "ADMITTED") fail("DSS03_PLAN_POPULATION_INVALID", planRef);
      const planUnsigned = clone(plan); delete planUnsigned.planDigest; if (plan.planDigest !== digestObject("DirectSemanticService.Dss03ExecutionPlan.v1", planUnsigned) || plan.generationRef !== this.state.generation?.generationRef || plan.attemptPolicyDigest !== digestObject("Dss03.AttemptPolicy.v1", plan.attemptPolicy) || plan.attemptPolicy.retryable_classes_digest !== digestList(plan.attemptPolicy.retryableFailureClasses, "Dss03.RetryableClasses.v1") || plan.attemptPolicy.max_attempts !== plan.attemptPolicy.maximumAttemptsPerReplicateSlot || plan.attemptPolicy.fake_runtime_revision !== this._fixture().runtime.runtimeRevision) fail("DSS03_PLAN_DIGEST_INVALID", planRef);
      const expectedRefs = unique(plan.expectedCellRefs, "expectedCellRefs");
      const expectedCells = expectedRefs.map((ref) => this.state.cells[ref]).filter(Boolean); if (expectedCells.length !== expectedRefs.length || expectedCellPopulationDigest(expectedCells) !== plan.expectedCellsDigest || plan.terminalPartitionDigest !== terminalPartitionDigest(expectedCells)) fail("DSS03_EXPECTED_CELLS_DIGEST_INVALID", planRef);
      if (expectedRefs.length !== plan.expectedCellRefs.length || new Set([...plan.selectedEdgeOccurrenceRefs, ...plan.excludedEdgeOccurrenceRefs]).size !== plan.compiledEdgeOccurrenceRefs.length || plan.selectedEdgeOccurrenceRefs.some((ref) => plan.excludedEdgeOccurrenceRefs.includes(ref))) fail("DSS03_PLAN_PARTITION_INVALID", planRef);
      for (const cellRef of expectedRefs) { const cell = this.state.cells[cellRef]; if (!cell || cell.planRef !== planRef || cell.jobRef !== plan.jobRef) fail("DSS03_PLAN_CELL_ORPHAN", cellRef); }
    }
    for (const [cellRef, cell] of Object.entries(this.state.cells)) {
      if (cell.cellRef !== cellRef || !this.state.plans[cell.planRef] || !this.state.plans[cell.planRef].expectedCellRefs.includes(cellRef)) fail("DSS03_CELL_ORPHAN", cellRef);
      if (cell.terminalWitness) { const witness = cell.terminalWitness; if (witness.cellRef !== cellRef || witness.planRef !== cell.planRef || witness.terminalClass !== cell.terminalClass || !TERMINAL_CLASSES.has(witness.terminalClass) || witness.sourceArtifactDigest !== digestObject("Dss03.Witness.Source.v1", { sourceArtifactRef: witness.sourceArtifactRef, terminalClass: witness.terminalClass })) fail("DSS03_WITNESS_INVALID", cellRef); const matchingEvent = this.state.events.find((event) => event.eventDigest === witness.terminalEventDigest); if (!matchingEvent && witness.terminalEventDigest !== digestObject("Dss03.Witness.Event.v1", { cellRef, terminalClass: witness.terminalClass, sourceArtifactRef: witness.sourceArtifactRef })) fail("DSS03_WITNESS_EVENT_INVALID", cellRef); }
    }
    for (const [ref, capsule] of Object.entries(this.state.capsules)) { if (capsule.capsuleRef !== ref || !this.state.plans[capsule.planRef] || !this.state.cells[capsule.cellRef] || this.state.cells[capsule.cellRef].planRef !== capsule.planRef) fail("DSS03_CAPSULE_ORPHAN", ref); const unsigned = clone(capsule); unsigned.capsuleDigest = null; if (capsule.capsuleDigest !== digestObject("DirectSemanticService.Dss03ExecutionCapsule.v1", unsigned)) fail("DSS03_CAPSULE_DIGEST_INVALID", ref); if (capsule.generationRef !== this.state.generation.generationRef || capsule.fixtureBundleDigest !== this._fixture().bundleDigest || capsule.fixtureRootFingerprint !== this._fixture().root.rootFingerprint || capsule.attemptPolicyDigest !== this.state.plans[capsule.planRef].attemptPolicyDigest || capsule.runtimeRevision !== this._fixture().runtime.runtimeRevision || capsule.executionProfileRef !== this._fixture().runtime.executionProfileRef || capsule.kernelRef !== this._fixture().runtime.kernelRef) fail("DSS03_CAPSULE_BINDING_INVALID", ref); }
    for (const [ref, assurance] of Object.entries(this.state.assurances)) { if (assurance.assuranceRef !== ref || !this.state.capsules[assurance.capsuleRef] || this.state.capsules[assurance.capsuleRef].cellRef !== assurance.cellRef) fail("DSS03_ASSURANCE_ORPHAN", ref); const unsigned = clone(assurance); unsigned.assuranceDigest = null; if (assurance.assuranceDigest !== digestObject("Dss03.PreexecutionAssurance.v1", unsigned) || assurance.generationRef !== this.state.generation.generationRef || assurance.fixtureHead !== this._fixture().bundleDigest || assurance.isolationDigest !== this._fixture().runtime.isolationDigest) fail("DSS03_ASSURANCE_BINDING_INVALID", ref); }
    for (const [ref, attempt] of Object.entries(this.state.attempts)) {
      if (attempt.attemptRef !== ref || !this.state.capsules[attempt.capsuleRef] || !this.state.cells[attempt.cellRef] || !this.state.plans[attempt.planRef] || this.state.capsules[attempt.capsuleRef].cellRef !== attempt.cellRef || attempt.policyRef !== this.state.plans[attempt.planRef].attemptPolicy.attemptPolicyRef) fail("DSS03_ATTEMPT_ORPHAN", ref);
      if (attempt.leaseRef && (!this.state.leases[attempt.leaseRef] || this.state.leases[attempt.leaseRef].attemptRef !== ref)) fail("DSS03_LEASE_ORPHAN", ref);
      if (attempt.rawRef && (!this.state.raw[attempt.rawRef] || this.state.raw[attempt.rawRef].attemptRef !== ref)) fail("DSS03_RAW_ORPHAN", ref);
      if (attempt.observationRef && !this.state.observations[attempt.observationRef]) fail("DSS03_OBSERVATION_ORPHAN", ref);
      const sameSlot = Object.values(this.state.attempts).filter((item) => item.cellRef === attempt.cellRef && item.replicateSlot === attempt.replicateSlot).sort((a, b) => a.attemptOrdinal - b.attemptOrdinal); if (sameSlot.some((item, index) => item.attemptOrdinal !== index + 1)) fail("DSS03_ATTEMPT_ORDINAL_GAP", ref);
    }
    if (this.state.counters.attemptSequence < Object.keys(this.state.attempts).length) fail("DSS03_ATTEMPT_COUNTER_DRIFT");
    for (const [ref, lease] of Object.entries(this.state.leases)) if (lease.leaseRef !== ref || !this.state.attempts[lease.attemptRef] || this.state.attempts[lease.attemptRef].leaseRef !== ref || lease.capsuleRef !== this.state.attempts[lease.attemptRef].capsuleRef || lease.daemonGeneration !== this.state.generation?.generationRef || !lease.leaseEventDigest) fail("DSS03_LEASE_POPULATION_INVALID", ref);
    for (const [ref, raw] of Object.entries(this.state.raw)) { if (raw.rawRef !== ref || raw.rawResultRef !== ref || !this.state.attempts[raw.attemptRef] || this.state.attempts[raw.attemptRef].rawRef !== ref || raw.byteCount !== raw.byteLength || raw.custodyTag !== digestObject("Dss03.RawCustody.v1", { quarantineRef: raw.quarantineRef, rawDigest: raw.digest, byteCount: raw.byteCount, retentionPolicy: raw.retentionPolicy })) fail("DSS03_RAW_POPULATION_INVALID", ref); this._verifyRawCustody(raw); }
    this._validateQuarantineInventory();
    for (const [ref, admission] of Object.entries(this.state.admissions)) if (admission.rawRef !== ref || !admission.rawDigest || admission.rawDigest !== this.state.raw[ref]?.digest || !admission.structuralReceiptsDigest || !admission.bindingReceiptsDigest || !admission.rejectionCodesDigest || !this.state.raw[ref] || !this.state.microresults[admission.microresultRef] || this.state.microresults[admission.microresultRef].attemptRef !== admission.attemptRef) fail("DSS03_ADMISSION_POPULATION_INVALID", ref);
    for (const [ref, microresult] of Object.entries(this.state.microresults)) if (microresult.microresultRef !== ref || !Object.values(this.state.attempts).some((attempt) => attempt.attemptRef === microresult.attemptRef) || !this.state.cells[microresult.cellRef]) fail("DSS03_MICRORESULT_ORPHAN", ref);
    for (const [ref, observation] of Object.entries(this.state.observations)) if (observation.cancellationRef && (!this.state.attempts[observation.attemptRef] || observation.cancellationRef !== ref)) fail("DSS03_CANCELLATION_ORPHAN", ref);
    for (const [ref, admission] of Object.entries(this.state.admissions)) for (const candidateRef of admission.candidateRefs || []) if (!this.state.candidates[candidateRef] || this.state.candidates[candidateRef].attemptRef !== admission.attemptRef) fail("DSS03_CANDIDATE_ORPHAN", candidateRef);
    for (const [ref, candidate] of Object.entries(this.state.candidates)) { if (candidate.candidateRef !== ref || !Object.values(this.state.admissions).some((admission) => (admission.candidateRefs || []).includes(ref))) fail("DSS03_CANDIDATE_ORPHAN", ref); if (candidate.candidateKind === "EVIDENCE_PAGE_FAULT" && candidate.rationaleDigest !== digestObject("Dss03.CandidateRationale.v1", candidate.rationale)) fail("DSS03_CANDIDATE_INVALID", ref); if (candidate.candidateKind === "NOVEL_EDGE" && candidate.boundedReportDigest !== digestObject("Dss03.BoundedReport.v1", candidate.boundedReport)) fail("DSS03_CANDIDATE_INVALID", ref); }
    for (const [ref, assessment] of Object.entries(this.state.assessments)) { if (assessment.assessmentRef !== ref || assessment.requiredDimensions.length !== LINEAGE_DIMENSIONS.length || assessment.requiredDimensions.some((value, index) => value !== LINEAGE_DIMENSIONS[index]) || assessment.microresultRefs.length < 2 || assessment.comparedResultsDigest !== digestList(assessment.microresultRefs, "Dss03.ComparedResults.v1") || assessment.requiredDimensionsDigest !== digestList(assessment.requiredDimensions, "Dss03.RequiredDimensions.v1") || assessment.observedDimensionsDigest !== digestObject("Dss03.ObservedDimensions.v1", assessment.observedDimensions) || assessment.sharedDimensionsDigest !== digestList(assessment.sharedDimensions, "Dss03.SharedDimensions.v1")) fail("DSS03_ASSESSMENT_INVALID", ref); for (const microresultRef of assessment.microresultRefs) if (!this.state.microresults[microresultRef]) fail("DSS03_ASSESSMENT_ORPHAN", ref); }
    for (const [ref, attestation] of Object.entries(this.state.attestations)) { if (attestation.attestationRef !== ref || !this.state.assessments[attestation.independenceRef] || !attestation.class) fail("DSS03_ATTESTATION_ORPHAN", ref); for (const microresultRef of attestation.microresultRefs) if (!this.state.microresults[microresultRef]) fail("DSS03_ATTESTATION_ORPHAN", ref); }
    for (const [ref, evaluation] of Object.entries(this.state.evaluations)) { if (evaluation.evaluationRef !== ref || !this.state.cells[evaluation.cellRef]) fail("DSS03_EVALUATION_ORPHAN", ref); for (const attestationRef of evaluation.attestationRefs || []) if (!this.state.attestations[attestationRef]) fail("DSS03_EVALUATION_ORPHAN", ref); }
    const coverageRefs = new Set();
    for (const [ref, coverage] of Object.entries(this.state.coverages)) { if (coverage.coverageReceiptRef !== ref || !this.state.plans[coverage.planRef] || coverage.state !== "CLOSED") fail("DSS03_COVERAGE_INVALID", ref); const parts = Object.values(coverage.partitions || {}).flat(); if (new Set(parts).size !== parts.length || parts.length !== this.state.plans[coverage.planRef].expectedCellRefs.length || parts.some((cellRef) => !this.state.plans[coverage.planRef].expectedCellRefs.includes(cellRef))) fail("DSS03_COVERAGE_PARTITION_INVALID", ref); coverageRefs.add(ref); }
    for (const [ref, disposition] of Object.entries(this.state.dispositions)) if (disposition.dispositionRef !== ref || !coverageRefs.has(disposition.coverageReceiptRef) || !this.state.plans[disposition.planRef]) fail("DSS03_DISPOSITION_ORPHAN", ref);
    const referencedCas = new Set();
    for (const [ref, seal] of Object.entries(this.state.seals)) { if (seal.resultSealRef !== ref || !this.state.dispositions[seal.dispositionRef] || !this.state.coverages[seal.coverageReceiptRef] || !["PREPARED", "SEALED", "COMPLETED"].includes(seal.state)) fail("DSS03_SEAL_INVALID", ref); for (const artifactRef of seal.artifactRefs || []) { const artifact = this.state.cas[artifactRef]; const prepared = seal.state === "PREPARED"; if (!artifact || (prepared ? !["PUBLISHED", "REFERENCED"].includes(artifact.state) : artifact.state !== "REFERENCED") || (!prepared && artifact.sealRef !== ref) || artifact.planRef !== seal.planRef || artifact.jobRef !== seal.jobRef) fail("DSS03_CAS_REFERENCE_INVALID", artifactRef); const canonical = this._verifyCasArtifact(artifact); if (canonical && canonical[artifact.kind === "microresult" ? "microresultRef" : artifact.kind === "evaluation" ? "evaluationRef" : artifact.kind === "attestation" ? "attestationRef" : artifact.kind === "terminal-coverage" ? "coverageReceiptRef" : artifact.kind === "advisory-disposition" ? "dispositionRef" : "witnessRef"] !== artifact.objectRef) fail("DSS03_CAS_OBJECT_BINDING_INVALID", artifactRef); referencedCas.add(artifactRef); } this._verifySeal(seal); }
    for (const [ref, artifact] of Object.entries(this.state.cas)) { if (artifact.artifactRef !== ref) fail("DSS03_CAS_REFERENCE_INVALID", ref); if (this.dss02?.store) { const row = this.dss02.store.get("SELECT artifact_ref,digest,state FROM artifacts WHERE artifact_ref=?", ref); if (!row || row.digest !== artifact.digest) fail("DSS03_SQLITE_CAS_REFERENCE_INVALID", ref); } this._verifyCasArtifact(artifact); if (!referencedCas.has(ref)) fail("DSS03_CAS_ORPHAN", ref); }
    if (this.profileRoot) {
      const casRoot = path.join(path.resolve(this.profileRoot), "dss03-cas");
      if (fs.existsSync(casRoot)) for (const entry of fs.readdirSync(casRoot, { withFileTypes: true })) { if (entry.isSymbolicLink() || !entry.isFile() || !Object.values(this.state.cas).some((artifact) => artifact.relativePath === path.join("dss03-cas", entry.name))) fail("DSS03_CAS_EXTRA_OBJECT", entry.name); }
    }
    for (const [ref, accounting] of Object.entries(this.state.accounting)) if (accounting.attemptRef !== ref || !this.state.attempts[ref]) fail("DSS03_ACCOUNTING_ORPHAN", ref);
    this._validateRecoveryDerivedState();
  }

  _validateRecoveryDerivedState() {
    const state = this.state;
    const lastEvent = state.events.at(-1)?.eventDigest || null;
    if (state.globalHead !== lastEvent) fail("DSS03_GLOBAL_HEAD_DRIFT");
    const expectedJobPopulation = digestObject("Dss03.JobPopulation.v1", Object.values(state.handoffs || {}).map((handoff) => ({ jobRef: handoff.jobRef, identityDigest: handoff.identityDigest })).sort((a, b) => a.jobRef.localeCompare(b.jobRef)));
    if (state.jobPopulationDigest !== expectedJobPopulation) fail("DSS03_JOB_POPULATION_DRIFT");
    const populationNames = ["handoffs", "plans", "cells", "capsules", "assurances", "attempts", "leases", "observations", "raw", "admissions", "microresults", "candidates", "assessments", "attestations", "evaluations", "coverages", "dispositions", "seals", "accounting", "cas"];
    const expectedPopulation = digestObject("Dss03.Population.v1", Object.fromEntries(populationNames.map((name) => [name, Object.keys(state[name] || {}).sort()])));
    if (state.populationDigest !== expectedPopulation) fail("DSS03_POPULATION_DIGEST_DRIFT");
    if (state.generation?.artifactInventoryDigest !== digestObject("Dss03.ArtifactInventory.v1", Object.keys(state.cas || {}).sort())) fail("DSS03_ARTIFACT_INVENTORY_DRIFT");

    const allocationSequences = Object.values(state.attempts).map((attempt) => attempt.allocationSequence).filter((value) => value !== undefined).sort((a, b) => a - b);
    if (allocationSequences.length !== Object.keys(state.attempts).length || allocationSequences.some((value, index) => value !== index + 1) || state.counters.attemptSequence !== allocationSequences.length) fail("DSS03_ATTEMPT_COUNTER_DRIFT");
    for (const attempt of Object.values(state.attempts)) {
      const lease = attempt.leaseRef ? state.leases[attempt.leaseRef] : null;
      if (["RETRYABLE_FAILURE", "TERMINAL_FAILURE", "INTERRUPTED_UNKNOWN", "CANCEL_ACKNOWLEDGED", "RAW_READY", "RAW_CAPTURED", "RESULT_ADMITTED"].includes(attempt.state) && !attempt.terminalAt && attempt.state !== "RESULT_ADMITTED") fail("DSS03_ATTEMPT_TERMINAL_TIME_MISSING", attempt.attemptRef);
      if (lease?.state === "ACTIVE" && !["ALLOCATED", "STARTED", "CANCEL_ACKNOWLEDGED", "RAW_READY", "RAW_CAPTURED", "RESULT_ADMITTED"].includes(attempt.state)) fail("DSS03_LEASE_CURRENTNESS_INVALID", lease.leaseRef);
      if (lease?.state === "RELEASED" && !lease.releasedAt) fail("DSS03_LEASE_RELEASE_INVALID", lease.leaseRef);
      if (attempt.state === "RAW_CAPTURED" && (!attempt.rawRef || !state.raw[attempt.rawRef])) fail("DSS03_RAW_ADMISSION_RESUME_INVALID", attempt.attemptRef);
      if (attempt.state === "RESULT_ADMITTED" && (!attempt.rawRef || !state.admissions[attempt.rawRef])) fail("DSS03_ADMISSION_STATE_INVALID", attempt.attemptRef);
    }

    const witnessByCell = new Map();
    for (const cell of Object.values(state.cells)) {
      if (!cell.terminalWitness) continue;
      const witness = cell.terminalWitness;
      if (witnessByCell.has(witness.cellRef) || witnessByCell.has(cell.cellRef)) fail("DSS03_WITNESS_DUPLICATE", cell.cellRef);
      if (witness.cellRef !== cell.cellRef) fail("DSS03_WITNESS_CELL_MISMATCH", cell.cellRef);
      witnessByCell.set(cell.cellRef, witness);
      if (witness.terminalClass === "RESULT_EVALUATED" && (!cell.evaluationRef || !state.evaluations[cell.evaluationRef] || witness.sourceArtifactRef !== cell.evaluationRef)) fail("DSS03_RESULT_WITNESS_SOURCE_INVALID", cell.cellRef);
      if (witness.terminalClass === "EXPLICIT_REMAND" && (!state.assurances[witness.sourceArtifactRef] || state.assurances[witness.sourceArtifactRef].cellRef !== cell.cellRef)) fail("DSS03_REMAND_WITNESS_SOURCE_INVALID", cell.cellRef);
      if (witness.terminalClass === "TERMINAL_FAILURE" && !state.attempts[witness.sourceArtifactRef]) fail("DSS03_FAILURE_WITNESS_SOURCE_INVALID", cell.cellRef);
      if (witness.terminalClass === "AUTHORIZED_CANCELLATION" && !state.observations[witness.sourceArtifactRef]) fail("DSS03_CANCELLATION_WITNESS_SOURCE_INVALID", cell.cellRef);
    }
    for (const coverage of Object.values(state.coverages)) {
      const plan = state.plans[coverage.planRef];
      if (!plan || coverage.state !== "CLOSED") continue;
      const cells = plan.expectedCellRefs.map((ref) => state.cells[ref]);
      const witnesses = cells.map((cell) => cell.terminalWitness);
      if (witnesses.some((witness) => !witness)) fail("DSS03_COVERAGE_WITNESS_MISSING", coverage.coverageReceiptRef);
      const partitions = Object.fromEntries([...TERMINAL_CLASSES].map((kind) => [kind, witnesses.filter((witness) => witness?.terminalClass === kind).map((witness) => witness.cellRef)]));
      const coverageUnsigned = clone(coverage); delete coverageUnsigned.coverageDigest;
      if (coverage.expectedDigest !== plan.expectedCellsDigest || coverage.witnessPopulationDigest !== digestObject("Dss03.WitnessPopulation.v1", witnesses) || canonicalJson(coverage.partitions) !== canonicalJson(partitions) || coverage.resultsDigest !== digestList(partitions.RESULT_EVALUATED, "Dss03.Coverage.Results.v1") || coverage.remandsDigest !== digestList(partitions.EXPLICIT_REMAND, "Dss03.Coverage.Remands.v1") || coverage.failuresDigest !== digestList(partitions.TERMINAL_FAILURE, "Dss03.Coverage.Failures.v1") || coverage.cancellationsDigest !== digestList(partitions.AUTHORIZED_CANCELLATION, "Dss03.Coverage.Cancellations.v1") || coverage.coverageDigest !== digestObject("DirectSemanticService.Dss03TerminalCoverage.v1", coverageUnsigned)) fail("DSS03_COVERAGE_DERIVED_STATE_DRIFT", coverage.coverageReceiptRef);
    }
    for (const disposition of Object.values(state.dispositions)) {
      const coverage = state.coverages[disposition.coverageReceiptRef];
      const plan = coverage && state.plans[coverage.planRef];
      if (!coverage || !plan) continue;
      const evaluationRefs = Object.values(state.evaluations).filter((evaluation) => plan.expectedCellRefs.includes(evaluation.cellRef)).map((evaluation) => evaluation.evaluationRef).sort();
      if (disposition.planRef !== plan.planRef || disposition.jobRef !== plan.jobRef || disposition.terminalWitnessPopulationDigest !== coverage.witnessPopulationDigest || canonicalJson(disposition.evaluationRefs) !== canonicalJson(evaluationRefs) || disposition.evaluationPopulationDigest !== digestList(evaluationRefs, "Dss03.EvaluationPopulation.v1") || disposition.disposition !== this._aggregateDisposition(evaluationRefs)) fail("DSS03_DISPOSITION_DERIVED_STATE_DRIFT", disposition.dispositionRef);
    }
    for (const cell of Object.values(state.cells)) if (cell.terminalWitness) {
      const expectedState = { RESULT_EVALUATED: "RESULT_EVALUATED", EXPLICIT_REMAND: "EXPLICIT_REMAND", TERMINAL_FAILURE: "TERMINAL_FAILURE", AUTHORIZED_CANCELLATION: "AUTHORIZED_CANCELLATION" }[cell.terminalWitness.terminalClass];
      if (!expectedState || cell.state !== expectedState || cell.terminalClass !== cell.terminalWitness.terminalClass) fail("DSS03_TERMINAL_PARTITION_DRIFT", cell.cellRef);
    }
    for (const evaluation of Object.values(state.evaluations)) {
      const attempts = (evaluation.attemptRefs || []).map((ref) => state.attempts[ref]);
      const resultRefs = attempts.map((attempt) => state.admissions[attempt?.rawRef]?.microresultRef).filter(Boolean);
      const attestations = (evaluation.attestationRefs || []).map((ref) => state.attestations[ref]);
      const statuses = resultRefs.map((ref) => state.microresults[ref]?.resultStatus).filter(Boolean);
      if (attempts.some((attempt) => !attempt) || canonicalJson(evaluation.resultRefs || []) !== canonicalJson(resultRefs) || evaluation.attemptPopulationDigest !== digestList(evaluation.attemptRefs || [], "Dss03.AttemptPopulation.v1") || evaluation.resultPopulationDigest !== digestList(resultRefs, "Dss03.ResultPopulation.v1") || evaluation.attestationPopulationDigest !== digestList(evaluation.attestationRefs || [], "Dss03.AttestationPopulation.v1") || evaluation.dissentDigest !== digestObject("Dss03.Dissent.v1", statuses) || attestations.some((attestation) => !attestation)) fail("DSS03_EVALUATION_DERIVED_STATE_DRIFT", evaluation.evaluationRef);
    }
    if (state.generation?.state === "READY") {
      const recoveryEvent = [...state.events].reverse().find((event) => event.type === "recovery_completed");
      if (!recoveryEvent || recoveryEvent.payload?.recoveryDigest !== state.generation.recoveryDigest || recoveryEvent.payload?.classificationDigest !== state.generation.classificationDigest || state.generation.classificationDigest !== digestObject("Dss03.RecoveryClassifications.v1", recoveryEvent.payload.classifications || [])) fail("DSS03_RECOVERY_DIGEST_DRIFT");
    }
  }

  _validateQuarantineInventory() {
    const raws = Object.values(this.state.raw || {});
    const referenced = new Set(raws.map((raw) => raw.relativePath || raw.quarantineRef));
    if (this.profileRoot && !this.dss02?.quarantine) {
      const quarantineRoot = path.join(path.resolve(this.profileRoot), "quarantine");
      if (!fs.existsSync(quarantineRoot)) { if (raws.length) fail("DSS03_RAW_MISSING"); return; }
      for (const entry of fs.readdirSync(quarantineRoot, { withFileTypes: true })) {
        const relativePath = path.join("quarantine", entry.name);
        if (entry.isSymbolicLink() || !entry.isFile() || !referenced.has(relativePath)) fail("DSS03_QUARANTINE_ORPHAN", entry.name);
      }
      for (const raw of raws) if (!referenced.has(raw.relativePath)) fail("DSS03_QUARANTINE_REFERENCE_INVALID", raw.rawRef);
    } else if (!this.dss02?.quarantine) {
      const owned = new Set(this.memoryQuarantine.keys());
      if (owned.size !== raws.length || raws.some((raw) => !owned.has(raw.quarantineRef))) fail("DSS03_QUARANTINE_POPULATION_INVALID");
    }
  }

  _verifyAcceptedHandoff(handoff) {
    if (!this.predecessorBoundary || typeof this.predecessorBoundary.verifyHandoff !== "function") fail("DSS03_PREDECESSOR_BOUNDARY_REQUIRED");
    const predecessor = this.predecessorBoundary.verifyHandoff(handoff);
    const tuple = { ...predecessor, dss03Generation: this.state.generation.generationRef };
    delete tuple.identityDigest;
    if (handoff.dss03Generation !== this.state.generation.generationRef || handoff.identityDigest !== digestObject("DirectSemanticService.Dss03Handoff.v1", tuple)) fail("DSS03_PREDECESSOR_HANDOFF_MISMATCH", handoff.jobRef);
    for (const key of ["jobRef", "jobAdmissionEventDigest", "jobEventHead", "dss02Generation", "fencingToken", "dispatchBoundaryRevision", "targetTrancheRevision", "handoffEventDigest", "dss03Generation"]) if (handoff[key] !== tuple[key]) fail("DSS03_PREDECESSOR_HANDOFF_MISMATCH", key);
    const acceptedEvent = this.state.events.find((event) => event.type === "dss02_handoff_accepted" && event.payload?.jobRef === handoff.jobRef && event.payload?.identityDigest === handoff.identityDigest);
    if (!acceptedEvent || acceptedEvent.payload.targetTrancheRevision !== handoff.targetTrancheRevision) fail("DSS03_HANDOFF_EVENT_PREFIX_INVALID", handoff.jobRef);
    return predecessor;
  }

  _recoveryEvent(type, payload) {
    const existing = this.state.events.find((event) => event.type === type && canonicalJson(event.payload) === canonicalJson(payload));
    return existing || this._event(type, payload);
  }

  _classifyRecoveryAttempt(attempt, classifications) {
    const cell = this.state.cells[attempt.cellRef];
    const plan = this.state.plans[attempt.planRef];
    const lease = attempt.leaseRef ? this.state.leases[attempt.leaseRef] : null;
    const cancellation = Object.values(this.state.observations).find((entry) => entry.cancellationRef && entry.attemptRef === attempt.attemptRef && entry.state === "SIGNAL_REQUESTED");
    const add = (classification, state = attempt.state) => classifications.push({ attemptRef: attempt.attemptRef, cellRef: attempt.cellRef, class: classification, state });
    const releaseLease = (disposition) => {
      if (lease?.state !== "ACTIVE") return;
      lease.state = "RELEASED"; lease.releasedAt = this.clock(); lease.disposition = disposition;
    };
    if (attempt.state === "ALLOCATED") {
      const failureClass = "transport_unavailable_before_dispatch";
      const retryable = plan.attemptPolicy.retryableFailureClasses.includes(failureClass) && attempt.attemptOrdinal < plan.attemptPolicy.maximumAttemptsPerReplicateSlot;
      releaseLease("RECOVERY_PREEXECUTION_ABANDONED");
      attempt.failureClass = failureClass; attempt.terminalAt = this.clock(); attempt.state = retryable ? "RETRYABLE_FAILURE" : "TERMINAL_FAILURE";
      const event = this._recoveryEvent("recovery_attempt_classified", { attemptRef: attempt.attemptRef, class: "PREEXECUTION_ABANDONMENT", resultingState: attempt.state });
      attempt.causalFailureRef = event.eventDigest;
      if (!retryable) { cell.state = "TERMINAL_FAILURE"; cell.terminalClass = "TERMINAL_FAILURE"; cell.terminalWitness = this._witness(cell, "TERMINAL_FAILURE", attempt.attemptRef, event.eventDigest); }
      add("PREEXECUTION_ABANDONMENT", attempt.state); return true;
    }
    if (cancellation && attempt.state === "STARTED") {
      releaseLease("RECOVERY_CANCEL_REQUEST_WITHOUT_ACK");
      attempt.state = "INTERRUPTED_UNKNOWN"; attempt.terminalAt = this.clock(); cancellation.state = "INTERRUPTED_UNKNOWN"; cancellation.adjudicationOutcome = "INTERRUPTED_UNKNOWN";
      const event = this._recoveryEvent("recovery_cancellation_interrupted", { cancellationRef: cancellation.cancellationRef, attemptRef: attempt.attemptRef, class: "CANCEL_REQUESTED_NO_ACK" });
      cancellation.adjudicationInputDigest ||= operationDigest("recoveryCancellation", { cancellationRef: cancellation.cancellationRef, attemptRef: attempt.attemptRef, class: "CANCEL_REQUESTED_NO_ACK" });
      attempt.causalFailureRef = event.eventDigest; add("CANCEL_REQUESTED_NO_ACK", attempt.state); return true;
    }
    if (attempt.state === "STARTED") {
      releaseLease("RECOVERY_INTERRUPTED_UNKNOWN");
      attempt.state = "INTERRUPTED_UNKNOWN"; attempt.terminalAt = this.clock();
      const event = this._recoveryEvent("recovery_attempt_interrupted", { attemptRef: attempt.attemptRef, class: "INTERRUPTED_UNKNOWN" });
      attempt.causalFailureRef = event.eventDigest; add("INTERRUPTED_UNKNOWN", attempt.state); return true;
    }
    if (attempt.state === "INTERRUPTED_UNKNOWN") { add("INTERRUPTED_UNKNOWN", attempt.state); return false; }
    if (attempt.state === "RAW_READY") { add("RAW_READY_PENDING_CAPTURE"); return false; }
    if (attempt.state === "RAW_CAPTURED" && attempt.rawRef && !this.state.admissions[attempt.rawRef]) { add("RAW_CAPTURED_PENDING_ADMISSION"); return false; }
    if (attempt.state === "RESULT_ADMITTED" && !cell.evaluationRef) { add("RESULT_ADMITTED_PENDING_EVALUATION"); return false; }
    if (attempt.state === "RETRYABLE_FAILURE") { add("RETRYABLE_FAILURE_PENDING_RETRY"); return false; }
    if (attempt.state === "CANCEL_ACKNOWLEDGED") { add("CANCEL_ACKNOWLEDGED_PENDING_ADJUDICATION"); return false; }
    return false;
  }

  recoverDss03Generation() {
    this._requireOpen(); if (!this.state.generation) return result(null, "BLOCKED", { reason: "DSS03_GENERATION_UNOPENED" });
    try {
      if (!this.state.fixture || !this.ownerFixtureBundle) fail("DSS03_FIXTURE_REQUIRED");
      this.verifyFakeFixtureRegistry();
      for (const handoff of Object.values(this.state.handoffs)) this._verifyAcceptedHandoff(handoff);
      this.rebuildExecutionState();
      for (const seal of Object.values(this.state.seals).filter((entry) => entry.state === "PREPARED")) this._finishPreparedSeal(seal);
    } catch (error) { if (this.state.fixture && /^DSS03_FIXTURE_/.test(error.code || "")) this.state.fixture.state = "BROKEN"; this.state.generation.state = "BLOCKED"; try { this._persist(); } catch (_) {} return result(null, "BLOCKED", { reason: error.code }); }
    const recoveryEventCount = this.state.events.length;
    const classifications = [];
    for (const attempt of Object.values(this.state.attempts)) this._classifyRecoveryAttempt(attempt, classifications);
    for (const coverage of Object.values(this.state.coverages)) if (coverage.state === "OPEN") classifications.push({ coverageReceiptRef: coverage.coverageReceiptRef, class: "OPEN_COVERAGE", state: coverage.state });
    for (const seal of Object.values(this.state.seals)) if (seal.state === "SEALED") classifications.push({ resultSealRef: seal.resultSealRef, class: "SEALED_NO_COMPLETION", state: seal.state }); else if (seal.state === "COMPLETED") classifications.push({ resultSealRef: seal.resultSealRef, class: "COMPLETED_TERMINAL", state: seal.state });
    this.state.generation.classificationDigest = digestObject("Dss03.RecoveryClassifications.v1", classifications);
    this.state.generation.state = "READY";
    this.state.generation.recoveryDigest = digestObject("Dss03.Recovery.v1", { classifications, eventHead: this.state.events.length ? this.state.events[this.state.events.length - 1].eventDigest : null });
    const hadRecoveryEvents = this.state.events.length > recoveryEventCount;
    this._saveEvent("recovery_completed", { recoveryDigest: this.state.generation.recoveryDigest, classificationDigest: this.state.generation.classificationDigest, classifications });
    this.recoveryRequired = false;
    return result(null, hadRecoveryEvents ? "RECOVERY_EVENTS_APPENDED" : "READY", { generation: this.state.generation, classifications });
  }

  projectResults(input = {}) {
    this._requireReady(); const jobRef = id(input.jobRef, "jobRef"); this._assertAuthorization(input.authorizationReceipt, "results", jobRef); const handoff = this._job(jobRef); const plan = Object.values(this.state.plans).find((item) => item.jobRef === jobRef); const seals = Object.values(this.state.seals).filter((seal) => seal.jobRef === jobRef); for (const seal of seals) this._verifySeal(seal); const output = { schema: "direct_semantic_dss03_result_projection@1", jobRef, handoffIdentityDigest: handoff.identityDigest, state: seals.find((seal) => seal.state === "COMPLETED") ? "COMPLETED" : (seals.length ? "SEALED" : "OPEN"), plan: plan ? { planRef: plan.planRef, selectionMode: plan.selectionMode, expectedCellCount: plan.expectedCellRefs.length } : null, cells: plan ? plan.expectedCellRefs.map((ref) => { const cell = this._publicCell(this._cell(ref)); const evaluation = cell.evaluationRef ? this.state.evaluations[cell.evaluationRef] : null; return { cellRef: cell.cellRef, edgeOccurrenceRef: cell.edgeOccurrenceRef, replicateSlot: cell.replicateSlot, state: cell.state, terminalClass: cell.terminalClass, evaluation: evaluation ? { evaluationRef: evaluation.evaluationRef, disposition: evaluation.disposition } : null }; }) : [], disposition: Object.values(this.state.dispositions).find((item) => item.jobRef === jobRef) || null, seal: seals[seals.length - 1] || null, generatedAt: this.clock() };
    return freeze(output);
  }

  status() { return freeze({ schema: "direct_semantic_dss03_status@1", trancheRevision: this.trancheRevision, profileRef: this.profileRef, opened: this.opened, recoveryRequired: this.recoveryRequired, generation: this.state.generation, fixtureRegistry: this.state.fixture ? { state: this.state.fixture.state, bundleDigest: this.state.fixture.bundleDigest, registryRevision: this.state.fixture.registry.registryRevision } : null, counts: Object.fromEntries(["handoffs", "plans", "cells", "attempts", "leases", "raw", "microresults", "candidates", "assessments", "attestations", "evaluations", "coverages", "dispositions", "seals", "events"].map((key) => [key, Array.isArray(this.state[key]) ? this.state[key].length : Object.keys(this.state[key] || {}).length])) }); }

  close() { this._persist(); this.opened = false; if (this.sqlite) this.sqlite.close(); return this.status(); }
}

function createDss03FakeExecutionBackend(options) { return new Dss03FakeExecutionBackend(options); }

module.exports = {
  DSS03_SCHEMA,
  DSS03_TRANCHE_REVISION,
  DSS03_STATE_SCHEMA,
  Dss03Error,
  Dss03FakeExecutionBackend,
  DirectSemanticServiceDss03: Dss03FakeExecutionBackend,
  createDss03FakeExecutionBackend,
  createDss03PredecessorBoundary,
  createDss02PredecessorBoundary,
  normalizeFixtureBundle,
  RESULT_STATUSES,
  TERMINAL_CLASSES,
  DSS03_CARRIER_FIELD_MAP,
};
