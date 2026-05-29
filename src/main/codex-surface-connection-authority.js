"use strict";

const crypto = require("node:crypto");
const path = require("node:path");

function cleanString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function evidenceKey(prefix, value) {
  const text = cleanString(value, "");
  return text ? `${prefix}:${crypto.createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16)}` : "";
}

function basenameLabel(value, fallback = "") {
  const text = cleanString(value, "");
  return text ? path.basename(text) || fallback : fallback;
}

function commandLabel(value) {
  const text = cleanString(value, "codex");
  if (!/[\\/]/.test(text)) return text;
  return path.basename(text) || "codex";
}

function sanitizeCapabilities(capabilities) {
  const source = capabilities && typeof capabilities === "object" ? capabilities : {};
  const clone = typeof structuredClone === "function" ? structuredClone(source) : JSON.parse(JSON.stringify(source));
  if (clone.diagnostics && typeof clone.diagnostics === "object") {
    clone.diagnostics = {
      runtime: cleanString(clone.diagnostics.runtime, ""),
      source: cleanString(clone.diagnostics.source, "runtime-manager"),
      binaryLabel: commandLabel(clone.diagnostics.binaryPath),
      binaryEvidenceKey: evidenceKey("binary", clone.diagnostics.binaryPath),
      codexHomeLabel: basenameLabel(clone.diagnostics.codexHome, "default"),
      codexHomeEvidenceKey: evidenceKey("codex-home", clone.diagnostics.codexHome),
      readyUrlLabel: clone.diagnostics.readyUrl ? "local app-server ready URL" : "",
      readyUrlEvidenceKey: evidenceKey("ready-url", clone.diagnostics.readyUrl),
    };
  }
  return clone;
}

function publicCodexSurfaceConnection(connection = {}) {
  const connectionRef = cleanString(connection.connectionRef, "");
  return {
    projectId: cleanString(connection.projectId, ""),
    connectionRef,
    available: Boolean(connectionRef),
    runtime: cleanString(connection.runtime, ""),
    transport: "websocket",
    workspaceRootLabel: basenameLabel(connection.workspaceRoot, "workspace"),
    workspaceRootEvidenceKey: evidenceKey("workspace-root", connection.workspaceRoot),
    binaryLabel: commandLabel(connection.binaryPath),
    binaryEvidenceKey: evidenceKey("binary", connection.binaryPath),
    codexHomeLabel: basenameLabel(connection.codexHome, "default"),
    codexHomeEvidenceKey: evidenceKey("codex-home", connection.codexHome),
    readyUrlLabel: connection.readyUrl ? "local app-server ready URL" : "",
    readyUrlEvidenceKey: evidenceKey("ready-url", connection.readyUrl),
    provider: connection.provider || null,
    capabilities: sanitizeCapabilities(connection.capabilities || {}),
    activationEpoch: Number(connection.activationEpoch) || 0,
    authority: {
      connectionRef: "main_owned",
      wsUrl: "main_owned",
      authMode: "main_owned",
      tokenSource: "main_owned",
      rendererPayloadMayContain: ["connectionRef", "activationEpoch"],
      rendererPayloadMustNotContain: ["wsUrl", "readyUrl", "remoteAuth", "auth", "tokenFilePath", "tokenEnvVar"],
      evidenceRefs: [
        {
          id: evidenceKey("codex-connection", connectionRef),
          kind: "CodexAppServerConnectionAuthority",
          label: "Codex app-server connection is resolved by the main process from an opaque ref.",
          status: connectionRef ? "fresh" : "unavailable",
          confidence: connectionRef ? "proven" : "unknown",
        },
      ],
    },
  };
}

function createCodexSurfaceConnectionAuthority(project, session, options = {}) {
  const connectionRef = cleanString(options.connectionRef, `codex_conn_${crypto.randomUUID()}`);
  const privateConnection = {
    projectId: cleanString(project?.id, ""),
    connectionRef,
    wsUrl: cleanString(session?.wsUrl, ""),
    readyUrl: cleanString(session?.readyUrl, ""),
    runtime: cleanString(session?.runtime, ""),
    codexHome: cleanString(session?.codexHome, ""),
    workspaceRoot: cleanString(session?.workspaceRoot, ""),
    binaryPath: cleanString(session?.binaryPath, ""),
    provider: session?.provider || null,
    capabilities: session?.capabilities || null,
    activationEpoch: Number(options.activationEpoch) || 0,
    remoteAuth: project?.surfaceBinding?.codex?.remoteAuth || { mode: "none" },
  };
  return {
    privateConnection,
    publicConnection: publicCodexSurfaceConnection(privateConnection),
  };
}

function validateCodexSurfaceConnectionRequest(activeConnection, requestedConnection = {}) {
  const activeRef = cleanString(activeConnection?.connectionRef, "");
  const requestedRef = cleanString(requestedConnection?.connectionRef, "");
  if (!activeConnection?.wsUrl || !activeRef) {
    throw new Error("No main-owned Codex app-server connection is available.");
  }
  if (!requestedRef || requestedRef !== activeRef) {
    throw new Error("Renderer-supplied Codex app-server connection ref is stale or invalid.");
  }
  if (
    requestedConnection.wsUrl ||
    requestedConnection.readyUrl ||
    requestedConnection.remoteAuth ||
    requestedConnection.auth ||
    requestedConnection.tokenFilePath ||
    requestedConnection.tokenEnvVar
  ) {
    throw new Error("Renderer-supplied Codex app-server connection payload contains authority-bearing fields.");
  }
  const requestedEpoch = Number(requestedConnection.activationEpoch) || 0;
  const activeEpoch = Number(activeConnection.activationEpoch) || 0;
  if (requestedEpoch && activeEpoch && requestedEpoch !== activeEpoch) {
    throw new Error("Renderer-supplied Codex app-server connection ref belongs to a stale activation epoch.");
  }
  return activeConnection;
}

module.exports = {
  createCodexSurfaceConnectionAuthority,
  publicCodexSurfaceConnection,
  validateCodexSurfaceConnectionRequest,
};
