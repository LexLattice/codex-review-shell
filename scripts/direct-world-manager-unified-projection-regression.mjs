#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  spawnSync,
} from "node:child_process";
import {
  createRequire,
} from "node:module";

const require =
  createRequire(import.meta.url);
const {
  validateUnifiedWorldManagerProjection,
} = require(
  "../src/main/direct/worldmanager/unified-projection",
);

const rootDir = fs.mkdtempSync(
  path.join(
    os.tmpdir(),
    "direct-world-manager-sc10-",
  ),
);
const k4ProjectionPath =
  path.join(
    rootDir,
    "k4-projection.json",
  );
const canvasBasePath =
  path.join(
    rootDir,
    "canvas-base.json",
  );
const canvasAppliedPath =
  path.join(
    rootDir,
    "canvas-applied.json",
  );
const canvasExtractedPath =
  path.join(
    rootDir,
    "canvas-extracted.json",
  );

function runFixture(
  script,
  env,
) {
  const result = spawnSync(
    process.execPath,
    [path.resolve(script)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...env,
      },
      encoding: "utf8",
      timeout: 45_000,
    },
  );
  assert.equal(
    result.status,
    0,
    result.stderr ||
      result.stdout ||
      `${script} failed.`,
  );
}

runFixture(
  "scripts/direct-world-manager-k4-regression.mjs",
  {
    CODEX_WORLD_MANAGER_K4_PROJECTION_PATH:
      k4ProjectionPath,
  },
);
runFixture(
  "scripts/direct-world-manager-thought-brush-regression.mjs",
  {
    CODEX_WORLD_MANAGER_SC9_BASE_PROJECTION_PATH:
      canvasBasePath,
    CODEX_WORLD_MANAGER_SC9_APPLIED_PROJECTION_PATH:
      canvasAppliedPath,
    CODEX_WORLD_MANAGER_SC9_EXTRACTED_PROJECTION_PATH:
      canvasExtractedPath,
  },
);

const projection = JSON.parse(
  fs.readFileSync(
    k4ProjectionPath,
    "utf8",
  ),
);
const canvasProjection =
  JSON.parse(
    fs.readFileSync(
      canvasAppliedPath,
      "utf8",
    ),
  );
const unified =
  projection.unifiedProjection;
const canvasUnified =
  canvasProjection
    .unifiedProjection;

assert.equal(
  validateUnifiedWorldManagerProjection(
    unified,
  ),
  true,
);
assert.equal(
  validateUnifiedWorldManagerProjection(
    canvasUnified,
  ),
  true,
);
assert.equal(
  unified.schema,
  "direct_unified_worldmanager_projection@1",
);
assert.equal(
  unified.profile.baseProfile,
  "artifact_inspector_reference",
);
assert.equal(
  unified.profile.derivativeProfile,
  "unified_semantic_anatomy_workbench",
);
assert.equal(
  unified.semanticAnatomy
    .depthRegistry.length,
  6,
);
assert.deepEqual(
  unified.semanticAnatomy
    .depthRegistry
    .map((entry) => entry.depth),
  [
    "unified_outcome",
    "provenance",
    "governance",
    "compiled_agent",
    "execution",
    "substrate",
  ],
);
assert.ok(
  unified.semanticAnatomy
    .eventObjects.length >= 1,
);
const activeEvent =
  unified.semanticAnatomy
    .eventObjects.at(-1);
