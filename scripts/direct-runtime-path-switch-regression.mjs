import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const runtimePath = require(path.join(root, "src/main/direct/runtime/runtime-path-selection.js"));

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

function assertIncludes(source, needle, label) {
  assert.ok(source.includes(needle), `${label} should include ${needle}`);
}

const {
  DIRECT_RUNTIME_PATHS,
  normalizeDirectRuntimePath,
  directRuntimePathFromBinding,
  bindingForDirectRuntimePath,
  codexThreadNativeRuntime,
  directRuntimePathLabel,
  resolveCodexThreadOpenRuntime,
} = runtimePath;

assert.deepEqual(DIRECT_RUNTIME_PATHS, ["app-server", "direct-text", "direct-implementation"]);

assert.equal(normalizeDirectRuntimePath("legacy-app-server"), "app-server");
assert.equal(normalizeDirectRuntimePath("appserver"), "app-server");
assert.equal(normalizeDirectRuntimePath("direct"), "direct-implementation");
assert.equal(normalizeDirectRuntimePath("text-only"), "direct-text");
assert.equal(normalizeDirectRuntimePath("direct-live-text"), "direct-text");
assert.equal(normalizeDirectRuntimePath("implementation-lane"), "direct-implementation");
assert.equal(normalizeDirectRuntimePath("tools"), "direct-implementation");
assert.equal(normalizeDirectRuntimePath("unknown"), "app-server");
assert.equal(directRuntimePathLabel("direct-text"), "Direct");
assert.equal(directRuntimePathLabel("direct-implementation"), "Direct");
assert.equal(
  codexThreadNativeRuntime({ sessionFilePath: "/home/rose/.codex/sessions/thread.jsonl" }),
  "app-server",
);
assert.equal(codexThreadNativeRuntime({ nativeDirectSession: true }), "direct");
assert.equal(codexThreadNativeRuntime({}), "unknown");

assert.equal(
  directRuntimePathFromBinding({ runtimeMode: "legacy-app-server", directTransport: "fixture" }),
  "app-server",
);
assert.equal(
  directRuntimePathFromBinding({ runtimeMode: "direct-experimental", directTransport: "live-text", directTier: "text-only" }),
  "direct-text",
);
assert.equal(
  directRuntimePathFromBinding({ runtimeMode: "direct-experimental", directTransport: "live-text", directTier: "implementation-lane" }),
  "direct-implementation",
);

assert.deepEqual(
  resolveCodexThreadOpenRuntime(
    { runtimeMode: "direct-experimental", directTransport: "live-text", directTier: "implementation-lane" },
    { sessionFilePath: "/home/rose/.codex/sessions/thread.jsonl" },
  ),
  {
    schema: "codex_thread_runtime_route@1",
    nativeRuntime: "app-server",
    currentRuntimePath: "direct-implementation",
    selectedRuntimePath: "app-server",
    autoSwitch: true,
    continuityMode: "native_app_server_resume",
    directContinuationPosture: "secondary_checkpoint_continuation",
  },
);
assert.equal(
  resolveCodexThreadOpenRuntime(
    { runtimeMode: "direct-experimental", directTransport: "live-text", directTier: "implementation-lane" },
    { nativeDirectSession: true },
  ).autoSwitch,
  false,
);

const existingBinding = {
  mode: "managed",
  bindingProvider: "custom-codex-fork",
  runtimeMode: "legacy-app-server",
  directTransport: "fixture",
  directTier: "none",
  runtime: "wsl",
  profileId: "profile-alpha",
  target: "",
  binaryPath: "codex",
  model: "gpt-test",
  reasoningEffort: "high",
  label: "Managed Codex lane",
  provider: { kind: "codex_executable", flavor: "vanilla" },
};

assert.deepEqual(
  {
    bindingProvider: bindingForDirectRuntimePath(existingBinding, "app-server").bindingProvider,
    runtimeMode: bindingForDirectRuntimePath(existingBinding, "app-server").runtimeMode,
    directTransport: bindingForDirectRuntimePath(existingBinding, "app-server").directTransport,
    directTier: bindingForDirectRuntimePath(existingBinding, "app-server").directTier,
    model: bindingForDirectRuntimePath(existingBinding, "app-server").model,
    profileId: bindingForDirectRuntimePath(existingBinding, "app-server").profileId,
  },
  {
    bindingProvider: "codex-compatible",
    runtimeMode: "legacy-app-server",
    directTransport: "fixture",
    directTier: "none",
    model: "gpt-test",
    profileId: "profile-alpha",
  },
);

