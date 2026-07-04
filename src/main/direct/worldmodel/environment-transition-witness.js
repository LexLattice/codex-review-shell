"use strict";

const { canonicalJson, sha256 } = require("../meta-session/digest");
const {
  isPlainObject,
  normalizeId,
  normalizeString,
  nowIso,
} = require("../meta-session/ids");
const {
  validateAuthorizationDecision,
  validateAuthorizationRequest,
} = require("./authorization-router");
const {
  validateDirectEnvironmentTopology,
  validateTurnExecutionEnvironment,
} = require("./environment-topology");

const DIRECT_CROSS_ENV_AUTHORIZATION_ROUTE_ENVELOPE_SCHEMA = "direct_cross_environment_authorization_route_envelope@1";
const DIRECT_ENVIRONMENT_TRANSITION_WITNESS_SCHEMA = "direct_environment_transition_witness@1";
const DIRECT_ENVIRONMENT_TRANSITION_LIFECYCLE_ROW_SCHEMA = "direct_environment_transition_lifecycle_row@1";

const ENVIRONMENT_TRANSITION_KINDS = Object.freeze([
  "single_tool_call",
  "tool_session",
  "specialist_worker_delegation",
]);

const CROSS_ENV_ROUTE_STATUSES = Object.freeze([
  "route_ready_for_authorization",
  "authorization_missing",
  "authorization_remanded",
  "unsupported_route",
]);

const ENVIRONMENT_TRANSITION_LIFECYCLE_EVENTS = Object.freeze([
  "requested",
  "authorized",
  "session_started",
  "completed",
  "failed",
  "cancelled",
  "remanded",
]);

const DIGEST_FIELDS = new Set([
  "envelopeDigest",
  "witnessDigest",
  "rowDigest",
]);

function validationError(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  if (detail) error.detail = detail;
  return error;
}

function requirePlainObject(value, label) {
  if (isPlainObject(value)) return value;
  throw validationError("direct_environment_transition_invalid_object", label);
}

function requireString(value, label) {
  const text = normalizeString(value, "");
  if (text) return text;
  throw validationError("direct_environment_transition_missing_string", label);
}

function requireArray(value, label) {
  if (Array.isArray(value)) return value;
  throw validationError("direct_environment_transition_missing_array", label);
}

function pickEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map((entry) => stableValue(entry));
  if (!isPlainObject(value)) return value;
  const output = {};
  for (const key of Object.keys(value).sort()) {
    if (DIGEST_FIELDS.has(key)) continue;
    if (typeof value[key] !== "undefined") output[key] = stableValue(value[key]);
  }
  return output;
}

function digestFor(domain, value) {
  return sha256(`${domain}\0${canonicalJson(stableValue(value), { omitDigestFields: false })}`);
}

function validateDigest(value, fieldName, domain, label) {
  const digest = requireString(value[fieldName], `${label}.${fieldName}`);
  if (digest !== digestFor(domain, value)) {
    throw validationError("direct_environment_transition_digest_mismatch", `${label}.${fieldName}`);
  }
  return true;
}

function normalizeList(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => normalizeString(value, ""))
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function refFrom(kind, id, digest, label, extra = {}) {
  return {
    kind: normalizeString(kind, "unknown"),
    id: normalizeString(id, ""),
    digest: normalizeString(digest, ""),
    label: normalizeString(label, kind),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    ...extra,
  };
}

function validateRef(ref, label, options = {}) {
  requirePlainObject(ref, label);
  requireString(ref.kind, `${label}.kind`);
  if (options.requireId !== false) requireString(ref.id, `${label}.id`);
  if (options.requireDigest !== false) requireString(ref.digest, `${label}.digest`);
  if (ref.rawTextIncluded === true || ref.rawPathIncluded === true || ref.rawSecretIncluded === true) {
    throw validationError("direct_environment_transition_raw_ref_exposure", label);
  }
  return true;
}

function environmentRefFromRoute(routeRow = {}, side = "owner") {
  const ref = side === "resident" ? routeRow.residentEnvironmentRef : routeRow.ownerEnvironmentRef;
  if (isPlainObject(ref)) return ref;
  const id = side === "resident" ? routeRow.residentEnvironmentId : routeRow.ownerEnvironmentId;
  return refFrom("direct_environment", id, "", id || `${side} environment`);
}

function toolRouteRef(routeRow = {}) {
  return refFrom("direct_environment_tool_route_row", routeRow.rowId, routeRow.rowDigest, routeRow.displayName || routeRow.toolId, {
    toolId: normalizeString(routeRow.toolId, ""),
    routeClass: normalizeString(routeRow.routeClass, ""),
  });
}

