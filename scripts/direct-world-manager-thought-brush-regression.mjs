#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(
  import.meta.url,
);
const {
  DirectWorldManagerControlPlaneStore,
} = require(
  "../src/main/direct/worldmanager/control-plane-store",
);
const {
  DirectWorldManagerService,
} = require(
  "../src/main/direct/worldmanager/service",
);
const {
  DirectThoughtBrushRuntime,
  THOUGHT_BRUSH_ACTION,
} = require(
  "../src/main/direct/worldmanager/thought-brush",
);

let tick = Date.parse(
  "2026-07-31T15:00:00.000Z",
);
const now = () => {
  tick += 1_000;
  return tick;
};

const projects = [
  {
    id: "project_context_canvas",
    name: "ContextCanvas Studio",
    summary:
      "Build reversible semantic attention tools.",
    runtimePath: "direct",
  },
  {
    id: "project_windows_shell",
    name: "Windows Shell Studio",
    summary:
      "Design native Windows context-menu integration.",
    runtimePath: "direct",
  },
];

function actionArguments(request) {
  const projectKey =
    `project:${request.projectId}`;
  const targetKey =
    `project:${request.targetProjectId}`;
  const selected =
    request.brush === "switch"
      ? [targetKey]
      : [projectKey];
  const preserved =
    request
      .requiredPreservationKeys ||
    [];
  if (
    request.brush ===
      "vertical_ascent"
  ) {
    return {
      summary:
        "The current implementation direction is governed by a reversible-attention purpose: change what is salient without changing canonical worldstate.",
      altitude: "purpose",
      selectedAnchorKeys:
        selected,
      selectedContextKeys: [],
      preservedSourceKeys:
        preserved,
      resultObjects: [
        {
          objectKey:
            "reversible_attention_purpose",
          objectKind:
            "semantic_purpose",
          label:
            "Reversible semantic attention",
          summary:
            "Thought brushes alter the operational canvas while preserving canonical worldstate and exact source identity.",
          sourceKeys: selected,
          relationHints: [
            "governs temporary context transformations",
            "precedes any candidate extraction",
          ],
          temporaryPosture:
            "exploratory",
        },
      ],
      candidateInsights: [
        {
          insightKey:
            "reversible_attention_aro",
          conceptKey:
            "reversible_semantic_attention",
          semanticIdentity:
            "Reversible semantic attention",
          purpose:
            "Let a user redirect semantic salience without silently changing the governed world.",
          rationale:
            "The project scope and ascent direction jointly support an intensional object with a preservation invariant and an explicit candidate boundary.",
          sourceKeys: selected,
          branches: [
            {
              branchKey:
                "preserve_worldstate",
              parentBranchKey: "",
              branchKind:
                "semantic_invariant",
              modality: "required",
              statement:
                "Every brush result remains temporary and reversible.",
              condition:
                "Whenever a thought brush is applied.",
              expectedOutcome:
                "Canonical worldstate is unchanged.",
              semanticState:
                "supported",
            },
            {
              branchKey:
                "extract_candidate_only",
              parentBranchKey:
                "preserve_worldstate",
              branchKind:
                "governance_boundary",
              modality: "required",
              statement:
                "An extracted insight enters the existing ARO candidate path.",
              condition:
                "When the user explicitly extracts an ARO-shaped insight.",
              expectedOutcome:
                "Review and admission remain separate.",
              semanticState:
                "supported",
            },
            {
              branchKey:
                "silent_admission",
              parentBranchKey:
                "preserve_worldstate",
              branchKind:
                "counterfactual_failure",
              modality:
                "counterfactual",
              statement:
                "A brush directly admits its result.",
              condition:
                "Only in the rejected silent-admission world.",
              expectedOutcome:
                "The authority boundary would be violated.",
              semanticState:
                "contradicted",
            },
          ],
          edges: [
            {
              fromBranchKey:
                "preserve_worldstate",
              toBranchKey:
                "extract_candidate_only",
              relationKind:
                "requires",
              rationale:
                "Reversibility requires a separate governed promotion boundary.",
            },
            {
              fromBranchKey:
                "silent_admission",
              toBranchKey:
                "preserve_worldstate",
              relationKind:
                "excludes",
              rationale:
                "Direct admission contradicts temporary canvas semantics.",
            },
          ],
        },
      ],
      omissions: [],
    };
  }
  if (
    request.brush === "switch"
  ) {
    return {
      summary:
        "The canvas now foregrounds the Windows Shell Studio without appending the prior project-scoped objects.",
      altitude: "project",
      selectedAnchorKeys:
        selected,
      selectedContextKeys: [],
      preservedSourceKeys:
        preserved,
      resultObjects: [
        {
          objectKey:
            "windows_shell_focus",
          objectKind:
            "project_focus",
          label:
            "Windows shell context",
          summary:
            "Native Windows shell-integration concerns are now the active temporary context.",
          sourceKeys: selected,
          relationHints: [
            "replaces prior project scope",
          ],
          temporaryPosture:
            "exploratory",
        },
      ],
      candidateInsights: [],
      omissions: [],
    };
  }
  return {
    summary:
      "A counterfactual branch explores an alternate attention posture without claiming it as actual.",
    altitude: "purpose",
    selectedAnchorKeys: selected,
    selectedContextKeys: [],
    preservedSourceKeys:
      preserved,
    resultObjects: [
      {
        objectKey:
          "counterfactual_attention",
        objectKind:
          "counterfactual_branch",
        label:
          "Alternate attention posture",
        summary:
          "If canvas transformations were shared across projects, their policy discriminators would need explicit preservation.",
        sourceKeys: selected,
        relationHints: [
          "counterfactual of project-local canvas",
        ],
        temporaryPosture:
          "counterfactual",
      },
    ],
    candidateInsights: [],
    omissions: [],
  };
}

