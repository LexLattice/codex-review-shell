"use strict";

const crypto = require("node:crypto");
const {
  LIFECYCLE_CONTROL_ACTIONS,
  buildSubAgentInteractionPolicyEnvelope,
  validateSubAgentInteractionPolicyEnvelope,
} = require("./sub-agent-interaction-policy");
const {
  buildAgentThreadGraph,
} = require("./runtime-substrate");

const SUB_AGENT_LIFECYCLE_CONTROL_PLAN_SCHEMA = "sub_agent_lifecycle_control_plan@1";
const SUB_AGENT_LIFECYCLE_AUTHORITY_DECISION_SCHEMA = "sub_agent_lifecycle_authority_decision@1";
const SUB_AGENT_LIFECYCLE_PROVIDER_SUPPORT_WITNESS_SCHEMA = "sub_agent_lifecycle_provider_support_witness@1";
const AGENT_LIFECYCLE_TRANSITION_LEDGER_SCHEMA = "agent_lifecycle_transition_ledger@1";
const AGENT_CANCELLATION_WITNESS_SCHEMA = "agent_cancellation_witness@1";
const AGENT_RESUME_VIABILITY_WITNESS_SCHEMA = "agent_resume_viability_witness@1";
const SUB_AGENT_LIFECYCLE_CONTROL_RESULT_ENVELOPE_SCHEMA = "sub_agent_lifecycle_control_result_envelope@1";
const SUB_AGENT_LIFECYCLE_CONTROL_RESIDENT_WITNESS_SCHEMA = "sub_agent_lifecycle_control_resident_witness@1";
const SUB_AGENT_LIFECYCLE_CONTROL_PACKET_SCHEMA = "sub_agent_lifecycle_control_packet@1";

const LIFECYCLE_ACTIONS = Object.freeze(["close_agent", "interrupt_agent", "resume_agent"]);
const TERMINAL_STATES = Object.freeze(["completed", "failed", "interrupted", "closed", "cancelled", "timeout"]);
const RESUMABLE_STATES = Object.freeze(["interrupted", "cancelled", "timeout"]);
const ACTIVE_STATES = Object.freeze(["starting", "running", "idle", "waiting"]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedString(value, maxLength = 320) {
  const text = normalizeString(value, "");
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…` : text;
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function stableStringify(value) {
  if (value && typeof value.toJSON === "function") return stableStringify(value.toJSON());
  if (value === null) return "null";
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return undefined;
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => {
      const serialized = stableStringify(entry);
      return serialized === undefined ? "null" : serialized;
    }).join(",")}]`;
  }
  return `{${Object.keys(value)
    .filter((key) => !key.endsWith("Digest") && stableStringify(value[key]) !== undefined)
    .sort()
    .map((key) => {
      const serialized = stableStringify(value[key]);
      return serialized === undefined ? "" : `${JSON.stringify(key)}:${serialized}`;
    })
    .filter(Boolean)
    .join(",")}}`;
}

function digestFor(domain, value) {
  return `sha256:${crypto.createHash("sha256").update(`${domain}\0${stableStringify(value)}`).digest("hex")}`;
}

function nowIso(nowMs) {
  const ms = typeof nowMs === "number" && Number.isFinite(nowMs) ? nowMs : Date.now();
  return new Date(ms).toISOString();
}

function normalizeEvidenceRef(input = {}, fallbackKind = "sub_agent_lifecycle_control") {
  const source = isPlainObject(input) ? input : {};
  const ref = {
    kind: boundedString(source.kind || source.refKind || fallbackKind, 80),
    id: boundedString(source.id || source.refId || source.artifactId, 160),
    digest: boundedString(source.digest || source.refDigest || source.artifactDigest, 180),
    label: boundedString(source.label || source.rendererSafeLabel || fallbackKind, 180),
    confidence: boundedString(source.confidence || source.sourceConfidence || "harness_observed", 80),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    rawProviderPayloadIncluded: false,
  };
  ref.refDigest = digestFor("sub-agent-lifecycle-control-evidence-ref@1", ref);
  return ref;
}

