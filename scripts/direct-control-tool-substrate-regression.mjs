#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  DIRECT_CONTEXT_REMAINING_WITNESS_SCHEMA,
  DIRECT_CONTROL_TOOL_SUBSTRATE_STATUS_SCHEMA,
  DIRECT_HUMAN_DECISION_TOOL_PACKET_SCHEMA,
  DIRECT_NEW_CONTEXT_BLOCKED_PROJECTION_SCHEMA,
  DIRECT_PLAN_ARTIFACT_SCHEMA,
  DIRECT_VIEW_IMAGE_PROJECTION_SCHEMA,
  assertControlToolSubstrateSafe,
  buildContextRemainingWitness,
  buildControlToolSubstrateStatus,
  buildHumanDecisionToolPacket,
  buildNewContextBlockedProjection,
  buildPlanArtifact,
  buildViewImageProjection,
} = require("../src/main/direct/tools/control-perception-decision-substrate");
const {
  buildToolCapabilityRegistry,
  buildToolCapabilityStatusProjection,
  validateToolCapabilityRegistry,
} = require("../src/main/direct/bridge/tool-capability-registry");
const {
  assertDirectSettingsSurfaceRendererSafe,
  buildDirectSettingsSurfaceProjection,
} = require("../src/main/direct/ui/settings-surface");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function byToolId(registry) {
  return new Map(registry.rows.map((row) => [row.toolId, row]));
}

