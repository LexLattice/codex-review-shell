#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DirectArtifactAuditStore } = require("../src/main/direct/artifacts/artifact-audit-store.js");
const { buildPolicySnapshot, compileArtifactRoutingPlan } = require("../src/main/direct/artifacts/artifact-audit-kernel.js");

const digest = (char) => `sha256:${char.repeat(64)}`;
const actor = (actorId, roleId) => ({ actorId, roleId });
const manager = actor("manager-1", "manager");
const producer = actor("producer-1", "producer");
const auditorA = actor("auditor-a", "static-auditor");
const auditorB = actor("auditor-b", "behavior-auditor");
const authority = actor("authority-1", "admission-authority");
const parent = actor("parent-1", "observer");
const sharedProducerAuditor = actor("shared-actor", "producer");
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
    { roleId: "producer", actors: [producer.actorId, sharedProducerAuditor.actorId], rights: ["propose", "read"] },
    { roleId: "static-auditor", actors: [auditorA.actorId, sharedProducerAuditor.actorId], rights: ["challenge", "read"] },
    { roleId: "behavior-auditor", actors: [auditorB.actorId], rights: ["challenge", "read"] },
    { roleId: "admission-authority", actors: [authority.actorId], rights: ["admit", "read"] },
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

function evidence(kind, id, revision, char = "a", overrides = {}) {
  return {
    kind,
    id,
    digest: digest(char),
    projectId: scope.projectId,
    workThreadId: scope.workThreadId,
    artifactId: scope.artifactId,
    revision,
    ...overrides,
  };
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "direct-artifact-audit-"));
const dbPath = path.join(root, "artifact-audit.sqlite");
let tick = Date.parse("2026-08-12T00:00:00.000Z");
const store = new DirectArtifactAuditStore({ dbPath, now: () => tick++ });

