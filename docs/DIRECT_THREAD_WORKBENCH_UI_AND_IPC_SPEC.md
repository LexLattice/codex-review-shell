# Direct Thread Workbench UI And IPC Spec

Status: draft implementation specification for the next direct-runtime UI and
control-surface bundle on the long-lived `codex/direct-chatgpt-harness` branch.

Related docs:

- [DIRECT_THREAD_LOG_AND_PROJECTION_STORE_SPEC.md](./DIRECT_THREAD_LOG_AND_PROJECTION_STORE_SPEC.md)
- [DIRECT_RENDERER_TRANSCRIPT_PROJECTION_SPEC.md](./DIRECT_RENDERER_TRANSCRIPT_PROJECTION_SPEC.md)
- [DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md](./DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md)
- [DIRECT_OBLIGATION_PROJECTION_AND_TOOL_CONTEXT_SPEC.md](./DIRECT_OBLIGATION_PROJECTION_AND_TOOL_CONTEXT_SPEC.md)
- [DIRECT_THREAD_GRAPH_AND_CONTROL_PREVIEWS_SPEC.md](./DIRECT_THREAD_GRAPH_AND_CONTROL_PREVIEWS_SPEC.md)
- [DIRECT_IMPORT_UX_STATUS_SPEC.md](./DIRECT_IMPORT_UX_STATUS_SPEC.md)
- [DIRECT_EXPERIMENTAL_PROJECT_ACTIVATION_SPEC.md](./DIRECT_EXPERIMENTAL_PROJECT_ACTIVATION_SPEC.md)

## Purpose

Make the direct thread-control backend visible and usable from the app without
turning renderer state into authority.

The direct branch now has the backend substrate for:

- direct thread lifecycle state;
- append-only operation events;
- lifecycle and graph projections;
- external refs for ChatGPT bindings and imported sources;
- preview-only merge/prune/fork projections;
- renderer-safe transcript projections;
- context packs and request manifests for real provider requests.

The next missing layer is:

```text
Thread Workbench UI intent
  -> renderer-safe IPC request
  -> main-process controller validation
  -> DirectThreadStore operation / projection
  -> renderer-safe snapshot update
```

This bundle should make thread controls app-visible while preserving the core
storage doctrine:

```text
canonical rollout truth != information-management projection
```

## Core Invariant

```text
renderer workbench state != local mutation authority
```

The renderer may display thread summaries, graph edges, previews, operation
history, and action hints. It must not decide that an operation is legal. Every
mutating action is revalidated in the main process against the selected
project, project generation, thread ownership, lifecycle state, source
projection digests, store health, and operation idempotency.

## Boundary

This bundle does:

- extend the middle-plane `Threads` tab into a direct thread workbench;
- expose renderer-safe thread list, lifecycle, graph, preview, and operation
  history snapshots;
- add IPC/preload APIs for lifecycle operations:
  - hide;
  - unhide;
  - archive;
  - restore;
  - soft delete;
  - restore from soft delete;
- add IPC/preload APIs for graph operations:
  - create bridge edge;
  - unlink bridge edge;
  - create or cite external refs by renderer-safe binding id;
- add IPC/preload APIs for preview operations:
  - merge preview;
  - prune preview;
  - fork preview;
- render preview detail from renderer-safe projection rows;
- render operation history with safe summaries;
- enforce project-generation guards and stale-response discard;
- keep workbench actions disabled or read-only when the direct thread store is
  degraded, rebuilding, or corrupted.

It does not:

- hard purge direct artifacts;
- materialize merge/prune/fork previews as canonical rollouts;
- start a forked direct session;
- create context packs or request manifests from preview projections;
- make preview projections provider-runnable;
- use `previous_response_id` for merge/prune/fork;
- import right-pane ChatGPT transcript content;
- expose raw ChatGPT URLs;
- expose raw source paths, raw source hashes, raw JSONL, raw backend frames, raw
  request bodies, auth headers, credentials, or unredacted diagnostics;
- start provider transport;
- spawn or fall back to `codex app-server`;
- make production `direct` available;
- replace the legacy app-server path.

## Product Doctrine

The workbench is scoped as:

```text
Direct Codex thread controls
```

It is not:

```text
All conversations manager
Unified ChatGPT/Codex graph
Generic chat memory UI
Provider continuity editor
```

Right-pane ChatGPT references remain renderer-safe project bindings. They are
useful as references or bridges, but they do not import ChatGPT transcript
content and do not mutate the right ChatGPT surface.

The UI should feel like an operational workbench:

- dense;
- scannable;
- project-scoped;
- explicit about lifecycle state;
- explicit about non-runnable previews;
- restrained about explanatory text.

Do not turn this into a landing page or tutorial surface.

## Current Substrate

The previous backend bundle added or hardened:

- `DirectThreadStore`;
- `direct_threads.lifecycle_state`;
- append-only operation ledger events;
- `direct_operation_effects`;
- `direct_thread_edges`;
- `direct_external_refs`;
- project-scoped current projection pointers;
- lifecycle projections;
- graph projections;
- preview attempts;
- merge/prune/fork preview projections;
- active-turn soft-delete blocking;
- client operation id conflict detection;
- canonical metadata comparison for bridge idempotency.

The implementation entry point for this bundle should be a main-process
controller around that store, not direct renderer access to store internals.

## Workbench Placement

Use the existing middle-plane `Threads` tab. It already exists beside:

```text
Overview | Threads | Imports | Analytics | Web
```

This bundle should evolve that tab from thread linking into a direct thread
workbench. It may keep existing ChatGPT linking affordances, but it must
separate them visually from direct-owned thread controls.

Recommended layout:

