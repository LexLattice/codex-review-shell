"use strict";

const DIRECT_META_SESSION_INDEX_SCHEMA = "direct_meta_session_index@1";
const DIRECT_META_SOURCE_REF_SCHEMA = "direct_meta_source_ref@1";
const DIRECT_META_ARTIFACT_REF_SCHEMA = "direct_meta_artifact_ref@1";
const DIRECT_META_SESSION_SCHEMA = "direct_meta_session@1";
const DIRECT_EXECUTION_CONTEXT_SCHEMA = "direct_execution_context@1";
const DIRECT_EXECUTION_CONTEXT_REGISTRY_SCHEMA = "direct_execution_context_registry@1";
const DIRECT_RUN_CONTRACT_SCHEMA = "direct_run_contract@1";
const DIRECT_INSTRUCTION_OMISSION_LEDGER_SCHEMA = "direct_instruction_omission_ledger@1";
const DIRECT_INSTRUCTION_PACKAGE_SCHEMA = "direct_instruction_package@1";
const DIRECT_TRANSITION_GUARD_INPUT_SCHEMA = "direct_transition_guard_input@1";
const DIRECT_TRANSITION_GUARD_DECISION_SCHEMA = "direct_transition_guard_decision@1";
const DIRECT_META_STATE_OBJECT_DESCRIPTOR_SCHEMA = "direct_meta_state_object_descriptor@1";
const DIRECT_HOB_OBLIGATION_STATUS_SCHEMA = "direct_meta_hob_obligation_status@1";
const DIRECT_TRANSITION_CLAIM_SCHEMA = "direct_meta_transition_claim@1";
const DIRECT_UPSTREAM_DISCRIMINATOR_ROW_SCHEMA = "direct_meta_upstream_discriminator_row@1";
const DIRECT_BRL_REPLAY_LOCK_MANIFEST_SCHEMA = "direct_meta_brl_replay_lock_manifest@1";
const DIRECT_META_CURRENT_POINTER_SET_SCHEMA = "direct_meta_current_pointer_set@1";
const DIRECT_META_SESSION_EVENT_SCHEMA = "direct_meta_session_event@1";
const DIRECT_META_SESSION_EVENT_LEDGER_MANIFEST_SCHEMA = "direct_meta_session_event_ledger_manifest@1";
const DIRECT_META_ATTEMPT_FAILURE_SCHEMA = "direct_meta_session_attempt_failure@1";
const DIRECT_META_STATUS_PROJECTION_SCHEMA = "direct_meta_session_status_projection@1";
const DIRECT_META_CONTROL_PLANE_REPORT_SCHEMA = "direct_meta_session_control_plane_report@1";

