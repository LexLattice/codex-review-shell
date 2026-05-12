# Direct Iterative Implementation Repair Loop Spec

Status: draft for PR 3 from [CODEX_DIRECT_HARNESS_PR_AFFINITY_BUNDLES_v0.md](CODEX_DIRECT_HARNESS_PR_AFFINITY_BUNDLES_v0.md).

Matrix rows: `E4`, `E14-E15`, `B7`, `B12`, `F4`, `D18`.

Related existing specs:

- [DIRECT_IMPLEMENTATION_LANE_REAL_PROVIDER_PROOF_SPEC.md](DIRECT_IMPLEMENTATION_LANE_REAL_PROVIDER_PROOF_SPEC.md)
- [DIRECT_RECOVERY_AND_REPLAY_SAFETY_SPEC.md](DIRECT_RECOVERY_AND_REPLAY_SAFETY_SPEC.md)
- [DIRECT_IMPLEMENTATION_LANE_MULTI_STEP_READONLY_TOOL_LOOP_SPEC.md](DIRECT_IMPLEMENTATION_LANE_MULTI_STEP_READONLY_TOOL_LOOP_SPEC.md)
- [DIRECT_IMPLEMENTATION_LANE_PATCH_APPLY_SPEC.md](DIRECT_IMPLEMENTATION_LANE_PATCH_APPLY_SPEC.md)
- [DIRECT_IMPLEMENTATION_LANE_COMMAND_EXECUTION_SPEC.md](DIRECT_IMPLEMENTATION_LANE_COMMAND_EXECUTION_SPEC.md)
- [CODEX_DIRECT_HARNESS_ODEU_MATRIX_v0_2.md](CODEX_DIRECT_HARNESS_ODEU_MATRIX_v0_2.md)

## 1. Purpose

This bundle turns the Direct implementation lane from isolated proof loops into a bounded repair sequence:

```text
read_file
  -> continuation
  -> apply_patch
  -> continuation
  -> run_command
  -> continuation
  -> read_file / apply_patch / run_command
  -> ...
  -> assistant final answer or bounded local stop
```

It does not add new authority. It composes the already implemented read, patch, command, continuation, and recovery machinery under one explicit transition graph.

Passing this bundle should mean:

```text
The Direct implementation lane can complete one bounded, sequential,
human-approved repair turn with multiple read/patch/command steps, where every
local side effect has its own approval, result artifact, request manifest,
provider continuation, recovery classification, and no automatic replay.
```

It should not mean:

```text
direct is production
general shell runtime exists
parallel tool calls are supported
auto-approval exists
new tools are enabled
patch delete or revert exists
failed/interrupted turns auto-resume
right-pane ChatGPT is controlled
app-server can be removed
```

## 2. Core Invariants

```text
loop sequencing != broader authority
previous approval != next approval
provider next tool call != local permission
tool result evidence != instruction authority
patch applied locally != future command approval
command exit zero != workspace clean
recovery classification != resume authority
multi-step turn != provider-side session import
```

Additional rules:

- Direct text-only continues to terminally block provider tool calls.
- Implementation-lane selection remains separate from text-only readiness.
- Every read, patch, and command step requires its own completed provider tool call, local validation, and fresh user approval.
- Exactly one obligation may be active at a time.
- The loop is sequential only. Parallel tool calls fail closed.
- The loop uses native direct `previous_response_id` only from the immediately preceding direct response that emitted the current tool call.
- Each continuation re-sends the current harness policy, role mapping, and tool-continuation policy.
- No app-server fallback is allowed inside a direct implementation turn.
- No right-pane ChatGPT or handoff queue mutation is allowed.
- No retry after provider bytes, local reads, patch apply, or command execution unless a later manual-resume spec owns that authority.

## 3. Scope

### In Scope

- A direct implementation repair loop model spanning read, patch, and command steps.
- A transition legality graph for allowed step-to-step transitions.
- Mixed-tool response chain proof across read, patch, and command continuations.
- Per-step locks, action tokens, idempotency keys, and operation-ledger events.
- Per-loop caps for total steps, read steps, patch steps, command steps, repeated path reads, cumulative provider output, command runtime, and workspace mutations.
- Provider continuation outcomes that can either finalize the turn or create the next supported obligation.
- Terminal handling for incomplete, empty output, content filter, max output, unsupported tool, multiple tool calls, and cap exceeded.
- Recovery integration using `direct_recovery_report@1` classifications.
- Headless fixture and real-provider repair-loop proof scenarios in disposable workspaces.
- Raw-exposure scanning and no-app-server/no-right-pane/no-handoff sentinels.

### Out Of Scope

- New provider tools beyond `read_file`, `apply_patch`, and `run_command`.
- Parallel tool calls.
- Auto-approval.
- Patch delete support.
- Revert UI or journal-backed revert execution.
- General shell, network, browser, MCP, or custom tool runtime.
- Provider stream resume.
- Automatic restart repair after side effects.
- Durable memory, compaction, governance packet enforcement, semantic broker routing, or sub-agent observability.

## 4. Preconditions

PR 3 is contingent on the earlier stages staying green. Live mixed-loop cases may run only when:

- PR 1 real-provider read, patch, command, and workspace-effect proof cases are green for the same model, account, endpoint, and request-shape scope.
- PR 2 recovery/replay classification is green for every read, patch, command, continuation, and handoff boundary state used by the loop.
- Direct text-only tool-call regression remains green.
- Direct text-only first-turn and recent-dialogue regressions remain green.
- Fixture transition matrix, recovery fault injection, and raw-exposure scanner pass before any live mixed-loop run.

If these preconditions fail:

```text
live mixed-loop transport is blocked
fixture/preflight reports may still run
matrixPromotionCandidate = false
```

This prevents PR 3 from hiding basic authority or recovery failures inside a more complex loop.

## 5. Loop Model

### 5.1 Repair Loop Object

Add a durable loop object or turn-embedded loop section:

```ts
type DirectImplementationRepairLoop = {
  schema: "direct_implementation_repair_loop@1";
  loopId: string;
  projectId: string;
  sessionId: string;
  turnId: string;
  tier: "implementation-lane";
  status:
    | "created"
    | "waiting_for_provider"
    | "waiting_for_user"
    | "local_action_running"
    | "continuation_ready"
    | "continuation_sent"
    | "streaming_continuation"
    | "completed_final_assistant"
    | "terminal_blocked"
    | "failed"
    | "recovery_required";
  localWorkflowState:
    | "created"
    | "waiting_for_provider_tool"
    | "collecting_provider_arguments"
    | "waiting_for_user_approval"
    | "local_action_running"
    | "result_recorded"
    | "context_built"
    | "request_built"
    | "terminal";
  providerHandoffState:
    | "not_started"
    | "initial_streaming"
    | "continuation_not_sent"
    | "continuation_sent_no_bytes"
    | "continuation_streaming"
    | "completed"
    | "failed"
    | "stream_interrupted"
    | "transport_handoff_unknown";
  sideEffectState:
    | "none"
    | "read_evidence_only"
    | "workspace_patch_applied"
    | "command_ran_no_workspace_changes_detected"
    | "command_ran_workspace_changes_detected"
    | "workspace_patch_and_command_effects"
    | "partial_unknown"
    | "unknown";
  currentStepId?: string;
  currentStepOrdinal: number;
  stepCount: number;
  terminalKind?: DirectImplementationRepairTerminalKind;
  createdAt: string;
  updatedAt: string;
  caps: DirectImplementationRepairCaps;
  counters: DirectImplementationRepairCounters;
  responseChain: DirectImplementationRepairResponseChain;
  policySnapshot: DirectImplementationRepairPolicySnapshot;
  noAutoRetry: true;
  noAutoApproval: true;
  appServerFallbackUsed: false;
  rightPaneMutationUsed: false;
  handoffMutationUsed: false;
};
```

The loop may be stored in the existing direct turn artifact if that is simpler for PR 3, but the persisted shape must be explicit and schema-versioned.

The loop status is a convenience summary. `localWorkflowState`, `providerHandoffState`, and `sideEffectState` are the authoritative state fields used by recovery, routing, and renderer-safe status.

### 5.2 Policy Snapshot

Every loop persists the policy that made its steps legal:

```ts
type DirectImplementationRepairPolicySnapshot = {
  allowedTools: ["read_file", "apply_patch", "run_command"];
  sensitivePathPolicyDigest: string;
  commandPolicyDigest: string;
  patchPolicyDigest: string;
  capPolicyDigest: string;
  networkRiskPolicyDigest: string;
  transitionGraphDigest: string;
  providerToolSetDigest: string;
  declaredToolSchemasDigest?: string;
};
```

### 5.3 Step Object

Every provider tool call that becomes a local obligation is represented as one step:

```ts
type DirectImplementationRepairStep = {
  schema: "direct_implementation_repair_step@1";
  stepId: string;
  loopId: string;
  sessionId: string;
  turnId: string;
  stepOrdinal: number;
  tool:
    | "read_file"
    | "apply_patch"
    | "run_command";
  providerCall: {
    callId: string;
    itemId?: string;
    providerCallType: "function_call" | "custom_tool_call";
    outputType:
      | "function_call_output"
      | "custom_tool_call_output";
    name: string;
    namespacePolicy: "absent-only";
    argumentsDigest: string;
    argumentsComplete: boolean;
  };
  parentResponse: DirectNativeParentResponseProof;
  approvalTokenId?: string;
  clientToolDecisionId?: string;
  decisionRecordId?: string;
  authorityState:
    | "provider_call_collecting"
    | "provider_call_complete"
    | "waiting_for_approval"
    | "approved"
    | "declined"
    | "canceled"
    | "local_action_running"
    | "result_recorded"
    | "context_built"
    | "request_built"
    | "continuation_sent"
    | "streaming_continuation"
    | "completed"
    | "terminal_blocked"
    | "recovery_required";
  localAction:
    | "none"
    | "read_file"
    | "apply_patch"
    | "run_command";
  resultArtifactId?: string;
  workspaceEffectSummaryId?: string;
  workspaceEffectState?:
    | "not_applicable"
    | "scan_passed_no_changes"
    | "changes_detected"
    | "scan_failed"
    | "scan_unsupported"
    | "unexpected_changes_detected";
  contextBuildId?: string;
  requestManifestId?: string;
  continuationId?: string;
  continuationOutcome?: DirectImplementationContinuationOutcome;
  terminalKind?: DirectImplementationRepairTerminalKind;
  createdAt: string;
  updatedAt: string;
};
```

