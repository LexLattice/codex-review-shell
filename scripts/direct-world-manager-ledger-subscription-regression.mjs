#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import crypto from "node:crypto";

const require = createRequire(import.meta.url);
const {
  BROKER_PERSISTENCE_CONTRACT,
  DirectLedgerSubscriptionBroker,
  acknowledgeLedgerDelivery,
  buildDiscretionaryLedgerWatch,
  buildNotificationStanding,
  buildSubscriptionCursor,
  validateLedgerDeliveryEnvelope,
  validateLedgerSubscriptionBrokerSnapshot,
} = require("../src/main/direct/worldmanager/ledger-subscription-broker");
const {
  acknowledgeContextInvalidation,
  adaptLedgerDeliveryToContinuation,
  buildLedgerContextHydrationRequest,
  deriveContextInvalidationNotices,
  hydrateLedgerDelivery,
  validateLedgerContextAdmissionEnvelope,
} = require("../src/main/direct/worldmanager/ledger-context-runtime");
const {
  buildAgentSuspensionState,
} = require("../src/main/direct/worldmodel/wakeup-continuation");
const {
  buildEpistemicLedgerEvent,
} = require("../src/main/direct/worldmanager/epistemic-ledger-kernel");

let tick = Date.parse("2026-08-01T08:00:00.000Z");
const now = () => {
  tick += 1_000;
  return tick;
};

function digest(label) {
  return crypto.createHash("sha256").update(label).digest("hex");
}

function ref(kind, id, revision = "1", label = id) {
  return {
    kind,
    id,
    digest: digest(`${kind}:${id}:${revision}`),
    label,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error?.code === code, code);
}

const roleRef = ref("role_template", "project_manager");
const agentRef = ref("agent", "pm_alpha");
const agentRunRef = ref("agent_run", "pm_alpha_run_7");
const visibilityPolicyRef = ref("evidence_visibility_policy", "project_pm_bounded");
const standing = buildNotificationStanding({
  standingId: "standing_project_alpha_pm",
  subscriberRoleRef: roleRef,
  subscriberScope: {
    kind: "project",
    userWorldId: "user_world_regression",
    projectId: "project_alpha",
  },
  sourceStreamPatterns: ["project:project_alpha", "artifact:alpha_*"],
  eventActTypeRefs: [],
  epistemicPostures: ["progress_reported", "premise_contradicted", "closure_submitted"],
  objectScopeRefs: [],
  materialityPredicateRef: ref("materiality_predicate", "normal_or_higher"),
  deliveryPolicy: "coalesced_digest",
  wakePolicy: "if_suspended",
  coalescingPolicyRef: ref("coalescing_policy", "project_progress"),
  evidenceVisibilityPolicyRef: visibilityPolicyRef,
  operationalPolicy: {
    debounceWindowMs: 60_000,
    maximumEventsPerDelivery: 10,
    maximumPendingEvents: 20,
    maximumQueuedDeliveries: 8,
    maximumWakeFrequencyMs: 10_000,
    priorityThreshold: "normal",
    coalescingKey: "subscription",
    supersessionBehavior: "retain_all",
  },
  revision: 1,
}, { now });

const premiseV1 = ref("aro_premise", "selector_binding", "1");
const evidenceRef = ref("registered_evidence", "run_frame_12_16");
function ledgerEvent(sequence, overrides = {}) {
  const eventId = overrides.ledgerEventId || `ledger_event_${sequence}`;
  return {
    schema: "direct_epistemic_ledger_event@1",
    ledgerEventId: eventId,
    ledgerEventDigest: digest(`${eventId}:${sequence}`),
    globalSequence: sequence,
    streamRefs: [
      {
        schema: "direct_ledger_stream_ref@1",
        streamType: "world",
        streamId: "user_world_regression",
        streamKey: "world:user_world_regression",
      },
      {
        schema: "direct_ledger_stream_ref@1",
        streamType: "project",
        streamId: "project_alpha",
        streamKey: "project:project_alpha",
      },
    ],
    subjectScope: {
      kind: "project",
      userWorldId: "user_world_regression",
      projectId: "project_alpha",
    },
    actTypeRef: ref("ledger_act_type", overrides.actType || "report_progress"),
    actClass: overrides.actClass || "observation",
    epistemicPosture: overrides.epistemicPosture || "progress_reported",
    objectRefs: overrides.subjectRefs || [premiseV1],
    affectsRefs: overrides.affectedRefs || [],
    contradictsRefs: overrides.contradictsRefs || [],
    supersedesRefs: overrides.supersedesRefs || [],
    evidenceRefs: overrides.evidenceRefs || [evidenceRef],
    materiality: overrides.materiality || "normal",
    terminal: overrides.terminal === true,
    rendererSafeSummary: overrides.rendererSafeSummary || `Progress checkpoint ${sequence}`,
    rawSecretIncluded: false,
  };
}