assert.deepEqual(
  {
    bindingProvider: bindingForDirectRuntimePath(existingBinding, "direct-text").bindingProvider,
    runtimeMode: bindingForDirectRuntimePath(existingBinding, "direct-text").runtimeMode,
    directTransport: bindingForDirectRuntimePath(existingBinding, "direct-text").directTransport,
    directTier: bindingForDirectRuntimePath(existingBinding, "direct-text").directTier,
    reasoningEffort: bindingForDirectRuntimePath(existingBinding, "direct-text").reasoningEffort,
  },
  {
    bindingProvider: "direct-chatgpt-codex",
    runtimeMode: "direct-experimental",
    directTransport: "live-text",
    directTier: "text-only",
    reasoningEffort: "high",
  },
);

assert.deepEqual(
  {
    bindingProvider: bindingForDirectRuntimePath(existingBinding, "direct-implementation").bindingProvider,
    runtimeMode: bindingForDirectRuntimePath(existingBinding, "direct-implementation").runtimeMode,
    directTransport: bindingForDirectRuntimePath(existingBinding, "direct-implementation").directTransport,
    directTier: bindingForDirectRuntimePath(existingBinding, "direct-implementation").directTier,
  },
  {
    bindingProvider: "direct-chatgpt-codex",
    runtimeMode: "direct-experimental",
    directTransport: "live-text",
    directTier: "implementation-lane",
  },
);

const mainSource = read("src/main.js");
const preloadSource = read("src/preload.js");
const codexSurfacePreloadSource = read("src/preload-codex-surface.js");
const rendererSource = read("src/renderer/app.js");
const codexSurfaceSource = read("src/renderer/codex-surface.js");
const htmlSource = read("src/renderer/index.html");
const codexSurfaceCss = read("src/renderer/codex-surface.css");

