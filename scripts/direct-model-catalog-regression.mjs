#!/usr/bin/env node
// Direct follows Codex's model catalog rules: the picker is the account's
// /models list (visibility "list", by priority), signed in is ready, a
// refused model fails the turn clearly and refreshes the list, and a changed
// X-Models-Etag refreshes it too. "Test model" is an optional diagnostic.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  DirectServerMetadataAdapter,
  PINNED_CODEX_CLIENT_VERSION,
  buildDirectProviderMetadataProfile,
  detectCodexClientVersion,
  normalizeModelDescriptor,
  validateDirectProviderMetadataProfile,
} = require("../src/main/direct/provider/metadata-adapter.js");
const {
  buildReadOnlyToolContinuationProbeRequest,
  buildTextOnlyProbeRequest,
} = require("../src/main/direct/transport/codex-responses-transport.js");
const {
  buildDirectWorkbenchProjectBindingDraft,
} = require("../src/main/direct/project/project-directory.js");
const {
  DirectLiveTextController,
  DirectLiveTextSurfaceSession,
} = require("../src/main/direct/controller/live-text-controller.js");
const { DirectSessionStore } = require("../src/main/direct/session/session-store.js");
const { createDirectAuthStore } = require("../src/main/direct/auth/auth-store.js");
const { loadDirectCodexProfile } = require("../src/main/direct/odeu-profile/profile-loader.js");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "direct-model-catalog-"));
let checks = 0;
const check = (name, fn) => Promise.resolve().then(fn).then(() => {
  checks += 1;
  console.log(`ok - ${name}`);
});

function jsonResponse(body, status = 200, headers = {}) {
  const text = JSON.stringify(body);
  return textResponse(text, status, { "content-type": "application/json", ...headers });
}

function textResponse(text, status = 200, headers = {}) {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  const lower = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? "OK" : "Error",
    headers: { get: (name) => lower[String(name || "").toLowerCase()] || null },
    body: {
      getReader() {
        return {
          async read() {
            if (offset >= bytes.length) return { done: true, value: undefined };
            const value = bytes.slice(offset);
            offset = bytes.length;
            return { done: false, value };
          },
          cancel() {},
        };
      },
    },
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}

// Shapes follow the live /codex/models response: Fast is the "priority" tier
// (with "fast" repeated in additional_speed_tiers), and Daybreak support is
// `available_access_programs.cyber`.
const fastTier = [{ id: "priority", name: "Fast", description: "2x speed, increased usage" }];
const catalogPayload = {
  models: [
    { slug: "gpt-old", display_name: "Old", visibility: "hide", priority: 0 },
    {
      slug: "gpt-luna", display_name: "Luna", visibility: "list", priority: 2,
      service_tiers: fastTier, additional_speed_tiers: ["fast"],
      available_access_programs: { cyber: ["standard", "daybreak_blue"] },
    },
    {
      slug: "gpt-sol", display_name: "Sol", visibility: "list", priority: 1,
      service_tiers: fastTier, additional_speed_tiers: ["fast"],
      available_access_programs: { cyber: ["standard"] },
    },
    { slug: "gpt-internal", display_name: "Internal", visibility: "none", priority: 3 },
    {
      slug: "gpt-daybreak", display_name: "Daybreak Blue", visibility: "list", priority: 11,
      model_specialty: "cyber", service_tiers: [],
      available_access_programs: { cyber: ["daybreak_blue"] },
    },
  ],
};

function signedInStore(accountId = "account-a") {
  const store = createDirectAuthStore({ mode: "memory" });
  store.writeCredentials({
    accessToken: `access_${accountId}_secret_1234567890`,
    refreshToken: `refresh_${accountId}_secret_1234567890`,
    expiresAt: Date.now() + 3_600_000,
    accountId,
  });
  return store;
}

const sse = (text, id = "resp_catalog") => [
  "event: response.created",
  `data: {"response":{"id":"${id}","model":"gpt-luna"}}`,
  "",
  "event: response.output_text.delta",
  `data: {"item_id":"msg_${id}","delta":"${text}"}`,
  "",
  "event: response.completed",
  `data: {"response":{"id":"${id}","status":"completed","usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}`,
  "",
  "data: [DONE]",
  "",
].join("\n");

