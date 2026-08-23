#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DEFAULT_CONTINUATION_PROMPT,
  EXTERNAL_PROVIDER_CONTINUATION_TRACE_SCHEMA,
  OPENROUTER_OXALPHA_MODEL,
  OPENCODE_OXALPHA_MODEL,
  PROVIDER_OPENCODE_OXALPHA,
  PROVIDER_OPENROUTER_OXALPHA,
  buildOpenCodeRebasePrompt,
  externalProviderProfile,
  finalizeOpenCodeRunDirectories,
  loadOpenRouterApiKey,
  openCodeProcessLaunchDescriptor,
  openCodeRunDirectories,
  parseEnvAssignment,
  pruneOpenCodeRuns,
  resolveOpenRouterEndpoint,
  resolveOpenCodeLaunchTarget,
  runOpenCodeOxAlphaTurn,
  runOpenRouterOxAlphaTurn,
  safeOpenCodeRuntimeEnv,
  spawnOpenCodeProcess,
  wslPathForWindowsPath,
} = require("../src/main/direct/agents/external-provider-continuation");
const { DirectNativeAgentPool } = require("../src/main/direct/agents/native-agent-pool");
const { normalizeContinuationTrace } = require("../src/main/direct/agents/provider-backed-route");

function sse(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function doneSse() {
  return "data: [DONE]\n\n";
}

function responseFromChunks(chunks, options = {}) {
  return {
    ok: options.ok !== false,
    status: options.status ?? 200,
    body: {
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) {
          if (chunk instanceof Error) throw chunk;
          yield chunk;
        }
      },
    },
  };
}

function requestBody(model) {
  return {
    model,
    instructions: "Complete the delegated task without tools.",
    input: [{
      role: "user",
      content: [{ type: "input_text", text: "Produce the bounded audit." }],
    }],
    reasoning: { effort: "xhigh" },
  };
}

const immediateSleep = async () => {};
const openRouterEnv = { OPENROUTER_API_KEY: "fixture-openrouter-secret" };

assert.equal(parseEnvAssignment("OPENROUTER_API_KEY='quoted-key'\n", "OPENROUTER_API_KEY"), "quoted-key");
assert.equal(parseEnvAssignment("export OPENROUTER_API_KEY=plain-key\n", "OPENROUTER_API_KEY"), "plain-key");
assert.equal(loadOpenRouterApiKey({ env: openRouterEnv }).source, "process_environment");
assert.equal(resolveOpenRouterEndpoint({ env: openRouterEnv }), "https://openrouter.ai/api/v1/chat/completions");
assert.equal(
  resolveOpenRouterEndpoint({ env: { ...openRouterEnv, CODEX_OPENROUTER_ENDPOINT: "https://openrouter.ai/alternate" } }),
  "https://openrouter.ai/alternate",
);
assert.throws(
  () => resolveOpenRouterEndpoint({
    env: { ...openRouterEnv, CODEX_OPENROUTER_ENDPOINT: "http://openrouter.ai/api/v1/chat/completions" },
  }),
  (error) => error?.code === "direct_openrouter_endpoint_insecure",
);
assert.throws(
  () => resolveOpenRouterEndpoint({
    env: { ...openRouterEnv, CODEX_OPENROUTER_ENDPOINT: "https://example.invalid/collect" },
  }),
  (error) => error?.code === "direct_openrouter_endpoint_untrusted",
);
assert.equal(
  resolveOpenRouterEndpoint({
    env: openRouterEnv,
    endpoint: "https://trusted-proxy.example/v1/chat/completions",
    allowCustomOpenRouterEndpoint: true,
  }),
  "https://trusted-proxy.example/v1/chat/completions",
);
const untrustedEndpointProfile = externalProviderProfile(PROVIDER_OPENROUTER_OXALPHA, {
  env: { ...openRouterEnv, CODEX_OPENROUTER_ENDPOINT: "https://example.invalid/collect" },
});
assert.equal(untrustedEndpointProfile.status, "blocked");
assert.equal(untrustedEndpointProfile.credentials, "available");
assert.equal(untrustedEndpointProfile.blockerCode, "direct_openrouter_endpoint_untrusted");

