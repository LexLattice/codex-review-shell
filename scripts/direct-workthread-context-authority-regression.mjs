#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildAuthorityBearingTransition,
  buildWorkThreadContextBinding,
} from "../src/main/direct/bridge/work-thread-alignment.js";
import {
  buildContextPack,
  buildRequestManifest,
  DIRECT_TEXT_TURN_RECENT_DIALOGUE_POLICY_ID,
  rendererSafeContextSummary,
} from "../src/main/direct/thread/context-pack.js";
import {
  buildWorkThread,
} from "../src/main/direct/bridge/work-thread-registry.js";
import {
  buildReadOnlyToolContinuationRequest,
  projectReadOnlyAuthorityDecision,
  projectReadResult,
} from "../src/main/direct/tools/read-only-authority.js";
import {
  buildPatchApplyContinuationRequest,
} from "../src/main/direct/tools/patch-apply-authority.js";
import {
  buildCommandExecutionContinuationRequest,
} from "../src/main/direct/tools/command-execution-authority.js";
import {
  DirectSessionStore,
} from "../src/main/direct/session/session-store.js";
import {
  DirectThreadStore,
} from "../src/main/direct/thread/thread-store.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function mockSessionStore(obligation) {
  return {
    findToolObligation() {
      return { turn: { turnId: obligation.turnId }, obligation };
    },
  };
}

