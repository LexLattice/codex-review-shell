#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  WORLD_MANAGER_RUNTIME_SETTINGS_SCHEMA,
  buildWorldManagerRuntimeSettingsProjection,
  normalizeWorldManagerRuntimePreferences,
  resolveWorldManagerModelEvidence,
  resolveWorldManagerRuntimeSelection,
} = require(
  "../src/main/direct/worldmanager/runtime-settings",
);

const profileDoc = {
  profile: {
    ontology: {
      models: [
        {
          id: "gpt-5.5",
          displayName: "GPT-5.5",
          status: "observed",
          supportedReasoningEfforts: [
            "low",
            "medium",
            "high",
            "xhigh",
          ],
        },
      ],
    },
  },
};
const providerMetadataProfile = {
  modelCatalog: {
    source: "server_model_list",
    defaultModel: "gpt-5.6-sol",
    items: [
      {
        id: "gpt-5.6-sol",
        displayName: "GPT-5.6 Sol",
        supportedReasoningEfforts: [
          { reasoningEffort: "medium" },
          { reasoningEffort: "high" },
          { reasoningEffort: "xhigh" },
        ],
        defaultReasoningEffort: "high",
      },
    ],
  },
};
const project = {
  id: "project_runtime_settings",
  surfaceBinding: {
    codex: {
      model: "",
      reasoningEffort: "",
    },
  },
};

assert.deepEqual(
  normalizeWorldManagerRuntimePreferences({
    model: " gpt-5.6-sol ",
    reasoning_effort: "XHIGH",
  }),
  {
    model: "gpt-5.6-sol",
    reasoningEffort: "xhigh",
  },
);

const automatic = resolveWorldManagerRuntimeSelection({
  configured: {},
  project,
  requestedReasoningEffort: "medium",
  profileDoc,
  providerMetadataProfile,
});
assert.equal(automatic.model, "gpt-5.6-sol");
assert.equal(automatic.modelSource, "provider_default");
assert.equal(automatic.reasoningEffort, "medium");
assert.equal(automatic.reasoningEffortSource, "role_contract");

const explicit = resolveWorldManagerRuntimeSelection({
  configured: {
    model: "gpt-5.6-sol",
    reasoningEffort: "xhigh",
  },
  project,
  requestedReasoningEffort: "low",
  profileDoc,
  providerMetadataProfile,
});
assert.equal(explicit.model, "gpt-5.6-sol");
assert.equal(explicit.modelSource, "world_manager_preference");
assert.equal(explicit.reasoningEffort, "xhigh");
assert.equal(
  explicit.reasoningEffortSource,
  "world_manager_preference",
);

const projection = buildWorldManagerRuntimeSettingsProjection({
  configured: explicit.configured,
  project,
  providerMetadataProfile,
  profileDoc,
  metadataCacheState: "fresh",
  refreshed: true,
  lastObserved: {
    model: "gpt-5.5",
    reasoningEffort: "medium",
    observedAt: "2026-08-05T09:00:00.000Z",
    evidenceState: "persisted_provider_telemetry",
  },
  generatedAt: "2026-08-05T10:00:00.000Z",
});
assert.equal(projection.schema, WORLD_MANAGER_RUNTIME_SETTINGS_SCHEMA);
assert.equal(projection.configured.model, "gpt-5.6-sol");
assert.equal(projection.effective.reasoningEffort, "xhigh");
assert.equal(projection.lastObserved.model, "gpt-5.5");
assert.equal(projection.catalog.evidenceState, "provider_observed");
assert.deepEqual(projection.scope.appliesTo, [
  "world_manager",
  "project_manager",
]);
assert.deepEqual(projection.scope.excludes, [
  "constitutional_meta_role",
  "implementation_worker",
  "auditor",
]);
assert.equal(projection.providerCallStarted, false);
assert.equal(projection.mutationAuthorityGranted, false);

const missingProbe = {
  model: "gpt-5.6-sol",
  accepted: false,
  modelEvidenceState: "unknown",
  reason: "live_probe_evidence_missing",
};
const managerCatalogEvidence = resolveWorldManagerModelEvidence({
  probeEvidence: missingProbe,
  providerMetadataStatus: {
    profile: providerMetadataProfile,
    cacheState: "fresh",
  },
  model: "gpt-5.6-sol",
  managerScoped: true,
});
assert.equal(managerCatalogEvidence.accepted, true);
assert.equal(
  managerCatalogEvidence.modelEvidenceState,
  "provider_observed",
);
assert.equal(
  managerCatalogEvidence.liveProbeEvidence.status,
  "provider_catalog_observed",
);
assert.equal(
  resolveWorldManagerModelEvidence({
    probeEvidence: missingProbe,
    providerMetadataStatus: {
      profile: providerMetadataProfile,
      cacheState: "fresh",
    },
    model: "gpt-5.6-sol",
    managerScoped: false,
  }),
  missingProbe,
);

console.log(JSON.stringify({
  ok: true,
  regression: "direct-world-manager-runtime-settings",
  configuredAndObservedTruthSeparated: true,
  explicitPreferenceOverridesRoleBaseline: true,
  managerScopeExcludesWorkers: true,
  managerScopeExcludesConstitutionalMetaRoles: true,
  freshProviderCatalogAuthorizesManagerModelOnly: true,
  providerRefreshDoesNotStartManagerCall: true,
}, null, 2));
