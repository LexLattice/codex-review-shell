# Direct Implementation-Lane Read-Only Tool UI Spec

Status: draft implementation specification for the next direct-runtime UX and
control bundle on the long-lived `codex/direct-chatgpt-harness` branch.

Related docs:

- [DIRECT_TEXT_ONLY_RUNTIME_TIER_AND_TOGGLE_SPEC.md](./DIRECT_TEXT_ONLY_RUNTIME_TIER_AND_TOGGLE_SPEC.md)
- [DIRECT_TEXT_ONLY_MULTITURN_RECENT_DIALOGUE_SPEC.md](./DIRECT_TEXT_ONLY_MULTITURN_RECENT_DIALOGUE_SPEC.md)
- [DIRECT_READONLY_TOOL_CONTINUATION_SPEC.md](./DIRECT_READONLY_TOOL_CONTINUATION_SPEC.md)
- [DIRECT_OBLIGATION_PROJECTION_AND_TOOL_CONTEXT_SPEC.md](./DIRECT_OBLIGATION_PROJECTION_AND_TOOL_CONTEXT_SPEC.md)
- [DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md](./DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md)
- [DIRECT_LIVE_TEXT_TURN_SURFACE_SPEC.md](./DIRECT_LIVE_TEXT_TURN_SURFACE_SPEC.md)
- [DIRECT_LIVE_PROBE_EVIDENCE_PROMOTION_SPEC.md](./DIRECT_LIVE_PROBE_EVIDENCE_PROMOTION_SPEC.md)
- [DIRECT_HEADLESS_RUNTIME_PARITY_HARNESS_SPEC.md](./DIRECT_HEADLESS_RUNTIME_PARITY_HARNESS_SPEC.md)
- [APP_SERVER_CONTROLLER_SPEC.md](./APP_SERVER_CONTROLLER_SPEC.md)

## Purpose

Make the Direct implementation lane usable for the first real Codex-like tool
loop in the left lane:

```text
direct live text turn
  -> provider emits one supported read_file tool call
  -> shell records a local obligation
  -> renderer shows a human approval card
  -> user approves
  -> workspace backend executes one bounded read
  -> shell records a redacted result artifact
  -> tool_continuation_context@1
  -> direct_context_pack@1
  -> direct_request_manifest@1
  -> provider continuation request
  -> final assistant text in the same turn
```

This is the next practical step after Direct text-only multi-turn. It should
move us closer to app-server parity for common Codex usage, while preserving the
branch law:

```text
provider tool call != local authority
local tool result != instruction authority
implementation-lane read-only != general tool runtime
```

## Core Invariant

Direct implementation-lane v0 may run exactly one locally approved read-only
workspace read and one provider continuation for a turn. It must never infer
authority from the provider, from historical transcript text, from imported
state, from renderer projections, or from stale UI buttons.

```text
provider asks
main process validates
user approves
workspace backend reads
context/manifest prove the continuation
```

## Boundary

This bundle does:

- expose `direct-experimental/implementation-lane/live-text` as selectable only
  when strict implementation-lane gates pass;
- keep `Direct text-only` as a separate selectable tier;
- route implementation-lane text turns through the same direct live text
  controller and context/request artifact path;
- allow one supported read-only `read_file` obligation per parent response;
- show a renderer-safe approval card for supported obligations;
- execute the read through the project workspace backend only after approval;
- persist local authority decision, result, continuation context, context pack,
  request manifest, and continuation terminal state;
- append final assistant continuation text to the same turn;
- preserve app-server rollback.

It does not:

- make production `direct` available;
- make direct the default;
- auto-approve any tool call;
- enable write, shell, network, browser, MCP, patch, or arbitrary custom tools;
- execute unsupported tool names, unsupported namespaces, malformed arguments,
  missing call ids, nested tool calls, or multiple tool calls;
- use imported approvals or imported provider continuity;
- import or mutate right-pane ChatGPT content;
- create or mutate handoff queue items;
- fall back to app-server inside a direct turn;
- relax Direct text-only safety behavior.

## Runtime Tier Model

The runtime selector keeps three explicit choices:

```text
App-server
Direct text-only
Direct implementation lane
```

`Direct implementation lane` maps to:

```text
runtimeMode = direct-experimental
directTier = implementation-lane
directTransport = live-text
```

Selection is still not turn authority. Composer submit and every tool action
must re-evaluate gates in main immediately before transport or workspace access.

