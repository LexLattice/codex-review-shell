"use strict";

const { EventEmitter } = require("node:events");

function toErrorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}

class CodexSurfaceSession extends EventEmitter {
  constructor(webContents) {
    super();
    this.webContents = webContents;
    this.socket = null;
    this.connection = null;
    this.nextId = 0;
    this.pending = new Map();
    this.lastError = "";
    this.disposing = false;
  }

  sendEvent(payload) {
    this.emit("event", payload);
    if (!this.webContents || this.webContents.isDestroyed()) return;
    this.webContents.send("codex-surface:event", payload);
  }

  emitStatus(status, extra = {}) {
    this.sendEvent({
      type: "connection-status",
      status,
      error: extra.error || "",
      connection: this.connection,
    });
  }

  rejectPending(message) {
    for (const [id, pending] of this.pending.entries()) {
      pending.reject(new Error(message));
      this.pending.delete(id);
    }
  }

  async connect(connection) {
    const nextWsUrl = String(connection?.wsUrl || "").trim();
    if (!nextWsUrl) throw new Error("No Codex app-server connection URL was provided.");
    if (this.socket && this.socket.readyState === WebSocket.OPEN && this.connection?.wsUrl === nextWsUrl) {
      return { connected: true, connection: this.connection };
    }

    await this.dispose({ silent: true });

    this.connection = { ...connection };
    this.disposing = false;
    this.emitStatus("connecting");

    await new Promise((resolve, reject) => {
      const socket = new WebSocket(nextWsUrl);
      let settled = false;

      const finish = (error) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve();
      };

      socket.addEventListener("open", () => {
        this.socket = socket;
        this.lastError = "";
        this.emitStatus("connected");
        finish();
      });

      socket.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(String(event.data || ""));
          if (message.id && this.pending.has(message.id)) {
            const pending = this.pending.get(message.id);
            this.pending.delete(message.id);
            if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
            else pending.resolve(message.result);
            return;
          }

          if (message.method && message.id) {
            this.sendEvent({ type: "rpc-request", id: message.id, method: message.method, params: message.params || {} });
            return;
          }

          if (message.method) {
            this.sendEvent({ type: "rpc-notification", method: message.method, params: message.params || {} });
          }
        } catch (error) {
          this.sendEvent({ type: "protocol-error", error: toErrorMessage(error, "Invalid Codex RPC payload.") });
        }
      });

      socket.addEventListener("error", () => {
        if (this.disposing) return;
        this.lastError = "Codex app-server connection failed.";
        this.emitStatus("error", { error: this.lastError });
        if (socket !== this.socket) finish(new Error(this.lastError));
      });

      socket.addEventListener("close", () => {
        if (this.disposing) return;
        const message = this.lastError || "Codex app-server connection closed.";
        this.rejectPending(message);
        if (this.socket === socket) this.socket = null;
        this.emitStatus("disconnected", { error: message });
        if (!settled) finish(new Error(message));
      });
    });

    return { connected: true, connection: this.connection };
  }

  async request(method, params = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Codex connection is not open.");
    }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  async notify(method, params = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Codex connection is not open.");
    }
    this.socket.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
    return true;
  }

  async respond(id, result) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Codex connection is not open.");
    }
    this.socket.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
    return true;
  }

  async dispose(options = {}) {
    const socket = this.socket;
    this.disposing = true;
    this.socket = null;
    this.connection = options.keepConnection ? this.connection : null;
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.close();
      } catch {}
    }
    this.rejectPending(options.reason || "Codex surface session disposed.");
    if (!options.silent) this.emitStatus("disconnected", { error: options.reason || "" });
  }
}

module.exports = {
  CodexSurfaceSession,
};
