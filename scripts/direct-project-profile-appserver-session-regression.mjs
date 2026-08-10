#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { WebSocketServer } = require("ws");
const { canonicalJson, sha256 } = require("../src/main/direct/meta-session/digest");
const { CodexSurfaceSession } = require("../src/main/codex-surface-session");

const ref = (kind, id) => ({ kind, id, digest: sha256(`${kind}:${id}`), label: id, rawTextIncluded: false, rawPathIncluded: false, rawSecretIncluded: false });
const configuration = {
  schema: "direct_managed_app_server_project_profile_configuration@1",
  projectId: "profile_session_project",
  projectRevision: 8,
  resolutionRef: ref("direct_project_profile_resolution", "profile_session_project@8"),
  selectionTraceRef: ref("project_profile_resolution_trace", "trace"),
  bindingRef: ref("project_execution_profile_binding", "binding"),
  resolutionInputRefs: {},
  resolutionInputRefsDigest: sha256("inputs"),
  requestedProfile: { modelProfileRef: ref("model_profile", "model"), reasoningEffortProfileRef: ref("reasoning_effort_profile", "high"), forkTurns: "none" },
  configuredProfile: {
    modelProfileRef: ref("model_profile", "model"),
    reasoningEffortProfileRef: ref("reasoning_effort_profile", "high"),
    homeEnvironmentRef: ref("direct_environment", "env_wsl"),
    projectManagerProfileRef: ref("project_execution_profile", "pm_wsl"),
    allowedWorkerProfileRefs: [], preferredSpecialistRoutes: [], concurrencyLimit: 1, delegationDepthLimit: 0,
  },
  specialistPosture: "none_selected",
  requestedStatus: "admitted",
  configuredStatus: "managed_launch_descriptor_configured",
  providerAcceptedStatus: "not_yet_observed",
  runtimeVerifiedStatus: "not_yet_observed",
  authorityGranted: false, spawnAllowed: false, toolUseAllowed: false, workspaceMutationAllowed: false,
};
configuration.configurationDigest = sha256(`direct-managed-app-server-project-profile-configuration@1\0${canonicalJson(configuration, { omitDigestFields: false })}`);

const server = new WebSocketServer({ port: 0 });
await new Promise((resolve) => server.once("listening", resolve));
const port = server.address().port;
const received = [];
server.on("connection", (socket) => socket.on("message", (raw) => {
  const request = JSON.parse(String(raw));
  received.push(request);
  if (request.method !== "turn/start") return;
  socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {
    taskName: "profile_task", thread: { id: "thread_1" }, turn: { id: "turn_1", runId: "run_1" }, launchId: "launch_1",
  } }));
  socket.send(JSON.stringify({ jsonrpc: "2.0", method: "item/completed", params: { item: {
    type: "childRuntimeProfile", observed: true, source: "managed_app_server_child_runtime_item",
    requestId: String(request.id), projectId: configuration.projectId, projectRevision: String(configuration.projectRevision), taskName: "profile_task", threadId: "thread_1", turnId: "turn_1", runId: "run_1", launchId: "launch_1",
    configurationDigest: configuration.configurationDigest, model: "model", reasoningEffort: "high", environmentId: "env_wsl", profileId: "pm_wsl", forkTurns: "none",
  } } }));
}));

const events = [];
const session = new CodexSurfaceSession({ isDestroyed: () => true });
session.on("event", (event) => events.push(event));
await session.connect({ wsUrl: `ws://127.0.0.1:${port}`, projectId: configuration.projectId, projectProfileConfiguration: configuration });

await assert.rejects(
  session.request("turn/start", { threadId: "thread_1", model: "caller_model", effort: "high" }),
  (error) => error?.code === "direct_project_profile_launch_request_relabelled",
);
await session.request("turn/start", { threadId: "thread_1", model: "model", effort: "high" });
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(received.length, 1, "relabelled calls must be rejected before the provider boundary");
assert.equal(received[0].params.model, "model");
assert.equal(received[0].params.effort, "high");
const verified = events.find((event) => event.type === "project-profile-runtime-status" && event.runtimeVerifiedStatus === "runtime_verified");
assert(verified, "only the response-bound canonical notification may verify the profile runtime tuple");
assert.equal(verified.readback.requestId, String(received[0].id));
assert.equal(verified.readback.threadId, "thread_1");
assert.equal(verified.readback.turnId, "turn_1");
assert.equal(verified.readback.runId, "run_1");
for (const key of ["authorityGranted", "spawnAllowed", "toolUseAllowed", "workspaceMutationAllowed"]) assert.equal(verified.readback[key], false);

await session.dispose({ silent: true });
await new Promise((resolve) => server.close(resolve));
console.log("direct-project-profile-appserver-session-regression: ok");
