#!/usr/bin/env node
// Streamable HTTP MCP servers, as Codex's client speaks to them: POST each
// message (Accept: application/json, text/event-stream), keep the
// Mcp-Session-Id from initialize and send it with MCP-Protocol-Version,
// read JSON or SSE replies (an SSE reply can carry the server's own
// requests, whose answers are POSTed back), headers from config (bearer
// token), DELETE at the end, a 404 for the session means start over. Also:
// Codex config.toml servers joining a project, with the owner's switch.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { McpSessionPool } = require("../src/main/direct/external/mcp-stdio-transport.js");
const {
  configuredMcpServersForProject,
  configuredMcpServerIdentityInput,
  callConfiguredMcpTool,
  codexServerIdentityId,
  setCodexMcpServersForProject,
  normalizeConfiguredMcpServer,
} = require("../src/main/direct/external/configured-mcp-adapter.js");
const { normalizeCodexMcpServer } = require("../src/main/direct/codex-home/codex-environment-context.js");
const { buildMcpToolCatalog } = require("../src/main/direct/external/mcp-tool-calls.js");
const { DirectApprovalRuleStore } = require("../src/main/direct/authority/approval-rule-store.js");

const log = [];
const sessions = new Set();
const waiting = new Map();
let sessionCounter = 0;
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    const sessionId = req.headers["mcp-session-id"] || "";
    log.push({ method: req.method, sessionId, auth: req.headers.authorization || "", version: req.headers["mcp-protocol-version"] || "", accept: req.headers.accept || "", body: body ? JSON.parse(body) : null });
    if (req.headers.authorization !== "Bearer secret-token") {
      res.writeHead(401).end();
      return;
    }
    if (req.method === "DELETE") {
      sessions.delete(sessionId);
      res.writeHead(200).end();
      return;
    }
    const message = JSON.parse(body);
    if (message.method === "initialize") {
      const id = `s${++sessionCounter}`;
      sessions.add(id);
      res.writeHead(200, { "Content-Type": "application/json", "Mcp-Session-Id": id });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} } } }));
      return;
    }
    if (!sessions.has(sessionId)) {
      res.writeHead(404).end();
      return;
    }
    // The client's answer to a server request: forwarded to the waiting stream.
    if (!message.method && waiting.has(message.id)) {
      const resume = waiting.get(message.id);
      waiting.delete(message.id);
      res.writeHead(202).end();
      resume(message);
      return;
    }
    if (message.id === undefined) {
      res.writeHead(202).end();
      return;
    }
    if (message.method === "tools/list") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "ask", inputSchema: { type: "object" } }, { name: "hidden", inputSchema: { type: "object" } }] } }));
      return;
    }
    if (message.method === "tools/call" && message.params.name === "ask") {
      // SSE: the server asks a form, then (after the answer) replies.
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const formId = `form-${message.id}`;
      waiting.set(formId, (answer) => {
        res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: `answer=${JSON.stringify(answer.result)}` }] } })}\n\n`);
        res.end();
      });
      res.write(`data: ${JSON.stringify({ jsonrpc: "2.0", id: formId, method: "elicitation/create", params: { mode: "form", message: "Pick", requestedSchema: { type: "object", properties: { n: { type: "number" } } } } })}\n\n`);
      return;
    }
    if (message.method === "tools/call" && message.params.name === "expire") {
      sessions.delete(sessionId);
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { echoed: message.method } }));
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/mcp`;

