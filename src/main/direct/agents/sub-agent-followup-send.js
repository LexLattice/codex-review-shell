"use strict";

const crypto = require("node:crypto");
const {
  FOLLOWUP_ACTIONS,
  buildSubAgentInteractionPolicyEnvelope,
  validateSubAgentInteractionPolicyEnvelope,
} = require("./sub-agent-interaction-policy");
const {
  buildAgentMailbox,
  buildAgentThreadGraph,
} = require("./runtime-substrate");

const SUB_AGENT_FOLLOWUP_MAILBOX_LEDGER_SCHEMA = "sub_agent_followup_mailbox_ledger@1";
const SUB_AGENT_SEND_MESSAGE_PLAN_SCHEMA = "sub_agent_send_message_plan@1";
const SUB_AGENT_FOLLOWUP_TASK_PLAN_SCHEMA = "sub_agent_followup_task_plan@1";
const SUB_AGENT_FOLLOWUP_AUTHORITY_DECISION_SCHEMA = "sub_agent_followup_authority_decision@1";
const SUB_AGENT_DELIVERY_SUPPORT_WITNESS_SCHEMA = "sub_agent_delivery_support_witness@1";
const SUB_AGENT_FOLLOWUP_RESULT_ENVELOPE_SCHEMA = "sub_agent_followup_result_envelope@1";
const SUB_AGENT_FOLLOWUP_RESIDENT_WITNESS_SCHEMA = "sub_agent_followup_resident_witness@1";
const SUB_AGENT_CONTROLLED_CONTINUATION_SCHEMA = "sub_agent_controlled_continuation@1";