function topologyRef(topology = {}) {
  return refFrom("direct_environment_topology", topology.topologyId, topology.topologyDigest, "Direct environment topology", {
    revision: Number(topology.revision || 0),
  });
}

function turnEnvironmentRef(turnEnvironment = {}) {
  return refFrom("turn_execution_environment", turnEnvironment.turnId, turnEnvironment.turnEnvironmentDigest, "Turn execution environment", {
    residentEnvironmentId: normalizeString(turnEnvironment.residentEnvironmentId, ""),
  });
}

function authorizationRequestRef(request = null) {
  if (!request) return null;
  return refFrom("authorization_request", request.requestId, request.requestDigest, request.requestedAction?.actionClass || "authorization request");
}

function authorizationDecisionRef(decision = null) {
  if (!decision) return null;
  return refFrom("authorization_decision", decision.decisionId, decision.decisionDigest, decision.decision || "authorization decision");
}

function inferRouteStatus(routeRow = {}, authorizationDecision = null) {
  if (!["cross_environment_tool_session", "specialist_worker_required"].includes(routeRow.routeClass)) {
    return "unsupported_route";
  }
  if (routeRow.routeMayProceed !== true) return "unsupported_route";
  if (!authorizationDecision) return "authorization_missing";
  if (authorizationDecision.decision === "grant") return "route_ready_for_authorization";
  return "authorization_remanded";
}

function buildCrossEnvironmentAuthorizationRouteEnvelope(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const topology = source.topology || source.environmentTopology;
  const turnEnvironment = source.turnEnvironment || source.turnExecutionEnvironment;
  const routeRow = source.routeRow || source.toolRouteRow;
  const authorizationRequest = source.authorizationRequest || source.request || null;
  const authorizationDecision = source.authorizationDecision || source.decision || null;

  if (topology) validateDirectEnvironmentTopology(topology);
  if (turnEnvironment) validateTurnExecutionEnvironment(turnEnvironment);
  requirePlainObject(routeRow, "crossEnvironmentRoute.routeRow");
  if (authorizationRequest) validateAuthorizationRequest(authorizationRequest);
  if (authorizationDecision) validateAuthorizationDecision(authorizationDecision);

  const routeStatus = pickEnum(source.routeStatus, CROSS_ENV_ROUTE_STATUSES, inferRouteStatus(routeRow, authorizationDecision));
  const transitionKind = pickEnum(source.transitionKind, ENVIRONMENT_TRANSITION_KINDS,
    routeRow.routeClass === "specialist_worker_required" ? "specialist_worker_delegation" : "single_tool_call");
  const envelope = {
    schema: DIRECT_CROSS_ENV_AUTHORIZATION_ROUTE_ENVELOPE_SCHEMA,
    envelopeId: normalizeId(source.envelopeId, "cross_environment_authorization_route"),
    transitionKind,
    routeStatus,
    toolId: normalizeString(source.toolId || routeRow.toolId, "unknown_tool"),
    toolName: normalizeString(source.toolName || routeRow.displayName || routeRow.toolId, "Tool"),
    routeClass: normalizeString(routeRow.routeClass, "unsupported_environment"),
    actionClass: normalizeString(routeRow.actionClass, "unknown_action"),
    fromEnvironmentRef: environmentRefFromRoute(routeRow, "resident"),
    toEnvironmentRef: environmentRefFromRoute(routeRow, "owner"),
    topologyRef: topology ? topologyRef(topology) : refFrom("direct_environment_topology", "", "", "Missing environment topology"),
    turnEnvironmentRef: turnEnvironment ? turnEnvironmentRef(turnEnvironment) : refFrom("turn_execution_environment", "", "", "Missing turn execution environment"),
    toolRouteRef: toolRouteRef(routeRow),
    authorizationRequestRef: authorizationRequestRef(authorizationRequest),
    authorizationDecisionRef: authorizationDecisionRef(authorizationDecision),
    routeBlockers: normalizeList([
      ...(Array.isArray(routeRow.blockerCodes) ? routeRow.blockerCodes : []),
      ...(Array.isArray(source.routeBlockers) ? source.routeBlockers : []),
    ]),
    managerAuthorizationRequired: true,
    oneShot: source.oneShot !== false,
    workspaceMutationAuthorized: false,
    providerTransportStarted: false,
    toolSessionStarted: false,
    liveEnvironmentSwitched: false,
    rawTopologyPayloadIncluded: false,
    rawToolPayloadIncluded: false,
    rawAuthorizationPayloadIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    createdAt: normalizeString(source.createdAt, nowIso(options.now || Date.now)),
  };
  envelope.envelopeDigest = digestFor("direct-cross-environment-authorization-route-envelope@1", envelope);
  return envelope;
}

