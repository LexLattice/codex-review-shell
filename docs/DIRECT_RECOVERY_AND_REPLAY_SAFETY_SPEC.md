# Direct Recovery And Replay Safety Spec

Status: draft for PR 2 from [CODEX_DIRECT_HARNESS_PR_AFFINITY_BUNDLES_v0.md](CODEX_DIRECT_HARNESS_PR_AFFINITY_BUNDLES_v0.md).

Matrix rows: `A11`, `C1-C3`, `C11-C12`, `E15`, `I9`.

Related existing specs:

- [DIRECT_IMPLEMENTATION_LANE_REAL_PROVIDER_PROOF_SPEC.md](DIRECT_IMPLEMENTATION_LANE_REAL_PROVIDER_PROOF_SPEC.md)
- [DIRECT_IMPLEMENTATION_LANE_READONLY_TOOL_UI_SPEC.md](DIRECT_IMPLEMENTATION_LANE_READONLY_TOOL_UI_SPEC.md)
- [DIRECT_IMPLEMENTATION_LANE_MULTI_STEP_READONLY_TOOL_LOOP_SPEC.md](DIRECT_IMPLEMENTATION_LANE_MULTI_STEP_READONLY_TOOL_LOOP_SPEC.md)
- [DIRECT_IMPLEMENTATION_LANE_PATCH_APPLY_SPEC.md](DIRECT_IMPLEMENTATION_LANE_PATCH_APPLY_SPEC.md)
- [DIRECT_IMPLEMENTATION_LANE_COMMAND_EXECUTION_SPEC.md](DIRECT_IMPLEMENTATION_LANE_COMMAND_EXECUTION_SPEC.md)

## 1. Purpose

This bundle makes direct implementation-lane state restart-safe after the first real read/patch/command proof.

It does not add new model authority. It adds durable recovery classification, idempotency checks, ledger/journal validation, and replay prevention for turns that may be interrupted between:

```text
provider tool call observed
human approval
local read/patch/command side effect
context/manifest build
provider continuation handoff
provider terminal response
```

Passing this bundle should mean:

```text
Every direct read/patch/command turn state has a deterministic restart
classification, and no ambiguous state automatically repeats a local side
effect or provider continuation.
```

It should not mean:

```text
automatic repair exists
iterative repair loops are enabled
patch revert exists
commands are retried
provider streams are resumed
new tools are enabled
right-pane ChatGPT is controlled
app-server can be removed
```

## 2. Core Invariants

```text
recovery classification != permission to replay
approval record != permission to rerun after ambiguity
tool result record != provider saw the result
patch applied locally != assistant finalized
command ran locally != workspace is unchanged
handoff unknown != retryable
corrupt ledger/artifact != recoverable state
```

Additional rules:

- Startup recovery must be read-only with respect to provider transport and workspace mutation.
- No recovery path may call app-server.
- No recovery path may select, navigate, mutate, submit to, or dismiss the right ChatGPT pane or handoff queue.
- No recovery path may re-read, re-apply a patch, rerun a command, or resend a provider continuation automatically.
- A user-visible or report-visible state may recommend a future manual action, but PR 2 does not implement automatic resume.
- Direct text-only behavior remains unchanged.

## 3. Scope

### In Scope

- Recovery scanner for direct-native sessions, turns, obligations, patch journals, command results, context packs, request manifests, and normalized event logs.
- Operation-ledger event model for direct implementation-lane authority phases.
- Deterministic recovery classifications for read-only, multi-step read, patch, and command turns.
- Idempotency rules for decisions, local results, patch apply journals, command execution records, and continuation requests.
- Handoff-unknown and stream-interrupted distinctions.
- Corrupt, partial, terminal, and waiting-for-user classifications.
- Headless recovery regression runner with fault injection over fixture-backed read/patch/command states.
- Renderer-safe recovery summary fields for later UI.
- No-app-server, no-right-pane, no-handoff, no-auto-retry sentinels.
- Raw-exposure scans for recovery reports and summaries.

