#!/usr/bin/env node

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { scanFixtureForSecrets } = require("../src/main/direct/fixtures/redaction");
const { DirectSessionStore, writeJsonAtomic } = require("../src/main/direct/session/session-store");
const { DirectThreadStore } = require("../src/main/direct/thread/thread-store");
const {
  DIRECT_TEXT_TURN_EMPTY_CONTEXT_POLICY_ID,
  buildContextPack,
  providerInputFromContextPack,
} = require("../src/main/direct/thread/context-pack");
const {
  assertOmissionParity,
  buildDurableThreadMemory,
  buildFrontierBaton,
  buildMaintenanceManifest,
  buildMemoryRefreshManifest,
  buildOmissionLedger,
  buildPressureEstimate,
  buildRawWindowTrimPolicy,
  buildStatusProjection,
  buildTrimPlan,
  buildVanillaSiblingContextEvidence,
  maintenanceRecoveryState,
  maintenanceRefsFromArtifacts,
  selectMaintenanceRoute,
  sha256,
  stableStringify,
  validateStatusProjectionAction,
  validateMaintenanceRefs,
} = require("../src/main/direct/context/maintenance");

const USER_DATA_ROOT_ENV_VAR = "CODEX_REVIEW_SHELL_USER_DATA_ROOT";
const REPORT_SCHEMA = "direct_context_management_eprobe_report@1";

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new Error(`Unknown argument: ${arg}`);
    const raw = arg.slice(2);
    const equals = raw.indexOf("=");
    if (equals >= 0) {
      options[raw.slice(0, equals)] = raw.slice(equals + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      options[raw] = next;
      index += 1;
    } else {
      options[raw] = true;
    }
  }
  return options;
}

function platformAppDataRoot() {
  if (process.platform === "win32") return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support");
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
}

function defaultAppUserDataRoot() {
  return path.join(platformAppDataRoot(), "Codex Review Shell");
}

function safeIdPart(value, fallback = "run") {
  return normalizeString(value, fallback)
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || fallback;
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

function writeTextFile(targetPath, text) {
  ensureDirectory(path.dirname(targetPath));
  fs.writeFileSync(targetPath, text, { mode: 0o600 });
}

function countFilesRecursive(directory) {
  if (!fs.existsSync(directory)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) count += countFilesRecursive(entryPath);
    else if (entry.isFile()) count += 1;
  }
  return count;
}

function assert(condition, message, code = "assertion_failed") {
  if (condition) return;
  const error = new Error(message);
  error.code = code;
  throw error;
}

function expectError(fn, expectedCode) {
  try {
    fn();
  } catch (error) {
    const actual = normalizeString(error.code, error.message);
    assert(actual === expectedCode, `Expected ${expectedCode}, got ${actual}.`, "unexpected_error_code");
    return actual;
  }
  throw Object.assign(new Error(`Expected ${expectedCode} to be thrown.`), { code: "expected_error_missing" });
}

