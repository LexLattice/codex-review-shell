"use strict";

const DIRECT_ACTIVE_INTERACTION_WORLDMODEL_SCHEMA = "direct_active_interaction_worldmodel@1";
const DIRECT_WORLD_SCOPE_REF_SCHEMA = "direct_world_scope_ref@1";
const DIRECT_ODEU_LANE_SECTION_SCHEMA = "direct_odeu_lane_section@1";
const DIRECT_TASK_ODEU_LANE_SCHEMA = "direct_task_odeu_lane@1";
const DIRECT_ARTIFACT_ENVIRONMENT_ODEU_LANE_SCHEMA = "direct_artifact_environment_odeu_lane@1";
const DIRECT_MODEL_SELF_ODEU_LANE_SCHEMA = "direct_model_self_odeu_lane@1";
const DIRECT_INTERACTION_GOVERNANCE_ODEU_LANE_SCHEMA = "direct_interaction_governance_odeu_lane@1";
const DIRECT_WORLDMODEL_UNKNOWN_SCHEMA = "direct_worldmodel_unknown@1";
const DIRECT_WORLDMODEL_REMAND_SCHEMA = "direct_worldmodel_remand@1";
const DIRECT_WORLDMODEL_REVISION_COMPATIBILITY_SCHEMA = "direct_worldmodel_revision_compatibility@1";

const WORLD_SCOPE_KINDS = Object.freeze([
  "global_user",
  "project",
  "work_thread",
  "session",
]);

const ODEU_LANE_KEYS = Object.freeze([
  "task",
  "environment",
  "modelSelf",
  "governance",
]);

const ODEU_LANE_KINDS = Object.freeze([
  "task",
  "artifact_environment",
  "model_self",
  "interaction_governance",
]);

const ODEU_LANE_SCHEMAS = Object.freeze({
  task: DIRECT_TASK_ODEU_LANE_SCHEMA,
  artifact_environment: DIRECT_ARTIFACT_ENVIRONMENT_ODEU_LANE_SCHEMA,
  model_self: DIRECT_MODEL_SELF_ODEU_LANE_SCHEMA,
  interaction_governance: DIRECT_INTERACTION_GOVERNANCE_ODEU_LANE_SCHEMA,
});

const ODEU_SECTION_KEYS = Object.freeze(["O", "E", "D", "U"]);

const ODEU_SECTION_LABELS = Object.freeze({
  O: "object",
  E: "evidence",
  D: "deontic",
  U: "utility",
});

const WORLDMODEL_STATUSES = Object.freeze([
  "complete",
  "partial",
  "remanded",
  "stale",
  "diagnostic_only",
  "unknown",
]);

const WORLDMODEL_UNKNOWN_KINDS = Object.freeze([
  "missing_lane",
  "missing_source",
  "stale_source",
  "unverified_claim",
  "scope_ambiguous",
  "capability_unknown",
  "policy_unknown",
  "other",
]);

const WORLDMODEL_REMAND_KINDS = Object.freeze([
  "need_user_clarification",
  "need_manager_resolution",
  "need_source_inspection",
  "need_policy_resolution",
  "need_scope_selection",
  "other",
]);

const REVISION_COMPATIBILITY_VALUES = Object.freeze([
  "same",
  "stale",
  "future",
  "different_worldmodel",
  "unknown",
]);

module.exports = {
  DIRECT_ACTIVE_INTERACTION_WORLDMODEL_SCHEMA,
  DIRECT_ARTIFACT_ENVIRONMENT_ODEU_LANE_SCHEMA,
  DIRECT_INTERACTION_GOVERNANCE_ODEU_LANE_SCHEMA,
  DIRECT_MODEL_SELF_ODEU_LANE_SCHEMA,
  DIRECT_ODEU_LANE_SECTION_SCHEMA,
  DIRECT_TASK_ODEU_LANE_SCHEMA,
  DIRECT_WORLDMODEL_REMAND_SCHEMA,
  DIRECT_WORLDMODEL_REVISION_COMPATIBILITY_SCHEMA,
  DIRECT_WORLDMODEL_UNKNOWN_SCHEMA,
  DIRECT_WORLD_SCOPE_REF_SCHEMA,
  ODEU_LANE_KEYS,
  ODEU_LANE_KINDS,
  ODEU_LANE_SCHEMAS,
  ODEU_SECTION_KEYS,
  ODEU_SECTION_LABELS,
  REVISION_COMPATIBILITY_VALUES,
  WORLDMODEL_REMAND_KINDS,
  WORLDMODEL_STATUSES,
  WORLDMODEL_UNKNOWN_KINDS,
  WORLD_SCOPE_KINDS,
};
