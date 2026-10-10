(() => {
  "use strict";

  // The sidebar's other projects: every project besides this one, with its
  // recent threads and badges for what they need (running, or waiting for
  // the owner). Clicking a thread brings its project to the front and opens
  // it; the project in front keeps its own thread rail above, marked from
  // the same overview (window.DirectWorkbenchOverview). Main sends a
  // fresh overview whenever a turn starts or ends or a request opens or
  // closes, in any project.

  const bridge = window.codexSurfaceBridge;
  const section = document.getElementById("workbenchOtherProjects");
  const list = document.getElementById("workbenchOtherProjectsList");
  const environmentModel = window.DirectEnvironmentUxModel || null;
  if (!section || !list || typeof bridge?.readDirectWorkbenchThreadOverview !== "function") return;

  const view = {
    overview: null,
    opening: "",
    error: "",
  };

  function createElement(tagName, className = "", text = "") {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function timeLabel(value) {
    const parsed = Date.parse(String(value || ""));
    if (!Number.isFinite(parsed)) return "";
    const minutes = Math.round((Date.now() - parsed) / 60000);
    if (minutes < 1) return "now";
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.round(hours / 24)}d`;
  }

  function stateBadge(state, count = 0) {
    if (state === "needs_you") {
      const badge = createElement("span", "workbench-state-badge needs-you", count > 1 ? `needs you · ${count}` : "needs you");
      badge.dataset.state = "needs_you";
      return badge;
    }
    if (state === "running") {
      const badge = createElement("span", "workbench-state-badge running", "running");
      badge.dataset.state = "running";
      return badge;
    }
    return null;
  }

  function environmentChip(row) {
    const workspace = { kind: row.workspaceKind, distro: row.distro };
    const badge = environmentModel?.environmentBadge
      ? environmentModel.environmentBadge(workspace)
      : { kind: row.workspaceKind, text: row.workspaceKind === "wsl" ? `WSL${row.distro ? ` · ${row.distro}` : ""}` : row.workspaceKind === "windows" ? "Windows" : "Local", title: "" };
    const chip = createElement("span", "direct-environment-badge", badge.text);
    chip.dataset.environmentKind = badge.kind;
    if (badge.title) chip.title = badge.title;
    return chip;
  }

  async function open(projectId, threadId = "") {
    if (view.opening || typeof bridge.openDirectWorkbenchThread !== "function") return;
    view.opening = `${projectId}:${threadId}`;
    view.error = "";
    render();
    try {
      const receipt = await bridge.openDirectWorkbenchThread({ projectId, threadId });
      if (receipt?.ok === false) throw Object.assign(new Error(receipt.reason || "open_failed"), { code: receipt.reason });
    } catch (error) {
      view.error = error?.code || error?.message || "open_failed";
    } finally {
      // The other project's surface comes to the front; this one keeps the
      // list for when it is shown again.
      view.opening = "";
      render();
    }
  }

  function errorLabel(code) {
    const labels = {
      thread_not_in_project: "That thread moved or was removed.",
      project_activation_in_progress: "Another project is opening.",
      project_binding_mutation_in_progress: "A project is being saved.",
      project_activation_source_stale: "Projects changed; try again.",
      project_catalog_revision_stale: "Projects changed; try again.",
      project_binding_archived: "That project is archived.",
    };
    return labels[code] || "Couldn't open it.";
  }

  function projectGroup(row) {
    const group = createElement("div", "workbench-project-group");
    group.dataset.projectId = row.projectId;
    const header = createElement("button", "workbench-project-header");
    header.type = "button";
    header.title = `Open ${row.displayName}`;
    header.disabled = Boolean(view.opening);
    const name = createElement("span", "workbench-project-name", row.displayName);
    const badges = createElement("span", "workbench-project-badges");
    badges.append(environmentChip(row));
    const needs = stateBadge(row.needsYouCount ? "needs_you" : "", row.needsYouCount);
    if (needs) badges.append(needs);
    if (row.runningCount) {
      const running = stateBadge("running");
      if (row.runningCount > 1) running.textContent = `running · ${row.runningCount}`;
      badges.append(running);
    }
    header.append(name, badges);
    header.addEventListener("click", () => open(row.projectId));
    group.append(header);
    const threads = createElement("div", "workbench-project-threads");
    for (const thread of row.threads) {
      const button = createElement("button", `workbench-thread-row${thread.state !== "idle" ? ` ${thread.state.replace("_", "-")}` : ""}`);
      button.type = "button";
      button.dataset.threadId = thread.threadId;
      button.dataset.state = thread.state;
      button.disabled = Boolean(view.opening);
      button.title = thread.title;
      const title = createElement("span", "workbench-thread-title", thread.title);
      const meta = createElement("span", "workbench-thread-meta");
      const badge = stateBadge(thread.state, thread.needsYouCount);
      if (badge) meta.append(badge);
      else meta.append(createElement("span", "workbench-thread-time", timeLabel(thread.updatedAt)));
      button.append(title, meta);
      button.addEventListener("click", () => open(row.projectId, thread.threadId));
      threads.append(button);
    }
    if (!row.threads.length) threads.append(createElement("span", "workbench-thread-empty", "No threads yet."));
    if (row.moreThreadCount) threads.append(createElement("span", "workbench-thread-empty", `${row.moreThreadCount} older in the project`));
    group.append(threads);
    return group;
  }

  function render() {
    const rows = (view.overview?.projects || []).filter((row) => !row.selected);
    section.hidden = rows.length === 0;
    list.replaceChildren();
    for (const row of rows) list.append(projectGroup(row));
    if (view.error) list.append(createElement("p", "workbench-overview-error", errorLabel(view.error)));
  }

  // The project in front keeps its own rail (codex-surface.js); it asks here
  // which of its threads wait for the owner, which only main sees across
  // surfaces, and redraws on the event below.
  let waiting = new Map();
  window.DirectWorkbenchOverview = Object.freeze({
    needsYouCount: (threadId) => waiting.get(String(threadId || "")) || 0,
  });

  // Only a real change redraws: overviews arrive every few seconds while
  // work runs, and redrawing would move the rows under the pointer.
  let signature = "";
  function apply(overview) {
    if (overview?.schema !== "direct_workbench_thread_overview@1") return;
    view.overview = overview;
    const current = (overview.projects || []).find((row) => row.selected);
    const nextWaiting = new Map((current?.threads || []).filter((thread) => thread.state === "needs_you").map((thread) => [thread.threadId, thread.needsYouCount]));
    const waitingChanged = JSON.stringify([...nextWaiting]) !== JSON.stringify([...waiting]);
    waiting = nextWaiting;
    const nextSignature = JSON.stringify(overview.projects);
    if (nextSignature !== signature) {
      signature = nextSignature;
      render();
    }
    if (waitingChanged) window.dispatchEvent?.(new CustomEvent("direct-workbench-overview-changed"));
  }

  async function refresh() {
    try {
      apply(await bridge.readDirectWorkbenchThreadOverview());
    } catch {
      // The sidebar keeps the last overview; the next event refreshes it.
    }
  }

  bridge.onDirectWorkbenchThreadOverviewEvent?.(apply);
  refresh();
})();
