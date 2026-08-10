# Direct Thread Evidence Workbench And Derived Views Spec

Status: draft PR 6 implementation specification for the long-lived
`codex/direct-chatgpt-harness` branch.

Related docs:

- [CODEX_DIRECT_HARNESS_ODEU_MATRIX_v0_2.md](./CODEX_DIRECT_HARNESS_ODEU_MATRIX_v0_2.md)
- [CODEX_DIRECT_HARNESS_PR_AFFINITY_BUNDLES_v0.md](./CODEX_DIRECT_HARNESS_PR_AFFINITY_BUNDLES_v0.md)
- [DIRECT_THREAD_LOG_AND_PROJECTION_STORE_SPEC.md](./DIRECT_THREAD_LOG_AND_PROJECTION_STORE_SPEC.md)
- [DIRECT_THREAD_GRAPH_AND_CONTROL_PREVIEWS_SPEC.md](./DIRECT_THREAD_GRAPH_AND_CONTROL_PREVIEWS_SPEC.md)
- [DIRECT_THREAD_WORKBENCH_UI_AND_IPC_SPEC.md](./DIRECT_THREAD_WORKBENCH_UI_AND_IPC_SPEC.md)
- [DIRECT_RENDERER_TRANSCRIPT_PROJECTION_SPEC.md](./DIRECT_RENDERER_TRANSCRIPT_PROJECTION_SPEC.md)
- [DIRECT_IMPORT_UX_STATUS_SPEC.md](./DIRECT_IMPORT_UX_STATUS_SPEC.md)
- [DIRECT_IMPLEMENTATION_LANE_UI_AND_OPERATION_HISTORY_SPEC.md](./DIRECT_IMPLEMENTATION_LANE_UI_AND_OPERATION_HISTORY_SPEC.md)

## Verdict

This is the next PR after the Direct implementation-lane UI/status bundle.

PRs 1-5 proved and exposed the implementation lane:

```text
real-provider tool proof
  -> recovery and replay safety
  -> bounded iterative repair
  -> workspace mutation truth
  -> implementation-lane UI/status/history
```

PR 6 should now make the direct thread evidence store usable as a safe
workbench:

```text
direct/imported thread evidence
  -> lifecycle and graph projections
  -> merge/prune/fork previews
  -> external refs
  -> operation history
  -> renderer-safe non-runnable workbench views
```

This PR does not add provider authority. It organizes evidence.

## Matrix Scope

Rows:

```text
G1-G7
G10
scaffold only for G11
C5
F8
F10
```

Explicitly out of scope:

```text
G8 start fresh fork
G9 derived preview fork execution
provider continuity from imported or derived views
right-pane ChatGPT transcript import
hard purge/delete
```

G8/G9 belong to the follow-on fresh-fork runtime PR. PR 6 may display existing
preview seed metadata and may show a disabled or separated "future fresh fork"
affordance only if it is unmistakably non-authoritative in this PR.

## Core Law

```text
thread evidence workbench != provider-runnable context
derived preview != canonical rollout truth
external ref != imported transcript
renderer selection != thread operation authority
operation history != retry/resume/replay authority
soft delete != hard purge
preview seed != fresh fork execution
```

The direct thread store owns durable evidence. The workbench displays and
organizes that evidence through renderer-safe projections. It never invents
provider continuity and never treats a projected view as the source dialogue.

## Product Boundary

Good:

```text
left/middle shell workbench only
project-scoped direct thread evidence
legacy Codex JSONL import evidence
direct-native thread list/detail
lifecycle controls
thread graph edges
external ChatGPT refs by binding id only
merge/prune/fork preview projections
operation history for thread controls
non-runnable derived views
renderer-safe source refs and omission markers
```

Not included:

```text
fresh fork provider execution
derived preview provider execution
merge materialization into canonical rollout
prune materialization into canonical rollout
right-pane ChatGPT transcript content import
ChatGPT browser mutation
handoff queue mutation
app-server fallback inside direct operations
hard purge/delete execution
context maintenance/memory/baton
semantic broker/governance enforcement
sub-agent observability
```

## Existing Substrate

This PR builds on existing direct-branch pieces:

```text
DirectThreadStore
direct_threads lifecycle state
direct_operation_effects
direct_thread_edges
direct_external_refs
project/current projection pointers
renderer transcript projections
import materialization reports
merge/prune/fork preview projection builders
thread workbench IPC handlers
implementation-lane operation-history projection conventions
```

