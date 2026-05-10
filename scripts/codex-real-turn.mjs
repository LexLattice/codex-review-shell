import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";

const require = createRequire(import.meta.url);

const APP_TITLE = "Codex Review Shell";
const CONFIG_FILE_NAME = "workspace-config.json";
const PROFILE_ENV_VAR = "CODEX_REVIEW_SHELL_PROFILE";
const USER_DATA_ROOT_ENV_VAR = "CODEX_REVIEW_SHELL_USER_DATA_ROOT";
const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_HEADLESS_ASSISTANT_PREVIEW_CHARS = 2000;
const MAX_HEADLESS_ERROR_PREVIEW_CHARS = 2000;
const MAX_HEADLESS_EVENT_TYPES = 256;
const MAX_HEADLESS_UNKNOWN_EVENT_TYPES = 128;
const DIRECT_EMPTY_CONTEXT_SHAPE = "direct_text_turn_empty_context@1";
const DIRECT_RECENT_DIALOGUE_SHAPE = "direct_text_turn_recent_dialogue@1";
const KNOWN_BENIGN_UNKNOWN_RAW_TYPES = new Set([
  "response.output_item.added",
  "response.output_item.done",
  "response.content_part.added",
  "response.content_part.done",
  "response.output_text.done",
]);

const { createDirectAuthStore } = require("../src/main/direct/auth/auth-store");
const { createDirectAuthIpcController } = require("../src/main/direct/auth/auth-ipc");
const { createDirectAuthLoginCoordinator } = require("../src/main/direct/auth/auth-login");
const { codexAuthTokensFromCredentials } = require("../src/main/direct/auth/app-server-auth-bridge");
const { createCodexCliAuthStore, createDirectAuthCompositeStore } = require("../src/main/direct/auth/codex-cli-auth");
const { loadDirectCodexProfile } = require("../src/main/direct/odeu-profile/profile-loader");
const {
  DirectLiveProbeEvidenceStore,
  directTextRequestShapeHash,
  endpointClass,
  endpointHash,
} = require("../src/main/direct/probes/live-probe-evidence-store");
const { DirectSessionStore } = require("../src/main/direct/session/session-store");
const { DirectThreadStore } = require("../src/main/direct/thread/thread-store");
const {
  DEFAULT_CODEX_RESPONSES_ENDPOINT,
  buildTextOnlyProbeRequest,
  requestShapeForDiagnostic,
  runTextOnlyDirectProbe,
} = require("../src/main/direct/transport/codex-responses-transport");
const { scanFixtureForSecrets } = require("../src/main/direct/fixtures/redaction");
const { CodexAppServerManager } = require("../src/main/codex-app-server");
const { CodexSurfaceSession } = require("../src/main/codex-surface-session");

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isPlainObject(value)) {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) output[key] = stableValue(value[key]);
    }
    return output;
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function digestValue(value) {
  return sha256(stableJson(value));
}

function safeIdPart(value, fallback = "id") {
  const text = normalizeString(value, fallback).replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return (text || fallback).slice(0, 96);
}

function envString(name, fallback = "") {
  return typeof process.env[name] === "string" && process.env[name].trim()
    ? process.env[name].trim()
    : fallback;
}

function envFlag(name) {
  return /^(1|true|yes)$/i.test(String(process.env[name] || "").trim());
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

function optionFlag(options, name, fallback = false) {
  const value = options[name];
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  return /^(1|true|yes)$/i.test(String(value || "").trim());
}

function optionString(options, name, fallback = "") {
  return normalizeString(options[name], fallback);
}

function normalizeProfileName(value) {
  const text = normalizeString(value, "");
  if (!text || text === "default") return "";
  return text.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function platformAppDataRoot() {
  if (process.platform === "win32") {
    return envString("APPDATA", path.join(os.homedir(), "AppData", "Roaming"));
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support");
  }
  return envString("XDG_CONFIG_HOME", path.join(os.homedir(), ".config"));
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
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(directory, 0o700);
    } catch {}
  }
}