function normalizeEvidenceRefs(values, fallbackKind = "sub_agent_lifecycle_control") {
  const refs = arrayOrEmpty(values)
    .filter(isPlainObject)
    .map((value) => normalizeEvidenceRef(value, fallbackKind));
  return refs.length ? refs : [normalizeEvidenceRef({ kind: fallbackKind, id: fallbackKind, label: fallbackKind }, fallbackKind)];
}

function graphNodes(graph) {
  return arrayOrEmpty(graph?.nodes);
}

function findTargetNode(graph, targetAgentId) {
  const safeTarget = normalizeString(targetAgentId, "");
  return graphNodes(graph).find((node) => normalizeString(node.agentThreadId || node.childAgentId, "") === safeTarget) || null;
}

function lifecycleForNode(node) {
  return normalizeString(node?.lifecycleStatus || node?.lifecycleState || node?.nodeState, node ? "unknown" : "not_found");
}

function normalizeLifecycleAction(value) {
  const action = normalizeString(value, "close_agent");
  return LIFECYCLE_ACTIONS.includes(action) ? action : action;
}

function targetIsStale(input, node) {
  return input.targetStale === true || input.stale === true || lifecycleForNode(node) === "stale" || !node;
}

function transitionAfterState(action, beforeState) {
  if (action === "close_agent") return "closed";
  if (action === "interrupt_agent") return "interrupted";
  if (action === "resume_agent") return "running";
  return beforeState || "unknown";
}

function lifecycleBlockers(action, beforeState, targetStaleFlag) {
  const blockers = [];
  if (targetStaleFlag) blockers.push("target_stale_or_not_found");
  if (!LIFECYCLE_ACTIONS.includes(action)) blockers.push("invalid_lifecycle_action");
  if (action === "interrupt_agent" && TERMINAL_STATES.includes(beforeState)) blockers.push("terminal_target_not_interruptible");
  if (action === "resume_agent" && !RESUMABLE_STATES.includes(beforeState)) blockers.push("target_not_resumable");
  if (action === "close_agent" && beforeState === "closed") blockers.push("close_already_terminal_idempotent");
  if (action === "close_agent" && beforeState === "not_found") blockers.push("target_not_found");
  return blockers;
}

function buildLifecycleControlPlan(input = {}, { graph, targetNode, generatedAt }) {
  const action = normalizeLifecycleAction(input.action || input.writeKind || input.lifecycleAction);
  const targetAgentId = normalizeString(input.targetAgentId || input.childAgentId || input.agentThreadId, "");
  const beforeLifecycleState = normalizeString(input.targetLifecycleState || input.beforeLifecycleState, lifecycleForNode(targetNode));
  const stale = targetIsStale(input, targetNode) || beforeLifecycleState === "stale";
  const plan = {
    schema: SUB_AGENT_LIFECYCLE_CONTROL_PLAN_SCHEMA,
    planId: normalizeString(input.planId, ""),
    action,
    projectId: normalizeString(input.projectId || graph.projectId, ""),
    workThreadId: normalizeString(input.workThreadId, ""),
    primaryThreadId: normalizeString(input.primaryThreadId || graph.primaryThreadId, ""),
    graphId: normalizeString(graph.graphId, ""),
    actorKind: normalizeString(input.actorKind, "operator"),
    actorId: normalizeString(input.actorId, "operator"),
    targetAgentId,
    targetExists: Boolean(targetNode),
    targetStale: stale,
    beforeLifecycleState,
    requestedAfterLifecycleState: transitionAfterState(action, beforeLifecycleState),
    closeMode: action === "close_agent" ? normalizeString(input.closeMode, "graceful") : "",
    idempotencyKey: normalizeString(input.idempotencyKey, ""),
    providerSupportRequired: true,
    operatorGated: true,
    residentCallable: false,
    childToolInheritanceAllowed: false,
    recursiveSpawnAllowed: false,
    childTranscriptPromotionAllowed: false,
    generatedAt,
    evidenceRefs: normalizeEvidenceRefs(input.evidenceRefs, "sub_agent_lifecycle_control_plan"),
    rawPolicyPayloadIncluded: false,
    rawProviderPayloadIncluded: false,
    rawChildTranscriptIncluded: false,
  };
  plan.idempotencyKey = plan.idempotencyKey || digestFor("sub-agent-lifecycle-control-idempotency-key@1", {
    action,
    projectId: plan.projectId,
    workThreadId: plan.workThreadId,
    actorKind: plan.actorKind,
    targetAgentId,
    beforeLifecycleState,
  });
  plan.planId = plan.planId || `sub_agent_lifecycle_plan_${digestFor("sub-agent-lifecycle-control-plan-id@1", plan).slice(7, 23)}`;
  plan.planDigest = digestFor("sub-agent-lifecycle-control-plan@1", plan);
  return plan;
}

