#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";

const require = createRequire(import.meta.url);
const {
  DirectArtifactAuditStore,
  createDirectArtifactAuditStore,
} = require("../src/main/direct/artifacts/artifact-audit-store.js");
const {
  buildPolicySnapshot,
  buildEvent,
  compileArtifactRoutingPlan,
  createArtifactAuditPrincipalAuthority,
} = require("../src/main/direct/artifacts/artifact-audit-kernel.js");

const digest = (char) => `sha256:${char.repeat(64)}`;
const actor = (actorId, roleId) => ({ actorId, roleId });
const manager = actor("manager-1", "manager");
const producer = actor("producer-1", "producer");
const auditorA = actor("auditor-a", "static-auditor");
const auditorB = actor("auditor-b", "behavior-auditor");
const authorityActor = actor("authority-1", "admission-authority");
const parent = actor("parent-1", "observer");
const sharedProducer = actor("shared-actor", "producer");
const sharedAuditor = actor("shared-actor", "static-auditor");
const scope = {
  projectId: "arcagi3-pilot",
  workThreadId: "workthread-7",
  artifactId: "solver-artifact-1",
  artifactClassId: "arc-solver-candidate",
};

const policyInput = {
  artifactClassId: scope.artifactClassId,
  projectId: scope.projectId,
  managerRoleId: "manager",
  roles: [
    { roleId: "manager", actors: [manager.actorId], rights: ["propose", "read", "subscribe"] },
    { roleId: "producer", actors: [producer.actorId, sharedProducer.actorId], rights: ["propose", "read"] },
    { roleId: "static-auditor", actors: [auditorA.actorId, sharedAuditor.actorId], rights: ["challenge", "read"] },
    { roleId: "behavior-auditor", actors: [auditorB.actorId], rights: ["challenge", "read"] },
    { roleId: "admission-authority", actors: [authorityActor.actorId], rights: ["admit", "read"] },
    { roleId: "observer", actors: [parent.actorId], rights: ["read", "subscribe"] },
  ],
  producerRoleIds: ["producer"],
  auditRequirements: [
    {
      requirementId: "static-safety",
      auditorRoleIds: ["static-auditor"],
      separationRequired: true,
      evidenceKinds: ["audit_observation", "test_report"],
    },
    {
      requirementId: "behavioral-proof",
      auditorRoleIds: ["behavior-auditor"],
      separationRequired: true,
      evidenceKinds: ["audit_observation", "test_report"],
    },
  ],
  admissionRoleId: "admission-authority",
  allowedEvidenceKinds: ["artifact_blob", "test_report", "workspace_worker_terminal"],
  revision: 1,
};

function expectCode(code, action) {
  assert.throws(action, (error) => error?.code === code, `expected ${code}`);
}

function expectAnyCode(codes, action) {
  assert.throws(action, (error) => codes.includes(error?.code), `expected one of ${codes.join(", ")}`);
}

const policy = buildPolicySnapshot(policyInput);
const pinnedActors = [manager, producer, auditorA, auditorB, authorityActor, parent, sharedProducer, sharedAuditor];
const authorityBindings = pinnedActors.map((entry) => ({
    projectId: scope.projectId,
    artifactClassId: scope.artifactClassId,
    policyDigest: policy.policyDigest,
    actorId: entry.actorId,
    roleId: entry.roleId,
    purposes: [
      ...(entry === manager ? ["declare"] : []),
      "act",
      ...([producer, auditorA, auditorB, sharedProducer, sharedAuditor].includes(entry) ? ["register_evidence"] : []),
    ],
  }));
