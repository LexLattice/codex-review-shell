"use strict";

const crypto = require("node:crypto");
const { scanTextForRawExposure } = require("../thread/renderer-transcript-projection");
const {
  buildCommandWorkspaceEffectSummary,
  postSideEffectPolicyViolation,
  providerEnvelopeForEffectSummary,
} = require("../workspace/mutation-truth");

const DIRECT_COMMAND_EXECUTION_PLAN_SCHEMA = "direct_command_execution_plan@1";
const DIRECT_COMMAND_EXECUTION_RESULT_SCHEMA = "direct_codex_command_execution_result@1";
const DIRECT_COMMAND_EXECUTION_CONTINUATION_REQUEST_SCHEMA = "direct_codex_command_execution_continuation_request@1";
const RUN_COMMAND_TOOL_NAMES = new Set(["run_command", "runCommand"]);
const SUPPORTED_COMMAND_CONTINUATION_KINDS = new Map([
  ["function_call", "function_call_output"],
  ["custom_tool_call", "custom_tool_call_output"],
]);
const COMMAND_TERMINAL_STATUSES = new Set([
  "command_declined",
  "command_canceled",
  "command_result_recorded",
  "continuation_built",
  "continuation_sent",
]);
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const DENIED_EXECUTABLES = new Set([
  "curl",
  "wget",
  "ssh",
  "scp",
  "sftp",
  "nc",
  "netcat",
  "docker",
  "kubectl",
  "terraform",
  "powershell",
  "pwsh",
]);
const MAX_COMMAND_ARGS = 32;
const MAX_COMMAND_ARG_CHARS = 2048;
const MAX_COMMAND_TIMEOUT_MS = 120_000;
const MAX_COMMAND_OUTPUT_PREVIEW_CHARS = 24_000;
const MAX_PROVIDER_COMMAND_STREAM_CHARS = 20_000;
const MAX_PROVIDER_COMMAND_OUTPUT_CHARS = 64 * 1024;
const MAX_COMMAND_APPROVAL_SUMMARY_CHARS = 2000;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function preserveString(value) {
  return typeof value === "string" ? value : "";
}

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function safeRelPath(value) {
  const text = normalizeString(value, "");
  if (!text || text === ".") return "";
  const slashNormalized = text.replace(/\\/g, "/");
  if (slashNormalized === "/workspace" || slashNormalized === "/workspace/") return "";
  const normalized = slashNormalized.split("/").filter(Boolean).join("/");
  if (
    /^[A-Za-z]:/.test(text) ||
    slashNormalized.startsWith("/") ||
    text.startsWith("//") ||
    normalized.split("/").includes("..") ||
    /[\0\r\n]/.test(text)
  ) {
    const error = new Error("Command cwd must be a contained project-relative path.");
    error.code = "command_cwd_unsafe";
    throw error;
  }
  return normalized;
}

function commandPlanIdFor(obligationId, commandShape) {
  return `command_plan_${sha256(`${normalizeString(obligationId, "")}:${stableStringify(commandShape)}`).slice(0, 20)}`;
}

function commandResultIdFor(obligationId, commandPlanId) {
  return `command_result_${sha256(`${normalizeString(obligationId, "")}:${normalizeString(commandPlanId, "")}`).slice(0, 20)}`;
}

function commandContinuationIdFor(obligationId, resultId) {
  return `command_continuation_${sha256(`${normalizeString(obligationId, "")}:${normalizeString(resultId, "")}`).slice(0, 20)}`;
}

function parseArgumentsJson(obligation = {}) {
  const text = preserveString(obligation.argumentsText);
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : {};
  } catch (error) {
    const parseError = new Error(`Command tool arguments are not valid JSON: ${error.message}`);
    parseError.code = "malformed_command_arguments";
    throw parseError;
  }
}

function supportedCommandOutputType(obligation = {}) {
  const providerCallType = normalizeString(obligation.providerCallType || obligation.toolType, "");
  const outputType = SUPPORTED_COMMAND_CONTINUATION_KINDS.get(providerCallType);
  if (!outputType) {
    const error = new Error(`Unsupported command continuation call type: ${providerCallType || "unknown"}`);
    error.code = "command_tool_shape_unsupported";
    throw error;
  }
  return { providerCallType, outputType };
}

function hasProviderShellSyntax(value) {
  return /[|&;<>()`$]/.test(String(value || ""));
}

function scriptBodyPolicy(scriptBody) {
  const text = preserveString(scriptBody);
  const lower = text.toLowerCase();
  for (const executable of DENIED_EXECUTABLES) {
    if (new RegExp(`(^|[^a-z0-9_-])${executable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9_-]|$)`, "i").test(lower)) {
      return { ok: false, blockerCode: "package_script_body_blocked", reason: `Package script references denied helper: ${executable}` };
    }
  }
  return {
    ok: true,
    warning: /[|&;<>()`$]/.test(text) ? "package_script_shell_syntax_present" : "",
  };
}

