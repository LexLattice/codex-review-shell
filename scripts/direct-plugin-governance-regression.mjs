#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  PLUGIN_CAPABILITY_DIFF_SCHEMA,
  PLUGIN_CATALOG_DESCRIPTOR_SCHEMA,
  PLUGIN_GOVERNANCE_STATUS_SCHEMA,
  PLUGIN_INSTALL_REQUEST_POSTURE_SCHEMA,
  PLUGIN_ROLLBACK_LAW_SCHEMA,
  assertPluginGovernanceStatusSafe,
  buildPluginCapabilityDiff,
  buildPluginCatalogDescriptor,
  buildPluginGovernanceStatus,
  buildPluginInstallRequestPosture,
  buildPluginRollbackLaw,
} = require("../src/main/direct/external/plugin-governance");
const {
  buildExternalCapabilityDiscoveryRegistry,
  assertExternalCapabilityDiscoveryRegistrySafe,
} = require("../src/main/direct/external/capability-discovery");
const {
  buildDirectSettingsSurfaceProjection,
  assertDirectSettingsSurfaceRendererSafe,
} = require("../src/main/direct/ui/settings-surface");
const {
  buildDirectInformationBridgeAudit,
} = require("../src/main/direct/bridge/information-registry");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectThrows(fn, expectedMessage) {
  try {
    fn();
  } catch (error) {
    if (expectedMessage && !String(error?.message || "").includes(expectedMessage)) {
      throw new Error(`expected ${expectedMessage}, got ${error?.message || error}`);
    }
    return;
  }
  throw new Error(`expected throw: ${expectedMessage}`);
}

const descriptor = buildPluginCatalogDescriptor({
  pluginId: "plugin_fixture_review",
  displayName: "Review Plugin",
  sourceKind: "github",
  version: "1.2.3",
  sourceRefDigest: "source_digest_fixture",
  manifestDigest: "manifest_digest_fixture",
  declaredCapabilities: ["skill.review", "mcp.review"],
  installedCapabilityRefs: ["skill.review"],
});
assert(descriptor.schema === PLUGIN_CATALOG_DESCRIPTOR_SCHEMA, "descriptor schema mismatch");
assert(descriptor.sourcePinState === "pinned", "source digest should make descriptor pinned");
assert(descriptor.catalogListAllowed === true, "catalog listing should be allowed");
assert(descriptor.pluginInstallAllowed === false, "catalog descriptor must not allow install");
assert(descriptor.rawManifestIncluded === false, "catalog descriptor must not include raw manifest");

const capabilityDiff = buildPluginCapabilityDiff({
  pluginId: descriptor.pluginId,
  before: descriptor.installedCapabilityRefs,
  after: descriptor.declaredCapabilities,
});
assert(capabilityDiff.schema === PLUGIN_CAPABILITY_DIFF_SCHEMA, "capability diff schema mismatch");
assert(capabilityDiff.diffState === "permission_expanding", "added capability should be permission-expanding");
assert(capabilityDiff.addedCapabilities.includes("mcp.review"), "diff should record added capability");
assert(capabilityDiff.newToolSurfaceAutoEnabled === false, "new tool surface must not be auto-enabled");

const rollbackLaw = buildPluginRollbackLaw({
  pluginId: descriptor.pluginId,
  uninstallAvailable: true,
  registryRestoreAvailable: true,
});
assert(rollbackLaw.schema === PLUGIN_ROLLBACK_LAW_SCHEMA, "rollback law schema mismatch");
assert(rollbackLaw.rollbackState === "recoverable", "rollback law should be recoverable");
assert(rollbackLaw.pluginRollbackAllowed === false, "rollback law must not itself allow rollback");

const installPosture = buildPluginInstallRequestPosture({
  projectId: "project_plugin_governance_fixture",
  workThreadId: "work_thread_plugin_governance_fixture",
  descriptor,
  capabilityDiff,
  rollbackLaw,
  nowMs: 0,
});
assert(installPosture.schema === PLUGIN_INSTALL_REQUEST_POSTURE_SCHEMA, "install posture schema mismatch");
assert(installPosture.installState === "blocked_install_not_enabled", "fully proven gates should still leave install disabled in this PR");
assert(installPosture.sourcePinned === true, "install posture should preserve source pin witness");
assert(installPosture.capabilityDiffAvailable === true, "install posture should preserve diff witness");
assert(installPosture.rollbackLawRecoverable === true, "install posture should preserve rollback witness");
assert(installPosture.pluginInstallAllowed === false, "install posture must not allow install");

const missingPinStatus = buildPluginGovernanceStatus({
  projectId: "project_plugin_governance_fixture",
  workThreadId: "work_thread_plugin_governance_fixture",
  catalogDescriptors: [
    {
      pluginId: "plugin_unpinned_fixture",
      displayName: "Unpinned Plugin",
      sourceKind: "marketplace",
      declaredCapabilities: ["skill.unpinned"],
    },
  ],
  nowMs: 0,
});
assert(missingPinStatus.schema === PLUGIN_GOVERNANCE_STATUS_SCHEMA, "status schema mismatch");
assert(missingPinStatus.installRequests[0].installState === "blocked_missing_source_pin", "missing source pin should block install");
assert(missingPinStatus.blockedInstallRequestCount === 1, "missing pin should count as blocked");
assertPluginGovernanceStatusSafe(missingPinStatus);