### Out Of Scope

- New provider tool classes.
- Iterative repair sequencing beyond existing bounded proof scenarios.
- User-facing revert.
- Patch delete support.
- Automatic command retry.
- Provider stream resume.
- App UI polish beyond renderer-safe recovery status.
- Durable memory, context maintenance, governance, semantic broker, or sub-agent observability.

## 4. Recovery Model

### 4.1 Recovery Objects

Add a renderer-safe recovery classification object:

```ts
type DirectRecoveryClassification = {
  schema: "direct_recovery_classification@1";
  scope: "session" | "turn" | "obligation";
  projectId: string;
  sessionId: string;
  turnId?: string;
  obligationId?: string;
  authorityKind:
    | "text"
    | "read_file"
    | "read_file_loop"
    | "apply_patch"
    | "run_command"
    | "unknown";
  recoveryState: DirectRecoveryState;
  sideEffectState: DirectRecoverySideEffectState;
  providerHandoffState: DirectProviderHandoffRecoveryState;
  providerContinuationSeenByModel: DirectProviderContinuationSeenByModel;
  providerTerminalKind: DirectProviderTerminalKind;
  responseChainState: DirectProviderResponseChainRecoveryState;
  artifactDurabilityState: DirectArtifactDurabilityState;
  recoveryConfidence: DirectRecoveryConfidence;
  autoRetryAllowed: false;
  autoReexecuteAllowed: false;
  composerAllowed: boolean;
  composerAllowedReason: DirectComposerAllowedReason;
  manualActionKind:
    | "none"
    | "await_user_decision"
    | "inspect_only"
    | "start_new_turn"
    | "manual_recovery_required";
  actionAvailability: DirectRecoveryActionAvailability;
  stepRef?: DirectRecoveryStepRef;
  patchJournalState?: DirectPatchJournalRecoveryState;
  commandWorkspaceEffectState?: DirectCommandWorkspaceEffectRecoveryState;
  blockerCode?: string;
  rendererSafeMessage: string;
  sourceRefs: DirectRecoverySourceRefs;
  integrity: DirectRecoveryIntegritySummary;
};
```

```ts
type DirectRecoveryState =
  | "healthy"
  | "terminal"
  | "waiting_for_user"
  | "collecting_tool_call"
  | "tool_requested_no_decision"
  | "decision_committed_no_result"
  | "result_recorded_no_context"
  | "context_built_no_manifest"
  | "request_built_not_sent"
  | "sent_no_bytes"
  | "stream_interrupted"
  | "transport_handoff_unknown"
  | "side_effect_applied_no_continuation"
  | "side_effect_command_ran_no_continuation"
  | "continuation_sent_no_bytes"
  | "continuation_stream_interrupted"
  | "partial_unknown"
  | "corrupt";
```

```ts
type DirectRecoverySideEffectState =
  | "none"
  | "read_evidence_recorded"
  | "read_maybe_executed_no_result"
  | "patch_planned_only"
  | "workspace_patch_applied"
  | "workspace_patch_partial_unknown"
  | "command_ran"
  | "command_may_have_run"
  | "unknown";
```

```ts
type DirectProviderHandoffRecoveryState =
  | "not_started"
  | "context_built"
  | "request_built"
  | "sent_no_bytes"
  | "bytes_observed"
  | "stream_interrupted"
  | "completed"
  | "failed"
  | "unknown";
```

```ts
type DirectProviderContinuationSeenByModel =
  | "no"
  | "maybe_handoff_unknown"
  | "bytes_observed"
  | "terminal_completed"
  | "terminal_failed";
```

`tool_continuation_sent` with no bytes must not imply the model saw the tool result. `bytes_observed` means the provider responded after handoff, not that the model semantically used the result.

```ts
type DirectProviderTerminalKind =
  | "not_terminal"
  | "completed_with_assistant_text"
  | "completed_empty"
  | "failed"
  | "incomplete"
  | "tool_call_blocked"
  | "unknown_event_blocked";
```

