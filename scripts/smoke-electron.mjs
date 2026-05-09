import { spawn } from "node:child_process";

const env = {
  ...process.env,
  CODEX_REVIEW_SHELL_SMOKE_EXIT_MS: process.env.CODEX_REVIEW_SHELL_SMOKE_EXIT_MS || "1500",
};

const command = process.platform === "win32" ? process.execPath : "xvfb-run";
const args = process.platform === "win32"
  ? ["./scripts/run-electron.mjs", "."]
  : ["-a", process.execPath, "./scripts/run-electron.mjs", "."];

const child = spawn(command, args, {
  cwd: process.cwd(),
  env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