```text
Threads tab
  top toolbar:
    project-scoped refresh
    lifecycle filters
    graph/preview mode segmented control
    safe store status badge

  left pane:
    direct thread list
    lifecycle badges
    source-class badges
    active/hidden/archived/soft-deleted filters

  center pane:
    selected thread transcript projection
    selected preview projection
    omission markers / source refs
    non-runnable preview badges

  right pane:
    graph edges and external refs
    operation history
    lifecycle actions
    preview builders
```

If the existing Threads tab cannot fit this cleanly, use inner tabs:

```text
List | Graph | Previews | Operations
```

Do not put cards inside cards. Use full-height workbench panels, compact rows,
tables/lists, and narrow detail sections. Use icon buttons with tooltips for
common actions where practical, with text labels only for destructive or
ambiguous actions.

## Main Controller

Add a main-process direct thread workbench controller. Suggested module:

```text
src/main/direct/thread/thread-workbench-controller.js
```

Responsibilities:

- own all thread-control IPC entry points;
- validate project id and project generation;
- validate direct thread store health;
- validate thread ownership and lifecycle state;
- validate source projection status/digests for preview actions;
- call `DirectThreadStore` methods;
- return renderer-safe projections and operation summaries;
- never return raw store paths or raw artifact payloads;
- never call provider transport;
- never spawn app-server.

The controller can compose:

```text
DirectThreadStore
DirectSessionStore
project registry / selected project state
right-pane ChatGPT binding registry
runtime status provider
```

but renderer IPC must see only safe projections.

## IPC Surface

Expose IPC through preload under a narrow namespace, for example:

```ts
window.workspaceShell.directThreadWorkbench = { ... };
```

Rules:

- no generic `ipcInvoke(method, payload)`;
- no direct store table names in IPC;
- no raw projection kind strings outside an allowlisted enum;
- no renderer-selected filesystem paths;
- no raw operation-ledger browser.

```ts
type DirectThreadWorkbenchApi = {
  getSnapshot(
    projectId: string,
    params?: DirectThreadWorkbenchSnapshotParams
  ): Promise<RendererSafeThreadWorkbenchSnapshot>;

  readThreadProjection(
    projectId: string,
    threadId: string,
    params?: DirectThreadProjectionReadParams
  ): Promise<RendererSafeDirectTranscriptProjection | null>;

  readProjectProjection(
    projectId: string,
    projectionKind: DirectThreadWorkbenchProjectionKind,
    params?: DirectProjectProjectionReadParams
  ): Promise<RendererSafeProjectProjection | null>;

  prepareSoftDelete(
    projectId: string,
    threadId: string,
    input: RendererSafeSoftDeletePrepareInput
  ): Promise<RendererSafeSoftDeletePreparation>;

  runLifecycleAction(
    projectId: string,
    input: RendererThreadLifecycleActionInput
  ): Promise<RendererSafeThreadOperationResult>;

  createBridge(
    projectId: string,
    input: RendererThreadBridgeInput
  ): Promise<RendererSafeThreadOperationResult>;

  unlinkBridge(
    projectId: string,
    input: RendererThreadUnlinkInput
  ): Promise<RendererSafeThreadOperationResult>;

  createMergePreview(
    projectId: string,
    input: RendererMergePreviewInput
  ): Promise<RendererSafePreviewOperationResult>;

  createPrunePreview(
    projectId: string,
    input: RendererPrunePreviewInput
  ): Promise<RendererSafePreviewOperationResult>;

  createForkPreview(
    projectId: string,
    input: RendererForkPreviewInput
  ): Promise<RendererSafePreviewOperationResult>;

  readOperationHistory(
    projectId: string,
    params?: DirectThreadOperationHistoryParams
  ): Promise<RendererSafeThreadOperationHistory>;

  readPreviewProjection(
    projectId: string,
    previewId: string,
    params?: DirectPreviewProjectionReadParams
  ): Promise<RendererSafeThreadPreview | null>;

  refreshWorkbenchSnapshot(
    projectId: string,
    params?: DirectThreadWorkbenchSnapshotParams
  ): Promise<RendererSafeThreadWorkbenchSnapshot>;

  rebuildLifecycleProjection(
    projectId: string,
    input: RendererSafeWorkbenchMaintenanceInput
  ): Promise<RendererSafeThreadOperationResult>;

  rebuildGraphProjection(
    projectId: string,
    input: RendererSafeWorkbenchMaintenanceInput
  ): Promise<RendererSafeThreadOperationResult>;

  rebuildPreviewProjection(
    projectId: string,
    input: RendererSafePreviewRebuildInput
  ): Promise<RendererSafePreviewOperationResult>;

  rebuildRendererTranscriptProjection(
    projectId: string,
    threadId: string,
    input: RendererSafeWorkbenchMaintenanceInput
  ): Promise<RendererSafeThreadOperationResult>;
};
```

`getSnapshot` is compact by default:

```ts
type PageParams = {
  offset?: number;
  limit?: number;
};

type DirectThreadWorkbenchSnapshotParams = {
  filters?: DirectThreadWorkbenchFilters;
  includeThreads?: boolean;
  includeGraphSummary?: boolean;
  includePreviewSummary?: boolean;
  includeOperationSummary?: boolean;
  page?: {
    threads?: PageParams;
    operations?: PageParams;
    previews?: PageParams;
  };
};
```

Large reads use detail APIs:

```text
readThreadProjection
readProjectProjection
readPreviewProjection
readOperationHistory
```

Refresh/rebuild actions are explicit controller actions. A renderer refresh may
read the current snapshot, but it must not secretly rebuild stale or unsafe
projections without an allowlisted controller method and renderer-safe result.

Every request includes or resolves:

```ts
type ProjectGenerationGuard = {
  projectId: string;
  projectGeneration: number;
  expectedWorkbenchRevision?: string;
  expectedOperationLedgerHeadDigest?: string;
  requestGeneration: number;
};
```

Every response includes:

```ts
type RendererSafeThreadWorkbenchResponseMeta = {
  projectId: string;
  projectGeneration: number;
  requestGeneration?: number;
  stale: boolean;
  rawPathExposed: false;
  rawUrlExposed: false;
  rawCredentialsExposed: false;
  rawBackendFrameExposed: false;
  rawRequestBodyExposed: false;
};
```

Renderer must discard a response when:

```text
response.projectId != activeProjectId
response.projectGeneration != activeProjectGeneration
response.requestGeneration < currentRequestGeneration for that workbench lane
```

Main must reject a mutation when:

```text
request project generation is stale
workbench revision is stale
operation ledger head changed unexpectedly
thread/import/ref does not belong to project
source projection changed between plan and commit
operation input conflicts with existing clientOperationId
store health disallows mutation
```

## Renderer-Safe Snapshot

The primary read model:

```ts
type RendererSafeThreadWorkbenchSnapshot = {
  schema: "renderer_safe_direct_thread_workbench_snapshot@1";
  projectId: string;
  projectGeneration: number;
  workbenchRevision: string;
  operationLedgerHeadDigest: string;
  lifecycleProjectionDigest?: string;
  graphProjectionDigest?: string;
  builtAt: string;

  store: RendererSafeThreadStoreWorkbenchStatus;
  filters: DirectThreadWorkbenchFilters;
  capabilities: DirectThreadWorkbenchCapabilities;

  counts: {
    active: number;
    hidden: number;
    archived: number;
    softDeleted: number;
    externalRefs: number;
    activeEdges: number;
    previewAttempts: number;
    operations: number;
  };

  threads: RendererSafeThreadSummary[];
  selected?: RendererSafeSelectedThreadSummary;
  graph?: RendererSafeThreadGraphSummary;
  previews: RendererSafePreviewSummary[];
  operationHistory: RendererSafeThreadOperationSummary[];

  rawExposure: RendererSafeRawExposureFlags;
};
```

`workbenchRevision` is a main-generated digest over the workbench state used by
controller-authoritative actions. It should include:

```text
project id
operation ledger head digest
lifecycle projection digest
graph projection digest
thread lifecycle/version digests
store health version
controller version
```

It must exclude:

```text
raw paths
raw URLs
raw source hashes
raw transcript text
timestamps unless they are part of source state
```

`projectGeneration` prevents cross-project mistakes. `workbenchRevision` and
`operationLedgerHeadDigest` prevent same-project stale-row actions.

Store status:

```ts
type RendererSafeThreadStoreWorkbenchStatus = {
  available: boolean;
  mode:
    | "disabled"
    | "index_only"
    | "dual_write_shadow"
    | "projection_read"
    | "context_build_required";
  health:
    | "healthy"
    | "degraded"
    | "rebuilding"
    | "corrupt"
    | "disabled";
  readOnly: boolean;
  mutationBlockedReason?: DirectThreadWorkbenchBlockerCode;
  projectionCounts: Record<string, number>;
  operationLedgerHealth:
    | "healthy"
    | "stale"
    | "corrupt"
    | "missing"
    | "unknown";
  dbPathExposed: false;
  rootPathExposed: false;
};
```

Capabilities:

```ts
type DirectThreadWorkbenchCapabilities = {
  canReadThreads: boolean;
  canReadGraph: boolean;
  canReadOperations: boolean;
  canRunLifecycleActions: boolean;
  canCreateBridge: boolean;
  canUnlinkBridge: boolean;
  canCreateMergePreview: boolean;
  canCreatePrunePreview: boolean;
  canCreateForkPreview: boolean;
  canStartFork: false;        // deferred
  canMaterializeMerge: false; // deferred
  canMaterializePrune: false; // deferred
  canHardPurge: false;        // deferred
  canStartProviderTransport: false;
  degradedReasons: DirectThreadWorkbenchBlockerCode[];
};
```

Snapshot search metadata:

```ts
type RendererSafeThreadWorkbenchSearchState = {
  mode: "none" | "local_current_snapshot" | "projection_index";
  queryApplied: boolean;
  resultMayBePartial: boolean;
};
```

If v0 filters only the loaded snapshot, the UI must label the search as local
or filtered rather than implying full direct-store search.

## Thread Summary Shape

```ts
type RendererSafeThreadSummary = {
  threadId: string;
  projectId: string;
  title: string;
  sourceClass:
    | "direct-native"
    | "imported-readonly"
    | "import-checkpoint-continuation"
    | "derived-projection"
    | "merged-projection"
    | "forked-direct-native"
    | string;

  lifecycle: {
    state: "active" | "hidden" | "archived" | "soft_deleted";
    rendererListVisible: boolean;
    canRestore: boolean;
    canSoftDelete: boolean;
    softDeleteBlockedReason?: DirectThreadWorkbenchBlockerCode;
  };

  continuity: {
    providerContinuityAvailable: boolean;
    providerContinuityLabel:
      | "available"
      | "fresh-session-only"
      | "checkpoint-required"
      | "non-runnable-projection"
      | "unknown";
    composerHint: {
      enabledByProjection: boolean;
      authoritative: false;
      controlAuthority: "runtime-status";
    };
  };

  projection: {
    currentRendererProjectionId?: string;
    rendererProjectionStatus?: "valid" | "stale" | "blocked" | "failed" | "missing";
    itemCount?: number;
    truncated?: boolean;
    unsafeForRenderer: boolean;
  };

  activity: {
    turnCount: number;
    activeTurnCount: number;
    lastUpdatedAt?: string;
  };

  badges: string[];
  rawExposure: RendererSafeRawExposureFlags;
};
```

