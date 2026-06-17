#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const {
  buildToolCapabilityRegistry,
  validateToolCapabilityRegistry,
} = require("../src/main/direct/bridge/tool-capability-registry");
const {
  buildDirectHeadlessToolClassExamplePack,
  validateDirectHeadlessToolClassExamplePack,
} = require("../src/main/direct/headless/tool-class-examples");
const {
  buildDirectHeadlessToolClassRealismReport,
  validateDirectHeadlessToolClassRealismReport,
} = require("../src/main/direct/headless/tool-class-realism-report");
const {
  buildDirectHeadlessToolClassLiveCandidateGate,
  validateDirectHeadlessToolClassLiveCandidateGate,
} = require("../src/main/direct/headless/tool-class-live-candidate-gate");
const {
  buildDirectHeadlessToolClassLiveSmokeReport,
  validateDirectHeadlessToolClassLiveSmokeReport,
} = require("../src/main/direct/headless/tool-class-live-smoke-report");
const {
  buildDirectToolPromotionDecisionReport,
  validateDirectToolPromotionDecisionReport,
} = require("../src/main/direct/headless/tool-promotion-decision-report");
const {
  buildDirectToolActivationRegistry,
  validateDirectToolActivationRegistry,
} = require("../src/main/direct/headless/tool-activation-registry");

