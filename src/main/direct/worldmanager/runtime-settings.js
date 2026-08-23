"use strict";

const WORLD_MANAGER_RUNTIME_SETTINGS_SCHEMA =
  "direct_world_manager_runtime_settings@1";

const KNOWN_REASONING_EFFORTS = Object.freeze([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeWorldManagerReasoningEffort(value) {
  const candidate = normalizeString(value, "").toLowerCase();
  return KNOWN_REASONING_EFFORTS.includes(candidate) ? candidate : "";
}

function normalizeWorldManagerRuntimePreferences(value = {}) {
  const raw = isPlainObject(value) ? value : {};
  return {
    model: normalizeString(raw.model, ""),
    reasoningEffort: normalizeWorldManagerReasoningEffort(
      raw.reasoningEffort || raw.reasoning_effort,
    ),
  };
}

function reasoningEffortValues(value) {
  const raw = Array.isArray(value) ? value : [];
  const seen = new Set();
  const result = [];
  for (const entry of raw) {
    const effort = normalizeWorldManagerReasoningEffort(
      typeof entry === "string"
        ? entry
        : entry?.reasoningEffort || entry?.reasoning_effort || entry?.id,
    );
    if (!effort || seen.has(effort)) continue;
    seen.add(effort);
    result.push(effort);
  }
  return result;
}

function normalizedModelDescriptor(value = {}, source = "unknown") {
  const id = normalizeString(value.model || value.id, "");
  if (!id) return null;
  return {
    id,
    displayName: normalizeString(
      value.displayName || value.display_name,
      id,
    ),
    description: normalizeString(value.description, ""),
    supportedReasoningEfforts: reasoningEffortValues(
      value.supportedReasoningEfforts ||
        value.supported_reasoning_efforts,
    ),
    defaultReasoningEffort: normalizeWorldManagerReasoningEffort(
      value.defaultReasoningEffort ||
        value.default_reasoning_effort,
    ),
    availabilityState: normalizeString(
      value.availabilityState || value.availability_state || value.status,
      source === "server_model_list" ? "available" : "unverified",
    ),
    source,
    evidenceState:
      source === "server_model_list"
        ? "provider_observed"
        : source === "provider_cache"
          ? "cached_provider_observation"
          : "bundled_profile_observation",
  };
}

function buildWorldManagerModelCatalog(input = {}) {
  const providerProfile = input.providerMetadataProfile || {};
  const providerItems = Array.isArray(providerProfile.modelCatalog?.items)
    ? providerProfile.modelCatalog.items
    : [];
  const providerSource = normalizeString(
    providerProfile.modelCatalog?.source,
    "unknown",
  );
  const providerDescriptorSource =
    providerSource === "server_model_list"
      ? "server_model_list"
      : providerItems.length
        ? "provider_cache"
        : "unknown";
  const bundledItems = Array.isArray(input.profileDoc?.profile?.ontology?.models)
    ? input.profileDoc.profile.ontology.models
    : [];
  const models = [];
  const seen = new Set();
  const append = (value, source) => {
    const descriptor = normalizedModelDescriptor(value, source);
    if (!descriptor || seen.has(descriptor.id)) return;
    seen.add(descriptor.id);
    models.push(descriptor);
  };
  providerItems.forEach((entry) => append(entry, providerDescriptorSource));
  bundledItems
    .filter((entry) => normalizeString(entry?.status, "") !== "rejected")
    .forEach((entry) => append(entry, "bundled_profile"));
  const configuredModel = normalizeString(input.configuredModel, "");
  if (configuredModel && !seen.has(configuredModel)) {
    append({
      id: configuredModel,
      displayName: configuredModel,
      availabilityState: "configured_unverified",
    }, "configured_unverified");
  }
  return {
    models,
    providerDefaultModel: normalizeString(
      providerProfile.modelCatalog?.defaultModel,
      "",
    ),
    bundledDefaultModel: normalizeString(
      bundledItems.find((entry) =>
        normalizeString(entry?.status, "") !== "rejected")?.id,
      "",
    ),
    source: providerItems.length
      ? providerDescriptorSource
      : bundledItems.length
        ? "bundled_profile"
        : "unavailable",
    evidenceState: providerSource === "server_model_list"
      ? "provider_observed"
      : providerItems.length
        ? "cached_provider_observation"
        : bundledItems.length
          ? "bundled_profile_observation"
          : "unavailable",
  };
}

function modelDescriptor(catalog, model) {
  return (catalog?.models || []).find((entry) => entry.id === model) || null;
}

function resolveWorldManagerRuntimeSelection(input = {}) {
  const configured = normalizeWorldManagerRuntimePreferences(input.configured);
  const projectModel = normalizeString(
    input.project?.surfaceBinding?.codex?.model,
    "",
  );
  const catalog = input.catalog || buildWorldManagerModelCatalog({
    providerMetadataProfile: input.providerMetadataProfile,
    profileDoc: input.profileDoc,
    configuredModel: configured.model,
  });
  const model = configured.model ||
    projectModel ||
    normalizeString(catalog.providerDefaultModel, "") ||
    normalizeString(catalog.bundledDefaultModel, "") ||
    "gpt-5.4";
  const requestedReasoningEffort = normalizeWorldManagerReasoningEffort(
    input.requestedReasoningEffort,
  );
  const projectReasoningEffort = normalizeWorldManagerReasoningEffort(
    input.project?.surfaceBinding?.codex?.reasoningEffort,
  );
  const descriptor = modelDescriptor(catalog, model);
  const reasoningEffort = configured.reasoningEffort ||
    requestedReasoningEffort ||
    projectReasoningEffort ||
    descriptor?.defaultReasoningEffort ||
    "medium";
  return {
    configured,
    model,
    reasoningEffort,
    modelSource: configured.model
      ? "world_manager_preference"
      : projectModel
        ? "project_runtime_binding"
        : catalog.providerDefaultModel
          ? "provider_default"
          : catalog.bundledDefaultModel
            ? "bundled_profile_default"
            : "transport_default",
    reasoningEffortSource: configured.reasoningEffort
      ? "world_manager_preference"
      : requestedReasoningEffort
        ? "role_contract"
        : projectReasoningEffort
          ? "project_runtime_binding"
          : descriptor?.defaultReasoningEffort
            ? "model_default"
            : "harness_default",
    descriptor,
    catalog,
  };
}

function resolveWorldManagerModelEvidence(input = {}) {
  const probeEvidence = isPlainObject(input.probeEvidence)
    ? input.probeEvidence
    : null;
  if (probeEvidence?.accepted || input.managerScoped !== true) {
    return probeEvidence;
  }
  const metadata = input.providerMetadataStatus || {};
  const profile = metadata.profile || {};
  const model = normalizeString(input.model, "");
  const descriptor = (profile.modelCatalog?.items || []).find((entry) =>
    normalizeString(entry?.model || entry?.id, "") === model);
  const providerObserved =
    metadata.cacheState === "fresh" &&
    profile.modelCatalog?.source === "server_model_list" &&
    Boolean(descriptor);
  if (!providerObserved) return probeEvidence;
  return {
    model,
    modelSource: "provider_model_catalog",
    modelEvidenceState: "provider_observed",
    accepted: true,
    evidenceId: normalizeString(
      profile.profileId,
      `provider_catalog:${model}`,
    ),
    reason: "",
    liveProbeEvidence: {
      available: true,
      usable: true,
      status: "provider_catalog_observed",
      source: "direct_provider_metadata",
      model,
      cacheState: metadata.cacheState,
      rawTokensExposed: false,
      rawBackendFramesExposed: false,
    },
  };
}

function buildWorldManagerRuntimeSettingsProjection(input = {}) {
  const configured = normalizeWorldManagerRuntimePreferences(input.configured);
  const catalog = buildWorldManagerModelCatalog({
    providerMetadataProfile: input.providerMetadataProfile,
    profileDoc: input.profileDoc,
    configuredModel: configured.model,
  });
  const effective = resolveWorldManagerRuntimeSelection({
    configured,
    catalog,
    project: input.project,
    requestedReasoningEffort: input.requestedReasoningEffort || "medium",
  });
  const lastObserved = isPlainObject(input.lastObserved)
    ? {
        model: normalizeString(input.lastObserved.model, ""),
        reasoningEffort: normalizeWorldManagerReasoningEffort(
          input.lastObserved.reasoningEffort,
        ),
        observedAt: normalizeString(input.lastObserved.observedAt, ""),
        evidenceState: normalizeString(
          input.lastObserved.evidenceState,
          "provider_observed",
        ),
      }
    : null;
  return {
    schema: WORLD_MANAGER_RUNTIME_SETTINGS_SCHEMA,
    configured,
    effective: {
      model: effective.model,
      reasoningEffort: effective.reasoningEffort,
      modelSource: effective.modelSource,
      reasoningEffortSource: effective.reasoningEffortSource,
    },
    lastObserved,
    catalog: {
      source: catalog.source,
      evidenceState: catalog.evidenceState,
      cacheState: normalizeString(input.metadataCacheState, "unknown"),
      refreshed: input.refreshed === true,
      providerDefaultModel: catalog.providerDefaultModel,
      bundledDefaultModel: catalog.bundledDefaultModel,
      models: catalog.models,
    },
    scope: {
      appliesTo: ["world_manager", "project_manager"],
      excludes: [
        "constitutional_meta_role",
        "implementation_worker",
        "auditor",
      ],
      effectiveFrom: "next_manager_provider_call",
    },
    mutationAuthorityGranted: false,
    providerCallStarted: false,
    generatedAt: normalizeString(
      input.generatedAt,
      new Date().toISOString(),
    ),
  };
}

module.exports = {
  KNOWN_REASONING_EFFORTS,
  WORLD_MANAGER_RUNTIME_SETTINGS_SCHEMA,
  buildWorldManagerModelCatalog,
  buildWorldManagerRuntimeSettingsProjection,
  normalizeWorldManagerReasoningEffort,
  normalizeWorldManagerRuntimePreferences,
  resolveWorldManagerModelEvidence,
  resolveWorldManagerRuntimeSelection,
};