The implementation should harden, normalize, and expose these as one coherent
PR 6 workbench. It should not create a second thread store or a second
operation-history model.

## Workbench Invariant

The workbench must preserve two simultaneous truths:

```text
source dialogue:
  what happened in direct/imported threads

workbench organization:
  how the app currently hides, archives, links, previews, or references them
```

Lifecycle and derived-view changes may alter workbench organization. They must
not rewrite the source dialogue.

## Projection Schemas

### Workbench Projection

```ts
type DirectThreadEvidenceWorkbenchProjection = {
  schema: "direct_thread_evidence_workbench_projection@1";
  meta: DirectThreadEvidenceWorkbenchProjectionMeta;

  projectId: string;
  workbenchRevision: string;
  operationLedgerHeadDigest: string;
  lifecycleProjectionDigest?: string;
  graphProjectionDigest?: string;
  previewIndexDigest?: string;

  store: DirectThreadWorkbenchStoreStatus;
  capabilities: DirectThreadWorkbenchCapabilities;
  selectedScope: DirectThreadWorkbenchScope;
  filters: DirectThreadWorkbenchFilters;

  counts: {
    directThreads: number;
    importedThreads: number;
    hiddenThreads: number;
    archivedThreads: number;
    softDeletedThreads: number;
    externalRefs: number;
    graphEdges: number;
    previews: number;
    operations: number;
  };

  threads: DirectThreadEvidenceSummary[];
  graph: DirectThreadGraphSummary;
  previews: DirectDerivedPreviewSummary[];
  externalRefs: DirectExternalRefSummary[];
  operationHistory: DirectThreadWorkbenchOperationRow[];

  rendererSafe: true;
  rawPathsIncluded: false;
  rawUrlsIncluded: false;
  rawTranscriptTextIncluded: false;
  rawProviderPayloadIncluded: false;
  rawSourceJsonIncluded: false;
  rawDigestsIncluded: false;
};
```

### Projection Meta

```ts
type DirectThreadEvidenceWorkbenchProjectionMeta = {
  generatedAt: string;
  uiProjectionGeneration: number;
  sourceDigest: string;
  projectGeneration: number;
  schemaVersion: "direct_thread_evidence_workbench_projection@1";
  sourceProjectionDigests: string[];
  operationLedgerHeadDigest: string;
  stale: boolean;
  staleReason?: string;
};
```

Renderer actions must submit:

```text
projectId
projectGeneration
workbenchRevision
operationLedgerHeadDigest
uiProjectionGeneration
clientOperationId
target ids / preview ids / ref ids
```

Main revalidates all of them before any workbench mutation.

`workbenchRevision` and `uiProjectionGeneration` have different jobs:

```text
workbenchRevision:
  durable state version derived from operation ledger and projection source
  digests

uiProjectionGeneration:
  renderer delivery generation for stale async response discard
```

Main rejects stale inputs with distinct blocker codes:

```text
workbench_revision_stale
ui_projection_generation_stale
operation_ledger_changed
```

Projection pointers are kind-specific. Do not use one generic current pointer.

```text
current_renderer_transcript_projection_id
current_thread_lifecycle_projection_id
current_thread_graph_projection_id
current_merge_preview_projection_id
current_prune_preview_projection_id
current_fork_preview_projection_id
```

A merge/prune/fork preview must never become the current renderer transcript,
and no preview pointer may become context or provider continuity.

### Store Status

```ts
type DirectThreadWorkbenchStoreStatus = {
  available: boolean;
  health:
    | "healthy"
    | "degraded"
    | "rebuilding"
    | "corrupt"
    | "disabled";
  mode:
    | "disabled"
    | "index_only"
    | "projection_read"
    | "context_build_required";
  readOnly: boolean;
  mutationBlockedReason?: string;
  currentProjectionPointersValid: boolean;
  rawStorePathIncluded: false;
};
```

Degraded state must expose precise capabilities, not just `readOnly`:

```ts
type DirectWorkbenchDegradedCapabilities = {
  canReadThreadsBySafeProjection: boolean;
  canReadGraph: boolean;
  canReadPreviews: boolean;
  canReadOperations: boolean;
  canRunLifecycleActions: boolean;
  canCreateExternalRefs: boolean;
  canCreateBridge: boolean;
  canCreatePreview: boolean;
  canRefreshProjection: boolean;
};
```

Snapshot reads may report stale/degraded state. They must not silently rebuild
projections.

```text
read_workbench_snapshot:
  may return stale status
  may not mutate projections

refresh/rebuild endpoint:
  may update projection state after validation
```

