"use strict";

// Host-side registry of execution environments: the Windows host and each WSL
// distro. It discovers environments, says how the host would launch each
// environment's executor, and asks that executor to describe itself. It never
// computes another environment's facts on the host.

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const {
  EXECUTOR_METHODS,
  publicEnvironmentDescription,
  validateEnvironmentDescription,
} = require("../shared/executor-protocol");

const ENVIRONMENT_REGISTRY_SCHEMA = "direct_environment_registry@1";
const WSL_LIST_TIMEOUT_MS = 10_000;
const DESCRIBE_TIMEOUT_MS = 30_000;
// Distros that host container engines rather than user workspaces.
const SYSTEM_WSL_DISTROS = new Set(["docker-desktop", "docker-desktop-data", "rancher-desktop", "rancher-desktop-data"]);
const WINDOWS_NODE_CANDIDATES_FROM_WSL = Object.freeze([
  "/mnt/c/Program Files/nodejs/node.exe",
  "/mnt/c/Program Files (x86)/nodejs/node.exe",
]);
// Distros with appendWindowsPath=false have no wsl.exe on PATH.
const WSL_EXE_INTEROP_PATH = "/mnt/c/Windows/System32/wsl.exe";

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function registryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// `wsl.exe -l -q` writes UTF-16LE (usually without a BOM). Interop or
// WSL_UTF8=1 can produce UTF-8 instead, so detect rather than assume.
function decodeWslListOutput(output) {
  if (typeof output === "string") return output;
  const buffer = Buffer.isBuffer(output) ? output : Buffer.from(output || []);
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString("utf16le");
  }
  let zeroBytes = 0;
  for (let index = 1; index < buffer.length; index += 2) {
    if (buffer[index] === 0) zeroBytes += 1;
  }
  const looksUtf16 = buffer.length >= 2 && zeroBytes >= Math.floor(buffer.length / 2) * 0.6;
  return looksUtf16 ? buffer.toString("utf16le") : buffer.toString("utf8");
}

function parseWslDistroNames(output) {
  return [...new Set(decodeWslListOutput(output)
    .replace(/\u0000/g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\uFEFF/, "").trim())
    .filter(Boolean))];
}

function environmentIdFor(kind, distro = "") {
  if (kind === "wsl") return `wsl:${distro || "default"}`;
  return kind;
}

class DirectEnvironmentRegistry {
  constructor(options = {}) {
    this.platform = options.platform || process.platform;
    this.env = options.env || process.env;
    this.workspaceBackends = options.workspaceBackends || null;
    this.execFileImpl = typeof options.execFileImpl === "function" ? options.execFileImpl : execFile;
    this.fileExists = typeof options.fileExists === "function" ? options.fileExists : fs.existsSync;
    this.homedir = options.homedir || os.homedir();
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.environments = new Map();
    this.descriptions = new Map();
  }

  wslExecutable() {
    if (this.hostRunsInWsl() && this.fileExists(WSL_EXE_INTEROP_PATH)) return WSL_EXE_INTEROP_PATH;
    return "wsl.exe";
  }

  runWslList() {
    return new Promise((resolve) => {
      try {
        this.execFileImpl(this.wslExecutable(), ["-l", "-q"], {
          encoding: "buffer",
          timeout: WSL_LIST_TIMEOUT_MS,
          windowsHide: true,
        }, (error, stdout) => {
          if (error) {
            resolve({ ok: false, errorCode: normalizeString(error.code, "wsl_list_failed"), names: [] });
            return;
          }
          resolve({ ok: true, errorCode: "", names: parseWslDistroNames(stdout) });
        });
      } catch (error) {
        resolve({ ok: false, errorCode: normalizeString(error?.code, "wsl_list_failed"), names: [] });
      }
    });
  }

  hostRunsInWsl() {
    return this.platform === "linux" && Boolean(normalizeString(this.env.WSL_DISTRO_NAME, ""));
  }