const windowsWslExecutable = "C:\\Windows\\System32\\wsl.exe";
const windowsOpenCodeEnv = {
  SystemRoot: "C:\\Windows",
  CODEX_REVIEW_SHELL_DEFAULT_WSL_DISTRO: "Ubuntu",
  CODEX_REVIEW_SHELL_DEFAULT_WSL_PATH: "/home/rose/work/LexLattice/codex-review-shell-direct",
  OPENROUTER_API_KEY: "must-not-cross-wsl-launch-boundary",
  WSLENV: "OPENROUTER_API_KEY/u",
};
const windowsWslAccessSync = (candidate) => {
  if (candidate === windowsWslExecutable) return;
  const error = new Error("fixture path missing");
  error.code = "ENOENT";
  throw error;
};
const windowsWslTarget = resolveOpenCodeLaunchTarget({
  platform: "win32",
  homeDir: "C:\\Users\\Rose",
  env: windowsOpenCodeEnv,
  accessSync: windowsWslAccessSync,
});
assert.equal(windowsWslTarget.substrate, "wsl");
assert.equal(windowsWslTarget.command, windowsWslExecutable);
assert.equal(windowsWslTarget.distro, "Ubuntu");
assert.equal(windowsWslTarget.openCodeExecutable, "/home/rose/.opencode/bin/opencode");
assert.equal(
  externalProviderProfile(PROVIDER_OPENCODE_OXALPHA, {
    platform: "win32",
    homeDir: "C:\\Users\\Rose",
    env: windowsOpenCodeEnv,
    accessSync: windowsWslAccessSync,
  }).executionSubstrate,
  "wsl",
);
const windowsWslProfilePool = new DirectNativeAgentPool({
  providerProfiles: [externalProviderProfile(PROVIDER_OPENCODE_OXALPHA, {
    platform: "win32",
    homeDir: "C:\\Users\\Rose",
    env: windowsOpenCodeEnv,
    accessSync: windowsWslAccessSync,
  })],
  providerTurnRunner: async () => ({ ok: true, terminalState: "completed", outputText: "fixture" }),
});
assert.equal(
  windowsWslProfilePool.descriptor().providerProfiles.find(
    (profile) => profile.providerId === PROVIDER_OPENCODE_OXALPHA,
  ).executionSubstrate,
  "wsl",
  "the agent pool must preserve the provider realization substrate for inspection",
);
assert.equal(
  wslPathForWindowsPath("C:\\Users\\Rose\\AppData\\Local\\worker space", { distro: "Ubuntu" }),
  "/mnt/c/Users/Rose/AppData/Local/worker space",
);
assert.equal(
  wslPathForWindowsPath("\\\\wsl.localhost\\Ubuntu\\home\\rose\\worker", { distro: "Ubuntu" }),
  "/home/rose/worker",
);
assert.throws(
  () => wslPathForWindowsPath("\\\\wsl.localhost\\Debian\\home\\rose\\worker", { distro: "Ubuntu" }),
  (error) => error?.code === "direct_opencode_wsl_path_distro_mismatch",
);
const windowsWslDescriptor = openCodeProcessLaunchDescriptor({
  launchTarget: windowsWslTarget,
  executable: windowsWslTarget.openCodeExecutable,
  args: [
    "run",
    "--format",
    "json",
    "--dir",
    "/mnt/c/Users/Rose/AppData/Local/worker space",
  ],
  cwd: "C:\\Users\\Rose\\AppData\\Local\\worker space",
  providerCwd: "/mnt/c/Users/Rose/AppData/Local/worker space",
  runtimeDirectory: "C:\\Users\\Rose\\AppData\\Local\\worker runtime",
}, {
  platform: "win32",
  env: windowsOpenCodeEnv,
});
assert.equal(windowsWslDescriptor.command, windowsWslExecutable);
assert.equal(windowsWslDescriptor.transport, "wsl.exe");
assert.deepEqual(windowsWslDescriptor.args.slice(0, 6), [
  "-d",
  "Ubuntu",
  "--cd",
  "/mnt/c/Users/Rose/AppData/Local/worker space",
  "--",
  "/usr/bin/env",
]);
assert(windowsWslDescriptor.args.includes("XDG_CONFIG_HOME=/mnt/c/Users/Rose/AppData/Local/worker runtime/config"));
assert(windowsWslDescriptor.args.includes("/home/rose/.opencode/bin/opencode"));
assert.equal(windowsWslDescriptor.args.some((arg) => arg.includes("must-not-cross")), false);
assert.equal(windowsWslDescriptor.env.OPENROUTER_API_KEY, undefined);
assert.equal(windowsWslDescriptor.env.WSLENV, "");

const interruptedBodies = [];
const interruptedHeaders = [];
let interruptedCall = 0;
const interrupted = await runOpenRouterOxAlphaTurn({
  requestBody: requestBody(OPENROUTER_OXALPHA_MODEL),
  requestShape: { reasoningEffort: "xhigh" },
}, {
  env: openRouterEnv,
  retryBaseMs: 0,
  sleepImpl: immediateSleep,
  fetchImpl: async (_url, init) => {
    interruptedBodies.push(JSON.parse(init.body));
    interruptedHeaders.push(init.headers);
    interruptedCall += 1;
    if (interruptedCall === 1) {
      return responseFromChunks([
        sse({ id: "or_partial", choices: [{ delta: { content: "Part one " }, finish_reason: null }] }),
        new Error("socket closed"),
      ]);
    }
    return responseFromChunks([
      sse({ id: "or_final", choices: [{ delta: { content: "and done." }, finish_reason: null }] }),
      sse({ id: "or_final", choices: [{ delta: {}, finish_reason: "stop" }], usage: {
        prompt_tokens: 20,
        completion_tokens: 4,
        total_tokens: 24,
      } }),
      doneSse(),
    ]);
  },
});

assert.equal(interrupted.ok, true);
assert.equal(interrupted.outputText, "Part one and done.");
assert.equal(interrupted.continuationTrace.schema, EXTERNAL_PROVIDER_CONTINUATION_TRACE_SCHEMA);
assert.equal(interrupted.continuationTrace.attemptCount, 2);
assert.equal(interrupted.continuationTrace.semanticContinuationCount, 1);
assert.equal(interrupted.continuationTrace.transportRetryCount, 0);
assert.equal(interrupted.continuationTrace.terminalFinishReason, "stop");
assert.equal(interruptedBodies[1].messages.at(-2).content, "Part one ");
assert.equal(interruptedBodies[1].messages.at(-1).content, DEFAULT_CONTINUATION_PROMPT);
assert.equal(interruptedBodies[1].reasoning.effort, "high");
assert.equal(interruptedHeaders[0].Authorization, "Bearer fixture-openrouter-secret");
assert.equal(JSON.stringify(interrupted.continuationTrace).includes("fixture-openrouter-secret"), false);
assert.equal(interrupted.normalizedEvents.filter((event) => event.type === "response_completed").length, 1);
assert.equal(normalizeContinuationTrace(interrupted.continuationTrace)?.traceDigest, interrupted.continuationTrace.traceDigest);
assert.equal(normalizeContinuationTrace({
  ...interrupted.continuationTrace,
  semanticContinuationCount: interrupted.continuationTrace.semanticContinuationCount + 1,
}), null, "admission must reject a continuation trace whose safe fields no longer match its digest");

