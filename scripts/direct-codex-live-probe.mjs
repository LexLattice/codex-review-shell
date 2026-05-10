import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const APP_TITLE = "Codex Review Shell";
const CONFIG_FILE_NAME = "workspace-config.json";
const PROFILE_ENV_VAR = "CODEX_REVIEW_SHELL_PROFILE";
const USER_DATA_ROOT_ENV_VAR = "CODEX_REVIEW_SHELL_USER_DATA_ROOT";

const { createDirectAuthStore } = require("../src/main/direct/auth/auth-store");
const { createCodexCliAuthStore, createDirectAuthCompositeStore } = require("../src/main/direct/auth/codex-cli-auth");
const { loadDirectCodexProfile } = require("../src/main/direct/odeu-profile/profile-loader");
const {
  DirectLiveProbeEvidenceStore,
  FIXED_LIVE_TEXT_PROBE_PROMPT_CLASS,
  MANUAL_LIVE_PROBE_SOURCE,
  endpointHash,
} = require("../src/main/direct/probes/live-probe-evidence-store");
const { DirectSessionStore } = require("../src/main/direct/session/session-store");
const {
  DEFAULT_CODEX_RESPONSES_ENDPOINT,
  DEFAULT_TEXT_PROBE_PROMPT,
  runPersistedTextOnlyDirectProbe,
} = require("../src/main/direct/transport/codex-responses-transport");

function envString(name, fallback = "") {
  return typeof process.env[name] === "string" && process.env[name].trim()
    ? process.env[name].trim()
    : fallback;
}

function envFlag(name) {
  return /^(1|true|yes)$/i.test(String(process.env[name] || "").trim());
}

