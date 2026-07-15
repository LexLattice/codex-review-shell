#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

const {
  MANAGED_APP_SERVER_CONFIG_OVERRIDES,
  MANAGED_APP_SERVER_MODEL_OVERRIDE_CONFIG,
  MANAGED_APP_SERVER_MODEL_OVERRIDE_DISABLED_CONFIG,
  buildDescriptor,
  buildManagedAppServerArgs,
  buildManagedAppServerOrchestrationProfile,
  buildManagedAppServerShellInvocation,
  buildRuntimeCapabilityProfile,
  managedAppServerConfigOverrides,
  resolveManagedAppServerBinaryPath,
} = require("../src/main/codex-app-server.js");

const reservedSchemaOverride = "features.multi_agent_v2.hide_spawn_agent_metadata=true";
const splitModelOverride = "features.multi_agent_v2.expose_spawn_agent_model_overrides=true";
const disabledSplitModelOverride = "features.multi_agent_v2.expose_spawn_agent_model_overrides=false";
const managedOverrides = [reservedSchemaOverride, disabledSplitModelOverride];
const splitOverrides = [reservedSchemaOverride, splitModelOverride];
const splitCodex = {
  runtime: "host",
  binaryPath: "codex",
  spawnAgentModelOverrides: true,
};
const wsUrl = "ws://127.0.0.1:47891";

assert.equal(MANAGED_APP_SERVER_MODEL_OVERRIDE_CONFIG, splitModelOverride);
assert.equal(MANAGED_APP_SERVER_MODEL_OVERRIDE_DISABLED_CONFIG, disabledSplitModelOverride);

assert.deepEqual(
  MANAGED_APP_SERVER_CONFIG_OVERRIDES,
  managedOverrides,
  "managed app-server must preserve the provider-reserved V2 spawn schema",
);
assert.equal(
  MANAGED_APP_SERVER_CONFIG_OVERRIDES.filter((value) => value === reservedSchemaOverride).length,
  1,
  "the reserved-schema guard must occur exactly once",
);
assert.equal(
  MANAGED_APP_SERVER_CONFIG_OVERRIDES.some((value) => /hide_spawn_agent_metadata=false/.test(value)),
  false,
  "managed launch must never re-expose the release-144 reserved metadata fields",
);
assert.equal(
  MANAGED_APP_SERVER_CONFIG_OVERRIDES.includes(disabledSplitModelOverride),
  true,
  "the unchecked project posture must explicitly disable alpha's default-on narrow exposure",
);
assert.deepEqual(managedAppServerConfigOverrides(splitCodex), splitOverrides);

assert.equal(
  resolveManagedAppServerBinaryPath("wsl", "codex", "/mnt/c/Users/Rose/.codex", {
    spawnAgentModelOverrides: false,
  }, {
    resolveBundled: () => "/mnt/c/Users/Rose/.codex/bin/wsl/bundled/codex",
  }),
  "/mnt/c/Users/Rose/.codex/bin/wsl/bundled/codex",
  "the fallback profile may retain the desktop-home bundled WSL binary",
);
let splitBundledLookupCalled = false;
assert.equal(
  resolveManagedAppServerBinaryPath("wsl", "codex", "/mnt/c/Users/Rose/.codex", {
    spawnAgentModelOverrides: true,
  }, {
    resolveBundled: () => {
      splitBundledLookupCalled = true;
      return "/mnt/c/Users/Rose/.codex/bin/wsl/bundled/codex";
    },
  }),
  "codex",
  "the alpha split profile must preserve the configured WSL CLI even for desktop-home tasks",
);
assert.equal(splitBundledLookupCalled, false, "the split profile must not probe or substitute the desktop bundle");

assert.deepEqual(
  buildManagedAppServerArgs(wsUrl),
  ["app-server", "-c", reservedSchemaOverride, "-c", disabledSplitModelOverride, "--listen", wsUrl],
  "native app-server arguments must carry the reserved-schema override",
);

assert.equal(
  buildManagedAppServerShellInvocation("/opt/OpenAI Codex/codex", wsUrl),
  `exec '/opt/OpenAI Codex/codex' app-server -c ${reservedSchemaOverride} -c ${disabledSplitModelOverride} --listen ${wsUrl}`,
  "shell-hosted app-server invocation must preserve the same reserved-schema override",
);

