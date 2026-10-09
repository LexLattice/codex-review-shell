#!/usr/bin/env node
// Configured MCP servers are long-lived, as in Codex: one initialized server
// per (placement, command, args, cwd, environment), reused by later and
// concurrent requests. Before, every request started the server, ran the
// handshake, and killed it, so stateful servers couldn't work and each
// tool_search started three servers. Checked here: reuse, one handshake,
// cancellation that keeps the server, server-initiated requests refused
// without killing it, restart after a crash or a timeout, replacement on a
// config change, idle expiry, and disposal.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { McpSessionPool } = require("../src/main/direct/external/mcp-stdio-transport.js");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "direct-mcp-session-pool-"));
const serverScript = path.join(root, "server.js");
const logFile = path.join(root, "log.jsonl");
fs.writeFileSync(serverScript, `
const fs = require("node:fs");
const readline = require("node:readline");
const log = (entry) => fs.appendFileSync(${JSON.stringify(logFile)}, JSON.stringify({ pid: process.pid, ...entry }) + "\\n");
let initializeCount = 0;
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  log({ method: message.method || "", id: message.id ?? null, error: message.error ? message.error.code : null, params: message.params || null });
  if (message.method === "initialize") { initializeCount += 1; return send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18", capabilities: {} } }); }
  if (message.method === "whoami") return send({ jsonrpc: "2.0", id: message.id, result: { pid: process.pid, initializeCount, tag: process.argv[2] || "" } });
  if (message.method === "slow") return setTimeout(() => send({ jsonrpc: "2.0", id: message.id, result: { slow: true } }), 3000);
  if (message.method === "never") return;
  if (message.method === "ask_owner") return send({ jsonrpc: "2.0", id: "srv-1", method: "elicitation/create", params: { message: "Pick one" } });
  if (message.method === "crash") process.exit(3);
});
`);
const server = (tag = "a") => ({ transportKind: "stdio", command: process.execPath, args: [serverScript, tag], cwd: root, processEnv: [] });
const log = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitGone(pid, ms = 3000) {
  const deadline = Date.now() + ms;
  while (alive(pid) && Date.now() < deadline) await sleep(50);
  return !alive(pid);
}

const pool = new McpSessionPool({ idleMs: 60_000 });
const options = { placementKey: "host", identityKey: "fixture_server", timeoutMs: 5000 };
try {
  // Reuse: sequential and concurrent requests share one initialized server.
  const first = await pool.request(server(), "whoami", {}, options);
  const second = await pool.request(server(), "whoami", {}, options);
  const concurrent = await Promise.all([1, 2, 3].map(() => pool.request(server(), "whoami", {}, options)));
  assert.equal(second.pid, first.pid, "a later request reuses the server");
  assert(concurrent.every((result) => result.pid === first.pid), "concurrent requests share it");
  assert.equal(concurrent[2].initializeCount, 1, "the handshake ran once");
  assert.equal(pool.started, 1);

  // Cancellation tells the server and keeps it for the next request.
  const controller = new AbortController();
  const slow = pool.request(server(), "slow", {}, { ...options, signal: controller.signal });
  setTimeout(() => controller.abort(), 200);
  await assert.rejects(slow, (error) => error.code === "direct_mcp_request_aborted");
  await sleep(100);
  assert(log().some((entry) => entry.method === "notifications/cancelled" && entry.pid === first.pid), "the server is told about the cancellation");
  assert.equal((await pool.request(server(), "whoami", {}, options)).pid, first.pid, "and it keeps serving");

  // A server-initiated request needs the owner: refused (the server gets an
  // error reply), the request in flight fails, the server stays.
  await assert.rejects(pool.request(server(), "ask_owner", {}, options), (error) => error.code === "mcp_elicitation_owner_required");
  await sleep(100);
  assert(log().some((entry) => entry.id === "srv-1" && entry.error === -32601), "the server's request is answered with an error");
  assert.equal((await pool.request(server(), "whoami", {}, options)).pid, first.pid);

  // A crash fails the request in flight; the next request starts a new server.
  await assert.rejects(pool.request(server(), "crash", {}, options), (error) => error.code === "direct_mcp_transport_exited");
  const restarted = await pool.request(server(), "whoami", {}, options);
  assert.notEqual(restarted.pid, first.pid);
  assert.equal(restarted.initializeCount, 1);

  // A request that never answers times out and the server is replaced.
  await assert.rejects(pool.request(server(), "never", {}, { ...options, timeoutMs: 300 }), (error) => error.code === "direct_mcp_request_timeout");
  assert(await waitGone(restarted.pid), "the wedged server is stopped");
  const afterTimeout = await pool.request(server(), "whoami", {}, options);
  assert.notEqual(afterTimeout.pid, restarted.pid);

  // A config change for the same server replaces its process.
  const changed = await pool.request(server("b"), "whoami", {}, options);
  assert.equal(changed.tag, "b");
  assert(await waitGone(afterTimeout.pid), "the old config's server is stopped");
  assert.equal(pool.sessions.size, 1);

  // Different servers (no shared identity) run side by side.
  const other = await pool.request(server("c"), "whoami", {}, { ...options, identityKey: "other_server" });
  assert(alive(changed.pid) && alive(other.pid));
  assert.equal(pool.sessions.size, 2);

  // Disposal stops them all.
  await pool.dispose();
  assert(await waitGone(changed.pid) && await waitGone(other.pid), "dispose stops every server");
  assert.equal(pool.sessions.size, 0);

  // An idle server stops on its own.
  const idlePool = new McpSessionPool({ idleMs: 300 });
  const idle = await idlePool.request(server("idle"), "whoami", {}, options);
  assert(await waitGone(idle.pid, 3000), "an idle server is stopped after the quiet period");
  assert.equal(idlePool.sessions.size, 0);

  console.log(JSON.stringify({ ok: true, started: pool.started }));
} finally {
  await pool.dispose().catch(() => {});
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
