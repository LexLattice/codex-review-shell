#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const APP_TITLE = "Codex Review Shell";
const CONFIG_FILE_NAME = "workspace-config.json";
const PROFILE_ENV_VAR = "CODEX_REVIEW_SHELL_PROFILE";
const USER_DATA_ROOT_ENV_VAR = "CODEX_REVIEW_SHELL_USER_DATA_ROOT";
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_PROMPT = "Reply with exactly: headless direct smoke ok";
const DEFAULT_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";
const DIRECT_EMPTY_CONTEXT_SHAPE = "direct_text_turn_empty_context@1";

const { createDirectAuthStore } = require("../src/main/direct/auth/auth-store.js");
const { createDirectAuthLoginCoordinator } = require("../src/main/direct/auth/auth-login.js");
const { createCodexCliAuthStore, createDirectAuthCompositeStore } = require("../src/main/direct/auth/codex-cli-auth.js");
const { DirectHeadlessBridgeDaemon } = require("../src/main/direct/headless/bridge-daemon.js");
const { DirectHeadlessTextRuntime } = require("../src/main/direct/headless/text-runtime.js");
const { loadDirectCodexProfile } = require("../src/main/direct/odeu-profile/profile-loader.js");
const { DirectSessionStore } = require("../src/main/direct/session/session-store.js");
const { DirectThreadStore } = require("../src/main/direct/thread/thread-store.js");
const { DirectLiveTextController } = require("../src/main/direct/controller/live-text-controller.js");
const {
  DirectLiveProbeEvidenceStore,
  directTextRequestShapeHash,
  endpointHash,
} = require("../src/main/direct/probes/live-probe-evidence-store.js");
const {
  DEFAULT_CODEX_RESPONSES_ENDPOINT,
} = require("../src/main/direct/transport/codex-responses-transport.js");

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

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

function optionString(options, name, fallback = "") {
  return normalizeString(options[name], fallback);
}

function optionFlag(options, name, fallback = false) {
  const value = options[name];
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  return /^(1|true|yes)$/i.test(String(value || "").trim());
}

function envString(name, fallback = "") {
  return normalizeString(process.env[name], fallback);
}

function liveProviderOptIn(options = {}) {
  return optionFlag(options, "allow-live-provider-call", false) ||
    /^(1|true|yes)$/i.test(String(process.env.CODEX_DIRECT_HEADLESS_REAL_SMOKE || "").trim()) ||
    /^(1|true|yes)$/i.test(String(process.env.CODEX_DIRECT_REAL_TURN || "").trim());
}

function platformAppDataRoot() {
  if (process.platform === "win32") return envString("APPDATA", path.join(os.homedir(), "AppData", "Roaming"));
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support");
  return envString("XDG_CONFIG_HOME", path.join(os.homedir(), ".config"));
}

