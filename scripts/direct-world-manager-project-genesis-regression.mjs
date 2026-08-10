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
  createDirectAuthStore,
} = require("../src/main/direct/auth/auth-store");
const {
  DirectLiveTextController,
} = require("../src/main/direct/controller/live-text-controller");
const {
  loadDirectCodexProfile,
} = require("../src/main/direct/odeu-profile/profile-loader");
const {
  DirectSessionStore,
} = require("../src/main/direct/session/session-store");
const {
  DirectThreadStore,
} = require("../src/main/direct/thread/thread-store");
const {
  DirectWorldManagerControlPlaneStore,
} = require("../src/main/direct/worldmanager/control-plane-store");
const {
  buildRealizationOptionSnapshot,
} = require("../src/main/direct/worldmanager/project-genesis");
const {
  DirectRoleRuntime,
} = require("../src/main/direct/worldmanager/role-runtime");
const {
  DirectWorldManagerService,
} = require("../src/main/direct/worldmanager/service");
const {
  DirectWorkThreadRegistryStore,
} = require("../src/main/direct/bridge/work-thread-registry");

function sseFor(id, payload) {
  const text = JSON.stringify(payload);
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: {
      get: (name) =>
        String(name || "").toLowerCase() === "content-type"
          ? "text/event-stream"
          : "",
    },
    text: async () => [
      "event: response.created",
      `data: ${JSON.stringify({ response: { id, model: "gpt-5.4" } })}`,
      "",
      "event: response.output_text.delta",
      `data: ${JSON.stringify({ item_id: `${id}_message`, delta: text })}`,
      "",
      "event: response.completed",
      `data: ${JSON.stringify({
        response: {
          id,
          status: "completed",
          usage: {
            input_tokens: 20,
            output_tokens: 30,
            total_tokens: 50,
          },
        },
      })}`,
      "",
      "data: [DONE]",
      "",
    ].join("\n"),
  };
}

const rootDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "direct-world-manager-genesis-"),
);
const sessionRoot = path.join(rootDir, "direct-sessions");
const profileDoc = JSON.parse(JSON.stringify(loadDirectCodexProfile()));
const models = Array.isArray(profileDoc.profile?.ontology?.models)
  ? profileDoc.profile.ontology.models
  : [];
