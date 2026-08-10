"use strict";

function decodePayload() {
  const raw = window.location.hash.slice(1);
  if (!raw) return {};
  try {
    const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      Array.from(atob(normalized), (char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""),
    );
    return JSON.parse(json);
  } catch {
    return {};
  }
}

const bridge = window.codexSurfaceBridge;
const payload = decodePayload();
const projectPayload = payload.project || {};
const hasExperienceWitness = Boolean(
  payload.appExperience?.id ||
  payload.appExperience?.controlPlane,
);
const experienceValid =
  !hasExperienceWitness ||
  (payload.appExperience?.id === "world-manager-studio" &&
    payload.appExperience?.controlPlane === "worldmanager-semantic");
const productionMode = payload.worldManager?.mode === "production";
const semanticMockupMode = payload.semanticMockup?.mode === "fixture";
const launchModeValid = experienceValid && (productionMode || semanticMockupMode);
const productionStage = payload.worldManager?.pipelineStage || "wm_k6_genesis";
const MOCK_PROJECTION_SCHEMA = "direct_world_manager_semantic_mockup_projection@1";
const PRODUCTION_PROJECTION_SCHEMA = "direct_world_manager_workbench_projection@1";

const state = {
  projection: null,
  semanticZoomOpen: false,
  semanticZoomEventId: "",
  semanticZoomDepth:
    "unified_outcome",
  activeInspector: "",
  inspectedProjectId: "",
  pending: false,
  managerRuntimeSettings: null,
  managerRuntimeDraft: {
    model: "",
    reasoningEffort: "",
  },
  managerRuntimeLoading: false,
  managerRuntimeDirty: false,
  pendingDecisionIds: new Set(),
  stagedDecisionOptions: new Map(),
  decisionDrafts: new Map(),
  selectedSemanticSurfaceId: "",
  selectedAroSubjectId: "",
  selectedAroObjectClass: "",
  aroTargetDrafts: new Map(),
  aroTargetComposerOpen: new Set(),
  semanticSurfaceLenses: new Map(),
  aroWorkerRequests: new Map(),
  pendingAroWorkerRequests:
    new Set(),
  aroExecutionEvidenceLenses:
    new Map(),
  aroSemanticVerificationLenses:
    new Map(),
  contextCanvasLens: "canvas",
  selectedEpistemicLifecycleId: "",
  reviewingEpistemicAdmissionId: "",
  pendingEpistemicAdmissionId: "",
  selectedThoughtBrush: "",
  thoughtBrushDirection: "",
  toastTimer: null,
};

const elements = Object.fromEntries([
  "worldPulse",
  "worldLifecycleLabel",
  "worldRevision",
  "runtimeMode",
  "managerRuntimeSettings",
  "managerRuntimeSettingsToggle",
  "managerRuntimeSummary",
  "managerRuntimeState",
  "managerModelSelect",
  "managerEffortSelect",
  "managerRuntimeEffective",
  "managerRuntimeObserved",
  "managerRuntimeCatalog",
  "refreshManagerModels",
  "applyManagerRuntime",
  "managerRuntimeBoundary",
  "resetButton",
  "overviewTitle",
  "overviewSummary",
  "worldMetrics",
  "conversation",
  "emptyConversation",
  "messageList",
  "starterPrompt",
  "operationalContextRibbon",
  "operationalContextState",
  "operationalContextSummary",
  "operationalContextChips",
  "operationalContextFacts",
  "composerForm",
  "composerInput",
  "activeProjectPill",
  "sendButton",
  "projectCount",
  "projectList",
  "decisionDock",
  "openDecisionDock",
  "decisionDockTitle",
  "decisionDockCount",
  "decisionDockEntries",
  "projectEcologyInspector",
  "projectEcologyTitle",
  "projectEcologySummary",
  "projectEcologyFacts",
  "projectSeedList",
  "projectEcologyActions",
  "activateInspectedProject",
  "closeProjectEcologyInspector",
  "decisionOutcomeInspector",
  "decisionOutcomeTitle",
  "decisionOutcomeSummary",
  "openDecisionList",
  "splitOutcomeList",
  "staleDecisionDetails",
  "staleDecisionSummary",
  "staleDecisionList",
  "historicalRemandDetails",
  "historicalRemandSummary",
  "historicalRemandList",
  "closeDecisionOutcomeInspector",
  "epistemicFabricInspector",
  "epistemicFabricTitle",
  "epistemicFabricSummary",
  "epistemicFabricFacts",
  "epistemicLifecycleList",
  "epistemicFocusedLifecycle",
  "epistemicActivityList",
  "epistemicDeliveryList",
  "closeEpistemicFabricInspector",
  "contextCanvasInspector",
  "contextCanvasInspectorTitle",
  "contextCanvasInspectorSummary",
  "contextCanvasFacts",
  "thoughtBrushSelect",
  "thoughtBrushTarget",
  "thoughtBrushAltitude",
  "thoughtBrushInstruction",
  "thoughtBrushPreview",
  "applyThoughtBrush",
  "undoContextCanvas",
  "contextCanvasLenses",
  "contextCanvasPanel",
  "closeContextCanvasInspector",
  "aroInspector",
  "aroInspectorTitle",
  "aroInspectorSummary",
  "aroReconstructionStatus",
  "aroCandidateList",
  "aroHistoryList",
  "aroCurrentTargetList",
  "aroRegistryList",
  "aroFocusedObject",
  "closeAroInspector",
  "settlementPanel",
  "settlementTitle",
  "settlementState",
  "settlementSummary",
  "settlementFacts",
  "clarificationPrompt",
  "inspectSettlementButton",
  "reconciliationPanel",
  "reconciliationTitle",
  "reconciliationState",
  "reconciliationSummary",
  "blindspotList",
  "continuationList",
  "proposalPanel",
  "proposalTitle",
  "proposalState",
  "proposalSummary",
  "featureList",
  "inspectEvidenceButton",
  "greenlightButton",
  "greenlightGate",
  "projectGenesisPanel",
  "projectGenesisTitle",
  "projectGenesisState",
  "projectGenesisSummary",
  "projectGenesisLens",
  "projectGenesisLandscape",
  "projectGenesisDefault",
  "realizationOptionList",
  "projectSubstrateProvisioning",
  "projectWorkspacePathLabel",
  "projectWorkspacePath",
  "projectWorkspaceDistroField",
  "projectWorkspaceDistro",
  "provisionProjectSubstrateButton",
  "projectSubstrateProvisioningGate",
  "inspectGenesisEvidenceButton",
  "admitProjectButton",
  "projectAdmissionGate",
  "contractPanel",
  "contractTitle",
  "contractObjective",
  "workThreadLabel",
  "semanticZoom",
  "semanticZoomTitle",
  "semanticZoomSummary",
  "semanticZoomIdentity",
  "semanticDepthNavigator",
  "semanticDepthHeading",
  "semanticWitnessHeading",
  "closeSemanticZoom",
  "settlementEvidence",
  "instantiationEvidence",
  "resultEvidence",
  "reconciliationEvidence",
  "lineageList",
  "evidenceReviewStatus",
  "markEvidenceReviewed",
  "toast",
].map((id) => [id, document.getElementById(id)]));

if (productionMode) {
  const emptyTitle = elements.emptyConversation?.querySelector("h2");
  const emptySummary = elements.emptyConversation?.querySelector("p:not(.eyebrow)");
  if (emptyTitle) emptyTitle.textContent = "Test the durable keyboard path";
  if (emptySummary) {
    emptySummary.textContent =
      productionStage === "wm_k6_genesis"
        ? "Describe a new project here. The WorldManager will settle project genesis, rank only harness-observed WSL and Windows realization options, and return a non-canonical constitution candidate for your review."
      : productionStage === "wm_k5_planning"
        ? "Review and refine the reconciled plan here. Admission creates canonical graph truth and a contract_received WorkThread; it does not start implementation."
      : productionStage === "wm_k4"
        ? "WM-K4 settles your message, compiles the bounded agent world, runs the responsible manager through persisted Direct, renders its typed result, and reconciles that same result at world level. Proposal admission remains unavailable."
        : "WM-K3 settles your message, computes its operative policy closure, and validates a bounded agent world. It stops before any provider reply, proposal, or execution contract.";
  }
  if (elements.starterPrompt) {
    elements.starterPrompt.textContent =
      productionStage === "wm_k6_genesis"
        ? "Start a Windows shell-integration project"
        : productionStage === "wm_k5_planning"
          ? "Refine the current plan or inspect it before admission"
        : productionStage === "wm_k4"
          ? "Plan five features without starting implementation"
          : "Settle a planning request without executing it";
  }
}

if (!launchModeValid) {
  const emptyTitle = elements.emptyConversation?.querySelector("h2");
  const emptySummary = elements.emptyConversation?.querySelector("p:not(.eyebrow)");
  if (emptyTitle) emptyTitle.textContent = "WorldManager launch mode is unavailable";
  if (emptySummary) {
    emptySummary.textContent =
      "The surface did not receive an explicit production or semantic-mockup binding. Reload the application; no fallback runtime will be called.";
  }
  elements.runtimeMode.closest(".mode-control").hidden = true;
  elements.resetButton.hidden = true;
  elements.sendButton.disabled = true;
  elements.composerInput.disabled = true;
}

function clear(element) {
  if (element) element.replaceChildren();
}

function textElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = String(text ?? "");
  return element;
}

function formatRole(role) {
  return String(role || "system")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatActionClasses(values) {
  return (values || []).map((value) =>
    String(value || "").replace(/_/g, " "));
}

function formatSemanticTypeExpressions(values) {
  return (values || []).map((entry) => {
    const mode = String(entry?.mode || "");
    const value =
      mode === "existing_ref"
        ? entry.existingTypeRef
      : mode === "proposed_type"
        ? entry.proposedLabel
      : mode === "composite"
        ? (entry.components || []).join(" + ")
        : entry.freeformCharacterization;
    return `${mode || "type"}: ${value || "—"}`;
  });
}

function shortId(value) {
  const text = String(value || "");
  return text.length > 23 ? `${text.slice(0, 12)}…${text.slice(-7)}` : text || "—";
}

function showToast(message, kind = "info") {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = String(message || "");
  elements.toast.className = `toast ${kind === "error" ? "error" : ""}`.trim();
  elements.toast.hidden = false;
  state.toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, kind === "error" ? 7000 : 3500);
}

function managerRuntimeModelDescriptor(modelId = "") {
  const settings = state.managerRuntimeSettings;
  const effectiveModel = String(
    modelId || settings?.effective?.model || "",
  );
  return (settings?.catalog?.models || []).find((entry) =>
    entry.id === effectiveModel) || null;
}

function managerRuntimeDraftEffectiveModel() {
  const settings = state.managerRuntimeSettings;
  const draft = state.managerRuntimeDraft.model;
  if (draft) return draft;
  if (
    state.managerRuntimeDirty &&
    settings?.configured?.model
  ) {
    return settings.catalog?.providerDefaultModel ||
      settings.catalog?.bundledDefaultModel ||
      settings.effective?.model || "automatic";
  }
  return settings?.effective?.model || "automatic";
}

function managerRuntimeDraftEffectiveEffort() {
  const settings = state.managerRuntimeSettings;
  const draft = state.managerRuntimeDraft.reasoningEffort;
  if (draft) return draft;
  if (
    state.managerRuntimeDirty &&
    settings?.configured?.reasoningEffort
  ) {
    return "medium";
  }
  return settings?.effective?.reasoningEffort || "medium";
}

function replaceSelectOptions(select, options, value = "") {
  if (!select) return;
  clear(select);
  for (const option of options) {
    const node = document.createElement("option");
    node.value = String(option.value ?? "");
    node.textContent = String(option.label ?? option.value ?? "");
    select.append(node);
  }
  select.value = String(value || "");
}

function renderManagerEffortOptions() {
  const settings = state.managerRuntimeSettings;
  if (!settings || !elements.managerEffortSelect) return;
  const selectedModel = managerRuntimeDraftEffectiveModel();
  const descriptor = managerRuntimeModelDescriptor(selectedModel);
  const supported = descriptor?.supportedReasoningEfforts?.length
    ? descriptor.supportedReasoningEfforts
    : ["low", "medium", "high", "xhigh", "max", "ultra"];
  const current = state.managerRuntimeDraft.reasoningEffort;
  const values = [...new Set([
    ...supported,
    ...(current ? [current] : []),
  ])];
  replaceSelectOptions(
    elements.managerEffortSelect,
    [
      {
        value: "",
        label: `Automatic · role contract (${managerRuntimeDraftEffectiveEffort()})`,
      },
      ...values.map((effort) => ({
        value: effort,
        label: effort,
      })),
    ],
    current,
  );
}

function renderManagerRuntimeSettings() {
  const available = productionMode &&
    Boolean(bridge?.getWorldManagerRuntimeSettings) &&
    Boolean(bridge?.updateWorldManagerRuntimeSettings);
  elements.managerRuntimeSettings.hidden = !available;
  if (!available) return;
  const settings = state.managerRuntimeSettings;
  const busy = Boolean(
    state.pending ||
    state.projection?.busy ||
    state.managerRuntimeLoading,
  );
  if (!settings) {
    elements.managerRuntimeSummary.textContent =
      state.managerRuntimeLoading ? "loading…" : "unavailable";
    elements.managerRuntimeState.textContent =
      state.managerRuntimeLoading ? "loading" : "unknown";
    elements.managerModelSelect.disabled = true;
    elements.managerEffortSelect.disabled = true;
    elements.refreshManagerModels.disabled = state.managerRuntimeLoading;
    elements.applyManagerRuntime.disabled = true;
    return;
  }
  const draftModel = state.managerRuntimeDraft.model;
  const draftEffort = state.managerRuntimeDraft.reasoningEffort;
  const effectiveModel = managerRuntimeDraftEffectiveModel();
  const effectiveEffort = managerRuntimeDraftEffectiveEffort();
  elements.managerRuntimeSummary.textContent =
    `${effectiveModel} · ${draftEffort || "auto"}`;
  elements.managerRuntimeState.textContent =
    state.managerRuntimeDirty ? "draft" : "configured";
  elements.managerRuntimeState.classList.toggle(
    "draft",
    state.managerRuntimeDirty,
  );
  const modelOptions = [
    {
      value: "",
      label: `Automatic · ${settings.effective?.model || "provider default"}`,
    },
    ...(settings.catalog?.models || []).map((model) => ({
      value: model.id,
      label: `${model.displayName || model.id}${
        model.evidenceState === "provider_observed" ? " · provider" :
          model.evidenceState === "cached_provider_observation" ? " · cached" :
            " · profile"
      }`,
    })),
  ];
  replaceSelectOptions(
    elements.managerModelSelect,
    modelOptions,
    draftModel,
  );
  renderManagerEffortOptions();
  elements.managerRuntimeEffective.textContent =
    `${effectiveModel} · ${effectiveEffort}`;
  elements.managerRuntimeObserved.textContent = settings.lastObserved?.model
    ? `${settings.lastObserved.model} · ${settings.lastObserved.reasoningEffort || "effort unknown"}`
    : "No persisted provider observation";
  elements.managerRuntimeCatalog.textContent =
    `${String(settings.catalog?.evidenceState || "unavailable").replaceAll("_", " ")} · ${
      settings.catalog?.models?.length || 0
    } models`;
  elements.managerRuntimeBoundary.textContent = busy
    ? "The current transition owns its runtime binding. Changes unlock when it reaches a terminal boundary."
    : "Apply persists a preference for the next manager provider call. It starts no call and grants no worker authority.";
  elements.managerModelSelect.disabled = busy;
  elements.managerEffortSelect.disabled = busy;
  elements.refreshManagerModels.disabled = busy;
  elements.applyManagerRuntime.disabled =
    busy || !state.managerRuntimeDirty;
}

async function loadManagerRuntimeSettings(refreshMetadata = false) {
  if (
    !productionMode ||
    !bridge?.getWorldManagerRuntimeSettings ||
    state.managerRuntimeLoading
  ) {
    renderManagerRuntimeSettings();
    return;
  }
  state.managerRuntimeLoading = true;
  renderManagerRuntimeSettings();
  try {
    const settings = await bridge.getWorldManagerRuntimeSettings(
      refreshMetadata,
    );
    state.managerRuntimeSettings = settings;
    state.managerRuntimeDraft = {
      model: settings?.configured?.model || "",
      reasoningEffort:
        settings?.configured?.reasoningEffort || "",
    };
    state.managerRuntimeDirty = false;
  } finally {
    state.managerRuntimeLoading = false;
    renderManagerRuntimeSettings();
  }
}

function activeProject() {
  const projection = state.projection;
  return projection?.projects?.find((project) => project.projectId === projection.activeProjectId) ||
    projection?.projects?.[0] ||
    null;
}

function semanticSurfaceProjection() {
  const projection =
    state.projection?.semanticSurface;
  return projection?.schema ===
    "direct_semantic_surface_projection@1"
    ? projection
    : null;
}

function contextCanvasProjection() {
  const projection =
    state.projection?.contextCanvas;
  return projection?.schema ===
    "direct_context_canvas_workbench_projection@1"
    ? projection
    : null;
}

function unifiedProjection() {
  const projection =
    state.projection
      ?.unifiedProjection;
  return projection?.schema ===
    "direct_unified_worldmanager_projection@1"
    ? projection
    : null;
}

function semanticAnatomyProjection() {
  const projection =
    unifiedProjection()
      ?.semanticAnatomy;
  return projection?.schema ===
    "direct_semantic_anatomy_projection@1"
    ? projection
    : null;
}

function selectedSemanticAnatomyEvent() {
  const anatomy =
    semanticAnatomyProjection();
  const events =
    anatomy?.eventObjects || [];
  return (
    events.find((event) =>
      event.eventRef?.id ===
        state.semanticZoomEventId) ||
    events.find((event) =>
      event.eventRef?.id ===
        anatomy?.activeEventRef?.id) ||
    events.at(-1) ||
    null
  );
}

function selectedSemanticAnatomyDepth(
  event = selectedSemanticAnatomyEvent(),
) {
  return (event?.depths || [])
    .find((depth) =>
      depth.depth ===
        state.semanticZoomDepth) ||
    event?.depths?.[0] ||
    null;
}

function openSemanticAnatomy(
  semanticEventId = "",
  depth = "",
) {
  const anatomy =
    semanticAnatomyProjection();
  const selected =
    anatomy?.eventObjects?.find(
      (event) =>
        event.eventRef?.id ===
          semanticEventId,
    ) ||
    anatomy?.eventObjects?.at(-1) ||
    null;
  state.semanticZoomEventId =
    selected?.eventRef?.id || "";
  if (
    depth &&
    selected?.availableDepths
      ?.includes(depth)
  ) {
    state.semanticZoomDepth = depth;
  } else if (
    !selected?.availableDepths
      ?.includes(
        state.semanticZoomDepth,
      )
  ) {
    state.semanticZoomDepth =
      selected?.availableDepths?.[0] ||
      "unified_outcome";
  }
  state.semanticZoomOpen = true;
  renderSemanticZoom();
}

function semanticSurfaceById(surfaceId) {
  return (
    semanticSurfaceProjection()
      ?.objectSurfaces || []
  ).find((surface) =>
    surface.semanticObjectSurfaceId ===
      surfaceId) || null;
}

function semanticSurfaceForSubject(
  kind,
  id,
) {
  return (
    semanticSurfaceProjection()
      ?.objectSurfaces || []
  ).find((surface) =>
    surface.subjectRef?.kind === kind &&
    surface.subjectRef?.id === id) || null;
}

function semanticLensForSurface(surface) {
  return (
    state.semanticSurfaceLenses.get(
      surface.semanticObjectSurfaceId,
    ) ||
    surface.defaultLens ||
    "O"
  );
}

function semanticLensProjectionForSurface(
  surface,
) {
  const lens =
    semanticLensForSurface(surface);
  return (surface.lensProjections || [])
    .find((projection) =>
      projection.lens === lens) || null;
}

function semanticRegionBindingForSurface(
  surface,
) {
  const lens =
    semanticLensForSurface(surface);
  const bindingRef =
    (surface.regionBindings || [])
      .find((entry) =>
        entry.lens === lens)
      ?.bindingRef;
  if (!bindingRef) return null;
  return (
    semanticSurfaceProjection()
      ?.regionBindings || []
  ).find((binding) =>
    binding.semanticRegionBindingId ===
      bindingRef.id &&
    binding.digest ===
      bindingRef.digest) || null;
}

function activeGenesisSurface() {
  const surfaces =
    semanticSurfaceProjection()
      ?.objectSurfaces || [];
  return surfaces
    .filter((surface) =>
      surface.objectClass ===
        "project_constitution_candidate")
    .at(-1) ||
    surfaces
      .filter((surface) =>
        surface.objectClass ===
          "project_constitution")
      .at(-1) ||
    null;
}

function renderLifecycle() {
  const projection = state.projection;
  if (!projection) return;
  elements.worldLifecycleLabel.textContent = projection.lifecycleLabel || "World posture unavailable";
  elements.worldRevision.textContent = `revision ${projection.revision} · ${
    productionMode
      ? `${String(projection.pipelineStage || "wm_k6_genesis").toUpperCase().replaceAll("_", "-")} keyboard pipeline`
      : String(projection.mode || "fixture").replace(/_/g, " ")
  }`;
  elements.worldPulse.classList.toggle("busy", projection.busy);
  elements.worldPulse.classList.toggle("failed", projection.lifecycleState === "failed");
  elements.runtimeMode.closest(".mode-control").hidden = !semanticMockupMode;
  elements.resetButton.hidden = !semanticMockupMode;
  if (semanticMockupMode) elements.runtimeMode.value = projection.mode || "fixture";
  elements.runtimeMode.disabled = projection.busy || state.pending;
  elements.resetButton.disabled = projection.busy || state.pending;
  elements.sendButton.disabled = projection.busy || state.pending;
  elements.composerInput.disabled = projection.busy || state.pending;
  const active = activeProject();
  elements.activeProjectPill.textContent = `project: ${active?.name || projectPayload.name || "—"}`;

  const candidateCount = (projection.projects || []).reduce((sum, project) => sum + Number(project.candidateCount || 0), 0);
  const workThreadCount = (projection.projects || []).reduce((sum, project) => sum + Number(project.activeWorkThreadCount || 0), 0);
  elements.overviewTitle.textContent = productionMode
    ? projection.worldPosture?.title || "Keyboard control plane"
    : projection.lifecycleState === "idle"
      ? "Quiet world, ready for direction"
      : projection.lifecycleState === "implementation_active"
        ? "Canonical work is moving"
        : projection.lifecycleState === "failed"
          ? "The world stopped at a visible failure"
          : "One request is moving through the world";
  elements.overviewSummary.textContent = productionMode
    ? projection.worldPosture?.summary || "Semantic settlement posture is unavailable."
    : projection.lifecycleState === "candidate_ready"
      ? "The response is visible. Its proposal remains provisional until evidence is inspected and you explicitly greenlight it."
      : projection.lifecycleState === "implementation_active"
        ? "The admitted contract has reached an active WorkThread. Activity remains distinct from completion."
        : "The WorldManager maintains global posture while bounded roles formulate project-scoped work.";
  const contextCount = Number(projection.store?.counts?.managerContextCount || 0);
  const agentWorldCount = Number(
    projection.store?.counts?.agentWorldCompilationCount || 0,
  );
  const agentResultCount = Number(
    projection.store?.counts?.agentResultCount || 0,
  );
  const clarificationCount = Number(
    projection.decisionSummary
      ?.actionRequiredCount || 0,
  );
  const establishedProjectCount = Number(
    projection.projectEcology
      ?.establishedProjectCount ??
      projection.projects?.length ??
      0,
  );
  const candidateProjectCount = Number(
    projection.projectEcology
      ?.candidateProjectCount || 0,
  );
  const aroCandidateCount = Number(
    projection.aroRegistry
      ?.candidateCount || 0,
  );
  const canonicalAroCount = Number(
    projection.aroRegistry
      ?.canonicalAroCount || 0,
  );
  const metrics = [
    {
      value:
        productionMode &&
        candidateProjectCount
          ? `${establishedProjectCount} · ${candidateProjectCount}`
          : establishedProjectCount,
      label:
        productionMode &&
        candidateProjectCount
          ? "projects · candidates"
          : "projects",
      inspector: productionMode ? "projects" : "",
    },
    productionMode
      ? {
          value:
            agentResultCount ||
            agentWorldCount ||
            contextCount,
          label: agentResultCount
            ? "agent results"
            : agentWorldCount
              ? "agent worlds"
              : "contexts ready",
          inspector: "",
        }
      : {
          value: candidateCount,
          label: "candidates",
          inspector: "",
        },
    productionMode
      ? {
          value: clarificationCount,
          label: "open decisions",
          inspector: "decisions",
        }
      : {
          value: workThreadCount,
          label: "active work",
          inspector: "",
        },
    ...(productionMode
      ? [
          {
            value:
              projection
                .contextCanvas
                ?.activeStrokeCount ||
              projection
                .contextCanvas
                ?.candidateInsightCount
                ? `${
                    projection
                      .contextCanvas
                      ?.activeStrokeCount ||
                    0
                  } · ${
                    projection
                      .contextCanvas
                      ?.candidateInsightCount ||
                    0
                  }`
                : 0,
            label:
              projection
                .contextCanvas
                ?.candidateInsightCount
                ? "brushes · insights"
                : "thought canvas",
            inspector: "canvas",
          },
          {
            value:
              aroCandidateCount
                ? `${canonicalAroCount} · ${aroCandidateCount}`
                : canonicalAroCount,
            label:
              aroCandidateCount
                ? "AROs · candidates"
                : "AROs",
            inspector: "aros",
          },
          {
            value:
              projection.epistemicFabric?.summary
                ?.gateReadyCount
                ? `${
                    projection.epistemicFabric
                      ?.ledgerDescriptor
                      ?.globalSequence || 0
                  } · ${
                    projection.epistemicFabric
                      ?.summary
                      ?.gateReadyCount || 0
                  }`
                : projection.epistemicFabric
                    ?.ledgerDescriptor
                    ?.globalSequence || 0,
            label:
              projection.epistemicFabric?.summary
                ?.gateReadyCount
                ? "ledger acts · gate ready"
                : "epistemic acts",
            inspector: "epistemic",
          },
        ]
      : []),
  ];
  clear(elements.worldMetrics);
  for (const entry of metrics) {
    const metric = textElement(
      entry.inspector ? "button" : "div",
      `metric ${entry.inspector ? "inspectable" : ""}`,
      "",
    );
    if (entry.inspector) {
      metric.type = "button";
      metric.dataset.inspector = entry.inspector;
      metric.setAttribute(
        "aria-label",
        `Inspect ${entry.label}`,
      );
      metric.addEventListener("click", () => {
        state.activeInspector = entry.inspector;
        if (
          entry.inspector === "projects" &&
          !state.inspectedProjectId
        ) {
          state.inspectedProjectId =
            projection.activeProjectId ||
            projection.projects?.[0]?.projectId ||
            "";
        }
        if (
          entry.inspector === "aros" &&
          (
            !state.inspectedProjectId ||
            !projection.projects?.find(
              (project) =>
                project.projectId ===
                  state.inspectedProjectId &&
                (
                  project.aroCount ||
                  project.aroCandidateCount
                ),
            )
          )
        ) {
          state.inspectedProjectId =
            projection.projects?.find(
              (project) =>
                project.aroCount ||
                project.aroCandidateCount,
            )?.projectId ||
            projection.activeProjectId ||
            projection.projects?.[0]?.projectId ||
            "";
        }
        if (
          entry.inspector ===
            "canvas"
        ) {
          state.inspectedProjectId =
            projection
              .contextCanvas
              ?.activeCanvas
              ?.activeProjectId ||
            projection.activeProjectId ||
            projection.projects?.[0]
              ?.projectId ||
            "";
        }
        render();
      });
    }
    metric.append(
      textElement("strong", "", entry.value),
      textElement("span", "", entry.label),
    );
    elements.worldMetrics.append(metric);
  }
}

function selectSemanticSurface(
  surface,
  inspector = "decisions",
) {
  if (!surface) return;
  if (inspector === "aros") {
    focusAroSurface(
      surface,
      {
        reveal: true,
      },
    );
    return;
  }
  state.selectedSemanticSurfaceId =
    surface.semanticObjectSurfaceId;
  state.activeInspector = inspector;
  render();
}

function semanticLensNavigator(
  surface,
  rerender,
) {
  const nav = textElement(
    "div",
    "semantic-lens-navigator",
    "",
  );
  nav.dataset.semanticSurfaceId =
    surface.semanticObjectSurfaceId;
  nav.setAttribute(
    "aria-label",
    "Semantic landscape",
  );
  const selected =
    semanticLensForSurface(surface);
  const lensRegistry =
    semanticSurfaceProjection()
      ?.lensRegistry?.lenses || [];
  for (const lens of lensRegistry) {
    const button = textElement(
      "button",
      `semantic-lens-button ${
        lens.lens === selected
          ? "selected"
          : ""
      }`,
      lens.lens,
    );
    button.type = "button";
    button.title =
      `${lens.label} · ${lens.description}`;
    button.dataset.lens = lens.lens;
    button.setAttribute(
      "aria-pressed",
      String(lens.lens === selected),
    );
    button.addEventListener("click", () => {
      state.semanticSurfaceLenses.set(
        surface.semanticObjectSurfaceId,
        lens.lens,
      );
      state.selectedSemanticSurfaceId =
        surface.semanticObjectSurfaceId;
      rerender();
    });
    nav.append(button);
  }
  return nav;
}

function semanticLensContent(surface) {
  const lensProjection =
    semanticLensProjectionForSurface(
      surface,
    );
  const regionBinding =
    semanticRegionBindingForSurface(
      surface,
    );
  const landscape = textElement(
    "section",
    "semantic-landscape",
    "",
  );
  landscape.dataset.lens =
    lensProjection?.lens || "";
  landscape.dataset.regionBindingId =
    regionBinding
      ?.semanticRegionBindingId || "";
  for (
    const section of
      lensProjection?.sections || []
  ) {
    if (!(section.items || []).length) {
      continue;
    }
    const group = textElement(
      "div",
      "semantic-landscape-section",
      "",
    );
    group.append(
      textElement(
        "span",
        "inspector-object-kind",
        section.title,
      ),
    );
    for (const item of section.items) {
      const row = textElement(
        "div",
        "semantic-landscape-row",
        "",
      );
      row.append(
        textElement("span", "", item.label),
        textElement(
          "strong",
          "",
          item.value || "—",
        ),
      );
      group.append(row);
    }
    landscape.append(group);
  }
  const boundary =
    textElement(
      "details",
      "semantic-boundary-signals",
      "",
    );
  boundary.append(
    textElement(
      "summary",
      "",
      "Other semantic landscapes",
    ),
  );
  for (
    const signal of
      lensProjection?.boundarySignals || []
  ) {
    const row = textElement(
      "div",
      "semantic-boundary-signal",
      "",
    );
    row.append(
      textElement(
        "span",
        "",
        `${signal.lens} · ${signal.label}`,
      ),
      textElement(
        "strong",
        "",
        signal.summary,
      ),
    );
    boundary.append(row);
  }
  if (
    (lensProjection?.boundarySignals || [])
      .length
  ) {
    landscape.append(boundary);
  }
  return landscape;
}

function inlineSemanticArtifact(surface) {
  const card = textElement(
    "aside",
    "inline-semantic-artifact",
    "",
  );
  card.dataset.semanticSurfaceId =
    surface.semanticObjectSurfaceId;
  card.dataset.subjectId =
    surface.subjectRef.id;
  card.append(
    textElement(
      "span",
      "inline-semantic-kind",
      `${surface.objectClass.replace(/_/g, " ")} · ${surface.defaultLens}`,
    ),
    textElement(
      "strong",
      "",
      surface.compactProjection?.title ||
        surface.semanticIdentity,
    ),
    textElement(
      "span",
      "inline-semantic-state",
      surface.surfaceState,
    ),
  );
  const inspect = textElement(
    "button",
    "message-inspect-button",
    surface.objectClass ===
      "open_decision"
      ? "Open exact decision"
      : surface.objectClass ===
          "decision_transition_receipt"
        ? "Open exact receipt"
      : "Open semantic object",
  );
  inspect.type = "button";
  inspect.addEventListener("click", () =>
    selectSemanticSurface(
      surface,
      [
        "open_decision",
        "decision_transition_receipt",
      ].includes(
        surface.objectClass,
      )
        ? "decisions"
        : [
            "aro_reconstruction_candidate",
            "abstract_reasoning_object",
            "aro_coverage_witness",
            "aro_current_target_comparison",
          ].includes(
            surface.objectClass,
          )
          ? "aros"
          : "",
    ));
  card.append(inspect);
  return card;
}

function renderMessages() {
  const messages = state.projection?.messages || [];
  const inlineByEventId = new Map();
  const finalMessageIndexByEventId = new Map();
  messages.forEach((message, index) => {
    const lineageRootId =
      message.sourceSemanticEventId ||
      message.semanticEventId ||
      "";
    if (lineageRootId) {
      finalMessageIndexByEventId.set(
        lineageRootId,
        index,
      );
    }
  });
  for (
    const artifact of
      semanticSurfaceProjection()
        ?.inlineArtifacts || []
  ) {
    const surface = semanticSurfaceById(
      artifact.surfaceRef?.id,
    );
    if (!surface) continue;
    const entries =
      inlineByEventId.get(
        artifact.anchorSemanticEventId,
      ) || [];
    entries.push(surface);
    inlineByEventId.set(
      artifact.anchorSemanticEventId,
      entries,
    );
  }
  elements.emptyConversation.hidden = messages.length > 0;
  clear(elements.messageList);
  messages.forEach((message, messageIndex) => {
    const lineageRootId =
      message.sourceSemanticEventId ||
      message.semanticEventId ||
      "";
    const article = textElement(
      "article",
      `message ${message.authorKind}`,
      "",
    );
    article.dataset.semanticEventId = message.semanticEventId || "";
    article.dataset.lineageRootId =
      lineageRootId;
    if (message.authorKind === "harness") {
      article.dataset.stateSurface =
        "diagnostic-status-surface";
    }
    const meta = textElement("div", "message-meta", "");
    meta.append(
      textElement("span", "message-role", message.provenanceLabel || formatRole(message.authorRole)),
      textElement("span", "", message.projectId || ""),
    );
    article.append(
      meta,
      textElement("div", "message-body", message.text),
    );
    if (
      finalMessageIndexByEventId.get(
        lineageRootId,
      ) === messageIndex
    ) {
      for (
        const surface of
          inlineByEventId.get(
            lineageRootId,
          ) || []
      ) {
        article.append(
          inlineSemanticArtifact(surface),
        );
      }
    }
    if (
      message.authorKind === "harness" &&
      message.noticeRef?.kind ===
        "semantic_split_coordination"
    ) {
      const inspect = textElement(
        "button",
        "message-inspect-button",
        "Inspect child outcomes",
      );
      inspect.type = "button";
      inspect.addEventListener("click", () => {
        state.activeInspector = "decisions";
        render();
      });
      article.append(inspect);
    }
    const anatomyEvent =
      semanticAnatomyProjection()
        ?.eventObjects
        ?.find((entry) =>
          entry.eventRef?.id ===
            lineageRootId);
    if (
      productionMode &&
      anatomyEvent &&
      finalMessageIndexByEventId.get(
        lineageRootId,
      ) === messageIndex
    ) {
      const inspect =
        textElement(
          "button",
          "message-inspect-button semantic-anatomy-trigger",
          "Inspect semantic anatomy",
        );
      inspect.type = "button";
      inspect.dataset.semanticEventId =
        anatomyEvent.eventRef.id;
      inspect.addEventListener(
        "click",
        () =>
          openSemanticAnatomy(
            anatomyEvent.eventRef.id,
          ),
      );
      article.append(inspect);
    }
    article.append(
      textElement(
        "span",
        "message-state",
        `${message.lineageState || message.state || "observed"} · ${shortId(message.semanticEventId)}`,
      ),
    );
    elements.messageList.append(article);
  });
  if (messages.length) {
    requestAnimationFrame(() => {
      elements.conversation.scrollTop = elements.conversation.scrollHeight;
    });
  }
}

