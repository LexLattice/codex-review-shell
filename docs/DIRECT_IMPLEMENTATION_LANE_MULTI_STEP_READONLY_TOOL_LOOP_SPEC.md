# Direct Implementation-Lane Multi-Step Read-Only Tool Loop Spec

Status: draft implementation specification for the next direct-runtime bundle on
the long-lived `codex/direct-chatgpt-harness` branch.

Related docs:

- [DIRECT_IMPLEMENTATION_LANE_READONLY_TOOL_UI_SPEC.md](./DIRECT_IMPLEMENTATION_LANE_READONLY_TOOL_UI_SPEC.md)
- [DIRECT_READONLY_TOOL_CONTINUATION_SPEC.md](./DIRECT_READONLY_TOOL_CONTINUATION_SPEC.md)
- [DIRECT_OBLIGATION_PROJECTION_AND_TOOL_CONTEXT_SPEC.md](./DIRECT_OBLIGATION_PROJECTION_AND_TOOL_CONTEXT_SPEC.md)
- [DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md](./DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md)
- [DIRECT_TEXT_ONLY_MULTITURN_RECENT_DIALOGUE_SPEC.md](./DIRECT_TEXT_ONLY_MULTITURN_RECENT_DIALOGUE_SPEC.md)
- [DIRECT_HEADLESS_RUNTIME_PARITY_HARNESS_SPEC.md](./DIRECT_HEADLESS_RUNTIME_PARITY_HARNESS_SPEC.md)
- [APP_SERVER_CONTROLLER_SPEC.md](./APP_SERVER_CONTROLLER_SPEC.md)

## Purpose

Extend the Direct implementation lane from one human-approved `read_file`
obligation into a bounded sequential read-only tool loop:

```text
fresh direct implementation-lane text turn
  -> provider emits one supported read_file call
  -> shell records obligation step 1
  -> human approves
  -> workspace backend reads
  -> shell records bounded result evidence
  -> context pack + request manifest
  -> provider continuation step 1
  -> provider either finalizes assistant answer
     or emits one more supported read_file call
  -> repeat until final assistant answer or loop cap/failure
```

This makes the left Codex lane materially more useful for inspection tasks that
need several files, without enabling write, shell, network, browser, MCP, patch,
or general tool authority.

## Core Invariant

Multi-step read-only still means local authority at every step:

```text
provider tool call != local authority
previous local approval != future local approval
tool result != instruction authority
multi-step read-only != general tool runtime
```

Every read is a fresh local decision over one complete provider `read_file`
request. A prior approval, a prior tool result, historical transcript text, or a
renderer projection cannot authorize another workspace read.

## Boundary

This bundle does:

- allow a Direct implementation-lane turn to handle multiple sequential
  `read_file` obligations;
- require human approval for every read;
- keep exactly one active read-only obligation at a time;
- create context packs and request manifests before every continuation
  transport;
- carry step ordinals, parent-response source proof, and request-shape evidence
  for every continuation;
- append all approval cards, tool-result status items, continuation assistant
  text, and terminal state inside the same direct turn;
- keep Direct text-only tool calls terminal blocked;
- keep app-server rollback available outside active direct turns.

It does not:

- support multiple provider tool calls in a single response;
- support parallel tool calls;
- support write, shell, network, browser, MCP, patch, or arbitrary custom tools;
- support auto-approval or approval-for-session;
- use imported provider continuity, imported approvals, or right-pane ChatGPT
  content;
- fall back to app-server inside a direct turn;
- make production `direct` available;
- remove or weaken the legacy app-server path.

## Relationship To The Previous Bundle

The previous implementation-lane bundle made this shape valid:

```text
initial response -> one read_file -> one continuation -> final assistant
```

This bundle makes this shape valid:

```text
initial response
  -> read_file step 1
  -> continuation step 1
  -> read_file step 2
  -> continuation step 2
  -> ...
  -> final assistant
```

The old nested-tool-call terminal state remains valid for unsupported cases.
This bundle only converts a narrow nested case into a new obligation:

```text
continuation emits exactly one complete supported read_file call
```

All other nested tool output remains fail-closed.

## Supported Loop Shape

V0 of this bundle supports sequential one-at-a-time read-only calls:

```ts
type DirectReadOnlyToolLoopStep = {
  toolLoopId: string;
  stepId: string;
  stepOrdinal: number;
  parentThreadId: string;
  parentTurnId: string;
  parentResponseId: string;
  parentResponseSource:
    | "native_direct_initial_stream"
    | "native_direct_tool_continuation_stream";
  obligationId: string;
  toolName: "read_file";
  namespacePolicy: "absent-only";
  providerCallType: "function_call" | "custom_tool_call";
  providerOutputType: "function_call_output" | "custom_tool_call_output";
  status:
    | "collecting_arguments"
    | "waiting_for_approval"
    | "approved"
    | "declined"
    | "canceled"
    | "result_recorded"
    | "context_built"
    | "request_built"
    | "continuation_sent"
    | "streaming_continuation"
    | "completed"
    | "failed";
  terminalKind?: DirectReadOnlyToolLoopTerminalKind;
  continuationOutcome?: DirectContinuationOutcome;
};
```

The provider may emit another supported `read_file` after a continuation. That
new call becomes a new step with a new obligation id and a new approval card.

Loop, step, and turn terminal states are distinct:

```ts
type DirectReadOnlyToolLoopTerminalKind =
  | "completed_final_assistant"
  | "declined"
  | "canceled"
  | "tool_loop_cap_exceeded"
  | "unsupported_nested_tool_call"
  | "multiple_tool_calls_unsupported"
  | "redaction_blocked"
  | "sensitive_path_denied"
  | "missing_native_parent_continuity"
  | "continuation_context_failed"
  | "continuation_request_failed"
  | "transport_handoff_unknown"
  | "response_incomplete"
  | "empty_continuation_output";

type DirectContinuationOutcome =
  | "assistant_final"
  | "next_read_file_step"
  | "unsupported_nested_tool_call"
  | "multiple_tool_calls_unsupported"
  | "incomplete"
  | "empty_output"
  | "transport_failed";
```

`completed_final_assistant` means a provider continuation completed with
assistant text, no pending tool call, and no incomplete details. A cap stop,
decline, redaction block, sensitive-path denial, or transport ambiguity is a
different terminal kind and must not be reported as provider success.

## Explicitly Unsupported In This Bundle

These cases remain terminal unsupported:

```text
multiple provider tool calls in the same response
parallel function/custom calls
unsupported tool name
unsupported namespace
malformed arguments
missing call_id
tool call before previous step terminal
nested non-read_file tool
write/shell/network/browser/MCP/patch tool
provider reasoning item that looks like tool authority
```

Default blocker codes:

```text
multiple_tool_calls_unsupported
parallel_tool_calls_unsupported
unsupported_readonly_tool
unsupported_tool_namespace
invalid_tool_arguments
missing_tool_call_id
tool_call_during_active_step
unsupported_nested_tool_call
tool_loop_cap_exceeded
```

Multiple calls in one response produce no approval cards, no workspace reads,
and no continuation.

## Evidence Gates

The single-step gate is not enough to unlock multi-step behavior. Add a distinct
evidence scope:

```ts
type DirectReadOnlyToolLoopContinuationEvidenceScope = {
  requestShapeClass: "direct_readonly_tool_loop_continuation@1";
  model: string;
  endpointHash: string;
  accountEvidenceKey: string;
  providerCallType: "function_call" | "custom_tool_call";
  providerOutputType: "function_call_output" | "custom_tool_call_output";
  toolName: "read_file";
  namespacePolicy: "absent-only";
  parentResponseSource:
    | "native_direct_initial_stream"
    | "native_direct_tool_continuation_stream";
  loopStepOrdinalPolicy: "bounded-sequential";
  toolCallShapeHash: string;
  toolResultEnvelopeShapeHash: string;
  continuationRequestShapeHash: string;
  continuationNormalizerVersion: string;
  requestBuilderVersion: string;
  redactionVersion: string;
  resultClass:
    | "text_preview_untruncated"
    | "text_preview_truncated"
    | "safe_failure_envelope";
  store: false;
  toolDeclarations: false;
  toolOutputItem: true;
  parallelToolCalls: false;
  previousResponseId: true;
};
```