function main() {
  const projectId = "project_control_tool_fixture";
  const threadId = "thread_control_tool_fixture";
  const contextWitness = buildContextRemainingWitness({
    projectId,
    threadId,
    tokensLeft: 12345,
    confidence: "derived",
    estimateKind: "budget_policy_estimate",
    usableFor: "context_maintenance_diagnostic",
    nowMs: 0,
  });
  assert(contextWitness.schema === DIRECT_CONTEXT_REMAINING_WITNESS_SCHEMA, "context witness schema mismatch");
  assert(contextWitness.tokensLeft === 12345, "context witness should preserve tokens left");
  assert(contextWitness.permissionToContinue === false, "context witness must not grant permission to continue");
  assert(contextWitness.compactionAuthority === false, "context witness must not grant compaction authority");
  assert(contextWitness.providerTruth === false, "local estimate must not become provider truth");

  const plan = buildPlanArtifact({
    projectId,
    threadId,
    source: "model_tool_call",
    sourceTurnId: "turn_1",
    conflictsWithCurrentUserIntent: true,
    steps: [{ text: "Declare task complete", status: "completed" }],
    nowMs: 0,
  });
  assert(plan.schema === DIRECT_PLAN_ARTIFACT_SCHEMA, "plan schema mismatch");
  assert(plan.status === "blocked", "conflicting model plan should be blocked");
  assert(plan.humanInstructionWins === true, "human instruction should outrank model plan");
  assert(plan.mayAuthorizeAction === false, "plan must not authorize action");
  assert(plan.mayApproveTools === false, "plan must not approve tools");
  assert(plan.mayProveCompletion === false, "plan must not prove completion");
  assert(plan.mayEnterContextAs === "plan_evidence", "plan may only enter context as plan evidence");

  const viewImage = buildViewImageProjection({
    projectId,
    threadId,
    pathEvidenceKey: "path_evidence_key",
    displayName: "diagram.png",
    mimeType: "image/png",
    sizeBytes: 9876,
    rendererPreviewAvailable: true,
    nowMs: 0,
  });
  assert(viewImage.schema === DIRECT_VIEW_IMAGE_PROJECTION_SCHEMA, "view image schema mismatch");
  assert(viewImage.providerVisibilityState === "metadata_only", "view image should default to metadata-only");
  assert(viewImage.providerVisibilityEvidence === "not_sent", "view image should not claim provider visibility");
  assert(viewImage.modelSawPixels === false, "renderer preview must not imply model saw pixels");
  assert(viewImage.rawImageBytesIncluded === false, "image projection must not expose raw bytes");
  assert(viewImage.rawPathIncluded === false, "image projection must not expose raw path");

  const userInput = buildHumanDecisionToolPacket({
    projectId,
    threadId,
    toolKind: "request_user_input",
    promptPreview: "Choose one",
    choices: [{ choiceId: "yes", label: "Yes", carriesAuthority: true, authorityScope: "single_action" }],
    freeTextAllowed: true,
    nowMs: 0,
  });
  assert(userInput.schema === DIRECT_HUMAN_DECISION_TOOL_PACKET_SCHEMA, "human decision schema mismatch");
  assert(userInput.boundedChoiceMayCarryAuthority === true, "bounded choices may carry authority");
  assert(userInput.freeTextPolicy === "context_only", "free text should be context only");
  assert(userInput.freeTextCanWidenAuthority === false, "free text must not widen authority");
  assert(userInput.mayApproveToolAction === false, "packet alone must not approve tool action");

  const permissionInput = buildHumanDecisionToolPacket({
    projectId,
    threadId,
    toolKind: "request_permissions",
    promptPreview: "Widen access?",
    choices: ["Allow once", "Deny"],
    freeTextAllowed: false,
    nowMs: 0,
  });
  assert(permissionInput.permissionWideningRequested === true, "request_permissions should be marked as widening request");
  assert(permissionInput.defaultWideningScope === "single_action", "request_permissions should default to single-action scope");
  assert(permissionInput.mayMutateWorkspace === false, "permission packet itself must not mutate workspace");

  const newContext = buildNewContextBlockedProjection({ projectId, threadId, nowMs: 0 });
  assert(newContext.schema === DIRECT_NEW_CONTEXT_BLOCKED_PROJECTION_SCHEMA, "new_context blocked schema mismatch");
  assert(newContext.state === "blocked", "new_context must remain blocked");
  assert(newContext.providerDeclarationEnabled === false, "new_context must not be provider-declared");
  assert(newContext.localExecutorEnabled === false, "new_context must not have local executor");
  assert(newContext.requestShapeExposureEnabled === false, "new_context must not expose request shape");
  assert(newContext.requiredArtifacts.includes("frontier_baton"), "new_context should require frontier baton law");

  const status = buildControlToolSubstrateStatus({
    projectId,
    threadId,
    contextRemaining: contextWitness,
    planArtifact: plan,
    viewImage,
    humanDecision: userInput,
    newContext,
    nowMs: 0,
  });
  assert(status.schema === DIRECT_CONTROL_TOOL_SUBSTRATE_STATUS_SCHEMA, "status schema mismatch");
  assert(status.rowCount === 5, "status should summarize five tool projections");
  assert(status.executableToolCount === 0, "status must not enable executable tools");
  assert(status.providerDeclaredToolCount === 0, "status must not declare provider tools");
  assert(status.newContextBlocked === true, "status must report new_context blocked");
  assert(status.freeTextCanWidenAuthority === false, "status must block free-text authority widening");
  assert(status.planMayAuthorizeAction === false, "status must block plan authority");
  assertControlToolSubstrateSafe(status);

  const registry = buildToolCapabilityRegistry({ projectId, nowMs: 0 });
  validateToolCapabilityRegistry(registry);
  const rows = byToolId(registry);
  assert(rows.get("vanilla.get_context_remaining").implementationState === "projection_only", "get_context_remaining should be projection substrate");
  assert(rows.get("vanilla.update_plan").implementationState === "projection_only", "update_plan should be projection substrate");
  assert(rows.get("vanilla.view_image").implementationState === "projection_only", "view_image should be projection substrate");
  assert(rows.get("vanilla.request_user_input").implementationState === "projection_only", "request_user_input should be projection substrate");
  assert(rows.get("vanilla.request_permissions").implementationState === "projection_only", "request_permissions should be projection substrate");
  assert(rows.get("vanilla.new_context").promotionState === "unsupported", "new_context must remain unsupported");

  const toolCapabilityStatus = buildToolCapabilityStatusProjection({ registry });
  const settingsProjection = buildDirectSettingsSurfaceProjection({
    projectId,
    toolCapabilityStatus,
    controlToolStatus: status,
  });
  assert(settingsProjection.sections.controlTools.rowCount === 5, "settings surface should include control tool rows");
  assert(settingsProjection.sections.controlTools.newContextBlocked === true, "settings surface should show new_context blocked");
  assert(settingsProjection.sections.controlTools.freeTextCanWidenAuthority === false, "settings surface should block free-text authority");
  assert(settingsProjection.sections.controlTools.planMayAuthorizeAction === false, "settings surface should block plan authority");
  assert(settingsProjection.authority.controlToolLocalExecutionAllowed === false, "settings authority must block control tool execution");
  assert(settingsProjection.authority.controlToolProviderDeclarationAllowed === false, "settings authority must block control provider declaration");
  assertDirectSettingsSurfaceRendererSafe(settingsProjection);

  const rawSerialized = JSON.stringify({ contextWitness, plan, viewImage, userInput, permissionInput, newContext, status, settingsProjection });
  assert(!rawSerialized.includes("rawTextIncluded\":true"), "raw text flag must stay false");
  assert(!rawSerialized.includes("rawPathIncluded\":true"), "raw path flag must stay false");
  assert(!rawSerialized.includes("rawSecretIncluded\":true"), "raw secret flag must stay false");
  assert(!rawSerialized.includes("mayAuthorizeAction\":true"), "plan authority must stay false");

  console.log(JSON.stringify({
    ok: true,
    statusDigest: status.statusDigest,
    contextWitnessId: contextWitness.witnessId,
    settingsProjectionDigest: settingsProjection.projectionDigest,
  }, null, 2));
}

main();