function renderProjects() {
  const projects = state.projection?.projects || [];
  const ecology =
    state.projection?.projectEcology || {};
  const establishedProjectCount = Number(
    ecology.establishedProjectCount ??
      projects.length,
  );
  const candidateProjectCount = Number(
    ecology.candidateProjectCount || 0,
  );
  elements.projectCount.textContent =
    `${establishedProjectCount} project${
      establishedProjectCount === 1 ? "" : "s"
    }${
      candidateProjectCount
        ? ` · ${candidateProjectCount} candidate${
            candidateProjectCount === 1 ? "" : "s"
          }`
        : ""
    }`;
  clear(elements.projectList);
  const indicatorByProject = new Map(
    (
      semanticSurfaceProjection()
        ?.projectIndicators || []
    ).map((indicator) => [
      indicator.projectId,
      indicator,
    ]),
  );
  for (const project of projects) {
    const article = textElement(
      "article",
      `project-card ${project.activityState || "inactive"} ${
        project.inspectionPosture || ""
      }`,
      "",
    );
    article.dataset.projectId = project.projectId;
    article.dataset.projectPosture =
      project.inspectionPosture || "";
    article.classList.toggle(
      "inspected",
      state.activeInspector === "projects" &&
        state.inspectedProjectId ===
          project.projectId,
    );
    article.append(textElement("span", "project-accent", ""));
    const copy = textElement("div", "project-copy", "");
    copy.append(
      textElement("h3", "", project.name),
      textElement("p", "", `${String(project.posture || "unknown").replace(/_/g, " ")} · ${project.summary}`),
    );
    const stats = textElement("div", "project-card-stats", "");
    if (project.candidateCount) {
      if (
        project.inspectionPosture ===
        "semantic_candidate"
      ) {
        stats.append(
          textElement(
            "span",
            "candidate-stat",
            String(
              project.reconciliationState ||
                "candidate",
            ).replace(/_/g, " "),
          ),
        );
      } else {
        stats.append(
          textElement(
            "span",
            "candidate-stat",
            `${project.candidateCount} candidate`,
          ),
        );
      }
      stats.append(
        textElement(
          "span",
          project.evidenceReviewState === "reviewed"
            ? "reviewed-stat"
            : "review-required-stat",
          project.evidenceReviewState === "reviewed"
            ? "evidence reviewed"
            : "review required",
        ),
      );
    }
    if (project.activeWorkThreadCount) stats.append(textElement("span", "", `${project.activeWorkThreadCount} active`));
    if (project.primaryAgentEnvironmentId) {
      stats.append(textElement(
        "span",
        project.constitutionState === "canonical" ? "canonical-stat" : "",
        String(project.primaryAgentEnvironmentId).replace(/^env_/, "").replace(/_/g, " "),
      ));
    }
    if (project.activationState === "awaiting_workspace_provisioning") {
      stats.append(textElement("span", "pending-stat", "awaiting provisioning"));
    } else if (project.workspaceProvisioningState === "provisioned") {
      stats.append(textElement(
        "span",
        "canonical-stat",
        project.primaryEnvironmentReady
          ? "native substrate ready"
          : "substrate needs attention",
      ));
    }
    const semanticIndicator =
      indicatorByProject.get(
        project.projectId,
      );
    if (
      Number(
        semanticIndicator?.decisionCount || 0,
      ) > 0
    ) {
      const decisionIndicator =
        textElement(
          "button",
          "project-decision-indicator",
          `${semanticIndicator.decisionCount} decision${
            semanticIndicator.decisionCount === 1
              ? ""
              : "s"
          }`,
        );
      decisionIndicator.type = "button";
      decisionIndicator.dataset.projectId =
        project.projectId;
      decisionIndicator.addEventListener(
        "click",
        (event) => {
          event.stopPropagation();
          const firstSurface =
            semanticSurfaceById(
              semanticIndicator
                .surfaceRefs?.[0]?.id,
            );
          selectSemanticSurface(
            firstSurface,
            "decisions",
          );
        },
      );
      stats.append(decisionIndicator);
    }
    if (
      Number(
        semanticIndicator
          ?.aroSurfaceCount || 0,
      ) > 0 ||
      project.aroReconstructionState !==
        "not_scheduled"
    ) {
      const reconstructionState =
        project.aroReconstructionState;
      const aroIndicator = textElement(
        "button",
        "project-aro-indicator",
        project.aroCandidateCount
          ? `${project.aroCandidateCount} ARO candidate${
              project.aroCandidateCount === 1
                ? ""
                : "s"
            }`
          : project.aroCount
            ? `${project.aroCount} ARO${
                project.aroCount === 1
                  ? ""
                  : "s"
              }`
            : `ARO reconstruction ${String(
                reconstructionState ||
                  "not scheduled",
              ).replace(/_/g, " ")}`,
      );
      aroIndicator.type = "button";
      aroIndicator.dataset.projectId =
        project.projectId;
      aroIndicator.addEventListener(
        "click",
        (event) => {
          event.stopPropagation();
          state.inspectedProjectId =
            project.projectId;
          const firstSurface =
            semanticSurfaceById(
              semanticIndicator
                ?.aroSurfaceRefs?.[0]?.id,
            );
          if (firstSurface) {
            selectSemanticSurface(
              firstSurface,
              "aros",
            );
          } else {
            state.activeInspector =
              "aros";
            render();
          }
        },
      );
      stats.append(aroIndicator);
    }
    if (
      !project.candidateCount &&
      !project.activeWorkThreadCount &&
      !project.primaryAgentEnvironmentId
    ) {
      stats.append(textElement("span", "", project.activityState.replace(/_/g, " ")));
    }
    article.append(copy, stats);
    if (productionMode) {
      article.tabIndex = 0;
      article.setAttribute("role", "button");
      article.setAttribute(
        "aria-label",
        `Inspect ${project.name}`,
      );
      const inspect = () => {
        state.activeInspector = "projects";
        state.inspectedProjectId =
          project.projectId;
        render();
      };
      article.addEventListener("click", inspect);
      article.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          inspect();
        }
      });
    }
    elements.projectList.append(article);
  }
}

function renderDecisionDock() {
  const dock =
    semanticSurfaceProjection()
      ?.decisionDock;
  const entries = dock?.entries || [];
  elements.decisionDock.hidden =
    !productionMode || !entries.length;
  if (elements.decisionDock.hidden) {
    return;
  }
  elements.decisionDockTitle.textContent =
    `${entries.length} open semantic decision${
      entries.length === 1 ? "" : "s"
    }`;
  elements.decisionDockCount.textContent =
    String(entries.length);
  clear(elements.decisionDockEntries);
  for (const entry of entries.slice(0, 4)) {
    const surface = semanticSurfaceById(
      entry.surfaceRef.id,
    );
    if (!surface) continue;
    const button = textElement(
      "button",
      "decision-dock-entry",
      "",
    );
    button.type = "button";
    button.dataset.semanticSurfaceId =
      surface.semanticObjectSurfaceId;
    button.dataset.subjectId =
      surface.subjectRef.id;
    button.append(
      textElement(
        "span",
        "",
        surface.compactProjection
          ?.eyebrow ||
          "world scope",
      ),
      textElement(
        "strong",
        "",
        surface.compactProjection
          ?.title ||
          surface.semanticIdentity,
      ),
      textElement(
        "small",
        "",
        `${surface.defaultLens} · ${surface.surfaceState}`,
      ),
    );
    button.addEventListener("click", () =>
      selectSemanticSurface(
        surface,
        "decisions",
      ));
    elements.decisionDockEntries.append(
      button,
    );
  }
}

function renderList(element, values) {
  clear(element);
  for (const value of values || []) element.append(textElement("div", "", value));
}

function inspectorObject({
  eyebrow,
  title,
  summary,
  stateLabel,
  actionLabel,
  onAction,
}) {
  const article = textElement(
    "article",
    "inspector-object",
    "",
  );
  const header = textElement(
    "div",
    "inspector-object-header",
    "",
  );
  const copy = textElement("div", "", "");
  if (eyebrow) {
    copy.append(
      textElement(
        "span",
        "inspector-object-kind",
        eyebrow,
      ),
    );
  }
  copy.append(textElement("strong", "", title));
  header.append(copy);
  if (stateLabel) {
    header.append(
      textElement(
        "span",
        "inspector-object-state",
        stateLabel,
      ),
    );
  }
  article.append(header);
  if (summary) {
    article.append(
      textElement(
        "p",
        "inspector-object-summary",
        summary,
      ),
    );
  }
  if (actionLabel && onAction) {
    const action = textElement(
      "button",
      "evidence-button inspector-object-action",
      actionLabel,
    );
    action.type = "button";
    action.addEventListener("click", onAction);
    article.append(action);
  }
  return article;
}

function decisionInspectorObject(decision) {
  const typed =
    decision?.schema ===
      "direct_open_decision_projection@1";
  const article = inspectorObject({
    eyebrow:
      decision.projectName ||
      decision.projectId ||
      "world scope",
    title: decision.text,
    summary: typed
      ? (
          decision.description ||
          "Canonical semantic decision record. Its governed SC5 transition remains bounded by the exact contract below."
        )
      : decision.decisionKind ===
          "project_constitution_open_decision"
        ? "Legacy decision projection; canonical migration evidence is unavailable in this snapshot."
        : "Current clarification boundary.",
    stateLabel: decision.state,
  });
  if (!typed) return article;
  article.dataset.decisionId = decision.decisionId;
  article.dataset.resolutionMode =
    decision.resolutionMode;
  article.dataset.lifecycle = decision.lifecycle;

  const metadata = textElement(
    "div",
    "decision-metadata",
    "",
  );
  for (const value of [
    String(decision.resolutionMode || "semantic_relay")
      .replace(/_/g, " "),
    `revision ${decision.revision}`,
    String(decision.epistemicPosture || "observed")
      .replace(/_/g, " "),
    decision.shelfRef
      ? "project shelf bound"
      : "world scoped",
  ]) {
    metadata.append(
      textElement("span", "", value),
    );
  }
  article.append(metadata);

  if (decision.options?.length) {
    const options = textElement(
      "div",
      "decision-option-list",
      "",
    );
    options.append(
      textElement(
        "span",
        "inspector-object-kind",
        "Typed options",
      ),
    );
    for (const option of decision.options) {
      const optionCard = textElement(
        "div",
        `decision-option-card ${
          state.stagedDecisionOptions.get(
            decision.decisionId,
          ) === option.optionId
            ? "staged"
            : ""
        }`,
        "",
      );
      if (
        decision.resolutionMode ===
          "mechanical"
      ) {
        const select = textElement(
          "button",
          "decision-option-select",
          option.label,
        );
        select.type = "button";
        select.disabled =
          option.availability !== "available" ||
          state.pendingDecisionIds.has(
            decision.decisionId,
          );
        select.dataset.decisionId =
          decision.decisionId;
        select.dataset.optionId =
          option.optionId;
        select.dataset.transitionStage =
          "selection";
        select.addEventListener("click", () => {
          state.stagedDecisionOptions.set(
            decision.decisionId,
            option.optionId,
          );
          renderDecisionOutcomeInspector();
        });
        optionCard.append(select);
      } else {
        optionCard.append(
          textElement("strong", "", option.label),
        );
      }
      if (
        option.description ||
        option.effectSummary
      ) {
        optionCard.append(
          textElement(
            "p",
            "",
            option.description ||
              option.effectSummary,
          ),
        );
      }
      optionCard.append(
        textElement(
          "span",
          "",
          option.availability,
        ),
      );
      options.append(optionCard);
    }
    article.append(options);
  }

  const structuralItems = [
    ...(decision.dependencies || []).map(
      (dependency) => ({
        kind:
          `dependency · ${dependency.state}`,
        text: dependency.requirement,
      }),
    ),
    ...(decision.consequences || []).map(
      (consequence) => ({
        kind:
          `consequence · ${consequence.posture}`,
        text: consequence.description,
      }),
    ),
  ];
  if (structuralItems.length) {
    const details = textElement(
      "details",
      "decision-structure",
      "",
    );
    details.append(
      textElement(
        "summary",
        "",
        `${structuralItems.length} structural relation${
          structuralItems.length === 1 ? "" : "s"
        }`,
      ),
    );
    for (const item of structuralItems) {
      const row = textElement(
        "div",
        "decision-structure-row",
        "",
      );
      row.append(
        textElement(
          "span",
          "inspector-object-kind",
          item.kind,
        ),
        textElement("p", "", item.text),
      );
      details.append(row);
    }
    article.append(details);
  }

  article.append(
    textElement(
      "p",
      "decision-transition-boundary",
      `Input form: ${String(
        decision.resolutionContract?.inputShape ||
          "scoped_free_form",
      ).replace(/_/g, " ")} · expected revision and idempotency enforced`,
    ),
  );
  article.append(
    decisionTransitionControls(decision),
  );
  return article;
}

function decisionAdapterFromSurface(surface) {
  const binding =
    semanticRegionBindingForSurface(
      surface,
    );
  const interaction =
    surface.interaction || {};
  const evidenceLens =
    (surface.lensProjections || [])
      .find((projection) =>
        projection.lens === "E");
  const shelfRef =
    evidenceLens?.promotedObjectRefs
      ?.find((ref) =>
        ref.kind === "semantic_shelf") ||
    null;
  return {
    schema:
      "direct_open_decision_projection@1",
    semanticSurfaceId:
      surface.semanticObjectSurfaceId,
    semanticRegionBindingRef:
      binding
        ? {
            kind:
              "semantic_region_binding",
            id:
              binding
                .semanticRegionBindingId,
            digest: binding.digest,
          }
        : null,
    decisionId: surface.subjectRef.id,
    artifactRef: surface.subjectRef,
    semanticIdentity:
      surface.semanticIdentity,
    decisionKind:
      surface.objectClass,
    projectId: surface.projectId,
    projectName:
      surface.compactProjection?.eyebrow,
    text:
      surface.compactProjection?.title ||
      surface.semanticIdentity,
    description: surface.summary,
    state: surface.surfaceState,
    lifecycle: surface.surfaceState,
    revision:
      binding?.expectedSubjectRevision ||
      1,
    epistemicPosture:
      evidenceLens?.sections?.[0]
        ?.items?.find((item) =>
          item.label ===
            "epistemic posture")
        ?.value || "observed",
    resolutionMode:
      interaction.resolutionMode,
    options: interaction.options || [],
    dependencies:
      interaction.dependencies || [],
    consequences: [],
    resolutionContract: {
      inputShape:
        interaction.inputShape,
      transitionAvailability:
        interaction.available
          ? "available_wm_sc5"
          : "unavailable",
    },
    shelfRef,
    latestTransition:
      interaction.latestTransition,
    canonical:
      surface.canonicalObject === true,
    grantsAuthority: false,
  };
}

function compiledDecisionInspectorObject(
  surface,
) {
  const decision =
    decisionAdapterFromSurface(surface);
  const article =
    decisionInspectorObject(decision);
  article.classList.add(
    "compiled-semantic-surface",
  );
  article.dataset.semanticSurfaceId =
    surface.semanticObjectSurfaceId;
  article.dataset.morphFamily =
    surface.morph.family;
  article.dataset.semanticLens =
    semanticLensForSurface(surface);
  const metadata =
    article.querySelector(
      ".decision-metadata",
    );
  const navigator =
    semanticLensNavigator(
      surface,
      renderDecisionOutcomeInspector,
    );
  const landscape =
    semanticLensContent(surface);
  if (metadata) {
    metadata.before(navigator);
    metadata.after(landscape);
  } else {
    article.prepend(
      navigator,
      landscape,
    );
  }
  return article;
}

function compiledTransitionReceipt(
  surface,
) {
  const receipt = inspectorObject({
    eyebrow:
      surface.compactProjection
        ?.eyebrow ||
      `decision transition · ${shortId(
        surface.subjectRef.id,
      )}`,
    title:
      surface.compactProjection?.title ||
      surface.semanticIdentity,
    summary: surface.summary,
    stateLabel:
      String(surface.surfaceState)
        .replace(/_/g, " "),
  });
  receipt.classList.add(
    "decision-transition-receipt",
    "compiled-semantic-surface",
  );
  receipt.dataset.semanticSurfaceId =
    surface.semanticObjectSurfaceId;
  receipt.dataset.subjectId =
    surface.subjectRef.id;
  receipt.dataset.transitionState =
    surface.surfaceState;
  receipt.dataset.morphFamily =
    surface.morph.family;
  receipt.dataset.semanticLens =
    semanticLensForSurface(surface);
  receipt.append(
    semanticLensNavigator(
      surface,
      renderDecisionOutcomeInspector,
    ),
    semanticLensContent(surface),
    textElement(
      "p",
      "decision-transition-boundary",
      "Append-only transition receipt · downstream effects not executed · no authority granted",
    ),
  );
  return receipt;
}

function transitionKindForDecision(decision) {
  return {
    mechanical: "resolve_option",
    semantic_relay: "semantic_relay",
    evidence_request: "request_evidence",
    authority_request: "request_authority",
  }[decision.resolutionMode] ||
    "semantic_relay";
}

function decisionTransitionControls(decision) {
  const pending =
    state.pending ||
    state.pendingDecisionIds.has(
      decision.decisionId,
    );
  const mode =
    decision.resolutionMode ||
    "semantic_relay";
  const cluster = textElement(
    "section",
    "decision-action-cluster",
    "",
  );
  cluster.dataset.posture =
    mode === "mechanical"
      ? "mechanical_resolution"
      : mode;
  cluster.dataset.decisionId =
    decision.decisionId;
  cluster.dataset.authorityControl =
    "decision_transition";

  if (mode === "mechanical") {
    const stagedOptionId =
      state.stagedDecisionOptions.get(
        decision.decisionId,
      );
    const option = decision.options?.find(
      (entry) =>
        entry.optionId === stagedOptionId,
    );
    const blockedDependencies =
      (decision.dependencies || []).filter(
        (dependency) =>
          dependency.blocking &&
          dependency.state !== "satisfied",
      );
    const gate = textElement(
      "p",
      "decision-action-gate",
      blockedDependencies.length
        ? `${blockedDependencies.length} binding dependenc${
            blockedDependencies.length === 1
              ? "y remains"
              : "ies remain"
          } unsatisfied. Resolution is blocked.`
        : option
          ? `Staged: ${option.label}. Confirm to revise this semantic decision; no downstream effect will run.`
          : "Select one exact option above. A separate confirmation is required.",
    );
    cluster.append(gate);
    if (option) {
      const confirm = textElement(
        "button",
        "decision-transition-confirm",
        pending
          ? "Resolving…"
          : `Confirm resolution · ${option.label}`,
      );
      confirm.type = "button";
      confirm.disabled =
        pending ||
        blockedDependencies.length > 0;
      confirm.dataset.transitionKind =
        "resolve_option";
      confirm.dataset.transitionStage =
        "canonical_confirmation";
      confirm.addEventListener(
        "click",
        () =>
          submitDecisionTransition(
            decision,
            { option },
          ),
      );
      cluster.append(confirm);
    }
  } else {
    const copy = {
      semantic_relay: {
        label: "Revision or guidance for the WorldManager",
        placeholder:
          "Describe how this decision should be revised or settled…",
        button: "Relay to WorldManager",
      },
      evidence_request: {
        label: "Evidence request",
        placeholder:
          "What evidence is needed before this can be decided?",
        button: "Request evidence",
      },
      authority_request: {
        label: "Authority request",
        placeholder:
          "Describe the exact authority or exception being requested…",
        button: "Request authority",
      },
    }[mode];
    const label = textElement(
      "label",
      "decision-relay-label",
      copy.label,
    );
    const textarea = document.createElement(
      "textarea",
    );
    textarea.className =
      "decision-relay-input";
    textarea.rows = 3;
    textarea.placeholder = copy.placeholder;
    textarea.value =
      state.decisionDrafts.get(
        decision.decisionId,
      ) || "";
    textarea.disabled = pending;
    textarea.dataset.decisionId =
      decision.decisionId;
    textarea.addEventListener(
      "input",
      () => {
        state.decisionDrafts.set(
          decision.decisionId,
          textarea.value,
        );
      },
    );
    label.append(textarea);
    cluster.append(label);
    const relay = textElement(
      "button",
      "decision-relay-submit",
      pending ? "Relaying…" : copy.button,
    );
    relay.type = "button";
    relay.disabled =
      pending ||
      !textarea.value.trim();
    relay.dataset.transitionKind =
      transitionKindForDecision(decision);
    relay.addEventListener("click", () =>
      submitDecisionTransition(
        decision,
        {
          semanticInput:
            state.decisionDrafts.get(
              decision.decisionId,
            ) || "",
        },
      ));
    textarea.addEventListener(
      "input",
      () => {
        relay.disabled =
          pending ||
          !textarea.value.trim();
      },
    );
    cluster.append(
      relay,
      textElement(
        "p",
        "decision-action-gate",
        mode === "authority_request"
          ? "This requests authority; it does not grant it."
          : mode === "evidence_request"
            ? "This opens an evidence path; it does not resolve the decision."
            : "The exact text re-enters normal WorldManager ingress. The decision remains open.",
      ),
    );
  }

  if (decision.latestTransition) {
    const latest =
      decision.latestTransition;
    const status = textElement(
      "div",
      "decision-transition-status",
      "",
    );
    status.dataset.state = latest.state;
    status.append(
      textElement(
        "strong",
        "",
        String(latest.state).replace(/_/g, " "),
      ),
      textElement(
        "span",
        "",
        latest.summary,
      ),
    );
    cluster.append(status);
  }
  return cluster;
}

async function submitDecisionTransition(
  decision,
  input = {},
) {
  if (
    !productionMode ||
    state.pending ||
    state.pendingDecisionIds.has(
      decision.decisionId,
    ) ||
    !bridge?.transitionWorldManagerDecision
  ) {
    return;
  }
  const option = input.option || null;
  state.pendingDecisionIds.add(
    decision.decisionId,
  );
  renderDecisionOutcomeInspector();
  try {
    const result =
      await bridge.transitionWorldManagerDecision({
        clientRequestId:
          globalThis.crypto?.randomUUID?.() ||
          `wm_decision_transition_${Date.now()}_${Math.random()
            .toString(36)
            .slice(2)}`,
        decisionId: decision.decisionId,
        decisionDigest:
          decision.artifactRef.digest,
        expectedDecisionRevision:
          decision.revision,
        expectedProjectionRevision:
          state.projection
            ?.projectionRevision ?? null,
        transitionKind:
          transitionKindForDecision(decision),
        optionId: option?.optionId || "",
        optionDigest:
          option?.optionRef?.digest || "",
        semanticInput:
          String(
            input.semanticInput || "",
          ).trim(),
        semanticRegionBindingRef:
          decision
            .semanticRegionBindingRef ||
          null,
        actorId: "operator",
        actorRole: "operator",
      });
    applyProjection(
      result?.projection || result,
    );
    const receipt = result?.receipt;
    if (receipt?.state === "resolved") {
      state.stagedDecisionOptions.delete(
        decision.decisionId,
      );
    }
    if (receipt?.state === "relayed") {
      state.decisionDrafts.delete(
        decision.decisionId,
      );
    }
    showToast(
      receipt?.summary ||
        "Decision transition state recorded.",
      receipt?.state === "failed"
        ? "error"
        : undefined,
    );
  } catch (error) {
    showToast(
      error?.message ||
        "The governed decision transition failed.",
      "error",
    );
    await refresh();
  } finally {
    state.pendingDecisionIds.delete(
      decision.decisionId,
    );
    render();
  }
}

function prepareProjectSeedRetry(seed) {
  if (!seed?.retryPrompt) return;
  elements.composerInput.value = seed.retryPrompt;
  elements.composerInput.focus();
  showToast(
    "A retry request was prepared in the composer. Review it before sending; no state was changed.",
  );
}

function renderProjectEcologyInspector() {
  const visible =
    productionMode &&
    state.activeInspector === "projects";
  elements.projectEcologyInspector.hidden = !visible;
  if (!visible) return;
  const projection = state.projection;
  const ecology = projection?.projectEcology || {};
  const project =
    (projection?.projects || []).find((entry) =>
      entry.projectId === state.inspectedProjectId) ||
    activeProject();
  if (project) {
    state.inspectedProjectId = project.projectId;
  }
  elements.projectEcologyTitle.textContent =
    project?.name || "Project ecology";
  elements.projectEcologySummary.textContent =
    project
      ? project.summary
      : "No project is available for inspection.";
  clear(elements.projectEcologyFacts);
  const facts = project
    ? [
        [
          "semantic identity",
          project.projectId,
        ],
        [
          "source",
          String(
            project.sourceKind ||
              "configured_project",
          ).replace(/_/g, " "),
        ],
        [
          "inspection posture",
          String(
            project.inspectionPosture ||
              "runtime_project",
          ).replace(/_/g, " "),
        ],
        [
          "constitution",
          String(
            project.constitutionState ||
              "not admitted",
          ).replace(/_/g, " "),
        ],
        [
          "activation",
          String(
            project.activationState ||
              "unknown",
            ).replace(/_/g, " "),
        ],
        [
          "workspace substrate",
          String(
            project.workspaceProvisioningState ||
              "not provisioned",
          ).replace(/_/g, " "),
        ],
        [
          "primary environment",
          project.primaryEnvironmentReady
            ? "ready"
            : "not proven ready",
        ],
        [
          "environment lineage",
          `${project.threadEnvironmentBindingCount || 0} thread bindings · ${project.stepEnvironmentSnapshotCount || 0} step snapshots`,
        ],
        ...(project.candidateId
          ? [
              [
                "candidate lifecycle",
                String(
                  project.candidateLifecycle ||
                    "candidate",
                ).replace(/_/g, " "),
              ],
              [
                "evidence review",
                String(
                  project.evidenceReviewState ||
                    "not reviewed",
                ).replace(/_/g, " "),
              ],
              [
                "reconciliation",
                String(
                  project.reconciliationState ||
                    "pending",
                ).replace(/_/g, " "),
              ],
            ]
          : []),
        [
          "open decisions",
          String(project.openDecisionCount || 0),
        ],
        [
          "abstract reasoning objects",
          String(project.aroCount || 0),
        ],
        [
          "ARO reconstruction candidates",
          String(
            project.aroCandidateCount ||
              0,
          ),
        ],
      ]
    : [];
  for (const [label, value] of facts) {
    const row = textElement(
      "div",
      "settlement-fact",
      "",
    );
    row.append(
      textElement("span", "", label),
      textElement("strong", "", value),
    );
    elements.projectEcologyFacts.append(row);
  }

  clear(elements.projectSeedList);
  const seeds = ecology.projectSeeds || [];
  if (seeds.length) {
    elements.projectSeedList.append(
      textElement(
        "h4",
        "inspector-section-title",
        "Preserved project seeds · not counted as projects",
      ),
    );
  }
  for (const seed of seeds) {
    elements.projectSeedList.append(
      inspectorObject({
        eyebrow: "semantic project seed",
        title: seed.identity,
        summary: seed.summary,
        stateLabel:
          String(seed.state || "preserved")
            .replace(/_/g, " "),
        actionLabel:
          seed.recoveryPosture ===
            "retry_available"
            ? "Prepare retry"
            : "",
        onAction: () =>
          prepareProjectSeedRetry(seed),
      }),
    );
  }

  const alreadyActive =
    project?.projectId ===
    projection?.activeProjectId;
  const focusEligible =
    project?.focusEligible === true;
  elements.activateInspectedProject.hidden =
    !project;
  elements.activateInspectedProject.disabled =
    !focusEligible ||
    alreadyActive ||
    state.pending;
  elements.activateInspectedProject.textContent =
    alreadyActive
      ? "Active context"
      : focusEligible
        ? "Make active context"
        : project?.inspectionPosture ===
            "semantic_candidate"
          ? "Inspection only · admission pending"
          : project?.inspectionPosture ===
              "provisioned_constitution"
            ? "Inspection only · worldmodel activation pending"
          : "Inspection only · runtime not provisioned";
  elements.projectEcologyActions.dataset.posture =
    focusEligible
      ? "activation_available"
      : "inspection_only";
}

function renderDecisionOutcomeInspector() {
  const visible =
    productionMode &&
    state.activeInspector === "decisions";
  elements.decisionOutcomeInspector.hidden = !visible;
  if (!visible) return;
  const decisions =
    state.projection?.decisionSummary || {};
  const surfaceProjection =
    semanticSurfaceProjection();
  const compiledOpen =
    (surfaceProjection?.decisionDock
      ?.entries || [])
      .map((entry) =>
        semanticSurfaceById(
          entry.surfaceRef.id,
        ))
      .filter(Boolean);
  const split =
    state.projection?.semanticSplit;
  const open = compiledOpen.length
    ? compiledOpen
    : Array.isArray(
        decisions.openDecisions,
      )
      ? decisions.openDecisions
      : [
          ...(decisions.currentClarifications || []),
          ...(decisions.candidateOpenDecisions || []),
        ];
  elements.decisionOutcomeTitle.textContent =
    `${open.length} open decision${
      open.length === 1
        ? ""
        : "s"
    }`;
  elements.decisionOutcomeSummary.textContent =
    compiledOpen.length
      ? "SC6 compiles each exact decision through an ODEU semantic lens and a lawful interaction morph while preserving the governed SC5 transitions. Switching landscape changes foreground, never identity or authority."
    : decisions.migrationPosture ===
        "sc3_canonical_registry"
      ? "These canonical decision records expose governed SC5 transitions. Mechanical confirmation revises only the semantic decision; relay, evidence, and authority paths re-enter the WorldManager without minting authority."
      : "These are legacy projected decisions. Historical remands remain inspectable below, but do not inflate the action-required count.";
  clear(elements.openDecisionList);
  if (!open.length) {
    elements.openDecisionList.append(
      textElement(
        "p",
        "inspector-empty",
        "No current decision object requires input.",
      ),
    );
  }
  for (const decision of open) {
    elements.openDecisionList.append(
      decision?.schema ===
        "direct_semantic_object_surface@1"
        ? compiledDecisionInspectorObject(
            decision,
          )
        : decisionInspectorObject(decision),
    );
  }
  const recentTransitions = Array.isArray(
    decisions.recentTransitions,
  )
    ? decisions.recentTransitions
    : [];
  const compiledTransitions =
    (surfaceProjection?.objectSurfaces || [])
      .filter((surface) =>
        surface.objectClass ===
          "decision_transition_receipt");
  const transitionObjects =
    compiledTransitions.length
      ? compiledTransitions
      : recentTransitions;
  if (transitionObjects.length) {
    elements.openDecisionList.append(
      textElement(
        "h4",
        "inspector-section-title decision-transition-history-title",
        "Recent governed transitions",
      ),
    );
    for (
      const transition of
        transitionObjects
    ) {
      if (
        transition.schema ===
          "direct_semantic_object_surface@1"
      ) {
        elements.openDecisionList.append(
          compiledTransitionReceipt(
            transition,
          ),
        );
        continue;
      }
      const receipt = inspectorObject({
        eyebrow:
          `${String(
            transition.transitionKind,
          ).replace(/_/g, " ")} · ${shortId(
            transition.decisionId,
          )}`,
        title:
          transition.selectedOptionLabel ||
          String(transition.state)
            .replace(/_/g, " "),
        summary: transition.summary,
        stateLabel:
          String(transition.state)
            .replace(/_/g, " "),
      });
      receipt.classList.add(
        "decision-transition-receipt",
      );
      receipt.dataset.transitionState =
        transition.state;
      receipt.append(
        textElement(
          "p",
          "decision-transition-boundary",
          transition.canonicalDecisionMutation
            ? "Canonical decision state revised · downstream effects not executed"
            : "Decision remains open · no authority granted",
        ),
      );
      elements.openDecisionList.append(
        receipt,
      );
    }
  }

  clear(elements.splitOutcomeList);
  if (split) {
    elements.splitOutcomeList.append(
      textElement(
        "h4",
        "inspector-section-title",
        `Latest compound turn · ${String(split.state).replace(/_/g, " ")}`,
      ),
    );
    for (const outcome of split.childOutcomes || []) {
      const seed =
        state.projection?.projectEcology
          ?.projectSeeds?.find((entry) =>
            entry.childEventRef?.id ===
            outcome.childEventRef?.id);
      elements.splitOutcomeList.append(
        inspectorObject({
          eyebrow:
            `semantic child ${Number(outcome.childIndex) + 1}`,
          title:
            outcome.semanticTypeExpression
              ?.proposedLabel ||
            outcome.semanticPrompt ||
            "Semantic child outcome",
          summary:
            outcome.summary ||
            "No child summary was persisted.",
          stateLabel:
            String(outcome.state)
              .replace(/_/g, " "),
          actionLabel:
            seed?.recoveryPosture ===
              "retry_available"
              ? "Prepare project-seed retry"
              : "",
          onAction: seed
            ? () =>
                prepareProjectSeedRetry(seed)
            : null,
        }),
      );
    }
  }

  const stale =
    surfaceProjection
      ? (
          surfaceProjection.objectSurfaces || []
        ).filter((surface) =>
          surface.objectClass ===
            "open_decision" &&
          surface.surfaceState === "stale")
      : decisions.staleDecisions || [];
  elements.staleDecisionDetails.hidden =
    !stale.length;
  elements.staleDecisionSummary.textContent =
    `${stale.length} stale decision${
      stale.length === 1 ? "" : "s"
    } · preserved, not actionable`;
  clear(elements.staleDecisionList);
  for (const decision of stale) {
    elements.staleDecisionList.append(
      decision?.schema ===
        "direct_semantic_object_surface@1"
        ? compiledDecisionInspectorObject(
            decision,
          )
        : decisionInspectorObject(decision),
    );
  }

  const historical =
    decisions.historicalRemands || [];
  elements.historicalRemandDetails.hidden =
    !historical.length;
  elements.historicalRemandSummary.textContent =
    `${historical.length} historical remand${
      historical.length === 1 ? "" : "s"
    } · not counted as open`;
  clear(elements.historicalRemandList);
  for (const remand of historical) {
    elements.historicalRemandList.append(
      inspectorObject({
        eyebrow:
          shortId(remand.semanticEventId),
        title: remand.summary,
        summary:
          "Immutable historical lineage; no current action is inferred.",
        stateLabel:
          String(remand.state).replace(/_/g, " "),
      }),
    );
  }
}