const committedOutbox = [];
const persistedSnapshots = [];
const broker = new DirectLedgerSubscriptionBroker({
  standings: [standing],
  now,
  recipientResolver: () => ({ agentRef, agentRunRef }),
  visibilityResolver: ({ match }) => ({
    semanticSummary: match.rendererSafeSummary,
    visibleObjectRefs: match.affectedRefs,
    visibleEvidenceRefs: [evidenceRef],
    withheldEvidenceCount: 0,
  }),
  persistence: {
    commitOutbox: (delivery) => committedOutbox.push(delivery.deliveryId),
    persistSnapshot: (snapshot) => persistedSnapshots.push(snapshot),
  },
});

const progressEvents = Array.from({ length: 10 }, (_, index) => ledgerEvent(index + 1));
const routed = broker.routeEvents(progressEvents);
assert.equal(routed.deliveries.length, 1);
assert.equal(routed.deliveries[0].eventRefs.length, 10);
assert.equal(routed.deliveries[0].boundedProjection.eventCount, 10);
assert.equal(committedOutbox.length, 1);
assert.equal(routed.deferredMatchCount, 0);
assert.equal(routed.deliveries[0].deliveryPosture, "queued");
assert.equal(routed.deliveries[0].wakeEligible, true);
validateLedgerDeliveryEnvelope(routed.deliveries[0]);

const duplicateRoute = broker.routeEvents(progressEvents, { flushAll: true });
assert.equal(duplicateRoute.deliveries.length, 0);
assert.equal(duplicateRoute.duplicates.length, 10);
assert.equal(committedOutbox.length, 1);

const delivered = broker.markDelivered(routed.deliveries[0].deliveryId);
assert.equal(delivered.deliveryPosture, "delivered");
const ack = broker.acknowledge(delivered.deliveryId, { acknowledgedByRef: agentRunRef });
assert.equal(ack.state, "acknowledged");
assert.equal(ack.cursor.acknowledgedSequence, 10);
const replayAck = broker.acknowledge(delivered.deliveryId, { acknowledgedByRef: agentRunRef });
assert.equal(replayAck.state, "idempotent_replay");
assert.equal(replayAck.cursor.acknowledgedSequence, 10);

const oldCursor = buildSubscriptionCursor({
  subscriptionRef: delivered.subscriptionRef,
  acknowledgedSequence: 99,
});
const staleAck = acknowledgeLedgerDelivery(delivered, oldCursor, {}, { now });
assert.equal(staleAck.state, "idempotent_or_stale");
assert.equal(staleAck.cursor.acknowledgedSequence, 99);

expectCode(
  () => broker.removeStanding(standing.standingId),
  "ledger_constitutional_subscription_removal_forbidden",
);

expectCode(() => buildDiscretionaryLedgerWatch({
  watchId: "watch_illegal_world_scope",
  ownerRoleRef: roleRef,
  ownerScope: {
    kind: "project",
    userWorldId: "user_world_regression",
    projectId: "project_alpha",
  },
  subscriberScope: {
    kind: "user_world",
    userWorldId: "user_world_regression",
  },
  readableScopes: [{
    kind: "project",
    userWorldId: "user_world_regression",
    projectId: "project_alpha",
  }],
  sourceStreamPatterns: ["world:*"],
  evidenceVisibilityPolicyRef: visibilityPolicyRef,
}), "ledger_watch_scope_widening");

expectCode(() => buildDiscretionaryLedgerWatch({
  watchId: "watch_illegal_always_wake",
  ownerRoleRef: roleRef,
  ownerScope: standing.subscriberScope,
  subscriberScope: standing.subscriberScope,
  readableScopes: [standing.subscriberScope],
  sourceStreamPatterns: ["project:project_alpha"],
  wakePolicy: "always_new_run",
  evidenceVisibilityPolicyRef: visibilityPolicyRef,
}), "ledger_watch_always_wake_forbidden");

