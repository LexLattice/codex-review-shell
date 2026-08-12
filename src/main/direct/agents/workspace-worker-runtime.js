"use strict";

const crypto = require("node:crypto");

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
const ADMITTED_CANCELLATION_RESULTS = new WeakMap();

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function cancellationReasonCode(value, fallback = "direct_workspace_worker_cancelled") {
  const reasonCode = normalizeString(value, fallback);
  return /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(reasonCode)
    ? reasonCode
    : fallback;
}

function publicRuntimeErrorCode(value, fallback = "direct_workspace_worker_runtime_exception") {
  const code = normalizeString(value, "");
  return /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(code) ? code : fallback;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function safeMutationOutcome(value) {
  if (!isPlainObject(value) || value.schema !== "workspace_backend_mutation_outcome@1") return null;
  const committed = value.committed === true;
  const base = {
    schema: "workspace_backend_mutation_outcome@1",
    requestId: normalizeString(value.requestId, ""),
    method: normalizeString(value.method, ""),
    commitKind: normalizeString(value.commitKind, ""),
    committed,
    ...(committed ? {} : {
      indeterminate: value.indeterminate === true,
      partialMutationPossible: value.partialMutationPossible === true,
    }),
    retainedForInspection: value.retainedForInspection === true,
    ...(committed
      ? { resultDigest: normalizeString(value.resultDigest, "") }
      : { failureCode: publicRuntimeErrorCode(value.failureCode, "") }),
    rawPathIncluded: false,
  };
  const outcomeDigest = normalizeString(value.outcomeDigest, "");
  const expectedOutcomeDigest = `sha256:${crypto.createHash("sha256")
    .update(stableStringify(base)).digest("hex")}`;
  if (
    !base.requestId ||
    !base.method ||
    !base.commitKind ||
    outcomeDigest !== expectedOutcomeDigest ||
    (committed && !/^sha256:[a-f0-9]{64}$/.test(base.resultDigest)) ||
    (!committed && (
      base.indeterminate !== true ||
      base.partialMutationPossible !== true ||
      !base.failureCode
    )) ||
    value.rawPathIncluded !== false
  ) {
    return null;
  }
  return { ...base, outcomeDigest };
}

function canonicalCancellationReceipt(value, mutationOutcome = null, binding = {}, options = {}) {
  if (!isPlainObject(value) || value.acknowledged !== true || value.quiesced !== true) return null;
  const suppliedOutcomeDigest = normalizeString(value.outcomeDigest, "");
  const mutationOutcomeDigest = normalizeString(mutationOutcome?.outcomeDigest, "");
  if (
    suppliedOutcomeDigest && mutationOutcomeDigest &&
    suppliedOutcomeDigest !== mutationOutcomeDigest
  ) return null;
  const outcomeDigest = suppliedOutcomeDigest || mutationOutcomeDigest;
  if (outcomeDigest && !/^sha256:[a-f0-9]{64}$/.test(outcomeDigest)) return null;
  if (!mutationOutcome && outcomeDigest) return null;
  const acknowledgementKind = normalizeString(value.acknowledgementKind, "");
  if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(acknowledgementKind)) return null;
  const launchDigest = normalizeString(binding.launchDigest, "");
  const lifecycleSessionId = normalizeString(binding.lifecycleSessionId, "");
  const lifecycleLeaseId = normalizeString(binding.lifecycleLeaseId, "");
  const reasonCode = normalizeString(binding.cancellationReasonCode, "");
  if (
    !/^sha256:[a-f0-9]{64}$/.test(launchDigest) ||
    !/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(reasonCode) ||
    (value.launchDigest && value.launchDigest !== launchDigest) ||
    (value.lifecycleSessionId && value.lifecycleSessionId !== lifecycleSessionId) ||
    (value.lifecycleLeaseId && value.lifecycleLeaseId !== lifecycleLeaseId) ||
    (value.reasonCode && value.reasonCode !== reasonCode)
  ) return null;
  if (
    options.requireExplicitBinding === true &&
    (
      value.launchDigest !== launchDigest ||
      value.lifecycleSessionId !== lifecycleSessionId ||
      value.lifecycleLeaseId !== lifecycleLeaseId ||
      value.reasonCode !== reasonCode
    )
  ) return null;
  const base = {
    schema: "direct_workspace_worker_cancellation_receipt@1",
    targetRequestId: normalizeString(value.targetRequestId, ""),
    launchDigest,
    lifecycleSessionId,
    lifecycleLeaseId,
    reasonCode,
    acknowledged: true,
    quiesced: true,
    acknowledgementKind,
    outcomeDigest,
    rawProcessDetailsIncluded: false,
  };
  if (mutationOutcome && base.targetRequestId !== mutationOutcome.requestId) return null;
  const receiptDigest = digestFor("direct-workspace-worker-cancellation-receipt@1", base);
  if (value.receiptDigest && value.receiptDigest !== receiptDigest) return null;
  return { ...base, receiptDigest };
}