function aroRegistryProjection() {
  return state.projection?.aroRegistry
    ?.schema ===
      "direct_aro_registry_projection@1"
    ? state.projection.aroRegistry
    : null;
}

function aroObjectForSurface(surface) {
  const registry =
    aroRegistryProjection();
  if (!registry || !surface) return null;
  if (
    surface.objectClass ===
      "aro_reconstruction_candidate"
  ) {
    return registry.candidates.find(
      (candidate) =>
        candidate.candidateId ===
          surface.subjectRef.id &&
        candidate.digest ===
          surface.subjectRef.digest,
    ) || null;
  }
  if (
    surface.objectClass ===
      "abstract_reasoning_object"
  ) {
    return registry.canonicalAros.find(
      (aro) =>
        aro.aroId ===
          surface.subjectRef.id &&
        aro.digest ===
          surface.subjectRef.digest,
    ) || null;
  }
  if (
    surface.objectClass ===
      "aro_coverage_witness"
  ) {
    return registry.coverageWitnesses.find(
      (witness) =>
        witness.coverageWitnessId ===
          surface.subjectRef.id &&
        witness.digest ===
          surface.subjectRef.digest,
    ) || null;
  }
  if (
    surface.objectClass ===
      "aro_current_target_comparison"
  ) {
    return registry
      .currentTargetComparisons.find(
        (comparison) =>
          comparison.comparisonId ===
            surface.subjectRef.id &&
          comparison.digest ===
            surface.subjectRef.digest,
      ) || null;
  }
  return null;
}

function aroNavigatorMetadata(
  surface,
  object,
) {
  if (
    surface.objectClass ===
      "aro_reconstruction_candidate"
  ) {
    const aro = object?.candidateAro;
    const reviewed =
      object?.evidenceReviewState ===
        "reviewed" &&
      object?.contradictionReviewState ===
        "reviewed";
    return [
      `${aro?.branches?.length || 0} branches`,
      object?.reconstructionMethod ===
        "semantic_target_definition"
        ? "target definition"
        : `${object?.evidenceRefs?.length || 0} evidence`,
      object?.lifecycle === "admitted"
        ? "admitted lineage"
        : reviewed
          ? "reviewed"
          : "review required",
    ];
  }
  if (
    surface.objectClass ===
      "abstract_reasoning_object"
  ) {
    return [
      `${object?.branches?.length || 0} branches`,
      object?.posture || "current",
      "canonical",
    ];
  }
  if (
    surface.objectClass ===
      "aro_coverage_witness"
  ) {
    return [
      `${object?.branchCoverage?.length || 0} branches`,
      `${object?.gapBranchRefs?.length || 0} gaps`,
      "coverage witness",
    ];
  }
  if (
    surface.objectClass ===
      "aro_current_target_comparison"
  ) {
    return [
      `${object?.sharedBranchKeys?.length || 0} shared`,
      `${object?.targetOnlyBranchRefs?.length || 0} target-only`,
      `${object?.conflictPairs?.length || 0} conflicts`,
    ];
  }
  return [
    surface.surfaceState,
  ];
}

function focusAroSurface(
  surface,
  options = {},
) {
  if (!surface) return;
  state.selectedSemanticSurfaceId =
    surface.semanticObjectSurfaceId;
  state.selectedAroSubjectId =
    surface.subjectRef.id;
  state.selectedAroObjectClass =
    surface.objectClass;
  state.activeInspector = "aros";
  render();
  if (
    options.moveFocus !== false
  ) {
    elements.aroFocusedObject
      .scrollTop = 0;
    elements.aroFocusedObject.focus({
      preventScroll:
        options.reveal !== true,
    });
  }
}

function aroNavigatorEntry(
  surface,
  focusedSurface,
) {
  const object =
    aroObjectForSurface(surface);
  const selected =
    surface.semanticObjectSurfaceId ===
      focusedSurface
        ?.semanticObjectSurfaceId;
  const entry = textElement(
    "button",
    `aro-object-nav-entry ${
      selected ? "selected" : ""
    }`,
    "",
  );
  entry.type = "button";
  entry.dataset.semanticSurfaceId =
    surface.semanticObjectSurfaceId;
  entry.dataset.subjectId =
    surface.subjectRef.id;
  entry.dataset.objectClass =
    surface.objectClass;
  entry.dataset.surfaceState =
    surface.surfaceState;
  entry.setAttribute(
    "aria-pressed",
    String(selected),
  );
  entry.setAttribute(
    "aria-controls",
    "aroFocusedObject",
  );
  const heading = textElement(
    "span",
    "aro-object-nav-heading",
    "",
  );
  heading.append(
    textElement(
      "strong",
      "",
      surface.compactProjection?.title ||
        surface.semanticIdentity,
    ),
    textElement(
      "small",
      "",
      surface.surfaceState,
    ),
  );
  entry.append(
    heading,
    textElement(
      "span",
      "aro-object-nav-summary",
      surface.summary,
    ),
  );
  const metadata = textElement(
    "span",
    "aro-object-nav-metadata",
    "",
  );
  for (
    const value of
      aroNavigatorMetadata(
        surface,
        object,
      )
  ) {
    metadata.append(
      textElement(
        "small",
        "",
        value,
      ),
    );
  }
  entry.append(metadata);
  entry.addEventListener(
    "click",
    () => focusAroSurface(surface),
  );
  return entry;
}

function renderAroNavigatorSection(
  container,
  title,
  surfaces,
  focusedSurface,
  emptyMessage = "",
) {
  clear(container);
  container.hidden =
    !surfaces.length &&
    !emptyMessage;
  container.append(
    textElement(
      "h4",
      "inspector-section-title",
      title,
    ),
  );
  if (!surfaces.length) {
    container.append(
      textElement(
        "p",
        "aro-navigator-empty",
        emptyMessage,
      ),
    );
    return;
  }
  for (const surface of surfaces) {
    container.append(
      aroNavigatorEntry(
        surface,
        focusedSurface,
      ),
    );
  }
}

function aroTreeMorph(aro) {
  const tree = textElement(
    "div",
    "aro-tree-morph",
    "",
  );
  tree.append(
    textElement(
      "span",
      "inspector-object-kind",
      "Intensional branch tree",
    ),
  );
  const branchById = new Map(
    (aro?.branches || []).map((branch) => [
      branch.branchId,
      branch,
    ]),
  );
  const depthFor = (branch) => {
    let depth = 0;
    let current = branch;
    const seen = new Set();
    while (
      current?.parentBranchRef?.id &&
      branchById.has(
        current.parentBranchRef.id,
      ) &&
      !seen.has(
        current.parentBranchRef.id,
      )
    ) {
      seen.add(
        current.parentBranchRef.id,
      );
      depth += 1;
      current = branchById.get(
        current.parentBranchRef.id,
      );
    }
    return depth;
  };
  for (const branch of aro?.branches || []) {
    const node = textElement(
      "div",
      `aro-tree-node ${branch.modality} ${branch.semanticState}`,
      "",
    );
    node.style.setProperty(
      "--aro-depth",
      String(depthFor(branch)),
    );
    node.dataset.branchId =
      branch.branchId;
    node.append(
      textElement(
        "span",
        "aro-tree-connector",
        branch.modality ===
          "counterfactual"
          ? "◇"
          : "●",
      ),
      textElement(
        "strong",
        "",
        branch.branchKey,
      ),
      textElement(
        "span",
        "",
        branch.statement,
      ),
      textElement(
        "small",
        "",
        `${branch.modality} · ${branch.semanticState}`,
      ),
    );
    tree.append(node);
  }
  return tree;
}

function aroCoverageMorph(witness) {
  const graph = textElement(
    "div",
    "aro-coverage-morph",
    "",
  );
  graph.append(
    textElement(
      "span",
      "inspector-object-kind",
      "Branch → realization coverage",
    ),
  );
  for (
    const entry of
      witness?.branchCoverage || []
  ) {
    const row = textElement(
      "div",
      `aro-coverage-edge ${entry.coverageState}`,
      "",
    );
    row.dataset.branchId =
      entry.branchRef.id;
    row.append(
      textElement(
        "strong",
        "aro-coverage-branch",
        shortId(entry.branchRef.id),
      ),
      textElement(
        "span",
        "aro-coverage-line",
        "→",
      ),
      textElement(
        "span",
        "aro-coverage-binding",
        entry.realizationBindingRefs.length
          ? `${entry.realizationBindingRefs.length} binding${
              entry.realizationBindingRefs.length === 1
                ? ""
                : "s"
            }`
          : "no realization",
      ),
      textElement(
        "small",
        "",
        entry.coverageState,
      ),
    );
    graph.append(row);
  }
  return graph;
}

function aroComparisonMorph(
  comparison,
) {
  const comparisonView = textElement(
    "div",
    "aro-comparison-morph",
    "",
  );
  comparisonView.append(
    textElement(
      "span",
      "inspector-object-kind",
      "Current / target semantic delta",
    ),
  );
  const columns = textElement(
    "div",
    "aro-comparison-columns",
    "",
  );
  const column = (
    label,
    refs,
    className,
  ) => {
    const region = textElement(
      "section",
      `aro-comparison-column ${className}`,
      "",
    );
    region.append(
      textElement("strong", "", label),
    );
    if (!refs.length) {
      region.append(
        textElement(
          "span",
          "",
          "No exclusive branches",
        ),
      );
    }
    for (const ref of refs) {
      region.append(
        textElement(
          "span",
          "",
          shortId(ref.id),
        ),
      );
    }
    return region;
  };
  columns.append(
    column(
      "Current only",
      comparison
        ?.currentOnlyBranchRefs || [],
      "current",
    ),
    column(
      "Shared",
      (comparison?.sharedBranchKeys || [])
        .map((branchKey) => ({
          id: branchKey,
        })),
      "shared",
    ),
    column(
      "Target only",
      comparison
        ?.targetOnlyBranchRefs || [],
      "target",
    ),
  );
  comparisonView.append(columns);
  if (comparison?.conflictPairs?.length) {
    const conflicts = textElement(
      "div",
      "aro-comparison-conflicts",
      "",
    );
    conflicts.append(
      textElement(
        "strong",
        "",
        "Shared-branch conflicts",
      ),
    );
    for (
      const conflict of
        comparison.conflictPairs
    ) {
      conflicts.append(
        textElement(
          "span",
          "",
          `${conflict.branchKey} · ${conflict.distinctions.join(", ")}`,
        ),
      );
    }
    comparisonView.append(conflicts);
  }
  return comparisonView;
}

function aroCandidateEvidence(
  candidate,
) {
  const details = textElement(
    "details",
    "aro-candidate-evidence",
    "",
  );
  details.open =
    candidate.evidenceReviewState !==
      "reviewed";
  details.append(
    textElement(
      "summary",
      "",
      `Exact evidence ${candidate.evidenceRefs.length} · contradictions ${candidate.contradictionRefs.length}`,
    ),
  );
  const evidence = textElement(
    "div",
    "aro-ref-list",
    "",
  );
  for (const ref of candidate.evidenceRefs) {
    evidence.append(
      textElement(
        "span",
        "",
        `evidence · ${ref.kind} · ${shortId(ref.id)}`,
      ),
    );
  }
  if (!candidate.contradictionRefs.length) {
    evidence.append(
      textElement(
        "span",
        "aro-no-contradiction",
        "contradiction set is empty and still requires review",
      ),
    );
  }
  for (
    const ref of
      candidate.contradictionRefs
  ) {
    evidence.append(
      textElement(
        "span",
        "aro-contradiction-ref",
        `contradiction · ${ref.kind} · ${shortId(ref.id)}`,
      ),
    );
  }
  details.append(evidence);
  return details;
}

function aroTargetDefinitionProvenance(
  candidate,
) {
  const run = (
    aroRegistryProjection()
      ?.targetDefinitionRuns || []
  ).find((entry) =>
    entry.candidateRef?.id ===
      candidate.candidateId);
  if (!run) return null;
  const details = textElement(
    "details",
    "aro-target-provenance",
    "",
  );
  details.open = true;
  details.append(
    textElement(
      "summary",
      "",
      "User target intent and semantic discharge",
    ),
  );
  const body = textElement(
    "div",
    "aro-target-provenance-body",
    "",
  );
  body.append(
    textElement(
      "span",
      "inspector-object-kind",
      "Target intent",
    ),
    textElement(
      "p",
      "",
      run.targetIntent,
    ),
  );
  if (run.definitionRationale) {
    body.append(
      textElement(
        "span",
        "inspector-object-kind",
        "Definition rationale",
      ),
      textElement(
        "p",
        "",
        run.definitionRationale,
      ),
    );
  }
  if (run.assumptions.length) {
    body.append(
      textElement(
        "span",
        "inspector-object-kind",
        "Assumptions",
      ),
      ...run.assumptions.map(
        (entry) =>
          textElement(
            "p",
            "",
            entry,
          )),
    );
  }
  if (run.unresolvedQuestions.length) {
    body.append(
      textElement(
        "span",
        "inspector-object-kind",
        "Unresolved questions",
      ),
      ...run.unresolvedQuestions.map(
        (entry) =>
          textElement(
            "p",
            "",
            entry,
          )),
    );
  }
  details.append(body);
  return details;
}

async function defineAroTarget(
  currentAro,
  surface,
  targetIntent,
  retry = false,
) {
  const binding =
    semanticRegionBindingForSurface(
      surface,
    );
  const value =
    String(targetIntent || "").trim();
  if (
    !binding ||
    !bridge
      ?.defineWorldManagerAroTarget
  ) {
    showToast(
      "The exact current ARO region is not bound to the target-definition reasoner.",
      "error",
    );
    return;
  }
  if (!value) {
    showToast(
      "Describe the desired target posture first.",
      "error",
    );
    return;
  }
  const pendingKey =
    `aro-target:${currentAro.aroId}`;
  state.pendingDecisionIds.add(
    pendingKey,
  );
  renderAroInspector();
  try {
    const result =
      await bridge
        .defineWorldManagerAroTarget(
          currentAro.projectId,
          currentAro.aroId,
          currentAro.digest,
          value,
          {
            kind:
              "semantic_region_binding",
            id:
              binding
                .semanticRegionBindingId,
            digest: binding.digest,
          },
          retry,
        );
    applyProjection(
      result?.projection || result,
    );
    const candidateRef =
      result?.receipt?.candidateRef;
    if (candidateRef) {
      state.aroTargetComposerOpen.delete(
        currentAro.aroId,
      );
      const candidateSurface =
        (
          semanticSurfaceProjection()
            ?.objectSurfaces || []
        ).find((entry) =>
          entry.objectClass ===
            "aro_reconstruction_candidate" &&
          entry.subjectRef.id ===
            candidateRef.id &&
          entry.subjectRef.digest ===
            candidateRef.digest);
      if (candidateSurface) {
        focusAroSurface(
          candidateSurface,
          {
            moveFocus: false,
          },
        );
      }
    }
    showToast(
      result?.receipt?.state ===
        "completed"
        ? "Provisional target posture defined. Review and admission are still required."
        : `Target definition is ${String(
            result?.receipt?.state ||
              "running",
          ).replace(/_/g, " ")}.`,
    );
  } catch (error) {
    showToast(
      error?.message ||
        "ARO target definition failed.",
      "error",
    );
    await refresh();
  } finally {
    state.pendingDecisionIds.delete(
      pendingKey,
    );
    render();
  }
}

function aroTargetDefinitionWorkbench(
  currentAro,
  surface,
) {
  const registry =
    aroRegistryProjection();
  const matchingCanonicalTarget =
    registry?.canonicalAros.find(
      (aro) =>
        aro.projectId ===
          currentAro.projectId &&
        aro.conceptKey ===
          currentAro.conceptKey &&
        aro.posture === "target");
  const matchingCandidate =
    registry?.candidates.find(
      (candidate) =>
        candidate.lifecycle ===
          "candidate" &&
        candidate.reconstructionMethod ===
          "semantic_target_definition" &&
        candidate.candidateAro
          ?.projectId ===
          currentAro.projectId &&
        candidate.candidateAro
          ?.conceptKey ===
          currentAro.conceptKey &&
        candidate.candidateAro
          ?.posture === "target" &&
        candidate.candidateAro
          ?.counterpartRef?.id ===
          currentAro.aroId &&
        candidate.candidateAro
          ?.counterpartRef?.digest ===
          currentAro.digest);
  const runs = (
    registry?.targetDefinitionRuns || []
  ).filter((run) =>
    run.currentAroRef?.id ===
      currentAro.aroId &&
    run.currentAroRef?.digest ===
      currentAro.digest);
  const latestRun = runs[0] || null;
  const revisionComposerOpen =
    state.aroTargetComposerOpen.has(
      currentAro.aroId,
    );
  const pendingKey =
    `aro-target:${currentAro.aroId}`;
  const pending =
    state.pendingDecisionIds.has(
      pendingKey,
    ) ||
    ["scheduled", "running"].includes(
      latestRun?.state,
    );
  const lane = textElement(
    "section",
    `aro-target-workbench ${
      latestRun?.state || "idle"
    }`,
    "",
  );
  const heading = textElement(
    "div",
    "aro-target-heading",
    "",
  );
  const copy = textElement(
    "div",
    "",
    "",
  );
  copy.append(
    textElement(
      "span",
      "inspector-object-kind",
      "Current → target bridge",
    ),
    textElement(
      "strong",
      "",
      matchingCanonicalTarget
        ? "Target posture admitted"
        : matchingCandidate
          ? "Target candidate awaits governance"
          : "Define the desired posture",
    ),
  );
  heading.append(
    copy,
    textElement(
      "span",
      "inspector-object-state",
      matchingCanonicalTarget
        ? "comparison ready"
        : matchingCandidate
          ? "review required"
          : latestRun?.state ||
            "intent required",
    ),
  );
  lane.append(heading);
  if (
    matchingCanonicalTarget &&
    !revisionComposerOpen &&
    !matchingCandidate
  ) {
    lane.append(
      textElement(
        "p",
        "inspector-object-summary",
        "A canonical target exists for this exact project and concept. The derived current/target comparison is available in the navigator.",
      ),
    );
    const revise = textElement(
      "button",
      "evidence-button",
      "Revise target posture",
    );
    revise.type = "button";
    revise.addEventListener(
      "click",
      () => {
        state.aroTargetComposerOpen.add(
          currentAro.aroId,
        );
        renderAroInspector();
        globalThis.requestAnimationFrame(
          () =>
            elements.aroFocusedObject
              .querySelector(
                ".aro-target-intent",
              )
              ?.focus(),
        );
      },
    );
    lane.append(revise);
    return lane;
  }
  if (matchingCandidate) {
    lane.append(
      textElement(
        "p",
        "inspector-object-summary",
        "The semantic reasoner produced a provisional target. Inspect its evidence and intensional branches, then use the existing review and admission gates.",
      ),
    );
    const candidateSurface = (
      semanticSurfaceProjection()
        ?.objectSurfaces || []
    ).find((entry) =>
      entry.objectClass ===
        "aro_reconstruction_candidate" &&
      entry.subjectRef.id ===
        matchingCandidate.candidateId &&
      entry.subjectRef.digest ===
        matchingCandidate.digest);
    const inspect = textElement(
      "button",
      "evidence-button",
      "Inspect target candidate",
    );
    inspect.type = "button";
    inspect.disabled =
      !candidateSurface;
    inspect.addEventListener(
      "click",
      () =>
        focusAroSurface(
          candidateSurface,
        ),
    );
    lane.append(inspect);
    return lane;
  }
  const draftKey = currentAro.aroId;
  const initialDraft =
    state.aroTargetDrafts.get(
      draftKey,
    ) ||
    latestRun?.targetIntent ||
    "";
  const textarea = textElement(
    "textarea",
    "aro-target-intent",
    "",
  );
  textarea.rows = 5;
  textarea.placeholder =
    "Describe what this concept should become, including important edges, alternatives, or counterfactuals.";
  textarea.value = initialDraft;
  textarea.disabled = pending;
  textarea.addEventListener(
    "input",
    () => {
      state.aroTargetDrafts.set(
        draftKey,
        textarea.value,
      );
    },
  );
  const submit = textElement(
    "button",
    "greenlight-button",
    pending
      ? "Defining target posture…"
      : latestRun?.retryable
        ? "Retry exact target definition"
        : matchingCanonicalTarget
          ? "Draft target revision"
          : "Draft target posture",
  );
  submit.type = "button";
  submit.disabled =
    pending ||
    !registry?.targetDefinitionAvailable;
  submit.addEventListener(
    "click",
    () =>
      defineAroTarget(
        currentAro,
        surface,
        textarea.value,
        latestRun?.retryable === true,
      ),
  );
  lane.append(
    textElement(
      "p",
      "inspector-object-summary",
      latestRun?.error?.message ||
        (
          matchingCanonicalTarget
            ? "Describe a revised desired posture. Admission will create a new canonical target revision while preserving the existing target and comparison lineage."
            : "Your free-form intent is bound to this exact canonical current ARO. The semantic reasoner may define only a provisional target for the same concept."
        ),
    ),
    textarea,
    submit,
    textElement(
      "p",
      "decision-transition-boundary",
      "No source inspection, realization binding, canonical admission, mutation contract, worker launch, or workspace effect is authorized here.",
    ),
  );
  return lane;
}

async function reviewAroCandidate(
  candidate,
  surface,
) {
  const binding =
    semanticRegionBindingForSurface(
      surface,
    );
  if (
    !binding ||
    !bridge
      ?.reviewWorldManagerAroReconstruction
  ) {
    showToast(
      "The exact ARO region binding is unavailable.",
      "error",
    );
    return;
  }
  state.pendingDecisionIds.add(
    candidate.candidateId,
  );
  renderAroInspector();
  try {
    const result =
      await bridge
        .reviewWorldManagerAroReconstruction(
          candidate.candidateId,
          candidate.digest,
          candidate.candidateRevision,
          {
            kind:
              "semantic_region_binding",
            id:
              binding
                .semanticRegionBindingId,
            digest: binding.digest,
          },
          "operator",
        );
    applyProjection(
      result?.projection || result,
    );
    showToast(
      "Evidence and contradiction review recorded. Semantic truth was not certified.",
    );
  } catch (error) {
    showToast(
      error?.message ||
        "ARO reconstruction review failed.",
      "error",
    );
    await refresh();
  } finally {
    state.pendingDecisionIds.delete(
      candidate.candidateId,
    );
    render();
  }
}

async function admitAroCandidate(
  candidate,
  surface,
) {
  const binding =
    semanticRegionBindingForSurface(
      surface,
    );
  if (
    !binding ||
    !bridge
      ?.admitWorldManagerAroReconstruction
  ) {
    showToast(
      "The exact ARO region binding is unavailable.",
      "error",
    );
    return;
  }
  state.pendingDecisionIds.add(
    candidate.candidateId,
  );
  renderAroInspector();
  try {
    const result =
      await bridge
        .admitWorldManagerAroReconstruction(
          candidate.candidateId,
          candidate.digest,
          candidate.candidateRevision,
          {
            kind:
              "semantic_region_binding",
            id:
              binding
                .semanticRegionBindingId,
            digest: binding.digest,
          },
          "operator",
        );
    applyProjection(
      result?.projection || result,
    );
    showToast(
      candidate.reconstructionMethod ===
        "semantic_target_definition"
        ? "Target ARO admitted. Its exact current/target comparison is now derived; no code was changed."
        : "Reconstructed ARO admitted to the semantic registry. No code was changed.",
    );
  } catch (error) {
    showToast(
      error?.message ||
        "ARO admission failed.",
      "error",
    );
    await refresh();
  } finally {
    state.pendingDecisionIds.delete(
      candidate.candidateId,
    );
    render();
  }
}

async function compileAroMutationContract(
  comparison,
  surface,
  run = null,
) {
  const binding =
    semanticRegionBindingForSurface(
      surface,
    );
  if (
    !binding ||
    !bridge
      ?.compileWorldManagerAroMutationContract
  ) {
    showToast(
      "The exact comparison region is not bound to the mutation-contract compiler.",
      "error",
    );
    return;
  }
  const retry =
    Boolean(run?.retryable);
  const pendingKey =
    `aro-mutation:${comparison.comparisonId}`;
  state.pendingDecisionIds.add(
    pendingKey,
  );
  renderAroInspector();
  try {
    const result =
      await bridge
        .compileWorldManagerAroMutationContract(
          comparison.projectId,
          comparison.comparisonId,
          comparison.digest,
          {
            kind:
              "semantic_region_binding",
            id:
              binding
                .semanticRegionBindingId,
            digest: binding.digest,
          },
          retry,
          retry
            ? run.runRef.digest
            : "",
        );
    applyProjection(
      result?.projection || result,
    );
    showToast(
      result?.receipt?.state ===
        "completed"
        ? "Provisional ARO mutation contract compiled. No worker or source effect occurred."
        : `Mutation-contract compilation is ${String(
            result?.receipt?.state ||
              "running",
          ).replace(/_/g, " ")}.`,
    );
  } catch (error) {
    showToast(
      error?.message ||
        "ARO mutation-contract compilation failed.",
      "error",
    );
    await refresh();
  } finally {
    state.pendingDecisionIds.delete(
      pendingKey,
    );
    render();
  }
}

async function mapAroRealizationContext(
  contract,
  comparison,
  surface,
  run = null,
) {
  const binding =
    semanticRegionBindingForSurface(
      surface,
    );
  if (
    !binding ||
    !bridge
      ?.mapWorldManagerAroRealizationContext
  ) {
    showToast(
      "The exact comparison region is not bound to the realization-context mapper.",
      "error",
    );
    return;
  }
  const retry = Boolean(run?.retryable);
  const pendingKey =
    `aro-realization:${contract.contractRef.id}`;
  state.pendingDecisionIds.add(
    pendingKey,
  );
  renderAroInspector();
  try {
    const result =
      await bridge
        .mapWorldManagerAroRealizationContext(
          contract.projectId,
          contract.contractRef.id,
          contract.contractRef.digest,
          {
            kind:
              "semantic_region_binding",
            id:
              binding
                .semanticRegionBindingId,
            digest: binding.digest,
          },
          retry,
          retry
            ? run.runRef.digest
            : "",
        );
    applyProjection(
      result?.projection || result,
    );
    showToast(
      result?.receipt?.state ===
        "completed"
        ? "Bounded realization context imported and mapped. No worker or workspace mutation occurred."
        : `Realization mapping is ${String(
            result?.receipt?.state ||
              "running",
          ).replace(/_/g, " ")}.`,
    );
  } catch (error) {
    showToast(
      error?.message ||
        "ARO realization mapping failed.",
      "error",
    );
    await refresh();
  } finally {
    state.pendingDecisionIds.delete(
      pendingKey,
    );
    render();
  }
}

function exactSemanticRegionRef(
  surface,
) {
  const binding =
    semanticRegionBindingForSurface(
      surface,
    );
  return binding
    ? {
        kind:
          "semantic_region_binding",
        id:
          binding.semanticRegionBindingId,
        digest: binding.digest,
      }
    : null;
}

async function prepareAroWorker(
  contract,
  contextImport,
  witness,
  surface,
) {
  const semanticRegionBindingRef =
    exactSemanticRegionRef(surface);
  if (
    !semanticRegionBindingRef ||
    !bridge
      ?.prepareWorldManagerAroWorker
  ) {
    showToast(
      "The exact comparison region is not bound to the worker-constitution compiler.",
      "error",
    );
    return;
  }
  const pendingKey =
    `aro-worker-review:${contract.contractRef.id}`;
  state.pendingDecisionIds.add(
    pendingKey,
  );
  renderAroInspector();
  try {
    const result =
      await bridge
        .prepareWorldManagerAroWorker({
          projectId:
            contract.projectId,
          contractId:
            contract.contractRef.id,
          contractDigest:
            contract.contractRef.digest,
          contextImportId:
            contextImport
              .contextImportRef.id,
          contextImportDigest:
            contextImport
              .contextImportRef.digest,
          mappingWitnessId:
            witness.mappingWitnessRef.id,
          mappingWitnessDigest:
            witness.mappingWitnessRef
              .digest,
          semanticRegionBindingRef,
          actorId: "operator",
        });
    applyProjection(
      result?.projection || result,
    );
    showToast(
      result?.receipt?.state ===
        "ready_for_authorization"
        ? "Worker constitution compiled from reviewed evidence. Provider start still requires explicit authorization."
        : "Worker constitution is visibly blocked. No provider turn or workspace effect occurred.",
    );
  } catch (error) {
    showToast(
      error?.message ||
        "ARO worker constitution preparation failed.",
      "error",
    );
    await refresh();
  } finally {
    state.pendingDecisionIds.delete(
      pendingKey,
    );
    render();
  }
}

async function authorizeAroWorker(
  contract,
  contextImport,
  witness,
  constitution,
  surface,
) {
  const semanticRegionBindingRef =
    exactSemanticRegionRef(surface);
  if (
    !semanticRegionBindingRef ||
    !bridge
      ?.authorizeWorldManagerAroWorker
  ) {
    showToast(
      "The exact worker constitution cannot be authorized from this surface.",
      "error",
    );
    return;
  }
  const pendingKey =
    `aro-worker-authorize:${constitution.constitutionRef.id}`;
  const operatorActionId =
    globalThis.crypto?.randomUUID?.() ||
    `wm_operator_${Date.now()}`;
  state.pendingDecisionIds.add(
    pendingKey,
  );
  renderAroInspector();
  try {
    const result =
      await bridge
        .authorizeWorldManagerAroWorker({
          projectId:
            contract.projectId,
          contractId:
            contract.contractRef.id,
          contractDigest:
            contract.contractRef.digest,
          contextImportId:
            contextImport
              .contextImportRef.id,
          contextImportDigest:
            contextImport
              .contextImportRef.digest,
          mappingWitnessId:
            witness.mappingWitnessRef.id,
          mappingWitnessDigest:
            witness.mappingWitnessRef
              .digest,
          constitutionId:
            constitution
              .constitutionRef.id,
          constitutionDigest:
            constitution
              .constitutionRef.digest,
          semanticRegionBindingRef,
          operatorActionId,
          actorId: "operator",
        });
    applyProjection(
      result?.projection || result,
    );
    showToast(
      result?.receipt?.state ===
        "handed_off"
        ? "One bounded Direct worker turn started. Tool effects remain individually gated."
        : "Worker handoff reached a visible terminal failure. Its single-use authorization will not be replayed.",
      result?.receipt?.state ===
        "handed_off"
        ? "success"
        : "error",
    );
  } catch (error) {
    showToast(
      error?.message ||
        "ARO worker authorization failed before handoff.",
      "error",
    );
    await refresh();
  } finally {
    state.pendingDecisionIds.delete(
      pendingKey,
    );
    render();
  }
}

function aroWorkerDecisionResult(
  request,
  decision,
) {
  const params =
    request.params || {};
  const common = {
    decision,
    actionTokenId:
      params.actionTokens?.[decision] ||
      "",
  };
  const decisionId =
    `${request.key}:${decision}`;
  if (
    request.method ===
    "direct/tool/patchApply/requestApproval"
  ) {
    return {
      ...common,
      clientPatchDecisionId:
        decisionId,
    };
  }
  if (
    request.method ===
    "direct/tool/command/requestApproval"
  ) {
    return {
      ...common,
      clientCommandDecisionId:
        decisionId,
    };
  }
  return {
    ...common,
    clientToolDecisionId:
      decisionId,
  };
}

async function respondAroWorkerRequest(
  request,
  decision,
) {
  if (
    !request?.key ||
    !bridge
      ?.respondWorldManagerAroWorkerRequest
  ) {
    return;
  }
  state.pendingAroWorkerRequests.add(
    request.key,
  );
  renderAroInspector();
  try {
    const response =
      await bridge
        .respondWorldManagerAroWorkerRequest(
          request.key,
          aroWorkerDecisionResult(
            request,
            decision,
          ),
        );
    if (response?.request) {
      state.aroWorkerRequests.set(
        response.request.key,
        response.request,
      );
    }
  } catch (error) {
    showToast(
      error?.message ||
        "Worker tool decision failed.",
      "error",
    );
  } finally {
    state.pendingAroWorkerRequests.delete(
      request.key,
    );
    renderAroInspector();
  }
}

