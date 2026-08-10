# Direct Text-Only Multi-Turn Recent Dialogue Spec

Status: draft implementation specification for the next direct-runtime UX and
context bundle on the long-lived `codex/direct-chatgpt-harness` branch.

Related docs:

- [DIRECT_TEXT_ONLY_RUNTIME_TIER_AND_TOGGLE_SPEC.md](./DIRECT_TEXT_ONLY_RUNTIME_TIER_AND_TOGGLE_SPEC.md)
- [DIRECT_HEADLESS_RUNTIME_PARITY_HARNESS_SPEC.md](./DIRECT_HEADLESS_RUNTIME_PARITY_HARNESS_SPEC.md)
- [DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md](./DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md)
- [DIRECT_RENDERER_TRANSCRIPT_PROJECTION_SPEC.md](./DIRECT_RENDERER_TRANSCRIPT_PROJECTION_SPEC.md)
- [DIRECT_THREAD_LOG_AND_PROJECTION_STORE_SPEC.md](./DIRECT_THREAD_LOG_AND_PROJECTION_STORE_SPEC.md)
- [DIRECT_LIVE_TEXT_TURN_SURFACE_SPEC.md](./DIRECT_LIVE_TEXT_TURN_SURFACE_SPEC.md)
- [DIRECT_LIVE_PROBE_EVIDENCE_PROMOTION_SPEC.md](./DIRECT_LIVE_PROBE_EVIDENCE_PROMOTION_SPEC.md)
- [DIRECT_READONLY_TOOL_CONTINUATION_SPEC.md](./DIRECT_READONLY_TOOL_CONTINUATION_SPEC.md)

## Purpose

Enable real multi-turn use of the Direct text-only tier.

The previous bundle made this selectable:

```text
App-server
Direct text-only
Direct implementation lane
```

Its UI turn shape was intentionally narrow:

```text
new direct-native thread/session
empty-context policy
one live text turn
fresh provider request
```

That is enough to prove the direct path, but not enough for practical use. The
next logical step is:

```text
existing direct-native text-only thread
  -> valid renderer_transcript@1
  -> context_recent_dialogue@1
  -> direct_context_pack@1
  -> direct_request_manifest@1
  -> fresh provider request
```

The user experience should feel like normal chat follow-up in the left Codex
lane, while the implementation remains strict about authority:

```text
local transcript evidence != provider continuity
multi-turn direct text-only != tools
recent-dialogue context != canonical rollout truth
```

## Core Invariant

```text
direct text-only multi-turn uses local quoted evidence
direct text-only multi-turn does not use provider conversation continuity
```

Every follow-up turn is a fresh provider request:

```text
store=false
tools=false
previousResponseIdUsed=false
providerContinuityHandleUsed=false
importedContinuityHandleUsed=false
```

Historical transcript text may be quoted into the new request through
`context_recent_dialogue@1`, but it never becomes current system/developer
policy, local tool authority, workspace permission, or provider-side memory.

## Boundary

This bundle does:

- allow a Direct text-only selected project to continue an existing
  direct-native text-only thread;
- build or resolve current `renderer_transcript@1` for the source thread;
- build or resolve `context_recent_dialogue@1` from the current valid renderer
  transcript;
- build a context pack and request manifest before every follow-up transport;
- keep follow-up requests fresh, with no `previous_response_id`;
- persist source projection ids/digests into the turn request evidence;
- re-check text-only gates immediately before every follow-up transport;
- expose safe UI state for thread composer availability;
- keep provider tool calls terminally blocked in text-only;
- add headless and UI smoke coverage for second-turn direct text-only.

It does not:

- enable read-only tool continuation;
- enable write/shell/network/browser/MCP/patch tools;
- make implementation-lane activation easier;
- use source provider `previous_response_id`;
- continue imported transcripts as provider state;
- make compact projections usable as context;
- make merge/prune/fork previews runnable;
- mutate right-pane ChatGPT;
- spawn or fall back to app-server inside direct;
- make production `direct` available.

## Terms

```ts
type DirectTextOnlyThreadContinuityMode =
  | "fresh-empty-context"
  | "fresh-recent-dialogue";
```

`fresh-empty-context` is the first-turn path from the previous bundle.

`fresh-recent-dialogue` is the new follow-up path. It is "fresh" because it
does not use provider continuity. It is "recent-dialogue" because local
renderer-safe transcript evidence is selected into a context projection and
quoted into the prompt.

