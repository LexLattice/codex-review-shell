import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

const { createDirectAuthStore } = require("../src/main/direct/auth/auth-store");
const { loadDirectCodexProfile } = require("../src/main/direct/odeu-profile/profile-loader");
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

if (process.env.CODEX_DIRECT_LIVE_PROBE !== "1") {
  console.error("Refusing to run live direct probe. Set CODEX_DIRECT_LIVE_PROBE=1 to make a real backend call.");
  process.exit(1);
}

const authFile = envString("CODEX_DIRECT_AUTH_FILE", "");
const authRoot = envString("CODEX_DIRECT_AUTH_ROOT", path.join(os.homedir(), ".codex-review-shell", "direct-auth"));
const sessionRoot = envString("CODEX_DIRECT_SESSION_ROOT", path.join(os.tmpdir(), "codex-review-shell-direct-live-probe-sessions"));
const endpoint = envString("CODEX_DIRECT_RESPONSES_ENDPOINT", DEFAULT_CODEX_RESPONSES_ENDPOINT);
const prompt = envString("CODEX_DIRECT_PROBE_PROMPT", DEFAULT_TEXT_PROBE_PROMPT);
const model = envString("CODEX_DIRECT_PROBE_MODEL", "");

const authStore = createDirectAuthStore(authFile ? { mode: "file", filePath: authFile } : { mode: "file", rootDir: authRoot });
const credentials = authStore.readCredentials();
if (!credentials?.accessToken) {
  console.error("No direct auth access token found. Set CODEX_DIRECT_AUTH_FILE or CODEX_DIRECT_AUTH_ROOT to the app direct-auth store.");
  process.exit(1);
}

const profileDoc = loadDirectCodexProfile();
const sessionStore = new DirectSessionStore({ rootDir: sessionRoot });
const result = await runPersistedTextOnlyDirectProbe({
  endpoint,
  credentials,
  profileDoc,
  model,
  prompt,
  sessionStore,
  project: {
    id: "manual_direct_text_probe",
    workspace: { kind: "local", localPath: "[REDACTED:private-path]" },
    surfaceBinding: { codex: { runtimeMode: "direct-experimental" } },
  },
});

console.log(JSON.stringify({
  schema: "direct_codex_live_text_probe_summary@1",
  ok: result.ok,
  endpoint: result.endpoint,
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
  diagnostic: result.diagnostic,
}, null, 2));