assert.deepEqual(
  buildManagedAppServerArgs(wsUrl, splitCodex),
  ["app-server", "-c", reservedSchemaOverride, "-c", splitModelOverride, "--listen", wsUrl],
  "alpha app-server arguments must request only the provider-compatible split override",
);
assert.equal(
  buildManagedAppServerShellInvocation("/opt/OpenAI Codex/codex", wsUrl, splitCodex),
  `exec '/opt/OpenAI Codex/codex' app-server -c ${reservedSchemaOverride} -c ${splitModelOverride} --listen ${wsUrl}`,
  "shell-hosted alpha invocation must preserve both schema constraints",
);

const orchestrationProfile = buildManagedAppServerOrchestrationProfile();
assert.equal(orchestrationProfile.schema, "codex_app_server_orchestration_profile@1");
assert.equal(orchestrationProfile.runtimeSurface, "managed_app_server");
assert.equal(orchestrationProfile.binarySelection, "default_or_home_bundled");
assert.equal(orchestrationProfile.multiAgentVersionSelection, "model_selected_at_turn");
assert.deepEqual(orchestrationProfile.configOverrides, managedOverrides);
assert.equal(orchestrationProfile.spawnAgentControls.reservedProviderSchema, true);
assert.equal(orchestrationProfile.spawnAgentControls.effectiveStatus, "disabled");
assert.equal(orchestrationProfile.spawnAgentControls.providerAcceptanceStatus, "not_requested");
assert.deepEqual(
  orchestrationProfile.spawnAgentControls.visibleInputFields,
  ["task_name", "message", "fork_turns"],
);
assert.deepEqual(
  orchestrationProfile.spawnAgentControls.hiddenInputFields,
  ["agent_type", "model", "reasoning_effort", "service_tier"],
);
assert.deepEqual(orchestrationProfile.spawnAgentControls.visibleResultFields, ["task_name"]);
assert.deepEqual(orchestrationProfile.spawnAgentControls.hiddenResultFields, ["nickname"]);
assert.equal(orchestrationProfile.spawnAgentControls.modelOverrideConfigured, false);
assert.equal(orchestrationProfile.spawnAgentControls.reasoningEffortOverrideConfigured, false);
assert.equal(orchestrationProfile.spawnAgentControls.agentTypeOverrideConfigured, false);
assert.equal(orchestrationProfile.spawnAgentControls.serviceTierOverrideConfigured, false);
assert.equal(orchestrationProfile.spawnAgentControls.runtimeSelection, "provider_managed");
assert.equal(orchestrationProfile.spawnAgentControls.clientSchemaExtensionAllowed, false);
assert.equal(orchestrationProfile.spawnAgentControls.runtimeEvidenceRequired, false);
assert.equal(orchestrationProfile.spawnAgentControls.fullHistoryForkInheritsParentProfile, true);
assert.equal(orchestrationProfile.rootOrchestration.activationControl, "reasoning_effort");
assert.equal(orchestrationProfile.rootOrchestration.proactiveValue, "ultra");
assert.equal(orchestrationProfile.rootOrchestration.explicitDelegationBelowUltra, true);
assert.equal(orchestrationProfile.workerInteraction.operatorCanObserve, true);
assert.equal(orchestrationProfile.workerInteraction.operatorCanChatDirectly, false);
assert.equal(orchestrationProfile.workerInteraction.parentAgentMediated, true);

