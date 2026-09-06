#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DirectSemanticDaemon,
  installOwnerBootstrapTrustRoot,
  provisionBootstrapCommitment,
} = require("../src/main/direct/semantic-service");
const { runCli } = require("../src/main/direct/semantic-service/cli");

const HOST_SCHEMA = "direct_semantic_service_host_config@1";
// The owner creates and consumes this one-use bootstrap secret within init.
// Do not claim an inherited descriptor that this path never received.
const DESCRIPTOR_PROVENANCE = { kind: "owner_local_initialization", revision: "direct-host-descriptor-v1" };
const TASK_OPERATIONS = ["submit", "inspect", "results", "subscribe", "acknowledge", "cancel"];
const TASK_SCOPES = ["semantic-request", "read", "delivery"];

function fail(code, message = code) { const error = new Error(message); error.code = code; throw error; }
function assertAbsolute(value, code) { if (typeof value !== "string" || !path.isAbsolute(value)) fail(code); return path.resolve(value); }
function ensurePrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  assertPrivateDirectory(directory);
}
function assertPrivateDirectory(directory) {
  const stat = fs.lstatSync(directory);
  const uidOk = typeof process.getuid !== "function" || stat.uid === process.getuid();
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) || !uidOk) fail("DSS02_HOST_CUSTODY_UNPROTECTED");
}
function fsyncDirectory(directory) { const fd = fs.openSync(directory, fs.constants.O_RDONLY); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function writeProtected(filePath, value) {
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(8).toString("hex")}`;
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
  const fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, filePath);
  fsyncDirectory(path.dirname(filePath));
}
function readProtectedJson(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const stat = fs.fstatSync(fd);
    const uidOk = typeof process.getuid !== "function" || stat.uid === process.getuid();
    if (!stat.isFile() || (stat.mode & 0o077) || !uidOk || stat.size > 64 * 1024) fail("DSS02_HOST_CUSTODY_UNPROTECTED");
    return JSON.parse(fs.readFileSync(fd, "utf8"));
  } catch (error) { if (error.code?.startsWith("DSS02_")) throw error; fail("DSS02_HOST_CONFIG_UNREADABLE"); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
function privateKeyDer(key) { return key.export({ type: "pkcs8", format: "der" }).toString("base64"); }
function publicStatus(status) { return { schema: status.schema, profileRef: status.profileRef, daemonGeneration: status.daemonGeneration, protocolRevision: status.protocolRevision, ready: status.ready, blockedReason: status.blockedReason, recoveryState: status.recoveryState, capacity: status.capacity }; }

function hostPaths(profileRoot) {
  const hostRoot = path.join(assertAbsolute(profileRoot, "DSS02_PROFILE_ROOT_INVALID"), "host");
  return { hostRoot, config: path.join(hostRoot, "host-config.json"), taskCredential: path.join(hostRoot, "task-credential.json"), administratorCredential: path.join(hostRoot, "administrator-credential.json") };
}

function assertAbsent(pathname) { try { fs.lstatSync(pathname); fail("DSS02_HOST_ALREADY_PROVISIONED"); } catch (error) { if (error.code !== "ENOENT") throw error; } }
function isWithin(parent, child) { const rel = path.relative(parent, child); return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".."); }
function disjointRoots(first, second) { return !isWithin(first, second) && !isWithin(second, first); }

export async function provisionHost({ installationRoot, profileRoot, profileRef = "direct-profile" } = {}) {
  installationRoot = assertAbsolute(installationRoot, "DSS02_INSTALLATION_ROOT_INVALID");
  profileRoot = assertAbsolute(profileRoot, "DSS02_PROFILE_ROOT_INVALID");
  if (!disjointRoots(installationRoot, profileRoot)) fail("DSS02_HOST_ROOTS_OVERLAP");
  assertAbsent(installationRoot); assertAbsent(profileRoot);
  fs.mkdirSync(installationRoot, { mode: 0o700 }); fs.mkdirSync(profileRoot, { mode: 0o700 });
  assertPrivateDirectory(installationRoot); assertPrivateDirectory(profileRoot);
  const administrator = crypto.generateKeyPairSync("ed25519");
  installOwnerBootstrapTrustRoot({ installationRoot, configurationRevision: "direct-semantic-host@1" });
  const genesis = provisionBootstrapCommitment({ installationRoot, profileRoot, profileRef, descriptorPolicy: DESCRIPTOR_PROVENANCE });
  const daemon = new DirectSemanticDaemon({ profileRoot, installationRoot, profileRef, bootstrap: { secret: genesis.secret, descriptorProvenance: DESCRIPTOR_PROVENANCE, administratorPublicKey: administrator.publicKey } });
  let taskKeys;
  let task;
  try {
    const started = daemon.start();
    if (!started.ready) fail(started.blockedReason || "DSS02_HOST_BOOTSTRAP_FAILED");
    const adminVerifierRef = daemon.store.get("SELECT verifier_ref FROM verifiers ORDER BY issued_at LIMIT 1")?.verifier_ref;
    if (!adminVerifierRef) fail("DSS02_HOST_ADMINISTRATOR_MISSING");
    taskKeys = crypto.generateKeyPairSync("ed25519");
    task = daemon.authority.issueCredential({ actorVerifierRef: adminVerifierRef, principalId: `${profileRef}-task`, subjectRef: `${profileRef}-task`, publicKey: taskKeys.publicKey, operations: TASK_OPERATIONS, purposeScopes: TASK_SCOPES, objectScopes: ["*"] });
    const paths = hostPaths(profileRoot);
    ensurePrivateDirectory(paths.hostRoot);
    writeProtected(paths.administratorCredential, { schema: "direct_semantic_administrator_credential@1", verifier: daemon.authority.getVerifier(adminVerifierRef), privateKeyDerBase64: privateKeyDer(administrator.privateKey) });
    writeProtected(paths.taskCredential, { schema: "direct_semantic_task_credential@1", verifier: task.verifier, privateKeyDerBase64: privateKeyDer(taskKeys.privateKey) });
    writeProtected(paths.config, { schema: HOST_SCHEMA, profileRef, profileRoot, installationRoot, taskCredentialPath: paths.taskCredential, administratorCredentialPath: paths.administratorCredential });
    fsyncDirectory(paths.hostRoot);
    return Object.freeze({ schema: "direct_semantic_service_host_provisioned@1", profileRef, profileRoot, installationRoot, configPath: paths.config, taskCredentialPath: paths.taskCredential, administratorCredentialPath: paths.administratorCredential });
  } finally { await daemon.close(); }
}

export function loadHostConfig(configPath) {
  configPath = assertAbsolute(configPath, "DSS02_HOST_CONFIG_REQUIRED");
  assertPrivateDirectory(path.dirname(configPath));
  const config = readProtectedJson(configPath);
  const configKeys = ["schema", "profileRef", "profileRoot", "installationRoot", "taskCredentialPath", "administratorCredentialPath"];
  if (config.schema !== HOST_SCHEMA || Object.keys(config).sort().join("\0") !== configKeys.sort().join("\0")) fail("DSS02_HOST_CONFIG_INVALID");
  const profileRoot = assertAbsolute(config.profileRoot, "DSS02_PROFILE_ROOT_INVALID");
  const installationRoot = assertAbsolute(config.installationRoot, "DSS02_INSTALLATION_ROOT_INVALID");
  if (path.resolve(configPath) !== path.resolve(hostPaths(profileRoot).config)) fail("DSS02_HOST_CONFIG_LOCATION_INVALID");
  if (path.resolve(config.taskCredentialPath) !== path.resolve(hostPaths(profileRoot).taskCredential) || path.resolve(config.administratorCredentialPath) !== path.resolve(hostPaths(profileRoot).administratorCredential)) fail("DSS02_HOST_CONFIG_PATH_INVALID");
  return config;
}

export async function startHost({ configPath, daemonFactory = undefined } = {}) {
  const config = loadHostConfig(configPath);
  const { profileRoot, installationRoot } = config;
  if (!daemonFactory && fs.existsSync(path.join(profileRoot, "host", "commissioning-pack.json"))) fail("DSS02_HOST_COMMISSIONING_ENTRY_REQUIRED");
  const options = { profileRoot, installationRoot, profileRef: config.profileRef, listen: true };
  const daemon = daemonFactory ? daemonFactory(options) : new DirectSemanticDaemon(options);
  let closed = false;
  let resolveClosed; const closedPromise = new Promise((resolve) => { resolveClosed = resolve; });
  const onSignal = () => void close(0);
  const close = async (exitCode = 0) => { if (closed) return; closed = true; process.removeListener("SIGINT", onSignal); process.removeListener("SIGTERM", onSignal); await daemon.close(); resolveClosed(); if (exitCode !== null) process.exitCode = exitCode; };
  process.once("SIGINT", onSignal); process.once("SIGTERM", onSignal);
  try {
    const status = await daemon.start({ listen: true });
    if (!status.ready) { await close(null); fail(status.blockedReason || "DSS02_HOST_NOT_READY"); }
    process.stdout.write(`${JSON.stringify({ event: "READY", status: publicStatus(status) })}\n`);
    return { daemon, status, close, wait: () => closedPromise };
  } catch (error) { await close(null); throw error; }
}

function parseOptions(argv, allowed) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) return { commandIndex: index, options, rest: argv.slice(index) };
    const key = token.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (!allowed.has(key) || Object.prototype.hasOwnProperty.call(options, key)) fail("DSS02_HOST_USAGE");
    const value = argv[++index];
    if (!value || value.startsWith("--")) fail("DSS02_HOST_USAGE");
    options[key] = value;
  }
  return { commandIndex: argv.length, options, rest: [] };
}

export async function main(argv = process.argv.slice(2)) {
  const mode = argv[0];
  if (mode === "init") {
    const parsed = parseOptions(argv.slice(1), new Set(["installationRoot", "profileRoot", "profileRef"]));
    if (parsed.rest.length || !parsed.options.installationRoot || !parsed.options.profileRoot || !parsed.options.profileRef) fail("DSS02_HOST_USAGE");
    const result = await provisionHost({ installationRoot: parsed.options.installationRoot, profileRoot: parsed.options.profileRoot, profileRef: parsed.options.profileRef });
    process.stdout.write(`${JSON.stringify(result)}\n`); return 0;
  }
  if (mode === "start") {
    const parsed = parseOptions(argv.slice(1), new Set(["config"]));
    if (parsed.rest.length || !parsed.options.config) fail("DSS02_HOST_USAGE");
    const hosted = await startHost({ configPath: parsed.options.config });
    await hosted.wait(); return 0;
  }
  if (mode === "client") {
    const parsed = parseOptions(argv.slice(1), new Set(["config", "credential"]));
    if (!parsed.options.config || !parsed.rest.length) fail("DSS02_HOST_USAGE");
    const config = readProtectedJson(assertAbsolute(parsed.options.config, "DSS02_HOST_CONFIG_REQUIRED"));
    const credential = parsed.options.credential || config.taskCredentialPath;
    const exitCode = await runCli(parsed.rest, { env: { ...process.env, DIRECT_SEMANTIC_PROFILE_ROOT: config.profileRoot, DIRECT_SEMANTIC_CREDENTIAL_FILE: credential } });
    return exitCode;
  }
  fail("DSS02_HOST_USAGE");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().then((code) => { process.exitCode = code; }).catch((error) => { process.stderr.write(`${error.code || "DSS02_HOST_FAILURE"}: ${error.message}\n`); process.exitCode = 1; });