function buildProviderSupportWitness(input = {}, { plan, generatedAt }) {
  const support = isPlainObject(input.providerSupport) ? input.providerSupport : {};
  const supported = support.supported === true || input.providerSupportsLifecycleControl === true;
  const closeModes = arrayOrEmpty(support.closeModes || input.closeModes).map((mode) => normalizeString(mode, "")).filter(Boolean);
  const witness = {
    schema: SUB_AGENT_LIFECYCLE_PROVIDER_SUPPORT_WITNESS_SCHEMA,
    witnessId: normalizeString(support.witnessId, ""),
    action: plan.action,
    targetAgentId: plan.targetAgentId,
    supportState: supported ? "supported" : normalizeString(support.supportState, "unsupported"),
    providerPrimitive: supported ? normalizeString(support.providerPrimitive || input.providerPrimitive, `${plan.action}_provider_primitive`) : "",
    closeModeRows: plan.action === "close_agent"
      ? (closeModes.length ? closeModes : ["graceful"]).map((mode) => ({
        mode,
        supported: supported && mode === plan.closeMode,
        selected: mode === plan.closeMode,
      }))
      : [],
    providerTransportMayStart: supported,
    simulatedSuccessAllowed: false,
    rawProviderPayloadIncluded: false,
    generatedAt,
    evidenceRefs: normalizeEvidenceRefs(support.evidenceRefs || input.providerSupportEvidenceRefs, "sub_agent_lifecycle_provider_support"),
  };
  witness.witnessId = witness.witnessId || `sub_agent_lifecycle_support_${digestFor("sub-agent-lifecycle-support-id@1", witness).slice(7, 23)}`;
  witness.witnessDigest = digestFor("sub-agent-lifecycle-provider-support-witness@1", witness);
  return witness;
}

function buildCancellationWitness({ plan, authorityDecision, generatedAt }) {
  const witness = {
    schema: AGENT_CANCELLATION_WITNESS_SCHEMA,
    witnessId: `agent_cancellation_${digestFor("agent-cancellation-witness-id@1", {
      planId: plan.planId,
      action: plan.action,
    }).slice(7, 23)}`,
    action: plan.action,
    targetAgentId: plan.targetAgentId,
    cancellationKind: plan.action === "close_agent" ? "close" : plan.action === "interrupt_agent" ? "interrupt" : "not_cancellation",
    applicable: ["close_agent", "interrupt_agent"].includes(plan.action),
    providerCancellationAllowed: authorityDecision.finalDecision === "allow" && ["close_agent", "interrupt_agent"].includes(plan.action),
    idempotentNoop: authorityDecision.finalDecision === "idempotent_noop",
    generatedAt,
    rawProviderPayloadIncluded: false,
  };
  witness.witnessDigest = digestFor("agent-cancellation-witness@1", witness);
  return witness;
}