const legalWatch = buildDiscretionaryLedgerWatch({
  watchId: "watch_project_alpha_review",
  ownerRoleRef: roleRef,
  ownerScope: standing.subscriberScope,
  subscriberScope: standing.subscriberScope,
  readableScopes: [standing.subscriberScope],
  sourceStreamPatterns: ["project:project_alpha"],
  epistemicPostures: ["closure_submitted"],
  deliveryPolicy: "terminal_only",
  wakePolicy: "never",
  evidenceVisibilityPolicyRef: visibilityPolicyRef,
}, { now });
broker.registerWatch(legalWatch);

const pressureStanding = buildNotificationStanding({
  ...standing,
  standingId: "standing_pressure",
  standingDigest: undefined,
  operationalPolicy: {
    ...standing.operationalPolicy,
    maximumEventsPerDelivery: 20,
    maximumPendingEvents: 2,
    debounceWindowMs: 120_000,
  },
}, { now });
const pressureBroker = new DirectLedgerSubscriptionBroker({ standings: [pressureStanding], now });
const pressure = pressureBroker.routeEvents([
  ledgerEvent(101),
  ledgerEvent(102),
  ledgerEvent(103),
]);
assert.equal(pressure.backpressureNotices.length, 1);
assert.equal(pressure.backpressureNotices[0].acceptedAsDelivered, false);
assert.equal(pressure.deferredMatchCount, 2);
const pressureSnapshot = pressureBroker.snapshot();
validateLedgerSubscriptionBrokerSnapshot(pressureSnapshot);
assert.equal(pressureSnapshot.pending[0].matches.length, 2);
assert.equal(pressureSnapshot.backpressureNotices.length, 1);
const restoredPressureBroker = new DirectLedgerSubscriptionBroker({
  state: pressureSnapshot,
  now,
});
assert.equal(restoredPressureBroker.snapshot().pending[0].matches.length, 2);
assert.equal(restoredPressureBroker.snapshot().backpressureNotices.length, 1);

const nativeKernelStanding = buildNotificationStanding({
  ...standing,
  standingId: "standing_native_kernel_event",
  standingDigest: undefined,
  epistemicPostures: ["candidate"],
  deliveryPolicy: "immediate_delta",
  wakePolicy: "never",
}, { now });
const nativeKernelEvent = buildEpistemicLedgerEvent({
  streamRefs: [
    "world:user_world_regression",
    "project:project_alpha",
  ],
  actTypeRef: ref("ledger_act_type_constitution", "propose_claim@1"),
  actClass: "proposal",
  authorshipKind: "semantic_role",
  actorRef: agentRef,
  roleLaneRef: roleRef,
  agentRunRef,
  subjectScope: standing.subscriberScope,
  objectRefs: [premiseV1],
  evidenceRefs: [evidenceRef],
  affectsRefs: [premiseV1],
  sourceEventRefs: [],
  expectedRevisionVector: [],
  epistemicPosture: "candidate",
  authorityPosture: "proposal_only",
  typedPayloadSchema: "operator_hypothesis@1",
  typedPayload: {
    claimType: "operator_hypothesis",
    candidate: "rigid_translation_with_rebinding",
  },
  rendererSafeSummary: "A native kernel claim candidate was proposed.",
  idempotencyKey: "native-kernel-proposal-1",
  operationScope: "propose_claim",
  affectedContextRefs: [],
}, {
  globalSequence: 200,
  previousLedgerDigest: digest("ledger-sequence-199"),
  now,
});
const nativeKernelBroker = new DirectLedgerSubscriptionBroker({
  standings: [nativeKernelStanding],
  now,
});
const nativeKernelRoute = nativeKernelBroker.routeEvents([nativeKernelEvent]);
assert.equal(nativeKernelRoute.deliveries.length, 1);
assert.equal(nativeKernelRoute.deliveries[0].eventRefs[0].id, nativeKernelEvent.ledgerEventId);

