"use strict";

const crypto = require("node:crypto");
const { normalizeString, nowIso } = require("../meta-session/ids");

const SUB_AGENT_INTERACTION_POLICY_ENVELOPE_SCHEMA = "sub_agent_interaction_policy_envelope@1";
const NO_INTERFERENCE_POLICY_WITNESS_SCHEMA = "no_interference_policy_witness@1";
const RESIDENT_TOOL_CATALOG_POLICY_ROW_SCHEMA = "resident_tool_catalog_policy_row@1";
const OPERATOR_BLOCKED_CONTROL_PROJECTION_SCHEMA = "operator_blocked_control_projection@1";
const DETERMINISTIC_BLOCKED_RESULT_ENVELOPE_SCHEMA = "deterministic_blocked_result_envelope@1";

const ACTOR_KINDS = Object.freeze(["resident_model", "operator", "headless_route", "sub_agent"]);
const TARGET_KINDS = Object.freeze(["child_agent", "child_thread", "work_thread"]);
const POLICY_SCOPES = Object.freeze(["single_child", "parent_turn", "parent_thread", "work_thread"]);
const INTERACTION_POLICIES = Object.freeze([
  "observe_only",
  "no_interference",
  "followup_allowed",
  "lifecycle_operator_gated",
]);

const OBSERVATION_ACTIONS = Object.freeze([
  "list_agents",
  "inspect_agent",
  "status_agent",
  "wait_agent",
]);

const FOLLOWUP_ACTIONS = Object.freeze([
  "send_message",
  "followup_task",
]);

const LIFECYCLE_CONTROL_ACTIONS = Object.freeze([
  "interrupt_agent",
  "close_agent",
  "resume_agent",
]);

const INTERFERING_ACTIONS = Object.freeze([
  ...FOLLOWUP_ACTIONS,
  ...LIFECYCLE_CONTROL_ACTIONS,
]);