const authority = createArtifactAuditPrincipalAuthority({
  authorityId: "artifact-harness",
  bindings: authorityBindings,
});
const principal = (entry, purpose = "act") => authority.issue({
  projectId: scope.projectId,
  artifactClassId: scope.artifactClassId,
  policyDigest: policy.policyDigest,
  actorId: entry.actorId,
  roleId: entry.roleId,
  purpose,
});
const principals = {
  manager: principal(manager), declaration: principal(manager, "declare"), producer: principal(producer),
  producerEvidence: principal(producer, "register_evidence"), auditorA: principal(auditorA),
  auditorAEvidence: principal(auditorA, "register_evidence"), auditorB: principal(auditorB),
  auditorBEvidence: principal(auditorB, "register_evidence"), authority: principal(authorityActor),
  parent: principal(parent), sharedProducer: principal(sharedProducer), sharedAuditor: principal(sharedAuditor),
  sharedEvidence: principal(sharedProducer, "register_evidence"),
};

let tick = Date.parse("2026-08-12T00:00:00.000Z");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "direct-artifact-audit-"));
const storeId = "artifact-audit-regression";
const dbPath = path.join(root, "direct-artifact-audit", `${storeId}.sqlite`);
let store = createDirectArtifactAuditStore({ rootDir: root, storeId, authority, now: () => tick++ });

function registerEvidence(targetStore, targetScope, revision, kind, evidenceId, char, registrar) {
  return targetStore.registerEvidence({
    principal: registrar,
    evidence: {
      kind, evidenceId, projectId: targetScope.projectId, workThreadId: targetScope.workThreadId,
      artifactId: targetScope.artifactId, artifactClassId: targetScope.artifactClassId,
      revision, policyDigest: policy.policyDigest, sourceCaptureId: `capture-${evidenceId}`,
      sourceSessionId: `session-${revision}`, sourceTurnId: `turn-${evidenceId}`,
      canonicalEnvelopeDigest: digest(char),
    },
  }).ref;
}

function request(targetStore, targetScope, idempotencyKey) {
  return targetStore.requestArtifact({
    scope: targetScope, policyDigest: policy.policyDigest,
    principal: principals.manager, idempotencyKey,
  });
}

