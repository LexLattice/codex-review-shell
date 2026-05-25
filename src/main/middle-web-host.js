const { WebContentsView, clipboard, session, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  PLANE_ZOOM_DEFAULT,
  PLANE_ZOOM_MAX,
  PLANE_ZOOM_MIN,
  PLANE_ZOOM_STEP,
  clampZoomFactor,
  zoomDeltaForDirection,
} = require("../shared/plane-zoom");

const MIDDLE_WEB_PARTITION = "persist:middle-web";
const MIDDLE_WEB_HISTORY_SCHEMA_VERSION = 1;
const MIDDLE_WEB_HISTORY_LIMIT = 80;

function nowIso() {
  return new Date().toISOString();
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function offscreenBounds() {
  return { x: -12000, y: -12000, width: 1, height: 1 };
}

function sanitizeBounds(bounds) {
  return {
    x: Math.max(0, Math.floor(Number(bounds?.x) || 0)),
    y: Math.max(0, Math.floor(Number(bounds?.y) || 0)),
    width: Math.max(1, Math.floor(Number(bounds?.width) || 1)),
    height: Math.max(1, Math.floor(Number(bounds?.height) || 1)),
  };
}

function safeHostname(parsed) {
  return String(parsed?.hostname || "").replace(/^\[|\]$/g, "").toLowerCase();
}

function isLoopbackHost(hostname) {
  const host = String(hostname || "").replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;
  const octets = host.split(".");
  if (octets.length !== 4 || octets[0] !== "127") return false;
  return octets.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function securityPostureFor(parsed) {
  if (parsed.protocol === "https:") return "https";
  if (parsed.protocol === "http:" && isLoopbackHost(safeHostname(parsed))) return "loopback_http";
  return "unknown";
}

function sanitizeSource(source) {
  const surface = ["codex", "chatgpt", "shell"].includes(source?.surface) ? source.surface : "shell";
  return {
    surface,
    projectId: normalizeString(source?.projectId, ""),
    threadId: normalizeString(source?.threadId, ""),
    threadTitle: normalizeString(source?.threadTitle, ""),
    itemId: normalizeString(source?.itemId, ""),
  };
}

function navigationDecision(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || ""));
  } catch {
    return { action: "block", reason: "invalid_url" };
  }

  if (parsed.username || parsed.password) {
    return { action: "block", reason: "embedded_credentials" };
  }

  if (parsed.protocol === "https:") {
    return {
      action: "allow",
      normalizedUrl: parsed.toString(),
      displayUrl: parsed.toString(),
      origin: parsed.origin,
      securityPosture: securityPostureFor(parsed),
    };
  }

  if (parsed.protocol === "http:") {
    if (!isLoopbackHost(safeHostname(parsed))) {
      return { action: "block", reason: "insecure_http" };
    }
    return {
      action: "allow",
      normalizedUrl: parsed.toString(),
      displayUrl: parsed.toString(),
      origin: parsed.origin,
      securityPosture: securityPostureFor(parsed),
    };
  }

  return { action: "block", reason: "unsupported_protocol" };
}

function blockedMessage(reason) {
  const labels = {
    unsupported_protocol: "Blocked: unsupported protocol",
    insecure_http: "Blocked: non-loopback HTTP is disabled",
    embedded_credentials: "Blocked: URL contains embedded credentials",
    invalid_url: "Blocked: invalid URL",
    opaque_origin: "Blocked: opaque origin",
    policy_denied: "Blocked by middle Web policy",
    download_blocked: "Blocked: downloads are disabled in v0",
    popup_blocked: "Blocked: navigation attempted to open a popup",
  };
  return labels[reason] || labels.policy_denied;
}

function historyEntryId(url) {
  return `web_${crypto.createHash("sha256").update(String(url || "")).digest("hex").slice(0, 16)}`;
}

