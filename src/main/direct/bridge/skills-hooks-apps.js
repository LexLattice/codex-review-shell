"use strict";

const crypto = require("node:crypto");

const DIRECT_BRIDGE_MODULE_REGISTRY_SCHEMA = "direct_bridge_module_registry@1";
const DIRECT_BRIDGE_MODULE_SCHEMA = "direct_bridge_module@1";
const DIRECT_BRIDGE_MODULE_CAPABILITY_SCHEMA = "direct_bridge_module_capability@1";
const DIRECT_BRIDGE_MODULE_AUTHORITY_REPORT_SCHEMA = "direct_bridge_module_authority_report@1";
const DIRECT_BRIDGE_MODULE_STATUS_PROJECTION_SCHEMA = "direct_bridge_module_status_projection@1";

const MODULE_KINDS = new Set(["skill", "hook", "connector", "tool_adapter"]);
const MODULE_AUTHORITY_POSTURES = new Set([
  "context_only",
  "evidence_import",
  "action_proposal",
  "execution_requires_gate",
  "unsupported",
]);
const CAPABILITY_KINDS = new Set([
  "procedural_context",
  "context_transform",
  "external_evidence_import",
  "action_proposal",
  "hook_action",
  "connector_action",
  "ui_projection",
  "unsupported",
]);
const SIDE_EFFECT_SCOPES = new Set([
  "none",
  "workspace_read",
  "workspace_write",
  "process_execution",
  "external_service",
  "provider_request",
  "ui_only",
]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedString(value, maxLength = 240) {
  const text = normalizeString(value, "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function stableStringify(value) {
  if (value && typeof value.toJSON === "function") {
    return stableStringify(value.toJSON());
  }
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => (entry === undefined ? "null" : stableStringify(entry))).join(",")}]`;
  }
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function nowIso(nowMs) {
  const ms = typeof nowMs === "number" && !Number.isNaN(nowMs) ? nowMs : Date.now();
  return new Date(ms).toISOString();
}

function digestFor(domain, value) {
  return sha256(`${domain}:${stableStringify(value)}`);
}

function normalizeEvidenceRef(input = {}, fallbackKind = "bridge_module") {
  const ref = {
    kind: normalizeString(input.kind, fallbackKind),
    artifactId: normalizeString(input.artifactId || input.id, ""),
    artifactDigest: normalizeString(input.artifactDigest || input.digest, ""),
    sourceConfidence: normalizeString(input.sourceConfidence, "diagnostic"),
    rendererSafeLabel: boundedString(input.rendererSafeLabel || input.label || fallbackKind, 160),
    rawTextIncluded: false,
  };
  ref.refDigest = digestFor("direct-bridge-module-evidence-ref@1", ref);
  return ref;
}

function normalizeEvidenceRefs(values, fallbackKind = "bridge_module") {
  if (!Array.isArray(values)) return [];
  return values.map((value) => normalizeEvidenceRef(value, fallbackKind));
}

function normalizeModuleKind(value) {
  const kind = normalizeString(value, "unsupported");
  return MODULE_KINDS.has(kind) ? kind : "unsupported";
}

function normalizeAuthorityPosture(value, moduleKind) {
  const posture = normalizeString(value, "");
  if (MODULE_AUTHORITY_POSTURES.has(posture)) return posture;
  if (moduleKind === "skill") return "context_only";
  if (moduleKind === "hook") return "action_proposal";
  if (moduleKind === "connector") return "evidence_import";
  return "unsupported";
}

function normalizeCapabilityKind(value) {
  const kind = normalizeString(value, "unsupported");
  return CAPABILITY_KINDS.has(kind) ? kind : "unsupported";
}

function normalizeSideEffectScope(value, authorityPosture) {
  const scope = normalizeString(value, "");
  if (SIDE_EFFECT_SCOPES.has(scope)) return scope;
  if (authorityPosture === "context_only") return "none";
  if (authorityPosture === "evidence_import") return "external_service";
  return "none";
}

function requestedBridgeAuthority(input = {}) {
  return Boolean(
    input.executionAllowedInThisPr ||
      input.mutationAllowedInThisPr ||
      input.providerCallAllowedInThisPr ||
      input.routingAllowedInThisPr ||
      input.autoInvokeAllowedInThisPr ||
      input.mayExecuteActionInThisPr ||
      input.mayMutateWorkspaceInThisPr ||
      input.mayCallProviderInThisPr ||
      input.mayRouteWorkThreadInThisPr ||
      input.autoInvocationAllowedInThisPr,
  );
}

function buildBridgeModuleCapability(input = {}, module = {}) {
  const capabilityKind = normalizeCapabilityKind(input.capabilityKind || input.kind);
  const authorityPosture = normalizeAuthorityPosture(input.authorityPosture, module.moduleKind);
  const sideEffectScope = normalizeSideEffectScope(input.sideEffectScope, authorityPosture);
  const capability = {
    schema: DIRECT_BRIDGE_MODULE_CAPABILITY_SCHEMA,
    capabilityId: normalizeString(input.capabilityId || input.id, `capability_${sha256(`${module.moduleId || ""}:${capabilityKind}:${input.name || ""}`).slice(0, 20)}`),
    moduleId: normalizeString(input.moduleId, module.moduleId || ""),
    capabilityKind,
    authorityPosture,
    sideEffectScope,
    contextContributionAllowed: authorityPosture === "context_only" || authorityPosture === "evidence_import",
    evidenceImportAllowed: authorityPosture === "evidence_import",
    actionProposalAllowed: authorityPosture === "action_proposal" || authorityPosture === "execution_requires_gate",
    executionRequiresGate: authorityPosture === "execution_requires_gate",
    executionAllowedInThisPr: false,
    mutationAllowedInThisPr: false,
    providerCallAllowedInThisPr: false,
    routingAllowedInThisPr: false,
    autoInvokeAllowedInThisPr: false,
    authorityInflationAttempted: requestedBridgeAuthority(input),
    rawTextIncluded: false,
    rawSecretIncluded: false,
    evidenceRefs: normalizeEvidenceRefs(input.evidenceRefs, "bridge_module_capability"),
    rendererSafeSummary: boundedString(input.rendererSafeSummary || input.summary || `${capabilityKind} capability is classified as ${authorityPosture}.`, 320),
  };
  capability.capabilityDigest = digestFor("direct-bridge-module-capability@1", capability);
  return capability;
}

function buildBridgeModule(input = {}) {
  const moduleKind = normalizeModuleKind(input.moduleKind || input.kind);
  const authorityPosture = normalizeAuthorityPosture(input.authorityPosture, moduleKind);
  const module = {
    schema: DIRECT_BRIDGE_MODULE_SCHEMA,
    moduleId: normalizeString(input.moduleId || input.id, `bridge_module_${sha256(`${moduleKind}:${input.name || ""}:${input.source || ""}`).slice(0, 20)}`),
    moduleKind,
    displayName: boundedString(input.displayName || input.name || moduleKind, 160),
    source: normalizeString(input.source, "unknown"),
    sourceWorld: normalizeString(input.sourceWorld, moduleKind === "connector" ? "connector" : "harness"),
    authorityPosture,
    sideEffectScope: normalizeSideEffectScope(input.sideEffectScope, authorityPosture),
    workThreadScoped: input.workThreadScoped === true,
    contextPacketScoped: input.contextPacketScoped !== false,
    mayContributeContext: authorityPosture === "context_only" || authorityPosture === "evidence_import",
    mayImportEvidence: authorityPosture === "evidence_import",
    mayProposeAction: authorityPosture === "action_proposal" || authorityPosture === "execution_requires_gate",
    mayExecuteActionInThisPr: false,
    mayMutateWorkspaceInThisPr: false,
    mayCallProviderInThisPr: false,
    mayRouteWorkThreadInThisPr: false,
    autoInvocationAllowedInThisPr: false,
    authorityInflationAttempted: requestedBridgeAuthority(input),
    rawPromptTextIncluded: false,
    rawConnectorPayloadIncluded: false,
    rawSecretIncluded: false,
    evidenceRefs: normalizeEvidenceRefs(input.evidenceRefs, "bridge_module"),
    capabilities: [],
    rendererSafeSummary: boundedString(input.rendererSafeSummary || input.summary || `${moduleKind} bridge module is ${authorityPosture}.`, 320),
  };
  module.capabilities = (Array.isArray(input.capabilities) ? input.capabilities : [])
    .map((capability) => buildBridgeModuleCapability({ ...capability, moduleId: module.moduleId }, module));
  module.moduleDigest = digestFor("direct-bridge-module@1", module);
  return module;
}

function buildBridgeModuleRegistry(input = {}) {
  const modules = (Array.isArray(input.modules) ? input.modules : [])
    .map((module) => buildBridgeModule(module))
    .sort((a, b) => a.moduleId.localeCompare(b.moduleId));
  const registrySource = {
    modules: modules.map((module) => ({
      moduleId: module.moduleId,
      moduleKind: module.moduleKind,
      authorityPosture: module.authorityPosture,
      moduleDigest: module.moduleDigest,
      capabilities: module.capabilities.map((capability) => capability.capabilityDigest),
    })),
  };
  const registryDigest = digestFor("direct-bridge-module-registry-source@1", registrySource);
  const registry = {
    schema: DIRECT_BRIDGE_MODULE_REGISTRY_SCHEMA,
    registryId: normalizeString(input.registryId, `bridge_module_registry_${registryDigest.slice(0, 24)}`),
    projectId: normalizeString(input.projectId, ""),
    workThreadId: normalizeString(input.workThreadId, ""),
    mode: normalizeString(input.mode, "shadow"),
    moduleCount: modules.length,
    modules,
    registryDigest,
    executableInThisPr: false,
    routingEnforcedInThisPr: false,
    rawTextIncluded: false,
    rawSecretIncluded: false,
    createdAt: normalizeString(input.createdAt, nowIso(input.nowMs)),
  };
  registry.integrity = {
    algorithm: "sha256",
    sourceDigest: registryDigest,
    artifactDigest: "",
  };
  registry.integrity.artifactDigest = digestFor("direct-bridge-module-registry@1", registry);
  return registry;
}

function buildBridgeModuleAuthorityReport(input = {}) {
  const registry = isPlainObject(input.registry) ? input.registry : buildBridgeModuleRegistry(input);
  const modules = Array.isArray(registry.modules) ? registry.modules : [];
  const capabilities = modules.flatMap((module) => Array.isArray(module.capabilities) ? module.capabilities : []);
  const authorityInflationAttempts = modules.flatMap((module) => [
    module.authorityInflationAttempted,
    ...(Array.isArray(module.capabilities)
      ? module.capabilities.map((capability) => capability.authorityInflationAttempted)
      : []),
  ]);
  const report = {
    schema: DIRECT_BRIDGE_MODULE_AUTHORITY_REPORT_SCHEMA,
    reportId: normalizeString(input.reportId, `bridge_module_authority_${sha256(registry.integrity?.artifactDigest || registry.registryDigest).slice(0, 24)}`),
    projectId: normalizeString(input.projectId, registry.projectId || ""),
    workThreadId: normalizeString(input.workThreadId, registry.workThreadId || ""),
    registryId: registry.registryId,
    registryDigest: registry.integrity?.artifactDigest || registry.registryDigest,
    moduleCount: modules.length,
    contextContributorCount: modules.filter((module) => module.mayContributeContext).length,
    evidenceImporterCount: modules.filter((module) => module.mayImportEvidence).length,
    actionProposalCount: modules.filter((module) => module.mayProposeAction).length,
    executionModuleCount: modules.filter((module) => module.authorityPosture === "execution_requires_gate").length,
    gateRequiredCapabilityCount: capabilities.filter((capability) => capability.executionRequiresGate).length,
    executionAllowedInThisPr: false,
    mutationAllowedInThisPr: false,
    providerCallAllowedInThisPr: false,
    routingAllowedInThisPr: false,
    autoInvocationAllowedInThisPr: false,
    attemptedAuthorityInflationBlocked: authorityInflationAttempts.some(Boolean),
    rendererSafeSummary: "Bridge modules are classified as context/evidence/action-proposal surfaces only; execution is not enabled in this PR.",
    rawTextIncluded: false,
    rawSecretIncluded: false,
  };
  report.reportDigest = digestFor("direct-bridge-module-authority-report@1", report);
  return report;
}

function buildBridgeModuleStatusProjection(input = {}) {
  const registry = isPlainObject(input.registry) ? input.registry : null;
  const report = isPlainObject(input.report) ? input.report : null;
  const sourceDigest = digestFor("direct-bridge-module-status-source@1", {
    registryDigest: registry?.integrity?.artifactDigest || registry?.registryDigest || "",
    reportDigest: report?.reportDigest || "",
  });
  const projection = {
    schema: DIRECT_BRIDGE_MODULE_STATUS_PROJECTION_SCHEMA,
    projectId: normalizeString(input.projectId, registry?.projectId || report?.projectId || ""),
    workThreadId: normalizeString(input.workThreadId, registry?.workThreadId || report?.workThreadId || ""),
    uiProjectionGeneration: Number(input.uiProjectionGeneration || 1),
    sourceDigest,
    moduleCount: Number(registry?.moduleCount || report?.moduleCount || 0),
    status: normalizeString(input.status, "shadow_only"),
    contextContributorCount: Number(report?.contextContributorCount || 0),
    evidenceImporterCount: Number(report?.evidenceImporterCount || 0),
    actionProposalCount: Number(report?.actionProposalCount || 0),
    executionAllowedInThisPr: false,
    actionable: false,
    rendererSafeSummary: normalizeString(input.rendererSafeSummary, "Skills, hooks, and apps are classified but not executable in Direct bridge mode."),
    rawTextIncluded: false,
    rawSecretIncluded: false,
  };
  projection.projectionDigest = digestFor("direct-bridge-module-status-projection@1", projection);
  return projection;
}

module.exports = {
  CAPABILITY_KINDS,
  DIRECT_BRIDGE_MODULE_AUTHORITY_REPORT_SCHEMA,
  DIRECT_BRIDGE_MODULE_CAPABILITY_SCHEMA,
  DIRECT_BRIDGE_MODULE_REGISTRY_SCHEMA,
  DIRECT_BRIDGE_MODULE_SCHEMA,
  DIRECT_BRIDGE_MODULE_STATUS_PROJECTION_SCHEMA,
  MODULE_AUTHORITY_POSTURES,
  MODULE_KINDS,
  SIDE_EFFECT_SCOPES,
  buildBridgeModule,
  buildBridgeModuleAuthorityReport,
  buildBridgeModuleCapability,
  buildBridgeModuleRegistry,
  buildBridgeModuleStatusProjection,
  sha256,
  stableStringify,
};
