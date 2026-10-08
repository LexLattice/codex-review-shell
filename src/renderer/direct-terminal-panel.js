"use strict";

// The Workbench Terminal panel: the owner's own shells in the active
// project's environment (PowerShell on Windows, the login shell in WSL), and
// agents' terminal sessions (exec_command with tty), read-only. Rendering is
// xterm.js; the shells run in main (direct-terminal:* IPC).

(function directTerminalPanel() {
  const bridge = window.codexSurfaceBridge;
  const panel = document.getElementById("directTerminalPanel");
  const button = document.getElementById("t3TerminalButton");
  const tabsEl = document.getElementById("directTerminalTabs");
  const viewsEl = document.getElementById("directTerminalViews");
  const newButton = document.getElementById("directTerminalNew");
  const closeButton = document.getElementById("directTerminalClose");
  const statusEl = document.getElementById("directTerminalStatus");
  if (!panel || !button || !tabsEl || !viewsEl) return;
  if (typeof bridge?.listDirectTerminals !== "function" || typeof window.Terminal !== "function" || typeof window.FitAddon?.FitAddon !== "function") {
    button.disabled = true;
    button.title = "The terminal isn't available here.";
    return;
  }

  const entries = new Map();
  let activeKey = "";

  const keyFor = (kind, id) => `${kind}:${id}`;

  // ipcRenderer.invoke wraps main-side errors as "Error invoking remote method '…': Error: <message>".
  const reason = (error) => String(error?.message || error || "").replace(/^Error invoking remote method '[^']*':\s*(?:\w*Error:\s*)?/, "");

  function setStatus(text) {
    statusEl.hidden = !text;
    statusEl.textContent = text || "";
  }

  function decode(base64) {
    const binary = atob(String(base64 || ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function markExited(entry, exitCode) {
    if (entry.exited) return;
    entry.exited = true;
    entry.tab.classList.add("exited");
    entry.term.write(`\r\n\x1b[2m[${entry.kind === "agent" ? "session" : "shell"} exited${exitCode === null || exitCode === undefined ? "" : ` with code ${exitCode}`}]\x1b[0m\r\n`);
  }

  function fitActive() {
    const entry = entries.get(activeKey);
    if (!entry || panel.hidden) return;
    try { entry.fit.fit(); } catch {}
  }

  function activate(key) {
    activeKey = key;
    for (const [entryKey, entry] of entries) {
      const active = entryKey === key;
      entry.view.hidden = !active;
      entry.tab.classList.toggle("active", active);
      entry.tab.setAttribute("aria-selected", active ? "true" : "false");
    }
    fitActive();
    const entry = entries.get(key);
    if (entry?.kind === "user" && !entry.exited) entry.term.focus();
  }

  function removeEntry(key) {
    const entry = entries.get(key);
    if (!entry) return;
    entries.delete(key);
    entry.term.dispose();
    entry.view.remove();
    entry.tab.remove();
    if (activeKey === key) activate(entries.keys().next().value || "");
  }

  function addEntry(kind, id, label, title) {
    const key = keyFor(kind, id);
    if (entries.has(key)) return entries.get(key);
    const view = document.createElement("div");
    view.className = "direct-terminal-view";
    view.hidden = true;
    viewsEl.appendChild(view);
    const term = new window.Terminal({
      cursorBlink: kind === "user",
      disableStdin: kind === "agent",
      fontFamily: "ui-monospace, \"Cascadia Mono\", Consolas, \"DejaVu Sans Mono\", monospace",
      fontSize: 12,
      scrollback: 5000,
      theme: { background: "#0b0c0e" },
    });
    const fit = new window.FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(view);
    if (kind === "user") {
      term.onData((data) => {
        bridge.writeDirectTerminal(id, data).catch((error) => setStatus(`Typing failed: ${reason(error)}`));
      });
      term.onResize(({ rows, cols }) => {
        bridge.resizeDirectTerminal(id, rows, cols).catch(() => {});
      });
    }
    const tab = document.createElement("div");
    tab.className = `direct-terminal-tab ${kind}`;
    tab.setAttribute("role", "tab");
    tab.title = title || label;
    const tabLabel = document.createElement("button");
    tabLabel.type = "button";
    tabLabel.className = "direct-terminal-tab-label";
    tabLabel.textContent = label;
    tabLabel.addEventListener("click", () => activate(key));
    tab.appendChild(tabLabel);
    if (kind === "user") {
      const close = document.createElement("button");
      close.type = "button";
      close.className = "direct-terminal-tab-close";
      close.textContent = "×";
      close.setAttribute("aria-label", `Close ${label}`);
      close.addEventListener("click", () => {
        bridge.closeDirectTerminal(id).catch(() => {});
        removeEntry(key);
      });
      tab.appendChild(close);
    }
    tabsEl.appendChild(tab);
    const entry = { key, kind, id, term, fit, view, tab, tabLabel, exited: false };
    entries.set(key, entry);
    return entry;
  }

  async function replayInto(entry, kind) {
    try {
      const replay = await bridge.replayDirectTerminal(entry.id, kind);
      if (replay?.dataBase64) entry.term.write(decode(replay.dataBase64));
    } catch {}
  }

  async function refresh() {
    let listing;
    try {
      listing = await bridge.listDirectTerminals();
    } catch (error) {
      setStatus(`Terminals unavailable: ${reason(error)}`);
      return null;
    }
    for (const terminal of listing.terminals || []) {
      if (entries.has(keyFor("user", terminal.terminalId))) continue;
      const entry = addEntry("user", terminal.terminalId, `${terminal.environment} · ${terminal.shell || "shell"}`);
      await replayInto(entry, "user");
      if (terminal.exited) markExited(entry, terminal.exitCode);
    }
    for (const session of listing.agentSessions || []) {
      if (entries.has(keyFor("agent", session.sessionId))) continue;
      const preview = String(session.commandPreview || "command");
      const entry = addEntry("agent", session.sessionId, `Agent · ${preview.length > 28 ? `${preview.slice(0, 27)}…` : preview}`, `Agent terminal session (read-only): ${preview}`);
      await replayInto(entry, "agent");
      if (!["running", "stdin_waiting", "starting"].includes(session.sessionState)) markExited(entry, session.exitCode);
    }
    if (!activeKey && entries.size) activate(entries.keys().next().value);
    return listing;
  }

  async function openShell() {
    setStatus("");
    newButton.disabled = true;
    try {
      const summary = await bridge.createDirectTerminal(24, 80);
      const entry = addEntry("user", summary.terminalId, `${summary.environment} · ${summary.shell || "shell"}`);
      activate(entry.key);
    } catch (error) {
      setStatus(`Couldn't open a terminal: ${reason(error)}`);
    } finally {
      newButton.disabled = false;
    }
  }

  async function setOpen(open) {
    panel.hidden = !open;
    button.setAttribute("aria-pressed", open ? "true" : "false");
    button.classList.toggle("active", open);
    if (!open) return;
    const listing = await refresh();
    // Like an editor's terminal: opening the panel with nothing in it starts a shell.
    if (listing && !entries.size) await openShell();
    fitActive();
  }

  button.addEventListener("click", () => { setOpen(panel.hidden); });
  closeButton?.addEventListener("click", () => { setOpen(false); });
  newButton?.addEventListener("click", () => { openShell(); });

  bridge.onDirectTerminalEvent((event = {}) => {
    const entry = entries.get(keyFor(event.kind, event.terminalId));
    if (!entry) {
      // A new agent terminal session: pick it up while the panel is open.
      if (event.kind === "agent" && !panel.hidden) refresh();
      return;
    }
    if (event.type === "data") entry.term.write(decode(event.dataBase64));
    else if (event.type === "exit") markExited(entry, event.exitCode);
    else if (event.type === "shell" && event.shell) {
      // "<environment> · <shell>": an executor names the shell once it has started it.
      entry.tabLabel.textContent = entry.tabLabel.textContent.replace(/ · [^·]*$/, ` · ${event.shell}`);
      entry.tab.title = entry.tabLabel.textContent;
    }
  });

  if (typeof ResizeObserver === "function") new ResizeObserver(() => fitActive()).observe(viewsEl);
  window.addEventListener("resize", fitActive);
})();
