#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");
const {
  DirectEpistemicLedgerStore,
} = require("../src/main/direct/worldmanager/epistemic-ledger-store");
const {
  buildLedgerActTypeConstitution,
  ledgerActTypeConstitutionRef,
  validateEpistemicLedgerEvent,
  validateLedgerWriteReceipt,
} = require("../src/main/direct/worldmanager/epistemic-ledger-kernel");

const fixedEpoch = Date.parse("2026-08-01T12:00:00.000Z");
let clockTick = 0;
const now = () => fixedEpoch + clockTick++ * 1000;
const tempRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "direct-sc11-ledger-regression-"),
);
const dbPath = path.join(tempRoot, "world-manager-control-plane.sqlite");

function ref(kind, id, digestCharacter = "a") {
  return {
    kind,
    id,
    digest: `sha256:${digestCharacter.repeat(64)}`,
  };
}

function expectCode(action, code) {
  assert.throws(action, (error) => {
    assert.equal(error?.code, code);
    return true;
  });
}

function claimInput(actTypeRef, overrides = {}) {
  return {
    streamRefs: ["world:rose", "project:project_alpha"],
    actTypeRef,
    authorshipKind: "semantic_role",
    actorRef: ref("agent_instance", "worker_alpha", "b"),
    roleLaneRef: ref(
      "role_lane_constitution",
      "implementation_worker",
      "c",
    ),
    agentRunRef: ref("agent_run", "run_alpha", "d"),
    subjectScope: {
      kind: "project",
      userWorldId: "rose",
      projectId: "project_alpha",
    },
    objectRefs: [ref("claim", "claim_selector_model", "e")],
    evidenceRefs: [ref("test_run", "focused_test_1", "f")],
    affectsRefs: [ref("project_obligation", "selector_semantics", "1")],
    sourceEventRefs: [],
    expectedRevisionVector: [
      {
        scopeRef: ref("project", "project_alpha", "2"),
        revision: 41,
      },
    ],
    typedPayload: {
      claimType: "operator_hypothesis",
      prior: "selector_transfer",
      candidate: "rigid_translation_with_rebinding",
    },
    rendererSafeSummary: "Selector-model candidate proposed.",
    idempotencyKey: "claim-selector-model-revision-41",
    affectedContextRefs: [
      ref("operational_meta_context", "worker_alpha_context", "3"),
    ],
    ...overrides,
  };
}

function outboxSeed(overrides = {}) {
  return {
    subscriptionRef: ref(
      "notification_standing",
      "project_manager_material_claims",
      "4",
    ),
    recipientRef: ref("role_instance", "project_manager_alpha", "5"),
    deliveryPolicy: "safe_boundary",
    matchReason: "Material project claim matched constitutional standing.",
    materiality: "material",
    ...overrides,
  };
}

const results = [];
function game(name, action) {
  action();
  results.push({ name, status: "passed" });
}

