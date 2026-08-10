#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  compileSemanticSurfaceProjection,
  validateSemanticSurfaceProjection,
} = require(
  "../src/main/direct/worldmanager/semantic-surface-compiler",
);

const rootDir = fs.mkdtempSync(
  path.join(
    os.tmpdir(),
    "direct-world-manager-sc6-",
  ),
);
const sc5ProjectionPath = path.join(
  rootDir,
  "sc5-projection.json",
);
const sc5FinalProjectionPath = path.join(
  rootDir,
  "sc5-final-projection.json",
);
const genesisProjectionPath = path.join(
  rootDir,
  "genesis-projection.json",
);
const genesisCandidateProjectionPath =
  path.join(
    rootDir,
    "genesis-candidate-projection.json",
  );
const genesisReviewedProjectionPath =
  path.join(
    rootDir,
    "genesis-reviewed-projection.json",
  );

function runFixture(script, env) {
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
  "scripts/direct-world-manager-decision-transition-regression.mjs",
  {
    CODEX_WORLD_MANAGER_SC5_INITIAL_PROJECTION_PATH:
      sc5ProjectionPath,
    CODEX_WORLD_MANAGER_SC5_PROJECTION_PATH:
      sc5FinalProjectionPath,
  },
);
runFixture(
  "scripts/direct-world-manager-project-genesis-regression.mjs",
  {
    CODEX_WORLD_MANAGER_GENESIS_PROJECTION_PATH:
      genesisProjectionPath,
    CODEX_WORLD_MANAGER_GENESIS_CANDIDATE_PROJECTION_PATH:
      genesisCandidateProjectionPath,
    CODEX_WORLD_MANAGER_GENESIS_REVIEWED_PROJECTION_PATH:
      genesisReviewedProjectionPath,
  },
);

const sc5Projection = JSON.parse(
  fs.readFileSync(
    sc5ProjectionPath,
    "utf8",
  ),
);
const genesisProjection = JSON.parse(
  fs.readFileSync(
    genesisProjectionPath,
    "utf8",
  ),
);
const sc5FinalProjection = JSON.parse(
  fs.readFileSync(
    sc5FinalProjectionPath,
    "utf8",
  ),
);
const genesisCandidateProjection =
  JSON.parse(
    fs.readFileSync(
      genesisCandidateProjectionPath,
      "utf8",
    ),
  );

const sc5Surface =
  sc5Projection.semanticSurface;
const genesisSurface =
  genesisProjection.semanticSurface;
const genesisCandidateSurface =
  genesisCandidateProjection
    .semanticSurface;
const sc5FinalSurface =
  sc5FinalProjection.semanticSurface;
assert.equal(
  validateSemanticSurfaceProjection(
    sc5Surface,
  ),
  true,
);
assert.equal(
  validateSemanticSurfaceProjection(
    genesisSurface,
  ),
  true,
);
assert.equal(
  validateSemanticSurfaceProjection(
    genesisCandidateSurface,
  ),
  true,
);
assert.equal(
  validateSemanticSurfaceProjection(
    sc5FinalSurface,
  ),
  true,
);

const expectedLenses = [
  "O",
  "E",
  "D",
  "U",
];
for (
  const projection of [
    sc5Surface,
    sc5FinalSurface,
    genesisSurface,
    genesisCandidateSurface,
  ]
) {
  assert.equal(
    projection.sameObjectIdentityPreserved,
    true,
  );
  assert.equal(
    projection.suppressedMeansAbsent,
    false,
  );
  assert.equal(
    projection.responsiveIdentityInvariant,
    true,
  );
  assert.equal(
    projection.uiMintsAuthority,
    false,
  );
  assert.equal(
    projection.canonicalWorldstateMutation,
    false,
  );
  assert.equal(
    projection.grantsAuthority,
    false,
  );
  for (
    const surface of
      projection.objectSurfaces
  ) {
    assert.deepEqual(
      surface.availableLenses,
      expectedLenses,
    );
    assert.deepEqual(
      surface.lensProjections.map(
        (lens) => lens.lens,
      ),
      expectedLenses,
    );
    assert.deepEqual(
      surface.regionBindings.map(
        (entry) => entry.lens,
      ),
      expectedLenses,
    );
    assert.equal(
      new Set(
        surface.lensProjections.map(
          (lens) =>
            JSON.stringify(
              lens.subjectRef,
            ),
        ),
      ).size,
      1,
    );
    assert.equal(
      new Set(
        surface.lensProjections.map(
          (lens) =>
            lens
              .semanticLensProjectionId,
        ),
      ).size,
      4,
    );
    assert.equal(
      new Set(
        surface.lensProjections.map(
          (lens) =>
            JSON.stringify(
              lens.promotedRelationKinds,
            ),
        ),
      ).size,
      4,
    );
    assert.equal(
      surface.projectionWitnesses
        .length,
      4,
    );
    const bindings =
      projection.regionBindings.filter(
        (binding) =>
          binding.subjectRef.id ===
            surface.subjectRef.id &&
          binding.subjectRef.digest ===
            surface.subjectRef.digest,
      );
    assert.equal(bindings.length, 4);
    assert.deepEqual(
      bindings.map(
        (binding) =>
          binding.selectedLens,
      ),
      expectedLenses,
    );
    assert.ok(
      bindings.every((binding) =>
        binding.bindingPosture ===
          "exact_region_binding" &&
        binding.grantsAuthority ===
          false),
    );
  }
}

