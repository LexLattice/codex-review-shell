"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const {
  WORLD_MANAGER_CONTROL_PLANE_STORE_SCHEMA,
  buildWorldManagerBootstrapManifest,
  buildWorldManagerMessage,
  buildWorldManagerSemanticEvent,
  digestFor,
  normalizeWorldManagerSubmitRequest,
  semanticEventDigest,
  stableId,
  validateWorldManagerBootstrapManifest,
  validateWorldManagerMessage,
  validateWorldManagerSemanticEvent,
} = require("./control-plane");
const {
  validateWorldManagerRoutingDecision,
  validateWorldManagerTaskSettlement,
} = require("./settlement");
const {
  validateSemanticIngressRun,
} = require("./semantic-ingress-runtime");
const {
  validateSemanticTargetResolution,
  validateWorldmodelIngressEnvelope,
} = require("../worldmodel/semantic-ingress");
const {
  AGENT_WORLD_COMPILATION_SCHEMA,
  rendererSafeAgentWorldSummary,
} = require("./agent-world-compiler");
const {
  AGENT_RESULT_SCHEMA,
} = require("./role-runtime");
const {
  admitProjectConstitution,
  reviewedProjectConstitutionCandidate,
  validateProjectConstitutionCandidate,
  validateRealizationOptionSnapshot,
} = require("./project-genesis");
const {
  validateChildEnvironmentInheritance,
  validateEnvironmentProbeReceipt,
  validateProjectWorkspaceBinding,
  validateProjectWorkspaceLocator,
  validateStepEnvironmentSnapshot,
  validateThreadEnvironmentBinding,
} = require("./project-substrate-runtime");
const {
  RECONSTRUCTED_SEMANTIC_SETTLEMENT_SCHEMA,
  buildReconstructedSemanticSettlement,
  buildRelationState,
  buildSemanticChildRelation,
  buildSemanticHistoryRelations,
  buildSemanticSettlementRevision,
  buildSemanticShelf,
  semanticTargetRef,
  sourceRef,
  validateRelationState,
  validateSemanticHistoryRelation,
  validateSemanticSettlementRevision,
  validateSemanticShelf,
  validateSettlementEvidence,
} = require("./semantic-history");
const {
  buildSemanticChildContract,
  buildSemanticSplitCoordination,
  semanticChildIngressMessage,
  validateSemanticChildContract,
  validateSemanticSplitCoordination,
} = require("./semantic-child-orchestration");
const {
  OPEN_DECISION_SCHEMA,
  buildOpenDecision,
  openDecisionInputFromLegacyDecision,
  openDecisionInputFromProjectCandidate,
  reviseOpenDecision,
  semanticArtifactRef,
  validateOpenDecision,
  validateOpenDecisionRevision,
} = require("./semantic-artifact-kernel");
const {
  DECISION_MECHANICAL_RESOLUTION_SCHEMA,
  DECISION_RESOLUTION_HISTORY_RELATION_SCHEMA,
  DECISION_SEMANTIC_RELAY_ENVELOPE_SCHEMA,
  DECISION_TRANSITION_RECEIPT_SCHEMA,
  DECISION_TRANSITION_REQUEST_SCHEMA,
  buildDecisionMechanicalResolution,
  buildDecisionResolutionHistoryRelation,
  buildDecisionSemanticRelayEnvelope,
  buildDecisionTransitionReceipt,
  buildDecisionTransitionRequest,
  decisionTransitionArtifactRef,
  decisionTransitionIdempotencyDigest,
  decisionTransitionReceiptRef,
  validateDecisionMechanicalResolution,
  validateDecisionResolutionHistoryRelation,
  validateDecisionSemanticRelayEnvelope,
  validateDecisionTransitionReceipt,
  validateDecisionTransitionRequest,
} = require("./decision-transition");
const {
  buildProjectEcologyStatusObjects,
  projectStatusContextRef,
  semanticProjectIndex:
    projectIndexFromStatusObjects,
} = require("./project-ecology-context");
const {
  IMPORT_CONTEXT,
  buildContextRequestManifestLink,
  buildContextRequirementSet,
  buildOperationalMetaContextBinding,
  buildSemanticContextImportRequest,
  rendererSafeOperationalMetaContextSummary,
  validateContextRequestManifestLink,
  validateContextRequirementSet,
  validateOperationalMetaContextManifest,
  validateSemanticContextBundle,
  validateSemanticContextImportRequest,
} = require("./semantic-context-kernel");
const {
  ARO_ADMISSION_RECEIPT_SCHEMA,
  ARO_REVIEW_RECEIPT_SCHEMA,
  abstractReasoningObjectRef,
  admitAroReconstructionCandidate,
  aroReconstructionCandidateRef,
  reviseAroRealizationFreshness,
  reviewAroReconstructionCandidate,
  validateAbstractReasoningObject,
  validateAroAdmissionReceipt,
  validateAroCurrentTargetComparison,
  validateAroReconstructionCandidate,
  validateAroReviewReceipt,
} = require("./aro-kernel");
const {
  buildAroReconstructionRun,
  buildRepositorySemanticSnapshot,
  reviseAroReconstructionRun,
  validateAroReconstructionRun,
  validateRepositorySemanticSnapshot,
} = require("./aro-reconstruction-runtime");
const {
  buildAroMutationCompilationRun,
  reviseAroMutationCompilationRun,
  validateAroMutationCompilationRun,
  validateAroMutationContract,
} = require("./aro-mutation-contract");
const {
  buildAroRealizationMappingRun,
  implementationObligationRef,
  reviseAroRealizationMappingRun,
  validateAroRealizationContextImport,
  validateAroRealizationMappingRun,
  validateAroRealizationMappingWitness,
} = require("./aro-realization-mapping");
const {
  buildAroWorkerHandoffRun,
  reviseAroWorkerHandoffRun,
  validateAroWorkerAuthorizationReceipt,
  validateAroWorkerCapabilityObservation,
  validateAroWorkerConstitution,
  validateAroWorkerHandoffRun,
  validateAroWorkerReviewReceipt,
  validateAroWorkerSourceFreshnessWitness,
} = require("./aro-worker-handoff");
const {
  buildAroExecutionEvidenceRun,
  reviseAroExecutionEvidenceRun,
  validateAroExecutionEvidenceBundle,
  validateAroExecutionEvidenceRun,
} = require("./aro-execution-evidence");
const {
  assessmentRef,
  buildAroSemanticVerificationRun,
  closureCandidateRef,
  reviseAroSemanticVerificationRun,
  validateAroClosureCandidate,
  validateAroSemanticVerificationAssessment,
  validateAroSemanticVerificationRun,
} = require("./aro-semantic-verification");
const {
  buildAroTargetDefinitionRun,
  reviseAroTargetDefinitionRun,
  targetDefinitionKeyDigest,
  targetIntentDigest,
  validateAroTargetDefinitionRun,
} = require("./aro-target-definition");
const {
  buildBaseContextCanvas,
  contextCanvasRef,
  validateContextCanvas,
  validateThoughtBrushStroke,
} = require("./thought-brush");
const {
  buildPlanAdmissionRequest,
  buildPlanProposalReviewReceipt,
  planProposalRef,
  validatePlanProposalRevision,
} = require("./plan-proposal-lifecycle");

const STORE_FILE_NAME = "world-manager-control-plane.sqlite";

function fail(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  if (detail) error.detail = detail;
  throw error;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseJson(value, fallback = null) {
  try {
    return JSON.parse(String(value ?? ""));
  } catch {
    return fallback;
  }
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function exactRefMatches(left, right) {
  return Boolean(
    left &&
      right &&
      left.kind === right.kind &&
      left.id === right.id &&
      left.digest === right.digest,
  );
}

function agentWorldSummaryMatchesCompilation(summary, compilation) {
  const expected = rendererSafeAgentWorldSummary(compilation);
  if (json(summary) === json(expected)) return true;

  // Renderer-safe summaries gained bounded trusted-evidence projections
  // additively. Preserve historical compilations exactly while accepting only
  // the known fields that did not exist when each summary was written.
  const legacyExpected = {
    ...expected,
  };
  if (
    !Object.prototype.hasOwnProperty.call(
      summary || {},
      "trustedRealizationEvidenceRef",
    )
  ) {
    delete legacyExpected.trustedRealizationEvidenceRef;
    delete legacyExpected.trustedRealizationOptionCount;
  }
  if (
    !Object.prototype.hasOwnProperty.call(
      summary || {},
      "trustedDiscourseEvidenceRef",
    )
  ) {
    delete legacyExpected.trustedDiscourseEvidenceRef;
    delete legacyExpected.trustedDiscourseSelectedTurnCount;
    delete legacyExpected.trustedDiscourseSelectionMode;
  }
  if (
    !Object.prototype.hasOwnProperty.call(
      summary || {},
      "trustedSemanticHistoryEvidenceRef",
    )
  ) {
    delete legacyExpected.trustedSemanticHistoryEvidenceRef;
    delete legacyExpected
      .trustedSemanticHistorySelectedTurnCount;
    delete legacyExpected
      .trustedSemanticHistorySelectedShelfCount;
  }
  return json(summary) === json(legacyExpected);
}

function nowIso(now = Date.now) {
  const value = typeof now === "function" ? now() : now;
  return new Date(Number(value) || Date.now()).toISOString();
}

function isSemanticIngressEvent(event) {
  return Boolean(
    event &&
      [
        "user_utterance_observed",
        "semantic_child_materialized",
      ].includes(event.eventKind),
  );
}

class DirectWorldManagerControlPlaneStore {
  constructor(options = {}) {
    const rootDir = normalizeString(options.rootDir, "");
    const dbPath = normalizeString(
      options.dbPath,
      rootDir ? path.join(rootDir, STORE_FILE_NAME) : "",
    );
    if (!dbPath) fail("world_manager_control_plane_store_path_required");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.rootDir = rootDir || path.dirname(dbPath);
    this.dbPath = dbPath;
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.db = new DatabaseSync(dbPath);
    this.db.exec("pragma journal_mode = WAL");
    this.db.exec("pragma foreign_keys = ON");
    this.db.exec("pragma busy_timeout = 5000");
    this.ensureSchema();
  }

  ensureOpen() {
    if (!this.db) fail("world_manager_control_plane_store_closed");
  }

  close() {
    if (!this.db) return;
    this.db.close();
    this.db = null;
  }

  ensureSchema() {
    this.ensureOpen();
    this.db.exec(`
      create table if not exists wm_meta (
        key text primary key,
        value text not null
      );

      create table if not exists wm_bootstrap_manifests (
        bootstrap_sequence integer primary key autoincrement,
        bootstrap_id text not null,
        revision integer not null,
        configuration_digest text not null,
        manifest_digest text not null unique,
        manifest_json text not null,
        created_at text not null,
        unique (bootstrap_id, revision)
      );

      create table if not exists wm_events (
        semantic_event_id text primary key,
        sequence integer not null unique,
        lineage_root_id text not null,
        client_request_id text not null unique,
        client_request_digest text not null,
        event_kind text not null,
        presentation_state text not null,
        actor_role text not null,
        project_id text not null,
        parent_event_ids_json text not null,
        artifact_refs_json text not null,
        previous_ledger_digest text not null,
        event_digest text not null unique,
        event_json text not null,
        occurred_at text not null
      );

      create table if not exists wm_messages (
        message_id text primary key,
        semantic_event_id text not null unique,
        client_request_id text not null unique,
        author_role text not null,
        project_id text not null,
        message_text text not null,
        presentation_state text not null,
        message_digest text not null,
        message_json text not null,
        created_at text not null,
        foreign key (semantic_event_id) references wm_events(semantic_event_id)
      );

      create table if not exists wm_candidate_artifacts (
        artifact_id text primary key,
        artifact_kind text not null,
        lineage_root_id text not null,
        project_id text not null,
        revision integer not null,
        lifecycle text not null,
        artifact_json text not null,
        artifact_digest text not null,
        created_at text not null,
        superseded_by_id text not null default ''
      );

      create table if not exists wm_plan_proposal_reviews (
        review_receipt_id text primary key,
        proposal_revision_id text not null unique,
        review_json text not null,
        review_digest text not null unique,
        reviewed_at text not null
      );

      create table if not exists wm_plan_admissions (
        admission_request_id text primary key,
        proposal_revision_id text not null unique,
        request_json text not null,
        request_digest text not null unique,
        state text not null,
        decision_json text not null default '{}',
        decision_digest text not null default '',
        implementation_contract_id text not null default '',
        work_thread_id text not null default '',
        last_error text not null default '',
        updated_at text not null
      );

      create table if not exists wm_implementation_contracts (
        implementation_contract_id text primary key,
        project_id text not null,
        proposal_revision_id text not null unique,
        contract_json text not null,
        contract_digest text not null unique,
        state text not null,
        work_thread_id text not null,
        created_at text not null
      );

      create table if not exists wm_realization_snapshots (
        snapshot_id text primary key,
        snapshot_json text not null,
        snapshot_digest text not null unique,
        observed_at text not null
      );

      create table if not exists wm_project_constitutions (
        project_id text primary key,
        constitution_json text not null,
        constitution_digest text not null unique,
        activation_state text not null,
        admitted_at text not null
      );

      create table if not exists wm_project_runtime_defaults (
        binding_id text primary key,
        project_id text not null unique,
        binding_json text not null,
        binding_digest text not null unique,
        activation_state text not null,
        created_at text not null
      );

      create table if not exists wm_project_workspace_locators (
        locator_id text primary key,
        project_id text not null unique,
        environment_id text not null,
        locator_json text not null,
        locator_digest text not null unique,
        created_at text not null
      );

      create table if not exists wm_environment_probe_receipts (
        probe_receipt_id text primary key,
        project_id text not null,
        environment_id text not null,
        probe_state text not null,
        receipt_json text not null,
        receipt_digest text not null unique,
        observed_at text not null
      );

      create table if not exists wm_project_workspace_bindings (
        workspace_binding_id text primary key,
        project_id text not null unique,
        environment_id text not null,
        binding_json text not null,
        binding_digest text not null unique,
        provisioning_state text not null,
        created_at text not null
      );

      create table if not exists wm_thread_environment_bindings (
        thread_environment_binding_id text primary key,
        thread_id text not null unique,
        work_thread_id text not null default '',
        project_id text not null,
        binding_json text not null,
        binding_digest text not null unique,
        created_at text not null
      );

      create table if not exists wm_step_environment_snapshots (
        step_environment_snapshot_id text primary key,
        thread_id text not null,
        step_id text not null,
        project_id text not null,
        snapshot_json text not null,
        snapshot_digest text not null unique,
        observed_at text not null,
        unique (thread_id, step_id)
      );

      create table if not exists wm_child_environment_inheritances (
        inheritance_id text primary key,
        parent_thread_id text not null,
        child_thread_id text not null unique,
        project_id text not null,
        inheritance_json text not null,
        inheritance_digest text not null unique,
        created_at text not null
      );

      create table if not exists wm_aro_reconstruction_candidates (
        candidate_record_id text primary key,
        candidate_id text not null,
        project_id text not null,
        aro_id text not null,
        aro_posture text not null,
        candidate_revision integer not null,
        lifecycle text not null,
        current_state text not null,
        candidate_json text not null,
        candidate_digest text not null unique,
        created_at text not null,
        unique (candidate_id, candidate_revision)
      );

      create table if not exists wm_repository_semantic_snapshots (
        snapshot_id text primary key,
        project_id text not null,
        snapshot_digest text not null unique,
        snapshot_json text not null,
        observed_at text not null
      );

      create table if not exists wm_aro_reconstruction_runs (
        run_record_id text primary key,
        run_id text not null,
        project_id text not null,
        snapshot_id text not null,
        snapshot_digest text not null,
        attempt integer not null,
        run_revision integer not null,
        run_state text not null,
        current_state text not null,
        run_json text not null,
        run_digest text not null unique,
        created_at text not null,
        updated_at text not null,
        unique (run_id, run_revision)
      );

      create table if not exists wm_aro_target_definition_runs (
        run_record_id text primary key,
        run_id text not null,
        project_id text not null,
        current_aro_id text not null,
        current_aro_digest text not null,
        target_intent_digest text not null,
        attempt integer not null,
        run_revision integer not null,
        run_state text not null,
        current_state text not null,
        run_json text not null,
        run_digest text not null unique,
        created_at text not null,
        updated_at text not null,
        unique (run_id, run_revision)
      );

      create table if not exists wm_aro_mutation_contracts (
        contract_record_id text primary key,
        contract_id text not null,
        project_id text not null,
        comparison_id text not null,
        comparison_digest text not null,
        contract_revision integer not null,
        current_state text not null,
        contract_json text not null,
        contract_digest text not null unique,
        created_at text not null,
        unique (contract_id, contract_revision)
      );

      create table if not exists wm_aro_mutation_compilation_runs (
        run_record_id text primary key,
        run_id text not null,
        project_id text not null,
        comparison_id text not null,
        comparison_digest text not null,
        attempt integer not null,
        run_revision integer not null,
        run_state text not null,
        current_state text not null,
        run_json text not null,
        run_digest text not null unique,
        created_at text not null,
        updated_at text not null,
        unique (run_id, run_revision)
      );

      create table if not exists wm_aro_realization_context_imports (
        import_record_id text primary key,
        context_import_id text not null unique,
        project_id text not null,
        contract_id text not null,
        contract_digest text not null,
        source_identity_digest text not null,
        import_json text not null,
        import_digest text not null unique,
        created_at text not null
      );

      create table if not exists wm_aro_realization_mapping_witnesses (
        mapping_record_id text primary key,
        mapping_witness_id text not null unique,
        project_id text not null,
        contract_id text not null,
        contract_digest text not null,
        context_import_id text not null,
        context_import_digest text not null,
        mapping_posture text not null,
        mapping_json text not null,
        mapping_digest text not null unique,
        created_at text not null
      );

      create table if not exists wm_aro_realization_mapping_runs (
        run_record_id text primary key,
        run_id text not null,
        project_id text not null,
        contract_id text not null,
        contract_digest text not null,
        context_import_id text not null,
        context_import_digest text not null,
        source_identity_digest text not null,
        attempt integer not null,
        run_revision integer not null,
        run_state text not null,
        current_state text not null,
        run_json text not null,
        run_digest text not null unique,
        created_at text not null,
        updated_at text not null,
        unique (run_id, run_revision)
      );

      create table if not exists wm_aro_worker_source_freshness (
        source_freshness_id text primary key,
        project_id text not null,
        context_import_id text not null,
        context_import_digest text not null,
        witness_state text not null,
        witness_json text not null,
        witness_digest text not null unique,
        created_at text not null
      );

      create table if not exists wm_aro_worker_capability_observations (
        capability_observation_id text primary key,
        project_id text not null,
        worker_start_available integer not null,
        observation_json text not null,
        observation_digest text not null unique,
        created_at text not null
      );

      create table if not exists wm_aro_worker_review_receipts (
        review_receipt_id text primary key,
        project_id text not null,
        contract_id text not null,
        contract_digest text not null,
        mapping_witness_id text not null,
        mapping_witness_digest text not null,
        review_state text not null,
        receipt_json text not null,
        receipt_digest text not null unique,
        created_at text not null
      );

      create table if not exists wm_aro_worker_constitutions (
        constitution_id text primary key,
        project_id text not null,
        contract_id text not null,
        contract_digest text not null,
        mapping_witness_id text not null,
        mapping_witness_digest text not null,
        review_receipt_id text not null,
        review_receipt_digest text not null,
        constitution_state text not null,
        constitution_json text not null,
        constitution_digest text not null unique,
        created_at text not null
      );

      create table if not exists wm_aro_worker_authorizations (
        authorization_receipt_id text primary key,
        project_id text not null,
        constitution_id text not null,
        constitution_digest text not null,
        operator_action_id text not null unique,
        authorization_state text not null,
        receipt_json text not null,
        receipt_digest text not null unique,
        created_at text not null
      );

      create table if not exists wm_aro_worker_handoff_runs (
        run_record_id text primary key,
        run_id text not null,
        project_id text not null,
        constitution_id text not null,
        constitution_digest text not null,
        authorization_receipt_id text not null,
        authorization_receipt_digest text not null,
        run_revision integer not null,
        run_state text not null,
        current_state text not null,
        run_json text not null,
        run_digest text not null unique,
        created_at text not null,
        updated_at text not null,
        unique (run_id, run_revision)
      );

      create table if not exists wm_aro_execution_evidence_bundles (
        evidence_bundle_id text primary key,
        project_id text not null,
        handoff_run_id text not null,
        handoff_run_digest text not null,
        acquisition_run_id text not null,
        acquisition_run_digest text not null,
        capture_state text not null,
        bundle_json text not null,
        bundle_digest text not null unique,
        created_at text not null
      );

      create table if not exists wm_aro_execution_evidence_runs (
        run_record_id text primary key,
        run_id text not null,
        project_id text not null,
        handoff_run_id text not null,
        handoff_run_digest text not null,
        observation_request_id text not null,
        run_revision integer not null,
        run_state text not null,
        current_state text not null,
        run_json text not null,
        run_digest text not null unique,
        created_at text not null,
        updated_at text not null,
        unique (run_id, run_revision),
        unique (handoff_run_id, observation_request_id, run_revision)
      );

      create table if not exists wm_aro_semantic_verification_assessments (
        assessment_id text primary key,
        project_id text not null,
        evidence_bundle_id text not null,
        evidence_bundle_digest text not null,
        overall_posture text not null,
        assessment_json text not null,
        assessment_digest text not null unique,
        created_at text not null
      );

      create table if not exists wm_aro_closure_candidates (
        closure_candidate_id text primary key,
        project_id text not null,
        assessment_id text not null,
        assessment_digest text not null,
        gate_disposition text not null,
        candidate_json text not null,
        candidate_digest text not null unique,
        created_at text not null
      );

      create table if not exists wm_aro_semantic_verification_runs (
        run_record_id text primary key,
        run_id text not null,
        project_id text not null,
        evidence_bundle_id text not null,
        evidence_bundle_digest text not null,
        attempt integer not null,
        run_revision integer not null,
        run_state text not null,
        current_state text not null,
        run_json text not null,
        run_digest text not null unique,
        created_at text not null,
        updated_at text not null,
        unique (run_id, run_revision),
        unique (evidence_bundle_id, attempt, run_revision)
      );

      create table if not exists wm_thought_brush_strokes (
        brush_stroke_id text primary key,
        project_id text not null,
        target_project_id text not null,
        brush_kind text not null,
        stroke_state text not null,
        stroke_json text not null,
        stroke_digest text not null unique,
        created_at text not null
      );

      create table if not exists wm_context_canvas_revisions (
        canvas_record_id text primary key,
        context_canvas_id text not null,
        owner_id text not null,
        project_id text not null,
        active_project_id text not null,
        canvas_revision integer not null,
        operation_kind text not null,
        current_state text not null,
        canvas_json text not null,
        canvas_digest text not null unique,
        created_at text not null,
        unique (context_canvas_id, canvas_revision)
      );

      create table if not exists wm_aro_registry (
        aro_record_id text primary key,
        aro_id text not null,
        project_id text not null,
        concept_key text not null,
        aro_posture text not null,
        aro_revision integer not null,
        lifecycle text not null,
        current_state text not null,
        aro_json text not null,
        aro_digest text not null unique,
        created_at text not null,
        unique (aro_id, aro_revision)
      );

      create table if not exists wm_aro_review_receipts (
        review_receipt_id text primary key,
        candidate_id text not null,
        receipt_json text not null,
        receipt_digest text not null unique,
        created_at text not null
      );

      create table if not exists wm_aro_admission_receipts (
        admission_receipt_id text primary key,
        candidate_id text not null unique,
        aro_id text not null,
        receipt_json text not null,
        receipt_digest text not null unique,
        created_at text not null
      );

      create table if not exists wm_inbox (
        inbox_entry_id text primary key,
        semantic_event_id text not null,
        agent_result_ref_json text not null,
        delivery_state text not null,
        attempts integer not null default 0,
        lease_owner text not null default '',
        lease_expires_at text not null default '',
        last_error text not null default ''
      );

      create table if not exists wm_decisions (
        decision_request_id text primary key,
        semantic_event_id text not null,
        target_artifact_ref_json text not null,
        decision_kind text not null,
        state text not null,
        authority_requirements_json text not null,
        decision_ref_json text not null default '{}'
      );

      create table if not exists wm_runtime_bindings (
        binding_id text primary key,
        role_kind text not null,
        manager_agent_id text not null,
        project_id text not null,
        proposal_lineage_id text not null,
        direct_session_id text not null,
        current_instantiation_ref_json text not null,
        state text not null
      );

      create table if not exists wm_role_runs (
        run_id text primary key,
        source_semantic_event_id text not null,
        role_kind text not null,
        manager_agent_id text not null,
        project_id text not null,
        agent_instantiation_id text not null,
        direct_session_id text not null,
        direct_turn_id text not null,
        run_state text not null,
        run_json text not null,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists wm_agent_results (
        agent_result_id text primary key,
        source_semantic_event_id text not null,
        run_id text not null,
        role_kind text not null,
        result_state text not null,
        output_contract_state text not null,
        result_json text not null,
        final_message_json text not null,
        response_json text not null,
        typed_payload_json text not null,
        telemetry_json text not null,
        created_at text not null
      );

      create table if not exists wm_reconciliations (
        reconciliation_id text primary key,
        source_semantic_event_id text not null unique,
        source_agent_result_id text not null,
        reconciliation_agent_result_id text not null default '',
        reconciliation_state text not null,
        reconciliation_json text not null,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists wm_worldmodel_bindings (
        binding_id text primary key,
        bootstrap_id text not null,
        configuration_digest text not null,
        graph_id text not null,
        graph_digest text not null,
        binding_state text not null,
        binding_json text not null,
        created_at text not null
      );

      create table if not exists wm_settlements (
        task_settlement_id text primary key,
        semantic_event_id text not null unique,
        lineage_root_id text not null,
        project_id text not null,
        task_type text not null,
        settlement_state text not null,
        settlement_json text not null,
        ingress_json text not null,
        target_resolution_json text not null,
        settlement_digest text not null unique,
        created_at text not null
      );

      create table if not exists wm_semantic_ingress_runs (
        semantic_ingress_run_id text primary key,
        semantic_event_id text not null unique,
        run_state text not null,
        run_json text not null,
        semantic_settlement_digest text not null unique,
        run_digest text not null unique,
        created_at text not null,
        foreign key (semantic_event_id) references wm_events(semantic_event_id)
      );

      create table if not exists wm_semantic_settlement_revisions (
        settlement_revision_id text primary key,
        semantic_event_id text not null,
        settlement_revision integer not null,
        semantic_settlement_id text not null,
        semantic_settlement_digest text not null,
        provenance_posture text not null,
        confidence text not null,
        current_state text not null,
        revision_json text not null,
        revision_digest text not null unique,
        created_at text not null,
        unique (semantic_event_id, settlement_revision),
        foreign key (semantic_event_id) references wm_events(semantic_event_id)
      );

      create table if not exists wm_semantic_history_relations (
        relation_id text primary key,
        source_semantic_event_id text not null,
        settlement_revision integer not null,
        relation_kind text not null,
        target_kind text not null,
        target_id text not null,
        posture text not null,
        durability text not null,
        confidence text not null,
        initial_lifecycle text not null,
        relation_json text not null,
        relation_digest text not null unique,
        created_at text not null,
        foreign key (source_semantic_event_id) references wm_events(semantic_event_id)
      );

      create table if not exists wm_semantic_history_relation_states (
        relation_state_id text primary key,
        relation_id text not null,
        lifecycle text not null,
        state_json text not null,
        state_digest text not null unique,
        occurred_at text not null,
        foreign key (relation_id) references wm_semantic_history_relations(relation_id)
      );

      create table if not exists wm_semantic_shelves (
        shelf_record_id text primary key,
        shelf_id text not null,
        shelf_kind text not null,
        anchor_key text not null,
        shelf_revision integer not null,
        current_state text not null,
        shelf_json text not null,
        shelf_digest text not null unique,
        source_digest text not null,
        created_at text not null,
        unique (shelf_id, shelf_revision)
      );

      create table if not exists wm_semantic_artifacts (
        semantic_artifact_record_id text primary key,
        semantic_artifact_id text not null,
        artifact_kind text not null,
        scope_kind text not null,
        project_id text not null,
        artifact_revision integer not null,
        lifecycle text not null,
        current_state text not null,
        source_kind text not null,
        source_key text not null,
        source_state_digest text not null,
        artifact_json text not null,
        artifact_digest text not null unique,
        created_at text not null,
        unique (semantic_artifact_id, artifact_revision)
      );

      create table if not exists wm_decision_transition_requests (
        decision_transition_request_id text primary key,
        client_request_id text not null unique,
        decision_id text not null,
        transition_kind text not null,
        idempotency_digest text not null,
        request_json text not null,
        request_digest text not null unique,
        created_at text not null
      );

      create table if not exists wm_decision_transition_artifacts (
        transition_artifact_id text primary key,
        decision_transition_request_id text not null unique,
        decision_id text not null,
        artifact_kind text not null,
        artifact_json text not null,
        artifact_digest text not null unique,
        created_at text not null,
        foreign key (decision_transition_request_id)
          references wm_decision_transition_requests(
            decision_transition_request_id
          )
      );

      create table if not exists wm_decision_resolution_relations (
        decision_resolution_relation_id text primary key,
        decision_transition_request_id text not null unique,
        decision_id text not null,
        relation_kind text not null,
        relation_json text not null,
        relation_digest text not null unique,
        created_at text not null,
        foreign key (decision_transition_request_id)
          references wm_decision_transition_requests(
            decision_transition_request_id
          )
      );

      create table if not exists wm_decision_transition_receipts (
        decision_transition_receipt_record_id text primary key,
        decision_transition_receipt_id text not null,
        decision_transition_request_id text not null,
        decision_id text not null,
        receipt_revision integer not null,
        receipt_state text not null,
        current_state text not null,
        receipt_json text not null,
        receipt_digest text not null unique,
        created_at text not null,
        unique (
          decision_transition_receipt_id,
          receipt_revision
        ),
        foreign key (decision_transition_request_id)
          references wm_decision_transition_requests(
            decision_transition_request_id
          )
      );

      create table if not exists wm_semantic_child_contracts (
        child_contract_id text primary key,
        parent_semantic_event_id text not null,
        child_semantic_event_id text not null unique,
        child_index integer not null,
        execution_state text not null,
        contract_json text not null,
        contract_digest text not null unique,
        created_at text not null,
        updated_at text not null,
        unique (parent_semantic_event_id, child_index),
        foreign key (parent_semantic_event_id)
          references wm_events(semantic_event_id),
        foreign key (child_semantic_event_id)
          references wm_events(semantic_event_id)
      );

      create table if not exists wm_semantic_split_coordinations (
        coordination_record_id text primary key,
        coordination_id text not null,
        parent_semantic_event_id text not null,
        coordination_state text not null,
        coordination_revision integer not null,
        current_state text not null,
        coordination_json text not null,
        coordination_digest text not null unique,
        created_at text not null,
        updated_at text not null,
        unique (coordination_id, coordination_revision),
        foreign key (parent_semantic_event_id)
          references wm_events(semantic_event_id)
      );

      create table if not exists wm_routing_decisions (
        routing_decision_id text primary key,
        semantic_event_id text not null unique,
        selected_role text not null,
        decision_kind text not null,
        decision_json text not null,
        decision_digest text not null unique,
        created_at text not null
      );

      create table if not exists wm_manager_contexts (
        context_bundle_id text primary key,
        semantic_event_id text not null unique,
        project_id text not null,
        manager_role text not null,
        context_json text not null,
        context_digest text not null unique,
        created_at text not null
      );

      create table if not exists wm_agent_world_compilations (
        agent_world_compilation_id text primary key,
        semantic_event_id text not null unique,
        project_id text not null,
        role_template_id text not null,
        compilation_state text not null,
        summary_json text not null,
        compilation_json text not null,
        compilation_digest text not null unique,
        created_at text not null
      );

      create table if not exists wm_context_requirement_sets (
        context_requirement_set_id text primary key,
        semantic_event_id text not null,
        agent_instantiation_id text not null,
        scope_kind text not null,
        project_id text not null,
        current_state text not null,
        requirement_json text not null,
        requirement_digest text not null unique,
        created_at text not null,
        foreign key (semantic_event_id)
          references wm_events(semantic_event_id)
      );

      create table if not exists wm_semantic_context_imports (
        context_import_id text primary key,
        semantic_event_id text not null,
        agent_instantiation_id text not null,
        context_requirement_set_id text not null,
        import_json text not null,
        import_digest text not null unique,
        created_at text not null,
        foreign key (semantic_event_id)
          references wm_events(semantic_event_id),
        foreign key (context_requirement_set_id)
          references wm_context_requirement_sets(
            context_requirement_set_id
          )
      );

      create table if not exists wm_semantic_context_bundles (
        context_bundle_id text primary key,
        context_import_id text not null,
        semantic_event_id text not null,
        agent_instantiation_id text not null,
        cache_key text not null unique,
        dependency_digest text not null,
        freshness text not null,
        current_state text not null,
        bundle_json text not null,
        bundle_digest text not null unique,
        created_at text not null,
        foreign key (semantic_event_id)
          references wm_events(semantic_event_id),
        foreign key (context_import_id)
          references wm_semantic_context_imports(context_import_id)
      );

      create table if not exists
        wm_operational_meta_context_manifests (
          operational_meta_context_id text primary key,
          semantic_event_id text not null,
          agent_instantiation_id text not null,
          context_bundle_id text not null unique,
          current_state text not null,
          manifest_json text not null,
          manifest_digest text not null unique,
          created_at text not null,
          foreign key (semantic_event_id)
            references wm_events(semantic_event_id),
          foreign key (context_bundle_id)
            references wm_semantic_context_bundles(
              context_bundle_id
            )
        );

      create table if not exists
        wm_context_request_manifest_links (
          context_request_manifest_link_id text primary key,
          semantic_event_id text not null,
          agent_instantiation_id text not null,
          operational_meta_context_id text not null,
          direct_session_id text not null,
          direct_turn_id text not null,
          request_manifest_id text not null,
          link_json text not null,
          link_digest text not null unique,
          created_at text not null,
          unique (
            operational_meta_context_id,
            request_manifest_id
          ),
          foreign key (semantic_event_id)
            references wm_events(semantic_event_id),
          foreign key (operational_meta_context_id)
            references wm_operational_meta_context_manifests(
              operational_meta_context_id
            )
        );

      create index if not exists wm_events_lineage_idx
        on wm_events(lineage_root_id, sequence);
      create index if not exists wm_events_project_idx
        on wm_events(project_id, sequence);
      create index if not exists wm_candidates_project_idx
        on wm_candidate_artifacts(project_id, artifact_kind, lifecycle);
      create index if not exists wm_aro_candidates_project_idx
        on wm_aro_reconstruction_candidates(
          project_id, current_state, lifecycle, aro_posture
        );
      create unique index if not exists
        wm_aro_candidates_current_idx
        on wm_aro_reconstruction_candidates(candidate_id)
        where current_state = 'current';
      create index if not exists
        wm_repository_semantic_snapshots_project_idx
        on wm_repository_semantic_snapshots(
          project_id, observed_at
        );
      create index if not exists
        wm_environment_probe_receipts_project_idx
        on wm_environment_probe_receipts(
          project_id, environment_id, observed_at
        );
      create index if not exists
        wm_thread_environment_bindings_project_idx
        on wm_thread_environment_bindings(
          project_id, created_at
        );
      create index if not exists
        wm_step_environment_snapshots_thread_idx
        on wm_step_environment_snapshots(
          thread_id, observed_at
        );
      create index if not exists
        wm_aro_reconstruction_runs_project_idx
        on wm_aro_reconstruction_runs(
          project_id, snapshot_digest, attempt
        );
      create unique index if not exists
        wm_aro_reconstruction_runs_current_idx
        on wm_aro_reconstruction_runs(run_id)
        where current_state = 'current';
      create index if not exists
        wm_aro_target_definition_runs_project_idx
        on wm_aro_target_definition_runs(
          project_id, current_aro_digest,
          target_intent_digest, attempt
        );
      create unique index if not exists
        wm_aro_target_definition_runs_current_idx
        on wm_aro_target_definition_runs(run_id)
        where current_state = 'current';
      create index if not exists
        wm_aro_mutation_contracts_project_idx
        on wm_aro_mutation_contracts(
          project_id, comparison_digest, contract_revision
        );
      create unique index if not exists
        wm_aro_mutation_contracts_current_idx
        on wm_aro_mutation_contracts(contract_id)
        where current_state = 'current';
      create index if not exists
        wm_aro_mutation_runs_project_idx
        on wm_aro_mutation_compilation_runs(
          project_id, comparison_digest, attempt
        );
      create unique index if not exists
        wm_aro_mutation_runs_current_idx
        on wm_aro_mutation_compilation_runs(run_id)
        where current_state = 'current';
      create index if not exists
        wm_aro_realization_imports_contract_idx
        on wm_aro_realization_context_imports(
          project_id, contract_digest, created_at
        );
      create index if not exists
        wm_aro_realization_mappings_contract_idx
        on wm_aro_realization_mapping_witnesses(
          project_id, contract_digest, created_at
        );
      create index if not exists
        wm_aro_realization_mapping_runs_contract_idx
        on wm_aro_realization_mapping_runs(
          project_id, contract_digest,
          source_identity_digest, attempt
        );
      create unique index if not exists
        wm_aro_realization_mapping_runs_current_idx
        on wm_aro_realization_mapping_runs(run_id)
        where current_state = 'current';
      create index if not exists
        wm_aro_worker_reviews_contract_idx
        on wm_aro_worker_review_receipts(
          project_id, contract_digest, created_at
        );
      create index if not exists
        wm_aro_worker_constitutions_contract_idx
        on wm_aro_worker_constitutions(
          project_id, contract_digest, created_at
        );
      create index if not exists
        wm_aro_worker_authorizations_constitution_idx
        on wm_aro_worker_authorizations(
          project_id, constitution_digest, created_at
        );
      create index if not exists
        wm_aro_worker_handoff_runs_constitution_idx
        on wm_aro_worker_handoff_runs(
          project_id, constitution_digest, created_at
        );
      create unique index if not exists
        wm_aro_worker_handoff_runs_current_idx
        on wm_aro_worker_handoff_runs(run_id)
        where current_state = 'current';
      create index if not exists wm_aro_registry_project_idx
        on wm_aro_registry(
          project_id, concept_key, aro_posture, current_state
        );
      create unique index if not exists
        wm_aro_registry_current_idx
        on wm_aro_registry(aro_id)
        where current_state = 'current';
      create index if not exists wm_inbox_delivery_idx
        on wm_inbox(delivery_state, lease_expires_at);
      create index if not exists wm_settlements_project_idx
        on wm_settlements(project_id, created_at);
      create index if not exists wm_semantic_ingress_runs_state_idx
        on wm_semantic_ingress_runs(run_state, created_at);
      create index if not exists wm_semantic_settlement_revisions_event_idx
        on wm_semantic_settlement_revisions(
          semantic_event_id, settlement_revision
        );
      create index if not exists wm_semantic_history_relations_source_idx
        on wm_semantic_history_relations(
          source_semantic_event_id, settlement_revision
        );
      create index if not exists wm_semantic_history_relations_target_idx
        on wm_semantic_history_relations(
          target_kind, target_id, relation_kind
        );
      create index if not exists wm_semantic_history_relation_states_idx
        on wm_semantic_history_relation_states(
          relation_id, occurred_at
        );
      create index if not exists wm_semantic_shelves_current_idx
        on wm_semantic_shelves(
          current_state, shelf_kind, anchor_key
        );
      create index if not exists wm_semantic_artifacts_current_idx
        on wm_semantic_artifacts(
          current_state, artifact_kind, project_id, lifecycle
        );
      create unique index if not exists
        wm_semantic_artifacts_current_identity_idx
        on wm_semantic_artifacts(semantic_artifact_id)
        where current_state = 'current';
      create index if not exists wm_semantic_artifacts_source_idx
        on wm_semantic_artifacts(
          source_kind, source_key, current_state
        );
      create index if not exists
        wm_decision_transition_requests_decision_idx
        on wm_decision_transition_requests(
          decision_id, created_at
        );
      create index if not exists
        wm_decision_transition_receipts_current_idx
        on wm_decision_transition_receipts(
          decision_id, current_state, created_at
        );
      create index if not exists wm_semantic_children_parent_idx
        on wm_semantic_child_contracts(
          parent_semantic_event_id, child_index
        );
      create index if not exists wm_semantic_children_state_idx
        on wm_semantic_child_contracts(
          execution_state, updated_at
        );
      create index if not exists wm_semantic_split_state_idx
        on wm_semantic_split_coordinations(
          current_state, coordination_state, updated_at
        );
      create index if not exists wm_manager_contexts_project_idx
        on wm_manager_contexts(project_id, created_at);
      create index if not exists wm_agent_world_compilations_project_idx
        on wm_agent_world_compilations(project_id, created_at);
      create index if not exists wm_context_requirements_event_idx
        on wm_context_requirement_sets(
          semantic_event_id, agent_instantiation_id, current_state
        );
      create index if not exists wm_context_bundles_event_idx
        on wm_semantic_context_bundles(
          semantic_event_id, agent_instantiation_id, current_state
        );
      create index if not exists wm_operational_context_event_idx
        on wm_operational_meta_context_manifests(
          semantic_event_id, agent_instantiation_id, current_state
        );
      create index if not exists wm_context_request_links_event_idx
        on wm_context_request_manifest_links(
          semantic_event_id, agent_instantiation_id
        );
      create index if not exists wm_role_runs_source_idx
        on wm_role_runs(source_semantic_event_id, created_at);
      create index if not exists wm_agent_results_source_idx
        on wm_agent_results(source_semantic_event_id, created_at);
      create index if not exists wm_reconciliations_state_idx
        on wm_reconciliations(reconciliation_state, updated_at);
    `);
    this.setMetaDefault("schema", WORLD_MANAGER_CONTROL_PLANE_STORE_SCHEMA);
    if (this.meta("schema", "") !== WORLD_MANAGER_CONTROL_PLANE_STORE_SCHEMA) {
      fail("world_manager_control_plane_store_schema_mismatch");
    }
    this.setMetaDefault("control_plane_revision", "0");
    this.setMetaDefault("ledger_head_digest", "");
    this.setMetaDefault("focused_project_id", "");
  }

  setMetaDefault(key, value) {
    this.db.prepare(`
      insert into wm_meta (key, value) values (?, ?)
      on conflict(key) do nothing
    `).run(key, String(value));
  }

  meta(key, fallback = "") {
    this.ensureOpen();
    const row = this.db.prepare("select value from wm_meta where key = ?").get(key);
    return row ? String(row.value) : fallback;
  }

  setMeta(key, value) {
    this.db.prepare(`
      insert into wm_meta (key, value) values (?, ?)
      on conflict(key) do update set value = excluded.value
    `).run(key, String(value));
  }

  revision() {
    return Number(this.meta("control_plane_revision", "0")) || 0;
  }

  ledgerHeadDigest() {
    return this.meta("ledger_head_digest", "");
  }

  focusedProjectId() {
    return this.meta("focused_project_id", "");
  }

  incrementRevision() {
    const revision = this.revision() + 1;
    this.setMeta("control_plane_revision", String(revision));
    return revision;
  }

  transaction(action) {
    this.ensureOpen();
    this.db.exec("begin immediate");
    try {
      const result = action();
      this.db.exec("commit");
      return result;
    } catch (error) {
      try {
        this.db.exec("rollback");
      } catch {}
      throw error;
    }
  }

  currentBootstrap() {
    this.ensureOpen();
    const row = this.db.prepare(`
      select manifest_json
      from wm_bootstrap_manifests
      order by bootstrap_sequence desc
      limit 1
    `).get();
    if (!row) return null;
    const manifest = parseJson(row.manifest_json, null);
    validateWorldManagerBootstrapManifest(manifest);
    return manifest;
  }

  ensureBootstrap(input = {}) {
    return this.transaction(() => {
      const current = this.currentBootstrap();
      const next = buildWorldManagerBootstrapManifest({
        userWorldId: input.userWorldId,
        projects: input.projects,
        revision: current ? current.revision + 1 : 1,
      }, { now: this.now });
      if (
        current &&
        current.userWorld.userWorldId === next.userWorld.userWorldId &&
        current.configurationDigest === next.configurationDigest
      ) {
        return { manifest: current, changed: false, projectionRevision: this.revision() };
      }
      this.db.prepare(`
        insert into wm_bootstrap_manifests (
          bootstrap_id,
          revision,
          configuration_digest,
          manifest_digest,
          manifest_json,
          created_at
        ) values (?, ?, ?, ?, ?, ?)
      `).run(
        next.bootstrapId,
        next.revision,
        next.configurationDigest,
        next.manifestDigest,
        json(next),
        next.createdAt,
      );
      const projectionRevision = this.incrementRevision();
      return { manifest: next, changed: true, projectionRevision };
    });
  }

  recordWorldmodelBinding(binding) {
    if (
      !binding ||
      binding.schema !== "direct_world_manager_graph_binding@1" ||
      !binding.bindingId ||
      !binding.bootstrapRef?.id ||
      !binding.graphRef?.id ||
      !binding.graphRef?.digest ||
      !binding.digest ||
      binding.grantsAuthority !== false ||
      binding.rawGraphBodyIncluded !== false
    ) {
      fail("world_manager_worldmodel_binding_invalid");
    }
    return this.transaction(() => {
      const existing = this.db.prepare(`
        select binding_json
        from wm_worldmodel_bindings
        where binding_id = ?
      `).get(binding.bindingId);
      if (existing) {
        const stored = parseJson(existing.binding_json, null);
        if (stored?.digest !== binding.digest) {
          fail("world_manager_worldmodel_binding_conflict", binding.bindingId);
        }
        return { binding: stored, changed: false, projectionRevision: this.revision() };
      }
      this.db.prepare(`
        insert into wm_worldmodel_bindings (
          binding_id,
          bootstrap_id,
          configuration_digest,
          graph_id,
          graph_digest,
          binding_state,
          binding_json,
          created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        binding.bindingId,
        binding.bootstrapRef.id,
        binding.configurationDigest,
        binding.graphRef.id,
        binding.graphRef.digest,
        binding.state,
        json(binding),
        nowIso(this.now),
      );
      return {
        binding,
        changed: true,
        projectionRevision: this.incrementRevision(),
      };
    });
  }

  currentWorldmodelBinding() {
    const row = this.db.prepare(`
      select binding_json
      from wm_worldmodel_bindings
      order by rowid desc
      limit 1
    `).get();
    return row ? parseJson(row.binding_json, null) : null;
  }

  setFocusedProject(projectId, expectedProjectionRevision = null) {
    const id = normalizeString(projectId, "");
    const bootstrap = this.currentBootstrap();
    if (!bootstrap) fail("world_manager_bootstrap_missing");
    if (
      expectedProjectionRevision !== null &&
      typeof expectedProjectionRevision !== "undefined" &&
      Number.isInteger(Number(expectedProjectionRevision)) &&
      Number(expectedProjectionRevision) >= 0 &&
      Number(expectedProjectionRevision) !== this.revision()
    ) {
      fail(
        "world_manager_projection_revision_conflict",
        `${expectedProjectionRevision}:${this.revision()}`,
      );
    }
    if (!bootstrap.projects.some((project) => project.projectId === id)) {
      fail("world_manager_project_scope_unknown", id);
    }
    if (this.focusedProjectId() === id) {
      return { projectId: id, changed: false, projectionRevision: this.revision() };
    }
    return this.transaction(() => {
      this.setMeta("focused_project_id", id);
      return {
        projectId: id,
        changed: true,
        projectionRevision: this.incrementRevision(),
      };
    });
  }

  eventByClientRequestId(clientRequestId) {
    const id = normalizeString(clientRequestId, "");
    if (!id) return null;
    const row = this.db.prepare(`
      select event_json
      from wm_events
      where client_request_id = ?
    `).get(id);
    if (!row) return null;
    const event = parseJson(row.event_json, null);
    validateWorldManagerSemanticEvent(event);
    return event;
  }

  eventBySemanticEventId(semanticEventId) {
    const id = normalizeString(semanticEventId, "");
    if (!id) return null;
    const row = this.db.prepare(`
      select event_json
      from wm_events
      where semantic_event_id = ?
    `).get(id);
    if (!row) return null;
    const event = parseJson(row.event_json, null);
    validateWorldManagerSemanticEvent(event);
    return event;
  }

  messageForEvent(semanticEventId) {
    const row = this.db.prepare(`
      select message_json
      from wm_messages
      where semantic_event_id = ?
    `).get(semanticEventId);
    if (!row) return null;
    const message = parseJson(row.message_json, null);
    validateWorldManagerMessage(message);
    return message;
  }

  appendDerivedEventWithinTransaction(input = {}) {
    const lastRow = this.db.prepare(`
      select sequence, event_digest
      from wm_events
      order by sequence desc
      limit 1
    `).get();
    const sequence = Number(lastRow?.sequence || 0) + 1;
    const previousEventDigest = normalizeString(lastRow?.event_digest, "");
    const event = buildWorldManagerSemanticEvent({
      semanticEventId: input.semanticEventId,
      lineageRootId: input.lineageRootId,
      sequence,
      clientRequestId: input.clientRequestId,
      clientRequestDigest: input.clientRequestDigest,
      eventKind: input.eventKind,
      presentationState: input.presentationState,
      epistemicState: input.epistemicState,
      authorityState: normalizeString(
        input.authorityState,
        "non_authoritative",
      ),
      actorKind: "harness",
      actorRole: input.actorRole,
      projectId: input.projectId,
      taskType: input.taskType,
      parentSemanticEventIds: input.parentSemanticEventIds,
      artifactRefs: input.artifactRefs,
      sourceScopeRevisions: input.sourceScopeRevisions,
      rendererSafeSummary: input.rendererSafeSummary,
      previousEventDigest,
      occurredAt: input.occurredAt,
    }, { now: this.now });
    this.db.prepare(`
      insert into wm_events (
        semantic_event_id,
        sequence,
        lineage_root_id,
        client_request_id,
        client_request_digest,
        event_kind,
        presentation_state,
        actor_role,
        project_id,
        parent_event_ids_json,
        artifact_refs_json,
        previous_ledger_digest,
        event_digest,
        event_json,
        occurred_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.semanticEventId,
      event.sequence,
      event.lineageRootId,
      event.clientRequestId,
      event.clientRequestDigest,
      event.eventKind,
      event.presentationState,
      event.actorRole,
      event.projectId,
      json(event.parentSemanticEventIds),
      json(event.artifactRefs),
      event.previousEventDigest,
      event.eventDigest,
      json(event),
      event.occurredAt,
    );
    this.setMeta("ledger_head_digest", event.eventDigest);
    return event;
  }

  appendUserIngress(input = {}) {
    const request = normalizeWorldManagerSubmitRequest(input);
    return this.transaction(() => {
      const existingRow = this.db.prepare(`
        select client_request_digest, event_json
        from wm_events
        where client_request_id = ?
      `).get(request.clientRequestId);
      if (existingRow) {
        const event = parseJson(existingRow.event_json, null);
        validateWorldManagerSemanticEvent(event);
        const legacyDigest = digestFor(
          "direct_world_manager_submit_request@1",
          {
            ...request,
            expectedProjectionRevision: event.expectedProjectionRevision,
          },
          ["requestDigest"],
        );
        if (
          String(existingRow.client_request_digest) !== request.requestDigest &&
          String(existingRow.client_request_digest) !== legacyDigest
        ) {
          fail("world_manager_submit_idempotency_conflict", request.clientRequestId);
        }
        const message = this.messageForEvent(event.semanticEventId);
        if (!message) fail("world_manager_control_plane_message_missing", event.semanticEventId);
        return {
          accepted: true,
          reused: true,
          event,
          message,
          projectionRevision: this.revision(),
        };
      }

      const bootstrap = this.currentBootstrap();
      if (!bootstrap) fail("world_manager_bootstrap_missing");
      const projectId = normalizeString(
        request.scopeHint.projectId,
        this.focusedProjectId() || bootstrap.projects[0]?.projectId || "",
      );
      if (!bootstrap.projects.some((project) => project.projectId === projectId)) {
        fail("world_manager_project_scope_unknown", projectId);
      }

      const lastRow = this.db.prepare(`
        select sequence, event_digest
        from wm_events
        order by sequence desc
        limit 1
      `).get();
      const sequence = Number(lastRow?.sequence || 0) + 1;
      const previousEventDigest = normalizeString(lastRow?.event_digest, "");
      const semanticEventId = stableId("wm_event", {
        clientRequestId: request.clientRequestId,
        requestDigest: request.requestDigest,
      });
      const lineageRootId = semanticEventId;
      const messageId = stableId("wm_message", { semanticEventId });
      const occurredAt = nowIso(this.now);
      const message = buildWorldManagerMessage({
        messageId,
        semanticEventId,
        clientRequestId: request.clientRequestId,
        projectId,
        text: request.text,
        createdAt: occurredAt,
      }, { now: this.now });
      const messageRef = {
        kind: "world_manager_message",
        id: message.messageId,
        digest: message.messageDigest,
        label: "User keyboard ingress",
        rawTextIncluded: false,
        rawPathIncluded: false,
        rawSecretIncluded: false,
      };
      const event = buildWorldManagerSemanticEvent({
        semanticEventId,
        lineageRootId,
        sequence,
        clientRequestId: request.clientRequestId,
        clientRequestDigest: request.requestDigest,
        projectId,
        artifactRefs: [messageRef, ...request.attachmentDraftRefs],
        sourceScopeRevisions: [{
          scopeKind: "bootstrap",
          scopeId: bootstrap.bootstrapId,
          revision: bootstrap.revision,
          digest: bootstrap.manifestDigest,
        }],
        expectedProjectionRevision: request.expectedProjectionRevision,
        rendererSafeSummary: request.text,
        previousEventDigest,
        occurredAt,
      }, { now: this.now });

      this.db.prepare(`
        insert into wm_events (
          semantic_event_id,
          sequence,
          lineage_root_id,
          client_request_id,
          client_request_digest,
          event_kind,
          presentation_state,
          actor_role,
          project_id,
          parent_event_ids_json,
          artifact_refs_json,
          previous_ledger_digest,
          event_digest,
          event_json,
          occurred_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        event.semanticEventId,
        event.sequence,
        event.lineageRootId,
        event.clientRequestId,
        event.clientRequestDigest,
        event.eventKind,
        event.presentationState,
        event.actorRole,
        event.projectId,
        json(event.parentSemanticEventIds),
        json(event.artifactRefs),
        event.previousEventDigest,
        event.eventDigest,
        json(event),
        event.occurredAt,
      );
      this.db.prepare(`
        insert into wm_messages (
          message_id,
          semantic_event_id,
          client_request_id,
          author_role,
          project_id,
          message_text,
          presentation_state,
          message_digest,
          message_json,
          created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        message.messageId,
        message.semanticEventId,
        message.clientRequestId,
        message.authorRole,
        message.projectId,
        message.text,
        message.presentationState,
        message.messageDigest,
        json(message),
        message.createdAt,
      );
      this.setMeta("ledger_head_digest", event.eventDigest);
      const projectionRevision = this.incrementRevision();
      return {
        accepted: true,
        reused: false,
        event,
        message,
        projectionRevision,
      };
    });
  }

  settlementForSemanticEvent(semanticEventId) {
    const row = this.db.prepare(`
      select
        settlement_json,
        ingress_json,
        target_resolution_json
      from wm_settlements
      where semantic_event_id = ?
    `).get(semanticEventId);
    if (!row) return null;
    const taskSettlement = parseJson(row.settlement_json, null);
    const ingressEnvelope = parseJson(row.ingress_json, null);
    const targetResolution = parseJson(row.target_resolution_json, null);
    validateWorldManagerTaskSettlement(taskSettlement);
    return {
      taskSettlement,
      ingressEnvelope,
      targetResolution,
      semanticIngressRun:
        this.semanticIngressForSemanticEvent(semanticEventId),
    };
  }

  semanticIngressForSemanticEvent(semanticEventId) {
    const row = this.db.prepare(`
      select run_json
      from wm_semantic_ingress_runs
      where semantic_event_id = ?
    `).get(semanticEventId);
    if (!row) return null;
    const run = parseJson(row.run_json, null);
    validateSemanticIngressRun(run);
    return run;
  }

  semanticSettlementRevisionForEvent(
    semanticEventId,
    options = {},
  ) {
    const id = normalizeString(semanticEventId, "");
    if (!id) return null;
    const currentOnly = options.currentOnly !== false;
    const row = this.db.prepare(`
      select revision_json, current_state
      from wm_semantic_settlement_revisions
      where semantic_event_id = ?
        ${currentOnly ? "and current_state = 'current'" : ""}
      order by settlement_revision desc
      limit 1
    `).get(id);
    if (!row) return null;
    const revision = parseJson(row.revision_json, null);
    validateSemanticSettlementRevision(revision);
    return {
      ...revision,
      currentState: String(row.current_state),
    };
  }

  listSemanticSettlementRevisions(options = {}) {
    const limit =
      Number.isInteger(Number(options.limit)) &&
      Number(options.limit) > 0
        ? Math.min(5000, Number(options.limit))
        : 1000;
    const currentOnly = options.currentOnly === true;
    return this.db.prepare(`
      select revision_json, current_state
      from wm_semantic_settlement_revisions
      ${currentOnly ? "where current_state = 'current'" : ""}
      order by rowid desc
      limit ?
    `).all(limit).reverse().map((row) => {
      const revision = parseJson(row.revision_json, null);
      validateSemanticSettlementRevision(revision);
      return {
        ...revision,
        currentState: String(row.current_state),
      };
    });
  }

  _semanticHistoryRelationRows(options = {}) {
    const where = [];
    const values = [];
    if (normalizeString(options.semanticEventId, "")) {
      where.push("r.source_semantic_event_id = ?");
      values.push(options.semanticEventId);
    }
    if (normalizeString(options.relationKind, "")) {
      where.push("r.relation_kind = ?");
      values.push(options.relationKind);
    }
    if (normalizeString(options.targetKind, "")) {
      where.push("r.target_kind = ?");
      values.push(options.targetKind);
    }
    if (normalizeString(options.targetId, "")) {
      where.push("r.target_id = ?");
      values.push(options.targetId);
    }
    if (normalizeString(options.lifecycle, "")) {
      where.push(`
        (
          select s.lifecycle
          from wm_semantic_history_relation_states s
          where s.relation_id = r.relation_id
          order by s.rowid desc
          limit 1
        ) = ?
      `);
      values.push(options.lifecycle);
    }
    const limit =
      Number.isInteger(Number(options.limit)) &&
      Number(options.limit) > 0
        ? Math.min(10000, Number(options.limit))
        : 5000;
    values.push(limit);
    return this.db.prepare(`
      select
        r.relation_json,
        (
          select s.state_json
          from wm_semantic_history_relation_states s
          where s.relation_id = r.relation_id
          order by s.rowid desc
          limit 1
        ) as current_state_json
      from wm_semantic_history_relations r
      ${where.length ? `where ${where.join(" and ")}` : ""}
      order by r.rowid asc
      limit ?
    `).all(...values);
  }

  listSemanticHistoryRelations(options = {}) {
    return this._semanticHistoryRelationRows(options)
      .map((row) => {
        const relation = parseJson(row.relation_json, null);
        const currentState = parseJson(
          row.current_state_json,
          null,
        );
        validateSemanticHistoryRelation(relation);
        validateRelationState(currentState);
        return {
          relation,
          currentState,
        };
      });
  }

  listActiveSemanticHistoryRelations(options = {}) {
    return this.listSemanticHistoryRelations({
      ...options,
      lifecycle: "active",
    }).map((record) => record.relation);
  }

  listSemanticShelves(options = {}) {
    const where = [];
    const values = [];
    if (options.currentOnly !== false) {
      where.push("current_state = 'current'");
    }
    if (normalizeString(options.shelfKind, "")) {
      where.push("shelf_kind = ?");
      values.push(options.shelfKind);
    }
    if (normalizeString(options.anchorKey, "")) {
      where.push("anchor_key = ?");
      values.push(options.anchorKey);
    }
    const limit =
      Number.isInteger(Number(options.limit)) &&
      Number(options.limit) > 0
        ? Math.min(5000, Number(options.limit))
        : 1000;
    values.push(limit);
    return this.db.prepare(`
      select shelf_json, current_state
      from wm_semantic_shelves
      ${where.length ? `where ${where.join(" and ")}` : ""}
      order by rowid asc
      limit ?
    `).all(...values).map((row) => {
      const shelf = parseJson(row.shelf_json, null);
      validateSemanticShelf(shelf);
      return {
        ...shelf,
        currentState: String(row.current_state),
      };
    });
  }

  semanticShelf(shelfKind, anchorKind, anchorId) {
    const anchorKey = [
      normalizeString(anchorKind, ""),
      normalizeString(anchorId, ""),
    ].join(":");
    return this.listSemanticShelves({
      shelfKind,
      anchorKey,
      currentOnly: true,
      limit: 1,
    })[0] || null;
  }

  semanticHistoryEventsForShelf(
    shelfKind,
    anchorKind,
    anchorId,
    options = {},
  ) {
    const shelf = this.semanticShelf(
      shelfKind,
      anchorKind,
      anchorId,
    );
    if (!shelf) return { shelf: null, entries: [] };
    const eventIds = shelf.sourceEventRefs.map((ref) => ref.id);
    const limit =
      Number.isInteger(Number(options.limit)) &&
      Number(options.limit) > 0
        ? Math.min(100, Number(options.limit))
        : 12;
    const beforeSequence =
      Number.isInteger(Number(options.beforeSequence)) &&
      Number(options.beforeSequence) > 0
        ? Number(options.beforeSequence)
        : Number.MAX_SAFE_INTEGER;
    const entries = eventIds.map((semanticEventId) => {
      const event = this.eventBySemanticEventId(semanticEventId);
      if (!event || event.sequence >= beforeSequence) return null;
      const message = this.messageForEvent(semanticEventId);
      const settlementRevision =
        this.semanticSettlementRevisionForEvent(
          semanticEventId,
        );
      const taskSettlement =
        this.settlementForSemanticEvent(
          semanticEventId,
        )?.taskSettlement || null;
      const relations = this.listSemanticHistoryRelations({
        semanticEventId,
        lifecycle: "active",
      }).map((record) => record.relation);
      return {
        event,
        message,
        settlementRevision,
        taskSettlement,
        relations,
      };
    }).filter(Boolean).sort((left, right) =>
      left.event.sequence - right.event.sequence);
    return {
      shelf,
      entries: entries.slice(-limit),
    };
  }

  _insertSemanticHistoryRelationWithinTransaction(
    relation,
    lifecycle = relation.lifecycle,
  ) {
    validateSemanticHistoryRelation(relation);
    const existing = this.db.prepare(`
      select relation_digest
      from wm_semantic_history_relations
      where relation_id = ?
    `).get(relation.relationId);
    if (existing) {
      if (
        String(existing.relation_digest) !== relation.digest
      ) {
        fail(
          "semantic_history_relation_idempotency_conflict",
          relation.relationId,
        );
      }
      return false;
    }
    this.db.prepare(`
      insert into wm_semantic_history_relations (
        relation_id,
        source_semantic_event_id,
        settlement_revision,
        relation_kind,
        target_kind,
        target_id,
        posture,
        durability,
        confidence,
        initial_lifecycle,
        relation_json,
        relation_digest,
        created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      relation.relationId,
      relation.sourceEventRef.id,
      relation.settlementRevision,
      relation.relationKind,
      relation.targetRef.kind,
      relation.targetRef.id,
      relation.posture,
      relation.durability,
      relation.confidence,
      relation.lifecycle,
      json(relation),
      relation.digest,
      relation.createdAt,
    );
    const state = buildRelationState({
      relation,
      lifecycle,
      occurredAt: relation.createdAt,
    });
    this.db.prepare(`
      insert into wm_semantic_history_relation_states (
        relation_state_id,
        relation_id,
        lifecycle,
        state_json,
        state_digest,
        occurred_at
      ) values (?, ?, ?, ?, ?, ?)
    `).run(
      state.relationStateId,
      relation.relationId,
      state.lifecycle,
      json(state),
      state.digest,
      state.occurredAt,
    );
    return true;
  }

  _transitionSemanticHistoryRelationWithinTransaction(
    relation,
    lifecycle,
    transitionRef,
    occurredAt,
  ) {
    validateSemanticHistoryRelation(relation);
    const latest = this.db.prepare(`
      select state_json
      from wm_semantic_history_relation_states
      where relation_id = ?
      order by rowid desc
      limit 1
    `).get(relation.relationId);
    const latestState = parseJson(
      latest?.state_json,
      null,
    );
    if (latestState) validateRelationState(latestState);
    if (latestState?.lifecycle === lifecycle) return false;
    const state = buildRelationState({
      relation,
      lifecycle,
      transitionRef,
      occurredAt,
    });
    this.db.prepare(`
      insert into wm_semantic_history_relation_states (
        relation_state_id,
        relation_id,
        lifecycle,
        state_json,
        state_digest,
        occurred_at
      ) values (?, ?, ?, ?, ?, ?)
    `).run(
      state.relationStateId,
      relation.relationId,
      state.lifecycle,
      json(state),
      state.digest,
      state.occurredAt,
    );
    return true;
  }

  _recordSemanticSettlementRevisionWithinTransaction(
    input = {},
  ) {
    const semanticSettlement = input.semanticSettlement;
    validateSettlementEvidence(semanticSettlement);
    const sourceEvent = input.sourceEvent ||
      this.eventBySemanticEventId(
        semanticSettlement.semanticEventId,
      );
    if (
      !sourceEvent ||
      sourceEvent.semanticEventId !==
        semanticSettlement.semanticEventId
    ) {
      fail("semantic_history_settlement_source_missing");
    }
    const current =
      this.semanticSettlementRevisionForEvent(
        sourceEvent.semanticEventId,
      );
    if (
      current?.semanticSettlement?.digest ===
        semanticSettlement.digest
    ) {
      return {
        changed: false,
        revision: current,
        relations:
          this.listActiveSemanticHistoryRelations({
            semanticEventId:
              sourceEvent.semanticEventId,
          }),
      };
    }
    const settlementRevision =
      Number(current?.settlementRevision || 0) + 1;
    const revision = buildSemanticSettlementRevision({
      semanticSettlement,
      settlementRevision,
      provenancePosture:
        input.provenancePosture,
      confidence: input.confidence,
      supersedesRevisionRef: current
        ? sourceRef(
            "semantic_settlement_revision",
            current.settlementRevisionId,
            current.digest,
            `Settlement revision ${current.settlementRevision}`,
          )
        : null,
      correctionReasonRefs:
        input.correctionReasonRefs,
      compilerVersion: input.compilerVersion,
      createdAt: input.createdAt,
      now: this.now,
    });
    if (current) {
      this.db.prepare(`
        update wm_semantic_settlement_revisions
        set current_state = 'superseded'
        where settlement_revision_id = ?
      `).run(current.settlementRevisionId);
    }
    this.db.prepare(`
      insert into wm_semantic_settlement_revisions (
        settlement_revision_id,
        semantic_event_id,
        settlement_revision,
        semantic_settlement_id,
        semantic_settlement_digest,
        provenance_posture,
        confidence,
        current_state,
        revision_json,
        revision_digest,
        created_at
      ) values (?, ?, ?, ?, ?, ?, ?, 'current', ?, ?, ?)
    `).run(
      revision.settlementRevisionId,
      revision.semanticEventId,
      revision.settlementRevision,
      revision.semanticSettlementRef.id,
      revision.semanticSettlementRef.digest,
      revision.provenancePosture,
      revision.confidence,
      json(revision),
      revision.digest,
      revision.createdAt,
    );
    const revisionRef = sourceRef(
      "semantic_settlement_revision",
      revision.settlementRevisionId,
      revision.digest,
      `Settlement revision ${revision.settlementRevision}`,
    );
    if (current) {
      for (
        const relation of
          this.listActiveSemanticHistoryRelations({
            semanticEventId:
              sourceEvent.semanticEventId,
          })
      ) {
        this._transitionSemanticHistoryRelationWithinTransaction(
          relation,
          "superseded",
          revisionRef,
          revision.createdAt,
        );
      }
    }
    const relations = buildSemanticHistoryRelations({
      sourceEvent,
      settlementRevision: revision,
      userWorldId:
        this.currentBootstrap()?.userWorld
          ?.userWorldId || "user_world_local",
    });
    for (const relation of relations) {
      this._insertSemanticHistoryRelationWithinTransaction(
        relation,
        relation.lifecycle,
      );
    }
    return {
      changed: true,
      revision,
      relations,
    };
  }

  _currentSemanticArtifactWithinTransaction(
    semanticArtifactId,
  ) {
    const row = this.db.prepare(`
      select artifact_json
      from wm_semantic_artifacts
      where semantic_artifact_id = ?
        and current_state = 'current'
      order by artifact_revision desc
      limit 1
    `).get(normalizeString(semanticArtifactId, ""));
    if (!row) return null;
    const artifact = parseJson(row.artifact_json, null);
    if (artifact?.schema !== OPEN_DECISION_SCHEMA) {
      fail("semantic_artifact_schema_unsupported");
    }
    validateOpenDecision(artifact);
    return artifact;
  }

  _appendSemanticArtifactRevisionWithinTransaction(
    artifact,
  ) {
    validateOpenDecision(artifact);
    const current =
      this._currentSemanticArtifactWithinTransaction(
        artifact.decisionId,
      );
    if (current?.digest === artifact.digest) {
      return {
        changed: false,
        artifact: current,
      };
    }
    if (current) {
      validateOpenDecisionRevision(current, artifact);
      this.db.prepare(`
        update wm_semantic_artifacts
        set current_state = 'superseded'
        where semantic_artifact_id = ?
          and current_state = 'current'
      `).run(artifact.decisionId);
    } else if (
      artifact.header.revision !== 1 ||
      artifact.header.predecessorRef
    ) {
      fail("semantic_artifact_initial_revision_invalid");
    }
    this.db.prepare(`
      insert into wm_semantic_artifacts (
        semantic_artifact_record_id,
        semantic_artifact_id,
        artifact_kind,
        scope_kind,
        project_id,
        artifact_revision,
        lifecycle,
        current_state,
        source_kind,
        source_key,
        source_state_digest,
        artifact_json,
        artifact_digest,
        created_at
      ) values (?, ?, ?, ?, ?, ?, ?, 'current', ?, ?, ?, ?, ?, ?)
    `).run(
      stableId("wm_semantic_artifact_record", {
        semanticArtifactId:
          artifact.header.semanticArtifactId,
        revision: artifact.header.revision,
        digest: artifact.digest,
      }),
      artifact.header.semanticArtifactId,
      artifact.header.artifactKind,
      artifact.header.scope.kind,
      artifact.header.scope.projectId,
      artifact.header.revision,
      artifact.header.lifecycle,
      artifact.sourceKind,
      artifact.sourceKey,
      artifact.sourceStateDigest,
      json(artifact),
      artifact.digest,
      artifact.header.createdAt,
    );
    return {
      changed: true,
      artifact,
    };
  }

  _semanticDecisionInputsWithinTransaction() {
    const inputs = [];
    for (const candidate of this.listCandidateArtifacts()) {
      if (
        candidate?.schema !==
          "direct_project_constitution_candidate@1"
      ) {
        continue;
      }
      for (
        let index = 0;
        index < (candidate.openDecisions || []).length;
        index += 1
      ) {
        inputs.push(
          openDecisionInputFromProjectCandidate(
            candidate,
            candidate.openDecisions[index],
            index,
          ),
        );
      }
    }
    for (const decision of this.listDecisionRequests()) {
      inputs.push(
        openDecisionInputFromLegacyDecision({
          ...decision,
          userWorldId:
            this.currentBootstrap()?.userWorld
              ?.userWorldId ||
            "user_world_local",
        }),
      );
    }
    return inputs;
  }

  _synchronizeSemanticDecisionKernelWithinTransaction() {
    let changed = 0;
    let reused = 0;
    const artifacts = [];
    for (
      const input of
        this._semanticDecisionInputsWithinTransaction()
    ) {
      const current =
        this._currentSemanticArtifactWithinTransaction(
          input.decisionId,
        );
      if (
        current &&
        current.sourceStateDigest ===
          input.sourceStateDigest &&
        current.resolutionContract
          ?.transitionAvailability ===
            "available_wm_sc5"
      ) {
        reused += 1;
        artifacts.push(current);
        continue;
      }
      const artifact = current
        ? reviseOpenDecision(current, {
            decisionKind: input.decisionKind,
            question: input.question,
            description: input.description,
            resolutionMode: input.resolutionMode,
            options: input.options,
            dependencies: input.dependencies,
            consequences: input.consequences,
            resolutionContract:
              input.resolutionContract,
            decisionState: input.decisionState,
            resolutionRef: input.resolutionRef,
            sourceKind: input.sourceKind,
            sourceKey: input.sourceKey,
            sourceStateDigest:
              input.sourceStateDigest,
            semanticIdentity:
              input.semanticIdentity,
            scope: input.scope,
            ownerRole: input.ownerRole,
            semanticAuthorRole:
              input.semanticAuthorRole,
            epistemicPosture:
              input.epistemicPosture,
            provenanceRefs:
              input.provenanceRefs,
            createdAt: nowIso(this.now),
          })
        : buildOpenDecision({
            ...input,
            revision: 1,
            now: this.now,
          });
      const appended =
        this._appendSemanticArtifactRevisionWithinTransaction(
          artifact,
        );
      if (appended.changed) changed += 1;
      else reused += 1;
      artifacts.push(appended.artifact);
    }
    return {
      changed,
      reused,
      artifactCount: artifacts.length,
      artifacts,
    };
  }

  synchronizeSemanticDecisionKernel() {
    return this.transaction(() => {
      const synchronization =
        this._synchronizeSemanticDecisionKernelWithinTransaction();
      let rebuiltSemanticShelfCount =
        this._rebuildSemanticShelvesWithinTransaction();
      const projectionRevision =
        synchronization.changed ||
        rebuiltSemanticShelfCount
          ? this.incrementRevision()
          : this.revision();
      return {
        ...synchronization,
        rebuiltSemanticShelfCount,
        projectionRevision,
      };
    });
  }

  _appendDecisionTransitionReceiptWithinTransaction(
    request,
    receipt,
  ) {
    validateDecisionTransitionRequest(request);
    validateDecisionTransitionReceipt(receipt);
    const current = this.db.prepare(`
      select receipt_json
      from wm_decision_transition_receipts
      where decision_transition_request_id = ?
        and current_state = 'current'
      order by receipt_revision desc
      limit 1
    `).get(request.decisionTransitionRequestId);
    const currentReceipt = current
      ? parseJson(current.receipt_json, null)
      : null;
    if (currentReceipt) {
      validateDecisionTransitionReceipt(
        currentReceipt,
      );
      if (
        receipt.receiptRevision !==
          currentReceipt.receiptRevision + 1 ||
        receipt.predecessorReceiptRef?.id !==
          currentReceipt
            .decisionTransitionReceiptId ||
        receipt.predecessorReceiptRef?.digest !==
          currentReceipt.digest
      ) {
        fail(
          "decision_transition_receipt_revision_conflict",
        );
      }
      this.db.prepare(`
        update wm_decision_transition_receipts
        set current_state = 'superseded'
        where decision_transition_request_id = ?
          and current_state = 'current'
      `).run(request.decisionTransitionRequestId);
    } else if (
      receipt.receiptRevision !== 1 ||
      receipt.predecessorReceiptRef
    ) {
      fail(
        "decision_transition_receipt_initial_revision_invalid",
      );
    }
    this.db.prepare(`
      insert into wm_decision_transition_receipts (
        decision_transition_receipt_record_id,
        decision_transition_receipt_id,
        decision_transition_request_id,
        decision_id,
        receipt_revision,
        receipt_state,
        current_state,
        receipt_json,
        receipt_digest,
        created_at
      ) values (?, ?, ?, ?, ?, ?, 'current', ?, ?, ?)
    `).run(
      stableId(
        "wm_decision_transition_receipt_record",
        {
          receiptId:
            receipt.decisionTransitionReceiptId,
          revision: receipt.receiptRevision,
          digest: receipt.digest,
        },
      ),
      receipt.decisionTransitionReceiptId,
      request.decisionTransitionRequestId,
      request.decisionRef.id,
      receipt.receiptRevision,
      receipt.state,
      json(receipt),
      receipt.digest,
      receipt.createdAt,
    );
    return receipt;
  }

  _invalidateSemanticContextCachesWithinTransaction() {
    const bundleResult = this.db.prepare(`
      update wm_semantic_context_bundles
      set current_state = 'stale'
      where current_state = 'current'
    `).run();
    const manifestResult = this.db.prepare(`
      update wm_operational_meta_context_manifests
      set current_state = 'stale'
      where current_state = 'current'
    `).run();
    return {
      invalidatedSemanticContextBundleCount:
        Number(bundleResult.changes || 0),
      invalidatedOperationalMetaContextCount:
        Number(manifestResult.changes || 0),
    };
  }

  transitionSemanticDecision(input = {}) {
    return this.transaction(() => {
      const clientRequestId = normalizeString(
        input.clientRequestId ||
          input.idempotencyKey,
        "",
      );
      if (!clientRequestId) {
        fail(
          "decision_transition_idempotency_key_required",
        );
      }
      const existing = this.db.prepare(`
        select request_json
        from wm_decision_transition_requests
        where client_request_id = ?
        limit 1
      `).get(clientRequestId);
      if (existing) {
        const request = parseJson(
          existing.request_json,
          null,
        );
        validateDecisionTransitionRequest(request);
        if (
          request.idempotencyDigest !==
            decisionTransitionIdempotencyDigest(input)
        ) {
          fail(
            "decision_transition_idempotency_conflict",
          );
        }
        const transition =
          this.decisionTransition(
            request.decisionTransitionRequestId,
          );
        return {
          ...transition,
          reused: true,
          projectionRevision: this.revision(),
        };
      }
      const expectedProjectionRevision =
        input.expectedProjectionRevision !==
          null &&
        input.expectedProjectionRevision !==
          undefined &&
        Number.isInteger(
          Number(input.expectedProjectionRevision),
        )
          ? Number(input.expectedProjectionRevision)
          : null;
      if (
        expectedProjectionRevision !== null &&
        expectedProjectionRevision !== this.revision()
      ) {
        fail(
          "world_manager_projection_revision_conflict",
        );
      }
      const decision =
        this._currentSemanticArtifactWithinTransaction(
          normalizeString(
            input.decisionId ||
              input.decisionRef?.id,
            "",
          ),
        );
      if (!decision) {
        fail("decision_transition_target_missing");
      }
      const request =
        buildDecisionTransitionRequest(
          input,
          decision,
          { now: this.now },
        );
      this.db.prepare(`
        insert into wm_decision_transition_requests (
          decision_transition_request_id,
          client_request_id,
          decision_id,
          transition_kind,
          idempotency_digest,
          request_json,
          request_digest,
          created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        request.decisionTransitionRequestId,
        request.clientRequestId,
        decision.decisionId,
        request.transitionKind,
        request.idempotencyDigest,
        json(request),
        request.digest,
        request.createdAt,
      );

      let transitionArtifact = null;
      let historyRelation = null;
      let currentDecision = decision;
      let cacheInvalidation = {
        invalidatedSemanticContextBundleCount: 0,
        invalidatedOperationalMetaContextCount: 0,
      };
      let rebuiltSemanticShelfCount = 0;
      let receipt;

      const blockedDependencies =
        request.transitionKind ===
          "resolve_option"
          ? decision.dependencies.filter(
              (dependency) =>
                dependency.blocking &&
                dependency.state !== "satisfied",
            )
          : [];
      if (blockedDependencies.length) {
        receipt = buildDecisionTransitionReceipt(
          {
            request,
            state: "blocked",
            priorDecisionRef:
              semanticArtifactRef(decision),
            summary:
              "The option was not resolved because one or more binding dependencies remain unsatisfied.",
            blockedDependencyRefs:
              blockedDependencies.map(
                (dependency) => ({
                  kind:
                    "decision_dependency",
                  id:
                    dependency.dependencyId,
                  digest: dependency.digest,
                }),
              ),
          },
          { now: this.now },
        );
      } else {
        transitionArtifact =
          request.transitionKind ===
            "resolve_option"
            ? buildDecisionMechanicalResolution(
                request,
                decision,
                { now: this.now },
              )
            : buildDecisionSemanticRelayEnvelope(
                request,
                decision,
                { now: this.now },
              );
        const artifactRef =
          decisionTransitionArtifactRef(
            transitionArtifact,
          );
        historyRelation =
          buildDecisionResolutionHistoryRelation(
            request,
            decision,
            artifactRef,
            { now: this.now },
          );
        this.db.prepare(`
          insert into wm_decision_transition_artifacts (
            transition_artifact_id,
            decision_transition_request_id,
            decision_id,
            artifact_kind,
            artifact_json,
            artifact_digest,
            created_at
          ) values (?, ?, ?, ?, ?, ?, ?)
        `).run(
          artifactRef.id,
          request.decisionTransitionRequestId,
          decision.decisionId,
          artifactRef.kind,
          json(transitionArtifact),
          transitionArtifact.digest,
          transitionArtifact.createdAt,
        );
        this.db.prepare(`
          insert into wm_decision_resolution_relations (
            decision_resolution_relation_id,
            decision_transition_request_id,
            decision_id,
            relation_kind,
            relation_json,
            relation_digest,
            created_at
          ) values (?, ?, ?, ?, ?, ?, ?)
        `).run(
          historyRelation
            .decisionResolutionHistoryRelationId,
          request.decisionTransitionRequestId,
          decision.decisionId,
          historyRelation.relationKind,
          json(historyRelation),
          historyRelation.digest,
          historyRelation.createdAt,
        );

        if (
          request.transitionKind ===
            "resolve_option"
        ) {
          currentDecision = reviseOpenDecision(
            decision,
            {
              decisionState: "resolved",
              resolutionRef: artifactRef,
              createdAt: nowIso(this.now),
            },
          );
          this._appendSemanticArtifactRevisionWithinTransaction(
            currentDecision,
          );
          rebuiltSemanticShelfCount =
            this._rebuildSemanticShelvesWithinTransaction();
          cacheInvalidation =
            this._invalidateSemanticContextCachesWithinTransaction();
          receipt =
            buildDecisionTransitionReceipt(
              {
                request,
                state: "resolved",
                priorDecisionRef:
                  semanticArtifactRef(decision),
                currentDecisionRef:
                  semanticArtifactRef(
                    currentDecision,
                  ),
                transitionArtifactRef:
                  artifactRef,
                historyRelationRef: {
                  kind:
                    "decision_resolution_history_relation",
                  id:
                    historyRelation
                      .decisionResolutionHistoryRelationId,
                  digest:
                    historyRelation.digest,
                },
                summary:
                  `Resolved as ${request.optionRef.label}. Downstream effects were not executed.`,
                canonicalDecisionMutation: true,
              },
              { now: this.now },
            );
        } else {
          receipt =
            buildDecisionTransitionReceipt(
              {
                request,
                state: "accepted",
                priorDecisionRef:
                  semanticArtifactRef(decision),
                transitionArtifactRef:
                  artifactRef,
                historyRelationRef: {
                  kind:
                    "decision_resolution_history_relation",
                  id:
                    historyRelation
                      .decisionResolutionHistoryRelationId,
                  digest:
                    historyRelation.digest,
                },
                relayState:
                  "pending_world_manager",
                summary:
                  "The scoped semantic request was durably registered and is awaiting normal WorldManager ingress.",
              },
              { now: this.now },
            );
        }
      }
      this._appendDecisionTransitionReceiptWithinTransaction(
        request,
        receipt,
      );
      const projectionRevision =
        this.incrementRevision();
      return {
        reused: false,
        request,
        transitionArtifact,
        historyRelation,
        receipt,
        currentDecision,
        rebuiltSemanticShelfCount,
        ...cacheInvalidation,
        projectionRevision,
      };
    });
  }

  completeDecisionTransitionRelay(input = {}) {
    return this.transaction(() => {
      const transition = this.decisionTransition(
        normalizeString(
          input.decisionTransitionRequestId,
          "",
        ),
      );
      if (!transition) {
        fail(
          "decision_transition_request_missing",
        );
      }
      const { request, receipt: currentReceipt } =
        transition;
      if (
        request.transitionKind ===
          "resolve_option"
      ) {
        fail(
          "decision_transition_relay_kind_invalid",
        );
      }
      if (
        ["relayed", "failed"].includes(
          currentReceipt.state,
        )
      ) {
        return {
          ...transition,
          reused: true,
          projectionRevision: this.revision(),
        };
      }
      const relayEventRef = input.relayEventRef
        ? {
            kind:
              input.relayEventRef.kind ||
              "world_manager_semantic_event",
            id: input.relayEventRef.id,
            digest: input.relayEventRef.digest,
          }
        : null;
      const state = input.error
        ? "failed"
        : "relayed";
      const receipt =
        buildDecisionTransitionReceipt(
          {
            request,
            revision:
              currentReceipt.receiptRevision + 1,
            predecessorReceiptRef:
              decisionTransitionReceiptRef(
                currentReceipt,
              ),
            priorDecisionRef:
              currentReceipt.priorDecisionRef,
            transitionArtifactRef:
              currentReceipt.transitionArtifactRef,
            historyRelationRef:
              currentReceipt.historyRelationRef,
            relayEventRef,
            state,
            relayState: input.error
              ? "failed"
              : normalizeString(
                  input.relayState,
                  "relayed",
                ),
            errorCode: input.error
              ? normalizeString(
                  input.error.code,
                  "decision_semantic_relay_failed",
                )
              : "",
            summary: input.error
              ? `The scoped semantic request failed visibly: ${normalizeString(
                  input.error.message,
                  "WorldManager relay failed.",
                )}`
              : "The scoped request entered normal WorldManager ingress. The decision remains open until a lawful resolution is admitted.",
          },
          { now: this.now },
        );
      this._appendDecisionTransitionReceiptWithinTransaction(
        request,
        receipt,
      );
      return {
        ...transition,
        receipt,
        reused: false,
        projectionRevision:
          this.incrementRevision(),
      };
    });
  }

  decisionTransition(identifier) {
    const key = normalizeString(identifier, "");
    if (!key) return null;
    const row = this.db.prepare(`
      select
        r.request_json,
        a.artifact_json,
        h.relation_json,
        c.receipt_json
      from wm_decision_transition_requests r
      left join wm_decision_transition_artifacts a
        on a.decision_transition_request_id =
          r.decision_transition_request_id
      left join wm_decision_resolution_relations h
        on h.decision_transition_request_id =
          r.decision_transition_request_id
      left join wm_decision_transition_receipts c
        on c.decision_transition_request_id =
          r.decision_transition_request_id
        and c.current_state = 'current'
      where r.decision_transition_request_id = ?
        or r.client_request_id = ?
      limit 1
    `).get(key, key);
    if (!row) return null;
    return this._parseDecisionTransitionRow(row);
  }

  _parseDecisionTransitionRow(row) {
    const request = parseJson(
      row.request_json,
      null,
    );
    const transitionArtifact = row.artifact_json
      ? parseJson(row.artifact_json, null)
      : null;
    const historyRelation = row.relation_json
      ? parseJson(row.relation_json, null)
      : null;
    const receipt = parseJson(
      row.receipt_json,
      null,
    );
    validateDecisionTransitionRequest(request);
    if (
      transitionArtifact?.schema ===
        DECISION_MECHANICAL_RESOLUTION_SCHEMA
    ) {
      validateDecisionMechanicalResolution(
        transitionArtifact,
      );
    } else if (
      transitionArtifact?.schema ===
        DECISION_SEMANTIC_RELAY_ENVELOPE_SCHEMA
    ) {
      validateDecisionSemanticRelayEnvelope(
        transitionArtifact,
      );
    } else if (transitionArtifact) {
      fail(
        "decision_transition_artifact_schema_unsupported",
      );
    }
    if (historyRelation) {
      if (
        historyRelation.schema !==
          DECISION_RESOLUTION_HISTORY_RELATION_SCHEMA
      ) {
        fail(
          "decision_resolution_relation_schema_unsupported",
        );
      }
      validateDecisionResolutionHistoryRelation(
        historyRelation,
      );
    }
    if (
      receipt?.schema !==
        DECISION_TRANSITION_RECEIPT_SCHEMA
    ) {
      fail(
        "decision_transition_receipt_missing",
      );
    }
    validateDecisionTransitionReceipt(receipt);
    return {
      request,
      transitionArtifact,
      historyRelation,
      receipt,
    };
  }

  listDecisionTransitions(options = {}) {
    const currentOnly =
      options.currentOnly !== false;
    const limit =
      Number.isInteger(Number(options.limit)) &&
      Number(options.limit) > 0
        ? Math.min(5000, Number(options.limit))
        : 1000;
    const rows = this.db.prepare(`
      select
        r.request_json,
        a.artifact_json,
        h.relation_json,
        c.receipt_json
      from wm_decision_transition_requests r
      left join wm_decision_transition_artifacts a
        on a.decision_transition_request_id =
          r.decision_transition_request_id
      left join wm_decision_resolution_relations h
        on h.decision_transition_request_id =
          r.decision_transition_request_id
      join wm_decision_transition_receipts c
        on c.decision_transition_request_id =
          r.decision_transition_request_id
        ${currentOnly
          ? "and c.current_state = 'current'"
          : ""}
      order by c.rowid desc
      limit ?
    `).all(limit);
    return rows.map((row) =>
      this._parseDecisionTransitionRow(row));
  }

  projectEcologyStatusObjects() {
    const bootstrap = this.currentBootstrap();
    if (!bootstrap) return [];
    return buildProjectEcologyStatusObjects({
      bootstrap,
      userWorldId:
        bootstrap.userWorld?.userWorldId ||
        "user_world_local",
      projectConstitutions:
        this.listProjectConstitutions(),
      projectRuntimeDefaults:
        this.listProjectRuntimeDefaults(),
      candidateArtifacts:
        this.listCandidateArtifacts(),
      openDecisions: this.listSemanticArtifacts({
        artifactKind: "open_decision",
        currentOnly: true,
        limit: 5000,
      }),
    });
  }

  semanticProjectIndex() {
    return projectIndexFromStatusObjects(
      this.projectEcologyStatusObjects(),
    );
  }

  semanticContextObject(ref = {}) {
    const kind = normalizeString(ref.kind, "");
    const id = normalizeString(ref.id, "");
    const digest = normalizeString(ref.digest, "");
    if (kind === "project_status") {
      return this.projectEcologyStatusObjects()
        .find((status) =>
          status.projectStatusId === id &&
          status.digest === digest) || null;
    }
    return this.listSemanticArtifacts({
      currentOnly: false,
      limit: 5000,
    }).find((artifact) =>
      artifact.header?.semanticArtifactId === id &&
      artifact.digest === digest) || null;
  }

  _semanticShelfGroupsWithinTransaction() {
    const bootstrap = this.currentBootstrap();
    const userWorldId =
      bootstrap?.userWorld?.userWorldId ||
      "user_world_local";
    const relations =
      this.listActiveSemanticHistoryRelations({
        limit: 10000,
      });
    const groups = new Map();
    const add = (
      shelfKind,
      anchorRef,
      matchingRelations,
      semanticObjectRefs = [],
    ) => {
      const anchorKey =
        `${anchorRef.kind}:${anchorRef.id}`;
      groups.set(
        `${shelfKind}:${anchorKey}`,
        {
          shelfKind,
          anchorKey,
          anchorRefs: [anchorRef],
          relations: matchingRelations,
          semanticObjectRefs,
        },
      );
    };
    const userWorldRef = semanticTargetRef(
      "user_world",
      userWorldId,
      { userWorldId },
    );
    add(
      "user_world_conversational_continuity",
      userWorldRef,
      relations.filter((relation) =>
        relation.relationKind ===
          "conversational_continuity" &&
        relation.targetRef.id === userWorldId),
    );
    add(
      "user_world_governance",
      userWorldRef,
      relations.filter((relation) =>
        relation.relationKind ===
          "belongs_to_lane" &&
        relation.targetRef.id ===
          "system_introspection"),
    );

    const currentOpenDecisionArtifacts =
      this.listSemanticArtifacts({
        artifactKind: "open_decision",
        currentOnly: true,
        limit: 5000,
      }).filter((artifact) =>
        ["open", "blocked", "conflicted"].includes(
          artifact.decisionState,
        )).map((artifact) => {
        const {
          currentState: _currentState,
          ...canonicalArtifact
        } = artifact;
        return canonicalArtifact;
      });
    const projectIds = new Set([
      ...(bootstrap?.projects || []).map((project) =>
        project.projectId),
      ...this.listProjectConstitutions().map((project) =>
        project.projectId),
      ...this.listCandidateArtifacts().map((candidate) =>
        candidate.proposedProjectId).filter(Boolean),
      ...currentOpenDecisionArtifacts.map((artifact) =>
        artifact.header.scope.projectId).filter(Boolean),
    ]);
    const projectStatusObjects =
      this.projectEcologyStatusObjects();
    add(
      "user_world_project_ecology",
      userWorldRef,
      relations.filter((relation) =>
        relation.relationKind === "concerns_project" &&
        projectIds.has(relation.targetRef.id)),
      [
        ...projectStatusObjects.map(
          projectStatusContextRef,
        ),
        ...currentOpenDecisionArtifacts.map(
          semanticArtifactRef,
        ),
      ],
    );
    for (const projectId of projectIds) {
      const projectRef = semanticTargetRef(
        "project",
        projectId,
        { projectId },
      );
      const projectRelations = relations.filter(
        (relation) =>
          (
            relation.relationKind ===
              "concerns_project" &&
            relation.targetRef.id === projectId
          ) ||
          relation.targetRef.projectId ===
            projectId,
      );
      add(
        "project_durable_history",
        projectRef,
        projectRelations,
      );
      add(
        "project_active_horizon",
        projectRef,
        projectRelations.slice(-50),
      );
      add(
        "project_open_decisions",
        projectRef,
        projectRelations.filter((relation) =>
          relation.targetRef.kind ===
            "world_manager_decision"),
        currentOpenDecisionArtifacts
          .filter((artifact) =>
            artifact.header.scope.projectId ===
              projectId)
          .map(semanticArtifactRef),
      );
      add(
        "project_accepted_policies",
        projectRef,
        projectRelations.filter((relation) =>
          relation.targetRef.kind === "policy"),
      );
      add(
        "project_execution_lineages",
        projectRef,
        projectRelations.filter((relation) =>
          relation.targetRef.kind === "work_thread"),
      );
    }

    const taskTargets = new Map();
    for (
      const relation of relations.filter((entry) =>
        entry.relationKind === "continues_task")
    ) {
      taskTargets.set(
        relation.targetRef.id,
        relation.targetRef,
      );
    }
    for (const targetRef of taskTargets.values()) {
      add(
        "task_local_history",
        targetRef,
        relations.filter((relation) =>
          relation.relationKind === "continues_task" &&
          relation.targetRef.id === targetRef.id),
      );
    }

    const aroTargets = new Map();
    for (
      const relation of relations.filter((entry) =>
        [
          "realizes_aro",
          "verifies_aro",
          "revises_object",
          "supersedes_object",
        ].includes(entry.relationKind) &&
        entry.targetRef.kind === "aro")
    ) {
      aroTargets.set(
        relation.targetRef.id,
        relation.targetRef,
      );
    }
    for (const targetRef of aroTargets.values()) {
      add(
        "aro_definition_and_revision",
        targetRef,
        relations.filter((relation) =>
          ["revises_object", "supersedes_object"].includes(
            relation.relationKind,
          ) &&
          relation.targetRef.id === targetRef.id),
      );
      add(
        "aro_realization_evidence",
        targetRef,
        relations.filter((relation) =>
          ["realizes_aro", "verifies_aro"].includes(
            relation.relationKind,
          ) &&
          relation.targetRef.id === targetRef.id),
      );
    }
    return [...groups.values()];
  }

  _rebuildSemanticShelvesWithinTransaction() {
    let changed = 0;
    const desiredShelfIds = new Set();
    for (
      const group of
        this._semanticShelfGroupsWithinTransaction()
    ) {
      const draft = buildSemanticShelf({
        shelfKind: group.shelfKind,
        anchorRefs: group.anchorRefs,
        relations: group.relations,
        semanticObjectRefs:
          group.semanticObjectRefs,
        shelfRevision: 1,
        createdAt: nowIso(this.now),
      });
      desiredShelfIds.add(draft.shelfId);
      const current = this.db.prepare(`
        select shelf_json, shelf_revision, source_digest
        from wm_semantic_shelves
        where shelf_id = ?
          and current_state = 'current'
        order by shelf_revision desc
        limit 1
      `).get(draft.shelfId);
      if (
        current &&
        String(current.source_digest) ===
          draft.sourceDigest
      ) {
        continue;
      }
      const shelfRevision =
        Number(current?.shelf_revision || 0) + 1;
      const shelf = shelfRevision === 1
        ? draft
        : buildSemanticShelf({
            shelfKind: group.shelfKind,
            anchorRefs: group.anchorRefs,
            relations: group.relations,
            semanticObjectRefs:
              group.semanticObjectRefs,
            shelfRevision,
            createdAt: nowIso(this.now),
          });
      if (current) {
        this.db.prepare(`
          update wm_semantic_shelves
          set current_state = 'superseded'
          where shelf_id = ?
            and current_state = 'current'
        `).run(shelf.shelfId);
      }
      this.db.prepare(`
        insert into wm_semantic_shelves (
          shelf_record_id,
          shelf_id,
          shelf_kind,
          anchor_key,
          shelf_revision,
          current_state,
          shelf_json,
          shelf_digest,
          source_digest,
          created_at
        ) values (?, ?, ?, ?, ?, 'current', ?, ?, ?, ?)
      `).run(
        stableId("wm_semantic_shelf_record", {
          shelfId: shelf.shelfId,
          shelfRevision: shelf.shelfRevision,
          digest: shelf.digest,
        }),
        shelf.shelfId,
        shelf.shelfKind,
        group.anchorKey,
        shelf.shelfRevision,
        json(shelf),
        shelf.digest,
        shelf.sourceDigest,
        shelf.createdAt,
      );
      changed += 1;
    }
    const currentRows = this.db.prepare(`
      select shelf_id
      from wm_semantic_shelves
      where current_state = 'current'
    `).all();
    for (const row of currentRows) {
      if (desiredShelfIds.has(String(row.shelf_id))) {
        continue;
      }
      this.db.prepare(`
        update wm_semantic_shelves
        set current_state = 'superseded'
        where shelf_id = ?
          and current_state = 'current'
      `).run(row.shelf_id);
      changed += 1;
    }
    return changed;
  }

  reconstructSemanticHistory() {
    return this.transaction(() => {
      const rows = this.db.prepare(`
        select s.settlement_json, e.event_json
        from wm_settlements s
        join wm_events e
          on e.semantic_event_id = s.semantic_event_id
        order by e.sequence asc
      `).all();
      let reconstructedCount = 0;
      let contemporaneousCount = 0;
      for (const row of rows) {
        const taskSettlement = parseJson(
          row.settlement_json,
          null,
        );
        const sourceEvent = parseJson(
          row.event_json,
          null,
        );
        validateWorldManagerTaskSettlement(
          taskSettlement,
        );
        validateWorldManagerSemanticEvent(sourceEvent);
        if (
          this.semanticSettlementRevisionForEvent(
            sourceEvent.semanticEventId,
          )
        ) {
          continue;
        }
        const semanticIngress =
          this.semanticIngressForSemanticEvent(
            sourceEvent.semanticEventId,
          );
        const semanticSettlement =
          semanticIngress?.semanticSettlement ||
          buildReconstructedSemanticSettlement({
            taskSettlement,
            routingDecision:
              this.routingDecisionForSemanticEvent(
                sourceEvent.semanticEventId,
              ),
            now: this.now,
          });
        this._recordSemanticSettlementRevisionWithinTransaction({
          sourceEvent,
          semanticSettlement,
          provenancePosture: semanticIngress
            ? "contemporaneous"
            : "reconstructed",
          confidence: semanticIngress
            ? "high"
            : "derived",
          compilerVersion: semanticIngress
            ? semanticSettlement.compilerVersion
            : "semantic_history_legacy_reconstruction@1",
          createdAt:
            semanticSettlement.createdAt ||
            taskSettlement.createdAt,
        });
        if (
          semanticSettlement.schema ===
            RECONSTRUCTED_SEMANTIC_SETTLEMENT_SCHEMA
        ) {
          reconstructedCount += 1;
        } else {
          contemporaneousCount += 1;
        }
      }
      const shelfCount =
        this._rebuildSemanticShelvesWithinTransaction();
      const changed =
        reconstructedCount +
          contemporaneousCount +
          shelfCount >
        0;
      return {
        changed,
        reconstructedCount,
        contemporaneousCount,
        shelfCount,
        projectionRevision: changed
          ? this.incrementRevision()
          : this.revision(),
      };
    });
  }

  reviseSemanticHistorySettlement(input = {}) {
    const semanticEventId = normalizeString(
      input.semanticEventId ||
        input.semanticSettlement?.semanticEventId,
      "",
    );
    const semanticSettlement =
      input.semanticSettlement;
    validateSettlementEvidence(semanticSettlement);
    if (
      !semanticEventId ||
      semanticSettlement.semanticEventId !==
        semanticEventId
    ) {
      fail("semantic_history_revision_event_mismatch");
    }
    return this.transaction(() => {
      const sourceEvent =
        this.eventBySemanticEventId(semanticEventId);
      if (!sourceEvent) {
        fail(
          "semantic_history_revision_event_missing",
          semanticEventId,
        );
      }
      const recorded =
        this._recordSemanticSettlementRevisionWithinTransaction({
          sourceEvent,
          semanticSettlement,
          provenancePosture: normalizeString(
            input.provenancePosture,
            "corrected",
          ),
          confidence: normalizeString(
            input.confidence,
            "high",
          ),
          correctionReasonRefs:
            input.correctionReasonRefs,
          compilerVersion: normalizeString(
            input.compilerVersion,
            "semantic_history_correction@1",
          ),
          createdAt: normalizeString(
            input.createdAt,
            nowIso(this.now),
          ),
        });
      if (!recorded.changed) {
        return {
          reused: true,
          ...recorded,
          projectionRevision: this.revision(),
        };
      }
      const shelfCount =
        this._rebuildSemanticShelvesWithinTransaction();
      return {
        reused: false,
        ...recorded,
        shelfCount,
        projectionRevision: this.incrementRevision(),
      };
    });
  }

  semanticChildContractForEvent(semanticEventId) {
    const row = this.db.prepare(`
      select contract_json, execution_state, updated_at
      from wm_semantic_child_contracts
      where child_semantic_event_id = ?
    `).get(normalizeString(semanticEventId, ""));
    if (!row) return null;
    const contract = parseJson(row.contract_json, null);
    validateSemanticChildContract(contract);
    return {
      contract,
      executionState: row.execution_state,
      updatedAt: row.updated_at,
    };
  }

  listSemanticChildContracts(options = {}) {
    const parentSemanticEventId = normalizeString(
      options.parentSemanticEventId,
      "",
    );
    const limit =
      Number.isInteger(Number(options.limit)) &&
      Number(options.limit) > 0
        ? Math.min(1000, Number(options.limit))
        : 200;
    const rows = parentSemanticEventId
      ? this.db.prepare(`
          select contract_json, execution_state, updated_at
          from wm_semantic_child_contracts
          where parent_semantic_event_id = ?
          order by child_index asc
          limit ?
        `).all(parentSemanticEventId, limit)
      : this.db.prepare(`
          select contract_json, execution_state, updated_at
          from wm_semantic_child_contracts
          order by rowid desc
          limit ?
        `).all(limit).reverse();
    return rows.map((row) => {
      const contract = parseJson(row.contract_json, null);
      validateSemanticChildContract(contract);
      return {
        contract,
        executionState: row.execution_state,
        updatedAt: row.updated_at,
      };
    });
  }

  semanticChildMessageForEvent(semanticEventId) {
    const record = this.semanticChildContractForEvent(
      semanticEventId,
    );
    if (!record) return null;
    const event = this.eventBySemanticEventId(
      semanticEventId,
    );
    if (!event) return null;
    return semanticChildIngressMessage(
      record.contract,
      event,
    );
  }

  semanticSplitCoordinationForParent(
    parentSemanticEventId,
  ) {
    const row = this.db.prepare(`
      select coordination_json
      from wm_semantic_split_coordinations
      where parent_semantic_event_id = ?
        and current_state = 'current'
      order by coordination_revision desc
      limit 1
    `).get(normalizeString(parentSemanticEventId, ""));
    if (!row) return null;
    const coordination = parseJson(
      row.coordination_json,
      null,
    );
    validateSemanticSplitCoordination(coordination);
    return coordination;
  }

  listSemanticSplitCoordinations(options = {}) {
    const currentOnly = options.currentOnly !== false;
    const limit =
      Number.isInteger(Number(options.limit)) &&
      Number(options.limit) > 0
        ? Math.min(1000, Number(options.limit))
        : 200;
    const rows = this.db.prepare(`
      select coordination_json
      from wm_semantic_split_coordinations
      ${currentOnly ? "where current_state = 'current'" : ""}
      order by rowid desc
      limit ?
    `).all(limit).reverse();
    return rows.map((row) => {
      const coordination = parseJson(
        row.coordination_json,
        null,
      );
      validateSemanticSplitCoordination(coordination);
      return coordination;
    });
  }

  materializeSemanticSplit(input = {}) {
    const parentEvent = input.parentEvent;
    const semanticIngressRun = input.semanticIngressRun;
    if (
      !parentEvent ||
      parentEvent.eventKind !== "user_utterance_observed" ||
      semanticIngressRun?.semanticEventId !==
        parentEvent.semanticEventId ||
      semanticIngressRun?.semanticDischarge?.actionName !==
        "wm_discharge_split"
    ) {
      fail("world_manager_semantic_split_boundary");
    }
    const childExpressions =
      semanticIngressRun.semanticDischarge.arguments
        ?.childContracts;
    if (
      !Array.isArray(childExpressions) ||
      childExpressions.length < 2
    ) {
      fail("world_manager_semantic_split_children_missing");
    }
    const existing =
      this.semanticSplitCoordinationForParent(
        parentEvent.semanticEventId,
      );
    if (existing) {
      return {
        reused: true,
        coordination: existing,
        children: this.listSemanticChildContracts({
          parentSemanticEventId:
            parentEvent.semanticEventId,
        }).map((record) => ({
          ...record,
          event: this.eventBySemanticEventId(
            record.contract.childSemanticEventId,
          ),
          message: this.semanticChildMessageForEvent(
            record.contract.childSemanticEventId,
          ),
        })),
        projectionRevision: this.revision(),
      };
    }
    const parentSettlement =
      this.settlementForSemanticEvent(
        parentEvent.semanticEventId,
      );
    const parentSettlementRevision =
      this.semanticSettlementRevisionForEvent(
        parentEvent.semanticEventId,
      );
    if (
      parentSettlement?.taskSettlement?.state !== "settled" ||
      parentSettlement.semanticIngressRun
        ?.semanticSettlement?.formulationDisposition !==
        "split" ||
      !parentSettlementRevision
    ) {
      fail(
        "world_manager_semantic_split_parent_not_settled",
      );
    }
    return this.transaction(() => {
      const createdAt = nowIso(this.now);
      const parentEventRef = {
        kind: "world_manager_semantic_event",
        id: parentEvent.semanticEventId,
        digest: parentEvent.eventDigest,
        label: "Compound user utterance",
      };
      const children = childExpressions.map(
        (semanticTypeExpression, childIndex) => {
          const childSemanticEventId = stableId(
            "wm_event",
            {
              parentSemanticEventId:
                parentEvent.semanticEventId,
              transition: "semantic_child_materialized",
              childIndex,
              semanticTypeExpression,
            },
          );
          const contract = buildSemanticChildContract({
            parentEventRef,
            childSemanticEventId,
            childIndex,
            semanticTypeExpression,
            coordinationObjective:
              semanticIngressRun.semanticDischarge
                .arguments.coordinationObjective,
            createdAt,
          });
          const contractRef = {
            kind: "semantic_child_contract",
            id: contract.childContractId,
            digest: contract.digest,
            label: `Semantic child ${childIndex + 1}`,
          };
          const childEvent =
            this.appendDerivedEventWithinTransaction({
              semanticEventId: childSemanticEventId,
              lineageRootId: parentEvent.lineageRootId,
              clientRequestId:
                `${parentEvent.clientRequestId}:sc2b:child:${
                  childIndex + 1
                }`,
              clientRequestDigest: digestFor(
                "direct-semantic-child-materialization@1",
                {
                  parentEventDigest:
                    parentEvent.eventDigest,
                  childIndex,
                  contractDigest: contract.digest,
                },
              ),
              eventKind: "semantic_child_materialized",
              presentationState: "queued",
              epistemicState: "settled",
              actorRole: "semantic_router",
              projectId: parentEvent.projectId,
              taskType: "",
              parentSemanticEventIds: [
                parentEvent.semanticEventId,
              ],
              artifactRefs: [contractRef],
              sourceScopeRevisions:
                parentEvent.sourceScopeRevisions,
              rendererSafeSummary:
                contract.semanticPrompt,
              occurredAt: createdAt,
            });
          this.db.prepare(`
            insert into wm_semantic_child_contracts (
              child_contract_id,
              parent_semantic_event_id,
              child_semantic_event_id,
              child_index,
              execution_state,
              contract_json,
              contract_digest,
              created_at,
              updated_at
            ) values (?, ?, ?, ?, 'materialized', ?, ?, ?, ?)
          `).run(
            contract.childContractId,
            parentEvent.semanticEventId,
            childEvent.semanticEventId,
            childIndex,
            json(contract),
            contract.digest,
            createdAt,
            createdAt,
          );
          const relation =
            buildSemanticChildRelation({
              parentEvent,
              parentSettlementRevision,
              childEvent,
              childIndex,
              childContractRef: {
                ...contractRef,
                rawTextIncluded: false,
                rawPathIncluded: false,
                rawSecretIncluded: false,
              },
            });
          this._insertSemanticHistoryRelationWithinTransaction(
            relation,
            relation.lifecycle,
          );
          return {
            contract,
            event: childEvent,
            message:
              semanticChildIngressMessage(
                contract,
                childEvent,
              ),
          };
        },
      );
      const coordination =
        buildSemanticSplitCoordination({
          parentEventRef,
          coordinationObjective:
            semanticIngressRun.semanticDischarge
              .arguments.coordinationObjective,
          childContractRefs: children.map(
            ({ contract }, index) => ({
              kind: "semantic_child_contract",
              id: contract.childContractId,
              digest: contract.digest,
              label: `Semantic child ${index + 1}`,
            }),
          ),
          childEventRefs: children.map(
            ({ event }, index) => ({
              kind: "world_manager_semantic_event",
              id: event.semanticEventId,
              digest: event.eventDigest,
              label:
                `Materialized semantic child ${
                  index + 1
                }`,
            }),
          ),
          state: "materialized",
          revision: 1,
          summary:
            `${children.length} semantic child events materialized; no child role result exists yet.`,
          createdAt,
        });
      this.db.prepare(`
        insert into wm_semantic_split_coordinations (
          coordination_record_id,
          coordination_id,
          parent_semantic_event_id,
          coordination_state,
          coordination_revision,
          current_state,
          coordination_json,
          coordination_digest,
          created_at,
          updated_at
        ) values (?, ?, ?, ?, ?, 'current', ?, ?, ?, ?)
      `).run(
        stableId(
          "wm_semantic_split_coordination_record",
          {
            coordinationId: coordination.coordinationId,
            revision: coordination.revision,
            digest: coordination.digest,
          },
        ),
        coordination.coordinationId,
        parentEvent.semanticEventId,
        coordination.state,
        coordination.revision,
        json(coordination),
        coordination.digest,
        coordination.createdAt,
        coordination.updatedAt,
      );
      this.appendDerivedEventWithinTransaction({
        semanticEventId: stableId("wm_event", {
          parentSemanticEventId:
            parentEvent.semanticEventId,
          transition: "semantic_split_materialized",
        }),
        lineageRootId: parentEvent.lineageRootId,
        clientRequestId:
          `${parentEvent.clientRequestId}:sc2b:materialized`,
        clientRequestDigest: digestFor(
          "direct-semantic-split-materialized@1",
          {
            parentEventDigest: parentEvent.eventDigest,
            coordinationDigest: coordination.digest,
          },
        ),
        eventKind: "semantic_split_materialized",
        presentationState: "queued",
        epistemicState: "settled",
        actorRole: "operator",
        projectId:
          parentSettlement.taskSettlement.projectId,
        taskType:
          parentSettlement.taskSettlement.taskType,
        parentSemanticEventIds: [
          parentEvent.semanticEventId,
        ],
        artifactRefs: [{
          kind: "semantic_split_coordination",
          id: coordination.coordinationId,
          digest: coordination.digest,
          label: "Materialized split coordination",
        }],
        sourceScopeRevisions:
          parentEvent.sourceScopeRevisions,
        rendererSafeSummary: coordination.summary,
        occurredAt: createdAt,
      });
      this._rebuildSemanticShelvesWithinTransaction();
      return {
        reused: false,
        coordination,
        children,
        projectionRevision: this.incrementRevision(),
      };
    });
  }

  updateSemanticSplitCoordination(input = {}) {
    const parentEvent = input.parentEvent;
    const current =
      this.semanticSplitCoordinationForParent(
        parentEvent?.semanticEventId,
      );
    if (
      !parentEvent ||
      !current ||
      current.parentEventRef.id !==
        parentEvent.semanticEventId
    ) {
      fail(
        "world_manager_semantic_split_coordination_missing",
      );
    }
    const childOutcomes = Array.isArray(
      input.childOutcomes,
    )
      ? input.childOutcomes
      : current.childOutcomes;
    const nextComparable = {
      state: input.state,
      childOutcomes,
      parentAgentResultRef:
        input.parentAgentResultRef || null,
      summary: normalizeString(input.summary, ""),
    };
    const currentComparable = {
      state: current.state,
      childOutcomes: current.childOutcomes,
      parentAgentResultRef:
        current.parentAgentResultRef,
      summary: current.summary,
    };
    if (json(nextComparable) === json(currentComparable)) {
      return {
        reused: true,
        coordination: current,
        projectionRevision: this.revision(),
      };
    }
    return this.transaction(() => {
      const updatedAt = nowIso(this.now);
      const next = buildSemanticSplitCoordination({
        parentEventRef: current.parentEventRef,
        coordinationObjective:
          current.coordinationObjective,
        childContractRefs: current.childContractRefs,
        childEventRefs: current.childEventRefs,
        childOutcomes,
        parentAgentResultRef:
          input.parentAgentResultRef ||
          current.parentAgentResultRef,
        state: input.state,
        revision: current.revision + 1,
        summary: input.summary,
        createdAt: current.createdAt,
        updatedAt,
      });
      this.db.prepare(`
        update wm_semantic_split_coordinations
        set current_state = 'superseded'
        where coordination_id = ?
          and current_state = 'current'
      `).run(current.coordinationId);
      this.db.prepare(`
        insert into wm_semantic_split_coordinations (
          coordination_record_id,
          coordination_id,
          parent_semantic_event_id,
          coordination_state,
          coordination_revision,
          current_state,
          coordination_json,
          coordination_digest,
          created_at,
          updated_at
        ) values (?, ?, ?, ?, ?, 'current', ?, ?, ?, ?)
      `).run(
        stableId(
          "wm_semantic_split_coordination_record",
          {
            coordinationId: next.coordinationId,
            revision: next.revision,
            digest: next.digest,
          },
        ),
        next.coordinationId,
        parentEvent.semanticEventId,
        next.state,
        next.revision,
        json(next),
        next.digest,
        next.createdAt,
        next.updatedAt,
      );
      for (const outcome of next.childOutcomes) {
        this.db.prepare(`
          update wm_semantic_child_contracts
          set execution_state = ?,
              updated_at = ?
          where child_contract_id = ?
        `).run(
          outcome.state,
          updatedAt,
          outcome.childContractRef.id,
        );
      }
      const terminal = [
        "completed",
        "partially_remanded",
        "remanded",
        "failed",
        "interrupted",
      ].includes(next.state);
      const failed = [
        "failed",
        "interrupted",
      ].includes(next.state);
      const remanded = [
        "partially_remanded",
        "remanded",
      ].includes(next.state);
      const eventKind = next.state === "executing"
        ? "semantic_split_execution_started"
        : next.state === "joining"
          ? "semantic_split_join_started"
          : terminal
            ? "semantic_split_join_completed"
            : "semantic_split_materialized";
      const presentationState = next.state === "joining"
        ? "reconciling"
        : failed
          ? "failed"
          : remanded
            ? "remanded"
            : terminal
              ? "replied"
              : "running";
      const epistemicState = failed
        ? "failed"
        : remanded
          ? "remanded"
          : terminal
            ? "evidenced"
            : "running";
      this.appendDerivedEventWithinTransaction({
        semanticEventId: stableId("wm_event", {
          parentSemanticEventId:
            parentEvent.semanticEventId,
          coordinationRevision: next.revision,
          coordinationState: next.state,
        }),
        lineageRootId: parentEvent.lineageRootId,
        clientRequestId:
          `${parentEvent.clientRequestId}:sc2b:coordination:${
            next.revision
          }`,
        clientRequestDigest: digestFor(
          "direct-semantic-split-coordination-transition@1",
          {
            parentEventDigest: parentEvent.eventDigest,
            previousCoordinationDigest: current.digest,
            coordinationDigest: next.digest,
          },
        ),
        eventKind,
        presentationState,
        epistemicState,
        actorRole: "world_manager_service",
        projectId: parentEvent.projectId,
        taskType: "project_discussion",
        parentSemanticEventIds: [
          parentEvent.semanticEventId,
        ],
        artifactRefs: [{
          kind: "semantic_split_coordination",
          id: next.coordinationId,
          digest: next.digest,
          label: `Split coordination ${next.state}`,
        }],
        sourceScopeRevisions:
          parentEvent.sourceScopeRevisions,
        rendererSafeSummary:
          next.summary ||
          `Semantic split coordination is ${next.state}.`,
        occurredAt: updatedAt,
      });
      return {
        reused: false,
        coordination: next,
        projectionRevision: this.incrementRevision(),
      };
    });
  }

  commitSettlement(input = {}) {
    const userEvent = input.userEvent;
    const taskSettlement = input.taskSettlement;
    const routingDecision = input.routingDecision;
    const ingressEnvelope = input.ingressEnvelope;
    const targetResolution = input.targetResolution;
    const contextBundle = input.contextBundle || null;
    const clarification = input.clarification || null;
    const semanticIngressRun = input.semanticIngressRun || null;
    validateWorldManagerTaskSettlement(taskSettlement);
    validateWorldManagerRoutingDecision(routingDecision);
    validateWorldmodelIngressEnvelope(ingressEnvelope);
    validateSemanticTargetResolution(targetResolution);
    if (semanticIngressRun) {
      validateSemanticIngressRun(semanticIngressRun);
    }
    if (
      !userEvent ||
      ![
        "user_utterance_observed",
        "semantic_child_materialized",
      ].includes(userEvent.eventKind) ||
      taskSettlement.semanticEventId !== userEvent.semanticEventId ||
      routingDecision.semanticEventId !== userEvent.semanticEventId ||
      routingDecision.taskSettlementRef?.id !== taskSettlement.taskSettlementId ||
      routingDecision.taskSettlementRef?.digest !== taskSettlement.digest ||
      routingDecision.targetResolutionRef?.id !== targetResolution.resolutionId ||
      routingDecision.targetResolutionRef?.digest !== targetResolution.digest ||
      taskSettlement.ingressRef?.id !== ingressEnvelope.ingressId ||
      taskSettlement.ingressRef?.digest !== ingressEnvelope.digest ||
      (semanticIngressRun &&
        (semanticIngressRun.semanticEventId !==
          userEvent.semanticEventId ||
          taskSettlement.semanticSettlementRef?.id !==
            semanticIngressRun.semanticSettlement
              .semanticSettlementId ||
          taskSettlement.semanticSettlementRef?.digest !==
            semanticIngressRun.semanticSettlement.digest)) ||
      (taskSettlement.settlementTier === "semantic" &&
        !semanticIngressRun) ||
      !ingressEnvelope?.digest ||
      !targetResolution?.digest
    ) {
      fail("world_manager_settlement_lineage_mismatch");
    }
    if (
      contextBundle &&
      (contextBundle.semanticEventId !== userEvent.semanticEventId ||
        contextBundle.grantsAuthority !== false ||
        contextBundle.historicalTranscriptIncluded !== false ||
        contextBundle.rawUnrelatedProjectStateIncluded !== false ||
        contextBundle.providerRoleTurnState !== "not_started")
    ) {
      fail("world_manager_manager_context_boundary");
    }
    return this.transaction(() => {
      const existing = this.settlementForSemanticEvent(userEvent.semanticEventId);
      if (existing) {
        if (existing.taskSettlement.digest !== taskSettlement.digest) {
          fail(
            "world_manager_settlement_idempotency_conflict",
            userEvent.semanticEventId,
          );
        }
        const existingSemanticIngress =
          this.semanticIngressForSemanticEvent(
            userEvent.semanticEventId,
          );
        if (
          semanticIngressRun &&
          existingSemanticIngress?.digest !==
            semanticIngressRun.digest
        ) {
          fail(
            "world_manager_semantic_ingress_idempotency_conflict",
            userEvent.semanticEventId,
          );
        }
        return {
          reused: true,
          ...existing,
          routingDecision: this.routingDecisionForSemanticEvent(
            userEvent.semanticEventId,
          ),
          contextBundle: this.managerContextForSemanticEvent(
            userEvent.semanticEventId,
          ),
          semanticIngressRun: existingSemanticIngress,
          projectionRevision: this.revision(),
          transitionEvents: [],
        };
      }
      if (semanticIngressRun) {
        this.db.prepare(`
          insert into wm_semantic_ingress_runs (
            semantic_ingress_run_id,
            semantic_event_id,
            run_state,
            run_json,
            semantic_settlement_digest,
            run_digest,
            created_at
          ) values (?, ?, ?, ?, ?, ?, ?)
        `).run(
          semanticIngressRun.semanticIngressRunId,
          semanticIngressRun.semanticEventId,
          semanticIngressRun.runState,
          json(semanticIngressRun),
          semanticIngressRun.semanticSettlement.digest,
          semanticIngressRun.digest,
          semanticIngressRun.createdAt,
        );
      }
      this.db.prepare(`
        insert into wm_settlements (
          task_settlement_id,
          semantic_event_id,
          lineage_root_id,
          project_id,
          task_type,
          settlement_state,
          settlement_json,
          ingress_json,
          target_resolution_json,
          settlement_digest,
          created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        taskSettlement.taskSettlementId,
        taskSettlement.semanticEventId,
        userEvent.lineageRootId,
        taskSettlement.projectId,
        taskSettlement.taskType,
        taskSettlement.state,
        json(taskSettlement),
        json(ingressEnvelope),
        json(targetResolution),
        taskSettlement.digest,
        taskSettlement.createdAt,
      );
      this.db.prepare(`
        insert into wm_routing_decisions (
          routing_decision_id,
          semantic_event_id,
          selected_role,
          decision_kind,
          decision_json,
          decision_digest,
          created_at
        ) values (?, ?, ?, ?, ?, ?, ?)
      `).run(
        routingDecision.routingDecisionId,
        routingDecision.semanticEventId,
        routingDecision.selectedRole,
        routingDecision.decision,
        json(routingDecision),
        routingDecision.digest,
        taskSettlement.createdAt,
      );

      const semanticHistorySettlement =
        semanticIngressRun?.semanticSettlement ||
        buildReconstructedSemanticSettlement({
          taskSettlement,
          routingDecision,
          now: this.now,
        });
      const semanticHistory =
        this._recordSemanticSettlementRevisionWithinTransaction({
          sourceEvent: userEvent,
          semanticSettlement:
            semanticHistorySettlement,
          provenancePosture: semanticIngressRun
            ? "contemporaneous"
            : "reconstructed",
          confidence: semanticIngressRun
            ? "high"
            : "derived",
          compilerVersion: semanticIngressRun
            ? semanticHistorySettlement.compilerVersion
            : "semantic_history_legacy_reconstruction@1",
          createdAt:
            semanticHistorySettlement.createdAt ||
            taskSettlement.createdAt,
        });
      let rebuiltSemanticShelfCount =
        this._rebuildSemanticShelvesWithinTransaction();

      const settlementEventId = stableId("wm_event", {
        semanticEventId: userEvent.semanticEventId,
        transition: "k2_settlement",
      });
      const isClarification =
        taskSettlement.state === "clarification_required";
      const isRemand = taskSettlement.state === "remanded";
      const settlementEvent = this.appendDerivedEventWithinTransaction({
        semanticEventId: settlementEventId,
        lineageRootId: userEvent.lineageRootId,
        clientRequestId: `${userEvent.clientRequestId}:k2:settlement`,
        clientRequestDigest: digestFor(
          "direct-world-manager-k2-settlement-transition@1",
          {
            userEventDigest: userEvent.eventDigest,
            taskSettlementDigest: taskSettlement.digest,
            routingDecisionDigest: routingDecision.digest,
          },
        ),
        eventKind: isClarification
          ? "clarification_requested"
          : isRemand
            ? "settlement_remanded"
            : "task_settled",
        presentationState: isClarification
          ? "clarification_required"
          : isRemand
            ? "remanded"
            : "settled",
        epistemicState: isClarification
          ? "ambiguous"
          : isRemand
            ? "remanded"
            : "settled",
        actorRole: "semantic_router",
        projectId: taskSettlement.projectId,
        taskType: taskSettlement.taskType,
        parentSemanticEventIds: [userEvent.semanticEventId],
        artifactRefs: [
          ...(semanticIngressRun
            ? [
                {
                  kind:
                    "world_manager_semantic_settlement",
                  id:
                    semanticIngressRun.semanticSettlement
                      .semanticSettlementId,
                  digest:
                    semanticIngressRun.semanticSettlement
                      .digest,
                  label:
                    "WorldManager semantic settlement",
                },
              ]
            : []),
          {
            kind: "world_manager_task_settlement",
            id: taskSettlement.taskSettlementId,
            digest: taskSettlement.digest,
            label: "K2 task settlement",
          },
          {
            kind: "world_manager_routing_decision",
            id: routingDecision.routingDecisionId,
            digest: routingDecision.digest,
            label: "K2 routing decision",
          },
          {
            kind: "semantic_settlement_revision",
            id:
              semanticHistory.revision
                .settlementRevisionId,
            digest: semanticHistory.revision.digest,
            label:
              `Semantic-history settlement revision ${
                semanticHistory.revision
                  .settlementRevision
              }`,
          },
        ],
        sourceScopeRevisions: userEvent.sourceScopeRevisions,
        rendererSafeSummary: isClarification || isRemand
          ? taskSettlement.clarificationPrompt
          : `${taskSettlement.taskType} settled to ${taskSettlement.responsibleRole}.`,
        occurredAt: nowIso(this.now),
      });

      const transitionEvents = [settlementEvent];
      if (normalizeString(input.resolvedClarificationId, "")) {
        const pending = this.db.prepare(`
          select decision_kind, state
          from wm_decisions
          where decision_request_id = ?
        `).get(input.resolvedClarificationId);
        if (
          !pending ||
          pending.decision_kind !== "clarification" ||
          !["pending", "clarification_required"].includes(pending.state)
        ) {
          fail(
            "world_manager_clarification_resolution_target_invalid",
            input.resolvedClarificationId,
          );
        }
        this.db.prepare(`
          update wm_decisions
          set state = 'resolved',
              decision_ref_json = ?
          where decision_request_id = ?
        `).run(
          json({
            kind: "world_manager_clarification_resolution",
            id: stableId("wm_clarification_resolution", {
              clarificationId: input.resolvedClarificationId,
              semanticEventId: userEvent.semanticEventId,
            }),
            digest: digestFor(
              "direct-world-manager-clarification-resolution@1",
              {
                clarificationId: input.resolvedClarificationId,
                semanticEventId: userEvent.semanticEventId,
                taskSettlementDigest: taskSettlement.digest,
                grantsAuthority: false,
              },
            ),
            resolvingSemanticEventId: userEvent.semanticEventId,
            grantsAuthority: false,
          }),
          input.resolvedClarificationId,
        );
      }
      if (clarification) {
        this.db.prepare(`
          insert into wm_decisions (
            decision_request_id,
            semantic_event_id,
            target_artifact_ref_json,
            decision_kind,
            state,
            authority_requirements_json,
            decision_ref_json
          ) values (?, ?, ?, ?, ?, ?, ?)
        `).run(
          clarification.clarificationId,
          userEvent.semanticEventId,
          json({
            kind: "world_manager_task_settlement",
            id: taskSettlement.taskSettlementId,
            digest: taskSettlement.digest,
            projectId: taskSettlement.projectId,
          }),
          "clarification",
          "clarification_required",
          json({
            responseAuthority: "user_only",
            grantsAuthority: false,
          }),
          json({
            kind: "world_manager_clarification",
            id: clarification.clarificationId,
            digest: clarification.digest,
          }),
        );
      }
      const semanticDecisionKernel =
        this._synchronizeSemanticDecisionKernelWithinTransaction();
      rebuiltSemanticShelfCount +=
        this._rebuildSemanticShelvesWithinTransaction();

      if (contextBundle) {
        this.db.prepare(`
          insert into wm_manager_contexts (
            context_bundle_id,
            semantic_event_id,
            project_id,
            manager_role,
            context_json,
            context_digest,
            created_at
          ) values (?, ?, ?, ?, ?, ?, ?)
        `).run(
          contextBundle.contextBundleId,
          contextBundle.semanticEventId,
          taskSettlement.projectId,
          taskSettlement.responsibleRole,
          json(contextBundle),
          contextBundle.digest,
          taskSettlement.createdAt,
        );
        const contextEvent = this.appendDerivedEventWithinTransaction({
          semanticEventId: stableId("wm_event", {
            semanticEventId: userEvent.semanticEventId,
            transition: "manager_context_prepared",
          }),
          lineageRootId: userEvent.lineageRootId,
          clientRequestId: `${userEvent.clientRequestId}:k2:context`,
          clientRequestDigest: digestFor(
            "direct-world-manager-k2-context-transition@1",
            {
              settlementEventDigest: settlementEvent.eventDigest,
              contextDigest: contextBundle.digest,
            },
          ),
          eventKind: "manager_context_prepared",
          presentationState: "queued",
          epistemicState: "validated",
          actorRole: "world_manager_service",
          projectId: taskSettlement.projectId,
          taskType: taskSettlement.taskType,
          parentSemanticEventIds: [settlementEvent.semanticEventId],
          artifactRefs: [
            {
              kind: "manager_turn_boot_packet",
              id: contextBundle.bootPacketRef.id,
              digest: contextBundle.bootPacketRef.digest,
              label: "Graph-first manager boot packet",
            },
            {
              kind: "worldmodel_graph_projection",
              id: contextBundle.projectionRef.id,
              digest: contextBundle.projectionRef.digest,
              label: "Bounded manager graph projection",
            },
          ],
          sourceScopeRevisions: userEvent.sourceScopeRevisions,
          rendererSafeSummary:
            "Manager context prepared; provider role execution has not started.",
          occurredAt: nowIso(this.now),
        });
        transitionEvents.push(contextEvent);
      }
      const projectionRevision = this.incrementRevision();
      return {
        reused: false,
        taskSettlement,
        semanticIngressRun,
        ingressEnvelope,
        targetResolution,
        routingDecision,
        contextBundle,
        semanticHistoryRevision:
          semanticHistory.revision,
        semanticHistoryRelations:
          semanticHistory.relations,
        semanticDecisionKernel,
        rebuiltSemanticShelfCount,
        transitionEvents,
        projectionRevision,
      };
    });
  }

  routingDecisionForSemanticEvent(semanticEventId) {
    const row = this.db.prepare(`
      select decision_json
      from wm_routing_decisions
      where semantic_event_id = ?
    `).get(semanticEventId);
    if (!row) return null;
    const decision = parseJson(row.decision_json, null);
    validateWorldManagerRoutingDecision(decision);
    return decision;
  }

  managerContextForSemanticEvent(semanticEventId) {
    const row = this.db.prepare(`
      select context_json
      from wm_manager_contexts
      where semantic_event_id = ?
    `).get(semanticEventId);
    return row ? parseJson(row.context_json, null) : null;
  }

  agentWorldForSemanticEvent(semanticEventId, options = {}) {
    const row = this.db.prepare(`
      select summary_json, compilation_json
      from wm_agent_world_compilations
      where semantic_event_id = ?
    `).get(semanticEventId);
    if (!row) return null;
    const summary = parseJson(row.summary_json, null);
    const compilation = parseJson(row.compilation_json, null);
    if (!agentWorldSummaryMatchesCompilation(summary, compilation)) {
      fail(
        "world_manager_agent_world_summary_mismatch",
        semanticEventId,
      );
    }
    if (options.full === true) {
      return {
        summary,
        compilation,
      };
    }
    return summary;
  }

  commitAgentWorld(input = {}) {
    const userEvent = input.userEvent;
    const taskSettlement = input.taskSettlement;
    const contextBundle = input.contextBundle;
    const compilation = input.compilation;
    if (
      !isSemanticIngressEvent(userEvent) ||
      !taskSettlement ||
      !contextBundle ||
      !compilation ||
      compilation.schema !== AGENT_WORLD_COMPILATION_SCHEMA ||
      compilation.semanticEventId !== userEvent.semanticEventId ||
      taskSettlement.semanticEventId !== userEvent.semanticEventId ||
      contextBundle.semanticEventId !== userEvent.semanticEventId ||
      compilation.taskSettlementRef?.id !==
        taskSettlement.taskSettlementId ||
      compilation.taskSettlementRef?.digest !== taskSettlement.digest ||
      compilation.compilationState !== "validated_ready_for_k4" ||
      compilation.projectionAgreement?.state !== "validated" ||
      compilation.projectionAgreement?.launchEligible !== true ||
      compilation.providerRoleTurnState !== "not_started" ||
      compilation.providerRequestCreated !== false ||
      compilation.rendererInstructionInputAccepted !== false ||
      compilation.canonicalWorldstateMutation !== false ||
      compilation.grantsAuthority !== false
    ) {
      fail("world_manager_agent_world_commit_boundary");
    }
    const summary = rendererSafeAgentWorldSummary(compilation);
    return this.transaction(() => {
      const existing = this.agentWorldForSemanticEvent(
        userEvent.semanticEventId,
        { full: true },
      );
      if (existing) {
        if (existing.compilation?.digest !== compilation.digest) {
          fail(
            "world_manager_agent_world_idempotency_conflict",
            userEvent.semanticEventId,
          );
        }
        return {
          reused: true,
          summary: existing.summary,
          compilation: existing.compilation,
          projectionRevision: this.revision(),
          transitionEvent: null,
        };
      }
      this.db.prepare(`
        insert into wm_agent_world_compilations (
          agent_world_compilation_id,
          semantic_event_id,
          project_id,
          role_template_id,
          compilation_state,
          summary_json,
          compilation_json,
          compilation_digest,
          created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        compilation.agentWorldCompilationId,
        compilation.semanticEventId,
        taskSettlement.projectId,
        compilation.roleTemplate.roleTemplateId,
        compilation.compilationState,
        json(summary),
        json(compilation),
        compilation.digest,
        taskSettlement.createdAt,
      );
      const transitionEvent = this.appendDerivedEventWithinTransaction({
        semanticEventId: stableId("wm_event", {
          semanticEventId: userEvent.semanticEventId,
          transition: "agent_world_compiled",
        }),
        lineageRootId: userEvent.lineageRootId,
        clientRequestId: `${userEvent.clientRequestId}:k3:agent-world`,
        clientRequestDigest: digestFor(
          "direct-world-manager-k3-agent-world-transition@1",
          {
            userEventDigest: userEvent.eventDigest,
            contextBundleDigest: contextBundle.digest,
            compilationDigest: compilation.digest,
          },
        ),
        eventKind: "agent_world_compiled",
        presentationState: "validated",
        epistemicState: "validated",
        actorRole: "world_manager_service",
        projectId: taskSettlement.projectId,
        taskType: taskSettlement.taskType,
        parentSemanticEventIds: [
          stableId("wm_event", {
            semanticEventId: userEvent.semanticEventId,
            transition: "manager_context_prepared",
          }),
        ],
        artifactRefs: [
          {
            kind: "resolved_task_constitution",
            id:
              compilation.policyCompilation.resolvedTaskConstitution
                .taskConstitutionId,
            digest:
              compilation.policyCompilation.resolvedTaskConstitution.digest,
            label: "K3 resolved task constitution",
          },
          {
            kind: "agent_instantiation_manifest",
            id: compilation.manifest.instanceId,
            digest: compilation.manifest.digest,
            label: "K3 agent instantiation manifest",
          },
          {
            kind: "agent_world_projection_agreement",
            id: compilation.projectionAgreement.projectionAgreementId,
            digest: compilation.projectionAgreement.digest,
            label: "K3 fail-closed projection agreement",
          },
        ],
        sourceScopeRevisions:
          compilation.manifest.worldstateRevisionRefs,
        rendererSafeSummary:
          "Task constitution and agent world validated; provider role execution remains stopped.",
        occurredAt: nowIso(this.now),
      });
      return {
        reused: false,
        summary,
        compilation,
        transitionEvent,
        projectionRevision: this.incrementRevision(),
      };
    });
  }

  _operationalMetaContextRecord(row) {
    if (!row) return null;
    const requirementSet = parseJson(
      row.requirement_json,
      null,
    );
    const importRequest = parseJson(
      row.import_json,
      null,
    );
    const bundle = parseJson(row.bundle_json, null);
    const operationalManifest = parseJson(
      row.manifest_json,
      null,
    );
    validateContextRequirementSet(requirementSet);
    validateSemanticContextImportRequest(importRequest);
    validateSemanticContextBundle(bundle);
    validateOperationalMetaContextManifest(
      operationalManifest,
    );
    const link = row.link_json
      ? parseJson(row.link_json, null)
      : null;
    if (link) validateContextRequestManifestLink(link);
    return {
      requirementSet,
      importRequest,
      selectionWitness: bundle.selectionWitness,
      bundle,
      operationalManifest,
      link,
      currentState: String(row.current_state || ""),
      cacheKey: bundle.cacheKey,
      dependencyDigest: bundle.dependencyDigest,
    };
  }

  _operationalMetaContextQuery(
    whereClause = "",
    values = [],
    limit = 1000,
  ) {
    return this.db.prepare(`
      select
        r.requirement_json,
        i.import_json,
        b.bundle_json,
        m.manifest_json,
        m.current_state,
        (
          select l.link_json
          from wm_context_request_manifest_links l
          where l.operational_meta_context_id =
            m.operational_meta_context_id
          order by l.rowid desc
          limit 1
        ) as link_json
      from wm_operational_meta_context_manifests m
      join wm_semantic_context_bundles b
        on b.context_bundle_id = m.context_bundle_id
      join wm_semantic_context_imports i
        on i.context_import_id = b.context_import_id
      join wm_context_requirement_sets r
        on r.context_requirement_set_id =
          i.context_requirement_set_id
      ${whereClause ? `where ${whereClause}` : ""}
      order by m.rowid asc
      limit ?
    `).all(...values, limit).map((row) =>
      this._operationalMetaContextRecord(row));
  }

  operationalMetaContextForAgentInstantiation(
    agentInstantiationId,
    options = {},
  ) {
    const currentOnly = options.currentOnly !== false;
    return this._operationalMetaContextQuery(
      [
        "m.agent_instantiation_id = ?",
        ...(currentOnly
          ? ["m.current_state = 'current'"]
          : []),
      ].join(" and "),
      [normalizeString(agentInstantiationId, "")],
      1000,
    ).at(-1) || null;
  }

  operationalMetaContextForSemanticEvent(
    semanticEventId,
    options = {},
  ) {
    const currentOnly = options.currentOnly !== false;
    return this._operationalMetaContextQuery(
      [
        "m.semantic_event_id = ?",
        ...(currentOnly
          ? ["m.current_state = 'current'"]
          : []),
      ].join(" and "),
      [normalizeString(semanticEventId, "")],
      1000,
    ).at(-1) || null;
  }

  listOperationalMetaContexts(options = {}) {
    const limit =
      Number.isInteger(Number(options.limit)) &&
      Number(options.limit) > 0
        ? Math.min(5000, Number(options.limit))
        : 1000;
    const records = this._operationalMetaContextQuery(
      options.currentOnly === false
        ? ""
        : "m.current_state = 'current'",
      [],
      limit,
    );
    if (options.full === true) return records;
    return records.map((record) =>
      rendererSafeOperationalMetaContextSummary(
        record,
        record.link,
      ));
  }

  prepareOperationalMetaContext(input = {}) {
    const taskSettlement = input.taskSettlement;
    const compilation = input.compilation;
    const semanticSettlement =
      this.semanticIngressForSemanticEvent(
        taskSettlement?.semanticEventId,
      )?.semanticSettlement || null;
    if (
      !taskSettlement ||
      taskSettlement.state !== "settled" ||
      !compilation ||
      ![
        AGENT_WORLD_COMPILATION_SCHEMA,
        "direct_world_manager_reconciliation_compilation@1",
      ].includes(compilation.schema) ||
      (
        compilation.semanticEventId ||
        compilation.sourceSemanticEventId
      ) !== taskSettlement.semanticEventId
    ) {
      fail("operational_meta_context_prepare_boundary");
    }
    const sourceEvent =
      this.eventBySemanticEventId(
        taskSettlement.semanticEventId,
      );
    const explicitSemanticObjectRefs =
      (sourceEvent?.artifactRefs || [])
        .filter((ref) =>
          ["open_decision", "project_status"]
            .includes(
              normalizeString(ref.kind, ""),
            ));
    for (const ref of explicitSemanticObjectRefs) {
      if (!this.semanticContextObject(ref)) {
        fail(
          "operational_meta_context_required_object_missing",
          `${ref.kind}:${ref.id}:${ref.digest}`,
        );
      }
    }
    const requiredSemanticObjectRefs =
      explicitSemanticObjectRefs.map((ref) => ({
          kind: ref.kind,
          id: ref.id,
          digest: ref.digest,
          ...(normalizeString(ref.label, "")
            ? { label: ref.label }
            : {}),
        }));
    const requirementSet = buildContextRequirementSet({
      taskSettlement,
      semanticSettlement,
      compilation,
      requiredSemanticObjectRefs,
      userWorldId:
        input.userWorldId ||
        this.currentBootstrap()?.userWorld?.userWorldId,
      purpose: input.purpose,
      maxInputTokens: input.maxInputTokens,
      maxObjects: input.maxObjects,
      reserveForCurrentTurn:
        input.reserveForCurrentTurn,
      latestTurns: input.latestTurns,
      createdAt: taskSettlement.createdAt,
      now: this.now,
    });
    const importRequest =
      buildSemanticContextImportRequest({
        requirementSet,
        createdAt: taskSettlement.createdAt,
        now: this.now,
      });
    const prepared = IMPORT_CONTEXT({
      requirementSet,
      importRequest,
      compilation,
      repository: this,
      createdAt: taskSettlement.createdAt,
      now: this.now,
    });
    const cached = this.db.prepare(`
      select
        r.requirement_json,
        i.import_json,
        b.bundle_json,
        m.manifest_json,
        m.current_state,
        (
          select l.link_json
          from wm_context_request_manifest_links l
          where l.operational_meta_context_id =
            m.operational_meta_context_id
          order by l.rowid desc
          limit 1
        ) as link_json
      from wm_semantic_context_bundles b
      join wm_semantic_context_imports i
        on i.context_import_id = b.context_import_id
      join wm_context_requirement_sets r
        on r.context_requirement_set_id =
          i.context_requirement_set_id
      join wm_operational_meta_context_manifests m
        on m.context_bundle_id = b.context_bundle_id
      where b.cache_key = ?
        and b.current_state = 'current'
        and m.current_state = 'current'
      limit 1
    `).get(prepared.cacheKey);
    if (cached) {
      const record = this._operationalMetaContextRecord(
        cached,
      );
      return {
        reused: true,
        ...record,
        binding: buildOperationalMetaContextBinding(
          record,
        ),
        summary:
          rendererSafeOperationalMetaContextSummary(
            record,
            record.link,
          ),
        projectionRevision: this.revision(),
      };
    }
    return this.transaction(() => {
      const currentRequirement = this.db.prepare(`
        select requirement_digest
        from wm_context_requirement_sets
        where context_requirement_set_id = ?
      `).get(requirementSet.contextRequirementSetId);
      if (
        currentRequirement &&
        currentRequirement.requirement_digest !==
          requirementSet.digest
      ) {
        fail(
          "context_requirement_set_idempotency_conflict",
        );
      }
      this.db.prepare(`
        update wm_context_requirement_sets
        set current_state = 'stale'
        where agent_instantiation_id = ?
          and current_state = 'current'
          and context_requirement_set_id != ?
      `).run(
        requirementSet.agentInstantiationRef.id,
        requirementSet.contextRequirementSetId,
      );
      this.db.prepare(`
        insert into wm_context_requirement_sets (
          context_requirement_set_id,
          semantic_event_id,
          agent_instantiation_id,
          scope_kind,
          project_id,
          current_state,
          requirement_json,
          requirement_digest,
          created_at
        ) values (?, ?, ?, ?, ?, 'current', ?, ?, ?)
        on conflict(context_requirement_set_id)
        do update set current_state = 'current'
      `).run(
        requirementSet.contextRequirementSetId,
        requirementSet.semanticEventId,
        requirementSet.agentInstantiationRef.id,
        requirementSet.scope.kind,
        requirementSet.scope.projectId,
        json(requirementSet),
        requirementSet.digest,
        requirementSet.createdAt,
      );
      const currentImport = this.db.prepare(`
        select import_digest
        from wm_semantic_context_imports
        where context_import_id = ?
      `).get(importRequest.contextImportId);
      if (
        currentImport &&
        currentImport.import_digest !==
          importRequest.digest
      ) {
        fail(
          "semantic_context_import_idempotency_conflict",
        );
      }
      this.db.prepare(`
        insert into wm_semantic_context_imports (
          context_import_id,
          semantic_event_id,
          agent_instantiation_id,
          context_requirement_set_id,
          import_json,
          import_digest,
          created_at
        ) values (?, ?, ?, ?, ?, ?, ?)
        on conflict(context_import_id) do nothing
      `).run(
        importRequest.contextImportId,
        importRequest.semanticEventId,
        importRequest.agentInstantiationRef.id,
        requirementSet.contextRequirementSetId,
        json(importRequest),
        importRequest.digest,
        importRequest.createdAt,
      );
      this.db.prepare(`
        update wm_semantic_context_bundles
        set current_state = 'stale'
        where agent_instantiation_id = ?
          and current_state = 'current'
      `).run(
        requirementSet.agentInstantiationRef.id,
      );
      this.db.prepare(`
        update wm_operational_meta_context_manifests
        set current_state = 'stale'
        where agent_instantiation_id = ?
          and current_state = 'current'
      `).run(
        requirementSet.agentInstantiationRef.id,
      );
      this.db.prepare(`
        insert into wm_semantic_context_bundles (
          context_bundle_id,
          context_import_id,
          semantic_event_id,
          agent_instantiation_id,
          cache_key,
          dependency_digest,
          freshness,
          current_state,
          bundle_json,
          bundle_digest,
          created_at
        ) values (?, ?, ?, ?, ?, ?, ?, 'current', ?, ?, ?)
      `).run(
        prepared.bundle.contextBundleId,
        importRequest.contextImportId,
        requirementSet.semanticEventId,
        requirementSet.agentInstantiationRef.id,
        prepared.cacheKey,
        prepared.dependencyDigest,
        prepared.bundle.freshness,
        json(prepared.bundle),
        prepared.bundle.digest,
        prepared.bundle.createdAt,
      );
      this.db.prepare(`
        insert into wm_operational_meta_context_manifests (
          operational_meta_context_id,
          semantic_event_id,
          agent_instantiation_id,
          context_bundle_id,
          current_state,
          manifest_json,
          manifest_digest,
          created_at
        ) values (?, ?, ?, ?, 'current', ?, ?, ?)
      `).run(
        prepared.operationalManifest
          .operationalMetaContextId,
        requirementSet.semanticEventId,
        requirementSet.agentInstantiationRef.id,
        prepared.bundle.contextBundleId,
        json(prepared.operationalManifest),
        prepared.operationalManifest.digest,
        prepared.operationalManifest.createdAt,
      );
      const record = {
        ...prepared,
        link: null,
        currentState: "current",
      };
      return {
        reused: false,
        ...record,
        binding:
          buildOperationalMetaContextBinding(record),
        summary:
          rendererSafeOperationalMetaContextSummary(
            record,
          ),
        projectionRevision: this.incrementRevision(),
      };
    });
  }

  linkOperationalMetaContextToRequestManifest(
    input = {},
  ) {
    const operationalContext =
      input.operationalContext ||
      this.operationalMetaContextForAgentInstantiation(
        input.agentInstantiationId,
      );
    if (!operationalContext) {
      fail(
        "operational_meta_context_request_link_source_missing",
      );
    }
    const link = buildContextRequestManifestLink({
      operationalManifest:
        operationalContext.operationalManifest,
      directSessionId: input.directSessionId,
      directTurnId: input.directTurnId,
      requestManifestId: input.requestManifestId,
      now: this.now,
    });
    return this.transaction(() => {
      const existing = this.db.prepare(`
        select link_json
        from wm_context_request_manifest_links
        where context_request_manifest_link_id = ?
      `).get(link.contextRequestManifestLinkId);
      if (existing) {
        const stored = parseJson(existing.link_json, null);
        validateContextRequestManifestLink(stored);
        if (stored.digest !== link.digest) {
          fail(
            "context_request_manifest_link_idempotency_conflict",
          );
        }
        return {
          reused: true,
          link: stored,
          projectionRevision: this.revision(),
        };
      }
      this.db.prepare(`
        insert into wm_context_request_manifest_links (
          context_request_manifest_link_id,
          semantic_event_id,
          agent_instantiation_id,
          operational_meta_context_id,
          direct_session_id,
          direct_turn_id,
          request_manifest_id,
          link_json,
          link_digest,
          created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        link.contextRequestManifestLinkId,
        link.semanticEventId,
        link.agentInstantiationRef.id,
        link.operationalMetaContextRef.id,
        link.directSessionId,
        link.directTurnId,
        link.requestManifestId,
        json(link),
        link.digest,
        link.createdAt,
      );
      return {
        reused: false,
        link,
        projectionRevision: this.incrementRevision(),
      };
    });
  }

  recordRoleRunStarted(input = {}) {
    const userEvent = input.userEvent;
    const run = input.run;
    if (
      !isSemanticIngressEvent(userEvent) ||
      !run ||
      run.schema !== "direct_world_manager_role_run@1" ||
      run.sourceSemanticEventId !== userEvent.semanticEventId ||
      run.state !== "running" ||
      run.canonicalWorldstateMutation !== false ||
      run.grantsAuthority !== false
    ) {
      fail("world_manager_role_run_start_boundary");
    }
    return this.transaction(() => {
      const existing = this.db.prepare(`
        select run_json from wm_role_runs where run_id = ?
      `).get(run.runId);
      if (existing) {
        const stored = parseJson(existing.run_json, null);
        if (stored?.digest !== run.digest) {
          fail("world_manager_role_run_idempotency_conflict", run.runId);
        }
        return {
          reused: true,
          run: stored,
          projectionRevision: this.revision(),
        };
      }
      this.db.prepare(`
        insert into wm_role_runs (
          run_id, source_semantic_event_id, role_kind,
          manager_agent_id, project_id, agent_instantiation_id,
          direct_session_id, direct_turn_id, run_state, run_json,
          created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        run.runId,
        run.sourceSemanticEventId,
        run.roleKind,
        run.managerAgentId,
        run.projectId,
        run.agentInstantiationRef.id,
        run.directSessionId,
        run.directTurnId,
        run.state,
        json(run),
        run.startedAt,
        run.startedAt,
      );
      const bindingId = stableId("wm_runtime_binding", {
        roleKind: run.roleKind,
        managerAgentId: run.managerAgentId,
        projectId: run.projectId,
        lineageRootId: run.lineageRootId,
        agentInstantiationId: run.agentInstantiationRef.id,
      });
      this.db.prepare(`
        insert into wm_runtime_bindings (
          binding_id, role_kind, manager_agent_id, project_id,
          proposal_lineage_id, direct_session_id,
          current_instantiation_ref_json, state
        ) values (?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(binding_id) do update set
          direct_session_id = excluded.direct_session_id,
          current_instantiation_ref_json =
            excluded.current_instantiation_ref_json,
          state = excluded.state
      `).run(
        bindingId,
        run.roleKind,
        run.managerAgentId,
        run.projectId,
        run.lineageRootId,
        run.directSessionId,
        json(run.agentInstantiationRef),
        "running",
      );
      const transitionEvent = this.appendDerivedEventWithinTransaction({
        semanticEventId: stableId("wm_event", {
          runId: run.runId,
          transition: "role_turn_started",
        }),
        lineageRootId: userEvent.lineageRootId,
        clientRequestId: `${userEvent.clientRequestId}:k4:${run.runId}:started`,
        clientRequestDigest: digestFor(
          "direct-world-manager-k4-role-start@1",
          { userEventDigest: userEvent.eventDigest, runDigest: run.digest },
        ),
        eventKind: "role_turn_started",
        presentationState:
          run.roleKind === "world_manager" ? "reconciling" : "running",
        epistemicState: "running",
        actorRole: "direct_role_runtime",
        projectId: run.projectId,
        taskType: input.taskType,
        parentSemanticEventIds: [
          normalizeString(
            input.parentSemanticEventId,
            userEvent.semanticEventId,
          ),
        ],
        artifactRefs: [{
          kind: "direct_role_run",
          id: run.runId,
          digest: run.digest,
          label: "Persisted Direct role run",
        }],
        sourceScopeRevisions: input.sourceScopeRevisions,
        rendererSafeSummary:
          run.roleKind === "world_manager"
            ? "WorldManager reconciliation role turn started."
            : "Project Manager Direct role turn started.",
        occurredAt: run.startedAt,
      });
      return {
        reused: false,
        run,
        transitionEvent,
        projectionRevision: this.incrementRevision(),
      };
    });
  }

  commitAgentResult(input = {}) {
    const userEvent = input.userEvent;
    const run = input.run;
    const agentResult = input.agentResult;
    const finalMessage = input.finalAssistantMessage;
    const response = input.userFacingResponse;
    const telemetry = input.telemetry;
    if (
      !userEvent ||
      !run ||
      !agentResult ||
      agentResult.schema !== AGENT_RESULT_SCHEMA ||
      agentResult.sourceSemanticEventId !== userEvent.semanticEventId ||
      agentResult.agentInstantiationId !==
        run.agentInstantiationRef?.id ||
      !["completed", "remanded", "failed"].includes(
        agentResult.resultState,
      ) ||
      agentResult.worldstateChangeProposalRefs?.length ||
      agentResult.canonicalWorldstateMutation !== false ||
      agentResult.grantsAuthority !== false ||
      !finalMessage?.digest ||
      !response?.digest ||
      !telemetry?.digest ||
      response.rawProviderPayloadIncluded !== false ||
      response.rawChainOfThoughtIncluded !== false
    ) {
      fail("world_manager_agent_result_commit_boundary");
    }
    return this.transaction(() => {
      const existing = this.db.prepare(`
        select result_json from wm_agent_results
        where agent_result_id = ?
      `).get(agentResult.agentResultId);
      if (existing) {
        const stored = parseJson(existing.result_json, null);
        if (stored?.digest !== agentResult.digest) {
          fail(
            "world_manager_agent_result_idempotency_conflict",
            agentResult.agentResultId,
          );
        }
        return {
          reused: true,
          agentResult: stored,
          projectionRevision: this.revision(),
        };
      }
      this.db.prepare(`
        insert into wm_agent_results (
          agent_result_id, source_semantic_event_id, run_id, role_kind,
          result_state, output_contract_state, result_json,
          final_message_json, response_json, typed_payload_json,
          telemetry_json, created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        agentResult.agentResultId,
        userEvent.semanticEventId,
        run.runId,
        agentResult.roleKind,
        agentResult.resultState,
        agentResult.outputContractState,
        json(agentResult),
        json(finalMessage),
        json(response),
        json(input.typedPayload),
        json(telemetry),
        run.completedAt,
      );
      this.db.prepare(`
        update wm_role_runs
        set run_state = ?, run_json = ?, updated_at = ?
        where run_id = ?
      `).run(run.state, json(run), run.completedAt, run.runId);
      this.db.prepare(`
        update wm_runtime_bindings
        set state = ?
        where direct_session_id = ?
          and current_instantiation_ref_json = ?
      `).run(
        agentResult.resultState,
        run.directSessionId,
        json(run.agentInstantiationRef),
      );
      let inboxEntry = null;
      if (input.enqueue !== false) {
        inboxEntry = {
          inboxEntryId: stableId("wm_inbox_entry", {
            agentResultId: agentResult.agentResultId,
          }),
          semanticEventId: agentResult.semanticEventId,
          agentResultRef: {
            kind: "agent_result",
            id: agentResult.agentResultId,
            digest: agentResult.digest,
            label: "Manager result for WorldManager reconciliation",
          },
          deliveryState: "pending",
          attempts: 0,
          leaseOwner: "",
          leaseExpiresAt: "",
          lastError: "",
        };
        this.db.prepare(`
          insert into wm_inbox (
            inbox_entry_id, semantic_event_id, agent_result_ref_json,
            delivery_state, attempts, lease_owner, lease_expires_at,
            last_error
          ) values (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          inboxEntry.inboxEntryId,
          inboxEntry.semanticEventId,
          json(inboxEntry.agentResultRef),
          inboxEntry.deliveryState,
          inboxEntry.attempts,
          inboxEntry.leaseOwner,
          inboxEntry.leaseExpiresAt,
          inboxEntry.lastError,
        );
      }
      const transitionEvent = this.appendDerivedEventWithinTransaction({
        semanticEventId: agentResult.semanticEventId,
        lineageRootId: userEvent.lineageRootId,
        clientRequestId:
          `${userEvent.clientRequestId}:k4:${run.runId}:result`,
        clientRequestDigest: digestFor(
          "direct-world-manager-k4-agent-result@1",
          {
            userEventDigest: userEvent.eventDigest,
            runDigest: run.digest,
            agentResultDigest: agentResult.digest,
          },
        ),
        eventKind: "agent_result_completed",
        presentationState:
          agentResult.resultState === "completed"
            ? "replied"
            : agentResult.resultState,
        epistemicState:
          agentResult.resultState === "completed"
            ? "evidenced"
            : agentResult.resultState,
        actorRole:
          run.roleKind === "world_manager"
            ? "world_manager_reconciler"
            : "project_manager",
        projectId: run.projectId,
        taskType: input.taskType,
        parentSemanticEventIds: [
          stableId("wm_event", {
            runId: run.runId,
            transition: "role_turn_started",
          }),
        ],
        artifactRefs: [
          {
            kind: "agent_result",
            id: agentResult.agentResultId,
            digest: agentResult.digest,
            label: "Terminal typed AgentResult",
          },
          {
            kind: "agent_telemetry_envelope",
            id: telemetry.telemetryEnvelopeId,
            digest: telemetry.digest,
            label: "Deterministic telemetry envelope",
          },
        ],
        sourceScopeRevisions: agentResult.sourceScopeRevisions,
        rendererSafeSummary:
          agentResult.resultState === "completed"
            ? `${response.provenanceLabel}; result remains non-canonical.`
            : response.text,
        occurredAt: run.completedAt,
      });
      return {
        reused: false,
        agentResult,
        inboxEntry,
        transitionEvent,
        projectionRevision: this.incrementRevision(),
      };
    });
  }

  startReconciliation(input = {}) {
    const userEvent = input.userEvent;
    const sourceAgentResult = input.sourceAgentResult;
    if (
      !userEvent ||
      !sourceAgentResult ||
      sourceAgentResult.sourceSemanticEventId !== userEvent.semanticEventId
    ) {
      fail("world_manager_reconciliation_start_boundary");
    }
    return this.transaction(() => {
      const existing = this.db.prepare(`
        select reconciliation_json from wm_reconciliations
        where source_semantic_event_id = ?
      `).get(userEvent.semanticEventId);
      if (existing) {
        return {
          reused: true,
          reconciliation: parseJson(existing.reconciliation_json, null),
          projectionRevision: this.revision(),
        };
      }
      const inbox = this.db.prepare(`
        select * from wm_inbox
        where agent_result_ref_json = ?
          and delivery_state = 'pending'
      `).get(json({
        kind: "agent_result",
        id: sourceAgentResult.agentResultId,
        digest: sourceAgentResult.digest,
        label: "Manager result for WorldManager reconciliation",
      }));
      if (!inbox) {
        fail(
          "world_manager_reconciliation_inbox_entry_missing",
          sourceAgentResult.agentResultId,
        );
      }
      const now = nowIso(this.now);
      const leaseOwner = normalizeString(
        input.leaseOwner,
        "world_manager_reconciler",
      );
      const leaseExpiresAt = new Date(
        Date.parse(now) + 5 * 60_000,
      ).toISOString();
      this.db.prepare(`
        update wm_inbox
        set delivery_state = 'leased',
            attempts = attempts + 1,
            lease_owner = ?,
            lease_expires_at = ?
        where inbox_entry_id = ?
      `).run(leaseOwner, leaseExpiresAt, inbox.inbox_entry_id);
      const reconciliation = {
        schema: "direct_world_manager_reconciliation@1",
        reconciliationId: stableId("wm_reconciliation", {
          sourceAgentResultId: sourceAgentResult.agentResultId,
        }),
        sourceSemanticEventId: userEvent.semanticEventId,
        sourceAgentResultRef: {
          kind: "agent_result",
          id: sourceAgentResult.agentResultId,
          digest: sourceAgentResult.digest,
        },
        inboxEntryId: inbox.inbox_entry_id,
        state: "processing",
        startedAt: now,
        completedAt: "",
        reconciliationAgentResultRef: null,
        semanticSummary: "",
        blindspots: [],
        continuationPaths: [],
        recommendation: "",
        canonicalWorldstateMutation: false,
        grantsAuthority: false,
      };
      reconciliation.digest = digestFor(
        "direct_world_manager_reconciliation@1",
        reconciliation,
        ["digest"],
      );
      this.db.prepare(`
        insert into wm_reconciliations (
          reconciliation_id, source_semantic_event_id,
          source_agent_result_id, reconciliation_agent_result_id,
          reconciliation_state, reconciliation_json,
          created_at, updated_at
        ) values (?, ?, ?, '', ?, ?, ?, ?)
      `).run(
        reconciliation.reconciliationId,
        userEvent.semanticEventId,
        sourceAgentResult.agentResultId,
        reconciliation.state,
        json(reconciliation),
        now,
        now,
      );
      const transitionEvent = this.appendDerivedEventWithinTransaction({
        semanticEventId: stableId("wm_event", {
          reconciliationId: reconciliation.reconciliationId,
          transition: "reconciliation_started",
        }),
        lineageRootId: userEvent.lineageRootId,
        clientRequestId:
          `${userEvent.clientRequestId}:k4:reconciliation-started`,
        clientRequestDigest: digestFor(
          "direct-world-manager-k4-reconciliation-start@1",
          {
            userEventDigest: userEvent.eventDigest,
            sourceAgentResultDigest: sourceAgentResult.digest,
          },
        ),
        eventKind: "reconciliation_started",
        presentationState: "reconciling",
        epistemicState: "advisory",
        actorRole: "world_manager_reconciler",
        projectId: userEvent.projectId,
        taskType: input.taskType,
        parentSemanticEventIds: [sourceAgentResult.semanticEventId],
        artifactRefs: [{
          kind: "agent_result",
          id: sourceAgentResult.agentResultId,
          digest: sourceAgentResult.digest,
          label: "Same AgentResult leased from semantic inbox",
        }],
        sourceScopeRevisions: sourceAgentResult.sourceScopeRevisions,
        rendererSafeSummary:
          "WorldManager is reconciling the manager result against higher posture.",
        occurredAt: now,
      });
      return {
        reused: false,
        reconciliation,
        transitionEvent,
        projectionRevision: this.incrementRevision(),
      };
    });
  }

  completeReconciliation(input = {}) {
    const userEvent = input.userEvent;
    const sourceAgentResult = input.sourceAgentResult;
    const reconciliationAgentResult = input.reconciliationAgentResult;
    const payload = isPlainObject(input.typedPayload)
      ? input.typedPayload
      : {};
    const row = this.db.prepare(`
      select reconciliation_json from wm_reconciliations
      where source_semantic_event_id = ?
    `).get(userEvent?.semanticEventId || "");
    const current = row
      ? parseJson(row.reconciliation_json, null)
      : null;
    if (
      !current ||
      current.sourceAgentResultRef?.id !== sourceAgentResult?.agentResultId ||
      !reconciliationAgentResult ||
      reconciliationAgentResult.roleKind !== "world_manager"
    ) {
      fail("world_manager_reconciliation_complete_boundary");
    }
    return this.transaction(() => {
      const completedAt = nowIso(this.now);
      const completed = {
        ...current,
        state:
          reconciliationAgentResult.resultState === "completed"
            ? "reconciled"
            : reconciliationAgentResult.resultState,
        completedAt,
        reconciliationAgentResultRef: {
          kind: "agent_result",
          id: reconciliationAgentResult.agentResultId,
          digest: reconciliationAgentResult.digest,
        },
        semanticSummary: normalizeString(payload.semanticSummary, ""),
        blindspots: Array.isArray(payload.blindspots)
          ? payload.blindspots.map((entry) =>
              normalizeString(
                isPlainObject(entry)
                  ? entry.summary || entry.title
                  : entry,
                "",
              )).filter(Boolean)
          : [],
        continuationPaths: Array.isArray(payload.continuationPaths)
          ? payload.continuationPaths.map((entry) =>
              normalizeString(
                isPlainObject(entry)
                  ? entry.summary || entry.title
                  : entry,
                "",
              )).filter(Boolean)
          : [],
        recommendation: normalizeString(
          isPlainObject(payload.recommendation)
            ? payload.recommendation.summary ||
              payload.recommendation.title
            : payload.recommendation,
          "",
        ),
        semanticActions: (Array.isArray(payload.semanticActions)
          ? payload.semanticActions
          : []).filter(isPlainObject).map((action) => ({
            actionType: normalizeString(action.actionType, ""),
            semanticPayload: isPlainObject(action.semanticPayload)
              ? action.semanticPayload
              : {},
          })).filter((action) => action.actionType),
      };
      completed.digest = digestFor(
        "direct_world_manager_reconciliation@1",
        completed,
        ["digest"],
      );
      this.db.prepare(`
        update wm_reconciliations
        set reconciliation_agent_result_id = ?,
            reconciliation_state = ?,
            reconciliation_json = ?,
            updated_at = ?
        where reconciliation_id = ?
      `).run(
        reconciliationAgentResult.agentResultId,
        completed.state,
        json(completed),
        completedAt,
        completed.reconciliationId,
      );
      this.db.prepare(`
        update wm_inbox
        set delivery_state = ?,
            lease_owner = '',
            lease_expires_at = '',
            last_error = ?
        where inbox_entry_id = ?
      `).run(
        completed.state === "reconciled" ? "delivered" : "failed",
        completed.state === "reconciled"
          ? ""
          : input.error?.message || "reconciliation_failed",
        completed.inboxEntryId,
      );
      const transitionEvent = this.appendDerivedEventWithinTransaction({
        semanticEventId: stableId("wm_event", {
          reconciliationId: completed.reconciliationId,
          transition: "reconciliation_completed",
        }),
        lineageRootId: userEvent.lineageRootId,
        clientRequestId:
          `${userEvent.clientRequestId}:k4:reconciliation-completed`,
        clientRequestDigest: digestFor(
          "direct-world-manager-k4-reconciliation-complete@1",
          {
            sourceAgentResultDigest: sourceAgentResult.digest,
            reconciliationAgentResultDigest:
              reconciliationAgentResult.digest,
            reconciliationDigest: completed.digest,
          },
        ),
        eventKind: "reconciliation_completed",
        presentationState: completed.state,
        epistemicState:
          completed.state === "reconciled" ? "advisory" : completed.state,
        actorRole: "world_manager_reconciler",
        projectId: userEvent.projectId,
        taskType: input.taskType,
        parentSemanticEventIds: [
          reconciliationAgentResult.semanticEventId,
        ],
        artifactRefs: [
          {
            kind: "agent_result",
            id: sourceAgentResult.agentResultId,
            digest: sourceAgentResult.digest,
            label: "Reconciled manager AgentResult",
          },
          {
            kind: "agent_result",
            id: reconciliationAgentResult.agentResultId,
            digest: reconciliationAgentResult.digest,
            label: "WorldManager advisory AgentResult",
          },
        ],
        sourceScopeRevisions: sourceAgentResult.sourceScopeRevisions,
        rendererSafeSummary:
          completed.state === "reconciled"
            ? "WorldManager reconciliation completed; no canonical state was admitted."
            : "WorldManager reconciliation failed visibly.",
        occurredAt: completedAt,
      });
      return {
        reconciliation: completed,
        transitionEvent,
        projectionRevision: this.incrementRevision(),
      };
    });
  }

  listEvents(options = {}) {
    const limit = Number.isInteger(Number(options.limit)) && Number(options.limit) > 0
      ? Math.min(1000, Number(options.limit))
      : 200;
    const rows = this.db.prepare(`
      select event_json
      from (
        select sequence, event_json
        from wm_events
        order by sequence desc
        limit ?
      )
      order by sequence asc
    `).all(limit);
    return rows.map((row) => {
      const event = parseJson(row.event_json, null);
      validateWorldManagerSemanticEvent(event);
      return event;
    });
  }

  listMessages(options = {}) {
    const limit = Number.isInteger(Number(options.limit)) && Number(options.limit) > 0
      ? Math.min(1000, Number(options.limit))
      : 200;
    const rows = this.db.prepare(`
      select message_json
      from (
        select e.sequence, m.message_json
        from wm_messages m
        join wm_events e on e.semantic_event_id = m.semantic_event_id
        order by e.sequence desc
        limit ?
      )
      order by sequence asc
    `).all(limit);
    return rows.map((row) => {
      const message = parseJson(row.message_json, null);
      validateWorldManagerMessage(message);
      return message;
    });
  }

  projectGenesisCandidateById(candidateId) {
    const id = normalizeString(candidateId, "");
    if (!id) return null;
    const row = this.db.prepare(`
      select artifact_json
      from wm_candidate_artifacts
      where artifact_id = ?
        and artifact_kind = 'project_constitution'
    `).get(id);
    if (!row) return null;
    const candidate = parseJson(row.artifact_json, null);
    validateProjectConstitutionCandidate(candidate);
    return candidate;
  }

  planProposalRevisionById(proposalRevisionId) {
    const id = normalizeString(proposalRevisionId, "");
    if (!id) return null;
    const row = this.db.prepare(`
      select artifact_json, lifecycle, superseded_by_id
      from wm_candidate_artifacts
      where artifact_id = ? and artifact_kind = 'plan_proposal'
    `).get(id);
    if (!row) return null;
    const proposal = parseJson(row.artifact_json, null);
    validatePlanProposalRevision(proposal);
    return {
      ...proposal,
      state: row.lifecycle === "admitted" ? "canonical" : row.lifecycle,
      supersededById: row.superseded_by_id || "",
    };
  }

  currentPlanProposalRevision(projectId) {
    const row = this.db.prepare(`
      select artifact_id
      from wm_candidate_artifacts
      where artifact_kind = 'plan_proposal'
        and project_id = ?
        and lifecycle in ('candidate', 'candidate_reconciled')
      order by revision desc, created_at desc
      limit 1
    `).get(normalizeString(projectId, ""));
    return row ? this.planProposalRevisionById(row.artifact_id) : null;
  }

  registerPlanProposalRevision(input = {}) {
    const proposal = input.proposal;
    validatePlanProposalRevision(proposal);
    const sourceEvent = this.eventBySemanticEventId(
      proposal.sourceSemanticEventRef.id,
    );
    if (!sourceEvent || sourceEvent.eventDigest !== proposal.sourceSemanticEventRef.digest) {
      fail("world_manager_plan_proposal_source_event_mismatch");
    }
    return this.transaction(() => {
      const existing = this.planProposalRevisionById(
        proposal.proposalRevisionId,
      );
      if (existing) {
        if (existing.digest !== proposal.digest) {
          fail("world_manager_plan_proposal_idempotency_conflict");
        }
        return { reused: true, proposal: existing, projectionRevision: this.revision() };
      }
      const current = this.currentPlanProposalRevision(proposal.projectId);
      if (current) {
        if (
          !exactRefMatches(
            proposal.parentProposalRevisionRef,
            planProposalRef(current),
          ) ||
          proposal.proposalLineageId !== current.proposalLineageId ||
          proposal.revision !== current.revision + 1
        ) fail("world_manager_plan_proposal_refinement_lineage_mismatch");
        this.db.prepare(`
          update wm_candidate_artifacts
          set lifecycle = 'superseded', superseded_by_id = ?
          where artifact_id = ?
        `).run(proposal.proposalRevisionId, current.proposalRevisionId);
        this.db.prepare(`
          update wm_decisions set state = 'superseded'
          where decision_kind = 'plan_proposal_admission'
            and json_extract(target_artifact_ref_json, '$.id') = ?
            and state in ('pending', 'conflicted')
        `).run(current.proposalRevisionId);
      } else if (proposal.revision !== 1 || proposal.parentProposalRevisionRef) {
        fail("world_manager_plan_proposal_initial_revision_invalid");
      }
      this.db.prepare(`
        insert into wm_candidate_artifacts (
          artifact_id, artifact_kind, lineage_root_id, project_id,
          revision, lifecycle, artifact_json, artifact_digest,
          created_at, superseded_by_id
        ) values (?, 'plan_proposal', ?, ?, ?, 'candidate_reconciled', ?, ?, ?, '')
      `).run(
        proposal.proposalRevisionId,
        proposal.proposalLineageId,
        proposal.projectId,
        proposal.revision,
        json(proposal),
        proposal.digest,
        proposal.createdAt,
      );
      const decisionRequestId = stableId("wm_plan_proposal_decision", {
        proposalRevisionRef: planProposalRef(proposal),
      });
      this.db.prepare(`
        insert into wm_decisions (
          decision_request_id, semantic_event_id,
          target_artifact_ref_json, decision_kind, state,
          authority_requirements_json, decision_ref_json
        ) values (?, ?, ?, 'plan_proposal_admission', 'pending', ?, '{}')
      `).run(
        decisionRequestId,
        sourceEvent.semanticEventId,
        json(planProposalRef(proposal)),
        json({
          requiredActorRole: "operator",
          exactCandidateRefRequired: true,
          evidenceReviewRequired: true,
          reconciliationRequired: true,
          canonicalScopeCasRequired: true,
        }),
      );
      this._synchronizeSemanticDecisionKernelWithinTransaction();
      this._rebuildSemanticShelvesWithinTransaction();
      const transitionEvent = this.appendDerivedEventWithinTransaction({
        semanticEventId: stableId("wm_event", {
          proposalRevisionId: proposal.proposalRevisionId,
          transition: "plan_proposal_revision_registered",
        }),
        lineageRootId: proposal.proposalLineageId,
        clientRequestId: `${sourceEvent.clientRequestId}:k5:plan-v${proposal.revision}`,
        clientRequestDigest: digestFor("direct-world-manager-k5-plan-registration@1", {
          proposalDigest: proposal.digest,
        }),
        eventKind: "plan_proposal_revision_registered",
        presentationState: "candidate",
        epistemicState: "candidate",
        actorRole: "world_manager_reconciler",
        projectId: proposal.projectId,
        taskType: "project_planning",
        parentSemanticEventIds: [sourceEvent.semanticEventId],
        artifactRefs: [planProposalRef(proposal)],
        sourceScopeRevisions: proposal.expectedCanonicalRevisionRefs,
        rendererSafeSummary:
          `Plan proposal v${proposal.revision} was registered after WorldManager reconciliation. It remains non-canonical.`,
        occurredAt: proposal.createdAt,
      });
      return {
        reused: false,
        proposal,
        decisionRequestId,
        transitionEvent,
        projectionRevision: this.incrementRevision(),
      };
    });
  }

  reviewPlanProposalRevision(input = {}) {
    const proposal = this.planProposalRevisionById(input.proposalRevisionId);
    if (!proposal || proposal.digest !== normalizeString(input.proposalDigest, proposal?.digest || "")) {
      fail("world_manager_plan_proposal_stale_or_unknown");
    }
    const receipt = buildPlanProposalReviewReceipt({
      proposalRevisionRef: planProposalRef(proposal),
      actorId: input.actorId,
      reviewedAt: input.reviewedAt || nowIso(this.now),
    });
    return this.transaction(() => {
      const existing = this.db.prepare(`
        select review_json from wm_plan_proposal_reviews
        where proposal_revision_id = ?
      `).get(proposal.proposalRevisionId);
      if (existing) {
        return {
          reused: true,
          proposal,
          reviewReceipt: parseJson(existing.review_json, null),
          projectionRevision: this.revision(),
        };
      }
      this.db.prepare(`
        insert into wm_plan_proposal_reviews (
          review_receipt_id, proposal_revision_id, review_json,
          review_digest, reviewed_at
        ) values (?, ?, ?, ?, ?)
      `).run(
        receipt.reviewReceiptId,
        proposal.proposalRevisionId,
        json(receipt),
        receipt.digest,
        receipt.reviewedAt,
      );
      return {
        reused: false,
        proposal,
        reviewReceipt: receipt,
        projectionRevision: this.incrementRevision(),
      };
    });
  }

  beginPlanProposalAdmission(input = {}) {
    const proposal = this.planProposalRevisionById(input.proposalRevisionId);
    if (!proposal || proposal.digest !== normalizeString(input.proposalDigest, "")) {
      fail("world_manager_plan_proposal_stale_or_unknown");
    }
    const completedAdmission = this.db.prepare(`
      select * from wm_plan_admissions
      where proposal_revision_id = ? and state = 'contract_received'
    `).get(proposal.proposalRevisionId);
    if (completedAdmission) {
      return {
        reused: true,
        proposal,
        reviewReceipt: null,
        request: parseJson(completedAdmission.request_json, null),
        state: completedAdmission.state,
      };
    }
    if (!['candidate', 'candidate_reconciled'].includes(proposal.state)) {
      fail("world_manager_plan_proposal_not_current_candidate");
    }
    const reviewRow = this.db.prepare(`
      select review_json from wm_plan_proposal_reviews
      where proposal_revision_id = ?
    `).get(proposal.proposalRevisionId);
    if (!reviewRow) fail("world_manager_plan_proposal_evidence_not_reviewed");
    const reviewReceipt = parseJson(reviewRow.review_json, null);
    const request = buildPlanAdmissionRequest({
      proposalRevisionRef: planProposalRef(proposal),
      reviewReceiptRef: {
        kind: "plan_proposal_review_receipt",
        id: reviewReceipt.reviewReceiptId,
        digest: reviewReceipt.digest,
        projectId: proposal.projectId,
      },
      projectId: proposal.projectId,
      actorId: input.actorId,
      expectedCanonicalRevisionRefs: proposal.expectedCanonicalRevisionRefs,
      requestedAt: input.requestedAt || nowIso(this.now),
    });
    return this.transaction(() => {
      const existing = this.db.prepare(`
        select * from wm_plan_admissions where proposal_revision_id = ?
      `).get(proposal.proposalRevisionId);
      if (existing) {
        const persisted = parseJson(existing.request_json, null);
        if (persisted.digest !== request.digest) {
          fail("world_manager_plan_admission_idempotency_conflict");
        }
        return { reused: true, proposal, reviewReceipt, request: persisted, state: existing.state };
      }
      this.db.prepare(`
        insert into wm_plan_admissions (
          admission_request_id, proposal_revision_id, request_json,
          request_digest, state, updated_at
        ) values (?, ?, ?, ?, 'pending_graph_admission', ?)
      `).run(
        request.admissionRequestId,
        proposal.proposalRevisionId,
        json(request),
        request.digest,
        request.requestedAt,
      );
      return { reused: false, proposal, reviewReceipt, request, state: "pending_graph_admission" };
    });
  }

  recordPlanAdmissionProgress(input = {}) {
    const requestId = normalizeString(input.admissionRequestId, "");
    const state = normalizeString(input.state, "");
    if (!requestId || ![
      "graph_admitted", "contract_received", "pending_repair", "stale_conflict",
    ].includes(state)) fail("world_manager_plan_admission_progress_invalid");
    return this.transaction(() => {
      const row = this.db.prepare(`
        select * from wm_plan_admissions where admission_request_id = ?
      `).get(requestId);
      if (!row) fail("world_manager_plan_admission_request_missing");
      this.db.prepare(`
        update wm_plan_admissions
        set state = ?, decision_json = ?, decision_digest = ?,
            implementation_contract_id = ?, work_thread_id = ?,
            last_error = ?, updated_at = ?
        where admission_request_id = ?
      `).run(
        state,
        json(input.decision || parseJson(row.decision_json, {})),
        input.decision?.digest || row.decision_digest,
        input.implementationContract?.implementationContractId || row.implementation_contract_id,
        input.workThreadId || row.work_thread_id,
        normalizeString(input.error, ""),
        normalizeString(input.updatedAt, nowIso(this.now)),
        requestId,
      );
      if (input.implementationContract) {
        const contract = input.implementationContract;
        this.db.prepare(`
          insert into wm_implementation_contracts (
            implementation_contract_id, project_id, proposal_revision_id,
            contract_json, contract_digest, state, work_thread_id, created_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?)
          on conflict(implementation_contract_id) do update set
            state = excluded.state,
            contract_json = excluded.contract_json,
            contract_digest = excluded.contract_digest
        `).run(
          contract.implementationContractId,
          contract.projectId,
          parseJson(row.request_json, {}).proposalRevisionRef?.id || "",
          json(contract),
          contract.digest,
          contract.state,
          contract.workThreadId,
          contract.createdAt,
        );
      }
      if (state === "contract_received") {
        const request = parseJson(row.request_json, null);
        this.db.prepare(`
          update wm_candidate_artifacts set lifecycle = 'admitted'
          where artifact_id = ?
        `).run(request.proposalRevisionRef.id);
        this.db.prepare(`
          update wm_decisions set state = 'admitted', decision_ref_json = ?
          where decision_kind = 'plan_proposal_admission'
            and json_extract(target_artifact_ref_json, '$.id') = ?
        `).run(json({
          kind: "plan_admission_decision",
          id: input.decision.admissionDecisionId,
          digest: input.decision.digest,
        }), request.proposalRevisionRef.id);
        this._synchronizeSemanticDecisionKernelWithinTransaction();
        this._rebuildSemanticShelvesWithinTransaction();
      } else if (state === "stale_conflict") {
        const request = parseJson(row.request_json, null);
        this.db.prepare(`
          update wm_decisions set state = 'conflicted'
          where decision_kind = 'plan_proposal_admission'
            and json_extract(target_artifact_ref_json, '$.id') = ?
        `).run(request.proposalRevisionRef.id);
        this._synchronizeSemanticDecisionKernelWithinTransaction();
        this._rebuildSemanticShelvesWithinTransaction();
      }
      return { state, projectionRevision: this.incrementRevision() };
    });
  }

  listPlanProposalRevisions(options = {}) {
    const projectId = normalizeString(options.projectId, "");
    const rows = this.db.prepare(`
      select artifact_id from wm_candidate_artifacts
      where artifact_kind = 'plan_proposal'
        ${projectId ? "and project_id = ?" : ""}
      order by created_at asc, revision asc
    `).all(...(projectId ? [projectId] : []));
    return rows.map((row) => {
      const proposal = this.planProposalRevisionById(row.artifact_id);
      const review = this.db.prepare(`
        select review_json from wm_plan_proposal_reviews
        where proposal_revision_id = ?
      `).get(row.artifact_id);
      return {
        ...proposal,
        evidenceReviewState: review ? "reviewed" : "unreviewed",
        reviewReceipt: review ? parseJson(review.review_json, null) : null,
      };
    });
  }

  listPlanAdmissions(options = {}) {
    const states = Array.isArray(options.states) ? options.states : [];
    const rows = this.db.prepare(`
      select * from wm_plan_admissions
      ${states.length ? `where state in (${states.map(() => "?").join(",")})` : ""}
      order by updated_at asc
    `).all(...states);
    return rows.map((row) => ({
      request: parseJson(row.request_json, null),
      decision: parseJson(row.decision_json, null),
      state: row.state,
      implementationContractId: row.implementation_contract_id,
      workThreadId: row.work_thread_id,
      lastError: row.last_error,
      updatedAt: row.updated_at,
    }));
  }

  listImplementationContracts() {
    return this.db.prepare(`
      select contract_json from wm_implementation_contracts
      order by created_at asc
    `).all().map((row) => parseJson(row.contract_json, null)).filter(Boolean);
  }

  realizationSnapshotByRef(ref = {}) {
    const row = this.db.prepare(`
      select snapshot_json
      from wm_realization_snapshots
      where snapshot_id = ?
        and snapshot_digest = ?
    `).get(
      normalizeString(ref.id, ""),
      normalizeString(ref.digest, ""),
    );
    if (!row) return null;
    const snapshot = parseJson(row.snapshot_json, null);
    validateRealizationOptionSnapshot(snapshot);
    return snapshot;
  }

  registerProjectGenesisCandidate(input = {}) {
    const userEvent = input.userEvent;
    const candidate = input.candidate;
    const realizationSnapshot = input.realizationSnapshot;
    validateProjectConstitutionCandidate(candidate);
    validateRealizationOptionSnapshot(realizationSnapshot);
    if (
      !userEvent ||
      userEvent.semanticEventId !==
        candidate.sourceSemanticEventRef.id ||
      candidate.realizationSnapshotRef.id !==
        realizationSnapshot.snapshotId ||
      candidate.realizationSnapshotRef.digest !==
        realizationSnapshot.digest ||
      candidate.lifecycle !== "candidate" ||
      candidate.reconciliationState !== "reconciled"
    ) {
      fail("world_manager_project_genesis_candidate_commit_boundary");
    }
    return this.transaction(() => {
      const existing = this.projectGenesisCandidateById(
        candidate.candidateId,
      );
      if (existing) {
        if (existing.digest !== candidate.digest) {
          fail(
            "world_manager_project_genesis_candidate_idempotency_conflict",
            candidate.candidateId,
          );
        }
        return {
          reused: true,
          candidate: existing,
          projectionRevision: this.revision(),
        };
      }
      const projectConflict = this.db.prepare(`
        select artifact_id
        from wm_candidate_artifacts
        where artifact_kind = 'project_constitution'
          and project_id = ?
          and lifecycle in ('candidate', 'admitted')
      `).get(candidate.proposedProjectId);
      const canonicalConflict = this.db.prepare(`
        select project_id
        from wm_project_constitutions
        where project_id = ?
      `).get(candidate.proposedProjectId);
      if (projectConflict || canonicalConflict) {
        fail(
          "world_manager_project_genesis_project_id_conflict",
          candidate.proposedProjectId,
        );
      }
      this.db.prepare(`
        insert into wm_realization_snapshots (
          snapshot_id, snapshot_json, snapshot_digest, observed_at
        ) values (?, ?, ?, ?)
        on conflict(snapshot_id) do nothing
      `).run(
        realizationSnapshot.snapshotId,
        json(realizationSnapshot),
        realizationSnapshot.digest,
        realizationSnapshot.observedAt,
      );
      this.db.prepare(`
        insert into wm_candidate_artifacts (
          artifact_id, artifact_kind, lineage_root_id, project_id,
          revision, lifecycle, artifact_json, artifact_digest,
          created_at, superseded_by_id
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, '')
      `).run(
        candidate.candidateId,
        candidate.artifactKind,
        candidate.lineageRootId,
        candidate.proposedProjectId,
        candidate.revision,
        candidate.lifecycle,
        json(candidate),
        candidate.digest,
        candidate.createdAt,
      );
      const decisionRequestId = stableId(
        "wm_project_constitution_decision",
        { candidateDigest: candidate.digest },
      );
      const targetArtifactRef = {
        kind: "project_constitution_candidate",
        id: candidate.candidateId,
        digest: candidate.digest,
        projectId: candidate.proposedProjectId,
      };
      this.db.prepare(`
        insert into wm_decisions (
          decision_request_id, semantic_event_id,
          target_artifact_ref_json, decision_kind, state,
          authority_requirements_json, decision_ref_json
        ) values (?, ?, ?, ?, ?, ?, '{}')
      `).run(
        decisionRequestId,
        userEvent.semanticEventId,
        json(targetArtifactRef),
        "project_constitution_admission",
        "pending",
        json({
          requiredActorRole: "operator",
          evidenceReviewRequired: true,
          reconciliationRequired: true,
          exactCandidateRefRequired: true,
        }),
      );
      const semanticDecisionKernel =
        this._synchronizeSemanticDecisionKernelWithinTransaction();
      const rebuiltSemanticShelfCount =
        this._rebuildSemanticShelvesWithinTransaction();
      const transitionEvent = this.appendDerivedEventWithinTransaction({
        semanticEventId: stableId("wm_event", {
          candidateId: candidate.candidateId,
          transition: "project_constitution_candidate_registered",
        }),
        lineageRootId: candidate.lineageRootId,
        clientRequestId:
          `${userEvent.clientRequestId}:k5g:project-candidate`,
        clientRequestDigest: digestFor(
          "direct-world-manager-k5g-candidate-registration@1",
          {
            userEventDigest: userEvent.eventDigest,
            candidateDigest: candidate.digest,
            realizationSnapshotDigest: realizationSnapshot.digest,
          },
        ),
        eventKind: "project_constitution_candidate_registered",
        presentationState: "candidate",
        epistemicState: "candidate",
        actorRole: "world_manager_reconciler",
        projectId: candidate.proposedProjectId,
        taskType: "project_initialization",
        parentSemanticEventIds: [userEvent.semanticEventId],
        artifactRefs: [
          targetArtifactRef,
          {
            kind: "realization_option_snapshot",
            id: realizationSnapshot.snapshotId,
            digest: realizationSnapshot.digest,
            label: "Harness-observed realization options",
          },
        ],
        sourceScopeRevisions: [],
        rendererSafeSummary:
          "A reconciled project constitution candidate was registered. It remains non-canonical until evidence review and explicit admission.",
        occurredAt: candidate.createdAt,
      });
      return {
        reused: false,
        candidate,
        decisionRequestId,
        semanticDecisionKernel,
        rebuiltSemanticShelfCount,
        transitionEvent,
        projectionRevision: this.incrementRevision(),
      };
    });
  }

  reviewProjectGenesisCandidate(input = {}) {
    const candidateId = normalizeString(input.candidateId, "");
    const reviewedAt = normalizeString(
      input.reviewedAt,
      nowIso(this.now),
    );
    return this.transaction(() => {
      const candidate = this.projectGenesisCandidateById(candidateId);
      if (!candidate) {
        fail(
          "world_manager_project_genesis_candidate_missing",
          candidateId,
        );
      }
      if (candidate.evidenceReviewState === "reviewed") {
        return {
          reused: true,
          candidate,
          projectionRevision: this.revision(),
        };
      }
      const reviewed = reviewedProjectConstitutionCandidate(
        candidate,
        reviewedAt,
      );
      this.db.prepare(`
        update wm_candidate_artifacts
        set artifact_json = ?, artifact_digest = ?
        where artifact_id = ?
      `).run(json(reviewed), reviewed.digest, reviewed.candidateId);
      this.db.prepare(`
        update wm_decisions
        set target_artifact_ref_json = ?
        where decision_kind = 'project_constitution_admission'
          and json_extract(target_artifact_ref_json, '$.id') = ?
          and state = 'pending'
      `).run(json({
        kind: "project_constitution_candidate",
        id: reviewed.candidateId,
        digest: reviewed.digest,
        projectId: reviewed.proposedProjectId,
      }), reviewed.candidateId);
      const semanticDecisionKernel =
        this._synchronizeSemanticDecisionKernelWithinTransaction();
      const rebuiltSemanticShelfCount =
        this._rebuildSemanticShelvesWithinTransaction();
      const sourceEvent = this.eventBySemanticEventId(
        reviewed.sourceSemanticEventRef.id,
      );
      const transitionEvent = this.appendDerivedEventWithinTransaction({
        semanticEventId: stableId("wm_event", {
          candidateId: reviewed.candidateId,
          transition: "project_constitution_evidence_reviewed",
        }),
        lineageRootId: reviewed.lineageRootId,
        clientRequestId:
          `${sourceEvent.clientRequestId}:k6g:evidence-reviewed`,
        clientRequestDigest: digestFor(
          "direct-world-manager-k6g-evidence-review@1",
          { candidateDigest: reviewed.digest },
        ),
        eventKind: "project_constitution_evidence_reviewed",
        presentationState: "evidence_reviewed",
        epistemicState: "validated",
        actorRole: "operator",
        projectId: reviewed.proposedProjectId,
        taskType: "project_initialization",
        parentSemanticEventIds: [
          stableId("wm_event", {
            candidateId: reviewed.candidateId,
            transition:
              "project_constitution_candidate_registered",
          }),
        ],
        artifactRefs: [{
          kind: "project_constitution_candidate",
          id: reviewed.candidateId,
          digest: reviewed.digest,
          label: "Evidence-reviewed project constitution candidate",
        }],
        sourceScopeRevisions: [],
        rendererSafeSummary:
          "The operator inspected the substrate evidence and candidate lineage. The project constitution remains non-canonical.",
        occurredAt: reviewedAt,
      });
      return {
        reused: false,
        candidate: reviewed,
        semanticDecisionKernel,
        rebuiltSemanticShelfCount,
        transitionEvent,
        projectionRevision: this.incrementRevision(),
      };
    });
  }

  admitProjectGenesisCandidate(input = {}) {
    const candidateId = normalizeString(input.candidateId, "");
    const actorId = normalizeString(input.actorId, "operator");
    const admittedAt = normalizeString(
      input.admittedAt,
      nowIso(this.now),
    );
    return this.transaction(() => {
      const candidate = this.projectGenesisCandidateById(candidateId);
      if (!candidate) {
        fail(
          "world_manager_project_genesis_candidate_missing",
          candidateId,
        );
      }
      const existing = this.db.prepare(`
        select constitution_json
        from wm_project_constitutions
        where project_id = ?
      `).get(candidate.proposedProjectId);
      if (existing) {
        const constitution = parseJson(
          existing.constitution_json,
          null,
        );
        if (
          constitution?.admittedFromCandidateRef?.id !==
            candidate.candidateId
        ) {
          fail(
            "world_manager_project_genesis_project_id_conflict",
            candidate.proposedProjectId,
          );
        }
        return {
          reused: true,
          constitution,
          runtimeBinding:
            this.projectRuntimeDefault(candidate.proposedProjectId),
          projectionRevision: this.revision(),
        };
      }
      const realizationSnapshot = this.realizationSnapshotByRef(
        candidate.realizationSnapshotRef,
      );
      if (!realizationSnapshot) {
        fail(
          "world_manager_project_genesis_realization_snapshot_missing",
        );
      }
      const admitted = admitProjectConstitution({
        candidate,
        realizationSnapshot,
        actorId,
        admittedAt,
      });
      this.db.prepare(`
        insert into wm_project_constitutions (
          project_id, constitution_json, constitution_digest,
          activation_state, admitted_at
        ) values (?, ?, ?, ?, ?)
      `).run(
        admitted.constitution.projectId,
        json(admitted.constitution),
        admitted.constitution.digest,
        admitted.constitution.activationState,
        admittedAt,
      );
      this.db.prepare(`
        insert into wm_project_runtime_defaults (
          binding_id, project_id, binding_json, binding_digest,
          activation_state, created_at
        ) values (?, ?, ?, ?, ?, ?)
      `).run(
        admitted.runtimeBinding.bindingId,
        admitted.runtimeBinding.projectId,
        json(admitted.runtimeBinding),
        admitted.runtimeBinding.digest,
        admitted.runtimeBinding.activationState,
        admittedAt,
      );
      const admittedCandidate = {
        ...candidate,
        lifecycle: "admitted",
        activationState:
          admitted.constitution.activationState,
        admittedConstitutionRef:
          admitted.runtimeBinding.constitutionRef,
        admissionDecisionRef:
          admitted.constitution.admissionDecisionRef,
      };
      admittedCandidate.digest = digestFor(
        admittedCandidate.schema,
        admittedCandidate,
        ["digest"],
      );
      validateProjectConstitutionCandidate(admittedCandidate);
      this.db.prepare(`
        update wm_candidate_artifacts
        set lifecycle = 'admitted',
            artifact_json = ?,
            artifact_digest = ?,
            superseded_by_id = ?
        where artifact_id = ?
      `).run(
        json(admittedCandidate),
        admittedCandidate.digest,
        admitted.constitution.projectId,
        admittedCandidate.candidateId,
      );
      this.db.prepare(`
        update wm_decisions
        set state = 'admitted', decision_ref_json = ?
        where decision_kind = 'project_constitution_admission'
          and json_extract(target_artifact_ref_json, '$.id') = ?
          and state = 'pending'
      `).run(
        json({
          kind: "project_constitution_admission",
          id: admitted.decision.admissionDecisionId,
          digest: admitted.decision.digest,
        }),
        admittedCandidate.candidateId,
      );
      const semanticDecisionKernel =
        this._synchronizeSemanticDecisionKernelWithinTransaction();
      const rebuiltSemanticShelfCount =
        this._rebuildSemanticShelvesWithinTransaction();
      const sourceEvent = this.eventBySemanticEventId(
        admittedCandidate.sourceSemanticEventRef.id,
      );
      const transitionEvent = this.appendDerivedEventWithinTransaction({
        semanticEventId: stableId("wm_event", {
          candidateId: admittedCandidate.candidateId,
          transition: "project_constitution_admitted",
        }),
        lineageRootId: admittedCandidate.lineageRootId,
        clientRequestId:
          `${sourceEvent.clientRequestId}:k6g:constitution-admitted`,
        clientRequestDigest: digestFor(
          "direct-world-manager-k6g-constitution-admission@1",
          {
            candidateDigest: admittedCandidate.digest,
            constitutionDigest: admitted.constitution.digest,
            decisionDigest: admitted.decision.digest,
          },
        ),
        eventKind: "project_constitution_admitted",
        presentationState: "canonical",
        epistemicState: "accepted",
        authorityState: "authoritative",
        actorRole: "operator",
        projectId: admitted.constitution.projectId,
        taskType: "project_initialization",
        parentSemanticEventIds: [
          stableId("wm_event", {
            candidateId: admittedCandidate.candidateId,
            transition:
              "project_constitution_evidence_reviewed",
          }),
        ],
        artifactRefs: [
          admitted.runtimeBinding.constitutionRef,
          {
            kind: "project_runtime_default_binding",
            id: admitted.runtimeBinding.bindingId,
            digest: admitted.runtimeBinding.digest,
            label: "Canonical project runtime default",
          },
          {
            kind: "project_constitution_admission",
            id: admitted.decision.admissionDecisionId,
            digest: admitted.decision.digest,
            label: "Explicit operator admission",
          },
        ],
        sourceScopeRevisions: [],
        rendererSafeSummary:
          "The operator admitted the project constitution and immutable default substrate. Workspace provisioning remains pending.",
        occurredAt: admittedAt,
      });
      return {
        reused: false,
        candidate: admittedCandidate,
        ...admitted,
        semanticDecisionKernel,
        rebuiltSemanticShelfCount,
        transitionEvent,
        projectionRevision: this.incrementRevision(),
      };
    });
  }

  registerProjectSubstrateProvisioning(input = {}) {
    const workspaceBinding = input.workspaceBinding;
    const workspaceLocator = input.workspaceLocator;
    const environmentProbe = input.environmentProbe;
    validateProjectWorkspaceBinding(workspaceBinding);
    validateProjectWorkspaceLocator(workspaceLocator);
    validateEnvironmentProbeReceipt(environmentProbe);
    const projectId = workspaceBinding.projectId;
    const runtimeDefault = this.projectRuntimeDefault(projectId);
    const constitution = this.listProjectConstitutions().find((entry) =>
      entry.projectId === projectId);
    if (!runtimeDefault || !constitution) {
      fail("world_manager_project_substrate_constitution_missing", projectId);
    }
    if (
      workspaceLocator.projectId !== projectId ||
      workspaceLocator.environmentId !== workspaceBinding.environmentId ||
      environmentProbe.projectId !== projectId ||
      environmentProbe.environmentId !== workspaceBinding.environmentId ||
      workspaceBinding.environmentId !== runtimeDefault.defaultEnvironmentId ||
      workspaceBinding.runtimeDefaultBindingRef.id !== runtimeDefault.bindingId ||
      workspaceBinding.runtimeDefaultBindingRef.digest !== runtimeDefault.digest ||
      workspaceBinding.locatorRef.id !== workspaceLocator.locatorId ||
      workspaceBinding.locatorRef.digest !== workspaceLocator.digest ||
      workspaceBinding.probeRef.id !== environmentProbe.probeReceiptId ||
      workspaceBinding.probeRef.digest !== environmentProbe.digest ||
      environmentProbe.probeState !== "ready"
    ) {
      fail("world_manager_project_substrate_provisioning_binding_mismatch");
    }
    return this.transaction(() => {
      const existing = this.db.prepare(`
        select binding_json
        from wm_project_workspace_bindings
        where project_id = ?
      `).get(projectId);
      if (existing) {
        const binding = parseJson(existing.binding_json, null);
        validateProjectWorkspaceBinding(binding);
        if (binding.digest !== workspaceBinding.digest) {
          fail("world_manager_project_workspace_port_operation_required", projectId);
        }
        return {
          reused: true,
          workspaceBinding: binding,
          environmentProbe:
            this.environmentProbeByRef(binding.probeRef),
          projectionRevision: this.revision(),
        };
      }
      this.db.prepare(`
        insert into wm_project_workspace_locators (
          locator_id, project_id, environment_id,
          locator_json, locator_digest, created_at
        ) values (?, ?, ?, ?, ?, ?)
      `).run(
        workspaceLocator.locatorId,
        projectId,
        workspaceLocator.environmentId,
        json(workspaceLocator),
        workspaceLocator.digest,
        workspaceLocator.createdAt,
      );
      this.db.prepare(`
        insert into wm_environment_probe_receipts (
          probe_receipt_id, project_id, environment_id,
          probe_state, receipt_json, receipt_digest, observed_at
        ) values (?, ?, ?, ?, ?, ?, ?)
      `).run(
        environmentProbe.probeReceiptId,
        projectId,
        environmentProbe.environmentId,
        environmentProbe.probeState,
        json(environmentProbe),
        environmentProbe.digest,
        environmentProbe.observedAt,
      );
      this.db.prepare(`
        insert into wm_project_workspace_bindings (
          workspace_binding_id, project_id, environment_id,
          binding_json, binding_digest, provisioning_state, created_at
        ) values (?, ?, ?, ?, ?, ?, ?)
      `).run(
        workspaceBinding.workspaceBindingId,
        projectId,
        workspaceBinding.environmentId,
        json(workspaceBinding),
        workspaceBinding.digest,
        workspaceBinding.provisioningState,
        workspaceBinding.createdAt,
      );
      const candidate = this.projectGenesisCandidateById(
        constitution.admittedFromCandidateRef?.id,
      );
      const transitionEvent = this.appendDerivedEventWithinTransaction({
        semanticEventId: stableId("wm_event", {
          projectId,
          transition: "project_substrate_provisioned",
          workspaceBindingDigest: workspaceBinding.digest,
        }),
        lineageRootId:
          candidate?.lineageRootId ||
          `lineage_${projectId}`,
        clientRequestId:
          `project-substrate:${projectId}:${workspaceBinding.workspaceBindingId}`,
        clientRequestDigest: digestFor(
          "direct-world-manager-project-substrate-provisioning@1",
          {
            projectId,
            workspaceBindingDigest: workspaceBinding.digest,
            probeDigest: environmentProbe.digest,
          },
        ),
        eventKind: "project_substrate_provisioned",
        presentationState: "canonical",
        epistemicState: "accepted",
        authorityState: "authoritative",
        actorRole: "operator",
        projectId,
        taskType: "project_runtime_provisioning",
        parentSemanticEventIds: [
          stableId("wm_event", {
            candidateId: candidate?.candidateId || "",
            transition: "project_constitution_admitted",
          }),
        ].filter((id) => candidate?.candidateId && id),
        artifactRefs: [
          {
            kind: "project_workspace_binding",
            id: workspaceBinding.workspaceBindingId,
            digest: workspaceBinding.digest,
            label: "Canonical project workspace binding",
          },
          {
            kind: "environment_probe_receipt",
            id: environmentProbe.probeReceiptId,
            digest: environmentProbe.digest,
            label: "Native environment probe",
          },
        ],
        sourceScopeRevisions: [],
        rendererSafeSummary:
          "The admitted project default is bound to a native workspace and a ready Direct execution adapter. The private native path remains backend-only.",
        occurredAt: workspaceBinding.createdAt,
      });
      return {
        reused: false,
        workspaceBinding,
        environmentProbe,
        transitionEvent,
        projectionRevision: this.incrementRevision(),
      };
    });
  }

  registerThreadEnvironmentBinding(input = {}) {
    const binding = input.binding || input;
    validateThreadEnvironmentBinding(binding);
    const workspaceBinding = this.projectWorkspaceBinding(binding.projectId);
    const runtimeDefault = this.projectRuntimeDefault(binding.projectId);
    if (
      !workspaceBinding ||
      !runtimeDefault ||
      binding.workspaceBindingRef.id !== workspaceBinding.workspaceBindingId ||
      binding.workspaceBindingRef.digest !== workspaceBinding.digest ||
      binding.projectRuntimeDefaultRef.id !== runtimeDefault.bindingId ||
      binding.projectRuntimeDefaultRef.digest !== runtimeDefault.digest
    ) {
      fail("world_manager_thread_environment_parent_binding_mismatch");
    }
    return this.transaction(() => {
      const row = this.db.prepare(`
        select binding_json
        from wm_thread_environment_bindings
        where thread_id = ?
      `).get(binding.threadId);
      if (row) {
        const existing = parseJson(row.binding_json, null);
        validateThreadEnvironmentBinding(existing);
        if (existing.digest !== binding.digest) {
          fail("world_manager_thread_environment_binding_immutable", binding.threadId);
        }
        return { reused: true, binding: existing, projectionRevision: this.revision() };
      }
      this.db.prepare(`
        insert into wm_thread_environment_bindings (
          thread_environment_binding_id, thread_id, work_thread_id,
          project_id, binding_json, binding_digest, created_at
        ) values (?, ?, ?, ?, ?, ?, ?)
      `).run(
        binding.threadEnvironmentBindingId,
        binding.threadId,
        binding.workThreadId,
        binding.projectId,
        json(binding),
        binding.digest,
        binding.createdAt,
      );
      return {
        reused: false,
        binding,
        projectionRevision: this.incrementRevision(),
      };
    });
  }

  registerEnvironmentProbeReceipt(input = {}) {
    const receipt = input.receipt || input;
    validateEnvironmentProbeReceipt(receipt);
    const workspaceBinding = this.projectWorkspaceBinding(receipt.projectId);
    if (
      !workspaceBinding ||
      workspaceBinding.environmentId !== receipt.environmentId
    ) {
      fail("world_manager_environment_probe_workspace_binding_mismatch");
    }
    return this.transaction(() => {
      const row = this.db.prepare(`
        select receipt_json
        from wm_environment_probe_receipts
        where probe_receipt_id = ?
      `).get(receipt.probeReceiptId);
      if (row) {
        const existing = parseJson(row.receipt_json, null);
        validateEnvironmentProbeReceipt(existing);
        if (existing.digest !== receipt.digest) {
          fail("world_manager_environment_probe_receipt_conflict");
        }
        return { reused: true, receipt: existing, projectionRevision: this.revision() };
      }
      this.db.prepare(`
        insert into wm_environment_probe_receipts (
          probe_receipt_id, project_id, environment_id,
          probe_state, receipt_json, receipt_digest, observed_at
        ) values (?, ?, ?, ?, ?, ?, ?)
      `).run(
        receipt.probeReceiptId,
        receipt.projectId,
        receipt.environmentId,
        receipt.probeState,
        json(receipt),
        receipt.digest,
        receipt.observedAt,
      );
      return {
        reused: false,
        receipt,
        projectionRevision: this.incrementRevision(),
      };
    });
  }

  registerStepEnvironmentSnapshot(input = {}) {
    const snapshot = input.snapshot || input;
    validateStepEnvironmentSnapshot(snapshot);
    const threadBinding = this.threadEnvironmentBinding(snapshot.threadId);
    if (
      !threadBinding ||
      snapshot.threadEnvironmentBindingRef.id !==
        threadBinding.threadEnvironmentBindingId ||
      snapshot.threadEnvironmentBindingRef.digest !== threadBinding.digest
    ) {
      fail("world_manager_step_environment_thread_binding_mismatch");
    }
    return this.transaction(() => {
      const row = this.db.prepare(`
        select snapshot_json
        from wm_step_environment_snapshots
        where thread_id = ? and step_id = ?
      `).get(snapshot.threadId, snapshot.stepId);
      if (row) {
        const existing = parseJson(row.snapshot_json, null);
        validateStepEnvironmentSnapshot(existing);
        if (existing.digest !== snapshot.digest) {
          fail("world_manager_step_environment_snapshot_conflict", snapshot.stepId);
        }
        return { reused: true, snapshot: existing, projectionRevision: this.revision() };
      }
      this.db.prepare(`
        insert into wm_step_environment_snapshots (
          step_environment_snapshot_id, thread_id, step_id,
          project_id, snapshot_json, snapshot_digest, observed_at
        ) values (?, ?, ?, ?, ?, ?, ?)
      `).run(
        snapshot.stepEnvironmentSnapshotId,
        snapshot.threadId,
        snapshot.stepId,
        snapshot.projectId,
        json(snapshot),
        snapshot.digest,
        snapshot.observedAt,
      );
      return {
        reused: false,
        snapshot,
        projectionRevision: this.incrementRevision(),
      };
    });
  }

  registerChildEnvironmentInheritance(input = {}) {
    const inheritance = input.inheritance || input;
    validateChildEnvironmentInheritance(inheritance);
    const parent = this.stepEnvironmentSnapshotByRef(
      inheritance.parentStepEnvironmentSnapshotRef,
    );
    if (
      !parent ||
      parent.projectId !== inheritance.projectId ||
      parent.threadId !== inheritance.parentThreadId ||
      parent.primaryEnvironmentId !== inheritance.primaryEnvironmentId ||
      parent.selectedEnvironmentIds.join("\0") !==
        inheritance.inheritedEnvironmentIds.join("\0")
    ) {
      fail("world_manager_child_environment_parent_snapshot_mismatch");
    }
    return this.transaction(() => {
      const row = this.db.prepare(`
        select inheritance_json
        from wm_child_environment_inheritances
        where child_thread_id = ?
      `).get(inheritance.childThreadId);
      if (row) {
        const existing = parseJson(row.inheritance_json, null);
        validateChildEnvironmentInheritance(existing);
        if (existing.digest !== inheritance.digest) {
          fail("world_manager_child_environment_inheritance_conflict");
        }
        return { reused: true, inheritance: existing, projectionRevision: this.revision() };
      }
      this.db.prepare(`
        insert into wm_child_environment_inheritances (
          inheritance_id, parent_thread_id, child_thread_id,
          project_id, inheritance_json, inheritance_digest, created_at
        ) values (?, ?, ?, ?, ?, ?, ?)
      `).run(
        inheritance.inheritanceId,
        inheritance.parentThreadId,
        inheritance.childThreadId,
        inheritance.projectId,
        json(inheritance),
        inheritance.digest,
        inheritance.createdAt,
      );
      return {
        reused: false,
        inheritance,
        projectionRevision: this.incrementRevision(),
      };
    });
  }

  registerRepositorySemanticSnapshot(
    input = {},
  ) {
    const snapshot =
      input.snapshot?.schema
        ? input.snapshot
        : input.schema
          ? input
          : buildRepositorySemanticSnapshot({
              ...input,
              now: this.now,
            });
    validateRepositorySemanticSnapshot(
      snapshot,
    );
    return this.transaction(() => {
      const row = this.db.prepare(`
        select snapshot_json
        from wm_repository_semantic_snapshots
        where snapshot_digest = ?
        limit 1
      `).get(snapshot.snapshotDigest);
      if (row) {
        const existing = parseJson(
          row.snapshot_json,
          null,
        );
        validateRepositorySemanticSnapshot(
          existing,
        );
        if (
          existing.snapshotId !==
            snapshot.snapshotId ||
          existing.projectId !==
            snapshot.projectId
        ) {
          fail(
            "world_manager_repository_snapshot_idempotency_conflict",
          );
        }
        return {
          reused: true,
          snapshot: existing,
          projectionRevision:
            this.revision(),
        };
      }
      this.db.prepare(`
        insert into wm_repository_semantic_snapshots (
          snapshot_id,
          project_id,
          snapshot_digest,
          snapshot_json,
          observed_at
        ) values (?, ?, ?, ?, ?)
      `).run(
        snapshot.snapshotId,
        snapshot.projectId,
        snapshot.snapshotDigest,
        json(snapshot),
        snapshot.observedAt,
      );
      return {
        reused: false,
        snapshot,
        projectionRevision:
          this.incrementRevision(),
      };
    });
  }

  listRepositorySemanticSnapshots(
    options = {},
  ) {
    const where = [];
    const values = [];
    if (
      normalizeString(
        options.projectId,
        "",
      )
    ) {
      where.push("project_id = ?");
      values.push(options.projectId);
    }
    return this.db.prepare(`
      select snapshot_json
      from wm_repository_semantic_snapshots
      ${where.length
        ? `where ${where.join(" and ")}`
        : ""}
      order by rowid desc
      ${Number.isInteger(Number(options.limit))
        ? "limit ?"
        : ""}
    `).all(
      ...values,
      ...(Number.isInteger(Number(options.limit))
        ? [Math.max(1, Number(options.limit))]
        : []),
    ).map((row) => {
      const snapshot = parseJson(
        row.snapshot_json,
        null,
      );
      validateRepositorySemanticSnapshot(
        snapshot,
      );
      return snapshot;
    });
  }

  repositorySemanticSnapshotById(
    snapshotId,
  ) {
    const row = this.db.prepare(`
      select snapshot_json
      from wm_repository_semantic_snapshots
      where snapshot_id = ?
      limit 1
    `).get(
      normalizeString(snapshotId, ""),
    );
    if (!row) return null;
    const snapshot = parseJson(
      row.snapshot_json,
      null,
    );
    validateRepositorySemanticSnapshot(
      snapshot,
    );
    return snapshot;
  }

  _currentAroReconstructionRunWithinTransaction(
    runId,
  ) {
    const row = this.db.prepare(`
      select run_json
      from wm_aro_reconstruction_runs
      where run_id = ?
        and current_state = 'current'
      order by run_revision desc
      limit 1
    `).get(normalizeString(runId, ""));
    if (!row) return null;
    const run = parseJson(
      row.run_json,
      null,
    );
    validateAroReconstructionRun(run);
    return run;
  }

  registerAroReconstructionRun(
    input = {},
  ) {
    const run =
      input.run || input;
    validateAroReconstructionRun(run);
    return this.transaction(() => {
      const snapshot =
        this.repositorySemanticSnapshotById(
          run.repositorySnapshotRef.id,
        );
      if (
        !snapshot ||
        snapshot.snapshotDigest !==
          run.repositorySnapshotRef.digest ||
        snapshot.projectId !==
          run.projectId
      ) {
        fail(
          "world_manager_aro_reconstruction_run_snapshot_invalid",
          run.runId,
        );
      }
      const current =
        this
          ._currentAroReconstructionRunWithinTransaction(
            run.runId,
          );
      if (current?.digest === run.digest) {
        return {
          reused: true,
          run: current,
          projectionRevision:
            this.revision(),
        };
      }
      if (current) {
        if (
          run.runRevision !==
            current.runRevision + 1 ||
          run.predecessorRef?.kind !==
            "aro_reconstruction_run" ||
          run.predecessorRef?.id !==
            current.runId ||
          run.predecessorRef?.digest !==
            current.digest
        ) {
          fail(
            "world_manager_aro_reconstruction_run_revision_conflict",
            run.runId,
          );
        }
        const allowed =
          current.state === "scheduled"
            ? ["running", "failed"]
            : current.state === "running"
              ? [
                  "completed",
                  "remanded",
                  "failed",
                ]
              : [];
        if (!allowed.includes(run.state)) {
          fail(
            "world_manager_aro_reconstruction_run_transition_invalid",
            `${current.state}:${run.state}`,
          );
        }
        this.db.prepare(`
          update wm_aro_reconstruction_runs
          set current_state = 'superseded'
          where run_id = ?
            and current_state = 'current'
        `).run(run.runId);
      } else if (
        run.runRevision !== 1 ||
        run.predecessorRef ||
        run.state !== "scheduled"
      ) {
        fail(
          "world_manager_aro_reconstruction_run_initial_invalid",
          run.runId,
        );
      }
      this.db.prepare(`
        insert into wm_aro_reconstruction_runs (
          run_record_id,
          run_id,
          project_id,
          snapshot_id,
          snapshot_digest,
          attempt,
          run_revision,
          run_state,
          current_state,
          run_json,
          run_digest,
          created_at,
          updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, 'current', ?, ?, ?, ?)
      `).run(
        stableId(
          "wm_aro_reconstruction_run_record",
          {
            runId: run.runId,
            runRevision:
              run.runRevision,
            digest: run.digest,
          },
        ),
        run.runId,
        run.projectId,
        run.repositorySnapshotRef.id,
        run.repositorySnapshotRef.digest,
        run.attempt,
        run.runRevision,
        run.state,
        json(run),
        run.digest,
        run.createdAt,
        run.updatedAt,
      );
      return {
        reused: false,
        run,
        projectionRevision:
          this.incrementRevision(),
      };
    });
  }

  listAroReconstructionRuns(
    options = {},
  ) {
    const where = [];
    const values = [];
    if (options.currentOnly !== false) {
      where.push(
        "current_state = 'current'",
      );
    }
    if (
      normalizeString(
        options.projectId,
        "",
      )
    ) {
      where.push("project_id = ?");
      values.push(options.projectId);
    }
    if (
      normalizeString(
        options.snapshotDigest,
        "",
      )
    ) {
      where.push("snapshot_digest = ?");
      values.push(
        options.snapshotDigest,
      );
    }
    return this.db.prepare(`
      select run_json
      from wm_aro_reconstruction_runs
      ${where.length
        ? `where ${where.join(" and ")}`
        : ""}
      order by rowid desc
    `).all(...values).map((row) => {
      const run = parseJson(
        row.run_json,
        null,
      );
      validateAroReconstructionRun(run);
      return run;
    });
  }

  latestAroReconstructionRun(
    options = {},
  ) {
    return this.listAroReconstructionRuns({
      ...options,
      currentOnly: true,
    })[0] || null;
  }

  recoverInterruptedAroReconstructionRuns() {
    const interrupted =
      this.listAroReconstructionRuns({
        currentOnly: true,
      }).filter((run) =>
        ["scheduled", "running"].includes(
          run.state,
        ));
    for (const run of interrupted) {
      const failed =
        reviseAroReconstructionRun(
          run,
          {
            state: "failed",
            error: {
              code:
                "world_manager_aro_reconstruction_runtime_restart",
              message:
                "The repository semantic reconstruction was interrupted by runtime restart. Its exact snapshot remains retryable.",
            },
            updatedAt:
              nowIso(this.now),
            now: this.now,
          },
        );
      this.registerAroReconstructionRun({
        run: failed,
      });
    }
    return {
      recovered:
        interrupted.length,
      projectionRevision:
        this.revision(),
    };
  }

  scheduleAroReconstructionRun(
    input = {},
  ) {
    const snapshot =
      input.snapshot;
    validateRepositorySemanticSnapshot(
      snapshot,
    );
    const runs =
      this.listAroReconstructionRuns({
        projectId:
          snapshot.projectId,
        snapshotDigest:
          snapshot.snapshotDigest,
        currentOnly: true,
      });
    const completed = runs.find((run) =>
      run.state === "completed");
    if (completed) {
      return {
        reused: true,
        terminal: true,
        run: completed,
        projectionRevision:
          this.revision(),
      };
    }
    const active = runs.find((run) =>
      ["scheduled", "running"].includes(
        run.state,
      ));
    if (active) {
      return {
        reused: true,
        terminal: false,
        run: active,
        projectionRevision:
          this.revision(),
      };
    }
    const latest = runs[0] || null;
    if (
      latest &&
      input.retry !== true
    ) {
      return {
        reused: true,
        terminal: true,
        run: latest,
        projectionRevision:
          this.revision(),
      };
    }
    const attempt =
      latest
        ? latest.attempt + 1
        : 1;
    if (attempt > 3) {
      fail(
        "world_manager_aro_reconstruction_retry_limit",
        snapshot.projectId,
      );
    }
    const createdAt =
      normalizeString(
        input.createdAt,
        nowIso(this.now),
      );
    const run =
      buildAroReconstructionRun({
        projectId:
          snapshot.projectId,
        repositorySnapshotRef: {
          kind:
            "repository_snapshot",
          id: snapshot.snapshotId,
          digest:
            snapshot.snapshotDigest,
          label:
            "Bounded repository semantic snapshot",
          projectId:
            snapshot.projectId,
        },
        attempt,
        state: "scheduled",
        createdAt,
        updatedAt: createdAt,
        now: this.now,
      });
    return {
      ...this.registerAroReconstructionRun({
        run,
      }),
      terminal: false,
    };
  }

  _currentAroTargetDefinitionRunWithinTransaction(
    runId,
  ) {
    const row = this.db.prepare(`
      select run_json
      from wm_aro_target_definition_runs
      where run_id = ?
        and current_state = 'current'
      order by run_revision desc
      limit 1
    `).get(normalizeString(runId, ""));
    if (!row) return null;
    const run = parseJson(
      row.run_json,
      null,
    );
    validateAroTargetDefinitionRun(run);
    return run;
  }

  registerAroTargetDefinitionRun(
    input = {},
  ) {
    const run = input.run || input;
    validateAroTargetDefinitionRun(run);
    return this.transaction(() => {
      const currentAroRow =
        this.db.prepare(`
          select aro_json
          from wm_aro_registry
          where aro_id = ?
            and aro_digest = ?
          limit 1
        `).get(
          run.currentAroRef.id,
          run.currentAroRef.digest,
        );
      const currentAro =
        currentAroRow
          ? parseJson(
              currentAroRow.aro_json,
              null,
            )
          : null;
      if (currentAro) {
        validateAbstractReasoningObject(
          currentAro,
        );
      }
      if (
        !currentAro ||
        currentAro.projectId !==
          run.projectId ||
        currentAro.posture !== "current"
      ) {
        fail(
          "world_manager_aro_target_run_current_invalid",
          run.runId,
        );
      }
      if (run.targetBaselineRef) {
        const targetBaselineRow =
          this.db.prepare(`
            select aro_json
            from wm_aro_registry
            where aro_id = ?
              and aro_digest = ?
            limit 1
          `).get(
            run.targetBaselineRef.id,
            run.targetBaselineRef.digest,
          );
        const targetBaseline =
          targetBaselineRow
            ? parseJson(
                targetBaselineRow
                  .aro_json,
                null,
              )
            : null;
        if (targetBaseline) {
          validateAbstractReasoningObject(
            targetBaseline,
          );
        }
        if (
          !targetBaseline ||
          targetBaseline.projectId !==
            run.projectId ||
          targetBaseline.posture !==
            "target" ||
          targetBaseline.conceptKey !==
            currentAro.conceptKey
        ) {
          fail(
            "world_manager_aro_target_run_baseline_invalid",
            run.runId,
          );
        }
      }
      const current =
        this
          ._currentAroTargetDefinitionRunWithinTransaction(
            run.runId,
          );
      if (current?.digest === run.digest) {
        return {
          reused: true,
          run: current,
          projectionRevision:
            this.revision(),
        };
      }
      if (current) {
        if (
          run.runRevision !==
            current.runRevision + 1 ||
          run.predecessorRef?.kind !==
            "aro_target_definition_run" ||
          run.predecessorRef?.id !==
            current.runId ||
          run.predecessorRef?.digest !==
            current.digest
        ) {
          fail(
            "world_manager_aro_target_run_revision_conflict",
            run.runId,
          );
        }
        const allowed =
          current.state === "scheduled"
            ? ["running", "failed"]
            : current.state === "running"
              ? [
                  "completed",
                  "remanded",
                  "failed",
                ]
              : [];
        if (!allowed.includes(run.state)) {
          fail(
            "world_manager_aro_target_run_transition_invalid",
            `${current.state}:${run.state}`,
          );
        }
        this.db.prepare(`
          update wm_aro_target_definition_runs
          set current_state = 'superseded'
          where run_id = ?
            and current_state = 'current'
        `).run(run.runId);
      } else if (
        run.runRevision !== 1 ||
        run.predecessorRef ||
        run.state !== "scheduled"
      ) {
        fail(
          "world_manager_aro_target_run_initial_invalid",
          run.runId,
        );
      }
      this.db.prepare(`
        insert into wm_aro_target_definition_runs (
          run_record_id,
          run_id,
          project_id,
          current_aro_id,
          current_aro_digest,
          target_intent_digest,
          attempt,
          run_revision,
          run_state,
          current_state,
          run_json,
          run_digest,
          created_at,
          updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'current', ?, ?, ?, ?)
      `).run(
        stableId(
          "wm_aro_target_definition_run_record",
          {
            runId: run.runId,
            runRevision:
              run.runRevision,
            digest: run.digest,
          },
        ),
        run.runId,
        run.projectId,
        run.currentAroRef.id,
        run.currentAroRef.digest,
        run.definitionKeyDigest,
        run.attempt,
        run.runRevision,
        run.state,
        json(run),
        run.digest,
        run.createdAt,
        run.updatedAt,
      );
      return {
        reused: false,
        run,
        projectionRevision:
          this.incrementRevision(),
      };
    });
  }

  listAroTargetDefinitionRuns(
    options = {},
  ) {
    const where = [];
    const values = [];
    if (options.currentOnly !== false) {
      where.push(
        "current_state = 'current'",
      );
    }
    if (
      normalizeString(
        options.projectId,
        "",
      )
    ) {
      where.push("project_id = ?");
      values.push(options.projectId);
    }
    if (
      normalizeString(
        options.currentAroDigest,
        "",
      )
    ) {
      where.push(
        "current_aro_digest = ?",
      );
      values.push(
        options.currentAroDigest,
      );
    }
    if (
      normalizeString(
        options.definitionKeyDigest,
        "",
      )
    ) {
      where.push(
        "target_intent_digest = ?",
      );
      values.push(
        options.definitionKeyDigest,
      );
    }
    return this.db.prepare(`
      select run_json
      from wm_aro_target_definition_runs
      ${where.length
        ? `where ${where.join(" and ")}`
        : ""}
      order by rowid desc
    `).all(...values).map((row) => {
      const run = parseJson(
        row.run_json,
        null,
      );
      validateAroTargetDefinitionRun(run);
      return run;
    });
  }

  latestAroTargetDefinitionRun(
    options = {},
  ) {
    return this.listAroTargetDefinitionRuns({
      ...options,
      currentOnly: true,
    })[0] || null;
  }

  scheduleAroTargetDefinitionRun(
    input = {},
  ) {
    const currentAro = input.currentAro;
    validateAbstractReasoningObject(
      currentAro,
    );
    if (
      currentAro.canonical !== true ||
      currentAro.lifecycle !== "active" ||
      currentAro.posture !== "current"
    ) {
      fail(
        "world_manager_aro_target_current_boundary",
      );
    }
    const targetIntent =
      normalizeString(
        input.targetIntent,
        "",
      );
    if (!targetIntent) {
      fail(
        "world_manager_aro_target_intent_required",
      );
    }
    const intentDigest =
      targetIntentDigest(targetIntent);
    const exactCurrentAroRef =
      abstractReasoningObjectRef(
        currentAro,
      );
    const targetBaselineAro =
      input.targetBaselineAro || null;
    if (targetBaselineAro) {
      validateAbstractReasoningObject(
        targetBaselineAro,
      );
      if (
        targetBaselineAro.canonical !==
          true ||
        targetBaselineAro.lifecycle !==
          "active" ||
        targetBaselineAro.posture !==
          "target" ||
        targetBaselineAro.projectId !==
          currentAro.projectId ||
        targetBaselineAro.conceptKey !==
          currentAro.conceptKey
      ) {
        fail(
          "world_manager_aro_target_baseline_invalid",
        );
      }
    }
    const targetBaselineRef =
      targetBaselineAro
        ? abstractReasoningObjectRef(
            targetBaselineAro,
          )
        : null;
    const definitionKeyDigest =
      targetDefinitionKeyDigest(
        exactCurrentAroRef,
        targetBaselineRef,
        intentDigest,
      );
    const runs =
      this.listAroTargetDefinitionRuns({
        projectId:
          currentAro.projectId,
        currentAroDigest:
          currentAro.digest,
        definitionKeyDigest,
        currentOnly: true,
      });
    const completed = runs.find((run) =>
      run.state === "completed");
    if (completed) {
      return {
        reused: true,
        terminal: true,
        run: completed,
        projectionRevision:
          this.revision(),
      };
    }
    const active = runs.find((run) =>
      ["scheduled", "running"].includes(
        run.state,
      ));
    if (active) {
      return {
        reused: true,
        terminal: false,
        run: active,
        projectionRevision:
          this.revision(),
      };
    }
    const latest = runs[0] || null;
    if (
      latest &&
      input.retry !== true
    ) {
      return {
        reused: true,
        terminal: true,
        run: latest,
        projectionRevision:
          this.revision(),
      };
    }
    const attempt =
      latest
        ? latest.attempt + 1
        : 1;
    if (attempt > 3) {
      fail(
        "world_manager_aro_target_retry_limit",
        currentAro.aroId,
      );
    }
    const createdAt =
      normalizeString(
        input.createdAt,
        nowIso(this.now),
      );
    const run =
      buildAroTargetDefinitionRun({
        projectId:
          currentAro.projectId,
        currentAroRef:
          exactCurrentAroRef,
        targetBaselineRef,
        targetIntent,
        targetIntentDigest:
          intentDigest,
        definitionKeyDigest,
        attempt,
        state: "scheduled",
        createdAt,
        updatedAt: createdAt,
        now: this.now,
      });
    return {
      ...this.registerAroTargetDefinitionRun({
        run,
      }),
      terminal: false,
    };
  }

  recoverInterruptedAroTargetDefinitionRuns() {
    const interrupted =
      this.listAroTargetDefinitionRuns({
        currentOnly: true,
      }).filter((run) =>
        ["scheduled", "running"].includes(
          run.state,
        ));
    for (const run of interrupted) {
      const failed =
        reviseAroTargetDefinitionRun(
          run,
          {
            state: "failed",
            error: {
              code:
                "world_manager_aro_target_runtime_restart",
              message:
                "The target-definition run was interrupted by runtime restart. Its exact current ARO and target intent remain retryable.",
            },
            updatedAt:
              nowIso(this.now),
            now: this.now,
          },
        );
      this.registerAroTargetDefinitionRun({
        run: failed,
      });
    }
    return {
      recovered: interrupted.length,
      projectionRevision:
        this.revision(),
    };
  }

  _currentAroMutationContractWithinTransaction(
    contractId,
  ) {
    const row = this.db.prepare(`
      select contract_json
      from wm_aro_mutation_contracts
      where contract_id = ?
        and current_state = 'current'
      order by contract_revision desc
      limit 1
    `).get(
      normalizeString(contractId, ""),
    );
    if (!row) return null;
    const contract = parseJson(
      row.contract_json,
      null,
    );
    validateAroMutationContract(
      contract,
    );
    return contract;
  }

  registerAroMutationContract(
    input = {},
  ) {
    const contract =
      input.contract || input;
    validateAroMutationContract(
      contract,
    );
    return this.transaction(() => {
      for (
        const ref of [
          contract.currentAroRef,
          contract.targetAroRef,
        ]
      ) {
        const aro =
          this.abstractReasoningObjectById(
            ref.id,
          );
        if (
          !aro ||
          aro.digest !== ref.digest ||
          aro.projectId !==
            contract.projectId
        ) {
          fail(
            "world_manager_aro_mutation_contract_aro_binding_invalid",
            ref.id,
          );
        }
      }
      if (
        contract.repositorySnapshotRef
      ) {
        const snapshot =
          this
            .repositorySemanticSnapshotById(
              contract
                .repositorySnapshotRef.id,
            );
        if (
          !snapshot ||
          snapshot.snapshotDigest !==
            contract
              .repositorySnapshotRef
              .digest ||
          snapshot.projectId !==
            contract.projectId
        ) {
          fail(
            "world_manager_aro_mutation_contract_snapshot_binding_invalid",
            contract.contractId,
          );
        }
      }
      const current =
        this
          ._currentAroMutationContractWithinTransaction(
            contract.contractId,
          );
      if (
        current?.digest ===
          contract.digest
      ) {
        return {
          reused: true,
          contract: current,
          projectionRevision:
            this.revision(),
        };
      }
      if (current) {
        if (
          contract.contractRevision !==
            current.contractRevision + 1 ||
          contract.predecessorRef?.kind !==
            "aro_mutation_contract" ||
          contract.predecessorRef?.id !==
            current.contractId ||
          contract.predecessorRef?.digest !==
            current.digest
        ) {
          fail(
            "world_manager_aro_mutation_contract_revision_conflict",
            contract.contractId,
          );
        }
        this.db.prepare(`
          update wm_aro_mutation_contracts
          set current_state = 'superseded'
          where contract_id = ?
            and current_state = 'current'
        `).run(contract.contractId);
      } else if (
        contract.contractRevision !==
          1 ||
        contract.predecessorRef
      ) {
        fail(
          "world_manager_aro_mutation_contract_initial_invalid",
          contract.contractId,
        );
      }
      this.db.prepare(`
        insert into wm_aro_mutation_contracts (
          contract_record_id,
          contract_id,
          project_id,
          comparison_id,
          comparison_digest,
          contract_revision,
          current_state,
          contract_json,
          contract_digest,
          created_at
        ) values (?, ?, ?, ?, ?, ?, 'current', ?, ?, ?)
      `).run(
        stableId(
          "wm_aro_mutation_contract_record",
          {
            contractId:
              contract.contractId,
            contractRevision:
              contract.contractRevision,
            digest: contract.digest,
          },
        ),
        contract.contractId,
        contract.projectId,
        contract.comparisonRef.id,
        contract.comparisonRef.digest,
        contract.contractRevision,
        json(contract),
        contract.digest,
        contract.createdAt,
      );
      return {
        reused: false,
        contract,
        projectionRevision:
          this.incrementRevision(),
      };
    });
  }

  listAroMutationContracts(
    options = {},
  ) {
    const where = [];
    const values = [];
    if (options.currentOnly !== false) {
      where.push(
        "current_state = 'current'",
      );
    }
    if (
      normalizeString(
        options.projectId,
        "",
      )
    ) {
      where.push("project_id = ?");
      values.push(options.projectId);
    }
    if (
      normalizeString(
        options.comparisonDigest,
        "",
      )
    ) {
      where.push(
        "comparison_digest = ?",
      );
      values.push(
        options.comparisonDigest,
      );
    }
    return this.db.prepare(`
      select contract_json
      from wm_aro_mutation_contracts
      ${where.length
        ? `where ${where.join(" and ")}`
        : ""}
      order by rowid desc
    `).all(...values).map((row) => {
      const contract = parseJson(
        row.contract_json,
        null,
      );
      validateAroMutationContract(
        contract,
      );
      return contract;
    });
  }

  aroMutationContractById(
    contractId,
  ) {
    return this
      .listAroMutationContracts({
        currentOnly: true,
      })
      .find((contract) =>
        contract.contractId ===
          normalizeString(
            contractId,
            "",
          )) || null;
  }

  _currentAroMutationCompilationRunWithinTransaction(
    runId,
  ) {
    const row = this.db.prepare(`
      select run_json
      from wm_aro_mutation_compilation_runs
      where run_id = ?
        and current_state = 'current'
      order by run_revision desc
      limit 1
    `).get(
      normalizeString(runId, ""),
    );
    if (!row) return null;
    const run = parseJson(
      row.run_json,
      null,
    );
    validateAroMutationCompilationRun(
      run,
    );
    return run;
  }

  registerAroMutationCompilationRun(
    input = {},
  ) {
    const run = input.run || input;
    validateAroMutationCompilationRun(
      run,
    );
    return this.transaction(() => {
      for (
        const ref of [
          run.currentAroRef,
          run.targetAroRef,
        ]
      ) {
        const aro =
          this.abstractReasoningObjectById(
            ref.id,
          );
        if (
          !aro ||
          aro.digest !== ref.digest ||
          aro.projectId !== run.projectId
        ) {
          fail(
            "world_manager_aro_mutation_run_aro_binding_invalid",
            ref.id,
          );
        }
      }
      if (run.contractRef) {
        const contract =
          this.aroMutationContractById(
            run.contractRef.id,
          );
        if (
          !contract ||
          contract.digest !==
            run.contractRef.digest
        ) {
          fail(
            "world_manager_aro_mutation_run_contract_binding_invalid",
            run.runId,
          );
        }
      }
      const current =
        this
          ._currentAroMutationCompilationRunWithinTransaction(
            run.runId,
          );
      if (
        current?.digest === run.digest
      ) {
        return {
          reused: true,
          run: current,
          projectionRevision:
            this.revision(),
        };
      }
      if (current) {
        if (
          run.runRevision !==
            current.runRevision + 1 ||
          run.predecessorRef?.kind !==
            "aro_mutation_compilation_run" ||
          run.predecessorRef?.id !==
            current.runId ||
          run.predecessorRef?.digest !==
            current.digest
        ) {
          fail(
            "world_manager_aro_mutation_run_revision_conflict",
            run.runId,
          );
        }
        const allowed =
          current.state === "scheduled"
            ? ["running", "failed"]
            : current.state === "running"
              ? [
                  "completed",
                  "remanded",
                  "failed",
                ]
              : [];
        if (!allowed.includes(run.state)) {
          fail(
            "world_manager_aro_mutation_run_transition_invalid",
            `${current.state}:${run.state}`,
          );
        }
        this.db.prepare(`
          update wm_aro_mutation_compilation_runs
          set current_state = 'superseded'
          where run_id = ?
            and current_state = 'current'
        `).run(run.runId);
      } else if (
        run.runRevision !== 1 ||
        run.predecessorRef ||
        run.state !== "scheduled"
      ) {
        fail(
          "world_manager_aro_mutation_run_initial_invalid",
          run.runId,
        );
      }
      this.db.prepare(`
        insert into wm_aro_mutation_compilation_runs (
          run_record_id,
          run_id,
          project_id,
          comparison_id,
          comparison_digest,
          attempt,
          run_revision,
          run_state,
          current_state,
          run_json,
          run_digest,
          created_at,
          updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, 'current', ?, ?, ?, ?)
      `).run(
        stableId(
          "wm_aro_mutation_run_record",
          {
            runId: run.runId,
            runRevision:
              run.runRevision,
            digest: run.digest,
          },
        ),
        run.runId,
        run.projectId,
        run.comparisonRef.id,
        run.comparisonRef.digest,
        run.attempt,
        run.runRevision,
        run.state,
        json(run),
        run.digest,
        run.createdAt,
        run.updatedAt,
      );
      return {
        reused: false,
        run,
        projectionRevision:
          this.incrementRevision(),
      };
    });
  }

  listAroMutationCompilationRuns(
    options = {},
  ) {
    const where = [];
    const values = [];
    if (options.currentOnly !== false) {
      where.push(
        "current_state = 'current'",
      );
    }
    if (
      normalizeString(
        options.projectId,
        "",
      )
    ) {
      where.push("project_id = ?");
      values.push(options.projectId);
    }
    if (
      normalizeString(
        options.comparisonDigest,
        "",
      )
    ) {
      where.push(
        "comparison_digest = ?",
      );
      values.push(
        options.comparisonDigest,
      );
    }
    return this.db.prepare(`
      select run_json
      from wm_aro_mutation_compilation_runs
      ${where.length
        ? `where ${where.join(" and ")}`
        : ""}
      order by rowid desc
    `).all(...values).map((row) => {
      const run = parseJson(
        row.run_json,
        null,
      );
      validateAroMutationCompilationRun(
        run,
      );
      return run;
    });
  }

  latestAroMutationCompilationRun(
    options = {},
  ) {
    return this
      .listAroMutationCompilationRuns({
        ...options,
        currentOnly: true,
      })[0] || null;
  }

  recoverInterruptedAroMutationCompilationRuns() {
    const interrupted =
      this
        .listAroMutationCompilationRuns({
          currentOnly: true,
        })
        .filter((run) =>
          ["scheduled", "running"].includes(
            run.state,
          ));
    for (const run of interrupted) {
      const failed =
        reviseAroMutationCompilationRun(
          run,
          {
            state: "failed",
            error: {
              code:
                "world_manager_aro_mutation_runtime_restart",
              message:
                "Mutation-contract compilation was interrupted by runtime restart. The exact current/target comparison remains retryable.",
            },
            updatedAt:
              nowIso(this.now),
            now: this.now,
          },
        );
      this
        .registerAroMutationCompilationRun({
          run: failed,
        });
    }
    return {
      recovered:
        interrupted.length,
      projectionRevision:
        this.revision(),
    };
  }

  scheduleAroMutationCompilationRun(
    input = {},
  ) {
    const comparison =
      input.comparison;
    validateAroCurrentTargetComparison(
      comparison,
    );
    const runs =
      this
        .listAroMutationCompilationRuns({
          projectId:
            comparison.projectId,
          comparisonDigest:
            comparison.digest,
          currentOnly: true,
        });
    const completed = runs.find(
      (run) =>
        run.state === "completed",
    );
    if (completed) {
      return {
        reused: true,
        terminal: true,
        run: completed,
        projectionRevision:
          this.revision(),
      };
    }
    const active = runs.find((run) =>
      ["scheduled", "running"].includes(
        run.state,
      ));
    if (active) {
      return {
        reused: true,
        terminal: false,
        run: active,
        projectionRevision:
          this.revision(),
      };
    }
    const latest = runs[0] || null;
    if (
      latest &&
      input.retry !== true
    ) {
      return {
        reused: true,
        terminal: true,
        run: latest,
        projectionRevision:
          this.revision(),
      };
    }
    const attempt = latest
      ? latest.attempt + 1
      : 1;
    if (attempt > 3) {
      fail(
        "world_manager_aro_mutation_retry_limit",
        comparison.comparisonId,
      );
    }
    const createdAt =
      normalizeString(
        input.createdAt,
        nowIso(this.now),
      );
    const run =
      buildAroMutationCompilationRun({
        projectId:
          comparison.projectId,
        comparisonRef: {
          kind:
            "aro_current_target_comparison",
          id:
            comparison.comparisonId,
          digest: comparison.digest,
          projectId:
            comparison.projectId,
        },
        currentAroRef:
          comparison.currentAroRef,
        targetAroRef:
          comparison.targetAroRef,
        attempt,
        state: "scheduled",
        createdAt,
        updatedAt: createdAt,
        now: this.now,
      });
    return {
      ...this
        .registerAroMutationCompilationRun({
          run,
        }),
      terminal: false,
    };
  }

  registerAroRealizationContextImport(
    input = {},
  ) {
    const contextImport =
      input.contextImport || input;
    validateAroRealizationContextImport(
      contextImport,
    );
    return this.transaction(() => {
      const existingRow =
        this.db.prepare(`
          select import_json
          from wm_aro_realization_context_imports
          where context_import_id = ?
        `).get(
          contextImport
            .contextImportId,
        );
      if (existingRow) {
        const existing = parseJson(
          existingRow.import_json,
          null,
        );
        validateAroRealizationContextImport(
          existing,
        );
        if (
          existing.digest !==
            contextImport.digest
        ) {
          fail(
            "world_manager_aro_realization_import_identity_conflict",
            contextImport.contextImportId,
          );
        }
        return {
          reused: true,
          contextImport: existing,
          projectionRevision:
            this.revision(),
        };
      }
      const contract =
        this.aroMutationContractById(
          contextImport.contractRef.id,
        );
      const snapshot =
        this
          .repositorySemanticSnapshotById(
            contextImport
              .repositorySnapshotRef.id,
          );
      if (
        !contract ||
        contract.digest !==
          contextImport
            .contractRef.digest ||
        contract.projectId !==
          contextImport.projectId
      ) {
        fail(
          "world_manager_aro_realization_import_contract_binding_invalid",
          contextImport.contextImportId,
        );
      }
      if (
        !snapshot ||
        snapshot.snapshotDigest !==
          contextImport
            .repositorySnapshotRef.digest ||
        snapshot.projectId !==
          contextImport.projectId
      ) {
        fail(
          "world_manager_aro_realization_import_snapshot_binding_invalid",
          contextImport.contextImportId,
        );
      }
      this.db.prepare(`
        insert into wm_aro_realization_context_imports (
          import_record_id,
          context_import_id,
          project_id,
          contract_id,
          contract_digest,
          source_identity_digest,
          import_json,
          import_digest,
          created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        stableId(
          "wm_aro_realization_import_record",
          {
            contextImportId:
              contextImport
                .contextImportId,
            digest:
              contextImport.digest,
          },
        ),
        contextImport.contextImportId,
        contextImport.projectId,
        contextImport.contractRef.id,
        contextImport.contractRef.digest,
        contextImport
          .sourceIdentityDigest,
        json(contextImport),
        contextImport.digest,
        contextImport.importedAt,
      );
      return {
        reused: false,
        contextImport,
        projectionRevision:
          this.incrementRevision(),
      };
    });
  }

  listAroRealizationContextImports(
    options = {},
  ) {
    const where = [];
    const values = [];
    if (
      normalizeString(
        options.projectId,
        "",
      )
    ) {
      where.push("project_id = ?");
      values.push(options.projectId);
    }
    if (
      normalizeString(
        options.contractDigest,
        "",
      )
    ) {
      where.push(
        "contract_digest = ?",
      );
      values.push(
        options.contractDigest,
      );
    }
    const limit =
      Number(options.limit) > 0
        ? Math.min(
            1_000,
            Number(options.limit),
          )
        : 200;
    return this.db.prepare(`
      select import_json
      from wm_aro_realization_context_imports
      ${where.length
        ? `where ${where.join(" and ")}`
        : ""}
      order by rowid desc
      limit ?
    `).all(
      ...values,
      limit,
    ).map((row) => {
      const contextImport =
        parseJson(
          row.import_json,
          null,
        );
      validateAroRealizationContextImport(
        contextImport,
      );
      return contextImport;
    });
  }

  aroRealizationContextImportById(
    contextImportId,
  ) {
    const row = this.db.prepare(`
      select import_json
      from wm_aro_realization_context_imports
      where context_import_id = ?
      limit 1
    `).get(
      normalizeString(
        contextImportId,
        "",
      ),
    );
    if (!row) return null;
    const contextImport =
      parseJson(
        row.import_json,
        null,
      );
    validateAroRealizationContextImport(
      contextImport,
    );
    return contextImport;
  }

  registerAroRealizationMappingWitness(
    input = {},
  ) {
    const mappingWitness =
      input.mappingWitness || input;
    validateAroRealizationMappingWitness(
      mappingWitness,
    );
    return this.transaction(() => {
      const existingRow =
        this.db.prepare(`
          select mapping_json
          from wm_aro_realization_mapping_witnesses
          where mapping_witness_id = ?
        `).get(
          mappingWitness
            .mappingWitnessId,
        );
      if (existingRow) {
        const existing = parseJson(
          existingRow.mapping_json,
          null,
        );
        validateAroRealizationMappingWitness(
          existing,
        );
        if (
          existing.digest !==
            mappingWitness.digest
        ) {
          fail(
            "world_manager_aro_realization_mapping_identity_conflict",
            mappingWitness.mappingWitnessId,
          );
        }
        return {
          reused: true,
          mappingWitness: existing,
          projectionRevision:
            this.revision(),
        };
      }
      const contract =
        this.aroMutationContractById(
          mappingWitness.contractRef.id,
        );
      const contextImport =
        this
          .aroRealizationContextImportById(
            mappingWitness
              .contextImportRef.id,
          );
      if (
        !contract ||
        contract.digest !==
          mappingWitness
            .contractRef.digest ||
        !contextImport ||
        contextImport.digest !==
          mappingWitness
            .contextImportRef.digest ||
        contextImport.contractRef.id !==
          contract.contractId ||
        contextImport.contractRef.digest !==
          contract.digest
      ) {
        fail(
          "world_manager_aro_realization_mapping_binding_invalid",
          mappingWitness.mappingWitnessId,
        );
      }
      const refMatches = (
        left,
        right,
      ) =>
        left?.kind === right?.kind &&
        left?.id === right?.id &&
        left?.digest === right?.digest;
      if (
        !refMatches(
          mappingWitness
            .comparisonRef,
          contract.comparisonRef,
        ) ||
        !refMatches(
          mappingWitness
            .currentAroRef,
          contract.currentAroRef,
        ) ||
        !refMatches(
          mappingWitness
            .targetAroRef,
          contract.targetAroRef,
        ) ||
        !refMatches(
          mappingWitness
            .repositorySnapshotRef,
          contextImport
            .repositorySnapshotRef,
        ) ||
        mappingWitness
          .sourceIdentityDigest !==
          contextImport
            .sourceIdentityDigest ||
        mappingWitness.freshness !==
          contextImport.freshness
      ) {
        fail(
          "world_manager_aro_realization_mapping_lineage_invalid",
          mappingWitness.mappingWitnessId,
        );
      }
      const obligationsByKey =
        new Map(
          contract
            .implementationObligations
            .map((obligation) => [
              obligation.obligationKey,
              obligation,
            ]),
        );
      const evidenceByKey =
        new Map(
          contextImport.evidence.map(
            (evidence) => [
              evidence.evidenceKey,
              evidence,
            ]),
        );
      if (
        mappingWitness
          .obligationMappings.length !==
          obligationsByKey.size
      ) {
        fail(
          "world_manager_aro_realization_mapping_obligation_set_invalid",
          mappingWitness.mappingWitnessId,
        );
      }
      for (
        const mapping of
          mappingWitness
            .obligationMappings
      ) {
        const obligation =
          obligationsByKey.get(
            mapping.obligationKey,
          );
        const expectedRef =
          obligation
            ? implementationObligationRef(
                contract,
                obligation,
              )
            : null;
        if (
          !obligation ||
          !refMatches(
            mapping.obligationRef,
            expectedRef,
          )
        ) {
          fail(
            "world_manager_aro_realization_mapping_obligation_binding_invalid",
            mapping.obligationKey,
          );
        }
        for (
          const binding of
            mapping.sourceBindings
        ) {
          const evidence =
            evidenceByKey.get(
              binding.evidenceKey,
            );
          if (
            !evidence ||
            !refMatches(
              binding.sourceRef,
              evidence.sourceRef,
            ) ||
            binding.relativePath !==
              evidence.relativePath ||
            binding.startLine <
              evidence.lineStart ||
            binding.endLine >
              evidence.lineEnd
          ) {
            fail(
              "world_manager_aro_realization_mapping_source_binding_invalid",
              binding.evidenceKey,
            );
          }
        }
      }
      this.db.prepare(`
        insert into wm_aro_realization_mapping_witnesses (
          mapping_record_id,
          mapping_witness_id,
          project_id,
          contract_id,
          contract_digest,
          context_import_id,
          context_import_digest,
          mapping_posture,
          mapping_json,
          mapping_digest,
          created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        stableId(
          "wm_aro_realization_mapping_record",
          {
            mappingWitnessId:
              mappingWitness
                .mappingWitnessId,
            digest:
              mappingWitness.digest,
          },
        ),
        mappingWitness.mappingWitnessId,
        mappingWitness.projectId,
        mappingWitness.contractRef.id,
        mappingWitness.contractRef.digest,
        mappingWitness
          .contextImportRef.id,
        mappingWitness
          .contextImportRef.digest,
        mappingWitness.mappingPosture,
        json(mappingWitness),
        mappingWitness.digest,
        mappingWitness.createdAt,
      );
      return {
        reused: false,
        mappingWitness,
        projectionRevision:
          this.incrementRevision(),
      };
    });
  }

  listAroRealizationMappingWitnesses(
    options = {},
  ) {
    const where = [];
    const values = [];
    if (
      normalizeString(
        options.projectId,
        "",
      )
    ) {
      where.push("project_id = ?");
      values.push(options.projectId);
    }
    if (
      normalizeString(
        options.contractDigest,
        "",
      )
    ) {
      where.push(
        "contract_digest = ?",
      );
      values.push(
        options.contractDigest,
      );
    }
    const limit =
      Number(options.limit) > 0
        ? Math.min(
            1_000,
            Number(options.limit),
          )
        : 200;
    return this.db.prepare(`
      select mapping_json
      from wm_aro_realization_mapping_witnesses
      ${where.length
        ? `where ${where.join(" and ")}`
        : ""}
      order by rowid desc
      limit ?
    `).all(
      ...values,
      limit,
    ).map((row) => {
      const mappingWitness =
        parseJson(
          row.mapping_json,
          null,
        );
      validateAroRealizationMappingWitness(
        mappingWitness,
      );
      return mappingWitness;
    });
  }

  aroRealizationMappingWitnessById(
    mappingWitnessId,
  ) {
    return this
      .listAroRealizationMappingWitnesses({
        limit: 1_000,
      })
      .find((entry) =>
        entry.mappingWitnessId ===
          normalizeString(
            mappingWitnessId,
            "",
          )) || null;
  }

  _currentAroRealizationMappingRunWithinTransaction(
    runId,
  ) {
    const row = this.db.prepare(`
      select run_json
      from wm_aro_realization_mapping_runs
      where run_id = ?
        and current_state = 'current'
      order by run_revision desc
      limit 1
    `).get(
      normalizeString(runId, ""),
    );
    if (!row) return null;
    const run = parseJson(
      row.run_json,
      null,
    );
    validateAroRealizationMappingRun(
      run,
    );
    return run;
  }

  registerAroRealizationMappingRun(
    input = {},
  ) {
    const run = input.run || input;
    validateAroRealizationMappingRun(
      run,
    );
    return this.transaction(() => {
      const contract =
        this.aroMutationContractById(
          run.contractRef.id,
        );
      const contextImport =
        this
          .aroRealizationContextImportById(
            run.contextImportRef.id,
          );
      if (
        !contract ||
        contract.digest !==
          run.contractRef.digest ||
        !contextImport ||
        contextImport.digest !==
          run.contextImportRef.digest ||
        contextImport
          .sourceIdentityDigest !==
          run.sourceIdentityDigest
      ) {
        fail(
          "world_manager_aro_realization_mapping_run_binding_invalid",
          run.runId,
        );
      }
      if (run.mappingWitnessRef) {
        const witness =
          this
            .aroRealizationMappingWitnessById(
              run.mappingWitnessRef.id,
            );
        if (
          !witness ||
          witness.digest !==
            run.mappingWitnessRef
              .digest
        ) {
          fail(
            "world_manager_aro_realization_mapping_run_witness_invalid",
            run.runId,
          );
        }
      }
      const current =
        this
          ._currentAroRealizationMappingRunWithinTransaction(
            run.runId,
          );
      if (
        current?.digest === run.digest
      ) {
        return {
          reused: true,
          run: current,
          projectionRevision:
            this.revision(),
        };
      }
      if (current) {
        if (
          run.runRevision !==
            current.runRevision + 1 ||
          run.predecessorRef?.kind !==
            "aro_realization_mapping_run" ||
          run.predecessorRef?.id !==
            current.runId ||
          run.predecessorRef?.digest !==
            current.digest
        ) {
          fail(
            "world_manager_aro_realization_mapping_run_revision_conflict",
            run.runId,
          );
        }
        const allowed =
          current.state === "scheduled"
            ? ["running", "failed"]
            : current.state === "running"
              ? [
                  "completed",
                  "remanded",
                  "failed",
                ]
              : [];
        if (!allowed.includes(run.state)) {
          fail(
            "world_manager_aro_realization_mapping_run_transition_invalid",
            `${current.state}:${run.state}`,
          );
        }
        this.db.prepare(`
          update wm_aro_realization_mapping_runs
          set current_state = 'superseded'
          where run_id = ?
            and current_state = 'current'
        `).run(run.runId);
      } else if (
        run.runRevision !== 1 ||
        run.predecessorRef ||
        run.state !== "scheduled"
      ) {
        fail(
          "world_manager_aro_realization_mapping_run_initial_invalid",
          run.runId,
        );
      }
      this.db.prepare(`
        insert into wm_aro_realization_mapping_runs (
          run_record_id,
          run_id,
          project_id,
          contract_id,
          contract_digest,
          context_import_id,
          context_import_digest,
          source_identity_digest,
          attempt,
          run_revision,
          run_state,
          current_state,
          run_json,
          run_digest,
          created_at,
          updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'current', ?, ?, ?, ?)
      `).run(
        stableId(
          "wm_aro_realization_mapping_run_record",
          {
            runId: run.runId,
            runRevision:
              run.runRevision,
            digest: run.digest,
          },
        ),
        run.runId,
        run.projectId,
        run.contractRef.id,
        run.contractRef.digest,
        run.contextImportRef.id,
        run.contextImportRef.digest,
        run.sourceIdentityDigest,
        run.attempt,
        run.runRevision,
        run.state,
        json(run),
        run.digest,
        run.createdAt,
        run.updatedAt,
      );
      return {
        reused: false,
        run,
        projectionRevision:
          this.incrementRevision(),
      };
    });
  }

  listAroRealizationMappingRuns(
    options = {},
  ) {
    const where = [];
    const values = [];
    if (options.currentOnly !== false) {
      where.push(
        "current_state = 'current'",
      );
    }
    if (
      normalizeString(
        options.projectId,
        "",
      )
    ) {
      where.push("project_id = ?");
      values.push(options.projectId);
    }
    if (
      normalizeString(
        options.contractDigest,
        "",
      )
    ) {
      where.push(
        "contract_digest = ?",
      );
      values.push(
        options.contractDigest,
      );
    }
    if (
      normalizeString(
        options.sourceIdentityDigest,
        "",
      )
    ) {
      where.push(
        "source_identity_digest = ?",
      );
      values.push(
        options.sourceIdentityDigest,
      );
    }
    return this.db.prepare(`
      select run_json
      from wm_aro_realization_mapping_runs
      ${where.length
        ? `where ${where.join(" and ")}`
        : ""}
      order by rowid desc
    `).all(...values).map((row) => {
      const run = parseJson(
        row.run_json,
        null,
      );
      validateAroRealizationMappingRun(
        run,
      );
      return run;
    });
  }

  latestAroRealizationMappingRun(
    options = {},
  ) {
    return this
      .listAroRealizationMappingRuns({
        ...options,
        currentOnly: true,
      })[0] || null;
  }

  recoverInterruptedAroRealizationMappingRuns() {
    const interrupted =
      this
        .listAroRealizationMappingRuns({
          currentOnly: true,
        })
        .filter((run) =>
          ["scheduled", "running"].includes(
            run.state,
          ));
    for (const run of interrupted) {
      this
        .registerAroRealizationMappingRun({
          run:
            reviseAroRealizationMappingRun(
              run,
              {
                state: "failed",
                error: {
                  code:
                    "world_manager_aro_realization_mapping_runtime_restart",
                  message:
                    "Realization mapping was interrupted by runtime restart. The exact contract and imported source identity remain retryable.",
                },
                updatedAt:
                  nowIso(this.now),
                now: this.now,
              },
            ),
        });
    }
    return {
      recovered:
        interrupted.length,
      projectionRevision:
        this.revision(),
    };
  }

  scheduleAroRealizationMappingRun(
    input = {},
  ) {
    const contract = input.contract;
    const contextImport =
      input.contextImport;
    validateAroMutationContract(
      contract,
    );
    validateAroRealizationContextImport(
      contextImport,
    );
    const runs =
      this
        .listAroRealizationMappingRuns({
          projectId:
            contract.projectId,
          contractDigest:
            contract.digest,
          sourceIdentityDigest:
            contextImport
              .sourceIdentityDigest,
          currentOnly: true,
        });
    const completed = runs.find(
      (run) =>
        run.state === "completed",
    );
    if (completed) {
      return {
        reused: true,
        terminal: true,
        run: completed,
        projectionRevision:
          this.revision(),
      };
    }
    const active = runs.find((run) =>
      ["scheduled", "running"].includes(
        run.state,
      ));
    if (active) {
      return {
        reused: true,
        terminal: false,
        run: active,
        projectionRevision:
          this.revision(),
      };
    }
    const latest = runs[0] || null;
    if (
      latest &&
      input.retry !== true
    ) {
      return {
        reused: true,
        terminal: true,
        run: latest,
        projectionRevision:
          this.revision(),
      };
    }
    const attempt = latest
      ? latest.attempt + 1
      : 1;
    if (attempt > 3) {
      fail(
        "world_manager_aro_realization_mapping_retry_limit",
        contract.contractId,
      );
    }
    const createdAt =
      normalizeString(
        input.createdAt,
        nowIso(this.now),
      );
    const run =
      buildAroRealizationMappingRun({
        projectId:
          contract.projectId,
        contractRef:
          contextImport.contractRef,
        comparisonRef:
          contextImport
            .comparisonRef,
        currentAroRef:
          contextImport
            .currentAroRef,
        targetAroRef:
          contextImport
            .targetAroRef,
        repositorySnapshotRef:
          contextImport
            .repositorySnapshotRef,
        contextImportRef: {
          kind:
            "aro_realization_context_import",
          id:
            contextImport
              .contextImportId,
          digest:
            contextImport.digest,
          projectId:
            contextImport.projectId,
        },
        sourceIdentityDigest:
          contextImport
            .sourceIdentityDigest,
        attempt,
        state: "scheduled",
        createdAt,
        updatedAt: createdAt,
        now: this.now,
      });
    return {
      ...this
        .registerAroRealizationMappingRun({
          run,
        }),
      terminal: false,
    };
  }

  _insertImmutableAroWorkerArtifact(
    input = {},
  ) {
    const columns =
      Array.isArray(input.columns)
        ? input.columns
        : [];
    const values =
      Array.isArray(input.values)
        ? input.values
        : [];
    if (
      !input.table ||
      !input.idColumn ||
      !input.jsonColumn ||
      !input.id ||
      columns.length !== values.length
    ) {
      fail(
        "world_manager_aro_worker_store_insert_invalid",
      );
    }
    const existingRow =
      this.db.prepare(`
        select ${input.jsonColumn} as artifact_json
        from ${input.table}
        where ${input.idColumn} = ?
        limit 1
      `).get(input.id);
    if (existingRow) {
      const existing = parseJson(
        existingRow.artifact_json,
        null,
      );
      input.validate(existing);
      if (
        existing.digest !==
          input.artifact.digest
      ) {
        fail(
          "world_manager_aro_worker_identity_conflict",
          input.id,
        );
      }
      return {
        reused: true,
        artifact: existing,
      };
    }
    this.db.prepare(`
      insert into ${input.table} (
        ${columns.join(", ")}
      ) values (
        ${columns.map(() => "?").join(", ")}
      )
    `).run(...values);
    return {
      reused: false,
      artifact: input.artifact,
    };
  }

  registerAroWorkerReviewBundle(
    input = {},
  ) {
    const sourceFreshness =
      input.sourceFreshness;
    const capabilityObservation =
      input.capabilityObservation;
    const reviewReceipt =
      input.reviewReceipt;
    const constitution =
      input.constitution;
    validateAroWorkerSourceFreshnessWitness(
      sourceFreshness,
    );
    validateAroWorkerCapabilityObservation(
      capabilityObservation,
    );
    validateAroWorkerReviewReceipt(
      reviewReceipt,
    );
    validateAroWorkerConstitution(
      constitution,
    );
    return this.transaction(() => {
      const contract =
        this.aroMutationContractById(
          constitution.contractRef.id,
        );
      const contextImport =
        this
          .aroRealizationContextImportById(
            constitution
              .contextImportRef.id,
          );
      const mappingWitness =
        this
          .aroRealizationMappingWitnessById(
            constitution
              .mappingWitnessRef.id,
          );
      const refMatches = (
        left,
        right,
      ) =>
        left?.kind === right?.kind &&
        left?.id === right?.id &&
        left?.digest === right?.digest;
      if (
        !contract ||
        contract.digest !==
          constitution.contractRef.digest ||
        !contextImport ||
        contextImport.digest !==
          constitution.contextImportRef
            .digest ||
        !mappingWitness ||
        mappingWitness.digest !==
          constitution.mappingWitnessRef
            .digest ||
        !refMatches(
          sourceFreshness
            .contextImportRef,
          constitution
            .contextImportRef,
        ) ||
        !refMatches(
          reviewReceipt.contractRef,
          constitution.contractRef,
        ) ||
        !refMatches(
          reviewReceipt
            .contextImportRef,
          constitution
            .contextImportRef,
        ) ||
        !refMatches(
          reviewReceipt
            .mappingWitnessRef,
          constitution
            .mappingWitnessRef,
        ) ||
        reviewReceipt
          .sourceFreshnessRef.id !==
          sourceFreshness
            .sourceFreshnessWitnessId ||
        reviewReceipt
          .sourceFreshnessRef.digest !==
          sourceFreshness.digest ||
        reviewReceipt
          .capabilityObservationRef.id !==
          capabilityObservation
            .capabilityObservationId ||
        reviewReceipt
          .capabilityObservationRef.digest !==
          capabilityObservation.digest ||
        constitution.reviewReceiptRef.id !==
          reviewReceipt.reviewReceiptId ||
        constitution.reviewReceiptRef.digest !==
          reviewReceipt.digest
      ) {
        fail(
          "world_manager_aro_worker_review_bundle_binding_invalid",
          constitution.workerConstitutionId,
        );
      }
      const results = [];
      results.push(
        this
          ._insertImmutableAroWorkerArtifact({
            table:
              "wm_aro_worker_source_freshness",
            idColumn:
              "source_freshness_id",
            jsonColumn:
              "witness_json",
            id:
              sourceFreshness
                .sourceFreshnessWitnessId,
            artifact:
              sourceFreshness,
            validate:
              validateAroWorkerSourceFreshnessWitness,
            columns: [
              "source_freshness_id",
              "project_id",
              "context_import_id",
              "context_import_digest",
              "witness_state",
              "witness_json",
              "witness_digest",
              "created_at",
            ],
            values: [
              sourceFreshness
                .sourceFreshnessWitnessId,
              sourceFreshness.projectId,
              sourceFreshness
                .contextImportRef.id,
              sourceFreshness
                .contextImportRef.digest,
              sourceFreshness.state,
              json(sourceFreshness),
              sourceFreshness.digest,
              sourceFreshness.observedAt,
            ],
          }),
      );
      results.push(
        this
          ._insertImmutableAroWorkerArtifact({
            table:
              "wm_aro_worker_capability_observations",
            idColumn:
              "capability_observation_id",
            jsonColumn:
              "observation_json",
            id:
              capabilityObservation
                .capabilityObservationId,
            artifact:
              capabilityObservation,
            validate:
              validateAroWorkerCapabilityObservation,
            columns: [
              "capability_observation_id",
              "project_id",
              "worker_start_available",
              "observation_json",
              "observation_digest",
              "created_at",
            ],
            values: [
              capabilityObservation
                .capabilityObservationId,
              capabilityObservation
                .projectId,
              capabilityObservation
                .workerStartAvailable
                ? 1
                : 0,
              json(
                capabilityObservation,
              ),
              capabilityObservation.digest,
              capabilityObservation
                .observedAt,
            ],
          }),
      );
      results.push(
        this
          ._insertImmutableAroWorkerArtifact({
            table:
              "wm_aro_worker_review_receipts",
            idColumn:
              "review_receipt_id",
            jsonColumn:
              "receipt_json",
            id:
              reviewReceipt
                .reviewReceiptId,
            artifact:
              reviewReceipt,
            validate:
              validateAroWorkerReviewReceipt,
            columns: [
              "review_receipt_id",
              "project_id",
              "contract_id",
              "contract_digest",
              "mapping_witness_id",
              "mapping_witness_digest",
              "review_state",
              "receipt_json",
              "receipt_digest",
              "created_at",
            ],
            values: [
              reviewReceipt
                .reviewReceiptId,
              reviewReceipt.projectId,
              reviewReceipt.contractRef.id,
              reviewReceipt
                .contractRef.digest,
              reviewReceipt
                .mappingWitnessRef.id,
              reviewReceipt
                .mappingWitnessRef.digest,
              reviewReceipt.reviewState,
              json(reviewReceipt),
              reviewReceipt.digest,
              reviewReceipt.reviewedAt,
            ],
          }),
      );
      results.push(
        this
          ._insertImmutableAroWorkerArtifact({
            table:
              "wm_aro_worker_constitutions",
            idColumn:
              "constitution_id",
            jsonColumn:
              "constitution_json",
            id:
              constitution
                .workerConstitutionId,
            artifact:
              constitution,
            validate:
              validateAroWorkerConstitution,
            columns: [
              "constitution_id",
              "project_id",
              "contract_id",
              "contract_digest",
              "mapping_witness_id",
              "mapping_witness_digest",
              "review_receipt_id",
              "review_receipt_digest",
              "constitution_state",
              "constitution_json",
              "constitution_digest",
              "created_at",
            ],
            values: [
              constitution
                .workerConstitutionId,
              constitution.projectId,
              constitution.contractRef.id,
              constitution
                .contractRef.digest,
              constitution
                .mappingWitnessRef.id,
              constitution
                .mappingWitnessRef.digest,
              constitution.reviewReceiptRef.id,
              constitution
                .reviewReceiptRef.digest,
              constitution.constitutionState,
              json(constitution),
              constitution.digest,
              constitution.compiledAt,
            ],
          }),
      );
      const changed =
        results.some((entry) =>
          !entry.reused);
      return {
        reused: !changed,
        sourceFreshness:
          results[0].artifact,
        capabilityObservation:
          results[1].artifact,
        reviewReceipt:
          results[2].artifact,
        constitution:
          results[3].artifact,
        projectionRevision:
          changed
            ? this.incrementRevision()
            : this.revision(),
      };
    });
  }

  _listAroWorkerArtifacts(
    input = {},
  ) {
    const rows = this.db.prepare(`
      select ${input.jsonColumn} as artifact_json
      from ${input.table}
      order by rowid desc
      limit ?
    `).all(
      Math.min(
        1_000,
        Math.max(
          1,
          Number(input.limit || 200),
        ),
      ),
    );
    return rows.map((row) => {
      const artifact = parseJson(
        row.artifact_json,
        null,
      );
      input.validate(artifact);
      return artifact;
    }).filter((artifact) =>
      !input.projectId ||
      artifact.projectId ===
        input.projectId);
  }

  listAroWorkerSourceFreshness(
    options = {},
  ) {
    return this._listAroWorkerArtifacts({
      table:
        "wm_aro_worker_source_freshness",
      jsonColumn: "witness_json",
      validate:
        validateAroWorkerSourceFreshnessWitness,
      ...options,
    });
  }

  listAroWorkerCapabilityObservations(
    options = {},
  ) {
    return this._listAroWorkerArtifacts({
      table:
        "wm_aro_worker_capability_observations",
      jsonColumn: "observation_json",
      validate:
        validateAroWorkerCapabilityObservation,
      ...options,
    });
  }

  listAroWorkerReviewReceipts(
    options = {},
  ) {
    return this._listAroWorkerArtifacts({
      table:
        "wm_aro_worker_review_receipts",
      jsonColumn: "receipt_json",
      validate:
        validateAroWorkerReviewReceipt,
      ...options,
    }).filter((receipt) =>
      !options.contractDigest ||
      receipt.contractRef.digest ===
        options.contractDigest);
  }

  listAroWorkerConstitutions(
    options = {},
  ) {
    return this._listAroWorkerArtifacts({
      table:
        "wm_aro_worker_constitutions",
      jsonColumn: "constitution_json",
      validate:
        validateAroWorkerConstitution,
      ...options,
    }).filter((constitution) =>
      !options.contractDigest ||
      constitution.contractRef.digest ===
        options.contractDigest);
  }

  aroWorkerConstitutionById(
    constitutionId,
  ) {
    return this
      .listAroWorkerConstitutions({
        limit: 1_000,
      })
      .find((entry) =>
        entry.workerConstitutionId ===
          normalizeString(
            constitutionId,
            "",
          )) || null;
  }

  registerAroWorkerAuthorization(
    input = {},
  ) {
    const authorization =
      input.authorization || input;
    validateAroWorkerAuthorizationReceipt(
      authorization,
    );
    return this.transaction(() => {
      const constitution =
        this.aroWorkerConstitutionById(
          authorization
            .constitutionRef.id,
        );
      if (
        !constitution ||
        constitution.digest !==
          authorization
            .constitutionRef.digest
      ) {
        fail(
          "world_manager_aro_worker_authorization_binding_invalid",
          authorization
            .authorizationReceiptId,
        );
      }
      const result =
        this
          ._insertImmutableAroWorkerArtifact({
            table:
              "wm_aro_worker_authorizations",
            idColumn:
              "authorization_receipt_id",
            jsonColumn:
              "receipt_json",
            id:
              authorization
                .authorizationReceiptId,
            artifact:
              authorization,
            validate:
              validateAroWorkerAuthorizationReceipt,
            columns: [
              "authorization_receipt_id",
              "project_id",
              "constitution_id",
              "constitution_digest",
              "operator_action_id",
              "authorization_state",
              "receipt_json",
              "receipt_digest",
              "created_at",
            ],
            values: [
              authorization
                .authorizationReceiptId,
              authorization.projectId,
              authorization
                .constitutionRef.id,
              authorization
                .constitutionRef.digest,
              authorization.operatorActionId,
              authorization
                .authorizationState,
              json(authorization),
              authorization.digest,
              authorization.authorizedAt,
            ],
          });
      return {
        reused: result.reused,
        authorization:
          result.artifact,
        projectionRevision:
          result.reused
            ? this.revision()
            : this.incrementRevision(),
      };
    });
  }

  listAroWorkerAuthorizations(
    options = {},
  ) {
    return this._listAroWorkerArtifacts({
      table:
        "wm_aro_worker_authorizations",
      jsonColumn: "receipt_json",
      validate:
        validateAroWorkerAuthorizationReceipt,
      ...options,
    }).filter((authorization) =>
      !options.constitutionDigest ||
      authorization
        .constitutionRef.digest ===
          options.constitutionDigest);
  }

  aroWorkerAuthorizationById(
    authorizationReceiptId,
  ) {
    return this
      .listAroWorkerAuthorizations({
        limit: 1_000,
      })
      .find((entry) =>
        entry.authorizationReceiptId ===
          normalizeString(
            authorizationReceiptId,
            "",
          )) || null;
  }

  _currentAroWorkerHandoffRunWithinTransaction(
    runId,
  ) {
    const row = this.db.prepare(`
      select run_json
      from wm_aro_worker_handoff_runs
      where run_id = ?
        and current_state = 'current'
      order by run_revision desc
      limit 1
    `).get(
      normalizeString(runId, ""),
    );
    if (!row) return null;
    const run = parseJson(
      row.run_json,
      null,
    );
    validateAroWorkerHandoffRun(run);
    return run;
  }

  registerAroWorkerHandoffRun(
    input = {},
  ) {
    const run = input.run || input;
    validateAroWorkerHandoffRun(run);
    return this.transaction(() => {
      const constitution =
        this.aroWorkerConstitutionById(
          run.constitutionRef.id,
        );
      const authorization =
        this.aroWorkerAuthorizationById(
          run.authorizationRef.id,
        );
      if (
        !constitution ||
        constitution.digest !==
          run.constitutionRef.digest ||
        !authorization ||
        authorization.digest !==
          run.authorizationRef.digest ||
        authorization.constitutionRef.id !==
          constitution
            .workerConstitutionId ||
        authorization
          .constitutionRef.digest !==
          constitution.digest
      ) {
        fail(
          "world_manager_aro_worker_handoff_run_binding_invalid",
          run.runId,
        );
      }
      const current =
        this
          ._currentAroWorkerHandoffRunWithinTransaction(
            run.runId,
          );
      if (current?.digest === run.digest) {
        return {
          reused: true,
          run: current,
          projectionRevision:
            this.revision(),
        };
      }
      if (current) {
        if (
          run.runRevision !==
            current.runRevision + 1 ||
          run.predecessorRef?.kind !==
            "aro_worker_handoff_run" ||
          run.predecessorRef?.id !==
            current.runId ||
          run.predecessorRef?.digest !==
            current.digest
        ) {
          fail(
            "world_manager_aro_worker_handoff_run_revision_conflict",
            run.runId,
          );
        }
        const allowed =
          current.state === "scheduled"
            ? [
                "running",
                "blocked",
                "failed",
              ]
            : current.state === "running"
              ? [
                  "handed_off",
                  "blocked",
                  "failed",
                ]
              : [];
        if (!allowed.includes(run.state)) {
          fail(
            "world_manager_aro_worker_handoff_run_transition_invalid",
            `${current.state}:${run.state}`,
          );
        }
        this.db.prepare(`
          update wm_aro_worker_handoff_runs
          set current_state = 'superseded'
          where run_id = ?
            and current_state = 'current'
        `).run(run.runId);
      } else if (
        run.runRevision !== 1 ||
        run.predecessorRef ||
        run.state !== "scheduled"
      ) {
        fail(
          "world_manager_aro_worker_handoff_run_initial_invalid",
          run.runId,
        );
      }
      this.db.prepare(`
        insert into wm_aro_worker_handoff_runs (
          run_record_id,
          run_id,
          project_id,
          constitution_id,
          constitution_digest,
          authorization_receipt_id,
          authorization_receipt_digest,
          run_revision,
          run_state,
          current_state,
          run_json,
          run_digest,
          created_at,
          updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'current', ?, ?, ?, ?)
      `).run(
        stableId(
          "wm_aro_worker_handoff_run_record",
          {
            runId: run.runId,
            runRevision:
              run.runRevision,
            digest: run.digest,
          },
        ),
        run.runId,
        run.projectId,
        run.constitutionRef.id,
        run.constitutionRef.digest,
        run.authorizationRef.id,
        run.authorizationRef.digest,
        run.runRevision,
        run.state,
        json(run),
        run.digest,
        run.createdAt,
        run.updatedAt,
      );
      return {
        reused: false,
        run,
        projectionRevision:
          this.incrementRevision(),
      };
    });
  }

  listAroWorkerHandoffRuns(
    options = {},
  ) {
    const where = [];
    const values = [];
    if (options.currentOnly !== false) {
      where.push(
        "current_state = 'current'",
      );
    }
    if (
      normalizeString(
        options.projectId,
        "",
      )
    ) {
      where.push("project_id = ?");
      values.push(options.projectId);
    }
    if (
      normalizeString(
        options.constitutionDigest,
        "",
      )
    ) {
      where.push(
        "constitution_digest = ?",
      );
      values.push(
        options.constitutionDigest,
      );
    }
    return this.db.prepare(`
      select run_json
      from wm_aro_worker_handoff_runs
      ${where.length
        ? `where ${where.join(" and ")}`
        : ""}
      order by rowid desc
    `).all(...values).map((row) => {
      const run = parseJson(
        row.run_json,
        null,
      );
      validateAroWorkerHandoffRun(run);
      return run;
    });
  }

  scheduleAroWorkerHandoffRun(
    input = {},
  ) {
    const constitution =
      input.constitution;
    const authorization =
      input.authorization;
    validateAroWorkerConstitution(
      constitution,
    );
    validateAroWorkerAuthorizationReceipt(
      authorization,
    );
    const existing =
      this
        .listAroWorkerHandoffRuns({
          projectId:
            constitution.projectId,
          constitutionDigest:
            constitution.digest,
          currentOnly: true,
        })
        .find((run) =>
          run.authorizationRef.id ===
            authorization
              .authorizationReceiptId &&
          run.authorizationRef.digest ===
            authorization.digest);
    if (existing) {
      return {
        reused: true,
        terminal:
          ["handed_off", "blocked", "failed"]
            .includes(existing.state),
        run: existing,
        projectionRevision:
          this.revision(),
      };
    }
    const createdAt =
      normalizeString(
        input.createdAt,
        nowIso(this.now),
      );
    const run =
      buildAroWorkerHandoffRun({
        projectId:
          constitution.projectId,
        constitutionRef: {
          kind:
            "aro_worker_constitution",
          id:
            constitution
              .workerConstitutionId,
          digest:
            constitution.digest,
          projectId:
            constitution.projectId,
        },
        authorizationRef: {
          kind:
            "aro_worker_authorization_receipt",
          id:
            authorization
              .authorizationReceiptId,
          digest:
            authorization.digest,
          projectId:
            authorization.projectId,
        },
        state: "scheduled",
        createdAt,
        updatedAt: createdAt,
        now: this.now,
      });
    return {
      ...this.registerAroWorkerHandoffRun({
        run,
      }),
      terminal: false,
    };
  }

  recoverInterruptedAroWorkerHandoffRuns() {
    const interrupted =
      this
        .listAroWorkerHandoffRuns({
          currentOnly: true,
        })
        .filter((run) =>
          ["scheduled", "running"].includes(
            run.state,
          ));
    for (const run of interrupted) {
      this.registerAroWorkerHandoffRun({
        run:
          reviseAroWorkerHandoffRun(
            run,
            {
              state: "failed",
              error: {
                code:
                  "world_manager_aro_worker_handoff_runtime_restart",
                message:
                  "The runtime restarted during an uncertain worker-start transition. This single-use authorization will not be replayed; review and authorize a fresh handoff.",
              },
              updatedAt:
                nowIso(this.now),
              now: this.now,
            },
          ),
      });
    }
    return {
      recovered:
        interrupted.length,
      projectionRevision:
        this.revision(),
    };
  }

  registerAroExecutionEvidenceBundle(
    input = {},
  ) {
    const bundle =
      input.bundle || input;
    validateAroExecutionEvidenceBundle(
      bundle,
    );
    return this.transaction(() => {
      const handoffRun =
        this
          .listAroWorkerHandoffRuns({
            currentOnly: false,
          })
          .find((entry) =>
            entry.runId ===
              bundle.handoffRunRef.id &&
            entry.digest ===
              bundle.handoffRunRef
                .digest);
      const acquisitionRun =
        this
          .listAroExecutionEvidenceRuns({
            currentOnly: false,
          })
          .find((entry) =>
            entry.runId ===
              bundle
                .acquisitionRunRef.id &&
            entry.digest ===
              bundle
                .acquisitionRunRef
                .digest);
      if (
        !handoffRun ||
        handoffRun.state !==
          "handed_off" ||
        !acquisitionRun ||
        acquisitionRun.state !==
          "running" ||
        acquisitionRun
          .handoffRunRef.id !==
          handoffRun.runId ||
        acquisitionRun
          .handoffRunRef.digest !==
          handoffRun.digest
      ) {
        fail(
          "world_manager_aro_execution_evidence_bundle_binding_invalid",
          bundle.evidenceBundleId,
        );
      }
      const existing =
        this.db.prepare(`
          select bundle_json
          from wm_aro_execution_evidence_bundles
          where evidence_bundle_id = ?
          limit 1
        `).get(
          bundle.evidenceBundleId,
        );
      if (existing) {
        const stored = parseJson(
          existing.bundle_json,
          null,
        );
        validateAroExecutionEvidenceBundle(
          stored,
        );
        if (
          stored.digest !==
          bundle.digest
        ) {
          fail(
            "world_manager_aro_execution_evidence_bundle_conflict",
            bundle.evidenceBundleId,
          );
        }
        return {
          reused: true,
          bundle: stored,
          projectionRevision:
            this.revision(),
        };
      }
      this.db.prepare(`
        insert into wm_aro_execution_evidence_bundles (
          evidence_bundle_id,
          project_id,
          handoff_run_id,
          handoff_run_digest,
          acquisition_run_id,
          acquisition_run_digest,
          capture_state,
          bundle_json,
          bundle_digest,
          created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        bundle.evidenceBundleId,
        bundle.projectId,
        bundle.handoffRunRef.id,
        bundle.handoffRunRef.digest,
        bundle.acquisitionRunRef.id,
        bundle.acquisitionRunRef.digest,
        bundle.captureState,
        json(bundle),
        bundle.digest,
        bundle.acquiredAt,
      );
      return {
        reused: false,
        bundle,
        projectionRevision:
          this.incrementRevision(),
      };
    });
  }

  listAroExecutionEvidenceBundles(
    options = {},
  ) {
    const where = [];
    const values = [];
    if (
      normalizeString(
        options.projectId,
        "",
      )
    ) {
      where.push("project_id = ?");
      values.push(options.projectId);
    }
    if (
      normalizeString(
        options.handoffRunId,
        "",
      )
    ) {
      where.push("handoff_run_id = ?");
      values.push(
        options.handoffRunId,
      );
    }
    return this.db.prepare(`
      select bundle_json
      from wm_aro_execution_evidence_bundles
      ${where.length
        ? `where ${where.join(" and ")}`
        : ""}
      order by rowid desc
      limit ?
    `).all(
      ...values,
      Math.min(
        1_000,
        Math.max(
          1,
          Number(
            options.limit || 200,
          ),
        ),
      ),
    ).map((row) => {
      const bundle = parseJson(
        row.bundle_json,
        null,
      );
      validateAroExecutionEvidenceBundle(
        bundle,
      );
      return bundle;
    });
  }

  aroExecutionEvidenceBundleById(
    evidenceBundleId,
  ) {
    return this
      .listAroExecutionEvidenceBundles({
        limit: 1_000,
      })
      .find((entry) =>
        entry.evidenceBundleId ===
          normalizeString(
            evidenceBundleId,
            "",
          )) || null;
  }

  _currentAroExecutionEvidenceRunWithinTransaction(
    runId,
  ) {
    const row = this.db.prepare(`
      select run_json
      from wm_aro_execution_evidence_runs
      where run_id = ?
        and current_state = 'current'
      order by run_revision desc
      limit 1
    `).get(
      normalizeString(runId, ""),
    );
    if (!row) return null;
    const run = parseJson(
      row.run_json,
      null,
    );
    validateAroExecutionEvidenceRun(
      run,
    );
    return run;
  }

  registerAroExecutionEvidenceRun(
    input = {},
  ) {
    const run = input.run || input;
    validateAroExecutionEvidenceRun(
      run,
    );
    return this.transaction(() => {
      const handoffRun =
        this
          .listAroWorkerHandoffRuns({
            currentOnly: false,
          })
          .find((entry) =>
            entry.runId ===
              run.handoffRunRef.id &&
            entry.digest ===
              run.handoffRunRef
                .digest);
      if (
        !handoffRun ||
        handoffRun.state !==
          "handed_off" ||
        handoffRun.projectId !==
          run.projectId
      ) {
        fail(
          "world_manager_aro_execution_evidence_run_binding_invalid",
          run.runId,
        );
      }
      if (
        run.evidenceBundleRef
      ) {
        const bundle =
          this
            .aroExecutionEvidenceBundleById(
              run.evidenceBundleRef.id,
            );
        if (
          !bundle ||
          bundle.digest !==
            run
              .evidenceBundleRef.digest ||
          bundle.handoffRunRef.id !==
            handoffRun.runId ||
          bundle
            .acquisitionRunRef.id !==
            run.runId
        ) {
          fail(
            "world_manager_aro_execution_evidence_run_bundle_binding_invalid",
            run.runId,
          );
        }
      }
      const current =
        this
          ._currentAroExecutionEvidenceRunWithinTransaction(
            run.runId,
          );
      if (current?.digest === run.digest) {
        return {
          reused: true,
          run: current,
          projectionRevision:
            this.revision(),
        };
      }
      if (current) {
        if (
          run.runRevision !==
            current.runRevision + 1 ||
          run.predecessorRef?.kind !==
            "aro_execution_evidence_run" ||
          run.predecessorRef?.id !==
            current.runId ||
          run.predecessorRef?.digest !==
            current.digest
        ) {
          fail(
            "world_manager_aro_execution_evidence_run_revision_conflict",
            run.runId,
          );
        }
        const allowed =
          current.state === "scheduled"
            ? [
                "running",
                "failed",
              ]
            : current.state === "running"
              ? [
                  "observing",
                  "acquired",
                  "failed",
                ]
              : [];
        if (!allowed.includes(run.state)) {
          fail(
            "world_manager_aro_execution_evidence_run_transition_invalid",
            `${current.state}:${run.state}`,
          );
        }
        this.db.prepare(`
          update wm_aro_execution_evidence_runs
          set current_state = 'superseded'
          where run_id = ?
            and current_state = 'current'
        `).run(run.runId);
      } else if (
        run.runRevision !== 1 ||
        run.predecessorRef ||
        run.state !== "scheduled"
      ) {
        fail(
          "world_manager_aro_execution_evidence_run_initial_invalid",
          run.runId,
        );
      }
      this.db.prepare(`
        insert into wm_aro_execution_evidence_runs (
          run_record_id,
          run_id,
          project_id,
          handoff_run_id,
          handoff_run_digest,
          observation_request_id,
          run_revision,
          run_state,
          current_state,
          run_json,
          run_digest,
          created_at,
          updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, 'current', ?, ?, ?, ?)
      `).run(
        stableId(
          "wm_aro_execution_evidence_run_record",
          {
            runId: run.runId,
            runRevision:
              run.runRevision,
            digest: run.digest,
          },
        ),
        run.runId,
        run.projectId,
        run.handoffRunRef.id,
        run.handoffRunRef.digest,
        run.observationRequestId,
        run.runRevision,
        run.state,
        json(run),
        run.digest,
        run.createdAt,
        run.updatedAt,
      );
      return {
        reused: false,
        run,
        projectionRevision:
          this.incrementRevision(),
      };
    });
  }

  listAroExecutionEvidenceRuns(
    options = {},
  ) {
    const where = [];
    const values = [];
    if (options.currentOnly !== false) {
      where.push(
        "current_state = 'current'",
      );
    }
    if (
      normalizeString(
        options.projectId,
        "",
      )
    ) {
      where.push("project_id = ?");
      values.push(options.projectId);
    }
    if (
      normalizeString(
        options.handoffRunId,
        "",
      )
    ) {
      where.push("handoff_run_id = ?");
      values.push(
        options.handoffRunId,
      );
    }
    return this.db.prepare(`
      select run_json
      from wm_aro_execution_evidence_runs
      ${where.length
        ? `where ${where.join(" and ")}`
        : ""}
      order by rowid desc
    `).all(...values).map((row) => {
      const run = parseJson(
        row.run_json,
        null,
      );
      validateAroExecutionEvidenceRun(
        run,
      );
      return run;
    });
  }

  scheduleAroExecutionEvidenceRun(
    input = {},
  ) {
    const handoffRun =
      input.handoffRun;
    validateAroWorkerHandoffRun(
      handoffRun,
    );
    if (
      handoffRun.state !==
      "handed_off"
    ) {
      fail(
        "world_manager_aro_execution_evidence_handoff_not_ready",
        handoffRun.runId,
      );
    }
    const observationRequestId =
      normalizeString(
        input.observationRequestId,
        "",
      );
    const existing =
      this
        .listAroExecutionEvidenceRuns({
          handoffRunId:
            handoffRun.runId,
          currentOnly: true,
        })
        .find((entry) =>
          entry.observationRequestId ===
          observationRequestId);
    if (existing) {
      return {
        reused: true,
        terminal:
          [
            "observing",
            "acquired",
            "failed",
          ].includes(existing.state),
        run: existing,
        projectionRevision:
          this.revision(),
      };
    }
    const createdAt =
      normalizeString(
        input.createdAt,
        nowIso(this.now),
      );
    const run =
      buildAroExecutionEvidenceRun({
        projectId:
          handoffRun.projectId,
        handoffRunRef: {
          kind:
            "aro_worker_handoff_run",
          id: handoffRun.runId,
          digest:
            handoffRun.digest,
          projectId:
            handoffRun.projectId,
        },
        observationRequestId,
        state: "scheduled",
        createdAt,
        updatedAt: createdAt,
        now: this.now,
      });
    return {
      ...this.registerAroExecutionEvidenceRun({
        run,
      }),
      terminal: false,
    };
  }

  recoverInterruptedAroExecutionEvidenceRuns() {
    const interrupted =
      this
        .listAroExecutionEvidenceRuns({
          currentOnly: true,
        })
        .filter((run) =>
          ["scheduled", "running"].includes(
            run.state,
          ));
    for (const run of interrupted) {
      this.registerAroExecutionEvidenceRun({
        run:
          reviseAroExecutionEvidenceRun(
            run,
            {
              state: "failed",
              error: {
                code:
                  "world_manager_aro_execution_evidence_runtime_restart",
                message:
                  "The runtime restarted during read-only execution-evidence acquisition. No effect was replayed; request a fresh observation.",
              },
              updatedAt:
                nowIso(this.now),
              now: this.now,
            },
          ),
      });
    }
    return {
      recovered:
        interrupted.length,
      projectionRevision:
        this.revision(),
    };
  }

  registerAroSemanticVerificationBundle(
    input = {},
  ) {
    const assessment = input.assessment;
    const closureCandidate =
      input.closureCandidate;
    validateAroSemanticVerificationAssessment(
      assessment,
    );
    validateAroClosureCandidate(
      closureCandidate,
    );
    return this.transaction(() => {
      const evidenceBundle =
        this.aroExecutionEvidenceBundleById(
          assessment
            .evidenceBundleRef.id,
        );
      if (
        !evidenceBundle ||
        evidenceBundle.digest !==
          assessment
            .evidenceBundleRef.digest ||
        evidenceBundle.captureState !==
          "acquired" ||
        closureCandidate
          .assessmentRef.id !==
          assessment.assessmentId ||
        closureCandidate
          .assessmentRef.digest !==
          assessment.digest ||
        closureCandidate
          .evidenceBundleRef.id !==
          evidenceBundle
            .evidenceBundleId ||
        closureCandidate
          .evidenceBundleRef.digest !==
          evidenceBundle.digest
      ) {
        fail(
          "world_manager_aro_semantic_verification_bundle_binding_invalid",
          assessment.assessmentId,
        );
      }
      const existingAssessmentRow =
        this.db.prepare(`
          select assessment_json
          from wm_aro_semantic_verification_assessments
          where assessment_id = ?
          limit 1
        `).get(
          assessment.assessmentId,
        );
      if (existingAssessmentRow) {
        const existing =
          parseJson(
            existingAssessmentRow
              .assessment_json,
            null,
          );
        validateAroSemanticVerificationAssessment(
          existing,
        );
        if (
          existing.digest !==
            assessment.digest
        ) {
          fail(
            "world_manager_aro_semantic_verification_assessment_conflict",
            assessment.assessmentId,
          );
        }
      } else {
        this.db.prepare(`
          insert into wm_aro_semantic_verification_assessments (
            assessment_id,
            project_id,
            evidence_bundle_id,
            evidence_bundle_digest,
            overall_posture,
            assessment_json,
            assessment_digest,
            created_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          assessment.assessmentId,
          assessment.projectId,
          assessment
            .evidenceBundleRef.id,
          assessment
            .evidenceBundleRef.digest,
          assessment.overallPosture,
          json(assessment),
          assessment.digest,
          assessment.assessedAt,
        );
      }
      const existingCandidateRow =
        this.db.prepare(`
          select candidate_json
          from wm_aro_closure_candidates
          where closure_candidate_id = ?
          limit 1
        `).get(
          closureCandidate
            .closureCandidateId,
        );
      if (existingCandidateRow) {
        const existing =
          parseJson(
            existingCandidateRow
              .candidate_json,
            null,
          );
        validateAroClosureCandidate(
          existing,
        );
        if (
          existing.digest !==
            closureCandidate.digest
        ) {
          fail(
            "world_manager_aro_closure_candidate_conflict",
            closureCandidate
              .closureCandidateId,
          );
        }
      } else {
        this.db.prepare(`
          insert into wm_aro_closure_candidates (
            closure_candidate_id,
            project_id,
            assessment_id,
            assessment_digest,
            gate_disposition,
            candidate_json,
            candidate_digest,
            created_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          closureCandidate
            .closureCandidateId,
          closureCandidate.projectId,
          closureCandidate
            .assessmentRef.id,
          closureCandidate
            .assessmentRef.digest,
          closureCandidate
            .gateDisposition,
          json(closureCandidate),
          closureCandidate.digest,
          closureCandidate.createdAt,
        );
      }
      const bootstrap =
        this.currentBootstrap();
      const openDecisions = [];
      for (
        const proposal of
          assessment.decisionProposals
      ) {
        const decisionId = stableId(
          "wm_aro_verification_open_decision",
          {
            assessmentRef:
              assessmentRef(
                assessment,
              ),
            decisionKey:
              proposal.decisionKey,
          },
        );
        const current =
          this
            ._currentSemanticArtifactWithinTransaction(
              decisionId,
            );
        const decision =
          current ||
          buildOpenDecision({
            decisionId,
            decisionKind:
              "aro_semantic_verification_decision",
            question:
              proposal.question,
            description:
              proposal.description,
            resolutionMode:
              "semantic_relay",
            options:
              proposal.options,
            dependencies: [],
        consequences: [{
              effectClass:
                "semantic_deliberation",
              description:
                "The response re-enters WorldManager semantic ingress; no closure or admission effect runs automatically.",
            }],
            decisionState: "open",
            sourceKind:
              "aro_semantic_verification",
            sourceKey:
              `${assessment.assessmentId}:${proposal.decisionKey}`,
            sourceStateDigest:
              digestFor(
                "direct_aro_verification_decision_source@1",
                {
                  assessmentRef:
                    assessmentRef(
                      assessment,
                    ),
                  proposal,
                },
              ),
            semanticIdentity:
              proposal.question,
            scope: {
              kind: "project",
              userWorldId:
                bootstrap?.userWorld
                  ?.userWorldId ||
                "user_world_local",
              projectId:
                assessment.projectId,
            },
            ownerRole:
              "world_manager",
            semanticAuthorRole:
              "world_manager",
            epistemicPosture:
              "candidate",
            provenanceRefs: [
              assessmentRef(
                assessment,
              ),
              assessment
                .evidenceBundleRef,
            ],
            revision: 1,
            now: this.now,
          });
        const appended =
          this
            ._appendSemanticArtifactRevisionWithinTransaction(
              decision,
            );
        openDecisions.push(
          appended.artifact,
        );
      }
      this._rebuildSemanticShelvesWithinTransaction();
      return {
        reused:
          Boolean(
            existingAssessmentRow &&
            existingCandidateRow,
          ),
        assessment,
        closureCandidate,
        openDecisions,
        projectionRevision:
          this.incrementRevision(),
      };
    });
  }

  listAroSemanticVerificationAssessments(
    options = {},
  ) {
    const where = [];
    const values = [];
    if (
      normalizeString(
        options.projectId,
        "",
      )
    ) {
      where.push("project_id = ?");
      values.push(options.projectId);
    }
    if (
      normalizeString(
        options.evidenceBundleId,
        "",
      )
    ) {
      where.push(
        "evidence_bundle_id = ?",
      );
      values.push(
        options.evidenceBundleId,
      );
    }
    const limit = Math.min(
      1_000,
      Math.max(
        1,
        Number(options.limit || 200),
      ),
    );
    return this.db.prepare(`
      select assessment_json
      from wm_aro_semantic_verification_assessments
      ${where.length
        ? `where ${where.join(" and ")}`
        : ""}
      order by rowid desc
      limit ?
    `).all(
      ...values,
      limit,
    ).map((row) => {
      const assessment = parseJson(
        row.assessment_json,
        null,
      );
      validateAroSemanticVerificationAssessment(
        assessment,
      );
      return assessment;
    });
  }

  aroSemanticVerificationAssessmentById(
    assessmentId,
  ) {
    return this
      .listAroSemanticVerificationAssessments({
        limit: 1_000,
      })
      .find((entry) =>
        entry.assessmentId ===
          normalizeString(
            assessmentId,
            "",
          )) || null;
  }

  listAroClosureCandidates(
    options = {},
  ) {
    const where = [];
    const values = [];
    if (
      normalizeString(
        options.projectId,
        "",
      )
    ) {
      where.push("project_id = ?");
      values.push(options.projectId);
    }
    if (
      normalizeString(
        options.assessmentId,
        "",
      )
    ) {
      where.push("assessment_id = ?");
      values.push(
        options.assessmentId,
      );
    }
    const limit = Math.min(
      1_000,
      Math.max(
        1,
        Number(options.limit || 200),
      ),
    );
    return this.db.prepare(`
      select candidate_json
      from wm_aro_closure_candidates
      ${where.length
        ? `where ${where.join(" and ")}`
        : ""}
      order by rowid desc
      limit ?
    `).all(
      ...values,
      limit,
    ).map((row) => {
      const candidate = parseJson(
        row.candidate_json,
        null,
      );
      validateAroClosureCandidate(
        candidate,
      );
      return candidate;
    });
  }

  _currentAroSemanticVerificationRunWithinTransaction(
    runId,
  ) {
    const row = this.db.prepare(`
      select run_json
      from wm_aro_semantic_verification_runs
      where run_id = ?
        and current_state = 'current'
      order by run_revision desc
      limit 1
    `).get(
      normalizeString(runId, ""),
    );
    if (!row) return null;
    const run = parseJson(
      row.run_json,
      null,
    );
    validateAroSemanticVerificationRun(
      run,
    );
    return run;
  }

  registerAroSemanticVerificationRun(
    input = {},
  ) {
    const run = input.run || input;
    validateAroSemanticVerificationRun(
      run,
    );
    return this.transaction(() => {
      const bundle =
        this.aroExecutionEvidenceBundleById(
          run.evidenceBundleRef.id,
        );
      if (
        !bundle ||
        bundle.digest !==
          run.evidenceBundleRef.digest ||
        bundle.captureState !==
          "acquired"
      ) {
        fail(
          "world_manager_aro_semantic_verification_run_binding_invalid",
          run.runId,
        );
      }
      if (run.assessmentRef) {
        const assessment =
          this
            .aroSemanticVerificationAssessmentById(
              run.assessmentRef.id,
            );
        const candidate =
          this
            .listAroClosureCandidates({
              assessmentId:
                run.assessmentRef.id,
              limit: 10,
            })
            .find((entry) =>
              entry
                .closureCandidateId ===
                run
                  .closureCandidateRef
                  ?.id);
        if (
          !assessment ||
          assessment.digest !==
            run.assessmentRef.digest ||
          !candidate ||
          candidate.digest !==
            run
              .closureCandidateRef
              ?.digest
        ) {
          fail(
            "world_manager_aro_semantic_verification_run_result_binding_invalid",
            run.runId,
          );
        }
      }
      const current =
        this
          ._currentAroSemanticVerificationRunWithinTransaction(
            run.runId,
          );
      if (current?.digest === run.digest) {
        return {
          reused: true,
          run: current,
          projectionRevision:
            this.revision(),
        };
      }
      if (current) {
        if (
          run.runRevision !==
            current.runRevision + 1 ||
          run.predecessorRef?.id !==
            current.runId ||
          run.predecessorRef?.digest !==
            current.digest
        ) {
          fail(
            "world_manager_aro_semantic_verification_run_revision_conflict",
            run.runId,
          );
        }
        const allowed =
          current.state === "scheduled"
            ? ["running", "failed"]
            : current.state === "running"
              ? [
                  "completed",
                  "remanded",
                  "failed",
                ]
              : [];
        if (!allowed.includes(run.state)) {
          fail(
            "world_manager_aro_semantic_verification_run_transition_invalid",
            `${current.state}:${run.state}`,
          );
        }
        this.db.prepare(`
          update wm_aro_semantic_verification_runs
          set current_state = 'superseded'
          where run_id = ?
            and current_state = 'current'
        `).run(run.runId);
      } else if (
        run.runRevision !== 1 ||
        run.predecessorRef ||
        run.state !== "scheduled"
      ) {
        fail(
          "world_manager_aro_semantic_verification_run_initial_invalid",
          run.runId,
        );
      }
      this.db.prepare(`
        insert into wm_aro_semantic_verification_runs (
          run_record_id,
          run_id,
          project_id,
          evidence_bundle_id,
          evidence_bundle_digest,
          attempt,
          run_revision,
          run_state,
          current_state,
          run_json,
          run_digest,
          created_at,
          updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, 'current', ?, ?, ?, ?)
      `).run(
        stableId(
          "wm_aro_semantic_verification_run_record",
          {
            runId: run.runId,
            runRevision:
              run.runRevision,
            digest: run.digest,
          },
        ),
        run.runId,
        run.projectId,
        run.evidenceBundleRef.id,
        run.evidenceBundleRef.digest,
        run.attempt,
        run.runRevision,
        run.state,
        json(run),
        run.digest,
        run.createdAt,
        run.updatedAt,
      );
      return {
        reused: false,
        run,
        projectionRevision:
          this.incrementRevision(),
      };
    });
  }

  listAroSemanticVerificationRuns(
    options = {},
  ) {
    const where = [];
    const values = [];
    if (options.currentOnly !== false) {
      where.push(
        "current_state = 'current'",
      );
    }
    if (
      normalizeString(
        options.projectId,
        "",
      )
    ) {
      where.push("project_id = ?");
      values.push(options.projectId);
    }
    if (
      normalizeString(
        options.evidenceBundleId,
        "",
      )
    ) {
      where.push(
        "evidence_bundle_id = ?",
      );
      values.push(
        options.evidenceBundleId,
      );
    }
    return this.db.prepare(`
      select run_json
      from wm_aro_semantic_verification_runs
      ${where.length
        ? `where ${where.join(" and ")}`
        : ""}
      order by rowid desc
    `).all(...values).map((row) => {
      const run = parseJson(
        row.run_json,
        null,
      );
      validateAroSemanticVerificationRun(
        run,
      );
      return run;
    });
  }

  scheduleAroSemanticVerificationRun(
    input = {},
  ) {
    const bundle = input.bundle;
    validateAroExecutionEvidenceBundle(
      bundle,
    );
    if (
      bundle.captureState !==
        "acquired" ||
      bundle.workerTurnTerminal !== true
    ) {
      fail(
        "world_manager_aro_semantic_verification_evidence_not_ready",
        bundle.evidenceBundleId,
      );
    }
    const existingRuns =
      this
        .listAroSemanticVerificationRuns({
          evidenceBundleId:
            bundle.evidenceBundleId,
          currentOnly: true,
        });
    const requestedAttempt =
      Math.max(
        1,
        Number(
          input.attempt ||
          (
            existingRuns.length
              ? Math.max(
                  ...existingRuns.map(
                    (run) =>
                      run.attempt,
                  ),
                )
              : 1
          ),
        ),
      );
    const existing =
      existingRuns.find((run) =>
        run.attempt ===
          requestedAttempt);
    if (existing) {
      return {
        reused: true,
        terminal:
          [
            "completed",
            "remanded",
            "failed",
          ].includes(existing.state),
        run: existing,
        projectionRevision:
          this.revision(),
      };
    }
    const createdAt =
      normalizeString(
        input.createdAt,
        nowIso(this.now),
      );
    const run =
      buildAroSemanticVerificationRun({
        projectId: bundle.projectId,
        evidenceBundleRef: {
          kind:
            "aro_execution_evidence_bundle",
          id: bundle.evidenceBundleId,
          digest: bundle.digest,
          projectId: bundle.projectId,
        },
        attempt: requestedAttempt,
        state: "scheduled",
        createdAt,
        updatedAt: createdAt,
        now: this.now,
      });
    return {
      ...this
        .registerAroSemanticVerificationRun({
          run,
        }),
      terminal: false,
    };
  }

  recoverInterruptedAroSemanticVerificationRuns() {
    const interrupted =
      this
        .listAroSemanticVerificationRuns({
          currentOnly: true,
        })
        .filter((run) =>
          ["scheduled", "running"].includes(
            run.state,
          ));
    for (const run of interrupted) {
      this
        .registerAroSemanticVerificationRun({
          run:
            reviseAroSemanticVerificationRun(
              run,
              {
                state: "failed",
                error: {
                  code:
                    "world_manager_aro_semantic_verification_runtime_restart",
                  message:
                    "The runtime restarted during semantic verification. No semantic result or authority was inferred; retry against the same acquired evidence bundle.",
                },
                updatedAt:
                  nowIso(this.now),
                now: this.now,
              },
            ),
        });
    }
    return {
      recovered:
        interrupted.length,
      projectionRevision:
        this.revision(),
    };
  }

  registerThoughtBrushStroke(
    input = {},
  ) {
    const stroke =
      input.stroke || input;
    validateThoughtBrushStroke(
      stroke,
    );
    return this.transaction(() => {
      const row = this.db.prepare(`
        select stroke_json
        from wm_thought_brush_strokes
        where brush_stroke_id = ?
        limit 1
      `).get(stroke.brushStrokeId);
      if (row) {
        const existing = parseJson(
          row.stroke_json,
          null,
        );
        validateThoughtBrushStroke(
          existing,
        );
        if (
          existing.digest !==
            stroke.digest
        ) {
          fail(
            "world_manager_thought_brush_stroke_idempotency_conflict",
            stroke.brushStrokeId,
          );
        }
        return {
          changed: false,
          reused: true,
          stroke: existing,
          projectionRevision:
            this.revision(),
        };
      }
      this.db.prepare(`
        insert into wm_thought_brush_strokes (
          brush_stroke_id,
          project_id,
          target_project_id,
          brush_kind,
          stroke_state,
          stroke_json,
          stroke_digest,
          created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        stroke.brushStrokeId,
        stroke.projectId,
        stroke.targetProjectId,
        stroke.brush,
        stroke.state,
        json(stroke),
        stroke.digest,
        stroke.createdAt,
      );
      return {
        changed: true,
        reused: false,
        stroke,
        projectionRevision:
          this.incrementRevision(),
      };
    });
  }

  thoughtBrushStrokeById(
    brushStrokeId,
  ) {
    const row = this.db.prepare(`
      select stroke_json
      from wm_thought_brush_strokes
      where brush_stroke_id = ?
      limit 1
    `).get(
      normalizeString(
        brushStrokeId,
        "",
      ),
    );
    if (!row) return null;
    const stroke = parseJson(
      row.stroke_json,
      null,
    );
    validateThoughtBrushStroke(
      stroke,
    );
    return stroke;
  }

  listThoughtBrushStrokes(
    input = {},
  ) {
    const clauses = [];
    const params = [];
    const projectId =
      normalizeString(
        input.projectId,
        "",
      );
    if (projectId) {
      clauses.push(
        "(project_id = ? or target_project_id = ?)",
      );
      params.push(
        projectId,
        projectId,
      );
    }
    params.push(
      Math.max(
        1,
        Math.min(
          400,
          Number(input.limit || 200),
        ),
      ),
    );
    const rows = this.db.prepare(`
      select stroke_json
      from wm_thought_brush_strokes
      ${clauses.length
        ? `where ${clauses.join(" and ")}`
        : ""}
      order by rowid desc
      limit ?
    `).all(...params);
    return rows.map((row) => {
      const stroke = parseJson(
        row.stroke_json,
        null,
      );
      validateThoughtBrushStroke(
        stroke,
      );
      return stroke;
    });
  }

  currentContextCanvas(
    input = {},
  ) {
    const ownerId =
      normalizeString(
        input.ownerId,
        "",
      );
    const contextCanvasId =
      normalizeString(
        input.contextCanvasId,
        "",
      );
    const projectId =
      normalizeString(
        input.projectId,
        "",
      );
    const clauses = [
      "current_state = 'current'",
    ];
    const params = [];
    if (contextCanvasId) {
      clauses.push(
        "context_canvas_id = ?",
      );
      params.push(contextCanvasId);
    }
    if (ownerId) {
      clauses.push("owner_id = ?");
      params.push(ownerId);
    }
    if (projectId) {
      clauses.push(
        "(project_id = ? or active_project_id = ?)",
      );
      params.push(
        projectId,
        projectId,
      );
    }
    const row = this.db.prepare(`
      select canvas_json
      from wm_context_canvas_revisions
      where ${clauses.join(" and ")}
      order by rowid desc
      limit 1
    `).get(...params);
    if (!row) return null;
    const canvas = parseJson(
      row.canvas_json,
      null,
    );
    validateContextCanvas(canvas);
    return canvas;
  }

  contextCanvasRevision(
    input = {},
  ) {
    const contextCanvasId =
      normalizeString(
        input.contextCanvasId,
        "",
      );
    const digest =
      normalizeString(
        input.digest,
        "",
      );
    const revision = Number(
      input.revision || 0,
    );
    const clauses = [];
    const params = [];
    if (contextCanvasId) {
      clauses.push(
        "context_canvas_id = ?",
      );
      params.push(contextCanvasId);
    }
    if (digest) {
      clauses.push(
        "canvas_digest = ?",
      );
      params.push(digest);
    }
    if (
      Number.isInteger(revision) &&
      revision > 0
    ) {
      clauses.push(
        "canvas_revision = ?",
      );
      params.push(revision);
    }
    if (!clauses.length) return null;
    const row = this.db.prepare(`
      select canvas_json
      from wm_context_canvas_revisions
      where ${clauses.join(" and ")}
      order by canvas_revision desc
      limit 1
    `).get(...params);
    if (!row) return null;
    const canvas = parseJson(
      row.canvas_json,
      null,
    );
    validateContextCanvas(canvas);
    return canvas;
  }

  listContextCanvases(
    input = {},
  ) {
    const clauses = [];
    const params = [];
    if (input.currentOnly !== false) {
      clauses.push(
        "current_state = 'current'",
      );
    }
    const projectId =
      normalizeString(
        input.projectId,
        "",
      );
    if (projectId) {
      clauses.push(
        "(project_id = ? or active_project_id = ?)",
      );
      params.push(
        projectId,
        projectId,
      );
    }
    const contextCanvasId =
      normalizeString(
        input.contextCanvasId,
        "",
      );
    if (contextCanvasId) {
      clauses.push(
        "context_canvas_id = ?",
      );
      params.push(contextCanvasId);
    }
    params.push(
      Math.max(
        1,
        Math.min(
          400,
          Number(input.limit || 200),
        ),
      ),
    );
    const rows = this.db.prepare(`
      select canvas_json
      from wm_context_canvas_revisions
      ${clauses.length
        ? `where ${clauses.join(" and ")}`
        : ""}
      order by rowid desc
      limit ?
    `).all(...params);
    return rows.map((row) => {
      const canvas = parseJson(
        row.canvas_json,
        null,
      );
      validateContextCanvas(canvas);
      return canvas;
    });
  }

  registerContextCanvas(
    input = {},
  ) {
    const canvas =
      input.canvas || input;
    validateContextCanvas(canvas);
    return this.transaction(() => {
      const existingByDigest =
        this.db.prepare(`
          select canvas_json
          from wm_context_canvas_revisions
          where canvas_digest = ?
          limit 1
        `).get(canvas.digest);
      if (existingByDigest) {
        const existing = parseJson(
          existingByDigest
            .canvas_json,
          null,
        );
        validateContextCanvas(
          existing,
        );
        return {
          changed: false,
          reused: true,
          canvas: existing,
          projectionRevision:
            this.revision(),
        };
      }
      const current =
        this.currentContextCanvas({
          contextCanvasId:
            canvas.contextCanvasId,
        });
      if (current) {
        if (
          canvas.revision !==
            current.revision + 1 ||
          !exactRefMatches(
            canvas.predecessorRef,
            contextCanvasRef(
              current,
            ),
          )
        ) {
          fail(
            "world_manager_context_canvas_revision_conflict",
            canvas.contextCanvasId,
          );
        }
        this.db.prepare(`
          update wm_context_canvas_revisions
          set current_state = 'superseded'
          where context_canvas_id = ?
            and current_state = 'current'
        `).run(
          canvas.contextCanvasId,
        );
      } else if (
        canvas.revision !== 1 ||
        canvas.predecessorRef
      ) {
        fail(
          "world_manager_context_canvas_initial_revision_invalid",
        );
      }
      this.db.prepare(`
        insert into wm_context_canvas_revisions (
          canvas_record_id,
          context_canvas_id,
          owner_id,
          project_id,
          active_project_id,
          canvas_revision,
          operation_kind,
          current_state,
          canvas_json,
          canvas_digest,
          created_at
        ) values (?, ?, ?, ?, ?, ?, ?, 'current', ?, ?, ?)
      `).run(
        stableId(
          "wm_context_canvas_record",
          {
            contextCanvasId:
              canvas.contextCanvasId,
            revision:
              canvas.revision,
            digest: canvas.digest,
          },
        ),
        canvas.contextCanvasId,
        canvas.ownerId,
        canvas.projectId,
        canvas.activeProjectId,
        canvas.revision,
        canvas.operationKind,
        json(canvas),
        canvas.digest,
        canvas.createdAt,
      );
      return {
        changed: true,
        reused: false,
        canvas,
        projectionRevision:
          this.incrementRevision(),
      };
    });
  }

  ensureBaseContextCanvas(
    input = {},
  ) {
    const ownerId =
      normalizeString(
        input.ownerId,
        "operator",
      );
    const projectId =
      normalizeString(
        input.projectId,
        "",
      );
    const existing =
      this.currentContextCanvas({
        ownerId,
        projectId,
      });
    if (existing) {
      return {
        changed: false,
        reused: true,
        canvas: existing,
        projectionRevision:
          this.revision(),
      };
    }
    return this.registerContextCanvas({
      canvas:
        buildBaseContextCanvas({
          ...input,
          ownerId,
          projectId,
          now: this.now,
        }),
    });
  }

  _currentAroCandidateWithinTransaction(
    candidateId,
  ) {
    const row = this.db.prepare(`
      select candidate_json
      from wm_aro_reconstruction_candidates
      where candidate_id = ?
        and current_state = 'current'
      order by candidate_revision desc
      limit 1
    `).get(
      normalizeString(candidateId, ""),
    );
    if (!row) return null;
    const candidate = parseJson(
      row.candidate_json,
      null,
    );
    validateAroReconstructionCandidate(
      candidate,
    );
    return candidate;
  }

  _appendAroCandidateRevisionWithinTransaction(
    candidate,
  ) {
    validateAroReconstructionCandidate(
      candidate,
    );
    const current =
      this._currentAroCandidateWithinTransaction(
        candidate.candidateId,
      );
    if (current?.digest === candidate.digest) {
      return {
        changed: false,
        candidate: current,
      };
    }
    if (current) {
      if (
        candidate.candidateRevision !==
          current.candidateRevision + 1 ||
        candidate.predecessorRef?.kind !==
          "aro_reconstruction_candidate" ||
        candidate.predecessorRef?.id !==
          current.candidateId ||
        candidate.predecessorRef?.digest !==
          current.digest
      ) {
        fail(
          "world_manager_aro_candidate_revision_conflict",
          candidate.candidateId,
        );
      }
      this.db.prepare(`
        update wm_aro_reconstruction_candidates
        set current_state = 'superseded'
        where candidate_id = ?
          and current_state = 'current'
      `).run(candidate.candidateId);
    } else if (
      candidate.candidateRevision !== 1 ||
      candidate.predecessorRef
    ) {
      fail(
        "world_manager_aro_candidate_initial_revision_invalid",
      );
    }
    this.db.prepare(`
      insert into wm_aro_reconstruction_candidates (
        candidate_record_id,
        candidate_id,
        project_id,
        aro_id,
        aro_posture,
        candidate_revision,
        lifecycle,
        current_state,
        candidate_json,
        candidate_digest,
        created_at
      ) values (?, ?, ?, ?, ?, ?, ?, 'current', ?, ?, ?)
    `).run(
      stableId(
        "wm_aro_candidate_record",
        {
          candidateId:
            candidate.candidateId,
          candidateRevision:
            candidate.candidateRevision,
          digest: candidate.digest,
        },
      ),
      candidate.candidateId,
      candidate.projectId,
      candidate.candidateAro.aroId,
      candidate.candidateAro.posture,
      candidate.candidateRevision,
      candidate.lifecycle,
      json(candidate),
      candidate.digest,
      candidate.reviewedAt ||
        candidate.createdAt,
    );
    return {
      changed: true,
      candidate,
    };
  }

  _currentAroWithinTransaction(aroId) {
    const row = this.db.prepare(`
      select aro_json
      from wm_aro_registry
      where aro_id = ?
        and current_state = 'current'
      order by aro_revision desc
      limit 1
    `).get(normalizeString(aroId, ""));
    if (!row) return null;
    const aro = parseJson(
      row.aro_json,
      null,
    );
    validateAbstractReasoningObject(aro);
    return aro;
  }

  _appendAroRevisionWithinTransaction(
    aro,
  ) {
    validateAbstractReasoningObject(aro);
    if (aro.canonical !== true) {
      fail(
        "world_manager_aro_registry_requires_canonical",
      );
    }
    const current =
      this._currentAroWithinTransaction(
        aro.aroId,
      );
    if (current?.digest === aro.digest) {
      return {
        changed: false,
        aro: current,
      };
    }
    if (current) {
      if (
        aro.revision !==
          current.revision + 1 ||
        aro.predecessorRef?.kind !==
          "abstract_reasoning_object" ||
        aro.predecessorRef?.id !==
          current.aroId ||
        aro.predecessorRef?.digest !==
          current.digest
      ) {
        fail(
          "world_manager_aro_revision_conflict",
          aro.aroId,
        );
      }
      this.db.prepare(`
        update wm_aro_registry
        set current_state = 'superseded'
        where aro_id = ?
          and current_state = 'current'
      `).run(aro.aroId);
    } else if (
      aro.revision !== 1 ||
      aro.predecessorRef
    ) {
      fail(
        "world_manager_aro_initial_revision_invalid",
      );
    }
    this.db.prepare(`
      insert into wm_aro_registry (
        aro_record_id,
        aro_id,
        project_id,
        concept_key,
        aro_posture,
        aro_revision,
        lifecycle,
        current_state,
        aro_json,
        aro_digest,
        created_at
      ) values (?, ?, ?, ?, ?, ?, ?, 'current', ?, ?, ?)
    `).run(
      stableId("wm_aro_record", {
        aroId: aro.aroId,
        revision: aro.revision,
        digest: aro.digest,
      }),
      aro.aroId,
      aro.projectId,
      aro.conceptKey,
      aro.posture,
      aro.revision,
      aro.lifecycle,
      json(aro),
      aro.digest,
      aro.createdAt,
    );
    return {
      changed: true,
      aro,
    };
  }

  registerAroReconstructionCandidate(
    input = {},
  ) {
    const candidate =
      input.candidate || input;
    validateAroReconstructionCandidate(
      candidate,
    );
    if (
      candidate.lifecycle !==
        "candidate" ||
      candidate.candidateRevision !== 1
    ) {
      fail(
        "world_manager_aro_candidate_registration_boundary",
      );
    }
    return this.transaction(() => {
      const existing =
        this._currentAroCandidateWithinTransaction(
          candidate.candidateId,
        );
      if (existing) {
        if (
          existing.digest !==
            candidate.digest
        ) {
          fail(
            "world_manager_aro_candidate_idempotency_conflict",
            candidate.candidateId,
          );
        }
        return {
          reused: true,
          candidate: existing,
          transitionEvent: null,
          projectionRevision:
            this.revision(),
        };
      }
      this._appendAroCandidateRevisionWithinTransaction(
        candidate,
      );
      const sourceEvent =
        candidate.sourceSemanticEventRef
          ? this.eventBySemanticEventId(
              candidate
                .sourceSemanticEventRef.id,
            )
          : null;
      if (
        candidate.sourceSemanticEventRef &&
        (
          !sourceEvent ||
          sourceEvent.eventDigest !==
            candidate
              .sourceSemanticEventRef
              .digest
        )
      ) {
        fail(
          "world_manager_aro_candidate_source_event_invalid",
        );
      }
      const transitionEvent = sourceEvent
        ? this.appendDerivedEventWithinTransaction({
            semanticEventId: stableId(
              "wm_event",
              {
                candidateId:
                  candidate.candidateId,
                transition:
                  "aro_reconstruction_candidate_registered",
              },
            ),
            lineageRootId:
              sourceEvent.lineageRootId,
            clientRequestId:
              `${sourceEvent.clientRequestId}:sc7:aro-candidate:${candidate.candidateId}`,
            clientRequestDigest:
              digestFor(
                "direct-world-manager-sc7-aro-candidate-registration@1",
                {
                  sourceEventDigest:
                    sourceEvent.eventDigest,
                  candidateDigest:
                    candidate.digest,
                },
              ),
            eventKind:
              "aro_reconstruction_candidate_registered",
            presentationState:
              "candidate",
            epistemicState: "candidate",
            actorRole:
              "world_manager_reconstructor",
            projectId:
              candidate.projectId,
            taskType:
              "aro_reconstruction",
            parentSemanticEventIds: [
              sourceEvent.semanticEventId,
            ],
            artifactRefs: [
              {
                ...aroReconstructionCandidateRef(
                  candidate,
                ),
                label:
                  "Non-canonical ARO reconstruction candidate",
              },
              candidate
                .repositorySnapshotRef,
            ],
            sourceScopeRevisions:
              candidate.evidenceRefs.map(
                (ref) => ({
                  scopeKind: ref.kind,
                  scopeId: ref.id,
                  revision: 0,
                  digest: ref.digest,
                }),
              ),
            rendererSafeSummary:
              "An ARO reconstruction candidate was registered from exact repository evidence. It remains non-canonical pending evidence and contradiction review.",
            occurredAt:
              candidate.createdAt,
          })
        : null;
      return {
        reused: false,
        candidate,
        transitionEvent,
        projectionRevision:
          this.incrementRevision(),
      };
    });
  }

  reviewAroReconstructionCandidate(
    input = {},
  ) {
    const candidateId =
      normalizeString(
        input.candidateId,
        "",
      );
    return this.transaction(() => {
      const candidate =
        this._currentAroCandidateWithinTransaction(
          candidateId,
        );
      if (!candidate) {
        fail(
          "world_manager_aro_candidate_missing",
          candidateId,
        );
      }
      if (
        candidate.evidenceReviewState ===
          "reviewed" &&
        candidate
          .contradictionReviewState ===
          "reviewed"
      ) {
        const receiptRow =
          this.db.prepare(`
            select receipt_json
            from wm_aro_review_receipts
            where candidate_id = ?
            order by rowid desc
            limit 1
          `).get(candidateId);
        const receipt = receiptRow
          ? parseJson(
              receiptRow.receipt_json,
              null,
            )
          : null;
        if (!receipt) {
          fail(
            "world_manager_aro_review_receipt_missing",
            candidateId,
          );
        }
        validateAroReviewReceipt(
          receipt,
        );
        const inputDigest =
          normalizeString(
            input.candidateDigest,
            "",
          );
        const inputRevision = Number(
          input.expectedCandidateRevision,
        );
        const matchesPredecessor =
          inputDigest ===
            receipt
              .predecessorCandidateRef
              .digest &&
          inputRevision ===
            candidate.candidateRevision -
              1;
        const matchesCurrent =
          inputDigest ===
            candidate.digest &&
          inputRevision ===
            candidate.candidateRevision;
        if (
          !matchesPredecessor &&
          !matchesCurrent
        ) {
          fail(
            "world_manager_aro_candidate_revision_conflict",
            candidateId,
          );
        }
        return {
          reused: true,
          candidate,
          receipt,
          transitionEvent: null,
          projectionRevision:
            this.revision(),
        };
      }
      if (
        normalizeString(
          input.candidateDigest,
          "",
        ) !== candidate.digest ||
        Number(
          input.expectedCandidateRevision,
        ) !== candidate.candidateRevision
      ) {
        fail(
          "world_manager_aro_candidate_revision_conflict",
          candidateId,
        );
      }
      const reviewed =
        reviewAroReconstructionCandidate(
          candidate,
          {
            actorId:
              input.actorId ||
              "operator",
            reviewedAt:
              input.reviewedAt ||
              nowIso(this.now),
            now: this.now,
          },
        );
      this._appendAroCandidateRevisionWithinTransaction(
        reviewed.candidate,
      );
      this.db.prepare(`
        insert into wm_aro_review_receipts (
          review_receipt_id,
          candidate_id,
          receipt_json,
          receipt_digest,
          created_at
        ) values (?, ?, ?, ?, ?)
      `).run(
        reviewed.receipt.reviewReceiptId,
        reviewed.candidate.candidateId,
        json(reviewed.receipt),
        reviewed.receipt.digest,
        reviewed.receipt.reviewedAt,
      );
      const sourceEvent =
        reviewed.candidate
          .sourceSemanticEventRef
          ? this.eventBySemanticEventId(
              reviewed.candidate
                .sourceSemanticEventRef.id,
            )
          : null;
      const transitionEvent = sourceEvent
        ? this.appendDerivedEventWithinTransaction({
            semanticEventId: stableId(
              "wm_event",
              {
                candidateId,
                transition:
                  "aro_reconstruction_evidence_reviewed",
              },
            ),
            lineageRootId:
              sourceEvent.lineageRootId,
            clientRequestId:
              `${sourceEvent.clientRequestId}:sc7:aro-reviewed:${candidateId}`,
            clientRequestDigest:
              digestFor(
                "direct-world-manager-sc7-aro-review@1",
                {
                  candidateDigest:
                    reviewed.candidate
                      .digest,
                  receiptDigest:
                    reviewed.receipt
                      .digest,
                },
              ),
            eventKind:
              "aro_reconstruction_evidence_reviewed",
            presentationState:
              "evidence_reviewed",
            epistemicState: "observed",
            actorRole: "operator",
            projectId:
              reviewed.candidate
                .projectId,
            taskType:
              "aro_reconstruction",
            parentSemanticEventIds: [
              stableId("wm_event", {
                candidateId,
                transition:
                  "aro_reconstruction_candidate_registered",
              }),
            ],
            artifactRefs: [
              aroReconstructionCandidateRef(
                reviewed.candidate,
              ),
              {
                kind:
                  "aro_reconstruction_review_receipt",
                id:
                  reviewed.receipt
                    .reviewReceiptId,
                digest:
                  reviewed.receipt
                    .digest,
              },
            ],
            sourceScopeRevisions:
              reviewed.candidate
                .evidenceRefs.map(
                  (ref) => ({
                    scopeKind: ref.kind,
                    scopeId: ref.id,
                    revision: 0,
                    digest: ref.digest,
                  }),
                ),
            rendererSafeSummary:
              "The operator inspected ARO reconstruction evidence and contradictions. The reconstruction remains non-canonical.",
            occurredAt:
              reviewed.receipt
                .reviewedAt,
          })
        : null;
      return {
        reused: false,
        ...reviewed,
        transitionEvent,
        projectionRevision:
          this.incrementRevision(),
      };
    });
  }

  admitAroReconstructionCandidate(
    input = {},
  ) {
    const candidateId =
      normalizeString(
        input.candidateId,
        "",
      );
    return this.transaction(() => {
      const existingReceiptRow =
        this.db.prepare(`
          select receipt_json
          from wm_aro_admission_receipts
          where candidate_id = ?
        `).get(candidateId);
      if (existingReceiptRow) {
        const receipt = parseJson(
          existingReceiptRow.receipt_json,
          null,
        );
        validateAroAdmissionReceipt(
          receipt,
        );
        const candidate =
          this._currentAroCandidateWithinTransaction(
            candidateId,
          );
        if (!candidate) {
          fail(
            "world_manager_aro_candidate_missing",
            candidateId,
          );
        }
        const inputDigest =
          normalizeString(
            input.candidateDigest,
            "",
          );
        const inputRevision = Number(
          input.expectedCandidateRevision,
        );
        const matchesReviewed =
          inputDigest ===
            receipt.candidateRef.digest &&
          inputRevision ===
            candidate.candidateRevision -
              1;
        const matchesAdmitted =
          inputDigest ===
            candidate.digest &&
          inputRevision ===
            candidate.candidateRevision;
        if (
          !matchesReviewed &&
          !matchesAdmitted
        ) {
          fail(
            "world_manager_aro_candidate_revision_conflict",
            candidateId,
          );
        }
        return {
          reused: true,
          candidate,
          aro:
            this._currentAroWithinTransaction(
              receipt.aroRef.id,
            ),
          receipt,
          transitionEvent: null,
          projectionRevision:
            this.revision(),
        };
      }
      const candidate =
        this._currentAroCandidateWithinTransaction(
          candidateId,
        );
      if (!candidate) {
        fail(
          "world_manager_aro_candidate_missing",
          candidateId,
        );
      }
      if (
        normalizeString(
          input.candidateDigest,
          "",
        ) !== candidate.digest ||
        Number(
          input.expectedCandidateRevision,
        ) !== candidate.candidateRevision
      ) {
        fail(
          "world_manager_aro_candidate_revision_conflict",
          candidateId,
        );
      }
      const existingAro =
        this._currentAroWithinTransaction(
          candidate.candidateAro.aroId,
        );
      const admitted =
        admitAroReconstructionCandidate(
          candidate,
          {
            currentAro: existingAro,
            actorId:
              input.actorId ||
              "operator",
            admittedAt:
              input.admittedAt ||
              nowIso(this.now),
            now: this.now,
          },
        );
      this._appendAroRevisionWithinTransaction(
        admitted.aro,
      );
      this._appendAroCandidateRevisionWithinTransaction(
        admitted.candidate,
      );
      this.db.prepare(`
        insert into wm_aro_admission_receipts (
          admission_receipt_id,
          candidate_id,
          aro_id,
          receipt_json,
          receipt_digest,
          created_at
        ) values (?, ?, ?, ?, ?, ?)
      `).run(
        admitted.receipt
          .admissionReceiptId,
        candidateId,
        admitted.aro.aroId,
        json(admitted.receipt),
        admitted.receipt.digest,
        admitted.receipt.admittedAt,
      );
      const sourceEvent =
        admitted.candidate
          .sourceSemanticEventRef
          ? this.eventBySemanticEventId(
              admitted.candidate
                .sourceSemanticEventRef.id,
            )
          : null;
      const transitionEvent = sourceEvent
        ? this.appendDerivedEventWithinTransaction({
            semanticEventId: stableId(
              "wm_event",
              {
                candidateId,
                transition:
                  "abstract_reasoning_object_admitted",
              },
            ),
            lineageRootId:
              sourceEvent.lineageRootId,
            clientRequestId:
              `${sourceEvent.clientRequestId}:sc7:aro-admitted:${candidateId}`,
            clientRequestDigest:
              digestFor(
                "direct-world-manager-sc7-aro-admission@1",
                {
                  candidateDigest:
                    admitted.candidate
                      .digest,
                  aroDigest:
                    admitted.aro.digest,
                  receiptDigest:
                    admitted.receipt
                      .digest,
                },
              ),
            eventKind:
              "abstract_reasoning_object_admitted",
            presentationState:
              "canonical",
            epistemicState: "accepted",
            authorityState:
              "authoritative",
            actorRole: "operator",
            projectId:
              admitted.aro.projectId,
            taskType:
              "aro_reconstruction",
            parentSemanticEventIds: [
              stableId("wm_event", {
                candidateId,
                transition:
                  "aro_reconstruction_evidence_reviewed",
              }),
            ],
            artifactRefs: [
              abstractReasoningObjectRef(
                admitted.aro,
              ),
              {
                kind:
                  "aro_admission_receipt",
                id:
                  admitted.receipt
                    .admissionReceiptId,
                digest:
                  admitted.receipt
                    .digest,
              },
            ],
            sourceScopeRevisions:
              admitted.aro
                .provenanceRefs.map(
                  (ref) => ({
                    scopeKind: ref.kind,
                    scopeId: ref.id,
                    revision: 0,
                    digest: ref.digest,
                  }),
                ),
            rendererSafeSummary:
              "The operator admitted the reconstructed Abstract Reasoning Object into the semantic registry. No code or downstream project effect was executed.",
            occurredAt:
              admitted.receipt
                .admittedAt,
          })
        : null;
      return {
        reused: false,
        ...admitted,
        transitionEvent,
        projectionRevision:
          this.incrementRevision(),
      };
    });
  }

  markAroRealizationsStale(input = {}) {
    const aroId = normalizeString(
      input.aroId,
      "",
    );
    return this.transaction(() => {
      const current =
        this._currentAroWithinTransaction(
          aroId,
        );
      if (!current) {
        fail(
          "world_manager_aro_missing",
          aroId,
        );
      }
      if (
        normalizeString(
          input.aroDigest,
          current.digest,
        ) !== current.digest ||
        Number(
          input.expectedAroRevision ??
            current.revision,
        ) !== current.revision
      ) {
        fail(
          "world_manager_aro_revision_conflict",
          aroId,
        );
      }
      const revised =
        reviseAroRealizationFreshness(
          current,
          {
            changedSourceRefs:
              input.changedSourceRefs,
            changedAt:
              input.changedAt ||
              nowIso(this.now),
            now: this.now,
          },
        );
      if (!revised.changed) {
        return {
          reused: true,
          aro: current,
          projectionRevision:
            this.revision(),
        };
      }
      this._appendAroRevisionWithinTransaction(
        revised.aro,
      );
      return {
        reused: false,
        aro: revised.aro,
        projectionRevision:
          this.incrementRevision(),
      };
    });
  }

  listAroReconstructionCandidates(
    options = {},
  ) {
    const where = [];
    const values = [];
    if (options.currentOnly !== false) {
      where.push(
        "current_state = 'current'",
      );
    }
    if (
      normalizeString(
        options.projectId,
        "",
      )
    ) {
      where.push("project_id = ?");
      values.push(options.projectId);
    }
    if (
      normalizeString(
        options.lifecycle,
        "",
      )
    ) {
      where.push("lifecycle = ?");
      values.push(options.lifecycle);
    }
    return this.db.prepare(`
      select candidate_json, current_state
      from wm_aro_reconstruction_candidates
      ${where.length
        ? `where ${where.join(" and ")}`
        : ""}
      order by rowid asc
    `).all(...values).map((row) => {
      const candidate = parseJson(
        row.candidate_json,
        null,
      );
      validateAroReconstructionCandidate(
        candidate,
      );
      return candidate;
    });
  }

  aroReconstructionCandidateById(
    candidateId,
  ) {
    return this
      .listAroReconstructionCandidates({
        currentOnly: true,
      })
      .find((candidate) =>
        candidate.candidateId ===
          normalizeString(
            candidateId,
            "",
          )) || null;
  }

  listAbstractReasoningObjects(
    options = {},
  ) {
    const where = [];
    const values = [];
    if (options.currentOnly !== false) {
      where.push(
        "current_state = 'current'",
      );
    }
    if (
      normalizeString(
        options.projectId,
        "",
      )
    ) {
      where.push("project_id = ?");
      values.push(options.projectId);
    }
    if (
      normalizeString(
        options.posture,
        "",
      )
    ) {
      where.push("aro_posture = ?");
      values.push(options.posture);
    }
    return this.db.prepare(`
      select aro_json, current_state
      from wm_aro_registry
      ${where.length
        ? `where ${where.join(" and ")}`
        : ""}
      order by rowid asc
    `).all(...values).map((row) => {
      const aro = parseJson(
        row.aro_json,
        null,
      );
      validateAbstractReasoningObject(
        aro,
      );
      return aro;
    });
  }

  abstractReasoningObjectById(aroId) {
    return this
      .listAbstractReasoningObjects({
        currentOnly: true,
      })
      .find((aro) =>
        aro.aroId ===
          normalizeString(aroId, "")) ||
      null;
  }

  listAroReviewReceipts() {
    return this.db.prepare(`
      select receipt_json
      from wm_aro_review_receipts
      order by rowid asc
    `).all().map((row) => {
      const receipt = parseJson(
        row.receipt_json,
        null,
      );
      if (
        receipt?.schema !==
          ARO_REVIEW_RECEIPT_SCHEMA
      ) {
        fail(
          "world_manager_aro_review_receipt_schema_invalid",
        );
      }
      validateAroReviewReceipt(receipt);
      return receipt;
    });
  }

  listAroAdmissionReceipts() {
    return this.db.prepare(`
      select receipt_json
      from wm_aro_admission_receipts
      order by rowid asc
    `).all().map((row) => {
      const receipt = parseJson(
        row.receipt_json,
        null,
      );
      if (
        receipt?.schema !==
          ARO_ADMISSION_RECEIPT_SCHEMA
      ) {
        fail(
          "world_manager_aro_admission_receipt_schema_invalid",
        );
      }
      validateAroAdmissionReceipt(
        receipt,
      );
      return receipt;
    });
  }

  listProjectConstitutions() {
    return this.db.prepare(`
      select constitution_json
      from wm_project_constitutions
      order by admitted_at asc, project_id asc
    `).all().map((row) =>
      parseJson(row.constitution_json, null)).filter(Boolean);
  }

  projectRuntimeDefault(projectId) {
    const row = this.db.prepare(`
      select binding_json
      from wm_project_runtime_defaults
      where project_id = ?
    `).get(normalizeString(projectId, ""));
    return row ? parseJson(row.binding_json, null) : null;
  }

  listProjectRuntimeDefaults() {
    return this.db.prepare(`
      select binding_json
      from wm_project_runtime_defaults
      order by created_at asc, project_id asc
    `).all().map((row) =>
      parseJson(row.binding_json, null)).filter(Boolean);
  }

  projectWorkspaceBinding(projectId) {
    const row = this.db.prepare(`
      select binding_json
      from wm_project_workspace_bindings
      where project_id = ?
    `).get(normalizeString(projectId, ""));
    if (!row) return null;
    const binding = parseJson(row.binding_json, null);
    validateProjectWorkspaceBinding(binding);
    return binding;
  }

  listProjectWorkspaceBindings() {
    return this.db.prepare(`
      select binding_json
      from wm_project_workspace_bindings
      order by created_at asc, project_id asc
    `).all().map((row) => {
      const binding = parseJson(row.binding_json, null);
      validateProjectWorkspaceBinding(binding);
      return binding;
    });
  }

  projectWorkspaceLocator(projectId) {
    const row = this.db.prepare(`
      select locator_json
      from wm_project_workspace_locators
      where project_id = ?
    `).get(normalizeString(projectId, ""));
    if (!row) return null;
    const locator = parseJson(row.locator_json, null);
    validateProjectWorkspaceLocator(locator);
    return locator;
  }

  environmentProbeByRef(ref = {}) {
    const row = this.db.prepare(`
      select receipt_json
      from wm_environment_probe_receipts
      where probe_receipt_id = ?
    `).get(normalizeString(ref.id, ""));
    if (!row) return null;
    const receipt = parseJson(row.receipt_json, null);
    validateEnvironmentProbeReceipt(receipt);
    return receipt.digest === normalizeString(ref.digest, "")
      ? receipt
      : null;
  }

  listEnvironmentProbeReceipts(options = {}) {
    const projectId = normalizeString(options.projectId, "");
    const rows = projectId
      ? this.db.prepare(`
          select receipt_json
          from wm_environment_probe_receipts
          where project_id = ?
          order by observed_at asc, probe_receipt_id asc
        `).all(projectId)
      : this.db.prepare(`
          select receipt_json
          from wm_environment_probe_receipts
          order by observed_at asc, probe_receipt_id asc
        `).all();
    return rows.map((row) => {
      const receipt = parseJson(row.receipt_json, null);
      validateEnvironmentProbeReceipt(receipt);
      return receipt;
    });
  }

  threadEnvironmentBinding(threadId) {
    const row = this.db.prepare(`
      select binding_json
      from wm_thread_environment_bindings
      where thread_id = ?
    `).get(normalizeString(threadId, ""));
    if (!row) return null;
    const binding = parseJson(row.binding_json, null);
    validateThreadEnvironmentBinding(binding);
    return binding;
  }

  listThreadEnvironmentBindings(options = {}) {
    const projectId = normalizeString(options.projectId, "");
    const rows = projectId
      ? this.db.prepare(`
          select binding_json
          from wm_thread_environment_bindings
          where project_id = ?
          order by created_at asc, thread_id asc
        `).all(projectId)
      : this.db.prepare(`
          select binding_json
          from wm_thread_environment_bindings
          order by created_at asc, thread_id asc
        `).all();
    return rows.map((row) => {
      const binding = parseJson(row.binding_json, null);
      validateThreadEnvironmentBinding(binding);
      return binding;
    });
  }

  stepEnvironmentSnapshotByRef(ref = {}) {
    const row = this.db.prepare(`
      select snapshot_json
      from wm_step_environment_snapshots
      where step_environment_snapshot_id = ?
    `).get(normalizeString(ref.id, ""));
    if (!row) return null;
    const snapshot = parseJson(row.snapshot_json, null);
    validateStepEnvironmentSnapshot(snapshot);
    return snapshot.digest === normalizeString(ref.digest, "")
      ? snapshot
      : null;
  }

  stepEnvironmentSnapshot(threadId, stepId) {
    const row = this.db.prepare(`
      select snapshot_json
      from wm_step_environment_snapshots
      where thread_id = ? and step_id = ?
    `).get(
      normalizeString(threadId, ""),
      normalizeString(stepId, ""),
    );
    if (!row) return null;
    const snapshot = parseJson(row.snapshot_json, null);
    validateStepEnvironmentSnapshot(snapshot);
    return snapshot;
  }

  listStepEnvironmentSnapshots(options = {}) {
    const threadId = normalizeString(options.threadId, "");
    const rows = threadId
      ? this.db.prepare(`
          select snapshot_json
          from wm_step_environment_snapshots
          where thread_id = ?
          order by observed_at asc, step_id asc
        `).all(threadId)
      : this.db.prepare(`
          select snapshot_json
          from wm_step_environment_snapshots
          order by observed_at asc, thread_id asc, step_id asc
        `).all();
    return rows.map((row) => {
      const snapshot = parseJson(row.snapshot_json, null);
      validateStepEnvironmentSnapshot(snapshot);
      return snapshot;
    });
  }

  listChildEnvironmentInheritances(options = {}) {
    const projectId = normalizeString(options.projectId, "");
    const rows = projectId
      ? this.db.prepare(`
          select inheritance_json
          from wm_child_environment_inheritances
          where project_id = ?
          order by created_at asc, child_thread_id asc
        `).all(projectId)
      : this.db.prepare(`
          select inheritance_json
          from wm_child_environment_inheritances
          order by created_at asc, child_thread_id asc
        `).all();
    return rows.map((row) => {
      const inheritance = parseJson(row.inheritance_json, null);
      validateChildEnvironmentInheritance(inheritance);
      return inheritance;
    });
  }

  listCandidateArtifacts() {
    return this.db.prepare(`
      select artifact_json
      from wm_candidate_artifacts
      order by created_at asc, artifact_id asc
    `).all().map((row) => parseJson(row.artifact_json, null)).filter(Boolean);
  }

  listDecisionRequests(options = {}) {
    const currentOnly = options.currentOnly === true;
    const latestUserIngressId =
      this.db.prepare(`
        select semantic_event_id
        from wm_events
        where event_kind =
          'user_utterance_observed'
        order by sequence desc
        limit 1
      `).get()?.semantic_event_id || "";
    return this.db.prepare(`
      select
        decisions.decision_request_id,
        decisions.semantic_event_id,
        decisions.target_artifact_ref_json,
        decisions.decision_kind,
        decisions.state,
        decisions.authority_requirements_json,
        decisions.decision_ref_json,
        events.event_digest,
        events.occurred_at
      from wm_decisions as decisions
      left join wm_events as events
        on events.semantic_event_id =
          decisions.semantic_event_id
      ${currentOnly
        ? "where decisions.state in ('pending', 'clarification_required')"
        : ""}
      order by decisions.decision_request_id asc
    `).all().map((row) => ({
      decisionRequestId: row.decision_request_id,
      semanticEventId: row.semantic_event_id,
      targetArtifactRef: parseJson(row.target_artifact_ref_json, {}),
      decisionKind: row.decision_kind,
      state: row.state,
      authorityRequirements: parseJson(row.authority_requirements_json, {}),
      decisionRef: parseJson(row.decision_ref_json, {}),
      sourceEventRef: row.event_digest
        ? {
            kind: "world_manager_semantic_event",
            id: row.semantic_event_id,
            digest: row.event_digest,
          }
        : null,
      createdAt: row.occurred_at || "",
      question:
        this.settlementForSemanticEvent(
          row.semantic_event_id,
        )?.taskSettlement?.clarificationPrompt || "",
      isCurrentClarification:
        row.decision_kind !== "clarification" ||
        row.semantic_event_id ===
          latestUserIngressId,
    }));
  }

  listPendingDecisions() {
    return this.listDecisionRequests({
      currentOnly: true,
    });
  }

  listSemanticArtifacts(options = {}) {
    const where = [];
    const values = [];
    if (options.currentOnly !== false) {
      where.push("current_state = 'current'");
    }
    if (normalizeString(options.artifactKind, "")) {
      where.push("artifact_kind = ?");
      values.push(options.artifactKind);
    }
    if (normalizeString(options.projectId, "")) {
      where.push("project_id = ?");
      values.push(options.projectId);
    }
    if (normalizeString(options.lifecycle, "")) {
      where.push("lifecycle = ?");
      values.push(options.lifecycle);
    }
    const limit =
      Number.isInteger(Number(options.limit)) &&
      Number(options.limit) > 0
        ? Math.min(5000, Number(options.limit))
        : 1000;
    values.push(limit);
    return this.db.prepare(`
      select artifact_json, current_state
      from wm_semantic_artifacts
      ${where.length ? `where ${where.join(" and ")}` : ""}
      order by rowid asc
      limit ?
    `).all(...values).map((row) => {
      const artifact = parseJson(row.artifact_json, null);
      if (artifact?.schema === OPEN_DECISION_SCHEMA) {
        validateOpenDecision(artifact);
      } else {
        fail("semantic_artifact_schema_unsupported");
      }
      return {
        ...artifact,
        currentState: String(row.current_state),
      };
    });
  }

  semanticArtifact(semanticArtifactId) {
    return this.listSemanticArtifacts({
      currentOnly: true,
      limit: 5000,
    }).find((artifact) =>
      artifact.header?.semanticArtifactId ===
        normalizeString(semanticArtifactId, "")) || null;
  }

  listSettlements(options = {}) {
    const limit = Number.isInteger(Number(options.limit)) && Number(options.limit) > 0
      ? Math.min(1000, Number(options.limit))
      : 200;
    return this.db.prepare(`
      select settlement_json
      from wm_settlements
      order by rowid desc
      limit ?
    `).all(limit).reverse().map((row) => {
      const settlement = parseJson(row.settlement_json, null);
      validateWorldManagerTaskSettlement(settlement);
      return settlement;
    });
  }

  listSemanticIngressRuns(options = {}) {
    const limit =
      Number.isInteger(Number(options.limit)) &&
      Number(options.limit) > 0
        ? Math.min(1000, Number(options.limit))
        : 200;
    return this.db.prepare(`
      select run_json
      from wm_semantic_ingress_runs
      order by rowid desc
      limit ?
    `).all(limit).reverse().map((row) => {
      const run = parseJson(row.run_json, null);
      validateSemanticIngressRun(run);
      return run;
    });
  }

  listRoutingDecisions(options = {}) {
    const limit = Number.isInteger(Number(options.limit)) && Number(options.limit) > 0
      ? Math.min(1000, Number(options.limit))
      : 200;
    return this.db.prepare(`
      select decision_json
      from wm_routing_decisions
      order by rowid desc
      limit ?
    `).all(limit).reverse().map((row) => {
      const decision = parseJson(row.decision_json, null);
      validateWorldManagerRoutingDecision(decision);
      return decision;
    });
  }

  listManagerContexts(options = {}) {
    const limit = Number.isInteger(Number(options.limit)) && Number(options.limit) > 0
      ? Math.min(1000, Number(options.limit))
      : 200;
    return this.db.prepare(`
      select context_json
      from wm_manager_contexts
      order by rowid desc
      limit ?
    `).all(limit).reverse().map((row) =>
      parseJson(row.context_json, null)).filter(Boolean);
  }

  listAgentWorldCompilations(options = {}) {
    const limit = Number.isInteger(Number(options.limit)) &&
      Number(options.limit) > 0
      ? Math.min(1000, Number(options.limit))
      : 200;
    return this.db.prepare(`
      select semantic_event_id, summary_json, compilation_json
      from wm_agent_world_compilations
      order by rowid desc
      limit ?
    `).all(limit).reverse().map((row) => {
      const summary = parseJson(row.summary_json, null);
      const compilation = parseJson(row.compilation_json, null);
      if (!agentWorldSummaryMatchesCompilation(summary, compilation)) {
        fail(
          "world_manager_agent_world_summary_mismatch",
          row.semantic_event_id,
        );
      }
      return summary;
    }).filter(Boolean);
  }

  listRoleRuns(options = {}) {
    const limit = Number.isInteger(Number(options.limit)) &&
      Number(options.limit) > 0
      ? Math.min(1000, Number(options.limit))
      : 200;
    return this.db.prepare(`
      select run_json from wm_role_runs
      order by rowid desc limit ?
    `).all(limit).reverse().map((row) =>
      parseJson(row.run_json, null)).filter(Boolean);
  }

  listAgentResults(options = {}) {
    const limit = Number.isInteger(Number(options.limit)) &&
      Number(options.limit) > 0
      ? Math.min(1000, Number(options.limit))
      : 200;
    return this.db.prepare(`
      select result_json, final_message_json, response_json,
             typed_payload_json, telemetry_json
      from wm_agent_results
      order by rowid desc limit ?
    `).all(limit).reverse().map((row) => ({
      agentResult: parseJson(row.result_json, null),
      finalAssistantMessage: parseJson(row.final_message_json, null),
      userFacingResponse: parseJson(row.response_json, null),
      typedPayload: parseJson(row.typed_payload_json, null),
      telemetry: parseJson(row.telemetry_json, null),
    })).filter((record) => record.agentResult);
  }

  listInboxEntries(options = {}) {
    const limit = Number.isInteger(Number(options.limit)) &&
      Number(options.limit) > 0
      ? Math.min(1000, Number(options.limit))
      : 200;
    return this.db.prepare(`
      select * from wm_inbox
      order by rowid desc limit ?
    `).all(limit).reverse().map((row) => ({
      inboxEntryId: row.inbox_entry_id,
      semanticEventId: row.semantic_event_id,
      agentResultRef: parseJson(row.agent_result_ref_json, {}),
      deliveryState: row.delivery_state,
      attempts: Number(row.attempts || 0),
      leaseOwner: row.lease_owner,
      leaseExpiresAt: row.lease_expires_at,
      lastError: row.last_error,
    }));
  }

  listReconciliations(options = {}) {
    const limit = Number.isInteger(Number(options.limit)) &&
      Number(options.limit) > 0
      ? Math.min(1000, Number(options.limit))
      : 200;
    return this.db.prepare(`
      select reconciliation_json from wm_reconciliations
      order by rowid desc limit ?
    `).all(limit).reverse().map((row) =>
      parseJson(row.reconciliation_json, null)).filter(Boolean);
  }

  recoverInterruptedRoleRuns() {
    const rows = this.db.prepare(`
      select run_id, run_json from wm_role_runs
      where run_state in ('starting', 'running')
    `).all();
    if (!rows.length) return { recovered: 0 };
    return this.transaction(() => {
      const recoveredAt = nowIso(this.now);
      for (const row of rows) {
        const run = parseJson(row.run_json, {});
        const interrupted = {
          ...run,
          state: "interrupted",
          completedAt: recoveredAt,
          interruptionReason: "runtime_restart",
        };
        interrupted.digest = digestFor(
          "direct_world_manager_role_run@1",
          interrupted,
          ["digest"],
        );
        this.db.prepare(`
          update wm_role_runs
          set run_state = 'interrupted', run_json = ?, updated_at = ?
          where run_id = ?
        `).run(json(interrupted), recoveredAt, row.run_id);
        this.db.prepare(`
          update wm_runtime_bindings
          set state = 'interrupted'
          where direct_session_id = ?
        `).run(interrupted.directSessionId || "");
      }
      const processing = this.db.prepare(`
        select reconciliation_id, reconciliation_json
        from wm_reconciliations
        where reconciliation_state = 'processing'
      `).all();
      for (const row of processing) {
        const reconciliation = parseJson(row.reconciliation_json, {});
        const interrupted = {
          ...reconciliation,
          state: "interrupted",
          completedAt: recoveredAt,
          interruptionReason: "runtime_restart",
        };
        interrupted.digest = digestFor(
          "direct_world_manager_reconciliation@1",
          interrupted,
          ["digest"],
        );
        this.db.prepare(`
          update wm_reconciliations
          set reconciliation_state = 'interrupted',
              reconciliation_json = ?,
              updated_at = ?
          where reconciliation_id = ?
        `).run(
          json(interrupted),
          recoveredAt,
          row.reconciliation_id,
        );
        this.db.prepare(`
          update wm_inbox
          set delivery_state = 'failed',
              lease_owner = '',
              lease_expires_at = '',
              last_error = 'runtime_restart'
          where inbox_entry_id = ?
        `).run(interrupted.inboxEntryId || "");
      }
      return {
        recovered: rows.length,
        projectionRevision: this.incrementRevision(),
      };
    });
  }

  listUnsettledIngresses() {
    return this.db.prepare(`
      select
        e.event_json,
        m.message_json,
        c.contract_json
      from wm_events e
      left join wm_messages m
        on m.semantic_event_id = e.semantic_event_id
      left join wm_semantic_child_contracts c
        on c.child_semantic_event_id =
          e.semantic_event_id
      left join wm_settlements s on s.semantic_event_id = e.semantic_event_id
      where e.event_kind in (
          'user_utterance_observed',
          'semantic_child_materialized'
        )
        and s.semantic_event_id is null
      order by e.sequence asc
    `).all().map((row) => {
      const event = parseJson(row.event_json, null);
      validateWorldManagerSemanticEvent(event);
      const message = event.eventKind ===
        "user_utterance_observed"
        ? parseJson(row.message_json, null)
        : semanticChildIngressMessage(
            parseJson(row.contract_json, null),
            event,
          );
      if (
        event.eventKind ===
        "user_utterance_observed"
      ) {
        validateWorldManagerMessage(message);
      }
      return { event, message };
    });
  }

  verifyLedger() {
    const events = this.db.prepare(`
      select event_json
      from wm_events
      order by sequence asc
    `).all().map((row) => {
      const event = parseJson(row.event_json, null);
      validateWorldManagerSemanticEvent(event);
      return event;
    });
    let previousEventDigest = "";
    const errors = [];
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      if (event.sequence !== index + 1) {
        errors.push(`sequence_mismatch:${event.sequence}`);
      }
      if (event.previousEventDigest !== previousEventDigest) {
        errors.push(`previous_digest_mismatch:${event.sequence}`);
      }
      if (event.eventDigest !== semanticEventDigest(event)) {
        errors.push(`event_digest_mismatch:${event.sequence}`);
      }
      previousEventDigest = event.eventDigest;
    }
    if (previousEventDigest !== this.ledgerHeadDigest()) {
      errors.push("ledger_head_mismatch");
    }
    return {
      schema: "direct_world_manager_ledger_verification@1",
      ok: errors.length === 0,
      eventCount: events.length,
      errors,
      ledgerHeadDigest: previousEventDigest,
      verificationDigest: digestFor("direct_world_manager_ledger_verification@1", {
        eventCount: events.length,
        errors,
        ledgerHeadDigest: previousEventDigest,
      }),
    };
  }

  descriptor() {
    const counts = {
      bootstrapCount: Number(this.db.prepare("select count(*) as count from wm_bootstrap_manifests").get()?.count || 0),
      eventCount: Number(this.db.prepare("select count(*) as count from wm_events").get()?.count || 0),
      messageCount: Number(this.db.prepare("select count(*) as count from wm_messages").get()?.count || 0),
      candidateCount: Number(this.db.prepare("select count(*) as count from wm_candidate_artifacts").get()?.count || 0),
      projectConstitutionCount: Number(this.db.prepare("select count(*) as count from wm_project_constitutions").get()?.count || 0),
      projectRuntimeDefaultCount: Number(this.db.prepare("select count(*) as count from wm_project_runtime_defaults").get()?.count || 0),
      projectWorkspaceBindingCount: Number(this.db.prepare("select count(*) as count from wm_project_workspace_bindings").get()?.count || 0),
      environmentProbeReceiptCount: Number(this.db.prepare("select count(*) as count from wm_environment_probe_receipts").get()?.count || 0),
      threadEnvironmentBindingCount: Number(this.db.prepare("select count(*) as count from wm_thread_environment_bindings").get()?.count || 0),
      stepEnvironmentSnapshotCount: Number(this.db.prepare("select count(*) as count from wm_step_environment_snapshots").get()?.count || 0),
      childEnvironmentInheritanceCount: Number(this.db.prepare("select count(*) as count from wm_child_environment_inheritances").get()?.count || 0),
      realizationSnapshotCount: Number(this.db.prepare("select count(*) as count from wm_realization_snapshots").get()?.count || 0),
      inboxCount: Number(this.db.prepare("select count(*) as count from wm_inbox").get()?.count || 0),
      decisionCount: Number(this.db.prepare("select count(*) as count from wm_decisions").get()?.count || 0),
      runtimeBindingCount: Number(this.db.prepare("select count(*) as count from wm_runtime_bindings").get()?.count || 0),
      graphBindingCount: Number(this.db.prepare("select count(*) as count from wm_worldmodel_bindings").get()?.count || 0),
      settlementCount: Number(this.db.prepare("select count(*) as count from wm_settlements").get()?.count || 0),
      semanticIngressRunCount: Number(this.db.prepare("select count(*) as count from wm_semantic_ingress_runs").get()?.count || 0),
      semanticSettlementRevisionCount: Number(this.db.prepare("select count(*) as count from wm_semantic_settlement_revisions").get()?.count || 0),
      semanticHistoryRelationCount: Number(this.db.prepare("select count(*) as count from wm_semantic_history_relations").get()?.count || 0),
      semanticShelfCount: Number(this.db.prepare("select count(*) as count from wm_semantic_shelves where current_state = 'current'").get()?.count || 0),
      semanticArtifactCount: Number(this.db.prepare("select count(*) as count from wm_semantic_artifacts where current_state = 'current'").get()?.count || 0),
      openDecisionArtifactCount: Number(this.db.prepare("select count(*) as count from wm_semantic_artifacts where current_state = 'current' and artifact_kind = 'open_decision' and lifecycle in ('active', 'conflicted')").get()?.count || 0),
      aroReconstructionCandidateCount: Number(this.db.prepare("select count(*) as count from wm_aro_reconstruction_candidates where current_state = 'current'").get()?.count || 0),
      repositorySemanticSnapshotCount: Number(this.db.prepare("select count(*) as count from wm_repository_semantic_snapshots").get()?.count || 0),
      aroReconstructionRunCount: Number(this.db.prepare("select count(*) as count from wm_aro_reconstruction_runs where current_state = 'current'").get()?.count || 0),
      aroTargetDefinitionRunCount: Number(this.db.prepare("select count(*) as count from wm_aro_target_definition_runs where current_state = 'current'").get()?.count || 0),
      aroMutationContractCount: Number(this.db.prepare("select count(*) as count from wm_aro_mutation_contracts where current_state = 'current'").get()?.count || 0),
      aroMutationCompilationRunCount: Number(this.db.prepare("select count(*) as count from wm_aro_mutation_compilation_runs where current_state = 'current'").get()?.count || 0),
      aroRealizationContextImportCount: Number(this.db.prepare("select count(*) as count from wm_aro_realization_context_imports").get()?.count || 0),
      aroRealizationMappingWitnessCount: Number(this.db.prepare("select count(*) as count from wm_aro_realization_mapping_witnesses").get()?.count || 0),
      aroRealizationMappingRunCount: Number(this.db.prepare("select count(*) as count from wm_aro_realization_mapping_runs where current_state = 'current'").get()?.count || 0),
      aroWorkerSourceFreshnessCount: Number(this.db.prepare("select count(*) as count from wm_aro_worker_source_freshness").get()?.count || 0),
      aroWorkerCapabilityObservationCount: Number(this.db.prepare("select count(*) as count from wm_aro_worker_capability_observations").get()?.count || 0),
      aroWorkerReviewReceiptCount: Number(this.db.prepare("select count(*) as count from wm_aro_worker_review_receipts").get()?.count || 0),
      aroWorkerConstitutionCount: Number(this.db.prepare("select count(*) as count from wm_aro_worker_constitutions").get()?.count || 0),
      aroWorkerAuthorizationCount: Number(this.db.prepare("select count(*) as count from wm_aro_worker_authorizations").get()?.count || 0),
      aroWorkerHandoffRunCount: Number(this.db.prepare("select count(*) as count from wm_aro_worker_handoff_runs where current_state = 'current'").get()?.count || 0),
      aroExecutionEvidenceBundleCount: Number(this.db.prepare("select count(*) as count from wm_aro_execution_evidence_bundles").get()?.count || 0),
      aroExecutionEvidenceRunCount: Number(this.db.prepare("select count(*) as count from wm_aro_execution_evidence_runs where current_state = 'current'").get()?.count || 0),
      aroSemanticVerificationAssessmentCount: Number(this.db.prepare("select count(*) as count from wm_aro_semantic_verification_assessments").get()?.count || 0),
      aroClosureCandidateCount: Number(this.db.prepare("select count(*) as count from wm_aro_closure_candidates").get()?.count || 0),
      aroSemanticVerificationRunCount: Number(this.db.prepare("select count(*) as count from wm_aro_semantic_verification_runs where current_state = 'current'").get()?.count || 0),
      thoughtBrushStrokeCount: Number(this.db.prepare("select count(*) as count from wm_thought_brush_strokes").get()?.count || 0),
      contextCanvasCount: Number(this.db.prepare("select count(*) as count from wm_context_canvas_revisions where current_state = 'current'").get()?.count || 0),
      contextCanvasRevisionCount: Number(this.db.prepare("select count(*) as count from wm_context_canvas_revisions").get()?.count || 0),
      canonicalAroCount: Number(this.db.prepare("select count(*) as count from wm_aro_registry where current_state = 'current'").get()?.count || 0),
      aroReviewReceiptCount: Number(this.db.prepare("select count(*) as count from wm_aro_review_receipts").get()?.count || 0),
      aroAdmissionReceiptCount: Number(this.db.prepare("select count(*) as count from wm_aro_admission_receipts").get()?.count || 0),
      decisionTransitionCount: Number(this.db.prepare("select count(*) as count from wm_decision_transition_requests").get()?.count || 0),
      decisionResolutionRelationCount: Number(this.db.prepare("select count(*) as count from wm_decision_resolution_relations").get()?.count || 0),
      semanticChildContractCount: Number(this.db.prepare("select count(*) as count from wm_semantic_child_contracts").get()?.count || 0),
      semanticSplitCoordinationCount: Number(this.db.prepare("select count(*) as count from wm_semantic_split_coordinations where current_state = 'current'").get()?.count || 0),
      routingDecisionCount: Number(this.db.prepare("select count(*) as count from wm_routing_decisions").get()?.count || 0),
      managerContextCount: Number(this.db.prepare("select count(*) as count from wm_manager_contexts").get()?.count || 0),
      agentWorldCompilationCount: Number(this.db.prepare("select count(*) as count from wm_agent_world_compilations").get()?.count || 0),
      contextRequirementSetCount: Number(this.db.prepare("select count(*) as count from wm_context_requirement_sets").get()?.count || 0),
      semanticContextImportCount: Number(this.db.prepare("select count(*) as count from wm_semantic_context_imports").get()?.count || 0),
      semanticContextBundleCount: Number(this.db.prepare("select count(*) as count from wm_semantic_context_bundles").get()?.count || 0),
      operationalMetaContextCount: Number(this.db.prepare("select count(*) as count from wm_operational_meta_context_manifests where current_state = 'current'").get()?.count || 0),
      contextRequestManifestLinkCount: Number(this.db.prepare("select count(*) as count from wm_context_request_manifest_links").get()?.count || 0),
      roleRunCount: Number(this.db.prepare("select count(*) as count from wm_role_runs").get()?.count || 0),
      agentResultCount: Number(this.db.prepare("select count(*) as count from wm_agent_results").get()?.count || 0),
      reconciliationCount: Number(this.db.prepare("select count(*) as count from wm_reconciliations").get()?.count || 0),
    };
    return {
      schema: WORLD_MANAGER_CONTROL_PLANE_STORE_SCHEMA,
      persistence: "sqlite_wal",
      projectionRevision: this.revision(),
      ledgerHeadDigest: this.ledgerHeadDigest(),
      focusedProjectId: this.focusedProjectId(),
      counts,
      rendererPathExposed: false,
      rawProviderPayloadStored: false,
      rawChainOfThoughtStored: false,
    };
  }

  snapshotData() {
    const bootstrap = this.currentBootstrap();
    if (!bootstrap) fail("world_manager_bootstrap_missing");
    return {
      bootstrap,
      projectionRevision: this.revision(),
      ledgerHeadDigest: this.ledgerHeadDigest(),
      focusedProjectId: this.focusedProjectId() || bootstrap.projects[0]?.projectId || "",
      events: this.listEvents(),
      messages: this.listMessages(),
      candidateArtifacts: this.listCandidateArtifacts(),
      planProposalRevisions:
        this.listPlanProposalRevisions(),
      planAdmissions:
        this.listPlanAdmissions(),
      implementationContracts:
        this.listImplementationContracts(),
      projectConstitutions: this.listProjectConstitutions(),
      projectRuntimeDefaults: this.listProjectRuntimeDefaults(),
      projectWorkspaceBindings: this.listProjectWorkspaceBindings(),
      environmentProbeReceipts: this.listEnvironmentProbeReceipts(),
      threadEnvironmentBindings: this.listThreadEnvironmentBindings(),
      stepEnvironmentSnapshots: this.listStepEnvironmentSnapshots(),
      childEnvironmentInheritances:
        this.listChildEnvironmentInheritances(),
      pendingDecisions: this.listPendingDecisions(),
      semanticIngressRuns: this.listSemanticIngressRuns(),
      semanticSettlementRevisions:
        this.listSemanticSettlementRevisions({
          currentOnly: true,
        }),
      semanticHistoryRelations:
        this.listSemanticHistoryRelations({
          lifecycle: "active",
        }),
      semanticShelves: this.listSemanticShelves({
        currentOnly: true,
      }),
      semanticArtifactKernelAvailable: true,
      semanticArtifacts: this.listSemanticArtifacts({
        currentOnly: true,
      }),
      aroReconstructionCandidates:
        this.listAroReconstructionCandidates({
          currentOnly: true,
        }),
      repositorySemanticSnapshots:
        this.listRepositorySemanticSnapshots({
          limit: 40,
        }),
      aroReconstructionRuns:
        this.listAroReconstructionRuns({
          currentOnly: true,
        }),
      aroTargetDefinitionRuns:
        this.listAroTargetDefinitionRuns({
          currentOnly: true,
        }),
      aroMutationContracts:
        this.listAroMutationContracts({
          currentOnly: true,
        }),
      aroMutationCompilationRuns:
        this.listAroMutationCompilationRuns({
          currentOnly: true,
        }),
      aroRealizationContextImports:
        this.listAroRealizationContextImports({
          limit: 200,
        }),
      aroRealizationMappingWitnesses:
        this.listAroRealizationMappingWitnesses({
          limit: 200,
        }),
      aroRealizationMappingRuns:
        this.listAroRealizationMappingRuns({
          currentOnly: true,
        }),
      aroWorkerSourceFreshness:
        this.listAroWorkerSourceFreshness({
          limit: 200,
        }),
      aroWorkerCapabilityObservations:
        this.listAroWorkerCapabilityObservations({
          limit: 200,
        }),
      aroWorkerReviewReceipts:
        this.listAroWorkerReviewReceipts({
          limit: 200,
        }),
      aroWorkerConstitutions:
        this.listAroWorkerConstitutions({
          limit: 200,
        }),
      aroWorkerAuthorizations:
        this.listAroWorkerAuthorizations({
          limit: 200,
        }),
      aroWorkerHandoffRuns:
        this.listAroWorkerHandoffRuns({
          currentOnly: true,
        }),
      aroExecutionEvidenceBundles:
        this.listAroExecutionEvidenceBundles({
          limit: 200,
        }),
      aroExecutionEvidenceRuns:
        this.listAroExecutionEvidenceRuns({
          currentOnly: true,
        }),
      aroSemanticVerificationAssessments:
        this.listAroSemanticVerificationAssessments({
          limit: 200,
        }),
      aroClosureCandidates:
        this.listAroClosureCandidates({
          limit: 200,
        }),
      aroSemanticVerificationRuns:
        this.listAroSemanticVerificationRuns({
          currentOnly: true,
        }),
      thoughtBrushStrokes:
        this.listThoughtBrushStrokes({
          limit: 200,
        }),
      contextCanvases:
        this.listContextCanvases({
          currentOnly: true,
          limit: 80,
        }),
      abstractReasoningObjects:
        this.listAbstractReasoningObjects({
          currentOnly: true,
        }),
      aroReviewReceipts:
        this.listAroReviewReceipts(),
      aroAdmissionReceipts:
        this.listAroAdmissionReceipts(),
      decisionTransitions:
        this.listDecisionTransitions({
          currentOnly: true,
        }),
      semanticChildContracts:
        this.listSemanticChildContracts(),
      semanticSplitCoordinations:
        this.listSemanticSplitCoordinations(),
      settlements: this.listSettlements(),
      routingDecisions: this.listRoutingDecisions(),
      managerContexts: this.listManagerContexts(),
      agentWorldCompilations: this.listAgentWorldCompilations(),
      operationalMetaContexts:
        this.listOperationalMetaContexts(),
      roleRuns: this.listRoleRuns(),
      agentResults: this.listAgentResults(),
      inboxEntries: this.listInboxEntries(),
      reconciliations: this.listReconciliations(),
      graphBinding: this.currentWorldmodelBinding(),
      store: this.descriptor(),
    };
  }
}

module.exports = {
  DirectWorldManagerControlPlaneStore,
  STORE_FILE_NAME,
};