assert.equal(
  activeEvent.eventRef.id,
  unified.semanticAnatomy
    .activeEventRef.id,
);
assert.equal(
  activeEvent
    .sameEventIdentityPreserved,
  true,
);
assert.equal(
  new Set(
    activeEvent.depths.map(
      (depth) =>
        `${depth.eventRef.id}:${depth.eventRef.digest}`,
    ),
  ).size,
  1,
);
assert.equal(
  activeEvent.depths
    .find((depth) =>
      depth.depth === "governance")
    .artifactRefs
    .some((ref) =>
      ref.kind ===
        "task_settlement"),
  true,
);
assert.equal(
  activeEvent.depths
    .find((depth) =>
      depth.depth ===
        "compiled_agent")
    .artifactRefs
    .some((ref) =>
      ref.kind ===
        "agent_instantiation"),
  true,
);
assert.equal(
  activeEvent.depths
    .find((depth) =>
      depth.depth === "execution")
    .artifactRefs
    .some((ref) =>
      ref.kind === "agent_result"),
  true,
);
assert.equal(
  activeEvent.evidenceGate
    .sameContextReachable,
  true,
);
assert.equal(
  activeEvent.evidenceGate
    .admissionAuthorityGranted,
  false,
);

assert.equal(
  unified.operationalRibbon
    .scope.projectId,
  "project_alpha",
);
assert.equal(
  unified.operationalRibbon.lane,
  "project_deliberation",
);
assert.equal(
  unified.operationalRibbon.altitude,
  "architecture",
);
assert.equal(
  unified.operationalRibbon
    .context.state,
  "fresh",
);
assert.ok(
  unified.operationalRibbon
    .context.sourceShelfCount > 0,
);
assert.equal(
  unified.operationalRibbon
    .grantsAuthority,
  false,
);

assert.equal(
  canvasUnified
    .operationalRibbon
    .thoughtOperation.state,
  "active",
);
assert.ok(
  canvasUnified
    .operationalRibbon
    .thoughtOperation.brush,
);
assert.equal(
  canvasUnified
    .operationalRibbon
    .thoughtOperation
    .persistencePosture,
  "temporary_reversible",
);
assert.equal(
  canvasUnified
    .operationalRibbon
    .worldEffect,
  "none",
);

assert.equal(
  unified.interactionParity
    .keyboardPointerParity,
  true,
);
assert.equal(
  unified.interactionParity
    .voiceContractParity,
  true,
);
assert.equal(
  unified.interactionParity
    .voiceTransportState,
  "deferred",
);
for (
  const tool of
    unified.interactionParity.tools
) {
  assert.deepEqual(
    tool.invocationContracts.map(
      (entry) =>
        entry.requestSchema,
    ),
    [
      tool.requestSchema,
      tool.requestSchema,
      tool.requestSchema,
    ],
  );
  assert.deepEqual(
    tool.invocationContracts.map(
      (entry) => entry.modality,
    ),
    [
      "keyboard",
      "pointer",
      "voice",
    ],
  );
  assert.equal(
    tool.modalityMintsAuthority,
    false,
  );
}

const tampered =
  structuredClone(unified);
tampered.semanticAnatomy
  .eventObjects[0]
  .depths[0]
  .grantsAuthority = true;
assert.throws(
  () =>
    validateUnifiedWorldManagerProjection(
      tampered,
    ),
  /unified_projection_(child_digest|depth)_invalid/,
);

if (
  process.env
    .CODEX_WORLD_MANAGER_SC10_PROJECTION_PATH
) {
  fs.writeFileSync(
    path.resolve(
      process.env
        .CODEX_WORLD_MANAGER_SC10_PROJECTION_PATH,
    ),
    JSON.stringify(
      projection,
      null,
      2,
    ),
  );
}

console.log(JSON.stringify({
  ok: true,
  slice: "WM-SC10",
  anatomyDepthCount:
    unified.semanticAnatomy
      .depthRegistry.length,
  eventIdentityPreserved:
    activeEvent
      .sameEventIdentityPreserved,
  operationalRibbonComplete:
    true,
  settlementShelfImportAroBrushAnatomy:
    true,
  keyboardPointerParity: true,
  voiceTypedContractParity: true,
  voiceTransportTruthful:
    unified.interactionParity
      .voiceTransportState,
  sameContextEvidenceGate: true,
  inspectionMintsAuthority:
    false,
}));
