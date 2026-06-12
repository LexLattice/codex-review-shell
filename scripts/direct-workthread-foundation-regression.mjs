#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DirectWorkThreadRegistryStore,
  buildWorkThread,
  buildWorkTargetResolution,
} from "../src/main/direct/bridge/work-thread-registry.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function mkTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "direct-workthread-foundation-"));
}

function seedRegistry(store) {
  const direct = store.upsertWorkThread({
    workThreadId: "work_thread_direct_bridge",
    projectId: "codex-review-shell-direct",
    title: "Direct information bridge work",
    ontologyProfileRef: { kind: "odeu_profile", id: "direct_information_bridge", label: "Direct bridge ontology" },
    workspaceIdentity: { workspaceKind: "wsl", workspaceEvidenceKey: "workspace_codex_review_shell_direct" },
    branchIdentity: { branchName: "codex/direct-chatgpt-harness", branchEvidenceKey: "branch_direct_harness" },
    objective: {
      summary: "Build direct path around WorkThread, context, authority, memory, skills, and agent orchestration.",
      currentObjective: "Implement WorkThread foundation and shadow target resolution.",
    },
    currentArc: { arcId: "arc_direct_bridge_foundation", label: "Direct bridge foundation", status: "active" },
    phaseState: { phaseId: "phase_workthread_v0", phaseKind: "workthread_foundation", status: "active" },
    activeRuntimePath: "direct-implementation",
    openObligations: [
      { obligationId: "obl_workthread_registry", kind: "implementation", summary: "Create WorkThread registry substrate.", status: "open" },
    ],
    linkedCodexThreads: [
      { threadId: "codex_direct_thread_1", title: "Direct path implementation", status: "active" },
    ],
    linkedChatGptThreads: [
      { threadId: "gpt_direct_thread_1", title: "Direct path design review", status: "linked" },
    ],
    evidenceRefs: [{ kind: "design_doc", id: "DIRECT_INFORMATION_BRIDGE_IMPLEMENTATION_AUDIT", confidence: "accepted" }],
  });
  const venustrade = store.upsertWorkThread({
    workThreadId: "work_thread_venustrade_ingest",
    projectId: "venustrade-bot",
    title: "Crypto ingestion stablecoin filtering",
    ontologyProfileRef: { kind: "odeu_profile", id: "venustrade_ingestion", label: "Venustrade ingestion ontology" },
    workspaceIdentity: { workspaceKind: "wsl", workspaceEvidenceKey: "workspace_venustrade_bot" },
    branchIdentity: { branchName: "main", branchEvidenceKey: "branch_main" },
    objective: "Maintain trading pair ingestion exclusions and evidence-backed market filters.",
    activeRuntimePath: "app-server",
    linkedCodexThreads: [{ threadId: "codex_venustrade_thread_1", title: "Stablecoin list update" }],
  });
  const sibling = store.upsertWorkThread({
    workThreadId: "work_thread_direct_docs",
    projectId: "codex-review-shell-direct",
    title: "Direct branch documentation hygiene",
    ontologyProfileRef: { kind: "odeu_profile", id: "direct_docs", label: "Direct docs" },
    objective: "Keep direct branch docs aligned with implementation.",
    activeRuntimePath: "direct-text",
  });
  return { direct, venustrade, sibling };
}

function main() {
  const rootDir = mkTempRoot();
  const store = new DirectWorkThreadRegistryStore({
    rootDir,
    now: () => new Date("2026-06-12T12:00:00.000Z").getTime(),
  });
  const seeded = seedRegistry(store);
  const projection = store.buildProjection({ projectId: "codex-review-shell-direct" });
  assert(projection.schema === "direct_work_thread_projection@1", "projection schema mismatch");
  assert(projection.rowCount === 2, `expected 2 project rows, got ${projection.rowCount}`);
  assert(projection.activeCount === 2, `expected 2 active rows, got ${projection.activeCount}`);
  assert(projection.rows.every((row) => row.workThreadId && row.digest), "projection rows must carry identity and digest");

  const selected = store.resolveWorkTarget({
    projectId: "codex-review-shell-direct",
    branchName: "codex/direct-chatgpt-harness",
    activeRuntimePath: "direct-implementation",
    userRequest: "continue the direct information bridge WorkThread registry implementation",
  });
  assert(selected.schema === "direct_work_target_resolution@1", "resolution schema mismatch");
  assert(selected.resolutionState === "selected", `expected selected, got ${selected.resolutionState}`);
  assert(selected.selectedWorkThreadId === seeded.direct.workThreadId, "selected wrong WorkThread");
  assert(selected.transitionLaw.mutationAllowed === false, "shadow resolver must not authorize mutation");
  assert(selected.transitionLaw.providerCallAllowed === false, "shadow resolver must not authorize provider calls");
  assert(selected.requestRawTextIncluded === false, "resolution must not store raw request text");

  const ambiguous = store.resolveWorkTarget({
    projectId: "codex-review-shell-direct",
    userRequest: "continue direct work",
  });
  assert(["ambiguous", "unresolved"].includes(ambiguous.resolutionState), "low-specificity request should not be confidently selected");
  assert(ambiguous.selectedWorkThreadId === "", "ambiguous/unresolved request must not select a thread");

  const noCandidate = store.resolveWorkTarget({
    projectId: "unknown-project",
    userRequest: "continue direct work",
  });
  assert(noCandidate.resolutionState === "unresolved", "unknown project should be unresolved");
  assert(noCandidate.ambiguityBlockers.includes("no_candidate_work_thread"), "missing no-candidate blocker");

  const directRaw = store.readWorkThread(seeded.direct.workThreadId);
  assert(directRaw.rawPathIncluded === false, "work thread must not expose raw paths");
  assert(directRaw.authorityBoundary.mutationAllowedBeforeResolution === false, "mutation must be blocked before resolution");

  const built = buildWorkThread({ title: "Minimal", projectId: "p" });
  assert(built.ontologyProfileRef.rawPathIncluded === false, "refs must be renderer-safe");
  const standaloneResolution = buildWorkTargetResolution({ projectId: "p", userRequest: "minimal" }, [built]);
  assert(standaloneResolution.transitionLaw.routingEnforced === false, "standalone resolver must remain shadow-only");

  console.log(JSON.stringify({
    ok: true,
    rootDirExposed: false,
    projectionRows: projection.rowCount,
    selected: selected.selectedWorkThreadId,
    ambiguousState: ambiguous.resolutionState,
    noCandidateState: noCandidate.resolutionState,
  }, null, 2));
}

main();
