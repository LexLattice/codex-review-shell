"use strict";

const {
  buildImplementationToolInitialRequest,
} = require("../transport/codex-responses-transport");
const {
  buildToolObligationsFromEvents,
} = require("../session/session-store");
const {
  scanToolResultTextForSecrets,
} = require("../tools/read-only-authority");
const {
  assertWorkspaceWorkerContractSafe,
  compileWorkspaceWorkerContract,
  digestFor,
  workspaceWorkerInstructions,
  workspaceWorkerToolSchemas,
} = require("./workspace-worker-contract");
const {
  boundedProviderEvidenceJson,
  executeWorkspaceRepositoryTool,
  safeRepositoryRelativePath,
} = require("./workspace-worker-repository-tools");

const DIRECT_WORKSPACE_WORKER_RESULT_SCHEMA = "direct_workspace_worker_result@1";
const DIRECT_WORKSPACE_WORKER_EXECUTION_SCHEMA = "direct_workspace_worker_execution@1";
const DIRECT_WORKSPACE_WORKER_TOOL_RESULT_SCHEMA = "direct_workspace_worker_tool_result@1";
const MAX_PROVIDER_EVIDENCE_CHARS = 96 * 1024;
const MAX_TOOL_OUTPUT_CHARS = 48 * 1024;
const MAX_PARENT_SUMMARY_CHARS = 1600;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedText(value, limit = MAX_TOOL_OUTPUT_CHARS) {
  const text = typeof value === "string" ? value : "";
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1))}…` : text;
}

function parseArguments(obligation = {}) {
  try {
    const parsed = JSON.parse(normalizeString(obligation.argumentsText, "{}"));
    if (isPlainObject(parsed)) return parsed;
  } catch {}
  const error = new Error("Workspace worker tool arguments are not one complete JSON object.");
  error.code = "direct_workspace_worker_arguments_invalid";
  throw error;
}

function assistantText(events = []) {
  return (Array.isArray(events) ? events : [])
    .filter((event) => event?.type === "message_delta")
    .map((event) => normalizeString(event.text, ""))
    .join("")
    .trim();
}

function renumberEvents(events = [], start = 0) {
  return (Array.isArray(events) ? events : []).map((event, index) => ({
    ...event,
    sequence: start + index,
  }));
}

function aggregateTokenUsage(events = []) {
  const usageEvents = (Array.isArray(events) ? events : [])
    .filter((event) => event?.type === "usage_delta" && isPlainObject(event.usage));
  if (!usageEvents.length) return {};
  return usageEvents.reduce((total, event) => ({
    inputTokens: total.inputTokens + Number(event.usage.inputTokens || 0),
    cachedInputTokens: total.cachedInputTokens + Number(event.usage.cachedInputTokens || 0),
    outputTokens: total.outputTokens + Number(event.usage.outputTokens || 0),
    reasoningOutputTokens: total.reasoningOutputTokens + Number(event.usage.reasoningTokens || 0),
    totalTokens: total.totalTokens + Number(event.usage.totalTokens || 0),
  }), {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  });
}

function rawPathVariants(value) {
  const text = normalizeString(value, "");
  if (!text) return [];
  return [...new Set([
    text,
    text.replace(/\\/g, "/"),
    text.replace(/\//g, "\\"),
  ].filter(Boolean))].sort((left, right) => right.length - left.length);
}

function redactNativeRoot(value, nativeRoot) {
  let text = typeof value === "string" ? value : "";
  for (const variant of rawPathVariants(nativeRoot)) text = text.split(variant).join("<workspace>");
  return text;
}

function safeTestTargets(value = [], profileId = "") {
  const source = Array.isArray(value) ? value : [];
  if (source.length > 16) {
    const error = new Error("Workspace worker test target count exceeded the compiled limit.");
    error.code = "direct_workspace_worker_test_targets_exceeded";
    throw error;
  }
  return source.map((entry) => {
    const rawTarget = typeof entry === "string" ? entry : "";
    const target = normalizeString(rawTarget, "");
    const filePart = target.split("::", 1)[0];
    safeRepositoryRelativePath(filePart);
    const arcPytestTarget = profileId === "arcagi3_pinned_make_actions";
    const nodeIds = target.split("::");
    if (
      target.startsWith("-") ||
      /[|&;`$<>]/.test(target) ||
      (arcPytestTarget && (
        rawTarget !== rawTarget.trim() ||
        /[\s'"\\]/.test(target) ||
        !filePart.endsWith(".py") ||
        nodeIds.some((part) => !part)
      ))
    ) {
      const error = new Error("Workspace worker test target is outside the compiled argument grammar.");
      error.code = "direct_workspace_worker_test_target_invalid";
      throw error;
    }
    return target.replace(/\\/g, "/");
  });
}