function validateCrossEnvironmentAuthorizationRouteEnvelope(envelope = {}) {
  requirePlainObject(envelope, "crossEnvironmentRouteEnvelope");
  if (envelope.schema !== DIRECT_CROSS_ENV_AUTHORIZATION_ROUTE_ENVELOPE_SCHEMA) {
    throw validationError("direct_environment_transition_schema_mismatch", "crossEnvironmentRouteEnvelope");
  }
  requireString(envelope.envelopeId, "crossEnvironmentRouteEnvelope.envelopeId");
  if (!ENVIRONMENT_TRANSITION_KINDS.includes(envelope.transitionKind)) {
    throw validationError("direct_environment_transition_invalid_kind", "crossEnvironmentRouteEnvelope.transitionKind");
  }
  if (!CROSS_ENV_ROUTE_STATUSES.includes(envelope.routeStatus)) {
    throw validationError("direct_environment_transition_invalid_route_status", "crossEnvironmentRouteEnvelope.routeStatus");
  }
  requireString(envelope.toolId, "crossEnvironmentRouteEnvelope.toolId");
  requireString(envelope.routeClass, "crossEnvironmentRouteEnvelope.routeClass");
  validateRef(envelope.fromEnvironmentRef, "crossEnvironmentRouteEnvelope.fromEnvironmentRef", { requireDigest: false });
  validateRef(envelope.toEnvironmentRef, "crossEnvironmentRouteEnvelope.toEnvironmentRef", { requireDigest: false });
  validateRef(envelope.topologyRef, "crossEnvironmentRouteEnvelope.topologyRef", { requireId: false, requireDigest: false });
  validateRef(envelope.turnEnvironmentRef, "crossEnvironmentRouteEnvelope.turnEnvironmentRef", { requireId: false, requireDigest: false });
  validateRef(envelope.toolRouteRef, "crossEnvironmentRouteEnvelope.toolRouteRef");
  if (envelope.authorizationRequestRef) validateRef(envelope.authorizationRequestRef, "crossEnvironmentRouteEnvelope.authorizationRequestRef");
  if (envelope.authorizationDecisionRef) validateRef(envelope.authorizationDecisionRef, "crossEnvironmentRouteEnvelope.authorizationDecisionRef");
  requireArray(envelope.routeBlockers, "crossEnvironmentRouteEnvelope.routeBlockers");
  if (envelope.managerAuthorizationRequired !== true) {
    throw validationError("direct_environment_transition_missing_authorization_gate", "crossEnvironmentRouteEnvelope.managerAuthorizationRequired");
  }
  for (const flag of ["workspaceMutationAuthorized", "providerTransportStarted", "toolSessionStarted", "liveEnvironmentSwitched"]) {
    if (envelope[flag] !== false) throw validationError("direct_environment_transition_authority_leak", `crossEnvironmentRouteEnvelope.${flag}`);
  }
  for (const flag of ["rawTopologyPayloadIncluded", "rawToolPayloadIncluded", "rawAuthorizationPayloadIncluded", "rawTextIncluded", "rawPathIncluded", "rawSecretIncluded"]) {
    if (envelope[flag] === true) throw validationError("direct_environment_transition_raw_exposure", `crossEnvironmentRouteEnvelope.${flag}`);
  }
  validateDigest(envelope, "envelopeDigest", "direct-cross-environment-authorization-route-envelope@1", "crossEnvironmentRouteEnvelope");
  return true;
}

function envelopeRef(envelope = {}) {
  return refFrom("cross_environment_authorization_route_envelope", envelope.envelopeId, envelope.envelopeDigest, envelope.routeStatus, {
    transitionKind: normalizeString(envelope.transitionKind, ""),
  });
}

