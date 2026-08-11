#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  assertWorldManagerWorkbenchProjectionSafe,
  buildWorldManagerWorkbenchProjection,
  digestFor,
} = require(
  "../src/main/direct/worldmanager/control-plane",
);
const {
  DirectWorldManagerControlPlaneStore,
} = require(
  "../src/main/direct/worldmanager/control-plane-store",
);
const {
  DirectWorldManagerService,
} = require(
  "../src/main/direct/worldmanager/service",
);
const {
  buildOpenDecision,
} = require(
  "../src/main/direct/worldmanager/semantic-artifact-kernel",
);

let tick = Date.parse(
  "2026-07-30T12:00:00.000Z",
);
const now = () => {
  tick += 1_000;
  return tick;
};

const rootDir = fs.mkdtempSync(
  path.join(
    os.tmpdir(),
    "direct-world-manager-sc5-",
  ),
);
const store =
  new DirectWorldManagerControlPlaneStore({
    rootDir,
    now,
  });
store.ensureBootstrap({
  userWorldId: "user_world_sc5",
  projects: [{
    id: "project_sc5",
    name: "SC5 Project",
    summary:
      "Governed decision transition fixture.",
    runtimePath: "direct",
  }],
});
const ingress = store.appendUserIngress({
  schema:
    "direct_world_manager_submit_request@1",
  clientRequestId: "sc5_context_ingress",
  text: "Prepare SC5 decision fixtures.",
  scopeHint: {
    projectId: "project_sc5",
  },
  expectedProjectionRevision: null,
  attachmentDraftRefs: [],
});

function decision(input = {}) {
  return buildOpenDecision({
    sourceKind: "sc5_fixture",
    sourceKey: input.sourceKey,
    semanticIdentity: input.question,
    question: input.question,
    scope: {
      kind: "project",
      userWorldId: "user_world_sc5",
      projectId: "project_sc5",
    },
    resolutionMode: input.resolutionMode,
    options: input.options || [],
    dependencies: input.dependencies || [],
    consequences: [{
      effectClass: "fixture_effect",
      description:
        "Any downstream effect remains outside the decision transition.",
      posture: "possible",
    }],
    now,
  });
}

const fixtures = [
  decision({
    sourceKey: "mechanical_ready",
    question: "Which ready option applies?",
    resolutionMode: "mechanical",
    options: [{
      optionKey: "focused",
      label: "Focused",
      effectSummary:
        "Record the focused semantic posture.",
    }],
    dependencies: [{
      dependencyKind: "fixture",
      requirement:
        "Fixture evidence is available.",
      state: "satisfied",
      blocking: true,
    }],
  }),
  decision({
    sourceKey: "mechanical_blocked",
    question: "Which blocked option applies?",
    resolutionMode: "mechanical",
    options: [{
      optionKey: "blocked",
      label: "Blocked option",
    }],
    dependencies: [{
      dependencyKind: "fixture",
      requirement:
        "Missing evidence must be supplied.",
      state: "unsatisfied",
      blocking: true,
    }],
  }),
  decision({
    sourceKey: "semantic_relay",
    question: "How should this be revised?",
    resolutionMode: "semantic_relay",
  }),
  decision({
    sourceKey: "evidence_request",
    question: "What evidence is required?",
    resolutionMode: "evidence_request",
  }),
  decision({
    sourceKey: "authority_request",
    question: "Which authority is required?",
    resolutionMode: "authority_request",
  }),
];

store.transaction(() => {
  for (const artifact of fixtures) {
    store
      ._appendSemanticArtifactRevisionWithinTransaction(
        artifact,
      );
  }
  store._rebuildSemanticShelvesWithinTransaction();
  store.incrementRevision();
});

const initialProjection =
  buildWorldManagerWorkbenchProjection({
    ...store.snapshotData(),
    pipelineStage: "wm_k6_genesis",
    semanticIngressAvailable: true,
    workThreads: [],
  });
assertWorldManagerWorkbenchProjectionSafe(
  initialProjection,
);
if (
  process.env
    .CODEX_WORLD_MANAGER_SC5_INITIAL_PROJECTION_PATH
) {
  fs.writeFileSync(
    process.env
      .CODEX_WORLD_MANAGER_SC5_INITIAL_PROJECTION_PATH,
    JSON.stringify(initialProjection, null, 2),
  );
}

