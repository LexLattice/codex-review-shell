"use strict";

const { spawn } = require("node:child_process");
const crypto = require("node:crypto");

const MAX_MCP_RESULT_BYTES = 2 * 1024 * 1024;
const MAX_MCP_HEADER_BYTES = 64 * 1024;
const DEFAULT_MCP_TIMEOUT_MS = 15_000;
const MAX_MCP_TIMEOUT_MS = 60_000;
const MAX_DISCOVERY_RESULTS = 100;
const MCP_CHILD_TERM_GRACE_MS = 200;
const MCP_CHILD_CLEANUP_DEADLINE_MS = 2_000;

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
    inputSchema: isPlainObject(source.inputSchema) ? source.inputSchema : undefined,
    permissionClass: boundedString(source.permissionClass, 120),
    externalSideEffectClass: boundedString(source.externalSideEffectClass, 120),
    requiresOwnerApproval: source.requiresOwnerApproval === true,
  };
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
        blob: typeof item.blob === "string" ? item.blob : "",
        content: arrayOrEmpty(item.content).slice(0, 32),
        status: boundedString(item.status, 80),
      };
    })
    .filter((entry) => entry.uri);
  return Object.freeze({
    serverIdentityId,
    displayName: boundedString(source.displayName || source.serverName || source.name, 180),
    selectorKey: boundedString(source.selectorKey || serverIdentityId, 180),
    transportKind,
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
  });
}

function configuredMcpServersForProject(project = {}) {
  const sources = [
    project.mcpServers,
    project.mcp?.servers,
    project.codex?.mcpServers,
    project.surfaceBinding?.codex?.mcpServers,
  ];
  const result = [];
  const seen = new Set();
  for (const source of sources) {
    for (const entry of arrayOrEmpty(source)) {
      const normalized = normalizeConfiguredMcpServer(entry);
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

function externalResultPayload(result = {}) {
  const contents = arrayOrEmpty(result.contents || result.content).slice(0, 32).map((entry) => {
    if (!isPlainObject(entry)) return { type: "text", text: boundedString(entry, 120_000) };
    return {
      type: normalizeString(entry.type, "text"),
      text: typeof entry.text === "string" ? entry.text.slice(0, 120_000) : undefined,
      data: typeof entry.data === "string" ? entry.data.slice(0, 120_000) : undefined,
      mimeType: boundedString(entry.mimeType, 120),
    };
  });
  const text = typeof result.text === "string" ? result.text.slice(0, 120_000) : "";
  const blob = typeof result.blob === "string" ? result.blob.slice(0, 120_000) : "";
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

function lineOrContentLengthParser(onMessage, onError) {
  let buffer = Buffer.alloc(0);
  let failed = false;
  const fail = (error) => {
    if (failed) return;
    failed = true;
    onError(error);
  };
  const contentLengthPrefix = "content-length";
  const startsWithContentLengthPrefix = () => {
    const prefixLength = Math.min(buffer.length, contentLengthPrefix.length);
    if (!prefixLength) return false;
    return buffer.toString("ascii", 0, prefixLength).toLowerCase() === contentLengthPrefix.slice(0, prefixLength);
  };
  return (chunk) => {
    if (failed) return;
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))]);
    if (buffer.length > MAX_MCP_RESULT_BYTES) {
      fail(scopeError("direct_mcp_result_too_large", "Configured MCP result exceeded the bounded output limit."));
      return;
    }
    while (buffer.length) {
      if (startsWithContentLengthPrefix() && buffer.length > MAX_MCP_HEADER_BYTES) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0 || headerEnd > MAX_MCP_HEADER_BYTES) {
          fail(scopeError("direct_mcp_invalid_frame", "Configured MCP returned an oversized content-length header."));
          return;
        }
      }
      const separator = buffer.indexOf("\r\n\r\n");
      if (startsWithContentLengthPrefix()) {
        const firstNewline = buffer.indexOf("\n");
        if (firstNewline >= 0 && buffer[firstNewline - 1] !== 13) {
          fail(scopeError("direct_mcp_invalid_frame", "Configured MCP returned an invalid content-length frame."));
          return;
        }
        const headerLineEnd = buffer.indexOf("\r\n");
        if (headerLineEnd >= 0) {
          const firstLine = buffer.toString("utf8", 0, headerLineEnd);
          const declaredMatch = firstLine.match(/^content-length\s*:\s*(\d+)\s*$/i);
          if (!declaredMatch) {
            fail(scopeError("direct_mcp_invalid_frame", "Configured MCP returned an invalid content-length frame."));
            return;
          }
          const declaredLength = Number(declaredMatch[1]);
          if (!Number.isSafeInteger(declaredLength) || declaredLength > MAX_MCP_RESULT_BYTES) {
            fail(scopeError("direct_mcp_result_too_large", "Configured MCP result exceeded the bounded output limit."));
            return;
          }
        }
        if (separator < 0) return;
        const header = buffer.toString("utf8", 0, separator);
        const match = header.match(/^content-length\s*:\s*(\d+)\s*(?:\r\n|$)/i);
        if (!match) {
          fail(scopeError("direct_mcp_invalid_frame", "Configured MCP returned an invalid content-length frame."));
          return;
        }
        const length = Number(match[1]);
        if (!Number.isSafeInteger(length) || length > MAX_MCP_RESULT_BYTES) {
          fail(scopeError("direct_mcp_result_too_large", "Configured MCP result exceeded the bounded output limit."));
          return;
        }
        const start = separator + 4;
        if (buffer.length < start + length) return;
        const body = buffer.subarray(start, start + length).toString("utf8");
        buffer = buffer.subarray(start + length);
        try { onMessage(JSON.parse(body)); } catch { fail(scopeError("direct_mcp_invalid_json", "Configured MCP returned invalid JSON.")); }
        continue;
      }
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const line = buffer.subarray(0, newline).toString("utf8").trim();
      buffer = buffer.subarray(newline + 1);
      if (!line) continue;
      try { onMessage(JSON.parse(line)); } catch { fail(scopeError("direct_mcp_invalid_json", "Configured MCP returned invalid JSON.")); }
    }
  };
}

