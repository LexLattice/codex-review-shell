#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import {
  createSemanticIngressFixture,
} from "./fixtures/world-manager-semantic-ingress-fixture.mjs";

const require = createRequire(import.meta.url);
const {
  DirectWorldManagerControlPlaneStore,
} = require("../src/main/direct/worldmanager/control-plane-store");
const {
  DirectWorldManagerService,
} = require("../src/main/direct/worldmanager/service");
const {
  DirectWorkThreadRegistryStore,
} = require("../src/main/direct/bridge/work-thread-registry");

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "direct-world-manager-k1-"));
const projects = [
  {
    id: "project_alpha",
    name: "Alpha",
    summary: "Primary K1 project",
    runtimePath: "direct",
  },
  {
    id: "project_beta",
    name: "Beta",
    summary: "Secondary K1 project",
    runtimePath: "legacy_app_server",
  },
];
let tick = Date.parse("2026-07-26T12:00:00.000Z");
const now = () => {
  tick += 1_000;
  return tick;
};
const workThreadStore = new DirectWorkThreadRegistryStore({
  rootDir: path.join(rootDir, "direct-sessions"),
  now,
});
workThreadStore.upsertWorkThread({
  workThreadId: "work_thread_existing_alpha",
  projectId: "project_alpha",
  title: "Existing implementation thread",
  objective: "Pre-existing operational work owned by the WorkThread registry.",
  lifecycleState: "active",
  phaseState: {
    phaseId: "phase_existing",
    phaseKind: "implementation",
    status: "active",
  },
  activeRuntimePath: "direct-implementation",
});

function createService() {
  return new DirectWorldManagerService({
    store: new DirectWorldManagerControlPlaneStore({ rootDir, now }),
    userWorldId: "user_world_regression",
    projects,
    activeProjectId: "project_alpha",
    workThreadStore,
    semanticIngressRunner: createSemanticIngressFixture(),
    now,
  });
}

let service = createService();
const initial = service.bootstrap().projection;
assert.equal(initial.schema, "direct_world_manager_workbench_projection@1");
assert.equal(initial.pipelineStage, "wm_k3");
assert.equal(initial.lifecycleState, "idle");
assert.equal(initial.worldPosture.semanticSettlement, "available");
assert.equal(initial.worldPosture.providerRoleRuntime, "not_started");
assert.equal(initial.candidateArtifacts.length, 0);
assert.equal(initial.pendingDecisions.length, 0);
assert.equal(initial.latestProposal, null);
assert.equal(initial.latestContract, null);
assert.equal(initial.truthPosture.uiMintsAuthority, false);
assert.equal(initial.store.persistence, "sqlite_wal");
assert.equal(initial.workThreads.length, 1);
assert.equal(initial.workThreads[0].workThreadId, "work_thread_existing_alpha");
assert.equal(initial.latestWorkThread, null);
const stableProjectWorldIds = initial.projects.map((project) => project.projectWorldId);

const request = {
  schema: "direct_world_manager_submit_request@1",
  clientRequestId: "client_request_k1_001",
  text: "Plan the next five features, but do not execute anything.",
  scopeHint: { projectId: "project_alpha" },
  expectedProjectionRevision: initial.projectionRevision,
  attachmentDraftRefs: [],
};
const accepted = service.submit(request);
assert.equal(accepted.receipt.state, "accepted");
assert.equal(accepted.receipt.presentationState, "agent_world_ready");
assert.equal(accepted.receipt.settlementState, "agent_world_ready");
assert.equal(accepted.receipt.grantsAuthority, false);
assert.equal(accepted.projection.messages.length, 1);
assert.equal(accepted.projection.messages[0].text, request.text);
assert.equal(accepted.projection.messages[0].state, "received");
assert.equal(accepted.projection.activeLineages[0].state, "agent_world_ready");
assert.match(accepted.projection.lifecycleLabel, /agent world.*validated/i);
assert.equal(accepted.projection.candidateArtifacts.length, 0);
assert.equal(accepted.projection.workThreads.length, 1);
assert.equal(workThreadStore.listWorkThreads().length, 1);

const reused = service.submit(request);
assert.equal(reused.receipt.state, "reused");
assert.equal(reused.receipt.reused, true);
assert.equal(
  reused.receipt.semanticEventRef.id,
  accepted.receipt.semanticEventRef.id,
);
assert.equal(reused.projection.messages.length, 1);
assert.equal(
  reused.projection.projectionRevision,
  accepted.projection.projectionRevision,
);

assert.throws(
  () => service.submit({ ...request, text: "Different content under the same id." }),
  (error) => error?.code === "world_manager_submit_idempotency_conflict",
);

const beforeRestartRevision = accepted.projection.projectionRevision;
const beforeRestartDigest = accepted.projection.projectionDigest;
service.close();

service = createService();
const reconstructed = service.bootstrap().projection;
assert.equal(reconstructed.messages.length, 1);
assert.equal(reconstructed.messages[0].text, request.text);
assert.equal(reconstructed.projectionRevision, beforeRestartRevision);
assert.equal(reconstructed.projectionDigest === beforeRestartDigest, false);
assert.deepEqual(
  reconstructed.projects.map((project) => project.projectWorldId),
  stableProjectWorldIds,
);
assert.equal(service.status().ledgerVerification.ok, true);
assert.equal(service.status().ledgerVerification.eventCount, 4);

assert.throws(
  () => service.focusProject({
    projectId: "project_beta",
    expectedProjectionRevision: 0,
  }),
  (error) => error?.code === "world_manager_projection_revision_conflict",
);
const betaFocus = service.focusProject({
  projectId: "project_beta",
  expectedProjectionRevision: reconstructed.projectionRevision,
});
assert.equal(betaFocus.projection.activeProjectId, "project_beta");
service.close();

service = createService();
const focusAfterRestart = service.bootstrap().projection;
assert.equal(focusAfterRestart.activeProjectId, "project_beta");
assert.equal(focusAfterRestart.messages.length, 1);
assert.equal(focusAfterRestart.store.rawProviderPayloadStored, false);
assert.equal(focusAfterRestart.store.rawChainOfThoughtStored, false);
assert.equal(focusAfterRestart.omissionWitness.omissionIsSuccess, false);
assert.deepEqual(focusAfterRestart.candidateArtifacts, []);
assert.deepEqual(focusAfterRestart.pendingDecisions, []);
service.close();

fs.rmSync(rootDir, { recursive: true, force: true });

console.log("direct world-manager K1 regression: ok");