const ALL_POLICY_ACTIONS = Object.freeze([
  ...OBSERVATION_ACTIONS,
  ...INTERFERING_ACTIONS,
]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function stableStringify(value) {
  if (value && typeof value.toJSON === "function") return stableStringify(value.toJSON());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => (entry === undefined ? "null" : stableStringify(entry))).join(",")}]`;
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined && key !== "policyDigest" && key !== "rowDigest" && key !== "witnessDigest" && key !== "projectionDigest" && key !== "resultDigest")
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function digestFor(domain, value) {
  return `sha256:${crypto.createHash("sha256").update(`${domain}\0${stableStringify(value)}`).digest("hex")}`;
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = normalizeString(value, fallback);
  return allowed.includes(normalized) ? normalized : fallback;
}

function sourceRef(kind, id, label) {
  const ref = {
    kind: normalizeString(kind, "sub_agent_interaction_policy"),
  };
  if (normalizeString(id, "")) ref.id = normalizeString(id, "");
  if (normalizeString(label, "")) ref.label = normalizeString(label, "");
  ref.rawTextIncluded = false;
  ref.rawProviderPayloadIncluded = false;
  return ref;
}

function normalizeSourceRefs(value, fallbackId) {
  const refs = Array.isArray(value) ? value.filter(isPlainObject) : [];
  const normalized = refs.map((ref) => sourceRef(ref.kind || ref.source, ref.id || ref.refId || ref.digest, ref.label));
  return normalized.length ? normalized : [sourceRef("policy_source", fallbackId, "sub-agent interaction policy source")];
}

function policyBlocksInterference(policy) {
  return policy === "observe_only" || policy === "no_interference";
}

function allowedActionsFor(policy, actorKind, otherwiseAuthorized = []) {
  const authorized = new Set(Array.isArray(otherwiseAuthorized) && otherwiseAuthorized.length ? otherwiseAuthorized : OBSERVATION_ACTIONS);
  const allowedObservation = OBSERVATION_ACTIONS.filter((action) => authorized.has(action));
  if (policyBlocksInterference(policy)) return allowedObservation;
  if (policy === "followup_allowed") {
    return [...new Set([...allowedObservation, ...FOLLOWUP_ACTIONS.filter((action) => authorized.has(action) || otherwiseAuthorized.length === 0)])];
  }
  if (policy === "lifecycle_operator_gated" && actorKind === "operator") {
    return [...new Set([...allowedObservation, ...LIFECYCLE_CONTROL_ACTIONS.filter((action) => authorized.has(action))])];
  }
  return allowedObservation;
}

function blockedActionsFor(policy, actorKind, allowedActions) {
  const allowed = new Set(allowedActions);
  const blocked = ALL_POLICY_ACTIONS.filter((action) => !allowed.has(action));
  if (policyBlocksInterference(policy)) {
    return [...new Set([...blocked, ...INTERFERING_ACTIONS])].sort();
  }
  if (policy === "followup_allowed") {
    return [...new Set([...blocked, ...LIFECYCLE_CONTROL_ACTIONS])].sort();
  }
  if (policy === "lifecycle_operator_gated" && actorKind !== "operator") {
    return [...new Set([...blocked, ...LIFECYCLE_CONTROL_ACTIONS])].sort();
  }
  return blocked.sort();
}

function blockerReasonFor(action, policy, actorKind) {
  if (policyBlocksInterference(policy) && INTERFERING_ACTIONS.includes(action)) {
    return policy === "no_interference" ? "blocked_by_no_interference_policy" : "blocked_by_observe_only_policy";
  }
  if (policy === "followup_allowed" && LIFECYCLE_CONTROL_ACTIONS.includes(action)) {
    return "blocked_lifecycle_controls_not_promoted_in_pr99";
  }
  if (policy === "lifecycle_operator_gated" && actorKind !== "operator" && LIFECYCLE_CONTROL_ACTIONS.includes(action)) {
    return "blocked_lifecycle_operator_gate";
  }
  return "not_authorized_for_current_policy";
}

function catalogDispositionFor(action, policy, actorKind, allowed) {
  if (allowed) return "callable";
  if (policyBlocksInterference(policy) && INTERFERING_ACTIONS.includes(action)) return "removed_or_blocked_result";
  if (LIFECYCLE_CONTROL_ACTIONS.includes(action)) return actorKind === "operator" ? "blocked_result" : "removed_or_blocked_result";
  return "blocked_result";
}

function buildBlockedResultEnvelope({ action, blockerReason, policyId, policyDigest, actorKind, targetId, generatedAt }) {
  const result = {
    schema: DETERMINISTIC_BLOCKED_RESULT_ENVELOPE_SCHEMA,
    resultEnvelopeId: `blocked_sub_agent_action_${digestFor("sub-agent-blocked-result-id@1", {
      action,
      policyId,
      actorKind,
      targetId,
    }).slice(7, 23)}`,
    action,
    outcome: "blocked",
    blockerReason,
    policyId,
    policyDigest,
    actorKind,
    targetId,
    generatedAt,
    providerTransportStarted: false,
    lifecycleMutationStarted: false,
    followupTransportStarted: false,
    workspaceMutationStarted: false,
    rawProviderPayloadIncluded: false,
    rawChildTranscriptIncluded: false,
  };
  result.resultDigest = digestFor("deterministic-blocked-result-envelope@1", result);
  return result;
}

function buildCatalogRows({ envelopeBase, allowedActions, generatedAt }) {
  const allowed = new Set(allowedActions);
  return ALL_POLICY_ACTIONS.map((action) => {
    const actionAllowed = allowed.has(action);
    const blockerReason = actionAllowed ? "" : blockerReasonFor(action, envelopeBase.policy, envelopeBase.actorKind);
    const row = {
      schema: RESIDENT_TOOL_CATALOG_POLICY_ROW_SCHEMA,
      rowId: `resident_tool_catalog_policy_${digestFor("resident-tool-catalog-policy-row-id@1", {
        policyId: envelopeBase.policyId,
        action,
      }).slice(7, 23)}`,
      action,
      actorKind: envelopeBase.actorKind,
      targetId: envelopeBase.targetId,
      policyId: envelopeBase.policyId,
      policyDigest: envelopeBase.policyDigest,
      catalogDisposition: catalogDispositionFor(action, envelopeBase.policy, envelopeBase.actorKind, actionAllowed),
      callableInCurrentRequest: actionAllowed,
      declaredAsProviderTool: actionAllowed,
      deterministicBlockedResultAvailable: !actionAllowed,
      blockerReason,
      generatedAt,
      rawPolicyPayloadIncluded: false,
      providerTransportStarted: false,
    };
    if (!actionAllowed) {
      row.blockedResultEnvelope = buildBlockedResultEnvelope({
        action,
        blockerReason,
        policyId: envelopeBase.policyId,
        policyDigest: envelopeBase.policyDigest,
        actorKind: envelopeBase.actorKind,
        targetId: envelopeBase.targetId,
        generatedAt,
      });
    }
    row.rowDigest = digestFor("resident-tool-catalog-policy-row@1", row);
    return row;
  });
}

function buildOperatorBlockedControlProjection({ envelopeBase, catalogRows, generatedAt }) {
  const blockedControls = catalogRows
    .filter((row) => row.callableInCurrentRequest === false && INTERFERING_ACTIONS.includes(row.action))
    .map((row) => ({
      action: row.action,
      blockerReason: row.blockerReason,
      policyId: row.policyId,
      policyDigest: row.policyDigest,
      targetId: row.targetId,
      deterministicBlockedResultId: row.blockedResultEnvelope?.resultEnvelopeId || "",
    }));
  const projection = {
    schema: OPERATOR_BLOCKED_CONTROL_PROJECTION_SCHEMA,
    projectionId: `operator_blocked_control_${digestFor("operator-blocked-control-projection-id@1", {
      policyId: envelopeBase.policyId,
      targetId: envelopeBase.targetId,
      actorKind: envelopeBase.actorKind,
    }).slice(7, 23)}`,
    actorKind: envelopeBase.actorKind,
    targetId: envelopeBase.targetId,
    policyId: envelopeBase.policyId,
    policyDigest: envelopeBase.policyDigest,
    blockedControls,
    rendererVisible: true,
    grantsAuthority: false,
    providerTransportStarted: false,
    lifecycleMutationStarted: false,
    followupTransportStarted: false,
    generatedAt,
  };
  projection.projectionDigest = digestFor("operator-blocked-control-projection@1", projection);
  return projection;
}

function buildNoInterferenceWitness({ envelopeBase, catalogRows, generatedAt }) {
  const blockedInterference = catalogRows.filter((row) => INTERFERING_ACTIONS.includes(row.action) && row.callableInCurrentRequest === false);
  const witness = {
    schema: NO_INTERFERENCE_POLICY_WITNESS_SCHEMA,
    witnessId: `no_interference_witness_${digestFor("no-interference-policy-witness-id@1", {
      policyId: envelopeBase.policyId,
      actorKind: envelopeBase.actorKind,
      targetId: envelopeBase.targetId,
    }).slice(7, 23)}`,
    policyId: envelopeBase.policyId,
    policyDigest: envelopeBase.policyDigest,
    actorKind: envelopeBase.actorKind,
    actorId: envelopeBase.actorId,
    targetKind: envelopeBase.targetKind,
    targetId: envelopeBase.targetId,
    scope: envelopeBase.scope,
    policy: envelopeBase.policy,
    selfBindingEnforced: envelopeBase.actorKind === "resident_model" || envelopeBase.actorKind === "headless_route" || envelopeBase.actorKind === "sub_agent",
    blockedInterferingActions: blockedInterference.map((row) => row.action),
    providerDeclarationPosture: policyBlocksInterference(envelopeBase.policy) ? "removed_or_blocked_result" : "policy_filtered",
    policyInferredFromUiLabel: false,
    policyRelaxationFlowAvailable: false,
    generatedAt,
    rawPolicyPayloadIncluded: false,
    sourceRefs: envelopeBase.sourceRefs,
  };
  witness.witnessDigest = digestFor("no-interference-policy-witness@1", witness);
  return witness;
}

function buildSubAgentInteractionPolicyEnvelope(input = {}, options = {}) {
  const safeInput = isPlainObject(input) ? input : {};
  const safeOptions = isPlainObject(options) ? options : {};
  const generatedAt = nowIso(safeOptions.now || safeInput.now || Date.now);
  const actorKind = normalizeEnum(safeInput.actorKind, ACTOR_KINDS, "resident_model");
  const targetKind = normalizeEnum(safeInput.targetKind, TARGET_KINDS, "child_agent");
  const targetId = normalizeString(safeInput.targetId || safeInput.childAgentId || safeInput.childThreadId, "child_agent_unknown");
  const policy = normalizeEnum(safeInput.policy, INTERACTION_POLICIES, "observe_only");
  const scope = normalizeEnum(safeInput.scope, POLICY_SCOPES, "single_child");
  const sourceRefs = normalizeSourceRefs(safeInput.sourceRefs, targetId);
  const allowedActions = allowedActionsFor(policy, actorKind, safeInput.otherwiseAuthorizedActions);
  const blockedActions = blockedActionsFor(policy, actorKind, allowedActions);
  const envelopeBase = {
    schema: SUB_AGENT_INTERACTION_POLICY_ENVELOPE_SCHEMA,
    policyId: normalizeString(safeInput.policyId, `sub_agent_policy_${digestFor("sub-agent-interaction-policy-id@1", {
      actorKind,
      actorId: safeInput.actorId,
      targetKind,
      targetId,
      scope,
      policy,
    }).slice(7, 23)}`),
    actorKind,
    actorId: normalizeString(safeInput.actorId, ""),
    targetKind,
    targetId,
    scope,
    policy,
    blockedActions,
    allowedActions,
    expiresAt: normalizeString(safeInput.expiresAt, ""),
    sourceRefs,
    generatedAt,
    policyInferredFromUiLabel: false,
    providerTransportStarted: false,
    lifecycleMutationStarted: false,
    followupTransportStarted: false,
    workspaceMutationStarted: false,
    rawPolicyPayloadIncluded: false,
    rawProviderPayloadIncluded: false,
  };
  envelopeBase.policyDigest = digestFor("sub-agent-interaction-policy-envelope@1", envelopeBase);
  const catalogRows = buildCatalogRows({ envelopeBase, allowedActions, generatedAt });
  const envelope = {
    ...envelopeBase,
    noInterferencePolicyWitness: buildNoInterferenceWitness({ envelopeBase, catalogRows, generatedAt }),
    residentToolCatalogPolicyRows: catalogRows,
    operatorBlockedControlProjection: buildOperatorBlockedControlProjection({ envelopeBase, catalogRows, generatedAt }),
  };
  validateSubAgentInteractionPolicyEnvelope(envelope);
  return envelope;
}

function validateSubAgentInteractionPolicyEnvelope(envelope = {}) {
  const errors = [];
  if (!isPlainObject(envelope)) throw new Error("sub_agent_interaction_policy_envelope_invalid_object");
  if (envelope.schema !== SUB_AGENT_INTERACTION_POLICY_ENVELOPE_SCHEMA) throw new Error("sub_agent_interaction_policy_envelope_schema_mismatch");
  for (const field of ["policyId", "actorKind", "targetKind", "targetId", "scope", "policy", "policyDigest", "generatedAt"]) {
    if (!normalizeString(envelope[field], "")) errors.push(`missing_required_string:${field}`);
  }
  if (!ACTOR_KINDS.includes(envelope.actorKind)) errors.push(`invalid_actor_kind:${envelope.actorKind}`);
  if (!TARGET_KINDS.includes(envelope.targetKind)) errors.push(`invalid_target_kind:${envelope.targetKind}`);
  if (!POLICY_SCOPES.includes(envelope.scope)) errors.push(`invalid_scope:${envelope.scope}`);
  if (!INTERACTION_POLICIES.includes(envelope.policy)) errors.push(`invalid_policy:${envelope.policy}`);
  if (!Array.isArray(envelope.allowedActions)) errors.push("allowed_actions_missing");
  if (!Array.isArray(envelope.blockedActions)) errors.push("blocked_actions_missing");
  if (!Array.isArray(envelope.sourceRefs) || !envelope.sourceRefs.length) errors.push("source_refs_missing");
  for (const flag of ["policyInferredFromUiLabel", "providerTransportStarted", "lifecycleMutationStarted", "followupTransportStarted", "workspaceMutationStarted", "rawPolicyPayloadIncluded", "rawProviderPayloadIncluded"]) {
    if (envelope[flag] !== false) errors.push(`envelope_boundary_leak:${flag}`);
  }
  if (policyBlocksInterference(envelope.policy)) {
    for (const action of INTERFERING_ACTIONS) {
      if (!envelope.blockedActions.includes(action)) errors.push(`interfering_action_not_blocked:${action}`);
      if (envelope.allowedActions.includes(action)) errors.push(`interfering_action_allowed:${action}`);
    }
  }
  const catalogRows = Array.isArray(envelope.residentToolCatalogPolicyRows) ? envelope.residentToolCatalogPolicyRows : [];
  if (!catalogRows.length) errors.push("resident_catalog_rows_missing");
  const rowsByAction = new Map(catalogRows.map((row) => [row?.action, row]));
  for (const action of ALL_POLICY_ACTIONS) {
    if (!rowsByAction.has(action)) errors.push(`catalog_row_missing:${action}`);
  }
  for (const row of catalogRows) {
    if (!isPlainObject(row)) {
      errors.push("catalog_row_invalid_object");
      continue;
    }
    if (row.schema !== RESIDENT_TOOL_CATALOG_POLICY_ROW_SCHEMA) errors.push(`catalog_row_schema_mismatch:${row.action}`);
    if (row.policyDigest !== envelope.policyDigest) errors.push(`catalog_row_policy_digest_mismatch:${row.action}`);
    if (row.declaredAsProviderTool !== row.callableInCurrentRequest) errors.push(`provider_declaration_mismatch:${row.action}`);
    if (row.callableInCurrentRequest === false) {
      if (!normalizeString(row.blockerReason, "")) errors.push(`blocked_row_missing_reason:${row.action}`);
      if (row.deterministicBlockedResultAvailable !== true) errors.push(`blocked_row_missing_result:${row.action}`);
      if (row.blockedResultEnvelope?.schema !== DETERMINISTIC_BLOCKED_RESULT_ENVELOPE_SCHEMA) errors.push(`blocked_result_schema_mismatch:${row.action}`);
      if (row.blockedResultEnvelope?.providerTransportStarted !== false) errors.push(`blocked_result_provider_transport_leak:${row.action}`);
      if (row.blockedResultEnvelope?.lifecycleMutationStarted !== false) errors.push(`blocked_result_lifecycle_mutation_leak:${row.action}`);
      if (row.blockedResultEnvelope?.followupTransportStarted !== false) errors.push(`blocked_result_followup_transport_leak:${row.action}`);
    }
  }
  const witness = envelope.noInterferencePolicyWitness;
  if (witness?.schema !== NO_INTERFERENCE_POLICY_WITNESS_SCHEMA) errors.push("no_interference_witness_missing");
  if (witness?.policyDigest !== envelope.policyDigest) errors.push("no_interference_witness_policy_digest_mismatch");
  if (witness?.policyInferredFromUiLabel !== false) errors.push("policy_inferred_from_ui_label");
  if (witness?.policyRelaxationFlowAvailable !== false) errors.push("policy_relaxation_flow_leak");
  const projection = envelope.operatorBlockedControlProjection;
  if (projection?.schema !== OPERATOR_BLOCKED_CONTROL_PROJECTION_SCHEMA) errors.push("operator_blocked_control_projection_missing");
  if (projection?.grantsAuthority !== false) errors.push("operator_projection_grants_authority");
  if (projection?.policyDigest !== envelope.policyDigest) errors.push("operator_projection_policy_digest_mismatch");
  if (!errors.length) return true;
  throw new Error(`sub_agent_interaction_policy_envelope_validation_failed:${errors.join(",")}`);
}

module.exports = {
  ALL_POLICY_ACTIONS,
  DETERMINISTIC_BLOCKED_RESULT_ENVELOPE_SCHEMA,
  FOLLOWUP_ACTIONS,
  INTERACTION_POLICIES,
  INTERFERING_ACTIONS,
  LIFECYCLE_CONTROL_ACTIONS,
  NO_INTERFERENCE_POLICY_WITNESS_SCHEMA,
  OBSERVATION_ACTIONS,
  OPERATOR_BLOCKED_CONTROL_PROJECTION_SCHEMA,
  RESIDENT_TOOL_CATALOG_POLICY_ROW_SCHEMA,
  SUB_AGENT_INTERACTION_POLICY_ENVELOPE_SCHEMA,
  buildSubAgentInteractionPolicyEnvelope,
  validateSubAgentInteractionPolicyEnvelope,
};
