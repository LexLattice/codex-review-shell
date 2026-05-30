"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  DIRECT_META_SESSION_EVENT_LEDGER_MANIFEST_SCHEMA,
  DIRECT_META_SESSION_EVENT_SCHEMA,
} = require("./constants");
const { artifactDigest, eventBodyDigest, eventDigest } = require("./digest");
const { normalizeId, normalizeString, nowIso } = require("./ids");
const { validateLedgerEvent, validateLedgerManifest } = require("./schemas");

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function tempFilePath(targetPath) {
  return path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`);
}

function writeJsonAtomic(targetPath, value) {
  ensureDirectory(path.dirname(targetPath));
  const tempPath = tempFilePath(targetPath);
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, targetPath);
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch {}
    throw error;
  }
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function ledgerManifestPath(ledgerDir) {
  return path.join(ledgerDir, "manifest.json");
}

function ledgerEventsDir(ledgerDir) {
  return path.join(ledgerDir, "events");
}

function eventFileName(sequence, eventId) {
  return `${String(sequence).padStart(6, "0")}_${eventId}.json`;
}

function readLedgerEvents(ledgerDir) {
  const eventsDir = ledgerEventsDir(ledgerDir);
  try {
    return fs.readdirSync(eventsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => readJsonFile(path.join(eventsDir, entry.name)))
      .filter(Boolean)
      .sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function buildLedgerManifest(metaSessionId, events, corrupted = false) {
  const last = events[events.length - 1] || null;
  const manifest = {
    schemaVersion: DIRECT_META_SESSION_EVENT_LEDGER_MANIFEST_SCHEMA,
    metaSessionId,
    eventCount: events.length,
    ledgerHeadDigest: normalizeString(last?.ledgerHeadDigest, ""),
    lastSequence: Number(last?.sequence || 0),
    corrupted: Boolean(corrupted),
  };
  manifest.digest = artifactDigest({
    schemaVersion: manifest.schemaVersion,
    artifactKind: "ledger_manifest",
    value: manifest,
  });
  return manifest;
}

function appendLedgerEvent(ledgerDir, input = {}, options = {}) {
  const now = options.now || Date.now;
  const events = readLedgerEvents(ledgerDir);
  const previous = events[events.length - 1] || null;
  const sequence = events.length + 1;
  const event = {
    schemaVersion: DIRECT_META_SESSION_EVENT_SCHEMA,
    eventId: normalizeId(input.eventId, "meta_event"),
    sequence,
    eventKind: normalizeString(input.eventKind, "attempt_failure_recorded"),
    metaSessionId: normalizeString(input.metaSessionId, ""),
    artifactRefs: Array.isArray(input.artifactRefs) ? input.artifactRefs : [],
    previousEventDigest: normalizeString(previous?.eventDigest, ""),
    createdAt: nowIso(now),
  };
  event.eventBodyDigest = eventBodyDigest(event);
  event.eventDigest = eventDigest({
    previousEventDigest: event.previousEventDigest,
    eventBodyDigest: event.eventBodyDigest,
  });
  event.ledgerHeadDigest = event.eventDigest;
  if (!validateLedgerEvent(event)) throw new Error("Invalid meta-session ledger event.");
  writeJsonAtomic(path.join(ledgerEventsDir(ledgerDir), eventFileName(sequence, event.eventId)), event);
  const nextEvents = [...events, event];
  const manifest = buildLedgerManifest(event.metaSessionId, nextEvents, false);
  writeJsonAtomic(ledgerManifestPath(ledgerDir), manifest);
  return { event, manifest };
}

function verifyDirectMetaSessionLedger(ledgerDir, metaSessionId) {
  const events = readLedgerEvents(ledgerDir);
  let previousEventDigest = "";
  let ok = true;
  const errors = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!validateLedgerEvent(event)) {
      ok = false;
      errors.push(`invalid_event:${index + 1}`);
      continue;
    }
    if (event.sequence !== index + 1) {
      ok = false;
      errors.push(`sequence_mismatch:${event.sequence}`);
    }
    if (event.previousEventDigest !== previousEventDigest) {
      ok = false;
      errors.push(`previous_digest_mismatch:${event.sequence}`);
    }
    const expectedBody = eventBodyDigest(event);
    const expectedEvent = eventDigest({ previousEventDigest, eventBodyDigest: expectedBody });
    if (event.eventBodyDigest !== expectedBody) {
      ok = false;
      errors.push(`body_digest_mismatch:${event.sequence}`);
    }
    if (event.eventDigest !== expectedEvent || event.ledgerHeadDigest !== expectedEvent) {
      ok = false;
      errors.push(`event_digest_mismatch:${event.sequence}`);
    }
    previousEventDigest = event.eventDigest;
  }
  const manifest = readJsonFile(ledgerManifestPath(ledgerDir));
  if (manifest) {
    if (!validateLedgerManifest(manifest)) {
      ok = false;
      errors.push("manifest_invalid");
    }
    if (manifest.metaSessionId !== metaSessionId || manifest.eventCount !== events.length || manifest.lastSequence !== events.length) {
      ok = false;
      errors.push("manifest_count_mismatch");
    }
    if (events.length && manifest.ledgerHeadDigest !== events[events.length - 1].ledgerHeadDigest) {
      ok = false;
      errors.push("manifest_head_mismatch");
    }
  } else if (events.length) {
    ok = false;
    errors.push("manifest_missing");
  }
  return {
    ok,
    errors,
    events,
    manifest: manifest || buildLedgerManifest(metaSessionId, events, !ok),
    ledgerHeadDigest: normalizeString(events[events.length - 1]?.ledgerHeadDigest, ""),
  };
}

module.exports = {
  appendLedgerEvent,
  buildLedgerManifest,
  ensureDirectory,
  readJsonFile,
  readLedgerEvents,
  verifyDirectMetaSessionLedger,
  writeJsonAtomic,
};