function aroWorkerRequestCard(
  request,
) {
  const card = textElement(
    "article",
    `aro-worker-request ${
      request.riskCategory ||
      "unknown"
    } ${request.status || "pending"}`,
    "",
  );
  card.dataset.requestKey =
    request.key;
  const heading = textElement(
    "div",
    "aro-worker-request-heading",
    "",
  );
  heading.append(
    textElement(
      "strong",
      "",
      request.title ||
        "Worker tool request",
    ),
    textElement(
      "span",
      "inspector-object-state",
      request.status || "pending",
    ),
  );
  const params =
    request.params || {};
  const details = textElement(
    "div",
    "aro-worker-request-details",
    "",
  );
  const lines = [];
  if (
    request.method ===
    "direct/tool/readOnly/requestApproval"
  ) {
    lines.push(
      ["tool", params.tool || "read_file"],
      ["path", params.relPath || "unknown"],
      [
        "limit",
        `${params.maxReadFileBytes || 0} bytes`,
      ],
    );
  } else if (
    request.method ===
    "direct/tool/patchApply/requestApproval"
  ) {
    lines.push(
      ["tool", params.tool || "apply_patch"],
      [
        "files",
        (params.files || [])
          .map((file) =>
            `${file.operation || "update"} ${file.path || "unknown"}`)
          .join("\n") ||
          "none",
      ],
      [
        "preview",
        params.preview?.text ||
          "Patch preview unavailable.",
      ],
    );
  } else if (
    request.method ===
    "direct/tool/command/requestApproval"
  ) {
    lines.push(
      ["tool", params.tool || "run_command"],
      [
        "command",
        params.displayCommand ||
          (
            Array.isArray(
              params.command,
            )
              ? params.command.join(" ")
              : params.command
          ) ||
          "unknown",
      ],
      [
        "cwd",
        params.cwdRelPath || ".",
      ],
      [
        "writes",
        params.workspaceWritePolicy ||
          "possible",
      ],
    );
  } else {
    lines.push(
      ["method", request.method],
      [
        "summary",
        request.summary || "",
      ],
    );
  }
  for (const [label, value] of lines) {
    const row = textElement(
      "div",
      "aro-worker-request-line",
      "",
    );
    row.append(
      textElement(
        "small",
        "",
        label,
      ),
      textElement(
        "pre",
        "",
        String(value || ""),
      ),
    );
    details.append(row);
  }
  card.append(heading, details);
  if (request.status === "pending") {
    const actions = textElement(
      "div",
      "aro-worker-request-actions",
      "",
    );
    const pending =
      state.pendingAroWorkerRequests
        .has(request.key);
    for (
      const [label, decision, className]
      of [
        [
          request.riskCategory ===
          "readOnly"
            ? "Approve read"
            : request.riskCategory ===
                "command"
              ? "Approve command"
              : "Approve patch",
          "approve",
          "greenlight-button",
        ],
        [
          "Decline",
          "decline",
          "evidence-button",
        ],
        [
          "Cancel turn",
          "cancel",
          "evidence-button",
        ],
      ]
    ) {
      const button = textElement(
        "button",
        className,
        pending
          ? "Submitting…"
          : label,
      );
      button.type = "button";
      button.disabled = pending;
      button.addEventListener(
        "click",
        () =>
          respondAroWorkerRequest(
            request,
            decision,
          ),
      );
      actions.append(button);
    }
    card.append(actions);
  }
  return card;
}

async function captureAroExecutionEvidence(
  run,
  surface,
) {
  const semanticRegionBindingRef =
    exactSemanticRegionRef(surface);
  if (
    !semanticRegionBindingRef ||
    !run?.runRef ||
    !bridge
      ?.captureWorldManagerAroExecutionEvidence
  ) {
    showToast(
      "The exact worker lineage cannot be observed from this semantic region.",
      "error",
    );
    return;
  }
  const pendingKey =
    `aro-execution-evidence:${run.runRef.id}`;
  if (
    state.pendingDecisionIds.has(
      pendingKey,
    )
  ) {
    return;
  }
  state.pendingDecisionIds.add(
    pendingKey,
  );
  renderAroInspector();
  try {
    const result =
      await bridge
        .captureWorldManagerAroExecutionEvidence({
          projectId: run.projectId,
          handoffRunId:
            run.runRef.id,
          handoffRunDigest:
            run.runRef.digest,
          observationRequestId:
            globalThis.crypto
              ?.randomUUID?.() ||
            `wm_observation_${Date.now()}`,
          semanticRegionBindingRef,
          actorId: "operator",
        });
    applyProjection(
      result?.projection || result,
    );
    const receipt =
      result?.receipt || {};
    showToast(
      receipt.state === "acquired"
        ? "Terminal worker evidence acquired. Verification and semantic closure remain deferred."
        : receipt.state ===
            "observing"
          ? "Current worker evidence observed. The active turn can be refreshed as it progresses."
          : receipt.error?.message ||
            "Execution-evidence acquisition failed visibly.",
      receipt.state === "failed"
        ? "error"
        : "info",
    );
  } catch (error) {
    showToast(
      error?.message ||
        "Execution-evidence acquisition failed.",
      "error",
    );
    await refresh();
  } finally {
    state.pendingDecisionIds.delete(
      pendingKey,
    );
    render();
  }
}

function aroExecutionEvidenceWorkbench(
  run,
  surface,
) {
  const registry =
    aroRegistryProjection();
  const evidenceRun =
    registry
      ?.executionEvidenceRuns
      ?.find((entry) =>
        entry.handoffRunRef.id ===
          run.runRef.id &&
        entry.handoffRunRef.digest ===
          run.runRef.digest) ||
    null;
  const bundle =
    evidenceRun?.evidenceBundleRef
      ? registry
          ?.executionEvidenceBundles
          ?.find((entry) =>
            entry.evidenceBundleRef.id ===
              evidenceRun
                .evidenceBundleRef.id &&
            entry.evidenceBundleRef
              .digest ===
              evidenceRun
                .evidenceBundleRef
                .digest) ||
        null
      : registry
          ?.executionEvidenceBundles
          ?.find((entry) =>
            entry.handoffRunRef.id ===
              run.runRef.id &&
            entry.handoffRunRef
              .digest ===
              run.runRef.digest) ||
        null;
  const section = textElement(
    "section",
    `aro-execution-evidence-workbench ${
      evidenceRun?.state ||
      "not_observed"
    }`,
    "",
  );
  section.dataset.evidenceState =
    evidenceRun?.state ||
    "not_observed";
  section.dataset.workspaceMutation =
    String(
      bundle
        ?.workspaceMutationObserved ===
      true,
    );
  const header = textElement(
    "div",
    "aro-execution-evidence-heading",
    "",
  );
  const title = textElement(
    "div",
    "",
    "",
  );
  title.append(
    textElement(
      "span",
      "inspector-object-kind",
      "SC8.4 realization witness",
    ),
    textElement(
      "strong",
      "",
      bundle
        ? "Worker realization evidence"
        : "Evidence acquisition available",
    ),
  );
  header.append(
    title,
    textElement(
      "span",
      "inspector-object-state",
      evidenceRun?.state ||
        "not observed",
    ),
  );
  section.append(header);
  const pendingKey =
    `aro-execution-evidence:${run.runRef.id}`;
  const refreshButton =
    textElement(
      "button",
      "evidence-button aro-execution-evidence-refresh",
      state.pendingDecisionIds.has(
        pendingKey,
      )
        ? "Observing exact worker lineage…"
        : bundle
          ? "Refresh realization evidence"
          : "Acquire realization evidence",
    );
  refreshButton.type = "button";
  refreshButton.disabled =
    state.pendingDecisionIds.has(
      pendingKey,
    ) ||
    registry
      ?.executionEvidenceAvailable !==
      true;
  refreshButton.addEventListener(
    "click",
    () =>
      captureAroExecutionEvidence(
        run,
        surface,
      ),
  );
  if (!bundle) {
    section.append(
      textElement(
        "p",
        "inspector-object-summary",
        evidenceRun?.state === "failed"
          ? evidenceRun.error?.message ||
            "The read-only observation failed visibly."
          : "Observe the exact durable worker turn, its authorized tool results, workspace-effect summaries, and a fresh repository-after identity.",
      ),
      refreshButton,
      textElement(
        "p",
        "decision-transition-boundary",
        registry
          ?.executionEvidenceAvailable
          ? "This action reads existing runtime evidence only. It grants no tool, workspace, remote, canonical, verification, or closure authority."
          : "The runtime evidence or repository observation provider is unavailable. No fallback inference is authorized.",
      ),
    );
    return section;
  }
  const facts = textElement(
    "div",
    "aro-execution-evidence-facts",
    "",
  );
  for (
    const fact of [
      `turn · ${bundle.workerTurn.state}`,
      `${bundle.toolResults.length} tool result${
        bundle.toolResults.length === 1
          ? ""
          : "s"
      }`,
      `${bundle.workspaceEffects.reduce(
        (count, effect) =>
          count +
          Number(
            effect.changedPathCount ||
            0,
          ),
        0,
      )} changed path${
        bundle.workspaceEffects.reduce(
          (count, effect) =>
            count +
            Number(
              effect.changedPathCount ||
              0,
            ),
          0,
        ) === 1
          ? ""
          : "s"
      }`,
      bundle.ambiguityObserved
        ? "ambiguity visible"
        : "capture unambiguous",
      bundle.missingEvidenceKindCount
        ? `${bundle.missingEvidenceKindCount} evidence kind missing`
        : "required kinds present",
      "closure deferred",
    ]
  ) {
    facts.append(
      textElement(
        "span",
        "",
        fact,
      ),
    );
  }
  section.append(facts);
  const lenses = [
    ["turn", "Turn"],
    ["tools", "Tools & effects"],
    ["repository", "Repository"],
    ["coverage", "Coverage"],
  ];
  const activeLens =
    state
      .aroExecutionEvidenceLenses
      .get(run.runRef.id) ||
    "turn";
  const lensBar = textElement(
    "div",
    "aro-execution-evidence-lenses",
    "",
  );
  const panel = textElement(
    "div",
    "aro-execution-evidence-panel",
    "",
  );
  const setLens = (lens) => {
    state
      .aroExecutionEvidenceLenses
      .set(run.runRef.id, lens);
    renderAroInspector();
  };
  for (const [lens, label] of lenses) {
    const button = textElement(
      "button",
      lens === activeLens
        ? "active"
        : "",
      label,
    );
    button.type = "button";
    button.setAttribute(
      "aria-pressed",
      String(lens === activeLens),
    );
    button.addEventListener(
      "click",
      () => setLens(lens),
    );
    lensBar.append(button);
  }
  if (activeLens === "turn") {
    const turn =
      bundle.workerTurn;
    panel.append(
      textElement(
        "h5",
        "",
        `Worker turn · ${shortId(turn.workerTurnRef.id)}`,
      ),
      textElement(
        "p",
        "inspector-object-summary",
        turn.terminal
          ? `Terminal capture · ${turn.state}`
          : `Active capture · ${turn.state}. Refresh after additional tool decisions or provider continuation.`,
      ),
    );
    if (turn.finalOutputPresent) {
      panel.append(
        textElement(
          "pre",
          "aro-execution-final-output",
          turn.finalOutputPreview ||
            "Final output was recorded without a renderer-safe preview.",
        ),
      );
    } else {
      panel.append(
        textElement(
          "p",
          "inspector-object-summary",
          "No final assistant output is present in this capture.",
        ),
      );
    }
    panel.append(
      textElement(
        "p",
        "decision-transition-boundary",
        `${turn.unresolvedObligationCount} unresolved obligation${
          turn.unresolvedObligationCount ===
          1
            ? ""
            : "s"
        } · ${turn.continuationRequestCount} continuation record${
          turn.continuationRequestCount ===
          1
            ? ""
            : "s"
        }. Final output is evidence, not self-certification.`,
      ),
    );
  } else if (activeLens === "tools") {
    panel.append(
      textElement(
        "h5",
        "",
        "Authorized tool results and workspace effects",
      ),
    );
    if (!bundle.toolResults.length) {
      panel.append(
        textElement(
          "p",
          "inspector-object-summary",
          "No durable tool result has been recorded for this worker turn.",
        ),
      );
    }
    for (
      const tool of
        bundle.toolResults
    ) {
      const card = textElement(
        "article",
        "aro-execution-tool-result",
        "",
      );
      card.append(
        textElement(
          "strong",
          "",
          `${tool.tool} · ${tool.status}`,
        ),
        textElement(
          "small",
          "",
          tool.approvalWitnessPresent
            ? "authority-gated result"
            : "approval witness absent",
        ),
      );
      if (tool.relativePath) {
        card.append(
          textElement(
            "code",
            "",
            tool.relativePath,
          ),
        );
      }
      if (tool.files?.length) {
        card.append(
          textElement(
            "pre",
            "",
            tool.files
              .map((file) =>
                `${file.operation} ${file.relativePath}`)
              .join("\n"),
          ),
        );
      }
      if (tool.command) {
        card.append(
          textElement(
            "code",
            "",
            `${tool.command.displayCommand || "command"} · exit ${
              tool.command.exitCode ??
              "unknown"
            }`,
          ),
        );
      }
      panel.append(card);
    }
    for (
      const effect of
        bundle.workspaceEffects
    ) {
      const effectCard =
        textElement(
          "article",
          `aro-execution-workspace-effect ${
            effect.evidenceAmbiguous
              ? "ambiguous"
              : ""
          }`,
          "",
        );
      effectCard.append(
        textElement(
          "strong",
          "",
          `${effect.tool} workspace witness`,
        ),
        textElement(
          "p",
          "",
          `${effect.changedPathCount} changed · ${effect.omittedPathCount} omitted · policy ${effect.policyDecision}`,
        ),
      );
      if (
        effect.changedPathsPreview
          .length
      ) {
        effectCard.append(
          textElement(
            "pre",
            "",
            effect
              .changedPathsPreview
              .join("\n"),
          ),
        );
      }
      panel.append(effectCard);
    }
  } else if (
    activeLens === "repository"
  ) {
    const repository =
      bundle.repositoryAfterState;
    panel.append(
      textElement(
        "h5",
        "",
        "Repository before / after witness",
      ),
      textElement(
        "p",
        "inspector-object-summary",
        repository.repositoryChanged
          ? "The observed repository identity or selected source digests changed."
          : "No change was observed in the bounded repository identity and selected sources.",
      ),
    );
    const identity = textElement(
      "div",
      "aro-execution-repository-identities",
      "",
    );
    for (
      const [label, value] of [
        [
          "before",
          repository
            .beforeRepositoryIdentity,
        ],
        [
          "after",
          repository
            .afterRepositoryIdentity,
        ],
      ]
    ) {
      identity.append(
        textElement(
          "code",
          "",
          `${label} · ${
            value.branch || "detached"
          } · ${
            String(
              value.headOid || "unknown",
            ).slice(0, 12)
          }`,
        ),
      );
    }
    panel.append(identity);
    const paths = textElement(
      "div",
      "aro-execution-path-comparisons",
      "",
    );
    for (
      const entry of
        repository.pathComparisons
          .slice(0, 20)
    ) {
      const row = textElement(
        "div",
        entry.state,
        "",
      );
      row.append(
        textElement(
          "span",
          "",
          entry.relativePath,
        ),
        textElement(
          "strong",
          "",
          entry.state.replace(
            /_/g,
            " ",
          ),
        ),
      );
      paths.append(row);
    }
    panel.append(
      paths,
      textElement(
        "p",
        "decision-transition-boundary",
        repository
          .unattributedRepositoryDrift
          ? "Repository drift was observed without a corresponding recorded workspace-effect witness. Attribution is ambiguous."
          : `${repository.changedSelectedPathCount} changed · ${repository.unchangedSelectedPathCount} unchanged · ${repository.missingSelectedPathCount} missing after.`,
      ),
    );
  } else {
    panel.append(
      textElement(
        "h5",
        "",
        "Mechanical verification-evidence coverage",
      ),
    );
    if (
      !bundle
        .verificationCoverage.length
    ) {
      panel.append(
        textElement(
          "p",
          "inspector-object-summary",
          "The contract declared no explicit verification requirements.",
        ),
      );
    }
    for (
      const coverage of
        bundle.verificationCoverage
    ) {
      const card = textElement(
        "article",
        `aro-execution-coverage ${coverage.coverageStatus}`,
        "",
      );
      card.append(
        textElement(
          "strong",
          "",
          coverage.verificationKey,
        ),
        textElement(
          "span",
          "inspector-object-state",
          coverage.coverageStatus,
        ),
        textElement(
          "p",
          "",
          `required · ${coverage.requiredEvidenceKinds.join(", ") || "none"}`,
        ),
        textElement(
          "p",
          "",
          `observed · ${coverage.observedEvidenceKinds.join(", ") || "none"}`,
        ),
      );
      if (
        coverage.missingEvidenceKinds
          .length
      ) {
        card.append(
          textElement(
            "p",
            "aro-execution-missing",
            `missing · ${coverage.missingEvidenceKinds.join(", ")}`,
          ),
        );
      }
      panel.append(card);
    }
    panel.append(
      textElement(
        "p",
        "decision-transition-boundary",
        "Coverage checks only whether required evidence kinds are present. SC8.5 evaluates claims, preservation, semantic truth, and closure.",
      ),
    );
  }
  section.append(
    lensBar,
    panel,
    refreshButton,
    textElement(
      "p",
      "decision-transition-boundary",
      "SC8.4 observes effects already caused through separately authorized worker calls. It does not authorize a new effect or admit a result.",
    ),
  );
  return section;
}

async function verifyAroRealization(
  evidenceBundle,
  verificationRun,
  surface,
) {
  const semanticRegionBindingRef =
    exactSemanticRegionRef(surface);
  if (
    !semanticRegionBindingRef ||
    !evidenceBundle
      ?.evidenceBundleRef ||
    !bridge
      ?.verifyWorldManagerAroRealization
  ) {
    showToast(
      "The exact acquired evidence cannot be semantically verified from this region.",
      "error",
    );
    return;
  }
  const pendingKey =
    `aro-semantic-verification:${evidenceBundle.evidenceBundleRef.id}`;
  if (
    state.pendingDecisionIds.has(
      pendingKey,
    )
  ) {
    return;
  }
  state.pendingDecisionIds.add(
    pendingKey,
  );
  renderAroInspector();
  try {
    const retry =
      verificationRun?.retryable ===
      true;
    const result =
      await bridge
        .verifyWorldManagerAroRealization({
          projectId:
            evidenceBundle.projectId,
          evidenceBundleId:
            evidenceBundle
              .evidenceBundleRef.id,
          evidenceBundleDigest:
            evidenceBundle
              .evidenceBundleRef.digest,
          semanticRegionBindingRef,
          retry,
          expectedRunDigest:
            retry
              ? verificationRun
                  .runRef.digest
              : "",
          reasoningEffort: "medium",
          actorId: "operator",
        });
    applyProjection(
      result?.projection || result,
    );
    const receipt =
      result?.receipt || {};
    showToast(
      receipt.state === "completed"
        ? "Semantic assessment recorded. Closure remains a review candidate; canonical admission is unavailable."
        : receipt.error?.message ||
            "Semantic verification was remanded visibly.",
      receipt.state === "completed"
        ? "info"
        : "error",
    );
  } catch (error) {
    showToast(
      error?.message ||
        "Semantic verification failed.",
      "error",
    );
    await refresh();
  } finally {
    state.pendingDecisionIds.delete(
      pendingKey,
    );
    render();
  }
}

function focusVerificationDecision(
  decisionRef,
) {
  const entry =
    semanticSurfaceProjection()
      ?.decisionDock
      ?.entries
      ?.find((candidate) =>
        candidate.subjectRef?.id ===
          decisionRef.id);
  const surface = entry
    ? semanticSurfaceById(
        entry.surfaceRef.id,
      )
    : null;
  if (surface) {
    selectSemanticSurface(
      surface,
      "decisions",
    );
    return;
  }
  state.activeInspector = "decisions";
  render();
}

function aroSemanticAssessmentCard(
  entry,
  keyField,
) {
  const card = textElement(
    "article",
    `aro-semantic-assessment-card ${entry.status}`,
    "",
  );
  card.append(
    textElement(
      "strong",
      "",
      entry[keyField],
    ),
    textElement(
      "span",
      "inspector-object-state",
      entry.status,
    ),
    textElement(
      "p",
      "",
      entry.rationale,
    ),
  );
  const facts = [
    entry.evidenceKinds?.length
      ? `evidence · ${entry.evidenceKinds.join(", ")}`
      : "no evidence kind claimed",
    entry.synthesizedFromOmission
      ? "harness-synthesized omission"
      : entry.evidenceBindingState,
  ];
  card.append(
    textElement(
      "small",
      "",
      facts.join(" · "),
    ),
  );
  if (entry.blindspots?.length) {
    card.append(
      textElement(
        "p",
        "aro-semantic-blindspot",
        `Blindspots · ${entry.blindspots.join(" · ")}`,
      ),
    );
  }
  return card;
}

function aroSemanticVerificationWorkbench(
  run,
  surface,
) {
  const registry =
    aroRegistryProjection();
  const evidenceRun =
    registry
      ?.executionEvidenceRuns
      ?.find((entry) =>
        entry.handoffRunRef.id ===
          run.runRef.id &&
        entry.handoffRunRef.digest ===
          run.runRef.digest) ||
    null;
  const evidenceBundle =
    evidenceRun?.evidenceBundleRef
      ? registry
          ?.executionEvidenceBundles
          ?.find((entry) =>
            entry.evidenceBundleRef.id ===
              evidenceRun
                .evidenceBundleRef.id &&
            entry.evidenceBundleRef
              .digest ===
              evidenceRun
                .evidenceBundleRef
                .digest) ||
        null
      : null;
  if (
    !evidenceBundle ||
    evidenceBundle.captureState !==
      "acquired"
  ) {
    return null;
  }
  const verificationRun =
    registry
      ?.semanticVerificationRuns
      ?.find((entry) =>
        entry.evidenceBundleRef.id ===
          evidenceBundle
            .evidenceBundleRef.id) ||
    null;
  const assessment =
    verificationRun?.assessmentRef
      ? registry
          ?.semanticVerificationAssessments
          ?.find((entry) =>
            entry.assessmentRef.id ===
              verificationRun
                .assessmentRef.id &&
            entry.assessmentRef.digest ===
              verificationRun
                .assessmentRef.digest) ||
        null
      : null;
  const closureCandidate =
    verificationRun
      ?.closureCandidateRef
      ? registry
          ?.closureCandidates
          ?.find((entry) =>
            entry.closureCandidateRef.id ===
              verificationRun
                .closureCandidateRef.id &&
            entry.closureCandidateRef
              .digest ===
              verificationRun
                .closureCandidateRef
                .digest) ||
        null
      : null;
  const section = textElement(
    "section",
    `aro-semantic-verification-workbench ${
      verificationRun?.state ||
      "not_verified"
    }`,
    "",
  );
  section.dataset.verificationState =
    verificationRun?.state ||
    "not_verified";
  section.dataset.gateDisposition =
    closureCandidate
      ?.gateDisposition ||
    "unassessed";
  section.dataset.canonicalAdmission =
    "unavailable";
  const heading = textElement(
    "div",
    "aro-semantic-verification-heading",
    "",
  );
  const title = textElement(
    "div",
    "",
    "",
  );
  title.append(
    textElement(
      "span",
      "inspector-object-kind",
      "SC8.5 semantic verifier",
    ),
    textElement(
      "strong",
      "",
      assessment
        ? "Realization assessment"
        : "Semantic comparison available",
    ),
  );
  heading.append(
    title,
    textElement(
      "span",
      "inspector-object-state",
      closureCandidate
        ?.gateDisposition ||
        verificationRun?.state ||
        "not assessed",
    ),
  );
  section.append(heading);
  const pendingKey =
    `aro-semantic-verification:${evidenceBundle.evidenceBundleRef.id}`;
  const action = textElement(
    "button",
    "evidence-button aro-semantic-verification-action",
    state.pendingDecisionIds.has(
      pendingKey,
    )
      ? "Comparing evidence to ARO…"
      : verificationRun?.retryable
        ? "Retry semantic verification"
        : assessment
          ? "Assessment recorded"
          : "Run semantic verification",
  );
  action.type = "button";
  action.disabled =
    state.pendingDecisionIds.has(
      pendingKey,
    ) ||
    Boolean(
      assessment &&
      !verificationRun?.retryable,
    ) ||
    registry
      ?.semanticVerificationAvailable !==
      true;
  action.addEventListener(
    "click",
    () =>
      verifyAroRealization(
        evidenceBundle,
        verificationRun,
        surface,
      ),
  );
  if (!assessment) {
    section.append(
      textElement(
        "p",
        "inspector-object-summary",
        verificationRun?.error?.message ||
          "Compare the acquired worker evidence against every implementation obligation, verification claim, preservation constraint, and target branch.",
      ),
      action,
      textElement(
        "p",
        "decision-transition-boundary",
        "This semantic role reads the typed SC8.4 bundle only. It cannot execute tools, inspect new source, mutate the workspace, certify closure, or admit canonical truth.",
      ),
    );
    return section;
  }
  const facts = textElement(
    "div",
    "aro-semantic-verification-facts",
    "",
  );
  for (
    const fact of [
      `posture · ${assessment.overallPosture}`,
      `gate · ${closureCandidate?.gateDisposition || "unavailable"}`,
      `${closureCandidate?.incompleteAssessmentCount || 0} incomplete`,
      `${assessment.driftFindings.length} drift finding${
        assessment.driftFindings.length ===
        1
          ? ""
          : "s"
      }`,
      `${verificationRun.openDecisionRefs.length} open decision${
        verificationRun.openDecisionRefs.length ===
        1
          ? ""
          : "s"
      }`,
      "admission unavailable",
    ]
  ) {
    facts.append(
      textElement(
        "span",
        "",
        fact,
      ),
    );
  }
  section.append(facts);
  const lenses = [
    ["summary", "Summary"],
    ["obligations", "Obligations"],
    ["coverage", "Coverage"],
    ["drift", "Drift & next"],
  ];
  const activeLens =
    state
      .aroSemanticVerificationLenses
      .get(evidenceBundle.evidenceBundleRef.id) ||
    "summary";
  const lensBar = textElement(
    "div",
    "aro-semantic-verification-lenses",
    "",
  );
  const panel = textElement(
    "div",
    "aro-semantic-verification-panel",
    "",
  );
  for (const [lens, label] of lenses) {
    const button = textElement(
      "button",
      activeLens === lens
        ? "active"
        : "",
      label,
    );
    button.type = "button";
    button.setAttribute(
      "aria-pressed",
      String(activeLens === lens),
    );
    button.addEventListener(
      "click",
      () => {
        state
          .aroSemanticVerificationLenses
          .set(
            evidenceBundle
              .evidenceBundleRef.id,
            lens,
          );
        renderAroInspector();
      },
    );
    lensBar.append(button);
  }
  if (activeLens === "summary") {
    panel.append(
      textElement(
        "h5",
        "",
        "Semantic posture",
      ),
      textElement(
        "p",
        "inspector-object-summary",
        assessment.assessmentSummary,
      ),
      textElement(
        "p",
        "",
        `Verifier recommendation · ${assessment.closureRecommendation}. ${assessment.closureRationale}`,
      ),
      textElement(
        "p",
        "aro-semantic-gate",
        closureCandidate?.gateReady
          ? "Deterministic gate: ready for human review."
          : `Deterministic gate: ${closureCandidate?.gateDisposition || "unavailable"} · ${closureCandidate?.indeterminateAssessmentCount || 0} indeterminate · ${closureCandidate?.blockingFindingCount || 0} blocking findings.`,
      ),
      textElement(
        "p",
        "decision-transition-boundary",
        "The verifier's recommendation and the deterministic gate are both provisional evidence. Neither is canonical admission.",
      ),
    );
  } else if (
    activeLens === "obligations"
  ) {
    panel.append(
      textElement(
        "h5",
        "",
        "Implementation obligations and preservation",
      ),
    );
    for (
      const entry of
        assessment
          .obligationAssessments
    ) {
      panel.append(
        aroSemanticAssessmentCard(
          entry,
          "obligationKey",
        ),
      );
    }
    for (
      const entry of
        assessment
          .preservationAssessments
    ) {
      panel.append(
        aroSemanticAssessmentCard(
          entry,
          "preservationKey",
        ),
      );
    }
  } else if (
    activeLens === "coverage"
  ) {
    panel.append(
      textElement(
        "h5",
        "",
        "Verification claims and target branches",
      ),
    );
    for (
      const entry of
        assessment
          .verificationAssessments
    ) {
      panel.append(
        aroSemanticAssessmentCard(
          entry,
          "verificationKey",
        ),
      );
    }
    for (
      const entry of
        assessment.branchAssessments
    ) {
      panel.append(
        aroSemanticAssessmentCard(
          entry,
          "branchKey",
        ),
      );
    }
  } else {
    panel.append(
      textElement(
        "h5",
        "",
        "Semantic drift and continuation paths",
      ),
    );
    if (
      !assessment.driftFindings.length
    ) {
      panel.append(
        textElement(
          "p",
          "inspector-object-summary",
          "No semantic drift finding was discharged.",
        ),
      );
    }
    for (
      const finding of
        assessment.driftFindings
    ) {
      const card = textElement(
        "article",
        `aro-semantic-drift ${finding.severity}`,
        "",
      );
      card.append(
        textElement(
          "strong",
          "",
          `${finding.severity} · ${finding.category}`,
        ),
        textElement(
          "p",
          "",
          finding.statement,
        ),
        textElement(
          "small",
          "",
          finding.recommendedResponse,
        ),
      );
      panel.append(card);
    }
    for (
      const path of
        assessment.continuationPaths
    ) {
      const card = textElement(
        "article",
        "aro-semantic-continuation",
        "",
      );
      card.append(
        textElement(
          "strong",
          "",
          `${path.label} · ${path.priority}`,
        ),
        textElement(
          "p",
          "",
          path.description,
        ),
      );
      panel.append(card);
    }
    for (
      const decisionRef of
        verificationRun
          .openDecisionRefs
    ) {
      const button = textElement(
        "button",
        "evidence-button aro-semantic-decision-focus",
        `Open decision · ${shortId(decisionRef.id)}`,
      );
      button.type = "button";
      button.addEventListener(
        "click",
        () =>
          focusVerificationDecision(
            decisionRef,
          ),
      );
      panel.append(button);
    }
  }
  const admission = textElement(
    "button",
    "greenlight-button aro-semantic-admission-unavailable",
    "Canonical admission unavailable",
  );
  admission.type = "button";
  admission.disabled = true;
  section.append(
    lensBar,
    panel,
    action,
    admission,
    textElement(
      "p",
      "decision-transition-boundary",
      "SC8.5 assesses semantic support and prepares a closure candidate. A later governed admission slice must review and admit any canonical transition.",
    ),
  );
  return section;
}

