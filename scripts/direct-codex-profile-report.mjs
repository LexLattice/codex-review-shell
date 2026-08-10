import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");

const { loadFixtureSet, DEFAULT_FIXTURE_ROOT } = require("../src/main/direct/fixtures/fixture-loader");
const { normalizeDirectCodexEvents } = require("../src/main/direct/normalizer/codex-event-normalizer");
const { buildFixtureProfileDelta } = require("../src/main/direct/odeu-profile/profile-delta-builder");
const { loadDirectCodexProfile } = require("../src/main/direct/odeu-profile/profile-loader");
const { buildDirectCodexProfileReport } = require("../src/main/direct/odeu-profile/profile-report");
const { DEFAULT_PROBE_MANIFEST_DIR, runProbeManifestDir } = require("../src/main/direct/probes/probe-runner");

function parseArgs(argv) {
  const args = {
    output: "",
    fixtures: DEFAULT_FIXTURE_ROOT,
    probes: DEFAULT_PROBE_MANIFEST_DIR,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output") {
      args.output = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--fixtures") {
      args.fixtures = argv[index + 1] || DEFAULT_FIXTURE_ROOT;
      index += 1;
    } else if (arg === "--probes") {
      args.probes = argv[index + 1] || DEFAULT_PROBE_MANIFEST_DIR;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function usage() {
  return [
    "Usage: node scripts/direct-codex-profile-report.mjs [--output PATH] [--fixtures PATH] [--probes PATH]",
    "",
    "Generates a human-readable report from the imported direct Codex ODEU baseline.",
    "This script does not perform live OAuth or backend probes.",
  ].join("\n");
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(usage());
  process.exit(0);
}

const profileDoc = loadDirectCodexProfile();
const fixtureRoot = path.resolve(appRoot, args.fixtures);
const fixtures = loadFixtureSet(fixtureRoot, { requireRedacted: true });
const fixtureSummaries = fixtures.map((fixture) => ({
  id: fixture.id,
  recordCount: fixture.records.length,
  redactionStatus: "passed",
}));
const profileDeltas = [];

for (const fixture of fixtures) {
  if (!fixture.path.includes(`${path.sep}raw${path.sep}`)) continue;
  const result = normalizeDirectCodexEvents(fixture.records);
  profileDeltas.push(
    buildFixtureProfileDelta({
      fixtureId: fixture.id,
      normalizedEvents: result.normalized,
      unknownRawTypes: result.unknown.map((event) => event.rawType),
    }),
  );
}

const report = buildDirectCodexProfileReport({
  profileDoc,
  fixtureSummaries,
  profileDeltas,
  probeResults: runProbeManifestDir(path.resolve(appRoot, args.probes), { fixtureRoot }),
});

if (args.output) {
  const outputPath = path.resolve(appRoot, args.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, report, "utf8");
  console.log(`Wrote ${outputPath}`);
} else {
  process.stdout.write(report);
}
