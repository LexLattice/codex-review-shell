#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DirectThreadHarnessGrantStore,
} = require("../src/main/direct/authority/direct-thread-harness-grant");
const {
  DirectStatefulExecSessionManager,
} = require("../src/main/direct/tools/stateful-exec-session");
const {
  DirectFullAccessLocalEnvironmentExecutor,
} = require("../src/main/direct/tools/full-access-local-environment");
const {
  approveReadOnlyToolObligation,
  projectReadResult,
} = require("../src/main/direct/tools/read-only-authority");
const { DirectSessionStore } = require("../src/main/direct/session/session-store");
const { DirectLiveTextController } = require("../src/main/direct/controller/live-text-controller");

const node = process.execPath;
const continuationSse = [
  "event: response.created",
  "data: {\"response\":{\"id\":\"resp_stateful_exec_done\",\"model\":\"gpt-5.6-sol\"}}",
  "",
  "event: response.output_text.delta",
  "data: {\"item_id\":\"msg_stateful_exec_done\",\"delta\":\"Stateful process session received.\"}",
  "",
  "event: response.completed",
  "data: {\"response\":{\"id\":\"resp_stateful_exec_done\",\"status\":\"completed\"}}",
  "",
].join("\n");

function toolCallSse(responseId, name, args) {
  const itemId = `${responseId}_${name}`;
  const callId = `call_${responseId}_${name}`;
  const argumentsJson = JSON.stringify(args);
  return [
    "event: response.created",
    `data: ${JSON.stringify({ response: { id: responseId, model: "gpt-5.6-sol" } })}`,
    "",
    "event: response.output_item.added",
    `data: ${JSON.stringify({ item: { id: itemId, type: "function_call", call_id: callId, name } })}`,
    "",
    "event: response.function_call_arguments.delta",
    `data: ${JSON.stringify({ item_id: itemId, call_id: callId, delta: argumentsJson })}`,
    "",
    "event: response.output_item.done",
    `data: ${JSON.stringify({ item: { id: itemId, type: "function_call", call_id: callId, name, arguments: argumentsJson } })}`,
    "",
    "event: response.completed",
    `data: ${JSON.stringify({ response: { id: responseId, status: "completed" } })}`,
    "",
  ].join("\n");
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error?.code === code, `expected ${code}`);
}