```ts
type DirectArtifactDurabilityState =
  | "all_required_present"
  | "optional_missing"
  | "required_missing"
  | "digest_mismatch"
  | "ledger_gap"
  | "journal_gap"
  | "schema_mismatch"
  | "unreadable"
  | "unknown";
```

```ts
type DirectRecoveryConfidence =
  | "exact"
  | "conservative_from_partial"
  | "corrupt_untrusted"
  | "fixture_only";
```

```ts
type DirectComposerAllowedReason =
  | "safe_terminal"
  | "waiting_for_user_decision"
  | "text_only_unaffected"
  | "disabled_corrupt"
  | "disabled_partial_unknown"
  | "disabled_side_effect_incomplete"
  | "disabled_provider_handoff_unknown"
  | "disabled_manual_recovery_required";
```

```ts
type DirectRecoveryActionAvailability = {
  suggested:
    | "none"
    | "await_user_decision"
    | "inspect_only"
    | "start_new_turn"
    | "manual_recovery_required";
  enabledInThisPR: boolean;
  requiresFutureSpec?: "manual_resume" | "revert" | "repair" | "new_turn_after_side_effect";
};
```

Manual action recommendations are not authority. For example, `start_new_turn` after a patch applied but continuation failed may be unsafe until a future runtime-status bundle explicitly allows it.

```ts
type DirectRecoveryStepRef = {
  loopId?: string;
  stepId?: string;
  stepOrdinal?: number;
  parentResponseIdEvidenceKey?: string;
  previousStepId?: string;
  nextStepExpected?: boolean;
};
```

```ts
type DirectProviderResponseChainRecoveryState =
  | "not_required"
  | "valid"
  | "missing_parent_response"
  | "parent_response_digest_mismatch"
  | "continuation_response_missing"
  | "chain_broken"
  | "unknown";
```

```ts
type DirectCommandWorkspaceEffectRecoveryState =
  | "not_applicable"
  | "scan_passed"
  | "scan_missing"
  | "scan_failed"
  | "changes_detected"
  | "unknown";
```

```ts
type DirectPatchJournalRecoveryState =
  | "not_applicable"
  | "planned_only"
  | "applying"
  | "applied_verified"
  | "apply_failed_verified"
  | "partial_unknown"
  | "journal_corrupt";
```

### 4.2 Source References

Recovery reports must cite ids and evidence keys, not raw payloads:

```ts
type DirectRecoverySourceRefs = {
  sessionId: string;
  turnId?: string;
  obligationId?: string;
  resultId?: string;
  patchPlanId?: string;
  patchJournalId?: string;
  commandPlanId?: string;
  commandResultId?: string;
  contextBuildId?: string;
  requestManifestId?: string;
  continuationId?: string;
  operationEventIds: string[];
  artifactEvidenceKeys: string[];
};
```

### 4.3 Integrity Summary

```ts
type DirectRecoveryIntegritySummary = {
  checked: boolean;
  status:
    | "passed"
    | "missing_artifact"
    | "digest_mismatch"
    | "ledger_gap"
    | "journal_gap"
    | "schema_mismatch"
    | "corrupt";
  checkedAt: string;
  ledgerHeadDigest?: string;
  expectedLedgerHeadDigest?: string;
  mismatchCount: number;
};
```

If integrity status is not `passed`, recovery state must be `corrupt` unless a more specific safe state exists with no side effect and no provider handoff.

### 4.4 Classification Precedence

When ledger, journal, artifact, and stream evidence conflict, recovery must apply this precedence:

```text
1. Raw-exposure failure blocks normal report/status projection.
2. Ledger gap, digest mismatch, or schema mismatch wins over artifact-local state.
3. Patch journal partial_unknown wins over continuation state.
4. Command started without terminal wins over missing continuation state.
5. Provider bytes observed wins over sent_no_bytes.
6. Verified terminal event wins over interrupted stream marker.
7. Renderer transcript/projection rows never win over authority artifacts.
```