store.db.prepare(`
  insert into wm_context_requirement_sets (
    context_requirement_set_id,
    semantic_event_id,
    agent_instantiation_id,
    scope_kind,
    project_id,
    current_state,
    requirement_json,
    requirement_digest,
    created_at
  ) values (?, ?, ?, 'project', ?, 'current', '{}', ?, ?)
`).run(
  "context_requirement_sc5",
  ingress.event.semanticEventId,
  "agent_instantiation_sc5",
  "project_sc5",
  digestFor("fixture@1", {
    kind: "requirement",
  }),
  new Date(now()).toISOString(),
);
store.db.prepare(`
  insert into wm_semantic_context_imports (
    context_import_id,
    semantic_event_id,
    agent_instantiation_id,
    context_requirement_set_id,
    import_json,
    import_digest,
    created_at
  ) values (?, ?, ?, ?, '{}', ?, ?)
`).run(
  "context_import_sc5",
  ingress.event.semanticEventId,
  "agent_instantiation_sc5",
  "context_requirement_sc5",
  digestFor("fixture@1", {
    kind: "import",
  }),
  new Date(now()).toISOString(),
);
store.db.prepare(`
  insert into wm_semantic_context_bundles (
    context_bundle_id,
    context_import_id,
    semantic_event_id,
    agent_instantiation_id,
    cache_key,
    dependency_digest,
    freshness,
    current_state,
    bundle_json,
    bundle_digest,
    created_at
  ) values (?, ?, ?, ?, ?, ?, 'current', 'current', '{}', ?, ?)
`).run(
  "context_bundle_sc5",
  "context_import_sc5",
  ingress.event.semanticEventId,
  "agent_instantiation_sc5",
  "cache_sc5",
  digestFor("fixture@1", {
    kind: "dependency",
  }),
  digestFor("fixture@1", {
    kind: "bundle",
  }),
  new Date(now()).toISOString(),
);
store.db.prepare(`
  insert into wm_operational_meta_context_manifests (
    operational_meta_context_id,
    semantic_event_id,
    agent_instantiation_id,
    context_bundle_id,
    current_state,
    manifest_json,
    manifest_digest,
    created_at
  ) values (?, ?, ?, ?, 'current', '{}', ?, ?)
`).run(
  "operational_context_sc5",
  ingress.event.semanticEventId,
  "agent_instantiation_sc5",
  "context_bundle_sc5",
  digestFor("fixture@1", {
    kind: "manifest",
  }),
  new Date(now()).toISOString(),
);

const ready = store.semanticArtifact(
  fixtures[0].decisionId,
);
const readyOption = ready.options[0];
const mechanicalInput = {
  clientRequestId: "sc5_resolve_ready",
  decisionId: ready.decisionId,
  decisionDigest: ready.digest,
  expectedDecisionRevision:
    ready.header.revision,
  expectedProjectionRevision:
    store.revision(),
  transitionKind: "resolve_option",
  optionId: readyOption.optionId,
  optionDigest: readyOption.digest,
  actorId: "operator",
  actorRole: "operator",
};
const mechanical =
  store.transitionSemanticDecision(
    mechanicalInput,
  );
assert.equal(mechanical.receipt.state, "resolved");
assert.equal(
  mechanical.receipt.canonicalDecisionMutation,
  true,
);
assert.equal(
  mechanical.receipt.downstreamEffectsExecuted,
  false,
);
assert.equal(
  mechanical.transitionArtifact
    .downstreamEffectsExecuted,
  false,
);
assert.equal(
  mechanical.historyRelation.relationKind,
  "resolves_object",
);
assert.equal(
  mechanical.currentDecision.decisionState,
  "resolved",
);
assert.equal(
  mechanical
    .invalidatedSemanticContextBundleCount,
  1,
);
assert.equal(
  mechanical
    .invalidatedOperationalMetaContextCount,
  1,
);
assert.equal(
  store.semanticShelf(
    "project_open_decisions",
    "project",
    "project_sc5",
  ).semanticObjectRefs.length,
  4,
);

const replayRevision = store.revision();
const replay =
  store.transitionSemanticDecision(
    mechanicalInput,
  );
assert.equal(replay.reused, true);
assert.equal(replay.receipt.state, "resolved");
assert.equal(store.revision(), replayRevision);
assert.throws(
  () =>
    store.transitionSemanticDecision({
      ...mechanicalInput,
      actorId: "different_operator",
    }),
  (error) =>
    error.code ===
      "decision_transition_idempotency_conflict",
);