let retryCall = 0;
const retryBodies = [];
const retriedBeforeOutput = await runOpenRouterOxAlphaTurn({
  requestBody: requestBody(OPENROUTER_OXALPHA_MODEL),
  requestShape: { reasoningEffort: "medium" },
}, {
  env: openRouterEnv,
  retryBaseMs: 0,
  sleepImpl: immediateSleep,
  fetchImpl: async (_url, init) => {
    retryBodies.push(JSON.parse(init.body));
    retryCall += 1;
    if (retryCall === 1) return responseFromChunks([], { ok: false, status: 503 });
    return responseFromChunks([
      sse({ id: "or_retry", choices: [{ delta: { content: "Recovered." }, finish_reason: "stop" }] }),
      doneSse(),
    ]);
  },
});
assert.equal(retriedBeforeOutput.outputText, "Recovered.");
assert.equal(retriedBeforeOutput.continuationTrace.semanticContinuationCount, 0);
assert.equal(retriedBeforeOutput.continuationTrace.transportRetryCount, 1);
assert.deepEqual(retryBodies[1].messages, retryBodies[0].messages, "a zero-output transport retry must not invent a continuation turn");

let emptyTerminalCall = 0;
const recoveredAfterEmptyTerminal = await runOpenRouterOxAlphaTurn({
  requestBody: requestBody(OPENROUTER_OXALPHA_MODEL),
  requestShape: { reasoningEffort: "medium" },
}, {
  env: openRouterEnv,
  retryBaseMs: 0,
  sleepImpl: immediateSleep,
  fetchImpl: async () => {
    emptyTerminalCall += 1;
    return emptyTerminalCall === 1
      ? responseFromChunks([
          sse({ id: "or_empty", choices: [{ delta: {}, finish_reason: "stop" }] }),
          doneSse(),
        ])
      : responseFromChunks([
          sse({ id: "or_after_empty", choices: [{ delta: { content: "Actual output." }, finish_reason: "stop" }] }),
          doneSse(),
        ]);
  },
});
assert.equal(recoveredAfterEmptyTerminal.outputText, "Actual output.");
assert.equal(recoveredAfterEmptyTerminal.continuationTrace.transportRetryCount, 1);
assert.equal(recoveredAfterEmptyTerminal.continuationTrace.attempts[0].trigger, "empty_terminal_output");

let lengthCall = 0;
const continuedAfterLength = await runOpenRouterOxAlphaTurn({
  requestBody: requestBody(OPENROUTER_OXALPHA_MODEL),
  requestShape: { reasoningEffort: "low" },
}, {
  env: openRouterEnv,
  retryBaseMs: 0,
  sleepImpl: immediateSleep,
  fetchImpl: async () => {
    lengthCall += 1;
    return lengthCall === 1
      ? responseFromChunks([
          sse({ id: "or_length", choices: [{ delta: { content: "Long " }, finish_reason: "length" }] }),
          doneSse(),
        ])
      : responseFromChunks([
          sse({ id: "or_length_final", choices: [{ delta: { content: "answer." }, finish_reason: "stop" }] }),
          doneSse(),
        ]);
  },
});
assert.equal(continuedAfterLength.outputText, "Long answer.");
assert.equal(continuedAfterLength.continuationTrace.attempts[0].trigger, "max_output_incomplete");

await assert.rejects(
  runOpenRouterOxAlphaTurn({
    requestBody: requestBody(OPENROUTER_OXALPHA_MODEL),
    requestShape: { reasoningEffort: "low" },
  }, {
    env: openRouterEnv,
    fetchImpl: async () => responseFromChunks([], { ok: false, status: 401 }),
  }),
  (error) => error?.code === "direct_openrouter_http_failed",
);

await assert.rejects(
  runOpenRouterOxAlphaTurn({
    requestBody: requestBody(OPENROUTER_OXALPHA_MODEL),
    requestShape: { reasoningEffort: "low" },
  }, {
    env: openRouterEnv,
    maxAttempts: 2,
    retryBaseMs: 0,
    sleepImpl: immediateSleep,
    fetchImpl: async () => responseFromChunks([], { ok: false, status: 503 }),
  }),
  (error) => (
    error?.code === "direct_external_provider_continuation_exhausted" &&
    error.continuationTrace?.attemptCount === 2 &&
    error.continuationTrace?.transportRetryCount === 2
  ),
);

await assert.rejects(
  runOpenRouterOxAlphaTurn({
    requestBody: requestBody(OPENROUTER_OXALPHA_MODEL),
    requestShape: { reasoningEffort: "low" },
  }, {
    env: openRouterEnv,
    maxTotalMs: 1_000,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      const fallback = setTimeout(() => reject(new Error("deadline signal was not delivered")), 1_500);
      init.signal.addEventListener("abort", () => {
        clearTimeout(fallback);
        const error = new Error("deadline reached");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    }),
  }),
  (error) => error?.code === "direct_external_provider_total_timeout",
);

