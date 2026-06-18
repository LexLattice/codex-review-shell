#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  RESIDENT_EPISTEMIC_CONTEXT_ITEM_SCHEMA,
  RESIDENT_EPISTEMIC_ROW_SCHEMA,
  RESIDENT_EPISTEMIC_SNAPSHOT_SCHEMA,
  buildResidentEpistemicContextItem,
  buildResidentEpistemicRow,
  buildResidentEpistemicSnapshot,
  buildUnknownOmittedClassRow,
  digestFor,
  validateResidentEpistemicSnapshot,
} = require("../src/main/direct/bridge/resident-epistemic-snapshot");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectThrows(fn, expectedMessage) {
  try {
    fn();
  } catch (error) {
    if (expectedMessage && !String(error?.message || "").includes(expectedMessage)) {
      throw new Error(`expected ${expectedMessage}, got ${error?.message || error}`);
    }
    return;
  }
  throw new Error(`expected throw: ${expectedMessage}`);
}

function withFreshSnapshotDigest(snapshot) {
  return {
    ...snapshot,
    snapshotDigest: digestFor("resident-epistemic-snapshot", snapshot),
  };
}

function withFreshCompactAndSnapshotDigest(snapshot) {
  const compactTextDigest = digestFor("resident-epistemic-compact-text", snapshot.compactResidentText);
  const withCompact = { ...snapshot, compactTextDigest };
  return {
    ...withCompact,
    snapshotDigest: digestFor("resident-epistemic-snapshot", withCompact),
  };
}