function packageLifecycleScriptNames(scriptName) {
  const safeName = normalizeString(scriptName, "");
  return safeName ? [`pre${safeName}`, safeName, `post${safeName}`] : [];
}

function packageScriptFor(command, args) {
  if (!PACKAGE_MANAGERS.has(command)) {
    const error = new Error("Only package-manager scripts are supported for direct command execution v0.");
    error.code = "command_class_deferred";
    throw error;
  }
  const first = normalizeString(args[0], "");
  let scriptName = "";
  let scriptArgs = [];
  if (first === "test") {
    scriptName = "test";
    scriptArgs = args.slice(1);
  } else if (first === "run") {
    scriptName = normalizeString(args[1], "");
    scriptArgs = args.slice(2);
  } else {
    const error = new Error("Direct command execution v0 supports package-manager test/run scripts only.");
    error.code = "command_class_deferred";
    throw error;
  }
  if (!scriptName || hasProviderShellSyntax(scriptName) || scriptName.startsWith("-")) {
    const error = new Error("Package script name is invalid.");
    error.code = "invalid_package_script_name";
    throw error;
  }
  for (const arg of scriptArgs) {
    if (hasProviderShellSyntax(arg)) {
      const error = new Error("Shell syntax in provider command arguments is unsupported.");
      error.code = "command_shell_syntax_unsupported";
      throw error;
    }
  }
  return {
    packageManager: command,
    scriptName,
    scriptArgs,
    packageJsonRelPath: "",
  };
}

function assertCommandObligation(obligation = {}) {
  const status = normalizeString(obligation.status, "");
  if (status === "collecting_arguments" || obligation.completedAtSequence == null) {
    const error = new Error("Command approval requires a completed provider tool call.");
    error.code = "tool_call_arguments_incomplete";
    throw error;
  }
  if (!RUN_COMMAND_TOOL_NAMES.has(normalizeString(obligation.name, ""))) {
    const error = new Error(`Unsupported command tool: ${obligation.name || "unknown"}`);
    error.code = "unsupported_command_tool_name";
    throw error;
  }
  if (normalizeString(obligation.namespace, "")) {
    const error = new Error("Command tool namespace is unsupported in v0.");
    error.code = "unsupported_command_namespace";
    throw error;
  }
  if (!normalizeString(obligation.callId, "")) {
    const error = new Error("Command continuation requires the original provider call_id.");
    error.code = "missing_command_call_id";
    throw error;
  }
  const argsObject = parseArgumentsJson(obligation);
  const command = normalizeString(argsObject.command || argsObject.executable, "");
  if (!command || /\s/.test(command) || command.includes("/") || command.includes("\\")) {
    const error = new Error("run_command requires a simple executable name, not a shell command string.");
    error.code = "malformed_command_arguments";
    throw error;
  }
  if (DENIED_EXECUTABLES.has(command.toLowerCase())) {
    const error = new Error(`Command executable is denied: ${command}`);
    error.code = "command_executable_denied";
    throw error;
  }
  const args = Array.isArray(argsObject.args) ? argsObject.args.map((arg) => String(arg)) : [];
  if (args.length > MAX_COMMAND_ARGS) {
    const error = new Error("Command argument count exceeds the direct v0 cap.");
    error.code = "command_caps_exceeded";
    throw error;
  }
  for (const arg of args) {
    if (arg.length > MAX_COMMAND_ARG_CHARS) {
      const error = new Error("Command argument exceeds the direct v0 cap.");
      error.code = "command_caps_exceeded";
      throw error;
    }
    if (/[\0\r\n]/.test(arg)) {
      const error = new Error("Command arguments may not contain control characters.");
      error.code = "malformed_command_arguments";
      throw error;
    }
  }
  if (hasProviderShellSyntax(command)) {
    const error = new Error("Shell syntax in provider command executable is unsupported.");
    error.code = "command_shell_syntax_unsupported";
    throw error;
  }
  const cwdRelPath = safeRelPath(argsObject.cwd || argsObject.cwdRelPath || "");
  const packageScript = packageScriptFor(command, args);
  const timeoutMs = Math.max(1000, Math.min(Number(argsObject.timeoutMs || argsObject.timeout || MAX_COMMAND_TIMEOUT_MS), MAX_COMMAND_TIMEOUT_MS));
  const continuationKind = supportedCommandOutputType(obligation);
  return {
    command,
    args,
    cwdRelPath,
    reason: normalizeString(argsObject.reason || argsObject.summary, ""),
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : MAX_COMMAND_TIMEOUT_MS,
    callId: normalizeString(obligation.callId, ""),
    providerCallType: continuationKind.providerCallType,
    outputType: continuationKind.outputType,
    packageScript,
  };
}