const openCodeCalls = [];
const openCodeCommittedBatches = [];
const openCodeResults = [
  {
    exitCode: 0,
    stdout: [
      JSON.stringify({ type: "text", sessionID: "ses_fixture", part: { type: "text", text: "First segment " } }),
      JSON.stringify({ type: "step_finish", sessionID: "ses_fixture", part: {
        type: "step-finish",
        reason: "unknown",
        tokens: { input: 10, output: 2, reasoning: 1, total: 13, cache: { read: 0, write: 0 } },
      } }),
    ].join("\n"),
  },
  {
    exitCode: 0,
    stdout: [
      JSON.stringify({ type: "text", sessionID: "ses_fixture", part: { type: "text", text: "finished." } }),
      JSON.stringify({ type: "step_finish", sessionID: "ses_fixture", part: {
        type: "step-finish",
        reason: "stop",
        tokens: { input: 12, output: 2, reasoning: 1, total: 15, cache: { read: 1, write: 0 } },
      } }),
    ].join("\n"),
  },
];
const openCode = await runOpenCodeOxAlphaTurn({
  attemptId: "fixture-opencode-continuation",
  requestBody: requestBody(OPENCODE_OXALPHA_MODEL),
  requestShape: { reasoningEffort: "ultra" },
}, {
  openCodeExecutable: "/fixture/opencode",
  accessSync: () => {},
  mkdirSync: () => {},
  workingDirectory: "/tmp/direct-opencode-fixture",
  retryBaseMs: 0,
  sleepImpl: immediateSleep,
  processRunner: async (input) => {
    openCodeCalls.push(input);
    if (openCodeCalls.length === 2) {
      assert.equal(openCodeCommittedBatches.length, 1, "the first normalized attempt must be durable before the continuation process starts");
    }
    return openCodeResults.shift();
  },
  onNormalizedEventsCommitted: async (events, details) => {
    openCodeCommittedBatches.push({ events, details });
  },
});
assert.equal(openCode.outputText, "First segment finished.");
assert.equal(openCode.responseId, "ses_fixture");
assert.equal(openCode.continuationTrace.semanticContinuationCount, 1);
assert(openCodeCalls[0].args.includes("max"), "ultra should compile to the model's supported max variant");
assert(openCodeCalls[1].args.includes("--session"));
assert(openCodeCalls[1].args.includes("ses_fixture"));
assert.equal(openCodeCalls[1].args.at(-1), DEFAULT_CONTINUATION_PROMPT);
assert.equal(openCodeCalls[0].cwd, openCodeCalls[1].cwd);
assert.equal(openCodeCalls[0].runtimeDirectory, openCodeCalls[1].runtimeDirectory);
assert.notEqual(openCodeCalls[0].cwd, "/tmp/direct-opencode-fixture");
assert.equal(openCodeCommittedBatches.length, 2);
assert.equal(openCodeCommittedBatches[0].details.normalizedOffset, 0);
assert(openCodeCommittedBatches[1].details.normalizedOffset > 0);

let openCodeProcessFailureCalls = 0;
const openCodeAfterProcessFailure = await runOpenCodeOxAlphaTurn({
  requestBody: requestBody(OPENCODE_OXALPHA_MODEL),
  requestShape: { reasoningEffort: "high" },
}, {
  openCodeExecutable: "/fixture/opencode",
  accessSync: () => {},
  mkdirSync: () => {},
  workingDirectory: "/tmp/direct-opencode-process-failure-fixture",
  retryBaseMs: 0,
  sleepImpl: immediateSleep,
  processRunner: async () => {
    openCodeProcessFailureCalls += 1;
    if (openCodeProcessFailureCalls === 1) {
      const error = new Error("fixture transport failure");
      error.code = "direct_opencode_process_failed";
      throw error;
    }
    return {
      exitCode: 0,
      stdout: [
        JSON.stringify({ type: "text", sessionID: "ses_after_failure", part: { type: "text", text: "Recovered." } }),
        JSON.stringify({ type: "step_finish", sessionID: "ses_after_failure", part: { type: "step-finish", reason: "stop", tokens: {} } }),
      ].join("\n"),
    };
  },
});
assert.equal(openCodeAfterProcessFailure.outputText, "Recovered.");
assert.equal(openCodeAfterProcessFailure.continuationTrace.transportRetryCount, 1);
assert.equal(openCodeAfterProcessFailure.continuationTrace.semanticContinuationCount, 0);
assert.equal(openCodeAfterProcessFailure.continuationTrace.attempts[0].trigger, "opencode_process_failed");