function buildEnvironmentTransitionWitness(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const envelope = source.envelope || source.authorizationRouteEnvelope || buildCrossEnvironmentAuthorizationRouteEnvelope(source, options);
  validateCrossEnvironmentAuthorizationRouteEnvelope(envelope);
  const transitionKind = pickEnum(source.transitionKind, ENVIRONMENT_TRANSITION_KINDS, envelope.transitionKind);
  const witness = {
    schema: DIRECT_ENVIRONMENT_TRANSITION_WITNESS_SCHEMA,
    witnessId: normalizeId(source.witnessId, "environment_transition_witness"),
    transitionKind,
    scope: normalizeString(source.scope, transitionKind === "tool_session" ? "single_tool_session" : "single_tool_call"),
    toolId: envelope.toolId,
    toolName: envelope.toolName,
    fromEnvironmentRef: envelope.fromEnvironmentRef,
    toEnvironmentRef: envelope.toEnvironmentRef,
    authorizationRouteEnvelopeRef: envelopeRef(envelope),
    topologyRef: envelope.topologyRef,
    turnEnvironmentRef: envelope.turnEnvironmentRef,
    toolRouteRef: envelope.toolRouteRef,
    lifecycleState: pickEnum(source.lifecycleState, ENVIRONMENT_TRANSITION_LIFECYCLE_EVENTS, "requested"),
    evidenceReturnContract: normalizeString(source.evidenceReturnContract, "return_bounded_evidence_only"),
    workspaceMutationAuthorized: false,
    workspaceMutationPerformed: false,
    providerTransportStarted: false,
    toolSessionStarted: false,
    liveEnvironmentSwitched: false,
    rawRemotePayloadIncluded: false,
    rawTopologyPayloadIncluded: false,
    rawToolPayloadIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    observedAt: normalizeString(source.observedAt, nowIso(options.now || Date.now)),
  };
  witness.witnessDigest = digestFor("direct-environment-transition-witness@1", witness);
  return witness;
}

function validateEnvironmentTransitionWitness(witness = {}) {
  requirePlainObject(witness, "environmentTransitionWitness");
  if (witness.schema !== DIRECT_ENVIRONMENT_TRANSITION_WITNESS_SCHEMA) {
    throw validationError("direct_environment_transition_schema_mismatch", "environmentTransitionWitness");
  }
  requireString(witness.witnessId, "environmentTransitionWitness.witnessId");
  if (!ENVIRONMENT_TRANSITION_KINDS.includes(witness.transitionKind)) {
    throw validationError("direct_environment_transition_invalid_kind", "environmentTransitionWitness.transitionKind");
  }
  if (!ENVIRONMENT_TRANSITION_LIFECYCLE_EVENTS.includes(witness.lifecycleState)) {
    throw validationError("direct_environment_transition_invalid_lifecycle_event", "environmentTransitionWitness.lifecycleState");
  }
  validateRef(witness.fromEnvironmentRef, "environmentTransitionWitness.fromEnvironmentRef", { requireDigest: false });
  validateRef(witness.toEnvironmentRef, "environmentTransitionWitness.toEnvironmentRef", { requireDigest: false });
  validateRef(witness.authorizationRouteEnvelopeRef, "environmentTransitionWitness.authorizationRouteEnvelopeRef");
  validateRef(witness.topologyRef, "environmentTransitionWitness.topologyRef", { requireId: false, requireDigest: false });
  validateRef(witness.turnEnvironmentRef, "environmentTransitionWitness.turnEnvironmentRef", { requireId: false, requireDigest: false });
  validateRef(witness.toolRouteRef, "environmentTransitionWitness.toolRouteRef");
  requireString(witness.evidenceReturnContract, "environmentTransitionWitness.evidenceReturnContract");
  for (const flag of ["workspaceMutationAuthorized", "workspaceMutationPerformed", "providerTransportStarted", "toolSessionStarted", "liveEnvironmentSwitched"]) {
    if (witness[flag] !== false) throw validationError("direct_environment_transition_authority_leak", `environmentTransitionWitness.${flag}`);
  }
  for (const flag of ["rawRemotePayloadIncluded", "rawTopologyPayloadIncluded", "rawToolPayloadIncluded", "rawTextIncluded", "rawPathIncluded", "rawSecretIncluded"]) {
    if (witness[flag] === true) throw validationError("direct_environment_transition_raw_exposure", `environmentTransitionWitness.${flag}`);
  }
  validateDigest(witness, "witnessDigest", "direct-environment-transition-witness@1", "environmentTransitionWitness");
  return true;
}

function witnessRef(witness = {}) {
  return refFrom("environment_transition_witness", witness.witnessId, witness.witnessDigest, witness.lifecycleState, {
    transitionKind: normalizeString(witness.transitionKind, ""),
  });
}

