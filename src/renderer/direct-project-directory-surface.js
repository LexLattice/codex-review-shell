(() => {
  "use strict";

  const bridge = window.codexSurfaceBridge;
  const shell = document.getElementById("codexShell");
  const projectSwitcher = document.getElementById("t3ProjectSwitcher");
  const utilityProjectButton = document.querySelector('.t3-utility-rail [data-t3-action="projects"]');
  const directoryPanel = document.getElementById("directProjectDirectory");
  const directoryClose = document.getElementById("directProjectDirectoryClose");
  const directoryRefresh = document.getElementById("directProjectDirectoryRefresh");
  const archivedToggle = document.getElementById("directProjectArchivedToggle");
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
  const editorDefaultModel = document.getElementById("directProjectBindingDefaultModel");
  const editorDelegationAccess = document.getElementById("directProjectBindingDelegationAccess");
  const editorDelegationSubfolders = document.getElementById("directProjectBindingDelegationSubfolders");
  const editorDelegationOrigin = document.getElementById("directProjectBindingDelegationOrigin");
  const editorEvidence = document.getElementById("directProjectBindingEvidence");
  const editorCommit = document.getElementById("directProjectBindingCommit");
  const lifecyclePanel = document.getElementById("directProjectLifecyclePanel");
  const lifecycleClose = document.getElementById("directProjectLifecycleClose");
  const lifecycleTitle = document.getElementById("directProjectLifecycleTitle");
  const lifecycleMeta = document.getElementById("directProjectLifecycleMeta");
  const lifecycleStatus = document.getElementById("directProjectLifecycleStatus");
  const lifecycleState = document.getElementById("directProjectLifecycleState");
  const lifecycleTarget = document.getElementById("directProjectLifecycleTarget");
  const lifecycleEvidence = document.getElementById("directProjectLifecycleEvidence");
  const lifecycleArchive = document.getElementById("directProjectLifecycleArchive");
  const lifecycleRestore = document.getElementById("directProjectLifecycleRestore");
  const lifecycleConfirmationLabel = document.getElementById("directProjectLifecycleConfirmationLabel");
  const lifecycleConfirmation = document.getElementById("directProjectLifecycleConfirmation");
  const lifecycleDelete = document.getElementById("directProjectLifecycleDelete");
  const editorEnvironmentField = document.getElementById("directProjectBindingEnvironmentField");
  const editorEnvironment = document.getElementById("directProjectBindingEnvironment");
  const editorEnvironmentNote = document.getElementById("directProjectBindingEnvironmentNote");
  const editorEnvironmentChange = document.getElementById("directProjectBindingEnvironmentChange");
  const editorWorkspaceKindField = document.getElementById("directProjectBindingWorkspaceKindField");
  const editorWslDistroField = document.getElementById("directProjectBindingWslDistroField");
  const browseButtons = Array.from(document.querySelectorAll("[data-direct-folder-browse]"));
  const folderBrowser = document.getElementById("directProjectFolderBrowser");
  const folderBrowserPath = document.getElementById("directProjectFolderBrowserPath");
  const folderBrowserStatus = document.getElementById("directProjectFolderBrowserStatus");
  const folderBrowserList = document.getElementById("directProjectFolderBrowserList");
  const folderBrowserUp = document.getElementById("directProjectFolderBrowserUp");
  const folderBrowserHome = document.getElementById("directProjectFolderBrowserHome");
  const folderBrowserDrives = document.getElementById("directProjectFolderBrowserDrives");
  const folderBrowserUse = document.getElementById("directProjectFolderBrowserUse");
  const folderBrowserCancel = document.getElementById("directProjectFolderBrowserCancel");
  const environmentModel = window.DirectEnvironmentUxModel || null;
  const canListEnvironments = Boolean(environmentModel) && typeof bridge?.listDirectWorkbenchEnvironments === "function";
  const canBrowseFolders = Boolean(environmentModel) && typeof bridge?.browseDirectWorkbenchEnvironmentFolder === "function";

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
    showArchived: false,
    lifecycleDraft: null,
    lifecycleLoading: false,
    lifecycleWorking: false,
    lifecycleError: "",
    lifecycleDraftRequestId: 0,
    environments: null,
    environmentsError: "",
    environmentOptions: [],
    browser: null,
    browserRequestId: 0,
    requestedEditorMode: "create",
    editorSession: 0,
    originalWorkspace: null,
    environmentAdopted: false,
    autoName: "",
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
      project_activation_in_progress: "Another project is opening.",
      project_substrate_unknown: "This project has no environment set. Edit it to choose one.",
      project_runtime_unconfigured: "This project has no agent runtime set. Edit it to choose one.",
      project_activation_source_stale: "The current project changed; refresh the list.",
      project_catalog_revision_stale: "Projects changed; refresh the list and try again.",
      project_activation_target_unknown: "That project no longer exists.",
      client_activation_id_reused: "That request was already sent; try again.",
      client_mutation_id_required: "Saving failed; try again.",
      client_mutation_id_reused: "That save was already sent; try again.",
      project_binding_source_stale: "The current project changed; close and reopen this form.",
      project_binding_target_unknown: "That project no longer exists.",
      project_binding_revision_stale: "This project changed while the form was open; close and reopen it.",
      project_binding_mutation_in_progress: "Another project is being saved.",
      project_binding_name_required: "Give the project a name.",
      project_binding_workspace_kind_invalid: "Choose an environment.",
      project_binding_wsl_path_invalid: "Choose a folder: a Linux path starting with /.",
      project_binding_windows_path_invalid: "Choose a folder: a Windows path like C:\\Work\\project.",
      project_binding_local_path_invalid: "Choose a folder: a full path on this machine.",
      project_binding_runtime_path_invalid: "Choose what the agent runs with.",
      project_binding_archived: "Restore this project before opening or editing it.",
      project_lifecycle_active_project_forbidden: "Open another project before archiving or deleting this one.",
      project_lifecycle_archive_state_invalid: "Only a project that isn't archived can be archived.",
      project_lifecycle_restore_state_invalid: "Only an archived project can be restored.",
      project_lifecycle_delete_state_invalid: "Archive a project before deleting it.",
      project_lifecycle_delete_confirmation_invalid: "Type the exact phrase to confirm deletion.",
      project_lifecycle_action_invalid: "Choose a supported lifecycle action.",
      client_lifecycle_id_required: "The lifecycle request has no stable identity; retry it.",
      client_lifecycle_id_reused: "This lifecycle request identity was already used for another transition.",
      project_lifecycle_mutation_failed: "Main could not complete the project lifecycle transition.",
    };
    return labels[code] || String(code || "Project activation is unavailable.").replaceAll("_", " ");
  }

  function transitionState() {
    return view.directory?.transition?.state || "idle";
  }

  function renderStatus() {
    const transition = view.directory?.transition || {};
    let state = "ready";
    let text = "";
    if (view.loading && !view.directory) {
      state = "loading";
      text = "Loading projects…";
    } else if (view.error) {
      state = "failed";
      text = blockerLabel(view.error);
    } else if (view.working || transition.state === "activating") {
      state = "activating";
      const target = (view.directory?.projects || []).find((row) =>
        row.projectId === (view.localTargetProjectId || transition.targetProjectId));
      text = `Opening ${target?.displayName || "project"}…`;
    } else if (transition.state === "failed") {
      state = "failed";
      text = blockerLabel(transition.reason || "project_activation_failed");
    }
    directoryStatus.dataset.state = state;
    directoryStatus.textContent = text;
    directoryStatus.hidden = !text;
  }

  // What a project's threads run with, in the editor's words.
  function runtimeLabel(runtime = {}) {
    const runtimePath = runtime.runtimePath || "";
    if (runtimePath === "direct-implementation") return "Direct";
    if (runtimePath === "app-server") return "Codex app server";
    if (runtimePath === "direct-text") return "Direct · text only";
    return runtime.displayLabel || "Runtime not set";
  }

  function projectRow(row) {
    const container = createElement("article", "direct-project-row");
    container.dataset.projectId = row.projectId || "";
    container.dataset.state = row.state || "available";
    container.dataset.selectable = row.selectable ? "true" : "false";

    const copy = createElement("div", "direct-project-row-copy");
    const title = createElement("div", "direct-project-row-title");
    title.append(createElement("strong", "", row.displayName || "Unnamed project"));
    // Only states worth noticing get a chip; "available" is the norm.
    const stateText = row.selected ? "Current" : row.lifecycle?.state === "archived" ? "Archived" : row.state === "activating" ? "Opening" : "";
    if (stateText) title.append(createElement("span", "direct-project-state-chip", stateText));
    const badges = createElement("div", "direct-project-row-badges");
    if (environmentModel) {
      const badge = environmentModel.environmentBadge(row.substrate);
      const chip = createElement("span", "direct-environment-badge", badge.text);
      chip.dataset.environmentKind = badge.kind;
      chip.title = badge.title;
      badges.append(chip);
    }
    const runtimeChip = createElement("span", "direct-project-runtime-badge", runtimeLabel(row.runtime));
    runtimeChip.title = "What this project's threads run with";
    badges.append(runtimeChip);
    copy.append(title, badges);
    if (Array.isArray(row.blockerCodes) && row.blockerCodes.length) {
      copy.append(createElement("span", "direct-project-row-blocker", blockerLabel(row.blockerCodes[0])));
    }

    const actions = createElement("div", "direct-project-row-actions");
    const editAction = createElement("button", "", "Edit");
    editAction.type = "button";
    editAction.disabled = row.lifecycle?.state === "archived" || view.working || view.editorWorking ||
      view.lifecycleWorking || transitionState() === "activating";
    editAction.dataset.projectBindingTarget = row.projectId || "";
    editAction.addEventListener("click", () => openBindingEditor(row.projectId));
    const lifecycleAction = createElement("button", "", row.lifecycle?.state === "archived" ? "Restore…" : "Archive…");
    lifecycleAction.type = "button";
    lifecycleAction.title = row.lifecycle?.state === "archived" ? "Restore or delete this project" : "Archive this project (its folder is not touched)";
    lifecycleAction.disabled = view.working || view.editorWorking || view.lifecycleWorking ||
      transitionState() === "activating";
    lifecycleAction.dataset.projectLifecycleTarget = row.projectId || "";
    lifecycleAction.addEventListener("click", () => openLifecyclePanel(row.projectId));
    const action = createElement(
      "button",
      "",
      row.selected ? "Open" : row.state === "activating" ? "Opening…" : row.selectable ? "Open" : "Blocked",
    );
    action.type = "button";
    action.className = row.selected ? "" : "primary";
    action.title = row.selected ? "This is the current project" : "Switch to this project";
    action.disabled = row.selected || !row.selectable || view.working || transitionState() === "activating";
    action.dataset.projectActivationTarget = row.projectId || "";
    action.addEventListener("click", () => activateProject(row));
    actions.append(editAction, lifecycleAction, action);
    container.append(copy, actions);
    return container;
  }

  function syncWorkspaceFields() {
    const kind = editorWorkspaceKind?.value || "local";
    if (editorWslFields) editorWslFields.hidden = kind !== "wsl";
    if (editorWindowsFields) editorWindowsFields.hidden = kind !== "windows";
    if (editorLocalFields) editorLocalFields.hidden = kind !== "local";
  }

  // The picker replaces the raw kind select and distro field when the host
  // can list its environments; otherwise the typed fields stay as before.
  function renderEnvironmentPicker() {
    const picker = Boolean(view.environments) && view.environmentOptions.length > 0;
    if (editorEnvironmentField) editorEnvironmentField.hidden = !picker;
    if (editorWorkspaceKindField) editorWorkspaceKindField.hidden = picker;
    if (editorWslDistroField) editorWslDistroField.hidden = picker;
    for (const button of browseButtons) button.hidden = !canBrowseFolders || !picker;
    if (editorEnvironmentNote) {
      editorEnvironmentNote.hidden = !view.environmentsError;
      editorEnvironmentNote.textContent = view.environmentsError
        ? "This machine's environments couldn't be listed, so type the environment and path."
        : "";
    }
    if (!picker || !editorEnvironment) return;
    editorEnvironment.replaceChildren();
    for (const option of view.environmentOptions) {
      const node = document.createElement("option");
      node.value = option.value;
      node.textContent = option.disabled ? `${option.label} (unavailable)` : option.label;
      node.disabled = option.disabled;
      editorEnvironment.append(node);
    }
    editorEnvironment.value = environmentModel.environmentIdForWorkspace({
      kind: editorWorkspaceKind.value,
      distro: editorWslDistro.value.trim(),
    });
  }

  function refreshEnvironmentOptions() {
    view.environmentOptions = view.environments
      ? environmentModel.environmentOptions(view.environments.environments, {
          kind: editorWorkspaceKind.value,
          distro: editorWslDistro.value.trim(),
        })
      : [];
    renderEnvironmentPicker();
    adoptHostEnvironmentForNewProject();
  }

  // A new project's draft may start in an environment this machine doesn't
  // have (the app's own default); start it on this machine instead, with an
  // empty folder to choose.
  function adoptHostEnvironmentForNewProject() {
    if (view.environmentAdopted || view.bindingDraft?.mode === "edit" || !view.environmentOptions.length) return;
    view.environmentAdopted = true;
    const current = view.environmentOptions.find((entry) => entry.value === editorEnvironment?.value);
    if (current && !current.disabled && current.reason !== "not_discovered") return;
    const host = view.environmentOptions.find((entry) => !entry.disabled && entry.label.includes("(this machine)")) ||
      view.environmentOptions.find((entry) => !entry.disabled && entry.reason !== "not_discovered");
    if (!host) return;
    editorEnvironment.value = host.value;
    selectEnvironment();
    const input = pathInputForKind(host.kind);
    if (input) input.value = "";
    refreshEnvironmentOptions();
  }

  async function loadEnvironments() {
    if (!canListEnvironments) return;
    try {
      const result = await bridge.listDirectWorkbenchEnvironments();
      if (result?.schema !== "direct_workbench_environments@1") throw new Error("environments_invalid");
      view.environments = result;
      view.environmentsError = "";
    } catch (error) {
      view.environments = null;
      view.environmentsError = error?.code || error?.message || "environments_unavailable";
    }
  }

  function selectEnvironment() {
    const option = view.environmentOptions.find((entry) => entry.value === editorEnvironment.value);
    if (!option) return;
    editorWorkspaceKind.value = option.kind;
    editorWslDistro.value = option.distro;
    syncWorkspaceFields();
    syncEnvironmentChangeNote();
    closeFolderBrowser();
  }

  function pathInputForKind(kind) {
    if (kind === "wsl") return editorWslPath;
    if (kind === "windows") return editorWindowsPath;
    return editorLocalPath;
  }

  function closeFolderBrowser() {
    view.browserRequestId += 1;
    view.browser = null;
    if (folderBrowser) folderBrowser.hidden = true;
  }

  function renderFolderBrowser() {
    if (!folderBrowser) return;
    const browser = view.browser;
    folderBrowser.hidden = !browser;
    if (!browser) return;
    const listing = browser.view;
    folderBrowserPath.textContent = listing?.displayPath || "—";
    folderBrowserStatus.dataset.state = browser.loading ? "loading" : browser.error ? "failed" : "ready";
    folderBrowserStatus.textContent = browser.loading
      ? "Listing folders…"
      : browser.error
        ? `This folder can't be listed (${browser.error}).`
        : listing?.truncated
          ? "Showing the first folders only."
          : `Folders in ${browser.label}, listed by its own executor.`;
    folderBrowserUp.disabled = browser.loading || !listing?.canUp;
    folderBrowserHome.disabled = browser.loading;
    folderBrowserDrives.hidden = !listing?.showDrives;
    folderBrowserUse.disabled = browser.loading || !listing?.canChoose;
    folderBrowserList.replaceChildren();
    for (const entry of listing?.entries || []) {
      const row = createElement("button", "direct-folder-browser-row", entry.name);
      row.type = "button";
      row.dataset.hidden = entry.hidden ? "true" : "false";
      row.title = entry.path;
      row.addEventListener("click", () => navigateFolderBrowser(entry.path));
      folderBrowserList.append(row);
    }
    if (listing && !listing.entries.length && !browser.loading) {
      folderBrowserList.append(createElement("p", "direct-folder-browser-empty", "No folders here."));
    }
  }

  async function navigateFolderBrowser(targetPath, options = {}) {
    if (!view.browser) return;
    const requestId = ++view.browserRequestId;
    view.browser.loading = true;
    view.browser.error = "";
    renderFolderBrowser();
    try {
      const listing = await bridge.browseDirectWorkbenchEnvironmentFolder({
        environmentId: view.browser.environmentId,
        path: targetPath,
      });
      if (requestId !== view.browserRequestId || !view.browser) return;
      view.browser.view = environmentModel.folderBrowserView(listing);
    } catch (error) {
      if (requestId !== view.browserRequestId || !view.browser) return;
      // A typed path that no longer exists falls back to home.
      if (options.fallbackHome && targetPath) {
        view.browser.loading = false;
        await navigateFolderBrowser("", {});
        return;
      }
      view.browser.error = error?.code || error?.message || "folder_unavailable";
    }
    if (requestId !== view.browserRequestId || !view.browser) return;
    view.browser.loading = false;
    renderFolderBrowser();
  }

  function openFolderBrowser(kind) {
    if (!canBrowseFolders) return;
    const option = view.environmentOptions.find((entry) => entry.value === editorEnvironment?.value);
    view.browser = {
      kind,
      environmentId: option?.value || environmentModel.environmentIdForWorkspace({ kind, distro: editorWslDistro.value.trim() }),
      label: option?.label || kind,
      view: null,
      loading: false,
      error: "",
    };
    navigateFolderBrowser(pathInputForKind(kind)?.value.trim() || "", { fallbackHome: true });
  }

  function useBrowsedFolder() {
    const chosen = view.browser?.view?.path;
    if (!chosen) return;
    setFolder(pathInputForKind(view.browser.kind), chosen);
    closeFolderBrowser();
  }

  function closeBindingEditor() {
    if (view.editorWorking) return;
    closeFolderBrowser();
    if (editorPanel) editorPanel.hidden = true;
    shell?.removeAttribute("data-t3-project-editor-open");
    view.bindingDraft = null;
    view.editorLoading = false;
    view.editorError = "";
  }

  function closeLifecyclePanel() {
    if (view.lifecycleWorking) return;
    view.lifecycleDraftRequestId += 1;
    if (lifecyclePanel) lifecyclePanel.hidden = true;
    shell?.removeAttribute("data-t3-project-lifecycle-open");
    view.lifecycleDraft = null;
    view.lifecycleLoading = false;
    view.lifecycleError = "";
    if (lifecycleConfirmation) lifecycleConfirmation.value = "";
  }

  function renderLifecyclePanel() {
    if (!lifecyclePanel) return;
    const draft = view.lifecycleDraft;
    const target = draft?.target || {};
    const requiredConfirmation = draft?.actions?.delete?.requiredConfirmation || "DELETE project";
    lifecycleTitle.textContent = target.displayName ? `Archive or delete ${target.displayName}` : "Archive or delete";
    if (lifecycleMeta) lifecycleMeta.hidden = true;
    lifecycleState.textContent = target.lifecycleState === "archived" ? "Archived" : target.lifecycleState ? "In use" : "";
    lifecycleTarget.textContent = target.displayName || "";
    lifecycleEvidence.textContent = "";
    lifecycleConfirmationLabel.textContent = requiredConfirmation;

    let state = "ready";
    let text = "";
    if (view.lifecycleLoading) {
      state = "loading";
      text = "Loading…";
    } else if (view.lifecycleError) {
      state = "failed";
      text = blockerLabel(view.lifecycleError);
    } else if (view.lifecycleWorking) {
      state = "saving";
      text = "Working…";
    } else if (target.selected) {
      text = "This is the current project. Switch away before archiving or deleting it.";
    }
    lifecycleStatus.hidden = !text;
    lifecycleStatus.dataset.state = state;
    lifecycleStatus.textContent = text;

    const disabled = view.lifecycleLoading || view.lifecycleWorking || !draft;
    lifecycleArchive.disabled = disabled || draft?.actions?.archive?.eligible !== true;
    lifecycleRestore.disabled = disabled || draft?.actions?.restore?.eligible !== true;
    lifecycleConfirmation.disabled = disabled || draft?.actions?.delete?.eligible !== true;
    lifecycleDelete.disabled = disabled || draft?.actions?.delete?.eligible !== true ||
      lifecycleConfirmation.value !== requiredConfirmation;
    lifecycleClose.disabled = view.lifecycleWorking;
  }

  async function openLifecyclePanel(projectId) {
    if (!lifecyclePanel || typeof bridge?.readDirectWorkbenchProjectLifecycleDraft !== "function") return;
    const requestId = view.lifecycleDraftRequestId + 1;
    view.lifecycleDraftRequestId = requestId;
    document.getElementById("runtimeDrawerClose")?.click();
    document.getElementById("threadAnalyticsPanelClose")?.click();
    const intake = document.getElementById("directThreadIntakePanel");
    if (intake) intake.hidden = true;
    closeBindingEditor();
    lifecyclePanel.hidden = false;
    shell?.setAttribute("data-t3-project-lifecycle-open", "true");
    view.lifecycleDraft = null;
    view.lifecycleLoading = true;
    view.lifecycleWorking = false;
    view.lifecycleError = "";
    lifecycleConfirmation.value = "";
    renderLifecyclePanel();
    try {
      const draft = await bridge.readDirectWorkbenchProjectLifecycleDraft({ projectId });
      if (requestId !== view.lifecycleDraftRequestId || lifecyclePanel.hidden) return;
      if (draft?.schema !== "direct_workbench_project_lifecycle_draft@1") {
        throw new Error("project_lifecycle_draft_invalid");
      }
      view.lifecycleDraft = draft;
    } catch (error) {
      if (requestId !== view.lifecycleDraftRequestId || lifecyclePanel.hidden) return;
      view.lifecycleError = error?.code || error?.message || "project_lifecycle_draft_unavailable";
    } finally {
      if (requestId !== view.lifecycleDraftRequestId || lifecyclePanel.hidden) return;
      view.lifecycleLoading = false;
      renderLifecyclePanel();
    }
  }

  async function submitLifecycleAction(action) {
    const draft = view.lifecycleDraft;
    if (!draft || view.lifecycleWorking || typeof bridge?.mutateDirectWorkbenchProjectLifecycle !== "function") return;
    view.lifecycleWorking = true;
    view.lifecycleError = "";
    renderLifecyclePanel();
    try {
      const receipt = await bridge.mutateDirectWorkbenchProjectLifecycle({
        clientLifecycleId: globalThis.crypto?.randomUUID?.() || `project_lifecycle_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        action,
        sourceProjectId: draft.sourceProjectId,
        projectId: draft.projectId,
        expectedCatalogRevision: draft.expectedCatalogRevision,
        expectedProjectRevision: draft.expectedProjectRevision,
        confirmation: action === "delete" ? lifecycleConfirmation.value : "",
      });
      if (!receipt?.ok || !["accepted", "completed"].includes(receipt.status)) {
        throw Object.assign(new Error(receipt?.reason || "project_lifecycle_mutation_failed"), { code: receipt?.reason });
      }
    } catch (error) {
      view.lifecycleWorking = false;
      view.lifecycleError = error?.code || error?.message || "project_lifecycle_mutation_failed";
      renderLifecyclePanel();
    }
  }

  function renderBindingEditor() {
    if (!editorPanel) return;
    const draft = view.bindingDraft;
    const mode = draft?.mode || view.requestedEditorMode || "create";
    editorTitle.textContent = mode === "edit" ? "Edit project" : "New project";
    if (editorMeta) editorMeta.hidden = true;
    let state = "ready";
    let text = mode === "create"
      ? "Choose the environment and folder. Threads in this project run there."
      : "";
    if (view.editorLoading) {
      state = "loading";
      text = "Loading…";
    } else if (view.editorError) {
      state = "failed";
      text = blockerLabel(view.editorError);
    } else if (view.editorWorking) {
      state = "saving";
      text = mode === "create" ? "Creating the project…" : "Saving…";
    }
    editorStatus.dataset.state = state;
    editorStatus.textContent = text;
    editorStatus.hidden = !text;
    const activeEdit = draft?.evidence?.activeProjectEditRebindsRuntime === true;
    if (editorEvidence) {
      editorEvidence.hidden = !activeEdit;
      editorEvidence.textContent = activeEdit
        ? "This is the current project: saving restarts its agent, so finish any running turn first."
        : "";
    }
    for (const control of editorForm?.querySelectorAll("input, select, button") || []) {
      control.disabled = view.editorLoading || view.editorWorking;
    }
    if (editorClose) editorClose.disabled = view.editorWorking;
    if (editorCommit) editorCommit.textContent = view.editorWorking ? (mode === "create" ? "Creating…" : "Saving…") : mode === "edit" ? "Save" : "Create project";
    renderFolderBrowser();
  }

  function fillBindingEditor(draft) {
    const fields = draft?.fields || {};
    const workspace = fields.workspace || {};
    const creating = draft?.mode !== "edit";
    // A new project is named after its folder unless the owner types a name.
    editorName.value = creating && fields.displayName === "New project" ? "" : fields.displayName || "";
    view.originalWorkspace = { kind: workspace.kind || "local", distro: workspace.distro || "", label: workspace.label || "" };
    view.environmentAdopted = false;
    editorWorkspaceKind.value = workspace.kind || "local";
    editorWorkspaceLabel.value = workspace.label || "";
    editorWslDistro.value = workspace.distro || "";
    editorWslPath.value = workspace.linuxPath || "";
    editorWindowsPath.value = workspace.windowsPath || "";
    editorLocalPath.value = workspace.localPath || "";
    editorRuntimePath.value = fields.runtimePath || "direct-implementation";
    fillDefaultModelOptions(fields.defaultModel || "");
    if (editorDelegationAccess) editorDelegationAccess.value = fields.delegationAccess || "";
    if (editorDelegationSubfolders) editorDelegationSubfolders.checked = fields.delegationSubfolders === true;
    if (editorDelegationOrigin) {
      editorDelegationOrigin.hidden = fields.createdByDelegation !== true;
      editorDelegationOrigin.textContent = "Created by delegation: an agent in another project delegated work to this folder.";
    }
    syncDelegationFields();
    syncWorkspaceFields();
    if (environmentModel) refreshEnvironmentOptions();
    syncEnvironmentChangeNote();
  }

  function environmentText(kind, distro) {
    if (kind === "wsl") return distro ? `WSL · ${distro}` : "WSL";
    return kind === "windows" ? "Windows" : "this machine";
  }

  // Editing a project into another environment leaves its existing threads
  // behind; say so instead of letting it happen silently.
  function syncEnvironmentChangeNote() {
    if (!editorEnvironmentChange) return;
    const original = view.originalWorkspace;
    const editing = view.bindingDraft?.mode === "edit" && original;
    const kind = editorWorkspaceKind.value;
    const distro = editorWslDistro.value.trim();
    const changed = editing && (kind !== original.kind || (kind === "wsl" && distro && original.distro && distro.toLowerCase() !== original.distro.toLowerCase()));
    editorEnvironmentChange.hidden = !changed;
    editorEnvironmentChange.textContent = changed
      ? `This project's existing threads were started in ${environmentText(original.kind, original.distro)}. To work in ${environmentText(kind, distro)}, a new project is usually better.`
      : "";
  }

  // A project's label follows its environment; a custom label survives
  // only while the environment stays the same.
  function workspaceLabelForSubmit(kind, distro) {
    const original = view.originalWorkspace;
    if (view.bindingDraft?.mode !== "edit" || !original) return "";
    const same = kind === original.kind && (kind !== "wsl" || (distro || "").toLowerCase() === (original.distro || "").toLowerCase());
    return same ? original.label : "";
  }

  function nameFromPath(value) {
    return String(value || "").split(/[\\/]/).filter(Boolean).pop() || "";
  }

  function nameFollowsFolder() {
    const name = editorName.value.trim();
    return view.bindingDraft?.mode !== "edit" && (!name || name === view.autoName);
  }

  function setFolder(input, value) {
    if (!input) return;
    input.value = value;
    if (nameFollowsFolder()) {
      view.autoName = nameFromPath(value);
      editorName.value = view.autoName;
    }
  }

  // Subfolders only make sense while the project accepts delegated work.
  function syncDelegationFields() {
    if (!editorDelegationSubfolders) return;
    const accepting = Boolean(editorDelegationAccess?.value);
    if (!accepting) editorDelegationSubfolders.checked = false;
    const row = editorDelegationSubfolders.closest?.("label");
    if (row) row.hidden = !accepting;
  }
  editorDelegationAccess?.addEventListener("change", syncDelegationFields);

  // Choices come from the account's model list, the same list the composer
  // picker shows (codex-surface.js publishes it as DirectModelCatalog).
  function fillDefaultModelOptions(selected = "") {
    if (!editorDefaultModel) return;
    const catalog = globalThis.DirectModelCatalog;
    const models = typeof catalog?.pickerModels === "function" ? catalog.pickerModels() : [];
    const recommended = typeof catalog?.recommendedModel === "function" ? catalog.recommendedModel() : null;
    editorDefaultModel.innerHTML = "";
    const add = (value, label) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      editorDefaultModel.appendChild(option);
    };
    add("", recommended ? `Recommended (now ${recommended.displayName})` : "Recommended");
    for (const model of models) add(model.model, model.displayName);
    if (selected && !models.some((model) => model.model === selected)) {
      add(selected, models.length ? `${selected} · not offered, Recommended is used` : selected);
    }
    editorDefaultModel.value = selected;
  }

  async function openBindingEditor(projectId = "") {
    if (!editorPanel || typeof bridge?.readDirectWorkbenchProjectBindingDraft !== "function") return;
    document.getElementById("runtimeDrawerClose")?.click();
    document.getElementById("threadAnalyticsPanelClose")?.click();
    const intake = document.getElementById("directThreadIntakePanel");
    if (intake) intake.hidden = true;
    closeLifecyclePanel();
    editorPanel.hidden = false;
    shell?.setAttribute("data-t3-project-editor-open", "true");
    view.bindingDraft = null;
    view.requestedEditorMode = projectId ? "edit" : "create";
    view.editorLoading = true;
    view.editorWorking = false;
    view.editorError = "";
    closeFolderBrowser();
    renderBindingEditor();
    // Listing environments can take a moment (it asks WSL); the draft shows
    // at once and the picker fills in when the list arrives.
    const editorSession = ++view.editorSession;
    loadEnvironments().then(() => {
      if (editorSession === view.editorSession && view.bindingDraft && !editorPanel.hidden) refreshEnvironmentOptions();
    });
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
    const distro = editorWslDistro.value.trim();
    const label = workspaceLabelForSubmit(kind, distro);
    if (kind === "wsl") {
      return { kind, label, distro, linuxPath: editorWslPath.value.trim() };
    }
    if (kind === "windows") {
      return { kind, label, windowsPath: editorWindowsPath.value.trim() };
    }
    return { kind: "local", label, localPath: editorLocalPath.value.trim() };
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
          ...(editorDefaultModel ? { defaultModel: editorDefaultModel.value } : {}),
          ...(editorDelegationAccess
            ? { delegationAccess: editorDelegationAccess.value, delegationSubfolders: editorDelegationSubfolders?.checked === true }
            : {}),
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
    const visibleRows = view.showArchived
      ? rows
      : rows.filter((row) => row.lifecycle?.state !== "archived");
    const activeCount = view.directory?.activeProjectCount || 0;
    const archivedCount = view.directory?.archivedProjectCount || 0;
    directoryCount.textContent = view.directory
      ? `${activeCount} ${activeCount === 1 ? "project" : "projects"}`
      : view.loading ? "Loading…" : "Unavailable";
    directoryRefresh.disabled = view.loading || view.working;
    if (bindingNew) bindingNew.disabled = view.loading || view.working || view.editorWorking;
    if (archivedToggle) {
      archivedToggle.hidden = !archivedCount && !view.showArchived;
      archivedToggle.textContent = view.showArchived ? "Hide archived" : `Show archived (${archivedCount})`;
      archivedToggle.disabled = view.loading || view.working || (!archivedCount && !view.showArchived);
      archivedToggle.setAttribute("aria-pressed", view.showArchived ? "true" : "false");
    }
    directoryList.replaceChildren();
    if (!visibleRows.length) {
      directoryList.append(createElement(
        "p",
        "direct-project-directory-status",
        view.loading
          ? "Loading projects…"
          : rows.length
            ? "Only archived projects. Show them below."
            : "No projects yet. Create one with New project.",
      ));
    } else {
      for (const row of visibleRows) directoryList.append(projectRow(row));
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
      // The main process now owns the transition: it brings the project's
      // own surface to the front, and this one stays open behind it.
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
  archivedToggle?.addEventListener("click", () => {
    view.showArchived = !view.showArchived;
    render();
  });
  bindingNew?.addEventListener("click", () => openBindingEditor());
  editorWorkspaceKind?.addEventListener("change", () => {
    syncWorkspaceFields();
    syncEnvironmentChangeNote();
  });
  editorWslDistro?.addEventListener("input", syncEnvironmentChangeNote);
  for (const input of [editorWslPath, editorWindowsPath, editorLocalPath]) {
    input?.addEventListener("change", () => setFolder(input, input.value.trim()));
  }
  editorEnvironment?.addEventListener("change", selectEnvironment);
  for (const button of browseButtons) {
    button.addEventListener("click", () => openFolderBrowser(button.dataset.directFolderBrowse || "local"));
  }
  folderBrowserUp?.addEventListener("click", () => navigateFolderBrowser(view.browser?.view?.upTarget || ""));
  folderBrowserHome?.addEventListener("click", () => navigateFolderBrowser(""));
  folderBrowserDrives?.addEventListener("click", () => navigateFolderBrowser("drives"));
  folderBrowserUse?.addEventListener("click", useBrowsedFolder);
  folderBrowserCancel?.addEventListener("click", closeFolderBrowser);
  editorClose?.addEventListener("click", closeBindingEditor);
  editorCancel?.addEventListener("click", closeBindingEditor);
  editorForm?.addEventListener("submit", submitBindingEditor);
  lifecycleClose?.addEventListener("click", closeLifecyclePanel);
  lifecycleArchive?.addEventListener("click", () => submitLifecycleAction("archive"));
  lifecycleRestore?.addEventListener("click", () => submitLifecycleAction("restore"));
  lifecycleDelete?.addEventListener("click", () => submitLifecycleAction("delete"));
  lifecycleConfirmation?.addEventListener("input", renderLifecyclePanel);

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
    if (event?.lifecycleReceipt) {
      view.lifecycleWorking = false;
      if (event.lifecycleReceipt.ok) {
        closeLifecyclePanel();
        view.error = "";
      } else {
        view.lifecycleError = event.lifecycleReceipt.reason || "project_lifecycle_mutation_failed";
        renderLifecyclePanel();
      }
      render();
      return;
    }
    view.working = false;
    view.localTargetProjectId = "";
    view.error = event?.receipt?.ok === false ? event.receipt.reason || "project_activation_failed" : "";
    // The other project's surface is in front now; this one stays open
    // behind it (its turns keep running), with the directory closed.
    if (event?.receipt?.ok && event.receipt.status === "completed" && projectDirectoryOpen()) setProjectDirectoryOpen(false);
    render();
  });

  // The sidebar's project menu and "New project" open these panels.
  window.DirectProjectDirectory = Object.freeze({
    createProject: () => openBindingEditor(),
    editProject: (projectId) => openBindingEditor(projectId),
    openLifecycle: (projectId) => openLifecyclePanel(projectId),
  });

  render();
  renderBindingEditor();
  renderLifecyclePanel();
  refreshDirectory().catch(() => {});
})();