function aroWorkerHandoffWorkbench(
  contract,
  contextImport,
  witness,
  surface,
) {
  const registry =
    aroRegistryProjection();
  const constitution =
    registry
      ?.workerConstitutions
      ?.find((entry) =>
        entry.contractRef.id ===
          contract.contractRef.id &&
        entry.contractRef.digest ===
          contract.contractRef.digest &&
        entry.contextImportRef.id ===
          contextImport
            .contextImportRef.id &&
        entry.mappingWitnessRef.id ===
          witness.mappingWitnessRef.id) ||
    null;
  const run =
    constitution
      ? registry
          ?.workerHandoffRuns
          ?.find((entry) =>
            entry.constitutionRef.id ===
              constitution
                .constitutionRef.id &&
            entry.constitutionRef
              .digest ===
              constitution
                .constitutionRef
                .digest) ||
        null
      : null;
  const lane = textElement(
    "section",
    `aro-worker-workbench ${
      run?.state ||
      constitution?.constitutionState ||
      "not_compiled"
    }`,
    "",
  );
  lane.dataset.workerConstitution =
    constitution?.constitutionRef.id ||
    "";
  lane.dataset.handoffState =
    run?.state || "not_started";
  lane.dataset.workspaceMutation =
    "false";
  const heading = textElement(
    "div",
    "aro-worker-heading",
    "",
  );
  heading.append(
    textElement(
      "div",
      "",
      "",
    ),
    textElement(
      "span",
      "inspector-object-state",
      run?.state ||
        constitution
          ?.constitutionState ||
        "available",
    ),
  );
  heading.firstChild.append(
    textElement(
      "span",
      "inspector-object-kind",
      "SC8.3 bounded worker lane",
    ),
    textElement(
      "strong",
      "",
      constitution
        ? "Compiled worker constitution"
        : "Review evidence and compile constitution",
    ),
  );
  lane.append(heading);
  if (!constitution) {
    lane.append(
      textElement(
        "p",
        "inspector-object-summary",
        "Refresh the exact mapped source identity, observe the active Direct implementation capabilities, and compile one immutable worker constitution. This advisory step starts no provider turn.",
      ),
    );
    const review = textElement(
      "button",
      "evidence-button aro-worker-review",
      state.pendingDecisionIds.has(
        `aro-worker-review:${contract.contractRef.id}`,
      )
        ? "Refreshing evidence and compiling…"
        : "Review evidence and compile worker constitution",
    );
    review.type = "button";
    review.disabled =
      !registry
        ?.workerHandoffAvailable ||
      state.pendingDecisionIds.has(
        `aro-worker-review:${contract.contractRef.id}`,
      );
    review.addEventListener(
      "click",
      () =>
        prepareAroWorker(
          contract,
          contextImport,
          witness,
          surface,
        ),
    );
    lane.append(
      review,
      textElement(
        "p",
        "decision-transition-boundary",
        registry
          ?.workerHandoffAvailable
          ? "Evidence review and constitution compilation are advisory. Provider start, file reads, patches, commands, canonical admission, and closure remain unauthorized."
          : "The native Direct implementation-worker path is unavailable. No fallback worker or effect path is authorized.",
      ),
    );
    return lane;
  }
  const refs = textElement(
    "div",
    "aro-worker-ref-strip",
    "",
  );
  for (
    const [label, ref] of [
      ["contract", constitution.contractRef],
      ["mapping", constitution.mappingWitnessRef],
      ["review", constitution.reviewReceiptRef],
      ["constitution", constitution.constitutionRef],
    ]
  ) {
    const entry = textElement(
      "span",
      "",
      "",
    );
    entry.append(
      textElement("small", "", label),
      textElement(
        "strong",
        "",
        shortId(ref.id),
      ),
      textElement(
        "code",
        "",
        String(ref.digest).slice(
          0,
          10,
        ),
      ),
    );
    refs.append(entry);
  }
  lane.append(refs);
  const facts = textElement(
    "div",
    "aro-worker-facts",
    "",
  );
  for (
    const fact of [
      `${constitution.capability.toolCount} tool capability${
        constitution.capability.toolCount ===
        1
          ? ""
          : "ies"
      }`,
      `${constitution.budget.turnLimit} provider turn`,
      `${constitution.budget.mappedFileCount} mapped file${
        constitution.budget.mappedFileCount ===
        1
          ? ""
          : "s"
      }`,
      "per-call approval",
      "no remote mutation",
      "closure deferred",
    ]
  ) {
    facts.append(
      textElement(
        "span",
        "",
        fact,
      ),
    );
  }
  lane.append(facts);
  const constitutionDetails =
    textElement(
      "details",
      "aro-worker-constitution-details",
      "",
    );
  constitutionDetails.append(
    textElement(
      "summary",
      "",
      "Constitution, authority, budget and completion",
    ),
    textElement(
      "p",
      "",
      constitution.role.purpose,
    ),
    textElement(
      "p",
      "",
      `Tools · ${constitution.capability.toolNames.join(", ") || "none"}`,
    ),
    textElement(
      "p",
      "",
      "Authority · one provider start after operator authorization; every read, patch, and command remains separately gated.",
    ),
    textElement(
      "p",
      "",
      `Completion · ${constitution.completion.requiredEvidenceKinds.join(", ") || "implementation evidence"}; activity is not closure.`,
    ),
  );
  lane.append(constitutionDetails);
  if (
    constitution.constitutionState ===
    "blocked"
  ) {
    const blockers = textElement(
      "div",
      "aro-worker-blockers",
      "",
    );
    for (
      const blocker of
        constitution.blockerCodes
    ) {
      blockers.append(
        textElement(
          "p",
          "",
          blocker.replace(/_/g, " "),
        ),
      );
    }
    const refreshButton = textElement(
      "button",
      "evidence-button aro-worker-review",
      "Refresh evidence and recompile",
    );
    refreshButton.type = "button";
    refreshButton.addEventListener(
      "click",
      () =>
        prepareAroWorker(
          contract,
          contextImport,
          witness,
          surface,
        ),
    );
    lane.append(
      blockers,
      refreshButton,
      textElement(
        "p",
        "decision-transition-boundary",
        "The gate is blocked. No authorization receipt, worker, provider turn, or workspace effect exists.",
      ),
    );
    return lane;
  }
  if (!run) {
    const pendingKey =
      `aro-worker-authorize:${constitution.constitutionRef.id}`;
    const authorize = textElement(
      "button",
      "greenlight-button aro-worker-authorize",
      state.pendingDecisionIds.has(
        pendingKey,
      )
        ? "Authorizing one worker handoff…"
        : "Authorize one bounded worker handoff",
    );
    authorize.type = "button";
    authorize.disabled =
      state.pendingDecisionIds.has(
        pendingKey,
      );
    authorize.addEventListener(
      "click",
      () =>
        authorizeAroWorker(
          contract,
          contextImport,
          witness,
          constitution,
          surface,
        ),
    );
    lane.append(
      authorize,
      textElement(
        "p",
        "decision-transition-boundary authority-bearing",
        "This single-use action authorizes one worker session and one provider turn. It does not authorize a read, patch, command, remote mutation, canonical admission, verification claim, or semantic closure.",
      ),
    );
    return lane;
  }
  if (
    ["scheduled", "running"].includes(
      run.state,
    )
  ) {
    lane.append(
      textElement(
        "p",
        "inspector-object-summary",
        "The single-use authorization is being consumed by the native Direct worker-start transition.",
      ),
      textElement(
        "p",
        "decision-transition-boundary",
        "No workspace effect is authorized at handoff. Tool proposals will appear here as separate decisions.",
      ),
    );
    return lane;
  }
  if (run.state === "failed") {
    lane.append(
      textElement(
        "p",
        "inspector-object-summary",
        run.error?.message ||
          "The worker start failed visibly.",
      ),
      textElement(
        "p",
        "decision-transition-boundary",
        "The authorization was consumed and will not be replayed. Refresh evidence and compile a fresh constitution before another handoff.",
      ),
    );
    return lane;
  }
  lane.append(
    textElement(
      "p",
      "aro-worker-running-summary",
      "The exact ARO WorkThread and Direct implementation turn are active. Worker activity is not verification or closure.",
    ),
  );
  const lineage = textElement(
    "div",
    "aro-worker-lineage",
    "",
  );
  for (
    const [label, ref] of [
      ["workthread", run.workThreadRef],
      ["start", run.workerStartTransitionRef],
      ["session", run.workerSessionRef],
      ["turn", run.workerTurnRef],
    ]
  ) {
    if (!ref) continue;
    lineage.append(
      textElement(
        "span",
        "",
        `${label} · ${shortId(ref.id)}`,
      ),
    );
  }
  lane.append(lineage);
  const requests = [
    ...state.aroWorkerRequests.values(),
  ].filter((request) =>
    [
      "direct/tool/readOnly/requestApproval",
      "direct/tool/patchApply/requestApproval",
      "direct/tool/command/requestApproval",
    ].includes(request.method));
  const requestLane = textElement(
    "div",
    "aro-worker-request-lane",
    "",
  );
  requestLane.append(
    textElement(
      "h5",
      "",
      `Per-call effect decisions · ${requests.filter((request) => request.status === "pending").length} pending`,
    ),
  );
  if (!requests.length) {
    requestLane.append(
      textElement(
        "p",
        "inspector-object-summary",
        "No read, patch, or command request is pending yet.",
      ),
    );
  } else {
    for (const request of requests) {
      requestLane.append(
        aroWorkerRequestCard(request),
      );
    }
  }
  lane.append(
    requestLane,
    textElement(
      "p",
      "decision-transition-boundary",
      "Each approval above is action-specific. The worker cannot push, publish, mutate canonical worldstate, recursively spawn, verify semantic truth, or certify closure.",
    ),
    aroExecutionEvidenceWorkbench(
      run,
      surface,
    ),
  );
  const semanticVerification =
    aroSemanticVerificationWorkbench(
      run,
      surface,
    );
  if (semanticVerification) {
    lane.append(
      semanticVerification,
    );
  }
  return lane;
}

function aroMutationRefStrip(
  comparison,
  contract,
) {
  const strip = textElement(
    "div",
    "aro-mutation-ref-strip",
    "",
  );
  const refs = [
    [
      "current",
      contract?.currentAroRef ||
        comparison.currentAroRef,
    ],
    [
      "comparison",
      contract?.comparisonRef || {
        id:
          comparison.comparisonId,
        digest: comparison.digest,
      },
    ],
    [
      "target",
      contract?.targetAroRef ||
        comparison.targetAroRef,
    ],
  ];
  if (contract?.repositorySnapshotRef) {
    refs.push([
      "snapshot",
      contract.repositorySnapshotRef,
    ]);
  }
  for (const [label, ref] of refs) {
    const item = textElement(
      "span",
      "",
      "",
    );
    item.append(
      textElement(
        "small",
        "",
        label,
      ),
      textElement(
        "strong",
        "",
        shortId(ref?.id),
      ),
      textElement(
        "code",
        "",
        String(
          ref?.digest || "",
        ).slice(0, 10),
      ),
    );
    strip.append(item);
  }
  return strip;
}

function aroRealizationMappingWorkbench(
  contract,
  comparison,
  surface,
) {
  const registry =
    aroRegistryProjection();
  const run =
    registry?.realizationMappingRuns
      ?.find((entry) =>
        entry.contractRef.id ===
          contract.contractRef.id &&
        entry.contractRef.digest ===
          contract.contractRef.digest) ||
    null;
  const contextImport =
    run
      ? registry
          ?.realizationContextImports
          ?.find((entry) =>
            entry.contextImportRef.id ===
              run.contextImportRef.id &&
            entry.contextImportRef
              .digest ===
              run.contextImportRef
                .digest) || null
      : null;
  const witness =
    run?.mappingWitnessRef
      ? registry
          ?.realizationMappingWitnesses
          ?.find((entry) =>
            entry.mappingWitnessRef.id ===
              run.mappingWitnessRef.id &&
            entry.mappingWitnessRef
              .digest ===
              run.mappingWitnessRef
                .digest) || null
      : null;
  const lane = textElement(
    "section",
    `aro-realization-workbench ${
      run?.state || "not-imported"
    }`,
    "",
  );
  lane.dataset.contractId =
    contract.contractRef.id;
  lane.dataset.realizationState =
    run?.state || "not_imported";
  lane.dataset.sourceInspection =
    run ? "true" : "false";
  lane.dataset.workerLaunch =
    "unavailable";
  lane.dataset.workspaceMutation =
    "false";
  const heading = textElement(
    "div",
    "aro-realization-heading",
    "",
  );
  const copy = textElement(
    "div",
    "",
    "",
  );
  copy.append(
    textElement(
      "span",
      "inspector-object-kind",
      "SC8.2 realization evidence lane",
    ),
    textElement(
      "strong",
      "",
      witness
        ? "ARO-to-code mapping witness"
        : run
          ? "Realization mapping"
          : "Import bounded realization context",
    ),
  );
  heading.append(
    copy,
    textElement(
      "span",
      `inspector-object-state ${
        witness?.mappingPosture ||
        run?.state ||
        "available"
      }`,
      witness?.mappingPosture ||
        run?.state ||
        "available",
    ),
  );
  lane.append(heading);
  if (!run) {
    lane.append(
      textElement(
        "p",
        "inspector-object-summary",
        "Read only the source paths selected by the exact ARO bindings and repository snapshot, then map every implementation obligation to explicit file, symbol, and line-range witnesses.",
      ),
    );
    const start = textElement(
      "button",
      "evidence-button aro-realization-import",
      state.pendingDecisionIds.has(
        `aro-realization:${contract.contractRef.id}`,
      )
        ? "Importing bounded source evidence…"
        : contract.implementationObligations
            .length
          ? "Import context and map obligations"
          : "No realization mapping required",
    );
    start.type = "button";
    start.disabled =
      !registry
        ?.realizationMappingAvailable ||
      !contract
        .implementationObligations
        .length ||
      state.pendingDecisionIds.has(
        `aro-realization:${contract.contractRef.id}`,
      );
    start.addEventListener(
      "click",
      () =>
        mapAroRealizationContext(
          contract,
          comparison,
          surface,
        ),
    );
    lane.append(
      start,
      textElement(
        "p",
        "decision-transition-boundary",
        registry
          ?.realizationMappingAvailable
          ? "The import is bounded, read-only, and tied to this exact contract and repository snapshot. Source excerpts stay in the backend reasoning packet; the surface receives only evidence identity and mapping witnesses."
          : "The Direct realization mapper is unavailable. No fallback source inspection or worker path is authorized.",
      ),
    );
    return lane;
  }
  if (
    ["scheduled", "running"].includes(
      run.state,
    )
  ) {
    lane.append(
      textElement(
        "p",
        "inspector-object-summary",
        run.state === "scheduled"
          ? "The exact contract and bounded source identity are durably scheduled for mapping."
          : "The Direct semantic mapper is relating implementation obligations to the imported realization evidence.",
      ),
      textElement(
        "p",
        "decision-transition-boundary",
        "Source inspection is read-only. Worker launch, workspace mutation, canonical admission, and authority remain unavailable.",
      ),
    );
    return lane;
  }
  if (
    run.retryable &&
    !witness
  ) {
    lane.append(
      textElement(
        "p",
        "inspector-object-summary",
        run.error?.message ||
          "The semantic mapper did not discharge a valid obligation-to-source witness.",
      ),
    );
    const retry = textElement(
      "button",
      "evidence-button aro-realization-retry",
      state.pendingDecisionIds.has(
        `aro-realization:${contract.contractRef.id}`,
      )
        ? "Retrying exact imported context…"
        : "Retry exact realization mapping",
    );
    retry.type = "button";
    retry.disabled =
      state.pendingDecisionIds.has(
        `aro-realization:${contract.contractRef.id}`,
      );
    retry.addEventListener(
      "click",
      () =>
        mapAroRealizationContext(
          contract,
          comparison,
          surface,
          run,
        ),
    );
    lane.append(
      retry,
      textElement(
        "p",
        "decision-transition-boundary",
        "Retry reuses the immutable imported context and exact contract identity. It does not reread source or authorize downstream execution.",
      ),
    );
    return lane;
  }
  if (!contextImport || !witness) {
    lane.append(
      textElement(
        "p",
        "inspector-object-summary",
        "The terminal mapping run does not have a complete inspectable import-and-witness lineage.",
      ),
    );
    return lane;
  }
  const refs = textElement(
    "div",
    "aro-realization-ref-strip",
    "",
  );
  for (
    const [label, ref] of [
      ["contract", contract.contractRef],
      [
        "context",
        contextImport.contextImportRef,
      ],
      [
        "snapshot",
        contextImport
          .repositorySnapshotRef,
      ],
      [
        "mapping",
        witness.mappingWitnessRef,
      ],
    ]
  ) {
    const item = textElement(
      "span",
      "",
      "",
    );
    item.append(
      textElement(
        "small",
        "",
        label,
      ),
      textElement(
        "strong",
        "",
        shortId(ref?.id),
      ),
      textElement(
        "code",
        "",
        String(
          ref?.digest || "",
        ).slice(0, 10),
      ),
    );
    refs.append(item);
  }
  lane.append(
    refs,
    textElement(
      "p",
      "aro-realization-summary",
      witness.mappingSummary,
    ),
  );
  const facts = textElement(
    "div",
    "aro-realization-facts",
    "",
  );
  for (
    const fact of [
      `${contextImport.evidence.length} bounded source witness${
        contextImport.evidence.length ===
        1
          ? ""
          : "es"
      }`,
      `${witness.mappedObligationCount} mapped`,
      `${witness.partialObligationCount} partial`,
      `${witness.unmappedObligationCount} unmapped`,
      `${witness.ambiguousObligationCount} ambiguous`,
      `${contextImport.freshness} source identity`,
    ]
  ) {
    facts.append(
      textElement(
        "span",
        "",
        fact,
      ),
    );
  }
  lane.append(facts);
  const inventory = textElement(
    "details",
    "aro-realization-inventory",
    "",
  );
  inventory.append(
    textElement(
      "summary",
      "",
      `Bounded source inventory · ${contextImport.evidence.length}`,
    ),
  );
  for (
    const evidence of
      contextImport.evidence
  ) {
    const item = textElement(
      "div",
      "aro-realization-source",
      "",
    );
    item.append(
      textElement(
        "strong",
        "",
        evidence.relativePath,
      ),
      textElement(
        "span",
        "",
        `${evidence.language || "source"} · lines ${evidence.lineStart}–${evidence.lineEnd}${
          evidence.excerptTruncated
            ? " · bounded excerpt"
            : ""
        }`,
      ),
      textElement(
        "code",
        "",
        `${evidence.evidenceKey} · ${String(
          evidence.sourceRef?.digest ||
            "",
        ).slice(0, 14)}`,
      ),
    );
    inventory.append(item);
  }
  lane.append(inventory);
  const mappings = textElement(
    "div",
    "aro-realization-mapping-list",
    "",
  );
  mappings.append(
    textElement(
      "h5",
      "",
      "Obligation-to-realization mapping",
    ),
  );
  for (
    const mapping of
      witness.obligationMappings
  ) {
    const obligation =
      contract
        .implementationObligations
        .find((entry) =>
          entry.obligationKey ===
            mapping.obligationKey);
    const item = textElement(
      "article",
      `aro-realization-mapping ${mapping.coverageState}`,
      "",
    );
    item.append(
      textElement(
        "span",
        "inspector-object-kind",
        mapping.coverageState,
      ),
      textElement(
        "strong",
        "",
        obligation?.title ||
          mapping.obligationKey,
      ),
      textElement(
        "p",
        "",
        mapping.rationale,
      ),
    );
    for (
      const sourceBinding of
        mapping.sourceBindings
    ) {
      const binding = textElement(
        "div",
        "aro-realization-binding",
        "",
      );
      binding.append(
        textElement(
          "strong",
          "",
          sourceBinding.relativePath,
        ),
        textElement(
          "code",
          "",
          `${sourceBinding.symbol || "(file scope)"} · L${sourceBinding.startLine}–L${sourceBinding.endLine}`,
        ),
        textElement(
          "span",
          "",
          `${sourceBinding.bindingKind} · ${sourceBinding.rationale}`,
        ),
      );
      item.append(binding);
    }
    mappings.append(item);
  }
  lane.append(mappings);
  const diagnostics = [
    ...contextImport
      .selectionWitness
      .rejectedPaths.map(
        (entry) =>
          `Import rejected · ${entry.relativePath} · ${entry.reason}`,
      ),
    ...contextImport
      .selectionWitness
      .omittedPaths.map(
        (relativePath) =>
          `Import omitted · ${relativePath}`,
      ),
    ...witness.ambiguities.map(
      (entry) =>
        `Ambiguity · ${entry.statement}`,
    ),
    ...witness.omissions.map(
      (entry) =>
        `Omission · ${entry.statement}`,
    ),
    ...witness.assumptions.map(
      (entry) =>
        `Assumption · ${entry}`,
    ),
    ...witness.unresolvedQuestions.map(
      (entry) =>
        `Open · ${entry}`,
    ),
  ];
  if (
    diagnostics.length ||
    contextImport.freshness !== "fresh"
  ) {
    const details = textElement(
      "details",
      "aro-realization-diagnostics",
      "",
    );
    details.open =
      contextImport.freshness !==
        "fresh" ||
      witness.mappingPosture !==
        "complete";
    details.append(
      textElement(
        "summary",
        "",
        `Ambiguity, omission and freshness · ${
          diagnostics.length +
          (
            contextImport.freshness ===
              "fresh"
              ? 0
              : 1
          )
        }`,
      ),
    );
    if (
      contextImport.freshness !==
      "fresh"
    ) {
      details.append(
        textElement(
          "p",
          "",
          `Freshness · repository identity is ${contextImport.freshness} relative to the contract snapshot.`,
        ),
      );
    }
    for (const diagnostic of diagnostics) {
      details.append(
        textElement(
          "p",
          "",
          diagnostic,
        ),
      );
    }
    lane.append(details);
  }
  lane.append(
    aroWorkerHandoffWorkbench(
      contract,
      contextImport,
      witness,
      surface,
    ),
    textElement(
      "p",
      "decision-transition-boundary",
      "This mapping witness remains provisional and read-only. Source excerpts were not projected into the UI. SC8.3 may start one separately authorized worker turn, but every workspace effect remains action-gated and closure remains deferred.",
    ),
  );
  return lane;
}

function aroMutationContractWorkbench(
  comparison,
  surface,
) {
  const registry =
    aroRegistryProjection();
  const run =
    registry?.mutationCompilationRuns
      ?.find((entry) =>
        entry.comparisonRef.id ===
          comparison.comparisonId &&
        entry.comparisonRef.digest ===
          comparison.digest) ||
    null;
  const contract =
    registry?.mutationContracts
      ?.find((entry) =>
        entry.comparisonRef.id ===
          comparison.comparisonId &&
        entry.comparisonRef.digest ===
          comparison.digest) ||
    null;
  const lane = textElement(
    "section",
    `aro-mutation-workbench ${
      run?.state || "not-compiled"
    }`,
    "",
  );
  lane.dataset.comparisonId =
    comparison.comparisonId;
  lane.dataset.compilationState =
    run?.state || "not_compiled";
  lane.dataset.workerLaunch =
    "unavailable";
  lane.dataset.workspaceMutation =
    "false";
  const heading = textElement(
    "div",
    "aro-mutation-heading",
    "",
  );
  const copy = textElement(
    "div",
    "",
    "",
  );
  copy.append(
    textElement(
      "span",
      "inspector-object-kind",
      "SC8.1 provisional mutation lane",
    ),
    textElement(
      "strong",
      "",
      contract
        ? "Implementation contract"
        : run
          ? "Contract compilation"
          : "Compile the semantic delta",
    ),
  );
  heading.append(
    copy,
    textElement(
      "span",
      `inspector-object-state ${
        run?.state || "candidate"
      }`,
      run?.state ||
        "available",
    ),
  );
  lane.append(
    heading,
    aroMutationRefStrip(
      comparison,
      contract,
    ),
  );
  if (
    !run &&
    !contract
  ) {
    lane.append(
      textElement(
        "p",
        "inspector-object-summary",
        "The deterministic layer will bind this exact current/target comparison and derive its operative delta. The Direct semantic compiler may then author open-vocabulary implementation obligations and verification requirements.",
      ),
    );
    const compile = textElement(
      "button",
      "evidence-button aro-mutation-compile",
      state.pendingDecisionIds.has(
        `aro-mutation:${comparison.comparisonId}`,
      )
        ? "Compiling exact semantic delta…"
        : "Compile provisional mutation contract",
    );
    compile.type = "button";
    compile.disabled =
      !registry
        ?.mutationCompilationAvailable ||
      state.pendingDecisionIds.has(
        `aro-mutation:${comparison.comparisonId}`,
      );
    compile.addEventListener(
      "click",
      () =>
        compileAroMutationContract(
          comparison,
          surface,
        ),
    );
    lane.append(
      compile,
      textElement(
        "p",
        "decision-transition-boundary",
        registry
          ?.mutationCompilationAvailable
          ? "Compilation is advisory and durable. It cannot inspect source, launch a worker, mutate the workspace, admit canonical state, or grant authority."
          : "The Direct mutation-contract compiler is unavailable in this runtime. No fallback execution path is authorized.",
      ),
    );
    return lane;
  }
  if (
    run &&
    ["scheduled", "running"].includes(
      run.state,
    )
  ) {
    lane.append(
      textElement(
        "p",
        "inspector-object-summary",
        run.state === "scheduled"
          ? "The exact comparison is durably scheduled for semantic contract compilation."
          : "The Direct reasoner is translating the exact ARO delta into obligations and verification requirements.",
      ),
      textElement(
        "p",
        "decision-transition-boundary",
        "This running turn has zero source, worker, workspace, or canonical effects.",
      ),
    );
    return lane;
  }
  if (
    run?.retryable &&
    !contract
  ) {
    lane.append(
      textElement(
        "p",
        "inspector-object-summary",
        run.error?.message ||
          "The compiler did not discharge a valid contract for this exact comparison.",
      ),
    );
    const retry = textElement(
      "button",
      "evidence-button aro-mutation-retry",
      state.pendingDecisionIds.has(
        `aro-mutation:${comparison.comparisonId}`,
      )
        ? "Retrying exact comparison…"
        : "Retry exact contract compilation",
    );
    retry.type = "button";
    retry.disabled =
      state.pendingDecisionIds.has(
        `aro-mutation:${comparison.comparisonId}`,
      );
    retry.addEventListener(
      "click",
      () =>
        compileAroMutationContract(
          comparison,
          surface,
          run,
        ),
    );
    lane.append(
      retry,
      textElement(
        "p",
        "decision-transition-boundary",
        "Retry preserves the comparison identity and creates a new run attempt. It authorizes no downstream effect.",
      ),
    );
    return lane;
  }
  if (!contract) {
    lane.append(
      textElement(
        "p",
        "inspector-object-summary",
        "The compilation run completed without an inspectable contract binding.",
      ),
    );
    return lane;
  }
  lane.dataset.contractId =
    contract.contractRef.id;
  lane.append(
    textElement(
      "p",
      "aro-mutation-contract-summary",
      contract.contractSummary,
    ),
  );
  const facts = textElement(
    "div",
    "aro-mutation-facts",
    "",
  );
  for (
    const value of [
      contract.disposition.replace(
        /_/g,
        " ",
      ),
      `${contract.delta.operativeTargetBranchRefs.length} operative target branch${
        contract.delta.operativeTargetBranchRefs.length ===
        1
          ? ""
          : "es"
      }`,
      `${contract.implementationObligations.length} obligation${
        contract.implementationObligations.length ===
        1
          ? ""
          : "s"
      }`,
      `${contract.verificationRequirements.length} verification requirement${
        contract.verificationRequirements.length ===
        1
          ? ""
          : "s"
      }`,
    ]
  ) {
    facts.append(
      textElement(
        "span",
        "",
        value,
      ),
    );
  }
  lane.append(facts);
  const strategy = textElement(
    "section",
    "aro-mutation-strategy",
    "",
  );
  strategy.append(
    textElement(
      "strong",
      "",
      "Change strategy",
    ),
    textElement(
      "p",
      "",
      contract.changeStrategy,
    ),
  );
  lane.append(strategy);
  const obligations = textElement(
    "div",
    "aro-mutation-obligation-list",
    "",
  );
  obligations.append(
    textElement(
      "h5",
      "",
      "Implementation obligations",
    ),
  );
  for (
    const obligation of
      contract
        .implementationObligations
  ) {
    const item = textElement(
      "article",
      "aro-mutation-obligation",
      "",
    );
    item.append(
      textElement(
        "span",
        "inspector-object-kind",
        `${obligation.obligationKind} · ${obligation.priority}`,
      ),
      textElement(
        "strong",
        "",
        obligation.title,
      ),
      textElement(
        "p",
        "",
        obligation.objective,
      ),
      textElement(
        "small",
        "",
        `${obligation.branchRefs.length} branch binding${
          obligation.branchRefs.length ===
          1
            ? ""
            : "s"
        } · ${obligation.verificationRequirementKeys.length} verification link${
          obligation.verificationRequirementKeys.length ===
          1
            ? ""
            : "s"
        }`,
      ),
    );
    obligations.append(item);
  }
  lane.append(obligations);
  const verification = textElement(
    "details",
    "aro-mutation-verification",
    "",
  );
  verification.open = true;
  verification.append(
    textElement(
      "summary",
      "",
      `Verification contract · ${contract.verificationRequirements.length}`,
    ),
  );
  for (
    const requirement of
      contract.verificationRequirements
  ) {
    const item = textElement(
      "div",
      "aro-mutation-verification-item",
      "",
    );
    item.append(
      textElement(
        "strong",
        "",
        requirement.claim,
      ),
      textElement(
        "span",
        "",
        requirement.successCondition,
      ),
      textElement(
        "small",
        "",
        `${requirement.verificationKind} · ${
          requirement.requiredEvidenceKinds.join(
            ", ",
          ) || "evidence kind left open"
        }`,
      ),
    );
    verification.append(item);
  }
  lane.append(verification);
  if (
    contract.preservationConstraints
      .length ||
    contract.assumptions.length ||
    contract.unresolvedQuestions.length
  ) {
    const context = textElement(
      "details",
      "aro-mutation-context",
      "",
    );
    context.append(
      textElement(
        "summary",
        "",
        "Preservation, assumptions and unresolved questions",
      ),
    );
    for (
      const constraint of
        contract
          .preservationConstraints
    ) {
      context.append(
        textElement(
          "p",
          "",
          `Preserve · ${constraint.statement}`,
        ),
      );
    }
    for (
      const assumption of
        contract.assumptions
    ) {
      context.append(
        textElement(
          "p",
          "",
          `Assumption · ${assumption}`,
        ),
      );
    }
    for (
      const question of
        contract.unresolvedQuestions
    ) {
      context.append(
        textElement(
          "p",
          "",
          `Open · ${question}`,
        ),
      );
    }
    lane.append(context);
  }
  lane.append(
    aroRealizationMappingWorkbench(
      contract,
      comparison,
      surface,
    ),
  );
  return lane;
}

function aroSurfaceCard(surface) {
  const object =
    aroObjectForSurface(surface);
  const card = textElement(
    "article",
    `inspector-object compiled-semantic-surface aro-surface ${surface.morph.family}`,
    "",
  );
  card.dataset.semanticSurfaceId =
    surface.semanticObjectSurfaceId;
  card.dataset.subjectId =
    surface.subjectRef.id;
  card.dataset.objectClass =
    surface.objectClass;
  card.dataset.surfaceState =
    surface.surfaceState;
  const header = textElement(
    "div",
    "inspector-object-header",
    "",
  );
  const copy = textElement("div", "", "");
  copy.append(
    textElement(
      "span",
      "inspector-object-kind",
      surface.compactProjection
        ?.eyebrow ||
        surface.objectClass.replace(
          /_/g,
          " ",
        ),
    ),
    textElement(
      "strong",
      "",
      surface.compactProjection?.title ||
        surface.semanticIdentity,
    ),
  );
  header.append(
    copy,
    textElement(
      "span",
      "inspector-object-state",
      surface.surfaceState,
    ),
  );
  card.append(
    header,
    textElement(
      "p",
      "inspector-object-summary",
      surface.summary,
    ),
    semanticLensNavigator(
      surface,
      renderAroInspector,
    ),
    semanticLensContent(surface),
  );
  if (
    surface.objectClass ===
      "aro_reconstruction_candidate" &&
    object
  ) {
    const targetDefinition =
      object.reconstructionMethod ===
        "semantic_target_definition";
    const targetProvenance =
      targetDefinition
        ? aroTargetDefinitionProvenance(
            object,
          )
        : null;
    card.append(
      aroCandidateEvidence(object),
      ...(targetProvenance
        ? [targetProvenance]
        : []),
      aroTreeMorph(
        object.candidateAro,
      ),
      aroCoverageMorph(
        object.candidateAro
          .coverageWitness,
      ),
    );
    const actions = textElement(
      "div",
      "aro-candidate-actions",
      "",
    );
    const reviewed =
      object.evidenceReviewState ===
        "reviewed" &&
      object.contradictionReviewState ===
        "reviewed";
    const pending =
      state.pendingDecisionIds.has(
        object.candidateId,
      );
    const review = textElement(
      "button",
      "evidence-button",
      reviewed
        ? `${
            targetDefinition
              ? "Target definition"
              : "Reconstruction"
          } reviewed ✓`
        : `Review ${
            targetDefinition
              ? "target definition"
              : "reconstruction"
          }`,
    );
    review.type = "button";
    review.disabled =
      reviewed ||
      pending ||
      object.lifecycle === "admitted";
    review.addEventListener(
      "click",
      () =>
        reviewAroCandidate(
          object,
          surface,
        ),
    );
    const commit = textElement(
      "button",
      "greenlight-button",
      targetDefinition
        ? "Admit target ARO"
        : "Admit reconstructed ARO",
    );
    commit.type = "button";
    commit.disabled =
      !reviewed ||
      pending ||
      object.lifecycle === "admitted";
    commit.addEventListener(
      "click",
      () =>
        admitAroCandidate(
          object,
          surface,
        ),
    );
    actions.append(review, commit);
    card.append(
      actions,
      textElement(
        "p",
        "decision-transition-boundary",
        reviewed
          ? "Both reviews are recorded. Admission can mutate only the canonical semantic registry."
          : "Review evidence and contradictions before admission. Review is not semantic validation.",
      ),
    );
  } else if (
    surface.objectClass ===
      "abstract_reasoning_object" &&
    object
  ) {
    card.append(aroTreeMorph(object));
    if (object.posture === "current") {
      card.append(
        aroTargetDefinitionWorkbench(
          object,
          surface,
        ),
      );
    }
  } else if (
    surface.objectClass ===
      "aro_coverage_witness" &&
    object
  ) {
    card.append(
      aroCoverageMorph(object),
    );
  } else if (
    surface.objectClass ===
      "aro_current_target_comparison" &&
    object
  ) {
    card.append(
      aroComparisonMorph(object),
      aroMutationContractWorkbench(
        object,
        surface,
      ),
    );
  }
  return card;
}

async function retryAroReconstruction(
  run,
) {
  if (
    !run?.retryable ||
    !bridge
      ?.retryWorldManagerAroReconstruction
  ) {
    showToast(
      "This reconstruction is not retryable.",
      "error",
    );
    return;
  }
  state.pendingDecisionIds.add(
    run.runRef.id,
  );
  renderAroInspector();
  try {
    const result =
      await bridge
        .retryWorldManagerAroReconstruction(
          run.projectId,
          run.runRef.digest,
        );
    applyProjection(
      result?.projection || result,
    );
    showToast(
      result?.receipt?.state ===
        "completed"
        ? "Repository semantic reconstruction completed. Its candidates remain provisional."
        : `Repository semantic reconstruction is ${String(
            result?.receipt?.state ||
              "running",
          ).replace(/_/g, " ")}.`,
    );
  } catch (error) {
    showToast(
      error?.message ||
        "Repository semantic reconstruction retry failed.",
      "error",
    );
    await refresh();
  } finally {
    state.pendingDecisionIds.delete(
      run.runRef.id,
    );
    render();
  }
}

function renderAroReconstructionStatus(
  registry,
  projectId,
) {
  clear(
    elements.aroReconstructionStatus,
  );
  const run =
    registry?.reconstructionRuns
      ?.find((entry) =>
        entry.projectId === projectId) ||
    null;
  if (!run) {
    elements.aroReconstructionStatus
      .append(
        textElement(
          "p",
          "inspector-empty",
          registry?.automaticScheduling
            ? "Repository semantic reconstruction has not been scheduled for this project in the current bootstrap."
            : "Automatic repository semantic reconstruction is unavailable in this runtime.",
        ),
      );
    return;
  }
  const snapshot =
    registry.repositorySnapshots
      ?.find((entry) =>
        entry.repositorySnapshotRef.id ===
          run.repositorySnapshotRef.id &&
        entry.repositorySnapshotRef
          .digest ===
          run.repositorySnapshotRef
            .digest) ||
    null;
  const card = textElement(
    "article",
    `aro-reconstruction-run ${run.state}`,
    "",
  );
  card.dataset.runId =
    run.runRef.id;
  card.dataset.runState =
    run.state;
  card.dataset.authorityPosture =
    "non-authoritative";
  const header = textElement(
    "div",
    "inspector-object-header",
    "",
  );
  const copy = textElement(
    "div",
    "",
    "",
  );
  copy.append(
    textElement(
      "span",
      "inspector-object-kind",
      "Harness-owned reconstruction producer",
    ),
    textElement(
      "strong",
      "",
      ["scheduled", "running"].includes(
        run.state,
      )
        ? "Reconstructing repository semantic anatomy"
        : run.state === "completed"
          ? "Repository reconstruction discharged"
          : "Repository reconstruction needs attention",
    ),
  );
  header.append(
    copy,
    textElement(
      "span",
      `inspector-object-state ${run.state}`,
      run.state,
    ),
  );
  card.append(header);
  const summary =
    run.error?.message ||
    run.repositorySummary ||
    (
      run.state === "scheduled"
        ? "The exact repository snapshot is queued for bounded semantic reconstruction."
        : run.state === "running"
          ? "The Direct semantic reasoner is reconstructing provisional ARO candidates from exact bounded evidence."
          : "The producer completed without claiming semantic truth or canonical authority."
    );
  card.append(
    textElement(
      "p",
      "inspector-object-summary",
      summary,
    ),
  );
  const facts = textElement(
    "div",
    "aro-reconstruction-facts",
    "",
  );
  const factValues = [
    `attempt ${run.attempt}`,
    snapshot
      ? `${snapshot.workspaceKind} substrate`
      : "snapshot metadata unavailable",
    snapshot?.observationState ===
      "observed"
      ? `${snapshot.evidenceCount} bounded evidence object${
          snapshot.evidenceCount === 1
            ? ""
            : "s"
        }`
      : "repository observation unavailable",
    snapshot?.gitAvailable
      ? `${snapshot.branch || "detached"} · ${String(
          snapshot.headOid || "",
        ).slice(0, 10)}`
      : "Git identity unavailable",
    `${run.candidateRefs.length} candidate${
      run.candidateRefs.length === 1
        ? ""
        : "s"
    } produced`,
  ];
  for (const value of factValues) {
    facts.append(
      textElement(
        "span",
        "",
        value,
      ),
    );
  }
  card.append(facts);
  if (run.selectionRationale) {
    const rationale = textElement(
      "details",
      "aro-candidate-evidence",
      "",
    );
    rationale.append(
      textElement(
        "summary",
        "",
        "Selection rationale",
      ),
      textElement(
        "p",
        "inspector-object-summary",
        run.selectionRationale,
      ),
    );
    card.append(rationale);
  }
  if (run.retryable) {
    const retry = textElement(
      "button",
      "evidence-button aro-reconstruction-retry",
      state.pendingDecisionIds.has(
        run.runRef.id,
      )
        ? "Retrying exact project substrate…"
        : "Observe repository again and retry",
    );
    retry.type = "button";
    retry.disabled =
      state.pendingDecisionIds.has(
        run.runRef.id,
      );
    retry.addEventListener(
      "click",
      () =>
        retryAroReconstruction(run),
    );
    card.append(retry);
  }
  card.append(
    textElement(
      "p",
      "decision-transition-boundary",
      "This producer can register provisional candidates only. Retry re-observes the declared project substrate; review and admission remain separate operator gates and no code is mutated.",
    ),
  );
  elements.aroReconstructionStatus
    .append(card);
}