function packageJsonPathFor(cwdRelPath) {
  const cwd = safeRelPath(cwdRelPath);
  return cwd ? `${cwd}/package.json` : "package.json";
}

async function readPackageScriptEvidence(workspaceRequest, parsed) {
  const packageJsonRelPath = packageJsonPathFor(parsed.cwdRelPath);
  let file;
  try {
    file = await workspaceRequest("readFile", {
      relPath: packageJsonRelPath,
      maxBytes: 512 * 1024,
      rejectSensitive: true,
    });
  } catch (error) {
    const next = new Error("Package manifest is required before command approval.");
    next.code = "package_manifest_missing";
    next.cause = error;
    throw next;
  }
  let manifest;
  try {
    manifest = JSON.parse(preserveString(file.text));
  } catch (error) {
    const next = new Error("Package manifest is not valid JSON.");
    next.code = "package_manifest_invalid";
    next.cause = error;
    throw next;
  }
  const scripts = isPlainObject(manifest.scripts) ? manifest.scripts : {};
  const scriptName = parsed.packageScript.scriptName;
  const scriptBody = preserveString(scripts[scriptName]);
  if (!scriptBody) {
    const error = new Error(`Package script is missing: ${parsed.packageScript.scriptName}`);
    error.code = "package_script_missing";
    throw error;
  }
  const lifecycleScripts = [];
  let warning = "";
  for (const name of packageLifecycleScriptNames(scriptName)) {
    const body = preserveString(scripts[name]);
    if (!body) continue;
    const bodyPolicy = scriptBodyPolicy(body);
    if (!bodyPolicy.ok) {
      const error = new Error(bodyPolicy.reason || "Package script body is blocked.");
      error.code = bodyPolicy.blockerCode || "package_script_body_blocked";
      throw error;
    }
    if (bodyPolicy.warning) warning = bodyPolicy.warning;
    lifecycleScripts.push({
      scriptName: name,
      scriptCommandEvidenceKey: `pkg_script_${sha256(`${packageJsonRelPath}:${name}:${body}`).slice(0, 24)}`,
      scriptCommandPreview: body.slice(0, MAX_COMMAND_APPROVAL_SUMMARY_CHARS),
      scriptCommandPreviewTruncated: body.length > MAX_COMMAND_APPROVAL_SUMMARY_CHARS,
      lifecycleKind: name === scriptName ? "main" : name.startsWith("pre") ? "pre" : "post",
    });
  }
  return {
    packageManager: parsed.command,
    packageJsonRelPath,
    scriptName,
    scriptExists: true,
    scriptCommandEvidenceKey: `pkg_script_${sha256(`${packageJsonRelPath}:${parsed.packageScript.scriptName}:${scriptBody}`).slice(0, 24)}`,
    scriptCommandPreview: scriptBody.slice(0, MAX_COMMAND_APPROVAL_SUMMARY_CHARS),
    scriptCommandPreviewTruncated: scriptBody.length > MAX_COMMAND_APPROVAL_SUMMARY_CHARS,
    lifecycleScripts,
    lifecycleScriptCount: lifecycleScripts.length,
    scriptPolicyWarning: warning,
  };
}