function buildResumeViabilityWitness({ plan, authorityDecision, generatedAt }) {
  const witness = {
    schema: AGENT_RESUME_VIABILITY_WITNESS_SCHEMA,
    witnessId: `agent_resume_viability_${digestFor("agent-resume-viability-witness-id@1", {
      planId: plan.planId,
      beforeLifecycleState: plan.beforeLifecycleState,
    }).slice(7, 23)}`,
    targetAgentId: plan.targetAgentId,
    beforeLifecycleState: plan.beforeLifecycleState,
    resumableStates: [...RESUMABLE_STATES],
    applicable: plan.action === "resume_agent",
    viable: authorityDecision.finalDecision === "allow" && plan.action === "resume_agent",
    blockerCodes: plan.action === "resume_agent" ? authorityDecision.blockerCodes : [],
    generatedAt,
    rawProviderPayloadIncluded: false,
  };
  witness.witnessDigest = digestFor("agent-resume-viability-witness@1", witness);
  return witness;
}

function buildAuthorityDecision({ plan, policyEnvelope, providerSupportWitness, generatedAt }) {
  const blockers = [];
  let policyValid = false;
  try {
    validateSubAgentInteractionPolicyEnvelope(policyEnvelope);
    policyValid = true;
  } catch (error) {
    blockers.push("policy_envelope_invalid");
  }
  if (!plan.workThreadId) blockers.push("missing_work_thread_scope");
  if (!plan.targetAgentId) blockers.push("missing_stable_child_id");
  if (!plan.targetExists) blockers.push("target_not_found");
  if (plan.actorKind !== "operator") blockers.push("operator_required_for_lifecycle_control");
  if (!policyValid || !arrayOrEmpty(policyEnvelope?.allowedActions).includes(plan.action)) blockers.push("policy_blocks_lifecycle_action");
  if (!policyValid || policyEnvelope?.targetId !== plan.targetAgentId) blockers.push("policy_target_mismatch");
  blockers.push(...lifecycleBlockers(plan.action, plan.beforeLifecycleState, plan.targetStale)
    .filter((code) => code !== "close_already_terminal_idempotent"));
  const idempotentNoop = plan.action === "close_agent" && plan.beforeLifecycleState === "closed" && plan.targetExists && !plan.targetStale;
  if (providerSupportWitness.supportState !== "supported" && !idempotentNoop) blockers.push("provider_lifecycle_control_unsupported");
  const finalDecision = blockers.length ? "block" : idempotentNoop ? "idempotent_noop" : "allow";
  const decision = {
    schema: SUB_AGENT_LIFECYCLE_AUTHORITY_DECISION_SCHEMA,
    decisionId: `sub_agent_lifecycle_authority_${digestFor("sub-agent-lifecycle-authority-id@1", {
      planId: plan.planId,
      policyDigest: policyEnvelope?.policyDigest,
    }).slice(7, 23)}`,
    action: plan.action,
    finalDecision,
    blockerCodes: blockers,
    actorKind: plan.actorKind,
    targetAgentId: plan.targetAgentId,
    workThreadId: plan.workThreadId,
    planId: plan.planId,
    planDigest: plan.planDigest,
    policyId: normalizeString(policyEnvelope?.policyId, ""),
    policyDigest: normalizeString(policyEnvelope?.policyDigest, ""),
    providerSupportWitnessId: providerSupportWitness.witnessId,
    providerSupportWitnessDigest: providerSupportWitness.witnessDigest,
    providerTransportAllowed: finalDecision === "allow",
    lifecycleMutationAllowed: finalDecision === "allow",
    residentCallable: false,
    operatorGated: true,
    simulatedSuccessAllowed: false,
    generatedAt,
    rawPolicyPayloadIncluded: false,
    rawProviderPayloadIncluded: false,
    rawChildTranscriptIncluded: false,
  };
  decision.decisionDigest = digestFor("sub-agent-lifecycle-authority-decision@1", decision);
  return decision;
}