Explicit maintenance APIs:

```text
refresh_workbench_projection
rebuild_lifecycle_projection
rebuild_graph_projection
rebuild_preview_index
```

### Blocker Codes

```ts
type DirectThreadEvidenceWorkbenchBlockerCode =
  | "project_generation_stale"
  | "workbench_revision_stale"
  | "ui_projection_generation_stale"
  | "operation_ledger_changed"
  | "thread_missing"
  | "thread_project_mismatch"
  | "thread_lifecycle_changed"
  | "invalid_lifecycle_transition"
  | "active_direct_turn_exists"
  | "soft_delete_confirmation_required"
  | "soft_delete_confirmation_expired"
  | "client_operation_id_conflict"
  | "store_rebuilding"
  | "store_corrupt"
  | "operation_ledger_corrupt"
  | "renderer_projection_missing"
  | "renderer_projection_stale"
  | "renderer_projection_blocked"
  | "renderer_projection_unsafe"
  | "preview_caps_exceeded"
  | "source_projection_digest_mismatch"
  | "external_ref_binding_missing"
  | "unsupported_graph_edge_kind"
  | "unsupported_graph_endpoint"
  | "lineage_cycle_detected"
  | "provider_transport_forbidden"
  | "app_server_spawn_forbidden"
  | "right_pane_mutation_forbidden"
  | "handoff_mutation_forbidden"
  | "raw_exposure_blocked";
```

If the store is degraded/corrupt/rebuilding, reads may still show safe stale
status, but lifecycle/preview/external-ref mutations are blocked unless the
controller has a specific safe maintenance operation.

Soft-deleted evidence has a tombstone view:

```ts
type DirectThreadTombstoneSummary = {
  threadId: string;
  lifecycleState: "soft_deleted";
  sourceClass: string;
  displayTitle: string;
  deletedAt?: string;
  deletedByOperationId: string;
  canRestore: boolean;
  hardPurgeAvailable: false;
  rendererSafe: true;
  rawPathIncluded: false;
};
```

## Thread Evidence Summaries

```ts
type DirectThreadEvidenceSummary = {
  threadId: string;
  displayTitle: string;
  sourceClass:
    | "direct-native"
    | "legacy-codex-jsonl-import"
    | "import-checkpoint"
    | "derived-preview"
    | "unknown";
  lifecycleState:
    | "active"
    | "hidden"
    | "archived"
    | "soft_deleted";
  runnableState:
    | "runnable_direct_thread"
    | "not_runnable_imported_evidence"
    | "not_runnable_derived_preview"
    | "not_runnable_external_ref"
    | "blocked";
  activeTurnCount: number;
  operationCount: number;
  edgeCount: number;
  previewCount: number;
  lastUpdatedAt?: string;
  evidenceKeys: string[];
  sourceProjectionDigest?: string;
  rendererSafe: true;
};
```

Rules:

- Imported evidence is not provider continuity.
- Derived previews are not runnable.
- Soft-deleted threads stay out of default lists but remain recoverable through
  tombstone/status views.
- A thread with an active direct turn cannot be archived, soft-deleted, or used
  as a destructive operation target.

## Derived Preview Model

```ts
type DirectDerivedPreviewKind =
  | "merge-preview"
  | "prune-preview"
  | "fork-preview";

type DirectDerivedPreviewSummary = {
  previewId: string;
  kind: DirectDerivedPreviewKind;
  status:
    | "valid"
    | "stale"
    | "blocked"
    | "failed";
  sourceThreadIds: string[];
  sourceProjectionDigests: string[];
  previewProjectionDigest: string;
  rowCount: number;
  omittedRowCount: number;
  sourceRefCount: number;
  nonRunnable: true;
  runnableReason: "preview_only";
  canStartFreshForkInThisPr: false;
  rendererSafeSummary: string;
  rawTranscriptTextIncluded: false;
  rawProviderContinuityIncluded: false;
};
```

Preview law:

```text
merge preview:
  combines renderer-safe rows and source refs only

prune preview:
  includes omission markers, source refs, and caps

fork preview:
  shows seed metadata only

all previews:
  non-runnable in PR 6
```

Preview detail may include renderer-safe transcript row snippets only if those
snippets already come from an approved renderer transcript projection. It must
not expose raw source JSONL, raw context pack text, raw provider frames, raw
request bodies, raw absolute paths, or raw source hashes.

Preview attempts are distinct from current valid previews:

```text
valid preview:
  may replace the current preview pointer for its preview kind and context

blocked/failed preview:
  recorded as an attempt
  does not replace the previous valid current preview

force rebuild:
  supersedes the previous valid preview only after a successful valid write
```

Preview source digests are canonical:

```ts
type DirectPreviewSourceDigestInput = {
  schema:
    | "merge_preview_source@1"
    | "prune_preview_source@1"
    | "fork_preview_source@1";
  projectId: string;
  sourceThreadIds: string[];
  sourceRendererProjectionIds: string[];
  sourceRendererProjectionDigests: string[];
  stableSourceItemKeys: string[];
  sourceLifecycleStates: Record<string, DirectThreadLifecycleState>;
  operationLedgerHeadDigest: string;
  previewCapPolicyDigest: string;
  previewBuilderVersion: string;
  rawExposurePolicyVersion: string;
};
```

Digest inputs exclude timestamps, client operation ids, raw text, raw paths, raw
source hashes, and raw provider payloads.

Preview rows use stable source keys:

```ts
type DirectDerivedPreviewRow = {
  previewRowId: string;
  stablePreviewRowKey: string;
  sourceRefs: Array<{
    threadId: string;
    rendererProjectionId: string;
    stableSourceItemKey: string;
  }>;
  rendererSafeTextPreview?: string;
};
```

Prune previews must preserve omission truth:

```ts
type DirectPruneOmissionMarker = {
  markerId: string;
  sourceThreadId: string;
  position:
    | { beforeStableSourceItemKey: string }
    | { afterStableSourceItemKey: string }
    | { rangeStartStableKey: string; rangeEndStableKey: string };
  omitted: {
    itemCount: number;
    turnCount: number;
    roleCounts: Record<string, number>;
    diagnosticCount: number;
    toolResultCount: number;
    textCharCount?: number;
  };
  reason?: string;
  rendererSafe: true;
};
```

Preview detail reads are paged:

```ts
readPreviewProjection(projectId, previewId, {
  offset: number;
  limit: number;
  includeSourceRefs?: boolean;
});
```

The default snapshot lists preview summaries only. Large preview details are
fetched through explicit detail APIs.

## External References

```ts
type DirectExternalRefSummary = {
  refId: string;
  refKind:
    | "chatgpt-thread-binding"
    | "legacy-codex-source"
    | "handoff-evidence"
    | "workspace-artifact"
    | "unknown";
  displayLabel: string;
  bindingId: string;
  targetDigest: string;
  importedContent: false;
  rawUrlIncluded: false;
  rawPathIncluded: false;
  contributesToDirectReadiness: false;
};
```

ChatGPT references are binding ids only. The workbench may open or focus an
existing right-pane ChatGPT thread through existing shell controls, but the
external ref itself:

```text
does not import transcript content
does not mutate ChatGPT
does not become direct context
does not prove direct continuity
```

Creating, editing, or removing an external ref must not navigate or mutate the
right pane. A separate explicit "Open bound ChatGPT thread" control may ask the
existing shell thread-deck controller to focus a known binding, but the graph or
external-ref operation itself is not a navigation action.

Handoff external refs, if present, are citation-only:

```text
may cite handoff id/evidence key
must not mark copied/opened/submitted/dismissed
must not target a ChatGPT thread
must not contribute to Direct readiness
```

Imported source identity is privacy-preserving:

```ts
type DirectLegacyCodexSourceRef = {
  externalRefId: string;
  sourceDisplayName: string;
  sourceEvidenceKey: string;
  sourceClass: "legacy-codex-jsonl";
  rawSourcePathIncluded: false;
  rawSourceShaIncluded: false;
};
```

## Operation History

Use the PR 5 operation-history conventions:

```ts
type DirectThreadWorkbenchOperationRow = {
  rowId: string;
  family:
    | "thread-lifecycle"
    | "graph-edge"
    | "external-ref"
    | "derived-preview"
    | "import"
    | "projection-maintenance"
    | "tombstone";
  eventKind: string;
  status: "planned" | "committed" | "failed" | "blocked" | "repaired";
  rendererSafeSummary: string;
  artifactRefs: DirectRendererSafeArtifactRef[];
  evidenceKeys: string[];
  actionability: {
    actionable: false;
    allowedActions: [];
    reason: "history_is_read_only";
  };
};
```

Operation history is never a retry/resume/replay/revert control. It is evidence
and audit only.

Full operation history is paged:

```ts
type DirectThreadWorkbenchOperationHistoryRequest = {
  projectId: string;
  cursor?: string;
  limit: number;
  familyFilter?: DirectThreadWorkbenchOperationRow["family"][];
  targetThreadId?: string;
};

type DirectThreadWorkbenchOperationHistoryPage = {
  rows: DirectThreadWorkbenchOperationRow[];
  nextCursor?: string;
  hasMore: boolean;
  sourceLedgerHeadDigest: string;
  pageDigest: string;
};
```

The default workbench snapshot includes a compact recent-operation summary only.
It must not load the entire operation history.

## Lifecycle Operations

Allowed:

```text
hide_thread
unhide_thread
archive_thread
restore_thread
soft_delete_thread
restore_soft_deleted_thread
```

Disabled/scaffold only:

```text
hard_purge_thread
```

Lifecycle transitions are explicit:

```ts
const DIRECT_THREAD_LIFECYCLE_TRANSITIONS = {
  active: {
    hide_thread: "hidden",
    archive_thread: "archived",
    soft_delete_thread: "soft_deleted",
  },
  hidden: {
    unhide_thread: "active",
    archive_thread: "archived",
    soft_delete_thread: "soft_deleted",
  },
  archived: {
    restore_thread: "active",
    soft_delete_thread: "soft_deleted",
  },
  soft_deleted: {
    restore_soft_deleted_thread: "active",
  },
};
```

`restore_thread` is not valid for `soft_deleted`; only
`restore_soft_deleted_thread` may restore a soft-deleted thread.

Active-turn behavior:

```text
activeTurnCount > 0:
  hide_thread may be allowed only if the active-turn status remains visible
  archive_thread blocked
  soft_delete_thread blocked
  destructive targets blocked
```

Soft delete requires a main-issued confirmation nonce:

```ts
type DirectSoftDeleteConfirmation = {
  confirmationId: string;
  projectId: string;
  threadId: string;
  expectedLifecycleState: DirectThreadLifecycleState;
  workbenchRevision: string;
  operationLedgerHeadDigest: string;
  expiresAt: string;
};
```

`soft_delete_thread` rejects without a current confirmation id.

Soft-delete UX copy must use "Soft delete" and state that the action is
reversible. Do not label it as plain "Delete". Hard purge is absent or disabled
with no execution path.

Every lifecycle mutation must:

```text
1. acquire the project workbench mutation lock
2. validate project generation and workbench revision
3. validate thread ownership and lifecycle transition
4. validate activeTurnCount == 0 for archive/soft-delete/destructive lifecycle moves
5. validate operation ledger head
6. record append-only operation evidence
7. update rebuildable lifecycle indexes
8. refresh affected renderer-safe projections
```

Conflict handling:

```text
same clientOperationId + same action/target:
  return idempotent snapshot

same clientOperationId + different action/target:
  client_operation_id_conflict

stale workbenchRevision:
  workbench_projection_stale

thread already in target lifecycle:
  idempotent snapshot

thread has active turn:
  active_direct_turn_exists
```

## Graph And Preview Operations

Allowed:

```text
create_external_ref
create_graph_edge
create_bridge
unlink_bridge
create_merge_preview
create_prune_preview
create_fork_preview
read_preview_projection
read_project_projection
read_thread_projection
```

All graph/preview writes must validate:

```text
project ownership
source thread ownership
source lifecycle state
source projection digest
operation ledger head
preview input caps
raw-exposure scan
idempotency key
```

Preview caps:

```ts
type DirectPreviewCapPolicy = {
  maxSourceThreads: number;      // default 8
  maxPreviewRows: number;        // default 400
  maxSourceRefs: number;         // default 800
  maxRendererTextChars: number;  // default 64000
  maxOmissionMarkers: number;    // default 200
};
```

If a cap is exceeded, create a blocked preview result with safe counts and no
provider-runnable artifact.

User-created graph edge kinds are restricted:

```ts
type UserCreatableGraphEdgeKind =
  | "related"
  | "blocks"
  | "supersedes"
  | "chatgpt_reference"
  | "import_source_reference";
```

Lineage edges are system-created only:

```text
derived_from
merge_preview_of
prune_preview_of
fork_preview_of
```

Endpoint validation:

```text
chatgpt_reference:
  source = direct_thread | derived_projection
  target = external_ref(refKind=chatgpt-thread-binding)

import_source_reference:
  source = direct_thread | derived_projection
  target = external_ref(refKind=legacy-codex-source)

related / blocks / supersedes:
  direct_thread -> direct_thread by default

merge_preview_of / prune_preview_of / fork_preview_of:
  system-created only
```

