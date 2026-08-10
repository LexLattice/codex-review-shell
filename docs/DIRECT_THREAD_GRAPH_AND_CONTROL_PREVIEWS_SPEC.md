# Direct Thread Graph And Control Previews Spec

Status: draft implementation specification for the next direct-runtime storage
and thread-control bundle on the long-lived `codex/direct-chatgpt-harness`
branch.

Related docs:

- [DIRECT_THREAD_LOG_AND_PROJECTION_STORE_SPEC.md](./DIRECT_THREAD_LOG_AND_PROJECTION_STORE_SPEC.md)
- [DIRECT_RENDERER_TRANSCRIPT_PROJECTION_SPEC.md](./DIRECT_RENDERER_TRANSCRIPT_PROJECTION_SPEC.md)
- [DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md](./DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md)
- [DIRECT_OBLIGATION_PROJECTION_AND_TOOL_CONTEXT_SPEC.md](./DIRECT_OBLIGATION_PROJECTION_AND_TOOL_CONTEXT_SPEC.md)
- [DIRECT_IMPORT_UX_STATUS_SPEC.md](./DIRECT_IMPORT_UX_STATUS_SPEC.md)
- [DIRECT_EXPERIMENTAL_PROJECT_ACTIVATION_SPEC.md](./DIRECT_EXPERIMENTAL_PROJECT_ACTIVATION_SPEC.md)

## Purpose

Add the first user-visible thread-control and graph layer for direct-owned
Codex threads.

The direct branch now has:

- canonical direct session/turn artifacts;
- a SQLite projection/control store;
- append-only operation events;
- renderer-safe transcript projections;
- context packs and request manifests for direct text and import checkpoint
  continuation;
- obligation projections and read-only tool continuation context.

The next missing layer is:

```text
thread-control intent
  -> operation ledger event
  -> lifecycle / graph projection
  -> renderer-safe workbench state
  -> optional preview-only derived projection
```

This bundle should make direct threads easier to manage without rewriting
history or inventing provider continuity.

## Core Invariant

```text
thread control projection != canonical rollout truth
```

Hide, archive, restore, soft delete, bridge, merge preview, prune preview, and
fork preview are information-management operations. They do not mutate the
dialogical rollout that records what happened.

## Why This Next

The user-facing value of the storage substrate is not only safer prompt
construction. The app also needs more control over thread collections than
vanilla Codex exposes:

- hide noisy threads without deleting evidence;
- archive completed threads;
- soft-delete direct-owned threads from normal lists;
- group and bridge related threads inside a project;
- preview a merged working view across threads;
- preview a pruned view of one thread;
- prepare fork seeds without pretending provider state can be resumed.

The existing database already has operation, operation-effect, edge, external
ref, thread lifecycle, and projection primitives. This spec defines the first
safe bundle that uses those primitives.

## Boundary

This bundle does:

- implement lifecycle operations:
  - hide;
  - unhide;
  - archive;
  - restore;
  - soft delete;
  - restore from soft delete;
- persist lifecycle changes as append-only operation events;
- index operation effects for audit and rebuild;
- build lifecycle/list projections from the operation ledger and thread store;
- add direct thread graph edges for bridge, merge-preview, prune-preview, and
  fork-preview relationships;
- support external references for right-pane ChatGPT thread bindings without
  importing ChatGPT content;
- build preview-only merge/prune/fork/bridge projections from renderer-safe
  direct projections;
- expose renderer-safe thread workbench data for list/filter/detail views.

It does not:

- hard purge canonical rollout/session artifacts;
- delete imported source JSONL outside the direct store;
- delete Codex homes, ChatGPT browser data, credentials, auth stores, or
  app-server state;
- materialize merged rollouts as canonical direct history;
- make a derived merge/prune/bridge view provider-runnable;
- start a direct model request from a preview;
- use `previous_response_id` from source threads for a merge/prune/fork;
- import right-pane ChatGPT transcript content;
- make production `direct` available;
- remove or weaken the legacy app-server path.

## Product Doctrine

Thread controls must preserve two truths:

```text
canonical dialogue:
  what happened in source threads

working organization:
  how the app currently groups, hides, previews, or derives from those threads
```

The app may change the working organization repeatedly. It must not falsify the
source dialogue.

This workbench is scoped as:

```text
Direct Codex thread controls
```

It is not an all-conversation manager and not a unified ChatGPT/Codex graph.
Right-pane ChatGPT references remain project bindings only.

## Operation Model

### Operation Types

Use the existing operation ledger event schema for these first-bundle
operation types:

```ts
type DirectThreadControlOperationType =
  | "hide_thread"
  | "unhide_thread"
  | "archive_thread"
  | "restore_thread"
  | "soft_delete_thread"
  | "restore_soft_deleted_thread"
  | "bridge_threads"
  | "unlink_bridge"
  | "preview_merge_threads"
  | "preview_prune_thread"
  | "preview_fork_thread";
```