function buildTransitionLedger({ plan, authorityDecision, providerSupportWitness, generatedAt }) {
  const beforeState = plan.beforeLifecycleState;
  const providerAttempted = authorityDecision.finalDecision === "allow";
  const afterState = authorityDecision.finalDecision === "allow"
    ? plan.requestedAfterLifecycleState
    : authorityDecision.finalDecision === "idempotent_noop" ? beforeState : beforeState;
  const status = authorityDecision.finalDecision === "allow"
    ? "completed"
    : authorityDecision.finalDecision === "idempotent_noop" ? "idempotent_noop" : providerSupportWitness.supportState === "unsupported" ? "unsupported" : "blocked";
  const ledger = {
    schema: AGENT_LIFECYCLE_TRANSITION_LEDGER_SCHEMA,
    ledgerRowId: `agent_lifecycle_transition_${digestFor("agent-lifecycle-transition-ledger-id@1", {
      planId: plan.planId,
      decisionDigest: authorityDecision.decisionDigest,
      beforeState,
      afterState,
    }).slice(7, 23)}`,
    action: plan.action,
    status,
    projectId: plan.projectId,
    workThreadId: plan.workThreadId,
    primaryThreadId: plan.primaryThreadId,
    targetAgentId: plan.targetAgentId,
    beforeLifecycleState: beforeState,
    afterLifecycleState: afterState,
    providerAttempted,
    providerPrimitive: providerAttempted ? providerSupportWitness.providerPrimitive : "",
    authorityDecisionId: authorityDecision.decisionId,
    authorityDecisionDigest: authorityDecision.decisionDigest,
    providerSupportWitnessId: providerSupportWitness.witnessId,
    providerSupportWitnessDigest: providerSupportWitness.witnessDigest,
    generatedAt,
    providerTransportStarted: providerAttempted,
    lifecycleMutationStarted: providerAttempted,
    simulatedSuccessStarted: false,
    rawProviderPayloadIncluded: false,
    rawChildTranscriptIncluded: false,
  };
  ledger.ledgerDigest = digestFor("agent-lifecycle-transition-ledger@1", ledger);
  return ledger;
}

function buildResultEnvelope({ plan, authorityDecision, transitionLedger, cancellationWitness, resumeViabilityWitness, generatedAt }) {
  const result = {
    schema: SUB_AGENT_LIFECYCLE_CONTROL_RESULT_ENVELOPE_SCHEMA,
    resultEnvelopeId: `sub_agent_lifecycle_result_${digestFor("sub-agent-lifecycle-result-id@1", {
      planId: plan.planId,
      ledgerDigest: transitionLedger.ledgerDigest,
    }).slice(7, 23)}`,
    action: plan.action,
    status: transitionLedger.status,
    blockerCodes: authorityDecision.blockerCodes,
    targetAgentId: plan.targetAgentId,
    workThreadId: plan.workThreadId,
    beforeLifecycleState: transitionLedger.beforeLifecycleState,
    afterLifecycleState: transitionLedger.afterLifecycleState,
    authorityDecisionId: authorityDecision.decisionId,
    authorityDecisionDigest: authorityDecision.decisionDigest,
    transitionLedgerRowId: transitionLedger.ledgerRowId,
    transitionLedgerDigest: transitionLedger.ledgerDigest,
    cancellationWitnessId: cancellationWitness.witnessId,
    cancellationWitnessDigest: cancellationWitness.witnessDigest,
    resumeViabilityWitnessId: resumeViabilityWitness.witnessId,
    resumeViabilityWitnessDigest: resumeViabilityWitness.witnessDigest,
    providerTransportStarted: transitionLedger.providerTransportStarted,
    lifecycleMutationStarted: transitionLedger.lifecycleMutationStarted,
    simulatedSuccessStarted: false,
    residentCallableLifecycleAction: false,
    generatedAt,
    rawPolicyPayloadIncluded: false,
    rawProviderPayloadIncluded: false,
    rawChildTranscriptIncluded: false,
  };
  result.resultDigest = digestFor("sub-agent-lifecycle-control-result-envelope@1", result);
  return result;
}