function validateWorkspaceWorkerCancellationReceipt(value, mutationOutcome, binding = {}) {
  return canonicalCancellationReceipt(value, mutationOutcome, binding, {
    requireExplicitBinding: true,
  });
}

function cancellationAdmissionIdentity(input = {}) {
  return Object.freeze({
    childAgentId: normalizeString(input.childAgentId, "workspace_worker_unbound"),
    projectId: normalizeString(input.projectId, "project_direct_agents"),
    workThreadId: normalizeString(input.workThreadId, ""),
    primaryThreadId: normalizeString(input.primaryThreadId, ""),
    launchDigest: normalizeString(input.launchDigest, ""),
    lifecycleSessionId: normalizeString(input.lifecycleSessionId, ""),
    lifecycleLeaseId: normalizeString(input.lifecycleLeaseId, ""),
    cancellationReasonCode: normalizeString(input.cancellationReasonCode, ""),
  });
}

function admissionIdentityMatches(actual = {}, expected = {}) {
  return [
    "childAgentId",
    "projectId",
    "workThreadId",
    "primaryThreadId",
    "launchDigest",
    "lifecycleSessionId",
    "lifecycleLeaseId",
    "cancellationReasonCode",
  ].every((key) =>
    !normalizeString(expected[key], "") || actual[key] === normalizeString(expected[key], ""));
}

function admittedWorkspaceWorkerCancellationReceipt(result, expectedIdentity = {}) {
  if (!isPlainObject(result)) return null;
  const admissionIdentity = ADMITTED_CANCELLATION_RESULTS.get(result);
  if (!admissionIdentity || !admissionIdentityMatches(admissionIdentity, expectedIdentity)) return null;
  const mutationOutcome = safeMutationOutcome(result.mutationOutcome);
  const receipt = validateWorkspaceWorkerCancellationReceipt(
    result.cancellationReceipt,
    mutationOutcome,
    admissionIdentity,
  );
  if (
    !receipt ||
    result.cancellationAcknowledged !== true ||
    result.backendQuiesced !== true
  ) return null;
  return { ...receipt, admissionIdentity: { ...admissionIdentity } };
}

function projectAdmittedWorkspaceWorkerResult(source, projection = {}) {
  if (!isPlainObject(source) || !isPlainObject(projection)) {
    const error = new Error("Workspace worker result projection requires admitted objects.");
    error.code = "direct_workspace_worker_result_projection_invalid";
    throw error;
  }
  const admissionIdentity = ADMITTED_CANCELLATION_RESULTS.get(source);
  const admittedReceipt = admittedWorkspaceWorkerCancellationReceipt(source);
  const result = { ...source, ...projection };
  if (admittedReceipt) {
    for (const key of [
      "status",
      "blockerCode",
      "cancellationAcknowledged",
      "backendQuiesced",
      "mutationOutcome",
      "cancellationReceipt",
      "resultDigest",
    ]) {
      if (Object.hasOwn(projection, key) && stableStringify(projection[key]) !== stableStringify(source[key])) {
        const error = new Error("Workspace worker projection cannot rewrite admitted cancellation evidence.");
        error.code = "direct_workspace_worker_cancellation_projection_conflict";
        throw error;
      }
    }
    Object.freeze(result);
    ADMITTED_CANCELLATION_RESULTS.set(result, admissionIdentity);
  }
  return result;
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
    mutationOutcome: safeMutationOutcome(input.mutationOutcome),
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
    const appliedMutationOutcome = safeMutationOutcome(applied?.requestOutcome);
    if (typeof input.onMutationOutcome === "function" && appliedMutationOutcome) {
      input.onMutationOutcome(appliedMutationOutcome);
    }
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
      mutationOutcome: appliedMutationOutcome,
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
    mutationOutcome: result.mutationOutcome ? { ...result.mutationOutcome } : null,
    rawWorkspacePathIncluded: false,
    rawProviderPayloadIncluded: false,
  };
}

