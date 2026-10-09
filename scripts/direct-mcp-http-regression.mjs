#!/usr/bin/env node
// Streamable HTTP MCP servers, as Codex's client speaks to them: POST each
// message (Accept: application/json, text/event-stream), keep the
// Mcp-Session-Id from initialize and send it with MCP-Protocol-Version,
// read JSON or SSE replies (an SSE reply can carry the server's own
// requests, whose answers are POSTed back), headers from config (bearer
// token), DELETE at the end, a 404 for the session means start over. Also:
// Codex config.toml servers joining a project, with the owner's switch.
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { McpSessionPool } = require("../src/main/direct/external/mcp-stdio-transport.js");
const {
  configuredMcpServersForProject,
  setCodexMcpServersForProject,
  normalizeConfiguredMcpServer,
} = require("../src/main/direct/external/configured-mcp-adapter.js");
const { normalizeCodexMcpServer } = require("../src/main/direct/codex-home/codex-environment-context.js");

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
  console.log(JSON.stringify({ ok: true, requests: log.length }));
} finally {
  await pool.dispose().catch(() => {});
  server.close();
}