function contextCanvasRefPayload(
  canvas,
) {
  return {
    contextCanvasId:
      canvas?.contextCanvasRef?.id ||
      "",
    contextCanvasDigest:
      canvas?.contextCanvasRef
        ?.digest || "",
  };
}

async function applyThoughtBrush() {
  const projection =
    contextCanvasProjection();
  const canvas =
    projection?.activeCanvas;
  const projectId =
    canvas?.activeProjectId ||
    state.projection?.activeProjectId ||
    "";
  const brush =
    elements.thoughtBrushSelect
      ?.value ||
    state.selectedThoughtBrush;
  const definition =
    projection?.registry
      ?.definitions?.find(
        (entry) =>
          entry.key === brush,
      );
  const targetProjectId =
    elements.thoughtBrushTarget
      ?.value || "";
  if (
    !projectId ||
    !brush ||
    !bridge
      ?.applyWorldManagerThoughtBrush
  ) {
    showToast(
      "The thought-brush runtime is unavailable.",
      "error",
    );
    return;
  }
  if (
    brush === "switch" &&
    (
      !targetProjectId ||
      targetProjectId === projectId
    )
  ) {
    showToast(
      "Choose a different project before applying Switch.",
      "error",
    );
    return;
  }
  const pendingKey =
    "context-canvas:apply";
  state.pendingDecisionIds.add(
    pendingKey,
  );
  renderContextCanvasInspector();
  try {
    const result =
      await bridge
        .applyWorldManagerThoughtBrush({
          projectId,
          targetProjectId:
            [
              "switch",
              "horizontal_analogy",
              "horizontal_contrast",
            ].includes(brush)
              ? targetProjectId
              : "",
          brush,
          altitude:
            elements
              .thoughtBrushAltitude
              ?.value ||
            definition
              ?.defaultAltitude ||
            "same_as_anchors",
          userInstruction:
            elements
              .thoughtBrushInstruction
              ?.value ||
            definition?.description ||
            "",
          operatorActionId:
            globalThis.crypto
              ?.randomUUID?.() ||
            `wm_brush_${Date.now()}_${Math.random()
              .toString(36)
              .slice(2)}`,
          reasoningEffort: "medium",
          ...contextCanvasRefPayload(
            canvas,
          ),
        });
    applyProjection(
      result?.projection ||
        result,
    );
    const receipt =
      result?.receipt || {};
    if (receipt.state === "completed") {
      state.contextCanvasLens =
        receipt
          .candidateInsightCount > 0
          ? "insights"
          : "canvas";
      showToast(
        `${
          definition?.label ||
          brush.replace(/_/g, " ")
        } applied to a reversible canvas revision. No worldstate changed.`,
      );
    } else {
      showToast(
        receipt.error?.message ||
          "The thought brush was remanded without advancing the canvas.",
        "error",
      );
    }
  } catch (error) {
    showToast(
      error?.message ||
        "The temporary thought brush failed.",
      "error",
    );
    await refresh();
  } finally {
    state.pendingDecisionIds.delete(
      pendingKey,
    );
    render();
  }
}

async function undoContextCanvas() {
  const canvas =
    contextCanvasProjection()
      ?.activeCanvas;
  if (
    !canvas?.undoAvailable ||
    !bridge
      ?.undoWorldManagerContextCanvas
  ) {
    showToast(
      "No prior canvas revision is available to restore.",
      "error",
    );
    return;
  }
  const pendingKey =
    "context-canvas:undo";
  state.pendingDecisionIds.add(
    pendingKey,
  );
  renderContextCanvasInspector();
  try {
    const result =
      await bridge
        .undoWorldManagerContextCanvas({
          projectId:
            canvas.activeProjectId,
          ...contextCanvasRefPayload(
            canvas,
          ),
        });
    applyProjection(
      result?.projection ||
        result,
    );
    state.contextCanvasLens =
      "canvas";
    showToast(
      "The prior canvas posture was restored as a new reversible revision. Worldstate was unchanged.",
    );
  } catch (error) {
    showToast(
      error?.message ||
        "The canvas revision could not be restored.",
      "error",
    );
    await refresh();
  } finally {
    state.pendingDecisionIds.delete(
      pendingKey,
    );
    render();
  }
}

async function extractContextCanvasInsight(
  insight,
) {
  const canvas =
    contextCanvasProjection()
      ?.activeCanvas;
  if (
    !canvas ||
    !insight ||
    !bridge
      ?.extractWorldManagerContextCanvasInsight
  ) {
    showToast(
      "The exact canvas insight is unavailable.",
      "error",
    );
    return;
  }
  const pendingKey =
    `context-insight:${insight.candidateInsightId}`;
  state.pendingDecisionIds.add(
    pendingKey,
  );
  renderContextCanvasInspector();
  try {
    const result =
      await bridge
        .extractWorldManagerContextCanvasInsight({
          schema:
            "direct_context_canvas_insight_extraction_request@1",
          projectId:
            canvas.activeProjectId,
          candidateInsightId:
            insight
              .candidateInsightId,
          ...contextCanvasRefPayload(
            canvas,
          ),
        });
    applyProjection(
      result?.projection ||
        result,
    );
    const candidateRef =
      result?.receipt
        ?.aroCandidateRef;
    const surface =
      (
        state.projection
          ?.semanticSurface
          ?.objectSurfaces || []
      ).find((entry) =>
        entry.objectClass ===
          "aro_reconstruction_candidate" &&
        entry.subjectRef.id ===
          candidateRef?.id &&
        entry.subjectRef.digest ===
          candidateRef?.digest);
    showToast(
      "The insight is now a provisional ARO candidate. It has not been reviewed or admitted.",
    );
    if (surface) {
      focusAroSurface(
        surface,
        {
          reveal: true,
        },
      );
    }
  } catch (error) {
    showToast(
      error?.message ||
        "The insight could not enter the ARO candidate path.",
      "error",
    );
    await refresh();
  } finally {
    state.pendingDecisionIds.delete(
      pendingKey,
    );
    render();
  }
}

function contextCanvasEmpty(
  title,
  summary,
) {
  const empty = textElement(
    "div",
    "context-canvas-empty",
    "",
  );
  empty.append(
    textElement(
      "strong",
      "",
      title,
    ),
    textElement(
      "p",
      "inspector-object-summary",
      summary,
    ),
  );
  return empty;
}

function renderContextCanvasPanel(
  projection,
  canvas,
) {
  clear(
    elements.contextCanvasPanel,
  );
  const lens =
    state.contextCanvasLens;
  if (!canvas) {
    elements.contextCanvasPanel.append(
      contextCanvasEmpty(
        "The canvas is calm",
        "Applying the first brush will initialize a project-scoped, temporary ContextCanvas. It will not change canonical worldstate.",
      ),
    );
    return;
  }
  if (lens === "stack") {
    const refs = new Set(
      canvas.brushStrokeRefs.map(
        (ref) =>
          `${ref.id}:${ref.digest}`,
      ),
    );
    const strokes =
      projection.strokes
        .filter((stroke) =>
          refs.has(
            `${stroke.brushStrokeRef.id}:${stroke.brushStrokeRef.digest}`,
          ))
        .reverse();
    if (!strokes.length) {
      elements.contextCanvasPanel.append(
        contextCanvasEmpty(
          "No active brush strokes",
          "The base canvas contains no semantic transformations yet.",
        ),
      );
      return;
    }
    for (const [
      index,
      stroke,
    ] of strokes.entries()) {
      elements.contextCanvasPanel.append(
        inspectorObject({
          eyebrow:
            `stroke ${index + 1} · ${stroke.altitude}`,
          title:
            stroke.brush
              .replace(/_/g, " "),
          summary:
            stroke.summary,
          stateLabel:
            stroke.state,
        }),
      );
    }
    return;
  }
  if (lens === "insights") {
    if (
      !canvas
        .candidateInsights.length
    ) {
      elements.contextCanvasPanel.append(
        contextCanvasEmpty(
          "No ARO-shaped insight yet",
          "Brush results can remain useful temporary objects. Extraction is offered only when the semantic result forms an intensional object suitable for normal ARO governance.",
        ),
      );
      return;
    }
    for (
      const insight
      of canvas.candidateInsights
    ) {
      const card = inspectorObject({
        eyebrow:
          `${insight.branchCount} branches · ${insight.edgeCount} edges`,
        title:
          insight.semanticIdentity,
        summary:
          insight.rationale,
        stateLabel:
          insight.extractionState,
        actionLabel:
          insight.extractionState ===
            "available"
            ? "Extract ARO candidate"
            : "Inspect ARO candidate",
        onAction: () => {
          if (
            insight.extractionState ===
              "available"
          ) {
            extractContextCanvasInsight(
              insight,
            );
            return;
          }
          const surface =
            semanticSurfaceForSubject(
              "aro_reconstruction_candidate",
              insight
                .extractedAroCandidateRef
                ?.id,
            );
          if (surface) {
            focusAroSurface(
              surface,
              {
                reveal: true,
              },
            );
          }
        },
      });
      const action =
        card.querySelector(
          "button",
        );
      if (action) {
        action.disabled =
          state.pendingDecisionIds
            .has(
              `context-insight:${insight.candidateInsightId}`,
            );
      }
      elements.contextCanvasPanel.append(
        card,
      );
    }
    return;
  }
  const anchors = textElement(
    "section",
    "context-canvas-anchor-region",
    "",
  );
  anchors.append(
    textElement(
      "h4",
      "inspector-section-title",
      `Active anchors · ${canvas.activeAnchorRefs.length}`,
    ),
  );
  if (
    !canvas.activeAnchorRefs.length
  ) {
    anchors.append(
      textElement(
        "p",
        "inspector-empty",
        "No explicit semantic anchor is active.",
      ),
    );
  }
  for (
    const ref
    of canvas.activeAnchorRefs
      .slice(0, 12)
  ) {
    anchors.append(
      inspectorObject({
        eyebrow:
          ref.kind.replace(
            /_/g,
            " ",
          ),
        title:
          ref.label ||
          shortId(ref.id),
        summary:
          shortId(ref.id),
        stateLabel:
          "source",
      }),
    );
  }
  const objects = textElement(
    "section",
    "context-canvas-object-region",
    "",
  );
  objects.append(
    textElement(
      "h4",
      "inspector-section-title",
      `Temporary objects · ${canvas.temporarySemanticObjects.length}`,
    ),
  );
  if (
    !canvas
      .temporarySemanticObjects
      .length
  ) {
    objects.append(
      textElement(
        "p",
        "inspector-empty",
        "No transformed semantic object is active yet.",
      ),
    );
  }
  for (
    const object
    of canvas
      .temporarySemanticObjects
      .slice(-12)
  ) {
    objects.append(
      inspectorObject({
        eyebrow:
          object.objectKind
            .replace(/_/g, " "),
        title: object.label,
        summary:
          object.summary,
        stateLabel:
          object
            .temporaryPosture,
      }),
    );
  }
  elements.contextCanvasPanel.append(
    anchors,
    objects,
  );
}

function renderContextCanvasInspector() {
  const visible =
    productionMode &&
    state.activeInspector ===
      "canvas";
  elements.contextCanvasInspector
    .hidden = !visible;
  if (!visible) return;
  const projection =
    contextCanvasProjection();
  if (!projection) {
    elements.contextCanvasInspectorTitle
      .textContent =
      "ContextCanvas unavailable";
    elements.contextCanvasInspectorSummary
      .textContent =
      "No trusted thought-brush projection is available.";
    return;
  }
  const canvas =
    projection.activeCanvas;
  const activeProjectId =
    canvas?.activeProjectId ||
    state.projection
      ?.activeProjectId ||
    "";
  const activeProjectEntry =
    state.projection?.projects?.find(
      (project) =>
        project.projectId ===
          activeProjectId,
    );
  elements.contextCanvasInspectorTitle
    .textContent =
      activeProjectEntry?.name ||
      "ContextCanvas";
  elements.contextCanvasInspectorSummary
    .textContent =
      canvas
        ? `Revision ${canvas.revision} keeps ${canvas.temporarySemanticObjects.length} temporary semantic object${canvas.temporarySemanticObjects.length === 1 ? "" : "s"} at ${canvas.altitude.replace(/_/g, " ")} altitude.`
        : "Choose a trusted brush to create a reversible semantic workbench for the active project.";
  clear(
    elements.contextCanvasFacts,
  );
  const facts = [
    [
      "posture",
      "temporary · reversible",
    ],
    [
      "active project",
      activeProjectId || "—",
    ],
    [
      "canvas revision",
      String(canvas?.revision || 0),
    ],
    [
      "attention estimate",
      canvas
        ? `${canvas.estimatedAttentionCost.estimatedTokens} tokens · ${canvas.estimatedAttentionCost.sourceObjectCount} sources`
        : "prepared on first stroke",
    ],
    [
      "world effect",
      "none",
    ],
  ];
  for (const [label, value] of facts) {
    const row = textElement(
      "div",
      "settlement-fact",
      "",
    );
    row.append(
      textElement(
        "span",
        "",
        label,
      ),
      textElement(
        "strong",
        "",
        value,
      ),
    );
    elements.contextCanvasFacts.append(
      row,
    );
  }
  const definitions =
    projection.registry
      ?.definitions || [];
  const priorBrush =
    state.selectedThoughtBrush ||
    elements.thoughtBrushSelect
      .value ||
    definitions[0]?.key ||
    "";
  clear(
    elements.thoughtBrushSelect,
  );
  for (const definition of definitions) {
    const option =
      document.createElement(
        "option",
      );
    option.value =
      definition.key;
    option.textContent =
      definition.label;
    elements.thoughtBrushSelect
      .append(option);
  }
  elements.thoughtBrushSelect.value =
    definitions.some(
      (entry) =>
        entry.key === priorBrush,
    )
      ? priorBrush
      : definitions[0]?.key ||
        "";
  state.selectedThoughtBrush =
    elements.thoughtBrushSelect
      .value;
  const definition =
    definitions.find(
      (entry) =>
        entry.key ===
          state.selectedThoughtBrush,
    );
  const priorTarget =
    elements.thoughtBrushTarget
      .value;
  clear(
    elements.thoughtBrushTarget,
  );
  const noTarget =
    document.createElement(
      "option",
    );
  noTarget.value = "";
  noTarget.textContent =
    "No secondary project";
  elements.thoughtBrushTarget.append(
    noTarget,
  );
  for (
    const project
    of state.projection?.projects ||
    []
  ) {
    const option =
      document.createElement(
        "option",
      );
    option.value =
      project.projectId;
    option.textContent =
      project.projectId ===
        activeProjectId
        ? `${project.name} · active`
        : project.name;
    elements.thoughtBrushTarget
      .append(option);
  }
  elements.thoughtBrushTarget.value =
    (
      state.projection?.projects ||
      []
    ).some((project) =>
      project.projectId ===
        priorTarget)
      ? priorTarget
      : "";
  const relatedProjectUseful =
    [
      "switch",
      "horizontal_analogy",
      "horizontal_contrast",
    ].includes(
      definition?.key,
    );
  elements.thoughtBrushTarget.disabled =
    !relatedProjectUseful;
  if (
    !elements
      .thoughtBrushAltitude
      .dataset.edited ||
    !elements
      .thoughtBrushAltitude
      .value
  ) {
    elements.thoughtBrushAltitude.value =
      definition?.defaultAltitude ||
      canvas?.altitude ||
      "same_as_anchors";
  }
  if (
    !elements
      .thoughtBrushInstruction
      .value &&
    state.thoughtBrushDirection
  ) {
    elements.thoughtBrushInstruction.value =
      state.thoughtBrushDirection;
  }
  elements.thoughtBrushPreview
    .textContent =
      `${definition?.description || "Select a semantic transformation."} Preview: ${definition?.direction?.replace(/_/g, " ") || "bounded transformation"} · ${definition?.compositionPosture || "extend"} canvas · no canonical or external effect.`;
  const pending =
    state.pendingDecisionIds.has(
      "context-canvas:apply",
    ) ||
    state.pendingDecisionIds.has(
      "context-canvas:undo",
    );
  elements.applyThoughtBrush.disabled =
    pending ||
    !projection.available ||
    (
      definition?.key ===
        "switch" &&
      (
        !elements
          .thoughtBrushTarget
          .value ||
        elements
          .thoughtBrushTarget
          .value ===
          activeProjectId
      )
    );
  elements.applyThoughtBrush.textContent =
    state.pendingDecisionIds.has(
      "context-canvas:apply",
    )
      ? "Applying semantic brush…"
      : "Apply temporary brush";
  elements.undoContextCanvas.disabled =
    pending ||
    !canvas?.undoAvailable;
  elements.undoContextCanvas.textContent =
    state.pendingDecisionIds.has(
      "context-canvas:undo",
    )
      ? "Restoring prior posture…"
      : "Undo last canvas move";
  const lenses = [
    [
      "canvas",
      `Canvas · ${
        canvas
          ?.temporarySemanticObjects
          ?.length || 0
      }`,
    ],
    [
      "stack",
      `Brush stack · ${
        canvas
          ?.brushStrokeRefs
          ?.length || 0
      }`,
    ],
    [
      "insights",
      `Insights · ${
        canvas
          ?.candidateInsights
          ?.length || 0
      }`,
    ],
  ];
  clear(
    elements.contextCanvasLenses,
  );
  for (const [key, label] of lenses) {
    const button = textElement(
      "button",
      key ===
        state.contextCanvasLens
        ? "active"
        : "",
      label,
    );
    button.type = "button";
    button.setAttribute(
      "aria-pressed",
      String(
        key ===
          state.contextCanvasLens,
      ),
    );
    button.addEventListener(
      "click",
      () => {
        state.contextCanvasLens =
          key;
        renderContextCanvasInspector();
      },
    );
    elements.contextCanvasLenses.append(
      button,
    );
  }
  renderContextCanvasPanel(
    projection,
    canvas,
  );
}

function renderAroInspector() {
  const visible =
    productionMode &&
    state.activeInspector === "aros";
  elements.aroInspector.hidden = !visible;
  if (!visible) return;
  const registry =
    aroRegistryProjection();
  const projectId =
    state.inspectedProjectId ||
    state.projection?.activeProjectId ||
    "";
  const project =
    state.projection?.projects?.find(
      (entry) =>
        entry.projectId === projectId,
    );
  const surfaces =
    (semanticSurfaceProjection()
      ?.objectSurfaces || [])
      .filter((surface) =>
        [
          "aro_reconstruction_candidate",
          "abstract_reasoning_object",
          "aro_coverage_witness",
          "aro_current_target_comparison",
        ].includes(
          surface.objectClass,
        ) &&
        (
          !projectId ||
          surface.projectId === projectId
        ));
  const candidateSurfaces = surfaces.filter(
    (surface) =>
      surface.objectClass ===
        "aro_reconstruction_candidate",
  );
  const candidates =
    candidateSurfaces.filter((surface) =>
      aroObjectForSurface(surface)
        ?.lifecycle === "candidate");
  const admittedCandidateHistory =
    candidateSurfaces.filter((surface) =>
      aroObjectForSurface(surface)
        ?.lifecycle === "admitted");
  const comparisons = surfaces.filter(
    (surface) =>
      surface.objectClass ===
        "aro_current_target_comparison",
  );
  const canonicalCoverageKeys =
    new Set(
      (registry?.canonicalAros || [])
        .map((aro) =>
          aro.coverageWitness)
        .filter(Boolean)
        .map((witness) =>
          `${witness.coverageWitnessId}:${witness.digest}`),
    );
  const registrySurfaces =
    surfaces.filter((surface) =>
      surface.objectClass ===
        "abstract_reasoning_object" ||
      (
        surface.objectClass ===
          "aro_coverage_witness" &&
        canonicalCoverageKeys.has(
          `${surface.subjectRef.id}:${surface.subjectRef.digest}`,
        )
      ));
  const canonicalCurrent =
    (registry?.canonicalAros || [])
      .filter((aro) =>
        aro.projectId === projectId &&
        aro.posture === "current");
  const canonicalTarget =
    (registry?.canonicalAros || [])
      .filter((aro) =>
        aro.projectId === projectId &&
        aro.posture === "target");
  const comparisonEmptyMessage =
    !canonicalCurrent.length
      ? "Admit a current ARO first. A comparison requires one canonical current and one canonical target with the same concept key."
      : !canonicalTarget.length
        ? "No canonical target exists yet. Focus a current ARO and describe its desired target posture."
        : "Canonical current and target AROs exist, but none share the same concept key yet.";
  elements.aroInspectorTitle.textContent =
    project
      ? `${project.name} semantic anatomy`
      : "Semantic implementation anatomy";
  elements.aroInspectorSummary.textContent =
    registry
      ? `${candidates.length} provisional ARO candidate${candidates.length === 1 ? "" : "s"} · ${registrySurfaces.filter((surface) => surface.objectClass === "abstract_reasoning_object").length} canonical ARO${registrySurfaces.filter((surface) => surface.objectClass === "abstract_reasoning_object").length === 1 ? "" : "s"}. Branch meaning stays primary; code is a realization binding.`
      : "The ARO registry is unavailable in this projection.";
  renderAroReconstructionStatus(
    registry,
    projectId,
  );
  clear(elements.aroFocusedObject);
  if (!surfaces.length) {
    clear(elements.aroCandidateList);
    clear(elements.aroHistoryList);
    clear(elements.aroCurrentTargetList);
    clear(elements.aroRegistryList);
    elements.aroFocusedObject.append(
      textElement(
        "p",
        "inspector-empty",
        "No provisional ARO candidate or canonical semantic model is registered for this project yet.",
      ),
    );
    return;
  }
  const orderedSurfaces = [
    ...candidates,
    ...admittedCandidateHistory,
    ...comparisons,
    ...registrySurfaces,
  ];
  let focusedSurface =
    orderedSurfaces.find((surface) =>
      surface.semanticObjectSurfaceId ===
        state.selectedSemanticSurfaceId) ||
    orderedSurfaces.find((surface) =>
      surface.subjectRef.id ===
        state.selectedAroSubjectId &&
      surface.objectClass ===
        state.selectedAroObjectClass) ||
    orderedSurfaces[0];
  state.selectedSemanticSurfaceId =
    focusedSurface
      .semanticObjectSurfaceId;
  state.selectedAroSubjectId =
    focusedSurface.subjectRef.id;
  state.selectedAroObjectClass =
    focusedSurface.objectClass;

  renderAroNavigatorSection(
    elements.aroCandidateList,
    "Provisional ARO candidates",
    candidates,
    focusedSurface,
  );
  renderAroNavigatorSection(
    elements.aroHistoryList,
    "Admitted reconstruction lineage",
    admittedCandidateHistory,
    focusedSurface,
  );
  renderAroNavigatorSection(
    elements.aroCurrentTargetList,
    "Current / target comparisons",
    comparisons,
    focusedSurface,
    comparisonEmptyMessage,
  );
  renderAroNavigatorSection(
    elements.aroRegistryList,
    "Canonical registry and coverage",
    registrySurfaces,
    focusedSurface,
  );
  elements.aroFocusedObject.append(
    textElement(
      "span",
      "inspector-object-kind aro-focused-object-label",
      "Focused semantic object",
    ),
    aroSurfaceCard(focusedSurface),
  );
}

function renderSettlement() {
  const evidence = state.projection?.evidence;
  const semanticIngress = evidence?.latestSemanticIngress;
  const settlement = evidence?.latestSettlement;
  const routing = evidence?.latestRoutingDecision;
  const context = evidence?.latestManagerContext;
  const agentWorld = evidence?.latestAgentWorld;
  const agentResult = evidence?.latestAgentResult?.agentResult;
  const latestRoleRun = evidence?.latestRoleRun;
  const semanticSplit =
    state.projection?.semanticSplit;
  const splitState =
    semanticSplit &&
    semanticSplit.state !== "completed"
      ? semanticSplit.state
      : "";
  const visible = productionMode && Boolean(settlement);
  elements.settlementPanel.hidden = !visible;
  if (!visible) return;
  const needsClarification = ["clarification_required", "remanded"].includes(
    settlement.state,
  );
  elements.settlementTitle.textContent = needsClarification
    ? "Clarification before routing"
    : agentResult
      ? `${formatRole(settlement.responsibleRole)} result`
    : agentWorld
      ? `${formatRole(settlement.responsibleRole)} constitution`
      : `${formatRole(settlement.responsibleRole)} context`;
  elements.settlementState.textContent = splitState
    ? splitState.replace(/_/g, " ")
    : agentWorld
    ? agentResult?.resultState || "agent world ready"
    : context
      ? "context ready"
    : settlement.state.replace(/_/g, " ");
  elements.settlementState.className = `state-badge ${
    needsClarification
      ? "candidate"
      : splitState
        ? "candidate"
      : agentResult?.resultState === "completed"
        ? "ready"
      : agentResult
        ? "candidate"
      : agentWorld || context
        ? "ready"
        : "processing"
  }`;
  elements.settlementSummary.textContent = settlement.rationale || "";
  clear(elements.settlementFacts);
  const facts = [
    [
      "semantic lane",
      String(semanticIngress?.primaryLane || "—").replace(/_/g, " "),
    ],
    ["project", settlement.projectId || "world scope"],
    ["task", String(settlement.taskType || "unknown").replace(/_/g, " ")],
    ["tier", settlement.settlementTier || "—"],
    ["route", routing?.decision || "—"],
    [
      "graph cut",
      context
        ? `${context.selectedNodeCount} nodes · ${context.selectedEdgeCount} edges`
        : "not prepared",
    ],
    [
      "policy closure",
      agentWorld
        ? `${agentWorld.policyObjectCount} ${
            agentWorld.policySourcePostures?.every((posture) =>
              posture === "trusted_harness_constitution")
              ? "harness baseline "
              : ""
          }policies · ${agentWorld.policyClosureState}`
        : "not compiled",
    ],
    [
      "role template",
      agentWorld?.roleTemplateId || "not compiled",
    ],
    [
      "capabilities",
      agentWorld
        ? `${agentWorld.toolCount} tools · mutation denied`
        : "not compiled",
    ],
    [
      "launch",
      agentWorld
        ? String(agentWorld.launchBoundary || "blocked").replace(/_/g, " ")
        : "not eligible",
    ],
    [
      "provider role",
      agentResult
        ? `${latestRoleRun?.state || agentResult.resultState} · persisted Direct`
        : context?.providerRoleTurnState === "not_started"
          ? "not started"
          : "not available",
    ],
  ];
  for (const [label, value] of facts) {
    const row = textElement("div", "settlement-fact", "");
    row.append(textElement("span", "", label), textElement("strong", "", value));
    elements.settlementFacts.append(row);
  }
  elements.clarificationPrompt.hidden = !needsClarification;
  elements.clarificationPrompt.textContent = needsClarification
    ? settlement.clarificationPrompt
    : "";
}

function epistemicScopeLabel(scope = {}) {
  if (!scope?.projectId) return "scope unavailable";
  return scope.kind === "workthread"
    ? `${scope.projectId} / ${scope.workThreadId || "work thread"}`
    : `${scope.projectId} / ${scope.kind || "project"}`;
}

function appendEpistemicRefs(container, label, refs = []) {
  container.append(textElement("span", "inspector-object-kind", label));
  for (const ref of refs.filter(Boolean)) {
    container.append(
      textElement("code", "", `${ref.kind}:${shortId(ref.id)}`),
    );
  }
  if (!refs.filter(Boolean).length) {
    container.append(textElement("small", "", "No exact refs projected."));
  }
}

function epistemicLifecycleStages(card) {
  const stateOrder = [
    "requested",
    "under_production",
    "candidate",
    "under_audit",
    "gate_ready",
    "admission_pending",
    "admitted",
  ];
  const currentIndex = stateOrder.indexOf(card.state);
  const stages = [
    ["Production", 1],
    ["Candidate", 2],
    ["Audit", 3],
    ["Gate", 4],
    ["Admission", 6],
  ];
  return stages.map(([label, threshold], index) => {
    let posture = currentIndex > threshold ? "complete" :
      currentIndex === threshold ? "current" : "future";
    if (label === "Gate" && card.state === "gate_ready") posture = "ready";
    if (label === "Admission") {
      posture = card.authorityState === "admitted"
        ? "authoritative"
        : card.authorityState === "failed"
          ? "failed"
          : card.authorityState === "admission_pending"
            ? "current"
            : "future";
    }
    if (card.state === "remanded" && index >= 2) posture = "remanded";
    return { label, posture };
  });
}

async function requestEpistemicArtifactAdmission(card) {
  if (
    !bridge?.requestWorldManagerArtifactAdmission ||
    card.authorityState !== "gate_ready" ||
    card.admissionRequestEligible !== true ||
    state.pendingEpistemicAdmissionId
  ) return;
  state.pendingEpistemicAdmissionId = card.lifecycleRef.id;
  state.reviewingEpistemicAdmissionId = "";
  renderEpistemicFabricInspector();
  try {
    const response = await bridge.requestWorldManagerArtifactAdmission({
      schema: "direct_world_manager_artifact_admission_request@1",
      lifecycleId: card.lifecycleRef.id,
      lifecycleRef: card.lifecycleRef,
      artifactRevisionRef: card.currentArtifactRevisionRef,
      gateDecisionRef: card.gateDecisionRef,
      admissionAuthorityRef: card.admissionAuthorityRef,
      targetAdmissionScope: card.targetAdmissionScope,
      expectedCanonicalRevisionRefs:
        card.expectedCanonicalRevisionRefs || [],
      reviewedEvidenceRefs: card.evidenceRefs || [],
      operatorReviewAcknowledged: true,
    });
    applyProjection(response?.projection || response);
    const posture = response?.result?.receipt?.receiptPosture || "completed";
    showToast(
      posture === "admitted"
        ? "Scoped canonical admission was persisted."
        : `Admission request completed with ${posture.replaceAll("_", " ")} posture.`,
      posture === "admitted" ? "info" : "error",
    );
  } catch (error) {
    showToast(error?.message || "Scoped admission request failed.", "error");
  } finally {
    state.pendingEpistemicAdmissionId = "";
    renderEpistemicFabricInspector();
  }
}