Patch steps distinguish expected patch changes from unexpected extra changes. Command steps must record whether workspace-effect scanning was supported and whether changes were detected.

### 5.4 Parent Response Proof

Each step must prove that its provider call came from the response id used for the next continuation:

```ts
type DirectNativeParentResponseProof = {
  id: string;
  source:
    | "native_direct_initial_stream"
    | "native_direct_tool_continuation_stream";
  sourceEventDigest: string;
  sourceTurnDigest: string;
  sourceRequestManifestId: string;
  emittedToolCallDigest: string;
  importedContinuityHandleUsed: false;
};
```

For step 1, the parent is the initial direct response. For step N greater than 1, the parent is the `continuationResponseId` emitted by step N-1 continuation.

The loop response chain records this relationship:

```ts
type DirectImplementationRepairResponseChain = Array<{
  stepOrdinal: number;
  tool: "read_file" | "apply_patch" | "run_command";
  emittedToolCallResponseId: string;
  continuationResponseId?: string;
  continuationHandoffState:
    | "not_sent"
    | "sent_no_bytes"
    | "bytes_observed"
    | "terminal_completed"
    | "terminal_failed"
    | "stream_interrupted"
    | "transport_handoff_unknown";
  sourceEventDigest: string;
  requestManifestId: string;
  resultArtifactId?: string;
}>;
```

Before building any continuation request for step N:

```text
step N parentResponse.id must equal:
  initial response id when N=1
responseChain[N-1].continuationResponseId when N>1
```

Step N+1 may not use a continuation response id whose chain entry is `sent_no_bytes`, `stream_interrupted`, `transport_handoff_unknown`, or `terminal_failed`.

If the chain is missing, mismatched, ambiguous, or imported:

```text
terminalKind = response_chain_invalid
continuationSent = false
localActionExecuted = false for the pending step
```

## 6. Transition Graph

### 6.1 Allowed Transitions

Allowed provider outcomes after a continuation:

```text
assistant_final -> loop completed
one supported read_file -> next read step
one supported apply_patch -> next patch step
one supported run_command -> next command step
```

Allowed local step sequence examples:

```text
read_file -> read_file
read_file -> apply_patch
read_file -> run_command
apply_patch -> run_command
apply_patch -> read_file
run_command -> read_file
run_command -> apply_patch
run_command -> run_command
```

The transition graph is permissive across the three supported tools, but every edge is gated by:

- loop caps
- request-shape evidence for the exact continuation class
- one active obligation lock
- parent response proof
- result artifact durability
- raw-exposure scan
- per-tool authority policy
- recovery scanner state

### 6.2 Blocked Transitions

Blocked in PR 3:

```text
tool call while another step is nonterminal
parallel tool calls
multiple tool calls in one provider response
unsupported tool names
non-empty namespace
partial/incomplete tool arguments
apply_patch delete
post-side-effect automatic retry
provider continuation after raw-exposure block
new direct prompt while loop step is nonterminal
rollback to app-server while loop step is nonterminal
right-pane or handoff mutation from loop state
```

### 6.3 Transition Artifact

Add a small transition graph artifact:

```ts
type DirectImplementationTransitionGraph = {
  schema: "direct_implementation_transition_graph@1";
  graphId: "direct_implementation_repair_loop@1";
  allowedTools: ["read_file", "apply_patch", "run_command"];
  providerToolSetDigest: string;
  declaredToolSchemasDigest?: string;
  allowedEdges: Array<{
    from:
      | "initial"
      | "read_file"
      | "apply_patch"
      | "run_command";
    to:
      | "assistant_final"
      | "read_file"
      | "apply_patch"
      | "run_command";
    requiresApproval: boolean;
    requiresContinuation: boolean;
  }>;
  blockedEdges: Array<{
    code: DirectImplementationRepairBlockerCode;
    appliesToTool?: "read_file" | "apply_patch" | "run_command";
    reason: string;
  }>;
  version: string;
  digest: string;
};
```

The digest is recorded in every repair-loop context pack and request manifest.

Patch delete must produce the specific blocked terminal kind `patch_delete_deferred`, not a generic unsupported-tool state.

## 7. Evidence And Gates

### 7.1 Evidence Scope

PR 3 requires exact scoped evidence for:

```text
direct_text_turn_empty_context@1
direct_text_turn_recent_dialogue@1 where follow-up repair starts are supported
direct_readonly_tool_continuation@1
direct_readonly_tool_loop_continuation@1
direct_patch_apply_continuation@1
direct_command_execution_continuation@1
direct_implementation_repair_loop@1
```

Add the mixed-loop evidence scope:

```ts
type DirectImplementationRepairLoopEvidenceScope = {
  requestShapeClass: "direct_implementation_repair_loop@1";
  model: string;
  endpointHash: string;
  accountEvidenceKey: string;
  parentResponseSources: Array<
    | "native_direct_initial_stream"
    | "native_direct_tool_continuation_stream"
  >;
  supportedTools: Array<
    | "read_file"
    | "apply_patch"
    | "run_command"
  >;
  providerCallTypes: Array<"function_call" | "custom_tool_call">;
  providerOutputTypes: Array<
    | "function_call_output"
    | "custom_tool_call_output"
  >;
  toolDeclarationPolicy: {
    declaredToolNames: Array<
      | "read_file"
      | "apply_patch"
      | "run_command"
    >;
    parallelToolCalls: false;
    toolChoiceStrategy: "auto" | "tool_choice_required";
    providerToolDeclarationMode:
      | "codex_native_implicit"
      | "declared_allowed_tool_set";
    providerToolSetDigest: string;
    declaredToolSchemasDigest?: string;
  };
  continuationRequestControls: {
    store: false;
    toolDeclarations: false;
    toolOutputItem: true;
    previousResponseId: true;
    parallelToolCalls: false;
  };
  transitionGraphDigest: string;
  requestBuilderVersion: string;
  normalizerVersion: string;
  redactionVersion: string;
  resultEnvelopeVersions: {
    readFile: string;
    applyPatch: string;
    runCommand: string;
  };
  roleMappingDigest: string;
  harnessPolicyDigest: string;
  contextPolicyDigest: string;
};
```

Evidence for a single-step command or patch continuation does not prove the mixed repair-loop shape unless the mixed-loop evidence explicitly covers the step-to-step parent response source and declared tool set.

### 7.2 Tool Declaration Policy

The implementation must choose and prove one of these modes:

```text
A. codex_native_implicit:
   the direct Codex backend emits Codex-native tool calls without explicit
   client tool declarations on continuations; mixed-loop evidence proves this
   for read_file/apply_patch/run_command under the exact profile.

B. declared_allowed_tool_set:
   every continuation re-declares the allowed tool set with
   parallelToolCalls=false; manifests record providerToolSetDigest and
   declaredToolSchemasDigest.
```

Do not assume tool availability from prior provider context. Public Responses-style request controls expose tool declarations and parallel tool-call behavior, so the direct harness must record which profile behavior it relies on.

### 7.3 Turn Start Gates

Turn start must re-evaluate:

- selected runtime tier is implementation-lane
- project generation and runtime selection digest are current
- auth and live evidence are current for the exact model/request shape
- recovery classifier reports no active corrupt or partial state for the selected session/turn
- no active direct turn conflict exists
- context/request artifact roots are writable
- operation ledger is durable and valid
- transition graph digest matches runtime policy
- PR 1 and PR 2 precondition gates are green for the same scope when running live mixed-loop cases

Selection remains side-effect-free. Turn start remains the authority checkpoint.

### 7.4 Per-Step Gates

Before showing an approval card:

- provider emitted exactly one complete supported tool call
- arguments are complete and parseable
- tool name and namespace are allowed
- transition edge is legal
- caps are not exceeded
- parent response proof is valid
- no other step is nonterminal
- current operation ledger head matches expected action token
- renderer sees only bounded previews

Before local action:

- action token is valid for this step and action
- `clientToolDecisionId` is idempotent and not conflicting
- runtime tier and project generation are rechecked
- recovery classifier does not report partial/corrupt state
- per-tool backend policy passes
- `clientToolDecisionId` conflict rules pass

Before continuation:

- result artifact is durable
- context pack and request manifest are durable
- raw-exposure scan passes
- request controls prove `store=false`, no tool declarations, exactly one tool-output item, native `previous_response_id`, and `parallelToolCalls=false`
- harness policy and role mapping are re-sent
- response chain proof is valid
- loop counters and caps are current
- workspace-effect state is durable for patch/command steps

### 7.5 Decision Conflict Rules

```text
same clientToolDecisionId + same step + same action:
  return existing state

same clientToolDecisionId + different step:
  reject client_decision_id_conflict

same step + different action after terminal decision:
  reject terminal_decision_exists

approve after decline/cancel:
  reject terminal_decision_exists

decline/cancel after local action started:
  reject too_late_for_decision
```

## 8. Caps

Default PR 3 caps:

```ts
type DirectImplementationRepairCaps = {
  maxTotalSteps: 12;
  maxReadFileSteps: 8;
  maxPatchSteps: 3;
  maxCommandSteps: 3;
  maxRepeatedCanonicalReadPathCount: 2;
  maxProviderToolOutputCharsTotal: 384 * 1024;
  maxPatchChangedFilesTotal: 20;
  maxPatchAddedLinesTotal: 1200;
  maxPatchRemovedLinesTotal: 1200;
  maxCommandRuntimeMsTotal: 180_000;
  maxCommandWorkspaceChangedPathsTotal: 50;
};
```

Caps are checked before approval where possible. If a cap is reached only after provider emits the next tool call:

```text
record tool call evidence
do not show approval card
do not execute local action
do not send continuation
terminalKind = repair_loop_cap_exceeded
```

### 7.1 Counters

```ts
type DirectImplementationRepairCounters = {
  totalSteps: number;
  readFileSteps: number;
  patchSteps: number;
  commandSteps: number;
  providerToolOutputCharsTotal: number;
  patchChangedFilesTotal: number;
  patchAddedLinesTotal: number;
  patchRemovedLinesTotal: number;
  commandRuntimeMsTotal: number;
  commandWorkspaceChangedPathsTotal: number;
  repeatedCanonicalReadPathCounts: Record<string, number>;
};
```

