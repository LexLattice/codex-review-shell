#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
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
  createArtifactAuditEvidenceReceiptAuthority,
  createArtifactAuditPrincipalAuthority,
  canonicalJson,
  digestFor,
} = require("../src/main/direct/artifacts/artifact-audit-kernel.js");

const digest = (char) => `sha256:${char.repeat(64)}`;
const temporaryRoot = process.platform === "win32" ? os.tmpdir() : "/tmp";
const actor = (actorId, roleId) => ({ actorId, roleId });
const manager = actor("manager-1", "manager");
const producer = actor("producer-1", "producer");
const auditorA = actor("auditor-a", "static-auditor");
const auditorB = actor("auditor-b", "behavior-auditor");
const authorityActor = actor("authority-1", "admission-authority");
const parent = actor("parent-1", "observer");
const readOnlyParent = actor("read-parent-1", "read-observer");
const evidenceAdapter = actor("evidence-adapter-1", "trusted-evidence-adapter");
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
    { roleId: "read-observer", actors: [readOnlyParent.actorId], rights: ["read"] },
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
const pinnedActors = [manager, producer, auditorA, auditorB, authorityActor, parent, readOnlyParent,
  sharedProducer, sharedAuditor];
const authorityBindings = [...pinnedActors.map((entry) => ({
    projectId: scope.projectId,
    artifactClassId: scope.artifactClassId,
    policyDigest: policy.policyDigest,
    actorId: entry.actorId,
    roleId: entry.roleId,
    purposes: [
      ...(entry === manager ? ["declare"] : []),
      "act",
      ...(entry === manager ? ["admin_read"] : []),
    ],
  })), {
    projectId: scope.projectId, artifactClassId: scope.artifactClassId,
    policyDigest: policy.policyDigest, actorId: evidenceAdapter.actorId,
    roleId: evidenceAdapter.roleId, purposes: ["register_evidence"],
  }];
