"use strict";

const {
  digestFor,
  stableId,
} = require("./aro-kernel");
const {
  mutationContractRef,
  validateAroMutationContract,
} = require("./aro-mutation-contract");
const {
  realizationContextImportRef,
  validateAroRealizationContextImport,
} = require("./aro-realization-mapping");
const {
  validateAroWorkerConstitution,
  validateAroWorkerHandoffRun,
  workerConstitutionRef,
} = require("./aro-worker-handoff");

const ARO_EXECUTION_EVIDENCE_BUNDLE_SCHEMA =
  "direct_aro_execution_evidence_bundle@1";
const ARO_EXECUTION_EVIDENCE_RUN_SCHEMA =
  "direct_aro_execution_evidence_acquisition_run@1";
const ARO_WORKER_TURN_WITNESS_SCHEMA =
  "direct_aro_worker_turn_witness@1";
const ARO_TOOL_RESULT_WITNESS_SCHEMA =
  "direct_aro_tool_result_witness@1";
const ARO_WORKSPACE_EFFECT_WITNESS_SCHEMA =
  "direct_aro_workspace_effect_witness@1";
const ARO_REPOSITORY_AFTER_STATE_WITNESS_SCHEMA =
  "direct_aro_repository_after_state_witness@1";
const ARO_VERIFICATION_COVERAGE_WITNESS_SCHEMA =
  "direct_aro_verification_coverage_witness@1";

const EVIDENCE_RUN_STATES = new Set([
  "scheduled",
  "running",
  "observing",
  "acquired",
  "failed",
]);
const TERMINAL_EVIDENCE_RUN_STATES = new Set([
  "observing",
  "acquired",
  "failed",
]);
const ACTIVE_TURN_STATES = new Set([
  "created",
  "request_built",
  "streaming",
  "tool_waiting",
  "authority_waiting",
  "continuation_ready",
  "continuation_sent",
  "streaming_continuation",
]);
const TERMINAL_TURN_STATES = new Set([
  "completed",
  "failed",
  "aborted",
  "tool_call_blocked_text_only",
  "transport_handoff_unknown",
  "response_incomplete",
  "content_filter_terminal",
  "max_output_terminal",
  "empty_output_terminal",
]);

function fail(code, detail = "") {
  const error = new Error(
    detail ? `${code}:${detail}` : code,
  );
  error.code = code;
  if (detail) error.detail = detail;
  throw error;
}

function isPlainObject(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value),
  );
}

function text(value, fallback = "") {
  return typeof value === "string" &&
    value.trim()
    ? value.trim()
    : fallback;
}

function bounded(
  value,
  fallback = "",
  max = 1_600,
) {
  const source = text(value, fallback);
  return source.length > max
    ? `${source.slice(0, max - 1).trimEnd()}…`
    : source;
}

function nowIso(now = Date.now) {
  const value =
    typeof now === "function"
      ? now()
      : now;
  return new Date(
    Number(value) || Date.now(),
  ).toISOString();
}

function exactRef(
  value = {},
  label = "ref",
) {
  const ref = {
    kind: text(value.kind, ""),
    id: text(value.id, ""),
    digest: text(value.digest, ""),
  };
  if (!ref.kind || !ref.id || !ref.digest) {
    fail(
      "world_manager_aro_execution_evidence_ref_invalid",
      label,
    );
  }
  const projectId = text(
    value.projectId,
    "",
  );
  if (projectId) ref.projectId = projectId;
  return ref;
}

function exactRefMatches(left, right) {
  return Boolean(
    left &&
    right &&
    left.kind === right.kind &&
    left.id === right.id &&
    left.digest === right.digest,
  );
}

function uniqueStrings(values = []) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => text(value, ""))
        .filter(Boolean),
    ),
  ];
}

function artifact(
  schema,
  idField,
  id,
  body,
) {
  const value = {
    schema,
    [idField]: id,
    ...body,
    grantsAuthority: false,
  };
  value.digest = digestFor(
    schema,
    value,
    ["digest"],
  );
  return value;
}

function artifactRef(
  kind,
  value,
  idField,
  projectId = "",
) {
  return exactRef({
    kind,
    id: value[idField],
    digest: value.digest,
    ...(projectId ? { projectId } : {}),
  });
}

function validateArtifact(
  value,
  schema,
  idField,
) {
  if (
    !isPlainObject(value) ||
    value.schema !== schema ||
    !text(value[idField], "") ||
    value.grantsAuthority !== false ||
    value.digest !==
      digestFor(
        schema,
        value,
        ["digest"],
      )
  ) {
    fail(
      "world_manager_aro_execution_evidence_artifact_invalid",
      schema,
    );
  }
  return true;
}

function safeNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number)
    ? Math.max(0, number)
    : 0;
}

