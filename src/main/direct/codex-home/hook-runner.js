"use strict";

// Runs one hook command the way Codex does: through the environment's shell
// (PowerShell on Windows, using commandWindows when given; bash elsewhere),
// one JSON object on stdin, in the project folder, outside the tool
// sandbox, killed at its timeout. Output is bounded. Used in this process
// for the host's own environment and behind the executor's hook/run.

const { spawn } = require("node:child_process");
const fs = require("node:fs");

const MAX_OUTPUT_BYTES = 64 * 1024;

function windowsPowerShell(env) {
  const root = env.SystemRoot || env.SYSTEMROOT || "C:\\Windows";
  return `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
}

function hookShell(hook, platform, env) {
  if (platform === "win32") {
    // `powershell -Command` reports only 0 or 1 for a native program; hooks
    // signal with exit 2, so the program's own code is passed through.
    const script = `${hook.commandWindows || hook.command}\nif ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }`;
    return { command: windowsPowerShell(env), args: ["-NoProfile", "-NonInteractive", "-Command", script] };
  }
  const bash = ["/bin/bash", "/usr/bin/bash"].find((candidate) => fs.existsSync(candidate)) || "/bin/sh";
  return { command: bash, args: ["-c", hook.command] };
}

function killTree(child, platform) {
  try {
    if (platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else process.kill(-child.pid, "SIGKILL");
  } catch {
    try { child.kill("SIGKILL"); } catch {}
  }
}

function runHookProcess(input = {}) {
  const platform = input.platform || process.platform;
  const env = input.env && typeof input.env === "object" ? input.env : process.env;
  const timeoutMs = Math.max(1_000, Math.min(Number(input.timeoutMs) || 600_000, 3_600_000));
  const { command, args } = Array.isArray(input.argv) && input.argv.length
    ? { command: String(input.argv[0]), args: input.argv.slice(1).map(String) }
    : hookShell(input, platform, env);
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd: input.cwd && fs.existsSync(input.cwd) ? input.cwd : undefined,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        detached: platform !== "win32",
      });
    } catch (error) {
      resolve({ exitCode: null, stdout: "", stderr: String(error?.message || error), timedOut: false, spawnError: true });
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const take = (current, chunk) => (current.length >= MAX_OUTPUT_BYTES ? current : (current + chunk).slice(0, MAX_OUTPUT_BYTES));
    child.stdout.on("data", (chunk) => { stdout = take(stdout, String(chunk)); });
    child.stderr.on("data", (chunk) => { stderr = take(stderr, String(chunk)); });
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child, platform);
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ exitCode: null, stdout, stderr: stderr || String(error?.message || error), timedOut, spawnError: true });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr, timedOut });
    });
    child.stdin.on("error", () => {});
    if (typeof input.stdin === "string") child.stdin.end(input.stdin);
    else child.stdin.end();
  });
}

module.exports = { runHookProcess };