Counters use workspace-backend canonical evidence keys, not renderer path strings.

### 8.1 Cap Behavior After Side Effects

Some caps can be exceeded only after a local side effect has already occurred:

```text
command workspace-change cap exceeded after command:
  record command result and workspace-effect evidence
  do not send provider continuation
  terminalKind = command_workspace_change_cap_exceeded
  composer disabled until recovery/status policy says safe

command timeout:
  process cleanup attempted
  workspace-effect scan runs if backend supports it
  result artifact records timeout
  continuation may be sent only if redaction and policy allow timeout envelope
  no automatic retry

provider tool-output cumulative cap exceeded after result recorded:
  count provider-bound tool-output envelopes after redaction/truncation
  separately record raw local bytes/chars in safety report
  do not send continuation
  terminalKind = provider_tool_output_cap_exceeded
```

Nonzero command exit is evidence, not local failure. A later provider patch is allowed only if the command result envelope was recorded, redaction passed, workspace-effect state is known or explicitly degraded, and the command continuation completed.

## 9. Continuation Outcomes

```ts
type DirectImplementationContinuationOutcome =
  | "assistant_final"
  | "next_read_file_step"
  | "next_apply_patch_step"
  | "next_run_command_step"
  | "unsupported_tool_call"
  | "multiple_tool_calls_unsupported"
  | "parallel_tool_call_attempted"
  | "incomplete"
  | "empty_output"
  | "content_filter_terminal"
  | "max_output_terminal"
  | "transport_handoff_unknown"
  | "stream_interrupted"
  | "raw_exposure_blocked";
```

Successful terminal completion requires:

```text
response_completed observed
non-empty assistant text
no pending tool call
no incomplete_details
no unknown event blocker
```

If the provider emits a supported next tool call:

```text
create next step
record provider call evidence
show next approval card only after arguments complete
composer remains disabled
```

If the provider emits no assistant text and no supported tool call:

```text
terminalKind = empty_output
composer disabled for same turn
fresh new turn may be allowed only after recovery/status policy says safe
```

## 10. Terminal Kinds

```ts
type DirectImplementationRepairTerminalKind =
  | "completed_final_assistant"
  | "declined"
  | "canceled"
  | "repair_loop_cap_exceeded"
  | "unsupported_tool_call"
  | "multiple_tool_calls_unsupported"
  | "parallel_tool_call_attempted"
  | "tool_call_during_active_step"
  | "invalid_tool_arguments"
  | "response_chain_invalid"
  | "read_file_blocked"
  | "patch_plan_blocked"
  | "patch_delete_deferred"
  | "patch_apply_failed"
  | "command_class_blocked"
  | "command_timed_out"
  | "command_workspace_change_cap_exceeded"
  | "command_redaction_blocked"
  | "provider_tool_output_cap_exceeded"
  | "workspace_effect_scan_missing"
  | "raw_exposure_blocked"
  | "context_build_failed"
  | "request_manifest_failed"
  | "transport_handoff_unknown"
  | "stream_interrupted"
  | "response_incomplete"
  | "empty_output"
  | "unknown_event_blocked"
  | "recovery_required"
  | "corrupt_artifacts";
```

Terminal kind, step terminal kind, and loop terminal kind are distinct. A command nonzero exit is not itself a terminal failure if redaction passes and continuation is lawful; it is evidence for the provider.

## 11. Locks And Idempotency

### 11.1 Locks

```text
one active direct implementation turn per project/session
one repair-loop lock per direct turn
one active-step lock per loop
one decision lock per step
one local-action lock per step
one continuation lock per step
```

Conflicts:

```text
second provider tool call while step nonterminal -> tool_call_during_active_step
approve after decline/cancel -> terminal_decision_exists
different action under same clientToolDecisionId -> client_decision_id_conflict
duplicate local action after result exists -> return recorded result snapshot
duplicate continuation after sent/bytes -> return recorded handoff state, never resend
```

### 11.2 Action Tokens

Every approval/decline/cancel card uses a per-step token:

```ts
type DirectImplementationRepairActionToken = {
  tokenId: string;
  projectId: string;
  sessionId: string;
  turnId: string;
  loopId: string;
  stepId: string;
  stepOrdinal: number;
  tool: "read_file" | "apply_patch" | "run_command";
  action: "approve" | "decline" | "cancel";
  obligationDigest: string;
  transitionGraphDigest: string;
  parentResponseDigest: string;
  operationLedgerHeadDigest: string;
  recoveryClassificationDigest: string;
  expiresAt: string;
};
```

Renderer buttons never authorize actions directly. They submit token id plus client decision id; main revalidates all state.

## 12. Context And Manifest

Each continuation builds:

```text
tool result artifact
  -> repair_step_context@1
  -> direct_context_pack@1
  -> provider_input_projection
  -> direct_request_manifest@1
  -> provider continuation
```

The context pack includes:

- current harness policy
- current role mapping
- transition graph digest
- provider tool set digest and declaration mode
- loop counters and caps
- current step result evidence
- bounded prior step summaries
- workspace-effect summaries for patch/command steps
- omission/truncation ledger

It excludes:

- raw file contents beyond approved tool result envelopes
- raw patch body unless policy explicitly allows bounded preview
- raw stdout/stderr beyond redacted provider output envelope
- raw provider frames
- raw auth, account, path, source hash, or ChatGPT URL data
- renderer transcript rows as authority

Request manifest required fields:

```ts
type DirectImplementationRepairRequestManifest = {
  schema: "direct_request_manifest@1";
  requestShapeClass: "direct_implementation_repair_loop@1";
  loopId: string;
  stepId: string;
  stepOrdinal: number;
  tool: "read_file" | "apply_patch" | "run_command";
  transitionGraphDigest: string;
  providerToolSetDigest: string;
  declaredToolSchemasDigest?: string;
  parentResponse: DirectNativeParentResponseProof;
  lineage: {
    repairLoopId: string;
    stepId: string;
    stepOrdinal: number;
    parentResponseProofDigest: string;
    resultArtifactId: string;
    previousStepIds: string[];
    loopCountersDigest: string;
  };
  requestControls: {
    store: false;
    toolDeclarations: false;
    toolOutputItem: true;
    previousResponseId: true;
    parallelToolCalls: false;
  };
  enabledFeatures: {
    toolDeclarations: false;
    toolOutputItem: true;
    previousResponseId: true;
    parallelToolCalls: false;
  };
  continuationPolicy: {
    harnessPolicyDigest: string;
    roleMappingDigest: string;
    toolContinuationPolicyDigest: string;
    transitionGraphDigest: string;
    resentOnEveryContinuation: true;
  };
  harnessPolicyDigest: string;
  roleMappingDigest: string;
  contextPolicyDigest: string;
  resultEnvelopeDigest: string;
  rawRequestBodyStored: false;
};
```

Each continuation context pack must cite `repairLoopId`, `stepId`, `stepOrdinal`, `transitionGraphDigest`, parent response proof digest, result artifact id, previous step ids, and loop counters digest.

## 13. Operation Ledger Events

Add or reuse these event families with `eventVersion=1`, monotonic `ledgerSeq`, and digest chaining:

```text
repair_loop_started
repair_loop_step_created
repair_step_obligation_recorded
repair_step_action_token_created
repair_step_decision_committed
repair_step_local_action_started
repair_step_result_recorded
repair_step_context_built
repair_step_request_built
repair_step_continuation_sent
repair_step_continuation_stream_started
repair_step_continuation_terminal
repair_step_next_obligation_recorded
repair_loop_terminal
```

Loop-level events cite existing per-tool events; they do not replace per-tool authority events. Events cite ids and evidence keys only. They never contain raw file content, raw patch text, raw stdout/stderr, raw provider frames, or raw local paths.

## 14. Recovery Integration

PR 3 must use the PR 2 recovery scanner before:

- showing an approval card after reload
- accepting an approval/decline/cancel action
- executing a local read/patch/command
- building a continuation context
- sending a continuation
- allowing a new user prompt in the same direct session
- rollback to app-server

If recovery classification is:

```text
corrupt
workspace_patch_partial_unknown
command_may_have_run
sent_no_bytes
stream_interrupted
raw_exposure_blocked
```

then:

```text
localActionExecuted = false for pending action
continuationSent = false for pending continuation
autoRetryAllowed = false
autoReexecuteAllowed = false
composer disabled unless a later policy explicitly allows fresh turn
```

Manual resume remains out of scope.

### 14.1 Loop-Level Recovery State

Add a loop-level recovery projection derived from step-level recovery state, operation ledger, response chain, and workspace-effect summaries:

```ts
type DirectRepairLoopRecoveryState =
  | "healthy_terminal"
  | "waiting_for_user"
  | "local_action_in_progress_unknown"
  | "result_recorded_no_continuation"
  | "continuation_sent_no_bytes"
  | "stream_interrupted"
  | "side_effect_partial_unknown"
  | "response_chain_invalid"
  | "corrupt";
```

Renderer projections may hydrate display rows after classification, but they are never recovery authority.

## 15. UI And Runtime Contract

The UI may show one active card at a time:

```text
Step 3 of 12 - apply_patch
Step 4 of 12 - run_command
```

Renderer-safe display:

- step ordinal and cap summary
- tool kind
- bounded request summary
- approval/decline/cancel buttons only after complete valid arguments
- result status
- continuation status
- workspace changed warning for patch/command
- recovery-required state if interrupted

Composer behavior:

```text
enabled only when loop terminal is safe
disabled while provider call collecting
disabled while approval waiting
disabled while local action running
disabled while continuation ready/sent/streaming
disabled on corrupt/partial/handoff-unknown states
```

Runtime routing must enforce the same law:

```text
turn/start for the same session/thread returns active_repair_loop_exists
unless the loop is terminal and composerAllowedReason is safe.
```

For PR 3, a fresh new turn after `empty_output`, `response_incomplete`, `content_filter_terminal`, `max_output_terminal`, `stream_interrupted`, or `transport_handoff_unknown` is disabled unless the user explicitly starts a new session or switches runtime.

Direct text-only regression:

```text
provider read_file/apply_patch/run_command call under text-only
  -> terminal tool_call_blocked_text_only
  -> no card
  -> no local action
  -> no continuation
```

## 16. Headless Harness

Add:

```text
scripts/direct-iterative-repair-regression.mjs
npm run direct:iterative-repair
```