const blocked = store.semanticArtifact(
  fixtures[1].decisionId,
);
const blockedResult =
  store.transitionSemanticDecision({
    clientRequestId: "sc5_blocked",
    decisionId: blocked.decisionId,
    decisionDigest: blocked.digest,
    expectedDecisionRevision:
      blocked.header.revision,
    expectedProjectionRevision:
      store.revision(),
    transitionKind: "resolve_option",
    optionId: blocked.options[0].optionId,
    optionDigest: blocked.options[0].digest,
    actorId: "operator",
    actorRole: "operator",
  });
assert.equal(
  blockedResult.receipt.state,
  "blocked",
);
assert.equal(
  blockedResult.transitionArtifact,
  null,
);
assert.equal(
  store.semanticArtifact(
    blocked.decisionId,
  ).decisionState,
  "open",
);

const relay = store.semanticArtifact(
  fixtures[2].decisionId,
);
assert.throws(
  () =>
    store.transitionSemanticDecision({
      clientRequestId: "sc5_stale_revision",
      decisionId: relay.decisionId,
      decisionDigest: relay.digest,
      expectedDecisionRevision:
        relay.header.revision + 1,
      expectedProjectionRevision:
        store.revision(),
      transitionKind: "semantic_relay",
      semanticInput: "Revise this decision.",
      actorId: "operator",
      actorRole: "operator",
    }),
  (error) =>
    error.code ===
      "decision_transition_revision_conflict",
);

const relayRegistered =
  store.transitionSemanticDecision({
    clientRequestId: "sc5_relay",
    decisionId: relay.decisionId,
    decisionDigest: relay.digest,
    expectedDecisionRevision:
      relay.header.revision,
    expectedProjectionRevision:
      store.revision(),
    transitionKind: "semantic_relay",
    semanticInput:
      "Revise this decision around a lower verification budget.",
    actorId: "operator",
    actorRole: "operator",
  });
assert.equal(
  relayRegistered.receipt.state,
  "accepted",
);
assert.equal(
  relayRegistered.transitionArtifact.relayState,
  "pending_world_manager",
);
assert.equal(
  relayRegistered.historyRelation.relationKind,
  "requests_semantic_revision",
);
const relayCompleted =
  store.completeDecisionTransitionRelay({
    decisionTransitionRequestId:
      relayRegistered.request
        .decisionTransitionRequestId,
    relayEventRef: {
      kind: "world_manager_semantic_event",
      id: ingress.event.semanticEventId,
      digest: ingress.event.eventDigest,
    },
    relayState: "completed",
  });
assert.equal(
  relayCompleted.receipt.state,
  "relayed",
);
assert.equal(
  relayCompleted.receipt.receiptRevision,
  2,
);
assert.equal(
  store.semanticArtifact(
    relay.decisionId,
  ).decisionState,
  "open",
);

let relayedSubmitRequest = null;
const relayService =
  new DirectWorldManagerService({
    store,
    userWorldId: "user_world_sc5",
    projects: [{
      id: "project_sc5",
      name: "SC5 Project",
      summary:
        "Governed decision transition fixture.",
      runtimePath: "direct",
    }],
    activeProjectId: "project_sc5",
    now,
  });
relayService.started = true;
relayService.submit = async (request) => {
  relayedSubmitRequest = request;
  return {
    receipt: {
      semanticEventRef: {
        kind: "world_manager_semantic_event",
        id: ingress.event.semanticEventId,
        digest: ingress.event.eventDigest,
      },
      settlementState: "completed",
      state: "accepted",
    },
    projection: relayService.snapshot(),
  };
};
const serviceRelayInput =
  "Reframe this decision against the project constitution.";
const serviceRelayProjection =
  relayService.snapshot();
const serviceRelayBinding =
  serviceRelayProjection.semanticSurface
    .regionBindings.find((binding) =>
      binding.subjectRef.id ===
        relay.decisionId &&
      binding.selectedLens === "U");
