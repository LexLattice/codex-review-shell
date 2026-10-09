#!/usr/bin/env node
// Configured MCP servers are long-lived, as in Codex: one initialized server
// per (placement, command, args, cwd, environment), reused by later and
// concurrent requests. Before, every request started the server, ran the
// handshake, and killed it, so stateful servers couldn't work and each
// tool_search started three servers. Checked here: reuse, one handshake,
// cancellation that keeps the server, server-initiated requests refused
// without killing it, restart after a crash or a timeout, replacement on a
// config change, idle expiry, disposal, cancel and timeout during the
// handshake, and a session limit that never closes a busy server.
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
const log = (entry) => fs.appendFileSync(${JSON.stringify(logFile)}, JSON.stringify({ pid: process.pid, tag: process.argv[2] || "", ...entry }) + "\\n");
let initializeCount = 0;
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  log({ method: message.method || "", id: message.id ?? null, error: message.error ? message.error.code : null, params: message.params || null });
  if (message.method === "initialize" && process.argv[3] === "hang-init") return;
  if (message.method === "initialize") { initializeCount += 1; return send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18", capabilities: {} } }); }
  if (message.method === "whoami") return send({ jsonrpc: "2.0", id: message.id, result: { pid: process.pid, initializeCount, tag: process.argv[2] || "" } });
  if (message.method === "slow") return setTimeout(() => send({ jsonrpc: "2.0", id: message.id, result: { slow: true } }), 3000);
  if (message.method === "never") return;
  if (message.method === "ask_owner") return send({ jsonrpc: "2.0", id: "srv-1", method: "elicitation/create", params: { message: "Pick one" } });
  if (message.method === "crash") process.exit(3);
});
`);
const server = (tag = "a", mode = "") => ({ transportKind: "stdio", command: process.execPath, args: [serverScript, tag, ...(mode ? [mode] : [])], cwd: root, processEnv: [] });
const initPid = async (tag) => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const entry = log().find((row) => row.tag === tag && row.method === "initialize");
    if (entry) return entry.pid;
    await sleep(50);
  }
  throw new Error(`server ${tag} never received initialize`);
};
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

  // Cancelling while a new server hangs in its handshake returns at once and
  // stops that server (nobody else is waiting for it).
  const initPool = new McpSessionPool({ idleMs: 60_000 });
  try {
    const cancelInit = new AbortController();
    const cancelledStart = Date.now();
    const hung = initPool.request(server("hang1", "hang-init"), "whoami", {}, { ...options, identityKey: "hang1", timeoutMs: 20_000, signal: cancelInit.signal });
    const hungPid = await initPid("hang1");
    cancelInit.abort();
    await assert.rejects(hung, (error) => error.code === "direct_mcp_request_aborted");
    assert(Date.now() - cancelledStart < 5000, "cancel during the handshake doesn't wait for its timeout");
    assert(await waitGone(hungPid), "the half-started server is stopped");
    assert.equal(initPool.sessions.size, 0);

    // A second request waiting on the same handshake keeps its own, shorter
    // timeout; the server stays for the first until that one gives up too.
    const firstWaiter = new AbortController();
    const patient = initPool.request(server("hang2", "hang-init"), "whoami", {}, { ...options, identityKey: "hang2", timeoutMs: 20_000, signal: firstWaiter.signal });
    const sharedPid = await initPid("hang2");
    const impatientStart = Date.now();
    await assert.rejects(
      initPool.request(server("hang2", "hang-init"), "whoami", {}, { ...options, identityKey: "hang2", timeoutMs: 300 }),
      (error) => error.code === "direct_mcp_request_timeout",
    );
    assert(Date.now() - impatientStart < 3000, "the second request's own timeout applies");
    assert(alive(sharedPid), "the server keeps starting for the first request");
    firstWaiter.abort();
    await assert.rejects(patient, (error) => error.code === "direct_mcp_request_aborted");
    assert(await waitGone(sharedPid), "and stops once nobody waits for it");
  } finally {
    await initPool.dispose();
  }

  // The session limit closes only idle servers; when every server is busy a
  // new one is refused rather than failing others' requests.
  const smallPool = new McpSessionPool({ idleMs: 60_000, maxSessions: 2 });
  try {
    const busyA = await smallPool.request(server("limA"), "whoami", {}, { ...options, identityKey: "limA" });
    const idleB = await smallPool.request(server("limB"), "whoami", {}, { ...options, identityKey: "limB" });
    const slowA = smallPool.request(server("limA"), "slow", {}, { ...options, identityKey: "limA" });
    await sleep(100);
    const c = await smallPool.request(server("limC"), "whoami", {}, { ...options, identityKey: "limC" });
    assert(await waitGone(idleB.pid), "the idle server made room");
    assert(alive(busyA.pid), "the busy one stayed");
    const slowC = smallPool.request(server("limC"), "slow", {}, { ...options, identityKey: "limC" });
    await sleep(100);
    await assert.rejects(
      smallPool.request(server("limD"), "whoami", {}, { ...options, identityKey: "limD" }),
      (error) => error.code === "direct_mcp_session_limit",
    );
    assert.deepEqual(await slowA, { slow: true }, "the in-flight request on the busy server completed");
    assert.deepEqual(await slowC, { slow: true });
    assert.equal(c.tag, "limC");
  } finally {
    await smallPool.dispose();
  }

  console.log(JSON.stringify({ ok: true, started: pool.started }));
} finally {
  await pool.dispose().catch(() => {});
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
