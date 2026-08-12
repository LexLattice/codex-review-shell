"use strict";

const { digestFor, text } = require("./kernel");
const {
  DirectTurnCaptureWriter,
  finalCaptureDigest,
  safeCapturedToolResult,
  terminalEvidence,
  terminalTurnState,
} = require("./turn-capture-writer");

function nativeChildSessionId(input = {}) {
  return `direct_child_session_${digestFor({
    projectId: text(input.projectId),
    primaryThreadId: text(input.primaryThreadId),
    childAgentId: text(input.agent?.agentThreadId || input.childAgentId),
  }).slice(0, 24)}`;
}

function nativeChildTurnId(input = {}) {
  return `direct_child_turn_${digestFor({
    childAgentId: text(input.agent?.agentThreadId || input.childAgentId),
    attemptId: text(input.attemptId || input.callId),
    promptDigest: text(input.promptDigest),
    contextDigest: text(input.contextDigest),
  }).slice(0, 24)}`;
}

function legacyNativeChildTurnId(input = {}, result = {}) {
  return `direct_child_turn_${digestFor({
    childAgentId: text(input.agent?.agentThreadId || input.childAgentId),
    attemptId: text(input.attemptId || input.callId),
    promptDigest: text(input.promptDigest),
    responseId: text(result.responseId),
  }).slice(0, 24)}`;
}

function sourceClassFor(input = {}, contract = null) {
  return text(input.sourceClass, contract
    ? "native_workspace_child_provider_turn"
    : "native_child_provider_turn");
}

function nativeCaptureInput(input = {}, contract = null, turnId = nativeChildTurnId(input)) {
  const sessionId = nativeChildSessionId(input);
  return {
    ...input,
    sessionId,
    turnId,
    sourceClass: sourceClassFor(input, contract),
  };
}

function ensureNativeChildSession(sessionStore, input = {}, contract = null) {
  const projectId = text(input.projectId, "project_direct_agents");
  const childAgentId = text(input.agent?.agentThreadId || input.childAgentId);
  if (!childAgentId) {
    const error = new Error("Native child capture requires a child agent identity.");
    error.code = "direct_epistemic_native_child_identity_required";
    throw error;
  }
  const sessionId = nativeChildSessionId(input);
  let session = sessionStore.readSession(sessionId);
  if (!session) {
    session = sessionStore.createSession({
      sessionId,
      projectId,
      title: text(input.agent?.displayLabel || input.displayLabel, `Native child ${childAgentId.slice(0, 12)}`),
      model: text(input.requestBody?.model || input.agent?.model || input.model),
      reasoningEffort: text(input.requestBody?.reasoning?.effort || input.agent?.reasoningEffort || input.reasoningEffort),
      agentId: childAgentId,
      agentKind: contract ? "native_workspace_sub_agent" : "native_sub_agent",
      agentThreadId: childAgentId,
      parentThreadId: text(input.primaryThreadId),
      primaryThreadId: text(input.primaryThreadId),
      agentLabel: text(input.agent?.displayLabel || input.displayLabel),
      agentRole: text(input.agent?.role || input.role, "sub_agent_worker"),
      workThreadId: text(input.workThreadId),
      workThreadBindingDigest: text(contract?.binding?.bindingDigest),
      sourceClass: sourceClassFor(input, contract),
      nativeDirectSession: true,
    });
  }
  return session;
}

function ensureNativeChildTurn(sessionStore, input = {}, contract = null, turnId = nativeChildTurnId(input)) {
  const session = ensureNativeChildSession(sessionStore, input, contract);
  let turn = sessionStore.readTurn(session.sessionId, turnId);
  if (!turn) {
    turn = sessionStore.createTurn(session.sessionId, {
      turnId,
      state: "streaming",
      model: text(input.requestBody?.model || input.agent?.model || input.model),
      reasoningEffort: text(input.requestBody?.reasoning?.effort || input.agent?.reasoningEffort || input.reasoningEffort),
      agentId: text(input.agent?.agentThreadId || input.childAgentId),
      agentKind: contract ? "native_workspace_sub_agent" : "native_sub_agent",
      agentThreadId: text(input.agent?.agentThreadId || input.childAgentId),
      parentThreadId: text(input.primaryThreadId),
      agentLabel: text(input.agent?.displayLabel || input.displayLabel),
      agentRole: text(input.agent?.role || input.role, "sub_agent_worker"),
      sourceClass: sourceClassFor(input, contract),
      nativeDirectSession: true,
      requestShape: {
        model: text(input.requestBody?.model || input.model),
        reasoningEffort: text(input.requestBody?.reasoning?.effort || input.reasoningEffort),
        promptDigest: text(input.promptDigest),
        contextDigest: text(input.contextDigest),
        contextMessageCount: Number(input.contextMessageCount || 0),
        attemptId: text(input.attemptId || input.callId),
        workspaceWorkerContractId: text(contract?.contractId),
        workspaceWorkerContractDigest: text(contract?.contractDigest),
        workspaceBindingId: text(contract?.binding?.bindingId),
        workspaceBindingDigest: text(contract?.binding?.bindingDigest),
        workspaceMode: text(contract?.workspaceMode),
        toolProfile: text(contract?.authority?.toolProfile),
        declaredTools: Array.isArray(contract?.authority?.declaredTools)
          ? [...contract.authority.declaredTools]
          : [],
        contextAdmissionDigest: text(contract?.contextAdmission?.admissionDigest),
        workspaceWorkerToolResultCount: Number(input.workspaceWorkerToolResultCount || 0),
        rawPromptIncluded: false,
        rawContextIncluded: false,
        rawWorkspacePathIncluded: false,
      },
    });
  }
  return turn;
}