Modes:

```text
fixture:
  local provider fixtures and fault injection
  no matrix promotion

preflight:
  disposable workspace and local policy validation
  no live provider

live:
  explicit --allow-live-provider-call or CODEX_DIRECT_REAL_TURN=1
  CI requires CODEX_DIRECT_REAL_TURN_ALLOW_CI=1
  no auto-probe
  exact evidence gates required
```

Live mixed-loop runs are additionally gated by:

```text
fixture transition matrix passed
recovery scanner fault injection passed for every step boundary
raw-exposure scanner passed on fixture reports
text-only tool-call regression passed
PR 1/PR 2 scope preconditions passed
```

Live scenarios:

```text
read -> patch -> command -> final
read -> patch -> command -> read -> final
read -> command nonzero -> patch -> command -> final
cap reached after provider emits next tool call
provider emits unsupported/multiple tool calls
```

Real-provider behavior is nondeterministic:

```text
provider emits shorter final answer -> expected_tool_not_emitted, not failed
provider emits extra unsupported tool -> unsupported_tool_call or multiple_tool_calls_unsupported
only the exact observed expected sequence proves that scenario
```

The live harness records attempted versus proved states:

```ts
type DirectIterativeRepairCaseReport = {
  caseId: string;
  coverageSource:
    | "real_provider"
    | "fixture_provider"
    | "local_preflight"
    | "diagnostic";
  status:
    | "proved"
    | "blocked"
    | "expected_tool_not_emitted"
    | "unsupported_tool_shape"
    | "failed"
    | "redaction_blocked";
  proofOutcome:
    | "proved_full_loop"
    | "provider_tool_not_emitted"
    | "provider_tool_shape_observed_local_blocked"
    | "provider_tool_shape_unsupported"
    | "local_authority_failed"
    | "continuation_failed"
    | "raw_exposure_blocked";
  steps: Array<{
    stepOrdinal: number;
    tool: "read_file" | "apply_patch" | "run_command";
    providerToolCallObserved: boolean;
    localAuthorityExecuted: boolean;
    providerContinuationSent: boolean;
    providerContinuationCompleted: boolean;
    terminalKind?: DirectImplementationRepairTerminalKind;
  }>;
  countsAsRealProviderProof: boolean;
  matrixRowsExercised: Array<"E4" | "E14" | "E15" | "B7" | "B12" | "F4" | "D18">;
  matrixPromotionCandidate: boolean;
  workspaceMutationVisibility: {
    changedPathsDetected: number;
    providerWasToldSummary: boolean;
    providerSawChangedFileContents: boolean;
    unknownChangedContentsCount?: number;
  };
};
```

Only `coverageSource="real_provider"` with `proofOutcome="proved_full_loop"` may be a matrix promotion candidate.

`D18` promotion requires:

```text
transition graph artifact exists
graph digest is cited in every context pack/request manifest
fixture tests cover allowed and blocked transitions
at least one real-provider mixed-tool sequence proves graph enforcement
```

## 17. Safety Sentinels

Every fixture, preflight, and live harness case records:

```ts
type DirectIterativeRepairSentinelCounters = {
  appServerSpawnCalls: number;
  rightPaneMutationCalls: number;
  handoffMutationCalls: number;
  unauthorizedFileReadCalls: number;
  unauthorizedPatchApplyCalls: number;
  unauthorizedCommandRunCalls: number;
  duplicateContinuationSendCalls: number;
  autoApprovalCalls: number;
};
```

Acceptance requires:

```text
appServerSpawnCalls = 0
rightPaneMutationCalls = 0
handoffMutationCalls = 0
autoApprovalCalls = 0
duplicateContinuationSendCalls = 0
```

Authorized local action counters may increment only after user approval and must match exactly one step.

## 18. Raw Exposure

Scan before writing reports and before provider continuation:

- loop object
- step object
- action tokens
- context packs
- request manifests
- provider output envelopes
- patch previews
- command output previews
- workspace-effect summaries
- operation ledger events
- JSON reports
- Markdown summaries
- renderer-safe status payloads

Block if any surface contains:

- raw auth
- raw provider frames
- raw request body
- raw unredacted file contents outside approved result envelope
- raw patch body in report/status
- raw stdout/stderr outside redacted preview
- raw absolute local/WSL paths
- raw ChatGPT URLs
- raw source hashes not represented as local evidence keys
- SQLite/internal exception text

If report scan fails:

```text
write minimal safe redaction-failed report
do not write unsafe report
exit failed
```

## 19. Implementation Order

### Phase -2 - Preconditions

- Verify PR 1 real-provider read, patch, command, and workspace-effect proof for the same scope.
- Verify PR 2 recovery/replay classifier for every loop boundary state.
- Verify direct text-only, recent-dialogue, fixture transition, and raw-exposure regressions.
- Block live mixed-loop transport when preconditions fail.

### Phase -1 - Law And Types

- Define repair loop, step, response chain, transition graph, terminal kinds, caps, counters, and report schema.
- Add `localWorkflowState`, `providerHandoffState`, `sideEffectState`, workspace effect refs, action token refs, policy snapshot, response-chain handoff state, and loop recovery state.
- Add mixed-loop evidence scope.
- Add request-control verification for all continuations.
- Add text-only regression fixture expectations.