const acceptedModel = models.find((entry) => entry?.id === "gpt-5.4");
if (acceptedModel) acceptedModel.status = "accepted";
else {
  profileDoc.profile.ontology.models = [
    ...models,
    {
      id: "gpt-5.4",
      displayName: "GPT-5.4",
      status: "accepted",
    },
  ];
}
const authStore = createDirectAuthStore({ mode: "memory" });
authStore.writeCredentials({
  accessToken: "genesis_regression_access_token_secret_1234567890",
  refreshToken: "genesis_regression_refresh_token_secret_1234567890",
  expiresAt: Date.now() + 3_600_000,
  accountId: "[REDACTED:account-id]",
});
const runtimeProject = {
  id: "project_control_plane",
  name: "Control Plane",
  workspace: {
    kind: "local",
    localPath: "[REDACTED:private-path]",
  },
  surfaceBinding: {
    codex: {
      runtimeMode: "direct-experimental",
      directTier: "text-only",
      directTransport: "live-text",
      model: "gpt-5.4",
      profileId: profileDoc.profile.profileId,
    },
  },
};
const responses = [
  sseFor("resp_genesis_wm", {
    schema: "direct_world_manager_project_genesis_result@1",
    semanticSummary:
      "A Windows-native project constitution is recommended for shell integration, while WSL remains an allowed secondary environment.",
    projectConstitution: {
      proposedProjectId: "project_windows_shell",
      name: "Windows Shell Integration",
      summary:
        "Build and test native Windows context-menu and shell-integration behavior.",
      primaryAgentEnvironmentId: "env_windows_native",
      allowedEnvironmentIds: [
        "env_windows_native",
        "env_wsl_native",
      ],
      gitAuthorityEnvironmentId: "env_windows_native",
    },
    realizationRecommendations: [
      {
        rank: 1,
        environmentId: "env_windows_native",
        rationale: [
          "The governed effects target native Windows shell behavior.",
        ],
        tradeoffs: [
          "Cross-environment source inspection may still use WSL.",
        ],
      },
      {
        rank: 2,
        environmentId: "env_wsl_native",
        rationale: [
          "WSL is useful for Linux-native development utilities.",
        ],
        tradeoffs: [
          "It cannot directly witness native Windows shell semantics.",
        ],
      },
    ],
    openDecisions: [
      "Choose the workspace path during provisioning.",
    ],
  }),
  sseFor("resp_genesis_reconciliation", {
    schema: "direct_world_manager_reconciliation_result@1",
    semanticSummary:
      "The proposed substrate matches the project effects and remains non-canonical.",
    blindspots: [
      "The workspace path has not been provisioned.",
    ],
    continuationPaths: [
      "Inspect the realization evidence.",
      "Admit the constitution if the default is correct.",
    ],
    recommendation:
      "Admit only after inspecting the observed Windows and WSL realization options.",
  }),
];
const capturedBodies = [];
const sessionStore = new DirectSessionStore({ rootDir: sessionRoot });
const threadStore = new DirectThreadStore({
  rootDir: sessionRoot,
  mode: "context_build_required",
});
let roleRuntime = null;
const controller = new DirectLiveTextController({
  sessionStore,
  directThreadStore: threadStore,
  profileDoc,
  authStore,
  compiledAgentContextResolver: (input) =>
    roleRuntime?.resolveCompiledAgentContext(input) || null,
  fetchImpl: async (_url, init) => {
    capturedBodies.push(JSON.parse(init.body));
    return responses.shift();
  },
});
roleRuntime = new DirectRoleRuntime({
  controller,
  sessionStore,
  resolveProject: async (projectId) =>
    projectId === runtimeProject.id ? runtimeProject : null,
});
let tick = Date.parse("2026-07-27T12:00:00.000Z");
const now = () => {
  tick += 1_000;
  return tick;
};
const realizationSnapshot = buildRealizationOptionSnapshot({
  controlPlaneEnvironmentId: "env_wsl_native",
  observedAt: "2026-07-27T12:00:00.000Z",
  options: [
    {
      environmentId: "env_wsl_native",
      environmentKind: "wsl",
      displayLabel: "WSL · Ubuntu",
      availability: "ready",
      admissionState: "eligible",
      nativeProcess: true,
      residentExecutorSupport: true,
      defaultShell: "bash",
      capabilityClasses: [
        "native_process",
        "resident_workspace_executor",
      ],
      evidenceRefs: [{
        kind: "runtime_realization_probe",
        id: "probe_wsl",
        digest: `sha256:${"1".repeat(64)}`,
      }],
    },
    {
      environmentId: "env_windows_native",
      environmentKind: "windows",
      displayLabel: "Windows · native resident process",
      availability: "ready",
      admissionState: "eligible",
      nativeProcess: true,
      residentExecutorSupport: true,
      defaultShell: "powershell",
      capabilityClasses: [
        "native_process",
        "resident_workspace_executor",
        "windows_shell_integration",
      ],
      evidenceRefs: [{
        kind: "runtime_realization_probe",
        id: "probe_windows",
        digest: `sha256:${"2".repeat(64)}`,
      }],
    },
  ],
});
const store = new DirectWorldManagerControlPlaneStore({
  rootDir,
  now,
});
const workThreadStore = new DirectWorkThreadRegistryStore({
  rootDir: sessionRoot,
  now,
});
const substrateObservation = (input = {}) => ({
  environmentId:
    input.runtimeDefault?.defaultEnvironmentId ||
    input.workspaceBinding?.environmentId ||
    "env_windows_native",
  workspaceKind: "windows",
  nativeWorkspacePath:
    input.workspace?.windowsPath ||
    "C:\\Users\\Rose\\work\\windows-shell",
  distro: "",
  windowsNodePath: "C:\\Program Files\\nodejs\\node.exe",
  workspaceLabel: "Windows shell project workspace",
  adapterKind: "direct_resident",
  probeState: "ready",
  nativePlatform: "win32",
  backendSessionId: "resident_windows_genesis_regression",
  processContinuityObserved: true,
  workspaceIdentityMatched: true,
  capabilityClasses: [
    "native_process",
    "resident_workspace_executor",
    "worker_runtime_binding",
    "windows_shell_integration",
  ],
  blockerCodes: [],
  observedAt: new Date(now()).toISOString(),
});
const service = new DirectWorldManagerService({
  store,
  workThreadStore,
  roleRuntime,
  realizationSnapshotProvider: () => realizationSnapshot,
  semanticIngressRunner: createSemanticIngressFixture(),
  userWorldId: "user_world_genesis_regression",
  projects: [{
    id: runtimeProject.id,
    name: runtimeProject.name,
    summary: "Direct control-plane runtime project.",
    runtimePath: "direct",
  }],
  activeProjectId: runtimeProject.id,
  projectSubstrateProvisioner: substrateObservation,
  environmentReadinessProvider: substrateObservation,
  now,
});
service.bootstrap();

