#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  DIRECT_BRIDGE_CONTEXT_CONTRIBUTION_SCHEMA,
  DIRECT_BRIDGE_EVIDENCE_IMPORT_ROW_SCHEMA,
  DIRECT_BRIDGE_EXECUTION_GATE_SCHEMA,
  DIRECT_BRIDGE_HOOK_PROPOSAL_SCHEMA,
  buildBridgeContextContribution,
  buildBridgeEvidenceImportRow,
  buildBridgeExecutionGate,
  buildBridgeHookProposal,
  buildBridgeModuleAuthorityReport,
  buildBridgeModuleRegistry,
  buildBridgeModuleStatusProjection,
  validateBridgeModuleExecutionWorkflow,
} = require("../src/main/direct/bridge/skills-hooks-apps");
const {
  buildAuthorityBearingTransition,
} = require("../src/main/direct/bridge/work-thread-alignment");
const {
  buildWorkThread,
} = require("../src/main/direct/bridge/work-thread-registry");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  const workThread = buildWorkThread({
    workThreadId: "work_thread_module_gates_fixture",
    projectId: "project_direct_module_gates",
    title: "Direct bridge module execution gates fixture",
    activeRuntimePath: "direct-implementation",
  });
  const registry = buildBridgeModuleRegistry({
    projectId: workThread.projectId,
    workThreadId: workThread.workThreadId,
    nowMs: 0,
    modules: [
      {
        moduleId: "skill_odeu_workflow",
        moduleKind: "skill",
        displayName: "ODEU Workflow Skill",
        authorityPosture: "context_only",
        capabilities: [{ capabilityId: "cap_odeu_context", capabilityKind: "procedural_context", authorityPosture: "context_only" }],
      },
      {
        moduleId: "connector_github_reviews",
        moduleKind: "connector",
        displayName: "GitHub Review Connector",
        authorityPosture: "evidence_import",
        capabilities: [{ capabilityId: "cap_github_review_import", capabilityKind: "external_evidence_import", authorityPosture: "evidence_import" }],
      },
      {
        moduleId: "hook_preflight_context",
        moduleKind: "hook",
        displayName: "Preflight Context Hook",
        authorityPosture: "action_proposal",
        capabilities: [{ capabilityId: "cap_preflight_proposal", capabilityKind: "context_transform", authorityPosture: "action_proposal" }],
      },
      {
        moduleId: "hook_mutating_future",
        moduleKind: "hook",
        displayName: "Future Mutating Hook",
        authorityPosture: "execution_requires_gate",
        capabilities: [{ capabilityId: "cap_future_mutation", capabilityKind: "hook_action", authorityPosture: "execution_requires_gate" }],
      },
    ],
  });
  const skill = registry.modules.find((module) => module.moduleId === "skill_odeu_workflow");
  const connector = registry.modules.find((module) => module.moduleId === "connector_github_reviews");
  const hook = registry.modules.find((module) => module.moduleId === "hook_preflight_context");
  const futureHook = registry.modules.find((module) => module.moduleId === "hook_mutating_future");

  const contribution = buildBridgeContextContribution({
    projectId: workThread.projectId,
    workThreadId: workThread.workThreadId,
    contextPackId: "context_pack_module_gates",
    module: skill,
    contextRefs: [{ kind: "skill_context_ref", artifactId: "odeu_skill_contract", artifactDigest: "digest_skill_contract" }],
    nowMs: 0,
  });
  const evidenceRow = buildBridgeEvidenceImportRow({
    projectId: workThread.projectId,
    workThreadId: workThread.workThreadId,
    module: connector,
    sourceRefs: [{ kind: "github_review", artifactId: "pr_review_140", artifactDigest: "digest_review_140" }],
    evidenceAuthority: "external_review_comment",
    nowMs: 0,
  });
  const hookProposal = buildBridgeHookProposal({
    projectId: workThread.projectId,
    workThreadId: workThread.workThreadId,
    module: hook,
    proposedActionKind: "context_transform",
    sourceRefs: [{ kind: "context_pack", artifactId: "context_pack_module_gates", artifactDigest: "digest_context_pack" }],
    nowMs: 0,
  });
  const futureHookProposal = buildBridgeHookProposal({
    projectId: workThread.projectId,
    workThreadId: workThread.workThreadId,
    module: futureHook,
    proposedActionKind: "workspace_write",
    sourceRefs: [{ kind: "operator_intent", artifactId: "future_hook_request", artifactDigest: "digest_future_hook" }],
    nowMs: 0,
  });
  const missingAuthorityGate = buildBridgeExecutionGate({
    projectId: workThread.projectId,
    workThreadId: workThread.workThreadId,
    module: futureHook,
    hookProposal: futureHookProposal,
    executionRequested: true,
    nowMs: 0,
  });
  const authorityTransition = buildAuthorityBearingTransition({
    workThread,
    projectId: workThread.projectId,
    threadId: "thread_module_gate_fixture",
    transitionKind: "workspace_write",
    transitionPhase: "proposal",
    status: "blocked",
    sourceArtifact: {
      kind: "bridge_hook_proposal",
      artifactId: futureHookProposal.hookProposalId,
      artifactDigest: futureHookProposal.proposalDigest,
    },
  });
  const citedAuthorityGate = buildBridgeExecutionGate({
    projectId: workThread.projectId,
    workThreadId: workThread.workThreadId,
    module: futureHook,
    hookProposal: futureHookProposal,
    authorityTransition,
    executionRequested: true,
    nowMs: 0,
  });
  const idAliasGate = buildBridgeExecutionGate({
    projectId: workThread.projectId,
    workThreadId: workThread.workThreadId,
    module: {
      id: "hook_alias_future",
      moduleKind: "hook",
      authorityPosture: "execution_requires_gate",
    },
    executionRequested: true,
    nowMs: 0,
  });

  assert(contribution.schema === DIRECT_BRIDGE_CONTEXT_CONTRIBUTION_SCHEMA, "context contribution schema mismatch");
  assert(contribution.contributionState === "accepted_context_ref", "skill should contribute context refs");
  assert(contribution.providerInputEligible === true, "context contribution should be provider-input eligible as refs");
  assert(contribution.instructionAuthorityGranted === false, "skill contribution must not gain instruction authority");

  assert(evidenceRow.schema === DIRECT_BRIDGE_EVIDENCE_IMPORT_ROW_SCHEMA, "evidence import row schema mismatch");
  assert(evidenceRow.importState === "accepted_evidence_row", "connector should import explicit evidence rows");
  assert(evidenceRow.connectorTransportUsedInThisPr === false, "evidence row must not imply connector transport");
  assert(evidenceRow.providerCallAllowedInThisPr === false, "evidence row must not enable provider calls");

  assert(hookProposal.schema === DIRECT_BRIDGE_HOOK_PROPOSAL_SCHEMA, "hook proposal schema mismatch");
  assert(hookProposal.proposalState === "proposed", "hook should propose only");
  assert(hookProposal.executionAllowedInThisPr === false, "hook proposal must not execute");
  assert(hookProposal.workspaceMutationAllowedInThisPr === false, "hook proposal must not mutate workspace");

  assert(missingAuthorityGate.schema === DIRECT_BRIDGE_EXECUTION_GATE_SCHEMA, "execution gate schema mismatch");
  assert(missingAuthorityGate.gateState === "blocked_missing_authority_transition", "future hook execution should require authority transition");
  assert(idAliasGate.moduleRef.moduleId === "hook_alias_future", "execution gate should preserve id alias module refs");
  assert(idAliasGate.gateState === "blocked_missing_authority_transition", "id alias execution gate should still require authority transition");
  assert(citedAuthorityGate.gateState === "authority_cited_not_enabled", "authority citation should not enable execution in this PR");
  assert(citedAuthorityGate.executionAllowedInThisPr === false, "execution gate must not allow execution");
  assert(citedAuthorityGate.connectorActionAllowedInThisPr === false, "execution gate must not allow connector actions");
  assert(citedAuthorityGate.hookActionAllowedInThisPr === false, "execution gate must not allow hook actions");
  assert(citedAuthorityGate.autoInvocationAllowedInThisPr === false, "execution gate must not allow auto invocation");

  validateBridgeModuleExecutionWorkflow({
    contextContributions: [contribution],
    evidenceImportRows: [evidenceRow],
    hookProposals: [hookProposal, futureHookProposal],
    executionGates: [missingAuthorityGate, citedAuthorityGate],
  });

  const report = buildBridgeModuleAuthorityReport({ registry });
  const status = buildBridgeModuleStatusProjection({
    registry,
    report,
    contextContributions: [contribution],
    evidenceImportRows: [evidenceRow],
    hookProposals: [hookProposal, futureHookProposal],
    executionGates: [missingAuthorityGate, citedAuthorityGate],
  });
  assert(status.contextContributionCount === 1, "status should count context contributions");
  assert(status.evidenceImportRowCount === 1, "status should count evidence import rows");
  assert(status.hookProposalCount === 2, "status should count hook proposals");
  assert(status.executionGateCount === 2, "status should count execution gates");
  assert(status.executionAllowedInThisPr === false, "status must not enable execution");
  assert(status.executionGateStates.includes("blocked_missing_authority_transition"), "status should expose blocked gate state");
  assert(status.executionGateStates.includes("authority_cited_not_enabled"), "status should expose cited-but-disabled gate state");

  const sparseStatus = buildBridgeModuleStatusProjection({
    registry,
    report,
    contextContributions: [null, contribution],
    evidenceImportRows: [undefined, evidenceRow],
    hookProposals: [null, hookProposal],
    executionGates: [undefined, missingAuthorityGate],
  });
  assert(sparseStatus.contextContributionCount === 1, "sparse status should count valid context contributions");
  assert(sparseStatus.evidenceImportRowCount === 1, "sparse status should count valid evidence rows");
  assert(sparseStatus.hookProposalCount === 1, "sparse status should count valid hook proposals");
  assert(sparseStatus.executionGateStates.includes("not_requested"), "sparse status should tolerate missing execution gate entries");

  const hostileGate = { ...citedAuthorityGate, executionAllowedInThisPr: true };
  let hostileGateBlocked = false;
  try {
    validateBridgeModuleExecutionWorkflow({ executionGates: [hostileGate] });
  } catch (error) {
    hostileGateBlocked = error.message === "bridge_module_execution_authority_leak";
  }
  assert(hostileGateBlocked === true, "validator should reject execution authority leaks");

  const serialized = JSON.stringify({ contribution, evidenceRow, hookProposal, futureHookProposal, missingAuthorityGate, citedAuthorityGate, status });
  assert(!serialized.includes("\"rawTextIncluded\":true"), "module gate workflow must not include raw text");
  assert(!serialized.includes("\"rawSecretIncluded\":true"), "module gate workflow must not include raw secrets");
  assert(!serialized.includes("\"executionAllowedInThisPr\":true"), "module gate workflow must not enable execution");
  assert(!serialized.includes("\"providerCallAllowedInThisPr\":true"), "module gate workflow must not enable provider calls");
  assert(!serialized.includes("\"workspaceMutationAllowedInThisPr\":true"), "module gate workflow must not enable workspace mutation");

  console.log(JSON.stringify({
    ok: true,
    registryId: registry.registryId,
    contributionState: contribution.contributionState,
    evidenceImportState: evidenceRow.importState,
    hookProposalCount: status.hookProposalCount,
    executionGateStates: status.executionGateStates,
    executionAllowedInThisPr: status.executionAllowedInThisPr,
  }, null, 2));
}

main();
