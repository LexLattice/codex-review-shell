"use strict";

const { canonicalJson, sha256 } = require("../meta-session/digest");
const {
  isPlainObject,
  normalizeId,
  normalizeString,
  nowIso,
} = require("../meta-session/ids");
const {
  validateCrossEnvironmentAuthorizationRouteEnvelope,
  validateEnvironmentTransitionWitness,
} = require("./environment-transition-witness");

const DIRECT_PLUGIN_SPECIALIST_WORKER_CONTRACT_SCHEMA = "direct_plugin_specialist_worker_contract@1";
const DIRECT_BROWSER_VERIFICATION_WORKER_SCAFFOLD_SCHEMA = "direct_browser_verification_worker_scaffold@1";
const DIRECT_PLUGIN_SPECIALIST_DELEGATION_PACKET_SCHEMA = "direct_plugin_specialist_delegation_packet@1";

const SPECIALIST_DELEGATION_STATUSES = Object.freeze([
  "ready_for_specialist_delegation",
  "authorization_missing",
  "authorization_remanded",
  "unsupported_route",
]);

const DEFAULT_BROWSER_FORBIDDEN_ACTIONS = Object.freeze([
  "workspace_file_mutation",
  "credential_extraction",
  "cookie_export",
  "unbounded_browser_automation",
  "plugin_install_or_update",
  "provider_transport_from_specialist_contract",
]);

const DIGEST_FIELDS = new Set([
  "contractDigest",
  "scaffoldDigest",
  "packetDigest",
]);

function validationError(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  if (detail) error.detail = detail;
  return error;
}

function requirePlainObject(value, label) {
  if (isPlainObject(value)) return value;
  throw validationError("direct_plugin_specialist_invalid_object", label);
}

function requireString(value, label) {
  const text = normalizeString(value, "");
  if (text) return text;
  throw validationError("direct_plugin_specialist_missing_string", label);
}

function requireArray(value, label) {
  if (Array.isArray(value)) return value;
  throw validationError("direct_plugin_specialist_missing_array", label);
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
    throw validationError("direct_plugin_specialist_digest_mismatch", `${label}.${fieldName}`);
  }
  return true;
}

function normalizeList(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => normalizeString(value, ""))
    .filter(Boolean))]
    .sort();
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
  if (ref.rawTextIncluded || ref.rawPathIncluded || ref.rawSecretIncluded) {
    throw validationError("direct_plugin_specialist_raw_ref_exposure", label);
  }
  return true;
}

