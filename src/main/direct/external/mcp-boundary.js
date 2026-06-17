"use strict";

const crypto = require("node:crypto");

const MCP_EXTERNAL_SOURCE_PROVENANCE_SCHEMA = "mcp_external_source_provenance@1";
const MCP_RESOURCE_READ_BOUNDARY_SCHEMA = "mcp_resource_read_boundary@1";
const MCP_DYNAMIC_TOOL_CALL_BOUNDARY_SCHEMA = "mcp_dynamic_tool_call_boundary@1";
const MCP_RESOURCE_TOOL_BOUNDARY_STATUS_SCHEMA = "mcp_resource_tool_boundary_status@1";

const SERVER_TRUST_STATES = new Set(["trusted_local", "configured", "untrusted", "unknown"]);
const RESOURCE_READ_STATES = new Set(["blocked", "boundary_recorded", "staged_pending", "not_requested"]);
const DYNAMIC_CALL_STATES = new Set(["blocked", "boundary_recorded", "approval_pending_future", "not_requested"]);
const SIDE_EFFECT_CLASSES = new Set(["external_read", "external_action", "capability_mutation", "unknown"]);
const RESULT_TRUST_LEVELS = new Set(["untrusted_external", "staged_evidence_required", "not_read", "unknown"]);
const REQUEST_SOURCES = new Set(["model_tool_call", "human_action", "headless_event", "fixture", "unknown"]);

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
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
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

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeEvidenceRef(input = {}, fallbackKind = "mcp_boundary") {
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
  ref.refDigest = digestFor("mcp-boundary-evidence-ref@1", ref);
  return ref;
}

function normalizeEvidenceRefs(values, fallbackKind = "mcp_boundary") {
  return arrayOrEmpty(values)
    .filter(isPlainObject)
    .map((value) => normalizeEvidenceRef(value, fallbackKind));
}

function displayUriFor(value) {
  const uri = normalizeString(value, "");
  if (!uri) return "";
  try {
    const parsed = new URL(uri);
    const host = parsed.host ? `//${parsed.host}` : "";
    const query = parsed.search ? "?..." : "";
    const hash = parsed.hash ? "#..." : "";
    return boundedString(`${parsed.protocol}${host}${parsed.pathname}${query}${hash}`, 220);
  } catch {
    const hashIndex = uri.indexOf("#");
    const hasHash = hashIndex !== -1;
    const beforeHash = hasHash ? uri.slice(0, hashIndex) : uri;
    const queryIndex = beforeHash.indexOf("?");
    const hasQuery = queryIndex !== -1;
    const beforeQuery = hasQuery ? beforeHash.slice(0, queryIndex) : beforeHash;
    const sanitizedBase = beforeQuery.replace(/\/\/([^/@\s]+)@/g, "//…@");
    return boundedString(`${sanitizedBase}${hasQuery ? "?..." : ""}${hasHash ? "#..." : ""}`, 220);
  }
}

function buildMcpExternalSourceProvenance(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const provenance = {
    schema: MCP_EXTERNAL_SOURCE_PROVENANCE_SCHEMA,
    provenanceId: boundedString(source.provenanceId || source.id, 180),
    serverIdentity: boundedString(source.serverIdentity || source.serverName || "unknown", 180),
    serverTrustState: normalizeEnum(source.serverTrustState, SERVER_TRUST_STATES, "unknown"),
    descriptorDigest: boundedString(source.descriptorDigest || source.capabilityDescriptorDigest, 180),
    sourceDigest: boundedString(source.sourceDigest, 180),
    discoveredVia: boundedString(source.discoveredVia || source.sourceKind || "external_capability_discovery_registry", 160),
    authScope: boundedString(source.authScope || "unknown", 120),
    networkScope: boundedString(source.networkScope || "unknown", 120),
    schemaDigest: boundedString(source.schemaDigest || source.toolSchemaDigest || source.resourceTemplateDigest, 180),
    evidenceRefs: normalizeEvidenceRefs(source.evidenceRefs, "mcp_external_source_provenance"),
    rawDescriptorIncluded: false,
    rawSchemaIncluded: false,
    rawSecretIncluded: false,
  };
  provenance.provenanceId = provenance.provenanceId || `mcp_source_${digestFor("mcp-source-provenance-source@1", provenance).slice(0, 24)}`;
  provenance.provenanceDigest = digestFor("mcp-external-source-provenance@1", provenance);
  return provenance;
}