const splitOrchestrationProfile = buildManagedAppServerOrchestrationProfile(splitCodex);
assert.equal(splitOrchestrationProfile.profileVersion, "reserved-v2-model-overrides@2");
assert.equal(splitOrchestrationProfile.binarySelection, "configured_binary_required");
assert.deepEqual(splitOrchestrationProfile.configOverrides, splitOverrides);
assert.equal(splitOrchestrationProfile.spawnAgentControls.providerContract, "v2_split_model_overrides");
assert.equal(splitOrchestrationProfile.spawnAgentControls.requestedByProject, true);
assert.equal(splitOrchestrationProfile.spawnAgentControls.effectiveStatus, "configured_unverified");
assert.equal(splitOrchestrationProfile.spawnAgentControls.providerAcceptanceStatus, "unverified");
assert.equal(splitOrchestrationProfile.spawnAgentControls.minimumCodexVersion, "0.145.0-alpha.7");
assert.deepEqual(
  splitOrchestrationProfile.spawnAgentControls.visibleInputFields,
  ["task_name", "message", "fork_turns", "model", "reasoning_effort"],
);
assert.deepEqual(splitOrchestrationProfile.spawnAgentControls.hiddenInputFields, ["agent_type", "service_tier"]);
assert.deepEqual(splitOrchestrationProfile.spawnAgentControls.visibleResultFields, ["task_name"]);
assert.deepEqual(splitOrchestrationProfile.spawnAgentControls.hiddenResultFields, ["nickname"]);
assert.equal(splitOrchestrationProfile.spawnAgentControls.modelOverrideConfigured, true);
assert.equal(splitOrchestrationProfile.spawnAgentControls.reasoningEffortOverrideConfigured, true);
assert.equal(splitOrchestrationProfile.spawnAgentControls.agentTypeOverrideConfigured, false);
assert.equal(splitOrchestrationProfile.spawnAgentControls.serviceTierOverrideConfigured, false);
assert.equal(splitOrchestrationProfile.spawnAgentControls.fullHistoryForkInheritsParentProfile, true);
assert.equal(splitOrchestrationProfile.spawnAgentControls.fullHistoryOverrideAllowed, false);
assert.deepEqual(splitOrchestrationProfile.spawnAgentControls.overrideForkTurns, ["none", "positive_integer"]);
assert.equal(splitOrchestrationProfile.spawnAgentControls.compatibleModelSet, "active_multi_agent_backend");
assert.equal(splitOrchestrationProfile.spawnAgentControls.runtimeSelection, "root_selectable_within_active_backend");
assert.equal(splitOrchestrationProfile.spawnAgentControls.clientSchemaExtensionAllowed, false);
assert.equal(splitOrchestrationProfile.spawnAgentControls.runtimeEvidenceRequired, true);

const readyCapabilities = buildRuntimeCapabilityProfile({
  status: "ready",
  runtime: "host",
  orchestrationProfile,
});
assert.equal(readyCapabilities.agents.runtimeAvailability, "model_selected_at_turn");
assert.equal(readyCapabilities.agents.binarySelection, "default_or_home_bundled");
assert.equal(readyCapabilities.agents.reservedProviderToolSchema, true);
assert.equal(readyCapabilities.agents.spawnContractStatus, "disabled");
assert.equal(readyCapabilities.agents.spawnProviderAcceptanceStatus, "not_requested");
assert.deepEqual(readyCapabilities.agents.spawnVisibleInputFields, ["task_name", "message", "fork_turns"]);
assert.deepEqual(
  readyCapabilities.agents.spawnHiddenInputFields,
  ["agent_type", "model", "reasoning_effort", "service_tier"],
);
assert.equal(readyCapabilities.agents.modelVisibleSpawnControlsConfigured, false);
assert.equal(readyCapabilities.agents.spawnModelOverrideConfigured, false);
assert.equal(readyCapabilities.agents.spawnReasoningEffortOverrideConfigured, false);
assert.equal(readyCapabilities.agents.activeToolSchemaWitnessRequired, true);
assert.equal(readyCapabilities.agents.effectiveModelVisibleSpawnControls, "unknown");
assert.equal(readyCapabilities.agents.perSpawnRuntimeSelection, "provider_managed");
assert.equal(readyCapabilities.agents.clientSchemaExtensionAllowed, false);
assert.equal(readyCapabilities.agents.configSource, "managed_app_server_launch_config");

const splitReadyCapabilities = buildRuntimeCapabilityProfile({
  status: "ready",
  runtime: "host",
  orchestrationProfile: splitOrchestrationProfile,
});
assert.equal(splitReadyCapabilities.agents.spawnProviderContract, "v2_split_model_overrides");
assert.equal(splitReadyCapabilities.agents.binarySelection, "configured_binary_required");
assert.equal(splitReadyCapabilities.agents.spawnContractStatus, "configured_unverified");
assert.equal(splitReadyCapabilities.agents.spawnProviderAcceptanceStatus, "unverified");
assert.equal(splitReadyCapabilities.agents.spawnModelOverrideMinimumCodexVersion, "0.145.0-alpha.7");
assert.deepEqual(
  splitReadyCapabilities.agents.spawnVisibleInputFields,
  ["task_name", "message", "fork_turns", "model", "reasoning_effort"],
);
assert.deepEqual(splitReadyCapabilities.agents.spawnHiddenInputFields, ["agent_type", "service_tier"]);
assert.equal(splitReadyCapabilities.agents.modelVisibleSpawnControlsConfigured, true);
assert.equal(splitReadyCapabilities.agents.spawnModelOverrideConfigured, true);
assert.equal(splitReadyCapabilities.agents.spawnReasoningEffortOverrideConfigured, true);
assert.equal(splitReadyCapabilities.agents.fullHistoryOverrideAllowed, false);
assert.deepEqual(splitReadyCapabilities.agents.perSpawnOverrideForkTurns, ["none", "positive_integer"]);
assert.equal(splitReadyCapabilities.agents.compatibleModelSet, "active_multi_agent_backend");
assert.equal(splitReadyCapabilities.agents.perSpawnRuntimeSelection, "root_selectable_within_active_backend");
assert.equal(splitReadyCapabilities.agents.clientSchemaExtensionAllowed, false);

