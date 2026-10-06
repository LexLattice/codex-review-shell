#!/usr/bin/env node

// Turn 9 of the dual-environment track: the Workbench shows which
// environment each project and thread lives in, picks a new project's
// environment from what this machine has, and browses folders through that
// environment's own executor. Runs on either host:
//   Windows:    node \\wsl.localhost\<distro>\<repo>\scripts\direct-workbench-environment-ux-regression.mjs
//   Linux/WSL:  node scripts/direct-workbench-environment-ux-regression.mjs

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const model = require("../src/renderer/direct-environment-ux-model");
const { buildDirectWorkbenchProjectDirectory } = require("../src/main/direct/project/project-directory");
const { DirectEnvironmentRegistry } = require("../src/main/environment-registry");
const { WorkspaceBackendManager } = require("../src/main/workspace-backend");

const read = (relative) => fs.readFile(path.join(repoRoot, relative), "utf8");
const report = { schema: "direct_workbench_environment_ux_regression_report@1", hostPlatform: process.platform, checks: [] };
const settle = async () => {
  for (let index = 0; index < 20; index += 1) await new Promise((resolve) => setImmediate(resolve));
};

// 1. The pure model.
assert.deepEqual(model.environmentBadge({ kind: "wsl", distro: "Ubuntu" }).text, "WSL · Ubuntu");
assert.equal(model.environmentBadge({ workspaceKind: "windows" }).text, "Windows");
assert.equal(model.environmentBadge({ kind: "local" }).kind, "local");
assert.equal(model.environmentBadge(null).kind, "unknown");
assert.equal(model.composerEnvironmentLabel({ kind: "wsl", distro: "Ubuntu" }), "WSL · Ubuntu · bash");
assert.equal(model.composerEnvironmentLabel({ kind: "windows" }), "Windows · PowerShell");
assert.equal(model.environmentIdForWorkspace({ kind: "wsl", distro: "Debian" }), "wsl:Debian");
assert.equal(model.environmentIdForWorkspace({ kind: "windows" }), "windows");
const environments = [
  { environmentId: "wsl:Ubuntu", kind: "wsl", distro: "Ubuntu", available: true },
  { environmentId: "wsl:docker-desktop", kind: "wsl", distro: "docker-desktop", system: true, available: true },
  { environmentId: "wsl:Debian", kind: "wsl", distro: "Debian", available: false, reason: "cross_distro_launch_unsupported" },
  { environmentId: "windows", kind: "windows", distro: "", host: true, available: true },
];
const options = model.environmentOptions(environments, { kind: "wsl", distro: "Alpine" });
assert.deepEqual(options.map((option) => option.value), ["windows", "wsl:Ubuntu", "wsl:Debian", "wsl:Alpine"]);
assert.equal(options[0].label, "Windows (this machine)", "this machine comes first");
assert.equal(options.find((option) => option.value === "wsl:Debian").disabled, true);
assert.match(options.at(-1).label, /not found on this machine/, "an existing project's environment is never lost");
assert.equal(model.pathFieldForKind("wsl"), "linuxPath");
const drivesView = model.folderBrowserView({ path: "", parent: "", pathStyle: "windows", entries: [{ name: "C:\\", path: "C:\\", kind: "directory" }] });
assert.equal(drivesView.displayPath, "Drives");
assert.equal(drivesView.canChoose, false);
const folderView = model.folderBrowserView({
  path: "/home/u",
  parent: "/home",
  pathStyle: "posix",
  entries: [
    { name: ".cache", path: "/home/u/.cache", kind: "directory", hidden: true },
    { name: "notes.txt", path: "/home/u/notes.txt", kind: "file" },
    { name: "work", path: "/home/u/work", kind: "directory", hidden: false },
  ],
});
assert.deepEqual(folderView.entries.map((entry) => entry.name), ["work", ".cache"], "files dropped, hidden folders last");
assert.equal(folderView.upTarget, "/home");
assert.equal(folderView.showDrives, false);
report.checks.push("environment_model");