Evidence for:

```text
direct_readonly_tool_continuation@1
```

does not automatically prove:

```text
direct_readonly_tool_loop_continuation@1
```

unless an explicit migration/probe records that the shape is identical for the
selected model, endpoint/account scope, parent response source, provider call
type, provider output type, role mapping, normalizer, request builder, and
redaction version.

The resolver treats these as strict sub-scopes:

```text
native_direct_initial_stream evidence
  does not automatically prove native_direct_tool_continuation_stream evidence

function_call_output evidence
  does not automatically prove custom_tool_call_output evidence

custom_tool_call_output evidence
  does not automatically prove function_call_output evidence

safe_failure_envelope evidence
  does not automatically prove text-preview result evidence
```

## Loop Caps

Default caps:

```ts
MAX_READONLY_TOOL_LOOP_STEPS = 8;
MAX_READONLY_TOOL_LOOP_TOTAL_BYTES = 2 * 1024 * 1024;
MAX_READONLY_TOOL_LOOP_TOTAL_PROVIDER_CHARS = 256 * 1024;
MAX_READONLY_TOOL_LOOP_REPEATED_PATH_READS = 2;
MAX_READONLY_TOOL_LOOP_WALL_CLOCK_MS = 10 * 60 * 1000;
MAX_READONLY_TOOL_LOOP_PENDING_APPROVALS = 1;
```

Repeated-path reads are keyed by the workspace backend's canonical evidence key,
not renderer strings:

```text
same normalized project-relative path
same canonical realpath evidence key
same symlink-resolved target
```

The third request for the same canonical target is blocked before approval if
detected during obligation construction. If detection happens after the card is
rendered, the card becomes disabled with a renderer-safe
`tool_loop_cap_exceeded` summary.

If a cap is hit:

```text
stop locally
do not execute another workspace read
do not send another provider continuation
mark turn failed or incomplete with tool_loop_cap_exceeded
show renderer-safe cap summary
```

If the provider emits another supported `read_file` after the final allowed
step, record that unsupported next tool call as evidence, show no approval card,
append a same-turn status item saying the read-only loop cap was reached, and
mark the turn terminal with `tool_loop_cap_exceeded`. The composer may allow a
fresh new turn after terminal state; it must not continue the same tool loop.

Caps must be recorded in:

```text
tool loop state
tool result artifact
context pack
request manifest
headless report
renderer-safe status
```

## Parent Response Continuity

Every continuation uses the provider response id that emitted the current tool
call:

```ts
type DirectToolLoopParentResponse = {
  previousResponseId: string;
  source:
    | "native_direct_initial_stream"
    | "native_direct_tool_continuation_stream";
  sourceEventDigest: string;
  sourceTurnDigest: string;
  sourceRequestManifestId: string;
  sourceStepId?: string;
  sourceContinuationId?: string;
  importedContinuityHandleUsed: false;
};
```

Step 1 uses the initial direct response id. Step N uses the response id from the
continuation stream that emitted step N's tool call.

Maintain and verify the response-id chain:

```ts
type DirectReadOnlyToolLoopResponseChain = Array<{
  stepOrdinal: number;
  emittedToolCallResponseId: string;
  continuationResponseId?: string;
  sourceEventDigest: string;
}>;
```

For step N, the parent response id must equal the response id emitted by the
step N-1 continuation stream. Recovery rebuilds this chain from artifacts before
allowing another continuation.

If this proof is missing:

```text
missing_native_parent_continuity
```

The failure is local-terminal for that step. No provider continuation is sent.

## Context And Manifest Law

Each step creates fresh artifacts:

```text
direct_obligations@1
  -> tool_continuation_context@1
  -> direct_context_pack@1
  -> provider_input_projection
  -> direct_request_manifest@1
  -> provider continuation
```

The context pack must classify message authority:

```text
harness policy -> harness-policy
loop status -> status-evidence
parent turn/tool-call summary -> historical-dialogue-evidence
local decision -> status-evidence
bounded tool result -> tool-result-evidence
continuation intent -> status-evidence
```

The provider input must include the current read-only continuation harness
policy and role mapping every time. Do not rely on provider continuity to carry
instructions.

The manifest records:

```ts
requestShapeClass: "direct_readonly_tool_loop_continuation@1";
enabledFeatures: {
  store: false;
  tools: false; // no tool declarations
  toolDeclarations: false;
  toolOutputItem: true;
  previousResponseId: true;
  reasoning: false;
  structuredOutput: false;
  serviceTier: false;
  promptCache: false;
  includes: false;
  parallelToolCalls: false;
};
continuity: {
  previousResponseIdUsed: true;
  providerContinuityHandleUsed: true;
  importedContinuityHandleUsed: false;
  continuityPolicy: "bounded_readonly_tool_loop";
};
toolLoop: {
  toolLoopId: string;
  stepId: string;
  stepOrdinal: number;
  maxStepCount: number;
  previousStepIds: string[];
};
```

`tools=false` means no tool declarations are sent. The request may include
exactly one accepted tool-output item paired to the original `call_id` for that
step.

The request builder must assert `store=false` and `parallel_tool_calls=false`
before transport for every continuation. `tools=false` means no new tool
declarations and no permission to request tools; it does not forbid the single
accepted tool-output item required to answer the original provider `call_id`.

The step ordinal, loop id, parent response proof, and result class are included
in:

```text
tool_continuation_context@1
direct_context_pack@1
provider_input_projection
direct_request_manifest@1
operation ledger events
headless reports
```

## Local Authority

Each step repeats the full approval flow:

```ts
type DirectReadOnlyStepActionToken = {
  tokenId: string;
  projectId: string;
  threadId: string;
  turnId: string;
  toolLoopId: string;
  stepId: string;
  obligationId: string;
  action: "approve" | "decline" | "cancel";
  stepOrdinal: number;
  obligationDigest: string;
  parentResponseDigest: string;
  operationLedgerHeadDigest: string;
  expiresAt: string;
};
```

Step action tokens are mandatory. Renderer buttons submit only
`clientToolDecisionId` plus `actionTokenId`; main-process code revalidates the
token, project, generation, runtime tier, turn, step, obligation digest, parent
response digest, and operation ledger head before doing anything.

```text
1. provider emits one complete read_file tool call
2. shell records a new obligation step
3. renderer shows a bounded approval card
4. user chooses approve / decline / cancel
5. main validates action token and expected state
6. main validates project/thread/turn/step ownership
7. main validates parent response proof
8. main validates path and workspace policy
9. workspace backend reads exactly once
10. result is scanned/redacted/bounded
11. result artifact is written atomically
12. context pack and manifest are written atomically
13. continuation transport may start
```

No approval is reusable across steps. No path allowlist is created by approval.
No "approve all reads" affordance exists in this bundle.

Sensitive and failed reads are classified before continuation:

```text
sensitive_path_denied:
  terminal for step and loop; no provider continuation

redaction_blocked:
  terminal for step and loop; no provider continuation

tool_result_redacted_policy_disallowed:
  terminal for step and loop; no provider continuation

read_failed_safe_to_send:
  may continue only when safe_failure_envelope evidence exists for the loop
```

Redaction summaries are persisted per step and summarized at loop level:

```ts
type DirectReadOnlyToolLoopRedactionSummary = {
  stepId: string;
  scanned: boolean;
  scanVersion: string;
  status: "passed" | "redacted" | "blocked";
  categories?: Array<
    | "token"
    | "cookie"
    | "authorization-header"
    | "private-key"
    | "session-id"
    | "env-secret"
    | "unknown-secret"
  >;
  providerOutputAllowed: boolean;
};
```

Loop summaries include `redactionBlockedStepCount`, `redactedStepCount`,
`providerOutputTotalChars`, and `providerOutputTotalBytes`.

## Decision Idempotency

Idempotency is scoped by step:

```text
same clientToolDecisionId + same stepId + same obligationId + same action:
  return existing step snapshot

same clientToolDecisionId + different stepId:
  reject client_decision_id_conflict

same clientToolDecisionId + same stepId + different action:
  reject client_decision_id_conflict

different clientToolDecisionId after step terminal:
  reject terminal_decision_exists or return terminal snapshot

decline/cancel after result_recorded or continuation_sent:
  reject too_late_for_decision
```