function sanitizeHistoryEntry(entry) {
  const decision = navigationDecision(entry?.displayUrl || entry?.url || "");
  if (decision.action !== "allow") return null;
  return {
    id: normalizeString(entry?.id, historyEntryId(decision.normalizedUrl)),
    displayUrl: decision.displayUrl,
    origin: decision.origin,
    title: normalizeString(entry?.title, decision.origin || decision.displayUrl).slice(0, 180),
    securityPosture: decision.securityPosture,
    lastSource: entry?.lastSource ? sanitizeSource(entry.lastSource) : null,
    firstOpenedAt: normalizeString(entry?.firstOpenedAt, normalizeString(entry?.lastOpenedAt, nowIso())),
    lastOpenedAt: normalizeString(entry?.lastOpenedAt, nowIso()),
    visitCount: Math.max(1, Number(entry?.visitCount) || 1),
  };
}

function isLoadUrlAbort(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  return code === "ERR_ABORTED" || message.includes("ERR_ABORTED") || message.includes("ERR_ABORTED (-3)");
}

function blankState() {
  return {
    active: false,
    hasPage: false,
    displayUrl: "",
    title: "",
    origin: "",
    loading: false,
    canGoBack: false,
    canGoForward: false,
    lastError: "",
    lastSource: null,
    securityPosture: "unknown",
  };
}

class MiddleWebHost {
  constructor({ emitShellEvent }) {
    this.emitShellEvent = typeof emitShellEvent === "function" ? emitShellEvent : () => {};
    this.view = null;
    this.rawUrl = "";
    this.state = blankState();
    this.layout = { visible: false, bounds: offscreenBounds(), layoutRevision: 0 };
    this.nativeSurfacesVisible = true;
    this.zoomFactor = PLANE_ZOOM_DEFAULT;
    this.webSession = session.fromPartition(MIDDLE_WEB_PARTITION);
    this.downloadHandler = null;
    this.historyStorePath = "";
    this.historyEntries = [];
    this.historyPersistChain = Promise.resolve();
    this.configureSession();
  }

  setHistoryStorePath(storePath) {
    this.historyStorePath = normalizeString(storePath, "");
    if (this.historyStorePath) {
      try {
        fs.mkdirSync(path.dirname(this.historyStorePath), { recursive: true });
      } catch {
        // History is a convenience surface; persistence failures should not block browsing.
      }
    }
    this.loadHistory();
    this.emitHistory();
  }