const contradiction = ledgerEvent(20, {
  actType: "raise_contradiction",
  actClass: "challenge",
  epistemicPosture: "premise_contradicted",
  contradictsRefs: [premiseV1],
  materiality: "critical",
  rendererSafeSummary: "A premise pinned into the worker constitution is contradicted.",
});
const urgentBroker = new DirectLedgerSubscriptionBroker({
  standings: [standing],
  now,
  recipientResolver: () => ({ agentRef, agentRunRef }),
  visibilityResolver: () => ({
    semanticSummary: "A protected contradiction exists; pause governed mutation.",
    visibleObjectRefs: [premiseV1],
    visibleEvidenceRefs: [],
    withheldEvidenceCount: 1,
    protectedNoticeOnly: true,
  }),
});
const urgent = urgentBroker.routeEvents([contradiction]);
assert.equal(urgent.deliveries.length, 1);
assert.equal(urgent.deliveries[0].boundedProjection.withheldEvidenceCount, 1);
assert.equal(urgent.deliveries[0].boundedProjection.entries[0].protectedNoticeOnly, true);

const terminalStanding = buildNotificationStanding({
  ...standing,
  standingId: "standing_terminal_bypass",
  standingDigest: undefined,
  epistemicPostures: ["closure_submitted"],
  deliveryPolicy: "coalesced_digest",
  operationalPolicy: {
    ...standing.operationalPolicy,
    debounceWindowMs: 120_000,
  },
}, { now });
const terminalBroker = new DirectLedgerSubscriptionBroker({
  standings: [terminalStanding],
  now,
});
const terminalRoute = terminalBroker.routeEvents([ledgerEvent(21, {
  epistemicPosture: "closure_submitted",
  terminal: true,
  materiality: "normal",
})]);
assert.equal(terminalRoute.deliveries.length, 1);

const delivery = urgent.deliveries[0];
const hydrationRequest = buildLedgerContextHydrationRequest({
  delivery,
  visibilityPolicyRef,
  requestedObjectRefs: [premiseV1],
  requestedEvidenceRefs: [],
}, { now });
assert.equal(hydrationRequest.importOperation, "IMPORT_CONTEXT");
assert.equal(hydrationRequest.deliveryPayloadIsAuthority, false);

const bundleRef = ref("semantic_context_bundle", "bundle_contradiction");
const manifestRef = ref("operational_meta_context_manifest", "manifest_contradiction");
const selectionWitnessRef = ref("semantic_context_selection_witness", "witness_contradiction");
const contextAdmission = hydrateLedgerDelivery({
  request: hydrationRequest,
  delivery,
  importContext: ({ operation, hydrationRequest: request }) => {
    assert.equal(operation, "IMPORT_CONTEXT");
    assert.equal(request.hydrationRequestId, hydrationRequest.hydrationRequestId);
    return {
      bundleRef,
      operationalManifestRef: manifestRef,
      selectionWitnessRef,
      selectedObjectRefs: [premiseV1],
      selectedEvidenceRefs: [],
      omittedRefs: [evidenceRef],
      omittedCounts: { visibility_policy: 1 },
      freshness: "fresh",
    };
  },
}, { now });
validateLedgerContextAdmissionEnvelope(contextAdmission);
assert.equal(contextAdmission.hydrationPosture, "partially_imported");
assert.equal(contextAdmission.importedObjectRefs.length, 1);
assert.equal(contextAdmission.omittedRefs.length, 1);
assert.equal(contextAdmission.safeForPromptProjection, true);
assert.equal(contextAdmission.grantsAuthority, false);

const affectedManifest = {
  operationalMetaContextId: "operational_context_affected",
  digest: digest("operational_context_affected"),
  sourceRevisionRefs: [premiseV1],
  agentInstantiationRef: agentRef,
  agentRunRef,
  governedActionClasses: ["patch", "commit", "publish"],
};
const unrelatedManifest = {
  operationalMetaContextId: "operational_context_unrelated",
  digest: digest("operational_context_unrelated"),
  sourceRevisionRefs: [ref("aro_premise", "another_project_premise")],
  agentInstantiationRef: ref("agent", "other_worker"),
  agentRunRef: ref("agent_run", "other_worker_run"),
};
const invalidationNotices = deriveContextInvalidationNotices({
  event: contradiction,
  manifests: [affectedManifest, unrelatedManifest],
  visibilityResolver: () => ({
    visibleEvidenceRefs: [],
    withheldEvidenceCount: 1,
    protectedNoticeOnly: true,
  }),
}, { now });
assert.equal(invalidationNotices.length, 1);
assert.equal(invalidationNotices[0].affectedManifestRef.id, "operational_context_affected");
assert.deepEqual(invalidationNotices[0].blockedActionClasses, ["commit", "patch", "publish"]);
assert.equal(invalidationNotices[0].protectedNoticeOnly, true);
assert.equal(invalidationNotices[0].contextBindingStale, true);