function boundedText(value, fallback = "", maxLength = 360) {
  const text = normalizeString(value, fallback);
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 3))}...` : text;
}

function routeRowRef(routeRow = {}) {
  return refFrom("direct_environment_tool_route_row", routeRow.rowId, routeRow.rowDigest, routeRow.displayName || routeRow.toolId, {
    toolId: normalizeString(routeRow.toolId, ""),
    routeClass: normalizeString(routeRow.routeClass, ""),
    actionClass: normalizeString(routeRow.actionClass, ""),
  });
}

function authorizationRouteEnvelopeRef(envelope = {}) {
  return refFrom("cross_environment_authorization_route_envelope", envelope.envelopeId, envelope.envelopeDigest, envelope.routeStatus, {
    transitionKind: normalizeString(envelope.transitionKind, ""),
  });
}

function transitionWitnessRef(witness = null) {
  if (!witness) return null;
  return refFrom("environment_transition_witness", witness.witnessId, witness.witnessDigest, witness.lifecycleState, {
    transitionKind: normalizeString(witness.transitionKind, ""),
  });
}

function contractRef(contract = {}) {
  return refFrom("plugin_specialist_worker_contract", contract.contractId, contract.contractDigest, contract.targetAgentClass, {
    pluginFamily: normalizeString(contract.pluginFamily, ""),
    status: normalizeString(contract.status, ""),
  });
}

function scaffoldRef(scaffold = {}) {
  return refFrom("browser_verification_worker_scaffold", scaffold.scaffoldId, scaffold.scaffoldDigest, scaffold.targetAgentClass, {
    targetEnvironmentId: normalizeString(scaffold.targetEnvironmentId, ""),
  });
}

function evidenceReturnContract(input = {}) {
  const source = isPlainObject(input) ? input : {};
  return {
    allowedEvidenceKinds: normalizeList(source.allowedEvidenceKinds || [
      "browser_observation_summary",
      "screenshot_ref",
      "console_error_summary",
      "network_observation_summary",
    ]),
    rawPayloadAllowed: false,
    workspaceMutationAllowed: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function validateEvidenceReturnContract(contract, label = "evidenceReturnContract") {
  requirePlainObject(contract, label);
  requireArray(contract.allowedEvidenceKinds, `${label}.allowedEvidenceKinds`);
  if (contract.rawPayloadAllowed !== false || contract.workspaceMutationAllowed !== false) {
    throw validationError("direct_plugin_specialist_authority_leak", label);
  }
  if (contract.rawTextIncluded || contract.rawPathIncluded || contract.rawSecretIncluded) {
    throw validationError("direct_plugin_specialist_raw_exposure", label);
  }
  return true;
}

function routeMatchesEnvelope(routeRow = {}, envelope = null) {
  if (!envelope) return false;
  if (envelope.toolRouteRef?.id !== routeRow.rowId) return false;
  if (envelope.toolRouteRef?.digest !== routeRow.rowDigest) return false;
  if (envelope.toolId !== routeRow.toolId) return false;
  if (envelope.actionClass !== routeRow.actionClass) return false;
  return envelope.routeClass === routeRow.routeClass;
}

function statusFromEnvelope(routeRow = {}, envelope = null) {
  if (routeRow.routeClass !== "specialist_worker_required") return "unsupported_route";
  if (!envelope) return "authorization_missing";
  if (!routeMatchesEnvelope(routeRow, envelope)) return "authorization_remanded";
  if (envelope.routeStatus === "route_ready_for_authorization" && envelope.transitionKind === "specialist_worker_delegation") {
    return "ready_for_specialist_delegation";
  }
  if (envelope.routeStatus === "authorization_missing") return "authorization_missing";
  return "authorization_remanded";
}

function buildBrowserVerificationWorkerScaffold(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const scaffold = {
    schema: DIRECT_BROWSER_VERIFICATION_WORKER_SCAFFOLD_SCHEMA,
    scaffoldId: normalizeId(source.scaffoldId, "browser_verification_worker_scaffold"),
    targetAgentClass: normalizeString(source.targetAgentClass, "browser_verification_worker"),
    targetEnvironmentId: requireString(source.targetEnvironmentId, "browserVerificationWorker.targetEnvironmentId"),
    targetEnvironmentKind: normalizeString(source.targetEnvironmentKind, "windows"),
    pluginFamily: normalizeString(source.pluginFamily, "browser_control"),
    rolePurpose: boundedText(source.rolePurpose, "Verify browser-visible behavior in the browser-owning environment and return bounded evidence to the main worker.", 520),
    allowedTools: normalizeList(source.allowedTools || ["browser.open", "browser.inspect", "browser.screenshot", "browser.console"]),
    forbiddenActions: normalizeList(source.forbiddenActions || DEFAULT_BROWSER_FORBIDDEN_ACTIONS),
    expectedOutputShape: normalizeString(source.expectedOutputShape, "browser_verification_evidence_summary@1"),
    evidenceReturnContract: evidenceReturnContract(source.evidenceReturnContract),
    workerRuntimeEnabledInThisPr: false,
    pluginControlEnabledInThisPr: false,
    providerCallEnabledInThisPr: false,
    workspaceMutationAllowed: false,
    rawPromptIncluded: false,
    rawToolPayloadIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    createdAt: normalizeString(source.createdAt, nowIso(options.now || Date.now)),
  };
  scaffold.scaffoldDigest = digestFor("direct-browser-verification-worker-scaffold@1", scaffold);
  return scaffold;
}

function validateBrowserVerificationWorkerScaffold(scaffold) {
  requirePlainObject(scaffold, "browserVerificationWorkerScaffold");
  if (scaffold.schema !== DIRECT_BROWSER_VERIFICATION_WORKER_SCAFFOLD_SCHEMA) {
    throw validationError("direct_plugin_specialist_schema_mismatch", "browserVerificationWorkerScaffold");
  }
  requireString(scaffold.scaffoldId, "browserVerificationWorkerScaffold.scaffoldId");
  requireString(scaffold.targetAgentClass, "browserVerificationWorkerScaffold.targetAgentClass");
  requireString(scaffold.targetEnvironmentId, "browserVerificationWorkerScaffold.targetEnvironmentId");
  requireArray(scaffold.allowedTools, "browserVerificationWorkerScaffold.allowedTools");
  requireArray(scaffold.forbiddenActions, "browserVerificationWorkerScaffold.forbiddenActions");
  validateEvidenceReturnContract(scaffold.evidenceReturnContract, "browserVerificationWorkerScaffold.evidenceReturnContract");
  for (const flag of ["workerRuntimeEnabledInThisPr", "pluginControlEnabledInThisPr", "providerCallEnabledInThisPr", "workspaceMutationAllowed"]) {
    if (scaffold[flag] !== false) throw validationError("direct_plugin_specialist_authority_leak", `browserVerificationWorkerScaffold.${flag}`);
  }
  for (const flag of ["rawPromptIncluded", "rawToolPayloadIncluded", "rawTextIncluded", "rawPathIncluded", "rawSecretIncluded"]) {
    if (scaffold[flag]) throw validationError("direct_plugin_specialist_raw_exposure", `browserVerificationWorkerScaffold.${flag}`);
  }
  validateDigest(scaffold, "scaffoldDigest", "direct-browser-verification-worker-scaffold@1", "browserVerificationWorkerScaffold");
  return true;
}

function buildPluginSpecialistWorkerContract(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const routeRow = source.routeRow || source.toolRouteRow || {};
  const envelope = source.authorizationRouteEnvelope || source.envelope || null;
  if (envelope) validateCrossEnvironmentAuthorizationRouteEnvelope(envelope);
  const status = statusFromEnvelope(routeRow, envelope);
  const inputEvidenceRefs = [
    routeRowRef(routeRow),
    envelope ? authorizationRouteEnvelopeRef(envelope) : null,
    ...((Array.isArray(source.inputEvidenceRefs) ? source.inputEvidenceRefs : []).filter(Boolean)),
  ].filter(Boolean);
  const contract = {
    schema: DIRECT_PLUGIN_SPECIALIST_WORKER_CONTRACT_SCHEMA,
    contractId: normalizeId(source.contractId, "plugin_specialist_worker_contract"),
    sourceAgentId: normalizeId(source.sourceAgentId, "agent_main_worker"),
    targetAgentClass: normalizeString(source.targetAgentClass, "browser_verification_worker"),
    targetEnvironmentId: normalizeString(source.targetEnvironmentId || routeRow.ownerEnvironmentId, ""),
    pluginFamily: normalizeString(source.pluginFamily, "browser_control"),
    objective: boundedText(source.objective, "Verify the requested browser-visible behavior and return bounded evidence.", 720),
    allowedTools: normalizeList(source.allowedTools || ["browser.open", "browser.inspect", "browser.screenshot", "browser.console"]),
    forbiddenActions: normalizeList(source.forbiddenActions || DEFAULT_BROWSER_FORBIDDEN_ACTIONS),
    inputEvidenceRefs,
    expectedOutputShape: normalizeString(source.expectedOutputShape, "browser_verification_evidence_summary@1"),
    evidenceReturnContract: evidenceReturnContract(source.evidenceReturnContract),
    authorizationDecisionRef: envelope?.authorizationDecisionRef || null,
    status,
    blockerCodes: normalizeList([
      ...(Array.isArray(routeRow.blockerCodes) ? routeRow.blockerCodes : []),
      ...(status === "ready_for_specialist_delegation" ? [] : [status]),
      ...(normalizeString(routeRow.routeClass, "") === "specialist_worker_required" ? [] : ["route_not_specialist_worker"]),
      ...(envelope && !routeMatchesEnvelope(routeRow, envelope) ? ["authorization_route_mismatch"] : []),
    ]),
    routeRowRef: routeRowRef(routeRow),
    authorizationRouteEnvelopeRef: envelope ? authorizationRouteEnvelopeRef(envelope) : null,
    managerAuthorizationRequired: true,
    managerAuthorizationSatisfied: status === "ready_for_specialist_delegation",
    delegationMayProceedAsEvidence: status === "ready_for_specialist_delegation",
    workerRuntimeEnabledInThisPr: false,
    pluginControlEnabledInThisPr: false,
    providerCallEnabledInThisPr: false,
    workspaceMutationAllowed: false,
    rawObjectiveIncluded: false,
    rawToolPayloadIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    createdAt: normalizeString(source.createdAt, nowIso(options.now || Date.now)),
  };
  contract.contractDigest = digestFor("direct-plugin-specialist-worker-contract@1", contract);
  return contract;
}

function validatePluginSpecialistWorkerContract(contract) {
  requirePlainObject(contract, "pluginSpecialistWorkerContract");
  if (contract.schema !== DIRECT_PLUGIN_SPECIALIST_WORKER_CONTRACT_SCHEMA) {
    throw validationError("direct_plugin_specialist_schema_mismatch", "pluginSpecialistWorkerContract");
  }
  requireString(contract.contractId, "pluginSpecialistWorkerContract.contractId");
  requireString(contract.sourceAgentId, "pluginSpecialistWorkerContract.sourceAgentId");
  requireString(contract.targetAgentClass, "pluginSpecialistWorkerContract.targetAgentClass");
  requireString(contract.targetEnvironmentId, "pluginSpecialistWorkerContract.targetEnvironmentId");
  requireString(contract.pluginFamily, "pluginSpecialistWorkerContract.pluginFamily");
  requireArray(contract.allowedTools, "pluginSpecialistWorkerContract.allowedTools");
  requireArray(contract.forbiddenActions, "pluginSpecialistWorkerContract.forbiddenActions");
  requireArray(contract.inputEvidenceRefs, "pluginSpecialistWorkerContract.inputEvidenceRefs");
  contract.inputEvidenceRefs.forEach((ref, index) => validateRef(ref, `pluginSpecialistWorkerContract.inputEvidenceRefs.${index}`, { requireDigest: false }));
  validateRef(contract.routeRowRef, "pluginSpecialistWorkerContract.routeRowRef");
  if (contract.authorizationRouteEnvelopeRef) validateRef(contract.authorizationRouteEnvelopeRef, "pluginSpecialistWorkerContract.authorizationRouteEnvelopeRef");
  if (contract.authorizationDecisionRef) validateRef(contract.authorizationDecisionRef, "pluginSpecialistWorkerContract.authorizationDecisionRef");
  validateEvidenceReturnContract(contract.evidenceReturnContract, "pluginSpecialistWorkerContract.evidenceReturnContract");
  if (!SPECIALIST_DELEGATION_STATUSES.includes(contract.status)) {
    throw validationError("direct_plugin_specialist_invalid_status", "pluginSpecialistWorkerContract.status");
  }
  if (contract.status === "ready_for_specialist_delegation" && (!contract.authorizationDecisionRef || contract.blockerCodes.length)) {
    throw validationError("direct_plugin_specialist_status_conflict", "pluginSpecialistWorkerContract.status");
  }
  for (const flag of ["workerRuntimeEnabledInThisPr", "pluginControlEnabledInThisPr", "providerCallEnabledInThisPr", "workspaceMutationAllowed"]) {
    if (contract[flag] !== false) throw validationError("direct_plugin_specialist_authority_leak", `pluginSpecialistWorkerContract.${flag}`);
  }
  for (const flag of ["rawObjectiveIncluded", "rawToolPayloadIncluded", "rawTextIncluded", "rawPathIncluded", "rawSecretIncluded"]) {
    if (contract[flag]) throw validationError("direct_plugin_specialist_raw_exposure", `pluginSpecialistWorkerContract.${flag}`);
  }
  validateDigest(contract, "contractDigest", "direct-plugin-specialist-worker-contract@1", "pluginSpecialistWorkerContract");
  return true;
}

function buildPluginSpecialistDelegationPacket(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const contract = source.contract || source.pluginSpecialistWorkerContract || buildPluginSpecialistWorkerContract(source, options);
  validatePluginSpecialistWorkerContract(contract);
  const scaffold = source.scaffold || source.browserVerificationWorkerScaffold || buildBrowserVerificationWorkerScaffold({
    targetEnvironmentId: contract.targetEnvironmentId,
    pluginFamily: contract.pluginFamily,
    allowedTools: contract.allowedTools,
    forbiddenActions: contract.forbiddenActions,
    evidenceReturnContract: contract.evidenceReturnContract,
  }, options);
  const transitionWitness = source.transitionWitness || source.environmentTransitionWitness || null;
  validateBrowserVerificationWorkerScaffold(scaffold);
  if (transitionWitness) validateEnvironmentTransitionWitness(transitionWitness);
  const packet = {
    schema: DIRECT_PLUGIN_SPECIALIST_DELEGATION_PACKET_SCHEMA,
    packetId: normalizeId(source.packetId, "plugin_specialist_delegation_packet"),
    parentTurnId: normalizeString(source.parentTurnId || source.turnId, ""),
    workThreadId: normalizeString(source.workThreadId, ""),
    sourceAgentId: contract.sourceAgentId,
    targetAgentClass: contract.targetAgentClass,
    targetEnvironmentId: contract.targetEnvironmentId,
    pluginFamily: contract.pluginFamily,
    contractRef: contractRef(contract),
    scaffoldRef: scaffoldRef(scaffold),
    transitionWitnessRef: transitionWitnessRef(transitionWitness),
    objectivePreview: boundedText(contract.objective, "", 240),
    expectedOutputShape: contract.expectedOutputShape,
    evidenceReturnContract: contract.evidenceReturnContract,
    status: contract.status === "ready_for_specialist_delegation" ? "ready_for_worker_start_transition" : "blocked",
    blockerCodes: contract.blockerCodes,
    workerStartTransitionRequired: true,
    workerRuntimeEnabledInThisPr: false,
    specialistProviderCallAllowed: false,
    pluginControlEnabledInThisPr: false,
    workspaceMutationAllowed: false,
    evidenceReturnOnly: true,
    childDialogueFlattenedIntoPrimary: false,
    rawObjectiveIncluded: false,
    rawToolPayloadIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    createdAt: normalizeString(source.createdAt, nowIso(options.now || Date.now)),
  };
  packet.packetDigest = digestFor("direct-plugin-specialist-delegation-packet@1", packet);
  return packet;
}

function validatePluginSpecialistDelegationPacket(packet) {
  requirePlainObject(packet, "pluginSpecialistDelegationPacket");
  if (packet.schema !== DIRECT_PLUGIN_SPECIALIST_DELEGATION_PACKET_SCHEMA) {
    throw validationError("direct_plugin_specialist_schema_mismatch", "pluginSpecialistDelegationPacket");
  }
  requireString(packet.packetId, "pluginSpecialistDelegationPacket.packetId");
  requireString(packet.sourceAgentId, "pluginSpecialistDelegationPacket.sourceAgentId");
  requireString(packet.targetAgentClass, "pluginSpecialistDelegationPacket.targetAgentClass");
  requireString(packet.targetEnvironmentId, "pluginSpecialistDelegationPacket.targetEnvironmentId");
  validateRef(packet.contractRef, "pluginSpecialistDelegationPacket.contractRef");
  validateRef(packet.scaffoldRef, "pluginSpecialistDelegationPacket.scaffoldRef");
  if (packet.transitionWitnessRef) validateRef(packet.transitionWitnessRef, "pluginSpecialistDelegationPacket.transitionWitnessRef");
  validateEvidenceReturnContract(packet.evidenceReturnContract, "pluginSpecialistDelegationPacket.evidenceReturnContract");
  if (!["ready_for_worker_start_transition", "blocked"].includes(packet.status)) {
    throw validationError("direct_plugin_specialist_invalid_status", "pluginSpecialistDelegationPacket.status");
  }
  for (const flag of ["workerRuntimeEnabledInThisPr", "specialistProviderCallAllowed", "pluginControlEnabledInThisPr", "workspaceMutationAllowed", "childDialogueFlattenedIntoPrimary"]) {
    if (packet[flag] !== false) throw validationError("direct_plugin_specialist_authority_leak", `pluginSpecialistDelegationPacket.${flag}`);
  }
  if (packet.evidenceReturnOnly !== true || packet.workerStartTransitionRequired !== true) {
    throw validationError("direct_plugin_specialist_contract_violation", "pluginSpecialistDelegationPacket.evidenceReturnOnly");
  }
  for (const flag of ["rawObjectiveIncluded", "rawToolPayloadIncluded", "rawTextIncluded", "rawPathIncluded", "rawSecretIncluded"]) {
    if (packet[flag]) throw validationError("direct_plugin_specialist_raw_exposure", `pluginSpecialistDelegationPacket.${flag}`);
  }
  validateDigest(packet, "packetDigest", "direct-plugin-specialist-delegation-packet@1", "pluginSpecialistDelegationPacket");
  return true;
}

module.exports = {
  DEFAULT_BROWSER_FORBIDDEN_ACTIONS,
  DIRECT_BROWSER_VERIFICATION_WORKER_SCAFFOLD_SCHEMA,
  DIRECT_PLUGIN_SPECIALIST_DELEGATION_PACKET_SCHEMA,
  DIRECT_PLUGIN_SPECIALIST_WORKER_CONTRACT_SCHEMA,
  SPECIALIST_DELEGATION_STATUSES,
  buildBrowserVerificationWorkerScaffold,
  buildPluginSpecialistDelegationPacket,
  buildPluginSpecialistWorkerContract,
  validateBrowserVerificationWorkerScaffold,
  validatePluginSpecialistDelegationPacket,
  validatePluginSpecialistWorkerContract,
};