Do not implement:

```ts
| "purge_thread"
| "materialize_merged_rollout"
| "start_fork_turn"
```

Those need separate specs.

### Operation Events

Each operation is append-only:

```text
operation_planned
operation_committed
operation_failed
operation_repaired
operation_rolled_back
```

No event is mutated in place. SQLite stores the current operation snapshot as a
rebuildable index.

### Operation Write Order

Every mutating operation follows this order:

```text
1. acquire project mutation lock
2. validate project generation, thread ownership, source digests, and lifecycle
   transition legality
3. write operation_planned event
4. begin SQLite transaction
5. write operation snapshot, operation effects, edge/ref rows, and lifecycle
   index updates
6. commit SQLite transaction
7. write operation_committed event
8. rebuild or mark affected projections stale
9. release project mutation lock
```

If validation fails before step 3, no operation event is required. If validation
fails after planning, write `operation_failed` with a renderer-safe reason.

Recovery rules:

```text
planned event without DB effect:
  mark operation failed_or_abandoned unless replay can safely apply it

DB effect without committed event:
  repair by writing operation_repaired or rolling back the index from ledger
  truth

committed event without projection update:
  mark lifecycle/graph/preview projections stale and rebuild
```

The operation ledger is canonical mutation evidence. SQLite lifecycle, graph,
edge, and projection rows are rebuildable indexes.

### Operation Input Digests

Operation input digests must be canonical. Use sorted-key canonical JSON and
exclude unstable or private material.

Lifecycle operations:

```ts
operationInputDigest = hash(canonicalJson({
  schema: "direct_thread_lifecycle_operation_input@1",
  operationType,
  projectId,
  threadId,
  expectedProjectGeneration,
  expectedCurrentLifecycleState,
  controllerVersion,
  safetyPolicyVersion
}));
```

Preview operations include:

```text
source projection ids
source projection digests
stable source item keys
ordering policy
caps
includeHidden/includeArchived/includeSoftDeleted flags
builder version
policy version
safety/redaction version
expected project generation
```

Digests must not include:

```text
timestamps
clientOperationId
raw file paths
raw source hashes
raw transcript text
raw ChatGPT URLs
```

### Operation Effects

Every committed or no-op operation writes operation effects:

```ts
type DirectThreadOperationEffect = {
  operationId: string;
  effectOrdinal: number;

  effectKind:
    | "lifecycle_state_changed"
    | "lifecycle_noop_already_applied"
    | "edge_created"
    | "edge_removed"
    | "external_ref_created"
    | "external_ref_updated"
    | "preview_projection_created"
    | "projection_marked_stale"
    | "operation_failed_no_effect";

  targetKind:
    | "direct_thread"
    | "thread_edge"
    | "external_ref"
    | "projection"
    | "lifecycle_projection"
    | "graph_projection";

  targetId: string;
  beforeDigest?: string;
  afterDigest?: string;
  rendererSafeSummary: string;
};
```

Operation history shown to the renderer must be derived from these safe
summaries and must not expose raw inputs.

### Idempotency

Every renderer-initiated mutation must include:

```ts
clientOperationId: string;
projectId: string;
expectedProjectGeneration: number;
```

Rules:

```text
same projectId + same clientOperationId + same operation digest:
  return existing operation snapshot

same projectId + same clientOperationId + different operation digest:
  reject with client_operation_id_conflict

operation references thread outside project:
  reject with project_scope_mismatch

operation references hidden/archived/deleted state that already matches target:
  commit as no-op with an operation effect marked already_applied
```

### Locks

Use a project-level mutation lock for all lifecycle and graph mutations:

```text
hide/archive/delete/restore/bridge/unlink/merge-preview/prune-preview/fork-preview
```

Turn start must not race with soft-delete of the same direct thread. Preview
builders may run concurrently only when they read stable projection ids already
captured in the operation plan.

Soft delete is blocked while the target thread has any non-terminal direct
turn. Non-terminal states include:

```text
created
request_built
streaming
tool_waiting
authority_waiting
continuation_ready
streaming_continuation
```

Do not silently abort, detach, or hide an active turn. The user must first wait
for terminal state or use a later explicit abort/close flow.

## Lifecycle Semantics

### Lifecycle State

```ts
type DirectThreadLifecycleState =
  | "active"
  | "hidden"
  | "archived"
  | "soft_deleted";
```

State meaning:

```text
active:
  appears in normal thread lists

hidden:
  omitted from normal lists but readable by explicit id

archived:
  omitted from active lists and included in archive filters

soft_deleted:
  omitted from normal and archive lists; explicit read returns tombstone-like
  renderer-safe metadata plus optional restore action
```

