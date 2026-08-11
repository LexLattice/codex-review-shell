(() => {
  "use strict";

  const bridge = window.codexSurfaceBridge;
  const shell = document.getElementById("codexShell");
  const projectSwitcher = document.getElementById("t3ProjectSwitcher");
  const utilityProjectButton = document.querySelector('.t3-utility-rail [data-t3-action="projects"]');
  const directoryPanel = document.getElementById("directProjectDirectory");
  const directoryClose = document.getElementById("directProjectDirectoryClose");
  const directoryRefresh = document.getElementById("directProjectDirectoryRefresh");
  const directoryCount = document.getElementById("directProjectDirectoryCount");
  const directoryStatus = document.getElementById("directProjectDirectoryStatus");
  const directoryList = document.getElementById("directProjectDirectoryList");

  if (!directoryPanel || typeof bridge?.readDirectWorkbenchProjectDirectory !== "function") return;

  const view = {
    directory: null,
    loading: false,
    working: false,
    error: "",
    localTargetProjectId: "",
  };

  function createElement(tagName, className = "", text = "") {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function projectDirectoryOpen() {
    return directoryPanel.hidden === false;
  }

  function setProjectDirectoryOpen(open) {
    const next = Boolean(open);
    if (next && shell?.dataset?.t3Sidebar === "collapsed") {
      document.getElementById("t3SidebarToggle")?.click();
    }
    directoryPanel.hidden = !next;
    shell?.setAttribute("data-t3-projects-open", next ? "true" : "false");
    projectSwitcher?.setAttribute("aria-expanded", next ? "true" : "false");
    utilityProjectButton?.setAttribute("aria-pressed", next ? "true" : "false");
    if (next) {
      refreshDirectory().catch((error) => {
        view.error = error?.code || error?.message || "project_directory_unavailable";
        view.loading = false;
        render();
      });
    }
  }

  function blockerLabel(code) {
    const labels = {
      active_turn_in_current_project: "Finish the active turn before switching projects.",
      active_turn_in_target_project: "The target project still has active work.",
      project_activation_in_progress: "Another project activation is in progress.",
      project_substrate_unknown: "The target project has no recognized substrate binding.",
      project_runtime_unconfigured: "The target project has no configured runtime.",
      project_activation_source_stale: "The active project changed; refresh the directory.",
      project_catalog_revision_stale: "Project evidence changed; refresh before switching.",
      project_activation_target_unknown: "The target project is no longer configured.",
      client_activation_id_reused: "This activation request identity was already used.",
    };
    return labels[code] || String(code || "Project activation is unavailable.").replaceAll("_", " ");
  }

  function transitionState() {
    return view.directory?.transition?.state || "idle";
  }

  function renderStatus() {
    const transition = view.directory?.transition || {};
    let state = "ready";
    let text = "Choose a configured project. Main revalidates its substrate and runtime before switching.";
    if (view.loading && !view.directory) {
      state = "loading";
      text = "Loading configured project evidence…";
    } else if (view.error) {
      state = "failed";
      text = blockerLabel(view.error);
    } else if (view.working || transition.state === "activating") {
      state = "activating";
      const target = (view.directory?.projects || []).find((row) =>
        row.projectId === (view.localTargetProjectId || transition.targetProjectId));
      text = `Activating ${target?.displayName || "project"}… runtime teardown and rebinding are main-owned.`;
    } else if (transition.state === "failed") {
      state = "failed";
      text = blockerLabel(transition.reason || "project_activation_failed");
    } else if (transition.state === "completed") {
      state = "ready";
      text = "Project activation completed. The displayed project is the authoritative active selection.";
    }
    directoryStatus.dataset.state = state;
    directoryStatus.textContent = text;
  }

  function projectRow(row) {
    const container = createElement("article", "direct-project-row");
    container.dataset.projectId = row.projectId || "";
    container.dataset.state = row.state || "available";
    container.dataset.selectable = row.selectable ? "true" : "false";

    const copy = createElement("div", "direct-project-row-copy");
    const title = createElement("div", "direct-project-row-title");
    title.append(
      createElement("strong", "", row.displayName || "Unnamed project"),
      createElement("span", "direct-project-state-chip", row.state || "unknown"),
    );
    const evidence = createElement(
      "span",
      "direct-project-row-evidence",
      [
        row.substrate?.displayLabel || "workspace unknown",
        row.runtime?.displayLabel || "runtime unknown",
        row.restore?.displayLabel || "thread restore unknown",
      ].join(" · "),
    );
    copy.append(title, evidence);
    if (Array.isArray(row.blockerCodes) && row.blockerCodes.length) {
      copy.append(createElement("span", "direct-project-row-blocker", blockerLabel(row.blockerCodes[0])));
    }

    const action = createElement(
      "button",
      "",
      row.selected ? "Active" : row.state === "activating" ? "Switching" : row.selectable ? "Switch" : "Blocked",
    );
    action.type = "button";
    action.disabled = row.selected || !row.selectable || view.working || transitionState() === "activating";
    action.dataset.projectActivationTarget = row.projectId || "";
    action.addEventListener("click", () => activateProject(row));
    container.append(copy, action);
    return container;
  }

  function render() {
    const rows = Array.isArray(view.directory?.projects) ? view.directory.projects : [];
    directoryCount.textContent = view.directory
      ? `${rows.length} configured · ${view.directory.activeProjectId ? "1 active" : "none active"}`
      : view.loading ? "Loading…" : "Unavailable";
    directoryRefresh.disabled = view.loading || view.working;
    directoryList.replaceChildren();
    if (!rows.length) {
      directoryList.append(createElement(
        "p",
        "direct-project-directory-status",
        view.loading ? "Loading projects…" : "No renderer-safe project rows are available.",
      ));
    } else {
      for (const row of rows) directoryList.append(projectRow(row));
    }
    renderStatus();
  }

  async function refreshDirectory() {
    if (view.loading) return;
    view.loading = true;
    view.error = "";
    render();
    try {
      view.directory = await bridge.readDirectWorkbenchProjectDirectory();
    } catch (error) {
      view.error = error?.code || error?.message || "project_directory_unavailable";
    } finally {
      view.loading = false;
      render();
    }
  }

  async function activateProject(row) {
    if (!row?.selectable || view.working || !view.directory?.catalogRevision) return;
    view.working = true;
    view.error = "";
    view.localTargetProjectId = row.projectId;
    render();
    try {
      const receipt = await bridge.activateDirectWorkbenchProject({
        clientActivationId: globalThis.crypto?.randomUUID?.() || `project_activation_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        sourceProjectId: view.directory.activeProjectId,
        targetProjectId: row.projectId,
        expectedCatalogRevision: view.directory.catalogRevision,
      });
      if (!receipt?.ok) throw Object.assign(new Error(receipt?.reason || "project_activation_failed"), { code: receipt?.reason });
      if (receipt.status !== "accepted" && receipt.status !== "completed") {
        throw Object.assign(new Error(receipt.status || "project_activation_failed"), { code: receipt.status });
      }
      // The main process now owns the transition. A successful activation reloads this document.
    } catch (error) {
      view.working = false;
      view.localTargetProjectId = "";
      const reason = error?.code || error?.message || "project_activation_failed";
      try {
        view.directory = await bridge.readDirectWorkbenchProjectDirectory();
      } catch {
        // Keep the last safe directory projection beside the activation failure.
      }
      view.error = reason;
    }
    render();
  }

  projectSwitcher?.addEventListener("click", () => setProjectDirectoryOpen(!projectDirectoryOpen()));
  utilityProjectButton?.addEventListener("click", () => setProjectDirectoryOpen(!projectDirectoryOpen()));
  document.querySelector('.t3-utility-rail [data-t3-action="threads"]')?.addEventListener("click", () => {
    if (projectDirectoryOpen()) setProjectDirectoryOpen(false);
  });
  document.getElementById("t3SidebarToggle")?.addEventListener("click", () => {
    if (shell?.dataset?.t3Sidebar === "collapsed" && projectDirectoryOpen()) setProjectDirectoryOpen(false);
  });
  directoryClose?.addEventListener("click", () => setProjectDirectoryOpen(false));
  directoryRefresh?.addEventListener("click", () => refreshDirectory());

  bridge.onDirectWorkbenchProjectDirectoryEvent?.((event) => {
    if (event?.directory) view.directory = event.directory;
    view.working = false;
    view.localTargetProjectId = "";
    view.error = event?.receipt?.ok === false ? event.receipt.reason || "project_activation_failed" : "";
    render();
  });

  render();
  refreshDirectory().catch(() => {});
})();
