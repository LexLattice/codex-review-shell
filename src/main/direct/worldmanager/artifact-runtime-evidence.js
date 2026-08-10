"use strict";

const {
  digestFor,
  exactRef,
} = require("./artifact-lifecycle-kernel");
const {
  validateArtifactWorkThreadStartAuthorization,
} = require("../bridge/worker-start");

const ARTIFACT_RUNTIME_EVIDENCE_RECEIPT_SCHEMA =
  "direct_artifact_runtime_evidence_receipt@1";

function fail(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  if (detail) error.detail = detail;
  throw error;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value, fallback = "") {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : fallback;
}

function nowIso(now = Date.now) {
  const value = typeof now === "function" ? now() : now;
  return new Date(Number(value) || Date.now()).toISOString();
}

function exactRuntimeRef(kind, id, seed = {}, projectId = "") {
  return {
    kind,
    id,
    digest: digestFor(`direct_${kind}@1`, seed),
    ...(projectId ? { projectId } : {}),
  };
}

function parseableTimestamp(value) {
  return Number.isFinite(Date.parse(text(value, "")));
}

function runtimeResultEvidenceDigest(result = {}) {
  return digestFor("direct_artifact_runtime_tool_result_evidence@1", {
    schema: text(result.schema, ""),
    resultId: text(result.resultId, ""),
    obligationId: text(result.obligationId, ""),
    tool: text(result.tool, ""),
    status: text(result.status, ""),
    resultClass: text(result.resultClass, ""),
    patchPlanId: text(result.patchPlanId, ""),
    commandPlanId: text(result.commandPlanId, ""),
    displayCommand: text(result.displayCommand, ""),
    exitCode: Number.isFinite(Number(result.exitCode))
      ? Number(result.exitCode)
      : null,
    commandExecutionState: text(result.commandExecutionState, ""),
    appliedAt: text(result.appliedAt, ""),
    recordedAt: text(result.recordedAt, ""),
    sideEffectExecuted: result.sideEffectExecuted === true,
    authorityTransitionId: text(
      result.authorityTransition?.transitionId,
      "",
    ),
    authorityTransitionDigest: text(
      result.authorityTransition?.transitionDigest,
      "",
    ),
    workspaceEffectSummaryId: text(
      result.workspaceEffectSummaryId,
      "",
    ),
    workspaceEffectSummaryDigest: isPlainObject(result.workspaceEffectSummary)
      ? digestFor(
          "direct_artifact_runtime_workspace_effect_summary@1",
          result.workspaceEffectSummary,
        )
      : "",
    files: (Array.isArray(result.files) ? result.files : []).map((file) => ({
      path: text(file.path, ""),
      operation: text(file.operation, ""),
      beforeEvidenceKey: text(file.beforeEvidenceKey, ""),
      afterEvidenceKey: text(file.afterEvidenceKey, ""),
    })),
  });
}

function resultRef(result = {}, projectId = "") {
  if (!isPlainObject(result)) return null;
  const id = text(result.resultId, "");
  if (!id) return null;
  return exactRuntimeRef(
    "direct_tool_result",
    id,
    {
      schema: text(result.schema, "unknown"),
      id,
      tool: text(result.tool, ""),
      status: text(result.status, ""),
      resultClass: text(result.resultClass, ""),
      workspaceEffectSummaryId: text(
        result.workspaceEffectSummaryId,
        "",
      ),
      runtimeResultEvidenceDigest: runtimeResultEvidenceDigest(result),
    },
    projectId,
  );
}

function cleanEffectSummary(summary = {}, options = {}) {
  if (!isPlainObject(summary)) return false;
  if (
    summary.scan?.supported !== true ||
    summary.scan?.ran !== true ||
    summary.scan?.scanFailed === true ||
    text(summary.scan?.consistency, "stable") !== "stable" ||
    Number(summary.omittedChangeCount || 0) !== 0 ||
    Number(summary.unexpectedChangeCount || 0) !== 0 ||
    Number(summary.blockedChangeCount || 0) !== 0 ||
    Number(summary.sensitiveChangeCount || 0) !== 0 ||
    summary.changedPathsTruncated === true ||
    !["allow", "allowed"].includes(
      text(summary.policyEvaluation?.strictestDecision, "allow"),
    )
  ) {
    return false;
  }
  if (
    options.requireNoChanges === true &&
    Number(summary.changedPathCount || 0) !== 0
  ) {
    return false;
  }
  return true;
}

