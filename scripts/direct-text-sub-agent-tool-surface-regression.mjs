#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  DIRECT_AGENT_INTERRUPT_REQUEST_SCHEMA,
  DIRECT_AGENT_MAILBOX_WRITE_PLAN_SCHEMA,
  DIRECT_AGENT_WAIT_PLAN_SCHEMA,
  DIRECT_SUB_AGENT_LIST_PROJECTION_SCHEMA,
  DIRECT_TEXT_SUB_AGENT_SPAWN_REQUEST_SCHEMA,
  DIRECT_TEXT_SUB_AGENT_TOOL_SURFACE_SCHEMA,
  assertTextOnlySubAgentToolSurfaceSafe,
  buildAgentInterruptRequest,
  buildAgentMailboxWritePlan,
  buildAgentWaitPlan,
  buildSubAgentListProjection,
  buildTextOnlySubAgentToolSurface,
  buildTextSubAgentSpawnRequest,
} = require("../src/main/direct/agents/text-tool-surface");
const {
  buildAgentLifecycleRegistry,
  buildAgentMailbox,
  buildAgentRuntimeRegistry,
  buildAgentThreadGraph,
} = require("../src/main/direct/agents/runtime-substrate");
const {
  buildAgentClassRegistry,
} = require("../src/main/direct/bridge/agent-class-spec");
const {
  buildDirectSettingsSurfaceProjection,
  assertDirectSettingsSurfaceRendererSafe,
} = require("../src/main/direct/ui/settings-surface");
const {
  buildToolCapabilityRegistry,
  buildToolCapabilityStatusProjection,
  validateToolCapabilityRegistry,
} = require("../src/main/direct/bridge/tool-capability-registry");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  const projectId = "project_text_sub_agent_surface_fixture";
  const primaryThreadId = "thread_primary_text_sub_agent_surface_fixture";
  const childAgentId = "agent_text_child_fixture";

  const graph = buildAgentThreadGraph({
    projectId,
    primaryThreadId,
    nodes: [
      {
        agentThreadId: childAgentId,
        parentAgentThreadId: primaryThreadId,
        displayLabel: "Text child fixture",
        agentClassKind: "sub_agent_worker",
        model: "gpt-5.5",
        reasoningEffort: "medium",
        nodeState: "running",
        contextPacketFamilyId: "text_only_child_context",
      },
    ],
    edges: [
      {
        edgeKind: "spawn_intent",
        parentAgentThreadId: primaryThreadId,
        childAgentThreadId: childAgentId,
      },
    ],
    nowMs: 0,
  });
  const mailbox = buildAgentMailbox({
    projectId,
    primaryThreadId,
    graphId: graph.graphId,
    messages: [
      {
        messageId: "msg_spawn_fixture",
        sequence: 1,
        messageKind: "spawn_intent",
        direction: "parent_to_child",
        parentAgentId: primaryThreadId,
        childAgentId,
        payloadRef: { kind: "spawn_prompt_ref", id: "spawn_prompt_fixture", digest: "sha256:spawn_prompt_fixture" },
      },
    ],
    nowMs: 0,
  });
  const lifecycleRegistry = buildAgentLifecycleRegistry({
    projectId,
    graphId: graph.graphId,
    entries: [
      { agentThreadId: childAgentId, lifecycleState: "running", lastEventAt: "1970-01-01T00:00:00.000Z" },
    ],
    nowMs: 0,
  });
  const runtimeRegistry = buildAgentRuntimeRegistry({
    projectId,
    primaryThreadId,
    nowMs: 0,
  });
  const agentClassRegistry = buildAgentClassRegistry({
    projectId,
    nowMs: 0,
  });

  const listProjection = buildSubAgentListProjection({
    projectId,
    primaryThreadId,
    graph,
    lifecycleRegistry,
  });
  assert(listProjection.schema === DIRECT_SUB_AGENT_LIST_PROJECTION_SCHEMA, "list projection schema mismatch");
  assert(listProjection.listAgentsEnabledInThisPr === true, "list_agents should be enabled in the text-only surface");
  assert(listProjection.rowCount === 1, "list projection should include one child");
  assert(listProjection.rows[0].model === "gpt-5.5", "list projection should preserve child model");
  assert(listProjection.rows[0].reasoningEffort === "medium", "list projection should preserve child reasoning effort");

  const spawnRequest = buildTextSubAgentSpawnRequest({
    projectId,
    primaryThreadId,
    graph,
    mailbox,
    runtimeRegistry,
    agentClassRegistry,
    childAgentId: "agent_text_child_next",
    requestedAgentClassKind: "sub_agent_worker",
    promptChars: 900,
    promptEvidenceId: "spawn_prompt_next",
    promptDigest: "sha256:spawn_prompt_next",
    nowMs: 0,
  });
  assert(spawnRequest.schema === DIRECT_TEXT_SUB_AGENT_SPAWN_REQUEST_SCHEMA, "spawn request schema mismatch");
  assert(spawnRequest.acceptedAsTextOnlyIntent === true, "spawn request should be accepted as bounded text-only intent");
  assert(spawnRequest.agentClassSpecValid === true, "spawn request should require and validate AgentClassSpec");
  assert(spawnRequest.childToolsAllowed === false, "spawn request must not allow child tools");
  assert(spawnRequest.childRecursiveSpawnAllowed === false, "spawn request must not allow recursive child spawn");
  assert(spawnRequest.inheritedParentAuthorityAllowed === false, "spawn request must not inherit parent authority");
  assert(spawnRequest.providerTransportAllowed === false, "spawn request must not transport provider call directly");
  assert(spawnRequest.usageAttribution === "agent_thread", "spawn request must preserve child usage attribution");

  const blockedSpawn = buildTextSubAgentSpawnRequest({
    projectId,
    primaryThreadId,
    graph,
    mailbox,
    runtimeRegistry,
    agentClassRegistry,
    requestedAgentClassKind: "unknown_worker_class",
    promptChars: 900,
    nowMs: 0,
  });
  assert(blockedSpawn.acceptedAsTextOnlyIntent === false, "unknown class should block spawn intent");
  assert(blockedSpawn.blockerCodes.includes("agent_class_spec_invalid_or_missing"), "blocked spawn should cite class-spec blocker");

  const waitPlan = buildAgentWaitPlan({
    projectId,
    primaryThreadId,
    graph,
    lifecycleRegistry,
    parentAgentId: primaryThreadId,
    targetAgentIds: [childAgentId],
    waitMode: "specific",
    timeoutMs: 15000,
    maxWaitDepth: 1,
    nowMs: 0,
  });
  assert(waitPlan.schema === DIRECT_AGENT_WAIT_PLAN_SCHEMA, "wait plan schema mismatch");
  assert(waitPlan.noDeadlockLawSatisfied === true, "wait plan should satisfy no-deadlock law");
  assert(waitPlan.cycleCheck === "passed", "wait cycle check should pass");
  assert(waitPlan.parentWorkflowMayBlockIndefinitely === false, "wait must not block parent indefinitely");

  const cycleWaitPlan = buildAgentWaitPlan({
    projectId,
    primaryThreadId,
    graph,
    parentAgentId: primaryThreadId,
    targetAgentIds: [primaryThreadId],
    timeoutMs: 15000,
    maxWaitDepth: 1,
    nowMs: 0,
  });
  assert(cycleWaitPlan.noDeadlockLawSatisfied === false, "wait cycle should fail no-deadlock law");
  assert(cycleWaitPlan.cycleCheck === "failed", "wait cycle should be detected");

  const sendPlan = buildAgentMailboxWritePlan({
    projectId,
    primaryThreadId,
    graph,
    mailbox,
    writeKind: "send_message",
    targetAgentId: childAgentId,
    payloadId: "send_payload_fixture",
    payloadDigest: "sha256:send_payload_fixture",
    nowMs: 0,
  });
  assert(sendPlan.schema === DIRECT_AGENT_MAILBOX_WRITE_PLAN_SCHEMA, "send plan schema mismatch");
  assert(sendPlan.canAppend === true, "send_message should append when target and mailbox law are valid");
  assert(sendPlan.sequence === 2, "send_message should reserve the next mailbox sequence");
  assert(sendPlan.idempotencyKey, "send_message should carry idempotency key");

  const missingTargetSend = buildAgentMailboxWritePlan({
    projectId,
    primaryThreadId,
    graph,
    mailbox,
    writeKind: "followup_task",
    targetAgentId: "missing_child",
    payloadId: "missing_followup",
    nowMs: 0,
  });
  assert(missingTargetSend.canAppend === false, "mailbox write should block missing target");

  const interruptRequest = buildAgentInterruptRequest({
    projectId,
    primaryThreadId,
    graph,
    targetAgentId: childAgentId,
    nowMs: 0,
  });
  assert(interruptRequest.schema === DIRECT_AGENT_INTERRUPT_REQUEST_SCHEMA, "interrupt request schema mismatch");
  assert(interruptRequest.markRequestedAllowed === true, "interrupt should allow mark-requested evidence for known target");
  assert(interruptRequest.providerCancelAllowed === false, "interrupt must not allow provider cancellation");
  assert(interruptRequest.processKillAllowed === false, "interrupt must not allow process kill");

  const surface = buildTextOnlySubAgentToolSurface({
    projectId,
    primaryThreadId,
    graph,
    mailbox,
    lifecycleRegistry,
    runtimeRegistry,
    agentClassRegistry,
    spawnRequest: {
      childAgentId: "agent_text_child_next",
      requestedAgentClassKind: "sub_agent_worker",
      promptChars: 900,
      promptEvidenceId: "spawn_prompt_next",
    },
    waitPlan: {
      parentAgentId: primaryThreadId,
      targetAgentIds: [childAgentId],
      waitMode: "specific",
      timeoutMs: 15000,
      maxWaitDepth: 1,
    },
    sendMessagePlan: {
      targetAgentId: childAgentId,
      payloadId: "send_payload_fixture",
    },
    followupTaskPlan: {
      targetAgentId: childAgentId,
      payloadId: "followup_payload_fixture",
    },
    interruptRequest: {
      targetAgentId: childAgentId,
    },
    nowMs: 0,
  });
  assert(surface.schema === DIRECT_TEXT_SUB_AGENT_TOOL_SURFACE_SCHEMA, "surface schema mismatch");
  assert(surface.listAgentsToolEnabledInThisPr === true, "surface should enable list_agents");
  assert(surface.spawnAgentTextOnlyEnabledInThisPr === true, "surface should enable text-only spawn intent");
  assert(surface.waitAgentToolEnabledInThisPr === true, "surface should enable bounded wait plan");
  assert(surface.sendMessageToolEnabledInThisPr === true, "surface should enable sequenced send plan");
  assert(surface.followupTaskToolEnabledInThisPr === true, "surface should enable sequenced followup plan");
  assert(surface.interruptAgentMarkRequestedEnabledInThisPr === true, "surface should enable mark-requested interrupt evidence");
  assert(surface.interruptAgentProviderCancelEnabledInThisPr === false, "surface must block provider interrupt");
  assert(surface.providerDeclarationAllowed === false, "surface must not declare provider tools");
  assert(surface.providerTransportAllowed === false, "surface must not call provider");
  assert(surface.requestShapeMutationAllowed === false, "surface must not mutate request shape");
  assert(surface.recursiveSpawnAllowed === false, "surface must not allow recursion");
  assert(surface.childToolsAllowed === false, "surface must not allow child tools");
  assert(surface.inheritedParentAuthorityAllowed === false, "surface must not inherit authority");
  assertTextOnlySubAgentToolSurfaceSafe(surface);

  const toolRegistry = buildToolCapabilityRegistry({
    projectId,
    nowMs: 0,
  });
  validateToolCapabilityRegistry(toolRegistry);
  const toolRows = new Map(toolRegistry.rows.map((row) => [row.toolId, row]));
  assert(toolRows.get("vanilla.agent.list_agents").promotionState === "direct_restricted", "list_agents capability should be direct restricted");
  assert(toolRows.get("vanilla.agent.spawn_agent").promotionState === "direct_restricted", "spawn_agent capability should be direct restricted");
  assert(toolRows.get("vanilla.agent.wait_agent").promotionState === "direct_restricted", "wait_agent capability should be direct restricted");
  assert(toolRows.get("vanilla.agent.send_message").promotionState === "direct_restricted", "send_message capability should be direct restricted");
  assert(toolRows.get("vanilla.agent.followup_task").promotionState === "direct_restricted", "followup_task capability should be direct restricted");
  assert(toolRows.get("vanilla.agent.interrupt_agent").promotionState === "diagnostic_only", "interrupt_agent capability should remain diagnostic");
  assert(toolRows.get("vanilla.agent.spawn_agent").providerDeclarationEnabledInThisPr === false, "agent tools must not enable provider declaration");

  const settingsProjection = buildDirectSettingsSurfaceProjection({
    projectId,
    agentToolSurfaceStatus: surface,
    toolCapabilityStatus: buildToolCapabilityStatusProjection({ registry: toolRegistry }),
  });
  assert(settingsProjection.sections.agentToolSurface.available === true, "settings should expose text-only sub-agent tool surface");
  assert(settingsProjection.sections.agentToolSurface.spawnAccepted === true, "settings should expose accepted spawn intent");
  assert(settingsProjection.sections.agentToolSurface.waitBounded === true, "settings should expose bounded wait");
  assert(settingsProjection.sections.agentToolSurface.providerTransportAllowed === false, "settings must show provider transport blocked");
  assert(Array.isArray(settingsProjection.rows.agentToolSurface) && settingsProjection.rows.agentToolSurface.length >= 6, "settings should render agent tool surface rows");
  assert(settingsProjection.authority.agentToolSurfaceProviderTransportAllowed === false, "settings authority must block provider transport");
  assertDirectSettingsSurfaceRendererSafe(settingsProjection);

  const serialized = JSON.stringify({ surface, settingsProjection });
  assert(!serialized.includes("\"rawPromptIncluded\":true"), "raw prompt must not be exposed");
  assert(!serialized.includes("\"rawTranscriptIncluded\":true"), "raw transcript must not be exposed");
  assert(!serialized.includes("\"rawProviderFrameIncluded\":true"), "raw provider frame must not be exposed");
  assert(!serialized.includes("\"rawSecretIncluded\":true"), "raw secret must not be exposed");

  console.log(JSON.stringify({
    ok: true,
    surfaceId: surface.surfaceId,
    surfaceDigest: surface.surfaceDigest,
    listRows: surface.listProjection.rowCount,
    waitPlanDigest: surface.waitPlan.waitPlanDigest,
    settingsProjectionDigest: settingsProjection.projectionDigest,
  }, null, 2));
}

main();
