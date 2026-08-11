(() => {
  "use strict";

  const shell = document.getElementById("codexShell");
  const panel = document.getElementById("directThreadIntakePanel");
  const closeButton = document.getElementById("directThreadIntakeClose");
  const statusNode = document.getElementById("directThreadIntakeStatus");
  const bindingNode = document.getElementById("directThreadIntakeBinding");
  const chooseFileButton = document.getElementById("directThreadIntakeChooseFile");
  const chooseRootButton = document.getElementById("directThreadIntakeChooseRoot");
  const refreshButton = document.getElementById("directThreadIntakeRefresh");
  const workspaceConfirm = document.getElementById("directThreadIntakeWorkspaceConfirm");
  const countNode = document.getElementById("directThreadIntakeCount");
  const sourcesNode = document.getElementById("directThreadIntakeSources");
  const evidenceNode = document.getElementById("directThreadIntakeEvidence");
  const modesNode = document.getElementById("directThreadIntakeModes");
  const utilityButton = document.querySelector('.t3-utility-rail [data-t3-action="intake"]');
  const runtimeDrawer = document.getElementById("runtimeDrawer");
  const runtimeDrawerClose = document.getElementById("runtimeDrawerClose");
  const analyticsPanel = document.getElementById("threadAnalyticsPanel");
  const analyticsClose = document.getElementById("threadAnalyticsPanelClose");

  if (!panel || !utilityButton) return;

  const intake = {
    loading: false,
    working: false,
    error: "",
    sources: [],
    imports: [],
    selectedHandleId: "",
    selectedImportId: "",
    workspaceConfirmationKey: "",
    projection: null,
    continuationIntent: "",
  };

  function el(tag, className = "", text = "") {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function selection() {
    if (intake.selectedImportId) return { importId: intake.selectedImportId };
    if (intake.selectedHandleId) return { handleId: intake.selectedHandleId };
    return {};
  }

  function selectionKey() {
    if (intake.selectedImportId) return `import:${intake.selectedImportId}`;
    if (intake.selectedHandleId) return `source:${intake.selectedHandleId}`;
    return "";
  }

  function workspaceConfirmedForSelection() {
    const key = selectionKey();
    return Boolean(key && workspaceConfirm?.checked === true && intake.workspaceConfirmationKey === key);
  }

  function resetWorkspaceConfirmation() {
    intake.workspaceConfirmationKey = "";
    if (workspaceConfirm) workspaceConfirm.checked = false;
  }

  function setSelection(kind, id) {
    const nextImportId = kind === "import" ? String(id || "") : "";
    const nextHandleId = kind === "source" ? String(id || "") : "";
    const changed = nextImportId !== intake.selectedImportId || nextHandleId !== intake.selectedHandleId;
    intake.selectedImportId = nextImportId;
    intake.selectedHandleId = nextHandleId;
    if (changed) resetWorkspaceConfirmation();
  }

  function blockerLabel(code) {
    const labels = {
      provider_thread_identity_missing: "No durable provider thread identity was found.",
      runtime_project_binding_unproven: "The active runtime is not proven to belong to this project.",
      app_server_runtime_required: "Switch the project runtime to App Server to resume the original provider thread.",
      provider_resume_capability_unavailable: "The active provider does not expose thread resume.",
      read_only_import_required: "Materialize this source as read-only evidence first.",
      checkpoint_validation_required: "The imported transcript has not passed checkpoint validation.",
      workspace_match_required: "Confirm and validate that the source belongs to this project workspace.",
      direct_runtime_required: "Switch the project runtime to Direct before creating a fresh Direct continuation.",
      direct_auth_required: "Direct authentication is required.",
      checkpoint_request_shape_unaccepted: "The Direct checkpoint request shape is not admitted.",
      checkpoint_promotion_scope_mismatch: "The active Direct provider scope differs from the promoted checkpoint-continuation evidence.",
      workspace_mismatch: "The imported workspace does not match the selected project.",
      live_text_unavailable: "The Direct live-text runtime is unavailable.",
      missing_import: "Select a materialized import.",
      active_turn_must_finish: "Finish the active turn before changing provider threads.",
    };
    return labels[code] || String(code || "Action unavailable").replace(/_/g, " ");
  }

  function syncOpenState() {
    const open = !panel.hidden;
    utilityButton.setAttribute("aria-pressed", open ? "true" : "false");
    shell?.toggleAttribute("data-t3-intake-open", open);
  }

  function renderBinding() {
    bindingNode?.replaceChildren();
    if (!bindingNode) return;
    const substrate = intake.projection?.projectSubstrateBinding;
    bindingNode.append(
      el("strong", "", "Direct thread control plane"),
      el(
        "span",
        "",
        substrate
          ? `${substrate.displayLabel} · ${substrate.workspaceKind} · ${substrate.environmentId}`
          : `${project?.name || "Selected project"} · substrate binding loading`,
      ),
      el("span", "", "Fresh continuations inherit this project-level substrate; intake cannot change it."),
    );
  }

  function sourceRow(entry, kind) {
    const id = String(kind === "import" ? entry.importId || "" : entry.handleId || "");
    const active = kind === "import" ? id === intake.selectedImportId : id === intake.selectedHandleId;
    const row = el("article", `direct-intake-source-item${active ? " active" : ""}`);
    row.dataset.intakeSourceKind = kind;
    row.dataset.intakeSourceId = id;
    const copy = el("div", "direct-intake-source-copy");
    const providerThreadId = entry.providerThreadId || entry.source?.providerThreadId || "";
    copy.append(
      el("strong", "", entry.sourceDisplayName || entry.source?.sourceDisplayName || "Codex transcript"),
      el(
        "span",
        "",
        kind === "import"
          ? `${entry.state || "imported-readonly"} · ${providerThreadId || "provider identity unavailable"}`
          : `${entry.recordCount ? `${entry.recordCount} records` : "selected source"} · ${providerThreadId || "inspect for provider identity"}`,
      ),
    );
    const action = el("button", "", "Inspect");
    action.type = "button";
    action.disabled = intake.working;
    action.addEventListener("click", () => selectSource(kind, id));
    row.append(copy, action);
    row.addEventListener("click", (event) => {
      if (event.target !== action) selectSource(kind, id);
    });
    return row;
  }

  function renderSources() {
    sourcesNode?.replaceChildren();
    if (!sourcesNode) return;
    const sources = Array.isArray(intake.sources) ? intake.sources : [];
    const imports = Array.isArray(intake.imports) ? intake.imports : [];
    if (countNode) countNode.textContent = String(sources.length + imports.length);
    for (const source of sources.slice(0, 40)) sourcesNode.appendChild(sourceRow(source, "source"));
    for (const entry of imports.slice(0, 40)) sourcesNode.appendChild(sourceRow(entry, "import"));
    if (!sources.length && !imports.length) {
      sourcesNode.appendChild(el("div", "direct-intake-empty", "No source selected and no imported transcript evidence exists for this project."));
    }
  }

  function evidenceRow(label, value) {
    const row = el("div", "direct-intake-evidence-row");
    row.append(el("small", "", label), el("strong", "", value || "unknown"));
    return row;
  }

  function renderEvidence() {
    evidenceNode?.replaceChildren();
    if (!evidenceNode) return;
    const projection = intake.projection;
    if (!projection) {
      evidenceNode.appendChild(el("div", "direct-intake-empty", intake.loading ? "Loading intake evidence…" : "Select a source to inspect its intake evidence."));
      return;
    }
    evidenceNode.appendChild(el("strong", "", "Same-context intake evidence"));
    const grid = el("div", "direct-intake-evidence-grid");
    const source = projection.source || {};
    grid.append(
      evidenceRow("source", source.sourceDisplayName || "none selected"),
      evidenceRow(
        "provider identity",
        source.providerThreadId
          ? `${source.providerThreadId} · ${source.providerThreadIdProvenance || "provenance unknown"}`
          : source.providerThreadIdProvenance && source.providerThreadIdProvenance !== "unavailable"
            ? `not present · ${source.providerThreadIdProvenance}`
            : "not present",
      ),
      evidenceRow("source standing", source.importState || source.sourceState || "unselected"),
      evidenceRow("workspace", projection.workspaceMatch?.matched ? "matched" : projection.workspaceMatch?.status || "unknown"),
      evidenceRow("active runtime", projection.runtime?.runtimePath || "unavailable"),
      evidenceRow("project substrate", projection.projectSubstrateBinding?.environmentId || "unknown"),
    );
    evidenceNode.append(grid);
    evidenceNode.appendChild(el(
      "span",
      "",
      "Raw paths, raw records, source hashes, imported approvals, and imported tool authority remain outside the renderer contract.",
    ));
    if (intake.selectedHandleId) {
      const materialize = el("button", "", "Materialize read-only evidence");
      materialize.type = "button";
      materialize.disabled = intake.working || !workspaceConfirmedForSelection();
      materialize.title = workspaceConfirmedForSelection()
        ? "Create a validated, read-only local evidence session."
        : "Confirm the project workspace before materializing this source.";
      materialize.addEventListener("click", materializeSelectedSource);
      evidenceNode.appendChild(materialize);
    }
  }

  function modeCard(mode, type) {
    const resume = type === "resume";
    const card = el("article", "direct-intake-mode-card");
    const activeTurnBlock = resume && (state.turnPending || turnIsActive());
    const blockers = [
      ...(Array.isArray(mode?.blockerCodes) ? mode.blockerCodes : []),
      ...(activeTurnBlock ? ["active_turn_must_finish"] : []),
    ];
    const enabled = mode?.enabled === true && !activeTurnBlock && !intake.working;
    card.dataset.intakeState = enabled ? "eligible" : "blocked";
    card.append(
      el("h3", "", resume ? "Resume original thread" : "Continue as a new Direct thread"),
      el(
        "p",
        "",
        resume
          ? "Attach to the same provider-owned thread. No new conversation identity is created."
          : "Compile the imported transcript as non-authoritative context and create a fresh Direct identity on the project substrate.",
      ),
      el(
        "p",
        "direct-intake-mode-status",
        enabled
          ? resume ? "eligible · provider verifies identity on execution" : "eligible · new identity · imported authority denied"
          : blockers.map(blockerLabel).join(" "),
      ),
    );
    if (!resume) {
      const intent = el("textarea");
      intent.placeholder = "Optional continuation intent for the new Direct thread…";
      intent.value = intake.continuationIntent;
      intent.disabled = intake.working;
      intent.addEventListener("input", () => { intake.continuationIntent = intent.value; });
      card.appendChild(intent);
    }
    const action = el("button", resume ? "" : "primary", resume ? "Resume original" : "Create fresh Direct continuation");
    action.type = "button";
    action.disabled = !enabled;
    action.dataset.intakeAction = mode?.kind || (resume ? "resume_original_thread" : "transplant_into_fresh_direct_thread");
    action.addEventListener("click", resume ? resumeOriginal : continueFresh);
    card.appendChild(action);
    return card;
  }

  function renderModes() {
    modesNode?.replaceChildren();
    if (!modesNode) return;
    const modes = intake.projection?.modes || {};
    modesNode.append(
      modeCard(modes.resumeOriginalThread || {}, "resume"),
      modeCard(modes.continueInFreshDirectThread || {}, "fresh"),
    );
  }

  function render() {
    if (statusNode) {
      statusNode.textContent = intake.error
        ? intake.error
        : intake.working
          ? "Applying the selected intake transition…"
          : intake.loading
            ? "Loading project-bound intake evidence…"
            : "Choose an identity-preserving resume or a provenance-preserving fresh continuation.";
    }
    const controlsDisabled = intake.loading || intake.working;
    if (chooseFileButton) chooseFileButton.disabled = controlsDisabled;
    if (chooseRootButton) chooseRootButton.disabled = controlsDisabled;
    if (refreshButton) refreshButton.disabled = controlsDisabled;
    if (workspaceConfirm) workspaceConfirm.disabled = intake.working;
    renderBinding();
    renderSources();
    renderEvidence();
    renderModes();
  }

  async function loadProjection() {
    if (!project?.id || typeof bridge?.readDirectThreadIntakeProjection !== "function") return;
    intake.projection = await bridge.readDirectThreadIntakeProjection(project.id, {
      ...selection(),
      userConfirmedWorkspace: workspaceConfirmedForSelection(),
    });
  }

  async function refresh() {
    if (!project?.id) return;
    intake.loading = true;
    intake.error = "";
    render();
    try {
      const listed = typeof bridge?.listDirectImports === "function"
        ? await bridge.listDirectImports(project.id)
        : { entries: [] };
      intake.imports = Array.isArray(listed?.entries) ? listed.entries : [];
      if (intake.selectedImportId && !intake.imports.some((entry) => entry.importId === intake.selectedImportId)) {
        setSelection("", "");
      }
      await loadProjection();
    } catch (error) {
      intake.error = `Thread intake unavailable: ${error.message}`;
    } finally {
      intake.loading = false;
      render();
    }
  }

  async function selectSource(kind, id) {
    if (!id || intake.working) return;
    intake.error = "";
    try {
      if (kind === "import") {
        setSelection("import", id);
      } else {
        setSelection("source", id);
        if (typeof bridge?.inspectDirectImportSource === "function") {
          const inspected = await bridge.inspectDirectImportSource(project.id, { handleId: id });
          intake.sources = intake.sources.map((source) => source.handleId === id ? { ...source, ...(inspected?.source || {}) } : source);
        }
      }
      await loadProjection();
    } catch (error) {
      intake.error = `Source inspection failed: ${error.message}`;
    }
    render();
  }

  async function chooseFile() {
    if (typeof bridge?.chooseDirectImportSourceFile !== "function") return;
    intake.working = true;
    intake.error = "";
    render();
    try {
      const result = await bridge.chooseDirectImportSourceFile(project.id);
      if (result?.ok && !result.canceled && result.source) {
        intake.sources = [result.source, ...intake.sources.filter((source) => source.handleId !== result.source.handleId)];
        setSelection("source", result.source.handleId);
        const inspected = await bridge.inspectDirectImportSource(project.id, { handleId: result.source.handleId });
        intake.sources = intake.sources.map((source) => source.handleId === result.source.handleId ? { ...source, ...(inspected?.source || {}) } : source);
        await loadProjection();
      }
    } catch (error) {
      intake.error = `Source selection failed: ${error.message}`;
    } finally {
      intake.working = false;
      render();
    }
  }

  async function chooseRoot() {
    if (typeof bridge?.chooseDirectImportSourceRoot !== "function") return;
    intake.working = true;
    intake.error = "";
    render();
    try {
      const result = await bridge.chooseDirectImportSourceRoot(project.id);
      if (result?.ok && !result.canceled) {
        intake.sources = Array.isArray(result.sources) ? result.sources : [];
        setSelection("source", intake.sources[0]?.handleId || "");
        await loadProjection();
      }
    } catch (error) {
      intake.error = `Source folder selection failed: ${error.message}`;
    } finally {
      intake.working = false;
      render();
    }
  }

  async function materializeSelectedSource() {
    if (!intake.selectedHandleId || typeof bridge?.materializeDirectImport !== "function") return;
    intake.working = true;
    intake.error = "";
    render();
    try {
      const result = await bridge.materializeDirectImport(project.id, {
        handleId: intake.selectedHandleId,
        userConfirmedWorkspace: workspaceConfirmedForSelection(),
      });
      const importId = result?.rendererSafeSession?.importId || result?.importId || "";
      intake.sources = intake.sources.filter((source) => source.handleId !== intake.selectedHandleId);
      setSelection("import", importId);
      const listed = await bridge.listDirectImports(project.id);
      intake.imports = Array.isArray(listed?.entries) ? listed.entries : [];
      await loadProjection();
    } catch (error) {
      intake.error = `Read-only import failed: ${error.message}`;
    } finally {
      intake.working = false;
      render();
    }
  }

  async function resumeOriginal() {
    const threadId = intake.projection?.source?.providerThreadId || "";
    if (!threadId) return;
    intake.working = true;
    intake.error = "";
    render();
    try {
      await openThreadHybrid(
        threadId,
        "",
        "",
        intake.projection?.source?.sourceDisplayName || threadId,
        { requireProviderResume: true },
      );
      addSystemMessage("Resumed the original provider thread. Conversation identity was preserved.");
      panel.hidden = true;
      syncOpenState();
    } catch (error) {
      intake.error = `Original thread resume failed: ${error.message}`;
    } finally {
      intake.working = false;
      render();
    }
  }

  async function continueFresh() {
    const importId = intake.projection?.source?.importId || "";
    if (!importId || typeof bridge?.startDirectImportCheckpointContinuation !== "function") return;
    intake.working = true;
    intake.error = "";
    render();
    try {
      const result = await bridge.startDirectImportCheckpointContinuation(project.id, {
        importId,
        clientCheckpointContinuationId: `direct_intake_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        userPromptText: intake.continuationIntent.trim(),
        model: activeModelId() || null,
      });
      if (!result?.ok || !result.sessionId) {
        throw new Error(result?.continuation?.failure?.message || "Fresh Direct continuation did not complete.");
      }
      await refreshDirectThreadList({ showErrors: false });
      await openDirectThread(result.sessionId);
      addSystemMessage("Opened a fresh Direct continuation. Imported context is provenance only; provider identity and prior authority were not inherited.");
      panel.hidden = true;
      syncOpenState();
    } catch (error) {
      intake.error = `Fresh Direct continuation failed: ${error.message}`;
    } finally {
      intake.working = false;
      await refresh().catch(() => {});
      render();
    }
  }

  function togglePanel() {
    const opening = panel.hidden;
    if (opening) {
      if (runtimeDrawer && !runtimeDrawer.hidden) runtimeDrawerClose?.click();
      if (analyticsPanel && !analyticsPanel.hidden) analyticsClose?.click();
    }
    panel.hidden = !opening;
    syncOpenState();
    if (opening) refresh();
  }

  utilityButton.addEventListener("click", togglePanel);
  closeButton?.addEventListener("click", () => {
    panel.hidden = true;
    syncOpenState();
  });
  chooseFileButton?.addEventListener("click", chooseFile);
  chooseRootButton?.addEventListener("click", chooseRoot);
  refreshButton?.addEventListener("click", refresh);
  workspaceConfirm?.addEventListener("change", async () => {
    intake.workspaceConfirmationKey = workspaceConfirm.checked ? selectionKey() : "";
    try {
      await loadProjection();
    } catch (error) {
      intake.error = `Workspace settlement failed: ${error.message}`;
    }
    render();
  });

  syncOpenState();
  render();
})();
