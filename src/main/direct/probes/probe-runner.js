"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const {
  DEFAULT_FIXTURE_ROOT,
  loadFixtureFile,
} = require("../fixtures/fixture-loader");
const {
  buildAuthorizationUrl,
  normalizeTokenResponse,
  parseCallbackUrl,
  parseManualCodePaste,
  pkceChallengeFromVerifier,
} = require("../auth/oauth-shapes");
const { normalizeDirectCodexEvents } = require("../normalizer/codex-event-normalizer");
const { buildFixtureProfileDelta } = require("../odeu-profile/profile-delta-builder");

const PROBE_MANIFEST_SCHEMA = "direct_codex_probe_manifest@1";
const PROBE_RESULT_SCHEMA = "direct_codex_probe_result@1";
const DEFAULT_PROBE_MANIFEST_DIR = path.join(DEFAULT_FIXTURE_ROOT, "probes");
const PROBE_STAGES = Object.freeze(["hypothesis", "fixture", "normalization", "profile_delta", "acceptance"]);
const PROBE_ACCEPTANCE_STATES = new Set(["candidate", "accepted", "needs-review", "unstable", "rejected"]);
const PROBE_FIXTURE_SOURCES = new Set(["committed-fixture", "auth-shape-fixture"]);
const AUTH_SHAPE_OPERATIONS = new Set([
  "authorization_url",
  "callback_parse",
  "manual_code_paste",
  "token_response_normalization",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stripGeneratedAt(value) {
  const clone = structuredClone(value);
  delete clone.generatedAt;
  return clone;
}

function fixtureNameFromId(fixtureId) {
  return String(fixtureId || "").replace(/^(auth|raw|normalized|profile-deltas)\//, "");
}

function validateCommonProbeManifest(manifest) {
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
  if (!PROBE_FIXTURE_SOURCES.has(manifest.fixture.source)) {
    throw new Error(`${manifest.id} must use an admitted fixture source; live probes are not admitted in v0.`);
  }
  if (!isPlainObject(manifest.acceptance)) throw new Error(`${manifest.id} requires acceptance.`);
  if (!PROBE_ACCEPTANCE_STATES.has(manifest.acceptance.expectedState)) {
    throw new Error(`${manifest.id} has invalid acceptance.expectedState.`);
  }
}

function validateStreamFixtureProbeManifest(manifest) {
  if (manifest.fixture.source !== "committed-fixture") return false;
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
  if (!Array.isArray(manifest.acceptance.requiredEventTypes) || manifest.acceptance.requiredEventTypes.length === 0) {
    throw new Error(`${manifest.id} requires acceptance.requiredEventTypes.`);
  }
  return true;
}

function validateAuthShapeProbeManifest(manifest) {
  if (manifest.fixture.source !== "auth-shape-fixture") return false;
  if (typeof manifest.fixture.authFixtureId !== "string" || !manifest.fixture.authFixtureId.startsWith("auth/")) {
    throw new Error(`${manifest.id} requires fixture.authFixtureId starting with auth/.`);
  }
  if (!isPlainObject(manifest.authShape)) throw new Error(`${manifest.id} requires authShape.`);
  if (!AUTH_SHAPE_OPERATIONS.has(manifest.authShape.operation)) {
    throw new Error(`${manifest.id} has invalid authShape.operation.`);
  }
  if (!Array.isArray(manifest.acceptance.requiredOutputs) || manifest.acceptance.requiredOutputs.length === 0) {
    throw new Error(`${manifest.id} requires acceptance.requiredOutputs.`);
  }
  return true;
}

function validateProbeManifest(manifest) {
  validateCommonProbeManifest(manifest);
  if (validateStreamFixtureProbeManifest(manifest)) return true;
  if (validateAuthShapeProbeManifest(manifest)) return true;
  throw new Error(`${manifest.id} uses an unsupported probe fixture source.`);
}

function outputValueAtPath(output, dottedPath) {
  const parts = String(dottedPath || "").split(".").filter(Boolean);
  let current = output;
  for (const part of parts) {
    if (!isPlainObject(current) && !Array.isArray(current)) return undefined;
    current = current[part];
  }
  return current;
}

function assertRequiredOutputs(manifest, output) {
  for (const outputPath of manifest.acceptance.requiredOutputs) {
    assert.notEqual(
      outputValueAtPath(output, outputPath),
      undefined,
      `${manifest.id} expected auth output ${outputPath}.`,
    );
  }
}

function executeAuthShapeOperation(operation, input = {}) {
  if (operation === "authorization_url") {
    const codeChallenge = pkceChallengeFromVerifier(input.pkceVerifier);
    return {
      pkceChallenge: codeChallenge,
      url: buildAuthorizationUrl({
        ...input,
        codeChallenge,
      }),
    };
  }
  if (operation === "callback_parse") {
    return parseCallbackUrl(input.callbackUrl, { expectedState: input.expectedState || "" });
  }
  if (operation === "manual_code_paste") {
    return parseManualCodePaste(input.text, { expectedState: input.expectedState || "" });
  }
  if (operation === "token_response_normalization") {
    return normalizeTokenResponse(input.response);
  }
  throw new Error(`Unsupported auth shape operation: ${operation}`);
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
      auth: safeManifest.fixture?.authFixtureId || "",
    },
    normalizedEventCounts: {},
    rawEventTypes: [],
    unknownRawTypes: [],
    authOperation: safeManifest.authShape?.operation || "",
    acceptance: safeManifest.acceptance?.expectedState || "needs-review",
    blockedLiveGates: Array.isArray(safeManifest.blockedLiveGates) ? safeManifest.blockedLiveGates : [],
    errorMessage: error && error.message ? error.message : String(error || "Unknown probe failure."),
  };
}

function executeStreamFixtureBackedProbe(manifest, options = {}) {
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
      auth: "",
    },
    normalizedEventCounts: actualDelta.normalizedEventCounts,
    rawEventTypes: actualDelta.rawEventTypes,
    unknownRawTypes: actualDelta.unknownRawTypes,
    authOperation: "",
    acceptance: actualDelta.acceptance,
    blockedLiveGates: Array.isArray(manifest.blockedLiveGates) ? manifest.blockedLiveGates : [],
  };
}