const missingDiff = buildPluginInstallRequestPosture({
  descriptor,
  capabilityDiff: null,
  rollbackLaw,
  nowMs: 0,
});
assert(missingDiff.installState === "blocked_missing_capability_diff", "missing diff should block install");

const missingRollback = buildPluginInstallRequestPosture({
  descriptor,
  capabilityDiff,
  rollbackLaw: null,
  nowMs: 0,
});
assert(missingRollback.installState === "blocked_missing_rollback_law", "missing rollback law should block install");

const status = buildPluginGovernanceStatus({
  projectId: "project_plugin_governance_fixture",
  workThreadId: "work_thread_plugin_governance_fixture",
  catalogDescriptors: [descriptor],
  installRequests: [installPosture, missingDiff, missingRollback],
  nowMs: 0,
});
assert(status.catalogDescriptorCount === 1, "status should include one catalog descriptor");
assert(status.installRequestCount === 3, "status should include three install postures");
assert(status.blockedInstallRequestCount === 3, "every install posture should be blocked");
assert(status.pluginCatalogListAllowed === true, "status should permit catalog list posture");
assert(status.pluginInstallAllowed === false, "status must not permit plugin install");
assert(status.autoEnableNewToolsAllowed === false, "status must not auto-enable new tools");
assertPluginGovernanceStatusSafe(status);

const externalDiscovery = buildExternalCapabilityDiscoveryRegistry({ projectId: status.projectId, nowMs: 0 });
assertExternalCapabilityDiscoveryRegistrySafe(externalDiscovery);
assert(externalDiscovery.descriptors.some((row) => row.sourceKind === "plugin_catalog"), "external discovery should retain plugin catalog descriptor");
assert(externalDiscovery.descriptors.some((row) => row.sourceKind === "plugin"), "external discovery should retain plugin install descriptor");

const settingsProjection = buildDirectSettingsSurfaceProjection({
  projectId: status.projectId,
  pluginGovernanceStatus: status,
});
assert(settingsProjection.sections.pluginGovernance.available === true, "settings should expose plugin governance");
assert(settingsProjection.sections.pluginGovernance.blockedInstallRequestCount === 3, "settings blocked count mismatch");
assert(settingsProjection.authority.pluginGovernanceInstallAllowed === false, "settings must block plugin install");
assert(settingsProjection.authority.pluginGovernanceRegistryMutationAllowed === false, "settings must block registry mutation");
assert(settingsProjection.bridgeOrgans.includes("plugin_governance"), "settings should cite plugin governance bridge organ");
assert(Array.isArray(settingsProjection.rows.pluginGovernance) && settingsProjection.rows.pluginGovernance.length >= 8, "settings should render plugin governance rows");
assertDirectSettingsSurfaceRendererSafe(settingsProjection);

const audit = buildDirectInformationBridgeAudit({ generatedAt: "1970-01-01T00:00:00.000Z" });
assert(audit.rows.some((row) => row.id === "ic30.plugin-governance"), "information registry should include plugin governance row");

const hostileStatus = buildPluginGovernanceStatus({
  projectId: "hostile",
  catalogDescriptors: [descriptor],
  installRequests: [installPosture],
  nowMs: 0,
});
hostileStatus.pluginInstallAllowed = true;
expectThrows(() => assertPluginGovernanceStatusSafe(hostileStatus), "plugin_governance_status_authority_leak");

const hostileAutoEnable = buildPluginGovernanceStatus({
  projectId: "hostile_auto_enable",
  catalogDescriptors: [descriptor],
  installRequests: [{
    ...installPosture,
    capabilityDiff: {
      ...installPosture.capabilityDiff,
      newToolSurfaceAutoEnabled: true,
    },
  }],
  nowMs: 0,
});
expectThrows(() => assertPluginGovernanceStatusSafe(hostileAutoEnable), "plugin_capability_diff_auto_enable_leak");

const serialized = JSON.stringify({ descriptor, capabilityDiff, rollbackLaw, installPosture, status, settingsProjection });
for (const forbidden of [
  "\"pluginInstallAllowed\":true",
  "\"pluginUninstallAllowed\":true",
  "\"pluginRollbackAllowed\":true",
  "\"autoEnableNewToolsAllowed\":true",
  "\"registryMutationAllowed\":true",
  "\"providerDeclarationAllowed\":true",
  "\"localExecutionAllowed\":true",
  "\"workspaceMutationAllowed\":true",
  "\"externalNetworkMutationAllowed\":true",
  "\"rawManifestIncluded\":true",
  "\"rawPayloadIncluded\":true",
  "\"rawPathIncluded\":true",
  "\"rawSecretIncluded\":true",
]) {
  assert(!serialized.includes(forbidden), `serialized plugin governance leaked ${forbidden}`);
}

console.log(JSON.stringify({
  ok: true,
  statusId: status.statusId,
  catalogDescriptorCount: status.catalogDescriptorCount,
  installRequestCount: status.installRequestCount,
  blockedInstallRequestCount: status.blockedInstallRequestCount,
  statusDigest: status.statusDigest,
}));