function parseArgs(argv) {
  const options = Object.create(null);
  options.flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const raw = arg.slice(2);
    const equals = raw.indexOf("=");
    if (equals >= 0) {
      options[raw.slice(0, equals)] = raw.slice(equals + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      options[raw] = next;
      index += 1;
      continue;
    }
    options.flags.add(raw);
  }
  return options;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function writeReportIfRequested(report, outputPath) {
  const safePath = normalizeString(outputPath, "");
  if (!safePath) return "";
  const absolute = path.isAbsolute(safePath) ? safePath : path.join(repoRoot, safePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return absolute;
}

function fixtureExecutionForPack(pack) {
  return {
    mode: "execute_fixtures",
    results: [...new Set(pack.examples.flatMap((example) => example.runnerScripts || []))]
      .map((scriptPath) => ({ scriptPath, status: "passed", durationMs: 1 })),
  };
}

function smokeResultsForGate(gate, evidenceKind = "headless_live_smoke_fixture_evidence") {
  return gate.rows
    .filter((row) => row.eligibleForLiveSmoke)
    .map((row) => ({
      exampleId: row.exampleId,
      toolClassId: row.toolClassId,
      liveSmokeRoute: row.liveSmokeRoute,
      status: "passed",
      durationMs: 10,
      providerTransportStarted: evidenceKind === "real_provider_full_loop_evidence",
      workspaceMutationStartedBySmoke: false,
      satisfiedConditions: row.requiredConditions,
      evidenceRefs: [{
        kind: evidenceKind,
        refId: `${evidenceKind}_${row.exampleId}`,
        state: "passed",
        rendererSafe: true,
      }],
    }));
}

function buildCandidateGate(nowMs = 0) {
  const registry = buildToolCapabilityRegistry({
    projectId: "project_tool_activation_registry_fixture",
    nowMs,
  });
  assert.equal(validateToolCapabilityRegistry(registry), true, "tool capability registry should validate");
  const pack = buildDirectHeadlessToolClassExamplePack({
    registry,
    projectId: "project_tool_activation_registry_fixture",
    nowMs,
  });
  assert.deepEqual(validateDirectHeadlessToolClassExamplePack(pack), [], "example pack should validate");
  const realismReport = buildDirectHeadlessToolClassRealismReport({
    pack,
    executionMode: "execute_fixtures",
    fixtureExecution: fixtureExecutionForPack(pack),
    nowMs,
  });
  assert.deepEqual(validateDirectHeadlessToolClassRealismReport(realismReport), [], "realism report should validate");
  const candidateGate = buildDirectHeadlessToolClassLiveCandidateGate({
    realismReport,
    nowMs,
  });
  assert.deepEqual(validateDirectHeadlessToolClassLiveCandidateGate(candidateGate), [], "candidate gate should validate");
  return candidateGate;
}

function promotionReportFor(evidenceKind, nowMs = 0) {
  const candidateGate = buildCandidateGate(nowMs);
  const smokeReport = buildDirectHeadlessToolClassLiveSmokeReport({
    candidateGate,
    executionMode: "execute_live_smoke",
    smokeExecution: {
      mode: "execute_live_smoke",
      allowLiveProviderCall: true,
      results: smokeResultsForGate(candidateGate, evidenceKind),
    },
    nowMs,
  });
  assert.deepEqual(validateDirectHeadlessToolClassLiveSmokeReport(smokeReport), [], `${evidenceKind} smoke report should validate`);
  const promotionReport = buildDirectToolPromotionDecisionReport({
    liveSmokeReport: smokeReport,
    nowMs,
    providerProfileId: "activation_fixture_provider_profile",
    modelId: "activation-fixture-model",
    providerProfileDigest: "activation_provider_profile_digest_fixture",
    toolConstitutionDigest: "activation_tool_constitution_digest_fixture",
  });
  assert.deepEqual(validateDirectToolPromotionDecisionReport(promotionReport), [], `${evidenceKind} promotion report should validate`);
  return promotionReport;
}

function activationRequestFor(toolClassId, state, scopeKind = "project_default") {
  return {
    toolClassId,
    state,
    activationEffect: state === "active" ? "allow" : state === "shadow_only" ? "shadow" : state === "revoked" ? "revoke" : "deny",
    activatedBy: "test_fixture",
    reason: `fixture_${state}_${scopeKind}`,
    scope: {
      kind: scopeKind,
      projectId: scopeKind === "global_default" ? "" : "project_tool_activation_registry_fixture",
      workThreadId: scopeKind === "work_thread_override" || scopeKind === "single_turn_override" ? "work_thread_activation_fixture" : "",
      turnId: scopeKind === "single_turn_override" ? "turn_activation_fixture" : "",
      operatorId: "operator_activation_fixture",
    },
  };
}

const options = parseArgs(process.argv.slice(2));

const restrictedPromotionReport = promotionReportFor("headless_live_smoke_fixture_evidence", 0);
assert.equal(restrictedPromotionReport.summary.byState.promotable_restricted, 5, "fixture smoke evidence should only be restricted");

const defaultRegistry = buildDirectToolActivationRegistry({
  promotionReport: restrictedPromotionReport,
  projectId: "project_tool_activation_registry_fixture",
  nowMs: 0,
});
assert.deepEqual(validateDirectToolActivationRegistry(defaultRegistry), [], "default activation registry should validate");
assert.equal(defaultRegistry.summary.byState.inactive, 18, "no promotion decision should activate implicitly");
assert.equal(defaultRegistry.providerDeclarationsBuilt, false, "registry must not build provider declarations");
assert.equal(defaultRegistry.modelVisibleToolsEnabled, false, "registry must not expose model-visible tools");
assert.equal(defaultRegistry.snapshot.toolDeclarationDigest, "", "PR71 snapshot must not materialize declaration digest");

const restrictedRequestedRegistry = buildDirectToolActivationRegistry({
  promotionReport: restrictedPromotionReport,
  projectId: "project_tool_activation_registry_fixture",
  activationRequests: [
    activationRequestFor("local_perception.workspace_read", "active"),
  ],
  nowMs: 0,
});
assert.deepEqual(validateDirectToolActivationRegistry(restrictedRequestedRegistry), [], "restricted requested registry should validate");
const restrictedReadRow = restrictedRequestedRegistry.rows.find((row) => row.toolClassId === "local_perception.workspace_read");
assert.equal(restrictedReadRow.state, "shadow_only", "restricted promotion should downgrade active request to shadow-only");
assert.equal(restrictedReadRow.providerDeclarationEnabled, false, "shadow-only row is not provider declared");
assert(restrictedReadRow.blockerCodes.includes("restricted_promotion_downgraded_to_shadow_only"), "downgrade blocker should be visible");

const realProviderPromotionReport = promotionReportFor("real_provider_full_loop_evidence", 0);
assert.equal(realProviderPromotionReport.summary.byState.promotable, 5, "real provider full-loop evidence should be promotable");

const activeProjectRegistry = buildDirectToolActivationRegistry({
  promotionReport: realProviderPromotionReport,
  projectId: "project_tool_activation_registry_fixture",
  activationRequests: [
    activationRequestFor("local_perception.workspace_read", "active"),
  ],
  nowMs: 0,
});
assert.deepEqual(validateDirectToolActivationRegistry(activeProjectRegistry), [], "active project registry should validate");
const activeReadRow = activeProjectRegistry.rows.find((row) => row.toolClassId === "local_perception.workspace_read");
assert.equal(activeReadRow.state, "active", "full-loop project-scoped request may become active eligibility");
assert.equal(activeReadRow.declarationEligibleByRegistry, true, "active row should be declaration-eligible");
assert.equal(activeReadRow.providerDeclarationEnabled, false, "PR71 still must not declare the tool");
assert.equal(activeReadRow.modelVisibleToolEnabled, false, "PR71 still must not expose the tool to the model");
assert.equal(activeReadRow.perCallAuthorityBypassed, false, "activation must not bypass per-call authority");

const unsafeGlobalRegistry = buildDirectToolActivationRegistry({
  promotionReport: realProviderPromotionReport,
  activationRequests: [
    activationRequestFor("local_perception.workspace_read", "active", "global_default"),
  ],
  nowMs: 0,
});
assert.deepEqual(validateDirectToolActivationRegistry(unsafeGlobalRegistry), [], "unsafe global registry should validate as suspended");
const globalReadRow = unsafeGlobalRegistry.rows.find((row) => row.toolClassId === "local_perception.workspace_read");
assert.equal(globalReadRow.state, "suspended", "non-harmless global activation should be suspended in V0");
assert(globalReadRow.blockerCodes.includes("positive_global_activation_disabled_in_v0"), "global suspension blocker should be visible");

const revokedRegistry = buildDirectToolActivationRegistry({
  promotionReport: realProviderPromotionReport,
  projectId: "project_tool_activation_registry_fixture",
  workThreadId: "work_thread_activation_fixture",
  turnId: "turn_activation_fixture",
  activationRequests: [
    activationRequestFor("local_perception.workspace_read", "revoked", "single_turn_override"),
  ],
  nowMs: 0,
});
assert.deepEqual(validateDirectToolActivationRegistry(revokedRegistry), [], "revoked registry should validate");
const revokedReadRow = revokedRegistry.rows.find((row) => row.toolClassId === "local_perception.workspace_read");
assert.equal(revokedReadRow.state, "revoked", "single-turn revoke should be preserved");
assert.equal(revokedReadRow.activationEffect, "revoke", "revoke effect should be explicit");
assert.equal(revokedReadRow.activationDecision.appliesAt, "immediate", "emergency revoke should apply immediately");

const outputPath = writeReportIfRequested(activeProjectRegistry, options.output);
if (outputPath) {
  console.log(`wrote ${outputPath}`);
}

console.log(JSON.stringify({
  ok: true,
  defaultRegistryId: defaultRegistry.registryId,
  activeProjectRegistryId: activeProjectRegistry.registryId,
  activeRows: activeProjectRegistry.summary.activeToolClasses.length,
  shadowRows: restrictedRequestedRegistry.summary.shadowToolClasses.length,
  suspendedRows: unsafeGlobalRegistry.summary.suspendedToolClasses.length,
}, null, 2));