const unavailableCapabilities = buildRuntimeCapabilityProfile({
  status: "starting",
  runtime: "host",
  orchestrationProfile,
});
assert.equal(unavailableCapabilities.agents.runtimeAvailability, "unavailable");
assert.equal(unavailableCapabilities.agents.spawnModelOverrideConfigured, false);
assert.equal(unavailableCapabilities.agents.spawnReasoningEffortOverrideConfigured, false);
assert.equal(unavailableCapabilities.agents.activeToolSchemaWitnessRequired, true);

const hostDescriptor = buildDescriptor({
  id: "project_orchestration_fixture",
  workspace: {
    kind: "local",
    localPath: "/tmp/codex-orchestration-fixture",
  },
}, {
  runtime: "host",
  binaryPath: "codex",
}, 47891, {
  codexHome: "/tmp/codex-orchestration-home",
});

assert.equal(hostDescriptor.runtime, "host");
assert.deepEqual(hostDescriptor.args, buildManagedAppServerArgs(wsUrl));
assert.deepEqual(hostDescriptor.orchestrationProfile, orchestrationProfile);
assert.match(hostDescriptor.key, /reserved-v2-schema@2$/);
assert.equal(hostDescriptor.workspaceRoot, "/tmp/codex-orchestration-fixture");

const nativeWslDescriptor = buildDescriptor({
  id: "project_orchestration_wsl_fixture",
  workspace: {
    kind: "wsl",
    linuxPath: "/home/rose/work/orchestration-fixture",
  },
}, {
  runtime: "wsl",
  binaryPath: "codex",
}, 47891, {
  codexHome: "/home/rose/.codex",
});
assert.equal(nativeWslDescriptor.runtime, "wsl");
assert.deepEqual(nativeWslDescriptor.args, buildManagedAppServerArgs(wsUrl));
assert.deepEqual(nativeWslDescriptor.orchestrationProfile, orchestrationProfile);
assert.equal(nativeWslDescriptor.workspaceRoot, "/home/rose/work/orchestration-fixture");

const alphaWslDescriptor = buildDescriptor({
  id: "project_orchestration_alpha_wsl_fixture",
  workspace: {
    kind: "wsl",
    linuxPath: "/home/rose/work/orchestration-alpha-fixture",
  },
}, {
  runtime: "wsl",
  binaryPath: "codex",
  spawnAgentModelOverrides: true,
}, 47891, {
  codexHome: "/home/rose/.codex",
});
assert.equal(alphaWslDescriptor.runtime, "wsl");
assert.deepEqual(alphaWslDescriptor.args, buildManagedAppServerArgs(wsUrl, splitCodex));
assert.deepEqual(alphaWslDescriptor.orchestrationProfile, splitOrchestrationProfile);
assert.match(alphaWslDescriptor.key, /reserved-v2-model-overrides@2$/);

const windowsToWslBaseDescriptor = buildDescriptor({
  id: "project_orchestration_windows_wsl_base_fixture",
  workspace: {
    kind: "wsl",
    distro: "Ubuntu",
    linuxPath: "/home/rose/work/windows-wsl-base-fixture",
  },
}, {
  runtime: "wsl",
  binaryPath: "codex",
  spawnAgentModelOverrides: false,
}, 47891, {
  codexHome: "/home/rose/work/windows-wsl-base-fixture/.codex-home",
  hostPlatform: "win32",
});
assert.equal(windowsToWslBaseDescriptor.command, "wsl.exe");
assert.match(windowsToWslBaseDescriptor.args.at(-1), /hide_spawn_agent_metadata=true/);
assert.match(windowsToWslBaseDescriptor.args.at(-1), /expose_spawn_agent_model_overrides=false/);
assert.doesNotMatch(windowsToWslBaseDescriptor.args.at(-1), /expose_spawn_agent_model_overrides=true/);

