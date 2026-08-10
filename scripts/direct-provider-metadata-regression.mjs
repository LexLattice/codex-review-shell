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
      displayName: "GPT-5.5",
      isDefault: true,
      supportedReasoningEfforts: [
        { reasoningEffort: "low", description: "quick checks" },
        { reasoningEffort: "medium", description: "balanced" },
        { reasoningEffort: "high", description: "deep" },
        { reasoningEffort: "xhigh", description: "extra deep" },
      ],
      defaultReasoningEffort: "high",
      serviceTiers: [{ id: "standard", name: "Standard" }, { id: "fast", name: "Fast" }],
      additionalSpeedTiers: ["standard"],
      defaultServiceTier: "standard",
      inputModalities: ["text", "image"],
      supportsPersonality: true,
      upgradeInfo: { model: "gpt-5.6", upgradeCopy: "upgrade available" },
      availabilityNux: { kind: "default" },
      contextWindow: 272000,
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
    null,
    {
      id: "gpt-zero-context",
      model: "gpt-zero-context",
      context_window: 0,
      max_context_window: 0,
    },
  ],
};

const usagePayload = {
  plan_type: "pro",
  summary: {
    lifetime_tokens: 123456,
    peak_daily_tokens: 15000,
    longest_running_turn_sec: 240,
    current_streak_days: 3,
    longest_streak_days: 5,
  },
  daily_usage_buckets: [
    { start_date: "2026-06-14", tokens: 1000 },
    { start_date: "2026-06-15", tokens: 2000 },
  ],
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
  additional_rate_limits: [{
    metered_feature: "codex_other",
    rate_limit: {
      primary_window: {
        used_percent: 0,
        limit_window_seconds: 18000,
        reset_at: 1781443200,
      },
    },
  }],
};