function projectCommandPlan(obligation = {}, parsed = {}, scriptEvidence = {}, nowMs) {
  const commandShape = {
    command: parsed.command,
    args: parsed.args,
    cwdRelPath: parsed.cwdRelPath,
    timeoutMs: parsed.timeoutMs,
    packageScript: parsed.packageScript,
    scriptEvidenceKey: scriptEvidence.scriptCommandEvidenceKey,
  };
  const commandPlanId = commandPlanIdFor(obligation.obligationId, commandShape);
  const displayCommand = [parsed.command, ...parsed.args].join(" ");
  const plan = {
    schema: DIRECT_COMMAND_EXECUTION_PLAN_SCHEMA,
    commandPlanId,
    projectId: normalizeString(obligation.projectId, ""),
    threadId: normalizeString(obligation.sessionId, ""),
    turnId: normalizeString(obligation.turnId, ""),
    obligationId: normalizeString(obligation.obligationId, ""),
    callId: parsed.callId,
    providerResponseId: normalizeString(obligation.parentResponseId, ""),
    providerCallId: parsed.callId,
    providerCallItemId: normalizeString(obligation.sourceItemId, ""),
    parentResponseSource: normalizeString(obligation.parentResponseSource, "native_direct_initial_stream"),
    parentResponseSourceEventDigest: sha256(obligation.parentResponseId || ""),
    parentTurnDigest: sha256(`${normalizeString(obligation.sessionId, "")}:${normalizeString(obligation.turnId, "")}`),
    toolName: "run_command",
    providerCallType: parsed.providerCallType,
    providerOutputType: parsed.outputType,
    commandClass: "package_script",
    workspaceWritePolicy: "writes_possible_with_warning",
    displayCommand,
    command: parsed.command,
    args: parsed.args,
    cwdRelPath: parsed.cwdRelPath,
    timeoutMs: parsed.timeoutMs,
    packageScriptEvidence: scriptEvidence,
    executableResolution: {
      executable: parsed.command,
      resolvedKind: "package-manager",
      resolvedEvidenceKey: `exec_${sha256(parsed.command).slice(0, 16)}`,
    },
    capabilitiesRequired: {
      shellFalseSupported: true,
      cwdContainmentSupported: true,
      timeoutKillSupported: true,
      envSanitizationSupported: true,
      processTreeKillSupported: true,
      workspaceEffectScanSupported: true,
    },
    safety: {
      shellFalse: true,
      deniedHelperExecutablesBlocked: true,
      networkAccessNotProvenAbsent: true,
      workspaceWritesPossible: true,
      rawWorkspacePathExposed: false,
      rawProviderPayloadExposed: false,
    },
    preview: {
      text: displayCommand.slice(0, MAX_COMMAND_APPROVAL_SUMMARY_CHARS),
      textHash: sha256(displayCommand),
      truncated: displayCommand.length > MAX_COMMAND_APPROVAL_SUMMARY_CHARS,
    },
    createdAt: nowIso(nowMs),
    integrity: {
      algorithm: "sha256",
      artifactDigest: sha256(stableStringify(commandShape)),
    },
    status: "planned",
    blockerCode: "",
  };
  return plan;
}

async function planCommandExecutionObligation(options = {}) {
  const sessionStore = options.sessionStore;
  if (!sessionStore) throw new Error("Command planning requires a direct session store.");
  if (typeof options.workspaceRequest !== "function") throw new Error("Command planning requires workspaceRequest.");
  const { obligation } = sessionStore.findToolObligation(options.sessionId, options.turnId, options.obligationId);
  if (isPlainObject(obligation.commandPlan)) {
    return { reused: true, obligation, commandPlan: obligation.commandPlan };
  }
  const parsed = assertCommandObligation(obligation);
  const scriptEvidence = await readPackageScriptEvidence(options.workspaceRequest, parsed);
  const commandPlan = projectCommandPlan(obligation, parsed, scriptEvidence, options.nowMs);
  const updated = sessionStore.updateToolObligation(options.sessionId, options.turnId, obligation.obligationId, {
    status: "command_planned",
    authorityState: "command_waiting_for_approval",
    approvalAvailable: true,
    executionAllowed: false,
    continuationAllowed: false,
    commandPlan,
    commandPlanBuiltAt: commandPlan.createdAt,
  }, {
    ...options,
    nextTurnState: "tool_waiting",
  });
  return { reused: false, obligation: updated.obligation, commandPlan };
}

function approveCommandExecutionObligation(options = {}) {
  const sessionStore = options.sessionStore;
  if (!sessionStore) throw new Error("Command approval requires a direct session store.");
  const { turn, obligation } = sessionStore.findToolObligation(options.sessionId, options.turnId, options.obligationId);
  if (COMMAND_TERMINAL_STATUSES.has(normalizeString(obligation.status, ""))) return { turn, obligation };
  const parsed = assertCommandObligation(obligation);
  if (!isPlainObject(obligation.commandPlan)) {
    const error = new Error("Command approval requires a command plan.");
    error.code = "command_plan_missing";
    throw error;
  }
  const approvedAt = nowIso(options.nowMs);
  return sessionStore.updateToolObligation(options.sessionId, options.turnId, obligation.obligationId, {
    status: "command_approved",
    authorityState: "command_approved",
    executionAllowed: true,
    continuationAllowed: false,
    approvalAvailable: false,
    approvedAt,
    approvedBy: normalizeString(options.approvedBy, "local-user"),
    approvedCommand: {
      commandPlanId: obligation.commandPlan.commandPlanId,
      providerCallType: parsed.providerCallType,
      outputType: parsed.outputType,
    },
  }, {
    ...options,
    nextTurnState: "authority_waiting",
  });
}