Soft delete does not remove canonical artifacts. It is reversible.

### Lifecycle Transition Matrix

Allowed transitions:

```text
active -> hidden
active -> archived
active -> soft_deleted

hidden -> active
hidden -> archived
hidden -> soft_deleted

archived -> active
archived -> hidden
archived -> soft_deleted

soft_deleted -> active
```

Invalid transitions:

```text
soft_deleted -> hidden
soft_deleted -> archived
```

Operation mapping:

```text
hide_thread:
  active/archived -> hidden

unhide_thread:
  hidden -> active

archive_thread:
  active/hidden -> archived

restore_thread:
  hidden/archived -> active
  soft_deleted -> invalid_restore_soft_deleted_requires_specific_operation

soft_delete_thread:
  active/hidden/archived -> soft_deleted

restore_soft_deleted_thread:
  soft_deleted -> active
```

If the target is already in the desired state, commit a no-op operation with
`lifecycle_noop_already_applied`. Invalid transitions fail with stable blocker
codes and no lifecycle effect.

### Lifecycle Index Law

`direct_threads.lifecycle_state` is an index/cache. The operation ledger plus
operation effects are the canonical lifecycle mutation source.

Startup recovery replays ledger/effects, repairs `direct_threads.lifecycle_state`
when it disagrees, then rebuilds lifecycle projections. If table state and
ledger state disagree, ledger state wins.

### Lifecycle Projection

Add a rebuildable projection:

```ts
type DirectThreadLifecycleProjection = {
  schema: "direct_thread_lifecycle_projection@1";
  projectionId: string;
  projectId: string;
  projectionKind: "thread_lifecycle";
  projectionVersion: "thread_lifecycle@1";
  builderVersion: string;

  status: "valid" | "stale" | "blocked" | "failed";
  source: {
    operationLedgerHeadDigest: string;
    threadStoreDigest: string;
    sourceThreadIds: string[];
  };

  counts: {
    active: number;
    hidden: number;
    archived: number;
    softDeleted: number;
    corrupted: number;
  };

  rawPathExposed: false;
  rawCredentialsExposed: false;
  rawBackendFrameExposed: false;
};
```

Renderer list APIs should consume this projection, not direct SQL table scans,
once this bundle is enabled.

Use kind-specific current projection pointers. Lifecycle and graph projections
are project-scoped; they must not reuse one generic `current_projection_id`.
Use:

```sql
direct_project_current_projections (
  project_id text not null,
  projection_kind text not null,
  projection_id text not null,
  primary key (project_id, projection_kind)
)
```

Thread-scoped projections continue to use `direct_thread_current_projections`.
Preview projections must never become the current renderer transcript or current
context projection.

### Renderer-Safe Thread Summary

```ts
type RendererSafeDirectThreadSummary = {
  threadId: string;
  projectId: string;
  title: string;
  sourceClass:
    | "direct-native"
    | "imported-readonly"
    | "import-checkpoint-continuation"
    | "derived-projection"
    | "merged-projection"
    | "forked-direct-native";

  lifecycle: {
    state: DirectThreadLifecycleState;
    visibleInNormalList: boolean;
    operationIds: string[];
    lastChangedAt?: string;
  };

  continuity: {
    state:
      | "provider_continuity_available"
      | "fresh_session_only"
      | "checkpoint_required"
      | "non_runnable_projection"
      | "unknown";
    composerEnabledByProjection: false;
    composerAuthority: "runtime-status";
  };

  projectionStatus: {
    rendererTranscript: "valid" | "stale" | "missing" | "blocked";
    context: "valid" | "stale" | "missing" | "blocked";
  };

  rawPathExposed: false;
  rawSourceHashExposed: false;
  rawJsonlExposed: false;
};
```

## Graph Model

### Edge Kinds

Use `direct_thread_edges` with source/target kinds:

```ts
type DirectThreadGraphEdgeKind =
  | "related"
  | "blocks"
  | "supersedes"
  | "derived_from"
  | "merge_preview_of"
  | "prune_preview_of"
  | "fork_preview_of"
  | "chatgpt_reference"
  | "import_source_reference";
```

Edges do not imply provider continuity, authority, or context inclusion.

### Edge Invariants

Edge kinds have different laws:

```text
related:
  relationship metadata; bidirectional display is allowed

blocks:
  directed

supersedes:
  directed; source supersedes target

derived_from:
  directed child -> source; acyclic

merge_preview_of:
  directed preview -> source; acyclic

prune_preview_of:
  directed preview -> source; acyclic

fork_preview_of:
  directed preview -> source; acyclic

chatgpt_reference:
  direct thread or project node -> external_ref only

import_source_reference:
  direct/import thread -> external_ref only
```