// 2. Project rows carry the distro (an identity, not a path) and no paths.
const directory = buildDirectWorkbenchProjectDirectory({
  selectedProjectId: "p_wsl",
  projects: [
    { id: "p_wsl", name: "Linux project", workspace: { kind: "wsl", distro: "Ubuntu", linuxPath: "/home/u/secret-path" }, surfaceBinding: { codex: { runtimeMode: "direct", directTransport: "live-text", directTier: "implementation-lane" } } },
    { id: "p_win", name: "Windows project", workspace: { kind: "windows", windowsPath: "C:\\secret-path" }, surfaceBinding: { codex: { runtimeMode: "direct", directTransport: "live-text", directTier: "implementation-lane" } } },
  ],
}, { activeProjectId: "p_wsl" });
const rows = Object.fromEntries(directory.projects.map((row) => [row.projectId, row]));
assert.equal(rows.p_wsl.substrate.distro, "Ubuntu");
assert.equal(rows.p_win.substrate.distro, "");
assert.equal(JSON.stringify(directory).includes("secret-path"), false);
report.checks.push("project_rows_carry_environment");

// 3. Static contracts: markup, script order, the hidden text tier, IPC.
const html = await read("src/renderer/t3-direct-surface.html");
for (const id of [
  "directProjectBindingEnvironment", "directProjectFolderBrowser", "directProjectFolderBrowserList",
  "directProjectFolderBrowserUse", "composerEnvironmentChip", "morphicObservationsButton",
]) assert.match(html, new RegExp(`id="${id}"`), `${id} is in the Workbench`);
for (const kind of ["wsl", "windows", "local"]) assert.match(html, new RegExp(`data-direct-folder-browse="${kind}"`));
const scriptOrder = ["direct-environment-ux-model.js", "codex-surface.js", "direct-project-directory-surface.js"].map((name) => html.indexOf(name));
assert(scriptOrder.every((position) => position > 0) && scriptOrder[0] < scriptOrder[1] && scriptOrder[1] < scriptOrder[2], "the model loads before its users");
assert.match(html, /<option value="direct-text" hidden>/, "Direct · text stays only for existing projects");
const runtimeSelect = html.slice(html.indexOf('id="directProjectBindingRuntimePath"'), html.indexOf("</select>", html.indexOf('id="directProjectBindingRuntimePath"')));
assert.deepEqual([...runtimeSelect.matchAll(/<option value="([^"]+)"(?! hidden)>/g)].map((match) => match[1]), ["app-server", "direct-implementation"]);
const preload = await read("src/preload-codex-surface.js");
const workbenchBlock = preload.slice(preload.indexOf("if (directWorkbenchPreload)"));
assert.match(workbenchBlock, /listDirectWorkbenchEnvironments: \(\) =>\s*ipcRenderer\.invoke\("direct-workbench:environments"\)/);
assert.match(workbenchBlock, /browseDirectWorkbenchEnvironmentFolder: .*\n\s*ipcRenderer\.invoke\("direct-workbench:browse-environment-folder", payload\)/);
const mainSource = await read("src/main.js");
for (const channel of ["direct-workbench:environments", "direct-workbench:browse-environment-folder"]) {
  const handler = mainSource.slice(mainSource.indexOf(`ipcMain.handle("${channel}"`), mainSource.indexOf(`ipcMain.handle("${channel}"`) + 600);
  assert.match(handler, new RegExp(`requireFullCodexSurfaceBridge\\(event\\.sender, "${channel}"\\)`));
  assert.match(handler, new RegExp(`requireDirectWorkbenchExperience\\("${channel}"\\)`));
}
const surfaceSource = await read("src/renderer/codex-surface.js");
assert.match(surfaceSource, /function renderComposerEnvironmentChip\(\)/);
assert.match(surfaceSource, /morphic-thread-tab-badges/);
report.checks.push("workbench_contracts");

// 4. The project editor, driven in a fake DOM: picker, browser, submit.
class FakeElement {
  constructor(tagName = "div", id = "") {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.textContent = "";
    this.className = "";
    this.title = "";
    this.type = "";
  }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  dispatch(type) { for (const listener of this.listeners[type] || []) listener({ preventDefault() {} }); }
  click() { this.dispatch("click"); }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.children.push(node); return node; }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  querySelectorAll() { return []; }
  get classList() { return { toggle() {}, add() {}, remove() {} }; }
}
const descendants = (node) => [node, ...node.children.flatMap(descendants)];

