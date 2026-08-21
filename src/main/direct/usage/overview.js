"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

const OVERVIEW_SCHEMA = "direct_usage_overview@1";
const PRICING_REVISION = "t3-usage-page-ae37ed728";
const CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 8;
const MAX_FILES_PER_SOURCE = 12_000;
const MAX_RECORDS_PER_SOURCE = 250_000;
const MAX_BYTES_PER_SOURCE = 64 * 1024 * 1024;
const MAX_BYTES_PER_FILE = 16 * 1024 * 1024;

const PROVIDER_PRESENTATION = Object.freeze({
  codex: Object.freeze({ label: "Codex" }),
  claude: Object.freeze({ label: "Claude" }),
});

const MODEL_PRICING = Object.freeze({
  "claude-fable-5": { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, fastMultiplier: 2 },
  "claude-opus-4-7": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75, fastMultiplier: 6 },
  "claude-opus-4-6": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75, fastMultiplier: 6 },
  "claude-opus-4": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-sonnet-4": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  "claude-haiku-4": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  "claude-3-5-haiku": { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
  "gpt-5.6-sol": { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0, fastMultiplier: 2 },
  "gpt-5.6-terra": { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0, fastMultiplier: 2 },
  "gpt-5.6-luna": { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0, fastMultiplier: 2 },
  "gpt-5.6": { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  "gpt-5.5": { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0, fastMultiplier: 2.5 },
  "gpt-5.4": { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0, fastMultiplier: 2 },
  "gpt-5.3-codex": { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0, fastMultiplier: 2 },
  "gpt-5": { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  "kindle-alpha": { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0, fastMultiplier: 2 },
  "codex-auto-review": { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  "kimi-k3": { input: 0.6, output: 2.5, cacheRead: 0.06, cacheWrite: 0.75 },
});

const PRICING_SLUGS = Object.keys(MODEL_PRICING).sort((left, right) => right.length - left.length);
const overviewCache = new Map();

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeInt(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

function isoDay(value) {
  return typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : "";
}

function projectLabel(cwd) {
  if (typeof cwd !== "string" || !cwd.trim()) return "unknown";
  return cwd.split(/[/\\]/).filter(Boolean).at(-1) || "unknown";
}

function emptyBucket() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    costUsd: 0,
    messages: 0,
  };
}

function addToBucket(bucket, tokens, costUsd) {
  bucket.inputTokens += tokens.inputTokens;
  bucket.outputTokens += tokens.outputTokens;
  bucket.cacheReadTokens += tokens.cacheReadTokens;
  bucket.cacheWriteTokens += tokens.cacheWriteTokens;
  bucket.reasoningTokens += tokens.reasoningTokens;
  bucket.costUsd += costUsd;
  bucket.messages += 1;
}

function matchesPricingFamily(slug, family) {
  return slug.startsWith(family) &&
    (slug.length === family.length || /[-_@:.]/.test(slug[family.length] || ""));
}

function pricingFor(model) {
  const slug = String(model || "").trim().toLowerCase();
  if (MODEL_PRICING[slug]) return MODEL_PRICING[slug];
  const family = PRICING_SLUGS.find((candidate) => matchesPricingFamily(slug, candidate));
  return family ? MODEL_PRICING[family] : undefined;
}

function estimatedCost(tokens, pricing, fast, cacheWrite1hTokens = 0) {
  const perMillion =
    tokens.inputTokens * pricing.input +
    tokens.outputTokens * pricing.output +
    tokens.cacheReadTokens * pricing.cacheRead +
    Math.max(0, tokens.cacheWriteTokens - cacheWrite1hTokens) * pricing.cacheWrite +
    cacheWrite1hTokens * pricing.input * 2;
  return (perMillion / 1_000_000) * (fast ? (pricing.fastMultiplier || 1) : 1);
}

function newAccumulator() {
  return {
    models: new Map(),
    daily: new Map(),
    projects: new Map(),
    unpricedByProvider: new Map(),
    dates: [],
  };
}

function recordUnpriced(accumulator, provider, model) {
  const models = accumulator.unpricedByProvider.get(provider) || new Set();
  models.add(model);
  accumulator.unpricedByProvider.set(provider, models);
}