  loadHistory() {
    if (!this.historyStorePath) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.historyStorePath, "utf8"));
      const entries = Array.isArray(raw?.entries) ? raw.entries : [];
      this.historyEntries = entries
        .map(sanitizeHistoryEntry)
        .filter(Boolean)
        .sort((a, b) => String(b.lastOpenedAt).localeCompare(String(a.lastOpenedAt)))
        .slice(0, MIDDLE_WEB_HISTORY_LIMIT);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        this.historyEntries = [];
      }
    }
  }

  persistHistory() {
    if (!this.historyStorePath) return;
    const payloadText = `${JSON.stringify({
      schemaVersion: MIDDLE_WEB_HISTORY_SCHEMA_VERSION,
      updatedAt: nowIso(),
      entries: this.historyEntries,
    }, null, 2)}\n`;
    const tmpPath = `${this.historyStorePath}.${process.pid}.${Date.now()}.tmp`;
    this.historyPersistChain = this.historyPersistChain
      .catch(() => {})
      .then(async () => {
        try {
          await fs.promises.writeFile(tmpPath, payloadText, "utf8");
          await fs.promises.rename(tmpPath, this.historyStorePath);
        } catch {
          try {
            await fs.promises.unlink(tmpPath);
          } catch {
            // Best-effort cleanup only.
          }
        }
      });
    return this.historyPersistChain;
  }

  emitHistory() {
    this.emitShellEvent({
      type: "middle-web-history",
      entries: this.history(),
      limit: MIDDLE_WEB_HISTORY_LIMIT,
      at: nowIso(),
    });
  }

  recordHistory(options = {}) {
    if (!this.state.hasPage || this.state.lastError) return;
    const decision = navigationDecision(this.rawUrl || this.state.displayUrl);
    if (decision.action !== "allow") return;
    const now = nowIso();
    const id = historyEntryId(decision.normalizedUrl);
    const existing = this.historyEntries.find((entry) => entry.id === id);
    if (options.bumpVisit === false && !existing) return;
    const nextEntry = sanitizeHistoryEntry({
      id,
      displayUrl: decision.displayUrl,
      origin: decision.origin,
      title: normalizeString(this.state.title, existing?.title || decision.origin || decision.displayUrl),
      securityPosture: decision.securityPosture,
      lastSource: this.state.lastSource || existing?.lastSource || null,
      firstOpenedAt: existing?.firstOpenedAt || now,
      lastOpenedAt: options.bumpVisit === false ? existing?.lastOpenedAt || now : now,
      visitCount: options.bumpVisit === false ? existing?.visitCount || 1 : (Number(existing?.visitCount) || 0) + 1,
    });
    if (!nextEntry) return;
    this.historyEntries = [
      nextEntry,
      ...this.historyEntries.filter((entry) => entry.id !== nextEntry.id),
    ].slice(0, MIDDLE_WEB_HISTORY_LIMIT);
    this.persistHistory();
    this.emitHistory();
  }

  configureSession() {
    this.webSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    this.downloadHandler = (event) => {
      event.preventDefault();
      this.blockNavigation("download_blocked");
    };
    this.webSession.on("will-download", this.downloadHandler);
  }

  createView() {
    if (this.view && !this.view.webContents.isDestroyed()) return this.view;
    this.view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        partition: MIDDLE_WEB_PARTITION,
        devTools: true,
      },
    });
    this.configureView(this.view);
    this.applyBounds();
    return this.view;
  }

  configureView(view) {
    const contents = view.webContents;
    contents.setZoomFactor(this.zoomFactor);
    contents.on("zoom-changed", (event, direction) => {
      event.preventDefault();
      this.adjustZoom(direction);
    });
    contents.setWindowOpenHandler(({ url }) => {
      const decision = navigationDecision(url);
      if (decision.action === "allow") {
        setImmediate(() => {
          this.openLink({ url, source: { surface: "shell" }, userGesture: false }).catch(() => {});
        });
      } else {
        this.blockNavigation(decision.reason);
      }
      return { action: "deny" };
    });

    const guardNavigation = (event, url) => {
      const decision = navigationDecision(url);
      if (decision.action !== "allow") {
        event.preventDefault();
        this.blockNavigation(decision.reason);
        return;
      }
      this.applyAllowedUrl(decision);
    };

    contents.on("will-navigate", guardNavigation);
    contents.on("will-redirect", guardNavigation);
    contents.on("did-start-loading", () => {
      this.updateFromContents({ loading: true, clearError: true });
      this.emitState("loading");
    });
    contents.on("did-stop-loading", () => {
      this.updateFromContents({ loading: false });
      this.recordHistory({ bumpVisit: true });
      this.emitState("loaded");
    });
    contents.on("did-navigate", (_event, url) => {
      const decision = navigationDecision(url);
      if (decision.action === "allow") this.applyAllowedUrl(decision, { emit: false });
      this.updateFromContents({ loading: false });
      this.emitState("loaded");
    });
    contents.on("did-navigate-in-page", (_event, url) => {
      const decision = navigationDecision(url);
      if (decision.action === "allow") this.applyAllowedUrl(decision, { emit: false });
      this.updateFromContents();
      this.recordHistory({ bumpVisit: true });
      this.emitState("state");
    });
    contents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      this.state = {
        ...this.state,
        loading: false,
        lastError: errorDescription || "Load failed.",
        displayUrl: normalizeString(validatedURL, this.state.displayUrl),
      };
      this.emitState("load-failed", { errorCode, errorDescription });
    });
    contents.on("page-title-updated", (_event, title) => {
      this.state = { ...this.state, title: normalizeString(title, this.state.title) };
      this.recordHistory({ bumpVisit: false });
      this.emitState("state");
    });
  }

  attachTo(parentView) {
    const view = this.createView();
    parentView.addChildView(view);
    this.applyBounds();
  }

  dispose() {
    if (this.downloadHandler) {
      this.webSession.removeListener("will-download", this.downloadHandler);
      this.downloadHandler = null;
    }
    if (this.view?.webContents && !this.view.webContents.isDestroyed()) this.view.webContents.close();
    this.view = null;
  }

  applyAllowedUrl(decision, options = {}) {
    this.rawUrl = decision.normalizedUrl;
    this.state = {
      ...this.state,
      hasPage: true,
      displayUrl: decision.displayUrl,
      origin: decision.origin,
      securityPosture: decision.securityPosture,
      lastError: "",
    };
    if (options.emit !== false) this.emitState("state");
  }

  updateFromContents(options = {}) {
    const contents = this.view?.webContents;
    if (!contents || contents.isDestroyed()) return;
    const url = contents.getURL();
    const decision = navigationDecision(url);
    const hasValidPage = decision.action === "allow";
    const loading = typeof options.loading === "boolean" ? options.loading : contents.isLoading();
    const patch = {
      loading,
      canGoBack: contents.canGoBack(),
      canGoForward: contents.canGoForward(),
      title: normalizeString(contents.getTitle(), this.state.title),
      hasPage: hasValidPage || Boolean(loading && this.state.hasPage),
    };
    if (hasValidPage) {
      this.rawUrl = decision.normalizedUrl;
      Object.assign(patch, {
        displayUrl: decision.displayUrl,
        origin: decision.origin,
        securityPosture: decision.securityPosture,
      });
    }
    if (options.clearError) patch.lastError = "";
    this.state = { ...this.state, ...patch };
    this.applyBounds();
  }

  blockNavigation(reason) {
    this.state = {
      ...this.state,
      loading: false,
      lastError: blockedMessage(reason),
      securityPosture: reason === "insecure_http" ? "insecure_blocked" : this.state.securityPosture,
    };
    this.emitState("navigation-blocked", { reason });
  }

  emitState(webEventType = "state", extra = {}) {
    this.updateFromContents();
    this.emitShellEvent({
      type: "middle-web-state",
      webEventType,
      ...this.state,
      ...extra,
      at: nowIso(),
    });
  }

  history() {
    return this.historyEntries.map((entry) => ({ ...entry }));
  }

  async pruneHistory(request = {}) {
    const id = normalizeString(request.id, "");
    const clearAll = Boolean(request.clearAll);
    const before = this.historyEntries.length;
    if (clearAll) this.historyEntries = [];
    else if (id) this.historyEntries = this.historyEntries.filter((entry) => entry.id !== id);
    await this.persistHistory();
    this.emitHistory();
    return { ok: true, removed: before - this.historyEntries.length, entries: this.history() };
  }

  setNativeSurfacesVisible(visible) {
    this.nativeSurfacesVisible = Boolean(visible);
    this.applyBounds();
  }

  setLayout(layout = {}) {
    const revision = Number(layout.layoutRevision) || 0;
    if (revision && revision < Number(this.layout.layoutRevision || 0)) return { ok: true, stale: true };
    this.layout = {
      visible: Boolean(layout.visible),
      bounds: sanitizeBounds(layout.bounds),
      tab: normalizeString(layout.tab, "web"),
      layoutRevision: revision || Number(this.layout.layoutRevision || 0) + 1,
    };
    this.applyBounds();
    return { ok: true };
  }

  applyBounds() {
    if (!this.view || this.view.webContents.isDestroyed()) return;
    const visible = this.nativeSurfacesVisible && this.layout.visible && this.state.hasPage;
    this.view.setBounds(visible ? sanitizeBounds(this.layout.bounds) : offscreenBounds());
  }

  async openLink(request = {}) {
    const url = normalizeString(request.url, "");
    const disposition = request.disposition === "external" ? "external" : "middle-web";
    const source = sanitizeSource(request.source || {});
    const decision = navigationDecision(url);
    if (decision.action !== "allow") {
      if (disposition === "middle-web") {
        this.state = {
          ...this.state,
          active: true,
          hasPage: false,
          loading: false,
          lastError: blockedMessage(decision.reason),
          lastSource: { ...source, openedAt: normalizeString(request.openedAt, nowIso()) },
          securityPosture: decision.reason === "insecure_http" ? "insecure_blocked" : "unknown",
        };
        this.emitState("navigation-blocked", { reason: decision.reason });
        this.emitShellEvent({ type: "middle-web-open-requested", at: nowIso() });
      }
      return { ok: false, target: disposition, error: decision.reason };
    }

    if (disposition === "external") {
      await shell.openExternal(decision.normalizedUrl);
      return {
        ok: true,
        target: "external",
        displayUrl: decision.displayUrl,
        origin: decision.origin,
      };
    }

    this.createView();
    this.rawUrl = decision.normalizedUrl;
    this.state = {
      ...this.state,
      active: true,
      hasPage: true,
      displayUrl: decision.displayUrl,
      origin: decision.origin,
      loading: true,
      lastError: "",
      lastSource: { ...source, openedAt: normalizeString(request.openedAt, nowIso()) },
      securityPosture: decision.securityPosture,
    };
    this.emitShellEvent({ type: "middle-web-open-requested", at: nowIso() });
    this.emitState("loading");
    try {
      await this.view.webContents.loadURL(decision.normalizedUrl);
    } catch (error) {
      if (isLoadUrlAbort(error)) {
        return { ok: false, target: "middle-web", error: "aborted" };
      }
      this.state = {
        ...this.state,
        loading: false,
        lastError: error.message || "Load failed.",
      };
      this.emitState("load-failed");
      return { ok: false, target: "middle-web", error: "load_failed" };
    }
    return {
      ok: true,
      target: "middle-web",
      displayUrl: decision.displayUrl,
      origin: decision.origin,
    };
  }

  goBack() {
    if (this.view?.webContents?.canGoBack()) this.view.webContents.goBack();
    return this.snapshot();
  }

  goForward() {
    if (this.view?.webContents?.canGoForward()) this.view.webContents.goForward();
    return this.snapshot();
  }

  reload() {
    if (!this.view?.webContents || this.view.webContents.isDestroyed()) return this.snapshot();
    if (this.view.webContents.isLoading()) this.view.webContents.stop();
    else if (this.rawUrl) this.view.webContents.reload();
    return this.snapshot();
  }

  stop() {
    if (this.view?.webContents && !this.view.webContents.isDestroyed()) this.view.webContents.stop();
    return this.snapshot();
  }

  async openExternal() {
    const decision = navigationDecision(this.rawUrl || this.state.displayUrl);
    if (decision.action !== "allow") return { ok: false, error: decision.reason };
    await shell.openExternal(decision.normalizedUrl);
    return { ok: true, displayUrl: decision.displayUrl, origin: decision.origin };
  }

  copyUrl() {
    const decision = navigationDecision(this.rawUrl || this.state.displayUrl);
    if (decision.action !== "allow") return { ok: false, error: decision.reason };
    clipboard.writeText(decision.displayUrl);
    return { ok: true, displayUrl: decision.displayUrl };
  }

  setZoomFactor(factor) {
    this.zoomFactor = clampZoomFactor(factor);
    if (this.view?.webContents && !this.view.webContents.isDestroyed()) {
      this.view.webContents.setZoomFactor(this.zoomFactor);
    }
    this.emitShellEvent({
      type: "plane-zoom-state",
      plane: "middle",
      zoomFactor: this.zoomFactor,
      at: nowIso(),
    });
    return { ok: true, plane: "middle", zoomFactor: this.zoomFactor };
  }

  adjustZoom(direction) {
    return this.setZoomFactor(this.zoomFactor + zoomDeltaForDirection(direction));
  }

  snapshot() {
    this.updateFromContents();
    return { ...this.state };
  }
}

module.exports = {
  MiddleWebHost,
  MIDDLE_WEB_PARTITION,
  PLANE_ZOOM_MAX,
  PLANE_ZOOM_MIN,
  PLANE_ZOOM_STEP,
  PLANE_ZOOM_DEFAULT,
  clampZoomFactor,
  navigationDecision,
  zoomDeltaForDirection,
};