const invalidationAck = acknowledgeContextInvalidation(invalidationNotices[0], {
  actorRef: agentRunRef,
  resolution: "revise",
}, { now });
assert.equal(invalidationAck.notice.invalidationPosture, "revised");
assert.equal(invalidationAck.notice.contextBindingStale, false);
expectCode(() => acknowledgeContextInvalidation(invalidationNotices[0], {
  actorRef: agentRunRef,
  resolution: "justify_continue",
}), "ledger_context_invalidation_justification_required");

const activeDispatch = adaptLedgerDeliveryToContinuation({
  delivery,
  contextAdmission,
  runPosture: "active_generating",
  targetAgentRef: agentRef,
  targetAgentRunRef: agentRunRef,
}, { now });
assert.equal(activeDispatch.disposition, "safe_boundary_queued");
assert.equal(activeDispatch.midTokenPreemptionAttempted, false);
assert.equal(activeDispatch.pollingRequired, false);
assert.equal(activeDispatch.wakeEvent, null);

const suspension = buildAgentSuspensionState({
  suspensionId: "suspension_pm_alpha",
  agentId: agentRef.id,
  agentRunId: agentRunRef.id,
  reason: "awaiting_external_event",
  awaitingWorkIds: [],
  continuationContractRef: ref("continuation_contract", "ledger_delivery_contract"),
  status: "active",
}, { now });
const suspendedDispatch = adaptLedgerDeliveryToContinuation({
  delivery,
  contextAdmission,
  runPosture: "suspended",
  targetAgentRef: agentRef,
  targetAgentRunRef: agentRunRef,
  suspension,
}, { now });
assert.equal(suspendedDispatch.disposition, "continuation_ready");
assert.equal(suspendedDispatch.wakeEvent.reason, "external_event");
assert.equal(suspendedDispatch.continuationPacket.resumeReason, "external_event");
assert.equal(suspendedDispatch.providerCallStarted, false);

const terminalDispatch = adaptLedgerDeliveryToContinuation({
  delivery,
  contextAdmission,
  runPosture: "terminal",
  targetAgentRef: agentRef,
  targetAgentRunRef: agentRunRef,
}, { now });
assert.equal(terminalDispatch.disposition, "semantic_inbox_only");
assert.equal(terminalDispatch.wakeSuppressionReason, "terminal_run_not_resurrected");
assert.equal(terminalDispatch.wakeEvent, null);

const newRunStanding = buildNotificationStanding({
  ...standing,
  standingId: "standing_worldmanager_terminal",
  standingDigest: undefined,
  deliveryPolicy: "immediate_delta",
  wakePolicy: "always_new_run",
}, { now });
const newRunBroker = new DirectLedgerSubscriptionBroker({
  standings: [newRunStanding],
  now,
  recipientResolver: () => ({ agentRef, agentRunRef }),
  visibilityResolver: () => ({ visibleObjectRefs: [premiseV1] }),
});
const closureRoute = newRunBroker.routeEvents([ledgerEvent(30, {
  epistemicPosture: "closure_submitted",
  terminal: true,
  materiality: "high",
})]);
assert.equal(closureRoute.deliveries.length, 1);
const closureDelivery = closureRoute.deliveries[0];
const closureRequest = buildLedgerContextHydrationRequest({
  delivery: closureDelivery,
  visibilityPolicyRef,
}, { now });
const closureAdmission = hydrateLedgerDelivery({
  request: closureRequest,
  delivery: closureDelivery,
  importContext: () => ({
    bundleRef: ref("semantic_context_bundle", "closure_bundle"),
    operationalManifestRef: ref("operational_meta_context_manifest", "closure_manifest"),
    selectionWitnessRef: ref("semantic_context_selection_witness", "closure_witness"),
    selectedObjectRefs: [premiseV1],
  }),
}, { now });
const allocatedRunRef = ref("agent_run", "pm_alpha_run_8");
const newRunDispatch = adaptLedgerDeliveryToContinuation({
  delivery: closureDelivery,
  contextAdmission: closureAdmission,
  runPosture: "terminal",
  targetAgentRef: agentRef,
  targetAgentRunRef: agentRunRef,
  allocatedAgentRunRef: allocatedRunRef,
}, { now });
assert.equal(newRunDispatch.disposition, "new_run_requested");
assert.equal(newRunDispatch.continuationPacket.targetAgentRunId, allocatedRunRef.id);
assert.notEqual(newRunDispatch.continuationPacket.targetAgentRunId, agentRunRef.id);
expectCode(() => adaptLedgerDeliveryToContinuation({
  delivery: closureDelivery,
  contextAdmission: closureAdmission,
  runPosture: "terminal",
  targetAgentRef: agentRef,
  targetAgentRunRef: agentRunRef,
  allocatedAgentRunRef: agentRunRef,
}), "ledger_context_terminal_run_resurrection");

