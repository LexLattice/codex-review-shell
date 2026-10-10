#!/usr/bin/env node

// Windows and WSL projects open at the same time in Direct Workbench: each
// open project keeps a live surface (switching shows another one instead of
// reloading), running work doesn't block switching, and the sidebar lists
// every project's threads with what they need. Covers the overview model,
// the sidebar renderer in a fake DOM, and the main-process contracts.
// Runs on either host.

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { buildDirectWorkbenchThreadOverview } = require("../src/main/direct/project/workbench-thread-overview");
const environmentModel = require("../src/renderer/direct-environment-ux-model");
const read = (relative) => fs.readFile(path.join(repoRoot, relative), "utf8");
const settle = async () => {
  for (let index = 0; index < 20; index += 1) await new Promise((resolve) => setImmediate(resolve));
};
const checks = [];

// 1. The overview model.
const projects = [
  { id: "p_wsl", name: "Linux tools", workspace: { kind: "wsl", distro: "Ubuntu", linuxPath: "/home/u/secret-linux" } },
  { id: "p_win", name: "Windows app", workspace: { kind: "windows", windowsPath: "C:\\secret-windows" } },
  { id: "p_old", name: "Archived", workspace: { kind: "windows", windowsPath: "C:\\old" }, lifecycle: { state: "archived" } },
];
const at = (minutes) => new Date(Date.UTC(2026, 9, 10, 12, minutes)).toISOString();
const sessions = [
  { sessionId: "t_w1", projectId: "p_wsl", title: "Fix the build", updatedAt: at(50), activeTurnCount: 1 },
  { sessionId: "t_w2", projectId: "p_wsl", title: "Docs", updatedAt: at(40), activeTurnCount: 0 },
  { sessionId: "t_w_agent", projectId: "p_wsl", title: "Sub-agent", agentKind: "explorer", updatedAt: at(55), activeTurnCount: 1 },
  ...Array.from({ length: 8 }, (_, index) => ({ sessionId: `t_n${index}`, projectId: "p_win", title: `Thread ${index}`, updatedAt: at(30 - index), activeTurnCount: 0 })),
  { sessionId: "t_n_old_running", projectId: "p_win", title: "Long job", updatedAt: at(1), activeTurnCount: 1 },
  { sessionId: "t_old", projectId: "p_old", title: "Old", updatedAt: at(2), activeTurnCount: 0 },
];
const overview = buildDirectWorkbenchThreadOverview({
  projects,
  selectedProjectId: "p_win",
  sessions,
  pendingRequests: [
    { projectId: "p_wsl", threadId: "t_w1" },
    { projectId: "p_wsl", threadId: "t_w1" },
    { projectId: "p_win", threadId: "" },
  ],
  liveProjectIds: ["p_wsl", "p_win"],
  generatedAt: at(59),
});
assert.equal(overview.schema, "direct_workbench_thread_overview@1");
assert.deepEqual(overview.projects.map((row) => row.projectId), ["p_wsl", "p_win"], "archived projects are left out");
const [wslRow, winRow] = overview.projects;
assert.deepEqual([wslRow.selected, winRow.selected], [false, true]);
assert.deepEqual([wslRow.workspaceKind, wslRow.distro, winRow.workspaceKind], ["wsl", "Ubuntu", "windows"]);
assert.deepEqual(wslRow.threads.map((thread) => [thread.threadId, thread.state, thread.needsYouCount]), [
  ["t_w1", "needs_you", 2],
  ["t_w2", "idle", 0],
], "sub-agent threads stay in their parent's transcript");
assert.deepEqual([wslRow.runningCount, wslRow.needsYouCount, wslRow.live], [1, 2, true]);
assert.equal(winRow.threads.length, 7, "six recent threads plus an older running one");
assert.equal(winRow.threads.at(-1).threadId, "t_n_old_running");
assert.equal(winRow.moreThreadCount, 2);
assert.equal(winRow.needsYouCount, 1, "a request without a known thread still counts for its project");
assert.equal(JSON.stringify(overview).includes("secret"), false, "no paths");
checks.push("overview_model");