function providerPrompt(task, contextMessages = [], evidence = []) {
  const sections = [];
  if (contextMessages.length) {
    sections.push(
      "[ADMITTED PARENT CONTEXT]",
      contextMessages.map((message) => `${message.role === "assistant" ? "Assistant" : "User"}: ${message.text}`).join("\n\n"),
      "[END ADMITTED PARENT CONTEXT]",
      "",
    );
  }
  sections.push("[DELEGATED TASK]", task, "[END DELEGATED TASK]");
  if (evidence.length) {
    const admittedEvidence = [];
    let admittedChars = 0;
    for (let index = evidence.length - 1; index >= 0; index -= 1) {
      const row = evidence[index];
      const separatorChars = admittedEvidence.length ? 2 : 0;
      if (row.length + admittedChars + separatorChars > MAX_PROVIDER_EVIDENCE_CHARS) break;
      admittedEvidence.unshift(row);
      admittedChars += row.length + separatorChars;
    }
    const joined = admittedEvidence.join("\n\n");
    sections.push(
      "",
      "[ADMITTED LOCAL TOOL RESULT EVIDENCE]",
      joined,
      "[END ADMITTED LOCAL TOOL RESULT EVIDENCE]",
      "Continue the same delegated task. Request at most one next declared tool, or answer final.",
    );
  }
  return sections.join("\n");
}

function toolResult(input = {}) {
  const callId = normalizeString(input.callId, "");
  const providerOutputText = typeof input.providerOutputText === "string" ? input.providerOutputText : "";
  if (providerOutputText.length > MAX_TOOL_OUTPUT_CHARS) {
    const error = new Error("Workspace worker tool evidence exceeded its structural output budget.");
    error.code = "direct_workspace_worker_tool_result_too_large";
    throw error;
  }
  try {
    JSON.parse(providerOutputText);
  } catch {
    const error = new Error("Workspace worker tool evidence is not one structurally complete JSON envelope.");
    error.code = "direct_workspace_worker_tool_result_json_invalid";
    throw error;
  }
  const base = {
    schema: DIRECT_WORKSPACE_WORKER_TOOL_RESULT_SCHEMA,
    stepOrdinal: Number(input.stepOrdinal || 0),
    tool: normalizeString(input.tool, ""),
    callId,
    obligationId: `workspace_tool_obligation_${digestFor("direct-workspace-worker-obligation@1", {
      callId,
      stepOrdinal: Number(input.stepOrdinal || 0),
      workspaceBindingDigest: normalizeString(input.workspaceBindingDigest, ""),
    }).slice(7, 31)}`,
    status: normalizeString(input.status, "completed"),
    summary: normalizeString(input.summary, ""),
    sideEffectExecuted: input.sideEffectExecuted === true,
    workspaceBindingId: normalizeString(input.workspaceBindingId, ""),
    workspaceBindingDigest: normalizeString(input.workspaceBindingDigest, ""),
    providerOutputText,
    rawWorkspacePathIncluded: false,
    rawProviderPayloadIncluded: false,
  };
  base.resultDigest = digestFor("direct-workspace-worker-tool-result@1", base);
  return base;
}