const snapshot = broker.persistDurableSnapshot();
validateLedgerSubscriptionBrokerSnapshot(snapshot);
assert.equal(snapshot.pollingRequired, false);
assert.equal(snapshot.standings.length, 1);
assert.equal(snapshot.watches.length, 1);
assert.equal(snapshot.pending.length, 0);
assert.equal(snapshot.deliveries.length, 1);
assert.equal(snapshot.cursors.length, 1);
assert.equal(snapshot.acknowledgements.length, 1);
assert.ok(Array.isArray(snapshot.backpressureNotices));
assert.equal(persistedSnapshots.length, 1);
assert.equal(
  persistedSnapshots[0].snapshotDigest,
  snapshot.snapshotDigest,
);
assert.deepEqual(
  Object.keys(BROKER_PERSISTENCE_CONTRACT).sort(),
  [
    "commitOutbox",
    "persistBackpressureNotice",
    "persistCursorAndAck",
    "persistDelivery",
    "persistPendingState",
    "persistSnapshot",
  ],
);
const restartedBroker = new DirectLedgerSubscriptionBroker({
  state: snapshot,
  now,
});
assert.equal(restartedBroker.retryableDeliveries().length, 0);
assert.equal(restartedBroker.snapshot().cursors[0].acknowledgedSequence, 10);
assert.equal(restartedBroker.snapshot().standings.length, 1);
assert.equal(restartedBroker.snapshot().watches.length, 1);
assert.equal(restartedBroker.snapshot().acknowledgements.length, 1);
const restartReplayAck = restartedBroker.acknowledge(delivered.deliveryId, {
  acknowledgedByRef: agentRunRef,
});
assert.equal(restartReplayAck.state, "idempotent_replay");
assert.equal(restartReplayAck.cursor.acknowledgedSequence, 10);

console.log(JSON.stringify({
  result: "passed",
  constitutionalStandingRemovalBlocked: true,
  watchScopeWideningBlocked: true,
  watchAlwaysWakeBlocked: true,
  progressEventsCoalesced: progressEvents.length,
  deliveryEnvelopeCount: routed.deliveries.length,
  atLeastOnceDedupeProved: duplicateRoute.duplicates.length,
  monotonicCursor: ack.cursor.acknowledgedSequence,
  backpressureVisible: pressure.backpressureNotices.length,
  urgentContradictionBypassedDebounce: urgent.deliveries.length === 1,
  protectedEvidenceWithheld: contextAdmission.omittedRefs.length,
  exactContextHydrationProved: true,
  affectedContextsInvalidated: invalidationNotices.length,
  unrelatedContextsInvalidated: 0,
  activeRunMidTokenPreempted: activeDispatch.midTokenPreemptionAttempted,
  suspendedRunWakePrepared: suspendedDispatch.disposition === "continuation_ready",
  terminalRunResurrected: terminalDispatch.wakeEvent !== null,
  authorizedFreshRunPrepared: newRunDispatch.disposition === "new_run_requested",
  rawPollingRequired: snapshot.pollingRequired,
  durableSnapshotRestored: true,
  durableSnapshotAcknowledgements: snapshot.acknowledgements.length,
  durableSnapshotPendingAndBackpressureRestored: true,
  nativeEpistemicLedgerKernelEventRouted: true,
}, null, 2));