// 2. The sidebar renderer in a fake DOM: other projects with their threads
// and badges; a click asks main to open the thread; the rail in front gets
// a needs-you badge.
class FakeClassList {
  constructor(owner) { this.owner = owner; }
  get set() { return new Set(String(this.owner.className || "").split(/\s+/).filter(Boolean)); }
  contains(name) { return this.set.has(name); }
  add(name) { const set = this.set; set.add(name); this.owner.className = [...set].join(" "); }
  remove(name) { const set = this.set; set.delete(name); this.owner.className = [...set].join(" "); }
  toggle(name, force) { (force ?? !this.contains(name)) ? this.add(name) : this.remove(name); }
}
class FakeElement {
  constructor(tagName = "div", id = "") {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.children = [];
    this.parent = null;
    this.dataset = {};
    this.listeners = {};
    this.hidden = false;
    this.disabled = false;
    this.textContent = "";
    this.className = "";
    this.title = "";
    this.type = "";
  }
  get classList() { return new FakeClassList(this); }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  click() { for (const listener of this.listeners.click || []) listener({ preventDefault() {} }); }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = null; }
  setAttribute() {}
  matches(selector) {
    return selector.split(",").some((part) => {
      const trimmed = part.trim();
      const attr = trimmed.match(/\[data-([a-z-]+)\]$/);
      const classes = trimmed.replace(/\[.*\]$/, "").split(".").filter(Boolean);
      if (attr && this.dataset[attr[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] === undefined) return false;
      return classes.every((name) => this.classList.contains(name));
    });
  }
  querySelectorAll(selector) {
    const found = [];
    const walk = (node) => { for (const child of node.children) { if (child.matches(selector)) found.push(child); walk(child); } };
    walk(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
const descendants = (node) => [node, ...node.children.flatMap(descendants)];
const text = (node) => descendants(node).map((child) => child.textContent).join(" ");

const elements = new Map();
const byId = (id) => {
  if (!elements.has(id)) elements.set(id, new FakeElement("div", id));
  return elements.get(id);
};
byId("workbenchOtherProjects").hidden = true;
const railRedraws = [];
const calls = { open: [], read: 0 };
let overviewListener = null;
const frontOverview = buildDirectWorkbenchThreadOverview({
  projects,
  selectedProjectId: "p_win",
  sessions,
  pendingRequests: [{ projectId: "p_wsl", threadId: "t_w1" }, { projectId: "p_win", threadId: "t_n1" }],
});
const bridge = {
  readDirectWorkbenchThreadOverview: async () => { calls.read += 1; return frontOverview; },
  openDirectWorkbenchThread: async (payload) => { calls.open.push(JSON.parse(JSON.stringify(payload))); return { ok: true, status: "accepted" }; },
  onDirectWorkbenchThreadOverviewEvent: (listener) => { overviewListener = listener; },
};
const fakeWindow = {
  codexSurfaceBridge: bridge,
  DirectEnvironmentUxModel: environmentModel,
  dispatchEvent: (event) => railRedraws.push(event.type),
};
const context = vm.createContext({
  window: fakeWindow,
  document: { getElementById: byId, createElement: (tagName) => new FakeElement(tagName) },
  CustomEvent: class { constructor(type) { this.type = type; } },
  Date,
  setTimeout,
  console,
});
vm.runInContext(await read("src/renderer/direct-workbench-overview-surface.js"), context, { filename: "direct-workbench-overview-surface.js" });
await settle();
const section = byId("workbenchOtherProjects");
const list = byId("workbenchOtherProjectsList");
assert.equal(calls.read, 1);
assert.equal(section.hidden, false);
const groups = list.children.filter((child) => child.classList.contains("workbench-project-group"));
assert.deepEqual(groups.map((group) => group.dataset.projectId), ["p_wsl"], "the project in front isn't repeated below its rail");
assert.match(text(groups[0]), /Linux tools/);
assert.match(text(groups[0]), /WSL · Ubuntu/);
assert.match(text(groups[0]), /needs you/);
assert.match(text(groups[0]), /running/);
const threadRows = descendants(groups[0]).filter((node) => node.classList.contains("workbench-thread-row"));
assert.deepEqual(threadRows.map((row) => [row.dataset.threadId, row.dataset.state]), [["t_w1", "needs_you"], ["t_w2", "idle"]]);
threadRows[0].click();
await settle();
assert.deepEqual(calls.open, [{ projectId: "p_wsl", threadId: "t_w1" }]);
descendants(groups[0]).find((node) => node.classList.contains("workbench-project-header")).click();
await settle();
assert.deepEqual(calls.open.at(-1), { projectId: "p_wsl", threadId: "" }, "the project header opens the project");
// The rail in front (drawn by codex-surface.js) asks which of its threads
// wait for the owner, and redraws when that changes.
const marks = fakeWindow.DirectWorkbenchOverview;
assert.equal(marks.needsYouCount("t_n1"), 1, "the rail in front can mark a thread waiting for the owner");
assert.equal(marks.needsYouCount("t_n0"), 0);
assert.equal(marks.needsYouCount("t_w1"), 0, "only threads of the project in front");
assert.deepEqual(railRedraws, ["direct-workbench-overview-changed"]);
// The same overview again redraws nothing (it arrives every few seconds
// while work runs, and redrawing would move rows under the pointer).
const listBefore = list.children[0];
overviewListener({ ...frontOverview, generatedAt: "later" });
assert.equal(list.children[0], listBefore, "an unchanged overview leaves the sidebar alone");
assert.deepEqual(railRedraws, ["direct-workbench-overview-changed"]);
// The request is answered: the mark clears and the rail redraws.
overviewListener(buildDirectWorkbenchThreadOverview({ projects, selectedProjectId: "p_win", sessions, pendingRequests: [] }));
assert.equal(marks.needsYouCount("t_n1"), 0);
assert.equal(railRedraws.length, 2);
const surfaceSource = await read("src/renderer/codex-surface.js");
const railSource = surfaceSource.slice(surfaceSource.indexOf("function renderMorphicThreadRail"), surfaceSource.indexOf("function renderDirectThreadList"));
assert.match(railSource, /DirectWorkbenchOverview\?\.needsYouCount\?\.\(threadId\)/, "the rail draws the mark itself");
assert.match(surfaceSource, /addEventListener\?\.\("direct-workbench-overview-changed", \(\) => renderMorphicThreadRail\(\)\)/);
// Only one project: nothing below the rail.
overviewListener(buildDirectWorkbenchThreadOverview({ projects: [projects[1]], selectedProjectId: "p_win", sessions }));
assert.equal(section.hidden, true);
checks.push("sidebar_renderer");

// 3. Main-process contracts.
const mainSource = await read("src/main.js");
const directorySource = await read("src/main/direct/project/project-directory.js");
const preload = await read("src/preload-codex-surface.js");
const html = await read("src/renderer/t3-direct-surface.html");
assert.match(mainSource, /const WORKBENCH_LIVE_VIEW_LIMIT = 4;/);
const activation = mainSource.slice(mainSource.indexOf("async function performDirectWorkbenchProjectActivation"), mainSource.indexOf("function requireShellOrTrustedCodex"));
assert.match(activation, /openWorkbenchProjectView\(savedTarget/, "activation shows the target's own surface");
assert.doesNotMatch(activation.slice(0, activation.indexOf("} catch (error)")), /loadCodexSurface\(/, "activation doesn't reload the surface in front");
assert.match(activation, /evictWorkbenchViews\(\)/);
const evict = mainSource.slice(mainSource.indexOf("async function evictWorkbenchViews"), mainSource.indexOf("async function openWorkbenchProjectView"));
assert.match(evict, /workbenchViewIdle\(entry\)/, "only idle surfaces are closed");
const idle = mainSource.slice(mainSource.indexOf("function workbenchViewIdle"), mainSource.indexOf("async function closeWorkbenchView"));
assert.match(idle, /activeDirectTurnCountForProject/);
assert.match(idle, /workbenchViewPendingRequestCount/);
assert.doesNotMatch(directorySource, /blockerCodes\.push\("active_turn_in_current_project"\)/, "running work doesn't block switching");
for (const channel of ["direct-workbench:thread-overview", "direct-workbench:open-thread"]) {
  const start = mainSource.indexOf(`ipcMain.handle("${channel}"`);
  assert(start > 0, `${channel} is handled`);
  const handler = mainSource.slice(start, start + 700);
  assert.match(handler, new RegExp(`requireFullCodexSurfaceBridge\\(event\\.sender, "${channel}"\\)`));
  assert.match(handler, new RegExp(`requireDirectWorkbenchExperience\\("${channel}"\\)`));
}
const openThread = mainSource.slice(mainSource.indexOf('ipcMain.handle("direct-workbench:open-thread"'), mainSource.indexOf("async function beginDirectWorkbenchProjectActivation"));
assert.match(openThread, /thread_not_in_project/, "a thread must belong to the project it is opened in");
assert.match(openThread, /beginDirectWorkbenchProjectActivation\(/, "another project opens through the checked activation");
// Requests from a background surface resolve against its own project.
for (const fn of ["function createCodexSurfaceSession", "function refreshActiveDirectCodexSurfaceCapabilities", 'ipcMain.handle("codex-surface:connect"']) {
  const body = mainSource.slice(mainSource.indexOf(fn), mainSource.indexOf(fn) + 900);
  assert.match(body, /codexSurfaceContextFor\(/, `${fn} uses the sender's own context`);
}
assert.match(mainSource, /codexSurfaceRequestAuthorizationCapabilities\(event\.sender\)/);
assert.match(mainSource, /isStaleSurfaceEpochFor\(event\.sender, payload\?\.activationEpoch\)/);
const workbenchBlock = preload.slice(preload.indexOf("if (directWorkbenchPreload)"));
assert.match(workbenchBlock, /readDirectWorkbenchThreadOverview: \(\) =>\s*ipcRenderer\.invoke\("direct-workbench:thread-overview"\)/);
assert.match(workbenchBlock, /openDirectWorkbenchThread: \(payload = \{\}\) =>\s*ipcRenderer\.invoke\("direct-workbench:open-thread", payload\)/);
assert.match(workbenchBlock, /"direct-workbench:thread-overview-event"/);
assert.match(html, /id="workbenchOtherProjects"/);
assert(html.indexOf("direct-environment-ux-model.js") < html.indexOf("direct-workbench-overview-surface.js"), "the environment model loads first");
checks.push("main_contracts");

console.log(JSON.stringify({ ok: true, checks }));
