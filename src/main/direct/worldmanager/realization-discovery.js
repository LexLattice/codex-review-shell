"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { digestFor } = require("./control-plane");
const {
  buildRealizationOptionSnapshot,
} = require("./project-genesis");

function text(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function evidenceRef(kind, id, body) {
  return {
    kind,
    id,
    digest: digestFor(`direct-${kind}@1`, body),
  };
}

function isWslRuntime(input = {}) {
  if (text(input.env?.WSL_DISTRO_NAME, "")) return true;
  if (text(input.env?.WSL_INTEROP, "")) return true;
  try {
    return /microsoft|wsl/i.test(
      fs.readFileSync("/proc/sys/kernel/osrelease", "utf8"),
    );
  } catch {
    return false;
  }
}

function windowsNodeCandidates(input = {}) {
  const candidates = [
    text(input.windowsNodePath, ""),
    "/mnt/c/Program Files/nodejs/node.exe",
    "/mnt/c/Program Files (x86)/nodejs/node.exe",
  ].filter(Boolean);
  const userProfile = text(input.windowsUserProfileMount, "");
  if (userProfile) {
    candidates.push(
      path.join(
        userProfile,
        "AppData/Local/Programs/nodejs/node.exe",
      ),
    );
  }
  return [...new Set(candidates)];
}

function probeWindowsNode(input = {}) {
  for (const candidate of windowsNodeCandidates(input)) {
    if (!fs.existsSync(candidate)) continue;
    const probe = spawnSync(
      candidate,
      [
        "-p",
        "JSON.stringify({platform:process.platform,arch:process.arch,version:process.version})",
      ],
      {
        encoding: "utf8",
        timeout: 5000,
        windowsHide: true,
      },
    );
    if (probe.status !== 0) continue;
    try {
      const result = JSON.parse(String(probe.stdout || "").trim());
      if (result.platform !== "win32") continue;
      return {
        ready: true,
        nodePath: candidate,
        platform: result.platform,
        arch: text(result.arch, "unknown"),
        version: text(result.version, "unknown"),
      };
    } catch {}
  }
  return {
    ready: false,
    nodePath: "",
    platform: "unknown",
    arch: "unknown",
    version: "unknown",
  };
}

function discoverRealizationOptions(input = {}, options = {}) {
  const platform = text(input.platform, process.platform);
  const env = input.env || process.env;
  const wsl = platform === "linux" && isWslRuntime({ env });
  const nativeEnvironmentId = wsl
    ? "env_wsl_native"
    : platform === "win32"
      ? "env_windows_native"
      : platform === "darwin"
        ? "env_macos_native"
        : "env_linux_native";
  const nativeEnvironmentKind = wsl
    ? "wsl"
    : platform === "win32"
      ? "windows"
      : platform === "darwin"
        ? "macos"
        : platform === "linux"
          ? "linux"
          : "unknown";
  const nativeLabel = wsl
    ? `WSL${text(env.WSL_DISTRO_NAME, "") ? ` · ${env.WSL_DISTRO_NAME}` : ""}`
    : platform === "win32"
      ? "Windows"
      : platform === "darwin"
        ? "macOS"
        : "Linux";
  const nativeEvidence = {
    platform,
    environmentKind: nativeEnvironmentKind,
    processExecPathClass: "current_control_plane_runtime",
    wslDistroPresent: Boolean(text(env.WSL_DISTRO_NAME, "")),
  };
  const realizationOptions = [{
    environmentId: nativeEnvironmentId,
    environmentKind: nativeEnvironmentKind,
    displayLabel: nativeLabel,
    availability: "ready",
    admissionState: "eligible",
    nativeProcess: true,
    residentExecutorSupport: true,
    defaultShell: platform === "win32" ? "powershell" : "bash",
    capabilityClasses: [
      "native_process",
      "resident_workspace_executor",
      "project_manager_runtime_binding",
      "worker_runtime_binding",
    ],
    blockerCodes: [],
    evidenceRefs: [
      evidenceRef(
        "runtime_realization_probe",
        nativeEnvironmentId,
        nativeEvidence,
      ),
    ],
  }];
  let windowsProbe = null;
  if (wsl) {
    windowsProbe = probeWindowsNode(input);
    realizationOptions.push({
      environmentId: "env_windows_native",
      environmentKind: "windows",
      displayLabel: "Windows · native resident process",
      availability: windowsProbe.ready ? "ready" : "unavailable",
      admissionState: windowsProbe.ready ? "eligible" : "blocked",
      nativeProcess: windowsProbe.ready,
      residentExecutorSupport: windowsProbe.ready,
      defaultShell: "powershell",
      capabilityClasses: windowsProbe.ready
        ? [
            "native_process",
            "resident_workspace_executor",
            "project_manager_runtime_binding",
            "worker_runtime_binding",
            "windows_shell_integration",
          ]
        : [],
      blockerCodes: windowsProbe.ready
        ? []
        : ["windows_native_node_runtime_unavailable"],
      evidenceRefs: [
        evidenceRef(
          "runtime_realization_probe",
          "env_windows_native",
          {
            platform: windowsProbe.platform,
            arch: windowsProbe.arch,
            version: windowsProbe.version,
            nativeWindowsNodeObserved: windowsProbe.ready,
          },
        ),
      ],
    });
  }
  if (platform === "win32") {
    realizationOptions.push({
      environmentId: "env_wsl_native",
      environmentKind: "wsl",
      displayLabel: "WSL",
      availability: "unknown",
      admissionState: "blocked",
      nativeProcess: false,
      residentExecutorSupport: false,
      defaultShell: "bash",
      capabilityClasses: [],
      blockerCodes: ["wsl_runtime_discovery_not_wired"],
      evidenceRefs: [
        evidenceRef(
          "runtime_realization_probe",
          "env_wsl_native",
          { discoveryState: "not_wired" },
        ),
      ],
    });
  }
  const snapshot = buildRealizationOptionSnapshot({
    controlPlaneEnvironmentId: nativeEnvironmentId,
    options: realizationOptions,
    discoveryPosture: "host_process_and_native_runtime_probe",
  }, options);
  return {
    snapshot,
    privateBindings: {
      windowsNodePath: windowsProbe?.nodePath || "",
    },
  };
}

module.exports = {
  discoverRealizationOptions,
  isWslRuntime,
  probeWindowsNode,
};