Invalid combinations return `unsupported_graph_endpoint` or
`unsupported_graph_edge_kind`.

Lineage-like edges reject cycles:

```text
derived_from
merge_preview_of
prune_preview_of
fork_preview_of
supersedes
```

`related` may be cyclic; lineage may not.

## UI Requirements

The middle-plane `Threads` area should expose the workbench as a dense
operational surface:

```text
top toolbar:
  refresh
  lifecycle filters
  source-class filters
  view mode: List / Graph / Previews / Operations
  store status chip

left lane:
  direct/imported thread list
  lifecycle badges
  source-class badges
  non-runnable badges

center lane:
  selected thread projection
  selected preview projection
  omission markers
  source refs
  non-runnable derived-view banner

right lane:
  graph edges
  external refs
  lifecycle actions
  preview actions
  operation history
```

UI law:

```text
button visible != action authorized
disabled action must show stable blocker code
preview detail must say "non-runnable preview"
external ChatGPT ref must say "binding only"
operation history rows are read-only
policy/status chips do not promote capability
```

Source-class filters:

```text
direct-native
legacy-codex-jsonl-import
import-checkpoint
derived-preview
unknown
```

If hidden, archived, or soft-deleted evidence is filtered out, counts still show
that the evidence exists.

Text search is limited in v0:

```text
v0 local-current-page filter only
or projection-backed search only if an existing index supports it
```

Do not imply full-thread/full-store search unless that index exists.

Future fresh-fork affordance constraints:

```text
No button labeled "Start" or "Run" in PR 6.
Allowed labels:
  "Fresh fork: not available in this PR"
  "Preview only"
No confirmation dialog.
No start_fork_turn IPC reachable.
No context pack, request manifest, or direct session creation from preview UI.
```

Do not create a landing page or tutorial. Use compact rows, tabs, tables,
badges, and detail panels.

## Runtime Boundaries

PR 6 workbench reads and mutations must not call:

```text
provider transport
codex app-server spawn
direct live text controller
workspace read/write backend, except app-private workbench artifact reads/writes
patch apply
command execution
right-pane ChatGPT mutation APIs
handoff queue mutation APIs
```

Sentinel counters in regression should prove:

```ts
type DirectThreadWorkbenchSentinelCounters = {
  providerTransportCalls: number;
  appServerSpawnCalls: number;
  workspaceReadCalls: number;
  workspaceWriteCalls: number;
  patchApplyCalls: number;
  commandRunCalls: number;
  contextPackBuilds: number;
  requestManifestBuilds: number;
  directSessionCreates: number;
  freshForkStartCalls: number;
  rightPaneMutationCalls: number;
  handoffMutationCalls: number;
};
```

All counters are expected to be zero for PR 6 workbench reads and mutations,
except ordinary app-private reads of already-built projection/index artifacts.

## Raw-Exposure Policy

Scan all renderer-bound workbench surfaces:

```text
workbench snapshot
thread summaries
thread projection detail
preview summaries
preview detail
external refs
operation history
console summaries
JSON reports
Markdown summaries
renderer state snapshots
DOM attributes
localStorage/sessionStorage
IndexedDB if used
serialized renderer store
operation-history rows
preview detail rows
external-ref rows
graph node/edge data
```

Forbidden:

```text
raw host paths
raw WSL paths
raw ChatGPT URLs
raw source JSONL
raw provider frames
raw request bodies
raw context pack text
raw full transcript text outside renderer projection caps
auth tokens
cookies
SQLite/internal exception text
unscoped raw digests
```

Allowed:

```text
renderer-safe thread ids
binding ids
preview ids
operation ids
evidence keys
safe relative labels
bounded renderer projection snippets
counts
stable blocker codes
```

## Recovery And Staleness

Workbench projection rows are not recovery authority. Recovery classification
comes from durable artifacts, operation ledger, and store indexes.

Startup should classify:

```text
healthy_workbench
projection_stale
projection_missing
operation_planned_no_commit
operation_committed_projection_stale
preview_source_changed
external_ref_target_missing
tombstone_present
store_degraded
store_corrupt
```

Safe behavior:

```text
projection stale:
  reads show stale badge; mutations blocked until refresh/rebuild

preview source changed:
  preview marked stale; no fresh fork/start affordance

operation planned no commit:
  operation history shows failed_or_abandoned unless controller can prove commit

store corrupt:
  read-only minimal status only
```

Startup recovery must not append normal operation-ledger events. If a recovery
scan report is needed, write an app-private diagnostic report, not a new
workbench mutation.

