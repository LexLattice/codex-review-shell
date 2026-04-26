"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assertFixtureRedacted, redactFixture } = require("./redaction");

const DEFAULT_FIXTURE_ROOT = path.resolve(__dirname, "../../../../test/fixtures/direct-codex");
const RAW_FIXTURE_DIR = path.join(DEFAULT_FIXTURE_ROOT, "raw");
const NORMALIZED_FIXTURE_DIR = path.join(DEFAULT_FIXTURE_ROOT, "normalized");
const PROFILE_DELTAS_FIXTURE_DIR = path.join(DEFAULT_FIXTURE_ROOT, "profile-deltas");

function parseJsonl(text, sourcePath = "") {
  const entries = [];
  const lines = String(text || "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      entries.push(JSON.parse(line));
    } catch (error) {
      const location = sourcePath ? `${sourcePath}:${index + 1}` : `line ${index + 1}`;
      throw new Error(`Invalid JSONL fixture at ${location}: ${error.message}`);
    }
  }
  return entries;
}

function parseFixtureText(text, sourcePath = "") {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === ".jsonl" || extension === ".ndjson") {
    return { format: "jsonl", records: parseJsonl(text, sourcePath) };
  }
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return { format: "json", records: parsed };
    if (Array.isArray(parsed?.events)) return { format: "json", records: parsed.events };
    if (Array.isArray(parsed?.records)) return { format: "json", records: parsed.records };
    return { format: "json", records: [parsed] };
  } catch (error) {
    throw new Error(`Invalid JSON fixture at ${sourcePath || "input"}: ${error.message}`);
  }
}

function fixtureIdFromPath(filePath, rootDir = DEFAULT_FIXTURE_ROOT) {
  const relative = path.relative(rootDir, filePath).replace(/\\/g, "/");
  return relative.replace(/[.](jsonl|ndjson|json)$/i, "");
}

function loadFixtureFile(filePath, options = {}) {
  const resolvedPath = path.resolve(filePath);
  const rawText = fs.readFileSync(resolvedPath, "utf8");
  const parsed = parseFixtureText(rawText, resolvedPath);
  const records = options.redactBeforeRead ? redactFixture(parsed.records, options) : parsed.records;
  if (options.requireRedacted !== false) assertFixtureRedacted(records, options);
  return {
    id: fixtureIdFromPath(resolvedPath, options.rootDir || DEFAULT_FIXTURE_ROOT),
    path: resolvedPath,
    format: parsed.format,
    records,
  };
}

function listFixtureFiles(rootDir = DEFAULT_FIXTURE_ROOT) {
  const resolvedRoot = path.resolve(rootDir);
  if (!fs.existsSync(resolvedRoot)) return [];

  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (/[.](json|jsonl|ndjson)$/i.test(entry.name)) {
        files.push(entryPath);
      }
    }
  }
  visit(resolvedRoot);
  return files.sort();
}

function loadFixtureSet(rootDir = DEFAULT_FIXTURE_ROOT, options = {}) {
  return listFixtureFiles(rootDir).map((filePath) =>
    loadFixtureFile(filePath, { ...options, rootDir }),
  );
}

module.exports = {
  DEFAULT_FIXTURE_ROOT,
  NORMALIZED_FIXTURE_DIR,
  PROFILE_DELTAS_FIXTURE_DIR,
  RAW_FIXTURE_DIR,
  fixtureIdFromPath,
  listFixtureFiles,
  loadFixtureFile,
  loadFixtureSet,
  parseFixtureText,
  parseJsonl,
};