## Readiness Gates

Implementation-lane readiness is action-specific:

```ts
directImplementationLane: {
  canSelect: boolean;
  canStartFirstTurn: boolean;
  canStartFollowupTurn: boolean;
  canApproveReadFile: boolean;
  canSendContinuation: boolean;
};
```

For v0, `canSelect` requires the full current direct implementation-lane text
flow to be ready: first turns, follow-up turns, read-file approval, and
read-file continuation. This is deliberately stricter than `Direct text-only`.
The action-level fields still explain which sub-action is blocked.

Text/live gates:

```text
direct auth authenticated or refreshable
live text model evidence accepted/runtime_probed
direct_text_turn_empty_context@1 evidence for first turns
direct_text_turn_recent_dialogue@1 evidence for follow-ups
context/request store health
no active turn conflict
```

Read-only tool-loop gates:

```text
direct_obligations@1 projection healthy
tool_continuation_context@1 projection healthy
direct_readonly_tool_continuation@1 context policy available
read-only workspace backend healthy for selected project
accepted/runtime_probed provider tool-call shape evidence
accepted/runtime_probed local tool-result envelope evidence
accepted/runtime_probed continuation request-shape evidence
accepted/runtime_probed continuation stream normalizer evidence
store=false + previous_response_id + tool output item evidence
```

The read-only continuation evidence scope is exact:

```ts
type DirectReadOnlyContinuationEvidenceScope = {
  requestShapeClass: "direct_readonly_tool_continuation@1";
  model: string;
  endpointHash: string;
  accountEvidenceKey: string;
  providerCallType: "function_call" | "custom_tool_call";
  providerOutputType: "function_call_output" | "custom_tool_call_output";
  toolName: "read_file";
  namespacePolicy: "absent-only";
  toolCallShapeHash: string;
  toolResultEnvelopeShapeHash: string;
  continuationRequestShapeHash: string;
  continuationNormalizerVersion: string;
  requestBuilderVersion: string;
  redactionVersion: string;
  store: false;
  tools: false;
  previousResponseId: true;
};
```

Evidence for `function_call_output` does not prove `custom_tool_call_output`,
and evidence for one result envelope or request shape does not unlock another.

Missing read-only gates do not block `Direct text-only`. They block only
`Direct implementation lane`.

## Supported Tool

V0 supports only:

```ts
read_file({
  path: string; // project-relative path only
})
```

Accepted namespace policy:

```text
namespace absent only
```

Unsupported item-level states:

```text
unsupported_tool_name
unsupported_namespace
malformed_tool_arguments
missing_call_id
unsupported_provider_call_type
nested_tool_call
multiple_tool_calls_unsupported
sensitive_path_denied
```

Unsupported obligations are renderer-safe evidence. They do not make the whole
obligation projection blocked unless raw exposure or corrupt source evidence is
detected.

## Obligation UI

When a provider tool call is supported and the project is implementation-lane
selected, the turn enters:

```text
tool_waiting
```

The renderer shows a compact approval card in the left Codex lane:

```text
Read file
<renderer-safe relative path>
Approve  Decline
```

The card appears only after tool arguments are complete and parseable:

```text
tool_call_started / tool_call_delta:
  show "Collecting tool request..." if useful, with no action buttons

tool_call_completed + valid args:
  show approval card

tool_call_completed + invalid args:
  record unsupported obligation, with no action buttons
```

Rules:

- card text is renderer-safe and bounded;
- no absolute path, WSL path, auth material, raw backend frame, raw arguments
  payload, or raw request body appears in DOM/state/storage;
- action availability is a hint only;
- approval/decline/cancel goes through main-process controller revalidation;
- buttons are disabled while a decision or continuation is pending;
- stale action attempts fail with stable blocker codes.

Renderer action input:

```ts
type DirectReadOnlyToolDecisionInput = {
  projectId: string;
  projectGeneration: number;
  threadId: string;
  turnId: string;
  obligationId: string;
  clientToolDecisionId: string;
  actionTokenId?: string;
  action: "approve" | "decline" | "cancel";
  expectedTurnState: "tool_waiting" | "authority_waiting";
  expectedObligationDigest: string;
  expectedOperationLedgerHeadDigest?: string;
};
```

Action tokens are the preferred UI path:

```ts
type DirectReadOnlyToolActionToken = {
  tokenId: string;
  projectId: string;
  threadId: string;
  turnId: string;
  obligationId: string;
  action: "approve" | "decline" | "cancel";
  obligationDigest: string;
  operationLedgerHeadDigest: string;
  expiresAt: string;
};
```

The token is not authority by itself. Main must still revalidate project,
generation, runtime tier, turn state, obligation digest, ledger head, and
expiration.

Decision idempotency and conflict rules:

```text
same clientToolDecisionId + same obligation + same action:
  return existing decision/result/continuation snapshot

same clientToolDecisionId + different obligation:
  reject client_decision_id_conflict

same clientToolDecisionId + same obligation + different action:
  reject client_decision_id_conflict

different clientToolDecisionId after terminal decline/cancel/approve:
  reject terminal_decision_exists or return existing terminal snapshot

approve after decline/cancel:
  reject terminal_decision_exists

decline/cancel after result_recorded or continuation_sent:
  reject too_late_for_decision
```

## Local Authority And Workspace Read

Approval is not execution by itself. The main-process controller must:

```text
1. acquire decision lock for obligationId
2. verify project/thread/turn ownership
3. verify selected runtime is implementation-lane
4. verify turn state and obligation digest
5. verify no continuation already started
6. canonicalize and validate path is project-relative and within workspace policy
7. write tool_decision_committed event
8. execute exactly one workspace read
9. scan/redact/bound result for provider continuation
10. write tool_result_recorded artifact/event
```

The workspace backend remains the only file-read authority. The renderer never
provides a filesystem path. A sensitive path denial is local-terminal and is not
sent to the provider.

The workspace backend must canonicalize and realpath the requested relative path
under the canonical project workspace root before reading. Reject:

```text
absolute paths
drive-letter paths
UNC paths
WSL mirror paths
.. traversal
NUL/control characters
symlink escape outside workspace root
path normalization mismatch
```

Read result redaction:

```ts
type DirectToolResultRedaction = {
  scanned: true;
  scanVersion: string;
  status: "passed" | "blocked" | "redacted";
  categories?: Array<
    | "token"
    | "cookie"
    | "authorization-header"
    | "private-key"
    | "session-id"
    | "env-secret"
    | "unknown-secret"
  >;
};
```

`blocked` means no provider continuation. `redacted` may continue only with the
redacted preview if policy allows it.

Local-terminal result states are distinct:

```text
sensitive_path_denied
tool_result_redaction_blocked
tool_result_redacted_policy_disallowed
workspace_mismatch
raw_path_exposure_risk
backend_authority_failure
```

Only safe-to-send failures may become provider continuation envelopes:

```text
safe-to-send failure envelope:
  file_not_found
  decode_failed
  file_too_large_truncated_or_summarized

local-terminal failure:
  sensitive_path_denied
  redaction_blocked
  workspace_mismatch
  raw_path_exposure_risk
  backend_authority_failure
```

Provider tool output uses a structured, bounded envelope:

```json
{
  "kind": "read_file_result",
  "path": "src/example.ts",
  "textPreview": "...",
  "bytesRead": 12345,
  "truncated": false,
  "redacted": false,
  "encoding": "utf-8"
}
```

Default caps:

```ts
MAX_READ_FILE_BYTES = 384 * 1024;
MAX_PROVIDER_TOOL_OUTPUT_CHARS = 64 * 1024;
MAX_APPROVAL_CARD_PREVIEW_CHARS = 512;
MAX_RESULT_SUMMARY_CHARS = 2000;
```

Truncation and redaction must be explicit in the envelope. Truncated content is
never represented as complete.

## Continuation Context And Manifest

After a safe result is recorded:

```text
direct_obligations@1
  -> tool_continuation_context@1
  -> direct_context_pack@1
  -> provider input projection hash
  -> direct_request_manifest@1
  -> provider continuation transport
```

Continuation context authority:

```text
harness policy -> harness-policy
parent turn summary -> historical-dialogue-evidence
local authority decision -> status-evidence
bounded tool result -> tool-result-evidence
continuation intent -> status-evidence
```

The tool result is never current user intent, system policy, developer policy,
or local permission.

The continuation manifest records:

```ts
requestShapeClass: "direct_readonly_tool_continuation@1";
enabledFeatures: {
  store: false;
  tools: false; // alias for no tool declarations
  toolDeclarations: false;
  toolOutputItem: true;
  previousResponseId: true;
  reasoning: false;
  structuredOutput: false;
  serviceTier: false;
  promptCache: false;
  includes: false;
};
continuity: {
  previousResponseIdUsed: true;
  providerContinuityHandleUsed: true;
  importedContinuityHandleUsed: false;
  continuityPolicy: "parent_turn_tool_result_continuation";
};
contextPolicy: {
  policyId: "direct_readonly_tool_continuation@1";
  contextPolicyDigest: string;
  harnessPolicyDigest: string;
  roleMappingDigest: string;
};
previousResponse: {
  id: string;
  source: "native_direct_parent_initial_stream";
  sourceEventDigest: string;
  sourceTurnDigest: string;
  sourceRequestManifestId: string;
  importedContinuityHandleUsed: false;
};
```

`tools=false` means no tool declarations and no additional tool calls requested.
The input may still include exactly one accepted tool-output item paired to the
original provider `call_id`.

Continuation provider input must include the current
`direct_readonly_tool_continuation@1` harness policy and role mapping every
time. The function/custom output item is not enough; prior instructions are not
treated as automatically carried by provider continuity.

`previousResponseId` may come only from the native direct parent turn's initial
stream and must cite source event, source turn, and parent manifest evidence.
Imported provider ids are rejected. Missing proof fails with
`missing_native_parent_continuity`.

## Transport And Terminal Rules

Write order:

```text
1. local authority decision committed
2. workspace read result artifact written atomically
3. direct_obligations projection rebuilt/marked stale
4. tool_continuation_context projection written
5. context pack artifact written
6. context build row inserted
7. request manifest artifact written
8. request manifest row inserted
9. continuation_request_built event appended
10. continuation_sent marked immediately before transport handoff
11. continuation_stream_started when bytes/events observed
12. exactly one terminal event appended
```

Operation-ledger event names:

```text
tool_decision_committed
tool_result_recorded
tool_continuation_context_built
tool_continuation_request_built
tool_continuation_sent
tool_continuation_stream_started
tool_continuation_terminal
```

Each event cites ids and hashes, not raw payloads.

Retry policy:

```text
result_recorded with no continuation request:
  may rebuild context/manifest when idempotent

continuation_sent with no bytes:
  no automatic retry unless transport can prove request was not accepted

streaming_continuation:
  never retry
```

Terminal states:

```text
completed
declined
canceled
unsupported_tool
tool_result_redaction_failed
sensitive_path_denied
tool_result_redaction_blocked
tool_result_redacted_policy_disallowed
continuation_context_failed
continuation_request_failed
transport_handoff_unknown
response_incomplete
empty_continuation_output
nested_tool_call_unsupported
multiple_tool_calls_unsupported
```

Nested provider tool calls during continuation are terminal unsupported for v0.

If the parent response contains more than one provider tool call item before
terminal state, v0 marks the turn unsupported with
`multiple_tool_calls_unsupported`. No approval card appears, no workspace read
occurs, and no continuation is sent.

The composer is disabled while the selected direct turn is in:

```text
tool_waiting
authority_waiting
continuation_ready
continuation_sent
streaming_continuation
```

The user cannot submit another message in the same direct session until the tool
turn reaches a safe terminal state.

Final assistant text after continuation is appended inside the same turn:

```text
initial assistant/tool-call item
local obligation card/status item
tool-result status item
continuation assistant message item
terminal turn item
```

Do not create a second user turn or hidden "tool result user message."

## Direct Text-Only Interaction

If `Direct text-only` is selected:

```text
provider tool call -> tool_call_blocked_text_only
toolExecuted=false
continuationSent=false
approvalAvailable=false
```

The approval UI must not appear. Switching to implementation-lane for future
turns does not retroactively make a text-only blocked turn continuable.

## Runtime Status

Add action-level tool-loop status:

```ts
directImplementationLane: {
  selected: boolean;
  canSelect: boolean;
  canStartFirstTurn: boolean;
  canStartFollowupTurn: boolean;
  canShowObligations: boolean;
  canApproveReadFile: boolean;
  canBuildContinuationContext: boolean;
  canSendContinuation: boolean;
  blockers: string[];
  readOnlyToolLoop: {
    obligationProjectionHealthy: boolean;
    toolContextProjectionHealthy: boolean;
    workspaceReadHealthy: boolean;
    continuationEvidenceState:
      | "accepted"
      | "runtime_probed"
      | "missing"
      | "expired"
      | "candidate";
    activeObligationCount: number;
    pendingDecisionCount: number;
    streamingContinuationCount: number;
  };
};
```