Rules:

- Imported-readonly threads show `composerHint.enabledByProjection=false`.
- Derived projections show `providerContinuityLabel="non-runnable-projection"`.
- Direct-native threads still do not become composer-enabled from this snapshot.
  Runtime status remains the authority.
- Soft-deleted threads are hidden from normal lists unless `includeSoftDeleted`
  is set.

## Filters

The workbench supports:

```ts
type DirectThreadWorkbenchFilters = {
  includeHidden: boolean;
  includeArchived: boolean;
  includeSoftDeleted: boolean;
  sourceClasses?: string[];
  textQuery?: string; // projection-backed search later; v0 may be local filter only
  selectedThreadId?: string;
  selectedPreviewId?: string;
  selectedGraphNodeId?: string;
};
```

Selection policy:

```text
If selectedThreadId becomes hidden by current filters:
  retain selection only when an explicit detail view is open and the thread is
  still readable by id;
  otherwise clear selection and show filtered-count status.

If selectedPreviewId becomes stale or blocked:
  keep selection only to show the stale/blocked badge and safe failure summary;
  do not auto-create a replacement preview.

If project changes:
  clear selected ids unless the next snapshot proves the same id belongs to the
  new active project.
```

Default:

```text
includeHidden = false
includeArchived = false
includeSoftDeleted = false
```

Hidden/archived/soft-deleted counts should remain visible in a status strip so
the user can tell that filtered evidence exists.

## Lifecycle Actions

Renderer input:

```ts
type RendererThreadLifecycleActionInput = {
  clientOperationId: string;
  projectGeneration: number;
  expectedWorkbenchRevision: string;
  expectedOperationLedgerHeadDigest?: string;
  threadId: string;
  action:
    | "hide"
    | "unhide"
    | "archive"
    | "restore"
    | "soft_delete"
    | "restore_soft_deleted";
  expectedLifecycleState: "active" | "hidden" | "archived" | "soft_deleted";
  expectedRendererProjectionId?: string;
  expectedThreadDigest?: string;
  confirmationId?: string;
};
```

Main maps actions to backend operation types:

```text
hide -> hide_thread
unhide -> unhide_thread
archive -> archive_thread
restore -> restore_thread
soft_delete -> soft_delete_thread
restore_soft_deleted -> restore_soft_deleted_thread
```

Lifecycle transition rules come from a concrete transition table exported by
the implementation, not only prose:

```ts
const DIRECT_THREAD_LIFECYCLE_TRANSITIONS = {
  active: ["hidden", "archived", "soft_deleted"],
  hidden: ["active", "archived", "soft_deleted"],
  archived: ["active", "soft_deleted"],
  soft_deleted: ["active"], // restore_soft_deleted only
};
```

Invalid transitions fail with `invalid_lifecycle_transition`.

Active-turn policy for v0:

```text
soft delete:
  blocked when any non-terminal direct turn exists

archive:
  blocked when any non-terminal direct turn exists

hide:
  allowed only if it does not detach or abort the active turn and the active
  turn remains visible through runtime status / active-turn affordance
```

Soft delete:

- must be blocked for any non-terminal direct turn;
- must require a main-issued confirmation id;
- must not abort active turns;
- must not delete canonical artifacts;
- should require a visible confirmation when triggered from the UI;
- should show a reversible state label, not a purge label.

Soft-delete confirmation:

```ts
type RendererSafeSoftDeletePrepareInput = {
  projectGeneration: number;
  expectedWorkbenchRevision: string;
  expectedOperationLedgerHeadDigest?: string;
  expectedLifecycleState: "active" | "hidden" | "archived" | "soft_deleted";
};

type RendererSafeSoftDeletePreparation = {
  confirmationId: string;
  expiresAt: string;
  rendererSafeThreadLabel: string;
  reversible: true;
};
```

The UI flow is:

```text
prepareSoftDelete(projectId, threadId)
  -> show confirmation
  -> runLifecycleAction(action = "soft_delete", confirmationId)
```

Main still revalidates active turns, lifecycle state, workbench revision,
operation ledger head, and thread ownership after receiving `confirmationId`.
The visible label must say `Soft delete`, not `Delete`.

Hard purge remains deferred.

## Graph And External References

Graph view consumes renderer-safe project graph projection rows.

Renderer-safe graph shape:

```ts
type RendererSafeThreadGraphSummary = {
  projectionId: string;
  status: "valid" | "stale" | "blocked" | "failed";
  nodes: RendererSafeThreadGraphNode[];
  edges: RendererSafeThreadGraphEdge[];
  counts: {
    directThreads: number;
    externalRefs: number;
    bridgeEdges: number;
    lineageEdges: number;
  };
  rawExposure: RendererSafeRawExposureFlags;
};

type RendererSafeThreadGraphNode =
  | {
      nodeKind: "direct_thread";
      threadId: string;
      title: string;
      lifecycleState: string;
      sourceClass: string;
    }
  | {
      nodeKind: "external_ref";
      externalRefId: string;
      refKind:
        | "chatgpt_thread_binding"
        | "file_artifact"
        | "handoff"
        | "imported_source"
        | string;
      displayTitle: string;
      targetId?: string; // local binding id only
      rendererSafeUrlHash?: string;
      urlStoredInDirectStore: false;
      transcriptImported: false;
      rightPaneMutated: false;
    };

type RendererSafeThreadGraphEdge = {
  edgeId: string;
  edgeKind:
    | "related"
    | "blocks"
    | "supersedes"
    | "derived_from"
    | "merge_preview_of"
    | "prune_preview_of"
    | "fork_preview_of"
    | "chatgpt_reference"
    | "import_source_reference";
  sourceKind: "direct_thread" | "external_ref" | "derived_projection";
  sourceId: string;
  targetKind: "direct_thread" | "external_ref" | "derived_projection";
  targetId: string;
  edgeState: "active" | "unlinked";
  lineage: boolean;
  rendererSafeSummary: string;
};
```

