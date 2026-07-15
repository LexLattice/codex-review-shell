#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { sha256 } = require("../src/main/direct/meta-session/digest");
const {
  buildDirectEnvironmentTopology,
  buildEnvironmentAwareToolCatalog,
  buildProjectControlProfileSnapshot,
  buildProjectExecutionProfileCatalog,
  buildProjectManagerProfile,
  buildPluginSpecialistWorkerContract,
  buildProjectProfileResolution,
  buildProjectProfileChangeNotification,
  buildProjectWorldState,
  buildTurnExecutionEnvironment,
  resolveProjectExecutionProfile,
  admitProjectProfileResolutionAgainstContext,
  validateProjectExecutionProfileBinding,
  validateProjectProfileChangeNotification,
  validateProjectProfileResolution,
  validateProjectProfileResolutionTrace,
} = require("../src/main/direct/worldmodel");
const { buildToolCapabilityRegistry } = require("../src/main/direct/bridge/tool-capability-registry");
const {
  buildDescriptor,
  buildProjectProfileRuntimeLaunchObservation,
  buildRuntimeCapabilityProfile,
  prepareProjectProfileLaunchRequest,
  registerProjectProfileLaunchResponse,
} = require("../src/main/codex-app-server");

const now = () => Date.UTC(2026, 6, 15, 14, 0, 0);
const digest = (value) => sha256(value);
const ref = (kind, id, label = id) => ({ kind, id, digest: digest(`${kind}:${id}`), label, rawTextIncluded: false, rawPathIncluded: false, rawSecretIncluded: false });
const source = (id) => ref("evidence", id);
const throws = (fn, code) => assert.throws(fn, (error) => error?.code === code);

const projectId = "project_profile_resolution";
const topology = buildDirectEnvironmentTopology({
  topologyId: "profile_topology", projectId, revision: 7, defaultEnvironmentId: "env_wsl",
  environments: [
    { environmentId: "env_wsl", environmentKind: "wsl", displayLabel: "WSL workspace", defaultShell: "bash", availableToolFamilyRefs: [ref("tool_family", "workspace")] },
    { environmentId: "env_windows", environmentKind: "windows", displayLabel: "Windows browser", defaultShell: "powershell", availableToolFamilyRefs: [ref("tool_family", "browser_control")] },
  ],
  mappings: [{ mappingId: "wsl_windows", fromEnvironmentId: "env_wsl", toEnvironmentId: "env_windows", fromRootEvidenceKey: "wsl_root", toRootEvidenceKey: "windows_root", direction: "two_way", mappingKind: "wsl_windows_path", readAllowed: true, writeAllowed: false }],
  constraints: [{ constraintId: "windows_no_mutation", environmentId: "env_windows", constraintKind: "no_workspace_mutation", rationale: "Specialist evidence is not workspace authority." }],
}, { now });
const topologyRef = ref("direct_environment_topology", topology.topologyId, "Direct environment topology"); topologyRef.digest = topology.topologyDigest;
const turn = buildTurnExecutionEnvironment({ topology, turnId: "profile_turn", threadId: "profile_thread", residentEnvironmentId: "env_wsl", selectionKind: "thread_default", reason: "default_work" }, { now });
const toolRegistry = buildToolCapabilityRegistry({ projectId, workThreadId: "profile_thread", rows: [{ toolId: "browser.verify", displayName: "browser_verify", directNames: ["browser_verify"], odeuFamily: "external_capability_discovery", capabilityState: "runtime_probed", implementationState: "projection_only", promotionState: "diagnostic_only", providerDeclarationState: "not_declared", localExecutorState: "scaffolded", requestShapeFamilies: ["browser_verification_task"], localExecutor: "browser-specialist" }] });
const toolCatalog = buildEnvironmentAwareToolCatalog({ projectId, capabilityRegistry: toolRegistry, topology, turnEnvironment: turn, rows: [{ toolId: "browser.verify", ownerEnvironmentId: "env_windows", environmentRouteClass: "specialist_worker_required", environmentActionClass: "windows_browser_action" }] }, { now });
const browserRoute = toolCatalog.routeRows[0];
const browserContract = buildPluginSpecialistWorkerContract({ contractId: "browser_profile_contract", routeRow: browserRoute, targetEnvironmentId: "env_windows", operationalNeed: "browser_verification" }, { now });