function buildResidentWitnessRows({ plan, authorityDecision, providerSupportWitness, transitionLedger, resultEnvelope, generatedAt }) {
  return ["authority", "provider_support", "transition", "operator_projection"].map((kind) => {
    const row = {
      schema: SUB_AGENT_LIFECYCLE_CONTROL_RESIDENT_WITNESS_SCHEMA,
      witnessRowId: `sub_agent_lifecycle_resident_${kind}_${digestFor("sub-agent-lifecycle-resident-witness-id@1", {
        kind,
        resultEnvelopeId: resultEnvelope.resultEnvelopeId,
      }).slice(7, 23)}`,
      kind,
      action: plan.action,
      targetAgentId: plan.targetAgentId,
      workThreadId: plan.workThreadId,
      status: resultEnvelope.status,
      rendererSafeSummary: kind === "authority"
        ? `Lifecycle authority ${authorityDecision.finalDecision} for ${plan.action}`
        : kind === "provider_support"
          ? `Provider lifecycle support ${providerSupportWitness.supportState}`
          : kind === "transition"
            ? `Lifecycle ${transitionLedger.beforeLifecycleState} -> ${transitionLedger.afterLifecycleState}`
            : "Lifecycle controls are operator-gated; resident-callable mutation remains disabled",
      residentCallable: false,
      operatorGated: true,
      evidenceRefs: normalizeEvidenceRefs([{
        kind: `sub_agent_lifecycle_${kind}`,
        id: kind === "authority" ? authorityDecision.decisionId : kind === "provider_support" ? providerSupportWitness.witnessId : transitionLedger.ledgerRowId,
        digest: kind === "authority" ? authorityDecision.decisionDigest : kind === "provider_support" ? providerSupportWitness.witnessDigest : transitionLedger.ledgerDigest,
        label: `Sub-agent lifecycle ${kind}`,
      }], `sub_agent_lifecycle_${kind}`),
      generatedAt,
      rawPolicyPayloadIncluded: false,
      rawProviderPayloadIncluded: false,
      rawChildTranscriptIncluded: false,
    };
    row.witnessDigest = digestFor("sub-agent-lifecycle-resident-witness@1", row);
    return row;
  });
}

function buildSubAgentLifecycleControlPacket(input = {}, options = {}) {
  const generatedAt = nowIso(options.nowMs || input.nowMs);
  const graph = isPlainObject(input.graph) ? input.graph : buildAgentThreadGraph(input);
  const targetAgentId = normalizeString(input.targetAgentId || input.childAgentId || input.agentThreadId, "");
  const targetNode = findTargetNode(graph, targetAgentId);
  const plan = buildLifecycleControlPlan(input, { graph, targetNode, generatedAt });
  const policyEnvelope = isPlainObject(input.policyEnvelope)
    ? input.policyEnvelope
    : buildSubAgentInteractionPolicyEnvelope({
      actorKind: input.actorKind || "operator",
      actorId: input.actorId || "operator",
      targetKind: "child_agent",
      targetId: targetAgentId,
      scope: input.scope || "single_child",
      policy: input.policy || "lifecycle_operator_gated",
      otherwiseAuthorizedActions: input.otherwiseAuthorizedActions || ["list_agents", "inspect_agent", "status_agent", "wait_agent", plan.action],
      sourceRefs: input.policySourceRefs || input.evidenceRefs,
    }, { now: options.nowMs || input.nowMs });
  const providerSupportWitness = buildProviderSupportWitness(input, { plan, generatedAt });
  const authorityDecision = buildAuthorityDecision({ plan, policyEnvelope, providerSupportWitness, generatedAt });
  const transitionLedger = buildTransitionLedger({ plan, authorityDecision, providerSupportWitness, generatedAt });
  const cancellationWitness = buildCancellationWitness({ plan, authorityDecision, generatedAt });
  const resumeViabilityWitness = buildResumeViabilityWitness({ plan, authorityDecision, generatedAt });
  const resultEnvelope = buildResultEnvelope({
    plan,
    authorityDecision,
    transitionLedger,
    cancellationWitness,
    resumeViabilityWitness,
    generatedAt,
  });
  const residentWitnessRows = buildResidentWitnessRows({
    plan,
    authorityDecision,
    providerSupportWitness,
    transitionLedger,
    resultEnvelope,
    generatedAt,
  });
  const packet = {
    schema: SUB_AGENT_LIFECYCLE_CONTROL_PACKET_SCHEMA,
    packetId: `sub_agent_lifecycle_control_${digestFor("sub-agent-lifecycle-control-packet-id@1", {
      planId: plan.planId,
      resultDigest: resultEnvelope.resultDigest,
    }).slice(7, 23)}`,
    action: plan.action,
    plan,
    policyEnvelope,
    authorityDecision,
    providerSupportWitness,
    transitionLedger,
    cancellationWitness,
    resumeViabilityWitness,
    resultEnvelope,
    residentWitnessRows,
    generatedAt,
    rawPolicyPayloadIncluded: false,
    rawProviderPayloadIncluded: false,
    rawChildTranscriptIncluded: false,
  };
  packet.packetDigest = digestFor("sub-agent-lifecycle-control-packet@1", packet);
  validateSubAgentLifecycleControlPacket(packet);
  return packet;
}