Lineage-like edge kinds reject cycles:

```text
derived_from
merge_preview_of
prune_preview_of
fork_preview_of
supersedes
```

`related` may be cyclic. Lineage may not.

Bridge edges and lineage edges must be rendered separately:

```text
bridge_summary:
  relationship view

lineage_summary:
  derived/projection lineage view
```

A ChatGPT bridge never makes a direct thread derived from a ChatGPT thread. A
merge preview edge never appears as a casual relationship.

Bridge/unlink idempotency:

```text
create same edge again:
  no-op already_applied effect

create same edge with different metadata:
  reject metadata_conflict in this bundle

unlink missing edge:
  no-op missing_edge_already_unlinked

unlink already unlinked edge:
  no-op already_applied
```

Graph rows should not be physically erased by unlink:

```ts
type DirectThreadEdgeState = "active" | "unlinked";

type DirectThreadEdgeAuditFields = {
  edgeState: DirectThreadEdgeState;
  createdByOperationId: string;
  removedByOperationId?: string;
};
```

### External References

Use `direct_external_refs` for non-direct thread targets:

```ts
type DirectExternalRefKind =
  | "chatgpt_thread_binding"
  | "file_artifact"
  | "handoff"
  | "imported_source";
```

For ChatGPT refs:

```ts
type RendererSafeChatGptThreadRef = {
  externalRefId: string;
  projectId: string;
  refKind: "chatgpt_thread_binding";
  displayTitle: string;
  targetId?: string; // local renderer-safe binding id only
  role?:
    | "review"
    | "architecture"
    | "research"
    | "brainstorming"
    | "debugging"
    | "planning"
    | "custom";
  rendererSafeUrlHash?: string; // HMAC/local evidence key when possible
  urlStoredInDirectStore: false;
  transcriptImported: false;
  rightPaneMutated: false;
};
```

The direct store must not store right-pane ChatGPT transcript content in this
bundle. Raw ChatGPT URLs remain in the existing project/thread binding config;
the direct graph store cites only the renderer-safe binding id.

### Graph Projection

```ts
type DirectThreadGraphProjection = {
  schema: "direct_thread_graph_projection@1";
  projectionKind: "thread_graph";
  projectionVersion: "thread_graph@1";
  projectId: string;
  status: "valid" | "stale" | "blocked" | "failed";

  source: {
    operationLedgerHeadDigest: string;
    edgeTableDigest: string;
    externalRefDigest: string;
  };

  nodes: Array<{
    kind: "direct_thread" | "external_ref" | "derived_projection";
    id: string;
    title: string;
    lifecycleState?: DirectThreadLifecycleState;
    sourceClass?: string;
  }>;

  edges: Array<{
    edgeId: string;
    edgeKind: DirectThreadGraphEdgeKind;
    sourceKind: string;
    sourceId: string;
    targetKind: string;
    targetId: string;
    operationId: string;
  }>;

  rawPathExposed: false;
  rawChatGptContentExposed: false;
};
```

Suggested database constraints:

```sql
unique(project_id, client_operation_id)

unique(project_id, edge_kind, source_kind, source_id, target_kind, target_id)
  where edge_state = 'active'
```

SQLite cannot express every conditional foreign key cleanly. The controller
must enforce:

```text
source/target direct_thread ids exist when kind is direct_thread
external_ref ids exist when kind is external_ref
project ids match
lineage cycles are rejected
```

## Preview Projections

Preview projections are derived working views. They may be displayed and used
for future planning, but they are not provider-continuity sessions.

### Common Derived Projection Fields

```ts
type DirectDerivedProjectionCommon = {
  nativeDirectSession: false;
  providerContinuityAvailable: false;
  composerEnabled: false;
  continuityState: "non_runnable_projection";
  usableForContextBuild: false; // this bundle
  unsafeForContextBuild: true;
  unsafeForRenderer: boolean;
  sourceClass:
    | "merged-projection"
    | "derived-projection";
};
```

All preview projections include:

```ts
type DirectPreviewProjectionStatus = {
  status: "valid" | "stale" | "superseded" | "blocked" | "failed";
  staleReason?: string;
  securityReason?: string;
  failureSummary?: string;
  usableForContextBuild: false;
  composerEnabled: false;
  providerContinuityAvailable: false;
};
```

Blocked/failed previews are recorded as attempts but do not replace the current
valid preview pointer.

Use both preview-attempt history and kind-specific project pointers:

```sql
direct_preview_attempts (
  preview_attempt_id text primary key,
  project_id text not null,
  projection_kind text not null,
  projection_id text,
  operation_id text not null,
  status text not null,
  created_at text not null
)
```

Valid preview:

```text
may become current for that preview operation/context
```