Do not collapse this into the text-only status. A project can be text-only ready
while implementation-lane remains blocked.

Runtime selection is tier-specific and rollback-safe:

```text
selection commit writes a private previous-binding snapshot
renderer-safe audit summary is not the rollback source
rollback during active direct turn blocks in v0
old direct-experimental/live-text without directTier never migrates to implementation-lane
```

## Headless And Smoke Harness

Add a controlled headless scenario for the tool loop. It may use fake provider
SSE fixtures by default and real provider transport only with explicit live opt
in.

Recommended commands:

```text
scripts/codex-real-turn.mjs --runtime=direct --tier=implementation-lane --scenario=readonly-tool-fixture
scripts/codex-real-turn.mjs --runtime=direct --tier=implementation-lane --scenario=readonly-tool-live --allow-live-provider-call
```

Reports must include:

```ts
toolLoop: {
  obligationId: string;
  providerCallType: string;
  toolName: "read_file";
  namespace: "";
  decision: "approved" | "declined" | "canceled" | "unsupported";
  workspaceReadExecuted: boolean;
  resultArtifactId?: string;
  redactionStatus?: "passed" | "blocked" | "redacted";
  continuationContextProjectionId?: string;
  contextBuildId?: string;
  requestManifestId?: string;
  continuationTerminalState?: string;
  toolExecuted: boolean;
  continuationSent: boolean;
  continuationBytesObserved: boolean;
  autoRetried: false;
};
```

If continuation transport reaches `transport_handoff_unknown`, the report must
show:

```ts
providerRequestStarted: true;
continuationSent: true;
continuationBytesObserved: false;
terminalState: "transport_handoff_unknown";
autoRetried: false;
```

Live tool-loop scenarios require a separate live opt-in and never auto-probe:

```text
--allow-live-provider-call required for provider transport
CI=true requires CODEX_DIRECT_REAL_TURN_ALLOW_CI=1 as well
missing read-only continuation evidence blocks before transport
the runner must not auto-run a live probe and then continue
```

No raw file contents, raw paths, auth, request bodies, or provider frames are
written to normal reports.

## Renderer Safety

Scan these surfaces:

```text
serialized renderer state
approval card DOM attributes
transcript rows
operation/diagnostic panels
browser localStorage/sessionStorage
headless reports
handoff queue text
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

Install no-right-pane and no-handoff sentinels around every phase:

```text
runtime selection
composer submit
tool-call normalization
approval card rendering
approve/decline/cancel
workspace read
context build
manifest build
continuation transport
terminal handling
headless reports
```

## Implementation Order

### Phase -1 - Gate Law

- Split implementation-lane readiness from text-only readiness and expose
  action-level `canStartFirstTurn`, `canStartFollowupTurn`,
  `canApproveReadFile`, and `canSendContinuation`.
- Define exact read-only continuation evidence scope, including provider call
  type, output item type, namespace policy, result envelope shape, and
  request/normalizer/redaction versions.
- Add stable blocker codes for tool-loop gates.
- Make implementation-lane selection atomic, tier-specific, and rollback-safe
  with a private previous-binding snapshot.

### Phase 0 - Obligation Status

- Expose renderer-safe obligation cards from existing direct obligations.
- Show collecting-tool-request state with no buttons until arguments are
  complete and parseable.
- Add controller-authoritative approve/decline/cancel status and action-token
  issuance.
- Disable stale or non-authoritative renderer actions.

### Phase 1 - Approval And Read

- Validate supported read_file arguments.
- Route reads through workspace backend with realpath containment.
- Execute exactly once per approved obligation.
- Persist authority decision and bounded result artifact.
- Block sensitive or redaction-failed results locally.
- Classify safe-to-send read failures separately from local-terminal failures.

### Phase 2 - Continuation Context

- Build `tool_continuation_context@1`.
- Build context pack and request manifest before transport.
- Include exact previousResponseId source event, source turn, and parent
  manifest evidence from the native direct stream.
- Re-send current continuation harness policy and role mapping in provider input.
- Keep raw request body unpersisted.

### Phase 3 - Continuation Transport

- Send one provider continuation.
- Append final assistant text to the same turn.
- Handle nested tool calls, incomplete output, empty output, and sent-unknown
  states conservatively.

### Phase 4 - UI

- Make `Direct implementation lane` selectable only when gates pass.
- Show approval cards only for supported read-only obligations.
- Show text-only blocked tool calls without approval controls.
- Keep rollback to app-server visible and blocked while active direct turns run.

### Phase 5 - Smokes

- Text-only tool call remains terminal blocked.
- Implementation-lane read_file shows approval.
- Approve executes one workspace read and one continuation.
- Decline/cancel never execute workspace read or continuation.
- Unsupported/multiple/nested tool calls fail closed.
- Redaction-failed read result does not continue.
- No app-server spawn, right-pane mutation, or handoff mutation occurs.
- Headless live tool loop refuses CI/provider transport without explicit
  opt-in and never auto-probes missing evidence.

## Acceptance Criteria

- Implementation-lane readiness is separate from Direct text-only readiness.
- Implementation-lane status exposes action-level first-turn, follow-up,
  approval, and continuation readiness. V0 selection intentionally requires the
  full current implementation-lane text flow, including both empty-context and
  recent-dialogue evidence.
- `Direct implementation lane` cannot be selected unless read-only tool
  continuation gates pass.
- Read-only continuation evidence scope includes provider call type, output item
  type, tool name, namespace policy, tool-call shape hash, result-envelope hash,
  continuation request-shape hash, model, endpoint/account scope, and
  normalizer/request-builder/redaction versions.
- `tools=false` is clarified as no tool declarations; exactly one accepted
  tool-output item may still be included.
- Continuation provider input includes current harness policy/instructions and
  role mapping because `previous_response_id` is not treated as carrying prior
  instructions automatically.
- Text-only provider tool calls remain terminal blocked and never show approval
  controls.
- Implementation-lane provider `read_file` calls become renderer-safe
  obligations, not authority.
- Approval card appears only after complete, parseable tool arguments.
- Approval/decline/cancel actions are revalidated in main and idempotent by
  `clientToolDecisionId`.
- `clientToolDecisionId` conflict rules are defined for duplicate/different
  obligations, duplicate/different actions, terminal obligations, and too-late
  decisions.
- Only absent namespace and supported read_file arguments are accepted in v0.
- Multiple provider tool calls produce no approval UI and fail closed by
  default.
- Workspace read executes exactly once and only through the workspace backend.
- Backend realpath containment prevents symlink/workspace escape.
- Read result redaction runs before provider continuation.
- Sensitive-path denial, redaction-blocked, and redaction-policy-disallowed are
  distinct local-terminal states and are not sent to the provider.
- Read failures are classified as safe-to-send failure envelopes or
  local-terminal failures.
- Provider tool output uses a bounded structured envelope with truthful
  truncation/redaction fields.
- Continuation context pack and request manifest are durable before transport.
- Continuation manifest records `store=false`, no tool declarations,
  `previousResponseIdUsed=true`, and `importedContinuityHandleUsed=false`.
- `previousResponseId` proof includes native direct parent source event digest,
  source turn digest, and parent request manifest id, not imported state.
- Nested tool calls during continuation are terminal unsupported.
- Composer is disabled while a tool turn is waiting, reading,
  continuation-ready, continuation-sent, or streaming.
- Final assistant text after continuation is appended inside the same turn with
  stable item identity.
- `transport_handoff_unknown` reports continuationSent=true,
  bytesObserved=false, and autoRetried=false.
- Operation-ledger event names and required hash citations are defined.
- Implementation-lane runtime selection stores a private rollback snapshot and
  blocks rollback during active direct turns in v0.
- Headless live tool-loop scenario never auto-probes missing evidence and
  refuses CI live calls without an explicit CI override.
- `continuation_sent` and `streaming_continuation` are distinct and not
  auto-retried after bytes/events.
- Renderer and reports expose no raw paths, raw file contents, raw auth, raw
  backend frames, raw request bodies, or right-pane ChatGPT content.
- Tests prove no app-server fallback, no right-pane mutation, no handoff
  mutation, no write/shell/network tools, and no auto-approval.

## Final Meaning

Passing this bundle should mean:

```text
The Direct implementation lane can complete one human-approved read_file loop
inside a native direct Codex turn, with local authority, bounded evidence,
durable context/request artifacts, and no app-server fallback.
```

It should not mean:

```text
direct is production
direct is default
tools are generally enabled
write/shell/network/patch tools are supported
tool calls are provider authority
multiple tool calls are supported
text-only gates are weakened
right-pane ChatGPT is imported or controlled
app-server can be removed
```