assert.ok(serviceRelayBinding);
const serviceRelayBindingRef = {
  kind: "semantic_region_binding",
  id:
    serviceRelayBinding
      .semanticRegionBindingId,
  digest: serviceRelayBinding.digest,
};
await assert.rejects(
  () =>
    relayService.transitionDecision({
      clientRequestId:
        "sc5_service_relay_bad_region",
      decisionId: relay.decisionId,
      decisionDigest: relay.digest,
      expectedDecisionRevision:
        relay.header.revision,
      expectedProjectionRevision:
        store.revision(),
      transitionKind: "semantic_relay",
      semanticInput: serviceRelayInput,
      actorId: "operator",
      actorRole: "operator",
      semanticRegionBindingRef: {
        ...serviceRelayBindingRef,
        digest: digestFor(
          "tampered-semantic-region@1",
          serviceRelayBindingRef,
        ),
      },
    }),
  (error) =>
    error.code ===
      "world_manager_semantic_region_binding_invalid",
);
const serviceRelay =
  await relayService.transitionDecision({
    clientRequestId: "sc5_service_relay",
    decisionId: relay.decisionId,
    decisionDigest: relay.digest,
    expectedDecisionRevision:
      relay.header.revision,
    expectedProjectionRevision:
      store.revision(),
    transitionKind: "semantic_relay",
    semanticInput: serviceRelayInput,
    actorId: "operator",
    actorRole: "operator",
    semanticRegionBindingRef:
      serviceRelayBindingRef,
  });
assert.equal(
  serviceRelay.receipt.state,
  "relayed",
);
assert.equal(
  relayedSubmitRequest.text,
  serviceRelayInput,
);
assert.equal(
  relayedSubmitRequest.scopeHint.projectId,
  "project_sc5",
);
assert.equal(
  relayedSubmitRequest.scopeHint.proposalId,
  relay.decisionId,
);
assert.equal(
  relayedSubmitRequest.scopeHint
    .bindingPosture,
  "explicit_constraint",
);
assert.match(
  relayedSubmitRequest.clientRequestId,
  /^wm_decision_relay_ingress_/,
);
assert.deepEqual(
  relayedSubmitRequest.attachmentDraftRefs,
  [relayRegistered.request.decisionRef],
);
const serviceRelayRequestRow =
  store.db.prepare(`
    select request_json
    from wm_decision_transition_requests
    where client_request_id = ?
  `).get("sc5_service_relay");
assert.ok(serviceRelayRequestRow);
assert.deepEqual(
  JSON.parse(
    serviceRelayRequestRow.request_json,
  ).semanticRegionBindingRef,
  serviceRelayBindingRef,
);

const semanticOnlyRootDir = fs.mkdtempSync(
  path.join(
    os.tmpdir(),
    "direct-world-manager-sc5-semantic-only-",
  ),
);
const semanticOnlyStore =
  new DirectWorldManagerControlPlaneStore({
    rootDir: semanticOnlyRootDir,
    now,
  });
semanticOnlyStore.ensureBootstrap({
  userWorldId: "user_world_sc5_semantic_only",
  projects: [{
    id: "project_host_runtime",
    name: "Host Runtime",
    summary:
      "Configured runtime host for world-scope reasoning.",
    runtimePath: "direct",
  }],
});
const semanticOnlyDecision = buildOpenDecision({
  sourceKind: "sc5_fixture",
  sourceKey: "semantic_only_project",
  semanticIdentity:
    "Unprovisioned project priority decision",
  question:
    "How should the unprovisioned project priorities be reframed?",
  scope: {
    kind: "project",
    userWorldId:
      "user_world_sc5_semantic_only",
    projectId:
      "project_windows-context-menu-manager",
  },
  resolutionMode: "semantic_relay",
  now,
});
semanticOnlyStore.transaction(() => {
  semanticOnlyStore
    ._appendSemanticArtifactRevisionWithinTransaction(
      semanticOnlyDecision,
    );
  semanticOnlyStore
    ._rebuildSemanticShelvesWithinTransaction();
  semanticOnlyStore.incrementRevision();
});
const semanticOnlyService =
  new DirectWorldManagerService({
    store: semanticOnlyStore,
    userWorldId:
      "user_world_sc5_semantic_only",
    projects: [{
      id: "project_host_runtime",
      name: "Host Runtime",
      summary:
        "Configured runtime host for world-scope reasoning.",
      runtimePath: "direct",
    }],
    activeProjectId: "project_host_runtime",
    now,
  });
semanticOnlyService.started = true;
let semanticOnlySubmitRequest = null;
semanticOnlyService.submit = async (request) => {
  semanticOnlySubmitRequest = request;
  return {
    receipt: {
      semanticEventRef: {
        kind: "world_manager_semantic_event",
        id: "semantic_only_relay_event",
        digest: digestFor(
          "fixture-semantic-only-event@1",
          { request },
        ),
      },
      settlementState: "completed",
      state: "accepted",
    },
    projection:
      semanticOnlyService.snapshot(),
  };
};
const semanticOnlyRelay =
  await semanticOnlyService.transitionDecision({
    clientRequestId:
      "sc5_semantic_only_relay",
    decisionId:
      semanticOnlyDecision.decisionId,
    decisionDigest:
      semanticOnlyDecision.digest,
    expectedDecisionRevision: 1,
    expectedProjectionRevision:
      semanticOnlyStore.revision(),
    transitionKind: "semantic_relay",
    semanticInput:
      "Reframe this around the project’s current priorities.",
    actorId: "operator",
    actorRole: "operator",
  });