  windowsNodeFromWsl() {
    return WINDOWS_NODE_CANDIDATES_FROM_WSL.find((candidate) => this.fileExists(candidate)) || "";
  }

  wslEnvironment(distro, launch, extra = {}) {
    return {
      environmentId: environmentIdFor("wsl", distro),
      kind: "wsl",
      distro,
      label: `WSL: ${distro}`,
      system: SYSTEM_WSL_DISTROS.has(distro.toLowerCase()),
      launch,
      ...extra,
    };
  }

  async discover() {
    const environments = [];
    let wslList = { ok: false, errorCode: "not_attempted", names: [] };
    if (this.platform === "win32") {
      environments.push({
        environmentId: "windows",
        kind: "windows",
        distro: "",
        label: "Windows",
        system: false,
        launch: { available: true, transport: "local-child" },
        host: true,
      });
      wslList = await this.runWslList();
      for (const distro of wslList.names) {
        environments.push(this.wslEnvironment(distro, { available: true, transport: "wsl.exe" }));
      }
    } else if (this.hostRunsInWsl()) {
      const current = normalizeString(this.env.WSL_DISTRO_NAME, "");
      const windowsNode = this.windowsNodeFromWsl();
      environments.push({
        environmentId: "windows",
        kind: "windows",
        distro: "",
        label: "Windows",
        system: false,
        launch: windowsNode
          ? { available: true, transport: "windows-native-resident" }
          : { available: false, transport: "windows-native-resident", reason: "windows_node_not_found" },
        host: false,
      });
      // Interop lists sibling distros; only the current one can be launched
      // from inside WSL until executors can target another distro.
      wslList = await this.runWslList();
      const names = wslList.ok && wslList.names.length ? wslList.names : [current];
      for (const distro of names.includes(current) ? names : [current, ...names]) {
        environments.push(distro === current
          ? this.wslEnvironment(distro, { available: true, transport: "local-child" }, { host: true })
          : this.wslEnvironment(distro, { available: false, transport: "wsl.exe", reason: "cross_distro_launch_unsupported" }));
      }
    } else {
      environments.push({
        environmentId: "local",
        kind: "local",
        distro: "",
        label: this.platform === "darwin" ? "macOS" : "Local",
        system: false,
        launch: { available: true, transport: "local-child" },
        host: true,
      });
    }
    this.environments = new Map(environments.map((environment) => [environment.environmentId, environment]));
    return {
      schema: ENVIRONMENT_REGISTRY_SCHEMA,
      hostPlatform: this.platform,
      discoveredAt: new Date(this.now()).toISOString(),
      wslListing: { ok: wslList.ok, errorCode: wslList.errorCode },
      environments: environments.map((environment) => ({ ...environment })),
    };
  }

