#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  DIRECT_CONTEXT_REMAINING_WITNESS_SCHEMA,
  DIRECT_CONTROL_TOOL_SUBSTRATE_STATUS_SCHEMA,
  DIRECT_HUMAN_DECISION_TOOL_PACKET_SCHEMA,
  DIRECT_NEW_CONTEXT_BLOCKED_PROJECTION_SCHEMA,
  DIRECT_VIEW_IMAGE_PROJECTION_SCHEMA,
  PERMISSION_WIDENING_REQUEST_SCHEMA,
  PLAN_PROJECTION_MUTATION_ENVELOPE_SCHEMA,
  PLAN_PROJECTION_STORE_SCHEMA,
  assertControlToolSubstrateSafe,
  buildContextRemainingWitness,
  buildControlToolSubstrateStatus,
  buildHumanDecisionToolPacket,
  buildNewContextBlockedProjection,
  buildPermissionWideningRequest,
  buildPlanArtifact,
  buildPlanProjectionStore,
  buildViewImageProjection,
  stableStringify,
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
  const serialized = stableStringify({
    keep: 1,
    fn: () => {},
    sym: Symbol("x"),
    undef: undefined,
    big: 1n,
    arr: [undefined, () => {}, "ok"],
  });
  assert(serialized === '{"arr":[null,null,"ok"],"keep":1}', "stableStringify should match JSON-compatible omission/null semantics");

  const contextWitness = buildContextRemainingWitness({
    projectId,
    threadId,
    tokensLeft: 12345,
    contextWindow: 20000,
    usedTokens: 7655,
    confidence: "derived",
    estimateKind: "budget_policy_estimate",
    usableFor: "context_maintenance_diagnostic",
    nowMs: 0,
  });
  assert(contextWitness.schema === DIRECT_CONTEXT_REMAINING_WITNESS_SCHEMA, "context witness schema mismatch");
  assert(contextWitness.tokensLeft === 12345, "context witness should preserve tokens left");
  assert(contextWitness.remainingTokens === 12345, "context witness should expose canonical remaining tokens");
  assert(contextWitness.pressurePercent === 38.28, "context witness should compute pressure percent");
  assert(contextWitness.freshness === "fresh", "context witness with evidence should be fresh by default");
  assert(contextWitness.usableFor !== "request_blocking", "context witness must not be request blocking");
  assert(contextWitness.permissionToContinue === false, "context witness must not grant permission to continue");
  assert(contextWitness.compactionAuthority === false, "context witness must not grant compaction authority");
  assert(contextWitness.providerTruth === false, "local estimate must not become provider truth");

  const unknownContextWitness = buildContextRemainingWitness({
    projectId,
    threadId,
    nowMs: 0,
  });
  assert(unknownContextWitness.tokensLeft === null, "missing usage evidence must keep context remaining unknown");
  assert(unknownContextWitness.remainingTokens === null, "missing usage evidence must keep canonical remaining unknown");
  assert(unknownContextWitness.freshness === "unknown", "missing usage evidence should have unknown freshness");
  assert(unknownContextWitness.confidence === "unknown", "missing usage evidence should not become derived confidence");
  assert(unknownContextWitness.source === "unavailable", "missing usage evidence should not claim a context source");

  const plan = buildPlanArtifact({
    projectId,
    workThreadId: "work_thread_control_tool_fixture",
    threadId,
    planId: "plan_control_tool_fixture",
    mutationKind: "replace_plan",
    sourceTurnId: "turn_1",
    steps: [{ text: "Track local plan state", status: "completed" }],
    nowMs: 0,
  });
  assert(plan.schema === PLAN_PROJECTION_MUTATION_ENVELOPE_SCHEMA, "plan schema mismatch");
  assert(plan.mutationKind === "replace_plan", "resident plan projection should accept scoped replacement");
  assert(plan.afterPlan.steps[0].status === "completed_in_plan", "completed must be normalized to completed_in_plan");
  assert(plan.humanInstructionWins === true, "human instruction should outrank model plan");
  assert(plan.mayAuthorizeAction === false, "plan must not authorize action");
  assert(plan.mayApproveTools === false, "plan must not approve tools");
  assert(plan.mayProveCompletion === false, "plan must not prove completion");
  assert(plan.mutatesWorkThreadTruth === false, "plan must not mutate WorkThread truth");
  assert(plan.mayEnterContextAs === "plan_evidence", "plan may only enter context as plan evidence");

  const stalePlan = buildPlanArtifact({
    projectId,
    workThreadId: "work_thread_control_tool_fixture",
    threadId,
    planId: "plan_control_tool_fixture",
    expectedBeforePlanDigest: "stale_digest",
    steps: [{ text: "Overwrite stale plan" }],
    nowMs: 0,
  });
  assert(stalePlan.schema === PLAN_PROJECTION_MUTATION_ENVELOPE_SCHEMA, "stale plan schema mismatch");
  assert(stalePlan.mutationKind === "blocked", "stale plan update should be blocked");
  assert(stalePlan.blockerCodes.includes("stale_plan_digest"), "stale plan blocker should be explicit");

  const planStore = buildPlanProjectionStore({
    projectId,
    workThreadId: "work_thread_control_tool_fixture",
    threadId,
    planId: "plan_control_tool_fixture",
    envelopes: [plan, { ...plan }, stalePlan],
    nowMs: 0,
  });
  assert(planStore.schema === PLAN_PROJECTION_STORE_SCHEMA, "plan store schema mismatch");
  assert(planStore.envelopeCount === 2, "plan store should dedupe update ids");
  assert(planStore.acceptedEnvelopeCount === 1, "plan store should count accepted envelopes");
  assert(planStore.blockedEnvelopeCount === 1, "plan store should count blocked envelopes");

  const appendedPlanStore = buildPlanProjectionStore({
    projectId,
    workThreadId: "work_thread_control_tool_fixture",
    threadId,
    planId: "plan_control_tool_fixture",
    envelopes: [plan],
    envelope: stalePlan,
    nowMs: 0,
  });
  assert(appendedPlanStore.envelopeCount === 2, "plan store should append single envelope to existing envelope array");
  assert(appendedPlanStore.blockedEnvelopeCount === 1, "appended blocked envelope should remain visible as evidence");

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
  assert(viewImage.residentPerceptionLevel === "renderer_preview_only", "renderer preview should be distinct from model vision");
  assert(viewImage.providerImagePayloadSupported === false, "image payload support must remain false");
  assert(viewImage.imagePayloadSent === false, "image payload must not be sent");
  assert(viewImage.modelSawPixels === false, "renderer preview must not imply model saw pixels");
  assert(viewImage.inlineSvgRendered === false, "SVG must not be rendered inline");
  assert(viewImage.rawImageBytesIncluded === false, "image projection must not expose raw bytes");
  assert(viewImage.rawPathIncluded === false, "image projection must not expose raw path");

  const userInput = buildHumanDecisionToolPacket({
    projectId,
    workThreadId: "work_thread_control_tool_fixture",
    threadId,
    toolKind: "request_user_input",
    promptPreview: "Choose one",
    choices: [{ choiceId: "yes", label: "Yes", carriesAuthority: true, authorityScope: "single_action" }],
    freeTextAllowed: true,
    nowMs: 0,
  });
  assert(userInput.schema === DIRECT_HUMAN_DECISION_TOOL_PACKET_SCHEMA, "human decision schema mismatch");
  assert(userInput.status === "pending", "human decision should default to pending");
  assert(userInput.pendingPolicy === "single_pending_per_turn", "human decision should default to single-pending per turn");
  assert(userInput.choices[0].carriesAuthority === false, "bounded choices must not carry authority in Wave 17");
  assert(userInput.choices[0].authorityScope === "none", "bounded choices must use no authority scope");
  assert(userInput.boundedChoiceMayCarryAuthority === false, "bounded choices must not carry authority");
  assert(userInput.freeTextPolicy === "context_only", "free text should be context only");
  assert(userInput.freeTextCanWidenAuthority === false, "free text must not widen authority");
  assert(userInput.mayApproveToolAction === false, "packet alone must not approve tool action");

  const permissionInput = buildPermissionWideningRequest({
    projectId,
    workThreadId: "work_thread_control_tool_fixture",
    threadId,
    turnId: "turn_control_tool_fixture",
    sourceCallId: "call_request_permissions",
    targetCapability: "exec_command",
    proposedCallId: "proposed_call_control_tool_fixture",
    scope: "single_action",
    reason: "Widen access once?",
    nowMs: 0,
  });
  assert(permissionInput.schema === PERMISSION_WIDENING_REQUEST_SCHEMA, "permission request schema mismatch");
  assert(permissionInput.status === "operator_confirmation_required", "single-action permission request should require operator confirmation");
  assert(permissionInput.requiresOperatorConfirmation === true, "permission request should require operator confirmation");
  assert(permissionInput.decisionRequiredBeforeGrant === true, "permission request should require separate decision");
  assert(permissionInput.authorityGranted === false, "permission request itself must not grant authority");
  assert(permissionInput.mayMutateWorkspace === false, "permission request itself must not mutate workspace");

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
    planStore,
    viewImage,
    humanDecision: userInput,
    requestPermissions: permissionInput,
    newContext,
    nowMs: 0,
  });
  assert(status.schema === DIRECT_CONTROL_TOOL_SUBSTRATE_STATUS_SCHEMA, "status schema mismatch");
  assert(status.rowCount === 6, "status should summarize six tool projections");
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
  assert(settingsProjection.sections.controlTools.rowCount === 6, "settings surface should include control tool rows");
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