async function executeWorkspaceTool(input = {}) {
  const { obligation, contract, provisioned, stepOrdinal } = input;
  assertWorkspaceWorkerContractSafe(contract);
  const toolName = normalizeString(obligation?.name, "");
  if (!contract.authority.declaredTools.includes(toolName)) {
    const error = new Error(`Workspace worker requested undeclared tool: ${toolName || "unknown"}`);
    error.code = "direct_workspace_worker_tool_not_declared";
    throw error;
  }
  const args = parseArguments(obligation);
  const common = {
    stepOrdinal,
    tool: toolName,
    callId: obligation.callId,
    workspaceBindingId: contract.binding.bindingId,
    workspaceBindingDigest: contract.binding.bindingDigest,
  };
  const requestOptions = input.signal ? { signal: input.signal } : {};
  if (["inspect_repository", "list_files", "match_files", "search_text", "read_file"].includes(toolName)) {
    const repositoryResult = await executeWorkspaceRepositoryTool({
      toolName,
      args,
      contract,
      provisioned,
      signal: input.signal,
    });
    return toolResult({
      ...common,
      summary: repositoryResult.summary,
      providerOutputText: repositoryResult.providerOutputText,
      sideEffectExecuted: false,
    });
  }
  if (toolName === "apply_patch") {
    const patch = normalizeString(args.patch, "");
    if (!patch) {
      const error = new Error("Workspace worker apply_patch requires a unified diff.");
      error.code = "direct_workspace_worker_patch_missing";
      throw error;
    }
    const plan = await provisioned.workspaceRequest("applyWorkspaceWorkerPatch", {
      bindingDigest: contract.binding.bindingDigest,
      mode: "dryRun",
      patch,
    }, 30_000, requestOptions);
    const applied = await provisioned.workspaceRequest("applyWorkspaceWorkerPatch", {
      bindingDigest: contract.binding.bindingDigest,
      mode: "apply",
      patch,
      patchPlanId: plan?.patchPlanId,
    }, 30_000, requestOptions);
    const files = (Array.isArray(applied?.files) ? applied.files : []).map((file) => ({
      path: normalizeString(file.displayPath, ""),
      operation: normalizeString(file.operation, "update"),
      beforeDigest: normalizeString(file.beforeDigest, ""),
      afterDigest: normalizeString(file.afterDigest, ""),
      addedLineCount: Number(file.addedLineCount || 0),
      removedLineCount: Number(file.removedLineCount || 0),
    }));
    const providerOutput = {
      kind: "apply_patch_result",
      status: normalizeString(applied?.status, "applied"),
      patchPlanId: normalizeString(plan?.patchPlanId, ""),
      files,
      totals: isPlainObject(applied?.totals) ? applied.totals : {},
      rawPatchIncluded: false,
      rawWorkspacePathIncluded: false,
    };
    return toolResult({
      ...common,
      summary: files.length
        ? files.map((file) => `${file.operation} ${file.path}`).join("; ")
        : "Patch applied with no reported file rows.",
      providerOutputText: boundedProviderEvidenceJson(providerOutput),
      sideEffectExecuted: true,
    });
  }
  if (toolName === "run_test") {
    if (!contract.testProfile?.available) {
      const error = new Error("Workspace worker constitution has no admitted test profile.");
      error.code = "direct_workspace_worker_test_not_admitted";
      throw error;
    }
    const targets = safeTestTargets(args.targets, contract.testProfile.profileId);
    const action = normalizeString(
      args.action,
      targets.length && contract.testProfile.targetedAction
        ? contract.testProfile.targetedAction
        : contract.testProfile.defaultAction,
    );
    if (contract.testProfile.actionsAllowed.length && !contract.testProfile.actionsAllowed.includes(action)) {
      const error = new Error("Workspace worker requested a test action outside the compiled profile.");
      error.code = "direct_workspace_worker_test_action_not_admitted";
      throw error;
    }
    const timeoutMs = Math.max(1000, Math.min(120_000, Number(args.timeout_ms || args.timeoutMs || 120_000) || 120_000));
    const raw = await provisioned.workspaceRequest("runDirectTest", {
      bindingDigest: contract.binding.bindingDigest,
      profileDigest: contract.testProfile.profileDigest,
      action,
      targets,
      timeoutMs,
    }, timeoutMs + 10_000, requestOptions);
    const stdout = redactNativeRoot(boundedText(raw?.stdout, MAX_TOOL_OUTPUT_CHARS / 2), provisioned.nativeRoot);
    const stderr = redactNativeRoot(boundedText(raw?.stderr, MAX_TOOL_OUTPUT_CHARS / 2), provisioned.nativeRoot);
    const scan = scanToolResultTextForSecrets(`${stdout}\n${stderr}`);
    const outputAllowed = scan.status !== "blocked";
    const providerOutput = {
      kind: "run_test_result",
      testProfileId: contract.testProfile.profileId,
      action,
      targets,
      exitCode: Number.isFinite(Number(raw?.exitCode)) ? Number(raw.exitCode) : null,
      timedOut: raw?.timedOut === true,
      durationMs: Number(raw?.durationMs || 0),
      stdout: outputAllowed ? stdout : "[test output withheld by local secret scan]",
      stderr: outputAllowed ? stderr : "[test output withheld by local secret scan]",
      outputWithheld: !outputAllowed,
      rawCommandIncluded: false,
      rawWorkspacePathIncluded: false,
    };
    return toolResult({
      ...common,
      status: providerOutput.exitCode === 0 && !providerOutput.timedOut ? "completed" : "failed",
      summary: `${contract.testProfile.profileId} · exit ${providerOutput.exitCode ?? "unknown"}${providerOutput.timedOut ? " · timed out" : ""}`,
      providerOutputText: boundedProviderEvidenceJson(providerOutput, {
        redactionErrorCode: "direct_workspace_worker_test_result_redaction_failed",
        redactionMessage: "Workspace worker test evidence contained auth-like material and was withheld.",
      }),
      sideEffectExecuted: true,
    });
  }
  const error = new Error(`Unsupported workspace worker tool: ${toolName || "unknown"}`);
  error.code = "direct_workspace_worker_tool_unsupported";
  throw error;
}

