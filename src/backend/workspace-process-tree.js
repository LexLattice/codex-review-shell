"use strict";

const fs = require("node:fs");
const { spawn } = require("node:child_process");

function childExited(child) {
  return !child || child.exitCode !== null || child.signalCode !== null;
}

function waitForChildExit(child, timeoutMs) {
  if (childExited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
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
    timer = setTimeout(() => finish(childExited(child)), timeoutMs);
    timer.unref?.();
  });
}

function posixProcessGroupAlive(pid, killImpl = process.kill) {
  try {
    killImpl(-pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    return true;
  }
}

function linuxProcessGroupHasMutableMembers(pid, options = {}) {
  if (typeof options.processGroupStateImpl === "function") {
    return options.processGroupStateImpl(pid) === "mutable";
  }
  if (options.killImpl && options.killImpl !== process.kill) return true;
  const procRoot = options.procRoot || "/proc";
  let entries;
  try {
    entries = fs.readdirSync(procRoot);
  } catch {
    return true;
  }
  let groupMemberFound = false;
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    let stat;
    try {
      stat = fs.readFileSync(`${procRoot}/${entry}/stat`, "utf8");
    } catch {
      continue;
    }
    const commEnd = stat.lastIndexOf(")");
    if (commEnd < 0) continue;
    const fields = stat.slice(commEnd + 1).trim().split(/\s+/);
    const state = fields[0];
    const processGroupId = Number(fields[2]);
    if (processGroupId !== Number(pid)) continue;
    groupMemberFound = true;
    if (state !== "Z" && state !== "X") return true;
  }
  // A group represented only by zombies has no actor capable of mutating the
  // workspace. If the proc snapshot raced creation, retain custody by falling
  // back to the kernel group-existence witness.
  return groupMemberFound ? false : posixProcessGroupAlive(pid, options.killImpl || process.kill);
}

function posixProcessGroupCanMutate(pid, options = {}) {
  const killImpl = options.killImpl || process.kill;
  if (!posixProcessGroupAlive(pid, killImpl)) return false;
  if ((options.platform || process.platform) !== "linux") return true;
  return linuxProcessGroupHasMutableMembers(pid, options);
}

function waitForPosixProcessGroupExit(pid, timeoutMs, options = {}) {
  const killImpl = options.killImpl || process.kill;
  const pollMs = Number.isFinite(Number(options.pollMs))
    ? Math.max(1, Math.min(100, Math.floor(Number(options.pollMs))))
    : 10;
  if (!posixProcessGroupCanMutate(pid, options)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const poll = () => {
      if (!posixProcessGroupCanMutate(pid, options)) {
        resolve(true);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(poll, Math.min(pollMs, timeoutMs));
    };
    poll();
  });
}

function runTaskkill(pid, options = {}) {
  const spawnImpl = options.spawnImpl || spawn;
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Math.max(1, Math.min(30_000, Math.floor(Number(options.timeoutMs))))
    : 2_000;
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
    let timer = null;
    let verificationTimer = null;
    let timedOut = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(verificationTimer);
      resolve(result);
    };
    child.once("error", (error) => finish({
      exitCode: null,
      errorCode: error?.code || "taskkill_failed",
    }));
    child.once("exit", (exitCode) => finish(timedOut ? {
      exitCode: null,
      errorCode: "taskkill_timeout",
      helperQuiesced: true,
    } : {
      exitCode,
      errorCode: exitCode === 0 ? "" : "taskkill_nonzero_exit",
      helperQuiesced: true,
    }));
    timer = setTimeout(() => {
      timedOut = true;
      try { child.kill?.(); } catch {}
      verificationTimer = setTimeout(() => finish({
        exitCode: null,
        errorCode: "taskkill_timeout_helper_exit_unverified",
        helperQuiesced: false,
      }), Math.max(50, Math.min(500, timeoutMs)));
    }, timeoutMs);
  });
}

async function terminateWindowsProcessTree(child, options = {}) {
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Math.max(1, Math.min(30_000, Math.floor(Number(options.timeoutMs))))
    : 2_000;
  if (typeof options.windowsJobObjectTerminationImpl === "function") {
    const receipt = await options.windowsJobObjectTerminationImpl(child, { timeoutMs });
    if (
      receipt?.quiesced === true &&
      receipt?.containmentKind === "windows_job_object" &&
      receipt?.jobClosed === true
    ) {
      return {
        quiesced: true,
        method: "windows_job_object_closed",
        blockerCode: "",
      };
    }
    return {
      quiesced: false,
      method: "windows_job_object_unverified",
      blockerCode: receipt?.blockerCode || "workspace_windows_job_object_quiescence_unverified",
    };
  }

  // `taskkill /T` follows a process ancestry snapshot. A child can detach or
  // be re-parented before that snapshot, so even a zero exit cannot prove that
  // every process capable of mutating the workspace is gone. It is retained as
  // best-effort cleanup only; authority-bearing callers must require a Job
  // Object receipt and fail closed when one is unavailable.
  const taskkill = await runTaskkill(child.pid, options);
  if (taskkill.exitCode === 0) await waitForChildExit(child, timeoutMs);
  return {
    quiesced: false,
    method: "taskkill_tree_force_uncontained",
    blockerCode: taskkill.errorCode || "workspace_windows_job_object_containment_unavailable",
  };
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
  if (platform === "win32") {
    return terminateWindowsProcessTree(child, { ...options, timeoutMs });
  }

  const killImpl = options.killImpl || process.kill;
  if (!posixProcessGroupAlive(child.pid, killImpl)) {
    return { quiesced: true, method: "posix_process_group_absent", blockerCode: "" };
  }
  let signalDelivered = false;
  try {
    killImpl(-child.pid, signal);
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
  let exited = await waitForPosixProcessGroupExit(child.pid, timeoutMs, options);
  let escalated = false;
  if (!exited && signal !== "SIGKILL") {
    escalated = true;
    try {
      killImpl(-child.pid, "SIGKILL");
      exited = await waitForPosixProcessGroupExit(child.pid, timeoutMs, options);
    } catch {}
  }
  return {
    quiesced: exited,
    method: escalated ? "posix_process_group_signal_escalated" : "posix_process_group_signal",
    blockerCode: exited ? "" : "workspace_posix_process_group_exit_unverified",
  };
}

module.exports = {
  linuxProcessGroupHasMutableMembers,
  posixProcessGroupAlive,
  posixProcessGroupCanMutate,
  runTaskkill,
  terminateWorkspaceProcessTree,
  waitForPosixProcessGroupExit,
};
