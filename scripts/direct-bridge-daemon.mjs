#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildHeadlessBridgeDaemonFromConfig } = require("../src/main/direct/headless/bridge-daemon.js");

function readArg(args, name, fallback = "") {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) return fallback;
  return args[index + 1];
}

function hasArg(args, name) {
  return args.includes(name);
}

function readNumberArg(args, name, fallback) {
  const value = readArg(args, name, "");
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const args = process.argv.slice(2);
const daemon = buildHeadlessBridgeDaemonFromConfig({
  configPath: readArg(args, "--config", ""),
  ...(hasArg(args, "--root") ? { rootDir: readArg(args, "--root", "") } : {}),
  ...(hasArg(args, "--host") ? { host: readArg(args, "--host", "") } : {}),
  ...(hasArg(args, "--port") ? { port: readNumberArg(args, "--port", 0) } : {}),
  maxInboxEvents: readNumberArg(args, "--max-inbox-events", undefined),
  maxBodyBytes: readNumberArg(args, "--max-body-bytes", undefined),
});

const address = await daemon.listen();
console.log(JSON.stringify({
  schema: "direct_headless_bridge_daemon_started@1",
  url: `http://${address.host}:${address.port}`,
  status: daemon.statusProjection(),
}, null, 2));

async function shutdown(signal) {
  await daemon.close();
  console.log(JSON.stringify({
    schema: "direct_headless_bridge_daemon_stopped@1",
    signal,
  }));
  process.exit(0);
}

process.on("SIGINT", () => {
  shutdown("SIGINT").catch((error) => {
    console.error(error);
    process.exit(1);
  });
});
process.on("SIGTERM", () => {
  shutdown("SIGTERM").catch((error) => {
    console.error(error);
    process.exit(1);
  });
});
