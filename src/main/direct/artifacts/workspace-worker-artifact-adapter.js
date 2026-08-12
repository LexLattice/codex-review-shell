"use strict";

const crypto = require("node:crypto");
const {
  canonicalJson,
  deepFreeze,
  digestFor,
  normalizeScope,
} = require("./artifact-audit-kernel");

const ADAPTER_SCHEMA = "direct_workspace_worker_artifact_adapter@1";
const RESULT_SCHEMA = "direct_workspace_worker_artifact_adapter_result@1";
const SETTLEMENT_RECEIPT_SCHEMA = "direct_workspace_worker_settlement_receipt@1";
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const TERMINAL_STATES = new Set(["completed", "failed", "timeout", "cancelled"]);
const FORBIDDEN_PROVIDER_SEMANTIC_KEYS = /(?:artifact|candidate|admission|verdict|evidence|audit(?:assignment|requirement|verdict)|requirementid)/i;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactObject(value, fields, code) {
  if (!isObject(value) || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...fields].sort())) fail(code);
  return value;
}

function identifier(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    fail(`direct_workspace_worker_artifact_${label}_invalid`);
  }
  return value;
}

function requiredDigest(value, code) {
  if (typeof value !== "string" || !DIGEST.test(value)) fail(code);
  return value;
}

function operationKey(prefix, operation, discriminator = "") {
  const suffix = digestFor("direct_workspace_worker_artifact_operation_key@1", {
    prefix,
    operation,
    discriminator,
  }).slice(7, 31);
  return `${prefix.slice(0, 48)}-${operation}-${suffix}`;
}

function lifecycleDigestFor(domain, value) {
  return `sha256:${crypto.createHash("sha256").update(`${domain}\0${canonicalJson(value)}`).digest("hex")}`;
}

function validateSettlementReceipt(input) {
  exactObject(input, [
    "schema", "sessionId", "childAgentId", "projectId", "workThreadId", "state", "leaseState",
    "processState", "revision", "bindingDigest", "resultDigest", "sessionDigest", "terminalEventId",
    "terminalEventDigest", "rawWorkspacePathIncluded", "receiptDigest",
  ], "direct_workspace_worker_artifact_settlement_receipt_invalid");
  if (input.schema !== SETTLEMENT_RECEIPT_SCHEMA || input.state !== "completed" ||
      input.leaseState !== "released" || input.processState !== "quiescent" ||
      input.rawWorkspacePathIncluded !== false || !Number.isSafeInteger(input.revision) || input.revision < 1) {
    fail("direct_workspace_worker_artifact_settlement_receipt_invalid");
  }
  for (const [field, label] of [
    ["sessionId", "settlement_session_id"], ["childAgentId", "settlement_child_id"],
    ["projectId", "settlement_project_id"], ["workThreadId", "settlement_workthread_id"],
    ["terminalEventId", "settlement_event_id"],
  ]) identifier(input[field], label);
  for (const field of [
    "bindingDigest", "resultDigest", "sessionDigest", "terminalEventDigest", "receiptDigest",
  ]) requiredDigest(input[field], `direct_workspace_worker_artifact_settlement_${field}_invalid`);
  const receiptForDigest = { ...input };
  delete receiptForDigest.receiptDigest;
  if (input.receiptDigest !== lifecycleDigestFor(
    "direct-workspace-worker-settlement-receipt@1",
    receiptForDigest,
  )) {
    fail("direct_workspace_worker_artifact_settlement_receipt_digest_mismatch");
  }
  return input;
}

function assertProviderLaunchHasNoArtifactAuthority(value) {
  const seen = new Set();
  const visit = (current) => {
    if (Array.isArray(current)) return current.forEach(visit);
    if (!isObject(current) || seen.has(current)) return;
    seen.add(current);
    for (const [key, entry] of Object.entries(current)) {
      if (FORBIDDEN_PROVIDER_SEMANTIC_KEYS.test(key)) fail("direct_workspace_worker_artifact_provider_semantics_forbidden");
      visit(entry);
    }
  };
  visit(value);
}