Renderer transcript/projection rows may be used only for display hydration after classification, never as source of recovery truth.

### 4.5 Request-Control Verification

For every continuation request manifest, recovery must validate:

```text
store=false
parallel_tool_calls=false
no undeclared tools
exactly one accepted tool-output item when applicable
native previous_response_id source proof present when applicable
harness/tool-continuation policy digests present
```

Missing or corrupt request-control flags classify as `corrupt` or `manual_recovery_required`; they are never assumed safe.

## 5. Operation Ledger

### 5.1 Ledger Shape

Add or formalize a direct operation ledger sidecar for implementation-lane authority events:

```ts
type DirectOperationLedgerEvent = {
  schema: "direct_operation_ledger_event@1";
  eventVersion: 1;
  ledgerSeq: number;
  eventId: string;
  eventFamily:
    | "initial_request"
    | "tool_obligation"
    | "read_file"
    | "apply_patch"
    | "run_command"
    | "continuation"
    | "recovery";
  eventType: DirectOperationLedgerEventType;
  projectId: string;
  sessionId: string;
  turnId: string;
  obligationId?: string;
  createdAt: string;
  sourceArtifactIds: string[];
  sourceArtifactDigests: Record<string, string>;
  previousLedgerDigest: string;
  eventDigest: string;
  rawPayloadStored: false;
};
```

```ts
type DirectOperationLedgerEventType =
  | "initial_request_built"
  | "initial_transport_handoff_started"
  | "initial_stream_started"
  | "initial_stream_terminal"
  | "tool_obligation_recorded"
  | "tool_decision_committed"
  | "read_result_recorded"
  | "patch_plan_built"
  | "patch_dry_run_passed"
  | "patch_decision_committed"
  | "patch_apply_planned"
  | "patch_apply_started"
  | "patch_apply_committed"
  | "patch_apply_failed"
  | "patch_apply_partial_unknown"
  | "patch_result_recorded"
  | "command_plan_built"
  | "command_decision_committed"
  | "command_started"
  | "command_completed"
  | "command_timed_out"
  | "command_handoff_unknown"
  | "command_result_recorded"
  | "tool_continuation_context_built"
  | "tool_continuation_request_built"
  | "tool_continuation_sent"
  | "tool_continuation_stream_started"
  | "tool_continuation_terminal";
```

### 5.2 Ledger Law

- Ledger events are append-only.
- Every event cites artifact ids and digests, never raw request bodies, raw file contents, raw stdout/stderr, raw patches, raw auth, or absolute paths.
- Every event digest includes the previous ledger digest.
- Every event has a monotonic `ledgerSeq`; duplicate, missing, or out-of-order sequence numbers classify as `ledger_gap`.
- Recovery recomputes the ledger chain before classifying active or partial turns.
- Ledger gaps are not silently repaired.
- Failed event writes block the next side-effecting action.
- Current runtime status must be derived from durable artifacts plus ledger, not from renderer rows.
- Startup recovery scans must not append operation-ledger events. Recovery scan audit belongs in a separate `direct_recovery_report@1` artifact.

## 6. Per-Authority Recovery Law

### 6.1 Read File

States:

```text
tool requested, no decision
decision committed, no read result
read result recorded, no context
context built, no manifest
manifest built, no send
continuation sent, no bytes
continuation streaming interrupted
terminal
```

Rules:

- If no decision exists, approval card can be rebuilt as `waiting_for_user`.
- If approval exists but no result exists, recovery must not auto-read. Classification is `decision_committed_no_result`.
- If result exists, recovery must reuse the recorded result. It must not re-read the file automatically.
- If continuation was sent or bytes were observed, recovery must not resend.
- Multi-step read loops use the same law per step. The active step ordinal, `DirectRecoveryStepRef`, and response-chain proof must be validated before showing any next-step status.
- If future code records `read_started` without a result, classify as `read_maybe_executed_no_result` and do not reread automatically.

