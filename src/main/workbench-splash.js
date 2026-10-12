"use strict";

// The Workbench's launch animation: a transparent view over the window that
// draws the layout in light while the surface loads, then dissolves into it
// (src/renderer/workbench-splash.html).
const path = require("node:path");
const { WebContentsView, screen } = require("electron");

const SPLASH_FILE = path.join(__dirname, "..", "renderer", "workbench-splash.html");
// Long enough for the lines to finish drawing, so a fast launch doesn't
// just blink.
const SPLASH_MIN_VISIBLE_MS = 650;
// The page's finish transition (veil 340 ms, lines 480 ms) plus slack.
const SPLASH_EXIT_MS = 560;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createWorkbenchSplash(window) {
  const view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false,
      backgroundThrottling: false,
    },
  });
  view.setBackgroundColor("#00000000");
  const contents = view.webContents;
  contents.on("will-navigate", (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.contentView.addChildView(view);

  let shownAt = 0;
  let state = "loading";
  const fit = () => {
    if (state === "removed" || window.isDestroyed()) return;
    const bounds = window.getContentBounds();
    view.setBounds({ x: 0, y: 0, width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) });
  };
  fit();
  const ready = new Promise((resolve) => {
    contents.once("dom-ready", () => resolve(true));
    contents.once("did-fail-load", () => resolve(false));
    contents.once("render-process-gone", () => resolve(false));
  });
  contents.loadFile(SPLASH_FILE).catch(() => {});

  const remove = () => {
    if (state === "removed") return;
    state = "removed";
    try { if (!window.isDestroyed()) window.contentView.removeChildView(view); } catch {}
    try { if (!contents.isDestroyed()) contents.close(); } catch {}
  };

  return {
    ready,
    fit,
    get active() {
      return state !== "removed";
    },
    shown() {
      shownAt = Date.now();
    },
    // Windows shows a new window as unpainted grey, fading in, for about
    // 0.2 s before its first frame lands. Opened past the right edge of
    // every display, the window gets that over with out of sight; the
    // returned function moves it into place.
    showOffscreen() {
      const home = window.getBounds();
      const right = Math.max(...screen.getAllDisplays().map((display) => display.bounds.x + display.bounds.width));
      window.setPosition(right + 64, home.y);
      window.show();
      return () => {
        if (!window.isDestroyed()) window.setBounds(home);
      };
    },
    // Resolves once the shown window has put a frame on screen. That needs
    // a free main thread; startup's synchronous work right after would
    // otherwise leave the window unpainted (grey) until it ends.
    presented(timeoutMs = 300) {
      if (state === "removed" || contents.isDestroyed()) return Promise.resolve(false);
      return Promise.race([
        contents.executeJavaScript("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))").catch(() => false),
        delay(timeoutMs).then(() => false),
      ]);
    },
    // Views added later stack above; the splash stays on top until it ends.
    raise() {
      if (state === "removed" || window.isDestroyed()) return;
      window.contentView.addChildView(view);
    },
    async finish() {
      if (state !== "loading") return;
      state = "finishing";
      const visibleFor = shownAt ? Date.now() - shownAt : SPLASH_MIN_VISIBLE_MS;
      await delay(Math.max(0, SPLASH_MIN_VISIBLE_MS - visibleFor));
      let animated = false;
      try {
        if (!contents.isDestroyed()) animated = await contents.executeJavaScript("Boolean(window.workbenchSplashFinish?.())");
      } catch {}
      if (animated) await delay(SPLASH_EXIT_MS);
      remove();
    },
    dispose: remove,
  };
}

module.exports = { createWorkbenchSplash };