function main() {
  const callableRead = buildResidentEpistemicRow({
    subjectKind: "tool",
    subjectId: "direct.read_file",
    displayLabel: "read_file",
    family: "read",
    status: "callable_now",
    knowledgeClass: "exact_runtime",
    residentVisible: true,
    callableInCurrentRequest: true,
    declaredAsProviderTool: true,
    controlState: "callable_now",
    perCallAuthorityRequired: true,
    channels: {
      epistemic: { visibleToResident: true, visibility: "full_status" },
      control: {
        controlAvailable: true,
        availableActions: ["call"],
        blockedActions: [],
        authorityRequired: true,
      },
      transcript: { transcriptVisible: "not_applicable", transcriptSourceRefs: [] },
    },
    epistemicUse: "self_status",
    authorityUse: "may_prepare_call",
    priority: "critical",
    freshness: "fresh",
    evidenceRefs: [{ refId: "activation:read_file", source: "activation_registry", digest: "sha256:read" }],
    compactText: "callable now; path containment, size caps, and redaction policy apply.",
  });
  assert(callableRead.schema === RESIDENT_EPISTEMIC_ROW_SCHEMA, "row schema mismatch");
  assert(callableRead.residentVisible === true, "residentVisible should be explicit");
  assert(callableRead.callableInCurrentRequest === true, "callable flag should be explicit");
  assert(callableRead.declaredAsProviderTool === true, "provider declaration flag should be explicit");
  assert(callableRead.channels.transcript.transcriptVisible === "not_applicable", "tool transcript channel should be not applicable");

  const partialChannelFallback = buildResidentEpistemicRow({
    subjectKind: "tool",
    subjectId: "direct.partial_channel",
    displayLabel: "partial channel fallback",
    status: "known_available",
    availableActions: ["top_level_action"],
    blockedActions: ["top_level_blocked"],
    transcriptSourceRefs: [{ refId: "transcript-ref", source: "audit_row", digest: "sha256:transcript" }],
    channels: {
      epistemic: { visibleToResident: true, visibility: "summary_only" },
    },
    compactText: "partial nested channel object should preserve top-level channel defaults.",
  });
  assert(partialChannelFallback.channels.control.availableActions.includes("top_level_action"), "partial channel should fallback to top-level availableActions");
  assert(partialChannelFallback.channels.control.blockedActions.includes("top_level_blocked"), "partial channel should fallback to top-level blockedActions");
  assert(partialChannelFallback.channels.transcript.transcriptSourceRefs[0]?.refId === "transcript-ref", "partial channel should fallback to top-level transcript refs");

  const staleCallable = buildResidentEpistemicRow({
    subjectKind: "tool",
    subjectId: "direct.apply_patch",
    displayLabel: "apply_patch",
    family: "write",
    status: "callable_now",
    callableInCurrentRequest: true,
    declaredAsProviderTool: true,
    controlState: "callable_now",
    freshness: "stale",
    compactText: "stale activation evidence should not remain callable.",
  });
  assert(staleCallable.status === "stale", "stale callable row should degrade to stale");
  assert(staleCallable.callableInCurrentRequest === false, "stale callable row should not remain callable");
  assert(staleCallable.blockerCodes.includes("stale_epistemic_row"), "stale callable row should cite blocker");

  const conflictedTool = buildResidentEpistemicRow({
    subjectKind: "tool",
    subjectId: "direct.spawn_agent",
    displayLabel: "spawn_agent",
    family: "sub_agent",
    status: "known_available",
    controlState: "known_available",
    conflictState: "policy_overrides_activation",
    conflictResolution: "strictest_blocker_wins",
    compactText: "activation exists but WorkThread policy blocks spawning.",
  });
  assert(conflictedTool.status === "blocked_by_policy", "strictest blocker should downgrade conflicted authority");
  assert(conflictedTool.blockerCodes.includes("policy_overrides_activation"), "conflict blocker should be visible");

  const subAgent = buildResidentEpistemicRow({
    subjectKind: "sub_agent",
    subjectId: "agent_carver",
    displayLabel: "Carver",
    family: "worker",
    status: "known_available",
    knowledgeClass: "harness_observed",
    channels: {
      epistemic: { visibleToResident: true, visibility: "full_status" },
      control: {
        controlAvailable: false,
        availableActions: ["wait"],
        blockedActions: ["sendInput", "interrupt", "close", "resume", "modifyContext", "overrideInstructions"],
        authorityRequired: true,
      },
      transcript: {
        transcriptVisible: "metadata_only",
        transcriptSourceRefs: [{ refId: "agent-transcript-digest:carver", source: "sub_agent_e_channel", digest: "sha256:carver" }],
      },
    },
    epistemicUse: "planning_context",
    authorityUse: "may_not_act",
    priority: "high",
    freshness: "fresh",
    blockerCodes: ["no_interference_policy"],
    compactText: "running observe-only; status/artifact refs visible; interference actions blocked.",
    extensions: {
      lifecycle: "running",
      currentActivity: "writing_artifact",
      transcriptWitness: {
        visibility: "blocked",
        transcriptDigest: "sha256:hidden-transcript",
        hiddenTurnCount: 3,
      },
    },
  });
  assert(subAgent.channels.control.controlAvailable === false, "observe-only should not expose control");
  assert(subAgent.channels.control.blockedActions.includes("interrupt"), "interfering action should be blocked");
  assert(subAgent.channels.transcript.transcriptVisible === "metadata_only", "hidden transcript should remain metadata-only");

  const accountMutation = buildResidentEpistemicRow({
    subjectKind: "account_action",
    subjectId: "rate_limit_reset_credit.consume",
    displayLabel: "rate-limit reset credit",
    family: "account",
    status: "known_disabled",
    residentVisible: false,
    channels: {
      epistemic: { visibleToResident: false, visibility: "blocked" },
      control: {
        controlAvailable: false,
        availableActions: [],
        blockedActions: ["operator_confirmation_required"],
        authorityRequired: true,
      },
      transcript: { transcriptVisible: "not_applicable", transcriptSourceRefs: [] },
    },
    epistemicUse: "operator_explanation",
    authorityUse: "may_not_act",
    priority: "diagnostic",
    enablementPath: [{
      kind: "operator_enablement",
      label: "Open settings or quota pressure action and confirm reset-credit use.",
      authorityRequired: true,
      enablementPathUse: "operator_explanation_only",
    }],
    compactText: "account mutation excluded from normal resident context by default.",
  });
  assert(accountMutation.residentVisible === false, "account mutation row should not be normal resident context by default");
  assert(accountMutation.enablementPath[0].enablementPathUse === "operator_explanation_only", "sensitive enablement should be explanatory");

  const omittedExternal = buildUnknownOmittedClassRow({
    subjectKind: "tool",
    family: "external_resource",
    omittedCount: 4,
    reason: "external resource tools are budgeted out of this snapshot",
  });
  assert(omittedExternal.status === "unknown", "omitted class row should be unknown");
  assert(omittedExternal.blockerCodes.includes("omitted_class"), "omitted class row should cite omission");

  const snapshot = buildResidentEpistemicSnapshot({
    workThreadId: "work_thread_epistemic_fixture",
    codexThreadId: "direct_session_epistemic_fixture",
    runtimeFamily: "direct",
    nowMs: 0,
    projectionBudget: { maxRows: 4, maxChars: 1200, truncationPolicy: "priority_then_summary" },
    declarationDigest: "sha256:declaration",
    sourceDigests: ["sha256:activation", "sha256:worker-graph"],
    rows: [callableRead, staleCallable, conflictedTool, subAgent, accountMutation, omittedExternal],
  });
  assert(snapshot.schema === RESIDENT_EPISTEMIC_SNAPSHOT_SCHEMA, "snapshot schema mismatch");
  assert(snapshot.generatedAt === "1970-01-01T00:00:00.000Z", "timestamp should preserve epoch zero");
  assert(snapshot.snapshotCompleteness === "budgeted_with_omissions", "snapshot should disclose omissions");
  assert(snapshot.omittedClassCounts.tool >= 1, "omitted class counts should preserve unknown tool class");
  assert(Boolean(snapshot.snapshotDigest), "snapshot digest should exist");
  assert(Boolean(snapshot.compactTextDigest), "compact text digest should exist");
  assert(snapshot.compactTextRendererVersion === "resident_epistemic_compact_renderer@1", "compact renderer version mismatch");
  assert(snapshot.compactTextSourceRowIds.includes(callableRead.rowId), "compact text should cite callable read row");
  assert(!snapshot.compactResidentText.includes("sk-"), "compact text should not expose secrets");
  assert(snapshot.compactResidentText.includes("Harness epistemic witness:"), "compact text should be typed witness text");
  validateResidentEpistemicSnapshot(snapshot);

  const largeVisibleRow = buildResidentEpistemicRow({
    subjectKind: "tool",
    subjectId: "direct.large_visible",
    displayLabel: "large visible row",
    status: "known_disabled",
    residentVisible: true,
    priority: "low",
    omitWhenBudgeted: true,
    compactText: "this visible row is expected to be omitted by a tiny row budget.",
  });
  const nonOmittableUnknown = buildUnknownOmittedClassRow({
    subjectKind: "tool",
    family: "must_show_unknown",
    omittedCount: 2,
  });
  const budgetedSnapshot = buildResidentEpistemicSnapshot({
    workThreadId: "work_thread_budget_fixture",
    projectionBudget: { maxRows: 2, maxChars: 380, truncationPolicy: "priority_then_summary" },
    rows: [callableRead, subAgent, largeVisibleRow, nonOmittableUnknown],
  });
  validateResidentEpistemicSnapshot(budgetedSnapshot);
  assert(budgetedSnapshot.compactTextSourceRowIds.includes(nonOmittableUnknown.rowId), "non-omittable unknown row should be preserved in compact text");
  assert(budgetedSnapshot.omittedClassCounts.tool >= 1, "all visible rows omitted by budget should be counted");
  assert(budgetedSnapshot.compactResidentText.length <= 380, "compact text should respect maxChars after stale/conflict labels");

  const contextItem = buildResidentEpistemicContextItem(snapshot);
  assert(contextItem.schema === RESIDENT_EPISTEMIC_CONTEXT_ITEM_SCHEMA, "context item schema mismatch");
  assert(contextItem.authority === "harness_epistemic_witness", "context item authority should be witness");
  assert(contextItem.grantsAuthority === false, "context item must not grant authority");
  assert(contextItem.snapshotDigest === snapshot.snapshotDigest, "context item should cite snapshot digest");
  assert(contextItem.compactTextDigest === snapshot.compactTextDigest, "context item should cite compact text digest");

  expectThrows(() => validateResidentEpistemicSnapshot(withFreshSnapshotDigest({
    ...snapshot,
    rows: [{ ...callableRead, rawPayloadExposed: true }],
  })), "resident_epistemic_raw_payload_exposed");

  expectThrows(() => validateResidentEpistemicSnapshot(withFreshSnapshotDigest({
    ...snapshot,
    compactTextSourceRowIds: ["missing-row"],
  })), "resident_epistemic_compact_source_row_missing");

  expectThrows(() => validateResidentEpistemicSnapshot(withFreshCompactAndSnapshotDigest({
    ...snapshot,
    compactResidentText: "Bearer abcdefghijklmnopqrstuvwxyz0123456789",
  })), "sensitive material");

  expectThrows(() => validateResidentEpistemicSnapshot({
    ...snapshot,
    compactResidentText: `${snapshot.compactResidentText}\nmutated without digest update`,
  }), "resident_epistemic_compact_text_digest_mismatch");

  expectThrows(() => validateResidentEpistemicSnapshot({
    ...snapshot,
    rows: snapshot.rows.map((row) => row.rowId === callableRead.rowId ? { ...row, compactText: "mutated row without digest update" } : row),
  }), "resident_epistemic_snapshot_digest_mismatch");

  console.log("direct resident epistemic snapshot regression passed");
}

main();