try {
  await check("catalog lists only visibility=list models, ordered by priority; default is the first listed", () => {
    const profile = buildDirectProviderMetadataProfile({
      projectId: "p",
      rawModelsResponse: catalogPayload,
      modelSource: "server_model_list",
      credentials: { accessToken: "x", accountId: "a" },
    });
    const items = profile.modelCatalog.items;
    assert.deepEqual(items.map((item) => item.model), ["gpt-old", "gpt-sol", "gpt-luna", "gpt-internal", "gpt-daybreak"]);
    assert.deepEqual(items.filter((item) => !item.hidden).map((item) => item.model), ["gpt-sol", "gpt-luna", "gpt-daybreak"]);
    assert.equal(profile.modelCatalog.defaultModel, "gpt-sol");
    assert.equal(items.find((item) => item.model === "gpt-internal").visibility, "none");
    assert.deepEqual(validateDirectProviderMetadataProfile(profile), [], "new descriptor fields must validate");
  });

  await check("the catalog keeps Fast as one 'priority' tier and each model's Daybreak support", () => {
    const profile = buildDirectProviderMetadataProfile({
      projectId: "p",
      rawModelsResponse: catalogPayload,
      modelSource: "server_model_list",
      credentials: { accessToken: "x", accountId: "a" },
    });
    const byModel = Object.fromEntries(profile.modelCatalog.items.map((item) => [item.model, item]));
    assert.deepEqual(byModel["gpt-sol"].serviceTiers.map((tier) => [tier.id, tier.name]), [["priority", "Fast"]], "the 'fast' alias collapses into 'priority'");
    assert.deepEqual(byModel["gpt-sol"].accessPrograms, { cyber: ["standard"] });
    assert.deepEqual(byModel["gpt-luna"].accessPrograms, { cyber: ["standard", "daybreak_blue"] });
    assert.equal(byModel["gpt-old"].accessPrograms, null, "a missing field stays unknown, not unsupported");
    assert.equal(byModel["gpt-daybreak"].modelSpecialty, "cyber");
    const camel = normalizeModelDescriptor({ slug: "x", availableAccessPrograms: { cyber: ["daybreakBlue", "someday_new"] } }, 0, { missingRequiredFields: [], changedFields: [], unknownValues: [] });
    assert.deepEqual(camel.accessPrograms, { cyber: ["daybreak_blue"] }, "camelCase is accepted and unknown programs are ignored");
    const empty = normalizeModelDescriptor({ slug: "y", available_access_programs: { cyber: [] } }, 0, { missingRequiredFields: [], changedFields: [], unknownValues: [] });
    assert.deepEqual(empty.accessPrograms, { cyber: [] }, "an explicit empty list stays distinct from missing");
  });

  await check("client_version comes from the installed Codex CLI, else env override, else the pinned release", () => {
    const files = { "/home/u/.npm-global/lib/node_modules/@openai/codex/package.json": JSON.stringify({ version: "0.161.0-alpha.3" }) };
    const readFile = (file) => {
      if (files[file] === undefined) throw new Error("ENOENT");
      return files[file];
    };
    const listDir = () => { throw new Error("ENOENT"); };
    assert.deepEqual(detectCodexClientVersion({ env: { HOME: "/home/u", PATH: "/usr/bin" }, platform: "linux", readFile, listDir }), { version: "0.161.0", source: "installed_codex_cli" });
    assert.deepEqual(detectCodexClientVersion({ env: { CODEX_DIRECT_CLIENT_VERSION: "0.170.1", HOME: "/home/u" }, platform: "linux", readFile, listDir }), { version: "0.170.1", source: "env" });
    assert.deepEqual(detectCodexClientVersion({ env: { HOME: "/nobody" }, platform: "linux", readFile, listDir }), { version: PINNED_CODEX_CLIENT_VERSION, source: "pinned" });
    const winFiles = { "C:\\Users\\u\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\package.json": JSON.stringify({ version: "0.160.0" }) };
    assert.deepEqual(detectCodexClientVersion({
      env: { APPDATA: "C:\\Users\\u\\AppData\\Roaming", Path: "C:\\Windows" },
      platform: "win32",
      readFile: (file) => { if (!winFiles[file]) throw new Error("ENOENT"); return winFiles[file]; },
      listDir,
    }), { version: "0.160.0", source: "installed_codex_cli" });
  });

  await check("the adapter sends client_version and never serves another account's catalog", async () => {
    let activeStore = signedInStore("account-a");
    const requested = [];
    const adapter = new DirectServerMetadataAdapter({
      rootDir: path.join(tempRoot, "metadata"),
      authStoreFactory: () => activeStore,
      clientVersion: "0.161.0",
      fetchImpl: async (url) => {
        requested.push(String(url));
        return String(url).includes("/models")
          ? jsonResponse(catalogPayload, 200, { etag: "\"catalog-v1\"" })
          : jsonResponse({});
      },
    });
    const project = { id: "project_catalog" };
    const refreshed = await adapter.refreshForProject(project);
    assert.equal(refreshed.fetched, true);
    assert.equal(refreshed.cacheState, "fresh");
    assert.ok(requested.some((url) => url.includes("client_version=0.161.0")), "models request carries client_version");
    assert.equal(refreshed.profile.modelCatalog.etag, "\"catalog-v1\"");
    assert.equal(adapter.cachedStatus(project.id).cacheState, "fresh");

    activeStore = signedInStore("account-b");
    adapter.accountKeyMemo = { at: 0, key: "" };
    const other = adapter.cachedStatus(project.id);
    assert.equal(other.cacheState, "missing");
    assert.equal(other.reason, "provider_metadata_account_changed");
    assert.equal(other.profile.modelCatalog.items.length, 0);
  });

  const profileDoc = loadDirectCodexProfile();
  const metadataStatus = (cacheState = "fresh") => ({
    profile: buildDirectProviderMetadataProfile({
      projectId: "project_catalog",
      rawModelsResponse: catalogPayload,
      modelSource: "server_model_list",
      etag: "\"catalog-v1\"",
      credentials: { accessToken: "x", accountId: "account-a" },
    }),
    cacheState,
  });
  const project = {
    id: "project_catalog",
    name: "Catalog",
    workspace: { kind: "local", localPath: tempRoot },
    surfaceBinding: { codex: { runtimeMode: "direct", directTransport: "live-text", model: "gpt-luna" } },
  };

  await check("signed in is ready for any model; list membership is informational", () => {
    const controller = new DirectLiveTextController({
      sessionStore: new DirectSessionStore({ rootDir: path.join(tempRoot, "sessions-ready") }),
      profileDoc,
      authStore: signedInStore(),
      providerMetadataResolver: () => metadataStatus(),
    });
    const listed = controller.statusForProject(project);
    assert.equal(listed.status, "ready");
    assert.equal(listed.providerListed, true);
    assert.equal(listed.modelEvidenceState, "provider_listed");
    assert.equal(listed.modelSource, "provider_model_catalog");
    const unlisted = controller.statusForProject(project, { model: "gpt-old" });
    assert.equal(unlisted.status, "ready", "a hidden model still runs; the provider decides");
    assert.equal(unlisted.providerListed, false);
    assert.equal(unlisted.modelEvidenceState, "provider_unlisted");
    const unconfigured = controller.statusForProject({ ...project, surfaceBinding: { codex: { runtimeMode: "direct" } } });
    assert.equal(unconfigured.model, "gpt-sol", "no configured model uses the catalog default");

    const signedOut = new DirectLiveTextController({
      sessionStore: new DirectSessionStore({ rootDir: path.join(tempRoot, "sessions-signed-out") }),
      profileDoc,
      authStore: createDirectAuthStore({ mode: "memory" }),
      providerMetadataResolver: () => metadataStatus(),
    });
    const status = signedOut.statusForProject(project);
    assert.equal(status.status, "auth_required");
    assert.throws(() => signedOut.assertReady(project), (error) => error.code === "auth_required" && /isn't signed in/.test(error.message));
  });

  await check("a project model the list no longer offers gives way to the list's default; explicit models stay", () => {
    const controller = new DirectLiveTextController({
      sessionStore: new DirectSessionStore({ rootDir: path.join(tempRoot, "sessions-stale-default") }),
      profileDoc,
      authStore: signedInStore(),
      providerMetadataResolver: () => metadataStatus(),
    });
    const staleProject = { ...project, surfaceBinding: { codex: { ...project.surfaceBinding.codex, model: "gpt-5.5" } } };
    assert.equal(controller.defaultModelForProject(staleProject), "gpt-sol");
    const status = controller.statusForProject(staleProject);
    assert.equal(status.model, "gpt-sol");
    assert.equal(status.modelSource, "provider_model_catalog_default");
    assert.equal(controller.modelEvidenceForProject(staleProject).configuredModelUnavailable, "gpt-5.5");
    const explicit = controller.statusForProject(staleProject, { model: "gpt-5.5" });
    assert.equal(explicit.model, "gpt-5.5", "an explicit thread model is never replaced");
    assert.equal(explicit.providerListed, false);
    assert.equal(controller.defaultModelForProject(project), "gpt-luna", "a listed project model stays the default");
    const noList = new DirectLiveTextController({
      sessionStore: new DirectSessionStore({ rootDir: path.join(tempRoot, "sessions-no-list") }),
      profileDoc,
      authStore: signedInStore(),
    });
    assert.equal(noList.defaultModelForProject(staleProject), "gpt-5.5", "without a list the configured model is kept");

    const main = fs.readFileSync(path.join(repoRoot, "src/main.js"), "utf8");
    assert.match(main, /const effectiveModel = model \|\| ensureDirectLiveTextController\(\)\.defaultModelForProject\(project\) \|\| directSession\.model;/);
    assert.match(main, /\(configuredListed \? codexBinding\.model : ""\) \|\|/);
  });

  await check("the picker button shows the picked model at once, and the default follows the list", () => {
    const renderer = fs.readFileSync(path.join(repoRoot, "src/renderer/codex-surface.js"), "utf8");
    assert.match(renderer, /if \(isDirectLiveTextSurface\(\)\) return state\.runtimeOverrides\.model \|\| state\.activeModel \|\| directDefaultModelId\(\);/);
    assert.match(renderer, /function directDefaultModelId\(\) \{[\s\S]*?directModelListed\(configured\)[\s\S]*?return defaultModelId\(\) \|\| configured;/);
    assert.match(renderer, /function clearedModelId\(\) \{[\s\S]*?if \(isDirectLiveTextSurface\(\)\) return directDefaultModelId\(\);/);
    const label = renderer.slice(renderer.indexOf("function compactModelLabel()"), renderer.indexOf("function setRuntimeOverride("));
    assert.ok(label.indexOf("activeModelId()") < label.indexOf("directModelLabel()"), "the picked model wins over the saved-binding witness");
  });

  async function runOneTurn({ fetchImpl, refresher, model = "gpt-luna", threadOptions = {}, turnOptions = {} }) {
    const sessionStore = new DirectSessionStore({ rootDir: fs.mkdtempSync(path.join(tempRoot, "sessions-")) });
    const controller = new DirectLiveTextController({
      sessionStore,
      profileDoc,
      authStore: signedInStore(),
      providerMetadataResolver: () => metadataStatus(),
      providerCatalogRefresher: refresher,
      fetchImpl,
    });
    const events = [];
    const surface = new DirectLiveTextSurfaceSession({ isDestroyed: () => false, send: (_channel, payload) => events.push(payload) }, { controller, project });
    await surface.connect({});
    const thread = await surface.request("thread/start", { model, ...threadOptions });
    const ack = await surface.request("turn/start", { threadId: thread.thread.id, promptText: "hello", clientTurnRequestId: `req_${Date.now()}`, model, ...turnOptions });
    const deadline = Date.now() + 10_000;
    while (!events.some((event) => event.method === "turn/completed" && event.params?.turnId === ack.turn.id)) {
      if (Date.now() > deadline) throw new Error("turn did not complete");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { events, turnId: ack.turn.id, threadId: thread.thread.id, sessionStore };
  }

  await check("a thread's Fast and Daybreak are sent only when its model offers them", async () => {
    const captureTurn = async (model, threadOptions, turnOptions = {}) => {
      let body = null;
      const run = await runOneTurn({
        model,
        threadOptions,
        turnOptions,
        fetchImpl: async (_url, init) => {
          body = JSON.parse(init.body);
          return textResponse(sse("ok"), 200, { "content-type": "text/event-stream" });
        },
      });
      const turn = run.sessionStore.readTurn(run.threadId, run.turnId);
      return { body, turn, session: run.sessionStore.readSession(run.threadId) };
    };
    // "fast" (the legacy alias) is stored as "priority".
    const luna = await captureTurn("gpt-luna", { serviceTier: "fast", daybreakEnabled: true });
    assert.equal(luna.session.serviceTier, "priority");
    assert.equal(luna.session.daybreakEnabled, true);
    assert.equal(luna.body.service_tier, "priority");
    assert.deepEqual(luna.body.access_programs, { cyber: "daybreak_blue" });
    assert.equal(luna.turn.cyberAccessProgram, "daybreak_blue", "the turn records Daybreak for its continuations");

    const sol = await captureTurn("gpt-sol", { serviceTier: "priority", daybreakEnabled: true });
    assert.equal(sol.body.service_tier, "priority");
    assert.equal(sol.body.access_programs, undefined, "Sol doesn't offer Daybreak, so it isn't requested");
    assert.equal(sol.session.daybreakEnabled, true, "the thread keeps its choice for a model that offers it");

    const daybreakModel = await captureTurn("gpt-daybreak", { serviceTier: "priority" });
    assert.equal(daybreakModel.body.service_tier, undefined, "a model without the Fast tier gets none");
    assert.equal(daybreakModel.turn.serviceTier, "", "and the turn records no tier, so continuations send none");

    const off = await captureTurn("gpt-luna", {});
    assert.equal(off.body.service_tier, undefined);
    assert.equal(off.body.access_programs, undefined, "Daybreak off omits the field (backend default)");
    assert.equal(off.session.daybreakEnabled, false, "new threads start with Daybreak off");

    const turnOff = await captureTurn("gpt-luna", { daybreakEnabled: true }, { daybreakEnabled: false });
    assert.equal(turnOff.body.access_programs, undefined, "the owner's turn choice wins over the thread's");
  });

  await check("every request in a turn carries the turn's effort, Fast, and Daybreak", () => {
    const continuation = buildReadOnlyToolContinuationProbeRequest({
      model: "gpt-luna",
      reasoningEffort: "high",
      serviceTier: "priority",
      cyberAccessProgram: "daybreak_blue",
      continuationRequest: {
        toolResult: { callId: "call_1", outputType: "function_call_output", content: [{ type: "text", text: "file contents" }] },
        source: { previousResponseId: "resp_1" },
      },
      prompt: "continue",
    });
    assert.equal(continuation.service_tier, "priority");
    assert.deepEqual(continuation.access_programs, { cyber: "daybreak_blue" });
    const chained = buildReadOnlyToolContinuationProbeRequest({
      model: "gpt-luna",
      serviceTier: "priority",
      cyberAccessProgram: "daybreak_blue",
      continuationTransportMode: "previous_response_id",
      continuationRequest: {
        toolResult: { callId: "call_2", outputType: "function_call_output", content: [{ type: "text", text: "more" }] },
        source: { previousResponseId: "resp_2" },
      },
    });
    assert.deepEqual(chained.access_programs, { cyber: "daybreak_blue" }, "the previous_response_id path carries it too");
    const plain = buildTextOnlyProbeRequest({ model: "gpt-luna", prompt: "hi", cyberAccessProgram: "not-a-program" });
    assert.equal(plain.access_programs, undefined, "unknown programs are never sent");
    const transport = fs.readFileSync(path.join(repoRoot, "src/main/direct/transport/codex-responses-transport.js"), "utf8");
    const persisted = transport.slice(transport.indexOf("async function runPersistedReadOnlyToolContinuation("));
    assert.match(persisted, /reasoningEffort: options\.reasoningEffort \?\? normalizeString\(existingTurn\.reasoningEffort, ""\),\s*serviceTier: options\.serviceTier \?\? normalizeString\(existingTurn\.serviceTier, ""\),\s*cyberAccessProgram: options\.cyberAccessProgram \?\? normalizeString\(existingTurn\.cyberAccessProgram, ""\),/);
  });

  await check("Fast and Daybreak are saved per thread; the project sets the model for new threads", () => {
    const main = fs.readFileSync(path.join(repoRoot, "src/main.js"), "utf8");
    assert.match(main, /serviceTier: normalizeDirectThreadServiceTier\(directSession\.serviceTier\),\s*daybreakEnabled: directSession\.daybreakEnabled === true,/);
    assert.match(main, /daybreakEnabled: Object\.prototype\.hasOwnProperty\.call\(payload, "daybreakEnabled"\)/);
    assert.match(main, /daybreakEnabled: options\.directSessionMutation\.nextSession\.daybreakEnabled === true,/);
    assert.match(main, /const codexBinding = typeof operation\.defaultModel === "string"\s*\? \{ \.\.\.alignedBinding, model: operation\.defaultModel \}/);

    const config = {
      selectedProjectId: "p1",
      projects: [{ id: "p1", name: "One", workspace: { kind: "local", localPath: "/tmp/one" }, surfaceBinding: { codex: { runtimeMode: "direct", directTransport: "live-text", directTier: "implementation-lane", model: "gpt-5.5" } } }],
    };
    const draft = buildDirectWorkbenchProjectBindingDraft(config, { projectId: "p1" });
    assert.equal(draft.fields.defaultModel, "gpt-5.5");
    assert.equal(buildDirectWorkbenchProjectBindingDraft(config, {}).fields.defaultModel, "", "a new project starts on Recommended");
    const validator = fs.readFileSync(path.join(repoRoot, "src/main/direct/project/project-directory.js"), "utf8");
    assert.match(validator, /project_binding_default_model_invalid/);
  });

  await check("the composer picker: effort view with Fast and reset, model view with Daybreak; no Default row", () => {
    const renderer = fs.readFileSync(path.join(repoRoot, "src/renderer/codex-surface.js"), "utf8");
    assert.match(renderer, /if \(isDirectLiveTextSurface\(\)\) \{\s*renderDirectComposerMenu\(\);\s*return;\s*\}/);
    assert.match(renderer, /return directListedModels\(\)\.filter\(\(model\) => String\(model\?\.modelSpecialty \|\| ""\) !== "cyber"\);/);
    assert.match(renderer, /`Daybreak isn't available for \$\{name\}\.`/);
    assert.match(renderer, /daybreakSwitch\.disabled = daybreakSupport !== "supported";/);
    assert.match(renderer, /disabled: !fastSupported,/);
    assert.match(renderer, /setRuntimeOverride\("serviceTier", fastOn \? "" : "priority"\);/);
    assert.match(renderer, /setRuntimeOverride\("reasoningEffort", modelDefault\);/);
    assert.match(renderer, /const DIRECT_THREAD_MODEL_PREFERENCE_FIELDS = Object\.freeze\(\["model", "reasoningEffort", "serviceTier", "daybreakEnabled"\]\);/);
    assert.match(renderer, /async function startNewThread\(\) \{\s*if \(isDirectLiveTextSurface\(\)\) resetDirectThreadRuntimeOverrides\(\);/);
    assert.match(renderer, /target\.serviceTier = "";\s*target\.daybreakEnabled = false;/);
    assert.match(renderer, /globalThis\.DirectModelCatalog = Object\.freeze\(/);
    const view = renderer.slice(renderer.indexOf("function directModelListView()"), renderer.indexOf("function renderDirectComposerMenu()"));
    assert.doesNotMatch(view, /defaultOptionLabel|Recommended/, "the thread picker has no Default row; the default lives in project settings");
    const editor = fs.readFileSync(path.join(repoRoot, "src/renderer/direct-project-directory-surface.js"), "utf8");
    assert.match(editor, /add\("", recommended \? `Recommended \(now \$\{recommended\.displayName\}\)` : "Recommended"\);/);
    assert.match(editor, /\.\.\.\(editorDefaultModel \? \{ defaultModel: editorDefaultModel\.value \} : \{\}\),/);
    const html = fs.readFileSync(path.join(repoRoot, "src/renderer/t3-direct-surface.html"), "utf8");
    assert.match(html, /<select id="directProjectBindingDefaultModel" name="defaultModel">/);
  });

  await check("a refused model fails the turn with the provider's reason and refreshes the list", async () => {
    const refreshes = [];
    const { events } = await runOneTurn({
      fetchImpl: async () => jsonResponse({ detail: "The 'gpt-luna' model is not supported when using Codex with a ChatGPT account." }, 400),
      refresher: (input) => { refreshes.push(input.reason); return Promise.resolve(); },
    });
    const error = events.find((event) => event.method === "error")?.params?.error;
    assert.equal(error?.code, "model_unavailable");
    assert.match(error.message, /refused model gpt-luna/);
    assert.match(error.message, /is not supported when using Codex with a ChatGPT account/);
    assert.doesNotMatch(error.message, /\{"detail"/, "the raw JSON body is not shown");
    assert.deepEqual(refreshes, ["model_rejected"]);
  });

  await check("other failures are not reported as a refused model", async () => {
    const refreshes = [];
    const { events } = await runOneTurn({
      fetchImpl: async () => jsonResponse({ detail: "Rate limit reached" }, 429),
      refresher: (input) => { refreshes.push(input.reason); return Promise.resolve(); },
    });
    const error = events.find((event) => event.method === "error")?.params?.error;
    assert.notEqual(error?.code, "model_unavailable");
    assert.deepEqual(refreshes, []);
  });

  await check("a changed X-Models-Etag refreshes the list; the same ETag does not", async () => {
    const refreshes = [];
    const refresher = (input) => { refreshes.push(input.reason); return Promise.resolve(); };
    await runOneTurn({
      fetchImpl: async () => textResponse(sse("same"), 200, { "content-type": "text/event-stream", "x-models-etag": "\"catalog-v1\"" }),
      refresher,
    });
    assert.deepEqual(refreshes, []);
    await runOneTurn({
      fetchImpl: async () => textResponse(sse("changed"), 200, { "content-type": "text/event-stream", "x-models-etag": "\"catalog-v2\"" }),
      refresher,
    });
    assert.deepEqual(refreshes, ["models_etag_changed"]);
  });

  await check("main refreshes sign-in plus the list, and keeps the probe only as Test model", () => {
    const main = fs.readFileSync(path.join(repoRoot, "src/main.js"), "utf8");
    const preload = fs.readFileSync(path.join(repoRoot, "src/preload-codex-surface.js"), "utf8");
    assert.match(main, /clientVersion: detectCodexClientVersion\(\)\.version/);
    assert.match(main, /const DIRECT_MODEL_CATALOG_REFRESH_MS = 270_000;/);
    assert.match(main, /providerCatalogRefresher: \(\{ project \}\) => refreshDirectProviderMetadataForProject\(project\)/);
    assert.match(main, /if \(payload\.testModel !== true\) \{\s*steps\.push\(directEmbarkStep\("model_catalog_refresh"/);
    assert.match(main, /ipcMain\.handle\("direct-runtime:test-model"/);
    assert.match(main, /if \(directModelCatalogRefreshes\.has\(key\)\) return directModelCatalogRefreshes\.get\(key\);/);
    assert.match(preload, /testDirectModel: \(projectId, threadId = ""\) =>\s*ipcRenderer\.invoke\("direct-runtime:test-model"/);
    const activation = fs.readFileSync(path.join(repoRoot, "src/main/direct/runtime/project-activation.js"), "utf8");
    assert.doesNotMatch(activation, /liveProbeUsable/);
  });

  await check("the picker offers only listed models and shows an unlisted current model as unavailable", () => {
    const renderer = fs.readFileSync(path.join(repoRoot, "src/renderer/codex-surface.js"), "utf8");
    assert.match(renderer, /function effectiveModels\(\) \{\s*return isDirectLiveTextSurface\(\) \? directMetadataModels\(\) : state\.models;\s*\}/);
    assert.match(renderer, /const rows = visible\.length \|\| isDirectLiveTextSurface\(\) \? visible : models;/);
    assert.match(renderer, /label: `\$\{current\} · unavailable`, disabled: true/);
    assert.match(renderer, /if \(typeof option === "object" && option\.disabled\) \{\s*button\.disabled = true;/);
    assert.match(renderer, /directSurfaceProjection\(\)\?\.metadataCacheState !== "fresh"/);
    assert.match(renderer, /if \(error\.code === "model_unavailable" && isDirectLiveTextSurface\(\)\) \{\s*refreshModelList\(false\)/);
    assert.match(renderer, /const declared = String\(directProviderMetadataProfile\(\)\?\.modelCatalog\?\.defaultModel \|\| ""\)\.trim\(\);/);
    assert.doesNotMatch(renderer, /live_probe_evidence_/);
    assert.doesNotMatch(renderer, /Direct readiness verified/);
  });

  console.log(`direct-model-catalog-regression: ${checks} checks passed`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