try {
  assert.equal(policy.schema, "direct_artifact_audit_policy@2");
  assert.equal(Object.isFrozen(policy.roles), true);
  assert.equal(Object.isFrozen(policy.roles[0].actors), true);
  assert.throws(() => policy.roles[0].actors.push("intruder"), TypeError);
  assert.equal(buildPolicySnapshot({ ...policyInput, roles: [...policyInput.roles].reverse() }).policyDigest, policy.policyDigest);
  expectCode("artifact_audit_policy_integrity_failed", () => compileArtifactRoutingPlan({
    ...structuredClone(policy), roles: structuredClone(policy.roles).map((role, index) =>
      index === 0 ? { ...role, actors: [...role.actors, "intruder"] } : role),
  }, scope));
  expectCode("artifact_audit_raw_exposure", () => buildPolicySnapshot({ ...policyInput, providerPayload: "secret" }));

  const declaration = store.declareArtifactClass({ policy: policyInput, principal: principals.declaration });
  assert.equal(declaration.changed, true);
  assert.equal(store.declareArtifactClass({ policy: policyInput, principal: principals.declaration }).changed, false);
  expectCode("artifact_audit_principal_untrusted", () => store.declareArtifactClass({
    policy: policyInput, principal: structuredClone(principals.declaration),
  }));
  expectCode("artifact_audit_principal_scope_mismatch", () => store.declareArtifactClass({
    policy: { ...policyInput, revision: 2 }, principal: principals.declaration,
  }));
  const hostileAuthority = createArtifactAuditPrincipalAuthority({
    authorityId: "hostile-harness",
    bindings: [{ projectId: scope.projectId, artifactClassId: scope.artifactClassId,
      policyDigest: policy.policyDigest, actorId: "intruder", roleId: "manager", purposes: ["declare"] }],
  });
  expectCode("artifact_audit_principal_untrusted", () => store.declareArtifactClass({
    policy: policyInput,
    principal: hostileAuthority.issue({ projectId: scope.projectId, artifactClassId: scope.artifactClassId,
      policyDigest: policy.policyDigest, actorId: "intruder", roleId: "manager", purpose: "declare" }),
  }));

  const route = store.compileRoutingPlan({ scope, policyDigest: policy.policyDigest, principal: principals.manager });
  assert.equal(route.launchesProviders, false);
  assert.equal(route.distinctAuditorActorsRequired, true);
  assert.equal(route.feasibleAssignments.length, 2);
  assert.equal(route.planDigest, compileArtifactRoutingPlan(policy, scope).planDigest);
  const impossiblePolicy = {
    ...policyInput,
    roles: policyInput.roles.map((role) => ["static-auditor", "behavior-auditor"].includes(role.roleId)
      ? { ...role, actors: ["only-auditor"] } : role),
  };
  expectCode("artifact_audit_route_unfillable", () => compileArtifactRoutingPlan(impossiblePolicy, scope));
  const producerSeparatedImpossible = {
    ...policyInput,
    roles: policyInput.roles.map((role) => role.roleId === "producer" || role.roleId === "static-auditor"
      ? { ...role, actors: ["same-person"] } : role),
  };
  expectCode("artifact_audit_route_unfillable", () => compileArtifactRoutingPlan(producerSeparatedImpossible, scope));
  const mixedProducerRoute = compileArtifactRoutingPlan({
    ...policyInput,
    roles: policyInput.roles.map((role) => role.roleId === "static-auditor"
      ? { ...role, actors: [sharedAuditor.actorId] } : role),
  }, scope);
  assert.deepEqual(mixedProducerRoute.producer.eligibleActors.map((entry) => entry.actorId), [producer.actorId]);
  expectCode("artifact_audit_route_unfillable", () => compileArtifactRoutingPlan({
    ...policyInput,
    roles: policyInput.roles.map((role) => role.roleId === "manager" ? { ...role, rights: ["read"] } : role),
  }, scope));
  expectCode("artifact_audit_route_unfillable", () => store.declareArtifactClass({
    policy: impossiblePolicy, principal: principals.declaration,
  }));

  const requested = request(store, scope, "request-1");
  assert.equal(requested.stateTo, "requested");
  assert.deepEqual(request(store, scope, "request-1"), requested);
  expectCode("artifact_audit_principal_untrusted", () => store.beginProduction({
    scope, policyDigest: policy.policyDigest, principal: { actorId: producer.actorId, roleId: producer.roleId },
    idempotencyKey: "forged", expectedRevision: 1, expectedState: "requested",
  }));
  expectCode("artifact_audit_raw_exposure", () => store.beginProduction({
    scope, policyDigest: policy.policyDigest, principal: principals.producer,
    idempotencyKey: "raw", expectedRevision: 1, expectedState: "requested",
    metadata: { nested: { harmless: "/home/private/repository" } },
  }));
  store.beginProduction({
    scope, policyDigest: policy.policyDigest, principal: principals.producer,
    idempotencyKey: "produce-r1", expectedRevision: 1, expectedState: "requested",
  });
  const terminalR1 = registerEvidence(store, scope, 1, "workspace_worker_terminal", "terminal-r1", "a", principals.producerEvidence);
  expectCode("artifact_audit_evidence_pointer_invalid", () => store.submitCandidate({
    scope, policyDigest: policy.policyDigest, principal: principals.producer,
    idempotencyKey: "caller-minted", expectedRevision: 1, expectedState: "under_production",
    evidenceRefs: [{ kind: "workspace_worker_terminal", evidenceId: "made-up", evidenceDigest: digest("a") }],
  }));
  expectCode("artifact_audit_evidence_unregistered", () => store.submitCandidate({
    scope, policyDigest: policy.policyDigest, principal: principals.producer,
    idempotencyKey: "unregistered", expectedRevision: 1, expectedState: "under_production",
    evidenceRefs: [{ evidenceId: "made-up", evidenceDigest: digest("a") }],
  }));
  const otherScope = { ...scope, artifactId: "other-artifact" };
  const wrongScopeEvidence = registerEvidence(store, otherScope, 1, "artifact_blob", "other-evidence", "b", principals.producerEvidence);
  expectCode("artifact_audit_cross_scope_ref", () => store.submitCandidate({
    scope, policyDigest: policy.policyDigest, principal: principals.producer,
    idempotencyKey: "cross-scope", expectedRevision: 1, expectedState: "under_production",
    evidenceRefs: [wrongScopeEvidence],
  }));
  const candidateR1 = store.submitCandidate({
    scope, policyDigest: policy.policyDigest, principal: principals.producer,
    idempotencyKey: "candidate-r1", expectedRevision: 1, expectedState: "under_production",
    evidenceRefs: [terminalR1],
  });
  assert.equal(candidateR1.evidenceRefs[0].sourceCaptureId, "capture-terminal-r1");
  assert.equal(candidateR1.evidenceRefs[0].policyDigest, policy.policyDigest);
  expectCode("artifact_audit_admission_incomplete", () => store.decideArtifact({
    scope, policyDigest: policy.policyDigest, principal: principals.authority,
    idempotencyKey: "early-admit", expectedRevision: 1, expectedState: "candidate", decision: "admitted",
  }));

  store.beginAudit({ scope, policyDigest: policy.policyDigest, principal: principals.auditorA,
    idempotencyKey: "audit-r1", expectedRevision: 1, expectedState: "candidate" });
  const staticR1 = registerEvidence(store, scope, 1, "test_report", "static-r1", "c", principals.auditorAEvidence);
  const behaviorR1 = registerEvidence(store, scope, 1, "audit_observation", "behavior-r1", "d", principals.auditorBEvidence);
  assert.equal(store.recordAuditVerdict({
    scope, policyDigest: policy.policyDigest, principal: principals.auditorA,
    idempotencyKey: "static-r1", expectedRevision: 1, expectedState: "under_audit",
    requirementId: "static-safety", verdict: "supported", evidenceRefs: [staticR1],
  }).stateTo, "under_audit");
  assert.equal(store.recordAuditVerdict({
    scope, policyDigest: policy.policyDigest, principal: principals.auditorB,
    idempotencyKey: "behavior-r1", expectedRevision: 1, expectedState: "under_audit",
    requirementId: "behavioral-proof", verdict: "requires_revision", evidenceRefs: [behaviorR1],
  }).stateTo, "requires_revision");
  store.decideArtifact({
    scope, policyDigest: policy.policyDigest, principal: principals.authority,
    idempotencyKey: "remand-r1", expectedRevision: 1, expectedState: "requires_revision", decision: "remanded",
  });

  assert.equal(store.beginProduction({
    scope, policyDigest: policy.policyDigest, principal: principals.sharedProducer,
    idempotencyKey: "produce-r2", expectedRevision: 1, expectedState: "remanded",
  }).scope.revision, 2);
  const terminalR2 = registerEvidence(store, scope, 2, "workspace_worker_terminal", "terminal-r2", "e", principals.sharedEvidence);
  store.submitCandidate({
    scope, policyDigest: policy.policyDigest, principal: principals.sharedProducer,
    idempotencyKey: "candidate-r2", expectedRevision: 2, expectedState: "under_production", evidenceRefs: [terminalR2],
  });
  expectCode("artifact_audit_self_audit_denied", () => store.beginAudit({
    scope, policyDigest: policy.policyDigest, principal: principals.sharedAuditor,
    idempotencyKey: "self-audit-r2", expectedRevision: 2, expectedState: "candidate",
  }));
  store.beginAudit({ scope, policyDigest: policy.policyDigest, principal: principals.auditorA,
    idempotencyKey: "audit-r2", expectedRevision: 2, expectedState: "candidate" });
  const staticR2 = registerEvidence(store, scope, 2, "test_report", "static-r2", "f", principals.auditorAEvidence);
  const behaviorR2 = registerEvidence(store, scope, 2, "test_report", "behavior-r2", "1", principals.auditorBEvidence);
  store.recordAuditVerdict({
    scope, policyDigest: policy.policyDigest, principal: principals.auditorA,
    idempotencyKey: "static-r2", expectedRevision: 2, expectedState: "under_audit",
    requirementId: "static-safety", verdict: "supported", evidenceRefs: [staticR2],
  });
  assert.equal(store.recordAuditVerdict({
    scope, policyDigest: policy.policyDigest, principal: principals.auditorB,
    idempotencyKey: "behavior-r2", expectedRevision: 2, expectedState: "under_audit",
    requirementId: "behavioral-proof", verdict: "supported", evidenceRefs: [behaviorR2],
  }).stateTo, "supported");
  assert.equal(store.decideArtifact({
    scope, policyDigest: policy.policyDigest, principal: principals.authority,
    idempotencyKey: "admit-r2", expectedRevision: 2, expectedState: "supported", decision: "admitted",
  }).stateTo, "admitted");

  const subscription = store.subscribe({
    subscriptionId: "parent-artifact-transitions", projectId: scope.projectId,
    workThreadId: scope.workThreadId, artifactId: scope.artifactId,
    artifactClassId: scope.artifactClassId, policyDigest: policy.policyDigest,
    principal: principals.parent,
    eventTypes: ["candidate_recorded", "audit_verdict_recorded", "artifact_admitted", "artifact_remanded"],
  });
  const projection = store.pollSubscription({
    subscriptionId: subscription.subscriptionId, principal: principals.parent, afterSequence: 0, limit: 100,
  });
  assert.equal(projection.deliveryMode, "passive_poll");
  assert.equal(projection.activeWorkerMessageCount, 0);
  assert.equal(projection.transitions.at(-1).stateTo, "admitted");
  assert.equal(projection.transitions.every((event) => !Object.hasOwn(event, "actor")), true);
  assert.equal(JSON.stringify(projection).includes("/home/"), false);
  assert.equal(store.inspectHead({ scope, policyDigest: policy.policyDigest, principal: principals.parent }).state, "admitted");
  const diagnostics = store.diagnostics({
    projectId: scope.projectId, artifactClassId: scope.artifactClassId,
    policyDigest: policy.policyDigest, principal: principals.manager,
  });
  assert.equal(diagnostics.journalMode, "wal");
  assert.equal(diagnostics.counts.events, 13);
  assert.equal(diagnostics.counts.audits, 4);
  assert.equal(Object.hasOwn(store, "db"), false);
  assert.equal(typeof store.transaction, "undefined");
  assert.equal(typeof store._appendEvent, "undefined");
  expectCode("artifact_audit_store_options_invalid", () => new DirectArtifactAuditStore({
    rootDir: root, storeId: "borrowed", authority, db: new DatabaseSync(":memory:"),
  }));

  store.close();
  const changedAuthority = createArtifactAuditPrincipalAuthority({
    authorityId: authority.authorityId,
    bindings: [{ projectId: scope.projectId, artifactClassId: scope.artifactClassId,
      policyDigest: policy.policyDigest, actorId: manager.actorId, roleId: manager.roleId, purposes: ["declare"] }],
  });
  expectCode("artifact_audit_store_identity_conflict", () => createDirectArtifactAuditStore({
    rootDir: root, storeId, authority: changedAuthority,
  }));
  const restartedAuthority = createArtifactAuditPrincipalAuthority({
    authorityId: "artifact-harness", bindings: structuredClone(authorityBindings),
  });
  const restartedParent = restartedAuthority.issue({
    projectId: scope.projectId, artifactClassId: scope.artifactClassId,
    policyDigest: policy.policyDigest, actorId: parent.actorId, roleId: parent.roleId, purpose: "act",
  });
  store = createDirectArtifactAuditStore({ rootDir: root, storeId, authority: restartedAuthority });
  assert.equal(store.inspectHead({ scope, policyDigest: policy.policyDigest, principal: restartedParent }).state, "admitted");
  assert.deepEqual(store.pollSubscription({
    subscriptionId: subscription.subscriptionId, principal: restartedParent,
    afterSequence: projection.nextSequence, limit: 10,
  }).transitions, []);
  store.close();

  const backupPath = path.join(root, "known-good.sqlite");
  fs.copyFileSync(dbPath, backupPath);
  const restore = () => {
    fs.rmSync(`${dbPath}-wal`, { force: true });
    fs.rmSync(`${dbPath}-shm`, { force: true });
    fs.copyFileSync(backupPath, dbPath);
  };
  const corruptAndReject = (codes, sql) => {
    restore();
    const corrupt = new DatabaseSync(dbPath);
    try { corrupt.exec(sql); } finally { corrupt.close(); }
    expectAnyCode(codes, () => createDirectArtifactAuditStore({ rootDir: root, storeId, authority }));
  };

  corruptAndReject(["artifact_audit_policy_integrity_failed"], `
    drop trigger direct_artifact_audit_policies_no_update;
    update direct_artifact_audit_policies set declared_at = '2020-01-01T00:00:00.000Z';
    create trigger direct_artifact_audit_policies_no_update before update on direct_artifact_audit_policies
      begin select raise(abort, 'artifact_audit_append_only'); end;
  `);
  corruptAndReject(["artifact_audit_evidence_integrity_failed"], `
    drop trigger direct_artifact_audit_evidence_no_update;
    update direct_artifact_audit_evidence set registered_at = '2020-01-01T00:00:00.000Z' where evidence_id = 'terminal-r1';
    create trigger direct_artifact_audit_evidence_no_update before update on direct_artifact_audit_evidence
      begin select raise(abort, 'artifact_audit_append_only'); end;
  `);
  corruptAndReject(["artifact_audit_audit_integrity_failed"], `
    drop trigger direct_artifact_audit_audits_no_update;
    update direct_artifact_audit_audits set verdict = 'contradicted' where requirement_id = 'static-safety';
    create trigger direct_artifact_audit_audits_no_update before update on direct_artifact_audit_audits
      begin select raise(abort, 'artifact_audit_append_only'); end;
  `);
  corruptAndReject(["artifact_audit_subscription_integrity_failed"], `
    drop trigger direct_artifact_audit_subscriptions_no_update;
    update direct_artifact_audit_subscriptions set created_at = '2020-01-01T00:00:00.000Z';
    create trigger direct_artifact_audit_subscriptions_no_update before update on direct_artifact_audit_subscriptions
      begin select raise(abort, 'artifact_audit_append_only'); end;
  `);
  corruptAndReject(["artifact_audit_head_integrity_failed"], `
    update direct_artifact_audit_heads set state = 'rejected', head_version = 999;
  `);
  corruptAndReject(["artifact_audit_event_input_integrity_failed"], `
    drop trigger direct_artifact_audit_events_no_update;
    update direct_artifact_audit_events set input_json = replace(input_json, 'solver-artifact-1', 'evil-artifact') where sequence = 1;
    create trigger direct_artifact_audit_events_no_update before update on direct_artifact_audit_events
      begin select raise(abort, 'artifact_audit_append_only'); end;
  `);

  restore();
  const corruptChain = new DatabaseSync(dbPath);
  const chainRow = corruptChain.prepare("select event_json from direct_artifact_audit_events where sequence = 2").get();
  const chainEvent = JSON.parse(chainRow.event_json);
  const rewritten = buildEvent({
    eventId: chainEvent.eventId, sequence: chainEvent.sequence, previousEventDigest: digest("9"),
    eventType: chainEvent.eventType, scope: chainEvent.scope, policyRef: chainEvent.policyRef,
    actor: chainEvent.actor, stateFrom: chainEvent.stateFrom, stateTo: chainEvent.stateTo,
    evidenceRefs: chainEvent.evidenceRefs, occurredAt: chainEvent.occurredAt,
  });
  corruptChain.exec("drop trigger direct_artifact_audit_events_no_update");
  corruptChain.prepare(`update direct_artifact_audit_events set
    previous_event_digest = ?, event_digest = ?, event_json = ? where sequence = 2`).run(
    rewritten.previousEventDigest, rewritten.eventDigest, JSON.stringify(rewritten),
  );
  corruptChain.exec(`create trigger direct_artifact_audit_events_no_update before update on direct_artifact_audit_events
    begin select raise(abort, 'artifact_audit_append_only'); end;`);
  corruptChain.close();
  expectCode("artifact_audit_event_chain_invalid", () => createDirectArtifactAuditStore({ rootDir: root, storeId, authority }));

  restore();
  const addTable = new DatabaseSync(dbPath);
  addTable.exec("create table unrelated_borrowed_table(id text primary key)");
  addTable.close();
  expectCode("artifact_audit_store_schema_tampered", () => createDirectArtifactAuditStore({
    rootDir: root, storeId, authority,
  }));

  restore();

  const reentrantRoot = fs.mkdtempSync(path.join(os.tmpdir(), "direct-artifact-reentrant-"));
  let reentrantStore;
  let reenter = false;
  const reentrantNow = () => {
    if (reenter) {
      reenter = false;
      reentrantStore.requestArtifact({
        scope: { ...scope, artifactId: "reentrant-inner" }, policyDigest: policy.policyDigest,
        principal: principals.manager, idempotencyKey: "reentrant-inner",
      });
    }
    return tick++;
  };
  reentrantStore = createDirectArtifactAuditStore({
    rootDir: reentrantRoot, storeId: "reentrant", authority, now: reentrantNow,
  });
  reentrantStore.declareArtifactClass({ policy: policyInput, principal: principals.declaration });
  reenter = true;
  expectCode("artifact_audit_reentrant_transaction_denied", () => reentrantStore.requestArtifact({
    scope: { ...scope, artifactId: "reentrant-outer" }, policyDigest: policy.policyDigest,
    principal: principals.manager, idempotencyKey: "reentrant-outer",
  }));
  assert.equal(reentrantStore.requestArtifact({
    scope: { ...scope, artifactId: "reentrant-outer" }, policyDigest: policy.policyDigest,
    principal: principals.manager, idempotencyKey: "reentrant-outer",
  }).stateTo, "requested");
  reentrantStore.close();
  fs.rmSync(reentrantRoot, { recursive: true, force: true });

  const foreignRoot = fs.mkdtempSync(path.join(os.tmpdir(), "direct-artifact-foreign-"));
  const foreignDir = path.join(foreignRoot, "direct-artifact-audit");
  fs.mkdirSync(foreignDir, { recursive: true });
  const foreignPath = path.join(foreignDir, "foreign.sqlite");
  const foreign = new DatabaseSync(foreignPath);
  foreign.exec("create table direct_world_manager_state(id text primary key)");
  foreign.close();
  expectCode("artifact_audit_foreign_store", () => createDirectArtifactAuditStore({
    rootDir: foreignRoot, storeId: "foreign", authority,
  }));
  const verifyForeign = new DatabaseSync(foreignPath);
  assert.deepEqual(verifyForeign.prepare("select name from sqlite_master where type = 'table' order by name").all()
    .map((row) => row.name), ["direct_world_manager_state"]);
  verifyForeign.close();
  fs.rmSync(foreignRoot, { recursive: true, force: true });

  console.log(JSON.stringify({
    ok: true,
    policyDigest: policy.policyDigest,
    routePlanDigest: route.planDigest,
    finalState: "admitted",
    revision: 2,
    eventCount: diagnostics.counts.events,
    evidenceCount: diagnostics.counts.evidence,
    passiveTransitions: projection.transitions.length,
    startupTamperRejected: true,
    foreignStoreRejectedBeforeDdl: true,
  }, null, 2));
} finally {
  try { store?.close(); } catch {}
  fs.rmSync(root, { recursive: true, force: true });
}