function buildMcpResourceReadBoundary(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const uri = normalizeString(source.uri || source.resourceUri, "");
  const state = normalizeEnum(source.state || source.resourceReadState, RESOURCE_READ_STATES, "blocked");
  const provenance = buildMcpExternalSourceProvenance(source.provenance || source);
  const boundary = {
    schema: MCP_RESOURCE_READ_BOUNDARY_SCHEMA,
    boundaryId: boundedString(source.boundaryId || source.requestId, 180),
    projectId: boundedString(source.projectId, 160),
    workThreadId: boundedString(source.workThreadId, 160),
    threadId: boundedString(source.threadId, 160),
    turnId: boundedString(source.turnId, 160),
    requestSource: normalizeEnum(source.requestSource, REQUEST_SOURCES, "unknown"),
    resourceUriDigest: uri ? digestFor("mcp-resource-uri@1", uri) : "",
    resourceUriDisplay: displayUriFor(uri),
    serverIdentity: provenance.serverIdentity,
    sourceProvenance: provenance,
    resourceTemplateDigest: boundedString(source.resourceTemplateDigest || provenance.schemaDigest, 180),
    state,
    externalSideEffectClass: "external_read",
    resultTrustLevel: normalizeEnum(source.resultTrustLevel, RESULT_TRUST_LEVELS, "not_read"),
    contextVisibility: "external_evidence_ref",
    evidenceRefs: normalizeEvidenceRefs(source.evidenceRefs, "mcp_resource_read_boundary"),
    requiredFutureGates: [
      "server_identity_gate",
      "resource_uri_policy",
      "human_approval",
      "external_evidence_staging",
      "raw_payload_redaction",
    ],
    requestAcceptedForExecution: false,
    resourceReadAllowed: false,
    providerDeclarationAllowed: false,
    providerTransportAllowed: false,
    dynamicToolCallAllowed: false,
    workspaceMutationAllowed: false,
    contextInjectionAllowed: false,
    rawUriIncluded: false,
    rawResourcePayloadIncluded: false,
    rawSchemaIncluded: false,
    rawSecretIncluded: false,
    createdAt: normalizeString(source.createdAt, nowIso(source.nowMs)),
  };
  boundary.boundaryId = boundary.boundaryId || `mcp_resource_read_${digestFor("mcp-resource-read-boundary-source@1", boundary).slice(0, 24)}`;
  boundary.boundaryDigest = digestFor("mcp-resource-read-boundary@1", boundary);
  return boundary;
}

