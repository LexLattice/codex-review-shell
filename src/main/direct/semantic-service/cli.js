"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const { Dss02Client } = require("./protocol");
const { parseJsonStrict, dss02Fail, digestObject } = require("./dss02-common");
const { readProtectedCredentialFd } = require("./protected-credential-channel");

const EXIT_CODES = Object.freeze({ OK: 0, USAGE: 2, TRANSPORT: 3, AUTHORIZATION: 4, CONFLICT: 5, BACKPRESSURE: 6, TIMEOUT: 7, INTEGRITY: 8, INTERNAL: 10 });
const DEFAULT_WAIT_TIMEOUT_SECONDS = 30;
const WAIT_PROTOCOL_GRACE_MS = 250;

function readRequest(filePath) {
  if (typeof filePath !== "string" || filePath.startsWith("-") || !fs.existsSync(filePath)) dss02Fail("DSS02_CLI_REQUEST_FILE");
  return parseJsonStrict(fs.readFileSync(filePath, "utf8"));
}

function readCredential(filePath) {
  if (typeof filePath !== "string" || filePath.startsWith("-") || !fs.existsSync(filePath)) dss02Fail("DSS02_CLI_CREDENTIAL_FILE");
  let fd;
  let bytes;
  try {
    const pathStat = fs.lstatSync(filePath);
    if (!pathStat.isFile() || pathStat.isSymbolicLink()) dss02Fail("DSS02_CLI_CREDENTIAL_FILE");
    const noFollow = fs.constants.O_NOFOLLOW || 0;
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
    bytes = readProtectedCredentialFd(fd).bytes;
  } catch (error) {
    if (error?.code?.startsWith("DSS02_")) throw error;
    dss02Fail("DSS02_CLI_CREDENTIAL_FILE");
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  const value = parseJsonStrict(bytes.toString("utf8"));
  if (!value || typeof value !== "object" || !value.verifier || typeof value.privateKeyDerBase64 !== "string") dss02Fail("DSS02_CLI_CREDENTIAL_FORMAT");
  let privateKey;
  try { privateKey = crypto.createPrivateKey({ key: Buffer.from(value.privateKeyDerBase64, "base64"), type: "pkcs8", format: "der" }); }
  catch (_) { dss02Fail("DSS02_CLI_CREDENTIAL_KEY"); }
  return { verifier: value.verifier, privateKey };
}

function parseArgs(argv) {
  const [command, argument, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) dss02Fail("DSS02_CLI_USAGE");
    const key = token.slice(2).replace(/-([a-z])/g, (_, character) => character.toUpperCase());
    options[key] = rest[++index];
  }
  return { command, argument, options };
}

function projectionOption(value) {
  return typeof value === "string" && value.length > 0 ? value : "projection-safe@1";
}

function waitTimeoutMilliseconds(value, { defaultSeconds = DEFAULT_WAIT_TIMEOUT_SECONDS } = {}) {
  const raw = value === undefined ? defaultSeconds : value;
  if (value !== undefined && (typeof raw !== "string" || raw.trim() === "")) dss02Fail("DSS02_CLI_USAGE");
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) dss02Fail("DSS02_CLI_USAGE");
  const milliseconds = Math.round(seconds * 1000);
  if (!Number.isSafeInteger(milliseconds)) dss02Fail("DSS02_CLI_USAGE");
  return milliseconds;
}

function classifyExit(error) {
  const code = error?.code || "";
  if (/AUTH|PROOF|UNAUTHORIZED|VERIFIER|CHALLENGE/.test(code)) return EXIT_CODES.AUTHORIZATION;
  if (/CONFLICT|IDEMPOTENCY|STALE/.test(code)) return EXIT_CODES.CONFLICT;
  if (/BACKPRESSURE|CAPACITY|WAITER/.test(code)) return EXIT_CODES.BACKPRESSURE;
  if (/TIMEOUT/.test(code)) return EXIT_CODES.TIMEOUT;
  if (/INTEGRITY|CUSTODY|CORRUPT|RECOVERY/.test(code)) return EXIT_CODES.INTEGRITY;
  if (/SOCKET|PROTOCOL|TRANSPORT/.test(code)) return EXIT_CODES.TRANSPORT;
  return EXIT_CODES.INTERNAL;
}