const sc5Decisions =
  sc5Projection.decisionSummary
    .openDecisions;
const oneOptionMechanical =
  sc5Decisions.find((decision) =>
    decision.resolutionMode ===
      "mechanical" &&
    decision.options.length === 1);
assert.ok(oneOptionMechanical);
const secondOption = {
  ...oneOptionMechanical.options[0],
  optionId: "wm_decision_option_alternate",
  optionKey: "alternate",
  optionRef: {
    kind: "decision_option",
    id: "wm_decision_option_alternate",
    digest:
      `sha256:${"a".repeat(64)}`,
  },
  label: "Alternate",
  effectSummary:
    "Record the alternate semantic posture.",
};
const binaryDecision = {
  ...oneOptionMechanical,
  options: [
    oneOptionMechanical.options[0],
    secondOption,
  ],
};
const manyDecision = {
  ...oneOptionMechanical,
  decisionId:
    "wm_open_decision_many_options",
  artifactRef: {
    kind: "open_decision",
    id: "wm_open_decision_many_options",
    digest:
      `sha256:${"b".repeat(64)}`,
  },
  semanticIdentity:
    "Which of three trajectories applies?",
  text:
    "Which of three trajectories applies?",
  options: [
    oneOptionMechanical.options[0],
    secondOption,
    {
      ...secondOption,
      optionId:
        "wm_decision_option_third",
      optionKey: "third",
      optionRef: {
        kind: "decision_option",
        id:
          "wm_decision_option_third",
        digest:
          `sha256:${"c".repeat(64)}`,
      },
      label: "Third",
    },
  ],
};
const morphFixture =
  compileSemanticSurfaceProjection({
    projectionRevision: 77,
    activeProjectId: "project_sc5",
    projects: [{
      projectId: "project_sc5",
    }],
    openDecisions: [
      binaryDecision,
      manyDecision,
    ],
  });
assert.equal(
  morphFixture.objectSurfaces.find(
    (surface) =>
      surface.subjectRef.id ===
        binaryDecision.decisionId,
  ).morph.family,
  "binary",
);
assert.equal(
  morphFixture.objectSurfaces.find(
    (surface) =>
      surface.subjectRef.id ===
        manyDecision.decisionId,
  ).morph.family,
  "choice_card",
);

const sc5DecisionSurfaces =
  sc5Surface.objectSurfaces.filter(
    (surface) =>
      surface.objectClass ===
        "open_decision",
  );
assert.ok(
  sc5DecisionSurfaces
    .filter((surface) =>
      [
        "semantic_relay",
        "evidence_request",
        "authority_request",
      ].includes(
        surface.interaction
          .resolutionMode,
      ))
    .every((surface) =>
      surface.morph.family ===
        "scoped_composer"),
);
assert.equal(
  sc5Surface.decisionDock
    .actionRequiredCount,
  sc5DecisionSurfaces.length,
);
for (
  const entry of
    sc5Surface.decisionDock.entries
) {
  const surface =
    sc5DecisionSurfaces.find(
      (candidate) =>
        candidate
          .semanticObjectSurfaceId ===
          entry.surfaceRef.id,
    );
  assert.ok(surface);
  assert.deepEqual(
    entry.subjectRef,
    surface.subjectRef,
  );
}
const sc5Indicator =
  sc5Surface.projectIndicators.find(
    (indicator) =>
      indicator.projectId ===
        "project_sc5",
  );
assert.ok(sc5Indicator);
assert.equal(
  sc5Indicator.decisionCount,
  sc5DecisionSurfaces.length,
);
assert.deepEqual(
  sc5Indicator.subjectRefs,
  sc5DecisionSurfaces.map(
    (surface) => surface.subjectRef,
  ),
);

