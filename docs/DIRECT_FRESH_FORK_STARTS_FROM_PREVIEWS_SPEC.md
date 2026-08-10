# Direct Fresh Fork Starts From Previews Spec

Status: draft PR 7 implementation specification for the long-lived
`codex/direct-chatgpt-harness` branch.

Related docs:

- [CODEX_DIRECT_HARNESS_ODEU_MATRIX_v0_2.md](./CODEX_DIRECT_HARNESS_ODEU_MATRIX_v0_2.md)
- [CODEX_DIRECT_HARNESS_PR_AFFINITY_BUNDLES_v0.md](./CODEX_DIRECT_HARNESS_PR_AFFINITY_BUNDLES_v0.md)
- [DIRECT_THREAD_EVIDENCE_WORKBENCH_AND_DERIVED_VIEWS_SPEC.md](./DIRECT_THREAD_EVIDENCE_WORKBENCH_AND_DERIVED_VIEWS_SPEC.md)
- [DIRECT_FORK_PREVIEW_START_SPEC.md](./DIRECT_FORK_PREVIEW_START_SPEC.md)
- [DIRECT_DERIVED_PREVIEW_FORK_START_SPEC.md](./DIRECT_DERIVED_PREVIEW_FORK_START_SPEC.md)
- [DIRECT_THREAD_LOG_AND_PROJECTION_STORE_SPEC.md](./DIRECT_THREAD_LOG_AND_PROJECTION_STORE_SPEC.md)
- [DIRECT_RENDERER_TRANSCRIPT_PROJECTION_SPEC.md](./DIRECT_RENDERER_TRANSCRIPT_PROJECTION_SPEC.md)
- [DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md](./DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md)
- [DIRECT_TEXT_ONLY_RUNTIME_TIER_AND_TOGGLE_SPEC.md](./DIRECT_TEXT_ONLY_RUNTIME_TIER_AND_TOGGLE_SPEC.md)
- [DIRECT_REAL_USAGE_STABILIZATION_AND_HEADLESS_REGRESSION_SPEC.md](./DIRECT_REAL_USAGE_STABILIZATION_AND_HEADLESS_REGRESSION_SPEC.md)

## Verdict

This is the next PR after the thread evidence workbench bundle.

PR 6 deliberately made thread evidence usable but non-runnable:

```text
direct/imported thread evidence
  -> lifecycle and graph projections
  -> merge/prune/fork previews
  -> renderer-safe non-runnable workbench
```

PR 7 is the controlled crossing from preview evidence to one new runtime
session:

```text
valid preview
  -> fresh fork seed
  -> new direct-native session/thread
  -> first direct text turn
  -> context pack
  -> request manifest
  -> fresh provider request
```

This PR does not resume a provider conversation. It starts a new one from
quoted, renderer-safe source evidence.

## Matrix Scope

Rows:

```text
G8
G9
B1-B3
C8-C10
D18
parts of F8/F10
```

This PR moves preview start authority forward only for fresh direct-native
forks. It does not promote implementation-lane tool authority, context
maintenance, durable memory, governance, semantic broker routing, or sub-agent
observability.

## Core Law

```text
preview evidence != provider continuity
fresh fork != source session resume
derived preview != canonical rollout truth
fork seed != source transcript import
source tool result != action authority
source approval != fork approval
source previous_response_id != fork previous_response_id
renderer preview selection != runtime authority
lineage edge != provider continuity
```

The source preview may provide quoted historical evidence. The forked session is
a new direct-native runtime entity with its own session, turn, context pack,
request manifest, response ids, operation ledger rows, and recovery state.

## Product Boundary

Good:

```text
left/middle Codex lane only
fresh direct-native session from selected preview
direct fork preview source
merge preview source
prune preview source
explicit user action
confirmation token
new session/thread/turn artifacts
seed/context/manifest before provider transport
lineage edges to source preview and source threads
renderer-safe status and operation history
no provider continuity from source
```

Not included:

```text
provider previous_response_id from source
source provider response id reuse
merge materialization into canonical rollout
prune materialization or deletion
right-pane ChatGPT transcript import
right-pane ChatGPT mutation
handoff mutation
app-server fallback
implementation-lane tools in the new first turn
source tool/approval replay
auto-approval
manual resume after handoff unknown
cross-project fork starts
hard purge/delete
```

## Existing Substrate

PR 7 should reuse and harden the existing direct thread workbench substrate:

```text
DirectThreadStore
renderer transcript projections
merge/prune/fork preview projections
direct thread graph edges
direct operation ledger
context pack builder
request manifest builder
direct live-text runtime gate
runtime status/readiness evidence
PR 6 evidence-workbench projection and raw-exposure scanner
```

The older split specs for direct fork previews and derived preview fork starts
remain useful design references. This document is the controlling PR 7 scope:
one fresh fork-start bundle covering direct, merge, and prune preview sources
with one shared authority model.

## Supported Source Kinds

