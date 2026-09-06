#!/usr/bin/env node
/* Mock-only regression. It never contacts the Codex provider. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildProviderRequest, providerDescriptor, runProviderPage } = require("../src/main/direct/semantic-service/commissioning-provider.js");
const { createDirectAuthStore } = require("../src/main/direct/auth/auth-store.js");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "direct-provider-mock-"));
const authRoot = path.join(root, "auth");
const auth = createDirectAuthStore({ mode: "file", rootDir: authRoot });
auth.writeCredentials({ accessToken: "mock-token", expiresAt: Date.now() + 600_000 });
const descriptor = providerDescriptor({ authRoot });
const page = { schema: "direct_commissioning_chain_page@1", pageRef: "page-1", evidence: { complete: true, lineageAvailable: true } };

function sse(value) {
  return [
    `event: response.created\ndata: ${JSON.stringify({ type: "response.created", response: { id: "resp-mock" } })}\n\n`,
    `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: JSON.stringify(value), item_id: "msg-1" })}\n\n`,
    `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { id: "resp-mock", status: "completed", usage: { input_tokens: 7, output_tokens: 9, total_tokens: 16 } } })}\n\n`,
    "data: [DONE]\n\n",
  ].join("");
}

const originalFetch = globalThis.fetch;
let calls = 0;
let observedBody = null;
globalThis.fetch = async (_url, options) => {
  calls += 1;
  observedBody = JSON.parse(options.body);
  return new Response(sse({ schema: "direct_commissioning_chain_response@1", attemptRef: "attempt-1", pageRef: "page-1", status: "SUPPORTS", reasonCode: "FINITE_CHAIN_CONTIGUOUS", evidenceRefs: [], authorityEffect: "none" }), { status: 200, headers: { "content-type": "text/event-stream" } });
};
try {
  const request = buildProviderRequest({ attemptRef: "attempt-1", page });
  assert.equal(request.model, "gpt-5.6-sol");
  assert.equal(request.reasoning.effort, "max");
  assert.deepEqual(request.tools, []);
  assert.equal(request.tool_choice, "none");
  assert.equal(request.store, false);
  const captured = await runProviderPage({ attemptRef: "attempt-1", page, descriptor });
  assert.equal(captured.status, "CAPTURED");
  assert.equal(calls, 1);
  assert.equal(observedBody.previous_response_id, undefined);
  assert.equal(captured.requestCount, 1);
  assert.equal(captured.usage.totalTokens, 16);
  assert.ok(captured.wireBase64.length > 0);
  assert.deepEqual(observedBody, request);
  assert.deepEqual(JSON.parse(observedBody.input[0].content[0].text), { attemptRef: "attempt-1", page });
  const authFile = path.join(root, "codex-auth.json");
  fs.writeFileSync(authFile, JSON.stringify({ tokens: { access_token: "mock-cli-token", account_id: "mock-account" } }), { mode: 0o600 });
  const cliCaptured = await runProviderPage({ attemptRef: "attempt-1", page, descriptor: providerDescriptor({ authRoot, authFile }) });
  assert.equal(cliCaptured.status, "CAPTURED");
  const missingExplicit = await runProviderPage({ attemptRef: "attempt-1", page, descriptor: providerDescriptor({ authRoot, authFile: path.join(root, "absent-auth.json") }) });
  assert.equal(missingExplicit.reasonCode, "AUTH_MISSING", "An absent explicit file must not fall back to a real account");
  const descriptorRejected = await runProviderPage({ attemptRef: "attempt-1", page, descriptor: { ...descriptor, maximumRequests: 2 } });
  assert.equal(descriptorRejected.reasonCode, "DESCRIPTOR_INVALID");

  globalThis.fetch = async () => new Response(sse("{malformed"), { status: 200, headers: { "content-type": "text/event-stream" } });
  const malformed = await runProviderPage({ attemptRef: "attempt-2", page, descriptor });
  assert.equal(malformed.status, "FAILED");
  assert.equal(malformed.reasonCode, "MALFORMED_OUTPUT");

  const oversized = await runProviderPage({ attemptRef: "attempt-oversized", page: { pageRef: "p", data: "x".repeat(1024 * 1024) }, descriptor });
  assert.equal(oversized.status, "UNAVAILABLE");
  assert.equal(oversized.reasonCode, "page_too_large");

  globalThis.fetch = async () => new Response("x".repeat(2 * 1024 * 1024 + 128), { status: 200, headers: { "content-type": "text/event-stream" } });
  const wireOverflow = await runProviderPage({ attemptRef: "attempt-wire-overflow", page, descriptor });
  assert.equal(wireOverflow.status, "FAILED");
  assert.equal(wireOverflow.reasonCode, "WIRE_BUDGET");

  const abortController = new AbortController();
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("event: response.created\ndata: {}\n\n"));
      setTimeout(() => { try { controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n")); } catch {} }, 5000);
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
  setTimeout(() => abortController.abort(), 20);
  const aborted = await runProviderPage({ attemptRef: "attempt-abort", page, descriptor, signal: abortController.signal });
  assert.equal(aborted.status, "UNAVAILABLE");
  assert.equal(aborted.reasonCode, "ABORTED");
  assert.ok(aborted.completedAt);

  const originalTimer = globalThis.setTimeout;
  globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("event: response.created\ndata: {}\n\n")); } }), { status: 200 });
  try {
    globalThis.setTimeout = (callback, milliseconds, ...args) => originalTimer(callback, milliseconds === 60000 ? 20 : milliseconds, ...args);
    const timedOut = await runProviderPage({ attemptRef: "attempt-timeout", page, descriptor });
    assert.equal(timedOut.reasonCode, "TIMEOUT");
    assert.ok(Buffer.from(timedOut.wireBase64, "base64").length > 0);
  } finally { globalThis.setTimeout = originalTimer; }
  globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("event: response.created\ndata: {}\n\n")); originalTimer(() => controller.error(new Error("synthetic-read-failure")), 10); } }), { status: 200 });
  const readFailure = await runProviderPage({ attemptRef: "attempt-read-failure", page, descriptor });
  assert.equal(readFailure.status, "FAILED");
  assert.equal(readFailure.reasonCode, "WIRE_CAPTURE_FAILED");
  assert.equal(readFailure.httpStatus, 200);
  assert.ok(Buffer.from(readFailure.wireBase64, "base64").length > 0);

  const missing = await runProviderPage({ attemptRef: "attempt-3", page, descriptor: providerDescriptor({ authRoot: path.join(root, "missing") }) });
  assert.equal(missing.status, "UNAVAILABLE");
  assert.equal(missing.reasonCode, "AUTH_MISSING");
  console.log("MOCK_ONLY direct semantic-service commissioning provider regression: PASS");
} finally {
  globalThis.fetch = originalFetch;
  fs.rmSync(root, { recursive: true, force: true });
}
