import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const { defaultUsageLedgerConfig, normalizeUsageLedgerConfig } = require("../src/main/usage-ledger-config.js");
const mainPath = path.join(appRoot, "src", "main.js");
const source = fs.readFileSync(mainPath, "utf8");
const {
  normalizeCodexBindingProvider,
  normalizeDirectExperimentalRuntimeTier,
  normalizeCodexRuntimeMode: normalizeDirectRuntimeModeForStatus,
} = require("../src/main/direct/runtime/runtime-status");
const {
  defaultCodexHostRuntimeForWorkspace,
} = require("../src/main/direct/runtime/runtime-path-selection");
const {
  normalizeDirectWorkbenchProjectLifecycleCatalog,
} = require("../src/main/direct/project/project-directory");
const {
  normalizeWorldManagerRuntimePreferences,
} = require("../src/main/direct/worldmanager/runtime-settings");
const start = source.indexOf("function nowIso()");
const end = source.indexOf("async function loadConfig()", start);
if (start < 0 || end < 0) throw new Error("Unable to locate config-normalization block in main.js");

const sandbox = {
  console,
  crypto,
  Buffer,
  path,
  URL,
  process,
  repoRoot: appRoot,
  normalizeCodexBindingProvider,
  normalizeDirectExperimentalRuntimeTier,
  normalizeDirectRuntimeModeForStatus,
  defaultCodexHostRuntimeForWorkspace,
  normalizeDirectWorkbenchProjectLifecycleCatalog,
  normalizeWorldManagerRuntimePreferences,
  CODEX_THREAD_RUNTIME_PREF_MAX_ENTRIES: 500,
  defaultUsageLedgerConfig,
  normalizeUsageLedgerConfig,
};
vm.createContext(sandbox);
vm.runInContext(
  `${source.slice(start, end)}
this.normalizeConfig = normalizeConfig;
this.codexThreadRuntimePreferenceKey = codexThreadRuntimePreferenceKey;
this.findCodexThreadRuntimePreference = findCodexThreadRuntimePreference;`,
  sandbox,
  { filename: "main-config-slice.js" },
);

const legacyConfig = {
  version: 3,
  selectedProjectId: "project_legacy",
  ui: { splitRatio: 0.5 },
  runtimeDefaults: {
    codex: {
      approvalPolicy: "never",
      sandboxMode: "danger-full-access",
    },
  },
  codexThreadRuntimeDefaults: {
    legacy_pref: {
      projectId: "project_legacy",
      threadId: "thread_abc",
      sourceHome: "/home/rose/.codex",
      sessionFilePath: "/home/rose/.codex/sessions/thread_abc.jsonl",
      model: "gpt-5.5",
      reasoningEffort: "xhigh",
      updatedAt: "2026-05-06T00:00:00.000Z",
    },
  },
  projects: [
    {
      id: "project_legacy",
      name: "Legacy project",
      repoPath: appRoot,
      surfaceBinding: {
        codex: { mode: "local", target: "codex://local-workspace", label: "Local Codex lane" },
        chatgpt: { reviewThreadUrl: "https://chatgpt.com/c/legacy-review", reduceChrome: true },
      },
      flowProfile: {
        reviewPromptTemplate: "Review this.",
        watchedFilePatterns: ["**/*REVIEW*.md"],
        returnHeader: "GPT feedback",
      },
    },
  ],
};

