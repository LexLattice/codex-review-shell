#!/usr/bin/env node

// Windows and WSL projects open at the same time in Direct Workbench: each
// open project keeps a live surface (switching shows another one instead of
// reloading), running work doesn't block switching, and the sidebar is one
// stable tree of every project with its threads and what they need. Covers
// the overview model, the presentation store (order, unread, titles), the
// sidebar renderer in a fake DOM, and the main-process contracts. Runs on
// either host.

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { buildDirectWorkbenchThreadOverview } = require("../src/main/direct/project/workbench-thread-overview");
const { WorkbenchThreadPresentationStore, cleanThreadTitle } = require("../src/main/direct/project/workbench-thread-presentation");
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
  { sessionId: "t_w1", projectId: "p_wsl", title: "Fix the build", createdAt: at(10), updatedAt: at(50), activeTurnCount: 1 },
  { sessionId: "t_w2", projectId: "p_wsl", title: "Linux tools direct session", createdAt: at(20), updatedAt: at(40), activeTurnCount: 0 },
  { sessionId: "t_w3", projectId: "p_wsl", title: "Docs", createdAt: at(5), updatedAt: at(58), activeTurnCount: 0 },
  { sessionId: "t_w_agent", projectId: "p_wsl", title: "Sub-agent", agentKind: "explorer", createdAt: at(55), updatedAt: at(55), activeTurnCount: 1 },
  ...Array.from({ length: 8 }, (_, index) => ({ sessionId: `t_n${index}`, projectId: "p_win", title: `Thread ${index}`, createdAt: at(30 - index), updatedAt: at(30 - index), activeTurnCount: 0 })),
  { sessionId: "t_n_old_running", projectId: "p_win", title: "Long job", createdAt: at(1), updatedAt: at(1), activeTurnCount: 1 },
  { sessionId: "t_old", projectId: "p_old", title: "Old", createdAt: at(2), updatedAt: at(2), activeTurnCount: 0 },
];
const presentation = {
  // Opened after it was created: it moves up. Background work (t_w3's later
  // updatedAt) doesn't.
  t_w1: { openedAt: at(57) },
  t_w2: { title: "Draft release notes", titleSource: "model", unreadAt: at(45) },
};
const overview = buildDirectWorkbenchThreadOverview({
  projects,
  selectedProjectId: "p_win",
  sessions,
  presentation,
  pendingRequests: [
    { projectId: "p_wsl", threadId: "t_w1" },
    { projectId: "p_wsl", threadId: "t_w1" },
    { projectId: "p_win", threadId: "" },
  ],
  liveProjectIds: ["p_wsl", "p_win"],
  threadsPerProject: 6,
  generatedAt: at(59),
});
assert.equal(overview.schema, "direct_workbench_thread_overview@1");
assert.deepEqual(overview.projects.map((row) => row.projectId), ["p_wsl", "p_win"], "archived projects are left out; the catalog's order stays");
const [wslRow, winRow] = overview.projects;
assert.deepEqual([wslRow.selected, winRow.selected], [false, true]);
assert.deepEqual([wslRow.workspaceKind, wslRow.distro, winRow.workspaceKind], ["wsl", "Ubuntu", "windows"]);
assert.deepEqual(wslRow.threads.map((thread) => [thread.threadId, thread.state, thread.needsYouCount]), [
  ["t_w1", "needs_you", 2],
  ["t_w2", "unread", 0],
  ["t_w3", "idle", 0],
], "ordered by last opened or created; sub-agent threads stay in their parent's transcript");
assert.equal(wslRow.threads[1].title, "Draft release notes", "the model's or owner's title wins over the placeholder");
assert.deepEqual([wslRow.runningCount, wslRow.needsYouCount, wslRow.unreadCount, wslRow.live], [1, 2, 1, true]);
assert.equal(winRow.threads.length, 7, "six recent threads plus an older running one");
assert.equal(winRow.threads.at(-1).threadId, "t_n_old_running");
assert.equal(winRow.moreThreadCount, 2);
assert.equal(winRow.needsYouCount, 1, "a request without a known thread still counts for its project");
assert.equal(JSON.stringify(overview).includes("secret"), false, "no paths");
// Unread never hides a running turn or a request.
const busy = buildDirectWorkbenchThreadOverview({
  projects: [projects[0]],
  sessions: [{ ...sessions[0], activeTurnCount: 1 }],
  presentation: { t_w1: { unreadAt: at(1) } },
});
assert.equal(busy.projects[0].threads[0].state, "running");
const defaultCap = buildDirectWorkbenchThreadOverview({
  projects: [projects[1]],
  sessions: Array.from({ length: 60 }, (_, index) => ({ sessionId: `t_${index}`, projectId: "p_win", title: "t", createdAt: at(index % 59) })),
});
assert.equal(defaultCap.projects[0].threads.length, 50, "fifty threads a project by default");
assert.equal(defaultCap.projects[0].moreThreadCount, 10);
checks.push("overview_model");