function decideCommandExecutionObligation(options = {}) {
  const sessionStore = options.sessionStore;
  if (!sessionStore) throw new Error("Command decision requires a direct session store.");
  const { turn, obligation } = sessionStore.findToolObligation(options.sessionId, options.turnId, options.obligationId);
  const decision = options.decision === "canceled" ? "command_canceled" : "command_declined";
  if (COMMAND_TERMINAL_STATUSES.has(normalizeString(obligation.status, ""))) return { turn, obligation };
  const decidedAt = nowIso(options.nowMs);
  return sessionStore.updateToolObligation(options.sessionId, options.turnId, obligation.obligationId, {
    status: decision,
    authorityState: decision,
    executionAllowed: false,
    continuationAllowed: false,
    approvalAvailable: false,
    authorityDecision: {
      schema: "direct_codex_command_authority_decision@1",
      decision,
      obligationId: obligation.obligationId,
      tool: "run_command",
      decidedAt,
      decidedBy: normalizeString(options.decidedBy, "local-user"),
      reason: normalizeString(options.reason, decision === "command_canceled" ? "User canceled command execution." : "User declined command execution."),
      executionAllowed: false,
      sideEffectExecuted: false,
      providerContinuationSent: false,
    },
    sideEffectExecuted: false,
  }, {
    ...options,
    nextTurnState: decision === "command_canceled" ? "aborted" : "failed",
    turnPatch: decision === "command_canceled" ? { error: null } : {
      error: {
        code: "command_obligation_declined",
        message: "User declined command execution.",
      },
    },
  });
}

