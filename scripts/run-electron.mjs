import { spawn } from "node:child_process";
import process from "node:process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const electronBinary = require("electron");
const childEnv = { ...process.env };
const smokeExitMs = Number.parseInt(childEnv.CODEX_REVIEW_SHELL_SMOKE_EXIT_MS ?? "", 10);

delete childEnv.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, process.argv.slice(2), {
  stdio: "inherit",
  env: childEnv,
});

let forcedSmokeExit = false;
let smokeKillTimer = null;

if (Number.isFinite(smokeExitMs) && smokeExitMs > 0) {
  smokeKillTimer = setTimeout(() => {
    forcedSmokeExit = true;
    child.kill();
  }, smokeExitMs + 5000);
}

child.on("exit", (code, signal) => {
  if (smokeKillTimer) clearTimeout(smokeKillTimer);
  if (forcedSmokeExit) {
    process.exit(0);
    return;
  }
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error("Failed to launch Electron child process.", error);
  process.exit(1);
});