try {
  const policy = buildPolicySnapshot(policyInput);
  assert.equal(policy.schema, "direct_artifact_audit_policy@1");
  assert.deepEqual(buildPolicySnapshot({ ...policyInput, roles: [...policyInput.roles].reverse() }).policyDigest, policy.policyDigest);

  const declaration = store.declareArtifactClass({ policy: policyInput, actor: manager });
  assert.equal(declaration.changed, true);
  assert.equal(store.declareArtifactClass({ policy: policyInput, actor: manager }).changed, false);
  expectCode("artifact_audit_policy_substitution", () => store.declareArtifactClass({
    policy: { ...policyInput, revision: 2 }, actor: manager,
  }));
  expectCode("artifact_audit_role_forgery", () => store.declareArtifactClass({
    policy: policyInput, actor: actor("intruder", "manager"),
  }));
  expectCode("artifact_audit_raw_exposure", () => buildPolicySnapshot({
    ...policyInput, providerPayload: "secret",
  }));
  expectCode("artifact_audit_role_separation_invalid", () => buildPolicySnapshot({
    ...policyInput,
    auditRequirements: [{
      requirementId: "overlap",
      auditorRoleIds: ["producer"],
      separationRequired: true,
      evidenceKinds: ["test_report"],
    }],
  }));

  const route = store.compileRoutingPlan({ scope, policyDigest: policy.policyDigest });
  assert.equal(route.launchesProviders, false);
  assert.deepEqual(route.producer.eligibleActors.map((entry) => entry.actorId), ["producer-1", "shared-actor"]);
  assert.equal(route.audits.length, 2);
  assert.equal(route.planDigest, compileArtifactRoutingPlan(policy, scope).planDigest);
  assert.equal(JSON.stringify(route).includes("provider"), false);

  const requested = store.requestArtifact({
    scope, policyDigest: policy.policyDigest, actor: manager, idempotencyKey: "request-1",
  });
  assert.equal(requested.stateTo, "requested");
  assert.deepEqual(store.requestArtifact({
    scope, policyDigest: policy.policyDigest, actor: manager, idempotencyKey: "request-1",
  }), requested);
  expectCode("artifact_audit_idempotency_input_conflict", () => store.requestArtifact({
    scope: { ...scope, artifactId: "different-artifact" },
    policyDigest: policy.policyDigest, actor: manager, idempotencyKey: "request-1",
  }));
  expectCode("artifact_audit_policy_substitution", () => store.beginProduction({
    scope, policyDigest: digest("9"), actor: producer, idempotencyKey: "bad-policy",
    expectedRevision: 1, expectedState: "requested",
  }));
  expectCode("artifact_audit_raw_exposure", () => store.beginProduction({
    scope, policyDigest: policy.policyDigest, actor: producer, idempotencyKey: "raw-path",
    expectedRevision: 1, expectedState: "requested", workspaceLocation: "private/tree",
  }));
  expectCode("artifact_audit_role_forgery", () => store.beginProduction({
    scope, policyDigest: policy.policyDigest, actor: actor("auditor-a", "producer"),
    idempotencyKey: "forged-role", expectedRevision: 1, expectedState: "requested",
  }));

  store.beginProduction({
    scope, policyDigest: policy.policyDigest, actor: producer, idempotencyKey: "produce-r1",
    expectedRevision: 1, expectedState: "requested",
  });
  expectCode("artifact_audit_stale_revision", () => store.submitCandidate({
    scope, policyDigest: policy.policyDigest, actor: producer, idempotencyKey: "stale",
    expectedRevision: 2, expectedState: "under_production",
    evidenceRefs: [evidence("workspace_worker_terminal", "terminal-r1", 1)],
  }));
  expectCode("artifact_audit_cross_scope_ref", () => store.submitCandidate({
    scope, policyDigest: policy.policyDigest, actor: producer, idempotencyKey: "cross-project",
    expectedRevision: 1, expectedState: "under_production",
    evidenceRefs: [evidence("workspace_worker_terminal", "terminal-r1", 1, "a", { projectId: "other-project" })],
  }));
  expectCode("artifact_audit_evidence_missing", () => store.submitCandidate({
    scope, policyDigest: policy.policyDigest, actor: producer, idempotencyKey: "missing-evidence",
    expectedRevision: 1, expectedState: "under_production", evidenceRefs: [],
  }));
  const candidateR1 = store.submitCandidate({
    scope, policyDigest: policy.policyDigest, actor: producer, idempotencyKey: "candidate-r1",
    expectedRevision: 1, expectedState: "under_production",
    evidenceRefs: [evidence("workspace_worker_terminal", "terminal-r1", 1)],
  });
  assert.equal(candidateR1.stateTo, "candidate");
  assert.equal(candidateR1.canonicalProjectTruth, false);
  assert.equal(candidateR1.evidenceRefs[0].kind, "workspace_worker_terminal");
  expectCode("artifact_audit_admission_incomplete", () => store.decideArtifact({
    scope, policyDigest: policy.policyDigest, actor: authority, idempotencyKey: "early-admit",
    expectedRevision: 1, expectedState: "candidate", decision: "admitted",
  }));

  store.beginAudit({
    scope, policyDigest: policy.policyDigest, actor: auditorA, idempotencyKey: "audit-r1",
    expectedRevision: 1, expectedState: "candidate",
  });
  const partial = store.recordAuditVerdict({
    scope, policyDigest: policy.policyDigest, actor: auditorA, idempotencyKey: "static-r1",
    expectedRevision: 1, expectedState: "under_audit", requirementId: "static-safety",
    verdict: "supported", evidenceRefs: [evidence("test_report", "static-test-r1", 1, "b")],
  });
  assert.equal(partial.stateTo, "under_audit");
  expectCode("artifact_audit_duplicate_audit_identity", () => store.recordAuditVerdict({
    scope, policyDigest: policy.policyDigest, actor: auditorA, idempotencyKey: "duplicate-r1",
    expectedRevision: 1, expectedState: "under_audit", requirementId: "static-safety",
    verdict: "supported", evidenceRefs: [evidence("test_report", "static-test-duplicate", 1, "c")],
  }));
  const revisionNeeded = store.recordAuditVerdict({
    scope, policyDigest: policy.policyDigest, actor: auditorB, idempotencyKey: "behavior-r1",
    expectedRevision: 1, expectedState: "under_audit", requirementId: "behavioral-proof",
    verdict: "requires_revision", evidenceRefs: [evidence("audit_observation", "behavior-r1", 1, "d")],
  });
  assert.equal(revisionNeeded.stateTo, "requires_revision");
  store.decideArtifact({
    scope, policyDigest: policy.policyDigest, actor: authority, idempotencyKey: "remand-r1",
    expectedRevision: 1, expectedState: "requires_revision", decision: "remanded",
  });

  const productionR2 = store.beginProduction({
    scope, policyDigest: policy.policyDigest, actor: sharedProducerAuditor, idempotencyKey: "produce-r2",
    expectedRevision: 1, expectedState: "remanded",
  });
  assert.equal(productionR2.scope.revision, 2);
  store.submitCandidate({
    scope, policyDigest: policy.policyDigest, actor: sharedProducerAuditor, idempotencyKey: "candidate-r2",
    expectedRevision: 2, expectedState: "under_production",
    evidenceRefs: [evidence("workspace_worker_terminal", "terminal-r2", 2, "e")],
  });
  expectCode("artifact_audit_self_audit_denied", () => store.beginAudit({
    scope, policyDigest: policy.policyDigest,
    actor: actor(sharedProducerAuditor.actorId, "static-auditor"), idempotencyKey: "self-audit-r2",
    expectedRevision: 2, expectedState: "candidate",
  }));
  store.beginAudit({
    scope, policyDigest: policy.policyDigest, actor: auditorA, idempotencyKey: "audit-r2",
    expectedRevision: 2, expectedState: "candidate",
  });
  store.recordAuditVerdict({
    scope, policyDigest: policy.policyDigest, actor: auditorA, idempotencyKey: "static-r2",
    expectedRevision: 2, expectedState: "under_audit", requirementId: "static-safety",
    verdict: "supported", evidenceRefs: [evidence("test_report", "static-test-r2", 2, "f")],
  });
  const supported = store.recordAuditVerdict({
    scope, policyDigest: policy.policyDigest, actor: auditorB, idempotencyKey: "behavior-r2",
    expectedRevision: 2, expectedState: "under_audit", requirementId: "behavioral-proof",
    verdict: "supported", evidenceRefs: [evidence("test_report", "behavior-test-r2", 2, "1")],
  });
  assert.equal(supported.stateTo, "supported");
  expectCode("artifact_audit_right_denied", () => store.decideArtifact({
    scope, policyDigest: policy.policyDigest, actor: manager, idempotencyKey: "manager-admit-r2",
    expectedRevision: 2, expectedState: "supported", decision: "admitted",
  }));
  const admitted = store.decideArtifact({
    scope, policyDigest: policy.policyDigest, actor: authority, idempotencyKey: "admit-r2",
    expectedRevision: 2, expectedState: "supported", decision: "admitted",
  });
  assert.equal(admitted.stateTo, "admitted");

  const contradictedScope = { ...scope, artifactId: "solver-artifact-contradicted" };
  store.requestArtifact({
    scope: contradictedScope, policyDigest: policy.policyDigest, actor: manager, idempotencyKey: "request-contradicted",
  });
  store.beginProduction({
    scope: contradictedScope, policyDigest: policy.policyDigest, actor: producer,
    idempotencyKey: "produce-contradicted", expectedRevision: 1, expectedState: "requested",
  });
  store.submitCandidate({
    scope: contradictedScope, policyDigest: policy.policyDigest, actor: producer,
    idempotencyKey: "candidate-contradicted", expectedRevision: 1, expectedState: "under_production",
    evidenceRefs: [evidence("artifact_blob", "contradicted-candidate", 1, "2", { artifactId: contradictedScope.artifactId })],
  });
  store.beginAudit({
    scope: contradictedScope, policyDigest: policy.policyDigest, actor: auditorA,
    idempotencyKey: "audit-contradicted", expectedRevision: 1, expectedState: "candidate",
  });
  store.recordAuditVerdict({
    scope: contradictedScope, policyDigest: policy.policyDigest, actor: auditorA,
    idempotencyKey: "static-contradicted", expectedRevision: 1, expectedState: "under_audit",
    requirementId: "static-safety", verdict: "supported",
    evidenceRefs: [evidence("test_report", "static-contradicted", 1, "3", { artifactId: contradictedScope.artifactId })],
  });
  const contradicted = store.recordAuditVerdict({
    scope: contradictedScope, policyDigest: policy.policyDigest, actor: auditorB,
    idempotencyKey: "behavior-contradicted", expectedRevision: 1, expectedState: "under_audit",
    requirementId: "behavioral-proof", verdict: "contradicted",
    evidenceRefs: [evidence("audit_observation", "behavior-contradicted", 1, "4", { artifactId: contradictedScope.artifactId })],
  });
  assert.equal(contradicted.stateTo, "contradicted");
  const rejected = store.decideArtifact({
    scope: contradictedScope, policyDigest: policy.policyDigest, actor: authority,
    idempotencyKey: "reject-contradicted", expectedRevision: 1, expectedState: "contradicted", decision: "rejected",
  });
  assert.equal(rejected.stateTo, "rejected");

  const subscription = store.subscribe({
    subscriptionId: "parent-artifact-transitions",
    projectId: scope.projectId,
    workThreadId: scope.workThreadId,
    artifactId: scope.artifactId,
    artifactClassId: scope.artifactClassId,
    policyDigest: policy.policyDigest,
    actor: parent,
    eventTypes: ["candidate_recorded", "audit_verdict_recorded", "artifact_admitted", "artifact_remanded"],
  });
  assert.equal(subscription.actor.actorId, parent.actorId);
  const projection = store.pollSubscription({
    subscriptionId: subscription.subscriptionId, actor: parent, afterSequence: 0, limit: 100,
  });
  assert.equal(projection.deliveryMode, "passive_poll");
  assert.equal(projection.activeWorkerMessageCount, 0);
  assert.equal(projection.transitions.every((event) => event.canonicalProjectTruth === false), true);
  assert.equal(projection.transitions.at(-1).stateTo, "admitted");
  assert.equal(projection.transitions.some((event) => event.audit?.verdict === "requires_revision"), true);
  assert.equal(projection.transitions.every((event) => !Object.hasOwn(event, "actor")), true);
  assert.equal(JSON.stringify(projection).includes("prompt"), false);
  assert.equal(JSON.stringify(projection).includes("provider"), false);
  assert.equal(JSON.stringify(projection).includes("/home/"), false);
  const bounded = store.pollSubscription({
    subscriptionId: subscription.subscriptionId, actor: parent, afterSequence: 0, limit: 1,
  });
  assert.equal(bounded.transitions.length, 1);
  assert.equal(bounded.truncated, true);
  expectCode("artifact_audit_subscription_actor_mismatch", () => store.pollSubscription({
    subscriptionId: subscription.subscriptionId, actor: manager, afterSequence: 0, limit: 1,
  }));
  expectCode("artifact_audit_raw_exposure", () => store.pollSubscription({
    subscriptionId: subscription.subscriptionId, actor: parent, afterSequence: 0, limit: 1,
    rawPrompt: "do not persist",
  }));

  const head = store.inspectHead({ scope, policyDigest: policy.policyDigest, actor: parent });
  assert.equal(head.state, "admitted");
  assert.equal(head.scope.revision, 2);
  const journalMode = store.db.prepare("pragma journal_mode").get();
  assert.equal(String(journalMode.journal_mode).toLowerCase(), "wal");
  const eventCount = store.db.prepare("select count(*) as count from direct_artifact_audit_events").get().count;
  assert.equal(Number(eventCount), 20);
  assert.throws(() => store.db.prepare("delete from direct_artifact_audit_events").run(), /artifact_audit_append_only/);

  store.close();
  const reopened = new DirectArtifactAuditStore({ dbPath });
  try {
    assert.equal(reopened.inspectHead({ scope, policyDigest: policy.policyDigest, actor: parent }).state, "admitted");
    const replayedProjection = reopened.pollSubscription({
      subscriptionId: subscription.subscriptionId, actor: parent, afterSequence: projection.nextSequence, limit: 10,
    });
    assert.deepEqual(replayedProjection.transitions, []);
  } finally {
    reopened.close();
  }

  console.log(JSON.stringify({
    ok: true,
    policyDigest: policy.policyDigest,
    routePlanDigest: route.planDigest,
    finalState: "admitted",
    revision: 2,
    eventCount: Number(eventCount),
    passiveTransitions: projection.transitions.length,
  }, null, 2));
} finally {
  try { store.close(); } catch {}
  fs.rmSync(root, { recursive: true, force: true });
}