### Phase 0 - Transition Controller

- Create one active step from a provider tool call.
- Enforce one active obligation.
- Enforce transition graph and caps.
- Classify multiple/parallel/unsupported tool calls.
- Record response-chain proof.
- Block new prompt routing while loop is nonterminal.

### Phase 1 - Authority Composition

- Reuse read, patch, and command authority modules.
- Add per-step action tokens and idempotency keys.
- Add per-step decision idempotency conflict rules.
- Record per-step operation ledger events.
- Record loop-level operation ledger events that cite per-tool events.
- Update loop counters after durable result artifacts.
- Link side-effect and workspace-effect summaries.
- Persist policy snapshot.

### Phase 2 - Continuation Loop

- Build `repair_step_context@1`.
- Build context pack and manifest with transition graph digest, policy snapshot, tool declaration mode, provider tool set digest, and lineage.
- Explicitly choose and validate `codex_native_implicit` or `declared_allowed_tool_set`.
- Send continuation only after durable artifacts and raw-exposure scan.
- Interpret outcome as final assistant or next step.
- No retry after bytes/events.

### Phase 3 - Recovery And Status

- Run recovery scanner at every action boundary.
- Derive loop-level recovery classification from step recovery.
- Block corrupt, partial, handoff-unknown, and stream-interrupted states.
- Expose renderer-safe loop/step status.
- Keep manual resume out of scope.

### Phase 4 - Headless Smokes

- Fixture transition matrix.
- Real-provider disposable workspace loop.
- Cap exceeded case.
- Text-only regression.
- Multiple/parallel tool call fail-closed case.
- Raw-exposure and sentinel scans.

## 20. Acceptance Criteria

```text
- PR 3 live runs are gated on PR 1 real-provider proof and PR 2 recovery classifier passing for the same scope.
- Direct implementation repair loop has schema-versioned loop and step artifacts.
- Loop status is split into localWorkflowState and providerHandoffState.
- Loop records sideEffectState and a policy snapshot.
- Patch/command steps record workspaceEffectSummaryId and workspaceEffectState.
- A transition graph artifact defines legal read/patch/command sequencing.
- Transition graph and manifests include providerToolSetDigest and declaredToolSchemasDigest, or explicitly prove Codex-native implicit tool-call behavior.
- Exactly one active obligation is allowed per direct turn.
- Every read, patch, and command step requires a fresh approval token and decision id.
- Every step records approvalTokenId, clientToolDecisionId, and decisionRecordId once available.
- Per-step decision idempotency conflict rules are specified and tested.
- Provider tool calls under Direct text-only remain terminal blocked.
- Parallel and multiple tool calls fail closed with no local action.
- Unsupported tools, namespaces, and incomplete arguments fail closed.
- Response-chain proof validates step N against the previous continuation response id.
- Response-chain entries include continuation handoff state.
- Every continuation manifest records store=false, toolDeclarations=false, toolOutputItem=true, previousResponseId=true, and parallelToolCalls=false.
- Harness policy, role mapping, context policy, and transition graph digest are re-sent every continuation.
- Continuation manifests prove current harness/tool policy was re-sent on every previous_response_id continuation.
- Loop caps stop the turn before local action when possible and before continuation when exceeded after provider output.
- Command workspace-change cap, timeout, and provider-output cap behavior are specified and tested.
- Patch delete remains blocked with patch_delete_deferred.
- Command nonzero exit is evidence, not transport failure, if redaction passes.
- Workspace-effect summaries are included after patch and command steps.
- Recovery scanner blocks actions from corrupt, partial, handoff-unknown, or stream-interrupted states.
- Loop-level recovery state is derived from step-level recovery state.
- No startup or action-boundary recovery path auto-retries provider continuations or local side effects.
- New prompt routing is blocked by controller while the loop is nonterminal.
- Fresh new turn after empty/incomplete/content-filter/max-output/stream-interrupted/handoff-unknown is disabled in PR 3 unless a new session/runtime switch is explicit.
- Renderer/status payloads use artifact ids and evidence keys only.
- Headless reports distinguish attempted provider prompting from proved full loops.
- Fixture coverage never promotes matrix rows.
- Fixture transition matrix and recovery fault injection pass before live mixed-loop runs.
- Real-provider proof requires provider tool calls, local authority execution, continuation send, and continuation completion for every expected step.
- D18 matrix promotion requires graph artifact, graph digest citations, allowed/blocked fixture tests, and at least one real-provider mixed-tool sequence.
- Reports state when workspace changed but provider saw only a summary, not changed file contents.
- Sentinels prove no app-server fallback, no right-pane mutation, no handoff mutation, no auto-approval, and no duplicate continuation send.
```

## 21. Final Boundary

Passing this bundle means:

```text
Direct implementation lane can run a bounded, sequential repair turn composed
of read_file, apply_patch, and run_command steps, with per-step human authority,
durable evidence, lawful continuations, recovery checks, and no replay after
ambiguity.
```

It does not mean:

```text
direct is production
general agent autonomy exists
provider tool calls become authority
parallel tools are supported
auto-approval exists
revert exists
manual resume exists
context memory exists
governance or semantic broker enforcement exists
right-pane ChatGPT is controlled
app-server can be removed
```