ChatGPT refs:

- cite local right-pane binding id only;
- do not duplicate raw URL into the direct store;
- do not store browser storage identifiers;
- do not import transcript text;
- do not mutate the right pane;
- do not make the ChatGPT thread a direct source thread.

Bridge actions:

```ts
type UserCreatableBridgeEdgeKind =
  | "related"
  | "blocks"
  | "supersedes"
  | "chatgpt_reference"
  | "import_source_reference";

type RendererThreadBridgeInput = {
  clientOperationId: string;
  projectGeneration: number;
  expectedWorkbenchRevision: string;
  expectedOperationLedgerHeadDigest?: string;
  expectedGraphProjectionDigest?: string;
  edgeKind: UserCreatableBridgeEdgeKind;
  sourceKind: "direct_thread" | "external_ref" | "derived_projection";
  sourceId: string;
  targetKind: "direct_thread" | "external_ref" | "derived_projection";
  targetId: string;
  expectedSourceLifecycleState?: "active" | "hidden" | "archived" | "soft_deleted";
  expectedTargetLifecycleState?: "active" | "hidden" | "archived" | "soft_deleted";
  metadata?: {
    label?: string;
    role?: "review" | "architecture" | "research" | "debugging" | "planning" | "custom";
  };
};
```

Metadata is renderer-safe and canonicalized in main. Duplicate bridge creation
with equivalent metadata is a no-op; duplicate creation with different metadata
requires a separate update operation or fails with `metadata_conflict`.

User-created bridge actions cannot create lineage-only edge kinds:

```text
derived_from
merge_preview_of
prune_preview_of
fork_preview_of
```

Those are system-created by preview builders or later materializers.

Endpoint validation by edge kind:

```text
chatgpt_reference:
  source = direct_thread or derived_projection
  target = external_ref(refKind=chatgpt_thread_binding)

import_source_reference:
  target = external_ref(refKind=imported_source)

related / blocks / supersedes:
  direct_thread <-> direct_thread by default
  derived_projection endpoints require explicit controller allowance

merge_preview_of / prune_preview_of / fork_preview_of / derived_from:
  controller-generated only
```

Invalid combinations fail with `unsupported_graph_endpoint` or
`unsupported_graph_edge_kind`.

UI affordance rules:

```text
Lineage edges:
  read-only
  system-created
  visually subdued or dashed
  no normal unlink button

Bridge edges:
  user-created
  active/unlinked state
  unlink action available when controller permits
```

Do not let users unlink derived lineage edges through the normal bridge unlink
API.

Graph projection states:

```text
valid:
  show graph and bridge actions if capability allows

stale:
  show stale badge; allow refresh/rebuild; block bridge/unlink if source digest
  cannot be trusted

blocked:
  do not render graph nodes/edges except safe error summary

failed:
  show safe failure summary; no graph mutations
```

## Preview Actions

Previews remain evidence-only:

```text
preview projection != context pack
preview projection != request manifest
preview projection != runnable session
preview projection != provider continuity
```

All preview requests must:

- use current valid renderer transcript projections as source;
- revalidate source projection status and digest immediately before commit;
- include the exact source projection ids and digests that the user saw;
- reject stale/blocked/unsafe projections;
- include project generation;
- include expected workbench revision;
- use `clientOperationId`;
- return a renderer-safe preview summary and projection id;
- never call provider transport;
- never create context packs or request manifests.

### Merge Preview

Input:

```ts
type RendererMergePreviewInput = {
  clientOperationId: string;
  projectGeneration: number;
  expectedWorkbenchRevision: string;
  expectedOperationLedgerHeadDigest?: string;
  sources: Array<{
    threadId: string;
    expectedLifecycleState: "active" | "hidden" | "archived" | "soft_deleted";
    expectedRendererProjectionId: string;
    expectedRendererProjectionDigest: string;
  }>;
  ordering?: "source-order" | "updated-at" | "manual";
  includeHidden?: boolean;
  includeArchived?: boolean;
  includeSoftDeleted?: false;
};
```

Rules:

- cap source thread count;
- show source thread section headers;
- preserve stable preview item keys;
- cite source thread id, source projection id, and stable source item keys;
- show truncation if caps are hit;
- mark `usableForContextBuild=false`;
- mark `providerContinuityAvailable=false`.

### Prune Preview

Input:

```ts
type RendererPrunePreviewInput = {
  clientOperationId: string;
  projectGeneration: number;
  expectedWorkbenchRevision: string;
  expectedOperationLedgerHeadDigest?: string;
  threadId: string;
  expectedLifecycleState: "active" | "hidden" | "archived" | "soft_deleted";
  expectedRendererProjectionId: string;
  expectedRendererProjectionDigest: string;
  excludedStableSourceItemKeys: string[];
  reason?: string;
};
```

Rules:

- source rollout/session artifacts are not modified;
- omitted items are represented with structured omission markers;
- omission markers remain visible;
- omitted counts include item count, turn count, role counts, tool-result
  counts, and diagnostic counts where available;
- preview does not become context.

### Fork Preview

Input:

```ts
type RendererForkPreviewInput = {
  clientOperationId: string;
  projectGeneration: number;
  expectedWorkbenchRevision: string;
  expectedOperationLedgerHeadDigest?: string;
  sourceKind: "direct_thread" | "derived_projection";
  sourceId: string;
  expectedSourceProjectionId: string;
  expectedSourceProjectionDigest: string;
  expectedLifecycleState?: "active" | "hidden" | "archived" | "soft_deleted";
  selectedStableSourceItemKeys?: string[];
  seedPolicyId?: "fork_preview_seed_metadata_only@1";
};
```

Rules:

- fork preview produces renderer-safe seed metadata only;
- `runnableNow=false`;
- `contextPackWritten=false`;
- `requestManifestWritten=false`;
- `directSessionCreated=false`;
- no provider request is sent;
- "Start fork" is not implemented in this bundle.

## Preview Read Shape

Preview reads are paged:

```ts
type DirectPreviewProjectionReadParams = {
  offset?: number;
  limit?: number;
  includeSourceRefs?: boolean;
};
```

`readThreadProjection` uses equivalent `offset` / `limit` params and does not
return large arrays by default.

```ts
type RendererSafeThreadPreview = {
  projectionId: string;
  projectionKind: "merge_preview" | "prune_preview" | "fork_preview";
  status: "valid" | "stale" | "blocked" | "failed";
  source: {
    sourceThreadIds: string[];
    sourceProjectionIds: string[];
    sourceDigest: string; // renderer-safe digest/evidence key only if exposed
  };
  continuity: {
    usableForContextBuild: false;
    providerContinuityAvailable: false;
    composerEnabled: false;
    runnableNow: false;
  };
  caps: {
    truncated: boolean;
    omittedCounts: Record<string, number>;
  };
  items: RendererSafePreviewItem[];
  page: {
    offset: number;
    limit: number;
    total: number;
  };
  rawExposure: RendererSafeRawExposureFlags;
};
```

Preview detail must be virtualized or paged. Do not render thousands of rows at
once if the projection is large.

## Operation History

The workbench includes an operation history panel.

Operation history is paged and filterable:

```ts
type DirectThreadOperationHistoryParams = {
  offset?: number;
  limit?: number;
  operationTypes?: string[];
  targetThreadId?: string;
  statuses?: string[];
};
```

Renderer-safe shape:

```ts
type RendererSafeThreadOperationSummary = {
  operationId: string;
  operationType: string;
  status:
    | "planned"
    | "confirmed"
    | "committed"
    | "failed"
    | "rolled_back"
    | "repaired";
  requestedAt: string;
  committedAt?: string;
  rendererSafeTargets: Array<{
    targetKind: string;
    targetId: string;
    label?: string;
  }>;
  effectCount: number;
  effects: Array<{
    effectKind: string;
    targetKind: string;
    targetId: string;
    rendererSafeSummary: string;
  }>;
  blockerCode?: DirectThreadWorkbenchBlockerCode;
};
```

Never expose:

- raw operation input payloads;
- raw source paths;
- raw ChatGPT URLs;
- raw source file hashes;
- raw error payloads;
- stack traces;
- raw backend requests or responses.

## Blocker Codes

Use stable renderer-safe blocker codes:

```ts
type DirectThreadWorkbenchBlockerCode =
  | "project_missing"
  | "project_generation_stale"
  | "workbench_revision_stale"
  | "operation_ledger_changed"
  | "thread_missing"
  | "thread_project_mismatch"
  | "thread_lifecycle_changed"
  | "invalid_lifecycle_transition"
  | "confirmation_required"
  | "confirmation_expired"
  | "active_direct_turn_exists"
  | "store_disabled"
  | "store_rebuilding"
  | "store_corrupt"
  | "operation_ledger_corrupt"
  | "operation_in_progress"
  | "client_operation_id_conflict"
  | "renderer_projection_missing"
  | "renderer_projection_stale"
  | "renderer_projection_blocked"
  | "renderer_projection_unsafe"
  | "source_project_generation_stale"
  | "preview_source_thread_count_invalid"
  | "preview_caps_exceeded"
  | "metadata_conflict"
  | "lineage_cycle_detected"
  | "external_ref_not_found"
  | "unsupported_graph_edge_kind"
  | "unsupported_graph_endpoint"
  | "raw_path_exposed"
  | "raw_url_exposed"
  | "raw_credentials_exposed"
  | "provider_transport_forbidden"
  | "app_server_spawn_forbidden";
```

User-facing labels can be shorter, but tests and diagnostics should use stable
codes.

## Degraded And Read-Only States

If the operation ledger is corrupt:

```text
canReadThreads = true if existing renderer-safe projections are valid
canReadGraph = false unless graph projection is verified safe
canReadOperations = true only as safe summary, if possible
canRunLifecycleActions = false
canCreateBridge = false
canCreateMergePreview = false
canCreatePrunePreview = false
canCreateForkPreview = false
```

If the direct thread store is disabled:

```text
show disabled state
do not offer actions
do not read raw session artifacts directly from renderer
```

If projections are stale:

```text
display stale badge
allow refresh/rebuild action if store health allows
do not create previews from stale projections
```

If a thread has active direct turns:

```text
soft delete disabled
archive disabled
hide allowed only with active-turn status still visible
turn is not aborted
```

## Runtime Status Integration

Extend direct runtime status with a thread workbench summary:

```ts
type DirectRuntimeStatusThreadWorkbench = {
  available: boolean;
  health: "healthy" | "degraded" | "rebuilding" | "corrupt" | "disabled";
  readOnly: boolean;
  canMutate: boolean;
  counts: {
    active: number;
    hidden: number;
    archived: number;
    softDeleted: number;
    activeEdges: number;
    previewAttempts: number;
  };
  degradedReason?: DirectThreadWorkbenchBlockerCode;
  rawPathExposed: false;
  dbPathExposed: false;
};
```