async function expectCodeAsync(fn, code) {
  await assert.rejects(fn, (error) => error?.code === code, `expected ${code}`);
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "direct-full-local-harness-"));
  const workspace = path.join(root, "workspace");
  const outside = path.join(root, "outside");
  await fs.mkdir(workspace);
  await fs.mkdir(outside);
  const outsideFile = path.join(outside, "fixture.txt");
  const outsideEnvFile = path.join(outside, ".env.synthetic");
  const fakeSecret = "FAKE_TOKEN=fake_token_value_123456\n";
  await fs.writeFile(outsideFile, "before\n", "utf8");
  await fs.writeFile(outsideEnvFile, fakeSecret, "utf8");
  const store = new DirectThreadHarnessGrantStore({ rootDir: path.join(root, "authority") });
  const projectId = "project_full_local_harness";
  const taskId = "task_full_local_harness";
  const environment = { environmentId: "environment_full_local_harness", kind: "local", bindingDigest: "sha256:full-local-harness" };
  const grant = store.issueFullAccess({
    taskId,
    threadId: taskId,
    projectId,
    executionEnvironment: environment,
    capabilities: ["read_file", "apply_patch", "exec_command", "write_stdin"],
  });
  const manager = new DirectStatefulExecSessionManager({
    grantStore: store,
    workspaceRootResolver: () => workspace,
    idleTimeoutMs: 2_000,
    hardTimeoutMs: 5_000,
  });
  const binding = {
    taskId,
    threadId: taskId,
    projectId,
    executionEnvironmentDigest: grant.executionEnvironmentDigest,
    harnessGrant: grant,
    grantId: grant.grantId,
  };
  const localExecutor = new DirectFullAccessLocalEnvironmentExecutor({
    grantStore: store,
    workspaceRootResolver: () => workspace,
  });

  const outsideRead = await localExecutor.request(binding, "readFile", {
    relPath: outsideFile,
    maxBytes: 1024,
  });
  assert.equal(outsideRead.source, "direct_full_access_local_environment");
  assert.equal(outsideRead.text, "before\n", "full-access read should use the selected local environment outside the workspace");
  const outsideEnvRead = await localExecutor.request(binding, "readFile", {
    relPath: outsideEnvFile,
    maxBytes: 1024,
  });
  const outsideEnvProviderResult = projectReadResult(
    outsideEnvRead,
    { obligationId: "full_access_env_read", name: "read_file", sessionId: taskId, turnId: "full_access_env_turn" },
    "",
    undefined,
    { fullAccess: true },
  );
  assert(outsideEnvProviderResult.providerOutputText.includes(fakeSecret.trim()), "full-access read should deliver synthetic token-shaped content to the provider result");
  assert.equal(outsideEnvProviderResult.toolResultRedaction.status, "bypassed");
  const outsidePatch = `*** Begin Patch\n*** Update File: ${outsideFile}\n@@ -1,1 +1,1 @@\n-before\n+after\n*** End Patch`;
  const outsidePatchPlan = await localExecutor.request(binding, "applyPatch", {
    mode: "dryRun",
    patch: outsidePatch,
  });
  assert.equal(outsidePatchPlan.status, "dry_run_passed");
  const outsidePatchResult = await localExecutor.request(binding, "applyPatch", {
    mode: "apply",
    patch: outsidePatch,
  });
  assert.equal(outsidePatchResult.status, "applied");
  assert.equal(await fs.readFile(outsideFile, "utf8"), "after\n", "full-access patch should mutate the selected local environment outside the workspace");
  const outsideEnvPatch = `*** Begin Patch\n*** Update File: ${outsideEnvFile}\n@@ -1,1 +1,1 @@\n-${fakeSecret.trim()}\n+FAKE_TOKEN=fake_token_replaced_123456\n*** End Patch`;
  const outsideEnvPatchResult = await localExecutor.request(binding, "applyPatch", {
    mode: "apply",
    patch: outsideEnvPatch,
  });
  assert.equal(outsideEnvPatchResult.status, "applied", "full-access patch should allow synthetic .env-style files");
  assert.equal(await fs.readFile(outsideEnvFile, "utf8"), "FAKE_TOKEN=fake_token_replaced_123456\n");

  const staleDeleteFile = path.join(outside, "stale-delete.txt");
  await fs.writeFile(staleDeleteFile, "delete-first\ndelete-second\n", "utf8");
  const staleDeletePatch = `--- ${staleDeleteFile}\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-delete-first\n-stale-second\n`;
  for (const mode of ["dryRun", "apply"]) {
    await expectCodeAsync(() => localExecutor.request(binding, "applyPatch", { mode, patch: staleDeletePatch }), "direct_full_access_patch_conflict");
    assert.equal(await fs.readFile(staleDeleteFile, "utf8"), "delete-first\ndelete-second\n", "stale delete must not mutate the target");
  }

  const hunkFreeDeleteFile = path.join(outside, "hunk-free-delete.txt");
  await fs.writeFile(hunkFreeDeleteFile, "hunk-free\n", "utf8");
  const hunkFreeDeletePatch = `--- ${hunkFreeDeleteFile}\n+++ /dev/null\n`;
  for (const mode of ["dryRun", "apply"]) {
    await expectCodeAsync(() => localExecutor.request(binding, "applyPatch", { mode, patch: hunkFreeDeletePatch }), "direct_full_access_patch_invalid");
    assert.equal(await fs.readFile(hunkFreeDeleteFile, "utf8"), "hunk-free\n", "hunk-free delete must not mutate the target");
  }

  const partialDeleteFile = path.join(outside, "partial-delete.txt");
  await fs.writeFile(partialDeleteFile, "keep-this\ndelete-this\n", "utf8");
  const partialDeletePatch = `--- ${partialDeleteFile}\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-delete-this\n`;
  for (const mode of ["dryRun", "apply"]) {
    await expectCodeAsync(() => localExecutor.request(binding, "applyPatch", { mode, patch: partialDeletePatch }), "direct_full_access_patch_conflict");
    assert.equal(await fs.readFile(partialDeleteFile, "utf8"), "keep-this\ndelete-this\n", "partial delete must not mutate the target");
  }

  const validDeleteFile = path.join(outside, "valid-delete.txt");
  await fs.writeFile(validDeleteFile, "remove-this\ncompletely\n", "utf8");
  const validDeletePatch = `--- ${validDeleteFile}\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-remove-this\n-completely\n`;
  const validDeletePlan = await localExecutor.request(binding, "applyPatch", { mode: "dryRun", patch: validDeletePatch });
  assert.equal(validDeletePlan.status, "dry_run_passed");
  const validDeleteResult = await localExecutor.request(binding, "applyPatch", { mode: "apply", patch: validDeletePatch });
  assert.equal(validDeleteResult.status, "applied");
  await assert.rejects(fs.access(validDeleteFile), /ENOENT/, "a validated full-file delete should unlink the target");

  const oversizedPatchFile = path.join(outside, "oversized-patch-target.txt");
  const oversizedPatchSize = 384 * 1024 + 1;
  await fs.writeFile(oversizedPatchFile, "oversized-prefix");
  await fs.truncate(oversizedPatchFile, oversizedPatchSize);
  const oversizedPatch = `--- ${oversizedPatchFile}\n+++ ${oversizedPatchFile}\n@@ -1,1 +1,1 @@\n-oversized-prefix\n+should-not-apply\n`;
  for (const mode of ["dryRun", "apply"]) {
    await expectCodeAsync(() => localExecutor.request(binding, "applyPatch", { mode, patch: oversizedPatch }), "direct_full_access_patch_target_oversized");
    const oversizedStat = await fs.stat(oversizedPatchFile);
    assert.equal(oversizedStat.size, oversizedPatchSize, "oversized patch rejection must preserve target size");
    assert.equal((await fs.readFile(oversizedPatchFile, "utf8")).slice(0, 16), "oversized-prefix", "oversized patch rejection must preserve target content");
  }

  const sparseFile = path.join(outside, "large-sparse.bin");
  const sparseSize = 64 * 1024 * 1024;
  await fs.writeFile(sparseFile, "sparse-prefix");
  await fs.truncate(sparseFile, sparseSize);
  const sparseRead = await localExecutor.request(binding, "readFile", { relPath: sparseFile, maxBytes: 8 });
  assert.equal(sparseRead.size, sparseSize);
  assert.equal(sparseRead.truncated, true);
  assert.equal(sparseRead.binary, false);
  assert.equal(sparseRead.text, "sparse-p");
  assert(sparseRead.text.length <= 8, "bounded read must return no more than maxBytes");

  const success = manager.start({
    ...binding,
    command: node,
    args: ["-e", "process.stdout.write(process.cwd() + ':' + process.env.DIRECT_FIXTURE_ENV)"],
    cwd: ".",
    env: { DIRECT_FIXTURE_ENV: "bound" },
    stdinPolicy: "disabled",
    outputBudgetChars: 256,
    providerResultBudgetChars: 128,
  });
  assert.equal(success.status, "running");
  assert.equal(success.sessionState, "running");
  const successResult = await manager.wait({ ...binding, sessionId: success.sessionId });
  assert.equal(successResult.status, "completed");
  assert.equal(successResult.exitCode, 0);
  assert(successResult.stdoutPreview.includes(`${workspace}:bound`), "selected cwd/environment should reach the child");

  const implicitSessionOne = manager.start({
    ...binding,
    command: node,
    args: ["-e", "process.exit(0)"],
    stdinPolicy: "disabled",
  });
  const implicitResultOne = await manager.wait({ ...binding, sessionId: implicitSessionOne.sessionId });
  assert.equal(implicitResultOne.status, "completed");
  assert.match(implicitSessionOne.sessionId, /^exec_session_[0-9a-f]{32}$/);
  const implicitSessionTwo = manager.start({
    ...binding,
    command: node,
    args: ["-e", "process.exit(0)"],
    stdinPolicy: "disabled",
  });
  const implicitResultTwo = await manager.wait({ ...binding, sessionId: implicitSessionTwo.sessionId });
  assert.equal(implicitResultTwo.status, "completed");
  assert.notEqual(implicitSessionOne.sessionId, implicitSessionTwo.sessionId, "implicit process sessions must receive fresh identities");
  const explicitSession = manager.start({
    ...binding,
    execSessionId: "explicit-session-reuse-fixture",
    command: node,
    args: ["-e", "process.exit(0)"],
    stdinPolicy: "disabled",
  });
  assert.equal(explicitSession.sessionId, "explicit-session-reuse-fixture");
  await manager.wait({ ...binding, sessionId: explicitSession.sessionId });
  expectCode(() => manager.start({
    ...binding,
    execSessionId: "explicit-session-reuse-fixture",
    command: node,
    args: ["-e", "process.exit(0)"],
    stdinPolicy: "disabled",
  }), "direct_stateful_exec_session_exists");

  const bounded = manager.start({
    ...binding,
    command: node,
    args: ["-e", "process.stdout.write('x'.repeat(2000))"],
    stdinPolicy: "disabled",
    outputBudgetChars: 256,
    providerResultBudgetChars: 128,
  });
  const boundedResult = await manager.wait({ ...binding, sessionId: bounded.sessionId });
  assert.equal(boundedResult.status, "completed");
  assert.equal(boundedResult.outputFrames[0].truncated, true);
  assert(boundedResult.stdoutPreview.length <= 128, "provider output must remain bounded");

  // A post-budget output flood may keep the process alive, but must not grow
  // retained frames or the sequence after aggregate preview admission ends.
  const outputFlood = manager.start({
    ...binding,
    command: node,
    args: ["-e", "process.stdout.write('a'.repeat(64)); setTimeout(() => { let i = 0; const timer = setInterval(() => { process.stdout.write('z'.repeat(64)); i += 1; if (i === 8) { clearInterval(timer); process.exit(0); } }, 10); }, 60)"],
    stdinPolicy: "disabled",
    outputBudgetChars: 256,
    providerResultBudgetChars: 32,
  });
  const floodRecord = manager.sessions.get(outputFlood.sessionId);
  for (let attempt = 0; attempt < 60 && (floodRecord?.outputChars || 0) < 256; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const floodFrameCountAtBudget = floodRecord.outputFrames.length;
  const floodSequenceAtBudget = floodRecord.sequence;
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.equal(floodRecord.outputFrames.length, floodFrameCountAtBudget, "post-budget flood must not retain zero-preview frames");
  assert.equal(floodRecord.sequence, floodSequenceAtBudget, "post-budget flood must not advance frame sequence");
  assert(floodRecord.outputFrames.every((frame) => frame.previewChars > 0), "retained frames must contain admitted preview");
  const outputFloodResult = await manager.wait({ ...binding, sessionId: outputFlood.sessionId });
  assert.equal(outputFloodResult.status, "completed");

  const interactive = manager.start({
    ...binding,
    command: node,
    args: ["-e", "process.stdin.setEncoding('utf8'); process.stdin.on('data', value => { process.stdout.write('echo:' + value); if (value.includes('done')) process.exit(0); })"],
    stdinPolicy: "line_input",
  });
  const inputResult = manager.writeStdin({ ...binding, session_id: interactive.sessionId, chars: "done\n" });
  assert.equal(inputResult.stdinAccepted, true);
  const interactiveResult = await manager.wait({ ...binding, sessionId: interactive.sessionId });
  assert.equal(interactiveResult.status, "completed");
  assert(interactiveResult.stdoutPreview.includes("echo:done"), "stdin continuation should observe event-driven output");
  expectCode(() => manager.writeStdin({ ...binding, sessionId: interactive.sessionId, input: "late" }), "direct_stateful_exec_session_not_live");

  const sessionStore = new DirectSessionStore({ rootDir: path.join(root, "sessions") });
  const controllerSession = sessionStore.createSession({
    sessionId: taskId,
    projectId,
    workspace: { kind: "local" },
    runtimeMode: "direct-experimental",
    directTransport: "live-text",
    directTier: "implementation-lane",
    harnessGrantId: grant.grantId,
    executionEnvironmentDigest: grant.executionEnvironmentDigest,
  });
  const providerBodies = [];
  const controller = new DirectLiveTextController({
    sessionStore,
    harnessGrantStore: store,
    statefulExecSessionManager: manager,
    profileDoc: { profile: { ontology: { models: [{ id: "gpt-5.6-sol", status: "accepted" }] } } },
    authStore: {
      readStatus: () => ({ status: "authenticated", hasAccessToken: true }),
      readCredentials: () => ({ accessToken: "fixture-token" }),
    },
    endpoint: "https://chatgpt.test/backend-api/codex/responses",
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      providerBodies.push(body);
      if (providerBodies.length === 1) {
        const [execSessionId] = JSON.stringify(body).match(/exec_session_[a-f0-9]+/) || [];
        assert(execSessionId, "stateful exec continuation should expose the bounded session id");
        return {
          ok: true,
          status: 200,
          headers: { get: () => "text/event-stream" },
          text: async () => toolCallSse("resp_stateful_exec_stdin", "write_stdin", {
            session_id: execSessionId,
            chars: "provider-route\n",
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => "text/event-stream" },
        text: async () => continuationSse,
      };
    },
  });
  controller.statusForProject = () => ({ status: "ready", model: "gpt-5.6-sol" });
  await fs.writeFile(path.join(workspace, ".env.synthetic"), fakeSecret, "utf8");
  const restrictedSession = sessionStore.createSession({
    sessionId: "restricted_env_task",
    projectId,
    workspace: { kind: "local" },
    runtimeMode: "direct-experimental",
    directTransport: "live-text",
    directTier: "implementation-lane",
  });
  const restrictedTurn = sessionStore.createTurn(restrictedSession.sessionId, {
    turnId: "restricted_env_turn",
    input: [{ role: "user", text: "read the fixture" }],
    requestShape: { declaredToolNames: ["read_file"] },
  });
  const restrictedObligation = sessionStore.addToolObligations(restrictedSession.sessionId, restrictedTurn.turnId, [{
    type: "tool_call_completed",
    itemId: "restricted_env_item",
    callId: "restricted_env_call",
    name: "read_file",
    toolType: "function_call",
    argumentsJson: JSON.stringify({ path: ".env.synthetic" }),
    responseId: "restricted_env_response",
  }], { parentResponseId: "restricted_env_response" }).obligations[0];
  expectCode(() => approveReadOnlyToolObligation({
    sessionStore,
    sessionId: restrictedSession.sessionId,
    turnId: restrictedTurn.turnId,
    obligationId: restrictedObligation.obligationId,
  }), "sensitive_read_file_path");
  const controllerStarted = controller.handleRequest("exec_command", {
    sessionId: controllerSession.sessionId,
    command: node,
    args: ["-e", "process.stdout.write('controller-route')"],
    stdinPolicy: "disabled",
  }, { project: { id: projectId, workspace: { kind: "local" } } });
  const controllerResult = await controller.handleRequest("exec_command/wait", {
    taskId: controllerSession.sessionId,
    sessionId: (await controllerStarted).sessionId,
  }, { project: { id: projectId, workspace: { kind: "local" } } });
  assert.equal(controllerResult.status, "completed");
  assert(controllerResult.stdoutPreview.includes("controller-route"), "controller should route the task-bound process session");
  const controllerInteractive = await controller.handleRequest("exec_command", {
    sessionId: controllerSession.sessionId,
    command: node,
    args: ["-e", "process.stdin.setEncoding('utf8'); process.stdin.on('data', value => { process.stdout.write('controller-echo:' + value); process.exit(0); })"],
    stdinPolicy: "line_input",
  }, { project: { id: projectId, workspace: { kind: "local" } } });
  const controllerInput = await controller.handleRequest("write_stdin", {
    taskId: controllerSession.sessionId,
    sessionId: controllerInteractive.sessionId,
    input: "bound\n",
  }, { project: { id: projectId, workspace: { kind: "local" } } });
  assert.equal(controllerInput.stdinAccepted, true);
  const controllerInteractiveResult = await controller.handleRequest("exec_command/wait", {
    taskId: controllerSession.sessionId,
    sessionId: controllerInteractive.sessionId,
  }, { project: { id: projectId, workspace: { kind: "local" } } });
  assert(controllerInteractiveResult.stdoutPreview.includes("controller-echo:bound"), "controller should route stdin to the exact process session");

  const compound = manager.start({
    ...binding,
    cmd: `${node} -e "process.stdout.write(process.cwd())"; ${node} -e "process.stdout.write(':compound')"`,
    cwd: outside,
    stdinPolicy: "disabled",
  });
  const compoundResult = await manager.wait({ ...binding, session_id: compound.sessionId });
  assert.equal(compoundResult.status, "completed");
  assert(compoundResult.stdoutPreview.includes(`${outside}:compound`), "vanilla cmd should provide shell semantics in the selected local environment");
  const traversed = manager.start({
    ...binding,
    command: node,
    args: ["-e", "process.stdout.write(process.cwd())"],
    cwd: "../outside",
    stdinPolicy: "disabled",
  });
  const traversedResult = await manager.wait({ ...binding, sessionId: traversed.sessionId });
  assert.equal(traversedResult.status, "completed");
  assert.equal(traversedResult.stdoutPreview, outside, "full-access relative parent cwd should resolve in the selected local environment");
  const providerTurn = sessionStore.createTurn(controllerSession.sessionId, {
    turnId: "controller_provider_turn",
    input: [{ role: "user", text: "run the task-bound process" }],
    model: "gpt-5.6-sol",
    requestShape: {
      declaredToolNames: ["exec_command", "write_stdin"],
      directThreadHarnessGrantId: grant.grantId,
    },
  });
  sessionStore.updateTurnState(controllerSession.sessionId, providerTurn.turnId, "streaming", {});
  const providerObligation = sessionStore.addToolObligations(controllerSession.sessionId, providerTurn.turnId, [{
    type: "tool_call_completed",
    itemId: "exec_item",
    callId: "exec_call",
    name: "exec_command",
    toolType: "function_call",
    argumentsJson: JSON.stringify({
      command: node,
      args: ["-e", "process.stdin.setEncoding('utf8'); process.stdin.on('data', value => { process.stdout.write(value); process.exit(0); })"],
      stdinPolicy: "line_input",
    }),
    responseId: "provider_response",
  }], { parentResponseId: "provider_response" }).obligations[0];
  assert.equal(await controller.emitToolApprovalRequests(null, controllerSession.sessionId, providerTurn.turnId, [providerObligation], { id: projectId, workspace: { kind: "local" } }), 1);
  const providerState = sessionStore.findToolObligation(controllerSession.sessionId, providerTurn.turnId, providerObligation.obligationId).obligation;
  assert.equal(providerState.authorityState, "continuation_sent");
  assert.equal(providerState.approvalAvailable, false);
  assert.equal(providerState.result.resultKind, "stateful_exec");
  assert.equal(providerState.result.sideEffectExecuted, true);
  assert.equal(providerBodies.length, 2, "provider should receive exec and stdin result continuations");
  assert.match(JSON.stringify(providerBodies[0]), new RegExp(providerState.statefulExecSessionId));
  assert(providerBodies[0].tools.some((tool) => tool.name === "exec_command"));
  assert(providerBodies[0].tools.some((tool) => tool.name === "write_stdin"));
  assert.match(JSON.stringify(providerBodies[1]), /stdinAccepted/);
  assert.match(providerBodies[1].instructions, /exec_command/);
  assert.match(providerBodies[1].instructions, /write_stdin/);
  assert.match(providerBodies[1].instructions, new RegExp(providerState.statefulExecSessionId));
  assert.doesNotMatch(providerBodies[1].instructions, /request only read_file|may request at most one additional read_file/i);
  assert.match(providerBodies[1].instructions, /final/);
  assert.match(providerBodies[1].instructions, /exec_command is permitted, including its shell-backed command execution/);
  assert.match(providerBodies[1].instructions, /write_stdin is permitted only with the exact returned live session ID/);
  assert.doesNotMatch(providerBodies[1].instructions, /Do not request[^.]*\bshell\b/i);
  assert.match(providerBodies[1].instructions, /Do not request read_file, workspace, patch, browser, network, MCP/);
  assert.equal(sessionStore.readTurn(controllerSession.sessionId, providerTurn.turnId).state, "completed");
  assert.equal(providerState.statefulExecResult.status, "running", "interactive provider exec must remain live after the bounded initial yield");
  assert.equal(providerState.statefulExecResult.sessionState, "running");
  const providerResult = await manager.wait({ ...binding, sessionId: providerState.statefulExecSessionId });
  assert.equal(providerResult.status, "completed");
  assert(providerResult.stdoutPreview.includes("provider-route"), "provider exec obligation should use the real session executor");

  const delayedProviderTurn = sessionStore.createTurn(controllerSession.sessionId, {
    turnId: "controller_delayed_provider_turn",
    input: [{ role: "user", text: "run the delayed task-bound process" }],
    model: "gpt-5.6-sol",
    requestShape: {
      declaredToolNames: ["exec_command"],
      directThreadHarnessGrantId: grant.grantId,
    },
  });
  sessionStore.updateTurnState(controllerSession.sessionId, delayedProviderTurn.turnId, "streaming", {});
  const delayedProviderObligation = sessionStore.addToolObligations(controllerSession.sessionId, delayedProviderTurn.turnId, [{
    type: "tool_call_completed",
    itemId: "delayed_exec_item",
    callId: "delayed_exec_call",
    name: "exec_command",
    toolType: "function_call",
    argumentsJson: JSON.stringify({
      command: node,
      args: ["-e", "setTimeout(() => process.stdout.write('delayed-provider'), 20)"],
      stdinPolicy: "disabled",
    }),
    responseId: "delayed_provider_response",
  }], { parentResponseId: "delayed_provider_response" }).obligations[0];
  assert.equal(await controller.emitToolApprovalRequests(null, controllerSession.sessionId, delayedProviderTurn.turnId, [delayedProviderObligation], { id: projectId, workspace: { kind: "local" } }), 1);
  const delayedProviderState = sessionStore.findToolObligation(controllerSession.sessionId, delayedProviderTurn.turnId, delayedProviderObligation.obligationId).obligation;
  assert.equal(delayedProviderState.statefulExecResult.status, "completed", "a short delayed provider exec must settle before continuation");
  assert.equal(delayedProviderState.statefulExecResult.exitCode, 0);
  assert(delayedProviderState.statefulExecResult.stdoutPreview.includes("delayed-provider"));
  assert.equal(providerBodies.length, 3, "delayed provider exec should produce one additional continuation");
  assert.match(JSON.stringify(providerBodies[2]), /delayed-provider/);
  assert.match(providerBodies[2].input?.[0]?.content?.[0]?.text || "", /"exitCode":0/);
  assert.equal(sessionStore.readTurn(controllerSession.sessionId, delayedProviderTurn.turnId).state, "completed");

  const failed = manager.start({
    ...binding,
    command: node,
    args: ["-e", "process.stderr.write('failure'); process.exit(7)"],
    stdinPolicy: "disabled",
  });
  const failedResult = await manager.wait({ ...binding, sessionId: failed.sessionId });
  assert.equal(failedResult.status, "failed");
  assert.equal(failedResult.exitCode, 7);

  const timedOut = manager.start({
    ...binding,
    command: node,
    args: ["-e", "setTimeout(() => {}, 10000)"],
    stdinPolicy: "disabled",
    idleTimeoutMs: 5_000,
    hardTimeoutMs: 100,
  });
  const timeoutResult = await manager.wait({ ...binding, sessionId: timedOut.sessionId });
  assert.equal(timeoutResult.status, "timeout");
  assert.equal(timeoutResult.recoveryClassification.replayAllowed, false);

  const idleTimedOut = manager.start({
    ...binding,
    command: node,
    args: ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 10000)"],
    stdinPolicy: "disabled",
    idleTimeoutMs: 150,
    hardTimeoutMs: 2_000,
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const idleStartedAt = Date.now();
  const idleTimeoutResult = await manager.wait({ ...binding, sessionId: idleTimedOut.sessionId });
  const idleElapsedMs = Date.now() - idleStartedAt;
  assert.equal(idleTimeoutResult.status, "timeout");
  assert.equal(idleTimeoutResult.signal, "SIGKILL", "idle timeout must escalate a SIGTERM-ignoring child");
  assert.ok(idleElapsedMs >= 200 && idleElapsedMs < 2_000, `idle timeout escalation should settle in a bounded interval: ${idleElapsedMs}ms`);

  const cancelled = manager.start({
    ...binding,
    command: node,
    args: ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 10000)"],
    stdinPolicy: "disabled",
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const cancellationStartedAt = Date.now();
  const firstCancellation = manager.cancel({ ...binding, sessionId: cancelled.sessionId });
  const repeatedCancellation = manager.cancel({ ...binding, sessionId: cancelled.sessionId });
  assert.equal(firstCancellation.cancellationRequested, true);
  assert.equal(repeatedCancellation.alreadyCancelling, true, "repeated cancellation must not schedule a second escalation");
  const cancelledResult = await manager.wait({ ...binding, sessionId: cancelled.sessionId });
  const cancellationElapsedMs = Date.now() - cancellationStartedAt;
  assert.equal(cancelledResult.status, "cancelled");
  assert.equal(cancelledResult.signal, "SIGKILL", "SIGTERM-ignoring cancellation must escalate to SIGKILL");
  assert.ok(cancellationElapsedMs >= 150 && cancellationElapsedMs < 2_000, `cancellation escalation should settle within its bounded interval: ${cancellationElapsedMs}ms`);

  const disposalManager = new DirectStatefulExecSessionManager({
    grantStore: store,
    workspaceRootResolver: () => workspace,
    idleTimeoutMs: 5_000,
    hardTimeoutMs: 10_000,
  });
  const disposalSession = disposalManager.start({
    ...binding,
    command: node,
    args: ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 10000)"],
    stdinPolicy: "disabled",
  });
  // Let the child install its SIGTERM handler before the owner begins the
  // bounded termination sequence; this keeps escalation deterministic.
  await new Promise((resolve) => setTimeout(resolve, 50));
  const disposalStartedAt = Date.now();
  const disposalPromise = disposalManager.dispose("full-local-disposal-regression");
  assert.equal(disposalPromise, disposalManager.dispose("repeat-disposal"), "repeated disposal must share one in-flight outcome");
  const disposalReceipt = await disposalPromise;
  const disposalElapsedMs = Date.now() - disposalStartedAt;
  assert.equal(disposalReceipt.status, "completed");
  assert.equal(disposalReceipt.activeSessionCount, 0);
  assert.equal(disposalReceipt.sigtermRequested, true);
  assert.equal(disposalReceipt.sigkillEscalated, true, "a SIGTERM-ignoring process must require SIGKILL escalation");
  assert.ok(disposalElapsedMs >= 150, `disposal should honor the bounded termination grace: ${disposalElapsedMs}ms`);
  assert.equal((await disposalManager.dispose("after-completion")), disposalReceipt, "completed disposal must remain idempotent");
  expectCode(() => disposalManager.start({
    ...binding,
    command: node,
    args: ["-e", "process.exit(0)"],
    stdinPolicy: "disabled",
  }), "direct_stateful_exec_manager_disposed");
  assert.equal((await disposalManager.wait({ ...binding, sessionId: disposalSession.sessionId })).status, "cancelled");

  expectCode(() => manager.start({
    ...binding,
    projectId: "foreign_project",
    command: node,
    args: ["-e", "process.exit(0)"],
  }), "direct_stateful_exec_scope_mismatch");
  const restrictedExecutor = new DirectFullAccessLocalEnvironmentExecutor({ workspaceRootResolver: () => workspace });
  await expectCodeAsync(() => restrictedExecutor.request({ ...binding, harnessGrant: null, grantId: "" }, "readFile", {
    relPath: outsideFile,
  }), "direct_full_access_grant_missing");
  await expectCodeAsync(() => restrictedExecutor.request({ ...binding, projectId: "foreign_project" }, "readFile", {
    relPath: outsideFile,
  }), "direct_full_access_grant_not_current");
  const restrictedManager = new DirectStatefulExecSessionManager({ workspaceRootResolver: () => workspace });
  expectCode(() => restrictedManager.start({
    ...binding,
    harnessGrant: null,
    grantId: "",
    command: node,
    args: ["-e", "process.exit(0)"],
  }), "direct_stateful_exec_grant_missing");
  store.revoke(grant.grantId, "fixture_revoked");
  expectCode(() => manager.start({
    ...binding,
    command: node,
    args: ["-e", "process.exit(0)"],
  }), "direct_stateful_exec_grant_not_current");

  const recovery = new DirectStatefulExecSessionManager({ grantStore: store, workspaceRootResolver: () => workspace });
  const recoveryRows = recovery.restart({ sessions: [{
    ...successResult,
    sessionState: "running",
    completedAt: "",
  }] });
  assert.equal(recoveryRows[0].sessionState, "recovery_required");
  assert.equal(recoveryRows[0].recoveryClassification.replayAllowed, false);

  await fs.rm(root, { recursive: true, force: true });
  console.log(JSON.stringify({
    ok: true,
    sessionsCovered: 12,
    capabilities: ["read_file", "apply_patch", "exec_command", "write_stdin"],
    restrictedMode: "grant_required",
  }));
}

main().catch(async (error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