```ts
type DirectTextOnlyThreadComposerState =
  | "enabled_empty_context"
  | "enabled_recent_dialogue"
  | "disabled_active_turn"
  | "disabled_projection_rebuilding"
  | "disabled_projection_stale"
  | "disabled_projection_blocked"
  | "disabled_previous_turn_not_safe"
  | "disabled_tool_call_blocked"
  | "disabled_transport_handoff_unknown"
  | "disabled_store_unhealthy"
  | "disabled_auth_or_evidence";
```

The renderer may display this state, but the main-process controller remains
the authority for turn start.

## Eligibility

Follow-up Direct text-only turns are allowed only when all hard gates pass.

### Runtime Gates

- selected project runtime is `direct-experimental/text-only/live-text`;
- selected runtime digest matches the renderer request;
- project generation is current;
- no direct runtime selection/rollback mutation is pending;
- no active turn exists in the target direct thread;
- no active direct turn conflicts with current project concurrency policy;
- app-server fallback is disabled for this direct turn.

### Thread Gates

The target thread must be a direct-native text-only thread:

```text
runtimeMode = direct-experimental
directTier = text-only
directTransport = live-text
sourceClass = direct-native
```

Allowed source state:

```text
last turn completed
no unresolved executable obligation
no active continuation
no interrupted stream
no transport_handoff_unknown
no tool_call_blocked_text_only as the latest turn
```

For v0, follow-up is blocked after these terminal states:

```text
failed
aborted
tool_call_blocked_text_only
transport_handoff_unknown
response_incomplete
content_filter_terminal
max_output_terminal
empty_output_terminal
checkpoint_required
```

Those states need a later repair/retry policy. The user may start a new fresh
Direct text-only thread instead.

### Auth And Evidence Gates

- direct auth is authenticated or refresh succeeds before final evaluation;
- selected model has accepted/runtime-probed evidence for
  `direct_text_turn_recent_dialogue@1`;
- evidence scope matches model, endpoint/account, `store=false`, `tools=false`,
  no `previous_response_id`, role mapping, harness policy, and stream
  normalizer policy;
- evidence for `direct_text_turn_empty_context@1` alone does not unlock
  recent-dialogue follow-up;
- candidate or diagnostic-no-promotion evidence cannot enable follow-up.

The accepted/runtime-probed evidence scope is exact:

```ts
type DirectRecentDialogueEvidenceScope = {
  requestShapeClass: "direct_text_turn_recent_dialogue@1";
  model: string;
  endpointHash: string;
  accountEvidenceKey: string;
  store: false;
  tools: false;
  previousResponseId: false;
  contextPolicyId: "direct_text_turn_recent_dialogue@1";
  contextPolicyDigest: string;
  harnessPolicyDigest: string;
  roleMappingDigest: string;
  requestBuilderVersion: string;
  normalizerVersion: string;
  redactionVersion: string;
};
```

Evidence under one harness policy, role mapping, request builder, normalizer,
or redaction version does not unlock another.

### Store And Projection Gates

- direct session store is healthy;
- direct thread/projection store is healthy for renderer/context projection
  rebuilds;
- current renderer transcript projection exists or can be rebuilt;
- renderer transcript projection status is `valid`;
- renderer transcript projection has `unsafeForRenderer=false`;
- context projection can be built from the valid renderer projection;
- context projection has `unsafeForContextBuild=false`;
- context policy registry has `direct_text_turn_recent_dialogue@1`;
- context pack artifact root and request manifest artifact root are writable.

Pointer resolution is kind-specific:

```text
use current_renderer_projection_id for renderer_transcript@1
use current_context_recent_dialogue_projection_id for context_recent_dialogue@1
never use current_compact_projection_id
never use last_projection_attempt_id
blocked/failed projection attempts do not replace current valid pointers
```

Old direct threads are not upgraded implicitly. Follow-up is blocked when the
thread or previous turn is missing required direct text-only artifacts:

```text
direct_thread_schema_too_old
missing_required_turn_artifacts
missing_previous_request_manifest
missing_previous_context_pack
```

Do not use:

```text
current_compact_projection_id
stale renderer projections
blocked projections
last projection attempts
raw session JSON
raw rollout frames
raw imported JSONL
```

## Context Law

Follow-up context must be built through the existing context policy chain:

```text
renderer_transcript@1
  -> context_recent_dialogue@1
  -> direct_context_pack@1
  -> provider input projection hash
  -> direct_request_manifest@1
```

Rules:

- source user and assistant messages are quoted historical evidence;
- source system/developer/runtime policy is excluded;
- source diagnostic rows are excluded by default;
- raw reasoning is never stored or included;
- source tool calls and tool results are excluded in text-only v0;
- source approval decisions are excluded as authority;
- omission and truncation counts are recorded honestly;
- current user prompt is first-class current user intent;
- harness policy is first-class current policy and is resent every request;
- role mapping is explicit and cited by digest;
- raw request body is not persisted.

Context authority is machine-checkable:

```ts
type ContextMessageAuthority =
  | "harness-policy"
  | "current-user-intent"
  | "historical-dialogue-evidence"
  | "status-evidence";
```

For `direct_text_turn_recent_dialogue@1`:

```text
projected user/assistant messages -> historical-dialogue-evidence
current prompt -> current-user-intent
harness policy -> harness-policy
omission/truncation/rebuild status -> status-evidence
```

Provider input projection for every follow-up must include the current harness
policy message. The request must be self-contained because provider continuity
is off.

If a provider stream contains a reasoning delta or raw reasoning item:

```text
raw reasoning content is not stored, rendered, or included in context
only a renderer-safe omitted-count/status event may be persisted when policy allows
recent-dialogue evidence is not promoted unless reasoning handling is accepted
  for this exact request shape
```

Follow-up caps:

```ts
const MAX_RECENT_DIALOGUE_MESSAGES = 80;
const MAX_RECENT_DIALOGUE_CONTEXT_CHARS = 96 * 1024;
const MAX_RECENT_DIALOGUE_ITEM_CHARS = 16 * 1024;
const MAX_CURRENT_USER_PROMPT_CHARS = 64 * 1024;
```

Current user prompt over cap blocks and asks the user to shorten. Historical
context over cap may use only policy-approved recent-window or head/tail
truncation with honest omitted counts. If omissions cannot be represented
truthfully, the build blocks.

Every context build records budget accounting:

```ts
budget: {
  estimatedInputTokens?: number;
  modelContextWindowEstimate?: number;
  reservedOutputTokens?: number;
  budgetPolicyId: string;
  budgetExceeded: boolean;
};
```

If the budget is exceeded, the controller blocks or rebuilds with approved
truncation. It never silently sends an over-budget context.

The context source digest is canonical:

```ts
contextRecentDialogueSourceDigest = hash(canonicalJson({
  schema: "direct_text_only_recent_dialogue_source@1",
  projectId,
  threadId,
  rendererProjectionId,
  rendererProjectionDigest,
  rendererProjectionVersion,
  contextProjectionId,
  contextProjectionDigest,
  selectedStableSourceItemKeys,
  selectedItemTextDigests,
  operationLedgerHeadDigest,
  policyDigest,
  harnessPolicyDigest,
  roleMappingDigest,
  builderVersion,
  redactionVersion,
  caps,
}));
```

Do not include build timestamps, projection ids for the projection being built,
raw text bodies beyond already stored text digests, raw auth, raw request
bodies, or raw filesystem paths.

## Turn Start Contract

Add a follow-up turn input:

```ts
type DirectTextOnlyFollowupTurnStartInput = {
  projectId: string;
  projectGeneration: number;
  threadId: string;
  selectedRuntimeDigest: string;
  expectedOperationLedgerHeadDigest?: string;
  expectedPreviousTurnId: string;
  expectedPreviousTurnDigest: string;
  expectedNextTurnOrdinal: number;
  expectedRendererProjectionId: string;
  expectedRendererProjectionDigest: string;
  expectedContextProjectionId?: string;
  expectedContextProjectionDigest?: string;
  clientTurnRequestId: string;
  promptText: string;
};
```

Idempotency:

```text
same clientTurnRequestId + same threadId + same prompt digest + same runtime
digest + same source projection digest + same expected previous turn:
  return existing turn status

same clientTurnRequestId + different prompt/runtime/source digest/previous turn:
  reject conflict

previous run observed provider bytes/events:
  never auto-rerun under the same id
```

UI follow-up from a displayed transcript must pass expected projection
ids/digests and previous-turn id/digest. Headless or recovery paths may omit
projection ids, but the controller must resolve current kind-specific pointers
and record the resolved ids/digests in the result.

If `expectedOperationLedgerHeadDigest` is present and the ledger head changed
after the UI displayed the transcript, the controller must either rebuild and
revalidate the source projections or fail with:

```text
operation_ledger_changed
```

## Durable Write Order

Follow-up turn start must be crash-recoverable:

```text
1. acquire per-thread turn-start lock
2. validate project generation and selected runtime digest
3. validate direct text-only gates
4. validate target thread state and no active turn
5. resolve/rebuild current renderer_transcript@1
6. resolve/rebuild context_recent_dialogue@1
7. revalidate source projection ids/digests
8. create current user prompt artifact
9. create turn record
10. write context pack artifact atomically
11. insert context build row
12. re-read current source projection pointers/digests
13. fail if source refs differ from the context pack source refs
14. write request manifest artifact atomically
15. insert request manifest row
16. append request_built rollout evidence citing ids and hashes
17. mark turn request_built
18. start provider transport
19. append stream/terminal evidence
```

If a source projection changes between context build and request build:

```text
fail before transport
turn state = failed
error.code = source_projection_changed
```

If context pack exists but no `request_built`:

```text
recovery = orphan_context_pack_pre_transport
providerRequestStarted = false
```

If `request_built` exists but no bytes were observed:

```text
turn state = transport_handoff_unknown
no automatic retry
```

## Request Manifest

Every follow-up manifest must record:

```ts
requestShapeClass: "direct_text_turn_recent_dialogue@1";
enabledFeatures: {
  store: false;
  tools: false;
  previousResponseId: false;
  reasoning: false;
  structuredOutput: false;
  serviceTier: false;
  promptCache: false;
  includes: false;
};
continuity: {
  previousResponseIdUsed: false;
  providerContinuityHandleUsed: false;
  importedContinuityHandleUsed: false;
  continuityPolicy: "fresh_request_with_quoted_recent_dialogue";
};
sourceProjections: [{
  projectionKind: "renderer_transcript@1" | "context_recent_dialogue@1";
  projectionId: string;
  projectionDigest: string;
}];
```

`direct_text_turn_recent_dialogue@1` evidence is separate from:

```text
direct_text_turn_empty_context@1
direct_readonly_tool_continuation@1
direct_fork_start_live_text@1
direct_derived_preview_fork_start_live_text@1
```

## UI Contract

When Direct text-only is selected:

- first prompt creates a new direct-native text-only thread using empty context;
- follow-up prompt in that thread uses recent-dialogue context;
- the composer status strip says `Codex: Direct text-only`;
- thread detail shows whether follow-up context is ready, rebuilding, stale, or
  blocked;
- implementation-lane affordances remain separate and blocked unless stricter
  gates pass;
- provider tool calls still show terminal blocked text-only state;
- no approval UI appears in text-only;
- right-pane ChatGPT remains untouched.

The compact status strip should make fresh local continuation explicit:

```text
Codex: Direct text-only · recent dialogue
```

The detail/status panel should show:

```text
Context source: local transcript projection
Provider continuity: off
```

While renderer/context projection rebuild is in progress:

```text
selectedThreadComposerState = disabled_projection_rebuilding
```

Composer submit is disabled for v0. Queueing a prompt during rebuild is
deferred to a later policy because it is ambiguous which transcript the user
intended to continue from.

If follow-up is blocked, the UI should show stable reasons:

```text
renderer_projection_missing
renderer_projection_stale
renderer_projection_blocked
context_projection_failed
context_policy_missing
source_projection_changed
previous_turn_not_safe
active_direct_turn_exists
direct_auth_missing
live_text_recent_dialogue_evidence_missing
request_shape_evidence_expired
model_scope_mismatch
runtime_selection_stale
transport_handoff_unknown
tool_call_blocked_text_only
projection_rebuild_unavailable
projection_rebuild_in_progress
context_projection_unsafe
```

## Runtime Status

Extend Direct text-only status with:

```ts
directTextOnly: {
  canStartEmptyContextTurn: boolean;
  canStartRecentDialogueTurn: boolean;
  selectedThreadComposerState?: DirectTextOnlyThreadComposerState;
  selectedThread?: {
    threadId: string;
    lastTurnId?: string;
    lastTurnTerminalKind?:
      | "completed"
      | "failed"
      | "aborted"
      | "tool_call_blocked_text_only"
      | "transport_handoff_unknown"
      | "response_incomplete"
      | "content_filter_terminal"
      | "max_output_terminal"
      | "empty_output"
      | "checkpoint_required";
  };
  recentDialogue: {
    requestShapeEvidenceState: "accepted" | "runtime_probed" | "missing" | "expired" | "candidate";
    rendererProjectionStatus?: string;
    contextProjectionStatus?: string;
    sourceDigest?: string;
    blockerCodes: string[];
  };
};
```

