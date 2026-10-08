#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { provisionHost, startHost, loadHostConfig } from "./direct-semantic-service-host.mjs";

const require = createRequire(import.meta.url);
const { createPack, validatePack, requestFor, fail } = require("../src/main/direct/semantic-service/commissioning-compiler");
const { CommissioningDaemon } = require("../src/main/direct/semantic-service/commissioning-daemon");
const { runCli } = require("../src/main/direct/semantic-service/cli");
const RESOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/main/direct/semantic-service/resources");

function writeExclusive(filePath, value) {
  const fd = fs.openSync(filePath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const directory = fs.openSync(path.dirname(filePath), fs.constants.O_RDONLY);
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}

function readPack(profileRoot) {
  const filePath = path.join(profileRoot, "host", "commissioning-pack.json");
  const fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o077) || stat.uid !== process.getuid() || stat.size > 4 * 1024 * 1024) fail("COMMISSIONING_PACK_FILE_UNPROTECTED");
    return validatePack(JSON.parse(fs.readFileSync(fd, "utf8")));
  } finally { fs.closeSync(fd); }
}

function options(argv, allowed, { client = false } = {}) {
  const result = {};
  let index = 0;
  for (; index < argv.length; index += 2) {
    if (client && !argv[index].startsWith("--")) break;
    const key = argv[index];
    if (!allowed.includes(key) || Object.hasOwn(result, key) || index + 1 >= argv.length || argv[index + 1].startsWith("--")) fail("COMMISSIONING_CLI_USAGE");
    result[key] = argv[index + 1];
  }
  return { values: result, rest: argv.slice(index) };
}

export async function initializeCommissioning({ installationRoot, profileRoot, profileRef = "s14-commissioning", compilerRoot, providerAuthRoot, providerAuthFile, casesFile = path.join(RESOURCE_ROOT, "commissioning-s14-chain-cases.json") }) {
  if (!compilerRoot) fail("COMMISSIONING_COMPILER_ROOT_REQUIRED");
  const cases = JSON.parse(fs.readFileSync(casesFile, "utf8"));
  if (cases.schema !== "direct_commissioning_chain_snapshots@1" || Object.keys(cases).sort().join(",") !== "schema,snapshots") fail("COMMISSIONING_CASES_FILE_INVALID");
  const pack = createPack({ compilerRoot, moduleFile: path.join(RESOURCE_ROOT, "commissioning-s14-m2-module.v0.json"), snapshots: cases.snapshots, projectRef: profileRef, provider: (providerAuthRoot || providerAuthFile) ? require("../src/main/direct/semantic-service/commissioning-provider").providerDescriptor({ authRoot: providerAuthRoot || path.dirname(providerAuthFile), authFile: providerAuthFile || null }) : null });
  const provisioned = await provisionHost({ installationRoot, profileRoot, profileRef });
  writeExclusive(path.join(profileRoot, "host", "commissioning-pack.json"), pack);
  const requestRoot = path.join(profileRoot, "host", "requests");
  fs.mkdirSync(requestRoot, { mode: 0o700 });
  const requests = pack.snapshots.map((snapshot, index) => {
    const request = requestFor(pack, { snapshotRef: snapshot.snapshotRef, requestId: `commissioning-request-${index + 1}`, idempotencyKey: `commissioning-idempotency-${index + 1}` });
    const requestFile = path.join(requestRoot, `request-${index + 1}.json`);
    writeExclusive(requestFile, request);
    return { snapshotRef: snapshot.snapshotRef, requestFile };
  });
  // Pin the pack into authenticated custody before advertising installation.
  const config = loadHostConfig(provisioned.configPath);
  const daemon = new CommissioningDaemon({ profileRoot, installationRoot, profileRef: config.profileRef, pack });
  try { const status = await daemon.start({ listen: false }); if (!status.ready) fail(status.blockedReason || "COMMISSIONING_INITIALIZATION_FAILED"); }
  finally { await daemon.close(); }
  return { ...provisioned, schema: "direct_commissioning_host_provisioned@1", packDigest: pack.packDigest, requests, authorityEffect: "none" };
}

export async function main(argv = process.argv.slice(2)) {
  const [mode, ...args] = argv;
  if (mode === "init") {
    const { values } = options(args, ["--installation-root", "--profile-root", "--profile-ref", "--compiler-root", "--cases", "--provider-auth-root", "--provider-auth-file"]);
    const result = await initializeCommissioning({ installationRoot: values["--installation-root"], profileRoot: values["--profile-root"], profileRef: values["--profile-ref"], compilerRoot: values["--compiler-root"], providerAuthRoot: values["--provider-auth-root"], providerAuthFile: values["--provider-auth-file"], casesFile: values["--cases"] });
    process.stdout.write(JSON.stringify(result) + "\n");
    return 0;
  }
  if (mode === "start") {
    const { values } = options(args, ["--config", "--progress"]);
    if (values["--progress"] !== undefined && values["--progress"] !== "true") fail("COMMISSIONING_CLI_USAGE");
    const config = loadHostConfig(values["--config"]);
    const pack = readPack(config.profileRoot);
    const host = await startHost({ configPath: values["--config"], daemonFactory: (options) => new CommissioningDaemon({ ...options, pack }) });
    if (values["--progress"] === "true") host.daemon.coordinator.on("change", (jobRef) => {
      const state = host.daemon.coordinator.state(jobRef);
      process.stdout.write(JSON.stringify({ event: "PHASE", jobRef, phase: state.status, revision: state.revision }) + "\n");
    });
    await host.wait();
    return 0;
  }
  if (mode === "client") {
    const { values, rest } = options(args, ["--config", "--credential"], { client: true });
    const config = loadHostConfig(values["--config"]);
    if (!rest.length) fail("COMMISSIONING_CLI_USAGE");
    const forwarded = [...rest];
    if (["inspect", "results", "subscribe"].includes(forwarded[0]) && !forwarded.includes("--projection")) forwarded.push("--projection", "commissioning-projection-v1");
    return runCli(forwarded, { env: { DIRECT_SEMANTIC_PROFILE_ROOT: config.profileRoot, DIRECT_SEMANTIC_CREDENTIAL_FILE: values["--credential"] || config.taskCredentialPath } });
  }
  fail("COMMISSIONING_CLI_USAGE");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; }).catch((error) => { process.stderr.write(`${error.code || "COMMISSIONING_FAILURE"}: ${error.message}\n`); process.exitCode = 1; });
}