const openCodeEmptyTerminalCalls = [];
const openCodeAfterEmptyTerminal = await runOpenCodeOxAlphaTurn({
  requestBody: requestBody(OPENCODE_OXALPHA_MODEL),
  requestShape: { reasoningEffort: "high" },
}, {
  openCodeExecutable: "/fixture/opencode",
  accessSync: () => {},
  mkdirSync: () => {},
  workingDirectory: "/tmp/direct-opencode-empty-terminal-fixture",
  retryBaseMs: 0,
  sleepImpl: immediateSleep,
  processRunner: async (input) => {
    openCodeEmptyTerminalCalls.push(input);
    return openCodeEmptyTerminalCalls.length === 1
      ? {
          exitCode: 0,
          stdout: JSON.stringify({ type: "step_finish", sessionID: "ses_empty", part: { type: "step-finish", reason: "stop", tokens: {} } }),
        }
      : {
          exitCode: 0,
          stdout: [
            JSON.stringify({ type: "text", sessionID: "ses_after_empty", part: { type: "text", text: "Actual output." } }),
            JSON.stringify({ type: "step_finish", sessionID: "ses_after_empty", part: { type: "step-finish", reason: "stop", tokens: {} } }),
          ].join("\n"),
        };
  },
});
assert.equal(openCodeAfterEmptyTerminal.outputText, "Actual output.");
assert.equal(openCodeAfterEmptyTerminal.continuationTrace.transportRetryCount, 1);
assert.equal(openCodeAfterEmptyTerminal.continuationTrace.attempts[0].trigger, "empty_terminal_output");
assert.equal(openCodeEmptyTerminalCalls[1].args.includes("--session"), false, "an empty first response must retry the original task without a synthetic continuation turn");

let openCodeMissingSessionCalls = 0;
const openCodeAfterMissingSession = await runOpenCodeOxAlphaTurn({
  requestBody: requestBody(OPENCODE_OXALPHA_MODEL),
  requestShape: { reasoningEffort: "high" },
}, {
  openCodeExecutable: "/fixture/opencode",
  accessSync: () => {},
  mkdirSync: () => {},
  workingDirectory: "/tmp/direct-opencode-missing-session-fixture",
  retryBaseMs: 0,
  sleepImpl: immediateSleep,
  processRunner: async () => {
    openCodeMissingSessionCalls += 1;
    return openCodeMissingSessionCalls === 1
      ? { exitCode: 1, stdout: "" }
      : {
          exitCode: 0,
          stdout: [
            JSON.stringify({ type: "text", sessionID: "ses_after_missing", part: { type: "text", text: "Recovered." } }),
            JSON.stringify({ type: "step_finish", sessionID: "ses_after_missing", part: { type: "step-finish", reason: "stop", tokens: {} } }),
          ].join("\n"),
        };
  },
});
assert.equal(openCodeAfterMissingSession.outputText, "Recovered.");
assert.equal(openCodeAfterMissingSession.continuationTrace.attempts[0].trigger, "opencode_session_identity_missing");

await assert.rejects(
  runOpenCodeOxAlphaTurn({
    attemptId: "fixture-missing-session-output-limit",
    requestBody: requestBody(OPENCODE_OXALPHA_MODEL),
    requestShape: { reasoningEffort: "high" },
  }, {
    openCodeExecutable: "/fixture/opencode",
    accessSync: () => {},
    mkdirSync: () => {},
    workingDirectory: "/tmp/direct-opencode-output-limit-fixture",
    maxAttempts: 1,
    maxOutputChars: 1_000,
    processRunner: async () => ({
      exitCode: 1,
      stdout: JSON.stringify({ type: "text", part: { type: "text", text: "x".repeat(1_001) } }),
    }),
  }),
  (error) => error?.code === "direct_external_provider_output_limit",
  "a missing provider session identity must not bypass the assembled-output limit",
);

let openCodeMalformedCalls = 0;
const openCodeAfterMalformedTail = await runOpenCodeOxAlphaTurn({
  requestBody: requestBody(OPENCODE_OXALPHA_MODEL),
  requestShape: { reasoningEffort: "high" },
}, {
  openCodeExecutable: "/fixture/opencode",
  accessSync: () => {},
  mkdirSync: () => {},
  workingDirectory: "/tmp/direct-opencode-malformed-fixture",
  retryBaseMs: 0,
  sleepImpl: immediateSleep,
  processRunner: async () => {
    openCodeMalformedCalls += 1;
    return openCodeMalformedCalls === 1
      ? {
          exitCode: 1,
          stdout: `${JSON.stringify({ type: "text", sessionID: "ses_malformed", part: { type: "text", text: "Partial " } })}\n{"type":"step_finish"`,
        }
      : {
          exitCode: 0,
          stdout: [
            JSON.stringify({ type: "text", sessionID: "ses_malformed", part: { type: "text", text: "answer." } }),
            JSON.stringify({ type: "step_finish", sessionID: "ses_malformed", part: { type: "step-finish", reason: "stop", tokens: {} } }),
          ].join("\n"),
        };
  },
});
assert.equal(openCodeAfterMalformedTail.outputText, "Partial answer.");
assert.equal(openCodeAfterMalformedTail.continuationTrace.semanticContinuationCount, 1);
assert.equal(openCodeAfterMalformedTail.continuationTrace.attempts[0].trigger, "opencode_json_incomplete");