Duplicate approvals must not repeat workspace reads or provider continuations.

Locks are explicit:

```text
one tool-loop lock per direct turn
one active-step lock per toolLoopId
one decision lock per stepId
one continuation lock per stepId
```

Conflict behavior:

```text
second tool call while a step is nonterminal:
  tool_call_during_active_step

second approve click for the same step:
  idempotent step snapshot

different action after a terminal step:
  terminal_decision_exists
```

## Operation Ledger Events

Add or extend append-only events:

```text
tool_loop_started
tool_step_obligation_recorded
tool_decision_committed
tool_result_recorded
tool_continuation_context_built
tool_continuation_request_built
tool_continuation_sent
tool_continuation_stream_started
tool_step_terminal
tool_loop_terminal
```

Each event cites ids and hashes:

```text
toolLoopId
stepId
obligationId
resultId
contextBuildId
contextPackHash
requestManifestId
requestShapeHash
providerInputShapeHash
parentResponse source digest
operation ledger head digest
```

No raw file contents, raw paths, raw request bodies, raw provider frames, or auth
material are written to operation history.

## Runtime Status

Extend implementation-lane status:

```ts
directImplementationLane.readOnlyToolLoop = {
  obligationProjectionHealthy: boolean;
  toolContextProjectionHealthy: boolean;
  workspaceReadHealthy: boolean;
  continuationEvidenceState:
    | "accepted"
    | "runtime_probed"
    | "missing"
    | "expired"
    | "candidate";
  loopEvidenceState:
    | "accepted"
    | "runtime_probed"
    | "missing"
    | "expired"
    | "candidate";
  activeLoopCount: number;
  activeStepOrdinal?: number;
  maxStepCount: number;
  pendingDecisionCount: number;
  streamingContinuationCount: number;
  canContinueSequentialReadOnlyLoop: boolean;
  blockerCodes: string[];
};
```

The composer remains disabled while a direct turn is in:

```text
tool_waiting
authority_waiting
continuation_ready
continuation_sent
streaming_continuation
```

These durable wait states are active for runtime selection/rollback purposes,
but they are not failed by interrupted-turn recovery.

Rollback to app-server is blocked while any loop step is nonterminal:

```text
collecting_arguments
waiting_for_approval
approved
result_recorded
context_built
request_built
continuation_sent
streaming_continuation
```

Rollback is allowed after terminal loop state, subject to the same private
rollback snapshot and runtime-selection audit rules as the Direct text-only and
single-step implementation-lane bundles.

## UI

Renderer behavior:

- show one approval card at a time;
- show `Read file step N of M`;
- show bounded relative path and policy limits;
- show result status after approval;
- collapse completed tool steps into compact same-turn history;
- keep stale cards disabled;
- never show absolute paths, WSL paths, raw file contents beyond approved
  bounded preview, raw provider frames, auth material, or request bodies;
- show final assistant answer in the same turn after loop terminal completion.

Suggested card copy:

```text
Read file
Step 2 of 8
src/main/example.ts

Approve read  Decline  Cancel turn
```

Do not present this as a general tools system.

## Recovery

Classify recovery before deciding whether a state is actionable:

```ts
type DirectReadOnlyToolLoopRecoveryState =
  | "healthy"
  | "waiting_for_user"
  | "decision_committed_no_result"
  | "result_recorded_no_context"
  | "context_built_no_manifest"
  | "request_built_not_sent"
  | "sent_no_bytes"
  | "stream_interrupted"
  | "terminal"
  | "corrupt";
```

Recovery rules:

```text
waiting_for_approval:
  durable wait state; re-show approval card if renderer reconnects

approved but no result:
  execute read only if no result artifact exists and decision idempotency permits it

result_recorded but no context pack:
  rebuild context/manifest idempotently

request_built but no continuation_sent:
  may rebuild manifest if source digests match

continuation_sent with no bytes:
  no automatic retry unless transport proves request was not accepted

streaming_continuation:
  never retry

tool_loop_cap_exceeded:
  terminal; user may start a fresh turn
```

`tool_waiting`, `authority_waiting`, and `continuation_ready` are not crash
failures by themselves. They are durable user/controller wait states.

## Headless Harness

