#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  DIRECT_BRIDGE_MODULE_AUTHORITY_REPORT_SCHEMA,
  DIRECT_BRIDGE_MODULE_REGISTRY_SCHEMA,
  DIRECT_BRIDGE_MODULE_STATUS_PROJECTION_SCHEMA,
  buildBridgeModuleAuthorityReport,
  buildBridgeModuleRegistry,
  buildBridgeModuleStatusProjection,
  stableStringify,
} = require("../src/main/direct/bridge/skills-hooks-apps");
const {
  buildWorkThread,
} = require("../src/main/direct/bridge/work-thread-registry");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  const workThread = buildWorkThread({
    workThreadId: "work_thread_modules_fixture",
    projectId: "project_direct_bridge_modules",
    title: "Direct bridge module classification fixture",
    authorityBoundary: {
      mutationAllowedBeforeResolution: false,
      allowedActions: ["classify_bridge_modules"],
      forbiddenActions: ["module_execution_before_authority_gate"],
      summary: "Skills/hooks/apps may be classified before execution exists.",
    },
    activeRuntimePath: "direct-implementation",
  });
  const registry = buildBridgeModuleRegistry({
    projectId: workThread.projectId,
    workThreadId: workThread.workThreadId,
    nowMs: 0,
    modules: [
      {
        moduleId: "skill_morphic_ux_frontend",
        moduleKind: "skill",
        displayName: "Morphic UX Frontend",
        source: "codex_skill",
        workThreadScoped: true,
        authorityPosture: "context_only",
        capabilities: [
          {
            capabilityId: "cap_morphic_ux_procedure",
            capabilityKind: "procedural_context",
            authorityPosture: "context_only",
            sideEffectScope: "none",
          },
        ],
      },
      {
        moduleId: "hook_pre_context_compile",
        moduleKind: "hook",
        displayName: "Pre-context compile hook",
        source: "direct_harness",
        authorityPosture: "action_proposal",
        capabilities: [
          {
            capabilityId: "cap_context_transform_proposal",
            capabilityKind: "context_transform",
            authorityPosture: "action_proposal",
            sideEffectScope: "none",
          },
        ],
      },
      {
        moduleId: "connector_github_review",
        moduleKind: "connector",
        displayName: "GitHub review connector",
        source: "connector",
        authorityPosture: "evidence_import",
        capabilities: [
          {
            capabilityId: "cap_github_import_review",
            capabilityKind: "external_evidence_import",
            authorityPosture: "evidence_import",
            sideEffectScope: "external_service",
          },
          {
            capabilityId: "cap_hostile_connector_action",
            capabilityKind: "connector_action",
            authorityPosture: "execution_requires_gate",
            sideEffectScope: "external_service",
            executionAllowedInThisPr: true,
            mutationAllowedInThisPr: true,
            providerCallAllowedInThisPr: true,
            routingAllowedInThisPr: true,
            autoInvokeAllowedInThisPr: true,
          },
        ],
        mayExecuteActionInThisPr: true,
        mayMutateWorkspaceInThisPr: true,
        mayCallProviderInThisPr: true,
        mayRouteWorkThreadInThisPr: true,
        autoInvocationAllowedInThisPr: true,
      },
    ],
  });
  assert(registry.schema === DIRECT_BRIDGE_MODULE_REGISTRY_SCHEMA, "registry schema mismatch");
  assert(registry.moduleCount === 3, "expected three bridge modules");
  assert(registry.createdAt === "1970-01-01T00:00:00.000Z", "epoch-zero timestamp should be preserved");
  assert(registry.executableInThisPr === false, "registry must not enable execution");
  assert(registry.routingEnforcedInThisPr === false, "registry must not enforce routing");
  assert(stableStringify({ at: new Date(0) }) === "{\"at\":\"1970-01-01T00:00:00.000Z\"}", "stableStringify should honor toJSON");

  const skill = registry.modules.find((module) => module.moduleKind === "skill");
  const hook = registry.modules.find((module) => module.moduleKind === "hook");
  const connector = registry.modules.find((module) => module.moduleKind === "connector");
  assert(skill.mayContributeContext === true && skill.mayExecuteActionInThisPr === false, "skill should be context-only");
  assert(hook.mayProposeAction === true && hook.mayExecuteActionInThisPr === false, "hook may propose but not execute");
  assert(connector.mayImportEvidence === true && connector.mayCallProviderInThisPr === false, "connector may import evidence but not call provider in this PR");
  assert(connector.authorityInflationAttempted === true, "connector module should preserve a blocked authority-attempt witness");
  assert(
    connector.capabilities.every((capability) => capability.executionAllowedInThisPr === false &&
      capability.mutationAllowedInThisPr === false &&
      capability.providerCallAllowedInThisPr === false &&
      capability.routingAllowedInThisPr === false &&
      capability.autoInvokeAllowedInThisPr === false),
    "capability authority inflation must be stripped",
  );
  assert(
    connector.capabilities.some((capability) => capability.authorityInflationAttempted === true),
    "hostile capability should preserve a blocked authority-attempt witness",
  );

  const report = buildBridgeModuleAuthorityReport({ registry });
  assert(report.schema === DIRECT_BRIDGE_MODULE_AUTHORITY_REPORT_SCHEMA, "authority report schema mismatch");
  assert(report.contextContributorCount === 2, "skill and connector should contribute context/evidence");
  assert(report.evidenceImporterCount === 1, "connector should be one evidence importer");
  assert(report.actionProposalCount === 1, "hook should be one action proposal module");
  assert(report.executionModuleCount === 0, "no module should be executable in this PR");
  assert(report.gateRequiredCapabilityCount === 1, "hostile connector action remains classified as gate-required capability");
  assert(report.executionAllowedInThisPr === false, "report must not enable execution");
  assert(report.mutationAllowedInThisPr === false, "report must not enable mutation");
  assert(report.providerCallAllowedInThisPr === false, "report must not enable provider calls");
  assert(report.routingAllowedInThisPr === false, "report must not enable routing");
  assert(report.autoInvocationAllowedInThisPr === false, "report must not enable auto invocation");
  assert(report.attemptedAuthorityInflationBlocked === true, "authority inflation should be blocked");

  const sparseReport = buildBridgeModuleAuthorityReport({
    registry: {
      registryId: "sparse_external_registry",
      registryDigest: "sparse_digest",
      modules: [
        {
          moduleId: "sparse_module_without_capabilities",
          mayContributeContext: true,
          authorityInflationAttempted: false,
        },
      ],
    },
  });
  assert(sparseReport.moduleCount === 1, "sparse external registry should still produce a report");
  assert(sparseReport.gateRequiredCapabilityCount === 0, "missing capabilities should be treated as empty");

  const status = buildBridgeModuleStatusProjection({ registry, report });
  assert(status.schema === DIRECT_BRIDGE_MODULE_STATUS_PROJECTION_SCHEMA, "status projection schema mismatch");
  assert(status.actionable === false, "status projection must be display-only");
  assert(status.executionAllowedInThisPr === false, "status projection must not enable execution");

  const rawSerialized = JSON.stringify({ registry, report, status });
  assert(!rawSerialized.includes("rawSecretIncluded\":true"), "raw secret flag must stay false");
  assert(!rawSerialized.includes("rawTextIncluded\":true"), "raw text flag must stay false");

  console.log(JSON.stringify({
    ok: true,
    registryId: registry.registryId,
    reportId: report.reportId,
    projectionDigest: status.projectionDigest,
    moduleCount: registry.moduleCount,
    executionAllowedInThisPr: report.executionAllowedInThisPr,
  }, null, 2));
}

main();