const rootDir = fs.mkdtempSync(
  path.join(
    os.tmpdir(),
    "world-manager-sc9-",
  ),
);
const store =
  new DirectWorldManagerControlPlaneStore({
    rootDir,
    now,
  });
store.ensureBootstrap({
  userWorldId:
    "user_world_sc9",
  projects,
});
const runtime =
  new DirectThoughtBrushRuntime({
    now,
    runner: async (request) => ({
      actionCalls: [
        {
          callId:
            `call_${request.brushStrokeId}`,
          name:
            THOUGHT_BRUSH_ACTION,
          argumentsJson:
            JSON.stringify(
              actionArguments(
                request,
              ),
            ),
        },
      ],
      telemetry: {
        runtimeMode:
          "fixture_direct",
        model:
          "fixture-thought-brush",
        toolCallCount: 1,
      },
    }),
  });
const service =
  new DirectWorldManagerService({
    store,
    projects,
    activeProjectId:
      projects[0].id,
    userWorldId:
      "user_world_sc9",
    thoughtBrushRuntime:
      runtime,
    now,
  });

try {
  const boot = service.bootstrap();
  const baseProjection =
    boot.projection;
  assert.equal(
    baseProjection.contextCanvas
      .available,
    true,
  );
  assert.equal(
    baseProjection.contextCanvas
      .registry.definitions.length,
    11,
  );
  assert.equal(
    baseProjection.contextCanvas
      .canonicalAdmissionAvailable,
    false,
  );

  const ascent =
    await service.applyThoughtBrush({
      projectId:
        projects[0].id,
      brush:
        "vertical_ascent",
      altitude: "purpose",
      userInstruction:
        "Ascend from the current implementation direction to its governing semantic purpose.",
      operatorActionId:
        "operator_sc9_ascent",
    });
  assert.equal(
    ascent.receipt.state,
    "completed",
  );
  assert.equal(
    ascent.receipt
      .candidateInsightCount,
    1,
  );
  const ascentCanvas =
    ascent.projection
      .contextCanvas.activeCanvas;
  assert.equal(
    ascentCanvas.revision,
    2,
  );
  assert.equal(
    ascentCanvas.worldEffect,
    "none",
  );
  assert.equal(
    ascentCanvas
      .candidateInsights[0]
      .extractionState,
    "available",
  );
  assert.equal(
    ascentCanvas
      .candidateInsights[0]
      .branches.some((branch) =>
        branch.semanticState ===
          "contradicted"),
    true,
  );

  const appliedPath =
    process.env
      .CODEX_WORLD_MANAGER_SC9_APPLIED_PROJECTION_PATH;
  if (appliedPath) {
    fs.writeFileSync(
      appliedPath,
      `${JSON.stringify(
        ascent.projection,
        null,
        2,
      )}\n`,
      "utf8",
    );
  }

  const switched =
    await service.applyThoughtBrush({
      projectId:
        projects[0].id,
      targetProjectId:
        projects[1].id,
      contextCanvasId:
        ascentCanvas
          .contextCanvasRef.id,
      contextCanvasDigest:
        ascentCanvas
          .contextCanvasRef.digest,
      brush: "switch",
      userInstruction:
        "Switch the canvas to the Windows shell project.",
      operatorActionId:
        "operator_sc9_switch",
    });
  const switchedCanvas =
    switched.projection
      .contextCanvas.activeCanvas;
  assert.equal(
    switched.receipt.state,
    "completed",
    JSON.stringify(
      switched.receipt.error,
    ),
  );
  assert.equal(
    switchedCanvas.activeProjectId,
    projects[1].id,
  );
  assert.equal(
    switchedCanvas
      .brushStrokeRefs.length,
    1,
  );
  assert.equal(
    switchedCanvas
      .temporarySemanticObjects
      .some((object) =>
        object.objectKey ===
          "reversible_attention_purpose"),
    false,
  );

  const undone =
    service.undoContextCanvas({
      projectId:
        projects[1].id,
      contextCanvasId:
        switchedCanvas
          .contextCanvasRef.id,
      contextCanvasDigest:
        switchedCanvas
          .contextCanvasRef.digest,
    });
  const restoredCanvas =
    undone.projection
      .contextCanvas.activeCanvas;
  assert.equal(
    restoredCanvas.activeProjectId,
    projects[0].id,
  );
  assert.equal(
    restoredCanvas.operationKind,
    "undo",
  );
  assert.equal(
    restoredCanvas.revision,
    4,
  );
  assert.equal(
    restoredCanvas
      .candidateInsights.length,
    1,
  );

  const insight =
    restoredCanvas
      .candidateInsights[0];
  const extracted =
    service
      .extractContextCanvasInsight({
        schema:
          "direct_context_canvas_insight_extraction_request@1",
        projectId:
          projects[0].id,
        contextCanvasId:
          restoredCanvas
            .contextCanvasRef.id,
        contextCanvasDigest:
          restoredCanvas
            .contextCanvasRef.digest,
        candidateInsightId:
          insight
            .candidateInsightId,
      });
  assert.equal(
    extracted.receipt.state,
    "candidate_registered",
  );
  assert.equal(
    extracted.receipt
      .canonicalAdmissionEffect,
    false,
  );
  const extractedCanvas =
    extracted.projection
      .contextCanvas.activeCanvas;
  assert.equal(
    extractedCanvas
      .candidateInsights[0]
      .extractionState,
    "extracted",
  );
  const candidateRef =
    extracted.receipt
      .aroCandidateRef;
  const candidateSurface =
    extracted.projection
      .semanticSurface
      .objectSurfaces
      .find((surface) =>
        surface.objectClass ===
          "aro_reconstruction_candidate" &&
        surface.subjectRef.id ===
          candidateRef.id);
  assert.ok(candidateSurface);

  const extractedPath =
    process.env
      .CODEX_WORLD_MANAGER_SC9_EXTRACTED_PROJECTION_PATH;
  if (extractedPath) {
    fs.writeFileSync(
      extractedPath,
      `${JSON.stringify(
        extracted.projection,
        null,
        2,
      )}\n`,
      "utf8",
    );
  }

  const reviewBinding =
    candidateSurface
      .regionBindings[0]
      .bindingRef;
  const reviewed =
    service
      .reviewAroReconstructionCandidate({
        candidateId:
          candidateRef.id,
        candidateDigest:
          candidateRef.digest,
        expectedCandidateRevision: 1,
        semanticRegionBindingRef:
          reviewBinding,
        actorId: "operator",
      });
  const reviewedCandidate =
    reviewed.projection
      .aroRegistry.candidates
      .find((candidate) =>
        candidate.candidateId ===
          candidateRef.id);
  assert.equal(
    reviewedCandidate
      .evidenceReviewState,
    "reviewed",
  );
  const reviewedSurface =
    reviewed.projection
      .semanticSurface
      .objectSurfaces
      .find((surface) =>
        surface.objectClass ===
          "aro_reconstruction_candidate" &&
        surface.subjectRef.id ===
          candidateRef.id);
  const admitted =
    service
      .admitAroReconstructionCandidate({
        candidateId:
          candidateRef.id,
        candidateDigest:
          reviewedCandidate.digest,
        expectedCandidateRevision:
          reviewedCandidate
            .candidateRevision,
        semanticRegionBindingRef:
          reviewedSurface
            .regionBindings[0]
            .bindingRef,
        actorId: "operator",
      });
  assert.equal(
    admitted.projection
      .aroRegistry.canonicalAros
      .some((aro) =>
        aro.conceptKey ===
          "reversible_semantic_attention"),
    true,
  );

  const currentCanvas =
    admitted.projection
      .contextCanvas.activeCanvas;
  const counterfactual =
    await service.applyThoughtBrush({
      projectId:
        projects[0].id,
      contextCanvasId:
        currentCanvas
          .contextCanvasRef.id,
      contextCanvasDigest:
        currentCanvas
          .contextCanvasRef.digest,
      brush:
        "counterfactual_branch",
      userInstruction:
        "Explore the alternate world where canvases are shared across projects.",
      operatorActionId:
        "operator_sc9_counterfactual",
    });
  assert.equal(
    counterfactual.projection
      .contextCanvas.activeCanvas
      .temporarySemanticObjects
      .at(-1)
      .temporaryPosture,
    "counterfactual",
  );
  assert.equal(
    counterfactual.projection
      .contextCanvas.worldEffect,
    "none",
  );

  const basePath =
    process.env
      .CODEX_WORLD_MANAGER_SC9_BASE_PROJECTION_PATH;
  if (basePath) {
    fs.writeFileSync(
      basePath,
      `${JSON.stringify(
        baseProjection,
        null,
        2,
      )}\n`,
      "utf8",
    );
  }

  const summary = {
    ok: true,
    slice: "WM-SC9",
    registryBrushCount:
      baseProjection
        .contextCanvas.registry
        .definitions.length,
    contextCanvasRevisions:
      store.descriptor().counts
        .contextCanvasRevisionCount,
    switchReplacedContext: true,
    undoRestoredPriorPosture:
      true,
    counterfactualTemporary:
      true,
    insightExtractionCandidateOnly:
      true,
    normalAroAdmissionReused:
      true,
    canonicalEffectRequiresSeparateAdmission:
      true,
    workspaceMutationEffect:
      false,
  };
  console.log(
    JSON.stringify(summary),
  );
} finally {
  service.close();
  fs.rmSync(
    rootDir,
    {
      recursive: true,
      force: true,
    },
  );
}