### 6.2 Apply Patch

States:

```text
patch obligation recorded
patch plan built
dry-run passed
decision committed
apply planned
apply started
apply committed
apply failed
partial unknown
patch result recorded
continuation context/request built
continuation sent/streaming/terminal
```

Rules:

- Patch planning and dry-run are read-only and may be classified as `waiting_for_user` if approval has not happened.
- Approval after restart must validate the patch plan integrity digest. If it differs, block with `patch_plan_integrity_mismatch`.
- `patch_apply_started` without `patch_apply_committed` or `patch_apply_failed` is `partial_unknown`.
- `partial_unknown` disables composer and further patch/command authority for that thread.
- `patch_apply_committed` means workspace changed. Recovery must never re-apply the patch.
- Patch recovery must expose `DirectPatchJournalRecoveryState`.
- If patch applied but provider continuation did not complete, show:

```text
Patch was applied locally. Assistant continuation did not complete.
Do not assume the model saw the patch result.
```

- PR 2 does not implement revert. Journal evidence is for inspection and future recovery work only.

### 6.3 Run Command

States:

```text
command obligation recorded
command plan built
decision committed
command started
command completed/timed out/spawn failed
command handoff unknown
command result recorded
continuation context/request built
continuation sent/streaming/terminal
```

Rules:

- Command approval after restart must validate command plan integrity and executable resolution evidence.
- `command_started` without a terminal command event is `command_may_have_run`.
- `command_may_have_run` must not rerun the command.
- If command result exists, recovery must reuse the recorded result and workspace-effect summary.
- Command recovery must expose `DirectCommandWorkspaceEffectRecoveryState`.
- If command ran but provider continuation did not complete, show:

```text
Command was executed locally. Assistant continuation did not complete.
Workspace may have changed; inspect command result and workspace effect summary.
```

- If workspace-effect scan failed or is missing for a command result, classify as `side_effect_command_ran_no_continuation` or `partial_unknown` depending on whether command completion is known.

## 7. Idempotency And Replay Prevention

### 7.1 Decision Idempotency

Rules:

```text
same clientToolDecisionId + same obligation + same action:
  return existing decision/result/recovery snapshot

same clientToolDecisionId + different obligation:
  reject client_decision_id_conflict

same clientToolDecisionId + same obligation + different action:
  reject client_decision_id_conflict

different decision after terminal decision/result:
  reject terminal_decision_exists
```

### 7.2 Local Action Idempotency

Read:

```text
recorded read result exists:
  do not reread automatically
  reuse recorded result for classification
```

Patch:

```text
patch journal status=applied:
  do not reapply
  return applied snapshot

patch journal status=applying:
  classify partial_unknown

patch journal status=partial_unknown:
  block all further apply/continuation
```

Command:

```text
command result exists:
  do not rerun
  reuse recorded result

command started without result:
  classify command_may_have_run
  do not rerun
```

### 7.3 Provider Continuation Idempotency

Rules:

```text
continuation request built, no sent marker:
  classify request_built_not_sent
  no auto-send in PR 2

continuation sent, no bytes:
  classify continuation_sent_no_bytes
  no auto-retry

continuation bytes observed, no terminal:
  classify continuation_stream_interrupted
  no auto-retry

continuation terminal:
  classify terminal
```

If a future bundle adds manual resend, it must define a new user-confirmed continuation id and prove the previous request was never handed off. PR 2 does not add that.

## 8. Recovery Scanner

### 8.1 Entry Points

Add a headless recovery command:

```text
npm run direct:recovery-regression
```

or extend the implementation proof runner with a clearly separated recovery mode:

```text
npm run direct:implementation-proof -- --mode=recovery-fixture
```

The command must not call live provider transport by default.

### 8.2 Scanner Inputs

The scanner reads:

- direct session and turn artifacts;
- normalized event logs;
- unresolved obligation records;
- operation ledger events;
- read result records;
- patch plans and journals;
- command plans and results;
- context packs;
- request manifests;
- provider-input projection metadata;
- renderer/thread projection pointers.

The scanner does not:

- call provider transport;
- run workspace commands;
- apply patches;
- read files for model evidence;
- spawn app-server;
- mutate right-pane ChatGPT or handoff queue state.

### 8.3 Scanner Output

```ts
type DirectRecoveryReport = {
  schema: "direct_recovery_report@1";
  recoveryScannerVersion: string;
  compatibleRuntimeSchemaVersions: string[];
  runId: string;
  createdAt: string;
  mode: "fixture" | "inspect-existing";
  liveProviderCallOptIn: false;
  coverageSource: "fixture_recovery" | "existing_artifact_inspection";
  matrixPromotionCandidate: false;
  classifications: DirectRecoveryClassification[];
  summary: {
    healthyCount: number;
    waitingForUserCount: number;
    terminalCount: number;
    sideEffectIncompleteCount: number;
    handoffUnknownCount: number;
    corruptCount: number;
    autoRetryAttemptCount: 0;
    autoReexecuteAttemptCount: 0;
  };
  rawExposureScan: {
    scanned: boolean;
    status: "passed" | "failed";
    findingCount: number;
  };
};
```

If a session artifact is from a newer unsupported schema, classify as `schema_mismatch` with `manual_recovery_required` or `corrupt` depending on whether any side effect might have occurred.

### 8.4 Read-Only Scanner Writes

Startup recovery classification is read-only. Allowed writes:

```text
recovery report artifact under app-private diagnostics/reports
```

Forbidden writes:

```text
operation ledger events
session/turn artifacts
patch journals
command result artifacts
workspace files
context packs
request manifests
provider continuation artifacts
```

If later work needs a ledger event that recovery was acknowledged, that must be a separate user action after scanner completion.

## 9. Fault Injection Regression

### 9.1 Fixture Strategy

PR 2 should use fixture-backed direct implementation-lane states, not live-provider nondeterminism.

The fault injector creates deterministic session/turn/obligation artifacts equivalent to real read/patch/command turns, then stops after selected durable boundaries.

Required injection points:

```text
after_tool_obligation_recorded
after_tool_decision_committed
after_read_result_recorded
after_patch_plan_built
after_patch_apply_started
after_patch_apply_committed
after_patch_result_recorded
after_command_started
after_command_completed
after_command_result_recorded
after_continuation_context_built
after_continuation_request_built
after_continuation_sent_no_bytes
after_continuation_stream_started
after_terminal
corrupt_missing_manifest
corrupt_digest_mismatch
```

Minimum case matrix:

```text
read:
  no decision
  decision no result
  result no context
  context no manifest
  manifest not sent
  sent no bytes
  stream interrupted
  terminal

multi-step read:
  step 1 terminal, step 2 requested no decision
  step 2 result no continuation
  broken response chain

patch:
  plan built no decision
  decision no apply
  apply started no terminal
  apply committed no result
  result no continuation
  continuation sent no bytes
  stream interrupted
  journal corrupt

command:
  plan built no decision
  decision no start
  command started no terminal
  command completed no result
  result no continuation
  effect scan missing
  sent no bytes
  stream interrupted

text-only:
  completed turn
  sent no bytes
  stream interrupted
```

Each fixture then runs recovery in a new process and asserts:

- the expected recovery state;
- no provider request was started;
- no app-server process was spawned;
- no right-pane/handoff mutation was attempted;
- no local read/patch/command side effect was repeated;
- raw-exposure scan passed.

### 9.2 Side-Effect Counters

The disposable workspace backend and sentinels must record side-effect counters:

```ts
type DirectRecoverySentinelCounters = {
  providerTransportCalls: number;
  appServerSpawnCalls: number;
  rightPaneMutationCalls: number;
  handoffMutationCalls: number;
  fileReadCalls: number;
  patchApplyCalls: number;
  commandRunCalls: number;
  continuationSendCalls: number;
};
```