const rebaseCalls = [];
const recoveredAfterSessionLoss = await runOpenCodeOxAlphaTurn({
  attemptId: "fixture-session-rebase",
  requestBody: requestBody(OPENCODE_OXALPHA_MODEL),
  requestShape: { reasoningEffort: "high" },
}, {
  openCodeExecutable: "/fixture/opencode",
  accessSync: () => {},
  mkdirSync: () => {},
  workingDirectory: "/tmp/direct-opencode-rebase-fixture",
  retryBaseMs: 0,
  sleepImpl: immediateSleep,
  processRunner: async (input) => {
    rebaseCalls.push(input);
    if (rebaseCalls.length === 1) {
      return {
        exitCode: 0,
        stdout: [
          JSON.stringify({ type: "text", sessionID: "ses_rebase", part: { type: "text", text: "Captured first " } }),
          JSON.stringify({ type: "step_finish", sessionID: "ses_rebase", part: { type: "step-finish", reason: "unknown", tokens: {} } }),
        ].join("\n"),
      };
    }
    if (rebaseCalls.length === 2) {
      return {
        exitCode: 1,
        stdout: JSON.stringify({ type: "error", sessionID: "ses_rebase", error: { name: "UnknownError" } }),
      };
    }
    return {
      exitCode: 0,
      stdout: [
        JSON.stringify({ type: "text", sessionID: "ses_rebased_fresh", part: { type: "text", text: "and finished." } }),
        JSON.stringify({ type: "step_finish", sessionID: "ses_rebased_fresh", part: { type: "step-finish", reason: "stop", tokens: {} } }),
      ].join("\n"),
    };
  },
});
assert.equal(recoveredAfterSessionLoss.outputText, "Captured first and finished.");
assert.equal(rebaseCalls[1].args.includes("--session"), true);
assert.equal(rebaseCalls[2].args.includes("--session"), false);
assert.match(rebaseCalls[2].args.at(-1), /\[PROVIDER CONTINUITY REBASE\]/);
assert.match(rebaseCalls[2].args.at(-1), /Captured first/);
assert.equal(
  recoveredAfterSessionLoss.continuationTrace.attempts[1].trigger,
  "opencode_session_continuity_lost",
);
assert.equal(
  recoveredAfterSessionLoss.normalizedEvents.some((event) => event.type === "provider_continuity_rebased"),
  true,
);

await assert.rejects(
  runOpenCodeOxAlphaTurn({
    requestBody: requestBody(OPENCODE_OXALPHA_MODEL),
    requestShape: { reasoningEffort: "high" },
  }, {
    openCodeExecutable: "/fixture/opencode",
    accessSync: () => {},
    mkdirSync: () => {},
    workingDirectory: "/tmp/direct-opencode-fixture",
    processRunner: async () => ({
      exitCode: 0,
      stdout: [
        JSON.stringify({ type: "tool_use", sessionID: "ses_tool", part: { type: "tool", tool: "bash" } }),
        JSON.stringify({ type: "step_finish", sessionID: "ses_tool", part: { type: "step-finish", reason: "stop", tokens: {} } }),
      ].join("\n"),
    }),
  }),
  (error) => error?.code === "direct_opencode_tool_boundary_violated",
);

const isolatedRuntimeDirectory = "/tmp/direct-opencode-isolated-runtime";
const safeOpenCodeEnv = safeOpenCodeRuntimeEnv({
  env: {
    PATH: "/fixture/bin",
    XDG_DATA_HOME: "/home/rose/.local/share",
    OPENCODE_CONFIG: "/home/rose/.config/opencode/opencode.json",
    OPENCODE_TUI_CONFIG: "/home/rose/.config/opencode/tui.json",
    OPENCODE_SERVER_PASSWORD: "must-be-removed",
  },
  openCodeRuntimeDirectory: isolatedRuntimeDirectory,
});
assert.equal(safeOpenCodeEnv.OPENCODE_DISABLE_PROJECT_CONFIG, "1");
assert.equal(safeOpenCodeEnv.OPENCODE_DISABLE_DEFAULT_PLUGINS, "1");
assert.equal(safeOpenCodeEnv.OPENCODE_SERVER_PASSWORD, undefined);
assert.equal(safeOpenCodeEnv.OPENCODE_CONFIG, undefined);
assert.equal(safeOpenCodeEnv.OPENCODE_TUI_CONFIG, undefined);
assert.equal(safeOpenCodeEnv.XDG_DATA_HOME, `${isolatedRuntimeDirectory}/data`);
assert.equal(safeOpenCodeEnv.XDG_CACHE_HOME, `${isolatedRuntimeDirectory}/cache`);
assert.equal(safeOpenCodeEnv.XDG_STATE_HOME, `${isolatedRuntimeDirectory}/state`);
assert.equal(safeOpenCodeEnv.XDG_CONFIG_HOME, `${isolatedRuntimeDirectory}/config`);
assert.equal(safeOpenCodeEnv.OPENCODE_CONFIG_DIR, `${isolatedRuntimeDirectory}/config/opencode`);
assert.equal(safeOpenCodeEnv.XDG_DATA_HOME.includes("/home/rose/.local/share"), false);
assert.deepEqual(JSON.parse(safeOpenCodeEnv.OPENCODE_CONFIG_CONTENT).tools, { "*": false });
assert.equal(JSON.parse(safeOpenCodeEnv.OPENCODE_CONFIG_CONTENT).permission, "deny");

const deterministicRunA = openCodeRunDirectories(
  { attemptId: "same-direct-child" },
  { workingDirectory: "/tmp/direct-opencode-runs" },
);
const deterministicRunB = openCodeRunDirectories(
  { attemptId: "same-direct-child" },
  { workingDirectory: "/tmp/direct-opencode-runs" },
);
const isolatedRun = openCodeRunDirectories(
  { attemptId: "different-direct-child" },
  { workingDirectory: "/tmp/direct-opencode-runs" },
);
assert.deepEqual(deterministicRunA, deterministicRunB);
assert.notEqual(deterministicRunA.runtimeDirectory, isolatedRun.runtimeDirectory);
assert.match(buildOpenCodeRebasePrompt({
  instructions: "Remain bounded.",
  task: "Finish the audit.",
  outputText: "Already captured.",
}), /Already captured\./);