const manager = buildProjectManagerProfile({ projectManagerProfileId: "resident_pm", projectManagerAgentId: "pm", worldManagerAgentId: "wm", projectId, projectRootNodeId: "root", authorityBoundaryRef: ref("authority_boundary", "pm"), graphProjectionPolicyRef: ref("graph_projection_policy", "policy"), sourceRefs: [] }, { now });
const projectWorld = buildProjectWorldState({ projectManagerProfile: manager, canonicalGraphRef: ref("hierarchical_worldmodel_graph", "graph"), projectRevision: 3, terminalGoalNodeRefs: [ref("worldmodel_goal", "ship")], conceptualModelNodeRefs: [ref("worldmodel_architecture", "arc")], statusSummaryNodeRef: ref("worldmodel_semantic_node", "status") }, { now });

function catalogFixture({ ambiguous = false, unavailable = false } = {}) {
  const seed = buildProjectExecutionProfileCatalog({ profiles: [
    { profileId: "model", profileKind: "model", label: "Default model", availability: "available", sourceRefs: [source("model")] },
    { profileId: "high", profileKind: "reasoning_effort", label: "High reasoning", availability: "available", sourceRefs: [source("high")] },
  ], sourceRefs: [source("catalog")] }, { now });
  const model = seed.profiles.find((entry) => entry.profileId === "model");
  const effort = seed.profiles.find((entry) => entry.profileId === "high");
  const modelRef = ref("model_profile", model.profileId, model.label); modelRef.digest = model.profileDigest;
  const effortRef = ref("reasoning_effort_profile", effort.profileId, effort.label); effortRef.digest = effort.profileDigest;
  const entries = [
    { profileId: "model", profileKind: "model", label: "Default model", availability: "available", sourceRefs: [source("model")] },
    { profileId: "high", profileKind: "reasoning_effort", label: "High reasoning", availability: "available", sourceRefs: [source("high")] },
    { profileId: "pm_wsl", profileKind: "project_manager", label: "WSL high PM", availability: unavailable ? "unavailable" : "available", environmentId: "env_wsl", modelProfileRef: modelRef, reasoningEffortProfileRef: effortRef, sourceRefs: [source("pm_wsl")] },
    { profileId: "pm_windows", profileKind: "project_manager", label: "Windows PM", availability: "available", environmentId: "env_windows", modelProfileRef: modelRef, reasoningEffortProfileRef: effortRef, sourceRefs: [source("pm_windows")] },
    { profileId: "worker_wsl", profileKind: "worker", label: "WSL worker", availability: "available", environmentId: "env_wsl", sourceRefs: [source("worker_wsl")] },
    { profileId: "worker_windows", profileKind: "worker", label: "Windows worker", availability: "available", environmentId: "env_windows", sourceRefs: [source("worker_windows")] },
    { profileId: "browser_windows", profileKind: "specialist", label: "Windows browser", availability: "available", environmentId: "env_windows", operationalNeeds: ["browser_verification"], sourceRefs: [source("browser_windows")] },
    { profileId: "compat_wsl", profileKind: "specialist", label: "WSL compatibility", availability: "available", environmentId: "env_wsl", operationalNeeds: ["compatibility_check"], sourceRefs: [source("compat_wsl")] },
  ];
  if (ambiguous) entries.push({ ...entries.find((entry) => entry.profileId === "pm_wsl"), profileId: "pm_wsl_second", sourceRefs: [source("pm_wsl_second")] });
  return { catalog: buildProjectExecutionProfileCatalog({ profiles: entries, sourceRefs: [source("catalog")] }, { now }), modelRef, effortRef };
}

function controlFixture(modelRef, effortRef, overrides = {}) {
  return buildProjectControlProfileSnapshot({ projectId, projectRevision: 3, userControlProfileRefs: [ref("user_control_profile", "control")], environmentTopologyRef: topologyRef, authorizationBoundaryRef: ref("authorization_boundary", "control"), configuredModelProfileRef: modelRef, configuredReasoningEffortProfileRef: effortRef, concurrencyLimit: 3, delegationDepthLimit: 2, spawnAgentControls: { modelOverrideConfigured: true, reasoningEffortOverrideConfigured: true, effectiveStatus: "configured_unverified", fullHistoryForkInheritsParentProfile: true, fullHistoryOverrideAllowed: false, overrideForkTurns: ["none", "positive_integer"], ...overrides }, sourceRefs: [source("control")] }, { now });
}

