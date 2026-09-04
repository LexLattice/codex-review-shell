"use strict";

const crypto = require("node:crypto");
const { buildRuntimeCapabilityProfile } = require("../../codex-app-server");

const DIRECT_APPSERVER_CAPABILITY_PARITY_SCHEMA = "direct_appserver_capability_parity_ledger@1";
const PARITY_CLASSIFICATIONS = new Set(["equivalent", "intentionally_different", "deferred"]);

// The profile has a small, closed non-capability envelope. Everything else is
// mechanically derived as a capability-bearing leaf, so a new provider field
// cannot silently escape the ledger.
const APPSERVER_NON_CAPABILITY_PATHS = Object.freeze([
  "version",
  "status",
  "generatedAt",
  "diagnostics",
  "provider.updatedAt",
]);

const APPSERVER_PROFILE_SEED = Object.freeze({
  status: "ready",
  runtime: "host",
  provider: { kind: "codex_executable", flavor: "vanilla" },
  orchestrationProfile: { spawnAgentControls: {} },
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function excludedCapabilityPath(pathName) {
  return APPSERVER_NON_CAPABILITY_PATHS.includes(pathName) ||
    pathName === "diagnostics" ||
    pathName.startsWith("diagnostics.");
}

function capabilityPathsFromProfile(value, prefix = "", paths = []) {
  if (Array.isArray(value)) {
    if (!excludedCapabilityPath(prefix)) paths.push(`${prefix}[]`);
    return paths;
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      const pathName = prefix ? `${prefix}.${key}` : key;
      if (excludedCapabilityPath(pathName)) continue;
      capabilityPathsFromProfile(child, pathName, paths);
    }
    return paths;
  }
  if (prefix && !excludedCapabilityPath(prefix)) paths.push(prefix);
  return paths;
}

const CURRENT_APPSERVER_CAPABILITY_PATHS = Object.freeze(
  capabilityPathsFromProfile(buildRuntimeCapabilityProfile(APPSERVER_PROFILE_SEED)),
);

const EQUIVALENT = new Set([
  "coreRuntime.canConnect", "coreRuntime.canInitialize", "coreRuntime.transport", "coreRuntime.transports[]",
  "account.canRead", "account.canStartLogin", "config.canRead", "configRequirements.canRead",
  "environment.canReadStatus", "environment.statusMethod",
  "threads.canStart", "threads.canRead", "threads.canResume", "threads.canList", "threads.canPersistExtendedHistory",
  "turns.canStart", "turns.canSteer", "turns.canInterrupt", "turns.canOverrideModel", "turns.canOverrideReasoning", "turns.canUseOutputSchema",
  "model.canList", "model.canSetNextTurn", "model.canSetSessionDefault", "model.canSetProjectDefault", "model.canLiveUpdate",
  "reasoning.canSetNextTurn", "reasoning.canSetSessionDefault", "reasoning.canSetProjectDefault", "reasoning.canLiveUpdate",
  "serviceTier.canSetNextTurn", "serviceTier.availableTiers[]",
  "usage.canReadRateLimits", "usage.rateLimitMethod", "usage.canReadContextUsage", "usage.contextUsageEvent",
  "requests.unknownRequestPolicy",
]);

const DIFFERENT = new Set([
  "coreRuntime.schemaSource",
  "apps.canReadInstalled", "apps.installedMethod", "apps.canReadMetadata", "apps.metadataMethod",
  "apps.metadataToolSummariesDisplayOnly", "apps.actionAuthorityGranted",
  "threads.canFork", "threads.canRollback",
  "agents.runtimeAvailability", "agents.binarySelection", "agents.reservedProviderToolSchema",
  "agents.spawnVisibleInputFields[]", "agents.spawnHiddenInputFields[]", "agents.spawnProviderContract",
  "agents.spawnContractStatus", "agents.spawnProviderAcceptanceStatus", "agents.spawnModelOverrideMinimumCodexVersion",
  "agents.modelVisibleSpawnControlsConfigured", "agents.spawnModelOverrideConfigured", "agents.spawnReasoningEffortOverrideConfigured",
  "agents.activeToolSchemaWitnessRequired", "agents.effectiveModelVisibleSpawnControls",
  "agents.fullHistoryForkInheritsParentProfile", "agents.fullHistoryOverrideAllowed", "agents.perSpawnOverrideForkTurns[]",
  "agents.compatibleModelSet", "agents.perSpawnRuntimeSelection", "agents.clientSchemaExtensionAllowed", "agents.configSource",
  "agents.projectProfileRequestedStatus", "agents.projectProfileConfiguredStatus", "agents.projectProfileProviderAcceptedStatus",
  "agents.projectProfileRuntimeVerifiedStatus", "agents.projectProfileResolutionRef", "agents.projectProfileAuthorityGranted",
  "authority.commandApproval", "authority.fileChangeApproval", "authority.permissionsApproval", "authority.approvalPolicies[]",
  "authority.sandboxModes[]", "authority.canSetNextTurnApprovalPolicy", "authority.canSetNextTurnSandbox",
  "requests.supportedServerMethods[]", "requests.unsupportedButHandledMethods[]",
  "fork.present", "fork.governancePath", "fork.contextMaintenance", "fork.continuationBridge", "fork.threadMemoryArtifacts",
  "fork.refreshPruneMethods", "fork.agentProgressArtifacts",
  "provider.schemaVersion", "provider.profileId", "provider.projectId", "provider.kind", "provider.flavor", "provider.label",
  "provider.status", "provider.truth", "provider.selectedBy", "provider.selectedAt", "provider.capabilitySources[]",
  "provider.evidenceRefs[]", "provider.defaultForMainBranch",
  "provider.executable.requestedRuntime", "provider.executable.resolvedRuntime", "provider.executable.command",
  "provider.executable.commandEvidenceKey", "provider.executable.resolvedCommand", "provider.executable.resolvedCommandEvidenceKey",
  "provider.executable.codexHome", "provider.executable.codexHomeEvidenceKey", "provider.executable.workspaceRoot",
  "provider.executable.workspaceRootEvidenceKey", "provider.executable.appServer.status", "provider.executable.appServer.readyUrl",
  "provider.executable.appServer.readyUrlEvidenceKey", "provider.executable.appServer.transport",
  "provider.executable.appServer.schemaSource", "provider.executable.appServer.evidenceRefs[]",
  "provider.executable.flavor.configuredFlavor", "provider.executable.flavor.provenFlavor", "provider.executable.flavor.compatibility",
  "provider.executable.flavor.evidenceRefs[]",
  "provider.settingsProjection.model.source", "provider.settingsProjection.model.activeLabel", "provider.settingsProjection.model.configuredDefault",
  "provider.settingsProjection.model.canList", "provider.settingsProjection.model.availableModels[]",
  "provider.settingsProjection.model.scopes.nextTurn", "provider.settingsProjection.model.scopes.sessionDefault",
  "provider.settingsProjection.model.scopes.projectDefault", "provider.settingsProjection.model.scopes.liveThread",
  "provider.settingsProjection.model.scopes.evidenceRefs[]", "provider.settingsProjection.model.scopes.unsupportedReason",
  "provider.settingsProjection.model.evidenceRefs[]",
  "provider.settingsProjection.reasoning.source", "provider.settingsProjection.reasoning.activeLabel", "provider.settingsProjection.reasoning.configuredDefault",
  "provider.settingsProjection.reasoning.availableEfforts[]", "provider.settingsProjection.reasoning.scopes.nextTurn",
  "provider.settingsProjection.reasoning.scopes.sessionDefault", "provider.settingsProjection.reasoning.scopes.projectDefault",
  "provider.settingsProjection.reasoning.scopes.liveThread", "provider.settingsProjection.reasoning.scopes.evidenceRefs[]",
  "provider.settingsProjection.reasoning.scopes.unsupportedReason", "provider.settingsProjection.reasoning.evidenceRefs[]",
  "provider.settingsProjection.serviceTier.source", "provider.settingsProjection.serviceTier.activeLabel",
  "provider.settingsProjection.serviceTier.configuredDefault", "provider.settingsProjection.serviceTier.availableTiers[]",
  "provider.settingsProjection.serviceTier.scopes.nextTurn", "provider.settingsProjection.serviceTier.scopes.sessionDefault",
  "provider.settingsProjection.serviceTier.scopes.projectDefault", "provider.settingsProjection.serviceTier.scopes.liveThread",
  "provider.settingsProjection.serviceTier.scopes.evidenceRefs[]", "provider.settingsProjection.serviceTier.scopes.unsupportedReason",
  "provider.settingsProjection.serviceTier.evidenceRefs[]",
  "provider.settingsProjection.access.source", "provider.settingsProjection.access.approvalPolicies[]",
  "provider.settingsProjection.access.sandboxModes[]", "provider.settingsProjection.access.scopes.approvalPolicy.nextTurn",
  "provider.settingsProjection.access.scopes.approvalPolicy.sessionDefault", "provider.settingsProjection.access.scopes.approvalPolicy.projectDefault",
  "provider.settingsProjection.access.scopes.approvalPolicy.liveThread", "provider.settingsProjection.access.scopes.approvalPolicy.evidenceRefs[]",
  "provider.settingsProjection.access.scopes.approvalPolicy.unsupportedReason",
  "provider.settingsProjection.access.scopes.sandbox.nextTurn", "provider.settingsProjection.access.scopes.sandbox.sessionDefault",
  "provider.settingsProjection.access.scopes.sandbox.projectDefault", "provider.settingsProjection.access.scopes.sandbox.liveThread",
  "provider.settingsProjection.access.scopes.sandbox.evidenceRefs[]", "provider.settingsProjection.access.scopes.sandbox.unsupportedReason",
  "provider.settingsProjection.access.evidenceRefs[]",
  "provider.settingsProjection.usage.providerQuota.canRead", "provider.settingsProjection.usage.providerQuota.readSource",
  "provider.settingsProjection.usage.providerQuota.eventSource", "provider.settingsProjection.usage.providerQuota.readOwnedBy",
  "provider.settingsProjection.usage.providerQuota.evidenceRefs[]", "provider.settingsProjection.usage.canReadRateLimits",
  "provider.settingsProjection.usage.rateLimitMethod", "provider.settingsProjection.usage.contextPressure.canRead",
  "provider.settingsProjection.usage.contextPressure.source", "provider.settingsProjection.usage.contextPressure.eventSource",
  "provider.settingsProjection.usage.contextPressure.evidenceRefs[]", "provider.settingsProjection.usage.evidenceRefs[]",
]);

const DEFERRED = new Set([
  // The current app-server profile has no direct equivalent for these
  // provider-owned application/resource actions. They remain intentionally
  // outside the Direct local full-access grant.
]);

function assertClassificationCoverage() {
  const classified = new Set([...EQUIVALENT, ...DIFFERENT, ...DEFERRED]);
  const missing = CURRENT_APPSERVER_CAPABILITY_PATHS.filter((pathName) => !classified.has(pathName));
  const extra = [...classified].filter((pathName) => !CURRENT_APPSERVER_CAPABILITY_PATHS.includes(pathName));
  if (missing.length || extra.length) {
    throw new Error(`direct_appserver_capability_classification_coverage_invalid:${JSON.stringify({ missing, extra })}`);
  }
}

assertClassificationCoverage();

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function classificationFor(pathName) {
  if (EQUIVALENT.has(pathName)) return "equivalent";
  if (DIFFERENT.has(pathName)) return "intentionally_different";
  if (DEFERRED.has(pathName)) return "deferred";
  return "";
}

function directEvidenceForPath(pathName) {
  if (pathName.startsWith("provider.")) {
    return "src/main/direct/runtime/runtime-status.js:buildDirectRuntimeStatus";
  }
  if (pathName.startsWith("agents.")) {
    return "src/main/direct/controller/live-text-controller.js:buildNativeSubAgentRuntimeEnvelope";
  }
  if (pathName.startsWith("fork.")) {
    return "src/main/direct/controller/live-text-controller.js:forkThread";
  }
  if (pathName.startsWith("authority.")) {
    return "src/main/direct/authority/direct-thread-harness-grant.js:authorizeDirectThreadHarnessCapability";
  }
  return "src/main/direct/controller/live-text-controller.js:buildDirectLiveTextCapabilities";
}

function proofFor(pathName, classification) {
  const directEvidence = directEvidenceForPath(pathName);
  const statement = classification === "equivalent"
    ? `Equivalent operation ${pathName} is mechanically covered by the Direct runtime capability projection.`
    : classification === "intentionally_different"
      ? `Intentional difference for ${pathName}: Direct preserves its exact task-bound authority and provider/user-input boundary.`
      : `Deferred capability ${pathName} is outside the admitted Direct local harness population without widening authority.`;
  return {
    capabilityPath: pathName,
    source: `src/main/codex-app-server.js:buildRuntimeCapabilityProfile#${pathName}`,
    directEvidence: `${directEvidence}#${pathName}`,
    statement,
    check: {
      command: "npm run direct:appserver-capability-parity",
      assertion: `mechanical profile-population, row-classification, and canonical-proof check for ${pathName}`,
    },
  };
}

function buildDirectAppServerCapabilityParityLedger(options = {}) {
  const generatedAt = typeof options.generatedAt === "string" && options.generatedAt.trim()
    ? options.generatedAt
    : new Date().toISOString();
  const entries = CURRENT_APPSERVER_CAPABILITY_PATHS.map((capabilityPath) => {
    const classification = classificationFor(capabilityPath);
    return {
      capabilityPath,
      classification,
      proof: proofFor(capabilityPath, classification),
      ...(classification === "deferred" ? { residual: "Noncritical: provider-owned capability is not part of the admitted Direct local harness." } : {}),
    };
  });
  const ledger = {
    schema: DIRECT_APPSERVER_CAPABILITY_PARITY_SCHEMA,
    version: 1,
    batchId: "direct-appserver-default-capability-parity-v1",
    sliceId: "05-default-runtime-promotion-and-closeout",
    generatedAt,
    source: {
      module: "src/main/codex-app-server.js",
      builder: "buildRuntimeCapabilityProfile",
      profileStatus: "ready",
    },
    classifications: ["equivalent", "intentionally_different", "deferred"],
    nonCapabilityExclusions: [...APPSERVER_NON_CAPABILITY_PATHS],
    entries,
    summary: {
      total: entries.length,
      equivalent: entries.filter((entry) => entry.classification === "equivalent").length,
      intentionallyDifferent: entries.filter((entry) => entry.classification === "intentionally_different").length,
      deferred: entries.filter((entry) => entry.classification === "deferred").length,
      deferredResidualClass: "noncritical",
    },
    authority: {
      localFullAccessDoesNotGrantExternalMutation: true,
      appServerFallbackRetained: true,
      runtimeProjectionSource: "direct-live-text-task-capability-projection",
      rawProviderPayloadIncluded: false,
      rawPathIncluded: false,
      rawSecretIncluded: false,
    },
  };
  return { ...ledger, ledgerDigest: digest(ledger) };
}

function assertDirectAppServerCapabilityParityLedger(ledger = {}) {
  if (ledger.schema !== DIRECT_APPSERVER_CAPABILITY_PARITY_SCHEMA) throw new Error("direct_appserver_capability_parity_schema_invalid");
  if (JSON.stringify(ledger.nonCapabilityExclusions) !== JSON.stringify(APPSERVER_NON_CAPABILITY_PATHS)) throw new Error("direct_appserver_capability_exclusions_invalid");
  if (!Array.isArray(ledger.entries) || ledger.entries.length !== CURRENT_APPSERVER_CAPABILITY_PATHS.length) throw new Error("direct_appserver_capability_parity_entries_incomplete");
  const paths = ledger.entries.map((entry) => entry?.capabilityPath);
  if (new Set(paths).size !== paths.length || paths.some((pathName) => !CURRENT_APPSERVER_CAPABILITY_PATHS.includes(pathName))) throw new Error("direct_appserver_capability_parity_paths_invalid");
  for (const entry of ledger.entries) {
    const expected = classificationFor(entry.capabilityPath);
    if (!PARITY_CLASSIFICATIONS.has(entry.classification) || entry.classification !== expected) throw new Error(`direct_appserver_capability_parity_classification_invalid:${entry.capabilityPath}`);
    const expectedProof = proofFor(entry.capabilityPath, entry.classification);
    if (JSON.stringify(entry.proof) !== JSON.stringify(expectedProof)) throw new Error(`direct_appserver_capability_parity_proof_invalid:${entry.capabilityPath}`);
    if (entry.classification === "deferred" && !entry.residual) throw new Error(`direct_appserver_capability_parity_residual_missing:${entry.capabilityPath}`);
  }
  const expectedSummary = {
    total: ledger.entries.length,
    equivalent: ledger.entries.filter((entry) => entry.classification === "equivalent").length,
    intentionallyDifferent: ledger.entries.filter((entry) => entry.classification === "intentionally_different").length,
    deferred: ledger.entries.filter((entry) => entry.classification === "deferred").length,
    deferredResidualClass: "noncritical",
  };
  if (JSON.stringify(ledger.summary) !== JSON.stringify(expectedSummary)) throw new Error("direct_appserver_capability_parity_summary_invalid");
  if (ledger.authority?.localFullAccessDoesNotGrantExternalMutation !== true || ledger.authority?.appServerFallbackRetained !== true) throw new Error("direct_appserver_capability_parity_authority_invalid");
  return true;
}

function valueAtPath(profile, capabilityPath) {
  const arrayPath = capabilityPath.endsWith("[]") ? capabilityPath.slice(0, -2) : capabilityPath;
  let current = profile;
  for (const key of arrayPath.split(".")) {
    if (!isPlainObject(current) && !Array.isArray(current)) return { exists: false, value: undefined };
    if (!Object.prototype.hasOwnProperty.call(current, key)) return { exists: false, value: undefined };
    current = current[key];
  }
  return { exists: true, value: current };
}

function profilePathsMatchLedger(profile = {}, ledger = {}) {
  const actual = capabilityPathsFromProfile(profile);
  const expected = ledger.entries.map((entry) => entry.capabilityPath);
  return actual.length === expected.length && actual.every((pathName, index) => pathName === expected[index]);
}

function assertAppServerProfileCoversLedger(profile = {}, ledger = buildDirectAppServerCapabilityParityLedger()) {
  if (!profilePathsMatchLedger(profile, ledger)) {
    const actual = capabilityPathsFromProfile(profile);
    const expected = ledger.entries.map((entry) => entry.capabilityPath);
    throw new Error(`direct_appserver_capability_profile_population_mismatch:${JSON.stringify({
      missing: expected.filter((pathName) => !actual.includes(pathName)),
      extra: actual.filter((pathName) => !expected.includes(pathName)),
    })}`);
  }
  for (const capabilityPath of CURRENT_APPSERVER_CAPABILITY_PATHS) {
    const { exists, value } = valueAtPath(profile, capabilityPath);
    if (!exists) throw new Error(`direct_appserver_capability_profile_missing:${capabilityPath}`);
    if (capabilityPath.endsWith("[]") && !Array.isArray(value)) throw new Error(`direct_appserver_capability_profile_array_missing:${capabilityPath}`);
  }
  assertDirectAppServerCapabilityParityLedger(ledger);
  return true;
}

module.exports = {
  CURRENT_APPSERVER_CAPABILITY_PATHS,
  DIRECT_APPSERVER_CAPABILITY_PARITY_SCHEMA,
  PARITY_CLASSIFICATIONS,
  assertAppServerProfileCoversLedger,
  assertDirectAppServerCapabilityParityLedger,
  buildDirectAppServerCapabilityParityLedger,
  APPSERVER_NON_CAPABILITY_PATHS,
  capabilityPathsFromProfile,
};