function normalizeProfileName(value) {
  const text = normalizeString(value, "");
  if (!text || text === "default") return "";
  return text.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function existingFileMtimeMs(targetPath) {
  try {
    return fs.statSync(targetPath).mtimeMs;
  } catch {
    return 0;
  }
}

function uniquePaths(values) {
  const seen = new Set();
  return values.filter((value) => {
    const normalized = path.resolve(value);
    const key = process.platform === "win32" ? normalized.toLowerCase() : normalized;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function defaultAppUserDataRoot() {
  const profileName = normalizeProfileName(process.env[PROFILE_ENV_VAR]);
  const configuredRoot = envString(USER_DATA_ROOT_ENV_VAR, "");
  if (profileName) {
    return path.join(configuredRoot || path.join(platformAppDataRoot(), APP_TITLE), profileName);
  }
  const canonicalUserDataPath = path.join(platformAppDataRoot(), APP_TITLE);
  const legacyUserDataPath = path.join(platformAppDataRoot(), "codex-review-shell");
  const candidates = uniquePaths([canonicalUserDataPath, legacyUserDataPath]);
  let selectedPath = canonicalUserDataPath;
  let selectedMtime = 0;
  for (const candidate of candidates) {
    const mtime = existingFileMtimeMs(path.join(candidate, CONFIG_FILE_NAME));
    if (mtime > selectedMtime) {
      selectedPath = candidate;
      selectedMtime = mtime;
    }
  }
  return selectedPath;
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

function tempFilePath(targetPath) {
  return path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.${crypto.randomUUID().slice(0, 8)}.tmp`);
}

function writeJsonAtomic(filePath, value) {
  ensureDirectory(path.dirname(filePath));
  const tempPath = tempFilePath(filePath);
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch {}
    throw error;
  }
  return value;
}

function loadConfig(appUserDataRoot) {
  const config = readJsonFile(path.join(appUserDataRoot, CONFIG_FILE_NAME));
  return isPlainObject(config) ? config : { projects: [] };
}

function projectById(config, projectId, options = {}) {
  const projects = Array.isArray(config.projects) ? config.projects : [];
  const found = projects.find((project) => normalizeString(project?.id, "") === projectId);
  if (found) return structuredClone(found);
  const workspacePath = optionString(options, "workspace-path", process.cwd());
  const workspaceKind = optionString(options, "workspace-kind", "local");
  return {
    id: projectId,
    name: projectId,
    repoPath: workspacePath,
    workspace: workspaceKind === "wsl"
      ? { kind: "wsl", linuxPath: workspacePath }
      : { kind: "local", localPath: workspacePath },
    surfaceBinding: {
      codex: {
        runtimeMode: "direct-experimental",
        directTransport: "live-text",
        directTier: "text-only",
      },
    },
  };
}

function firstModelFromProfile(profileDoc = {}) {
  const models = profileDoc.profile?.ontology?.models;
  const entries = Array.isArray(models) ? models : [];
  const accepted = entries.find((model) => model?.id && ["accepted", "probed", "runtime_probed"].includes(model.status));
  const usable = accepted || entries.find((model) => model?.id && model.status !== "rejected") || null;
  return normalizeString(usable?.id, "gpt-5.4");
}

function resolveModel(options = {}, project = {}, profileDoc = {}) {
  const cliModel = optionString(options, "model", "");
  if (cliModel) return { model: cliModel, modelSource: "cli-override" };
  const projectModel = normalizeString(project.surfaceBinding?.codex?.model, "");
  if (projectModel) return { model: projectModel, modelSource: "project-config" };
  return { model: firstModelFromProfile(profileDoc), modelSource: "runtime-default" };
}

function forceDirectTextProject(project = {}, model = "", reasoningEffort = "") {
  const surfaceBinding = isPlainObject(project.surfaceBinding) ? project.surfaceBinding : {};
  const codex = isPlainObject(surfaceBinding.codex) ? surfaceBinding.codex : {};
  return {
    ...project,
    surfaceBinding: {
      ...surfaceBinding,
      codex: {
        ...codex,
        runtimeMode: "direct-experimental",
        directTransport: "live-text",
        directTier: "text-only",
        model: normalizeString(model, codex.model || ""),
        reasoningEffort: normalizeString(reasoningEffort, codex.reasoningEffort || codex.reasoning_effort || ""),
      },
    },
  };
}

async function requestJson(baseUrl, pathName, token, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  try {
    return { response, body: text ? JSON.parse(text) : {} };
  } catch (error) {
    const detail = text ? ` Response preview: ${text.slice(0, 200)}` : "";
    throw Object.assign(
      new Error(`Failed to parse JSON response from ${pathName} with status ${response.status}.${detail}`),
      { code: "headless_real_smoke_invalid_json_response", cause: error },
    );
  }
}

async function waitForPacket(baseUrl, packetId, token, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await requestJson(baseUrl, `/v1/bridge/turn-packets/${encodeURIComponent(packetId)}`, token);
    assert.equal(result.response.status, 200);
    const packet = result.body.packet;
    if (["provider_completed", "failed", "handoff_unknown", "replay_unsafe"].includes(packet?.state)) return packet;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw Object.assign(new Error("headless_real_smoke_timeout"), { code: "headless_real_smoke_timeout" });
}

function assistantTextFromSession(session = {}, turnId = "") {
  if (!session) return "";
  const message = (Array.isArray(session.messages) ? session.messages : []).find((item) => item.id === turnId);
  const items = Array.isArray(message?.items) ? message.items : [];
  return items
    .filter((item) => item?.type === "agentMessage")
    .map((item) => normalizeString(item.text, ""))
    .filter(Boolean)
    .join("\n");
}

function safeReport(report = {}) {
  return {
    ...report,
    rawPromptIncluded: false,
    rawResponseIncluded: false,
    rawProviderPayloadIncluded: false,
    rawAuthTokensIncluded: false,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!liveProviderOptIn(options)) {
    console.error("Live provider call blocked. Pass --allow-live-provider-call or set CODEX_DIRECT_HEADLESS_REAL_SMOKE=1.");
    process.exitCode = 2;
    return;
  }
  const projectId = optionString(options, "project-id", "headless_real_smoke");
  const prompt = optionString(options, "prompt", DEFAULT_PROMPT);
  const appUserDataRoot = path.resolve(optionString(options, "app-user-data-root", envString("CODEX_DIRECT_APP_USER_DATA_ROOT", defaultAppUserDataRoot())));
  const profileDoc = loadDirectCodexProfile();
  const config = loadConfig(appUserDataRoot);
  let project = projectById(config, projectId, options);
  const modelChoice = resolveModel(options, project, profileDoc);
  const reasoningEffort = optionString(options, "reasoning-effort", optionString(options, "effort", normalizeString(project.surfaceBinding?.codex?.reasoningEffort || project.surfaceBinding?.codex?.reasoning_effort, "")));
  project = forceDirectTextProject(project, modelChoice.model, reasoningEffort);

  const authRoot = optionString(options, "auth-root", path.join(appUserDataRoot, "direct-auth"));
  const primaryAuthStore = createDirectAuthStore({ mode: "file", rootDir: authRoot });
  const codexCliAuthStore = createCodexCliAuthStore({ filePath: optionString(options, "codex-auth-file", "") });
  const authStore = createDirectAuthCompositeStore({ primaryStore: primaryAuthStore, fallbackStore: codexCliAuthStore });
  const authLogin = createDirectAuthLoginCoordinator();
  let authStatus = authStore.readStatus();
  if (authStatus.status === "expired" || authStatus.status === "refresh_failed") {
    await authLogin.refreshCredentials({ activeStore: () => authStore });
    authStatus = authStore.readStatus();
  }
  if (authStatus.status !== "authenticated") {
    throw Object.assign(new Error("headless_real_smoke_login_required"), { code: "headless_real_smoke_login_required" });
  }

  const endpoint = optionString(options, "endpoint", envString("CODEX_DIRECT_RESPONSES_ENDPOINT", DEFAULT_CODEX_RESPONSES_ENDPOINT || DEFAULT_ENDPOINT));
  const sessionRoot = path.resolve(optionString(options, "session-root", path.join(appUserDataRoot, "direct-sessions")));
  const bridgeRoot = path.resolve(optionString(options, "bridge-root", path.join(appUserDataRoot, "direct-headless-bridge-real-smoke")));
  const reportRoot = path.resolve(optionString(options, "report-root", path.join(appUserDataRoot, "direct-headless-smoke-reports")));
  const runId = optionString(options, "run-id", `headless_real_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`);
  const timeoutMs = Math.max(5_000, Number(optionString(options, "timeout-ms", String(DEFAULT_TIMEOUT_MS))) || DEFAULT_TIMEOUT_MS);
  const token = crypto.randomUUID();
  const threadId = optionString(options, "thread-id", `direct_headless_real_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`);
  const clientId = "headless_real_smoke_client";
  const routeId = "headless_real_smoke_route";

  const evidenceStore = new DirectLiveProbeEvidenceStore({
    rootDir: optionString(options, "evidence-root", path.join(appUserDataRoot, "direct-probe-evidence")),
  });
  const modelEvidenceResolver = ({ profileDoc: scopedProfile, model, endpoint: scopedEndpoint, authStatus: scopedAuthStatus, credentials }) =>
    evidenceStore.resolveModelEvidence({
      project,
      profileDoc: scopedProfile,
      model,
      endpoint: scopedEndpoint,
      authStatus: scopedAuthStatus,
      credentials,
    });

  const sessionStore = new DirectSessionStore({ rootDir: sessionRoot });
  const directThreadStore = new DirectThreadStore({ rootDir: sessionRoot, mode: "context_build_required" });
  const controller = new DirectLiveTextController({
    sessionStore,
    directThreadStore,
    profileDoc,
    authStore,
    refreshCredentials: () => authLogin.refreshCredentials({ activeStore: () => authStore }),
    modelEvidenceResolver,
    endpoint,
  });
  const daemon = new DirectHeadlessBridgeDaemon({
    rootDir: bridgeRoot,
    host: "127.0.0.1",
    port: 0,
    clients: [{
      clientId,
      status: "active",
      authMode: "capability_token",
      capabilityToken: token,
      allowedIngressContracts: ["headless_text_event@1"],
      allowedRoutes: [routeId],
    }],
    workThreads: [{
      workThreadId: `wt_${runId}`,
      status: "active",
      projectId,
    }],
    routes: [{
      routeId,
      routeVersion: "v1",
      status: "active",
      ingressContractRef: "headless_text_event@1",
      workThreadId: `wt_${runId}`,
      targetThreadRef: {
        runtimePath: "direct-text",
        threadId,
      },
      contextPolicyRef: DIRECT_EMPTY_CONTEXT_SHAPE,
      modelPolicyRef: "direct_headless_real_smoke_model_policy@1",
      outputReducerRef: "terminal-result-only",
      authorityBoundaryRef: "headless-real-smoke-no-tools",
      toolAuthorityMode: "disabled",
    }],
  });
  daemon.textRuntime = new DirectHeadlessTextRuntime({
    store: daemon.store,
    controller,
    project,
    artifactRoot: path.join(bridgeRoot, "artifacts"),
  });

  try {
    const address = await daemon.listen();
    const baseUrl = `http://${address.host}:${address.port}`;
    const submitted = await requestJson(baseUrl, "/v1/bridge/events", token, {
      method: "POST",
      body: JSON.stringify({
        clientId,
        idempotencyKey: runId,
        eventSchema: "headless_text_event@1",
        eventClass: "operator_message",
        eventKind: "direct_text",
        sourceSystem: "headless-real-smoke",
        requestedRouteId: routeId,
        model: modelChoice.model,
        reasoningEffort,
        text: prompt,
      }),
    });
    assert.equal(submitted.response.status, 202);
    assert.equal(submitted.body.ok, true);
    assert.equal(submitted.body.turnPacket.schema, "headless_turn_packet@1");
    const packet = await waitForPacket(baseUrl, submitted.body.turnPacket.packetId, token, timeoutMs);
    const session = sessionStore.readSession(threadId);
    const assistantText = assistantTextFromSession(session, packet.providerTurnId || packet.turnId);
    const status = await requestJson(baseUrl, "/v1/bridge/status", token);
    const completed = packet.state === "provider_completed" && Boolean(assistantText);
    const report = safeReport({
      schema: "direct_headless_real_smoke_report@1",
      runId,
      status: completed ? "completed" : "failed",
      projectId,
      threadId,
      packetId: packet.packetId,
      turnId: packet.providerTurnId || packet.turnId || "",
      model: normalizeString(session?.model, modelChoice.model),
      reasoningEffort: normalizeString(session?.reasoningEffort, reasoningEffort),
      requestShapeHash: directTextRequestShapeHash(),
      endpointHash: endpointHash(endpoint),
      providerStarted: packet.providerStarted === true,
      providerCompleted: packet.providerCompleted === true,
      terminalPacketState: packet.state,
      terminalTurnState: normalizeString(packet.terminalTurnState, ""),
      failure: completed ? null : {
        code: normalizeString(packet.error?.code || packet.reason || packet.blockerCode, packet.state || "headless_real_smoke_failed"),
        rendererSafeMessage: normalizeString(packet.error?.message || packet.reason || packet.blockerCode, "Headless real smoke did not complete."),
        providerStarted: packet.providerStarted === true,
      },
      assistantTextDigest: assistantText ? sha256(assistantText) : "",
      assistantTextPreview: "",
      assistantTextPreviewRedacted: Boolean(assistantText),
      assistantCharCount: assistantText.length,
      bridgeStatus: {
        daemonState: normalizeString(status.body.daemonState, ""),
        turnPackets: status.body.turnPackets,
        textRuntime: status.body.textRuntime,
      },
      evidenceRefs: [{
        kind: "headless_turn_packet",
        artifactId: packet.packetId,
        rendererSafeLabel: "Headless real smoke turn packet",
      }, {
        kind: "direct_session",
        artifactId: threadId,
        rendererSafeLabel: "Direct session",
      }],
      createdAt: nowIso(),
    });
    const reportPath = path.join(reportRoot, `${runId}.json`);
    writeJsonAtomic(reportPath, report);
    if (optionFlag(options, "report-json", false)) console.log(JSON.stringify(report, null, 2));
    else console.log(reportPath);
    process.exitCode = report.status === "completed" ? 0 : 1;
  } finally {
    await daemon.close().catch(() => {});
    directThreadStore.close();
  }
}

main().catch((error) => {
  console.error(error?.code || error?.message || String(error));
  process.exit(1);
});