function buildEnvironmentTransitionLifecycleRow(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const witness = source.witness || source.environmentTransitionWitness;
  validateEnvironmentTransitionWitness(witness);
  const lifecycleEvent = pickEnum(source.lifecycleEvent, ENVIRONMENT_TRANSITION_LIFECYCLE_EVENTS, witness.lifecycleState);
  const row = {
    schema: DIRECT_ENVIRONMENT_TRANSITION_LIFECYCLE_ROW_SCHEMA,
    rowId: normalizeId(source.rowId, "environment_transition_lifecycle_row"),
    sequence: Number.isInteger(source.sequence) && source.sequence > 0 ? source.sequence : 1,
    previousRowDigest: normalizeString(source.previousRowDigest, ""),
    lifecycleEvent,
    witnessRef: witnessRef(witness),
    authorizationRouteEnvelopeRef: witness.authorizationRouteEnvelopeRef,
    toolRouteRef: witness.toolRouteRef,
    fromEnvironmentRef: witness.fromEnvironmentRef,
    toEnvironmentRef: witness.toEnvironmentRef,
    resultSummary: normalizeString(source.resultSummary, lifecycleEvent),
    workspaceMutationAuthorized: false,
    workspaceMutationPerformed: false,
    providerTransportStarted: false,
    toolSessionStarted: false,
    liveEnvironmentSwitched: false,
    rawRemotePayloadIncluded: false,
    rawTopologyPayloadIncluded: false,
    rawToolPayloadIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    recordedAt: normalizeString(source.recordedAt, nowIso(options.now || Date.now)),
  };
  row.rowDigest = digestFor("direct-environment-transition-lifecycle-row@1", row);
  return row;
}

function validateEnvironmentTransitionLifecycleRow(row = {}) {
  requirePlainObject(row, "environmentTransitionLifecycleRow");
  if (row.schema !== DIRECT_ENVIRONMENT_TRANSITION_LIFECYCLE_ROW_SCHEMA) {
    throw validationError("direct_environment_transition_schema_mismatch", "environmentTransitionLifecycleRow");
  }
  requireString(row.rowId, "environmentTransitionLifecycleRow.rowId");
  if (!Number.isInteger(row.sequence) || row.sequence < 1) {
    throw validationError("direct_environment_transition_invalid_sequence", "environmentTransitionLifecycleRow.sequence");
  }
  if (!ENVIRONMENT_TRANSITION_LIFECYCLE_EVENTS.includes(row.lifecycleEvent)) {
    throw validationError("direct_environment_transition_invalid_lifecycle_event", "environmentTransitionLifecycleRow.lifecycleEvent");
  }
  validateRef(row.witnessRef, "environmentTransitionLifecycleRow.witnessRef");
  validateRef(row.authorizationRouteEnvelopeRef, "environmentTransitionLifecycleRow.authorizationRouteEnvelopeRef");
  validateRef(row.toolRouteRef, "environmentTransitionLifecycleRow.toolRouteRef");
  validateRef(row.fromEnvironmentRef, "environmentTransitionLifecycleRow.fromEnvironmentRef", { requireDigest: false });
  validateRef(row.toEnvironmentRef, "environmentTransitionLifecycleRow.toEnvironmentRef", { requireDigest: false });
  for (const flag of ["workspaceMutationAuthorized", "workspaceMutationPerformed", "providerTransportStarted", "toolSessionStarted", "liveEnvironmentSwitched"]) {
    if (row[flag] !== false) throw validationError("direct_environment_transition_authority_leak", `environmentTransitionLifecycleRow.${flag}`);
  }
  for (const flag of ["rawRemotePayloadIncluded", "rawTopologyPayloadIncluded", "rawToolPayloadIncluded", "rawTextIncluded", "rawPathIncluded", "rawSecretIncluded"]) {
    if (row[flag] === true) throw validationError("direct_environment_transition_raw_exposure", `environmentTransitionLifecycleRow.${flag}`);
  }
  validateDigest(row, "rowDigest", "direct-environment-transition-lifecycle-row@1", "environmentTransitionLifecycleRow");
  return true;
}

module.exports = {
  CROSS_ENV_ROUTE_STATUSES,
  DIRECT_CROSS_ENV_AUTHORIZATION_ROUTE_ENVELOPE_SCHEMA,
  DIRECT_ENVIRONMENT_TRANSITION_LIFECYCLE_ROW_SCHEMA,
  DIRECT_ENVIRONMENT_TRANSITION_WITNESS_SCHEMA,
  ENVIRONMENT_TRANSITION_KINDS,
  ENVIRONMENT_TRANSITION_LIFECYCLE_EVENTS,
  buildCrossEnvironmentAuthorizationRouteEnvelope,
  buildEnvironmentTransitionLifecycleRow,
  buildEnvironmentTransitionWitness,
  validateCrossEnvironmentAuthorizationRouteEnvelope,
  validateEnvironmentTransitionLifecycleRow,
  validateEnvironmentTransitionWitness,
};
