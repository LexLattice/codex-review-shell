# Direct Thread Log And Projection Store Spec

Status: architecture specification for the next direct-runtime storage substrate
on the long-lived `codex/direct-chatgpt-harness` branch.

Related docs:

- [CHATGPT_CODEX_DIRECT_PATH_SPEC.md](./CHATGPT_CODEX_DIRECT_PATH_SPEC.md)
- [DIRECT_CODEX_APP_SERVER_REPLACEMENT_SPEC.md](./DIRECT_CODEX_APP_SERVER_REPLACEMENT_SPEC.md)
- [DIRECT_LIVE_TEXT_TURN_SURFACE_SPEC.md](./DIRECT_LIVE_TEXT_TURN_SURFACE_SPEC.md)
- [DIRECT_READONLY_TOOL_CONTINUATION_SPEC.md](./DIRECT_READONLY_TOOL_CONTINUATION_SPEC.md)
- [DIRECT_LEGACY_IMPORT_CHECKPOINT_SPEC.md](./DIRECT_LEGACY_IMPORT_CHECKPOINT_SPEC.md)
- [DIRECT_IMPORT_CHECKPOINT_CONTINUATION_SPEC.md](./DIRECT_IMPORT_CHECKPOINT_CONTINUATION_SPEC.md)
- [DIRECT_EXPERIMENTAL_PROJECT_ACTIVATION_SPEC.md](./DIRECT_EXPERIMENTAL_PROJECT_ACTIVATION_SPEC.md)
- [THREAD_ANALYTICS_SPEC.md](./THREAD_ANALYTICS_SPEC.md)
- [WORKFLOW_TRANSITION_GRAPH_SPEC.md](./WORKFLOW_TRANSITION_GRAPH_SPEC.md)
- [CODEX_APP_SERVER_ONTOLOGY.md](./CODEX_APP_SERVER_ONTOLOGY.md)

## Purpose

Define the direct branch storage model for thread truth, thread control, derived
information structures, and model context construction.

The direct runtime needs more control over threads than vanilla Codex exposes:

- delete or purge direct-owned threads;
- hide/archive/restore threads;
- merge threads into derived working threads;
- prune transcript spans;
- fork threads;
- build project-level bridges across related threads;
- build different context packs for implementation, review, recovery,
  compaction, and import-continuation turns;
- experiment with alternative memory/projection structures without rewriting
  historical dialogue.

The core invariant is:

```text
canonical rollout truth != information-management projection
```

Canonical JSON rollouts preserve the dialogical event history. SQLite-backed
projections provide the working structures the app uses for listing, search,
context construction, compaction, recovery, and thread-control operations.

## Decision

Use a layered storage model:

```text
append-safe JSON rollout artifacts
  -> canonical dialogical event evidence

append-safe JSON control operation ledger
  -> canonical user/app thread-control mutation evidence

SQLite projection/control database
  -> indexed, versioned, rebuildable information-management state

context pack artifacts
  -> exact per-turn prompt/context material sent to the model
```

Prompt builders, compaction builders, thread merge/prune logic, renderer
projections, and search must not read raw rollout frames directly as their
normal input. They consume versioned projections that cite canonical rollout
event ranges and projection policies.

## Boundary

This spec applies to direct-owned Codex sessions and imported Codex evidence
after it is materialized into the direct harness.

It does:

- keep direct runtime dialogue and harness events in append-safe JSON rollouts;
- introduce a SQLite thread store for indexes, projections, operation state,
  context plans, and thread graph structures;
- define an operation ledger for delete, merge, prune, fork, bridge, archive,
  restore, and materialize-view actions;
- require every projection to cite source rollout spans, operation ledger spans,
  versions, and digests;
- require model requests to cite the context pack/projection policy used to
  construct them;
- support rebuilding projections from canonical artifacts;
- allow multiple projection strategies to coexist for the same raw thread.

It does not:

- replace JSON rollouts with SQLite as the transcript source of truth;
- rewrite old rollout history when a thread is merged or pruned;
- make imported legacy app-server JSONL provider state runnable by itself;
- make `direct` production mode available;
- store raw credentials, raw auth headers, or raw backend frames in renderer
  projections;
- collapse the right ChatGPT pane into the left direct Codex thread store.

## Product Doctrine

The direct shell needs two kinds of truth.

Dialogical truth:

```text
What actually happened?
What did the user say?
What did the model emit?
What tool call was observed?
What did the harness approve, decline, execute, or persist?
What failed, retried, aborted, or continued?
```

Information-management truth:

```text
Which thread is current?
Which spans should appear in the next prompt?
Which projection is best for a compact UI transcript?
Which memories belong to this project?
Which obligations remain unresolved?
Which threads are bridged, merged, hidden, pruned, or deleted?
Which context policy produced this model request?
```

The first belongs in append-safe event artifacts. The second belongs in
versioned projections and operation state.

The app should be able to change its mind about information structures without
changing historical dialogue.

## Existing Baseline

Current repo state:

- `thread-analytics.sqlite` stores derived analytics from legacy Codex rollout
  files.
- `DirectSessionStore` persists direct sessions, turns, diagnostics, import
  artifacts, and checkpoint-continuation artifacts as JSON files.
- Legacy Codex app-server/CLI histories are source JSONL files owned by Codex
  homes.
- Import materialization already treats legacy JSONL as source evidence, not
  native direct provider continuity.

Vanilla Codex uses a similar broad split:

- rollout/session JSONL files preserve transcript/event content;
- SQLite stores metadata, indexes, job state, goals, dynamic tool metadata,
  spawn edges, and logs.

The direct branch should keep that useful split but add stronger control-plane
semantics for derived threads, context construction, and local operations.

## Storage Layers

### Layer 0: Canonical Rollout Artifacts

Direct-owned rollouts are append-safe JSONL artifacts.

Recommended root:

```text
direct-sessions/
  rollouts/
    <project-id>/
      <thread-id>/
        rollout.jsonl
        rollout.manifest.json
        diagnostics/
        context-packs/
        compactions/
```

The exact directory can evolve from the current `DirectSessionStore`, but the
logical contract should be this shape.

Rollout events preserve normalized provider and harness events:

```ts
type DirectRolloutEvent = {
  schema: "direct_rollout_event@1";
  rolloutId: string;
  projectId: string;
  threadId: string;
  turnId?: string;
  seq: number;
  at: string;

  source:
    | "direct-provider"
    | "local-harness"
    | "workspace-backend"
    | "import-materializer"
    | "system-recovery";

  eventType: string;
  streamPhase?: "initial" | "continuation" | "compaction" | "recovery";
  payload: Record<string, unknown>;

  redaction: {
    rawCredentialsExposed: false;
    rawAuthHeadersExposed: false;
    rawBackendFrameExposed: false;
    redactionVersion: string;
  };

  integrity: {
    previousEventDigest?: string;
    eventDigest: string;
    algorithm: "sha256" | "hmac-sha256";
    keyId?: string;
  };
};
```

Rollout payloads may contain renderer-unsafe details if app-private and
redacted. They must never contain raw access tokens, refresh tokens, cookies,
authorization headers, or unredacted backend frames.

General projection rebuilds must not pollute dialogue rollouts. Projection
events belong in projection build records or the operation ledger unless they are
causally part of a turn, such as:

```text
context_pack_built
request_built
compaction_applied_to_context
recovery_context_used
```

### Rollout Manifest Law

Each rollout has an atomically updated manifest:

```ts
type DirectRolloutManifest = {
  schema: "direct_rollout_manifest@1";
  rolloutId: string;
  projectId: string;
  threadId: string;

  eventCount: number;
  firstSeq: number;
  lastSeq: number;
  firstEventAt?: string;
  lastEventAt?: string;

  fileSizeBytes: number;
  fileSha256: string;

  hashChainHead: string;
  hashAlgorithm: "sha256" | "hmac-sha256";
  keyId?: string;

  finalized: boolean;
  updatedAt: string;
};
```

Rules:

- `seq` is monotonically increasing per rollout.
- Duplicate `seq` values are invalid.
- Events are appended before the manifest is updated.
- Manifest writes are atomic.
- SQLite indexes never trust rollout content without validating manifest and
  digest state.
- A missing or mismatched manifest marks the rollout unavailable for context
  builds until repair/reindex succeeds.

### Layer 1: Control Operation Ledger

Thread-control mutations are append-safe JSONL operation events.

Recommended root:

```text
direct-sessions/
  control-ledger/
    operations.jsonl
    operations.manifest.json
```

The operation ledger is canonical evidence for user/app mutations that are not
provider dialogue events. It must be event-based. A prior `planned` record is
never edited into `committed`; committing appends a new event.

```ts
type DirectThreadOperationType =
  | "archive_thread"
  | "restore_thread"
  | "hide_thread"
  | "unhide_thread"
  | "soft_delete_thread"
  | "purge_thread"
  | "merge_threads"
  | "prune_thread"
  | "fork_thread"
  | "bridge_threads"
  | "unlink_bridge"
  | "materialize_projection_thread"
  | "rebuild_projection"
  | "repair_index";

type DirectThreadOperationEvent = {
  schema: "direct_thread_operation_event@1";
  operationId: string;
  eventId: string;
  projectId: string;
  seq: number;

  eventType:
    | "operation_planned"
    | "operation_confirmed"
    | "operation_committed"
    | "operation_failed"
    | "operation_rolled_back"
    | "operation_repaired";

  operationType: DirectThreadOperationType;
  clientOperationId?: string;
  at: string;
  actor: "user" | "system-recovery" | "migration" | "test";

  target: {
    threadIds: string[];
    projectionIds?: string[];
    bridgeIds?: string[];
  };

  parameters?: Record<string, unknown>;
  result?: Record<string, unknown>;

  safety: {
    requiresConfirmation: boolean;
    confirmedAt?: string;
    deletionPlanId?: string;
    rawPathExposedToRenderer: false;
  };

  integrity: {
    previousEventDigest?: string;
    eventDigest: string;
    algorithm: "sha256" | "hmac-sha256";
    keyId?: string;
  };
};
```

SQLite stores the current operation snapshot and operation effects derived from
these immutable events. If the database is deleted or corrupt, the app can
rebuild control state by replaying the operation ledger against rollout
manifests.

### Layer 2: SQLite Projection Store

SQLite is the indexed materialized model used by the app.

Recommended database:

```text
direct-sessions/
  direct-thread-store.sqlite
```

The database is authoritative for current app-visible projection state at a
specific schema/projection version, but it is rebuildable from rollout artifacts
and the operation ledger.

It stores:

- thread metadata and current lifecycle state;
- rollout manifests and fingerprints;
- turn/item indexes;
- unresolved obligations;
- projection definitions and projection item spans;
- context policies and context-build records;
- compaction checkpoints and summaries;
- thread graph edges for fork/merge/prune/bridge relationships;
- operation ledger index and application state;
- search/read models;
- recovery status;
- renderer-safe status projections.

It should not store:

- raw credentials;
- raw auth headers;
- raw backend stream frames;
- arbitrary unbounded raw rollout lines;
- private absolute source paths in renderer-facing rows;
- ChatGPT right-pane conversation content.

### Layer 3: Context Pack Artifacts

Every direct model request should persist an exact app-private context pack
artifact before transport starts.

Recommended root:

```text
direct-sessions/
  rollouts/<project-id>/<thread-id>/context-packs/
    <context-build-id>.json
```

The context pack is the exact material the request builder used, after
projection selection, compaction, truncation, and safety framing.

```ts
type DirectContextPack = {
  schema: "direct_context_pack@1";
  contextBuildId: string;
  projectId: string;
  threadId: string;
  turnId: string;
  builtAt: string;

  policy: {
    policyId: string;
    policyVersion: string;
    policyDigest: string;
    policySnapshot?: Record<string, unknown>;
    purpose:
      | "new_text_turn"
      | "tool_continuation"
      | "import_checkpoint_continuation"
      | "compaction"
      | "recovery"
      | "review_summary";
  };

  sourceProjections: Array<{
    projectionId: string;
    projectionVersion: string;
    sourceRolloutIds: string[];
    sourceEventRangeDigest: string;
  }>;

  content: {
    instructionsClass: string;
    messages: Array<{
      role: "system" | "developer" | "user" | "assistant" | "tool" | "harness";
      text: string;
      sourceKind: "current-user" | "projection" | "compaction" | "obligation" | "harness-policy";
      sourceRef?: string;
    }>;
  };

  caps: {
    maxChars: number;
    maxTokensEstimate?: number;
    truncated: boolean;
    omittedCounts: Record<string, number>;
  };

  digest: {
    contentHash: string;
    shapeHash: string;
    redactionVersion: string;
  };

  retention: {
    class: "app-private-context-evidence";
    defaultExport: false;
    redactionRequiredForExport: true;
    purgeEligibleAfter?: string;
  };
};
```

The context pack makes prompt experiments auditable:

```text
turn request X used projection policy Y over source spans A/B/C
```

The context pack captures what context text was assembled. It does not fully
describe the runtime request decision. Each direct request also persists a
request manifest:

```ts
type DirectRequestManifest = {
  schema: "direct_request_manifest@1";
  requestManifestId: string;
  projectId: string;
  threadId: string;
  turnId: string;
  contextBuildId: string;

  runtimeMode: "direct-experimental";
  transport: "live-text";
  model: string;
  modelEvidenceRef: string;
  requestShapeHash: string;
  endpointClass: string;
  endpointHash: string;

  enabledFeatures: {
    tools: boolean;
    previousResponseId: boolean;
    reasoning: boolean;
    structuredOutput: boolean;
    serviceTier: boolean;
    promptCache: boolean;
  };

  rawAuthExposed: false;
  rawRequestBodyStored: false;
  builtAt: string;
};
```

The rollout `request_built` event cites both `contextBuildId` and
`requestManifestId`.

Context/projection policy definitions must not exist only in SQLite. They are
either code-defined with stable ids/versions/digests, persisted as append-safe
policy registry artifacts, or snapshotted into every context pack. If full
policy snapshots are too large, store policy artifacts under:

```text
direct-sessions/
  policies/
    context-policies/<policy-id>/<version>.json
    projection-policies/<policy-id>/<version>.json
```

## Projection Types

Projection rows must be explicit about purpose. One raw rollout can support
many projections.

Recommended projection kinds:

```ts
type DirectProjectionKind =
  | "renderer_transcript"
  | "compact_transcript"
  | "context_working_memory"
  | "context_recent_dialogue"
  | "context_task_state"
  | "context_repo_state"
  | "context_unresolved_obligations"
  | "context_import_checkpoint_seed"
  | "compaction_candidate"
  | "compaction_checkpoint"
  | "search_index"
  | "analytics_read_model"
  | "bridge_summary"
  | "merge_candidate"
  | "prune_preview";
```

Each projection must carry:

```ts
type ProjectionStaleReason =
  | "rollout_manifest_changed"
  | "operation_ledger_advanced"
  | "builder_version_changed"
  | "policy_version_changed"
  | "schema_migration"
  | "source_projection_superseded"
  | "security_policy_changed"
  | "manual_rebuild_requested";

type DirectProjection = {
  projectionId: string;
  projectId: string;
  threadId?: string;
  projectionKind: DirectProjectionKind;
  projectionVersion: string;
  builderVersion: string;
  policyId?: string;
  createdAt: string;
  source: {
    rolloutIds: string[];
    operationIds: string[];
    eventRangeDigest: string;
    sourceProjectionIds?: string[];
  };
  validity: {
    status: "valid" | "stale" | "superseded" | "failed" | "blocked";
    staleReason?: ProjectionStaleReason;
    supersededByProjectionId?: string;
    unsafeForContextBuild: boolean;
    unsafeForRenderer: boolean;
  };
  integrity: {
    projectionDigest: string;
    algorithm: "sha256" | "hmac-sha256";
  };
};
```

Changing a projection builder requires a new `projectionVersion` or
`builderVersion`. Existing projections remain auditable until rebuilt or
superseded.

Renderer-safe projections are capped and explicitly marked:

```ts
const MAX_RENDERER_PROJECTION_ITEMS = 2000;
const MAX_RENDERER_ITEM_TEXT_CHARS = 16_000;
const MAX_RENDERER_TOTAL_TEXT_CHARS = 1_000_000;
const MAX_TOOL_RESULT_PREVIEW_CHARS = 4096;
```

Renderer projections must carry:

```ts
{
  truncated: boolean;
  omittedCounts: Record<string, number>;
  rawPathExposed: false;
  rawCredentialsExposed: false;
  rawBackendFrameExposed: false;
}
```

`unsafeForContextBuild` means the projection may not be used as model input.
`unsafeForRenderer` means it may not be shown to the renderer except as a
redacted error/status record.

## Suggested SQLite Schema

First implementation can be smaller, but the target schema should be shaped for
thread control from the start.

Initialization requirements:

```sql
pragma journal_mode = wal;
pragma foreign_keys = on;
pragma busy_timeout = 5000;
pragma synchronous = normal;
```

The Electron main process owns one SQLite writer queue. WAL mode does not remove
the need for app-level ordering across rollout append, manifest update, request
manifest writes, operation ledger writes, and DB projection updates.

```sql
create table direct_store_meta (
  key text primary key,
  value_json text not null,
  updated_at text not null
);

create table direct_rollouts (
  rollout_id text primary key,
  project_id text not null,
  thread_id text not null,
  rollout_path_private text not null,
  rollout_display_name text not null,
  event_count integer not null,
  first_event_at text,
  last_event_at text,
  file_size_bytes integer not null,
  file_sha256 text not null,
  manifest_digest text not null,
  recovery_state text not null,
  created_at text not null,
  updated_at text not null,
  unique(project_id, thread_id, rollout_id)
);

create table direct_threads (
  thread_id text primary key,
  project_id text not null,
  title text not null,
  source_class text not null,
  native_direct_session integer not null default 0,
  provider_continuity_available integer not null default 0,
  composer_enabled integer not null default 0,
  continuity_state text not null default 'unknown',
  lifecycle_state text not null,
  current_rollout_id text,
  current_projection_id text,
  created_at text not null,
  updated_at text not null,
  archived_at text,
  hidden_at text,
  deleted_at text,
  purge_state text not null default 'not_requested',
  unique(project_id, thread_id),
  foreign key(current_rollout_id) references direct_rollouts(rollout_id)
);

create table direct_turns (
  turn_id text primary key,
  thread_id text not null,
  project_id text not null,
  rollout_id text not null,
  turn_ordinal integer not null,
  state text not null,
  stream_phase text,
  started_at text,
  completed_at text,
  model text,
  request_shape_hash text,
  context_build_id text,
  source_event_start_seq integer,
  source_event_end_seq integer,
  unique(thread_id, turn_ordinal),
  foreign key(thread_id) references direct_threads(thread_id),
  foreign key(rollout_id) references direct_rollouts(rollout_id)
);

create table direct_items (
  item_id text primary key,
  turn_id text not null,
  thread_id text not null,
  project_id text not null,
  item_ordinal integer not null,
  item_kind text not null,
  role text,
  status text not null,
  source_event_start_seq integer,
  source_event_end_seq integer,
  content_digest text,
  text_preview text,
  renderer_safe integer not null default 0,
  unique(turn_id, item_ordinal),
  foreign key(turn_id) references direct_turns(turn_id)
);

create table direct_obligations (
  obligation_id text primary key,
  turn_id text not null,
  thread_id text not null,
  project_id text not null,
  obligation_kind text not null,
  provider_call_type text,
  tool_name text,
  status text not null,
  authority_state text not null,
  side_effect_executed integer not null default 0,
  continuation_sent integer not null default 0,
  source_item_id text,
  result_digest text,
  updated_at text not null,
  foreign key(turn_id) references direct_turns(turn_id)
);

create table direct_operations (
  operation_id text primary key,
  project_id text not null,
  operation_type text not null,
  client_operation_id text,
  status text not null,
  requested_at text not null,
  committed_at text,
  operation_digest text not null,
  ledger_offset integer,
  target_json text not null,
  result_json text not null
);

create unique index idx_direct_operations_client_operation
  on direct_operations(project_id, client_operation_id)
  where client_operation_id is not null;

create table direct_operation_effects (
  operation_id text not null,
  effect_ordinal integer not null,
  effect_kind text not null,
  target_kind text not null,
  target_id text not null,
  before_digest text,
  after_digest text,
  created_at text not null,
  primary key (operation_id, effect_ordinal),
  foreign key(operation_id) references direct_operations(operation_id)
);

create table direct_thread_edges (
  edge_id text primary key,
  project_id text not null,
  edge_kind text not null,
  source_kind text not null,
  source_id text not null,
  target_kind text not null,
  target_id text not null,
  operation_id text,
  status text not null,
  created_at text not null,
  metadata_json text not null,
  foreign key(operation_id) references direct_operations(operation_id)
);

create table direct_external_refs (
  external_ref_id text primary key,
  project_id text not null,
  ref_kind text not null,
  display_title text not null,
  renderer_safe_url_hash text,
  target_id text,
  metadata_json text not null,
  created_at text not null
);

create table direct_projections (
  projection_id text primary key,
  project_id text not null,
  thread_id text,
  projection_kind text not null,
  projection_version text not null,
  builder_version text not null,
  policy_id text,
  status text not null,
  source_json text not null,
  projection_digest text not null,
  created_at text not null,
  superseded_by_projection_id text,
  foreign key(thread_id) references direct_threads(thread_id)
);

create table direct_projection_items (
  projection_id text not null,
  ordinal integer not null,
  item_kind text not null,
  source_ref_json text not null,
  text_value text,
  payload_json text,
  content_digest text not null,
  primary key (projection_id, ordinal),
  foreign key(projection_id) references direct_projections(projection_id)
);

create table direct_context_policies (
  policy_id text primary key,
  policy_version text not null,
  purpose text not null,
  status text not null,
  definition_json text not null,
  created_at text not null
);

create table direct_context_builds (
  context_build_id text primary key,
  project_id text not null,
  thread_id text not null,
  turn_id text,
  policy_id text not null,
  policy_version text not null,
  purpose text not null,
  context_pack_path_private text not null,
  shape_hash text not null,
  content_hash text not null,
  source_json text not null,
  built_at text not null,
  foreign key(thread_id) references direct_threads(thread_id)
);

create table direct_request_manifests (
  request_manifest_id text primary key,
  project_id text not null,
  thread_id text not null,
  turn_id text not null,
  context_build_id text not null,
  runtime_mode text not null,
  transport text not null,
  model text not null,
  model_evidence_ref text not null,
  request_shape_hash text not null,
  endpoint_class text not null,
  endpoint_hash text not null,
  enabled_features_json text not null,
  raw_auth_exposed integer not null default 0,
  raw_request_body_stored integer not null default 0,
  built_at text not null,
  foreign key(thread_id) references direct_threads(thread_id),
  foreign key(turn_id) references direct_turns(turn_id),
  foreign key(context_build_id) references direct_context_builds(context_build_id)
);

create table direct_compaction_checkpoints (
  checkpoint_id text primary key,
  project_id text not null,
  thread_id text not null,
  projection_id text,
  context_build_id text,
  status text not null,
  source_json text not null,
  summary_digest text not null,
  created_at text not null,
  foreign key(thread_id) references direct_threads(thread_id)
);

create table direct_deletion_plans (
  deletion_plan_id text primary key,
  project_id text not null,
  operation_id text not null,
  status text not null,
  targets_json text not null,
  safety_json text not null,
  created_at text not null,
  committed_at text,
  foreign key(operation_id) references direct_operations(operation_id)
);
```

