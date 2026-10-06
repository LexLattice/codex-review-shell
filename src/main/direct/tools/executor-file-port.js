"use strict";

// File port for workspaces that live in another environment (a WSL workspace
// opened from a Windows host). It implements the same port contract as
// LocalFilePort in full-access-local-environment.js, but every operation runs
// inside the environment's executor, which runs LocalFilePort natively. The
// host keeps grant checks, patch parsing, and planning.

const path = require("node:path");
const { EXECUTOR_METHODS } = require("../../../shared/executor-protocol");
const {
  localError,
  pathText,
  safePathEvidence,
} = require("./full-access-local-environment");

const FILE_REQUEST_TIMEOUT_MS = 30_000;

class ExecutorFilePort {
  constructor(options = {}) {
    this.kind = "executor";
    this.workspaceBackends = options.workspaceBackends || null;
  }

  async request(input, method, params) {
    if (!this.workspaceBackends || !input?.project) {
      throw localError("direct_full_access_environment_unavailable", "The workspace's execution environment is unavailable.");
    }
    const session = await this.workspaceBackends.ensureForProject(input.project);
    return session.request(method, params, FILE_REQUEST_TIMEOUT_MS);
  }

  // Paths stay as the caller wrote them (relative to the workspace, or an
  // absolute path in the executor's own filesystem); the executor resolves
  // them natively. The canonical form is only used to spot duplicates.
  resolveTarget(_input, _grant, rawPath, label) {
    const text = pathText(rawPath, label);
    const canonicalTarget = text.startsWith("/")
      ? path.posix.normalize(text)
      : path.posix.join("/workspace", text);
    return {
      root: "",
      target: text,
      canonicalTarget,
      pathEvidenceKey: safePathEvidence(canonicalTarget),
      remote: true,
    };
  }

  // The executor applies the profile's read rules inside fs/read.
  async assertReadable() {}

  async readFile(resolved, maxBytes, input, grant) {
    const result = await this.request(input, EXECUTOR_METHODS.fsRead, {
      path: resolved.target,
      maxBytes,
      sandboxMode: grant?.sandboxMode,
      purpose: "read",
    });
    return { size: Number(result?.size || 0), bytes: Buffer.from(String(result?.bytesBase64 || ""), "base64") };
  }

  async readPatchTarget(resolved, operation, input, grant) {
    const result = await this.request(input, EXECUTOR_METHODS.fsRead, {
      path: resolved.target,
      sandboxMode: grant?.sandboxMode,
      purpose: "patch",
      operation,
    });
    return { exists: result?.exists === true, bytes: Buffer.from(String(result?.bytesBase64 || ""), "base64") };
  }

  async assertWritable(grant, resolved, input) {
    if (grant?.sandboxMode === "danger-full-access") return;
    await this.request(input, EXECUTOR_METHODS.fsStat, {
      path: resolved.target,
      sandboxMode: grant?.sandboxMode,
      check: "writable",
    });
  }

  async commit(grant, plans, input) {
    await this.request(input, EXECUTOR_METHODS.fsApplyPlannedPatch, {
      sandboxMode: grant?.sandboxMode,
      files: plans.map((plan) => ({
        path: plan._resolved.target,
        operation: plan.operation,
        beforeExists: plan.beforeExists,
        beforeDigest: plan.beforeDigest,
        afterText: plan._afterText,
      })),
    });
  }
}

module.exports = {
  ExecutorFilePort,
};