  // A synthetic, read-only project used only to start an executor in the
  // environment. Hygiene is skipped when attaching it, so nothing is written.
  probeProjectFor(environment) {
    const projectId = `environment_probe_${environment.environmentId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
    if (environment.kind === "wsl") {
      return {
        id: projectId,
        name: `${environment.label} probe`,
        workspace: { kind: "wsl", distro: environment.distro, linuxPath: "/" },
      };
    }
    if (environment.kind === "windows") {
      return {
        id: projectId,
        name: "Windows probe",
        workspace: {
          kind: "windows",
          windowsPath: this.platform === "win32" ? this.homedir : "C:\\",
        },
      };
    }
    return {
      id: projectId,
      name: "Local probe",
      workspace: { kind: "local", localPath: this.homedir },
    };
  }

  async describe(environmentId, options = {}) {
    if (!this.workspaceBackends) {
      throw registryError("direct_environment_registry_backends_unavailable", "The environment registry has no executor manager.");
    }
    if (!this.environments.size) await this.discover();
    const environment = this.environments.get(environmentId);
    if (!environment) throw registryError("direct_environment_unknown", `Unknown execution environment: ${environmentId}`);
    if (environment.launch?.available !== true) {
      throw registryError(
        "direct_environment_launch_unavailable",
        `The ${environment.label} executor can't be started from this host (${environment.launch?.reason || "unavailable"}).`,
      );
    }
    const probe = this.probeProjectFor(environment);
    try {
      await this.workspaceBackends.ensureForProject(probe, { workspaceHygiene: false });
      const description = await this.workspaceBackends.requestForProject(
        probe,
        EXECUTOR_METHODS.environmentDescribe,
        {},
        options.timeoutMs || DESCRIBE_TIMEOUT_MS,
      );
      const errors = validateEnvironmentDescription(description);
      if (errors.length) {
        throw registryError("direct_environment_description_invalid", `Executor description rejected: ${errors.join(", ")}.`);
      }
      const expectedKind = environment.kind === "local" ? description.environmentKind : environment.kind;
      if (description.environmentKind !== expectedKind) {
        throw registryError(
          "direct_environment_description_kind_mismatch",
          `Expected a ${expectedKind} executor but it described itself as ${description.environmentKind}.`,
        );
      }
      if (environment.kind === "wsl" && description.distro && description.distro !== environment.distro) {
        throw registryError("direct_environment_description_distro_mismatch", "The WSL executor reported a different distro.");
      }
      const record = { environmentId, describedAt: new Date(this.now()).toISOString(), description };
      this.descriptions.set(environmentId, record);
      return record;
    } finally {
      if (options.keepExecutor !== true) this.workspaceBackends.disposeForProject(probe);
    }
  }

  /**
   * Lists one folder in an environment, natively, through its executor, for
   * picking a project folder. The probe executor stays up while the user
   * browses; it is read-only and writes nothing.
   */
  async listDirectory(environmentId, folderPath = "", options = {}) {
    if (!this.workspaceBackends) {
      throw registryError("direct_environment_registry_backends_unavailable", "The environment registry has no executor manager.");
    }
    if (!this.environments.size) await this.discover();
    const environment = this.environments.get(environmentId);
    if (!environment) throw registryError("direct_environment_unknown", `Unknown execution environment: ${environmentId}`);
    if (environment.launch?.available !== true) {
      throw registryError(
        "direct_environment_launch_unavailable",
        `The ${environment.label} environment can't be browsed from this host (${environment.launch?.reason || "unavailable"}).`,
      );
    }
    const probe = this.probeProjectFor(environment);
    await this.workspaceBackends.ensureForProject(probe, { workspaceHygiene: false });
    const listing = await this.workspaceBackends.requestForProject(
      probe,
      EXECUTOR_METHODS.fsList,
      { path: normalizeString(folderPath, ""), includeFiles: options.includeFiles === true, limit: options.limit },
      options.timeoutMs || DESCRIBE_TIMEOUT_MS,
    );
    return { environmentId, kind: environment.kind, distro: environment.distro, label: environment.label, ...listing };
  }

  cachedDescription(environmentId) {
    return this.descriptions.get(environmentId) || null;
  }

  publicSnapshot() {
    return {
      schema: ENVIRONMENT_REGISTRY_SCHEMA,
      hostPlatform: this.platform,
      environments: [...this.environments.values()].map((environment) => {
        const cached = this.descriptions.get(environment.environmentId);
        return {
          environmentId: environment.environmentId,
          kind: environment.kind,
          distro: environment.distro,
          label: environment.label,
          system: environment.system === true,
          host: environment.host === true,
          launch: { ...environment.launch },
          description: cached ? publicEnvironmentDescription(cached.description) : null,
          describedAt: cached?.describedAt || "",
        };
      }),
      rawPathIncluded: false,
    };
  }
}

module.exports = {
  DirectEnvironmentRegistry,
  ENVIRONMENT_REGISTRY_SCHEMA,
  SYSTEM_WSL_DISTROS,
  decodeWslListOutput,
  environmentIdFor,
  parseWslDistroNames,
};