const migrated = sandbox.normalizeConfig(legacyConfig);
const project = migrated.projects[0];
if (migrated.version !== 5) throw new Error(`Expected config version 5, got ${migrated.version}`);
if (migrated.runtimeDefaults?.codex?.approvalPolicy !== "never") throw new Error("Codex approval runtime default was not preserved.");
if (migrated.runtimeDefaults?.codex?.sandboxMode !== "danger-full-access") throw new Error("Codex sandbox runtime default was not preserved.");
const runtimePref = Object.values(migrated.codexThreadRuntimeDefaults || {})[0];
if (runtimePref?.threadId !== "thread_abc") throw new Error("Codex thread runtime preference was not preserved.");
if (runtimePref?.model !== "gpt-5.5" || runtimePref?.reasoningEffort !== "xhigh") {
  throw new Error("Codex thread model/reasoning preference was not preserved.");
}
if (migrated.projects[0]?.surfaceBinding?.codex?.spawnAgentModelOverrides !== false) {
  throw new Error("Missing spawn-agent model override intent must normalize to false.");
}
const truthyStringConfig = structuredClone(legacyConfig);
truthyStringConfig.projects[0].surfaceBinding.codex.spawnAgentModelOverrides = "true";
const normalizedTruthyString = sandbox.normalizeConfig(truthyStringConfig);
if (normalizedTruthyString.projects[0]?.surfaceBinding?.codex?.spawnAgentModelOverrides !== false) {
  throw new Error("String-valued spawn-agent model override intent must not become authority.");
}
const ultraConfig = structuredClone(legacyConfig);
ultraConfig.codexThreadRuntimeDefaults.legacy_pref.reasoningEffort = "ultra";
ultraConfig.projects[0].surfaceBinding.codex.reasoningEffort = "ultra";
ultraConfig.projects[0].surfaceBinding.codex.spawnAgentModelOverrides = true;
const normalizedUltra = sandbox.normalizeConfig(ultraConfig);
if (Object.values(normalizedUltra.codexThreadRuntimeDefaults || {})[0]?.reasoningEffort !== "ultra") {
  throw new Error("Ultra reasoning effort did not survive thread-preference normalization.");
}
if (normalizedUltra.projects[0]?.surfaceBinding?.codex?.reasoningEffort !== "ultra") {
  throw new Error("Ultra reasoning effort did not survive project-binding normalization.");
}
if (normalizedUltra.projects[0]?.surfaceBinding?.codex?.spawnAgentModelOverrides !== true) {
  throw new Error("Project-scoped spawn-agent model override intent did not survive normalization.");
}
const fallbackRuntimePref = sandbox.findCodexThreadRuntimePreference(migrated.codexThreadRuntimeDefaults, {
  projectId: "project_legacy",
  threadId: "thread_abc",
  sourceHome: "/different/home",
  sessionFilePath: "/different/session.jsonl",
});
if (fallbackRuntimePref.match !== "thread" || fallbackRuntimePref.value?.model !== "gpt-5.5") {
  throw new Error("Codex thread runtime preference did not fall back by project/thread identity.");
}
if (!Array.isArray(project.chatThreads) || project.chatThreads.length !== 1) throw new Error("Expected one migrated ChatGPT thread.");
if (project.surfaceBinding.codex.runtimeMode !== "legacy-app-server") throw new Error("Expected migrated Codex runtime mode to stay legacy app-server.");
if (project.surfaceBinding.codex.directTransport !== "fixture") throw new Error("Expected migrated direct transport to default to fixture.");
if (project.surfaceBinding.codex.bindingProvider !== "codex-compatible") throw new Error("Expected migrated Codex binding provider to stay Codex-compatible.");
if (project.surfaceBinding.codex.provider?.kind !== "codex_executable") throw new Error("Expected migrated runtime provider to stay Codex executable.");
const thread = project.chatThreads[0];
if (thread.role !== "review" || !thread.isPrimary) throw new Error("Migrated thread is not the primary review thread.");
if (thread.url !== "https://chatgpt.com/c/legacy-review") throw new Error(`Unexpected migrated URL: ${thread.url}`);
if (project.activeChatThreadId !== thread.id) throw new Error("Active thread was not set to the migrated review thread.");

const malformed = structuredClone(legacyConfig);
malformed.projects[0].surfaceBinding.chatgpt.reviewThreadUrl = "file:///not-safe";
const safe = sandbox.normalizeConfig(malformed).projects[0].chatThreads[0];
if (safe.url !== "https://chatgpt.com/") throw new Error("Malformed ChatGPT URL did not fail closed to https://chatgpt.com/.");

console.log("Config migration smoke passed.");