Indexes should cover:

- `direct_threads(project_id, updated_at desc)`;
- `direct_turns(thread_id, turn_ordinal)`;
- `direct_items(thread_id, turn_id, item_ordinal)`;
- `direct_obligations(project_id, status)`;
- `direct_operations(project_id, requested_at desc)`;
- `direct_operation_effects(operation_id, effect_ordinal)`;
- `direct_thread_edges(project_id, edge_kind, source_kind, source_id)`;
- `direct_external_refs(project_id, ref_kind)`;
- `direct_projections(project_id, projection_kind, status)`;
- `direct_context_builds(project_id, thread_id, built_at desc)`.

FTS can be added later for projection text, not raw rollout payloads by
default.

## Context Construction Rule

Every direct turn must record how context was built.

Normal turn flow:

```text
user prompt
  -> select context policy
  -> resolve source projections
  -> build context pack
  -> persist context pack
  -> persist request manifest
  -> write request_built rollout event citing contextBuildId/requestManifestId
  -> send provider request
```

The request builder may not assemble model context by ad hoc parsing of raw
rollout JSONL. It must use a policy-specific projection builder.

Allowed emergency exception:

```text
projection store is corrupt
  -> app enters recovery/degraded state
  -> raw rollout scan may rebuild projections
  -> no normal turn starts until projection state is healthy again
```

Durable live-turn write order:

```text
1. create or load thread
2. build projection/context policy
3. write context pack artifact
4. write request manifest artifact
5. append rollout event: request_built(contextBuildId, requestManifestId)
6. update rollout manifest
7. send provider request
8. append provider/harness events as they arrive
9. update rollout manifest after append batches
10. update SQLite indexes/projections
```

Crash recovery rules:

```text
context pack exists but no request_built event:
  mark orphan_context_pack or recoverable_pre_transport

request manifest exists but no request_built event:
  mark orphan_request_manifest or recoverable_pre_transport

request_built exists but no provider bytes/events were observed:
  mark request_built_unsent_or_unknown

provider events exist but no terminal event:
  mark interrupted_stream

SQLite indexed turn but rollout is missing:
  mark DB stale/corrupt and rebuild from artifacts
```

Concurrency requirements:

- one SQLite writer queue in the Electron main process;
- one append lock per rollout;
- one append lock for the global operation ledger;
- one project-level mutation lock for archive, hide, delete, merge, prune, fork,
  bridge, and repair operations;
- turn start cannot race with destructive thread-control operations;
- activation/rollback gates must observe store health after pending writes are
  flushed.

Context builders must defend against prompt injection in projections:

- projected transcript text is framed by source kind;
- imported transcript text is quoted historical evidence, not current
  instruction authority;
- tool results are evidence, not authority;
- pruned/omitted spans are disclosed through `omittedCounts`;
- harness policy messages remain distinct from projected transcript text.

## Thread Control Operations

Thread source class and continuity must be explicit:

```ts
type DirectThreadSourceClass =
  | "direct-native"
  | "imported-readonly"
  | "import-checkpoint-continuation"
  | "derived-projection"
  | "merged-projection"
  | "forked-direct-native";

type DirectThreadContinuityState =
  | "provider_continuity_available"
  | "fresh_session_only"
  | "checkpoint_required"
  | "non_runnable_projection"
  | "unknown";
```

Thread projections and renderer-safe session summaries must carry:

```ts
{
  sourceClass: DirectThreadSourceClass;
  nativeDirectSession: boolean;
  providerContinuityAvailable: boolean;
  composerEnabled: boolean;
  continuityState: DirectThreadContinuityState;
}
```

Rules:

- imported materialized transcript evidence remains `imported-readonly` and
  non-runnable;
- import checkpoint continuation creates a new `import-checkpoint-continuation`
  direct-native session and leaves the imported transcript read-only;
- merge projection threads default to `non_runnable_projection`;
- prune preview projections default to `non_runnable_projection`;
- fork is `fresh_session_only` unless lawful provider continuity is captured and
  accepted;
- bridge never creates provider continuity.

### Archive/Hide

Archive and hide are reversible metadata operations.

They:

- append an operation ledger record;
- update SQLite lifecycle state;
- do not delete rollout artifacts;
- do not change thread lineage.

### Soft Delete

Soft delete removes a thread from normal views while keeping canonical artifacts.

It:

- appends `soft_delete_thread`;
- marks `direct_threads.lifecycle_state = "deleted"`;
- excludes the thread from normal selectors;
- preserves rollouts, context packs, diagnostics, projections, and lineage;
- remains reversible unless a later purge is committed.

### Purge

Purge is destructive and must be explicit.

It requires:

- deletion plan preview;
- user confirmation;
- operation ledger record;
- all target paths resolved under the direct session store root;
- no raw source paths exposed to renderer;
- DB transaction updating lifecycle and deletion plan state;
- artifact deletion only after the plan is committed.

Purge must never delete:

- external legacy Codex `CODEX_HOME` files;
- imported source JSONL outside the direct store;
- right-pane ChatGPT browser data;
- credentials or auth stores unless a separate auth deletion flow owns that.

If purge removes canonical rollouts, the operation ledger must retain enough
metadata to explain that the content was intentionally purged without retaining
the content itself.

Purge writes a tombstone artifact in the purged thread directory when possible:

```text
rollouts/<project-id>/<thread-id>/purged.tombstone.json
```

```ts
type DirectPurgeTombstone = {
  schema: "direct_purge_tombstone@1";
  operationId: string;
  deletionPlanId: string;
  purgedAt: string;
  contentDigestBeforePurge: string;
  artifactKindsPurged: string[];
  contentRetained: false;
};
```

### Merge

Merge must not rewrite source thread rollouts.

It creates either:

```text
derived projection thread
```

or:

```text
materialized merged rollout
```

The first implementation should prefer a derived projection thread:

- append `merge_threads`;
- create `direct_thread_edges` from source threads to derived thread;
- create merge projection items citing source thread spans;
- keep source threads intact;
- mark the derived thread as non-provider-continuity by default.

A materialized merged rollout is allowed only when it records lineage events
that cite the source rollout spans and operation id.

### Prune

Prune is a projection operation by default.

It creates:

- a prune preview projection;
- optionally a derived pruned thread;
- omission records for excluded spans;
- lineage back to the original rollout events.

Prune must not silently erase source rollout events.

If the user later purges excluded source spans, that is a separate purge
operation with a deletion plan.

### Fork

Fork creates a new direct thread lineage from a source thread/projection.

It must persist:

- source thread id;
- source projection id or rollout span;
- fork policy id;
- context pack or seed artifact used for the first fork turn;
- edge from parent to child.

Fork does not imply provider continuity unless the direct transport captured and
accepted a lawful continuity handle for that exact case.

### Bridge

Bridge is a project-level graph edge across related threads.

It is used for:

- grouping implementation/review/checkpoint threads;
- creating joint project memory;
- connecting direct-native sessions to imported evidence;
- connecting left Codex lane work to right ChatGPT references without importing
  right-pane content.

Bridge records should not merge transcripts. They declare relationship and
projection policy.

Bridge edges can connect direct threads to external references through
`direct_external_refs`. Supported external refs include:

```text
chatgpt_thread_binding
file_artifact
handoff
imported_source
```

A ChatGPT bridge stores renderer-safe reference metadata only. It must not store
right-pane ChatGPT transcript content in the direct thread store.

## Projection Rebuild

Projection rebuild is normal.

Triggers:

- projection builder version changed;
- rollout file fingerprint changed;
- operation ledger advanced;
- context policy changed;
- compaction policy changed;
- schema migration;
- manual rebuild requested.

Rebuild rules:

- never mutate old canonical rollout events;
- old projections become `superseded`, not overwritten in place;
- new projections cite the same source spans plus new builder/policy versions;
- failed rebuilds leave old valid projections available unless they are unsafe;
- renderer-visible state shows stale/rebuild-needed status.

## Recovery Model

Startup recovery order:

1. Open SQLite database.
2. Validate schema version.
3. Scan rollout manifests and operation ledger manifests.
4. Compare DB fingerprints with artifact fingerprints.
5. Apply unapplied ledger operations.
6. Mark missing/corrupt rollout artifacts.
7. Mark stale projections.
8. Rebuild required indexes if safe.
9. Expose degraded status if rebuild is needed before new turns can start.

If SQLite is corrupt:

- close it;
- move it to a repair backup;
- create a fresh database;
- rebuild from rollout manifests and operation ledger;
- mark projections that cannot be rebuilt as unavailable;
- do not start direct turns until recovery state is healthy enough for the
  selected runtime mode.

If a rollout is corrupt:

- keep DB metadata;
- mark the thread `recovery_state = "rollout_corrupt"`;
- disable context builds from that rollout;
- keep renderer-safe summaries only if projection integrity still validates;
- offer repair/export diagnostics.

Schema migration rules:

- store schema version in `direct_store_meta`;
- every migration has id, `fromVersion`, `toVersion`, and digest;
- backup the DB before destructive migrations;
- failed migration moves the DB to a repair backup and rebuilds if possible;
- a DB with a newer unsupported schema opens only in read-only diagnostic mode;
- migrations normalize older source classes and projection states before
  activation or context-build gates evaluate.

## Security And Privacy

Raw canonical rollouts are app-private artifacts, not renderer state.

Renderer-safe projections must not include:

- raw access tokens;
- refresh tokens;
- cookies;
- authorization headers;
- raw backend frames;
- raw request bodies;
- raw imported JSONL lines;
- private absolute source paths;
- raw file hashes for private source files;
- unbounded tool results.

SQLite may store app-private paths for main-process use, but any renderer
projection must use display names, local HMAC evidence keys, counts, and status
flags.

Context packs are sensitive. They may contain compacted project memory and
selected transcript text. They should be treated as private app data and excluded
from default diagnostic export unless explicitly redacted.

## Relationship To Existing Stores

### `thread-analytics.sqlite`

The existing analytics database can remain separate initially.

Later options:

1. Keep analytics as a separate read model that consumes direct projections.
2. Fold analytics tables into `direct-thread-store.sqlite`.
3. Keep legacy Codex analytics separate and use the direct store only for
   direct-owned threads.

Do not block the thread-control store on analytics consolidation.

### Current `DirectSessionStore`

The current JSON session store should be migrated gradually.

First implementation should add the SQLite projection store alongside existing
JSON artifacts, then write adapter methods that project current `session.json`
and turn JSON into the new index.

Migration modes:

```ts
type DirectThreadStoreMode =
  | "disabled"
  | "index_only"
  | "dual_write_shadow"
  | "projection_read"
  | "context_build_required";
```

Recommended rollout:

```text
index_only:
  DB indexes JSON artifacts; runtime still reads current DirectSessionStore

dual_write_shadow:
  runtime writes old JSON plus rollout/index records; reads old path

projection_read:
  renderer reads projections; runtime can still fail closed if projection stale

context_build_required:
  new direct turns require healthy projection/context store
```

Do not break existing direct live text, read-only tool continuation, imports,
checkpoint continuation, or activation smokes during the transition.

### Direct Activation Gates

Once context builds depend on this store, direct activation must include store
health:

```ts
directThreadStore: {
  status: "healthy" | "degraded" | "rebuilding" | "corrupt" | "disabled";
  schemaVersion: string;
  mode: DirectThreadStoreMode;
  projectionsHealthy: boolean;
  contextBuildsAllowed: boolean;
}
```

If unhealthy:

- completed sessions may remain readable from safe projections;
- new direct turns are blocked when context builds are unsafe;
- rollback remains available;
- runtime status explains whether repair, rebuild, or rollback is the next
  action.

## Implementation Phases

### Phase -1: Canonical Artifact Law

- Add `DirectRolloutManifest`.
- Add rollout append locks.
- Add rollout event hash chain.
- Add append-only operation event ledger.
- Add operation ledger manifest.
- Add atomic write helpers.
- Add recovery classifications for corrupt/missing manifests and interrupted
  writes.

### Phase 0: Store Skeleton

- Add `DirectThreadStore` SQLite wrapper.
- Add WAL, foreign keys, busy timeout, and single-writer queue.
- Add schema version table.
- Add migration backup/rebuild path.
- Add store health/readiness reporting.
- Add smoke coverage for create/open/rebuild.
- Start in `index_only` mode.
- Do not route live runtime through it yet.

### Phase 1: Rollout Manifest Index

- Index existing direct sessions/turns/import materializations as rollout-like
  source artifacts.
- Add rollout manifest records.
- Add thread/turn/item indexes from existing JSON store.
- Validate manifests before indexing.
- Prove DB rebuild from artifacts.
- Mark stale/corrupt/missing artifact states.

### Phase 2: Operation Ledger

- Add append-only operation events.
- Implement archive/hide/unhide/soft-delete as metadata operations.
- Index operations in SQLite.
- Add `direct_operation_effects`.
- Add idempotency by `clientOperationId`.
- Prove DB replay from ledger.

### Phase 3: Renderer Transcript Projection

- Add renderer transcript projection.
- Add compact transcript projection.
- Add caps, truncation, omitted counts, and raw-exposure flags.
- Add projection versioning and stale marking.
- Remove normal renderer raw rollout reads.

### Phase 4: Context Policy And Context Packs

- Add context/projection policy artifacts or policy snapshots.
- Persist context packs before direct requests.
- Persist request manifests.
- Make direct live text and checkpoint continuation cite `contextBuildId` and
  `requestManifestId`.
- Keep request body raw data below main-process boundary.
- Block normal direct turns when projection/context store is unhealthy.

### Phase 5: Obligations Projection

- Add unresolved obligation projection.
- Make read-only tool continuation consume obligation projection.
- Preserve no-duplicate-side-effect state.
- Keep tool results evidence-framed, not authority-framed.