Do not use a single `turnRunnable` flag for both first turn and follow-up. A
project may be ready for empty-context first turns while recent-dialogue
evidence or projections are still missing.

## Provider Tool Calls

Provider tool calls remain terminal in Direct text-only:

```text
turn terminal = tool_call_blocked_text_only
toolExecuted = false
continuationSent = false
approvalAvailable = false
```

After this state, follow-up in the same thread is disabled for v0:

```text
selectedThreadComposerState = disabled_tool_call_blocked
```

The user may start a new fresh Direct text-only thread or switch to a future
implementation-lane flow after the proper tool gates pass.

## Headless Harness

Extend the real-turn harness with a strict two-turn mode:

```text
scripts/codex-real-turn.mjs --runtime=direct --new-thread --context-policy=direct_text_turn_empty_context@1
scripts/codex-real-turn.mjs --runtime=direct --thread-id=<created thread> --context-policy=direct_text_turn_recent_dialogue@1
scripts/codex-real-turn.mjs --runtime=direct --from-report=<first-run-report.json> --context-policy=direct_text_turn_recent_dialogue@1
```

The second command requires:

- explicit live provider opt-in;
- valid direct auth;
- accepted/runtime-probed recent-dialogue request-shape evidence;
- source renderer/context projections;
- no `previous_response_id`.

The parity report should compare operational behavior, not assistant text
equality.

First-turn reports should provide machine-readable continuation data:

```json
{
  "createdThreadId": "direct_thread_...",
  "createdSessionId": "direct_session_...",
  "lastTurnId": "direct_turn_...",
  "nextRecommendedCommand": "scripts/codex-real-turn.mjs --runtime=direct --from-report=..."
}
```

Two-turn reports should prove the request-shape boundary:

```ts
twoTurnReport: {
  firstTurn: {
    requestShapeClass: "direct_text_turn_empty_context@1";
    contextBuildId: string;
    requestManifestId: string;
    terminalState: string;
  };
  secondTurn: {
    requestShapeClass: "direct_text_turn_recent_dialogue@1";
    rendererProjectionId: string;
    rendererProjectionDigest: string;
    contextProjectionId: string;
    contextProjectionDigest: string;
    contextBuildId: string;
    requestManifestId: string;
    terminalState: string;
  };
};
```

## Renderer Safety

Renderer state must not expose:

- raw context pack text;
- raw request manifest bodies;
- raw provider request bodies;
- raw provider stream frames;
- raw auth;
- raw workspace paths;
- raw source hashes;
- raw imported JSONL;
- raw ChatGPT URLs;
- raw reasoning.

Renderer-safe allowed fields:

- thread id;
- projection ids and digests;
- context build id;
- request manifest id;
- truncation/omission counts;
- status and blocker codes;
- bounded assistant text preview;
- normalized event type names.

## Tests And Smokes

Add or update tests for:

- first direct text-only turn still uses `direct_text_turn_empty_context@1`;
- second direct text-only turn in same thread uses
  `direct_text_turn_recent_dialogue@1`;
- recent-dialogue evidence is required separately from empty-context evidence;
- follow-up fails when renderer transcript projection is stale/blocked/unsafe;
- follow-up rebuilds renderer/context projections when safe;
- source projection digest changing before request build blocks transport;
- operation ledger head changes before submit block or force safe rebuild;
- expected previous turn id/digest mismatch blocks transport;
- request manifest records `store=false`, `tools=false`, and no provider
  continuity;
- provider input is generated from context pack and manifest only;
- provider input projection includes the current harness policy for follow-up;
- raw reasoning never appears in context, manifest, report, or renderer rows;
- reasoning events are omitted safely and do not promote evidence unless
  accepted for this exact shape;
- compact projection cannot be used as follow-up context;
- follow-up is blocked on old direct threads missing context/request artifacts;
- follow-up is disabled during projection rebuild;
- follow-up is blocked after response_incomplete, content-filter, max-output,
  or empty-output terminal states;
- provider tool call disables same-thread follow-up in text-only;
- `transport_handoff_unknown` disables same-thread follow-up and does not
  auto-retry;
- `--from-report` headless second turn uses the first report's created thread
  id and last turn id;
- app-server is not spawned during projection rebuild, context build, request
  manifest build, direct follow-up transport, or terminal processing;
- right-pane ChatGPT and handoff queues are not mutated during projection
  rebuild, context build, request manifest build, transport, or terminal
  processing.

