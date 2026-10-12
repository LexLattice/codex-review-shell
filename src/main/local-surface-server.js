"use strict";

const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

// Third-party browser files the surfaces use, served from their npm
// packages: an exact allowlist, never a directory mapping.
const NODE_MODULES_ROOT = path.resolve(__dirname, "..", "..", "node_modules");
const VENDOR_FILES = Object.freeze({
  "/vendor/xterm/xterm.js": path.join(NODE_MODULES_ROOT, "@xterm", "xterm", "lib", "xterm.js"),
  "/vendor/xterm/xterm.css": path.join(NODE_MODULES_ROOT, "@xterm", "xterm", "css", "xterm.css"),
  "/vendor/xterm/addon-fit.js": path.join(NODE_MODULES_ROOT, "@xterm", "addon-fit", "lib", "addon-fit.js"),
});

// The app serves its surfaces from this private scheme rather than from an
// HTTP port: no port another program could take first, and one origin across
// launches, so the pages' saved settings (Access, panels) and Chromium's code
// cache for their scripts carry over. Code cache for a custom scheme is keyed
// to a hash of each script, so a changed file never runs stale code.
// LocalSurfaceServer (HTTP) stays for tests that open the pages in a plain
// browser.
const SURFACE_SCHEME = "codex-surface";
const SURFACE_HOST = "app";
const SURFACE_ORIGIN = `${SURFACE_SCHEME}://${SURFACE_HOST}`;

function safePath(rootDir, pathname) {
  if (Object.prototype.hasOwnProperty.call(VENDOR_FILES, pathname)) return VENDOR_FILES[pathname];
  const relativePath = pathname === "/" ? "codex-surface.html" : pathname.replace(/^\/+/, "");
  const resolved = path.resolve(rootDir, relativePath);
  const normalizedRoot = `${path.resolve(rootDir)}${path.sep}`;
  if (resolved !== path.resolve(rootDir) && !resolved.startsWith(normalizedRoot)) return null;
  return resolved;
}

const textResponse = (status, text) => ({ status, contentType: "text/plain; charset=utf-8", body: Buffer.from(text, "utf8") });

async function readSurfaceFile(rootDir, pathname) {
  const filePath = safePath(rootDir, pathname);
  if (!filePath) return textResponse(403, "Forbidden");
  try {
    return {
      status: 200,
      contentType: CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      body: await fs.readFile(filePath),
    };
  } catch (error) {
    return error?.code === "ENOENT" || error?.code === "EISDIR"
      ? textResponse(404, "Not found")
      : textResponse(500, error?.message || "Surface file error");
  }
}

// Before the app is ready (src/boot.js).
function registerSurfaceScheme(protocol) {
  protocol.registerSchemesAsPrivileged([
    { scheme: SURFACE_SCHEME, privileges: { standard: true, secure: true, codeCache: true } },
  ]);
}

const sessionsServingSurfaces = new WeakSet();

// Only the session given serves the scheme; pages in other sessions (the
// ChatGPT plane, web views) can't load the surfaces.
function serveSurfaceScheme(session, rootDir) {
  if (sessionsServingSurfaces.has(session)) return SURFACE_ORIGIN;
  const root = path.resolve(rootDir);
  session.protocol.handle(SURFACE_SCHEME, async (request) => {
    const url = new URL(request.url);
    const result = url.host === SURFACE_HOST && request.method === "GET"
      ? await readSurfaceFile(root, url.pathname)
      : textResponse(403, "Forbidden");
    return new Response(result.body, { status: result.status, headers: { "Content-Type": result.contentType } });
  });
  sessionsServingSurfaces.add(session);
  return SURFACE_ORIGIN;
}

class LocalSurfaceServer {
  constructor(rootDir) {
    this.rootDir = path.resolve(rootDir);
    this.server = null;
    this.baseUrl = "";
    this.startPromise = null;
  }

  async ensureStarted() {
    if (this.baseUrl) return this.baseUrl;
    if (!this.startPromise) this.startPromise = this.start();
    return this.startPromise;
  }

  async start() {
    if (this.server) return this.baseUrl;
    this.server = http.createServer(async (request, response) => {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const result = await readSurfaceFile(this.rootDir, url.pathname);
      response.writeHead(result.status, { "Content-Type": result.contentType, "Cache-Control": "no-store" });
      response.end(result.body);
    });

    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        this.server.off("error", reject);
        resolve();
      });
    });

    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("Unable to determine local surface server address.");
    this.baseUrl = `http://127.0.0.1:${address.port}`;
    return this.baseUrl;
  }

  async dispose() {
    this.startPromise = null;
    this.baseUrl = "";
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

module.exports = {
  LocalSurfaceServer,
  SURFACE_ORIGIN,
  SURFACE_SCHEME,
  VENDOR_FILES,
  readSurfaceFile,
  registerSurfaceScheme,
  serveSurfaceScheme,
};