function requestMcpJsonRpc(server, method, params = {}, options = {}) {
  if (!server.command) return Promise.reject(scopeError("direct_mcp_transport_unavailable", "The configured MCP server has no local transport command."));
  if (server.transportKind !== "stdio") return Promise.reject(scopeError("direct_mcp_transport_unsupported", "The configured MCP transport is not supported by Direct."));
  const timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_MCP_TIMEOUT_MS, 100, MAX_MCP_TIMEOUT_MS);
  const signal = options.signal;
  return new Promise((resolve, reject) => {
    let settled = false;
    let finishing = false;
    let timer = null;
    let child = null;
    let childExited = false;
    let resolveChildExit;
    const childExit = new Promise((resolveExit) => { resolveChildExit = resolveExit; });
    const isChildLive = () => Boolean(child && !childExited && child.exitCode === null && child.signalCode === null);
    const markChildExited = () => {
      if (childExited) return;
      childExited = true;
      resolveChildExit();
    };
    const waitForChildExit = async (durationMs) => {
      if (!isChildLive()) return true;
      let timeout;
      await Promise.race([
        childExit,
        new Promise((resolveExit) => { timeout = setTimeout(resolveExit, durationMs); }),
      ]);
      if (timeout) clearTimeout(timeout);
      return !isChildLive();
    };
    const cleanupChild = async () => {
      if (!child || childExited) return true;
      const cleanupDeadline = Date.now() + MCP_CHILD_CLEANUP_DEADLINE_MS;
      if (isChildLive()) {
        try { child.kill("SIGTERM"); } catch {}
        await waitForChildExit(Math.min(MCP_CHILD_TERM_GRACE_MS, Math.max(0, cleanupDeadline - Date.now())));
      }
      if (isChildLive()) {
        try { child.kill("SIGKILL"); } catch {}
        await waitForChildExit(Math.max(0, cleanupDeadline - Date.now()));
      }
      return !isChildLive();
    };
    const finish = (error, result) => {
      if (settled || finishing) return;
      finishing = true;
      if (timer) clearTimeout(timer);
      timer = null;
      if (signal) signal.removeEventListener?.("abort", abort);
      child?.stdin?.destroy?.();
      child?.stdout?.removeListener?.("data", parser);
      child?.stderr?.removeListener?.("data", onStderr);
      void (async () => {
        const reaped = await cleanupChild();
        const cleanupError = reaped ? null : scopeError("direct_mcp_cleanup_timeout", "Configured MCP process cleanup did not complete within the bounded deadline.");
        settled = true;
        child?.removeListener?.("error", onChildError);
        child?.removeListener?.("exit", onChildExit);
        child?.removeListener?.("close", onChildClose);
        const finalError = error || cleanupError;
        if (finalError) reject(finalError);
        else resolve(result);
      })();
    };
    const abort = () => finish(scopeError("direct_mcp_request_aborted", "Configured MCP request was cancelled."));
    const send = (request) => {
      if (finishing || !child?.stdin?.writable) return finish(scopeError("direct_mcp_transport_closed", "Configured MCP transport closed before the response."));
      child.stdin.write(`${JSON.stringify(request)}\n`);
    };
    let phase = "initialize";
    let activeRequestId = 1;
    const parser = lineOrContentLengthParser((message) => {
      if (finishing || !isPlainObject(message)) return;
      if (message.method && !String(message.method).startsWith("notifications/")) {
        return finish(scopeError("mcp_elicitation_owner_required", "Configured MCP requested owner-controlled interaction."));
      }
      if (Number(message.id) !== activeRequestId) return;
      if (message.error) return finish(scopeError("direct_mcp_rpc_error", boundedString(message.error.message, 360) || "Configured MCP returned an error."));
      if (phase === "initialize") {
        phase = "request";
        activeRequestId = 2;
        send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
        send({ jsonrpc: "2.0", id: activeRequestId, method, params });
        return;
      }
      finish(null, message.result || {});
    }, (error) => finish(error));
    child = spawn(server.command, server.args, {
      cwd: server.cwd || undefined,
      env: server.processEnv.reduce((env, key) => {
        if (process.env[key] !== undefined) env[key] = process.env[key];
        return env;
      }, {}),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const onStderr = (chunk) => {
      if (String(chunk).length > MAX_MCP_RESULT_BYTES) finish(scopeError("direct_mcp_result_too_large", "Configured MCP stderr exceeded the bounded output limit."));
    };
    const onChildError = (error) => finish(error);
    const onChildExit = (code, signalName) => {
      markChildExited();
      if (!settled) finish(scopeError("direct_mcp_transport_exited", `Configured MCP exited before completing the request (${code ?? signalName ?? "unknown"}).`));
    };
    const onChildClose = () => markChildExited();
    child.stdout?.on("data", parser);
    child.stderr?.on("data", onStderr);
    child.once("error", onChildError);
    child.once("exit", onChildExit);
    child.once("close", onChildClose);
    timer = setTimeout(() => finish(scopeError("direct_mcp_request_timeout", "Configured MCP request exceeded the timeout.")), timeoutMs);
    timer.unref?.();
    if (signal?.aborted) return abort();
    signal?.addEventListener?.("abort", abort, { once: true });
    send({ jsonrpc: "2.0", id: activeRequestId, method: "initialize", params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "codex-direct", version: "1" },
    }});
  });
}