assertIncludes(mainSource, "setCodexRuntimePath", "main process runtime switch");
assertIncludes(mainSource, "direct-runtime:set-path", "main process IPC");
assertIncludes(mainSource, "direct-runtime:embark", "main process Direct embark IPC");
assertIncludes(mainSource, "direct-runtime:refresh-readiness", "task-scoped Direct readiness refresh IPC");
assertIncludes(mainSource, "direct-workbench:set-runtime-path", "Direct Workbench backend transition IPC");
assertIncludes(mainSource, "requireDirectWorkbenchExperience(\"direct-workbench:set-runtime-path\")", "Direct Workbench backend transition experience gate");
assertIncludes(mainSource, "deferSurfaceReload: true", "embedded backend transition returns before reloading its own trusted surface");
assertIncludes(mainSource, "schema: \"direct_thread_runtime_binding@1\"", "main process persists a canonical task runtime binding");
assertIncludes(mainSource, "modelSource: \"thread-runtime-binding\"", "task model selection supersedes the project seed at task scope");
assertIncludes(mainSource, "ensureDirectLiveTextController().statusForProject(project, { model: effectiveModel })", "task binding resolves exact-model readiness evidence");
assertIncludes(mainSource, "runtimeCapabilities = input.runtimeCapabilities || buildDirectLiveTextCapabilities(liveTextStatus)", "Direct projection publishes main-owned capabilities from the same task-scoped readiness witness");
assertIncludes(mainSource, "recordDirectEmbarkLiveProbe", "main process Direct embark probe transition");
assertIncludes(mainSource, "activeDirectTurnCountForProject", "main process active direct turn guard");
assertIncludes(mainSource, "bindingForDirectRuntimePath", "main process persisted binding update");
assertIncludes(mainSource, "loadCodexSurface(savedProject", "main process reload after switch");
assertIncludes(mainSource, "connectionRef: newId(\"direct_codex_conn\")", "direct local surface connection identity");
assertIncludes(mainSource, "setManagedCodexSurfaceAuthority(project, localUrl, \"direct-local-ready\")", "direct local surface authority registration");
assertIncludes(mainSource, "switchActiveCodexRuntimePath", "main process active-only runtime switch");
assertIncludes(mainSource, "resolveCodexThreadOpenRuntime", "thread opens resolve their native runtime before transport selection");
assertIncludes(mainSource, "codex-runtime-auto-routed", "native app-server thread opens expose the active-only runtime transition");
assertIncludes(mainSource, "A Direct turn is active. Wait before opening this app-server-native Codex thread.", "native runtime auto-routing preserves active Direct work");
assertIncludes(mainSource, "payload.persistDefault !== false", "main process runtime switch default persistence gate");
assertIncludes(mainSource, "ipcMain.handle(\"codex-surface:direct-projection\"", "Codex surface direct projection refresh endpoint");
assertIncludes(mainSource, "currentProject?.id && currentProject.id === requestedProjectId", "direct projection refresh uses active project before persisted config");
assert.ok(
  mainSource.indexOf("setManagedCodexSurfaceAuthority(project, localUrl, \"direct-local-ready\")") <
    mainSource.indexOf("if (codex.mode === \"url\")"),
  "Direct local surface authority must be registered before URL mode can load an external Codex surface.",
);
assertIncludes(preloadSource, "setDirectRuntimePath", "shell preload bridge");
assertIncludes(preloadSource, "embarkDirectRuntime", "shell preload Direct embark bridge");
assertIncludes(codexSurfacePreloadSource, "refreshDirectRuntimeReadiness", "embedded surface readiness refresh bridge");
assertIncludes(codexSurfacePreloadSource, "setDirectWorkbenchRuntimePath", "embedded surface backend transition bridge");
assertIncludes(rendererSource, "directRuntimePathSelect", "shell renderer selector");
assertIncludes(rendererSource, "setDirectRuntimePathFromControl", "shell renderer apply action");
assertIncludes(rendererSource, "embarkDirectRuntimeFromControl", "shell renderer Direct embark action");
assertIncludes(rendererSource, "codexDefaultPathInput", "project drawer default selector");
assertIncludes(rendererSource, "directTier: runtimePathFields.directTier", "project drawer preserves direct tier");
assertIncludes(rendererSource, ".toLowerCase()", "renderer path normalization");
assertIncludes(rendererSource, "directTier === \"text-only\" || directTier === \"text_only\"", "renderer text-only tier variants");
assertIncludes(rendererSource, "directTier === \"implementation-lane\" || directTier === \"implementation_lane\"", "renderer implementation tier variants");
assertIncludes(rendererSource, "const runtimePathChanged = requestedRuntimePath !== currentRuntimePath", "drawer detects runtime path changes");
assertIncludes(rendererSource, "const projectForConfig = runtimePathChanged ? projectWithRuntimePath(project, currentRuntimePath) : project", "drawer preserves previous path before guarded switch");
assertIncludes(rendererSource, "bridge.setDirectRuntimePath(project.id, requestedRuntimePath", "drawer routes project drawer runtime path changes through guarded IPC");
assertIncludes(rendererSource, "bridge.embarkDirectRuntime(project.id, options)", "runtime switch routes user-facing Direct through Direct embark");
assertIncludes(rendererSource, "directTextOption.disabled = false", "Direct backend option remains selectable before gate validation");
assertIncludes(rendererSource, "const persistDefault = true", "visible runtime picker persists the selected backend across restarts");
assertIncludes(rendererSource, "syncDirectRuntimePathControl(els.directRuntimePathSelect, els.directRuntimePathApplyButton, status, { persistDefault: true })", "drawer runtime picker renders using the same persisted-default scope it writes");
assertIncludes(rendererSource, "syncDirectRuntimePathControl(els.codexRuntimeQuickSelect, els.codexRuntimeQuickApplyButton, status, { compact: true, persistDefault: true })", "quick runtime picker renders using the same persisted-default scope it writes");
assertIncludes(rendererSource, "codexDefaultPathInput", "project drawer remains the persisted default selector");
assertIncludes(rendererSource, "persistDefault,", "runtime switch sends scope to main process");
assertIncludes(rendererSource, "Active Codex backend switched", "quick backend switch reports completed backend switch");
assertIncludes(rendererSource, "event.type === \"codex-runtime-auto-routed\"", "native thread auto-routing updates the shell's active runtime state");
assertIncludes(rendererSource, "state.activeCodexRuntimePathByProject[event.projectId] = event.toRuntimePath", "native thread auto-routing leaves the persisted default separate from active runtime state");
assert.ok(
  !rendererSource.includes("Set ${label} as this project's default Codex backend"),
  "Active backend switch should not show the old default-setting confirmation popup.",
);
const retryEmptyTurnSource = codexSurfaceSource.slice(
  codexSurfaceSource.indexOf("async function retryEmptyTurn"),
  codexSurfaceSource.indexOf("function renderTurnCompletionNotice"),
);
assertIncludes(retryEmptyTurnSource, "canRollback", "empty-turn retry capability gate");
assert.ok(
  retryEmptyTurnSource.indexOf("canRollback") < retryEmptyTurnSource.indexOf("thread/rollback"),
  "empty-turn retry must check rollback capability before calling thread/rollback.",
);
const openDirectThreadSource = codexSurfaceSource.slice(
  codexSurfaceSource.indexOf("async function openDirectThread"),
  codexSurfaceSource.indexOf("async function createDirectThreadFromStrip"),
);
assertIncludes(openDirectThreadSource, "await loadRuntimePreferences", "direct thread strip open reloads thread model/reasoning preferences");
assertIncludes(openDirectThreadSource, "guardThreadId: requestedThreadId", "direct thread preference load is guarded to the opened thread");
assertIncludes(openDirectThreadSource, "state.directThreadOpenRequestId !== openRequestId || state.threadId !== requestedThreadId", "direct thread open rechecks stale requests after preference load");
assertIncludes(codexSurfaceSource, "hasGuardSourceHome", "runtime preference guard distinguishes omitted source-home guard from explicit empty string");
assertIncludes(codexSurfaceSource, "hasGuardSessionFilePath", "runtime preference guard distinguishes omitted session-file guard from explicit empty string");
assertIncludes(codexSurfaceSource, "Refresh Direct readiness", "Direct runtime drawer exposes an in-place readiness action");
assertIncludes(codexSurfaceSource, "Changes the task backend. This is separate from refreshing Direct readiness.", "backend transition remains distinct from readiness refresh");
assertIncludes(codexSurfaceSource, "flushRuntimePreferenceWrites", "turn submission waits for the canonical task runtime binding");
assertIncludes(codexSurfaceSource, "The task binding is canonical for subsequent turns", "model controls explain task-level persistence");
assertIncludes(codexSurfaceSource, "function applyDirectSurfaceProjection", "renderer centralizes trusted Direct projection application");
assertIncludes(codexSurfaceSource, "capabilities: hasMainOwnedCapabilities", "renderer replaces stale connection capabilities with the main-owned refreshed projection");
assertIncludes(codexSurfaceSource, "if (!isDirectLiveTextSurface() && !hasCapability(\"turns\", \"canStart\"))", "Direct submission has one renderer readiness gate while app-server retains its capability gate");
const attachLiveThreadSource = codexSurfaceSource.slice(
  codexSurfaceSource.indexOf("async function attachLiveThread"),
  codexSurfaceSource.indexOf("function applyLiveThreadResult"),
);
assertIncludes(attachLiveThreadSource, "hasCapability(\"threads\", \"canResume\")", "live attachment calls resume only when the active backend declares it");
assertIncludes(attachLiveThreadSource, "hasCapability(\"threads\", \"canRead\")", "live attachment retains the read-only native Direct attach path");
assertIncludes(attachLiveThreadSource, "if (!result && options.skipReadFallback)", "stored transcript preservation still suppresses read fallback when resume is unavailable");
assertIncludes(rendererSource, "Continue in Direct", "imported app-server threads expose Direct checkpoint continuation as the secondary action");
const directQuotaSource = codexSurfaceSource.slice(
  codexSurfaceSource.indexOf("function composerQuotaLabel"),
  codexSurfaceSource.indexOf("function numericField"),
);
assertIncludes(directQuotaSource, "quotaState === \"unknown\"", "direct composer quota avoids unknown/usage mixed compact label");
const directContextSource = codexSurfaceSource.slice(
  codexSurfaceSource.indexOf("function directLatestUsageForCurrentThread"),
  codexSurfaceSource.indexOf("const usage = state.tokenUsage"),
);
assertIncludes(directContextSource, "latestUsage.inputTokensKnown", "direct context pressure mirrors app-server token usage using latest direct input tokens");
assertIncludes(directContextSource, "directLatestUsageForCurrentThread", "direct context pressure scopes direct usage rows to the displayed thread");
assertIncludes(directContextSource, "latestUsageByThread", "direct context pressure consumes per-thread usage summaries before falling back");
assertIncludes(directContextSource, "remainingContextPercent", "direct context pressure uses the same percent calculation as app-server context usage");
assert.ok(!directContextSource.includes("sourceClasses.join"), "direct context compact label should not expose raw diagnostic source classes.");
assert.ok(!rendererSource.includes("Direct blocked: ${directTextOnlyBlockedDetail(status)"), "Direct apply should not block before main-process embark can probe.");
assert.ok(!rendererSource.includes("renderProjects("), "renderer should not call undefined renderProjects()");
assertIncludes(htmlSource, "Codex backend", "shell UI label");
assertIncludes(htmlSource, "value=\"app-server\"", "app-server option");
assertIncludes(htmlSource, "value=\"direct-implementation\"", "user-facing direct option");
assertIncludes(htmlSource, "value=\"direct-text\" hidden", "direct text tier remains hidden fallback");
assert.ok(!htmlSource.includes("Direct Text"), "Direct text tier should not be a user-facing top-level option.");
assert.ok(!htmlSource.includes("Direct Tools"), "Direct tools tier should not be a user-facing top-level option.");
assertIncludes(codexSurfaceCss, "grid-template-areas:", "Codex surface shell uses named grid rows");
assertIncludes(codexSurfaceCss, "grid-area: transcript", "transcript row must not depend on direct rail visibility");
assertIncludes(codexSurfaceCss, "grid-area: composer", "composer row must not stretch into transcript row when direct rail is hidden");

console.log("direct runtime path switch regression passed");
