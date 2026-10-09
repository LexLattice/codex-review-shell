"use strict";

const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const {
  DEFAULT_MCP_TIMEOUT_MS,
  MAX_MCP_TIMEOUT_MS,
  MCP_TOOL_CALL_TIMEOUT_MS,
  McpSessionPool,
  mcpServerEnvironment,
  requestMcpStdio,
} = require("./mcp-stdio-transport");

// This host's own long-lived MCP servers (see McpSessionPool).
const hostMcpSessions = new McpSessionPool();
const { EXECUTOR_MCP_EVENTS, EXECUTOR_METHODS } = require("../../../shared/executor-protocol");
const { LocalChildProcessBackend } = require("../tools/exec-process-backends");
const { workspaceExecutesLocally } = require("../tools/exec-sandbox");
const { spawnInLinuxPidNamespace } = require("../../../shared/linux-pid-namespace");

const MAX_DISCOVERY_RESULTS = 100;
const MAX_DISCOVERY_BYTES = 512 * 1024;
const MAX_MCP_BLOB_ENCODED_BYTES = 120_000;
const MAX_MCP_BLOB_DECODED_BYTES = 90_000;
const MAX_MCP_SCHEMA_DEPTH = 8;
const MAX_MCP_SCHEMA_NODES = 256;
const MAX_MCP_SCHEMA_ARRAY_ITEMS = 64;
const MAX_MCP_SCHEMA_STRING_BYTES = 4_096;
const MAX_MCP_SCHEMA_ENCODED_BYTES = 64 * 1024;
// Extra time the host allows an executor beyond the server's own timeout.
const MCP_EXECUTOR_TRANSPORT_GRACE_MS = 5_000;
// With an owner to answer forms, the host's own deadline (paused while the
// owner answers) bounds the request; the transport only needs an outer cap.
const MCP_EXECUTOR_ELICITATION_TRANSPORT_MS = 24 * 60 * 60_000;
const MCP_PLACEMENT_KINDS = new Set(["project", "host", "local", "wsl", "windows"]);

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
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function boundedBlob(value) {
  if (typeof value !== "string") return undefined;
  const encodedBytes = Buffer.byteLength(value, "utf8");
  if (encodedBytes > MAX_MCP_BLOB_ENCODED_BYTES) {
    throw scopeError("direct_mcp_blob_too_large", "Configured MCP blob exceeded the bounded encoded-size limit.");
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 === 1) {
    throw scopeError("direct_mcp_blob_invalid", "Configured MCP returned an invalid base64 blob.");
  }
  const decodedBytes = Buffer.from(value, "base64").byteLength;
  if (decodedBytes > MAX_MCP_BLOB_DECODED_BYTES) {
    throw scopeError("direct_mcp_blob_too_large", "Configured MCP blob exceeded the bounded decoded-size limit.");
  }
  return value;
}

