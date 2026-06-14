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
  directRuntimePathLabel,
} = runtimePath;

assert.deepEqual(DIRECT_RUNTIME_PATHS, ["app-server", "direct-text", "direct-implementation"]);

assert.equal(normalizeDirectRuntimePath("legacy-app-server"), "app-server");
assert.equal(normalizeDirectRuntimePath("appserver"), "app-server");
assert.equal(normalizeDirectRuntimePath("direct"), "direct-text");
assert.equal(normalizeDirectRuntimePath("text-only"), "direct-text");
assert.equal(normalizeDirectRuntimePath("direct-live-text"), "direct-text");
assert.equal(normalizeDirectRuntimePath("implementation-lane"), "direct-implementation");
assert.equal(normalizeDirectRuntimePath("tools"), "direct-implementation");
assert.equal(normalizeDirectRuntimePath("unknown"), "app-server");
assert.equal(directRuntimePathLabel("direct-text"), "Direct");
assert.equal(directRuntimePathLabel("direct-implementation"), "Direct");

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
const rendererSource = read("src/renderer/app.js");
const codexSurfaceSource = read("src/renderer/codex-surface.js");
const htmlSource = read("src/renderer/index.html");

assertIncludes(mainSource, "setCodexRuntimePath", "main process runtime switch");
assertIncludes(mainSource, "direct-runtime:set-path", "main process IPC");
assertIncludes(mainSource, "direct-runtime:embark", "main process Direct embark IPC");
assertIncludes(mainSource, "recordDirectEmbarkLiveProbe", "main process Direct embark probe transition");
assertIncludes(mainSource, "activeDirectTurnCountForProject", "main process active direct turn guard");
assertIncludes(mainSource, "bindingForDirectRuntimePath", "main process persisted binding update");
assertIncludes(mainSource, "loadCodexSurface(savedProject", "main process reload after switch");
assertIncludes(mainSource, "connectionRef: newId(\"direct_codex_conn\")", "direct local surface connection identity");
assertIncludes(mainSource, "setManagedCodexSurfaceAuthority(project, localUrl, \"direct-local-ready\")", "direct local surface authority registration");
assertIncludes(mainSource, "switchActiveCodexRuntimePath", "main process active-only runtime switch");
assertIncludes(mainSource, "payload.persistDefault !== false", "main process runtime switch default persistence gate");
assert.ok(
  mainSource.indexOf("setManagedCodexSurfaceAuthority(project, localUrl, \"direct-local-ready\")") <
    mainSource.indexOf("if (codex.mode === \"url\")"),
  "Direct local surface authority must be registered before URL mode can load an external Codex surface.",
);
assertIncludes(preloadSource, "setDirectRuntimePath", "shell preload bridge");
assertIncludes(preloadSource, "embarkDirectRuntime", "shell preload Direct embark bridge");
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
assertIncludes(rendererSource, "persistDefault = selectEl === els.directRuntimePathSelect", "runtime picker separates active switch from persisted default");
assertIncludes(rendererSource, "persistDefault: true", "settings runtime picker remains default-scoped");
assertIncludes(rendererSource, "persistDefault,", "runtime switch sends scope to main process");
assertIncludes(rendererSource, "Active Codex backend switched", "quick backend switch reports active session scope");
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
assert.ok(!rendererSource.includes("Direct blocked: ${directTextOnlyBlockedDetail(status)"), "Direct apply should not block before main-process embark can probe.");
assert.ok(!rendererSource.includes("renderProjects("), "renderer should not call undefined renderProjects()");
assertIncludes(htmlSource, "Codex backend", "shell UI label");
assertIncludes(htmlSource, "value=\"app-server\"", "app-server option");
assertIncludes(htmlSource, "value=\"direct-text\"", "user-facing direct option");
assert.ok(!htmlSource.includes("Direct Text"), "Direct text tier should not be a user-facing top-level option.");
assert.ok(!htmlSource.includes("Direct Tools"), "Direct tools tier should not be a user-facing top-level option.");
assert.ok(!htmlSource.includes("value=\"direct-implementation\""), "Implementation lane should remain an internal capability posture.");

console.log("direct runtime path switch regression passed");
