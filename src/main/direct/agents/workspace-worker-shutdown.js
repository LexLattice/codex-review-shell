"use strict";

const crypto = require("node:crypto");

const WORKSPACE_WORKER_SHUTDOWN_PLAN_SCHEMA = "direct_workspace_worker_shutdown_plan@1";
const WORKSPACE_WORKER_SHUTDOWN_RECEIPT_SCHEMA = "direct_workspace_worker_shutdown_receipt@1";

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function digestFor(domain, value) {
  return `sha256:${crypto.createHash("sha256").update(`${domain}\0${stableStringify(value)}`).digest("hex")}`;
}

function buildWorkspaceWorkerShutdownPlan(input = {}) {
  const plan = {
    schema: WORKSPACE_WORKER_SHUTDOWN_PLAN_SCHEMA,
    reasonCode: normalizeString(input.reasonCode, "direct_runtime_shutdown"),
    steps: [
      { sequence: 1, action: "stop_worker_intake", required: true },
      { sequence: 2, action: "request_child_cancellation", required: true },
      { sequence: 3, action: "await_child_and_provider_acknowledgement", required: true },
      { sequence: 4, action: "drain_workspace_backend_requests", required: true },
      { sequence: 5, action: "dispose_workspace_backends", required: true },
      { sequence: 6, action: "close_lifecycle_registry", required: true },
    ],
    backendDisposalBeforeChildAcknowledgementAllowed: false,
    forcedWorkspaceCleanupAllowed: false,
  };
  plan.planDigest = digestFor("direct-workspace-worker-shutdown-plan@1", plan);
  return plan;
}

async function runWorkspaceWorkerShutdown(input = {}) {
  const plan = buildWorkspaceWorkerShutdownPlan(input);
  const events = [];
  const invoke = async (name, callback) => {
    if (typeof callback !== "function") {
      const error = new Error(`direct_workspace_worker_shutdown_${name}_missing`);
      error.code = `direct_workspace_worker_shutdown_${name}_missing`;
      throw error;
    }
    const result = await callback({ reasonCode: plan.reasonCode, plan });
    events.push({ action: name, status: "completed" });
    return result;
  };

  let poolDrain;
  try {
    await invoke("stop_worker_intake", input.stopWorkerIntake);
    await invoke("request_child_cancellation", input.requestChildCancellation);
    poolDrain = await invoke("await_child_and_provider_acknowledgement", input.awaitChildAcknowledgement);
    if (poolDrain?.status !== "drained") {
      const error = new Error("direct_workspace_worker_shutdown_child_acknowledgement_incomplete");
      error.code = "direct_workspace_worker_shutdown_child_acknowledgement_incomplete";
      throw error;
    }
    const backendDrain = await invoke("drain_workspace_backend_requests", input.drainWorkspaceBackends);
    if (backendDrain?.status !== "drained") {
      const error = new Error("direct_workspace_worker_shutdown_backend_drain_incomplete");
      error.code = "direct_workspace_worker_shutdown_backend_drain_incomplete";
      throw error;
    }
    await invoke("dispose_workspace_backends", input.disposeWorkspaceBackends);
    await invoke("close_lifecycle_registry", input.closeLifecycleRegistry);
  } catch (error) {
    const receipt = {
      schema: WORKSPACE_WORKER_SHUTDOWN_RECEIPT_SCHEMA,
      status: "blocked",
      blockerCode: normalizeString(error?.code, "direct_workspace_worker_shutdown_failed"),
      planDigest: plan.planDigest,
      events,
      backendDisposalStarted: events.some((event) => event.action === "dispose_workspace_backends"),
      childAcknowledgementComplete: poolDrain?.status === "drained",
      forcedWorkspaceCleanupStarted: false,
    };
    receipt.receiptDigest = digestFor("direct-workspace-worker-shutdown-receipt@1", receipt);
    return receipt;
  }

  const receipt = {
    schema: WORKSPACE_WORKER_SHUTDOWN_RECEIPT_SCHEMA,
    status: "completed",
    blockerCode: "",
    planDigest: plan.planDigest,
    events,
    backendDisposalStarted: true,
    childAcknowledgementComplete: true,
    forcedWorkspaceCleanupStarted: false,
  };
  receipt.receiptDigest = digestFor("direct-workspace-worker-shutdown-receipt@1", receipt);
  return receipt;
}

module.exports = {
  WORKSPACE_WORKER_SHUTDOWN_PLAN_SCHEMA,
  WORKSPACE_WORKER_SHUTDOWN_RECEIPT_SCHEMA,
  buildWorkspaceWorkerShutdownPlan,
  runWorkspaceWorkerShutdown,
};