Add fixture scenarios:

```text
readonly-tool-loop-two-step-fixture
readonly-tool-loop-cap-fixture
readonly-tool-loop-multiple-calls-blocked-fixture
readonly-tool-loop-redaction-blocked-fixture
readonly-tool-loop-text-only-regression-fixture
```

The text-only regression fixture uses the same provider tool-call shape under
Direct text-only and proves:

```text
no approval card
no workspace read
no continuation
terminal tool_call_blocked_text_only
```

Optional live scenario:

```text
scripts/codex-real-turn.mjs \
  --runtime=direct \
  --tier=implementation-lane \
  --scenario=readonly-tool-loop-live \
  --allow-live-provider-call
```

Live transport rules:

```text
CI=true requires CODEX_DIRECT_REAL_TURN_ALLOW_CI=1
missing loop continuation evidence blocks before transport
runner must not auto-run a probe and then continue
no right-pane ChatGPT mutation
no handoff queue mutation
no app-server fallback
```

Reports include:

```ts
toolLoop: {
  toolLoopId: string;
  maxStepCount: number;
  completedStepCount: number;
  terminalState: string;
  capExceeded: boolean;
  steps: Array<{
    stepId: string;
    stepOrdinal: number;
    obligationId: string;
    providerCallType: string;
    providerOutputType: string;
    toolName: "read_file";
    decision: "approved" | "declined" | "canceled" | "unsupported";
    workspaceReadExecuted: boolean;
    resultArtifactId?: string;
    redactionStatus?: "passed" | "blocked" | "redacted";
    contextBuildId?: string;
    requestManifestId?: string;
    continuationSent: boolean;
    continuationBytesObserved: boolean;
    recoveryState?: DirectReadOnlyToolLoopRecoveryState;
    terminalKind?: DirectReadOnlyToolLoopTerminalKind;
    continuationOutcome?: DirectContinuationOutcome;
    autoRetried: false;
  }>;
};
```

Normal reports contain no raw file contents, raw paths, auth, request bodies, or
provider frames.

## Raw-Exposure Tests

Scan:

```text
serialized renderer state
approval card DOM attributes
transcript rows
operation/diagnostic panels
browser localStorage/sessionStorage
headless reports
handoff queue text
direct operation ledger summaries
context summaries
request manifest renderer-safe summaries
```

Assert absence of:

```text
raw auth tokens
raw auth headers
raw backend request/response bodies
raw provider stream frames
absolute local paths
raw WSL paths
raw file contents beyond approved bounded preview
private keys or secret-like text
raw ChatGPT URLs
source file hashes
```

## Implementation Order

### Phase -1 - Law And Gates

- Add `direct_readonly_tool_loop_continuation@1` evidence scope.
- Split evidence by `parentResponseSource`.
- Split function/custom output evidence.
- Add `parallelToolCalls=false`.
- Add result class scope for text previews versus safe failure envelopes.
- Add sequential loop caps and blocker codes.
- Define loop, step, and turn terminal kinds.
- Split active wait states from interrupted-transport recovery states.
- Extend runtime status with loop evidence and active step fields.

### Phase 0 - Step Model

- Add `toolLoopId`, `stepId`, and `stepOrdinal` to obligations.
- Track parent response proof and response-chain proof per step.
- Keep exactly one active step per direct turn.
- Require renderer-safe action tokens per step.
- Add loop, active-step, decision, and continuation locks.
- Add recovery-state classification for partial ledger sequences.

### Phase 1 - Nested Read-Only Detection

- Convert one supported nested `read_file` emitted by continuation into the next
  local obligation.
- Keep multiple or unsupported nested tool calls terminal unsupported.
- Rebuild direct obligations projection after every step transition.

### Phase 2 - Repeated Approval And Read

- Revalidate project/thread/turn/step/obligation/ledger/action token.
- Execute one workspace read per approved step.
- Enforce per-step and cumulative caps.
- Enforce repeated-path caps by canonical workspace evidence key.
- Apply sensitive-path terminal policy.
- Scan/redact every result before provider continuation.
- Persist per-step and loop-level redaction summaries.

### Phase 3 - Repeated Context And Manifest

