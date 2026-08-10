#!/usr/bin/env node

import fs from "node:fs";
import crypto from "node:crypto";

function parseArgs(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      options._.push(arg);
      continue;
    }
    const raw = arg.slice(2);
    const equals = raw.indexOf("=");
    if (equals >= 0) {
      options[raw.slice(0, equals)] = raw.slice(equals + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      options[raw] = next;
      index += 1;
      continue;
    }
    options[raw] = true;
  }
  return options;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function readEvent(options) {
  const file = normalizeString(options.file, "");
  if (file) return JSON.parse(fs.readFileSync(file, "utf8"));
  const text = normalizeString(options.text || options.message || options._?.join(" "), "");
  if (!text) throw new Error("Provide --file or --text.");
  const clientId = normalizeString(options.clientId || options["client-id"], "local_cli");
  const requestedRouteId = normalizeString(options.routeId || options["route-id"], "default");
  const eventSchema = normalizeString(options.schema, "headless_text_event@1");
  return {
    clientId,
    idempotencyKey: normalizeString(options.idempotencyKey || options["idempotency-key"], `cli_${sha256(`${clientId}:${requestedRouteId}:${text}`).slice(0, 20)}`),
    eventSchema,
    eventClass: normalizeString(options.eventClass || options["event-class"], "operator_message"),
    eventKind: normalizeString(options.eventKind || options["event-kind"], "direct_text"),
    sourceSystem: normalizeString(options.sourceSystem || options["source-system"], "local_cli"),
    requestedRouteId,
    text,
  };
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = {
      raw: text,
    };
  }
  return {
    status: response.status,
    body,
  };
}

async function waitForPacket(baseUrl, packetId, token, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await requestJson(`${baseUrl}/v1/bridge/turn-packets/${encodeURIComponent(packetId)}`, { token });
    if (result.status !== 200) return result.body;
    const state = normalizeString(result.body.packet?.state, "");
    if (["provider_completed", "failed", "handoff_unknown", "replay_unsafe"].includes(state)) return result.body;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return {
    ok: false,
    error: "timeout_waiting_for_turn_packet",
    packetId,
  };
}

const options = parseArgs(process.argv.slice(2));
const baseUrl = normalizeString(options.url, "http://127.0.0.1:0").replace(/\/+$/, "");
if (baseUrl.endsWith(":0")) throw new Error("Provide --url with the daemon host and port.");
const token = normalizeString(options.token || process.env.DIRECT_BRIDGE_TOKEN, "");
const event = readEvent(options);
const submitted = await requestJson(`${baseUrl}/v1/bridge/events`, {
  method: "POST",
  token,
  body: JSON.stringify(event),
});
if (options.wait && submitted.body?.turnPacket?.packetId) {
  const waited = await waitForPacket(baseUrl, submitted.body.turnPacket.packetId, token, Number(options.timeoutMs || options["timeout-ms"] || 120000));
  console.log(JSON.stringify({ submitted: submitted.body, terminal: waited }, null, 2));
} else {
  console.log(JSON.stringify(submitted.body, null, 2));
}
if (submitted.status >= 400) process.exitCode = 1;