## Headless Regression

Add a fixture-backed runner:

```text
scripts/direct-thread-evidence-workbench-regression.mjs
npm run direct:thread-workbench
```

Report schema:

```ts
type DirectThreadEvidenceWorkbenchReport = {
  schema: "direct_thread_evidence_workbench_report@1";
  generatedAt: string;
  coverageSource: "fixture_workbench";
  matrixPromotionCandidate: false;
  authorityPromotionCandidate: false;
  runtimeAuthorityExercised: false;
  providerAuthorityExercised: false;
  rowsExercised: Array<"G1" | "G3" | "G4" | "G5" | "G6" | "G7" | "G10" | "C5" | "F8" | "F10">;
  cases: DirectThreadEvidenceWorkbenchCaseReport[];
  sentinelCounters: DirectThreadWorkbenchSentinelCounters;
  rawExposure: DirectThreadWorkbenchRawExposureSummary;
};
```

Required cases:

```text
workbench_snapshot_renderer_safe
lifecycle_hide_unhide
lifecycle_archive_restore
soft_delete_prepare_requires_confirmation
soft_delete_blocks_active_turn
external_ref_binding_only
bridge_create_unlink
merge_preview_non_runnable
prune_preview_omission_markers
fork_preview_seed_metadata_non_runnable
operation_history_actionability_false
stale_workbench_revision_blocks_mutation
source_projection_change_marks_preview_stale
raw_exposure_scan
sentinel_no_provider_appserver_workspace_or_chatgpt_mutation
```

Fixture reports never promote real-provider implementation-lane rows. They may
move PR 6 rows from scaffold toward fixture-backed workbench coverage only.

## Implementation Order

### Phase -2 - Operation And Transition Law

- Add lifecycle transition matrix.
- Add soft-delete confirmation nonce.
- Add user-creatable graph edge allowlist.
- Add graph endpoint validation.
- Add lineage cycle checks.
- Add preview-attempt/current-preview pointer law.

### Phase -1 - Law And Inventory

- Inventory existing thread workbench IPC and renderer surfaces.
- Mark which endpoints are PR 6 evidence/workbench and which are PR 7 fresh
  fork runtime.
- Mark `start_fork_turn`, context-pack build, request-manifest build, and
  direct-session creation from previews as prohibited in PR 6.
- Add explicit non-runnable labels to merge/prune/fork previews.
- Add stale/blocker taxonomy.

### Phase 0 - Projection Schemas

- Add `direct_thread_evidence_workbench_projection@1`.
- Add renderer-safe thread, graph, preview, external-ref, and operation rows.
- Add projection generation/source digests.
- Add kind-specific projection pointers.
- Add stable preview row keys.
- Add structured omission markers.
- Add tombstone summaries.
- Add degraded capability map.
- Add raw-exposure assertions.
- Add schema validation before IPC.

### Phase 1 - Controller Hardening

- Revalidate project generation, workbench revision, operation ledger head, and
  source projection digests.
- Normalize lifecycle conflict/idempotency behavior.
- Validate soft-delete confirmation nonce.
- Canonicalize preview source digests.
- Validate graph edge kinds/endpoints and lineage cycles.
- Enforce no hidden rebuild during read.
- Ensure preview operations produce non-runnable artifacts only.
- Ensure operation-history rows have `actionability.actionable=false`.

### Phase 2 - UI Workbench

- Add List / Graph / Previews / Operations workbench views.
- Show lifecycle/source/runnable badges.
- Show selected preview detail with omission markers and source refs.
- Show external refs as binding-only.
- Show operation history as read-only evidence.
- Show source-class filters and hidden/archived/soft-deleted counts.
- Keep future fork affordances disabled/separate with no Start/Run label.
- Use paged preview detail and operation-history reads.

### Phase 3 - Recovery/Staleness

- Mark stale projections and stale previews safely.
- Block mutations when workbench revision or projection digests changed.
- Surface store degraded/corrupt states without hidden rebuilds.
- Ensure blocked/failed preview attempts do not replace current valid preview.

### Phase 4 - Regression

- Add headless fixture runner and report schema.
- Add raw-exposure scan.
- Add sentinel counters.
- Add soft-delete nonce, invalid graph endpoint, lineage cycle, blocked preview,
  and no-hidden-rebuild cases.
- Include in syntax checks and direct regression script list.

## Acceptance Criteria

- Workbench projection includes generation, source digest, workbench revision,
  operation ledger head digest, and renderer-safe raw-exposure flags.
