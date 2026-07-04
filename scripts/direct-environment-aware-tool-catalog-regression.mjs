#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  buildDirectEnvironmentTopology,
  buildEnvironmentAwareToolCatalog,
  buildTopologyCompatibility,
  buildTurnExecutionEnvironment,
  validateEnvironmentAwareToolCatalog,
} = require("../src/main/direct/worldmodel");
const {
  buildToolCapabilityRegistry,
} = require("../src/main/direct/bridge/tool-capability-registry");

function expectThrows(fn, expectedCode) {
  try {
    fn();
  } catch (error) {
    assert.equal(error.code, expectedCode, `expected ${expectedCode}, got ${error.code || error.message}`);
    return error;
  }
  throw new Error(`expected throw: ${expectedCode}`);
}

const now = () => Date.UTC(2026, 6, 4, 12, 30, 0);

const topology = buildDirectEnvironmentTopology({
  topologyId: "env_tool_catalog_topology",
  projectId: "project_env_tool_catalog",
  defaultEnvironmentId: "env_wsl_catalog",
  revision: 2,
  environments: [
    {
      environmentId: "env_wsl_catalog",
      environmentKind: "wsl",
      displayLabel: "WSL implementer",
      defaultShell: "bash",
      workspaceEvidenceKey: "workspace:wsl:catalog",
      availableToolFamilyRefs: [{
        kind: "tool_family",
        id: "local_perception",
        digest: "sha256:local_perception",
        label: "Local perception",
      }],
    },
    {
      environmentId: "env_windows_browser_catalog",
      environmentKind: "windows",
      displayLabel: "Windows browser specialist",
      defaultShell: "powershell",
      availableToolFamilyRefs: [{
        kind: "tool_family",
        id: "browser_control",
        digest: "sha256:browser_control",
        label: "Browser control",
      }],
    },
  ],
  mappings: [{
    mappingId: "mapping_wsl_windows_catalog",
    fromEnvironmentId: "env_wsl_catalog",
    toEnvironmentId: "env_windows_browser_catalog",
    fromRootEvidenceKey: "root:wsl:catalog",
    toRootEvidenceKey: "root:windows:catalog",
    direction: "two_way",
    mappingKind: "wsl_windows_path",
    readAllowed: true,
    writeAllowed: false,
  }],
  constraints: [{
    constraintId: "constraint_browser_no_workspace_write_catalog",
    environmentId: "env_windows_browser_catalog",
    constraintKind: "no_workspace_mutation",
    rationale: "Browser specialist can observe UI but not mutate workspace files.",
  }],
}, { now });

const turnEnvironment = buildTurnExecutionEnvironment({
  topology,
  turnId: "turn_env_tool_catalog",
  threadId: "direct_session_env_tool_catalog",
  workThreadId: "work_thread_env_tool_catalog",
  residentEnvironmentId: "env_wsl_catalog",
  selectionKind: "thread_default",
  reason: "default_work",
});

const registry = buildToolCapabilityRegistry({
  registryId: "registry_env_tool_catalog",
  projectId: "project_env_tool_catalog",
  workThreadId: "work_thread_env_tool_catalog",
  rows: [
    {
      toolId: "direct.read_file",
      displayName: "read_file",
      directNames: ["read_file"],
      odeuFamily: "local_perception",
      capabilityState: "runtime_probed",
      implementationState: "restricted_executor",
      promotionState: "direct_restricted",
      providerDeclarationState: "declared_live_unproved",
      localExecutorState: "implemented_restricted",
      requestShapeFamilies: ["function_call"],
      localExecutor: "src/main/direct/tools/read-only-authority.js",
      providerResultEnvelopeType: "bounded_result_envelope",
    },
    {
      toolId: "direct.browser.quick_view",
      displayName: "browser_quick_view",
      directNames: ["browser_quick_view"],
      odeuFamily: "external_capability_discovery",
      capabilityState: "runtime_probed",
      implementationState: "projection_only",
      promotionState: "diagnostic_only",
      providerDeclarationState: "not_declared",
      localExecutorState: "scaffolded",
      requestShapeFamilies: ["browser_observation_request"],
      localExecutor: "src/main/direct/external/browser-specialist.js",
    },
    {
      toolId: "direct.browser.verify",
      displayName: "browser_verify",
      directNames: ["browser_verify"],
      odeuFamily: "external_capability_discovery",
      capabilityState: "runtime_probed",
      implementationState: "projection_only",
      promotionState: "diagnostic_only",
      providerDeclarationState: "not_declared",
      localExecutorState: "scaffolded",
      requestShapeFamilies: ["browser_verification_task"],
      localExecutor: "src/main/direct/external/browser-specialist.js",
    },
    {
      toolId: "direct.remote_probe",
      displayName: "remote_probe",
      directNames: ["remote_probe"],
      odeuFamily: "external_resource_action_authority",
      capabilityState: "vanilla_known",
      implementationState: "projection_only",
      promotionState: "diagnostic_only",
      providerDeclarationState: "not_declared",
      localExecutorState: "scaffolded",
      requestShapeFamilies: ["external_probe_request"],
      localExecutor: "src/main/direct/external/remote-probe.js",
    },
  ],
});

const catalog = buildEnvironmentAwareToolCatalog({
  catalogId: "env_aware_tool_catalog_fixture",
  registryId: "registry_env_tool_catalog",
  capabilityRegistry: registry,
  topology,
  turnEnvironment,
  environmentOwnerHints: [
    {
      toolId: "direct.read_file",
      ownerEnvironmentId: "env_wsl_catalog",
    },
    {
      toolId: "direct.browser.quick_view",
      ownerEnvironmentId: "env_windows_browser_catalog",
      routeClass: "cross_environment_tool_session",
      actionClass: "windows_browser_action",
    },
    {
      toolId: "direct.browser.verify",
      ownerEnvironmentId: "env_windows_browser_catalog",
      routeClass: "specialist_worker_required",
      actionClass: "windows_browser_action",
    },
    {
      toolId: "direct.remote_probe",
      ownerEnvironmentId: "env_remote_unmapped",
      actionClass: "external_service_action",
    },
  ],
}, { now });