let store;
try {
  store = new DirectEpistemicLedgerStore({ dbPath, now });

  const proposeClaim = buildLedgerActTypeConstitution(
    {
      actTypeId: "propose_claim",
      revision: 1,
      operationName: "ledger.propose_claim",
      actClass: "proposal",
      authorshipKinds: ["semantic_role"],
      allowedRights: ["observe", "propose"],
      allowedRoleLanes: ["implementation_worker"],
      typedPayloadSchema: "direct_operator_hypothesis_payload@1",
      defaultEpistemicPosture: "candidate",
      defaultAuthorityPosture: "proposal_only",
      rendererSafeLabel: "Propose claim",
    },
    { now },
  );
  const proposeClaimRef = ledgerActTypeConstitutionRef(proposeClaim);

  const mechanicalWitness = buildLedgerActTypeConstitution(
    {
      actTypeId: "observe_world_manager_event",
      revision: 1,
      operationName: "ledger.observe_world_manager_event",
      actClass: "mechanical_witness",
      authorshipKinds: ["harness_mechanical"],
      allowedRights: ["observe"],
      allowedRoleLanes: ["world_manager_harness"],
      typedPayloadSchema:
        "direct_world_manager_event_ledger_adapter_payload@1",
      rendererSafeLabel: "Observe WorldManager event",
    },
    { now },
  );
  const mechanicalWitnessRef = ledgerActTypeConstitutionRef(
    mechanicalWitness,
  );

  game("act-type constitution registration is revision exact", () => {
    const first = store.registerActTypeConstitution(proposeClaim);
    assert.equal(first.changed, true);
    assert.deepEqual(first.ref, proposeClaimRef);
    const replay = store.registerActTypeConstitution(proposeClaim);
    assert.equal(replay.changed, false);
    store.registerActTypeConstitution(mechanicalWitness);
    assert.equal(store.listActTypeConstitutions().length, 2);

    const conflicting = {
      ...proposeClaim,
      rendererSafeLabel: "Changed in place",
    };
    conflicting.digest = require(
      "../src/main/direct/worldmanager/control-plane",
    ).digestFor(
      "direct_ledger_act_type_constitution@1",
      conflicting,
      ["digest"],
    );
    expectCode(
      () => store.registerActTypeConstitution(conflicting),
      "ledger_act_type_revision_conflict",
    );
  });

  let firstWrite;
  game("append atomically persists event, streams, projections, outbox, receipt", () => {
    firstWrite = store.appendEvent(
      claimInput(proposeClaimRef),
      { outboxSeeds: [outboxSeed()] },
    );
    validateEpistemicLedgerEvent(firstWrite.event);
    validateLedgerWriteReceipt(firstWrite.receipt);
    assert.equal(firstWrite.event.globalSequence, 1);
    assert.equal(firstWrite.receipt.appendState, "appended");
    assert.equal(firstWrite.receipt.canonicalEffect, false);
    assert.equal(
      firstWrite.receipt.deliveryDispatchState,
      "outbox_committed",
    );
    assert.equal(firstWrite.outboxSeeds.length, 1);
    assert.equal(store.listStreamEvents("world:rose").length, 1);
    assert.equal(store.listStreamEvents("project:project_alpha").length, 1);
    assert.equal(
      store.getProjectionHead("stream:project:project_alpha")
        .headEventRef.id,
      firstWrite.event.ledgerEventId,
    );
    assert.equal(store.listPendingOutboxSeeds().length, 1);
    assert.deepEqual(
      store.getWriteReceipt(firstWrite.event.ledgerEventId),
      firstWrite.persistedReceipt,
    );
  });

  game("idempotent replay preserves exact event and rejects changed meaning", () => {
    const replay = store.appendEvent(
      claimInput(proposeClaimRef),
      { outboxSeeds: [outboxSeed()] },
    );
    assert.equal(replay.receipt.appendState, "idempotent_replay");
    assert.equal(
      replay.event.ledgerEventId,
      firstWrite.event.ledgerEventId,
    );
    assert.equal(replay.event.eventDigest, firstWrite.event.eventDigest);
    assert.deepEqual(replay.persistedReceipt, firstWrite.persistedReceipt);
    assert.equal(store.listEvents().length, 1);
    assert.equal(store.listPendingOutboxSeeds().length, 1);

    expectCode(
      () => store.appendEvent(
        claimInput(proposeClaimRef, {
          typedPayload: {
            claimType: "operator_hypothesis",
            candidate: "different_candidate",
          },
        }),
        { outboxSeeds: [outboxSeed()] },
      ),
      "epistemic_ledger_idempotency_conflict",
    );
  });

  game("semantic replay is independent of subscriber topology", () => {
    const secondSubscriber = outboxSeed({
      subscriptionRef: ref(
        "notification_standing",
        "project_manager_secondary",
        "6",
      ),
      recipientRef: ref(
        "role_instance",
        "project_manager_secondary",
        "7",
      ),
    });
    const replay = store.appendEvent(
      claimInput(proposeClaimRef),
      { outboxSeeds: [outboxSeed(), secondSubscriber] },
    );
    assert.equal(replay.receipt.appendState, "idempotent_replay");
    assert.equal(
      replay.event.ledgerEventId,
      firstWrite.event.ledgerEventId,
    );
    assert.equal(
      replay.outboxSeeds.length,
      1,
      "a later subscriber must not rewrite the original atomic outbox",
    );
    assert.equal(store.listEvents().length, 1);
  });

  game("act constitution rejects lane and authorship inflation", () => {
    expectCode(
      () => store.appendEvent(claimInput(proposeClaimRef, {
        idempotencyKey: "wrong-lane",
        roleLaneRef: ref("role_lane_constitution", "world_manager", "6"),
      })),
      "epistemic_ledger_act_constitution_mismatch",
    );
    expectCode(
      () => store.appendEvent(claimInput(proposeClaimRef, {
        idempotencyKey: "wrong-authorship",
        authorshipKind: "harness_mechanical",
      })),
      "epistemic_ledger_act_constitution_mismatch",
    );
  });

  game("failed outbox insertion rolls back the entire append", () => {
    const before = store.listEvents().length;
    const duplicate = outboxSeed();
    assert.throws(() => store.appendEvent(
      claimInput(proposeClaimRef, {
        idempotencyKey: "atomic-outbox-failure",
        objectRefs: [ref("claim", "atomic_failure_claim", "7")],
      }),
      { outboxSeeds: [duplicate, duplicate] },
    ));
    assert.equal(store.listEvents().length, before);
    assert.equal(store.listPendingOutboxSeeds().length, 1);
  });

  let adaptedWrite;
  game("WorldManager adapter stores exact refs without copying raw event bodies", () => {
    const sourceEvent = {
      semanticEventId: "wm_event_example",
      eventDigest: `sha256:${"8".repeat(64)}`,
      eventKind: "manager_result_observed",
      presentationState: "completed",
      projectId: "project_alpha",
      lineageRootId: "lineage_alpha",
      privateProviderPayload: "must-not-be-copied",
    };
    adaptedWrite = store.appendWorldManagerEvent(sourceEvent, {
      actTypeRef: mechanicalWitnessRef,
      actorRef: ref("harness_adapter", "wm_event_adapter", "9"),
      roleLaneRef: ref(
        "role_lane_constitution",
        "world_manager_harness",
        "0",
      ),
      userWorldId: "rose",
    });
    assert.equal(adaptedWrite.event.globalSequence, 2);
    assert.equal(
      adaptedWrite.event.previousLedgerDigest,
      firstWrite.event.eventDigest,
    );
    assert.equal(adaptedWrite.event.typedPayload.rawEventBodyIncluded, false);
    assert.equal(
      JSON.stringify(adaptedWrite.event).includes("must-not-be-copied"),
      false,
    );
  });

  game("digest chain, receipts, and projections verify before restart", () => {
    const integrity = store.verifyLedgerIntegrity();
    assert.equal(integrity.ok, true);
    assert.equal(integrity.eventCount, 2);
    assert.equal(integrity.headSequence, 2);
    assert.equal(integrity.headDigest, adaptedWrite.event.eventDigest);
    assert.equal(store.verifyProjectionHeads().ok, true);
  });

  store.close();
  store = null;

  game("same-file restart preserves outbox and rebuilds disposable projections", () => {
    const raw = new DatabaseSync(dbPath);
    raw.exec("pragma foreign_keys = ON");
    raw.prepare(`
      delete from wm_epistemic_projection_heads
      where projection_key = 'stream:project:project_alpha'
    `).run();
    raw.close();

    store = new DirectEpistemicLedgerStore({ dbPath, now });
    const status = store.verifyRestartState();
    assert.equal(status.ok, true);
    assert.equal(store.verifyProjectionHeads().ok, true);
    assert.equal(store.listPendingOutboxSeeds().length, 1);
    assert.equal(store.listEvents().length, 2);
    assert.equal(
      store.getProjectionHead("stream:project:project_alpha")
        .headEventRef.id,
      adaptedWrite.event.ledgerEventId,
    );
  });

  game("restart-recovered outbox supports retry and idempotent dispatch", () => {
    const seedId = firstWrite.outboxSeeds[0].outboxSeedId;
    const failure = store.markOutboxDispatchFailed(seedId, {
      failureCode: "recipient_temporarily_unavailable",
      rendererSafeSummary: "Recipient will be retried.",
      retryable: true,
    });
    assert.equal(failure.dispatchState, "retry_pending");
    assert.equal(failure.attemptCount, 1);
    assert.equal(store.listPendingOutboxEntries().length, 1);

    const deliveryRef = ref("ledger_delivery", "delivery_alpha", "a");
    const dispatched = store.markOutboxDispatched(seedId, deliveryRef);
    assert.equal(dispatched.changed, true);
    assert.equal(store.listPendingOutboxEntries().length, 0);
    assert.equal(
      store.markOutboxDispatched(seedId, deliveryRef).changed,
      false,
    );
    expectCode(
      () => store.markOutboxDispatched(
        seedId,
        ref("ledger_delivery", "different_delivery", "b"),
      ),
      "ledger_outbox_dispatch_conflict",
    );
    assert.equal(store.verifyLedgerIntegrity().ok, true);

    store.close();
    store = new DirectEpistemicLedgerStore({ dbPath, now });
    assert.equal(store.listPendingOutboxEntries().length, 0);
    const persisted = store.listOutboxEntries({
      dispatchState: "dispatched",
    });
    assert.equal(persisted.length, 1);
    assert.deepEqual(persisted[0].deliveryRef, deliveryRef);
  });

  game("SC11 tables coexist with control-plane wm_meta in one database", () => {
    const raw = new DatabaseSync(dbPath);
    raw.exec(`
      create table if not exists wm_meta (
        key text primary key,
        value text not null
      );
    `);
    raw.prepare(`
      insert into wm_meta (key, value)
      values ('control_plane_revision', '77')
      on conflict(key) do update set value = excluded.value
    `).run();
    assert.equal(
      raw.prepare(`
        select value from wm_meta where key = 'control_plane_revision'
      `).get().value,
      "77",
    );
    assert.equal(
      raw.prepare(`
        select value from wm_epistemic_meta where key = 'store_schema'
      `).get().value,
      "direct_epistemic_ledger_store@1",
    );
    raw.close();
  });

  store.close();
  store = null;

  game("immutable-chain corruption fails closed but stays diagnosable", () => {
    const raw = new DatabaseSync(dbPath);
    raw.prepare(`
      update wm_epistemic_events
      set event_json = replace(
        event_json,
        'Selector-model candidate proposed.',
        'Tampered candidate.'
      )
      where global_sequence = 1
    `).run();
    raw.close();

    store = new DirectEpistemicLedgerStore({ dbPath, now });
    const diagnosis = store.verifyLedgerIntegrity();
    assert.equal(diagnosis.ok, false);
    assert.equal(store.descriptor().writable, false);
    expectCode(
      () => store.appendEvent(claimInput(proposeClaimRef, {
        idempotencyKey: "must-not-append-after-corruption",
      })),
      "epistemic_ledger_integrity_failed",
    );
  });

  console.log(JSON.stringify({
    schema: "direct_world_manager_epistemic_ledger_regression@1",
    status: "passed",
    gameCount: results.length,
    results,
    durableEventCountBeforeCorruption: 2,
    persistedOutboxSeedCount: 1,
    recoveredOutboxDispatchProved: true,
    restartProjectionRebuildProved: true,
    corruptionFailClosedProved: true,
    sameControlPlaneDatabasePathProved: true,
  }, null, 2));
} finally {
  try {
    store?.close();
  } catch {}
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