const DIRECT_META_SESSION_STATUSES = Object.freeze(["open", "stopped", "archived", "forked"]);
const DIRECT_RUN_CONTRACT_STATUSES = Object.freeze(["draft", "locked", "active", "superseded", "retired"]);
const DIRECT_HOB_OBLIGATION_STATUSES = Object.freeze([
  "covered",
  "proved_irrelevant",
  "pass_through",
  "deferred_with_risk",
  "blocked_pending_evidence",
]);
const DIRECT_HOB_COVERAGE_KINDS = Object.freeze([
  "covered_terminalized",
  "covered_by_probe_matrix",
  "covered_by_reference_observation",
  "covered_by_source_tail",
  "scoped_ready_only",
  "unknown",
]);
const DIRECT_HOB_READINESS_POSTURES = Object.freeze(["ready", "diagnostic", "blocked", "future"]);
const DIRECT_META_AUTHORITY_VALUES = Object.freeze(["spec", "fixture", "diagnostic", "derived", "future"]);
const DIRECT_META_SOURCE_KINDS = Object.freeze([
  "intent_spec",
  "implementation_spec",
  "fixture",
  "prior_artifact",
  "contract",
  "context_registry",
  "instruction_package",
  "omission_ledger",
  "transition_guard",
  "hob_row",
  "otb_row",
  "brl_row",
  "diagnostic",
  "unknown",
]);
const DIRECT_META_EVENT_KINDS = Object.freeze([
  "meta_session_created",
  "execution_context_registry_recorded",
  "state_object_descriptor_recorded",
  "run_contract_drafted",
  "run_contract_locked",
  "run_contract_activated",
  "instruction_omission_ledger_recorded",
  "instruction_package_recorded",
  "transition_guard_input_recorded",
  "transition_guard_decision_recorded",
  "hob_obligation_status_recorded",
  "transition_claim_recorded",
  "upstream_discriminator_recorded",
  "brl_replay_lock_manifest_recorded",
  "current_pointer_set_updated",
  "attempt_failure_recorded",
  "status_projection_recorded",
]);
const DIRECT_META_ATTEMPT_KINDS = Object.freeze([
  "session",
  "context_registry",
  "contract",
  "instruction_omission_ledger",
  "instruction_package",
  "transition_guard",
  "descriptor",
  "hob",
  "transition_claim",
  "upstream_discriminator",
  "brl",
  "pointer",
  "projection",
]);
const DIRECT_META_OWNER_KINDS = Object.freeze([
  "meta_session_state",
  "context_registry_state",
  "contract_state",
  "instruction_state",
  "transition_state",
  "route_state",
  "ledger_state",
  "projection_state",
]);
const DIRECT_META_DISCRIMINATOR_KINDS = Object.freeze([
  "runtime_source_class",
  "authority_mode",
  "projection_freshness",
  "context_jurisdiction",
  "contract_epoch",
  "surface_trust",
  "worker_depth",
  "other",
]);

module.exports = {
  DIRECT_BRL_REPLAY_LOCK_MANIFEST_SCHEMA,
  DIRECT_EXECUTION_CONTEXT_REGISTRY_SCHEMA,
  DIRECT_EXECUTION_CONTEXT_SCHEMA,
  DIRECT_HOB_COVERAGE_KINDS,
  DIRECT_HOB_OBLIGATION_STATUSES,
  DIRECT_HOB_READINESS_POSTURES,
  DIRECT_HOB_OBLIGATION_STATUS_SCHEMA,
  DIRECT_INSTRUCTION_OMISSION_LEDGER_SCHEMA,
  DIRECT_INSTRUCTION_PACKAGE_SCHEMA,
  DIRECT_TRANSITION_GUARD_DECISION_SCHEMA,
  DIRECT_TRANSITION_GUARD_INPUT_SCHEMA,
  DIRECT_META_ARTIFACT_REF_SCHEMA,
  DIRECT_META_ATTEMPT_FAILURE_SCHEMA,
  DIRECT_META_ATTEMPT_KINDS,
  DIRECT_META_AUTHORITY_VALUES,
  DIRECT_META_CONTROL_PLANE_REPORT_SCHEMA,
  DIRECT_META_CURRENT_POINTER_SET_SCHEMA,
  DIRECT_META_DISCRIMINATOR_KINDS,
  DIRECT_META_EVENT_KINDS,
  DIRECT_META_OWNER_KINDS,
  DIRECT_META_SESSION_EVENT_LEDGER_MANIFEST_SCHEMA,
  DIRECT_META_SESSION_EVENT_SCHEMA,
  DIRECT_META_SESSION_INDEX_SCHEMA,
  DIRECT_META_SESSION_SCHEMA,
  DIRECT_META_SESSION_STATUSES,
  DIRECT_META_SOURCE_KINDS,
  DIRECT_META_SOURCE_REF_SCHEMA,
  DIRECT_META_STATE_OBJECT_DESCRIPTOR_SCHEMA,
  DIRECT_META_STATUS_PROJECTION_SCHEMA,
  DIRECT_RUN_CONTRACT_SCHEMA,
  DIRECT_RUN_CONTRACT_STATUSES,
  DIRECT_TRANSITION_CLAIM_SCHEMA,
  DIRECT_UPSTREAM_DISCRIMINATOR_ROW_SCHEMA,
};