validateEnvironmentAwareToolCatalog(catalog);
assert.equal(catalog.catalogGrantsAuthority, false);
assert.equal(catalog.providerDeclarationEnabledInThisPr, false);
assert.equal(catalog.localExecutionEnabledInThisPr, false);
assert.equal(catalog.workspaceMutationAuthorized, false);
assert.equal(catalog.byRouteClass.same_environment, 1);
assert.equal(catalog.byRouteClass.cross_environment_tool_session, 1);
assert.equal(catalog.byRouteClass.specialist_worker_required, 1);
assert.equal(catalog.byRouteClass.unsupported_environment, 1);

const byTool = new Map(catalog.routeRows.map((row) => [row.toolId, row]));
assert.equal(byTool.get("direct.read_file").routeClass, "same_environment");
assert.equal(byTool.get("direct.read_file").routeStatus, "route_available");
assert.match(byTool.get("direct.read_file").residentCapabilityExplanation, /per-call authority/);
assert.equal(byTool.get("direct.browser.quick_view").routeClass, "cross_environment_tool_session");
assert.equal(byTool.get("direct.browser.quick_view").environmentPathMappingRef.id, "mapping_wsl_windows_catalog");
assert.equal(byTool.get("direct.browser.quick_view").environmentRouteGrantsAuthority, false);
assert.equal(byTool.get("direct.browser.verify").routeClass, "specialist_worker_required");
assert.match(byTool.get("direct.browser.verify").residentCapabilityExplanation, /specialist worker/);
assert.equal(byTool.get("direct.remote_probe").routeClass, "unsupported_environment");
assert.equal(byTool.get("direct.remote_probe").routeMayProceed, false);
assert.ok(byTool.get("direct.remote_probe").blockerCodes.includes("owner_environment_missing"));

const rowOwnedCatalog = buildEnvironmentAwareToolCatalog({
  catalogId: "env_aware_tool_catalog_raw_rows_fixture",
  topology,
  turnEnvironment,
  rows: [
    {
      toolId: "direct.browser.row_owned",
      displayName: "browser_row_owned",
      directNames: ["browser_row_owned"],
      odeuFamily: "external_capability_discovery",
      capabilityState: "runtime_probed",
      implementationState: "projection_only",
      promotionState: "diagnostic_only",
      providerDeclarationState: "not_declared",
      localExecutorState: "scaffolded",
      requestShapeFamilies: ["browser_observation_request"],
      localExecutor: "src/main/direct/external/browser-specialist.js",
      ownerEnvironmentId: "env_windows_browser_catalog",
      environmentRouteClass: "specialist_worker_required",
      environmentActionClass: "windows_browser_action",
    },
  ],
}, { now });
validateEnvironmentAwareToolCatalog(rowOwnedCatalog);
assert.equal(rowOwnedCatalog.routeRows[0].ownerEnvironmentId, "env_windows_browser_catalog");
assert.equal(rowOwnedCatalog.routeRows[0].ownerSource, "tool_catalog_row");
assert.equal(rowOwnedCatalog.routeRows[0].routeClass, "specialist_worker_required");
assert.equal(rowOwnedCatalog.routeRows[0].actionClass, "windows_browser_action");

const missingTopologyCatalog = buildEnvironmentAwareToolCatalog({
  capabilityRegistry: registry,
  turnEnvironment,
}, { now });
validateEnvironmentAwareToolCatalog(missingTopologyCatalog);
assert.equal(missingTopologyCatalog.byRouteClass.unsupported_environment, registry.rowCount);
assert.ok(missingTopologyCatalog.routeRows.every((row) => row.blockerCodes.includes("environment_topology_missing")));

const staleCompatibility = buildTopologyCompatibility({
  expectedTopologyId: topology.topologyId,
  expectedRevision: 1,
  currentTopology: topology,
  relevantEnvironmentIds: ["env_windows_browser_catalog"],
  changedEnvironmentIds: ["env_windows_browser_catalog"],
  compatibilityWitnessKind: "changed_fields_irrelevant",
}, { now });
assert.equal(staleCompatibility.requiresRemand, true);

const staleCatalog = buildEnvironmentAwareToolCatalog({
  capabilityRegistry: registry,
  topology,
  turnEnvironment,
  topologyCompatibility: staleCompatibility,
}, { now });
validateEnvironmentAwareToolCatalog(staleCatalog);
assert.ok(staleCatalog.routeRows.every((row) => row.blockerCodes.includes("environment_topology_requires_remand")));
assert.equal(staleCatalog.byRouteClass.unsupported_environment, registry.rowCount);

expectThrows(() => validateEnvironmentAwareToolCatalog({
  ...catalog,
  catalogGrantsAuthority: true,
}), "direct_environment_tool_catalog_authority_leak");

expectThrows(() => validateEnvironmentAwareToolCatalog({
  ...catalog,
  routeRows: catalog.routeRows.map((row, index) => index === 0
    ? { ...row, workspaceMutationAuthorized: true }
    : row),
}), "direct_environment_tool_catalog_authority_leak");

console.log(JSON.stringify({
  ok: true,
  schema: catalog.schema,
  routeClasses: catalog.byRouteClass,
  staleBlocked: staleCatalog.byRouteClass.unsupported_environment,
}, null, 2));