const windowsToWslSplitDescriptor = buildDescriptor({
  id: "project_orchestration_windows_wsl_split_fixture",
  workspace: {
    kind: "wsl",
    distro: "Ubuntu",
    linuxPath: "/home/rose/work/windows-wsl-split-fixture",
  },
}, {
  runtime: "wsl",
  binaryPath: "codex",
  spawnAgentModelOverrides: true,
}, 47891, {
  codexHome: "/home/rose/work/windows-wsl-split-fixture/.codex-home",
  hostPlatform: "win32",
});
assert.equal(windowsToWslSplitDescriptor.command, "wsl.exe");
assert.match(windowsToWslSplitDescriptor.args.at(-1), /hide_spawn_agent_metadata=true/);
assert.match(windowsToWslSplitDescriptor.args.at(-1), /expose_spawn_agent_model_overrides=true/);
assert.doesNotMatch(windowsToWslSplitDescriptor.args.at(-1), /expose_spawn_agent_model_overrides=false/);

const directUnavailableDescriptor = buildDescriptor({
  id: "project_direct_provider_fixture",
  workspace: { kind: "local", localPath: "/tmp/direct-provider-fixture" },
}, {
  provider: { kind: "direct_oai" },
}, 47891);
assert.equal(directUnavailableDescriptor.unavailable, true);
assert.equal(
  Object.hasOwn(directUnavailableDescriptor, "orchestrationProfile"),
  false,
  "managed app-server orchestration truth must not leak onto the Direct provider descriptor",
);

const rendererSource = fs.readFileSync(
  path.join(repoRoot, "src", "renderer", "codex-surface.js"),
  "utf8",
);
const defaultEffortsMatch = rendererSource.match(
  /const DEFAULT_REASONING_EFFORTS = (\[[^\n]+\]);/,
);
assert(defaultEffortsMatch, "renderer must declare DEFAULT_REASONING_EFFORTS");
const defaultEfforts = JSON.parse(defaultEffortsMatch[1]);
assert(defaultEfforts.includes("max"), "fallback reasoning controls must include max");
assert(defaultEfforts.includes("ultra"), "fallback reasoning controls must include ultra");
assert.match(
  rendererSource,
  /effort === "ultra" \? " · proactive orchestration"/,
  "the live Codex composer must identify Ultra as the proactive orchestration control",
);
for (const label of ["profile requested", "profile configured", "profile provider accepted", "profile runtime verified", "profile authority"]) {
  assert.match(
    rendererSource,
    new RegExp(`\\["${label}"`),
    `the capability renderer must keep ${label} visible as a distinct truth state`,
  );
}