// 2. The presentation store: opening clears unread and sets the order;
// titles are cleaned; it survives a restart.
const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "wb-presentation-"));
try {
  let clock = 0;
  const now = () => at(clock);
  const storePath = path.join(storeDir, "nested", "workbench-threads.json");
  const store = new WorkbenchThreadPresentationStore({ filePath: storePath, now });
  clock = 10;
  store.markUnread("t_a");
  assert.equal(store.get("t_a").unreadAt, at(10));
  clock = 12;
  store.markOpened("t_a");
  assert.deepEqual(store.get("t_a"), { openedAt: at(12) }, "opening clears unread");
  assert.equal(store.setTitle("t_a", "   "), null, "an empty name is refused");
  store.setTitle("t_a", "Title: \"Fix the flaky build.\"\nsecond line", "model");
  assert.deepEqual([store.get("t_a").title, store.get("t_a").titleSource], ["Fix the flaky build", "model"]);
  store.setTitle("t_a", "Mine", "owner");
  assert.equal(store.get("t_a").titleSource, "owner");
  assert.equal(store.update("", { openedAt: at(1) }), null);
  const reloaded = new WorkbenchThreadPresentationStore({ filePath: storePath, now });
  assert.deepEqual(reloaded.get("t_a"), { openedAt: at(12), title: "Mine", titleSource: "owner" });
  await fs.writeFile(storePath, "not json");
  assert.deepEqual(new WorkbenchThreadPresentationStore({ filePath: storePath }).all(), {}, "a damaged file starts empty");
} finally {
  await fs.rm(storeDir, { recursive: true, force: true });
}
assert.equal(cleanThreadTitle("**Run the tests**"), "Run the tests");
assert.equal(cleanThreadTitle("x".repeat(200)).length, 80);
checks.push("presentation_store");