V0 supports these preview sources:

```text
fork_preview@1
merge_preview@1
prune_preview@1
```

Source behavior:

```text
fork_preview@1:
  source evidence comes from selected stable source items from one direct
  renderer transcript projection.

merge_preview@1:
  source evidence comes from a renderer-safe arrangement of multiple source
  projections. It does not create a merged rollout.

prune_preview@1:
  source evidence comes from a renderer-safe omission view. Omission markers
  must be preserved in the fork seed.
```

The three source kinds share one fresh-fork authority model, but they do not
share proof:

```ts
type DirectFreshForkRequestShapeClass =
  | "direct_fork_preview_start_live_text@1"
  | "direct_merge_preview_start_live_text@1"
  | "direct_prune_preview_start_live_text@1";

type DirectFreshForkSeedPolicyId =
  | "direct_fresh_fork_from_fork_preview@1"
  | "direct_fresh_fork_from_merge_preview@1"
  | "direct_fresh_fork_from_prune_preview@1";
```

Evidence for `fork_preview@1` does not unlock merge/prune starts. Evidence for
`merge_preview@1` does not unlock prune starts. Prune starts must prove omission
semantics and omission marker preservation.

Out of scope:

```text
fork preview sourced from another derived preview
derived preview sourced from imported right-pane ChatGPT transcript content
cross-project source previews
external ref as direct fork source
legacy provider conversation continuity
```

## Route Law

The route is explicit:

```text
preview projection
  -> direct_fresh_fork_start_plan@1
  -> direct_fresh_fork_start_confirmation@1
  -> direct_fresh_fork_seed@1
  -> new direct thread/session/turn
  -> direct_context_pack@1
  -> direct_request_manifest@1
  -> fresh provider request
```

The route is not:

```text
preview projection -> provider request
preview projection -> source previous_response_id
preview projection -> direct context pack without seed
merge preview -> materialized canonical thread
prune preview -> deleted source spans
```

## Eligibility

A fresh fork start is eligible only when all are true:

```text
project id matches selected project
project generation matches
workbench revision matches
operation ledger head matches
UI projection generation/source digest matches or is refreshed
thread store health permits mutations
no active conflicting direct turn exists
source preview exists in the selected project
source preview kind is supported
source preview status is valid
source preview is not stale, blocked, failed, unsafe, or superseded
source preview raw-exposure flags are clean
source preview explicitly says providerContinuityAvailable=false
source preview explicitly says usableForContextBuild=false
source renderer projection refs still exist and match captured digests
source thread lifecycle states are allowed
source threads have no nonterminal turn newer than captured projection digest
direct text runtime is explicitly enabled for this project/action
auth/model/endpoint/request-shape evidence is accepted or runtime-probed
fork-start request-shape evidence is exact for the selected source kind
current user intent is present, bounded, and redaction-clean
continuity-misleading user intent has shown a fresh-session warning
confirmation token is fresh
```

If any eligibility fact is missing or stale:

```text
no session is created
no context pack is built
no request manifest is built
no provider transport starts
```

## Preview Source Proof

Every fresh fork start plan must cite source proof:

```ts
type DirectFreshForkSourceProof = {
  schema: "direct_fresh_fork_source_proof@1";
  projectId: string;
  sourcePreviewId: string;
  sourcePreviewKind: "fork_preview" | "merge_preview" | "prune_preview";
  sourcePreviewVersion: string;
  sourcePreviewBuilderVersion: string;
  previewPolicyDigest: string;
  sourcePreviewDigest: string;
  sourcePreviewProjectionId: string;
  sourcePreviewProjectionDigest: string;
  sourcePreviewOperationId: string;
  sourcePreviewOperationMissingReason?: "migrated_legacy_preview";
  workbenchRevision: string;
  operationLedgerHeadDigest: string;
  sourceRendererProjectionRefs: Array<{
    threadId: string;
    projectionId: string;
    projectionDigest: string;
    lifecycleState: "active" | "hidden" | "archived" | "soft_deleted";
  }>;
  sourceLifecyclePolicy: {
    allowActive: true;
    allowHidden: true;
    allowArchived: true;
    allowSoftDeleted: false;
  };
  stableSourceItemKeys: string[];
  sourceDigest: string;
  rawPathIncluded: false;
  rawChatGptUrlIncluded: false;
  providerContinuityAvailable: false;
  usableForContextBuild: false;
};
```

Renderer-safe stable source keys may identify source evidence. They do not make
the preview itself provider-runnable.

For app-created previews, `sourcePreviewOperationId` is required. It may be
absent only for migrated legacy preview artifacts, and the migration reason must
be durable and renderer-safe. Soft-deleted source threads are blocked in PR 7.

Source thread state must be revalidated twice:

```text
before plan/confirmation
after seed construction and before new session/context creation
```

If a source thread receives a new nonterminal turn after seed construction, the
controller discards the in-memory seed and blocks before writing fork artifacts
or starting provider transport.