const { catalog, modelRef, effortRef } = catalogFixture();
const control = controlFixture(modelRef, effortRef);
const wsl = resolveProjectExecutionProfile({ projectWorldState: projectWorld, projectManagerProfile: manager, controlProfileSnapshot: control, environmentTopology: topology, profileCatalog: catalog, environmentAwareToolCatalog: toolCatalog, projectNeeds: { homeEnvironmentId: "env_wsl", forkTurns: "none", requestedModelProfileRef: modelRef, requestedReasoningEffortProfileRef: effortRef, specialistNeeds: [{ operationalNeed: "browser_verification", environmentId: "env_windows", routeRowId: browserRoute.rowId, specialistContract: browserContract }] } });
validateProjectProfileResolution(wsl); validateProjectProfileResolutionTrace(wsl.trace); validateProjectExecutionProfileBinding(wsl.binding);
assert.equal(admitProjectProfileResolutionAgainstContext(wsl, { projectWorldState: projectWorld, projectManagerProfile: manager, controlProfileSnapshot: control, environmentTopology: topology, profileCatalog: catalog, environmentAwareToolCatalog: toolCatalog, specialistContracts: [browserContract] }), true);
assert.equal(wsl.status, "bound"); assert.equal(wsl.binding.homeEnvironmentRef.id, "env_wsl"); assert.equal(wsl.binding.projectManagerProfileRef.id, "pm_wsl"); assert.equal(wsl.binding.reasoningEffortProfileRef.id, "high"); assert.equal(wsl.binding.preferredSpecialistRoutes[0].environmentRef.id, "env_windows");
assert.equal(wsl.requestedTruth.modelProfileRef.id, wsl.configuredTruth.modelProfileRef.id, "requested/configured truth remains separately represented"); assert.equal(wsl.requestedTruth.forkTurns, "none"); assert.equal(wsl.effectiveTruth.modelProfileRef.id, "model");
assert.equal(wsl.effectiveTruth.runtimeEffectStatus, "not_yet_observed", "a fit binding is not an observed child runtime profile"); assert.deepEqual(wsl.effectiveTruth.runtimeEvidenceRefs, []);
for (const key of ["authorityGranted", "spawnAllowed", "toolUseAllowed", "workspaceMutationAllowed"]) assert.equal(wsl.binding[key], false, `${key} is never granted by profile fit`);
assert.equal(turn.residentEnvironmentId, "env_wsl", "a Windows specialist route does not move the resident project manager"); assert.equal(wsl.binding.preferredSpecialistRoutes[0].environmentRef.id, "env_windows");
throws(() => resolveProjectExecutionProfile({ projectWorldState: projectWorld, projectManagerProfile: manager, controlProfileSnapshot: control, environmentTopology: topology, profileCatalog: catalog, environmentAwareToolCatalog: toolCatalog, projectNeeds: { homeEnvironmentId: "env_wsl", forkTurns: "none", requestedModelProfileRef: modelRef, requestedReasoningEffortProfileRef: effortRef, specialistNeeds: [{ operationalNeed: "browser_verification", environmentId: "env_windows", routeRowId: browserRoute.rowId }] } }), "direct_project_profile_specialist_contract_required");
const wrongEnvironmentContract = buildPluginSpecialistWorkerContract({ contractId: "wrong_environment_contract", routeRow: browserRoute, targetEnvironmentId: "env_wsl" }, { now });
throws(() => resolveProjectExecutionProfile({ projectWorldState: projectWorld, projectManagerProfile: manager, controlProfileSnapshot: control, environmentTopology: topology, profileCatalog: catalog, environmentAwareToolCatalog: toolCatalog, projectNeeds: { homeEnvironmentId: "env_wsl", forkTurns: "none", requestedModelProfileRef: modelRef, requestedReasoningEffortProfileRef: effortRef, specialistNeeds: [{ operationalNeed: "browser_verification", environmentId: "env_wsl", routeRowId: browserRoute.rowId, specialistContract: wrongEnvironmentContract }] } }), "direct_project_profile_specialist_contract_mismatch");

const windows = resolveProjectExecutionProfile({ projectWorldState: projectWorld, projectManagerProfile: manager, controlProfileSnapshot: control, environmentTopology: topology, profileCatalog: catalog, environmentAwareToolCatalog: toolCatalog, projectNeeds: { homeEnvironmentId: "env_windows", forkTurns: "none", requestedModelProfileRef: modelRef, requestedReasoningEffortProfileRef: effortRef, specialistNeeds: [] } });
assert.equal(windows.status, "bound"); assert.equal(windows.binding.homeEnvironmentRef.id, "env_windows"); assert.equal(windows.binding.projectManagerProfileRef.id, "pm_windows"); assert.equal(windows.binding.preferredSpecialistRoutes.length, 0, "optional WSL specialist remains unselected without an evidenced need");