function publicToolResult(result = {}) {
  return {
    schema: result.schema,
    stepOrdinal: result.stepOrdinal,
    tool: result.tool,
    callId: result.callId,
    obligationId: result.obligationId,
    status: result.status,
    summary: result.summary,
    sideEffectExecuted: result.sideEffectExecuted,
    workspaceBindingId: result.workspaceBindingId,
    workspaceBindingDigest: result.workspaceBindingDigest,
    resultDigest: result.resultDigest,
    rawWorkspacePathIncluded: false,
    rawProviderPayloadIncluded: false,
  };
}

function executionProjection(contract, results = [], status = "running") {
  const projection = {
    schema: DIRECT_WORKSPACE_WORKER_EXECUTION_SCHEMA,
    status,
    contractId: contract.contractId,
    contractDigest: contract.contractDigest,
    workspaceMode: contract.workspaceMode,
    toolProfile: contract.authority.toolProfile,
    declaredTools: [...contract.authority.declaredTools],
    binding: { ...contract.binding },
    contextAdmission: { ...contract.contextAdmission },
    repositoryPolicy: { ...contract.repositoryPolicy },
    policyCompilation: { ...contract.policyCompilation },
    testProfile: contract.testProfile ? { ...contract.testProfile } : null,
    toolResults: results.map(publicToolResult),
    toolResultCount: results.length,
    workspaceMutationStarted: results.some((result) => result.sideEffectExecuted === true),
    retainedForInspection: contract.binding.retainedAfterCompletion === true,
    recursiveSpawnAllowed: false,
    remoteMutationAllowed: false,
    bottomUpMessagingAllowed: false,
    testProcessIsolationGuaranteed: false,
    testNetworkIsolationGuaranteed: false,
    rawWorkspacePathIncluded: false,
    rawPromptIncluded: false,
    rawContextIncluded: false,
    rawProviderPayloadIncluded: false,
  };
  projection.executionDigest = digestFor("direct-workspace-worker-execution@1", projection);
  return projection;
}