function buildMcpDynamicToolCallBoundary(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const toolName = boundedString(source.toolName || source.name || "unknown", 160);
  const inputShape = isPlainObject(source.inputShape) ? source.inputShape : {};
  const provenance = buildMcpExternalSourceProvenance(source.provenance || source);
  const boundary = {
    schema: MCP_DYNAMIC_TOOL_CALL_BOUNDARY_SCHEMA,
    boundaryId: boundedString(source.boundaryId || source.requestId, 180),
    projectId: boundedString(source.projectId, 160),
    workThreadId: boundedString(source.workThreadId, 160),
    threadId: boundedString(source.threadId, 160),
    turnId: boundedString(source.turnId, 160),
    requestSource: normalizeEnum(source.requestSource, REQUEST_SOURCES, "unknown"),
    toolName,
    toolNameDigest: digestFor("mcp-dynamic-tool-name@1", toolName),
    toolSchemaDigest: boundedString(source.toolSchemaDigest || provenance.schemaDigest, 180),
    inputShapeDigest: digestFor("mcp-dynamic-tool-input-shape@1", inputShape),
    serverIdentity: provenance.serverIdentity,
    sourceProvenance: provenance,
    state: normalizeEnum(source.state || source.dynamicCallState, DYNAMIC_CALL_STATES, "blocked"),
    externalSideEffectClass: normalizeEnum(source.externalSideEffectClass, SIDE_EFFECT_CLASSES, "external_action"),
    resultTrustLevel: normalizeEnum(source.resultTrustLevel, RESULT_TRUST_LEVELS, "untrusted_external"),
    contextVisibility: "external_evidence_ref",
    evidenceRefs: normalizeEvidenceRefs(source.evidenceRefs, "mcp_dynamic_tool_call_boundary"),
    requiredFutureGates: [
      "server_identity_gate",
      "schema_digest_gate",
      "permission_class_gate",
      "side_effect_class_gate",
      "human_approval",
      "bounded_result_envelope",
    ],
    requestAcceptedForExecution: false,
    externalActionAllowed: false,
    resourceReadAllowed: false,
    providerDeclarationAllowed: false,
    providerTransportAllowed: false,
    workspaceMutationAllowed: false,
    contextInjectionAllowed: false,
    rawInputIncluded: false,
    rawOutputIncluded: false,
    rawSchemaIncluded: false,
    rawSecretIncluded: false,
    createdAt: normalizeString(source.createdAt, nowIso(source.nowMs)),
  };
  boundary.boundaryId = boundary.boundaryId || `mcp_dynamic_tool_${digestFor("mcp-dynamic-tool-boundary-source@1", boundary).slice(0, 24)}`;
  boundary.boundaryDigest = digestFor("mcp-dynamic-tool-call-boundary@1", boundary);
  return boundary;
}

function buildMcpResourceToolBoundaryStatus(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const resourceReadBoundaries = (Array.isArray(source.resourceReadBoundaries) ? source.resourceReadBoundaries : [])
    .map((boundary) => boundary?.schema === MCP_RESOURCE_READ_BOUNDARY_SCHEMA ? boundary : buildMcpResourceReadBoundary(boundary));
  const dynamicToolCallBoundaries = (Array.isArray(source.dynamicToolCallBoundaries) ? source.dynamicToolCallBoundaries : [])
    .map((boundary) => boundary?.schema === MCP_DYNAMIC_TOOL_CALL_BOUNDARY_SCHEMA ? boundary : buildMcpDynamicToolCallBoundary(boundary));
  const status = {
    schema: MCP_RESOURCE_TOOL_BOUNDARY_STATUS_SCHEMA,
    statusId: boundedString(source.statusId || "", 180),
    projectId: boundedString(source.projectId, 160),
    workThreadId: boundedString(source.workThreadId, 160),
    status: boundedString(source.status || "boundary_scaffold_only", 120),
    resourceReadBoundaryCount: resourceReadBoundaries.length,
    dynamicToolCallBoundaryCount: dynamicToolCallBoundaries.length,
    blockedResourceReadCount: resourceReadBoundaries.filter((boundary) => boundary.state === "blocked").length,
    blockedDynamicToolCallCount: dynamicToolCallBoundaries.filter((boundary) => boundary.state === "blocked").length,
    sourceServerCount: new Set([
      ...resourceReadBoundaries.map((boundary) => boundary.serverIdentity),
      ...dynamicToolCallBoundaries.map((boundary) => boundary.serverIdentity),
    ].filter(Boolean)).size,
    resourceReadBoundaries,
    dynamicToolCallBoundaries,
    externalSideEffectClasses: [...new Set([
      ...resourceReadBoundaries.map((boundary) => boundary.externalSideEffectClass),
      ...dynamicToolCallBoundaries.map((boundary) => boundary.externalSideEffectClass),
    ])].sort(),
    requestAcceptedForExecution: false,
    resourceReadAllowed: false,
    dynamicToolCallAllowed: false,
    externalActionAllowed: false,
    providerDeclarationAllowed: false,
    providerTransportAllowed: false,
    workspaceMutationAllowed: false,
    contextInjectionAllowed: false,
    rawUriIncluded: false,
    rawPayloadIncluded: false,
    rawSchemaIncluded: false,
    rawSecretIncluded: false,
    rendererSafeSummary: "MCP resource reads and dynamic tool calls are boundary-scaffolded only; no external read/action is executed or injected as context.",
    generatedAt: normalizeString(source.generatedAt, nowIso(source.nowMs)),
  };
  status.statusId = status.statusId || `mcp_boundary_status_${digestFor("mcp-resource-tool-boundary-status-source@1", status).slice(0, 24)}`;
  status.statusDigest = digestFor("mcp-resource-tool-boundary-status@1", status);
  return status;
}

