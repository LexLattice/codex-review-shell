"use strict";

const { genericDigest, sha256 } = require("./digest");
const { buildSourceRef, buildArtifactRef } = require("./source-ref");

function fixtureSourceRef(label = "fixture") {
  return buildSourceRef({
    sourceKind: "fixture",
    authority: "fixture",
    sourceDigest: genericDigest({ fixture: label }),
    rendererSafeLabel: label,
  });
}

function fixtureArtifactRef(kind = "fixture", id = `${kind}_fixture`) {
  return buildArtifactRef({
    artifactKind: kind,
    artifactId: id,
    artifactDigest: genericDigest({ kind, id }),
    storageSlot: `artifacts/${kind}/${id}.json`,
  });
}

function expectedObservationHash(value = "fixture observation") {
  return sha256(`direct-meta-session-fixture-observation@1\0${value}`);
}

module.exports = {
  expectedObservationHash,
  fixtureArtifactRef,
  fixtureSourceRef,
};
