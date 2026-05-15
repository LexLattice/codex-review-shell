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
} = runtimePath;

assert.deepEqual(DIRECT_RUNTIME_PATHS, ["app-server", "direct-text", "direct-implementation"]);

assert.equal(normalizeDirectRuntimePath("legacy-app-server"), "app-server");
assert.equal(normalizeDirectRuntimePath("appserver"), "app-server");
assert.equal(normalizeDirectRuntimePath("text-only"), "direct-text");
assert.equal(normalizeDirectRuntimePath("direct-live-text"), "direct-text");
assert.equal(normalizeDirectRuntimePath("implementation-lane"), "direct-implementation");
assert.equal(normalizeDirectRuntimePath("tools"), "direct-implementation");
assert.equal(normalizeDirectRuntimePath("unknown"), "app-server");

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
const htmlSource = read("src/renderer/index.html");

assertIncludes(mainSource, "setCodexRuntimePath", "main process runtime switch");
assertIncludes(mainSource, "direct-runtime:set-path", "main process IPC");
assertIncludes(mainSource, "activeDirectTurnCountForProject", "main process active direct turn guard");
assertIncludes(mainSource, "bindingForDirectRuntimePath", "main process persisted binding update");
assertIncludes(mainSource, "loadCodexSurface(savedProject", "main process reload after switch");
assertIncludes(preloadSource, "setDirectRuntimePath", "shell preload bridge");
assertIncludes(rendererSource, "directRuntimePathSelect", "shell renderer selector");
assertIncludes(rendererSource, "setDirectRuntimePathFromControl", "shell renderer apply action");
assertIncludes(rendererSource, "codexDefaultPathInput", "project drawer default selector");
assertIncludes(rendererSource, "directTier: runtimePathFields.directTier", "project drawer preserves direct tier");
assertIncludes(htmlSource, "Default Codex path", "shell UI label");
assertIncludes(htmlSource, "value=\"app-server\"", "app-server option");
assertIncludes(htmlSource, "value=\"direct-text\"", "direct text option");
assertIncludes(htmlSource, "value=\"direct-implementation\"", "direct implementation option");

console.log("direct runtime path switch regression passed");
