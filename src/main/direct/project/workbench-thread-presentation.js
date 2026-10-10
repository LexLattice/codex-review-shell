"use strict";

// How the Workbench sidebar presents threads, kept apart from the session
// store (which many writers rewrite whole sessions in): when the owner last
// opened each thread (the sidebar's order), whether a turn finished while it
// wasn't on screen (unread), and its title once the model or the owner named
// it. One small JSON file in the host's userData.

const fs = require("node:fs");
const path = require("node:path");

const SCHEMA = "direct_workbench_thread_presentation@1";
const MAX_THREADS = 5000;
const MAX_TITLE_CHARS = 80;

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

// A title as the sidebar shows it: one line, no wrapping quotes or trailing
// period, bounded.
function cleanThreadTitle(value) {
  let title = String(value || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
  title = title.replace(/^(title|thread)\s*:\s*/i, "").replace(/^["'“”‘’`*_#\s]+|["'“”‘’`*_\s]+$/g, "").replace(/[.。]+$/, "").trim();
  if (title.length > MAX_TITLE_CHARS) title = `${title.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…`;
  return title;
}

class WorkbenchThreadPresentationStore {
  constructor(options = {}) {
    this.filePath = options.filePath;
    this.now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
    this.data = null;
  }

  load() {
    if (this.data) return this.data;
    let parsed = null;
    try {
      parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    } catch {}
    this.data = parsed?.schema === SCHEMA && parsed.threads && typeof parsed.threads === "object"
      ? parsed
      : { schema: SCHEMA, threads: {} };
    return this.data;
  }

  save() {
    const data = this.load();
    const entries = Object.entries(data.threads);
    if (entries.length > MAX_THREADS) {
      entries.sort((left, right) => String(right[1].openedAt || "").localeCompare(String(left[1].openedAt || "")));
      data.threads = Object.fromEntries(entries.slice(0, MAX_THREADS));
    }
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(data)}\n`);
    fs.renameSync(temp, this.filePath);
  }

  all() {
    return this.load().threads;
  }

  get(threadId) {
    return this.load().threads[normalizeString(threadId, "")] || null;
  }

  update(threadId, patch) {
    const id = normalizeString(threadId, "");
    if (!id) return null;
    const threads = this.load().threads;
    const next = { ...(threads[id] || {}), ...patch };
    for (const [key, value] of Object.entries(next)) if (value === undefined || value === "") delete next[key];
    threads[id] = next;
    this.save();
    return next;
  }

  markOpened(threadId) {
    return this.update(threadId, { openedAt: this.now(), unreadAt: undefined });
  }

  markUnread(threadId) {
    return this.update(threadId, { unreadAt: this.now() });
  }

  // source: "model" (named after its first turn) or "owner" (renamed).
  setTitle(threadId, title, source) {
    const cleaned = cleanThreadTitle(title);
    if (!cleaned) return null;
    return this.update(threadId, { title: cleaned, titleSource: source === "owner" ? "owner" : "model" });
  }
}

module.exports = {
  WorkbenchThreadPresentationStore,
  cleanThreadTitle,
};