function recordUsage(accumulator, provider, model, day, project, tokens, costUsd, pricingKnown) {
  const modelKey = `${provider}:${model}`;
  const modelBucket = accumulator.models.get(modelKey) || {
    ...emptyBucket(),
    provider,
    model,
    pricingKnown,
  };
  modelBucket.pricingKnown = modelBucket.pricingKnown && pricingKnown;
  addToBucket(modelBucket, tokens, costUsd);
  accumulator.models.set(modelKey, modelBucket);

  if (day) {
    const dayKey = `${day}:${provider}`;
    const dayBucket = accumulator.daily.get(dayKey) || { ...emptyBucket(), provider, date: day };
    addToBucket(dayBucket, tokens, costUsd);
    accumulator.daily.set(dayKey, dayBucket);
    accumulator.dates.push(day);
  }

  const projectBucket = accumulator.projects.get(project) || emptyBucket();
  addToBucket(projectBucket, tokens, costUsd);
  accumulator.projects.set(project, projectBucket);
}

async function collectJsonlFiles(roots) {
  const files = [];
  const walk = async (root) => {
    if (files.length >= MAX_FILES_PER_SOURCE) return;
    let entries = [];
    try {
      entries = await fsp.readdir(root, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES_PER_SOURCE) break;
      const candidate = path.join(root, entry.name);
      if (entry.isDirectory()) await walk(candidate);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        try {
          const info = await fsp.stat(candidate);
          files.push({ filePath: candidate, size: info.size, mtimeMs: info.mtimeMs });
        } catch {}
      }
    }
  };
  for (const root of roots) await walk(root);
  return files.sort((left, right) => right.mtimeMs - left.mtimeMs || left.filePath.localeCompare(right.filePath));
}

function staleFile(file, sinceDate) {
  if (!sinceDate) return false;
  const cutoff = new Date(`${sinceDate}T00:00:00.000Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 1);
  return numberOrZero(file?.mtimeMs) < cutoff.getTime();
}

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function providerLabel(provider) {
  const id = String(provider || "").trim().toLowerCase();
  if (PROVIDER_PRESENTATION[id]?.label) return PROVIDER_PRESENTATION[id].label;
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() || ""}${part.slice(1)}`)
    .join(" ") || "Unknown provider";
}

function providerDetection(source) {
  const provider = String(source?.provider || "").trim().toLowerCase();
  const threadCount = safeInt(source?.filesScanned);
  return {
    provider,
    label: providerLabel(provider),
    detected: Boolean(provider && threadCount > 0),
    detectionKind: "local_thread_log",
    threadCount,
    discoveredThreadCount: safeInt(source?.filesDiscovered),
    usageRecordCount: safeInt(source?.recordsRead),
  };
}