This status is informational. It does not enable the Codex composer and does
not decide runtime turn start.

## Renderer State

Renderer state should isolate the workbench:

```ts
type DirectThreadWorkbenchRendererState = {
  projectId: string;
  projectGeneration: number;
  requestGeneration: number;
  loading: boolean;
  lastError?: string;
  filters: DirectThreadWorkbenchFilters;
  snapshot?: RendererSafeThreadWorkbenchSnapshot;
  selectedThreadId?: string;
  selectedProjectionId?: string;
  selectedPreviewId?: string;
  pendingOperationIds: string[];
};
```

Rules:

- project switch increments generation and clears selected ids unless the same
  id exists in the next project snapshot;
- stale async results are ignored;
- pending operation state is shown per action;
- buttons are disabled while their operation is pending;
- renderer never stores raw source paths, raw URLs, raw request bodies, raw
  backend frames, or raw JSONL.

Direct-owned thread controls must remain visually and structurally separate
from ChatGPT linking affordances:

```text
Direct thread list != ChatGPT thread deck
Direct graph external ref != ChatGPT conversation import
Bridge to ChatGPT binding != open/mutate right pane
```

If the UI needs a ChatGPT-related section, label it as:

```text
External references
```

not:

```text
ChatGPT threads
```

Accessibility and destructive-action constraints:

- soft delete must be keyboard reachable and require confirmation;
- restore must be obvious on soft-deleted detail;
- destructive/reversible labels must say `Soft delete`, not `Delete`;
- tooltips are not the only source of meaning for destructive actions;
- pending operation state must be visually apparent;
- icon-only controls need accessible names.

## UI Action Authority

Renderer action buttons are not authority. Use one of two safe patterns:

```text
Pattern A:
  renderer sends clientOperationId + expected state/digest
  main revalidates everything

Pattern B:
  main issues short-lived action tokens in snapshot
  renderer sends actionTokenId + clientOperationId
  main still revalidates everything
```

For this bundle, Pattern A is sufficient if every mutation revalidates in main.
Do not allow a stale row button to mutate a thread after project switch,
lifecycle change, or source projection change.

Operation results include a refresh contract:

```ts
type RendererSafeThreadOperationResult = {
  operationId: string;
  status: "committed" | "failed" | "already_applied";
  blockerCode?: DirectThreadWorkbenchBlockerCode;
  changed: {
    threadIds: string[];
    projectionIds: string[];
    edgeIds: string[];
    previewIds: string[];
  };
  nextWorkbenchRevision?: string;
  refreshRequired: boolean;
  snapshotPatch?: RendererSafeThreadWorkbenchSnapshotPatch;
  meta: RendererSafeThreadWorkbenchResponseMeta;
};
```

For v0, prefer:

```text
refreshRequired = true
```

after every committed mutation. The renderer should follow with
`getSnapshot`. Do not rely on optimistic local list updates for authority.

## Raw Exposure Rules

The workbench must not place any of the following in renderer state, DOM
attributes, browser storage, operation history, preview rows, exported reports,
or handoff text:

- raw local filesystem paths;
- raw WSL/Linux workspace paths;
- raw ChatGPT URLs;
- raw source file hashes;
- raw imported JSONL;
- raw backend request or response frames;
- auth headers;
- cookies;
- access tokens;
- refresh tokens;
- session ids;
- stack traces with private paths;
- context pack text;
- request manifest raw bodies.

Renderer-safe evidence keys may be local HMAC/evidence-key values, not raw
private-file hashes.

## No Transport Rule

Thread workbench operations must never call:

```text
DirectLiveTextController turn start
Responses transport
read-only tool continuation transport
checkpoint continuation transport
codex app-server launcher
right-pane ChatGPT automation
```

Preview operations must not create:

```text
context pack
request manifest
direct-native session
provider continuity handle
```

Use sentinels in smoke tests to prove this.

Right-pane mutation sentinel:

```text
Workbench tests replace ChatGPT pane load/navigate/open-thread automation with
a throw-on-call sentinel.
```

Creating a bridge to a ChatGPT binding must not navigate, reload, select, or
mutate the right ChatGPT pane. The right pane changes only through existing
explicit right-pane thread-deck selection.

## Implementation Phases

### Phase -1: Controller Contract

- Define renderer-safe snapshot/read/action types.
- Add `workbenchRevision`, `operationLedgerHeadDigest`, and projection digests.
- Add expected state/digest fields to mutation inputs.
- Define stable blocker codes.
- Define raw-exposure flags.
- Decide whether to use action tokens now or rely on main revalidation.
- Use Pattern A for v0 with strict main revalidation.
- Add no-provider/no-app-server/right-pane-mutation sentinel hooks for
  workbench tests.

### Phase 0: Main IPC Controller

- Add `DirectThreadWorkbenchController`.
- Add compact, paged `getSnapshot`.
- Add thread projection reads through existing projection APIs.
- Add project projection reads for lifecycle/graph/previews.
- Add preview projection reads.
- Add paged operation history reads.
- Add explicit refresh/rebuild IPC.
- Validate project id and project generation on every call.
- Validate workbench revision and operation ledger head for mutations.

### Phase 1: Lifecycle UI

- Add lifecycle filters.
- Render direct thread summaries.
- Add hide/unhide/archive/restore/soft-delete/restore-soft-deleted actions.
- Disable soft delete and archive for active turns.
- Add prepare/confirm/execute flow for soft delete.
- Refresh snapshot after mutation.

### Phase 2: Graph UI