function normalizedKind(value) {
  return text(value, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function toolEvidenceKinds(result = {}) {
  const tool = text(
    result.tool,
    "tool",
  );
  const kinds = [
    "tool_result",
    "tool_approval_witness",
    `${tool}_result`,
  ];
  if (tool === "read_file") {
    kinds.push(
      "read_result",
      "source_read",
    );
  }
  if (tool === "apply_patch") {
    kinds.push(
      "patch_result",
      "implementation_change",
      "workspace_effect",
    );
  }
  if (tool === "run_command") {
    kinds.push(
      "command_result",
      "verification_command",
    );
    const command =
      `${result.displayCommand || ""} ${result.commandPlan?.packageScriptEvidence?.scriptName || ""}`
        .toLowerCase();
    if (
      /\b(test|check|lint|typecheck|verify|spec)\b/.test(
        command,
      )
    ) {
      kinds.push(
        "test_result",
        "runtime_verification",
      );
    }
  }
  return uniqueStrings(kinds);
}

function buildWorkerTurnWitness(
  handoffRun,
  observation,
  now,
) {
  const session =
    isPlainObject(observation.session)
      ? observation.session
      : {};
  const turn =
    isPlainObject(observation.turn)
      ? observation.turn
      : {};
  const sessionId = text(
    session.sessionId,
    "",
  );
  const turnId = text(
    turn.turnId,
    "",
  );
  if (
    sessionId !==
      handoffRun.workerSessionRef.id ||
    turnId !==
      handoffRun.workerTurnRef.id ||
    text(session.projectId, "") !==
      handoffRun.projectId
  ) {
    fail(
      "world_manager_aro_execution_worker_turn_binding_invalid",
      `${sessionId}:${turnId}`,
    );
  }
  const state = text(
    turn.state,
    "unknown",
  );
  const toolResults =
    Array.isArray(turn.toolResults)
      ? turn.toolResults
      : [];
  const unresolved =
    Array.isArray(
      turn.unresolvedObligations,
    )
      ? turn.unresolvedObligations
      : [];
  const resultObligations =
    new Set(
      toolResults
        .map((result) =>
          text(
            result.obligationId,
            "",
          ))
        .filter(Boolean),
    );
  const finalOutput =
    text(
      observation.finalAssistantText,
      "",
    );
  return artifact(
    ARO_WORKER_TURN_WITNESS_SCHEMA,
    "workerTurnWitnessId",
    stableId(
      "wm_aro_worker_turn_witness",
      {
        handoffRunRef: {
          id: handoffRun.runId,
          digest: handoffRun.digest,
        },
        state,
        updatedAt:
          text(turn.updatedAt, ""),
        toolResultDigests:
          toolResults.map((result) =>
            digestFor(
              "direct_aro_observed_tool_result@1",
              result,
            )),
        finalOutputDigest:
          finalOutput
            ? digestFor(
                "direct_aro_worker_final_output@1",
                finalOutput,
              )
            : "",
      },
    ),
    {
      projectId:
        handoffRun.projectId,
      handoffRunRef: {
        kind:
          "aro_worker_handoff_run",
        id: handoffRun.runId,
        digest: handoffRun.digest,
        projectId:
          handoffRun.projectId,
      },
      workerSessionRef:
        handoffRun.workerSessionRef,
      workerTurnRef:
        handoffRun.workerTurnRef,
      turnState: state,
      terminal:
        TERMINAL_TURN_STATES.has(
          state,
        ),
      active:
        ACTIVE_TURN_STATES.has(
          state,
        ),
      unresolvedObligationCount:
        unresolved.filter(
          (obligation) =>
            !resultObligations.has(
              text(
                obligation.obligationId,
                "",
              ),
            ) &&
            ![
              "declined",
              "canceled",
              "unsupported",
              "failed",
            ].includes(
              text(
                obligation.status,
                "",
              ),
            ),
        ).length,
      toolResultCount:
        toolResults.length,
      continuationRequestCount:
        Array.isArray(
          turn.continuationRequests,
        )
          ? turn.continuationRequests
              .length
          : 0,
      finalOutputPresent:
        Boolean(finalOutput),
      finalOutputDigest:
        finalOutput
          ? digestFor(
              "direct_aro_worker_final_output@1",
              finalOutput,
            )
          : "",
      finalOutputPreview:
        bounded(
          finalOutput,
          "",
          1_200,
        ),
      errorCode: text(
        turn.error?.code,
        "",
      ),
      turnCreatedAt: text(
        turn.createdAt,
        "",
      ),
      turnUpdatedAt: text(
        turn.updatedAt,
        "",
      ),
      observedAt: nowIso(now),
      rawTurnIncluded: false,
      rawProviderPayloadIncluded:
        false,
      rawChainOfThoughtIncluded:
        false,
    },
  );
}

function buildToolResultWitnesses(
  handoffRun,
  observation,
  now,
) {
  const turn =
    isPlainObject(observation.turn)
      ? observation.turn
      : {};
  return (
    Array.isArray(turn.toolResults)
      ? turn.toolResults
      : []
  ).map((result, index) => {
    const resultId = text(
      result.resultId,
      `result_${index + 1}`,
    );
    const sourceDigest =
      digestFor(
        "direct_aro_observed_tool_result@1",
        result,
      );
    const tool = text(
      result.tool,
      "tool",
    );
    const files =
      Array.isArray(result.files)
        ? result.files.slice(0, 40)
            .map((file) => ({
              relativePath: bounded(
                file.path ||
                  file.relativePath,
                "",
                600,
              ),
              operation: text(
                file.operation,
                "update",
              ),
              beforeEvidenceKey:
                text(
                  file
                    .beforeEvidenceKey,
                  "",
                ),
              afterEvidenceKey:
                text(
                  file
                    .afterEvidenceKey,
                  "",
                ),
              addedLineCount:
                safeNumber(
                  file.addedLineCount,
                ),
              removedLineCount:
                safeNumber(
                  file.removedLineCount,
                ),
            }))
        : [];
    const outputAllowed =
      result
        .commandOutputRedaction
        ?.providerOutputAllowed !==
        false;
    return artifact(
      ARO_TOOL_RESULT_WITNESS_SCHEMA,
      "toolResultWitnessId",
      stableId(
        "wm_aro_tool_result_witness",
        {
          handoffRunId:
            handoffRun.runId,
          resultId,
          sourceDigest,
        },
      ),
      {
        projectId:
          handoffRun.projectId,
        handoffRunRef: {
          kind:
            "aro_worker_handoff_run",
          id: handoffRun.runId,
          digest:
            handoffRun.digest,
          projectId:
            handoffRun.projectId,
        },
        workerTurnRef:
          handoffRun.workerTurnRef,
        sourceResultRef: {
          kind:
            "direct_tool_result",
          id: resultId,
          digest: sourceDigest,
          projectId:
            handoffRun.projectId,
        },
        obligationId: text(
          result.obligationId,
          "",
        ),
        tool,
        status: text(
          result.status,
          "unknown",
        ),
        resultClass: text(
          result.resultClass,
          "",
        ),
        sideEffectExecuted:
          result.sideEffectExecuted ===
          true,
        approvalWitnessPresent:
          Boolean(
            result.authorityTransition,
          ),
        relativePath: bounded(
          result.relPath ||
            result.relativePath,
          "",
          600,
        ),
        files,
        command:
          tool === "run_command"
            ? {
                displayCommand:
                  bounded(
                    result
                      .displayCommand,
                    "",
                    1_000,
                  ),
                cwdRelPath:
                  bounded(
                    result.cwdRelPath,
                    ".",
                    600,
                  ),
                exitCode:
                  Number.isFinite(
                    Number(
                      result.exitCode,
                    ),
                  )
                    ? Number(
                        result.exitCode,
                      )
                    : null,
                durationMs:
                  safeNumber(
                    result.durationMs,
                  ),
                stdoutPreview:
                  outputAllowed
                    ? bounded(
                        result.stdout
                          ?.textPreview,
                        "",
                        1_200,
                      )
                    : "",
                stderrPreview:
                  outputAllowed
                    ? bounded(
                        result.stderr
                          ?.textPreview,
                        "",
                        1_200,
                      )
                    : "",
                stdoutTruncated:
                  result.stdout
                    ?.truncated === true,
                stderrTruncated:
                  result.stderr
                    ?.truncated === true,
                outputRedacted:
                  !outputAllowed,
              }
            : null,
        evidenceKinds:
          toolEvidenceKinds(result),
        workspaceEffectSummaryId:
          text(
            result
              .workspaceEffectSummaryId ||
              result
                .workspaceEffectSummary
                ?.effectSummaryId,
            "",
          ),
        postSideEffectPolicyViolation:
          text(
            result
              .postSideEffectPolicyViolation,
            "",
          ),
        recordedAt: text(
          result.recordedAt ||
            result.appliedAt ||
            result.completedAt,
          nowIso(now),
        ),
        rawToolResultIncluded:
          false,
        rawProviderPayloadIncluded:
          false,
        rawWorkspacePathIncluded:
          false,
      },
    );
  });
}

function buildWorkspaceEffectWitnesses(
  handoffRun,
  observation,
  toolResultWitnesses,
  now,
) {
  const turn =
    isPlainObject(observation.turn)
      ? observation.turn
      : {};
  const results =
    Array.isArray(turn.toolResults)
      ? turn.toolResults
      : [];
  return results.flatMap(
    (result, index) => {
      const summary =
        isPlainObject(
          result.workspaceEffectSummary,
        )
          ? result
              .workspaceEffectSummary
          : null;
      if (!summary) return [];
      const toolWitness =
        toolResultWitnesses[index];
      const changedPathCount =
        safeNumber(
          summary.changedPathCount ??
            result.workspaceEffects
              ?.changedPathCount,
        );
      const omittedPathCount =
        safeNumber(
          summary.omittedPathCount,
        );
      const blockedPathCount =
        safeNumber(
          summary.blockedPathCount,
        );
      const sensitivePathCount =
        safeNumber(
          summary.sensitivePathCount,
        );
      const changedPathsTruncated =
        summary.changedPathsTruncated ===
          true ||
        result.workspaceEffects
          ?.changedPathsTruncated ===
          true;
      const sourceDigest =
        digestFor(
          "direct_aro_observed_workspace_effect@1",
          summary,
        );
      return [
        artifact(
          ARO_WORKSPACE_EFFECT_WITNESS_SCHEMA,
          "workspaceEffectWitnessId",
          stableId(
            "wm_aro_workspace_effect_witness",
            {
              handoffRunId:
                handoffRun.runId,
              sourceDigest,
              toolResultWitnessId:
                toolWitness
                  .toolResultWitnessId,
            },
          ),
          {
            projectId:
              handoffRun.projectId,
            handoffRunRef: {
              kind:
                "aro_worker_handoff_run",
              id:
                handoffRun.runId,
              digest:
                handoffRun.digest,
              projectId:
                handoffRun.projectId,
            },
            workerTurnRef:
              handoffRun.workerTurnRef,
            toolResultWitnessRef:
              artifactRef(
                "aro_tool_result_witness",
                toolWitness,
                "toolResultWitnessId",
                handoffRun.projectId,
              ),
            sourceEffectSummaryRef: {
              kind:
                "direct_workspace_effect_summary",
              id:
                text(
                  summary.effectSummaryId ||
                    result
                      .workspaceEffectSummaryId,
                  stableId(
                    "direct_workspace_effect_summary",
                    {
                      sourceDigest,
                    },
                  ),
                ),
              digest: sourceDigest,
              projectId:
                handoffRun.projectId,
            },
            tool: toolWitness.tool,
            changedPathCount,
            knownPathCount:
              safeNumber(
                summary.knownPathCount ??
                  changedPathCount,
              ),
            omittedPathCount,
            unexpectedPathCount:
              safeNumber(
                summary
                  .unexpectedPathCount,
              ),
            blockedPathCount,
            sensitivePathCount,
            changedPathsPreview:
              uniqueStrings(
                summary
                  .changedPathsPreview ||
                result
                  .workspaceEffects
                  ?.changedPathsPreview,
              )
                .slice(0, 40)
                .map((entry) =>
                  bounded(
                    entry,
                    "",
                    600,
                  )),
            changedPathsTruncated,
            scan: {
              ran:
                summary.scan?.ran ===
                true,
              supported:
                summary.scan
                  ?.supported === true,
              failed:
                summary.scan
                  ?.scanFailed ===
                  true,
              scope: text(
                summary.scan
                  ?.scanScope ||
                  result
                    .workspaceEffects
                    ?.scanScope,
                "unknown",
              ),
            },
            policyDecision: text(
              summary
                .policyEvaluation
                ?.strictestDecision,
              "not_reported",
            ),
            providerVisibility:
              text(
                summary
                  .providerVisibility
                  ?.providerVisibilityCompleteness,
                "not_reported",
              ),
            localEffectExecuted:
              result.sideEffectExecuted ===
              true,
            workspaceMutationObserved:
              changedPathCount > 0,
            evidenceAmbiguous:
              omittedPathCount > 0 ||
              blockedPathCount > 0 ||
              sensitivePathCount > 0 ||
              changedPathsTruncated ||
              summary.scan
                ?.scanFailed === true,
            observedAt: nowIso(now),
            workspaceMutationAuthorizedBySc8_4:
              false,
            remoteMutationObserved:
              false,
            canonicalAdmissionObserved:
              false,
            rawEffectSummaryIncluded:
              false,
            rawWorkspacePathIncluded:
              false,
          },
        ),
      ];
    },
  );
}

function sourceDigestForEvidence(
  evidence = {},
) {
  return text(
    evidence.sourceRef?.digest ||
      evidence.digest ||
      evidence.sourceDigest,
    "",
  );
}

function pathForEvidence(evidence = {}) {
  return text(
    evidence.relativePath ||
      evidence.path,
    "",
  );
}

function repositoryIdentity(
  value = {},
) {
  return {
    headOid: text(
      value.headOid,
      "",
    ),
    branch: bounded(
      value.branch,
      "",
      240,
    ),
    statusDigest: text(
      value.statusDigest,
      "",
    ),
    diffDigest: text(
      value.diffDigest,
      "",
    ),
  };
}

function buildRepositoryAfterStateWitness(
  handoffRun,
  contextImport,
  observation,
  workspaceEffectWitnesses,
  now,
) {
  const beforeByPath =
    new Map(
      contextImport.evidence.map(
        (entry) => [
          pathForEvidence(entry),
          sourceDigestForEvidence(entry),
        ],
      ),
    );
  const afterEvidence =
    Array.isArray(observation.evidence)
      ? observation.evidence
      : [];
  const afterByPath =
    new Map(
      afterEvidence.map((entry) => [
        pathForEvidence(entry),
        sourceDigestForEvidence(entry),
      ]),
    );
  const pathComparisons = [
    ...beforeByPath.entries(),
  ].map(([relativePath, beforeDigest]) => {
    const afterDigest =
      afterByPath.get(relativePath) ||
      "";
    return {
      relativePath,
      beforeDigest,
      afterDigest,
      state:
        !afterDigest
          ? "missing_after"
          : beforeDigest ===
              afterDigest
            ? "unchanged"
            : "changed",
    };
  });
  const before =
    repositoryIdentity(
      contextImport
        .repositoryIdentity,
    );
  const after =
    repositoryIdentity(
      observation
        .repositoryIdentity,
    );
  const repositoryChanged =
    Boolean(
      before.headOid &&
      after.headOid &&
      before.headOid !==
        after.headOid,
    ) ||
    Boolean(
      before.statusDigest &&
      after.statusDigest &&
      before.statusDigest !==
        after.statusDigest,
    ) ||
    Boolean(
      before.diffDigest &&
      after.diffDigest &&
      before.diffDigest !==
        after.diffDigest,
    ) ||
    pathComparisons.some(
      (entry) =>
        entry.state !==
        "unchanged",
    );
  const workspaceMutationObserved =
    workspaceEffectWitnesses.some(
      (entry) =>
        entry
          .workspaceMutationObserved,
    );
  const rejectedPaths =
    Array.isArray(
      observation.rejectedPaths,
    )
      ? observation.rejectedPaths
      : [];
  const omittedPaths =
    Array.isArray(
      observation.omittedPaths,
    )
      ? observation.omittedPaths
      : [];
  return artifact(
    ARO_REPOSITORY_AFTER_STATE_WITNESS_SCHEMA,
    "repositoryAfterStateWitnessId",
    stableId(
      "wm_aro_repository_after_state_witness",
      {
        handoffRunId:
          handoffRun.runId,
        before,
        after,
        pathComparisons,
        rejectedPaths:
          rejectedPaths.map((entry) =>
            pathForEvidence(entry)),
        omittedPaths:
          omittedPaths.map((entry) =>
            pathForEvidence(entry)),
      },
    ),
    {
      projectId:
        handoffRun.projectId,
      handoffRunRef: {
        kind:
          "aro_worker_handoff_run",
        id: handoffRun.runId,
        digest: handoffRun.digest,
        projectId:
          handoffRun.projectId,
      },
      contextImportRef:
        realizationContextImportRef(
          contextImport,
        ),
      beforeRepositoryIdentity:
        before,
      afterRepositoryIdentity:
        after,
      pathComparisons,
      changedSelectedPathCount:
        pathComparisons.filter(
          (entry) =>
            entry.state ===
            "changed",
        ).length,
      unchangedSelectedPathCount:
        pathComparisons.filter(
          (entry) =>
            entry.state ===
            "unchanged",
        ).length,
      missingSelectedPathCount:
        pathComparisons.filter(
          (entry) =>
            entry.state ===
            "missing_after",
        ).length,
      rejectedPathCount:
        rejectedPaths.length,
      omittedPathCount:
        omittedPaths.length,
      repositoryChanged,
      workspaceMutationObserved,
      unattributedRepositoryDrift:
        repositoryChanged &&
        !workspaceMutationObserved,
      evidenceAmbiguous:
        rejectedPaths.length > 0 ||
        omittedPaths.length > 0 ||
        pathComparisons.some(
          (entry) =>
            entry.state ===
            "missing_after",
        ),
      observedAt: nowIso(now),
      sourceExcerptsIncluded: false,
      rawWorkspacePathIncluded:
        false,
      workspaceMutationAuthorizedBySc8_4:
        false,
      remoteMutationObserved: false,
      canonicalAdmissionObserved:
        false,
    },
  );
}

function requirementObserved(
  requiredKind,
  availableKinds,
) {
  const normalized =
    normalizedKind(requiredKind);
  if (!normalized) return false;
  if (availableKinds.has(normalized)) {
    return true;
  }
  const aliases = {
    source: [
      "source_read",
      "read_result",
    ],
    read: [
      "source_read",
      "read_result",
    ],
    patch: [
      "patch_result",
      "implementation_change",
    ],
    implementation: [
      "implementation_change",
      "patch_result",
    ],
    command: [
      "command_result",
      "verification_command",
    ],
    test: [
      "test_result",
      "runtime_verification",
    ],
    runtime: [
      "runtime_verification",
      "test_result",
    ],
    workspace: [
      "workspace_effect",
      "repository_after_state",
    ],
    repository: [
      "repository_after_state",
      "repository_diff",
    ],
    output: [
      "worker_final_output",
    ],
    worker: [
      "worker_turn",
      "worker_final_output",
    ],
  };
  for (
    const [token, candidates]
    of Object.entries(aliases)
  ) {
    if (
      normalized.includes(token) &&
      candidates.some((candidate) =>
        availableKinds.has(
          candidate,
        ))
    ) {
      return true;
    }
  }
  return false;
}

function buildVerificationCoverageWitnesses(
  handoffRun,
  contract,
  turnWitness,
  toolResultWitnesses,
  workspaceEffectWitnesses,
  repositoryWitness,
  now,
) {
  const availableKinds =
    new Set([
      "worker_start_transition",
      "worker_turn",
      "repository_after_state",
      ...(
        turnWitness.finalOutputPresent
          ? [
              "worker_final_output",
            ]
          : []
      ),
      ...(
        repositoryWitness
          .repositoryChanged
          ? ["repository_diff"]
          : []
      ),
      ...toolResultWitnesses
        .flatMap((entry) =>
          entry.evidenceKinds)
        .map(normalizedKind),
      ...(
        workspaceEffectWitnesses
          .length
          ? ["workspace_effect"]
          : []
      ),
    ]);
  const ambiguous =
    workspaceEffectWitnesses.some(
      (entry) =>
        entry.evidenceAmbiguous,
    ) ||
    repositoryWitness
      .evidenceAmbiguous;
  return contract
    .verificationRequirements
    .map((requirement) => {
      const required =
        uniqueStrings(
          requirement
            .requiredEvidenceKinds,
        );
      const observed =
        required.filter((kind) =>
          requirementObserved(
            kind,
            availableKinds,
          ));
      const missing =
        required.filter((kind) =>
          !observed.includes(kind));
      const status =
        missing.length
          ? "missing"
          : ambiguous
            ? "ambiguous"
            : "observed";
      return artifact(
        ARO_VERIFICATION_COVERAGE_WITNESS_SCHEMA,
        "verificationCoverageWitnessId",
        stableId(
          "wm_aro_verification_coverage_witness",
          {
            handoffRunId:
              handoffRun.runId,
            verificationRequirementId:
              requirement
                .verificationRequirementId,
            availableKinds: [
              ...availableKinds,
            ].sort(),
            status,
          },
        ),
        {
          projectId:
            handoffRun.projectId,
          handoffRunRef: {
            kind:
              "aro_worker_handoff_run",
            id: handoffRun.runId,
            digest:
              handoffRun.digest,
            projectId:
              handoffRun.projectId,
          },
          verificationRequirementRef: {
            kind:
              "aro_verification_requirement",
            id:
              requirement
                .verificationRequirementId,
            digest:
              digestFor(
                "direct_aro_verification_requirement_ref@1",
                requirement,
              ),
            projectId:
              handoffRun.projectId,
          },
          verificationKey:
            requirement
              .verificationKey,
          verificationKind:
            requirement
              .verificationKind,
          requiredEvidenceKinds:
            required,
          observedEvidenceKinds:
            observed,
          missingEvidenceKinds:
            missing,
          availableEvidenceKinds: [
            ...availableKinds,
          ].sort(),
          coverageStatus: status,
          mechanicalPresenceOnly:
            true,
          successConditionEvaluated:
            false,
          semanticTruthValidated:
            false,
          closureCertified: false,
          observedAt: nowIso(now),
        },
      );
    });
}

function buildAroExecutionEvidenceBundle(
  input = {},
) {
  const handoffRun =
    input.handoffRun;
  const constitution =
    input.constitution;
  const contract = input.contract;
  const contextImport =
    input.contextImport;
  validateAroWorkerHandoffRun(
    handoffRun,
  );
  validateAroWorkerConstitution(
    constitution,
  );
  validateAroMutationContract(
    contract,
  );
  validateAroRealizationContextImport(
    contextImport,
  );
  if (
    handoffRun.state !==
      "handed_off" ||
    !handoffRun.workerSessionRef ||
    !handoffRun.workerTurnRef ||
    !exactRefMatches(
      handoffRun.constitutionRef,
      workerConstitutionRef(
        constitution,
      ),
    ) ||
    !exactRefMatches(
      constitution.contractRef,
      mutationContractRef(
        contract,
      ),
    ) ||
    !exactRefMatches(
      constitution
        .contextImportRef,
      realizationContextImportRef(
        contextImport,
      ),
    )
  ) {
    fail(
      "world_manager_aro_execution_evidence_lineage_invalid",
      handoffRun.runId,
    );
  }
  const now = input.now;
  const runtimeObservation =
    input.runtimeObservation || {};
  const repositoryObservation =
    input.repositoryObservation || {};
  const turnWitness =
    buildWorkerTurnWitness(
      handoffRun,
      runtimeObservation,
      now,
    );
  const toolResultWitnesses =
    buildToolResultWitnesses(
      handoffRun,
      runtimeObservation,
      now,
    );
  const workspaceEffectWitnesses =
    buildWorkspaceEffectWitnesses(
      handoffRun,
      runtimeObservation,
      toolResultWitnesses,
      now,
    );
  const repositoryAfterStateWitness =
    buildRepositoryAfterStateWitness(
      handoffRun,
      contextImport,
      repositoryObservation,
      workspaceEffectWitnesses,
      now,
    );
  const verificationCoverageWitnesses =
    buildVerificationCoverageWitnesses(
      handoffRun,
      contract,
      turnWitness,
      toolResultWitnesses,
      workspaceEffectWitnesses,
      repositoryAfterStateWitness,
      now,
    );
  const workspaceMutationObserved =
    workspaceEffectWitnesses.some(
      (entry) =>
        entry.workspaceMutationObserved,
    ) ||
    repositoryAfterStateWitness
      .workspaceMutationObserved;
  const ambiguityObserved =
    workspaceEffectWitnesses.some(
      (entry) =>
        entry.evidenceAmbiguous,
    ) ||
    repositoryAfterStateWitness
      .evidenceAmbiguous ||
    verificationCoverageWitnesses
      .some((entry) =>
        entry.coverageStatus ===
        "ambiguous");
  const captureState =
    turnWitness.terminal
      ? "acquired"
      : "observing";
  const acquisitionRunRef =
    exactRef(
      input.acquisitionRunRef,
      "acquisitionRunRef",
    );
  const evidenceBundleId =
    stableId(
      "wm_aro_execution_evidence_bundle",
      {
        acquisitionRunRef,
        turnWitnessRef:
          artifactRef(
            "aro_worker_turn_witness",
            turnWitness,
            "workerTurnWitnessId",
            handoffRun.projectId,
          ),
        toolResultWitnessRefs:
          toolResultWitnesses.map(
            (entry) =>
              artifactRef(
                "aro_tool_result_witness",
                entry,
                "toolResultWitnessId",
                handoffRun.projectId,
              )),
        repositoryAfterStateWitnessRef:
          artifactRef(
            "aro_repository_after_state_witness",
            repositoryAfterStateWitness,
            "repositoryAfterStateWitnessId",
            handoffRun.projectId,
          ),
      },
    );
  return artifact(
    ARO_EXECUTION_EVIDENCE_BUNDLE_SCHEMA,
    "evidenceBundleId",
    evidenceBundleId,
    {
      projectId:
        handoffRun.projectId,
      acquisitionRunRef,
      handoffRunRef: {
        kind:
          "aro_worker_handoff_run",
        id: handoffRun.runId,
        digest: handoffRun.digest,
        projectId:
          handoffRun.projectId,
      },
      constitutionRef:
        workerConstitutionRef(
          constitution,
        ),
      contractRef:
        mutationContractRef(
          contract,
        ),
      contextImportRef:
        realizationContextImportRef(
          contextImport,
        ),
      workerTurnWitness:
        turnWitness,
      toolResultWitnesses,
      workspaceEffectWitnesses,
      repositoryAfterStateWitness,
      verificationCoverageWitnesses,
      captureState,
      workerTurnTerminal:
        turnWitness.terminal,
      workspaceMutationObserved,
      repositoryChanged:
        repositoryAfterStateWitness
          .repositoryChanged,
      ambiguityObserved,
      missingEvidenceKindCount:
        verificationCoverageWitnesses
          .reduce(
            (count, entry) =>
              count +
              entry
                .missingEvidenceKinds
                .length,
            0,
          ),
      acquiredAt: nowIso(now),
      workspaceMutationAuthorizedBySc8_4:
        false,
      remoteMutationObserved: false,
      canonicalAdmissionObserved:
        false,
      semanticTruthValidated: false,
      closureCertified: false,
      rawProviderPayloadIncluded:
        false,
      rawToolResultIncluded: false,
      rawChainOfThoughtIncluded:
        false,
    },
  );
}

function validateAroExecutionEvidenceBundle(
  value,
) {
  validateArtifact(
    value,
    ARO_EXECUTION_EVIDENCE_BUNDLE_SCHEMA,
    "evidenceBundleId",
  );
  validateArtifact(
    value.workerTurnWitness,
    ARO_WORKER_TURN_WITNESS_SCHEMA,
    "workerTurnWitnessId",
  );
  (
    Array.isArray(
      value.toolResultWitnesses,
    )
      ? value.toolResultWitnesses
      : []
  ).forEach((entry) =>
    validateArtifact(
      entry,
      ARO_TOOL_RESULT_WITNESS_SCHEMA,
      "toolResultWitnessId",
    ));
  (
    Array.isArray(
      value.workspaceEffectWitnesses,
    )
      ? value.workspaceEffectWitnesses
      : []
  ).forEach((entry) =>
    validateArtifact(
      entry,
      ARO_WORKSPACE_EFFECT_WITNESS_SCHEMA,
      "workspaceEffectWitnessId",
    ));
  validateArtifact(
    value.repositoryAfterStateWitness,
    ARO_REPOSITORY_AFTER_STATE_WITNESS_SCHEMA,
    "repositoryAfterStateWitnessId",
  );
  (
    Array.isArray(
      value.verificationCoverageWitnesses,
    )
      ? value
          .verificationCoverageWitnesses
      : []
  ).forEach((entry) =>
    validateArtifact(
      entry,
      ARO_VERIFICATION_COVERAGE_WITNESS_SCHEMA,
      "verificationCoverageWitnessId",
    ));
  if (
    !["observing", "acquired"].includes(
      value.captureState,
    ) ||
    value.workspaceMutationAuthorizedBySc8_4 !==
      false ||
    value.remoteMutationObserved !==
      false ||
    value.canonicalAdmissionObserved !==
      false ||
    value.semanticTruthValidated !==
      false ||
    value.closureCertified !== false ||
    value.rawProviderPayloadIncluded !==
      false ||
    value.rawToolResultIncluded !==
      false ||
    value.rawChainOfThoughtIncluded !==
      false
  ) {
    fail(
      "world_manager_aro_execution_evidence_boundary_invalid",
      value.evidenceBundleId,
    );
  }
  return true;
}

function evidenceBundleRef(bundle) {
  validateAroExecutionEvidenceBundle(
    bundle,
  );
  return artifactRef(
    "aro_execution_evidence_bundle",
    bundle,
    "evidenceBundleId",
    bundle.projectId,
  );
}

function buildAroExecutionEvidenceRun(
  input = {},
) {
  const handoffRunRef =
    exactRef(
      input.handoffRunRef,
      "handoffRunRef",
    );
  const observationRequestId =
    text(
      input.observationRequestId,
      "",
    );
  if (!observationRequestId) {
    fail(
      "world_manager_aro_execution_observation_request_id_required",
    );
  }
  const state = text(
    input.state,
    "scheduled",
  );
  if (!EVIDENCE_RUN_STATES.has(state)) {
    fail(
      "world_manager_aro_execution_run_state_invalid",
      state,
    );
  }
  const runId =
    text(
      input.runId,
      stableId(
        "wm_aro_execution_evidence_run",
        {
          handoffRunRef,
          observationRequestId,
        },
      ),
    );
  return artifact(
    ARO_EXECUTION_EVIDENCE_RUN_SCHEMA,
    "runId",
    runId,
    {
      projectId: text(
        input.projectId ||
          handoffRunRef.projectId,
        "",
      ),
      handoffRunRef,
      observationRequestId,
      runRevision:
        Math.max(
          1,
          Number(
            input.runRevision || 1,
          ),
        ),
      predecessorRef:
        input.predecessorRef
          ? exactRef(
              input.predecessorRef,
              "predecessorRef",
            )
          : null,
      state,
      evidenceBundleRef:
        input.evidenceBundleRef
          ? exactRef(
              input.evidenceBundleRef,
              "evidenceBundleRef",
            )
          : null,
      error:
        isPlainObject(input.error)
          ? {
              code: text(
                input.error.code,
                "world_manager_aro_execution_evidence_failed",
              ),
              message: bounded(
                input.error.message,
                "Execution evidence acquisition failed.",
                1_200,
              ),
              detail: bounded(
                input.error.detail,
                "",
                1_200,
              ),
            }
          : null,
      retryable: state === "failed",
      workspaceMutationObserved:
        input
          .workspaceMutationObserved ===
        true,
      repositoryChanged:
        input.repositoryChanged ===
        true,
      ambiguityObserved:
        input.ambiguityObserved ===
        true,
      missingEvidenceKindCount:
        safeNumber(
          input.missingEvidenceKindCount,
        ),
      grantsObservationAuthority:
        false,
      workspaceMutationAuthorized:
        false,
      remoteMutationAuthorized:
        false,
      canonicalAdmissionAuthorized:
        false,
      semanticClosureAuthorized:
        false,
      createdAt: text(
        input.createdAt,
        nowIso(input.now),
      ),
      updatedAt: text(
        input.updatedAt,
        nowIso(input.now),
      ),
    },
  );
}

function validateAroExecutionEvidenceRun(
  value,
) {
  validateArtifact(
    value,
    ARO_EXECUTION_EVIDENCE_RUN_SCHEMA,
    "runId",
  );
  if (
    !EVIDENCE_RUN_STATES.has(
      value.state,
    ) ||
    !Number.isInteger(
      value.runRevision,
    ) ||
    value.runRevision < 1 ||
    value.grantsObservationAuthority !==
      false ||
    value.workspaceMutationAuthorized !==
      false ||
    value.remoteMutationAuthorized !==
      false ||
    value.canonicalAdmissionAuthorized !==
      false ||
    value.semanticClosureAuthorized !==
      false ||
    value.retryable !==
      (value.state === "failed")
  ) {
    fail(
      "world_manager_aro_execution_run_invalid",
      value.runId,
    );
  }
  if (
    value.state === "acquired" &&
    !value.evidenceBundleRef
  ) {
    fail(
      "world_manager_aro_execution_run_bundle_required",
      value.runId,
    );
  }
  if (
    value.state === "observing" &&
    !value.evidenceBundleRef
  ) {
    fail(
      "world_manager_aro_execution_run_observation_required",
      value.runId,
    );
  }
  return true;
}

function reviseAroExecutionEvidenceRun(
  current,
  patch = {},
) {
  validateAroExecutionEvidenceRun(
    current,
  );
  if (
    TERMINAL_EVIDENCE_RUN_STATES.has(
      current.state,
    )
  ) {
    fail(
      "world_manager_aro_execution_run_terminal",
      current.runId,
    );
  }
  return buildAroExecutionEvidenceRun({
    ...current,
    ...patch,
    runId: current.runId,
    projectId:
      current.projectId,
    handoffRunRef:
      current.handoffRunRef,
    observationRequestId:
      current.observationRequestId,
    runRevision:
      current.runRevision + 1,
    predecessorRef: {
      kind:
        "aro_execution_evidence_run",
      id: current.runId,
      digest: current.digest,
      projectId:
        current.projectId,
    },
    createdAt:
      current.createdAt,
    updatedAt: text(
      patch.updatedAt,
      nowIso(patch.now),
    ),
  });
}

module.exports = {
  ARO_EXECUTION_EVIDENCE_BUNDLE_SCHEMA,
  ARO_EXECUTION_EVIDENCE_RUN_SCHEMA,
  ARO_REPOSITORY_AFTER_STATE_WITNESS_SCHEMA,
  ARO_TOOL_RESULT_WITNESS_SCHEMA,
  ARO_VERIFICATION_COVERAGE_WITNESS_SCHEMA,
  ARO_WORKER_TURN_WITNESS_SCHEMA,
  ARO_WORKSPACE_EFFECT_WITNESS_SCHEMA,
  EVIDENCE_RUN_STATES,
  TERMINAL_EVIDENCE_RUN_STATES,
  buildAroExecutionEvidenceBundle,
  buildAroExecutionEvidenceRun,
  evidenceBundleRef,
  reviseAroExecutionEvidenceRun,
  validateAroExecutionEvidenceBundle,
  validateAroExecutionEvidenceRun,
};