function executionProjection(contract, results = [], status = "running", pendingMutationOutcome = null) {
  const latestMutationOutcome = safeMutationOutcome(pendingMutationOutcome) || [...results].reverse()
    .map((result) => safeMutationOutcome(result?.mutationOutcome))
    .find(Boolean) || null;
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
    workspaceMutationStarted: Boolean(latestMutationOutcome) ||
      results.some((result) => result.sideEffectExecuted === true),
    latestMutationOutcome,
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
  const mutationOutcome = safeMutationOutcome(
    input.mutationOutcome || input.workspaceExecution?.latestMutationOutcome,
  );
  const receiptInput = isPlainObject(input.cancellationReceipt) ? {
    ...input.cancellationReceipt,
    launchDigest: normalizeString(input.admissionIdentity?.launchDigest, ""),
    lifecycleSessionId: normalizeString(input.admissionIdentity?.lifecycleSessionId, ""),
    lifecycleLeaseId: normalizeString(input.admissionIdentity?.lifecycleLeaseId, ""),
    reasonCode: normalizeString(input.admissionIdentity?.cancellationReasonCode, ""),
  } : null;
  const cancellationReceipt = canonicalCancellationReceipt(
    receiptInput,
    mutationOutcome,
    input.admissionIdentity,
  );
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
    cancellationAcknowledged: cancellationReceipt?.acknowledged === true,
    backendQuiesced: cancellationReceipt?.quiesced === true,
    backendOwnershipUnresolved: input.backendOwnershipUnresolved === true,
    mutationOutcome,
    partialMutationPossible: mutationOutcome?.partialMutationPossible === true,
    cancellationReceipt,
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
  if (cancellationReceipt) {
    Object.freeze(cancellationReceipt);
    if (mutationOutcome) Object.freeze(mutationOutcome);
    Object.freeze(result);
    ADMITTED_CANCELLATION_RESULTS.set(
      result,
      cancellationAdmissionIdentity(input.admissionIdentity),
    );
  }
  return result;
}