## Fork Start Plan

Before showing a confirmation card, the main process builds:

```ts
type DirectFreshForkStartPlan = {
  schema: "direct_fresh_fork_start_plan@1";
  planId: string;
  projectId: string;
  source: DirectFreshForkSourceProof;
  requestShapeClass: DirectFreshForkRequestShapeClass;
  target: {
    targetRuntime: "direct-experimental/live-text";
    selectedModel: string;
    freshSessionOnly: true;
    previousResponseIdUsed: false;
    providerContinuityAvailable: false;
  };
  currentUserIntent: {
    textEvidenceKey: string;
    textPreview: string;
    byteCount: number;
    charCount: number;
    truncated: false;
    redactionStatus: "passed";
    promptClass: "fresh_fork_user_intent";
    continuityMisleadingIntentDetected: boolean;
    continuityWarningShown: boolean;
  };
  caps: {
    maxSeedItems: number;
    maxSeedTextChars: number;
    maxUserIntentChars: number;
    maxSourceThreads: number;
    maxOmissionMarkers: number;
  };
  policy: {
    harnessPolicyDigest: string;
    contextPolicyDigest: string;
    requestBuilderDigest: string;
    roleMappingDigest: string;
    previewForkPolicyDigest: string;
  };
  budget: {
    estimatedInputTokens?: number;
    modelContextWindowEstimate?: number;
    reservedOutputTokens?: number;
    budgetPolicyDigest: string;
    budgetExceeded: boolean;
  };
  duplicatePolicy: {
    sourcePreviewId: string;
    currentUserIntentDigest: string;
    activeDuplicateStartBlocked: true;
  };
  integrity: {
    algorithm: "hmac-sha256" | "sha256";
    artifactDigest: string;
  };
  rendererSafe: true;
  rawPreviewTextIncluded: false;
  rawRequestBodyIncluded: false;
};
```

The plan is app-private authority evidence. The renderer receives only a
bounded, renderer-safe plan summary.

If the current user intent asks to resume provider state, continue a previous
provider response, or replay source tools, the action remains fresh-session-only
and the confirmation must show:

```text
This fork cannot resume provider state. It quotes selected source evidence into
a new session.
```

The warning does not change continuity mode.

## Confirmation Token

Fresh fork starts require a main-issued confirmation token:

```ts
type DirectFreshForkStartConfirmation = {
  schema: "direct_fresh_fork_start_confirmation@1";
  confirmationId: string;
  planId: string;
  planDigest: string;
  projectId: string;
  sourcePreviewId: string;
  sourcePreviewDigest: string;
  workbenchRevision: string;
  operationLedgerHeadDigest: string;
  uiProjectionGeneration: number;
  uiProjectionSourceDigest: string;
  expiresAt: string;
  actionKinds: ["start_fresh_fork", "cancel"];
};
```

Execution must revalidate the confirmation token, plan digest, source preview
digest, ledger head, workbench revision, runtime readiness, and raw-exposure
state immediately before any local artifact write.

## Fork Seed

Execution writes one durable seed:

```ts
type DirectFreshForkSeed = {
  schema: "direct_fresh_fork_seed@1";
  seedId: string;
  planId: string;
  projectId: string;
  sourcePreviewId: string;
  sourcePreviewKind: "fork_preview" | "merge_preview" | "prune_preview";
  sourcePreviewDigest: string;
  seedPolicyId: DirectFreshForkSeedPolicyId;
  seedShapeHash: string;
  seedTextHash: string;
  seedInputDigest: string;
  seedKind:
    | "direct_preview_seed"
    | "merge_preview_seed"
    | "prune_preview_seed";
  mergeOrdering?: {
    ordering:
      | "source-thread-order-then-turn-order"
      | "chronological"
      | "manual";
    tieBreak: string;
    sourceThreadOrder: string[];
    orderingDigest: string;
  };
  quotedEvidence: Array<{
    seedItemId: string;
    sourceThreadId: string;
    sourceProjectionId: string;
    stableSourceItemKey: string;
    role?: string;
    rendererSafeTextEvidenceKey: string;
    textDigest: string;
    omitted?: false;
  }>;
  omissionMarkers: Array<{
    markerId: string;
    sourceThreadId: string;
    omittedItemCount: number;
    omittedTurnCount: number;
    roleCounts: Record<string, number>;
    toolResultCount: number;
    rendererSafe: true;
  }>;
  sourceThreadIds: string[];
  providerContinuityAvailable: false;
  previousResponseIdUsed: false;
  sourceToolAuthorityReplayed: false;
  sourceApprovalAuthorityReplayed: false;
  sourceToolResultsIncluded: false;
  sourceSystemPolicyIncluded: false;
  sourceDeveloperPolicyIncluded: false;
  sourceRuntimePolicyIncluded: false;
  rawPathIncluded: false;
  rawChatGptUrlIncluded: false;
  rawProviderPayloadIncluded: false;
};
```