async function* jsonLines(filePath, startOffset = 0) {
  const stream = fs.createReadStream(filePath, { encoding: "utf8", start: startOffset });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let discardPartialFirstLine = startOffset > 0;
  try {
    for await (const line of lines) {
      if (discardPartialFirstLine) {
        discardPartialFirstLine = false;
        continue;
      }
      if (!line) continue;
      try {
        const value = JSON.parse(line);
        if (isObject(value)) yield value;
      } catch {
        // An append-only log may expose a torn final line while a turn is active.
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }
}

async function discoverCodexSessionRoots(homeDir, explicitRoots = []) {
  const candidates = new Set(explicitRoots.filter(Boolean).map((entry) => path.resolve(entry)));
  candidates.add(path.join(homeDir, ".codex", "sessions"));
  try {
    const entries = await fsp.readdir(homeDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith(".codex-")) continue;
      candidates.add(path.join(homeDir, entry.name, "sessions"));
    }
  } catch {}
  const roots = [];
  for (const candidate of candidates) {
    try {
      if ((await fsp.stat(candidate)).isDirectory()) roots.push(candidate);
    } catch {}
  }
  return roots;
}

async function scanClaude(accumulator, roots, sinceDate) {
  const files = await collectJsonlFiles(roots.map((root) => path.join(root, "projects")));
  const seenMessages = new Set();
  let recordsRead = 0;
  let duplicatesSkipped = 0;
  let truncated = false;
  let stopScanning = false;
  let filesScanned = 0;
  let partialFileCount = 0;
  let bytesScanned = 0;

  for (const file of files) {
    if (staleFile(file, sinceDate)) continue;
    const remainingBytes = MAX_BYTES_PER_SOURCE - bytesScanned;
    if (remainingBytes <= 0) {
      truncated = true;
      break;
    }
    const sliceBytes = Math.min(file.size, MAX_BYTES_PER_FILE, remainingBytes);
    const startOffset = Math.max(0, file.size - sliceBytes);
    if (startOffset > 0) {
      truncated = true;
      partialFileCount += 1;
    }
    filesScanned += 1;
    bytesScanned += sliceBytes;
    for await (const entry of jsonLines(file.filePath, startOffset)) {
      if (recordsRead >= MAX_RECORDS_PER_SOURCE) {
        truncated = true;
        stopScanning = true;
        break;
      }
      if (entry.type !== "assistant" || !isObject(entry.message) || !isObject(entry.message.usage)) continue;
      recordsRead += 1;
      const day = isoDay(entry.timestamp);
      if (sinceDate && day && day < sinceDate) continue;
      const messageId = typeof entry.message.id === "string" ? entry.message.id : "";
      if (messageId) {
        const dedupeKey = `${messageId}:${String(entry.requestId || "")}`;
        if (seenMessages.has(dedupeKey)) {
          duplicatesSkipped += 1;
          continue;
        }
        seenMessages.add(dedupeKey);
      }
      const model = typeof entry.message.model === "string" ? entry.message.model : "unknown";
      if (model === "<synthetic>") continue;
      const usage = entry.message.usage;
      const cacheCreation = isObject(usage.cache_creation) ? usage.cache_creation : {};
      const cacheWrite1h = safeInt(cacheCreation.ephemeral_1h_input_tokens);
      const cacheWrite5m = Object.keys(cacheCreation).length
        ? safeInt(cacheCreation.ephemeral_5m_input_tokens)
        : safeInt(usage.cache_creation_input_tokens);
      const tokens = {
        inputTokens: safeInt(usage.input_tokens),
        outputTokens: safeInt(usage.output_tokens),
        cacheReadTokens: safeInt(usage.cache_read_input_tokens),
        cacheWriteTokens: cacheWrite5m + cacheWrite1h,
        reasoningTokens: 0,
      };
      const pricing = pricingFor(model);
      if (!pricing) recordUnpriced(accumulator, "claude", model);
      recordUsage(
        accumulator,
        "claude",
        model,
        day,
        projectLabel(entry.cwd),
        tokens,
        pricing ? estimatedCost(tokens, pricing, usage.speed === "fast", cacheWrite1h) : 0,
        Boolean(pricing),
      );
    }
    if (stopScanning) break;
  }

  return {
    provider: "claude",
    available: files.length > 0,
    rootsScanned: roots.length,
    filesDiscovered: files.length,
    filesScanned,
    partialFileCount,
    bytesScanned,
    recordsRead,
    duplicatesSkipped,
    truncated,
  };
}

function parseRateLimit(limits, observedAt) {
  if (!isObject(limits) || !isObject(limits.primary)) return null;
  const usedPercent = Number(limits.primary.used_percent);
  if (!Number.isFinite(usedPercent)) return null;
  const resetsAt = Number(limits.primary.resets_at);
  return {
    provider: "codex",
    planType: typeof limits.plan_type === "string" ? limits.plan_type : "",
    usedPercent,
    windowMinutes: safeInt(limits.primary.window_minutes),
    resetsAt: Number.isFinite(resetsAt) && resetsAt > 0 ? new Date(resetsAt * 1000).toISOString() : "",
    observedAt: typeof observedAt === "string" ? observedAt : "",
  };
}

async function scanCodex(accumulator, roots, sinceDate) {
  const files = await collectJsonlFiles(roots);
  const seenSnapshots = new Set();
  let recordsRead = 0;
  let duplicatesSkipped = 0;
  let latestRateLimit = null;
  let truncated = false;
  let stopScanning = false;
  let filesScanned = 0;
  let partialFileCount = 0;
  let bytesScanned = 0;

  for (const file of files) {
    if (staleFile(file, sinceDate)) continue;
    const remainingBytes = MAX_BYTES_PER_SOURCE - bytesScanned;
    if (remainingBytes <= 0) {
      truncated = true;
      break;
    }
    const sliceBytes = Math.min(file.size, MAX_BYTES_PER_FILE, remainingBytes);
    const startOffset = Math.max(0, file.size - sliceBytes);
    const partialFile = startOffset > 0;
    if (partialFile) {
      truncated = true;
      partialFileCount += 1;
    }
    filesScanned += 1;
    bytesScanned += sliceBytes;
    let previous = null;
    let model = "unknown";
    let cwd = "";
    let sessionId = path.basename(file.filePath, ".jsonl");
    let fast = false;
    let partialBaselineEstablished = !partialFile;

    for await (const entry of jsonLines(file.filePath, startOffset)) {
      if (recordsRead >= MAX_RECORDS_PER_SOURCE) {
        truncated = true;
        stopScanning = true;
        break;
      }
      const payload = isObject(entry.payload) ? entry.payload : {};
      if (entry.type === "session_meta") {
        if (typeof payload.id === "string" && payload.id) sessionId = payload.id;
        if (typeof payload.cwd === "string") cwd = payload.cwd;
      }
      if (entry.type === "session_meta" || entry.type === "turn_context") {
        if (typeof payload.model === "string" && payload.model) model = payload.model;
        if (typeof payload.cwd === "string") cwd = payload.cwd;
        fast = payload.service_tier === "fast" || payload.service_tier === "priority";
      }
      if (payload.type !== "token_count" || !isObject(payload.info) || !isObject(payload.info.total_token_usage)) continue;
      recordsRead += 1;
      const totals = payload.info.total_token_usage;
      const input = safeInt(totals.input_tokens);
      const current = {
        input,
        cached: Math.min(safeInt(totals.cached_input_tokens), input),
        output: safeInt(totals.output_tokens),
        reasoning: safeInt(totals.reasoning_output_tokens),
      };
      const snapshotKey = `${sessionId}:${String(entry.timestamp || "")}:${current.input}:${current.cached}:${current.output}:${current.reasoning}`;
      if (seenSnapshots.has(snapshotKey)) {
        duplicatesSkipped += 1;
        previous = current;
        continue;
      }
      seenSnapshots.add(snapshotKey);

      const parsedLimit = parseRateLimit(payload.rate_limits, entry.timestamp);
      if (parsedLimit && (!latestRateLimit || parsedLimit.observedAt > latestRateLimit.observedAt)) {
        latestRateLimit = parsedLimit;
      }

      const rewound = previous && (current.input < previous.input || current.output < previous.output);
      if (!partialBaselineEstablished) {
        partialBaselineEstablished = true;
        previous = current;
        continue;
      }
      const base = !previous || rewound ? { input: 0, cached: 0, output: 0, reasoning: 0 } : previous;
      const inputDelta = Math.max(0, current.input - base.input);
      const cachedDelta = Math.max(0, current.cached - base.cached);
      const outputDelta = Math.max(0, current.output - base.output);
      previous = current;
      if (inputDelta === 0 && outputDelta === 0) continue;

      const day = isoDay(entry.timestamp);
      if (sinceDate && day && day < sinceDate) continue;
      const tokens = {
        inputTokens: Math.max(0, inputDelta - cachedDelta),
        outputTokens: outputDelta,
        cacheReadTokens: cachedDelta,
        cacheWriteTokens: 0,
        reasoningTokens: Math.max(0, current.reasoning - base.reasoning),
      };
      const pricing = pricingFor(model);
      if (!pricing) recordUnpriced(accumulator, "codex", model);
      recordUsage(
        accumulator,
        "codex",
        model,
        day,
        projectLabel(cwd),
        tokens,
        pricing ? estimatedCost(tokens, pricing, fast) : 0,
        Boolean(pricing),
      );
    }
    if (stopScanning) break;
  }

  return {
    report: {
      provider: "codex",
      available: files.length > 0,
      rootsScanned: roots.length,
      filesDiscovered: files.length,
      filesScanned,
      partialFileCount,
      bytesScanned,
      recordsRead,
      duplicatesSkipped,
      truncated,
    },
    rateLimits: latestRateLimit ? [latestRateLimit] : [],
  };
}

function finalize(accumulator, sources, rateLimits, generatedAt, sinceDate) {
  const scanPartial = sources.some((source) => source.truncated === true);
  const providerCandidates = sources.map(providerDetection);
  const detectedProviderIds = new Set(
    providerCandidates.filter((candidate) => candidate.detected).map((candidate) => candidate.provider),
  );
  const detectedSources = sources.filter((source) => detectedProviderIds.has(source.provider));
  const models = [...accumulator.models.values()]
    .map((bucket) => ({
      provider: bucket.provider,
      model: bucket.model,
      tokens: {
        inputTokens: bucket.inputTokens,
        outputTokens: bucket.outputTokens,
        cacheReadTokens: bucket.cacheReadTokens,
        cacheWriteTokens: bucket.cacheWriteTokens,
        reasoningTokens: bucket.reasoningTokens,
      },
      messages: bucket.messages,
      costUsd: bucket.costUsd,
      pricingKnown: bucket.pricingKnown,
    }))
    .sort((left, right) => right.costUsd - left.costUsd || right.messages - left.messages);

  const dailyByDate = new Map();
  for (const bucket of accumulator.daily.values()) {
    const list = dailyByDate.get(bucket.date) || [];
    list.push({
      provider: bucket.provider,
      costUsd: bucket.costUsd,
      totalTokens: bucket.inputTokens + bucket.outputTokens + bucket.cacheReadTokens + bucket.cacheWriteTokens,
    });
    dailyByDate.set(bucket.date, list);
  }
  const daily = [...dailyByDate.entries()]
    .map(([date, byProvider]) => ({
      date,
      byProvider: byProvider.sort((left, right) => left.provider.localeCompare(right.provider)),
      costUsd: byProvider.reduce((sum, row) => sum + row.costUsd, 0),
      totalTokens: byProvider.reduce((sum, row) => sum + row.totalTokens, 0),
    }))
    .sort((left, right) => left.date.localeCompare(right.date));

  const projects = [...accumulator.projects.entries()]
    .map(([project, bucket]) => ({
      project,
      costUsd: bucket.costUsd,
      totalTokens: bucket.inputTokens + bucket.outputTokens + bucket.cacheReadTokens + bucket.cacheWriteTokens,
      messages: bucket.messages,
    }))
    .sort((left, right) => right.costUsd - left.costUsd || right.messages - left.messages)
    .slice(0, 20);

  const tokens = models.reduce((total, row) => {
    total.inputTokens += row.tokens.inputTokens;
    total.outputTokens += row.tokens.outputTokens;
    total.cacheReadTokens += row.tokens.cacheReadTokens;
    total.cacheWriteTokens += row.tokens.cacheWriteTokens;
    total.reasoningTokens += row.tokens.reasoningTokens;
    return total;
  }, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 });
  const dates = accumulator.dates.sort();

  return {
    schema: OVERVIEW_SCHEMA,
    generatedAt,
    sinceDate,
    firstDate: dates.at(0) || "",
    lastDate: dates.at(-1) || "",
    costUsd: models.reduce((sum, row) => sum + row.costUsd, 0),
    tokens,
    messages: models.reduce((sum, row) => sum + row.messages, 0),
    sessions: detectedSources.reduce((sum, source) => sum + source.filesScanned, 0),
    providers: providerCandidates.filter((candidate) => candidate.detected),
    models,
    daily,
    projects,
    rateLimits,
    sources: detectedSources.map((source) => ({
      ...source,
      modelsWithoutPricing: [...(accumulator.unpricedByProvider.get(source.provider) || [])].sort(),
    })),
    providerDiscovery: {
      strategy: "observed_local_thread_logs",
      candidates: providerCandidates,
    },
    evidencePosture: {
      tokenAccounting: "derived_from_local_session_logs",
      costComputed: true,
      costConfidence: scanPartial
        ? "estimated_static_pricing_partial_lower_bound"
        : "estimated_static_pricing",
      pricingRevision: PRICING_REVISION,
      billingGrade: false,
      scanCompleteness: scanPartial ? "partial_lower_bound" : "bounded_complete",
      providerVisibility: "detected_thread_evidence_only",
      rawPromptIncluded: false,
      rawResponseIncluded: false,
      rawProviderFrameIncluded: false,
    },
  };
}