function normalizeProfile(input) {
  exactObject(input, ["actorId", "roleId", "principal", "verdict", "evidenceKind", "launch"],
    "direct_workspace_worker_artifact_auditor_profile_invalid");
  if (!["supported", "requires_revision", "contradicted"].includes(input.verdict)) {
    fail("direct_workspace_worker_artifact_verdict_invalid");
  }
  if (!["test_report", "audit_observation"].includes(input.evidenceKind)) {
    fail("direct_workspace_worker_artifact_evidence_kind_invalid");
  }
  if (!isObject(input.launch)) fail("direct_workspace_worker_artifact_launch_profile_invalid");
  assertProviderLaunchHasNoArtifactAuthority(input.launch);
  if (input.launch.workspaceMode !== "isolated_worktree" || !input.launch.project ||
      !input.launch.parentAuthorityPacket || !input.launch.toolProfile || !input.launch.message) {
    fail("direct_workspace_worker_artifact_launch_profile_invalid");
  }
  return Object.freeze({
    actorId: identifier(input.actorId, "auditor_actor_id"),
    roleId: identifier(input.roleId, "auditor_role_id"),
    principal: input.principal,
    verdict: input.verdict,
    evidenceKind: input.evidenceKind,
    launch: Object.freeze({ ...input.launch }),
  });
}

class DirectWorkspaceWorkerArtifactAdapter {
  constructor(options = {}) {
    exactObject(options, [
      "artifactStore", "pool", "lifecycleRegistry", "evidenceReceiptAuthority", "principals",
      "projectId", "artifactClassId", "policyDigest", "producerActor", "auditorProfiles",
      "eventTypes", "waitTimeoutMs",
    ], "direct_workspace_worker_artifact_adapter_options_invalid");
    exactObject(options.principals, ["manager", "producer", "subscriber", "evidenceRegistrar"],
      "direct_workspace_worker_artifact_principals_invalid");
    exactObject(options.producerActor, ["actorId", "roleId"],
      "direct_workspace_worker_artifact_producer_actor_invalid");
    if (!options.artifactStore || !options.pool || !options.lifecycleRegistry ||
        !options.evidenceReceiptAuthority?.issue) {
      fail("direct_workspace_worker_artifact_substrate_missing");
    }
    const profiles = (Array.isArray(options.auditorProfiles) ? options.auditorProfiles : []).map(normalizeProfile);
    if (!profiles.length) fail("direct_workspace_worker_artifact_auditor_profile_missing");
    const profileKeys = profiles.map((entry) => `${entry.actorId}\0${entry.roleId}`);
    if (new Set(profileKeys).size !== profiles.length) fail("direct_workspace_worker_artifact_auditor_profile_duplicate");
    this.artifactStore = options.artifactStore;
    this.pool = options.pool;
    this.lifecycleRegistry = options.lifecycleRegistry;
    this.evidenceReceiptAuthority = options.evidenceReceiptAuthority;
    this.principals = Object.freeze({ ...options.principals });
    this.projectId = identifier(options.projectId, "project_id");
    this.artifactClassId = identifier(options.artifactClassId, "artifact_class_id");
    this.policyDigest = requiredDigest(options.policyDigest,
      "direct_workspace_worker_artifact_policy_digest_invalid");
    this.producerActor = Object.freeze({
      actorId: identifier(options.producerActor.actorId, "producer_actor_id"),
      roleId: identifier(options.producerActor.roleId, "producer_role_id"),
    });
    this.auditorProfiles = profiles;
    if (!Array.isArray(options.eventTypes)) fail("direct_workspace_worker_artifact_subscription_events_missing");
    this.eventTypes = [...new Set(options.eventTypes)].sort();
    if (!this.eventTypes.length) fail("direct_workspace_worker_artifact_subscription_events_missing");
    this.waitTimeoutMs = Number(options.waitTimeoutMs);
    if (!Number.isSafeInteger(this.waitTimeoutMs) || this.waitTimeoutMs < 1 || this.waitTimeoutMs > 300_000) {
      fail("direct_workspace_worker_artifact_wait_timeout_invalid");
    }
    this.schema = ADAPTER_SCHEMA;
  }

