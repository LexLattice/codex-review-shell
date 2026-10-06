(function installDirectEnvironmentUxModel(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.DirectEnvironmentUxModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  // Pure helpers behind the Workbench's environment UX: which environment a
  // project or thread lives in, the environment picker's options, and the
  // folder browser's rows. No DOM and no bridge calls here.

  function text(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function plain(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  /**
   * Badge for a workspace ({ kind, distro }) or a project directory
   * substrate ({ workspaceKind, distro }).
   */
  function environmentBadge(source) {
    const value = plain(source);
    const kind = text(value.kind || value.workspaceKind) || "unknown";
    const distro = text(value.distro);
    if (kind === "wsl") {
      return { kind, text: distro ? `WSL · ${distro}` : "WSL", title: `Runs natively in WSL${distro ? ` (${distro})` : ""} with bash.` };
    }
    if (kind === "windows") return { kind, text: "Windows", title: "Runs natively on Windows with PowerShell." };
    if (kind === "local") return { kind, text: "Local", title: "Runs on this machine." };
    return { kind: "unknown", text: "Environment unknown", title: "This project has no recognized environment." };
  }

  /** The composer chip: environment plus the shell its commands use. */
  function composerEnvironmentLabel(workspace) {
    const badge = environmentBadge(workspace);
    if (badge.kind === "wsl") return `${badge.text} · bash`;
    if (badge.kind === "windows") return "Windows · PowerShell";
    return badge.text;
  }

  function environmentIdForWorkspace(workspace) {
    const value = plain(workspace);
    const kind = text(value.kind);
    if (kind === "wsl") return `wsl:${text(value.distro) || "default"}`;
    if (kind === "windows") return "windows";
    return "local";
  }

  /**
   * Picker options from the host's environment list. System distros (Docker
   * and similar) are left out; environments this host can't reach are shown
   * but disabled with the reason. The current workspace's environment is
   * always offered so editing an existing project never loses it.
   */
  function environmentOptions(environments, currentWorkspace = null) {
    const options = [];
    for (const entry of Array.isArray(environments) ? environments : []) {
      const environment = plain(entry);
      if (environment.system === true) continue;
      const kind = text(environment.kind);
      if (!["wsl", "windows", "local"].includes(kind)) continue;
      const available = environment.available === true || environment.launch?.available === true;
      options.push({
        value: text(environment.environmentId) || environmentIdForWorkspace(environment),
        kind,
        distro: kind === "wsl" ? text(environment.distro) : "",
        label: `${environmentBadge(environment).text}${environment.host === true ? " (this machine)" : ""}`,
        disabled: !available,
        reason: available ? "" : text(environment.reason || environment.launch?.reason) || "unavailable",
      });
    }
    options.sort((a, b) => Number(b.label.includes("(this machine)")) - Number(a.label.includes("(this machine)")));
    if (currentWorkspace && text(plain(currentWorkspace).kind)) {
      const currentId = environmentIdForWorkspace(currentWorkspace);
      if (!options.some((option) => option.value === currentId)) {
        const badge = environmentBadge(currentWorkspace);
        options.push({
          value: currentId,
          kind: badge.kind,
          distro: badge.kind === "wsl" ? text(plain(currentWorkspace).distro) : "",
          label: `${badge.text} (not found on this machine)`,
          disabled: false,
          reason: "not_discovered",
        });
      }
    }
    return options;
  }

  /** The editor's workspace path field for an environment kind. */
  function pathFieldForKind(kind) {
    if (kind === "wsl") return "linuxPath";
    if (kind === "windows") return "windowsPath";
    return "localPath";
  }

  /**
   * Rows for the folder browser from an executor's `fs/list` answer, plus
   * where Up goes. Hidden folders come last.
   */
  function folderBrowserView(listing) {
    const value = plain(listing);
    const entries = (Array.isArray(value.entries) ? value.entries : [])
      .filter((entry) => plain(entry).kind === "directory" && text(entry.path))
      .map((entry) => ({ name: text(entry.name) || text(entry.path), path: text(entry.path), hidden: entry.hidden === true }));
    entries.sort((a, b) => Number(a.hidden) - Number(b.hidden));
    const atDriveList = value.pathStyle === "windows" && !text(value.path);
    return {
      path: text(value.path),
      displayPath: atDriveList ? "Drives" : text(value.path),
      upTarget: text(value.parent),
      canUp: Boolean(text(value.parent)),
      canChoose: Boolean(text(value.path)),
      home: text(value.home),
      showDrives: value.pathStyle === "windows",
      entries,
      truncated: value.truncated === true,
    };
  }

  return Object.freeze({
    composerEnvironmentLabel,
    environmentBadge,
    environmentIdForWorkspace,
    environmentOptions,
    folderBrowserView,
    pathFieldForKind,
  });
});