async function readDirectUsageOverview(options = {}) {
  const homeDir = path.resolve(String(options.homeDir || os.homedir()));
  const sinceDate = typeof options.sinceDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(options.sinceDate)
    ? options.sinceDate
    : new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const explicitCodexRoots = Array.isArray(options.codexSessionRoots) ? options.codexSessionRoots : [];
  const claudeRoots = Array.isArray(options.claudeRoots) && options.claudeRoots.length
    ? options.claudeRoots
    : [path.join(homeDir, ".claude")];
  const codexRoots = await discoverCodexSessionRoots(homeDir, explicitCodexRoots);
  const cacheKey = JSON.stringify({ homeDir, sinceDate, codexRoots, claudeRoots });
  const now = Date.now();
  const cached = overviewCache.get(cacheKey);
  if (!options.refresh && cached && now - cached.cachedAt < CACHE_TTL_MS) return cached.value;

  const accumulator = newAccumulator();
  const [claude, codex] = await Promise.all([
    scanClaude(accumulator, claudeRoots, sinceDate),
    scanCodex(accumulator, codexRoots, sinceDate),
  ]);
  const value = finalize(accumulator, [claude, codex.report], codex.rateLimits, new Date().toISOString(), sinceDate);
  if (overviewCache.size >= MAX_CACHE_ENTRIES) overviewCache.delete(overviewCache.keys().next().value);
  overviewCache.set(cacheKey, { cachedAt: Date.now(), value });
  return value;
}

module.exports = {
  OVERVIEW_SCHEMA,
  PRICING_REVISION,
  estimatedCost,
  pricingFor,
  readDirectUsageOverview,
};