function executeAuthShapeFixtureProbe(manifest, options = {}) {
  validateProbeManifest(manifest);
  const fixtureRoot = path.resolve(options.fixtureRoot || DEFAULT_FIXTURE_ROOT);
  const fixture = loadFixtureById(fixtureDirectory(fixtureRoot, "auth"), manifest.fixture.authFixtureId, fixtureRoot);
  assert.ok(fixture.records.length > 0, `${manifest.id} expected auth fixture to contain one record.`);
  const record = fixture.records[0];
  assert.equal(record.operation, manifest.authShape.operation, `${manifest.id} auth operation mismatch.`);
  const actual = executeAuthShapeOperation(record.operation, record.input || {});
  assert.deepStrictEqual(actual, record.expected, `${manifest.id} auth shape output does not match ${fixture.id}.`);
  assertRequiredOutputs(manifest, actual);
  return {
    schema: PROBE_RESULT_SCHEMA,
    id: manifest.id,
    name: manifest.name,
    source: manifest.fixture.source,
    status: "passed",
    stages: {
      hypothesis: "passed",
      fixture: "passed",
      normalization: "passed",
      profile_delta: "skipped",
      acceptance: "passed",
    },
    fixtureIds: {
      raw: "",
      normalized: "",
      profileDelta: "",
      auth: fixture.id,
    },
    normalizedEventCounts: {},
    rawEventTypes: [],
    unknownRawTypes: [],
    authOperation: record.operation,
    authOutput: actual,
    acceptance: manifest.acceptance.expectedState,
    blockedLiveGates: Array.isArray(manifest.blockedLiveGates) ? manifest.blockedLiveGates : [],
  };
}

function executeFixtureBackedProbe(manifest, options = {}) {
  validateProbeManifest(manifest);
  if (manifest.fixture.source === "auth-shape-fixture") {
    return executeAuthShapeFixtureProbe(manifest, options);
  }
  return executeStreamFixtureBackedProbe(manifest, options);
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