const retentionTempRoot = fs.mkdtempSync(path.join(
  process.platform !== "win32" && fs.existsSync("/tmp") ? "/tmp" : os.tmpdir(),
  "direct-opencode-retention-",
));
try {
  const retentionWorkingDirectory = path.join(retentionTempRoot, "workers");
  const retentionNow = Date.now();
  const retentionOptions = {
    workingDirectory: retentionWorkingDirectory,
    openCodeRetentionMs: 60_000,
    openCodeMaxRetainedRuns: 2,
    openCodeMaxRetainedBytes: 4_096,
  };
  const seedRetainedRun = (attemptId, journalText) => {
    const directories = openCodeRunDirectories({ attemptId }, retentionOptions);
    fs.mkdirSync(directories.runtimeDirectory, { recursive: true, mode: 0o700 });
    fs.mkdirSync(directories.workingDirectory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(directories.runtimeDirectory, "opencode.db"), "disposable-provider-db");
    fs.writeFileSync(path.join(directories.workingDirectory, "scratch.txt"), "disposable-workspace");
    fs.writeFileSync(directories.eventJournalPath, journalText, { mode: 0o600 });
    return directories;
  };

  const expiredRun = seedRetainedRun("retention-expired", "old-journal\n");
  finalizeOpenCodeRunDirectories(expiredRun, {
    ...retentionOptions,
    nowMs: retentionNow - 120_000,
  });
  assert.equal(fs.existsSync(expiredRun.runtimeDirectory), false);
  assert.equal(fs.existsSync(expiredRun.workingDirectory), false);
  assert.equal(fs.existsSync(expiredRun.eventJournalPath), true);
  assert.equal(
    JSON.parse(fs.readFileSync(expiredRun.retentionManifestPath, "utf8")).schema,
    "direct_opencode_run_retention@1",
  );
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(expiredRun.retentionManifestPath).mode & 0o077, 0);
  }

  const currentRun = seedRetainedRun("retention-current", "current-journal\n");
  finalizeOpenCodeRunDirectories(currentRun, { ...retentionOptions, nowMs: retentionNow });
  assert.equal(fs.existsSync(expiredRun.runRoot), false, "expired completed runs must be removed");
  assert.equal(fs.existsSync(currentRun.runRoot), true);

  const countLimitedA = seedRetainedRun("retention-count-a", "count-a\n");
  finalizeOpenCodeRunDirectories(countLimitedA, {
    ...retentionOptions,
    openCodeMaxRetainedRuns: 1,
    nowMs: retentionNow + 1_000,
  });
  const countLimitedB = seedRetainedRun("retention-count-b", "count-b\n");
  finalizeOpenCodeRunDirectories(countLimitedB, {
    ...retentionOptions,
    openCodeMaxRetainedRuns: 1,
    nowMs: retentionNow + 2_000,
  });
  assert.equal(fs.existsSync(countLimitedA.runRoot), false, "count retention must remove older runs");
  assert.equal(fs.existsSync(countLimitedB.runRoot), true);

  const oversizedRun = seedRetainedRun("retention-oversized", "x".repeat(2_048));
  finalizeOpenCodeRunDirectories(oversizedRun, {
    ...retentionOptions,
    openCodeMaxRetainedBytes: 1_024,
    nowMs: retentionNow + 3_000,
  });
  assert.equal(fs.existsSync(oversizedRun.runRoot), false, "byte retention must remove oversized evidence");

  const staleIncomplete = openCodeRunDirectories({ attemptId: "retention-stale-incomplete" }, retentionOptions);
  fs.mkdirSync(staleIncomplete.runRoot, { recursive: true, mode: 0o700 });
  fs.writeFileSync(staleIncomplete.eventJournalPath, "interrupted\n", { mode: 0o600 });
  const staleDate = new Date(retentionNow - 120_000);
  fs.utimesSync(staleIncomplete.runRoot, staleDate, staleDate);
  const pruning = pruneOpenCodeRuns(staleIncomplete.runsRoot, {
    ...retentionOptions,
    nowMs: retentionNow,
  });
  assert(pruning.removed >= 1);
  assert.equal(fs.existsSync(staleIncomplete.runRoot), false, "stale interrupted runs must eventually expire");
} finally {
  fs.rmSync(retentionTempRoot, { recursive: true, force: true });
}