const pool = new McpSessionPool({ idleMs: 60_000 });
const config = normalizeCodexMcpServer("remote", { url, bearer_token_env_var: "REMOTE_TOKEN", http_headers: { "X-Client": "direct" } }, "codex:test", { REMOTE_TOKEN: "secret-token" });
const httpServer = normalizeConfiguredMcpServer({ serverIdentityId: "codex_remote", transport: config.transport, url: config.url, headers: config.headers });
const options = { placementKey: "host", identityKey: "codex_remote", timeoutMs: 5_000 };
try {
  assert.equal(httpServer.transportKind, "streamable_http");
  const listed = await pool.request(httpServer, "tools/list", {}, options);
  assert.deepEqual(listed.tools.map((tool) => tool.name), ["ask", "hidden"]);
  const init = log.find((entry) => entry.body?.method === "initialize");
  assert.equal(init.accept, "application/json, text/event-stream");
  assert.equal(init.sessionId, "", "initialize carries no session");
  const listRequest = log.find((entry) => entry.body?.method === "tools/list");
  assert.deepEqual([listRequest.sessionId, listRequest.version, listRequest.auth], ["s1", "2025-06-18", "Bearer secret-token"], "later requests carry the session, protocol version, and bearer token");
  assert(log.some((entry) => entry.body?.method === "notifications/initialized" && entry.sessionId === "s1"));

  // A form in the SSE reply reaches the caller; its answer is POSTed back.
  const forms = [];
  const asked = await pool.request(httpServer, "tools/call", { name: "ask" }, {
    ...options,
    onElicitation: async (params) => {
      forms.push(params);
      return { action: "accept", content: { n: 7 } };
    },
  });
  assert.equal(forms[0].message, "Pick");
  assert.equal(asked.content[0].text, `answer=${JSON.stringify({ action: "accept", content: { n: 7 } })}`);

  // An expired session (404) fails that request and the next one starts a
  // new session.
  await assert.rejects(pool.request(httpServer, "tools/call", { name: "expire" }, options), (error) => error.code === "direct_mcp_session_expired");
  await pool.request(httpServer, "ping", {}, options);
  assert(log.some((entry) => entry.body?.method === "ping" && entry.sessionId === "s2"), "a new session after the expired one");

  // A wrong token is reported as unauthorized, not as a hang.
  const unauthorized = normalizeConfiguredMcpServer({ serverIdentityId: "codex_bad", transport: "streamable_http", url, headers: { Authorization: "Bearer nope" } });
  await assert.rejects(pool.request(unauthorized, "tools/list", {}, { ...options, identityKey: "codex_bad", timeoutMs: 2_000 }), (error) => error.code === "direct_mcp_http_unauthorized");

  // Disposal ends the session with DELETE.
  await pool.dispose();
  assert(log.some((entry) => entry.method === "DELETE" && entry.sessionId === "s2"));

  // Codex config servers join a project as codex_<name>, runnable where the
  // project runs; the owner's switch can turn one off for a project.
  setCodexMcpServersForProject("p_http", [
    config,
    normalizeCodexMcpServer("local-one", { command: "node", args: ["x.js"], env: { A: "1" }, env_vars: ["HOME"], tool_timeout_sec: 30, disabled_tools: ["drop"] }, "codex:test", {}),
  ]);
  const project = { id: "p_http", workspace: { kind: "local" } };
  const servers = Object.fromEntries(configuredMcpServersForProject(project).map((entry) => [entry.serverIdentityId, entry]));
  assert.deepEqual(Object.keys(servers).sort(), ["codex_local-one", "codex_remote"]);
  assert.deepEqual([servers["codex_local-one"].source, servers["codex_local-one"].envValues, servers["codex_local-one"].processEnv, servers["codex_local-one"].toolTimeoutMs, servers["codex_local-one"].disabledTools],
    ["codex_config", { A: "1" }, ["HOME"], 30_000, ["drop"]]);
  assert.equal(servers.codex_remote.headers.Authorization, "Bearer secret-token");
  const switched = configuredMcpServersForProject({ ...project, mcpServerSettings: { codex_remote: { enabled: false } } });
  assert.equal(switched.find((entry) => entry.serverIdentityId === "codex_remote").enabledState, "disabled");

  for (const name of ["my_server", "local-one", "UPPER_123", "a".repeat(174)]) {
    assert.equal(codexServerIdentityId(name), `codex_${name}`, "unchanged names retain their persisted identity");
  }
  const distinctNames = ["my.server", "my_server", "my/server", "my:server", "my@server", "a".repeat(174) + "x", "a".repeat(174) + "y"];
  const distinctIds = distinctNames.map(codexServerIdentityId);
  assert.equal(new Set(distinctIds).size, distinctNames.length);
  assert(distinctIds.every((id) => id.length <= 180));
  const imports = distinctNames.map((name, index) => ({ name, command: `command-${index}` }));
  setCodexMcpServersForProject("p_names", imports);
  const imported = configuredMcpServersForProject({ id: "p_names" });
  assert.equal(imported.length, distinctNames.length);
  setCodexMcpServersForProject("p_names_reversed", [...imports].reverse());
  const reversed = configuredMcpServersForProject({ id: "p_names_reversed" });
  assert.deepEqual(
    imported.map((entry) => [entry.serverIdentityId, entry.command]).sort(),
    reversed.map((entry) => [entry.serverIdentityId, entry.command]).sort(),
    "identity is independent of import order",
  );
  const namedTools = imported.map((entry) => ({ ...entry, tools: [{ name: "write", inputSchema: { type: "object" } }] }));
  const catalog = buildMcpToolCatalog(namedTools);
  assert.equal(catalog.entries.length, distinctNames.length);
  assert.equal(new Set(catalog.entries.map((entry) => entry.functionName)).size, distinctNames.length);
  assert(catalog.entries.every((entry) => entry.functionName.length <= 64 && /^[A-Za-z0-9_-]+$/.test(entry.functionName)));
  const approvalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "direct-mcp-name-approvals-"));
  try {
    const rules = new DirectApprovalRuleStore({ rootDir: approvalRoot });
    rules.allowMcpTool("p_names", "codex_my_server", "write");
    const reloaded = new DirectApprovalRuleStore({ rootDir: approvalRoot });
    assert.equal(reloaded.isMcpToolAllowed("p_names", codexServerIdentityId("my_server"), "write"), true);
    assert.equal(reloaded.isMcpToolAllowed("p_names", codexServerIdentityId("my.server"), "write"), false, "an old readable-name approval cannot authorize a different endpoint");
    rules.allowMcpTool("p_names", codexServerIdentityId("my.server"), "write");
    assert.equal(reloaded.isMcpToolAllowed("p_names", codexServerIdentityId("my.server"), "write"), true);
    assert.equal(reloaded.isMcpToolAllowed("another-project", codexServerIdentityId("my.server"), "write"), false);
  } finally {
    fs.rmSync(approvalRoot, { recursive: true, force: true });
  }

  const scopedPool = new McpSessionPool();
  let startedA;
  const aStarted = new Promise((resolve) => { startedA = resolve; });
  let completeA;
  const fetchImpl = async (endpoint, request) => {
    if (request.method === "DELETE") return new Response(null, { status: 200 });
    const message = JSON.parse(request.body);
    if (message.method === "initialize") return Response.json({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18" } });
    if (message.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (endpoint === "http://project-a.invalid/mcp") {
      startedA();
      return new Promise((resolve, reject) => {
        completeA = () => resolve(Response.json({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "A completed" }] } }));
        request.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    }
    return Response.json({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "B completed" }] } });
  };
  const scopedInput = (id, endpoint) => {
    const project = { id, mcpServers: [{ serverIdentityId: "shared", transport: "streamable_http", url: endpoint }] };
    const configured = configuredMcpServersForProject(project)[0];
    return {
      project, projectId: id, threadId: `thread_${id}`,
      profile: { projectId: id, serverIdentities: [configuredMcpServerIdentityInput(configured)] },
      serverIdentityId: "shared", toolName: "slow", mcpSessionPool: scopedPool, fetchImpl, timeoutMs: 5000,
    };
  };
  try {
    const pendingA = callConfiguredMcpTool(scopedInput("project-a", "http://project-a.invalid/mcp"))
      .then((value) => ({ value }), (error) => ({ error: error.code }));
    await aStarted;
    const completedB = await callConfiguredMcpTool(scopedInput("project-b", "http://project-b.invalid/mcp"));
    assert.equal(completedB.result.content[0].text, "B completed");
    completeA();
    const completedA = await pendingA;
    assert.equal(completedA.error, undefined, "another project must not close the first project's active call");
    assert.equal(completedA.value.result.content[0].text, "A completed");
    assert.equal(scopedPool.sessions.size, 2);
    await callConfiguredMcpTool(scopedInput("project-a", "http://project-a-changed.invalid/mcp"));
    assert.equal(scopedPool.sessions.size, 2, "a definition change replaces only its project's session");
  } finally {
    await scopedPool.dispose();
  }

  const remotePool = new McpSessionPool();
  const remoteIds = [];
  const remoteAStarted = new Promise((resolve) => { startedA = resolve; });
  const remoteInput = (id, endpoint) => {
    const project = { id, workspace: { kind: "windows" }, mcpServers: [{ serverIdentityId: "shared", command: endpoint }] };
    const configured = configuredMcpServersForProject(project)[0];
    return {
      project, projectId: id, threadId: `thread_${id}`,
      profile: { projectId: id, serverIdentities: [configuredMcpServerIdentityInput(configured)] },
      serverIdentityId: "shared", toolName: "slow", timeoutMs: 5000,
      workspaceLocalityResolver: () => false,
      mcpExecutors: {
        requestForProject: async (_project, _method, request) => {
          remoteIds.push(request.server.serverIdentityId);
          // Match the shared executor's pool options, with HTTP as the fixture.
          const result = await remotePool.request(
            { transportKind: "streamable_http", url: request.server.command },
            request.method, request.params,
            { placementKey: "executor", identityKey: request.server.serverIdentityId, fetchImpl, timeoutMs: request.timeoutMs },
          );
          return { result };
        },
      },
    };
  };
  try {
    const pendingA = callConfiguredMcpTool(remoteInput("project-a", "http://project-a.invalid/mcp"))
      .then((value) => ({ value }), (error) => ({ error: error.code }));
    await remoteAStarted;
    await callConfiguredMcpTool(remoteInput("project-b", "http://project-b.invalid/mcp"));
    completeA();
    const completedA = await pendingA;
    assert.equal(completedA.error, undefined, "shared executor replacements are also project-scoped");
    assert.equal(completedA.value.serverIdentityId, "shared", "the public approval identity stays unchanged");
    await callConfiguredMcpTool(remoteInput("project-a", "http://project-a-changed.invalid/mcp"));
    assert.equal(remotePool.sessions.size, 2, "same-project executor definitions still replace their previous session");
    await callConfiguredMcpTool(remoteInput("project-b", "http://project-a-changed.invalid/mcp"));
    assert.equal(remotePool.sessions.size, 2, "identical executor definitions cannot share a replaceable session across projects");
    assert.notEqual(remoteIds[0], remoteIds[1]);
    assert.equal(remoteIds[0], remoteIds[2], "the replacement identity does not depend on the server's definition");
    assert.equal(remoteIds[1], remoteIds[3]);
    assert(remoteIds.every((id) => id.length <= 200));
  } finally {
    await remotePool.dispose();
  }
  console.log(JSON.stringify({ ok: true, requests: log.length }));
} finally {
  await pool.dispose().catch(() => {});
  server.close();
}