function normalizeProfileName(value) {
  const text = typeof value === "string" && value.trim() ? value.trim() : "";
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

function platformAppDataRoot() {
  if (process.platform === "win32") {
    return envString("APPDATA", path.join(os.homedir(), "AppData", "Roaming"));
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support");
  }
  return envString("XDG_CONFIG_HOME", path.join(os.homedir(), ".config"));
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

if (process.env.CODEX_DIRECT_LIVE_PROBE !== "1") {
  console.error("Refusing to run live direct probe. Set CODEX_DIRECT_LIVE_PROBE=1 to make a real backend call.");
  process.exit(1);
}

if (process.env.CI === "true" && process.env.CODEX_DIRECT_LIVE_PROBE_ALLOW_CI !== "1") {
  console.error("Refusing to run live direct probe in CI. Set CODEX_DIRECT_LIVE_PROBE_ALLOW_CI=1 as an explicit second gate.");
  process.exit(1);
}

const appUserDataRoot = envString("CODEX_DIRECT_APP_USER_DATA_ROOT", defaultAppUserDataRoot());
const authFile = envString("CODEX_DIRECT_AUTH_FILE", "");
const authRoot = envString("CODEX_DIRECT_AUTH_ROOT", path.join(appUserDataRoot, "direct-auth"));
const sessionRoot = envString("CODEX_DIRECT_SESSION_ROOT", path.join(os.tmpdir(), "codex-review-shell-direct-live-probe-sessions"));
const evidenceRoot = envString("CODEX_DIRECT_PROBE_EVIDENCE_ROOT", path.join(appUserDataRoot, "direct-probe-evidence"));
const endpoint = envString("CODEX_DIRECT_RESPONSES_ENDPOINT", DEFAULT_CODEX_RESPONSES_ENDPOINT);
const prompt = envString("CODEX_DIRECT_PROBE_PROMPT", DEFAULT_TEXT_PROBE_PROMPT);
const model = envString("CODEX_DIRECT_PROBE_MODEL", "");
const evidenceTtlMs = Number(process.env.CODEX_DIRECT_PROBE_EVIDENCE_TTL_MS || 0) || 0;
const projectId = envString("CODEX_DIRECT_PROBE_PROJECT_ID", "manual_direct_text_probe");
const workspaceKind = envString("CODEX_DIRECT_PROBE_WORKSPACE_KIND", "local");
const workspacePath = envString("CODEX_DIRECT_PROBE_WORKSPACE_PATH", "");
const failOnNonRunnableEvidence = envFlag("CODEX_DIRECT_PROBE_FAIL_ON_NON_RUNNABLE");
const promptClass = prompt === DEFAULT_TEXT_PROBE_PROMPT
  ? FIXED_LIVE_TEXT_PROBE_PROMPT_CLASS
  : "custom-live-text-probe";

const authStore = createDirectAuthCompositeStore({
  primaryStore: createDirectAuthStore(authFile ? { mode: "file", filePath: authFile } : { mode: "file", rootDir: authRoot }),
  fallbackStore: createCodexCliAuthStore({
    filePath: envString("CODEX_DIRECT_CODEX_AUTH_FILE", ""),
  }),
});
const credentials = authStore.readCredentials();
if (!credentials?.accessToken) {
  console.error("No direct auth access token found. Set CODEX_DIRECT_AUTH_FILE or CODEX_DIRECT_AUTH_ROOT to the app direct-auth store.");
  process.exit(1);
}

const profileDoc = loadDirectCodexProfile();
const sessionStore = new DirectSessionStore({ rootDir: sessionRoot });
const evidenceStore = new DirectLiveProbeEvidenceStore({ rootDir: evidenceRoot });
const project = {
  id: projectId,
  workspace: {
    kind: workspaceKind,
    ...(workspacePath ? { localPath: workspacePath, linuxPath: workspacePath } : {}),
  },
  surfaceBinding: { codex: { runtimeMode: "direct-experimental", directTransport: "live-text" } },
};
const result = await runPersistedTextOnlyDirectProbe({
  endpoint,
  credentials,
  profileDoc,
  model,
  prompt,
  sessionStore,
  project,
});

const recorded = evidenceStore.recordProbeResult(result, {
  source: MANUAL_LIVE_PROBE_SOURCE,
  profileDoc,
  authStatus: authStore.readStatus(),
  credentials,
  endpoint,
  model: result.requestShape?.model || model,
  project,
  prompt,
  promptClass,
  ttlMs: evidenceTtlMs,
});

console.log(JSON.stringify({
  schema: "direct_codex_live_text_probe_summary@2",
  ok: result.ok,
  provider: {
    endpointClass: recorded.evidence.provider.endpointClass,
    endpointHash: endpointHash(endpoint),
  },
  evidence: {
    evidenceId: recorded.evidence.evidenceId,
    status: recorded.evidence.status,
    computedStatus: recorded.view.status,
    usable: recorded.view.usable,
    source: recorded.evidence.source,
    observedAt: recorded.evidence.createdAt,
    expiresAt: recorded.evidence.expiresAt,
    model: recorded.evidence.model,
    requestShapeHash: recorded.evidence.requestShape.shapeHash,
    promptClass: recorded.evidence.probePrompt.promptClass,
    failureKind: recorded.evidence.result.failureKind || "",
  },
  sessionId: result.sessionId,
  turnId: result.turnId,
  turnState: result.turnState,
  response: {
    status: result.response.status,
    ok: result.response.ok,
    contentType: result.response.contentType,
  },
  normalizedEventTypes: result.normalizedEvents.map((event) => event.type),
  unknownRawTypes: result.unknownRawTypes,
  diagnostic: {
    evidenceDiagnosticId: recorded.evidence.diagnostics.diagnosticId,
    redacted: true,
    rawAuthHeadersExposed: false,
    rawBackendRequestsExposed: false,
    rawBackendFramesExposed: false,
  },
}, null, 2));

if (failOnNonRunnableEvidence && !recorded.view.usable) {
  console.error(`Live probe completed but did not produce runnable evidence: ${recorded.view.status}`);
  process.exit(1);
}
