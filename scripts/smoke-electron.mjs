import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const userDataDir = process.env.CODEX_REVIEW_SHELL_USER_DATA_DIR
  || fs.mkdtempSync(path.join(os.tmpdir(), "codex-review-shell-smoke-"));

const env = {
  ...process.env,
  CODEX_REVIEW_SHELL_SMOKE_EXIT_MS: process.env.CODEX_REVIEW_SHELL_SMOKE_EXIT_MS || "1500",
  CODEX_REVIEW_SHELL_USER_DATA_DIR: userDataDir,
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
