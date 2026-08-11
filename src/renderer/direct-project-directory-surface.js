(() => {
  "use strict";

  const bridge = window.codexSurfaceBridge;
  const shell = document.getElementById("codexShell");
  const projectSwitcher = document.getElementById("t3ProjectSwitcher");
  const utilityProjectButton = document.querySelector('.t3-utility-rail [data-t3-action="projects"]');
  const directoryPanel = document.getElementById("directProjectDirectory");
  const directoryClose = document.getElementById("directProjectDirectoryClose");
  const directoryRefresh = document.getElementById("directProjectDirectoryRefresh");
  const bindingNew = document.getElementById("directProjectBindingNew");
  const directoryCount = document.getElementById("directProjectDirectoryCount");
  const directoryStatus = document.getElementById("directProjectDirectoryStatus");
  const directoryList = document.getElementById("directProjectDirectoryList");
  const editorPanel = document.getElementById("directProjectBindingEditor");
  const editorClose = document.getElementById("directProjectBindingEditorClose");
  const editorCancel = document.getElementById("directProjectBindingCancel");
  const editorForm = document.getElementById("directProjectBindingForm");
  const editorTitle = document.getElementById("directProjectBindingEditorTitle");
  const editorMeta = document.getElementById("directProjectBindingEditorMeta");
  const editorStatus = document.getElementById("directProjectBindingStatus");
  const editorIdentityWitness = document.getElementById("directProjectBindingIdentityWitness");
  const editorName = document.getElementById("directProjectBindingName");
  const editorWorkspaceKind = document.getElementById("directProjectBindingWorkspaceKind");
  const editorWorkspaceLabel = document.getElementById("directProjectBindingWorkspaceLabel");
  const editorWslFields = document.getElementById("directProjectBindingWslFields");
  const editorWslDistro = document.getElementById("directProjectBindingWslDistro");
  const editorWslPath = document.getElementById("directProjectBindingWslPath");
  const editorWindowsFields = document.getElementById("directProjectBindingWindowsFields");
  const editorWindowsPath = document.getElementById("directProjectBindingWindowsPath");
  const editorLocalFields = document.getElementById("directProjectBindingLocalFields");
  const editorLocalPath = document.getElementById("directProjectBindingLocalPath");
  const editorRuntimePath = document.getElementById("directProjectBindingRuntimePath");
  const editorEvidence = document.getElementById("directProjectBindingEvidence");
  const editorCommit = document.getElementById("directProjectBindingCommit");

  if (!directoryPanel || typeof bridge?.readDirectWorkbenchProjectDirectory !== "function") return;

  const view = {
    directory: null,
    loading: false,
    working: false,
    error: "",
    localTargetProjectId: "",
    bindingDraft: null,
    editorLoading: false,
    editorWorking: false,
    editorError: "",
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
      client_mutation_id_required: "The save request has no stable identity; retry it.",
      client_mutation_id_reused: "This save request identity was already used for another binding.",
      project_binding_source_stale: "The active project changed; reopen the binding draft.",
      project_binding_target_unknown: "The project binding no longer exists.",
      project_binding_revision_stale: "This binding changed after the draft opened; reopen it before saving.",
      project_binding_mutation_in_progress: "Another project binding is currently being saved.",
      project_binding_name_required: "Give the project a name.",
      project_binding_workspace_kind_invalid: "Choose a supported workspace environment.",
      project_binding_wsl_path_invalid: "Use an absolute Linux path beginning with /.",
      project_binding_windows_path_invalid: "Use an absolute Windows drive or UNC path.",
      project_binding_local_path_invalid: "Use an absolute local path.",
      project_binding_runtime_path_invalid: "Choose a supported Direct runtime path.",
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

    const actions = createElement("div", "direct-project-row-actions");
    const editAction = createElement("button", "", "Edit");
    editAction.type = "button";
    editAction.disabled = view.working || view.editorWorking || transitionState() === "activating";
    editAction.dataset.projectBindingTarget = row.projectId || "";
    editAction.addEventListener("click", () => openBindingEditor(row.projectId));
    const action = createElement(
      "button",
      "",
      row.selected ? "Active" : row.state === "activating" ? "Switching" : row.selectable ? "Switch" : "Blocked",
    );
    action.type = "button";
    action.disabled = row.selected || !row.selectable || view.working || transitionState() === "activating";
    action.dataset.projectActivationTarget = row.projectId || "";
    action.addEventListener("click", () => activateProject(row));
    actions.append(editAction, action);
    container.append(copy, actions);
    return container;
  }

  function syncWorkspaceFields() {
    const kind = editorWorkspaceKind?.value || "local";
    if (editorWslFields) editorWslFields.hidden = kind !== "wsl";
    if (editorWindowsFields) editorWindowsFields.hidden = kind !== "windows";
    if (editorLocalFields) editorLocalFields.hidden = kind !== "local";
  }

  function closeBindingEditor() {
    if (view.editorWorking) return;
    if (editorPanel) editorPanel.hidden = true;
    shell?.removeAttribute("data-t3-project-editor-open");
    view.bindingDraft = null;
    view.editorLoading = false;
    view.editorError = "";
  }

  function renderBindingEditor() {
    if (!editorPanel) return;
    const draft = view.bindingDraft;
    const mode = draft?.mode || "create";
    editorTitle.textContent = mode === "edit" ? "Edit project binding" : "New project binding";
    editorMeta.textContent = draft
      ? `${mode} · catalog ${String(draft.expectedCatalogRevision || "unknown").slice(0, 10)}`
      : "Draft not loaded";
    editorIdentityWitness.textContent = mode === "create" ? "Main assigns new ID" : "Identity remains invariant";
    let state = "ready";
    let text = "Review the binding evidence, then ask main to persist it.";
    if (view.editorLoading) {
      state = "loading";
      text = "Loading a revision-bound project draft…";
    } else if (view.editorError) {
      state = "failed";
      text = blockerLabel(view.editorError);
    } else if (view.editorWorking) {
      state = "saving";
      text = "Main is revalidating and applying the project binding…";
    }
    editorStatus.dataset.state = state;
    editorStatus.textContent = text;
    editorEvidence.textContent = draft?.evidence?.activeProjectEditRebindsRuntime
      ? "This is the active project. Saving requires no active work and reloads its Direct runtime from the admitted binding."
      : mode === "create"
        ? "The draft is provisional. Main assigns project identity, revalidates the catalog revision, and leaves the current project active."
        : "The draft is provisional. Main revalidates the project revision and updates this inactive binding without disturbing the active thread.";
    for (const control of editorForm?.querySelectorAll("input, select, button") || []) {
      control.disabled = view.editorLoading || view.editorWorking;
    }
    if (editorClose) editorClose.disabled = view.editorWorking;
    if (editorCommit) editorCommit.textContent = view.editorWorking ? "Saving…" : mode === "edit" ? "Save binding" : "Create binding";
  }

  function fillBindingEditor(draft) {
    const fields = draft?.fields || {};
    const workspace = fields.workspace || {};
    editorName.value = fields.displayName || "";
    editorWorkspaceKind.value = workspace.kind || "local";
    editorWorkspaceLabel.value = workspace.label || "";
    editorWslDistro.value = workspace.distro || "";
    editorWslPath.value = workspace.linuxPath || "";
    editorWindowsPath.value = workspace.windowsPath || "";
    editorLocalPath.value = workspace.localPath || "";
    editorRuntimePath.value = fields.runtimePath || "app-server";
    syncWorkspaceFields();
  }

  async function openBindingEditor(projectId = "") {
    if (!editorPanel || typeof bridge?.readDirectWorkbenchProjectBindingDraft !== "function") return;
    document.getElementById("runtimeDrawerClose")?.click();
    document.getElementById("threadAnalyticsPanelClose")?.click();
    const intake = document.getElementById("directThreadIntakePanel");
    if (intake) intake.hidden = true;
    editorPanel.hidden = false;
    shell?.setAttribute("data-t3-project-editor-open", "true");
    view.bindingDraft = null;
    view.editorLoading = true;
    view.editorWorking = false;
    view.editorError = "";
    renderBindingEditor();
    try {
      const draft = await bridge.readDirectWorkbenchProjectBindingDraft(projectId ? { projectId } : {});
      if (draft?.schema !== "direct_workbench_project_binding_draft@1") throw new Error("project_binding_draft_invalid");
      view.bindingDraft = draft;
      fillBindingEditor(draft);
    } catch (error) {
      view.editorError = error?.code || error?.message || "project_binding_draft_unavailable";
    } finally {
      view.editorLoading = false;
      renderBindingEditor();
    }
  }

  function bindingWorkspaceFromForm() {
    const kind = editorWorkspaceKind.value;
    if (kind === "wsl") {
      return {
        kind,
        label: editorWorkspaceLabel.value.trim(),
        distro: editorWslDistro.value.trim(),
        linuxPath: editorWslPath.value.trim(),
      };
    }
    if (kind === "windows") {
      return {
        kind,
        label: editorWorkspaceLabel.value.trim(),
        windowsPath: editorWindowsPath.value.trim(),
      };
    }
    return {
      kind: "local",
      label: editorWorkspaceLabel.value.trim(),
      localPath: editorLocalPath.value.trim(),
    };
  }

  async function submitBindingEditor(event) {
    event.preventDefault();
    const draft = view.bindingDraft;
    if (!draft || view.editorLoading || view.editorWorking || typeof bridge?.mutateDirectWorkbenchProjectBinding !== "function") return;
    view.editorWorking = true;
    view.editorError = "";
    renderBindingEditor();
    try {
      const receipt = await bridge.mutateDirectWorkbenchProjectBinding({
        clientMutationId: globalThis.crypto?.randomUUID?.() || `project_binding_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        mode: draft.mode,
        sourceProjectId: draft.sourceProjectId,
        projectId: draft.projectId,
        expectedCatalogRevision: draft.expectedCatalogRevision,
        expectedProjectRevision: draft.expectedProjectRevision,
        fields: {
          displayName: editorName.value.trim(),
          workspace: bindingWorkspaceFromForm(),
          runtimePath: editorRuntimePath.value,
        },
      });
      if (!receipt?.ok || !["accepted", "completed"].includes(receipt.status)) {
        throw Object.assign(new Error(receipt?.reason || "project_binding_mutation_failed"), { code: receipt?.reason });
      }
    } catch (error) {
      view.editorWorking = false;
      view.editorError = error?.code || error?.message || "project_binding_mutation_failed";
      renderBindingEditor();
    }
  }

  function render() {
    const rows = Array.isArray(view.directory?.projects) ? view.directory.projects : [];
    directoryCount.textContent = view.directory
      ? `${rows.length} configured · ${view.directory.activeProjectId ? "1 active" : "none active"}`
      : view.loading ? "Loading…" : "Unavailable";
    directoryRefresh.disabled = view.loading || view.working;
    if (bindingNew) bindingNew.disabled = view.loading || view.working || view.editorWorking;
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
  bindingNew?.addEventListener("click", () => openBindingEditor());
  editorWorkspaceKind?.addEventListener("change", syncWorkspaceFields);
  editorClose?.addEventListener("click", closeBindingEditor);
  editorCancel?.addEventListener("click", closeBindingEditor);
  editorForm?.addEventListener("submit", submitBindingEditor);

  bridge.onDirectWorkbenchProjectDirectoryEvent?.((event) => {
    if (event?.directory) view.directory = event.directory;
    if (event?.bindingReceipt) {
      view.editorWorking = false;
      if (event.bindingReceipt.ok) {
        closeBindingEditor();
        view.error = "";
      } else {
        view.editorError = event.bindingReceipt.reason || "project_binding_mutation_failed";
        renderBindingEditor();
      }
      render();
      return;
    }
    view.working = false;
    view.localTargetProjectId = "";
    view.error = event?.receipt?.ok === false ? event.receipt.reason || "project_activation_failed" : "";
    render();
  });

  render();
  renderBindingEditor();
  refreshDirectory().catch(() => {});
})();