function assertMcpResourceToolBoundarySafe(status = {}) {
  if (!isPlainObject(status) || status.schema !== MCP_RESOURCE_TOOL_BOUNDARY_STATUS_SCHEMA) {
    throw new Error("mcp_resource_tool_boundary_status_schema_mismatch");
  }
  for (const flag of [
    "requestAcceptedForExecution",
    "resourceReadAllowed",
    "dynamicToolCallAllowed",
    "externalActionAllowed",
    "providerDeclarationAllowed",
    "providerTransportAllowed",
    "workspaceMutationAllowed",
    "contextInjectionAllowed",
    "rawUriIncluded",
    "rawPayloadIncluded",
    "rawSchemaIncluded",
    "rawSecretIncluded",
  ]) {
    if (status[flag] !== false) throw new Error(`mcp_resource_tool_boundary_authority_leak:${flag}`);
  }
  for (const boundary of [...arrayOrEmpty(status.resourceReadBoundaries), ...arrayOrEmpty(status.dynamicToolCallBoundaries)]) {
    for (const flag of [
      "requestAcceptedForExecution",
      "resourceReadAllowed",
      "providerDeclarationAllowed",
      "providerTransportAllowed",
      "workspaceMutationAllowed",
      "contextInjectionAllowed",
      "rawSchemaIncluded",
      "rawSecretIncluded",
    ]) {
      if (boundary[flag] !== false) throw new Error(`mcp_boundary_authority_leak:${boundary.boundaryId || "unknown"}:${flag}`);
    }
    if (boundary.schema === MCP_RESOURCE_READ_BOUNDARY_SCHEMA && boundary.rawResourcePayloadIncluded !== false) {
      throw new Error(`mcp_resource_read_raw_payload:${boundary.boundaryId || "unknown"}`);
    }
    if (boundary.schema === MCP_DYNAMIC_TOOL_CALL_BOUNDARY_SCHEMA) {
      for (const flag of ["externalActionAllowed", "rawInputIncluded", "rawOutputIncluded"]) {
        if (boundary[flag] !== false) throw new Error(`mcp_dynamic_tool_authority_leak:${boundary.boundaryId || "unknown"}:${flag}`);
      }
    }
  }
  return true;
}

module.exports = {
  MCP_DYNAMIC_TOOL_CALL_BOUNDARY_SCHEMA,
  MCP_EXTERNAL_SOURCE_PROVENANCE_SCHEMA,
  MCP_RESOURCE_READ_BOUNDARY_SCHEMA,
  MCP_RESOURCE_TOOL_BOUNDARY_STATUS_SCHEMA,
  buildMcpDynamicToolCallBoundary,
  buildMcpExternalSourceProvenance,
  buildMcpResourceReadBoundary,
  buildMcpResourceToolBoundaryStatus,
  assertMcpResourceToolBoundarySafe,
};