Blocked or failed preview:

```text
recorded as attempt
does not replace previous valid current preview
```

Force rebuild:

```text
supersedes previous valid preview only after successful new preview write
```

### Preview Source Validation

Preview operations capture source projection ids and digests during planning.
Immediately before commit, revalidate:

```text
source projection still exists
source projection status is valid
source projection digest matches operation plan
source projection unsafeForRenderer=false
source thread lifecycle still allowed by include flags
source project still matches expected project generation
```

If any check fails, write `operation_failed` with:

```text
stale_source_projection
source_lifecycle_disallowed
source_project_generation_stale
```

Do not commit a preview from a stale or unsafe source projection.

### Preview Item Identity

Preview rows use deterministic item keys:

```ts
type DirectPreviewProjectionItem = {
  previewItemId: string;        // projection-local row id
  stablePreviewItemKey: string; // deterministic across rebuilds
  sourceStableItemKeys: string[];
  sourceRefs: Array<{
    threadId: string;
    projectionId: string;
    stableSourceItemKey: string;
    turnId?: string;
  }>;
};
```

Merge section headers also use stable keys derived from source thread id,
ordering policy, and source projection digest.

### Preview Caps

Default caps:

```ts
MAX_PREVIEW_ITEMS = 2000;
MAX_PREVIEW_TEXT_CHARS_PER_ITEM = 16000;
MAX_PREVIEW_TOTAL_TEXT_CHARS = 1_000_000;
MAX_PREVIEW_SOURCE_THREADS = 16;
MAX_PREVIEW_OMISSION_MARKERS = 1000;
```

If caps are hit, the preview remains valid only when truncation and omissions
are explicit and counted. Otherwise block with:

```text
projection_caps_exceeded
```

### Merge Preview

Merge preview creates a deterministic, sectioned view across two or more
threads.

Input:

```ts
type DirectMergePreviewInput = {
  projectId: string;
  sourceThreadIds: string[];
  sourceProjectionIds: string[]; // current valid renderer_transcript ids
  ordering:
    | "by-thread-then-turn"
    | "chronological";
  includeThreadHeaders: true;
  maxItems: number;
  maxTextChars: number;
};
```

Source digest:

```ts
mergePreviewSourceDigest = hash(canonicalJson({
  schema: "merge_preview_source@1",
  sourceThreadIds,
  sourceProjectionIds,
  sourceProjectionDigests,
  sourceStableItemKeyRanges,
  ordering,
  includeThreadHeaders,
  caps,
  builderVersion,
  policyVersion,
  safetyPolicyVersion,
  operationId
}));
```

Rules:

- source renderer projections must be `valid`;
- blocked or unsafe source projections block the preview;
- hidden/archived source threads may be included only by explicit selection;
- soft-deleted source threads require an explicit include-deleted flag;
- output sections must cite source thread id, source projection id, and stable
  source item keys;
- no model call;
- no semantic summarization;
- no provider continuity.

Projection kind:

```text
merge_preview@1
```

### Prune Preview

Prune preview creates a deterministic view of one thread with selected spans
omitted.

Input:

```ts
type DirectPrunePreviewInput = {
  projectId: string;
  sourceThreadId: string;
  sourceRendererProjectionId: string;
  excludedStableSourceItemKeys: string[];
  excludedTurnIds?: string[];
  reason?: string;
};
```

Source digest:

```ts
prunePreviewSourceDigest = hash(canonicalJson({
  schema: "prune_preview_source@1",
  sourceThreadId,
  sourceRendererProjectionId,
  sourceRendererProjectionDigest,
  excludedStableSourceItemKeys,
  excludedTurnIds,
  reasonDigest,
  caps,
  builderVersion,
  policyVersion,
  safetyPolicyVersion,
  operationId
}));
```

Rules:

- pruning does not delete source events;
- omitted spans must be counted and visible;
- output must include an omission marker;
- preview is not runnable;
- future materialization requires a separate spec.

Omission markers are structured:

```ts
type DirectPruneOmissionMarker = {
  markerId: string;
  position: {
    beforeStableSourceItemKey?: string;
    afterStableSourceItemKey?: string;
  };
  omitted: {
    itemCount: number;
    turnCount: number;
    roleCounts: Record<string, number>;
    toolResultCount: number;
    diagnosticCount: number;
    textCharCount?: number;
  };
  reason?: string;
};
```

Projection kind:

```text
prune_preview@1
```

### Fork Preview

Fork preview prepares a possible fresh-session seed from one source thread or
derived projection.

This bundle does not start the fork.

Input:

```ts
type DirectForkPreviewInput = {
  projectId: string;
  sourceKind: "direct_thread" | "merge_preview" | "prune_preview";
  sourceId: string;
  seedPolicyId:
    | "fork_from_recent_dialogue_preview@1"
    | "fork_from_selected_items_preview@1";
  selectedStableSourceItemKeys?: string[];
};
```