const remand = resolveProjectExecutionProfile({ projectWorldState: projectWorld, projectManagerProfile: manager, controlProfileSnapshot: control, environmentTopology: topology, profileCatalog: catalogFixture({ ambiguous: true }).catalog, environmentAwareToolCatalog: toolCatalog, projectNeeds: { homeEnvironmentId: "env_wsl", forkTurns: "all", requestedModelProfileRef: modelRef, requestedReasoningEffortProfileRef: effortRef, specialistNeeds: [] } });
assert.equal(remand.status, "remand"); assert(remand.unresolvedNeeds.includes("ambiguous_project_manager_profile"));
throws(() => buildProjectProfileResolution({ projectId: "project_b", projectRevision: 99, status: "remand", trace: remand.trace, requestedTruth: remand.requestedTruth, configuredTruth: remand.configuredTruth, effectiveTruth: null, unresolvedNeeds: remand.unresolvedNeeds, inputRefs: remand.inputRefs }), "direct_project_profile_resolution_trace_identity_mismatch");
const unavailable = resolveProjectExecutionProfile({ projectWorldState: projectWorld, projectManagerProfile: manager, controlProfileSnapshot: control, environmentTopology: topology, profileCatalog: catalogFixture({ unavailable: true }).catalog, environmentAwareToolCatalog: toolCatalog, projectNeeds: { homeEnvironmentId: "env_wsl", forkTurns: "none", requestedModelProfileRef: modelRef, requestedReasoningEffortProfileRef: effortRef, specialistNeeds: [] } });
assert.equal(unavailable.status, "remand"); assert(unavailable.unresolvedNeeds.includes("project_manager_profile_unavailable"));
throws(() => buildProjectProfileResolution({ projectId, projectRevision: 3, status: "bound", trace: unavailable.trace, binding: wsl.binding, requestedTruth: unavailable.requestedTruth, configuredTruth: unavailable.configuredTruth, effectiveTruth: wsl.effectiveTruth, unresolvedNeeds: [], inputRefs: unavailable.inputRefs }), "direct_project_profile_binding_truth_mismatch");
const overrideRemand = resolveProjectExecutionProfile({ projectWorldState: projectWorld, projectManagerProfile: manager, controlProfileSnapshot: control, environmentTopology: topology, profileCatalog: catalog, environmentAwareToolCatalog: toolCatalog, projectNeeds: { homeEnvironmentId: "env_wsl", forkTurns: "all", requestedModelProfileRef: ref("model_profile", "different"), requestedReasoningEffortProfileRef: effortRef, specialistNeeds: [] } });
assert.equal(overrideRemand.status, "remand"); assert(overrideRemand.unresolvedNeeds.includes("model_override_forbidden_full_history_fork")); assert.equal(overrideRemand.effectiveTruth, null);
const effortOverrideRemand = resolveProjectExecutionProfile({ projectWorldState: projectWorld, projectManagerProfile: manager, controlProfileSnapshot: control, environmentTopology: topology, profileCatalog: catalog, environmentAwareToolCatalog: toolCatalog, projectNeeds: { homeEnvironmentId: "env_wsl", forkTurns: "all", requestedModelProfileRef: modelRef, requestedReasoningEffortProfileRef: ref("reasoning_effort_profile", "wrong_effort"), specialistNeeds: [] } });
assert(effortOverrideRemand.unresolvedNeeds.includes("reasoning_effort_override_forbidden_full_history_fork"));
throws(() => resolveProjectExecutionProfile({ projectWorldState: projectWorld, projectManagerProfile: manager, controlProfileSnapshot: control, environmentTopology: topology, profileCatalog: catalog, environmentAwareToolCatalog: toolCatalog, projectNeeds: { homeEnvironmentId: "env_wsl", forkTurns: "bogus", requestedModelProfileRef: modelRef, requestedReasoningEffortProfileRef: effortRef, specialistNeeds: [] } }), "direct_project_profile_invalid_fork_mode");
const staleTopologyControl = buildProjectControlProfileSnapshot({ projectId, projectRevision: 3, userControlProfileRefs: [ref("user_control_profile", "control")], environmentTopologyRef: ref("direct_environment_topology", "old_topology"), authorizationBoundaryRef: ref("authorization_boundary", "control"), configuredModelProfileRef: modelRef, configuredReasoningEffortProfileRef: effortRef, concurrencyLimit: 3, delegationDepthLimit: 2, sourceRefs: [source("control")] }, { now });
const staleTopologyRemand = resolveProjectExecutionProfile({ projectWorldState: projectWorld, projectManagerProfile: manager, controlProfileSnapshot: staleTopologyControl, environmentTopology: topology, profileCatalog: catalog, environmentAwareToolCatalog: toolCatalog, projectNeeds: { homeEnvironmentId: "env_wsl", forkTurns: "none" } });
assert.equal(staleTopologyRemand.status, "remand"); assert(staleTopologyRemand.unresolvedNeeds.includes("environment_topology_stale_or_mismatched"));
throws(() => validateProjectExecutionProfileBinding({ ...wsl.binding, workspaceMutationAllowed: true }), "direct_project_profile_authority_leak");
throws(() => validateProjectProfileResolution({ ...wsl, effectiveTruth: { ...wsl.effectiveTruth, runtimeEffectStatus: "runtime_verified" } }), "direct_project_profile_runtime_evidence_required");
throws(() => validateProjectProfileResolutionTrace({ ...wsl.trace, projectGoalRefs: [{ ...wsl.trace.projectGoalRefs[0], digest: digest("tampered") }] }), "direct_project_profile_digest_mismatch");
throws(() => resolveProjectExecutionProfile({ projectWorldState: projectWorld, projectManagerProfile: manager, controlProfileSnapshot: buildProjectControlProfileSnapshot({ ...control, projectId: "other" }), environmentTopology: topology, profileCatalog: catalog, environmentAwareToolCatalog: toolCatalog, projectNeeds: { homeEnvironmentId: "env_wsl", forkTurns: "none" } }), "direct_project_profile_cross_project_or_revision_mismatch");
const swappedManager = buildProjectManagerProfile({ projectManagerProfileId: "swapped_pm", projectManagerAgentId: "swapped_agent", worldManagerAgentId: "wm", projectId, projectRootNodeId: "root", authorityBoundaryRef: ref("authority_boundary", "pm"), graphProjectionPolicyRef: ref("graph_projection_policy", "policy"), sourceRefs: [] }, { now });
const swappedControl = buildProjectControlProfileSnapshot({ projectId, projectRevision: 3, snapshotId: "swapped_control", userControlProfileRefs: control.userControlProfileRefs, environmentTopologyRef: topologyRef, authorizationBoundaryRef: control.authorizationBoundaryRef, configuredModelProfileRef: modelRef, configuredReasoningEffortProfileRef: effortRef, concurrencyLimit: 3, delegationDepthLimit: 2, sourceRefs: [source("swapped_control")] }, { now });
const swappedCatalog = buildProjectExecutionProfileCatalog({ catalogId: "swapped_catalog", profiles: catalog.profiles, sourceRefs: [source("swapped_catalog")] }, { now });
const swappedTopology = buildDirectEnvironmentTopology({ ...topology, topologyId: "swapped_topology" }, { now });
const swappedToolCatalog = buildEnvironmentAwareToolCatalog({ catalogId: "swapped_tool_catalog", projectId, capabilityRegistry: toolRegistry, topology, turnEnvironment: turn, rows: [{ toolId: "browser.verify", ownerEnvironmentId: "env_windows", environmentRouteClass: "specialist_worker_required", environmentActionClass: "windows_browser_action" }] }, { now });
const admittedContext = { projectWorldState: projectWorld, projectManagerProfile: manager, controlProfileSnapshot: control, environmentTopology: topology, profileCatalog: catalog, environmentAwareToolCatalog: toolCatalog, specialistContracts: [browserContract] };
const managedDescriptor = buildDescriptor({ id: projectId, workspace: { kind: "local", localPath: "/tmp/project-profile-launch" } }, { runtime: "host", binaryPath: "codex", spawnAgentModelOverrides: true }, 47892, { codexHome: "/tmp/project-profile-codex-home", projectProfileLaunchInput: { resolution: wsl, context: admittedContext }, now });
const launchConfiguration = managedDescriptor.projectProfileConfiguration;
assert.equal(launchConfiguration.resolutionRef.digest, wsl.resolutionDigest, "managed launch stores the exact admitted resolution digest");
assert.equal(launchConfiguration.selectionTraceRef.digest, wsl.trace.digest, "managed launch stores the exact admitted trace digest");
assert.equal(launchConfiguration.requestedProfile.modelProfileRef.id, wsl.requestedTruth.modelProfileRef.id);
assert.equal(launchConfiguration.configuredProfile.modelProfileRef.id, wsl.binding.defaultModelProfileRef.id);
assert.equal(launchConfiguration.configuredProfile.reasoningEffortProfileRef.id, wsl.binding.reasoningEffortProfileRef.id);
assert.equal(launchConfiguration.configuredProfile.homeEnvironmentRef.id, "env_wsl");
assert.equal(launchConfiguration.configuredProfile.preferredSpecialistRoutes[0].environmentRef.id, "env_windows");
assert.equal(launchConfiguration.requestedStatus, "admitted");
assert.equal(launchConfiguration.configuredStatus, "managed_launch_descriptor_configured");
assert.equal(launchConfiguration.providerAcceptedStatus, "not_yet_observed");
assert.equal(launchConfiguration.runtimeVerifiedStatus, "not_yet_observed");
for (const key of ["authorityGranted", "spawnAllowed", "toolUseAllowed", "workspaceMutationAllowed"]) assert.equal(launchConfiguration[key], false, `managed profile configuration keeps ${key} false`);
assert(managedDescriptor.key.endsWith(launchConfiguration.configurationDigest), "the managed runtime key is bound to the admitted profile configuration");
const managedCapabilities = buildRuntimeCapabilityProfile({ status: "ready", orchestrationProfile: managedDescriptor.orchestrationProfile, projectProfileConfiguration: launchConfiguration });
assert.equal(managedCapabilities.agents.projectProfileRequestedStatus, "admitted");
assert.equal(managedCapabilities.agents.projectProfileConfiguredStatus, "managed_launch_descriptor_configured");
assert.equal(managedCapabilities.agents.projectProfileProviderAcceptedStatus, "not_yet_observed");
assert.equal(managedCapabilities.agents.projectProfileRuntimeVerifiedStatus, "not_yet_observed");
assert.equal(managedCapabilities.agents.projectProfileAuthorityGranted, false);
throws(() => buildDescriptor({ id: projectId, workspace: { kind: "local", localPath: "/tmp/project-profile-launch" } }, { runtime: "host", binaryPath: "codex" }, 47893, { projectProfileLaunchInput: { resolution: wsl, context: { ...admittedContext, projectManagerProfile: swappedManager } }, now }), "direct_project_profile_context_project_manager_mismatch");
const incompleteRuntimeObservation = buildProjectProfileRuntimeLaunchObservation(launchConfiguration, { method: "item/completed", params: { item: { type: "childActivity", taskName: "profile_task" } } }, { now });
assert.equal(incompleteRuntimeObservation.runtimeVerifiedStatus, "not_yet_observed");
assert.equal(incompleteRuntimeObservation.readback, null, "child activity without actual runtime profile must not mint a readback");
throws(() => admitProjectProfileResolutionAgainstContext(wsl, { ...admittedContext, projectManagerProfile: swappedManager }), "direct_project_profile_context_project_manager_mismatch");
throws(() => admitProjectProfileResolutionAgainstContext(wsl, { ...admittedContext, controlProfileSnapshot: swappedControl }), "direct_project_profile_context_input_ref_mismatch");
throws(() => admitProjectProfileResolutionAgainstContext(wsl, { ...admittedContext, profileCatalog: swappedCatalog }), "direct_project_profile_context_input_ref_mismatch");
throws(() => admitProjectProfileResolutionAgainstContext(wsl, { ...admittedContext, environmentTopology: swappedTopology }), "direct_project_profile_context_input_ref_mismatch");
throws(() => admitProjectProfileResolutionAgainstContext(wsl, { ...admittedContext, environmentAwareToolCatalog: swappedToolCatalog }), "direct_project_profile_context_input_ref_mismatch");
throws(() => admitProjectProfileResolutionAgainstContext(wsl, { ...admittedContext, specialistContracts: [] }), "direct_project_profile_context_input_ref_mismatch");