function main() {
  const nowMs = new Date("2026-06-12T14:00:00.000Z").getTime();
  const workThread = buildWorkThread({
    workThreadId: "work_thread_direct_bridge",
    projectId: "codex-review-shell-direct",
    title: "Direct bridge context authority alignment",
    authorityBoundary: {
      mutationAllowedBeforeResolution: false,
      allowedActions: ["read_file_after_approval"],
      forbiddenActions: ["workspace_mutation_before_target_resolution"],
      summary: "WorkThread must be resolved before local mutation authority.",
    },
    openObligations: [
      { obligationId: "obl_align_context", kind: "implementation", status: "open", summary: "Cite WorkThread in context packs." },
    ],
    activeRuntimePath: "direct-implementation",
  }, { nowMs });
  const binding = buildWorkThreadContextBinding({
    workThread,
    bridgeInformationRefs: [
      { classId: "ic12.work-thread-registry", role: "governance_routing", artifactKind: "work_thread", artifactId: workThread.workThreadId },
      { classId: "ic3.context-pack-and-request-manifest", role: "context_construction" },
    ],
  });
  assert(binding.schema === "direct_work_thread_context_binding@1", "binding schema mismatch");
  assert(binding.workThreadId === workThread.workThreadId, "binding must cite WorkThread id");
  assert(binding.mutationAllowed === false, "binding must not grant mutation");
  assert(binding.providerCallAllowed === false, "binding must not grant provider calls");
  assert(binding.openObligationCount === 1, "binding should retain obligation refs");

  const contextPack = buildContextPack({
    projectId: workThread.projectId,
    threadId: "thread_context_authority",
    turnId: "turn_1",
    policyId: DIRECT_TEXT_TURN_RECENT_DIALOGUE_POLICY_ID,
    currentUserPrompt: "Continue the direct information bridge alignment.",
    workThreadBinding: binding,
    nowMs,
  });
  assert(contextPack.workThreadId === workThread.workThreadId, "context pack must cite WorkThread id");
  assert(contextPack.workThreadBinding.bindingDigest === binding.bindingDigest, "context pack must carry binding digest");
  assert(contextPack.sourceArtifacts.some((artifact) => artifact.artifactKind === "work_thread"), "context pack must cite WorkThread artifact");

  const { requestManifest, providerInput } = buildRequestManifest({
    contextPack,
    model: "gpt-5.3",
    requestShape: { requestShapeClass: "direct_text_turn_recent_dialogue@1" },
    nowMs,
  });
  assert(requestManifest.workThreadId === workThread.workThreadId, "request manifest must cite WorkThread id");
  assert(requestManifest.capabilityEvidence.workThreadBindingDigest === binding.bindingDigest, "request manifest must cite binding digest");
  assert(!providerInput.prompt.includes(workThread.workThreadId), "provider input should not receive WorkThread ids as prompt text");

  const summary = rendererSafeContextSummary(contextPack, requestManifest);
  assert(summary.workThreadBindingPresent === true, "renderer summary should witness binding presence");
  assert(summary.rawPathExposed === false, "renderer summary must remain raw-path safe");

  const fallbackTransition = buildAuthorityBearingTransition({
    transitionKind: "read_file",
    transitionPhase: "decision",
    threadId: "thread_context_authority",
    turnId: "turn_1",
    obligationId: "obl_read",
    workThread,
    bridgeInformationRefs: [
      { classId: "ic4.read-file-authority", role: "authority_decision", artifactKind: "readonly_tool_authority_decision", artifactId: "decision_fallback" },
    ],
    sourceArtifact: { classId: "ic4.read-file-authority", artifactKind: "readonly_tool_authority_decision", artifactId: "decision_fallback" },
  });
  assert(fallbackTransition.projectId === workThread.projectId, "fallback transition should derive normalized project id from WorkThread");
  assert(fallbackTransition.workThreadId === workThread.workThreadId, "fallback transition should derive WorkThread id from WorkThread");
  assert(
    fallbackTransition.workThreadBinding.bridgeInformationRefs.some((ref) => ref.classId === "ic4.read-file-authority"),
    "fallback transition binding must preserve bridge information refs",
  );

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "direct-workthread-context-authority-"));
  try {
    const sessionStore = new DirectSessionStore({ rootDir: path.join(tempRoot, "sessions") });
    const threadStore = new DirectThreadStore({ rootDir: path.join(tempRoot, "threads") });
    const session = sessionStore.createSession({
      sessionId: "thread_context_authority",
      projectId: workThread.projectId,
      title: "Direct bridge context authority alignment",
      model: "gpt-5.3",
    }, { nowMs });
    const turn = sessionStore.createTurn(session.sessionId, {
      turnId: "turn_store_context",
      input: [{ role: "user", text: "Continue the direct information bridge alignment." }],
      model: "gpt-5.3",
    }, { nowMs });
    threadStore.indexSessionArtifacts(sessionStore, sessionStore.readSession(session.sessionId), [
      sessionStore.readTurn(session.sessionId, turn.turnId),
    ], { nowMs });
    const persisted = threadStore.buildAndPersistContextForTextTurn({
      session,
      projectId: workThread.projectId,
      threadId: session.sessionId,
      turnId: turn.turnId,
      currentUserPrompt: "Continue the direct information bridge alignment.",
      useRecentDialogue: false,
      model: "gpt-5.3",
      requestShape: { requestShapeClass: "direct_text_turn_empty_context@1" },
      endpointClass: "chatgpt-codex-responses",
      endpointHash: "endpoint_hash_fixture",
      modelEvidenceRef: "model_evidence_fixture",
      requestShapeEvidenceRef: "direct_text_turn_empty_context@1",
      endpointEvidenceRef: "endpoint_fixture",
      workThreadBinding: binding,
    }, { nowMs });
    assert(persisted.contextPack.workThreadBinding.bindingDigest === binding.bindingDigest, "persisted text context pack must retain WorkThread binding");
    assert(persisted.requestManifest.capabilityEvidence.workThreadBindingDigest === binding.bindingDigest, "persisted request manifest must retain WorkThread binding digest");
    assert(persisted.rendererSafeSummary.workThreadBindingPresent === true, "persisted renderer summary must witness WorkThread binding");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  const readObligation = {
    projectId: workThread.projectId,
    sessionId: "thread_context_authority",
    turnId: "turn_1",
    obligationId: "obl_read",
    name: "read_file",
    status: "completed",
    completedAtSequence: 3,
    argumentsText: JSON.stringify({ path: "docs/DIRECT_INFORMATION_BRIDGE_CONSTITUTION.md" }),
    callId: "call_read",
    providerCallType: "function_call",
  };
  const readDecision = projectReadOnlyAuthorityDecision(readObligation, "declined", { workThreadBinding: binding, nowMs });
  assert(readDecision.authorityTransition.schema === "direct_authority_bearing_transition@1", "read decision transition missing");
  assert(readDecision.authorityTransition.workThreadId === workThread.workThreadId, "read decision must cite WorkThread");
  assert(readDecision.authorityTransition.mutationAllowedByTransition === false, "read decision must not authorize mutation");

  const readResult = projectReadResult({
    relPath: "docs/DIRECT_INFORMATION_BRIDGE_CONSTITUTION.md",
    text: "constitution",
    size: 12,
  }, readObligation, "2026-06-12T14:00:00.000Z", nowMs, { workThreadBinding: binding });
  assert(readResult.authorityTransition.transitionPhase === "result", "read result transition phase mismatch");
  assert(readResult.authorityTransition.sideEffectExecuted === false, "read result should not mark side effect executed");

  const readContinuation = buildReadOnlyToolContinuationRequest({
    sessionStore: mockSessionStore({ ...readObligation, status: "result_recorded", result: readResult, approvedAt: "2026-06-12T14:00:00.000Z" }),
    sessionId: readObligation.sessionId,
    turnId: readObligation.turnId,
    obligationId: readObligation.obligationId,
    workThreadBinding: binding,
    nowMs,
  });
  assert(readContinuation.authorityTransition.transitionPhase === "continuation", "read continuation transition missing");
  assert(readContinuation.authorityTransition.providerContinuationSent === false, "built continuation should not claim sent");

  const patchObligation = {
    projectId: workThread.projectId,
    sessionId: "thread_context_authority",
    turnId: "turn_1",
    obligationId: "obl_patch",
    name: "apply_patch",
    status: "patch_result_recorded",
    completedAtSequence: 4,
    argumentsText: JSON.stringify({ patch: "*** Begin Patch\n*** Add File: x.txt\n+hi\n*** End Patch\n" }),
    callId: "call_patch",
    providerCallType: "function_call",
    result: {
      schema: "direct_codex_patch_apply_result@1",
      resultId: "patch_result_1",
      status: "applied",
      providerOutputText: "{\"kind\":\"apply_patch_result\"}",
      workspaceEffectSummaryId: "effect_patch_1",
    },
  };
  const patchContinuation = buildPatchApplyContinuationRequest({
    sessionStore: mockSessionStore(patchObligation),
    sessionId: patchObligation.sessionId,
    turnId: patchObligation.turnId,
    obligationId: patchObligation.obligationId,
    workThreadBinding: binding,
    nowMs,
  });
  assert(patchContinuation.authorityTransition.transitionKind === "apply_patch", "patch transition kind mismatch");
  assert(patchContinuation.authorityTransition.sideEffectExecuted === true, "patch continuation should witness prior side effect");

  const commandObligation = {
    projectId: workThread.projectId,
    sessionId: "thread_context_authority",
    turnId: "turn_1",
    obligationId: "obl_command",
    name: "run_command",
    status: "command_result_recorded",
    completedAtSequence: 5,
    argumentsText: JSON.stringify({ command: "npm", args: ["test"], cwd: "" }),
    callId: "call_command",
    providerCallType: "function_call",
    result: {
      schema: "direct_codex_command_execution_result@1",
      resultId: "command_result_1",
      status: "completed_exit_zero",
      commandPlanId: "command_plan_1",
      providerOutputText: "{\"kind\":\"run_command_result\"}",
      workspaceEffectSummaryId: "effect_command_1",
    },
  };
  const commandContinuation = buildCommandExecutionContinuationRequest({
    sessionStore: mockSessionStore(commandObligation),
    sessionId: commandObligation.sessionId,
    turnId: commandObligation.turnId,
    obligationId: commandObligation.obligationId,
    workThreadBinding: binding,
    nowMs,
  });
  assert(commandContinuation.authorityTransition.transitionKind === "run_command", "command transition kind mismatch");
  assert(commandContinuation.authorityTransition.routingEnforced === false, "authority transition must remain non-routing");

  const standalone = buildAuthorityBearingTransition({
    transitionKind: "read_file",
    transitionPhase: "decision",
    projectId: workThread.projectId,
    threadId: "thread_context_authority",
    turnId: "turn_1",
    obligationId: "obl_read",
    workThreadBinding: binding,
    sourceArtifact: { classId: "ic4.read-file-authority", artifactKind: "readonly_tool_authority_decision", artifactId: "decision_1" },
  });
  assert(standalone.transitionDigest, "standalone transition must be digest-bearing");
  assert(standalone.providerCallAllowedByTransition === false, "transition must not authorize provider call");

  console.log(JSON.stringify({
    ok: true,
    workThreadId: workThread.workThreadId,
    contextBuildId: contextPack.contextBuildId,
    requestManifestId: requestManifest.requestManifestId,
    transitionSchemas: [
      readDecision.authorityTransition.schema,
      readResult.authorityTransition.schema,
      patchContinuation.authorityTransition.schema,
      commandContinuation.authorityTransition.schema,
    ],
  }, null, 2));
}

main();