const appServer140RateLimitsPayload = {
  planType: "team",
  rateLimits: {
    limitId: "legacy",
    primary: {
      usedPercent: 44,
      windowDurationMins: 300,
      resetsAt: 1781436900,
    },
  },
  rateLimitsByLimitId: {
    codex: {
      limitId: "codex",
      primary: {
        usedPercent: 63,
        windowDurationMins: 300,
        resetsAt: 1781436900,
      },
      secondary: {
        usedPercent: 8,
        windowDurationMins: 10080,
        resetsAt: 1781523300,
      },
    },
    codex_other: {
      limitName: "Other",
      primary: {
        usedPercent: 3,
        windowDurationMins: 300,
        resetsAt: 1781443200,
      },
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
assert.equal(profile.modelCatalog.items[0].availabilityState, "available_with_nux");
assert.equal(profile.modelCatalog.items[0].upgradeInfo.model, "gpt-5.6");
assert.deepEqual(profile.modelCatalog.items[0].inputModalities, ["text", "image"]);
assert.equal(profile.modelCatalog.items[0].supportsPersonality, true);
const zeroContext = profile.modelCatalog.items.find((item) => item.id === "gpt-zero-context");
assert.equal(zeroContext.contextWindow, 0);
assert.equal(zeroContext.maxContextWindow, 0);
assert.equal(profile.usage.quota.status, "available");
assert.equal(profile.usage.quota.planType, "pro");
assert.equal(profile.usage.quota.windows.length, 3);
assert(profile.usage.quota.windows.some((window) => window.windowId === "codex:secondary" && window.windowKind === "weekly"));
assert(profile.usage.quota.windows.some((window) => window.windowId === "codex_other:primary" && window.windowKind === "five_hour"));
assert.equal(profile.usage.accountTokenProfile.status, "unknown");
assert.equal(profile.rawTokenIncluded, false);
assert.equal(profile.rawAccountIdIncluded, false);
assert.equal(profile.rawProviderPayloadIncluded, false);

const validation = validateDirectProviderMetadataProfile(profile);
assert.deepEqual(validation, []);

const appServer140Profile = buildDirectProviderMetadataProfile({
  projectId: "project-test",
  authStatus: { status: "authenticated", authMode: "chatgpt", planType: "team" },
  credentials: { access_token: "redacted-token", account_id: "acct-test" },
  rawModelsResponse: modelsPayload,
  rawRateLimits: appServer140RateLimitsPayload,
  rawAccountTokenProfile: usagePayload,
  modelSource: "server_model_list",
  generatedAt: "2026-06-14T00:00:00.000Z",
});
assert.equal(appServer140Profile.usage.quota.planType, "team");
assert.equal(appServer140Profile.usage.quota.windows.length, 3);
assert(appServer140Profile.usage.quota.windows.some((window) => window.windowId === "codex:secondary" && window.windowKind === "weekly"));
assert(!appServer140Profile.usage.quota.windows.some((window) => window.windowId === "legacy:primary"), "legacy mirror must not duplicate rateLimitsByLimitId");
assert.equal(appServer140Profile.usage.accountTokenProfile.status, "available");
assert.equal(appServer140Profile.usage.accountTokenProfile.lifetimeTokens, 123456);
assert.equal(appServer140Profile.usage.accountTokenProfile.dailyBuckets.length, 2);

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
assert.ok(drift.missingRequiredFields.includes("models[3]"));

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
assert.equal(cached.profile.modelCatalog.items.length, 4);
assert.ok(fs.existsSync(adapter.cachePath("project-test")));

let credentialRecord = {
  access_token: "expired-token",
  refresh_token: "refresh-token",
  expiresAt: Date.now() - 1000,
  account_id: "acct-test",
};
let refreshCalls = 0;
const refreshAdapter = new DirectServerMetadataAdapter({
  rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "direct-provider-metadata-refresh-")),
  authStoreFactory: () => ({
    readCredentials: () => credentialRecord,
    readStatus: () => ({ status: "authenticated", authMode: "chatgpt", planType: "pro" }),
  }),
  refreshCredentials: async () => {
    refreshCalls += 1;
    credentialRecord = { ...credentialRecord, access_token: "fresh-token", expiresAt: Date.now() + 300000 };
    return { ok: true, status: "authenticated" };
  },
  fetchImpl: async (_url, options) => {
    assert.equal(options.headers.Authorization, "Bearer fresh-token");
    return {
      ok: true,
      status: 200,
      headers: { get: () => "" },
      text: async () => JSON.stringify(modelsPayload),
    };
  },
});
await refreshAdapter.refreshForProject({ id: "refresh-project" });
assert.equal(refreshCalls, 1);

let retryCredentialRecord = {
  access_token: "stale-token",
  refresh_token: "refresh-token",
  expiresAt: Date.now() + 300000,
  account_id: "acct-test",
};
let retryRefreshCalls = 0;
let retryFetchCalls = 0;
const retryAdapter = new DirectServerMetadataAdapter({
  rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "direct-provider-metadata-retry-")),
  authStoreFactory: () => ({
    readCredentials: () => retryCredentialRecord,
    readStatus: () => ({ status: "authenticated", authMode: "chatgpt", planType: "pro" }),
  }),
  refreshCredentials: async () => {
    retryRefreshCalls += 1;
    retryCredentialRecord = { ...retryCredentialRecord, access_token: "retried-token" };
    return { ok: true, status: "authenticated" };
  },
  fetchImpl: async (_url, options) => {
    retryFetchCalls += 1;
    if (options.headers.Authorization === "Bearer stale-token") {
      return {
        ok: false,
        status: 401,
        headers: { get: () => "" },
        text: async () => "expired",
      };
    }
    assert.equal(options.headers.Authorization, "Bearer retried-token");
    return {
      ok: true,
      status: 200,
      headers: { get: () => "" },
      text: async () => JSON.stringify(modelsPayload),
    };
  },
});
const retryResult = await retryAdapter.refreshForProject({ id: "retry-project" });
assert.equal(retryResult.fetched, true);
assert.equal(retryRefreshCalls, 1);
assert.ok(retryFetchCalls >= 2);

console.log("direct provider metadata regression passed");