Source digest:

```ts
forkPreviewSourceDigest = hash(canonicalJson({
  schema: "fork_preview_source@1",
  sourceKind,
  sourceId,
  sourceDigest,
  selectedStableSourceItemKeys,
  seedPolicyId,
  caps,
  builderVersion,
  policyVersion,
  safetyPolicyVersion,
  operationId
}));
```

Output:

```ts
type DirectForkPreview = {
  previewId: string;
  sourceDigest: string;
  seedShapeHash: string;
  omittedCounts: Record<string, number>;
  runnableNow: false;
  reason: "fork_start_not_implemented";
};
```

No `previous_response_id` is used. A later fork-start spec may create a fresh
direct-native session from a durable context pack.

Fork preview is evidence only:

```text
does not write a context pack
does not write a request manifest
does not create a direct-native session
does not set composer/runnable
does not call provider transport
```

### Bridge Summary

Bridge summary records relationships across direct threads and external refs.

Bridge records are metadata only:

- no transcript merging;
- no context inclusion by default;
- no right-pane mutation;
- no provider continuity;
- no imported ChatGPT content.

Projection kind:

```text
bridge_summary@1
```

## Renderer Workbench

Add a project-scoped Thread Controls workbench surface or extend the existing
Imports/threads middle-plane area with:

- lifecycle filters:
  - active;
  - hidden;
  - archived;
  - soft-deleted;
- operation history panel;
- graph edge panel;
- preview builder panel:
  - merge preview;
  - prune preview;
  - fork preview;
  - bridge/ref link;
- renderer-safe preview detail.

Buttons must call controller APIs, not mutate renderer state directly.

Renderer-visible action availability is a hint. The main-process controller
remains authoritative.

Every renderer request carries project generation. Every async response returns
the project id and project generation. If the active project changes while an
evaluate/build/read operation is pending, the renderer discards the stale
response.

```ts
type RendererSafeThreadControlAction = {
  action:
    | "hide"
    | "unhide"
    | "archive"
    | "restore"
    | "soft-delete"
    | "restore-soft-deleted"
    | "create-bridge"
    | "unlink-bridge"
    | "create-merge-preview"
    | "create-prune-preview"
    | "create-fork-preview";
  likelyAvailable: boolean;
  authoritative: false;
  controllerStatusRef: string;
  disabledReason?: string;
};
```

### Operation History Projection

The operation history panel is renderer-safe:

```ts
type RendererSafeThreadOperationHistoryItem = {
  operationId: string;
  operationType: DirectThreadControlOperationType;
  status: "planned" | "committed" | "failed" | "repaired" | "rolled_back";
  createdAt: string;
  committedAt?: string;
  rendererSafeTargets: Array<{
    targetKind: string;
    targetId: string;
    displayName: string;
  }>;
  rendererSafeSummary: string;
  effectCount: number;
  rawPathExposed: false;
  rawUrlExposed: false;
  rawHashExposed: false;
};
```

Do not expose:

```text
raw source paths
raw ChatGPT URLs
raw source file hashes
raw operation input payloads
unredacted error payloads
```

## Main-Process API

Suggested controller methods:

```ts
type DirectThreadControlController = {
  evaluateThreadControls(projectId: string): RendererSafeThreadControlStatus;

  hideThread(input: LifecycleOperationInput): Promise<ThreadOperationResult>;
  unhideThread(input: LifecycleOperationInput): Promise<ThreadOperationResult>;
  archiveThread(input: LifecycleOperationInput): Promise<ThreadOperationResult>;
  restoreThread(input: LifecycleOperationInput): Promise<ThreadOperationResult>;
  softDeleteThread(input: LifecycleOperationInput): Promise<ThreadOperationResult>;
  restoreSoftDeletedThread(input: LifecycleOperationInput): Promise<ThreadOperationResult>;

  createBridge(input: BridgeOperationInput): Promise<ThreadOperationResult>;
  unlinkBridge(input: BridgeOperationInput): Promise<ThreadOperationResult>;

  createMergePreview(input: MergePreviewOperationInput): Promise<PreviewProjectionResult>;
  createPrunePreview(input: PrunePreviewOperationInput): Promise<PreviewProjectionResult>;
  createForkPreview(input: ForkPreviewOperationInput): Promise<PreviewProjectionResult>;

  readPreviewProjection(input: ReadPreviewProjectionInput): Promise<RendererSafePreviewProjection>;
};
```

Every method must validate:

- project id;
- thread ownership;
- project generation;
- source projection status;
- operation idempotency;
- renderer-safe output shape.

Stable blocker codes:

```ts
type DirectThreadControlBlocker =
  | "project_generation_stale"
  | "project_scope_mismatch"
  | "client_operation_id_conflict"
  | "invalid_lifecycle_transition"
  | "active_turn_exists"
  | "source_projection_missing"
  | "source_projection_stale"
  | "source_projection_unsafe"
  | "source_lifecycle_disallowed"
  | "lineage_cycle_detected"
  | "metadata_conflict"
  | "projection_caps_exceeded"
  | "operation_ledger_corrupt"
  | "renderer_safety_failed";
```

## Safety And Security

Renderer must not receive:

- raw rollout paths;
- raw session paths;
- raw imported JSONL lines;
- raw source file hashes;
- raw backend frames;
- raw request bodies;
- auth headers;
- cookies;
- credentials;
- private absolute workspace paths;
- right-pane ChatGPT transcript text.

Preview projections consume renderer-safe projection rows, not raw source
artifacts.

If a source renderer projection is blocked for raw exposure, all derived
previews using it are blocked.

In test mode, lifecycle and preview paths should install sentinels for provider
transport and app-server launch. The sentinel throws if called by:

```text
hide/archive/soft-delete
bridge/unlink
merge preview
prune preview
fork preview
preview read
startup rebuild
```

## Context And Runtime Boundaries

This bundle does not make derived projections prompt context.

All preview projections set:

```ts
usableForContextBuild: false;
composerEnabled: false;
providerContinuityAvailable: false;
```

Later specs may add:

- context policy for merge preview;
- context policy for prune preview;
- fork-start fresh direct session;
- compaction checkpoint consumption.

Those later specs must create context packs and request manifests before any
provider transport.

## Recovery

Startup recovery should:

1. rebuild operation snapshots from the append-only ledger;
2. rebuild lifecycle state from operation effects;
3. rebuild graph edge projections from edge/external-ref rows and operation
   effects;
4. mark preview projections stale when:
   - source renderer projection changed;
   - operation ledger advanced;
   - source lifecycle entered `soft_deleted`;
   - builder version changed;
   - safety policy changed;
5. keep old safe previews readable unless their source projection is unsafe.

Corrupt operation ledger state blocks new mutations but should not block
read-only display of already-safe renderer transcript projections.

Corrupt operation ledger behavior:

```text
lifecycle/graph workbench enters read-only degraded mode
hide/archive/delete/bridge/preview actions are disabled
existing valid renderer_transcript projections remain readable by explicit id
direct turn start must not silently proceed if lifecycle state cannot be trusted
rollback to legacy app-server remains governed by project activation rules
```

## Implementation Order

### Phase -1: State And Operation Law

- Add stable operation input digests.
- Add lifecycle transition matrix.
- Add idempotency checks by project/client operation id.
- Add project-level mutation lock.
- Add operation-effect rows for lifecycle and graph mutations.
- Add write-order and recovery rules.
- Add controller-authoritative action model.

### Phase 0: Lifecycle Projection

- Hide/unhide.
- Archive/restore.
- Soft delete/restore soft-deleted.
- Block soft delete during active direct turns.
- Rebuild lifecycle projection from operation ledger/effects.
- Repair lifecycle index from ledger/effects.
- Add project-level current projection pointer.
- Add list filters and renderer-safe summaries.
- Add explicit read behavior for soft-deleted threads.

### Phase 1: Graph Edges And External Refs

- Add bridge/unlink operations.
- Add external refs for ChatGPT thread bindings and import sources.
- Store ChatGPT refs by local binding id only.
- Add active/unlinked edge state.
- Add lineage cycle checks.
- Build `thread_graph@1`.
- Ensure no ChatGPT transcript content is stored.

### Phase 2: Preview Source Capture

- Validate source projection ids and digests.
- Revalidate source freshness immediately before commit.
- Add preview source digest builders.
- Add preview caps.
- Add preview attempt history.
- Ensure blocked/failed previews do not replace current valid previews.

### Phase 3: Merge Preview

- Build deterministic `merge_preview@1` from valid renderer projections.
- Section by source thread.
- Add stable preview item keys.
- Cite source refs and stable source item keys.
- Honor hidden/archived/deleted include flags.
- No model call, no context use, no runnability.

### Phase 4: Prune Preview

- Build deterministic `prune_preview@1`.
- Include structured omission markers and counts.
- Keep source rollout untouched.

### Phase 5: Fork Preview

- Build fork seed preview metadata.
- Do not write a context pack or request manifest.
- Do not create a direct-native session.
- Do not start provider transport.
- Mark `runnableNow=false`.

### Phase 6: Workbench UI / IPC

- Thread-control status.
- Operation history.
- Lifecycle filters.
- Preview detail rendering.
- Controller-authoritative actions.
- Operation history redaction.
- Project generation guards.
- Degraded read-only mode.