async function mountProjectSurface(bridge) {
  const elements = new Map();
  const byId = (id) => {
    if (!elements.has(id)) elements.set(id, new FakeElement("div", id));
    return elements.get(id);
  };
  byId("directProjectBindingEditor").hidden = true;
  byId("directProjectFolderBrowser").hidden = true;
  const browseButtons = ["wsl", "windows", "local"].map((kind) => {
    const button = new FakeElement("button");
    button.dataset.directFolderBrowse = kind;
    return button;
  });
  const document = {
    getElementById: byId,
    querySelector: () => new FakeElement(),
    querySelectorAll: (selector) => (selector === "[data-direct-folder-browse]" ? browseButtons : []),
    createElement: (tagName) => new FakeElement(tagName),
  };
  const context = vm.createContext({
    window: { codexSurfaceBridge: bridge, DirectEnvironmentUxModel: model },
    document,
    crypto: globalThis.crypto,
    setTimeout,
    console,
  });
  vm.runInContext(await read("src/renderer/direct-project-directory-surface.js"), context, { filename: "direct-project-directory-surface.js" });
  await settle();
  return { byId, browseButtons };
}

const calls = { browse: [], mutate: [] };
const listings = {
  "": { path: "C:\\Users\\u", parent: "C:\\Users", home: "C:\\Users\\u", pathStyle: "windows", entries: [{ name: "Work", path: "C:\\Users\\u\\Work", kind: "directory" }], truncated: false },
  "C:\\Users\\u\\Work": { path: "C:\\Users\\u\\Work", parent: "C:\\Users\\u", home: "C:\\Users\\u", pathStyle: "windows", entries: [], truncated: false },
};
const bridge = {
  readDirectWorkbenchProjectDirectory: async () => directory,
  readDirectWorkbenchProjectBindingDraft: async () => ({
    schema: "direct_workbench_project_binding_draft@1",
    mode: "create",
    sourceProjectId: "p_wsl",
    expectedCatalogRevision: "rev",
    fields: { displayName: "New project", workspace: { kind: "wsl", distro: "Ubuntu", linuxPath: "" }, runtimePath: "direct-implementation" },
  }),
  listDirectWorkbenchEnvironments: async () => ({ schema: "direct_workbench_environments@1", hostPlatform: "win32", environments }),
  browseDirectWorkbenchEnvironmentFolder: async (payload) => {
    calls.browse.push(payload);
    if (!listings[payload.path]) throw Object.assign(new Error("missing"), { code: "direct_fs_list_not_found" });
    return { schema: "direct_workbench_environment_folder@1", environmentId: payload.environmentId, ...listings[payload.path] };
  },
  mutateDirectWorkbenchProjectBinding: async (payload) => {
    calls.mutate.push(payload);
    return { ok: true, status: "accepted" };
  },
};
const { byId, browseButtons } = await mountProjectSurface(bridge);
const badgeTexts = descendants(byId("directProjectDirectoryList"))
  .filter((node) => node.className === "direct-environment-badge")
  .map((node) => node.textContent);
assert.deepEqual(badgeTexts, ["WSL · Ubuntu", "Windows"], "project rows show their environments");

byId("directProjectBindingNew").click();
await settle();
assert.equal(byId("directProjectBindingEnvironmentField").hidden, false, "the picker replaces typed fields");
assert.equal(byId("directProjectBindingWorkspaceKindField").hidden, true);
assert.equal(byId("directProjectBindingWslDistroField").hidden, true);
const picker = byId("directProjectBindingEnvironment");
assert.deepEqual(picker.children.map((option) => option.value), ["windows", "wsl:Ubuntu", "wsl:Debian"]);
assert.equal(picker.children.find((option) => option.value === "wsl:Debian").disabled, true);
assert.equal(picker.value, "wsl:Ubuntu", "the draft's environment is selected");

picker.value = "windows";
picker.dispatch("change");
assert.equal(byId("directProjectBindingWorkspaceKind").value, "windows");
assert.equal(byId("directProjectBindingWindowsFields").hidden, false);

