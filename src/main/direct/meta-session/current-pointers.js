"use strict";

const { DIRECT_META_CURRENT_POINTER_SET_SCHEMA } = require("./constants");
const { pointerSetDigest } = require("./digest");
const { normalizeId, normalizeString } = require("./ids");

function buildCurrentPointerSet(input = {}) {
  const pointer = {
    schemaVersion: DIRECT_META_CURRENT_POINTER_SET_SCHEMA,
    pointerSetId: normalizeId(input.pointerSetId, "meta_pointer"),
    scopeKind: normalizeString(input.scopeKind, "meta_session"),
    scopeId: normalizeString(input.scopeId, "global"),
  };
  for (const key of [
    "currentMetaSessionId",
    "currentContractId",
    "currentContextRegistryId",
    "currentLedgerHead",
    "indexDigest",
  ]) {
    const value = normalizeString(input[key], "");
    if (value) pointer[key] = value;
  }
  if (Number.isInteger(input.currentContractVersion)) pointer.currentContractVersion = input.currentContractVersion;
  if (Number.isInteger(input.currentSessionEpoch)) pointer.currentSessionEpoch = input.currentSessionEpoch;
  pointer.pointerSetDigest = pointerSetDigest(pointer);
  return pointer;
}

module.exports = {
  buildCurrentPointerSet,
};