function sanitizeInputSchema(schema) {
  let nodes = 0;
  let encodedBytes = 2;
  const active = new WeakSet();
  const addBytes = (value) => {
    encodedBytes += Number(value) || 0;
    if (encodedBytes > MAX_MCP_SCHEMA_ENCODED_BYTES) {
      throw scopeError("direct_mcp_input_schema_too_large", "Configured MCP input schema exceeded its aggregate encoded-size limit.");
    }
  };
  const visit = (value, depth) => {
    if (depth > MAX_MCP_SCHEMA_DEPTH) {
      throw scopeError("direct_mcp_input_schema_too_deep", "Configured MCP input schema exceeded its nesting limit.");
    }
    nodes += 1;
    if (nodes > MAX_MCP_SCHEMA_NODES) {
      throw scopeError("direct_mcp_input_schema_too_complex", "Configured MCP input schema exceeded its node limit.");
    }
    if (value === null || typeof value === "boolean") {
      addBytes(5);
      return value;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw scopeError("direct_mcp_input_schema_invalid", "Configured MCP input schema contains a non-finite number.");
      addBytes(24);
      return value;
    }
    if (typeof value === "string") {
      const size = Buffer.byteLength(value, "utf8");
      if (size > MAX_MCP_SCHEMA_STRING_BYTES) {
        throw scopeError("direct_mcp_input_schema_string_too_large", "Configured MCP input schema contains an oversized string.");
      }
      addBytes(size + 2);
      return value;
    }
    if (Array.isArray(value)) {
      if (value.length > MAX_MCP_SCHEMA_ARRAY_ITEMS) {
        throw scopeError("direct_mcp_input_schema_array_too_large", "Configured MCP input schema contains an oversized array.");
      }
      addBytes(2);
      return value.map((entry) => visit(entry, depth + 1));
    }
    if (!isPlainObject(value)) throw scopeError("direct_mcp_input_schema_invalid", "Configured MCP input schema contains a non-JSON value.");
    if (active.has(value)) throw scopeError("direct_mcp_input_schema_invalid", "Configured MCP input schema contains a cycle.");
    active.add(value);
    const result = {};
    addBytes(2);
    for (const key of Object.keys(value)) {
      const keyBytes = Buffer.byteLength(key, "utf8");
      if (keyBytes > MAX_MCP_SCHEMA_STRING_BYTES) {
        throw scopeError("direct_mcp_input_schema_string_too_large", "Configured MCP input schema contains an oversized property name.");
      }
      addBytes(keyBytes + 3);
      Object.defineProperty(result, key, {
        value: visit(value[key], depth + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    active.delete(value);
    return result;
  };
  const sanitized = visit(schema, 0);
  const actualEncodedBytes = Buffer.byteLength(JSON.stringify(sanitized), "utf8");
  if (actualEncodedBytes > MAX_MCP_SCHEMA_ENCODED_BYTES) {
    throw scopeError("direct_mcp_input_schema_too_large", "Configured MCP input schema exceeded its aggregate encoded-size limit.");
  }
  return sanitized;
}

function appendDiscoveryRows(rows, additions, state) {
  for (const row of additions) {
    const encodedBytes = Buffer.byteLength(JSON.stringify(row), "utf8");
    state.bytes += encodedBytes;
    if (state.bytes > MAX_DISCOVERY_BYTES) {
      throw scopeError("direct_mcp_discovery_too_large", "Configured MCP discovery exceeded its aggregate bounded output limit.");
    }
    rows.push(row);
  }
}

function sanitizeContentEntry(entry = {}) {
  if (!isPlainObject(entry)) return { type: "text", text: boundedString(entry, 120_000) };
  return {
    type: normalizeString(entry.type, "text"),
    text: typeof entry.text === "string" ? entry.text.slice(0, 120_000) : undefined,
    data: typeof entry.data === "string" ? entry.data.slice(0, 120_000) : undefined,
    blob: boundedBlob(entry.blob),
    mimeType: boundedString(entry.mimeType, 120),
  };
}

function sanitizeDescriptor(entry = {}, fallbackKind = "mcp_resource") {
  const source = isPlainObject(entry) ? entry : {};
  const sourceKind = normalizeString(source.sourceKind || source.kind, fallbackKind);
  return {
    sourceKind,
    name: boundedString(source.name || source.displayName || source.title, 180),
    description: boundedString(source.description, 360),
    uri: boundedString(source.uri || source.resourceUri || source.templateUri || source.uriTemplate, 640),
    uriTemplate: boundedString(source.uriTemplate || source.templateUri, 640),
    mimeType: boundedString(source.mimeType, 120),
    serverIdentityId: boundedString(source.serverIdentityId || source.serverId, 180),
    inputSchema: Object.hasOwn(source, "inputSchema") ? sanitizeInputSchema(source.inputSchema) : undefined,
    permissionClass: boundedString(source.permissionClass, 120),
    externalSideEffectClass: boundedString(source.externalSideEffectClass, 120),
    requiresOwnerApproval: source.requiresOwnerApproval === true,
    ...(isPlainObject(source.annotations) ? { annotations: toolAnnotations(source.annotations) } : {}),
  };
}

// MCP tool annotations (hints only; Codex's approval rule reads them).
function toolAnnotations(value) {
  if (!isPlainObject(value)) return undefined;
  const out = {};
  for (const key of ["readOnlyHint", "destructiveHint", "openWorldHint", "idempotentHint"]) {
    if (typeof value[key] === "boolean") out[key] = value[key];
  }
  if (typeof value.title === "string") out.title = boundedString(value.title, 180);
  return out;
}

function normalizeConfiguredMcpServer(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const serverIdentityId = boundedString(source.serverIdentityId || source.id || source.name, 180);
  if (!serverIdentityId) return null;
  const transportKind = normalizeString(source.transportKind || source.transport, "stdio").toLowerCase();
  const lifecycle = isPlainObject(source.currentness) ? source.currentness : {};
  const enabledState = normalizeString(source.enabledState || lifecycle.enabledState, source.enabled === false ? "disabled" : "enabled");
  const freshness = normalizeString(source.freshness || lifecycle.freshness, "fresh");
  const trustState = normalizeString(source.trustState || lifecycle.trustState, "configured");
  const args = arrayOrEmpty(source.args).map((value) => boundedString(value, 16_000)).filter(Boolean);
  const environment = isPlainObject(source.environment) ? source.environment : {};
  const allowedTaskIds = arrayOrEmpty(source.allowedTaskIds || source.taskIds)
    .map((value) => boundedString(value, 180))
    .filter(Boolean);
  const resources = arrayOrEmpty(source.resources).map((entry) => sanitizeDescriptor(entry, "mcp_resource")).filter((entry) => entry.uri || entry.name);
  const resourceTemplates = arrayOrEmpty(source.resourceTemplates || source.templates)
    .map((entry) => sanitizeDescriptor(entry, "mcp_resource_template"))
    .filter((entry) => entry.uriTemplate || entry.uri || entry.name);
  const tools = arrayOrEmpty(source.tools)
    .map((entry) => sanitizeDescriptor(entry, "mcp_tool"))
    .filter((entry) => entry.name);
  const resourceContents = arrayOrEmpty(source.resourceContents || source.contents)
    .map((entry) => {
      const item = isPlainObject(entry) ? entry : {};
      return {
        uri: boundedString(item.uri || item.resourceUri, 640),
        mimeType: boundedString(item.mimeType, 120),
        text: typeof item.text === "string" ? item.text : "",
        blob: boundedBlob(item.blob),
        content: arrayOrEmpty(item.content).slice(0, 32).map((content) => sanitizeContentEntry(content)),
        status: boundedString(item.status, 80),
      };
    })
    .filter((entry) => entry.uri);
  const approvalModes = new Set(["auto", "prompt", "writes", "approve"]);
  const stringMapOf = (value, keyPattern) => Object.freeze(Object.fromEntries(
    Object.entries(isPlainObject(value) ? value : {})
      .filter(([key, entry]) => keyPattern.test(key) && typeof entry === "string" && entry.length <= 16_000)
      .slice(0, 64),
  ));
  const toolList = (value) => (Array.isArray(value) ? Object.freeze(value.map((entry) => boundedString(entry, 180)).filter(Boolean)) : null);
  return Object.freeze({
    serverIdentityId,
    displayName: boundedString(source.displayName || source.serverName || source.name, 180),
    selectorKey: boundedString(source.selectorKey || serverIdentityId, 180),
    transportKind: transportKind === "http" || transportKind === "streamable-http" ? "streamable_http" : transportKind,
    // Where the definition came from: Direct's project settings, or Codex's
    // config.toml in the project's environment (read live, never saved).
    source: boundedString(source.source, 40) || "direct",
    // Literal variables for a stdio server (Codex's `env`), and the URL and
    // headers of a streamable HTTP server. Kept in memory and passed to the
    // server only; never shown to the renderer or the model.
    envValues: stringMapOf(source.envValues || source.envLiteral, /^[A-Za-z_][A-Za-z0-9_]*$/),
    url: boundedString(source.url, 2_000),
    headers: stringMapOf(source.headers, /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/),
    startupTimeoutMs: Number.isFinite(source.startupTimeoutMs) && source.startupTimeoutMs > 0 ? Math.min(source.startupTimeoutMs, 300_000) : 0,
    toolTimeoutMs: Number.isFinite(source.toolTimeoutMs) && source.toolTimeoutMs > 0 ? Math.min(source.toolTimeoutMs, 300_000) : 0,
    enabledTools: toolList(source.enabledTools),
    disabledTools: toolList(source.disabledTools) || Object.freeze([]),
    defaultToolsApprovalMode: approvalModes.has(source.defaultToolsApprovalMode) ? source.defaultToolsApprovalMode : "auto",
    toolApprovalModes: Object.freeze(Object.fromEntries(Object.entries(isPlainObject(source.toolApprovalModes) ? source.toolApprovalModes : {})
      .filter(([, mode]) => approvalModes.has(mode)))),
    supportsParallelToolCalls: source.supportsParallelToolCalls === true,
    command: boundedString(source.command || source.binary || source.executable, 640),
    args,
    cwd: boundedString(source.cwd || source.workingDirectory, 2_000),
    environmentId: boundedString(source.environmentId || source.executionEnvironmentId, 180),
    projectId: boundedString(source.projectId, 180),
    workThreadId: boundedString(source.workThreadId, 180),
    enabledState,
    freshness,
    trustState,
    authPosture: boundedString(source.authPosture, 120),
    endpointEvidenceKey: boundedString(source.endpointEvidenceKey, 180),
    credentialEvidenceKey: boundedString(source.credentialEvidenceKey, 180),
    allowedTaskIds,
    resources,
    resourceTemplates,
    tools,
    resourceContents,
    processEnv: Object.freeze(arrayOrEmpty(environment.processEnv || source.processEnv)
      .map((value) => boundedString(value, 120))
      .filter((value) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value))),
    runsIn: normalizeRunsIn(source.runsIn || {
      kind: source.environmentKind || environment.kind,
      distro: source.distro || environment.distro,
    }),
  });
}

/**
 * Where a configured server's process runs. "project" (the default) is the
 * project's own environment, the way Codex runs MCP servers where the agent
 * runs; "host" is the Direct host itself; "wsl" (with a distro) and
 * "windows" name an environment explicitly.
 */
function normalizeRunsIn(input) {
  const source = typeof input === "string" ? { kind: input } : isPlainObject(input) ? input : {};
  const requested = normalizeString(source.kind, "project").toLowerCase();
  const kind = MCP_PLACEMENT_KINDS.has(requested) ? (requested === "local" ? "host" : requested) : "project";
  return Object.freeze({ kind, distro: kind === "wsl" ? boundedString(source.distro, 120) : "" });
}

// Servers from Codex's config.toml in each project's environment, as last
// read (see codex-context-service.js), by project id.
const codexConfigServers = new Map();

function codexServerIdentityId(name) {
  return `codex_${String(name).replace(/[^A-Za-z0-9_-]/g, "_")}`.slice(0, 180);
}

// A Codex [mcp_servers.<name>] entry as a Direct server: it runs where the
// project runs (Codex runs servers where the agent runs).
function configuredFromCodexServer(server = {}) {
  return {
    serverIdentityId: codexServerIdentityId(server.name),
    displayName: server.name,
    source: "codex_config",
    transport: server.transport === "streamable_http" ? "streamable_http" : "stdio",
    command: server.command || "",
    args: server.args || [],
    cwd: server.cwd || "",
    processEnv: server.envVars || [],
    envValues: server.env || {},
    url: server.url || "",
    headers: server.headers || {},
    enabled: server.enabled !== false && !server.unavailable,
    trustState: "configured",
    freshness: "fresh",
    authPosture: "local_config",
    startupTimeoutMs: server.startupTimeoutMs,
    toolTimeoutMs: server.toolTimeoutMs,
    enabledTools: server.enabledTools,
    disabledTools: server.disabledTools,
    defaultToolsApprovalMode: server.defaultToolsApprovalMode,
    toolApprovalModes: server.toolApprovalModes,
    supportsParallelToolCalls: server.supportsParallelToolCalls,
    runsIn: { kind: "project" },
  };
}

function setCodexMcpServersForProject(projectId, servers = []) {
  const id = normalizeString(projectId, "");
  if (!id) return;
  codexConfigServers.set(id, Object.freeze(arrayOrEmpty(servers).map(configuredFromCodexServer)));
}

function configuredMcpServersForProject(project = {}) {
  const sources = [
    project.mcpServers,
    project.mcp?.servers,
    project.codex?.mcpServers,
    project.surfaceBinding?.codex?.mcpServers,
    codexConfigServers.get(normalizeString(project.id || project.projectId, "")),
  ];
  // The owner's per-project switch, for Direct's servers and Codex's alike.
  const settings = isPlainObject(project.mcpServerSettings) ? project.mcpServerSettings : {};
  const result = [];
  const seen = new Set();
  for (const source of sources) {
    for (const entry of arrayOrEmpty(source)) {
      const id = normalizeString(entry?.serverIdentityId || entry?.id || entry?.name, "");
      const override = isPlainObject(settings[id]) ? settings[id] : null;
      const normalized = normalizeConfiguredMcpServer(override && typeof override.enabled === "boolean" && override.enabled === false
        ? { ...entry, enabledState: "disabled" }
        : entry);
      if (!normalized || seen.has(normalized.serverIdentityId)) continue;
      seen.add(normalized.serverIdentityId);
      result.push(normalized);
    }
  }
  return result;
}

function configuredMcpServerIdentityInput(server = {}) {
  return {
    serverIdentityId: server.serverIdentityId,
    displayName: server.displayName,
    selectorKey: server.selectorKey,
    transportKind: server.transportKind,
    authPosture: server.authPosture || (server.command || server.transportKind === "fixture" ? "local_config" : "unavailable"),
    trustState: server.trustState,
    enabledState: server.enabledState,
    freshness: server.freshness,
    endpointEvidenceKey: server.endpointEvidenceKey || `mcp_endpoint_${sha256(server.serverIdentityId).slice(0, 24)}`,
    credentialEvidenceKey: server.credentialEvidenceKey || `mcp_credential_${sha256(server.serverIdentityId).slice(0, 24)}`,
  };
}

function scopeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function projectIdFor(input = {}) {
  return normalizeString(input.projectId || input.project?.id || input.project?.projectId || input.project?.name, "");
}

function workThreadIdFor(input = {}) {
  return normalizeString(input.workThreadId || input.project?.workThreadId, "");
}

function assertExactScope(input = {}, profile = {}) {
  const projectId = projectIdFor(input);
  const workThreadId = workThreadIdFor(input);
  const threadId = normalizeString(input.threadId || input.taskId, "");
  if (!projectId || !threadId) throw scopeError("direct_mcp_scope_missing", "Configured MCP access requires an exact project and task binding.");
  if (input.project?.id && normalizeString(input.project.id, "") !== projectId) {
    throw scopeError("direct_mcp_project_scope_mismatch", "Configured MCP project scope does not match the active project.");
  }
  if (input.project?.workThreadId && normalizeString(input.project.workThreadId, "") !== workThreadId) {
    throw scopeError("direct_mcp_work_thread_scope_mismatch", "Configured MCP work-thread scope does not match the active work thread.");
  }
  if (profile?.projectId && normalizeString(profile.projectId, "") !== projectId) {
    throw scopeError("direct_mcp_profile_project_scope_mismatch", "Configured MCP profile project scope is stale or foreign.");
  }
  if (profile?.workThreadId && workThreadId && normalizeString(profile.workThreadId, "") !== workThreadId) {
    throw scopeError("direct_mcp_profile_work_thread_scope_mismatch", "Configured MCP profile work-thread scope is stale or foreign.");
  }
  const allowedTaskIds = arrayOrEmpty(input.project?.mcpAllowedTaskIds);
  if (allowedTaskIds.length && !allowedTaskIds.includes(threadId)) {
    throw scopeError("direct_mcp_task_scope_mismatch", "Configured MCP server is not admitted for this task.");
  }
  return { projectId, workThreadId, threadId };
}

function serverFor(input = {}, profile = {}, serverIdentityId = "") {
  const servers = configuredMcpServersForProject(input.project || {});
  const configured = servers.find((server) => server.serverIdentityId === serverIdentityId);
  const witnessed = arrayOrEmpty(profile.serverIdentities).find((server) => server.serverIdentityId === serverIdentityId);
  if (!configured || !witnessed) throw scopeError("direct_mcp_server_not_configured", "The selected MCP server is not configured for this project.");
  if (configured.enabledState !== witnessed.enabledState || configured.freshness !== witnessed.freshness || configured.trustState !== witnessed.trustState) {
    throw scopeError("direct_mcp_server_identity_stale", "The configured MCP server identity is stale or substituted.");
  }
  if (configured.projectId && configured.projectId !== projectIdFor(input)) {
    throw scopeError("direct_mcp_server_project_scope_mismatch", "The configured MCP server belongs to another project.");
  }
  if (configured.workThreadId && configured.workThreadId !== workThreadIdFor(input)) {
    throw scopeError("direct_mcp_server_work_thread_scope_mismatch", "The configured MCP server belongs to another work thread.");
  }
  const allowedTaskIds = configured.allowedTaskIds;
  if (allowedTaskIds.length && !allowedTaskIds.includes(normalizeString(input.threadId || input.taskId, ""))) {
    throw scopeError("direct_mcp_server_task_scope_mismatch", "The configured MCP server is not admitted for this task.");
  }
  if (configured.enabledState !== "enabled" || configured.freshness !== "fresh" || ["unknown", "untrusted"].includes(configured.trustState)) {
    throw scopeError("direct_mcp_server_not_current", "The selected MCP server is not current and trusted.");
  }
  return { configured, witnessed };
}

function descriptorRows(server, serverIdentityId) {
  return [
    ...server.resources.map((entry) => ({ ...entry, serverIdentityId, sourceKind: "mcp_resource" })),
    ...server.resourceTemplates.map((entry) => ({ ...entry, serverIdentityId, sourceKind: "mcp_resource_template" })),
    ...server.tools.map((entry) => ({ ...entry, serverIdentityId, sourceKind: "mcp_tool" })),
  ];
}

function resultScope(input = {}, profileDigest = "") {
  const scope = assertExactScope(input, input.profile || {});
  return {
    projectId: scope.projectId,
    workThreadId: scope.workThreadId,
    threadId: scope.threadId,
    profileDigest,
  };
}

function resultEntries(result = {}, key) {
  return arrayOrEmpty(result[key]).slice(0, MAX_DISCOVERY_RESULTS).map((entry) => sanitizeDescriptor(entry));
}

function validateResourceResultUris(result = {}, requestedUri = "") {
  const candidates = [];
  const collect = (value, label) => {
    if (typeof value !== "string" || !value.trim() || value.length > 640 || value.trim() !== value) {
      throw scopeError("direct_mcp_resource_result_scope_mismatch", `Configured MCP returned a malformed ${label}.`);
    }
    candidates.push(value);
  };
  if (!isPlainObject(result)) return;
  if (Object.hasOwn(result, "uri")) collect(result.uri, "resource URI");
  if (Object.hasOwn(result, "resourceUri")) collect(result.resourceUri, "resource URI");
  if (isPlainObject(result.resource)) {
    if (Object.hasOwn(result.resource, "uri")) collect(result.resource.uri, "resource URI");
    if (Object.hasOwn(result.resource, "resourceUri")) collect(result.resource.resourceUri, "resource URI");
  }
  for (const [key, entries] of [["contents", result.contents], ["content", result.content]]) {
    for (const [index, entry] of arrayOrEmpty(entries).entries()) {
      if (!isPlainObject(entry)) continue;
      if (Object.hasOwn(entry, "uri")) collect(entry.uri, `${key} URI at index ${index}`);
      if (Object.hasOwn(entry, "resourceUri")) collect(entry.resourceUri, `${key} URI at index ${index}`);
      if (isPlainObject(entry.resource)) {
        if (Object.hasOwn(entry.resource, "uri")) collect(entry.resource.uri, `${key} resource URI at index ${index}`);
        if (Object.hasOwn(entry.resource, "resourceUri")) collect(entry.resource.resourceUri, `${key} resource URI at index ${index}`);
      }
    }
  }
  if (candidates.some((value) => value !== requestedUri)) {
    throw scopeError("direct_mcp_resource_result_scope_mismatch", "Configured MCP returned a resource from a different URI.");
  }
}

function externalResultPayload(result = {}) {
  const contents = arrayOrEmpty(result.contents || result.content).slice(0, 32).map((entry) => sanitizeContentEntry(entry));
  const text = typeof result.text === "string" ? result.text.slice(0, 120_000) : "";
  const blob = boundedBlob(result.blob) || "";
  const contentText = contents
    .filter((entry) => entry.type === "text" && typeof entry.text === "string")
    .map((entry) => entry.text)
    .join("\n")
    .slice(0, 120_000);
  return {
    payload: text || blob || contentText,
    content: contents,
    mimeType: boundedString(result.mimeType || contents[0]?.mimeType, "text/plain"),
    readFreshness: "fresh_external_read",
  };
}

async function queryConfiguredServer(server, method, params, options = {}) {
  if (!["stdio", "fixture", "streamable_http"].includes(server.transportKind)) {
    throw scopeError("direct_mcp_transport_unsupported", "The configured MCP transport is not supported by Direct.");
  }
  // An HTTP server is reached over the network from the host, wherever its
  // definition came from.
  if (server.transportKind === "streamable_http") {
    if (!server.url) throw scopeError("direct_mcp_transport_unavailable", "The configured MCP server has no URL.");
    return (options.mcpSessionPool || hostMcpSessions).request(server, method, params, {
      timeoutMs: options.timeoutMs,
      startupTimeoutMs: server.startupTimeoutMs || undefined,
      signal: options.signal,
      onElicitation: options.onElicitation,
      fetchImpl: options.fetchImpl,
      placementKey: "host",
      identityKey: server.serverIdentityId,
    });
  }
  if (!server.command) {
    if (method === "resources/list") return { resources: server.resources };
    if (method === "resources/templates/list") return { resourceTemplates: server.resourceTemplates };
    if (method === "tools/list") return { tools: server.tools };
    if (method === "resources/read") {
      const uri = normalizeString(params.uri, "");
      const content = server.resourceContents.find((entry) => entry.uri === uri);
      if (!content) throw scopeError("direct_mcp_resource_not_found", "Configured MCP resource was not found.");
      return content;
    }
    throw scopeError("direct_mcp_transport_unavailable", "The configured MCP server has no local transport command.");
  }
  const placement = mcpPlacementFor(server, options.project || {}, options);
  if (placement.local) {
    const transportOptions = {
      timeoutMs: options.timeoutMs,
      startupTimeoutMs: server.startupTimeoutMs || undefined,
      signal: options.signal,
      spawnProcess: spawnOnHost,
      onElicitation: options.onElicitation,
      // Allowlisted names read from this host, plus literal values (Codex's env).
      env: { ...mcpServerEnvironment(server.processEnv || []), ...(server.envValues || {}) },
    };
    if (options.mcpSessions === false) return requestMcpStdio(server, method, params, transportOptions);
    return (options.mcpSessionPool || hostMcpSessions).request(server, method, params, {
      ...transportOptions,
      placementKey: "host",
      identityKey: server.serverIdentityId,
    });
  }
  return requestViaExecutor(placement, server, method, params, options);
}

function environmentLabel(kind) {
  return kind === "wsl" ? "WSL" : kind === "windows" ? "Windows" : kind;
}

/**
 * Resolves where a configured server runs: on this host, in the project's
 * own executor, or (for an explicitly named environment that isn't the
 * project's) in an executor anchored at the server's cwd there.
 */
function mcpPlacementFor(server, project = {}, options = {}) {
  const runsIn = server.runsIn || { kind: "project", distro: "" };
  if (runsIn.kind === "host") return { local: true, kind: "host" };
  const workspace = isPlainObject(project.workspace) ? project.workspace : {};
  const projectKind = normalizeString(workspace.kind, "local");
  const projectDistro = normalizeString(workspace.distro, "");
  const kind = runsIn.kind === "project" ? projectKind : runsIn.kind;
  const distro = runsIn.kind === "project" ? projectDistro : runsIn.distro;
  const locality = typeof options.workspaceLocalityResolver === "function"
    ? options.workspaceLocalityResolver
    : (candidateKind, candidateProject) => workspaceExecutesLocally(candidateKind, candidateProject);
  if (kind === "local" || locality(kind, { workspace: { kind, distro } })) return { local: true, kind };
  const sameDistro = kind !== "wsl" || !distro || !projectDistro || distro.toLowerCase() === projectDistro.toLowerCase();
  if (kind === projectKind && sameDistro) return { local: false, kind, executorProject: project };
  if (!server.cwd) {
    throw scopeError(
      "direct_mcp_environment_root_required",
      `This MCP server runs in ${environmentLabel(kind)}, which is not this project's environment, so its config needs a cwd there.`,
    );
  }
  return {
    local: false,
    kind,
    executorProject: {
      id: `${normalizeString(project.id, "project")}::mcp::${server.serverIdentityId}`,
      name: `MCP ${server.displayName || server.serverIdentityId}`,
      workspace: kind === "wsl" ? { kind, distro, linuxPath: server.cwd } : { kind, windowsPath: server.cwd },
    },
  };
}

let hostProcessBackend = null;

// Host-local servers run contained, so their whole process tree is reaped
// with them: under the job runner on Windows, in a PID namespace on Linux.
function spawnOnHost(command, args, options = {}) {
  if (process.platform === "linux") {
    try {
      return spawnInLinuxPidNamespace(command, args, {
        ...options,
        env: options.env || process.env,
        stdio: ["pipe", "pipe", "pipe"],
        dieWithParent: true,
      });
    } catch (error) {
      // No trusted launcher on this host: run it as before, uncontained.
      if (!String(error?.code || "").startsWith("workspace_linux_pid_namespace_launcher")) throw error;
    }
  }
  if (process.platform !== "win32") {
    const child = spawn(command, args, { ...options, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    child.workspaceProcessContainment = { guaranteed: false, kind: "none" };
    return child;
  }
  hostProcessBackend ||= new LocalChildProcessBackend({ workspaceLocalityResolver: () => true });
  const plan = hostProcessBackend.planLaunch({ sandboxMode: "danger-full-access", command, args });
  return hostProcessBackend.launch(plan, options).child;
}

async function requestViaExecutor(placement, server, method, params, options = {}) {
  const executors = options.mcpExecutors;
  if (!executors || typeof executors.requestForProject !== "function") {
    throw scopeError(
      "direct_mcp_environment_unavailable",
      `This MCP server runs in ${environmentLabel(placement.kind)}, and no executor for that environment is available.`,
    );
  }
  const timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_MCP_TIMEOUT_MS, 100, MAX_MCP_TIMEOUT_MS);
  const mcpRequestId = `mcp_${crypto.randomBytes(12).toString("hex")}`;
  const signal = options.signal;
  const aborted = () => scopeError("direct_mcp_request_aborted", "Configured MCP request was cancelled.");
  if (signal?.aborted) throw aborted();
  const project = placement.executorProject;
  const cancelRemote = () => executors.requestForProject(project, EXECUTOR_METHODS.mcpCancel, { mcpRequestId }, 10_000).catch(() => {});
  let onAbort = null;
  let failRequest = null;
  const abortPromise = new Promise((_, reject) => {
    failRequest = reject;
    onAbort = () => {
      cancelRemote();
      reject(aborted());
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
  // Forms from the server reach the owner through executor events. The
  // host then keeps the deadline itself, stopped while the owner answers
  // (the executor's own clock stops too); the transport just waits.
  const elicitation = typeof options.onElicitation === "function" && typeof executors.ensureForProject === "function";
  let session = null;
  let onEvent = null;
  let deadlineTimer = null;
  let remainingMs = timeoutMs + MCP_EXECUTOR_TRANSPORT_GRACE_MS;
  let deadlineAt = 0;
  const armDeadline = () => {
    deadlineAt = Date.now() + remainingMs;
    deadlineTimer = setTimeout(() => {
      cancelRemote();
      failRequest(scopeError("direct_mcp_request_timeout", "Configured MCP request exceeded the timeout."));
    }, remainingMs);
  };
  if (elicitation) {
    session = await executors.ensureForProject(project);
    const elicitationAborts = new Set();
    let open = 0;
    onEvent = async (event = {}) => {
      if (event.event !== EXECUTOR_MCP_EVENTS.elicitation || event.mcpRequestId !== mcpRequestId) return;
      if (open++ === 0) {
        clearTimeout(deadlineTimer);
        remainingMs = Math.max(100, deadlineAt - Date.now());
      }
      const controller = new AbortController();
      elicitationAborts.add(controller);
      signal?.addEventListener?.("abort", () => controller.abort(), { once: true });
      let answer;
      try {
        answer = await options.onElicitation(isPlainObject(event.params) ? event.params : {}, { signal: controller.signal });
      } catch {
        answer = { action: controller.signal.aborted ? "cancel" : "decline" };
      }
      elicitationAborts.delete(controller);
      if (--open === 0 && !signal?.aborted) armDeadline();
      executors.requestForProject(project, EXECUTOR_METHODS.mcpElicitationRespond, {
        elicitationId: normalizeString(event.elicitationId, ""),
        result: answer,
      }, 10_000).catch(() => {});
    };
    session.on("executor-mcp-event", onEvent);
    armDeadline();
  }
  try {
    // Only the transport crosses: command, args, cwd, and the names of
    // allowlisted variables, whose values come from that environment.
    const response = await Promise.race([
      executors.requestForProject(placement.executorProject, EXECUTOR_METHODS.mcpRequest, {
        mcpRequestId,
        server: {
          transportKind: "stdio",
          command: server.command,
          args: [...server.args],
          cwd: server.cwd,
          processEnv: [...server.processEnv],
          // Literal values (Codex's env); in memory only, for the server.
          envValues: { ...(server.envValues || {}) },
          startupTimeoutMs: server.startupTimeoutMs || undefined,
          // Lets the executor replace this server's session on a config change.
          serverIdentityId: server.serverIdentityId,
        },
        method,
        params,
        timeoutMs,
        ...(elicitation ? { elicitation: true } : {}),
      }, elicitation ? MCP_EXECUTOR_ELICITATION_TRANSPORT_MS : timeoutMs + MCP_EXECUTOR_TRANSPORT_GRACE_MS),
      abortPromise,
    ]);
    return isPlainObject(response?.result) ? response.result : {};
  } finally {
    clearTimeout(deadlineTimer);
    if (session && onEvent) session.removeListener("executor-mcp-event", onEvent);
    signal?.removeEventListener?.("abort", onAbort);
  }
}

// MCP tools a project's current servers offer, for declaring them to the
// model (Codex lists them when a session starts; here each turn asks the
// long-lived servers, which answer quickly). A server that fails to answer
// is left out of this turn rather than failing it.
// Tool lists by server definition: servers are asked together, and a
// listing is reused for a while (a failure for a shorter while), so a slow
// or broken server doesn't hold up every turn.
const toolListCache = new Map();
const TOOL_LIST_TTL_MS = 2 * 60_000;
const TOOL_LIST_FAILURE_TTL_MS = 60_000;

function toolListKey(server, input = {}) {
  const projectKind = normalizeString(input.project?.workspace?.kind, "local");
  return sha256(JSON.stringify([projectKind, normalizeString(input.project?.id, ""), server.serverIdentityId, server.transportKind, server.command, server.args, server.cwd, server.url, Object.keys(server.envValues || {}), Object.keys(server.headers || {})]));
}

async function listedTools(server, input) {
  if (!server.command && !server.url) return { tools: server.tools };
  const key = toolListKey(server, input);
  const cached = toolListCache.get(key);
  if (cached && Date.now() - cached.at < (cached.error ? TOOL_LIST_FAILURE_TTL_MS : TOOL_LIST_TTL_MS)) {
    if (cached.error) throw cached.error;
    return cached.result;
  }
  try {
    const result = await queryConfiguredServer(server, "tools/list", {}, { ...input, timeoutMs: input.listTimeoutMs || 10_000 });
    toolListCache.set(key, { at: Date.now(), result });
    return result;
  } catch (error) {
    toolListCache.set(key, { at: Date.now(), error });
    throw error;
  }
}

async function listConfiguredMcpTools(input = {}) {
  const profile = input.profile || {};
  const scope = assertExactScope(input, profile);
  const servers = [];
  const errors = [];
  const candidates = configuredMcpServersForProject(input.project || {}).map((candidate) => {
    try {
      return serverFor(input, profile, candidate.serverIdentityId).configured;
    } catch {
      return null;
    }
  }).filter(Boolean);
  const listings = await Promise.allSettled(candidates.map((server) => listedTools(server, input)));
  for (const [index, server] of candidates.entries()) {
    try {
      if (listings[index].status === "rejected") throw listings[index].reason;
      const result = listings[index].value;
      // Codex's enabled_tools allow-list, then its disabled_tools deny-list.
      const offered = (name) => (!server.enabledTools || server.enabledTools.includes(name)) && !server.disabledTools.includes(name);
      const tools = arrayOrEmpty(result.tools).slice(0, MAX_DISCOVERY_RESULTS).map((tool) => {
        if (!isPlainObject(tool) || !normalizeString(tool.name, "") || !offered(tool.name)) return null;
        let inputSchema;
        try {
          inputSchema = Object.hasOwn(tool, "inputSchema") ? sanitizeInputSchema(tool.inputSchema) : undefined;
        } catch {
          return null;
        }
        return {
          name: boundedString(tool.name, 180),
          description: typeof tool.description === "string" ? tool.description.slice(0, 2_000) : "",
          inputSchema,
          annotations: toolAnnotations(tool.annotations) || {},
        };
      }).filter(Boolean);
      servers.push({
        serverIdentityId: server.serverIdentityId,
        serverName: server.displayName || server.serverIdentityId,
        tools,
        defaultToolsApprovalMode: server.defaultToolsApprovalMode,
        toolApprovalModes: server.toolApprovalModes,
        supportsParallelToolCalls: server.supportsParallelToolCalls,
      });
    } catch (error) {
      errors.push({ serverIdentityId: server.serverIdentityId, code: normalizeString(error?.code, "direct_mcp_tools_list_failed") });
    }
  }
  return { ...scope, profileDigest: normalizeString(profile.profileDigest, ""), servers, errors };
}

// One MCP tools/call, under the same scope, trust, and placement rules as
// resource reads. Forms the server asks for during the call go to
// `onElicitation`.
async function callConfiguredMcpTool(input = {}) {
  const profile = input.profile || {};
  const scope = assertExactScope(input, profile);
  const serverIdentityId = normalizeString(input.serverIdentityId, "");
  const toolName = normalizeString(input.toolName, "");
  if (!serverIdentityId || !toolName) throw scopeError("direct_mcp_tool_selector_missing", "MCP tool calls require an exact server identity and tool name.");
  const server = serverFor(input, profile, serverIdentityId).configured;
  if (!server.command && !server.url) throw scopeError("direct_mcp_transport_unavailable", "The configured MCP server has no command or URL.");
  const params = { name: toolName };
  if (isPlainObject(input.arguments) && Object.keys(input.arguments).length) params.arguments = input.arguments;
  if (isPlainObject(input.meta)) params._meta = input.meta;
  const result = await queryConfiguredServer(server, "tools/call", params, {
    ...input,
    timeoutMs: input.timeoutMs || server.toolTimeoutMs || MCP_TOOL_CALL_TIMEOUT_MS,
  });
  return { ...scope, profileDigest: normalizeString(profile.profileDigest, ""), serverIdentityId, toolName, result: isPlainObject(result) ? result : {} };
}

async function discoverConfiguredMcp(input = {}) {
  const profile = input.profile || {};
  const scope = assertExactScope(input, profile);
  const toolName = normalizeString(input.toolName, "");
  const args = isPlainObject(input.arguments) ? input.arguments : {};
  const selectedId = normalizeString(args.serverIdentityId || args.serverId, "");
  const configured = configuredMcpServersForProject(input.project || {});
  const servers = selectedId
    ? [serverFor(input, profile, selectedId).configured]
    : configured.map((server) => serverFor(input, profile, server.serverIdentityId).configured);
  if (!servers.length) throw scopeError("direct_mcp_server_missing", "No configured MCP server is available for this project.");
  let rows = [];
  const discoveryBudget = { bytes: 0 };
  for (const server of servers) {
    if (server.enabledState !== "enabled" || server.freshness !== "fresh" || ["unknown", "untrusted"].includes(server.trustState)) continue;
    const serverArgs = { _serverIdentityId: server.serverIdentityId };
    if (toolName === "list_mcp_resources") {
      const result = await queryConfiguredServer(server, "resources/list", serverArgs, input);
      appendDiscoveryRows(rows, resultEntries({ resources: result.resources || server.resources }, "resources").map((row) => ({
        ...row,
        serverIdentityId: server.serverIdentityId,
        sourceKind: "mcp_resource",
      })), discoveryBudget);
    } else if (toolName === "list_mcp_resource_templates") {
      const result = await queryConfiguredServer(server, "resources/templates/list", serverArgs, input);
      appendDiscoveryRows(rows, resultEntries({ resourceTemplates: result.resourceTemplates || server.resourceTemplates }, "resourceTemplates").map((row) => ({ ...row, serverIdentityId: server.serverIdentityId, sourceKind: "mcp_resource_template" })), discoveryBudget);
    } else if (toolName === "tool_search") {
      const [resources, templates, tools] = await Promise.all([
        queryConfiguredServer(server, "resources/list", {}, input),
        queryConfiguredServer(server, "resources/templates/list", {}, input),
        queryConfiguredServer(server, "tools/list", {}, input),
      ]);
      appendDiscoveryRows(rows, [
        ...resultEntries({ resources: resources.resources || server.resources }, "resources").map((row) => ({ ...row, serverIdentityId: server.serverIdentityId, sourceKind: "mcp_resource" })),
        ...resultEntries({ resourceTemplates: templates.resourceTemplates || server.resourceTemplates }, "resourceTemplates").map((row) => ({ ...row, serverIdentityId: server.serverIdentityId, sourceKind: "mcp_resource_template" })),
        ...resultEntries({ tools: tools.tools || server.tools }, "tools").map((row) => ({ ...row, serverIdentityId: server.serverIdentityId, sourceKind: "mcp_tool" })),
      ], discoveryBudget);
    }
  }
  return {
    ...scope,
    profileDigest: normalizeString(profile.profileDigest, ""),
    discoveryBackendAvailable: true,
    discoveryDescriptors: rows.slice(0, MAX_DISCOVERY_RESULTS),
    resourceDescriptors: rows.filter((row) => row.sourceKind === "mcp_resource"),
    resourceTemplateDescriptors: rows.filter((row) => row.sourceKind === "mcp_resource_template"),
    evidenceRefs: rows.slice(0, MAX_DISCOVERY_RESULTS).map((row) => ({
      kind: "mcp_configured_descriptor",
      id: sha256(JSON.stringify(row)).slice(0, 32),
      confidence: "fresh",
    })),
  };
}

async function readConfiguredMcpResource(input = {}) {
  const profile = input.profile || {};
  const scope = assertExactScope(input, profile);
  const args = isPlainObject(input.arguments) ? input.arguments : {};
  const serverIdentityId = normalizeString(args.serverIdentityId || args.serverId, "");
  const resourceUri = normalizeString(args.resourceUri || args.uri, "");
  if (!serverIdentityId || !resourceUri) throw scopeError("direct_mcp_resource_selector_missing", "MCP resource reads require an exact server identity and URI.");
  const server = serverFor(input, profile, serverIdentityId).configured;
  const result = await queryConfiguredServer(server, "resources/read", { uri: resourceUri }, input);
  validateResourceResultUris(result, resourceUri);
  const payload = externalResultPayload(result);
  return {
    ...scope,
    profileDigest: normalizeString(profile.profileDigest, ""),
    ...payload,
    status: "completed",
    sourceObservedAt: new Date().toISOString(),
    evidenceRefs: [{ kind: "mcp_configured_resource_read", id: sha256(`${serverIdentityId}:${resourceUri}:${payload.payload}`).slice(0, 32), confidence: "fresh" }],
  };
}

/**
 * `options.executors` reaches servers that run in another environment; it
 * needs `requestForProject(project, method, params, timeoutMs)`, which the
 * workspace backend manager provides.
 */
function createDirectConfiguredMcpResolvers(options = {}) {
  const withExecutors = (input) => ({
    ...input,
    ...(options.executors ? { mcpExecutors: options.executors } : {}),
    ...(options.mcpSessionPool ? { mcpSessionPool: options.mcpSessionPool } : {}),
    ...(options.mcpSessions === false ? { mcpSessions: false } : {}),
  });
  return Object.freeze({
    externalDiscoveryResolver: (input) => discoverConfiguredMcp(withExecutors(input)),
    mcpResourceReadResolver: (input) => readConfiguredMcpResource(withExecutors(input)),
    mcpToolCatalogResolver: (input) => listConfiguredMcpTools(withExecutors(input)),
    mcpToolCallResolver: (input) => callConfiguredMcpTool(withExecutors(input)),
  });
}

function disposeHostMcpSessions() {
  return hostMcpSessions.dispose();
}

module.exports = {
  callConfiguredMcpTool,
  codexServerIdentityId,
  setCodexMcpServersForProject,
  listConfiguredMcpTools,
  configuredMcpServersForProject,
  disposeHostMcpSessions,
  hostMcpSessions,
  configuredMcpServerIdentityInput,
  createDirectConfiguredMcpResolvers,
  discoverConfiguredMcp,
  mcpPlacementFor,
  normalizeConfiguredMcpServer,
  readConfiguredMcpResource,
};
