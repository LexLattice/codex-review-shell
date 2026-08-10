#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
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
  ARO_RECONSTRUCTION_ACTION,
  DirectAroReconstructionRuntime,
  buildRepositorySemanticSnapshot,
  validateAroReconstructionRun,
  validateRepositorySemanticSnapshot,
} = require(
  "../src/main/direct/worldmanager/aro-reconstruction-runtime",
);

function sha256(value) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(value)
    .digest("hex")}`;
}

function git(cwd, args) {
  const result = spawnSync(
    "git",
    args,
    {
      cwd,
      encoding: "utf8",
    },
  );
  assert.equal(
    result.status,
    0,
    result.stderr,
  );
}

async function backendObservation(
  workspaceRoot,
  projectId,
) {
  const agentPath = path.resolve(
    "src/backend/wsl-agent.js",
  );
  const child = spawn(
    process.execPath,
    [
      agentPath,
      "--root",
      workspaceRoot,
      "--workspace-kind",
      "local",
      "--project-id",
      projectId,
    ],
    {
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let buffer = "";
  let stderr = "";
  let nextId = 1;
  const pending = new Map();
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (
        message.id &&
        pending.has(message.id)
      ) {
        const { resolve, reject } =
          pending.get(message.id);
        pending.delete(message.id);
        if (message.error) {
          reject(
            new Error(
              message.error.message,
            ),
          );
        } else {
          resolve(message.result);
        }
      }
    }
  });
  const request = (method, params = {}) => {
    const id = String(nextId++);
    return new Promise(
      (resolve, reject) => {
        pending.set(id, {
          resolve,
          reject,
        });
        child.stdin.write(
          `${JSON.stringify({
            id,
            method,
            params,
          })}\n`,
        );
      },
    );
  };
  try {
    const hello = await request("hello");
    assert.equal(
      hello.capabilities
        .repositorySemanticSnapshot,
      true,
    );
    return await request(
      "repositorySemanticSnapshot",
    );
  } finally {
    child.stdin.end();
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 4_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    assert.equal(stderr, "");
  }
}

function validAction(
  snapshot,
  suffix = "",
) {
  const first =
    snapshot.evidence[0];
  assert.ok(first);
  return {
    actionCalls: [{
      callId: `call_aro${suffix}`,
      name:
        ARO_RECONSTRUCTION_ACTION,
      argumentsJson: JSON.stringify({
        repositorySummary:
          "A bounded fixture that preserves semantic identity across source, tests, and documentation.",
        selectionRationale:
          "The repository evidence converges on one dominant semantic object.",
        reconstructions: [{
          conceptKey:
            `semantic_fixture${suffix}`,
          semanticIdentity:
            `Semantic fixture${suffix}`,
          purpose:
            "Preserve one abstract behavior while keeping implementation subordinate.",
          posture: "current",
          branches: [
            {
              branchKey:
                "stable_identity",
              parentBranchKey: "",
              branchKind:
                "semantic_invariant",
              modality: "required",
              statement:
                "The same semantic identity survives every implementation projection.",
              condition: "",
              expectedOutcome: "",
              semanticState:
                "supported",
              provenanceEvidenceKeys: [
                first.evidenceKey,
              ],
            },
            {
              branchKey:
                "missing_evidence",
              parentBranchKey:
                "stable_identity",
              branchKind:
                "counterfactual_edge",
              modality:
                "counterfactual",
              statement:
                "If evidence disappears, the object remains provisional.",
              condition:
                "The evidence catalog cannot support a realization claim.",
              expectedOutcome:
                "The reconstruction exposes uncertainty instead of claiming closure.",
              semanticState:
                "unknown",
              provenanceEvidenceKeys: [
                "repository_snapshot",
              ],
            },
          ],
          edges: [{
            fromBranchKey:
              "missing_evidence",
            toBranchKey:
              "stable_identity",
            relationKind:
              "counterfactual_of",
            rationale:
              "The missing-evidence case bounds the identity claim.",
          }],
          realizationBindings: [{
            branchKey:
              "stable_identity",
            realizationKind:
              first.evidenceKind ===
                "test_file"
                ? "test"
                : first.evidenceKind ===
                    "documentation"
                  ? "documentation"
                  : "source",
            locator:
              "Primary bounded fixture evidence",
            sourceEvidenceKey:
              first.evidenceKey,
            coverageState:
              "realized",
            evidenceKeys: [
              first.evidenceKey,
            ],
          }],
          contradictionEvidenceKeys: [],
        }],
      }),
    }],
    telemetry: {
      runtimeMode: "fixture",
      model: "fixture-model",
      reasoningEffort: "medium",
      toolCallCount: 1,
      toolNames: [
        ARO_RECONSTRUCTION_ACTION,
      ],
    },
  };
}

async function waitForJobs(service) {
  while (
    service.aroReconstructionJobs.size
  ) {
    await Promise.all(
      [
        ...service
          .aroReconstructionJobs
          .values(),
      ],
    );
  }
}

const tempRoot = fs.mkdtempSync(
  path.join(
    os.tmpdir(),
    "direct-world-manager-sc71-",
  ),
);
const workspaceRoot = path.join(
  tempRoot,
  "workspace",
);
fs.mkdirSync(
  path.join(workspaceRoot, "src"),
  { recursive: true },
);
fs.mkdirSync(
  path.join(workspaceRoot, "test"),
  { recursive: true },
);
fs.writeFileSync(
  path.join(workspaceRoot, "README.md"),
  "# Semantic Fixture\n\nThe system preserves one semantic identity across projections.\n",
);
fs.writeFileSync(
  path.join(workspaceRoot, "src", "index.js"),
  "module.exports = (value) => ({ semanticIdentity: value });\n",
);
fs.writeFileSync(
  path.join(workspaceRoot, "test", "index.test.js"),
  "const fixture = require('../src');\nif (!fixture('x').semanticIdentity) process.exit(1);\n",
);
fs.writeFileSync(
  path.join(workspaceRoot, ".env"),
  "SECRET_SHOULD_NEVER_ENTER_EVIDENCE=fixture\n",
);
git(workspaceRoot, ["init"]);
git(workspaceRoot, [
  "config",
  "user.email",
  "fixture@example.test",
]);
git(workspaceRoot, [
  "config",
  "user.name",
  "Fixture",
]);
git(workspaceRoot, [
  "add",
  "README.md",
  "src/index.js",
  "test/index.test.js",
]);
git(workspaceRoot, [
  "commit",
  "-m",
  "fixture",
]);

const observation =
  await backendObservation(
    workspaceRoot,
    "project_sc71",
  );
assert.equal(
  observation.gitAvailable,
  true,
);
assert.ok(
  observation.manifestPaths.includes(
    "README.md",
  ),
);
assert.ok(
  observation.manifestPaths.includes(
    ".env",
  ),
);
assert.ok(
  observation.evidence.every(
    (entry) =>
      entry.relativePath !== ".env" &&
      !entry.excerpt.includes(
        "SECRET_SHOULD_NEVER_ENTER_EVIDENCE",
      ),
  ),
);

const snapshot =
  buildRepositorySemanticSnapshot({
    projectId: "project_sc71",
    observation,
  });
validateRepositorySemanticSnapshot(
  snapshot,
);
assert.equal(
  snapshot.rawWorkspacePathIncluded,
  false,
);
assert.equal(
  snapshot.rawSecretIncluded,
  false,
);

let runtimeCallCount = 0;
const runtime =
  new DirectAroReconstructionRuntime({
    runner: async () => {
      runtimeCallCount += 1;
      return validAction(snapshot);
    },
  });
const storeRoot = path.join(
  tempRoot,
  "control-plane",
);
const store =
  new DirectWorldManagerControlPlaneStore({
    rootDir: storeRoot,
  });
let observationCount = 0;
const service =
  new DirectWorldManagerService({
    store,
    userWorldId:
      "user_world_sc71",
    projects: [{
      id: "project_sc71",
      name: "SC7.1 Fixture",
      summary:
        "Automatic semantic reconstruction fixture.",
      runtimePath: "direct",
      workspaceKind: "local",
    }],
    activeProjectId:
      "project_sc71",
    repositorySnapshotProvider:
      async () => {
        observationCount += 1;
        return observation;
      },
    aroReconstructionRuntime:
      runtime,
  });
const automaticTransitionReasons = [];
service.on(
  "transition",
  (transition) => {
    automaticTransitionReasons.push(
      transition.reason,
    );
  },
);
service.bootstrap();
await service.ready();
await waitForJobs(service);
assert.equal(observationCount, 1);
assert.equal(runtimeCallCount, 1);
assert.deepEqual(
  automaticTransitionReasons,
  [
    "aro-reconstruction-scheduled",
    "aro-reconstruction-running",
    "aro-reconstruction-completed",
  ],
);
const completed =
  store.latestAroReconstructionRun({
    projectId: "project_sc71",
  });
validateAroReconstructionRun(completed);
assert.equal(completed.state, "completed");
assert.equal(completed.candidateRefs.length, 1);
assert.equal(
  store.listAroReconstructionCandidates({
    projectId: "project_sc71",
  }).length,
  1,
);
const projection = service.snapshot();
if (
  process.env
    .CODEX_WORLD_MANAGER_SC71_COMPLETED_PROJECTION_PATH
) {
  fs.writeFileSync(
    process.env
      .CODEX_WORLD_MANAGER_SC71_COMPLETED_PROJECTION_PATH,
    JSON.stringify(
      projection,
      null,
      2,
    ),
  );
}
assert.equal(
  projection.aroRegistry
    .reconstructionRuns[0].state,
  "completed",
);
assert.equal(
  projection.projects[0]
    .aroReconstructionState,
  "completed",
);
assert.equal(
  projection.aroRegistry
    .repositorySnapshots[0]
    .sourceTextProjected,
  false,
);
const serializedProjection =
  JSON.stringify(projection);
assert.ok(
  !serializedProjection.includes(
    workspaceRoot,
  ),
);
assert.ok(
  !serializedProjection.includes(
    "SECRET_SHOULD_NEVER_ENTER_EVIDENCE",
  ),
);

// Repeated ready calls in one process do not keep re-observing the same
// project, and restart observation reuses the completed snapshot digest.
await service.ready();
await waitForJobs(service);
assert.equal(observationCount, 1);
service.close();

const restartStore =
  new DirectWorldManagerControlPlaneStore({
    rootDir: storeRoot,
  });
let restartRuntimeCalls = 0;
const restartService =
  new DirectWorldManagerService({
    store: restartStore,
    userWorldId:
      "user_world_sc71",
    projects: [{
      id: "project_sc71",
      name: "SC7.1 Fixture",
      summary:
        "Automatic semantic reconstruction fixture.",
      runtimePath: "direct",
      workspaceKind: "local",
    }],
    activeProjectId:
      "project_sc71",
    repositorySnapshotProvider:
      async () => observation,
    aroReconstructionRuntime:
      new DirectAroReconstructionRuntime({
        runner: async () => {
          restartRuntimeCalls += 1;
          return validAction(snapshot);
        },
      }),
  });
restartService.bootstrap();
await restartService.ready();
await waitForJobs(restartService);
assert.equal(restartRuntimeCalls, 0);
assert.equal(
  restartStore
    .listAroReconstructionRuns({
      projectId: "project_sc71",
    }).length,
  1,
);
restartService.close();

// A scheduled run cannot remain ambiguously active across a process
// boundary. Bootstrap revises it to a durable, exact-snapshot failure that
// the operator may explicitly retry.
const interruptedRoot = path.join(
  tempRoot,
  "interrupted-control-plane",
);
const interruptedStore =
  new DirectWorldManagerControlPlaneStore({
    rootDir: interruptedRoot,
  });
const interruptedSetupService =
  new DirectWorldManagerService({
    store: interruptedStore,
    userWorldId:
      "user_world_sc71_interrupted",
    projects: [{
      id:
        "project_sc71_interrupted",
      name: "Interrupted fixture",
      summary:
        "Restart recovery fixture.",
      runtimePath: "direct",
      workspaceKind: "local",
    }],
    activeProjectId:
      "project_sc71_interrupted",
  });
interruptedSetupService.bootstrap();
const interruptedSnapshot =
  buildRepositorySemanticSnapshot({
    projectId:
      "project_sc71_interrupted",
    observation: {
      ...observation,
      projectId:
        "project_sc71_interrupted",
    },
  });
interruptedStore
  .registerRepositorySemanticSnapshot({
    snapshot:
      interruptedSnapshot,
  });
const scheduledInterrupted =
  interruptedStore
    .scheduleAroReconstructionRun({
      snapshot:
        interruptedSnapshot,
    });
assert.equal(
  scheduledInterrupted.run.state,
  "scheduled",
);
interruptedSetupService.close();

const recoveredStore =
  new DirectWorldManagerControlPlaneStore({
    rootDir: interruptedRoot,
  });
const recoveredService =
  new DirectWorldManagerService({
    store: recoveredStore,
    userWorldId:
      "user_world_sc71_interrupted",
    projects: [{
      id:
        "project_sc71_interrupted",
      name: "Interrupted fixture",
      summary:
        "Restart recovery fixture.",
      runtimePath: "direct",
      workspaceKind: "local",
    }],
    activeProjectId:
      "project_sc71_interrupted",
    aroReconstructionRuntime:
      new DirectAroReconstructionRuntime({
        runner: async () =>
          validAction(
            interruptedSnapshot,
            "_interrupted",
          ),
      }),
  });
recoveredService.bootstrap();
const recoveredRun =
  recoveredStore
    .latestAroReconstructionRun({
      projectId:
        "project_sc71_interrupted",
    });
assert.equal(
  recoveredRun.state,
  "failed",
);
assert.equal(
  recoveredRun.retryable,
  true,
);
assert.equal(
  recoveredRun.error.code,
  "world_manager_aro_reconstruction_runtime_restart",
);
assert.equal(
  recoveredRun.repositorySnapshotRef
    .digest,
  interruptedSnapshot
    .snapshotDigest,
);
recoveredService.close();

// Provider failure is durable and visibly retryable. A retry observes the
// substrate again and cannot reuse the unavailable observation as success.
const failureRoot = path.join(
  tempRoot,
  "failure-control-plane",
);
const failureStore =
  new DirectWorldManagerControlPlaneStore({
    rootDir: failureRoot,
  });
let failObservation = true;
let failureRuntimeCalls = 0;
const failureService =
  new DirectWorldManagerService({
    store: failureStore,
    userWorldId:
      "user_world_sc71_failure",
    projects: [{
      id:
        "project_sc71_failure",
      name: "Failure fixture",
      summary:
        "Retryable repository observation fixture.",
      runtimePath: "direct",
      workspaceKind: "local",
    }],
    activeProjectId:
      "project_sc71_failure",
    repositorySnapshotProvider:
      async () => {
        if (failObservation) {
          const error = new Error(
            "fixture substrate unavailable",
          );
          error.code =
            "fixture_substrate_unavailable";
          throw error;
        }
        return {
          ...observation,
          projectId:
            "project_sc71_failure",
          observedAt:
            "2026-07-30T12:00:00.000Z",
        };
      },
    aroReconstructionRuntime:
      new DirectAroReconstructionRuntime({
        runner: async (request) => {
          failureRuntimeCalls += 1;
          const retrySnapshot =
            failureStore
              .repositorySemanticSnapshotById(
                request
                  .repositorySnapshotRef.id,
              );
          return validAction(
            retrySnapshot,
            "_retry",
          );
        },
      }),
  });
failureService.bootstrap();
await failureService.ready();
await waitForJobs(failureService);
const failedRun =
  failureStore.latestAroReconstructionRun({
    projectId:
      "project_sc71_failure",
  });
assert.equal(failedRun.state, "failed");
assert.equal(failedRun.retryable, true);
assert.equal(
  failureRuntimeCalls,
  0,
);
assert.equal(
  failureService.snapshot()
    .aroRegistry
    .repositorySnapshots[0]
    .observationState,
  "unavailable",
);
if (
  process.env
    .CODEX_WORLD_MANAGER_SC71_FAILED_PROJECTION_PATH
) {
  fs.writeFileSync(
    process.env
      .CODEX_WORLD_MANAGER_SC71_FAILED_PROJECTION_PATH,
    JSON.stringify(
      failureService.snapshot(),
      null,
      2,
    ),
  );
}
failObservation = false;
const retried =
  await failureService
    .retryAroReconstruction({
      projectId:
        "project_sc71_failure",
      expectedRunDigest:
        failedRun.digest,
    });
assert.equal(
  retried.receipt.state,
  "completed",
);
assert.equal(failureRuntimeCalls, 1);
assert.equal(
  failureStore
    .latestAroReconstructionRun({
      projectId:
        "project_sc71_failure",
    }).state,
  "completed",
);
if (
  process.env
    .CODEX_WORLD_MANAGER_SC71_RETRIED_PROJECTION_PATH
) {
  fs.writeFileSync(
    process.env
      .CODEX_WORLD_MANAGER_SC71_RETRIED_PROJECTION_PATH,
    JSON.stringify(
      failureService.snapshot(),
      null,
      2,
    ),
  );
}

// A structurally invalid semantic action is remanded rather than converted
// into a renderer-authored or harness-guessed ARO.
const remandRuntime =
  new DirectAroReconstructionRuntime({
    runner: async () => ({
      actionCalls: [{
        callId: "bad",
        name:
          "some_other_action",
        argumentsJson: "{}",
      }],
    }),
  });
const remanded =
  await remandRuntime.run({
    projectId:
      "project_sc71",
    project: {
      name: "SC7.1 Fixture",
    },
    snapshot,
    attempt: 1,
  });
assert.equal(remanded.state, "remanded");
assert.equal(remanded.candidates.length, 0);
assert.equal(
  remanded.validation
    .semanticContentValidatedAgainstClosedTaxonomy,
  false,
);

failureService.close();
fs.rmSync(tempRoot, {
  recursive: true,
  force: true,
});

console.log(JSON.stringify({
  ok: true,
  observationEvidenceCount:
    snapshot.evidence.length,
  runtimeCallCount,
  restartRuntimeCalls,
  failureRuntimeCalls,
  completedCandidates:
    completed.candidateRefs.length,
  automaticTransitionCount:
    automaticTransitionReasons.length,
  restartRecoveryState:
    recoveredRun.state,
  remandState:
    remanded.state,
  projectionSecretFree:
    true,
}));