function validPatchResult(result = {}) {
  const files = Array.isArray(result.files) ? result.files : [];
  return (
    result.schema === "direct_codex_patch_apply_result@1" &&
    result.tool === "apply_patch" &&
    result.status === "applied" &&
    result.resultClass === "patch_applied" &&
    result.sideEffectExecuted === true &&
    result.authorityTransition?.transitionKind === "apply_patch" &&
    result.authorityTransition?.sideEffectExecuted === true &&
    text(result.authorityTransition?.transitionId, "") &&
    text(result.authorityTransition?.transitionDigest, "") &&
    parseableTimestamp(result.appliedAt) &&
    files.length > 0 &&
    files.every((file) => {
      const operation = text(file.operation, "update");
      return (
        text(file.path, "") &&
        (operation === "create" || text(file.beforeEvidenceKey, "")) &&
        (operation === "delete" || text(file.afterEvidenceKey, ""))
      );
    }) &&
    cleanEffectSummary(result.workspaceEffectSummary)
  );
}

function focusedVerificationCommand(result = {}) {
  const command = text(result.displayCommand, "").toLowerCase();
  return (
    /(^|\s|:)(test|tests|check|lint|typecheck|verify|verification|spec)(\s|:|$)/.test(
      command,
    ) ||
    /(^|\s)(pytest|py\.test|jest|vitest|mocha)(\s|$)/.test(command) ||
    /(^|\s)node\s+--test(\s|$)/.test(command)
  );
}

function validFocusedTestResult(result = {}) {
  const successfulResultKinds = new Set([
    "completed",
    "command_completed",
    "completed_exit_zero",
  ]);
  return (
    result.schema === "direct_codex_command_execution_result@1" &&
    result.tool === "run_command" &&
    successfulResultKinds.has(result.status) &&
    successfulResultKinds.has(result.resultClass) &&
    Number(result.exitCode) === 0 &&
    result.sideEffectExecuted === true &&
    result.providerContinuationBlocked !== true &&
    result.commandOutputRedaction?.providerOutputAllowed === true &&
    result.authorityTransition?.transitionKind === "run_command" &&
    result.authorityTransition?.sideEffectExecuted === true &&
    text(result.authorityTransition?.transitionId, "") &&
    text(result.authorityTransition?.transitionDigest, "") &&
    parseableTimestamp(result.recordedAt) &&
    focusedVerificationCommand(result) &&
    cleanEffectSummary(result.workspaceEffectSummary, {
      requireNoChanges: true,
    })
  );
}

function repositoryStateRef(observation = {}, projectId = "") {
  if (
    observation.schema !== "workspace_repository_semantic_observation@1" ||
    text(observation.projectId, "") !== projectId ||
    observation.gitAvailable !== true ||
    !text(observation.statusDigest, "") ||
    !text(observation.diffDigest, "") ||
    !text(observation.manifestDigest, "") ||
    observation.rawWorkspacePathIncluded !== false ||
    observation.rawSecretIncluded !== false ||
    !parseableTimestamp(observation.observedAt)
  ) {
    return null;
  }
  const state = {
    projectId,
    workspaceKind: text(observation.workspaceKind, ""),
    headOid: text(observation.headOid, ""),
    branch: text(observation.branch, ""),
    dirtyPathCount: Number(observation.dirtyPathCount || 0),
    statusDigest: observation.statusDigest,
    diffDigest: observation.diffDigest,
    untrackedStateDigest: text(observation.untrackedStateDigest, ""),
    manifestDigest: observation.manifestDigest,
    manifestTruncated: observation.manifestTruncated === true,
    observedAt: text(observation.observedAt, ""),
  };
  return exactRuntimeRef(
    "artifact_repository_state",
    `artifact_repository_state_${digestFor(
      "direct_artifact_repository_state_id@1",
      state,
    ).slice(7, 31)}`,
    state,
    projectId,
  );
}