function renderEpistemicFabricInspector() {
  const inspector = elements.epistemicFabricInspector;
  if (!inspector) return;
  const fabric = state.projection?.epistemicFabric;
  const visible =
    productionMode &&
    state.activeInspector === "epistemic" &&
    fabric?.schema ===
      "direct_epistemic_fabric_projection@1";
  inspector.hidden = !visible;
  if (!visible) return;

  const summary = fabric.summary || {};
  elements.epistemicFabricTitle.textContent =
    summary.gateReadyCount
      ? `${summary.gateReadyCount} artifact lifecycle ready for an authority decision`
      : summary.remandedArtifactCount
        ? `${summary.remandedArtifactCount} artifact lifecycle needs revision`
        : "Artifact lifecycles & attention routes";
  elements.epistemicFabricSummary.textContent =
    `${fabric.ledgerDescriptor?.globalSequence || 0} immutable epistemic acts · ` +
    `${fabric.lifecycleCards?.length || 0} artifact lifecycles · ` +
    `${summary.queuedDeliveryCount || 0} queued deliveries. ` +
    "The default view keeps routine progress quiet while preserving exact lineage.";

  clear(elements.epistemicFabricFacts);
  for (const [label, value] of [
    ["ledger", fabric.ledgerDescriptor?.verified ? "restart verified" : "diagnostic"],
    ["candidates", summary.candidateArtifactCount || 0],
    ["remanded", summary.remandedArtifactCount || 0],
    ["gate ready", summary.gateReadyCount || 0],
    ["admission pending", summary.admissionPendingCount || 0],
    ["admission failed", summary.admissionFailedCount || 0],
    ["admitted", summary.admittedArtifactCount || 0],
  ]) {
    const fact = textElement("div", "settlement-fact", "");
    fact.append(
      textElement("span", "", label),
      textElement("strong", "", String(value)),
    );
    elements.epistemicFabricFacts.append(fact);
  }

  const cards = fabric.lifecycleCards || [];
  if (
    !state.selectedEpistemicLifecycleId ||
    !cards.some((card) =>
      card.lifecycleRef.id ===
        state.selectedEpistemicLifecycleId)
  ) {
    state.selectedEpistemicLifecycleId =
      fabric.focusedLifecycle?.lifecycleRef?.id ||
      cards[0]?.lifecycleRef?.id ||
      "";
  }
  clear(elements.epistemicLifecycleList);
  if (!cards.length) {
    elements.epistemicLifecycleList.append(
      textElement(
        "p",
        "inspector-empty",
        "No artifact lifecycle has been activated. The ledger remains available for role-governed epistemic acts.",
      ),
    );
  }
  for (const card of cards) {
    const selected =
      card.lifecycleRef.id ===
      state.selectedEpistemicLifecycleId;
    const button = textElement(
      "button",
      `aro-object-nav-entry ${selected ? "selected" : ""}`,
      "",
    );
    button.type = "button";
    button.dataset.lifecycleId = card.lifecycleRef.id;
    button.append(
      textElement(
        "span",
        "inspector-object-kind",
        card.artifactTypeRef?.id || "artifact lifecycle",
      ),
      textElement(
        "strong",
        "",
        `${card.projectId || "world"} · ${card.stateLabel}`,
      ),
      textElement(
        "small",
        "",
        `${card.satisfiedAuditCount}/${card.requiredAuditCount} audits · ${card.blockerCount} blockers`,
      ),
    );
    button.addEventListener("click", () => {
      state.selectedEpistemicLifecycleId =
        card.lifecycleRef.id;
      if (
        state.reviewingEpistemicAdmissionId !==
        card.lifecycleRef.id
      ) {
        state.reviewingEpistemicAdmissionId = "";
      }
      renderEpistemicFabricInspector();
      elements.epistemicFocusedLifecycle.focus();
    });
    elements.epistemicLifecycleList.append(button);
  }

  clear(elements.epistemicFocusedLifecycle);
  const focused = cards.find((card) =>
    card.lifecycleRef.id ===
      state.selectedEpistemicLifecycleId);
  if (!focused) {
    elements.epistemicFocusedLifecycle.append(
      textElement(
        "p",
        "inspector-empty",
        "Select an artifact lifecycle to inspect its assurance and authority posture.",
      ),
    );
  } else {
    const heading = textElement(
      "div",
      "aro-focused-object-label",
      "",
    );
    heading.append(
      textElement("span", "inspector-object-kind", "Focused lifecycle"),
      textElement("strong", "", focused.artifactTypeRef?.id || focused.lifecycleRef.id),
      textElement("span", `state-badge ${focused.canonical ? "canonical" : "candidate"}`, focused.stateLabel),
    );
    const lifecycleTrack = textElement(
      "div",
      "epistemic-lifecycle-track",
      "",
    );
    lifecycleTrack.dataset.morphicRegion = "artifact-lifecycle-graph";
    for (const stage of epistemicLifecycleStages(focused)) {
      const node = textElement(
        "div",
        `epistemic-lifecycle-stage ${stage.posture}`,
        "",
      );
      node.append(
        textElement("span", "epistemic-stage-marker", ""),
        textElement("strong", "", stage.label),
        textElement("small", "", stage.posture.replaceAll("_", " ")),
      );
      lifecycleTrack.append(node);
    }
    const workbench = textElement(
      "div",
      "epistemic-focused-workbench",
      "",
    );
    const evidenceLane = textElement(
      "section",
      "epistemic-workbench-lane epistemic-assurance-lane",
      "",
    );
    evidenceLane.dataset.evidenceBearingRegion = "true";
    evidenceLane.append(
      textElement("span", "inspector-object-kind", "Evidence & assurance lane"),
    );
    const assurance = inspectorObject({
      eyebrow: "assurance graph",
      title: `${focused.satisfiedAuditCount}/${focused.requiredAuditCount} required audits supported`,
      summary:
        focused.blockerCount
          ? `${focused.blockerCount} blockers remain. No authority transition is eligible.`
          : focused.state === "gate_ready"
            ? "Evidence and audit standing support this exact revision. Canonical admission has not occurred."
            : focused.state === "admitted"
              ? "An exact canonical receipt was observed for the declared target scope."
              : "Assurance remains an inspectable lifecycle posture, not a completion claim.",
      stateLabel: focused.assurancePosture,
    });
    evidenceLane.append(assurance);
    const provenance = textElement("div", "epistemic-provenance-lane", "");
    provenance.append(
      textElement("span", "inspector-object-kind", "Producer & auditor provenance"),
    );
    if (focused.producerAssignmentRef) {
      provenance.append(
        textElement(
          "code",
          "",
          `producer:${shortId(focused.producerAssignmentRef.id)}`,
        ),
      );
    }
    for (const audit of focused.auditAssignments || []) {
      const auditRow = textElement("div", "epistemic-audit-row", "");
      auditRow.append(
        textElement("strong", "", audit.auditType.replaceAll("_", " ")),
        textElement(
          "span",
          `state-badge ${audit.verdict === "supported" ? "validated" : "candidate"}`,
          audit.verdict,
        ),
        textElement(
          "small",
          "",
          `${shortId(audit.auditorAgentRef?.id)} · independence ${shortId(audit.independenceReceiptRef?.id)}`,
        ),
      );
      provenance.append(auditRow);
    }
    evidenceLane.append(provenance);
    const authority = inspectorObject({
      eyebrow: "authority gate",
      title: focused.authorityState.replaceAll("_", " "),
      summary:
        focused.authorityState === "gate_ready"
          ? "An authorized actor may request admission after inspecting the same-context evidence."
          : focused.authorityState === "admitted"
            ? "Canonical styling is backed by an exact admission receipt."
          : focused.authorityState === "failed"
            ? `Admission failed closed: ${focused.admissionFailureCode || "unknown failure"}.`
            : focused.authorityState === "admission_pending"
              ? "A scoped authority request is pending; no canonical success is inferred."
              : "No canonical authority transition is currently represented.",
      stateLabel: focused.canonical ? "canonical" : "non-canonical",
    });
    const evidence = textElement("div", "epistemic-evidence-refs", "");
    appendEpistemicRefs(evidence, "Exact evidence refs", focused.evidenceRefs);
    evidenceLane.append(evidence);
    const authorityLane = textElement(
      "section",
      "epistemic-workbench-lane epistemic-authority-lane",
      "",
    );
    authorityLane.dataset.authorityBoundary = "scoped-canonical-admission";
    authorityLane.append(
      textElement("span", "inspector-object-kind", "Authority & receipts lane"),
      authority,
    );
    const scope = textElement("div", "epistemic-admission-scope", "");
    scope.append(
      textElement("strong", "", "Declared target scope"),
      textElement("span", "", epistemicScopeLabel(focused.targetAdmissionScope)),
      textElement(
        "small",
        "",
        "Admission changes only this scope and executes no downstream effect.",
      ),
    );
    authorityLane.append(scope);
    const gateRefs = textElement("div", "epistemic-evidence-refs", "");
    appendEpistemicRefs(gateRefs, "Gate & canonical CAS refs", [
      focused.gateDecisionRef,
      focused.admissionAuthorityRef,
      ...(focused.expectedCanonicalRevisionRefs || []),
    ]);
    authorityLane.append(gateRefs);
    const receiptRefs = textElement("div", "epistemic-evidence-refs", "");
    appendEpistemicRefs(receiptRefs, "Admission receipt lineage", [
      focused.pendingAdmissionReceiptRef,
      focused.admissionFailureReceiptRef,
      focused.admissionReceiptRef,
      focused.trustStoreReceiptRef,
    ]);
    authorityLane.append(receiptRefs);
    const actionCluster = textElement(
      "div",
      "epistemic-admission-actions commit-cluster",
      "",
    );
    actionCluster.dataset.authorityBearingControl = "artifact-admission-request";
    const pending = state.pendingEpistemicAdmissionId === focused.lifecycleRef.id;
    const reviewing =
      state.reviewingEpistemicAdmissionId === focused.lifecycleRef.id;
    if (reviewing && focused.authorityState === "gate_ready") {
      actionCluster.append(
        textElement(
          "p",
          "epistemic-admission-review",
          `Confirm admission of the exact displayed revision to ${epistemicScopeLabel(focused.targetAdmissionScope)}. This does not run or publish anything.`,
        ),
      );
      const cancel = textElement("button", "evidence-button", "Keep gate ready");
      cancel.type = "button";
      cancel.addEventListener("click", () => {
        state.reviewingEpistemicAdmissionId = "";
        renderEpistemicFabricInspector();
      });
      const confirm = textElement(
        "button",
        "commit-button epistemic-confirm-admission",
        "Confirm scoped admission",
      );
      confirm.type = "button";
      confirm.addEventListener("click", () =>
        requestEpistemicArtifactAdmission(focused));
      actionCluster.append(cancel, confirm);
    } else {
      const request = textElement(
        "button",
        "commit-button epistemic-review-admission",
        pending
          ? "Admission request pending"
          : focused.authorityState === "admitted"
            ? "Canonical admission recorded"
            : focused.authorityState === "failed"
              ? "Admission failed closed"
              : "Review scoped admission",
      );
      request.type = "button";
      request.disabled =
        pending ||
        focused.authorityState !== "gate_ready" ||
        focused.admissionRequestEligible !== true ||
        !bridge?.requestWorldManagerArtifactAdmission;
      request.title = request.disabled && focused.authorityState !== "admitted"
        ? "Available only for an exact gate-ready revision with current authority."
        : "";
      request.addEventListener("click", () => {
        state.reviewingEpistemicAdmissionId = focused.lifecycleRef.id;
        renderEpistemicFabricInspector();
        elements.epistemicFocusedLifecycle
          .querySelector(".epistemic-confirm-admission")
          ?.focus();
      });
      actionCluster.append(request);
    }
    authorityLane.append(actionCluster);
    workbench.append(evidenceLane, authorityLane);
    elements.epistemicFocusedLifecycle.append(
      heading,
      lifecycleTrack,
      workbench,
    );
  }

  clear(elements.epistemicActivityList);
  const activity = fabric.materialActivityItems || [];
  if (!activity.length) {
    elements.epistemicActivityList.append(
      textElement("p", "inspector-empty", "No material transition currently requires attention."),
    );
  }
  for (const item of activity.slice().reverse()) {
    elements.epistemicActivityList.append(
      inspectorObject({
        eyebrow: `${item.role} · ${item.actClass}`,
        title: item.actType,
        summary: item.summary,
        stateLabel: item.posture,
      }),
    );
  }

  clear(elements.epistemicDeliveryList);
  const deliveries = fabric.deliveries || [];
  if (!deliveries.length) {
    elements.epistemicDeliveryList.append(
      textElement("p", "inspector-empty", "No delivery envelopes have been materialized."),
    );
  }
  for (const delivery of deliveries.slice().reverse()) {
    const canAcknowledge =
      delivery.deliveryPosture !== "acknowledged" &&
      bridge?.acknowledgeWorldManagerLedgerDelivery;
    const entry = inspectorObject({
      eyebrow: `recipient · ${delivery.recipientRole}`,
      title: `${delivery.eventRefs.length} bounded event${delivery.eventRefs.length === 1 ? "" : "s"}`,
      summary: delivery.wakeEligible
        ? "Delivery is wake-eligible under admitted standing; wake remains a separate runtime transition."
        : "Delivery updates the semantic inbox without asserting that a model was awakened.",
      stateLabel: delivery.deliveryPosture,
      actionLabel: canAcknowledge ? "Acknowledge delivery" : "",
      onAction: canAcknowledge
        ? async () => {
            try {
              const result = await bridge.acknowledgeWorldManagerLedgerDelivery({
                deliveryId: delivery.deliveryRef.id,
                acknowledgedByRef: {
                  kind: "operator",
                  id: "operator",
                  digest: delivery.deliveryRef.digest,
                },
              });
              applyProjection(result?.projection || result);
              showToast("Delivery acknowledgement and cursor were persisted.");
            } catch (error) {
              showToast(error?.message || "Delivery acknowledgement failed.", "error");
            }
          }
        : null,
    });
    elements.epistemicDeliveryList.append(entry);
  }
}

function renderOperationalMetaContext() {
  const contextProjection =
    state.projection?.operationalMetaContext;
  const latest =
    contextProjection?.latest;
  const ribbon =
    unifiedProjection()
      ?.operationalRibbon;
  const visible =
    productionMode &&
    Boolean(ribbon);
  elements.operationalContextRibbon.hidden = !visible;
  if (!visible) return;
  const freshness =
    ribbon.context?.state ||
    latest?.freshness ||
    "not_prepared";
  elements.operationalContextRibbon.dataset.freshness =
    freshness;
  elements.operationalContextState.textContent =
    freshness;
  elements.operationalContextSummary.textContent =
    `${ribbon.scope?.label || "world scope"} · ` +
    `${String(
      ribbon.lane || "conversation",
    ).replace(/_/g, " ")} · ` +
    `${String(
      ribbon.altitude || "world",
    ).replace(/_/g, " ")}`;
  clear(
    elements.operationalContextChips,
  );
  const chips = [
    [
      "scope",
      ribbon.scope?.label ||
        "world scope",
    ],
    [
      "lane",
      String(
        ribbon.lane ||
          "conversation",
      ).replace(/_/g, " "),
    ],
    [
      "altitude",
      String(
        ribbon.altitude ||
          "world",
      ).replace(/_/g, " "),
    ],
    [
      "context",
      ribbon.context?.state ===
        "not_prepared"
        ? "none imported"
        : `${
            ribbon.context
              ?.sourceShelfCount || 0
          } shelves · ${
            ribbon.context
              ?.estimatedInputTokens || 0
          } tokens`,
    ],
    [
      "brush",
      ribbon.thoughtOperation
        ?.state === "active"
        ? String(
            ribbon.thoughtOperation
              .brush,
          ).replace(/_/g, " ")
        : "none",
    ],
  ];
  for (const [label, value] of chips) {
    const chip = textElement(
      "span",
      "context-ribbon-chip",
      "",
    );
    chip.dataset.contextDimension =
      label;
    chip.append(
      textElement("small", "", label),
      textElement("strong", "", value),
    );
    elements.operationalContextChips
      .append(chip);
  }
  clear(elements.operationalContextFacts);
  const facts = [
    [
      "event",
      shortId(
        ribbon.activeEventRef?.id,
      ),
    ],
    [
      "purpose",
      latest?.purpose || "—",
    ],
    [
      "scope",
      ribbon.scope?.label ||
        "world scope",
    ],
    [
      "shelves",
      `${ribbon.context?.sourceShelfCount || 0} · ${
        (latest?.sourceShelfKinds || []).join(", ") ||
        "none"
      }`,
    ],
    [
      "open decisions",
      String(
        latest?.openDecisionCount || 0,
      ),
    ],
    [
      "selection",
      ribbon.context?.state ===
        "not_prepared"
        ? "not prepared"
        : ribbon.context
            ?.truncated
          ? `budget-truncated · ${ribbon.context.omissionCount} omitted`
          : "complete within budget",
    ],
    [
      "request lineage",
      latest?.requestManifestLinkState === "linked"
        ? `linked · ${shortId(
            latest.requestManifestId,
          )}`
        : String(
            latest?.requestManifestLinkState ||
              "pending",
          ).replace(/_/g, " "),
    ],
    [
      "thought operation",
      ribbon.thoughtOperation
        ?.state === "active"
        ? `${String(
            ribbon.thoughtOperation
              .brush,
          ).replace(/_/g, " ")} · ${
            ribbon.thoughtOperation
              .stackDepth
          } strokes`
        : "none",
    ],
    [
      "input parity",
      unifiedProjection()
        ?.interactionParity
        ?.voiceTransportState ===
          "ready"
        ? "keyboard · pointer · voice"
        : "keyboard · pointer · voice contract ready / transport deferred",
    ],
    [
      "authority",
      "read only · no world effect",
    ],
  ];
  for (const [label, value] of facts) {
    const row = textElement(
      "div",
      "context-ribbon-fact",
      "",
    );
    row.append(
      textElement("span", "", label),
      textElement("strong", "", value),
    );
    elements.operationalContextFacts.append(row);
  }
}

function renderReconciliation() {
  const reconciliation = state.projection?.reconciliation;
  const proposal = state.projection?.latestProposal;
  const visible = productionMode
    ? Boolean(
        reconciliation &&
        ![
          "unavailable_k3",
          "awaiting_agent_result",
          "not_required",
        ].includes(
          reconciliation.state,
        ),
      )
    : Boolean(
        proposal &&
        reconciliation &&
        reconciliation.state !== "idle",
      );
  elements.reconciliationPanel.hidden = !visible;
  if (!visible) return;
  elements.reconciliationTitle.textContent = reconciliation.state === "processing"
    ? "Reading the higher posture"
    : reconciliation.state === "reconciled"
      ? "World posture reconciled"
    : reconciliation.state === "pending"
      ? "Awaiting WorldManager"
    : reconciliation.state === "admitted"
      ? "Proposal admitted"
      : "Candidate posture";
  elements.reconciliationState.textContent = reconciliation.state;
  elements.reconciliationState.className = `state-badge ${
    reconciliation.state === "admitted"
      ? "canonical"
      : ["processing", "pending"].includes(reconciliation.state)
        ? "processing"
        : reconciliation.state === "reconciled"
          ? "ready"
          : "candidate"
  }`;
  elements.reconciliationSummary.textContent = reconciliation.summary || "";
  renderList(elements.blindspotList, reconciliation.blindspots);
  renderList(elements.continuationList, reconciliation.continuationPaths);
}

function renderProposal() {
  const proposal = state.projection?.latestProposal;
  elements.proposalPanel.hidden = !proposal;
  if (!proposal) return;
  elements.proposalTitle.textContent = proposal.title;
  elements.proposalState.textContent = proposal.state;
  elements.proposalState.className = `state-badge ${proposal.state === "canonical" ? "canonical" : "candidate"}`;
  elements.proposalSummary.textContent = proposal.summary || "";
  clear(elements.featureList);
  for (const feature of proposal.features || []) {
    const row = textElement("div", "feature", "");
    const copy = textElement("div", "", "");
    copy.append(textElement("strong", "", feature.title), textElement("span", "", feature.outcome));
    row.append(copy);
    elements.featureList.append(row);
  }
  const reviewed = proposal.evidenceReviewState === "reviewed";
  const reconciled = proposal.reconciliationState === "reconciled";
  const candidate = proposal.state === "candidate";
  elements.inspectEvidenceButton.textContent = reviewed ? "Reopen semantic lineage" : "Inspect semantic lineage";
  elements.greenlightButton.disabled = !(reviewed && reconciled && candidate) || state.projection.busy;
  elements.greenlightButton.hidden = proposal.state === "canonical";
  elements.greenlightGate.textContent = proposal.state === "canonical"
    ? "Canonical admission is recorded in the lineage."
    : !reconciled
      ? "WorldManager reconciliation is still in progress."
      : !reviewed
        ? "Inspect settlement, agent constitution, result and reconciliation first."
        : "Evidence inspected. Greenlight will create canonical state and an implementation contract.";
}

function renderCompiledProjectGenesis(
  surface,
) {
  const interaction =
    surface.interaction || {};
  const binding =
    semanticRegionBindingForSurface(
      surface,
    );
  const admitted =
    surface.surfaceState === "canonical";
  const constitution =
    state.projection?.latestProjectConstitution;
  const substrateBinding =
    state.projection?.projectSubstrate?.bindings?.find((entry) =>
      entry.projectId === constitution?.projectId) || null;
  const evidenceDependency =
    (interaction.dependencies || [])
      .find((dependency) =>
        dependency.dependencyKind ===
          "evidence_review");
  const reconciliationDependency =
    (interaction.dependencies || [])
      .find((dependency) =>
        dependency.dependencyKind ===
          "world_manager_reconciliation");
  const reviewed =
    evidenceDependency?.state ===
      "satisfied";
  const reconciled =
    reconciliationDependency?.state ===
      "satisfied";
  const utilityLens =
    (surface.lensProjections || [])
      .find((projection) =>
        projection.lens === "U");
  const recommendationItems =
    utilityLens?.sections
      ?.find((section) =>
        section.sectionKind ===
          "comparison")
      ?.items || [];

  elements.projectGenesisPanel.dataset
    .semanticSurfaceId =
      surface.semanticObjectSurfaceId;
  elements.projectGenesisPanel.dataset
    .semanticRegionBindingId =
      binding?.semanticRegionBindingId || "";
  elements.projectGenesisTitle.textContent =
    surface.semanticIdentity;
  elements.projectGenesisState.textContent =
    admitted
      ? substrateBinding
        ? "canonical · substrate provisioned"
        : "canonical · awaiting provisioning"
      : reviewed
        ? "candidate · reviewed"
        : "candidate";
  elements.projectGenesisState.className =
    `state-badge ${
      admitted
        ? "canonical"
        : reviewed
          ? "ready"
          : "candidate"
    }`;
  elements.projectGenesisSummary.textContent =
    surface.summary;
  clear(elements.projectGenesisLens);
  elements.projectGenesisLens.append(
    semanticLensNavigator(
      surface,
      renderProjectGenesis,
    ),
  );
  clear(elements.projectGenesisLandscape);
  elements.projectGenesisLandscape.append(
    semanticLensContent(surface),
  );
  elements.projectGenesisDefault.textContent =
    String(
      surface.compactProjection
        ?.indicator || "—",
    )
      .replace(/^env_/, "")
      .replace(/_/g, " ");

  clear(elements.realizationOptionList);
  for (
    const recommendation of
      recommendationItems
  ) {
    const option = textElement(
      "article",
      `realization-option ${
        recommendation.recommended
          ? "recommended"
          : ""
      }`,
      "",
    );
    const heading = textElement(
      "div",
      "realization-option-heading",
      "",
    );
    heading.append(
      textElement(
        "strong",
        "",
        recommendation.label,
      ),
      textElement(
        "span",
        recommendation.admissionState ===
          "eligible"
          ? "realization-ready"
          : "realization-blocked",
        `${recommendation.availability} · ${recommendation.admissionState}`,
      ),
    );
    option.append(heading);
    if (recommendation.value) {
      option.append(
        textElement(
          "p",
          "",
          recommendation.value,
        ),
      );
    }
    elements.realizationOptionList.append(
      option,
    );
  }

  elements.inspectGenesisEvidenceButton
    .textContent =
      interaction.reviewAction?.label ||
      "Inspect substrate evidence";
  elements.inspectGenesisEvidenceButton
    .hidden =
      interaction.reviewAction
        ?.available === false;
  elements.admitProjectButton.hidden =
    admitted;
  elements.admitProjectButton.disabled =
    interaction.commitAction
      ?.available !== true ||
    state.projection.busy;
  elements.projectAdmissionGate.textContent =
    admitted
      ? substrateBinding
        ? "The native workspace binding and exact environment snapshot are canonical. Project-world graph activation remains separate."
        : "Canonical constitution and default substrate are recorded. Choose the native workspace to provision the runtime binding."
      : !reconciled
        ? "WorldManager reconciliation has not completed."
        : !reviewed
          ? "Inspect the recommendation, substrate evidence, and lineage first."
          : "Evidence inspected. Admission will canonize the constitution and immutable default substrate; it will not provision a workspace.";
  renderProjectSubstrateProvisioning({
    projectId: constitution?.projectId,
    primaryEnvironmentId:
      constitution?.primaryAgentEnvironmentId ||
      state.projection?.latestProjectConstitutionCandidate
        ?.primaryAgentEnvironmentId,
    admitted,
    substrateBinding,
  });
}

function renderProjectSubstrateProvisioning(input = {}) {
  const environmentId = String(input.primaryEnvironmentId || "");
  const windows = environmentId === "env_windows_native";
  const wsl = environmentId === "env_wsl_native";
  const available =
    state.projection?.projectSubstrate?.provisioningAvailable === true;
  const shouldShow = Boolean(
    input.admitted && input.projectId && !input.substrateBinding,
  );
  elements.projectSubstrateProvisioning.hidden = !shouldShow;
  if (!shouldShow) return;
  elements.projectSubstrateProvisioning.dataset.projectId = input.projectId;
  elements.projectSubstrateProvisioning.dataset.environmentId = environmentId;
  elements.projectWorkspacePathLabel.textContent = windows
    ? "Native Windows workspace path"
    : wsl
      ? "Native WSL workspace path"
      : "Native workspace path";
  elements.projectWorkspacePath.placeholder = windows
    ? "C:\\path\\to\\project"
    : "/absolute/path/to/project";
  elements.projectWorkspaceDistroField.hidden = !wsl;
  elements.provisionProjectSubstrateButton.disabled =
    !available ||
    state.projection?.busy ||
    !elements.projectWorkspacePath.value.trim();
  elements.projectSubstrateProvisioningGate.textContent = available
    ? "The harmless resident probe verifies native platform, project identity, workspace identity, and process continuity before the binding is admitted."
    : "Native substrate provisioning is unavailable in this runtime.";
}

function renderProjectGenesis() {
  const compiledSurface =
    activeGenesisSurface();
  const candidate =
    state.projection?.latestProjectConstitutionCandidate;
  const constitution =
    state.projection?.latestProjectConstitution;
  const visible =
    productionMode &&
    Boolean(
      compiledSurface ||
      candidate ||
      constitution,
    );
  elements.projectGenesisPanel.hidden = !visible;
  if (!visible) return;
  if (compiledSurface) {
    renderCompiledProjectGenesis(
      compiledSurface,
    );
    return;
  }

  const admitted = candidate?.lifecycle === "admitted" ||
    Boolean(constitution);
  const substrateBinding =
    state.projection?.projectSubstrate?.bindings?.find((entry) =>
      entry.projectId === constitution?.projectId) || null;
  const reviewed = candidate?.evidenceReviewState === "reviewed";
  const reconciled = candidate?.reconciliationState === "reconciled";
  const primaryEnvironmentId =
    constitution?.primaryAgentEnvironmentId ||
    candidate?.primaryAgentEnvironmentId ||
    "";
  const primaryRecommendation =
    candidate?.rankedRecommendations?.find((entry) =>
      entry.environmentId === primaryEnvironmentId);

  elements.projectGenesisTitle.textContent =
    constitution?.identity || candidate?.identity || "Project constitution";
  elements.projectGenesisState.textContent = admitted
    ? substrateBinding
      ? "canonical · substrate provisioned"
      : "canonical · awaiting provisioning"
    : reviewed
      ? "candidate · reviewed"
      : "candidate";
  elements.projectGenesisState.className =
    `state-badge ${admitted ? "canonical" : reviewed ? "ready" : "candidate"}`;
  elements.projectGenesisSummary.textContent =
    constitution?.purpose ||
    candidate?.purpose ||
    candidate?.semanticSummary ||
    "";
  elements.projectGenesisDefault.textContent =
    primaryRecommendation?.displayLabel ||
    String(primaryEnvironmentId || "—")
      .replace(/^env_/, "")
      .replace(/_/g, " ");

  clear(elements.realizationOptionList);
  for (const recommendation of candidate?.rankedRecommendations || []) {
    const option = textElement(
      "article",
      `realization-option ${
        recommendation.environmentId === primaryEnvironmentId
          ? "recommended"
          : ""
      }`,
      "",
    );
    const heading = textElement("div", "realization-option-heading", "");
    heading.append(
      textElement("strong", "", `${recommendation.rank}. ${recommendation.displayLabel}`),
      textElement(
        "span",
        recommendation.admissionState === "eligible"
          ? "realization-ready"
          : "realization-blocked",
        `${recommendation.availability} · ${recommendation.admissionState}`,
      ),
    );
    option.append(heading);
    const rationale = (recommendation.rationale || []).join(" ");
    if (rationale) option.append(textElement("p", "", rationale));
    const tradeoffs = (recommendation.tradeoffs || []).join(" ");
    if (tradeoffs) {
      option.append(textElement("p", "realization-tradeoffs", `Tradeoff: ${tradeoffs}`));
    }
    elements.realizationOptionList.append(option);
  }

  elements.inspectGenesisEvidenceButton.textContent = reviewed
    ? "Reopen substrate evidence"
    : "Inspect substrate evidence";
  elements.admitProjectButton.hidden = admitted;
  elements.admitProjectButton.disabled =
    admitted || !reviewed || !reconciled || state.projection.busy;
  elements.projectAdmissionGate.textContent = admitted
    ? substrateBinding
      ? "The native workspace binding and exact environment snapshot are canonical. Project-world graph activation remains separate."
      : "Canonical constitution and default substrate are recorded. Choose the native workspace to provision the runtime binding."
    : !reconciled
      ? "WorldManager reconciliation has not completed."
      : !reviewed
        ? "Inspect the recommendation, substrate evidence, and lineage first."
        : "Evidence inspected. Admission will canonize the constitution and immutable default substrate; it will not provision a workspace.";
  renderProjectSubstrateProvisioning({
    projectId: constitution?.projectId,
    primaryEnvironmentId,
    admitted,
    substrateBinding,
  });
}

function renderContract() {
  const contract = state.projection?.latestContract;
  const workThread = state.projection?.latestWorkThread;
  elements.contractPanel.hidden = !contract;
  if (!contract) return;
  elements.contractTitle.textContent = `Contract ${shortId(contract.implementationContractId)}`;
  elements.contractObjective.textContent = contract.objective;
  elements.workThreadLabel.textContent = workThread
    ? `WorkThread ${shortId(workThread.workThreadId)} · ${String(
        workThread.lifecycleState ||
        workThread.phaseStatus ||
        workThread.phase ||
        "contract received",
      ).replace(/_/g, " ")}`
    : "WorkThread pending";
}

function evidenceRows(element, title, rows) {
  clear(element);
  element.append(textElement("h4", "", title));
  for (const [label, value] of rows) {
    const row = textElement("div", "evidence-row", "");
    row.append(textElement("span", "", label), textElement("span", "", Array.isArray(value) ? value.join(", ") : value || "—"));
    element.append(row);
  }
}

function renderUnifiedSemanticZoom(
  anatomyEvent,
) {
  const anatomy =
    semanticAnatomyProjection();
  const depth =
    selectedSemanticAnatomyDepth(
      anatomyEvent,
    );
  if (!anatomy || !depth) {
    return false;
  }
  state.semanticZoomEventId =
    anatomyEvent.eventRef.id;
  state.semanticZoomDepth =
    depth.depth;
  elements.semanticZoomIdentity.hidden =
    false;
  elements.semanticDepthNavigator.hidden =
    false;
  elements.semanticZoom.dataset.unified =
    "true";
  elements.semanticZoom.dataset
    .semanticEventId =
      anatomyEvent.eventRef.id;
  elements.semanticZoom.dataset
    .semanticDepth = depth.depth;
  elements.semanticZoomTitle
    .textContent =
      `${String(
        anatomyEvent.visibleOutcome
          ?.formulatedBy ||
          "WorldManager",
      )
        .replace(/_/g, " ")
        .replace(/\b\w/g, (letter) =>
          letter.toUpperCase())} · ${
        String(
          anatomyEvent.lifecycleState ||
            "observed",
        ).replace(/_/g, " ")
      }`;
  elements.semanticZoomSummary
    .textContent =
      `${depth.question} Depth adds causal and constitutional structure without changing the identity of the visible event.`;
  clear(elements.semanticZoomIdentity);
  const identityFacts = [
    [
      "event",
      shortId(
        anatomyEvent.eventRef.id,
      ),
    ],
    [
      "scope",
      anatomyEvent.projectId ||
        "world scope",
    ],
    [
      "lane",
      String(
        anatomyEvent.semanticLane ||
          "conversation",
      ).replace(/_/g, " "),
    ],
    [
      "task",
      String(
        anatomyEvent.taskType ||
          "world conversation",
      ).replace(/_/g, " "),
    ],
    [
      "identity",
      anatomyEvent
        .sameEventIdentityPreserved
        ? "preserved across depths"
        : "invalid",
    ],
  ];
  for (
    const [label, value] of
      identityFacts
  ) {
    const item = textElement(
      "span",
      "semantic-zoom-identity-item",
      "",
    );
    item.append(
      textElement("small", "", label),
      textElement("strong", "", value),
    );
    elements.semanticZoomIdentity
      .append(item);
  }
  clear(elements.semanticDepthNavigator);
  for (
    const definition of
      anatomy.depthRegistry
  ) {
    const projectedDepth =
      anatomyEvent.depths.find(
        (entry) =>
          entry.depth ===
            definition.depth,
      );
    const button = textElement(
      "button",
      `semantic-depth-button ${
        definition.depth ===
          depth.depth
          ? "selected"
          : ""
      }`,
      "",
    );
    button.type = "button";
    button.dataset.semanticDepth =
      definition.depth;
    button.setAttribute(
      "aria-pressed",
      String(
        definition.depth ===
          depth.depth,
      ),
    );
    button.title =
      definition.question;
    button.append(
      textElement(
        "strong",
        "",
        definition.label,
      ),
      textElement(
        "span",
        `depth-availability ${
          projectedDepth
            ?.availability ||
          "not_reached"
        }`,
        String(
          projectedDepth
            ?.availability ||
            "not reached",
        ).replace(/_/g, " "),
      ),
    );
    button.addEventListener(
      "click",
      () => {
        state.semanticZoomDepth =
          definition.depth;
        renderSemanticZoom();
      },
    );
    elements.semanticDepthNavigator
      .append(button);
  }
  elements.semanticDepthHeading
    .textContent =
      `${depth.label} · ${
        String(
          depth.availability,
        ).replace(/_/g, " ")
      }`;
  elements.semanticWitnessHeading
    .textContent =
      `Exact witnesses · ${
        depth.artifactRefs.length
      }`;
  evidenceRows(
    elements.settlementEvidence,
    depth.label,
    [
      ["question", depth.question],
      ["summary", depth.summary],
      ...depth.facts.map((entry) => [
        entry.label,
        entry.value,
      ]),
    ],
  );
  evidenceRows(
    elements.instantiationEvidence,
    "Truth posture",
    [
      [
        "event digest",
        shortId(
          anatomyEvent
            .eventRef.digest,
        ),
      ],
      [
        "availability",
        depth.availability,
      ],
      [
        "canonical effect",
        String(
          depth
            .canonicalWorldstateMutation ===
            true,
        ),
      ],
      [
        "authority granted",
        String(
          depth.grantsAuthority ===
            true,
        ),
      ],
      [
        "private reasoning",
        depth.privateReasoningIncluded
          ? "included"
          : "not exposed",
      ],
    ],
  );
  evidenceRows(
    elements.resultEvidence,
    "Typed witness references",
    depth.artifactRefs.length
      ? depth.artifactRefs
          .slice(0, 36)
          .map((ref) => [
            ref.kind.replace(
              /_/g,
              " ",
            ),
            `${shortId(ref.id)} · ${shortId(
              ref.digest,
            )}`,
          ])
      : [[
          "witness state",
          "No witness has been materialized at this depth.",
        ]],
  );
  evidenceRows(
    elements.reconciliationEvidence,
    "Same-context authority gate",
    [
      [
        "evidence gate",
        anatomyEvent
          .evidenceGate.state,
      ],
      [
        "same-context reachable",
        String(
          anatomyEvent
            .evidenceGate
            .sameContextReachable,
        ),
      ],
      [
        "required evidence refs",
        anatomyEvent
          .evidenceGate
          .requiredEvidenceRefs
          .length,
      ],
      [
        "admission authority",
        anatomyEvent
          .evidenceGate
          .admissionAuthorityGranted
          ? "granted"
          : "not granted",
      ],
      [
        "inspection effect",
        "read only",
      ],
    ],
  );
  clear(elements.lineageList);
  const relatedLineage = (
    state.projection
      ?.semanticLineage || []
  ).filter((event) =>
    event.lineageRootId ===
      anatomyEvent.lineageRootId);
  for (const event of relatedLineage) {
    const row = textElement(
      "div",
      `lineage-event ${
        event.epistemicState || ""
      }`,
      "",
    );
    row.append(
      textElement(
        "strong",
        "",
        event.eventKind.replace(
          /_/g,
          " ",
        ),
      ),
      textElement(
        "span",
        "",
        `${
          event.actorRole.replace(
            /_/g,
            " ",
          )
        } · ${
          event.epistemicState
        } · ${
          event.authorityState.replace(
            /_/g,
            " ",
          )
        }`,
      ),
      textElement(
        "span",
        "",
        event.rendererSafeSummary,
      ),
      textElement(
        "span",
        "",
        shortId(
          event.semanticEventId,
        ),
      ),
    );
    elements.lineageList.append(row);
  }
  if (!relatedLineage.length) {
    elements.lineageList.append(
      textElement(
        "p",
        "inspector-empty",
        "No child event has been materialized beyond this exact lineage root.",
      ),
    );
  }
  const genesisStage =
    state.projection?.pipelineStage ===
      "wm_k6_genesis";
  const candidate =
    state.projection
      ?.latestProjectConstitutionCandidate;
  const constitution =
    state.projection
      ?.latestProjectConstitution;
  const reviewed =
    candidate?.evidenceReviewState ===
      "reviewed";
  const activeGenesisEvidence =
    genesisStage &&
    Boolean(candidate) &&
    anatomyEvent.eventRef.id ===
      anatomy?.activeEventRef?.id;
  elements.evidenceReviewStatus
    .textContent =
      activeGenesisEvidence
        ? constitution
          ? "The constitution is canonical; the same-context evidence still shows that workspace provisioning and worker execution have not occurred."
          : reviewed
            ? "Substrate evidence inspection is recorded. The project constitution remains a candidate until explicit admission."
            : "Inspection is read only. Review the exact candidate and substrate evidence before admission."
        : "Semantic anatomy inspection changes only disclosure depth. It grants no authority and changes no canonical state.";
  elements.markEvidenceReviewed.hidden =
    !activeGenesisEvidence ||
    Boolean(constitution);
  elements.markEvidenceReviewed
    .textContent =
      reviewed
        ? "Evidence inspected ✓"
        : "Mark substrate evidence inspected";
  elements.markEvidenceReviewed
    .classList.toggle(
      "reviewed",
      reviewed,
    );
  elements.markEvidenceReviewed.disabled =
    reviewed;
  return true;
}