function boundedOutput(value, maxChars) {
  const text = preserveString(value);
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

function commandStatusFromResult(result = {}) {
  if (result.timedOut === true) return "timed_out";
  if (normalizeString(result.spawnError, "")) return "spawn_failed";
  if (result.exitCode === 0) {
    const changed = Number(result.workspaceEffects?.changedPathCount || 0) > 0;
    return changed ? "completed_with_workspace_changes" : "completed_exit_zero";
  }
  return "completed_nonzero_exit";
}

function commandExitCode(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function blockingRawExposureFindings(text) {
  return scanTextForRawExposure(text).filter((finding) => finding.severity === "block");
}

function commandOutputRedactionSummary(stdoutPreview = {}, stderrPreview = {}) {
  const stdoutFindings = blockingRawExposureFindings(stdoutPreview.text);
  const stderrFindings = blockingRawExposureFindings(stderrPreview.text);
  const findings = [...stdoutFindings, ...stderrFindings];
  return {
    scanned: true,
    scanVersion: "direct_raw_exposure_scan@1",
    status: findings.length ? "blocked" : "passed",
    findingCount: findings.length,
    categories: Array.from(new Set(findings.map((finding) => finding.reason || "raw_exposure"))),
    providerOutputAllowed: findings.length === 0,
  };
}

async function executeApprovedCommandExecutionObligation(options = {}) {
  const sessionStore = options.sessionStore;
  if (!sessionStore) throw new Error("Command execution requires a direct session store.");
  if (typeof options.workspaceRequest !== "function") throw new Error("Command execution requires workspaceRequest.");
  const { obligation } = sessionStore.findToolObligation(options.sessionId, options.turnId, options.obligationId);
  if (isPlainObject(obligation.result)) return { reused: true, obligation, result: obligation.result };
  if (obligation.status !== "command_approved" || obligation.authorityState !== "command_approved") {
    const error = new Error("Command obligation must be approved before execution.");
    error.code = "command_obligation_not_approved";
    throw error;
  }
  const parsed = assertCommandObligation(obligation);
  const commandPlan = obligation.commandPlan || {};
  const executed = await options.workspaceRequest("runDirectCommand", {
    command: commandPlan.command || parsed.command,
    args: Array.isArray(commandPlan.args) ? commandPlan.args : parsed.args,
    cwdRelPath: normalizeString(commandPlan.cwdRelPath, parsed.cwdRelPath),
    timeoutMs: Number(commandPlan.timeoutMs || parsed.timeoutMs || MAX_COMMAND_TIMEOUT_MS),
    commandPlanId: normalizeString(commandPlan.commandPlanId, ""),
    workspaceEffectScan: true,
  });
  const resultId = commandResultIdFor(obligation.obligationId, commandPlan.commandPlanId || "");
  const stdoutPreview = boundedOutput(executed.stdout, MAX_COMMAND_OUTPUT_PREVIEW_CHARS);
  const stderrPreview = boundedOutput(executed.stderr, MAX_COMMAND_OUTPUT_PREVIEW_CHARS);
  const status = commandStatusFromResult(executed);
  const exitCode = commandExitCode(executed.exitCode);
  const redaction = commandOutputRedactionSummary(stdoutPreview, stderrPreview);
  const workspaceEffects = isPlainObject(executed.workspaceEffects)
    ? executed.workspaceEffects
    : {
        changedPathCount: 0,
        changedPathsPreview: [],
        changedPathsTruncated: false,
        scanScope: "none",
        scanFailed: true,
      };
  const workspaceEffectSummary = buildCommandWorkspaceEffectSummary({
    projectId: normalizeString(options.projectId, ""),
    sessionId: normalizeString(options.sessionId, obligation.sessionId),
    turnId: normalizeString(options.turnId, obligation.turnId),
    loopId: normalizeString(obligation.toolLoopId, ""),
    stepId: normalizeString(obligation.stepId, ""),
    stepOrdinal: Number(obligation.stepOrdinal || 0) || undefined,
    sourceArtifactId: resultId,
    sourceOperationId: normalizeString(options.clientCommandDecisionId, ""),
    resultId,
    workspaceEffects,
    scanCapabilities: isPlainObject(executed.workspaceEffectScanCapabilities) ? executed.workspaceEffectScanCapabilities : undefined,
    backendCapabilityDigest: isPlainObject(executed.backendCapabilities) ? sha256(stableStringify(executed.backendCapabilities)) : "",
    workspaceBindingEvidenceKey: normalizeString(executed.workspaceBindingEvidenceKey, ""),
    scanConsistency: normalizeString(executed.workspaceEffectScanConsistency, "stable"),
    workspaceWritePolicy: normalizeString(commandPlan.workspaceWritePolicy, "writes_possible_with_warning"),
    startedAt: normalizeString(executed.startedAt, ""),
    completedAt: normalizeString(executed.completedAt, nowIso(options.nowMs)),
    nowMs: options.nowMs,
  });
  const workspaceEffectProviderEnvelope = providerEnvelopeForEffectSummary(workspaceEffectSummary, {
    source: "run_command",
  });
  const postPolicyViolation = postSideEffectPolicyViolation(
    workspaceEffectSummary,
    "run_command",
    normalizeString(commandPlan.workspaceWritePolicy, "writes_possible_with_warning"),
  );
  const providerEnvelope = {
    kind: "run_command_result",
    status,
    commandPlanId: normalizeString(commandPlan.commandPlanId, ""),
    commandClass: "package_script",
    displayCommand: normalizeString(commandPlan.displayCommand, [parsed.command, ...parsed.args].join(" ")),
    cwdRelPath: normalizeString(commandPlan.cwdRelPath, parsed.cwdRelPath),
    exitCode,
    signal: normalizeString(executed.signal, ""),
    timedOut: executed.timedOut === true,
    durationMs: Number(executed.durationMs || 0),
    success: executed.exitCode === 0 && executed.timedOut !== true,
    stdoutPreview: redaction.providerOutputAllowed ? stdoutPreview.text.slice(0, MAX_PROVIDER_COMMAND_STREAM_CHARS) : "",
    stderrPreview: redaction.providerOutputAllowed ? stderrPreview.text.slice(0, MAX_PROVIDER_COMMAND_STREAM_CHARS) : "",
    stdoutTruncated: executed.stdoutTruncated === true || stdoutPreview.truncated,
    stderrTruncated: executed.stderrTruncated === true || stderrPreview.truncated,
    redactionStatus: redaction.status,
    workspaceChangeScanSupported: workspaceEffects.scanScope !== "none",
    workspaceChangesDetected: Number(workspaceEffects.changedPathCount || 0) > 0,
    workspaceChangesPreview: Array.isArray(workspaceEffects.changedPathsPreview) ? workspaceEffects.changedPathsPreview.slice(0, 20) : [],
    workspaceChangesTruncated: workspaceEffects.changedPathsTruncated === true,
    workspaceEffect: workspaceEffectProviderEnvelope,
    workspaceEffectSummaryId: workspaceEffectSummary.effectSummaryId,
    postSideEffectPolicyViolation: postPolicyViolation,
    sideEffectPossible: true,
    networkAccessNotProvenAbsent: true,
    rawPathsExposed: false,
  };
  let providerOutputText = JSON.stringify(providerEnvelope);
  let providerOutputTruncated = false;
  if (providerOutputText.length > MAX_PROVIDER_COMMAND_OUTPUT_CHARS) {
    providerOutputText = JSON.stringify({
      ...providerEnvelope,
      stdoutPreview: providerEnvelope.stdoutPreview.slice(0, 8000),
      stderrPreview: providerEnvelope.stderrPreview.slice(0, 8000),
      providerOutputTruncated: true,
    });
    providerOutputTruncated = true;
  }
  if (!redaction.providerOutputAllowed) {
    providerOutputText = JSON.stringify({
      kind: "run_command_result",
      status: "command_output_redaction_blocked",
      commandPlanId: normalizeString(commandPlan.commandPlanId, ""),
      outputRedacted: true,
      providerContinuationBlocked: true,
      workspaceChangesDetected: Number(workspaceEffects.changedPathCount || 0) > 0,
      workspaceEffectSummaryId: workspaceEffectSummary.effectSummaryId,
      postSideEffectPolicyViolation: postPolicyViolation,
      rawPathsExposed: false,
    });
    providerOutputTruncated = false;
  }
  const providerContinuationBlockedByPolicy = [
    "sensitive_path_changed",
    "app_private_path_changed",
    "vcs_internal_changed",
    "must_not_write_changed_files",
    "workspace_changes_truncated_unknown",
  ].includes(postPolicyViolation);
  if (providerContinuationBlockedByPolicy) {
    providerOutputText = JSON.stringify({
      kind: "run_command_result",
      status: "command_workspace_policy_blocked",
      commandPlanId: normalizeString(commandPlan.commandPlanId, ""),
      providerContinuationBlocked: true,
      workspaceChangesDetected: Number(workspaceEffects.changedPathCount || 0) > 0,
      workspaceEffectSummaryId: workspaceEffectSummary.effectSummaryId,
      postSideEffectPolicyViolation: postPolicyViolation,
      rawPathsExposed: false,
    });
    providerOutputTruncated = false;
  }
  const result = {
    schema: DIRECT_COMMAND_EXECUTION_RESULT_SCHEMA,
    resultId,
    obligationId: obligation.obligationId,
    tool: "run_command",
    status: redaction.providerOutputAllowed ? status : "command_output_redaction_blocked",
    resultClass: redaction.providerOutputAllowed ? status : "command_output_redaction_blocked",
    commandPlanId: normalizeString(commandPlan.commandPlanId, ""),
    displayCommand: normalizeString(commandPlan.displayCommand, ""),
    cwdRelPath: normalizeString(commandPlan.cwdRelPath, ""),
    exitCode,
    signal: normalizeString(executed.signal, ""),
    durationMs: Number(executed.durationMs || 0),
    stdout: {
      textPreview: redaction.providerOutputAllowed ? stdoutPreview.text : "",
      byteCount: Buffer.byteLength(preserveString(executed.stdout)),
      truncated: executed.stdoutTruncated === true || stdoutPreview.truncated,
      hashMode: "none",
    },
    stderr: {
      textPreview: redaction.providerOutputAllowed ? stderrPreview.text : "",
      byteCount: Buffer.byteLength(preserveString(executed.stderr)),
      truncated: executed.stderrTruncated === true || stderrPreview.truncated,
      hashMode: "none",
    },
    workspaceEffects,
    workspaceEffectSummary,
    workspaceEffectSummaryId: workspaceEffectSummary.effectSummaryId,
    workspaceEffectProviderEnvelope,
    postSideEffectPolicyViolation: postPolicyViolation,
    commandOutputRedaction: redaction,
    backendCapabilities: isPlainObject(executed.backendCapabilities) ? executed.backendCapabilities : {},
    backgroundProcessCheck: isPlainObject(executed.backgroundProcessCheck) ? executed.backgroundProcessCheck : {
      supported: false,
      orphanedProcessSuspected: false,
    },
    providerOutputText,
    providerOutputChars: providerOutputText.length,
    providerOutputTruncated,
    providerContinuationBlocked: !redaction.providerOutputAllowed || providerContinuationBlockedByPolicy,
    recordedAt: nowIso(options.nowMs),
    sideEffectExecuted: true,
    commandExecutionState: redaction.providerOutputAllowed
      ? (providerContinuationBlockedByPolicy ? "completed_with_policy_blocked_workspace_changes" : status)
      : "redaction_blocked",
    commandContinuationState: redaction.providerOutputAllowed && !providerContinuationBlockedByPolicy ? "not_built" : "blocked",
    rawWorkspacePathExposed: false,
    rawCommandOutputHashExposed: false,
  };
  const updated = sessionStore.updateToolObligation(options.sessionId, options.turnId, obligation.obligationId, {
    status: "command_result_recorded",
    authorityState: "command_result_recorded",
    executionAllowed: false,
    continuationAllowed: false,
    approvalAvailable: false,
    sideEffectExecuted: true,
    result,
    resultRecordedAt: result.recordedAt,
  }, {
    ...options,
    nextTurnState: redaction.providerOutputAllowed && !providerContinuationBlockedByPolicy ? "continuation_ready" : "failed",
    turnPatch: redaction.providerOutputAllowed && !providerContinuationBlockedByPolicy ? undefined : {
      error: {
        code: providerContinuationBlockedByPolicy ? "command_workspace_policy_blocked" : "command_output_redaction_blocked",
        message: providerContinuationBlockedByPolicy
          ? "Command changed a policy-blocked workspace path; no provider continuation was sent."
          : "Command output was blocked by redaction policy; no provider continuation was sent.",
      },
    },
  });
  return { reused: false, obligation: updated.obligation, result };
}

function buildCommandExecutionContinuationRequest(options = {}) {
  const sessionStore = options.sessionStore;
  if (!sessionStore) throw new Error("Command continuation requires a direct session store.");
  const { obligation } = sessionStore.findToolObligation(options.sessionId, options.turnId, options.obligationId);
  if (!isPlainObject(obligation.result) || obligation.result.schema !== DIRECT_COMMAND_EXECUTION_RESULT_SCHEMA) {
    const error = new Error("Command continuation requires a recorded command result.");
    error.code = "command_result_missing";
    throw error;
  }
  if (obligation.result.providerContinuationBlocked === true) {
    const error = new Error("Command continuation is blocked by command output redaction policy.");
    error.code = normalizeString(obligation.result.postSideEffectPolicyViolation, "") !== "none"
      ? "command_workspace_policy_blocked"
      : "command_output_redaction_blocked";
    throw error;
  }
  const parsed = assertCommandObligation(obligation);
  return {
    schema: DIRECT_COMMAND_EXECUTION_CONTINUATION_REQUEST_SCHEMA,
    continuationId: commandContinuationIdFor(obligation.obligationId, obligation.result.resultId),
    sessionId: normalizeString(options.sessionId, obligation.sessionId),
    turnId: normalizeString(options.turnId, obligation.turnId),
    obligationId: obligation.obligationId,
    createdAt: nowIso(options.nowMs),
    source: {
      fromRecordedResult: true,
      recordedResultId: obligation.result.resultId,
      recordedAt: normalizeString(obligation.result.recordedAt, ""),
      approvedAt: normalizeString(obligation.approvedAt, ""),
    },
    toolResult: {
      obligationId: obligation.obligationId,
      callId: parsed.callId,
      itemId: normalizeString(obligation.sourceItemId, ""),
      toolCallId: parsed.callId,
      name: "run_command",
      providerCallType: parsed.providerCallType,
      outputType: parsed.outputType,
      content: [{ type: parsed.outputType, text: normalizeString(obligation.result.providerOutputText, "") }],
      metadata: {
        resultId: obligation.result.resultId,
        commandPlanId: normalizeString(obligation.result.commandPlanId, ""),
        workspaceEffectSummaryId: normalizeString(obligation.result.workspaceEffectSummaryId, ""),
        status: normalizeString(obligation.result.status, ""),
      },
    },
    safety: {
      fromRecordedResult: true,
      originalRequestRetried: false,
      sideEffectExecuted: true,
      workspaceBackendOnly: true,
      commandExecutedLocally: true,
      workspaceEffectSummaryId: normalizeString(obligation.result.workspaceEffectSummaryId, ""),
      continuationLiveSendEnabled: options.continuationLiveSendEnabled === true,
    },
    requestControls: {
      store: false,
      parallelToolCalls: false,
      toolDeclarations: false,
      toolOutputItem: true,
      previousResponseId: true,
      nativePreviousResponseIdProof: Boolean(normalizeString(obligation.parentResponseId, "")),
    },
    rawAuthHeadersExposed: false,
    rawBackendRequestsExposed: false,
    rawBackendFramesExposed: false,
  };
}

module.exports = {
  DIRECT_COMMAND_EXECUTION_CONTINUATION_REQUEST_SCHEMA,
  DIRECT_COMMAND_EXECUTION_PLAN_SCHEMA,
  DIRECT_COMMAND_EXECUTION_RESULT_SCHEMA,
  MAX_COMMAND_APPROVAL_SUMMARY_CHARS,
  MAX_COMMAND_OUTPUT_PREVIEW_CHARS,
  MAX_COMMAND_TIMEOUT_MS,
  RUN_COMMAND_TOOL_NAMES,
  approveCommandExecutionObligation,
  assertCommandObligation,
  buildCommandExecutionContinuationRequest,
  decideCommandExecutionObligation,
  executeApprovedCommandExecutionObligation,
  planCommandExecutionObligation,
};
