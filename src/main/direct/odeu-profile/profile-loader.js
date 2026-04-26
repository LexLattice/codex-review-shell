"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PROFILE_SCHEMA = "direct_codex_odeu_profile@1";
const PROFILE_VERSION = 1;
const PROFILE_FILENAME = "chatgpt_codex_subscription_oai_server_odeu_profile.2026-04-25.json";
const SCHEMA_FILENAME = "direct_codex_odeu_profile.v1.schema.json";
const PROFILE_DIR = path.resolve(__dirname, "../../../../docs/direct-codex/profile-v0");
const DEFAULT_PROFILE_PATH = path.join(PROFILE_DIR, PROFILE_FILENAME);
const DEFAULT_SCHEMA_PATH = path.join(PROFILE_DIR, SCHEMA_FILENAME);

const ACCEPTANCE_STATES = new Set(["observed", "probed", "accepted", "unstable", "rejected", "unknown"]);
const PROFILE_ARRAY_PATHS = [
  ["ontology", "transports"],
  ["ontology", "authSurfaces"],
  ["ontology", "models"],
  ["ontology", "requestFields"],
  ["ontology", "inputItems"],
  ["ontology", "responseEventTypes"],
  ["ontology", "reasoningShapes"],
  ["ontology", "toolCallShapes"],
  ["ontology", "continuationShapes"],
  ["ontology", "serverManagedSurfaces"],
  ["ontology", "appServerClientSurfaces"],
  ["ontology", "importSourceShapes"],
  ["deontics", "authRequirements"],
  ["deontics", "approvalRequiredFor"],
  ["deontics", "dataHandlingRules"],
  ["deontics", "clientHarnessDuties"],
  ["utility", "latency"],
  ["utility", "usageFields"],
  ["utility", "retryBehavior"],
];

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function valueAtPath(root, segments) {
  let current = root;
  for (const segment of segments) {
    if (!isPlainObject(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function displayNameForEntry(entry) {
  return entry.name || entry.field || entry.metric || entry.displayName || entry.id || "unnamed";
}

function requireAcceptanceState(value, label) {
  if (!ACCEPTANCE_STATES.has(value)) {
    throw new Error(`Invalid acceptance state for ${label}: ${value}`);
  }
}

function validateDirectCodexProfile(profile) {
  if (!isPlainObject(profile)) throw new Error("Direct Codex ODEU profile must be a JSON object.");
  if (profile.schema !== PROFILE_SCHEMA) {
    throw new Error(`Expected profile schema ${PROFILE_SCHEMA}, got ${profile.schema || "missing"}.`);
  }
  if (profile.profileVersion !== PROFILE_VERSION) {
    throw new Error(`Expected profile version ${PROFILE_VERSION}, got ${profile.profileVersion || "missing"}.`);
  }
  if (typeof profile.profileId !== "string" || !profile.profileId.trim()) {
    throw new Error("Direct Codex ODEU profile requires profileId.");
  }
  if (typeof profile.observedAt !== "string" || Number.isNaN(Date.parse(profile.observedAt))) {
    throw new Error("Direct Codex ODEU profile requires a valid observedAt timestamp.");
  }
  if (!isPlainObject(profile.ontology)) throw new Error("Direct Codex ODEU profile requires ontology.");
  if (!isPlainObject(profile.deontics)) throw new Error("Direct Codex ODEU profile requires deontics.");
  if (!isPlainObject(profile.epistemics)) throw new Error("Direct Codex ODEU profile requires epistemics.");
  if (!isPlainObject(profile.utility)) throw new Error("Direct Codex ODEU profile requires utility.");
  if (!isPlainObject(profile.uxExposurePolicy)) {
    throw new Error("Direct Codex ODEU profile requires uxExposurePolicy.");
  }

  for (const segments of PROFILE_ARRAY_PATHS) {
    const entries = valueAtPath(profile, segments);
    if (!Array.isArray(entries)) {
      throw new Error(`Direct Codex ODEU profile requires array ${segments.join(".")}.`);
    }
    for (const entry of entries) {
      if (!isPlainObject(entry)) throw new Error(`Profile entry in ${segments.join(".")} must be an object.`);
      if (typeof entry.id !== "string" || !entry.id.trim()) {
        throw new Error(`Profile entry in ${segments.join(".")} is missing id.`);
      }
      requireAcceptanceState(entry.status, entry.id);
    }
  }

  const confidence = profile.epistemics.confidenceByCapability;
  if (!isPlainObject(confidence)) {
    throw new Error("Direct Codex ODEU profile requires epistemics.confidenceByCapability.");
  }
  for (const [id, state] of Object.entries(confidence)) {
    requireAcceptanceState(state, `confidenceByCapability.${id}`);
  }

  return true;
}

function buildCapabilityIndex(profile) {
  const byId = new Map();
  const byStatus = new Map();

  function addStatus(status, entry) {
    if (!byStatus.has(status)) byStatus.set(status, []);
    byStatus.get(status).push(entry);
  }

  for (const segments of PROFILE_ARRAY_PATHS) {
    const bucket = segments.join(".");
    for (const entry of valueAtPath(profile, segments) || []) {
      const indexed = {
        id: entry.id,
        status: entry.status,
        name: displayNameForEntry(entry),
        authorityLayer: entry.authorityLayer || "",
        bucket,
        entry,
      };
      byId.set(indexed.id, indexed);
      addStatus(indexed.status, indexed);
    }
  }

  for (const [id, status] of Object.entries(profile.epistemics.confidenceByCapability || {})) {
    const indexed = {
      id,
      status,
      name: id,
      authorityLayer: "",
      bucket: "epistemics.confidenceByCapability",
      entry: { id, status },
    };
    if (!byId.has(id)) byId.set(id, indexed);
    addStatus(status, indexed);
  }

  return {
    byId,
    byStatus,
    get(id) {
      return byId.get(id) || null;
    },
    listByStatus(status) {
      return [...(byStatus.get(status) || [])];
    },
  };
}

function summarizeDirectCodexProfile(profile, capabilityIndex = buildCapabilityIndex(profile)) {
  const listIds = (status) => capabilityIndex.listByStatus(status).map((entry) => entry.id).sort();
  return {
    profileId: profile.profileId,
    schema: profile.schema,
    source: profile.source,
    observedAt: profile.observedAt,
    backendContractVersion: profile.backendContractVersion || "",
    subject: profile.subject?.name || "",
    counts: {
      accepted: capabilityIndex.listByStatus("accepted").length,
      observed: capabilityIndex.listByStatus("observed").length,
      probed: capabilityIndex.listByStatus("probed").length,
      unstable: capabilityIndex.listByStatus("unstable").length,
      rejected: capabilityIndex.listByStatus("rejected").length,
      unknown: capabilityIndex.listByStatus("unknown").length,
    },
    accepted: listIds("accepted"),
    observed: listIds("observed"),
    unstable: listIds("unstable"),
    rejected: listIds("rejected"),
    unknowns: [...(profile.epistemics?.unknowns || [])],
    driftWatch: [...(profile.epistemics?.driftWatch || [])],
  };
}

function loadDirectCodexProfile(options = {}) {
  const profilePath = path.resolve(options.profilePath || DEFAULT_PROFILE_PATH);
  const profile = readJsonFile(profilePath);
  validateDirectCodexProfile(profile);
  const capabilityIndex = buildCapabilityIndex(profile);
  return {
    profilePath,
    schemaPath: path.resolve(options.schemaPath || DEFAULT_SCHEMA_PATH),
    loadedAt: new Date().toISOString(),
    profile,
    capabilityIndex,
    summary: summarizeDirectCodexProfile(profile, capabilityIndex),
  };
}

module.exports = {
  ACCEPTANCE_STATES,
  DEFAULT_PROFILE_PATH,
  DEFAULT_SCHEMA_PATH,
  PROFILE_ARRAY_PATHS,
  PROFILE_SCHEMA,
  PROFILE_VERSION,
  buildCapabilityIndex,
  loadDirectCodexProfile,
  summarizeDirectCodexProfile,
  validateDirectCodexProfile,
};
