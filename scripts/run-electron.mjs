import { spawn } from "node:child_process";
import process from "node:process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const electronBinary = require("electron");
const childEnv = { ...process.env };
const smokeExitMs = Number.parseInt(childEnv.CODEX_REVIEW_SHELL_SMOKE_EXIT_MS ?? "", 10);
const isWsl = Boolean(childEnv.WSL_DISTRO_NAME || childEnv.WSL_INTEROP);
const filterKnownWslDbusNoise =
  isWsl && childEnv.CODEX_SHOW_WSL_DBUS_WARNINGS !== "1";

delete childEnv.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, process.argv.slice(2), {
  stdio: filterKnownWslDbusNoise
    ? ["inherit", "inherit", "pipe"]
    : "inherit",
  env: childEnv,
});

if (filterKnownWslDbusNoise) {
  forwardElectronStderr(child.stderr);
}

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

function forwardElectronStderr(stderr) {
  stderr.setEncoding("utf8");
  let pending = "";

  stderr.on("data", (chunk) => {
    pending += chunk;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";

    for (const line of lines) {
      if (!isKnownWslDbusProbe(line)) {
        process.stderr.write(`${line}\n`);
      }
    }
  });

  stderr.on("end", () => {
    if (pending && !isKnownWslDbusProbe(pending)) {
      process.stderr.write(pending);
    }
  });
}

function isKnownWslDbusProbe(line) {
  return (
    /^\[[^\]]+:ERROR:dbus\/bus\.cc:\d+\] Failed to connect to the bus: (?:Failed to connect to socket \/run\/dbus\/system_bus_socket: No such file or directory|Could not parse server address: Unknown address type \(examples of valid types are "tcp" and on UNIX "unix"\))\r?$/.test(
      line,
    ) ||
    /^\[[^\]]+:ERROR:dbus\/object_proxy\.cc:\d+\] Failed to call method: org\.freedesktop\.DBus\.NameHasOwner: object_path= \/org\/freedesktop\/DBus: unknown error type:\s*$/.test(
      line,
    )
  );
}