// 3. The sidebar renderer in a fake DOM.
class FakeClassList {
  constructor(owner) { this.owner = owner; }
  get set() { return new Set(String(this.owner.className || "").split(/\s+/).filter(Boolean)); }
  contains(name) { return this.set.has(name); }
  add(...names) { const set = this.set; for (const name of names) set.add(name); this.owner.className = [...set].join(" "); }
  remove(...names) { const set = this.set; for (const name of names) set.delete(name); this.owner.className = [...set].join(" "); }
  toggle(name, force) { (force ?? !this.contains(name)) ? this.add(name) : this.remove(name); }
}
const dataKey = (name) => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
class FakeElement {
  constructor(tagName = "div", id = "") {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.children = [];
    this.parent = null;
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.hidden = false;
    this.disabled = false;
    this.textContent = "";
    this.className = "";
    this.title = "";
    this.type = "";
    this.value = "";
    const styles = {};
    this.style = { setProperty: (key, value) => { styles[key] = value; }, removeProperty: (key) => { delete styles[key]; }, values: styles };
  }
  get classList() { return new FakeClassList(this); }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  removeEventListener(type, listener) { this.listeners[type] = (this.listeners[type] || []).filter((entry) => entry !== listener); }
  dispatch(type, extra = {}) {
    const event = { type, target: this, preventDefault() {}, stopPropagation() {}, ...extra };
    for (const listener of this.listeners[type] || []) listener(event);
  }
  click() { this.dispatch("click"); }
  focus() { fakeDocument.activeElement = this; }
  blur() {}
  select() {}
  append(...nodes) { for (const node of nodes) { node.remove?.(); node.parent = this; this.children.push(node); } }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { for (const child of this.children) child.parent = null; this.children = []; this.append(...nodes); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = null; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  getBoundingClientRect() { return { left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20 }; }
  contains(node) { return descendants(this).includes(node); }
  closest(selector) { for (let node = this; node; node = node.parent) if (node.matches(selector)) return node; return null; }
  matches(selector) {
    return selector.split(",").some((part) => {
      let trimmed = part.trim();
      const notDisabled = trimmed.endsWith(":not(:disabled)");
      trimmed = trimmed.replace(":not(:disabled)", "");
      if (notDisabled && this.disabled) return false;
      const attr = trimmed.match(/\[data-([a-z-]+)(?:="([^"]*)")?\]$/);
      if (attr) {
        const value = this.dataset[dataKey(attr[1])];
        if (value === undefined || (attr[2] !== undefined && value !== attr[2])) return false;
      }
      const base = trimmed.replace(/\[.*\]$/, "");
      if (base.startsWith("#")) return this.id === base.slice(1);
      const classes = base.split(".").filter(Boolean);
      return classes.length > 0 || attr ? classes.every((name) => this.classList.contains(name)) : false;
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
const body = new FakeElement("body");
const shell = new FakeElement("main", "codexShell");
shell.dataset.t3Sidebar = "expanded";
const sidebarElement = new FakeElement("aside");
sidebarElement.className = "t3-project-sidebar wb-sidebar";
body.append(shell);
shell.append(sidebarElement);
for (const id of ["wbNewThread", "t3SidebarToggle", "wbThreadSearch", "wbProjectTree", "wbAccountAvatar", "wbAccountLabel", "wbQuota", "wbSettings", "wbDrawerToggle"]) {
  const node = new FakeElement(id === "wbThreadSearch" ? "input" : "div", id);
  elements.set(id, node);
  (id === "wbDrawerToggle" ? shell : sidebarElement).append(node);
}
elements.set("codexShell", shell);
const byId = (id) => elements.get(id) || null;
const documentListeners = {};
const fakeDocument = {
  body,
  activeElement: null,
  getElementById: byId,
  querySelector: (selector) => (selector === ".wb-sidebar" ? sidebarElement : body.querySelector(selector)),
  createElement: (tagName) => new FakeElement(tagName),
  addEventListener: (type, listener) => { (documentListeners[type] ||= []).push(listener); },
};
const docKey = (key, extra = {}) => {
  for (const listener of documentListeners.keydown || []) listener({ key, ctrlKey: true, preventDefault() {}, ...extra });
};

let frontProjectId = "p_win";
let shownThreadId = "t_n0";
const surfaceCalls = { open: [], newThread: 0, focus: 0 };
const calls = { open: [], newThread: [], rename: [], folder: [], read: 0 };
let overviewListener = null;
let currentOverview = null;
const overviewFor = (extra = {}) => buildDirectWorkbenchThreadOverview({
  projects,
  selectedProjectId: frontProjectId,
  sessions,
  presentation,
  pendingRequests: [{ projectId: "p_wsl", threadId: "t_w1" }],
  ...extra,
});
currentOverview = overviewFor();
const bridge = {
  readDirectWorkbenchThreadOverview: async () => { calls.read += 1; return currentOverview; },
  openDirectWorkbenchThread: async (payload) => { calls.open.push({ ...payload }); return { ok: true, status: "accepted" }; },
  newDirectWorkbenchThread: async (payload) => { calls.newThread.push({ ...payload }); return { ok: true }; },
  renameDirectWorkbenchThread: async (payload) => { calls.rename.push({ ...payload }); return { ok: true }; },
  openDirectWorkbenchProjectFolder: async (payload) => { calls.folder.push({ ...payload }); return { ok: false, reason: "folder_not_reachable_from_this_host" }; },
  onDirectWorkbenchThreadOverviewEvent: (listener) => { overviewListener = listener; },
};
const windowListeners = {};
const storage = new Map();
const fakeWindow = {
  codexSurfaceBridge: bridge,
  DirectEnvironmentUxModel: environmentModel,
  DirectWorkbenchSurface: {
    projectId: () => frontProjectId,
    currentThreadId: () => shownThreadId,
    openThread: async (threadId) => { surfaceCalls.open.push(threadId); },
    newThread: async () => { surfaceCalls.newThread += 1; },
    focusComposer: () => { surfaceCalls.focus += 1; },
    account: () => ({ label: "rose@example.test", initial: "r", quota: "5h 24%" }),
  },
  localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) },
  matchMedia: () => ({ matches: false }),
  innerWidth: 1200,
  innerHeight: 800,
  addEventListener: (type, listener) => { (windowListeners[type] ||= []).push(listener); },
  dispatchEvent: (event) => { for (const listener of windowListeners[event.type] || []) listener(event); },
};
const context = vm.createContext({
  window: fakeWindow,
  document: fakeDocument,
  CSS: { escape: (value) => String(value) },
  CustomEvent: class { constructor(type) { this.type = type; } },
  Date,
  JSON,
  setTimeout: (fn) => setImmediate(fn),
  clearTimeout: () => {},
  setInterval: () => 0,
  console,
});
vm.runInContext(await read("src/renderer/direct-workbench-sidebar.js"), context, { filename: "direct-workbench-sidebar.js" });
await settle();
const tree = byId("wbProjectTree");
const groupsOf = () => tree.children.filter((child) => child.classList.contains("wb-project"));
const rowsOf = (group) => descendants(group).filter((node) => node.classList.contains("wb-thread"));
assert.equal(calls.read, 1);
let groups = groupsOf();
assert.deepEqual(groups.map((group) => group.dataset.projectId), ["p_wsl", "p_win"], "every project, in the catalog's order, the one in front included");
assert.deepEqual(groups.map((group) => group.classList.contains("front")), [false, true], "the project in front is highlighted where it is");
assert.match(text(groups[0]), /Linux tools/);
assert.match(text(groups[0]), /WSL · Ubuntu/);
assert.deepEqual(rowsOf(groups[0]).map((row) => [row.dataset.threadId, row.dataset.state]), [["t_w1", "needs_you"], ["t_w2", "unread"], ["t_w3", "idle"]]);
assert.match(text(rowsOf(groups[0])[0]), /needs you/);
assert.match(text(rowsOf(groups[0])[1]), /Draft release notes/);
const winRows = rowsOf(groups[1]);
assert.equal(winRows.length, 6, "five recent threads plus the running one");
assert.equal(winRows.at(-1).dataset.threadId, "t_n_old_running");
assert.match(text(winRows.at(-1)), /running/);
assert.deepEqual(winRows.filter((row) => row.classList.contains("selected")).map((row) => row.dataset.threadId), ["t_n0"], "the thread on screen is selected");
assert.equal(descendants(groups[1]).find((node) => node.classList.contains("wb-show-more"))?.textContent, "Show 3 more");
assert.match(text(tree), /New project/);
assert.equal(byId("wbAccountLabel").textContent, "rose@example.test");
assert.equal(byId("wbAccountAvatar").textContent, "R");
assert.equal(byId("wbQuota").textContent, "5h 24%");

// Opening: a thread of the project in front opens in its surface; another
// project's thread goes through main.
winRows[1].click();
await settle();
assert.deepEqual(surfaceCalls.open, ["t_n1"]);
assert.deepEqual(calls.open, []);
winRows[0].click();
await settle();
assert.deepEqual(surfaceCalls.open, ["t_n1"], "the thread on screen isn't reopened");
rowsOf(groups[0])[0].click();
await settle();
assert.deepEqual(calls.open, [{ projectId: "p_wsl", threadId: "t_w1" }]);

// New thread: the project in front starts one here; another project's
// "New thread here" goes through main.
byId("wbNewThread").click();
await settle();
assert.deepEqual([surfaceCalls.newThread, surfaceCalls.focus], [1, 1]);
docKey("n");
await settle();
assert.equal(surfaceCalls.newThread, 2, "Ctrl+N");
descendants(groups[0]).find((node) => node.classList.contains("wb-project-more")).click();
let menu = body.querySelector(".wb-menu");
assert(menu, "the ⋯ button opens the project menu");
const menuItems = menu.querySelectorAll(".wb-menu-item");
assert.deepEqual(menuItems.map((item) => item.textContent), ["New thread here", "Open folder", "Edit project…", "Hide threads", "Archive project…"]);
menuItems[0].click();
await settle();
assert.deepEqual(calls.newThread, [{ projectId: "p_wsl" }]);
assert.equal(body.querySelector(".wb-menu"), null, "choosing closes the menu");
descendants(groupsOf()[0]).find((node) => node.classList.contains("wb-project-more")).click();
body.querySelector(".wb-menu").querySelectorAll(".wb-menu-item")[1].click();
await settle();
assert.deepEqual(calls.folder, [{ projectId: "p_wsl" }]);
assert.match(text(tree), /isn't reachable from this machine/, "a refusal is explained in words");
descendants(groupsOf()[1]).find((node) => node.classList.contains("wb-project-more")).click();
const archiveFront = body.querySelector(".wb-menu").querySelectorAll(".wb-menu-item").at(-1);
assert.equal(archiveFront.disabled, true, "the project in front can't be archived from its own surface");
for (const listener of documentListeners.keydown || []) listener({ key: "Escape", preventDefault() {} });
assert.equal(body.querySelector(".wb-menu"), null);

// The same overview again redraws nothing (it arrives every few seconds
// while work runs, and redrawing would move rows under the pointer).
groups = groupsOf();
overviewListener({ ...currentOverview, generatedAt: "later" });
assert.equal(groupsOf()[0], groups[0], "an unchanged overview leaves the sidebar alone");
// While the pointer is over the list, a newly opened thread doesn't jump.
tree.dispatch("mouseenter");
currentOverview = overviewFor({ presentation: { ...presentation, t_w3: { openedAt: at(59) } } });
overviewListener(currentOverview);
assert.deepEqual(rowsOf(groupsOf()[0]).map((row) => row.dataset.threadId), ["t_w1", "t_w2", "t_w3"], "the order is frozen under the pointer");
tree.dispatch("mouseleave");
assert.deepEqual(rowsOf(groupsOf()[0]).map((row) => row.dataset.threadId), ["t_w3", "t_w1", "t_w2"], "and catches up when it leaves");

// Rename: double-click, type, Enter.
const renameTarget = rowsOf(groupsOf()[1])[2];
renameTarget.dispatch("dblclick");
const input = descendants(tree).find((node) => node.classList.contains("wb-rename"));
assert(input, "double-click starts a rename");
assert.equal(input.value, "Thread 2");
overviewListener(overviewFor({ pendingRequests: [] }));
assert(descendants(tree).includes(input), "an overview doesn't interrupt a rename");
input.value = "Ship the installer";
input.dispatch("keydown", { key: "Enter" });
await settle();
assert.deepEqual(calls.rename, [{ threadId: "t_n2", title: "Ship the installer" }]);
assert.equal(descendants(tree).some((node) => node.classList.contains("wb-rename")), false);

// Search across every project's titles.
const search = byId("wbThreadSearch");
search.value = "release";
search.dispatch("input");
assert.deepEqual(groupsOf().map((group) => group.dataset.projectId), ["p_wsl"]);
assert.deepEqual(rowsOf(groupsOf()[0]).map((row) => row.dataset.threadId), ["t_w2"]);
assert.doesNotMatch(text(tree), /New project/);
search.value = "nothing like this";
search.dispatch("input");
assert.match(text(tree), /No thread titles match/);
search.dispatch("keydown", { key: "Escape" });
assert.equal(groupsOf().length, 2);

// Hiding a project's threads shows its badges on the header instead, and
// is remembered.
descendants(groupsOf()[0]).find((node) => node.classList.contains("wb-project-toggle")).click();
assert.equal(rowsOf(groupsOf()[0]).length, 0);
assert.match(text(groupsOf()[0]), /needs you/);
assert.deepEqual(JSON.parse(storage.get("direct.workbench.sidebar.collapsedProjects")), ["p_wsl"]);
descendants(groupsOf()[0]).find((node) => node.classList.contains("wb-project-toggle")).click();

// Collapsed: a column of project tiles; a tile opens a flyout of threads.
shell.dataset.t3Sidebar = "collapsed";
byId("t3SidebarToggle").click();
await settle();
const tiles = tree.children.filter((child) => child.classList.contains("wb-tile"));
assert.deepEqual(tiles.map((tile) => [tile.dataset.projectId, tile.textContent]), [["p_wsl", "LT"], ["p_win", "WA"]]);
assert.equal(tiles[0].children.some((child) => child.classList.contains("needs-you")), true, "a tile carries its project's state");
tiles[0].click();
const flyout = sidebarElement.querySelector(".wb-flyout");
assert(flyout, "a tile shows its project's threads");
assert.deepEqual(rowsOf(flyout).map((row) => row.dataset.threadId), ["t_w3", "t_w1", "t_w2"]);
shell.dataset.t3Sidebar = "expanded";
byId("t3SidebarToggle").click();
await settle();
assert.equal(sidebarElement.querySelector(".wb-flyout"), null);
assert.equal(groupsOf().length, 2);

// The project in front changes (another project's surface shows it): the
// highlight moves; nothing else does.
frontProjectId = "p_wsl";
shownThreadId = "t_w1";
fakeWindow.dispatchEvent({ type: "direct-workbench-thread-shown" });
assert.deepEqual(groupsOf().map((group) => [group.dataset.projectId, group.classList.contains("front")]), [["p_wsl", true], ["p_win", false]]);
assert.deepEqual(rowsOf(groupsOf()[0]).filter((row) => row.classList.contains("selected")).map((row) => row.dataset.threadId), ["t_w1"]);
// The resize handle remembers its width within bounds.
const handle = sidebarElement.querySelector(".wb-resize");
assert(handle, "the sidebar can be resized");
handle.dispatch("pointerdown", { pointerId: 1, clientX: 300 });
handle.dispatch("pointerup", { clientX: 900 });
assert.equal(shell.style.values["--t3-sidebar-width"], "420px");
assert.equal(storage.get("direct.workbench.sidebar.width"), "420");
checks.push("sidebar_renderer");

// 4. The surface: threads switch while a turn runs; events for a thread
// not on screen are kept and replayed when it comes back.
const surfaceSource = await read("src/renderer/codex-surface.js");
assert.match(surfaceSource, /function recordLiveTurnNotification\(/);
assert.match(surfaceSource, /function restoreThreadLiveState\(/);
assert.match(surfaceSource, /globalThis\.DirectWorkbenchSurface = /);
assert.match(surfaceSource, /"direct-workbench-thread-shown"/);
// A running Direct turn, as thread/read reports it, counts as running (it
// once showed "Idle" when the owner came back to it), and a continuation's
// turn/started doesn't wipe the turn's log so far.
const activeStates = surfaceSource.slice(surfaceSource.indexOf("const ACTIVE_TURN_STATUS_SET"), surfaceSource.indexOf("const THOUGHT_ASSISTANT_PHASES"));
const { DIRECT_ACTIVE_TURN_STATES } = require("../src/main/direct/session/session-store");
for (const directState of DIRECT_ACTIVE_TURN_STATES) assert(activeStates.includes(`"${directState}"`), `${directState} is a running turn in the surface`);
const recordSource = surfaceSource.slice(surfaceSource.indexOf("function recordLiveTurnNotification"), surfaceSource.indexOf("function threadIsOffScreen"));
assert.match(recordSource, /method === "turn\/started" && liveTurnLogs\.get\(threadId\)\?\.turnId !== turnId/);
const openDirect = surfaceSource.slice(surfaceSource.indexOf("async function openDirectThread("), surfaceSource.indexOf("async function focusWorkbenchThread("));
assert.match(openDirect, /threadTurnCompletions\.get\(requestedThreadId\)/, "a turn that ends while its thread opens is read again");
const newThreadSource = surfaceSource.slice(surfaceSource.indexOf("async function startNewThread("), surfaceSource.indexOf("async function startCodexTurn("));
assert.equal((newThreadSource.match(/reportThreadState\("attached_live"/g) || []).length, 2, "a new thread is reported, so the sidebar lists it at once");
checks.push("surface_contracts");

// 5. Main-process contracts.
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
for (const channel of ["direct-workbench:thread-overview", "direct-workbench:open-thread", "direct-workbench:new-thread", "direct-workbench:rename-thread", "direct-workbench:open-project-folder"]) {
  const start = mainSource.indexOf(`ipcMain.handle("${channel}"`);
  assert(start > 0, `${channel} is handled`);
  const handler = mainSource.slice(start, start + 700);
  assert.match(handler, new RegExp(`requireFullCodexSurfaceBridge\\(event\\.sender, "${channel}"\\)`));
  assert.match(handler, new RegExp(`requireDirectWorkbenchExperience\\("${channel}"\\)`));
}
const openThread = mainSource.slice(mainSource.indexOf('ipcMain.handle("direct-workbench:open-thread"'), mainSource.indexOf('ipcMain.handle("direct-workbench:new-thread"'));
assert.match(openThread, /thread_not_in_project/, "a thread must belong to the project it is opened in");
assert.match(openThread, /beginDirectWorkbenchProjectActivation\(/, "another project opens through the checked activation");
const newThread = mainSource.slice(mainSource.indexOf('ipcMain.handle("direct-workbench:new-thread"'), mainSource.indexOf('ipcMain.handle("direct-workbench:rename-thread"'));
assert(newThread.includes("beginDirectWorkbenchProjectActivation(event.sender, authority, {") && newThread.includes("}, { newThread: true });"), "another project's new thread opens through the checked activation");
const rename = mainSource.slice(mainSource.indexOf('ipcMain.handle("direct-workbench:rename-thread"'), mainSource.indexOf('ipcMain.handle("direct-workbench:open-project-folder"'));
assert.match(rename, /thread_title_required/);
assert.match(rename, /applyWorkbenchThreadTitle\(entry, title, "owner"\)/);
const settleActivity = mainSource.slice(mainSource.indexOf("function settleWorkbenchThreadActivity"), mainSource.indexOf("async function nameWorkbenchThread"));
assert.match(settleActivity, /wasRunning && !running && threadId !== displayed/, "a turn finishing off screen leaves its thread unread");
assert.match(settleActivity, /threadHasPlaceholderTitle\(entry\)/, "only placeholder titles are model-named");
assert.match(settleActivity, /justFinished && !presented\.title/, "and only after a turn that just finished, not every old thread on first launch");
assert.match(settleActivity, /\.finally\(\(\) => workbenchThreadsNaming\.delete\(threadId\)\)/, "a failed title request is released for a retry");
assert.match(settleActivity, /attempts < WORKBENCH_THREAD_NAMING_ATTEMPTS/, "retries are bounded");
// "New thread here" for a project without an open surface starts a new
// thread there instead of restoring the project's latest one.
const openView = mainSource.slice(mainSource.indexOf("async function openWorkbenchProjectView"), mainSource.indexOf("function rememberCodexSurfaceContext"));
assert.match(openView, /surfaceOptions\.startNewThread = !threadId && options\.newThread === true;/);
assert.match(mainSource, /startNewThread: options\.startNewThread === true,/, "it reaches the surface's thread extras");
assert.match(mainSource, /startNewThread: extra\.startNewThread === true,/, "and its bootstrap payload");
const startup = surfaceSource.slice(surfaceSource.indexOf("state.readyForThreadOpen = true;"), surfaceSource.indexOf("enforceDirectLiveTextStartupReadiness();"));
assert.match(startup, /else if \(payload\.startNewThread === true\) \{\s*await startNewThread\(\);\s*\} else \{\s*await loadExistingThreadOrStartNew\(\);/);
const naming = mainSource.slice(mainSource.indexOf("async function nameWorkbenchThread"), mainSource.indexOf("function applyWorkbenchThreadTitle"));
assert.match(naming, /get\(threadId\)\?\.title\) return/, "an owner's rename while the model writes wins");
// Requests from a background surface resolve against its own project.
for (const fn of ["function createCodexSurfaceSession", "function refreshActiveDirectCodexSurfaceCapabilities", 'ipcMain.handle("codex-surface:connect"']) {
  const body = mainSource.slice(mainSource.indexOf(fn), mainSource.indexOf(fn) + 900);
  assert.match(body, /codexSurfaceContextFor\(/, `${fn} uses the sender's own context`);
}
assert.match(mainSource, /codexSurfaceRequestAuthorizationCapabilities\(event\.sender\)/);
// A reload for a project that isn't in front (a runtime transition that
// finished after the owner switched away) never lands in the surface in
// front, and transitions don't make a background project current.
const wrapper = mainSource.slice(mainSource.indexOf("async function loadCodexSurface("), mainSource.indexOf("async function loadCodexSurfaceIntoView("));
assert(wrapper.indexOf("workbenchProjectInFront(project)") > 0 && wrapper.indexOf("workbenchProjectInFront(project)") < wrapper.indexOf("loadCodexSurfaceIntoView(project"), "checked before loading");
assert.match(wrapper, /retireBackgroundWorkbenchSurface\(/);
const intoView = mainSource.slice(mainSource.indexOf("async function loadCodexSurfaceIntoView("), mainSource.indexOf("async function loadChatgptSurface("));
assert.match(intoView, /const targetView = codexView;/);
assert.doesNotMatch(intoView, /isStaleSurfaceActivationEpoch\(options\.activationEpoch\)\) return/, "every check also notices the surface in front changing");
assert.doesNotMatch(mainSource, /currentProject = savedProject;/, "transitions adopt only the project in front");
const transitionReload = mainSource.slice(mainSource.indexOf("async function reloadCodexSurfaceAfterRuntimeTransition"), mainSource.indexOf("async function switchActiveCodexRuntimePath"));
assert(transitionReload.indexOf("workbenchProjectInFront") < transitionReload.indexOf("nextSurfaceActivationEpoch"), "a background transition takes no epoch");
const reloadRuntime = mainSource.slice(mainSource.indexOf("async function reloadCodexRuntime"), mainSource.indexOf("async function reloadCodexRuntime") + 700);
assert.match(reloadRuntime, /adoptTransitionedProject\(project\)/);
assert.match(mainSource, /isStaleSurfaceEpochFor\(event\.sender, payload\?\.activationEpoch\)/);
const workbenchBlock = preload.slice(preload.indexOf("if (directWorkbenchPreload)"));
assert.match(workbenchBlock, /readDirectWorkbenchThreadOverview: \(\) =>\s*ipcRenderer\.invoke\("direct-workbench:thread-overview"\)/);
assert.match(workbenchBlock, /openDirectWorkbenchThread: \(payload = \{\}\) =>\s*ipcRenderer\.invoke\("direct-workbench:open-thread", payload\)/);
assert.match(workbenchBlock, /"direct-workbench:thread-overview-event"/);
for (const channel of ["direct-workbench:new-thread", "direct-workbench:rename-thread", "direct-workbench:open-project-folder"]) {
  assert(workbenchBlock.includes(`ipcRenderer.invoke("${channel}"`), `${channel} is exposed to the Workbench surface only`);
}
assert.match(html, /id="wbProjectTree"/);
assert.doesNotMatch(html, /direct-workbench-overview-surface\.js/);
assert(html.indexOf("direct-environment-ux-model.js") < html.indexOf("direct-workbench-sidebar.js"), "the environment model loads first");
checks.push("main_contracts");

console.log(JSON.stringify({ ok: true, checks }));