const candidateSurface =
  genesisCandidateSurface
    .objectSurfaces.find((surface) =>
      surface.objectClass ===
        "project_constitution_candidate");
assert.ok(candidateSurface);
assert.equal(
  candidateSurface.morph.family,
  "comparison",
);
assert.equal(
  candidateSurface.canonicalObject,
  false,
);
const constitutionSurface =
  genesisSurface.objectSurfaces.find(
    (surface) =>
      surface.objectClass ===
        "project_constitution",
  );
assert.ok(constitutionSurface);
assert.equal(
  constitutionSurface.morph.family,
  "status_card",
);
assert.equal(
  constitutionSurface.canonicalObject,
  true,
);
assert.equal(
  constitutionSurface
    .interaction.available,
  false,
);
const receiptSurfaces =
  sc5FinalSurface.objectSurfaces.filter(
    (surface) =>
      surface.objectClass ===
        "decision_transition_receipt",
  );
assert.equal(
  receiptSurfaces.length,
  sc5FinalProjection.decisionSummary
    .recentTransitions.length,
);
assert.ok(
  receiptSurfaces.every((surface) =>
    surface.morph.family ===
      "status_card" &&
    surface.interaction.available ===
      false &&
    surface.interaction
      .downstreamEffectsExecuted ===
      false &&
    surface.interaction
      .executionAuthorityGranted ===
      false),
);

const messageIds = new Set(
  genesisCandidateProjection.messages.map(
    (message) =>
      message.semanticEventId,
  ),
);
assert.ok(
  genesisCandidateSurface
    .inlineArtifacts.length > 0,
);
for (
  const artifact of
    genesisCandidateSurface.inlineArtifacts
) {
  assert.ok(
    messageIds.has(
      artifact.anchorSemanticEventId,
    ),
  );
  const surface =
    genesisCandidateSurface
      .objectSurfaces.find(
        (entry) =>
          entry
            .semanticObjectSurfaceId ===
          artifact.surfaceRef.id,
      );
  assert.ok(surface);
  assert.deepEqual(
    artifact.subjectRef,
    surface.subjectRef,
  );
  assert.equal(
    artifact.grantsAuthority,
    false,
  );
}

function assertNoAuthorityInflation(
  value,
  pathParts = [],
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoAuthorityInflation(
        entry,
        [...pathParts, String(index)],
      ));
    return;
  }
  if (
    !value ||
    typeof value !== "object"
  ) {
    return;
  }
  for (
    const [key, entry] of
      Object.entries(value)
  ) {
    if (
      [
        "grantsAuthority",
        "uiMintsAuthority",
        "executionAuthorityGranted",
        "downstreamEffectsExecuted",
      ].includes(key)
    ) {
      assert.notEqual(
        entry,
        true,
        `${[...pathParts, key].join(".")} inflated authority or effects`,
      );
    }
    assertNoAuthorityInflation(
      entry,
      [...pathParts, key],
    );
  }
}
assertNoAuthorityInflation(sc5Surface);
assertNoAuthorityInflation(
  sc5FinalSurface,
);
assertNoAuthorityInflation(
  genesisCandidateSurface,
);

if (
  process.env
    .CODEX_WORLD_MANAGER_SC6_PROJECTION_PATH
) {
  fs.writeFileSync(
    process.env
      .CODEX_WORLD_MANAGER_SC6_PROJECTION_PATH,
    JSON.stringify(
      genesisCandidateProjection,
      null,
      2,
    ),
  );
}

fs.rmSync(rootDir, {
  recursive: true,
  force: true,
});

console.log(
  JSON.stringify(
    {
      ok: true,
      regression:
        "direct-world-manager-semantic-surface",
      proofs: {
        versionedCompilerProjection: true,
        fourOdeuLandscapes: true,
        identityStableAcrossLenses: true,
        foregroundChangesAcrossLenses: true,
        exactProjectionWitnesses: true,
        exactRegionBindings: true,
        mechanicalBinaryMorph: true,
        mechanicalChoiceMorph: true,
        scopedSemanticComposers: true,
        candidateComparisonMorph: true,
        constitutionStatusMorph: true,
        transitionReceiptStatusMorph: true,
        decisionDockPreservesIdentity: true,
        projectIndicatorsPreserveIdentity: true,
        inlineArtifactsPreserveEventIdentity: true,
        suppressedIsNotAbsent: true,
        responsiveIdentityInvariant: true,
        noAuthorityInflation: true,
      },
    },
    null,
    2,
  ),
);
