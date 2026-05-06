import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const mainPath = path.join(appRoot, "src", "main.js");
const source = fs.readFileSync(mainPath, "utf8");
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
  CODEX_THREAD_RUNTIME_PREF_MAX_ENTRIES: 500,
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
const thread = project.chatThreads[0];
if (thread.role !== "review" || !thread.isPrimary) throw new Error("Migrated thread is not the primary review thread.");
if (thread.url !== "https://chatgpt.com/c/legacy-review") throw new Error(`Unexpected migrated URL: ${thread.url}`);
if (project.activeChatThreadId !== thread.id) throw new Error("Active thread was not set to the migrated review thread.");

const malformed = structuredClone(legacyConfig);
malformed.projects[0].surfaceBinding.chatgpt.reviewThreadUrl = "file:///not-safe";
const safe = sandbox.normalizeConfig(malformed).projects[0].chatThreads[0];
if (safe.url !== "https://chatgpt.com/") throw new Error("Malformed ChatGPT URL did not fail closed to https://chatgpt.com/.");

console.log("Config migration smoke passed.");