async function runCli(argv = process.argv.slice(2), { env = process.env, stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const parsed = parseArgs(argv);
    const profileRoot = env.DIRECT_SEMANTIC_PROFILE_ROOT;
    if (!profileRoot) dss02Fail("DSS02_CLI_PROFILE_UNCONFIGURED");
    let client = new Dss02Client({ profileRoot });
    const credential = parsed.options.credential ? readCredential(parsed.options.credential) : (env.DIRECT_SEMANTIC_CREDENTIAL_FILE ? readCredential(env.DIRECT_SEMANTIC_CREDENTIAL_FILE) : null);
    const authorized = ({ method, operation = method, params, request, purposeScopes, objectScopeDigest }) => credential ? client.requestAuthorized({ method, operation, params, request, purposeScopes, objectScopeDigest, credential }) : client.request(method, params);
    let result;
    switch (parsed.command) {
      case "submit": { const request = readRequest(parsed.argument); result = await authorized({ method: "submit", operation: "submit", params: { request }, request, purposeScopes: ["semantic-request"], objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", { projectRef: request.projectRef }) }); break; }
      case "inspect": { const request = { jobRef: parsed.argument }; result = await authorized({ method: "inspect", operation: "inspect", params: { jobRef: parsed.argument, projectionRef: projectionOption(parsed.options.projection) }, request, purposeScopes: ["read"], objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", request) }); break; }
      case "wait": {
        const request = { jobRef: parsed.argument };
        const hasTimeout = Object.prototype.hasOwnProperty.call(parsed.options, "timeout");
        if (hasTimeout && parsed.options.timeout === undefined) dss02Fail("DSS02_CLI_USAGE");
        const timeoutMs = waitTimeoutMilliseconds(hasTimeout ? parsed.options.timeout : undefined);
        const effectiveTimeoutMs = Math.min(timeoutMs, 30_000);
        client = new Dss02Client({ profileRoot, timeoutMs: effectiveTimeoutMs + WAIT_PROTOCOL_GRACE_MS });
        result = await authorized({ method: "wait", operation: "subscribe", params: { jobRef: parsed.argument, afterSequence: Number(parsed.options.after || 0), timeoutMs }, request, purposeScopes: ["delivery"], objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", request) });
        break;
      }
      case "ack": { const request = { deliveryAttemptRef: parsed.argument }; const params = { deliveryAttemptRef: parsed.argument }; if (typeof parsed.options.digest === "string" && parsed.options.digest.length > 0) params.digest = parsed.options.digest; result = await authorized({ method: "ack", operation: "acknowledge", params, request, purposeScopes: ["delivery"], objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", request) }); break; }
      case "results": { const request = { jobRef: parsed.argument }; result = await authorized({ method: "results", operation: "results", params: { jobRef: parsed.argument, projectionRef: projectionOption(parsed.options.projection) }, request, purposeScopes: ["read"], objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", request) }); break; }
      case "subscribe": { const request = { jobRef: parsed.argument }; result = await authorized({ method: "subscribe", operation: "subscribe", params: { jobRef: parsed.argument, projectionRef: projectionOption(parsed.options.projection) }, request, purposeScopes: ["delivery"], objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", request) }); break; }
      case "cancel": { const request = readRequest(parsed.argument); result = await authorized({ method: "cancel", operation: "cancel", params: { request }, request, purposeScopes: ["semantic-request"], objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", { jobRef: request.jobRef }) }); break; }
      case "service": if (parsed.argument !== "status") dss02Fail("DSS02_CLI_USAGE"); result = await client.serviceStatus(); break;
      default: dss02Fail("DSS02_CLI_USAGE");
    }
    stdout.write(`${JSON.stringify(result)}\n`);
    return EXIT_CODES.OK;
  } catch (error) {
    stderr.write(`${error.code || "DSS02_INTERNAL_FAILURE"}: ${error.message}\n`);
    return error.code === "DSS02_CLI_USAGE" ? EXIT_CODES.USAGE : classifyExit(error);
  }
}

if (require.main === module) runCli().then((code) => { process.exitCode = code; });

module.exports = { EXIT_CODES, runCli, parseArgs, readCredential, projectionOption, waitTimeoutMilliseconds };