byId("directProjectBindingWindowsPath").value = "C:\\Gone";
browseButtons.find((button) => button.dataset.directFolderBrowse === "windows").click();
await settle();
assert.deepEqual(calls.browse.map((call) => [call.environmentId, call.path]), [["windows", "C:\\Gone"], ["windows", ""]], "a missing typed folder falls back to home");
assert.equal(byId("directProjectFolderBrowser").hidden, false);
const folderRows = byId("directProjectFolderBrowserList").children.filter((node) => node.className === "direct-folder-browser-row");
assert.deepEqual(folderRows.map((node) => node.textContent), ["Work"]);
assert.equal(byId("directProjectFolderBrowserDrives").hidden, false, "Windows offers its drives");
folderRows[0].click();
await settle();
assert.equal(byId("directProjectFolderBrowserPath").textContent, "C:\\Users\\u\\Work");
byId("directProjectFolderBrowserUse").click();
assert.equal(byId("directProjectBindingWindowsPath").value, "C:\\Users\\u\\Work");
assert.equal(byId("directProjectBindingName").value, "Work", "an unnamed project takes the folder's name");
assert.equal(byId("directProjectFolderBrowser").hidden, true);

byId("directProjectBindingForm").dispatch("submit");
await settle();
assert.equal(calls.mutate.length, 1);
// The payload was built inside the VM context; compare a same-realm copy.
assert.deepEqual(JSON.parse(JSON.stringify(calls.mutate[0].fields.workspace)), { kind: "windows", label: "", windowsPath: "C:\\Users\\u\\Work" });
assert.equal(calls.mutate[0].fields.runtimePath, "direct-implementation");
report.checks.push("project_editor_picker_and_browser");

// Without environment listing the editor keeps its typed fields.
const { byId: fallbackById, browseButtons: fallbackButtons } = await mountProjectSurface({
  ...bridge,
  listDirectWorkbenchEnvironments: undefined,
});
fallbackById("directProjectBindingNew").click();
await settle();
assert.equal(fallbackById("directProjectBindingEnvironmentField").hidden, true);
assert.equal(fallbackById("directProjectBindingWorkspaceKindField").hidden, false);
assert(fallbackButtons.every((button) => button.hidden), "no browsing without a picker");
report.checks.push("project_editor_fallback");

// 5. Live folder listing in both environments through their executors.
const workspaceBackends = new WorkspaceBackendManager({
  agentPath: path.join(repoRoot, "src", "backend", "wsl-agent.js"),
  fallbackRoot: repoRoot,
});
try {
  const registry = new DirectEnvironmentRegistry({ workspaceBackends });
  const discovered = await registry.discover();
  const wslEnvironment = discovered.environments.find((entry) => entry.kind === "wsl" && entry.launch.available && !entry.system);
  const windowsEnvironment = discovered.environments.find((entry) => entry.kind === "windows" && entry.launch.available);
  assert(wslEnvironment && windowsEnvironment, "this machine has both environments");
  const linuxHome = await registry.listDirectory(wslEnvironment.environmentId, "");
  assert.equal(linuxHome.pathStyle, "posix");
  assert.match(linuxHome.path, /^\//);
  assert(linuxHome.entries.every((entry) => entry.kind === "directory"), "only folders by default");
  const linuxRoot = await registry.listDirectory(wslEnvironment.environmentId, "/");
  assert(linuxRoot.entries.some((entry) => entry.name === "home"));
  assert.equal(linuxRoot.parent, "");
  const windowsHome = await registry.listDirectory(windowsEnvironment.environmentId, "");
  assert.equal(windowsHome.pathStyle, "windows");
  assert.match(windowsHome.path, /^[A-Za-z]:\\/);
  const drives = await registry.listDirectory(windowsEnvironment.environmentId, "drives");
  assert(drives.entries.some((entry) => /^C:\\$/i.test(entry.path)));
  assert.equal(model.folderBrowserView(drives).displayPath, "Drives");
  await assert.rejects(
    () => registry.listDirectory(wslEnvironment.environmentId, "/definitely/not/here"),
    (error) => error.code === "direct_fs_list_not_found",
  );
  await assert.rejects(
    () => registry.listDirectory(windowsEnvironment.environmentId, "relative\\path"),
    (error) => error.code === "direct_fs_list_path_invalid",
  );
  report.checks.push("live_folder_listing_both_environments");
} finally {
  workspaceBackends.disposeAll();
}

report.status = "passed";
console.log(JSON.stringify(report));
