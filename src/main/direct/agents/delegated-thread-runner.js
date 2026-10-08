"use strict";

// Runs a delegated child: a full Direct thread in the target project, so it
// works natively in that project's environment (its own shell, files,
// sandbox, and environment facts), with no renderer attached. The native
// agent pool calls this like its other runners and settles the child from
// the returned result.

const crypto = require("node:crypto");
const {
  composeDelegatedTaskPrompt,
  lowerAccessProfile,
  projectEnvironment,
} = require("./cross-environment-delegation");

const DELEGATED_TURN_TERMINAL_STATES = new Set([
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
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_POLL_MS = 100;
const INTERRUPT_SETTLE_MS = 15_000;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function codeError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

// The child's last non-empty assistant message in this turn: what Codex
// returns to the parent.
function finalAssistantMessage(session = {}, turnId = "") {
  const messages = Array.isArray(session.messages) ? session.messages : [];
  const texts = [];
  for (const message of messages) {
    for (const item of Array.isArray(message?.items) ? message.items : []) {
      const belongs = message?.id === turnId || item?.turnId === turnId;
      if (belongs && item?.type === "agentMessage" && normalizeString(item.text, "")) texts.push(item.text.trim());
    }
  }
  return texts.at(-1) || "";
}

function summaryOf(text = "", fallback = "") {
  const firstLine = normalizeString(text, "").split(/\r?\n/).find((line) => line.trim()) || "";
  return (firstLine.length > 240 ? `${firstLine.slice(0, 237)}...` : firstLine) || fallback;
}

/**
 * deps:
 * - controller: the DirectLiveTextController (owns sessions and turns).
 * - SurfaceSession: DirectLiveTextSurfaceSession, used without a renderer
 *   so every tool path runs as it does for a thread on screen.
 * - resolveTarget(delegation) -> { project, folder, projectCreated,
 *   accessCeiling }; throws coded errors for refusals.
 * - timeoutMs, pollMs, now: optional.
 */
function createDelegatedThreadRunner(deps = {}) {
  const controller = deps.controller;
  const SurfaceSession = deps.SurfaceSession;
  const timeoutMs = Number(deps.timeoutMs) > 0 ? Number(deps.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const pollMs = Number(deps.pollMs) > 0 ? Number(deps.pollMs) : DEFAULT_POLL_MS;
  if (!controller || typeof SurfaceSession !== "function" || typeof deps.resolveTarget !== "function") {
    throw new TypeError("createDelegatedThreadRunner needs controller, SurfaceSession, and resolveTarget.");
  }
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  return async function runDelegatedThread(input = {}) {
    const delegation = isPlainObject(input.delegation) ? input.delegation : {};
    const signal = input.signal || null;
    const report = (patch) => {
      if (typeof input.onChildThread === "function") input.onChildThread(patch);
    };
    let resolved;
    try {
      resolved = await deps.resolveTarget(delegation, { signal });
    } catch (error) {
      return {
        status: "failed",
        blockerCode: normalizeString(error?.code, "direct_delegation_target_unavailable"),
        outputText: normalizeString(error?.message, "The delegation target is unavailable."),
      };
    }
    const project = resolved.project;
    const environment = projectEnvironment(project);
    const accessProfile = lowerAccessProfile(delegation.parentAccessProfile, resolved.accessCeiling);
    const publicDelegation = {
      targetProjectId: normalizeString(project?.id, ""),
      targetProjectName: normalizeString(project?.name, ""),
      environment,
      folder: normalizeString(resolved.folder, ""),
      projectCreated: resolved.projectCreated === true,
      accessProfile,
      accessCeiling: normalizeString(resolved.accessCeiling, ""),
    };
    report(publicDelegation);

    const surface = new SurfaceSession({ isDestroyed: () => true, send: () => {} }, { controller, project });
    // A delegated child has nobody to answer it: the first request it raises
    // for a person (a question, an approval) ends its turn.
    let needsPerson = "";
    surface.on("event", (event) => {
      if (event?.type === "rpc-request" && !needsPerson) {
        needsPerson = normalizeString(event.request?.method, "server_request");
      }
    });
    let threadId = "";
    let turnId = "";
    try {
      await surface.connect({ transport: "direct-live-text-delegated" });
      const thread = await surface.request("thread/start", {
        title: `${normalizeString(input.displayLabel, "Delegated task")} (from ${normalizeString(delegation.sourceProjectName, "another project")})`,
        model: normalizeString(input.model, ""),
        reasoningEffort: normalizeString(input.reasoningEffort, ""),
        accessProfile,
        delegatedFrom: {
          projectId: normalizeString(delegation.sourceProjectId, ""),
          projectName: normalizeString(delegation.sourceProjectName, ""),
          threadId: normalizeString(delegation.sourceThreadId || input.primaryThreadId, ""),
          childAgentId: normalizeString(input.childAgentId, ""),
          environment: isPlainObject(delegation.sourceEnvironment) ? delegation.sourceEnvironment : {},
          accessProfile,
          accessCeiling: publicDelegation.accessCeiling,
          delegatedAt: new Date().toISOString(),
        },
      });
      threadId = normalizeString(thread?.thread?.id, "");
      if (!threadId) throw codeError("direct_delegated_thread_start_failed", "The delegated thread didn't start.");
      report({ childThreadId: threadId });
      if (signal?.aborted) throw codeError("direct_agent_cancelled", "Cancelled before the delegated turn started.");
      const ack = await surface.request("turn/start", {
        threadId,
        clientTurnRequestId: `delegated_${crypto.randomUUID().replace(/-/g, "")}`,
        promptText: composeDelegatedTaskPrompt({
          message: input.prompt,
          sourceProjectName: delegation.sourceProjectName,
          sourceEnvironmentLabel: delegation.sourceEnvironment?.label,
          folder: publicDelegation.folder,
        }),
        model: normalizeString(input.model, ""),
        effort: normalizeString(input.reasoningEffort, ""),
      });
      turnId = normalizeString(ack?.turn?.id, "");
      if (!turnId) throw codeError("direct_delegated_turn_start_failed", "The delegated turn didn't start.");
      report({ childTurnId: turnId });

      const deadline = Date.now() + timeoutMs;
      let stopReason = "";
      let turn = null;
      for (;;) {
        turn = controller.sessionStore.readTurn(threadId, turnId);
        const state = normalizeString(turn?.state, "");
        if (DELEGATED_TURN_TERMINAL_STATES.has(state) && !surface.hasServerRequest?.()) break;
        if (needsPerson) { stopReason = "direct_delegated_child_needs_person"; break; }
        if (signal?.aborted) { stopReason = "direct_agent_cancelled"; break; }
        if (Date.now() >= deadline) { stopReason = "direct_delegated_child_timeout"; break; }
        await sleep(pollMs);
      }
      if (stopReason) {
        try {
          await controller.interruptTurn({ threadId, sessionId: threadId, turnId }, { project, surfaceSession: surface });
        } catch {}
        const settleBy = Date.now() + INTERRUPT_SETTLE_MS;
        while (Date.now() < settleBy && !DELEGATED_TURN_TERMINAL_STATES.has(normalizeString(controller.sessionStore.readTurn(threadId, turnId)?.state, ""))) {
          await sleep(pollMs);
        }
      }
      const session = controller.sessionStore.readSession(threadId) || {};
      const finalMessage = finalAssistantMessage(session, turnId);
      const state = normalizeString(controller.sessionStore.readTurn(threadId, turnId)?.state, "");
      const capture = { status: "captured", sessionId: threadId, turnId };
      if (stopReason === "direct_agent_cancelled") {
        return { status: "cancelled", blockerCode: stopReason, outputText: stopReason, finalMessage, delegation: publicDelegation, epistemicCapture: capture };
      }
      if (stopReason) {
        const why = stopReason === "direct_delegated_child_needs_person"
          ? `The delegated agent stopped because it asked for a person (${needsPerson}); delegated agents can't ask the user.`
          : "The delegated agent didn't finish in time and was stopped.";
        return {
          status: stopReason === "direct_delegated_child_timeout" ? "timeout" : "failed",
          blockerCode: stopReason,
          outputText: why,
          finalMessage,
          delegation: publicDelegation,
          epistemicCapture: capture,
        };
      }
      if (state === "completed") {
        return {
          status: "completed",
          blockerCode: "",
          outputText: summaryOf(finalMessage, "The delegated agent finished without a final message."),
          finalMessage,
          delegation: publicDelegation,
          epistemicCapture: capture,
        };
      }
      const error = isPlainObject(turn?.error) ? turn.error : {};
      return {
        status: "failed",
        blockerCode: normalizeString(error.code, `direct_delegated_turn_${state || "failed"}`),
        outputText: normalizeString(error.message, `The delegated turn ended as ${state || "failed"}.`),
        finalMessage,
        delegation: publicDelegation,
        epistemicCapture: capture,
      };
    } catch (error) {
      return {
        status: signal?.aborted ? "cancelled" : "failed",
        blockerCode: normalizeString(error?.code, "direct_delegated_thread_failed"),
        outputText: normalizeString(error?.message, "The delegated thread failed."),
        finalMessage: threadId && turnId ? finalAssistantMessage(controller.sessionStore.readSession(threadId) || {}, turnId) : "",
        delegation: { ...publicDelegation, childThreadId: threadId, childTurnId: turnId },
      };
    } finally {
      try {
        const disposed = surface.dispose?.({ silent: true, reason: "delegated_turn_settled" });
        if (disposed?.then) disposed.catch(() => {});
      } catch {}
    }
  };
}

module.exports = {
  createDelegatedThreadRunner,
  finalAssistantMessage,
};