function openNativeChildProviderTurnCaptureAtId(sessionStore, input = {}, contract = null, turnId = nativeChildTurnId(input)) {
  if (!sessionStore) {
    const error = new Error("Native child capture requires a Direct session store.");
    error.code = "direct_epistemic_native_child_session_store_required";
    throw error;
  }
  ensureNativeChildTurn(sessionStore, input, contract, turnId);
  return new DirectTurnCaptureWriter(sessionStore, nativeCaptureInput(input, contract, turnId));
}

function openNativeChildProviderTurnCapture(sessionStore, input = {}) {
  const contract = input.workspaceWorkerContract || input.contract || null;
  return openNativeChildProviderTurnCaptureAtId(
    sessionStore,
    input,
    contract,
    nativeChildTurnId(input),
  );
}

function captureDigest(input = {}, result = {}) {
  const contract = result.workspaceWorkerContract || input.workspaceWorkerContract || null;
  return finalCaptureDigest(nativeCaptureInput(input, contract), result);
}

function persistNativeChildProviderTurn(sessionStore, input = {}, result = {}) {
  if (!sessionStore) {
    const error = new Error("Native child capture requires a Direct session store.");
    error.code = "direct_epistemic_native_child_session_store_required";
    throw error;
  }
  const contract = result.workspaceWorkerContract || input.workspaceWorkerContract || null;
  const session = ensureNativeChildSession(sessionStore, input, contract);
  const currentTurnId = nativeChildTurnId(input);
  const legacyTurnId = legacyNativeChildTurnId(input, result);
  const legacyTurn = !sessionStore.readTurn(session.sessionId, currentTurnId) &&
    legacyTurnId !== currentTurnId &&
    text(result.responseId)
    ? sessionStore.readTurn(session.sessionId, legacyTurnId)
    : null;
  if (legacyTurn) {
    const normalizedToolResults = (Array.isArray(legacyTurn.toolResults) ? legacyTurn.toolResults : [])
      .map(safeCapturedToolResult);
    if (
      JSON.stringify(normalizedToolResults) !== JSON.stringify(legacyTurn.toolResults || []) ||
      legacyTurn.requestShape?.legacyResponseIdentityAdopted !== true ||
      legacyTurn.requestShape?.stableTurnIdentity !== currentTurnId
    ) {
      sessionStore.updateTurnState(session.sessionId, legacyTurn.turnId, legacyTurn.state, {
        toolResults: normalizedToolResults,
        requestShape: {
          ...(legacyTurn.requestShape || {}),
          legacyResponseIdentityAdopted: true,
          stableTurnIdentity: currentTurnId,
        },
      });
    }
  }
  const writerInput = {
    ...input,
    workspaceWorkerContract: contract,
    workspaceWorkerToolResultCount: Array.isArray(result.workspaceWorkerToolResults)
      ? result.workspaceWorkerToolResults.length
      : 0,
  };
  const writer = openNativeChildProviderTurnCaptureAtId(
    sessionStore,
    writerInput,
    contract,
    legacyTurn ? legacyTurnId : currentTurnId,
  );
  const receipt = writer.finalize(result, {
    duplicateConflictCode: "direct_epistemic_native_child_duplicate_conflict",
    prefixConflictCode: "direct_epistemic_native_child_partial_capture_conflict",
  });
  if (contract) {
    const capturedTurn = sessionStore.readTurn(receipt.sessionId, receipt.turnId);
    const workspaceWorkerToolResultCount = Array.isArray(capturedTurn?.toolResults)
      ? capturedTurn.toolResults.length
      : 0;
    if (capturedTurn?.requestShape?.workspaceWorkerToolResultCount !== workspaceWorkerToolResultCount) {
      sessionStore.updateTurnState(receipt.sessionId, receipt.turnId, capturedTurn.state, {
        requestShape: {
          ...capturedTurn.requestShape,
          workspaceWorkerToolResultCount,
        },
      });
    }
  }
  sessionStore.notifyEpistemicObservers?.({
    kind: "native_child_turn_persisted",
    sessionId: receipt.sessionId,
    turnId: receipt.turnId,
    eventCount: receipt.eventCount,
    captureComplete: receipt.captureComplete,
  });
  return {
    ...receipt,
    rawPromptPersisted: false,
    rawContextPersisted: false,
  };
}

module.exports = {
  DirectTurnCaptureWriter,
  captureDigest,
  capturedWorkspaceToolResult: safeCapturedToolResult,
  legacyNativeChildTurnId,
  nativeChildSessionId,
  nativeChildTurnId,
  openNativeChildProviderTurnCapture,
  persistNativeChildProviderTurn,
  terminalEvidence,
  terminalTurnState,
};
