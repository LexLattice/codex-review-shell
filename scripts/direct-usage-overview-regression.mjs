import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  PRICING_REVISION,
  estimatedCost,
  pricingFor,
  readDirectUsageOverview,
} = require("../src/main/direct/usage/overview.js");

const root = await fs.mkdtemp(path.join(os.tmpdir(), "direct-usage-overview-"));
const writeJsonl = async (filePath, rows) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
};

try {
  const claudeRecord = {
    type: "assistant",
    timestamp: "2026-08-18T10:00:00.000Z",
    requestId: "request-1",
    cwd: "/work/claude-project",
    message: {
      id: "message-1",
      model: "claude-sonnet-5",
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 20,
        cache_creation: {
          ephemeral_5m_input_tokens: 10,
          ephemeral_1h_input_tokens: 5,
        },
      },
    },
  };
  await writeJsonl(path.join(root, ".claude", "projects", "fixture", "session.jsonl"), [
    claudeRecord,
    claudeRecord,
  ]);

  const codexRows = [
    { timestamp: "2026-08-18T11:00:00.000Z", type: "session_meta", payload: { id: "codex-1", cwd: "/work/codex-project", model: "gpt-5.6-sol" } },
    { timestamp: "2026-08-18T11:00:01.000Z", type: "turn_context", payload: { model: "gpt-5.6-sol", cwd: "/work/codex-project", service_tier: "fast" } },
    { timestamp: "2026-08-18T11:00:02.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 10, reasoning_output_tokens: 2 } }, rate_limits: { plan_type: "plus", primary: { used_percent: 42, window_minutes: 300, resets_at: 1787040000 } } } },
    { timestamp: "2026-08-18T11:00:03.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 150, cached_input_tokens: 30, output_tokens: 20, reasoning_output_tokens: 4 } } } },
    { timestamp: "2026-08-18T11:00:04.000Z", type: "turn_context", payload: { model: "gpt-5.6-sol", cwd: "/work/codex-project", service_tier: "standard" } },
    { timestamp: "2026-08-18T11:00:05.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 20, cached_input_tokens: 5, output_tokens: 3, reasoning_output_tokens: 1 } } } },
  ];
  await writeJsonl(path.join(root, ".codex", "sessions", "2026", "08", "codex-1.jsonl"), codexRows);

  await writeJsonl(path.join(root, ".codex-agentrouter", "sessions", "router.jsonl"), [
    { timestamp: "2026-08-18T12:00:00.000Z", type: "session_meta", payload: { id: "router-1", cwd: "/work/router-project", model: "gpt-5.6-sol" } },
    { timestamp: "2026-08-18T12:00:01.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 2, reasoning_output_tokens: 0 } } } },
  ]);

  await writeJsonl(path.join(root, ".codex-experimental", "sessions", "unknown.jsonl"), [
    { timestamp: "2026-08-18T13:00:00.000Z", type: "session_meta", payload: { id: "unknown-1", cwd: "/work/unknown-project", model: "unknown-frontier-model" } },
    { timestamp: "2026-08-18T13:00:01.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 7, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } } } },
  ]);

  const boundedFile = path.join(root, ".codex-large", "sessions", "large.jsonl");
  await fs.mkdir(path.dirname(boundedFile), { recursive: true });
  const boundedHandle = await fs.open(boundedFile, "w");
  await boundedHandle.truncate(17 * 1024 * 1024);
  await boundedHandle.write("\n", 17 * 1024 * 1024);
  await boundedHandle.close();
  await fs.appendFile(boundedFile, `${[
    { timestamp: "2026-08-18T14:00:00.000Z", type: "session_meta", payload: { id: "large-1", cwd: "/work/large-project", model: "gpt-5.6-sol" } },
    { timestamp: "2026-08-18T14:00:01.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 10, output_tokens: 10, reasoning_output_tokens: 2 } } } },
    { timestamp: "2026-08-18T14:00:02.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 110, cached_input_tokens: 10, output_tokens: 12, reasoning_output_tokens: 3 } } } },
  ].map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");

  const snapshot = await readDirectUsageOverview({
    homeDir: root,
    sinceDate: "2026-08-01",
    refresh: true,
  });

  assert.equal(snapshot.schema, "direct_usage_overview@1");
  assert.equal(snapshot.evidencePosture.billingGrade, false);
  assert.equal(snapshot.evidencePosture.costConfidence, "estimated_static_pricing_partial_lower_bound");
  assert.equal(snapshot.evidencePosture.scanCompleteness, "partial_lower_bound");
  assert.equal(snapshot.evidencePosture.pricingRevision, PRICING_REVISION);
  assert.equal(snapshot.evidencePosture.providerVisibility, "detected_thread_evidence_only");
  assert.deepEqual(snapshot.providers.map((provider) => provider.provider), ["claude", "codex"]);
  assert.ok(snapshot.providers.every((provider) => provider.detected === true && provider.threadCount > 0));
  assert.equal(snapshot.providerDiscovery.strategy, "observed_local_thread_logs");
  assert.equal(snapshot.messages, 7, "Claude duplicate, Codex deltas, rewind, alternate homes, and bounded tails are counted correctly");
  assert.equal(snapshot.tokens.inputTokens, 262);
  assert.equal(snapshot.tokens.cacheReadTokens, 55);
  assert.equal(snapshot.tokens.outputTokens, 78);
  assert.equal(snapshot.tokens.reasoningTokens, 6);
  assert.equal(snapshot.sources.find((source) => source.provider === "claude")?.duplicatesSkipped, 1);
  assert.equal(snapshot.sources.find((source) => source.provider === "codex")?.rootsScanned, 4);
  assert.equal(snapshot.sources.find((source) => source.provider === "codex")?.partialFileCount, 1);
  assert.equal(snapshot.rateLimits[0]?.usedPercent, 42);
  assert.ok(snapshot.projects.some((entry) => entry.project === "router-project"));
  assert.equal(snapshot.models.find((entry) => entry.model === "unknown-frontier-model")?.pricingKnown, false);
  assert.ok(snapshot.sources.find((source) => source.provider === "codex")?.modelsWithoutPricing.includes("unknown-frontier-model"));
  assert.deepEqual(snapshot.sources.find((source) => source.provider === "claude")?.modelsWithoutPricing, []);
  assert.ok(snapshot.costUsd > 0);

  const solPricing = pricingFor("gpt-5.6-sol-2026-08");
  assert.ok(solPricing);
  assert.equal(estimatedCost({ inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, solPricing, true), 2.5);

  await fs.rm(path.join(root, ".claude"), { recursive: true, force: true });
  const codexOnlySnapshot = await readDirectUsageOverview({
    homeDir: root,
    sinceDate: "2026-08-01",
    refresh: true,
  });
  assert.deepEqual(codexOnlySnapshot.providers.map((provider) => provider.provider), ["codex"]);
  assert.deepEqual(codexOnlySnapshot.sources.map((source) => source.provider), ["codex"]);
  assert.equal(codexOnlySnapshot.models.some((model) => model.provider === "claude"), false);
  assert.equal(
    codexOnlySnapshot.providerDiscovery.candidates.find((provider) => provider.provider === "claude")?.detected,
    false,
    "an installed provider adapter without detected threads must remain outside the visible provider inventory",
  );

  const [html, renderer] = await Promise.all([
    fs.readFile(new URL("../src/renderer/t3-direct-surface.html", import.meta.url), "utf8"),
    fs.readFile(new URL("../src/renderer/direct-usage-surface.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /data-t3-action="usage"/);
  assert.match(html, /id="directUsagePage"/);
  assert.match(renderer, /not billing-grade/);
  assert.match(renderer, /missing usage as unknown, not zero/);
  assert.match(renderer, /detectedProviders\(snapshot\)/);
  assert.match(renderer, /direct-usage-provider-segment/);
  assert.doesNotMatch(renderer, /entry\.provider === "claude"/);

  console.log(JSON.stringify({ ok: true, messages: snapshot.messages, models: snapshot.models.length, sources: snapshot.sources.length }));
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