function tempFilePath(targetPath) {
  return path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.${crypto.randomUUID().slice(0, 8)}.tmp`);
}

function writeJsonAtomic(filePath, value) {
  ensureDirectory(path.dirname(filePath));
  const tempPath = tempFilePath(filePath);
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    if (process.platform !== "win32") fs.chmodSync(tempPath, 0o600);
    fs.renameSync(tempPath, filePath);
    if (process.platform !== "win32") fs.chmodSync(filePath, 0o600);
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch {}
    throw error;
  }
}

function boundedText(value, maxChars) {
  const text = String(value || "");
  if (text.length <= maxChars) return text;
  let end = Math.max(0, maxChars);
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return text.slice(0, end);
}

function promptFromOptions(options) {
  const inline = optionString(options, "prompt", "");
  const promptFile = optionString(options, "prompt-file", "");
  if (inline && promptFile) {
    const error = new Error("Use either --prompt or --prompt-file, not both.");
    error.code = "prompt_input_conflict";
    throw error;
  }
  if (inline) return { source: "inline", text: inline, filePath: "" };
  if (promptFile) return { source: "file", text: fs.readFileSync(promptFile, "utf8"), filePath: promptFile };
  const error = new Error("Missing --prompt or --prompt-file.");
  error.code = "prompt_missing";
  throw error;
}

function loadConfig(appUserDataRoot) {
  const config = readJsonFile(path.join(appUserDataRoot, CONFIG_FILE_NAME));
  return isPlainObject(config) ? config : { projects: [] };
}

function projectWorkspace(project = {}) {
  const workspace = isPlainObject(project.workspace) ? project.workspace : {};
  if (workspace.kind === "wsl") return {
    kind: "wsl",
    evidencePath: normalizeString(workspace.linuxPath, project.repoPath || ""),
  };
  if (workspace.kind === "local") return {
    kind: "local",
    evidencePath: normalizeString(workspace.localPath, project.repoPath || process.cwd()),
  };
  return {
    kind: normalizeString(workspace.kind, "unknown"),
    evidencePath: normalizeString(workspace.linuxPath || workspace.localPath || project.repoPath, ""),
  };
}

function projectById(config, projectId, options = {}) {
  const projects = Array.isArray(config.projects) ? config.projects : [];
  const found = projects.find((project) => normalizeString(project?.id, "") === projectId);
  const workspaceKind = optionString(options, "workspace-kind", "");
  const workspacePath = optionString(options, "workspace-path", "");
  if (found) return structuredClone(found);
  return {
    id: projectId,
    name: projectId,
    repoPath: workspacePath || process.cwd(),
    workspace: workspaceKind === "wsl"
      ? { kind: "wsl", linuxPath: workspacePath || process.cwd() }
      : { kind: workspaceKind || "local", localPath: workspacePath || process.cwd() },
    surfaceBinding: {
      codex: {
        mode: "managed",
        runtimeMode: "legacy-app-server",
        runtime: workspaceKind === "wsl" ? "wsl" : "host",
        binaryPath: "codex",
      },
    },
  };
}

function applyWorkspaceOverride(project, options = {}) {
  const requestedKind = optionString(options, "workspace-kind", "");
  const requestedPath = optionString(options, "workspace-path", "");
  const current = projectWorkspace(project);
  const wantsOverride = Boolean(requestedKind || requestedPath);
  const sameKind = !requestedKind || requestedKind === current.kind;
  const samePath = !requestedPath || requestedPath === current.evidencePath;
  if (wantsOverride && (!sameKind || !samePath) && !optionFlag(options, "allow-workspace-override")) {
    const error = new Error("workspace_override_required");
    error.code = "workspace_override_required";
    throw error;
  }
  if (!wantsOverride) return { project, workspaceOverrideUsed: false };
  const nextKind = requestedKind || current.kind || "local";
  const nextPath = requestedPath || current.evidencePath || process.cwd();
  const nextProject = {
    ...project,
    repoPath: nextPath,
    workspace: nextKind === "wsl"
      ? { ...(isPlainObject(project.workspace) ? project.workspace : {}), kind: "wsl", linuxPath: nextPath }
      : { ...(isPlainObject(project.workspace) ? project.workspace : {}), kind: "local", localPath: nextPath },
  };
  return { project: nextProject, workspaceOverrideUsed: true };
}

function firstModelFromProfile(profileDoc = {}) {
  const models = profileDoc.profile?.ontology?.models;
  const entries = Array.isArray(models) ? models : [];
  const accepted = entries.find((model) => model?.id && ["accepted", "probed", "runtime_probed"].includes(model.status));
  const usable = accepted || entries.find((model) => model?.id && model.status !== "rejected") || null;
  return normalizeString(usable?.id, "gpt-5.4");
}

function resolveModel(options, project, profileDoc, runtime) {
  const cliModel = optionString(options, "model", "");
  if (cliModel) return { model: cliModel, modelSource: "cli-override" };
  const projectModel = normalizeString(project.surfaceBinding?.codex?.model, "");
  if (projectModel) return { model: projectModel, modelSource: "project-config" };
  if (runtime === "appserver") return { model: "", modelSource: "appserver-default" };
  return { model: firstModelFromProfile(profileDoc), modelSource: "runtime-default" };
}

function accountEvidenceKey(credentials = {}) {
  const value = normalizeString(credentials.accountId || credentials.chatgptAccountId, "");
  if (value) return `acct_${sha256(value).slice(0, 16)}`;
  const idToken = normalizeString(credentials.idToken || credentials.id_token, "");
  if (idToken) return `acct_${sha256(idToken).slice(0, 16)}`;
  return "";
}

function promptEnvelope(promptText, promptClass = "manual") {
  const promptDigest = sha256(promptText);
  const currentUserPromptHash = sha256(`current-user:${promptText}`);
  return {
    promptEnvelopeId: `prompt_env_${sha256(`${promptClass}:${promptDigest}`).slice(0, 24)}`,
    promptDigest,
    promptClass,
    currentUserPromptHash,
    runtimeNeutralIntentHash: sha256(`intent:${promptDigest}`),
  };
}

function baseReport(context) {
  const {
    runId,
    clientRunId,
    runtime,
    runMode,
    projectId,
    prompt,
    promptEnvelope: envelope,
    workspace,
    workspaceOverrideUsed,
    model,
    modelSource,
    requestShapeClass,
    requestShapeHash,
    liveProviderCallOptIn,
  } = context;
  return {
    schema: "headless_codex_run_report@1",
    runId,
    ...(clientRunId ? { clientRunId } : {}),
    runtime,
    runMode,
    projectId,
    startedAt: nowIso(),
    liveProviderCallOptIn: Boolean(liveProviderCallOptIn),
    providerRequestStarted: false,
    providerBytesObserved: false,
    status: "blocked",
    requestLifecycle: "preflight_blocked",
    auth: {
      authKind: runtime === "direct" ? "direct-chatgpt-codex" : "appserver-codex-login",
      authSource: "unknown",
      status: "unauthenticated",
      refreshAttempted: false,
      refreshOk: false,
      hasAccessToken: false,
      hasRefreshToken: false,
      accountEvidenceKey: "",
      rawTokensExposed: false,
    },
    runtimeEvidence: {
      model,
      modelSource,
      ...(requestShapeClass ? { requestShapeClass } : {}),
      ...(requestShapeHash ? { requestShapeHash } : {}),
    },
    prompt: {
      source: prompt.source,
      promptEnvelopeId: envelope.promptEnvelopeId,
      promptDigest: envelope.promptDigest,
      promptCharCount: prompt.text.length,
      promptPreviewRedacted: true,
      rawPromptExposed: false,
    },
    workspace: {
      workspaceKind: workspace.kind || "unknown",
      workspaceEvidenceKey: workspace.evidencePath ? `workspace_${sha256(workspace.evidencePath).slice(0, 16)}` : "",
      workspaceOverrideUsed: Boolean(workspaceOverrideUsed),
      rawWorkspacePathExposed: false,
    },
    artifacts: {
      reportId: runId,
      reportPathPrintedToStdout: false,
      artifactIds: [],
      rawPathsExposed: false,
    },
    request: {
      store: runtime === "direct" ? false : null,
      tools: runtime === "direct" ? false : null,
      previousResponseIdUsed: false,
      rawRequestBodyStored: false,
    },
    continuity: {
      previousResponseIdUsed: false,
      providerContinuityHandleUsed: false,
      importedContinuityHandleUsed: false,
    },
    stream: {
      normalizedEventTypes: [],
      unknownEvents: [],
      terminalState: "preflight_blocked",
      providerBytesObserved: false,
      toolExecuted: false,
      continuationSent: false,
    },
    assistant: {
      textPreview: "",
      textDigest: "",
      charCount: 0,
      rawReasoningExposed: false,
    },
    safety: {
      rawAuthHeadersExposed: false,
      rawBackendRequestsExposed: false,
      rawBackendFramesExposed: false,
      rawWorkspacePathsExposed: false,
      rawSourceHashesExposed: false,
    },
  };
}

function applyAuthStatus(report, status = {}, credentials = null) {
  report.auth.status = normalizeString(status.status, credentials?.accessToken ? "authenticated" : "unauthenticated");
  report.auth.authSource = normalizeString(status.source || credentials?.source, "direct-auth-store");
  report.auth.hasAccessToken = Boolean(status.hasAccessToken || credentials?.accessToken);
  report.auth.hasRefreshToken = Boolean(status.hasRefreshToken || credentials?.refreshToken);
  report.auth.accountEvidenceKey = accountEvidenceKey(credentials || {});
  return report;
}

function failureReport(report, code, message, options = {}) {
  const normalizedCode = typeof code === "string" && code.trim() ? code.trim() : `rpc_error_${String(code || "unknown").replace(/[^A-Za-z0-9_-]+/g, "_")}`;
  report.status = options.status || (code === "login_required" ? "login_required" : "blocked");
  report.requestLifecycle = options.requestLifecycle || "preflight_blocked";
  report.providerRequestStarted = Boolean(options.providerRequestStarted);
  report.providerBytesObserved = Boolean(options.providerBytesObserved);
  report.stream.providerBytesObserved = report.providerBytesObserved;
  report.stream.terminalState = options.terminalState || report.requestLifecycle;
  report.failure = {
    code: normalizedCode,
    rendererSafeMessage: boundedText(message || code, MAX_HEADLESS_ERROR_PREVIEW_CHARS),
    providerRequestStarted: report.providerRequestStarted,
  };
  report.completedAt = nowIso();
  return report;
}

function validateReport(report) {
  const required = [
    "schema",
    "runId",
    "runtime",
    "runMode",
    "projectId",
    "startedAt",
    "status",
    "requestLifecycle",
    "auth",
    "runtimeEvidence",
    "prompt",
    "workspace",
    "artifacts",
    "request",
    "continuity",
    "stream",
    "assistant",
    "safety",
  ];
  for (const key of required) {
    if (report[key] === undefined || report[key] === null) throw new Error(`Report missing ${key}.`);
  }
  if (report.schema !== "headless_codex_run_report@1") throw new Error("Invalid report schema.");
  if (!["appserver", "direct"].includes(report.runtime)) throw new Error("Invalid report runtime.");
  if (!["strict", "diagnostic-no-promotion"].includes(report.runMode)) throw new Error("Invalid report runMode.");
  return true;
}

function minimalRedactionFailureReport(report) {
  return {
    schema: "headless_codex_run_report@1",
    runId: report.runId,
    ...(report.clientRunId ? { clientRunId: report.clientRunId } : {}),
    runtime: report.runtime,
    runMode: report.runMode,
    projectId: report.projectId,
    startedAt: report.startedAt,
    completedAt: nowIso(),
    liveProviderCallOptIn: Boolean(report.liveProviderCallOptIn),
    providerRequestStarted: false,
    providerBytesObserved: false,
    status: "failed",
    requestLifecycle: "failed",
    auth: {
      authKind: report.auth?.authKind || "unknown",
      status: "unknown",
      refreshAttempted: false,
      refreshOk: false,
      hasAccessToken: false,
      hasRefreshToken: false,
      rawTokensExposed: false,
    },
    runtimeEvidence: {
      model: "",
      modelSource: "runtime-default",
    },
    prompt: {
      source: "inline",
      promptDigest: "",
      promptCharCount: 0,
      promptPreviewRedacted: true,
      rawPromptExposed: false,
    },
    workspace: {
      workspaceKind: "unknown",
      workspaceOverrideUsed: false,
      rawWorkspacePathExposed: false,
    },
    artifacts: {
      reportId: report.runId,
      reportPathPrintedToStdout: false,
      artifactIds: [],
      rawPathsExposed: false,
    },
    request: {
      store: null,
      tools: null,
      previousResponseIdUsed: false,
      rawRequestBodyStored: false,
    },
    continuity: {
      previousResponseIdUsed: false,
      providerContinuityHandleUsed: false,
      importedContinuityHandleUsed: false,
    },
    stream: {
      normalizedEventTypes: [],
      unknownEvents: [],
      terminalState: "raw_exposure_blocked",
      providerBytesObserved: false,
      toolExecuted: false,
      continuationSent: false,
    },
    assistant: {
      textPreview: "",
      textDigest: "",
      charCount: 0,
      rawReasoningExposed: false,
    },
    safety: {
      rawAuthHeadersExposed: false,
      rawBackendRequestsExposed: false,
      rawBackendFramesExposed: false,
      rawWorkspacePathsExposed: false,
      rawSourceHashesExposed: false,
    },
    failure: {
      code: "raw_exposure_blocked",
      rendererSafeMessage: "Report redaction failed before write.",
      providerRequestStarted: false,
    },
  };
}

function scanReport(report, roots = []) {
  return scanFixtureForSecrets(report, {
    privatePathRoots: roots.filter(Boolean),
  });
}

function reportPathForRun(appUserDataRoot, runId, options = {}) {
  const explicit = optionString(options, "report-file", "");
  if (explicit) return path.resolve(explicit);
  return path.join(appUserDataRoot, "headless-runs", safeIdPart(runId, "run"), "report.json");
}

function writeSafeReport(report, filePath, options = {}) {
  let candidate = report;
  try {
    validateReport(candidate);
    const findings = scanReport(candidate, options.privatePathRoots || []);
    if (findings.length) candidate = minimalRedactionFailureReport(candidate);
  } catch {
    candidate = minimalRedactionFailureReport(candidate);
  }
  writeJsonAtomic(filePath, candidate);
  return candidate;
}

function requestShapeClassForOptions(options) {
  const raw = optionString(options, "context-policy", DIRECT_EMPTY_CONTEXT_SHAPE);
  if (raw === "empty_context") return DIRECT_EMPTY_CONTEXT_SHAPE;
  if (raw === "recent_dialogue") return DIRECT_RECENT_DIALOGUE_SHAPE;
  return raw;
}

function classifyUnknownEvents(rawTypes = [], failOnUnknown = false) {
  return rawTypes.slice(0, MAX_HEADLESS_UNKNOWN_EVENT_TYPES).map((rawType) => {
    const safe = normalizeString(rawType, "unknown");
    const benign = KNOWN_BENIGN_UNKNOWN_RAW_TYPES.has(safe);
    return {
      rawTypeEvidenceKey: `raw_type_${sha256(safe).slice(0, 16)}`,
      normalizedAs: benign ? "ignored" : "",
      policy: benign ? "ignored-known-benign" : (failOnUnknown ? "blocked" : "diagnostic-only"),
    };
  });
}

function assistantTextFromNormalizedEvents(events = []) {
  return (Array.isArray(events) ? events : [])
    .filter((event) => event?.type === "message_delta")
    .map((event) => String(event.text || ""))
    .join("");
}

function reportExistingOrConflict(reportPath, context) {
  const existing = readJsonFile(reportPath);
  if (!existing) return null;
  const same = existing.runtime === context.runtime &&
    existing.projectId === context.projectId &&
    existing.prompt?.promptDigest === context.promptEnvelope.promptDigest &&
    existing.runtimeEvidence?.requestShapeHash === context.requestShapeHash;
  if (same) return { report: existing, conflict: false };
  const report = baseReport(context);
  return {
    report: failureReport(report, "client_run_id_conflict", "client-run-id was reused with different runtime, project, prompt, or request shape."),
    conflict: true,
  };
}

function directLiveOptIn(options) {
  return optionFlag(options, "allow-live-provider-call") || envFlag("CODEX_DIRECT_REAL_TURN");
}

function ciLiveOptInOk() {
  return process.env.CI !== "true" || envFlag("CODEX_DIRECT_REAL_TURN_ALLOW_CI");
}

async function withTimeout(promise, timeoutMs, code) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(code);
          error.code = code;
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runDirect(context) {
  const {
    options,
    appUserDataRoot,
    authStore,
    authController,
    authLogin,
    profileDoc,
    project,
    prompt,
    model,
    requestShapeClass,
    requestShapeHash,
    report,
  } = context;
  if (!directLiveOptIn(options)) {
    return failureReport(report, "live_provider_call_opt_in_missing", "Set CODEX_DIRECT_REAL_TURN=1 or pass --allow-live-provider-call to run a live direct turn.");
  }
  if (!ciLiveOptInOk()) {
    return failureReport(report, "live_provider_call_opt_in_missing", "CI direct live transport requires CODEX_DIRECT_REAL_TURN_ALLOW_CI=1.");
  }
  if (requestShapeClass !== DIRECT_EMPTY_CONTEXT_SHAPE || !optionFlag(options, "new-thread", false) || optionString(options, "thread-id", "")) {
    return failureReport(report, "unsupported_direct_context_policy_for_v0", "V0 direct headless runner supports only --new-thread with direct_text_turn_empty_context@1.");
  }
  if (optionFlag(options, "probe-if-missing") && !optionFlag(options, "diagnostic-probe-mode")) {
    return failureReport(report, "live_evidence_missing", "--probe-if-missing is restricted to diagnostic probe mode.");
  }

  let authStatus = authStore.readStatus();
  let credentials = authStore.readCredentials();
  applyAuthStatus(report, authStatus, credentials);
  if (!credentials?.accessToken) {
    return failureReport(report, "login_required", "Direct ChatGPT/Codex credentials are missing.", { status: "login_required" });
  }
  if (authStatus.status === "expired" || authStatus.status === "refresh_failed") {
    report.requestLifecycle = "auth_refreshing";
    report.auth.refreshAttempted = true;
    const refresh = await authLogin.refreshCredentials(authController);
    report.auth.refreshOk = refresh?.ok === true;
    authStatus = authStore.readStatus();
    credentials = authStore.readCredentials();
    applyAuthStatus(report, authStatus, credentials);
    if (!refresh?.ok || authStatus.status !== "authenticated") {
      return failureReport(report, "auth_refresh_failed", refresh?.reason || "Direct credential refresh failed.");
    }
  }
  if (authStatus.status !== "authenticated") {
    return failureReport(report, "login_required", "Direct ChatGPT/Codex credentials are not authenticated.", { status: "login_required" });
  }

  const endpoint = optionString(options, "endpoint", envString("CODEX_DIRECT_RESPONSES_ENDPOINT", DEFAULT_CODEX_RESPONSES_ENDPOINT));
  const evidenceStore = new DirectLiveProbeEvidenceStore({
    rootDir: optionString(options, "evidence-root", path.join(appUserDataRoot, "direct-probe-evidence")),
  });
  const evidence = evidenceStore.resolveModelEvidence({
    project,
    profileDoc,
    model,
    endpoint,
    authStatus,
    credentials,
  });
  report.runtimeEvidence.liveProbeEvidenceId = evidence.evidenceId || "";
  report.runtimeEvidence.liveProbeEvidenceStatus = evidence.liveProbeEvidence?.status || evidence.modelEvidenceState || "";
  if (model && evidence.model && evidence.model !== model) {
    return failureReport(report, "live_evidence_scope_mismatch", "Direct live evidence does not match the selected model.");
  }
  if (!evidence.accepted && context.runMode !== "diagnostic-no-promotion") {
    const reason = evidence.reason || "live_evidence_missing";
    const code = reason === "scope_mismatch"
      ? "live_evidence_scope_mismatch"
      : (reason === "candidate" ? "live_evidence_candidate" : (reason === "expired" ? "live_evidence_expired" : "live_evidence_missing"));
    return failureReport(report, code, `Direct live evidence is not runtime_probed: ${reason}.`);
  }
  report.runtimeEvidence.modelSource = evidence.accepted ? "live-probe-evidence" : context.modelSource;
  report.runtimeEvidence.model = evidence.accepted ? (evidence.model || model) : model;

  const sessionRoot = optionString(options, "session-root", path.join(appUserDataRoot, "direct-sessions"));
  const sessionStore = new DirectSessionStore({ rootDir: sessionRoot });
  const threadStore = new DirectThreadStore({ rootDir: sessionRoot, mode: "index_only" });
  let session = null;
  let turn = null;
  try {
    report.requestLifecycle = "context_building";
    const requestBodyInitial = buildTextOnlyProbeRequest({
      profileDoc,
      model: evidence.accepted ? (evidence.model || model) : model,
      prompt: prompt.text,
    });
    session = sessionStore.createSession({
      projectId: project.id,
      workspace: isPlainObject(project.workspace) ? project.workspace : {},
      workspaceDisplayPath: context.workspace.evidencePath,
      title: "Headless direct real turn",
      model: requestBodyInitial.model,
      runtimeMode: "direct-experimental",
      directTransport: "direct-live-text",
      modelSource: evidence.accepted ? "live-probe-evidence" : context.modelSource,
      modelEvidenceState: evidence.accepted ? "runtime_probed" : "diagnostic-no-promotion",
      modelEvidenceId: evidence.evidenceId || "",
      sourceClass: "direct-native",
      nativeDirectSession: true,
      providerContinuityAvailable: false,
    });
    turn = sessionStore.createTurn(session.sessionId, {
      input: [{ role: "user", text: prompt.text }],
      model: requestBodyInitial.model,
      clientTurnRequestId: context.clientRunId || context.runId,
      requestShape: requestShapeForDiagnostic(requestBodyInitial),
      previousResponseIdUsed: false,
      providerContinuityHandleUsed: false,
    });
    threadStore.indexSessionArtifacts(sessionStore, session, [turn]);
    const contextResult = threadStore.buildAndPersistContextForTextTurn({
      session: sessionStore.readSession(session.sessionId) || session,
      projectId: project.id,
      threadId: session.sessionId,
      turnId: turn.turnId,
      currentUserPrompt: prompt.text,
      useRecentDialogue: false,
      model: requestBodyInitial.model,
      requestShape: requestShapeForDiagnostic(requestBodyInitial),
      requestShapeHash,
      endpointClass: endpointClass(endpoint),
      endpointHash: endpointHash(endpoint),
      modelEvidenceRef: evidence.evidenceId || "",
      requestShapeEvidenceRef: DIRECT_EMPTY_CONTEXT_SHAPE,
      endpointEvidenceRef: endpointHash(endpoint),
    });
    report.requestLifecycle = "request_built";
    report.artifacts.sessionId = session.sessionId;
    report.artifacts.threadId = session.sessionId;
    report.artifacts.turnId = turn.turnId;
    report.artifacts.contextBuildId = contextResult.contextPack.contextBuildId;
    report.artifacts.requestManifestId = contextResult.requestManifest.requestManifestId;
    report.artifacts.artifactIds.push(
      session.sessionId,
      turn.turnId,
      contextResult.contextPack.contextBuildId,
      contextResult.requestManifest.requestManifestId,
    );
    const requestShape = {
      ...requestShapeForDiagnostic(requestBodyInitial),
      contextBuildId: contextResult.contextPack.contextBuildId,
      contextPackContentHash: contextResult.contextPack.contextPackContentHash,
      contextPackShapeHash: contextResult.contextPack.contextPackShapeHash,
      requestManifestId: contextResult.requestManifest.requestManifestId,
      providerInputShapeHash: contextResult.providerInput.projection.providerInputShapeHash,
      rawRequestBodyStored: false,
      previousResponseIdUsed: false,
    };
    sessionStore.updateTurnState(session.sessionId, turn.turnId, "request_built", {
      requestShape,
      contextBuildId: contextResult.contextPack.contextBuildId,
      requestManifestId: contextResult.requestManifest.requestManifestId,
      contextSummary: contextResult.rendererSafeSummary,
    });
    sessionStore.appendNormalizedEvents(session.sessionId, turn.turnId, [{
      type: "request_built",
      contextBuildId: contextResult.contextPack.contextBuildId,
      requestManifestId: contextResult.requestManifest.requestManifestId,
      requestShapeHash,
      previousResponseIdUsed: false,
      providerContinuityHandleUsed: false,
    }]);

    let handoffStarted = false;
    const result = await runTextOnlyDirectProbe({
      endpoint,
      authStore,
      refreshCredentials: () => authLogin.refreshCredentials(authController),
      profileDoc,
      model: requestBodyInitial.model,
      prompt: contextResult.providerInput.prompt,
      instructions: contextResult.providerInput.instructions,
      onLifecycle: (event) => {
        if (event.phase === "request_attempt") {
          handoffStarted = true;
          report.providerRequestStarted = true;
          report.requestLifecycle = "transport_handoff_started";
        }
        if (event.phase === "streaming") {
          report.providerBytesObserved = true;
          report.requestLifecycle = "streaming";
          sessionStore.updateTurnState(session.sessionId, turn.turnId, "streaming", {
            streamStartedAt: event.at,
            responseStatus: event.status,
            responseContentType: event.contentType,
          });
        }
      },
    });
    sessionStore.writeDiagnostic(session.sessionId, "headless_direct_real_turn", result.diagnostic);
    if (result.normalizedEvents.length) {
      sessionStore.appendNormalizedEvents(session.sessionId, turn.turnId, result.normalizedEvents);
    }
    const toolObligationResult = sessionStore.addToolObligations(session.sessionId, turn.turnId, result.normalizedEvents);
    const assistantText = assistantTextFromNormalizedEvents(result.normalizedEvents);
    const unknownEvents = classifyUnknownEvents(result.unknownRawTypes, optionFlag(options, "fail-on-unknown-event"));
    const blockedUnknown = unknownEvents.some((event) => event.policy === "blocked");
    const toolCallBlocked = toolObligationResult.obligations.length > 0 || result.toolDetection?.detected === true;
    let terminalState = result.terminal?.state || (result.ok ? "completed" : "failed");
    let status = terminalState === "completed" ? "completed" : "failed";
    let failureCode = "";
    if (toolCallBlocked) {
      terminalState = "tool_call_blocked_text_only";
      status = "blocked";
      failureCode = "provider_tool_call_in_text_only_tier";
    } else if (blockedUnknown) {
      terminalState = "provider_unknown_event";
      status = "failed";
      failureCode = "provider_unknown_event";
    } else if (!result.lifecycle?.streamStarted && handoffStarted) {
      terminalState = "transport_handoff_unknown";
      status = "failed";
      failureCode = "transport_handoff_unknown";
    } else if (terminalState !== "completed") {
      failureCode = result.terminal?.error?.code || result.error?.code || "provider_transport_failed";
    }
    sessionStore.updateTurnState(session.sessionId, turn.turnId, status === "completed" ? "completed" : "failed", {
      ...(failureCode ? { error: { code: failureCode, message: result.terminal?.error?.message || failureCode } } : {}),
      responseId: result.responseId || "",
      responseStatus: result.response?.status || 0,
      responseContentType: result.response?.contentType || "",
    });
    const nextSession = sessionStore.readSession(session.sessionId) || session;
    sessionStore.writeSession({
      ...nextSession,
      status: status === "completed" ? "completed" : "failed",
      updatedAt: nowIso(),
      messages: [
        ...((nextSession.messages || []).filter((message) => message.id !== turn.turnId)),
        {
          id: turn.turnId,
          status,
          items: [
            {
              id: `${turn.turnId}_user`,
              type: "userMessage",
              turnId: turn.turnId,
              content: [{ type: "text", text: prompt.text, text_elements: [] }],
            },
            ...(assistantText ? [{
              id: `${turn.turnId}_assistant`,
              type: "agentMessage",
              turnId: turn.turnId,
              text: assistantText,
            }] : []),
          ],
        },
      ],
    });
    threadStore.indexSessionArtifacts(sessionStore, sessionStore.readSession(session.sessionId), [
      sessionStore.readTurn(session.sessionId, turn.turnId),
    ].filter(Boolean));
    try {
      threadStore.buildRendererTranscriptProjection(session.sessionId, { sessionStore });
    } catch {}
    report.completedAt = result.completedAt || nowIso();
    report.status = context.runMode === "diagnostic-no-promotion" && status === "completed" ? "diagnostic" : status;
    report.requestLifecycle = terminalState === "transport_handoff_unknown"
      ? "transport_handoff_unknown"
      : (status === "completed" ? "completed" : "failed");
    report.providerRequestStarted = report.providerRequestStarted || handoffStarted || result.lifecycle?.attempts?.length > 0;
    report.providerBytesObserved = Boolean(report.providerBytesObserved || result.lifecycle?.streamStarted);
    report.stream.normalizedEventTypes = result.normalizedEvents.map((event) => event.type).filter(Boolean).slice(0, MAX_HEADLESS_EVENT_TYPES);
    report.stream.unknownEvents = unknownEvents;
    report.stream.terminalState = terminalState;
    report.stream.providerBytesObserved = report.providerBytesObserved;
    report.stream.toolExecuted = false;
    report.stream.continuationSent = false;
    report.assistant.textPreview = boundedText(assistantText, MAX_HEADLESS_ASSISTANT_PREVIEW_CHARS);
    report.assistant.textDigest = assistantText ? sha256(assistantText) : "";
    report.assistant.charCount = assistantText.length;
    if (failureCode) {
      report.failure = {
        code: failureCode,
        rendererSafeMessage: boundedText(result.terminal?.error?.message || result.error?.message || failureCode, MAX_HEADLESS_ERROR_PREVIEW_CHARS),
        providerRequestStarted: report.providerRequestStarted,
      };
    }
    return report;
  } finally {
    try {
      threadStore.close();
    } catch {}
  }
}

class HeadlessWebContents extends EventEmitter {
  constructor(events) {
    super();
    this.events = events;
  }

  isDestroyed() {
    return false;
  }

  send(channel, payload) {
    this.events.push({ channel, payload, at: nowIso() });
    this.emit("send", channel, payload);
  }
}

function appserverAssistantText(events) {
  return events
    .map((entry) => entry.payload)
    .filter((payload) => payload?.type === "rpc-notification" && payload.method === "item/agentMessage/delta")
    .map((payload) => String(payload.params?.delta || ""))
    .join("");
}

function waitForAppserverTerminal(webContents, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error("appserver_timeout"), { code: "appserver_timeout" })), timeoutMs);
    const onSend = (_channel, payload) => {
      if (payload?.type !== "rpc-notification") return;
      if (payload.method === "turn/completed") {
        clearTimeout(timer);
        webContents.off("send", onSend);
        resolve(payload.params || {});
      }
      if (payload.method === "error") {
        clearTimeout(timer);
        webContents.off("send", onSend);
        const error = new Error(payload.params?.error?.message || payload.params?.message || "appserver_turn_failed");
        error.code = payload.params?.error?.code || "appserver_turn_failed";
        reject(error);
      }
    };
    webContents.on("send", onSend);
  });
}

async function directAuthTokensForAppServer(authStore, authController, authLogin) {
  const store = authStore || authController.activeStore();
  let credentials = store.readCredentials();
  if (!credentials) return null;
  const status = store.readStatus();
  if (status.status === "expired" || status.status === "refresh_failed") {
    const refresh = await authLogin.refreshCredentials(authController);
    if (!refresh.ok) throw new Error(refresh.reason || refresh.status || "direct_auth_refresh_failed");
    credentials = store.readCredentials();
  }
  const projected = codexAuthTokensFromCredentials(credentials || {}, { includeType: true });
  if (!projected.ok) throw new Error(projected.reason || "direct_auth_tokens_unavailable");
  return projected.tokens;
}

async function runAppserver(context) {
  const { options, authStore, authController, authLogin, project, prompt, model, report } = context;
  const timeoutMs = Number(options["timeout-ms"] || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const authStatus = authStore.readStatus();
  const credentials = authStore.readCredentials();
  applyAuthStatus(report, authStatus, credentials);
  const manager = new CodexAppServerManager();
  const events = [];
  const webContents = new HeadlessWebContents(events);
  const surface = new CodexSurfaceSession(webContents);
  let managerSnapshot = null;
  try {
    report.requestLifecycle = "transport_handoff_started";
    managerSnapshot = await withTimeout(manager.ensureForProject(project, {
      readyTimeoutMs: timeoutMs,
    }), timeoutMs, "appserver_timeout");
    if (!managerSnapshot?.wsUrl || managerSnapshot.status !== "ready") {
      return failureReport(report, "appserver_unavailable", managerSnapshot?.error || "Codex app-server did not become ready.");
    }
    await withTimeout(surface.connect({
      wsUrl: managerSnapshot.wsUrl,
      projectId: project.id,
      workspaceRoot: managerSnapshot.workspaceRoot,
      chatgptAuthTokensProvider: () => directAuthTokensForAppServer(authStore, authController, authLogin),
    }), timeoutMs, "appserver_timeout");
    const initialize = await withTimeout(surface.request("initialize", {
      clientInfo: {
        name: "codex-review-shell-headless",
        version: "0.4.0",
      },
    }), timeoutMs, "appserver_timeout");
    report.appserver = {
      available: true,
      transport: "stdio",
      codexVersion: normalizeString(initialize?.codexVersion || initialize?.version, ""),
      schemaVersion: normalizeString(initialize?.schemaVersion || initialize?.protocolVersion, ""),
      initialized: true,
      rawProtocolFramesStored: false,
    };
    try {
      const tokens = await directAuthTokensForAppServer(authStore, authController, authLogin);
      if (tokens) await surface.request("account/login/start", tokens);
    } catch {
      // App-server may already own its login state. Keep baseline auth separate.
    }
    await surface.notify("initialized", {});
    const cwd = managerSnapshot.workspaceRoot || context.workspace.evidencePath || process.cwd();
    const threadResult = await withTimeout(surface.request("thread/start", {
      cwd,
      ...(model ? { model } : {}),
    }), timeoutMs, "appserver_timeout");
    const threadId = normalizeString(threadResult?.thread?.id || threadResult?.threadId, "");
    report.artifacts.threadId = threadId;
    if (threadId) report.artifacts.artifactIds.push(threadId);
    const terminalPromise = waitForAppserverTerminal(webContents, timeoutMs);
    await withTimeout(surface.request("turn/start", {
      threadId,
      input: [{ type: "text", text: prompt.text, text_elements: [] }],
      ...(model ? { model } : {}),
    }), timeoutMs, "appserver_timeout");
    report.providerRequestStarted = true;
    const terminal = await terminalPromise;
    const assistantText = appserverAssistantText(events);
    const eventTypes = events
      .map((entry) => entry.payload?.method || entry.payload?.type || "")
      .filter(Boolean)
      .slice(0, MAX_HEADLESS_EVENT_TYPES);
    report.completedAt = nowIso();
    report.status = "completed";
    report.requestLifecycle = "completed";
    report.providerBytesObserved = eventTypes.length > 0;
    report.stream.normalizedEventTypes = eventTypes;
    report.stream.terminalState = normalizeString(terminal.turn?.status || terminal.status, "completed");
    report.stream.providerBytesObserved = report.providerBytesObserved;
    report.assistant.textPreview = boundedText(assistantText, MAX_HEADLESS_ASSISTANT_PREVIEW_CHARS);
    report.assistant.textDigest = assistantText ? sha256(assistantText) : "";
    report.assistant.charCount = assistantText.length;
    return report;
  } catch (error) {
    const code = error?.code || (error?.message === "appserver_timeout" ? "appserver_timeout" : "appserver_unavailable");
    report.appserver = {
      available: Boolean(managerSnapshot?.wsUrl),
      transport: "stdio",
      initialized: false,
      rawProtocolFramesStored: false,
    };
    return failureReport(report, code, error?.message || code, {
      status: "failed",
      requestLifecycle: code === "appserver_timeout" ? "interrupted" : "failed",
      providerRequestStarted: report.providerRequestStarted,
      providerBytesObserved: report.providerBytesObserved,
    });
  } finally {
    try {
      await withTimeout(surface.dispose({ silent: true, reason: "Headless app-server run completed." }), 5_000, "appserver_dispose_timeout");
    } catch {}
    try {
      await withTimeout(manager.dispose(), 5_000, "appserver_dispose_timeout");
    } catch {}
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runtime = optionString(options, "runtime", "");
  if (!["direct", "appserver"].includes(runtime)) {
    console.error("Usage: node scripts/codex-real-turn.mjs --runtime=direct|appserver --project-id=<id> --prompt=<text>");
    process.exit(2);
  }
  const projectId = optionString(options, "project-id", "");
  if (!projectId) {
    console.error("Missing --project-id.");
    process.exit(2);
  }
  const appUserDataRoot = path.resolve(optionString(options, "app-user-data-root", envString("CODEX_DIRECT_APP_USER_DATA_ROOT", defaultAppUserDataRoot())));
  const config = loadConfig(appUserDataRoot);
  let project = projectById(config, projectId, options);
  let workspaceOverrideUsed = false;
  try {
    const applied = applyWorkspaceOverride(project, options);
    project = applied.project;
    workspaceOverrideUsed = applied.workspaceOverrideUsed;
  } catch (error) {
    const prompt = promptFromOptions(options);
    const envelope = promptEnvelope(prompt.text);
    const profileDoc = loadDirectCodexProfile();
    const modelChoice = resolveModel(options, project, profileDoc, runtime);
    const requestShapeClass = runtime === "direct" ? requestShapeClassForOptions(options) : "";
    const requestShapeHash = runtime === "direct" ? directTextRequestShapeHash() : "";
    const context = {
      runId: safeIdPart(optionString(options, "client-run-id", `headless_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`), "run"),
      clientRunId: optionString(options, "client-run-id", ""),
      runtime,
      runMode: optionString(options, "evidence-mode", "strict"),
      projectId,
      prompt,
      promptEnvelope: envelope,
      workspace: projectWorkspace(project),
      workspaceOverrideUsed: false,
      model: modelChoice.model,
      modelSource: modelChoice.modelSource,
      requestShapeClass,
      requestShapeHash,
      liveProviderCallOptIn: runtime === "direct" ? directLiveOptIn(options) : false,
    };
    const report = failureReport(baseReport(context), error.code || "workspace_override_required", error.message || "workspace_override_required");
    const reportPath = reportPathForRun(appUserDataRoot, context.runId, options);
    const written = writeSafeReport(report, reportPath, { privatePathRoots: [appUserDataRoot, context.workspace.evidencePath] });
    if (optionFlag(options, "report-json")) console.log(JSON.stringify(written, null, 2));
    else console.log(reportPath);
    process.exit(2);
  }
  const workspace = projectWorkspace(project);
  const prompt = promptFromOptions(options);
  const envelope = promptEnvelope(prompt.text);
  const profileDoc = loadDirectCodexProfile();
  const modelChoice = resolveModel(options, project, profileDoc, runtime);
  const requestShapeClass = runtime === "direct" ? requestShapeClassForOptions(options) : "";
  const requestShapeHash = runtime === "direct" ? directTextRequestShapeHash() : "";
  const clientRunId = optionString(options, "client-run-id", "");
  const runId = safeIdPart(clientRunId || `headless_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`, "run");
  const runMode = optionString(options, "evidence-mode", optionFlag(options, "require-live-evidence", true) ? "strict" : "diagnostic-no-promotion");
  const context = {
    options,
    appUserDataRoot,
    runId,
    clientRunId,
    runtime,
    runMode,
    projectId,
    project,
    prompt,
    promptEnvelope: envelope,
    workspace,
    workspaceOverrideUsed,
    profileDoc,
    model: modelChoice.model,
    modelSource: modelChoice.modelSource,
    requestShapeClass,
    requestShapeHash,
    liveProviderCallOptIn: runtime === "direct" ? directLiveOptIn(options) : false,
  };
  const reportPath = reportPathForRun(appUserDataRoot, runId, options);
  if (clientRunId) {
    const existing = reportExistingOrConflict(reportPath, context);
    if (existing) {
      const written = existing.conflict
        ? writeSafeReport(existing.report, reportPath, { privatePathRoots: [appUserDataRoot, workspace.evidencePath] })
        : existing.report;
      if (optionFlag(options, "report-json")) console.log(JSON.stringify(written, null, 2));
      else console.log(reportPath);
      process.exit(existing.conflict ? 2 : 0);
    }
  }
  const authRoot = optionString(options, "auth-root", path.join(appUserDataRoot, "direct-auth"));
  const authFile = optionString(options, "auth-file", "");
  const primaryAuthStore = createDirectAuthStore(authFile ? { mode: "file", filePath: authFile } : { mode: "file", rootDir: authRoot });
  const codexCliAuthStore = createCodexCliAuthStore({
    filePath: optionString(options, "codex-auth-file", ""),
  });
  const authStore = createDirectAuthCompositeStore({
    primaryStore: primaryAuthStore,
    fallbackStore: codexCliAuthStore,
  });
  const authController = createDirectAuthIpcController(authFile ? { mode: "file", filePath: authFile } : { mode: "file", rootDir: authRoot });
  const authLogin = createDirectAuthLoginCoordinator();
  context.authStore = authStore;
  context.authController = authController;
  context.authLogin = authLogin;
  const report = baseReport(context);
  let finalReport;
  try {
    finalReport = runtime === "direct"
      ? await runDirect({ ...context, report })
      : await runAppserver({ ...context, report });
  } catch (error) {
    finalReport = failureReport(report, error.code || "provider_transport_failed", error.message || "Headless run failed.", {
      status: "failed",
      requestLifecycle: report.providerRequestStarted ? "transport_handoff_unknown" : "failed",
      providerRequestStarted: report.providerRequestStarted,
      providerBytesObserved: report.providerBytesObserved,
    });
  }
  finalReport.artifacts.reportPathPrintedToStdout = !optionFlag(options, "report-json");
  const written = writeSafeReport(finalReport, reportPath, { privatePathRoots: [appUserDataRoot, workspace.evidencePath] });
  if (optionFlag(options, "report-json")) console.log(JSON.stringify(written, null, 2));
  else console.log(reportPath);
  const ok = ["completed", "diagnostic"].includes(written.status);
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
