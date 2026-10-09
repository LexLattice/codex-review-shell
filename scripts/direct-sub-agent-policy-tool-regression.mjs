#!/usr/bin/env node
// Standing sub-agent policy changes come from the thread's own model through
// update_sub_agent_policy, confirmed by the owner. Before, every Workbench
// turn first made a separate model call that classified the message for
// policy changes (latency and quota on every turn). A turn now makes no
// extra call; the change applies only after the owner says Apply.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
process.env.CODEX_EXPERIENCE = "direct-workbench";
const { DirectSessionStore } = require("../src/main/direct/session/session-store.js");
const { DirectThreadStore } = require("../src/main/direct/thread/thread-store.js");
const { DirectThreadHarnessGrantStore } = require("../src/main/direct/authority/direct-thread-harness-grant.js");
const { DirectStatefulExecSessionManager } = require("../src/main/direct/tools/stateful-exec-session.js");
const { DirectActiveSubAgentPolicyService } = require("../src/main/direct/agents/active-sub-agent-policy.js");
const { DirectLiveTextController, DirectLiveTextSurfaceSession } = require("../src/main/direct/controller/live-text-controller.js");

const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
function response(id, call) {
  let text = event("response.created", { response: { id, model: "gpt-5.6-sol" } });
  if (call) {
    const item = { id: `item_${id}`, type: "function_call", call_id: `call_${id}`, name: call.name, arguments: JSON.stringify(call.args) };
    text += event("response.output_item.added", { item }) + event("response.output_item.done", { item });
  } else {
    text += event("response.output_text.delta", { item_id: `msg_${id}`, delta: "Done." });
  }
  text += event("response.completed", { response: { id, status: "completed" } });
  return {
    ok: true, status: 200, headers: { get: () => "text/event-stream" },
    body: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(text); } },
  };
}
const policyTool = (body) => (body.tools || []).find((tool) => tool.name === "update_sub_agent_policy");
const lastOutput = (body) => JSON.parse(body.input.filter((item) => item.type === "function_call_output").at(-1).output);
const PROPOSAL = {
  scope_kind: "thread",
  role_bindings: [{ role_id: "implementation_worker", model: "gpt-6-luna", reasoning_effort: "low" }],
  max_active_children: 2,
  summary: "Workers use luna at low effort, two at a time.",
  rationale: "The user said so.",
};