- Render graph nodes/edges from safe projection rows.
- Add ChatGPT binding external ref display by local binding id.
- Add user-creatable edge-kind allowlist.
- Add edge-kind endpoint validation.
- Add bridge and unlink actions.
- Keep bridge and lineage relationships visually distinct.
- Keep lineage edges read-only.
- Reject raw URL input.
- Add right-pane mutation sentinel.

### Phase 3: Preview Builders

- Add merge preview builder UI with exact source projection ids/digests.
- Add prune preview selection from transcript rows with exact source projection
  id/digest.
- Add fork preview metadata UI with exact source projection id/digest.
- Render preview detail with pagination/virtualization.
- Show non-runnable/context-disabled badges.

### Phase 4: Operation History

- Render paged operation history panel.
- Show operation effects and blocker codes.
- Keep raw input payloads private.
- Link operation entries to affected thread/edge/preview when safe.

### Phase 5: Degraded Modes

- Add read-only degraded workbench state.
- Add stale projection badges and rebuild/refresh affordance.
- Add graph stale/blocked/failed behavior.
- Disable mutating actions on corrupt ledger or store.
- Ensure normal transcript reads remain available by explicit safe projection id
  when allowed.

### Phase 6: Smokes

Add direct smoke coverage for:

- snapshot raw-exposure flags;
- project-generation stale rejection;
- workbench revision stale rejection;
- operation ledger head changed between snapshot and mutation;
- renderer stale response discard helper;
- hide/unhide/archive/restore actions through IPC/controller;
- soft delete blocked for active direct turn;
- archive blocked for active direct turn;
- soft-delete confirmation nonce required;
- hidden/archived/soft-deleted filters;
- operation history safe summary;
- operation history paging;
- ChatGPT external ref contains no raw URL/transcript;
- bridge/unlink through controller;
- user bridge cannot create lineage-only edge kinds;
- invalid edge endpoint combinations are rejected;
- lineage/bridge distinction in graph read;
- merge preview read with source projection ids/digests and stable item keys;
- prune preview omission markers;
- fork preview `runnableNow=false`;
- preview read paging;
- local text query marked partial/local only;
- graph stale/blocked behavior;
- preview operations create no context packs, request manifests, sessions, or
  provider requests;
- raw-exposure scan over serialized renderer state, DOM attributes,
  localStorage/sessionStorage, exported reports, and handoff text;
- provider/app-server/right-pane sentinels are not invoked.

## Acceptance Criteria

- The middle-plane `Threads` tab exposes a direct thread workbench for selected
  project state.
- Workbench snapshots are renderer-safe and contain no raw paths, raw URLs,
  raw hashes, raw JSONL, raw backend frames, auth material, context text, or raw
  request bodies.
- Workbench snapshots include `workbenchRevision`,
  `operationLedgerHeadDigest`, and relevant projection digests.
- Every IPC call validates project id and project generation.
- Mutating IPC inputs include `expectedWorkbenchRevision` or equivalent
  expected source digests; project generation alone is not the stale-state
  guard.
- Renderer discards stale async responses after project switch or request
  generation change.
- Lifecycle actions are executed only through main-process controller APIs.
- Lifecycle transition rules are enforced from a concrete transition table.
- Soft delete requires a main-issued confirmation id/nonce and remains
  reversible.
- Soft delete is disabled and rejected while a target thread has non-terminal
  direct turns.
- Archive is disabled and rejected while a target thread has non-terminal
  direct turns.
- Hidden, archived, and soft-deleted filters behave predictably.
- Operation idempotency conflict returns `client_operation_id_conflict`.
- Operation history is paged, renderer-safe, and uses stable operation/effect
  summaries.
- Graph view can display direct thread nodes, external refs, bridge edges, and
  lineage edges without importing ChatGPT content.
- User-created bridge actions cannot create lineage-only edge kinds such as
  `merge_preview_of`, `prune_preview_of`, `fork_preview_of`, or
  `derived_from`.
- Graph edge endpoint combinations are validated by edge kind.
- ChatGPT external refs cite local binding ids/evidence keys only; raw URLs and
  transcript content are not stored or rendered by the direct workbench.
- Workbench bridge creation to ChatGPT refs does not navigate, reload, select,
  or mutate the right ChatGPT pane.
- Merge/prune/fork preview inputs include exact expected source projection ids
  and digests.
- Merge preview, prune preview, and fork preview are non-runnable and
  `usableForContextBuild=false`.
- Prune preview omission markers remain visible and structured.
- Fork preview does not write a context pack, request manifest, direct session,
  or provider request.
- Preview detail and preview reads are paged or virtualized.
- `textQuery` exposes whether it is local-current-snapshot filtering or indexed
  search.
- Graph stale/blocked/failed states have explicit UI behavior.
- Corrupt operation ledger or direct thread store puts mutating workbench
  actions into read-only degraded mode.
- Raw-exposure tests scan serialized renderer state, DOM attributes, browser
  storage, operation history, preview rows, exported reports, and handoff text.
- IPC is exposed under a narrow namespace and never exposes generic store/table
  access.
- No lifecycle, graph, preview, or operation-history action invokes provider
  transport or spawns app-server.

## Final Meaning

Passing this bundle should mean:

```text
Direct-owned threads can be inspected, filtered, lifecycle-managed, bridged,
preview-merged, preview-pruned, and preview-forked through a renderer-safe
middle-plane workbench.
```

It should not mean:

```text
derived views are runnable
preview projections are prompt context
fork preview starts a provider request
merge/prune rewrites source rollouts
hard purge exists
right-pane ChatGPT transcript is imported
right-pane ChatGPT is navigated or mutated by bridge creation
direct mode is production
app-server can be removed
```