The seed may quote source evidence into the new turn. It must not replay source
actions.

Seed hash definitions:

```text
seedShapeHash:
  source kind, seed policy id/version, caps, source count, omission count,
  ordering policy, role mapping digest, builder version.

seedTextHash:
  HMAC/local digest over app-private seed text.

seedInputDigest:
  source preview digest + current user intent digest + policy digests.
```

Source-kind rules:

```text
fork_preview:
  selected stable source rows are quoted in captured source order.

merge_preview:
  section ordering is deterministic and included in seedShapeHash.

prune_preview:
  if the source preview reports omitted spans, corresponding omission markers
  are mandatory. If they cannot be represented, block with
  fresh_fork_prune_omission_unrepresentable.
```

PR 7 excludes source tool calls, tool outputs, approvals, commands, patches,
file changes, source system messages, source developer messages, and source
runtime-policy messages from seed text by default. They may be lineage evidence
or operation history, but not prompt seed content. Any future policy that quotes
tool-result summaries must use a new seed policy id and evidence gate.

## New Session And Turn

The fork creates:

```text
new direct thread
new direct session
new first turn
```

Required properties:

```text
session source = fresh_fork_from_preview
thread source = forked-direct-native
previous_response_id = absent
source provider ids = absent
source approval ids = lineage only
source tool ids = lineage only
first turn user intent = current user intent, not source prompt
composer state = disabled_until_first_turn_terminal
```

The new thread/session/turn must be durable before context pack creation. If a
provider request cannot be built after local creation, the fork status is a
local created/no-provider state, not a retryable source resume.

The operation history must distinguish:

```text
fresh_fork_start_committed:
  local fork artifacts/session were created.

fresh_fork_provider_terminal:
  provider first turn completed, failed, or reached a terminal blocker.
```

The new forked session composer remains disabled until the first fork turn
reaches a safe terminal state. If the first turn fails before transport,
reaches sent/unknown, or stream-interrupts, the composer stays disabled until a
later repair policy exists.

## Context Pack

The context pack must cite:

```text
freshForkSeedId
freshForkStartPlanId
sourcePreviewId
sourcePreviewDigest
sourceRendererProjectionRefs
currentUserIntentEvidenceKey
harnessPolicyDigest
contextPolicyDigest
roleMappingDigest
```

Context content rules:

```text
include current harness policy
include current direct text policy
include current user intent
include bounded quoted source evidence from seed
preserve prune omission markers
label source evidence as historical
exclude source previous_response_id
exclude source provider frames
exclude source raw request/response bodies
exclude source tool authority
exclude source approvals as authority
exclude source system/developer/runtime policy
exclude implementation-lane tools
```

If seed text caps are exceeded, the plan blocks before provider transport with:

```text
fresh_fork_seed_caps_exceeded
```

PR 7 seed/context build does not invoke:

```text
context maintenance route matrix
compaction
durable thread memory
frontier baton
semantic broker routing
governance enforce mode
```

Those remain later PRs.

## Request Manifest

The provider request manifest must record:

```ts
type DirectFreshForkRequestManifest = {
  schema: "direct_fresh_fork_request_manifest@1";
  requestManifestId: string;
  projectId: string;
  sessionId: string;
  turnId: string;
  contextPackId: string;
  freshForkSeedId: string;
  sourcePreviewId: string;
  sourcePreviewKind: string;
  requestShapeClass: DirectFreshForkRequestShapeClass;
  providerInputProjection: {
    projectionId: string;
    roleMappingDigest: string;
    inputItemShapeHash: string;
    inputTextHash: string;
    rawRequestBodyStored: false;
  };
  requestControls: {
    store: false;
    previousResponseId: false;
    previousResponseIdSource: "none";
    parallelToolCalls: false;
    toolDeclarations: false;
  };
  policy: {
    harnessPolicyDigest: string;
    roleMappingDigest: string;
    contextPolicyDigest: string;
    requestBuilderDigest: string;
  };
  evidence: {
    modelEvidenceId: string;
    authSource: string;
    endpointEvidenceId: string;
    requestShapeEvidenceId: string;
    requestShapeClass: DirectFreshForkRequestShapeClass;
  };
  rawRequestBodyIncluded: false;
  rawProviderPayloadIncluded: false;
};
```

For PR 7, the first fresh fork turn is text-only. It must not declare
implementation-lane tools. A provider tool call in the fresh fork first turn is
blocked as:

```text
fresh_fork_first_turn_tool_call_unsupported
```

Provider input projection hashes must be reproducible from the context pack and
manifest. The raw request body is not stored or exposed.

## Provider Handoff

Provider transport may start only after:

```text
seed durable
new thread/session/turn durable
context pack durable
request manifest durable
raw-exposure scan passed
operation ledger start event recorded
```

Provider lifecycle states:

```ts
type DirectFreshForkProviderHandoffState =
  | "not_started"
  | "request_built"
  | "sent_no_bytes"
  | "bytes_observed"
  | "completed"
  | "failed"
  | "stream_interrupted"
  | "transport_handoff_unknown";
```

First-turn terminal states:

```ts
type DirectFreshForkFirstTurnTerminalKind =
  | "completed_with_assistant_text"
  | "completed_empty_output"
  | "provider_failed"
  | "response_incomplete"
  | "tool_call_unsupported"
  | "unknown_event_blocked"
  | "stream_interrupted"
  | "transport_handoff_unknown";

type DirectFreshForkLocalSessionState =
  | "not_created"
  | "created_no_context"
  | "context_built"
  | "request_manifest_built"
  | "provider_not_started"
  | "provider_sent_not_completed"
  | "provider_completed";
```

`completed_empty_output` is not success. A provider tool call of any supported
implementation-lane kind is terminally blocked in PR 7:

```text
read_file   -> fresh_fork_first_turn_tool_call_unsupported
apply_patch -> fresh_fork_first_turn_tool_call_unsupported
run_command -> fresh_fork_first_turn_tool_call_unsupported
```

If provider handoff is unknown, the fork must not auto-retry. The local state
must remain visible:

```text
Fresh fork session was created locally.
Provider continuation did not complete.
Automatic retry is disabled.
```

## Lineage Edges

PR 7 creates system-owned lineage edges:

```text
forked_from_preview:
  new forked thread -> source preview projection

forked_from_thread:
  new forked thread -> each source direct thread

forked_from_merge_preview:
  new forked thread -> merge preview source, when source kind is merge

forked_from_prune_preview:
  new forked thread -> prune preview source, when source kind is prune
```

Lineage edge rules:

```text
system-created only
not user-created bridge edges
no cycles
no provider continuity implied
no context inclusion implied
no source rollout mutation
no right-pane ChatGPT mutation
```

Endpoint schema:

```ts
type DirectFreshForkLineageEdge =
  | {
      edgeKind: "forked_from_preview";
      sourceKind: "direct_thread";
      sourceId: string; // new forked thread
      targetKind: "derived_projection";
      targetId: string; // preview projection id
    }
  | {
      edgeKind: "forked_from_merge_preview" | "forked_from_prune_preview";
      sourceKind: "direct_thread";
      sourceId: string;
      targetKind: "derived_projection";
      targetId: string;
    }
  | {
      edgeKind: "forked_from_thread";
      sourceKind: "direct_thread";
      sourceId: string;
      targetKind: "direct_thread";
      targetId: string;
    };
```

Normal bridge unlink cannot remove fresh-fork lineage edges. Only a future
purge/delete policy may tombstone or remove them.

## Idempotency

Required idempotency:

```text
same confirmationId + same planDigest + local status before provider:
  return existing plan/status snapshot

same clientFreshForkStartId + same operation input digest:
  return existing result/status

same confirmationId + different planDigest:
  reject confirmation_digest_mismatch

same clientFreshForkStartId + different source/user intent:
  reject client_operation_id_conflict

same confirmationId + different clientFreshForkStartId after local session
exists:
  return existing status if operation input digest matches, otherwise conflict

same clientFreshForkStartId + different confirmationId:
  reject client_operation_id_conflict unless the prior confirmation was
  canceled before any local artifact write

same sourcePreviewId + same currentUserIntentDigest while nonterminal:
  reject active_fresh_fork_exists

local session created + provider not sent:
  do not create a second session

provider sent/bytes observed/handoff unknown:
  do not resend automatically
```

After terminal completion, starting another fork from the same source preview
and same current user intent requires explicit duplicate confirmation:

```text
Start another fork from the same preview?
```

The exact source preview used by a fork is retained as lineage evidence even if
the preview is later superseded as the current workbench view.

## Operation Ledger

Add fresh-fork event family entries:

```text
fresh_fork_plan_built
fresh_fork_confirmation_issued
fresh_fork_start_committed
fresh_fork_seed_recorded
fresh_fork_thread_created
fresh_fork_context_built
fresh_fork_request_manifest_built
fresh_fork_provider_request_sent
fresh_fork_provider_bytes_observed
fresh_fork_provider_terminal
fresh_fork_provider_handoff_unknown
fresh_fork_terminal
```

Each event cites artifact ids/evidence keys and digests. No event includes raw
source text, raw provider request bodies, raw response frames, raw local paths,
raw ChatGPT URLs, or unscoped hashes.

## Recovery

Startup recovery classifies fresh fork starts from durable artifacts, not from
renderer state:

```ts
type DirectFreshForkRecoveryState =
  | "planned_only"
  | "confirmation_issued"
  | "seed_recorded_no_session"
  | "session_created_no_context"
  | "context_built_no_manifest"
  | "manifest_built_not_sent"
  | "sent_no_bytes"
  | "bytes_observed_stream_interrupted"
  | "completed"
  | "handoff_unknown"
  | "corrupt"
  | "manual_recovery_required";
```