const planned = await service.submit({
  schema: "direct_world_manager_submit_request@1",
  clientRequestId: "genesis_windows_shell",
  text:
    "Start a new project for native Windows context-menu and shell-integration work. Recommend Windows or WSL as its default agent substrate.",
  scopeHint: { projectId: runtimeProject.id },
  expectedProjectionRevision:
    service.snapshot().projectionRevision,
  attachmentDraftRefs: [],
});
assert.equal(planned.projection.pipelineStage, "wm_k6_genesis");
assert.equal(
  planned.projection.evidence.latestSettlement.taskType,
  "project_initialization",
);
assert.equal(
  planned.projection.evidence.latestSettlement.responsibleRole,
  "world_manager",
);
assert.equal(planned.projection.lifecycleState, "candidate_ready");
assert.equal(planned.projection.messages.at(-1).authorRole, "world_manager");
assert.equal(planned.projection.candidateArtifacts.length, 1);
assert.equal(planned.projection.latestProjectConstitution, null);
const candidate =
  planned.projection.latestProjectConstitutionCandidate;
assert.equal(candidate.canonical, false);
assert.equal(
  candidate.primaryAgentEnvironmentId,
  "env_windows_native",
);
assert.equal(candidate.evidenceReviewState, "not_reviewed");
assert.equal(candidate.reconciliationState, "reconciled");
const candidateProject =
  planned.projection.projects.find((project) =>
    project.projectId ===
      candidate.proposedProjectId);
assert.ok(candidateProject);
assert.equal(
  candidateProject.sourceKind,
  "project_constitution_candidate",
);
assert.equal(
  candidateProject.inspectionPosture,
  "semantic_candidate",
);
assert.equal(candidateProject.focusEligible, false);
assert.equal(
  candidateProject.constitutionState,
  "not_admitted",
);
assert.equal(
  planned.projection.projectEcology
    .establishedProjectCount,
  1,
);
assert.equal(
  planned.projection.projectEcology
    .candidateProjectCount,
  1,
);
assert.deepEqual(
  candidate.rankedRecommendations.map((entry) =>
    entry.environmentId),
  ["env_windows_native", "env_wsl_native"],
);
assert.deepEqual(
  planned.projection.omissionWitness.unavailableCapabilities,
  ["workspace_provisioning", "worker_execution"],
);
assert.equal(store.descriptor().counts.projectConstitutionCount, 0);
assert.equal(store.descriptor().counts.projectRuntimeDefaultCount, 0);
assert.equal(capturedBodies.length, 2);
assert.match(
  capturedBodies[0].instructions,
  /rank only (?:the )?(?:harness-observed|these harness-observed) realization options/i,
);
assert.match(
  capturedBodies[0].instructions,
  /env_windows_native/,
);
assert.equal(capturedBodies[0].tools, undefined);

if (
  process.env
    .CODEX_WORLD_MANAGER_GENESIS_CANDIDATE_PROJECTION_PATH
) {
  fs.writeFileSync(
    path.resolve(
      process.env
        .CODEX_WORLD_MANAGER_GENESIS_CANDIDATE_PROJECTION_PATH,
    ),
    JSON.stringify(planned.projection),
    "utf8",
  );
}

assert.throws(
  () => service.admitProjectGenesisCandidate({
    candidateId: candidate.candidateId,
    actorId: "operator",
  }),
  (error) =>
    error?.code ===
      "world_manager_project_genesis_admission_gate_closed",
);

const reviewed = service.inspectProjectGenesisCandidate({
  candidateId: candidate.candidateId,
});
assert.equal(reviewed.projection.lifecycleState, "candidate_reviewed");
assert.equal(
  reviewed.projection.latestProjectConstitutionCandidate
    .evidenceReviewState,
  "reviewed",
);
assert.equal(reviewed.projection.latestProjectConstitution, null);
const reviewedProject =
  reviewed.projection.projects.find((project) =>
    project.projectId ===
      candidate.proposedProjectId);
