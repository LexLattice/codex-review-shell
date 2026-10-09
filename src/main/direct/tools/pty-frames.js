"use strict";

// The control channel to a terminal helper: src/backend/pty-helper.py on
// Linux and WSL, the job runner's ConPTY mode on Windows. Both read frames
// on stdin (one type byte, a 4-byte big-endian length, the payload) and
// write the terminal's output to stdout.

const fs = require("node:fs");
const path = require("node:path");

const PTY_HELPER_PATH = path.join(__dirname, "..", "..", "..", "backend", "pty-helper.py");
let ptyHelperSource = null;

// The helper is passed to python3 as `-c <source>` rather than by path: when
// the app runs on Windows, the WSL executor's copy of this file sits under
// /mnt/c, which the sandbox does not mount. With -c, sys.argv[0] is "-c", so
// the helper's argument positions are unchanged.
function ptyHelperArgs(rows, cols, command, args = []) {
  if (ptyHelperSource === null) ptyHelperSource = fs.readFileSync(PTY_HELPER_PATH, "utf8");
  return ["-c", ptyHelperSource, String(rows), String(cols), "--", command, ...(Array.isArray(args) ? args : [])];
}
const DEFAULT_PTY_ROWS = 24;
const DEFAULT_PTY_COLS = 80;
const PTY_SIGNALS = new Set(["SIGINT", "SIGTERM", "SIGKILL", "SIGHUP", "SIGQUIT"]);

function clampSize(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? Math.min(number, 1000) : fallback;
}

// { rows, cols } when a terminal was asked for, otherwise null.
function normalizePtySize(value) {
  if (!value) return null;
  const source = typeof value === "object" ? value : {};
  return { rows: clampSize(source.rows, DEFAULT_PTY_ROWS), cols: clampSize(source.cols, DEFAULT_PTY_COLS) };
}

function encodePtyFrame(kind, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload ?? ""), "utf8");
  const header = Buffer.alloc(5);
  header.write(kind, 0, "ascii");
  header.writeUInt32BE(body.length, 1);
  return Buffer.concat([header, body]);
}

function encodePtyResize(rows, cols) {
  const size = Buffer.alloc(4);
  size.writeUInt16BE(clampSize(rows, DEFAULT_PTY_ROWS), 0);
  size.writeUInt16BE(clampSize(cols, DEFAULT_PTY_COLS), 2);
  return encodePtyFrame("r", size);
}

/**
 * Wraps a helper's stdin. Input is typed into the terminal, so "end of
 * input" is the platform's EOF key, not closing stdin (which the helpers
 * treat as the host going away).
 */
class PtyChannel {
  constructor(stdin, options = {}) {
    this.stdin = stdin;
    this.platform = options.platform || process.platform;
  }

  writable() {
    return Boolean(this.stdin) && !this.stdin.destroyed && !this.stdin.writableEnded;
  }

  write(data, callback) {
    this.stdin.write(encodePtyFrame("d", Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8")), callback);
  }

  eof(callback) {
    this.write(this.platform === "win32" ? "\x1a\r" : "\x04", callback);
  }

  resize(rows, cols) {
    if (this.writable()) this.stdin.write(encodePtyResize(rows, cols));
  }

  signal(name) {
    const signal = PTY_SIGNALS.has(name) ? name : "SIGTERM";
    if (this.writable()) this.stdin.write(encodePtyFrame("k", signal));
    return true;
  }

  close() {
    if (this.writable()) this.stdin.end();
  }
}

module.exports = {
  DEFAULT_PTY_COLS,
  DEFAULT_PTY_ROWS,
  PTY_HELPER_PATH,
  PtyChannel,
  encodePtyFrame,
  encodePtyResize,
  normalizePtySize,
  ptyHelperArgs,
};