Recovery assertions:

```text
classification pass:
  counters do not increase

patch_apply_committed fixture:
  patchApplyCalls remains 0 during recovery

command_completed fixture:
  commandRunCalls remains 0 during recovery

continuation_sent_no_bytes fixture:
  continuationSendCalls remains 0 during recovery
```

Every startup recovery case must assert all sentinel counters are zero. Fixture setup may create prior side-effect artifacts, but the scanner itself must not increment any counter.

## 10. Renderer-Safe Status

Expose enough status for later UI work:

```ts
type DirectRendererRecoveryStatus = {
  directRecoveryState: DirectRecoveryState;
  authorityKind: DirectRecoveryClassification["authorityKind"];
  sideEffectState: DirectRecoverySideEffectState;
  providerHandoffState: DirectProviderHandoffRecoveryState;
  providerContinuationSeenByModel: DirectProviderContinuationSeenByModel;
  recoveryConfidence: DirectRecoveryConfidence;
  artifactDurabilityState: DirectArtifactDurabilityState;
  composerState:
    | "enabled"
    | "disabled_waiting_for_recovery"
    | "disabled_side_effect_incomplete"
    | "disabled_corrupt";
  composerAllowedReason: DirectComposerAllowedReason;
  rendererSafeMessage: string;
  actionAvailability: DirectRecoveryActionAvailability;
};
```

UI copy must be truthful:

```text
Patch applied locally; assistant continuation did not complete.
Command ran locally; assistant continuation did not complete.
Transport handoff unknown; automatic retry is disabled.
Recovery detected corrupt direct artifacts; this thread is inspect-only.
Manual resume is not implemented in PR 2. Inspect and start a new turn only if safe.
```

## 11. Raw Exposure Rules

Recovery reports and renderer status must not contain:

- raw auth tokens;
- raw request bodies;
- raw provider frames;
- raw file contents;
- raw patch bodies;
- raw stdout/stderr;
- absolute workspace, WSL, or Windows paths;
- raw ChatGPT URLs;
- raw SQLite/internal exception text;
- raw hashes if they are not local evidence keys.

Allowed:

- artifact ids;
- local evidence keys;
- bounded relative display paths;
- state names;
- blocker codes;
- counts.

If scan fails, write only a minimal safe failure report:

```ts
{
  schema: "direct_recovery_report@1",
  runId,
  status: "failed",
  failureCode: "raw_exposure_blocked",
  rawExposureBlocked: true
}
```

## 12. Implementation Order

### Phase -1 - State And Ledger Law

- Define `DirectRecoveryState`.
- Define classification precedence.
- Define `providerContinuationSeenByModel`.
- Define `recoveryConfidence`.
- Define artifact durability state.
- Define response-chain validation states.
- Define command workspace-effect and patch-journal recovery states.
- Define ledger event types and digest chain.
- Add ledger event family, event version, and monotonic sequence.
- Define idempotency/replay rules per authority kind.
- Define fixture-only no-promotion report tags.
- Define renderer-safe blocker codes.

### Phase 0 - Recovery Scanner

- Read session/turn/obligation artifacts.
- Read ledger/journal/context/manifest artifacts.
- Validate digests and source refs.
- Validate response-chain proof.
- Validate continuation request-control flags.
- Classify active, terminal, partial, and corrupt states.
- Emit `direct_recovery_report@1`.

### Phase 1 - Fault Injection Harness

- Create fixture sessions for read/patch/command.
- Include direct text-only recovery cases.
- Stop at each durable boundary.
- Run recovery in a fresh process.
- Assert expected classification and zero sentinel counters.

### Phase 2 - Authority Idempotency Hardening

- Ensure duplicate decisions return safe snapshots or conflict.
- Ensure patch journals block duplicate apply.
- Ensure command result records block duplicate run.
- Ensure continuation sent/bytes states block duplicate provider send.

