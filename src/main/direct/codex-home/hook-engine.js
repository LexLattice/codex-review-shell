"use strict";

// Which hooks run for an event and what their results mean, as Codex reads
// them. Exit 2 with stderr blocks (the prompt, the tool call, the
// permission request, a PostToolUse result, or the end of a turn). Exit 0
// may print JSON: `decision: "block"` with a reason, `continue: false`, or
// `hookSpecificOutput` (permissionDecision allow/deny with an optional
// updatedInput for PreToolUse, decision.behavior for PermissionRequest,
// additionalContext). Plain stdout from SessionStart and UserPromptSubmit
// is context for the model. Anything else is an error that doesn't block.

const CONTEXT_EVENTS = new Set(["SessionStart", "UserPromptSubmit"]);
const MAX_CONTEXT_CHARS = 10_000;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hookMatches(hook, value) {
  const matcher = typeof hook.matcher === "string" ? hook.matcher.trim() : "";
  if (!matcher || matcher === "*") return true;
  if (matcher === value) return true;
  try {
    return new RegExp(`^(?:${matcher})$`).test(String(value || ""));
  } catch {
    return false;
  }
}

function interpret(event, result = {}) {
  const outcome = { errors: [], contexts: [] };
  if (result.spawnError || result.timedOut) {
    outcome.errors.push(result.timedOut ? "timed out" : `couldn't start: ${String(result.stderr || "").slice(0, 200)}`);
    return outcome;
  }
  const stdout = String(result.stdout || "").trim();
  const stderr = String(result.stderr || "").trim();
  if (result.exitCode === 2) {
    if (stderr) {
      outcome.block = true;
      outcome.reason = stderr.slice(0, 4_000);
    } else {
      outcome.errors.push("exit 2 without a reason on stderr");
    }
    return outcome;
  }
  if (result.exitCode !== 0) {
    outcome.errors.push(`exited ${result.exitCode}${stderr ? `: ${stderr.slice(0, 200)}` : ""}`);
    return outcome;
  }
  let json = null;
  if (stdout.startsWith("{")) {
    try {
      json = JSON.parse(stdout);
    } catch {
      json = null;
    }
  }
  if (!isPlainObject(json)) {
    if (stdout && CONTEXT_EVENTS.has(event)) outcome.contexts.push(stdout.slice(0, MAX_CONTEXT_CHARS));
    return outcome;
  }
  if (json.continue === false) {
    outcome.stop = true;
    outcome.stopReason = typeof json.stopReason === "string" ? json.stopReason.slice(0, 4_000) : "";
  }
  if (json.decision === "block") {
    outcome.block = true;
    outcome.reason = typeof json.reason === "string" ? json.reason.slice(0, 4_000) : "Blocked by a hook.";
  }
  const specific = isPlainObject(json.hookSpecificOutput) ? json.hookSpecificOutput : null;
  if (specific) {
    if (typeof specific.additionalContext === "string" && specific.additionalContext.trim()) {
      outcome.contexts.push(specific.additionalContext.slice(0, MAX_CONTEXT_CHARS));
    }
    if (event === "PreToolUse") {
      if (specific.permissionDecision === "deny") {
        outcome.block = true;
        outcome.reason = typeof specific.permissionDecisionReason === "string" ? specific.permissionDecisionReason.slice(0, 4_000) : "Denied by a hook.";
      } else if (specific.permissionDecision === "allow") {
        outcome.allow = true;
        if (isPlainObject(specific.updatedInput)) outcome.updatedInput = specific.updatedInput;
      }
    }
    if (event === "PermissionRequest" && isPlainObject(specific.decision)) {
      if (specific.decision.behavior === "allow") outcome.allow = true;
      if (specific.decision.behavior === "deny") {
        outcome.block = true;
        outcome.reason = typeof specific.decision.message === "string" ? specific.decision.message.slice(0, 4_000) : "Denied by a hook.";
      }
    }
  }
  return outcome;
}

// Runs the matching trusted hooks for one event: synchronous ones together
// (their results combine; the last rewrite of a tool's input wins),
// asynchronous ones in the background (they can't decide anything).
async function runHooksForEvent({ hooks = [], event, matchValue = "", payload = {}, isTrusted, runner }) {
  const selected = (Array.isArray(hooks) ? hooks : [])
    .filter((hook) => hook.event === event && hookMatches(hook, matchValue) && isTrusted(hook.id));
  const combined = { ran: 0, block: false, reason: "", allow: false, updatedInput: null, contexts: [], stop: false, stopReason: "", errors: [] };
  if (!selected.length) return combined;
  const stdin = JSON.stringify(payload);
  const sync = selected.filter((hook) => !hook.async);
  for (const hook of selected.filter((entry) => entry.async)) {
    Promise.resolve().then(() => runner(hook, stdin)).catch(() => {});
  }
  const results = await Promise.all(sync.map(async (hook) => {
    try {
      return { hook, outcome: interpret(event, await runner(hook, stdin)) };
    } catch (error) {
      return { hook, outcome: { errors: [String(error?.message || error)], contexts: [] } };
    }
  }));
  combined.ran = selected.length;
  for (const { hook, outcome } of results) {
    if (outcome.block && !combined.block) {
      combined.block = true;
      combined.reason = outcome.reason;
    }
    if (outcome.allow) combined.allow = true;
    if (outcome.updatedInput) combined.updatedInput = outcome.updatedInput;
    if (outcome.stop) {
      combined.stop = true;
      combined.stopReason ||= outcome.stopReason;
    }
    combined.contexts.push(...outcome.contexts);
    for (const error of outcome.errors) combined.errors.push(`${hook.event} hook "${hook.command.slice(0, 80)}": ${error}`);
  }
  // A block outranks an allow.
  if (combined.block) {
    combined.allow = false;
    combined.updatedInput = null;
  }
  return combined;
}

module.exports = { hookMatches, interpretHookResult: interpret, runHooksForEvent };