function validateSubAgentLifecycleControlPacket(packet = {}) {
  const errors = [];
  if (!isPlainObject(packet)) throw new Error("sub_agent_lifecycle_control_packet_invalid_object");
  if (packet.schema !== SUB_AGENT_LIFECYCLE_CONTROL_PACKET_SCHEMA) throw new Error("sub_agent_lifecycle_control_packet_schema_mismatch");
  const decisionBlockers = arrayOrEmpty(packet.authorityDecision?.blockerCodes);
  const invalidActionBlocked = !LIFECYCLE_ACTIONS.includes(packet.action) &&
    packet.authorityDecision?.finalDecision === "block" &&
    decisionBlockers.includes("invalid_lifecycle_action");
  if (!LIFECYCLE_ACTIONS.includes(packet.action) && !invalidActionBlocked) errors.push(`invalid_lifecycle_action:${packet.action || ""}`);
  if (packet.plan?.schema !== SUB_AGENT_LIFECYCLE_CONTROL_PLAN_SCHEMA) errors.push("plan_schema_mismatch");
  if (packet.authorityDecision?.schema !== SUB_AGENT_LIFECYCLE_AUTHORITY_DECISION_SCHEMA) errors.push("authority_decision_schema_mismatch");
  if (packet.providerSupportWitness?.schema !== SUB_AGENT_LIFECYCLE_PROVIDER_SUPPORT_WITNESS_SCHEMA) errors.push("provider_support_schema_mismatch");
  if (packet.transitionLedger?.schema !== AGENT_LIFECYCLE_TRANSITION_LEDGER_SCHEMA) errors.push("transition_ledger_schema_mismatch");
  if (packet.cancellationWitness?.schema !== AGENT_CANCELLATION_WITNESS_SCHEMA) errors.push("cancellation_witness_schema_mismatch");
  if (packet.resumeViabilityWitness?.schema !== AGENT_RESUME_VIABILITY_WITNESS_SCHEMA) errors.push("resume_viability_witness_schema_mismatch");
  if (packet.resultEnvelope?.schema !== SUB_AGENT_LIFECYCLE_CONTROL_RESULT_ENVELOPE_SCHEMA) errors.push("result_envelope_schema_mismatch");
  try {
    validateSubAgentInteractionPolicyEnvelope(packet.policyEnvelope);
  } catch (error) {
    if (packet.authorityDecision?.finalDecision !== "block" || !decisionBlockers.includes("policy_envelope_invalid")) {
      errors.push(`policy_envelope_invalid:${error.message}`);
    }
  }
  for (const field of ["rawPolicyPayloadIncluded", "rawProviderPayloadIncluded", "rawChildTranscriptIncluded"]) {
    if (packet[field] !== false) errors.push(`packet_raw_exposure_leak:${field}`);
    if (packet.plan?.[field] !== false) errors.push(`plan_raw_exposure_leak:${field}`);
    if (packet.resultEnvelope?.[field] !== false) errors.push(`result_raw_exposure_leak:${field}`);
  }
  if (packet.plan?.residentCallable !== false || packet.resultEnvelope?.residentCallableLifecycleAction !== false) {
    errors.push("resident_callable_lifecycle_leak");
  }
  if (packet.plan?.operatorGated !== true) errors.push("operator_gate_missing");
  if (!packet.plan?.targetAgentId) errors.push("missing_stable_child_id");
  if (!packet.plan?.workThreadId) errors.push("missing_work_thread_scope");
  if (packet.providerSupportWitness?.simulatedSuccessAllowed !== false || packet.transitionLedger?.simulatedSuccessStarted !== false || packet.resultEnvelope?.simulatedSuccessStarted !== false) {
    errors.push("simulated_success_leak");
  }
  if (packet.authorityDecision?.finalDecision === "allow") {
    if (packet.transitionLedger?.providerTransportStarted !== true) errors.push("allowed_missing_provider_transport");
    if (packet.transitionLedger?.lifecycleMutationStarted !== true) errors.push("allowed_missing_lifecycle_mutation");
  }
  if (packet.authorityDecision?.finalDecision !== "allow") {
    if (packet.transitionLedger?.providerTransportStarted !== false) errors.push("blocked_provider_transport_leak");
    if (packet.transitionLedger?.lifecycleMutationStarted !== false) errors.push("blocked_lifecycle_mutation_leak");
  }
  if (packet.transitionLedger?.status === "unsupported" && packet.providerSupportWitness?.supportState !== "unsupported") errors.push("unsupported_status_without_witness");
  if (!Array.isArray(packet.residentWitnessRows) || packet.residentWitnessRows.length < 4) errors.push("resident_witness_rows_missing");
  for (const row of arrayOrEmpty(packet.residentWitnessRows)) {
    if (row?.schema !== SUB_AGENT_LIFECYCLE_CONTROL_RESIDENT_WITNESS_SCHEMA) errors.push(`resident_witness_schema_mismatch:${row?.kind || ""}`);
    if (row?.residentCallable !== false || row?.operatorGated !== true) errors.push(`resident_witness_gate_leak:${row?.kind || ""}`);
    if (row?.rawProviderPayloadIncluded !== false || row?.rawChildTranscriptIncluded !== false) errors.push(`resident_witness_raw_exposure_leak:${row?.kind || ""}`);
  }
  if (!errors.length) return true;
  throw new Error(`sub_agent_lifecycle_control_packet_validation_failed:${errors.join(",")}`);
}

module.exports = {
  ACTIVE_STATES,
  AGENT_CANCELLATION_WITNESS_SCHEMA,
  AGENT_LIFECYCLE_TRANSITION_LEDGER_SCHEMA,
  AGENT_RESUME_VIABILITY_WITNESS_SCHEMA,
  LIFECYCLE_ACTIONS,
  SUB_AGENT_LIFECYCLE_AUTHORITY_DECISION_SCHEMA,
  SUB_AGENT_LIFECYCLE_CONTROL_PACKET_SCHEMA,
  SUB_AGENT_LIFECYCLE_CONTROL_PLAN_SCHEMA,
  SUB_AGENT_LIFECYCLE_CONTROL_RESIDENT_WITNESS_SCHEMA,
  SUB_AGENT_LIFECYCLE_CONTROL_RESULT_ENVELOPE_SCHEMA,
  SUB_AGENT_LIFECYCLE_PROVIDER_SUPPORT_WITNESS_SCHEMA,
  TERMINAL_STATES,
  buildSubAgentLifecycleControlPacket,
  validateSubAgentLifecycleControlPacket,
};