function resultFor(input = {}) {
  const result = {
    schema: DIRECT_WORKSPACE_WORKER_RESULT_SCHEMA,
    status: normalizeString(input.status, "failed"),
    blockerCode: normalizeString(input.blockerCode, ""),
    outputText: boundedText(normalizeString(input.outputText, ""), MAX_PARENT_SUMMARY_CHARS),
    responseId: normalizeString(input.responseId, ""),
    tokenUsage: isPlainObject(input.tokenUsage) ? input.tokenUsage : {},
    workspaceExecution: input.workspaceExecution || null,
    captureResult: input.captureResult || null,
    providerRequestStarted: input.providerRequestStarted === true,
    providerCompleted: input.providerCompleted === true,
    workspaceMutationStarted: input.workspaceExecution?.workspaceMutationStarted === true,
    childTranscriptPromotionStarted: false,
    recursiveSpawnStarted: false,
    remoteMutationStarted: false,
    bottomUpMessagingStarted: false,
    cancellationAcknowledged: input.cancellationAcknowledged === true,
    backendQuiesced: input.backendQuiesced === true,
    backendOwnershipUnresolved: input.backendOwnershipUnresolved === true,
    mutationOutcome: isPlainObject(input.mutationOutcome)
      ? {
          schema: normalizeString(input.mutationOutcome.schema, ""),
          requestId: normalizeString(input.mutationOutcome.requestId, ""),
          method: normalizeString(input.mutationOutcome.method, ""),
          commitKind: normalizeString(input.mutationOutcome.commitKind, ""),
          committed: input.mutationOutcome.committed === true,
          indeterminate: input.mutationOutcome.indeterminate === true,
          partialMutationPossible: input.mutationOutcome.partialMutationPossible === true,
          retainedForInspection: input.mutationOutcome.retainedForInspection === true,
          failureCode: normalizeString(input.mutationOutcome.failureCode, ""),
          outcomeDigest: normalizeString(input.mutationOutcome.outcomeDigest, ""),
          rawPathIncluded: false,
        }
      : null,
    partialMutationPossible: input.mutationOutcome?.partialMutationPossible === true,
    cancellationReceipt: isPlainObject(input.cancellationReceipt)
      ? {
          targetRequestId: normalizeString(input.cancellationReceipt.targetRequestId, ""),
          acknowledged: input.cancellationReceipt.acknowledged === true,
          quiesced: input.cancellationReceipt.quiesced === true,
          acknowledgementKind: normalizeString(input.cancellationReceipt.acknowledgementKind, ""),
          rawProcessDetailsIncluded: false,
        }
      : null,
    rawWorkspacePathIncluded: false,
    rawPromptIncluded: false,
    rawContextIncluded: false,
    rawProviderPayloadIncluded: false,
  };
  result.resultDigest = digestFor("direct-workspace-worker-result@1", {
    ...result,
    captureResult: result.captureResult ? {
      terminal: result.captureResult.terminal,
      responseId: result.captureResult.responseId,
      normalizedEventCount: result.captureResult.normalizedEvents?.length || 0,
    } : null,
  });
  return result;
}

