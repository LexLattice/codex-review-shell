#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DirectWorkThreadRegistryStore,
  assertWorkTargetResolutionReportSafe,
  buildWorkThread,
  buildWorkTargetResolutionReport,
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
  try {
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
    const selectedReport = store.resolveWorkTargetReport({
      projectId: "codex-review-shell-direct",
      branchName: "codex/direct-chatgpt-harness",
      activeRuntimePath: "direct-implementation",
      userRequest: "continue the direct information bridge WorkThread registry implementation",
    });
    assertWorkTargetResolutionReportSafe(selectedReport);
    assert(selectedReport.routingGateState === "selected_ready", "selected resolution should produce selected-ready gate");
    assert(selectedReport.selectedWorkThreadId === seeded.direct.workThreadId, "selected report should cite selected WorkThread");
    assert(selectedReport.mutationBlocked === false, "selected non-stale report should not be target-blocked");
    assert(selectedReport.mutationAuthorityGranted === false, "selected report must not grant mutation authority");

    const ambiguous = store.resolveWorkTarget({
      projectId: "codex-review-shell-direct",
      userRequest: "continue direct work",
    });
    assert(["ambiguous", "unresolved"].includes(ambiguous.resolutionState), "low-specificity request should not be confidently selected");
    assert(ambiguous.selectedWorkThreadId === "", "ambiguous/unresolved request must not select a thread");
    const ambiguousReport = buildWorkTargetResolutionReport({ resolution: ambiguous, projectId: "codex-review-shell-direct" }, { nowMs: new Date("2026-06-12T12:00:00.000Z").getTime() });
    assertWorkTargetResolutionReportSafe(ambiguousReport);
    assert(ambiguousReport.mutationBlocked === true, "ambiguous/unresolved target must block mutation");
    assert(ambiguousReport.providerCallBlocked === true, "ambiguous/unresolved target must block provider call");
    assert(ambiguousReport.clarificationRequired === true, "ambiguous/unresolved target should require clarification");

    const noCandidate = store.resolveWorkTarget({
      projectId: "unknown-project",
      userRequest: "continue direct work",
    });
    assert(noCandidate.resolutionState === "unresolved", "unknown project should be unresolved");
    assert(noCandidate.ambiguityBlockers.includes("no_candidate_work_thread"), "missing no-candidate blocker");
    const staleReport = buildWorkTargetResolutionReport({
      resolution: selected,
      projectId: "codex-review-shell-direct",
      expectedResolutionDigest: "sha256:stale",
    }, { nowMs: new Date("2026-06-12T12:00:00.000Z").getTime() });
    assertWorkTargetResolutionReportSafe(staleReport);
    assert(staleReport.stale === true, "digest mismatch should mark report stale");
    assert(staleReport.routingGateState === "stale_blocked", "stale report should block routing gate");
    assert(staleReport.selectedWorkThreadId === "", "stale report must not retain selected target");
    assert(staleReport.blockerCodes.includes("resolution_digest_mismatch"), "stale report should expose digest mismatch blocker");

    const epochResolution = {
      ...selected,
      createdAt: "1970-01-01T00:00:00.000Z",
    };
    const epochStaleReport = buildWorkTargetResolutionReport({
      resolution: epochResolution,
      projectId: "codex-review-shell-direct",
      generatedAt: "1970-01-01T00:00:01.001Z",
      maxAgeMs: 1000,
    });
    assertWorkTargetResolutionReportSafe(epochStaleReport);
    assert(epochStaleReport.stale === true, "epoch timestamp should be valid for age checks");
    assert(epochStaleReport.blockerCodes.includes("resolution_age_exceeded"), "epoch age check should expose stale blocker");

    const invalidMaxAgeReport = buildWorkTargetResolutionReport({
      resolution: selected,
      projectId: "codex-review-shell-direct",
      maxAgeMs: "not-a-number",
    }, { nowMs: new Date("2026-06-12T12:00:00.000Z").getTime() });
    assertWorkTargetResolutionReportSafe(invalidMaxAgeReport);
    assert(invalidMaxAgeReport.maxAgeMs === 120000, "invalid maxAgeMs should fall back to default");
    assert(Number.isFinite(invalidMaxAgeReport.maxAgeMs), "maxAgeMs must remain finite");

    const directRaw = store.readWorkThread(seeded.direct.workThreadId);
    assert(directRaw.rawPathIncluded === false, "work thread must not expose raw paths");
    assert(directRaw.authorityBoundary.mutationAllowedBeforeResolution === false, "mutation must be blocked before resolution");

    const unsafe = buildWorkThread({
      title: "Unsafe identity input",
      projectId: "p",
      workspaceIdentity: {
        workspaceKind: "wsl",
        workspaceEvidenceKey: "workspace_safe",
        workspaceRoot: "/home/rose/private/repo",
        repoPath: "/home/rose/private/repo",
        sourceUrl: "https://example.test/private",
      },
      branchIdentity: {
        branchName: "codex/direct-chatgpt-harness",
        branchEvidenceKey: "branch_safe",
        repoPath: "/home/rose/private/repo",
      },
      evidenceRefs: [{ kind: "empty" }, {}, { kind: "audit", id: "audit_ref" }],
    });
    assert(unsafe.workspaceIdentity.workspaceEvidenceKey === "workspace_safe", "workspace evidence key should be retained");
    assert(!("workspaceRoot" in unsafe.workspaceIdentity), "workspace root must not be stored");
    assert(!("repoPath" in unsafe.workspaceIdentity), "workspace repo path must not be stored");
    assert(!("sourceUrl" in unsafe.workspaceIdentity), "workspace URL must not be stored");
    assert(!("repoPath" in unsafe.branchIdentity), "branch repo path must not be stored");
    assert(unsafe.evidenceRefs.length === 1, "empty evidence refs must be filtered");

    const built = buildWorkThread({ title: "Minimal", projectId: "p" });
    assert(built.ontologyProfileRef.rawPathIncluded === false, "refs must be renderer-safe");
    const standaloneResolution = buildWorkTargetResolution({ projectId: "p", userRequest: "minimal" }, [built]);
    assert(standaloneResolution.transitionLaw.routingEnforced === false, "standalone resolver must remain shadow-only");
    const standaloneReport = buildWorkTargetResolutionReport({ resolution: standaloneResolution, projectId: "p" });
    assert(standaloneReport.routingEnforced === false, "productized report must not enforce routing");

    console.log(JSON.stringify({
      ok: true,
      rootDirExposed: false,
      projectionRows: projection.rowCount,
      selected: selected.selectedWorkThreadId,
      selectedGate: selectedReport.routingGateState,
      ambiguousState: ambiguous.resolutionState,
      ambiguousGate: ambiguousReport.routingGateState,
      noCandidateState: noCandidate.resolutionState,
      staleGate: staleReport.routingGateState,
      epochGate: epochStaleReport.routingGateState,
      invalidMaxAge: invalidMaxAgeReport.maxAgeMs,
    }, null, 2));
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
}

main();
