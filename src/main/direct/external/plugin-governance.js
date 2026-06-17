"use strict";

const crypto = require("node:crypto");

const PLUGIN_CATALOG_DESCRIPTOR_SCHEMA = "plugin_catalog_descriptor@1";
const PLUGIN_CAPABILITY_DIFF_SCHEMA = "plugin_capability_diff@1";
const PLUGIN_ROLLBACK_LAW_SCHEMA = "plugin_rollback_law@1";
const PLUGIN_INSTALL_REQUEST_POSTURE_SCHEMA = "plugin_install_request_posture@1";
const PLUGIN_GOVERNANCE_STATUS_SCHEMA = "plugin_governance_status@1";

const PLUGIN_SOURCE_KINDS = new Set(["curated", "marketplace", "github", "local", "unknown"]);
const SOURCE_PIN_STATES = new Set(["pinned", "unpinned", "missing", "unknown"]);
const INSTALL_STATES = new Set([
  "catalog_only",
  "blocked_missing_source_pin",
  "blocked_missing_capability_diff",
  "blocked_missing_rollback_law",
  "blocked_auto_enable_risk",
  "blocked_install_not_enabled",
]);
const DIFF_STATES = new Set(["not_available", "empty", "additive", "permission_expanding", "unknown"]);
const ROLLBACK_STATES = new Set(["not_available", "recoverable", "missing_uninstall", "missing_registry_restore", "unknown"]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedString(value, maxLength = 320) {
  const text = normalizeString(value, "");
  if (text.length <= maxLength) return text;
  if (maxLength <= 0) return "";
  if (maxLength <= 3) return ".".repeat(maxLength);
  return `${text.slice(0, maxLength - 3)}...`;
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function stableStringify(value) {
  if (value && typeof value.toJSON === "function") return stableStringify(value.toJSON());
  if (value === null) return "null";
  const type = typeof value;
  if (type === "boolean" || type === "number" || type === "string") return JSON.stringify(value);
  if (type === "bigint" || type === "function" || type === "symbol" || type === "undefined") return undefined;
  if (Array.isArray(value)) {
    return `[${value.map((entry) => {
      const serialized = stableStringify(entry);
      return serialized === undefined ? "null" : serialized;
    }).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => {
      const serialized = stableStringify(value[key]);
      return serialized === undefined ? "" : `${JSON.stringify(key)}:${serialized}`;
    })
    .filter(Boolean)
    .join(",")}}`;
}

function digestFor(domain, value) {
  return crypto.createHash("sha256").update(`${domain}:${stableStringify(value)}`).digest("hex");
}

function nowIso(nowMs) {
  const ms = typeof nowMs === "number" && Number.isFinite(nowMs) ? nowMs : Date.now();
  return new Date(ms).toISOString();
}

function normalizeEnum(value, allowed, fallback) {
  const text = normalizeString(value, fallback);
  return allowed.has(text) ? text : fallback;
}

function normalizeEvidenceRef(input = {}, fallbackKind = "plugin_governance") {
  const source = isPlainObject(input) ? input : {};
  const ref = {
    kind: boundedString(source.kind || source.refKind || fallbackKind, 80),
    id: boundedString(source.id || source.refId || source.artifactId, 160),
    digest: boundedString(source.digest || source.artifactDigest || source.refDigest, 180),
    label: boundedString(source.label || source.rendererSafeLabel || fallbackKind, 180),
    confidence: boundedString(source.confidence || source.sourceConfidence || "diagnostic", 80),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  ref.refDigest = digestFor("plugin-governance-evidence-ref@1", ref);
  return ref;
}

function normalizeEvidenceRefs(values, fallbackKind = "plugin_governance") {
  return arrayOrEmpty(values)
    .filter(isPlainObject)
    .map((value) => normalizeEvidenceRef(value, fallbackKind));
}

function safeCapabilityName(value) {
  return boundedString(value, 120);
}

function normalizeCapabilityNames(values) {
  return [...new Set(arrayOrEmpty(values).map(safeCapabilityName).filter(Boolean))].sort();
}

function buildPluginCatalogDescriptor(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const sourceKind = normalizeEnum(source.sourceKind || source.kind, PLUGIN_SOURCE_KINDS, "unknown");
  const descriptor = {
    schema: PLUGIN_CATALOG_DESCRIPTOR_SCHEMA,
    pluginId: boundedString(source.pluginId || source.id || source.name, 180),
    displayName: boundedString(source.displayName || source.name || "Plugin", 180),
    sourceKind,
    version: boundedString(source.version, 80),
    sourceRefDigest: boundedString(source.sourceRefDigest || source.sourceDigest, 180),
    manifestDigest: boundedString(source.manifestDigest || source.pluginManifestDigest, 180),
    sourcePinState: normalizeEnum(source.sourcePinState, SOURCE_PIN_STATES, source.sourceRefDigest || source.sourceDigest ? "pinned" : "missing"),
    declaredCapabilities: normalizeCapabilityNames(source.declaredCapabilities || source.capabilities),
    installedCapabilityRefs: normalizeCapabilityNames(source.installedCapabilityRefs || source.currentCapabilities),
    evidenceRefs: normalizeEvidenceRefs(source.evidenceRefs, "plugin_catalog_descriptor"),
    catalogListAllowed: true,
    pluginInstallAllowed: false,
    pluginUninstallAllowed: false,
    pluginRollbackAllowed: false,
    autoEnableNewToolsAllowed: false,
    registryMutationAllowed: false,
    providerDeclarationAllowed: false,
    localExecutionAllowed: false,
    workspaceMutationAllowed: false,
    rawManifestIncluded: false,
    rawPayloadIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  descriptor.pluginId = descriptor.pluginId || `plugin_${digestFor("plugin-catalog-source@1", descriptor).slice(0, 24)}`;
  descriptor.descriptorDigest = digestFor("plugin-catalog-descriptor@1", descriptor);
  return descriptor;
}

function buildPluginCapabilityDiff(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const before = normalizeCapabilityNames(source.before || source.currentCapabilities);
  const after = normalizeCapabilityNames(source.after || source.requestedCapabilities);
  const added = after.filter((capability) => !before.includes(capability));
  const removed = before.filter((capability) => !after.includes(capability));
  const permissionExpanding = source.permissionExpanding === true || added.length > 0;
  const diffState = normalizeEnum(
    source.diffState || source.state,
    DIFF_STATES,
    before.length || after.length ? (permissionExpanding ? "permission_expanding" : added.length || removed.length ? "additive" : "empty") : "not_available",
  );
  const diff = {
    schema: PLUGIN_CAPABILITY_DIFF_SCHEMA,
    diffId: boundedString(source.diffId || "", 180),
    pluginId: boundedString(source.pluginId || "", 180),
    before,
    after,
    addedCapabilities: added,
    removedCapabilities: removed,
    diffState,
    permissionExpanding,
    newToolSurfaceAutoEnabled: false,
    evidenceRefs: normalizeEvidenceRefs(source.evidenceRefs, "plugin_capability_diff"),
    rawManifestIncluded: false,
    rawPayloadIncluded: false,
    rawSecretIncluded: false,
  };
  diff.diffId = diff.diffId || `plugin_capability_diff_${digestFor("plugin-capability-diff-source@1", diff).slice(0, 24)}`;
  diff.diffDigest = digestFor("plugin-capability-diff@1", diff);
  return diff;
}

function buildPluginRollbackLaw(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const uninstallAvailable = source.uninstallAvailable === true;
  const registryRestoreAvailable = source.registryRestoreAvailable === true;
  const rollbackState = normalizeEnum(
    source.rollbackState || source.state,
    ROLLBACK_STATES,
    uninstallAvailable && registryRestoreAvailable ? "recoverable" : uninstallAvailable ? "missing_registry_restore" : "missing_uninstall",
  );
  const law = {
    schema: PLUGIN_ROLLBACK_LAW_SCHEMA,
    rollbackLawId: boundedString(source.rollbackLawId || "", 180),
    pluginId: boundedString(source.pluginId || "", 180),
    rollbackState,
    uninstallAvailable,
    registryRestoreAvailable,
    rollbackBeforeInstallRequired: true,
    recoverableRegistryMutationRequired: true,
    pluginUninstallAllowed: false,
    pluginRollbackAllowed: false,
    registryMutationAllowed: false,
    rawPathIncluded: false,
    rawPayloadIncluded: false,
    rawSecretIncluded: false,
    evidenceRefs: normalizeEvidenceRefs(source.evidenceRefs, "plugin_rollback_law"),
  };
  law.rollbackLawId = law.rollbackLawId || `plugin_rollback_law_${digestFor("plugin-rollback-law-source@1", law).slice(0, 24)}`;
  law.rollbackDigest = digestFor("plugin-rollback-law@1", law);
  return law;
}

function installStateFor({ descriptor, capabilityDiff, rollbackLaw } = {}) {
  if (!descriptor || descriptor.sourcePinState !== "pinned") return "blocked_missing_source_pin";
  if (!capabilityDiff || capabilityDiff.diffState === "not_available" || capabilityDiff.diffState === "unknown") return "blocked_missing_capability_diff";
  if (capabilityDiff.newToolSurfaceAutoEnabled !== false) return "blocked_auto_enable_risk";
  if (!rollbackLaw || rollbackLaw.rollbackState !== "recoverable") return "blocked_missing_rollback_law";
  return "blocked_install_not_enabled";
}

function buildPluginInstallRequestPosture(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const descriptor = isPlainObject(source.descriptor) && source.descriptor.schema === PLUGIN_CATALOG_DESCRIPTOR_SCHEMA
    ? source.descriptor
    : buildPluginCatalogDescriptor(source.descriptor || source);
  const capabilityDiff = source.capabilityDiff === null
    ? null
    : isPlainObject(source.capabilityDiff) && source.capabilityDiff.schema === PLUGIN_CAPABILITY_DIFF_SCHEMA
      ? source.capabilityDiff
      : buildPluginCapabilityDiff({
        pluginId: descriptor.pluginId,
        before: descriptor.installedCapabilityRefs,
        after: descriptor.declaredCapabilities,
        ...(isPlainObject(source.capabilityDiff) ? source.capabilityDiff : {}),
      });
  const rollbackLaw = source.rollbackLaw === null
    ? null
    : isPlainObject(source.rollbackLaw) && source.rollbackLaw.schema === PLUGIN_ROLLBACK_LAW_SCHEMA
      ? source.rollbackLaw
      : buildPluginRollbackLaw({
        pluginId: descriptor.pluginId,
        ...(isPlainObject(source.rollbackLaw) ? source.rollbackLaw : {}),
      });
  const installState = normalizeEnum(source.installState || source.state, INSTALL_STATES, installStateFor({ descriptor, capabilityDiff, rollbackLaw }));
  const posture = {
    schema: PLUGIN_INSTALL_REQUEST_POSTURE_SCHEMA,
    requestId: boundedString(source.requestId || "", 180),
    projectId: boundedString(source.projectId, 160),
    workThreadId: boundedString(source.workThreadId, 160),
    pluginId: descriptor.pluginId,
    descriptor,
    capabilityDiff,
    rollbackLaw,
    installState,
    sourcePinned: descriptor.sourcePinState === "pinned",
    capabilityDiffAvailable: Boolean(capabilityDiff && capabilityDiff.diffState !== "not_available" && capabilityDiff.diffState !== "unknown"),
    rollbackLawRecoverable: rollbackLaw?.rollbackState === "recoverable",
    nonAutoEnableRequired: true,
    pluginInstallAllowed: false,
    pluginUninstallAllowed: false,
    pluginRollbackAllowed: false,
    autoEnableNewToolsAllowed: false,
    registryMutationAllowed: false,
    providerDeclarationAllowed: false,
    localExecutionAllowed: false,
    workspaceMutationAllowed: false,
    externalNetworkMutationAllowed: false,
    rawManifestIncluded: false,
    rawPayloadIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    evidenceRefs: normalizeEvidenceRefs(source.evidenceRefs, "plugin_install_request_posture"),
    rendererSafeSummary: boundedString(
      source.rendererSafeSummary || "Plugin install is a capability-surface mutation and remains blocked until source pinning, capability diff, rollback law, and non-auto-enable gates are proven.",
      420,
    ),
    generatedAt: normalizeString(source.generatedAt, nowIso(source.nowMs)),
  };
  posture.requestId = posture.requestId || `plugin_install_request_${digestFor("plugin-install-request-source@1", posture).slice(0, 24)}`;
  posture.requestDigest = digestFor("plugin-install-request-posture@1", posture);
  return posture;
}

function countBy(rows = [], field) {
  const counts = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = normalizeString(row?.[field], "unknown");
    counts[key] = Number(counts[key] || 0) + 1;
  }
  return counts;
}

function buildPluginGovernanceStatus(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const projectId = boundedString(source.projectId, 160);
  const workThreadId = boundedString(source.workThreadId, 160);
  const generatedAt = normalizeString(source.generatedAt, nowIso(source.nowMs));
  const catalogDescriptors = (Array.isArray(source.catalogDescriptors) && source.catalogDescriptors.length
    ? source.catalogDescriptors
    : [
      {
        pluginId: "plugin_catalog_list_projection",
        displayName: "Plugin catalog list",
        sourceKind: "marketplace",
        sourcePinState: "missing",
      },
    ]).map((descriptor) => buildPluginCatalogDescriptor(descriptor));
  const installRequests = (Array.isArray(source.installRequests) ? source.installRequests : [
    {
      projectId,
      workThreadId,
      descriptor: catalogDescriptors[0],
      capabilityDiff: null,
      rollbackLaw: null,
      generatedAt,
    },
  ]).map((request) => buildPluginInstallRequestPosture({
    projectId,
    workThreadId,
    generatedAt,
    ...request,
  }));
  const status = {
    schema: PLUGIN_GOVERNANCE_STATUS_SCHEMA,
    statusId: boundedString(source.statusId || "", 180),
    projectId,
    workThreadId,
    status: boundedString(source.status || "plugin_governance_boundary_only", 120),
    catalogDescriptorCount: catalogDescriptors.length,
    installRequestCount: installRequests.length,
    blockedInstallRequestCount: installRequests.filter((request) => request.installState.startsWith("blocked")).length,
    sourcePinnedCount: catalogDescriptors.filter((descriptor) => descriptor.sourcePinState === "pinned").length,
    bySourcePinState: countBy(catalogDescriptors, "sourcePinState"),
    byInstallState: countBy(installRequests, "installState"),
    catalogDescriptors,
    installRequests,
    pluginCatalogListAllowed: true,
    pluginInstallAllowed: false,
    pluginUninstallAllowed: false,
    pluginRollbackAllowed: false,
    autoEnableNewToolsAllowed: false,
    registryMutationAllowed: false,
    providerDeclarationAllowed: false,
    localExecutionAllowed: false,
    workspaceMutationAllowed: false,
    externalNetworkMutationAllowed: false,
    rawManifestIncluded: false,
    rawPayloadIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    rendererSafeSummary: "Plugin catalog listing is discovery only; plugin install remains blocked until source pinning, capability diff, rollback law, and non-auto-enable gates are proven.",
    generatedAt,
  };
  status.statusId = status.statusId || `plugin_governance_${digestFor("plugin-governance-status-source@1", status).slice(0, 24)}`;
  status.statusDigest = digestFor("plugin-governance-status@1", status);
  return status;
}

function assertFalseFlags(target = {}, flags = [], label = "plugin_governance") {
  for (const flag of flags) {
    if (target[flag] !== false) throw new Error(`${label}_authority_leak:${flag}`);
  }
}

function assertPluginGovernanceStatusSafe(status = {}) {
  if (!isPlainObject(status) || status.schema !== PLUGIN_GOVERNANCE_STATUS_SCHEMA) {
    throw new Error("plugin_governance_status_schema_mismatch");
  }
  assertFalseFlags(status, [
    "pluginInstallAllowed",
    "pluginUninstallAllowed",
    "pluginRollbackAllowed",
    "autoEnableNewToolsAllowed",
    "registryMutationAllowed",
    "providerDeclarationAllowed",
    "localExecutionAllowed",
    "workspaceMutationAllowed",
    "externalNetworkMutationAllowed",
    "rawManifestIncluded",
    "rawPayloadIncluded",
    "rawPathIncluded",
    "rawSecretIncluded",
  ], "plugin_governance_status");
  for (const descriptor of arrayOrEmpty(status.catalogDescriptors)) {
    if (descriptor.schema !== PLUGIN_CATALOG_DESCRIPTOR_SCHEMA) throw new Error("plugin_catalog_descriptor_schema_mismatch");
    assertFalseFlags(descriptor, [
      "pluginInstallAllowed",
      "pluginUninstallAllowed",
      "pluginRollbackAllowed",
      "autoEnableNewToolsAllowed",
      "registryMutationAllowed",
      "providerDeclarationAllowed",
      "localExecutionAllowed",
      "workspaceMutationAllowed",
      "rawManifestIncluded",
      "rawPayloadIncluded",
      "rawPathIncluded",
      "rawSecretIncluded",
    ], "plugin_catalog_descriptor");
  }
  for (const request of arrayOrEmpty(status.installRequests)) {
    if (request.schema !== PLUGIN_INSTALL_REQUEST_POSTURE_SCHEMA) throw new Error("plugin_install_request_posture_schema_mismatch");
    assertFalseFlags(request, [
      "pluginInstallAllowed",
      "pluginUninstallAllowed",
      "pluginRollbackAllowed",
      "autoEnableNewToolsAllowed",
      "registryMutationAllowed",
      "providerDeclarationAllowed",
      "localExecutionAllowed",
      "workspaceMutationAllowed",
      "externalNetworkMutationAllowed",
      "rawManifestIncluded",
      "rawPayloadIncluded",
      "rawPathIncluded",
      "rawSecretIncluded",
    ], "plugin_install_request_posture");
    if (request.capabilityDiff) {
      if (request.capabilityDiff.schema !== PLUGIN_CAPABILITY_DIFF_SCHEMA) throw new Error("plugin_capability_diff_schema_mismatch");
      if (request.capabilityDiff.newToolSurfaceAutoEnabled !== false) throw new Error("plugin_capability_diff_auto_enable_leak");
      assertFalseFlags(request.capabilityDiff, ["rawManifestIncluded", "rawPayloadIncluded", "rawSecretIncluded"], "plugin_capability_diff");
    }
    if (request.rollbackLaw) {
      if (request.rollbackLaw.schema !== PLUGIN_ROLLBACK_LAW_SCHEMA) throw new Error("plugin_rollback_law_schema_mismatch");
      assertFalseFlags(request.rollbackLaw, [
        "pluginUninstallAllowed",
        "pluginRollbackAllowed",
        "registryMutationAllowed",
        "rawPathIncluded",
        "rawPayloadIncluded",
        "rawSecretIncluded",
      ], "plugin_rollback_law");
    }
  }
  return true;
}

module.exports = {
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
};
