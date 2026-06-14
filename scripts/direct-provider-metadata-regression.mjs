#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DirectServerMetadataAdapter,
  buildDirectProviderMetadataProfile,
  buildDirectMetadataDriftReport,
  validateDirectProviderMetadataProfile,
} = require("../src/main/direct/provider/metadata-adapter.js");

const modelsPayload = {
  data: [
    {
      id: "gpt-5.5",
      model: "gpt-5.5",
      display_name: "GPT-5.5",
      is_default: true,
      supported_reasoning_levels: ["low", "medium", "high", "xhigh"],
      default_reasoning_level: "high",
      service_tiers: [{ id: "standard" }, { id: "fast" }],
      default_service_tier: "standard",
      context_window: 272000,
    },
    {
      id: "gpt-5.4",
      model: "gpt-5.4",
      display_name: "GPT-5.4",
      supported_reasoning_levels: ["low", "medium", "high"],
      default_reasoning_level: "medium",
      service_tiers: ["standard"],
      default_service_tier: "standard",
      context_window: 196000,
    },
    {
      id: "gpt-drift",
      model: "gpt-drift",
      supported_reasoning_levels: ["ultra"],
      default_reasoning_level: "ultra",
    },
  ],
};

const usagePayload = {
  plan_type: "pro",
  rate_limit: {
    primary_window: {
      used_percent: 63,
      limit_window_seconds: 18000,
      reset_at: 1781436900,
    },
    secondary_window: {
      used_percent: 8,
      limit_window_seconds: 604800,
      reset_at: 1781523300,
    },
  },
};

const profile = buildDirectProviderMetadataProfile({
  projectId: "project-test",
  authStatus: { status: "authenticated", authMode: "chatgpt", planType: "pro" },
  credentials: { access_token: "redacted-token", account_id: "acct-test" },
  rawModelsResponse: modelsPayload,
  rawRateLimits: usagePayload,
  modelSource: "server_model_list",
  generatedAt: "2026-06-14T00:00:00.000Z",
});

assert.equal(profile.schema, "direct_provider_metadata_profile@1");
assert.equal(profile.modelCatalog.defaultModel, "gpt-5.5");
assert.equal(profile.modelCatalog.items[0].defaultReasoningEffort, "high");
assert.deepEqual(
  profile.modelCatalog.items[0].supportedReasoningEfforts.map((item) => item.reasoningEffort),
  ["low", "medium", "high", "xhigh"],
);
assert.deepEqual(profile.modelCatalog.items[0].serviceTiers.map((item) => item.id), ["standard", "fast"]);
assert.equal(profile.modelCatalog.items[0].contextWindow, 272000);
assert.equal(profile.usage.quota.status, "available");
assert.equal(profile.usage.quota.planType, "pro");
assert.equal(profile.usage.quota.windows.length, 2);
assert.equal(profile.rawTokenIncluded, false);
assert.equal(profile.rawAccountIdIncluded, false);
assert.equal(profile.rawProviderPayloadIncluded, false);

const validation = validateDirectProviderMetadataProfile(profile);
assert.deepEqual(validation, []);

const drift = buildDirectMetadataDriftReport({
  projectId: "project-test",
  profile,
  fetchStatus: "ok",
  cacheState: "fresh",
});
assert.equal(drift.schema, "direct_metadata_drift_report@1");
assert.equal(drift.status, "changed");
assert.equal(drift.unknownValues.length, 1);
assert.equal(drift.unknownValues[0].value, "ultra");

const badProfile = buildDirectProviderMetadataProfile({
  projectId: "project-test",
  rawModelsResponse: {
    data: [{
      id: "bad",
      supported_reasoning_levels: ["low"],
      default_reasoning_level: "xhigh",
    }],
  },
  modelSource: "server_model_list",
});
assert.equal(validateDirectProviderMetadataProfile(badProfile)[0].reason, "default_not_supported");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "direct-provider-metadata-"));
const fetchCalls = [];
const adapter = new DirectServerMetadataAdapter({
  rootDir: tmpRoot,
  authStoreFactory: () => ({
    readCredentials: () => ({ access_token: "token", account_id: "acct-test" }),
    readStatus: () => ({ status: "authenticated", authMode: "chatgpt", planType: "pro" }),
  }),
  fetchImpl: async (url) => {
    fetchCalls.push(url);
    return {
      ok: true,
      status: 200,
      headers: { get: () => "etag-test" },
      text: async () => JSON.stringify(url.includes("/wham/usage") ? usagePayload : modelsPayload),
    };
  },
});

const refreshed = await adapter.refreshForProject({
  id: "project-test",
  surfaceBinding: { codex: { model: "gpt-5.5", reasoningEffort: "xhigh" } },
});
assert.equal(refreshed.cacheState, "fresh");
assert.equal(refreshed.fetched, true);
assert.equal(refreshed.profile.runtimeSettings.active.reasoningEffort, "xhigh");
assert.equal(fetchCalls.length, 2);

const cached = adapter.cachedStatus("project-test");
assert.equal(cached.cacheState, "fresh");
assert.equal(cached.profile.modelCatalog.items.length, 3);
assert.ok(fs.existsSync(adapter.cachePath("project-test")));

console.log("direct provider metadata regression passed");