- Build a new `tool_continuation_context@1` for each step.
- Build a new context pack and request manifest for each continuation.
- Use parent response id from the response that emitted the current step.
- Re-send harness policy and role mapping every time.
- Assert `store=false`, `parallel_tool_calls=false`, no tool declarations, and
  exactly one tool-output item before transport.

### Phase 4 - Transport Loop

- Mark `continuation_sent` before every handoff.
- Mark `streaming_continuation` when bytes/events are observed.
- If assistant text finalizes, complete the turn.
- If exactly one supported read_file appears, create the next step.
- If cap or unsupported event occurs, fail closed.
- Require `response_completed`, non-empty assistant text, no pending tool call,
  no incomplete details, and no unknown event blocker for final success.
- No retry after bytes.

### Phase 5 - UI And Headless

- Render one approval card at a time.
- Show step count and loop cap.
- Collapse completed steps.
- Add headless fixtures for two-step, cap, multiple-call, and redaction-blocked
  scenarios.
- Add Direct text-only regression fixture.
- Add no-app-server, no-right-pane, and no-handoff sentinels around every phase.

## Acceptance Criteria

- Direct implementation-lane can complete a turn with two sequential approved
  `read_file` calls and one final assistant answer.
- Loop terminal kind, step terminal kind, and turn terminal kind are distinct.
- Continuation outcome distinguishes `assistant_final` from
  `next_read_file_step`.
- Every read requires its own approval action token and controller revalidation.
- Approval for one step cannot authorize any later step.
- The loop has one active-step lock and one tool-loop lock per turn.
- Evidence is split by parent response source; initial-stream proof does not
  automatically prove continuation-stream proof.
- Function-call output and custom-tool-call output are separate evidence scopes.
- Safe failure-envelope result evidence is scoped separately from text-preview
  result evidence.
- Multiple provider tool calls in one response remain unsupported and create no
  approval cards.
- Unsupported nested tool calls remain terminal unsupported.
- Loop caps are enforced and renderer-visible as safe summaries.
- Repeated-path cap uses canonical workspace evidence keys, not renderer path
  strings.
- Parent `previousResponseId` proof is recorded per step and comes only from
  native direct streams.
- The response id chain is verified before every continuation.
- Each continuation has its own context pack, provider-input projection, and
  request manifest written before transport.
- Continuation manifests record `store=false`, no tool declarations, exactly one
  tool-output item, `parallelToolCalls=false`, `previousResponseIdUsed=true`,
  and `importedContinuityHandleUsed=false`.
- Request-builder tests assert `store=false` before every continuation
  transport.
- Harness policy and role mapping are present in every continuation provider
  input.
- Cap reached after a provider emits another `read_file` records evidence,
  shows no approval card, and terminally stops the loop.
- Final assistant completion requires `response_completed`, non-empty assistant
  text, no pending tool call, and no incomplete details.
- `tool_waiting`, `authority_waiting`, and `continuation_ready` survive restart
  as durable wait states rather than failed interrupted turns.
- `continuation_sent` with no bytes is never retried automatically.
- `streaming_continuation` is never retried.
- Recovery state distinguishes `waiting_for_user`,
  `decision_committed_no_result`, `result_recorded_no_context`,
  `context_built_no_manifest`, `request_built_not_sent`, `sent_no_bytes`,
  `stream_interrupted`, `terminal`, and `corrupt`.
- Final assistant output is appended inside the same turn, after the completed
  tool-step history.
- Direct text-only still blocks provider tool calls terminally and never shows
  approval UI.
- Direct text-only regression fixture proves tool calls remain terminal blocked.
- Rollback to app-server is blocked during all nonterminal loop/wait states.
- Tests prove no app-server fallback, no right-pane mutation, no handoff
  mutation, no write/shell/network tools, and no auto-approval.

## Final Meaning

Passing this bundle should mean:

```text
The Direct implementation lane can complete a bounded, human-approved,
multi-step read_file inspection loop inside one native direct Codex turn.
```

It should not mean:

```text
general tools are enabled
parallel or batched tool calls are supported
write/shell/network/patch tools are supported
approvals can be reused
provider tool calls are authority
right-pane ChatGPT is imported or controlled
direct is production
app-server can be removed
```