async function runDirectWorkspaceWorker(input = {}) {
  const launchDigest = /^sha256:[a-f0-9]{64}$/.test(normalizeString(input.launchDigest, ""))
    ? input.launchDigest
    : digestFor("direct-workspace-worker-standalone-launch@1", {
        launchId: crypto.randomUUID(),
        childAgentId: normalizeString(input.childAgentId, "workspace_worker_unbound"),
        projectId: normalizeString(input.projectId, "project_direct_agents"),
      });
  const baseAdmissionIdentity = cancellationAdmissionIdentity({ ...input, launchDigest });
  const workerResult = (resultInput = {}) => resultFor({
    ...resultInput,
    admissionIdentity: cancellationAdmissionIdentity({
      ...baseAdmissionIdentity,
      cancellationReasonCode: normalizeString(
        cancellationReasonCode(
          input.signal?.reason,
          cancellationReasonCode(resultInput.blockerCode),
        ),
      ),
    }),
  });
  if (typeof input.workspaceProvisioner !== "function") {
    return workerResult({ status: "blocked", blockerCode: "direct_workspace_worker_provisioner_missing" });
  }
  if (typeof input.providerRequestRunner !== "function") {
    return workerResult({ status: "blocked", blockerCode: "direct_workspace_worker_provider_runner_missing" });
  }
  const task = normalizeString(input.prompt || input.task || input.message, "");
  if (!task) return workerResult({ status: "blocked", blockerCode: "missing_spawn_prompt" });
  if (input.signal?.aborted) return workerResult({
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
    return workerResult({
      status: input.signal?.aborted ? "cancelled" : "failed",
      blockerCode: publicRuntimeErrorCode(error?.code, "direct_workspace_worker_provision_failed"),
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
    let activeOperation = "provider";
    let activeToolMutationOutcome = null;
    try {
      for (let stepOrdinal = 1; stepOrdinal <= contract.maxToolSteps + 1; stepOrdinal += 1) {
        if (input.signal?.aborted) {
          const execution = executionProjection(contract, results, "cancelled");
          const latestMutationOutcome = execution.latestMutationOutcome;
          return workerResult({
            status: "cancelled",
            blockerCode: "direct_workspace_worker_aborted",
            tokenUsage: aggregateTokenUsage(allEvents),
            workspaceExecution: execution,
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
              targetRequestId: latestMutationOutcome?.requestId || "",
              acknowledged: true,
              quiesced: true,
              acknowledgementKind: "cancelled_between_requests",
              outcomeDigest: latestMutationOutcome?.outcomeDigest || "",
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
        activeOperation = "provider";
        activeToolMutationOutcome = null;
        latestProviderResult = await input.providerRequestRunner({
          requestBody,
          signal: input.signal,
          contract,
          stepOrdinal,
        });
        if (input.signal?.aborted) {
          const execution = executionProjection(contract, results, "cancelled");
          const latestMutationOutcome = execution.latestMutationOutcome;
          return workerResult({
            status: "cancelled",
            blockerCode: "direct_workspace_worker_aborted",
            responseId,
            tokenUsage: aggregateTokenUsage(allEvents),
            workspaceExecution: execution,
            captureResult: {
              normalizedEvents: allEvents,
              terminal: { state: "aborted", error: null },
              responseId,
              workspaceWorkerToolResults: results,
              workspaceWorkerContract: contract,
            },
            providerRequestStarted: true,
            cancellationAcknowledged: true,
            backendQuiesced: true,
            cancellationReceipt: {
              targetRequestId: latestMutationOutcome?.requestId || "",
              acknowledged: true,
              quiesced: true,
              acknowledgementKind: "provider_result_discarded_after_cancel",
              outcomeDigest: latestMutationOutcome?.outcomeDigest || "",
            },
          });
        }
        const stepEvents = renumberEvents(latestProviderResult?.normalizedEvents, allEvents.length);
        allEvents.push(...stepEvents);
        responseId = normalizeString(latestProviderResult?.responseId, responseId);
        const terminal = latestProviderResult?.terminal || {};
        if (terminal.state === "completed") {
          const outputText = assistantText(stepEvents);
          const execution = executionProjection(contract, results, "completed");
          return workerResult({
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
          const blockerCode = publicRuntimeErrorCode(
            terminal.error?.code || latestProviderResult?.error?.code,
            "direct_workspace_worker_provider_failed",
          );
          const execution = executionProjection(contract, results, "failed");
          const latestMutationOutcome = execution.latestMutationOutcome;
          return workerResult({
            status: terminal.state === "aborted" ? "cancelled" : "failed",
            blockerCode,
            responseId,
            tokenUsage: aggregateTokenUsage(allEvents),
            workspaceExecution: execution,
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
              targetRequestId: latestMutationOutcome?.requestId || "",
              acknowledged: true,
              quiesced: true,
              acknowledgementKind: "provider_request_completed_after_cancel",
              outcomeDigest: latestMutationOutcome?.outcomeDigest || "",
            } : null,
          });
        }
        if (stepOrdinal > contract.maxToolSteps) {
          const blockerCode = "direct_workspace_worker_tool_step_limit";
          return workerResult({
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
        activeOperation = "workspace_tool";
        const executed = await executeWorkspaceTool({
          obligation: obligations[0],
          contract,
          provisioned,
          stepOrdinal,
          signal: input.signal,
          onMutationOutcome: (mutationOutcome) => {
            activeToolMutationOutcome = mutationOutcome;
          },
        });
        results.push(executed);
        evidence.push(executed.providerOutputText);
        activeOperation = "provider";
      }
    } catch (error) {
      const backendOwnershipUnresolved = error?.workspaceBackendRequest === true && error?.backendQuiesced !== true;
      if (backendOwnershipUnresolved) retainProvisionedBackend = true;
      const blockerCode = input.signal?.aborted
        ? "direct_workspace_worker_aborted"
        : publicRuntimeErrorCode(error?.code, "direct_workspace_worker_runtime_exception");
      const errorMutationOutcome = activeOperation === "workspace_tool"
        ? safeMutationOutcome(error?.mutationOutcome)
        : null;
      const effectiveMutationOutcome = activeToolMutationOutcome || errorMutationOutcome ||
        executionProjection(contract, results, "failed").latestMutationOutcome;
      const execution = executionProjection(
        contract,
        results,
        input.signal?.aborted ? "cancelled" : "failed",
        effectiveMutationOutcome,
      );
      const cancellationQuiesced = input.signal?.aborted === true &&
        error?.cancellationAcknowledged === true &&
        error?.backendQuiesced === true &&
        error?.cancellationReceipt?.acknowledged === true &&
        error?.cancellationReceipt?.quiesced === true;
      const aggregateCancellationReceipt = cancellationQuiesced ? {
        targetRequestId: effectiveMutationOutcome?.requestId ||
          normalizeString(error?.cancellationReceipt?.targetRequestId, ""),
        acknowledged: true,
        quiesced: true,
        acknowledgementKind: effectiveMutationOutcome
          ? "provider_cancelled_after_workspace_mutation"
          : normalizeString(
              error?.cancellationReceipt?.acknowledgementKind,
              "provider_request_cancelled",
            ),
        outcomeDigest: effectiveMutationOutcome?.outcomeDigest || "",
        rawProcessDetailsIncluded: false,
      } : error?.cancellationReceipt;
      return workerResult({
        status: input.signal?.aborted ? "cancelled" : "failed",
        blockerCode,
        responseId,
        tokenUsage: aggregateTokenUsage(allEvents),
        workspaceExecution: execution,
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
        cancellationReceipt: aggregateCancellationReceipt,
        mutationOutcome: effectiveMutationOutcome,
      });
    }
    return workerResult({
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
  admittedWorkspaceWorkerCancellationReceipt,
  DIRECT_WORKSPACE_WORKER_EXECUTION_SCHEMA,
  DIRECT_WORKSPACE_WORKER_RESULT_SCHEMA,
  DIRECT_WORKSPACE_WORKER_TOOL_RESULT_SCHEMA,
  executeWorkspaceTool,
  projectAdmittedWorkspaceWorkerResult,
  runDirectWorkspaceWorker,
  validateWorkspaceWorkerCancellationReceipt,
};
