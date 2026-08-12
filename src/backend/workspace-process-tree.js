"use strict";

const { spawn } = require("node:child_process");

function childExited(child) {
  return !child || child.exitCode !== null || child.signalCode !== null;
}

function waitForChildExit(child, timeoutMs) {
  if (childExited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener?.("close", onExit);
      child.removeListener?.("exit", onExit);
      resolve(value);
    };
    const onExit = () => finish(true);
    child.once?.("close", onExit);
    child.once?.("exit", onExit);
    const timer = setTimeout(() => finish(childExited(child)), timeoutMs);
    timer.unref?.();
  });
}

function runTaskkill(pid, options = {}) {
  const spawnImpl = options.spawnImpl || spawn;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } catch (error) {
      resolve({ exitCode: null, errorCode: error?.code || "taskkill_spawn_failed" });
      return;
    }
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.once("error", (error) => finish({
      exitCode: null,
      errorCode: error?.code || "taskkill_failed",
    }));
    child.once("exit", (exitCode) => finish({
      exitCode,
      errorCode: exitCode === 0 ? "" : "taskkill_nonzero_exit",
    }));
  });
}

async function terminateWorkspaceProcessTree(child, options = {}) {
  const platform = options.platform || process.platform;
  const signal = options.signal || "SIGTERM";
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Math.max(1, Math.min(30_000, Math.floor(Number(options.timeoutMs))))
    : 2_000;
  if (!child?.pid) {
    return {
      quiesced: childExited(child),
      method: "no_process_identity",
      blockerCode: childExited(child) ? "" : "workspace_process_identity_missing",
    };
  }
  if (childExited(child)) {
    return { quiesced: true, method: "already_exited", blockerCode: "" };
  }

  if (platform === "win32") {
    const taskkill = await runTaskkill(child.pid, options);
    if (taskkill.exitCode !== 0) {
      return {
        quiesced: false,
        method: "taskkill_tree_force",
        blockerCode: taskkill.errorCode || "workspace_windows_process_tree_kill_failed",
      };
    }
    const exited = await waitForChildExit(child, timeoutMs);
    return {
      quiesced: exited,
      method: "taskkill_tree_force",
      blockerCode: exited ? "" : "workspace_windows_process_tree_exit_unverified",
    };
  }

  let signalDelivered = false;
  try {
    process.kill(-child.pid, signal);
    signalDelivered = true;
  } catch {
    try {
      signalDelivered = child.kill(signal) !== false;
    } catch {}
  }
  if (!signalDelivered) {
    return {
      quiesced: false,
      method: "posix_process_group_signal",
      blockerCode: "workspace_posix_process_tree_signal_failed",
    };
  }
  const exited = await waitForChildExit(child, timeoutMs);
  return {
    quiesced: exited,
    method: "posix_process_group_signal",
    blockerCode: exited ? "" : "workspace_posix_process_tree_exit_unverified",
  };
}

module.exports = {
  terminateWorkspaceProcessTree,
};