### Phase 7: Smokes

- Operation idempotency.
- Invalid lifecycle transitions fail safely.
- Hide/unhide list filtering.
- Archive/restore list filtering.
- Soft delete blocked while a direct turn is active.
- Soft delete hides thread but preserves artifacts.
- Restore soft-deleted thread returns to active list.
- Duplicate bridge is deterministic no-op or metadata conflict.
- Unlink missing bridge is deterministic no-op.
- Lineage edge cycle is rejected.
- Stale source projection between plan and commit blocks preview.
- Merge preview blocks unsafe source projection.
- Merge preview cites source stable item keys.
- Prune preview includes omitted counts.
- Blocked preview does not replace previous valid preview.
- Fork preview cannot start transport.
- ChatGPT bridge stores metadata only.
- Operation history projection contains no raw paths/URLs/hashes.
- Startup rebuild recovers lifecycle and graph state.
- No direct provider transport call.
- No app-server spawn.
- No raw path/source JSONL/right-pane transcript exposure.

## Acceptance Criteria

- Lifecycle transitions are defined by an explicit matrix; invalid transitions
  fail with stable blocker codes.
- Lifecycle mutations are append-only operation events plus operation effects.
- Duplicate lifecycle operations with the same client id are idempotent.
- Operation write order and recovery are specified for planned, committed,
  failed, repaired, and stale-projection states.
- Operation input digests are canonical and exclude timestamps, client ids, raw
  paths, raw hashes, raw transcript text, and raw ChatGPT URLs.
- Operation effects have target kind/id, before/after digests, and
  renderer-safe summaries.
- `direct_threads.lifecycle_state` is a rebuildable index; ledger/effects are
  canonical mutation evidence.
- Lifecycle projection can be rebuilt from durable artifacts.
- Hidden/archived/soft-deleted list filters behave predictably.
- Soft delete is blocked while the target thread has a non-terminal direct turn.
- Soft delete does not remove canonical artifacts and is reversible.
- Hard purge is not implemented.
- Projection pointers are kind-specific; preview projections cannot become the
  current renderer transcript or context projection.
- Thread graph edges can connect direct threads and renderer-safe external refs.
- Graph edge invariants distinguish bridge edges from lineage edges.
- Lineage cycles are rejected.
- Bridge unlink uses active/unlinked edge state rather than erasing graph
  history.
- ChatGPT bridge refs do not import or store right-pane transcript content.
- ChatGPT external refs cite local binding ids and renderer-safe evidence keys
  only; raw ChatGPT URLs are not stored in the direct graph store.
- Preview builders revalidate source projection status, digest, lifecycle, and
  project generation immediately before commit.
- Merge preview consumes only valid renderer transcript projections.
- Merge preview is deterministic and non-runnable.
- Merge preview has canonical source digest, stable preview item keys, caps,
  truncation flags, and unsafe/blocker reasons.
- Prune preview does not mutate source rollouts and records omitted counts.
- Prune preview omission markers are structured and visible.
- Fork preview produces seed metadata only and cannot start a provider request.
- Fork preview does not write a context pack, request manifest, direct session,
  or provider request.
- All preview projections set `providerContinuityAvailable=false`.
- All preview projections set `composerEnabled=false`.
- Preview projections are not usable for context builds in this bundle.
- Blocked/failed previews are recorded as attempts but do not replace previous
  valid current previews.
- Operation history is renderer-safe and exposes no raw paths, raw URLs, raw
  hashes, or unredacted errors.
- Corrupt operation ledger puts thread-control workbench into read-only degraded
  mode.
- Renderer-safe outputs expose no raw paths, raw hashes, raw JSONL, auth data,
  backend frames, request bodies, or ChatGPT transcript content.
- Test sentinels prove lifecycle and preview operations do not call provider
  transport or spawn app-server.
- Runtime activation and direct turn routing are unchanged.
- Legacy app-server path is unaffected.

## Deferred

- Hard purge and deletion plans.
- Tombstone artifacts.
- Materialized merged rollouts.
- Provider-runnable fork start.
- Context policies that consume merge/prune/fork previews.
- Model-generated semantic merge or compaction.
- Search indexing across preview projections.
- Cross-project thread bridges.

## Final Target

Passing this bundle should mean:

```text
Direct-owned threads can be hidden, archived, soft-deleted, restored, bridged,
and preview-merged/pruned/forked through renderer-safe projections without
rewriting canonical dialogue or creating provider continuity.
```

It should not mean:

```text
canonical rollouts can be purged
derived threads are runnable
source provider state can be resumed
right-pane ChatGPT content is imported
merge/prune/fork previews are prompt context
direct mode is production
app-server can be removed
```