const authority = createArtifactAuditPrincipalAuthority({
  authorityId: "artifact-harness",
  bindings: authorityBindings,
});
const evidenceReceiptAuthority = createArtifactAuditEvidenceReceiptAuthority({
  authorityId: "workspace-capture-service",
  adapter: evidenceAdapter,
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
  managerAdmin: principal(manager, "admin_read"), auditorA: principal(auditorA),
  auditorB: principal(auditorB), authority: principal(authorityActor),
  parent: principal(parent), sharedProducer: principal(sharedProducer), sharedAuditor: principal(sharedAuditor),
  readOnlyParent: principal(readOnlyParent),
  evidenceAdapter: principal(evidenceAdapter, "register_evidence"),
};

let tick = Date.parse("2026-08-12T00:00:00.000Z");
const root = fs.mkdtempSync(path.join(temporaryRoot, "direct-artifact-audit-"));
const storeId = "artifact-audit-regression";
const dbPath = path.join(root, "direct-artifact-audit", `${storeId}.sqlite`);
const keyFilePath = path.join(root, "artifact-audit.key");
fs.writeFileSync(keyFilePath, crypto.randomBytes(32), { mode: 0o600 });
const storeOptions = (overrides = {}) => ({
  rootDir: root, storeId, authority, evidenceReceiptAuthority, keyFilePath, ...overrides,
});
let store = createDirectArtifactAuditStore(storeOptions({ now: () => tick++ }));

function registerEvidence(targetStore, targetScope, revision, kind, evidenceId, char) {
  const receipt = evidenceReceiptAuthority.issue({
    kind, evidenceId, projectId: targetScope.projectId, workThreadId: targetScope.workThreadId,
    artifactId: targetScope.artifactId, artifactClassId: targetScope.artifactClassId,
    revision, policyDigest: policy.policyDigest, sourceCaptureId: `capture-${evidenceId}`,
    sourceSessionId: `session-${revision}`, sourceTurnId: `turn-${evidenceId}`,
    canonicalEnvelopeDigest: digest(char),
  });
  return targetStore.registerEvidence({
    principal: principals.evidenceAdapter,
    receipt,
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
  expectCode("artifact_audit_principal_not_pinned", () => principal(producer, "register_evidence"));
  const sealedProbe = evidenceReceiptAuthority.issue({
    kind: "artifact_blob", evidenceId: "sealed-probe", ...scope, revision: 1,
    policyDigest: policy.policyDigest, sourceCaptureId: "capture-sealed-probe",
    sourceSessionId: "session-sealed-probe", sourceTurnId: "turn-sealed-probe",
    canonicalEnvelopeDigest: digest("8"),
  });
  expectCode("artifact_audit_evidence_receipt_untrusted", () => store.registerEvidence({
    receipt: structuredClone(sealedProbe), principal: principals.evidenceAdapter,
  }));
  expectCode("artifact_audit_principal_scope_mismatch", () => store.registerEvidence({
    receipt: sealedProbe, principal: principals.producer,
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
  const terminalR1 = registerEvidence(store, scope, 1, "workspace_worker_terminal", "terminal-r1", "a");
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
  const wrongScopeEvidence = registerEvidence(store, otherScope, 1, "artifact_blob", "other-evidence", "b");
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
  const staticR1 = registerEvidence(store, scope, 1, "test_report", "static-r1", "c");
  const behaviorR1 = registerEvidence(store, scope, 1, "audit_observation", "behavior-r1", "d");
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
  const terminalR2 = registerEvidence(store, scope, 2, "workspace_worker_terminal", "terminal-r2", "e");
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
  const staticR2 = registerEvidence(store, scope, 2, "test_report", "static-r2", "f");
  const behaviorR2 = registerEvidence(store, scope, 2, "test_report", "behavior-r2", "1");
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
  assert.equal(projection.transitions.every((event) => !Object.hasOwn(event, "assignment")), true);
  assert.equal(JSON.stringify(projection).includes("/home/"), false);
  expectCode("artifact_audit_inspect_invalid", () => store.inspectHead({
    scope, policyDigest: policy.policyDigest, principal: principals.parent,
  }));
  expectCode("artifact_audit_subscription_scope_mismatch", () => store.inspectHead({
    scope, policyDigest: policy.policyDigest, principal: principals.readOnlyParent,
    subscriptionId: subscription.subscriptionId,
  }));
  assert.equal(store.inspectHead({
    scope, policyDigest: policy.policyDigest, principal: principals.parent,
    subscriptionId: subscription.subscriptionId,
  }).state, "admitted");
  assert.equal(store.inspectHeadAdministrative({
    scope, policyDigest: policy.policyDigest, principal: principals.managerAdmin,
  }).state, "admitted");
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
    ...storeOptions({ storeId: "borrowed" }), db: new DatabaseSync(":memory:"),
  }));

  store.close();
  const changedAuthority = createArtifactAuditPrincipalAuthority({
    authorityId: authority.authorityId,
    bindings: [{ projectId: scope.projectId, artifactClassId: scope.artifactClassId,
      policyDigest: policy.policyDigest, actorId: manager.actorId, roleId: manager.roleId, purposes: ["declare"] }],
  });
  expectCode("artifact_audit_store_identity_conflict", () => createDirectArtifactAuditStore(
    storeOptions({ authority: changedAuthority }),
  ));
  const wrongKeyFile = path.join(root, "wrong-artifact-audit.key");
  fs.writeFileSync(wrongKeyFile, crypto.randomBytes(32), { mode: 0o600 });
  expectCode("artifact_audit_store_identity_conflict", () => createDirectArtifactAuditStore(
    storeOptions({ keyFilePath: wrongKeyFile }),
  ));
  fs.rmSync(wrongKeyFile, { force: true });
  const restartedAuthority = createArtifactAuditPrincipalAuthority({
    authorityId: "artifact-harness", bindings: structuredClone(authorityBindings),
  });
  const restartedParent = restartedAuthority.issue({
    projectId: scope.projectId, artifactClassId: scope.artifactClassId,
    policyDigest: policy.policyDigest, actorId: parent.actorId, roleId: parent.roleId, purpose: "act",
  });
  const restartedEvidenceAuthority = createArtifactAuditEvidenceReceiptAuthority({
    authorityId: "workspace-capture-service", adapter: evidenceAdapter,
  });
  store = createDirectArtifactAuditStore(storeOptions({
    authority: restartedAuthority, evidenceReceiptAuthority: restartedEvidenceAuthority,
  }));
  assert.equal(store.inspectHead({
    scope, policyDigest: policy.policyDigest, principal: restartedParent,
    subscriptionId: subscription.subscriptionId,
  }).state, "admitted");
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
    expectAnyCode(codes, () => createDirectArtifactAuditStore(storeOptions()));
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
  expectCode("artifact_audit_event_chain_invalid", () => createDirectArtifactAuditStore(storeOptions()));

  restore();
  const coherentRewrite = new DatabaseSync(dbPath);
  const admittedRow = coherentRewrite.prepare(`select * from direct_artifact_audit_events
    where event_type = 'artifact_admitted'`).get();
  const admittedEvent = JSON.parse(admittedRow.event_json);
  const rejectedInput = { ...JSON.parse(admittedRow.input_json), decision: "rejected" };
  const rejectedInputDigest = digestFor("direct_artifact_audit_decide_artifact_input@2", rejectedInput);
  const rejectedEventId = `dae_${digestFor("direct_artifact_audit_event_id@2", {
    operation: "decide_artifact", actor: admittedEvent.actor, scope,
    idempotencyKey: admittedRow.idempotency_key, inputDigest: rejectedInputDigest,
  }).slice(7, 31)}`;
  const rejectedEvent = buildEvent({
    eventId: rejectedEventId, sequence: admittedEvent.sequence,
    previousEventDigest: admittedEvent.previousEventDigest, eventType: "artifact_rejected",
    scope: admittedEvent.scope, policyRef: admittedEvent.policyRef, actor: admittedEvent.actor,
    stateFrom: "supported", stateTo: "rejected", evidenceRefs: [],
    occurredAt: admittedEvent.occurredAt, decision: { disposition: "rejected" },
  });
  coherentRewrite.exec("drop trigger direct_artifact_audit_events_no_update");
  coherentRewrite.prepare(`update direct_artifact_audit_events set
    event_id = ?, event_type = ?, input_digest = ?, input_json = ?, state_to = ?,
    event_digest = ?, event_json = ? where sequence = ?`).run(
    rejectedEventId, "artifact_rejected", rejectedInputDigest, canonicalJson(rejectedInput),
    "rejected", rejectedEvent.eventDigest, canonicalJson(rejectedEvent), admittedEvent.sequence,
  );
  coherentRewrite.prepare(`update direct_artifact_audit_heads set state = 'rejected', head_event_id = ?
    where project_id = ? and work_thread_id = ? and artifact_id = ?`).run(
    rejectedEventId, scope.projectId, scope.workThreadId, scope.artifactId,
  );
  coherentRewrite.exec(`create trigger direct_artifact_audit_events_no_update
    before update on direct_artifact_audit_events
    begin select raise(abort, 'artifact_audit_append_only'); end;`);
  coherentRewrite.close();
  expectCode("artifact_audit_event_authentication_failed", () => createDirectArtifactAuditStore(storeOptions()));

  restore();
  const addTable = new DatabaseSync(dbPath);
  addTable.exec("create table unrelated_borrowed_table(id text primary key)");
  addTable.close();
  expectCode("artifact_audit_store_schema_tampered", () => createDirectArtifactAuditStore(storeOptions()));

  restore();

  const reentrantRoot = fs.mkdtempSync(path.join(temporaryRoot, "direct-artifact-reentrant-"));
  const reentrantKeyFile = path.join(reentrantRoot, "artifact-audit.key");
  fs.writeFileSync(reentrantKeyFile, crypto.randomBytes(32), { mode: 0o600 });
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
    rootDir: reentrantRoot, storeId: "reentrant", authority, evidenceReceiptAuthority,
    keyFilePath: reentrantKeyFile, now: reentrantNow,
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

  const foreignRoot = fs.mkdtempSync(path.join(temporaryRoot, "direct-artifact-foreign-"));
  const foreignDir = path.join(foreignRoot, "direct-artifact-audit");
  fs.mkdirSync(foreignDir, { recursive: true, mode: 0o700 });
  const foreignKeyFile = path.join(foreignRoot, "artifact-audit.key");
  fs.writeFileSync(foreignKeyFile, crypto.randomBytes(32), { mode: 0o600 });
  const foreignPath = path.join(foreignDir, "foreign.sqlite");
  const foreign = new DatabaseSync(foreignPath);
  foreign.exec("create table direct_world_manager_state(id text primary key)");
  foreign.close();
  if (process.platform !== "win32") fs.chmodSync(foreignPath, 0o600);
  expectCode("artifact_audit_foreign_store", () => createDirectArtifactAuditStore({
    rootDir: foreignRoot, storeId: "foreign", authority, evidenceReceiptAuthority,
    keyFilePath: foreignKeyFile,
  }));
  const verifyForeign = new DatabaseSync(foreignPath);
  assert.deepEqual(verifyForeign.prepare("select name from sqlite_master where type = 'table' order by name").all()
    .map((row) => row.name), ["direct_world_manager_state"]);
  verifyForeign.close();
  fs.rmSync(foreignRoot, { recursive: true, force: true });

  const symlinkRoot = fs.mkdtempSync(path.join(temporaryRoot, "direct-artifact-symlink-"));
  const symlinkOutside = fs.mkdtempSync(path.join(temporaryRoot, "direct-artifact-outside-"));
  const symlinkKey = path.join(symlinkRoot, "artifact-audit.key");
  fs.writeFileSync(symlinkKey, crypto.randomBytes(32), { mode: 0o600 });
  fs.symlinkSync(symlinkOutside, path.join(symlinkRoot, "direct-artifact-audit"),
    process.platform === "win32" ? "junction" : "dir");
  expectCode("artifact_audit_store_path_unsafe", () => createDirectArtifactAuditStore({
    rootDir: symlinkRoot, storeId: "redirected", authority, evidenceReceiptAuthority,
    keyFilePath: symlinkKey,
  }));
  assert.equal(fs.existsSync(path.join(symlinkOutside, "redirected.sqlite")), false);
  fs.rmSync(symlinkRoot, { recursive: true, force: true });
  fs.rmSync(symlinkOutside, { recursive: true, force: true });

  const linkedRootParent = fs.mkdtempSync(path.join(temporaryRoot, "direct-artifact-linked-root-"));
  const linkedRootTarget = fs.mkdtempSync(path.join(temporaryRoot, "direct-artifact-linked-target-"));
  const linkedRoot = path.join(linkedRootParent, "store-root");
  const linkedRootKey = path.join(linkedRootParent, "artifact-audit.key");
  fs.writeFileSync(linkedRootKey, crypto.randomBytes(32), { mode: 0o600 });
  fs.symlinkSync(linkedRootTarget, linkedRoot, process.platform === "win32" ? "junction" : "dir");
  expectCode("artifact_audit_store_path_unsafe", () => createDirectArtifactAuditStore({
    rootDir: linkedRoot, storeId: "linked-root", authority, evidenceReceiptAuthority,
    keyFilePath: linkedRootKey,
  }));
  fs.rmSync(linkedRootParent, { recursive: true, force: true });
  fs.rmSync(linkedRootTarget, { recursive: true, force: true });

  if (process.platform !== "win32") {
    const insecureKeyRoot = fs.mkdtempSync(path.join(temporaryRoot, "direct-artifact-insecure-key-"));
    const insecureKey = path.join(insecureKeyRoot, "artifact-audit.key");
    fs.writeFileSync(insecureKey, crypto.randomBytes(32), { mode: 0o644 });
    expectCode("artifact_audit_store_key_file_permissions_unsafe", () => createDirectArtifactAuditStore({
      rootDir: insecureKeyRoot, storeId: "insecure", authority, evidenceReceiptAuthority,
      keyFilePath: insecureKey,
    }));
    fs.rmSync(insecureKeyRoot, { recursive: true, force: true });
  }

  const assignmentRoot = fs.mkdtempSync(path.join(temporaryRoot, "direct-artifact-assignment-"));
  const assignmentKey = path.join(assignmentRoot, "artifact-audit.key");
  fs.writeFileSync(assignmentKey, crypto.randomBytes(32), { mode: 0o600 });
  const assignmentScope = {
    projectId: "assignment-project", workThreadId: "assignment-thread",
    artifactId: "assignment-artifact", artifactClassId: "assignment-class",
  };
  const assignmentPolicyInput = {
    projectId: assignmentScope.projectId, artifactClassId: assignmentScope.artifactClassId,
    revision: 1, managerRoleId: "manager", producerRoleIds: ["producer"],
    admissionRoleId: "admission", allowedEvidenceKinds: ["workspace_worker_terminal"],
    roles: [
      { roleId: "manager", actors: ["assignment-manager"], rights: ["propose", "read"] },
      { roleId: "producer", actors: ["assignment-producer"], rights: ["propose"] },
      { roleId: "general-auditor", actors: ["assignment-a", "assignment-b"], rights: ["challenge"] },
      { roleId: "special-auditor", actors: ["assignment-a"], rights: ["challenge"] },
      { roleId: "admission", actors: ["assignment-authority"], rights: ["admit"] },
    ],
    auditRequirements: [
      { requirementId: "general-check", auditorRoleIds: ["general-auditor"],
        separationRequired: true, evidenceKinds: ["test_report"] },
      { requirementId: "special-check", auditorRoleIds: ["special-auditor"],
        separationRequired: true, evidenceKinds: ["test_report"] },
    ],
  };
  const assignmentPolicy = buildPolicySnapshot(assignmentPolicyInput);
  const assignmentBindings = [
    ["assignment-manager", "manager", ["declare", "act", "admin_read"]],
    ["assignment-producer", "producer", ["act"]],
    ["assignment-a", "general-auditor", ["act"]],
    ["assignment-a", "special-auditor", ["act"]],
    ["assignment-b", "general-auditor", ["act"]],
    ["assignment-authority", "admission", ["act"]],
    [evidenceAdapter.actorId, evidenceAdapter.roleId, ["register_evidence"]],
  ].map(([actorId, roleId, purposes]) => ({
    projectId: assignmentScope.projectId, artifactClassId: assignmentScope.artifactClassId,
    policyDigest: assignmentPolicy.policyDigest, actorId, roleId, purposes,
  }));
  const assignmentAuthority = createArtifactAuditPrincipalAuthority({
    authorityId: "assignment-harness", bindings: assignmentBindings,
  });
  const assignmentPrincipal = (actorId, roleId, purpose = "act") => assignmentAuthority.issue({
    projectId: assignmentScope.projectId, artifactClassId: assignmentScope.artifactClassId,
    policyDigest: assignmentPolicy.policyDigest, actorId, roleId, purpose,
  });
  let assignmentStore = createDirectArtifactAuditStore({
    rootDir: assignmentRoot, storeId: "assignment", authority: assignmentAuthority,
    evidenceReceiptAuthority, keyFilePath: assignmentKey,
  });
  const assignmentEvidence = (kind, evidenceId) => assignmentStore.registerEvidence({
    principal: assignmentPrincipal(evidenceAdapter.actorId, evidenceAdapter.roleId, "register_evidence"),
    receipt: evidenceReceiptAuthority.issue({
      kind, evidenceId, ...assignmentScope, revision: 1, policyDigest: assignmentPolicy.policyDigest,
      sourceCaptureId: `capture-${evidenceId}`, sourceSessionId: "assignment-session",
      sourceTurnId: `turn-${evidenceId}`, canonicalEnvelopeDigest: digest("7"),
    }),
  }).ref;
  try {
    assignmentStore.declareArtifactClass({
      policy: assignmentPolicyInput,
      principal: assignmentPrincipal("assignment-manager", "manager", "declare"),
    });
    const assignmentRoute = assignmentStore.compileRoutingPlan({
      scope: assignmentScope, policyDigest: assignmentPolicy.policyDigest,
      principal: assignmentPrincipal("assignment-manager", "manager"),
    });
    assert.deepEqual(assignmentRoute.feasibleAssignments[0].audits.map((entry) =>
      [entry.requirementId, entry.actorId]), [
      ["general-check", "assignment-b"], ["special-check", "assignment-a"],
    ]);
    assignmentStore.requestArtifact({
      scope: assignmentScope, policyDigest: assignmentPolicy.policyDigest,
      principal: assignmentPrincipal("assignment-manager", "manager"), idempotencyKey: "request",
    });
    assignmentStore.beginProduction({
      scope: assignmentScope, policyDigest: assignmentPolicy.policyDigest,
      principal: assignmentPrincipal("assignment-producer", "producer"), idempotencyKey: "produce",
      expectedRevision: 1, expectedState: "requested",
    });
    assignmentStore.submitCandidate({
      scope: assignmentScope, policyDigest: assignmentPolicy.policyDigest,
      principal: assignmentPrincipal("assignment-producer", "producer"), idempotencyKey: "candidate",
      expectedRevision: 1, expectedState: "under_production",
      evidenceRefs: [assignmentEvidence("workspace_worker_terminal", "assignment-terminal")],
    });
    expectCode("artifact_audit_assignment_actor_ineligible", () => assignmentStore.beginAudit({
      scope: assignmentScope, policyDigest: assignmentPolicy.policyDigest,
      principal: assignmentPrincipal("assignment-a", "general-auditor"), idempotencyKey: "wrong-start",
      expectedRevision: 1, expectedState: "candidate",
    }));
    assignmentStore.beginAudit({
      scope: assignmentScope, policyDigest: assignmentPolicy.policyDigest,
      principal: assignmentPrincipal("assignment-b", "general-auditor"), idempotencyKey: "audit",
      expectedRevision: 1, expectedState: "candidate",
    });
    expectCode("artifact_audit_assignment_actor_mismatch", () => assignmentStore.recordAuditVerdict({
      scope: assignmentScope, policyDigest: assignmentPolicy.policyDigest,
      principal: assignmentPrincipal("assignment-a", "general-auditor"), idempotencyKey: "wrong-general",
      expectedRevision: 1, expectedState: "under_audit", requirementId: "general-check",
      verdict: "supported", evidenceRefs: [assignmentEvidence("test_report", "wrong-general-evidence")],
    }));
    assignmentStore.recordAuditVerdict({
      scope: assignmentScope, policyDigest: assignmentPolicy.policyDigest,
      principal: assignmentPrincipal("assignment-b", "general-auditor"), idempotencyKey: "general",
      expectedRevision: 1, expectedState: "under_audit", requirementId: "general-check",
      verdict: "supported", evidenceRefs: [assignmentEvidence("test_report", "general-evidence")],
    });
    assert.equal(assignmentStore.recordAuditVerdict({
      scope: assignmentScope, policyDigest: assignmentPolicy.policyDigest,
      principal: assignmentPrincipal("assignment-a", "special-auditor"), idempotencyKey: "special",
      expectedRevision: 1, expectedState: "under_audit", requirementId: "special-check",
      verdict: "supported", evidenceRefs: [assignmentEvidence("test_report", "special-evidence")],
    }).stateTo, "supported");
    assert.equal(assignmentStore.inspectHeadAdministrative({
      scope: assignmentScope, policyDigest: assignmentPolicy.policyDigest,
      principal: assignmentPrincipal("assignment-manager", "manager", "admin_read"),
    }).state, "supported");
  } finally {
    assignmentStore.close();
    assignmentStore = null;
    fs.rmSync(assignmentRoot, { recursive: true, force: true });
  }

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
    authenticatedRewriteRejected: true,
    sealedEvidenceReceiptsRequired: true,
    boundAuditAssignmentEnforced: true,
    symlinkStoreRejected: true,
    subscriptionHeadGateEnforced: true,
    foreignStoreRejectedBeforeDdl: true,
  }, null, 2));
} finally {
  try { store?.close(); } catch {}
  fs.rmSync(root, { recursive: true, force: true });
}