const managedThreadStartSlice = rendererSource.slice(
  rendererSource.indexOf("  const cwd = workspaceRootText();", rendererSource.indexOf("async function startNewThread()")),
  rendererSource.indexOf("async function startCodexTurn("),
);
assert.match(
  managedThreadStartSlice,
  /params\.config = \{ model_reasoning_effort: reasoningEffort \}/,
  "managed thread/start must express sticky effort through the app-server config contract",
);
assert.match(
  managedThreadStartSlice,
  /projectSpawnAgentOrchestrationInstructions\(\)/,
  "managed thread/start must project the project-scoped worker intent",
);
assert.match(
  managedThreadStartSlice,
  /configuredDeveloperInstructionsForCwd\(cwd\)/,
  "managed thread/start must read the effective cwd-scoped developer instructions before adding orchestration intent",
);
assert.match(
  managedThreadStartSlice,
  /configuredInstructions !== null[\s\S]*mergeDeveloperInstructions\([\s\S]*configuredInstructions,[\s\S]*orchestrationInstructions/,
  "managed thread/start must preserve configured developer instructions and fail closed when they cannot be read",
);
assert.match(
  rendererSource,
  /rpc\("config\/read", \{[\s\S]*includeLayers: false,[\s\S]*cwd: cwd \|\| null,[\s\S]*response\?\.config\?\.developer_instructions/,
  "the additive developer-instruction projection must use the effective app-server config for the task cwd",
);
assert.match(
  rendererSource,
  /developerInstructions replaces the configured value[\s\S]*return null;/,
  "a failed effective-config read must preserve inherited developer instructions by omitting the override",
);
assert.match(
  rendererSource,
  /Prefer fork_turns=\\"none\\", reasoning_effort=\\"low\\", and omit model/,
  "the enabled project profile must make its bounded low-effort worker intent operational",
);
assert.match(
  rendererSource,
  /This orchestration profile does not broaden worker tool, filesystem, network, or authorization scope/,
  "worker-cost intent must not broaden authority",
);
assert.match(rendererSource, /drawerSection\("Orchestration"/);
assert.match(rendererSource, /\["provider acceptance", caps\.agents\?\.spawnProviderAcceptanceStatus \|\| "unknown"\]/);
assert.match(rendererSource, /\["effective model\/effort controls", caps\.agents\?\.effectiveModelVisibleSpawnControls \|\| "unknown"\]/);
assert.doesNotMatch(
  managedThreadStartSlice,
  /reasoningEffort:\s*requestedReasoningEffort/,
  "managed thread/start must not send the obsolete top-level reasoningEffort field",
);

const managedTurnStartSlice = rendererSource.slice(
  rendererSource.indexOf("async function startCodexTurn("),
  rendererSource.indexOf("async function", rendererSource.indexOf("async function startCodexTurn(") + 1),
);
assert.match(
  managedTurnStartSlice,
  /effort:\s*requestedReasoningEffort\(\)/,
  "turn/start must continue to send the selected effective reasoning effort",
);

const mainSource = fs.readFileSync(path.join(repoRoot, "src", "main.js"), "utf8");
const normalizedEffortsMatch = mainSource.match(
  /function normalizeReasoningEffort\(value\) \{[\s\S]*?return (\[[^\n]+\])\.includes\(candidate\)/,
);
assert(normalizedEffortsMatch, "main process must expose a bounded reasoning-effort normalizer");
const normalizedEfforts = JSON.parse(normalizedEffortsMatch[1]);
assert(normalizedEfforts.includes("max"), "main-process preference persistence must accept max");
assert(normalizedEfforts.includes("ultra"), "main-process preference persistence must accept ultra");

const rendererHtml = fs.readFileSync(
  path.join(repoRoot, "src", "renderer", "index.html"),
  "utf8",
);
assert.match(rendererHtml, /<option value="max">Max<\/option>/);
assert.match(
  rendererHtml,
  /<option value="ultra">Ultra \(proactive orchestration\)<\/option>/,
  "project settings must explain Ultra's orchestration posture",
);
assert.match(rendererHtml, /id="codexSpawnAgentModelOverridesInput"/);
assert.match(rendererHtml, /Codex 0\.145\.0-alpha\.7\+/);
assert.match(rendererHtml, /provider confirmation still required/);

const rendererAppSource = fs.readFileSync(
  path.join(repoRoot, "src", "renderer", "app.js"),
  "utf8",
);
assert.match(
  rendererAppSource,
  /codexSpawnAgentModelOverridesInput:\s*document\.getElementById\("codexSpawnAgentModelOverridesInput"\)/,
  "project settings must bind the split-schema control",
);
assert.match(
  rendererAppSource,
  /codexSpawnAgentModelOverridesInput\.checked\s*=\s*draft\.surfaceBinding\.codex\.spawnAgentModelOverrides === true/,
  "project settings must load the exact boolean intent",
);
assert.match(
  rendererAppSource,
  /spawnAgentModelOverrides:\s*els\.codexSpawnAgentModelOverridesInput\.checked/,
  "project settings must save the exact boolean intent",
);
assert.match(
  rendererAppSource,
  /function updateCodexSpawnAgentControlAvailability\(\)/,
  "project settings must model when the app-server-only control is dormant",
);
assert.match(
  rendererAppSource,
  /codexSpawnAgentModelOverridesInput\.disabled = !active/,
  "the split-schema control must be disabled outside the managed executable path",
);

const windowsLauncherSource = fs.readFileSync(
  path.join(repoRoot, "start-codex-review-shell.cmd"),
  "utf8",
);
const wslLauncherSource = fs.readFileSync(
  path.join(repoRoot, "start-codex-review-shell-wsl.ps1"),
  "utf8",
);
assert.match(
  windowsLauncherSource,
  /CODEX_REVIEW_SHELL_DEFAULT_WSL_CODEX_HOME=\/home\/rose\/\.codex/,
  "the Windows launcher must route managed WSL app-server auth/history through the logged-in WSL Codex home",
);
assert.match(
  wslLauncherSource,
  /CODEX_REVIEW_SHELL_DEFAULT_WSL_CODEX_HOME = "\/home\/rose\/\.codex"/,
  "the WSL launcher must use the same logged-in WSL Codex home",
);

console.log("codex app-server orchestration controls regression: ok");