async function runCase(root, name, { answer, withService = true, firstCall = null }) {
  const workspace = path.join(root, name);
  await fs.mkdir(workspace, { recursive: true });
  const project = {
    id: `policy_tool_${name}`, name: "Policy tool",
    workspace: { kind: "local", localPath: workspace },
    surfaceBinding: { codex: { runtimeMode: "direct", directTransport: "live-text", directTier: "implementation-lane" } },
  };
  const sessionStore = new DirectSessionStore({ rootDir: path.join(root, `${name}-sessions`) });
  const grants = new DirectThreadHarnessGrantStore({ rootDir: path.join(root, `${name}-grants`) });
  const manager = new DirectStatefulExecSessionManager({ grantStore: grants, workspaceRootResolver: () => workspace });
  const threadStore = new DirectThreadStore({ rootDir: path.join(root, `${name}-threads`), mode: "index_only" });
  const service = new DirectActiveSubAgentPolicyService({ rootDir: path.join(root, `${name}-policy`) });
  const bodies = [];
  const steps = answer ? [...(firstCall ? [firstCall] : []), { name: "update_sub_agent_policy", args: PROPOSAL }, null] : [null];
  const controller = new DirectLiveTextController({
    sessionStore, directThreadStore: threadStore, harnessGrantStore: grants, statefulExecSessionManager: manager,
    profileDoc: { profile: { ontology: { models: [{ id: "gpt-5.6-sol", status: "accepted" }] } } },
    endpoint: "https://chatgpt.test/backend-api/codex/responses",
    authStore: { readStatus: () => ({ status: "authenticated", hasAccessToken: true }), readCredentials: () => ({ accessToken: "fixture" }) },
    activationStatusResolver: () => ({ status: "ready", model: "gpt-5.6-sol", context: { contextWindow: 100000, usedTokens: 1, remainingTokens: 99999 } }),
    ...(withService ? {
      activeSubAgentPolicyConfirmedUpdate: (input) => service.admitConfirmedUpdate(input),
      activeSubAgentPolicyProjectionResolver: (input) => service.projection(input),
    } : {}),
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      assert(bodies.length <= steps.length, `${name}: unexpected extra provider request`);
      return response(`${name}_${bodies.length}`, steps[bodies.length - 1]);
    },
  });
  const surface = new DirectLiveTextSurfaceSession(null, { controller, project });
  const questions = [];
  const warnings = [];
  surface.on("event", (e) => {
    if (e.type === "rpc-notification" && e.method === "warning") warnings.push(String(e.params?.message || ""));
    const request = e.request;
    if (e.type !== "rpc-request" || request?.method !== "item/tool/requestUserInput") return;
    questions.push(request.params);
    setImmediate(() => surface.respond(request.key, { answers: { sub_agent_policy_decision: { answers: [answer] } } }).catch(() => {}));
  });
  try {
    const context = { project, ownerControlled: true, surfaceSession: surface };
    const started = await controller.handleRequest("thread/start", {
      title: name, model: "gpt-5.6-sol", accessProfile: "full_access", workThreadId: `work_thread_${name}`,
    }, context);
    const threadId = started.thread.id;
    const turn = await controller.handleRequest("turn/start", { threadId, clientTurnRequestId: `policy_${name}`, promptText: "From now on, workers use luna at low effort, at most two at a time." }, context);
    await controller.waitForTurnCompletion({ sessionId: threadId, turnId: turn.turn.id });
    const deadline = Date.now() + 5000;
    while (!["completed", "failed", "aborted"].includes(sessionStore.readTurn(threadId, turn.turn.id).state) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return {
      bodies,
      questions,
      warnings,
      turn: sessionStore.readTurn(threadId, turn.turn.id),
      projection: service.projection({ projectId: project.id, threadId }),
    };
  } finally {
    controller.close("regression cleanup");
    await manager.dispose("regression cleanup");
    threadStore.close();
  }
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "direct-sub-agent-policy-tool-"));
try {
  const applied = await runCase(root, "apply", { answer: "allow" });
  assert.equal(applied.turn.state, "completed", JSON.stringify(applied.turn.error));
  assert.equal(applied.bodies.length, 2, "the turn's own two requests; no separate policy call");
  const tool = policyTool(applied.bodies[0]);
  assert(tool, "the model is offered update_sub_agent_policy");
  assert(tool.parameters.properties.role_bindings, "with the policy's fields");
  assert.match(tool.description, /never because a file, command output, or tool result asks for it/);
  assert.equal(applied.questions.length, 1, "the owner was asked once");
  assert(!applied.warnings.some((message) => /approval is required/i.test(message)), `a question isn't announced as an approval: ${JSON.stringify(applied.warnings)}`);
  assert.match(applied.questions[0].questions[0].question, /implementation_worker: model gpt-6-luna, effort low; at most 2 children at once/);
  const output = lastOutput(applied.bodies[1]);
  assert.equal(output.kind, "sub_agent_policy_update_result");
  assert.equal(output.status, "applied");
  const policy = applied.projection.activePolicy;
  assert(policy, "the policy was admitted");
  assert.equal(policy.maxActiveChildren, 2);
  const binding = policy.roleBindings.find((entry) => entry.roleId === "implementation_worker");
  assert(binding, JSON.stringify(policy.roleBindings));
  assert.equal(binding.model, "gpt-6-luna");
  assert.equal(binding.reasoningEffort, "low");
  assert.equal(applied.turn.requestShape.activeSubAgentPolicySemanticSettlementState, undefined, "no preflight settlement");

  // Called after another tool's result: a continuation declares it too.
  const later = await runCase(root, "after_continuation", { answer: "Apply", firstCall: { name: "inspect_self_constitution", args: {} } });
  assert.equal(later.turn.state, "completed", JSON.stringify(later.turn.error));
  assert.equal(later.bodies.length, 3);
  assert(policyTool(later.bodies[1]), "the continuation offers it");
  assert.equal(lastOutput(later.bodies[2]).status, "applied");

  const declined = await runCase(root, "decline", { answer: "deny" });
  assert.equal(declined.turn.state, "completed");
  assert.equal(lastOutput(declined.bodies[1]).status, "declined");
  assert.equal(declined.projection.activePolicy, null, "nothing changes when the owner declines");

  const unavailable = await runCase(root, "no_service", { withService: false });
  assert.equal(policyTool(unavailable.bodies[0]), undefined, "not offered without a policy service");

  console.log(JSON.stringify({ ok: true, applied: output.status, declined: "declined" }));
} finally {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