const FOLLOWUP_WRITE_KINDS = Object.freeze(["send_message", "followup_task"]);
const TERMINAL_TARGET_STATES = Object.freeze(["completed", "failed", "timeout", "cancelled", "closed", "not_found"]);

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
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => (entry === undefined ? "null" : stableStringify(entry))).join(",")}]`;
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined && ![
      "decisionDigest",
      "ledgerDigest",
      "planDigest",
      "resultDigest",
      "witnessDigest",
      "continuationDigest",
    ].includes(key))
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function digestFor(domain, value) {
  return `sha256:${crypto.createHash("sha256").update(`${domain}\0${stableStringify(value)}`).digest("hex")}`;
}

function nowIso(nowMs) {
  const ms = typeof nowMs === "number" && Number.isFinite(nowMs) ? nowMs : Date.now();
  return new Date(ms).toISOString();
}

function normalizeEvidenceRef(input = {}, fallbackKind = "sub_agent_followup") {
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
  ref.refDigest = digestFor("sub-agent-followup-evidence-ref@1", ref);
  return ref;
}

function normalizeEvidenceRefs(values, fallbackKind = "sub_agent_followup") {
  const refs = arrayOrEmpty(values)
    .filter(isPlainObject)
    .map((value) => normalizeEvidenceRef(value, fallbackKind));
  return refs.length ? refs : [normalizeEvidenceRef({ kind: fallbackKind, id: fallbackKind, label: fallbackKind }, fallbackKind)];
}

function graphNodes(graph) {
  return arrayOrEmpty(graph?.nodes);
}

function mailboxMessages(mailbox) {
  return arrayOrEmpty(mailbox?.messages);
}

function findTargetNode(graph, targetAgentId) {
  const safeTarget = normalizeString(targetAgentId, "");
  return graphNodes(graph).find((node) => normalizeString(node.agentThreadId || node.childAgentId, "") === safeTarget) || null;
}

function nextMailboxSequence(mailbox = {}) {
  return mailboxMessages(mailbox).reduce((max, message) => {
    const sequence = Number(message?.sequence || 0);
    return Number.isFinite(sequence) ? Math.max(max, sequence) : max;
  }, 0) + 1;
}

function payloadEvidenceRef(input = {}, writeKind = "send_message") {
  const payloadRef = isPlainObject(input.payloadRef) ? input.payloadRef : {};
  return normalizeEvidenceRef({
    kind: payloadRef.kind || (writeKind === "followup_task" ? "followup_task_payload_ref" : "send_message_payload_ref"),
    id: payloadRef.id || input.payloadId || `${writeKind}_payload`,
    digest: payloadRef.digest || input.payloadDigest || digestFor("sub-agent-followup-payload@1", {
      writeKind,
      textPreview: boundedString(input.text || input.message || input.prompt || input.task, 280),
    }),
    label: payloadRef.label || (writeKind === "followup_task" ? "Follow-up task payload" : "Sub-agent message payload"),
    confidence: payloadRef.confidence || "operator_declared",
  }, writeKind === "followup_task" ? "followup_task_payload_ref" : "send_message_payload_ref");
}

function buildPlan(input = {}, { writeKind, graph, mailbox, targetNode, generatedAt }) {
  const targetAgentId = normalizeString(input.targetAgentId || input.childAgentId || input.agentThreadId, "");
  const schema = writeKind === "followup_task" ? SUB_AGENT_FOLLOWUP_TASK_PLAN_SCHEMA : SUB_AGENT_SEND_MESSAGE_PLAN_SCHEMA;
  const payloadRef = payloadEvidenceRef(input, writeKind);
  const plan = {
    schema,
    planId: normalizeString(input.planId, ""),
    writeKind,
    projectId: normalizeString(input.projectId || graph.projectId || mailbox.projectId, ""),
    workThreadId: normalizeString(input.workThreadId, ""),
    primaryThreadId: normalizeString(input.primaryThreadId || graph.primaryThreadId || mailbox.primaryThreadId, ""),
    graphId: normalizeString(graph.graphId || mailbox.graphId, ""),
    mailboxId: normalizeString(mailbox.mailboxId, ""),
    parentAgentId: normalizeString(input.parentAgentId, graph.primaryThreadId || "primary_agent"),
    targetAgentId,
    targetExists: Boolean(targetNode),
    targetLifecycleState: normalizeString(targetNode?.lifecycleState || targetNode?.nodeState, targetNode ? "running" : "not_found"),
    targetStale: input.targetStale === true || !targetNode || TERMINAL_TARGET_STATES.includes(normalizeString(targetNode?.lifecycleState || targetNode?.nodeState, "")),
    sequence: nextMailboxSequence(mailbox),
    idempotencyKey: normalizeString(input.idempotencyKey, ""),
    payloadRef,
    messageKind: writeKind === "followup_task" ? "followup" : "parent_prompt",
    direction: "parent_to_child",
    deliveryIntent: "existing_child_only",
    noFallbackSpawn: true,
    childToolInheritanceAllowed: false,
    recursiveSpawnAllowed: false,
    childTranscriptPromotionAllowed: false,
    resultAdmissionMode: "summary_only",
    generatedAt,
    evidenceRefs: normalizeEvidenceRefs(input.evidenceRefs, "sub_agent_followup_plan"),
    rawPayloadIncluded: false,
    rawPromptIncluded: false,
    rawChildTranscriptIncluded: false,
    rawProviderPayloadIncluded: false,
  };
  plan.idempotencyKey = plan.idempotencyKey || digestFor("sub-agent-followup-idempotency-key@1", {
    writeKind,
    projectId: plan.projectId,
    workThreadId: plan.workThreadId,
    parentAgentId: plan.parentAgentId,
    targetAgentId: plan.targetAgentId,
    payloadDigest: payloadRef.refDigest,
  });
  plan.planId = plan.planId || `sub_agent_${writeKind}_plan_${digestFor("sub-agent-followup-plan-id@1", plan).slice(7, 23)}`;
  plan.canonicalInputDigest = digestFor("sub-agent-followup-canonical-input@1", {
    writeKind,
    projectId: plan.projectId,
    workThreadId: plan.workThreadId,
    primaryThreadId: plan.primaryThreadId,
    parentAgentId: plan.parentAgentId,
    targetAgentId: plan.targetAgentId,
    payloadRefDigest: payloadRef.refDigest,
  });
  plan.planDigest = digestFor(schema, plan);
  return plan;
}

function idempotencyStatus(plan, existingLedgerRows) {
  const previous = arrayOrEmpty(existingLedgerRows)
    .find((row) => normalizeString(row.idempotencyKey, "") === plan.idempotencyKey);
  if (!previous) {
    return { status: "new", duplicateSuppressed: false, previousLedgerRowId: "", blockerCode: "" };
  }
  if (normalizeString(previous.canonicalInputDigest, "") === plan.canonicalInputDigest) {
    return {
      status: "duplicate_same_input",
      duplicateSuppressed: true,
      previousLedgerRowId: normalizeString(previous.ledgerRowId, ""),
      blockerCode: "",
    };
  }
  return {
    status: "idempotency_conflict",
    duplicateSuppressed: false,
    previousLedgerRowId: normalizeString(previous.ledgerRowId, ""),
    blockerCode: "idempotency_conflict",
  };
}

function buildDeliverySupportWitness(input = {}, { plan, generatedAt }) {
  const support = isPlainObject(input.deliverySupport) ? input.deliverySupport : {};
  const modeCandidate = normalizeString(support.deliveryMode || input.deliveryMode, "provider_backed_existing_child");
  const supported = support.supported === true || input.providerSupportsExistingChildDelivery === true;
  const witness = {
    schema: SUB_AGENT_DELIVERY_SUPPORT_WITNESS_SCHEMA,
    witnessId: normalizeString(support.witnessId, ""),
    writeKind: plan.writeKind,
    targetAgentId: plan.targetAgentId,
    supportState: supported ? "supported" : normalizeString(support.supportState, "unsupported"),
    deliveryMode: supported ? modeCandidate : "unavailable",
    deliveryAdapter: supported ? normalizeString(support.deliveryAdapter || input.deliveryAdapter, "provider_backed_delivery_adapter") : "",
    providerSupportsExistingChildDelivery: supported,
    fallbackSpawnAllowed: false,
    childToolInheritanceAllowed: false,
    rawProviderPayloadIncluded: false,
    generatedAt,
    evidenceRefs: normalizeEvidenceRefs(support.evidenceRefs || input.deliveryEvidenceRefs, "sub_agent_delivery_support"),
  };
  witness.witnessId = witness.witnessId || `sub_agent_delivery_support_${digestFor("sub-agent-delivery-support-id@1", witness).slice(7, 23)}`;
  witness.witnessDigest = digestFor("sub-agent-delivery-support-witness@1", witness);
  return witness;
}

function buildAuthorityDecision({ plan, policyEnvelope, deliveryWitness, idem, generatedAt }) {
  const blockers = [];
  validateSubAgentInteractionPolicyEnvelope(policyEnvelope);
  if (!plan.workThreadId) blockers.push("missing_work_thread_scope");
  if (!plan.targetAgentId) blockers.push("missing_stable_child_id");
  if (!plan.targetExists) blockers.push("target_not_found");
  if (plan.targetStale) blockers.push("target_stale_or_terminal");
  if (!FOLLOWUP_ACTIONS.includes(plan.writeKind)) blockers.push("invalid_followup_write_kind");
  if (!arrayOrEmpty(policyEnvelope.allowedActions).includes(plan.writeKind)) blockers.push("policy_blocks_followup_action");
  if (policyEnvelope.targetId !== plan.targetAgentId) blockers.push("policy_target_mismatch");
  if (idem.status === "idempotency_conflict") blockers.push("idempotency_conflict");
  if (deliveryWitness.providerSupportsExistingChildDelivery !== true) blockers.push("delivery_not_supported");

  const decision = {
    schema: SUB_AGENT_FOLLOWUP_AUTHORITY_DECISION_SCHEMA,
    decisionId: `sub_agent_followup_authority_${digestFor("sub-agent-followup-authority-id@1", {
      planId: plan.planId,
      policyDigest: policyEnvelope.policyDigest,
      idempotencyKey: plan.idempotencyKey,
    }).slice(7, 23)}`,
    writeKind: plan.writeKind,
    finalDecision: blockers.length ? "block" : "allow",
    blockerCodes: blockers,
    actorKind: policyEnvelope.actorKind,
    targetAgentId: plan.targetAgentId,
    workThreadId: plan.workThreadId,
    planId: plan.planId,
    planDigest: plan.planDigest,
    policyId: policyEnvelope.policyId,
    policyDigest: policyEnvelope.policyDigest,
    deliveryWitnessId: deliveryWitness.witnessId,
    deliveryWitnessDigest: deliveryWitness.witnessDigest,
    idempotencyStatus: idem.status,
    duplicateSuppressed: idem.duplicateSuppressed,
    replayPolicy: "idempotent_same_key",
    providerTransportAllowed: blockers.length === 0 && !idem.duplicateSuppressed,
    followupTransportAllowed: blockers.length === 0 && !idem.duplicateSuppressed,
    lifecycleMutationAllowed: false,
    fallbackSpawnAllowed: false,
    childToolInheritanceAllowed: false,
    resultAdmissionMode: "summary_only",
    generatedAt,
    rawPolicyPayloadIncluded: false,
    rawProviderPayloadIncluded: false,
    rawChildTranscriptIncluded: false,
  };
  decision.decisionDigest = digestFor("sub-agent-followup-authority-decision@1", decision);
  return decision;
}

function buildMailboxLedgerRow({ plan, decision, idem, generatedAt }) {
  const status = decision.finalDecision === "block"
    ? "blocked"
    : idem.duplicateSuppressed ? "duplicate_suppressed" : "accepted";
  const ledger = {
    schema: SUB_AGENT_FOLLOWUP_MAILBOX_LEDGER_SCHEMA,
    ledgerRowId: `sub_agent_followup_mailbox_${digestFor("sub-agent-followup-mailbox-ledger-id@1", {
      idempotencyKey: plan.idempotencyKey,
      canonicalInputDigest: plan.canonicalInputDigest,
      status,
    }).slice(7, 23)}`,
    status,
    writeKind: plan.writeKind,
    projectId: plan.projectId,
    workThreadId: plan.workThreadId,
    primaryThreadId: plan.primaryThreadId,
    mailboxId: plan.mailboxId,
    sequence: status === "accepted" ? plan.sequence : 0,
    parentAgentId: plan.parentAgentId,
    targetAgentId: plan.targetAgentId,
    idempotencyKey: plan.idempotencyKey,
    canonicalInputDigest: plan.canonicalInputDigest,
    duplicateSuppressed: idem.duplicateSuppressed,
    previousLedgerRowId: idem.previousLedgerRowId,
    blockerCodes: decision.blockerCodes,
    payloadRef: plan.payloadRef,
    resultAdmissionMode: "summary_only",
    generatedAt,
    rawPayloadIncluded: false,
    rawPromptIncluded: false,
    rawChildTranscriptIncluded: false,
    rawProviderPayloadIncluded: false,
  };
  ledger.ledgerDigest = digestFor("sub-agent-followup-mailbox-ledger@1", ledger);
  return ledger;
}

function buildProviderDeliveryResult(input = {}, { decision, ledgerRow, deliveryWitness, generatedAt }) {
  const providerResult = isPlainObject(input.providerDeliveryResult) ? input.providerDeliveryResult : {};
  if (decision.finalDecision !== "allow") {
    return {
      attempted: false,
      status: "not_attempted",
      reason: decision.blockerCodes[0] || "authority_blocked",
      providerTransportStarted: false,
      rawProviderPayloadIncluded: false,
    };
  }
  if (decision.duplicateSuppressed) {
    return {
      attempted: false,
      status: "duplicate_suppressed",
      reason: "idempotency_duplicate_same_input",
      providerTransportStarted: false,
      rawProviderPayloadIncluded: false,
    };
  }
  return {
    attempted: true,
    status: normalizeString(providerResult.status, "delivered"),
    deliveryReceiptId: normalizeString(providerResult.deliveryReceiptId, `delivery_receipt_${ledgerRow.ledgerRowId}`),
    deliveryMode: deliveryWitness.deliveryMode,
    deliveryAdapter: deliveryWitness.deliveryAdapter,
    providerTransportStarted: true,
    rawProviderPayloadIncluded: false,
    generatedAt,
  };
}

function buildResultEnvelope({ plan, decision, ledgerRow, deliveryWitness, providerDelivery, generatedAt }) {
  const envelope = {
    schema: SUB_AGENT_FOLLOWUP_RESULT_ENVELOPE_SCHEMA,
    resultEnvelopeId: `sub_agent_followup_result_${digestFor("sub-agent-followup-result-id@1", {
      planId: plan.planId,
      decisionDigest: decision.decisionDigest,
      ledgerDigest: ledgerRow.ledgerDigest,
    }).slice(7, 23)}`,
    writeKind: plan.writeKind,
    status: decision.finalDecision === "allow" ? (decision.duplicateSuppressed ? "duplicate_suppressed" : "completed") : "blocked",
    blockerCodes: decision.blockerCodes,
    targetAgentId: plan.targetAgentId,
    workThreadId: plan.workThreadId,
    authorityDecisionId: decision.decisionId,
    authorityDecisionDigest: decision.decisionDigest,
    mailboxLedgerRowId: ledgerRow.ledgerRowId,
    mailboxLedgerDigest: ledgerRow.ledgerDigest,
    deliveryWitnessId: deliveryWitness.witnessId,
    deliveryWitnessDigest: deliveryWitness.witnessDigest,
    providerDelivery,
    contextAdmission: {
      mode: "summary_only",
      admitted: decision.finalDecision === "allow",
      childTranscriptAdmitted: false,
      rawPayloadAdmitted: false,
      summaryText: decision.finalDecision === "allow"
        ? `${plan.writeKind} accepted for ${plan.targetAgentId}`
        : `${plan.writeKind} blocked for ${plan.targetAgentId}`,
    },
    providerTransportStarted: providerDelivery.providerTransportStarted === true,
    followupTransportStarted: providerDelivery.providerTransportStarted === true,
    lifecycleMutationStarted: false,
    fallbackSpawnStarted: false,
    childToolInheritanceStarted: false,
    generatedAt,
    rawPayloadIncluded: false,
    rawPromptIncluded: false,
    rawChildTranscriptIncluded: false,
    rawProviderPayloadIncluded: false,
  };
  envelope.resultDigest = digestFor("sub-agent-followup-result-envelope@1", envelope);
  return envelope;
}

function buildResidentWitnessRows({ plan, decision, ledgerRow, deliveryWitness, resultEnvelope, generatedAt }) {
  return ["authority", "mailbox", "delivery", "context_admission"].map((kind) => {
    const row = {
      schema: SUB_AGENT_FOLLOWUP_RESIDENT_WITNESS_SCHEMA,
      witnessRowId: `sub_agent_followup_resident_${kind}_${digestFor("sub-agent-followup-resident-witness-id@1", {
        kind,
        resultEnvelopeId: resultEnvelope.resultEnvelopeId,
      }).slice(7, 23)}`,
      kind,
      writeKind: plan.writeKind,
      targetAgentId: plan.targetAgentId,
      workThreadId: plan.workThreadId,
      status: resultEnvelope.status,
      rendererSafeSummary: kind === "authority"
        ? `Authority ${decision.finalDecision} for ${plan.writeKind}`
        : kind === "mailbox"
          ? `Mailbox ledger ${ledgerRow.status}`
          : kind === "delivery"
            ? `Delivery ${deliveryWitness.supportState}/${deliveryWitness.deliveryMode}`
            : "Follow-up result admitted as summary-only context",
      evidenceRefs: normalizeEvidenceRefs([{
        kind: `sub_agent_followup_${kind}`,
        id: kind === "authority" ? decision.decisionId : kind === "mailbox" ? ledgerRow.ledgerRowId : kind === "delivery" ? deliveryWitness.witnessId : resultEnvelope.resultEnvelopeId,
        digest: kind === "authority" ? decision.decisionDigest : kind === "mailbox" ? ledgerRow.ledgerDigest : kind === "delivery" ? deliveryWitness.witnessDigest : resultEnvelope.resultDigest,
        label: `Sub-agent follow-up ${kind}`,
      }], `sub_agent_followup_${kind}`),
      generatedAt,
      rawPayloadIncluded: false,
      rawProviderPayloadIncluded: false,
      rawChildTranscriptIncluded: false,
    };
    row.witnessDigest = digestFor("sub-agent-followup-resident-witness@1", row);
    return row;
  });
}

function buildSubAgentControlledContinuation(input = {}, options = {}) {
  const generatedAt = nowIso(options.nowMs || input.nowMs);
  const writeKindCandidate = normalizeString(input.writeKind || input.action, "send_message");
  const writeKind = FOLLOWUP_WRITE_KINDS.includes(writeKindCandidate) ? writeKindCandidate : "send_message";
  const graph = isPlainObject(input.graph) ? input.graph : buildAgentThreadGraph(input);
  const mailbox = isPlainObject(input.mailbox) ? input.mailbox : buildAgentMailbox({
    projectId: input.projectId || graph.projectId,
    primaryThreadId: input.primaryThreadId || graph.primaryThreadId,
    graphId: graph.graphId,
    messages: input.messages,
  });
  const targetAgentId = normalizeString(input.targetAgentId || input.childAgentId || input.agentThreadId, "");
  const targetNode = findTargetNode(graph, targetAgentId);
  const policyEnvelope = isPlainObject(input.policyEnvelope)
    ? input.policyEnvelope
    : buildSubAgentInteractionPolicyEnvelope({
      actorKind: input.actorKind || "resident_model",
      actorId: input.actorId || "resident_primary",
      targetKind: "child_agent",
      targetId: targetAgentId,
      scope: input.scope || "single_child",
      policy: input.policy || "followup_allowed",
      otherwiseAuthorizedActions: input.otherwiseAuthorizedActions || ["list_agents", "inspect_agent", "status_agent", "wait_agent", writeKind],
      sourceRefs: input.policySourceRefs || input.evidenceRefs,
    }, { now: options.nowMs || input.nowMs });
  const plan = buildPlan(input, { writeKind, graph, mailbox, targetNode, generatedAt });
  const idem = idempotencyStatus(plan, input.existingLedgerRows);
  const deliveryWitness = buildDeliverySupportWitness(input, { plan, generatedAt });
  const authorityDecision = buildAuthorityDecision({ plan, policyEnvelope, deliveryWitness, idem, generatedAt });
  const mailboxLedgerRow = buildMailboxLedgerRow({ plan, decision: authorityDecision, idem, generatedAt });
  const providerDelivery = buildProviderDeliveryResult(input, {
    decision: authorityDecision,
    ledgerRow: mailboxLedgerRow,
    deliveryWitness,
    generatedAt,
  });
  const resultEnvelope = buildResultEnvelope({
    plan,
    decision: authorityDecision,
    ledgerRow: mailboxLedgerRow,
    deliveryWitness,
    providerDelivery,
    generatedAt,
  });
  const residentWitnessRows = buildResidentWitnessRows({
    plan,
    decision: authorityDecision,
    ledgerRow: mailboxLedgerRow,
    deliveryWitness,
    resultEnvelope,
    generatedAt,
  });
  const continuation = {
    schema: SUB_AGENT_CONTROLLED_CONTINUATION_SCHEMA,
    continuationId: `sub_agent_controlled_continuation_${digestFor("sub-agent-controlled-continuation-id@1", {
      planId: plan.planId,
      resultDigest: resultEnvelope.resultDigest,
    }).slice(7, 23)}`,
    writeKind,
    plan,
    policyEnvelope,
    authorityDecision,
    mailboxLedgerRow,
    deliverySupportWitness: deliveryWitness,
    resultEnvelope,
    residentWitnessRows,
    generatedAt,
    rawPayloadIncluded: false,
    rawPromptIncluded: false,
    rawChildTranscriptIncluded: false,
    rawProviderPayloadIncluded: false,
  };
  continuation.continuationDigest = digestFor("sub-agent-controlled-continuation@1", continuation);
  validateSubAgentControlledContinuation(continuation);
  return continuation;
}

function validateSubAgentControlledContinuation(continuation = {}) {
  const errors = [];
  if (!isPlainObject(continuation)) throw new Error("sub_agent_controlled_continuation_invalid_object");
  if (continuation.schema !== SUB_AGENT_CONTROLLED_CONTINUATION_SCHEMA) throw new Error("sub_agent_controlled_continuation_schema_mismatch");
  if (!FOLLOWUP_WRITE_KINDS.includes(continuation.writeKind)) errors.push(`invalid_write_kind:${continuation.writeKind || ""}`);
  const plan = continuation.plan;
  const decision = continuation.authorityDecision;
  const ledger = continuation.mailboxLedgerRow;
  const delivery = continuation.deliverySupportWitness;
  const result = continuation.resultEnvelope;
  if (!isPlainObject(plan) || ![SUB_AGENT_SEND_MESSAGE_PLAN_SCHEMA, SUB_AGENT_FOLLOWUP_TASK_PLAN_SCHEMA].includes(plan.schema)) errors.push("plan_schema_mismatch");
  if (!isPlainObject(decision) || decision.schema !== SUB_AGENT_FOLLOWUP_AUTHORITY_DECISION_SCHEMA) errors.push("authority_decision_schema_mismatch");
  if (!isPlainObject(ledger) || ledger.schema !== SUB_AGENT_FOLLOWUP_MAILBOX_LEDGER_SCHEMA) errors.push("mailbox_ledger_schema_mismatch");
  if (!isPlainObject(delivery) || delivery.schema !== SUB_AGENT_DELIVERY_SUPPORT_WITNESS_SCHEMA) errors.push("delivery_support_schema_mismatch");
  if (!isPlainObject(result) || result.schema !== SUB_AGENT_FOLLOWUP_RESULT_ENVELOPE_SCHEMA) errors.push("result_envelope_schema_mismatch");
  if (isPlainObject(continuation.policyEnvelope)) {
    try {
      validateSubAgentInteractionPolicyEnvelope(continuation.policyEnvelope);
    } catch (error) {
      errors.push(`policy_envelope_invalid:${error.message}`);
    }
  } else {
    errors.push("policy_envelope_missing");
  }
  for (const field of ["rawPayloadIncluded", "rawPromptIncluded", "rawChildTranscriptIncluded", "rawProviderPayloadIncluded"]) {
    if (continuation[field] !== false) errors.push(`raw_exposure_leak:${field}`);
    if (plan?.[field] !== false) errors.push(`plan_raw_exposure_leak:${field}`);
    if (ledger?.[field] !== false) errors.push(`ledger_raw_exposure_leak:${field}`);
    if (result?.[field] !== false) errors.push(`result_raw_exposure_leak:${field}`);
  }
  if (!plan?.targetAgentId) errors.push("missing_stable_child_id");
  if (!plan?.workThreadId) errors.push("missing_work_thread_scope");
  if (plan?.noFallbackSpawn !== true || result?.fallbackSpawnStarted !== false) errors.push("fallback_spawn_leak");
  if (plan?.childToolInheritanceAllowed !== false || result?.childToolInheritanceStarted !== false) errors.push("child_tool_inheritance_leak");
  if (result?.contextAdmission?.mode !== "summary_only" || result?.contextAdmission?.childTranscriptAdmitted !== false) {
    errors.push("context_admission_not_summary_only");
  }
  if (decision?.finalDecision === "allow" && decision?.duplicateSuppressed !== true && result?.providerTransportStarted !== true) {
    errors.push("allowed_non_duplicate_missing_provider_transport");
  }
  if (decision?.finalDecision === "block" && result?.providerTransportStarted !== false) {
    errors.push("blocked_result_started_provider_transport");
  }
  if (decision?.duplicateSuppressed === true && result?.providerTransportStarted !== false) {
    errors.push("duplicate_result_started_provider_transport");
  }
  if (ledger?.status === "accepted" && Number(ledger.sequence || 0) <= 0) errors.push("accepted_ledger_missing_sequence");
  if (ledger?.status !== "accepted" && Number(ledger?.sequence || 0) !== 0) errors.push("blocked_or_duplicate_ledger_has_sequence");
  if (!Array.isArray(continuation.residentWitnessRows) || continuation.residentWitnessRows.length < 4) errors.push("resident_witness_rows_missing");
  for (const row of arrayOrEmpty(continuation.residentWitnessRows)) {
    if (row?.schema !== SUB_AGENT_FOLLOWUP_RESIDENT_WITNESS_SCHEMA) errors.push(`resident_witness_schema_mismatch:${row?.kind || ""}`);
    if (row?.rawPayloadIncluded !== false || row?.rawProviderPayloadIncluded !== false || row?.rawChildTranscriptIncluded !== false) {
      errors.push(`resident_witness_raw_exposure_leak:${row?.kind || ""}`);
    }
  }
  if (!errors.length) return true;
  throw new Error(`sub_agent_controlled_continuation_validation_failed:${errors.join(",")}`);
}

module.exports = {
  FOLLOWUP_WRITE_KINDS,
  SUB_AGENT_CONTROLLED_CONTINUATION_SCHEMA,
  SUB_AGENT_DELIVERY_SUPPORT_WITNESS_SCHEMA,
  SUB_AGENT_FOLLOWUP_AUTHORITY_DECISION_SCHEMA,
  SUB_AGENT_FOLLOWUP_MAILBOX_LEDGER_SCHEMA,
  SUB_AGENT_FOLLOWUP_RESIDENT_WITNESS_SCHEMA,
  SUB_AGENT_FOLLOWUP_RESULT_ENVELOPE_SCHEMA,
  SUB_AGENT_FOLLOWUP_TASK_PLAN_SCHEMA,
  SUB_AGENT_SEND_MESSAGE_PLAN_SCHEMA,
  buildSubAgentControlledContinuation,
  validateSubAgentControlledContinuation,
};