## Implementation Order

### Phase -1 - Law And Evidence

- Define `direct_text_turn_recent_dialogue@1` UI/headless evidence gate.
- Include context policy digest, harness policy digest, role mapping digest,
  request builder version, normalizer version, and redaction version in the
  recent-dialogue evidence scope.
- Add text-only follow-up blocker codes.
- Split empty-context and recent-dialogue readiness in runtime status.
- Define safe and unsafe previous-turn terminal states.
- Add old-thread rejection blockers.

### Phase 0 - Projection Resolution

- Resolve current renderer projection by kind.
- Use only kind-specific current projection pointers.
- Rebuild renderer transcript projection when safe.
- Build/resolve `context_recent_dialogue@1`.
- Revalidate operation ledger head and source projection ids/digests before
  context/request build.

### Phase 1 - Turn Start

- Add follow-up turn input and idempotency.
- Add expected previous turn id/digest and expected next turn ordinal.
- Add per-thread turn-start lock.
- Persist prompt/context/request artifacts before transport.
- Revalidate source projection after context pack write and before request
  manifest write.
- Force `useRecentDialogue=true` only for safe follow-up turns.

### Phase 2 - UI

- Keep selected direct text-only thread open after completed first turn.
- Show follow-up context readiness.
- Disable composer while projection rebuild is in progress.
- Disable composer for unsafe previous states.
- Keep implementation-lane controls separate.

### Phase 3 - Headless

- Add two-turn direct text-only harness command or scenario.
- Emit redacted report with both turn manifests and projection refs.
- Add `--from-report` support.

### Phase 4 - Recovery And Smokes

- Orphan context pack recovery.
- Source projection changed recovery.
- Transport handoff unknown.
- Tool-call blocked terminal.
- Raw-exposure scans.

## Acceptance Criteria

- Direct text-only supports a second prompt in an existing direct-native
  text-only thread when the previous turn completed safely.
- The follow-up request uses `direct_text_turn_recent_dialogue@1`.
- Recent-dialogue evidence scope includes context policy digest, harness policy
  digest, role mapping digest, request builder version, normalizer version, and
  redaction version.
- Empty-context evidence does not unlock recent-dialogue follow-up.
- Follow-up uses local quoted transcript evidence, not provider
  `previous_response_id`.
- Follow-up context is built only from valid renderer/context projections.
- UI follow-up from a displayed transcript passes expected source projection
  ids/digests, expected previous turn id/digest, and expected next turn ordinal.
- Operation ledger head changes are detected before context/request build.
- Source projection is revalidated after context pack write and before request
  manifest write.
- Context messages use an authority enum: harness-policy, current-user-intent,
  historical-dialogue-evidence, and status-evidence.
- Harness policy is present in the actual provider input projection for every
  follow-up.
- Compact projections, stale projections, blocked projections, and raw session
  files are not used as context.
- Recent-dialogue caps and budget estimates are recorded; over-budget context
  blocks or rebuilds with explicit truncation.
- Every follow-up writes context pack and request manifest before transport.
- Request manifests record `store=false`, `tools=false`, and all continuity
  handles unused.
- Turn start revalidates auth/evidence/store/projection gates immediately
  before transport.
- Response incomplete, content-filter terminal, max-output terminal, and
  empty-output terminal states disable same-thread follow-up in v0.
- `disabled_projection_rebuilding` exists and composer submit is disabled while
  projection rebuild is in progress.
- Old direct threads missing required context/request artifacts are rejected
  rather than upgraded implicitly.
- Provider tool calls remain terminally blocked and disable same-thread
  follow-up in text-only.
- `transport_handoff_unknown` is represented and never retried automatically.
- UI status distinguishes empty-context readiness from recent-dialogue
  follow-up readiness.
- Headless two-turn reports include both turn manifests, projection refs,
  terminal states, and a machine-readable created thread id.
- Tests prove no app-server spawn, no right-pane ChatGPT mutation, no handoff
  mutation, no tool execution, and no raw context/request exposure.

## Final Meaning

Passing this bundle should mean:

```text
Direct text-only can be used as a real multi-turn text chat in the left Codex
lane, with every follow-up request built from auditable local recent-dialogue
context and no provider continuity.
```

It should not mean:

```text
tools are enabled
implementation-lane direct is enabled
provider previous_response_id is used
compact projections are context
failed/tool-blocked/interrupted threads are repairable
right-pane ChatGPT is imported or controlled
app-server can be removed
direct is production
```