const fakeRuntimeRef = ref("direct_project_profile_runtime_launch_readback", "fake_runtime");
const fakeRuntimeResolution = buildProjectProfileResolution({ projectId, projectRevision: 3, status: "bound", trace: wsl.trace, binding: wsl.binding, requestedTruth: wsl.requestedTruth, configuredTruth: wsl.configuredTruth, effectiveTruth: { ...wsl.effectiveTruth, runtimeEffectStatus: "runtime_verified", runtimeEvidenceRefs: [fakeRuntimeRef] }, unresolvedNeeds: [], inputRefs: wsl.inputRefs });
throws(() => admitProjectProfileResolutionAgainstContext(fakeRuntimeResolution, admittedContext), "direct_project_profile_context_runtime_evidence_mismatch");
const preparedLaunch = prepareProjectProfileLaunchRequest(launchConfiguration, {
  connectionId: "profile_connection",
  requestId: "42",
  method: "turn/start",
  params: { threadId: "profile_child_thread", model: "model", effort: "high" },
});
assert.equal(preparedLaunch.params.model, "model");
assert.equal(preparedLaunch.params.effort, "high");
throws(() => prepareProjectProfileLaunchRequest(launchConfiguration, { connectionId: "profile_connection", requestId: "43", method: "turn/start", params: { model: "relabelled" } }), "direct_project_profile_launch_request_relabelled");
const launchReceipt = registerProjectProfileLaunchResponse(preparedLaunch.launchDecision, {
  taskName: "profile_task",
  thread: { id: "profile_child_thread" },
  turn: { id: "profile_child_turn", runId: "profile_child_run" },
  launchId: "child_launch",
});
const runtimeItemFor = (receipt) => ({
  type: "childRuntimeProfile", observed: true, source: "managed_app_server_child_runtime_item",
  requestId: receipt.requestId, projectId, projectRevision: "3", readbackId: `runtime_${receipt.requestId}`, launchId: receipt.launchId, taskName: receipt.taskName,
  threadId: receipt.threadId, turnId: receipt.turnId, runId: receipt.runId, configurationDigest: receipt.configurationDigest,
  model: "model", reasoningEffort: "high", environmentId: "env_wsl", profileId: "pm_wsl", forkTurns: "none", observedAt: "2026-07-15T14:00:01.000Z",
});
for (const [index, field] of ["requestId", "projectId", "projectRevision", "taskName", "threadId", "turnId", "runId", "launchId", "configurationDigest"].entries()) {
  const prepared = prepareProjectProfileLaunchRequest(launchConfiguration, { connectionId: "profile_connection", requestId: String(50 + index), method: "turn/start", params: { threadId: "profile_child_thread" } });
  const receipt = registerProjectProfileLaunchResponse(prepared.launchDecision, { taskName: "profile_task", thread: { id: "profile_child_thread" }, turn: { id: "profile_child_turn", runId: "profile_child_run" }, launchId: "child_launch" });
  const mismatched = runtimeItemFor(receipt);
  mismatched[field] = "wrong_value";
  const observation = buildProjectProfileRuntimeLaunchObservation(launchConfiguration, { method: "item/completed", params: { item: mismatched } }, { now, connectionId: "profile_connection", launchReceipts: [receipt] });
  assert.equal(observation.runtimeVerifiedStatus, "not_yet_observed", `wrong ${field} cannot verify a launch`);
}
const otherConnectionObservation = buildProjectProfileRuntimeLaunchObservation(launchConfiguration, { method: "item/completed", params: { item: runtimeItemFor(launchReceipt) } }, { now, connectionId: "another_connection", launchReceipts: [launchReceipt] });
assert.equal(otherConnectionObservation.runtimeVerifiedStatus, "not_yet_observed", "a receipt owned by another connection cannot verify a launch");
const freeFloatingObservation = buildProjectProfileRuntimeLaunchObservation(launchConfiguration, { method: "item/completed", params: { item: { type: "childRuntimeProfile", observed: true, source: "managed_app_server_child_runtime_item", requestId: "wrong_request", projectId, projectRevision: "3", readbackId: "runtime_readback", launchId: "child_launch", taskName: "profile_task", threadId: "profile_child_thread", turnId: "profile_child_turn", runId: "profile_child_run", configurationDigest: launchConfiguration.configurationDigest, model: "model", reasoningEffort: "high", environmentId: "env_wsl", profileId: "pm_wsl", forkTurns: "none", observedAt: "2026-07-15T14:00:01.000Z" } } }, { now, connectionId: "profile_connection", launchReceipts: [launchReceipt] });
assert.equal(freeFloatingObservation.runtimeVerifiedStatus, "not_yet_observed", "a free-floating matching runtime item cannot be attributed to a launch");
const verifiedRuntimeObservation = buildProjectProfileRuntimeLaunchObservation(launchConfiguration, { method: "item/completed", params: { item: { type: "childRuntimeProfile", observed: true, source: "managed_app_server_child_runtime_item", requestId: "42", projectId, projectRevision: "3", readbackId: "runtime_readback", launchId: "child_launch", taskName: "profile_task", threadId: "profile_child_thread", turnId: "profile_child_turn", runId: "profile_child_run", configurationDigest: launchConfiguration.configurationDigest, model: "model", reasoningEffort: "high", environmentId: "env_wsl", profileId: "pm_wsl", forkTurns: "none", observedAt: "2026-07-15T14:00:01.000Z" } } }, { now, connectionId: "profile_connection", launchReceipts: [launchReceipt] });
assert.equal(verifiedRuntimeObservation.runtimeVerifiedStatus, "runtime_verified");
assert.equal(verifiedRuntimeObservation.providerAcceptedStatus, "canonical_launch_response_observed");
const replayObservation = buildProjectProfileRuntimeLaunchObservation(launchConfiguration, { method: "item/completed", params: { item: runtimeItemFor(launchReceipt) } }, { now, connectionId: "profile_connection", launchReceipts: [launchReceipt] });
assert.equal(replayObservation.runtimeVerifiedStatus, "not_yet_observed", "a consumed runtime receipt cannot be replayed");
assert.equal(verifiedRuntimeObservation.authorityGranted, false);
const runtimeReadback = verifiedRuntimeObservation.readback;
assert.equal(runtimeReadback.taskName, "profile_task");
assert.equal(runtimeReadback.threadId, "profile_child_thread");
assert.equal(runtimeReadback.turnId, "profile_child_turn");
assert.equal(runtimeReadback.runId, "profile_child_run");
assert.equal(runtimeReadback.requestId, "42");
assert.equal(runtimeReadback.resolutionRef.digest, wsl.resolutionDigest);
assert.equal(runtimeReadback.observedEnvironmentId, "env_wsl");
for (const key of ["authorityGranted", "spawnAllowed", "toolUseAllowed", "workspaceMutationAllowed"]) assert.equal(runtimeReadback[key], false, `runtime readback keeps ${key} false`);
const runtimeEvidenceRef = ref("direct_project_profile_runtime_launch_readback", runtimeReadback.readbackId); runtimeEvidenceRef.digest = runtimeReadback.readbackDigest;
const runtimeVerifiedResolution = buildProjectProfileResolution({ projectId, projectRevision: 3, status: "bound", trace: wsl.trace, binding: wsl.binding, requestedTruth: wsl.requestedTruth, configuredTruth: wsl.configuredTruth, effectiveTruth: { ...wsl.effectiveTruth, runtimeEffectStatus: "runtime_verified", runtimeEvidenceRefs: [runtimeEvidenceRef] }, unresolvedNeeds: [], inputRefs: wsl.inputRefs });
assert.equal(admitProjectProfileResolutionAgainstContext(runtimeVerifiedResolution, { ...admittedContext, launchProjectProfileResolution: wsl, runtimeLaunchReadbacks: [runtimeReadback] }), true, "runtime_verified requires exact launch/readback evidence bound to this resolution");
const expiredTopology = buildDirectEnvironmentTopology({ ...topology, expiresAt: "2026-07-15T13:59:59.000Z" }, { now });
const expiredTopologyRef = ref("direct_environment_topology", expiredTopology.topologyId, "Expired topology"); expiredTopologyRef.digest = expiredTopology.topologyDigest;
const expiredControl = buildProjectControlProfileSnapshot({ projectId, projectRevision: 3, userControlProfileRefs: [ref("user_control_profile", "control")], environmentTopologyRef: expiredTopologyRef, authorizationBoundaryRef: ref("authorization_boundary", "control"), configuredModelProfileRef: modelRef, configuredReasoningEffortProfileRef: effortRef, concurrencyLimit: 3, delegationDepthLimit: 2, sourceRefs: [source("expired_control")] }, { now });
const expiredTopologyRemand = resolveProjectExecutionProfile({ projectWorldState: projectWorld, projectManagerProfile: manager, controlProfileSnapshot: expiredControl, environmentTopology: expiredTopology, profileCatalog: catalog, environmentAwareToolCatalog: toolCatalog, projectNeeds: { homeEnvironmentId: "env_wsl", forkTurns: "none", requestedModelProfileRef: modelRef, requestedReasoningEffortProfileRef: effortRef, specialistNeeds: [] } }, { now });
assert.equal(expiredTopologyRemand.status, "remand"); assert(expiredTopologyRemand.unresolvedNeeds.includes("environment_topology_expired"));
const notice = buildProjectProfileChangeNotification({ projectId, projectRevision: 3, binding: wsl.binding, selectionTraceRef: wsl.binding.selectionTraceRef, invalidatesPriorBinding: true, sourceRefs: [source("notification")] }, { now }); validateProjectProfileChangeNotification(notice); assert.equal(notice.globalControlStateChanged, false);
console.log("direct-project-profile-resolution-regression: ok");
