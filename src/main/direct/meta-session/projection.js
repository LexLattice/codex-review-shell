"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DIRECT_META_STATUS_PROJECTION_SCHEMA } = require("./constants");
const { genericDigest } = require("./digest");
const { normalizeId, normalizeString, nowIso } = require("./ids");
const { assertMetaSessionRendererSafe } = require("./raw-exposure");
const { validateStatusProjection } = require("./schemas");

function countJsonFiles(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .length;
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
}

function artifactCount(sessionDir, child) {
  return countJsonFiles(path.join(sessionDir, "artifacts", child));
}

function buildDirectMetaSessionStatusProjection(input = {}) {
  const sessionDir = input.sessionDir || "";
  const currentPointers = input.currentPointers || null;
  const ledgerStatus = input.ledgerStatus || {};
  const counts = {
    contexts: artifactCount(sessionDir, "execution-context-registries"),
    contracts: artifactCount(sessionDir, "run-contracts"),
    instructionPackages: artifactCount(sessionDir, "instruction-packages"),
    omissionLedgers: artifactCount(sessionDir, "instruction-omission-ledgers"),
    transitionGuardInputs: artifactCount(sessionDir, "transition-guard-inputs"),
    transitionGuardDecisions: artifactCount(sessionDir, "transition-guard-decisions"),
    descriptors: artifactCount(sessionDir, "state-object-descriptors"),
    hobRows: artifactCount(sessionDir, "hob-obligation-status"),
    transitionClaims: artifactCount(sessionDir, "transition-claims"),
    upstreamDiscriminators: artifactCount(sessionDir, "upstream-discriminators"),
    brlManifests: artifactCount(sessionDir, "brl-manifests"),
    ledgerEvents: Number(ledgerStatus.events?.length || 0),
    attemptFailures: artifactCount(sessionDir, "attempts"),
  };
  const sourceDigest = genericDigest({
    schemaVersion: DIRECT_META_STATUS_PROJECTION_SCHEMA,
    currentPointerDigest: currentPointers?.pointerSetDigest || "",
    ledgerHeadDigest: ledgerStatus.ledgerHeadDigest || "",
    counts,
  });
  const projection = {
    schemaVersion: DIRECT_META_STATUS_PROJECTION_SCHEMA,
    projectionId: normalizeId(input.projectionId, "meta_status_projection"),
    metaSessionId: normalizeString(input.metaSessionId, ""),
    generatedAt: nowIso(input.now || Date.now),
    sourceDigest,
    ledgerHeadDigest: normalizeString(ledgerStatus.ledgerHeadDigest, ""),
    health: ledgerStatus.ok === false ? "ledger_corrupt" : "ok",
    currentPointers: currentPointers || undefined,
    counts,
    capabilities: {
      statusRead: true,
      mutationIpcAvailable: false,
      workerSpawnAvailable: false,
      routeDispatchAvailable: false,
      transitionEnforceAvailable: false,
      semanticBrokerRerouteAvailable: false,
    },
    actionability: {
      actionable: false,
      allowedActions: [],
    },
    rawTextIncluded: false,
    rawTranscriptIncluded: false,
    rawPathIncluded: false,
    rawChatGptUrlIncluded: false,
    rawProviderPayloadIncluded: false,
  };
  assertMetaSessionRendererSafe(projection);
  if (!validateStatusProjection(projection)) throw new Error("Invalid meta-session status projection.");
  return projection;
}

module.exports = {
  buildDirectMetaSessionStatusProjection,
};