  #assertScope(scope) {
    const normalized = normalizeScope(scope);
    if (normalized.projectId !== this.projectId || normalized.artifactClassId !== this.artifactClassId) {
      fail("direct_workspace_worker_artifact_scope_mismatch");
    }
    return normalized;
  }

  #terminalProof(childAgentId, scope) {
    const record = this.pool.inspect({ target: childAgentId, projectId: scope.projectId });
    if (!record) fail("direct_workspace_worker_artifact_child_missing");
    if (record.state === "cancellation_unacknowledged" || record.cancellation?.requested &&
        !record.cancellation?.acknowledged) {
      fail("direct_workspace_worker_artifact_cancellation_unacknowledged");
    }
    if (record.cancellation?.requested) fail("direct_workspace_worker_artifact_cancelled_ineligible");
    if (record.state === "settlement_blocked" || record.lifecycleErrorCode) {
      fail("direct_workspace_worker_artifact_settlement_blocked");
    }
    if (record.state !== "completed" || record.workspaceMode !== "isolated_worktree") {
      fail("direct_workspace_worker_artifact_terminal_ineligible");
    }
    if (!record.epistemicCaptureComplete || record.epistemicCapture?.status !== "captured" ||
        record.epistemicCapture?.errorCode || !record.epistemicCapture?.sessionId ||
        !record.epistemicCapture?.turnId) {
      fail("direct_workspace_worker_artifact_capture_incomplete");
    }
    requiredDigest(record.epistemicCapture.receiptDigest,
      "direct_workspace_worker_artifact_capture_digest_invalid");
    requiredDigest(record.resultDigest, "direct_workspace_worker_artifact_result_digest_invalid");
    if (record.projectId !== scope.projectId || record.workThreadId !== scope.workThreadId ||
        record.workspaceExecution?.bottomUpMessagingAllowed !== false ||
        record.workspaceExecution?.binding?.bindingDigest !== record.workspaceLifecycle?.bindingDigest) {
      fail("direct_workspace_worker_artifact_terminal_scope_mismatch");
    }
    const lifecycle = record.workspaceLifecycle;
    if (!lifecycle?.sessionId || lifecycle.state !== "completed" || lifecycle.leaseState !== "released" ||
        lifecycle.processState !== "quiescent" || record.cancellation?.leaseActive) {
      fail("direct_workspace_worker_artifact_settlement_incomplete");
    }
    const settlement = validateSettlementReceipt(
      this.lifecycleRegistry.settlementReceipt(lifecycle.sessionId),
    );
    if (settlement.childAgentId !== record.childAgentId || settlement.projectId !== record.projectId ||
        settlement.workThreadId !== record.workThreadId || settlement.state !== "completed" ||
        settlement.bindingDigest !== lifecycle.bindingDigest || settlement.resultDigest !== record.resultDigest) {
      fail("direct_workspace_worker_artifact_settlement_receipt_mismatch");
    }
    const source = {
      schema: "direct_workspace_worker_artifact_source@1",
      childAgentId: record.childAgentId,
      capture: { ...record.epistemicCapture },
      settlement,
      bindingDigest: lifecycle.bindingDigest,
      rawWorkspacePathIncluded: false,
      rawProviderPayloadIncluded: false,
      bottomUpMessageObserved: false,
    };
    source.sourceDigest = digestFor("direct_workspace_worker_artifact_source@1", source);
    return deepFreeze({ record, settlement, source });
  }

  #registerEvidence(scope, revision, kind, proof) {
    const sourceIdentity = proof.settlement.receiptDigest.slice(7, 31);
    const evidenceId = `${kind}-${sourceIdentity}`;
    const receipt = this.evidenceReceiptAuthority.issue({
      kind,
      evidenceId: identifier(evidenceId, "evidence_id"),
      ...scope,
      revision,
      policyDigest: this.policyDigest,
      sourceCaptureId: identifier(`capture-${sourceIdentity}`, "source_capture_id"),
      sourceSessionId: identifier(proof.record.epistemicCapture.sessionId, "source_session_id"),
      sourceTurnId: identifier(proof.record.epistemicCapture.turnId, "source_turn_id"),
      canonicalEnvelopeDigest: proof.source.sourceDigest,
    });
    return this.artifactStore.registerEvidence({
      receipt,
      principal: this.principals.evidenceRegistrar,
    }).ref;
  }

  async #waitForTerminal(childAgentId) {
    const deadline = Date.now() + this.waitTimeoutMs;
    while (true) {
      const record = this.pool.inspect({ target: childAgentId, projectId: this.projectId });
      if (record && (TERMINAL_STATES.has(record.state) ||
          ["cancellation_unacknowledged", "settlement_blocked"].includes(record.state))) return record;
      const remaining = deadline - Date.now();
      if (remaining <= 0) fail("direct_workspace_worker_artifact_auditor_timeout");
      await this.pool.wait({ target: childAgentId, projectId: this.projectId, timeoutMs: remaining });
    }
  }

  async #dispatchAuditor(profile, scope) {
    const launchInput = { ...profile.launch };
    assertProviderLaunchHasNoArtifactAuthority(launchInput);
    if (launchInput.projectId !== scope.projectId || launchInput.workThreadId !== scope.workThreadId) {
      fail("direct_workspace_worker_artifact_auditor_launch_scope_mismatch");
    }
    const launch = this.pool.launch(launchInput);
    if (!launch.childAgentId || ["blocked", "failed", "cancelled"].includes(launch.status)) {
      fail(launch.blockerCode || "direct_workspace_worker_artifact_auditor_launch_failed");
    }
    await this.#waitForTerminal(launch.childAgentId);
    return this.#terminalProof(launch.childAgentId, scope);
  }

  async run(input = {}) {
    exactObject(input, [
      "scope", "revision", "producerChildAgentId", "subscriptionId", "idempotencyKeyPrefix",
      "projectionAfterSequence", "projectionLimit",
    ], "direct_workspace_worker_artifact_run_input_invalid");
    const scope = this.#assertScope(input.scope);
    const revision = Number(input.revision);
    if (!Number.isSafeInteger(revision) || revision < 1) fail("direct_workspace_worker_artifact_revision_invalid");
    const prefix = identifier(input.idempotencyKeyPrefix, "idempotency_prefix");
    const subscriptionId = identifier(input.subscriptionId, "subscription_id");
    const producerProof = this.#terminalProof(identifier(input.producerChildAgentId, "producer_child_id"), scope);
    const route = this.artifactStore.compileRoutingPlan({
      scope,
      policyDigest: this.policyDigest,
      principal: this.principals.manager,
    });
    const witness = route.feasibleAssignments.find((entry) =>
      canonicalJson(entry.producer) === canonicalJson(this.producerActor));
    if (!witness) fail("direct_workspace_worker_artifact_producer_route_missing");
    const dispatchPlan = witness.audits.map((assignment) => {
      const profile = this.auditorProfiles.find((entry) => entry.actorId === assignment.actorId &&
        entry.roleId === assignment.roleId);
      if (!profile) fail("direct_workspace_worker_artifact_auditor_profile_missing");
      return { assignment, profile };
    });
    const subscription = this.artifactStore.subscribe({
      subscriptionId,
      projectId: scope.projectId,
      workThreadId: scope.workThreadId,
      artifactId: scope.artifactId,
      artifactClassId: scope.artifactClassId,
      policyDigest: this.policyDigest,
      principal: this.principals.subscriber,
      eventTypes: this.eventTypes,
    });
    const candidateEvidence = this.#registerEvidence(scope, revision, "workspace_worker_terminal", producerProof);
    const candidate = this.artifactStore.submitCandidate({
      scope,
      policyDigest: this.policyDigest,
      principal: this.principals.producer,
      idempotencyKey: operationKey(prefix, "candidate"),
      expectedRevision: revision,
      expectedState: "under_production",
      evidenceRefs: [candidateEvidence],
    });
    const auditStarted = this.artifactStore.beginAudit({
      scope,
      policyDigest: this.policyDigest,
      principal: dispatchPlan[0].profile.principal,
      idempotencyKey: operationKey(prefix, "audit-started"),
      expectedRevision: revision,
      expectedState: "candidate",
    });
    const dispatches = [];
    for (const dispatch of dispatchPlan) {
      dispatches.push({
        ...dispatch,
        proof: await this.#dispatchAuditor(dispatch.profile, scope),
      });
    }
    const verdictEvents = [];
    for (const dispatch of dispatches) {
      const evidenceRef = this.#registerEvidence(scope, revision, dispatch.profile.evidenceKind, dispatch.proof);
      verdictEvents.push(this.artifactStore.recordAuditVerdict({
        scope,
        policyDigest: this.policyDigest,
        principal: dispatch.profile.principal,
        idempotencyKey: operationKey(prefix, "verdict", dispatch.assignment.requirementId),
        expectedRevision: revision,
        expectedState: "under_audit",
        requirementId: dispatch.assignment.requirementId,
        verdict: dispatch.profile.verdict,
        evidenceRefs: [evidenceRef],
      }));
    }
    const projection = this.artifactStore.pollSubscription({
      subscriptionId: subscription.subscriptionId,
      principal: this.principals.subscriber,
      afterSequence: Number(input.projectionAfterSequence),
      limit: Number(input.projectionLimit),
    });
    const result = {
      schema: RESULT_SCHEMA,
      scope: { ...scope, revision },
      candidateEventId: candidate.eventId,
      auditStartedEventId: auditStarted.eventId,
      verdictEventIds: verdictEvents.map((event) => event.eventId),
      terminalState: verdictEvents.at(-1)?.stateTo || "under_audit",
      subscriptionProjection: projection,
      canonicalProjectTruthChanged: false,
      worldManagerWritePerformed: false,
      worktreeCleanupPerformed: false,
      bottomUpMessageCount: 0,
      providerArtifactAuthorityGranted: false,
    };
    result.resultDigest = digestFor(RESULT_SCHEMA, result);
    return deepFreeze(result);
  }
}

function createDirectWorkspaceWorkerArtifactAdapter(options) {
  return new DirectWorkspaceWorkerArtifactAdapter(options);
}

module.exports = {
  ADAPTER_SCHEMA,
  RESULT_SCHEMA,
  DirectWorkspaceWorkerArtifactAdapter,
  assertProviderLaunchHasNoArtifactAuthority,
  createDirectWorkspaceWorkerArtifactAdapter,
};
