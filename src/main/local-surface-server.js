"use strict";

const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function safePath(rootDir, pathname) {
  const relativePath = pathname === "/" ? "codex-surface.html" : pathname.replace(/^\/+/, "");
  const resolved = path.resolve(rootDir, relativePath);
  const normalizedRoot = `${path.resolve(rootDir)}${path.sep}`;
  if (resolved !== path.resolve(rootDir) && !resolved.startsWith(normalizedRoot)) return null;
  return resolved;
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
      try {
        const url = new URL(request.url || "/", "http://127.0.0.1");
        const filePath = safePath(this.rootDir, url.pathname);
        if (!filePath) {
          response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          response.end("Forbidden");
          return;
        }
        const body = await fs.readFile(filePath);
        response.writeHead(200, {
          "Content-Type": CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
          "Cache-Control": "no-store",
        });
        response.end(body);
      } catch (error) {
        response.writeHead(error?.code === "ENOENT" ? 404 : 500, { "Content-Type": "text/plain; charset=utf-8" });
        response.end(error?.code === "ENOENT" ? "Not found" : error?.message || "Surface server error");
      }
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
};
