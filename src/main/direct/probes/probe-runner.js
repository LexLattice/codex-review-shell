"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const {
  DEFAULT_FIXTURE_ROOT,
  loadFixtureFile,
} = require("../fixtures/fixture-loader");
const { normalizeDirectCodexEvents } = require("../normalizer/codex-event-normalizer");
const { buildFixtureProfileDelta } = require("../odeu-profile/profile-delta-builder");

const PROBE_MANIFEST_SCHEMA = "direct_codex_probe_manifest@1";
const PROBE_RESULT_SCHEMA = "direct_codex_probe_result@1";
const DEFAULT_PROBE_MANIFEST_DIR = path.join(DEFAULT_FIXTURE_ROOT, "probes");
const PROBE_STAGES = Object.freeze(["hypothesis", "fixture", "normalization", "profile_delta", "acceptance"]);
const PROBE_ACCEPTANCE_STATES = new Set(["candidate", "accepted", "needs-review", "unstable", "rejected"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stripGeneratedAt(value) {
  const clone = structuredClone(value);
  delete clone.generatedAt;
  return clone;
}

function fixtureNameFromId(fixtureId) {
  return String(fixtureId || "").replace(/^(raw|normalized|profile-deltas)\//, "");
}

function validateProbeManifest(manifest) {
  if (!isPlainObject(manifest)) throw new Error("Probe manifest must be a JSON object.");
  if (manifest.schema !== PROBE_MANIFEST_SCHEMA) {
    throw new Error(`Expected probe manifest schema ${PROBE_MANIFEST_SCHEMA}, got ${manifest.schema || "missing"}.`);
  }
  if (typeof manifest.id !== "string" || !manifest.id.trim()) throw new Error("Probe manifest requires id.");
  if (typeof manifest.name !== "string" || !manifest.name.trim()) throw new Error(`${manifest.id} requires name.`);
  if (typeof manifest.hypothesis !== "string" || !manifest.hypothesis.trim()) {
    throw new Error(`${manifest.id} requires hypothesis.`);
  }
  if (!isPlainObject(manifest.fixture)) throw new Error(`${manifest.id} requires fixture.`);
  if (manifest.fixture.source !== "committed-fixture") {
    throw new Error(`${manifest.id} must be fixture-backed; live probes are not admitted in v0.`);
  }
  if (typeof manifest.fixture.rawFixtureId !== "string" || !manifest.fixture.rawFixtureId.startsWith("raw/")) {
    throw new Error(`${manifest.id} requires fixture.rawFixtureId starting with raw/.`);
  }
  if (!isPlainObject(manifest.normalization)) throw new Error(`${manifest.id} requires normalization.`);
  if (manifest.normalization.expectedFixtureId !== `normalized/${fixtureNameFromId(manifest.fixture.rawFixtureId)}`) {
    throw new Error(`${manifest.id} normalization fixture must match its raw fixture name.`);
  }
  if (!isPlainObject(manifest.profileDelta)) throw new Error(`${manifest.id} requires profileDelta.`);
  if (manifest.profileDelta.expectedFixtureId !== `profile-deltas/${fixtureNameFromId(manifest.fixture.rawFixtureId)}`) {
    throw new Error(`${manifest.id} profile delta fixture must match its raw fixture name.`);
  }
  if (!isPlainObject(manifest.acceptance)) throw new Error(`${manifest.id} requires acceptance.`);
  if (!PROBE_ACCEPTANCE_STATES.has(manifest.acceptance.expectedState)) {
    throw new Error(`${manifest.id} has invalid acceptance.expectedState.`);
  }
  if (!Array.isArray(manifest.acceptance.requiredEventTypes) || manifest.acceptance.requiredEventTypes.length === 0) {
    throw new Error(`${manifest.id} requires acceptance.requiredEventTypes.`);
  }
  return true;
}

function loadProbeManifestFile(filePath) {
  const resolvedPath = path.resolve(filePath);
  const manifest = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  validateProbeManifest(manifest);
  return {
    path: resolvedPath,
    manifest,
  };
}

function listProbeManifestFiles(manifestDir = DEFAULT_PROBE_MANIFEST_DIR) {
  const resolvedDir = path.resolve(manifestDir);
  if (!fs.existsSync(resolvedDir)) return [];
  return fs
    .readdirSync(resolvedDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(resolvedDir, entry.name))
    .sort();
}

function loadProbeManifests(manifestDir = DEFAULT_PROBE_MANIFEST_DIR) {
  return listProbeManifestFiles(manifestDir).map(loadProbeManifestFile);
}

function loadFixtureById(directory, fixtureId, fixtureRoot) {
  return loadFixtureFile(
    path.join(directory, `${fixtureNameFromId(fixtureId)}.json`),
    { rootDir: fixtureRoot, requireRedacted: true },
  );
}

function fixtureDirectory(fixtureRoot, kind) {
  return path.join(fixtureRoot, kind);
}

function assertRequiredEvents(manifest, eventCounts) {
  for (const eventType of manifest.acceptance.requiredEventTypes) {
    assert.ok(
      Number(eventCounts[eventType] || 0) > 0,
      `${manifest.id} expected normalized event type ${eventType}.`,
    );
  }
}

function failedProbeResult(manifest, error) {
  const safeManifest = isPlainObject(manifest) ? manifest : {};
  return {
    schema: PROBE_RESULT_SCHEMA,
    id: safeManifest.id || "unknown-probe",
    name: safeManifest.name || safeManifest.id || "Unknown probe",
    source: safeManifest.fixture?.source || "unknown",
    status: "failed",
    stages: Object.fromEntries(PROBE_STAGES.map((stage) => [stage, "failed"])),
    fixtureIds: {
      raw: safeManifest.fixture?.rawFixtureId || "",
      normalized: safeManifest.normalization?.expectedFixtureId || "",
      profileDelta: safeManifest.profileDelta?.expectedFixtureId || "",
    },
    normalizedEventCounts: {},
    rawEventTypes: [],
    unknownRawTypes: [],
    acceptance: safeManifest.acceptance?.expectedState || "needs-review",
    blockedLiveGates: Array.isArray(safeManifest.blockedLiveGates) ? safeManifest.blockedLiveGates : [],
    errorMessage: error && error.message ? error.message : String(error || "Unknown probe failure."),
  };
}

function executeFixtureBackedProbe(manifest, options = {}) {
  validateProbeManifest(manifest);
  const fixtureRoot = path.resolve(options.fixtureRoot || DEFAULT_FIXTURE_ROOT);
  const rawFixture = loadFixtureById(fixtureDirectory(fixtureRoot, "raw"), manifest.fixture.rawFixtureId, fixtureRoot);
  const normalizedResult = normalizeDirectCodexEvents(rawFixture.records, {
    failOnUnknown: manifest.normalization.failOnUnknown !== false,
  });
  const expectedNormalized = loadFixtureById(
    fixtureDirectory(fixtureRoot, "normalized"),
    manifest.normalization.expectedFixtureId,
    fixtureRoot,
  );
  assert.deepStrictEqual(
    normalizedResult.normalized,
    expectedNormalized.records,
    `${manifest.id} normalized event output does not match ${expectedNormalized.id}.`,
  );

  const actualDelta = buildFixtureProfileDelta({
    fixtureId: rawFixture.id,
    normalizedEvents: normalizedResult.normalized,
    unknownRawTypes: normalizedResult.unknown.map((event) => event.rawType),
  });
  const expectedDelta = loadFixtureById(
    fixtureDirectory(fixtureRoot, "profile-deltas"),
    manifest.profileDelta.expectedFixtureId,
    fixtureRoot,
  );
  assert.ok(expectedDelta.records.length > 0, `${manifest.id} expected profile delta fixture is empty.`);
  assert.deepStrictEqual(
    stripGeneratedAt(actualDelta),
    stripGeneratedAt(expectedDelta.records[0]),
    `${manifest.id} profile delta output does not match ${expectedDelta.id}.`,
  );

  assert.equal(actualDelta.acceptance, manifest.acceptance.expectedState, `${manifest.id} acceptance mismatch.`);
  assertRequiredEvents(manifest, actualDelta.normalizedEventCounts);

  return {
    schema: PROBE_RESULT_SCHEMA,
    id: manifest.id,
    name: manifest.name,
    source: manifest.fixture.source,
    status: "passed",
    stages: Object.fromEntries(PROBE_STAGES.map((stage) => [stage, "passed"])),
    fixtureIds: {
      raw: rawFixture.id,
      normalized: expectedNormalized.id,
      profileDelta: expectedDelta.id,
    },
    normalizedEventCounts: actualDelta.normalizedEventCounts,
    rawEventTypes: actualDelta.rawEventTypes,
    unknownRawTypes: actualDelta.unknownRawTypes,
    acceptance: actualDelta.acceptance,
    blockedLiveGates: Array.isArray(manifest.blockedLiveGates) ? manifest.blockedLiveGates : [],
  };
}

function runFixtureBackedProbe(manifest, options = {}) {
  try {
    return executeFixtureBackedProbe(manifest, options);
  } catch (error) {
    if (options.throwOnFailure) throw error;
    return failedProbeResult(manifest, error);
  }
}

function runProbeManifests(manifestDocs, options = {}) {
  return manifestDocs.map((doc) => runFixtureBackedProbe(doc.manifest || doc, options));
}

function runProbeManifestDir(manifestDir = DEFAULT_PROBE_MANIFEST_DIR, options = {}) {
  return runProbeManifests(loadProbeManifests(manifestDir), options);
}

module.exports = {
  DEFAULT_PROBE_MANIFEST_DIR,
  PROBE_ACCEPTANCE_STATES,
  PROBE_MANIFEST_SCHEMA,
  PROBE_RESULT_SCHEMA,
  PROBE_STAGES,
  listProbeManifestFiles,
  loadProbeManifestFile,
  loadProbeManifests,
  runFixtureBackedProbe,
  runProbeManifestDir,
  runProbeManifests,
  validateProbeManifest,
};