function runtimeObservationDigest(input = {}) {
  const turn = input.turn || {};
  return digestFor("direct_artifact_runtime_observation@1", {
    sessionId: text(input.session?.sessionId, ""),
    turnId: text(turn.turnId, ""),
    turnState: text(turn.state, ""),
    toolResults: (Array.isArray(turn.toolResults) ? turn.toolResults : [])
      .filter(isPlainObject)
      .map((result) => ({
        schema: text(result.schema, ""),
        resultId: text(result.resultId, ""),
        tool: text(result.tool, ""),
        status: text(result.status, ""),
        resultClass: text(result.resultClass, ""),
        workspaceEffectSummaryId: text(
          result.workspaceEffectSummaryId,
          "",
        ),
      })),
    repositoryStateRef: input.repositoryStateRef,
  });
}

function buildArtifactRuntimeEvidenceReceipt(input = {}) {
  const authorization = input.authorization;
  validateArtifactWorkThreadStartAuthorization(authorization);
  if (authorization.assignmentKind !== "producer") {
    fail("artifact_runtime_evidence_producer_authorization_required");
  }
  const projectId = text(input.projectId, authorization.projectId);
  const lifecycleRef = exactRef(input.lifecycleRef, "lifecycleRef");
  const artifactRevisionRef = exactRef(
    input.artifactRevisionRef,
    "artifactRevisionRef",
  );
  const dispatchReceipt = input.dispatchReceipt || {};
  const session = input.runtimeObservation?.session || {};
  const turn = input.runtimeObservation?.turn || {};
  const blockerCodes = [];
  if (
    projectId !== authorization.projectId ||
    text(session.projectId, "") !== projectId ||
    text(session.sessionId, "") !== text(dispatchReceipt.workerSessionId, "") ||
    text(turn.sessionId, "") !== text(dispatchReceipt.workerSessionId, "") ||
    text(turn.turnId, "") !== text(dispatchReceipt.workerTurnId, "") ||
    text(session.artifactWorkThreadAuthorizationId, "") !==
      authorization.authorizationId ||
    text(session.artifactWorkThreadAuthorizationDigest, "") !==
      authorization.authorizationDigest
  ) {
    blockerCodes.push("artifact_runtime_worker_lineage_mismatch");
  }
  if (
    dispatchReceipt.accepted !== true ||
    dispatchReceipt.providerCallStarted !== true ||
    dispatchReceipt.authorizationRef?.id !== authorization.authorizationId ||
    dispatchReceipt.authorizationRef?.digest !==
      authorization.authorizationDigest
  ) {
    blockerCodes.push("artifact_runtime_dispatch_receipt_invalid");
  }
  const repositoryRef = repositoryStateRef(
    input.repositoryObservation || {},
    projectId,
  );
  if (!repositoryRef) {
    blockerCodes.push("artifact_runtime_repository_state_unavailable");
  }
  const results = Array.isArray(turn.toolResults) ? turn.toolResults : [];
  let patchIndex = -1;
  for (let index = 0; index < results.length; index += 1) {
    if (validPatchResult(results[index])) patchIndex = index;
  }
  const patchResult = patchIndex >= 0 ? results[patchIndex] : null;
  let testIndex = -1;
  for (let index = patchIndex + 1; index < results.length; index += 1) {
    if (validFocusedTestResult(results[index])) testIndex = index;
  }
  const testResult = testIndex >= 0 ? results[testIndex] : null;
  if (!patchResult) blockerCodes.push("artifact_runtime_patch_witness_missing");
  if (!testResult) blockerCodes.push("artifact_runtime_focused_test_witness_missing");
  const observedAt = Date.parse(text(input.repositoryObservation?.observedAt, ""));
  const lastEffectAt = Date.parse(text(
    testResult?.recordedAt || patchResult?.appliedAt,
    "",
  ));
  if (
    repositoryRef &&
    Number.isFinite(observedAt) &&
    Number.isFinite(lastEffectAt) &&
    observedAt < lastEffectAt
  ) {
    blockerCodes.push("artifact_runtime_repository_state_stale");
  }
  const observationDigest = runtimeObservationDigest({
    session,
    turn,
    repositoryStateRef: repositoryRef,
  });
  const authorizationRef = {
    kind: "artifact_workthread_start_authorization",
    id: authorization.authorizationId,
    digest: authorization.authorizationDigest,
    projectId,
  };
  const dispatchReceiptRef = {
    kind: "artifact_workthread_dispatch_receipt",
    id: text(dispatchReceipt.dispatchReceiptId, ""),
    digest: text(dispatchReceipt.receiptDigest, ""),
    projectId,
  };
  const patchRef = resultRef(patchResult, projectId);
  const testRef = resultRef(testResult, projectId);
  const sourceSupported = Boolean(
    patchRef &&
    repositoryRef &&
    !blockerCodes.includes("artifact_runtime_worker_lineage_mismatch") &&
    !blockerCodes.includes("artifact_runtime_dispatch_receipt_invalid") &&
    !blockerCodes.includes("artifact_runtime_repository_state_stale"),
  );
  const testSupported = Boolean(sourceSupported && testRef);
  const receiptId = `artifact_runtime_evidence_${digestFor(
    "direct_artifact_runtime_evidence_receipt_id@1",
    {
      authorizationRef,
      artifactRevisionRef,
      observationDigest,
    },
  ).slice(7, 31)}`;
  const receipt = {
    schema: ARTIFACT_RUNTIME_EVIDENCE_RECEIPT_SCHEMA,
    runtimeEvidenceReceiptId: receiptId,
    projectId,
    lifecycleRef,
    artifactRevisionRef,
    authorizationRef,
    dispatchReceiptRef,
    workerSessionRef: exactRuntimeRef(
      "direct_worker_session",
      text(session.sessionId, "unknown_session"),
      {
        projectId,
        authorizationRef,
      },
      projectId,
    ),
    workerTurnRef: exactRuntimeRef(
      "direct_worker_turn",
      text(turn.turnId, "unknown_turn"),
      {
        sessionId: text(session.sessionId, ""),
        observationDigest,
      },
      projectId,
    ),
    repositoryStateRef: repositoryRef,
    toolResultRefs: [patchRef, testRef].filter(Boolean),
    requirementDischarges: [
      {
        requirementId: "source_digest_current",
        state: sourceSupported ? "supported" : "blocked",
        evidenceRefs: [patchRef, repositoryRef].filter(Boolean),
        freshnessWitnessRef: sourceSupported
          ? exactRuntimeRef(
              "artifact_runtime_freshness_witness",
              `${receiptId}:source_digest_current`,
              {
                artifactRevisionRef,
                repositoryRef,
                observationDigest,
              },
              projectId,
            )
          : null,
      },
      {
        requirementId: "focused_test_exit",
        state: testSupported ? "supported" : "blocked",
        evidenceRefs: [testRef, repositoryRef].filter(Boolean),
        freshnessWitnessRef: testSupported
          ? exactRuntimeRef(
              "artifact_runtime_freshness_witness",
              `${receiptId}:focused_test_exit`,
              {
                artifactRevisionRef,
                testRef,
                repositoryRef,
                observationDigest,
              },
              projectId,
            )
          : null,
      },
    ],
    ingestionState:
      sourceSupported && testSupported ? "applied" : "blocked",
    blockerCodes: [...new Set(blockerCodes)],
    workspaceMutationObserved: Boolean(patchRef),
    workspaceMutationAuthorizedByLifecycle: false,
    separatelyAuthorizedToolEffectsObserved: Boolean(patchRef || testRef),
    mechanicallyAuthored: true,
    semanticTruthClaimed: false,
    canonicalEffect: false,
    grantsAuthority: false,
    rawProviderPayloadIncluded: false,
    rawWorkspacePathIncluded: false,
    recordedAt: nowIso(input.now),
  };
  receipt.receiptDigest = digestFor(
    ARTIFACT_RUNTIME_EVIDENCE_RECEIPT_SCHEMA,
    receipt,
  );
  validateArtifactRuntimeEvidenceReceipt(receipt);
  return receipt;
}