assert.equal(
  semanticOnlyRelay.receipt.state,
  "relayed",
);
assert.equal(
  semanticOnlySubmitRequest.scopeHint.projectId,
  "",
);
assert.equal(
  semanticOnlySubmitRequest.scopeHint.proposalId,
  semanticOnlyDecision.decisionId,
);
assert.equal(
  semanticOnlySubmitRequest
    .attachmentDraftRefs[0].id,
  semanticOnlyDecision.decisionId,
);
semanticOnlyStore.close();
fs.rmSync(semanticOnlyRootDir, {
  recursive: true,
  force: true,
});

for (const [fixture, transitionKind, relationKind] of [
  [
    fixtures[3],
    "request_evidence",
    "requests_evidence",
  ],
  [
    fixtures[4],
    "request_authority",
    "requests_authority",
  ],
]) {
  const current = store.semanticArtifact(
    fixture.decisionId,
  );
  const registered =
    store.transitionSemanticDecision({
      clientRequestId:
        `sc5_${transitionKind}`,
      decisionId: current.decisionId,
      decisionDigest: current.digest,
      expectedDecisionRevision:
        current.header.revision,
      expectedProjectionRevision:
        store.revision(),
      transitionKind,
      semanticInput:
        transitionKind ===
          "request_evidence"
          ? "Gather the missing repository witness."
          : "Request an explicit project-scoped exception.",
      actorId: "operator",
      actorRole: "operator",
    });
  assert.equal(
    registered.receipt.state,
    "accepted",
  );
  assert.equal(
    registered.historyRelation.relationKind,
    relationKind,
  );
  assert.equal(
    registered.receipt.executionAuthorityGranted,
    false,
  );
}

const projection =
  buildWorldManagerWorkbenchProjection({
    ...store.snapshotData(),
    pipelineStage: "wm_k6_genesis",
    semanticIngressAvailable: true,
    workThreads: [],
  });
assertWorldManagerWorkbenchProjectionSafe(
  projection,
);
assert.equal(
  projection.semanticArtifactKernel
    .transitionExecution,
  "available_wm_sc5",
);
assert.equal(
  projection.decisionSummary
    .recentTransitions.length,
  6,
);
assert.ok(
  projection.decisionSummary
    .recentTransitions.every(
      (transition) =>
        transition.downstreamEffectsExecuted ===
          false &&
        transition.executionAuthorityGranted ===
          false &&
        transition.grantsAuthority === false,
    ),
);
assert.equal(
  projection.decisionSummary
    .openDecisions.length,
  4,
);
assert.equal(
  store.descriptor().counts
    .decisionTransitionCount,
  6,
);
if (
  process.env
    .CODEX_WORLD_MANAGER_SC5_PROJECTION_PATH
) {
  fs.writeFileSync(
    process.env
      .CODEX_WORLD_MANAGER_SC5_PROJECTION_PATH,
    JSON.stringify(projection, null, 2),
  );
}

store.close();
fs.rmSync(rootDir, {
  recursive: true,
  force: true,
});

console.log(
  JSON.stringify(
    {
      ok: true,
      regression:
        "direct-world-manager-decision-transition",
      proofs: {
        exactMechanicalResolution: true,
        twoPhaseUiContractSupported: true,
        expectedRevisionGate: true,
        idempotentReplay: true,
        idempotencyConflictRejected: true,
        dependencyBlockVisible: true,
        downstreamEffectsNotExecuted: true,
        semanticRelayEnvelopeDurable: true,
        relayReentersNormalWorldManagerIngress: true,
        semanticOnlyProjectUsesWorldRuntimeScope: true,
        exactDecisionObjectBoundToIngress: true,
        evidenceRequestDistinct: true,
        authorityRequestDoesNotGrant: true,
        appendOnlyReceipts: true,
        resolutionHistoryRelationPersisted: true,
        openDecisionShelfRebuilt: true,
        contextCachesInvalidated: true,
        rendererProjectionSafe: true,
      },
    },
    null,
    2,
  ),
);