Recovery does not:

```text
rebuild source previews
rewrite seeds
create another session
resend provider requests
mutate source threads
mutate right-pane ChatGPT
enqueue handoffs
fall back to app-server
```

Manual resume is not implemented in PR 7.

Recovery must classify `localSessionState`,
`providerHandoffState`, and `firstTurnTerminalKind` separately. It must never
treat local artifact creation as provider success.

## UI And IPC

PR 7 may add an enabled `Start fresh fork` action only when eligibility passes.

UI requirements:

```text
show source preview kind
show source thread count
show omitted item counts for prune previews
show "fresh session; no provider continuity"
show model/runtime evidence chips
show confirmation expiry
show non-authoritative lineage warning
show provider handoff state after start
show local session created/provider not completed state
show first-turn composer disabled until terminal
```

Renderer action payload must include:

```text
projectId
projectGeneration
workbenchRevision
operationLedgerHeadDigest
uiProjectionGeneration
uiProjectionSourceDigest
sourcePreviewId
sourcePreviewDigest
currentUserIntent
clientFreshForkStartId
confirmationId
```

Main process revalidates everything. Renderer state is never authority.

Starting a fresh fork may create a `direct-experimental/live-text` session
without changing the project's default runtime tier only when the confirmation
copy explicitly says so. It must not silently change project runtime selection.

## Right-Pane And Handoff Boundary

Fresh fork start must not:

```text
read right-pane ChatGPT transcript content
mutate right-pane ChatGPT messages
navigate ChatGPT as part of fork start
create/edit/delete handoff queue items
mark handoffs copied/opened/submitted/dismissed
use handoff state for direct readiness
```

External ChatGPT refs may remain visible as binding ids only.

## Raw-Exposure Policy

Scan:

```text
source preview summary
fork start plan
confirmation summary
fork seed
context pack projection
request manifest
provider request summary
operation ledger rows
renderer status
headless reports
Markdown summaries
console summaries
seed item labels
source display labels
stable source keys
source thread titles
preview section headers
lineage edge labels
```

Forbid:

```text
raw local/WSL/Windows paths outside approved display labels
raw ChatGPT URLs
raw provider frames
raw request bodies
raw response bodies
raw source JSONL paths
auth tokens
cookies
account ids
unscoped raw hashes
source file contents not selected into seed
```

Path-like display labels should not fail the whole projection by themselves, but
raw fields whose names imply path/url/provider/auth content must still be
blocked or redacted.

## Headless Regression

Add:

```text
scripts/direct-fresh-fork-start-regression.mjs
npm run direct:fresh-fork
```

Required fixture cases:

```text
fork_preview happy path -> plan -> confirmation -> seed -> session/context/manifest
merge_preview happy path -> derived seed -> fresh session
prune_preview happy path with omission markers -> fresh session
stale workbench revision blocks before session
stale source preview digest blocks before session
missing source projection blocks before session
source thread active-turn blocks before session
source preview unsafe blocks before session
source preview raw-exposure blocks before session
raw-exposure in raw field blocks before session
path-like display title does not block
confirmation expired blocks before session
duplicate client id returns existing result or conflict
duplicate sourcePreviewId + user intent while nonterminal blocks
source tool result excluded from seed text
source system/developer/runtime policy excluded from seed text
provider sent no bytes -> no automatic retry
handoff unknown -> visible local state and no retry
first-turn provider read_file tool call -> blocked unsupported
first-turn provider apply_patch tool call -> blocked unsupported
first-turn provider run_command tool call -> blocked unsupported
right-pane/handoff/app-server sentinels remain zero
```

Optional live case:

```text
one real-provider fresh text fork from disposable preview evidence
```

Live proof must be explicit opt-in and cannot be required for fixture safety
coverage.

Live promotion is source-kind-specific:

```text
real fork_preview source:
  may be a G8 promotion candidate only.

real merge_preview or prune_preview source:
  may be a G9 promotion candidate only.
```

## Report Shape

Fresh fork regression reports include:

```ts
type DirectFreshForkStartReport = {
  schema: "direct_fresh_fork_start_report@1";
  coverageSource:
    | "fixture_fresh_fork"
    | "real_provider"
    | "diagnostic";
  matrixRowsExercised: Array<"G8" | "G9" | "B1" | "B2" | "B3" | "C8" | "C9" | "C10" | "D18" | "F8" | "F10">;
  matrixPromotionCandidate: boolean;
  cases: Array<{
    caseId: string;
    sourcePreviewKind: "fork_preview" | "merge_preview" | "prune_preview";
    requestShapeClass: DirectFreshForkRequestShapeClass;
    seedPolicyId: DirectFreshForkSeedPolicyId;
    status:
      | "proved"
      | "blocked"
      | "local_created_provider_not_completed"
      | "failed"
      | "redaction_blocked";
    proofOutcome:
      | "proved_fresh_fork_loop"
      | "source_blocked_before_session"
      | "local_session_created_no_provider"
      | "provider_handoff_unknown"
      | "provider_tool_blocked"
      | "raw_exposure_blocked";
    sessionCreated: boolean;
    contextPackBuilt: boolean;
    requestManifestBuilt: boolean;
    providerInputProjectionBuilt: boolean;
    providerRequestStarted: boolean;
    localSessionState: DirectFreshForkLocalSessionState;
    providerHandoffState: DirectFreshForkProviderHandoffState;
    firstTurnTerminalKind?: DirectFreshForkFirstTurnTerminalKind;
    previousResponseIdUsed: false;
    sourceProviderContinuityUsed: false;
    sourceToolResultsIncluded: false;
    sourceSystemPolicyIncluded: false;
    sourceDeveloperPolicyIncluded: false;
    sourceRuntimePolicyIncluded: false;
    seedShapeHash: string;
    seedTextHash: string;
    seedInputDigest: string;
    lineageEdgesCreated: boolean;
  }>;
  sentinelCounters: {
    appServerSpawnCalls: 0;
    sourcePreviousResponseIdUses: 0;
    sourceToolReplayCalls: 0;
    sourceApprovalReplayCalls: 0;
    rightPaneMutationCalls: 0;
    handoffMutationCalls: 0;
  };
  rawExposure: {
    rawPathIncluded: false;
    rawChatGptUrlIncluded: false;
    rawProviderPayloadIncluded: false;
    rawAuthIncluded: false;
  };
};
```

Only `coverageSource="real_provider"` with a completed fresh provider request
may be a matrix promotion candidate. Fixture coverage is required but does not
claim real-provider proof.

Report write order:

```text
build report object
validate schema
serialize
raw-exposure scan
write full report
re-read report
validate schema again
```

If raw-exposure scanning fails, write only a minimal safe redaction-failed
report.

## Implementation Order

### Phase -2 - Source-Kind Evidence Law

- Define source-kind-specific request-shape classes.
- Define seed policy ids per source kind.
- Require sourcePreviewOperationId for app-created previews.
- Define source preview version, builder version, and preview policy digest.
- Define source lifecycle policy with soft-deleted sources blocked by default.
- Define G8 vs G9 live promotion split.

### Phase -1 - Inventory And Boundary

- Inventory existing fork-start endpoints and classify them as:
  - direct preview source;
  - derived preview source;
  - prohibited/legacy path.
- Classify old direct fork preview paths as compatible or prohibited.
- Ensure no preview-to-context direct path exists.
- Ensure no `start_fork_turn` IPC from PR 6 remains unguarded.
- Add no-context-maintenance assertion.
- Ensure PR 6 evidence workbench still treats previews as non-runnable until
  PR 7 eligibility passes.
- Add blocker codes for stale preview, stale workbench, unsupported source, raw
  exposure, and source continuity attempts.

### Phase 0 - Plan And Confirmation

- Build `direct_fresh_fork_start_plan@1`.
- Build `direct_fresh_fork_start_confirmation@1`.
- Revalidate workbench revision, source preview digest, runtime evidence, and
  user intent.
- Detect misleading resume/continue/replay user intent and require visible
  no-continuity warning.
- Estimate context budget.
- Block active duplicate sourcePreviewId + userIntentDigest starts.
- Mark source preview retention as lineage evidence after fork creation.
- Add renderer-safe confirmation status.

### Phase 1 - Seed And Local Artifacts

- Build `direct_fresh_fork_seed@1`.
- Record seedShapeHash, seedTextHash, and seedInputDigest.
- Preserve prune omission markers or block.
- Apply deterministic merge ordering.
- Exclude source tool results and source system/developer/runtime policy.
- Revalidate source state after seed build.
- Create new direct-native thread/session/turn.
- Create system-owned lineage edges.
- Enforce idempotency before and after session creation.

### Phase 2 - Context And Manifest

- Build context pack from current policy, user intent, and fork seed.
- Build request manifest with `previousResponseId=false`, `store=false`, and
  no tool declarations for PR 7 first turn.
- Persist provider-input projection id/hash.
- Enforce source-kind-specific request-shape evidence.
- Assert no context maintenance, memory, baton, semantic broker, or governance
  enforce mode is invoked.
- Scan all provider-bound and renderer-bound surfaces.

### Phase 3 - Provider Handoff And Status

- Send fresh provider request only after durable artifacts exist.
- Record handoff/bytes/terminal state.
- Record first-turn terminal taxonomy.
- Keep composer disabled until safe terminal.
- Distinguish local setup committed from provider completed.
- Block automatic retry after sent/unknown states.
- Surface local-created/provider-not-completed state.

### Phase 4 - Recovery And Regression

- Add fresh fork recovery classification.
- Add fixture regression and report.
- Add optional live opt-in case.
- Assert bridge unlink cannot remove lineage edges.
- Validate report schema before/after raw scan.
- Split live promotion by G8/G9 source kind.
- Prove app-server/right-pane/handoff/source-continuity sentinels remain zero.