async function runDirectWorkspaceWorker(input = {}) {
  if (typeof input.workspaceProvisioner !== "function") {
    return resultFor({ status: "blocked", blockerCode: "direct_workspace_worker_provisioner_missing" });
  }
  if (typeof input.providerRequestRunner !== "function") {
    return resultFor({ status: "blocked", blockerCode: "direct_workspace_worker_provider_runner_missing" });
  }
  const task = normalizeString(input.prompt || input.task || input.message, "");
  if (!task) return resultFor({ status: "blocked", blockerCode: "missing_spawn_prompt" });
  if (input.signal?.aborted) return resultFor({
    status: "cancelled",
    blockerCode: "direct_workspace_worker_aborted",
    cancellationAcknowledged: true,
    backendQuiesced: true,
    cancellationReceipt: {
      targetRequestId: "",
      acknowledged: true,
      quiesced: true,
      acknowledgementKind: "cancelled_before_provisioning",
    },
  });
  let provisioned;
  let contract;
  let admittedContextMessages = [];
  try {
    provisioned = await input.workspaceProvisioner(input);
    const compiled = compileWorkspaceWorkerContract({
      ...input,
      binding: provisioned.binding,
      testProfile: provisioned.testProfile,
    });
    contract = compiled.contract;
    admittedContextMessages = compiled.admittedContextMessages;
  } catch (error) {
    try {
      await provisioned?.release?.();
    } catch {}
    return resultFor({
      status: input.signal?.aborted ? "cancelled" : "failed",
      blockerCode: normalizeString(error?.code, "direct_workspace_worker_provision_failed"),
      cancellationAcknowledged: error?.cancellationAcknowledged === true,
      backendQuiesced: error?.backendQuiesced === true,
      backendOwnershipUnresolved: error?.workspaceBackendRequest === true && error?.backendQuiesced !== true,
      cancellationReceipt: error?.cancellationReceipt,
      mutationOutcome: error?.mutationOutcome,
    });
  }
  let retainProvisionedBackend = false;
  try {
    const tools = workspaceWorkerToolSchemas(contract);
    const instructions = workspaceWorkerInstructions(contract);
    const allEvents = [];
    const results = [];
    const evidence = [];
    let responseId = "";
    let latestProviderResult = null;
    try {
      for (let stepOrdinal = 1; stepOrdinal <= contract.maxToolSteps + 1; stepOrdinal += 1) {
        if (input.signal?.aborted) {
          return resultFor({
            status: "cancelled",
            blockerCode: "direct_workspace_worker_aborted",
            tokenUsage: aggregateTokenUsage(allEvents),
            workspaceExecution: executionProjection(contract, results, "cancelled"),
            captureResult: {
              normalizedEvents: allEvents,
              terminal: { state: "aborted", error: null },
              responseId,
              workspaceWorkerToolResults: results,
              workspaceWorkerContract: contract,
            },
            providerRequestStarted: allEvents.length > 0,
            cancellationAcknowledged: true,
            backendQuiesced: true,
            cancellationReceipt: {
              targetRequestId: "",
              acknowledged: true,
              quiesced: true,
              acknowledgementKind: "cancelled_between_requests",
            },
          });
        }
        const requestBody = buildImplementationToolInitialRequest({
          prompt: providerPrompt(task, admittedContextMessages, evidence),
          instructions,
          model: input.model,
          reasoningEffort: input.reasoningEffort,
          tools,
        });
        latestProviderResult = await input.providerRequestRunner({
          requestBody,
          signal: input.signal,
          contract,
          stepOrdinal,
        });
        const stepEvents = renumberEvents(latestProviderResult?.normalizedEvents, allEvents.length);
        allEvents.push(...stepEvents);
        responseId = normalizeString(latestProviderResult?.responseId, responseId);
        const terminal = latestProviderResult?.terminal || {};
        if (terminal.state === "completed") {
          const outputText = assistantText(stepEvents);
          const execution = executionProjection(contract, results, "completed");
          return resultFor({
            status: "completed",
            outputText: outputText || "Workspace worker completed without a textual summary.",
            responseId,
            tokenUsage: aggregateTokenUsage(allEvents),
            workspaceExecution: execution,
            captureResult: {
              ...latestProviderResult,
              normalizedEvents: allEvents,
              terminal: { state: "completed", error: null },
              responseId,
              workspaceWorkerToolResults: results,
              workspaceWorkerContract: contract,
            },
            providerRequestStarted: true,
            providerCompleted: true,
          });
        }
        if (terminal.state !== "tool_waiting") {
          const blockerCode = normalizeString(
            terminal.error?.code || latestProviderResult?.error?.code,
            "direct_workspace_worker_provider_failed",
          );
          return resultFor({
            status: terminal.state === "aborted" ? "cancelled" : "failed",
            blockerCode,
            responseId,
            tokenUsage: aggregateTokenUsage(allEvents),
            workspaceExecution: executionProjection(contract, results, "failed"),
            captureResult: {
              ...latestProviderResult,
              normalizedEvents: allEvents,
              responseId,
              workspaceWorkerToolResults: results,
              workspaceWorkerContract: contract,
            },
            providerRequestStarted: true,
            cancellationAcknowledged: terminal.state === "aborted",
            backendQuiesced: terminal.state === "aborted",
            cancellationReceipt: terminal.state === "aborted" ? {
              targetRequestId: "",
              acknowledged: true,
              quiesced: true,
              acknowledgementKind: "provider_request_completed_after_cancel",
            } : null,
          });
        }
        if (stepOrdinal > contract.maxToolSteps) {
          const blockerCode = "direct_workspace_worker_tool_step_limit";
          return resultFor({
            status: "failed",
            blockerCode,
            responseId,
            tokenUsage: aggregateTokenUsage(allEvents),
            workspaceExecution: executionProjection(contract, results, "failed"),
            captureResult: {
              normalizedEvents: allEvents,
              terminal: { state: "failed", error: { code: blockerCode } },
              responseId,
              workspaceWorkerToolResults: results,
              workspaceWorkerContract: contract,
            },
            providerRequestStarted: true,
          });
        }
        const obligations = buildToolObligationsFromEvents(
          `workspace_child_${contract.childAgentId}`,
          `workspace_child_turn_${contract.childAgentId}`,
          stepEvents,
          { stepOrdinal },
        ).filter((obligation) => obligation.status === "waiting");
        if (obligations.length !== 1) {
          const error = new Error("Workspace worker provider steps must contain exactly one completed tool call.");
          error.code = obligations.length ? "direct_workspace_worker_multiple_tool_calls" : "direct_workspace_worker_tool_call_incomplete";
          throw error;
        }
        const executed = await executeWorkspaceTool({
          obligation: obligations[0],
          contract,
          provisioned,
          stepOrdinal,
          signal: input.signal,
        });
        results.push(executed);
        evidence.push(executed.providerOutputText);
      }
    } catch (error) {
      const backendOwnershipUnresolved = error?.workspaceBackendRequest === true && error?.backendQuiesced !== true;
      if (backendOwnershipUnresolved) retainProvisionedBackend = true;
      const blockerCode = input.signal?.aborted
        ? "direct_workspace_worker_aborted"
        : normalizeString(error?.code, "direct_workspace_worker_runtime_exception");
      return resultFor({
        status: input.signal?.aborted ? "cancelled" : "failed",
        blockerCode,
        responseId,
        tokenUsage: aggregateTokenUsage(allEvents),
        workspaceExecution: executionProjection(contract, results, input.signal?.aborted ? "cancelled" : "failed"),
        captureResult: {
          ...(latestProviderResult || {}),
          normalizedEvents: allEvents,
          terminal: {
            state: input.signal?.aborted ? "aborted" : "failed",
            error: { code: blockerCode },
          },
          responseId,
          workspaceWorkerToolResults: results,
          workspaceWorkerContract: contract,
        },
        providerRequestStarted: allEvents.length > 0,
        cancellationAcknowledged: error?.cancellationAcknowledged === true,
        backendQuiesced: error?.backendQuiesced === true,
        backendOwnershipUnresolved,
        cancellationReceipt: error?.cancellationReceipt,
        mutationOutcome: error?.mutationOutcome,
      });
    }
    return resultFor({
      status: "failed",
      blockerCode: "direct_workspace_worker_loop_exhausted",
      tokenUsage: aggregateTokenUsage(allEvents),
      workspaceExecution: executionProjection(contract, results, "failed"),
    });
  } finally {
    if (!retainProvisionedBackend) {
      try {
        await provisioned.release?.();
      } catch {}
    }
  }
}

module.exports = {
  DIRECT_WORKSPACE_WORKER_EXECUTION_SCHEMA,
  DIRECT_WORKSPACE_WORKER_RESULT_SCHEMA,
  DIRECT_WORKSPACE_WORKER_TOOL_RESULT_SCHEMA,
  executeWorkspaceTool,
  runDirectWorkspaceWorker,
};