async function queryConfiguredServer(server, method, params, options = {}) {
  if (server.transportKind !== "stdio" && server.transportKind !== "fixture") {
    throw scopeError("direct_mcp_transport_unsupported", "The configured MCP transport is not supported by Direct.");
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
  return requestMcpJsonRpc(server, method, params, options);
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
  for (const server of servers) {
    if (server.enabledState !== "enabled" || server.freshness !== "fresh" || ["unknown", "untrusted"].includes(server.trustState)) continue;
    const serverArgs = { _serverIdentityId: server.serverIdentityId };
    if (toolName === "list_mcp_resources") {
      const result = await queryConfiguredServer(server, "resources/list", serverArgs, input);
      rows.push(...resultEntries({ resources: result.resources || server.resources }, "resources").map((row) => ({
        ...row,
        serverIdentityId: server.serverIdentityId,
        sourceKind: "mcp_resource",
      })));
    } else if (toolName === "list_mcp_resource_templates") {
      const result = await queryConfiguredServer(server, "resources/templates/list", serverArgs, input);
      rows.push(...resultEntries({ resourceTemplates: result.resourceTemplates || server.resourceTemplates }, "resourceTemplates").map((row) => ({ ...row, serverIdentityId: server.serverIdentityId, sourceKind: "mcp_resource_template" })));
    } else if (toolName === "tool_search") {
      const [resources, templates, tools] = await Promise.all([
        queryConfiguredServer(server, "resources/list", {}, input),
        queryConfiguredServer(server, "resources/templates/list", {}, input),
        queryConfiguredServer(server, "tools/list", {}, input),
      ]);
      rows.push(
        ...resultEntries({ resources: resources.resources || server.resources }, "resources").map((row) => ({ ...row, serverIdentityId: server.serverIdentityId, sourceKind: "mcp_resource" })),
        ...resultEntries({ resourceTemplates: templates.resourceTemplates || server.resourceTemplates }, "resourceTemplates").map((row) => ({ ...row, serverIdentityId: server.serverIdentityId, sourceKind: "mcp_resource_template" })),
        ...resultEntries({ tools: tools.tools || server.tools }, "tools").map((row) => ({ ...row, serverIdentityId: server.serverIdentityId, sourceKind: "mcp_tool" })),
      );
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
  const returnedUri = normalizeString(
    result?.uri || result?.resourceUri || arrayOrEmpty(result?.contents || result?.content)[0]?.uri,
    "",
  );
  if (returnedUri && returnedUri !== resourceUri) {
    throw scopeError("direct_mcp_resource_result_scope_mismatch", "Configured MCP returned a resource from a different URI.");
  }
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

function createDirectConfiguredMcpResolvers() {
  return Object.freeze({
    externalDiscoveryResolver: (input) => discoverConfiguredMcp(input),
    mcpResourceReadResolver: (input) => readConfiguredMcpResource(input),
  });
}

module.exports = {
  configuredMcpServersForProject,
  configuredMcpServerIdentityInput,
  createDirectConfiguredMcpResolvers,
  discoverConfiguredMcp,
  normalizeConfiguredMcpServer,
  readConfiguredMcpResource,
};