function validateArtifactRuntimeEvidenceReceipt(value = {}) {
  if (
    !isPlainObject(value) ||
    value.schema !== ARTIFACT_RUNTIME_EVIDENCE_RECEIPT_SCHEMA ||
    !text(value.runtimeEvidenceReceiptId, "") ||
    !text(value.projectId, "") ||
    !["applied", "blocked", "rejected"].includes(value.ingestionState) ||
    !Array.isArray(value.requirementDischarges) ||
    value.requirementDischarges.length !== 2 ||
    value.mechanicallyAuthored !== true ||
    value.semanticTruthClaimed !== false ||
    value.canonicalEffect !== false ||
    value.grantsAuthority !== false ||
    value.workspaceMutationAuthorizedByLifecycle !== false ||
    value.rawProviderPayloadIncluded !== false ||
    value.rawWorkspacePathIncluded !== false ||
    value.receiptDigest !== digestFor(
      ARTIFACT_RUNTIME_EVIDENCE_RECEIPT_SCHEMA,
      { ...value, receiptDigest: undefined },
    )
  ) {
    fail("artifact_runtime_evidence_receipt_invalid");
  }
  exactRef(value.lifecycleRef, "runtimeEvidence.lifecycleRef");
  exactRef(value.artifactRevisionRef, "runtimeEvidence.artifactRevisionRef");
  exactRef(value.authorizationRef, "runtimeEvidence.authorizationRef");
  exactRef(
    value.dispatchReceiptRef,
    "runtimeEvidence.dispatchReceiptRef",
  );
  exactRef(value.workerSessionRef, "runtimeEvidence.workerSessionRef");
  exactRef(value.workerTurnRef, "runtimeEvidence.workerTurnRef");
  if (value.repositoryStateRef) {
    exactRef(
      value.repositoryStateRef,
      "runtimeEvidence.repositoryStateRef",
    );
  }
  if (!Array.isArray(value.toolResultRefs)) {
    fail("artifact_runtime_evidence_tool_result_refs_invalid");
  }
  value.toolResultRefs.forEach((ref) =>
    exactRef(ref, "runtimeEvidence.toolResultRef"));
  const dischargeIds = value.requirementDischarges.map((entry) =>
    text(entry.requirementId, ""));
  for (const entry of value.requirementDischarges) {
    if (!Array.isArray(entry.evidenceRefs)) {
      fail("artifact_runtime_evidence_discharge_invalid");
    }
    entry.evidenceRefs.forEach((ref) =>
      exactRef(ref, "runtimeEvidence.dischargeEvidenceRef"));
    if (entry.freshnessWitnessRef) {
      exactRef(
        entry.freshnessWitnessRef,
        "runtimeEvidence.freshnessWitnessRef",
      );
    }
  }
  if (
    new Set(dischargeIds).size !== 2 ||
    !dischargeIds.includes("source_digest_current") ||
    !dischargeIds.includes("focused_test_exit") ||
    value.requirementDischarges.some((entry) =>
      !["source_digest_current", "focused_test_exit"].includes(
        text(entry.requirementId, ""),
      ) ||
      !["supported", "blocked"].includes(entry.state) ||
      (entry.state === "supported" &&
        (!entry.evidenceRefs.length ||
          !entry.freshnessWitnessRef)),
    )
  ) {
    fail("artifact_runtime_evidence_discharge_invalid");
  }
  return true;
}

function artifactRuntimeEvidenceReceiptRef(value) {
  validateArtifactRuntimeEvidenceReceipt(value);
  return {
    kind: "artifact_runtime_evidence_receipt",
    id: value.runtimeEvidenceReceiptId,
    digest: value.receiptDigest,
    projectId: value.projectId,
  };
}

module.exports = {
  ARTIFACT_RUNTIME_EVIDENCE_RECEIPT_SCHEMA,
  artifactRuntimeEvidenceReceiptRef,
  buildArtifactRuntimeEvidenceReceipt,
  validateArtifactRuntimeEvidenceReceipt,
};