## Acceptance Criteria

- Fresh fork start supports valid `fork_preview@1`, `merge_preview@1`, and
  `prune_preview@1` sources under one authority model.
- Fork-start request-shape evidence is source-kind-specific:
  `fork_preview`, `merge_preview`, and `prune_preview` cannot unlock each
  other.
- `sourcePreviewOperationId` is required for app-created previews, with a
  migration reason if absent.
- Source preview version, preview builder version, and preview policy digest are
  recorded.
- Seed policy id is source-kind-specific.
- Prune seed blocks if omission markers cannot be represented.
- Merge seed ordering and tie-break policy are deterministic and included in
  seed hashing.
- Seed artifact records `seedShapeHash`, `seedTextHash`, and
  `seedInputDigest`.
- Current user intent that asks to resume provider state triggers a visible
  no-continuity warning and does not change continuity mode.
- Source tool calls, tool outputs, approvals, commands, patches, file changes,
  and source system/developer/runtime policy are excluded from PR 7 seed text by
  default.
- Source soft-deleted threads are blocked by default.
- Source preview/source thread state is revalidated after seed build and before
  new session/context creation.
- Provider-input projection id/hash is persisted; raw request body is not.
- Context budget estimate is recorded and over-budget seed blocks or uses
  policy-approved truncation.
- Every start uses a fresh confirmation token tied to a plan digest, source
  preview digest, workbench revision, operation ledger head, and UI projection
  source digest.
- No session/context/manifest/provider request is created when eligibility
  fails.
- A durable seed artifact is created before context pack construction.
- The new direct session/thread/turn is fresh and never uses source
  `previous_response_id`.
- Source provider ids, tool calls, tool outputs, and approvals are lineage only,
  never action authority.
- Merge previews do not materialize merged rollouts.
- Prune previews preserve omission markers and do not delete or purge source
  spans.
- Request manifests record `previousResponseId=false`, `store=false`,
  `parallelToolCalls=false`, and `toolDeclarations=false` for the first PR 7
  fork turn.
- First fresh fork turn has explicit terminal kinds for completed text, empty
  output, provider failure, incomplete, tool call unsupported, unknown event,
  stream interrupted, and handoff unknown.
- The new forked session composer is disabled until the first fork turn reaches
  a safe terminal state.
- Operation history distinguishes local fork setup committed from provider turn
  completed.
- Provider tool calls in the first fresh fork turn are blocked as unsupported.
- Provider read/patch/command tool calls in the first fork turn are all blocked
  as `fresh_fork_first_turn_tool_call_unsupported`.
- System-owned lineage edges are created without implying provider continuity or
  context inclusion.
- Lineage edge endpoint kinds are explicit and normal bridge unlink cannot
  remove system lineage edges.
- Duplicate start ids are idempotent or conflict deterministically.
- Confirmation id and clientFreshForkStartId conflict rules are explicit.
- Same sourcePreviewId + same userIntentDigest cannot create duplicate
  nonterminal fork sessions.
- The source preview used by a fork is retained as lineage evidence.
- Sent/no-bytes, stream-interrupted, and handoff-unknown states do not auto
  retry.
- Recovery classifies fresh fork starts from durable artifacts, not renderer
  state.
- PR 7 does not invoke context maintenance, compaction, durable memory,
  frontier baton, semantic broker, or governance enforce mode.
- Starting a fresh fork does not silently change the project runtime tier.
- UI copy says "fresh session; no provider continuity."
- Right-pane ChatGPT and handoff queue mutation counters remain zero.
- App-server fallback counters remain zero.
- Raw-exposure scans cover seed, context, manifest, provider summaries,
  operation rows, renderer status, JSON reports, Markdown reports, and console
  summaries.
- Raw-exposure scans also cover seed labels, source display labels, stable
  source keys, source thread titles, preview headers, and lineage labels.
- Path-like display labels do not block by themselves; raw path/url/provider/auth
  fields still block or redact.
- Reports validate schema before serialization and after write; redaction
  failure writes only a minimal safe report.
- Fixture reports use `coverageSource=fixture_fresh_fork` and
  `matrixPromotionCandidate=false`.
- Optional live report promotion is split: `fork_preview` source can promote
  G8; `merge_preview` or `prune_preview` source can promote G9.

## Final Recommendation

Passing this PR should mean:

```text
The Direct thread workbench can start one explicit fresh direct-native session
from valid preview evidence, with durable seed/context/manifest artifacts,
lineage edges, raw-exposure protection, recovery classification, and no source
provider continuity.
```

It should not mean:

```text
source conversations are resumable
derived previews are canonical rollout truth
merge/prune materialization exists
implementation-lane tools are enabled in fork starts
right-pane ChatGPT is imported or controlled
handoffs are mutated
app-server can be removed
direct is production/default
```