### Phase 6: Import/Checkpoint Integration

- Add `imported-readonly` source class.
- Add `import-checkpoint-continuation` source class.
- Prevent imported projections from becoming provider continuity.
- Integrate checkpoint seed/context policies.

### Phase 7: Merge/Prune/Fork/Bridge Previews

- Add graph edge tables.
- Add external refs for ChatGPT thread bindings without transcript import.
- Implement preview-only merge/prune projections.
- Add bridge records for project-related threads.
- Derived threads are non-runnable by default.
- Defer materialized merged rollouts until projection semantics are proven.

### Phase 8: Compaction

- Build compaction candidate projections.
- Add checkpoint artifacts and DB records.
- Add compaction/resume gate for direct runtime.
- Make context policies consume compaction checkpoints as explicit sources.

### Phase 9: Purge

- Add deletion plan preview.
- Add tombstone artifacts.
- Add explicit confirmation UI.
- Add hard purge constrained to direct store roots.
- Add recovery tests for interrupted purge.

## Acceptance Criteria

- JSON rollouts remain canonical evidence for direct dialogue and harness
  events.
- Thread-control mutations are recorded as immutable append-only operation
  events.
- Rollout manifests define event count, seq range, file hash, hash-chain head,
  and atomic update rules.
- SQLite projections can be rebuilt from rollouts plus operation ledger.
- SQLite opens with WAL, `foreign_keys = on`, `busy_timeout`, and a single
  app-level writer queue.
- Renderer transcript, context builders, compaction builders, and search use
  projections, not raw rollout frames.
- Every projection cites source rollout ids, event ranges, operation ids,
  builder versions, and digests.
- Projection validity includes stale reasons plus `unsafeForContextBuild` and
  `unsafeForRenderer` flags.
- Every direct model request persists a context pack before transport starts.
- Context packs cite projection policy, source projections, omitted counts, and
  hashes.
- Context packs are app-private, excluded from default diagnostic export, and
  carry retention/export metadata.
- Every direct model request persists a request manifest and the rollout
  `request_built` event cites it.
- Live-turn crash recovery handles orphan context packs, orphan request
  manifests, `request_built` without stream, interrupted streams, stale DB
  indexes, and corrupt manifests.
- Merge creates derived lineage and does not rewrite source rollouts.
- Prune creates a projection or derived thread and does not silently erase source
  rollouts.
- Soft delete is reversible and does not delete artifacts.
- Purge requires an explicit deletion plan and cannot escape the direct store
  root.
- Purge writes tombstones and cannot delete external Codex homes, imported
  source JSONL outside the direct store, ChatGPT browser data, or auth stores.
- Bridge records relate threads without merging transcripts by default.
- Bridge records can reference ChatGPT thread bindings as external refs without
  importing right-pane content.
- Derived merge/prune/bridge threads default to non-provider-continuity and
  non-runnable projection semantics.
- Operation effects are indexed for rollback, repair, purge diagnostics, and
  audit.
- Projection rebuild can supersede stale projections without corrupting
  canonical artifacts.
- Projection rebuild records do not pollute dialogue rollouts unless causally
  tied to a turn.
- DB corruption can be recovered by rebuilding from canonical artifacts or by
  entering a safe degraded state.
- Store migration supports `index_only`, `dual_write_shadow`,
  `projection_read`, and `context_build_required` modes.
- Direct activation gates include direct-thread-store health once context builds
  depend on it.
- Renderer-safe projections contain no raw credentials, raw backend frames, raw
  imported JSONL, private absolute source paths, or unbounded tool results.
- Renderer-safe projections have item/text caps, truncation flags, omitted
  counts, and raw-exposure flags.
- Imported materialized sessions carry source class, native direct session,
  provider continuity, and composer-enabled flags.
- Context builders frame projected/imported text as evidence, not current
  instruction authority.
- Existing direct auth/live-text/tool/import/checkpoint/activation flows remain
  compatible during incremental migration.

## Non-Goals For First Implementation

- Full-text search over raw rollout payloads.
- Hard purge UI.
- Materialized merged rollouts.
- Automatic context-policy selection by model.
- Right-pane ChatGPT transcript import.
- Production `direct` mode.
- Replacing `thread-analytics.sqlite` immediately.

## Open Questions

- Should the direct thread store be one global database or one database per
  project? The initial recommendation is global app-private DB with project ids,
  because bridges and imports may span threads while still remaining
  project-scoped.
- What retention duration should apply to context packs after compaction or
  checkpointing? The minimum rule is already fixed: context packs are
  app-private, excluded from default diagnostic export, and redaction-required
  for explicit export.
- Should operation ledger records live in one global JSONL or per-project JSONL?
  The initial recommendation is one global ledger with project ids and periodic
  manifests, because cross-thread operations need total ordering.
- Should `thread-analytics.sqlite` consume direct projections or direct rollouts?
  The initial recommendation is projections, because analytics is an information
  management view.
- What is the first promoted context policy after live text activation:
  recent-dialogue-only, compact working memory, or task-state plus recent
  dialogue?

## Summary

The direct branch should preserve all available dialogical evidence in canonical
JSON rollouts while moving information management into versioned projections.

This gives the shell freedom to experiment with context structures, compaction,
merge/prune/fork views, and project-level bridges without falsifying history.

The model should receive context built from explicit projections and context
packs. The raw rollout remains the audit trail; the projection store becomes the
working substrate.