### Phase 3 - Renderer-Safe Status

- Add recovery status fields to direct runtime/thread status.
- Disable composer for corrupt, partial unknown, and incomplete side-effect states.
- Preserve text-only behavior.

### Phase 4 - Regression Integration

- Add npm script.
- Include report schema validation before and after raw-exposure scan.
- Add no-app-server/no-right-pane/no-handoff sentinels.
- Add fixture summaries to direct harness reports without promoting real-provider proof rows.

## 13. Acceptance Criteria

- Every read/patch/command active state has a deterministic `DirectRecoveryClassification`.
- Recovery classification includes `providerContinuationSeenByModel`.
- Recovery classification includes `recoveryConfidence` and artifact durability state.
- Precedence rules define what wins when ledger, journal, artifact, stream, and raw-exposure states conflict.
- Renderer transcript/projection rows are never recovery authority.
- Multi-step read recovery includes loop id, step id, step ordinal, and response-chain proof.
- Response-chain validation reports missing or mismatched parent/continuation response ids.
- Continuation request manifests are checked for `store=false`, `parallel_tool_calls=false`, declared-tool policy, one tool-output item, and native `previous_response_id` proof where applicable.
- Operation ledger events include event family, event version, and monotonic sequence.
- Startup recovery scan does not append operation-ledger events; it writes only a separate recovery report artifact.
- Command recovery includes workspace-effect scan state.
- Patch recovery includes patch-journal recovery state.
- Provider handoff recovery state includes `stream_interrupted`.
- Terminal classification distinguishes completed-with-text, completed-empty, failed, incomplete, tool-blocked, and unknown-event-blocked states.
- Startup recovery never calls provider transport.
- Startup recovery never spawns app-server.
- Startup recovery never mutates right-pane ChatGPT or handoff queue state.
- Recovery never automatically rereads a file after `read_result_recorded`.
- Recovery never automatically reapplies a patch after `patch_apply_committed`.
- Recovery never automatically reruns a command after `command_started` or `command_completed`.
- Recovery never automatically resends a continuation after `tool_continuation_sent` or after bytes were observed.
- `patch_apply_started` without committed/failed evidence becomes `partial_unknown`.
- `command_started` without completion evidence becomes `command_may_have_run`.
- Patch applied but continuation incomplete is visible and not collapsed into patch failure.
- Command ran but continuation incomplete is visible and not collapsed into command failure.
- Ledger digest gaps or artifact digest mismatches classify as `corrupt`.
- Corrupt classifications expose stable blocker codes, not raw exceptions.
- Continuation request built but not sent is distinct from continuation sent with no bytes.
- Continuation sent with no bytes is distinct from continuation stream interrupted.
- The recovery regression creates fixture states for every required fault injection point.
- The recovery regression includes explicit read, multi-step read, patch, command, and text-only cases.
- Sentinel counters prove recovery classification does not repeat read/patch/command/provider actions or mutate app-server/right-pane/handoff state.
- Recovery reports are tagged `coverageSource="fixture_recovery"` and `matrixPromotionCandidate=false` for fixture runs.
- Recovery scanner schema/version compatibility is checked.
- Allowed writes during startup recovery are limited to recovery report artifacts; no session, journal, workspace, context, manifest, provider, or ledger mutation occurs.
- Report/UI copy says manual resume is not implemented in PR 2.
- Recovery reports contain artifact ids/evidence keys only.
- Recovery report schema validates before write, after raw-exposure scan, and after re-read.
- Raw-exposure failure writes a minimal safe report.
- Direct text-only remains unchanged.

## 14. Non-Goals

Do not implement these in PR 2:

```text
automatic resume
automatic retry
user-facing revert
patch delete
new tools
parallel tool calls
iterative repair loops
provider stream resume
sub-agent wait/inspect tools
context memory/baton/governance
production direct mode
```
