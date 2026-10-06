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
  validateDirectProviderMetadataProfile,
} = require("../src/main/direct/provider/metadata-adapter.js");
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

const catalogPayload = {
  models: [
    { slug: "gpt-old", display_name: "Old", visibility: "hide", priority: 0 },
    { slug: "gpt-luna", display_name: "Luna", visibility: "list", priority: 2 },
    { slug: "gpt-sol", display_name: "Sol", visibility: "list", priority: 1 },
    { slug: "gpt-internal", display_name: "Internal", visibility: "none", priority: 3 },
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
    assert.deepEqual(items.map((item) => item.model), ["gpt-old", "gpt-sol", "gpt-luna", "gpt-internal"]);
    assert.deepEqual(items.filter((item) => !item.hidden).map((item) => item.model), ["gpt-sol", "gpt-luna"]);
    assert.equal(profile.modelCatalog.defaultModel, "gpt-sol");
    assert.equal(items.find((item) => item.model === "gpt-internal").visibility, "none");
    assert.deepEqual(validateDirectProviderMetadataProfile(profile), [], "new descriptor fields must validate");
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

  async function runOneTurn({ fetchImpl, refresher, model = "gpt-luna" }) {
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
    const thread = await surface.request("thread/start", { model });
    const ack = await surface.request("turn/start", { threadId: thread.thread.id, promptText: "hello", clientTurnRequestId: `req_${Date.now()}`, model });
    const deadline = Date.now() + 10_000;
    while (!events.some((event) => event.method === "turn/completed" && event.params?.turnId === ack.turn.id)) {
      if (Date.now() > deadline) throw new Error("turn did not complete");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { events, turnId: ack.turn.id, threadId: thread.thread.id, sessionStore };
  }

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