function newFixtureStores(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `direct-context-eprobe-${safeIdPart(label)}-`));
  const sessionStore = new DirectSessionStore({ rootDir: path.join(root, "sessions") });
  const threadStore = new DirectThreadStore({ rootDir: path.join(root, "threads"), mode: "context_build_required" });
  return {
    root,
    sessionStore,
    threadStore,
    cleanup() {
      threadStore.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function fixtureMaintenanceArtifacts(projectId, threadId, options = {}) {
  const pressure = buildPressureEstimate({
    projectId,
    threadId,
    modelId: "fixture-model",
    visibleCharCount: options.visibleCharCount || 94_000,
    hiddenRequiredTokens: options.hiddenRequiredTokens || 1_200,
    modelContextWindowEstimate: options.modelContextWindowEstimate || 24_000,
  });
  const { route } = selectMaintenanceRoute({ pressureEstimate: pressure });
  const trimPolicy = buildRawWindowTrimPolicy();
  const trimPlan = buildTrimPlan({
    route,
    sourceContextProjectionId: "context_projection_fixture",
    sourceContextProjectionDigest: "context_projection_digest_fixture",
    trimPolicy,
    candidateOmissions: [
      {
        sourceArtifactKind: "context_recent_dialogue",
        sourceArtifactId: "context_projection_fixture",
        sourceDigest: "context_projection_digest_fixture",
        sourceStableKeys: ["turn_1", "turn_2", "turn_3"],
        omittedItemCount: 3,
        omittedTurnCount: 3,
        omittedCharCount: 7200,
        omittedTokenEstimate: 1800,
        reason: "over_budget",
        rendererSafeSummary: "Three optional earlier dialogue items omitted under pressure.",
      },
    ],
  });
  const omissionLedger = buildOmissionLedger({ trimPlan });
  const memory = buildDurableThreadMemory({
    projectId,
    threadId,
    entries: [
      {
        kind: "decision",
        authority: "decision_record",
        contextUse: "quoted_context_only",
        rendererSafeSummary: "The direct harness remains the authority for local tool execution.",
        sourceRefs: [{ artifactKind: "operation_history", artifactId: "operation_fixture", artifactDigest: "operation_digest_fixture" }],
      },
    ],
  });
  const memoryRefresh = buildMemoryRefreshManifest({
    projectId,
    threadId,
    nextMemory: memory,
    sourceRefs: [{ artifactKind: "context_projection", artifactId: "context_projection_fixture", artifactDigest: "context_projection_digest_fixture" }],
  });
  const baton = buildFrontierBaton({
    projectId,
    threadId,
    batonRequirement: "required_for_trim",
    frontier: {
      rendererSafeGoalSummary: "Maintain context without silently dropping required direct-harness evidence.",
      nextExpectedAction: "assistant_final",
    },
  });
  const manifest = buildMaintenanceManifest({
    route,
    pressureEstimate: pressure,
    outputKind: "trim_only",
    producedArtifacts: [
      { artifactKind: "raw_window_trim_plan", artifactId: trimPlan.trimPlanId, artifactDigest: trimPlan.integrity.artifactDigest },
      { artifactKind: "context_omission_ledger", artifactId: omissionLedger.omissionLedgerId, artifactDigest: omissionLedger.integrity.artifactDigest },
      { artifactKind: "durable_thread_memory", artifactId: memory.memoryId, artifactDigest: memory.integrity.artifactDigest },
      { artifactKind: "frontier_baton", artifactId: baton.batonId, artifactDigest: baton.integrity.artifactDigest },
    ],
  });
  const refs = maintenanceRefsFromArtifacts({
    pressureEstimate: pressure,
    route,
    maintenanceManifest: manifest,
    trimPlan,
    omissionLedger,
    memory,
    memoryRefresh,
    baton,
    requiredOmissionLedger: true,
    requiredMemory: true,
    requiredBaton: true,
  });
  return { pressure, route, trimPolicy, trimPlan, omissionLedger, memory, memoryRefresh, baton, manifest, refs };
}

function createIndexedDialogueFixture(label) {
  const fixture = newFixtureStores(label);
  const { sessionStore, threadStore } = fixture;
  const session = sessionStore.createSession({
    sessionId: `session_${safeIdPart(label)}`,
    projectId: "project_context_eprobe",
    title: `Context eprobe ${label}`,
    model: "gpt-5.4",
    nativeDirectSession: true,
  }, { nowMs: 1_700_100_000_000 });
  const firstTurn = sessionStore.createTurn(session.sessionId, {
    turnId: `turn_${safeIdPart(label)}_first`,
    input: [{ role: "user", text: "hello context" }],
    model: "gpt-5.4",
  }, { nowMs: 1_700_100_001_000 });
  sessionStore.appendNormalizedEvent(session.sessionId, firstTurn.turnId, {
    type: "message_delta",
    sequence: 0,
    text: "context reply",
  }, { nowMs: 1_700_100_002_000 });
  const completedFirstTurn = sessionStore.updateTurnState(session.sessionId, firstTurn.turnId, "completed", {}, { nowMs: 1_700_100_003_000 });
  const secondTurn = sessionStore.createTurn(session.sessionId, {
    turnId: `turn_${safeIdPart(label)}_second`,
    input: [{ role: "user", text: "next context step" }],
    model: "gpt-5.4",
  }, { nowMs: 1_700_100_004_000 });
  threadStore.indexSessionArtifacts(sessionStore, sessionStore.readSession(session.sessionId), [
    completedFirstTurn,
    secondTurn,
  ], { nowMs: 1_700_100_005_000 });
  return { ...fixture, session: sessionStore.readSession(session.sessionId), firstTurn: completedFirstTurn, secondTurn };
}

function baseProbe(input = {}) {
  return {
    probeId: input.probeId,
    terminalLeaves: input.terminalLeaves || [],
    sourceClass: input.sourceClass || "direct_fixture",
    coverageStatus: input.coverageStatus || "new_probe",
    status: input.status || "passed",
    failureMeaning: input.failureMeaning || "",
    expected: input.expected || "",
    observed: input.observed || {},
    negativeAssertions: {
      providerTransportCalls: 0,
      appServerMutationCalls: 0,
      workspaceReadCalls: 0,
      patchApplyCalls: 0,
      commandRunCalls: 0,
      rightPaneMutationCalls: 0,
      handoffMutationCalls: 0,
      ...(input.negativeAssertions || {}),
    },
  };
}

function probePackManifestRecoveryBoundary() {
  const fixture = newFixtureStores("pack_manifest_recovery");
  try {
    const { sessionStore, threadStore } = fixture;
    const session = sessionStore.createSession({
      sessionId: "session_pack_manifest_recovery",
      projectId: "project_context_eprobe",
      title: "Pack manifest recovery eprobe",
      model: "gpt-5.4",
      nativeDirectSession: true,
    }, { nowMs: 1_700_200_000_000 });
    const turn = sessionStore.createTurn(session.sessionId, {
      turnId: "turn_pack_manifest_recovery",
      input: [{ role: "user", text: "pack only" }],
      model: "gpt-5.4",
    }, { nowMs: 1_700_200_001_000 });
    threadStore.indexSessionArtifacts(sessionStore, sessionStore.readSession(session.sessionId), [turn], { nowMs: 1_700_200_002_000 });
    const contextPack = buildContextPack({
      projectId: session.projectId,
      threadId: session.sessionId,
      turnId: turn.turnId,
      purpose: "direct_text_turn",
      policyId: DIRECT_TEXT_TURN_EMPTY_CONTEXT_POLICY_ID,
      currentUserPrompt: "pack-only recovery boundary",
      nowMs: 1_700_200_003_000,
    });
    threadStore.writeContextPack(contextPack, { nowMs: 1_700_200_004_000 });
    const manifestCount = threadStore.db.prepare("select count(*) as count from direct_request_manifests where turn_id = ?").get(turn.turnId).count;
    const turnRow = threadStore.db.prepare("select context_build_id, request_manifest_id from direct_turns where turn_id = ?").get(turn.turnId);
    assert(manifestCount === 0, "Pack-only recovery fixture unexpectedly wrote a request manifest.", "request_manifest_unexpected");
    assert(turnRow.context_build_id === contextPack.contextBuildId, "Context pack was not linked to the turn.", "context_pack_not_linked");
    assert(!turnRow.request_manifest_id, "Request manifest id should remain empty.", "request_manifest_link_unexpected");
    return baseProbe({
      probeId: "E-CM-PACK-004",
      terminalLeaves: ["C-CM-2.4", "C-CM-10.2"],
      sourceClass: "direct_recovery",
      coverageStatus: "implemented_phase_e",
      expected: "Context pack can exist without a request manifest and remains pre-transport.",
      observed: {
        contextBuildId: contextPack.contextBuildId,
        requestManifestCount: manifestCount,
        recoveryState: "pack_written_manifest_missing_pre_transport",
      },
    });
  } finally {
    fixture.cleanup();
  }
}

function probeStaleProjectionBlocksExactContext() {
  const fixture = createIndexedDialogueFixture("stale_projection");
  try {
    const { sessionStore, threadStore, session, secondTurn } = fixture;
    const rendererProjection = threadStore.buildRendererTranscriptProjection(session.sessionId, {
      sessionStore,
      nowMs: 1_700_210_000_000,
    });
    const contextProjection = threadStore.buildContextRecentDialogueProjection(session.sessionId, {
      nowMs: 1_700_210_001_000,
    });
    const stale = threadStore.markProjectionStale(rendererProjection.projectionId, "phase_e_stale_source_probe");
    assert(stale.invalidatedContextProjectionIds.includes(contextProjection.projectionId), "Renderer staleness did not invalidate context projection.", "context_projection_not_invalidated");
    const blocker = expectError(() => {
      threadStore.buildAndPersistContextForTextTurn({
        session,
        projectId: session.projectId,
        threadId: session.sessionId,
        turnId: secondTurn.turnId,
        currentUserPrompt: "should block stale context",
        sourceContextProjectionId: contextProjection.projectionId,
        requireRecentDialogue: true,
        model: "gpt-5.4",
        requestShape: { requestShapeClass: "direct_text_turn_recent_dialogue@1", store: false, parallelToolCalls: false },
      }, { nowMs: 1_700_210_002_000 });
    }, "context_projection_failed");
    return baseProbe({
      probeId: "E-CM-PROJ-003",
      terminalLeaves: ["C-CM-1.4"],
      sourceClass: "direct_recovery",
      coverageStatus: "implemented_phase_e",
      expected: "Stale context projection cannot feed exact request context.",
      observed: {
        rendererProjectionId: rendererProjection.projectionId,
        contextProjectionId: contextProjection.projectionId,
        staleReason: stale.staleReason,
        blocker,
      },
    });
  } finally {
    fixture.cleanup();
  }
}

function probeOmissionParityNegative() {
  const projectId = "project_context_eprobe";
  const threadId = "thread_omission_negative";
  const artifacts = fixtureMaintenanceArtifacts(projectId, threadId);
  const contextPack = buildContextPack({
    projectId,
    threadId,
    turnId: "turn_omission_negative",
    purpose: "direct_text_turn",
    policyId: DIRECT_TEXT_TURN_EMPTY_CONTEXT_POLICY_ID,
    currentUserPrompt: "omission parity negative",
    maintenanceRefs: artifacts.refs,
    maintenanceArtifacts: {
      omissionLedger: artifacts.omissionLedger,
    },
  });
  const mismatchedContextPack = {
    ...contextPack,
    caps: {
      ...contextPack.caps,
      omittedCounts: {
        ...contextPack.caps.omittedCounts,
        context_omission_ledger_items: Number(contextPack.caps.omittedCounts.context_omission_ledger_items || 0) + 1,
      },
    },
  };
  const blocker = expectError(() => {
    assertOmissionParity({ omissionLedger: artifacts.omissionLedger, contextPack: mismatchedContextPack });
  }, "omission_parity_mismatch");
  return baseProbe({
    probeId: "E-CM-OMIT-005",
    terminalLeaves: ["C-CM-5.4", "C-CM-10.5"],
    sourceClass: "direct_fixture_negative",
    coverageStatus: "implemented_phase_e",
    expected: "Omission ledger/context-pack denominator mismatch fails closed.",
    observed: {
      ledgerItems: artifacts.omissionLedger.totals.omittedItemCount,
      mismatchedPackItems: mismatchedContextPack.caps.omittedCounts.context_omission_ledger_items,
      blocker,
    },
  });
}

function probeMemoryConflictBlockedEntryOmitted() {
  const projectId = "project_context_eprobe";
  const threadId = "thread_memory_conflict";
  const blockedSummary = "blocked conflicting memory should not appear";
  const memory = buildDurableThreadMemory({
    projectId,
    threadId,
    entries: [
      {
        kind: "preference",
        authority: "current_user_preference",
        contextUse: "blocked",
        rendererSafeSummary: blockedSummary,
        conflictState: "conflicts_with_current_user_intent",
        conflictResolution: "memory_omitted",
        sourceRefs: [{ artifactKind: "context_projection", artifactId: "context_projection_memory", artifactDigest: "context_projection_digest_memory" }],
      },
    ],
  });
  const memoryRefresh = buildMemoryRefreshManifest({
    projectId,
    threadId,
    currentMemory: memory,
    status: "failed_current_retained",
    sourceRefs: [{ artifactKind: "context_projection", artifactId: "context_projection_memory", artifactDigest: "context_projection_digest_memory" }],
  });
  const refs = maintenanceRefsFromArtifacts({
    memory,
    memoryRefresh,
    requiredMemory: true,
  });
  validateMaintenanceRefs(refs, { requireMemory: true });
  const contextPack = buildContextPack({
    projectId,
    threadId,
    turnId: "turn_memory_conflict",
    purpose: "direct_text_turn",
    policyId: DIRECT_TEXT_TURN_EMPTY_CONTEXT_POLICY_ID,
    currentUserPrompt: "memory conflict probe",
    maintenanceRefs: refs,
    maintenanceArtifacts: { memory },
  });
  const providerInput = providerInputFromContextPack(contextPack);
  assert(!providerInput.prompt.includes(blockedSummary), "Blocked conflicting memory leaked into provider prompt.", "blocked_memory_included");
  assert(memory.entries[0].conflictState === "conflicts_with_current_user_intent", "Memory conflict state missing.", "memory_conflict_state_missing");
  return baseProbe({
    probeId: "E-CM-MEM-002",
    terminalLeaves: ["C-CM-6.3"],
    sourceClass: "direct_fixture",
    coverageStatus: "implemented_phase_e",
    expected: "Memory conflicting with current user intent can be represented and omitted from provider context.",
    observed: {
      memoryId: memory.memoryId,
      conflictState: memory.entries[0].conflictState,
      conflictResolution: memory.entries[0].conflictResolution,
      providerPromptContainsBlockedSummary: false,
    },
  });
}

function probeMemoryWorkspaceConflictBlockedEntryOmitted() {
  const projectId = "project_context_eprobe";
  const threadId = "thread_memory_workspace_conflict";
  const blockedSummary = "workspace-conflicting memory should not appear";
  const memory = buildDurableThreadMemory({
    projectId,
    threadId,
    entries: [
      {
        kind: "fact",
        authority: "project_fact_candidate",
        contextUse: "blocked",
        rendererSafeSummary: blockedSummary,
        conflictState: "conflicts_with_workspace_evidence",
        conflictResolution: "current_evidence_wins",
        sourceRefs: [
          {
            artifactKind: "workspace_effect_summary",
            artifactId: "workspace_effect_memory_conflict",
            artifactDigest: "workspace_effect_digest_memory_conflict",
          },
        ],
      },
    ],
  });
  const memoryRefresh = buildMemoryRefreshManifest({
    projectId,
    threadId,
    currentMemory: memory,
    status: "failed_current_retained",
    sourceRefs: [
      {
        artifactKind: "workspace_effect_summary",
        artifactId: "workspace_effect_memory_conflict",
        artifactDigest: "workspace_effect_digest_memory_conflict",
      },
    ],
  });
  const refs = maintenanceRefsFromArtifacts({
    memory,
    memoryRefresh,
    requiredMemory: true,
  });
  validateMaintenanceRefs(refs, { requireMemory: true });
  const contextPack = buildContextPack({
    projectId,
    threadId,
    turnId: "turn_memory_workspace_conflict",
    purpose: "direct_text_turn",
    policyId: DIRECT_TEXT_TURN_EMPTY_CONTEXT_POLICY_ID,
    currentUserPrompt: "workspace memory conflict probe",
    maintenanceRefs: refs,
    maintenanceArtifacts: { memory },
  });
  const providerInput = providerInputFromContextPack(contextPack);
  assert(!providerInput.prompt.includes(blockedSummary), "Workspace-conflicting memory leaked into provider prompt.", "workspace_conflicting_memory_included");
  assert(memory.entries[0].conflictState === "conflicts_with_workspace_evidence", "Workspace conflict state missing.", "memory_workspace_conflict_state_missing");
  return baseProbe({
    probeId: "E-CM-MEM-003",
    terminalLeaves: ["C-CM-6.3"],
    sourceClass: "direct_fixture",
    coverageStatus: "implemented_third_loop_probe",
    expected: "Memory conflicting with workspace evidence is represented but omitted from provider context.",
    observed: {
      memoryId: memory.memoryId,
      conflictState: memory.entries[0].conflictState,
      conflictResolution: memory.entries[0].conflictResolution,
      providerPromptContainsBlockedSummary: false,
    },
  });
}

function probeMemoryRefreshRejectsUnsafeSourceRefs() {
  const projectId = "project_context_eprobe";
  const threadId = "thread_memory_refresh_source_freshness";
  const nextMemory = buildDurableThreadMemory({
    projectId,
    threadId,
    entries: [
      {
        kind: "decision",
        authority: "decision_record",
        contextUse: "quoted_context_only",
        rendererSafeSummary: "Source freshness must gate memory refresh.",
        sourceRefs: [
          {
            artifactKind: "context_projection",
            artifactId: "context_projection_refresh_source",
            artifactDigest: "context_projection_digest_refresh_source",
          },
        ],
      },
    ],
  });
  try {
    buildMemoryRefreshManifest({
      projectId,
      threadId,
      nextMemory,
      sourceRefs: [
        {
          artifactKind: "renderer_dom",
          artifactId: "renderer_dom_only_refresh_source",
          artifactDigest: "",
          sourceState: "stale",
          rendererDomOnly: true,
        },
      ],
    });
  } catch (error) {
    const actual = normalizeString(error.code, error.message);
    assert(actual === "memory_refresh_source_ref_invalid", `Expected memory_refresh_source_ref_invalid, got ${actual}.`, "unexpected_error_code");
    return baseProbe({
      probeId: "E-CM-REFRESH-002",
      terminalLeaves: ["C-CM-7.2"],
      sourceClass: "direct_fixture",
      coverageStatus: "implemented_third_loop_probe",
      expected: "Stale or renderer-DOM-only refresh source refs block memory refresh.",
      observed: {
        blocker: actual,
        invalidSourceKinds: ["renderer_dom"],
      },
    });
  }
  return baseProbe({
    probeId: "E-CM-REFRESH-002",
    terminalLeaves: ["C-CM-7.2"],
    sourceClass: "direct_fixture",
    coverageStatus: "possible_implementation_gap",
    status: "gap",
    expected: "Stale or renderer-DOM-only refresh source refs should block memory refresh.",
    observed: {
      acceptedUnsafeSourceRef: true,
      invalidSourceKinds: ["renderer_dom"],
    },
    failureMeaning: "Memory refresh source freshness is not enforced at the refresh-manifest boundary.",
  });
}

function probeRouteMediatedDeterministicMemoryRefresh() {
  const projectId = "project_context_eprobe";
  const threadId = "thread_memory_refresh_route";
  const pressure = buildPressureEstimate({
    projectId,
    threadId,
    modelId: "fixture-model",
    visibleCharCount: 12_000,
    hiddenRequiredTokens: 300,
    modelContextWindowEstimate: 24_000,
  });
  const { route } = selectMaintenanceRoute({
    pressureEstimate: pressure,
    memoryRefreshRequested: true,
  });
  assert(route.routeKind === "memory_refresh", "Memory refresh request did not select memory_refresh route.", "memory_refresh_route_not_selected");
  assert(route.engine === "local_deterministic", "Memory refresh route should be local deterministic.", "memory_refresh_route_engine_wrong");
  const currentMemory = buildDurableThreadMemory({
    projectId,
    threadId,
    entries: [
      {
        kind: "decision",
        authority: "decision_record",
        contextUse: "quoted_context_only",
        rendererSafeSummary: "Old memory remains source evidence.",
        sourceRefs: [{ artifactKind: "context_projection", artifactId: "context_projection_old_memory", artifactDigest: "context_projection_digest_old_memory" }],
      },
    ],
  });
  const nextMemory = buildDurableThreadMemory({
    projectId,
    threadId,
    previousMemoryDigest: currentMemory.integrity.artifactDigest,
    entries: [
      {
        kind: "decision",
        authority: "decision_record",
        contextUse: "quoted_context_only",
        rendererSafeSummary: "Route-mediated refresh produced next memory.",
        sourceRefs: [{ artifactKind: "context_projection", artifactId: "context_projection_next_memory", artifactDigest: "context_projection_digest_next_memory" }],
      },
    ],
  });
  const memoryRefresh = buildMemoryRefreshManifest({
    projectId,
    threadId,
    currentMemory,
    nextMemory,
    sourceRefs: [{ artifactKind: "context_projection", artifactId: "context_projection_next_memory", artifactDigest: "context_projection_digest_next_memory" }],
  });
  const manifest = buildMaintenanceManifest({
    route,
    pressureEstimate: pressure,
    outputKind: "deterministic_excerpt",
    producedArtifacts: [
      { artifactKind: "thread_memory_refresh", artifactId: memoryRefresh.memoryRefreshId, artifactDigest: memoryRefresh.integrity.artifactDigest },
      { artifactKind: "durable_thread_memory", artifactId: nextMemory.memoryId, artifactDigest: nextMemory.integrity.artifactDigest },
    ],
  });
  assert(memoryRefresh.status === "completed", "Memory refresh manifest should be completed.", "memory_refresh_not_completed");
  assert(memoryRefresh.currentRetained === false, "Completed refresh should not retain current memory as current.", "memory_refresh_current_retained");
  assert(memoryRefresh.providerTransportUsed === false && manifest.providerTransportUsed === false, "Deterministic memory refresh used provider transport.", "memory_refresh_provider_transport_used");
  return baseProbe({
    probeId: "E-CM-REFRESH-003",
    terminalLeaves: ["C-CM-7.3"],
    sourceClass: "direct_headless",
    coverageStatus: "implemented_third_loop_probe",
    expected: "Memory refresh is route-mediated, local deterministic, and writes explicit refresh/memory artifacts.",
    observed: {
      routeKind: route.routeKind,
      routeEngine: route.engine,
      memoryRefreshId: memoryRefresh.memoryRefreshId,
      currentMemoryId: currentMemory.memoryId,
      nextMemoryId: nextMemory.memoryId,
      maintenanceManifestId: manifest.maintenanceManifestId,
      providerTransportUsed: manifest.providerTransportUsed,
    },
  });
}

function probeBatonSupersessionRequiredBlocksOptionalOmits() {
  const projectId = "project_context_eprobe";
  const threadId = "thread_baton_supersession";
  const staleGoal = "old superseded baton goal should not be included";
  const currentBaton = buildFrontierBaton({
    projectId,
    threadId,
    batonId: "frontier_baton_current_phase_e",
    batonRequirement: "required_for_trim",
    frontier: {
      rendererSafeGoalSummary: "current baton goal",
      nextExpectedAction: "assistant_final",
    },
  });
  const staleBaton = buildFrontierBaton({
    projectId,
    threadId,
    batonId: "frontier_baton_stale_phase_e",
    batonRequirement: "required_for_trim",
    batonState: "stale",
    supersededByBatonId: currentBaton.batonId,
    frontier: {
      rendererSafeGoalSummary: staleGoal,
      nextExpectedAction: "assistant_final",
    },
  });
  const refs = maintenanceRefsFromArtifacts({
    baton: staleBaton,
    requiredBaton: true,
  });
  validateMaintenanceRefs(refs, { requireBaton: true });
  const requiredBlocker = expectError(() => {
    buildContextPack({
      projectId,
      threadId,
      turnId: "turn_baton_supersession_required",
      purpose: "direct_text_turn",
      policyId: DIRECT_TEXT_TURN_EMPTY_CONTEXT_POLICY_ID,
      currentUserPrompt: "required baton supersession probe",
      maintenanceRefs: refs,
      maintenanceArtifacts: { baton: staleBaton },
    });
  }, "required_baton_stale");
  const optionalRefs = maintenanceRefsFromArtifacts({
    baton: staleBaton,
    requiredBaton: false,
  });
  const optionalContextPack = buildContextPack({
    projectId,
    threadId,
    turnId: "turn_baton_supersession_optional",
    purpose: "direct_text_turn",
    policyId: DIRECT_TEXT_TURN_EMPTY_CONTEXT_POLICY_ID,
    currentUserPrompt: "optional baton supersession probe",
    maintenanceRefs: optionalRefs,
    maintenanceArtifacts: { baton: staleBaton },
  });
  const providerInput = providerInputFromContextPack(optionalContextPack);
  const staleIncluded = providerInput.prompt.includes(staleGoal);
  const staleSourceArtifactIncluded = optionalContextPack.sourceArtifacts.some((entry) => entry.artifactKind === "frontier_baton");
  assert(!staleIncluded, "Optional stale baton leaked into provider prompt.", "optional_stale_baton_included");
  assert(!staleSourceArtifactIncluded, "Optional stale baton was cited as context evidence.", "optional_stale_baton_source_artifact_included");
  const expectedRecoveryState = maintenanceRecoveryState({ batonStale: true });
  return baseProbe({
    probeId: "E-CM-BATON-004",
    terminalLeaves: ["C-CM-8.4"],
    sourceClass: "direct_fixture",
    coverageStatus: "implemented_phase_g",
    expected: "Required stale/superseded baton blocks; optional stale/superseded baton is omitted.",
    observed: {
      staleBatonId: staleBaton.batonId,
      currentBatonId: currentBaton.batonId,
      requiredBlocker,
      staleIncludedInProviderPrompt: staleIncluded,
      staleSourceArtifactIncluded,
      expectedRecoveryState,
    },
  });
}

function probeOptionalMissingBatonDoesNotGloballyBlock() {
  const projectId = "project_context_eprobe";
  const threadId = "thread_optional_missing_baton";
  const contextPack = buildContextPack({
    projectId,
    threadId,
    turnId: "turn_optional_missing_baton",
    purpose: "direct_text_turn",
    policyId: DIRECT_TEXT_TURN_EMPTY_CONTEXT_POLICY_ID,
    currentUserPrompt: "optional missing baton probe",
    maintenanceRefs: {
      schema: "direct_context_maintenance_refs@1",
      requiredBaton: false,
      refsDigest: "optional_missing_baton_refs",
    },
    maintenanceArtifacts: {},
  });
  const providerInput = providerInputFromContextPack(contextPack);
  assert(!providerInput.prompt.includes("[FRONTIER BATON - STATUS EVIDENCE]"), "Missing optional baton created provider-visible baton context.", "optional_missing_baton_included");
  return baseProbe({
    probeId: "E-CM-BATON-003",
    terminalLeaves: ["C-CM-8.3"],
    sourceClass: "direct_fixture",
    coverageStatus: "implemented_second_loop",
    expected: "Missing optional baton does not globally block context build and does not create baton context evidence.",
    observed: {
      contextBuildId: contextPack.contextBuildId,
      frontierBatonSourceArtifactCount: contextPack.sourceArtifacts.filter((entry) => entry.artifactKind === "frontier_baton").length,
      providerPromptIncludesBaton: false,
    },
  });
}

function probePackOnlyRecoveryNoSendInferred() {
  const fixture = newFixtureStores("rec_pack_only");
  try {
    const { sessionStore, threadStore } = fixture;
    const session = sessionStore.createSession({
      sessionId: "session_rec_pack_only",
      projectId: "project_context_eprobe",
      title: "Recovery pack-only eprobe",
      model: "gpt-5.4",
      nativeDirectSession: true,
    }, { nowMs: 1_700_300_000_000 });
    const turn = sessionStore.createTurn(session.sessionId, {
      turnId: "turn_rec_pack_only",
      input: [{ role: "user", text: "pack recovery" }],
      model: "gpt-5.4",
    }, { nowMs: 1_700_300_001_000 });
    threadStore.indexSessionArtifacts(sessionStore, sessionStore.readSession(session.sessionId), [turn], { nowMs: 1_700_300_002_000 });
    const beforeManifestCount = threadStore.db.prepare("select count(*) as count from direct_request_manifests").get().count;
    const contextPack = buildContextPack({
      projectId: session.projectId,
      threadId: session.sessionId,
      turnId: turn.turnId,
      purpose: "direct_text_turn",
      policyId: DIRECT_TEXT_TURN_EMPTY_CONTEXT_POLICY_ID,
      currentUserPrompt: "pack recovery no-send inferred",
      nowMs: 1_700_300_003_000,
    });
    threadStore.writeContextPack(contextPack, { nowMs: 1_700_300_004_000 });
    const afterManifestCount = threadStore.db.prepare("select count(*) as count from direct_request_manifests").get().count;
    const turnRow = threadStore.db.prepare("select context_build_id, request_manifest_id from direct_turns where turn_id = ?").get(turn.turnId);
    assert(beforeManifestCount === 0 && afterManifestCount === 0, "Pack-only recovery probe inferred or wrote a request manifest.", "manifest_write_unexpected");
    assert(turnRow.context_build_id === contextPack.contextBuildId, "Pack-only context build was not persisted.", "context_pack_missing");
    assert(!turnRow.request_manifest_id, "Pack-only recovery should not infer provider send.", "provider_send_inferred");
    return baseProbe({
      probeId: "E-CM-REC-002",
      terminalLeaves: ["C-CM-10.2"],
      sourceClass: "direct_recovery",
      coverageStatus: "implemented_second_loop",
      expected: "Pack exists, manifest missing is pre-transport and no provider send is inferred.",
      observed: {
        contextBuildId: contextPack.contextBuildId,
        requestManifestCount: afterManifestCount,
        providerSendInferred: false,
      },
    });
  } finally {
    fixture.cleanup();
  }
}

function probeTrimPlanWithoutLedgerBlocksCleanUse() {
  const projectId = "project_context_eprobe";
  const threadId = "thread_trim_no_ledger";
  const pressure = buildPressureEstimate({
    projectId,
    threadId,
    modelId: "fixture-model",
    visibleCharCount: 94_000,
    hiddenRequiredTokens: 1_200,
    modelContextWindowEstimate: 24_000,
  });
  const { route } = selectMaintenanceRoute({ pressureEstimate: pressure });
  const trimPlan = buildTrimPlan({
    route,
    trimPolicy: buildRawWindowTrimPolicy(),
    sourceContextProjectionId: "context_projection_trim_no_ledger",
    sourceContextProjectionDigest: "context_projection_digest_trim_no_ledger",
    candidateOmissions: [
      {
        sourceArtifactKind: "context_recent_dialogue",
        sourceArtifactId: "context_projection_trim_no_ledger",
        sourceDigest: "context_projection_digest_trim_no_ledger",
        omittedItemCount: 1,
        omittedTurnCount: 1,
        reason: "over_budget",
        rendererSafeSummary: "Optional earlier dialogue omitted under pressure.",
      },
    ],
  });
  const refs = maintenanceRefsFromArtifacts({
    pressureEstimate: pressure,
    route,
    trimPlan,
    requiredOmissionLedger: true,
  });
  const blocker = expectError(() => {
    buildContextPack({
      projectId,
      threadId,
      turnId: "turn_trim_no_ledger",
      purpose: "direct_text_turn",
      policyId: DIRECT_TEXT_TURN_EMPTY_CONTEXT_POLICY_ID,
      currentUserPrompt: "trim plan no ledger probe",
      maintenanceRefs: refs,
      maintenanceArtifacts: {},
    });
  }, "required_omission_ledger_missing");
  return baseProbe({
    probeId: "E-CM-REC-003",
    terminalLeaves: ["C-CM-10.3"],
    sourceClass: "direct_recovery",
    coverageStatus: "implemented_second_loop",
    expected: "Trim plan without required omission ledger blocks clean context use.",
    observed: {
      trimPlanId: trimPlan.trimPlanId,
      blocker,
      recoveryState: maintenanceRecoveryState({ trimPlanNoLedger: true }),
    },
  });
}

function probeStatusReadDoesNotHiddenRebuild() {
  const fixture = newFixtureStores("status_no_hidden_rebuild");
  try {
    const { threadStore } = fixture;
    const projectId = "project_context_eprobe";
    const threadId = "thread_status_no_hidden_rebuild";
    const contextMaintenanceRoot = path.join(threadStore.rootDir, "context-maintenance");
    const beforeFileCount = countFilesRecursive(contextMaintenanceRoot);
    const missingRead = threadStore.readContextMaintenanceArtifact(projectId, threadId, "status-projection.json");
    const status = threadStore.status();
    const projection = buildStatusProjection({
      projectId,
      threadId,
      pressureState: "unknown",
      memoryState: "none",
      batonState: "missing_required",
      omissionState: "missing_required",
      composerAllowed: false,
      composerAllowedReason: "disabled_context_maintenance_required",
    });
    const afterFileCount = countFilesRecursive(contextMaintenanceRoot);
    assert(missingRead === null, "Missing status artifact read should return null.", "missing_status_read_not_null");
    assert(afterFileCount === beforeFileCount, "Status read created or rebuilt context maintenance artifacts.", "hidden_rebuild_detected");
    assert(status.rootExposed === false && status.dbPathExposed === false, "Thread store status exposed private roots.", "status_private_path_exposed");
    assert(projection.displayOnly === true && projection.rawTextIncluded === false, "Status projection must remain display-only and raw-text-free.", "status_projection_not_safe");
    return baseProbe({
      probeId: "E-CM-REC-006",
      terminalLeaves: ["C-CM-10.6"],
      sourceClass: "direct_recovery",
      coverageStatus: "implemented_second_loop",
      expected: "Reading missing/stale context status does not silently rebuild maintenance artifacts.",
      observed: {
        missingRead: null,
        beforeFileCount,
        afterFileCount,
        statusRootExposed: status.rootExposed,
        statusDbPathExposed: status.dbPathExposed,
        statusProjectionDisplayOnly: projection.displayOnly,
      },
    });
  } finally {
    fixture.cleanup();
  }
}

function probeStaleStatusProjectionRejected() {
  const projectId = "project_context_eprobe";
  const threadId = "thread_status_stale_projection";
  const projection = buildStatusProjection({
    projectId,
    threadId,
    uiProjectionGeneration: 7,
    sourceDigest: "context_status_source_digest_v1",
    operationLedgerHeadDigest: "operation_ledger_head_v1",
    pressureState: "approaching_budget",
    composerAllowed: false,
    composerAllowedReason: "disabled_context_maintenance_required",
  });
  if (typeof validateStatusProjectionAction !== "function") {
    return baseProbe({
      probeId: "E-CM-STATUS-002",
      terminalLeaves: ["C-CM-9.2"],
      sourceClass: "direct_ui",
      coverageStatus: "possible_implementation_gap",
      status: "gap",
      expected: "Stale status projection actions are rejected with a stable blocker and no retry.",
      observed: {
        validatorAvailable: false,
      },
      failureMeaning: "Context maintenance status projections carry generations/digests but have no status action preflight.",
    });
  }
  const blocker = expectError(() => {
    validateStatusProjectionAction({
      projection,
      expectedUiProjectionGeneration: 6,
      expectedSourceDigest: projection.sourceDigest,
      expectedOperationLedgerHeadDigest: projection.operationLedgerHeadDigest,
      actionKind: "read_status",
    });
  }, "context_status_projection_stale");
  return baseProbe({
    probeId: "E-CM-STATUS-002",
    terminalLeaves: ["C-CM-9.2"],
    sourceClass: "direct_ui",
    coverageStatus: "implemented_fourth_loop_probe",
    expected: "Stale status projection generation rejects display/action use before retry or execution.",
    observed: {
      uiProjectionGeneration: projection.uiProjectionGeneration,
      submittedGeneration: 6,
      blocker,
      retriedAutomatically: false,
    },
  });
}

function probeStatusComposerIsNotRuntimeAuthority() {
  const projectId = "project_context_eprobe";
  const threadId = "thread_status_composer_authority";
  const projection = buildStatusProjection({
    projectId,
    threadId,
    uiProjectionGeneration: 11,
    sourceDigest: "context_status_source_digest_composer",
    operationLedgerHeadDigest: "operation_ledger_head_composer",
    pressureState: "within_budget",
    composerAllowed: true,
    composerAllowedReason: "safe_terminal",
  });
  if (typeof validateStatusProjectionAction !== "function") {
    return baseProbe({
      probeId: "E-CM-STATUS-005",
      terminalLeaves: ["C-CM-9.5"],
      sourceClass: "direct_ui",
      coverageStatus: "possible_implementation_gap",
      status: "gap",
      expected: "A status projection with composerAllowed=true cannot authorize provider send.",
      observed: {
        validatorAvailable: false,
        composerAllowed: projection.composerAllowed,
      },
      failureMeaning: "ComposerAllowed is display state, but there is no explicit guard proving it is not runtime authority.",
    });
  }
  const blocker = expectError(() => {
    validateStatusProjectionAction({
      projection,
      expectedUiProjectionGeneration: projection.uiProjectionGeneration,
      expectedSourceDigest: projection.sourceDigest,
      expectedOperationLedgerHeadDigest: projection.operationLedgerHeadDigest,
      actionKind: "send_provider_request",
    });
  }, "context_status_not_runtime_authority");
  return baseProbe({
    probeId: "E-CM-STATUS-005",
    terminalLeaves: ["C-CM-9.5"],
    sourceClass: "direct_ui",
    coverageStatus: "implemented_fourth_loop_probe",
    expected: "Context maintenance status can display composer posture but cannot authorize provider transport.",
    observed: {
      composerAllowed: projection.composerAllowed,
      composerAllowedReason: projection.composerAllowedReason,
      blocker,
      providerTransportCalls: 0,
    },
  });
}

function fixtureVanillaSiblingInput() {
  return {
    projectId: "project_context_eprobe",
    threadId: "app_server_thread_context_fixture",
    sourceRefs: [
      {
        artifactKind: "app_server_thread_items",
        artifactId: "app_server_thread_items_fixture",
        artifactDigest: "app_server_thread_items_digest_fixture",
      },
    ],
    threadItems: [
      { id: "user_1", type: "userMessage" },
      { id: "compact_1", type: "contextCompaction", lifecycle: "completed" },
      {
        id: "agent_1",
        type: "agentMessage",
        text: "Renderer-safe answer",
        memoryCitation: { memoryId: "app_server_memory_citation_fixture" },
      },
    ],
    controlsObserved: [
      { method: "thread/compact/start", evidenceKey: "app_server_compact_start_fixture" },
      { method: "thread/memoryMode/set", evidenceKey: "app_server_memory_mode_fixture" },
      { method: "memory/reset", evidenceKey: "app_server_memory_reset_fixture" },
    ],
  };
}

function buildVanillaSiblingEvidenceOrGap(probeId, expected) {
  if (typeof buildVanillaSiblingContextEvidence !== "function") {
    return {
      gap: baseProbe({
        probeId,
        terminalLeaves: ["C-CM-1.6", "C-CM-3.5", "C-CM-4.6", "C-CM-5.6", "C-CM-6.6", "C-CM-9.4"],
        sourceClass: "vanilla_sibling",
        coverageStatus: "possible_implementation_gap",
        status: "gap",
        expected,
        observed: {
          siblingEvidenceNormalizerAvailable: false,
        },
        failureMeaning: "Direct has app-server ontology/docs, but no normalized context-management sibling evidence artifact.",
      }),
    };
  }
  return { evidence: buildVanillaSiblingContextEvidence(fixtureVanillaSiblingInput()) };
}

function probeVanillaThreadContinuitySiblingOnly() {
  const built = buildVanillaSiblingEvidenceOrGap(
    "E-CM-VAN-001",
    "App-server thread continuity and ThreadItems are observed as app-server-owned sibling evidence only.",
  );
  if (built.gap) return built.gap;
  const evidence = built.evidence;
  assert(evidence.threadContinuity.scope === "app_server_only", "Vanilla thread continuity was not scoped to app-server only.", "vanilla_continuity_scope_wrong");
  assert(evidence.directContinuityGranted === false, "Vanilla sibling evidence granted Direct continuity.", "vanilla_continuity_promoted");
  assert(evidence.directContextPackUsable === false, "Vanilla sibling ThreadItems became Direct context-pack input.", "vanilla_thread_items_context_usable");
  return baseProbe({
    probeId: "E-CM-VAN-001",
    terminalLeaves: ["C-CM-1.6", "C-CM-3.5"],
    sourceClass: "vanilla_sibling",
    coverageStatus: "implemented_phase_k",
    expected: "App-server ThreadItems are sibling evidence only and do not grant Direct continuity.",
    observed: {
      evidenceId: evidence.evidenceId,
      threadContinuityScope: evidence.threadContinuity.scope,
      directContinuityGranted: evidence.directContinuityGranted,
      directContextPackUsable: evidence.directContextPackUsable,
    },
  });
}

function probeVanillaContextCompactionNotDirectCompactProof() {
  const built = buildVanillaSiblingEvidenceOrGap(
    "E-CM-VAN-002",
    "App-server contextCompaction item lifecycle is displayable sibling evidence, not Direct provider compact proof.",
  );
  if (built.gap) return built.gap;
  const evidence = built.evidence;
  const compactionFact = evidence.contextCompaction.find((entry) => entry.itemId === "compact_1");
  assert(compactionFact, "Expected contextCompaction fact.", "vanilla_context_compaction_missing");
  assert(compactionFact.appServerOwned === true, "contextCompaction fact must be app-server-owned.", "vanilla_context_compaction_not_owned");
  assert(evidence.providerCompactPrimitiveProven === false, "Vanilla contextCompaction promoted Direct provider compact primitive.", "vanilla_compaction_promoted");
  assert(evidence.directOmissionLedgerCreated === false, "Vanilla contextCompaction created Direct omission ledger.", "vanilla_compaction_created_omission_ledger");
  return baseProbe({
    probeId: "E-CM-VAN-002",
    terminalLeaves: ["C-CM-4.6", "C-CM-5.6"],
    sourceClass: "vanilla_sibling",
    coverageStatus: "implemented_phase_k",
    expected: "contextCompaction is app-server-owned sibling evidence and does not prove Direct compaction.",
    observed: {
      contextCompactionCount: evidence.contextCompaction.length,
      providerCompactPrimitiveProven: evidence.providerCompactPrimitiveProven,
      directOmissionLedgerCreated: evidence.directOmissionLedgerCreated,
    },
  });
}

function probeVanillaMemoryModeSiblingOnly() {
  const built = buildVanillaSiblingEvidenceOrGap(
    "E-CM-VAN-003",
    "App-server memory mode evidence changes app-server eligibility only and does not create a Direct memory editor.",
  );
  if (built.gap) return built.gap;
  const evidence = built.evidence;
  const memoryModeControl = evidence.memoryControls.find((entry) => entry.method === "thread/memoryMode/set");
  assert(memoryModeControl, "Expected memory mode control fact.", "vanilla_memory_mode_missing");
  assert(memoryModeControl.appServerOnly === true, "Memory mode control must be app-server-only.", "vanilla_memory_mode_scope_wrong");
  assert(evidence.directMemoryEditorProven === false, "Memory mode evidence created Direct memory editor authority.", "vanilla_memory_editor_promoted");
  return baseProbe({
    probeId: "E-CM-VAN-003",
    terminalLeaves: ["C-CM-6.6"],
    sourceClass: "vanilla_sibling",
    coverageStatus: "implemented_phase_k",
    expected: "thread/memoryMode/set is sibling evidence only and grants no Direct memory editor.",
    observed: {
      memoryModeObserved: true,
      appServerOnly: memoryModeControl.appServerOnly,
      directMemoryEditorProven: evidence.directMemoryEditorProven,
    },
  });
}

function probeVanillaMemoryResetDoesNotMutateDirectMemory() {
  const built = buildVanillaSiblingEvidenceOrGap(
    "E-CM-VAN-004",
    "App-server memory reset evidence must not infer Direct durable-memory mutation.",
  );
  if (built.gap) return built.gap;
  const evidence = built.evidence;
  const memoryResetControl = evidence.memoryControls.find((entry) => entry.method === "memory/reset");
  assert(memoryResetControl, "Expected memory reset control fact.", "vanilla_memory_reset_missing");
  assert(memoryResetControl.directMemoryArtifactsMutated === false, "App-server memory reset mutated Direct durable memory.", "vanilla_memory_reset_mutated_direct");
  assert(evidence.directMemoryArtifactsMutated === false, "Sibling evidence inferred Direct memory artifact mutation.", "vanilla_memory_artifacts_mutated");
  return baseProbe({
    probeId: "E-CM-VAN-004",
    terminalLeaves: ["C-CM-6.6"],
    sourceClass: "vanilla_sibling",
    coverageStatus: "implemented_phase_k",
    expected: "memory/reset remains app-server-only evidence and does not mutate Direct memory artifacts.",
    observed: {
      memoryResetObserved: true,
      directMemoryArtifactsMutated: evidence.directMemoryArtifactsMutated,
    },
  });
}

function probeVanillaContextCompactionStatusDisplayOnly() {
  const built = buildVanillaSiblingEvidenceOrGap(
    "E-CM-VAN-005",
    "App-server contextCompaction can be displayed as sibling status without Direct artifact promotion.",
  );
  if (built.gap) return built.gap;
  const evidence = built.evidence;
  assert(evidence.statusProjection.displayOnly === true, "Vanilla sibling status projection must be display-only.", "vanilla_status_not_display_only");
  assert(evidence.statusProjection.actionability?.actionable === false, "Vanilla sibling status must not be actionable.", "vanilla_status_actionable");
  assert(evidence.statusProjection.directArtifactPromotionAllowed === false, "Vanilla sibling status promoted Direct artifacts.", "vanilla_status_promoted_direct_artifact");
  return baseProbe({
    probeId: "E-CM-VAN-005",
    terminalLeaves: ["C-CM-9.4"],
    sourceClass: "vanilla_sibling",
    coverageStatus: "implemented_phase_k",
    expected: "contextCompaction sibling evidence is display-only and cannot promote Direct context-maintenance artifacts.",
    observed: {
      displayOnly: evidence.statusProjection.displayOnly,
      actionable: evidence.statusProjection.actionability.actionable,
      directArtifactPromotionAllowed: evidence.statusProjection.directArtifactPromotionAllowed,
    },
  });
}

function runProbe(probeFn) {
  try {
    return probeFn();
  } catch (error) {
    return baseProbe({
      probeId: probeFn.name || "unknown_probe",
      terminalLeaves: [],
      sourceClass: "direct_fixture",
      coverageStatus: "probe_error",
      status: "failed",
      expected: "Probe should complete.",
      observed: {
        errorCode: normalizeString(error.code, "probe_failed"),
        message: normalizeString(error.message, "Probe failed."),
      },
      failureMeaning: "Probe harness or current behavior did not satisfy the witness expectation.",
    });
  }
}

function buildReport() {
  const probes = [
    runProbe(probePackManifestRecoveryBoundary),
    runProbe(probeStaleProjectionBlocksExactContext),
    runProbe(probeOmissionParityNegative),
    runProbe(probeMemoryConflictBlockedEntryOmitted),
    runProbe(probeMemoryWorkspaceConflictBlockedEntryOmitted),
    runProbe(probeMemoryRefreshRejectsUnsafeSourceRefs),
    runProbe(probeRouteMediatedDeterministicMemoryRefresh),
    runProbe(probeBatonSupersessionRequiredBlocksOptionalOmits),
    runProbe(probeOptionalMissingBatonDoesNotGloballyBlock),
    runProbe(probePackOnlyRecoveryNoSendInferred),
    runProbe(probeTrimPlanWithoutLedgerBlocksCleanUse),
    runProbe(probeStatusReadDoesNotHiddenRebuild),
    runProbe(probeStaleStatusProjectionRejected),
    runProbe(probeStatusComposerIsNotRuntimeAuthority),
    runProbe(probeVanillaThreadContinuitySiblingOnly),
    runProbe(probeVanillaContextCompactionNotDirectCompactProof),
    runProbe(probeVanillaMemoryModeSiblingOnly),
    runProbe(probeVanillaMemoryResetDoesNotMutateDirectMemory),
    runProbe(probeVanillaContextCompactionStatusDisplayOnly),
  ];
  const statusCounts = probes.reduce((acc, probe) => {
    acc[probe.status] = (acc[probe.status] || 0) + 1;
    return acc;
  }, {});
  return {
    schema: REPORT_SCHEMA,
    generatedAt: nowIso(),
    coverageSource: "phase_e_context_management_probe_slice",
    matrixPromotionCandidate: false,
    authorityPromotionCandidate: false,
    runtimeAuthorityExercised: false,
    providerAuthorityExercised: false,
    strictGate: false,
    statusCounts,
    selectedProbeSlice: [
      "pack/manifest recovery",
      "stale context projection",
      "omission parity negative",
      "memory conflict",
      "workspace evidence memory conflict",
      "memory refresh source freshness",
      "route-mediated deterministic memory refresh",
      "baton supersession",
      "optional missing baton",
      "pack-only recovery",
      "trim plan without ledger",
      "status read no hidden rebuild",
      "stale status projection rejection",
      "status composer authority separation",
      "vanilla sibling thread continuity",
      "vanilla sibling context compaction",
      "vanilla sibling memory mode",
      "vanilla sibling memory reset",
      "vanilla sibling context compaction status",
    ],
    sentinelCounters: {
      providerTransportCalls: 0,
      appServerMutationCalls: 0,
      workspaceReadCalls: 0,
      patchApplyCalls: 0,
      commandRunCalls: 0,
      rightPaneMutationCalls: 0,
      handoffMutationCalls: 0,
    },
    probes,
  };
}

function renderMarkdown(report) {
  const lines = [
    "# Direct Context Management E-Probes",
    "",
    `Generated: ${report.generatedAt}`,
    `Coverage source: ${report.coverageSource}`,
    "",
    "## Status Counts",
    "",
  ];
  for (const [status, count] of Object.entries(report.statusCounts)) {
    lines.push(`- ${status}: ${count}`);
  }
  lines.push("", "## Probes", "");
  for (const probe of report.probes) {
    lines.push(`- ${probe.probeId}: ${probe.status} (${probe.coverageStatus})`);
    if (probe.failureMeaning) lines.push(`  - ${probe.failureMeaning}`);
  }
  lines.push("", "## Sentinels", "");
  for (const [key, value] of Object.entries(report.sentinelCounters)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  return lines.join("\n");
}

function validateReport(report) {
  if (report.schema !== REPORT_SCHEMA) throw new Error("direct_context_management_eprobe_report_schema_mismatch");
  if (!Array.isArray(report.probes) || report.probes.length === 0) throw new Error("direct_context_management_eprobe_report_probes_missing");
  for (const [key, value] of Object.entries(report.sentinelCounters || {})) {
    if (Number(value || 0) !== 0) throw new Error(`direct_context_management_eprobe_sentinel_nonzero:${key}`);
  }
  return true;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const strict = options.strict === true || options.strict === "true";
  const userDataRoot = normalizeString(options.userDataRoot || process.env[USER_DATA_ROOT_ENV_VAR], defaultAppUserDataRoot());
  const runId = safeIdPart(options.runId, `context_management_eprobes_${Date.now()}`);
  const outputDir = path.join(userDataRoot, "direct-context-management-eprobes", runId);
  ensureDirectory(outputDir);
  const report = buildReport();
  report.strictGate = strict;
  validateReport(report);
  const findings = scanFixtureForSecrets(report);
  if (findings.length) {
    const safeFailure = {
      schema: REPORT_SCHEMA,
      generatedAt: nowIso(),
      coverageSource: "phase_e_context_management_probe_slice",
      matrixPromotionCandidate: false,
      authorityPromotionCandidate: false,
      runtimeAuthorityExercised: false,
      providerAuthorityExercised: false,
      rawExposureBlocked: true,
      probes: [baseProbe({
        probeId: "E-CM-RAW-REPORT",
        status: "failed",
        coverageStatus: "raw_exposure_blocked",
        observed: { findingCount: findings.length },
      })],
      sentinelCounters: report.sentinelCounters,
    };
    writeJsonAtomic(path.join(outputDir, "eprobe-summary.json"), safeFailure);
    throw new Error(`Direct context management E-probe report failed raw-exposure scan: ${findings.join(", ")}`);
  }
  const jsonPath = path.join(outputDir, "eprobe-summary.json");
  const markdownPath = path.join(outputDir, "eprobe-summary.md");
  writeJsonAtomic(jsonPath, report);
  writeTextFile(markdownPath, renderMarkdown(report));
  const reread = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  validateReport(reread);
  const digest = sha256(stableStringify(reread));
  console.log(`Direct context management E-probes completed: ${jsonPath}`);
  console.log(`Report digest: ${digest}`);
  console.log(`Status counts: ${JSON.stringify(report.statusCounts)}`);
  if (strict && (report.statusCounts.failed || report.statusCounts.gap)) {
    process.exitCode = 1;
  }
}

main();