assert.equal(
  reviewedProject.projectId,
  candidateProject.projectId,
);
assert.equal(
  reviewedProject.evidenceReviewState,
  "reviewed",
);
assert.equal(
  reviewedProject.inspectionPosture,
  "semantic_candidate",
);
assert.equal(reviewedProject.focusEligible, false);
if (
  process.env
    .CODEX_WORLD_MANAGER_GENESIS_REVIEWED_PROJECTION_PATH
) {
  fs.writeFileSync(
    path.resolve(
      process.env
        .CODEX_WORLD_MANAGER_GENESIS_REVIEWED_PROJECTION_PATH,
    ),
    JSON.stringify(reviewed.projection),
    "utf8",
  );
}

const admitted = service.admitProjectGenesisCandidate({
  candidateId: candidate.candidateId,
  actorId: "operator",
});
assert.equal(admitted.projection.lifecycleState, "constitution_admitted");
assert.equal(
  admitted.receipt.activationState,
  "awaiting_workspace_provisioning",
);
assert.equal(
  admitted.projection.latestProjectConstitution.canonical,
  true,
);
assert.equal(
  admitted.projection.latestProjectConstitution
    .primaryAgentEnvironmentId,
  "env_windows_native",
);
assert.equal(
  admitted.projection.latestProjectConstitution.activationState,
  "awaiting_workspace_provisioning",
);
const admittedProject =
  admitted.projection.projects.filter((project) =>
    project.projectId ===
      candidate.proposedProjectId);
assert.equal(admittedProject.length, 1);
assert.equal(
  admittedProject[0].projectId,
  candidateProject.projectId,
);
assert.equal(
  admittedProject[0].sourceKind,
  "canonical_project_constitution",
);
assert.equal(
  admittedProject[0].inspectionPosture,
  "semantic_constitution",
);
assert.equal(admittedProject[0].candidateCount, 0);
assert.equal(admittedProject[0].focusEligible, false);
assert.equal(
  admitted.projection.projectEcology
    .establishedProjectCount,
  2,
);
assert.equal(
  admitted.projection.projectEcology
    .candidateProjectCount,
  0,
);
assert.equal(
  store.projectRuntimeDefault("project_windows_shell")
    .defaultEnvironmentId,
  "env_windows_native",
);
assert.equal(
  store.projectRuntimeDefault("project_windows_shell")
    .threadInheritanceRule,
  "new_threads_inherit_default_environment_and_existing_thread_bindings_remain_immutable",
);
assert.equal(store.verifyLedger().ok, true);

const provisioned = await service.provisionProjectSubstrate({
  projectId: "project_windows_shell",
  actorId: "operator",
  workspace: {
    kind: "windows",
    windowsPath: "C:\\Users\\Rose\\work\\windows-shell",
  },
});
assert.equal(provisioned.receipt.state, "provisioned");
assert.equal(
  provisioned.receipt.primaryEnvironmentId,
  "env_windows_native",
);
assert.equal(provisioned.receipt.nativePlatform, "win32");
assert.equal(provisioned.receipt.workspaceMutationEffect, false);
assert.equal(provisioned.projection.lifecycleState, "project_substrate_provisioned");
assert.equal(provisioned.projection.projectSubstrate.bindingCount, 1);
assert.equal(provisioned.projection.projectSubstrate.readyBindingCount, 1);
assert.equal(provisioned.projection.projectSubstrate.threadBindingCount, 1);
assert.equal(provisioned.projection.projectSubstrate.stepSnapshotCount, 1);
assert.equal(
  provisioned.projection.projectSubstrate.rawWorkspaceLocatorExposed,
  false,
);
assert.doesNotMatch(
  JSON.stringify(provisioned.projection.projectSubstrate),
  /C:\\\\Users|nativeWorkspacePath|windowsNodePath/,
);
assert.equal(
  provisioned.projection.omissionWitness.unavailableCapabilities.includes(
    "workspace_provisioning",
  ),
  false,
);
assert.equal(
  provisioned.projection.omissionWitness.unavailableCapabilities.includes(
    "authoritative_project_worldmodel_activation",
  ),
  true,
);
const provisionedProject = provisioned.projection.projects.find((project) =>
  project.projectId === "project_windows_shell");