function renderSemanticZoom() {
  elements.semanticZoom.hidden = !state.semanticZoomOpen;
  if (!state.semanticZoomOpen) return;
  if (
    productionMode &&
    renderUnifiedSemanticZoom(
      selectedSemanticAnatomyEvent(),
    )
  ) {
    return;
  }
  elements.semanticZoomIdentity.hidden =
    true;
  elements.semanticDepthNavigator.hidden =
    true;
  elements.semanticZoom.dataset.unified =
    "false";
  const evidence = state.projection?.evidence || {};
  if (productionMode) {
    const settlement = evidence.latestSettlement || {};
    const semanticIngress = evidence.latestSemanticIngress || {};
    const routing = evidence.latestRoutingDecision || {};
    const context = evidence.latestManagerContext || {};
    const agentWorld = evidence.latestAgentWorld || {};
    const resultRecord = evidence.latestAgentResult || {};
    const agentResult = resultRecord.agentResult || {};
    const telemetry = resultRecord.telemetry || {};
    const inboxEntry = resultRecord.inboxEntry || {};
    const reconciliation = evidence.latestReconciliation || {};
    const operationalContext =
      state.projection?.operationalMetaContext?.latest || {};
    const runtimeStage = ["wm_k4", "wm_k6_genesis"].includes(
      state.projection?.pipelineStage,
    );
    const genesisStage =
      state.projection?.pipelineStage === "wm_k6_genesis";
    const genesisCandidate =
      state.projection?.latestProjectConstitutionCandidate;
    const genesisConstitution =
      state.projection?.latestProjectConstitution;
    const semanticHistoryTurnCount =
      agentWorld.trustedSemanticHistorySelectedTurnCount ||
      agentWorld.trustedDiscourseSelectedTurnCount ||
      0;
    evidenceRows(elements.settlementEvidence, "SemanticSettlement → TaskSettlement", [
      ["semantic run", shortId(semanticIngress.semanticIngressRunId)],
      ["semantic action", semanticIngress.semanticActionName],
      [
        "semantic discharge",
        shortId(semanticIngress.semanticDischargeId),
      ],
      [
        "open type expressions",
        formatSemanticTypeExpressions(
          semanticIngress.semanticTypeExpressions,
        ),
      ],
      [
        "lane / disposition",
        `${semanticIngress.primaryLane || "—"} / ${
          semanticIngress.formulationDisposition || "—"
        }`,
      ],
      [
        "semantic validation",
        `${semanticIngress.runState || "—"} / ${
          semanticIngress.outputValidationState || "—"
        }`,
      ],
      ["semantic task types", semanticIngress.taskTypes || []],
      ["project seed", semanticIngress.projectSeedJudgment],
      ["identity", shortId(settlement.taskSettlementId)],
      ["project / type", `${settlement.projectId || "world"} / ${settlement.taskType || "—"}`],
      ["phase / role", `${settlement.phase || "—"} / ${settlement.responsibleRole || "—"}`],
      ["settlement tier", settlement.settlementTier],
      ["decision", routing.decision],
      ["ambiguities", settlement.ambiguityReasons || []],
      ["rationale", settlement.rationale],
    ]);
    evidenceRows(elements.instantiationEvidence, "ResolvedTaskConstitution", [
      ["constitution", shortId(agentWorld.taskConstitutionId)],
      ["role template", agentWorld.roleTemplateId],
      ["required", formatActionClasses(agentWorld.requiredActionClasses)],
      ["permitted", formatActionClasses(agentWorld.permittedActionClasses)],
      ["prohibited", formatActionClasses(agentWorld.prohibitedActionClasses)],
      ["policy closure", agentWorld.policyClosureState || "not compiled"],
      [
        "policy source",
        (agentWorld.policySourcePostures || [])
          .map((posture) => String(posture).replace(/_/g, " ")),
      ],
      ["policy digest", shortId(agentWorld.policyClosureDigest)],
      ["exceptions", agentWorld.activeExceptionRefs?.length || 0],
      ["conflicts", agentWorld.conflictWitnessRefs?.length || 0],
      [
        "semantic history evidence",
        shortId(
          agentWorld.trustedSemanticHistoryEvidenceRef?.id ||
          agentWorld.trustedDiscourseEvidenceRef?.id,
        ),
      ],
      [
        "semantic history import",
        semanticHistoryTurnCount
          ? `${semanticHistoryTurnCount} ${
              semanticHistoryTurnCount === 1
                ? "turn"
                : "turns"
            } · ${
              agentWorld.trustedDiscourseSelectionMode
            } · ${
              agentWorld.trustedSemanticHistorySelectedShelfCount || 0
            } shelves`
          : "none",
      ],
      [
        "operational context",
        shortId(
          operationalContext
            .operationalMetaContextRef?.id,
        ),
      ],
      [
        "context requirement",
        shortId(
          operationalContext
            .contextRequirementSetRef?.id,
        ),
      ],
      [
        "context bundle / witness",
        `${shortId(
          operationalContext.contextBundleRef?.id,
        )} / ${shortId(
          operationalContext.selectionWitnessRef?.id,
        )}`,
      ],
      [
        "selected context",
        `${operationalContext.selectedEventCount || 0} outcomes · ${
          operationalContext.selectedSemanticObjectCount || 0
        } objects · ${
          operationalContext.estimatedInputTokens || 0
        } tokens`,
      ],
      [
        "selection omissions",
        Object.entries(
          operationalContext.excludedCounts || {},
        )
          .filter(([, count]) => Number(count) > 0)
          .map(([kind, count]) => `${kind}:${count}`),
      ],
      [
        "cross-scope exclusions",
        operationalContext.crossScopeExclusionCount || 0,
      ],
      [
        "request manifest linkage",
        operationalContext.requestManifestLinkState ===
          "linked"
          ? shortId(
              operationalContext.requestManifestId,
            )
          : operationalContext.requestManifestLinkState ||
            "pending",
      ],
    ]);
    evidenceRows(
      elements.resultEvidence,
      runtimeStage ? "AgentResult" : "AgentInstantiationManifest",
      runtimeStage
        ? [
            ["identity", shortId(agentResult.agentResultId)],
            ["instantiation", shortId(agentResult.agentInstantiationId)],
            ["terminal state", agentResult.resultState],
            ["output contract", agentResult.outputContractState],
            [
              "final assistant anchor",
              shortId(agentResult.finalAssistantMessageRef?.id),
            ],
            [
              "telemetry envelope",
              shortId(agentResult.telemetryEnvelopeRef?.id),
            ],
            [
              "runtime / model",
              `${telemetry.environment || "—"} / ${telemetry.model || "—"}`,
            ],
            ["tool calls / effects", `${telemetry.toolCallCount || 0} / ${telemetry.effectCount || 0}`],
            ["semantic inbox", inboxEntry.deliveryState || "not enqueued"],
            ["canonical write", "not authorized"],
          ]
        : [
            ["instantiation", shortId(agentWorld.agentInstantiationId)],
            ["manifest", shortId(agentWorld.manifestId)],
            ["graph", shortId(agentWorld.graphRef?.id)],
            ["graph projection", shortId(agentWorld.graphProjectionRef?.id)],
            ["world revisions", (agentWorld.sourceScopeRevisions || []).map((entry) => `${entry.scopeKind}:${entry.revision}`)],
            ["tools", agentWorld.toolCount === undefined ? "not compiled" : String(agentWorld.toolCount)],
            ["prompt digest", shortId(agentWorld.promptDigest)],
            ["agreement", agentWorld.projectionAgreementState || "not compiled"],
            ["launch boundary", String(agentWorld.launchBoundary || "blocked").replace(/_/g, " ")],
          ],
    );
    evidenceRows(
      elements.reconciliationEvidence,
      genesisStage
        ? "Project genesis authority boundary"
        : runtimeStage
          ? "WorldManager reconciliation"
          : "K3 runtime boundary",
      genesisStage
        ? [
            ["reconciliation", reconciliation.state || "awaiting result"],
            ["candidate", shortId(genesisCandidate?.candidateId)],
            ["recommended default", genesisCandidate?.primaryAgentEnvironmentId],
            ["allowed environments", genesisCandidate?.allowedEnvironmentIds || []],
            ["evidence review", genesisCandidate?.evidenceReviewState || "not available"],
            [
              "authority state",
              genesisConstitution
                ? "canonical constitution"
                : "non-canonical candidate",
            ],
            [
              "activation",
              genesisConstitution?.activationState ||
                genesisCandidate?.activationState ||
                "not admitted",
            ],
            ["workspace provisioned", "no"],
            ["worker execution", "not available"],
            ["private reasoning", "not exposed"],
          ]
        : runtimeStage
          ? [
            ["state", reconciliation.state || "awaiting result"],
            [
              "source AgentResult",
              shortId(reconciliation.sourceAgentResultRef?.id),
            ],
            [
              "WorldManager result",
              shortId(reconciliation.reconciliationAgentResultRef?.id),
            ],
            ["summary", reconciliation.semanticSummary],
            ["recommendation", reconciliation.recommendation],
            ["proposal registered", "no · K5 boundary"],
            ["canonical write", "not authorized"],
            ["private reasoning", "not exposed"],
            ]
          : [
            [
              "provider role turn",
              String(context.providerRoleTurnState || "not started").replace(/_/g, " "),
            ],
            ["provider request", agentWorld.providerRequestCreated === false ? "not created" : "not available"],
            ["candidate result", "not produced"],
            ["canonical write", "not authorized"],
            ["reconciliation", "unavailable before a candidate exists"],
            ["execution", "not started"],
            ["private reasoning", "not exposed"],
          ],
    );
    clear(elements.lineageList);
    for (const event of state.projection?.semanticLineage || []) {
      const row = textElement("div", `lineage-event ${event.epistemicState || ""}`, "");
      row.append(
        textElement("strong", "", event.eventKind.replace(/_/g, " ")),
        textElement("span", "", `${event.actorRole.replace(/_/g, " ")} · ${event.epistemicState} · ${event.authorityState.replace(/_/g, " ")}`),
        textElement("span", "", event.rendererSafeSummary),
        textElement("span", "", shortId(event.semanticEventId)),
      );
      elements.lineageList.append(row);
    }
    const genesisReviewed =
      genesisCandidate?.evidenceReviewState === "reviewed";
    elements.evidenceReviewStatus.textContent = genesisStage
      ? genesisConstitution
        ? "The constitution and runtime default are canonical. This evidence explicitly shows that workspace provisioning and worker execution have not occurred."
        : genesisReviewed
          ? "Substrate evidence inspection is recorded. The project constitution remains a candidate until explicit admission."
          : "The recommendation is grounded in harness-observed realization options. Inspecting it does not admit the project."
      : runtimeStage
        ? "The terminal message, deterministic telemetry, inbox delivery, and WorldManager reconciliation are separate typed witnesses in one lineage. None admits a proposal or canonical state."
        : "These refs expose the K3 constitution and manifest in the same lineage. Validation grants no runtime or canonical authority.";
    elements.markEvidenceReviewed.hidden = !genesisStage ||
      Boolean(genesisConstitution);
    elements.markEvidenceReviewed.textContent = genesisReviewed
      ? "Evidence inspected ✓"
      : "Mark substrate evidence inspected";
    elements.markEvidenceReviewed.classList.toggle(
      "reviewed",
      genesisReviewed,
    );
    elements.markEvidenceReviewed.disabled = genesisReviewed;
    return;
  }
  elements.markEvidenceReviewed.hidden = false;
  const settlement = evidence.settlement || {};
  const instantiation = evidence.projectManagerInstantiation || {};
  const result = evidence.projectManagerResult || {};
  const reconciliationResult = evidence.reconciliationResult || {};
  evidenceRows(elements.settlementEvidence, "TaskSettlement", [
    ["identity", shortId(settlement.taskSettlementId)],
    ["project / type", `${settlement.projectId || "—"} / ${settlement.taskType || "—"}`],
    ["phase / role", `${settlement.phase || "—"} / ${settlement.responsibleRole || "—"}`],
    ["action classes", settlement.actionClasses || []],
    ["confidence", settlement.confidence],
    ["rationale", settlement.rationale],
  ]);
  evidenceRows(elements.instantiationEvidence, "AgentInstantiation", [
    ["identity", shortId(instantiation.agentInstantiationId)],
    ["role template", instantiation.roleTemplateId],
    ["authority", instantiation.authorityEnvelope?.posture],
    ["canonical write", instantiation.authorityEnvelope?.mayAdmitCanonicalState ? "allowed" : "forbidden"],
    ["tools", instantiation.capabilityEnvelope?.tools?.length ? instantiation.capabilityEnvelope.tools : "none"],
    ["prompt digest", shortId(instantiation.promptDigest)],
  ]);
  evidenceRows(elements.resultEvidence, "AgentResult", [
    ["identity", shortId(result.agentResultId)],
    ["terminal state", result.terminalState],
    ["final anchor", shortId(result.finalMessageAnchor?.textDigest)],
    ["rendered to user", String(result.renderedToUser === true)],
    ["relayed to WorldManager", String(result.relayedToWorldManager === true)],
    ["runtime / model", `${result.deterministicTelemetry?.runtimeMode || "—"} / ${result.deterministicTelemetry?.model || "—"}`],
    ["tool calls", String(result.deterministicTelemetry?.toolCallCount || 0)],
  ]);
  evidenceRows(elements.reconciliationEvidence, "WorldManager reconciliation", [
    ["identity", shortId(reconciliationResult.agentResultId)],
    ["posture", state.projection?.reconciliation?.state],
    ["summary", state.projection?.reconciliation?.summary],
    ["recommendation", state.projection?.reconciliation?.recommendation],
    ["private reasoning", "not exposed"],
  ]);
  clear(elements.lineageList);
  for (const event of state.projection?.semanticLineage || []) {
    const row = textElement("div", `lineage-event ${event.epistemicState || ""}`, "");
    row.append(
      textElement("strong", "", event.eventKind.replace(/_/g, " ")),
      textElement("span", "", `${event.actorRole.replace(/_/g, " ")} · ${event.epistemicState} · ${event.authorityState.replace(/_/g, " ")}`),
      textElement("span", "", event.rendererSafeSummary),
      textElement("span", "", shortId(event.semanticEventId)),
    );
    elements.lineageList.append(row);
  }
  const reviewed = state.projection?.latestProposal?.evidenceReviewState === "reviewed";
  elements.evidenceReviewStatus.textContent = reviewed
    ? "Evidence inspection is recorded. This does not itself admit the proposal."
    : "Evidence is visible in the current workbench. Admission remains gated.";
  elements.markEvidenceReviewed.textContent = reviewed ? "Evidence inspected ✓" : "Mark evidence inspected";
  elements.markEvidenceReviewed.classList.toggle("reviewed", reviewed);
  elements.markEvidenceReviewed.disabled = reviewed;
}

function render() {
  renderLifecycle();
  renderManagerRuntimeSettings();
  renderMessages();
  renderProjects();
  renderDecisionDock();
  renderProjectEcologyInspector();
  renderDecisionOutcomeInspector();
  renderEpistemicFabricInspector();
  renderContextCanvasInspector();
  renderAroInspector();
  renderOperationalMetaContext();
  renderSettlement();
  renderReconciliation();
  renderProposal();
  renderProjectGenesis();
  renderContract();
  renderSemanticZoom();
}

function applyProjection(projection) {
  const expectedSchema = productionMode
    ? PRODUCTION_PROJECTION_SCHEMA
    : semanticMockupMode
      ? MOCK_PROJECTION_SCHEMA
      : null;
  if (!expectedSchema) return;
  if (!projection || projection.schema !== expectedSchema) return;
  state.projection = projection;
  render();
}

async function refresh() {
  const snapshot = productionMode
    ? bridge?.getWorldManagerSnapshot
    : semanticMockupMode
      ? bridge?.getWorldManagerSemanticSnapshot
      : null;
  if (!snapshot) {
    showToast(
      launchModeValid
        ? "WorldManager bridge is unavailable."
        : "WorldManager launch mode is missing; no fallback runtime was selected.",
      "error",
    );
    return;
  }
  applyProjection(await snapshot());
}

async function submitMessage(text) {
  const value = String(text || "").trim();
  if (!value || state.pending || !launchModeValid) {
    if (!launchModeValid) {
      showToast(
        "WorldManager launch mode is missing; submission was blocked.",
        "error",
      );
    }
    return;
  }
  state.pending = true;
  elements.composerInput.value = "";
  render();
  try {
    let result;
    if (productionMode) {
      result = await bridge.submitWorldManagerMessage({
        schema: "direct_world_manager_submit_request@1",
        clientRequestId: globalThis.crypto?.randomUUID?.() ||
          `wm_request_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        text: value,
        scopeHint: {
          projectId: state.projection?.activeProjectId || projectPayload.id,
          bindingPosture: "ambient_focus",
        },
        expectedProjectionRevision: state.projection?.projectionRevision ?? null,
        attachmentDraftRefs: [],
      });
    } else {
      result = await bridge.submitWorldManagerSemanticMessage({
        text: value,
        projectId: state.projection?.activeProjectId || projectPayload.id,
        mode: elements.runtimeMode.value,
        reasoningEffort: "medium",
      });
    }
    applyProjection(result?.projection || result);
    if (productionMode) {
      const settlementState = result?.receipt?.settlementState;
      const candidateRef =
        result?.receipt?.projectConstitutionCandidateRef;
      showToast(
        candidateRef
          ? "Project constitution candidate created. Inspect the substrate evidence before admission."
        : settlementState === "contract_received"
          ? "Plan admitted from the exact semantic decision. The canonical contract is waiting for separate worker-start authority."
        : settlementState === "agent_world_ready"
          ? "Task constitution and bounded agent world validated. Provider role execution is still stopped."
          : settlementState === "context_ready"
            ? "Task settled and graph-first manager context prepared. Agent compilation is still pending."
          : state.projection?.evidence?.latestSettlement?.clarificationPrompt ||
              "WorldManager stopped for semantic clarification.",
      );
    }
  } catch (error) {
    showToast(error?.message || "Semantic interaction failed.", "error");
    await refresh();
  } finally {
    state.pending = false;
    render();
  }
}

async function focusProject(projectId) {
  if (!productionMode || state.pending || !bridge?.focusWorldManagerProject) return;
  state.pending = true;
  render();
  try {
    const result = await bridge.focusWorldManagerProject(
      projectId,
      state.projection?.projectionRevision ?? null,
    );
    applyProjection(result?.projection || result);
  } catch (error) {
    showToast(error?.message || "Project focus could not be changed.", "error");
  } finally {
    state.pending = false;
    render();
  }
}

elements.composerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitMessage(elements.composerInput.value);
});

elements.composerInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    elements.composerForm.requestSubmit();
  } else if (event.key === "Escape") {
    if (state.semanticZoomOpen) {
      state.semanticZoomOpen = false;
      renderSemanticZoom();
    } else if (state.activeInspector) {
      state.activeInspector = "";
      render();
    } else {
      elements.composerInput.value = "";
    }
  }
});

document.addEventListener(
  "keydown",
  (event) => {
    if (
      event.key !== "Escape" ||
      !state.semanticZoomOpen ||
      event.target ===
        elements.composerInput
    ) {
      return;
    }
    event.preventDefault();
    state.semanticZoomOpen = false;
    renderSemanticZoom();
  },
);

elements.starterPrompt.addEventListener("click", () => {
  elements.composerInput.value =
    productionMode && productionStage === "wm_k6_genesis"
      ? "Start a new project for native Windows context-menu and shell-integration work. Recommend whether its agents should run in Windows or WSL by default."
      : "Plan the next five features for this project.";
  elements.composerInput.focus();
});

elements.inspectEvidenceButton.addEventListener("click", () => {
  openSemanticAnatomy();
});

elements.inspectSettlementButton?.addEventListener("click", () => {
  openSemanticAnatomy(
    state.projection?.evidence
      ?.latestSettlement
      ?.semanticEventId ||
      "",
    "governance",
  );
});

elements.inspectGenesisEvidenceButton?.addEventListener("click", () => {
  openSemanticAnatomy(
    "",
    "substrate",
  );
});

elements.closeProjectEcologyInspector?.addEventListener(
  "click",
  () => {
    state.activeInspector = "";
    render();
  },
);

elements.closeDecisionOutcomeInspector?.addEventListener(
  "click",
  () => {
    state.activeInspector = "";
    render();
  },
);

elements.closeContextCanvasInspector?.addEventListener(
  "click",
  () => {
    state.activeInspector = "";
    render();
  },
);

elements.closeAroInspector?.addEventListener(
  "click",
  () => {
    state.activeInspector = "";
    render();
  },
);

elements.thoughtBrushSelect?.addEventListener(
  "change",
  () => {
    state.selectedThoughtBrush =
      elements.thoughtBrushSelect.value;
    elements.thoughtBrushAltitude
      .dataset.edited = "";
    renderContextCanvasInspector();
  },
);

elements.thoughtBrushTarget?.addEventListener(
  "change",
  () =>
    renderContextCanvasInspector(),
);

elements.thoughtBrushAltitude?.addEventListener(
  "input",
  () => {
    elements.thoughtBrushAltitude
      .dataset.edited = "true";
  },
);

elements.thoughtBrushInstruction?.addEventListener(
  "input",
  () => {
    state.thoughtBrushDirection =
      elements.thoughtBrushInstruction
        .value;
  },
);

elements.applyThoughtBrush?.addEventListener(
  "click",
  () => applyThoughtBrush(),
);

elements.undoContextCanvas?.addEventListener(
  "click",
  () => undoContextCanvas(),
);

elements.openDecisionDock?.addEventListener(
  "click",
  () => {
    state.activeInspector = "decisions";
    const first =
      semanticSurfaceProjection()
        ?.decisionDock?.entries?.[0];
    if (
      first &&
      !state.selectedSemanticSurfaceId
    ) {
      state.selectedSemanticSurfaceId =
        first.surfaceRef.id;
    }
    render();
  },
);

elements.activateInspectedProject?.addEventListener(
  "click",
  () => {
    const project =
      state.projection?.projects?.find((entry) =>
        entry.projectId ===
        state.inspectedProjectId);
    if (!project?.focusEligible) return;
    focusProject(project.projectId);
  },
);

elements.closeSemanticZoom.addEventListener("click", () => {
  state.semanticZoomOpen = false;
  renderSemanticZoom();
});

elements.closeEpistemicFabricInspector?.addEventListener(
  "click",
  () => {
    state.reviewingEpistemicAdmissionId = "";
    state.activeInspector = "";
    renderEpistemicFabricInspector();
  },
);

elements.markEvidenceReviewed.addEventListener("click", async () => {
  try {
    if (productionMode) {
      const planProposal =
        state.projection?.latestProposal;
      if (planProposal) {
        const result =
          await bridge.inspectWorldManagerPlanProposal({
            proposalRevisionId:
              planProposal.proposalRevisionId ||
              planProposal.proposalId,
            proposalDigest: planProposal.digest,
            actorId: "operator",
          });
        applyProjection(result?.projection || result);
        showToast(
          "Plan evidence inspection recorded. The proposal remains non-canonical.",
        );
        return;
      }
      const genesisSurface =
        activeGenesisSurface();
      const regionBinding =
        genesisSurface
          ? semanticRegionBindingForSurface(
              genesisSurface,
            )
          : null;
      const candidateId =
        (
          genesisSurface
            ?.subjectRef?.kind ===
              "project_constitution_candidate"
            ? genesisSurface
                ?.subjectRef?.id
            : ""
        ) ||
        state.projection
          ?.latestProjectConstitutionCandidate
          ?.candidateId;
      if (!candidateId) return;
      const result =
        await bridge.inspectWorldManagerProjectGenesisCandidate(
          candidateId,
          regionBinding
            ? {
                kind:
                  "semantic_region_binding",
                id:
                  regionBinding
                    .semanticRegionBindingId,
                digest:
                  regionBinding.digest,
              }
            : null,
        );
      applyProjection(result?.projection || result);
      showToast(
        "Substrate evidence inspection recorded. The project constitution remains a candidate.",
      );
    } else {
      const proposalId = state.projection?.latestProposal?.proposalId;
      if (!proposalId) return;
      applyProjection(await bridge.inspectWorldManagerProposal(proposalId));
      showToast("Evidence inspection recorded. The proposal remains a candidate.");
    }
  } catch (error) {
    showToast(error?.message || "Evidence review could not be recorded.", "error");
  }
});

elements.greenlightButton.addEventListener("click", async () => {
  const proposalId = state.projection?.latestProposal?.proposalId;
  if (!proposalId || elements.greenlightButton.disabled) return;
  try {
    const result = productionMode
      ? await bridge.admitWorldManagerPlanProposal({
          proposalRevisionId: proposalId,
          proposalDigest:
            state.projection?.latestProposal?.digest,
          actorId: "operator",
        })
      : await bridge.admitWorldManagerProposal(proposalId);
    applyProjection(result.projection || result);
    state.semanticZoomOpen = false;
    render();
    showToast(
      "Plan admitted. Canonical contract created; the WorkThread is waiting for worker-start authority.",
    );
  } catch (error) {
    showToast(error?.message || "Proposal admission failed.", "error");
  }
});

elements.admitProjectButton?.addEventListener("click", async () => {
  const genesisSurface =
    activeGenesisSurface();
  const regionBinding =
    genesisSurface
      ? semanticRegionBindingForSurface(
          genesisSurface,
        )
      : null;
  const candidateId =
    (
      genesisSurface
        ?.subjectRef?.kind ===
          "project_constitution_candidate"
        ? genesisSurface
            ?.subjectRef?.id
        : ""
    ) ||
    state.projection
      ?.latestProjectConstitutionCandidate
      ?.candidateId;
  if (
    !candidateId ||
    elements.admitProjectButton.disabled ||
    !bridge?.admitWorldManagerProjectGenesisCandidate
  ) {
    return;
  }
  try {
    const result =
      await bridge.admitWorldManagerProjectGenesisCandidate(
        candidateId,
        "operator",
        regionBinding
          ? {
              kind:
                "semantic_region_binding",
              id:
                regionBinding
                  .semanticRegionBindingId,
              digest:
                regionBinding.digest,
            }
          : null,
      );
    applyProjection(result?.projection || result);
    state.semanticZoomOpen = false;
    render();
    showToast(
      "Project constitution admitted. Its default substrate is canonical; workspace provisioning remains pending.",
    );
  } catch (error) {
    showToast(
      error?.message || "Project constitution admission failed.",
      "error",
    );
  }
});

elements.projectWorkspacePath?.addEventListener("input", () => {
  const available =
    state.projection?.projectSubstrate?.provisioningAvailable === true;
  elements.provisionProjectSubstrateButton.disabled =
    !available ||
    state.projection?.busy ||
    !elements.projectWorkspacePath.value.trim();
});

elements.provisionProjectSubstrateButton?.addEventListener("click", async () => {
  const projectId =
    elements.projectSubstrateProvisioning?.dataset.projectId || "";
  const environmentId =
    elements.projectSubstrateProvisioning?.dataset.environmentId || "";
  const workspacePath = elements.projectWorkspacePath.value.trim();
  if (
    !projectId ||
    !workspacePath ||
    elements.provisionProjectSubstrateButton.disabled ||
    !bridge?.provisionWorldManagerProjectSubstrate
  ) {
    return;
  }
  const workspace = environmentId === "env_windows_native"
    ? {
        kind: "windows",
        windowsPath: workspacePath,
        label: "WorldManager project workspace",
      }
    : environmentId === "env_wsl_native"
      ? {
          kind: "wsl",
          distro: elements.projectWorkspaceDistro.value.trim(),
          linuxPath: workspacePath,
          label: "WorldManager project workspace",
        }
      : {
          kind: "local",
          localPath: workspacePath,
          label: "WorldManager project workspace",
        };
  elements.provisionProjectSubstrateButton.disabled = true;
  try {
    const result = await bridge.provisionWorldManagerProjectSubstrate(
      projectId,
      workspace,
      "operator",
    );
    applyProjection(result?.projection || result);
    render();
    showToast(
      "Native project substrate provisioned. The immutable thread binding and exact readiness snapshot are recorded.",
    );
  } catch (error) {
    render();
    showToast(
      error?.message || "Project substrate provisioning failed.",
      "error",
    );
  }
});

elements.resetButton.addEventListener("click", async () => {
  if (state.pending || !semanticMockupMode) return;
  try {
    state.semanticZoomOpen = false;
    applyProjection(await bridge.resetWorldManagerSemanticMockup(elements.runtimeMode.value));
    showToast("Semantic mockup returned to a quiet world.");
  } catch (error) {
    showToast(error?.message || "World reset failed.", "error");
  }
});

elements.runtimeMode.addEventListener("change", () => {
  showToast(elements.runtimeMode.value === "live_direct"
    ? "Live Direct will make three authenticated semantic role turns."
    : "Deterministic fixture mode selected.");
});

function updateManagerRuntimeDirtyState() {
  const configured = state.managerRuntimeSettings?.configured || {};
  state.managerRuntimeDirty =
    state.managerRuntimeDraft.model !== (configured.model || "") ||
    state.managerRuntimeDraft.reasoningEffort !==
      (configured.reasoningEffort || "");
}

elements.managerModelSelect.addEventListener("change", () => {
  state.managerRuntimeDraft.model =
    elements.managerModelSelect.value;
  const descriptor = managerRuntimeModelDescriptor(
    state.managerRuntimeDraft.model,
  );
  if (
    state.managerRuntimeDraft.reasoningEffort &&
    descriptor?.supportedReasoningEfforts?.length &&
    !descriptor.supportedReasoningEfforts.includes(
      state.managerRuntimeDraft.reasoningEffort,
    )
  ) {
    state.managerRuntimeDraft.reasoningEffort = "";
  }
  updateManagerRuntimeDirtyState();
  renderManagerRuntimeSettings();
});

elements.managerEffortSelect.addEventListener("change", () => {
  state.managerRuntimeDraft.reasoningEffort =
    elements.managerEffortSelect.value;
  updateManagerRuntimeDirtyState();
  renderManagerRuntimeSettings();
});

elements.refreshManagerModels.addEventListener("click", async () => {
  if (state.managerRuntimeLoading || state.pending) return;
  try {
    await loadManagerRuntimeSettings(true);
    showToast(
      state.managerRuntimeSettings?.catalog?.refreshed
        ? "Provider model catalog refreshed."
        : "Live catalog refresh was unavailable; inspect the displayed evidence posture.",
    );
  } catch (error) {
    showToast(
      error?.message || "Unable to refresh manager models.",
      "error",
    );
  }
});

elements.applyManagerRuntime.addEventListener("click", async () => {
  if (
    state.managerRuntimeLoading ||
    state.pending ||
    state.projection?.busy ||
    !state.managerRuntimeDirty ||
    !bridge?.updateWorldManagerRuntimeSettings
  ) {
    return;
  }
  state.managerRuntimeLoading = true;
  renderManagerRuntimeSettings();
  try {
    const result = await bridge.updateWorldManagerRuntimeSettings({
      model: state.managerRuntimeDraft.model,
      reasoningEffort:
        state.managerRuntimeDraft.reasoningEffort,
    });
    state.managerRuntimeSettings = result?.settings ||
      state.managerRuntimeSettings;
    state.managerRuntimeDraft = {
      model:
        state.managerRuntimeSettings?.configured?.model || "",
      reasoningEffort:
        state.managerRuntimeSettings?.configured
          ?.reasoningEffort || "",
    };
    state.managerRuntimeDirty = false;
    showToast(
      "Manager runtime preference saved for the next provider call.",
    );
  } catch (error) {
    showToast(
      error?.message || "Unable to update manager runtime.",
      "error",
    );
  } finally {
    state.managerRuntimeLoading = false;
    renderManagerRuntimeSettings();
  }
});

bridge?.onWorldManagerSemanticEvent?.((event) => {
  if (semanticMockupMode) applyProjection(event?.projection);
});

bridge?.onWorldManagerEvent?.((event) => {
  if (productionMode) applyProjection(event?.projection);
});

bridge?.onEvent?.((event) => {
  if (
    !productionMode ||
    ![
      "rpc-request",
      "rpc-request-updated",
    ].includes(event?.type) ||
    !event?.request?.key
  ) {
    return;
  }
  state.aroWorkerRequests.set(
    event.request.key,
    event.request,
  );
  if (state.activeInspector === "aros") {
    renderAroInspector();
  }
});

refresh().catch((error) => showToast(error?.message || "Unable to initialize WorldManager surface.", "error"));
loadManagerRuntimeSettings(true).catch((error) =>
  showToast(
    error?.message || "Unable to load WorldManager runtime settings.",
    "error",
  ));
