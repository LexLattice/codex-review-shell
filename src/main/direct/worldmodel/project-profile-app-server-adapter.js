"use strict";

const { canonicalJson, sha256 } = require("../meta-session/digest");
const {
  PROJECT_PROFILE_RUNTIME_LAUNCH_READBACK_SCHEMA,
  admitProjectProfileResolutionAgainstContext,
  validateProjectProfileRuntimeLaunchReadback,
} = require("./project-profile-resolution");

const MANAGED_APP_SERVER_PROJECT_PROFILE_CONFIGURATION_SCHEMA =
  "direct_managed_app_server_project_profile_configuration@1";
const PROJECT_PROFILE_LAUNCH_DECISION_SCHEMA = "direct_project_profile_launch_decision@1";
const PROJECT_PROFILE_LAUNCH_RECEIPT_SCHEMA = "direct_project_profile_launch_receipt@1";

function cleanString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function fail(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  throw error;
}

function exactResolutionRef(resolution) {
  return {
    kind: "direct_project_profile_resolution",
    id: `${resolution.projectId}@${resolution.projectRevision}`,
    digest: resolution.resolutionDigest,
    label: "Project profile resolution",
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function resolutionInputRefsDigest(inputRefs) {
  return sha256(
    `direct-project-profile-resolution-input-refs@1\0${canonicalJson(inputRefs, { omitDigestFields: false })}`,
  );
}

function configurationDigest(configuration) {
  return sha256(
    `direct-managed-app-server-project-profile-configuration@1\0${canonicalJson(configuration, { omitDigestFields: false })}`,
  );
}

function sameRef(left, right) {
  return left?.kind === right?.kind && left?.id === right?.id && left?.digest === right?.digest;
}

function exactDigest(domain, value) {
  return sha256(`${domain}\0${canonicalJson(value, { omitDigestFields: false })}`);
}

function cloneParams(params) {
  if (!params || typeof params !== "object" || Array.isArray(params)) return {};
  return { ...params, ...(params.config && typeof params.config === "object" && !Array.isArray(params.config) ? { config: { ...params.config } } : {}) };
}

function requireConfiguration(configuration) {
  if (!configuration || typeof configuration !== "object") fail("direct_project_profile_launch_configuration_required");
  if (configuration.schema !== MANAGED_APP_SERVER_PROJECT_PROFILE_CONFIGURATION_SCHEMA) fail("direct_project_profile_launch_configuration_schema_mismatch");
  if (!cleanString(configuration.projectId) || !Number.isInteger(configuration.projectRevision)) fail("direct_project_profile_launch_configuration_identity_invalid");
  if (!configuration.resolutionRef || !configuration.selectionTraceRef || !configuration.bindingRef || !cleanString(configuration.resolutionInputRefsDigest)) fail("direct_project_profile_launch_configuration_binding_missing");
  const expected = configurationDigest({ ...configuration, configurationDigest: undefined });
  if (configuration.configurationDigest !== expected) fail("direct_project_profile_launch_configuration_digest_mismatch");
  const configured = configuration.configuredProfile;
  if (!configured?.modelProfileRef?.id || !configured?.reasoningEffortProfileRef?.id || !configured?.homeEnvironmentRef?.id || !configured?.projectManagerProfileRef?.id || !cleanString(configuration.requestedProfile?.forkTurns)) fail("direct_project_profile_launch_configuration_profile_missing");
  for (const key of ["authorityGranted", "spawnAllowed", "toolUseAllowed", "workspaceMutationAllowed"]) if (configuration[key] !== false) fail("direct_project_profile_authority_leak", `configuration.${key}`);
  return configuration;
}

function rejectRelabelledValue(value, expected, field) {
  if (value !== undefined && value !== null && cleanString(value) && cleanString(value) !== expected) {
    fail("direct_project_profile_launch_request_relabelled", field);
  }
}

function launchResponseValue(result, keys = []) {
  const source = result && typeof result === "object" ? result : {};
  for (const key of keys) {
    const parts = key.split(".");
    let value = source;
    for (const part of parts) value = value && typeof value === "object" ? value[part] : undefined;
    const text = cleanString(value);
    if (text) return text;
  }
  return "";
}

function buildManagedAppServerProjectProfileConfiguration(launchInput, options = {}) {
  if (launchInput === undefined || launchInput === null) return null;
  if (!launchInput || typeof launchInput !== "object" || Array.isArray(launchInput)) {
    fail("direct_project_profile_launch_input_invalid");
  }
  const resolution = launchInput.resolution;
  const context = launchInput.context;
  if (!resolution || !context) fail("direct_project_profile_launch_input_incomplete");
  admitProjectProfileResolutionAgainstContext(resolution, context, options);
  if (resolution.status !== "bound" || !resolution.binding) {
    fail("direct_project_profile_launch_binding_required", resolution.status || "unknown");
  }
  const expectedProjectId = cleanString(options.projectId);
  if (expectedProjectId && resolution.projectId !== expectedProjectId) {
    fail("direct_project_profile_launch_project_mismatch", expectedProjectId);
  }

  const binding = resolution.binding;
  if (
    !sameRef(resolution.requestedTruth.modelProfileRef, binding.defaultModelProfileRef) ||
    !sameRef(resolution.requestedTruth.reasoningEffortProfileRef, binding.reasoningEffortProfileRef) ||
    resolution.requestedTruth.forkTurns !== resolution.effectiveTruth?.forkTurns
  ) {
    fail("direct_project_profile_launch_requested_binding_mismatch");
  }
  const configuration = {
    schema: MANAGED_APP_SERVER_PROJECT_PROFILE_CONFIGURATION_SCHEMA,
    projectId: resolution.projectId,
    projectRevision: resolution.projectRevision,
    resolutionRef: exactResolutionRef(resolution),
    selectionTraceRef: resolution.traceRef,
    bindingRef: resolution.bindingRef,
    resolutionInputRefs: resolution.inputRefs,
    resolutionInputRefsDigest: resolutionInputRefsDigest(resolution.inputRefs),
    requestedProfile: {
      modelProfileRef: binding.defaultModelProfileRef,
      reasoningEffortProfileRef: binding.reasoningEffortProfileRef,
      forkTurns: resolution.effectiveTruth.forkTurns,
    },
    configuredProfile: {
      modelProfileRef: binding.defaultModelProfileRef,
      reasoningEffortProfileRef: binding.reasoningEffortProfileRef,
      homeEnvironmentRef: binding.homeEnvironmentRef,
      projectManagerProfileRef: binding.projectManagerProfileRef,
      allowedWorkerProfileRefs: binding.allowedWorkerProfileRefs,
      preferredSpecialistRoutes: binding.preferredSpecialistRoutes,
      concurrencyLimit: binding.concurrencyLimit,
      delegationDepthLimit: binding.delegationDepthLimit,
    },
    specialistPosture: binding.preferredSpecialistRoutes.length
      ? "admitted_preferred_routes"
      : "none_selected",
    requestedStatus: "admitted",
    configuredStatus: "managed_launch_descriptor_configured",
    providerAcceptedStatus: "not_yet_observed",
    runtimeVerifiedStatus: "not_yet_observed",
    authorityGranted: false,
    spawnAllowed: false,
    toolUseAllowed: false,
    workspaceMutationAllowed: false,
  };
  configuration.configurationDigest = configurationDigest(configuration);
  return configuration;
}

// This is the only per-request application point.  The managed app-server
// process flags select its protocol surface; they do not set a thread or turn
// model/effort.  Do not add metadata-only fields here as a substitute for an
// app-server protocol parameter.
function prepareProjectProfileLaunchRequest(configuration, launch = {}) {
  if (!configuration) return { params: cloneParams(launch.params), launchDecision: null };
  requireConfiguration(configuration);
  const method = cleanString(launch.method);
  if (method !== "thread/start" && method !== "turn/start") return { params: cloneParams(launch.params), launchDecision: null };
  const connectionId = cleanString(launch.connectionId);
  const requestId = cleanString(launch.requestId);
  if (!connectionId || !requestId) fail("direct_project_profile_launch_request_identity_missing");
  const params = cloneParams(launch.params);
  const configured = configuration.configuredProfile;
  const model = configured.modelProfileRef.id;
  const effort = configured.reasoningEffortProfileRef.id;

  rejectRelabelledValue(params.model, model, "model");
  rejectRelabelledValue(params.effort, effort, "effort");
  rejectRelabelledValue(params.reasoningEffort, effort, "reasoningEffort");
  rejectRelabelledValue(params.config?.model_reasoning_effort, effort, "config.model_reasoning_effort");
  for (const field of ["projectProfile", "projectProfileConfiguration", "homeEnvironmentId", "environmentId", "profileId", "executionProfileId"]) {
    if (params[field] !== undefined) fail("direct_project_profile_launch_request_relabelled", field);
  }

  // `thread/start` supports the sticky config spelling.  `turn/start` has its
  // own effective-effort field.  We bind both because a caller may turn an
  // existing thread and the profile must still be applied at that real request.
  params.model = model;
  if (method === "thread/start") {
    params.config = { ...(params.config || {}), model_reasoning_effort: effort };
    delete params.effort;
    delete params.reasoningEffort;
  } else {
    params.effort = effort;
    delete params.reasoningEffort;
  }

  const exactConfiguredParams = {
    method,
    model,
    reasoningEffort: effort,
    homeEnvironmentId: configured.homeEnvironmentRef.id,
    executionProfileId: configured.projectManagerProfileRef.id,
    forkTurns: configuration.requestedProfile.forkTurns,
    protocolParams: method === "thread/start"
      ? { model, config: { model_reasoning_effort: effort } }
      : { model, effort },
  };
  const decision = {
    schema: PROJECT_PROFILE_LAUNCH_DECISION_SCHEMA,
    launchDecisionId: `project_profile_launch_${sha256(`${connectionId}\0${requestId}\0${configuration.configurationDigest}`).slice(-24)}`,
    connectionId,
    requestId,
    method,
    projectId: configuration.projectId,
    projectRevision: configuration.projectRevision,
    resolutionRef: configuration.resolutionRef,
    bindingRef: configuration.bindingRef,
    selectionTraceRef: configuration.selectionTraceRef,
    resolutionInputRefsDigest: configuration.resolutionInputRefsDigest,
    configurationDigest: configuration.configurationDigest,
    exactConfiguredParams,
    requestParamsDigest: exactDigest("direct-project-profile-launch-request-params@1", params),
    authorityGranted: false,
    spawnAllowed: false,
    toolUseAllowed: false,
    workspaceMutationAllowed: false,
  };
  decision.launchDecisionDigest = exactDigest("direct-project-profile-launch-decision@1", decision);
  return { params, launchDecision: decision };
}

function registerProjectProfileLaunchResponse(launchDecision, result) {
  if (!launchDecision) return null;
  const response = result && typeof result === "object" ? result : {};
  const receipt = {
    schema: PROJECT_PROFILE_LAUNCH_RECEIPT_SCHEMA,
    receiptId: `project_profile_receipt_${sha256(`${launchDecision.launchDecisionDigest}\0${canonicalJson(response, { omitDigestFields: false })}`).slice(-24)}`,
    launchDecisionId: launchDecision.launchDecisionId,
    launchDecisionDigest: launchDecision.launchDecisionDigest,
    connectionId: launchDecision.connectionId,
    requestId: launchDecision.requestId,
    method: launchDecision.method,
    projectId: launchDecision.projectId,
    projectRevision: launchDecision.projectRevision,
    resolutionRef: launchDecision.resolutionRef,
    bindingRef: launchDecision.bindingRef,
    selectionTraceRef: launchDecision.selectionTraceRef,
    resolutionInputRefsDigest: launchDecision.resolutionInputRefsDigest,
    configurationDigest: launchDecision.configurationDigest,
    exactConfiguredParams: launchDecision.exactConfiguredParams,
    requestParamsDigest: launchDecision.requestParamsDigest,
    taskName: launchResponseValue(response, ["taskName", "task.name"]),
    threadId: launchResponseValue(response, ["thread.id", "threadId"]),
    turnId: launchResponseValue(response, ["turn.id", "turnId"]),
    runId: launchResponseValue(response, ["run.id", "runId", "turn.runId"]),
    launchId: launchResponseValue(response, ["launch.id", "launchId", "run.launchId"]),
    responseDigest: exactDigest("direct-project-profile-launch-response@1", response),
    providerAcceptedStatus: "not_yet_observed",
    runtimeVerifiedStatus: "not_yet_observed",
    consumed: false,
    authorityGranted: false,
    spawnAllowed: false,
    toolUseAllowed: false,
    workspaceMutationAllowed: false,
  };
  receipt.receiptDigest = exactDigest("direct-project-profile-launch-receipt@1", receipt);
  return receipt;
}

function canonicalRuntimeProfile(activity = {}) {
  const method = cleanString(activity.method);
  if (method !== "item/started" && method !== "item/completed") return null;
  const params = activity.params && typeof activity.params === "object" ? activity.params : {};
  const item = params.item && typeof params.item === "object" ? params.item : {};
  const itemType = cleanString(item.type);
  if (["childRuntime", "childRuntimeProfile"].includes(itemType)) {
    if (item.observed !== true || cleanString(item.source || item.providerReadbackSource) !== "managed_app_server_child_runtime_item") return { item, params, runtime: null };
    return { item, params, runtime: item };
  }
  const runtime = item.childRuntimeProfile || item.child_runtime_profile || item.runtimeProfile || item.runtime_profile;
  if (!["childActivity", "collabAgentToolCall"].includes(itemType)) return null;
  if (!runtime || typeof runtime !== "object") return { item, params, runtime: null };
  if (
    runtime.observed !== true ||
    cleanString(runtime.source || runtime.providerReadbackSource) !== "managed_app_server_child_runtime_item"
  ) {
    return { item, params, runtime: null };
  }
  return { item, params, runtime };
}

function buildProjectProfileRuntimeLaunchObservation(configuration, activity = {}, options = {}) {
  if (!configuration) return null;
  requireConfiguration(configuration);
  const canonical = canonicalRuntimeProfile(activity);
  if (!canonical) return null;
  const { item, runtime } = canonical;
  const pending = (reason = "runtime_profile_fields_absent") => ({
    requestedStatus: configuration.requestedStatus,
    configuredStatus: configuration.configuredStatus,
    providerAcceptedStatus: configuration.providerAcceptedStatus,
    runtimeVerifiedStatus: "not_yet_observed",
    reason,
    readback: null,
    authorityGranted: false,
  });
  if (!runtime) return pending();

  const actual = {
    requestId: cleanString(runtime.requestId || runtime.request_id || runtime.parentRequestId || runtime.parent_request_id),
    projectId: cleanString(runtime.projectId || runtime.project_id),
    projectRevision: cleanString(runtime.projectRevision || runtime.project_revision),
    taskName: cleanString(runtime.taskName || runtime.task_name || item.taskName || item.task_name),
    threadId: cleanString(runtime.threadId || runtime.thread_id || item.childThreadId || item.child_thread_id),
    turnId: cleanString(runtime.turnId || runtime.turn_id || item.turnId || item.turn_id),
    runId: cleanString(runtime.runId || runtime.run_id || runtime.agentRunId || runtime.agent_run_id),
    launchId: cleanString(runtime.launchId || runtime.launch_id || runtime.runId || runtime.run_id),
    model: cleanString(runtime.model),
    reasoningEffort: cleanString(runtime.reasoningEffort || runtime.reasoning_effort),
    environmentId: cleanString(runtime.environmentId || runtime.environment_id),
    profileId: cleanString(runtime.profileId || runtime.profile_id || runtime.executionProfileId || runtime.execution_profile_id),
    forkTurns: cleanString(runtime.forkTurns || runtime.fork_turns),
  };
  const runtimeConfigurationDigest = cleanString(runtime.configurationDigest || runtime.configuration_digest || runtime.projectProfileConfigurationDigest || runtime.project_profile_configuration_digest);
  if (Object.values(actual).some((value) => !value) || !runtimeConfigurationDigest) return pending();

  const expected = configuration.configuredProfile;
  if (
    actual.projectId !== configuration.projectId ||
    actual.projectRevision !== String(configuration.projectRevision) ||
    actual.model !== expected.modelProfileRef.id ||
    actual.reasoningEffort !== expected.reasoningEffortProfileRef.id ||
    actual.environmentId !== expected.homeEnvironmentRef.id ||
    actual.profileId !== expected.projectManagerProfileRef.id ||
    actual.forkTurns !== configuration.requestedProfile.forkTurns
  ) {
    return pending("runtime_profile_mismatch");
  }

  const receipts = options.launchReceipts instanceof Map
    ? [...options.launchReceipts.values()]
    : (Array.isArray(options.launchReceipts) ? options.launchReceipts : []);
  const receipt = receipts.find((entry) =>
    entry && entry.consumed !== true &&
    entry.connectionId === cleanString(options.connectionId) &&
    entry.requestId === actual.requestId &&
    entry.taskName === actual.taskName &&
    entry.threadId === actual.threadId &&
    entry.turnId === actual.turnId &&
    entry.runId === actual.runId &&
    entry.launchId === actual.launchId &&
    entry.configurationDigest === runtimeConfigurationDigest &&
    entry.configurationDigest === configuration.configurationDigest,
  );
  if (!receipt) return pending("runtime_launch_unregistered_or_unmatched");
  receipt.consumed = true;
  receipt.providerAcceptedStatus = "canonical_launch_response_observed";
  receipt.runtimeVerifiedStatus = "runtime_verified";

  const readback = {
    schema: PROJECT_PROFILE_RUNTIME_LAUNCH_READBACK_SCHEMA,
    readbackId: cleanString(runtime.readbackId || runtime.readback_id) ||
      `project_profile_runtime_${sha256(`${receipt.receiptDigest}\0${actual.taskName}\0${actual.threadId}\0${actual.runId}`).slice(-20)}`,
    launchId: actual.launchId,
    taskName: actual.taskName,
    threadId: actual.threadId,
    turnId: actual.turnId,
    runId: actual.runId,
    connectionId: receipt.connectionId,
    requestId: receipt.requestId,
    launchDecisionId: receipt.launchDecisionId,
    launchDecisionDigest: receipt.launchDecisionDigest,
    launchReceiptId: receipt.receiptId,
    launchReceiptDigest: receipt.receiptDigest,
    configurationDigest: receipt.configurationDigest,
    requestParamsDigest: receipt.requestParamsDigest,
    responseDigest: receipt.responseDigest,
    projectId: configuration.projectId,
    projectRevision: configuration.projectRevision,
    resolutionRef: configuration.resolutionRef,
    resolutionInputRefsDigest: configuration.resolutionInputRefsDigest,
    bindingRef: configuration.bindingRef,
    selectionTraceRef: configuration.selectionTraceRef,
    modelProfileRef: expected.modelProfileRef,
    reasoningEffortProfileRef: expected.reasoningEffortProfileRef,
    homeEnvironmentRef: expected.homeEnvironmentRef,
    executionProfileRef: expected.projectManagerProfileRef,
    observedModel: actual.model,
    observedReasoningEffort: actual.reasoningEffort,
    observedEnvironmentId: actual.environmentId,
    observedProfileId: actual.profileId,
    forkTurns: actual.forkTurns,
    providerReadbackSource: "managed_app_server_child_runtime_item",
    childRuntimeObserved: true,
    authorityGranted: false,
    spawnAllowed: false,
    toolUseAllowed: false,
    workspaceMutationAllowed: false,
    observedAt: cleanString(runtime.observedAt || runtime.observed_at) ||
      (typeof options.now === "function" ? new Date(options.now()).toISOString() : new Date(options.now || Date.now()).toISOString()),
  };
  readback.readbackDigest = sha256(
    `direct-project-profile-runtime-launch-readback@1\0${canonicalJson(readback, { omitDigestFields: false })}`,
  );
  validateProjectProfileRuntimeLaunchReadback(readback);
  return {
    requestedStatus: configuration.requestedStatus,
    configuredStatus: configuration.configuredStatus,
    providerAcceptedStatus: "canonical_launch_response_observed",
    runtimeVerifiedStatus: "runtime_verified",
    reason: "canonical_runtime_profile_observed",
    readback,
    authorityGranted: false,
  };
}

module.exports = {
  MANAGED_APP_SERVER_PROJECT_PROFILE_CONFIGURATION_SCHEMA,
  PROJECT_PROFILE_LAUNCH_DECISION_SCHEMA,
  PROJECT_PROFILE_LAUNCH_RECEIPT_SCHEMA,
  buildManagedAppServerProjectProfileConfiguration,
  prepareProjectProfileLaunchRequest,
  registerProjectProfileLaunchResponse,
  buildProjectProfileRuntimeLaunchObservation,
  resolutionInputRefsDigest,
};