assert.equal(
  provisionedProject.inspectionPosture,
  "provisioned_constitution",
);
assert.equal(
  provisionedProject.workspaceProvisioningState,
  "provisioned",
);
assert.equal(provisionedProject.primaryEnvironmentReady, true);
assert.equal(provisionedProject.focusEligible, false);
const runtimeDescriptor = service.runtimeProjectDescriptor(
  "project_windows_shell",
);
assert.equal(runtimeDescriptor.workspace.kind, "windows");
assert.equal(
  runtimeDescriptor.workspace.windowsPath,
  "C:\\Users\\Rose\\work\\windows-shell",
);
const reusedProvisioning = await service.provisionProjectSubstrate({
  projectId: "project_windows_shell",
  actorId: "operator",
  workspace: {
    kind: "windows",
    windowsPath: "C:\\Users\\Rose\\work\\windows-shell",
  },
});
assert.equal(reusedProvisioning.receipt.state, "reused");
await assert.rejects(
  service.provisionProjectSubstrate({
    projectId: "project_windows_shell",
    actorId: "operator",
    workspace: {
      kind: "windows",
      windowsPath: "C:\\different\\path",
    },
  }),
  (error) =>
    error?.code ===
      "world_manager_project_workspace_port_operation_required",
);
assert.equal(store.verifyLedger().ok, true);
if (
  process.env
    .CODEX_WORLD_MANAGER_GENESIS_PROVISIONED_PROJECTION_PATH
) {
  fs.writeFileSync(
    path.resolve(
      process.env
        .CODEX_WORLD_MANAGER_GENESIS_PROVISIONED_PROJECTION_PATH,
    ),
    JSON.stringify(provisioned.projection),
    "utf8",
  );
}

if (process.env.CODEX_WORLD_MANAGER_GENESIS_PROJECTION_PATH) {
  fs.writeFileSync(
    path.resolve(
      process.env.CODEX_WORLD_MANAGER_GENESIS_PROJECTION_PATH,
    ),
    JSON.stringify(admitted.projection),
    "utf8",
  );
}

service.close();
const restartStore = new DirectWorldManagerControlPlaneStore({
  rootDir,
  now,
});
const restartService = new DirectWorldManagerService({
  store: restartStore,
  workThreadStore,
  roleRuntime: {},
  realizationSnapshotProvider: () => realizationSnapshot,
  semanticIngressRunner: createSemanticIngressFixture(),
  userWorldId: "user_world_genesis_regression",
  projects: [{
    id: runtimeProject.id,
    name: runtimeProject.name,
    summary: "Direct control-plane runtime project.",
    runtimePath: "direct",
  }],
  activeProjectId: runtimeProject.id,
  projectSubstrateProvisioner: substrateObservation,
  environmentReadinessProvider: substrateObservation,
  now,
});
const restarted = restartService.bootstrap().projection;
assert.equal(restarted.pipelineStage, "wm_k6_genesis");
assert.equal(restarted.lifecycleState, "project_substrate_provisioned");
assert.equal(
  restarted.latestProjectConstitution
    .primaryAgentEnvironmentId,
  "env_windows_native",
);
assert.equal(
  restartStore.projectRuntimeDefault("project_windows_shell")
    .defaultEnvironmentId,
  "env_windows_native",
);
assert.equal(restarted.projectSubstrate.bindingCount, 1);
assert.equal(restarted.projectSubstrate.threadBindingCount, 1);
assert.equal(restarted.projectSubstrate.stepSnapshotCount, 1);
assert.equal(restartStore.verifyLedger().ok, true);

restartService.close();
threadStore.close();
fs.rmSync(rootDir, { recursive: true, force: true });

console.log(JSON.stringify({
  ok: true,
  regression: "direct-world-manager-project-genesis",
  proofs: {
    worldScopedProjectGenesisSettlement: true,
    trustedRealizationOptionsInjected: true,
    rankedWindowsAndWslRecommendation: true,
    candidateNonCanonicalBeforeReview: true,
    reconciledCandidateVisibleInProjectEcology: true,
    oneProjectIdentityPersistsAcrossLifecycle:
      true,
    explicitEvidenceReviewGate: true,
    explicitOperatorAdmission: true,
    immutableDefaultSubstrateBinding: true,
    nativeProjectSubstrateProvisioned: true,
    immutableThreadEnvironmentBinding: true,
    exactStepEnvironmentSnapshot: true,
    rawWorkspaceLocatorRemainsPrivate: true,
    substrateChangeRequiresExplicitPortOperation: true,
    authoritativeWorldmodelActivationStillDeferred: true,
    restartPreservesCanonicalSubstrate: true,
  },
  providerRequestCount: capturedBodies.length,
}, null, 2));