const journalTempRoot = process.platform !== "win32" && fs.existsSync("/tmp") ? "/tmp" : os.tmpdir();
const journalRoot = fs.mkdtempSync(path.join(journalTempRoot, "direct-opencode-journal-"));
try {
  const journalPath = path.join(journalRoot, "provider-events.ndjson");
  const journalChild = new EventEmitter();
  journalChild.stdout = new PassThrough();
  journalChild.stderr = new PassThrough();
  journalChild.exitCode = null;
  journalChild.signalCode = null;
  journalChild.kill = () => true;
  const journalRun = spawnOpenCodeProcess({
    executable: "/fixture/opencode",
    args: ["run"],
    cwd: journalRoot,
    runtimeDirectory: path.join(journalRoot, "runtime"),
    eventJournalPath: journalPath,
    attemptOrdinal: 2,
    maxStdoutChars: 10_000,
  }, {
    spawnImpl: () => {
      setImmediate(() => {
        journalChild.stdout.write(`${JSON.stringify({ type: "text", part: { text: "durable" } })}\n`);
        journalChild.stdout.write(JSON.stringify({ type: "step_finish", part: { reason: "stop" } }));
        journalChild.exitCode = 0;
        journalChild.emit("close", 0, null);
      });
      return journalChild;
    },
  });
  await journalRun;
  const journalRows = fs.readFileSync(journalPath, "utf8").trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(journalRows.length, 2);
  assert.equal(journalRows[0].schema, "direct_opencode_provider_event_journal@1");
  assert.equal(journalRows[0].attemptOrdinal, 2);
  assert.equal(journalRows[0].event.part.text, "durable");
  assert.equal(journalRows[1].event.part.reason, "stop");
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(journalPath).mode & 0o077, 0, "the raw provider journal must remain private");
  }
} finally {
  fs.rmSync(journalRoot, { recursive: true, force: true });
}

const poolCalls = [];
const pool = new DirectNativeAgentPool({
  maxActiveChildren: 2,
  providerProfiles: [
    {
      providerId: PROVIDER_OPENROUTER_OXALPHA,
      status: "ready",
      blockerCode: "",
      model: OPENROUTER_OXALPHA_MODEL,
      transport: "fixture",
      credentials: "available",
      childToolsAllowed: false,
      autoContinuation: true,
      rawSecretIncluded: false,
    },
  ],
  providerTurnRunner: async (input) => {
    poolCalls.push(input);
    return interrupted;
  },
});
const externalLaunch = pool.launch({
  projectId: "project_external_provider",
  primaryThreadId: "thread_external_provider",
  taskName: "oxalpha_audit",
  message: "Audit this bounded object.",
  provider: PROVIDER_OPENROUTER_OXALPHA,
  reasoningEffort: "high",
  forkTurns: "none",
});
assert.equal(externalLaunch.providerId, PROVIDER_OPENROUTER_OXALPHA);
assert.equal(externalLaunch.model, OPENROUTER_OXALPHA_MODEL);
const externalWait = await pool.wait({
  projectId: "project_external_provider",
  primaryThreadId: "thread_external_provider",
  target: externalLaunch.childAgentId,
  timeoutMs: 2_000,
});
assert.equal(externalWait.status, "completed");
assert.equal(poolCalls[0].providerId, PROVIDER_OPENROUTER_OXALPHA);
assert.equal(externalWait.updates[0].continuationTrace.semanticContinuationCount, 1);
assert.equal(JSON.stringify(externalWait.updates[0]).includes("fixture-openrouter-secret"), false);

const unknownProvider = pool.launch({
  projectId: "project_external_provider",
  primaryThreadId: "thread_external_provider",
  taskName: "unknown_provider",
  message: "Do not run.",
  provider: "invented-provider",
});
assert.equal(unknownProvider.status, "blocked");
assert.equal(unknownProvider.blockerCode, "direct_agent_provider_unknown");

const workspaceExternal = pool.launch({
  projectId: "project_external_provider",
  primaryThreadId: "thread_external_provider",
  taskName: "unsafe_workspace_external",
  message: "Do not run.",
  provider: PROVIDER_OPENROUTER_OXALPHA,
  workspaceMode: "isolated_worktree",
  toolProfile: "read_only_worker",
  project: { id: "project_external_provider" },
});
assert.equal(workspaceExternal.status, "blocked");
assert.equal(workspaceExternal.blockerCode, "direct_external_provider_workspace_mode_unsupported");

const externalModelWithoutProvider = pool.launch({
  projectId: "project_external_provider",
  primaryThreadId: "thread_external_provider",
  taskName: "mismatched_external_model",
  message: "Do not run.",
  model: OPENROUTER_OXALPHA_MODEL,
});
assert.equal(externalModelWithoutProvider.status, "blocked");
assert.equal(externalModelWithoutProvider.blockerCode, "direct_agent_provider_model_mismatch");

const tamperedPool = new DirectNativeAgentPool({
  maxActiveChildren: 1,
  providerProfiles: [{
    providerId: PROVIDER_OPENROUTER_OXALPHA,
    status: "ready",
    blockerCode: "",
    model: OPENROUTER_OXALPHA_MODEL,
    transport: "fixture",
    credentials: "available",
    childToolsAllowed: false,
    autoContinuation: true,
    rawSecretIncluded: false,
  }],
  providerTurnRunner: async () => ({
    ...interrupted,
    outputText: `${interrupted.outputText} tampered`,
  }),
});
const tamperedLaunch = tamperedPool.launch({
  projectId: "project_external_provider_tamper",
  primaryThreadId: "thread_external_provider_tamper",
  taskName: "tampered_trace",
  message: "Do not admit mismatched output.",
  provider: PROVIDER_OPENROUTER_OXALPHA,
});
const tamperedWait = await tamperedPool.wait({
  projectId: "project_external_provider_tamper",
  primaryThreadId: "thread_external_provider_tamper",
  target: tamperedLaunch.childAgentId,
  timeoutMs: 2_000,
});
assert.equal(tamperedWait.updates[0].state, "failed");
assert.equal(tamperedWait.updates[0].blockerCode, "direct_external_provider_continuation_trace_invalid");

console.log("direct external provider continuation regression: ok");