- Workbench projection is schema-validated and raw-exposure scanned before IPC;
  validation failure returns a minimal safe failure projection.
- `workbenchRevision` and `uiProjectionGeneration` are both submitted and
  independently validated.
- Stable blocker codes cover stale workbench, stale UI projection, ledger
  changes, source digest mismatch, invalid lifecycle transition, invalid graph
  edge kind/endpoint, lineage cycle, and raw exposure.
- Projection pointers are kind-specific; preview projections cannot become
  renderer transcript or context projections.
- Preview attempts are separate from current valid previews; blocked/failed
  previews do not replace the last valid preview.
- Preview source digests are canonical and exclude timestamps, raw text, raw
  paths, and client operation ids.
- Preview rows include `stablePreviewRowKey` and source stable item refs.
- Prune previews use structured omission markers with counts and positions.
- Preview and operation-history reads are paged/virtualized.
- Lifecycle transitions are governed by an explicit transition matrix;
  `soft_deleted` restores only through `restore_soft_deleted_thread`.
- Lifecycle operations revalidate project generation, workbench revision, thread
  ownership, lifecycle transition, active-turn state, and operation ledger head.
- Archive and soft-delete are blocked when `activeTurnCount > 0`; hide behavior
  during active turns is explicitly defined.
- Soft delete requires a main-issued confirmation nonce and uses reversible
  "Soft delete" copy.
- Operation idempotency distinguishes same client id/same action from same
  client id/different action.
- Thread summaries distinguish direct-native, imported evidence, derived
  preview, and unknown source classes.
- Runnable state explicitly marks imported evidence, external refs, and derived
  previews as non-runnable.
- Merge/prune/fork previews are non-runnable in PR 6.
- User-created graph edges are limited to relationship/external-ref kinds;
  lineage edges are system-created only.
- Graph edge endpoints are validated per edge kind.
- Lineage-like edges reject cycles.
- Preview detail includes source refs and omission markers without raw source
  JSONL, raw paths, or raw provider payloads.
- External ChatGPT refs use binding ids only, include no raw ChatGPT URLs, and
  do not contribute to Direct readiness.
- Creating/editing/removing external refs does not navigate or mutate the right
  ChatGPT pane; only a separate explicit shell control may focus an existing
  binding.
- Handoff external refs, if supported, cannot mutate handoff item state or
  contribute to Direct readiness.
- Imported source refs use local evidence keys, not raw paths or raw source
  hashes.
- Operation history rows are read-only with `actionability.actionable=false`.
- Stale workbench revisions block mutations with stable blocker codes.
- Source projection changes mark previews stale and block fresh-fork/start
  affordances.
- Soft delete requires confirmation and blocks active-turn targets.
- Soft-deleted threads have renderer-safe tombstone summaries;
  `hardPurgeAvailable=false`.
- Hard purge/delete is scaffolded or absent; no hard purge execution exists.
- Store degraded states expose a capability map rather than one coarse read-only
  flag.
- Read APIs do not silently rebuild projections; refresh/rebuild APIs are
  explicit.
- "Future fresh fork" affordance is disabled/separated and cannot call
  `start_fork_turn`, build context packs, create request manifests, or create
  sessions.
- Workbench refresh/read paths do not call provider transport, spawn app-server,
  mutate ChatGPT, mutate handoff, run commands, apply patches, or start fresh
  forks.
- Raw-exposure scanning covers snapshots, previews, refs, operation history,
  reports, summaries, DOM attributes, localStorage/sessionStorage, serialized
  renderer state, graph rows, external refs, preview details, and operation
  history.
- Sentinel counters include provider transport, app-server spawn, workspace
  read, patch apply, command run, context pack build, request manifest build,
  direct session creation, fresh fork start, right-pane mutation, and handoff
  mutation.
- Fixture regression report records `coverageSource=fixture_workbench` and
  `matrixPromotionCandidate=false`, `authorityPromotionCandidate=false`,
  `runtimeAuthorityExercised=false`, and `providerAuthorityExercised=false`.

## Success Definition

Passing this PR means:

```text
The shell can organize and inspect direct/imported thread evidence through a
renderer-safe workbench with lifecycle controls, graph refs, external refs,
operation history, and non-runnable merge/prune/fork previews.
```

It does not mean:

```text
fresh fork execution exists
derived previews are provider-runnable
provider continuity can be imported
ChatGPT transcript content is imported
hard purge/delete is supported
direct is production/default
app-server can be removed
```
